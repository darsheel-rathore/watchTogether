(() => {
  const $ = (s) => document.querySelector(s);
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

  const S = {
    ws: null, id: null, code: null, name: 'Guest', hostId: null, everyone: false,
    mode: 'none', sharer: null, members: [], src: null, pending: null,
    localStream: null, pcs: new Map(), viewerPc: null,
    hls: null, expect: { play: 0, pause: 0, seek: 0 }, lanIps: [], port: location.port, retry: 0,
  };
  const video = $('#video');

  // ---------- helpers ----------
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
  const memberName = (id) => (S.members.find((m) => m.id === id) || {}).name || 'Someone';

  // ---------- landing ----------
  const pathCode = ((location.pathname.match(/^\/room\/([A-Za-z0-9]{3,12})/) || [])[1] || '').toUpperCase();
  const nameInput = $('#name');
  try { nameInput.value = localStorage.getItem('wt-name') || ''; } catch {}

  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = ''; for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }
  function enter(code) {
    S.name = nameInput.value.trim() || 'Guest';
    try { localStorage.setItem('wt-name', S.name); } catch {}
    S.code = code;
    history.replaceState(null, '', '/room/' + code);
    $('#landing').hidden = true; $('#room').hidden = false;
    $('#roomCode').textContent = code;
    connect();
  }
  if (pathCode) {
    $('#createBlock').hidden = true; $('#btnJoinLink').hidden = false;
    $('#btnJoinLink').textContent = 'Join room ' + pathCode;
    $('#landingSub').textContent = "You've been invited to watch together.";
    $('#btnJoinLink').onclick = () => enter(pathCode);
  }
  $('#btnCreate').onclick = () => enter(randomCode());
  $('#btnJoin').onclick = () => {
    const c = $('#codeInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 3) return toast('Enter the room code');
    enter(c);
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (pathCode ? $('#btnJoinLink') : $('#btnCreate')).click(); });
  $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });

  fetch('/api/info').then((r) => r.json()).then((i) => { S.lanIps = i.ips || []; S.port = i.port; }).catch(() => {});

  $('#btnCopy').onclick = async () => {
    let origin = location.origin;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (local && S.lanIps.length) origin = `http://${S.lanIps[0]}:${location.port || S.port}`;
    const link = `${origin}/room/${S.code}`;
    try { await navigator.clipboard.writeText(link); toast('Copied: ' + link + (local ? '  (works on the same Wi-Fi; use a tunnel link for other networks)' : ''), 6000); }
    catch { prompt('Copy this link:', link); }
  };

  // ---------- websocket ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    S.ws = ws;
    ws.onopen = () => { S.retry = 0; $('#status').textContent = ''; ws.send(JSON.stringify({ t: 'join', room: S.code, name: S.name })); };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => {
      if (S.ws !== ws) return;
      cleanupRtc(); clearVideo();
      S.id = null; S.mode = 'none'; S.sharer = null; render();
      $('#status').textContent = 'Disconnected, reconnecting…';
      setTimeout(connect, Math.min(1000 * ++S.retry, 5000));
    };
  }

  function handle(m) {
    switch (m.t) {
      case 'welcome':
        S.id = m.id; S.hostId = m.hostId; S.everyone = m.everyone; S.members = m.members;
        S.mode = m.mode; S.sharer = m.sharer;
        $('#chat').innerHTML = ''; m.chat.forEach(addChat);
        renderMembers(); render();
        if (m.mode === 'video' && m.state.src) applyState(m.state, 0.7);
        break;
      case 'members':
        S.members = m.members; S.hostId = m.hostId; S.everyone = m.everyone;
        renderMembers(); render(); break;
      case 'chat': addChat(m); break;
      case 'mode': onMode(m.mode, m.sharer); break;
      case 'state':
        if (S.mode !== 'video') break;
        applyState(m, m.action === 'sync' ? 1.5 : 0.7);
        if (m.by && m.action !== 'sync') $('#who').textContent = labelFor(m);
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

  function onMode(mode, sharer) {
    const prev = S.mode;
    S.mode = mode; S.sharer = sharer;
    if (S.localStream && sharer !== S.id) stopLocalStream();
    if (prev === 'screen' && (mode !== 'screen' || sharer !== S.viewerPc?._from)) closeViewerPc();
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
    $('#idle').hidden = S.mode !== 'none' && !(S.mode === 'video' && !S.src);
    $('#sharingMe').hidden = !sharingMe;
    $('#waitStream').hidden = !(viewingScreen && !video.srcObject);
    $('#bar').hidden = !hasVideo;
    $('#loadForm').querySelectorAll('input,button').forEach((el) => (el.disabled = !canControl()));
    $('#urlInput').placeholder = canControl()
      ? 'Paste a direct video link (.mp4 / .webm / .m3u8)…'
      : 'Only the host can pick what plays (host can enable "Let everyone control")';
    const share = $('#btnShare');
    share.disabled = !canControl();
    share.textContent = sharingMe ? 'Stop sharing' : 'Share my screen / tab';
    $('#everyoneWrap').hidden = S.id !== S.hostId;
    $('#everyone').checked = S.everyone;
    if (!hasVideo) $('#tap').hidden = true;
  }

  function renderMembers() {
    const ul = $('#members'); ul.innerHTML = '';
    S.members.forEach((m) => {
      const li = document.createElement('li');
      const dot = document.createElement('span'); dot.className = 'dot';
      const nm = document.createElement('span'); nm.textContent = m.name + (m.id === S.id ? ' (you)' : '');
      li.append(dot, nm);
      if (m.id === S.hostId) { const b = document.createElement('span'); b.className = 'badge host'; b.textContent = 'host'; li.append(b); }
      else if (S.everyone) { const b = document.createElement('span'); b.className = 'badge ctl'; b.textContent = 'can control'; li.append(b); }
      ul.append(li);
    });
  }

  function addChat(m) {
    const box = $('#chat'); const d = document.createElement('div');
    if (m.system) { d.className = 'msg sys'; d.textContent = m.text; }
    else {
      d.className = 'msg' + (m.id === S.id ? ' me' : '');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = m.name;
      d.append(n, document.createTextNode(m.text));
    }
    box.append(d); box.scrollTop = box.scrollHeight;
  }
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

  // ---------- synced video ----------
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
    if (s.src !== S.src) {
      S.src = s.src; S.pending = s; setSource(s.src); render(); return;
    }
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
  // Mark a media event that WE are about to cause (so it is not echoed back to the room).
  function expect(kind) {
    S.expect[kind] = Date.now() + 2500;
  }
  function expected(kind) {
    if (S.expect[kind] && Date.now() < S.expect[kind]) { S.expect[kind] = 0; return true; }
    S.expect[kind] = 0; return false;
  }
  video.addEventListener('loadedmetadata', () => {
    $('#seek').max = video.duration || 0;
    if (S.pending) { const p = S.pending; S.pending = null; applyPos(p, 0.1); }
  });
  video.addEventListener('error', () => { if (S.src) toast('Could not play this link. It may not be a direct video file, or the site blocks embedding.', 7000); });

  const userEvt = (action) => {
    if (expected(action)) return;          // caused by a remote update, don't echo
    if (S.mode !== 'video' || !canControl()) return;
    send({ t: 'ctl', action, time: video.currentTime });
  };
  video.addEventListener('play', () => userEvt('play'));
  video.addEventListener('pause', () => userEvt('pause')); // also fires when the video ends
  video.addEventListener('seeked', () => userEvt('seek'));

  // custom control bar
  let dragging = false;
  video.addEventListener('timeupdate', () => {
    if (S.mode !== 'video') return;
    if (!dragging) $('#seek').value = video.currentTime;
    $('#time').textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
  });
  video.addEventListener('play', () => ($('#btnPlay').textContent = '❚❚'));
  video.addEventListener('pause', () => ($('#btnPlay').textContent = '▶'));
  $('#btnPlay').onclick = () => { if (!canControl()) return; video.paused ? video.play().catch(() => {}) : video.pause(); };
  $('#seek').addEventListener('input', () => { dragging = true; $('#time').textContent = `${fmt($('#seek').value)} / ${fmt(video.duration)}`; });
  $('#seek').addEventListener('change', () => { dragging = false; if (canControl()) video.currentTime = Number($('#seek').value); });
  $('#vol').oninput = () => { video.volume = Number($('#vol').value); video.muted = video.volume === 0; syncMute(); };
  $('#btnMute').onclick = () => { video.muted = !video.muted; syncMute(); };
  function syncMute() { $('#btnMute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊'; }
  $('#btnFs').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#player').requestFullscreen().catch(() => {});
  };
  $('#tap').onclick = () => { video.play().then(() => ($('#tap').hidden = true)).catch(() => {}); };
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space' && S.mode === 'video' && S.src) { e.preventDefault(); $('#btnPlay').click(); }
    if (e.key === 'f') $('#btnFs').click();
  });

  // drift correction
  setInterval(() => { if (S.mode === 'video' && S.src) send({ t: 'sync' }); }, 5000);

  // ---------- screen sharing (WebRTC) ----------
  $('#btnShare').onclick = () => (S.localStream ? stopShare() : startShare());
  $('#btnStopShare').onclick = stopShare;

  async function startShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return toast('Screen sharing needs a secure page: open this app via http://localhost:' + (location.port || S.port) + ' (or an https tunnel link).', 8000);
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

  render();
})();
