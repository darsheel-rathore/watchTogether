// Watch Together - tiny room server (Express + WebSocket)
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/room/:code', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}
app.get('/api/info', (_req, res) => res.json({ ips: lanIps(), port: PORT }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---- room state ------------------------------------------------------------
const rooms = new Map();
let nextId = 1;

const now = () => Date.now();
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const curPos = (r) => (r.state.playing ? r.state.time + (now() - r.state.ts) / 1000 : r.state.time);
const pubState = (r) => ({ src: r.state.src, playing: r.state.playing, pos: curPos(r) });
const membersList = (r) => [...r.members.values()].map((m) => ({ id: m.id, name: m.name }));
const canControl = (r, id) => id === r.hostId || r.everyone;

function broadcast(r, obj, exceptId) {
  for (const m of r.members.values()) if (m.id !== exceptId) send(m.ws, obj);
}
function sendMembers(r) {
  broadcast(r, { t: 'members', members: membersList(r), hostId: r.hostId, everyone: r.everyone });
}
function sysChat(r, text) {
  const msg = { t: 'chat', system: true, text, ts: now() };
  r.chat.push(msg); if (r.chat.length > 50) r.chat.shift();
  broadcast(r, msg);
}
function stopShare(r) {
  if (r.sharer != null) {
    r.sharer = null;
    if (r.mode === 'screen') r.mode = 'none';
    broadcast(r, { t: 'mode', mode: r.mode, sharer: null });
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null;
  let me = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      if (room) return;
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      if (!code) return;
      const name = String(m.name || 'Guest').trim().slice(0, 24) || 'Guest';
      room = rooms.get(code);
      if (!room) {
        room = { code, members: new Map(), hostId: null, everyone: false, mode: 'none', sharer: null,
                 state: { src: null, playing: false, time: 0, ts: now() }, chat: [] };
        rooms.set(code, room);
      }
      me = { id: nextId++, ws, name };
      room.members.set(me.id, me);
      if (room.hostId == null) room.hostId = me.id;

      send(ws, { t: 'welcome', id: me.id, room: code, hostId: room.hostId, everyone: room.everyone,
                 mode: room.mode, sharer: room.sharer, state: pubState(room),
                 members: membersList(room), chat: room.chat });
      sendMembers(room);
      sysChat(room, `${name} joined`);
      if (room.mode === 'screen' && room.sharer != null) {
        const sh = room.members.get(room.sharer);
        if (sh) send(sh.ws, { t: 'viewer', id: me.id });
      }
      return;
    }
    if (!room || !me) return;

    switch (m.t) {
      case 'ctl': {
        if (!canControl(room, me.id) || room.mode !== 'video' || !room.state.src) return;
        const time = Number(m.time); if (!Number.isFinite(time)) return;
        const s = room.state;
        if (m.action === 'play') { s.playing = true; s.time = time; s.ts = now(); }
        else if (m.action === 'pause') { s.playing = false; s.time = time; s.ts = now(); }
        else if (m.action === 'seek') { s.time = time; s.ts = now(); }
        else return;
        broadcast(room, { t: 'state', ...pubState(room), action: m.action, by: me.name }, me.id);
        break;
      }
      case 'load': {
        if (!canControl(room, me.id)) return;
        let url;
        try { url = new URL(String(m.url || '').trim()); } catch { return send(ws, { t: 'error', msg: 'That is not a valid link.' }); }
        if (!/^https?:$/.test(url.protocol)) return send(ws, { t: 'error', msg: 'Link must start with http(s)://' });
        room.state = { src: url.href, playing: false, time: 0, ts: now() };
        room.sharer = null; room.mode = 'video';
        broadcast(room, { t: 'mode', mode: 'video', sharer: null });
        broadcast(room, { t: 'state', ...pubState(room), action: 'load', by: me.name });
        sysChat(room, `${me.name} loaded a video`);
        break;
      }
      case 'sync': send(ws, { t: 'state', ...pubState(room), action: 'sync' }); break;
      case 'everyone':
        if (me.id !== room.hostId) return;
        room.everyone = !!m.value;
        sendMembers(room);
        sysChat(room, room.everyone ? 'Everyone can control playback now' : 'Only the host controls playback now');
        break;
      case 'share-start': {
        if (!canControl(room, me.id)) return send(ws, { t: 'error', code: 'denied', msg: 'You do not have control.' });
        if (room.sharer != null && room.sharer !== me.id) return send(ws, { t: 'error', code: 'busy', msg: 'Someone else is already sharing.' });
        room.sharer = me.id; room.mode = 'screen';
        room.state = { src: null, playing: false, time: 0, ts: now() };
        broadcast(room, { t: 'mode', mode: 'screen', sharer: me.id });
        send(ws, { t: 'viewers', ids: [...room.members.keys()].filter((i) => i !== me.id) });
        sysChat(room, `${me.name} started sharing their screen`);
        break;
      }
      case 'share-stop': if (room.sharer === me.id) stopShare(room); break;
      case 'rtc': {
        const to = room.members.get(m.to);
        if (to) send(to.ws, { t: 'rtc', from: me.id, data: m.data });
        break;
      }
      case 'chat': {
        const text = String(m.text || '').trim().slice(0, 500);
        if (!text) return;
        const msg = { t: 'chat', name: me.name, id: me.id, text, ts: now() };
        room.chat.push(msg); if (room.chat.length > 50) room.chat.shift();
        broadcast(room, msg);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.members.delete(me.id);
    if (room.sharer === me.id) stopShare(room);
    if (room.members.size === 0) { rooms.delete(room.code); return; }
    if (room.hostId === me.id) room.hostId = room.members.keys().next().value;
    sendMembers(room);
    sysChat(room, `${me.name} left`);
  });
});

// keep connections alive (tunnels drop idle sockets)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000);

server.listen(PORT, () => {
  console.log('\n  Watch Together is running\n');
  console.log(`  You (host):      http://localhost:${PORT}`);
  for (const ip of lanIps()) console.log(`  Same Wi-Fi:      http://${ip}:${PORT}`);
  console.log('\n  Different network? Run:  cloudflared tunnel --url http://localhost:' + PORT + '\n');
});
