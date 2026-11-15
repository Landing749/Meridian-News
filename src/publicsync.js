// The public projection.
//
// Visitors cannot read the real tables (drafts, users, inquiries...). Everything the website shows is a copy kept under /public,
// derived from the real tables by project() below: published articles only (the heavy body text lives apart in /public/bodies),
// visible staff, open jobs, and so on. reconcile() compares the projection with a table of content hashes (/public/_hash) and writes
// only what changed, in a handful of multi-path updates.
//
// This file has no browser or Node specific code, so the CMS (in the browser) and scripts/reconcile.mjs (in GitHub Actions) share it.
const SOURCE_TABLES = ['articles', 'article_tags', 'categories', 'authors', 'tags', 'media', 'jobs', 'staff', 'departments', 'settings', 'home_config', 'home_pins'];
const OMIT = {
  articles: ['created_by', 'assigned_to', 'deadline', 'body', 'views'],
  media: ['uploaded_by', 'original_name', 'size', 'mime'],
};
const plainText = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const strip = (row, omit = []) => { const o = {}; for (const k of Object.keys(row)) if (k !== 'id' && !omit.includes(k)) o[k] = row[k]; return o; };

// Order-independent JSON so equal rows always hash equally.
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
// cyrb53: a small, fast 53-bit string hash (not cryptographic; it only detects changes).
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// src.all(table) must return the rows of a real table, each with its key in `id`.
function project(src) {
  const T = Object.fromEntries(SOURCE_TABLES.map(t => [t, {}])), bodies = {};
  const put = (t, row, omit) => { T[t][String(row.id)] = strip(row, omit); };
  const published = src.all('articles').filter(a => a.status === 'published' && a.published_at);
  const live = new Set(published.map(a => String(a.id))), mediaIds = new Set();
  for (const a of published) {
    put('articles', a, OMIT.articles);
    const row = T.articles[String(a.id)], text = plainText(a.body);
    row._rt = Math.max(1, Math.ceil((text ? text.split(' ').length : 0) / 220)); row._plain = text.slice(0, 260);
    bodies[String(a.id)] = a.body || '';
    if (a.featured_media_id != null) mediaIds.add(String(a.featured_media_id));
  }
  for (const r of src.all('article_tags')) if (live.has(String(r.article_id))) put('article_tags', r);
  for (const m of src.all('media')) if (mediaIds.has(String(m.id))) put('media', m, OMIT.media);
  for (const t of ['categories', 'authors', 'tags', 'departments', 'settings', 'home_config']) for (const r of src.all(t)) put(t, r);
  for (const s of src.all('staff')) if (s.visible === 1) put('staff', s);
  for (const j of src.all('jobs')) if (j.status === 'published') put('jobs', j);
  for (const p of src.all('home_pins')) if (live.has(String(p.article_id))) put('home_pins', p);
  return { tables: T, bodies };
}

// Writes whatever differs between project(src) and what /public holds. Resolves the number of changed paths.
async function reconcile(rtdb, src) {
  const { tables, bodies } = project(src);
  const stored = (await rtdb.ref('public/_hash').once('value')).val() || {};
  const updates = {};
  const touch = (kind, id, value) => {
    const h = hash(stable(value)), old = stored[kind] && stored[kind][id];
    if (old !== h) { updates[`public/${kind}/${id}`] = value; updates[`public/_hash/${kind}/${id}`] = h; }
  };
  const want = { ...tables, bodies };
  for (const [kind, rows] of Object.entries(want)) {
    for (const [id, v] of Object.entries(rows)) touch(kind, id, v);
    for (const id of Object.keys(stored[kind] || {})) if (!(id in rows)) { updates[`public/${kind}/${id}`] = null; updates[`public/_hash/${kind}/${id}`] = null; }
  }
  // View counters start from the totals the old server kept on each article, once.
  const views = (await rtdb.ref('public/views').once('value')).val() || {};
  for (const a of src.all('articles')) if (a.status === 'published' && a.views > 0 && views[a.id] == null) updates[`public/views/${a.id}`] = a.views;
  const paths = Object.keys(updates);
  if (!paths.length) return 0;
  // Several smaller updates: a single request may not exceed the RTDB payload limit, and bodies can be large.
  let batch = {}, size = 0;
  for (const p of paths) {
    const len = JSON.stringify(updates[p] ?? null).length + p.length;
    if (size && (size + len > 800000 || Object.keys(batch).length >= 400)) { await rtdb.ref().update(batch); batch = {}; size = 0; }
    batch[p] = updates[p]; size += len;
  }
  if (Object.keys(batch).length) await rtdb.ref().update(batch);
  return paths.length;
}
module.exports = { SOURCE_TABLES, project, reconcile, hash, stable, plainText };
