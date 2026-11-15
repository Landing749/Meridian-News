// One-time (and safe to repeat): writes a /roles/<uid> entry for every staff member in /users. Run this when moving from the
// Express version, whose users did not have one. The database rules use /roles, so nobody can sign in to the CMS without it.
import { connect } from './lib/admin.mjs';
const { rtdb } = connect();
const users = (await rtdb.ref('users').once('value')).val() || {};
const updates = {}; let n = 0, skipped = 0;
for (const [id, u] of Object.entries(users)) {
  if (!u.uid) { skipped++; console.warn(`users/${id} (${u.email}) has no Firebase uid, skipped`); continue; }
  updates['roles/' + u.uid] = { role: u.role || 'contributor', active: u.active === 0 ? 0 : 1, user_id: Number(id), key: String(id) }; n++;
}
if (n) await rtdb.ref().update(updates);
console.log(`${n} role entr${n === 1 ? 'y' : 'ies'} written${skipped ? `, ${skipped} skipped` : ''}.`);
process.exit(0);
