/* =====================================================================
   JUMINGLE - config.js
   ---------------------------------------------------------------------
   One place for every setting. Values come from environment variables
   so you can deploy to Render or a VPS without touching the code.

   For local development we load a small ".env" file (if it exists) with
   a tiny built-in parser - no extra npm package needed.
   ===================================================================== */

const fs = require("fs");
const path = require("path");

// ---- Tiny .env loader ------------------------------------------------
// Reads KEY=value lines from a .env file in the project root and copies
// them into process.env (without overwriting anything already set).
function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue; // skip blanks / comments
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

// ---- Small helpers to read typed values ------------------------------
function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}
function num(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}
function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

// ---- Build the WebRTC ICE server list (STUN + optional TURN) ----------
// TURN is what lets users on strict networks connect. Provide it through
// environment variables in production. The list is sent to the browser.
function buildIceServers() {
  const servers = [];

  // STUN: one or more comma-separated URLs (a free Google STUN by default).
  const stun = str("STUN_URLS", "stun:stun.l.google.com:19302");
  stun
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((urls) => servers.push({ urls }));

  // TURN: only added if TURN_URLS is set. Credentials come from env too.
  const turn = str("TURN_URLS", "");
  if (turn) {
    const urls = turn
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    servers.push({
      urls,
      username: str("TURN_USERNAME", ""),
      credential: str("TURN_CREDENTIAL", ""),
    });
  }

  return servers;
}

module.exports = {
  // Core
  NODE_ENV: str("NODE_ENV", "development"),
  PORT: num("PORT", 3000),
  // Trust the X-Forwarded-For header when behind a proxy (Render, Nginx...).
  TRUST_PROXY: bool("TRUST_PROXY", true),

  // Admin panel
  ADMIN_PASSWORD: str("ADMIN_PASSWORD", "changeme123"),

  // Security
  // Salt used when hashing IP addresses so we never store raw IPs.
  IP_HASH_SALT: str("IP_HASH_SALT", "jumingle-default-salt-change-me"),
  MAINTENANCE_MODE: bool("MAINTENANCE_MODE", false),

  // Bans
  DEFAULT_BAN_HOURS: num("DEFAULT_BAN_HOURS", 24),

  // Matchmaking / sessions
  // How long (ms) we keep a disconnected user's session alive so they can
  // reconnect and resume the same conversation.
  SESSION_RECOVERY_MS: num("SESSION_RECOVERY_MS", 30 * 1000),
  MAX_INTERESTS: num("MAX_INTERESTS", 5),

  // Chat limits / anti-abuse
  MAX_MESSAGE_LENGTH: num("MAX_MESSAGE_LENGTH", 1000),
  MSG_RATE_MAX: num("MSG_RATE_MAX", 8), // messages...
  MSG_RATE_WINDOW_MS: num("MSG_RATE_WINDOW_MS", 10 * 1000), // ...per window
  FIND_RATE_MAX: num("FIND_RATE_MAX", 30), // "next" presses...
  FIND_RATE_WINDOW_MS: num("FIND_RATE_WINDOW_MS", 10 * 1000), // ...per window
  REPORT_LOG_SIZE: num("REPORT_LOG_SIZE", 10), // last N messages kept for reports

  // WebRTC
  iceServers: buildIceServers(),

  // Front-end content / links (placeholders you can change)
  DISCORD_URL: str("DISCORD_URL", "#"),
  CONTACT_EMAIL: str("CONTACT_EMAIL", "support@example.com"),

  // Tiny read-only helper for the public /api/config endpoint
  bool,
  num,
  str,
};
