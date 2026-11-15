// Publishes scheduled articles when their time comes. A static site has no always-on server, so this runs inside the CMS while a
// publisher (managing editor or above) has it open, and optionally from GitHub Actions (scripts/reconcile.mjs) so posts go live on
// time even when nobody is signed in. A short lease in the database stops two open tabs from publishing the same article twice.
const db = require('./db');
const ME = Math.random().toString(36).slice(2, 10);
async function haveLease() {
  const now = Date.now();
  const r = await db.rtdb.ref('_meta/scheduler_lease').transaction(v => (!v || v.expires < now || v.owner === ME ? { owner: ME, expires: now + 45000 } : undefined));
  return r.committed;
}
async function publishDue() {
  const now = db.now(), due = db.where('articles', a => a.status === 'scheduled' && a.scheduled_at && a.scheduled_at <= now);
  if (!due.length || !(await haveLease())) return 0;
  for (const a of due) {
    await db.update('articles', a.id, { status: 'published', published_at: a.scheduled_at, updated_at: db.now() });
    await db.append('editorial_events', { article_id: a.id, user_id: null, kind: 'published', body: 'Published automatically at its scheduled time.' }, 'editorial_events');
    await db.push('audit_log', { action: 'publish_scheduled', entity: 'article', entity_id: String(a.id), detail: 'scheduler' });
  }
  return due.length;
}
module.exports = { publishDue };
