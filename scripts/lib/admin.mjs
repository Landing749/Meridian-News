// Shared by the maintenance scripts. These run on YOUR computer or in GitHub Actions, never in the browser, and they use a Firebase
// service account (full access). Never commit that key: put it in an environment variable or a GitHub Actions secret.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const { TABLES } = require('../../src/tables.js');
export const sync = require('../../src/publicsync.js');

export function readConfig() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), ctx);
  return ctx.window.MMG_CONFIG || {};
}
export function connect() {
  const cfg = readConfig(), raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  let credential;
  if (raw) credential = cert(JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')));
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) credential = applicationDefault();
  else throw new Error('No Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT (the service account JSON, or that JSON base64-encoded) or GOOGLE_APPLICATION_CREDENTIALS (path to the JSON file).');
  const databaseURL = process.env.FIREBASE_DATABASE_URL || (cfg.firebase && cfg.firebase.databaseURL);
  if (!databaseURL || /YOUR_/.test(databaseURL)) throw new Error('databaseURL is not set in config.js (or FIREBASE_DATABASE_URL).');
  const app = initializeApp({ credential, databaseURL });
  return { auth: getAuth(app), rtdb: getDatabase(app) };
}
// Reads the tables the public projection is built from, with the same defaults the browser data layer applies.
export async function loadTables(rtdb, tables = sync.SOURCE_TABLES) {
  const data = {};
  await Promise.all(tables.map(async t => { data[t] = (await rtdb.ref(t).once('value')).val() || {}; }));
  const all = t => Object.entries(data[t] || {}).map(([k, v]) => ({ ...(TABLES[t] ? TABLES[t].defaults : {}), ...v, id: TABLES[t] && TABLES[t].auto ? Number(k) : k }));
  return { all, raw: data };
}
export const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export async function nextId(rtdb, name) { return (await rtdb.ref('_counters/' + name).transaction(v => (v || 0) + 1)).snapshot.val(); }
