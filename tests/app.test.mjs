import assert from 'node:assert/strict';
import { bundle, boot, withPublicCopy } from './harness.mjs';
import { seed } from './seed.mjs';

const code = await bundle();
let passed = 0;
const step = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error('FAILED:', name, '\n', e.stack || e); process.exit(1); } };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const emailLog = []; let emailMode = 'ok';
const cloudinary = async (url, init) => {
  if (/^https:\/\/api\.emailjs\.com\/api\/v1\.0\/email\/send$/.test(String(url))) {
    const b = JSON.parse(init.body); emailLog.push(b);
    if (emailMode === 'limit') return new Response('Monthly quota reached', { status: 429 });
    if (/^fail@/.test(b.template_params.to_email)) return new Response('The recipient address is corrupted', { status: 422 });
    return new Response('OK', { status: 200 });
  }
  assert.match(String(url), /^https:\/\/api\.cloudinary\.com\/v1_1\/demo\/image\/upload$/);
  assert.equal(init.body.get('upload_preset'), 'preset');
  return new Response(JSON.stringify({ public_id: 'mmg/up1', secure_url: 'https://res.cloudinary.com/demo/image/upload/mmg/up1.png', width: 1, height: 1 }), { status: 200 });
};

const data = await withPublicCopy(seed());
const s = await boot(code, data, { fetchStub: cloudinary });
const { w } = s, $ = sel => w.document.querySelector(sel), $$ = sel => [...w.document.querySelectorAll(sel)];
const rtdbJson = async p => (await s.fake().rtdb.ref(p).once()).val();

await step('visitor sees the published article but not the draft', async () => {
  assert.match(s.text(), /Company launches new newsroom/);
  await s.go('/articles');
  assert.match(s.text(), /Company launches new newsroom/); assert.doesNotMatch(s.text(), /Secret draft/);
  await s.go('/articles/features/secret-draft'); assert.match(s.text(), /Page not found/);
  await s.go('/articles?q=newsroom'); assert.match(s.text(), /Company launches new newsroom/);
  const log = await rtdbJson('search_log'); assert.ok(log && Object.keys(log).length >= 1, 'search was logged');
});
await step('every public page renders', async () => {
  const bad = [];
  for (const u of ['/', '/about', '/profile', '/leadership', '/articles', '/articles/news', '/news', '/careers', '/contact', '/privacy', '/terms', '/tags/launch', '/authors/ada-admin', '/sitemap.xml', '/robots.txt']) {
    const r = await w.__mmg.dispatch({ method: 'GET', url: u, headers: { 'user-agent': 'crawler' } }); if (r.status !== 200 || /Something went wrong/.test(String(r.body))) bad.push(`${u} -> ${r.status}`);
  }
  assert.deepEqual([...bad], [], 'failing pages: ' + bad.join(', '));
});
await step('clicking an internal link navigates without a reload', async () => {
  await s.go('/');
  const a = $$('a').find(x => /\/articles\/news\/company-launches/.test(x.getAttribute('href') || '')); assert.ok(a, 'article link on home');
  a.click(); await s.waitFor(() => /company-launches/.test(w.location.pathname)); await s.settle();
  assert.match(s.text(), /this is the story body/);
});
await step('views are counted with an increment', async () => {
  const v = await rtdbJson('public/views/1'); assert.ok(v >= 13, 'views ' + v);
});
await step('contact form writes to the inbox only', async () => {
  await s.go('/contact');
  const f = $$('form').find(x => $('input[name=ts]', x) || x.querySelector('input[name=ts]')); assert.ok(f, 'contact form');
  const set = (n, v) => { f.querySelector(`[name=${n}]`).value = v; };
  set('name', 'Pia Reader'); set('email', 'pia@example.com'); set('subject', 'Hello there'); set('message', 'I would like to know more about careers.');
  f.querySelector('[name=ts]').value = String(Date.now() - 10000);
  const cb = f.querySelector('input[type=checkbox]'); if (cb) cb.checked = true;
  f.requestSubmit(); await s.waitFor(async () => (await rtdbJson('public_inbox'))); await s.settle();
  const inbox = Object.values(await rtdbJson('public_inbox')); assert.equal(inbox.length, 1); assert.equal(inbox[0].email, 'pia@example.com'); assert.equal(await rtdbJson('inquiries'), null);
});
await step('admin pages demand sign-in; wrong password is refused', async () => {
  await s.go('/admin/dashboard'); assert.match(w.location.pathname, /\/admin\/login/);
  s.fake().addAccount('admin@mmg.test', 'Correct-horse-9', 'uid-admin', 'Ada Admin');
  const f = $('form[action*="login"]'); f.querySelector('[name=id]').value = 'admin@mmg.test'; f.querySelector('[name=password]').value = 'nope-nope-nope'; f.requestSubmit();
  await s.waitFor(() => /not match|invalid|Invalid|incorrect/i.test(s.text())); assert.match(w.location.pathname, /login/);
});
await step('administrator signs in with the form', async () => {
  const f = $('form[action*="login"]'); f.querySelector('[name=id]').value = 'admin@mmg.test'; f.querySelector('[name=password]').value = 'Correct-horse-9'; f.requestSubmit();
  await s.waitFor(() => /\/admin\/dashboard/.test(w.location.pathname)); await s.settle();
  assert.match(s.text(), /Dashboard/); assert.equal(w.__mmg.db.mode(), 'private'); assert.ok($('a[href="/admin/articles"]'));
  assert.ok((await rtdbJson('users/1')).last_login, 'last_login written');
});
await step('the contact message moves into the inquiries list', async () => {
  await s.go('/admin/inquiries'); assert.match(s.text(), /Pia Reader/); assert.equal(await rtdbJson('public_inbox'), null);
});
await step('every admin screen renders for a super administrator', async () => {
  const urls = ['/admin/dashboard', '/admin/articles', '/admin/articles?status=draft', '/admin/articles?status=published', '/admin/articles/1/edit', '/admin/articles/1/preview', '/admin/categories', '/admin/tags', '/admin/authors', '/admin/staff', '/admin/departments',
    '/admin/media', '/admin/calendar', '/admin/careers', '/admin/announcements', '/admin/issues', '/admin/inquiries', '/admin/users', '/admin/analytics', '/admin/logs', '/admin/settings', '/admin/homepage', '/admin/newsletter', '/newsletter', '/admin/account'];
  const bad = [];
  for (const u of urls) { const r = await w.__mmg.dispatch({ method: 'GET', url: u }); if (r.status !== 200 || /Something went wrong/.test(String(r.body))) bad.push(`${u} -> ${r.status}${r.redirect ? ' ' + r.redirect : ''}`); }
  assert.deepEqual([...bad], [], 'failing screens: ' + bad.join(', '));
});
await step('first sign-in publishes the public copy of what is already published', async () => {
  const n = await w.__mmg.cms.reconcileNow(); assert.ok(n >= 0);
  assert.equal(await rtdbJson('public/articles/2'), null, 'draft never reaches /public');
  assert.equal(await rtdbJson('public/bodies/2'), null);
});
let newId;
const api = async (method, url, body) => { const r = await w.fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, json: await r.json() }; };
await step('create, edit and save an article through the editor API', async () => {
  await s.go('/admin/articles');
  const f = $$('form').find(x => /articles\/new/.test(x.getAttribute('action') || '')); assert.ok(f, 'New article button');
  f.requestSubmit(); await s.waitFor(() => /\/admin\/articles\/\d+\/edit/.test(w.location.pathname)); await s.settle();
  newId = +/articles\/(\d+)\/edit/.exec(w.location.pathname)[1]; assert.ok(newId >= 3, 'id ' + newId);
  assert.ok($('#title, [name=title], input'), 'editor rendered');
  const r = await api('PUT', `/admin/api/articles/${newId}`, { title: 'Brand new story', excerpt: 'Short.', body: '<h2>Heading</h2><p>Text <img src="http://insecure/x.png"><a href="javascript:alert(1)">bad</a> and enough words to count as a real article body.</p>', category_id: 1, author_id: 1, featured_media_id: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = await rtdbJson('articles/' + newId); assert.equal(a.title, 'Brand new story'); assert.doesNotMatch(a.body, /javascript:|insecure/);
});
await step('workflow: submit, approve, publish; the public copy follows', async () => {
  for (const action of ['submit', 'approve', 'publish']) { const r = await api('POST', `/admin/api/articles/${newId}/transition`, { action }); assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.json)); }
  assert.equal((await rtdbJson('articles/' + newId)).status, 'published');
  await w.__mmg.cms.reconcileNow();
  const pub = await rtdbJson('public/articles/' + newId); assert.equal(pub.title, 'Brand new story'); assert.match(await rtdbJson('public/bodies/' + newId), /Heading/);
  assert.equal(pub.body, undefined, 'list row carries no body'); assert.equal(pub.created_by, undefined, 'internal fields stripped'); assert.ok(await rtdbJson('public/_hash/articles/' + newId));
  assert.ok((await rtdbJson('public/media/1')), 'featured image copied'); assert.equal(await rtdbJson('public/media/1/uploaded_by'), null);
});
await step('unpublishing removes it from /public', async () => {
  const r = await api('POST', `/admin/api/articles/${newId}/transition`, { action: 'unpublish' }); assert.equal(r.status, 200, JSON.stringify(r.json));
  await w.__mmg.cms.reconcileNow();
  assert.equal(await rtdbJson('public/articles/' + newId), null); assert.equal(await rtdbJson('public/bodies/' + newId), null); assert.equal(await rtdbJson('public/_hash/articles/' + newId), null);
});
await step('media upload goes to Cloudinary with the unsigned preset', async () => {
  const r = await w.__mmg.dispatch({ method: 'POST', url: '/admin/media', body: { alt: 'Tiny image' }, files: { files: [{ buffer: PNG, originalname: 'tiny.png', mimetype: 'image/png', size: PNG.length }] } });
  assert.ok(r.redirect && /ok=/.test(r.redirect), JSON.stringify(r).slice(0, 300));
  const m = Object.values(await rtdbJson('media')).find(x => /up1/.test(x.url)); assert.ok(m);
});
await step('cover photo uploads from the article editor and rejects non-images', async () => {
  const ok = await w.__mmg.dispatch({ method: 'POST', url: '/admin/api/media/upload', xhr: true, accept: 'application/json', body: {}, files: { file: [{ buffer: PNG, originalname: 'cover.png', mimetype: 'image/png', size: PNG.length }] } });
  const j = JSON.parse(ok.body); assert.equal(ok.status, 200, ok.body); assert.ok(j.item && j.item.id && /up1/.test(j.item.url), ok.body);
  const bad = await w.__mmg.dispatch({ method: 'POST', url: '/admin/api/media/upload', xhr: true, accept: 'application/json', body: {}, files: { file: [{ buffer: Buffer.from('not an image at all, just text'), originalname: 'x.png', mimetype: 'image/png', size: 30 }] } });
  assert.equal(bad.status, 422); assert.match(bad.body, /not a supported image/);
});
await step('homepage banner: needs alt text, shows on the homepage, can be removed', async () => {
  const file = { image: [{ buffer: PNG, originalname: 'banner.png', mimetype: 'image/png', size: PNG.length }] };
  let r = await w.__mmg.dispatch({ method: 'POST', url: '/admin/homepage/banner', body: { alt: '' }, files: file });
  assert.match(r.redirect, /err=/, 'alt text is required');
  r = await w.__mmg.dispatch({ method: 'POST', url: '/admin/homepage/banner', body: { alt: 'Newsroom at dawn', caption: 'The MMG newsroom' }, files: file });
  assert.match(r.redirect, /ok=/, JSON.stringify(r).slice(0, 300));
  let home = await w.__mmg.dispatch({ method: 'GET', url: '/' });
  assert.match(String(home.body), /class="home-banner"/); assert.match(String(home.body), /alt="Newsroom at dawn"/); assert.match(String(home.body), /The MMG newsroom/);
  const mgr = await w.__mmg.dispatch({ method: 'GET', url: '/admin/homepage' }); assert.match(String(mgr.body), /Remove banner/);
  r = await w.__mmg.dispatch({ method: 'POST', url: '/admin/homepage/banner/remove', body: {} }); assert.match(r.redirect, /ok=/);
  home = await w.__mmg.dispatch({ method: 'GET', url: '/' }); assert.doesNotMatch(String(home.body), /class="home-banner"/);
});
await step('newsletter: sign-up, unsubscribe, composing, test and bulk send through EmailJS', async () => {
  const d = o => w.__mmg.dispatch(o), j = r => JSON.parse(r.body);
  // visitor signs up (form posts to /public_subscribe only)
  let r = await d({ method: 'POST', url: '/newsletter/subscribe', body: { ts: String(Date.now() - 5000), email: 'reader1@example.com', name: 'Rita Reader', consent: '1', website: '' } });
  assert.equal(r.status, 200); assert.match(String(r.body), /You are on the list/);
  assert.equal(Object.values(await rtdbJson('public_subscribe')).length, 1);
  r = await d({ method: 'POST', url: '/newsletter/subscribe', body: { ts: String(Date.now() - 5000), email: 'nope', consent: '1' } }); assert.equal(r.status, 400);
  r = await d({ method: 'POST', url: '/newsletter/subscribe', body: { ts: String(Date.now() - 5000), email: 'x@example.com' } }); assert.equal(r.status, 400, 'consent is required');
  // staff import it, add two more by hand
  r = await d({ method: 'GET', url: '/admin/newsletter' }); assert.equal(r.status, 200); assert.match(String(r.body), /reader1@example.com/); assert.equal(await rtdbJson('public_subscribe'), null);
  for (const e of ['fail@example.com', 'reader3@example.com']) { r = await d({ method: 'POST', url: '/admin/newsletter/subscribers', body: { email: e, asked: '1' } }); assert.match(r.redirect, /ok=/, e); }
  r = await d({ method: 'POST', url: '/admin/newsletter/subscribers', body: { email: 'reader3@example.com', asked: '1' } }); assert.match(r.redirect, /err=/, 'duplicates are refused');
  const subs = () => rtdbJson('subscribers').then(x => Object.values(x || {})), tokenOf = async e => (await subs()).find(x => x.email === e).token;
  // unsubscribe needs the right token; a wrong one changes nothing
  r = await d({ method: 'GET', url: `/newsletter/unsubscribe?e=reader3%40example.com&t=${await tokenOf('reader3@example.com')}` }); assert.match(String(r.body), /Yes, unsubscribe me/);
  await d({ method: 'POST', url: '/newsletter/unsubscribe', body: { e: 'fail@example.com', t: 'wrongtoken1' } });
  await d({ method: 'POST', url: '/newsletter/unsubscribe', body: { e: 'reader3@example.com', t: await tokenOf('reader3@example.com') } });
  await d({ method: 'GET', url: '/admin/newsletter' });
  assert.equal((await subs()).find(x => x.email === 'reader3@example.com').status, 'unsubscribed'); assert.equal((await subs()).find(x => x.email === 'fail@example.com').status, 'active');
  // compose
  w.MMG_CONFIG.emailjs = { publicKey: 'pk_test', serviceId: 'service_x', newsletterTemplateId: 'template_nl' };
  r = await d({ method: 'POST', url: '/admin/newsletter', body: {} }); const nid = +r.redirect.match(/newsletter\/(\d+)/)[1];
  const art = Object.entries(await rtdbJson('articles')).find(([, a]) => a.status === 'published'); assert.ok(art, 'a published article');
  r = await d({ method: 'POST', url: `/admin/newsletter/${nid}`, body: { subject: 'Issue One', preheader: 'Hello preview', intro: 'First paragraph.\n\nSecond <b>paragraph</b>.', article: [art[0]], outro: 'Thanks.' } });
  assert.match(r.redirect, /ok=/, r.redirect);
  r = await d({ method: 'POST', url: `/admin/newsletter/${nid}/test`, body: { subject: 'Issue One', preheader: 'Hello preview', intro: 'First paragraph.\n\nSecond <b>paragraph</b>.', article: [art[0]], outro: 'Thanks.' } }); assert.match(r.redirect, /ok=/, r.redirect);
  let m = emailLog.at(-1); assert.equal(m.service_id, 'service_x'); assert.equal(m.template_id, 'template_nl'); assert.equal(m.user_id, 'pk_test');
  const tp = m.template_params; assert.equal(tp.to_email, 'admin@mmg.test'); assert.equal(tp.subject, '[Test] Issue One');
  assert.match(tp.articles_html, new RegExp(art[1].title.replace(/[()]/g, '.'))); assert.match(tp.intro_html, /Second &lt;b&gt;paragraph&lt;\/b&gt;/, 'text is escaped'); assert.match(tp.unsubscribe_url, /\/newsletter\/unsubscribe\?e=admin%40mmg\.test&t=test-preview/);
  // bulk send: unsubscribed readers are skipped; one bad address fails without stopping the run
  const before = emailLog.length;
  r = await d({ method: 'POST', url: `/admin/api/newsletter/${nid}/start`, xhr: true, accept: 'application/json', body: {} }); assert.equal(j(r).total, 2, r.body);
  let p, guard = 0; do { r = await d({ method: 'POST', url: `/admin/api/newsletter/${nid}/next`, xhr: true, accept: 'application/json', body: {} }); p = j(r); } while (!p.done && ++guard < 10);
  assert.equal(p.sent, 1); assert.equal(p.failed, 1); assert.equal(p.status, 'sent');
  assert.deepEqual(emailLog.slice(before).map(x => x.template_params.to_email).sort(), ['fail@example.com', 'reader1@example.com']);
  const tok1 = await tokenOf('reader1@example.com'); assert.match(emailLog.slice(before).find(x => /reader1/.test(x.template_params.to_email)).template_params.unsubscribe_url, new RegExp('t=' + tok1));
  r = await d({ method: 'POST', url: `/admin/api/newsletter/${nid}/start`, xhr: true, accept: 'application/json', body: {} }); assert.equal(r.status, 409, 'a sent issue cannot be sent again');
  r = await d({ method: 'POST', url: `/admin/newsletter/${nid}`, body: { subject: 'Changed' } }); assert.match(r.redirect, /err=/, 'sent issues are locked');
  // a quota error stops the run, marks nobody failed, and can be resumed
  r = await d({ method: 'POST', url: '/admin/newsletter', body: {} }); const n2 = +r.redirect.match(/newsletter\/(\d+)/)[1];
  await d({ method: 'POST', url: `/admin/newsletter/${n2}`, body: { subject: 'Issue Two', intro: 'Hi.' } });
  await d({ method: 'POST', url: `/admin/api/newsletter/${n2}/start`, xhr: true, accept: 'application/json', body: {} });
  emailMode = 'limit'; r = await d({ method: 'POST', url: `/admin/api/newsletter/${n2}/next`, xhr: true, accept: 'application/json', body: {} }); p = j(r);
  assert.equal(p.fatal, true); assert.equal(p.failed, 0); assert.match(p.error, /quota/i); assert.equal(p.status, 'sending');
  emailMode = 'ok'; r = await d({ method: 'POST', url: `/admin/api/newsletter/${n2}/next`, xhr: true, accept: 'application/json', body: {} }); assert.equal(j(r).sent, 1);
  // sending is off, not broken, when EmailJS is not configured
  w.MMG_CONFIG.emailjs = {}; r = await d({ method: 'POST', url: '/admin/newsletter', body: {} }); const n3 = +r.redirect.match(/newsletter\/(\d+)/)[1];
  r = await d({ method: 'POST', url: `/admin/api/newsletter/${n3}/start`, xhr: true, accept: 'application/json', body: {} }); assert.equal(r.status, 422); assert.match(r.body, /not set up/);
});
await step('create a user, change role, deactivate, email a reset', async () => {
  let r = await w.__mmg.dispatch({ method: 'POST', url: '/admin/users', body: { name: 'Eddie Editor', email: 'eddie@mmg.test', username: 'eddie', role: 'editor' } });
  assert.ok(r.redirect || r.body, 'response'); const users = Object.values(await rtdbJson('users')); const u = users.find(x => x.email === 'eddie@mmg.test'); assert.ok(u, 'user row');
  const role = await rtdbJson('roles/' + u.uid); assert.equal(role.role, 'editor'); assert.equal(role.active, 1); assert.equal(role.key, String(role.user_id));
  assert.equal($('a[href="/admin/account"]').textContent, 'Ada Admin', 'admin is still signed in (secondary app)');
  r = await w.__mmg.dispatch({ method: 'POST', url: `/admin/users/${role.user_id}`, body: { role: "writer" } }); assert.equal((await rtdbJson('roles/' + u.uid)).role, 'writer');
  r = await w.__mmg.dispatch({ method: 'POST', url: `/admin/users/${role.user_id}/toggle`, body: {} }); assert.equal((await rtdbJson('roles/' + u.uid)).active, 0);
  r = await w.__mmg.dispatch({ method: 'POST', url: `/admin/users/${role.user_id}/reset`, body: {} }); assert.equal(JSON.stringify(s.fake().mails), JSON.stringify(['eddie@mmg.test']));
});
await step('sign out returns to the public copy', async () => {
  const f = $$('form').find(x => /logout/.test(x.getAttribute('action') || '')); f.requestSubmit();
  await s.waitFor(() => w.__mmg.db.mode() === 'public' && !w.__mmg.auth.state.user); await s.go('/admin/dashboard'); assert.match(w.location.pathname, /login/);
  await s.go('/articles'); assert.doesNotMatch(s.text(), /Secret draft/);
});
await step('a deactivated account cannot sign in', async () => {
  const f = $('form[action*="login"]') || (await s.go('/admin/login'), $('form[action*="login"]'));
  const eddie = [...s.fake().accounts.values()].find(a => a.email === 'eddie@mmg.test'); assert.ok(eddie);
  f.querySelector('[name=id]').value = 'eddie@mmg.test'; f.querySelector('[name=password]').value = eddie.password; f.requestSubmit();
  await s.waitFor(() => /login/.test(w.location.pathname) && /not match|invalid|disabled|incorrect/i.test(s.text())); assert.equal(w.__mmg.auth.state.user, null);
});
console.log(`app: ${passed} steps passed` + (s.errors.length ? `\nconsole errors:\n${s.errors.join('\n')}` : ''));
process.exit(0);
