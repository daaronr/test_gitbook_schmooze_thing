const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const socket = io();

let topics = [];
let responses = [];
let lastRoster = { users: [], now: Date.now() };
let rosterTimer = null;
let mediaRecorder = null;
let recordingChunks = [];
let recordedBlob = null;
let playlistAudio = null;
let availabilityConfig = { categories: [], contactMethods: [], maxSelections: 6 };
let userContactMethods = []; // User's configured contact methods

// === IDENTITY & STATE ===

function readIdentity() {
  return {
    name: $('#name').value.trim(),
    room: $('#room').value.trim() || 'main',
    tags: $('#tags')?.value.trim() || '',
    note: $('#note')?.value.trim() || '',
  };
}

function readAvailability() {
  return {
    ...readIdentity(),
    kinds: $$('.kind:checked').map((cb) => cb.value),
    minutes: Math.max(1, Math.min(240, parseInt($('#minutes').value || '15', 10))),
    contactMethods: userContactMethods.filter(m => m.value), // Only include filled ones
  };
}

function saveLocal() {
  const data = {
    ...readIdentity(),
    kinds: $$('.kind:checked').map((cb) => cb.value),
    minutes: $('#minutes').value,
    darkMode: document.body.classList.contains('dark-mode'),
    contactMethods: $('#saveContactMethods')?.checked ? userContactMethods : [],
    topicTitle: $('#topicTitle')?.value || '',
    topicPrompt: $('#topicPrompt')?.value || '',
    topicDue: $('#topicDue')?.value || '',
    topicMax: $('#topicMax')?.value || '',
  };
  localStorage.setItem('whos_available_state', JSON.stringify(data));
}

function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem('whos_available_state') || '{}');
    if (data.name) $('#name').value = data.name;
    if (data.room) $('#room').value = data.room;
    if (data.tags && $('#tags')) $('#tags').value = data.tags;
    if (data.note && $('#note')) $('#note').value = data.note;
    if (data.minutes) $('#minutes').value = data.minutes;
    if (data.darkMode) document.body.classList.add('dark-mode');
    if (Array.isArray(data.contactMethods) && data.contactMethods.length > 0) {
      userContactMethods = data.contactMethods;
      if ($('#saveContactMethods')) $('#saveContactMethods').checked = true;
    }
    if (data.topicTitle && $('#topicTitle')) $('#topicTitle').value = data.topicTitle;
    if (data.topicPrompt && $('#topicPrompt')) $('#topicPrompt').value = data.topicPrompt;
    if (data.topicDue && $('#topicDue')) $('#topicDue').value = data.topicDue;
    if (data.topicMax && $('#topicMax')) $('#topicMax').value = data.topicMax;

    // Restore kinds after config loads
    if (Array.isArray(data.kinds)) {
      setTimeout(() => {
        $$('.kind').forEach((cb) => { cb.checked = data.kinds.includes(cb.value); });
      }, 100);
    }
  } catch { /* ignore */ }
}

function fromQS() {
  const url = new URL(window.location.href);
  const r = url.searchParams.get('r');
  if (r) $('#room').value = r;
}

// === CONFIG LOADING ===

async function loadAvailabilityConfig() {
  try {
    const res = await fetch('/api/config/availability-types');
    availabilityConfig = await res.json();
    renderCategories();
    renderContactMethodsUI();
  } catch (err) {
    console.error('Could not load config:', err);
  }
}

// === RENDER CATEGORIES ===

function renderCategories() {
  const container = $('#categoriesContainer');
  if (!container) return;

  let savedKinds = [];
  try {
    const data = JSON.parse(localStorage.getItem('whos_available_state') || '{}');
    savedKinds = Array.isArray(data.kinds) ? data.kinds : [];
  } catch { /* ignore */ }

  // Render basic (non-advanced) categories
  const basicHtml = availabilityConfig.categories
    .filter(cat => !cat.advanced)
    .map(cat => `
      <div class="category-section">
        <label class="category-label">${esc(cat.label)}</label>
        <div class="kinds-grid">
          ${cat.types.map(t => `
            <label class="kind-label" title="${esc(t.label)}">
              <input type="checkbox" class="kind" value="${esc(t.id)}" data-duration="${t.duration}"
                ${savedKinds.includes(t.id) ? 'checked' : ''}>
              <span class="kind-icon">${t.icon}</span>
              <span class="kind-text">${esc(t.label)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');

  // Render advanced categories
  const advancedHtml = availabilityConfig.categories
    .filter(cat => cat.advanced)
    .map(cat => `
      <div class="category-section">
        <label class="category-label">${esc(cat.label)}</label>
        <div class="kinds-grid">
          ${cat.types.map(t => `
            <label class="kind-label" title="${esc(t.label)}">
              <input type="checkbox" class="kind" value="${esc(t.id)}" data-duration="${t.duration}"
                ${savedKinds.includes(t.id) ? 'checked' : ''}>
              <span class="kind-icon">${t.icon}</span>
              <span class="kind-text">${esc(t.label)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');

  container.innerHTML = basicHtml;

  // Add advanced categories to the advanced settings section
  const advancedContainer = $('#advancedKindsContainer');
  if (advancedContainer) {
    advancedContainer.innerHTML = advancedHtml;
  }

  $$('.kind').forEach(cb => cb.addEventListener('change', onKindChange));
}

function onKindChange() {
  const checked = $$('.kind:checked');
  if (checked.length > 0) {
    const totalDuration = checked.reduce((sum, cb) => sum + parseInt(cb.dataset.duration || 15, 10), 0);
    const avgDuration = Math.round(totalDuration / checked.length);
    $('#minutes').value = avgDuration;
  }
  saveLocal();
}

function getKindLabel(kindId) {
  for (const cat of availabilityConfig.categories) {
    const type = cat.types.find(t => t.id === kindId);
    if (type) return `${type.icon} ${type.label}`;
  }
  return kindId;
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
        <option value="">Select...</option>
        ${availabilityConfig.contactMethods.map(cm => `
          <option value="${cm.id}" ${m.type === cm.id ? 'selected' : ''}>${cm.icon} ${cm.label}</option>
        `).join('')}
      </select>
      <input type="text" class="contact-value" data-index="${i}"
        placeholder="${getContactPlaceholder(m.type)}" value="${esc(m.value || '')}">
      <button type="button" class="ghost remove-btn" data-index="${i}">×</button>
    </div>
  `).join('');

  // Bind events
  $$('.contact-type').forEach(sel => sel.addEventListener('change', onContactTypeChange));
  $$('.contact-value').forEach(inp => inp.addEventListener('input', onContactValueChange));
  $$('.remove-btn').forEach(btn => btn.addEventListener('click', onRemoveContact));
}

function getContactPlaceholder(typeId) {
  const method = availabilityConfig.contactMethods.find(m => m.id === typeId);
  return method?.placeholder || 'Enter value...';
}

function onContactTypeChange(e) {
  const i = parseInt(e.target.dataset.index, 10);
  userContactMethods[i].type = e.target.value;
  renderContactMethodsUI();
  saveLocal();
}

function onContactValueChange(e) {
  const i = parseInt(e.target.dataset.index, 10);
  userContactMethods[i].value = e.target.value;
  saveLocal();
}

function onRemoveContact(e) {
  const i = parseInt(e.target.dataset.index, 10);
  userContactMethods.splice(i, 1);
  if (userContactMethods.length === 0) {
    userContactMethods.push({ type: '', value: '' });
  }
  renderContactMethodsUI();
  saveLocal();
}

function onAddContact() {
  userContactMethods.push({ type: '', value: '' });
  renderContactMethodsUI();
}

function getContactUrl(method) {
  const config = availabilityConfig.contactMethods.find(m => m.id === method.type);
  if (!config?.urlTemplate) return null;
  return config.urlTemplate.replace('{value}', encodeURIComponent(method.value));
}

// === DARK MODE ===

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  $('#darkModeToggle').textContent = isDark ? '☀️' : '🌙';
  saveLocal();
}

// === ADVANCED TOGGLE ===

function toggleAdvanced() {
  const section = $('#advancedSettings');
  const btn = $('#toggleAdvanced');
  if (section.classList.contains('hidden')) {
    section.classList.remove('hidden');
    btn.textContent = 'Hide options';
  } else {
    section.classList.add('hidden');
    btn.textContent = 'Show more options';
  }
}

// === BINDINGS ===

function bind() {
  $$('input, textarea, select').forEach((el) => el.addEventListener('input', saveLocal));

  $('#darkModeToggle')?.addEventListener('click', toggleDarkMode);
  $('#toggleAdvanced')?.addEventListener('click', toggleAdvanced);
  $('#addContactMethod')?.addEventListener('click', onAddContact);

  $('#shareBtn').onclick = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('r', $('#room').value.trim() || 'main');
    navigator.clipboard.writeText(url.toString()).then(() => {
      toast('Room link copied!');
    }, () => {
      prompt('Copy this link:', url.toString());
    });
  };

  $('#newTopicBtn')?.addEventListener('click', createTopic);

  $$('.dur').forEach((btn) => btn.addEventListener('click', () => {
    $('#minutes').value = btn.dataset.min;
    saveLocal();
  }));
  $('#goBtn').onclick = goAvailable;
  $('#extendBtn').onclick = extendAvailability;
  $('#doneBtn').onclick = markDone;

  $('#rosterFilter')?.addEventListener('input', renderRoster);

  $('#recordBtn')?.addEventListener('click', startRecording);
  $('#stopBtn')?.addEventListener('click', stopRecording);
  $('#submitResponseBtn')?.addEventListener('click', submitResponse);
  $('#fileInput')?.addEventListener('change', handleFileSelect);
  $('#topicFilter')?.addEventListener('input', renderTopics);

  socket.on('connect', () => joinIfReady());
  socket.on('topics', (data) => { topics = data || []; renderTopics(); syncTopicDropdown(); });
  socket.on('responses', (data) => { responses = data || []; renderTopics(); });
  socket.on('roster', (data) => { lastRoster = data || { users: [], now: Date.now() }; renderRoster(); });

  rosterTimer = setInterval(renderRoster, 1000);
}

// === SOCKET ACTIONS ===

async function joinIfReady() {
  const ident = readIdentity();
  if (!ident.name) return;
  socket.emit('join', {
    name: ident.name,
    room: ident.room,
    kinds: [],
    tags: ident.tags,
    note: ident.note,
  });
  await loadTopicsAndResponses();
}

async function loadTopicsAndResponses() {
  const room = readIdentity().room;
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

async function goAvailable() {
  const f = readAvailability();
  if (!f.name) { alert('Please enter your name.'); return; }
  socket.emit('join', {
    name: f.name, room: f.room, kinds: f.kinds, tags: f.tags,
    note: f.note, contactMethods: f.contactMethods
  });
  socket.emit('set-available', {
    minutes: f.minutes, kinds: f.kinds, tags: f.tags,
    note: f.note, contactMethods: f.contactMethods
  });
  $('#statusLine').textContent = `You're available for ${f.minutes} min`;
  toast('You are now available!');
}

function extendAvailability() {
  socket.emit('extend', { minutes: 10 });
  toast('Extended +10 minutes');
}

function markDone() {
  socket.emit('done');
  $('#statusLine').textContent = '';
  toast('Marked as done');
}

// === TOPICS ===

async function createTopic() {
  const ident = readIdentity();
  if (!ident.name) { alert('Please enter your name.'); return; }
  const payload = {
    title: $('#topicTitle')?.value.trim() || '',
    prompt: $('#topicPrompt')?.value.trim() || '',
    room: ident.room,
    dueAt: $('#topicDue')?.value || '',
    maxMinutes: $('#topicMax')?.value || 2,
    createdBy: ident.name
  };
  if (!payload.title) { alert('Topic title required.'); return; }
  try {
    const res = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed');
    const topic = await res.json();
    topics.unshift(topic);
    syncTopicDropdown();
    renderTopics();
    toast('Topic created');
  } catch (err) {
    console.error(err);
    toast('Could not create topic');
  }
}

function syncTopicDropdown() {
  const select = $('#responseTopic');
  if (!select) return;
  const room = readIdentity().room;
  const list = topics.filter((t) => t.room === room);
  select.innerHTML = list.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
}

function renderTopics() {
  const now = Date.now();
  const nowline = $('#nowline');
  if (nowline) nowline.textContent = new Date(now).toLocaleTimeString();

  const filter = ($('#topicFilter')?.value || '').toLowerCase();
  const room = readIdentity().room;
  const list = topics
    .filter((t) => t.room === room)
    .filter((t) => [t.title, t.prompt, t.createdBy].join(' ').toLowerCase().includes(filter))
    .sort((a, b) => b.createdAt - a.createdAt);

  const html = list.map((t) => {
    const due = t.dueAt ? `Due ${new Date(t.dueAt).toLocaleString()}` : 'Flexible';
    const resp = responses.filter((r) => r.topicId === t.id).sort((a, b) => a.createdAt - b.createdAt);
    const respHtml = resp.map((r) => `
      <div class="response">
        <div>
          <strong>${esc(r.name)}</strong> <span class="muted small">${timeAgo(r.createdAt)}</span>
          ${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}
        </div>
        <audio controls src="${r.audioUrl}" class="slim-audio"></audio>
      </div>
    `).join('');

    return `
      <div class="topic">
        <div class="topic-header">
          <div>
            <div class="name">${esc(t.title)}</div>
            <div class="muted small">${esc(t.prompt || '')} · ${due}</div>
          </div>
          <div class="badges">
            <span class="badge">${resp.length} responses</span>
            <button class="ghost small" data-play="${t.id}">▶ Play all</button>
          </div>
        </div>
        <div class="responses">${respHtml || '<div class="muted small">No responses yet.</div>'}</div>
      </div>
    `;
  }).join('');

  const container = $('#topicsList');
  if (container) {
    container.innerHTML = html || '<div class="muted">No topics yet.</div>';
    $$('button[data-play]').forEach((btn) => btn.onclick = () => playAssembled(btn.dataset.play));
  }
}

function playAssembled(topicId) {
  const queue = responses.filter((r) => r.topicId === topicId).sort((a, b) => a.createdAt - b.createdAt);
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
      stream.getTracks().forEach((t) => t.stop());
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
  if (!topicId) { alert('Pick a topic first.'); return; }
  const ident = readIdentity();
  if (!ident.name) { alert('Please enter your name.'); return; }
  if (!recordedBlob) { toast('Record or select audio first'); return; }

  try {
    const uploadUrl = await uploadClip(recordedBlob);
    const payload = { topicId, name: ident.name, room: ident.room, tags: ident.tags, note: ident.note, audioUrl: uploadUrl, duration: 0 };
    const res = await fetch('/api/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Save failed');
    recordedBlob = null;
    $('#preview').src = '';
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
  $('#preview').src = URL.createObjectURL(blob);
}

// === ROSTER ===

function renderRoster() {
  const now = Date.now();
  const nowlineRoster = $('#nowlineRoster');
  if (nowlineRoster) nowlineRoster.textContent = new Date(now).toLocaleTimeString();

  const filter = ($('#rosterFilter')?.value || '').toLowerCase();
  const users = (lastRoster.users || []).filter((u) => {
    const hay = [u.name, ...(u.kinds || []), u.tags, u.note].join(' ').toLowerCase();
    return hay.includes(filter);
  });

  const container = $('#list');
  if (container) {
    container.innerHTML = users.map((u) => personHTML(u)).join('') || '<div class="muted">No one is available right now.</div>';
  }
}

function personHTML(u) {
  const now = Date.now();
  const delta = u.availableUntil - now;
  const left = formatDuration(Math.max(0, delta));
  const untilTime = new Date(u.availableUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const kinds = (u.kinds || []).map((k) => `<span class="badge">${getKindLabel(k)}</span>`).join('');
  const tags = u.tags ? u.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('') : '';

  // Contact buttons
  let contactBtns = '';
  if (u.contactMethods && u.contactMethods.length > 0) {
    contactBtns = '<div class="contact-buttons">' + u.contactMethods.map(m => {
      const config = availabilityConfig.contactMethods.find(c => c.id === m.type);
      if (!config || !m.value) return '';
      const url = config.urlTemplate ? config.urlTemplate.replace('{value}', encodeURIComponent(m.value)) : null;
      if (url) {
        return `<a href="${url}" class="contact-btn" target="_blank" rel="noopener">${config.icon} ${config.label}</a>`;
      } else {
        return `<span class="badge">${config.icon} ${esc(m.value)}</span>`;
      }
    }).join('') + '</div>';
  }

  return `
    <div class="card person">
      <div class="rowtop">
        <div class="name">${esc(u.name)}</div>
        <div class="timeleft">⏱️ ${left} (until ${untilTime})</div>
      </div>
      ${kinds ? `<div class="kinds">${kinds}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${u.note ? `<div class="note">${esc(u.note)}</div>` : ''}
      ${contactBtns}
    </div>
  `;
}

// === UTILITIES ===

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
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
  return `${mins}m ${secs}s`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); }, 2000);
}

// === INIT ===

async function init() {
  loadLocal();
  fromQS();
  await loadAvailabilityConfig();
  bind();
  renderTopics();
  renderRoster();
  joinIfReady();

  // Update dark mode button icon
  const isDark = document.body.classList.contains('dark-mode');
  const btn = $('#darkModeToggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

window.addEventListener('DOMContentLoaded', init);
