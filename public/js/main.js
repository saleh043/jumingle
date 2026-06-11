/* =====================================================================
   main.js - powers the homepage (index.html)
   Jobs: (1) live online counter, (2) Discord link from server config,
   (3) save interests and go to the chosen chat page.
   ===================================================================== */

// (1) Live online counter, refreshed every 5 seconds.
function updateOnlineCount() {
  fetch('/api/online')
    .then((res) => res.json())
    .then((data) => {
      const el = document.getElementById('online-count');
      if (el) el.textContent = Number(data.online || 0).toLocaleString();
    })
    .catch(() => {});
}
updateOnlineCount();
setInterval(updateOnlineCount, 5000);

// (2) Pull the Discord link (and other config) from the server.
fetch('/api/config')
  .then((res) => res.json())
  .then((cfg) => {
    const link = document.getElementById('discord-link');
    if (link && cfg.discordUrl && cfg.discordUrl !== '#') {
      link.href = cfg.discordUrl;
    }
  })
  .catch(() => {});

// (3) Save interests, then navigate to the chosen chat page.
function startChat(page) {
  const raw = document.getElementById('interests').value || '';
  const interests = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .slice(0, 5);
  localStorage.setItem('jumingle_interests', JSON.stringify(interests));
  window.location.href = page;
}

document.getElementById('start-text')
  .addEventListener('click', () => startChat('/text-chat.html'));
document.getElementById('start-video')
  .addEventListener('click', () => startChat('/video-chat.html'));
