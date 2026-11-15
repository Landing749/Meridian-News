// Data layer on Firebase Realtime Database, running in the browser.
//
// Two modes share one API. "private" (signed-in staff) mirrors the real tables, e.g. /articles. "public" (everyone else)
// mirrors the read-only projection at /public/<table> that database.rules.json lets anyone read; tables that are never
// published (users, inquiries, issues...) are simply empty there. See src/publicsync.js for how /public is produced.
//
// Layout: every table lives at /<table>/<id> (one JSON object per row, ids are the same integers the SQL version used,
// so URLs and form values do not change). Small, frequently joined tables are mirrored in memory and kept in sync with
// child_added / child_changed / child_removed listeners, so reads are synchronous and writes are awaited:
//
//     const a = db.get('articles', 12);          // sync, from the mirror
//     await db.update('articles', 12, { title }); // async, written to RTDB (the mirror updates immediately)
//
// High-volume or per-parent data (audit log, search log, revisions, editorial events, view counts) is NOT mirrored and
// is read on demand with the helpers at the bottom.
const { rtdb, ServerValue } = require('./firebase');
const { nowSql } = require('./util');

const { TABLES } = require('./tables');

// Tables that exist in the public projection. Anything else is empty for visitors.
const PUBLIC_TABLES = new Set(['articles', 'article_tags', 'categories', 'authors', 'tags', 'media', 'jobs', 'staff', 'departments', 'settings', 'home_config', 'home_pins']);
let MODE = 'private';
const base = t => (MODE === 'public' ? 'public/' : '') + t;
const isPermission = e => /permission[_ ]denied/i.test(String((e && (e.message || e.code)) || e));
let views = {};
const writeHooks = [];
const touched = tables => { for (const t of new Set(tables)) for (const f of writeHooks) { try { f(t); } catch (e) { console.error('write hook failed:', e); } } };

// ---- Referential rules (what SQL did with ON DELETE CASCADE / SET NULL) ----
const CASCADE = {
  articles: { del: [['article_tags', 'article_id'], ['home_pins', 'article_id']], tree: ['revisions', 'public/views', 'public/views_daily', 'article_views'], flat: [['editorial_events', 'article_id']] },
  tags: { del: [['article_tags', 'tag_id']] },
  issues: { del: [['issue_pages', 'issue_id']] },
  media: { nullify: [['articles', 'featured_media_id'], ['issues', 'left_logo_media_id'], ['issues', 'right_logo_media_id'], ['issue_pages', 'photo_media_id']] },
  departments: { nullify: [['staff', 'department_id']] },
  staff: { nullify: [['staff', 'reports_to']] },
  authors: { nullify: [['staff', 'author_id'], ['users', 'author_id'], ['articles', 'author_id']] },
};

const mirrors = new Map();
const keyOf = id => String(id);
const clean = o => { const r = {}; for (const [k, v] of Object.entries(o)) if (k !== 'id') r[k] = v === undefined ? null : v; return r; };
const norm = (t, key, val) => ({ ...TABLES[t].defaults, ...(val || {}), id: TABLES[t].auto && /^\d+$/.test(key) ? Number(key) : key });
const cmp = (a, b) => (typeof a.id === 'number' ? a.id - b.id : String(a.id) < String(b.id) ? -1 : 1);

async function loadTable(t) {
  const m = { rows: new Map(), sorted: null, ref: null };
  mirrors.set(t, m);
  if (MODE === 'public' && !PUBLIC_TABLES.has(t)) return; // never published: stays empty for visitors
  const ref = rtdb.ref(base(t)); m.ref = ref;
  const put = s => { m.rows.set(s.key, norm(t, s.key, s.val())); m.sorted = null; };
  const fail = e => { if (!isPermission(e)) console.error(`Realtime Database listener for "${t}" stopped:`, e.message); };
  ref.on('child_added', put, fail); ref.on('child_changed', put, fail);
  ref.on('child_removed', s => { m.rows.delete(s.key); m.sorted = null; }, fail);
  try {
    const first = await ref.once('value');
    first.forEach(c => { if (!m.rows.has(c.key)) put(c); }); // normally already loaded by child_added; this makes startup independent of event ordering
  } catch (e) { if (!isPermission(e)) throw e; } // a role that may not read this table just sees it empty
}
async function loadViews() {
  try { views = (await rtdb.ref('public/views').once('value')).val() || {}; } catch { views = {}; }
}
let initPromise = null;
function detach() { for (const m of mirrors.values()) if (m.ref) m.ref.off(); }
// Loads every table for the given mode ('private' for signed-in staff, 'public' for visitors). Switching modes drops the old mirror.
function reinit(mode = 'private') {
  detach(); mirrors.clear(); bodies.clear(); MODE = mode;
  return (initPromise = Promise.all([...Object.keys(TABLES).map(loadTable), loadViews()]).then(() => {}));
}
const init = (mode = 'private') => (initPromise && mode === MODE ? initPromise : reinit(mode));
const mode = () => MODE;
const mirror = t => { const m = mirrors.get(t); if (!m) throw new Error(`Table "${t}" is not loaded (call db.init() first, or it is not a mirrored table)`); return m; };
// Page-view totals live in /public/views (anyone may add 1 to a counter, nothing else). Loaded once per visit.
const viewsOf = id => (views[id] == null ? null : views[id]);
// Article bodies are kept out of the public list rows (they are large); the article page fetches its own.
const bodies = new Map();
async function bodyOf(id) {
  if (MODE === 'private') { const a = mirrors.get('articles') && mirrors.get('articles').rows.get(keyOf(id)); return a ? a.body || '' : ''; }
  if (bodies.has(id)) return bodies.get(id);
  const v = (await rtdb.ref(`public/bodies/${id}`).once('value')).val() || '';
  bodies.set(id, v); return v;
}

// ---- Synchronous reads from the mirror (rows are copies; mutating them changes nothing) ----
const all = t => { const m = mirror(t); if (!m.sorted) m.sorted = [...m.rows.values()].sort(cmp); return m.sorted.map(r => ({ ...r })); };
const get = (t, id) => { if (id == null || id === '') return null; const r = mirror(t).rows.get(keyOf(id)); return r ? { ...r } : null; };
const where = (t, pred) => all(t).filter(pred);
const find = (t, pred) => all(t).find(pred) || null;
const count = (t, pred) => (pred ? all(t).filter(pred).length : mirror(t).rows.size);

// ---- Writes ----
async function nextId(t) {
  const r = await rtdb.ref('_counters/' + t).transaction(v => (v || 0) + 1);
  let id = r.snapshot.val();
  const m = mirror(t);
  while (m.rows.has(keyOf(id))) { const n = await rtdb.ref('_counters/' + t).transaction(v => Math.max(v || 0, id) + 1); id = n.snapshot.val(); } // counter behind the data: skip ahead
  return id;
}
// Reserves n consecutive ids with a single counter transaction (for bulk inserts). Returns [first, ..., last].
async function reserve(t, n) {
  const r = await rtdb.ref('_counters/' + t).transaction(v => Math.max(v || 0, ...[...mirror(t).rows.keys()].map(Number)) + n), end = r.snapshot.val();
  return Array.from({ length: n }, (_, i) => end - n + 1 + i);
}
function stamped(t, data) {
  const o = { ...TABLES[t].defaults, ...data }, now = nowSql();
  for (const f of TABLES[t].stamp || []) if (o[f] == null) o[f] = now;
  return o;
}
// Inserts a row. Auto-id tables get the next integer id; keyed tables (junctions, settings) need opts.key.
async function insert(t, data, opts = {}) {
  const id = TABLES[t].auto ? await nextId(t) : opts.key;
  if (id == null) throw new Error(`insert into "${t}" needs a key`);
  await rtdb.ref(`${t}/${id}`).set(clean(stamped(t, data)));
  touched([t]);
  return get(t, id);
}
// Merges fields into an existing row (siblings untouched). Returns the updated row, or null if it does not exist.
async function update(t, id, patch) {
  if (!mirror(t).rows.has(keyOf(id))) return null;
  const p = clean(patch); if (Object.keys(p).length) { await rtdb.ref(`${t}/${id}`).update(p); touched([t]); }
  return get(t, id);
}
// Atomic multi-row write: db.batch().set(...).patch(...).del(...).commit()
function batch() {
  const paths = {};
  const b = {
    set: (t, id, data) => { paths[`${t}/${id}`] = clean(stamped(t, data)); return b; },
    patch: (t, id, patch) => { for (const [k, v] of Object.entries(clean(patch))) paths[`${t}/${id}/${k}`] = v; return b; },
    del: (t, id) => { paths[`${t}/${id}`] = null; return b; },
    raw: (path, v) => { paths[path] = v; return b; },
    commit: async () => { if (!Object.keys(paths).length) return; await rtdb.ref().update(paths); touched(Object.keys(paths).map(p => p.split('/')[0])); },
  };
  return b;
}
// Deletes a row and applies the cascade rules in a single atomic write.
async function remove(t, id) {
  if (!mirror(t).rows.has(keyOf(id))) return false;
  const b = batch().del(t, id), rule = CASCADE[t] || {};
  for (const [ct, fk] of rule.del || []) for (const r of where(ct, r => r[fk] != null && String(r[fk]) === String(id))) b.del(ct, r.id);
  for (const [ct, fk] of rule.nullify || []) for (const r of where(ct, r => r[fk] != null && String(r[fk]) === String(id))) if (!(ct === t && String(r.id) === String(id))) b.raw(`${ct}/${r.id}/${fk}`, null);
  for (const tree of rule.tree || []) b.raw(`${tree}/${id}`, null);
  for (const [path, fk] of rule.flat || []) for (const r of await listBy(path, fk, +id)) b.raw(`${path}/${r.id}`, null);
  await b.commit();
  return true;
}
// Deletes every row matching pred (with cascades per row would be needed for cascading tables; use for leaf tables).
async function removeWhere(t, pred) { const b = batch(); for (const r of where(t, pred)) b.del(t, r.id); await b.commit(); }

// ---- Settings / home config (string key -> string value) ----
const enc = k => String(k).replace(/[.$#[\]/%]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const kv = t => ({
  get: (k, d = '') => { const r = get(t, enc(k)); return r ? r.value : d; },
  set: async (k, v) => { await rtdb.ref(`${t}/${enc(k)}`).set({ value: String(v) }); touched([t]); },
  all: () => Object.fromEntries(all(t).map(r => [decodeURIComponent(r.id), r.value])),
});
const settings = kv('settings'), homeConfig = kv('home_config');
const getSetting = settings.get, setSetting = settings.set;

// ---- Unmirrored data (read on demand) ----
const listOf = (snap, limit) => { const out = []; snap.forEach(c => { out.push({ id: c.key, ...c.val() }); }); return limit ? out.slice(-limit) : out; };
// Children of a path as [{id, ...fields}], ordered by key ascending; `limit` keeps only the last N keys.
async function list(path, limit) { const ref = rtdb.ref(path), s = await (limit ? ref.orderByKey().limitToLast(limit) : ref).once('value'); return listOf(s); }
// Rows of an unmirrored flat collection whose `field` equals `value` (needs ".indexOn" for the field in database.rules.json).
async function listBy(path, field, value) { return listOf(await rtdb.ref(path).orderByChild(field).equalTo(value).once('value')); }
const read = async path => (await rtdb.ref(path).once('value')).val();
// Append with an auto-increment numeric id (stored under `path/<id>`)
async function append(path, data, counter) {
  const r = await rtdb.ref('_counters/' + counter).transaction(v => (v || 0) + 1), id = r.snapshot.val();
  await rtdb.ref(`${path}/${id}`).set(clean({ created_at: nowSql(), ...data }));
  return id;
}
// Append with a time-ordered push key (for write-heavy logs whose ids are never used)
const push = async (path, data) => { const ref = rtdb.ref(path).push(); await ref.set(clean({ created_at: nowSql(), ...data })); return ref.key; };
const increment = (path, n = 1) => rtdb.ref(path).set(ServerValue.increment(n));
const setPath = (path, v) => rtdb.ref(path).set(v);
const removePath = path => rtdb.ref(path).remove();

module.exports = { init, reinit, mode, viewsOf, bodyOf, onWrite: f => writeHooks.push(f), PUBLIC_TABLES, TABLES, all, get, where, find, count, insert, update, remove, removeWhere, batch, nextId, reserve, settings, homeConfig, getSetting, setSetting, list, listBy, read, append, push, increment, setPath, removePath, now: nowSql, rtdb };
