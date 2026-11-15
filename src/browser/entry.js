// Start-up: wires the Express-style app, restores any remembered sign-in, opens the data mirror and draws the first page.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const cms = require('../cms');
const ST = require('../staff');
const V = require('../views/public');
const { esc } = require('../util');
const PAGE_SCRIPTS = require('./page-scripts.generated');
const runtime = require('./runtime');

const app = express.Router();
app.use('/admin', A.loadSession, require('../routes/admin'));
app.use('/', require('../routes/public'));

// ---- background duties for signed-in staff (publishing the public copy, scheduled posts, first-run data) ----
let cmsFor = null;
function syncCms() {
  const u = A.state.user, id = u ? u.uid : null;
  if (id === cmsFor) return;
  cmsFor = id;
  if (!u) return cms.stop();
  cms.start(u);
  if (A.can(u, 'staff.manage')) ST.bootstrap().then(() => ST.ensureSlugs()).catch(e => console.warn('staff setup:', e.message));
  if (A.can(u, 'inquiries.manage')) cms.importInbox().catch(() => {});
  if (A.can(u, 'newsletter.manage')) cms.importSubscribers().catch(() => {});
}

const hooks = {
  async beforeRequest() { await A.settled(); syncCms(); },
  afterRequest() {},
  runScript(src) {
    const name = String(src).split('/').pop().replace(/\.js(\?.*)?$/, '');
    const fn = PAGE_SCRIPTS[name];
    if (fn) { try { fn(); } catch (e) { console.error(`page script ${name} failed:`, e); } }
  },
  notFound: req => V.layout(req, { title: 'Page not found', noindex: true, body: V.pageHead('Page not found', 'That page does not exist or is no longer available.') + '<section><div class="wrap"><a class="btn" href="/">Go to the homepage</a> <a class="btn paper-btn" href="/articles">Browse articles</a></div></section>' }),
  errorPage: err => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Something went wrong</title><link rel="stylesheet" href="/css/base.css"></head><body style="padding:2rem;font-family:sans-serif"><h1>Something went wrong</h1><p>An unexpected error occurred. Reload the page; if it keeps happening, check your connection.</p><pre style="white-space:pre-wrap;color:#8b1f1f">${esc(err && err.message || err)}</pre></body></html>`,
};

function setupNotice() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Setup needed</title></head><body style="font:16px/1.5 system-ui;max-width:640px;margin:3rem auto;padding:0 1rem"><h1>One more step</h1><p>This site is deployed, but <code>config.js</code> has not been filled in yet. Open it in the repository, paste your Firebase web app config and Cloudinary details, commit, and the site will start working.</p><p>See <b>README.md &rarr; Setup</b>.</p></body></html>`;
}

async function main() {
  const cfg = window.MMG_CONFIG || {};
  if (!cfg.firebase || !cfg.firebase.apiKey || /YOUR_/.test(cfg.firebase.apiKey)) { document.open(); document.write(setupNotice()); document.close(); return; }
  const rt = runtime.create(app, hooks);
  rt.install();
  window.__mmg = { go: rt.go, dispatch: rt.dispatch, db, auth: A, cms }; // handy in the browser console and used by the tests
  await A.boot();
  syncCms();
  await rt.go(runtime.stripBase(location.pathname) + location.search + location.hash, { push: false, scroll: false });
  window.__mmgReady = true;
}
main().catch(e => { console.error(e); document.body.innerHTML = `<div style="font:16px/1.5 system-ui;max-width:640px;margin:3rem auto;padding:0 1rem"><h1>The site could not start</h1><p>${esc(e && e.message || e)}</p><p>Check <code>config.js</code> and the Firebase rules, then reload.</p></div>`; });
