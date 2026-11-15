// A small evaluator for Realtime Database security rules, enough to test database.rules.json offline.
// It follows the real semantics that matter here: .read/.write cascade downward (any granting ancestor wins), explicit child keys win over
// $wildcards, .validate must pass for every node written, and an expression that throws counts as false.
class Snap {
  constructor(v) { this.v = v === undefined ? null : v; }
  child(p) { let n = this.v; for (const k of String(p).split('/').filter(Boolean)) { n = n && typeof n === 'object' ? n[k] : null; if (n === undefined) n = null; } return new Snap(n); }
  val() { return this.v; }
  exists() { return this.v !== null; }
  hasChild(c) { return this.child(c).exists(); }
  hasChildren(list) { return this.v !== null && typeof this.v === 'object' && (!list || list.every(c => this.hasChild(c))); }
  isString() { return typeof this.v === 'string'; }
  isNumber() { return typeof this.v === 'number'; }
  isBoolean() { return typeof this.v === 'boolean'; }
}
const strMethods = { matches(re) { return re.test(this); }, contains(s) { return this.includes(s); }, beginsWith(s) { return this.startsWith(s); } };
for (const [k, f] of Object.entries(strMethods)) if (!String.prototype[k]) Object.defineProperty(String.prototype, k, { value: f, configurable: true });

const get = (tree, segs) => { let n = tree; for (const k of segs) { n = n && typeof n === 'object' ? n[k] : null; if (n === undefined) n = null; } return n; };
function setPath(tree, segs, value) {
  if (!segs.length) return value;
  const out = Array.isArray(tree) ? [...tree] : { ...(tree && typeof tree === 'object' ? tree : {}) };
  const [k, ...rest] = segs, next = setPath(out[k], rest, value);
  if (next === null || (typeof next === 'object' && next !== null && !Object.keys(next).length)) delete out[k]; else out[k] = next;
  return Object.keys(out).length ? out : null;
}
const cache = new Map();
function run(expr, vars, ctx, segs) {
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(vars);
  const key = names.join(',') + '|' + expr;
  let fn = cache.get(key);
  if (!fn) { fn = new Function('auth', 'now', 'root', 'data', 'newData', ...names, `return (${expr});`); cache.set(key, fn); }
  try { return fn(ctx.auth, ctx.now, new Snap(ctx.oldRoot), new Snap(get(ctx.oldRoot, segs)), new Snap(get(ctx.newRoot, segs)), ...names.map(n => vars[n])) === true; } catch { return false; }
}
// Like the real service, `root` is the data as it was BEFORE the write; `data` is the old value at the rule's location and `newData` the value after the write.
const childRule = (node, seg) => (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, seg) && !seg.startsWith('.') ? [node[seg], null]
  : node && typeof node === 'object' ? (() => { const w = Object.keys(node).find(k => k.startsWith('$')); return w ? [node[w], w] : [null, null]; })() : [null, null]);

function allowed(rules, op, segs, ctx) {
  let node = rules, vars = {};
  for (let i = 0; ; i++) {
    if (node && node['.' + op] !== undefined && run(node['.' + op], vars, ctx, segs.slice(0, i))) return true;
    if (i === segs.length) return false;
    const [next, w] = childRule(node, segs[i]);
    if (!next) return false;
    if (w) vars = { ...vars, [w]: segs[i] };
    node = next;
  }
}
// .validate must hold at every node that exists in the written subtree. Resolves to a failure description or null.
function validateSubtree(node, vars, segs, ctx) {
  const v = get(ctx.newRoot, segs);
  if (v === null) return null;
  if (node && node['.validate'] !== undefined && !run(node['.validate'], vars, ctx, segs)) return 'validate failed at /' + segs.join('/');
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      const [next, w] = childRule(node, k);
      if (!next) continue;
      const r = validateSubtree(next, w ? { ...vars, [w]: k } : vars, [...segs, k], ctx); if (r) return r;
    }
  }
  return null;
}
function validateAlong(rules, segs, ctx) { // .validate rules on the way down to the written location
  let node = rules, vars = {};
  for (let i = 0; i < segs.length; i++) {
    const [next, w] = childRule(node, segs[i]); if (!next) return { node: null, vars };
    if (w) vars = { ...vars, [w]: segs[i] };
    node = next;
  }
  return { node, vars };
}
export function createDb(rules, data) {
  const split = p => String(p).split('/').filter(Boolean);
  return {
    data: () => data,
    canRead(auth, path) { return allowed(rules, 'read', split(path), { auth, now: Date.now(), oldRoot: data, newRoot: data }); },
    // updates: { 'a/b/c': value | null } like ref().update()
    tryWrite(auth, updates) {
      let next = data;
      for (const [p, v] of Object.entries(updates)) next = setPath(next, split(p), v === undefined ? null : v);
      const ctx = { auth, now: Date.now(), oldRoot: data, newRoot: next };
      for (const p of Object.keys(updates)) {
        const segs = split(p);
        if (!allowed(rules, 'write', segs, ctx)) return { ok: false, why: 'write denied at /' + p };
        const { node, vars } = validateAlong(rules, segs, ctx);
        if (node) { const f = validateSubtree(node, vars, segs, ctx); if (f) return { ok: false, why: f }; }
      }
      data = next; return { ok: true };
    },
  };
}
