(() => {
  const root = document.getElementById('iss'); if (!root) return;
  const id = root.dataset.id, data = JSON.parse(document.getElementById('issue-data').textContent);
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const pv = $('#pv'), stateEl = $('#savestate'), dlg = document.getElementById('confirm'), picker = $('#picker');
  let sel = 0, dirty = false, saving = false, timer = null, pvTimer = null;
  const page = () => data.pages[sel];
  const blank = () => ({ layout: 'L2', front: false, columns: 3, section: '', headline: '', deck: '', byline: '', dateline: '', caption: '', credit: '', body: '', photo_media_id: null, photo_url: '' });
  const setState = (s, t) => { stateEl.dataset.s = s; stateEl.textContent = t; };
  const ask = msg => new Promise(r => { $('#confirm-msg').textContent = msg; dlg.returnValue = ''; dlg.showModal(); dlg.addEventListener('close', () => r(dlg.returnValue === 'ok'), { once: true }); });

  // ----- preview -----
  const sendPreview = () => { if (pv.contentWindow) pv.contentWindow.postMessage({ type: 'issue-state', settings: data.settings, pages: data.pages, index: sel }, location.origin); };
  const queuePreview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(sendPreview, 150); };
  pv.addEventListener('load', sendPreview);
  const wrap = $('#pvw'), scale = () => { const s = wrap.clientWidth / 1123; pv.style.transform = `scale(${s})`; wrap.style.height = Math.round(1588 * s) + 'px'; };
  new ResizeObserver(scale).observe(wrap); scale();
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.data?.type !== 'fit') return;
    const s = e.data.stats[0], info = $('#fitinfo'), warn = $('#fitwarn'); warn.textContent = '';
    if (!s || s.empty) { info.textContent = 'No article text on this page yet.'; return; }
    info.textContent = `Text ${s.pt} pt · line spacing ${s.lh} · columns ${Math.round(s.fill * 100)}% full, last column ${Math.round((s.lastFill ?? s.fill) * 100)}%`;
    if (s.overflow) warn.textContent = 'The text is too long for this page even at the smallest size. Shorten it, use more columns, or remove the photo.';
    else if (s.fill < 0.85) warn.textContent = 'The text is short for this layout, so the columns cannot be filled. Add text, use fewer columns, or pick a layout with a larger photo.';
  });

  // ----- form <-> state -----
  function tabs() {
    $('#tabs').innerHTML = '';
    data.pages.forEach((p, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ' + (i === sel ? '' : 'paper-btn'); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', i === sel); b.textContent = `Page ${i + 1}${p.front ? ' (front)' : ''}`; b.addEventListener('click', () => { sel = i; loadForm(); sendPreview(); }); $('#tabs').appendChild(b); });
  }
  function photoPrev() { const p = page(); $('#ph-prev').innerHTML = p.photo_url ? `<img src="${p.photo_url}" alt="" style="max-width:160px;border-radius:3px">` : 'No photo. The layout adjusts automatically.'; }
  function bodyInfo() { const t = page().body.trim(), w = t ? t.split(/\s+/).length : 0; $('#body-info').textContent = `${w} words`; }
  function loadForm() {
    $$('[data-p]').forEach(e => { e.value = page()[e.dataset.p] ?? ''; }); $('[data-pc=front]').checked = !!page().front;
    $$('[data-s]').forEach(e => { e.value = data.settings[e.dataset.s] ?? ''; }); $$('[data-sc]').forEach(e => { e.checked = data.settings[e.dataset.sc] !== false; });
    photoPrev(); bodyInfo(); tabs();
  }
  const touch = () => { dirty = true; setState('unsaved', 'Unsaved changes'); queuePreview(); clearTimeout(timer); timer = setTimeout(save, 4000); };
  $$('[data-p]').forEach(e => e.addEventListener('input', () => { page()[e.dataset.p] = e.dataset.p === 'columns' ? +e.value : e.value; if (e.dataset.p === 'body') bodyInfo(); touch(); }));
  $$('[data-pc]').forEach(e => e.addEventListener('change', () => { page()[e.dataset.pc] = e.checked; tabs(); touch(); }));
  $$('[data-s]').forEach(e => e.addEventListener('input', () => { data.settings[e.dataset.s] = e.value; touch(); }));
  $$('[data-sc]').forEach(e => e.addEventListener('change', () => { data.settings[e.dataset.sc] = e.checked; touch(); }));
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ----- saving -----
  async function save() {
    if (saving) return false; clearTimeout(timer); saving = true; setState('saving', 'Saving…');
    try {
      const r = await mmgFetch(`/admin/api/issues/${id}`, { method: 'PUT', body: JSON.stringify({ settings: data.settings, pages: data.pages }) }), j = await r.json().catch(() => ({}));
      if (!r.ok) { setState('unsaved', 'Not saved'); $('#fitwarn').textContent = j.error || 'Saving failed.'; return false; }
      dirty = false; setState('saved', 'Saved'); return true;
    } catch { setState('unsaved', 'Not saved (offline?)'); return false; } finally { saving = false; }
  }
  $('#save-now').addEventListener('click', save);
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  $('#print-link').addEventListener('click', async e => { if (dirty) { e.preventDefault(); if (await save()) window.open(e.currentTarget.href, '_blank', 'noopener'); } });

  // ----- page operations -----
  $('#pg-add').addEventListener('click', () => { data.pages.push(blank()); sel = data.pages.length - 1; loadForm(); sendPreview(); touch(); });
  $('#pg-del').addEventListener('click', async () => { if (data.pages.length < 2) { $('#fitwarn').textContent = 'An issue needs at least one page.'; return; } if (!(await ask(`Remove page ${sel + 1} and its text?`))) return; data.pages.splice(sel, 1); sel = Math.min(sel, data.pages.length - 1); loadForm(); sendPreview(); touch(); });
  const move = d => { const j = sel + d; if (j < 0 || j >= data.pages.length) return; [data.pages[sel], data.pages[j]] = [data.pages[j], data.pages[sel]]; sel = j; loadForm(); sendPreview(); touch(); };
  $('#pg-up').addEventListener('click', () => move(-1)); $('#pg-down').addEventListener('click', () => move(1));

  // ----- import from article -----
  $('#imp-go').addEventListener('click', async () => {
    const aid = $('#imp').value; if (!aid) return;
    if (page().body.trim() && !(await ask('Replace the text and details on this page with the chosen article?'))) return;
    const r = await mmgFetch(`/admin/api/articles/${aid}/print-fields`), j = await r.json().catch(() => ({}));
    if (!r.ok) { $('#fitwarn').textContent = j.error || 'Could not load the article.'; return; }
    Object.assign(page(), j); loadForm(); sendPreview(); touch();
  });

  // ----- media picker (photo and logos) -----
  let mode = 'photo';
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function loadMedia() {
    const g = $('#pk-grid'); g.textContent = 'Loading…';
    const r = await mmgFetch('/admin/api/media?q=' + encodeURIComponent($('#pk-q').value)); if (!r.ok) { g.textContent = 'You cannot use the media library.'; return; }
    const { items } = await r.json();
    g.innerHTML = items.length ? items.map(m => `<button type="button" data-m='${esc(JSON.stringify(m))}'><img src="${esc(m.thumb)}" alt="${esc(m.alt)}"><small>${esc(m.display_name)}</small></button>`).join('') : '<p>No images yet. Upload some in the Media Library.</p>';
  }
  const open = m => { mode = m; picker.showModal(); loadMedia(); };
  $('#ph-pick').addEventListener('click', () => open('photo')); $('#pk-close').addEventListener('click', () => picker.close());
  $('#pk-q').addEventListener('input', () => { clearTimeout(window.__pk); window.__pk = setTimeout(loadMedia, 250); });
  $('#ph-clear').addEventListener('click', () => { Object.assign(page(), { photo_media_id: null, photo_url: '' }); photoPrev(); sendPreview(); touch(); });
  $$('[data-logo]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.logo; if (k.endsWith('-reset')) { const s = k.split('-')[0]; data.settings[s + '_logo_media_id'] = null; data.settings[s + '_logo_url'] = ''; sendPreview(); touch(); } else open(k); }));
  $('#pk-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return; const m = JSON.parse(b.dataset.m), u = m.url;
    if (mode === 'photo') { Object.assign(page(), { photo_media_id: m.id, photo_url: u }); if (!page().caption && m.caption) page().caption = m.caption; if (!page().credit && m.credit) page().credit = m.credit; loadForm(); }
    else { data.settings[mode + '_logo_media_id'] = m.id; data.settings[mode + '_logo_url'] = u; }
    picker.close(); sendPreview(); touch();
  });
  loadForm(); setState('saved', 'Saved');
})();
