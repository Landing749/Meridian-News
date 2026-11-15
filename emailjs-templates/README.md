# EmailJS template: newsletter

The free EmailJS plan allows **2 templates** and **200 emails a month**, and one email is sent per request, so one issue to 150
subscribers uses 150 of the month's 200. Only the newsletter template is needed. (The password-reset email is not sent through EmailJS;
see `../firebase-templates/password-reset.html`.)

## Create it

1. EmailJS dashboard → **Email Templates → Create New Template → (blank / code editor)**.
2. Open the code editor, delete everything, paste the whole of `newsletter.html`, save.
3. **Settings** tab of the template:

| Field | Value |
|---|---|
| Subject | `{{subject}}` |
| To Email | `{{to_email}}` |
| From Name | `Meridian Media Group` |
| From Email | leave as the connected service's address |
| Reply To | an address you own (EmailJS fills the From Email if empty) |
| Bcc / Cc | leave empty (they would go to every recipient) |

4. Copy the **Template ID** (shown at the top of the template) into `config.js` → `emailjs.newsletterTemplateId`.
5. **Email Services → Add New Service** (Gmail, Outlook, etc.) and copy the **Service ID** into `emailjs.serviceId`.
6. **Account → General** → copy the **Public Key** into `emailjs.publicKey`. Never use the Private Key in this site.
7. **Account → Security**: turn on *Allow EmailJS API for non-browser applications* **off**, and add your site's domain
   (for example `yourname.github.io`) under allowed origins so nobody else can use your public key from another site.
   Optionally set a monthly limit lower than the plan's.

## Variables the CMS sends (do not rename)

| Variable | Meaning |
|---|---|
| `{{subject}}` | Subject line |
| `{{preheader}}` | Inbox preview text |
| `{{to_email}}` `{{to_name}}` | The subscriber (name is "Reader" when unknown) |
| `{{issue_date}}` | Date of sending, Manila time |
| `{{{intro_html}}}` `{{{outro_html}}}` | The introduction and closing note, already escaped and wrapped in paragraphs |
| `{{{articles_html}}}` | The chosen stories: image, category, title, summary, link. Triple braces are required so the HTML is not shown as text |
| `{{site_url}}` `{{logo_url}}` | Your site address and logo (the logo is `/img/logo-full.png` from the deployed site) |
| `{{unsubscribe_url}}` | Personal unsubscribe link (the subscriber's own token) |
| `{{year}}` | Current year |

On the free plan EmailJS may add its own small footer line to emails.
