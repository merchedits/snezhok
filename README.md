# 🌸 Snezhok (Снежок)

A private, self-hosted web messenger for a small group of friends (up to 10 users). Features cozy real-time messaging, file sharing (up to 100MB), inline media previews, emoji reactions, and browser-native peer-to-peer voice calls.

## Features

- **Global group chat** — Single room for up to 10 people with message grouping, inline code, and link previews
- **WebRTC voice calls** — Fully peer-to-peer mesh topology (LAN/WAN), optional TURN server for NAT traversal
- **File uploads** — Up to 100MB (images, audio, video, documents) with inline image previews and download cards
- **Emoji reactions** — Quick-react to any message with ❤️ 👍 😂 😮 😢 🎉
- **Presence & typing** — See who's online, who's typing, who's speaking
- **Dark mode** — Warm, pastel-toned dark theme with smooth transitions
- **Invite-only** — Closed registration with invite codes (first user becomes admin)
- **Zero telemetry** — No CDNs, no tracking. Voice can run with no external STUN/TURN servers when peers can reach each other directly.

## Architecture

- **Frontend**: React 19 · Vite 6 · Zustand · Socket.io-client · simple-peer · Vanilla CSS
- **Backend**: Node.js 22 · Fastify 5 · Socket.io 4 · SQLite · Drizzle ORM · bcrypt
- **Infrastructure**: Docker Compose · Caddy (reverse proxy + auto HTTPS) · coturn (optional TURN)

---

## Quick Start (Development)

### Prerequisites

- Node.js 22+ (LTS)
- npm 10+

### 1. Install Dependencies

```bash
npm install
```

> **Note (Windows)**: If `better-sqlite3` fails to compile natively, run `npm install --ignore-scripts`. The frontend dev server and Drizzle migrations will still work. The backend runs in Docker where prebuilt binaries are available.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong `SESSION_SECRET`. The default invite code is `COZY_SNEZHOK`.

### 3. Generate Database Migrations

```bash
npm run db:generate
```

### 4. Run Development Servers

```bash
npm run dev
```

- **Frontend**: http://localhost:5173 (Vite dev server with HMR)
- **Backend**: http://localhost:3000 (Fastify API + Socket.io)

The Vite dev server proxies `/api/*` and `/socket.io/*` to the backend automatically.

---

## Production Deployment (Docker)

### 1. Configure Environment

```bash
cp .env.example .env
```

Set production values:
```env
NODE_ENV=production
SESSION_SECRET=your-very-strong-random-secret-here
INITIAL_INVITE_CODE=your-secret-invite-code
```

### 2. Configure Domain (Optional)

Edit `Caddyfile` and replace `:80` with your domain name for automatic HTTPS:
```
snezhok.yourdomain.com {
    ...
}
```

### 3. Build & Run

```bash
docker compose up --build -d
```

### 4. Verify

```bash
docker compose logs -f app
# Should see: "🌸 Snezhok server is listening on http://0.0.0.0:3000"
```

Access at `http://your-server-ip` (or `https://your-domain` if configured).

### 5. First Registration

1. Open the app in your browser
2. Click "Register with Invite Code"
3. Enter the `INITIAL_INVITE_CODE` from your `.env` file
4. The first registered user automatically becomes **admin**
5. Admin can generate new invite codes from Settings → Admin Invites

---

## Voice Calls (WebRTC)

Voice calls work peer-to-peer using WebRTC:

- **LAN**: Works out of the box
- **WAN (same network/tunnel)**: Usually works via STUN
- **WAN (behind strict NAT)**: Requires a TURN server

### Enabling TURN Server

1. Uncomment the `coturn` service in `docker-compose.yml`
2. Edit `turnserver.conf` — set `relay-ip` and `external-ip` to your server IPs
3. Update `.env`:
   ```env
   USE_TURN=true
   TURN_URL=turn:your-server-ip:3478
   TURN_USERNAME=cozyuser
   TURN_CREDENTIAL=cozypassword
   ```
4. Rebuild: `docker compose up --build -d`

The browser receives TURN settings from the authenticated `/api/rtc-config` endpoint.

---

## Network Access (Russia-Resilient)

Since this app runs on your local server, you have several options for friends to connect:

- **Option A**: Use your existing tunnel (frp, WireGuard, etc.) — point it at port 80/443
- **Option B**: Use [Tailscale](https://tailscale.com/) — each friend installs it, zero port forwarding needed
- **Option C**: Direct LAN access if all friends are on the same network

---

## Project Structure

```
Snezhok/
├── apps/
│   ├── server/          # Fastify backend
│   │   ├── src/
│   │   │   ├── db/          # Schema, migrations, DB singleton
│   │   │   ├── lib/         # Config, auth middleware
│   │   │   ├── routes/      # REST API endpoints
│   │   │   ├── services/    # Business logic (auth, messages, files, presence)
│   │   │   ├── socket/      # Socket.io event handlers + WebRTC signaling
│   │   │   └── index.ts     # Server entry point
│   │   └── drizzle/         # Generated SQL migrations
│   └── web/             # React frontend
│       ├── src/
│       │   ├── components/  # UI components (Avatar, Button, Modal, chat/*)
│       │   ├── hooks/       # useSocket, useVoice
│       │   ├── lib/         # API client, socket singleton, formatters
│       │   ├── pages/       # LoginPage, RegisterPage, ChatPage
│       │   ├── stores/      # Zustand state (auth, messages, presence, voice, ui)
│       │   └── styles/      # Global CSS with design tokens
│       └── index.html
├── Dockerfile           # Multi-stage Docker build
├── docker-compose.yml   # App + Caddy + optional coturn
├── Caddyfile            # Reverse proxy config
├── turnserver.conf      # TURN server config (optional)
└── .env.example         # Environment variable template
```

## License

Private use only. Not intended for public distribution.
