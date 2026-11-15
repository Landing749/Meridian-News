const b = document.getElementById('menu-btn'), n = document.getElementById('nav');
if (b && n) {
  b.addEventListener('click', () => { const o = n.classList.toggle('open'); b.setAttribute('aria-expanded', o); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && n.classList.contains('open')) { n.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); b.focus(); } });
}
const cp = document.getElementById('copy-link');
if (cp) cp.addEventListener('click', async e => {
  const s = document.getElementById('copied');
  try { await navigator.clipboard.writeText(e.target.dataset.url); s.textContent = 'Link copied.'; } catch { s.textContent = 'Copy failed. Copy the address from your browser instead.'; }
});
const dl = document.getElementById('dl-article');
if (dl) dl.addEventListener('click', async () => {
  const imgs = [...document.querySelectorAll('.article-sheet img')]; imgs.forEach(i => { i.loading = 'eager'; });
  await Promise.all(imgs.map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })));
  const t = document.title; document.title = dl.dataset.title || t;
  addEventListener('afterprint', () => { document.title = t; }, { once: true }); print();
});
