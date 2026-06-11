/* =====================================================================
   JUMINGLE - services/bans.js
   ---------------------------------------------------------------------
   The ban system. Two important ideas:

     1. We NEVER store raw IP addresses. We store a one-way SHA-256 hash
        (salted with IP_HASH_SALT). The same visitor always produces the
        same hash, so bans still work, but the original IP is not kept.

     2. Bans can be TEMPORARY (expire after some hours) or PERMANENT.
   ===================================================================== */

const crypto = require("crypto");
const config = require("../config");
const { statements } = require("./database");

// Turn a raw IP into a stable, non-reversible hash.
function hashIp(ip) {
  return crypto
    .createHash("sha256")
    .update(String(ip || "") + "::" + config.IP_HASH_SALT)
    .digest("hex");
}

// Is this visitor currently banned? (accepts a raw IP)
function isBanned(ip) {
  const ipHash = hashIp(ip);
  return !!statements.findActiveBan.get(ipHash, new Date().toISOString());
}

// Ban by raw IP. Pass hours = 0 (or permanent = true) for a permanent ban.
function banIp(ip, reason, hours) {
  banByHash(hashIp(ip), reason, hours);
}

// Ban by an already-hashed value (used from the admin panel & reports).
function banByHash(ipHash, reason, hours) {
  const now = new Date();
  const isPermanent = !hours || hours <= 0;
  const expires = isPermanent
    ? null
    : new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  statements.insertBan.run(
    ipHash,
    (reason || "No reason given").slice(0, 200),
    isPermanent ? 1 : 0,
    now.toISOString(),
    expires
  );
}

// Remove every ban for a hashed IP.
function unbanByHash(ipHash) {
  statements.deleteBanByHash.run(ipHash);
}

// List of currently-active bans (for the admin panel).
function listActiveBans() {
  return statements.activeBans.all(new Date().toISOString());
}

// Housekeeping: delete temporary bans that have expired.
function purgeExpired() {
  statements.purgeExpiredBans.run(new Date().toISOString());
}

module.exports = {
  hashIp,
  isBanned,
  banIp,
  banByHash,
  unbanByHash,
  listActiveBans,
  purgeExpired,
};
