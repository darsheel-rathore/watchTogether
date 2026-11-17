# Watch Together

Watch movies with someone else: private rooms with a password, synced play/pause, voice chat with level meters, text chat.

Three ways to watch:

| Mode | What it is | Best for |
|---|---|---|
| **Chrome extension** (recommended) | Each of you plays the movie on the site yourself. The extension keeps play, pause and seek in sync. | vidbox or any streaming site, normal quality |
| **Screen share** | One person shares a browser tab with sound. | Quick start, nothing to install for the other person |
| **Direct link player** | Paste a `.mp4` / `.webm` / `.m3u8` link. | Files you have a direct link to |

## Rooms and passwords

- **Create a room** and the app makes a room code and a 6-digit password. Only the creator sees the password in the room header; send it to your partner (the **Copy link + password** button does that in one go).
- Opening an invite link shows whether the room exists and how many people are inside. You still need the password to enter.
- A room only exists while someone is in it. An old link to an ended room says so instead of creating a new open room.
- Wrong passwords are rate-limited on the server.

## 1. Host the server

### Option A: Render (permanent link, works without your PC)

1. Push this repo to GitHub (merge the branch you want deployed into the default branch, or pick the branch when connecting).
2. On [render.com](https://render.com): **New +** > **Blueprint** > select this repository. It reads `render.yaml` and creates a free web service.
   - Or **New +** > **Web Service**, runtime **Node**, build command `npm install`, start command `npm start`, health check path `/healthz`.
3. When the deploy finishes you get an address like `https://watch-together-xxxx.onrender.com`. That is your room server, and it is `https`, so screen sharing and the microphone work.

Free-tier notes: the service sleeps after about 15 minutes with no traffic, so the first visit after a break can take up to a minute to wake. Rooms live in memory, so a restart or redeploy ends all rooms.

### Option B: on your own PC

Double-click `start.bat`, or:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

- **Same Wi-Fi:** **Copy invite link** uses your LAN address. Allow Node in the Windows firewall prompt.
- **Different networks:** use a tunnel, then open the tunnel's https address yourself and create the room there:

  ```bash
  ngrok http 3000
  ```

> Screen sharing and the microphone need a secure page: use `http://localhost:3000` or an `https://` address, not a plain `http://192.168...` address.

## 2. Install the Chrome extension (both of you, once)

1. Get this folder onto the computer (clone the repo or download it as a ZIP and unzip it).
2. Open `chrome://extensions` in Chrome (or Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension` folder.
5. Pin the extension (puzzle icon, then the pin) so the button is always visible.

### Using it

1. Click the extension button.
   - **Joining:** paste the invite (the whole "link | Password: ..." text fills in the server, room code and password), enter your name, click **Join room**.
   - **Starting a room from the extension:** click **New** (it makes a code and password), enter the server address, click **Create room**.
2. Both of you open the same movie page on vidbox (for example `vidbox.wtf/movie/687163`).
   Tip: on the movie page click **Share this tab's page with the room**, and your partner clicks **Open**.
3. Press play on the movie. The popup shows **✓ Video detected and syncing**.
4. From then on, play, pause and seeking sync both ways.

The host can untick **Let everyone control playback** to lock it. If the extension was installed after a page was already open, reload that page.

### Also open the room page (optional)

Open the room in a normal tab as well. You get:

- **Voice chat**: green **Join voice**, a big **Mute / Unmute** button, and a level meter next to each person (green, yellow, red) so you can see who is talking. Use headphones so the movie doesn't echo into the mic.
- Text chat, a people list with the count, and a red **Leave room** button.
- **Remote buttons** (⏪ 10s, Play / Pause, 10s ⏩) that control everyone's player. Keyboard: Space, ← and →.
- **Mute my movie**: mutes the movie in your own browser only (needs the extension).

## Known limits

- Ads: if a site shows an ad in the same player, play/pause around the ad can get out of step. Skip the ad and it re-syncs within a few seconds.
- Both people need to start the same movie. The extension syncs position, it does not pick the movie for you (except the page-share button).
- If a browser blocks autoplay, you will see **Click to sync playback** over the video. One click fixes it.
- Voice and screen sharing connect directly between browsers (no relay server). On strict networks they may fail to connect; being on the same Wi-Fi always works.
- Passwords protect the room, but this is a small hobby app: there are no accounts, and rooms are not encrypted end to end.

## Files

- `server.js`: Express + WebSocket room server
- `public/`: the room web page
- `extension/`: the Chrome extension (Manifest V3)
- `render.yaml`: Render deploy blueprint
