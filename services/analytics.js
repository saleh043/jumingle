/* =====================================================================
   JUMINGLE - services/analytics.js
   ---------------------------------------------------------------------
   Very small analytics. We keep a few named counters in SQLite so the
   numbers survive a restart:

     - chats_started    : how many matches we have made
     - chats_completed   : how many matches ended normally
     - reports_submitted : how many reports users have sent
     - total_visits      : how many sockets have ever connected

   "Users online" is a live number (not a counter) and is tracked in
   memory by the matchmaking service.
   ===================================================================== */

const { statements } = require("./database");

// Add `amount` (default 1) to a named counter.
function bump(name, amount = 1) {
  statements.bumpCounter.run(name, amount);
}

// Read one counter (0 if it does not exist yet).
function get(name) {
  const row = statements.getCounter.get(name);
  return row ? row.value : 0;
}

// Read every counter as a plain object { name: value, ... }.
function all() {
  const out = {};
  for (const row of statements.allCounters.all()) out[row.name] = row.value;
  return out;
}

module.exports = {
  bump,
  get,
  all,
  // Named helpers so call-sites read nicely.
  chatStarted: () => bump("chats_started"),
  chatCompleted: () => bump("chats_completed"),
  reportSubmitted: () => bump("reports_submitted"),
  visit: () => bump("total_visits"),
};
