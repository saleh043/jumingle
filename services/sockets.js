/* =====================================================================
   JUMINGLE - services/sockets.js
   ---------------------------------------------------------------------
   Wires up every realtime (Socket.IO) event. It is deliberately thin:
   it validates and rate-limits input, then hands the work to the other
   services (matchmaking, reports, bans).

   The server only relays text messages and WebRTC "signals". Actual
   video/audio travels directly between the two browsers (peer-to-peer).
   ===================================================================== */

const config = require("../config");
const matchmaking = require("./matchmaking");
const reports = require("./reports");
const bans = require("./bans");
const { SlidingWindow } = require("../middleware/rateLimit");
const { sanitizeText } = require("../middleware/security");

// A small, easily edited profanity list. Matches are replaced with ****.
const BAD_WORDS = ["badword1", "badword2", "slur1", "slur2"];
function cleanText(text) {
  let out = text;
  for (const word of BAD_WORDS) {
    out = out.replace(new RegExp(word, "gi"), "*".repeat(word.length));
  }
  return out;
}

// Validate a nickname: 2-20 chars, letters/numbers/_/-/space only.
function validNickname(name) {
  return typeof name === "string" && /^[A-Za-z0-9 _-]{2,20}$/.test(name.trim());
}

// Get the real client IP, even behind a proxy (Render/Nginx).
function getIp(socket) {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return socket.handshake.address;
}

function register(io) {
  matchmaking.init(io);

  io.on("connection", (socket) => {
    const ip = getIp(socket);

    // Refuse banned visitors right away.
    if (bans.isBanned(ip)) {
      socket.emit("banned");
      socket.disconnect(true);
      return;
    }

    // Read identity sent by the browser (sessionStorage + nickname modal).
    const auth = socket.handshake.auth || {};
    const sessionId =
      typeof auth.sessionId === "string" && auth.sessionId.length >= 8
        ? auth.sessionId.slice(0, 64)
        : "s_" + Math.random().toString(36).slice(2);
    const nickname = validNickname(auth.nickname)
      ? auth.nickname.trim()
      : "Stranger";
    const ipHash = bans.hashIp(ip);

    const { session, recovered } = matchmaking.connect(socket, {
      sessionId,
      nickname,
      ipHash,
    });

    // Per-connection rate limiters (anti-abuse).
    const msgLimiter = new SlidingWindow(
      config.MSG_RATE_MAX,
      config.MSG_RATE_WINDOW_MS
    );
    const findLimiter = new SlidingWindow(
      config.FIND_RATE_MAX,
      config.FIND_RATE_WINDOW_MS
    );

    socket.emit("welcome", { nickname: session.nickname, recovered });

    // ---- Find / Next ----
    socket.on("find", (data = {}) => {
      if (!findLimiter.hit()) {
        socket.emit("system", "You're switching too fast. Please wait a moment.");
        return;
      }
      matchmaking.find(sessionId, {
        mode: data.mode,
        interests: data.interests,
      });
    });

    // ---- Chat message ----
    socket.on("message", (raw) => {
      if (typeof raw !== "string") return;
      const partnerId = matchmaking.partnerSocketId(sessionId);
      if (!partnerId) return; // not in a chat
      if (!msgLimiter.hit()) {
        socket.emit("system", "You are sending messages too fast. Slow down.");
        return;
      }
      const safe = cleanText(sanitizeText(raw, config.MAX_MESSAGE_LENGTH));
      if (!safe) return;
      matchmaking.recordMessage(sessionId, session.nickname, safe);
      io.to(partnerId).emit("message", { text: safe });
    });

    // ---- Typing indicator ----
    socket.on("typing", () => {
      const partnerId = matchmaking.partnerSocketId(sessionId);
      if (partnerId) io.to(partnerId).emit("typing");
    });

    // ---- WebRTC signaling (relayed blindly) ----
    socket.on("signal", (data) => {
      const partnerId = matchmaking.partnerSocketId(sessionId);
      if (partnerId) io.to(partnerId).emit("signal", data);
    });

    // ---- Report the current partner ----
    socket.on("report", (data = {}) => {
      const info = matchmaking.sessionInfo(sessionId);
      if (!info || !info.partner) {
        socket.emit("system", "There is no one to report right now.");
        return;
      }
      reports.saveReport(
        {
          reporterHash: info.session.ipHash,
          reportedHash: info.partner.ipHash,
          reportedName: info.partner.nickname,
          reason: sanitizeText(data.reason || "No reason given", 200),
        },
        info.session.history
      );
      socket.emit("system", "Thanks. Your report has been sent to moderators.");
    });

    // ---- Disconnect from the current chat (stay connected) ----
    socket.on("stop", () => matchmaking.stop(sessionId));

    // ---- Socket closed / lost ----
    socket.on("disconnect", () => matchmaking.disconnect(socket.id));
  });
}

module.exports = { register };
