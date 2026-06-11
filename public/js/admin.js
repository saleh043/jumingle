/* =====================================================================
   admin.js - powers the admin panel (admin.html)
   Logs in with a password, then shows live stats, all-time analytics,
   reports (with an in-memory message log), and bans.
   The password is sent in a header on every request.
   ===================================================================== */

let adminPassword = '';

// ---- Login -----------------------------------------------------------
async function login() {
  const pw = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    adminPassword = pw;
    document.getElementById('login').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    loadEverything();
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

function adminFetch(url, options = {}) {
  options.headers = Object.assign(
    { 'x-admin-password': adminPassword, 'Content-Type': 'application/json' },
    options.headers
  );
  return fetch(url, options);
}

// ---- Load dashboard --------------------------------------------------
async function loadEverything() {
  const stats = await adminFetch('/api/admin/stats').then((r) => r.json());
  setText('stat-online', stats.online);
  setText('stat-chats', stats.activeChats);
  setText('stat-waiting', stats.waiting);
  setText('stat-bans', stats.bans);
  document
    .getElementById('maintenance-badge')
    .classList.toggle('hidden', !stats.maintenance);

  const an = await adminFetch('/api/admin/analytics').then((r) => r.json());
  setText('an-visits', an.total_visits || 0);
  setText('an-started', an.chats_started || 0);
  setText('an-completed', an.chats_completed || 0);
  setText('an-reports', an.reports_submitted || 0);

  // Reports
  const reports = await adminFetch('/api/admin/reports').then((r) => r.json());
  const rBody = document.getElementById('reports-body');
  rBody.innerHTML = '';
  reports.forEach((rep) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-jborder';
    tr.innerHTML =
      '<td class="py-2">' + new Date(rep.created_at).toLocaleString() + '</td>' +
      '<td>' + escapeHtml(rep.reported_name) + '</td>' +
      '<td>' + escapeHtml(rep.reason) + '</td>' +
      '<td>' + (rep.message_count || 0) + '</td>' +
      '<td class="whitespace-nowrap">' +
        '<button class="text-jcyan hover:underline mr-3" data-log="' + rep.id + '">View log</button>' +
        '<button class="text-red-400 hover:underline" data-hash="' + escapeHtml(rep.reported_hash) + '">Ban</button>' +
      '</td>';
    rBody.appendChild(tr);
  });
  rBody.querySelectorAll('button[data-hash]').forEach((btn) => {
    btn.addEventListener('click', () =>
      banVisitor({ ipHash: btn.dataset.hash, reason: 'Banned from report', hours: 24 })
    );
  });
  rBody.querySelectorAll('button[data-log]').forEach((btn) => {
    btn.addEventListener('click', () => viewLog(btn.dataset.log));
  });

  // Bans
  const bans = await adminFetch('/api/admin/bans').then((r) => r.json());
  const bBody = document.getElementById('bans-body');
  bBody.innerHTML = '';
  bans.forEach((ban) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-jborder';
    const expires = ban.permanent ? '-' : new Date(ban.expires_at).toLocaleString();
    tr.innerHTML =
      '<td class="py-2 font-mono text-xs">' + escapeHtml((ban.ip_hash || '').slice(0, 16)) + '...</td>' +
      '<td>' + escapeHtml(ban.reason) + '</td>' +
      '<td>' + (ban.permanent ? 'Permanent' : 'Temporary') + '</td>' +
      '<td>' + expires + '</td>' +
      '<td><button class="text-jblue hover:underline" data-unban="' + escapeHtml(ban.ip_hash) + '">Unban</button></td>';
    bBody.appendChild(tr);
  });
  bBody.querySelectorAll('button[data-unban]').forEach((btn) => {
    btn.addEventListener('click', () => unbanVisitor(btn.dataset.unban));
  });
}

// ---- Report message log ----------------------------------------------
async function viewLog(id) {
  const data = await adminFetch('/api/admin/report-log/' + id).then((r) => r.json());
  const body = document.getElementById('log-body');
  body.innerHTML = '';
  if (!data.messages || !data.messages.length) {
    body.innerHTML = '<p class="text-slate-500">No messages available (server may have restarted).</p>';
  } else {
    data.messages.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'border border-jborder rounded-lg px-3 py-1.5';
      div.innerHTML =
        '<span class="text-jcyan font-medium">' + escapeHtml(m.from) + ':</span> ' +
        '<span>' + escapeHtml(m.text) + '</span>';
      body.appendChild(div);
    });
  }
  document.getElementById('log-modal').classList.remove('hidden');
}

// ---- Ban / unban -----------------------------------------------------
async function banVisitor(payload) {
  await adminFetch('/api/admin/ban', { method: 'POST', body: JSON.stringify(payload) });
  loadEverything();
}
async function unbanVisitor(ipHash) {
  await adminFetch('/api/admin/unban', { method: 'POST', body: JSON.stringify({ ipHash }) });
  loadEverything();
}

// ---- Helpers ---------------------------------------------------------
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number(val || 0).toLocaleString();
}
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---- Wire up buttons -------------------------------------------------
document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('refresh').addEventListener('click', loadEverything);
document.getElementById('log-close').addEventListener('click', () =>
  document.getElementById('log-modal').classList.add('hidden')
);
document.getElementById('ban-btn').addEventListener('click', () => {
  const value = document.getElementById('ban-ip').value.trim();
  const reason = document.getElementById('ban-reason').value.trim();
  const hours = Number(document.getElementById('ban-duration').value);
  if (!value) return;
  // A 64-char hex string is an IP hash; anything else is treated as a raw IP.
  const isHash = /^[a-f0-9]{64}$/i.test(value);
  banVisitor({
    [isHash ? 'ipHash' : 'ip']: value,
    reason,
    hours,
    permanent: hours === 0,
  });
});
