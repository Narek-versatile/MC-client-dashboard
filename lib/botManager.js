/**
 * lib/botManager.js — Headless multi-bot engine.
 *
 * Manages a pool of offline-mode Mineflayer bots, one per account. Emits two
 * kinds of events for any UI to consume:
 *   - 'state' : full dashboard snapshot (accounts + their live status)
 *   - 'log'   : a single log line { username, message, level, time }
 *
 * Handles smart/conditional authentication with register redundancy,
 * user-triggered survival transit (chest-GUI navigation), and graceful
 * per-bot error/reconnect handling.
 */

'use strict';

const EventEmitter = require('events');
const mineflayer = require('mineflayer');

const DEFAULTS = {
  host: 'localhost',
  port: 25565,
  version: false,            // false = auto-detect protocol version
  authWindowMs: 5000,        // wait this long for a login/register prompt
  reconnectDelayMs: 5000,    // cooldown before auto-reconnect
  survivalSlot: 10,          // Fallback only, used if iron_pickaxe isn't found by name
  transitCommand: '/server', // command that opens the server-selector GUI
  guiClick: true,            // click the chest GUI after the command (off = direct command only)
  transitTimeoutMs: 5000,    // warn if the GUI never opens after the command
  transitSettleMs: 2500,     // how long to wait for the GUI slots to populate
  registerRedundancyMs: 1500,// delay before the post-register /login fallback
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BotManager extends EventEmitter {
  constructor(accountStore, config = {}) {
    super();
    this.accounts = accountStore;
    this.config = { ...DEFAULTS, ...config };
    this.bots = new Map(); // username -> record
  }

  // -------------------------------------------------------------------------
  // Event helpers
  // -------------------------------------------------------------------------
  log(username, message, level = 'info') {
    this.emit('log', {
      username: username || 'system',
      message,
      level,
      time: Date.now(),
    });
  }

  emitState() {
    this.emit('state', this.getState());
  }

  getState() {
    const accounts = this.accounts.list().map((a) => {
      const rec = this.bots.get(a.username);
      return {
        username: a.username,
        hasPassword: !!a.password,
        running: !!rec && !rec.manualStop,
        status: rec ? rec.status : 'stopped',
        location: rec ? rec.location : '-',
        auth: rec ? rec.auth : '-',
      };
    });
    return {
      accounts,
      config: {
        host: this.config.host,
        port: this.config.port,
        transitCommand: this.config.transitCommand,
        guiClick: this.config.guiClick,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Server / transit configuration
  // -------------------------------------------------------------------------
  updateConfig(patch = {}) {
    if (patch.host) this.config.host = String(patch.host).trim();
    if (patch.port) this.config.port = Number(patch.port) || this.config.port;
    if (typeof patch.transitCommand === 'string' && patch.transitCommand.trim()) {
      this.config.transitCommand = patch.transitCommand.trim();
    }
    if (typeof patch.guiClick === 'boolean') this.config.guiClick = patch.guiClick;

    this.log(null, `Config updated — server ${this.config.host}:${this.config.port}, transit "${this.config.transitCommand}" (GUI-click ${this.config.guiClick ? 'on' : 'off'}). Existing bots reconnect on next disconnect.`);
  }

  // -------------------------------------------------------------------------
  // Bot lifecycle
  // -------------------------------------------------------------------------
  start(username) {
    const account = this.accounts.get(username);
    if (!account) throw new Error(`Account "${username}" not found`);
    this._createBot(account);
  }

  _createBot(account) {
    const { username } = account;

    let record = this.bots.get(username);
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
        transitTimer: null,
        registerSent: false,
        loginSent: false,
        awaitingTransit: false,
      };
      this.bots.set(username, record);
    } else {
      record.status = 'connecting';
      record.manualStop = false;
      record.registerSent = false;
      record.loginSent = false;
    }

    let bot;
    try {
      bot = mineflayer.createBot({
        host: this.config.host,
        port: this.config.port,
        username,
        version: this.config.version,
        auth: 'offline', // always offline mode
      });
    } catch (err) {
      record.status = 'error';
      this.log(username, `Failed to create bot: ${err.message}`, 'error');
      this.emitState();
      this._scheduleReconnect(record, account);
      return;
    }

    record.instance = bot;
    this._attachHandlers(record, account, bot);
    this.emitState();
  }

  _attachHandlers(record, account, bot) {
    const { username } = record;
    const password = account.password || '';

    // --- Spawn ------------------------------------------------------------
    bot.on('spawn', () => {
      record.status = 'online';
      record.location = 'Lobby';
      record.auth = 'pending';
      this.log(username, 'Spawned into the world (Lobby).', 'success');
      this.emitState();

      // Smart auth window: if nothing asks us to login/register, assume we're
      // already authenticated and bypass.
      clearTimeout(record.authTimer);
      record.authTimer = setTimeout(() => {
        if (record.auth === 'pending') {
          record.auth = 'Bypassed/Already Auth';
          this.log(username, 'No auth prompt detected — bypassing login.', 'warn');
          this.emitState();
        }
      }, this.config.authWindowMs);
    });

    // --- Messages: conditional auth with register redundancy --------------
    bot.on('message', (jsonMsg) => {
      let text = '';
      try {
        text = jsonMsg.toString();
      } catch (_) {
        return;
      }
      if (text) this._handleAuthMessage(record, password, text);
    });

    // --- Survival transit: chest-GUI navigation ---------------------------
    bot.on('windowOpen', (window) => {
      if (!record.awaitingTransit) return; // only act on user-triggered transit
      record.awaitingTransit = false;
      clearTimeout(record.transitTimer);   // the GUI opened; cancel the "no GUI" warning
      this._performTransitClick(record, bot, window).catch((err) => {
        this.log(username, `Survival transit click failed: ${err.message}`, 'error');
      });
    });

    // --- Kicked / disconnect ----------------------------------------------
    bot.on('kicked', (reason) => {
      record.status = 'kicked';
      let r = '';
      try { r = typeof reason === 'string' ? reason : JSON.stringify(reason); } catch (_) {}
      this.log(username, `Kicked: ${r}`, 'error');
      this.emitState();
    });

    bot.on('end', (reason) => {
      record.status = 'offline';
      record.location = 'Lobby';
      clearTimeout(record.authTimer);
      clearTimeout(record.transitTimer);
      record.awaitingTransit = false;
      this.log(username, `Disconnected${reason ? ` (${reason})` : ''}.`, 'warn');
      this.emitState();
      this._scheduleReconnect(record, account);
    });

    // --- Errors: contained per-bot ----------------------------------------
    bot.on('error', (err) => {
      record.status = 'error';
      this.log(username, `Error: ${err.message}`, 'error');
      this.emitState();
    });
  }

  /**
   * Conditional authentication.
   *
   *   - Server asks to REGISTER  -> /register <pw> <pw>, then a redundancy
   *                                 /login <pw> shortly after.
   *   - Server asks to LOGIN     -> /login <pw>.
   *   - If a /login attempt is answered with "not registered", the same
   *     handler catches the follow-up 'register' keyword and registers.
   */
  _handleAuthMessage(record, password, text) {
    const lower = text.toLowerCase();
    const wantsRegister = lower.includes('register');
    const wantsLogin = lower.includes('login');
    if (!wantsRegister && !wantsLogin) return;

    const bot = record.instance;
    if (!bot) return;

    // Prefer registration when the server explicitly asks for it (and we
    // haven't registered yet). This also covers the "not registered, please
    // register" reply to a failed /login.
    if (wantsRegister && !record.registerSent && password) {
      record.registerSent = true;
      clearTimeout(record.authTimer);
      this.log(record.username, `Auth prompt: "${text.trim()}" → registering.`, 'info');
      bot.chat(`/register ${password} ${password}`);
      record.auth = 'registering';
      this.emitState();

      // Redundancy: some servers require a separate /login after /register.
      setTimeout(() => {
        if (record.instance === bot && !record.loginSent) {
          record.loginSent = true;
          try { bot.chat(`/login ${password}`); } catch (_) {}
          record.auth = 'authenticated';
          this.log(record.username, 'Redundancy /login after register.', 'info');
          this.emitState();
        }
      }, this.config.registerRedundancyMs);
      return;
    }

    if (wantsLogin && !record.loginSent && password) {
      record.loginSent = true;
      clearTimeout(record.authTimer);
      this.log(record.username, `Auth prompt: "${text.trim()}" → logging in.`, 'info');
      bot.chat(`/login ${password}`);
      record.auth = 'authenticated';
      this.emitState();
    }
  }

  _scheduleReconnect(record, account) {
    if (record.manualStop) return;      // user asked us to stop
    if (record.reconnectTimer) return;  // already queued

    const secs = this.config.reconnectDelayMs / 1000;
    this.log(record.username, `Reconnecting in ${secs}s...`, 'info');
    record.reconnectTimer = setTimeout(() => {
      record.reconnectTimer = null;
      if (!record.manualStop) this._createBot(account);
    }, this.config.reconnectDelayMs);
  }

  stop(username) {
    const record = this.bots.get(username);
    if (!record) return;
    record.manualStop = true;
    clearTimeout(record.reconnectTimer);
    clearTimeout(record.authTimer);
    clearTimeout(record.transitTimer);
    record.awaitingTransit = false;
    record.reconnectTimer = null;
    try {
      if (record.instance) record.instance.quit();
    } catch (_) { /* ignore */ }
    record.status = 'stopped';
    this.bots.delete(username);
    this.log(username, 'Bot stopped.', 'warn');
    this.emitState();
  }

  // -------------------------------------------------------------------------
  // Survival transit trigger
  // -------------------------------------------------------------------------
  survivalTransit(target) {
    const targets = this._resolveTargets(target);
    if (targets.length === 0) {
      this.log(null, 'No online bots available for survival transit.', 'warn');
      return;
    }

    for (const record of targets) {
      try {
        this.log(record.username, `Sending "${this.config.transitCommand}" for survival transit...`, 'info');
        record.instance.chat(this.config.transitCommand);

        if (!this.config.guiClick) {
          // Direct-command mode: assume the command itself transitions us.
          record.location = 'Survival';
          this.log(record.username, 'GUI-click disabled — assuming direct command transition.', 'info');
          this.emitState();
          continue;
        }

        // GUI mode: wait for the chest to open. If it never does, warn so the
        // user knows the server may use a direct command instead.
        record.awaitingTransit = true;
        clearTimeout(record.transitTimer);
        record.transitTimer = setTimeout(() => {
          if (record.awaitingTransit) {
            record.awaitingTransit = false;
            this.log(record.username, `No GUI opened ${this.config.transitTimeoutMs / 1000}s after "${this.config.transitCommand}". The server may use a direct command — try setting the transit command to e.g. "/server survival" and disabling GUI-click.`, 'warn');
          }
        }, this.config.transitTimeoutMs);
      } catch (err) {
        record.awaitingTransit = false;
        this.log(record.username, `Failed to send transit command: ${err.message}`, 'error');
      }
    }
  }

  /**
   * Click the survival item inside an open chest GUI.
   *
   * Waits for the container slots to actually populate (they arrive in a
   * packet slightly after windowOpen; clicking too early makes the server
   * reject the transaction and kick with "internal error"), then clicks the
   * real iron_pickaxe slot and awaits the click so transaction rejections are
   * surfaced instead of crashing.
   */
  async _performTransitClick(record, bot, window) {
    const { username } = record;

    // Poll until the pickaxe appears (or the settle window elapses).
    const deadline = Date.now() + this.config.transitSettleMs;
    let slot = this._findPickaxeSlot(window);
    while (slot === -1 && Date.now() < deadline) {
      await sleep(150);
      if (record.instance !== bot) return; // bot was replaced/stopped
      slot = this._findPickaxeSlot(window);
    }

    // Log what the GUI actually contains — invaluable for diagnosing layouts.
    const contents = this._describeContainer(window);
    this.log(username, `GUI "${window.title || 'container'}" contents: ${contents || '(empty)'}`, 'info');

    if (slot === -1) {
      slot = this.config.survivalSlot;
      this.log(username, `No iron_pickaxe found in GUI — falling back to configured slot ${slot}.`, 'warn');
    } else {
      this.log(username, `Found iron_pickaxe at slot ${slot} — clicking it.`, 'info');
    }

    // Small extra settle so the server has the window fully registered.
    await sleep(200);
    if (record.instance !== bot) return;

    await bot.clickWindow(slot, 0, 0); // left-click, normal mode; awaited
    record.location = 'Survival';
    this.log(username, `✔ Survival transit click registered on slot ${slot}!`, 'success');
    this.emitState();
  }

  _containerEnd(window) {
    if (typeof window.inventoryStart === 'number') return window.inventoryStart;
    return window.slots ? window.slots.length : 0;
  }

  _findPickaxeSlot(window) {
    const end = this._containerEnd(window);
    for (let i = 0; i < end; i++) {
      const it = window.slots[i];
      if (it && it.name === 'iron_pickaxe') return i;
    }
    return -1;
  }

  _describeContainer(window) {
    const end = this._containerEnd(window);
    const parts = [];
    for (let i = 0; i < end; i++) {
      const it = window.slots[i];
      if (it && it.name) parts.push(`${i}:${it.name}`);
    }
    return parts.join(', ');
  }

  // -------------------------------------------------------------------------
  // Command injection — broadcast or target a single bot
  // -------------------------------------------------------------------------
  sendCommand(target, message) {
    const text = String(message || '').trim();
    if (!text) return;

    const targets = this._resolveTargets(target);
    if (targets.length === 0) {
      this.log(null, 'No online bots available to send the command.', 'warn');
      return;
    }

    for (const record of targets) {
      try {
        record.instance.chat(text);
        this.log(record.username, `» ${text}`, 'info');
      } catch (err) {
        this.log(record.username, `Failed to send "${text}": ${err.message}`, 'error');
      }
    }
  }

  _resolveTargets(target) {
    const online = [...this.bots.values()].filter(
      (r) => r.status === 'online' && r.instance
    );
    if (target === '__all__' || target == null) return online;
    const rec = this.bots.get(target);
    return rec && rec.status === 'online' && rec.instance ? [rec] : [];
  }
}

module.exports = BotManager;
