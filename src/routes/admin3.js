// Print edition: A3 newspaper issues (template supplied by the client). Pages are rendered and auto-fitted in the browser by public/js/newspaper.js.
const db = require('../db');
const Q = require('../queries');
const { deliver } = require('../cloud');
const A = require('../auth');
const { requirePerm, audit } = A;
const { esc, fmtDate, textOnly } = require('../util');
const LAYOUTS = { L2: 'Left rail: byline beside photo', L3: 'Headline left, photo right', L4: 'Portrait photo at the side', L5: 'Photo first', L6: 'Centered headline', L7: 'Headline right, photo left', L8: 'Portrait photo at left', L9: 'Photo at the bottom', L10: 'Wide banner photo under byline', L11: 'Small photo beside headline' };
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const htmlToParas = h => decode(String(h || '').replace(/<\/(p|h[1-6]|li|blockquote|tr|figure)>/gi, '$&\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
const S = (v, n) => String(v ?? '').slice(0, n);
const url = m => (m ? deliver(m.url) : '');

function load(id) {
  const i = db.get('issues', +id); if (!i) return null;
  const logo = m => url(db.get('media', m));
  const settings = { title: i.title, masthead: i.masthead, date_text: i.date_text, edition: i.edition, volume: i.volume, price: i.price, justify: !!i.justify, hyphenate: !!i.hyphenate,
    left_logo_media_id: i.left_logo_media_id, right_logo_media_id: i.right_logo_media_id, left_logo_url: logo(i.left_logo_media_id), right_logo_url: logo(i.right_logo_media_id) };
  const pages = db.where('issue_pages', p => p.issue_id === i.id).sort((a, b) => a.position - b.position)
    .map(p => ({ layout: p.layout, front: !!p.front, columns: p.columns, section: p.section, headline: p.headline, deck: p.deck, byline: p.byline, dateline: p.dateline, caption: p.caption, credit: p.credit, body: p.body, photo_media_id: p.photo_media_id, photo_url: url(db.get('media', p.photo_media_id)) }));
  return { issue: i, settings, pages };
}
const json = o => JSON.stringify(o).replace(/</g, '\\u003c');

module.exports = (router, V) => {
  const { layout, csrf, confirmBtn, empty, table } = V;
  const P = requirePerm('issues.manage');

  router.get('/issues', P, (req, res) => {
    const rows = db.all('issues').sort((x, y) => (y.updated_at || '') < (x.updated_at || '') ? -1 : (y.updated_at || '') > (x.updated_at || '') ? 1 : y.id - x.id).map(i => ({ ...i, n: db.count('issue_pages', p => p.issue_id === i.id) }));
    res.send(layout(req, { title: 'Print Issues', body: `<div class="notice info">Build the printed A3 newspaper from the supplied template. Paste a full article into a page and the columns fill and justify automatically.</div>
<form method="post" action="/admin/issues" style="margin-bottom:1rem">${csrf(req)}<button class="btn">New issue</button></form>
${rows.length ? table(['Issue', 'Pages', 'Updated', 'Actions'], rows.map(i => `<tr><td><a href="/admin/issues/${i.id}">${esc(i.title)}</a><br><span class="muted">${esc(i.masthead)} · ${esc(i.date_text)}</span></td><td>${i.n}</td><td>${fmtDate(i.updated_at, true)}</td><td><div class="row-actions"><a class="btn paper-btn small" href="/admin/issues/${i.id}">Edit</a><a class="btn paper-btn small" href="/admin/issues/${i.id}/print" target="_blank" rel="noopener">Print view</a>${confirmBtn(req, `/admin/issues/${i.id}/delete`, 'Delete', `Delete the issue “${i.title}” and all its pages?`)}</div></td></tr>`), 'Issues') : empty('No issues yet', 'Create an issue to start laying out pages.')}` }));
  });
  router.post('/issues', P, async (req, res) => {
    const today = new Date(Date.now() + 8 * 36e5).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const issue = await db.insert('issues', { title: 'Issue ' + today, date_text: today, price: '₱20', created_by: req.user.id }), id = issue.id;
    const pids = await db.reserve('issue_pages', 5), b = db.batch();
    pids.forEach((pid, p) => b.set('issue_pages', pid, { issue_id: id, position: p, layout: p === 0 ? 'L3' : 'L2', front: p === 0 ? 1 : 0, columns: p === 0 ? 4 : 3 }));
    await b.commit();
    audit(req, 'issue_created', 'issue', id); res.redirect('/admin/issues/' + id);
  });
  router.post('/issues/:id/delete', P, async (req, res) => { await db.remove('issues', +req.params.id); audit(req, 'issue_deleted', 'issue', req.params.id); res.redirect('/admin/issues?ok=' + encodeURIComponent('Issue deleted.')); });

  router.get('/issues/:id', P, (req, res) => {
    const d = load(req.params.id); if (!d) return res.redirect('/admin/issues?err=' + encodeURIComponent('Issue not found.'));
    const arts = db.all('articles').sort((x, y) => (y.updated_at || '') < (x.updated_at || '') ? -1 : (y.updated_at || '') > (x.updated_at || '') ? 1 : y.id - x.id).slice(0, 200).map(a => ({ id: a.id, title: a.title, status: a.status, cat: db.get('categories', a.category_id)?.name || null }));
    const f = (l, k, o = {}) => `<div class="field"><label for="s-${k}">${l}</label><input id="s-${k}" data-s="${k}" value="${esc(d.settings[k])}" maxlength="${o.max || 80}"></div>`;
    const pf = (l, k, o = {}) => `<div class="field"><label for="p-${k}">${l}</label>${o.area ? `<textarea id="p-${k}" data-p="${k}" rows="${o.rows || 2}" maxlength="${o.max || 400}"></textarea>` : `<input id="p-${k}" data-p="${k}" maxlength="${o.max || 300}">`}${o.help ? `<div class="help">${o.help}</div>` : ''}</div>`;
    const body = `<div id="iss" data-id="${d.issue.id}"><div class="iss-grid"><div class="iss-form">
<section class="paper panel"><h2>Issue</h2><div class="formgrid">${f('Issue name (internal)', 'title')}${f('Masthead title', 'masthead')}${f('Date line', 'date_text')}${f('Edition', 'edition')}${f('Volume', 'volume')}${f('Price', 'price')}</div>
<div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" data-sc="justify"${d.settings.justify ? ' checked' : ''}> Justify article text</label><label style="display:flex;gap:.5rem;font-weight:500;margin-top:.4rem"><input type="checkbox" data-sc="hyphenate"${d.settings.hyphenate ? ' checked' : ''}> Hyphenate long words (keeps justified columns even)</label></div>
<div class="row-actions"><button class="btn paper-btn small" type="button" data-logo="left">Left logo…</button><button class="btn paper-btn small" type="button" data-logo="left-reset">Default</button><button class="btn paper-btn small" type="button" data-logo="right">Right logo…</button><button class="btn paper-btn small" type="button" data-logo="right-reset">Default</button></div></section>
<section class="paper panel"><h2>Pages</h2><div class="row-actions" id="tabs" role="tablist" aria-label="Pages"></div>
<div class="row-actions" style="margin:.8rem 0"><button class="btn paper-btn small" type="button" id="pg-add">Add page</button><button class="btn paper-btn small" type="button" id="pg-up">Move earlier</button><button class="btn paper-btn small" type="button" id="pg-down">Move later</button><button class="btn danger small" type="button" id="pg-del">Remove page</button></div>
<div class="formgrid"><div class="field"><label for="p-layout">Layout</label><select id="p-layout" data-p="layout">${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}">${k}: ${v}</option>`).join('')}</select></div><div class="field"><label for="p-columns">Text columns</label><select id="p-columns" data-p="columns">${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></div></div>
<div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" data-pc="front"> Front-page style (large headline and masthead)</label></div>
${pf('Section', 'section', { max: 60 })}${pf('Headline', 'headline', { area: 1, rows: 2 })}${pf('Deck / subheading', 'deck', { area: 1, rows: 2, max: 400 })}<div class="formgrid">${pf('Byline (author)', 'byline', { max: 120 })}${pf('Date or dateline', 'dateline', { max: 120 })}</div>
<div class="field"><label>Photo</label><div id="ph-prev" class="muted">No photo</div><div class="row-actions" style="margin-top:.4rem"><button class="btn paper-btn small" type="button" id="ph-pick">Choose from library…</button><button class="btn paper-btn small" type="button" id="ph-clear">Remove photo</button></div></div>
<div class="formgrid">${pf('Photo caption', 'caption', { max: 300 })}${pf('Photo credit', 'credit', { max: 150 })}</div>
<div class="field"><label for="imp">Fill this page from a CMS article</label><div class="row-actions"><select id="imp" style="max-width:340px"><option value="">Choose an article…</option>${arts.map(a => `<option value="${a.id}">${esc(a.title || 'Untitled')} (${a.status.replace('_', ' ')})</option>`).join('')}</select><button class="btn paper-btn small" type="button" id="imp-go">Fill page</button></div></div>
<div class="field"><label for="p-body">Paste the full article text</label><textarea id="p-body" data-p="body" rows="14" maxlength="200000" placeholder="Paste the whole article here. Blank lines separate paragraphs. The columns fill and justify on their own."></textarea><div class="help" id="body-info"></div></div></section></div>
<div class="iss-preview"><div class="paper panel" style="margin-bottom:.8rem"><div class="stats-bar" style="background:none;border:0;padding:0"><span id="fitinfo">Preparing preview…</span><span class="savestate" id="savestate" data-s="saved" role="status">Saved</span><button class="btn small" type="button" id="save-now">Save now</button><a class="btn small" id="print-link" href="/admin/issues/${d.issue.id}/print" target="_blank" rel="noopener">Print / Save as PDF</a></div><p id="fitwarn" class="err" role="alert" style="margin:.5rem 0 0"></p></div>
<div class="pv-wrap" id="pvw"><iframe id="pv" title="Page preview" src="/admin/issues/${d.issue.id}/print?embed=1&page=0"></iframe></div></div></div>
<dialog id="picker" class="picker" aria-labelledby="pk-t"><div class="paper"><h2 id="pk-t">Media library</h2><div class="toolbar"><div class="field"><label for="pk-q">Search</label><input id="pk-q" type="search"></div><button class="btn paper-btn small" type="button" id="pk-close">Close</button></div><div class="pgrid" id="pk-grid"></div></div></dialog>
<script type="application/json" id="issue-data">${json({ settings: d.settings, pages: d.pages })}</script></div>`;
    res.send(layout(req, { title: d.issue.title, body, scripts: ['/js/issue-editor.js'] }));
  });

  router.put('/api/issues/:id', P, async (req, res) => {
    const i = db.get('issues', +req.params.id); if (!i) return res.status(404).json({ error: 'Issue not found.' });
    const s = req.body.settings || {}, pages = Array.isArray(req.body.pages) ? req.body.pages.slice(0, 40) : null;
    if (!pages || !pages.length) return res.status(422).json({ error: 'An issue needs at least one page.' });
    const media = id => (id && db.get('media', +id) ? +id : null), now = db.now();
    const pids = await db.reserve('issue_pages', pages.length), b = db.batch();
    b.patch('issues', i.id, { title: S(s.title, 80).trim() || 'Untitled issue', masthead: S(s.masthead, 80), date_text: S(s.date_text, 80), edition: S(s.edition, 40), volume: S(s.volume, 40), price: S(s.price, 20),
      justify: s.justify === false ? 0 : 1, hyphenate: s.hyphenate === false ? 0 : 1, left_logo_media_id: media(s.left_logo_media_id), right_logo_media_id: media(s.right_logo_media_id), updated_at: now });
    for (const old of db.where('issue_pages', p => p.issue_id === i.id)) b.del('issue_pages', old.id);
    pages.forEach((p, k) => b.set('issue_pages', pids[k], { issue_id: i.id, position: k, layout: LAYOUTS[p.layout] ? p.layout : 'L2', front: p.front ? 1 : 0, columns: Math.min(5, Math.max(1, +p.columns || 3)), section: S(p.section, 60), headline: S(p.headline, 300), deck: S(p.deck, 400),
      byline: S(p.byline, 120), dateline: S(p.dateline, 120), caption: S(p.caption, 300), credit: S(p.credit, 150), photo_media_id: media(p.photo_media_id), body: S(p.body, 200000) }));
    await b.commit(); // one atomic write: the issue and all of its pages change together
    res.json({ ok: true, savedAt: now });
  });
  router.get('/api/articles/:id/print-fields', P, (req, res) => {
    const raw = db.get('articles', +req.params.id); if (!raw) return res.status(404).json({ error: 'Article not found.' });
    const a = Q.view(raw), m = db.get('media', a.featured_media_id);
    res.json({ section: (a.category || '').toUpperCase(), headline: a.title, deck: a.subtitle, byline: a.author || '', dateline: a.published_at ? fmtDate(a.published_at) : '', caption: a.image_caption, credit: a.image_credit, photo_media_id: a.featured_media_id, photo_url: url(m), body: htmlToParas(a.body) });
  });
  router.get('/issues/:id/print', P, (req, res) => {
    const d = load(req.params.id); if (!d) return res.status(404).send('Issue not found');
    const embed = req.query.embed === '1';
    res.send(`<!doctype html><html lang="fil"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>${esc(d.issue.title)}</title><link rel="stylesheet" href="/css/newspaper.css"></head><body class="${embed ? 'embed' : ''}">
${embed ? '' : `<div class="sheet-tools"><button id="do-print" type="button">Print / Save as PDF</button><a href="/admin/issues/${d.issue.id}">Back to editor</a><span class="note">Paper size A3 · Margins None · Background graphics on</span></div>`}
<div id="root"></div><script type="application/json" id="issue-data">${json({ settings: d.settings, pages: d.pages })}</script><script src="/js/newspaper.js"></script></body></html>`);
  });
};
