// Writes real HTML files for the public pages into dist/ so search engines and link previews (Facebook, X, LinkedIn...) see the
// content, and visitors see it before the app has loaded. The app then takes over and shows live data.
//
// It reads /public from the Realtime Database over its public REST address (no credentials needed: that data is world-readable by design),
// runs the same page code as the browser inside jsdom, and saves the result. If anything fails the site still works as a normal app.
//   node scripts/prerender.mjs                       (after `npm run build`)
//   node scripts/prerender.mjs --data public.json    (offline: a saved copy of /public)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { bundle, boot } from '../tests/harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const BASE = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), ctx);
const cfg = ctx.window.MMG_CONFIG || {};
const SITE_URL = String(cfg.siteUrl || process.env.SITE_URL || '').replace(/\/+$/, ''); // config.js wins, so a custom domain is used when you set one
let pub;
if (arg('--data')) pub = JSON.parse(fs.readFileSync(arg('--data'), 'utf8'));
else {
  const dbUrl = String((cfg.firebase && cfg.firebase.databaseURL) || '').replace(/\/+$/, '');
  if (!dbUrl || /YOUR_/.test(dbUrl)) { console.log('prerender: databaseURL is not set in config.js, skipping.'); process.exit(0); }
  const res = await fetch(`${dbUrl}/public.json`);
  if (!res.ok) { console.log(`prerender: could not read /public (${res.status}), skipping. Is database.rules.json published?`); process.exit(0); }
  pub = await res.json();
}
if (!pub || !pub.articles) { console.log('prerender: /public is empty (sign in to the CMS as a publisher once, or run npm run reconcile). Skipping.'); process.exit(0); }

const code = await bundle();
const s = await boot(code, { public: pub }, { url: `https://prerender.invalid${BASE}/`, base: BASE, siteUrl: SITE_URL, config: { sessionHours: 12 } });
const dispatch = p => s.w.__mmg.dispatch({ method: 'GET', url: BASE + p, headers: { 'user-agent': 'prerender' } });

const withBase = html => (!BASE ? html : html.replace(/(\s(?:href|src|action|formaction|poster)=")\/(?!\/)/g, `$1${BASE}/`).replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${BASE}/`));
const csp = fs.readFileSync(path.join(root, 'index.template.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
const boots = `<script src="${BASE}/assets/boot.js"></script><script src="${BASE}/config.js"></script><script src="${BASE}/assets/app.js"></script>`;
const finish = html => withBase(html)
  .replace(/<script src="[^"]*\/js\/[^"]*"><\/script>/g, '') // page scripts are part of app.js
  .replace(/<head>/, `<head>${csp}`)
  .replace(/<\/body>/, `${boots}</body>`);
const write = (rel, content) => { const f = path.join(dist, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };

// Which pages exist: the sitemap the site already generates.
const sm = await dispatch('/sitemap.xml');
const locs = [...String(sm.body).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => { try { return new URL(m[1]).pathname; } catch { return null; } }).filter(Boolean)
  .map(p => (BASE && p.startsWith(BASE + '/') ? p.slice(BASE.length) : p));
const pages = [...new Set(['/', ...locs])];
let ok = 0, failed = 0;
for (const p of pages) {
  try {
    const r = await dispatch(p);
    if (r.status !== 200 || typeof r.body !== 'string' || !r.body.includes('<html')) { failed++; continue; }
    write(p === '/' ? 'index.html' : path.join(p, 'index.html'), finish(r.body)); ok++;
  } catch (e) { failed++; console.warn('prerender failed for', p, e.message); }
}
if (sm.status === 200) write('sitemap.xml', String(sm.body));
const rb = await dispatch('/robots.txt'); if (rb.status === 200) write('robots.txt', String(rb.body));
console.log(`prerender: ${ok} page${ok === 1 ? '' : 's'} written${failed ? `, ${failed} skipped` : ''}${SITE_URL ? '' : ' (set SITE_URL so sitemap and social links use your real address)'}.`);
process.exit(0);
