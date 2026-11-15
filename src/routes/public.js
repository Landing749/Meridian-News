const express = require('express');
const C = require('../content');
const Q = require('../queries');
const db = require('../db');
const { esc, fmtDate, rt, plain, cleanBody, shiftHeadings } = require('../util');
const V = require('../views/public');
const H = require('../homepage');
const ST = require('../staff');
const SV = require('../views/staff');
const { hit } = require('../auth');
const r = express.Router();
const { layout, card, pageHead, pager, initials, artUrl, imgUrl, BASE_URL } = V;

r.get('/', (req, res) => {
  const R = H.resolve(), top = R.top, { lead, rail, row } = H.split(R), show = H.shownMap(), banner = H.banner();
  const counts = {}; for (const a of Q.published()) if (a.cat_slug) counts[a.cat_slug] = (counts[a.cat_slug] || 0) + 1;
  const cats = Q.categories(), pop = Q.popular(5);
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });
  const toc = cats.filter(c => counts[c.slug]);
  const anns = Q.search({ announcement: true, limit: 3 }).rows;
  const jobs = openJobs().slice(0, 3);
  const brief = a => `<article class="brief"><a href="${artUrl(a)}" tabindex="-1" aria-hidden="true">${V.cover(a)}</a><div><a class="cat" href="/articles/${a.cat_slug}">${esc(a.category || '')}</a> ${V.sampleBadge(a)}<h3><a href="${artUrl(a)}">${esc(a.title)}</a></h3><div class="meta"><span>${fmtDate(a.published_at)}</span><span>${rt(a)} min read</span></div></div></article>`;
  const body = `
<section class="felt deep contours hero"><div class="wrap">
  <div class="broadsheet">
    <div class="nameplate">
      <div class="ear ear-l"><span class="plate"><img src="/img/logo-mark.png" alt=""></span></div>
      <div class="ttl"><h1 class="wordmark">Meridian Media Group<span>, Inc.</span></h1><p class="slogan-line">${esc(C.slogan)}</p></div>
      <div class="ear ear-r"><b>Est. ${C.founded}</b><span>${esc(C.hq.split(',')[0])}</span></div>
    </div>
    <div class="rule3"></div>
    <div class="dateline"><span>${esc(today)}</span><span>Philippine media &amp; communications</span><span>${esc(C.ownership)}</span></div>
    <div class="rule1"></div>
    ${banner ? `<figure class="home-banner"><img src="${imgUrl(banner.url, 1800)}" alt="${esc(banner.alt)}" fetchpriority="high">${banner.caption ? `<figcaption>${esc(banner.caption)}</figcaption>` : ''}</figure>` : ''}
    <div class="bs-grid">
      ${top ? `<article class="lead-story"><div class="ls-text"><div class="ls-kick"><a class="cat" href="/articles/${top.cat_slug}">${esc(top.category || '')}</a><span>${fmtDate(top.published_at)}</span></div>
        <h2 class="ls-title"><a href="${artUrl(top)}">${esc(top.title)}</a></h2>${top.subtitle ? `<p class="ls-deck">${esc(top.subtitle)}</p>` : top.excerpt ? `<p class="ls-deck">${esc(top.excerpt)}</p>` : ''}
        
        <div class="ls-by"><span>By <b>${esc(top.author || 'MMG Staff')}</b> · ${rt(top)} min read</span><a class="go" href="${artUrl(top)}">Continue reading<span class="sr">: ${esc(top.title)}</span> →</a></div></div><figure class="ls-fig"><a href="${artUrl(top)}" tabindex="-1" aria-hidden="true">${V.cover(top, 'cover')}</a>${top.is_sample ? '<span class="stamp">Sample</span>' : ''}${top.image && (top.image_caption || top.image_credit) ? `<figcaption>${esc(top.image_caption)} ${top.image_credit ? `<em>${esc(top.image_credit)}</em>` : ''}</figcaption>` : ''}</figure></article>`
      : `<article class="lead-story"><h2 class="ls-title">The first edition is being prepared.</h2><p class="ls-deck">Published articles will appear on this front page automatically.</p></article>`}
      <aside class="contents" aria-label="Contents and search">
        <form class="slot" action="/articles" method="get" role="search"><label class="sr" for="hq">Search the archive</label><input id="hq" name="q" type="search" placeholder="Search the archive" maxlength="100"><button type="submit" aria-label="Search">Go</button></form>
        <h3>Contents</h3>
        <ul class="toc">${toc.map(c => `<li><a href="/articles/${c.slug}"><span>${esc(c.name)}</span><i></i><b>${counts[c.slug]}</b></a></li>`).join('') || '<li class="muted">No articles yet</li>'}<li class="all"><a href="/articles"><span>Full article archive</span><i></i><b>→</b></a></li></ul>
        ${show.announcements && anns[0] ? `<a class="notice-box${anns[0].is_important ? ' important' : ''}" href="${artUrl(anns[0])}"><small>${anns[0].is_important ? 'Important notice' : 'Corporate notice'} · ${fmtDate(anns[0].published_at)}</small><strong>${esc(anns[0].title)}</strong></a>` : ''}
      </aside>
    </div>
    <p class="colophon"><span>${esc(C.name)} · Founded ${C.founded} · ${esc(C.hq)}</span><span><a href="/about">About</a> · <a href="/profile">Corporate profile</a> · <a href="/careers">Careers</a> · <a href="/contact">Contact</a></span></p>
  </div>
</div></section>` + (show.articles ? `

<section class="frontpage"><div class="wrap">
  <header class="sec-title"><div><span class="folio">From the newsroom</span><h2>Articles</h2></div><a class="btn paper-btn small" href="/articles">View all articles</a></header>
  <nav class="catbar" aria-label="Browse by category"><a href="/articles">All<small>${R.hasArticles ? Object.values(counts).reduce((x, y) => x + y, 0) : 0}</small></a>${cats.map(c => `<a href="/articles/${c.slug}">${esc(c.name)}<small>${counts[c.slug] || 0}</small></a>`).join('')}</nav>
  ${lead ? `<div class="fp-grid"><article class="lead paper"><a href="${artUrl(lead)}" tabindex="-1" aria-hidden="true">${V.cover(lead)}</a><div class="in"><div class="tags"><a class="cat" href="/articles/${lead.cat_slug}">${esc(lead.category || '')}</a> ${V.sampleBadge(lead)}${lead.is_featured ? ' <span class="badge">Featured</span>' : ''}</div>
    <h3><a href="${artUrl(lead)}">${esc(lead.title)}</a></h3><p class="lede">${esc(lead.excerpt || plain(lead, 180))}</p><div class="meta"><span>${esc(lead.author || 'MMG Staff')}</span><span>${fmtDate(lead.published_at)}</span><span>${rt(lead)} min read</span></div><a class="readmore" href="${artUrl(lead)}">Read Article<span class="sr">: ${esc(lead.title)}</span></a></div></article>
  <div class="rail">${rail.map(brief).join('') || '<p class="muted">More articles will appear here.</p>'}</div></div>
  <div class="fp-row"><div>${row.length ? `<div class="cards">${row.map(card).join('')}</div>` : ''}</div>
  <aside class="mostread paper-flat" aria-label="Most read"><h3>Most read</h3><ol>${pop.map((a, i) => `<li><span class="num">${i + 1}</span><div><a class="cat" href="/articles/${a.cat_slug}">${esc(a.category || '')}</a><a class="hl" href="${artUrl(a)}">${esc(a.title)}</a></div></li>`).join('')}</ol></aside></div>`
  : `<div class="paper empty"><h3>More stories are on the way</h3><p>Everything published appears here automatically. <a href="/articles">Open the archive</a></p></div>`}
</div></section>` : '') + (show.announcements ? `

<section class="felt contours on-felt board"><div class="wrap">
  <header class="sec-title"><div><span class="folio">Official notices</span><h2>Corporate announcements</h2></div><a class="btn paper-btn small" href="/news">All announcements</a></header>
  ${anns.length ? `<div class="board-grid">${anns.map(a => `<article class="paper slip${a.is_important ? ' important' : ''}"><span class="d">${fmtDate(a.published_at)}${a.is_important ? ' · <b class="red">Important</b>' : ''}</span><h3><a href="${artUrl(a)}">${esc(a.title)}</a></h3><p>${esc(a.excerpt || '')}</p>${V.sampleBadge(a)}</article>`).join('')}</div>` : '<div class="paper empty"><h3>No announcements yet</h3><p>Official company notices will be pinned here when published.</p></div>'}
</div></section>` : '') + (show.about ? `

<section><div class="wrap"><header class="sec-title"><div><span class="folio">Who we are</span><h2>A media corporation built on trust</h2></div><a class="btn paper-btn small" href="/profile">Corporate profile</a></header>
  <div class="about"><div><p class="lede">${esc(C.name)} (${C.abbr}) brings information to Filipino audiences through editorial publishing and corporate communications.</p><p>Since ${C.founded}, the corporation has operated from ${esc(C.hq)} as a privately held company. Our newsroom standards are accuracy, accountability and service to the public.</p></div>
  <div class="plaques"><div class="plaque felt deep"><span class="folio">Mission</span><p>${esc(C.mission)}</p></div><div class="plaque paper"><span class="folio">Vision</span><p>${esc(C.vision)}</p></div></div></div>
  <ul class="values2">${C.values.map((v, i) => `<li class="v"><i>${['I', 'II', 'III', 'IV', 'V', 'VI'][i]}</i>${esc(v)}</li>`).join('')}</ul></div></section>` : '') + (show.story ? `

<section class="contours ink tinted"><div class="wrap story-grid"><div><span class="folio">Our story</span><h2 class="sec">Where Meridian began</h2><p class="lede">A chronology of the corporation, starting in ${C.founded}. Further milestones will be added once the company confirms them.</p></div>${timeline()}</div></section>` : '') + (show.leadership ? `

<section><div class="wrap"><header class="sec-title"><div><span class="folio">Leadership and governance</span><h2>The people who lead MMG</h2></div><a class="btn paper-btn small" href="/leadership">Leadership</a></header>
  ${staffGrid(staffList(true))}</div></section>` : '') + (show.careers ? `

<section class="tinted"><div class="wrap two"><div><span class="folio">Careers</span><h2 class="sec">Work with Meridian</h2><p class="lede">We are looking for people who care about accuracy, craft and public service.</p><p><a class="btn" href="/careers">See open positions</a></p></div>
<div style="display:grid;gap:1rem">${jobs.length ? jobs.map(jobRow).join('') : '<div class="paper empty"><p>There are no open positions right now.</p></div>'}</div></div></section>` : '') + (show.contact ? `

<section class="felt deep contours"><div class="wrap contact-grid"><div><span class="folio" style="color:var(--silver)">Contact</span><h2 class="sec" style="color:#fff">Talk to us</h2><div style="color:#dfe7f2">${V.contactList()}</div></div>${contactForm(req)}</div></section>` : '');
  res.send(layout(req, { body, desc: `${C.name} is a fictional Philippine media and communications corporation. ${C.slogan}`, jsonld: { '@context': 'https://schema.org', '@type': 'Organization', name: C.name, foundingDate: String(C.founded), slogan: C.slogan, url: BASE_URL(), logo: BASE_URL() + '/img/logo-full.png' } }));
});
const staffList = homeOnly => db.where('staff', m => m.visible === 1 && (!homeOnly || m.show_on_home === 1)).sort((x, y) => x.sort - y.sort || x.id - y.id);
// Published positions whose deadline (if any) has not passed, newest first.
const openJobs = () => { const today = new Date().toISOString().slice(0, 10); return db.where('jobs', j => j.status === 'published' && (!j.deadline || j.deadline.slice(0, 10) >= today)).sort((x, y) => (y.created_at < x.created_at ? -1 : y.created_at > x.created_at ? 1 : y.id - x.id)); };
const { staffGrid } = SV;
const timeline = () => `<ol class="timeline">${C.story.map(s => `<li><span class="year">${esc(s.year)}</span><div class="paper-flat"><h3 style="font-size:1.2rem;margin:0 0 .3rem">${esc(s.title)}</h3><p style="margin:0">${esc(s.text)}</p>${s.verified ? '' : '<span class="badge sample" style="margin-top:.5rem">Placeholder</span>'}</div></li>`).join('')}</ol>`;
const announcements = list => list.length ? `<div class="ann">${list.map(a => { const d = new Date(String(a.published_at).replace(' ', 'T') + 'Z'); return `<article class="paper ann-item${a.is_important ? ' important' : ''}"><div class="datechip">${d.getUTCDate()}<small>${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}</small></div><div><h3><a href="${artUrl(a)}">${esc(a.title)}</a></h3>${a.is_important ? '<span class="badge red">Important</span> ' : ''}${V.sampleBadge(a)}<p style="margin:.4rem 0 0">${esc(a.excerpt || '')}</p></div></article>`; }).join('')}</div>` : '<div class="paper empty"><h3>No announcements yet</h3><p>Official company notices will appear here when published.</p></div>';
const execs = () => `<div class="execs"><div class="paper exec"><div class="portrait">Portrait placeholder</div><h3>${esc(C.ceo)}</h3><p>Chief Executive Officer</p></div>${[1, 2, 3].map(() => `<div class="paper exec"><div class="portrait">Portrait placeholder</div><h3>Name to be provided</h3><p>Position to be announced</p></div>`).join('')}</div><p class="help" style="margin-top:1rem">Biographies will be added once the company supplies verified information.</p>`;
const jobRow = j => `<div class="paper job"><div><h3><a href="/careers/${esc(j.slug)}" style="color:inherit">${esc(j.title)}</a> ${j.is_sample ? '<span class="badge sample">Sample</span>' : ''}</h3><div class="meta"><span>${esc(j.department)}</span><span>${esc(j.employment_type)}</span><span>${esc(j.location)}</span>${j.deadline ? `<span>Apply by ${fmtDate(j.deadline)}</span>` : ''}</div></div><a class="btn paper-btn small" href="/careers/${esc(j.slug)}">View details</a></div>`;
function contactForm(req, state = {}) {
  const ts = Date.now().toString();
  const v = k => esc(state.values?.[k] || '');
  return `<form class="paper contact-form" method="post" action="/contact#contact-form" id="contact-form" novalidate>
<h3 style="font-size:1.5rem">Send an inquiry</h3>
${state.ok ? '<div class="notice ok" role="status">Thank you. Your message was received and recorded. We will respond when we can.</div>' : ''}
${state.error ? `<div class="notice bad" role="alert">${esc(state.error)}</div>` : ''}
<input type="hidden" name="ts" value="${ts}">
<div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="field"><label for="c-name">Name</label><input id="c-name" name="name" type="text" required maxlength="120" autocomplete="name" value="${v('name')}">${state.errors?.name ? `<div class="err">${state.errors.name}</div>` : ''}</div>
<div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" required maxlength="200" autocomplete="email" value="${v('email')}">${state.errors?.email ? `<div class="err">${state.errors.email}</div>` : ''}</div>
<div class="field"><label for="c-cat">Inquiry category</label><select id="c-cat" name="category">${C.inquiryCategories.map(c => `<option${state.values?.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
<div class="field"><label for="c-sub">Subject</label><input id="c-sub" name="subject" type="text" required maxlength="160" value="${v('subject')}">${state.errors?.subject ? `<div class="err">${state.errors.subject}</div>` : ''}</div>
<div class="field"><label for="c-msg">Message</label><textarea id="c-msg" name="message" required maxlength="5000">${v('message')}</textarea>${state.errors?.message ? `<div class="err">${state.errors.message}</div>` : ''}</div>
<div class="field"><label style="font-weight:500;display:flex;gap:.6rem;align-items:flex-start"><input type="checkbox" name="consent" value="1" required style="margin-top:.3rem"${state.values?.consent ? ' checked' : ''}> <span>I have read the <a href="/privacy">Privacy Policy</a> and agree that MMG may process these details to respond to my inquiry.</span></label>${state.errors?.consent ? `<div class="err">${state.errors.consent}</div>` : ''}</div>
<button class="btn" type="submit">Send inquiry</button></form>`;
}
r.get('/contact', (req, res) => res.send(layout(req, { title: 'Contact Us', desc: 'Contact Meridian Media Group, Inc.', body: pageHead('Contact Us', 'Questions, press requests and feedback are welcome.', [[null, 'Contact Us']]) + `<section><div class="wrap contact-grid"><div><h2 class="sec">Corporate details</h2>${V.contactList()}</div>${contactForm(req)}</div></section>` })));
r.post('/contact', async (req, res) => {
  const b = req.body || {}, errors = {}, values = { name: b.name, email: b.email, category: b.category, subject: b.subject, message: b.message, consent: b.consent };
  const render = st => res.status(st.error || Object.keys(st.errors || {}).length ? 400 : 200).send(layout(req, { title: 'Contact Us', noindex: true, body: pageHead('Contact Us', '', [[null, 'Contact Us']]) + `<section><div class="wrap contact-grid"><div><h2 class="sec">Corporate details</h2>${V.contactList()}</div>${contactForm(req, st)}</div></section>` }));
  const age = Date.now() - Number(b.ts);
  if (b.website) return render({ ok: true });
  if (!b.ts || !(age >= 0) || age > 7200000) return render({ error: 'This form expired. Reload the page and try again.', values });
  if (age < 3000) return render({ error: 'That was very quick. Please check your details and send again.', values });
  const name = String(b.name || '').trim(), email = String(b.email || '').trim(), subject = String(b.subject || '').trim(), message = String(b.message || '').trim();
  if (name.length < 2) errors.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
  if (subject.length < 3) errors.subject = 'Enter a subject.';
  if (message.length < 10) errors.message = 'Write a message of at least 10 characters.';
  if (!b.consent) errors.consent = 'You must agree to the Privacy Policy to send an inquiry.';
  if (Object.keys(errors).length) return render({ errors, values });
  if (!hit('contact:' + req.ip, 5, 3600000)) return res.status(429).send(layout(req, { title: 'Too many requests', noindex: true, body: pageHead('Too many requests', 'Please try again in an hour.') }));
  const cat = C.inquiryCategories.includes(b.category) ? b.category : 'Other';
  // Visitors may only add to /public_inbox (see database.rules.json); the CMS moves new messages into the Inquiries list.
  await db.push('public_inbox', { name, email, category: cat, subject, message, consent: 1 });
  render({ ok: true });
});

// ---------- Newsletter: sign up and unsubscribe ----------
// Visitors may only add to /public_subscribe and /public_unsub (see database.rules.json); the CMS moves them into the Subscribers list.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function newsletterForm(st = {}) {
  const ts = Date.now().toString(), v = k => esc(st.values?.[k] || '');
  return `<form class="paper contact-form" method="post" action="/newsletter/subscribe#newsletter-form" id="newsletter-form" novalidate>
<h3 style="font-size:1.5rem">Get the Meridian newsletter</h3>
<p class="muted" style="margin-top:0">Selected stories and company notices by email. Unsubscribe at any time with the link in every message.</p>
${st.ok ? '<div class="notice ok" role="status">Thank you. You are on the list. The next newsletter will be sent to this address.</div>' : ''}
${st.error ? `<div class="notice bad" role="alert">${esc(st.error)}</div>` : ''}
<input type="hidden" name="ts" value="${ts}">
<div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="field"><label for="n-name">Name (optional)</label><input id="n-name" name="name" type="text" maxlength="120" autocomplete="name" value="${v('name')}"></div>
<div class="field"><label for="n-email">Email</label><input id="n-email" name="email" type="email" required maxlength="200" autocomplete="email" value="${v('email')}">${st.errors?.email ? `<div class="err">${st.errors.email}</div>` : ''}</div>
<div class="field"><label style="font-weight:500;display:flex;gap:.6rem;align-items:flex-start"><input type="checkbox" name="consent" value="1" required style="margin-top:.3rem"${st.values?.consent ? ' checked' : ''}> <span>I have read the <a href="/privacy">Privacy Policy</a> and agree that MMG may email me its newsletter.</span></label>${st.errors?.consent ? `<div class="err">${st.errors.consent}</div>` : ''}</div>
<button class="btn" type="submit">Subscribe</button></form>`;
}
const newsletterPage = (req, st, status = 200) => ({ status, html: layout(req, { title: 'Newsletter', desc: 'Subscribe to the Meridian Media Group newsletter.', noindex: status !== 200 || !!st.ok, body: pageHead('Newsletter', 'Selected stories and company notices, by email.', [[null, 'Newsletter']]) + `<section><div class="wrap" style="max-width:640px">${newsletterForm(st)}</div></section>` }) });
r.get('/newsletter', (req, res) => res.send(newsletterPage(req, {}).html));
r.post('/newsletter/subscribe', async (req, res) => {
  const b = req.body || {}, errors = {}, values = { name: b.name, email: b.email, consent: b.consent };
  const out = (st, code = 200) => { const p = newsletterPage(req, st, code); res.status(p.status).send(p.html); };
  const age = Date.now() - Number(b.ts);
  if (b.website) return out({ ok: true });
  if (!b.ts || !(age >= 0) || age > 7200000) return out({ error: 'This form expired. Reload the page and try again.', values }, 400);
  if (age < 2000) return out({ error: 'That was very quick. Please check your details and try again.', values }, 400);
  const email = String(b.email || '').trim(), name = String(b.name || '').trim().slice(0, 120);
  if (!EMAIL_RE.test(email) || email.length > 200) errors.email = 'Enter a valid email address.';
  if (!b.consent) errors.consent = 'You must agree to the Privacy Policy to subscribe.';
  if (Object.keys(errors).length) return out({ errors, values }, 400);
  if (!hit('newsletter:' + req.ip, 5, 3600000)) return res.status(429).send(layout(req, { title: 'Too many requests', noindex: true, body: pageHead('Too many requests', 'Please try again in an hour.') }));
  await db.push('public_subscribe', { email, name, consent: 1 });
  out({ ok: true });
});
const unsubPage = (req, inner, status = 200) => res => res.status(status).send(layout(req, { title: 'Unsubscribe', noindex: true, body: pageHead('Unsubscribe', 'Newsletter', [[null, 'Unsubscribe']]) + `<section><div class="wrap" style="max-width:640px"><div class="paper contact-form">${inner}</div></div></section>` }));
r.get('/newsletter/unsubscribe', (req, res) => {
  const e = String(req.query.e || ''), t = String(req.query.t || '');
  if (!EMAIL_RE.test(e) || t.length < 6 || t.length > 40) return unsubPage(req, '<p>This unsubscribe link is not valid. Use the link in the newsletter email, or <a href="/contact">contact us</a>.</p>', 400)(res);
  unsubPage(req, `<h3 style="font-size:1.4rem;margin-top:0">Unsubscribe from the newsletter?</h3><p>${esc(e)} will no longer receive the Meridian newsletter.</p><form method="post" action="/newsletter/unsubscribe"><input type="hidden" name="e" value="${esc(e)}"><input type="hidden" name="t" value="${esc(t)}"><button class="btn" type="submit">Yes, unsubscribe me</button> <a class="btn paper-btn" href="/">Keep me subscribed</a></form>`)(res);
});
r.post('/newsletter/unsubscribe', async (req, res) => {
  const e = String(req.body?.e || ''), t = String(req.body?.t || '');
  if (!EMAIL_RE.test(e) || t.length < 6 || t.length > 40) return unsubPage(req, '<p>This unsubscribe link is not valid. <a href="/contact">Contact us</a> and we will remove you.</p>', 400)(res);
  if (!hit('unsub:' + req.ip, 10, 3600000)) return unsubPage(req, '<p>Too many requests. Please try again in an hour.</p>', 429)(res);
  await db.push('public_unsub', { email: e, token: t });
  unsubPage(req, `<h3 style="font-size:1.4rem;margin-top:0">Request received</h3><p>${esc(e)} will be removed from the newsletter list before the next issue is sent. You will not need to do anything else.</p><p><a href="/">Back to the homepage</a></p>`)(res);
});

// ---------- Corporate pages ----------
const simple = (path, title, sub, content) => r.get(path, (req, res) => res.send(layout(req, { title, desc: sub, body: pageHead(title, sub, [[null, title]]) + content })));
simple('/about', 'About Us', `The story, mission and values of ${C.name}.`, `<section><div class="wrap two"><div><h2 class="sec">A Philippine media corporation</h2><p class="lede">${esc(C.name)} was founded in ${C.founded} and is headquartered in ${esc(C.hq)}.</p><p>${esc(C.mission)}</p></div><div class="paper factsheet"><h3>Vision</h3><p class="lede" style="margin:0">${esc(C.vision)}</p></div></div></section><section class="contours ink" style="background:rgba(230,222,200,.35)"><div class="wrap"><h2 class="sec">Our story</h2>${timeline()}</div></section><section><div class="wrap"><h2 class="sec">Core values</h2><div class="values">${C.values.map(v => `<div class="value">${esc(v)}</div>`).join('')}</div></div></section>`);
simple('/profile', 'Corporate Profile', 'Key facts about Meridian Media Group, Inc.', `<section><div class="wrap"><div class="paper factsheet" style="max-width:760px"><dl><dt>Corporate name</dt><dd>${esc(C.name)}</dd><dt>Abbreviation</dt><dd>${C.abbr}</dd><dt>Founded</dt><dd>${C.founded}</dd><dt>Headquarters</dt><dd>${esc(C.hq)}</dd><dt>Industry</dt><dd>${esc(C.industry)}</dd><dt>Ownership</dt><dd>${esc(C.ownership)}</dd><dt>Chief Executive Officer</dt><dd>${esc(C.ceo)}</dd><dt>Slogan</dt><dd><i>${esc(C.slogan)}</i></dd></dl></div><p class="help">All company information on this site is fictional project content.</p></div></section>`);
r.get('/leadership', (req, res) => {
  const list = staffList(false), depts = ST.departments(), view = req.query.view === 'departments' ? 'departments' : 'reporting';
  res.send(layout(req, { title: 'Leadership', desc: 'The people who guide MMG.', body: pageHead('Leadership', 'The people who guide MMG.', [[null, 'Leadership']]) + `<section><div class="wrap">${SV.departmentGroups(list, depts)}</div></section>` + SV.orgSection({ tree: ST.orgTree(), list, depts, view }) }));
});
r.get('/leadership/:slug', (req, res, next) => {
  const m = db.find('staff', x => x.slug === req.params.slug && x.visible === 1); if (!m) return next();
  const tree = ST.orgTree(), n = tree.nodes.get(m.id);
  const dept = m.department_id ? db.get('departments', m.department_id) : null;
  const author = m.author_id ? db.get('authors', m.author_id) : null;
  const articles = author ? Q.search({ author: author.slug, limit: 3 }).rows : [];
  const sameAs = ST.socialOf(m).map(x => x.href).filter(h => !h.startsWith('mailto:'));
  res.send(layout(req, { title: m.name, nav: '/leadership', image: m.image || undefined, desc: `${m.name}${m.title ? ', ' + m.title : ''} at ${C.name}. ${m.bio || ''}`.trim(),
    body: pageHead(m.name, [m.title, m.department].filter(Boolean).join(' · '), [['/leadership', 'Leadership'], [null, m.name]]) + SV.profileBody(m, { dept, manager: n?.parent || null, reports: (n?.kids || []).map(k => k.m), articles, authorSlug: author?.slug }),
    jsonld: { '@context': 'https://schema.org', '@type': 'Person', name: m.name, jobTitle: m.title || undefined, url: BASE_URL() + '/leadership/' + m.slug, image: m.image ? imgUrl(m.image, 1200) : undefined, worksFor: { '@type': 'Organization', name: C.name }, sameAs: sameAs.length ? sameAs : undefined } }));
});
simple('/privacy', 'Privacy Policy', 'How MMG handles personal data.', `<section><div class="wrap prose" style="max-width:780px"><div class="notice info">Draft for a fictional project. Have counsel review before real-world use.</div><h2>What we collect</h2><p>If you use the contact form we store your name, email address, inquiry category, subject and message, plus your consent, so that we can respond. We do not collect other personal data from readers.</p><h2>Cookies and analytics</h2><p>The public website sets no cookies. Article view counts are aggregate page-load totals with no personal identifiers. Staff sign-in uses one strictly necessary session cookie.</p><h2>Your rights</h2><p>Under the Data Privacy Act of 2012 (Philippines) you may ask to access, correct or delete your personal data. Use the contact form and choose “Privacy request”.</p><h2>Retention</h2><p>Inquiries are kept only as long as needed to handle them and are then archived or deleted.</p></div></section>`);
simple('/terms', 'Terms of Use', 'Rules for using this website.', `<section><div class="wrap prose" style="max-width:780px"><div class="notice info">Draft for a fictional project. Have counsel review before real-world use.</div><h2>Use of content</h2><p>Content on this site is provided for information. Sample content is fictional and is labeled as such. Do not reproduce it without permission.</p><h2>Accuracy</h2><p>We aim to keep content accurate and correct errors promptly. Report a problem through the contact form.</p><h2>Links</h2><p>We are not responsible for the content of external sites.</p></div></section>`);

// ---------- News & announcements ----------
r.get('/news', (req, res) => {
  const a = Q.search({ announcement: true, limit: 20, page: req.query.page }), l = Q.search({ limit: 3 }).rows;
  res.send(layout(req, { title: 'News & Announcements', desc: 'Official announcements and the latest news from MMG.', body: pageHead('News & Announcements', 'Official notices from the corporation and the latest from our newsroom.', [[null, 'News & Announcements']]) + `<section><div class="wrap"><h2 class="sec">Corporate announcements</h2>${announcements(a.rows)}${pager(a.page, a.pages, o => new URLSearchParams({ ...req.query, ...o }))}</div></section><section class="felt contours"><div class="wrap"><div class="sec-head"><h2 class="sec" style="color:#fff;margin:0">Latest from the newsroom</h2><a class="btn paper-btn" href="/articles">Article archive</a></div>${l.length ? `<div class="cards">${l.map(card).join('')}</div>` : '<div class="paper empty"><p>No articles yet.</p></div>'}</div></section>` }));
});

// ---------- Article archive, categories, tags, authors ----------
const qs = (req, extra) => o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...req.query, ...extra, ...o })) if (v) p.set(k, v); return p.toString(); };
function archive(req, res, { cat, tag, author, title, sub, crumbs, path, extra }) {
  const o = { q: String(req.query.q || '').trim().slice(0, 100), cat: cat?.slug || req.query.category, tag: tag?.slug || req.query.tag, author: author?.slug, from: req.query.from, to: req.query.to, sort: req.query.sort, page: req.query.page, limit: 9 };
  const res1 = Q.search(o), cats = Q.categories();
  const hasFilter = o.q || req.query.category || req.query.from || req.query.to || req.query.tag;
  if (o.q && (+req.query.page || 1) === 1) db.push('search_log', { q: o.q.toLowerCase(), results: res1.total }).catch(e => console.error('search log failed:', e.message));
  const feat = !hasFilter && !cat && !tag && !author && res1.page === 1 ? Q.featured() : null;
  const rows = feat ? res1.rows.filter(x => x.id !== feat.id) : res1.rows;
  const f = (n, l, t) => `<div class="field" style="margin:0"><label for="${n}">${l}</label>${t}</div>`;
  const sel = (n, opts, cur) => `<select id="${n}" name="${n}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(cur || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const body = pageHead(title, sub, crumbs) + (extra || '') + `<div class="wrap"><form class="paper filters" method="get" action="${path}" role="search"><div class="field" style="margin:0"><label for="q">Search headlines and content</label><input id="q" type="search" name="q" value="${esc(o.q)}" placeholder="Search articles"></div>
${cat ? '' : f('category', 'Category', sel('category', [['', 'All categories'], ...cats.map(c => [c.slug, c.name])], req.query.category))}${f('from', 'From', `<input id="from" type="date" name="from" value="${esc(o.from || '')}">`)}${f('to', 'To', `<input id="to" type="date" name="to" value="${esc(o.to || '')}">`)}
${f('sort', 'Sort', sel('sort', [['', 'Newest first'], ['oldest', 'Oldest first'], ['popular', 'Most read']], o.sort))}<button class="btn" type="submit">Search</button></form>
<div class="cat-tabs" aria-label="Categories"><a href="/articles"${!cat && !tag ? ' aria-current="page"' : ''}>All</a>${cats.map(c => `<a href="/articles/${c.slug}"${cat?.slug === c.slug ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`).join('')}</div>
<div class="archive"><div>${feat ? `<article class="paper feature-story">${V.cover(feat, 'cover fill')}<div class="in"><a class="cat" href="/articles/${feat.cat_slug}">${esc(feat.category || '')}</a> ${V.sampleBadge(feat)}<h2><a href="${artUrl(feat)}">${esc(feat.title)}</a></h2><p class="lede">${esc(feat.excerpt || '')}</p><div class="meta"><span>${esc(feat.author || 'MMG Staff')}</span><span>${fmtDate(feat.published_at)}</span><span>${rt(feat)} min read</span></div></div></article>` : ''}
${o.q ? `<p role="status"><b>${res1.total}</b> result${res1.total === 1 ? '' : 's'} for “${esc(o.q)}”</p>` : ''}
${rows.length || feat ? `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${rows.map(card).join('')}</div>${pager(res1.page, res1.pages, qs(req))}` : `<div class="paper empty"><h2 style="font-size:1.5rem">No articles found</h2><p>${hasFilter ? 'Try different words, a wider date range or another category.' : 'Nothing has been published here yet.'}</p>${hasFilter ? `<a class="btn paper-btn" href="${path}">Clear filters</a>` : ''}</div>`}</div>
<aside class="side" aria-label="Sidebar"><div class="paper-flat"><h3>Most read</h3><ol>${Q.popular(5).map(a => `<li><a href="${artUrl(a)}">${esc(a.title)}</a></li>`).join('') || '<li>No articles yet</li>'}</ol></div><div class="paper-flat"><h3>Browse by tag</h3><div class="tagcloud">${Q.topTags().map(t => `<a href="/tags/${t.slug}">${esc(t.name)}</a>`).join('') || '<span class="help">No tags yet</span>'}</div></div></aside></div></div><div style="height:3rem"></div>`;
  res.send(layout(req, { title: title + (res1.page > 1 ? ` — page ${res1.page}` : ''), desc: sub, canonical: path, nav: '/articles', body, noindex: !!(o.q || o.from || o.to || req.query.sort), jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url: BASE_URL() + path } }));
}
r.get('/articles', (req, res) => archive(req, res, { title: 'Article Archive', sub: 'Reporting, analysis and corporate news from Meridian Media Group.', crumbs: [[null, 'Articles']], path: '/articles' }));
r.get('/tags/:slug', (req, res, next) => { const t = db.find('tags', x => x.slug === req.params.slug); if (!t) return next(); archive(req, res, { tag: t, title: `Tagged “${t.name}”`, sub: `Articles tagged ${t.name}.`, crumbs: [['/articles', 'Articles'], [null, t.name]], path: '/tags/' + t.slug }); });
r.get('/authors/:slug', (req, res, next) => { const a = db.find('authors', x => x.slug === req.params.slug); if (!a) return next(); const st = db.find('staff', x => x.author_id === a.id && x.visible === 1 && x.slug); archive(req, res, { extra: st ? `<div class="wrap"><p class="byline-profile"><a class="btn paper-btn small" href="/leadership/${esc(st.slug)}">View leadership profile</a></p></div>` : '', author: a, title: a.name, sub: [a.title, a.bio].filter(Boolean).join(' · ') || 'Articles by this author.', crumbs: [['/articles', 'Articles'], [null, a.name]], path: '/authors/' + a.slug }); });
r.get('/articles/:cat', (req, res, next) => { const c = db.find('categories', x => x.slug === req.params.cat && x.active === 1); if (!c) return next(); archive(req, res, { cat: c, title: c.name, sub: c.description || `Articles in ${c.name}.`, crumbs: [['/articles', 'Articles'], [null, c.name]], path: '/articles/' + c.slug }); });

// ---------- Article page ----------
const staffOfAuthor = a => { const au = a.author_slug ? db.find('authors', x => x.slug === a.author_slug) : null; return au ? db.find('staff', s => s.visible === 1 && s.slug && s.author_id === au.id) : null; };
function articleBody(req, a, preview) {
  const tags = Q.tagsFor(a.id), { prev, next } = preview ? {} : Q.neighbors(a), rel = Q.related(a), url = BASE_URL() + artUrl(a);
  const share = [['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`], ['X', `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(a.title)}`], ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`], ['Email', `mailto:?subject=${encodeURIComponent(a.title)}&body=${encodeURIComponent(url)}`]];
  return `<div class="felt deep contours article-top"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/articles">Articles</a> / <a href="/articles/${a.cat_slug}">${esc(a.category || 'Uncategorized')}</a></nav>
<a class="cat" style="color:#9cc3ea" href="/articles/${a.cat_slug}">${esc(a.category || '')}</a><h1>${esc(a.title)}</h1>${a.subtitle ? `<p class="sub">${esc(a.subtitle)}</p>` : ''}
<div class="meta"><span>By <a style="color:#dfe7f2" href="/authors/${a.author_slug}">${esc(a.author || 'MMG Staff')}</a></span><span>${a.published_at ? `<time datetime="${a.published_at.replace(' ', 'T')}Z">${fmtDate(a.published_at)}</time>` : 'Unpublished'}</span>${a.updated_at && a.published_at && a.updated_at.slice(0, 10) > a.published_at.slice(0, 10) ? `<span>Updated ${fmtDate(a.updated_at)}</span>` : ''}<span>${rt(a)} min read</span></div></div></div>
<div class="wrap article-body-wrap"><article class="paper article-sheet">${a.is_sample ? '<div class="sample-banner">Sample article. This is fictional demonstration content, not real reporting or an official announcement.</div>' : ''}
<div class="art-tools"><button class="btn small" type="button" id="dl-article" data-title="${esc(a.title)}">Download article (PDF)</button><span class="help">Opens your print dialog. Choose “Save as PDF”.</span></div>
<figure class="hero-img">${V.cover(a, 'hero')}${a.image && (a.image_caption || a.image_credit) ? `<figcaption>${esc(a.image_caption)}${a.image_credit ? ` <span>Credit: ${esc(a.image_credit)}</span>` : ''}</figcaption>` : ''}</figure>
<div class="prose">${shiftHeadings(a.body)}</div>
<p class="print-only">Source: ${esc(url)} · ${esc(C.name)}</p>
${tags.length ? `<div class="tagcloud" style="margin-top:1.6rem"><b class="sr">Tags</b>${tags.map(t => `<a href="/tags/${t.slug}">${esc(t.name)}</a>`).join('')}</div>` : ''}
<div class="share"><b style="font:700 .85rem var(--f-label)">Share</b>${share.map(([n, h]) => `<a class="btn paper-btn small" href="${h}" target="_blank" rel="noopener noreferrer">${n}</a>`).join('')}<button class="btn paper-btn small" type="button" id="copy-link" data-url="${esc(url)}">Copy link</button><span id="copied" class="help" role="status"></span></div>
<div class="paper-flat author-box"><span class="avatar" aria-hidden="true">${initials(a.author)}</span><div><b>${esc(a.author || 'MMG Staff')}</b>${a.author_title ? `<div class="help">${esc(a.author_title)}</div>` : ''}${a.author_bio ? `<p style="margin:.3rem 0 0">${esc(a.author_bio)}</p>` : ''}${staffOfAuthor(a) ? `<p style="margin:.5rem 0 0"><a href="/leadership/${esc(staffOfAuthor(a).slug)}">View leadership profile →</a></p>` : ''}</div></div></article></div>
${preview ? '' : `<div class="wrap"><div class="prevnext">${prev ? `<a class="paper-flat" href="${artUrl(prev)}"><small>Previous article</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="paper-flat" href="${artUrl(next)}"><small>Next article</small>${esc(next.title)}</a>` : '<span></span>'}</div>
${rel.length ? `<h2 class="sec" style="font-size:1.8rem">Related articles</h2><div class="cards" style="margin-bottom:3rem">${rel.map(card).join('')}</div>` : ''}</div>`}`;
}
r.get('/articles/:cat/:slug', async (req, res, next) => {
  const a = Q.bySlug(req.params.cat, req.params.slug);
  if (!a) return next();
  a.body = cleanBody(await db.bodyOf(a.id));
  if (!/bot|crawl|spider|preview/i.test(req.headers['user-agent'] || '')) Q.countView(a.id);
  const url = BASE_URL() + artUrl(a);
  res.send(layout(req, { title: a.seo_title || a.title, desc: a.seo_description || a.excerpt || plain(a, 160), image: a.image, ogType: 'article', nav: '/articles', body: articleBody(req, a),
    jsonld: { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: a.title, description: a.excerpt || undefined, datePublished: a.published_at.replace(' ', 'T') + 'Z', dateModified: a.updated_at.replace(' ', 'T') + 'Z', author: { '@type': 'Person', name: a.author || 'MMG Staff' }, publisher: { '@type': 'Organization', name: C.name, logo: { '@type': 'ImageObject', url: BASE_URL() + '/img/logo-full.png' } }, mainEntityOfPage: url, image: a.image ? imgUrl(a.image, 1200) : undefined, articleSection: a.category } }));
});

// ---------- Careers ----------
r.get('/careers', (req, res) => {
  const jobs = openJobs();
  res.send(layout(req, { title: 'Careers', desc: 'Open positions at Meridian Media Group, Inc.', body: pageHead('Careers', 'Join a team committed to accuracy, craft and public service.', [[null, 'Careers']]) + `<section><div class="wrap"><div class="two"><div><h2 class="sec">Why Meridian</h2><p class="lede">${esc(C.mission)}</p></div><div class="paper factsheet"><h3>How to apply</h3><p style="margin:0">Each listing explains how to apply. Please follow the instructions in the position you are interested in.</p></div></div><h2 class="sec" style="margin-top:3rem">Open positions</h2><div style="display:grid;gap:1rem">${jobs.length ? jobs.map(jobRow).join('') : '<div class="paper empty"><h3>No open positions</h3><p>We have no openings right now. Check back soon.</p></div>'}</div></div></section>` }));
});
r.get('/careers/:slug', (req, res, next) => {
  const j = openJobs().find(x => x.slug === req.params.slug);
  if (!j) return next();
  const sec = (h, t) => t ? `<h2 style="font-size:1.5rem;margin-top:1.8rem">${h}</h2><p style="white-space:pre-line">${esc(t)}</p>` : '';
  res.send(layout(req, { title: j.title, nav: '/careers', desc: `${j.title} at Meridian Media Group, Inc.`, body: pageHead(j.title, [j.department, j.employment_type, j.location].filter(Boolean).join(' · '), [['/careers', 'Careers'], [null, j.title]]) + `<section><div class="wrap" style="max-width:820px"><div class="paper article-sheet prose">${j.is_sample ? '<div class="sample-banner">Sample listing for demonstration. This is not a real job opening.</div>' : ''}${sec('Description', j.description)}${sec('Responsibilities', j.responsibilities)}${sec('Qualifications', j.qualifications)}${sec('How to apply', j.how_to_apply)}${j.deadline ? `<p><b>Application deadline:</b> ${fmtDate(j.deadline)}</p>` : ''}</div></div></section>`, jsonld: { '@context': 'https://schema.org', '@type': 'JobPosting', title: j.title, description: j.description, employmentType: j.employment_type, hiringOrganization: { '@type': 'Organization', name: C.name }, validThrough: j.deadline || undefined } }));
});

// ---------- SEO ----------
r.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nAllow: /\nSitemap: ${BASE_URL()}/sitemap.xml\n`));
r.get('/sitemap.xml', (req, res) => {
  const u = [['/', null], ...['/about', '/profile', '/leadership', '/news', '/articles', '/careers', '/contact', '/privacy', '/terms'].map(p => [p, null])];
  Q.categories().forEach(c => u.push(['/articles/' + c.slug, null]));
  Q.search({ limit: 5000 }).rows.forEach(a => u.push([artUrl(a), a.updated_at]));
  db.all('tags').forEach(t => u.push(['/tags/' + t.slug, null]));
  db.where('staff', m => m.visible === 1 && m.slug).forEach(m => u.push(['/leadership/' + m.slug, null]));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u.map(([p, m]) => `<url><loc>${esc(BASE_URL() + p)}</loc>${m ? `<lastmod>${m.slice(0, 10)}</lastmod>` : ''}</url>`).join('')}</urlset>`);
});
r.articleBody = articleBody;
module.exports = r;
