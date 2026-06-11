# Jumingle 🌴📷

A modern, **anonymous text & video chat platform** (Omegle / Uhmegle style),
built to stay **simple enough for one developer** to run and maintain — a single
Node.js server, Socket.IO, WebRTC, and SQLite. No React, no build step, no Redis,
no microservices.

---

## ✨ What's included

- **Anonymous text & video chat** with real-time messaging (Socket.IO).
- **WebRTC video** (peer-to-peer) with local preview, **TURN-ready** via env vars.
- **Queue-based matchmaking** that prefers shared **interests**, falls back to random.
- **Nickname modal** before chatting — validated and **session-only** (sessionStorage).
- **Session recovery**: reconnect within ~30s and resume the same conversation.
- **Reporting**: stores only **metadata in SQLite** + the **last 10 messages in memory**.
- **Ban system**: temporary or permanent, keyed by a **hashed IP** (raw IPs are never stored).
- **Basic analytics** in SQLite: visits, chats started/completed, reports submitted, live online.
- **Security middleware**: rate limiting, input sanitization, XSS protection, socket
  abuse prevention, security headers, and a **maintenance mode** switch.
- **Modern dark, responsive UI** with TailwindCSS (CDN only).
- Full set of pages: home, text chat, video chat, admin, privacy, terms, about,
  contact, support, banned, maintenance.

---

## 📁 Project structure

```
jumingle/
├── server.js              ← entry point: wires middleware, routes & sockets
├── config.js              ← all settings, read from environment variables
├── .env.example           ← copy to .env for local development
├── services/              ← business logic
│   ├── database.js        ← SQLite setup + prepared statements
│   ├── matchmaking.js     ← queue pairing + session recovery (in memory)
│   ├── sockets.js         ← all Socket.IO event handling
│   ├── reports.js         ← report metadata (DB) + last-10 messages (memory)
│   ├── bans.js            ← IP hashing + temporary/permanent bans
│   └── analytics.js       ← simple SQLite counters
├── middleware/
│   ├── security.js        ← security headers, sanitize, escapeHtml
│   ├── rateLimit.js       ← HTTP limiter + socket sliding-window limiter
│   ├── maintenance.js     ← maintenance-mode gate
│   └── adminAuth.js       ← password protection for the admin API
├── assets/                ← logo.svg + favicon.svg (webcam + palm tree)
├── public/                ← everything the browser loads
│   ├── index.html         ← homepage (hero, features, how-it-works, Discord…)
│   ├── text-chat.html · video-chat.html · admin.html
│   ├── privacy.html · terms.html · about.html · contact.html · support.html
│   ├── banned.html · maintenance.html
│   ├── css/style.css
│   └── js/  main.js · session.js · chat.js · video.js · admin.js
├── database/              ← database.db is created here on first run (gitignored)
└── logs/                  ← reserved for log output (gitignored)
```

---

## 🚀 Run it locally

Requires **Node.js 18+**.

```bash
npm install            # express, socket.io, better-sqlite3
cp .env.example .env   # then edit .env (set ADMIN_PASSWORD, IP_HASH_SALT)
npm start              # http://localhost:3000
```

> 💡 To test chat you need **two** browser tabs/windows — each becomes a different
> "stranger". Video chat also needs HTTPS in production (see below).

---

## ⚙️ Environment variables

Everything is configured through env vars (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on. |
| `NODE_ENV` | `development` | Environment label. |
| `TRUST_PROXY` | `true` | Honour `X-Forwarded-For` behind Render/Nginx. |
| `ADMIN_PASSWORD` | `changeme123` | **Change this.** Admin panel password. |
| `IP_HASH_SALT` | (placeholder) | **Change this.** Salt for hashing IPs. Keep stable. |
| `MAINTENANCE_MODE` | `false` | When `true`, shows the maintenance page to everyone. |
| `DEFAULT_BAN_HOURS` | `24` | Length of a temporary ban. |
| `SESSION_RECOVERY_MS` | `30000` | Reconnect window (ms) to resume a chat. |
| `MAX_INTERESTS` | `5` | Max interests considered for matching. |
| `MAX_MESSAGE_LENGTH` | `1000` | Max chars per message. |
| `MSG_RATE_MAX` / `MSG_RATE_WINDOW_MS` | `8` / `10000` | Anti-spam message limit. |
| `FIND_RATE_MAX` / `FIND_RATE_WINDOW_MS` | `30` / `10000` | "Next" press limit. |
| `REPORT_LOG_SIZE` | `10` | Messages kept in memory per report. |
| `STUN_URLS` | Google STUN | Comma-separated STUN urls. |
| `TURN_URLS` | (empty) | Comma-separated TURN urls (needed on strict networks). |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | (empty) | TURN credentials. |
| `DISCORD_URL` | `#` | Community link used on the homepage/contact. |
| `CONTACT_EMAIL` | `support@example.com` | Shown on the contact page. |

---

## 🔐 Admin panel

Visit **`/admin.html`**, log in with `ADMIN_PASSWORD`. You get:

- **Live**: users online, active chats, queue size, active bans.
- **All-time analytics**: visits, chats started/completed, reports submitted.
- **Reports**: reason + reported nickname, a **"View log"** button (the last 10
  messages, held in memory only), and a one-click **Ban**.
- **Bans**: list of active temporary/permanent bans with **Unban**.
- **Manual ban**: by hashed IP (from a report) or by raw IP, with a duration picker.

---

## 🎥 WebRTC & TURN (important for production)

Video is peer-to-peer; the server only relays small "signal" messages. The ICE
server list is sent to the browser from `/api/config`, built from your env vars.

1. **HTTPS is required.** Browsers block camera/mic on plain `http://` (except
   `localhost`). Use Caddy (auto-HTTPS) or Nginx + Let's Encrypt.
2. **Add a TURN server** so users on strict networks can connect. A hosted TURN
   service (Twilio, Metered) or your own `coturn` works. Then set:
   ```
   TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
   TURN_USERNAME=youruser
   TURN_CREDENTIAL=yoursecret
   ```

---

## 🌍 Deployment

### Render

1. Push this repo to GitHub and create a **Web Service** on Render.
2. **Build command:** `npm install` — **Start command:** `npm start`.
3. Add the environment variables above (at least `ADMIN_PASSWORD` and
   `IP_HASH_SALT`). `TRUST_PROXY` should stay `true`.
4. SQLite writes to the local disk. For data that survives deploys, attach a
   **Render Disk** mounted at the project's `database/` folder.

### VPS (Ubuntu example)

```bash
git clone <your-repo> && cd jumingle
npm install
cp .env.example .env   # edit it (ADMIN_PASSWORD, IP_HASH_SALT, TURN_*)
# keep it alive with pm2:
npm i -g pm2
pm2 start server.js --name jumingle
pm2 save
```

Put **Caddy or Nginx** in front for HTTPS, then point it at `http://localhost:3000`.

---

## 🛡️ Security notes

- Raw IPs are **never stored** — only a salted SHA-256 hash (set a strong, stable
  `IP_HASH_SALT`).
- User text is sanitized (control chars stripped, length-clamped) and always
  rendered with `textContent` / escaped HTML to prevent XSS.
- Per-connection rate limits guard against message and "Next" spam; HTTP routes
  have their own limiter.
- Admin password is compared in constant time.

## 🛑 Before you launch publicly

Random-stranger video chat has a serious safety history. The tools here (18+ gate,
reports, bans, rate limits, hashed IPs) are a **foundation, not a guarantee**.
Before a public launch, seriously consider real age verification, live moderation,
a fast path to act on reports, image/stream safety tooling, and a legal review for
your jurisdiction. Start small and private, and add moderation before you grow.

---

Every file is heavily commented — open any of them and read top to bottom. 🌴
