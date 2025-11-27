# Big Schmooze — MVP

Ultra-minimal working example of a "schmoozing at events" web app. No accounts, no email, just a room code. Built to be easy to run locally or deploy on a free/cheap host.

## Features
- Create an event (auto room code), or join an existing event with code.
- Lightweight profile: name, title/org, links (optional).
- "Ask" and "Offer" fields (what you want / what you can help with).
- Schmooze status: **Open** / **Maybe later** / **Busy**.
- Tags & filter.
- Real-time roster updates and *Nudge* (👋) using Socket.IO.
- Shareable invite link `?e=CODE`.
- File-backed JSON store (no external DB).

> Warning: This is a throwaway MVP. No auth; anyone with the code can see the roster. Data resets if the server restarts or `data.json` is deleted.

## Quick start (local)
1. Install Node.js 18+
2. In a terminal:
   ```bash
   cd bigschmooze-mvp
   npm install
   npm start
   ```
3. Open http://localhost:3000 in your browser.
4. Click **Create** (or join with a friend's event code), fill name, and go.

## Deploy (one-liners)
- **Render** / **Railway** / **Fly.io**: Create a new Node app, point to this repo/folder. Default web command is `npm start`. No env vars required.
- **Docker** (optional):
  ```bash
  docker build -t bigschmooze .
  docker run -p 3000:3000 bigschmooze
  ```

## Project layout
```
bigschmooze-mvp/
  public/
    index.html
    styles.css
    app.js
  server.js
  package.json
  README.md
```

## Privacy / security
- No login or email. No encryption. Intended for low-stakes use at small events.
- If you need persistence or access control, migrate to a real DB and add auth.

## License
MIT