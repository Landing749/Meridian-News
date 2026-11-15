// A project site lives under /repo-name/. Every link the templates write as /something must gain the prefix, and navigation must keep it.
import assert from 'node:assert/strict';
import { bundle, boot, withPublicCopy } from './harness.mjs';
import { seed } from './seed.mjs';
const code = await bundle();
const data = await withPublicCopy(seed());
const s = await boot(code, data, { url: 'https://example.github.io/mmg/', base: '/mmg', siteUrl: 'https://example.github.io/mmg' });
const { w } = s, links = () => [...w.document.querySelectorAll('a[href^="/"], link[rel=stylesheet][href^="/"], img[src^="/"]')].map(e => e.getAttribute('href') || e.getAttribute('src'));
assert.ok(links().length > 10); assert.ok(links().every(h => h.startsWith('/mmg/')), 'unprefixed: ' + links().filter(h => !h.startsWith('/mmg/')).slice(0, 5));
const a = [...w.document.querySelectorAll('a')].find(x => /company-launches/.test(x.getAttribute('href') || '')); assert.ok(a);
a.click(); await s.waitFor(() => /^\/mmg\/articles\/news\/company-launches/.test(w.location.pathname)); await s.settle();
assert.match(s.text(), /this is the story body/); assert.ok(links().every(h => h.startsWith('/mmg/')));
await s.go('/admin/dashboard'); assert.equal(w.location.pathname, '/mmg/admin/login');
w.history.back(); await s.waitFor(() => /company-launches/.test(w.location.pathname)); await s.settle();
assert.match(s.text(), /this is the story body/, 'back button re-renders the previous page');
console.log('base path: links, navigation and history keep the /mmg prefix');
process.exit(0);
