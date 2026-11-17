'use strict';
const $ = (s) => document.querySelector(s);
let S = null;
let highlightPage = false;

const port = chrome.runtime.connect({ name: 'popup' });
port.onMessage.addListener((m) => { if (m.type === 'state') { S = m.s; render(); } });
const call = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));

const randomCode = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
};

// ---- join form ----
let filled = false;
function fillForm() {
  if (filled) return; filled = true;
  $('#server').value = S.server || '';
  $('#room').value = S.room || '';
  $('#name').value = S.name || '';
}
// pasting an invite link like https://host/room/ABC123 fills in both fields
$('#server').addEventListener('input', () => {
  const m = /\/room\/([A-Za-z0-9]{3,12})/.exec($('#server').value);
  if (m) {
    $('#room').value = m[1].toUpperCase();
    try { $('#server').value = new URL($('#server').value.trim()).origin; } catch (e) { /* keep as typed */ }
  }
});
$('#btnGen').onclick = () => { $('#room').value = randomCode(); };
async function join() {
  $('#joinErr').hidden = true;
  const r = await call({ type: 'join', server: $('#server').value, room: $('#room').value, name: $('#name').value });
  if (r.error) { $('#joinErr').textContent = r.error; $('#joinErr').hidden = false; }
}
$('#btnJoin').onclick = join;
for (const id of ['#server', '#room', '#name']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

// ---- room view ----
$('#btnLeave').onclick = () => call({ type: 'leave' });
$('#everyone').onchange = (e) => call({ type: 'everyone', value: e.target.checked });
$('#btnInvite').onclick = async () => {
  const link = `${S.server}/room/${S.room}`;
  try { await navigator.clipboard.writeText(link); $('#btnInvite').textContent = 'Copied!'; }
  catch (e) { prompt('Copy this invite link:', link); }
  setTimeout(() => { $('#btnInvite').textContent = 'Copy invite'; }, 1500);
};
$('#btnShare').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || '')) { $('#lastEvent').textContent = 'Open a normal web page first.'; return; }
  await call({ type: 'sharePage', url: tab.url });
};
$('#btnOpen').onclick = () => { if (S && S.pageUrl) { chrome.tabs.create({ url: S.pageUrl }); call({ type: 'pageSeen' }); } };

function render() {
  if (!S) return;
  $('#joinView').hidden = S.joined;
  $('#roomView').hidden = !S.joined;
  if (!S.joined) { fillForm(); return; }
  filled = false;

  $('#dot').classList.toggle('on', S.connected);
  $('#statusText').textContent = S.connected ? 'Connected' : 'Connecting…';
  $('#err').hidden = !S.error || S.connected;
  $('#err').textContent = S.error || '';
  $('#roomCode').textContent = S.room;

  const ul = $('#members'); ul.innerHTML = '';
  S.members.filter((m) => m.ext).forEach((m) => {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.textContent = m.name + (m.id === S.myId ? ' (you)' : '');
    li.append(n);
    if (m.id === S.hostId) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'host'; li.append(b); }
    ul.append(li);
  });

  const isHost = S.myId != null && S.myId === S.hostId;
  $('#everyoneWrap').hidden = !isHost;
  $('#everyone').checked = S.everyone;
  $('#ctlNote').hidden = isHost;
  $('#ctlNote').textContent = S.everyone ? 'Everyone can play, pause and seek.' : 'Only the host can play, pause and seek right now.';

  const v = $('#videoState');
  v.className = 'hint' + (S.videoFound ? ' ok' : '');
  v.textContent = S.videoFound ? '✓ Video detected and syncing'
    : 'No video found yet. Open the movie and press play in this browser.';

  if (S.pageNew) highlightPage = true;
  $('#pageRow').hidden = !S.pageUrl;
  $('#pageRow').classList.toggle('new', highlightPage);
  if (S.pageUrl) {
    let u; try { u = new URL(S.pageUrl); } catch (e) { u = null; }
    $('#pageBy').textContent = S.pageBy ? `${S.pageBy} is watching` : 'Current movie page';
    $('#pageUrl').textContent = u ? u.host + u.pathname : S.pageUrl;
    $('#pageUrl').title = S.pageUrl;
  }
  $('#lastEvent').textContent = S.lastEvent || '';
  if (S.pageNew) call({ type: 'pageSeen' });   // opening the popup counts as seeing it
}

call({ type: 'getState' }).then((r) => { if (r.s && !S) { S = r.s; render(); } });
