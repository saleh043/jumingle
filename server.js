/* =====================================================================
   JUMINGLE - server.js
   ---------------------------------------------------------------------
   The single entry point. It is now an "orchestrator": it wires together
   the small modules in /services and /middleware, exposes a few JSON
   APIs, serves the website, and starts Socket.IO.

   Read it top-to-bottom to see how a request flows:
     security headers -> maintenance gate -> rate limit -> routes/static.
   ===================================================================== */

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const config = require("./config");

// Services (business logic)
require("./services/database"); // opens DB + creates folders/tables
const matchmaking = require("./services/matchmaking");
const reports = require("./services/reports");
const bans = require("./services/bans");
const analytics = require("./services/analytics");
const sockets = require("./services/sockets");

// Middleware
const { securityHeaders } = require("./middleware/security");
const { maintenanceGate } = require("./middleware/maintenance");
const { httpRateLimit } = require("./middleware/rateLimit");
const { requireAdmin, isValidPassword } = require("./middleware/adminAuth");

// ---- App + HTTP + Socket.IO -----------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 }); // 1 MB cap

if (config.TRUST_PROXY) app.set("trust proxy", 1); // honour X-Forwarded-For

app.use(express.json({ limit: "32kb" })); // small JSON bodies only
app.use(securityHeaders); // safe response headers
app.use(maintenanceGate); // 503 page when MAINTENANCE_MODE is on

// ---- Public JSON API -------------------------------------------------
// Gentle limit on the public endpoints.
const publicLimiter = httpRateLimit({ windowMs: 60 * 1000, max: 120 });

// Live "users online" count for the homepage.
app.get("/api/online", publicLimiter, (req, res) => {
  res.json({ online: matchmaking.getOnline() });
});

// Front-end runtime config: WebRTC ICE servers + maintenance flag.
// (TURN credentials must reach the browser; that is how WebRTC works.)
app.get("/api/config", publicLimiter, (req, res) => {
  res.json({
    iceServers: config.iceServers,
    maintenance: config.MAINTENANCE_MODE,
    discordUrl: config.DISCORD_URL,
  });
});

// ---- Admin JSON API --------------------------------------------------
const adminLimiter = httpRateLimit({ windowMs: 60 * 1000, max: 240 });

// Log in (just confirms the password; the page then sends it as a header).
app.post("/api/admin/login", adminLimiter, (req, res) => {
  if (isValidPassword(req.body && req.body.password)) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

// Everything below requires the admin header.
app.use("/api/admin", adminLimiter, (req, res, next) => {
  if (req.path === "/login") return next(); // already handled above
  return requireAdmin(req, res, next);
});

// Dashboard numbers.
app.get("/api/admin/stats", (req, res) => {
  const live = matchmaking.liveStats();
  res.json({
    online: live.online,
    activeChats: live.activeChats,
    waiting: live.waiting,
    reports: reports.recent().length,
    bans: bans.listActiveBans().length,
    maintenance: config.MAINTENANCE_MODE,
  });
});

// Cumulative analytics counters (survive restarts).
app.get("/api/admin/analytics", (req, res) => {
  res.json(analytics.all());
});

// Recent reports (metadata only).
app.get("/api/admin/reports", (req, res) => {
  res.json(reports.recent());
});

// The in-memory last-10-messages snapshot for one report.
app.get("/api/admin/report-log/:id", (req, res) => {
  res.json({ messages: reports.getLog(req.params.id) });
});

// Active bans.
app.get("/api/admin/bans", (req, res) => {
  res.json(bans.listActiveBans());
});

// Ban: accepts a hashed IP (from a report) or a raw IP. hours=0 -> permanent.
app.post("/api/admin/ban", (req, res) => {
  const { ipHash, ip, reason, hours, permanent } = req.body || {};
  const hrs = permanent ? 0 : Number(hours) || config.DEFAULT_BAN_HOURS;
  if (ipHash) bans.banByHash(ipHash, reason, hrs);
  else if (ip) bans.banIp(ip, reason, hrs);
  else return res.status(400).json({ error: "Provide ip or ipHash" });
  res.json({ ok: true });
});

// Unban by hashed IP.
app.post("/api/admin/unban", (req, res) => {
  const { ipHash } = req.body || {};
  if (!ipHash) return res.status(400).json({ error: "Provide ipHash" });
  bans.unbanByHash(ipHash);
  res.json({ ok: true });
});

// ---- Static files ----------------------------------------------------
app.use(
  "/assets",
  express.static(path.join(__dirname, "assets"), { maxAge: "7d" })
);
app.use(express.static(path.join(__dirname, "public")));

// ---- Realtime --------------------------------------------------------
// Refuse all sockets while in maintenance mode (admin uses HTTP, not WS).
io.use((socket, next) => {
  if (config.MAINTENANCE_MODE) return next(new Error("maintenance"));
  next();
});

sockets.register(io);

// ---- Housekeeping ----------------------------------------------------
// Every 10 minutes, delete temporary bans that have expired.
setInterval(() => bans.purgeExpired(), 10 * 60 * 1000);

// ---- Start -----------------------------------------------------------
server.listen(config.PORT, () => {
  console.log("\n  Jumingle is running!");
  console.log(`  Site         ->  http://localhost:${config.PORT}`);
  console.log(`  Admin panel  ->  http://localhost:${config.PORT}/admin.html`);
  console.log(`  Environment  ->  ${config.NODE_ENV}`);
  if (config.MAINTENANCE_MODE) console.log("  MAINTENANCE MODE is ON");
  if (config.ADMIN_PASSWORD === "changeme123")
    console.log("  WARNING: default admin password in use - change it!\n");
  else console.log("");
});
