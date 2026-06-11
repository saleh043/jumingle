/* =====================================================================
   JUMINGLE - middleware/security.js
   ---------------------------------------------------------------------
   Security helpers with no external dependencies:

     - securityHeaders(): sets a sensible set of HTTP response headers
       (a lightweight, hand-rolled "helmet").
     - sanitizeText(): strips control characters and trims length.
     - escapeHtml(): turns <, >, & etc. into safe entities so user text
       can never become live HTML (XSS protection).
   ===================================================================== */

// A small Content-Security-Policy. It allows the few CDNs we use
// (TailwindCSS) plus inline scripts/styles that the pages rely on.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
  "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(self), camera=(self)"
  );
  res.setHeader("Content-Security-Policy", CSP);
  next();
}

// Remove control characters and clamp the length. Used on chat text and
// any free-text the user sends over a socket. Keeps normal spaces.
function sanitizeText(text, maxLength = 1000) {
  if (typeof text !== "string") return "";
  // Strip control characters (keep normal printable text) then clamp length.
  // eslint-disable-next-line no-control-regex
  const controlChars = new RegExp("[\\u0000-\\u001F\\u007F]", "g");
  return text.replace(controlChars, " ").slice(0, maxLength).trim();
}

// Escape HTML special characters so text is rendered literally.
function escapeHtml(str) {
  return String(str == null ? "" : str).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );
}

module.exports = { securityHeaders, sanitizeText, escapeHtml };
