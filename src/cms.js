// Background duties of a signed-in publisher: keep /public in step with the real tables, and publish scheduled articles.
const db = require('./db');
const A = require('./auth');
const sync = require('./publicsync');
const scheduler = require('./scheduler');

let timer = null, hooked = false, running = false, again = false, debounce = null, last = null;
const src = { all: db.all };

async function reconcileNow() {
  if (running) { again = true; return 0; }
  running = true;
  try {
    const n = await sync.reconcile(db.rtdb, src);
    last = { at: new Date(), changed: n };
    return n;
  } catch (e) { last = { at: new Date(), error: e.message }; console.warn('Could not update the public site data:', e.message); return -1; }
  finally { running = false; if (again) { again = false; reconcileSoon(500); } }
}
function reconcileSoon(ms = 800) { clearTimeout(debounce); debounce = setTimeout(reconcileNow, ms); }
const tick = () => scheduler.publishDue().catch(e => console.warn('scheduler:', e.message));

// Messages from the website's contact form land in /public_inbox (visitors may only add there). This moves them into the Inquiries list.
async function importInbox() {
  if (!A.state.user || !A.can(A.state.user, 'inquiries.manage')) return 0;
  let inbox; try { inbox = await db.read('public_inbox'); } catch { return 0; }
  let n = 0;
  for (const [k, v] of Object.entries(inbox || {})) {
    await db.insert('inquiries', { name: v.name || '', email: v.email || '', category: v.category || 'Other', subject: v.subject || '', message: v.message || '', consent: 1, created_at: v.created_at });
    await db.removePath('public_inbox/' + k); n++;
  }
  return n;
}
// Newsletter sign-ups and unsubscribe requests from the website land in /public_subscribe and /public_unsub (visitors may only add there).
// This moves them into the Subscribers list. Unsubscribe requests must carry the token that was in the email link.
const tok = () => require('./util').rand(8);
async function importSubscribers() {
  if (!A.state.user || !A.can(A.state.user, 'newsletter.manage')) return 0;
  let n = 0, ins, uns;
  try { ins = await db.read('public_subscribe'); uns = await db.read('public_unsub'); } catch { return 0; }
  const find = email => db.find('subscribers', s => s.email.toLowerCase() === String(email).toLowerCase());
  for (const [k, v] of Object.entries(ins || {})) {
    const email = String(v.email || '').trim(), cur = find(email);
    if (!cur) { await db.insert('subscribers', { email, name: String(v.name || '').slice(0, 120), token: tok(), status: 'active', source: 'website', created_at: v.created_at }); n++; }
    else if (cur.status !== 'active') { await db.update('subscribers', cur.id, { status: 'active' }); n++; } // signing up again is an opt-in
    await db.removePath('public_subscribe/' + k);
  }
  for (const [k, v] of Object.entries(uns || {})) {
    const cur = find(v.email); if (cur && cur.token && cur.token === v.token && cur.status === 'active') { await db.update('subscribers', cur.id, { status: 'unsubscribed' }); n++; }
    await db.removePath('public_unsub/' + k);
  }
  return n;
}
// Called after sign-in (or when a remembered session is restored).
function start(user) {
  stop();
  if (!A.can(user, 'article.publish')) return;
  if (!hooked) { hooked = true; db.onWrite(t => { if (timer && sync.SOURCE_TABLES.includes(t)) reconcileSoon(); }); }
  timer = setInterval(tick, 30000);
  tick(); reconcileSoon(1500);
}
function stop() { clearInterval(timer); timer = null; clearTimeout(debounce); }
module.exports = { start, stop, reconcileNow, importInbox, importSubscribers, newToken: tok, status: () => last };
