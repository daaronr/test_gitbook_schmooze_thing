# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install    # Install dependencies
npm start      # Run server (auto-opens browser, falls back to next port if 3000 busy)
```

## Architecture

**Who's Available / The Big Schmooze** - A realtime availability and async voice discussion app using Socket.IO.

### Server (`server.js`)
- Express server with Socket.IO for realtime communication
- In-memory storage (no database, data resets on restart)
- Auto-port fallback if 3000 is busy, auto-opens browser on start

**Data structures:**
- `rooms` Map: `{ [roomName]: { users: Map<socketId, User> } }`
- `topics` array: Async discussion topics with title, prompt, due date
- `responses` array: Audio clip responses to topics

**Socket events:**
- `join`, `set-available`, `extend`, `done`, `disconnect` for availability
- `roster`, `topics`, `responses` emitted to clients

**REST endpoints:**
- `GET/POST /api/topics` - Create/list discussion topics
- `POST /api/upload` - Upload audio clips (multer, 25MB limit)
- `GET/POST /api/responses` - Audio responses to topics
- `/uploads/*` serves uploaded files

### Client (`public/app.js`)
- Single-page app, state persisted in localStorage (`schmooze_state`)
- Room selection via `?r=room-name` query param
- Audio recording via MediaRecorder API, or file upload
- "Play stitched" concatenates all topic responses sequentially

### Key patterns
- All socket events broadcast via `emitRoster()`, `emitTopics()`, `emitResponses()`
- 15-second expiry sweeper removes expired availability entries
- XSS protection via `esc()` helper for all user-generated content
