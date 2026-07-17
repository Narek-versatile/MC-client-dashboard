/**
 * server.js — Headless service + web dashboard entry point.
 *
 * Runs the Mineflayer bot engine headlessly and serves a mobile-friendly web
 * dashboard over HTTP, with a WebSocket channel for live state + commands.
 *
 * Launch:  node server.js
 * Then open http://localhost:3000 in your phone's browser.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const AccountStore = require('./lib/accounts');
const BotManager = require('./lib/botManager');

const PORT = process.env.PORT || 3000;

const store = new AccountStore();
const manager = new BotManager(store);

const INDEX_FILE = path.join(__dirname, 'public', 'index.html');

// ---------------------------------------------------------------------------
// HTTP server — serves the single-page dashboard
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(INDEX_FILE, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Failed to load dashboard UI.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

// ---------------------------------------------------------------------------
// WebSocket server — live state + commands
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

// Relay engine events to every connected browser.
manager.on('state', (state) => broadcast({ type: 'state', ...state }));
manager.on('log', (entry) => broadcast({ type: 'log', ...entry }));
manager.on('chat', (entry) => broadcast({ type: 'chat', ...entry }));

wss.on('connection', (ws) => {
  // Push the current snapshot immediately on connect.
  send(ws, { type: 'state', ...manager.getState() });
  send(ws, { type: 'log', username: 'system', message: 'Dashboard connected.', level: 'success', time: Date.now() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    handleCommand(ws, msg);
  });
});

function handleCommand(ws, msg) {
  try {
    switch (msg.type) {
      case 'createAccount':
        store.add(msg.username, msg.password);
        manager.log(null, `Account "${String(msg.username).trim()}" created.`, 'success');
        if (msg.autoStart) manager.start(String(msg.username).trim());
        manager.emitState();
        break;

      case 'updatePassword':
        store.update(msg.username, msg.password);
        manager.log(null, `Password updated for "${msg.username}".`, 'success');
        manager.emitState();
        break;

      case 'deleteAccount':
        manager.stop(msg.username);
        store.remove(msg.username);
        manager.log(null, `Account "${msg.username}" deleted.`, 'warn');
        manager.emitState();
        break;

      case 'startBot':
        manager.start(msg.username);
        break;

      case 'stopBot':
        manager.stop(msg.username);
        break;

      case 'survivalTransit':
        manager.survivalTransit(msg.target);
        break;

      case 'sendCommand':
        manager.sendCommand(msg.target, msg.message);
        break;

      case 'updateServer':
        manager.updateConfig({
          host: msg.host,
          port: msg.port,
          version: msg.version,
          transitCommand: msg.transitCommand,
          guiClick: msg.guiClick,
          autoAcceptResourcePack: msg.autoAcceptResourcePack,
          debug: msg.debug,
        });
        manager.emitState();
        break;

      default:
        break;
    }
  } catch (err) {
    send(ws, {
      type: 'log',
      username: 'system',
      message: `Error: ${err.message}`,
      level: 'error',
      time: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Global safety nets — one failure must never crash the service.
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  console.error(`[contained] uncaughtException: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
  const m = reason instanceof Error ? reason.message : String(reason);
  console.error(`[contained] unhandledRejection: ${m}`);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Minecraft Bot Manager — headless service running');
  console.log('  ------------------------------------------------');
  console.log(`  Open the dashboard in your browser:  http://localhost:${PORT}`);
  console.log('');
});
