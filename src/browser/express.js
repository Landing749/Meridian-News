// A small Express-compatible router that runs in the browser. It supports what the CMS routes use:
// router.get/post/put/all/use, :params, nested routers with prefixes, async handlers, error propagation.
// req/res objects are created by runtime.js; this file only does matching and flow control.
function compile(path) {
  const keys = [];
  const src = String(path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z0-9_]+)/g, (m, k) => { keys.push(k); return '([^/]+?)'; });
  return { re: new RegExp('^' + src + '/?$'), keys };
}
const flat = a => a.flat(Infinity).filter(Boolean);
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };

function call(fn, req, res, next) {
  if (fn.length === 4) return next(); // error-handling middleware: only reached through next(err)
  try { const r = fn(req, res, next); if (r && typeof r.then === 'function') r.then(undefined, next); } catch (e) { next(e); }
}
function runChain(handlers, req, res, done) {
  let i = 0;
  const next = err => {
    if (err) return done(err);
    const h = handlers[i++];
    if (!h) return done();
    call(h, req, res, next);
  };
  next();
}

function Router() {
  const stack = [];
  const router = (req, res, next) => router.handle(req, res, next);
  router.stack = stack;
  router.handle = (req, res, out) => {
    let i = 0;
    const savedPath = req.path, savedBase = req.baseUrl || '';
    const done = err => { req.path = savedPath; req.baseUrl = savedBase; out(err); };
    const next = err => {
      const layer = stack[i++];
      if (!layer) return done(err);
      if (err) { // only error handlers (arity 4) run after an error
        const eh = layer.handlers.filter(h => h.length === 4);
        if (!eh.length) return next(err);
        return eh[0](err, req, res, next);
      }
      const path = req.path;
      if (layer.kind === 'use') {
        const p = layer.prefix;
        if (p && !(path === p || path.startsWith(p + '/'))) return next();
        const before = req.path, beforeBase = req.baseUrl;
        req.path = p ? (path.slice(p.length) || '/') : path; req.baseUrl = (req.baseUrl || '') + p;
        return runChain(layer.handlers, req, res, e => { req.path = before; req.baseUrl = beforeBase; next(e); });
      }
      if (layer.method !== 'all' && layer.method !== req.method) return next();
      const m = layer.re.exec(path); if (!m) return next();
      req.params = Object.fromEntries(layer.keys.map((k, n) => [k, dec(m[n + 1])]));
      runChain(layer.handlers, req, res, next);
    };
    next();
  };
  router.use = (...args) => {
    const prefix = typeof args[0] === 'string' ? args.shift().replace(/\/+$/, '') : '';
    stack.push({ kind: 'use', prefix, handlers: flat(args) });
    return router;
  };
  for (const method of ['get', 'post', 'put', 'delete', 'all']) {
    router[method] = (path, ...handlers) => {
      const { re, keys } = compile(path);
      stack.push({ kind: 'route', method: method.toUpperCase() === 'ALL' ? 'all' : method.toUpperCase(), re, keys, handlers: flat(handlers) });
      return router;
    };
  }
  return router;
}
const express = () => { throw new Error('express() is not available in the browser build; use express.Router()'); };
express.Router = Router;
express.json = () => (req, res, next) => next(); // JSON bodies are parsed by the runtime before dispatch
express.urlencoded = express.json;
module.exports = express;
