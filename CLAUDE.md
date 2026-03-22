# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**The Big Schmooze** — a realtime availability + async voice discussion app. Users join rooms, signal availability, create discussion topics, and drop short audio clips that play back as a stitched stream. No accounts, no database — everything is in-memory and resets on server restart.

## Commands

All commands run from `vibecode_whoseavailable/`:

```bash
cd vibecode_whoseavailable
npm install          # install deps
npm start            # run server (auto-opens browser, port fallback from 3000)
npm run electron     # run as Electron desktop app
```

Health check: `curl http://localhost:3000/api/health`

No build step, no test suite, no linter. Manual smoke testing only.

## Architecture

### Repository Layout

- `vibecode_whoseavailable/` — **the active app** (all development happens here)
  - `server.js` — Express + Socket.IO server, in-memory store, all REST + WebSocket logic
  - `public/` — static client (vanilla HTML/CSS/JS, no framework)
    - `app.js` — single-page client app, state in localStorage (`schmooze_state`)
    - `index.html`, `styles.css` — UI
    - `sw.js`, `manifest.json` — PWA support
  - `config/availability-types.json` — availability category definitions (loaded by server and served to client)
  - `electron/` — Electron wrapper (`main.js`, `preload.js`)
  - `uploads/` — audio clips stored on disk (not persisted across redeploys)
- `ProjectLink_aka_schmooze/` — product concept docs and writeups
- `chatmatch-app-aka-schmooze/` — older GitBook documentation pages
- `wireframes/` — Balsamiq wireframes for the app

### Server Data Model

- `rooms` Map (in-memory): `{ [roomName]: { users: Map<socketId, User> } }` — ephemeral availability, resets on restart
- `topics` table (SQLite): discussion topics with title, prompt, due date, room — persisted in `data/schmooze.db`
- `responses` table (SQLite): audio clip responses linked to topics via foreign key with CASCADE delete

### Communication

- **Socket.IO events**: `join`, `set-available`, `extend`, `done`, `disconnect` → server broadcasts `roster`, `topics`, `responses`
- **REST**: `/api/topics` (GET/POST/DELETE), `/api/responses` (GET/POST/DELETE), `/api/upload` (multer, 25MB limit), `/api/config/availability-types`
- 15-second sweeper removes expired availability entries

### Environment

- `PORT` — server port (default 3000, auto-increments if busy)
- `RENDER=true` or `NODE_ENV=production` — cloud mode (binds 0.0.0.0, skips browser open)
- `ELECTRON=1` — Electron mode (skips browser open)

## Coding Conventions

- CommonJS JavaScript, 2-space indent, semicolons, `const`/`let`
- Vanilla HTML/CSS/JS on the client — no frameworks
- All user input must be trimmed, length-capped, and escaped (`esc()` in `app.js`) before rendering
- Availability kinds are validated against `config/availability-types.json`
