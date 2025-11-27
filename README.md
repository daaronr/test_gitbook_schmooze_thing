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

## Local development tips

- Source lives in `vibecode_whoseavailable/` (`server.js`, `public/`). Client is plain HTML/CSS/JS; server uses CommonJS.
- Hot reloading isn’t wired; restart `npm start` after server changes and hard refresh the browser for client edits.
- Health check: `curl http://localhost:3000/api/health` should return `{ ok: true }`.

## Deploy to Linode (MVP)

On a fresh Ubuntu/Debian Linode:

```bash
sudo apt update && sudo apt install -y git nodejs npm
git clone https://github.com/<your-org>/test_gitbook_schmooze_thing.git
cd test_gitbook_schmooze_thing/vibecode_whoseavailable
npm install
PORT=3000 node server.js
```

Keep it running with systemd (edit the paths/user as needed):

```bash
sudo tee /etc/systemd/system/whos-available.service >/dev/null <<'EOF'
[Unit]
Description=Who is Available realtime app
After=network.target

[Service]
Type=simple
User=www-data
Environment=PORT=3000
WorkingDirectory=/home/USER/test_gitbook_schmooze_thing/vibecode_whoseavailable
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now whos-available
```

Expose it securely by pointing your DNS to the Linode IP and putting Nginx in front (optional TLS via Let’s Encrypt):

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/whos-available >/dev/null <<'EOF'
server {
  server_name your-domain.com;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
}
EOF
sudo ln -s /etc/nginx/sites-available/whos-available /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
# Optional TLS: sudo certbot --nginx -d your-domain.com
```

## License
MIT
