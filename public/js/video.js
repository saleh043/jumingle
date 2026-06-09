/* =====================================================================
   video.js - powers the video chat page (video-chat.html)

   How video chat works in plain words:
     - Your camera/microphone become a "local stream".
     - The server pairs you with a stranger and tells ONE of you to be
       the "initiator".
     - The two browsers swap a few small messages (called "signals")
       through the server so they can connect directly to each other.
     - After that, video flows browser-to-browser (peer-to-peer) using
       WebRTC. The server does NOT see your video.
   ===================================================================== */

// ---- Page elements ----
const statusEl    = document.getElementById('status');
const localVideo  = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const overlay     = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const ageGate     = document.getElementById('age-gate');

// ---- Interests from the homepage ----
const interests = JSON.parse(localStorage.getItem('jumingle_interests') || '[]');

// ---- Connect to the server ----
const socket = io();

// ---- WebRTC variables ----
// A STUN server helps two browsers discover how to reach each other.
// (For users behind strict firewalls you would also add a TURN server.)
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let peer = null;          // the RTCPeerConnection
let localStream = null;   // our camera + mic
let tracksAdded = false;  // have we attached our camera to the connection yet?

// =====================================================================
// Small helpers
// =====================================================================
function setStatus(text, colorClass) {
  statusEl.textContent = text;
  statusEl.className = 'text-sm font-medium ' + (colorClass || 'text-gray-500');
}
function showOverlay(text) {
  overlayText.textContent = text;
  overlay.style.display = 'flex';
}
function hideOverlay() {
  overlay.style.display = 'none';
}

// Turn on the camera and microphone (asked once).
async function startCamera() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

// Build a fresh peer connection and attach our camera to it.
function createPeer() {
  peer = new RTCPeerConnection(rtcConfig);
  tracksAdded = false;

  // Send our ICE candidates (network info) to the stranger via the server.
  peer.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal', { candidate: e.candidate });
  };

  // When the stranger's video arrives, show it.
  peer.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    hideOverlay();
    setStatus('Connected', 'text-jgreen');
  };

  // Attach our own camera/mic to the connection.
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  tracksAdded = true;
}

// Close the current call cleanly.
function closePeer() {
  if (peer) { peer.close(); peer = null; }
  remoteVideo.srcObject = null;
  tracksAdded = false;
}

// Ask the server for a new stranger.
function findStranger() {
  closePeer();
  showOverlay('Searching for stranger...');
  setStatus('Searching...', 'text-jblue');
  socket.emit('find', { mode: 'video', interests });
}

// =====================================================================
// Socket events
// =====================================================================
socket.on('waiting', () => {
  showOverlay('Searching for stranger...');
  setStatus('Searching...', 'text-jblue');
});

socket.on('matched', async (data) => {
  setStatus('Stranger found - connecting...', 'text-jblue');
  createPeer();
  // The "initiator" makes the first offer; the other side just waits.
  if (data.initiator) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('signal', { sdp: peer.localDescription });
  }
});

// Handle the small connection messages from the stranger.
socket.on('signal', async (data) => {
  if (!peer) createPeer(); // safety: make a peer if we somehow don't have one

  if (data.sdp) {
    await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
    // If we received an "offer", we must reply with an "answer".
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

socket.on('partner-left', () => {
  closePeer();
  showOverlay('Stranger left. Press Next to meet someone new.');
  setStatus('Disconnected', 'text-gray-500');
});

socket.on('banned', () => {
  document.body.innerHTML =
    '<div class="h-screen flex items-center justify-center text-center p-6">' +
    '<div><h1 class="text-2xl font-bold text-jdark">Access blocked</h1>' +
    '<p class="text-gray-500 mt-2">Your access has been temporarily restricted.</p></div></div>';
});

// =====================================================================
// Buttons
// =====================================================================
document.getElementById('btn-next').addEventListener('click', findStranger);

document.getElementById('btn-stop').addEventListener('click', () => {
  socket.emit('stop');
  closePeer();
  showOverlay('You have disconnected. Press Next to start again.');
  setStatus('Disconnected', 'text-gray-500');
});

document.getElementById('btn-report').addEventListener('click', () => {
  const reason = prompt('Why are you reporting this stranger?') || 'No reason given';
  socket.emit('report', { reason });
});

// Mute / unmute our microphone.
document.getElementById('btn-mute').addEventListener('click', (e) => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? 'Mute' : 'Unmute';
});

// Turn our camera on / off.
document.getElementById('btn-cam').addEventListener('click', (e) => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? 'Camera Off' : 'Camera On';
});

// =====================================================================
// Age gate + camera permission, then start searching
// =====================================================================
async function passedAgeGate() {
  ageGate.style.display = 'none';
  localStorage.setItem('jumingle_age_ok', 'yes');
  try {
    await startCamera();   // ask for camera/mic
    findStranger();        // then look for a partner
  } catch (err) {
    showOverlay('Camera/microphone access was blocked. Please allow it and reload.');
  }
}
document.getElementById('age-ok').addEventListener('click', passedAgeGate);

// If they already confirmed age before, still need camera permission now.
if (localStorage.getItem('jumingle_age_ok') === 'yes') {
  passedAgeGate();
}
