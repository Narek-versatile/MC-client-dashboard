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
- Sends `/server`, waits for the chest GUI (`windowOpen`), then clicks
  **Row 2, Column 3** — slot index `11` — via `bot.clickWindow(11, 0, 0)`.
- Checks whether slot 11 is an `iron_pickaxe` (clicks by position regardless)
  and logs a success message once the click registers.

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
