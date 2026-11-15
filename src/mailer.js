// EmailJS from the browser (REST, no SDK). The public key, service id and template id are public identifiers (see config.js);
// EmailJS restricts which sites may use them (Account > Security > allowed domains), and the free plan caps the volume.
const cfg = () => (typeof window !== 'undefined' && window.MMG_CONFIG && window.MMG_CONFIG.emailjs) || {};
const real = v => !!v && !/^YOUR_/i.test(String(v));
const configured = () => { const c = cfg(); return real(c.publicKey) && real(c.serviceId) && real(c.newsletterTemplateId); };

// Sends one email through a template. `params` are the template's variables ({{to_email}}, {{subject}}, ...).
// Rejects with an Error whose .status is the HTTP status (401/403 key or domain problems, 402/429 limits, 400/422 bad request).
async function send(params, templateId) {
  const c = cfg();
  if (!configured()) throw Object.assign(new Error('EmailJS is not configured (emailjs section of config.js).'), { status: 0 });
  let res;
  try {
    res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: c.serviceId, template_id: templateId || c.newsletterTemplateId, user_id: c.publicKey, template_params: params }),
    });
  } catch { throw Object.assign(new Error('Could not reach EmailJS. Check the connection.'), { status: -1 }); }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw Object.assign(new Error(String(text || `EmailJS returned ${res.status}`).slice(0, 300)), { status: res.status });
  return true;
}
// Errors that mean "stop the whole run" (limits, bad credentials, wrong service/template id = 400, expired mail-service login = 412, offline)
// rather than "this one address failed" (a bad recipient is a 422).
const isFatal = e => !e || e.status === undefined || e.status <= 0 || [400, 401, 402, 403, 412, 429].includes(e.status) || e.status >= 500;
module.exports = { configured, send, isFatal };
