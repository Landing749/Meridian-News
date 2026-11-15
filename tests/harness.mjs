// Runs the real browser bundle inside jsdom, against the in-memory Firebase fake.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);
const require = createRequire(import.meta.url);

export async function bundle() {
  let gen = 'module.exports = {\n';
  for (const f of fs.readdirSync(at('public/js')).filter(f => f.endsWith('.js'))) gen += `${JSON.stringify(f.replace(/\.js$/, ''))}: function () {\n${fs.readFileSync(at('public/js', f), 'utf8')}\n},\n`;
  fs.writeFileSync(at('src/browser/page-scripts.generated.js'), gen + '};\n');
  const fake = { name: 'fake-firebase', setup(b) { b.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: at('tests/fake-firebase.js') })); } };
  const r = await esbuild.build({
    entryPoints: [at('src/browser/entry.js')], bundle: true, write: false, format: 'iife', platform: 'browser', target: ['es2020'], plugins: [fake],
    alias: { express: at('src/browser/express.js'), multer: at('src/browser/multer.js'), path: at('src/browser/path.js') },
    inject: [at('src/browser/buffer-shim.js')], define: { 'process.env.NODE_ENV': '"test"', 'process.env.SITE_URL': '""', global: 'globalThis' }, logLevel: 'error',
  });
  return r.outputFiles[0].text;
}

// Builds the public projection for seed data (what a publisher's first sign-in would write).
export async function withPublicCopy(seed) {
  const { createRtdb } = require('./fake-rtdb.js'), sync = require('../src/publicsync.js');
  const rtdb = createRtdb(seed);
  const t = rtdb.dump() || {};
  const { TABLES } = require('../src/tables.js');
  const all = table => Object.entries(t[table] || {}).map(([k, v]) => ({ ...(TABLES[table] ? TABLES[table].defaults : {}), ...v, id: TABLES[table] && TABLES[table].auto ? Number(k) : k }));
  await sync.reconcile(rtdb, { all });
  return rtdb.dump();
}

export async function boot(code, seed, { url = 'https://site.test/', fetchStub, base = '', siteUrl = 'https://site.test', config = {} } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented: (window\.scrollTo|HTMLFormElement\.prototype\.requestSubmit)/.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.map(x => (x && x.stack) || x).join(' ')));
  vc.on('warn', () => {});
  const dom = new JSDOM('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="mmg-boot">Loading</div></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.MMG_CONFIG = { firebase: { apiKey: 'test-key' }, cloudinary: { cloudName: 'demo', uploadPreset: 'preset', folder: 'mmg' }, siteUrl, sessionHours: 12, ...config };
  w.MMG_BASE = base;
  w.__SEED = seed;
  w.scrollTo = () => {};
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, set(v) { this.textContent = v; }, configurable: true }); // jsdom has no layout, so no innerText
  w.Response = Response;
  w.fetch = fetchStub || (async u => { throw new Error('unexpected network call: ' + u); });
  w.eval(code);
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + fn.toString().slice(0, 120) + '\n' + errors.join('\n')); await new Promise(r => setTimeout(r, 15)); } };
  await waitFor(() => w.__mmgReady);
  const settle = async () => { await new Promise(r => setTimeout(r, 25)); await waitFor(() => w.document.documentElement.style.cursor !== 'progress'); await new Promise(r => setTimeout(r, 25)); };
  const go = async u => { await w.__mmg.go(u); await settle(); };
  return { dom, w, errors, waitFor, settle, go, text: () => w.document.body.textContent.replace(/\s+/g, ' ').trim(), html: () => w.document.documentElement.outerHTML, path: () => w.location.pathname + w.location.search, fake: () => w.__fake };
}
