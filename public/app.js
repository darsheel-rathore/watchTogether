(() => {
  const $ = (s) => document.querySelector(s);
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

  const S = {
    ws: null, id: null, code: null, name: 'Guest', password: '', create: false, created: false,
    leaving: false, joinFailed: false, retry: 0,
    hostId: null, everyone: false, mode: 'none', sharer: null, members: [],
    src: null, pending: null, localStream: null, pcs: new Map(), viewerPc: null, hls: null,
    expect: { play: 0, pause: 0, seek: 0 }, lanIps: [], port: location.port, unread: 0,
    // where the movie is when it plays in people's own browsers (extension / screen share)
    room: { playing: false, pos: 0, at: 0, known: false }, whoUntil: 0,
  };
  const video = $('#video');

  // ---------- small helpers ----------
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };
  let toastTimer;
  function toast(msg, ms = 4000) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }
  const send = (o) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };
  const canControl = () => S.id != null && (S.id === S.hostId || S.everyone);
  const fmt = (s) => {
    if (!Number.isFinite(s)) return '0:00';
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  const peopleCount = (ms) => {
    const web = ms.filter((m) => !m.ext).length, ext = ms.length - web;
    return Math.max(web, ext);          // someone using page + extension counts once
  };
  const codeFromPath = () => ((location.pathname.match(/^\/room\/([A-Za-z0-9]{3,12})/) || [])[1] || '').toUpperCase();
  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint32Array(6); crypto.getRandomValues(a);
    return [...a].map((n) => chars[n % chars.length]).join('');
  }
  function randomPassword() { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); }
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch { prompt('Copy this:', text); }
  }

  // ---------- landing ----------
  const nameInput = $('#name');
  try { nameInput.value = localStorage.getItem('wt-name') || ''; } catch {}
  let infoTimer = 0;

  function setErr(msg) { const e = $('#landingErr'); e.hidden = !msg; e.textContent = msg || ''; }

  function setupLanding() {
    const code = codeFromPath();
    $('#createBlock').hidden = !!code;
    $('#linkBlock').hidden = !code;
    $('#landingSub').textContent = code ? "You've been invited to watch together."
      : 'Make a room, send the link and password, watch in sync.';
    clearInterval(infoTimer);
    if (code) { pollInfo(code); infoTimer = setInterval(() => pollInfo(code), 5000); }
  }
  async function pollInfo(code) {
    const box = $('#roomInfo');
    let info = null;
    try { info = await (await fetch('/api/room/' + code, { cache: 'no-store' })).json(); } catch {}
    if (codeFromPath() !== code) return;
    box.className = 'roominfo';
    if (!info) { box.textContent = 'Could not check the room right now. You can still try to join.'; return; }
    if (!info.exists) {
      box.classList.add('bad');
      box.innerHTML = `⚠️ Room <b>${code}</b> doesn't exist, or it has already ended.<br><span class="muted">Ask your partner for a fresh link, or create a new room.</span>`;
      $('#btnJoinLink').disabled = true; $('#pwLink').disabled = true; $('#btnNewInstead').hidden = false;
      return;
    }
    box.classList.add('ok');
    const n = info.people;
    box.innerHTML = `✅ Room <b>${code}</b> is open · 👥 <b>${n}</b> ${n === 1 ? 'person is' : 'people are'} inside` +
      (info.locked ? '<br><span class="muted">🔒 Enter the password to join.</span>' : '');
    $('#btnJoinLink').disabled = false; $('#pwLink').disabled = false; $('#btnNewInstead').hidden = true;
  }

  function showLanding(msg) {
    $('#landing').hidden = false; $('#room').hidden = true;
    setupLanding(); setErr(msg);
    document.title = 'Watch Together';
  }

  function enter(code, { password, create }) {
    S.name = nameInput.value.trim() || 'Guest';
    try { localStorage.setItem('wt-name', S.name); } catch {}
    Object.assign(S, { code, password, create: !!create, created: !!create, leaving: false, joinFailed: false, retry: 0 });
    store.set('wt-room', JSON.stringify({ code, password, create: !!create, name: S.name }));
    clearInterval(infoTimer);
    setErr('');
    history.replaceState(null, '', '/room/' + code);
    $('#landing').hidden = true; $('#room').hidden = false;
    $('#roomCode').textContent = code;
    setConn('warn', 'Connecting…');
    connect();
  }

  const createRoom = () => enter(randomCode(), { password: randomPassword(), create: true });
  $('#btnCreate').onclick = createRoom;
  $('#btnNewInstead').onclick = () => { history.replaceState(null, '', '/'); createRoom(); };
  $('#btnJoin').onclick = () => {
    const c = $('#codeInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pw = $('#pwInput').value.trim();
    if (c.length < 3) return setErr('Enter the room code.');
    if (!pw) return setErr('Enter the room password.');
    enter(c, { password: pw, create: false });
  };
  $('#btnJoinLink').onclick = () => {
    const pw = $('#pwLink').value.trim();
    if (!pw) return setErr('Enter the room password.');
    enter(codeFromPath(), { password: pw, create: false });
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeFromPath() ? $('#pwLink') : $('#btnCreate')).focus(); });
  $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#pwInput').focus(); });
  $('#pwInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
  $('#pwLink').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoinLink').click(); });

  fetch('/api/info').then((r) => r.json()).then((i) => { S.lanIps = i.ips || []; S.port = i.port; }).catch(() => {});

  // ---------- room header: invite, password, leave ----------
  function inviteLink() {
    let origin = location.origin;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (local && S.lanIps.length) origin = `http://${S.lanIps[0]}:${location.port || S.port}`;
    return `${origin}/room/${S.code}`;
  }
  const lanNote = () => (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? ' (same Wi-Fi only; use a tunnel or hosted link for other networks)' : '');
  $('#btnCopy').onclick = () => copyText(inviteLink(), 'Invite link copied' + lanNote());
  $('#btnInvLink').onclick = $('#btnCopy').onclick;
  $('#btnInvPw').onclick = () => copyText(S.password, 'Password copied');
  $('#btnPwCopy').onclick = $('#btnInvPw').onclick;
  // one line on purpose: the Chrome extension can read it when pasted into its one-line box
  $('#btnInvBoth').onclick = () => copyText(`Watch Together room: ${inviteLink()} | Password: ${S.password}`, 'Link and password copied');
  $('#btnInvClose').onclick = () => { $('#invite').hidden = true; store.set('wt-invite-closed-' + S.code, '1'); };
  let pwShown = false;
  $('#btnPwShow').onclick = () => { pwShown = !pwShown; $('#pwText').textContent = pwShown ? S.password : '••••••'; };

  function leaveRoom() {
    S.leaving = true;
    store.del('wt-room');
    leaveVoiceLocal(); cleanupRtc(); clearVideo();
    const ws = S.ws; S.ws = null; if (ws) { try { ws.close(); } catch {} }
    Object.assign(S, { id: null, mode: 'none', sharer: null, members: [], hostId: null, created: false, password: '' });
    $('#chat').innerHTML = ''; $('#who').textContent = ''; $('#invite').hidden = true;
    history.pushState(null, '', '/');
    showLanding('');
  }
  $('#btnLeaveRoom').onclick = () => { if (confirm('Leave this room?')) leaveRoom(); };
  window.addEventListener('popstate', () => { if (!$('#room').hidden && !codeFromPath()) leaveRoom(); });

  function setConn(kind, text) {
    const c = $('#conn'); c.className = 'conn ' + (kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : '');
    $('#connText').textContent = text;
  }

  // ---------- websocket ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    S.ws = ws;
    ws.onopen = () => {
      S.retry = 0;
      ws.send(JSON.stringify({ t: 'join', room: S.code, name: S.name, password: S.password, create: S.create }));
    };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => {
      if (S.ws !== ws || S.leaving || S.joinFailed) return;
      cleanupRtc(); clearVideo(); leaveVoiceLocal();
      S.id = null; S.mode = 'none'; S.sharer = null; render();
      setConn('bad', 'Reconnecting…');
      setTimeout(() => { if (!S.leaving && !S.joinFailed && S.ws === ws) connect(); }, Math.min(1000 * ++S.retry, 5000));
    };
  }

  function handle(m) {
    switch (m.t) {
      case 'welcome':
        S.id = m.id; S.hostId = m.hostId; S.everyone = m.everyone; S.members = m.members;
        S.mode = m.mode; S.sharer = m.sharer;
        setConn('ok', 'Connected');
        $('#chat').innerHTML = ''; m.chat.forEach(addChat);
        $('#pwWrap').hidden = !S.created; $('#pwText').textContent = pwShown ? S.password : '••••••';
        $('#invitePw').textContent = S.password;
        $('#invite').hidden = !(S.created && !store.get('wt-invite-closed-' + S.code));
        renderMembers(); render();
        if (m.mode === 'video' && m.state.src) applyState(m.state, 0.7);
        else setRoomState(m.state);
        break;
      case 'join-error':
        S.joinFailed = true;
        store.del('wt-room');
        { const ws = S.ws; S.ws = null; if (ws) try { ws.close(); } catch {} }
        history.replaceState(null, '', '/room/' + S.code);
        showLanding(m.msg);
        break;
      case 'members':
        S.members = m.members; S.hostId = m.hostId; S.everyone = m.everyone;
        renderMembers(); render(); pruneVoicePeers(); break;
      case 'voice-peers': m.ids.forEach(offerVoice); break;
      case 'vrtc': onVoiceRtc(m.from, m.data); break;
      case 'chat': addChat(m); break;
      case 'mode': onMode(m.mode, m.sharer); break;
      case 'state':
        if (S.mode === 'video') applyState(m, m.action === 'sync' ? 1.5 : 0.7);
        else if (S.mode === 'ext' || S.mode === 'screen') setRoomState(m);
        if (m.by && m.action !== 'sync' && Date.now() > S.whoUntil) $('#who').textContent = labelFor(m);
        renderControls();
        break;
      case 'remote':
        // someone pressed a button on their room page; the extension reports the result as 'state'
        $('#who').textContent = remoteLabel(m);
        S.whoUntil = Date.now() + 2500;
        break;
      case 'viewers': m.ids.forEach(offerTo); break;
      case 'viewer': if (S.localStream) offerTo(m.id); break;
      case 'rtc': onRtc(m.from, m.data); break;
      case 'error':
        toast(m.msg);
        if (m.code) stopLocalStream();
        render(); break;
    }
  }
  function labelFor(m) {
    const t = fmt(m.pos);
    return m.action === 'load' ? `${m.by} loaded the video` :
      m.action === 'play' ? `${m.by} pressed play at ${t}` :
      m.action === 'pause' ? `${m.by} paused at ${t}` : `${m.by} jumped to ${t}`;
  }
  const remoteLabel = (m) => (m.action === 'play' ? `${m.by} pressed play`
    : m.action === 'pause' ? `${m.by} paused` : `${m.by} skipped ${m.delta > 0 ? '+' : ''}${m.delta}s`);

  function onMode(mode, sharer) {
    const prev = S.mode;
    if (prev !== mode || S.sharer !== sharer) S.room = { playing: false, pos: 0, at: performance.now(), known: false };
    S.mode = mode; S.sharer = sharer;
    if (S.localStream && sharer !== S.id) stopLocalStream();
    if (prev === 'screen' && (mode !== 'screen' || sharer !== (S.viewerPc && S.viewerPc._from))) closeViewerPc();
    if (mode !== 'video') { clearVideo(); $('#who').textContent = ''; }
    render();
  }

  // ---------- rendering ----------
  function render() {
    const sharingMe = S.mode === 'screen' && S.sharer === S.id;
    const viewingScreen = S.mode === 'screen' && !sharingMe;
    const hasVideo = (S.mode === 'video' && !!S.src) || (viewingScreen && !!video.srcObject);
    const player = $('#player');
    player.classList.toggle('has-video', hasVideo);
    player.classList.toggle('screen-viewer', viewingScreen);
    player.classList.toggle('no-control', !canControl());
    $('#idle').hidden = !(S.mode === 'none' || (S.mode === 'video' && !S.src));
    $('#extPanel').hidden = S.mode !== 'ext';
    if (S.mode === 'ext') startExtPing();
    $('#sharingMe').hidden = !sharingMe;
    $('#waitStream').hidden = !(viewingScreen && !video.srcObject);
    $('#bar').hidden = !hasVideo;
    $('#loadForm').querySelectorAll('input,button').forEach((el) => (el.disabled = !canControl()));
    $('#urlInput').placeholder = canControl()
      ? 'Paste a direct video link (.mp4 / .webm / .m3u8)…'
      : 'Only the host can pick what plays (host can enable "Let everyone control")';
    const share = $('#btnShare');
    share.disabled = !canControl();
    share.textContent = sharingMe ? '⏹ Stop sharing' : '📺 Share my screen / tab';
    $('#everyoneWrap').hidden = S.id !== S.hostId;
    $('#everyone').checked = S.everyone;
    if (!hasVideo) $('#tap').hidden = true;
    renderControls();
  }

  function renderMembers() {
    const ul = $('#members'); ul.innerHTML = '';
    // extension clients are the same people as the page clients, so don't list them twice
    const shown = S.members.filter((m) => !m.ext);
    shown.forEach((m) => {
      const li = document.createElement('li'); li.dataset.id = m.id;
      const av = document.createElement('span'); av.className = 'avatar'; av.textContent = (m.name[0] || '?').toUpperCase();
      const nm = document.createElement('span'); nm.className = 'mname'; nm.textContent = m.name + (m.id === S.id ? ' (you)' : '');
      li.append(av, nm);
      if (m.id === S.hostId) { const b = document.createElement('span'); b.className = 'badge host'; b.textContent = 'host'; li.append(b); }
      else if (S.everyone) { const b = document.createElement('span'); b.className = 'badge ctl'; b.textContent = 'controls'; li.append(b); }
      if (m.voice && m.muted) { const v = document.createElement('span'); v.className = 'vmark'; v.textContent = '🔇'; v.title = 'muted'; li.append(v); }
      else if (m.voice) {
        const mt = document.createElement('span'); mt.className = 'meter'; mt.title = 'in voice';
        for (let i = 0; i < 5; i++) mt.append(document.createElement('i'));
        li.append(mt);
      }
      ul.append(li);
    });
    const ext = S.members.filter((m) => m.ext);
    $('#extNote').hidden = !ext.length;
    $('#extNote').textContent = ext.length ? '🧩 Synced via extension: ' + ext.map((m) => m.name).join(', ') : '';
    const n = peopleCount(S.members);
    $('#peopleCount').textContent = '👥 ' + n;
    $('#peopleN').textContent = '· ' + n;
  }

  function addChat(m) {
    const box = $('#chat'); const d = document.createElement('div');
    if (m.system) { d.className = 'msg sys'; d.textContent = m.text; }
    else {
      d.className = 'msg' + (m.id === S.id ? ' me' : '');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = m.name;
      d.append(n, document.createTextNode(m.text));
      if (m.id !== S.id && document.hidden) { S.unread++; document.title = `(${S.unread}) Watch Together`; }
    }
    box.append(d); box.scrollTop = box.scrollHeight;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { S.unread = 0; document.title = 'Watch Together'; } });
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const i = $('#chatInput'); const text = i.value.trim();
    if (text) send({ t: 'chat', text }); i.value = '';
  };

  // ---------- controls ----------
  $('#everyone').onchange = (e) => send({ t: 'everyone', value: e.target.checked });
  $('#loadForm').onsubmit = (e) => {
    e.preventDefault();
    const url = $('#urlInput').value.trim();
    if (url) send({ t: 'load', url });
  };

  // ---------- synced video (built-in player) ----------
  let hlsPromise;
  function ensureHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsPromise) hlsPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
      s.onload = () => res(window.Hls); s.onerror = rej; document.head.append(s);
    });
    return hlsPromise;
  }
  function destroyHls() { if (S.hls) { S.hls.destroy(); S.hls = null; } }
  function setSource(src) {
    destroyHls(); video.srcObject = null;
    if (/\.m3u8(\?|#|$)/i.test(src)) {
      ensureHls().then((Hls) => {
        if (S.src !== src) return;
        if (Hls.isSupported()) { S.hls = new Hls(); S.hls.loadSource(src); S.hls.attachMedia(video); }
        else video.src = src;
      }).catch(() => toast('Could not load the HLS player'));
    } else video.src = src;
  }
  function clearVideo() {
    destroyHls();
    try { video.pause(); } catch {}
    video.srcObject = null; video.removeAttribute('src'); video.load();
    S.src = null; S.pending = null; $('#tap').hidden = true;
  }

  function applyState(s, tol) {
    s = { ...s, at: performance.now() };
    if (!s.src) { if (S.src) { clearVideo(); render(); } return; }
    if (s.src !== S.src) { S.src = s.src; S.pending = s; setSource(s.src); render(); return; }
    if (video.readyState === 0) { S.pending = s; return; }
    applyPos(s, tol);
  }
  function applyPos(s, tol) {
    const target = s.pos + (s.playing ? (performance.now() - s.at) / 1000 : 0);
    if (Math.abs(video.currentTime - target) > tol) {
      expect('seek');
      try { video.currentTime = target; } catch {}
    }
    if (s.playing && video.paused) {
      expect('play');
      video.play().then(() => ($('#tap').hidden = true)).catch(() => { S.expect.play = 0; $('#tap').hidden = false; });
    } else if (!s.playing && !video.paused) { expect('pause'); video.pause(); }
  }
  // mark a media event WE are about to cause, so it is not echoed back to the room
  function expect(kind) { S.expect[kind] = Date.now() + 2500; }
  function expected(kind) {
    const hit = S.expect[kind] && Date.now() < S.expect[kind];
    S.expect[kind] = 0; return !!hit;
  }
  video.addEventListener('loadedmetadata', () => {
    $('#seek').max = video.duration || 0;
    if (S.pending) { const p = S.pending; S.pending = null; applyPos(p, 0.1); }
  });
  video.addEventListener('error', () => { if (S.src) toast('Could not play this link. It may not be a direct video file, or the site blocks embedding.', 7000); });

  const userEvt = (action) => {
    if (expected(action)) return;
    if (S.mode !== 'video' || !canControl()) return;
    send({ t: 'ctl', action, time: video.currentTime });
  };
  video.addEventListener('play', () => userEvt('play'));
  video.addEventListener('pause', () => userEvt('pause'));   // also fires at the end of the movie
  video.addEventListener('seeked', () => userEvt('seek'));

  // in-player control bar
  let dragging = false;
  video.addEventListener('timeupdate', () => {
    if (S.mode !== 'video') return;
    if (!dragging) $('#seek').value = video.currentTime;
    $('#time').textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
  });
  video.addEventListener('play', () => ($('#btnPlay').textContent = '❚❚'));
  video.addEventListener('pause', () => ($('#btnPlay').textContent = '▶'));
  // (this bar is only shown in fullscreen; the strip under the player does the same)
  $('#btnPlay').onclick = () => togglePlay();
  $('#btnBack').onclick = () => skip(-10);
  $('#btnFwd').onclick = () => skip(10);
  $('#seek').addEventListener('input', () => { dragging = true; $('#time').textContent = `${fmt($('#seek').value)} / ${fmt(video.duration)}`; });
  $('#seek').addEventListener('change', () => { dragging = false; if (canControl()) video.currentTime = Number($('#seek').value); });
  function syncMute() { $('#btnMovieMute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊'; }
  $('#vol').oninput = () => { video.volume = Number($('#vol').value); video.muted = video.volume === 0; syncMute(); };
  $('#btnMovieMute').onclick = () => { video.muted = !video.muted; syncMute(); };
  $('#btnFs').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#player').requestFullscreen().catch(() => {});
  };
  $('#tap').onclick = () => { video.play().then(() => ($('#tap').hidden = true)).catch(() => {}); };

  // keyboard: Space = play/pause, arrows = +-10s, F = fullscreen
  // (ignored while typing, and while a button has focus: Space already clicks that button)
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && playable()) { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft' && playable()) { e.preventDefault(); skip(-10); }
    else if (e.key === 'ArrowRight' && playable()) { e.preventDefault(); skip(10); }
    else if (e.key === 'f' && fsAllowed()) toggleFs();
  });

  // drift correction
  setInterval(() => { if (S.mode === 'video' && S.src) send({ t: 'sync' }); }, 5000);

  // ---------- playback controls: the strip under the player ----------
  // 'local'  = the built-in player on this page (a direct link was loaded)
  // 'remote' = the movie plays in people's own browsers: extension sync, or the sharer's tab
  //            during a screen share. Buttons send a command that the extension carries out.
  // 'off'    = nothing to control yet
  const E = { present: false, muted: false, pings: 0, timer: 0 };
  const cmd = (action, delta) => send({ t: 'cmd', action, delta });
  const extCount = () => S.members.filter((m) => m.ext).length;
  const isSharingMe = () => S.mode === 'screen' && S.sharer === S.id;
  const isViewingScreen = () => S.mode === 'screen' && S.sharer !== S.id;
  function controlKind() {
    if (S.mode === 'video' && S.src) return 'local';
    if (S.mode === 'ext' || S.mode === 'screen') return 'remote';
    return 'off';
  }
  function playable() {
    const k = controlKind();
    return canControl() && (k === 'local' || (k === 'remote' && extCount() > 0));
  }
  const fsAllowed = () => controlKind() === 'local' || (isViewingScreen() && !!video.srcObject);
  const roomPos = () => S.room.pos + (S.room.playing ? (performance.now() - S.room.at) / 1000 : 0);
  function setRoomState(s) {
    S.room = { playing: !!s.playing, pos: s.pos || 0, at: performance.now(), known: s.known !== false };
    renderControls();
  }
  function hintText() {
    const k = controlKind();
    if (k === 'off') return 'Load a link, share a tab, or join this room from the extension to use these.';
    if (!canControl()) return 'Only the host can control playback. The host can tick "Let everyone control".';
    if (k === 'remote' && !extCount()) {
      return S.mode === 'screen'
        ? 'To pause the shared movie from here, the person sharing also joins this room from the extension.'
        : 'Waiting for someone to join from the extension…';
    }
    return '';
  }
  function togglePlay() {
    if (!playable()) return toast(hintText(), 6000);
    if (controlKind() === 'local') { if (video.paused) video.play().catch(() => {}); else video.pause(); }
    else cmd(S.room.known && S.room.playing ? 'pause' : 'play');
  }
  // skip goes through the server so every player jumps by the same amount
  function skip(d) {
    if (!playable()) return toast(hintText(), 6000);
    cmd('skip', d);
  }
  // what "mute" means here: this page's video, or (extension sync) the movie in my own vidbox tab
  function muteTarget() {
    if (controlKind() === 'local' || (isViewingScreen() && video.srcObject)) return 'video';
    if (S.mode === 'ext') return 'ext';
    return null;      // e.g. I'm the one sharing: muting my tab would mute it for everyone
  }
  function toggleMute() {
    const t = muteTarget();
    if (t === 'video') { video.muted = !video.muted; syncMute(); renderControls(); }
    else if (t === 'ext') {
      if (!E.present) return toast('Extension not detected on this page. Reload this page after installing it.', 6000);
      window.postMessage({ wt: 'page', type: 'mute', muted: !E.muted }, location.origin);
    }
  }
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#player').requestFullscreen().catch(() => {});
  }

  let cDragging = false;
  function renderControls() {
    const k = controlKind(), ok = playable();
    ['#cBack', '#cPlay', '#cFwd'].forEach((id) => { $(id).disabled = !ok; });
    const playing = k === 'local' ? !video.paused : (k === 'remote' && S.room.known && S.room.playing);
    $('#cPlay').textContent = playing ? '❚❚' : '▶';
    $('#cPlay').title = (playing ? 'Pause' : 'Play') + ' (Space)';
    $('#cSeek').hidden = k !== 'local';
    if (k === 'local') {
      $('#cSeek').max = video.duration || 0;
      if (!cDragging) $('#cSeek').value = video.currentTime;
      $('#cSeek').disabled = !ok;
      $('#cTime').textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    } else {
      $('#cTime').textContent = k === 'remote' && S.room.known ? fmt(roomPos()) : '--:--';
    }
    $('#cHint').textContent = hintText();

    const mt = muteTarget();
    const muted = !!mt && (mt === 'ext' ? E.muted : (video.muted || video.volume === 0));
    $('#cMute').disabled = !mt;
    $('#cMute').textContent = muted ? '🔇' : '🔊';
    $('#cMute').classList.toggle('muted', muted);
    $('#cMute').title = mt === 'ext' ? 'Mute / unmute the movie in this browser only'
      : mt ? 'Mute / unmute'
      : isSharingMe() ? 'Mute the movie in its own tab if needed (muting here would mute it for everyone)'
      : 'Nothing to mute yet';
    $('#cVol').disabled = mt !== 'video';
    if (mt === 'video' && document.activeElement !== $('#cVol')) $('#cVol').value = video.muted ? 0 : video.volume;
    $('#cFs').disabled = !fsAllowed();

    $('#extClock').textContent = S.room.known ? fmt(roomPos()) : '--:--';
    $('#shareCtlNote').textContent = extCount() > 0
      ? '✓ Your partner can play, pause and skip too: the extension in your browser carries it out.'
      : 'Want your partner to be able to pause? Join this room from the Chrome extension in this browser as well.';
  }
  $('#cPlay').onclick = togglePlay;
  $('#cBack').onclick = () => skip(-10);
  $('#cFwd').onclick = () => skip(10);
  $('#cSeek').addEventListener('input', () => { cDragging = true; $('#cTime').textContent = `${fmt($('#cSeek').value)} / ${fmt(video.duration)}`; });
  $('#cSeek').addEventListener('change', () => {
    cDragging = false;
    if (playable() && controlKind() === 'local') video.currentTime = Number($('#cSeek').value);
  });
  $('#cMute').onclick = toggleMute;
  $('#cVol').oninput = () => { video.volume = Number($('#cVol').value); video.muted = video.volume === 0; syncMute(); renderControls(); };
  $('#cFs').onclick = toggleFs;
  ['play', 'pause', 'timeupdate', 'volumechange', 'loadedmetadata', 'emptied'].forEach((ev) => video.addEventListener(ev, renderControls));
  setInterval(() => { if (S.mode === 'ext' || S.mode === 'screen') renderControls(); }, 500);

  function renderExt() {
    $('#extStatus').textContent = E.present
      ? '✓ Extension detected in this browser'
      : 'Tip: with the extension in this browser too, the mute button mutes your own movie.';
    renderControls();
  }
  // The extension's content script answers these messages on this page.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.wt !== 'ext') return;
    if (e.data.type === 'pong') { E.present = true; renderExt(); }
    else if (e.data.type === 'muteResult') {
      if (e.data.ok) { E.muted = e.data.muted; renderExt(); }
      else toast('No movie found in this browser yet. Open it and press play first.', 6000);
    }
  });
  function startExtPing() {
    if (E.present || E.timer) return renderExt();
    E.pings = 0;
    const ping = () => {
      window.postMessage({ wt: 'page', type: 'ping' }, location.origin);
      if (E.present || ++E.pings > 5) { clearInterval(E.timer); E.timer = 0; }
    };
    E.timer = setInterval(ping, 1500); ping(); renderExt();
  }

  // ---------- screen sharing (WebRTC) ----------
  $('#btnShare').onclick = () => (S.localStream ? stopShare() : startShare());
  $('#btnStopShare').onclick = stopShare;

  async function startShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return toast('Screen sharing needs a secure page: open this app via http://localhost:' + (location.port || S.port) + ' (or an https link).', 8000);
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      S.localStream = stream;
      const v = stream.getVideoTracks()[0];
      try { v.contentHint = 'motion'; } catch {}
      v.addEventListener('ended', stopShare);
      if (!stream.getAudioTracks().length) toast('No sound captured. When picking the tab, tick "Also share tab audio".', 8000);
      send({ t: 'share-start' });
    } catch (e) { if (e.name !== 'NotAllowedError') toast('Could not start sharing: ' + e.message); }
  }
  function stopShare() {
    if (!S.localStream) return;
    send({ t: 'share-stop' });
    stopLocalStream();
  }
  function stopLocalStream() {
    if (S.localStream) { S.localStream.getTracks().forEach((t) => t.stop()); S.localStream = null; }
    S.pcs.forEach((pc) => pc.close()); S.pcs.clear();
    render();
  }
  function closeViewerPc() {
    if (S.viewerPc) { S.viewerPc.close(); S.viewerPc = null; }
    if (video.srcObject) { video.srcObject = null; }
  }
  function cleanupRtc() { stopLocalStream(); closeViewerPc(); }

  async function offerTo(id) {
    if (!S.localStream) return;
    const old = S.pcs.get(id); if (old) old.close();
    const pc = new RTCPeerConnection(ICE); pc._q = [];
    S.pcs.set(id, pc);
    S.localStream.getTracks().forEach((t) => pc.addTrack(t, S.localStream));
    pc.onicecandidate = (e) => e.candidate && send({ t: 'rtc', to: id, data: { candidate: e.candidate } });
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) { pc.close(); if (S.pcs.get(id) === pc) S.pcs.delete(id); } };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      send({ t: 'rtc', to: id, data: { sdp: pc.localDescription } });
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === 'video') {
          const p = sender.getParameters();
          if (!p.encodings || !p.encodings.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = 6_000_000;
          sender.setParameters(p).catch(() => {});
        }
      }
    } catch (e) { console.error(e); }
  }

  async function onRtc(from, data) {
    try {
      if (data.sdp && data.sdp.type === 'offer') {
        closeViewerPc();
        const pc = new RTCPeerConnection(ICE); pc._q = []; pc._from = from; S.viewerPc = pc;
        pc.ontrack = (e) => {
          video.srcObject = e.streams[0]; video.muted = false; syncMute();
          video.play().then(() => ($('#tap').hidden = true)).catch(() => ($('#tap').hidden = false));
          render();
        };
        pc.onicecandidate = (e) => e.candidate && send({ t: 'rtc', to: from, data: { candidate: e.candidate } });
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed') toast('Could not connect to the stream (network/firewall). Same Wi-Fi works best. Ask the host to stop and share again.', 9000);
        };
        await pc.setRemoteDescription(data.sdp);
        for (const c of pc._q) await pc.addIceCandidate(c).catch(() => {});
        pc._q = [];
        await pc.setLocalDescription(await pc.createAnswer());
        send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } });
      } else if (data.sdp && data.sdp.type === 'answer') {
        const pc = S.pcs.get(from); if (!pc) return;
        await pc.setRemoteDescription(data.sdp);
        for (const c of pc._q) await pc.addIceCandidate(c).catch(() => {});
        pc._q = [];
      } else if (data.candidate) {
        const pc = S.viewerPc && S.viewerPc._from === from ? S.viewerPc : S.pcs.get(from);
        if (!pc) return;
        if (pc.remoteDescription) pc.addIceCandidate(data.candidate).catch(() => {}); else pc._q.push(data.candidate);
      }
    } catch (e) { console.error(e); }
  }

  // ---------- voice chat (WebRTC audio, one connection per other person) ----------
  const V = { on: false, muted: false, stream: null, pcs: new Map(), local: null, meterTimer: 0 };
  let audioCtx = null;
  function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  // level meter source: an analyser reading the loudness of an audio stream
  function makeAnalyser(stream) {
    const ctx = ensureAudioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an);                       // not connected to speakers: no echo
    return { an, src, buf: new Float32Array(an.fftSize), level: 0 };
  }
  function closeAnalyser(a) { if (!a) return; try { a.src.disconnect(); } catch {} }
  function readLevel(a) {
    a.an.getFloatTimeDomainData(a.buf);
    let sum = 0; for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
    const rms = Math.sqrt(sum / a.buf.length);
    const db = 20 * Math.log10(rms || 1e-8);          // -60 dB (silence) .. -6 dB (loud)
    const raw = Math.min(1, Math.max(0, (db + 60) / 54));
    a.level = Math.max(raw, a.level * 0.85);          // quick attack, gentle fall
    return a.level;
  }
  function updateMeters() {
    const levels = new Map();
    if (V.local && !V.muted) levels.set(S.id, readLevel(V.local));
    V.pcs.forEach((p, id) => { if (p.an) levels.set(id, readLevel(p.an)); });
    document.querySelectorAll('#members li[data-id]').forEach((li) => {
      const lv = levels.get(+li.dataset.id) || 0;
      const bars = li.querySelectorAll('.meter i');
      const n = Math.round(lv * 5);
      bars.forEach((b, i) => { b.className = i < n ? (i < 3 ? 'g' : i === 3 ? 'y' : 'r') : ''; });
      li.classList.toggle('speaking', bars.length > 0 && lv > 0.2);
    });
  }

  function renderVoice() {
    $('#btnVoice').hidden = V.on;
    $('#voiceOn').hidden = !V.on;
    const b = $('#btnMic');
    b.textContent = V.muted ? '🔇 Unmute' : '🎤 Mute';
    b.classList.toggle('muted', V.muted);
    b.title = V.muted ? 'You are muted. Click to unmute.' : 'Click to mute your microphone';
  }

  async function joinVoice() {
    if (V.on) return;
    if (S.id == null) return toast('Still connecting to the room. Try again in a second.');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return toast('Microphone needs a secure page: use http://localhost or an https link.', 7000);
    }
    try {
      V.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
    } catch (e) {
      return toast(e.name === 'NotAllowedError' ? 'Microphone blocked. Allow it in the address bar and try again.' : 'Could not open the microphone: ' + e.message, 7000);
    }
    V.on = true; V.muted = false;
    V.local = makeAnalyser(V.stream);
    V.meterTimer = setInterval(updateMeters, 80);
    renderVoice();
    send({ t: 'voice', on: true });          // server replies with who is already in voice
  }

  function leaveVoiceLocal() {
    clearInterval(V.meterTimer); V.meterTimer = 0;
    V.pcs.forEach((p) => closeVoicePeer(p));
    V.pcs.clear();
    closeAnalyser(V.local); V.local = null;
    if (V.stream) { V.stream.getTracks().forEach((t) => t.stop()); V.stream = null; }
    V.on = false; V.muted = false;
    renderVoice();
  }
  function leaveVoice() {
    if (!V.on) return;
    leaveVoiceLocal();
    send({ t: 'voice', on: false });
  }
  function toggleMute() {
    if (!V.on || !V.stream) return;
    V.muted = !V.muted;
    V.stream.getAudioTracks().forEach((t) => { t.enabled = !V.muted; });
    renderVoice();
    send({ t: 'mute', muted: V.muted });
  }

  function closeVoicePeer(p) {
    try { p.pc.close(); } catch {}
    closeAnalyser(p.an);
    if (p.audio) p.audio.remove();
  }
  function newVoicePeer(id) {
    const old = V.pcs.get(id); if (old) closeVoicePeer(old);
    const pc = new RTCPeerConnection(ICE);
    const p = { pc, q: [], audio: null, an: null };
    V.pcs.set(id, p);
    V.stream.getAudioTracks().forEach((t) => pc.addTrack(t, V.stream));
    pc.onicecandidate = (e) => e.candidate && send({ t: 'vrtc', to: id, data: { candidate: e.candidate } });
    pc.ontrack = (e) => {
      if (!p.audio) {
        p.audio = document.createElement('audio');
        p.audio.autoplay = true;
        $('#audioBox').append(p.audio);
      }
      p.audio.srcObject = e.streams[0];
      p.audio.play().catch(() => toast('Click anywhere on the page to hear voice chat.'));
      closeAnalyser(p.an); p.an = makeAnalyser(e.streams[0]);
    };
    return p;
  }
  async function offerVoice(id) {
    if (!V.on) return;
    const p = newVoicePeer(id);
    try {
      await p.pc.setLocalDescription(await p.pc.createOffer());
      send({ t: 'vrtc', to: id, data: { sdp: p.pc.localDescription } });
    } catch (e) { console.error(e); }
  }
  async function onVoiceRtc(from, data) {
    if (!V.on) return;
    try {
      if (data.sdp && data.sdp.type === 'offer') {
        const p = newVoicePeer(from);
        await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.q) await p.pc.addIceCandidate(c).catch(() => {});
        p.q = [];
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        send({ t: 'vrtc', to: from, data: { sdp: p.pc.localDescription } });
      } else if (data.sdp && data.sdp.type === 'answer') {
        const p = V.pcs.get(from); if (!p) return;
        await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.q) await p.pc.addIceCandidate(c).catch(() => {});
        p.q = [];
      } else if (data.candidate) {
        const p = V.pcs.get(from); if (!p) return;
        if (p.pc.remoteDescription) p.pc.addIceCandidate(data.candidate).catch(() => {}); else p.q.push(data.candidate);
      }
    } catch (e) { console.error(e); }
  }
  // drop connections to people who left voice or left the room
  function pruneVoicePeers() {
    V.pcs.forEach((p, id) => {
      const m = S.members.find((x) => x.id === id);
      if (!m || !m.voice) { closeVoicePeer(p); V.pcs.delete(id); }
    });
  }

  $('#btnVoice').onclick = joinVoice;
  $('#btnVoiceLeave').onclick = leaveVoice;
  $('#btnMic').onclick = toggleMute;
  renderVoice();

  // ---------- start ----------
  // If this tab was already in this room (page reload), rejoin without asking again.
  const pathCode = codeFromPath();
  let rec = null;
  try { rec = JSON.parse(store.get('wt-room') || 'null'); } catch {}
  if (pathCode && rec && rec.code === pathCode) {
    nameInput.value = rec.name || nameInput.value;
    enter(pathCode, { password: rec.password, create: rec.create });
  } else {
    setupLanding();
  }
  render();
})();
