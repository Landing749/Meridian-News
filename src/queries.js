// Public article queries, computed over the in-memory mirror of the Realtime Database.
const db = require('./db');
const { deliver } = require('./cloud');

// Lookup tables used to attach category / author / image details to an article row (what the SQL joins did).
function lookups() {
  return { cats: new Map(db.all('categories').map(c => [c.id, c])), authors: new Map(db.all('authors').map(a => [a.id, a])), media: new Map(db.all('media').map(m => [m.id, m])) };
}
function view(a, L = lookups()) {
  const c = L.cats.get(a.category_id), au = L.authors.get(a.author_id), m = L.media.get(a.featured_media_id);
  return { ...a, category: c ? c.name : null, cat_slug: c ? c.slug : null, author: au ? au.name : null, author_slug: au ? au.slug : null, author_title: au ? au.title : null, author_bio: au ? au.bio : null,
    image: m ? deliver(m.url, 1600) : null, image_alt: m ? m.alt : null, views: db.viewsOf(a.id) ?? a.views ?? 0 };
}
// Published, already live, and not in a hidden category.
function published(L = lookups()) {
  const now = db.now();
  return db.all('articles').filter(a => { const c = L.cats.get(a.category_id); return a.status === 'published' && a.published_at && a.published_at <= now && (!a.category_id || !c || c.active === 1); }).map(a => view(a, L));
}
const byDate = (x, y) => (y.published_at < x.published_at ? -1 : y.published_at > x.published_at ? 1 : y.id - x.id);
const SORTS = { oldest: (x, y) => -byDate(x, y), popular: (x, y) => y.views - x.views || byDate(x, y) };

function search(opts = {}) {
  let rows = published();
  const ql = (opts.q || '').toLowerCase();
  if (ql) rows = rows.filter(a => [a.title, a.subtitle, a.excerpt, a._plain, a.body].some(f => String(f || '').toLowerCase().includes(ql)));
  if (opts.cat) rows = rows.filter(a => a.cat_slug === opts.cat);
  if (opts.tag) { const t = db.find('tags', x => x.slug === opts.tag), ids = new Set(t ? db.where('article_tags', r => r.tag_id === t.id).map(r => r.article_id) : []); rows = rows.filter(a => ids.has(a.id)); }
  if (opts.author) rows = rows.filter(a => a.author_slug === opts.author);
  if (opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)) rows = rows.filter(a => a.published_at.slice(0, 10) >= opts.from);
  if (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to)) rows = rows.filter(a => a.published_at.slice(0, 10) <= opts.to);
  if (opts.announcement) rows = rows.filter(a => a.is_announcement === 1);
  if (opts.excludeId) rows = rows.filter(a => a.id !== opts.excludeId);
  rows.sort(SORTS[opts.sort] || byDate);
  const total = rows.length, limit = opts.limit || 9, page = Math.max(1, +opts.page || 1);
  return { rows: rows.slice((page - 1) * limit, page * limit), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
const bySlug = (cat, slug) => published().find(a => a.cat_slug === cat && a.slug === slug) || null;
// A single published article by id (null if it is not live).
const liveById = id => published().find(a => a.id === +id) || null;
const popular = (n = 5) => published().sort(SORTS.popular).slice(0, n);
const featured = () => { const p = published().sort(byDate); return p.find(a => a.is_featured === 1) || p[0] || null; };
const tagsFor = id => db.where('article_tags', r => r.article_id === id).map(r => db.get('tags', r.tag_id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)).map(t => ({ name: t.name, slug: t.slug }));
const categories = () => db.where('categories', c => c.active === 1).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
function topTags(n = 18) {
  const live = new Set(published().map(a => a.id)), counts = new Map();
  for (const r of db.all('article_tags')) if (live.has(r.article_id)) counts.set(r.tag_id, (counts.get(r.tag_id) || 0) + 1);
  return [...counts].map(([id, c]) => { const t = db.get('tags', id); return t && { name: t.name, slug: t.slug, n: c }; }).filter(Boolean).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, n);
}
function neighbors(a) {
  const p = published();
  const prev = p.filter(x => x.published_at < a.published_at).sort(byDate)[0] || null;
  const next = p.filter(x => x.published_at > a.published_at).sort((x, y) => -byDate(x, y))[0] || null;
  return { prev, next };
}
function related(a, n = 3) {
  const mine = new Set(db.where('article_tags', r => r.article_id === a.id).map(r => r.tag_id)), shared = new Map();
  for (const r of db.all('article_tags')) if (mine.has(r.tag_id)) shared.set(r.article_id, (shared.get(r.article_id) || 0) + 1);
  return published().filter(x => x.id !== a.id).sort((x, y) => ((y.cat_slug === (a.cat_slug || '')) - (x.cat_slug === (a.cat_slug || ''))) || ((shared.get(y.id) || 0) - (shared.get(x.id) || 0)) || byDate(x, y)).slice(0, n);
}
// Counts a page view (daily total per article plus the running total on the article). Failures are logged, never thrown.
function countView(id) {
  const day = new Date().toISOString().slice(0, 10);
  // Anyone may add exactly 1 to these two counters (database.rules.json); nothing else under /public is writable by visitors.
  db.increment(`public/views_daily/${id}/${day}`).catch(() => {});
  db.increment(`public/views/${id}`).catch(() => {});
}
module.exports = { view, lookups, published, search, bySlug, liveById, popular, featured, tagsFor, categories, topTags, neighbors, related, countView };
