// Firebase client SDK (compat API, which has the same ref()/on()/once()/transaction() shape the data layer was written against).
// The values in window.MMG_CONFIG (config.js) are public identifiers, not secrets: access is decided by database.rules.json.
const cfg = (typeof window !== 'undefined' && window.MMG_CONFIG) || {};
const appMod = require('firebase/compat/app');
const firebase = appMod.default || appMod;
require('firebase/compat/auth');
require('firebase/compat/database');

if (!firebase.apps.length) firebase.initializeApp(cfg.firebase || {});
const rtdb = firebase.database();
const auth = firebase.auth();

// Creating an account with the client SDK signs that account in. A second app instance keeps the admin's own session intact.
function secondaryAuth() {
  const app = firebase.apps.find(a => a.name === 'secondary') || firebase.initializeApp(cfg.firebase || {}, 'secondary');
  return app.auth();
}
module.exports = { firebase, rtdb, auth, ServerValue: firebase.database.ServerValue, secondaryAuth, config: cfg };
