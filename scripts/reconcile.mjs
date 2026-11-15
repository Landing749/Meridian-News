// Publishes scheduled articles that are due and refreshes the public copy (/public) from the real tables.
// The CMS does the same while a publisher has it open; this script covers the times nobody does, and recovers from any drift.
// Run: npm run reconcile (needs service account credentials). GitHub Actions runs it on a timer (.github/workflows/scheduled-publish.yml).
import { connect, loadTables, sync, nowSql, nextId } from './lib/admin.mjs';
const { rtdb } = connect();

// 1. scheduled articles whose time has come
const articles = (await rtdb.ref('articles').once('value')).val() || {};
const now = nowSql();
let published = 0;
for (const [id, a] of Object.entries(articles)) {
  if (a.status !== 'scheduled' || !a.scheduled_at || a.scheduled_at > now) continue;
  await rtdb.ref('articles/' + id).update({ status: 'published', published_at: a.scheduled_at, updated_at: now });
  const eid = await nextId(rtdb, 'editorial_events');
  await rtdb.ref('editorial_events/' + eid).set({ article_id: Number(id), user_id: null, kind: 'published', body: 'Published automatically at its scheduled time.', created_at: now });
  published++;
}

// 2. daily view history kept by the old server, copied once into /public/views_daily
const legacy = (await rtdb.ref('article_views').once('value')).val() || {};
if (Object.keys(legacy).length) {
  const current = (await rtdb.ref('public/views_daily').once('value')).val() || {};
  const up = {}; let copied = 0;
  for (const [id, days] of Object.entries(legacy)) for (const [day, n] of Object.entries(days || {})) if (!(current[id] && current[id][day] != null)) { up[`public/views_daily/${id}/${day}`] = n; copied++; }
  if (copied) { await rtdb.ref().update(up); console.log(`Copied ${copied} daily view counts.`); }
}

// 3. the public copy
const src = await loadTables(rtdb);
const changed = await sync.reconcile(rtdb, src);
console.log(`${published} scheduled article${published === 1 ? '' : 's'} published; ${changed} change${changed === 1 ? '' : 's'} written to /public.`);
process.exit(0);
