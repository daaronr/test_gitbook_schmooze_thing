const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const socket = io();

let ROOM = 'main';
let lastRoster = { users: [], now: Date.now() };
let timer = null;

function readForm() {
  return {
    name: $('#name').value.trim(),
    room: $('#room').value.trim() || 'main',
    kinds: $$('.kind:checked').map((cb) => cb.value),
    tags: $('#tags').value.trim(),
    location: $('#location').value.trim(),
    note: $('#note').value.trim(),
    minutes: Math.max(1, Math.min(240, parseInt($('#minutes').value || '15', 10)))
  };
}

function saveLocal() {
  localStorage.setItem('wa_form', JSON.stringify(readForm()));
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
      $$('.kind').forEach((cb) => { cb.checked = stored.kinds.includes(cb.value); });
    }
  } catch {
    // ignore bad JSON
  }
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
  $$('.dur').forEach((btn) => btn.addEventListener('click', () => {
    $('#minutes').value = btn.dataset.min;
    saveLocal();
  }));

  $('#goBtn').onclick = () => {
    const f = readForm();
    if (!f.name) { alert('Please enter your name.'); return; }
    ROOM = f.room;
    socket.emit('join', { name: f.name, room: ROOM, kinds: f.kinds, tags: f.tags, location: f.location, note: f.note });
    socket.emit('set-available', { minutes: f.minutes, kinds: f.kinds, tags: f.tags, location: f.location, note: f.note });
    $('#statusLine').textContent = `You are available for ${f.minutes} minutes.`;
    saveLocal();
    toast('You are now listed as available');
  };

  $('#extendBtn').onclick = () => {
    socket.emit('extend', { minutes: 10 });
    toast('Extended +10 minutes');
  };

  $('#doneBtn').onclick = () => {
    socket.emit('done');
    $('#statusLine').textContent = 'You marked yourself as done.';
    toast('Marked as done');
  };

  $('#shareBtn').onclick = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('r', $('#room').value.trim() || 'main');
    navigator.clipboard.writeText(url.toString()).then(() => {
      toast('Room link copied');
    }, () => {
      prompt('Copy this link:', url.toString());
    });
  };

  $$('input').forEach((inp) => inp.addEventListener('input', () => {
    saveLocal();
    if (inp.id === 'filter') renderList();
  }));
  $$('.kind').forEach((cb) => cb.addEventListener('change', saveLocal));

  socket.on('connect', () => {
    joinIfReady();
  });
  socket.on('roster', (data) => {
    lastRoster = data || { users: [], now: Date.now() };
    renderList();
  });

  timer = setInterval(renderList, 1000);
}

function renderList() {
  const now = Date.now();
  const skew = lastRoster.now ? now - lastRoster.now : 0;
  $('#nowline').textContent = new Date(now).toLocaleTimeString();

  const filter = ($('#filter').value || '').toLowerCase();
  const users = (lastRoster.users || []).filter((u) => {
    const hay = [u.name, ...(u.kinds || []), u.tags, u.location, u.note].join(' ').toLowerCase();
    return hay.includes(filter);
  });

  $('#list').innerHTML = users.map((u) => personHTML(u, skew)).join('');
}

function personHTML(u, skew) {
  const now = Date.now() - skew;
  const delta = u.availableUntil - now;
  const left = formatDuration(Math.max(0, delta));
  const untilTime = new Date(u.availableUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const kinds = (u.kinds || []).map((k) => `<span class="badge">${esc(k)}</span>`).join('');
  const tags = u.tags ? u.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('') : '';
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

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c] || c));
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin <= 0) return '0m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function linkify(s) {
  const text = String(s || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) {
    const safe = esc(text);
    return `<a href="${safe}" target="_blank" rel="noopener">${safe}</a>`;
  }
  return esc(text);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('show'); }, 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, 2000);
}

function init() {
  loadLocal();
  fromQS();
  bind();
  joinIfReady();
  renderList();
}

window.addEventListener('DOMContentLoaded', init);
