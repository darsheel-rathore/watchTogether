// Watch Together Sync - service worker.
// Owns the WebSocket to the room server, and relays between the server, the
// popup, and the content script that sits next to the <video> (possibly inside
// a cross-origin iframe).
'use strict';

let cfg = { joined: false, server: '', room: '', name: '' };
const st = {
  connected: false, error: '', id: null, hostId: null, everyone: false, mode: 'none',
  members: [], media: { src: null, playing: false, pos: 0, at: 0 },
  pageBy: '', pageNew: false, lastEvent: '',
};
let ws = null, retryTimer = null, retries = 0, ignorePageEcho = null;
const videos = new Set();   // { port, area } one per frame that has a <video>
const popups = new Set();
let active = null;          // the video entry we are syncing (largest on screen)

const ready = chrome.storage.local.get('cfg').then((r) => {
  if (r && r.cfg) cfg = { ...cfg, ...r.cfg };
  if (cfg.joined) connect();
});
const saveCfg = () => chrome.storage.local.set({ cfg });

// ---------- helpers ----------
const canControl = () => st.id != null && (st.id === st.hostId || st.everyone);
const curPos = () => (st.media.playing ? st.media.pos + (Date.now() - st.media.at) / 1000 : st.media.pos);
const post = (port, msg) => { try { port.postMessage(msg); } catch (e) { /* port gone */ } };
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
function normServer(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s) ? 'http://' : 'https://') + s;
  }
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch (e) { return ''; }
}
const wsUrl = (origin) => origin.replace(/^http/, 'ws') + '/ws';
const normRoom = (r) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

function publicState() {
  return {
    joined: cfg.joined, connected: st.connected, error: st.error,
    server: cfg.server, room: cfg.room, name: cfg.name,
    members: st.members, hostId: st.hostId, myId: st.id, everyone: st.everyone,
    canControl: canControl(), videoFound: !!active,
    pageUrl: st.media.src, pageBy: st.pageBy, pageNew: st.pageNew, lastEvent: st.lastEvent,
  };
}
function pushPopups() {
  const s = publicState();
  for (const p of popups) post(p, { type: 'state', s });
  try { chrome.action.setBadgeText({ text: st.pageNew ? '!' : '' }); chrome.action.setBadgeBackgroundColor({ color: '#7c5cff' }); } catch (e) { /* ignore */ }
}

// ---------- which video do we drive? ----------
function elect() {
  let best = null;
  if (cfg.joined && st.connected) {
    for (const v of videos) if (v.area > 0 && (!best || v.area > best.area)) best = v;
  }
  const changed = best !== active;
  active = best;
  for (const v of videos) post(v.port, { type: 'config', active: v === active, canControl: canControl() });
  if (changed && active) post(active.port, { type: 'state', playing: st.media.playing, pos: curPos(), action: 'welcome' });
  pushPopups();
}

// ---------- server connection ----------
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
  clearTimeout(retryTimer);
  if (!cfg.joined) return;
  if (ws && ws.readyState <= 1) return;
  let sock;
  try { sock = new WebSocket(wsUrl(cfg.server)); }
  catch (e) { st.error = 'That server address does not look right'; pushPopups(); return; }
  ws = sock;
  sock.onopen = () => {
    retries = 0; st.error = '';
    sock.send(JSON.stringify({ t: 'join', room: cfg.room, name: cfg.name, ext: true }));
  };
  sock.onmessage = (e) => { try { onServer(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  sock.onerror = () => { st.error = 'Cannot reach the server. Is it running, and is the address right?'; };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; st.connected = false; st.id = null;
    if (!st.error) st.error = 'Disconnected, retrying…';
    elect();
    if (cfg.joined) retryTimer = setTimeout(connect, Math.min(1000 * ++retries, 5000));
  };
}

function disconnect() {
  clearTimeout(retryTimer);
  const s = ws; ws = null;
  if (s) { try { s.close(); } catch (e) { /* ignore */ } }
  Object.assign(st, { connected: false, error: '', id: null, hostId: null, everyone: false, mode: 'none',
    members: [], media: { src: null, playing: false, pos: 0, at: 0 }, pageBy: '', pageNew: false, lastEvent: '' });
}

function eventText(m) {
  const t = fmt(m.pos);
  return m.action === 'play' ? `${m.by} pressed play at ${t}`
    : m.action === 'pause' ? `${m.by} paused at ${t}`
    : `${m.by} jumped to ${t}`;
}

function onServer(m) {
  switch (m.t) {
    case 'welcome':
      Object.assign(st, { id: m.id, hostId: m.hostId, everyone: m.everyone, mode: m.mode, members: m.members,
        connected: true, error: '', lastEvent: '', pageNew: false, pageBy: '' });
      st.media = { src: m.state.src, playing: m.state.playing, pos: m.state.pos, at: Date.now() };
      elect();
      break;
    case 'members':
      st.members = m.members; st.hostId = m.hostId; st.everyone = m.everyone;
      elect();
      break;
    case 'mode': st.mode = m.mode; pushPopups(); break;
    case 'state': {
      st.media = { src: m.src || st.media.src, playing: m.playing, pos: m.pos, at: Date.now() };
      if (m.action !== 'sync' && m.by) st.lastEvent = eventText(m);
      if (active) post(active.port, { type: 'state', playing: m.playing, pos: m.pos, action: m.action, by: m.by });
      if (m.action !== 'sync') pushPopups();
      break;
    }
    case 'page': {
      st.media = { src: m.url, playing: false, pos: 0, at: Date.now() };
      if (ignorePageEcho === m.url) { ignorePageEcho = null; st.pageNew = false; }
      else { st.pageBy = m.by; st.pageNew = true; }
      pushPopups();
      break;
    }
  }
}

// ---------- content scripts (one port per frame that has a video) ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popups.add(port);
    port.onDisconnect.addListener(() => popups.delete(port));
    ready.then(() => post(port, { type: 'state', s: publicState() }));
    return;
  }
  if (port.name !== 'video') return;
  const v = { port, area: 0 };
  videos.add(v);
  port.onMessage.addListener(async (m) => { await ready; onVideoMsg(v, m); });
  port.onDisconnect.addListener(() => { videos.delete(v); if (active === v) active = null; elect(); });
  ready.then(() => post(port, { type: 'config', active: false, canControl: canControl() }));
});

function onVideoMsg(v, m) {
  if (m.type === 'info') {
    const changed = v.area !== (m.area | 0);
    v.area = m.area | 0;
    if (changed) elect();
  } else if (m.type === 'ctl') {
    if (v !== active || !canControl()) return;
    if (m.action === 'play' || m.action === 'pause' || m.action === 'seek') {
      st.media = { src: st.media.src, playing: m.action === 'play' ? true : m.action === 'pause' ? false : st.media.playing,
        pos: m.time, at: Date.now() };
      send({ t: 'ctl', action: m.action, time: m.time });
    }
  } else if (m.type === 'sync') {
    if (v === active) send({ t: 'sync' });
  }
}

// ---------- popup commands ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ready.then(() => {
    switch (msg.type) {
      case 'getState': sendResponse({ s: publicState() }); return;
      case 'join': {
        const server = normServer(msg.server), room = normRoom(msg.room);
        const name = String(msg.name || '').trim().slice(0, 24) || 'Guest';
        if (!server) return sendResponse({ error: 'Enter the server address (e.g. the ngrok link).' });
        if (room.length < 3) return sendResponse({ error: 'Room code must be at least 3 letters or digits.' });
        disconnect();
        cfg = { joined: true, server, room, name };
        saveCfg(); connect(); elect();
        return sendResponse({ ok: true });
      }
      case 'leave':
        cfg.joined = false; saveCfg(); disconnect(); elect();
        return sendResponse({ ok: true });
      case 'everyone':
        send({ t: 'everyone', value: !!msg.value });
        return sendResponse({ ok: true });
      case 'sharePage':
        ignorePageEcho = msg.url;
        send({ t: 'page', url: msg.url });
        return sendResponse({ ok: true });
      case 'localMute':
        // from the room page: mute/unmute the movie in THIS browser only
        if (active) { post(active.port, { type: 'localMute', muted: !!msg.muted }); return sendResponse({ ok: true }); }
        return sendResponse({ ok: false });
      case 'pageSeen':
        st.pageNew = false; pushPopups();
        return sendResponse({ ok: true });
      default: sendResponse({});
    }
  });
  return true; // async response
});

// The worker can be stopped by Chrome; wake up regularly and reconnect if needed.
chrome.alarms.create('wt-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { ready.then(() => { if (cfg.joined && !ws) connect(); }); });
