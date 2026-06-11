/* =====================================================================
   JUMINGLE - services/matchmaking.js
   ---------------------------------------------------------------------
   The heart of the app: it pairs strangers and keeps the live state.

   Key ideas
   ---------
   - Everything is keyed by a SESSION id (a random string the browser
     keeps in sessionStorage), NOT by the socket id. That is what makes
     SESSION RECOVERY possible: if your socket drops and reconnects
     within ~30 seconds, we re-attach you to the same conversation.

   - Matchmaking is a simple QUEUE. When you press "Next" we look for a
     waiting stranger in the SAME mode (text/video). We prefer someone
     who shares an interest, but fall back to anyone available.

   - All state lives in memory and resets on restart (by design).
   ===================================================================== */

const config = require("../config");
const analytics = require("./analytics");

let io = null; // set in init()

// sessionId -> session object
const sessions = new Map();
// socketId -> sessionId (so a disconnect can find its session)
const socketToSession = new Map();
// queue of sessionIds currently waiting for a partner
const waiting = [];

let onlineCount = 0;

// --- helpers ----------------------------------------------------------
function emitTo(socketId, event, payload) {
  if (socketId) io.to(socketId).emit(event, payload);
}
function getSession(sessionId) {
  return sessions.get(sessionId);
}
function partnerOf(session) {
  return session && session.partner ? sessions.get(session.partner) : null;
}
function removeFromQueue(sessionId) {
  const i = waiting.indexOf(sessionId);
  if (i !== -1) waiting.splice(i, 1);
}

// Break a pair. Tells the still-present partner the stranger left.
// `silent` skips notifying (used when the partner already knows).
function unpair(session, { silent = false } = {}) {
  if (!session || !session.partner) return;
  const partner = partnerOf(session);
  session.partner = null;
  session.state = "idle";
  if (partner) {
    partner.partner = null;
    partner.state = "idle";
    if (!silent) emitTo(partner.socketId, "partner-left");
    // A real conversation ended -> count it once (from this side).
    analytics.chatCompleted();
  }
}

// Try to pair `session` with a waiting stranger, else queue it.
function findMatch(session) {
  // Make sure we are not already in the queue.
  removeFromQueue(session.sessionId);

  let firstMatch = -1; // fallback: first valid same-mode partner
  let interestMatch = -1; // preferred: shares an interest

  for (let i = 0; i < waiting.length; i++) {
    const otherId = waiting[i];
    if (otherId === session.sessionId) continue;
    const other = sessions.get(otherId);
    if (!other || !other.socketId) continue; // skip stale entries
    if (other.mode !== session.mode) continue; // must match mode

    if (firstMatch === -1) firstMatch = i;
    const shares = session.interests.some((x) => other.interests.includes(x));
    if (shares) {
      interestMatch = i;
      break;
    }
  }

  const chosen = interestMatch !== -1 ? interestMatch : firstMatch;

  if (chosen === -1) {
    waiting.push(session.sessionId);
    session.state = "waiting";
    emitTo(session.socketId, "waiting");
    return;
  }

  // Pair them up.
  const partnerId = waiting.splice(chosen, 1)[0];
  const partner = sessions.get(partnerId);
  session.partner = partnerId;
  partner.partner = session.sessionId;
  session.state = partner.state = "paired";
  session.history = [];
  partner.history = [];

  analytics.chatStarted();

  // The newcomer becomes the WebRTC "initiator" for video calls.
  emitTo(session.socketId, "matched", {
    name: partner.nickname,
    initiator: true,
  });
  emitTo(partner.socketId, "matched", {
    name: session.nickname,
    initiator: false,
  });
}

// --- public API -------------------------------------------------------

function init(socketIo) {
  io = socketIo;
}

// A socket connected and identified itself with a sessionId.
// Returns { session, recovered }.
function connect(socket, { sessionId, nickname, ipHash }) {
  const existing = sessions.get(sessionId);

  if (existing) {
    // ---- SESSION RECOVERY ----
    if (existing.recoveryTimer) {
      clearTimeout(existing.recoveryTimer);
      existing.recoveryTimer = null;
    }
    existing.socketId = socket.id;
    if (nickname) existing.nickname = nickname;
    socketToSession.set(socket.id, sessionId);
    onlineCount++;
    broadcastOnline();

    const partner = partnerOf(existing);
    if (partner && partner.socketId) {
      // We came back in time and the partner is still here: resume!
      existing.state = partner.state = "paired";
      emitTo(socket.id, "resumed", { name: partner.nickname });
      emitTo(partner.socketId, "partner-returned");
      // Video needs a fresh negotiation; tell both browsers to re-offer.
      if (existing.mode === "video") {
        emitTo(socket.id, "renegotiate", { initiator: true });
        emitTo(partner.socketId, "renegotiate", { initiator: false });
      }
    }
    return { session: existing, recovered: true };
  }

  // ---- BRAND NEW SESSION ----
  const session = {
    sessionId,
    socketId: socket.id,
    nickname: nickname || "Stranger",
    mode: null,
    interests: [],
    ipHash,
    partner: null,
    history: [],
    msgTimes: [],
    findTimes: [],
    recoveryTimer: null,
    state: "idle",
  };
  sessions.set(sessionId, session);
  socketToSession.set(socket.id, sessionId);
  onlineCount++;
  broadcastOnline();
  analytics.visit();
  return { session, recovered: false };
}

// User pressed Start / Next.
function find(sessionId, { mode, interests }) {
  const session = sessions.get(sessionId);
  if (!session) return;
  unpair(session); // leave any current partner
  session.mode = mode === "video" ? "video" : "text";
  session.interests = Array.isArray(interests)
    ? interests
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, config.MAX_INTERESTS)
    : [];
  findMatch(session);
}

// User pressed Disconnect/Stop (stays connected, just leaves the chat).
function stop(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  unpair(session);
  removeFromQueue(sessionId);
  session.state = "idle";
}

// Record a chat line so a report can include recent context.
// `from` is "you" relative to the sender; we store the nickname instead.
function recordMessage(sessionId, fromName, text) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const partner = partnerOf(session);
  const line = { from: fromName, text, at: new Date().toISOString() };
  session.history.push(line);
  if (session.history.length > 50) session.history.shift();
  // Keep the same line in the partner's history too, so either person's
  // report shows the full back-and-forth.
  if (partner) {
    partner.history.push(line);
    if (partner.history.length > 50) partner.history.shift();
  }
}

// The socket id of the current partner (for relaying messages/signals).
function partnerSocketId(sessionId) {
  const session = sessions.get(sessionId);
  const partner = partnerOf(session);
  return partner ? partner.socketId : null;
}

// A socket dropped. Keep the session alive briefly for recovery.
function disconnect(socketId) {
  const sessionId = socketToSession.get(socketId);
  socketToSession.delete(socketId);
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (!session || session.socketId !== socketId) return;

  session.socketId = null;
  onlineCount = Math.max(0, onlineCount - 1);
  broadcastOnline();
  removeFromQueue(sessionId);

  const partner = partnerOf(session);
  if (partner && partner.socketId) {
    // Let the partner know we might come back.
    emitTo(partner.socketId, "partner-waiting", {
      seconds: Math.round(config.SESSION_RECOVERY_MS / 1000),
    });
  }

  // After the grace period, drop the session for good.
  session.recoveryTimer = setTimeout(() => {
    const stillPartner = partnerOf(session);
    if (stillPartner && stillPartner.socketId) {
      emitTo(stillPartner.socketId, "partner-left");
      stillPartner.partner = null;
      stillPartner.state = "idle";
      analytics.chatCompleted();
    }
    sessions.delete(sessionId);
  }, config.SESSION_RECOVERY_MS);
}

function broadcastOnline() {
  if (io) io.emit("online-count", onlineCount);
}

// Live numbers for the homepage and admin panel.
function liveStats() {
  return {
    online: onlineCount,
    waiting: waiting.length,
    activeChats: countActiveChats(),
  };
}
function countActiveChats() {
  let paired = 0;
  for (const s of sessions.values()) if (s.partner) paired++;
  return Math.floor(paired / 2);
}
function getOnline() {
  return onlineCount;
}

// Session info needed when building a report.
function sessionInfo(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const partner = partnerOf(session);
  return { session, partner };
}

module.exports = {
  init,
  connect,
  find,
  stop,
  recordMessage,
  partnerSocketId,
  disconnect,
  liveStats,
  getOnline,
  sessionInfo,
};
