# Who's Available — minimal app

A tiny realtime page to show **who’s available**, **for what kind of chat**, and **for how long**.

- No accounts, no database — just open the page and click “I’m available”.
- Works well for hack days, conferences, coworking, or office hours.
- Optional **rooms** via `?r=room-name` so you can split groups.

## Run it (Mac/Linux/Windows)

```bash
npm install
npm start
# It auto-opens your browser to http://localhost:3000 (or the next free port)
```

## Use it with others

- **Same Wi‑Fi:** Share your LAN IP and port, e.g. `http://192.168.1.23:3000`.
- **Public link:** Use a tunnel (e.g. `ngrok http 3000`) and share the https URL.
- **Rooms:** Append `?r=hallway-a` and share that link to put everyone in the same room.

## What people do on the page

1. Type your **name** (and optionally a **room** name).
2. Tick what kind of chat you’re up for (quick hello, coffee, technical, brainstorm).
3. Set **how long** (10/15/30/60 or custom minutes).
4. Optionally add **location/link** and a short **note**.
5. Click **“I’m available”**.
6. Your card shows up to everyone with a live **countdown**. You can **extend +10m** or mark **Done**.

## Tech

- Node.js + Express + Socket.IO
- In‑memory store (resets when server restarts)
- Auto‑port fallback if 3000 is in use
- Auto‑opens your default browser when the server starts

## License
MIT