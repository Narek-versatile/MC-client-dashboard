/**
 * index.js — Terminal-based Minecraft Bot Manager for Termux
 *
 * A lightweight, interactive dashboard that manages multiple offline-mode
 * Mineflayer bots from a single terminal. Built to run comfortably on mobile
 * hardware inside Termux.
 *
 * Features:
 *   - Multi-bot management (each bot is an isolated Mineflayer instance).
 *   - Smart/conditional authentication (auto /login on chat prompt).
 *   - User-triggered "Survival Transit" via chest-GUI navigation.
 *   - Graceful error handling and automatic reconnect.
 *
 * Dependencies: mineflayer (26.1.2), prompts
 */

'use strict';

const mineflayer = require('mineflayer');
const prompts = require('prompts');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
// These defaults make the app runnable with zero manual editing. The server
// address can be changed at runtime from the "Configure Server" menu option.
const CONFIG = {
  host: 'localhost',      // Target server address
  port: 25565,            // Target server port
  version: false,         // false = auto-detect the server's protocol version
  password: 'password123',// Password used for the auto /login command
  authWindowMs: 5000,     // How long to wait for a login/register chat prompt
  reconnectDelayMs: 5000, // Cooldown before auto-reconnect
  survivalSlot: 19,       // Row 3, Column 2 in a standard 9-wide chest grid
  survivalCommand: '/server',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
// username -> {
//   username, instance, status, location, auth, manualStop, reconnectTimer
// }
const bots = new Map();

// Small ANSI helpers (kept minimal so it stays fast/readable on mobile).
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(username, message, color) {
  const tag = username ? `[${username}]` : '[system]';
  const paint = color || c.dim;
  console.log(`${paint}${tag}${c.reset} ${message}`);
}

// ---------------------------------------------------------------------------
// Bot lifecycle
// ---------------------------------------------------------------------------
function createBot(username) {
  // Reuse an existing record on reconnect so status/history is preserved.
  let record = bots.get(username);
  if (!record) {
    record = {
      username,
      instance: null,
      status: 'connecting',
      location: 'Lobby',
      auth: 'pending',
      manualStop: false,
      reconnectTimer: null,
      authTimer: null,
    };
    bots.set(username, record);
  } else {
    record.status = 'connecting';
    record.manualStop = false;
  }

  let bot;
  try {
    bot = mineflayer.createBot({
      host: CONFIG.host,
      port: CONFIG.port,
      username,
      version: CONFIG.version,
      auth: 'offline', // Always connect in offline mode.
    });
  } catch (err) {
    // Creation itself failed (e.g. bad host). Isolate the failure.
    record.status = 'error';
    log(username, `Failed to create bot: ${err.message}`, c.red);
    scheduleReconnect(record);
    return;
  }

  record.instance = bot;
  attachHandlers(record, bot);
}

function attachHandlers(record, bot) {
  const { username } = record;

  // --- Spawn: bot is in the world -----------------------------------------
  bot.on('spawn', () => {
    record.status = 'online';
    record.location = 'Lobby';
    log(username, 'Spawned into the world (Lobby).', c.green);

    // Smart authentication: give the server a short window to ask us to
    // login/register. If it never does, we assume we're already authed.
    record.auth = 'pending';
    clearTimeout(record.authTimer);
    record.authTimer = setTimeout(() => {
      if (record.auth === 'pending') {
        record.auth = 'Bypassed/Already Authenticated';
        log(username, 'No auth prompt detected — bypassing login.', c.yellow);
      }
    }, CONFIG.authWindowMs);
  });

  // --- Chat/messages: conditional auth ------------------------------------
  bot.on('message', (jsonMsg) => {
    let text = '';
    try {
      text = jsonMsg.toString();
    } catch (_) {
      return;
    }
    if (!text) return;

    const lower = text.toLowerCase();
    if (record.auth === 'pending' && (lower.includes('login') || lower.includes('register'))) {
      record.auth = 'authenticating';
      clearTimeout(record.authTimer);
      log(username, `Auth prompt detected: "${text.trim()}"`, c.cyan);
      // Fire the login command. Registration-required servers usually accept
      // the same password via /login once /register has been issued, but the
      // most common offline auth flow is a straight /login.
      bot.chat(`/login ${CONFIG.password}`);
      record.auth = 'authenticated';
      log(username, 'Sent /login command.', c.green);
    }
  });

  // --- Survival transit: chest-GUI navigation -----------------------------
  bot.on('windowOpen', (window) => {
    // Only act if we're expecting a transit menu.
    if (!record.awaitingTransit) return;
    record.awaitingTransit = false;

    const slot = CONFIG.survivalSlot;
    try {
      const item = window.slots && window.slots[slot];
      const itemName = item ? item.name : 'unknown';

      if (itemName === 'iron_pickaxe') {
        log(username, `Slot ${slot} holds an iron_pickaxe — clicking it.`, c.cyan);
      } else {
        log(username, `Slot ${slot} holds "${itemName}" — clicking by position anyway.`, c.yellow);
      }

      // Left-click (mouseButton 0), normal mode (0).
      bot.clickWindow(slot, 0, 0);
      record.location = 'Survival';
      log(username, `✔ Survival transit click registered on slot ${slot}!`, c.green);
    } catch (err) {
      log(username, `Failed during survival transit click: ${err.message}`, c.red);
    }
  });

  // --- Disconnect / kick: reconnect handling ------------------------------
  bot.on('kicked', (reason) => {
    record.status = 'kicked';
    let r = '';
    try { r = typeof reason === 'string' ? reason : JSON.stringify(reason); } catch (_) {}
    log(username, `Kicked: ${r}`, c.red);
  });

  bot.on('end', (reason) => {
    record.status = 'offline';
    record.location = 'Lobby';
    log(username, `Disconnected${reason ? ` (${reason})` : ''}.`, c.yellow);
    clearTimeout(record.authTimer);
    scheduleReconnect(record);
  });

  // --- Errors: never let one bot take down the dashboard ------------------
  bot.on('error', (err) => {
    record.status = 'error';
    log(username, `Error: ${err.message}`, c.red);
    // 'end' typically follows an error and will handle reconnect, but guard
    // in case it does not.
  });
}

function scheduleReconnect(record) {
  if (record.manualStop) return;              // User asked us to stop.
  if (record.reconnectTimer) return;          // Reconnect already queued.

  log(record.username, `Reconnecting in ${CONFIG.reconnectDelayMs / 1000}s...`, c.dim);
  record.reconnectTimer = setTimeout(() => {
    record.reconnectTimer = null;
    if (!record.manualStop) createBot(record.username);
  }, CONFIG.reconnectDelayMs);
}

function stopBot(record) {
  record.manualStop = true;
  clearTimeout(record.reconnectTimer);
  clearTimeout(record.authTimer);
  record.reconnectTimer = null;
  try {
    if (record.instance) record.instance.quit();
  } catch (_) { /* ignore */ }
  record.status = 'offline';
}

// ---------------------------------------------------------------------------
// Dashboard rendering
// ---------------------------------------------------------------------------
function statusColor(status) {
  switch (status) {
    case 'online': return c.green;
    case 'connecting': return c.cyan;
    case 'offline': return c.dim;
    default: return c.red; // kicked / error
  }
}

function pad(str, len) {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function renderDashboard() {
  console.log('');
  console.log(`${c.bold}${c.cyan}=== Minecraft Bot Dashboard ===${c.reset}`);
  console.log(`${c.dim}Server: ${CONFIG.host}:${CONFIG.port}${c.reset}`);
  console.log('');

  if (bots.size === 0) {
    console.log(`${c.dim}No bots yet. Choose "Add a Bot" to begin.${c.reset}`);
    console.log('');
    return;
  }

  const header =
    pad('USERNAME', 16) + pad('STATUS', 13) + pad('LOCATION', 12) + 'AUTH';
  console.log(`${c.bold}${header}${c.reset}`);
  console.log(`${c.dim}${'-'.repeat(header.length + 8)}${c.reset}`);

  for (const record of bots.values()) {
    const sc = statusColor(record.status);
    const line =
      pad(record.username, 16) +
      sc + pad(record.status, 13) + c.reset +
      pad(record.location, 12) +
      record.auth;
    console.log(line);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------
async function addBot() {
  const { username } = await prompts({
    type: 'text',
    name: 'username',
    message: 'Enter a username for the new bot:',
    validate: (v) => (v && v.trim().length > 0 ? true : 'Username cannot be empty'),
  });

  if (!username) return; // Cancelled.
  const name = username.trim();

  if (bots.has(name)) {
    log(null, `A bot named "${name}" already exists.`, c.yellow);
    return;
  }

  log(null, `Launching bot "${name}"...`, c.cyan);
  createBot(name);
}

async function triggerSurvivalTransit() {
  const online = [...bots.values()].filter((r) => r.status === 'online');
  if (online.length === 0) {
    log(null, 'No online bots available for survival transit.', c.yellow);
    return;
  }

  const choices = [
    { title: 'All Bots', value: '__all__' },
    ...online.map((r) => ({ title: r.username, value: r.username })),
  ];

  const { target } = await prompts({
    type: 'select',
    name: 'target',
    message: 'Select a bot to trigger Survival Transit:',
    choices,
  });

  if (!target) return; // Cancelled.

  const targets = target === '__all__' ? online : [bots.get(target)];
  for (const record of targets) {
    if (!record || record.status !== 'online' || !record.instance) continue;
    try {
      record.awaitingTransit = true;
      log(record.username, `Sending "${CONFIG.survivalCommand}" for survival transit...`, c.cyan);
      record.instance.chat(CONFIG.survivalCommand);
    } catch (err) {
      record.awaitingTransit = false;
      log(record.username, `Failed to send transit command: ${err.message}`, c.red);
    }
  }
}

async function removeBot() {
  if (bots.size === 0) {
    log(null, 'No bots to remove.', c.yellow);
    return;
  }
  const { target } = await prompts({
    type: 'select',
    name: 'target',
    message: 'Select a bot to stop & remove:',
    choices: [...bots.values()].map((r) => ({ title: r.username, value: r.username })),
  });
  if (!target) return;

  const record = bots.get(target);
  if (record) {
    stopBot(record);
    bots.delete(target);
    log(null, `Removed bot "${target}".`, c.yellow);
  }
}

async function configureServer() {
  const response = await prompts([
    {
      type: 'text',
      name: 'host',
      message: `Server host [${CONFIG.host}]:`,
      initial: CONFIG.host,
    },
    {
      type: 'number',
      name: 'port',
      message: `Server port [${CONFIG.port}]:`,
      initial: CONFIG.port,
    },
    {
      type: 'text',
      name: 'password',
      message: 'Auto-login password:',
      initial: CONFIG.password,
    },
  ]);

  if (response.host) CONFIG.host = response.host.trim();
  if (response.port) CONFIG.port = response.port;
  if (response.password) CONFIG.password = response.password;
  log(null, `Server set to ${CONFIG.host}:${CONFIG.port}.`, c.green);
  log(null, 'Note: existing bots keep their current connection until reconnect.', c.dim);
}

// ---------------------------------------------------------------------------
// Main menu loop
// ---------------------------------------------------------------------------
async function mainLoop() {
  // Keep looping until the user explicitly exits.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    renderDashboard();

    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Choose an action:',
      choices: [
        { title: 'Refresh Dashboard', value: 'refresh' },
        { title: 'Add a Bot', value: 'add' },
        { title: 'Trigger Survival Transit', value: 'transit' },
        { title: 'Remove a Bot', value: 'remove' },
        { title: 'Configure Server', value: 'config' },
        { title: 'Exit', value: 'exit' },
      ],
    });

    switch (action) {
      case 'add':
        await addBot();
        break;
      case 'transit':
        await triggerSurvivalTransit();
        break;
      case 'remove':
        await removeBot();
        break;
      case 'config':
        await configureServer();
        break;
      case 'exit':
      case undefined: // Ctrl+C on the menu.
        await shutdown();
        return;
      case 'refresh':
      default:
        break;
    }
  }
}

async function shutdown() {
  log(null, 'Shutting down all bots...', c.yellow);
  for (const record of bots.values()) {
    stopBot(record);
  }
  // Give sockets a brief moment to close cleanly.
  await new Promise((r) => setTimeout(r, 500));
  log(null, 'Goodbye!', c.green);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Global safety nets — one failure must never crash the whole dashboard.
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  log(null, `Uncaught exception (contained): ${err.message}`, c.red);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log(null, `Unhandled rejection (contained): ${msg}`, c.red);
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
(async () => {
  console.clear();
  console.log(`${c.bold}${c.cyan}Termux Minecraft Bot Manager${c.reset}`);
  console.log(`${c.dim}Lightweight multi-bot dashboard powered by Mineflayer.${c.reset}`);
  await mainLoop();
})();
