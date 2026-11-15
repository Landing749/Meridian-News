// Generates database.rules.json. Run: npm run rules
//
// These rules are the security boundary of the whole site: the browser code is public, so anything it can do, anyone can try.
// Who a signed-in person is comes from /roles/<uid> ({ role, active, user_id, key }), which only administrators can write.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROLE = "root.child('roles').child(auth.uid).child('role').val()";
const ME = "root.child('roles').child(auth.uid).child('user_id').val()"; // the staff member's numeric id (matches created_by / assigned_to)
const ME_KEY = "root.child('roles').child(auth.uid).child('key').val()"; // the same id as a string (matches /users/<id>)
const STAFF = "auth != null && root.child('roles').child(auth.uid).child('active').val() === 1";
const is = (...roles) => `${STAFF} && (${roles.map(r => `${ROLE} === '${r}'`).join(' || ')})`;
const SUPER = is('super_admin');
const ADMIN = is('super_admin', 'administrator');
const MGR = is('super_admin', 'administrator', 'managing_editor');
const EDITOR = is('super_admin', 'administrator', 'managing_editor', 'editor');
const UPLOADER = `${STAFF} && ${ROLE} !== 'contributor'`; // managing editor, editor, writer, admins
const any = (...c) => c.map(x => `(${x})`).join(' || ');
const str = (max, min = 0) => `newData.isString() && newData.val().length <= ${max}` + (min ? ` && newData.val().length >= ${min}` : '');
const num = 'newData.isNumber()';
const ROLE_RE = '/^(super_admin|administrator|managing_editor|editor|writer|contributor)$/';
const STATUS_RE = '/^(draft|pending_review|approved|scheduled|published|archived)$/';

// ---- articles: who may write which change ----
const same = f => `newData.child('${f}').val() === data.child('${f}').val()`;
const articleWrite = any(
  ADMIN, // only administrators may delete an article (article.delete)
  `${MGR} && newData.exists()`,
  // anyone on staff may start a draft of their own
  `${STAFF} && !data.exists() && newData.child('status').val() === 'draft' && newData.child('created_by').val() === ${ME}`,
  // authors edit their own drafts and may submit them for review
  `${STAFF} && data.exists() && newData.exists() && data.child('created_by').val() === ${ME} && data.child('status').val() === 'draft' && newData.child('status').val().matches(/^(draft|pending_review)$/) && ${same('created_by')} && ${same('assigned_to')}`,
  // an editor edits the pieces assigned to them while they are being worked on
  `${STAFF} && ${ROLE} === 'editor' && data.exists() && newData.exists() && data.child('assigned_to').val() === ${ME} && data.child('status').val().matches(/^(draft|pending_review|approved)$/) && (newData.child('status').val().matches(/^(draft|pending_review)$/) || (data.child('status').val() === 'approved' && newData.child('status').val() === 'approved')) && ${same('created_by')} && ${same('assigned_to')}`,
  // any editor may send a piece back for revisions without changing its text
  `${STAFF} && ${ROLE} === 'editor' && data.exists() && newData.exists() && data.child('status').val().matches(/^(pending_review|approved)$/) && newData.child('status').val() === 'draft' && ${same('created_by')} && ${same('assigned_to')} && ${same('title')} && ${same('subtitle')} && ${same('excerpt')} && ${same('body')}`,
);
// Visitors may add 1 to a page-view counter and nothing else.
const bump = `newData.isNumber() && newData.val() === (data.exists() ? data.val() + 1 : 1)`;

const rules = {
  '.read': false,
  '.write': false,

  // Who is who. Only administrators write here; a person can read their own entry. Only a super administrator may touch the super administrator role.
  roles: {
    $uid: {
      '.read': `auth != null && (auth.uid === $uid || (${ADMIN}))`,
      '.write': `(${ADMIN}) && ((${SUPER}) || (newData.child('role').val() !== 'super_admin' && data.child('role').val() !== 'super_admin'))`,
      role: { '.validate': `newData.isString() && newData.val().matches(${ROLE_RE})` },
      active: { '.validate': 'newData.val() === 0 || newData.val() === 1' },
      user_id: { '.validate': num },
      key: { '.validate': 'newData.isString() && newData.val().length <= 20' },
      $other: { '.validate': false },
    },
  },

  users: {
    '.read': STAFF,
    $id: {
      '.write': `(${ADMIN}) && ((${SUPER}) || (newData.child('role').val() !== 'super_admin' && data.child('role').val() !== 'super_admin'))`,
      last_login: { '.write': `${STAFF} && $id === ${ME_KEY}` },
      role: { '.validate': `newData.isString() && newData.val().matches(${ROLE_RE})` },
      email: { '.validate': str(200) }, name: { '.validate': str(120) }, username: { '.validate': str(60) },
    },
  },

  // ---- editorial content ----
  articles: {
    '.read': STAFF,
    $id: {
      '.write': articleWrite,
      title: { '.validate': str(300) },
      status: { '.validate': `newData.isString() && newData.val().matches(${STATUS_RE})` },
      body: { '.validate': str(600000) },
    },
  },
  article_tags: { '.read': STAFF, $id: { '.write': STAFF } },
  revisions: { '.read': STAFF, $aid: { '.write': ADMIN, $rid: { '.write': `${STAFF} && !data.exists()` } } },
  editorial_events: { '.read': STAFF, '.indexOn': ['article_id'], $id: { '.write': `(${STAFF} && !data.exists()) || (${ADMIN})` } },
  categories: { '.read': STAFF, $id: { '.write': MGR } },
  tags: { '.read': STAFF, $id: { '.write': EDITOR } },
  authors: { '.read': STAFF, $id: { '.write': ADMIN } },
  media: { '.read': STAFF, $id: { '.write': any(`${UPLOADER} && !data.exists()`, MGR) } },
  jobs: { '.read': STAFF, $id: { '.write': ADMIN } },
  staff: { '.read': STAFF, $id: { '.write': ADMIN } },
  departments: { '.read': STAFF, $id: { '.write': ADMIN } },
  settings: { '.read': STAFF, $id: { '.write': ADMIN } },
  home_config: { '.read': STAFF, $id: { '.write': MGR } },
  home_pins: { '.read': STAFF, $id: { '.write': MGR } },
  issues: { '.read': MGR, $id: { '.write': MGR } },
  issue_pages: { '.read': MGR, $id: { '.write': MGR } },
  inquiries: { '.read': ADMIN, $id: { '.write': ADMIN } },
  subscribers: { '.read': MGR, $id: { '.write': MGR } },
  newsletters: { '.read': MGR, $id: { '.write': MGR } },

  // Bookkeeping
  _counters: { '.read': STAFF, $t: { '.write': STAFF } },
  _meta: { '.read': STAFF, '.write': MGR },
  audit_log: { '.read': SUPER, $id: { '.write': `${STAFF} && !data.exists()` } },
  article_views: { '.read': MGR, '.write': ADMIN }, // totals kept by the old server; copied to /public by scripts/reconcile.mjs

  // Things visitors may add (and only add)
  search_log: {
    '.read': MGR,
    $id: {
      '.write': '!data.exists() && newData.exists()',
      '.validate': "newData.hasChildren(['q', 'results', 'created_at'])",
      q: { '.validate': str(200) }, results: { '.validate': num }, created_at: { '.validate': str(30) },
      $other: { '.validate': false },
    },
  },
  public_inbox: {
    '.read': ADMIN,
    $id: {
      '.write': `(!data.exists() && newData.exists()) || (${ADMIN})`,
      '.validate': "newData.hasChildren(['name', 'email', 'subject', 'message', 'consent'])",
      name: { '.validate': str(120, 2) },
      email: { '.validate': `${str(200, 5)} && newData.val().matches(/^[^ @]+@[^ @]+[.][^ @]{2,}$/)` },
      category: { '.validate': str(60) },
      subject: { '.validate': str(160, 3) },
      message: { '.validate': str(5000, 10) },
      consent: { '.validate': 'newData.val() === 1' },
      created_at: { '.validate': str(30) },
      $other: { '.validate': false },
    },
  },

  // Newsletter sign-ups and unsubscribe requests: visitors may only add; a publisher moves them into /subscribers (src/cms.js)
  public_subscribe: {
    '.read': MGR,
    $id: {
      '.write': `(!data.exists() && newData.exists()) || (${MGR})`,
      '.validate': "newData.hasChildren(['email', 'consent'])",
      email: { '.validate': `${str(200, 5)} && newData.val().matches(/^[^ @]+@[^ @]+[.][^ @]{2,}$/)` },
      name: { '.validate': str(120) },
      consent: { '.validate': 'newData.val() === 1' },
      created_at: { '.validate': str(30) },
      $other: { '.validate': false },
    },
  },
  public_unsub: {
    '.read': MGR,
    $id: {
      '.write': `(!data.exists() && newData.exists()) || (${MGR})`,
      '.validate': "newData.hasChildren(['email', 'token'])",
      email: { '.validate': `${str(200, 5)} && newData.val().matches(/^[^ @]+@[^ @]+[.][^ @]{2,}$/)` },
      token: { '.validate': str(40, 6) },
      created_at: { '.validate': str(30) },
      $other: { '.validate': false },
    },
  },

  // The website's copy of the content: anyone reads, publishers write (see src/publicsync.js)
  public: {
    '.read': true,
    '.write': MGR,
    views: { $id: { '.write': bump, '.validate': num } },
    views_daily: { $id: { $day: { '.write': bump, '.validate': `${num} && $day.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)` } } },
  },
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'database.rules.json');
fs.writeFileSync(out, JSON.stringify({ rules }, null, 2) + '\n');
console.log('wrote database.rules.json');
export { rules };
