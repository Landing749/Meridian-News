// Renders newspaper pages from data and auto-fits the article text: paste text -> columns fill edge to edge, justified.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LEFT = '/img/issue-logo-left.png', RIGHT = '/img/issue-logo-right.png';
  const PX = 96 / 72, MIN_PT = 7, MAX_PT = 14, LH_MIN = 1.34, LH_MAX = 1.7;

  // Heuristic syllable hyphenation (Filipino and English). Inserts invisible soft hyphens so justified narrow columns avoid wide gaps.
  const VOW = 'aeiouáéíóúàèìòùâêîôû', isV = c => VOW.includes(c.toLowerCase());
  function hyphenate(w) {
    const lw = w.toLowerCase(), u = [];
    for (let i = 0; i < w.length;) {
      const two = lw.slice(i, i + 2);
      if (!isV(lw[i]) && ['ng', 'th', 'ch', 'sh', 'ph', 'wh', 'ck'].includes(two) && (two !== 'ng' || (i + 2 < w.length && isV(lw[i + 2])))) { u.push([w.slice(i, i + 2), 0]); i += 2; }
      else { u.push([w[i], isV(lw[i]) ? 1 : 0]); i++; }
    }
    const brk = new Set();
    for (let i = 0; i < u.length; i++) {
      if (!u[i][1]) continue; let j = i + 1; while (j < u.length && !u[j][1]) j++; if (j >= u.length) break;
      const c = j - i - 1; if (c === 1) brk.add(i + 1); else if (c >= 2) brk.add(i + 2);
    }
    let out = '', pos = 0;
    u.forEach(([t], k) => { if (brk.has(k) && pos >= 3 && w.length - pos >= 3) out += '\u00ad'; out += t; pos += t.length; });
    return out;
  }
  function paras(text) {
    const t = String(text || '').replace(/\r/g, '').trim(); if (!t) return [];
    let parts = t.split(/\n\s*\n+/); if (parts.length === 1) parts = t.split(/\n+/);
    return parts.map(p => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean);
  }
  function pageHtml(S, P, n) {
    const L = P.layout || 'L2', cols = Math.min(5, Math.max(1, +P.columns || 3)), front = !!P.front, hy = S.hyphenate !== false;
    const ps = paras(P.body);
    const body = ps.length ? ps.map((p, i) => `<p${i === 0 ? ' class="first"' : ''}>${esc(hy ? p.replace(/[A-Za-zÀ-ÿ]{8,}/g, hyphenate) : p)}</p>`).join('') : (S.placeholders ? '<p class="first">Paste the full article text into the editor. It will fill and justify these columns automatically.</p>' : '');
    const logo = (u, d) => `<img src="${esc(u || d)}" alt="">`;
    return `<section class="page t5 ${L}${P.photo_url ? '' : ' nophoto'}"><header class="mast${front ? ' front' : ''}"><div class="logos">${logo(S.left_logo_url, LEFT)}<div class="title">${esc(S.masthead)}</div>${logo(S.right_logo_url, RIGHT)}</div>
<div class="meta"><span>${esc(S.date_text)}</span><span>${esc(S.edition)}</span><span>${esc(S.volume)}</span><span>${esc(S.price)}</span></div></header>
<main class="${front ? 'front' : ''}"><div class="sec">${esc(P.section)}</div><h1 class="${front ? 'big ' : ''}a1">${esc(P.headline)}</h1><p class="deck a1">${esc(P.deck)}</p>
<div class="by"><b>${P.byline ? 'By ' + esc(P.byline) : ''}</b><span>${esc(P.dateline)}</span></div>
<figure><div class="photo">${P.photo_url ? `<img src="${esc(P.photo_url)}" alt="">` : '<span>PHOTO</span>'}</div><figcaption>${esc(P.caption)} <em>${esc(P.credit)}</em></figcaption></figure>
<div class="cols c${cols}${S.justify === false ? ' left' : ''}" style="column-count:${cols}">${body}</div></main>
<footer><img src="${esc(S.left_logo_url || LEFT)}" alt=""><div class="pn"><span>${n}</span></div><img src="${esc(S.right_logo_url || RIGHT)}" alt=""></footer></section>`;
  }
  // Fit: balanced columns, largest font that fits, then loosen line spacing to reach the bottom. Several nearby sizes are tried and the one
  // whose last column ends lowest (columns most evenly filled) wins.
  function fit(page) {
    const c = page.querySelector('.cols'); if (!c) return null;
    c.style.height = '100%'; c.style.fontSize = ''; c.style.lineHeight = '';
    const H = c.getBoundingClientRect().height; if (H < 60) return null;
    c.style.height = 'auto';
    const h = () => c.getBoundingClientRect().height, set = (fs, lh) => { c.style.fontSize = fs + 'px'; c.style.lineHeight = lh; };
    if (!c.textContent.trim()) { set(MIN_PT * PX * 1.4, 1.4); return { empty: true, fill: 0, pt: 0, lh: 0 }; }
    const stretch = fs => { let a = LH_MIN, b = LH_MAX, bl = LH_MIN; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; set(fs, m); if (h() <= H) { bl = m; a = m; } else b = m; } set(fs, bl); return bl; };
    const lastBottom = () => { const ps = c.querySelectorAll('p'), last = ps[ps.length - 1], w = document.createTreeWalker(last, NodeFilter.SHOW_TEXT); let n, t; while ((n = w.nextNode())) t = n; if (!t) return 0; const r = document.createRange(); r.selectNodeContents(t); const rs = r.getClientRects(); return rs.length ? rs[rs.length - 1].bottom - c.getBoundingClientRect().top : 0; };
    let lo = MIN_PT * PX, hi = MAX_PT * PX, best = lo; set(lo, LH_MIN);
    if (h() > H + 0.5) return { pt: MIN_PT, lh: LH_MIN, fill: 1, overflow: true, empty: false };
    for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; set(m, LH_MIN); if (h() <= H) { best = m; lo = m; } else hi = m; }
    let pick = { fs: best, lh: stretch(best), score: -1 };
    for (let k = 0; k <= 12; k++) { const fs = best * (1 - 0.012 * k); if (fs < MIN_PT * PX) break; const lh = stretch(fs), sc = lastBottom() / H; if (sc > pick.score + 0.004) pick = { fs, lh, score: sc }; }
    set(pick.fs, pick.lh);
    return { pt: Math.round(pick.fs / PX * 100) / 100, lh: Math.round(pick.lh * 100) / 100, fill: Math.min(1, h() / H), lastFill: Math.round(Math.min(1, lastBottom() / H) * 100) / 100, overflow: false, empty: false };
  }
  function fitTitle(pg) { const e = pg.querySelector('.title'); if (!e) return; e.style.removeProperty('font-size'); let s = parseFloat(getComputedStyle(e).fontSize); while (e.scrollWidth > e.clientWidth + 1 && s > 8) { s -= .5; e.style.setProperty('font-size', s + 'px', 'important'); } }
  const waitImgs = root => Promise.all([...root.querySelectorAll('img')].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })));
  const FONTS = ['800 24pt "Roboto Slab"', '400 11pt "Roboto Slab"', '400 11pt Lora', 'italic 400 11pt Lora', '700 11pt Lora', '400 8pt "Roboto Condensed"', '700 8pt "Roboto Condensed"', 'italic 400 8pt "Roboto Condensed"'];
  async function render(root, S, items) {
    try { await Promise.all(FONTS.map(f => document.fonts.load(f))); } catch {}
    root.innerHTML = items.map(({ P, n }) => pageHtml(S, P, n)).join('');
    await waitImgs(root);
    return [...root.querySelectorAll('.page')].map(pg => { fitTitle(pg); return fit(pg); });
  }
  window.MMGNews = { render, paras };

  // Print / embed page bootstrap
  const dataEl = document.getElementById('issue-data'); if (!dataEl) return;
  const root = document.getElementById('root'), embed = document.body.classList.contains('embed');
  const draw = async (S, pages, only) => {
    const items = pages.map((P, i) => ({ P, n: i + 1 })).filter((_, i) => only == null || i === only);
    const stats = await render(root, { ...S, placeholders: embed }, items);
    window.__ready = true; if (embed) parent.postMessage({ type: 'fit', stats }, location.origin);
  };
  const init = JSON.parse(dataEl.textContent);
  const q = new URLSearchParams(location.search), only = q.get('page') != null ? +q.get('page') : null;
  draw(init.settings, init.pages, embed ? (only || 0) : null);
  if (embed) addEventListener('message', e => { if (e.origin === location.origin && e.data?.type === 'issue-state') draw(e.data.settings, e.data.pages, e.data.index); });
  const pb = document.getElementById('do-print'); if (pb) pb.addEventListener('click', () => print());
})();
