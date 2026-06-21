const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const BASE_PATH = getBasePath();
const STATE_KEY = 'whos_available_state';
const PROFILE_KEY = 'whos_available_profile';
const socket = io({ path: `${BASE_PATH}/socket.io` });

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
let selectedAudience = 'one-to-one';
let selectedCallLength = 15;
let availabilityUpdateTimer = null;
let myAvailableUntil = null;
let isCreatingTopic = false;
// Per-person "did it connect?" prompts, keyed by socket id. Held outside the
// card markup so they survive the 1s roster re-render.
const pendingConfirmations = new Map();

// === IDENTITY & STATE ===

function getName() { return $('#name').value.trim(); }
function getRoom() { return ($('#room').value.trim() || 'main').slice(0, 32); }
function getConversationNote() { return ($('#conversationNote')?.value || '').trim(); }

function saveProfile() {
  const name = getName();
  if (name) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, updatedAt: Date.now() }));
  } else {
    localStorage.removeItem(PROFILE_KEY);
  }
}

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLocal() {
  saveProfile();
  const data = {
    name: getName(),
    room: getRoom(),
    darkMode: document.body.classList.contains('dark-mode'),
    contactMethods: $('#saveContactMethods')?.checked ? userContactMethods : [],
    selectedMinutes: getSelectedMinutes(),
    selectedAudience,
    selectedCallLength,
    conversationNote: getConversationNote(),
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(data));
}

function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    const profile = loadProfile();
    const savedName = profile.name || data.name;
    if (savedName) $('#name').value = savedName;
    if (data.room) $('#room').value = data.room;
    if (data.darkMode) document.body.classList.add('dark-mode');
    if (Array.isArray(data.contactMethods) && data.contactMethods.length > 0) {
      userContactMethods = data.contactMethods;
      if ($('#saveContactMethods')) $('#saveContactMethods').checked = true;
    }
    if (data.selectedMinutes) {
      setDuration(data.selectedMinutes);
    }
    if (data.selectedAudience) {
      setAudience(data.selectedAudience);
    }
    if (data.selectedCallLength) {
      setCallLength(data.selectedCallLength);
    }
    if (typeof data.conversationNote === 'string' && $('#conversationNote')) {
      $('#conversationNote').value = data.conversationNote;
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
    const res = await fetch(apiUrl('/api/config/availability-types'));
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

  const modeCategory = availabilityConfig.categories.find(cat => cat.id === 'mode');
  const allTypes = modeCategory ? modeCategory.types : [];

  container.innerHTML = allTypes.map(t => `
    <button class="quick-tap" data-kind="${esc(t.id)}" data-duration="${t.duration}" ${tooltipAttr(getKindTooltip(t.id, t.label, t.duration))}>
      <span class="quick-tap-icon">${esc(getKindMark(t.id, t.label))}</span>
      <div>
        <div class="quick-tap-label">${esc(t.label)}</div>
        <div class="quick-tap-sub">Suggest ${formatMinutesLabel(t.duration)}</div>
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
    setCallLength(parseInt(btn.dataset.duration, 10));
  }

  // If anything is selected, go available immediately
  if (selectedKinds.size > 0) {
    ensureReadyThen(() => goAvailable());
  } else {
    // Nothing selected = done
    markDone();
  }
}

function ensureReadyThen(callback) {
  ensureNameThen(() => ensureReachThen(callback));
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
      <h2>Your display name</h2>
      <p>Saved on this device for every availability you create.</p>
      <input type="text" id="namePromptInput" placeholder="Your name" autofocus>
      <button class="primary-btn full-width" id="namePromptBtn">Continue</button>
      <button class="secondary-btn full-width name-cancel" id="namePromptCancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#namePromptInput');
  const submitBtn = overlay.querySelector('#namePromptBtn');
  const cancelBtn = overlay.querySelector('#namePromptCancel');

  function submit() {
    const name = input.value.trim();
    if (!name) return;
    $('#name').value = name;
    saveLocal();
    overlay.remove();
    callback();
  }

  function cancel() {
    clearSelections();
    overlay.remove();
  }

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

function ensureReachThen(callback) {
  if (hasUsableReachLink()) {
    callback();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'name-prompt';
  const defaultType = getSuggestedReachType();
  overlay.innerHTML = `
    <div class="name-prompt-card reach-prompt-card">
      <h2>Add your one-click reach link</h2>
      <p>People will tap this from your card to start now.</p>
      <label for="reachPromptType">Reach link type</label>
      <select id="reachPromptType" ${tooltipAttr('Choose the kind of direct link people should use to reach you.')}>
        ${getReachableContactConfigs().map(config => `
          <option value="${esc(config.id)}" ${config.id === defaultType ? 'selected' : ''}>${esc(config.label)}</option>
        `).join('')}
      </select>
      <label for="reachPromptValue">Phone number, app link, email, or meeting link</label>
      <input type="text" id="reachPromptValue" placeholder="${esc(getContactPlaceholder(defaultType))}" autocomplete="on" ${tooltipAttr('Add the exact phone number, WhatsApp number, email, or meeting link people should click.')}>
      <div id="reachPromptPreview" class="reach-preview">Choose a type and enter a value to preview the one-click link.</div>
      <label class="check-label reach-save-label">
        <input type="checkbox" id="reachPromptSave" checked> Save this reach link on this device
      </label>
      <button class="primary-btn full-width" id="reachPromptBtn" ${tooltipAttr('Save this one-click reach option, then put your card on the board.')}>Save and publish availability</button>
      <button class="secondary-btn full-width name-cancel" id="reachPromptCancel" ${tooltipAttr('Do not publish availability right now.')}>Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const typeInput = overlay.querySelector('#reachPromptType');
  const valueInput = overlay.querySelector('#reachPromptValue');
  const submitBtn = overlay.querySelector('#reachPromptBtn');
  const cancelBtn = overlay.querySelector('#reachPromptCancel');
  const saveInput = overlay.querySelector('#reachPromptSave');

  function syncPlaceholder() {
    valueInput.placeholder = getContactPlaceholder(typeInput.value);
    updateReachPromptPreview();
  }

  function updateReachPromptPreview() {
    const preview = overlay.querySelector('#reachPromptPreview');
    const config = availabilityConfig.contactMethods.find(c => c.id === typeInput.value);
    const href = config ? buildContactHref(config, valueInput.value) : null;
    if (!preview) return;
    preview.innerHTML = href
      ? `Opens: <a href="${esc(href)}" target="_blank" rel="noopener">${esc(href)}</a>`
      : 'Enter a usable phone number, app link, email address, or meeting URL.';
  }

  function submit() {
    const type = typeInput.value;
    const value = valueInput.value.trim();
    const config = availabilityConfig.contactMethods.find(c => c.id === type);
    if (!config || !value || !buildContactHref(config, value)) {
      toast('That does not look like a usable one-click link yet');
      valueInput.focus();
      return;
    }
    userContactMethods = [
      { type, value },
      ...userContactMethods.filter(m => m.type !== type || m.value !== value)
    ].slice(0, 5);
    if ($('#saveContactMethods')) $('#saveContactMethods').checked = saveInput.checked;
    renderContactMethodsUI();
    saveLocal();
    overlay.remove();
    callback();
  }

  function cancel() {
    clearSelections();
    overlay.remove();
  }

  typeInput.addEventListener('change', syncPlaceholder);
  valueInput.addEventListener('input', updateReachPromptPreview);
  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);
  valueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  updateReachPromptPreview();
  valueInput.focus();
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

function getSelectedCallLength() {
  return selectedCallLength;
}

function setCallLength(minutes) {
  const parsed = Number.isFinite(minutes) ? minutes : parseInt(minutes, 10);
  const safeMinutes = [5, 15, 20, 30, 45, 60].includes(parsed) ? parsed : 15;
  selectedCallLength = safeMinutes;
  $$('.call-length-pill').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.callMin, 10) === safeMinutes);
  });
}

function getCallLengthNote() {
  return `Suggested length: ${formatMinutesLabel(getSelectedCallLength())}`;
}

function getReachableContactConfigs() {
  return availabilityConfig.contactMethods.filter(config => {
    if (['phone', 'whatsapp', 'email'].includes(config.id)) return true;
    return Boolean(config.urlTemplate);
  });
}

function hasUsableReachLink() {
  return userContactMethods.some(method => {
    const config = availabilityConfig.contactMethods.find(c => c.id === method.type);
    return config && method.value && buildContactHref(config, method.value);
  });
}

// === DEVICE / PLATFORM ===

let _deviceProfile = null;

// Best-effort platform read. Used only to rank suggested reach methods,
// never to gate functionality, so a wrong guess degrades gracefully.
function getDeviceProfile() {
  if (_deviceProfile) return _deviceProfile;
  const ua = navigator.userAgent || '';
  const uaData = navigator.userAgentData || null;
  const platform = (uaData && uaData.platform) || navigator.platform || '';
  const touch = navigator.maxTouchPoints || 0;
  // iPadOS reports as desktop Safari; detect via Mac platform + touch points.
  const isIPad = /iPad/i.test(ua) || (/Mac/i.test(platform) && touch > 1);
  const isIPhone = /iPhone|iPod/i.test(ua);

  let os = 'other';
  if (isIPhone || isIPad) os = 'ios';
  else if (/Android/i.test(ua)) os = 'android';
  else if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) os = 'macos';
  else if (/Win/i.test(platform) || /Windows/i.test(ua)) os = 'windows';
  else if (/Linux/i.test(platform) || /Linux/i.test(ua)) os = 'linux';

  const isMobile = os === 'ios' || os === 'android' || (uaData && uaData.mobile) || /Mobi/i.test(ua);
  const isApple = os === 'ios' || os === 'macos';
  const isDesktop = !isMobile;

  _deviceProfile = { os, isMobile: !!isMobile, isApple, isDesktop };
  return _deviceProfile;
}

// Returns contact-method ids in suggested order for this platform + the
// modes the person published. Higher = open this app first.
function rankContactMethodsForContext(selectedKindsInput, profile) {
  const kinds = new Set(
    selectedKindsInput instanceof Set ? selectedKindsInput : (selectedKindsInput || [])
  );
  const os = (profile && profile.os) || 'other';
  const apple = os === 'ios' || os === 'macos';

  let base;
  if (os === 'ios') {
    base = ['phone', 'facetime', 'sms', 'whatsapp', 'signal', 'telegram', 'meet', 'zoom', 'teams', 'email', 'calendly', 'slack', 'custom'];
  } else if (os === 'android') {
    base = ['phone', 'sms', 'whatsapp', 'meet', 'signal', 'telegram', 'zoom', 'teams', 'email', 'calendly', 'slack', 'custom', 'facetime'];
  } else if (os === 'macos') {
    // Desktop default leads with meeting/email links (per product spec). FaceTime
    // still jumps to the front for video mode via the priorities block below.
    base = ['meet', 'zoom', 'email', 'facetime', 'phone', 'whatsapp', 'sms', 'teams', 'signal', 'telegram', 'calendly', 'slack', 'custom'];
  } else if (os === 'windows' || os === 'linux') {
    base = ['meet', 'zoom', 'email', 'teams', 'whatsapp', 'phone', 'signal', 'telegram', 'calendly', 'slack', 'sms', 'facetime', 'custom'];
  } else {
    base = ['meet', 'zoom', 'email', 'phone', 'whatsapp', 'sms', 'facetime', 'teams', 'signal', 'telegram', 'calendly', 'slack', 'custom'];
  }

  const wantsVideo = kinds.has('facetime-video') || kinds.has('video-call') || kinds.has('screen-share');
  const wantsText = kinds.has('async-text');
  const wantsCall = kinds.has('phone-call') || kinds.has('drive-time-call') || kinds.has('drive-time');

  const priorities = [];
  if (wantsVideo) {
    if (apple) priorities.push('facetime', 'meet', 'zoom', 'teams');
    else priorities.push('meet', 'zoom', 'teams', 'facetime');
  }
  if (wantsText) {
    if (os === 'ios') priorities.push('sms', 'whatsapp', 'telegram', 'signal');
    else if (os === 'android') priorities.push('whatsapp', 'sms', 'telegram', 'signal');
    else priorities.push('whatsapp', 'telegram', 'signal', 'sms', 'email');
  }
  if (wantsCall) {
    priorities.push('phone', 'whatsapp', 'sms', 'facetime');
  }

  const ranked = [];
  const seen = new Set();
  for (const id of [...priorities, ...base]) {
    if (!seen.has(id)) { seen.add(id); ranked.push(id); }
  }
  return ranked;
}

function getSuggestedReachType() {
  const reachable = new Set(getReachableContactConfigs().map(c => c.id));
  const ranked = rankContactMethodsForContext(selectedKinds, getDeviceProfile());
  return ranked.find(id => reachable.has(id)) || 'phone';
}

function getAvailabilityPayload(kinds, minutes) {
  return {
    minutes,
    kinds,
    tags: selectedAudience,
    note: getConversationNote(),
    callLength: getSelectedCallLength(),
    conversationNote: getConversationNote(),
    contactMethods: userContactMethods.filter(m => m.value),
  };
}

function setAudience(value) {
  selectedAudience = value === 'speakerphone-group' ? value : 'one-to-one';
  $$('.audience-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.audience === selectedAudience);
  });
}

function getAudienceLabel(value=selectedAudience) {
  return value === 'speakerphone-group' ? 'Speakerphone/group' : '1:1';
}

// === SOCKET ACTIONS ===

function joinRoom() {
  const name = getName();
  updateRoomLabel();
  if (!name) return;
  socket.emit('join', {
    name,
    room: getRoom(),
    kinds: [],
    tags: selectedAudience,
    note: '',
    callLength: getSelectedCallLength(),
    conversationNote: '',
  });
}

async function goAvailable() {
  const name = getName();
  if (!name) return;

  const kinds = Array.from(selectedKinds);
  const minutes = getSelectedMinutes();
  const payload = getAvailabilityPayload(kinds, minutes);

  socket.emit('join', {
    name, room: getRoom(), ...payload,
  });

  socket.emit('set-available', payload);

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

function scheduleAvailabilityUpdate() {
  saveLocal();
  if (!myAvailableUntil || selectedKinds.size === 0) return;
  clearTimeout(availabilityUpdateTimer);
  availabilityUpdateTimer = setTimeout(() => {
    const kinds = Array.from(selectedKinds);
    socket.emit('update-availability', getAvailabilityPayload(kinds, getSelectedMinutes()));
  }, 500);
}

function startConversation(targetId, personName='') {
  if (!targetId) return;
  pendingConfirmations.delete(targetId);
  socket.emit('start-conversation', { targetId });
  if (targetId === socket.id) {
    myAvailableUntil = null;
    hideStatusBanner();
    clearSelections();
  }
  toast(personName ? `${personName} marked busy` : 'Marked busy');
}

// Drop confirmations once they go stale. We intentionally do NOT prune just
// because a person's availability window ended — a call placed right at the
// boundary still needs to be resolvable. renderRoster keeps showing those as a
// compact orphan prompt until the user acts or this 5-minute window passes.
function prunePendingConfirmations(now=Date.now()) {
  for (const [id, info] of pendingConfirmations) {
    if (now - info.ts > 5 * 60 * 1000) {
      pendingConfirmations.delete(id);
    }
  }
}

// === STATUS BANNER ===

function showStatusBanner(kinds, minutes) {
  const banner = $('#statusBanner');
  const kindLabels = kinds.map(k => getKindLabel(k)).join(', ');
  $('#statusMessage').textContent = `You're visible as available${kindLabels ? ` for ${kindLabels}` : ''} (${getAudienceLabel()})`;
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
    timer.textContent = `On board in ${getRoom()} for ${formatDuration(remaining)} · suggested length ${formatMinutesLabel(getSelectedCallLength())}`;
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
      <select class="contact-type" data-index="${i}" ${tooltipAttr('Choose how people should reach you from your card.')}>
        <option value="">Type...</option>
        ${availabilityConfig.contactMethods.map(cm => `
          <option value="${cm.id}" ${m.type === cm.id ? 'selected' : ''}>${cm.icon} ${cm.label}</option>
        `).join('')}
      </select>
      <input type="text" class="contact-value" data-index="${i}"
        placeholder="${getContactPlaceholder(m.type)}" value="${esc(m.value || '')}" ${tooltipAttr(getContactTooltip(m.type))}>
      ${getContactPreviewHtml(m)}
      <button type="button" class="remove-btn" data-index="${i}" ${tooltipAttr('Remove this reach option from the setup form.')}>&times;</button>
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
    updateReachReadiness();
  }));
  $$('.contact-value').forEach(inp => inp.addEventListener('blur', renderContactMethodsUI));
  $$('.remove-btn').forEach(btn => btn.addEventListener('click', (e) => {
    const i = parseInt(e.target.dataset.index, 10);
    userContactMethods.splice(i, 1);
    if (userContactMethods.length === 0) userContactMethods.push({ type: '', value: '' });
    renderContactMethodsUI();
    saveLocal();
  }));
  updateReachReadiness();
}

function getContactPlaceholder(typeId) {
  const method = availabilityConfig.contactMethods.find(m => m.id === typeId);
  return method?.placeholder || 'Enter value...';
}

function getContactPreviewHtml(method) {
  const config = availabilityConfig.contactMethods.find(m => m.id === method.type);
  const href = config ? buildContactHref(config, method.value) : null;
  if (!href) {
    return `<span class="contact-test-link contact-test-empty" ${tooltipAttr('Add a usable value to enable a test link.')}>Test</span>`;
  }
  return `<a class="contact-test-link" href="${esc(href)}" target="_blank" rel="noopener" ${tooltipAttr(`Open the ${config.label} link exactly as it will appear on your card.`)}>Test</a>`;
}

function getPrimaryReachAction() {
  return userContactMethods.map(method => {
    const config = availabilityConfig.contactMethods.find(c => c.id === method.type);
    const href = config ? buildContactHref(config, method.value) : null;
    return href ? { config, href, value: method.value } : null;
  }).filter(Boolean)[0] || null;
}

function updateReachReadiness() {
  const el = $('#reachReadiness');
  if (!el) return;
  const action = getPrimaryReachAction();
  if (action) {
    el.innerHTML = `
      <div>
        <strong>Reach link ready:</strong> ${esc(action.config.label)}
        <span>People will get a one-click ${esc(getContactActionLabel(action.config).toLowerCase())} button on your card.</span>
      </div>
      <button type="button" class="secondary-btn small-action" data-open-reach-settings ${tooltipAttr('Change or test your one-click reach links before publishing.')}>Change</button>
    `;
  } else {
    el.innerHTML = `
      <div>
        <strong>No one-click reach link yet.</strong>
        <span>Add phone, SMS, FaceTime, WhatsApp, video, email, or an app link before you appear on the board.</span>
      </div>
      <button type="button" class="primary-btn small-action" data-open-reach-settings ${tooltipAttr('Add the direct link people will tap from your availability card.')}>Add reach link</button>
    `;
  }
  el.querySelector('[data-open-reach-settings]')?.addEventListener('click', openReachSettings);
}

function openReachSettings() {
  const panel = $('#setupPanel');
  if (panel) panel.classList.remove('hidden');
  const details = $('.setup-details');
  if (details) details.open = true;
  $('#contactMethodsContainer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('.contact-value')?.focus();
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
  prunePendingConfirmations(now);
  updateRoomLabel();

  // Update count
  const countEl = $('#rosterCount');
  if (countEl) countEl.textContent = users.length;

  const container = $('#list');
  if (!container) return;

  // Keep an open "did it connect?" prompt alive even if the person's window
  // ended right after you tapped, so the call you just placed can still be
  // resolved (or their contact copied) instead of vanishing under you.
  const shownIds = new Set(users.map(u => u.id));
  const orphans = [...pendingConfirmations.entries()].filter(([id]) => !shownIds.has(id));
  const orphanHtml = orphans.map(([id, info]) => renderOrphanConfirm(id, info)).join('');

  if (users.length === 0 && orphans.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No one is available right now</strong>
        <span>When someone opens a window, they will appear here.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = orphanHtml + users.map(u => renderPersonCard(u, now)).join('');
}

// Compact, honest fallback for a person who left the board while you still had
// an open prompt about them. Never shown as "available".
function renderOrphanConfirm(id, info) {
  return `
    <div class="cta-confirm orphan-confirm" role="group" aria-label="Did it connect?">
      <span class="cta-confirm-q">You reached ${esc(info.name || 'them')} via ${esc(info.label || 'the app')}. Their availability window has ended.</span>
      <div class="cta-confirm-actions">
        ${info.copy ? `<button type="button" class="secondary-btn small-action" data-copy-action data-copy-text="${esc(info.copy)}" data-copy-label="${esc(info.copyLabel || 'link')}" ${tooltipAttr('Copy the contact in case the app did not open.')}>Copy ${esc(info.copyLabel || 'link')}</button>` : ''}
        <button type="button" class="secondary-btn small-action" data-confirm-keep="${esc(id)}" ${tooltipAttr('Dismiss this prompt.')}>Dismiss</button>
      </div>
    </div>
  `;
}

function renderPersonCard(u, now=Date.now(), options={}) {
  const delta = u.availableUntil - now;
  const left = options.timerLabel || formatDuration(Math.max(0, delta));
  const initial = (u.name || '?')[0].toUpperCase();

  const kinds = (u.kinds || []).map(k =>
    `<span class="kind-badge">${getKindLabel(k)}</span>`
  ).join('');

  const contactActions = (u.contactMethods || []).map(m => {
    const config = availabilityConfig.contactMethods.find(c => c.id === m.type);
    if (!config || !m.value) return null;
    return {
      config,
      label: getContactActionLabel(config),
      url: buildContactHref(config, m.value),
      value: m.value,
    };
  }).filter(Boolean);

  // Rank usable links for the viewer's device + the modes this person published,
  // so the app most likely to open is the primary button.
  const ranking = rankContactMethodsForContext(u.kinds, getDeviceProfile());
  const rankOf = (id) => {
    const i = ranking.indexOf(id);
    return i === -1 ? 999 : i;
  };
  const usable = contactActions.filter(action => action.url)
    .map((action, idx) => ({ action, idx }))
    .sort((a, b) => (rankOf(a.action.config.id) - rankOf(b.action.config.id)) || (a.idx - b.idx))
    .map(entry => entry.action);
  const nonUsable = contactActions.filter(action => !action.url);

  const primaryContact = usable[0] || null;
  const secondaryContacts = [...usable.slice(1), ...nonUsable];

  const ctaAttrs = (action) => [
    `data-contact-cta="${esc(u.id)}"`,
    `data-person-name="${esc(u.name)}"`,
    `data-cta-label="${esc(getContactActionLabel(action.config))}"`,
    `data-copy-text="${esc(getCopyForAction(action))}"`,
    `data-copy-label="${esc(getCopyKind(action.config))}"`,
  ].join(' ');

  const primaryContactHtml = primaryContact ? `
    <div class="primary-cta-row">
      <a href="${esc(primaryContact.url)}" class="primary-contact-link" ${contactLinkTarget(primaryContact.url)} ${ctaAttrs(primaryContact)} ${tooltipAttr(`Open ${primaryContact.config.label} for ${u.name}. They stay on the board until you tap Mark busy.`)}>
        ${esc(getPrimaryContactText(primaryContact.config, u.name))}
      </a>
      <button type="button" class="copy-cta-btn secondary-btn" data-copy-action data-copy-text="${esc(getCopyForAction(primaryContact))}" data-copy-label="${esc(getCopyKind(primaryContact.config))}" ${tooltipAttr(`Copy ${u.name}'s ${getCopyKind(primaryContact.config)} in case the app does not open.`)}>Copy</button>
    </div>
  ` : '';
  const secondaryContactsHtml = secondaryContacts.length ? '<div class="person-contacts">' + secondaryContacts.map(action => {
    if (action.url) {
      return `<a href="${esc(action.url)}" class="contact-link" ${contactLinkTarget(action.url)} ${ctaAttrs(action)} ${tooltipAttr(`Open ${action.config.label} for ${u.name}. They stay on the board until you tap Mark busy.`)}>${esc(action.label)}</a>`;
    }
    return `<span class="kind-badge">${esc(action.config.label)}: ${esc(action.value)}</span>`;
  }).join('') + '</div>' : '';
  const contacts = primaryContactHtml || secondaryContactsHtml
    ? `${primaryContactHtml}${secondaryContactsHtml}`
    : (options.preview
      ? '<div class="no-contact">Add a reach link to preview the button people will tap.</div>'
      : '<div class="no-contact">No one-click reach link yet.</div>');

  const pending = options.preview ? null : pendingConfirmations.get(u.id);
  const confirmHtml = pending ? `
    <div class="cta-confirm" role="group" aria-label="Did it connect?">
      <span class="cta-confirm-q">Opened ${esc(pending.label || 'the app')} for ${esc(u.name)}. Did it connect?</span>
      <div class="cta-confirm-actions">
        <button type="button" class="primary-btn small-action" data-confirm-busy="${esc(u.id)}" data-person-name="${esc(u.name)}" ${tooltipAttr(`Connected — take ${u.name} off Free now.`)}>Connected, mark busy</button>
        <button type="button" class="secondary-btn small-action" data-confirm-keep="${esc(u.id)}" ${tooltipAttr(`Did not connect — keep ${u.name} on the board.`)}>Keep visible</button>
        ${pending.copy ? `<button type="button" class="secondary-btn small-action" data-copy-action data-copy-text="${esc(pending.copy)}" data-copy-label="${esc(pending.copyLabel || 'link')}" ${tooltipAttr('Copy the contact in case the app did not open.')}>Copy ${esc(pending.copyLabel || 'link')}</button>` : ''}
      </div>
    </div>
  ` : '';

  const audience = u.tags ? `<span class="audience-badge" ${tooltipAttr('Whether this person wants a 1:1 conversation or is open to speakerphone/group.')}>${esc(getAudienceLabel(u.tags))}</span>` : '';
  const callLength = u.callLength || parseLegacyCallLength(u.note);
  const suggestedCall = callLength ? `<span class="call-length-badge" ${tooltipAttr('Suggested conversation length. This is not how long the card stays visible.')}>Suggested length: ${esc(formatMinutesLabel(callLength))}</span>` : '';
  const conversationNote = getVisibleConversationNote(u);
  const isMe = u.id === socket.id;
  const actionLabel = options.preview ? 'Mark busy' : (isMe ? 'Take me off board' : 'Mark busy');
  const actionTitle = options.preview
    ? 'Preview only'
    : (isMe ? 'Remove yourself from Free now' : `Remove ${u.name} from Free now without opening a contact link`);
  const previewAttr = options.preview ? ' disabled aria-disabled="true"' : '';

  return `
    <div class="person-card ${options.preview ? 'preview-card' : ''}">
      <div class="person-avatar">${esc(initial)}</div>
      <div class="person-info">
        <div class="person-name">${esc(u.name)}</div>
        ${(kinds || audience || suggestedCall) ? `<div class="person-kinds">${audience}${suggestedCall}${kinds}</div>` : ''}
        ${conversationNote ? `<div class="conversation-note"><span>Wants to talk about</span>${esc(conversationNote)}</div>` : ''}
        ${contacts}
        ${confirmHtml}
        <div class="person-actions">
          <button type="button" class="conversation-link" data-mark-busy="${esc(u.id)}" data-person-name="${esc(u.name)}" ${tooltipAttr(actionTitle)}${previewAttr}>${esc(actionLabel)}</button>
        </div>
      </div>
      <div class="person-timer" ${tooltipAttr('How much longer this card stays visible on the board.')}>${esc(left)}</div>
    </div>
  `;
}

function previewMyCard() {
  const panel = $('#cardPreviewPanel');
  const container = $('#cardPreview');
  if (!panel || !container) return;
  const name = getName() || 'Your name';
  const kinds = selectedKinds.size > 0 ? Array.from(selectedKinds) : ['quick-hello'];
  const previewUser = {
    id: 'preview-self',
    name,
    kinds,
    tags: selectedAudience,
    note: getConversationNote(),
    callLength: getSelectedCallLength(),
    conversationNote: getConversationNote(),
    contactMethods: userContactMethods.filter(m => m.value),
    availableUntil: Date.now() + getSelectedMinutes() * 60 * 1000,
  };
  container.innerHTML = renderPersonCard(previewUser, Date.now(), {
    preview: true,
    timerLabel: `${getSelectedMinutes()}m`,
  });
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// === TOPICS ===

async function createTopic() {
  if (isCreatingTopic) return;
  const name = getName();
  if (!name) { ensureNameThen(() => createTopic()); return; }
  const title = $('#topicTitle')?.value.trim();
  if (!title) { toast('Enter a topic title'); return; }
  const btn = $('#newTopicBtn');

  isCreatingTopic = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting...';
  }
  try {
    const res = await fetch(apiUrl('/api/topics'), {
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
    topics = mergeById([topic, ...topics]);
    syncTopicDropdown();
    renderTopics();
    $('#topicTitle').value = '';
    toast('Topic created');
  } catch (err) {
    console.error(err);
    toast('Could not create topic');
  } finally {
    isCreatingTopic = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Start prompt';
    }
  }
}

function syncTopicDropdown() {
  const select = $('#responseTopic');
  if (!select) return;
  const room = getRoom();
  const list = topics.filter(t => t.room === room);
  select.innerHTML = list.length
    ? list.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')
    : '<option value="">No prompts yet</option>';
  updateSelectedTopicUI();
}

function selectResponseTopic(topicId) {
  const select = $('#responseTopic');
  if (!select || !topicId) return;
  select.value = topicId;
  updateSelectedTopicUI();
  $('.record-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateSelectedTopicUI() {
  const select = $('#responseTopic');
  const badge = $('#selectedTopicBadge');
  const hint = $('#responseTopicHint');
  if (!select) return;
  const selected = topics.find(t => t.id === select.value);
  if (badge) {
    badge.textContent = selected ? `Selected: ${selected.title}` : 'No prompt selected';
  }
  if (hint) {
    hint.textContent = selected
      ? 'Record or upload below; the clip will be saved under the selected prompt.'
      : 'Create a prompt above, then choose it here before recording or uploading a clip.';
  }
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
          <button class="del-btn del-resp" data-id="${r.id}" ${tooltipAttr('Delete this audio clip from the prompt.')}>remove</button>
        </div>
        <audio controls src="${esc(assetUrl(r.audioUrl))}" class="slim-audio"></audio>
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
            <button class="primary-btn small-action" data-select-topic="${t.id}" ${tooltipAttr('Switch the recorder to this prompt so your next clip is saved here.')}>Respond here</button>
            <button class="secondary-btn small-action" data-play="${t.id}" ${tooltipAttr('Play all saved clips for this prompt in order.')}>Play</button>
            <button class="del-btn del-topic" data-id="${t.id}" ${tooltipAttr('Delete this prompt and all saved clips under it.')}>Delete</button>
          </div>
        </div>
        ${t.prompt ? `<div class="person-note topic-prompt">${esc(t.prompt)}</div>` : ''}
        ${resp.length > 0 ? `<div class="topic-responses">${respHtml}</div>` : ''}
      </div>
    `;
  }).join('');

  $$('button[data-play]').forEach(btn => btn.onclick = () => playAssembled(btn.dataset.play));
  $$('button[data-select-topic]').forEach(btn => btn.onclick = () => selectResponseTopic(btn.dataset.selectTopic));
  $$('.del-topic').forEach(btn => btn.onclick = () => deleteTopic(btn.dataset.id));
  $$('.del-resp').forEach(btn => btn.onclick = () => deleteResponse(btn.dataset.id));
}

async function deleteTopic(topicId) {
  if (!confirm('Delete this topic and all its responses?')) return;
  try {
    const res = await fetch(apiUrl(`/api/topics/${topicId}`), { method: 'DELETE' });
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
    const res = await fetch(apiUrl(`/api/responses/${responseId}`), { method: 'DELETE' });
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
      playlistAudio.src = assetUrl(next.audioUrl);
      playlistAudio.play();
    });
  }
  playlistAudio.dataset.nextQueue = JSON.stringify(queue.slice(1));
  playlistAudio.src = assetUrl(queue[0].audioUrl);
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
  if (!window.isSecureContext) {
    toast('Recording needs the secure app link');
    $('#recordStatus').textContent = 'Recording needs HTTPS. Use the secure app link or upload a clip.';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Recording not supported here');
    $('#recordStatus').textContent = 'Recording is not supported in this browser. Upload a voice memo instead.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    const mimeType = getSupportedAudioMime();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordingChunks, { type: mimeType || 'audio/webm' });
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
    const res = await fetch(apiUrl('/api/responses'), {
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
    $('#recordStatus').textContent = 'Clip saved';
    toast('Response saved');
  } catch (err) {
    console.error(err);
    toast('Could not submit');
  }
}

async function uploadClip(blob) {
  const fd = new FormData();
  fd.append('audio', blob, 'clip.webm');
  const res = await fetch(apiUrl('/api/upload'), { method: 'POST', body: fd });
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

function updateRecordingSupport() {
  const status = $('#recordStatus');
  const recordBtn = $('#recordBtn');
  if (!status || !recordBtn) return;
  if (!window.isSecureContext) {
    status.textContent = 'Recording needs HTTPS. Use the secure app link or upload a clip.';
    recordBtn.disabled = true;
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    status.textContent = 'Recording is not supported in this browser. Upload a voice memo instead.';
    recordBtn.disabled = true;
    return;
  }
  status.textContent = 'Recording supported on this device.';
  recordBtn.disabled = false;
}

function getSupportedAudioMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
  ].find(type => MediaRecorder.isTypeSupported(type)) || '';
}

// === UTILITIES ===

function getKindLabel(kindId) {
  for (const cat of availabilityConfig.categories) {
    const type = cat.types.find(t => t.id === kindId);
    if (type) return type.label;
  }
  return kindId;
}

function getKindMark(kindId, label) {
  const marks = {
    'quick-hello': 'Hi',
    'phone-call': 'Call',
    'facetime-video': 'Video',
    'drive-time-call': 'Drive',
    'video-call': 'Vid',
    'screen-share': 'Share',
    'async-text': 'Msg',
  };
  return marks[kindId] || String(label || kindId).slice(0, 4);
}

function getKindTooltip(kindId, label, minutes) {
  const modeTips = {
    'quick-hello': 'Publish a short, low-commitment availability card for a quick hello.',
    'phone-call': 'Publish that you are open to a direct phone call now.',
    'facetime-video': 'Publish that you are open to FaceTime, Meet, Zoom, or another video link now.',
    'drive-time-call': 'Publish that you are available for a call while driving or walking.',
    'async-text': 'Publish that you are open to messages now, not necessarily a live call.',
  };
  return `${modeTips[kindId] || `Publish that you are available for ${label}.`} Suggested length starts at ${formatMinutesLabel(minutes)}; visibility is set separately below.`;
}

function getContactTooltip(typeId) {
  const tips = {
    phone: 'Use a phone number. The card button will open a one-tap call link.',
    sms: 'Use a phone number. The card button will open a one-tap SMS or iMessage link.',
    facetime: 'Use a phone number or Apple ID email. The card button will open FaceTime.',
    whatsapp: 'Use a WhatsApp-capable phone number. The card button will open WhatsApp.',
    zoom: 'Paste a Zoom meeting link.',
    meet: 'Paste a Google Meet or video-call link.',
    teams: 'Paste a Teams meeting link.',
    signal: 'Paste a Signal link, usually from signal.me.',
    telegram: 'Paste a Telegram link such as t.me/username.',
    slack: 'Paste a full Slack link or Slack app URL. @names are visible only, not one-click.',
    email: 'Use an email address. The card button will open a draft email.',
    calendly: 'Paste a Calendly or scheduling link.',
    custom: 'Paste a safe direct URL or app link people should open to reach you.',
  };
  return tips[typeId] || 'Enter the direct contact value for this reach option.';
}

function getVisibleConversationNote(user) {
  if (user.conversationNote) return user.conversationNote;
  if (user.note && !/^Suggested (call|length):/i.test(user.note)) return user.note;
  return '';
}

function parseLegacyCallLength(note) {
  const match = String(note || '').match(/^Suggested (?:call|length):\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function getContactActionLabel(config) {
  const labels = {
    phone: 'Call',
    sms: 'Text',
    facetime: 'FaceTime',
    whatsapp: 'WhatsApp',
    email: 'Email',
    slack: 'Slack',
    zoom: 'Zoom',
    meet: 'Meet',
    teams: 'Teams',
    signal: 'Signal',
    telegram: 'Telegram',
    calendly: 'Calendly',
    custom: 'Open link',
  };
  return labels[config.id] || config.label;
}

function getPrimaryContactText(config, name) {
  const safeName = name || 'them';
  const labels = {
    phone: `Call ${safeName} now`,
    sms: `Text ${safeName}`,
    facetime: `FaceTime ${safeName}`,
    whatsapp: `Message ${safeName} on WhatsApp`,
    email: `Email ${safeName}`,
    zoom: `Join ${safeName}'s Zoom`,
    meet: `Join ${safeName}'s Meet`,
    teams: `Join ${safeName}'s Teams`,
    signal: `Message ${safeName} on Signal`,
    telegram: `Message ${safeName} on Telegram`,
    calendly: `Open ${safeName}'s scheduler`,
    custom: `Open ${safeName}'s link`,
  };
  return labels[config.id] || `Reach ${safeName}: ${getContactActionLabel(config)}`;
}

// What to put on the clipboard if the app does not open. Strips schemes so a
// phone number or email is plain and re-usable; links are copied whole.
function getCopyForAction(action) {
  const href = action?.url || '';
  if (/^tel:/i.test(href)) return href.replace(/^tel:/i, '');
  if (/^sms:/i.test(href)) return href.replace(/^sms:/i, '').split('?')[0];
  if (/^facetime(-audio)?:/i.test(href)) return href.replace(/^facetime(-audio)?:/i, '');
  if (/^mailto:/i.test(href)) return href.replace(/^mailto:/i, '').split('?')[0];
  return href;
}

function getCopyKind(config) {
  if (['phone', 'sms', 'facetime'].includes(config.id)) return 'number';
  if (config.id === 'email') return 'email';
  return 'link';
}

// Only open https links in a new tab; app-scheme links (tel:, sms:, facetime:,
// mailto:, etc.) should stay in the same tab so the OS hands off cleanly.
function contactLinkTarget(href) {
  return /^https?:/i.test(href) ? 'target="_blank" rel="noopener"' : '';
}

async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function buildContactHref(config, rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  if (config.id === 'phone') return normalizePhoneHref(value, 'tel');
  if (config.id === 'sms') return normalizePhoneHref(value, 'sms');
  if (config.id === 'facetime') return normalizeFaceTimeHref(value);
  if (config.id === 'whatsapp') return normalizeWhatsAppHref(value);
  if (config.id === 'email') return normalizeEmailHref(value);
  if (config.id === 'slack') return normalizeSlackHref(value);
  if (config.id === 'zoom') return normalizeKnownLink(value, ['zoom.us', 'zoom.com'], ['zoommtg:']);
  if (config.id === 'meet') return normalizeKnownLink(value, ['meet.google.com'], []);
  if (config.id === 'teams') return normalizeKnownLink(value, ['teams.microsoft.com', 'teams.live.com'], ['msteams:']);
  if (config.id === 'calendly') return normalizeKnownLink(value, ['calendly.com', 'cal.com'], []);
  if (config.id === 'signal') return normalizeKnownLink(value, ['signal.me'], []);
  if (config.id === 'telegram') return normalizeKnownLink(value, ['t.me', 'telegram.me'], ['tg:']);
  if (config.id === 'custom') return normalizeCustomHref(value);
  if (!config.urlTemplate) return null;
  const normalized = shouldForceHttps(config.id, value) ? withProtocol(value) : normalizeCustomHref(value);
  if (!normalized) return null;
  return config.urlTemplate.replace('{value}', normalized);
}

function normalizePhone(value) {
  const extMatch = value.match(/(?:ext\.?|extension|x|#)\s*(\d{1,8})\s*$/i);
  const extension = extMatch ? extMatch[1] : '';
  const withoutExtension = extMatch ? value.slice(0, extMatch.index).trim() : value;
  const compact = withoutExtension.replace(/[^\d+]/g, '');
  if ((compact.match(/\+/g) || []).length > 1) return null;
  const digits = compact.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const phone = compact.startsWith('+') ? `+${digits}` : digits;
  return extension ? `${phone};ext=${extension}` : phone;
}

function normalizePhoneHref(value, scheme) {
  const phone = normalizePhone(value);
  return phone ? `${scheme}:${phone}` : null;
}

function normalizeWhatsAppHref(value) {
  const phone = normalizePhone(value);
  if (!phone || !phone.startsWith('+') || phone.includes(';ext=')) return null;
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}`;
}

function normalizeFaceTimeHref(value) {
  const withoutScheme = value.replace(/^facetime(?:-audio)?:/i, '').trim();
  if (isLikelyEmail(withoutScheme)) return `facetime:${withoutScheme}`;
  const phone = normalizePhone(withoutScheme);
  return phone ? `facetime:${phone}` : null;
}

function normalizeEmailHref(value) {
  const cleaned = value.replace(/^mailto:/i, '').trim();
  const [address, rawQuery=''] = cleaned.split('?');
  if (!isLikelyEmail(address)) return null;
  const allowed = new Set(['subject', 'body', 'cc', 'bcc']);
  const params = new URLSearchParams(rawQuery);
  const safeParams = new URLSearchParams();
  params.forEach((v, k) => {
    if (allowed.has(k.toLowerCase()) && v) safeParams.set(k, v);
  });
  const query = safeParams.toString();
  return `mailto:${address}${query ? `?${query}` : ''}`;
}

function normalizeSlackHref(value) {
  if (/^[@#]/.test(value)) return null;
  return normalizeKnownLink(value, ['slack.com'], ['slack:']);
}

function normalizeKnownLink(value, allowedHosts, allowedSchemes=[]) {
  const candidate = hasScheme(value) ? value : withProtocol(value);
  const url = safeParseUrl(candidate);
  if (!url) return null;
  if (allowedSchemes.includes(url.protocol)) return candidate;
  if (url.protocol !== 'https:') return null;
  return allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
    ? url.toString()
    : null;
}

function normalizeCustomHref(value) {
  const candidate = hasScheme(value) ? value : withProtocol(value);
  const url = safeParseUrl(candidate);
  if (!url) return null;
  const allowedSchemes = new Set([
    'https:', 'mailto:', 'tel:', 'sms:', 'facetime:', 'facetime-audio:',
    'zoommtg:', 'msteams:', 'slack:', 'whatsapp:', 'tg:'
  ]);
  return allowedSchemes.has(url.protocol) ? candidate : null;
}

function safeParseUrl(value) {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hasScheme(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function shouldForceHttps(typeId, value) {
  return ['zoom', 'meet', 'teams', 'calendly', 'signal', 'telegram', 'custom'].includes(typeId) && !hasScheme(value);
}

function withProtocol(value) {
  return hasScheme(value) ? value : `https://${value}`;
}

function updateRoomLabel() {
  const el = $('#roomLabel');
  if (el) el.textContent = getRoom();
}

function getBasePath() {
  const firstSegment = window.location.pathname.split('/').filter(Boolean)[0] || '';
  return firstSegment === 'available' ? '/available' : '';
}

function apiUrl(path) {
  return `${BASE_PATH}${path}`;
}

function assetUrl(path) {
  if (!path) return '';
  if (/^(blob:|data:|https?:|mailto:|tel:)/i.test(path)) return path;
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
  );
}

function tooltipAttr(text) {
  const safe = esc(text);
  return `title="${safe}" data-tooltip="${safe}"`;
}

function mergeById(items) {
  const seenIds = new Set();
  const seenNearDuplicates = new Map();
  return items.filter(item => {
    if (!item?.id || seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    const createdAt = Number(item.createdAt || 0);
    const fingerprint = [
      item.room || '',
      item.title || '',
      item.prompt || '',
      item.createdBy || '',
      item.maxMinutes || '',
      item.dueAt || '',
    ].join('\u001f');
    const lastSeenAt = seenNearDuplicates.get(fingerprint);
    if (lastSeenAt && Math.abs(lastSeenAt - createdAt) <= 10000) return false;
    seenNearDuplicates.set(fingerprint, createdAt);
    return true;
  });
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

function formatMinutesLabel(minutes) {
  const mins = parseInt(minutes, 10);
  if (mins === 60) return '1 hour';
  return `${mins} min`;
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
      fetch(apiUrl(`/api/topics?room=${encodeURIComponent(room)}`)),
      fetch(apiUrl(`/api/responses?room=${encodeURIComponent(room)}`))
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
    updateRoomLabel();
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

  $$('.audience-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      setAudience(btn.dataset.audience);
      saveLocal();
      if (myAvailableUntil) {
        goAvailable();
      }
    });
  });

  $$('.call-length-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      setCallLength(parseInt(btn.dataset.callMin, 10));
      saveLocal();
      if (myAvailableUntil) {
        goAvailable();
      }
    });
  });

  $('#conversationNote')?.addEventListener('input', scheduleAvailabilityUpdate);
  $('#previewCardBtn')?.addEventListener('click', previewMyCard);
  $('#closePreviewBtn')?.addEventListener('click', () => $('#cardPreviewPanel')?.classList.add('hidden'));

  $('#list')?.addEventListener('click', (e) => {
    // Copy fallback (button only — the contact link carries copy data too,
    // but tapping the link should open the app, not copy).
    const copyEl = e.target.closest('[data-copy-action]');
    if (copyEl) {
      e.preventDefault();
      const label = copyEl.dataset.copyLabel || 'link';
      copyText(copyEl.dataset.copyText || '').then(ok =>
        toast(ok ? `Copied ${label}` : 'Could not copy — long-press to copy')
      );
      return;
    }

    // Explicit "Mark busy" / "Connected, mark busy" — the only ways a tap
    // removes someone from the board.
    const busyEl = e.target.closest('[data-confirm-busy]') || e.target.closest('[data-mark-busy]');
    if (busyEl) {
      const id = busyEl.dataset.confirmBusy || busyEl.dataset.markBusy;
      startConversation(id, busyEl.dataset.personName || '');
      return;
    }

    // "Keep visible" — dismiss the prompt, leave them on the board.
    const keepEl = e.target.closest('[data-confirm-keep]');
    if (keepEl) {
      pendingConfirmations.delete(keepEl.dataset.confirmKeep);
      renderRoster();
      return;
    }

    // Tapping a reach link: let it open the app, then surface the
    // "did it connect?" prompt. Never auto-removes the person. Skip the
    // prompt on your own card — tapping it just tests your own link.
    const cta = e.target.closest('[data-contact-cta]');
    if (cta && cta.dataset.contactCta !== socket.id) {
      pendingConfirmations.set(cta.dataset.contactCta, {
        name: cta.dataset.personName || '',
        label: cta.dataset.ctaLabel || 'the app',
        copy: cta.dataset.copyText || '',
        copyLabel: cta.dataset.copyLabel || 'link',
        ts: Date.now(),
      });
      // Defer so the browser handoff to the app/tab happens first.
      setTimeout(renderRoster, 60);
    }
  });

  // Status banner actions
  $('#extendBtn')?.addEventListener('click', extendAvailability);
  $('#doneBtn')?.addEventListener('click', markDone);

  // Topics
  $('#newTopicBtn')?.addEventListener('click', createTopic);
  $('#responseTopic')?.addEventListener('change', updateSelectedTopicUI);
  $('#recordBtn')?.addEventListener('click', startRecording);
  $('#stopBtn')?.addEventListener('click', stopRecording);
  $('#submitResponseBtn')?.addEventListener('click', submitResponse);
  $('#fileInput')?.addEventListener('change', handleFileSelect);
  updateRecordingSupport();

  // Socket events
  socket.on('connect', () => joinRoom());
  socket.on('topics', data => { topics = mergeById(data || []); renderTopics(); syncTopicDropdown(); });
  socket.on('responses', data => { responses = data || []; renderTopics(); });
  socket.on('roster', data => { lastRoster = data || { users: [], now: Date.now() }; renderRoster(); });
  socket.on('availability-ended', () => {
    myAvailableUntil = null;
    hideStatusBanner();
    clearSelections();
    toast('You were removed from Free now');
  });

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
  updateRoomLabel();
  await loadAvailabilityConfig();
  bind();
  renderTopics();
  renderRoster();

  // If user has a name, join automatically; otherwise show setup
  if (getName()) {
    joinRoom();
    loadTopicsAndResponses();
  }
}

// Pure helpers exposed for automated smoke tests. Harmless in production:
// no state is mutated through these.
window.__schmoozeTest = {
  getDeviceProfile,
  rankContactMethodsForContext,
  getSuggestedReachType,
  getCopyForAction,
  buildContactHref,
  getConfig: () => availabilityConfig,
};

window.addEventListener('DOMContentLoaded', init);
