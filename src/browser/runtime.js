// The browser "server": turns clicks, form submissions and fetch() calls into requests for the Express-style router,
// and draws the HTML that comes back. Everything the old Node server did per request now happens right here, in the page.
const { Buffer } = require('buffer');
const BASE = String((typeof window !== 'undefined' && window.MMG_BASE) || '').replace(/\/$/, '');
const stripBase = p => (BASE && (p === BASE || p.startsWith(BASE + '/')) ? p.slice(BASE.length) || '/' : p);
const addBase = p => (BASE && p.startsWith('/') && !p.startsWith('//') ? BASE + p : p);
// The templates write root-relative links (/articles/...). On a project site (user.github.io/repo/) they need the repo prefix.
const withBase = html => (!BASE ? html : html
  .replace(/(\s(?:href|src|action|formaction|poster)=")\/(?!\/)/g, `$1${BASE}/`)
  .replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${BASE}/`));

const parseQuery = sp => { const q = {}; for (const [k, v] of sp) q[k] = k in q ? [].concat(q[k], v) : v; return q; };

function makeReqRes(o) {
  const u = new URL(o.url, location.origin), path = stripBase(u.pathname);
  const req = {
    method: o.method || 'GET', path, url: path + u.search, originalUrl: path + u.search, baseUrl: '', params: {}, query: parseQuery(u.searchParams),
    body: o.body || {}, _files: o.files || {}, headers: { accept: o.accept || 'text/html', 'user-agent': navigator.userAgent, ...(o.headers || {}) },
    ip: 'browser', xhr: !!o.xhr, user: null, get(h) { return this.headers[String(h).toLowerCase()]; },
  };
  let finish; const done = new Promise(r => { finish = r; });
  const res = {
    statusCode: 200, headers: {}, headersSent: false,
    status(n) { this.statusCode = n; return this; },
    set(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) this.headers[a.toLowerCase()] = b; else this.headers[String(k).toLowerCase()] = v; return this; },
    setHeader(k, v) { return this.set(k, v); },
    type(t) { this.headers['content-type'] = /\//.test(t) ? t : ({ xml: 'application/xml', csv: 'text/csv', txt: 'text/plain', json: 'application/json' })[t] || 'text/' + t; return this; },
    send(b) { if (this.headersSent) return this; this.headersSent = true; finish({ status: this.statusCode, headers: this.headers, body: b }); return this; },
    json(o2) { this.headers['content-type'] = 'application/json'; return this.send(JSON.stringify(o2)); },
    redirect(a, b) { if (this.headersSent) return this; this.headersSent = true; finish({ status: typeof a === 'number' ? a : b || 302, headers: {}, redirect: typeof a === 'number' ? b : a }); return this; },
    end(b) { return this.send(b || ''); },
  };
  return { req, res, done };
}

function create(app, hooks) {
  // ----- dispatch: run one request through the router -----
  async function dispatch(o) {
    await hooks.beforeRequest();
    const { req, res, done } = makeReqRes(o);
    app.handle(req, res, err => {
      if (err) { console.error(err); const json = req.path.startsWith('/admin/api/') || (req.headers.accept || '').includes('json');
        res.status(500); return json ? res.json({ error: 'Something went wrong. Your changes in the browser were not lost; try again.' }) : res.send(hooks.errorPage(err)); }
      if (!res.headersSent) res.status(404).send(hooks.notFound(req));
    });
    return done;
  }

  // ----- drawing a page -----
  const dynAttr = 'data-mmg-dyn';
  let recording = false, pageListeners = [], lastUser = null;
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, fn, opts) {
    if (recording && (this === document || this === window)) pageListeners.push([this, t, fn, opts]);
    return origAdd.call(this, t, fn, opts);
  };
  const dropPageListeners = () => { for (const [tg, t, fn, o] of pageListeners) tg.removeEventListener(t, fn, o); pageListeners = []; };

  function syncHead(head) {
    document.head.querySelectorAll(`[${dynAttr}]`).forEach(n => n.remove());
    const want = new Set();
    for (const n of [...head.children]) {
      if (n.tagName === 'TITLE') continue;
      if (n.tagName === 'META' && (n.hasAttribute('charset') || n.getAttribute('name') === 'viewport')) continue;
      if (n.tagName === 'LINK' && n.getAttribute('rel') === 'stylesheet') {
        const href = n.getAttribute('href'); want.add(href);
        if (![...document.head.querySelectorAll('link[rel="stylesheet"]')].some(l => l.getAttribute('href') === href)) document.head.appendChild(document.importNode(n, true));
        continue;
      }
      const c = document.importNode(n, true); c.setAttribute(dynAttr, ''); document.head.appendChild(c);
    }
    document.head.querySelectorAll('link[rel="stylesheet"]').forEach(l => { if (!want.has(l.getAttribute('href')) && !l.hasAttribute('data-keep')) l.remove(); });
  }
  function render(html, status) {
    const doc = new DOMParser().parseFromString(withBase(String(html)), 'text/html');
    const scripts = [...doc.body.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
    doc.body.querySelectorAll('script:not([type="application/json"])').forEach(s => s.remove()); // keep inert JSON data blocks (the issue editor reads #issue-data)
    dropPageListeners();
    document.title = doc.title || document.title;
    syncHead(doc.head);
    document.body.className = doc.body.className;
    for (const a of [...document.body.attributes]) if (a.name.startsWith('data-')) document.body.removeAttribute(a.name);
    for (const a of [...doc.body.attributes]) if (a.name.startsWith('data-')) document.body.setAttribute(a.name, a.value);
    document.body.replaceChildren(...[...doc.body.childNodes].map(n => document.importNode(n, true)));
    recording = true;
    try { for (const src of scripts) hooks.runScript(src); } finally { recording = false; }
    document.documentElement.lang = doc.documentElement.lang || 'en';
  }

  // ----- navigation -----
  let seq = 0;
  async function show(r, { redirectPush = true, scroll = true } = {}) {
    if (r.redirect) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(r.redirect)) { location.href = r.redirect; return; }
      return go(r.redirect, { push: redirectPush });
    }
    const cd = r.headers && r.headers['content-disposition'];
    if (cd) { // a download (CSV export)
      const m = /filename="?([^";]+)"?/.exec(cd), blob = new Blob([r.body], { type: r.headers['content-type'] || 'text/plain' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = m ? m[1] : 'download'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return;
    }
    hooks.afterRequest();
    render(typeof r.body === 'string' ? r.body : String(r.body ?? ''), r.status);
    if (scroll) { const h = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))); h ? h.scrollIntoView() : window.scrollTo(0, 0); }
  }
  async function go(url, { push = true, scroll = true } = {}) {
    const my = ++seq; document.documentElement.style.cursor = 'progress';
    try {
      const u = new URL(url, location.origin + addBase('/'));
      const internal = stripBase(u.pathname) + u.search + u.hash;
      if (push) history.pushState({}, '', addBase(stripBase(u.pathname)) + u.search + u.hash); else history.replaceState({}, '', addBase(stripBase(u.pathname)) + u.search + u.hash);
      const r = await dispatch({ method: 'GET', url: addBase(stripBase(u.pathname)) + u.search });
      if (my === seq) await show(r, { scroll, redirectPush: false });
      return internal;
    } finally { if (my === seq) document.documentElement.style.cursor = ''; }
  }

  async function readFiles(files) {
    const out = {};
    for (const [k, list] of Object.entries(files)) out[k] = await Promise.all(list.map(async f => ({ buffer: Buffer.from(await f.arrayBuffer()), originalname: f.name, mimetype: f.type, size: f.size })));
    return out;
  }
  async function submit(form, submitter) {
    const method = (submitter && submitter.getAttribute('formmethod') || form.getAttribute('method') || 'get').toUpperCase();
    if (method === 'DIALOG') return false;
    const action = (submitter && submitter.getAttribute('formaction')) || form.getAttribute('action') || location.pathname + location.search;
    const u = new URL(action, location.href); if (u.origin !== location.origin) return false;
    const fd = new FormData(form, submitter || undefined);
    if (method === 'GET') {
      const sp = new URLSearchParams(); for (const [k, v] of fd.entries()) if (typeof v === 'string') sp.append(k, v);
      u.search = sp.toString(); await go(stripBase(u.pathname) + u.search); return true;
    }
    const body = {}, files = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v !== 'string') (files[k] = files[k] || []).push(v);
      else body[k] = k in body ? [].concat(body[k], v) : v;
    }
    const my = ++seq; document.documentElement.style.cursor = 'progress';
    try {
      const r = await dispatch({ method, url: u.pathname + u.search, body, files: await readFiles(files) });
      if (my === seq) await show(r);
    } finally { if (my === seq) document.documentElement.style.cursor = ''; }
    return true;
  }

  // fetch() to the app's own /admin/api/* endpoints runs through the router; everything else goes to the network.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    let u; try { u = new URL(url, location.href); } catch { return realFetch(input, init); }
    if (u.origin !== location.origin || !/^\/admin\/api\//.test(stripBase(u.pathname))) return realFetch(input, init);
    let body = {}, files = {};
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
      const raw = {}; for (const [k, v] of init.body.entries()) { if (typeof v !== 'string') (raw[k] = raw[k] || []).push(v); else body[k] = v; }
      files = await readFiles(raw);
    } else if (init.body) { try { body = JSON.parse(init.body); } catch { body = {}; } }
    const r = await dispatch({ method: (init.method || 'GET').toUpperCase(), url: u.pathname + u.search, body, files, xhr: true, accept: 'application/json' });
    return new Response(r.body == null ? '' : String(r.body), { status: r.status, headers: { 'Content-Type': (r.headers && r.headers['content-type']) || 'application/json' } });
  };

  function install() {
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const href = a.getAttribute('href'); if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
      let u; try { u = new URL(a.href, location.href); } catch { return; }
      if (u.origin !== location.origin) return;
      if (/\.(?:pdf|png|jpe?g|gif|webp|svg|ico|xml|txt|zip|woff2?|css|js|json)$/i.test(u.pathname)) return;
      if (u.pathname === location.pathname && u.search === location.search && u.hash) return; // in-page anchor
      e.preventDefault(); go(stripBase(u.pathname) + u.search + u.hash).catch(err => console.error(err));
    });
    document.addEventListener('submit', e => {
      if (e.defaultPrevented) return;
      const f = e.target; if (!(f instanceof HTMLFormElement)) return;
      const action = e.submitter && e.submitter.getAttribute('formaction') || f.getAttribute('action');
      if (action && /^[a-z][a-z0-9+.-]*:/i.test(action) && new URL(action, location.href).origin !== location.origin) return;
      e.preventDefault(); submit(f, e.submitter).catch(err => console.error(err));
    });
    window.addEventListener('popstate', () => { go(stripBase(location.pathname) + location.search + location.hash, { push: false, scroll: false }).catch(err => console.error(err)); });
  }
  return { install, go, dispatch, render, stripBase, addBase };
}
module.exports = { create, BASE, stripBase, addBase };
