# Minecraft Bot Manager

A lightweight **headless** Minecraft bot service with a **mobile-friendly web
dashboard**, built to run on an Android phone via [Termux](https://termux.dev/)
and [Mineflayer](https://github.com/PrismarineJS/mineflayer).

The bot engine runs as a background Node.js service; you control everything from
a web UI in your phone's browser — account management, live status, and
survival transit — no terminal juggling required.

## Quick Start

### Android (Termux)

```bash
# 1. Clone the repository
git clone <your-repo-url> MC-client-dashboard
cd MC-client-dashboard

# 2. Run the one-shot setup script (installs Node.js + dependencies)
bash setup.sh

# 3. Launch the headless service
node server.js       # or: bash refresh.sh  (pull latest + relaunch)

# 4. Open the dashboard in your phone browser
#    http://localhost:3000
```

### Windows

1. Install **Node.js LTS** from <https://nodejs.org/en/download> (once).
2. Double-click **`setup.bat`** (installs dependencies).
3. Double-click **`run.bat`** to start the service (or `refresh.bat` to pull
   latest + relaunch).
4. Open <http://localhost:3000> in your browser.

The service is plain Node.js, so it runs identically on Android, Windows,
macOS, and Linux — only the launcher scripts differ.

## Features

### Account Management (persistent)
- **Create accounts** with a username + password from the dashboard.
- Each account is saved to `accounts.json` in the project root, so it survives
  restarts. (This file holds passwords and is git-ignored.)
- Start / stop / delete any bot individually; passwords can be updated.
- **Import / Export (JSON):** back up or transfer your whole account list.
  *Export JSON* downloads `accounts.json` (includes passwords — keep it
  private); *Import* accepts a file or pasted JSON and merges by username
  (existing accounts are skipped unless **Overwrite** is ticked).

### Smart / Conditional Authentication with Register Redundancy
Bots connect in **offline mode**. Based on server chat (case-insensitive):
- Server asks to **login** → sends `/login <password>`.
- Server asks to **register** → sends `/register <password> <password>`, then a
  redundancy `/login <password>` shortly after (for servers that require a
  separate login step).
- A failed `/login` that gets a *"not registered"* reply is caught by the same
  handler and triggers registration automatically.
- If **no** auth prompt appears within 5 seconds of spawning, the bot is marked
  **Bypassed/Already Authenticated** and no command is sent.

### Interactive Survival Transit (chest-GUI navigation)
- User-triggered per bot, or **Survival Transit · All** for every online bot.
- Sends the configurable **transit command** (default `/server`), then when the
  chest GUI opens it **waits for the slots to actually populate** before acting
  — clicking too early makes servers reject the transaction and kick with
  "internal error". Once populated it **searches for an item named
  `iron_pickaxe`** and clicks that exact slot via `bot.clickWindow(slot, 0, 0)`
  (awaited, so transaction rejections are logged instead of crashing).
- It **logs the full GUI contents** (`slot:item, …`) so you can see exactly
  what the bot sees. If no `iron_pickaxe` is found it falls back to
  `survivalSlot` (default `10`).
- If the GUI never opens within ~5s, it warns that your server may use a direct
  command instead.
- **Direct-command mode:** if your server transfers you with a plain command
  (e.g. `/server survival`), set that as the transit command in the
  *Server & Transit* panel and **uncheck "Click chest GUI after command"**.
  The bot then just runs the command with no GUI clicking.

### Commands (broadcast or single bot) — commands only
- The **Commands** tab sends commands to a specific bot or to **All Bots**.
- **Commands only, by design:** input is always issued as a command — a leading
  `/` is added automatically and can't be removed, so the bots can **never**
  post to global chat.
- **Built-in commands** dropdown with common presets (`tpa`, `tpahere`,
  `tpaccept`, `home`, `sethome`, `warp`, `spawn`, `pay`, `msg`, …) that render
  argument fields and a live `/command …` preview before you Run it.
- **Custom command** box for anything not in the list.
- **Show output:** tick this on either command panel to capture the server's
  chat replies for ~3s after the command and print them in a **Command Output**
  box (tagged with the bot and the command). Minecraft has no command/response
  correlation, so this is a best-effort time window, not an exact match.

### Wave TPA
- **Wave TPA** makes every online bot send `/tpa <yourName>` in **batches** —
  *wave size* bots at a time (default `5`), *interval* seconds apart
  (default `10`) — so the pending-request count never exceeds what the server
  lets you hold. Accept a batch, and the next wave fires on schedule.
- **Cancel** stops any remaining waves. Bots that dropped offline mid-run are
  skipped. Progress is logged in the **Log** tab.

### Global Chat (read-only)
- The **Chat** tab shows live server chat as seen by your bots. Messages seen by
  multiple bots at once are de-duplicated into a single line, tagged with which
  bot observed it. It is read-only — there is no way to send chat.

### Tabbed UI
- The dashboard is organized into **Dashboard**, **Commands**, **Chat**, and
  **Log** tabs so everything stays usable on a phone screen.

### Server transfers, resource packs & version
Some networks (e.g. **JartexNetwork**) move you to survival by transferring you
to a different backend server when you click the menu item. Two things can make
that transfer fail with *"An internal error occurred in your connection"*:
- **Resource pack** — the survival server may require accepting a server
  resource pack; if it goes unanswered you get kicked. **Auto-accept resource
  packs** (on by default, toggle in *Server & Transit*) answers it.
- **Protocol version** — the modern (1.20.2+) configuration-phase transfer is
  handled poorly by the bot library. The project therefore **defaults to
  `1.18.2`**, which sidesteps it and is confirmed working on Jartex. You can
  change **MC version** in *Server & Transit* (blank = auto-detect); restart the
  bot after changing it.

### Diagnostics / Detailed Logging
- **Verbose debug logging** (toggle in the *Server & Transit* panel) surfaces
  the events and raw clientbound packets that reveal a **proxy transfer** —
  `respawn`, `game_state_change`, `login`, `open_window`, `kick_disconnect` —
  which is the usual reason survival transit "silently fails" on network
  servers (clicking the item moves you to a different backend server).
- Disconnects/errors/kicks that occur shortly after a transit click are
  annotated with how many ms after the click they happened, so a transfer is
  distinguishable from a real failure. The bot's `Survival` location is
  preserved across the transfer instead of being reset to `Lobby`.
- Every log line is also written to **`logs/bot-manager.log`** on the device
  (`cat logs/bot-manager.log`), and the dashboard has **Copy All** / **Clear**
  buttons for the live log so you can grab a full trace to share.

### Graceful Error & Reconnect Handling
- Kicked/disconnected bots auto-reconnect after a 5-second cooldown.
- Per-bot errors are contained, plus process-level safety nets, so one bot
  failing never takes down the service or the dashboard.

## Architecture

```
server.js            HTTP + WebSocket server; serves the dashboard, relays
                     engine events, and dispatches UI commands.
lib/botManager.js    Headless multi-bot engine (EventEmitter): auth, transit,
                     reconnect. Emits 'state' and 'log'.
lib/accounts.js      Persistent per-account credential store (accounts.json).
public/index.html    Self-contained mobile web dashboard (HTML/CSS/JS).
```

The browser talks to the service over a WebSocket: the service pushes `state`
(account list + live status) and `log` messages; the browser sends commands
(`createAccount`, `startBot`, `survivalTransit`, …).

## Configuration

- **Server host/port** — set from the dashboard's *Server* panel, or via the
  defaults in `lib/botManager.js` (`DEFAULTS`).
- **Dashboard port** — defaults to `3000`; override with `PORT=8080 node server.js`.
- **Auth timing, reconnect delay, survival slot** — all in `DEFAULTS` in
  `lib/botManager.js`.

## Requirements

- Termux (Android) — or any machine with Node.js.
- Node.js (installed automatically by `setup.sh`).
- `mineflayer@4.37.1`, `ws` (installed automatically by `setup.sh`).

> **Note on the Mineflayer version:** there is no `mineflayer@26.1.2` on npm —
> Mineflayer's current line is `4.x` (latest `4.37.1`, which supports modern
> Minecraft versions). This project pins `4.37.1`. If you specifically need a
> different Minecraft protocol version, set `version` in `lib/botManager.js`.

## Native APK (later)

Because Mineflayer is a Node.js library, the "app" is a headless Node service +
web UI. To ship a real installable APK later, wrap this dashboard URL in a thin
WebView shell, or embed Node via [`nodejs-mobile`](https://github.com/nodejs-mobile/nodejs-mobile).
The engine (`lib/`) is UI-agnostic and reusable as-is.
