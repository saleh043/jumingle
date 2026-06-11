/* =====================================================================
   JUMINGLE - middleware/maintenance.js
   ---------------------------------------------------------------------
   Maintenance mode, controlled by the MAINTENANCE_MODE env variable.
   When it is on, every normal page is replaced by maintenance.html and
   sockets are refused. The admin panel and a few assets stay reachable
   so you can still manage the site.
   ===================================================================== */

const path = require("path");
const config = require("../config");

// Paths that should keep working even during maintenance.
const ALLOW = ["/admin.html", "/js/admin.js", "/maintenance.html"];

function maintenanceGate(req, res, next) {
  if (!config.MAINTENANCE_MODE) return next();

  const url = req.path;
  // Always allow admin + static assets (css, logo, favicon) and our APIs.
  if (
    ALLOW.includes(url) ||
    url.startsWith("/assets/") ||
    url.startsWith("/css/") ||
    url.startsWith("/api/admin/") ||
    url.startsWith("/socket.io/")
  ) {
    return next();
  }

  // Everything else gets the maintenance page.
  res
    .status(503)
    .sendFile(path.join(__dirname, "..", "public", "maintenance.html"));
}

module.exports = { maintenanceGate };
