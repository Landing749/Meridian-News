// Newsletter send loop: one request per subscriber, about one a second (EmailJS rate limit), with Stop and Resume.
(() => {
  const box = document.getElementById('nl-send'); if (!box) return;
  const go = document.getElementById('nl-go'), stop = document.getElementById('nl-stop'), bar = document.getElementById('nl-bar'), msg = document.getElementById('nl-msg');
  const id = box.dataset.id; let running = false, stopped = false;
  const post = path => mmgFetch(`/admin/api/newsletter/${id}/${path}`, { method: 'POST', body: '{}' }).then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
  const show = p => { bar.hidden = false; bar.max = Math.max(1, p.total); bar.value = p.sent + p.failed; msg.textContent = `Sent ${p.sent} of ${p.total}${p.failed ? ` · ${p.failed} failed` : ''}${p.error ? ' · ' + p.error : ''}`; };
  const guard = e => { if (running) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  async function run() {
    if (running) return; stopped = false;
    const resuming = box.dataset.status === 'sending';
    if (!resuming && !confirm(`Send this newsletter to ${box.dataset.total} subscriber(s)? It cannot be recalled, and each email uses one of your EmailJS monthly emails.`)) return;
    running = true; go.disabled = true; stop.hidden = false; msg.textContent = 'Starting…';
    try {
      const s = await post('start'); if (!s.ok) { msg.textContent = s.j.error || 'Could not start sending.'; return; }
      box.dataset.status = 'sending'; show(s.j);
      let streak = 0, last = { sent: s.j.sent, failed: s.j.failed };
      while (!stopped) {
        const r = await post('next'); if (!r.ok) { msg.textContent = r.j.error || 'Sending failed.'; break; }
        show(r.j);
        streak = r.j.failed > last.failed && r.j.sent === last.sent ? streak + 1 : r.j.sent > last.sent ? 0 : streak; last = { sent: r.j.sent, failed: r.j.failed };
        if (streak >= 3 && !r.j.done) { msg.textContent = `Stopped: the last ${streak} emails all failed${r.j.error ? ' (' + r.j.error + ')' : ''}. Check the EmailJS service, template and limits, then press Resume.`; break; }
        if (r.j.done) { msg.textContent = `Finished. ${r.j.sent} sent${r.j.failed ? `, ${r.j.failed} failed` : ''}. Reloading…`; running = false; setTimeout(() => location.reload(), 900); return; }
        if (r.j.fatal) { msg.textContent = 'Stopped: ' + r.j.error + ' Fix the problem, then press Resume.'; break; }
        await new Promise(res => setTimeout(res, 1200));
      }
      if (stopped) msg.textContent += ' · Paused. Press Resume to continue.';
    } finally { running = false; go.disabled = false; stop.hidden = true; go.textContent = 'Resume sending'; }
  }
  go.addEventListener('click', run);
  stop.addEventListener('click', () => { stopped = true; stop.disabled = true; setTimeout(() => { stop.disabled = false; }, 1500); });
})();
