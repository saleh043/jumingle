/* =====================================================================
   JUMINGLE - server.js
   ---------------------------------------------------------------------
   This is the ONLY backend file. It does four jobs:

     1. Serves the web pages in /public (Express).
     2. Pairs strangers together (matchmaking queue).
     3. Passes chat messages and video-call signals between two people
        (Socket.IO). Video calls themselves go peer-to-peer (WebRTC) -
        the server only helps the two browsers find each other.
     4. Stores reports and bans, and powers the admin page (SQLite).

   It is written to be read top-to-bottom like a story. Every section
   has a heading and most lines have a comment. Edit freely!
   ===================================================================== */

// ---- 1. IMPORTS (the libraries we use) ------------------------------
const path = require("path"); // build file paths safely
const fs = require("fs"); // create the /database folder
const http = require("http"); // raw http server (Socket.IO needs it)
const express = require("express"); // simple web server
const { Server } = require("socket.io"); // realtime messaging
const Database = require("better-sqlite3"); // tiny, file-based database

// ---- 2. SETTINGS you can change -------------------------------------
const PORT = process.env.PORT || 3000; // which port to run on
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1Millon$"; // CHANGE THIS!
const BAN_HOURS = 24; // how long a ban lasts
const RATE_LIMIT_MAX = 8; // max messages...
const RATE_LIMIT_WINDOW_MS = 10 * 1000; // ...per 10 seconds

// Very small built-in profanity list. Add or remove words as you like.
// Matched words are replaced with **** so the chat stays usable.
const BAD_WORDS = ["badword1", "badword2", "slur1", "slur2"];

// ---- 3. DATABASE ----------------------------------------------------
// Make sure the /database folder exists, then open the database file.
const dbDir = path.join(__dirname, "database");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
const db = new Database(path.join(dbDir, "database.db"));

// Create our three simple tables if they do not exist yet.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT,
    ip           TEXT,
    connected_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_ip   TEXT,
    reported_ip   TEXT,
    reported_name TEXT,
    reason        TEXT,
    created_at    TEXT
  );
  CREATE TABLE IF NOT EXISTS bans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT,
    reason     TEXT,
    created_at TEXT,
    expires_at TEXT
  );
`);

// A few ready-to-use database commands (prepared once for speed).
const insertUser = db.prepare(
  "INSERT INTO users (username, ip, connected_at) VALUES (?, ?, ?)"
);
const insertReport = db.prepare(
  "INSERT INTO reports (reporter_ip, reported_ip, reported_name, reason, created_at) VALUES (?, ?, ?, ?, ?)"
);
const insertBan = db.prepare(
  "INSERT INTO bans (ip, reason, created_at, expires_at) VALUES (?, ?, ?, ?)"
);
const deleteBanIp = db.prepare("DELETE FROM bans WHERE ip = ?");
const findActiveBan = db.prepare(
  "SELECT * FROM bans WHERE ip = ? AND expires_at > ? LIMIT 1"
);
const recentReports = db.prepare(
  "SELECT * FROM reports ORDER BY id DESC LIMIT 100"
);
const activeBans = db.prepare(
  "SELECT * FROM bans WHERE expires_at > ? ORDER BY id DESC"
);

// Helper: is this IP currently banned?
function isBanned(ip) {
  return !!findActiveBan.get(ip, new Date().toISOString());
}
// Helper: ban an IP for BAN_HOURS hours.
function banIp(ip, reason) {
  const now = new Date();
  const expires = new Date(now.getTime() + BAN_HOURS * 60 * 60 * 1000);
  insertBan.run(
    ip,
    reason || "No reason given",
    now.toISOString(),
    expires.toISOString()
  );
}

// ---- 4. WEB SERVER --------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json()); // lets us read JSON request bodies
app.use(express.static(path.join(__dirname, "public"))); // serve the website files

// Public endpoint used by the homepage to show the live "users online" count.
app.get("/api/online", (req, res) => {
  res.json({ online: onlineCount });
});

// ---- ADMIN API (very simple password check) ----
// The admin page sends the password in a header on every request.
function checkAdmin(req, res) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Wrong password" });
    return false;
  }
  return true;
}

// Admin: log in (just confirms the password is correct).
app.post("/api/admin/login", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

// Admin: live stats for the dashboard.
app.get("/api/admin/stats", (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json({
    online: onlineCount,
    activeChats: pairs.size / 2, // each chat = 2 people in the map
    waiting: waiting.length,
    reports: recentReports.all().length,
    bans: activeBans.all(new Date().toISOString()).length,
  });
});

// Admin: list of recent reports.
app.get("/api/admin/reports", (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(recentReports.all());
});

// Admin: list of active bans.
app.get("/api/admin/bans", (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(activeBans.all(new Date().toISOString()));
});

// Admin: ban an IP by hand.
app.post("/api/admin/ban", (req, res) => {
  if (!checkAdmin(req, res)) return;
  banIp(req.body.ip, req.body.reason || "Banned by admin");
  res.json({ ok: true });
});

// Admin: remove all bans for an IP.
app.post("/api/admin/unban", (req, res) => {
  if (!checkAdmin(req, res)) return;
  deleteBanIp.run(req.body.ip);
  res.json({ ok: true });
});

// ---- 5. MATCHMAKING STATE (kept in memory, resets on restart) -------
let onlineCount = 0; // how many sockets are connected right now
const waiting = []; // socket IDs waiting for a partner
const pairs = new Map(); // socketId -> partner socketId
const profiles = new Map(); // socketId -> { name, mode, interests, ip, msgTimes }

// Word lists for friendly random names like "PalmTiger47".
const NAME_PARTS_A = [
  "Palm",
  "Ocean",
  "Jungle",
  "Beach",
  "Coral",
  "Mango",
  "Sandy",
  "Coconut",
  "Wave",
  "Tropic",
];
const NAME_PARTS_B = [
  "Tiger",
  "Monkey",
  "Fox",
  "Lion",
  "Dolphin",
  "Parrot",
  "Turtle",
  "Gecko",
  "Crab",
  "Shark",
];
function randomName() {
  const a = NAME_PARTS_A[Math.floor(Math.random() * NAME_PARTS_A.length)];
  const b = NAME_PARTS_B[Math.floor(Math.random() * NAME_PARTS_B.length)];
  const n = Math.floor(Math.random() * 90) + 10; // 10-99
  return a + b + n;
}

// Replace any bad words with **** (keeps the rest of the message).
function cleanText(text) {
  let out = text;
  for (const word of BAD_WORDS) {
    const re = new RegExp(word, "gi");
    out = out.replace(re, "*".repeat(word.length));
  }
  return out;
}

// Get the real IP, even when running behind a host/proxy (Render, Nginx...).
function getIp(socket) {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return socket.handshake.address;
}

// Break up a pair. Tells the partner the stranger left, and frees both.
function unpair(socketId) {
  const partnerId = pairs.get(socketId);
  if (partnerId) {
    pairs.delete(socketId);
    pairs.delete(partnerId);
    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket) partnerSocket.emit("partner-left");
  }
}

// Try to find a waiting stranger for this user and connect them.
function findMatch(socket) {
  const me = profiles.get(socket.id);
  if (!me) return;

  // Look through everyone who is waiting.
  let matchIndex = -1; // best match found so far
  let sharedInterestMatch = -1;
  for (let i = 0; i < waiting.length; i++) {
    const otherId = waiting[i];
    if (otherId === socket.id) continue; // never match with myself
    const other = profiles.get(otherId);
    if (!other || other.mode !== me.mode) continue; // must be same mode (text/video)

    // Remember the first valid match as a fallback (random pairing).
    if (matchIndex === -1) matchIndex = i;

    // Prefer someone who shares at least one interest.
    const shares = me.interests.some((x) => other.interests.includes(x));
    if (shares) {
      sharedInterestMatch = i;
      break;
    }
  }

  // Use the shared-interest match if we found one, otherwise the first match.
  const chosen = sharedInterestMatch !== -1 ? sharedInterestMatch : matchIndex;

  if (chosen === -1) {
    // Nobody available -> wait in the queue.
    waiting.push(socket.id);
    socket.emit("waiting");
    return;
  }

  // We have a partner! Remove them from the waiting list and pair us up.
  const partnerId = waiting.splice(chosen, 1)[0];
  const partner = profiles.get(partnerId);
  pairs.set(socket.id, partnerId);
  pairs.set(partnerId, socket.id);

  const partnerSocket = io.sockets.sockets.get(partnerId);

  // Tell both sides they are matched. For video, ONE side must "initiate"
  // the WebRTC call - we let the newcomer (socket) be the initiator.
  socket.emit("matched", { name: partner.name, initiator: true });
  if (partnerSocket)
    partnerSocket.emit("matched", { name: me.name, initiator: false });
}

// ---- 6. REALTIME EVENTS (the heart of the app) ----------------------
io.on("connection", (socket) => {
  const ip = getIp(socket);

  // Refuse banned visitors immediately.
  if (isBanned(ip)) {
    socket.emit("banned");
    socket.disconnect(true);
    return;
  }

  // Give this visitor a random name and remember some basic info.
  const name = randomName();
  profiles.set(socket.id, {
    name,
    mode: null,
    interests: [],
    ip,
    msgTimes: [],
  });
  insertUser.run(name, ip, new Date().toISOString());

  // Update the online counter for everyone.
  onlineCount++;
  io.emit("online-count", onlineCount);

  // Tell this user their name.
  socket.emit("welcome", { name });

  // --- The user wants to find (or skip to) a stranger ---
  // mode = 'text' or 'video'. interests = array of strings.
  socket.on("find", (data = {}) => {
    const me = profiles.get(socket.id);
    if (!me) return;

    unpair(socket.id); // leave any current partner
    const idx = waiting.indexOf(socket.id); // make sure we are not double-queued
    if (idx !== -1) waiting.splice(idx, 1);

    me.mode = data.mode === "video" ? "video" : "text";
    me.interests = Array.isArray(data.interests)
      ? data.interests.slice(0, 5)
      : [];

    findMatch(socket);
  });

  // --- A chat message for the partner ---
  socket.on("message", (text) => {
    const me = profiles.get(socket.id);
    const partnerId = pairs.get(socket.id);
    if (!me || !partnerId || typeof text !== "string") return;

    // Simple rate limit: drop messages if the user is spamming.
    const now = Date.now();
    me.msgTimes = me.msgTimes.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (me.msgTimes.length >= RATE_LIMIT_MAX) {
      socket.emit("system", "You are sending messages too fast. Slow down.");
      return;
    }
    me.msgTimes.push(now);

    const safe = cleanText(text).slice(0, 1000); // censor + limit length
    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket) partnerSocket.emit("message", { text: safe });
  });

  // --- "Stranger is typing..." indicator (optional, nice touch) ---
  socket.on("typing", () => {
    const partnerId = pairs.get(socket.id);
    const partnerSocket = partnerId && io.sockets.sockets.get(partnerId);
    if (partnerSocket) partnerSocket.emit("typing");
  });

  // --- WebRTC signaling: just pass the data straight to the partner ---
  // The server never looks inside this - it only relays it.
  socket.on("signal", (data) => {
    const partnerId = pairs.get(socket.id);
    const partnerSocket = partnerId && io.sockets.sockets.get(partnerId);
    if (partnerSocket) partnerSocket.emit("signal", data);
  });

  // --- Report the current partner ---
  socket.on("report", (data = {}) => {
    const me = profiles.get(socket.id);
    const partnerId = pairs.get(socket.id);
    const partner = partnerId && profiles.get(partnerId);
    if (!me || !partner) return;
    insertReport.run(
      me.ip,
      partner.ip,
      partner.name,
      (data.reason || "No reason").slice(0, 200),
      new Date().toISOString()
    );
    socket.emit("system", "Thanks. Your report has been sent.");
  });

  // --- User pressed Disconnect / Stop ---
  socket.on("stop", () => {
    unpair(socket.id);
    const idx = waiting.indexOf(socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
  });

  // --- User closed the tab or lost connection ---
  socket.on("disconnect", () => {
    unpair(socket.id);
    const idx = waiting.indexOf(socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    profiles.delete(socket.id);
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit("online-count", onlineCount);
  });
});

// ---- 7. START THE SERVER --------------------------------------------
server.listen(PORT, () => {
  console.log(`\n  Jumingle is running!  ->  http://localhost:${PORT}`);
  console.log(
    `  Admin page:           ->  http://localhost:${PORT}/admin.html`
  );
  console.log(`  Admin password:           ${ADMIN_PASSWORD}\n`);
});
