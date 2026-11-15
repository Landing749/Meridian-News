const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { getSetting, setSetting } = db;
const cloud = require('../cloud');
const identity = require('../identity');
const { deliver } = cloud;
const cms = require('../cms');
const H = require('../homepage');
const A = require('../auth');
const { can, requirePerm, audit, ROLES } = A;
const U = require('../util');
const { esc, slugify, fmtDate, rand } = U;
const back = (res, url, ok, err) => res.redirect(url + (url.includes('?') ? '&' : '?') + (err ? 'err=' + encodeURIComponent(err) : 'ok=' + encodeURIComponent(ok)));

// ---- Safe uploads: size cap, content sniffing (never trust the extension or client MIME), random filenames, no SVG ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 } });
function sniff(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  if (b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.slice(0, 6).toString())) return ['image/gif', 'gif'];
  return null;
}
// Stores an image in Cloudinary and records it in the media library. Resolves to the media row.
async function saveUpload(file, userId, existing) {
  const t = sniff(file.buffer);
  if (!t) throw new Error(`“${file.originalname}” is not a supported image. Use JPG, PNG, WebP or GIF.`);
  let r;
  try { r = await cloud.upload(file.buffer, { image: true, publicId: rand(12) }); }
  catch (e) { console.error('Cloudinary upload failed:', e.message || e); throw new Error(`“${file.originalname}” could not be uploaded. Try again in a moment.`); }
  const orig = path.basename(file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const fields = { filename: r.public_id, url: r.secure_url, resource_type: 'image', width: r.width || null, height: r.height || null, mime: t[0], size: file.size, original_name: orig };
  if (existing) { await db.update('media', existing.id, fields); cloud.destroy(existing.filename, true).catch(e => console.error('Cloudinary delete failed:', e.message)); return db.get('media', existing.id); }
  return db.insert('media', { ...fields, display_name: orig.replace(/\.[^.]+$/, ''), uploaded_by: userId });
}
const handleUpload = (field, max) => (req, res, next) => (max > 1 ? upload.array(field, max) : upload.single(field))(req, res, e => e ? ((req.xhr || (req.headers.accept || '').includes('json')) ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller.' : e.message }) : back(res, req.get('referer') || '/admin/media', '', e.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller.' : e.message)) : next());
// An image is "in use" if any record points at it: by id, by its Cloudinary public id inside a stored URL, or inside an article body.
const mediaInUse = m => {
  const has = v => !!m.filename && String(v || '').includes(m.filename);
  return has(db.homeConfig.get('banner_url', '')) || db.all('articles').some(a => a.featured_media_id === m.id || has(a.body)) || db.all('categories').some(c => has(c.image)) || db.all('authors').some(a => has(a.image)) || db.all('staff').some(x => has(x.image))
    || db.all('issue_pages').some(p => p.photo_media_id === m.id) || db.all('issues').some(i => i.left_logo_media_id === m.id || i.right_logo_media_id === m.id);
};
const contains = (s, ...fields) => { const k = String(s || '').toLowerCase(); return r => !k || fields.some(f => String(r[f] || '').toLowerCase().includes(k)); };

module.exports = (router, V) => {
  const { layout, status, csrf, confirmBtn, empty, table, cols, hbars, pager } = V;
  const field = (id, label, val = '', o = {}) => `<div class="field"><label for="${id}">${label}</label>${o.area ? `<textarea id="${id}" name="${o.name || id}" rows="${o.rows || 4}" maxlength="${o.max || 5000}">${esc(val)}</textarea>` : `<input id="${id}" name="${o.name || id}" type="${o.type || 'text'}" value="${esc(val)}" maxlength="${o.max || 200}"${o.req ? ' required' : ''}>`}${o.help ? `<div class="help">${o.help}</div>` : ''}</div>`;

  // ===== Categories =====
  router.get('/categories', requirePerm('taxonomy.categories'), (req, res) => {
    const rows = db.all('categories').sort((x, y) => x.position - y.position || x.name.localeCompare(y.name)).map(c => ({ ...c, n: db.count('articles', a => a.category_id === c.id) })), cats = rows;
    const body = `<section class="paper panel" style="margin-bottom:1.4rem"><h2>Add a category</h2><form method="post" action="/admin/categories?_csrf=${req.csrf}" enctype="multipart/form-data" class="formgrid">${csrf(req)}${field('nn', 'Name', '', { name: 'name', req: 1, max: 60 })}${field('ns', 'URL slug', '', { name: 'slug', max: 60, help: 'Leave blank to create it from the name.' })}${field('nd', 'Description', '', { name: 'description', max: 300 })}<div class="field"><label for="ni">Category image (optional)</label><input id="ni" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></div><div class="field" style="align-self:end"><button class="btn" type="submit">Add category</button></div></form></section>
${table(['Order', 'Category', 'Articles', 'Status', 'Edit'], rows.map((c, i) => `<tr><td><div class="row-actions"><form method="post" action="/admin/categories/${c.id}/move">${csrf(req)}<input type="hidden" name="dir" value="up"><button class="btn paper-btn small" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(c.name)} up">↑</button></form><form method="post" action="/admin/categories/${c.id}/move">${csrf(req)}<input type="hidden" name="dir" value="down"><button class="btn paper-btn small" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(c.name)} down">↓</button></form></div></td>
<td><form method="post" action="/admin/categories/${c.id}?_csrf=${req.csrf}" enctype="multipart/form-data" class="formgrid">${csrf(req)}${field('n' + c.id, 'Name', c.name, { name: 'name', max: 60 })}${field('s' + c.id, 'Slug', c.slug, { name: 'slug', max: 60 })}${field('d' + c.id, 'Description', c.description, { name: 'description', max: 300 })}<div class="field"><label for="i${c.id}">Image</label>${c.image ? `<img src="${esc(deliver(c.image, 120))}" alt="" width="60" style="display:block;margin-bottom:4px">` : ''}<input id="i${c.id}" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></div><div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" name="active" value="1"${c.active ? ' checked' : ''}> Active (shown publicly)</label><button class="btn small" style="margin-top:.5rem">Save</button></div></form></td>
<td>${c.n}</td><td>${c.active ? 'Active' : 'Hidden'}</td><td>${c.n ? `<form method="post" action="/admin/categories/${c.id}/delete" class="row-actions">${csrf(req)}<label class="sr" for="mv${c.id}">Move articles to</label><select id="mv${c.id}" name="move_to" style="min-width:140px"><option value="">Move ${c.n} article(s) to…</option>${cats.filter(x => x.id !== c.id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="btn danger small" type="submit" data-confirm="Move this category’s articles to the chosen category and delete “${esc(c.name)}”?">Delete</button></form>` : confirmBtn(req, `/admin/categories/${c.id}/delete`, 'Delete', `Delete the empty category “${c.name}”?`)}</td></tr>`), 'Categories')}`;
    res.send(layout(req, { title: 'Categories', body }));
  });
  const catSave = async (req, res) => {
    const id = req.params.id ? +req.params.id : null, b = req.body, name = String(b.name || '').trim().slice(0, 60);
    if (!name) return back(res, '/admin/categories', '', 'Enter a category name.');
    const slug = slugify(b.slug || name); if (!slug) return back(res, '/admin/categories', '', 'Enter a valid slug.');
    if (['feed'].includes(slug) || db.find('categories', c => c.slug === slug && c.id !== (id || 0))) return back(res, '/admin/categories', '', 'That slug is already used.');
    let img = null; try { if (req.file) img = (await saveUpload(req.file, req.user.id)).url; } catch (e) { return back(res, '/admin/categories', '', e.message); }
    const desc = String(b.description || '').slice(0, 300);
    if (id) { if (!db.get('categories', id)) return back(res, '/admin/categories', '', 'Category not found.'); await db.update('categories', id, { name, slug, description: desc, active: b.active ? 1 : 0, ...(img ? { image: img } : {}) }); audit(req, 'category_updated', 'category', id, name); }
    else { const pos = Math.max(0, ...db.all('categories').map(c => c.position)) + 1; await db.insert('categories', { name, slug, description: desc, image: img || '', position: pos }); audit(req, 'category_created', 'category', slug, name); }
    back(res, '/admin/categories', 'Category saved.');
  };
  router.post('/categories', requirePerm('taxonomy.categories'), handleUpload('image', 1), catSave);
  router.post('/categories/:id', requirePerm('taxonomy.categories'), handleUpload('image', 1), catSave);
  router.post('/categories/:id/move', requirePerm('taxonomy.categories'), async (req, res) => {
    const rows = db.all('categories').sort((x, y) => x.position - y.position || x.name.localeCompare(y.name)), i = rows.findIndex(r => r.id === +req.params.id), j = i + (req.body.dir === 'up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= rows.length) return back(res, '/admin/categories', 'Already at the edge.');
    [rows[i], rows[j]] = [rows[j], rows[i]];
    const b = db.batch(); rows.forEach((r, k) => b.patch('categories', r.id, { position: k + 1 })); await b.commit();
    back(res, '/admin/categories', 'Order updated.');
  });
  router.post('/categories/:id/delete', requirePerm('taxonomy.categories'), async (req, res) => {
    const id = +req.params.id, c = db.get('categories', id); if (!c) return back(res, '/admin/categories', '', 'Category not found.');
    const inCat = db.where('articles', a => a.category_id === id), n = inCat.length, mv = +req.body.move_to;
    if (n && !(mv && mv !== id && db.get('categories', mv))) return back(res, '/admin/categories', '', `“${c.name}” has ${n} article(s). Choose where to move them first.`);
    const b = db.batch(); for (const a of inCat) b.patch('articles', a.id, { category_id: mv }); b.del('categories', id); await b.commit();
    audit(req, 'category_deleted', 'category', id, `${c.name}; moved ${n} to ${mv || '-'}`); back(res, '/admin/categories', 'Category deleted.');
  });

  // ===== Tags =====
  router.get('/tags', requirePerm('taxonomy.tags'), (req, res) => {
    const s = String(req.query.q || '').trim(), rows = db.all('tags').filter(contains(s, 'name')).sort((x, y) => x.name.localeCompare(y.name)).map(t => ({ ...t, n: db.count('article_tags', r => r.tag_id === t.id) }));
    res.send(layout(req, { title: 'Tags', body: `<div class="toolbar"><form method="get" role="search" class="toolbar" style="margin:0">${field('q', 'Search tags', s, { type: 'search' })}<button class="btn paper-btn">Search</button></form><form method="post" action="/admin/tags" class="toolbar" style="margin:0">${csrf(req)}${field('tn', 'New tag', '', { name: 'name', max: 40, req: 1 })}<button class="btn">Add tag</button></form></div>
${rows.length ? table(['Tag', 'Articles', 'Actions'], rows.map(t => `<tr><td><form method="post" action="/admin/tags/${t.id}" class="row-actions">${csrf(req)}<label class="sr" for="t${t.id}">Rename ${esc(t.name)}</label><input id="t${t.id}" name="name" value="${esc(t.name)}" maxlength="40" style="max-width:260px"><button class="btn paper-btn small">Rename</button></form></td><td>${t.n}</td><td>${confirmBtn(req, `/admin/tags/${t.id}/delete`, 'Delete', `Delete the tag “${t.name}”? It will be removed from ${t.n} article(s); the articles stay.`)}</td></tr>`), 'Tags') : empty('No tags found', 'Add a tag above or type new tags in the article editor.')}` }));
  });
  const tagSave = async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 40), id = req.params.id ? +req.params.id : null; if (!name) return back(res, '/admin/tags', '', 'Enter a tag name.');
    const slug = slugify(name) || 'tag'; if (db.find('tags', t => (t.name.toLowerCase() === name.toLowerCase() || t.slug === slug) && t.id !== (id || 0))) return back(res, '/admin/tags', '', 'A tag with that name already exists.');
    if (id) await db.update('tags', id, { name, slug }); else await db.insert('tags', { name, slug });
    audit(req, id ? 'tag_updated' : 'tag_created', 'tag', id || slug, name); back(res, '/admin/tags', 'Tag saved.');
  };
  router.post('/tags', requirePerm('taxonomy.tags'), tagSave); router.post('/tags/:id', requirePerm('taxonomy.tags'), tagSave);
  router.post('/tags/:id/delete', requirePerm('taxonomy.tags'), async (req, res) => { await db.remove('tags', +req.params.id); audit(req, 'tag_deleted', 'tag', req.params.id); back(res, '/admin/tags', 'Tag deleted.'); });

  // ===== Authors =====
  router.get('/authors', requirePerm('authors.manage'), (req, res) => {
    const rows = db.all('authors').sort((x, y) => x.name.localeCompare(y.name)).map(a => ({ ...a, pub: db.count('articles', x => x.author_id === a.id && x.status === 'published'), tot: db.count('articles', x => x.author_id === a.id) }));
    res.send(layout(req, { title: 'Authors', body: `<section class="paper panel" style="margin-bottom:1.4rem"><h2>Add an author</h2><form method="post" action="/admin/authors?_csrf=${req.csrf}" enctype="multipart/form-data" class="formgrid">${csrf(req)}${field('an', 'Name', '', { name: 'name', req: 1 })}${field('at', 'Job title', '', { name: 'title' })}${field('as', 'Slug', '', { name: 'slug', help: 'Blank = from name.' })}${field('ab', 'Short biography', '', { name: 'bio', area: 1, rows: 3, max: 600, help: 'Only add verified information.' })}<div class="field"><label for="ai">Profile image</label><input id="ai" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></div><div class="field" style="align-self:end"><button class="btn">Add author</button></div></form></section>
${rows.length ? table(['Author', 'Published', 'Edit'], rows.map(a => `<tr><td><form method="post" action="/admin/authors/${a.id}?_csrf=${req.csrf}" enctype="multipart/form-data" class="formgrid">${csrf(req)}${field('n' + a.id, 'Name', a.name, { name: 'name' })}${field('t' + a.id, 'Job title', a.title, { name: 'title' })}${field('s' + a.id, 'Slug', a.slug, { name: 'slug' })}${field('b' + a.id, 'Biography', a.bio, { name: 'bio', area: 1, rows: 2, max: 600 })}<div class="field"><label for="i${a.id}">Image</label>${a.image ? `<img src="${esc(deliver(a.image, 96))}" width="48" alt="" style="display:block;margin-bottom:4px">` : ''}<input id="i${a.id}" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></div><div class="field" style="align-self:end"><button class="btn small">Save</button> ${a.is_sample ? '<span class="badge sample">Sample</span>' : ''}</div></form></td><td>${a.pub} of ${a.tot}</td><td>${a.tot ? '<span class="muted">Has articles</span>' : confirmBtn(req, `/admin/authors/${a.id}/delete`, 'Delete', `Delete author “${a.name}”?`)}</td></tr>`), 'Authors') : empty('No authors yet', 'Add an author to start assigning bylines.')}` }));
  });
  const authSave = async (req, res) => {
    const id = req.params.id ? +req.params.id : null, name = String(req.body.name || '').trim().slice(0, 100); if (!name) return back(res, '/admin/authors', '', 'Enter the author’s name.');
    let slug = slugify(req.body.slug || name), c = slug, i = 1; while (db.find('authors', a => a.slug === c && a.id !== (id || 0))) c = `${slug}-${++i}`; slug = c;
    let img = null; try { if (req.file) img = (await saveUpload(req.file, req.user.id)).url; } catch (e) { return back(res, '/admin/authors', '', e.message); }
    const t = String(req.body.title || '').slice(0, 100), bio = String(req.body.bio || '').slice(0, 600);
    if (id) await db.update('authors', id, { name, slug, title: t, bio, ...(img ? { image: img } : {}) }); else await db.insert('authors', { name, slug, title: t, bio, image: img || '' });
    audit(req, id ? 'author_updated' : 'author_created', 'author', id || slug, name); back(res, '/admin/authors', 'Author saved.');
  };
  router.post('/authors', requirePerm('authors.manage'), handleUpload('image', 1), authSave); router.post('/authors/:id', requirePerm('authors.manage'), handleUpload('image', 1), authSave);
  router.post('/authors/:id/delete', requirePerm('authors.manage'), async (req, res) => { if (db.find('articles', a => a.author_id === +req.params.id)) return back(res, '/admin/authors', '', 'This author has articles and cannot be deleted.'); await db.remove('authors', +req.params.id); audit(req, 'author_deleted', 'author', req.params.id); back(res, '/admin/authors', 'Author deleted.'); });

  // ===== Media library =====
  router.get('/api/media', requirePerm('media.upload'), (req, res) => {
    const s = String(req.query.q || '').trim();
    res.json({ items: db.all('media').filter(contains(s, 'display_name', 'alt')).sort((x, y) => y.id - x.id).slice(0, 60).map(m => ({ id: m.id, url: deliver(m.url, 1600), thumb: deliver(m.url, 320), display_name: m.display_name, alt: m.alt, caption: m.caption, credit: m.credit })) });
  });
  router.get('/media', requirePerm('media.upload'), (req, res) => {
    const s = String(req.query.q || '').trim(), rows = db.all('media').filter(contains(s, 'display_name', 'alt')).sort((x, y) => y.id - x.id), mg = can(req.user, 'media.manage');
    res.send(layout(req, { title: 'Media Library', body: `<section class="paper panel" style="margin-bottom:1.4rem"><h2>Upload images</h2><form method="post" action="/admin/media?_csrf=${req.csrf}" enctype="multipart/form-data" class="toolbar">${csrf(req)}<div class="field"><label for="up">Images (JPG, PNG, WebP or GIF, up to 5 MB each)</label><input id="up" type="file" name="files" multiple required accept="image/jpeg,image/png,image/webp,image/gif"></div><button class="btn">Upload</button></form></section>
<form class="toolbar" role="search">${field('q', 'Search media', s, { type: 'search' })}<button class="btn paper-btn">Search</button></form>
${rows.length ? `<div class="mgrid">${rows.map(m => `<article class="paper mitem"><img src="${esc(deliver(m.url, 480))}" alt="${esc(m.alt)}" loading="lazy"><p class="muted" style="margin:.4rem 0">${esc(m.mime)} · ${Math.round(m.size / 1024)} KB${mediaInUse(m) ? ' · in use' : ''}</p>
${mg ? `<form method="post" action="/admin/media/${m.id}?_csrf=${req.csrf}" enctype="multipart/form-data">${csrf(req)}${field('dn' + m.id, 'Name', m.display_name, { name: 'display_name', max: 120 })}${field('al' + m.id, 'Alternative text', m.alt, { name: 'alt', max: 250 })}${field('ca' + m.id, 'Caption', m.caption, { name: 'caption', max: 300 })}${field('cr' + m.id, 'Credit', m.credit, { name: 'credit', max: 200 })}<div class="field"><label for="rp${m.id}">Replace image</label><input id="rp${m.id}" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif"></div><div class="row-actions"><button class="btn small">Save</button></div></form><div style="margin-top:.5rem">${confirmBtn(req, `/admin/media/${m.id}/delete`, 'Delete', `Delete “${m.display_name}”? Images in use cannot be deleted.`)}</div>` : `<b>${esc(m.display_name)}</b><br><span class="muted">${esc(m.alt)}</span>`}</article>`).join('')}</div>` : empty('No images yet', 'Upload your first image above.')}` }));
  });
  // Homepage banner. Lives here because it shares the upload helpers above; the form is on the Homepage Manager page.
  router.post('/homepage/banner', requirePerm('homepage.manage'), handleUpload('image', 1), async (req, res) => {
    const b = req.body, alt = String(b.alt || '').trim().slice(0, 250), caption = String(b.caption || '').trim().slice(0, 300), cur = H.banner();
    let url = '';
    if (req.file) {
      try { const m = await saveUpload(req.file, req.user.id); url = m.url; } catch (e) { return back(res, '/admin/homepage', '', e.message); }
    } else if (+b.media_id) {
      const m = db.get('media', +b.media_id); if (!m) return back(res, '/admin/homepage', '', 'That image is no longer in the media library.'); url = m.url;
    } else if (cur) url = cur.url; // only the alt text or caption changed
    if (!url) return back(res, '/admin/homepage', '', 'Choose a photo to upload or pick one from the media library.');
    if (!alt) return back(res, '/admin/homepage', '', 'Describe the photo in the alternative text so people using screen readers know what it shows.');
    await H.setBanner({ url, alt, caption }); audit(req, 'homepage_banner', 'homepage', null, req.file ? 'uploaded' : 'updated');
    back(res, '/admin/homepage', 'Homepage banner saved.');
  });
  router.post('/homepage/banner/remove', requirePerm('homepage.manage'), async (req, res) => { await H.clearBanner(); audit(req, 'homepage_banner', 'homepage', null, 'removed'); back(res, '/admin/homepage', 'Homepage banner removed.'); });

  // One-image upload for the article editor's cover photo: stores the file, adds it to the media library, returns the library item.
  router.post('/api/media/upload', requirePerm('media.upload'), handleUpload('file', 1), async (req, res) => {
    if (!req.file) return res.status(422).json({ error: 'Choose an image to upload.' });
    try {
      const m = await saveUpload(req.file, req.user.id);
      audit(req, 'media_uploaded', 'media', m.id, m.display_name);
      res.json({ item: { id: m.id, url: deliver(m.url, 1600), thumb: deliver(m.url, 320), display_name: m.display_name, alt: m.alt, caption: m.caption, credit: m.credit } });
    } catch (e) { res.status(422).json({ error: e.message }); }
  });
  router.post('/media', requirePerm('media.upload'), handleUpload('files', 10), async (req, res) => {
    let n = 0, errs = [];
    for (const f of req.files || []) { try { await saveUpload(f, req.user.id); n++; } catch (e) { errs.push(e.message); } }
    if (n) audit(req, 'media_uploaded', 'media', null, `${n} file(s)`);
    errs.length ? back(res, '/admin/media', '', (n ? `${n} uploaded. ` : '') + errs.join(' ')) : back(res, '/admin/media', `${n} image(s) uploaded.`);
  });
  router.post('/media/:id', requirePerm('media.manage'), handleUpload('file', 1), async (req, res) => {
    const m = db.get('media', +req.params.id); if (!m) return back(res, '/admin/media', '', 'Image not found.');
    try { if (req.file) await saveUpload(req.file, req.user.id, m); } catch (e) { return back(res, '/admin/media', '', e.message); }
    await db.update('media', m.id, { display_name: String(req.body.display_name || m.display_name).slice(0, 120), alt: String(req.body.alt || '').slice(0, 250), caption: String(req.body.caption || '').slice(0, 300), credit: String(req.body.credit || '').slice(0, 200) });
    audit(req, 'media_updated', 'media', m.id); back(res, '/admin/media', 'Image saved.');
  });
  router.post('/media/:id/delete', requirePerm('media.manage'), async (req, res) => {
    const m = db.get('media', +req.params.id); if (!m) return back(res, '/admin/media', '', 'Image not found.');
    if (mediaInUse(m)) return back(res, '/admin/media', '', 'That image is used by an article, category, author or team member. Remove it there first.');
    await db.remove('media', m.id); cloud.destroy(m.filename, true).catch(e => console.error('Cloudinary delete failed:', e.message)); audit(req, 'media_deleted', 'media', m.id, m.display_name); back(res, '/admin/media', 'Image deleted.');
  });

  // ===== Staff & leadership =====
  const ST = require('../staff');
  const pick = (id, name, label, options, cur, help) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${help ? `<div class="help">${help}</div>` : ''}</div>`;
  const staffForm = (req, m = {}, err = '') => {
    const depts = ST.departments(), people = db.all('staff').sort((x, y) => x.sort - y.sort || x.id - y.id).filter(x => !m.id || (x.id !== m.id && !ST.wouldCycle(m.id, x.id)));
    const authors = db.where('authors', a => !db.find('staff', x => x.author_id === a.id && x.id !== (m.id || 0))).sort((x, y) => x.name.localeCompare(y.name));
    return `<form method="post" action="/admin/staff${m.id ? '/' + m.id : ''}?_csrf=${req.csrf}" enctype="multipart/form-data" class="paper panel">${csrf(req)}${err ? `<div class="notice bad" role="alert">${esc(err)}</div>` : ''}
<h2>Profile</h2><div class="formgrid">${field('sn', 'Full name', m.name, { name: 'name', req: 1, max: 100 })}${field('st', 'Position / title', m.title, { name: 'title', max: 100 })}${pick('sd', 'department_id', 'Department', [['', 'No department'], ...depts.map(d => [d.id, d.name])], m.department_id, '<a href="/admin/departments">Manage departments</a>')}${pick('sr', 'reports_to', 'Reports to', [['', 'No one (top of the organization chart)'], ...people.map(p => [p.id, p.name + (p.title ? ' — ' + p.title : '')])], m.reports_to, 'Sets this person’s place on the organization chart.')}${field('ss', 'With MMG since', m.since, { name: 'since', max: 40, help: 'A year or date, for example 2014.' })}${field('sl', 'Profile URL', m.slug, { name: 'slug', max: 90, help: `Appears as /leadership/<b>${esc(m.slug || 'name')}</b>. Leave blank to ${m.id ? 'keep it' : 'create it from the name'}.` })}</div>
${field('sm', 'Motto in life', m.motto, { name: 'motto', max: 200, help: 'Shown as a quote on the profile card.' })}${field('sb', 'Short biography', m.bio, { name: 'bio', area: 1, rows: 4, max: 800, help: 'Only add verified information. A blank line starts a new paragraph on the profile page.' })}
<div class="field"><label for="si">Photo</label>${m.image ? `<img src="${esc(deliver(m.image, 192))}" width="96" alt="" style="display:block;margin-bottom:6px;border-radius:4px"><label style="display:flex;gap:.5rem;font-weight:500;margin-bottom:6px"><input type="checkbox" name="remove_image" value="1"> Remove current photo</label>` : ''}<input id="si" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></div>
<h2 style="margin-top:1.2rem">Links</h2><p class="muted" style="margin-top:0">Optional. Shown on the profile page and card. Only web links (https) are accepted.</p><div class="formgrid">${ST.SOCIAL.map(d => field('so-' + d.key, d.label, m[d.col], { name: d.col, max: 200, help: esc(d.ph) })).join('')}${field('so-email', 'Public email', m.social_email, { name: 'social_email', max: 120, help: 'Shown publicly. Leave blank if the person prefers contact through the inquiry form.' })}</div>
<h2 style="margin-top:1.2rem">Article byline</h2>${pick('sa', 'author_id', 'Linked author', [['', 'Not linked'], ...authors.map(a => [a.id, a.name]), ...(m.author_id ? [] : [['__new', 'Create a new byline from this name']])], m.author_id, 'Links this person to the author name used on articles. Their profile then lists their latest articles, and the author page links back to the profile.')}
<div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" name="visible" value="1"${m.id && !m.visible ? '' : ' checked'}> Show on the public website</label></div>
<div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" name="show_on_home" value="1"${m.id && !m.show_on_home ? '' : ' checked'}> Also show on the homepage</label></div>
<button class="btn">Save member</button> <a class="btn paper-btn" href="/admin/staff">Cancel</a></form>`;
  };
  router.get('/staff', requirePerm('staff.manage'), (req, res) => {
    const rows = db.all('staff').sort((x, y) => x.sort - y.sort || x.id - y.id).map(s => ({ ...s, boss: db.get('staff', s.reports_to)?.name || null, byline: db.get('authors', s.author_id)?.name || null }));
    res.send(layout(req, { title: 'Staff & Leadership', body: `<p><a class="btn" href="/admin/staff/new">Add team member</a> <a class="btn paper-btn" href="/admin/departments">Departments</a> <a class="btn paper-btn" href="/leadership#org-chart" target="_blank" rel="noopener">View organization chart</a></p><p class="muted" style="margin-top:0">Shown on the homepage and the Leadership page. The first member is the large lead card; the order below is used within each department.</p>${rows.length ? table(['Order', 'Member', 'Department and reporting line', 'Byline', 'Shown', 'Actions'], rows.map((m, i) => `<tr><td><div class="row-actions">${['up', 'down'].map(d => `<form method="post" action="/admin/staff/${m.id}/move">${csrf(req)}<input type="hidden" name="dir" value="${d}"><button class="btn paper-btn small"${(d === 'up' && i === 0) || (d === 'down' && i === rows.length - 1) ? ' disabled' : ''} aria-label="Move ${esc(m.name)} ${d}">${d === 'up' ? '↑' : '↓'}</button></form>`).join('')}</div></td><td><div style="display:flex;gap:.7rem;align-items:center">${m.image ? `<img src="${esc(deliver(m.image, 88))}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:50%">` : ''}<div><a href="/admin/staff/${m.id}"><b>${esc(m.name)}</b></a><div class="muted">${esc(m.title)}</div></div></div></td><td>${m.department ? esc(m.department) : '<span class="muted">No department</span>'}<div class="muted">${m.boss ? 'Reports to ' + esc(m.boss) : 'Top of chart'}</div></td><td>${m.byline ? esc(m.byline) : '—'}</td><td>${m.visible ? '<span class="badge published">Website</span>' : '<span class="badge draft">Hidden</span>'}${m.visible && m.show_on_home ? ' <span class="badge">Home</span>' : ''}${m.visible && m.slug ? `<div><a class="muted" href="/leadership/${esc(m.slug)}" target="_blank" rel="noopener">View profile</a></div>` : ''}</td><td>${confirmBtn(req, `/admin/staff/${m.id}/delete`, 'Remove', `Remove “${m.name}”?${db.count('staff', x => x.reports_to === m.id) ? ' People who report to them will move to the top of the chart.' : ''}`)}</td></tr>`), 'Staff') : empty('No team members', 'Add the CEO and other leaders to show them on the website.')}` }));
  });
  router.get('/staff/new', requirePerm('staff.manage'), (req, res) => res.send(layout(req, { title: 'Add team member', body: staffForm(req) })));
  router.get('/staff/:id', requirePerm('staff.manage'), (req, res) => { const m = db.get('staff', +req.params.id); if (!m) return back(res, '/admin/staff', '', 'Team member not found.'); res.send(layout(req, { title: 'Edit team member', body: staffForm(req, m) })); });
  const staffSave = async (req, res) => {
    const b = req.body, id = req.params.id ? +req.params.id : null, S = (v, n) => String(v ?? '').trim().slice(0, n), name = S(b.name, 100);
    const cur = id ? db.get('staff', id) : null;
    if (id && !cur) return back(res, '/admin/staff', '', 'Team member not found.');
    // Values as typed, so the form can be shown again with the error and nothing is lost.
    const vals = { id, image: cur?.image || '', name, title: S(b.title, 100), department_id: b.department_id, reports_to: b.reports_to, since: S(b.since, 40), slug: S(b.slug, 90), motto: S(b.motto, 200), bio: S(b.bio, 800), author_id: b.author_id, visible: b.visible ? 1 : 0, show_on_home: b.show_on_home ? 1 : 0, social_email: S(b.social_email, 120), ...Object.fromEntries(ST.SOCIAL.map(d => [d.col, S(b[d.col], 200)])) };
    const fail = msg => res.status(400).send(layout(req, { title: id ? 'Edit team member' : 'Add team member', body: staffForm(req, vals, msg) }));
    if (!name) return fail('Enter the member’s name.');
    const dept = +b.department_id ? db.get('departments', +b.department_id) : null;
    if (b.department_id && !dept) return fail('Choose one of the listed departments.');
    const boss = +b.reports_to ? db.get('staff', +b.reports_to) : null;
    if (b.reports_to && !boss) return fail('Choose someone from the list for “Reports to”.');
    if (boss && id && (boss.id === id || ST.wouldCycle(id, boss.id))) return fail('That would put this person above themselves on the chart. Choose someone who does not report to them.');
    const errs = [], links = {};
    for (const d of ST.SOCIAL) { const r = ST.cleanSocial(d, b[d.col]); if (r.error) errs.push(r.error); else links[d.col] = r.value; }
    const em = ST.cleanEmail(b.social_email); if (em.error) errs.push(em.error); else links.social_email = em.value;
    if (errs.length) return fail(errs.join(' '));
    let slug = cur?.slug || '';
    if (S(b.slug, 90)) { slug = slugify(b.slug); if (!slug) return fail('Enter a valid profile URL, or leave it blank.'); if (db.find('staff', x => x.slug === slug && x.id !== (id || 0))) return fail('That profile URL is already used by someone else.'); }
    else if (!slug) slug = ST.uniqueSlug('staff', name, id, 'member');
    let authorId = null, newAuthor = false;
    if (b.author_id === '__new') newAuthor = true;
    else if (+b.author_id) { if (!db.get('authors', +b.author_id)) return fail('Choose an author from the list.'); if (db.find('staff', x => x.author_id === +b.author_id && x.id !== (id || 0))) return fail('That author is already linked to another team member.'); authorId = +b.author_id; }
    let img = null; try { if (req.file) img = (await saveUpload(req.file, req.user.id)).url; } catch (e) { return fail(e.message); }
    let savedId = id;
    if (newAuthor) authorId = (await db.insert('authors', { name, slug: ST.uniqueSlug('authors', name, 0, 'author'), title: vals.title, bio: '', image: '' })).id;
    const row = { name, title: vals.title, department: dept?.name || '', department_id: dept?.id || null, reports_to: boss?.id || null, motto: vals.motto, bio: vals.bio, since: vals.since, slug, author_id: authorId, visible: vals.visible, show_on_home: vals.show_on_home,
      ...Object.fromEntries(ST.SOCIAL.map(d => [d.col, links[d.col]])), social_email: links.social_email };
    if (id) { await db.update('staff', id, { ...row, ...(img ? { image: img } : b.remove_image ? { image: '' } : {}) }); }
    else savedId = (await db.insert('staff', { ...row, image: img || '', sort: Math.max(-1, ...db.all('staff').map(x => x.sort)) + 1 })).id;
    audit(req, id ? 'staff_updated' : 'staff_created', 'staff', savedId, name); back(res, '/admin/staff', 'Team member saved.');
  };
  router.post('/staff', requirePerm('staff.manage'), handleUpload('image', 1), staffSave); router.post('/staff/:id', requirePerm('staff.manage'), handleUpload('image', 1), staffSave);
  router.post('/staff/:id/move', requirePerm('staff.manage'), async (req, res) => {
    const ids = db.all('staff').sort((x, y) => x.sort - y.sort || x.id - y.id).map(x => x.id), i = ids.indexOf(+req.params.id), j = req.body.dir === 'up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; const b = db.batch(); ids.forEach((id, n) => b.patch('staff', id, { sort: n })); await b.commit(); }
    back(res, '/admin/staff', 'Order updated.');
  });
  router.post('/staff/:id/delete', requirePerm('staff.manage'), async (req, res) => {
    const m = db.get('staff', /^\d+$/.test(req.params.id) ? +req.params.id : req.params.id);
    if (!m || !(await db.remove('staff', m.id))) return back(res, '/admin/staff', '', 'That team member could not be found. Refresh the page and try again.');
    audit(req, 'staff_deleted', 'staff', m.id, m.name); back(res, '/admin/staff', 'Team member removed.');
  });

  // ===== Careers =====
  const jobForm = (req, j = {}) => `<form method="post" action="/admin/careers${j.id ? '/' + j.id : ''}" class="paper panel">${csrf(req)}<div class="formgrid">${field('jt', 'Position title', j.title, { name: 'title', req: 1 })}${field('jd', 'Department', j.department, { name: 'department' })}${field('je', 'Employment type', j.employment_type || 'Full-time', { name: 'employment_type' })}${field('jl', 'Work location', j.location, { name: 'location' })}${field('jdl', 'Application deadline', (j.deadline || '').slice(0, 10), { name: 'deadline', type: 'date' })}<div class="field"><label for="js">Status</label><select id="js" name="status">${['draft', 'published', 'closed'].map(s => `<option value="${s}"${(j.status || 'draft') === s ? ' selected' : ''}>${s}</option>`).join('')}</select></div></div>
${field('jde', 'Job description', j.description, { name: 'description', area: 1, rows: 5 })}${field('jr', 'Responsibilities', j.responsibilities, { name: 'responsibilities', area: 1 })}${field('jq', 'Qualifications', j.qualifications, { name: 'qualifications', area: 1 })}${field('ja', 'Application instructions', j.how_to_apply, { name: 'how_to_apply', area: 1, help: 'Do not add contact details you have not confirmed.' })}<button class="btn">Save position</button> <a class="btn paper-btn" href="/admin/careers">Cancel</a></form>`;
  router.get('/careers', requirePerm('careers.manage'), (req, res) => {
    const rows = db.all('jobs').sort((x, y) => (y.created_at || '') < (x.created_at || '') ? -1 : (y.created_at || '') > (x.created_at || '') ? 1 : y.id - x.id);
    res.send(layout(req, { title: 'Careers', body: `<p><a class="btn" href="/admin/careers/new">New position</a></p>${rows.length ? table(['Position', 'Department', 'Status', 'Deadline', 'Actions'], rows.map(j => `<tr><td><a href="/admin/careers/${j.id}">${esc(j.title)}</a> ${j.is_sample ? '<span class="badge sample">Sample</span>' : ''}</td><td>${esc(j.department)}</td><td>${status(j.status === 'closed' ? 'archived' : j.status)}</td><td>${j.deadline ? fmtDate(j.deadline) : '—'}</td><td>${confirmBtn(req, `/admin/careers/${j.id}/delete`, 'Delete', `Delete “${j.title}”?`)}</td></tr>`), 'Positions') : empty('No positions', 'Create a position and publish it to show it on the careers page.')}` }));
  });
  router.get('/careers/new', requirePerm('careers.manage'), (req, res) => res.send(layout(req, { title: 'New position', body: jobForm(req) })));
  router.get('/careers/:id', requirePerm('careers.manage'), (req, res) => { const j = db.get('jobs', +req.params.id); if (!j) return back(res, '/admin/careers', '', 'Position not found.'); res.send(layout(req, { title: 'Edit position', body: jobForm(req, j) })); });
  const jobSave = async (req, res) => {
    const b = req.body, id = req.params.id ? +req.params.id : null, title = String(b.title || '').trim().slice(0, 150); if (!title) return back(res, id ? '/admin/careers/' + id : '/admin/careers/new', '', 'Enter a position title.');
    let slug = slugify(title), c = slug, i = 1; while (db.find('jobs', j => j.slug === c && j.id !== (id || 0))) c = `${slug}-${++i}`;
    const v = { title, department: String(b.department || '').slice(0, 100), employment_type: String(b.employment_type || '').slice(0, 50), location: String(b.location || '').slice(0, 100), description: String(b.description || '').slice(0, 8000), qualifications: String(b.qualifications || '').slice(0, 8000),
      responsibilities: String(b.responsibilities || '').slice(0, 8000), how_to_apply: String(b.how_to_apply || '').slice(0, 4000), deadline: /^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '') ? b.deadline : null, status: ['draft', 'published', 'closed'].includes(b.status) ? b.status : 'draft', slug: c };
    if (id) await db.update('jobs', id, { ...v, updated_at: db.now() }); else await db.insert('jobs', v);
    audit(req, id ? 'job_updated' : 'job_created', 'job', id || c, title); back(res, '/admin/careers', 'Position saved.');
  };
  router.post('/careers', requirePerm('careers.manage'), jobSave); router.post('/careers/:id', requirePerm('careers.manage'), jobSave);
  router.post('/careers/:id/delete', requirePerm('careers.manage'), async (req, res) => { await db.remove('jobs', +req.params.id); audit(req, 'job_deleted', 'job', req.params.id); back(res, '/admin/careers', 'Position deleted.'); });

  // ===== Announcements (articles flagged as announcements) =====
  router.get('/announcements', requirePerm('announcements.manage'), (req, res) => {
    const rows = db.where('articles', a => a.is_announcement === 1).sort((x, y) => (y.updated_at || '') < (x.updated_at || '') ? -1 : (y.updated_at || '') > (x.updated_at || '') ? 1 : y.id - x.id);
    res.send(layout(req, { title: 'Corporate Announcements', body: `<div class="notice info">Announcements are articles flagged as “Corporate announcement”. Open any article and tick the flag in its details, then publish it as usual. It appears on the homepage and News page.</div>${rows.length ? table(['Announcement', 'Status', 'Important', 'Date', 'Actions'], rows.map(a => `<tr><td><a href="/admin/articles/${a.id}/edit">${esc(a.title || 'Untitled')}</a></td><td>${status(a.status)}</td><td>${a.is_important ? '<span class="badge red">Important</span>' : '—'}</td><td>${fmtDate(a.published_at || a.scheduled_at)}</td><td><div class="row-actions"><form method="post" action="/admin/announcements/${a.id}/toggle">${csrf(req)}<button class="btn paper-btn small">${a.is_important ? 'Remove important' : 'Mark important'}</button></form><form method="post" action="/admin/announcements/${a.id}/remove">${csrf(req)}<button class="btn paper-btn small">Unflag</button></form></div></td></tr>`), 'Announcements') : empty('No announcements', 'Create an article and flag it as a corporate announcement.')}<form method="post" action="/admin/articles/new" style="margin-top:1rem">${csrf(req)}<button class="btn">Create an article</button></form>` }));
  });
  router.post('/announcements/:id/toggle', requirePerm('announcements.manage'), async (req, res) => { const a = db.get('articles', +req.params.id); if (a && a.is_announcement === 1) await db.update('articles', a.id, { is_important: 1 - a.is_important }); audit(req, 'announcement_toggle_important', 'article', req.params.id); back(res, '/admin/announcements', 'Updated.'); });
  router.post('/announcements/:id/remove', requirePerm('announcements.manage'), async (req, res) => { await db.update('articles', +req.params.id, { is_announcement: 0, is_important: 0 }); audit(req, 'announcement_unflagged', 'article', req.params.id); back(res, '/admin/announcements', 'Announcement flag removed.'); });

  // ===== Contact inquiries =====
  router.get('/inquiries', requirePerm('inquiries.manage'), async (req, res) => {
    await cms.importInbox();
    const st = req.query.status;
    let rows = db.all('inquiries');
    rows = ['new', 'in_progress', 'resolved', 'archived'].includes(st) ? rows.filter(i => i.status === st) : rows.filter(i => i.status !== 'archived');
    if (req.query.unread) rows = rows.filter(i => i.is_read === 0);
    rows = rows.sort((x, y) => y.id - x.id).slice(0, 200).map(i => ({ ...i, assignee: db.get('users', i.assigned_to)?.name || null }));
    res.send(layout(req, { title: 'Contact Inquiries', body: `<form class="toolbar" method="get"><div class="field"><label for="st">Status</label><select id="st" name="status"><option value="">Open (not archived)</option>${['new', 'in_progress', 'resolved', 'archived'].map(s => `<option value="${s}"${st === s ? ' selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></div><div class="field"><label style="display:flex;gap:.5rem;font-weight:500"><input type="checkbox" name="unread" value="1"${req.query.unread ? ' checked' : ''}> Unread only</label></div><button class="btn paper-btn">Filter</button></form>
${rows.length ? table(['From', 'Subject', 'Category', 'Status', 'Assigned', 'Received'], rows.map(i => `<tr><td>${i.is_read ? '' : '<span class="badge red">New</span> '}${esc(i.name)}<br><span class="muted">${esc(i.email)}</span></td><td><a href="/admin/inquiries/${i.id}">${esc(i.subject)}</a></td><td>${esc(i.category)}</td><td>${esc(i.status.replace('_', ' '))}</td><td>${esc(i.assignee || '—')}</td><td>${fmtDate(i.created_at, true)}</td></tr>`), 'Inquiries') : empty('No inquiries', 'Messages from the public contact form appear here.')}` }));
  });
  router.get('/inquiries/:id', requirePerm('inquiries.manage'), async (req, res) => {
    const i = db.get('inquiries', +req.params.id); if (!i) return back(res, '/admin/inquiries', '', 'Inquiry not found.');
    if (!i.is_read) await db.update('inquiries', i.id, { is_read: 1 });
    const users = db.where('users', u => u.active === 1 && ['super_admin', 'administrator', 'managing_editor'].includes(u.role)).sort((x, y) => x.name.localeCompare(y.name));
    res.send(layout(req, { title: 'Inquiry', body: `<p><a href="/admin/inquiries">← All inquiries</a></p><div class="grid g2"><section class="paper panel"><h2>${esc(i.subject)}</h2><p class="muted">${esc(i.name)} &lt;${esc(i.email)}&gt; · ${esc(i.category)} · ${fmtDate(i.created_at, true)}</p><p style="white-space:pre-wrap">${esc(i.message)}</p><p class="muted">Privacy consent recorded.</p></section>
<section class="paper panel"><h2>Handling</h2><form method="post" action="/admin/inquiries/${i.id}">${csrf(req)}<div class="field"><label for="s">Status</label><select id="s" name="status">${['new', 'in_progress', 'resolved', 'archived'].map(s => `<option value="${s}"${i.status === s ? ' selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></div><div class="field"><label for="as">Assign to</label><select id="as" name="assigned_to"><option value="">Unassigned</option>${users.map(u => `<option value="${u.id}"${i.assigned_to === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>${field('nt', 'Internal notes', i.notes, { name: 'notes', area: 1, max: 5000 })}<div class="row-actions"><button class="btn">Save</button><button class="btn paper-btn" name="mark" value="unread">Save and mark unread</button></div></form></section></div>` }));
  });
  router.post('/inquiries/:id', requirePerm('inquiries.manage'), async (req, res) => {
    const i = db.get('inquiries', +req.params.id); if (!i) return back(res, '/admin/inquiries', '', 'Inquiry not found.');
    const st = ['new', 'in_progress', 'resolved', 'archived'].includes(req.body.status) ? req.body.status : 'new', as = +req.body.assigned_to && db.find('users', u => u.id === +req.body.assigned_to && u.active === 1) ? +req.body.assigned_to : null;
    await db.update('inquiries', i.id, { status: st, assigned_to: as, notes: String(req.body.notes || '').slice(0, 5000), is_read: req.body.mark === 'unread' ? 0 : 1 }); audit(req, 'inquiry_updated', 'inquiry', i.id, st); back(res, '/admin/inquiries', 'Inquiry updated.');
  });

  // ===== Users & roles =====
  const manageable = (me, u) => me.role === 'super_admin' || (u.role !== 'super_admin' && me.id !== u.id);
  const assignable = me => Object.keys(ROLES).filter(r => me.role === 'super_admin' || r !== 'super_admin');
  router.get('/users', requirePerm('users.manage'), (req, res) => {
    const rows = db.all('users').sort((x, y) => x.name.localeCompare(y.name)), authors = db.all('authors').sort((x, y) => x.name.localeCompare(y.name)), shown = req.query.pw ? String(req.query.pw) : '';
    const roleSel = (id, cur) => `<select id="${id}" name="role">${assignable(req.user).map(r => `<option value="${r}"${cur === r ? ' selected' : ''}>${ROLES[r].label}</option>`).join('')}</select>`;
    res.send(layout(req, { title: 'Users & Roles', body: `${shown ? `<div class="notice info" role="status"><b>Temporary password (shown once):</b> <code>${esc(shown)}</code><br>Share it securely. The user should change it under Account after signing in.</div>` : ''}
<section class="paper panel" style="margin-bottom:1.4rem"><h2>Add a user</h2><form method="post" action="/admin/users" class="formgrid">${csrf(req)}${field('un', 'Full name', '', { name: 'name', req: 1 })}${field('ue', 'Email', '', { name: 'email', type: 'email', req: 1 })}${field('uu', 'Username', '', { name: 'username', req: 1, max: 40 })}<div class="field"><label for="ur">Role</label>${roleSel('ur', 'writer')}</div><div class="field"><label for="ua">Author profile (optional)</label><select id="ua" name="author_id"><option value="">None</option>${authors.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div><div class="field" style="align-self:end"><button class="btn">Create user</button><div class="help">A strong temporary password is generated for you.</div></div></form></section>
${table(['User', 'Role', 'Status', 'Last sign-in', 'Actions'], rows.map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="muted">${esc(u.email)} · @${esc(u.username)}</span></td><td>${manageable(req.user, u) && u.id !== req.user.id ? `<form method="post" action="/admin/users/${u.id}" class="row-actions">${csrf(req)}<label class="sr" for="r${u.id}">Role for ${esc(u.name)}</label>${roleSel('r' + u.id, u.role)}<button class="btn paper-btn small">Update</button></form>` : esc(ROLES[u.role].label)}</td><td>${u.active ? 'Active' : 'Deactivated'}</td><td>${u.last_login ? fmtDate(u.last_login, true) : 'Never'}</td><td>${manageable(req.user, u) && u.id !== req.user.id ? `<div class="row-actions">${confirmBtn(req, `/admin/users/${u.id}/toggle`, u.active ? 'Deactivate' : 'Activate', `${u.active ? 'Deactivate' : 'Activate'} ${u.name}? ${u.active ? 'They will be signed out immediately.' : ''}`, 'paper-btn small')}${confirmBtn(req, `/admin/users/${u.id}/reset`, 'Reset password', `Generate a new temporary password for ${u.name}? Their sessions end.`, 'paper-btn small')}</div>` : '<span class="muted">—</span>'}</td></tr>`), 'Users')}` }));
  });
  router.post('/users', requirePerm('users.manage'), async (req, res) => {
    const b = req.body, name = String(b.name || '').trim().slice(0, 100), email = String(b.email || '').trim().toLowerCase().slice(0, 200), un = String(b.username || '').trim().slice(0, 40);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[A-Za-z0-9._-]{3,40}$/.test(un)) return back(res, '/admin/users', '', 'Enter a name, a valid email and a username of 3–40 letters, numbers, dots, dashes or underscores.');
    if (!assignable(req.user).includes(b.role)) return A.denied(req, res);
    if (db.find('users', u => u.email.toLowerCase() === email || u.username.toLowerCase() === un.toLowerCase())) return back(res, '/admin/users', '', 'That email or username is already in use.');
    const pw = rand(6) + 'Aa1' + rand(3);
    let fb;
    try { fb = await identity.createAccount(email, pw, name); }
    catch (e) { return back(res, '/admin/users', '', e.code === 'auth/email-already-in-use' ? 'That email already has a Firebase account. Delete it in the Firebase console or use another email.' : 'The account could not be created. Try again.'); }
    // /roles/<uid> is what database.rules.json reads to decide what this person may do.
    const row = await db.insert('users', { uid: fb.uid, email, username: un, name, role: b.role, author_id: +b.author_id || null });
    await db.setPath('roles/' + fb.uid, { role: b.role, active: 1, user_id: row.id, key: String(row.id) });
    audit(req, 'user_created', 'user', email, b.role);
    res.redirect('/admin/users?pw=' + encodeURIComponent(pw) + '&ok=' + encodeURIComponent('User created.'));
  });
  const target = (req, res) => { const u = db.get('users', +req.params.id); if (!u || !manageable(req.user, u) || u.id === req.user.id) { A.denied(req, res); return null; } return u; };
  router.post('/users/:id', requirePerm('users.manage'), async (req, res) => {
    const u = target(req, res); if (!u) return; if (!assignable(req.user).includes(req.body.role)) return A.denied(req, res);
    await db.update('users', u.id, { role: req.body.role }); await db.setPath('roles/' + u.uid + '/role', req.body.role); audit(req, 'user_role_changed', 'user', u.email, `${u.role} -> ${req.body.role}`); back(res, '/admin/users', 'Role updated.');
  });
  router.post('/users/:id/toggle', requirePerm('users.manage'), async (req, res) => {
    const u = target(req, res); if (!u) return; const active = u.active ? 0 : 1;
    await db.update('users', u.id, { active }); await db.setPath('roles/' + u.uid + '/active', active); audit(req, 'user_toggled', 'user', u.email); back(res, '/admin/users', 'User updated.');
  });
  router.post('/users/:id/reset', requirePerm('users.manage'), async (req, res) => {
    const u = target(req, res); if (!u) return;
    // A static site cannot set another person's password, so Firebase emails them a reset link instead.
    await identity.sendPasswordReset(u.email).catch(e => console.error('[password-reset] could not send:', e.message));
    audit(req, 'user_password_reset', 'user', u.email); back(res, '/admin/users', `A password reset link was emailed to ${u.email}.`);
  });

  // ===== Own account =====
  router.get('/account', (req, res) => res.send(layout(req, { title: 'My account', body: `<section class="paper panel" style="max-width:520px"><h2>Change password</h2><form method="post" action="/admin/account">${csrf(req)}${field('cp', 'Current password', '', { name: 'current', type: 'password' })}${field('np', 'New password', '', { name: 'password', type: 'password', help: 'At least 12 characters with letters and numbers.' })}${field('np2', 'Repeat new password', '', { name: 'confirm', type: 'password' })}<button class="btn">Change password</button></form><p class="muted">Signed in as ${esc(req.user.email)} (${ROLES[req.user.role].label}).</p></section>` })));
  router.post('/account', A.limiter('acct', 10, 900000), async (req, res) => {
    const u = db.get('users', req.user.id);
    const check = await identity.checkPassword(u.email, String(req.body.current || ''));
    if (!check) return back(res, '/admin/account', '', 'Your current password is not correct.');
    if (req.body.password !== req.body.confirm) return back(res, '/admin/account', '', 'The new passwords do not match.');
    if (!A.validPw(req.body.password)) return back(res, '/admin/account', '', 'Use at least 12 characters with letters and numbers.');
    try { await identity.changePassword(req.body.password); } catch (e) { return back(res, '/admin/account', '', 'The password could not be changed. Sign out, sign in again and retry.'); }
    audit(req, 'password_changed', 'user', u.email); back(res, '/admin/account', 'Password changed.');
  });

  // ===== Analytics =====
  async function analytics(req) {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10), from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    const raw = (await db.read('public/views_daily')) || {}, perDay = new Map(), perArticle = new Map();
    for (const [aid, days] of Object.entries(raw)) for (const [day, n] of Object.entries(days)) if (day >= from && day <= to) { perDay.set(day, (perDay.get(day) || 0) + n); perArticle.set(+aid, (perArticle.get(+aid) || 0) + n); }
    const byCat = new Map(); for (const [aid, n] of perArticle) { const a = db.get('articles', aid); if (a) byCat.set(a.category_id || 0, (byCat.get(a.category_id || 0) || 0) + n); }
    const pubs = new Map(); for (const a of db.all('articles')) if (a.status === 'published' && a.published_at && a.published_at.slice(0, 10) >= from && a.published_at.slice(0, 10) <= to) { const m = a.published_at.slice(0, 7); pubs.set(m, (pubs.get(m) || 0) + 1); }
    const logs = (await db.list('search_log', 5000)).filter(l => (l.created_at || '').slice(0, 10) >= from && (l.created_at || '').slice(0, 10) <= to), terms = new Map(), zeroes = new Map();
    for (const l of logs) { const t = terms.get(l.q) || { label: l.q, v: 0, r: 0 }; t.v++; t.r = Math.max(t.r, l.results); terms.set(l.q, t); if (l.results === 0) zeroes.set(l.q, (zeroes.get(l.q) || 0) + 1); }
    const desc = (x, y) => y.v - x.v;
    return { from, to, perArticle,
      total: [...perDay.values()].reduce((a, b) => a + b, 0),
      byDay: [...perDay].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([label, v]) => ({ label, v })),
      top: [...perArticle].map(([id, v]) => ({ id, label: db.get('articles', id)?.title, v })).filter(x => x.label !== undefined).sort(desc).slice(0, 10),
      cats: [...byCat].map(([id, v]) => ({ label: db.get('categories', id)?.name || 'Uncategorized', v })).sort(desc),
      pubs: [...pubs].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([label, v]) => ({ label, v })),
      searches: [...terms.values()].sort(desc).slice(0, 10),
      zero: [...zeroes].map(([label, v]) => ({ label, v })).sort(desc).slice(0, 10) };
  }
  router.get('/analytics', requirePerm('analytics.view'), async (req, res) => {
    const d = await analytics(req), list = (a, empt) => a.length ? hbars(a) : `<p class="muted">${empt}</p>`;
    res.send(layout(req, { title: 'Analytics', body: `<form class="toolbar" method="get">${field('from', 'From', d.from, { type: 'date' })}${field('to', 'To', d.to, { type: 'date' })}<button class="btn paper-btn">Apply</button><a class="btn paper-btn" href="/admin/analytics.csv?from=${d.from}&to=${d.to}">Export CSV</a></form>
<div class="notice info"><b>How to read this:</b> counts are actual server-side article page loads (known crawlers excluded). They are not unique visitors, and no personal identifiers are stored. Nothing here is estimated.</div>
<div class="grid g4"><div class="paper-flat stat"><b>${d.total}</b><span>Article views in range</span></div></div>
<div class="grid g2" style="margin-top:1.2rem"><section class="paper panel"><h2>Views per day</h2>${d.byDay.length ? cols(d.byDay.map(x => ({ label: x.label, short: x.label.slice(8), v: x.v }))) : '<p class="muted">No views recorded in this range.</p>'}</section>
<section class="paper panel"><h2>Most-read articles</h2>${list(d.top.map(t => ({ ...t, label: t.label || 'Untitled' })), 'No views yet.')}</section><section class="paper panel"><h2>Views by category</h2>${list(d.cats, 'No views yet.')}</section><section class="paper panel"><h2>Publishing activity (per month)</h2>${list(d.pubs, 'Nothing published in this range.')}</section>
<section class="paper panel"><h2>Top searches</h2>${list(d.searches, 'No searches yet.')}</section><section class="paper panel"><h2>Searches with no results</h2>${list(d.zero, 'None. Every search found something.')}</section></div>` }));
  });
  router.get('/analytics.csv', requirePerm('analytics.view'), async (req, res) => {
    const d = await analytics(req), rows = [...d.perArticle].map(([id, views]) => ({ id, title: db.get('articles', id)?.title, views })).filter(r => r.title !== undefined).sort((x, y) => y.views - x.views);
    const cell = s => '"' + String(s ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
    audit(req, 'analytics_exported', 'analytics', null, `${d.from}..${d.to}`);
    res.type('text/csv').set('Content-Disposition', `attachment; filename="mmg-views-${d.from}-to-${d.to}.csv"`).send('article_id,title,views\n' + rows.map(r => [r.id, cell(r.title), r.views].join(',')).join('\n'));
  });

  // ===== Activity log =====
  router.get('/logs', requirePerm('audit.view'), async (req, res) => {
    const recent = (await db.list('audit_log', 500)).reverse(), page = Math.max(1, +req.query.page || 1), per = 50, total = recent.length, rows = recent.slice((page - 1) * per, page * per); // the most recent 500 entries are browsable here
    res.send(layout(req, { title: 'Activity Logs', body: table(['When (Manila)', 'User', 'Action', 'Target', 'Detail', 'IP'], rows.map(l => `<tr><td>${fmtDate(l.created_at, true)}</td><td>${esc(l.user_label || 'System')}</td><td>${esc(l.action)}</td><td>${esc((l.entity || '') + (l.entity_id ? ' #' + l.entity_id : ''))}</td><td>${esc(l.detail || '')}</td><td>${esc(l.ip || '')}</td></tr>`), 'Audit log') + pager(page, Math.ceil(total / per), '/admin/logs') + '<p class="muted">Showing the most recent 500 entries. Older entries stay in the database.</p>' }));
  });

  // ===== Settings =====
  router.get('/settings', requirePerm('settings.manage'), (req, res) => res.send(layout(req, { title: 'Settings', body: `<section class="paper panel" style="max-width:640px"><h2>Public contact details</h2><p class="muted">Shown on the website only when filled in. Do not enter details you have not confirmed.</p><form method="post" action="/admin/settings">${csrf(req)}${field('ca', 'Corporate address', getSetting('contact_address', 'Makati City, Philippines'), { name: 'contact_address' })}${field('cp', 'Telephone', getSetting('contact_phone'), { name: 'contact_phone', max: 40 })}${field('ce', 'Public contact email', getSetting('contact_email'), { name: 'contact_email', type: 'email' })}<button class="btn">Save settings</button></form></section>
<section class="paper panel" style="max-width:640px;margin-top:1.4rem"><h2>Public website data</h2><p class="muted">The public site reads a published copy of your articles, team and settings. It updates automatically when a publisher changes something. If the site ever looks out of date, rebuild the copy here.</p><form method="post" action="/admin/settings/republish">${csrf(req)}<button class="btn paper-btn">Republish website data</button></form></section>` })));
  router.post('/settings/republish', requirePerm('settings.manage'), async (req, res) => {
    const n = await cms.reconcileNow();
    n < 0 ? back(res, '/admin/settings', '', 'The public copy could not be updated. Check your connection and try again.') : back(res, '/admin/settings', n ? `Website data updated (${n} change${n === 1 ? '' : 's'}).` : 'Website data was already up to date.');
  });
  router.post('/settings', requirePerm('settings.manage'), async (req, res) => {
    for (const k of ['contact_address', 'contact_phone', 'contact_email']) await setSetting(k, String(req.body[k] || '').trim().slice(0, 200));
    audit(req, 'settings_updated', 'settings', null); back(res, '/admin/settings', 'Settings saved.');
  });
};
