/* =====================================================================
   JUMINGLE - services/reports.js
   ---------------------------------------------------------------------
   When a user reports a stranger we save two things:

     1. METADATA -> SQLite (who, when, reason, how many messages). This
        is small and safe to keep.

     2. The LAST 10 CHAT MESSAGES -> kept in MEMORY only, attached to the
        report id. They let a moderator see context in the admin panel
        while the server is running, but they are never written to disk
        and disappear on restart. This keeps user conversations private.
   ===================================================================== */

const config = require("../config");
const { statements } = require("./database");
const analytics = require("./analytics");

// reportId -> array of { from, text, at }  (in memory only)
const messageLogs = new Map();

// Save a report. `messages` is the recent conversation snapshot.
// Returns the new report id.
function saveReport({ reporterHash, reportedHash, reportedName, reason }, messages = []) {
  // Only keep the last N messages (default 10).
  const snapshot = messages.slice(-config.REPORT_LOG_SIZE);

  const info = statements.insertReport.run(
    reporterHash,
    reportedHash,
    (reportedName || "Stranger").slice(0, 60),
    (reason || "No reason given").slice(0, 200),
    snapshot.length,
    new Date().toISOString()
  );

  const id = info.lastInsertRowid;
  messageLogs.set(id, snapshot); // in-memory only
  analytics.reportSubmitted();
  return id;
}

// Recent report metadata (from SQLite) for the admin dashboard.
function recent() {
  return statements.recentReports.all();
}

// The in-memory message snapshot for one report (or [] if gone).
function getLog(id) {
  return messageLogs.get(Number(id)) || [];
}

module.exports = { saveReport, recent, getLog };
