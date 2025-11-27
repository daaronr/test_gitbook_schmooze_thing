// Big Schmooze MVP client
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  event: null,
  me: null,
  socket: null,
  filterText: ''
};

function qsParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}
function setQSParams(params) {
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([k,v]) => {
    if (v === null || v === undefined) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  });
  history.replaceState({}, '', url);
}

function byId(id) { return document.getElementById(id); }

function renderEventHeader() {
  const el = byId('eventHeader');
  if (!state.event) { el.textContent = ''; return; }
  const url = new URL(window.location.href);
  url.searchParams.set('e', state.event.code);
  el.innerHTML = `Event <strong>${state.event.name}</strong> — Code <strong>${state.event.code}</strong> — <a href="${url}" style="color:#58a6ff">link</a>`;
}

function renderMeCard() {
  const wrap = byId('meCard');
  const me = state.me;
  if (!me) { wrap.innerHTML = ''; return; }
  wrap.classList.add('me');
  wrap.innerHTML = `
    <h3>You're in as ${escapeHtml(me.name)} <span class="badge status-${me.status}">${statusLabel(me.status)}</span></h3>
    <div class="row">
      <div class="col">
        <label>Ask</label>
        <textarea id="meAsk" maxlength="200" placeholder="What do you want?">${escapeHtml(me.ask || '')}</textarea>
      </div>
      <div class="col">
        <label>Offer</label>
        <textarea id="meOffer" maxlength="200" placeholder="What can you help with?">${escapeHtml(me.offer || '')}</textarea>
      </div>
    </div>
    <label>Tags (comma-separated)</label>
    <input id="meTags" value="${escapeHtml((me.tags||[]).join(', '))}">
    <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
      <button id="saveMeBtn">Save</button>
      <button id="shareLinkBtn2">Share Link</button>
    </div>
  `;
  byId('saveMeBtn').onclick = async () => {
    await updateMe({ ask: byId('meAsk').value, offer: byId('meOffer').value, tags: byId('meTags').value });
  };
  byId('shareLinkBtn2').onclick = shareLink;
}

function renderParticipants() {
  const cont = byId('participants');
  if (!state.event) { cont.innerHTML = ''; return; }
  const filter = (state.filterText || '').toLowerCase();
  const users = (state.event.users || []).filter(u => {
    const hay = [
      u.name, u.title, u.org,
      (u.tags||[]).join(' '), u.ask, u.offer
    ].join(' ').toLowerCase();
    return hay.includes(filter);
  });
  cont.innerHTML = users.map(u => userCardHTML(u)).join('');
  // bind nudge buttons
  $$('.nudgeBtn').forEach(btn => {
    btn.onclick = () => nudge(btn.dataset.to);
  });
}

function statusLabel(s) {
  if (s === 'open') return 'Open to chat';
  if (s === 'maybe') return 'Maybe later';
  if (s === 'busy') return 'Do not disturb';
  return s;
}
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}
function linkHTML(label, url) {
  if (!url) return '';
  const safe = escapeHtml(url);
  const l = label.replace(/</g,'&lt;');
  return `<a href="${safe}" target="_blank" rel="noopener">${l}</a>`;
}

function userCardHTML(u) {
  const links = [
    u.links?.linkedin ? linkHTML('LinkedIn', u.links.linkedin) : '',
    u.links?.twitter ? linkHTML('X/Twitter', u.links.twitter) : '',
    u.links?.website ? linkHTML('Website', u.links.website) : '',
  ].filter(Boolean).join(' · ');

  const tags = (u.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  return `
    <div class="participant">
      <div class="top">
        <div>
          <div class="name">${escapeHtml(u.name)}</div>
          <div class="org">${escapeHtml([u.title, u.org].filter(Boolean).join(' · '))}</div>
        </div>
        <span class="badge status-${u.status}">${statusLabel(u.status)}</span>
      </div>
      ${u.ask ? `<div><strong>Ask:</strong> ${escapeHtml(u.ask)}</div>` : ''}
      ${u.offer ? `<div><strong>Offer:</strong> ${escapeHtml(u.offer)}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${links ? `<div class="linkRow">${links}</div>` : ''}
      <hr class="sep">
      <button class="nudge nudgeBtn" data-to="${u.id}">👋 Nudge</button>
    </div>
  `;
}

async function createEvent() {
  const name = byId('newEventName').value || 'Big Schmooze Event';
  const res = await fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await res.json();
  if (data.code) {
    setQSParams({ e: data.code });
    await joinFlow(data.code);
  } else {
    toast('Failed to create event');
  }
}
async function joinFlow(preCode) {
  const code = (preCode || byId('joinCode').value || '').trim().toUpperCase();
  const payload = {
    code,
    name: byId('joinName').value,
    title: byId('joinTitle').value,
    org: byId('joinOrg').value,
    ask: byId('joinAsk').value,
    offer: byId('joinOffer').value,
    tags: byId('joinTags').value,
    linkedin: byId('joinLinkedin').value,
    twitter: byId('joinTwitter').value,
    website: byId('joinWebsite').value
  };
  const res = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.event && data.me) {
    state.event = data.event;
    state.me = data.me;
    afterJoin();
  } else {
    toast(data.error || 'Join failed');
  }
}

function afterJoin() {
  byId('joinSection').classList.add('hidden');
  byId('eventSection').classList.remove('hidden');
  renderEventHeader();
  renderMeCard();
  renderParticipants();

  // socket
  if (!state.socket) {
    state.socket = io();
    state.socket.on('connect', () => {
      if (state.event?.code) state.socket.emit('join-room', state.event.code);
    });
    state.socket.on('roster', (ev) => {
      // preserve me's latest fields
      if (state.me) {
        const mine = ev.users.find(u => u.id === state.me.id);
        if (mine) state.me = { ...state.me, ...mine };
      }
      state.event = ev;
      renderEventHeader();
      renderParticipants();
      renderMeCard();
    });
    state.socket.on('nudge', (msg) => {
      if (!state.me) return;
      if (msg.to === state.me.id) {
        toast('👋 Someone nudged you!');
      }
    });
  } else {
    state.socket.emit('join-room', state.event.code);
  }
}

async function updateMe(partial) {
  if (!state.event || !state.me) return;
  const res = await fetch(`/api/event/${state.event.code}/user/${state.me.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial)
  });
  const data = await res.json();
  if (data.ok) {
    state.me = data.me;
    toast('Saved.');
  } else {
    toast('Save failed.');
  }
}

async function nudge(to) {
  if (!state.event || !state.me) return;
  const res = await fetch(`/api/event/${state.event.code}/nudge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: state.me.id, to })
  });
  const data = await res.json();
  if (data.ok) toast('👋 Nudge sent.');
}

function shareLink() {
  if (!state.event) return;
  const url = new URL(window.location.href);
  url.searchParams.set('e', state.event.code);
  navigator.clipboard.writeText(url.toString()).then(() => {
    toast('Copied invite link to clipboard.');
  }, () => {
    prompt('Copy this link:', url.toString());
  });
}

function bindUI() {
  byId('createEventBtn').onclick = createEvent;
  byId('joinBtn').onclick = () => joinFlow();

  $$('.statusBtn').forEach(btn => {
    btn.onclick = () => updateMe({ status: btn.dataset.status });
  });
  byId('toggleVisibleBtn').onclick = () => updateMe({ hidden: !(state.me && state.me.hidden) });

  byId('shareLinkBtn').onclick = shareLink;
  byId('filterText').oninput = (e) => { state.filterText = e.target.value; renderParticipants(); };

  // if link has ?e=CODE, prefill
  const ecode = qsParam('e');
  if (ecode) {
    byId('joinCode').value = ecode;
  }

  // allow /e/CODE route
  const m = window.location.pathname.match(/^\/e\/([A-Za-z0-9]+)/);
  if (m) {
    byId('joinCode').value = m[1];
    setQSParams({ e: m[1] });
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.remove(); }, 2500);
}

window.addEventListener('DOMContentLoaded', bindUI);