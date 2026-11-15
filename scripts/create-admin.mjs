// Creates (or promotes) a Super Administrator: a Firebase Auth account, a staff profile and the /roles entry the database rules check.
// Interactive:      npm run create-admin
// Non-interactive:  ADMIN_EMAIL=.. ADMIN_USERNAME=.. ADMIN_NAME="..." ADMIN_PASSWORD=.. npm run create-admin
import readline from 'node:readline';
import { connect, nextId, nowSql } from './lib/admin.mjs';

const validPw = pw => typeof pw === 'string' && pw.length >= 12 && pw.length <= 128 && /[a-z]/i.test(pw) && /\d/.test(pw);
const ask = (rl, q, hidden) => new Promise(res => {
  if (hidden) { const w = rl._writeToOutput; rl._writeToOutput = s => { if (s.includes(q)) w.call(rl, s); }; }
  rl.question(q, a => { if (hidden) { rl._writeToOutput = () => {}; rl.output.write('\n'); } res(a.trim()); });
});
let { ADMIN_EMAIL: email, ADMIN_USERNAME: un, ADMIN_NAME: name, ADMIN_PASSWORD: pw } = process.env;
if (!email || !un || !name || !pw) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  name = name || await ask(rl, 'Full name: '); email = email || await ask(rl, 'Email: '); un = un || await ask(rl, 'Username: ');
  pw = pw || await ask(rl, 'Password (min 12 chars, letters + numbers): ', true); rl.close();
}
email = String(email).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[A-Za-z0-9._-]{3,40}$/.test(un) || !name) { console.error('Invalid name, email or username.'); process.exit(1); }
if (!validPw(pw)) { console.error('Password must be 12-128 characters with letters and numbers.'); process.exit(1); }

const { auth, rtdb } = connect();
let fb;
try { fb = await auth.getUserByEmail(email); await auth.updateUser(fb.uid, { password: pw, disabled: false, displayName: name }); }
catch (e) { if (e.code !== 'auth/user-not-found') throw e; fb = await auth.createUser({ email, password: pw, displayName: name }); }

const users = (await rtdb.ref('users').once('value')).val() || {};
const found = Object.entries(users).find(([, u]) => String(u.email || '').toLowerCase() === email || String(u.username || '').toLowerCase() === un.toLowerCase());
let id;
if (found) { id = found[0]; await rtdb.ref('users/' + id).update({ uid: fb.uid, role: 'super_admin', active: 1 }); console.log('Existing user promoted to Super Administrator and password reset.'); }
else { id = await nextId(rtdb, 'users'); await rtdb.ref('users/' + id).set({ uid: fb.uid, email, username: un, name, role: 'super_admin', active: 1, author_id: null, last_login: null, created_at: nowSql() }); console.log('Super Administrator created.'); }
await rtdb.ref('roles/' + fb.uid).set({ role: 'super_admin', active: 1, user_id: Number(id), key: String(id) });
console.log(`Sign in at your site with ${email}.`);
process.exit(0);
