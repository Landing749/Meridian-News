// Authentication and permissions in the browser.
//
// Sign-in is Firebase Auth (email + password). What a signed-in person may do is decided by /roles/<uid>, which
// database.rules.json reads on every request, so the checks below only decide what the UI shows. They are not the security boundary.
const db = require('./db');
const { auth: fbAuth, rtdb, config } = require('./firebase');
const identity = require('./identity');
const PROD = true;
const SESSION_MS = Math.min(14 * 24, Math.max(1, Number(config.sessionHours) || 12)) * 3600 * 1000;

// ---- Role-based permissions (UI checks here; the real gate is database.rules.json) ----
const ALL = ['article.create', 'article.edit_own', 'article.edit_any', 'article.submit', 'article.review', 'article.approve', 'article.schedule', 'article.publish',
  'article.archive', 'article.delete', 'taxonomy.categories', 'taxonomy.tags', 'authors.manage', 'media.upload', 'media.manage', 'careers.manage', 'inquiries.manage',
  'users.manage', 'audit.view', 'settings.manage', 'analytics.view', 'calendar.view', 'announcements.manage', 'issues.manage', 'staff.manage', 'homepage.manage', 'newsletter.manage'];
const ROLES = {
  super_admin: { label: 'Super Administrator', perms: ALL },
  administrator: { label: 'Administrator', perms: ALL.filter(p => p !== 'audit.view') },
  managing_editor: { label: 'Managing Editor', perms: ['article.create', 'article.edit_own', 'article.edit_any', 'article.submit', 'article.review', 'article.approve', 'article.schedule', 'article.publish', 'article.archive',
    'taxonomy.categories', 'taxonomy.tags', 'media.upload', 'media.manage', 'analytics.view', 'calendar.view', 'announcements.manage', 'issues.manage', 'homepage.manage', 'newsletter.manage'] },
  editor: { label: 'Editor', perms: ['article.create', 'article.edit_own', 'article.submit', 'article.review', 'taxonomy.tags', 'media.upload', 'calendar.view'] },
  writer: { label: 'Writer', perms: ['article.create', 'article.edit_own', 'article.submit', 'media.upload'] },
  contributor: { label: 'Contributor', perms: ['article.create', 'article.edit_own', 'article.submit'] },
};
const can = (user, perm) => !!user && !!ROLES[user.role] && ROLES[user.role].perms.includes(perm);

// ---- Session state ----
const state = { user: null };
let chain = Promise.resolve();
const queue = fn => (chain = chain.then(fn).catch(e => console.error('auth:', e)));
const settled = () => chain; // the runtime waits for this before it handles a navigation
const userByUid = uid => db.find('users', u => u.uid === uid);
const normalizeId = s => String(s || '').trim().toLowerCase();
const userByLogin = id => { const k = normalizeId(id); return k ? db.find('users', u => String(u.email || '').toLowerCase() === k || String(u.username || '').toLowerCase() === k) : null; };

// Reads /roles/<uid>, opens the private data mirror and resolves the staff member, or null when this account has no active role.
async function loadUser(fbUser) {
  let role = null;
  try { role = (await rtdb.ref('roles/' + fbUser.uid).once('value')).val(); } catch { return null; }
  if (!role || !role.active || !ROLES[role.role]) return null;
  await db.init('private');
  const u = db.get('users', role.user_id);
  if (u && !u.active) return null;
  return u ? { id: u.id, uid: fbUser.uid, email: u.email, username: u.username, name: u.name, role: role.role, author_id: u.author_id }
    : { id: role.user_id, uid: fbUser.uid, email: fbUser.email, username: '', name: fbUser.displayName || fbUser.email, role: role.role, author_id: null };
}
// Called once at start-up: restores a remembered sign-in (if it is recent enough and still has a role) and opens the right data mirror.
function boot() {
  return new Promise(resolve => {
    const off = fbAuth.onAuthStateChanged(async fu => {
      off();
      try {
        let ok = null;
        if (fu) {
          const tok = await fu.getIdTokenResult().catch(() => null), authAt = tok ? Number(tok.claims.auth_time) * 1000 : 0;
          if (authAt && Date.now() - authAt < SESSION_MS) ok = await loadUser(fu);
          if (!ok) await fbAuth.signOut().catch(() => {});
        }
        state.user = ok;
        if (!ok) await db.init('public');
      } catch (e) { console.error('auth boot failed:', e); state.user = null; await db.init('public').catch(() => {}); }
      resolve(state.user);
    });
  });
}

// Checks the password with Firebase Auth. Resolves { user } or { error: 'invalid' | 'disabled' | 'throttled' }.
async function authenticate(identifier, password) {
  const email = normalizeId(identifier);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid' };
  let cred;
  try { cred = await fbAuth.signInWithEmailAndPassword(email, String(password || '')); }
  catch (e) { return { error: e.code === 'auth/user-disabled' ? 'disabled' : e.code === 'auth/too-many-requests' ? 'throttled' : 'invalid' }; }
  const u = await loadUser(cred.user);
  if (!u) { await fbAuth.signOut().catch(() => {}); await db.reinit('public'); return { error: 'invalid' }; }
  state.user = u;
  return { user: u };
}
const createSession = async () => {}; // Firebase keeps the session in the browser
function destroySession() { state.user = null; queue(async () => { await fbAuth.signOut(); await db.reinit('public'); }); }
const revokeSessions = () => Promise.resolve(); // access is re-checked against /roles on every database request
async function loadSession(req, res, next) { req.user = state.user; req.csrf = 'static'; next(); }

const wantsJson = req => req.path.startsWith('/api/') || (req.headers.accept || '').includes('application/json');
function requireLogin(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Your session has ended. Sign in again.' });
  res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}
const requirePerm = perm => (req, res, next) => {
  if (can(req.user, perm)) return next();
  denied(req, res);
};
function denied(req, res) {
  writeAudit({ user_id: req.user?.id ?? null, user_label: req.user?.email ?? null, action: 'access_denied', entity: 'route', detail: req.method + ' ' + req.originalUrl, ip: req.ip });
  if (wantsJson(req)) return res.status(403).json({ error: 'You do not have permission to do this.' });
  res.status(403).send(req.renderDenied ? req.renderDenied() : 'Access denied');
}
// There are no cross-site cookies to forge in a static site: requests come from this page's own code. Kept so route code stays unchanged.
const csrfCheck = (req, res, next) => next();

// ---- Rate limiting (per browser tab; real abuse protection is Firebase's own throttling and the database rules) ----
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  const b = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (b.length >= max) { buckets.set(key, b); return false; }
  b.push(now); buckets.set(key, b); return true;
}
const limiter = (name, max, windowMs) => (req, res, next) => hit(name + ':' + req.ip, max, windowMs) ? next()
  : (wantsJson(req) ? res.status(429).json({ error: 'Too many requests. Try again later.' }) : res.status(429).send('Too many requests. Try again later.'));

const validPw = pw => typeof pw === 'string' && pw.length >= 12 && pw.length <= 128 && /[a-z]/i.test(pw) && /\d/.test(pw);
// Audit entries are fire-and-forget: a logging failure must never break the request that caused it. Signed-out events cannot be stored (rules).
const writeAudit = e => db.push('audit_log', e).catch(err => { if (!/permission/i.test(String(err && err.message))) console.error('audit write failed:', err.message); });
function audit(req, action, entity, entityId, detail) {
  return writeAudit({ user_id: req.user?.id ?? null, user_label: req.user?.email ?? null, action, entity: entity || null, entity_id: entityId != null ? String(entityId) : null, detail: detail || null, ip: req.ip || null });
}
module.exports = { state, boot, settled, writeAudit, ROLES, can, authenticate, createSession, destroySession, revokeSessions, loadSession, requireLogin, requirePerm, csrfCheck, limiter, hit, validPw, audit, denied, userByLogin, userByUid, PROD };
