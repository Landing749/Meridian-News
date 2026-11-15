// The Node scripts and the browser must agree on what /public contains, and the prerender must produce usable pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { seed } from './seed.mjs';
import { withPublicCopy } from './harness.mjs';
const require = createRequire(import.meta.url);
const { createRtdb } = require('./fake-rtdb.js');
const { TABLES } = require('../src/tables.js'), sync = require('../src/publicsync.js');

// 1. Same projection whether built in the browser (db.js mirror) or in Node (loadTables with the shared defaults)
const viaBrowserPath = (await withPublicCopy(seed())).public;
const rtdb = createRtdb(seed());
const data = {}; for (const t of sync.SOURCE_TABLES) data[t] = (await rtdb.ref(t).once('value')).val() || {};
const all = t => Object.entries(data[t]).map(([k, v]) => ({ ...(TABLES[t] ? TABLES[t].defaults : {}), ...v, id: TABLES[t] && TABLES[t].auto ? Number(k) : k }));
const n = await sync.reconcile(rtdb, { all });
const viaScript = rtdb.dump().public;
assert.ok(n > 0);
for (const t of ['articles', 'bodies', 'categories', 'authors', 'tags', 'media', 'article_tags']) assert.equal(JSON.stringify(viaScript[t]), JSON.stringify(viaBrowserPath[t]), 'projection differs for ' + t);
assert.equal(await sync.reconcile(rtdb, { all }), 0, 'a second run has nothing to write');
assert.equal(viaScript.articles[2], undefined, 'drafts are never projected');

// 2. A scheduled article that is due is not published by project(); only published ones appear
const d = JSON.parse(JSON.stringify(seed())); d.articles[2].status = 'scheduled';
const proj = sync.project({ all: t => Object.entries(d[t] || {}).map(([k, v]) => ({ ...(TABLES[t] ? TABLES[t].defaults : {}), ...v, id: k })) });
assert.deepEqual(Object.keys(proj.tables.articles), ['1']);

// 3. Prerender
const tmp = path.join(path.dirname(new URL(import.meta.url).pathname), '.tmp'); fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'public.json'), JSON.stringify(viaBrowserPath));
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
execFileSync('node', ['build.mjs'], { cwd: root, env: { ...process.env, BASE_PATH: '/mmg' }, stdio: 'pipe' });
const out = execFileSync('node', ['scripts/prerender.mjs', '--data', path.join(tmp, 'public.json')], { cwd: root, env: { ...process.env, BASE_PATH: '/mmg', SITE_URL: 'https://example.github.io/mmg' }, encoding: 'utf8' });
console.log(out.trim());
const page = fs.readFileSync(path.join(root, 'dist/articles/news/company-launches-new-newsroom/index.html'), 'utf8');
assert.match(page, /Company launches new newsroom/); assert.match(page, /this is the story body/);
assert.match(page, /og:url[^>]*example\.github\.io\/mmg\/articles\/news\/company-launches-new-newsroom/);
assert.match(page, /href="\/mmg\/css\//); assert.doesNotMatch(page, /href="\/css\//, 'asset links carry the base path'); assert.doesNotMatch(page, /<script src="[^"]*\/js\//); assert.match(page, /\/mmg\/assets\/app\.js/);
assert.doesNotMatch(page, /alert\(1\)/, 'script in a body is stripped'); assert.match(page, /Content-Security-Policy/);
assert.match(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8'), /Company launches new newsroom/, 'home is prerendered');
assert.match(fs.readFileSync(path.join(root, 'dist/sitemap.xml'), 'utf8'), /example\.github\.io\/mmg\/articles\/news\/company-launches/);
assert.match(fs.readFileSync(path.join(root, 'dist/robots.txt'), 'utf8'), /Sitemap: https:\/\/example\.github\.io\/mmg\/sitemap\.xml/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8') + page, /Secret draft|Do not leak/);
assert.ok(fs.existsSync(path.join(root, 'dist/404.html')));
console.log('scripts: projection parity, idempotent reconcile and prerender passed');
process.exit(0);
