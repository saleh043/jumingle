/* =====================================================================
   admin.js - powers the admin panel (admin.html)
   Logs in with a password, then shows live stats, reports and bans.
   The password is sent in a header on every request to the server.
   ===================================================================== */

let adminPassword = '';   // remembered after a successful login

// ---- Log in ----
async function login() {
  const pw = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  });
  if (res.ok) {
    adminPassword = pw;                                   // remember it
    document.getElementById('login').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    loadEverything();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

// Helper: a fetch that always includes the admin password header.
function adminFetch(url, options = {}) {
  options.headers = Object.assign({ 'x-admin-password': adminPassword, 'Content-Type': 'application/json' }, options.headers);
  return fetch(url, options);
}

// ---- Load all dashboard data ----
async function loadEverything() {
  // Stats
  const stats = await adminFetch('/api/admin/stats').then(r => r.json());
  document.getElementById('stat-online').textContent  = stats.online;
  document.getElementById('stat-chats').textContent   = stats.activeChats;
  document.getElementById('stat-reports').textContent = stats.reports;
  document.getElementById('stat-bans').textContent    = stats.bans;

  // Reports table
  const reports = await adminFetch('/api/admin/reports').then(r => r.json());
  const rBody = document.getElementById('reports-body');
  rBody.innerHTML = '';
  reports.forEach(rep => {
    const tr = document.createElement('tr');
    tr.className = 'border-b';
    tr.innerHTML =
      '<td class="py-2">' + new Date(rep.created_at).toLocaleString() + '</td>' +
      '<td>' + escapeHtml(rep.reported_name) + '</td>' +
      '<td>' + escapeHtml(rep.reported_ip) + '</td>' +
      '<td>' + escapeHtml(rep.reason) + '</td>' +
      '<td><button class="text-red-500 hover:underline" data-ip="' + escapeHtml(rep.reported_ip) + '">Ban</button></td>';
    rBody.appendChild(tr);
  });
  // Wire up the "Ban" buttons inside the reports table.
  rBody.querySelectorAll('button[data-ip]').forEach(btn => {
    btn.addEventListener('click', () => banIp(btn.dataset.ip, 'Banned from report'));
  });

  // Bans table
  const bans = await adminFetch('/api/admin/bans').then(r => r.json());
  const bBody = document.getElementById('bans-body');
  bBody.innerHTML = '';
  bans.forEach(ban => {
    const tr = document.createElement('tr');
    tr.className = 'border-b';
    tr.innerHTML =
      '<td class="py-2">' + escapeHtml(ban.ip) + '</td>' +
      '<td>' + escapeHtml(ban.reason) + '</td>' +
      '<td>' + new Date(ban.expires_at).toLocaleString() + '</td>' +
      '<td><button class="text-jblue hover:underline" data-unban="' + escapeHtml(ban.ip) + '">Unban</button></td>';
    bBody.appendChild(tr);
  });
  bBody.querySelectorAll('button[data-unban]').forEach(btn => {
    btn.addEventListener('click', () => unbanIp(btn.dataset.unban));
  });
}

// ---- Ban / unban actions ----
async function banIp(ip, reason) {
  if (!ip) return;
  await adminFetch('/api/admin/ban', { method: 'POST', body: JSON.stringify({ ip, reason }) });
  loadEverything();
}
async function unbanIp(ip) {
  await adminFetch('/api/admin/unban', { method: 'POST', body: JSON.stringify({ ip }) });
  loadEverything();
}

// Stop any nasty HTML from reports showing up as real HTML (safety).
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- Hook up the buttons ----
document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('refresh').addEventListener('click', loadEverything);
document.getElementById('ban-btn').addEventListener('click', () => {
  banIp(document.getElementById('ban-ip').value.trim(), document.getElementById('ban-reason').value.trim());
});
