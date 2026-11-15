const body = document.body, csrf = body.dataset.csrf;
// Sidebar (collapsed state is a per-browser convenience)
const tg = document.getElementById('side-toggle');
try { if (localStorage.getItem('mmg-side') === 'c' && innerWidth > 900) body.classList.add('collapsed'); } catch {}
if (tg) tg.addEventListener('click', () => {
  if (innerWidth <= 900) { const o = body.classList.toggle('open'); tg.setAttribute('aria-expanded', o); return; }
  const c = body.classList.toggle('collapsed'); tg.setAttribute('aria-expanded', !c);
  try { localStorage.setItem('mmg-side', c ? 'c' : 'o'); } catch {}
});
// Accessible confirm dialog for destructive actions
const dlg = document.getElementById('confirm');
document.addEventListener('click', e => {
  const b = e.target.closest('[data-confirm]');
  if (!b || !dlg) return;
  e.preventDefault();
  document.getElementById('confirm-msg').textContent = b.dataset.confirm;
  dlg.returnValue = ''; dlg.showModal();
  dlg.addEventListener('close', () => { if (dlg.returnValue === 'ok') { const f = b.form; if (f) { const h = document.createElement('input'); h.type = 'hidden'; h.name = b.name || '_c'; h.value = b.value || '1'; f.appendChild(h); f.requestSubmit(); } } }, { once: true });
});
// Show/hide password
document.querySelectorAll('[data-toggle-pw]').forEach(b => b.addEventListener('click', () => {
  const i = document.getElementById(b.dataset.togglePw), s = i.type === 'password'; i.type = s ? 'text' : 'password'; b.textContent = s ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', s);
}));
window.mmgFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf, ...(opts.headers || {}) }, credentials: 'same-origin' });
