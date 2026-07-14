# Termux Minecraft Bot Manager

A lightweight, terminal-based dashboard for running and managing multiple
offline-mode Minecraft bots from a single Android phone using
[Termux](https://termux.dev/) and [Mineflayer](https://github.com/PrismarineJS/mineflayer).

Clone → run setup → launch. No manual configuration required.

## Quick Start

```bash
# 1. Clone the repository
git clone <your-repo-url> MC-client-dashboard
cd MC-client-dashboard

# 2. Run the one-shot setup script (installs Node.js + dependencies)
bash setup.sh

# 3. Launch the dashboard
node index.js
```

## Features

- **Multi-Bot Management** — add bots by username; each runs as its own
  isolated Mineflayer instance in the background. A live status table shows
  each bot's connection state, location (Lobby vs. Survival), and auth status.
- **Smart / Conditional Authentication** — bots connect in offline mode. If the
  server chat contains `login` or `register` (case-insensitive), the bot
  automatically runs `/login <password>`. If nothing is detected within 5
  seconds, the bot is marked *Bypassed/Already Authenticated*.
- **Interactive Survival Transit** — user-triggered. Pick a bot (or *All Bots*),
  which sends `/server` and, when the chest GUI opens, clicks **Row 3, Column 2**
  (slot index `19`) to move into the survival world.
- **Graceful Error & Reconnect Handling** — kicked/disconnected bots
  auto-reconnect after a 5-second cooldown, and per-bot errors are contained so
  one crash can't take down the dashboard.

## Configuration

Sensible defaults live at the top of `index.js` (`CONFIG`). You can also change
the server host, port, and auto-login password at runtime via the
**Configure Server** menu option.

| Setting            | Default       | Description                                  |
| ------------------ | ------------- | -------------------------------------------- |
| `host`             | `localhost`   | Target server address                        |
| `port`             | `25565`       | Target server port                           |
| `password`         | `password123` | Password used for the auto `/login` command  |
| `authWindowMs`     | `5000`        | Auth-prompt detection window                 |
| `reconnectDelayMs` | `5000`        | Reconnect cooldown                           |
| `survivalSlot`     | `19`          | Chest slot clicked during survival transit   |

## Requirements

- Termux (Android)
- Node.js (installed automatically by `setup.sh`)
- `mineflayer@26.1.2`, `prompts` (installed automatically by `setup.sh`)
