// Homepage manager: featured story, pinned lead stories and section visibility.
const db = require('./db');
const Q = require('./queries');

// Order here is the order shown in the CMS. The hero (masthead + front-page story) is always shown.
const SECTIONS = [
  { key: 'articles', label: 'From the newsroom', help: 'The article block under the front page: lead story, side stories, category bar and Most read.' },
  { key: 'announcements', label: 'Corporate announcements', help: 'The notice board. Also hides the corporate notice box beside the front-page story.' },
  { key: 'about', label: 'Who we are', help: 'The short company introduction with mission, vision and values.' },
  { key: 'story', label: 'Our story', help: 'The company timeline.' },
  { key: 'leadership', label: 'Leadership', help: 'The leadership cards. The Leadership page is not affected.' },
  { key: 'careers', label: 'Careers', help: 'The “Work with Meridian” block. The Careers page is not affected.' },
  { key: 'contact', label: 'Contact', help: 'The contact details and inquiry form. The Contact page is not affected.' },
];
// Story slots below the front-page story: 1 lead, 3 side stories, 3 in the row. Pins fill them in this order.
const SLOTS = ['Lead story', 'Side story 1', 'Side story 2', 'Side story 3', 'Row story 1', 'Row story 2', 'Row story 3'];
const MAX_PINS = SLOTS.length;

const cfg = k => { const v = db.homeConfig.get(k, null); return v === null ? undefined : v; };
const setCfg = (k, v) => db.homeConfig.set(k, v);

const isShown = key => cfg('show.' + key) !== '0';
const shownMap = () => Object.fromEntries(SECTIONS.map(s => [s.key, isShown(s.key)]));
const setShown = (key, on) => (SECTIONS.some(s => s.key === key) ? setCfg('show.' + key, on ? '1' : '0') : Promise.resolve());

// Homepage banner: one wide photo across the front page. Stored as plain strings in home_config (which is part of the public copy).
const banner = () => { const url = cfg('banner_url'); return url ? { url, alt: cfg('banner_alt') || '', caption: cfg('banner_caption') || '' } : null; };
async function setBanner({ url, alt, caption }) { await setCfg('banner_url', url); await setCfg('banner_alt', alt || ''); await setCfg('banner_caption', caption || ''); }
async function clearBanner() { await setCfg('banner_url', ''); await setCfg('banner_alt', ''); await setCfg('banner_caption', ''); }

const liveArticle = id => (id ? Q.liveById(id) : null);
const featuredId = () => { const v = +cfg('featured_id'); return v > 0 ? v : null; };
const setFeatured = id => setCfg('featured_id', id ? +id : '');

const pinRows = () => db.all('home_pins').sort((a, b) => a.position - b.position || a.article_id - b.article_id).map(p => ({ id: p.article_id, position: p.position }));
async function pin(id) {
  const pins = pinRows();
  if (pins.length >= MAX_PINS) return 'full';
  if (pins.some(p => p.id === id)) return 'dup';
  await db.insert('home_pins', { article_id: id, position: pins.length ? Math.max(...pins.map(p => p.position)) + 1 : 0 }, { key: id });
  return 'ok';
}
async function renumber(ids) { const b = db.batch(); ids.forEach((x, i) => b.patch('home_pins', x, { position: i })); await b.commit(); }
async function unpin(id) { await db.remove('home_pins', id); await renumber(pinRows().map(p => p.id)); }
async function movePin(id, dir) {
  const ids = pinRows().map(p => p.id), i = ids.indexOf(id), j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await renumber(ids);
  return true;
}

// What the public homepage shows. With no pins and no manual choice this matches the original behaviour:
// the featured/newest article leads the front page and the next newest fill the slots.
function resolve() {
  const latest = Q.search({ limit: 24 }).rows;
  const manual = liveArticle(featuredId());
  const top = manual || Q.featured() || latest[0] || null;
  const pinned = pinRows().map(p => liveArticle(p.id)).filter(a => a && (!top || a.id !== top.id)).slice(0, MAX_PINS);
  const used = new Set([top?.id, ...pinned.map(a => a.id)]);
  const stories = [...pinned, ...latest.filter(a => !used.has(a.id))].slice(0, MAX_PINS);
  return { top, manualTop: !!manual, stories, pinnedIds: new Set(pinned.map(a => a.id)), hasArticles: latest.length > 0 };
}
const split = r => ({ lead: r.stories[0], rail: r.stories.slice(1, 4), row: r.stories.slice(4, 7) });

module.exports = { banner, setBanner, clearBanner, SECTIONS, SLOTS, MAX_PINS, isShown, shownMap, setShown, featuredId, setFeatured, pinRows, pin, unpin, movePin, resolve, split, liveArticle };
