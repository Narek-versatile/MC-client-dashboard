# Minecraft Bot Manager

A lightweight **headless** Minecraft bot service with a **mobile-friendly web
dashboard**, built to run on an Android phone via [Termux](https://termux.dev/)
and [Mineflayer](https://github.com/PrismarineJS/mineflayer).

The bot engine runs as a background Node.js service; you control everything from
a web UI in your phone's browser — account management, live status, and
survival transit — no terminal juggling required.

## Quick Start

```bash
# 1. Clone the repository
git clone <your-repo-url> MC-client-dashboard
cd MC-client-dashboard

# 2. Run the one-shot setup script (installs Node.js + dependencies)
bash setup.sh

# 3. Launch the headless service
node server.js

# 4. Open the dashboard in your phone browser
#    http://localhost:3000
```

## Features

### Account Management (persistent)
- **Create accounts** with a username + password from the dashboard.
- Each account is saved to `accounts.json` in the project root, so it survives
  restarts. (This file holds passwords and is git-ignored.)
- Start / stop / delete any bot individually; passwords can be updated.

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

### Command Injection (broadcast or single bot)
- A **Send Command / Chat** panel lets you send any command or chat line to a
  specific bot or to **All Bots** at once.
- Sent verbatim: include the leading `/` for a command (e.g. `/tp Steve`), or
  omit it to speak in chat. Each send is echoed in the activity log per bot.

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
