const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const socket = io();

let topics = [];
let responses = [];
let lastRoster = { users: [], now: Date.now() };
let rosterTimer = null;
let statusTimer = null;
let mediaRecorder = null;
let recordingChunks = [];
let recordedBlob = null;
let playlistAudio = null;
let availabilityConfig = { categories: [], contactMethods: [], maxSelections: 6 };
let userContactMethods = [];
let selectedKinds = new Set();
let myAvailableUntil = null;

// === IDENTITY & STATE ===

function getName() { return $('#name').value.trim(); }
function getRoom() { return $('#room').value.trim() || 'main'; }

function saveLocal() {
  const data = {
    name: getName(),
    room: getRoom(),
    darkMode: document.body.classList.contains('dark-mode'),
    contactMethods: $('#saveContactMethods')?.checked ? userContactMethods : [],
    selectedMinutes: getSelectedMinutes(),
  };
  localStorage.setItem('whos_available_state', JSON.stringify(data));
}

function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem('whos_available_state') || '{}');
    if (data.name) $('#name').value = data.name;
    if (data.room) $('#room').value = data.room;
    if (data.darkMode) document.body.classList.add('dark-mode');
    if (Array.isArray(data.contactMethods) && data.contactMethods.length > 0) {
      userContactMethods = data.contactMethods;
      if ($('#saveContactMethods')) $('#saveContactMethods').checked = true;
    }
    if (data.selectedMinutes) {
      setDuration(data.selectedMinutes);
    }
  } catch { /* ignore */ }
}

function fromQS() {
  const url = new URL(window.location.href);
  const r = url.searchParams.get('r');
  if (r) $('#room').value = r;
}

// === CONFIG ===

async function loadAvailabilityConfig() {
  try {
    const res = await fetch('/api/config/availability-types');
    availabilityConfig = await res.json();
    renderQuickTaps();
    renderContactMethodsUI();
  } catch (err) {
    console.error('Could not load config:', err);
  }
}

// === QUICK-TAP AVAILABILITY ===

function renderQuickTaps() {
  const container = $('#quickTaps');
  if (!container) return;

  // Combine all non-advanced categories into one flat list of tappable options
  const allTypes = [];
  for (const cat of availabilityConfig.categories) {
    if (cat.advanced) continue;
    for (const t of cat.types) {
      allTypes.push(t);
    }
  }

  container.innerHTML = allTypes.map(t => `
    <button class="quick-tap" data-kind="${esc(t.id)}" data-duration="${t.duration}">
      <span class="quick-tap-icon">${t.icon}</span>
      <div>
        <div class="quick-tap-label">${esc(t.label)}</div>
        <div class="quick-tap-sub">${t.duration}m default</div>
      </div>
    </button>
  `).join('');

  // Bind tap handlers
  $$('.quick-tap').forEach(btn => {
    btn.addEventListener('click', () => onQuickTap(btn));
  });
}

function onQuickTap(btn) {
  const kindId = btn.dataset.kind;

  // Toggle selection
  if (selectedKinds.has(kindId)) {
    selectedKinds.delete(kindId);
    btn.classList.remove('selected');
  } else {
    selectedKinds.add(kindId);
    btn.classList.add('selected');
  }

  // If anything is selected, go available immediately
  if (selectedKinds.size > 0) {
    ensureNameThen(() => goAvailable());
  } else {
    // Nothing selected = done
    markDone();
  }
}

function ensureNameThen(callback) {
  if (getName()) {
    callback();
    return;
  }

  // Show name prompt overlay
  const overlay = document.createElement('div');
  overlay.className = 'name-prompt';
  overlay.innerHTML = `
    <div class="name-prompt-card">
      <h2>What's your name?</h2>
      <p>So your friends know who's available.</p>
      <input type="text" id="namePromptInput" placeholder="Your name" autofocus>
      <button class="primary-btn full-width" id="namePromptBtn">Continue</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#namePromptInput');
  const submitBtn = overlay.querySelector('#namePromptBtn');

  function submit() {
    const name = input.value.trim();
    if (!name) return;
    $('#name').value = name;
    saveLocal();
    overlay.remove();
    callback();
  }

  submitBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  input.focus();
}

// === DURATION ===

function getSelectedMinutes() {
  const active = $('.dur-pill.active');
  return active ? parseInt(active.dataset.min, 10) : 15;
}

function setDuration(minutes) {
  $$('.dur-pill').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.min, 10) === minutes);
  });
}

// === SOCKET ACTIONS ===

function joinRoom() {
  const name = getName();
  if (!name) return;
  socket.emit('join', {
    name,
    room: getRoom(),
    kinds: [],
    tags: '',
    note: '',
  });
}

async function goAvailable() {
  const name = getName();
  if (!name) return;

  const kinds = Array.from(selectedKinds);
  const minutes = getSelectedMinutes();

  socket.emit('join', {
    name, room: getRoom(), kinds,
    tags: '', note: '',
    contactMethods: userContactMethods.filter(m => m.value),
  });

  socket.emit('set-available', {
    minutes, kinds,
    tags: '', note: '',
    contactMethods: userContactMethods.filter(m => m.value),
  });

  myAvailableUntil = Date.now() + minutes * 60 * 1000;
  showStatusBanner(kinds, minutes);
  saveLocal();
  toast('You\'re available!');
}

function extendAvailability() {
  socket.emit('extend', { minutes: 10 });
  if (myAvailableUntil) {
    myAvailableUntil += 10 * 60 * 1000;
  }
  toast('Extended +10 min');
}

function markDone() {
  socket.emit('done');
  myAvailableUntil = null;
  hideStatusBanner();
  clearSelections();
  toast('Marked as done');
}

function clearSelections() {
  selectedKinds.clear();
  $$('.quick-tap').forEach(btn => btn.classList.remove('selected'));
}

// === STATUS BANNER ===

function showStatusBanner(kinds, minutes) {
  const banner = $('#statusBanner');
  const kindLabels = kinds.map(k => getKindLabel(k)).join(', ');
  $('#statusMessage').textContent = kindLabels || 'You\'re available';
  banner.classList.remove('hidden');
  updateStatusTimer();
}

function hideStatusBanner() {
  $('#statusBanner').classList.add('hidden');
}

function updateStatusTimer() {
  if (!myAvailableUntil) return;
  const remaining = myAvailableUntil - Date.now();
  if (remaining <= 0) {
    hideStatusBanner();
    clearSelections();
    myAvailableUntil = null;
    return;
  }
  const timer = $('#statusTimer');
  if (timer) {
    timer.textContent = formatDuration(remaining) + ' remaining';
  }
}

// === CONTACT METHODS ===

function renderContactMethodsUI() {
  const container = $('#contactMethodsContainer');
  if (!container) return;

  if (userContactMethods.length === 0) {
    userContactMethods.push({ type: '', value: '' });
  }

  container.innerHTML = userContactMethods.map((m, i) => `
    <div class="contact-method-row" data-index="${i}">
      <select class="contact-type" data-index="${i}">
        <option value="">Type...</option>
        ${availabilityConfig.contactMethods.map(cm => `
          <option value="${cm.id}" ${m.type === cm.id ? 'selected' : ''}>${cm.icon} ${cm.label}</option>
        `).join('')}
      </select>
      <input type="text" class="contact-value" data-index="${i}"
        placeholder="${getContactPlaceholder(m.type)}" value="${esc(m.value || '')}">
      <button type="button" class="remove-btn" data-index="${i}">&times;</button>
    </div>
  `).join('');

  $$('.contact-type').forEach(sel => sel.addEventListener('change', (e) => {
    userContactMethods[parseInt(e.target.dataset.index, 10)].type = e.target.value;
    renderContactMethodsUI();
    saveLocal();
  }));
  $$('.contact-value').forEach(inp => inp.addEventListener('input', (e) => {
    userContactMethods[parseInt(e.target.dataset.index, 10)].value = e.target.value;
    saveLocal();
  }));
  $$('.remove-btn').forEach(btn => btn.addEventListener('click', (e) => {
    const i = parseInt(e.target.dataset.index, 10);
    userContactMethods.splice(i, 1);
    if (userContactMethods.length === 0) userContactMethods.push({ type: '', value: '' });
    renderContactMethodsUI();
    saveLocal();
  }));
}

function getContactPlaceholder(typeId) {
  const method = availabilityConfig.contactMethods.find(m => m.id === typeId);
  return method?.placeholder || 'Enter value...';
}

// === DARK MODE ===

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  saveLocal();
}

// === ROSTER ===

function renderRoster() {
  const now = Date.now();
  const users = (lastRoster.users || []).filter(u => u.availableUntil > now);

  // Update count
  const countEl = $('#rosterCount');
  if (countEl) countEl.textContent = users.length;

  const container = $('#list');
  if (!container) return;

  if (users.length === 0) {
    container.innerHTML = '<div class="empty-state">No one is available right now.<br>Tap a button above to signal you\'re free!</div>';
    return;
  }

  container.innerHTML = users.map(u => {
    const delta = u.availableUntil - now;
    const left = formatDuration(Math.max(0, delta));
    const initial = (u.name || '?')[0].toUpperCase();

    const kinds = (u.kinds || []).map(k =>
      `<span class="kind-badge">${getKindLabel(k)}</span>`
    ).join('');

    let contacts = '';
    if (u.contactMethods && u.contactMethods.length > 0) {
      contacts = '<div class="person-contacts">' + u.contactMethods.map(m => {
        const config = availabilityConfig.contactMethods.find(c => c.id === m.type);
        if (!config || !m.value) return '';
        const url = config.urlTemplate ? config.urlTemplate.replace('{value}', encodeURIComponent(m.value)) : null;
        if (url) {
          return `<a href="${url}" class="contact-link" target="_blank" rel="noopener">${config.icon} ${config.label}</a>`;
        }
        return `<span class="kind-badge">${config.icon} ${esc(m.value)}</span>`;
      }).join('') + '</div>';
    }

    return `
      <div class="person-card">
        <div class="person-avatar">${initial}</div>
        <div class="person-info">
          <div class="person-name">${esc(u.name)}</div>
          ${kinds ? `<div class="person-kinds">${kinds}</div>` : ''}
          ${u.note ? `<div class="person-note">${esc(u.note)}</div>` : ''}
          ${contacts}
        </div>
        <div class="person-timer">${left}</div>
      </div>
    `;
  }).join('');
}

// === TOPICS ===

async function createTopic() {
  const name = getName();
  if (!name) { ensureNameThen(() => createTopic()); return; }
  const title = $('#topicTitle')?.value.trim();
  if (!title) { toast('Enter a topic title'); return; }

  try {
    const res = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        prompt: $('#topicPrompt')?.value.trim() || '',
        room: getRoom(),
        dueAt: $('#topicDue')?.value || '',
        maxMinutes: $('#topicMax')?.value || 2,
        createdBy: name,
      })
    });
    if (!res.ok) throw new Error('Failed');
    const topic = await res.json();
    topics.unshift(topic);
    syncTopicDropdown();
    renderTopics();
    $('#topicTitle').value = '';
    toast('Topic created');
  } catch (err) {
    console.error(err);
    toast('Could not create topic');
  }
}

function syncTopicDropdown() {
  const select = $('#responseTopic');
  if (!select) return;
  const room = getRoom();
  const list = topics.filter(t => t.room === room);
  select.innerHTML = list.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
}

function renderTopics() {
  const room = getRoom();
  const list = topics
    .filter(t => t.room === room)
    .sort((a, b) => b.createdAt - a.createdAt);

  // Update count
  const countEl = $('#topicCount');
  if (countEl) countEl.textContent = list.length;

  const container = $('#topicsList');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state">No topics yet.</div>';
    return;
  }

  container.innerHTML = list.map(t => {
    const due = t.dueAt ? `Due ${new Date(t.dueAt).toLocaleString()}` : '';
    const resp = responses.filter(r => r.topicId === t.id).sort((a, b) => a.createdAt - b.createdAt);

    const respHtml = resp.map(r => `
      <div class="response-item">
        <div>
          <strong>${esc(r.name)}</strong>
          <span class="muted small">${timeAgo(r.createdAt)}</span>
          <button class="del-btn del-resp" data-id="${r.id}">remove</button>
        </div>
        <audio controls src="${r.audioUrl}" class="slim-audio"></audio>
      </div>
    `).join('');

    return `
      <div class="topic-item">
        <div class="topic-item-header">
          <div>
            <div class="topic-title">${esc(t.title)}</div>
            <div class="topic-meta">
              ${esc(t.createdBy)} &middot; ${timeAgo(t.createdAt)}${due ? ' &middot; ' + due : ''}
            </div>
          </div>
          <div class="topic-badges">
            <span class="badge-sm">${resp.length} clip${resp.length !== 1 ? 's' : ''}</span>
            <button class="secondary-btn" style="padding:4px 10px;font-size:12px" data-play="${t.id}">Play</button>
            <button class="del-btn del-topic" data-id="${t.id}">Delete</button>
          </div>
        </div>
        ${t.prompt ? `<div class="person-note" style="margin-top:6px">${esc(t.prompt)}</div>` : ''}
        ${resp.length > 0 ? `<div class="topic-responses">${respHtml}</div>` : ''}
      </div>
    `;
  }).join('');

  $$('button[data-play]').forEach(btn => btn.onclick = () => playAssembled(btn.dataset.play));
  $$('.del-topic').forEach(btn => btn.onclick = () => deleteTopic(btn.dataset.id));
  $$('.del-resp').forEach(btn => btn.onclick = () => deleteResponse(btn.dataset.id));
}

async function deleteTopic(topicId) {
  if (!confirm('Delete this topic and all its responses?')) return;
  try {
    const res = await fetch(`/api/topics/${topicId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed');
    topics = topics.filter(t => t.id !== topicId);
    responses = responses.filter(r => r.topicId !== topicId);
    renderTopics();
    syncTopicDropdown();
    toast('Topic deleted');
  } catch (err) {
    console.error(err);
    toast('Could not delete topic');
  }
}

async function deleteResponse(responseId) {
  if (!confirm('Delete this response?')) return;
  try {
    const res = await fetch(`/api/responses/${responseId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed');
    responses = responses.filter(r => r.id !== responseId);
    renderTopics();
    toast('Response deleted');
  } catch (err) {
    console.error(err);
    toast('Could not delete response');
  }
}

function playAssembled(topicId) {
  const queue = responses.filter(r => r.topicId === topicId).sort((a, b) => a.createdAt - b.createdAt);
  if (!queue.length) { toast('No responses'); return; }
  if (!playlistAudio) {
    playlistAudio = new Audio();
    playlistAudio.addEventListener('ended', () => {
      const nxt = playlistAudio.dataset.nextQueue ? JSON.parse(playlistAudio.dataset.nextQueue) : [];
      if (!nxt.length) return;
      const next = nxt.shift();
      playlistAudio.dataset.nextQueue = JSON.stringify(nxt);
      playlistAudio.src = next.audioUrl;
      playlistAudio.play();
    });
  }
  playlistAudio.dataset.nextQueue = JSON.stringify(queue.slice(1));
  playlistAudio.src = queue[0].audioUrl;
  playlistAudio.play();
  toast('Playing responses');
}

// === AUDIO RECORDING ===

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  recordedBlob = file;
  updatePreview(recordedBlob);
  $('#submitResponseBtn').disabled = false;
  $('#recordStatus').textContent = `Ready: ${file.name}`;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Recording not supported.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordingChunks, { type: 'audio/webm' });
      updatePreview(recordedBlob);
      $('#submitResponseBtn').disabled = false;
      $('#recordStatus').textContent = 'Recording ready';
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    $('#recordStatus').textContent = 'Recording...';
    $('#recordBtn').disabled = true;
    $('#stopBtn').disabled = false;
  } catch (err) {
    console.error(err);
    toast('Could not start recording');
  }
}

function stopRecording() {
  if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
  $('#recordBtn').disabled = false;
  $('#stopBtn').disabled = true;
}

async function submitResponse() {
  const topicId = $('#responseTopic')?.value;
  if (!topicId) { toast('Pick a topic first'); return; }
  const name = getName();
  if (!name) { ensureNameThen(() => submitResponse()); return; }
  if (!recordedBlob) { toast('Record or select audio first'); return; }

  try {
    const uploadUrl = await uploadClip(recordedBlob);
    const duration = parseInt($('#preview').dataset.duration || '0', 10);
    const res = await fetch('/api/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicId, name, room: getRoom(),
        tags: '', note: '',
        audioUrl: uploadUrl, duration,
      })
    });
    if (!res.ok) throw new Error('Save failed');
    recordedBlob = null;
    $('#preview').src = '';
    $('#preview').dataset.duration = '0';
    if ($('#fileInput')) $('#fileInput').value = '';
    $('#submitResponseBtn').disabled = true;
    $('#recordStatus').textContent = 'Submitted!';
    toast('Response saved');
  } catch (err) {
    console.error(err);
    toast('Could not submit');
  }
}

async function uploadClip(blob) {
  const fd = new FormData();
  fd.append('audio', blob, 'clip.webm');
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  return (await res.json()).url;
}

function updatePreview(blob) {
  if (!blob) return;
  const preview = $('#preview');
  preview.src = URL.createObjectURL(blob);
  preview.onloadedmetadata = () => {
    preview.dataset.duration = Math.round(preview.duration) || 0;
  };
}

// === UTILITIES ===

function getKindLabel(kindId) {
  for (const cat of availabilityConfig.categories) {
    const type = cat.types.find(t => t.id === kindId);
    if (type) return `${type.icon} ${type.label}`;
  }
  return kindId;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
  );
}

function timeAgo(ts) {
  const delta = Date.now() - ts;
  const mins = Math.round(delta / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); }, 2000);
}

async function loadTopicsAndResponses() {
  const room = getRoom();
  try {
    const [tRes, rRes] = await Promise.all([
      fetch(`/api/topics?room=${encodeURIComponent(room)}`),
      fetch(`/api/responses?room=${encodeURIComponent(room)}`)
    ]);
    topics = await tRes.json();
    responses = await rRes.json();
    renderTopics();
    syncTopicDropdown();
  } catch (err) {
    console.error(err);
  }
}

// === BINDINGS ===

function bind() {
  // Settings toggle
  $('#settingsToggle')?.addEventListener('click', () => {
    const panel = $('#setupPanel');
    panel.classList.toggle('hidden');
    // If showing and no name, focus name input
    if (!panel.classList.contains('hidden') && !getName()) {
      $('#name').focus();
    }
  });

  // Name/room changes
  $('#name')?.addEventListener('input', saveLocal);
  $('#room')?.addEventListener('change', () => {
    saveLocal();
    joinRoom();
    loadTopicsAndResponses();
  });

  // Dark mode
  $('#darkModeToggle')?.addEventListener('click', toggleDarkMode);

  // Contact methods
  $('#addContactMethod')?.addEventListener('click', () => {
    userContactMethods.push({ type: '', value: '' });
    renderContactMethodsUI();
  });

  // Share/invite
  $('#shareBtn')?.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('r', getRoom());
    navigator.clipboard.writeText(url.toString()).then(
      () => toast('Invite link copied!'),
      () => prompt('Copy this link:', url.toString())
    );
  });

  // Duration pills
  $$('.dur-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.dur-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveLocal();
      // If already available, update duration
      if (myAvailableUntil) {
        goAvailable();
      }
    });
  });

  // Status banner actions
  $('#extendBtn')?.addEventListener('click', extendAvailability);
  $('#doneBtn')?.addEventListener('click', markDone);

  // Topics
  $('#newTopicBtn')?.addEventListener('click', createTopic);
  $('#recordBtn')?.addEventListener('click', startRecording);
  $('#stopBtn')?.addEventListener('click', stopRecording);
  $('#submitResponseBtn')?.addEventListener('click', submitResponse);
  $('#fileInput')?.addEventListener('change', handleFileSelect);

  // Socket events
  socket.on('connect', () => joinRoom());
  socket.on('topics', data => { topics = data || []; renderTopics(); syncTopicDropdown(); });
  socket.on('responses', data => { responses = data || []; renderTopics(); });
  socket.on('roster', data => { lastRoster = data || { users: [], now: Date.now() }; renderRoster(); });

  // Timers
  rosterTimer = setInterval(() => {
    renderRoster();
    updateStatusTimer();
  }, 1000);
}

// === INIT ===

async function init() {
  loadLocal();
  fromQS();
  await loadAvailabilityConfig();
  bind();
  renderTopics();
  renderRoster();

  // If user has a name, join automatically; otherwise show setup
  if (getName()) {
    joinRoom();
    loadTopicsAndResponses();
  } else {
    // Show setup panel so user enters their name
    $('#setupPanel')?.classList.remove('hidden');
  }
}

window.addEventListener('DOMContentLoaded', init);
