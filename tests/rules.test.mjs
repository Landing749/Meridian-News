import assert from 'node:assert/strict';
import { rules } from '../scripts/gen-rules.mjs';
import { createDb } from './rules-engine.mjs';

const roles = {
  sa: { role: 'super_admin', active: 1, user_id: 1, key: '1' }, adm: { role: 'administrator', active: 1, user_id: 2, key: '2' },
  mgr: { role: 'managing_editor', active: 1, user_id: 3, key: '3' }, ed: { role: 'editor', active: 1, user_id: 4, key: '4' },
  wr: { role: 'writer', active: 1, user_id: 5, key: '5' }, co: { role: 'contributor', active: 1, user_id: 6, key: '6' },
  off: { role: 'administrator', active: 0, user_id: 7, key: '7' },
};
const fixture = () => ({
  roles,
  users: { 1: { name: 'Sa', role: 'super_admin' }, 2: { name: 'Adm', role: 'administrator' }, 6: { name: 'Co', role: 'contributor' } },
  articles: {
    1: { title: 'Mine', status: 'draft', created_by: 6, assigned_to: null, body: 'b1', subtitle: '', excerpt: '' },
    2: { title: 'Review me', status: 'pending_review', created_by: 5, assigned_to: 4, body: 'b2', subtitle: '', excerpt: '' },
    3: { title: 'Live', status: 'published', created_by: 3, assigned_to: null, body: 'b3', subtitle: '', excerpt: '' },
    4: { title: 'Other draft', status: 'draft', created_by: 5, assigned_to: null, body: 'b4', subtitle: '', excerpt: '' },
  },
  public: { articles: { 3: { title: 'Live' } }, views: { 3: 3 } },
  inquiries: { 1: { name: 'x' } }, audit_log: { a: { action: 'x' } },
});
const A = uid => (uid ? { uid } : null);
let n = 0;
const t = (name, fn) => { fn(); n++; };
const ok = (db, auth, u, why) => assert.equal(db.tryWrite(auth, u).ok, true, why || JSON.stringify(u));
const no = (db, auth, u, why) => assert.equal(db.tryWrite(auth, u).ok, false, why || ('should be denied: ' + JSON.stringify(u)));

t('visitors', () => {
  const db = createDb(rules, fixture());
  assert.ok(db.canRead(null, 'public/articles'), 'public read');
  for (const p of ['articles', 'users', 'roles', 'roles/mgr', 'inquiries', 'audit_log', 'public_inbox', 'settings', 'search_log']) assert.ok(!db.canRead(null, p), 'visitor read /' + p);
  no(db, null, { 'public/articles/9': { title: 'fake' } }); no(db, null, { 'articles/9': { title: 'x', status: 'draft', created_by: 1 } });
  ok(db, null, { 'public/views/3': 4 }); no(db, null, { 'public/views/3': 10 }); no(db, null, { 'public/views/3': 3 }); ok(db, null, { 'public/views/77': 1 }); no(db, null, { 'public/views/78': 5 });
  ok(db, null, { 'public/views_daily/3/2026-11-14': 1 }); no(db, null, { 'public/views_daily/3/yesterday': 1 });
  ok(db, null, { 'public_inbox/-N1': { name: 'Ana', email: 'ana@example.com', subject: 'Hello', message: 'A real message here', consent: 1, category: 'Other', created_at: '2026-11-14 10:00:00' } });
  no(db, null, { 'public_inbox/-N2': { name: 'Ana', email: 'nope', subject: 'Hello', message: 'A real message here', consent: 1 } }, 'bad email');
  no(db, null, { 'public_inbox/-N3': { name: 'Ana', email: 'ana@example.com', subject: 'Hello', message: 'short', consent: 1 } }, 'short message');
  no(db, null, { 'public_inbox/-N4': { name: 'Ana', email: 'ana@example.com', subject: 'Hello', message: 'A real message here', consent: 1, evil: 'x' } }, 'extra field');
  no(db, null, { 'public_inbox/-N1': { name: 'overwrite' } }, 'cannot overwrite');
  for (const pth of ['subscribers', 'newsletters', 'public_subscribe', 'public_unsub']) assert.ok(!db.canRead(null, pth), 'visitor read /' + pth);
  ok(db, null, { 'public_subscribe/-S1': { email: 'rita@example.com', name: 'Rita', consent: 1, created_at: '2026-11-15 10:00:00' } });
  no(db, null, { 'public_subscribe/-S2': { email: 'bad', consent: 1 } }, 'bad email');
  no(db, null, { 'public_subscribe/-S3': { email: 'rita@example.com', consent: 0 } }, 'consent must be 1');
  no(db, null, { 'public_subscribe/-S4': { email: 'rita@example.com', consent: 1, role: 'x' } }, 'extra field');
  no(db, null, { 'public_subscribe/-S1': { email: 'other@example.com', consent: 1 } }, 'cannot overwrite');
  ok(db, null, { 'public_unsub/-U1': { email: 'rita@example.com', token: 'abcdef123456', created_at: '2026-11-15 10:00:00' } });
  no(db, null, { 'public_unsub/-U2': { email: 'rita@example.com', token: 'x' } }, 'token too short');
  no(db, null, { 'subscribers/1': { email: 'a@b.co', status: 'active' } }, 'visitors cannot write subscribers');
  no(db, null, { 'newsletters/1': { subject: 'x' } }, 'visitors cannot write newsletters');
  ok(db, null, { 'search_log/-S1': { q: 'news', results: 3, created_at: '2026-11-14 10:00:00' } }); no(db, null, { 'search_log/-S2': { q: 'x'.repeat(300), results: 3, created_at: 'now' } });
  no(db, null, { 'roles/xyz': { role: 'super_admin', active: 1, user_id: 99, key: '99' } }, 'self-grant');
});
t('accounts with no role, or deactivated', () => {
  const db = createDb(rules, fixture());
  for (const uid of ['stranger', 'off']) {
    assert.ok(!db.canRead(A(uid), 'articles'), uid + ' read articles');
    no(db, A(uid), { 'articles/50': { title: 't', status: 'draft', created_by: 7 } }); no(db, A(uid), { 'categories/1': { name: 'x' } }); no(db, A(uid), { 'users/9': { name: 'x', role: 'writer' } });
  }
  assert.ok(db.canRead(A('stranger'), 'public/articles'));
  no(db, A('stranger'), { 'roles/stranger': { role: 'administrator', active: 1, user_id: 8, key: '8' } }, 'cannot grant self a role');
});
t('contributor', () => {
  const db = createDb(rules, fixture()), co = A('co');
  assert.ok(db.canRead(co, 'articles')); assert.ok(!db.canRead(co, 'inquiries')); assert.ok(!db.canRead(co, 'audit_log')); assert.ok(!db.canRead(co, 'roles/adm')); assert.ok(db.canRead(co, 'roles/co'));
  ok(db, co, { 'articles/10': { title: '', status: 'draft', created_by: 6, assigned_to: null, body: '' } });
  no(db, co, { 'articles/11': { title: 'x', status: 'published', created_by: 6 } }, 'cannot create published');
  no(db, co, { 'articles/12': { title: 'x', status: 'draft', created_by: 5 } }, 'cannot create as someone else');
  ok(db, co, { 'articles/1/title': 'Edited' }); ok(db, co, { 'articles/1/status': 'pending_review' });
  no(db, co, { 'articles/1/status': 'published' }, 'cannot publish'); no(db, co, { 'articles/1/status': 'approved' });
  no(db, co, { 'articles/4/title': 'hijack' }, 'cannot edit others'); no(db, co, { 'articles/3/title': 'hijack live' });
  no(db, co, { 'articles/1': null }, 'cannot delete'); no(db, co, { 'articles/1/created_by': 5 }, 'cannot hand off authorship');
  no(db, co, { 'media/1': { url: 'https://x' } }, 'contributors cannot upload'); no(db, co, { 'categories/1': { name: 'x' } }); no(db, co, { 'public/articles/3/title': 'x' });
  ok(db, co, { 'audit_log/-A1': { action: 'x' } }); no(db, co, { 'audit_log/a': { action: 'tamper' } }, 'audit append-only');
});
t('writer', () => {
  const db = createDb(rules, fixture()), wr = A('wr');
  ok(db, wr, { 'media/1': { filename: 'f', url: 'https://x/y.jpg' } }); no(db, wr, { 'media/1/alt': 'changed' }, 'cannot edit media');
  ok(db, wr, { 'articles/4/status': 'pending_review' }); no(db, wr, { 'tags/1': { name: 'x', slug: 'x' } });
});
t('editor', () => {
  const db = createDb(rules, fixture()), ed = A('ed');
  ok(db, ed, { 'articles/2/body': 'edited by assigned editor' }); no(db, ed, { 'articles/2/status': 'approved' }, 'editor cannot approve'); no(db, ed, { 'articles/2/status': 'published' });
  no(db, ed, { 'articles/4/body': 'not assigned' }, 'unassigned edit'); ok(db, ed, { 'articles/2/status': 'draft' }, 'request revisions');
  ok(db, ed, { 'tags/1': { name: 'x', slug: 'x' } }); no(db, ed, { 'categories/1': { name: 'x' } }); no(db, ed, { 'articles/2/assigned_to': 4 === 4 ? 5 : 4 }, 'cannot reassign');
});
t('editor can send back an unassigned piece but not change its text', () => {
  const f = fixture(); f.articles[2].assigned_to = null; const db = createDb(rules, f), ed = A('ed');
  no(db, ed, { 'articles/2/body': 'rewrite' }); ok(db, ed, { 'articles/2/status': 'draft' }); 
  const f2 = fixture(); f2.articles[2].assigned_to = null; const db2 = createDb(rules, f2);
  no(db2, ed, { 'articles/2': { ...f2.articles[2], status: 'draft', body: 'sneaky edit' } }, 'status change must not carry a text change');
});
t('managing editor', () => {
  const db = createDb(rules, fixture()), m = A('mgr');
  ok(db, m, { 'articles/4/status': 'published' }); ok(db, m, { 'articles/4/published_at': '2026-11-14 01:00:00' }); ok(db, m, { 'public/articles/4': { title: 'Live' }, 'public/_hash/articles/4': 'abc' });
  ok(db, m, { 'categories/1': { name: 'News' } }); ok(db, m, { 'home_pins/3': { article_id: 3 } }); ok(db, m, { 'issues/1': { title: 'Issue' } }); ok(db, m, { 'public/views/3': 500 }, 'seed views');
  assert.ok(db.canRead(m, 'search_log')); assert.ok(!db.canRead(m, 'inquiries'));
  no(db, m, { 'users/9': { name: 'x', role: 'writer' } }); no(db, m, { 'roles/co/role': 'administrator' }); no(db, m, { 'staff/1': { name: 'x' } }); no(db, m, { 'authors/1': { name: 'x' } }); no(db, m, { 'settings/contact_phone': { value: '1' } });
  no(db, m, { 'articles/1': null }, 'managing editors cannot delete articles');
});
t('newsletter lists belong to managing editors and above', () => {
  const db = createDb(rules, fixture());
  for (const who of ['mgr', 'adm', 'sa']) { const a = A(who); assert.ok(db.canRead(a, 'subscribers') && db.canRead(a, 'public_subscribe'), who + ' reads'); ok(db, a, { 'subscribers/1': { email: 'a@b.co', status: 'active' } }); ok(db, a, { 'newsletters/1': { subject: 'x' } }); }
  for (const who of ['ed', 'wr', 'co']) { const a = A(who); assert.ok(!db.canRead(a, 'subscribers') && !db.canRead(a, 'newsletters') && !db.canRead(a, 'public_unsub'), who + ' cannot read'); no(db, a, { 'subscribers/1': { email: 'a@b.co' } }); no(db, a, { 'newsletters/1': { subject: 'x' } }); }
  ok(db, A('mgr'), { 'public_subscribe/-X': null }, 'a manager clears imported sign-ups');
});
t('administrator', () => {
  const db = createDb(rules, fixture()), a = A('adm');
  ok(db, a, { 'users/9': { name: 'New', email: 'n@x.co', username: 'new', role: 'writer' }, 'roles/newuid': { role: 'writer', active: 1, user_id: 9, key: '9' } });
  ok(db, a, { 'roles/co/active': 0 }); ok(db, a, { 'roles/co/role': 'editor' });
  no(db, a, { 'roles/co/role': 'super_admin' }, 'cannot grant super admin'); no(db, a, { 'roles/sa/role': 'writer' }, 'cannot demote super admin'); no(db, a, { 'roles/sa': null }); no(db, a, { 'users/1/name': 'renamed super' }, 'cannot edit super admin profile');
  no(db, a, { 'roles/co': { role: 'writer', active: 1, user_id: 6, key: '6', extra: 1 } }, 'unknown field'); no(db, a, { 'roles/co/role': 'root' }, 'unknown role');
  assert.ok(db.canRead(a, 'inquiries')); assert.ok(!db.canRead(a, 'audit_log'));
  ok(db, a, { 'staff/1': { name: 'x' } }); ok(db, a, { 'settings/contact_phone': { value: '1' } }); ok(db, a, { 'articles/1': null, 'revisions/1': null }, 'delete article');
  assert.ok(db.canRead(a, 'public_inbox')); ok(db, a, { 'public_inbox/-N1': null });
});
t('super administrator', () => {
  const db = createDb(rules, fixture()), s = A('sa');
  assert.ok(db.canRead(s, 'audit_log')); ok(db, s, { 'roles/co/role': 'super_admin' }); ok(db, s, { 'users/6/role': 'super_admin' });
});
t('own last sign-in only', () => {
  const db = createDb(rules, fixture());
  ok(db, A('co'), { 'users/6/last_login': '2026-11-14 10:00:00' }); no(db, A('co'), { 'users/6/role': 'administrator' }, 'self-promote'); no(db, A('co'), { 'users/1/last_login': 'x' }, "someone else's");
  no(db, A('co'), { 'users/6/active': 1 });
});
t('counters, events and revisions are append-only for staff', () => {
  const db = createDb(rules, fixture());
  ok(db, A('co'), { '_counters/articles': 11 }); ok(db, A('co'), { 'editorial_events/5': { article_id: 1, kind: 'x' } }); no(db, A('co'), { 'editorial_events/5': { article_id: 1, kind: 'changed' } });
  ok(db, A('co'), { 'revisions/1/1': { title: 't' } }); no(db, A('co'), { 'revisions/1/1': { title: 'rewrite history' } });
});
console.log(`rules: ${n} groups of checks passed`);
