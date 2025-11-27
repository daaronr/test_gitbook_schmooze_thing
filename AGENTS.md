# Repository Guidelines

## Project Structure & Module Organization
- Main app lives in `vibecode_whoseavailable/`; entry is `server.js` (Express + Socket.IO, in-memory store; no DB).
- Client assets stay in `vibecode_whoseavailable/public/` (`index.html`, `app.js`, `styles.css`), served statically by Express.
- Root `README.md` is the primary usage guide; `SUMMARY.md` and `chatmatch-app-aka-schmooze/` contain GitBook docs. Leave `node_modules/` untouched.

## Build, Test, and Development Commands
- Install: `cd vibecode_whoseavailable && npm install`.
- Run locally: `npm start` (auto-opens browser; port fallback if 3000 is busy). Health check: `curl http://localhost:3000/api/health`.
- No build/bundle step; production run is `node server.js` and serving `public/` as-is.

## Coding Style & Naming Conventions
- CommonJS JavaScript, 2-space indentation, semicolons, and `const`/`let`. Match patterns in `server.js` and `public/app.js`.
- Trim and cap inputs as existing socket handlers do (string length limits, minutes clamped to sane bounds).
- Filenames stay lowercase with hyphens/underscores; client helpers live in `app.js`, server helpers in `server.js`.
- UI is plain HTML/CSS/vanilla JS; avoid new frameworks unless discussed first.

## Testing Guidelines
- No automated tests yet; manual smoke test every change:
  - `npm start`, join, set availability, extend, mark done.
  - Open two browser windows to confirm roster updates and expirations (sweeper runs ~15s).
  - Hit `/api/health` and expect `{ ok: true }`.
- Add any new scripts under `vibecode_whoseavailable/` and document commands here.

## Commit & Pull Request Guidelines
- Use concise, present-tense messages (e.g., `Clamp minutes input`, `Tighten roster filtering`). History is sparse—set good precedent.
- PRs should summarize behavior changes, note socket/UI impacts, and include manual verification steps or screenshots/GIFs.
- Link related issues/tasks if they exist. Call out new dependencies or env vars (defaults: none; optional `PORT`).

## Security & Configuration Tips
- User data is in-memory only; restarts clear availability. Only add persistence with explicit opt-in and disclosure.
- All input is user-controlled; escape output (see `esc()` in `public/app.js`) and keep length/range caps on new fields.
- Avoid committing secrets; environment config is limited to `PORT` for the server.
