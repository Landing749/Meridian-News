// Deterministic contour-line cover art, used where an article has no featured image. Decorative only; served as a cacheable SVG.
const rng = seed => { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };
const hash = s => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const ACCENTS = ['#6fa8e0', '#AEB9C6', '#e08a8a', '#8fc1c9', '#c9b27a'];
function coverSvg(slug, id) {
  const r = rng(hash(slug) * 31 + Number(id) * 7919), W = 800, H = 500, accent = ACCENTS[hash(slug) % ACCENTS.length];
  const centers = Array.from({ length: 2 + Math.floor(r() * 2) }, () => ({ x: 120 + r() * 560, y: 80 + r() * 340, p: [r() * 6.28, r() * 6.28, r() * 6.28], s: 20 + r() * 8 }));
  let paths = '';
  centers.forEach((c, ci) => {
    for (let k = 1; k <= 13; k++) {
      const base = k * c.s; let d = '';
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * Math.PI * 2, rad = base * (1 + 0.16 * Math.sin(2 * a + c.p[0]) + 0.09 * Math.sin(4 * a + c.p[1]) + 0.05 * Math.sin(7 * a + c.p[2]));
        d += `${i ? ' ' : 'M'}${Math.round(c.x + rad * 1.35 * Math.cos(a))} ${Math.round(c.y + rad * Math.sin(a))}`;
      }
      const strong = k % 4 === 0;
      paths += `<path d="${d}Z" stroke="${strong ? accent : '#fff'}" stroke-opacity="${strong ? 0.55 : 0.2 - ci * 0.04}" stroke-width="${strong ? 1.6 : 1}"/>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d4478"/><stop offset="1" stop-color="#0b1a33"/></linearGradient>
<radialGradient id="l" cx=".25" cy=".1" r=".9"><stop offset="0" stop-color="#5f93d0" stop-opacity=".45"/><stop offset="1" stop-color="#5f93d0" stop-opacity="0"/></radialGradient>
<pattern id="d" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r=".9" fill="#fff" fill-opacity=".4"/></pattern><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#000"/></linearGradient><mask id="m"><rect width="${W}" height="${H}" fill="url(#g)"/></mask></defs>
<rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#l)"/><g fill="none">${paths}</g><rect width="${W}" height="${H}" fill="url(#d)" mask="url(#m)"/>
<rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="#AEB9C6" stroke-opacity=".4" stroke-width="1.5" stroke-dasharray="5 6"/></svg>`;
}
module.exports = { coverSvg };
