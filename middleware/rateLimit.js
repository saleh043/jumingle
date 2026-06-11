/* =====================================================================
   JUMINGLE - middleware/rateLimit.js
   ---------------------------------------------------------------------
   A tiny in-memory rate limiter - no external package needed.

   - httpRateLimit(): Express middleware that limits requests per IP.
   - SlidingWindow: a small helper used to throttle socket events
     (messages, "next" presses) so one user cannot spam the server.
   ===================================================================== */

// ---- HTTP limiter (per IP) ------------------------------------------
function httpRateLimit({ windowMs = 60 * 1000, max = 120 } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  return function (req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(ip, arr);
    if (arr.length > max) {
      res.status(429).json({ error: "Too many requests. Slow down." });
      return;
    }
    next();
  };
}

// ---- Sliding window counter (used for socket events) ----------------
// Create one per session/action; call hit() and check the return value.
class SlidingWindow {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.times = [];
  }
  // Returns true if allowed, false if the limit is exceeded.
  hit() {
    const now = Date.now();
    this.times = this.times.filter((t) => now - t < this.windowMs);
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
}

module.exports = { httpRateLimit, SlidingWindow };
