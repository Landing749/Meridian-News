// Firebase Auth operations from the browser (replaces the server's REST calls and Admin SDK calls).
const { auth, secondaryAuth, firebase } = require('./firebase');

const sendPasswordReset = email => auth.sendPasswordResetEmail(String(email));
// Password-reset completion: the reset email's action URL points at /admin/reset?oobCode=...
const resetEmailFor = oobCode => auth.verifyPasswordResetCode(oobCode);
async function confirmReset(oobCode, newPassword) {
  const email = await auth.verifyPasswordResetCode(oobCode);
  await auth.confirmPasswordReset(oobCode, newPassword);
  return { email };
}
// Re-checks the signed-in user's current password without changing the session. Resolves true/false.
async function checkPassword(email, password) {
  try { await auth.currentUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(email, String(password || ''))); return true; }
  catch { return false; }
}
const changePassword = newPassword => auth.currentUser.updatePassword(newPassword);
// Creates a Firebase account for a new staff member WITHOUT switching the admin's own session (uses a second app instance).
async function createAccount(email, password, displayName) {
  const a = secondaryAuth();
  try {
    const c = await a.createUserWithEmailAndPassword(email, password);
    if (displayName) await c.user.updateProfile({ displayName });
    return { uid: c.user.uid };
  } finally { await a.signOut().catch(() => {}); }
}
module.exports = { sendPasswordReset, resetEmailFor, confirmReset, checkPassword, changePassword, createAccount };
