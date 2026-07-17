/**
 * lib/accounts.js — Persistent per-account credential store.
 *
 * Accounts are saved to accounts.json in the project root so they survive
 * restarts. Each account is { username, password }.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'accounts.json');

class AccountStore {
  constructor(file = DEFAULT_FILE) {
    this.file = file;
    this.accounts = new Map(); // username -> { username, password }
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const arr = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (Array.isArray(arr)) {
          for (const a of arr) {
            if (a && a.username) {
              this.accounts.set(a.username, {
                username: a.username,
                password: a.password || '',
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`[accounts] Failed to load ${this.file}: ${err.message}`);
    }
  }

  save() {
    try {
      const arr = [...this.accounts.values()];
      fs.writeFileSync(this.file, JSON.stringify(arr, null, 2));
    } catch (err) {
      console.error(`[accounts] Failed to save ${this.file}: ${err.message}`);
    }
  }

  add(username, password) {
    username = String(username || '').trim();
    if (!username) throw new Error('Username is required');
    if (this.accounts.has(username)) throw new Error(`Account "${username}" already exists`);
    const account = { username, password: String(password || '') };
    this.accounts.set(username, account);
    this.save();
    return account;
  }

  update(username, password) {
    const account = this.accounts.get(username);
    if (!account) throw new Error(`Account "${username}" not found`);
    account.password = String(password || '');
    this.save();
    return account;
  }

  remove(username) {
    const existed = this.accounts.delete(username);
    if (existed) this.save();
    return existed;
  }

  get(username) {
    return this.accounts.get(username);
  }

  list() {
    return [...this.accounts.values()];
  }

  // Full export including passwords (for backup / transfer).
  exportList() {
    return this.list().map((a) => ({ username: a.username, password: a.password || '' }));
  }

  // Merge an imported array of { username, password }. When overwrite is true,
  // existing accounts have their password replaced; otherwise they're skipped.
  importList(arr, overwrite = false) {
    const result = { added: 0, updated: 0, skipped: 0 };
    if (!Array.isArray(arr)) throw new Error('Import data must be a JSON array of accounts');
    for (const a of arr) {
      const username = a && a.username != null ? String(a.username).trim() : '';
      if (!username) { result.skipped++; continue; }
      const password = a.password != null ? String(a.password) : '';
      if (this.accounts.has(username)) {
        if (overwrite) { this.accounts.get(username).password = password; result.updated++; }
        else { result.skipped++; }
      } else {
        this.accounts.set(username, { username, password });
        result.added++;
      }
    }
    this.save();
    return result;
  }
}

module.exports = AccountStore;
