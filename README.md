# The Big Schmooze — async topic + audio drops

A minimal MVP where people create topics, drop short voice clips, and play a stitched stream whenever they have time.

- No accounts, in-memory store. Share a **room** via `?r=room-name` to keep groups separate.
- Create a topic with a prompt and optional due time; participants record or upload a clip.
- Stitched playback plays responses in arrival order; data resets on server restart.
- Product background and use cases: `ProjectLink_aka_schmooze/bigschmooze.md` (plus wireframes in `wireframes/`).

## Run it (Mac/Linux/Windows)

```bash
npm install
npm start
# It auto-opens your browser to http://localhost:3000 (or the next free port)
```

## What people do on the page (MVP)

1. Set your **name** and **room** (shareable link via “Share room link”).
2. **Create a topic**: title, prompt/context, optional due time, and max clip length.
3. **Respond**: pick a topic, record or upload a short audio clip, and submit.
4. **Play stitched**: per topic, play responses sequentially in arrival order.
5. Optional: filter topics/responses by keyword.

## Tech

- Node.js + Express + Socket.IO, in-memory store
- Uploads saved to `uploads/` on disk (not persisted across redeploys)
- Auto-port fallback if 3000 is in use; auto-opens browser on start

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
