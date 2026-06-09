/* =====================================================================
   main.js - powers the homepage (index.html)
   Two jobs: (1) show the live online counter, (2) start a chat.
   ===================================================================== */

// (1) Ask the server how many people are online, every 5 seconds.
function updateOnlineCount() {
  fetch('/api/online')
    .then(res => res.json())
    .then(data => {
      document.getElementById('online-count').textContent = data.online.toLocaleString();
    })
    .catch(() => { /* ignore network hiccups */ });
}
updateOnlineCount();              // run once right away
setInterval(updateOnlineCount, 5000); // then keep it fresh

// (2) When a Start button is clicked, save the typed interests and
//     send the user to the matching chat page.
function startChat(page) {
  const raw = document.getElementById('interests').value;
  // Turn "music, gaming" into a clean list ["music","gaming"].
  const interests = raw.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
  // Save it so the chat page can read it after we navigate.
  localStorage.setItem('jumingle_interests', JSON.stringify(interests));
  window.location.href = page;
}

document.getElementById('start-text').addEventListener('click', () => startChat('/text-chat.html'));
document.getElementById('start-video').addEventListener('click', () => startChat('/video-chat.html'));
