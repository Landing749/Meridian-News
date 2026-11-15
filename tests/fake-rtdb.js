// In-memory Realtime Database (from the original test fakes), bundled into the browser test build.
const SERVER_INC = Symbol('increment');
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const own = v => (v && v[SERVER_INC] ? v : clone(v) ?? null); // server-value sentinels must survive cloning
const BAD_KEY = /[.$#[\]/]/;

// ------------------------------------------------------------------ Realtime Database
function createRtdb(initial = null) {
  let root = initial ? clone(initial) : null;
  const listeners = []; // { path, type, cb }
  const parts = p => String(p || '').split('/').filter(Boolean);
  const getAt = (path, tree = root) => { let n = tree; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; };
  const check = (v, where) => {
    if (v === undefined) throw new Error(`FIREBASE FAKE: undefined value at ${where}`);
    if (v && typeof v === 'object' && !v[SERVER_INC]) for (const [k, x] of Object.entries(v)) { if (BAD_KEY.test(k)) throw new Error(`FIREBASE FAKE: illegal key "${k}" at ${where}`); check(x, where + '/' + k); }
  };
  const prune = v => { if (v && typeof v === 'object') { for (const k of Object.keys(v)) { v[k] = prune(v[k]); if (v[k] === null) delete v[k]; } return Object.keys(v).length ? v : null; } return v; };
  const setAt = (path, value) => {
    const ks = parts(path);
    if (!ks.length) { root = value === null ? null : value; return; }
    if (root == null || typeof root !== 'object') root = {};
    let n = root;
    for (const k of ks.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    if (value === null) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = value;
  };
  const resolveInc = (path, v) => { if (v && v[SERVER_INC]) { const cur = getAt(path); return (typeof cur === 'number' ? cur : 0) + v.n; } return v; };
  const walkInc = (path, v) => { if (v && typeof v === 'object' && !v[SERVER_INC]) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walkInc(path + '/' + k, x); return o; } return resolveInc(path, v); };

  // Runs a mutation and then tells every child listener what changed beneath its path.
  function mutate(fn) {
    const before = listeners.map(l => clone(getAt(l.path)));
    fn(); root = prune(root === null ? null : root);
    listeners.forEach((l, i) => {
      const a = before[i] || {}, b = clone(getAt(l.path)) || {};
      if (typeof a !== 'object' || typeof b !== 'object') return;
      for (const k of Object.keys(b)) {
        if (!(k in a) && l.type === 'child_added') l.cb(snap(l.path + '/' + k, b[k]));
        else if (k in a && JSON.stringify(a[k]) !== JSON.stringify(b[k]) && l.type === 'child_changed') l.cb(snap(l.path + '/' + k, b[k]));
      }
      for (const k of Object.keys(a)) if (!(k in b) && l.type === 'child_removed') l.cb(snap(l.path + '/' + k, a[k]));
    });
  }
  const order = keys => keys.sort((x, y) => { const ix = /^-?\d+$/.test(x), iy = /^-?\d+$/.test(y); return ix && iy ? x - y : ix ? -1 : iy ? 1 : x < y ? -1 : x > y ? 1 : 0; });
  function snap(path, value, kids) {
    const v = clone(value) ?? null;
    return { key: parts(path).pop() || null, val: () => clone(v), exists: () => v !== null, hasChildren: () => !!v && typeof v === 'object',
      forEach(cb) { const ks = kids || (v && typeof v === 'object' ? order(Object.keys(v)) : []); for (const k of ks) if (cb(snap(path + '/' + k, v[k])) === true) return true; return false; } };
  }
  function ref(path = '') {
    const p = parts(path).join('/');
    const r = {
      key: parts(p).pop() || null,
      child: c => ref(p + '/' + c),
      async set(v) { check(v, p); mutate(() => setAt(p, walkInc(p, own(v)))); },
      async update(obj) { // keys of an update are paths relative to this ref, so "/" is legal in them (each segment is still validated)
        for (const [k, v] of Object.entries(obj)) { if (parts(k).some(x => BAD_KEY.test(x))) throw new Error(`FIREBASE FAKE: illegal path "${k}"`); check(v, p + '/' + k); }
        mutate(() => { for (const [k, v] of Object.entries(obj)) { const full = p + '/' + k; setAt(full, walkInc(full, own(v))); } });
      },
      async remove() { mutate(() => setAt(p, null)); },
      async transaction(fn) {
        const cur = clone(getAt(p)), next = fn(cur);
        if (next === undefined) return { committed: false, snapshot: snap(p, cur) };
        check(next, p); mutate(() => setAt(p, clone(next)));
        return { committed: true, snapshot: snap(p, next) };
      },
      push() { const k = '-N' + Date.now().toString(36) + (push.n = (push.n || 0) + 1).toString(36).padStart(6, '0'); const c = ref(p + '/' + k); c.then = undefined; return c; },
      on(type, cb) { // like the real SDK, a child_added listener is called for every child that already exists
        listeners.push({ path: p, type, cb });
        if (type === 'child_added') { const cur = getAt(p); if (cur && typeof cur === 'object') for (const k of order(Object.keys(cur))) cb(snap(p + '/' + k, cur[k])); }
        return cb;
      },
      off() { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === p) listeners.splice(i, 1); },
      orderByKey: () => query(p, { by: 'key' }), orderByChild: f => query(p, { by: 'child', f }),
      async once() { return snap(p, getAt(p)); },
    };
    return r;
  }
  const push = {};
  function query(p, q) {
    const api = {
      limitToLast: n => query(p, { ...q, last: n }), equalTo: v => query(p, { ...q, eq: v }),
      async once() {
        const v = getAt(p) || {}; let ks = order(Object.keys(v));
        if (q.by === 'child') { ks = ks.filter(k => (q.eq === undefined || (v[k] && v[k][q.f] === q.eq))); ks.sort((a, b) => (v[a][q.f] < v[b][q.f] ? -1 : v[a][q.f] > v[b][q.f] ? 1 : 0)); }
        if (q.last) ks = ks.slice(-q.last);
        const sub = {}; ks.forEach(k => { sub[k] = v[k]; });
        return snap(p, sub, ks);
      },
    };
    return api;
  }
  return { ref: path => ref(path), dump: () => clone(root), ServerValue: { increment: n => ({ [SERVER_INC]: true, n }) } };
}


module.exports = { createRtdb, SERVER_INC };
