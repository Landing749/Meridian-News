const { esc, fmtDate } = require('../util');
const { can, ROLES } = require('../auth');
const ICON = { dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z', articles: 'M5 3h11l3 3v15H5zM8 9h8M8 13h8M8 17h5', plus: 'M12 5v14M5 12h14', review: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', check: 'M5 12l4 4 10-10', pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', archive: 'M3 5h18v4H3zM5 9v11h14V9M10 13h4', folder: 'M3 6h7l2 2h9v11H3z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', image: 'M3 5h18v14H3zM8 11a2 2 0 100-4 2 2 0 000 4zM21 16l-5-5-8 8', briefcase: 'M3 8h18v12H3zM9 8V5h6v3',
  megaphone: 'M4 10v4h4l8 5V5L8 10zM19 9v6', inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5', users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM2 20a7 7 0 0114 0M17 11a3 3 0 100-6M22 20a7 7 0 00-4-6',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', log: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3', cog: 'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4', menu: 'M3 6h18M3 12h18M3 18h18', issue: 'M4 4h13v16H4zM17 8h3v10a2 2 0 01-2 2M7 8h7M7 12h7M7 16h4', home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6', org: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4' };
const ic = n => `<svg class="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;
const NAV = [
  ['/admin/dashboard', 'Dashboard', 'dashboard', null], ['/admin/articles', 'Articles', 'articles', null], ['/admin/articles/new', 'New Article', 'plus', 'article.create'], ['/admin/homepage', 'Homepage Manager', 'home', 'homepage.manage'],
  ['/admin/articles?status=pending_review', 'Pending Reviews', 'review', 'article.review'], ['/admin/articles?status=scheduled', 'Scheduled Articles', 'calendar', null],
  ['/admin/articles?status=published', 'Published Articles', 'check', null], ['/admin/articles?status=draft', 'Drafts', 'pen', null], ['/admin/articles?status=archived', 'Archived Articles', 'archive', null],
  ['/admin/categories', 'Categories', 'folder', 'taxonomy.categories'], ['/admin/tags', 'Tags', 'tag', 'taxonomy.tags'], ['/admin/authors', 'Authors', 'user', 'authors.manage'], ['/admin/staff', 'Staff & Leadership', 'users', 'staff.manage'], ['/admin/departments', 'Departments', 'org', 'staff.manage'],
  ['/admin/media', 'Media Library', 'image', 'media.upload'], ['/admin/calendar', 'Editorial Calendar', 'calendar', 'calendar.view'], ['/admin/careers', 'Careers', 'briefcase', 'careers.manage'],
  ['/admin/announcements', 'Corporate Announcements', 'megaphone', 'announcements.manage'], ['/admin/issues', 'Print Issues', 'issue', 'issues.manage'], ['/admin/newsletter', 'Newsletter', 'megaphone', 'newsletter.manage'], ['/admin/inquiries', 'Contact Inquiries', 'inbox', 'inquiries.manage'],
  ['/admin/users', 'Users & Roles', 'users', 'users.manage'], ['/admin/analytics', 'Analytics', 'chart', 'analytics.view'], ['/admin/logs', 'Activity Logs', 'log', 'audit.view'], ['/admin/settings', 'Settings', 'cog', 'settings.manage'],
];
function layout(req, o) {
  const u = req.user, cur = req.originalUrl;
  const items = NAV.filter(n => !n[3] || can(u, n[3])).map(([h, l, i]) => {
    const active = h === cur || (!h.includes('?') && !cur.includes('?') && cur.startsWith(h) && h !== '/admin/articles') || (h === '/admin/articles' && /^\/admin\/articles(\/\d+.*)?$/.test(cur.split('?')[0]) && !cur.includes('status=')) ;
    return `<a href="${h}"${active ? ' aria-current="page"' : ''}>${ic(i)}<span>${esc(l)}</span></a>`;
  }).join('');
  const flash = req.query.ok ? `<div class="notice ok" role="status">${esc(req.query.ok)}</div>` : req.query.err ? `<div class="notice bad" role="alert">${esc(req.query.err)}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(o.title)} | MMG Newsroom</title>
<link rel="icon" href="/img/favicon.png"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Libre+Baskerville:wght@400;700&family=Montserrat:wght@500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/admin.css"></head><body class="adm" data-csrf="${esc(req.csrf)}">
<a class="skip" href="#main">Skip to content</a>
<aside class="side felt deep stitch" id="sidebar" aria-label="Newsroom navigation"><a class="side-brand" href="/admin/dashboard"><span class="plate"><img src="/img/logo-mark.png" alt=""></span><span class="lbl"><b>MMG Newsroom</b><small>Editorial CMS</small></span></a><nav>${items}</nav>
<a class="viewsite" href="/" target="_blank" rel="noopener">View public site</a></aside>
<div class="main-col"><header class="topbar paper-flat"><button class="btn paper-btn small" id="side-toggle" aria-controls="sidebar" aria-expanded="true">${ic('menu')}<span class="sr">Toggle navigation</span></button>
<h1 class="top-title">${esc(o.title)}</h1><div class="who"><a href="/admin/account">${esc(u.name)}</a><span class="badge">${esc(ROLES[u.role].label)}</span>
<form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${esc(req.csrf)}"><button class="btn paper-btn small" type="submit">Sign out</button></form></div></header>
<main id="main" class="content">${flash}${o.body}</main></div>
<dialog id="confirm" aria-labelledby="confirm-title"><form method="dialog" class="paper"><h2 id="confirm-title" style="font-size:1.3rem">Please confirm</h2><p id="confirm-msg"></p><div style="display:flex;gap:.6rem;justify-content:flex-end"><button class="btn paper-btn" value="cancel">Cancel</button><button class="btn danger" value="ok" id="confirm-ok">Confirm</button></div></form></dialog>
<script src="/js/admin.js"></script>${(o.scripts || []).map(s => `<script src="${s}"></script>`).join('')}</body></html>`;
}
const status = s => `<span class="badge ${s}">${({ draft: 'Draft', pending_review: 'Pending review', approved: 'Approved', scheduled: 'Scheduled', published: 'Published', archived: 'Archived' })[s] || s}</span>`;
const csrf = req => `<input type="hidden" name="_csrf" value="${esc(req.csrf)}">`;
const confirmBtn = (req, action, label, msg, cls = 'danger small', extra = '') => `<form method="post" action="${action}" style="display:inline">${csrf(req)}${extra}<button class="btn ${cls}" type="submit" data-confirm="${esc(msg)}">${label}</button></form>`;
const empty = (t, d) => `<div class="paper empty"><h3>${esc(t)}</h3><p>${esc(d || '')}</p></div>`;
const table = (heads, rows, cap) => `<div class="tbl-wrap paper-flat"><table class="tbl"><caption class="sr">${esc(cap || '')}</caption><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const cols = (data, max) => { const m = max || Math.max(1, ...data.map(d => d.v)); return `<div class="cols" role="img" aria-label="Bar chart. ${data.map(d => `${d.label}: ${d.v}`).join('; ')}">${data.map(d => `<div class="col" title="${esc(d.label)}: ${d.v}"><span class="bar" style="height:${Math.round(d.v / m * 100)}%"></span><span class="x">${esc(d.short ?? d.label)}</span></div>`).join('')}</div>`; };
const hbars = (data, max) => { const m = max || Math.max(1, ...data.map(d => d.v)); return `<ul class="hbars">${data.map(d => `<li><span class="nm">${esc(d.label)}</span><span class="track"><span class="fill" style="width:${Math.round(d.v / m * 100)}%"></span></span><span class="n">${d.v}</span></li>`).join('')}</ul>`; };
const pager = (p, pages, base) => pages < 2 ? '' : `<nav class="pager" aria-label="Pagination">${Array.from({ length: pages }, (_, i) => i + 1).map(n => n === p ? `<span class="btn small" aria-current="page">${n}</span>` : `<a class="btn paper-btn small" href="${base}${base.includes('?') ? '&' : '?'}page=${n}">${n}</a>`).join('')}</nav>`;
const standalone = (title, inner, extraHead = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} | MMG Newsroom</title><link rel="icon" href="/img/favicon.png"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Montserrat:wght@500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/admin.css">${extraHead}</head><body class="login felt deep contours"><main id="main" class="login-card"><div class="logo-plate"><img src="/img/logo-full.png" alt="Meridian Media Group, Inc."></div><div class="paper login-sheet">${inner}</div><p class="login-foot">Authorized staff only. Activity is logged.</p></main><script src="/js/admin.js"></script></body></html>`;
module.exports = { layout, status, csrf, confirmBtn, empty, table, cols, hbars, pager, standalone, ic };
