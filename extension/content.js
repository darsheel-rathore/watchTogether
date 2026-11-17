// Watch Together Sync - content script. Runs in every frame; only acts in a frame
// that contains a visible <video> (this is how it reaches players embedded in
// cross-origin iframes, like the ones vidbox uses).
(() => {
  'use strict';
  if (window.__wtSync) return;
  window.__wtSync = true;

  let port = null;        // connection to the service worker
  let video = null;       // the <video> we watch
  let active = false;     // service worker says: you are the video to sync
  let canCtl = false;     // may we send play/pause/seek to the room?
  let last = null;        // last known room state {playing,pos,at}
  let pending = null;     // state to apply once the video has metadata
  let lastArea = 0;
  let cmdUntil = 0;       // while a room-page command is being applied, our own events are not "user" events
  const expect = { play: 0, pause: 0, seek: 0 };
  const now = () => performance.now();

  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };

  // ---- events we caused ourselves must not be echoed back to the room ----
  const markExpected = (k) => { expect[k] = Date.now() + 2500; };
  const wasExpected = (k) => {
    const hit = expect[k] && Date.now() < expect[k];
    expect[k] = 0;
    return !!hit;
  };

  // ---------- small on-page HUD (toast + "click to sync" button) ----------
  let hud = null, toastTimer = 0;
  function ensureHud() {
    if (hud && hud.host.isConnected) return hud;
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .toast{position:absolute;top:14px;right:14px;max-width:280px;background:rgba(20,22,32,.92);color:#fff;
          font:13px/1.35 system-ui,sans-serif;padding:8px 12px;border-radius:10px;border:1px solid #3a4358;
          box-shadow:0 4px 18px rgba(0,0,0,.4)}
        .tap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;
          font:600 16px system-ui,sans-serif;color:#fff;background:#7c5cff;border:0;border-radius:10px;padding:14px 22px;
          box-shadow:0 6px 24px rgba(0,0,0,.5)}
        [hidden]{display:none}
      </style>
      <div class="toast" hidden></div>
      <button class="tap" hidden>▶ Click to sync playback</button>`;
    hud = { host, toast: root.querySelector('.toast'), tap: root.querySelector('.tap') };
    hud.tap.addEventListener('click', () => {
      if (!video) return;
      markExpected('play');
      video.play().then(hideTap).catch(() => {});
    });
    placeHud();
    return hud;
  }
  function placeHud() {
    if (!hud) return;
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (hud.host.parentNode !== parent) parent.appendChild(hud.host);
  }
  document.addEventListener('fullscreenchange', placeHud);
  function toast(text) {
    const h = ensureHud();
    h.toast.textContent = text; h.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { h.toast.hidden = true; }, 3500);
  }
  function showTap() { ensureHud().tap.hidden = false; }
  function hideTap() { if (hud) hud.tap.hidden = true; }

  // ---------- applying the room's state to our player ----------
  function applyState(s, tol) {
    if (!video) return;
    if (video.readyState === 0) {              // not loaded yet: wait for metadata
      pending = s;
      if (s.playing) toast('Press play on the movie to join in');
      return;
    }
    const target = s.pos + (s.playing ? (now() - s.at) / 1000 : 0);
    if (Math.abs(video.currentTime - target) > tol) {
      markExpected('seek');
      try { video.currentTime = target; } catch (e) { /* not seekable yet */ }
    }
    if (s.playing && video.paused) {
      markExpected('play');
      video.play().then(hideTap).catch(() => { expect.play = 0; showTap(); }); // autoplay blocked
    } else if (!s.playing && !video.paused) {
      markExpected('pause');
      video.pause();
    }
  }

  function onMsg(m) {
    if (m.type === 'config') {
      active = !!m.active; canCtl = !!m.canControl;
      if (!active) hideTap();
    } else if (m.type === 'localMute') {
      if (video) video.muted = !!m.muted;       // local only: "mute my movie" from the room page
    } else if (m.type === 'remote') {
      // Play / Pause / ±10s pressed on the room web page (also how a viewer controls a screen share)
      if (!active || !video) return;
      cmdUntil = Date.now() + 1500;
      toast(m.action === 'play' ? `${m.by} pressed play`
        : m.action === 'pause' ? `${m.by} paused`
        : `${m.by} skipped ${m.delta > 0 ? '+' : ''}${m.delta}s`);
      if (m.action === 'play') video.play().then(hideTap).catch(showTap);
      else if (m.action === 'pause') video.pause();
      else if (m.action === 'skip') {
        const end = Number.isFinite(video.duration) ? video.duration - 0.5 : Infinity;
        try { video.currentTime = Math.max(0, Math.min(end, video.currentTime + (Number(m.delta) || 0))); } catch (e) { /* not seekable */ }
      }
      // tell the room where the movie really is now (once, after it settles)
      setTimeout(reportOwn, 500);
    } else if (m.type === 'state') {
      if (!active || !video) return;
      if (m.known === false) {
        // The room has never heard a real position (fresh room, or a screen share just started).
        // Don't jump the movie to 0:00. Instead, teach the room where this player is.
        if (m.action === 'welcome') reportOwn();
        return;
      }
      const s = { playing: m.playing, pos: m.pos, at: now() };
      last = s;
      if (m.action !== 'sync' && m.by) {
        toast(m.action === 'play' ? `${m.by} pressed play`
          : m.action === 'pause' ? `${m.by} paused at ${fmt(m.pos)}`
          : `${m.by} jumped to ${fmt(m.pos)}`);
      }
      applyState(s, m.action === 'sync' ? 1.5 : 0.7);
    }
  }

  // ---------- what the person did on their own player ----------
  // Send this player's real position/state to the room (only if we're allowed to control).
  function reportOwn() {
    if (!active || !port || !video || !canCtl || video.readyState === 0) return;
    const action = video.paused ? 'pause' : 'play';
    try { port.postMessage({ type: 'ctl', action, time: video.currentTime }); } catch (e) { /* ignore */ }
    last = { playing: !video.paused, pos: video.currentTime, at: now() };
  }

  function userEvt(action) {
    if (wasExpected(action)) return;
    if (Date.now() < cmdUntil) return;   // caused by a room-page command; reportOwn() covers it
    if (!active || !port || !video) return;
    if (!canCtl) {
      toast("You don't have control right now");
      if (last) setTimeout(() => applyState(last, 0.5), 60);   // put the player back
      return;
    }
    try { port.postMessage({ type: 'ctl', action, time: video.currentTime }); } catch (e) { /* worker restarting */ }
    last = { playing: action === 'play' ? true : action === 'pause' ? false : !video.paused, pos: video.currentTime, at: now() };
  }
  const onPlay = () => userEvt('play');
  const onPause = () => userEvt('pause');         // also fires when the movie ends
  const onSeeked = () => userEvt('seek');
  const onMeta = () => { if (pending) { const p = pending; pending = null; applyState(p, 0.5); } };

  function attach(v) {
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onMeta);
  }
  function detach() {
    if (!video) return;
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('loadedmetadata', onMeta);
    pending = null; hideTap();
  }

  // ---------- finding the movie ----------
  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  }
  function pickVideo() {
    let best = null, ba = 0;
    for (const v of document.querySelectorAll('video')) {
      const a = visibleArea(v);
      if (a > ba) { ba = a; best = v; }
    }
    return ba >= 120 * 80 ? best : null;       // ignore tiny/hidden videos
  }

  function ensurePort() {
    if (port) return port;
    try { port = chrome.runtime.connect({ name: 'video' }); } catch (e) { port = null; return null; }
    port.onMessage.addListener(onMsg);
    port.onDisconnect.addListener(() => { port = null; active = false; lastArea = 0; hideTap(); });
    return port;
  }

  let timer = 0;
  function scan() {
    if (!(chrome.runtime && chrome.runtime.id)) { clearInterval(timer); clearInterval(syncTimer); return; } // extension reloaded
    const v = pickVideo();
    if (v !== video) { detach(); video = v; if (v) attach(v); }
    if (!video) {
      if (port) { try { port.disconnect(); } catch (e) { /* ignore */ } port = null; active = false; lastArea = 0; }
      return;
    }
    const p = ensurePort();
    if (!p) return;
    const a = Math.round(visibleArea(video));
    if (!lastArea || Math.abs(a - lastArea) / lastArea > 0.1) {
      lastArea = a;
      try { p.postMessage({ type: 'info', area: a }); } catch (e) { /* ignore */ }
    }
  }
  // ---- bridge for the Watch Together room page (top frame of /room/CODE only) ----
  // lets the page's "Mute my movie" button reach the video in this browser
  if (window.top === window && /^\/room\/[A-Za-z0-9]+/.test(location.pathname)) {
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.wt !== 'page') return;
      const reply = (o) => window.postMessage({ wt: 'ext', ...o }, location.origin);
      if (e.data.type === 'ping') reply({ type: 'pong' });
      else if (e.data.type === 'mute') {
        const muted = !!e.data.muted;
        try {
          chrome.runtime.sendMessage({ type: 'localMute', muted }, (r) => {
            void chrome.runtime.lastError;
            reply({ type: 'muteResult', ok: !!(r && r.ok), muted });
          });
        } catch (err) { reply({ type: 'muteResult', ok: false, muted }); }
      }
    });
  }

  timer = setInterval(scan, 1500);
  // periodic drift check against the room (also keeps the service worker awake)
  const syncTimer = setInterval(() => {
    if (active && port) { try { port.postMessage({ type: 'sync' }); } catch (e) { /* ignore */ } }
  }, 5000);
  scan();
})();
