# Cozy Chat — Project Standards

> A private, self-hosted messenger for up to 10 people. No cloud dependencies, no accounts, no ads. Just warm, comfortable communication.

---

## 1. What We're Building

A self-hosted web application that runs entirely on one person's machine (or a small VPS) and is accessed by all members via a local network or a simple tunnel. It has two core features:

- **Chat** — real-time text messaging with file sharing
- **Voice** — peer-to-peer voice calls without any external service

It is never public. It never scales beyond 10 users. That is a feature, not a limitation.

---

## 2. Core Principles

### Comfort over features
Every decision favors user comfort over technical cleverness. The app should feel like a warm room, not a productivity tool.

### Self-contained
No dependency on external APIs, cloud services, or third-party auth. The app must function fully offline (within a LAN) and never phone home.

### Russia-resilient
All dependencies must be available via npm/pip/package managers without geo-restrictions. No reliance on Google services, Cloudflare-proxied assets at runtime, or any service blocked in Russia. All assets are bundled and served locally.

### Small team, simple code
10 users max. No need for horizontal scaling, message queues, or microservices. Simple, readable code that any one person can maintain.

---

## 3. Tech Stack

### Frontend
| Layer | Choice | Reason |
|---|---|---|
| Framework | **React 19 + Vite 6** | Fast HMR, great ecosystem, familiar |
| Styling | **Vanilla CSS with design tokens** | Simple, bundled, no runtime CSS |
| State | **Zustand** | Minimal, no boilerplate |
| Real-time | **Socket.io-client** | Pairs with backend, handles reconnect |
| Voice | **simple-peer** (WebRTC) | Peer-to-peer, no TURN needed on LAN |
| File preview | **react-dropzone** + native browser APIs | Zero dependencies for previews |
| Date/time | **date-fns** | Lightweight, tree-shakeable |
| Icons | **Lucide React** | Clean, consistent, open-source |

### Backend
| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Node.js 22 LTS** | Stable, widely supported |
| Framework | **Fastify 5** | Fast, schema-first, good DX |
| Real-time | **Socket.io 4** | Battle-tested, works behind reverse proxy |
| Database | **SQLite + Drizzle ORM** | Zero-config, file-based, perfect for small groups |
| File storage | **Local filesystem** | Simple, no S3, no blob store |
| Voice signaling | **Socket.io** (same server) | WebRTC signaling over existing WS |
| Auth | **Session cookies + bcrypt** | No JWT complexity, simple invite codes |

### Infrastructure
| Layer | Choice | Reason |
|---|---|---|
| Container | **Docker + Docker Compose** | One-command setup, portable |
| Reverse proxy | **Caddy** | Automatic HTTPS, simple config |
| Tunnel (optional) | **Cloudflare Tunnel** or **frp** | Remote access without port forwarding |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────┐
│           Docker Compose            │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │  Caddy   │───▶│  Node/Fastify │  │
│  │  :443    │    │  :3000        │  │
│  └──────────┘    │               │  │
│                  │  Socket.io    │  │
│                  │  REST API     │  │
│                  │  Static files │  │
│                  └──────┬────────┘  │
│                         │           │
│                  ┌──────▼────────┐  │
│                  │  SQLite DB    │  │
│                  │  /data/app.db │  │
│                  └───────────────┘  │
└─────────────────────────────────────┘
         ▲                ▲
         │                │
    Browser A         Browser B
   (WebRTC P2P ◀──────────▶)
```

Voice calls are peer-to-peer. The server only handles WebRTC signaling (offer/answer/ICE). Audio never touches the server.

---

## 5. Feature Scope

### MVP (v1.0)
- [ ] Invite-code based registration (no email required)
- [ ] Global group chat (one room, everyone in it)
- [ ] File sharing (images, video, documents — max 100MB per file)
- [ ] Image and video preview inline in chat
- [ ] Voice call (any member can start, others join)
- [ ] Online presence indicators
- [ ] Message timestamps

### v1.1
- [ ] Message reactions (emoji, limited set)
- [ ] Reply to message (thread reference, not full threads)
- [ ] Push-to-talk mode for voice

### Out of scope (forever)
- Public registration
- Multiple channels/rooms
- Video calls
- Message encryption at rest (the server admin can read the DB — this is a trust-based private group)
- Mobile native apps (the web app should be responsive enough)

---

## 6. Security Model

This is a private app for trusted friends. Security is proportional:

- **Auth**: Invite code → set username + password → session cookie (httpOnly, sameSite=strict)
- **Session**: Server-side sessions stored in SQLite, 30-day expiry
- **File uploads**: Validated extension and size, stored outside web root, served through authenticated conversation-aware routes
- **No public registration**: New members only via invite code generated by admin
- **HTTPS**: Required in production via Caddy; self-signed cert acceptable on LAN
- **Rate limiting**: Basic rate limit on auth endpoints to prevent brute force

---

## 7. Performance Targets

| Metric | Target |
|---|---|
| Initial page load | < 2s on LAN |
| Message delivery (send → receive) | < 100ms on LAN |
| File upload (100MB) | Streaming, progress shown |
| Voice call setup | < 3s on LAN |
| Max concurrent users | 10 (hard limit by design) |
| SQLite DB size | < 10GB before any cleanup needed |

---

## 8. Folder Structure

```
cozy-chat/
├── apps/
│   ├── web/                  # Vite + React frontend
│   │   ├── src/
│   │   │   ├── components/   # UI components
│   │   │   ├── pages/        # Route-level components
│   │   │   ├── stores/       # Zustand stores
│   │   │   ├── hooks/        # Custom React hooks
│   │   │   ├── lib/          # Utilities, socket client, WebRTC
│   │   │   └── styles/       # Global CSS, Tailwind config
│   │   └── ...
│   └── server/               # Fastify backend
│       ├── src/
│       │   ├── routes/       # API + Socket.io handlers
│       │   ├── db/           # Drizzle schema + migrations
│       │   ├── services/     # Business logic
│       │   └── lib/          # Helpers
│       └── ...
├── data/                     # SQLite DB + uploaded files (gitignored)
├── docker-compose.yml
├── Caddyfile
└── README.md
```

---

## 9. Getting Started (Dev)

```bash
# Prerequisites: Node 22+, Docker
git clone <repo>
cd cozy-chat

# Install all deps
npm install

# Start backend + frontend in watch mode
npm run dev

# Or with Docker (production-like)
docker compose up --build
```

---

## 10. Definition of Done

A feature is done when:
1. It works on the latest Chrome, Firefox, and Safari (desktop)
2. It works on mobile Safari (iOS) and Chrome (Android)
3. It has no console errors
4. The UI matches the Design System spec
5. It gracefully handles offline/disconnect states
