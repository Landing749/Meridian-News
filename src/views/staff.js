// Public rendering for staff & leadership: cards, department groups, the org chart and profile pages.
const C = require('../content');
const { esc } = require('../util');
const { initials, card } = require('./public');
const { socialOf } = require('../staff');

const profileUrl = m => (m.slug ? '/leadership/' + m.slug : null);
const photo = m => `<div class="s-photo">${m.image ? `<img src="${esc(require('../cloud').deliver(m.image, 600))}" alt="${esc(m.name)}" loading="lazy">` : `<span class="s-init" aria-hidden="true">${esc(initials(m.name))}</span>`}</div>`;
const social = m => { const l = socialOf(m); return l.length ? `<ul class="s-social" aria-label="${esc(m.name)}: links">${l.map(s => `<li><a href="${esc(s.href)}"${s.href.startsWith('mailto:') ? '' : ' target="_blank" rel="me noopener noreferrer"'} aria-label="${esc(m.name)} on ${esc(s.label)}">${esc(s.label)}</a></li>`).join('')}</ul>` : ''; };
const deptLabel = m => (m.department ? ` · ${esc(m.department)}` : '');

const staffCard = (m, lead) => `<article class="paper staff${lead ? ' staff-lead' : ''}">${photo(m)}<div class="s-body"><h3>${profileUrl(m) ? `<a href="${profileUrl(m)}">${esc(m.name)}</a>` : esc(m.name)}</h3><p class="s-title">${esc(m.title)}${deptLabel(m)}</p>${m.motto ? `<blockquote class="s-motto">${esc(m.motto)}</blockquote>` : ''}${m.bio ? `<p class="s-bio">${esc(m.bio)}</p>` : ''}${m.since ? `<span class="s-since">With MMG since ${esc(m.since)}</span>` : ''}${social(m)}${profileUrl(m) ? `<a class="s-more" href="${profileUrl(m)}">View profile<span class="sr">: ${esc(m.name)}</span> →</a>` : ''}</div></article>`;
const staffGrid = list => list.length ? `<div class="staff-grid">${list.map((m, i) => staffCard(m, i === 0)).join('')}</div>` : '<div class="paper empty"><h3>Profiles coming soon</h3><p>Team members added in the CMS appear here.</p></div>';

// Leadership page body: the first person as the large card, then everyone grouped by department.
function departmentGroups(list, depts) {
  const lead = list[0], rest = list.slice(1);
  const groups = depts.map(d => ({ d, members: rest.filter(m => m.department_id === d.id) })).filter(g => g.members.length);
  const other = rest.filter(m => !depts.some(d => d.id === m.department_id));
  if (other.length) groups.push({ d: null, members: other });
  if (!lead) return staffGrid([]);
  const chips = groups.length > 1 ? `<nav class="dept-nav" aria-label="Departments">${groups.map(g => `<a href="#${g.d ? 'dept-' + esc(g.d.slug) : 'dept-other'}">${esc(g.d ? g.d.name : 'Other team members')}<small>${g.members.length}</small></a>`).join('')}</nav>` : '';
  return `<div class="staff-grid">${staffCard(lead, true)}</div>${chips}${groups.map(g => `<section class="dept-block" id="${g.d ? 'dept-' + esc(g.d.slug) : 'dept-other'}" aria-labelledby="h-${g.d ? esc(g.d.slug) : 'other'}"><h2 id="h-${g.d ? esc(g.d.slug) : 'other'}" class="sec" style="font-size:1.7rem">${esc(g.d ? g.d.name : 'Other team members')}</h2>${g.d && g.d.description ? `<p class="lede dept-desc">${esc(g.d.description)}</p>` : ''}<div class="staff-grid">${g.members.map(m => staffCard(m, false)).join('')}</div></section>`).join('')}`;
}

// ---------- Org chart ----------
const node = m => `<${profileUrl(m) ? 'a href="' + profileUrl(m) + '"' : 'div'} class="org-node"><span class="o-name">${esc(m.name)}</span><span class="o-title">${esc(m.title || '')}</span>${m.department ? `<span class="o-dept">${esc(m.department)}</span>` : ''}</${profileUrl(m) ? 'a' : 'div'}>`;
const branch = n => `<li>${node(n.m)}${n.kids.length ? `<ul>${n.kids.map(branch).join('')}</ul>` : ''}</li>`;
function reportingChart(tree) {
  const { roots } = tree;
  const inner = roots.length === 1 ? branch(roots[0]) : `<li><div class="org-node org-root"><span class="o-name">${esc(C.name)}</span></div><ul>${roots.map(branch).join('')}</ul></li>`;
  return `<div class="org-scroll" tabindex="0" role="region" aria-label="Organization chart: reporting lines"><ul class="org-tree">${inner}</ul></div>`;
}
function departmentChart(list, depts) {
  const groups = depts.map(d => ({ d, members: list.filter(m => m.department_id === d.id) })).filter(g => g.members.length);
  const other = list.filter(m => !depts.some(d => d.id === m.department_id));
  if (other.length) groups.push({ d: { name: 'Other team members' }, members: other });
  return `<div class="org-scroll" tabindex="0" role="region" aria-label="Organization chart: departments"><div class="org-company"><div class="org-node org-root"><span class="o-name">${esc(C.name)}</span></div></div><div class="org-depts">${groups.map(g => `<section class="paper org-dept"><h3>${esc(g.d.name)}</h3><ul>${g.members.map(m => `<li>${profileUrl(m) ? `<a href="${profileUrl(m)}">` : '<span>'}<b>${esc(m.name)}</b><small>${esc(m.title || '')}</small>${profileUrl(m) ? '</a>' : '</span>'}</li>`).join('')}</ul></section>`).join('')}</div></div>`;
}
function orgSection({ tree, list, depts, view }) {
  if (tree.count < 2) return '';
  const tab = (v, label, href) => `<a href="${href}"${view === v ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<section class="tinted" id="org-chart"><div class="wrap"><header class="sec-title"><div><span class="folio">How we are organized</span><h2>Organization chart</h2></div><nav class="seg" aria-label="Chart view">${tab('reporting', 'Reporting lines', '/leadership#org-chart')}${tab('departments', 'By department', '/leadership?view=departments#org-chart')}</nav></header>${view === 'departments' ? departmentChart(list, depts) : reportingChart(tree)}</div></section>`;
}

// ---------- Profile page ----------
const paras = t => String(t || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(s => `<p>${esc(s).replace(/\n/g, '<br>')}</p>`).join('');
function profileBody(m, { dept, manager, reports, articles, authorSlug }) {
  const person = x => `<li><a href="${profileUrl(x)}"><b>${esc(x.name)}</b><small>${esc(x.title || '')}</small></a></li>`;
  const lines = [manager && profileUrl(manager) ? `<div><h3>Reports to</h3><ul class="people">${person(manager)}</ul></div>` : '', reports.length ? `<div><h3>Direct reports</h3><ul class="people">${reports.filter(profileUrl).map(person).join('')}</ul></div>` : ''].join('');
  return `<section><div class="wrap profile-grid"><aside class="paper staff profile-card">${photo(m)}<div class="s-body">${social(m) || '<p class="help" style="margin:0">No public links listed.</p>'}${m.since ? `<span class="s-since" style="display:block;margin-top:.8rem">With MMG since ${esc(m.since)}</span>` : ''}</div></aside>
<div class="profile-main"><p class="s-title" style="font-size:.85rem">${esc(m.title)}${dept ? ` · <a href="/leadership#dept-${esc(dept.slug)}">${esc(dept.name)}</a>` : ''}</p>${m.motto ? `<blockquote class="s-motto" style="font-size:1.35rem">${esc(m.motto)}</blockquote>` : ''}<div class="prose">${paras(m.bio) || '<p class="help">A biography will be added once verified information is supplied.</p>'}</div>${lines ? `<div class="paper-flat profile-lines">${lines}</div>` : ''}<p><a class="btn paper-btn small" href="/leadership">← All leadership</a></p></div></div></section>
${articles.length ? `<section class="tinted"><div class="wrap"><header class="sec-title"><div><span class="folio">Bylines</span><h2>Articles by ${esc(m.name)}</h2></div><a class="btn paper-btn small" href="/authors/${esc(authorSlug)}">All articles</a></header><div class="cards">${articles.map(card).join('')}</div></div></section>` : ''}`;
}

module.exports = { profileUrl, staffCard, staffGrid, departmentGroups, orgSection, reportingChart, profileBody };
