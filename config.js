// Public configuration for the site. None of these values are secrets: they identify your Firebase project and your Cloudinary
// account. What visitors and staff may read or write is decided by database.rules.json, not by hiding these.
//
// Fill in:  Firebase console -> Project settings -> General -> "Your apps" -> Web app -> SDK setup and configuration -> Config.
window.MMG_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDLArYJMo2mUIRjej61gOTWPSDHcVAzFi4',
    authDomain: 'meridian-network.firebaseapp.com',
    databaseURL: 'https://meridian-network-default-rtdb.firebaseio.com', // or https://YOUR_PROJECT_ID-default-rtdb.<region>.firebasedatabase.app
    projectId: 'meridian-network',
    appId: '1:46648766052:web:4225769f7805ec3a61f971',
  },
  cloudinary: {
    cloudName: 'damr6r9op',
    uploadPreset: 'mmg_unsigned', // an UNSIGNED upload preset (see README)
    folder: 'mmg',
  },
  // Newsletter email (EmailJS, https://www.emailjs.com). Also public identifiers, not secrets: never put the EmailJS *private* key here.
  // Leave the placeholders as they are and the CMS shows the Newsletter page but will not send until these are filled in.
  emailjs: {
    publicKey: '-U5W2AAzxmNXRHyNy',
    serviceId: 'service_0rgfkhl',
    newsletterTemplateId: 'template_ix2isof',
  },
  // The address people use to reach the site (no trailing slash). Used for canonical links, social previews and the sitemap.
  // Leave empty to use whatever address the site is opened from.
  siteUrl: '',
  // How long a staff sign-in lasts before the password is asked for again (1 to 336 hours).
  sessionHours: 12,
};
