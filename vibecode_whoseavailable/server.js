/**
 * Who's Available — tiny realtime app
 * - No DB. In-memory.
 * - Auto-port fallback if 3000 is busy.
 * - Auto-opens browser (mac/win/linux) unless running in Electron.
 */

// Detect if running inside Electron
const isElectron = process.env.ELECTRON === '1';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');

// Load availability types configuration
const availabilityConfig = require('./config/availability-types.json');
// Flatten all types from categories into a single set of valid IDs
const validKindIds = new Set(
  availabilityConfig.categories.flatMap(cat => cat.types.map(t => t.id))
);

function validateKinds(kinds) {
  if (!Array.isArray(kinds)) return [];
  return kinds
    .filter(k => validKindIds.has(k))
    .slice(0, availabilityConfig.maxSelections);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.get('/api/health', (_req, res) => res.json({ ok: true, now: Date.now() }));
app.get('/api/config/availability-types', (_req, res) => res.json(availabilityConfig));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB per clip
});

// --- In-memory store ---
// rooms: { [room]: { users: Map<socketId, User> } }
const rooms = new Map();
const topics = []; // [{ id, title, prompt, dueAt, maxMinutes, room, createdBy, createdAt }]
const responses = []; // [{ id, topicId, room, name, tags, note, audioUrl, duration, createdAt }]

function getRoom(name='main') {
  if (!rooms.has(name)) rooms.set(name, { users: new Map() });
  return rooms.get(name);
}

function publicRoster(room) {
  // Only show currently available users
  const now = Date.now();
  const list = Array.from(room.users.values())
    .filter(u => u.availableUntil && u.availableUntil > now)
    .map(u => ({
      id: u.id,
      name: u.name,
      kinds: u.kinds,
      tags: u.tags,
      location: u.location,
      note: u.note,
      availableUntil: u.availableUntil,
      updatedAt: u.updatedAt
    }));
  // sort by time remaining (soonest first)
  list.sort((a,b) => (a.availableUntil - b.availableUntil));
  return { users: list, now };
}
function emitRoster(roomName) {
  const room = getRoom(roomName);
  io.to(roomName).emit('roster', publicRoster(room));
}

function emitTopics(roomName='main') {
  io.to(roomName).emit('topics', topics.filter(t => t.room === roomName));
}

function emitResponses(roomName='main', topicId=null) {
  const payload = responses.filter(r => r.room === roomName && (!topicId || r.topicId === topicId));
  io.to(roomName).emit('responses', payload);
}

// Expiry sweeper
setInterval(() => {
  const now = Date.now();
  for (const [roomName, room] of rooms) {
    let changed = false;
    for (const [sid, u] of room.users) {
      if (u.availableUntil && u.availableUntil <= now) {
        // Just let it drop off naturally; no change required
        // We still consider changed to trigger a refresh every minute
        changed = true;
      }
    }
    if (changed) emitRoster(roomName);
  }
}, 15 * 1000); // every 15s keep clients fresh

io.on('connection', (socket) => {
  let roomName = 'main';
  let user = null;

  socket.on('join', (payload) => {
    roomName = (payload && String(payload.room || 'main').slice(0, 32)) || 'main';
    socket.join(roomName);
    const room = getRoom(roomName);
    const name = String(payload.name || '').trim().slice(0, 64);
    if (!name) return;
    const now = Date.now();
    user = {
      id: socket.id,
      name,
      kinds: validateKinds(payload.kinds),
      tags: String(payload.tags || '').slice(0, 80),
      location: String(payload.location || '').slice(0, 160),
      note: String(payload.note || '').slice(0, 160),
      availableUntil: null,
      updatedAt: now
    };
    room.users.set(socket.id, user);
    emitRoster(roomName);
    // send topics/responses snapshot for the room
    socket.emit('topics', topics.filter(t => t.room === roomName));
    socket.emit('responses', responses.filter(r => r.room === roomName));
  });

  socket.on('set-available', (payload) => {
    const room = getRoom(roomName);
    if (!room.users.has(socket.id)) return;
    const minutes = Math.max(1, Math.min(240, parseInt(payload.minutes || 15, 10)));
    const now = Date.now();
    const u = room.users.get(socket.id);
    // allow updating profile fields at the same time
    if (payload.kinds) u.kinds = validateKinds(payload.kinds);
    if (typeof payload.tags === 'string') u.tags = String(payload.tags).slice(0,80);
    if (typeof payload.location === 'string') u.location = String(payload.location).slice(0,160);
    if (typeof payload.note === 'string') u.note = String(payload.note).slice(0,160);

    u.availableUntil = now + minutes * 60 * 1000;
    u.updatedAt = now;
    emitRoster(roomName);
  });

  socket.on('extend', (payload) => {
    const room = getRoom(roomName);
    if (!room.users.has(socket.id)) return;
    const addMin = Math.max(1, Math.min(240, parseInt(payload.minutes || 10, 10)));
    const now = Date.now();
    const u = room.users.get(socket.id);
    if (!u.availableUntil || u.availableUntil < now) {
      u.availableUntil = now + addMin * 60 * 1000;
    } else {
      u.availableUntil += addMin * 60 * 1000;
    }
    u.updatedAt = now;
    emitRoster(roomName);
  });

  socket.on('done', () => {
    const room = getRoom(roomName);
    if (!room.users.has(socket.id)) return;
    const u = room.users.get(socket.id);
    u.availableUntil = null;
    u.updatedAt = Date.now();
    emitRoster(roomName);
  });

  socket.on('disconnect', () => {
    const room = getRoom(roomName);
    room.users.delete(socket.id);
    emitRoster(roomName);
  });
});

// Topics API
app.get('/api/topics', (req, res) => {
  const roomName = String(req.query.room || 'main');
  res.json(topics.filter(t => t.room === roomName));
});

app.post('/api/topics', (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 160);
  if (!title) return res.status(400).json({ error: 'Title required' });
  const roomName = String(req.body.room || 'main').slice(0, 32) || 'main';
  const prompt = String(req.body.prompt || '').trim().slice(0, 400);
  const maxMinutes = Math.max(1, Math.min(240, parseInt(req.body.maxMinutes || 5, 10)));
  const dueAt = req.body.dueAt ? Date.parse(req.body.dueAt) : null;
  const createdBy = String(req.body.createdBy || '').trim().slice(0, 80) || 'anon';
  const topic = {
    id: `t_${Date.now()}_${Math.random().toString(16).slice(2,6)}`,
    title,
    prompt,
    maxMinutes,
    room: roomName,
    dueAt: Number.isFinite(dueAt) ? dueAt : null,
    createdBy,
    createdAt: Date.now()
  };
  topics.unshift(topic);
  emitTopics(roomName);
  res.json(topic);
});

// Upload audio clip
app.post('/api/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  // Keep the random filename; expose via /uploads
  res.json({
    url: `/uploads/${req.file.filename}`,
    original: req.file.originalname,
    size: req.file.size
  });
});

// Responses API
app.get('/api/responses', (req, res) => {
  const roomName = String(req.query.room || 'main');
  const topicId = req.query.topicId ? String(req.query.topicId) : null;
  const list = responses.filter(r => r.room === roomName && (!topicId || r.topicId === topicId));
  res.json(list);
});

app.post('/api/responses', (req, res) => {
  const topicId = String(req.body.topicId || '').trim();
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return res.status(400).json({ error: 'Unknown topic' });
  const roomName = topic.room;
  const name = String(req.body.name || '').trim().slice(0, 64);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const audioUrl = String(req.body.audioUrl || '').trim();
  if (!audioUrl) return res.status(400).json({ error: 'audioUrl required' });
  const tags = String(req.body.tags || '').slice(0, 120);
  const note = String(req.body.note || '').slice(0, 200);
  const duration = Math.max(0, Math.min(60 * 60, parseInt(req.body.duration || 0, 10))); // seconds

  const response = {
    id: `r_${Date.now()}_${Math.random().toString(16).slice(2,6)}`,
    topicId,
    room: roomName,
    name,
    tags,
    note,
    audioUrl,
    duration,
    createdAt: Date.now()
  };
  responses.push(response);
  emitResponses(roomName, topicId);
  res.json(response);
});

// --- Auto-port fallback and auto-open
function openBrowser(url) {
  let cmd = null;
  if (process.platform === 'darwin') cmd = `open "${url}"`;
  else if (process.platform === 'win32') cmd = `start "" "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log('Open your browser at:', url);
    }
  });
}

function startServer(port, triesLeft=5) {
  server
    .listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`Who's Available running on ${url}`);
      // Open the default browser once (unless in Electron)
      if (!isElectron) {
        openBrowser(url);
      }
    })
    .on('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && triesLeft > 0) {
        console.log(`Port ${port} in use. Trying ${port+1}...`);
        startServer(port + 1, triesLeft - 1);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });
}

const basePort = parseInt(process.env.PORT || '3000', 10);
startServer(basePort);
