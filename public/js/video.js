/* =====================================================================
   video.js - powers the video chat page (video-chat.html)
   ---------------------------------------------------------------------
   How it works in plain words:
     - Your camera/mic become a "local stream".
     - The server pairs you with a stranger and tells ONE side to be the
       "initiator".
     - The two browsers swap small "signal" messages through the server
       to connect directly. After that, video flows peer-to-peer (WebRTC)
       and the server never sees it.

   ICE servers (STUN/TURN) come from the server via /api/config, so TURN
   can be configured with environment variables in production.
   ===================================================================== */

const statusEl = document.getElementById('status');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');

let socket = null;
let interests = [];
let rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let peer = null;
let localStream = null;

// ---- Helpers ---------------------------------------------------------
function setStatus(text, colorClass) {
  statusEl.textContent = text;
  statusEl.className = 'text-sm font-medium ' + (colorClass || 'text-slate-400');
}
function showOverlay(text) {
  overlayText.textContent = text;
  overlay.style.display = 'flex';
}
function hideOverlay() {
  overlay.style.display = 'none';
}

async function startCamera() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

function createPeer() {
  peer = new RTCPeerConnection(rtcConfig);

  peer.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal', { candidate: e.candidate });
  };
  peer.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    hideOverlay();
    setStatus('Connected', 'text-jgreen');
  };
  peer.onconnectionstatechange = () => {
    if (peer && (peer.connectionState === 'failed' || peer.connectionState === 'disconnected')) {
      setStatus('Connection lost', 'text-yellow-400');
    }
  };

  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
}

function closePeer() {
  if (peer) { peer.close(); peer = null; }
  remoteVideo.srcObject = null;
}

async function makeOffer() {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit('signal', { sdp: peer.localDescription });
}

function findStranger() {
  closePeer();
  showOverlay('Searching for stranger...');
  setStatus('Searching...', 'text-jblue');
  socket.emit('find', { mode: 'video', interests });
}

// ---- Boot once nickname is set + camera allowed ----------------------
document.addEventListener('jumingle:ready', async (e) => {
  interests = e.detail.interests || [];

  // Pull ICE servers (STUN/TURN) from the server.
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    if (cfg.iceServers && cfg.iceServers.length) rtcConfig = { iceServers: cfg.iceServers };
  } catch (err) { /* keep default STUN */ }

  // Ask for camera/mic before connecting.
  try {
    await startCamera();
  } catch (err) {
    showOverlay('Camera/microphone access was blocked. Please allow it and reload.');
    return;
  }

  socket = io({
    auth: { sessionId: e.detail.sessionId, nickname: e.detail.nickname },
  });

  socket.on('welcome', () => findStranger());
  socket.on('waiting', () => {
    showOverlay('Searching for stranger...');
    setStatus('Searching...', 'text-jblue');
  });

  socket.on('matched', async (data) => {
    setStatus('Stranger found - connecting...', 'text-jblue');
    showOverlay('Connecting to ' + data.name + '...');
    createPeer();
    if (data.initiator) await makeOffer();
  });

  // WebRTC signaling.
  socket.on('signal', async (data) => {
    if (!peer) createPeer();
    if (data.sdp) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('signal', { sdp: peer.localDescription });
      }
    } else if (data.candidate) {
      try { await peer.addIceCandidate(new RTCIceCandidate(data.candidate)); }
      catch (err) { /* ignore late candidates */ }
    }
  });

  // Session recovery: rebuild the call when a side reconnects.
  socket.on('renegotiate', async (data) => {
    closePeer();
    createPeer();
    setStatus('Reconnecting...', 'text-yellow-400');
    showOverlay('Reconnecting...');
    if (data.initiator) await makeOffer();
  });
  socket.on('partner-waiting', (data) => {
    setStatus('Stranger reconnecting...', 'text-yellow-400');
    showOverlay('Stranger lost connection. Waiting up to ' + (data.seconds || 30) + 's...');
  });
  socket.on('partner-returned', () => setStatus('Reconnecting...', 'text-jblue'));
  socket.on('resumed', () => setStatus('Reconnecting...', 'text-jblue'));

  socket.on('partner-left', () => {
    closePeer();
    showOverlay('Stranger left. Press Next to meet someone new.');
    setStatus('Disconnected', 'text-slate-400');
  });

  socket.on('system', (text) => {
    // Brief on-screen note for rate-limit / report confirmations.
    setStatus(text, 'text-slate-300');
  });

  socket.on('banned', () => { window.location.href = '/banned.html'; });

  // ---- Buttons ----
  document.getElementById('btn-next').addEventListener('click', findStranger);
  document.getElementById('btn-stop').addEventListener('click', () => {
    socket.emit('stop');
    closePeer();
    showOverlay('You have disconnected. Press Next to start again.');
    setStatus('Disconnected', 'text-slate-400');
  });
  document.getElementById('btn-report').addEventListener('click', () => {
    const reason = prompt('Why are you reporting this stranger?') || 'No reason given';
    socket.emit('report', { reason });
  });
  document.getElementById('btn-mute').addEventListener('click', (ev) => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    ev.target.textContent = track.enabled ? 'Mute' : 'Unmute';
  });
  document.getElementById('btn-cam').addEventListener('click', (ev) => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    ev.target.textContent = track.enabled ? 'Camera Off' : 'Camera On';
  });
});
