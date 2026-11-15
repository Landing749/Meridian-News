// Newsletter: subscribers, composing an issue, and sending it through EmailJS (see src/mailer.js and emailjs-templates/).
const db = require('../db');
const Q = require('../queries');
const cms = require('../cms');
const mailer = require('../mailer');
const { deliver } = require('../cloud');
const { requirePerm, audit } = require('../auth');
const { esc, fmtDate, plain } = require('../util');
const PV = require('../views/public');
const back = (res, url, ok, err) => res.redirect(url + (url.includes('?') ? '&' : '?') + (err ? 'err=' + encodeURIComponent(err) : 'ok=' + encodeURIComponent(ok)));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_ARTICLES = 8;
const ids = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const P = requirePerm('newsletter.manage');

// ---------- building the email ----------
const paras = (text, style) => String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  .map(p => `<p style="${style}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const P_STYLE = 'margin:0 0 14px 0;font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.6;color:#222222;';
const abs = path => PV.BASE_URL() + path;
const chosen = n => ids(n.article_ids).map(id => Q.liveById(+id)).filter(Boolean).slice(0, MAX_ARTICLES);
function articleCard(a) {
  const url = abs(PV.artUrl(a)), excerpt = a.excerpt || plain(a, 170);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;border-bottom:1px solid #d9d3c4;"><tbody>`
    + (a.image ? `<tr><td style="padding:0 0 12px 0;"><a href="${esc(url)}"><img src="${esc(deliver(a.image, 1120))}" width="560" alt="${esc(a.image_alt || '')}" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></a></td></tr>` : '')
    + `<tr><td style="padding:0 0 22px 0;">`
    + (a.category ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#B83232;margin:0 0 6px 0;">${esc(a.category)}</div>` : '')
    + `<a href="${esc(url)}" style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;font-weight:bold;color:#101F38;text-decoration:none;">${esc(a.title)}</a>`
    + (excerpt ? `<p style="margin:8px 0 10px 0;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.55;color:#33425a;">${esc(excerpt)}</p>` : '')
    + `<a href="${esc(url)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#3476B8;text-decoration:none;">Read the story &rarr;</a></td></tr></tbody></table>`;
}
// The variables the EmailJS template expects (see emailjs-templates/README.md).
function params(n, to) {
  return {
    to_email: to.email, to_name: to.name || 'Reader', subject: n.subject, preheader: n.preheader || '',
    intro_html: paras(n.intro, P_STYLE), articles_html: chosen(n).map(articleCard).join(''), outro_html: paras(n.outro, P_STYLE),
    issue_date: new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' }),
    site_url: abs('/'), logo_url: abs('/img/logo-full.png'), year: String(new Date().getFullYear()),
    unsubscribe_url: `${abs('/newsletter/unsubscribe')}?e=${encodeURIComponent(to.email)}&t=${encodeURIComponent(to.token || 'test-preview')}`,
  };
}
const progress = n => { const rec = ids(n.recipients), sent = ids(n.sent_ids), failed = ids(n.failed_ids); return { status: n.status, total: rec.length, sent: sent.length, failed: failed.length, error: n.last_error || '' }; };
let busy = false; // one send loop at a time (two tabs would double-send)

module.exports = (router, V) => {
  const { layout, csrf, confirmBtn, empty, table } = V;
  const field = (id, label, val = '', o = {}) => `<div class="field"><label for="${id}">${label}</label>${o.area ? `<textarea id="${id}" name="${o.name || id}" rows="${o.rows || 4}" maxlength="${o.max || 2000}"${o.dis ? ' disabled' : ''}>${esc(val)}</textarea>` : `<input id="${id}" name="${o.name || id}" type="text" value="${esc(val)}" maxlength="${o.max || 150}"${o.req ? ' required' : ''}${o.dis ? ' disabled' : ''}>`}${o.help ? `<div class="help">${o.help}</div>` : ''}</div>`;
  const badge = s => `<span class="badge ${s === 'sent' || s === 'active' ? 'published' : s === 'sending' ? 'scheduled' : 'draft'}">${esc(({ draft: 'Draft', sending: 'Sending', sent: 'Sent', active: 'Subscribed', unsubscribed: 'Unsubscribed' })[s] || s)}</span>`;

  // ===================== Overview: issues and subscribers =====================
  router.get('/newsletter', P, async (req, res) => {
    await cms.importSubscribers().catch(() => {});
    const subs = db.all('subscribers').sort((x, y) => y.id - x.id), active = subs.filter(s => s.status === 'active').length;
    const issues = db.all('newsletters').sort((x, y) => y.id - x.id);
    const ready = mailer.configured();
    res.send(layout(req, { title: 'Newsletter', body: `${ready ? '' : '<div class="notice bad" role="alert">Sending is switched off until EmailJS is set up. Fill in the <b>emailjs</b> section of <code>config.js</code> (public key, service id, template id). Steps are in the README under “Newsletter (EmailJS)”. You can still collect subscribers and write issues.</div>'}
<p class="muted" style="margin-top:0">${active} active subscriber${active === 1 ? '' : 's'} · ${subs.length - active} unsubscribed. The free EmailJS plan allows 200 emails a month in total, so one issue to ${active} people uses ${active} of them.</p>
<section class="paper panel" style="margin-bottom:1.4rem"><h2>Issues</h2><form method="post" action="/admin/newsletter" style="margin-bottom:1rem">${csrf(req)}<button class="btn">New newsletter</button></form>
${issues.length ? table(['Subject', 'Status', 'Sent', 'Created', 'Actions'], issues.map(n => { const p = progress(n); return `<tr><td><a href="/admin/newsletter/${n.id}">${esc(n.subject || 'Untitled')}</a></td><td>${badge(n.status)}</td><td>${n.status === 'draft' ? '' : `${p.sent} of ${p.total}${p.failed ? ` <span class="muted">(${p.failed} failed)</span>` : ''}`}</td><td>${fmtDate(n.created_at, true)}</td><td><div class="row-actions"><a class="btn paper-btn small" href="/admin/newsletter/${n.id}">${n.status === 'draft' ? 'Edit' : 'Open'}</a>${n.status === 'draft' ? confirmBtn(req, `/admin/newsletter/${n.id}/delete`, 'Delete', `Delete “${n.subject || 'Untitled'}”?`) : ''}</div></td></tr>`; }), 'Newsletter issues') : empty('No newsletters yet', 'Create one, choose published stories, send yourself a test, then send it to subscribers.')}</section>
<section class="paper panel"><h2>Subscribers</h2>
<form method="post" action="/admin/newsletter/subscribers" class="formgrid">${csrf(req)}${field('sb-email', 'Email', '', { name: 'email', req: 1, max: 200 })}${field('sb-name', 'Name (optional)', '', { name: 'name', max: 120 })}
<div class="field" style="grid-column:1/-1"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" name="asked" value="1" required> This person asked to receive the newsletter.</label></div><div class="field" style="align-self:end"><button class="btn">Add subscriber</button></div></form>
${subs.length ? table(['Email', 'Name', 'Status', 'Joined', 'Actions'], subs.slice(0, 500).map(s => `<tr><td>${esc(s.email)}</td><td>${esc(s.name)}</td><td>${badge(s.status)}</td><td>${fmtDate(s.created_at)}</td><td><div class="row-actions"><form method="post" action="/admin/newsletter/subscribers/${s.id}/status">${csrf(req)}<input type="hidden" name="to" value="${s.status === 'active' ? 'unsubscribed' : 'active'}"><button class="btn paper-btn small">${s.status === 'active' ? 'Unsubscribe' : 'Resubscribe'}</button></form>${confirmBtn(req, `/admin/newsletter/subscribers/${s.id}/delete`, 'Delete', `Delete ${s.email} from the list?`)}</div></td></tr>`), 'Subscribers') : empty('No subscribers yet', 'People who sign up on the Newsletter page appear here the next time a manager opens this page.')}</section>` }));
  });

  // ===================== Subscribers =====================
  router.post('/newsletter/subscribers', P, async (req, res) => {
    const email = String(req.body.email || '').trim(), name = String(req.body.name || '').trim().slice(0, 120);
    if (!EMAIL_RE.test(email) || email.length > 200) return back(res, '/admin/newsletter', '', 'Enter a valid email address.');
    if (!req.body.asked) return back(res, '/admin/newsletter', '', 'Only add people who asked to receive the newsletter.');
    const cur = db.find('subscribers', s => s.email.toLowerCase() === email.toLowerCase());
    if (cur) { if (cur.status === 'active') return back(res, '/admin/newsletter', '', 'That address is already subscribed.'); await db.update('subscribers', cur.id, { status: 'active' }); }
    else await db.insert('subscribers', { email, name, token: cms.newToken(), status: 'active', source: 'staff' });
    audit(req, 'subscriber_added', 'subscriber', null, email); back(res, '/admin/newsletter', 'Subscriber added.');
  });
  router.post('/newsletter/subscribers/:id/status', P, async (req, res) => {
    const s = db.get('subscribers', +req.params.id); if (!s) return back(res, '/admin/newsletter', '', 'Subscriber not found.');
    const to = req.body.to === 'active' ? 'active' : 'unsubscribed'; await db.update('subscribers', s.id, { status: to });
    audit(req, 'subscriber_' + to, 'subscriber', s.id, s.email); back(res, '/admin/newsletter', to === 'active' ? 'Subscriber restored.' : 'Subscriber unsubscribed.');
  });
  router.post('/newsletter/subscribers/:id/delete', P, async (req, res) => {
    const s = db.get('subscribers', +req.params.id); if (!s) return back(res, '/admin/newsletter', '', 'Subscriber not found.');
    await db.remove('subscribers', s.id); audit(req, 'subscriber_deleted', 'subscriber', s.id, s.email); back(res, '/admin/newsletter', 'Subscriber deleted.');
  });

  // ===================== Issues =====================
  router.post('/newsletter', P, async (req, res) => {
    const month = new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
    const n = await db.insert('newsletters', { subject: `Meridian Media Group newsletter, ${month}`, created_by: req.user.id });
    audit(req, 'newsletter_created', 'newsletter', n.id); res.redirect('/admin/newsletter/' + n.id);
  });
  router.post('/newsletter/:id/delete', P, async (req, res) => {
    const n = db.get('newsletters', +req.params.id); if (!n) return back(res, '/admin/newsletter', '', 'Newsletter not found.');
    if (n.status !== 'draft') return back(res, '/admin/newsletter', '', 'Only drafts can be deleted. Sent issues are kept as a record.');
    await db.remove('newsletters', n.id); audit(req, 'newsletter_deleted', 'newsletter', n.id); back(res, '/admin/newsletter', 'Draft deleted.');
  });

  router.get('/newsletter/:id', P, async (req, res) => {
    const n = db.get('newsletters', +req.params.id); if (!n) return back(res, '/admin/newsletter', '', 'Newsletter not found.');
    await cms.importSubscribers().catch(() => {});
    const locked = n.status !== 'draft', picked = new Set(ids(n.article_ids)), live = Q.search({ limit: 40 }).rows;
    const active = db.count('subscribers', s => s.status === 'active'), p = progress(n), ready = mailer.configured();
    const list = live.map(a => `<li><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" name="article" value="${a.id}"${picked.has(String(a.id)) ? ' checked' : ''}${locked ? ' disabled' : ''}> <span>${esc(a.title)} <span class="muted">· ${esc(a.category || 'Uncategorized')} · ${fmtDate(a.published_at)}</span></span></label></li>`).join('');
    const sendPanel = n.status === 'sent' ? `<div class="notice ok" role="status">Sent ${fmtDate(n.sent_at, true)}: ${p.sent} delivered to EmailJS${p.failed ? `, ${p.failed} failed` : ''}.</div>`
      : `<div id="nl-send" data-id="${n.id}" data-status="${n.status}" data-total="${p.total || active}" data-sent="${p.sent}"${ready ? '' : ' data-off="1"'}>
<p class="muted" style="margin-top:0">${n.status === 'sending' ? `Sending was started and ${p.sent} of ${p.total} went out. Press resume to carry on where it stopped.` : `This will email ${active} active subscriber${active === 1 ? '' : 's'}, one at a time (about one a second). Keep this page open until it finishes.`}</p>
<div class="row-actions"><button class="btn" type="button" id="nl-go"${ready && (active || p.total) ? '' : ' disabled'}>${n.status === 'sending' ? 'Resume sending' : 'Send to all subscribers'}</button><button class="btn paper-btn" type="button" id="nl-stop" hidden>Stop</button></div>
<progress id="nl-bar" max="1" value="0" hidden style="width:100%;margin-top:.8rem"></progress><div class="help" id="nl-msg" role="status">${esc(p.error)}</div></div>`;
    res.send(layout(req, { title: n.subject || 'Newsletter', scripts: ['/js/newsletter.js'], body: `<p><a href="/admin/newsletter">← All newsletters</a> ${badge(n.status)}</p>${ready ? '' : '<div class="notice bad" role="alert">EmailJS is not set up yet, so test and bulk sending are off. See the README, “Newsletter (EmailJS)”.</div>'}
<form method="post" action="/admin/newsletter/${n.id}" class="paper panel" style="margin-bottom:1.4rem">${csrf(req)}<h2>Content</h2>
${field('nl-subject', 'Subject line', n.subject, { name: 'subject', req: 1, dis: locked })}${field('nl-pre', 'Preview text', n.preheader, { name: 'preheader', dis: locked, help: 'The grey line many inboxes show after the subject.' })}
${field('nl-intro', 'Introduction', n.intro, { name: 'intro', area: 1, rows: 5, dis: locked, help: 'Plain text. A blank line starts a new paragraph.' })}
<fieldset style="border:0;padding:0;margin:0 0 1rem"><legend style="font-weight:600;margin-bottom:.4rem">Stories (published articles, up to ${MAX_ARTICLES}, newest first)</legend>${live.length ? `<ul style="list-style:none;padding:0;margin:0;display:grid;gap:.5rem;max-height:340px;overflow:auto">${list}</ul>` : '<p class="muted">No published articles yet.</p>'}</fieldset>
${field('nl-outro', 'Closing note (optional)', n.outro, { name: 'outro', area: 1, rows: 3, dis: locked })}
${locked ? '' : `<div class="row-actions"><button class="btn">Save draft</button><button class="btn paper-btn" formaction="/admin/newsletter/${n.id}/test">Save and send a test to me</button></div>`}</form>
<section class="paper panel"><h2>${n.status === 'sent' ? 'Result' : 'Send'}</h2>${sendPanel}</section>` }));
  });
  const save = async (req, n) => {
    const b = req.body, art = [].concat(b.article || []).map(x => +x).filter(x => x > 0 && Q.liveById(x)).slice(0, MAX_ARTICLES);
    const live = new Map(Q.search({ limit: 200 }).rows.map(a => [a.id, a])), order = art.sort((x, y) => String(live.get(y)?.published_at || '').localeCompare(String(live.get(x)?.published_at || '')));
    await db.update('newsletters', n.id, { subject: String(b.subject || '').trim().slice(0, 150), preheader: String(b.preheader || '').trim().slice(0, 150), intro: String(b.intro || '').slice(0, 2000), outro: String(b.outro || '').slice(0, 1000), article_ids: order.join(','), updated_at: db.now() });
  };
  router.post('/newsletter/:id', P, async (req, res) => {
    const n = db.get('newsletters', +req.params.id); if (!n) return back(res, '/admin/newsletter', '', 'Newsletter not found.');
    if (n.status !== 'draft') return back(res, '/admin/newsletter/' + n.id, '', 'This newsletter is already being sent, so it can no longer be edited.');
    if (!String(req.body.subject || '').trim()) return back(res, '/admin/newsletter/' + n.id, '', 'Enter a subject line.');
    await save(req, n); audit(req, 'newsletter_saved', 'newsletter', n.id); back(res, '/admin/newsletter/' + n.id, 'Draft saved.');
  });
  router.post('/newsletter/:id/test', P, async (req, res) => {
    let n = db.get('newsletters', +req.params.id); if (!n) return back(res, '/admin/newsletter', '', 'Newsletter not found.');
    if (n.status === 'draft') { if (!String(req.body.subject || '').trim()) return back(res, '/admin/newsletter/' + n.id, '', 'Enter a subject line.'); await save(req, n); n = db.get('newsletters', n.id); }
    if (!mailer.configured()) return back(res, '/admin/newsletter/' + n.id, '', 'EmailJS is not set up yet (config.js).');
    if (!req.user.email) return back(res, '/admin/newsletter/' + n.id, '', 'Your account has no email address to send the test to.');
    try { await mailer.send(params({ ...n, subject: '[Test] ' + n.subject }, { email: req.user.email, name: req.user.name })); }
    catch (e) { return back(res, '/admin/newsletter/' + n.id, '', 'The test email could not be sent: ' + e.message); }
    back(res, '/admin/newsletter/' + n.id, `Test email sent to ${req.user.email}. It can take a minute to arrive.`);
  });

  // ---- Sending: the page calls start once, then next once per subscriber ----
  router.post('/api/newsletter/:id/start', P, async (req, res) => {
    const n = db.get('newsletters', +req.params.id); if (!n) return res.status(404).json({ error: 'Newsletter not found.' });
    if (n.status === 'sent') return res.status(409).json({ error: 'This newsletter has already been sent.' });
    if (!mailer.configured()) return res.status(422).json({ error: 'EmailJS is not set up yet (config.js).' });
    if (n.status === 'sending') return res.json(progress(n));
    if (!n.subject.trim()) return res.status(422).json({ error: 'Add a subject line and save the draft first.' });
    if (!n.intro.trim() && !chosen(n).length) return res.status(422).json({ error: 'Add an introduction or at least one story, and save the draft.' });
    await cms.importSubscribers().catch(() => {}); // honour unsubscribe requests before sending
    const rec = db.where('subscribers', s => s.status === 'active').sort((a, b) => a.id - b.id).map(s => s.id);
    if (!rec.length) return res.status(422).json({ error: 'There are no active subscribers.' });
    await db.update('newsletters', n.id, { status: 'sending', recipients: rec.join(','), sent_ids: '', failed_ids: '', last_error: '', started_at: db.now() });
    audit(req, 'newsletter_started', 'newsletter', n.id, `${rec.length} recipients`);
    res.json(progress(db.get('newsletters', n.id)));
  });
  router.post('/api/newsletter/:id/next', P, async (req, res) => {
    let n = db.get('newsletters', +req.params.id); if (!n) return res.status(404).json({ error: 'Newsletter not found.' });
    if (n.status !== 'sending') return res.json({ ...progress(n), done: n.status === 'sent' });
    if (busy) return res.status(409).json({ error: 'Another send is already running (maybe in another tab).' });
    busy = true;
    try {
      const done = new Set([...ids(n.sent_ids), ...ids(n.failed_ids)]), nextId = ids(n.recipients).find(x => !done.has(x));
      if (!nextId) {
        await db.update('newsletters', n.id, { status: 'sent', sent_at: db.now() }); n = db.get('newsletters', n.id);
        audit(req, 'newsletter_sent', 'newsletter', n.id, `${ids(n.sent_ids).length} sent, ${ids(n.failed_ids).length} failed`);
        return res.json({ ...progress(n), done: true });
      }
      const s = db.get('subscribers', +nextId);
      if (!s || s.status !== 'active') { await db.update('newsletters', n.id, { recipients: ids(n.recipients).filter(x => x !== nextId).join(',') }); return res.json({ ...progress(db.get('newsletters', n.id)), done: false }); }
      try {
        await mailer.send(params(n, s));
        await db.update('newsletters', n.id, { sent_ids: [...ids(n.sent_ids), nextId].join(','), last_error: '' });
      } catch (e) {
        const msg = `${s.email}: ${e.message}`;
        if (mailer.isFatal(e)) { await db.update('newsletters', n.id, { last_error: e.message }); return res.json({ ...progress(db.get('newsletters', n.id)), done: false, fatal: true, error: e.message }); }
        await db.update('newsletters', n.id, { failed_ids: [...ids(n.failed_ids), nextId].join(','), last_error: msg });
      }
      res.json({ ...progress(db.get('newsletters', n.id)), done: false });
    } finally { busy = false; }
  });
};
