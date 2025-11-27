const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const socket = io();

let ROOM = 'main';
let lastRoster = { users: [], now: Date.now() };
let timer = null;

function readForm() {
  return {
    name: $('#name').value.trim(),
    room: $('#room').value.trim() || 'main',
    kinds: $$('.kind:checked').map(cb => cb.value),
    tags: $('#tags').value.trim(),
    location: $('#location').value.trim(),
    note: $('#note').value.trim(),
    minutes: Math.max(1, Math.min(240, parseInt($('#minutes').value || '15', 10)))
  };
}

function saveLocal() {
  const f = readForm();
  localStorage.setItem('wa_form', JSON.stringify(f));
}
function loadLocal() {
  try {
    const stored = JSON.parse(localStorage.getItem('wa_form') || '{}');
    if (stored.name) $('#name').value = stored.name;
    if (stored.room) $('#room').value = stored.room;
    if (stored.tags) $('#tags').value = stored.tags;
    if (stored.location) $('#location').value = stored.location;
    if (stored.note) $('#note').value = stored.note;
    if (stored.minutes) $('#minutes').value = stored.minutes;
    if (Array.isArray(stored.kinds)) {
      $$('.kind').forEach(cb => { cb.checked = stored.kinds.includes(cb.value); });
    }
  } catch {}
}
function fromQS() {
  const url = new URL(window.location.href);
  const r = url.searchParams.get('r');
  if (r) $('#room').value = r;
}

function joinIfReady() {
  const f = readForm();
  if (!f.name) return;
  ROOM = f.room || 'main';
  socket.emit('join', { name: f.name, room: ROOM, kinds: f.kinds, tags: f.tags, location: f.location, note: f.note });
}

function bind() {
  // duration quick buttons
  $$('.dur').forEach(btn => btn.onclick = () => {
    $('#minutes').value = btn.dataset.min;
    saveLocal();
  });

  $('#goBtn').onclick = () => {
    const f = readForm();
    if (!f.name) { alert('Please enter your name.'); return; }
    ROOM = f.room;
    socket.emit('join', { name: f.name, room: ROOM, kinds: f.kinds, tags: f.tags, location: f.location, note: f.note });
    socket.emit('set-available', { minutes: f.minutes, kinds: f.kinds, tags: f.tags, location: f.location, note: f.note });
    $('#statusLine').textContent = `You are available for ${f.minutes} minutes.`;
    saveLocal();
  };
  $('#extendBtn').onclick = () => {
    socket.emit('extend', { minutes: 10 });
  };
  $('#doneBtn').onclick = () => {
    socket.emit('done');
    $('#statusLine').textContent = `You marked yourself as done.`;
  };
  $('#shareBtn').onclick = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('r', $('#room').value.trim() || 'main');
    navigator.clipboard.writeText(url.toString()).then(() => {
      toast('Link copied');
    }, () => {
      prompt('Copy this link:', url.toString());
    });
  };

  // autosave inputs
  $$('input').forEach(inp => inp.addEventListener('input', saveLocal));
  $$('.kind').forEach(cb => cb.addEventListener('change', saveLocal));

  // socket
  socket.on('connect', () => {
    joinIfReady();
  });
  socket.on('roster', (data) => {
    lastRoster = data;
    renderList();
  });

  // update clock every second
  timer = setInterval(() => {
    renderList();
  }, 1000);
}

function renderList() {
  const now = Date.now();
  $('#nowline').textContent = new Date(now).toLocaleTimeString();
  const filter = ($('#filter').value || '').toLowerCase();
  const users = (lastRoster.users || []).filter(u => {
    const hay = [u.name, ...(u.kinds||[]), u.tags, u.location, u.note].join(' ').toLowerCase();
    return hay.includes(filter);
  });

  $('#list').innerHTML = users.map(u => personHTML(u, lastRoster.now)).join('');
}
function personHTML(u, serverNow) {
  const now = Date.now();
  const delta = u.availableUntil - now; // client-side countdown
  const left = formatDuration(Math.max(0, delta));
  const untilTime = new Date(u.availableUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const kinds = (u.kinds || []).map(k => `<span class="badge">${esc(k)}</span>`).join('');
  const tags = u.tags ? u.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('') : '';

  const loc = linkify(u.location || '');

  return `
    <div class="card person">
      <div class="rowtop">
        <div class="name">${esc(u.name)}</div>
        <div class="timeleft">⏳ ${left} left (until ${untilTime})</div>
      </div>
      ${kinds ? `<div class="kinds">${kinds}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${loc ? `<div class="location">📍 ${loc}</div>` : ''}
      ${u.note ? `<div class="note">📝 ${esc(u.note)}</div>` : ''}
    </div>
  `;
}
function esc(s){return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;' }[c]))}
function linkify(text) {
  const s = String(text);
  if (!s) return '';
  try {
    const u = new URL(s);
    return `<a href="${esc(u.href)}" target="_blank" rel="noopener">${esc(u.host)}</a>`;
  } catch {
    return esc(s);
  }
}
function formatDuration(ms) {
  const totalSec = Math.floor(ms/1000);
  const m = Math.floor(totalSec/60);
  const s = totalSec%60;
  if (m >= 60) {
    const h = Math.floor(m/60);
    const m2 = m%60;
    return `${h}h ${m2}m`;
  }
  return `${m}m ${s.toString().padStart(2,'0')}s`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.position = 'fixed';
  el.style.bottom = '16px';
  el.style.right = '16px';
  el.style.background = '#102032';
  el.style.border = '1px solid #1b2c45';
  el.style.padding = '8px 10px';
  el.style.borderRadius = '10px';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2000);
}

window.addEventListener('DOMContentLoaded', () => {
  fromQS();
  loadLocal();
  bind();
});