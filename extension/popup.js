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
let creating = false;       // true after "New": the first join creates the room
function fillForm() {
  if (filled) return; filled = true;
  $('#server').value = S.server || '';
  $('#room').value = S.room || '';
  $('#pw').value = S.password || '';
  $('#name').value = S.name || '';
  setCreating(!!S.create);
}
function setCreating(v) {
  creating = v;
  $('#btnJoin').textContent = creating ? 'Create room' : 'Join room';
  $('#joinHint').innerHTML = creating
    ? 'New room: the code and password are made for you. After creating, click <b>Copy invite</b> and send it to your partner.'
    : 'Paste the invite your partner sent (link and password), then join. To start a new room, click <b>New</b>.';
}
const randomPassword = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
// Pasting an invite (link, or "link | Password: 123456") fills in server, room code and password.
$('#server').addEventListener('input', () => {
  const text = $('#server').value;
  const room = /\/room\/([A-Za-z0-9]{3,12})(?![A-Za-z0-9])/.exec(text);
  const pw = /password\s*[:=]?\s*([^\s|)]{4,64})/i.exec(text);
  const origin = /https?:\/\/[^\s/|)]+/i.exec(text);
  if (room) { $('#room').value = room[1].toUpperCase(); setCreating(false); }
  if (pw) $('#pw').value = pw[1];
  if (room && origin) $('#server').value = origin[0];
});
$('#room').addEventListener('input', () => { if (creating) setCreating(false); });
$('#btnGen').onclick = () => { $('#room').value = randomCode(); $('#pw').value = randomPassword(); setCreating(true); };
async function join() {
  $('#joinErr').hidden = true;
  const r = await call({ type: 'join', server: $('#server').value, room: $('#room').value, password: $('#pw').value,
    name: $('#name').value, create: creating });
  if (r.error) { $('#joinErr').textContent = r.error; $('#joinErr').hidden = false; }
}
$('#btnJoin').onclick = join;
for (const id of ['#server', '#room', '#pw', '#name']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

// ---- room view ----
$('#btnLeave').onclick = () => call({ type: 'leave' });
$('#everyone').onchange = (e) => call({ type: 'everyone', value: e.target.checked });
$('#btnInvite').onclick = async () => {
  // single line on purpose: it survives being pasted into a one-line input
  const invite = `Watch Together room: ${S.server}/room/${S.room} | Password: ${S.password}`;
  try { await navigator.clipboard.writeText(invite); $('#btnInvite').textContent = 'Copied!'; }
  catch (e) { prompt('Copy this invite:', invite); }
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
  if (!S.joined) {
    fillForm();
    if (S.joinError) { $('#joinErr').textContent = S.joinError; $('#joinErr').hidden = false; }
    return;
  }
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
