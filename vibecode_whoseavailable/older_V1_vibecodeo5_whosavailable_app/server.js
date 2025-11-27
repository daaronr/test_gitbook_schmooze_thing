// Big Schmooze MVP - ultra-minimal server (Express + Socket.IO + file-based store)
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- tiny file-backed store ----
const DATA_PATH = path.join(__dirname, 'data.json');
let store = { events: {} };

function saveStore() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('save error', e);
  }
}
function loadStore() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const text = fs.readFileSync(DATA_PATH, 'utf-8');
      store = JSON.parse(text);
    }
  } catch (e) {
    console.error('load error', e);
  }
}
loadStore();

// ---- helpers ----
function randId(len=10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function code(len=4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function ensureEvent(code, name='Untitled Event') {
  if (!store.events[code]) {
    store.events[code] = {
      code,
      name,
      createdAt: Date.now(),
      users: {},
      nudges: [] // ephemeral
    };
  }
  return store.events[code];
}

// ---- REST API ----

// create a new event (returns code)
app.post('/api/event', (req, res) => {
  const name = (req.body && String(req.body.name || '').trim()) || 'Big Schmooze Event';
  // find an unused code
  let c;
  for (let i = 0; i < 100; i++) {
    c = code(4);
    if (!store.events[c]) break;
  }
  ensureEvent(c, name);
  saveStore();
  return res.json({ code: c, name });
});

// join an event (create / update user)
app.post('/api/join', (req, res) => {
  const body = req.body || {};
  const ecode = String(body.code || '').trim().toUpperCase();
  if (!ecode || !store.events[ecode]) return res.status(404).json({ error: 'Event not found' });

  const ev = ensureEvent(ecode);
  const name = String(body.name || '').trim().slice(0, 64);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const title = String(body.title || '').trim().slice(0, 96);
  const org = String(body.org || '').trim().slice(0, 96);
  const ask = String(body.ask || '').trim().slice(0, 200);
  const offer = String(body.offer || '').trim().slice(0, 200);
  const links = {
    linkedin: String(body.linkedin || '').trim().slice(0, 200),
    twitter: String(body.twitter || '').trim().slice(0, 200),
    website: String(body.website || '').trim().slice(0, 200),
  };
  const tagstr = String(body.tags || '').trim();
  const tags = tagstr ? tagstr.split(',').map(s => s.trim().slice(0, 18)).filter(Boolean).slice(0, 8) : [];

  let user = null;
  if (body.userId && ev.users[body.userId]) {
    user = ev.users[body.userId];
    // update minimal fields
    Object.assign(user, { name, title, org, ask, offer, links, tags });
  } else {
    const userId = randId(8);
    user = {
      id: userId,
      name, title, org,
      ask, offer,
      links, tags,
      status: 'open', // open | maybe | busy
      lastActive: Date.now(),
      hidden: false
    };
    ev.users[userId] = user;
  }
  saveStore();
  // notify room
  io.to(ecode).emit('roster', publicEvent(ev));
  return res.json({ event: publicEvent(ev), me: user });
});

// list participants
app.get('/api/event/:code/participants', (req, res) => {
  const ecode = String(req.params.code || '').trim().toUpperCase();
  if (!ecode || !store.events[ecode]) return res.status(404).json({ error: 'Event not found' });
  const ev = ensureEvent(ecode);
  return res.json(publicEvent(ev));
});

// update status, ask/offer, visibility
app.post('/api/event/:code/user/:id', (req, res) => {
  const ecode = String(req.params.code || '').trim().toUpperCase();
  const uid = String(req.params.id || '').trim();
  const ev = store.events[ecode];
  if (!ev || !ev.users[uid]) return res.status(404).json({ error: 'Not found' });
  const u = ev.users[uid];
  const b = req.body || {};
  if (typeof b.status === 'string' && ['open','maybe','busy'].includes(b.status)) u.status = b.status;
  if (typeof b.hidden === 'boolean') u.hidden = b.hidden;
  if (typeof b.ask === 'string') u.ask = b.ask.slice(0, 200);
  if (typeof b.offer === 'string') u.offer = b.offer.slice(0, 200);
  if (typeof b.tags === 'string') {
    const tagstr = b.tags.trim();
    u.tags = tagstr ? tagstr.split(',').map(s => s.trim().slice(0, 18)).filter(Boolean).slice(0, 8) : [];
  }
  u.lastActive = Date.now();
  saveStore();
  io.to(ecode).emit('roster', publicEvent(ev));
  return res.json({ ok: true, me: u });
});

// send a nudge (ephemeral signal)
app.post('/api/event/:code/nudge', (req, res) => {
  const ecode = String(req.params.code || '').trim().toUpperCase();
  const b = req.body || {};
  const from = String(b.from || '').trim();
  const to = String(b.to || '').trim();
  const ev = store.events[ecode];
  if (!ev || !ev.users[from] || !ev.users[to]) return res.status(404).json({ error: 'Not found' });
  const msg = { id: randId(6), from, to, at: Date.now() };
  ev.nudges.push(msg);
  // broadcast only to room; clients decide if it's for them
  io.to(ecode).emit('nudge', { event: ecode, ...msg });
  // also refresh roster timestamps
  io.to(ecode).emit('roster', publicEvent(ev));
  return res.json({ ok: true });
});

function publicEvent(ev) {
  // return event with users except hidden ones
  const users = Object.values(ev.users)
    .filter(u => !u.hidden)
    .map(u => ({
      id: u.id,
      name: u.name,
      title: u.title,
      org: u.org,
      ask: u.ask,
      offer: u.offer,
      links: u.links,
      tags: u.tags,
      status: u.status,
      lastActive: u.lastActive
    }));
  // sort: open > maybe > busy, then recent activity
  const rank = { open: 0, maybe: 1, busy: 2 };
  users.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.lastActive - a.lastActive));
  return { code: ev.code, name: ev.name, users };
}

// ---- sockets ----
io.on('connection', (socket) => {
  socket.on('join-room', (ecode) => {
    if (!ecode) return;
    ecode = String(ecode).toUpperCase();
    socket.join(ecode);
    const ev = store.events[ecode];
    if (ev) {
      socket.emit('roster', publicEvent(ev));
    }
  });
  socket.on('leave-room', (ecode) => {
    if (ecode) socket.leave(String(ecode).toUpperCase());
  });
});

// health
app.get('/api/health', (_req, res) => res.json({ ok: true, now: Date.now() }));

// fallback: serve index.html for root and simple /e/:code routes
app.get('/e/:code', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => {
  console.log(`Big Schmooze MVP running on http://localhost:${PORT}`);
});