// Stands in for src/firebase.js in the test build: an in-memory database and an in-memory Auth, no network.
const { createRtdb } = require('./fake-rtdb');
const seed = (typeof window !== 'undefined' && window.__SEED) || null;
const rtdb = createRtdb(seed);
const accounts = new Map(); // email -> { uid, email, password, displayName }
const mails = [];
let current = null, n = 0;
const fakeErr = (code, msg) => Object.assign(new Error(msg || code), { code });
const userObj = acc => ({
  uid: acc.uid, email: acc.email, get displayName() { return acc.displayName; },
  getIdTokenResult: async () => ({ claims: { auth_time: Math.floor(Date.now() / 1000) } }),
  reauthenticateWithCredential: async c => { if (c.password !== acc.password) throw fakeErr('auth/wrong-password'); },
  updatePassword: async pw => { acc.password = pw; },
  updateProfile: async p => { if (p.displayName) acc.displayName = p.displayName; },
});
function makeAuth(isSecondary) {
  return {
    get currentUser() { return isSecondary ? null : current; },
    async signInWithEmailAndPassword(email, pw) {
      const a = accounts.get(email); if (!a || a.password !== pw) throw fakeErr('auth/invalid-credential');
      if (a.disabled) throw fakeErr('auth/user-disabled');
      const u = userObj(a); if (!isSecondary) current = u; return { user: u };
    },
    async createUserWithEmailAndPassword(email, pw) {
      if (accounts.has(email)) throw fakeErr('auth/email-already-in-use');
      const a = { uid: 'uid' + (++n), email, password: pw, displayName: '' }; accounts.set(email, a);
      const u = userObj(a); if (!isSecondary) current = u; return { user: u };
    },
    async signOut() { if (!isSecondary) current = null; },
    onAuthStateChanged(cb) { setTimeout(() => cb(isSecondary ? null : current), 0); return () => {}; },
    async sendPasswordResetEmail(email) { mails.push(email); },
    async verifyPasswordResetCode(code) { if (!/^good/.test(code)) throw fakeErr('auth/invalid-action-code'); return code.slice(5) || 'someone@example.com'; },
    async confirmPasswordReset(code, pw) { const a = accounts.get(code.slice(5)); if (a) a.password = pw; },
  };
}
const auth = makeAuth(false), second = makeAuth(true);
const firebase = { auth: { EmailAuthProvider: { credential: (email, password) => ({ email, password }) } } };
if (typeof window !== 'undefined') window.__fake = { rtdb, accounts, mails, addAccount(email, password, uid, displayName) { accounts.set(email, { uid, email, password, displayName: displayName || '' }); } };
module.exports = { firebase, rtdb, auth, ServerValue: rtdb.ServerValue, secondaryAuth: () => second, config: {} };
