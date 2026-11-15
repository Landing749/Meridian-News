// Homepage manager (featured story, pinned lead stories, section visibility) and staff departments.
const db = require('../db');
const { requirePerm, audit } = require('../auth');
const { esc, fmtDate } = require('../util');
const Q = require('../queries');
const H = require('../homepage');
const { deliver } = require('../cloud');
const ST = require('../staff');
const back = (res, url, ok, err) => res.redirect(url + (url.includes('?') ? '&' : '?') + (err ? 'err=' + encodeURIComponent(err) : 'ok=' + encodeURIComponent(ok)));

module.exports = (router, V) => {
  const { layout, csrf, confirmBtn, empty, table } = V;
  const field = (id, label, val = '', o = {}) => `<div class="field"><label for="${id}">${label}</label>${o.area ? `<textarea id="${id}" name="${o.name || id}" rows="${o.rows || 3}" maxlength="${o.max || 600}">${esc(val)}</textarea>` : `<input id="${id}" name="${o.name || id}" type="text" value="${esc(val)}" maxlength="${o.max || 100}"${o.req ? ' required' : ''}>`}${o.help ? `<div class="help">${o.help}</div>` : ''}</div>`;

  // ===================== Homepage manager =====================
  const label = a => `${a.title || 'Untitled'} — ${a.category || 'Uncategorized'} · ${fmtDate(a.published_at)}`;
  const opts = (rows, cur) => rows.map(a => `<option value="${a.id}"${cur === a.id ? ' selected' : ''}>${esc(label(a))}</option>`).join('');

  router.get('/homepage', requirePerm('homepage.manage'), (req, res) => {
    const bn = H.banner(), bnLib = db.all('media').sort((x, y) => y.id - x.id).slice(0, 60);
    const R = H.resolve(), fid = H.featuredId(), live = Q.search({ limit: 100 }).rows, pins = H.pinRows(), pinned = new Set(pins.map(p => p.id));
    const fidLive = fid ? H.liveArticle(fid) : null, liveOpts = fidLive && !live.some(a => a.id === fid) ? [fidLive, ...live] : live;
    const slotOf = new Map(R.stories.map((a, i) => [a.id, H.SLOTS[i]]));
    const pinTable = pins.length ? table(['Position', 'Story', 'Shown on the homepage as', 'Actions'], pins.map((p, i) => {
      const a = H.liveArticle(p.id) || (db.get('articles', p.id) && { ...db.get('articles', p.id), category: db.get('categories', db.get('articles', p.id).category_id)?.name });
      const isLive = !!H.liveArticle(p.id), where = !isLive ? '<span class="badge draft">Not published, skipped</span>' : R.top && R.top.id === p.id ? '<span class="badge">Front-page story, skipped here</span>' : `<span class="badge published">${esc(slotOf.get(p.id) || 'Beyond the last slot')}</span>`;
      const mv = d => `<form method="post" action="/admin/homepage/pins/${p.id}/move">${csrf(req)}<input type="hidden" name="dir" value="${d}"><button class="btn paper-btn small"${(d === 'up' && i === 0) || (d === 'down' && i === pins.length - 1) ? ' disabled' : ''} aria-label="Move “${esc(a?.title)}” ${d === 'up' ? 'earlier' : 'later'}">${d === 'up' ? '↑' : '↓'}</button></form>`;
      return `<tr><td><div class="row-actions">${mv('up')}${mv('down')}</div></td><td><b>${esc(a?.title || 'Deleted article')}</b><div class="muted">${esc(a?.category || '')}</div></td><td>${where}</td><td><form method="post" action="/admin/homepage/pins/${p.id}/remove">${csrf(req)}<button class="btn paper-btn small">Unpin</button></form></td></tr>`;
    }), 'Pinned stories') : empty('Nothing pinned', 'The homepage is filling its story slots with the newest articles. Pin a story below to choose what goes where.');
    const free = live.filter(a => !pinned.has(a.id) && !(R.top && R.top.id === a.id));
    const now = [[ 'Front-page story', R.top, R.manualTop ? 'Chosen by you' : 'Automatic' ], ...H.SLOTS.map((s, i) => [s, R.stories[i], R.stories[i] && R.pinnedIds.has(R.stories[i].id) ? 'Pinned' : 'Automatic'])];
    const sections = H.SECTIONS.map(s => {
      const info = { announcements: () => `${Q.search({ announcement: true, limit: 1 }).total} published`, careers: () => `${db.count('jobs', j => j.status === 'published')} open position(s)`, leadership: () => `${db.count('staff', m => m.visible === 1 && m.show_on_home === 1)} on the homepage` }[s.key];
      return `<li class="sec-toggle"><label><input type="checkbox" name="show_${s.key}" value="1"${H.isShown(s.key) ? ' checked' : ''}> <b>${esc(s.label)}</b></label><div class="help">${esc(s.help)}${info ? ` <span class="muted">(${info()})</span>` : ''}</div></li>`;
    }).join('');
    res.send(layout(req, { title: 'Homepage Manager', body: `<p class="muted" style="margin-top:0">Choose what leads the public homepage. Only published articles can be featured or pinned; anything not yet published is skipped until it goes live. <a href="/" target="_blank" rel="noopener">Open the homepage</a></p>
<section class="paper panel" style="margin-bottom:1.4rem"><h2>Homepage banner</h2><p class="muted" style="margin-top:0">A wide photo across the top of the front page, under the masthead. Leave it out and the homepage looks as it did before.</p>${bn ? `<figure style="margin:0 0 1rem"><img src="${esc(deliver(bn.url, 900))}" alt="${esc(bn.alt)}" style="max-width:100%;border-radius:3px"><figcaption class="muted">Currently shown on the homepage.</figcaption></figure>` : '<p class="muted">No banner set.</p>'}
<form method="post" action="/admin/homepage/banner?_csrf=${req.csrf}" enctype="multipart/form-data" class="formgrid">${csrf(req)}<div class="field"><label for="bn-file">${bn ? 'Replace photo' : 'Upload a photo'}</label><input id="bn-file" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"><div class="help">JPG, PNG, WebP or GIF, up to 5 MB. Wide photos work best: about 2400 × 900 pixels (roughly 8:3). The sides and edges may be cropped on narrow screens.</div></div>
<div class="field"><label for="bn-lib">Or use a photo already in the media library</label><select id="bn-lib" name="media_id"><option value="">Keep the photo above</option>${bnLib.map(m => `<option value="${m.id}">${esc(m.display_name || m.original_name || 'Image ' + m.id)}</option>`).join('')}</select></div>
${field('bn-alt', 'Alternative text (required)', bn ? bn.alt : '', { name: 'alt', max: 250, req: 1, help: 'Describe the photo for people who cannot see it.' })}${field('bn-cap', 'Caption (optional)', bn ? bn.caption : '', { name: 'caption', max: 300 })}
<div class="field" style="align-self:end"><button class="btn">Save banner</button></div></form>${bn ? `<form method="post" action="/admin/homepage/banner/remove" style="margin-top:.8rem">${csrf(req)}<button class="btn paper-btn small">Remove banner</button></form>` : ''}</section>
<section class="paper panel" style="margin-bottom:1.4rem"><h2>On the homepage right now</h2>${table(['Place', 'Story', 'Source'], now.map(([s, a, src]) => `<tr><td>${esc(s)}</td><td>${a ? `<b>${esc(a.title)}</b> <span class="muted">· ${esc(a.category || 'Uncategorized')}</span>` : '<span class="muted">Empty: not enough published articles</span>'}</td><td>${a ? `<span class="badge${src === 'Automatic' ? '' : ' published'}">${src}</span>` : ''}</td></tr>`), 'Current homepage layout')}</section>
<section class="paper panel" style="margin-bottom:1.4rem"><h2>Featured story</h2><p class="muted" style="margin-top:0">The large story at the top of the front page.</p>${fid && !fidLive ? '<div class="notice bad" role="alert">The story you chose is no longer published, so the homepage is using the automatic choice. Pick another or switch back to automatic.</div>' : ''}
<form method="post" action="/admin/homepage/featured" class="toolbar">${csrf(req)}<div class="field" style="min-width:min(520px,100%)"><label for="hf">Featured story</label><select id="hf" name="article_id"><option value="">Automatic: the newest article marked “Featured”, otherwise the newest article</option>${opts(liveOpts, fidLive ? fid : null)}</select></div><button class="btn">Save featured story</button></form></section>
<section class="paper panel" style="margin-bottom:1.4rem"><h2>Lead stories</h2><p class="muted" style="margin-top:0">Pinned stories fill the slots below the front-page story in this order: lead story, three side stories, then the row of three. Newest articles fill any slots left over (${pins.length} of ${H.MAX_PINS} pinned).</p>${pinTable}
<form method="post" action="/admin/homepage/pins" class="toolbar" style="margin-top:1rem">${csrf(req)}<div class="field" style="min-width:min(520px,100%)"><label for="hp">Pin a story</label><select id="hp" name="article_id"${pins.length >= H.MAX_PINS || !free.length ? ' disabled' : ''}><option value="">${pins.length >= H.MAX_PINS ? 'All slots are pinned. Unpin one first.' : free.length ? 'Choose a published story…' : 'No other published stories'}</option>${opts(free)}</select></div><button class="btn"${pins.length >= H.MAX_PINS || !free.length ? ' disabled' : ''}>Pin to homepage</button></form></section>
<section class="paper panel"><h2>Homepage sections</h2><p class="muted" style="margin-top:0">Untick a section to hide it from the homepage. This does not delete anything and does not affect the matching pages (News, Careers, Leadership, Contact).</p>
<form method="post" action="/admin/homepage/sections">${csrf(req)}<ul class="sec-toggles"><li class="sec-toggle"><label><input type="checkbox" checked disabled> <b>Masthead and front-page story</b></label><div class="help">Always shown.</div></li>${sections}</ul><button class="btn">Save sections</button></form></section>` }));
  });

  router.post('/homepage/featured', requirePerm('homepage.manage'), async (req, res) => {
    const id = +req.body.article_id;
    if (!id) { await H.setFeatured(null); audit(req, 'homepage_featured', 'homepage', null, 'automatic'); return back(res, '/admin/homepage', 'Featured story set to automatic.'); }
    const a = H.liveArticle(id); if (!a) return back(res, '/admin/homepage', '', 'Only published articles can be featured.');
    await H.setFeatured(id); audit(req, 'homepage_featured', 'homepage', id, a.title); back(res, '/admin/homepage', 'Featured story saved.');
  });
  router.post('/homepage/pins', requirePerm('homepage.manage'), async (req, res) => {
    const id = +req.body.article_id, a = H.liveArticle(id); if (!a) return back(res, '/admin/homepage', '', 'Choose a published story to pin.');
    const r = await H.pin(id); if (r === 'full') return back(res, '/admin/homepage', '', `All ${H.MAX_PINS} slots are pinned. Unpin one first.`); if (r === 'dup') return back(res, '/admin/homepage', '', 'That story is already pinned.');
    audit(req, 'homepage_pin', 'homepage', id, a.title); back(res, '/admin/homepage', 'Story pinned.');
  });
  router.post('/homepage/pins/:id/move', requirePerm('homepage.manage'), async (req, res) => { await H.movePin(+req.params.id, req.body.dir === 'up' ? 'up' : 'down'); audit(req, 'homepage_pin_move', 'homepage', req.params.id); back(res, '/admin/homepage', 'Order updated.'); });
  router.post('/homepage/pins/:id/remove', requirePerm('homepage.manage'), async (req, res) => { await H.unpin(+req.params.id); audit(req, 'homepage_unpin', 'homepage', req.params.id); back(res, '/admin/homepage', 'Story unpinned.'); });
  router.post('/homepage/sections', requirePerm('homepage.manage'), async (req, res) => {
    const hidden = []; for (const s of H.SECTIONS) { const on = !!req.body['show_' + s.key]; await H.setShown(s.key, on); if (!on) hidden.push(s.key); }
    audit(req, 'homepage_sections', 'homepage', null, hidden.length ? 'hidden: ' + hidden.join(', ') : 'all shown'); back(res, '/admin/homepage', 'Homepage sections saved.');
  });

  // ===================== Departments =====================
  router.get('/departments', requirePerm('staff.manage'), (req, res) => {
    const rows = ST.departments();
    const SV = require('../views/staff'), tree = ST.orgTree();
    res.send(layout(req, { title: 'Departments', body: `<p class="muted" style="margin-top:0">Departments group people on the Leadership page. Reporting lines are set on each person (“Reports to”) and drive the organization chart. <a href="/admin/staff">Back to Staff &amp; Leadership</a></p>
<section class="paper panel" style="margin-bottom:1.4rem"><h2>Add a department</h2><form method="post" action="/admin/departments" class="formgrid">${csrf(req)}${field('dn', 'Name', '', { name: 'name', req: 1 })}${field('dd', 'Description', '', { name: 'description', max: 300, help: 'Optional. Shown under the department heading on the Leadership page.' })}<div class="field" style="align-self:end"><button class="btn">Add department</button></div></form></section>
${rows.length ? table(['Order', 'Department', 'People', 'Actions'], rows.map((d, i) => `<tr><td><div class="row-actions">${['up', 'down'].map(x => `<form method="post" action="/admin/departments/${d.id}/move">${csrf(req)}<input type="hidden" name="dir" value="${x}"><button class="btn paper-btn small"${(x === 'up' && i === 0) || (x === 'down' && i === rows.length - 1) ? ' disabled' : ''} aria-label="Move ${esc(d.name)} ${x}">${x === 'up' ? '↑' : '↓'}</button></form>`).join('')}</div></td>
<td><form method="post" action="/admin/departments/${d.id}" class="formgrid">${csrf(req)}${field('n' + d.id, 'Name', d.name, { name: 'name', req: 1 })}${field('d' + d.id, 'Description', d.description, { name: 'description', max: 300 })}<div class="field" style="align-self:end"><button class="btn small">Save</button></div></form></td><td>${d.n}</td>
<td>${confirmBtn(req, `/admin/departments/${d.id}/delete`, 'Delete', `Delete “${d.name}”? ${d.n ? d.n + ' person(s) will become unassigned.' : 'No one is assigned to it.'}`)}</td></tr>`), 'Departments') : empty('No departments', 'Add departments such as Executive Office, Newsroom or Operations.')}
${tree.count ? `<section style="margin-top:1.6rem"><h2 style="font-size:1.2rem">Organization chart preview</h2><p class="muted">What visitors see on the Leadership page (hidden people are left out).</p><div class="paper panel org-preview">${SV.reportingChart(tree)}</div></section>` : ''}` }));
  });
  const deptSave = async (req, res) => {
    const id = req.params.id ? +req.params.id : null, name = String(req.body.name || '').trim().slice(0, 100), desc = String(req.body.description || '').trim().slice(0, 300);
    if (!name) return back(res, '/admin/departments', '', 'Enter a department name.');
    if (db.find('departments', d => d.name.toLowerCase() === name.toLowerCase() && d.id !== (id || 0))) return back(res, '/admin/departments', '', 'A department with that name already exists.');
    if (id) { if (!db.get('departments', id)) return back(res, '/admin/departments', '', 'Department not found.'); await db.update('departments', id, { name, description: desc }); await ST.syncDepartmentNames(); }
    else { await db.insert('departments', { name, slug: ST.uniqueSlug('departments', name, 0, 'department'), description: desc, sort: Math.max(-1, ...db.all('departments').map(d => d.sort)) + 1 }); }
    audit(req, id ? 'department_updated' : 'department_created', 'department', id || name, name); back(res, '/admin/departments', 'Department saved.');
  };
  router.post('/departments', requirePerm('staff.manage'), deptSave);
  router.post('/departments/:id', requirePerm('staff.manage'), deptSave);
  router.post('/departments/:id/move', requirePerm('staff.manage'), async (req, res) => {
    const ids = db.all('departments').sort((x, y) => x.sort - y.sort || x.id - y.id).map(x => x.id), i = ids.indexOf(+req.params.id), j = req.body.dir === 'up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; const b = db.batch(); ids.forEach((id, n) => b.patch('departments', id, { sort: n })); await b.commit(); }
    back(res, '/admin/departments', 'Order updated.');
  });
  router.post('/departments/:id/delete', requirePerm('staff.manage'), async (req, res) => {
    const d = db.get('departments', +req.params.id); if (!d) return back(res, '/admin/departments', '', 'Department not found.');
    await db.remove('departments', d.id); await ST.syncDepartmentNames();
    audit(req, 'department_deleted', 'department', d.id, d.name); back(res, '/admin/departments', 'Department deleted.');
  });
};
