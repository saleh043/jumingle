/* =====================================================================
   JUMINGLE - middleware/adminAuth.js
   ---------------------------------------------------------------------
   Password protection for the admin API. The admin page sends the
   password in an "x-admin-password" header on every request. We compare
   it in constant time so the check cannot be timed/guessed character by
   character.
   ===================================================================== */

const crypto = require("crypto");
const config = require("../config");

// Constant-time string compare (avoids timing attacks).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isValidPassword(password) {
  return safeEqual(password || "", config.ADMIN_PASSWORD);
}

// Express middleware: blocks the request unless the header is correct.
function requireAdmin(req, res, next) {
  if (isValidPassword(req.headers["x-admin-password"])) return next();
  res.status(401).json({ error: "Unauthorized" });
}

module.exports = { requireAdmin, isValidPassword };
