/* =====================================================================
   chat.js - powers the text chat page (text-chat.html)
   ---------------------------------------------------------------------
   Waits for the `jumingle:ready` event from session.js (fired after the
   nickname modal), then connects to the server over Socket.IO. The
   server pairs us with a stranger and relays messages both ways.
   ===================================================================== */

const statusEl = document.getElementById('status');
const messagesEl = document.querySelector('#messages > div');
const inputEl = document.getElementById('input');
const typingEl = document.getElementById('typing');

let socket = null;
let matched = false;
let interests = [];
let typingTimer = null;
let typingHideTimer = null;

// ---- UI helpers ------------------------------------------------------
function addMessage(who, text) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-' + who;
  div.textContent = text; // textContent => no HTML injection (XSS-safe)
  messagesEl.appendChild(div);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
}
function setStatus(text, colorClass) {
  statusEl.textContent = text;
  statusEl.className = 'text-sm font-medium ' + (colorClass || 'text-slate-400');
}
function showTyping() {
  typingEl.classList.remove('hidden');
  clearTimeout(typingHideTimer);
  typingHideTimer = setTimeout(() => typingEl.classList.add('hidden'), 3000);
}

// ---- Find / Next -----------------------------------------------------
function findStranger() {
  matched = false;
  messagesEl.innerHTML = '';
  typingEl.classList.add('hidden');
  addMessage('system', 'Looking for someone to chat with...');
  setStatus('Searching...', 'text-jblue');
  socket.emit('find', { mode: 'text', interests });
}

// ---- Start everything once the nickname is set -----------------------
document.addEventListener('jumingle:ready', (e) => {
  interests = e.detail.interests || [];

  socket = io({
    auth: { sessionId: e.detail.sessionId, nickname: e.detail.nickname },
  });

  // --- Server events ---
  socket.on('welcome', () => findStranger());

  socket.on('waiting', () => setStatus('Searching...', 'text-jblue'));

  socket.on('matched', (data) => {
    matched = true;
    messagesEl.innerHTML = '';
    addMessage('system', "You're now chatting with " + data.name + '. Say hi!');
    setStatus('Connected', 'text-jgreen');
    inputEl.focus();
  });

  socket.on('message', (data) => {
    typingEl.classList.add('hidden');
    addMessage('stranger', data.text);
  });

  socket.on('typing', showTyping);

  // Session recovery: partner dropped but may return within ~30s.
  socket.on('partner-waiting', (data) => {
    setStatus('Stranger reconnecting...', 'text-yellow-400');
    addMessage('system',
      'Stranger lost connection. Waiting up to ' + (data.seconds || 30) + 's for them to return...');
  });
  socket.on('partner-returned', () => {
    matched = true;
    setStatus('Connected', 'text-jgreen');
    addMessage('system', 'Stranger reconnected. You can keep chatting.');
  });
  // We reconnected and resumed our own session.
  socket.on('resumed', (data) => {
    matched = true;
    setStatus('Connected', 'text-jgreen');
    addMessage('system', 'Reconnected to your chat with ' + (data.name || 'the stranger') + '.');
  });

  socket.on('partner-left', () => {
    matched = false;
    typingEl.classList.add('hidden');
    addMessage('system', 'Stranger has disconnected. Press Next to find someone new.');
    setStatus('Disconnected', 'text-slate-400');
  });

  socket.on('system', (text) => addMessage('system', text));

  socket.on('banned', showBanned);

  // --- Buttons ---
  document.getElementById('btn-send').addEventListener('click', sendMessage);
  document.getElementById('btn-next').addEventListener('click', findStranger);
  document.getElementById('btn-stop').addEventListener('click', () => {
    socket.emit('stop');
    matched = false;
    addMessage('system', 'You have disconnected.');
    setStatus('Disconnected', 'text-slate-400');
  });
  document.getElementById('btn-report').addEventListener('click', () => {
    if (!matched) return;
    const reason = prompt('Why are you reporting this stranger?') || 'No reason given';
    socket.emit('report', { reason });
  });

  // --- Keyboard + typing indicator ---
  inputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); sendMessage(); }
  });
  inputEl.addEventListener('input', () => {
    if (!matched) return;
    clearTimeout(typingTimer);
    socket.emit('typing');
    typingTimer = setTimeout(() => {}, 800);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') findStranger();
  });
});

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || !matched) return;
  addMessage('you', text);
  socket.emit('message', text);
  inputEl.value = '';
}

function showBanned() {
  window.location.href = '/banned.html';
}
