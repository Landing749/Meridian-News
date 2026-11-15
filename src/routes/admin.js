const express = require('express');
const db = require('../db');
const Q = require('../queries');
const { deliver } = require('../cloud');
const identity = require('../identity');
const A = require('../auth');
const { can, requirePerm, audit } = A;
const U = require('../util');
const { esc, slugify, fmtDate, cleanBody, textOnly, wordCount, readingTime, nowSql } = U;
const V = require('../views/admin');
const { layout, status, csrf, confirmBtn, empty, table, cols, hbars, pager, standalone } = V;
const PUBV = require('../views/public');
const router = express.Router();
router.use((req, res, next) => (req.user ? A.csrfCheck(req, res, next) : next()));

// Manila (UTC+8, no DST) <-> UTC helpers for scheduling inputs
const manilaToSql = s => { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || '')) return null; const d = new Date(s + ':00+08:00'); return isNaN(d) ? null : d.toISOString().slice(0, 19).replace('T', ' '); };
const sqlToManila = s => s ? new Date(new Date(s.replace(' ', 'T') + 'Z').getTime() + 8 * 3600000).toISOString().slice(0, 16) : '';
router.use((req, res, next) => { req.renderDenied = () => standalone('Access denied', '<h1>Access denied</h1><p>Your role does not allow this action.</p><p><a class="btn" href="/admin/dashboard">Back to dashboard</a></p>'); next(); });

// ---------- Sign in / out / reset ----------
const loginForm = (req, o = {}) => standalone('Sign in', `<h1>Newsroom sign in</h1>${o.err ? `<div class="notice bad" role="alert">${esc(o.err)}</div>` : ''}${o.info ? `<div class="notice ok" role="status">${esc(o.info)}</div>` : ''}
<form method="post" action="/admin/login" novalidate><input type="hidden" name="next" value="${esc(req.query.next || req.body?.next || '')}">
<div class="field"><label for="id">Email</label><input id="id" name="id" type="email" autocomplete="username" required autofocus value="${esc(o.id || '')}"></div>
<div class="field"><label for="pw">Password</label><div class="pw"><input id="pw" name="password" type="password" autocomplete="current-password" required><button type="button" class="btn paper-btn small" data-toggle-pw="pw" aria-pressed="false">Show</button></div></div>
<button class="btn" type="submit" style="width:100%;justify-content:center">Sign in</button></form><p style="margin:1rem 0 0"><a href="/admin/forgot">Forgot your password?</a></p>`);
router.get('/login', (req, res) => req.user ? res.redirect('/admin/dashboard') : res.send(loginForm(req, { info: req.query.ok })));
router.post('/login', async (req, res) => {
  const id = String(req.body.id || '').trim().slice(0, 200), pw = String(req.body.password || '').slice(0, 200);
  if (!A.hit('login-ip:' + req.ip, 20, 900000) || !A.hit('login-id:' + id.toLowerCase(), 6, 900000)) return res.status(429).send(loginForm(req, { err: 'Too many sign-in attempts. Wait 15 minutes and try again.', id }));
  const r = await A.authenticate(id, pw);
  if (r.error) {
    A.writeAudit({ user_label: id.slice(0, 120), action: 'login_failed', entity: 'user', ip: req.ip });
    if (r.error === 'throttled') return res.status(429).send(loginForm(req, { err: 'Too many sign-in attempts. Wait a few minutes and try again.', id }));
    return res.status(401).send(loginForm(req, { err: 'Those details do not match an active account.', id }));
  }
  const u = r.user;
  await db.update('users', u.id, { last_login: nowSql() });
  await A.createSession(res, r.idToken);
  A.writeAudit({ user_id: u.id, user_label: u.email, action: 'login', entity: 'user', ip: req.ip });
  const next = String(req.body.next || '');
  res.redirect(/^\/admin\/[A-Za-z0-9\-_\/?=&%.]*$/.test(next) && !next.startsWith('//') ? next : '/admin/dashboard');
});
router.post('/logout', (req, res) => { if (req.user) audit(req, 'logout', 'user', req.user.id); A.destroySession(req, res); res.redirect('/admin/login?ok=' + encodeURIComponent('You have signed out.')); });
router.get('/forgot', (req, res) => res.send(standalone('Reset password', `<h1>Reset your password</h1><form method="post" action="/admin/forgot"><div class="field"><label for="e">Account email</label><input id="e" name="email" type="email" required autofocus></div><button class="btn" type="submit">Email me a reset link</button></form><p><a href="/admin/login">Back to sign in</a></p>`)));
router.post('/forgot', A.limiter('forgot', 5, 3600000), async (req, res) => {
  const email = String(req.body.email || '').trim();
  // Firebase Auth emails the link. Failures are logged but never revealed, so the page cannot be used to discover which emails have accounts.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) await identity.sendPasswordReset(email).catch(e => console.error('[password-reset] could not send:', e.message));
  res.send(standalone('Reset password', `<h1>Request received</h1><div class="notice info">If an active account uses that email, a reset link is on its way. Check your inbox and spam folder.</div><p><a href="/admin/login">Back to sign in</a></p>`));
});
// The reset email links here when its action URL is set to /admin/reset in Firebase Console (Authentication > Templates > Password reset).
const resetForm = (req, err) => standalone('Choose a new password', `<h1>Choose a new password</h1>${err ? `<div class="notice bad" role="alert">${esc(err)}</div>` : ''}<form method="post" action="/admin/reset"><input type="hidden" name="oobCode" value="${esc(req.body?.oobCode || req.query.oobCode || '')}"><div class="field"><label for="p1">New password</label><input id="p1" name="password" type="password" autocomplete="new-password" required><div class="help">At least 12 characters, with letters and numbers.</div></div><div class="field"><label for="p2">Repeat password</label><input id="p2" name="confirm" type="password" autocomplete="new-password" required></div><button class="btn" type="submit">Save password</button></form>`);
const expired = () => standalone('Link expired', '<h1>Link expired</h1><p>This reset link is invalid or has expired.</p><p><a href="/admin/forgot">Request a new one</a></p>');
router.get('/reset', async (req, res) => {
  const code = String(req.query.oobCode || '');
  if (!code) return res.status(400).send(expired());
  try { await identity.resetEmailFor(code); } catch { return res.status(400).send(expired()); }
  res.send(resetForm(req));
});
router.post('/reset', A.limiter('reset', 10, 3600000), async (req, res) => {
  const code = String(req.body.oobCode || '');
  if (req.body.password !== req.body.confirm) return res.status(400).send(resetForm(req, 'The two passwords do not match.'));
  if (!A.validPw(req.body.password)) return res.status(400).send(resetForm(req, 'Use at least 12 characters with letters and numbers.'));
  let email;
  try { email = (await identity.confirmReset(code, req.body.password)).email; } catch { return res.status(400).send(expired()); }
  const u = A.userByLogin(email);
  if (u) { await A.revokeSessions(u.uid); A.writeAudit({ user_id: u.id, user_label: u.email, action: 'password_reset_completed', entity: 'user', ip: req.ip }); }
  res.redirect('/admin/login?ok=' + encodeURIComponent('Password changed. Sign in with the new password.'));
});
router.use(A.requireLogin);

// ---------- Article access rules ----------
const getArticle = id => db.get('articles', +id);
const isMine = (u, a) => a.created_by === u.id || a.assigned_to === u.id;
const canView = (u, a) => can(u, 'article.edit_any') || can(u, 'article.review') || isMine(u, a);
function canEdit(u, a) {
  if (can(u, 'article.edit_any')) return true;
  if (a.created_by === u.id && can(u, 'article.edit_own') && a.status === 'draft') return true;
  if (a.assigned_to === u.id && u.role === 'editor' && ['draft', 'pending_review', 'approved'].includes(a.status)) return true;
  return false;
}
function actionsFor(u, a) {
  const out = [], s = a.status, mine = isMine(u, a);
  if (s === 'draft' && can(u, 'article.submit') && (mine || can(u, 'article.edit_any'))) out.push(['submit', 'Submit for review']);
  if (['pending_review', 'approved'].includes(s) && can(u, 'article.review')) out.push(['request_revisions', 'Request revisions']);
  if (s === 'pending_review' && can(u, 'article.approve')) out.push(['approve', 'Approve']);
  if (['approved', 'scheduled'].includes(s) && can(u, 'article.schedule')) out.push(['schedule', s === 'scheduled' ? 'Reschedule' : 'Schedule']);
  if (['approved', 'scheduled'].includes(s) && can(u, 'article.publish')) out.push(['publish', 'Publish now']);
  if (s === 'scheduled' && can(u, 'article.schedule')) out.push(['unschedule', 'Cancel schedule']);
  if (s === 'published' && can(u, 'article.publish')) out.push(['unpublish', 'Unpublish']);
  if (s !== 'archived' && can(u, 'article.archive')) out.push(['archive', 'Archive']);
  if (s === 'archived' && can(u, 'article.archive')) out.push(['restore', 'Restore to draft']);
  return out;
}
const uniqueSlug = (base, id) => { let s = slugify(base) || 'untitled', n = 1, c = s; while (db.find('articles', x => x.slug === c && x.id !== (id || 0))) c = `${s}-${++n}`; return c; };
const snapshot = (a, userId, note) => db.append(`revisions/${a.id}`, { user_id: userId, title: a.title, subtitle: a.subtitle, excerpt: a.excerpt, body: a.body, note: note || '' }, 'revisions');
const event = (id, userId, kind, body) => db.append('editorial_events', { article_id: id, user_id: userId, kind, body: body || '' }, 'editorial_events');
const userName = id => db.get('users', id)?.name || null;
const byDateDesc = f => (x, y) => (y[f] || '') < (x[f] || '') ? -1 : (y[f] || '') > (x[f] || '') ? 1 : y.id - x.id;
const inScope = u => (can(u, 'article.edit_any') || can(u, 'article.review') ? () => true : a => a.created_by === u.id || a.assigned_to === u.id);

// ---------- Dashboard ----------
router.get('/dashboard', async (req, res) => {
  const mine = db.where('articles', inScope(req.user)), cnt = s => (s ? mine.filter(a => a.status === s).length : mine.length);
  const stat = (l, n, href) => `<a class="paper-flat stat" href="${href}"><b>${n}</b><span>${l}</span></a>`;
  const views = mine.reduce((n, a) => n + (a.views || 0), 0);
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10));
  const allViews = (await db.read('article_views')) || {}, vmap = {}, ids = new Set(mine.map(a => a.id));
  for (const [aid, perDay] of Object.entries(allViews)) if (ids.has(+aid)) for (const [d, n] of Object.entries(perDay)) if (d >= days[0]) vmap[d] = (vmap[d] || 0) + n;
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
  const pmap = {}; for (const a of mine) if (a.status === 'published' && a.published_at) { const m = a.published_at.slice(0, 7); pmap[m] = (pmap[m] || 0) + 1; }
  const catCount = new Map(); for (const a of mine) catCount.set(a.category_id || 0, (catCount.get(a.category_id || 0) || 0) + 1);
  const cat = [...catCount].map(([id, v]) => ({ label: db.get('categories', id)?.name || 'Uncategorized', v })).sort((x, y) => y.v - x.v).slice(0, 8);
  const pubs = mine.filter(a => a.status === 'published');
  const top = [...pubs].sort((x, y) => y.views - x.views || y.id - x.id).slice(0, 5).map(a => ({ id: a.id, label: a.title, v: a.views }));
  const recent = [...pubs].sort(byDateDesc('published_at')).slice(0, 5);
  const act = (await db.list('editorial_events', 300)).reverse().map(e => ({ ...e, article_id: +e.article_id })).filter(e => ids.has(e.article_id)).slice(0, 8).map(e => ({ ...e, title: db.get('articles', e.article_id).title, uname: userName(e.user_id) }));
  const body = `<div class="grid g4">${stat('Total articles', cnt(), '/admin/articles')}${stat('Published', cnt('published'), '/admin/articles?status=published')}${stat('Drafts', cnt('draft'), '/admin/articles?status=draft')}${stat('Scheduled', cnt('scheduled'), '/admin/articles?status=scheduled')}${stat('Pending review', cnt('pending_review'), '/admin/articles?status=pending_review')}${stat('Archived', cnt('archived'), '/admin/articles?status=archived')}${stat('Total views', views, '#views')}</div>
<div class="grid g2" style="margin-top:1.2rem"><section class="paper panel"><h2>Articles published per month</h2>${cols(months.map(m => ({ label: m, short: m.slice(5), v: pmap[m] || 0 })))}</section>
<section class="paper panel" id="views"><h2>Article views, last 30 days</h2>${cols(days.map(d => ({ label: d, short: d.slice(8), v: vmap[d] || 0 })))}<p class="muted">Server-counted page loads, not unique visitors.</p></section>
<section class="paper panel"><h2>Articles by category</h2>${cat.length ? hbars(cat) : '<p class="muted">No articles yet.</p>'}</section>
<section class="paper panel"><h2>Top-performing articles</h2>${top.length ? hbars(top.map(t => ({ ...t, label: t.label || 'Untitled' }))) : '<p class="muted">Published articles will appear here.</p>'}</section>
<section class="paper panel"><h2>Recently published</h2>${recent.length ? `<ul class="timeline-ev">${recent.map(r => `<li><a href="/admin/articles/${r.id}/edit">${esc(r.title)}</a><br><span class="muted">${fmtDate(r.published_at)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing published yet.</p>'}</section>
<section class="paper panel"><h2>Recent editorial activity</h2>${act.length ? `<ul class="timeline-ev">${act.map(e => `<li class="${e.kind}"><b>${esc(e.uname || 'System')}</b> ${esc(e.kind.replace('_', ' '))}: <a href="/admin/articles/${e.article_id}/edit">${esc(e.title)}</a><br><span class="muted">${fmtDate(e.created_at, true)}</span></li>`).join('')}</ul>` : '<p class="muted">No activity yet.</p>'}</section></div>`;
  res.send(layout(req, { title: 'Dashboard', body }));
});

// ---------- Article list ----------
router.get('/articles', (req, res) => {
  const st = req.query.status, s = String(req.query.q || '').trim(), sl = s.toLowerCase();
  let rows = db.where('articles', inScope(req.user));
  if (['draft', 'pending_review', 'approved', 'scheduled', 'published', 'archived'].includes(st)) rows = rows.filter(a => a.status === st);
  if (+req.query.category) rows = rows.filter(a => a.category_id === +req.query.category);
  if (s) rows = rows.filter(a => [a.title, a.excerpt].some(f => String(f || '').toLowerCase().includes(sl)));
  rows.sort(byDateDesc('updated_at'));
  const page = Math.max(1, +req.query.page || 1), per = 20, total = rows.length;
  rows = rows.slice((page - 1) * per, page * per).map(a => ({ ...a, cat: db.get('categories', a.category_id)?.name || null, author: db.get('authors', a.author_id)?.name || null }));
  const cats = db.all('categories').sort((x, y) => x.position - y.position || x.name.localeCompare(y.name));
  const base = '/admin/articles?' + new URLSearchParams({ ...(st ? { status: st } : {}), ...(s ? { q: s } : {}), ...(+req.query.category ? { category: req.query.category } : {}) });
  const body = `<form class="toolbar" method="get" action="/admin/articles" role="search"><div class="field"><label for="q">Search titles</label><input id="q" type="search" name="q" value="${esc(s)}"></div>
<div class="field"><label for="st">Status</label><select id="st" name="status"><option value="">All statuses</option>${['draft', 'pending_review', 'approved', 'scheduled', 'published', 'archived'].map(x => `<option value="${x}"${st === x ? ' selected' : ''}>${x.replace('_', ' ')}</option>`).join('')}</select></div>
<div class="field"><label for="cat">Category</label><select id="cat" name="category"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}"${+req.query.category === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><button class="btn" type="submit">Filter</button></form>
${can(req.user, 'article.create') ? `<form method="post" action="/admin/articles/new" style="margin-bottom:1rem">${csrf(req)}<button class="btn" type="submit">New article</button></form>` : ''}
${rows.length ? table(['Title', 'Status', 'Category', 'Author', 'Updated', 'Actions'], rows.map(a => `<tr><td><a href="/admin/articles/${a.id}/edit">${esc(a.title || 'Untitled article')}</a> ${a.is_sample ? '<span class="badge sample">Sample</span>' : ''}${a.is_announcement ? ' <span class="badge">Announcement</span>' : ''}</td><td>${status(a.status)}</td><td>${esc(a.cat || '—')}</td><td>${esc(a.author || '—')}</td><td>${fmtDate(a.updated_at)}</td>
<td><div class="row-actions"><a class="btn paper-btn small" href="/admin/articles/${a.id}/${canEdit(req.user, a) ? 'edit' : 'preview'}">${canEdit(req.user, a) ? 'Edit' : 'View'}</a>${can(req.user, 'article.delete') ? confirmBtn(req, `/admin/articles/${a.id}/delete`, 'Delete', `Delete “${a.title || 'Untitled article'}” permanently, including its revisions and comments? This cannot be undone.`) : ''}</div></td></tr>`), 'Articles') + pager(page, Math.ceil(total / per), base) : empty('No articles match', 'Change the filters or create a new article.')}`;
  res.send(layout(req, { title: st ? ({ pending_review: 'Pending Reviews', scheduled: 'Scheduled Articles', published: 'Published Articles', draft: 'Drafts', archived: 'Archived Articles', approved: 'Approved Articles' })[st] : 'Articles', body }));
});
router.post('/articles/new', requirePerm('article.create'), async (req, res) => {
  const id = await db.nextId('articles');
  await db.batch().set('articles', id, { title: '', slug: 'untitled-' + id, created_by: req.user.id, author_id: req.user.author_id || null, status: 'draft' }).commit();
  audit(req, 'article_created', 'article', id);
  res.redirect(`/admin/articles/${id}/edit`);
});
router.post('/articles/:id/delete', requirePerm('article.delete'), async (req, res) => {
  const a = getArticle(req.params.id); if (!a) return res.redirect('/admin/articles?err=' + encodeURIComponent('Article not found.'));
  await db.remove('articles', a.id); audit(req, 'article_deleted', 'article', a.id, a.title);
  res.redirect('/admin/articles?ok=' + encodeURIComponent('Article deleted.'));
});

// ---------- Editor ----------
router.get('/articles/:id/edit', async (req, res) => {
  const a = getArticle(req.params.id);
  if (!a || !canView(req.user, a)) return A.denied(req, res);
  if (!canEdit(req.user, a)) return res.redirect(`/admin/articles/${a.id}/preview`);
  const u = req.user, cats = db.where('categories', c => c.active === 1 || c.id === (a.category_id || 0)).sort((x, y) => x.position - y.position || x.name.localeCompare(y.name)), authors = db.all('authors').sort((x, y) => x.name.localeCompare(y.name));
  const tags = Q.tagsFor(a.id).map(t => t.name);
  const allTags = db.all('tags').sort((x, y) => x.name.localeCompare(y.name)), media = a.featured_media_id ? db.get('media', a.featured_media_id) : null;
  const editors = db.where('users', x => x.active === 1 && ['editor', 'managing_editor', 'administrator', 'super_admin'].includes(x.role)).sort((x, y) => x.name.localeCompare(y.name));
  const ev = (await db.listBy('editorial_events', 'article_id', a.id)).sort((x, y) => y.id - x.id).slice(0, 30).map(e => ({ ...e, uname: userName(e.user_id) }));
  const acts = actionsFor(u, a), tagCan = can(u, 'taxonomy.tags');
  const opt = (v, l, cur) => `<option value="${v}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
  const body = `<div id="app" data-id="${a.id}" data-can-tags="${tagCan ? 1 : 0}" data-status="${a.status}">
<div class="ed"><div><div class="paper ed-main"><label class="sr" for="f-title">Article title</label><textarea class="ed-title autosize" id="f-title" data-f="title" placeholder="Article title" rows="1" maxlength="200">${esc(a.title)}</textarea>
<label class="sr" for="f-sub">Subtitle</label><textarea class="ed-sub autosize" id="f-sub" data-f="subtitle" placeholder="Subtitle" rows="1" maxlength="300">${esc(a.subtitle)}</textarea>
<div class="tb" role="toolbar" aria-label="Formatting">
<button type="button" data-cmd="formatBlock:p" title="Paragraph">¶</button><button type="button" data-cmd="formatBlock:h1" title="Heading 1">H1</button><button type="button" data-cmd="formatBlock:h2" title="Heading 2">H2</button><button type="button" data-cmd="formatBlock:h3" title="Heading 3">H3</button><span class="sep"></span>
<button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button><button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button><button type="button" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button><button type="button" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button><span class="sep"></span>
<button type="button" data-cmd="formatBlock:blockquote" title="Blockquote">“ ”</button><button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button><button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button><span class="sep"></span>
<button type="button" data-act="link" title="Insert link">Link</button><button type="button" data-act="image" title="Insert image from library">Image</button><button type="button" data-act="video" title="Embed video">Video</button><button type="button" data-act="table" title="Insert table">Table</button><button type="button" data-cmd="insertHorizontalRule" title="Divider">―</button><span class="sep"></span>
<button type="button" data-cmd="undo" title="Undo">Undo</button><button type="button" data-cmd="redo" title="Redo">Redo</button><span class="sep"></span><button type="button" data-act="fullscreen" aria-pressed="false">Full screen</button><button type="button" data-act="preview">Preview</button></div>
<div class="surface" id="surface" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Article body">${a.body || '<p><br></p>'}</div>
<div class="stats-bar"><span id="wc">0 words</span><span id="cc">0 characters</span><span id="rt">1 min read</span><span class="savestate" id="savestate" data-s="saved" role="status">Saved</span><button class="btn small" type="button" id="save-now">Save now</button></div></div></div>
<div class="ed-side">
<section class="paper panel"><h2>Status: ${status(a.status)}</h2>${acts.length ? `<div class="field"><label for="wf-note">Note for the record ${acts.some(x => x[0] === 'request_revisions') ? '(required when requesting revisions)' : ''}</label><textarea id="wf-note" rows="3" maxlength="2000"></textarea></div>${acts.some(x => x[0] === 'schedule') ? `<div class="field"><label for="wf-when">Publish at (Manila time)</label><input type="datetime-local" id="wf-when" value="${sqlToManila(a.scheduled_at)}"></div>` : ''}<div class="row-actions">${acts.map(([k, l]) => `<button class="btn small ${['unpublish', 'archive', 'request_revisions'].includes(k) ? 'danger' : ''}" type="button" data-wf="${k}">${l}</button>`).join('')}</div>` : '<p class="muted">No workflow actions are available to you for this status.</p>'}<p id="wf-msg" class="err" role="alert"></p></section>
<section class="paper panel"><h2>Details</h2>
<div class="field"><label for="f-excerpt">Summary / excerpt</label><textarea id="f-excerpt" data-f="excerpt" rows="3" maxlength="500">${esc(a.excerpt)}</textarea></div>
<div class="field"><label for="f-cat">Category</label><select id="f-cat" data-f="category_id"><option value="">Choose a category</option>${cats.map(c => opt(c.id, c.name, a.category_id)).join('')}</select></div>
<div class="field"><label for="f-author">Author</label><select id="f-author" data-f="author_id"><option value="">Choose an author</option>${authors.map(c => opt(c.id, c.name, a.author_id)).join('')}</select></div>
<div class="field"><label for="f-tags">Tags (comma separated)</label><input id="f-tags" data-f="tags" list="taglist" value="${esc(tags.join(', '))}">${tagCan ? '' : '<div class="help">You can use existing tags only.</div>'}<datalist id="taglist">${allTags.map(t => `<option value="${esc(t.name)}">`).join('')}</datalist></div>
<div class="field"><label for="f-slug">URL slug</label><input id="f-slug" data-f="slug" value="${esc(a.slug)}" maxlength="90"></div>
${can(u, 'article.review') || can(u, 'article.edit_any') ? `<div class="field"><label for="f-assign">Assigned editor</label><select id="f-assign" data-f="assigned_to"><option value="">Unassigned</option>${editors.map(c => opt(c.id, c.name, a.assigned_to)).join('')}</select></div><div class="field"><label for="f-dl">Draft deadline</label><input id="f-dl" type="date" data-f="deadline" value="${esc((a.deadline || '').slice(0, 10))}"></div>` : ''}
${can(u, 'article.approve') ? `<div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" data-f="is_featured"${a.is_featured ? ' checked' : ''}> Feature on homepage (replaces the current featured article)</label></div>` : ''}
${can(u, 'announcements.manage') ? `<div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" data-f="is_announcement"${a.is_announcement ? ' checked' : ''}> Corporate announcement</label><label style="display:flex;gap:.5rem;font-weight:500;margin-top:.4rem"><input type="checkbox" data-f="is_important"${a.is_important ? ' checked' : ''}> Mark as important</label></div>` : ''}</section>
<section class="paper panel"><h2>Cover photo</h2><div id="feat-prev">${media ? `<img src="${esc(deliver(media.url, 600))}" alt="${esc(media.alt)}" style="max-width:100%;border-radius:3px">` : '<p class="muted">No image selected.</p>'}</div><input type="hidden" data-f="featured_media_id" id="f-media" value="${a.featured_media_id || ''}">
<div class="row-actions" style="margin:.6rem 0"><button class="btn paper-btn small" type="button" data-act="upload-cover">Upload photo</button><button class="btn paper-btn small" type="button" data-act="featured">Choose from library</button><button class="btn paper-btn small" type="button" data-act="clear-featured">Remove</button></div><input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden><div class="help" id="cover-msg" role="status">JPG, PNG, WebP or GIF, up to 5 MB. A wide photo (16:9) crops best on the homepage and article page.</div>
<div class="field"><label for="f-cap">Photo caption</label><input id="f-cap" data-f="image_caption" value="${esc(a.image_caption)}" maxlength="300"></div><div class="field"><label for="f-cred">Photo credit</label><input id="f-cred" data-f="image_credit" value="${esc(a.image_credit)}" maxlength="200"></div></section>
<section class="paper panel"><h2>Search appearance</h2><div class="field"><label for="f-seot">SEO title</label><input id="f-seot" data-f="seo_title" value="${esc(a.seo_title)}" maxlength="70"></div><div class="field"><label for="f-seod">SEO description</label><textarea id="f-seod" data-f="seo_description" rows="3" maxlength="170">${esc(a.seo_description)}</textarea></div></section>
<section class="paper panel"><h2>Editorial history</h2>${can(u, 'article.review') || can(u, 'article.edit_any') ? `<div class="field"><label for="cm">Add a comment</label><textarea id="cm" rows="2" maxlength="2000"></textarea></div><button class="btn paper-btn small" type="button" id="cm-add">Post comment</button>` : ''}
<ul class="timeline-ev" style="margin-top:1rem">${ev.map(e => `<li class="${e.kind}"><b>${esc(e.uname || 'System')}</b> · ${esc(e.kind.replace('_', ' '))}<br>${esc(e.body)}<br><span class="muted">${fmtDate(e.created_at, true)}</span></li>`).join('') || '<li>No history yet.</li>'}</ul>
<p><a href="/admin/articles/${a.id}/revisions">Revision history</a></p></section></div></div>
<dialog id="picker" class="picker" aria-labelledby="pk-t"><div class="paper"><h2 id="pk-t">Media library</h2><div class="toolbar"><div class="field"><label for="pk-q">Search</label><input id="pk-q" type="search"></div><button class="btn paper-btn small" type="button" id="pk-close">Close</button></div><div class="pgrid" id="pk-grid"></div><p class="muted">Upload new images in the <a href="/admin/media" target="_blank">Media Library</a>.</p></div></dialog></div>`;
  res.send(layout(req, { title: a.title || 'Untitled article', body, scripts: ['/js/editor.js'] }));
});

function validateForPublish(a) {
  const e = [];
  if (!a.title.trim()) e.push('a title'); if (!a.category_id) e.push('a category'); if (!a.author_id) e.push('an author'); if (!textOnly(a.body)) e.push('article body text');
  return e.length ? 'Before this can move forward it needs ' + e.join(', ') + '.' : null;
}
router.put('/api/articles/:id', express.json({ limit: '3mb' }), async (req, res) => {
  const a = getArticle(req.params.id), u = req.user;
  if (!a || !canView(u, a)) return res.status(404).json({ error: 'Article not found.' });
  if (!canEdit(u, a)) return res.status(403).json({ error: 'You cannot edit this article in its current status.' });
  const b = req.body || {}, S = (v, n) => String(v ?? '').slice(0, n);
  const next = { ...a, title: S(b.title, 200).trim(), subtitle: S(b.subtitle, 300).trim(), excerpt: S(b.excerpt, 500).trim(), body: cleanBody(S(b.body, 2000000)), image_caption: S(b.image_caption, 300), image_credit: S(b.image_credit, 200),
    seo_title: S(b.seo_title, 70), seo_description: S(b.seo_description, 170) };
  next.category_id = b.category_id && db.get('categories', +b.category_id) ? +b.category_id : null;
  next.author_id = b.author_id && db.get('authors', +b.author_id) ? +b.author_id : null;
  next.featured_media_id = b.featured_media_id && db.get('media', +b.featured_media_id) ? +b.featured_media_id : null;
  if (can(u, 'article.review') || can(u, 'article.edit_any')) { next.assigned_to = b.assigned_to && db.find('users', x => x.id === +b.assigned_to && x.active === 1) ? +b.assigned_to : null; next.deadline = /^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '') ? b.deadline : null; }
  if (can(u, 'article.approve')) next.is_featured = b.is_featured ? 1 : 0;
  if (can(u, 'announcements.manage')) { next.is_announcement = b.is_announcement ? 1 : 0; next.is_important = b.is_important ? 1 : 0; }
  const wantSlug = slugify(b.slug || next.title);
  next.slug = wantSlug && wantSlug !== a.slug ? uniqueSlug(wantSlug, a.id) : a.slug;
  if (/^(untitled|draft)-/.test(a.slug) && !b.slug && next.title) next.slug = uniqueSlug(next.title, a.id);
  const batch = db.batch();
  batch.patch('articles', a.id, { title: next.title, subtitle: next.subtitle, excerpt: next.excerpt, body: next.body, image_caption: next.image_caption, image_credit: next.image_credit, seo_title: next.seo_title, seo_description: next.seo_description,
    category_id: next.category_id, author_id: next.author_id, featured_media_id: next.featured_media_id, assigned_to: next.assigned_to, deadline: next.deadline, is_featured: next.is_featured, is_announcement: next.is_announcement, is_important: next.is_important, slug: next.slug, updated_at: nowSql() });
  if (next.is_featured) for (const o of db.where('articles', x => x.is_featured === 1 && x.id !== a.id)) batch.patch('articles', o.id, { is_featured: 0 });
  if (typeof b.tags === 'string') {
    const names = [...new Set(b.tags.split(',').map(t => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20), ids = [];
    for (const n of names) {
      let t = db.find('tags', x => x.name.toLowerCase() === n.toLowerCase());
      if (!t && can(u, 'taxonomy.tags')) { const sl = slugify(n) || 'tag'; let c = sl, i = 1; while (db.find('tags', x => x.slug === c)) c = `${sl}-${++i}`; t = await db.insert('tags', { name: n, slug: c }); }
      if (t) ids.push(t.id);
    }
    for (const r of db.where('article_tags', r => r.article_id === a.id)) batch.del('article_tags', r.id);
    for (const t of ids) batch.set('article_tags', `${a.id}_${t}`, { article_id: a.id, tag_id: t });
  }
  await batch.commit();
  const [last] = await db.list(`revisions/${a.id}`, 1);
  const stale = !last || last.user_id !== u.id || Date.now() - new Date(last.created_at.replace(' ', 'T') + 'Z') > 600000;
  if ((b.manual || stale) && (!last || last.body !== next.body || b.manual)) await snapshot(next, u.id, b.manual ? 'Manual save' : 'Autosave checkpoint');
  const fresh = getArticle(a.id);
  res.json({ ok: true, savedAt: fresh.updated_at, slug: fresh.slug, words: wordCount(fresh.body) });
});
const KIND = { submit: 'submitted', request_revisions: 'revision_requested', approve: 'approved', schedule: 'scheduled', publish: 'published', unpublish: 'unpublished', unschedule: 'unpublished', archive: 'archived', restore: 'restored' };
router.post('/api/articles/:id/transition', express.json(), async (req, res) => {
  const a = getArticle(req.params.id), u = req.user, act = String(req.body.action || ''), note = String(req.body.note || '').slice(0, 2000).trim();
  if (!a || !canView(u, a)) return res.status(404).json({ error: 'Article not found.' });
  if (!actionsFor(u, a).some(x => x[0] === act)) return A.denied(req, res);
  if (['submit', 'approve', 'schedule', 'publish'].includes(act)) { const e = validateForPublish(a); if (e) return res.status(422).json({ error: e }); }
  if (act === 'request_revisions' && !note) return res.status(422).json({ error: 'Explain what needs to change before requesting revisions.' });
  let when = null;
  if (act === 'schedule') { when = manilaToSql(req.body.when); if (!when || when <= nowSql()) return res.status(422).json({ error: 'Choose a publication date and time in the future.' }); }
  const to = { submit: 'pending_review', request_revisions: 'draft', approve: 'approved', schedule: 'scheduled', publish: 'published', unpublish: 'draft', unschedule: 'approved', archive: 'archived', restore: 'draft' }[act];
  const patch = { status: to, updated_at: nowSql() };
  if (act === 'publish') Object.assign(patch, { published_at: nowSql(), scheduled_at: null });
  if (act === 'schedule') Object.assign(patch, { scheduled_at: when, published_at: when });
  if (act === 'unschedule') Object.assign(patch, { scheduled_at: null, published_at: null });
  if (act === 'unpublish') patch.published_at = null;
  await db.update('articles', a.id, patch);
  await event(a.id, u.id, KIND[act], note || (act === 'schedule' ? 'Scheduled for ' + when + ' UTC' : ''));
  if (['submit', 'publish', 'approve'].includes(act)) await snapshot(getArticle(a.id), u.id, `Status: ${a.status} → ${to}`);
  audit(req, 'article_' + act, 'article', a.id, `${a.status} -> ${to}`);
  res.json({ ok: true, status: to });
});
router.post('/api/articles/:id/comments', express.json(), async (req, res) => {
  const a = getArticle(req.params.id), body = String(req.body.body || '').trim().slice(0, 2000);
  if (!a || !canView(req.user, a)) return res.status(404).json({ error: 'Article not found.' });
  if (!(can(req.user, 'article.review') || can(req.user, 'article.edit_any'))) return A.denied(req, res);
  if (!body) return res.status(422).json({ error: 'Write a comment first.' });
  await event(a.id, req.user.id, 'comment', body); res.json({ ok: true });
});
router.post('/articles/:id/reschedule', requirePerm('article.schedule'), async (req, res) => {
  const a = getArticle(req.params.id), when = manilaToSql(req.body.when);
  if (!a || a.status !== 'scheduled') return res.redirect('/admin/calendar?err=' + encodeURIComponent('Only scheduled articles can be rescheduled.'));
  if (!when || when <= nowSql()) return res.redirect(String(req.body.back || '/admin/calendar') + (String(req.body.back || '').includes('?') ? '&' : '?') + 'err=' + encodeURIComponent('Choose a future date and time.'));
  await db.update('articles', a.id, { scheduled_at: when, published_at: when, updated_at: nowSql() });
  await event(a.id, req.user.id, 'scheduled', 'Rescheduled to ' + when + ' UTC'); audit(req, 'article_rescheduled', 'article', a.id, when);
  res.redirect(String(req.body.back || '/admin/calendar').replace(/^(?!\/admin)/, '/admin/calendar') + (String(req.body.back || '').includes('?') ? '&' : '?') + 'ok=' + encodeURIComponent('Article rescheduled.'));
});

// ---------- Preview ----------
router.get('/articles/:id/preview', (req, res) => {
  const a = getArticle(req.params.id);
  if (!a || !canView(req.user, a)) return A.denied(req, res);
  const row = Q.view(a);
  const body = `<div class="notice info" style="margin:0;border-radius:0;text-align:center;position:sticky;top:0;z-index:50">Preview only. Status: <b>${esc(a.status.replace('_', ' '))}</b>. This page is not public unless the article is published. <a href="/admin/articles/${a.id}/edit">Back to editor</a></div>` + require('./public').articleBody(req, { ...row, published_at: row.published_at || a.created_at }, true);
  res.send(PUBV.layout(req, { title: 'Preview: ' + (a.title || 'Untitled'), noindex: true, body, nav: '/articles' }));
});

// ---------- Revisions ----------
const blocks = h => (h || '').replace(/<\/(p|h[1-6]|li|blockquote|tr|figure)>/gi, '$&\n').split('\n').map(s => textOnly(s)).filter(Boolean);
function diff(a, b) {
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out.push(['=', a[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', a[i++]]); else out.push(['+', b[j++]]); }
  while (i < n) out.push(['-', a[i++]]); while (j < m) out.push(['+', b[j++]]); return out;
}
router.get('/articles/:id/revisions', async (req, res) => {
  const a = getArticle(req.params.id);
  if (!a || !canView(req.user, a)) return A.denied(req, res);
  const revs = (await db.list(`revisions/${a.id}`, 100)).reverse().map(r => ({ ...r, uname: userName(r.user_id) }));
  const sel = +req.query.rev ? await db.read(`revisions/${a.id}/${+req.query.rev}`) : null;
  const d = sel ? diff(blocks(`<h1>${esc(sel.title)}</h1>` + sel.body), blocks(`<h1>${esc(a.title)}</h1>` + a.body)) : null;
  const body = `<p><a href="/admin/articles/${a.id}/edit">← Back to the article</a></p><div class="grid g2"><section class="paper panel"><h2>Revisions</h2>${revs.length ? `<ul class="timeline-ev">${revs.map(r => `<li><b>${fmtDate(r.created_at, true)}</b> · ${esc(r.uname || 'System')}<br>${esc(r.note || 'Saved')}<br><a href="?rev=${r.id}">Compare with current</a>${can(req.user, 'article.edit_any') ? ' ' + confirmBtn(req, `/admin/articles/${a.id}/revisions/${r.id}/restore`, 'Restore', 'Replace the current title and body with this version? The current version is kept in the history.', 'paper-btn small') : ''}</li>`).join('')}</ul>` : '<p class="muted">No revisions yet. They are created on manual saves, status changes and periodic autosave checkpoints.</p>'}</section>
<section class="paper panel"><h2>${sel ? `Revision of ${fmtDate(sel.created_at, true)} vs current` : 'Compare versions'}</h2>${d ? `<div class="diff">${d.map(([t, s]) => t === '=' ? `<span>${esc(s)}</span>` : t === '+' ? `<ins>${esc(s)}</ins>` : `<del>${esc(s)}</del>`).join('')}</div><p class="muted">Green is in the current version. Red was in the selected revision.</p>` : '<p class="muted">Choose a revision to see what changed.</p>'}</section></div>`;
  res.send(layout(req, { title: 'Revisions: ' + (a.title || 'Untitled'), body }));
});
router.post('/articles/:id/revisions/:rid/restore', requirePerm('article.edit_any'), async (req, res) => {
  const a = getArticle(req.params.id), r = a ? await db.read(`revisions/${a.id}/${+req.params.rid}`) : null;
  if (!a || !r) return res.redirect('/admin/articles?err=' + encodeURIComponent('Revision not found.'));
  await snapshot(a, req.user.id, 'Before restoring revision #' + req.params.rid);
  await db.update('articles', a.id, { title: r.title || '', subtitle: r.subtitle || '', excerpt: r.excerpt || '', body: r.body || '', updated_at: nowSql() });
  await snapshot(getArticle(a.id), req.user.id, 'Restored revision #' + req.params.rid);
  audit(req, 'revision_restored', 'article', a.id, '#' + req.params.rid);
  res.redirect(`/admin/articles/${a.id}/edit?ok=` + encodeURIComponent('Revision restored.'));
});

// ---------- Editorial calendar (month view) ----------
router.get('/calendar', requirePerm('calendar.view'), (req, res) => {
  const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 7);
  const [y, mo] = m.split('-').map(Number), first = new Date(Date.UTC(y, mo - 1, 1)), start = new Date(first.getTime() - first.getUTCDay() * 864e5), end = new Date(start.getTime() + 42 * 864e5);
  const from = start.toISOString().slice(0, 10), to = end.toISOString().slice(0, 10);
  const rows = db.where('articles', a => (a.published_at && a.published_at >= from && a.published_at < to) || (a.deadline && a.deadline >= from && a.deadline < to));
  const byDay = {}; const add = (d, h) => (byDay[d] = byDay[d] || []).push(h);
  const canSched = can(req.user, 'article.schedule');
  for (const a of rows) {
    if (a.published_at) { const d = sqlToManila(a.published_at).slice(0, 10); add(d, `<a class="ev ${a.status}" href="/admin/articles/${a.id}/${canEdit(req.user, a) ? 'edit' : 'preview'}" title="${esc(a.title)} (${a.status})">${esc(sqlToManila(a.published_at).slice(11))} ${esc(a.title || 'Untitled')}</a>${canSched && a.status === 'scheduled' ? `<form method="post" action="/admin/articles/${a.id}/reschedule" style="margin:2px 0">${csrf(req)}<input type="hidden" name="back" value="/admin/calendar?month=${m}"><input type="datetime-local" name="when" value="${sqlToManila(a.scheduled_at)}" aria-label="Reschedule ${esc(a.title)}" style="min-height:30px;font-size:.7rem;padding:2px"><button class="btn small paper-btn" style="min-height:28px;padding:.2rem .5rem">Move</button></form>` : ''}`); }
    if (a.deadline && !['published', 'archived'].includes(a.status)) add(a.deadline.slice(0, 10), `<a class="ev dl" href="/admin/articles/${a.id}/${canEdit(req.user, a) ? 'edit' : 'preview'}">Due: ${esc(a.title || 'Untitled')}</a>`);
  }
  const today = new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10), shift = n => new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start.getTime() + i * 864e5), k = d.toISOString().slice(0, 10); return `<div class="${d.getUTCMonth() !== mo - 1 ? 'off' : ''} ${k === today ? 'today' : ''}"><b>${d.getUTCDate()}</b>${(byDay[k] || []).join('')}</div>`; }).join('');
  res.send(layout(req, { title: 'Editorial Calendar', body: `<div class="toolbar"><a class="btn paper-btn small" href="?month=${shift(-1)}">Previous</a><b style="font:700 1.2rem var(--f-display)">${first.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><a class="btn paper-btn small" href="?month=${shift(1)}">Next</a><a class="btn paper-btn small" href="/admin/calendar">Today</a></div><div class="cal" role="grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow" role="columnheader">${d}</div>`).join('')}${cells}</div><p class="muted">Times shown in Manila time. Monthly view only; week and day views are planned for the next phase.</p>` }));
});
router.sqlToManila = sqlToManila; router.manilaToSql = manilaToSql;
require('./admin2')(router, { layout, status, csrf, confirmBtn, empty, table, cols, hbars, pager, standalone });
require('./admin3')(router, { layout, status, csrf, confirmBtn, empty, table });
require('./admin4')(router, { layout, csrf, confirmBtn, empty, table });
require('./admin5')(router, { layout, csrf, confirmBtn, empty, table });
module.exports = router;
