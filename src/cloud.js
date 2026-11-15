// Cloudinary from the browser: unsigned uploads (no secret in this code) and URL building for delivery.
const cfg = () => (typeof window !== 'undefined' && window.MMG_CONFIG && window.MMG_CONFIG.cloudinary) || {};
const CLOUD = () => cfg().cloudName || '';
const FOLDER = () => cfg().folder || 'mmg';

// Uploads an image buffer with the unsigned preset named in config.js. Resolves to { public_id, secure_url, width, height }.
async function upload(buffer, opts = {}) {
  const c = cfg();
  if (!c.cloudName || !c.uploadPreset) throw new Error('Cloudinary is not configured (cloudName / uploadPreset in config.js).');
  const fd = new FormData();
  fd.append('file', new Blob([buffer]));
  fd.append('upload_preset', c.uploadPreset);
  if (opts.publicId) fd.append('public_id', opts.publicId);
  if (c.folder) fd.append('folder', c.folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloudName)}/image/upload`, { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || `Cloudinary returned ${res.status}`);
  return { public_id: j.public_id, secure_url: j.secure_url, width: j.width, height: j.height };
}
// A browser cannot delete from Cloudinary without exposing the API secret, so replaced or deleted images stay in the
// Cloudinary library (they are no longer referenced by the site). Clean them up from the Cloudinary console if you wish.
async function destroy() { return null; }

// Delivery URL with automatic format/quality (and optional width) for images. Non-Cloudinary URLs pass through unchanged.
function deliver(url, width) {
  if (!url || !/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)) return url || '';
  const t = ['f_auto', 'q_auto', width ? `w_${Math.round(width)},c_limit` : ''].filter(Boolean).join(',');
  return url.replace('/image/upload/', `/image/upload/${t}/`);
}
module.exports = { upload, destroy, deliver, FOLDER, CLOUD };
