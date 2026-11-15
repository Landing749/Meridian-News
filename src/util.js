// Shared helpers (browser build). HTML sanitising uses DOMPurify, which relies on the browser's own parser.
const purifyMod = require('dompurify');
const DOMPurify = purifyMod.default || purifyMod;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
const rand = (n = 32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
// The old server signed forms with a secret. A static site has no secret to sign with, so this is only a stub for old call sites.
const hmac = () => '';
const sha = s => s;

// Plain text of an HTML string (no tags, single spaces).
function textOnly(html) {
  const s = String(html || '');
  if (typeof DOMParser !== 'undefined') return (new DOMParser().parseFromString(s, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
const wordCount = html => { const t = textOnly(html); return t ? t.split(' ').length : 0; };
const readingTime = html => Math.max(1, Math.ceil(wordCount(html) / 220));
// Public list rows carry a precomputed reading time and text snippet instead of the whole body (see publicsync.js).
const rt = a => a._rt || readingTime(a.body);
const plain = (a, n) => (a._plain != null && a._plain !== '' ? String(a._plain) : textOnly(a.body)).slice(0, n);

const fmtDate = (d, withTime) => {
  if (!d) return '';
  const dt = new Date(String(d).includes('T') || String(d).includes('Z') ? d : String(d).replace(' ', 'T') + 'Z');
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) });
};
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// ---- Article HTML sanitiser: same allow-list as the server version ----
const VIDEO_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com'];
const TAGS = ['p', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'iframe', 'div'];
const ATTRS = ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'loading', 'allowfullscreen', 'colspan', 'class'];
let hooked = false;
function installHooks() {
  if (hooked || !DOMPurify.addHook) return; hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    const tag = (node.tagName || '').toLowerCase();
    if (node.hasAttribute && node.hasAttribute('class') && !(tag === 'div' && node.getAttribute('class') === 'video-embed')) node.removeAttribute('class');
    if (tag === 'a') { node.setAttribute('rel', 'noopener noreferrer'); }
    if (tag === 'img') {
      if (!/^https:\/\//.test(node.getAttribute('src') || '')) { node.remove(); return; }
      node.setAttribute('loading', 'lazy');
    }
    if (tag === 'iframe') {
      let ok = false; try { ok = VIDEO_HOSTS.includes(new URL(node.getAttribute('src') || '', 'https://x.invalid').hostname) && /^https:\/\//.test(node.getAttribute('src') || ''); } catch {}
      if (!ok) { node.remove(); return; }
      node.setAttribute('loading', 'lazy');
    }
  });
}
function cleanBody(html) {
  installHooks();
  return DOMPurify.sanitize(String(html || ''), {
    ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTRS, ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'target'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}
// Heading levels shift down on output so the article title stays the page's only h1.
const shiftHeadings = html => html.replace(/<(\/?)h([123])(\b[^>]*)>/g, (m, s, n, r) => `<${s}h${+n + 1}${r}>`);
module.exports = { esc, slugify, sha, rand, hmac, cleanBody, shiftHeadings, textOnly, wordCount, readingTime, rt, plain, fmtDate, nowSql };
