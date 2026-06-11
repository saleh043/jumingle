/* =====================================================================
   JUMINGLE - services/database.js
   ---------------------------------------------------------------------
   Opens the SQLite database, creates the tables, and exposes a handful
   of ready-to-use prepared statements. Every other service talks to the
   database through this one file so the SQL lives in a single place.

   We store as little as possible:
     - users:     a row per connection (hashed IP only, never the raw IP)
     - reports:   metadata about a report (the chat snapshot stays in
                  memory only - see services/reports.js)
     - bans:      temporary or permanent bans, keyed by hashed IP
     - analytics: simple named counters (chats started, completed, ...)
   ===================================================================== */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Make sure the /database and /logs folders exist before we open the file.
const dbDir = path.join(__dirname, "..", "database");
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const db = new Database(path.join(dbDir, "database.db"));
db.pragma("journal_mode = WAL"); // safer + faster for a small live app

// ---- Tables ----------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname     TEXT,
    ip_hash      TEXT,
    mode         TEXT,
    connected_at TEXT
  );

  CREATE TABLE IF NOT EXISTS reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_hash  TEXT,
    reported_hash  TEXT,
    reported_name  TEXT,
    reason         TEXT,
    message_count  INTEGER,
    created_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS bans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash     TEXT,
    reason      TEXT,
    permanent   INTEGER DEFAULT 0,
    created_at  TEXT,
    expires_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS analytics (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_bans_hash ON bans (ip_hash);
  CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at);
`);

// ---- Prepared statements (compiled once, reused for speed) -----------
const statements = {
  insertUser: db.prepare(
    "INSERT INTO users (nickname, ip_hash, mode, connected_at) VALUES (?, ?, ?, ?)"
  ),
  countUsers: db.prepare("SELECT COUNT(*) AS n FROM users"),

  insertReport: db.prepare(
    `INSERT INTO reports
       (reporter_hash, reported_hash, reported_name, reason, message_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  recentReports: db.prepare("SELECT * FROM reports ORDER BY id DESC LIMIT 100"),
  countReports: db.prepare("SELECT COUNT(*) AS n FROM reports"),

  insertBan: db.prepare(
    `INSERT INTO bans (ip_hash, reason, permanent, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  deleteBanByHash: db.prepare("DELETE FROM bans WHERE ip_hash = ?"),
  findActiveBan: db.prepare(
    `SELECT * FROM bans
       WHERE ip_hash = ? AND (permanent = 1 OR expires_at > ?)
       LIMIT 1`
  ),
  activeBans: db.prepare(
    `SELECT * FROM bans
       WHERE permanent = 1 OR expires_at > ?
       ORDER BY id DESC`
  ),
  purgeExpiredBans: db.prepare(
    "DELETE FROM bans WHERE permanent = 0 AND expires_at <= ?"
  ),

  // Analytics counters (UPSERT style)
  bumpCounter: db.prepare(
    `INSERT INTO analytics (name, value) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET value = value + excluded.value`
  ),
  getCounter: db.prepare("SELECT value FROM analytics WHERE name = ?"),
  allCounters: db.prepare("SELECT name, value FROM analytics"),
};

module.exports = { db, statements, dbDir, logsDir };
