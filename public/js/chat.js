/* =====================================================================
   chat.js - powers the text chat page (text-chat.html)
   Talks to the server over Socket.IO. The server pairs us with a
   stranger and passes messages back and forth.
   ===================================================================== */

// ---- Grab the page elements we need ----
const statusEl   = document.getElementById('status');
const messagesEl = document.querySelector('#messages > div');
const inputEl    = document.getElementById('input');
const ageGate    = document.getElementById('age-gate');

// ---- Read the interests the user typed on the homepage ----
const interests = JSON.parse(localStorage.getItem('jumingle_interests') || '[]');

// ---- Connect to the server ----
const socket = io();
let matched = false;   // are we currently talking to a stranger?

// =====================================================================
// Helper functions for showing things on screen
// =====================================================================

// Add a chat bubble. who = 'you' | 'stranger' | 'system'
function addMessage(who, text) {
  const div = document.createElement('div');
  div.className = 'bubble bubble-' + who;
  div.textContent = text;
  messagesEl.appendChild(div);
  // Always scroll to the newest message.
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
}

// Update the small status line at the top.
function setStatus(text, colorClass) {
  statusEl.textContent = text;
  statusEl.className = 'text-sm font-medium ' + (colorClass || 'text-gray-500');
}

// Ask the server to find a new stranger.
function findStranger() {
  matched = false;
  messagesEl.innerHTML = '';                 // clear old conversation
  addMessage('system', 'Looking for someone to chat with...');
  setStatus('Searching...', 'text-jblue');
  socket.emit('find', { mode: 'text', interests });
}

// =====================================================================
// Socket events (messages coming FROM the server)
// =====================================================================

socket.on('welcome', () => {
  // We are connected to the server. Wait for the age gate before searching.
});

socket.on('waiting', () => {
  setStatus('Searching...', 'text-jblue');
});

socket.on('matched', (data) => {
  matched = true;
  messagesEl.innerHTML = '';
  addMessage('system', "You're now chatting with a stranger (" + data.name + "). Say hi!");
  setStatus('Connected', 'text-jgreen');
  inputEl.focus();
});

socket.on('message', (data) => {
  addMessage('stranger', data.text);
});

socket.on('partner-left', () => {
  matched = false;
  addMessage('system', 'Stranger has disconnected. Press Next to find someone new.');
  setStatus('Disconnected', 'text-gray-500');
});

socket.on('system', (text) => {
  addMessage('system', text);
});

socket.on('banned', () => {
  document.body.innerHTML =
    '<div class="h-screen flex items-center justify-center text-center p-6">' +
    '<div><h1 class="text-2xl font-bold text-jdark">Access blocked</h1>' +
    '<p class="text-gray-500 mt-2">Your access has been temporarily restricted.</p></div></div>';
});

// =====================================================================
// Sending messages and using the buttons
// =====================================================================

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || !matched) return;
  addMessage('you', text);          // show my own message immediately
  socket.emit('message', text);     // send it to the stranger
  inputEl.value = '';
}

document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('btn-next').addEventListener('click', findStranger);

document.getElementById('btn-stop').addEventListener('click', () => {
  socket.emit('stop');
  matched = false;
  addMessage('system', 'You have disconnected.');
  setStatus('Disconnected', 'text-gray-500');
});

document.getElementById('btn-report').addEventListener('click', () => {
  if (!matched) return;
  const reason = prompt('Why are you reporting this stranger?') || 'No reason given';
  socket.emit('report', { reason });
});

// ---- Keyboard shortcuts: Enter = send, ESC = next ----
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') findStranger();
});

// =====================================================================
// Age gate: only start searching after the user confirms they are 18+
// =====================================================================
function passedAgeGate() {
  ageGate.style.display = 'none';
  localStorage.setItem('jumingle_age_ok', 'yes');
  findStranger();
}
document.getElementById('age-ok').addEventListener('click', passedAgeGate);

// If they already confirmed earlier, skip the popup.
if (localStorage.getItem('jumingle_age_ok') === 'yes') {
  passedAgeGate();
}
