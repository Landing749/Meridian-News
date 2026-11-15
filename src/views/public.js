const C = require('../content');
const { esc, fmtDate, rt, plain, shiftHeadings } = require('../util');
const { coverSvg } = require('../cover');
const { getSetting } = require('../db');
// Public address of the site (canonical links, social previews, sitemap). Set siteUrl in config.js, or it is taken from where the site is served.
const BASE_URL = () => String((typeof window !== 'undefined' && window.MMG_CONFIG && window.MMG_CONFIG.siteUrl) || (typeof location !== 'undefined' ? location.origin + String(window.MMG_BASE || '') : '') || process.env.SITE_URL || '').replace(/\/$/, '');
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const artUrl = a => `/articles/${a.cat_slug || 'uncategorized'}/${a.slug}`;
const { deliver } = require('../cloud');
// Images are stored as full Cloudinary URLs; this adds automatic format/quality and an optional width.
const imgUrl = (u, w) => deliver(u, w);

function layout(req, o) {
  const title = o.title ? `${o.title} | ${C.name}` : `${C.name} — ${C.slogan}`;
  const canon = BASE_URL() + (o.canonical || req.path);
  const desc = o.desc || 'Meridian Media Group, Inc. is a fictional Philippine media and communications corporation. ' + C.slogan;
  const og = o.image ? imgUrl(o.image, 1200) : BASE_URL() + '/img/logo-full.png';
  const cur = o.nav || req.path;
  const link = ([href, label]) => `<a class="link" href="${href}"${(href === '/' ? cur === '/' : cur.startsWith(href)) ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc.slice(0, 300))}"><link rel="canonical" href="${esc(canon)}">
${o.noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta property="og:site_name" content="${esc(C.name)}"><meta property="og:type" content="${o.ogType || 'website'}"><meta property="og:title" content="${esc(o.title || C.name)}"><meta property="og:description" content="${esc(desc.slice(0, 300))}"><meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="${esc(og)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(o.title || C.name)}"><meta name="twitter:description" content="${esc(desc.slice(0, 200))}">
<link rel="icon" href="/img/favicon.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/site.css">
${o.jsonld ? `<script type="application/ld+json">${JSON.stringify(o.jsonld).replace(/</g, '\\u003c')}</script>` : ''}</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head felt stitch"><div class="wrap"><a class="brand" href="/" aria-label="${esc(C.name)} home"><span class="plate"><img src="/img/logo-mark.png" alt=""></span><span><b>Meridian Media Group</b><small>${esc(C.slogan)}</small></span></a>
<button class="btn paper-btn small menu-btn" aria-expanded="false" aria-controls="nav" id="menu-btn">Menu</button>
<nav class="nav" id="nav" aria-label="Main">${C.nav.map(link).join('')}<a class="btn small" href="/articles">Article archive</a></nav></div></header>
<main id="main">${o.body}</main>${footer()}
<script src="/js/site.js"></script>
</body></html>`;
}
function footer() {
  const addr = getSetting('contact_address', 'Makati City, Philippines');
  return `<footer class="site-foot felt deep contours"><div class="wrap"><div class="cols">
<div><div class="foot-plate"><img src="/img/logo-full.png" alt="${esc(C.name)} logo" loading="lazy"></div><p style="margin-top:1rem;font-family:var(--f-serif);font-style:italic">${esc(C.slogan)}</p></div>
<div><h4>Company</h4>${C.nav.slice(0, 4).map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join('')}</div>
<div><h4>Read and join</h4><a href="/news">News &amp; Announcements</a><a href="/articles">Article archive</a><a href="/careers">Careers</a><a href="/newsletter">Newsletter</a><a href="/contact">Contact Us</a></div>
<div><h4>Contact</h4><p style="margin:.2rem 0;color:#cfdaea">${esc(addr)}</p><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Use</a></div></div>
<div class="legal">&copy; ${new Date().getFullYear()} ${esc(C.name)} All rights reserved. This website and its content are a fictional project.</div></div></footer>`;
}
const cover = (a, cls = 'cover') => a.image ? `<img class="${cls}" src="${imgUrl(a.image, cls.includes('hero') || cls.includes('fill') ? 1600 : 900)}" alt="${esc(a.image_alt || '')}" loading="lazy">` : `<img class="${cls} deco" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverSvg(a.cat_slug || 'general', a.id))}" alt="" loading="lazy">`;
const sampleBadge = a => a.is_sample ? '<span class="badge sample">Sample content</span>' : '';
function card(a) {
  return `<article class="card paper"><a href="${artUrl(a)}" tabindex="-1" aria-hidden="true">${cover(a)}</a>
<div class="in"><div><a class="cat" href="/articles/${a.cat_slug}">${esc(a.category || 'Uncategorized')}</a> ${sampleBadge(a)}</div><h3><a href="${artUrl(a)}">${esc(a.title)}</a></h3>
<p style="margin:0">${esc(a.excerpt || plain(a, 140))}</p>
<div class="meta"><span>${esc(a.author || 'MMG Staff')}</span><span>${fmtDate(a.published_at)}</span><span>${rt(a)} min read</span></div>
<a class="readmore" href="${artUrl(a)}">Read Article<span class="sr">: ${esc(a.title)}</span></a></div></article>`;
}
const pageHead = (title, sub, crumbs) => `<div class="felt deep contours page-head"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${(crumbs || []).map(([h, l]) => ` / ${h ? `<a href="${h}">${esc(l)}</a>` : esc(l)}`).join('')}</nav><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`;
const pager = (p, pages, qs) => pages < 2 ? '' : `<nav class="pager" aria-label="Pagination">${Array.from({ length: pages }, (_, i) => i + 1).map(n => n === p ? `<span class="btn small" aria-current="page">${n}</span>` : `<a class="btn paper-btn small" href="?${qs({ page: n })}">${n}</a>`).join('')}</nav>`;
const contactList = () => {
  const row = (l, k, d) => `<p style="margin:.2rem 0"><b>${l}:</b> ${esc(getSetting(k, '') || d)}</p>`;
  return row('Address', 'contact_address', 'Makati City, Philippines (street address to be provided)') + row('Telephone', 'contact_phone', 'To be provided') + row('Email', 'contact_email', 'To be provided');
};
module.exports = { cover, layout, card, pageHead, pager, initials, artUrl, imgUrl, sampleBadge, contactList, BASE_URL, shiftHeadings };
