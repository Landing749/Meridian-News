(() => {
  const app = document.getElementById('app'); if (!app) return;
  const id = app.dataset.id, surface = document.getElementById('surface'), stateEl = document.getElementById('savestate');
  let dirty = false, saving = false, timer = null;
  const fields = [...document.querySelectorAll('[data-f]')];
  const setState = (s, t) => { stateEl.dataset.s = s; stateEl.textContent = t; };
  const stats = () => {
    const t = surface.innerText.replace(/\u00a0/g, ' ').trim(), w = t ? t.split(/\s+/).length : 0;
    document.getElementById('wc').textContent = `${w} word${w === 1 ? '' : 's'}`;
    document.getElementById('cc').textContent = `${t.length} characters`;
    document.getElementById('rt').textContent = `${Math.max(1, Math.ceil(w / 220))} min read`;
  };
  const payload = manual => {
    const o = { body: surface.innerHTML, manual: !!manual };
    fields.forEach(f => { o[f.dataset.f] = f.type === 'checkbox' ? f.checked : f.value; });
    return o;
  };
  async function save(manual) {
    if (saving) return false;
    if (!dirty && !manual) return true;
    saving = true; clearTimeout(timer); setState('saving', 'Saving…');
    const sent = payload(manual);
    try {
      const r = await mmgFetch(`/admin/api/articles/${id}`, { method: 'PUT', body: JSON.stringify(sent) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setState('unsaved', 'Not saved'); showMsg(j.error || 'Saving failed.'); return false; }
      dirty = JSON.stringify(payload()) !== JSON.stringify({ ...sent, manual: false });
      setState(dirty ? 'unsaved' : 'saved', dirty ? 'Unsaved changes' : 'Saved'); showMsg('');
      const slug = document.getElementById('f-slug'); if (j.slug && slug) slug.value = j.slug;
      return true;
    } catch { setState('unsaved', 'Not saved (offline?)'); showMsg('Could not reach the server. Your text is still in the editor; try Save now again.'); return false; }
    finally { saving = false; if (dirty) schedule(); }
  }
  const showMsg = t => { const m = document.getElementById('wf-msg'); if (m) m.textContent = t; };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => save(false), 4000); };
  const touch = () => { dirty = true; setState('unsaved', 'Unsaved changes'); stats(); schedule(); };
  surface.addEventListener('input', touch); fields.forEach(f => { f.addEventListener('input', touch); f.addEventListener('change', touch); });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); } });
  document.getElementById('save-now').addEventListener('click', () => save(true));
  // Title and subtitle are single-line fields that wrap and grow
  document.querySelectorAll('.autosize').forEach(t => {
    const fit = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
    t.addEventListener('input', fit); t.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); }); fit();
  });
  stats();

  // Formatting
  document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('mousedown', e => {
    e.preventDefault(); const [c, v] = b.dataset.cmd.split(':'); surface.focus(); document.execCommand(c, false, v || null); touch();
  }));
  const insert = html => { surface.focus(); document.execCommand('insertHTML', false, html); touch(); };
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const picker = document.getElementById('picker'); let pickMode = 'image';
  async function loadMedia() {
    const grid = document.getElementById('pk-grid'); grid.textContent = 'Loading…';
    const r = await mmgFetch('/admin/api/media?q=' + encodeURIComponent(document.getElementById('pk-q').value));
    if (!r.ok) { grid.textContent = 'Your role cannot use the media library.'; return; }
    const { items } = await r.json();
    grid.innerHTML = items.length ? items.map(m => `<button type="button" data-m='${esc(JSON.stringify(m))}'><img src="${esc(m.thumb)}" alt="${esc(m.alt)}"><small>${esc(m.display_name)}</small></button>`).join('') : '<p>No images yet.</p>';
  }
  const openPicker = mode => { pickMode = mode; picker.showModal(); loadMedia(); };
  document.getElementById('pk-q').addEventListener('input', () => { clearTimeout(window.__pk); window.__pk = setTimeout(loadMedia, 250); });
  document.getElementById('pk-close').addEventListener('click', () => picker.close());
  document.getElementById('pk-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return; const m = JSON.parse(b.dataset.m);
    if (pickMode === 'featured') {
      document.getElementById('f-media').value = m.id;
      document.getElementById('feat-prev').innerHTML = `<img src="${esc(m.url)}" alt="${esc(m.alt)}" style="max-width:100%;border-radius:3px">`;
      const cap = document.getElementById('f-cap'), cr = document.getElementById('f-cred');
      if (!cap.value && m.caption) cap.value = m.caption; if (!cr.value && m.credit) cr.value = m.credit; touch();
    } else {
      const c = [m.caption, m.credit && 'Credit: ' + m.credit].filter(Boolean).join(' · ');
      insert(`<figure><img src="${esc(m.url)}" alt="${esc(m.alt)}">${c ? `<figcaption>${esc(c)}</figcaption>` : ''}</figure><p><br></p>`);
    }
    picker.close();
  });
  // Cover photo: upload straight from the device (it also lands in the media library)
  const coverFile = document.getElementById('cover-file'), coverMsg = document.getElementById('cover-msg');
  if (coverFile) coverFile.addEventListener('change', async () => {
    const f = coverFile.files && coverFile.files[0]; if (!f) return;
    const hint = coverMsg.textContent; coverMsg.textContent = 'Uploading…';
    if (f.size > 5 * 1024 * 1024) { coverMsg.textContent = 'That photo is over 5 MB. Choose a smaller one.'; coverFile.value = ''; return; }
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/admin/api/media/upload', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': document.body.dataset.csrf || '' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { coverMsg.textContent = j.error || 'The upload failed. Try again.'; return; }
      const m = j.item;
      document.getElementById('f-media').value = m.id;
      document.getElementById('feat-prev').innerHTML = `<img src="${esc(m.url)}" alt="${esc(m.alt)}" style="max-width:100%;border-radius:3px">`;
      coverMsg.textContent = 'Cover photo added. Add a caption and credit below if you have them.'; touch();
    } catch { coverMsg.textContent = 'Could not upload. Check your connection and try again.'; }
    finally { coverFile.value = ''; }
  });
  const videoSrc = u => {
    try { const x = new URL(u); const h = x.hostname.replace(/^www\./, '');
      if (h === 'youtu.be') return 'https://www.youtube-nocookie.com/embed/' + x.pathname.slice(1);
      if (h === 'youtube.com' && x.searchParams.get('v')) return 'https://www.youtube-nocookie.com/embed/' + x.searchParams.get('v');
      if (h === 'vimeo.com' && /^\/\d+/.test(x.pathname)) return 'https://player.vimeo.com/video/' + x.pathname.split('/')[1];
    } catch {} return null;
  };
  const acts = {
    link() { const u = prompt('Link address (https://…):'); if (!u) return; if (!/^(https?:\/\/|mailto:)/i.test(u)) { alert('Use an address starting with https://, http:// or mailto:'); return; } surface.focus(); document.execCommand('createLink', false, u); touch(); },
    image() { openPicker('image'); }, featured() { openPicker('featured'); },
    'upload-cover'() { document.getElementById('cover-file').click(); },
    'clear-featured'() { document.getElementById('f-media').value = ''; document.getElementById('feat-prev').innerHTML = '<p class="muted">No image selected.</p>'; touch(); },
    video() { const s = videoSrc(prompt('YouTube or Vimeo link:') || ''); if (!s) { alert('That link is not a supported YouTube or Vimeo video address.'); return; } insert(`<div class="video-embed"><iframe src="${esc(s)}" title="Embedded video" allowfullscreen></iframe></div><p><br></p>`); },
    table() { const r = +prompt('Rows (1–12):', '3'), c = +prompt('Columns (1–8):', '3'); if (!(r >= 1 && r <= 12 && c >= 1 && c <= 8)) return; insert('<table><tbody>' + ('<tr>' + '<td><br></td>'.repeat(c) + '</tr>').repeat(r) + '</tbody></table><p><br></p>'); },
    fullscreen(b) { const on = document.body.classList.toggle('fs'); b.setAttribute('aria-pressed', on); b.textContent = on ? 'Exit full screen' : 'Full screen'; },
    async preview() { if (await save(true)) window.open(`/admin/articles/${id}/preview`, '_blank', 'noopener'); },
  };
  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => acts[b.dataset.act] && acts[b.dataset.act](b)));

  // Workflow + comments
  document.querySelectorAll('[data-wf]').forEach(b => b.addEventListener('click', async () => {
    showMsg(''); if (!(await save(true))) return;
    const when = document.getElementById('wf-when'), note = document.getElementById('wf-note');
    const r = await mmgFetch(`/admin/api/articles/${id}/transition`, { method: 'POST', body: JSON.stringify({ action: b.dataset.wf, note: note ? note.value : '', when: when ? when.value : '' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return showMsg(j.error || 'That action failed.');
    dirty = false; location.href = location.pathname + '?ok=' + encodeURIComponent('Status updated.');
  }));
  const cm = document.getElementById('cm-add');
  if (cm) cm.addEventListener('click', async () => {
    const t = document.getElementById('cm'); const r = await mmgFetch(`/admin/api/articles/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: t.value }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) return showMsg(j.error || 'Comment failed.'); dirty = false; location.reload();
  });
})();
