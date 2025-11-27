/**
 * Who's Available — tiny realtime app
 * - No DB. In-memory.
 * - Auto-port fallback if 3000 is busy.
 * - Auto-opens browser (mac/win/linux).
 */
const path = require('path');
const { exec } = require('child_process');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_req, res) => res.json({ ok: true, now: Date.now() }));

// --- In-memory store ---
// rooms: { [room]: { users: Map<socketId, User> } }
const rooms = new Map();
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
      kinds: Array.isArray(payload.kinds) ? payload.kinds.map(x => String(x).slice(0,24)).slice(0,6) : [],
      tags: String(payload.tags || '').slice(0, 80),
      location: String(payload.location || '').slice(0, 160),
      note: String(payload.note || '').slice(0, 160),
      availableUntil: null,
      updatedAt: now
    };
    room.users.set(socket.id, user);
    emitRoster(roomName);
  });

  socket.on('set-available', (payload) => {
    const room = getRoom(roomName);
    if (!room.users.has(socket.id)) return;
    const minutes = Math.max(1, Math.min(240, parseInt(payload.minutes || 15, 10)));
    const now = Date.now();
    const u = room.users.get(socket.id);
    // allow updating profile fields at the same time
    if (payload.kinds) u.kinds = Array.isArray(payload.kinds) ? payload.kinds.map(x => String(x).slice(0,24)).slice(0,6) : u.kinds;
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
      // Open the default browser once
      openBrowser(url);
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