# Jumingle 🌴📷

A lightweight, anonymous **text & video chat with strangers** (Omegle / Uhmegle style).
Built to be read and edited by **one developer with basic programming knowledge** — plain
HTML/CSS/JS on the front end, a single `server.js` on the back end. No React, no build step.

---

## What's inside

```
JUMINGLE/
├── server.js            ← the ONLY backend file (Express + Socket.IO + SQLite)
├── package.json
├── database/            ← database.db is created here automatically on first run
└── public/              ← everything the browser loads
    ├── index.html       ← homepage
    ├── text-chat.html   ← text chat
    ├── video-chat.html  ← video chat (WebRTC)
    ├── admin.html       ← hidden admin panel  (/admin.html)
    ├── privacy.html
    ├── terms.html
    ├── logo.svg         ← palm-tree + webcam logo (also the favicon)
    ├── favicon.svg
    ├── css/style.css
    └── js/
        ├── main.js      ← homepage
        ├── chat.js      ← text chat
        ├── video.js     ← video chat / WebRTC
        └── admin.js     ← admin panel
```

---

## 1. Requirements

- **Node.js 18 or newer** (download from nodejs.org).
- Because the database (`better-sqlite3`) is a small native module, the first
  `npm install` may compile it. On most systems this just works. If it complains,
  install build tools first:
  - **Windows:** `npm install --global windows-build-tools` (or install "Desktop
    development with C++" in Visual Studio).
  - **Mac:** `xcode-select --install`
  - **Ubuntu/Debian:** `sudo apt-get install -y build-essential python3`

## 2. Run it on your computer

```bash
cd JUMINGLE
npm install        # downloads express, socket.io, better-sqlite3
npm start          # starts the server
```

Then open **http://localhost:3000** in your browser.

> 💡 To test video chat you need **two** browser tabs/windows (or two devices).
> Each one becomes a different "stranger".

## 3. The admin panel

Go to **http://localhost:3000/admin.html**.

- Default password is `changeme123`.
- **Change it!** Set an environment variable before starting:
  ```bash
  ADMIN_PASSWORD="your-strong-password" npm start
  ```
- The admin page shows users online, active chats, reports, and bans, and lets you
  ban / unban an IP address.

## 4. Settings you can change

Open `server.js` and look at the **SETTINGS** section near the top:

| Setting | What it does |
|---|---|
| `PORT` | Which port the server runs on (default 3000). |
| `ADMIN_PASSWORD` | Admin panel password. |
| `BAN_HOURS` | How long an IP ban lasts. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Anti-spam message limit. |
| `BAD_WORDS` | Words the profanity filter replaces with `****`. |

---

## 5. Putting it online (deployment)

You need a host that runs Node.js (a small VPS, Render, Railway, Fly.io, etc.).

A simple recipe on a Linux VPS:

```bash
# on the server
git clone <your repo>   # or upload the JUMINGLE folder
cd JUMINGLE
npm install
ADMIN_PASSWORD="strong-pw" PORT=3000 npm start
```

Then put **Nginx (or Caddy)** in front of it for HTTPS.

### ⚠️ Two things video chat MUST have in production

1. **HTTPS is required.** Browsers refuse camera/microphone access on plain `http://`
   (except `localhost`). Use a free certificate (Caddy does this automatically, or use
   Let's Encrypt with Nginx).
2. **A TURN server.** The free Google STUN server in `js/video.js` is enough for many
   connections, but some users behind strict networks won't connect without a **TURN**
   server. The easiest path is a hosted TURN service (e.g. Twilio, Metered, or your own
   `coturn`). Add it to `rtcConfig` in `public/js/video.js`:
   ```js
   const rtcConfig = { iceServers: [
     { urls: 'stun:stun.l.google.com:19302' },
     { urls: 'turn:YOUR_TURN_HOST:3478', username: 'user', credential: 'pass' }
   ] };
   ```

### Keep it running
Use a process manager so it restarts on crash/reboot:
```bash
npm install --global pm2
pm2 start server.js --name jumingle
pm2 save
```

---

## 6. Please read this before launching publicly 🛑

This kind of "random stranger video chat" is genuinely useful, but the category has a
**serious, well-documented safety history** — Omegle itself shut down in 2023 largely
because of abuse, including harm to minors. If you open this to the public, you are taking
on real responsibility (and in many places, legal liability). The starter safety features
here are a **foundation, not enough on their own**:

- ✅ Included: 18+ confirmation gate, report button, profanity filter, message rate limit,
  IP ban system, basic Terms/Privacy templates.
- ⚠️ Strongly consider before a public launch:
  - **Real age verification** (a checkbox is not enough for a video platform).
  - **Live moderation** and a fast way to act on reports (e.g. auto-suspend an IP after
    several reports).
  - A clear, monitored way for users to report illegal content, and a process to preserve
    evidence and contact authorities when required.
  - Reviewing your **legal obligations** (age, content, data) with a lawyer for the
    countries you operate in. The included Privacy/Terms pages are placeholders.
  - Image/stream safety tooling if you scale up.

Building it is fine; launching it responsibly is the hard part. Start small and private,
and add moderation before you grow.

---

## 7. How it works (quick tour for editing)

- **Matchmaking** lives in `server.js` (`findMatch`). Users join a `waiting` queue; the
  server pairs two people of the same mode (text/video), preferring a shared interest.
- **Text messages** are relayed by the server (`message` event).
- **Video** uses **WebRTC**: the server only passes small "signal" messages between the
  two browsers (`signal` event); the actual video goes directly browser-to-browser.
- **Reports & bans** are stored in SQLite and shown in the admin panel.

Every function is commented — open any file and read top to bottom. Have fun! 🌴
