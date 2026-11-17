# Watch Together

Watch movies with someone else: shared rooms, synced play/pause, voice chat, text chat.

Three ways to watch:

| Mode | What it is | Best for |
|---|---|---|
| **Chrome extension** (recommended) | Each of you plays the movie on the site yourself. The extension keeps play, pause and seek in sync. | vidbox or any streaming site, normal quality |
| **Screen share** | One person shares a browser tab with sound. | Quick start, nothing to install for the other person |
| **Direct link player** | Paste a `.mp4` / `.webm` / `.m3u8` link. | Files you have a direct link to |

## 1. Run the server (the host does this)

Double-click `start.bat`, or:

```bash
npm install
npm start
```

Open `http://localhost:3000`, enter a name, click **Create a room**.

### Let your partner connect

- **Same Wi-Fi:** use **Copy invite link** (it uses your LAN address). Allow Node in the Windows firewall prompt.
- **Different networks:** use a tunnel, then open the tunnel's https address yourself and create the room there:

  ```bash
  ngrok http 3000
  ```

  (`cloudflared tunnel --url http://localhost:3000` also works.)

> Screen sharing and the microphone need a secure page: use `http://localhost:3000` or an `https://` tunnel link, not a plain `http://192.168...` address.

## 2. Install the Chrome extension (both of you, once)

1. Get this folder onto the computer (clone the repo or download it as a ZIP and unzip it).
2. Open `chrome://extensions` in Chrome (or Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension` folder.
5. Pin the extension (puzzle icon, then the pin) so the button is always visible.

### Using it

1. Click the extension button. Paste the **invite link** (or the server address and a room code), enter your name, click **Join room**.
2. Both of you open the same movie page on vidbox (for example `vidbox.wtf/movie/687163`).
   Tip: on the movie page click **Share this tab's page with the room**, and your partner clicks **Open**.
3. Press play on the movie. The popup shows **✓ Video detected and syncing**.
4. From then on, play, pause and seeking sync both ways.

The host can untick **Let everyone control playback** to lock it.

If the extension was installed after a page was already open, reload that page.

### Also open the room page (optional)

Open the invite link in a normal tab as well. You get:

- **Voice chat** with mute / unmute (use headphones so the movie doesn't echo into the mic)
- Text chat and a people list
- Remote buttons: **⏪ 10s, Play, Pause, 10s ⏩** that control everyone's player
- **Mute my movie**: mutes the movie in your own browser only

## Known limits

- Ads: if a site shows an ad in the same player, play/pause around the ad can get out of step. Skip the ad and it re-syncs within a few seconds.
- Both people need to start the same movie. The extension syncs position, it does not pick the movie for you (except the page-share button).
- If a browser blocks autoplay, you will see **Click to sync playback** over the video. One click fixes it.
- Voice and screen sharing connect directly between browsers. On strict networks they may fail to connect; being on the same Wi-Fi always works.
- Control rules for the extension are enforced by the server, but there is no login. Anyone who has the room code can join, so don't share it publicly.

## Files

- `server.js`: Express + WebSocket room server
- `public/`: the room web page
- `extension/`: the Chrome extension (Manifest V3)
