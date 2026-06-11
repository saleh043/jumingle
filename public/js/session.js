/* =====================================================================
   session.js - shared by text-chat.html and video-chat.html
   ---------------------------------------------------------------------
   Handles two things every chat page needs BEFORE connecting:

     1. A NICKNAME modal (with 18+ confirmation and validation). The
        nickname is stored in sessionStorage only - it disappears when
        the tab closes (session-only storage).

     2. A stable SESSION ID kept in sessionStorage. It lets the server
        recover your conversation if your connection briefly drops
        (session recovery within ~30 seconds).

   When the user is ready, this file fires a `jumingle:ready` event with
   { nickname, sessionId, interests }. The page's own script (chat.js /
   video.js) listens for it and opens the Socket.IO connection.
   ===================================================================== */

(function () {
  const NICK_KEY = 'jumingle_nick';
  const SID_KEY = 'jumingle_sid';

  // --- Session id (create once per tab session) ---
  function getSessionId() {
    let sid = sessionStorage.getItem(SID_KEY);
    if (!sid) {
      sid = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SID_KEY, sid);
    }
    return sid;
  }

  // --- Nickname validation: 2-20 chars, letters/numbers/space/_/- ---
  function isValidNick(name) {
    return /^[A-Za-z0-9 _-]{2,20}$/.test((name || '').trim());
  }

  // --- Interests carried over from the homepage ---
  function getInterests() {
    try {
      return JSON.parse(localStorage.getItem('jumingle_interests') || '[]');
    } catch (e) {
      return [];
    }
  }

  function fireReady(nickname) {
    document.dispatchEvent(
      new CustomEvent('jumingle:ready', {
        detail: {
          nickname: nickname,
          sessionId: getSessionId(),
          interests: getInterests(),
        },
      })
    );
  }

  // --- Wire up the modal once the page is parsed ---
  document.addEventListener('DOMContentLoaded', function () {
    const gate = document.getElementById('nick-gate');
    const form = document.getElementById('nick-form');
    const input = document.getElementById('nick-input');
    const error = document.getElementById('nick-error');
    const agree = document.getElementById('nick-agree');

    // Already have a nickname this session? Skip straight in.
    const existing = sessionStorage.getItem(NICK_KEY);
    if (existing && isValidNick(existing)) {
      if (gate) gate.style.display = 'none';
      fireReady(existing);
      return;
    }

    if (!form) return; // page has no modal (shouldn't happen)

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const name = (input.value || '').trim();
      if (!isValidNick(name)) {
        error.textContent =
          'Nickname must be 2-20 characters (letters, numbers, spaces, - or _).';
        error.classList.remove('hidden');
        return;
      }
      if (agree && !agree.checked) {
        error.textContent = 'Please confirm you are 18 or older.';
        error.classList.remove('hidden');
        return;
      }
      error.classList.add('hidden');
      sessionStorage.setItem(NICK_KEY, name);
      gate.style.display = 'none';
      fireReady(name);
    });
  });

  // Expose a couple of helpers for the page scripts.
  window.JumingleSession = { getSessionId, isValidNick, getInterests };
})();
