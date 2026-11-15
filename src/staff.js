// Staff & leadership data helpers: slugs, departments, social links, reporting lines and the org-chart tree.
const db = require('./db');
const { slugify } = require('./util');

// ---------- Social links ----------
const SOCIAL = [
  { key: 'linkedin', col: 'social_linkedin', label: 'LinkedIn', hosts: ['linkedin.com'], base: 'https://www.linkedin.com/in/', ph: 'https://www.linkedin.com/in/…' },
  { key: 'x', col: 'social_x', label: 'X', hosts: ['x.com', 'twitter.com'], base: 'https://x.com/', ph: '@handle or https://x.com/…' },
  { key: 'facebook', col: 'social_facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com'], base: 'https://www.facebook.com/', ph: 'https://www.facebook.com/…' },
  { key: 'instagram', col: 'social_instagram', label: 'Instagram', hosts: ['instagram.com'], base: 'https://www.instagram.com/', ph: '@handle or https://www.instagram.com/…' },
  { key: 'website', col: 'social_website', label: 'Website', hosts: null, base: null, ph: 'https://…' },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Returns { value } (normalized, possibly '') or { error }. Only http(s) links are accepted, and each network must be on its own domain.
function cleanSocial(def, raw) {
  let v = String(raw ?? '').trim();
  if (!v) return { value: '' };
  if (v.length > 200) return { error: `${def.label}: the link is too long.` };
  if (def.base && (/^@?[A-Za-z0-9_]{1,40}$/.test(v) || /^@[A-Za-z0-9_.]{1,40}$/.test(v))) return { value: def.base + v.replace(/^@/, '') };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
  let u; try { u = new URL(v); } catch { return { error: `${def.label}: enter a full link such as ${def.base || 'https://example.com'}…` }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { error: `${def.label}: only http and https links are allowed.` };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (def.hosts && !def.hosts.some(h => host === h || host.endsWith('.' + h))) return { error: `${def.label}: the link must be on ${def.hosts[0]}.` };
  if (!def.hosts && !host.includes('.')) return { error: `${def.label}: enter a full web address.` };
  u.username = ''; u.password = '';
  return { value: u.href };
}
const cleanEmail = raw => { const v = String(raw ?? '').trim().slice(0, 120); return !v ? { value: '' } : EMAIL_RE.test(v) ? { value: v } : { error: 'Public email: enter a valid address.' }; };
const socialOf = m => [...SOCIAL.filter(d => m[d.col]).map(d => ({ label: d.label, href: m[d.col] })), ...(m.social_email ? [{ label: 'Email', href: 'mailto:' + m.social_email }] : [])];

// ---------- Slugs ----------
function uniqueSlug(table, base, selfId, fallback) {
  const s = slugify(base) || fallback; let c = s, i = 1;
  while (db.find(table, r => r.slug === c && r.id !== (selfId || 0))) c = `${s}-${++i}`;
  return c;
}
// Gives every staff member and department a profile slug (older rows may have none) and seeds the first CEO / department on a brand-new database.
async function ensureSlugs() {
  const b = db.batch();
  for (const m of db.where('staff', r => !r.slug)) b.patch('staff', m.id, { slug: uniqueSlug('staff', m.name, m.id, 'member') });
  for (const d of db.where('departments', r => !r.slug)) b.patch('departments', d.id, { slug: uniqueSlug('departments', d.name, d.id, 'department') });
  await b.commit();
}
async function bootstrap() {
  if (db.count('staff') || db.count('departments') || await db.read('_meta/bootstrapped')) return;
  const dept = await db.insert('departments', { name: 'Executive Office', slug: 'executive-office', description: '', sort: 0 });
  await db.insert('staff', { name: 'Adrian R. Villanueva', slug: 'adrian-r-villanueva', title: 'Chief Executive Officer', department: dept.name, department_id: dept.id, sort: 0 });
  await db.setPath('_meta/bootstrapped', true);
}

// ---------- Departments ----------
const departments = () => db.all('departments').sort((a, b) => a.sort - b.sort || a.id - b.id).map(d => ({ ...d, n: db.count('staff', s => s.department_id === d.id) }));
// The staff.department text field is a denormalized copy of the department name so older code and exports keep working.
async function syncDepartmentNames() {
  const names = new Map(db.all('departments').map(d => [d.id, d.name])), b = db.batch();
  for (const s of db.all('staff')) { const want = names.get(s.department_id) || ''; if (s.department !== want) b.patch('staff', s.id, { department: want }); }
  await b.commit();
}

// ---------- Reporting lines ----------
// True if making `managerId` the manager of `staffId` would create a loop.
function wouldCycle(staffId, managerId) {
  const up = new Map(db.all('staff').map(r => [r.id, r.reports_to]));
  let p = managerId, guard = 0;
  while (p && guard++ < 500) { if (p === staffId) return true; p = up.get(p); }
  return false;
}

// Tree of the people shown on the site. A hidden manager is skipped: their reports attach to the nearest visible manager above.
function orgTree() {
  const all = db.all('staff').sort((a, b) => a.sort - b.sort || a.id - b.id), byId = new Map(all.map(m => [m.id, m]));
  const vis = all.filter(m => m.visible), nodes = new Map(vis.map(m => [m.id, { m, kids: [] }])), roots = [];
  for (const m of vis) {
    let p = m.reports_to, guard = 0;
    while (p && !nodes.has(p) && guard++ < 100) p = byId.get(p)?.reports_to;
    const parent = p && p !== m.id ? nodes.get(p) : null;
    nodes.get(m.id).parent = parent ? parent.m : null;
    (parent || { kids: roots }).kids.push(nodes.get(m.id));
  }
  // Anything unreachable from a root (only possible with a loop in old data) is shown as its own root rather than disappearing.
  const seen = new Set(); (function walk(ns) { ns.forEach(n => { if (!seen.has(n.m.id)) { seen.add(n.m.id); walk(n.kids); } }); })(roots);
  for (const n of nodes.values()) if (!seen.has(n.m.id)) { n.kids = []; n.parent = null; roots.push(n); }
  return { roots, count: vis.length, nodes };
}

module.exports = { SOCIAL, cleanSocial, cleanEmail, socialOf, uniqueSlug, ensureSlugs, bootstrap, departments, syncDepartmentNames, wouldCycle, orgTree };
