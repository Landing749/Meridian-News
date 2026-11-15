# Meridian Media Group: website and newsroom CMS (static edition)

The public website and the newsroom CMS, running entirely in the browser. There is **no server**: GitHub Pages serves the files,
Firebase (Realtime Database + Authentication) stores data and signs people in, and Cloudinary stores images.

```
 visitors ─┐                         ┌─ Firebase Realtime Database ── /public   (read by anyone: published copy of the content)
           ├─ GitHub Pages (static) ─┤                            ── everything else (staff only, enforced by database.rules.json)
 staff ────┘   app.js runs the site  ├─ Firebase Authentication (email + password)
               and the CMS in the    └─ Cloudinary (images; unsigned uploads from the browser)
               browser
 GitHub Actions: builds the site, pre-renders public pages for search engines, optionally publishes scheduled articles
```

## How it works

* The page code that used to run on the Express server (routes, templates, the data layer) now runs in the browser. `src/browser/`
  holds the small replacements for Express, multer and the request/response objects; everything else is the same code.
* **Security lives in `database.rules.json`**, not in the browser code (which anyone can read). Who a signed-in person is comes from
  `/roles/<uid>`; only administrators can write there. The values in `config.js` (Firebase web config, Cloudinary cloud name and upload
  preset) are public identifiers, not secrets, so it is fine that they are in the repository.
* **Visitors never read your tables.** The website reads `/public`, a copy of the *published* content that a publisher's browser (or the
  optional GitHub Action) keeps up to date from the real tables (`src/publicsync.js`). Drafts, users, inquiries and the audit log are
  not in it. Article bodies are stored apart from the article list, so pages load fast.
* **Nothing secret is committed.** The only secret in the whole project is a Firebase *service account key*, needed only for the
  maintenance scripts (`create-admin`, `sync-roles`, `reconcile`). Keep it on your computer or in a GitHub Actions secret, never in the repo.

## Setup

### 1. Firebase

1. Create a project at <https://console.firebase.google.com> (or use the one you already have).
2. **Build → Realtime Database → Create database.** Then open the **Rules** tab, paste the contents of `database.rules.json`, and **Publish**.
   (Or with the Firebase CLI: `firebase use --add`, then `firebase deploy --only database`.)
3. **Build → Authentication → Get started → Email/Password → Enable.** Leave sign-up enabled: the CMS creates staff accounts this way.
   People who create an account on their own have no role, so they can do nothing.
4. **Authentication → Settings → Authorized domains:** add your site's domain (`yourname.github.io`, or your custom domain).
5. **Authentication → Templates → Password reset → edit → Customize action URL:** `https://YOUR-SITE/admin/reset`
   (include `/repo-name` for a project site: `https://yourname.github.io/repo-name/admin/reset`).
6. **Project settings → General → Your apps → Add app → Web.** Copy the config into `config.js` (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`).

### 2. Cloudinary

1. **Settings → Upload → Upload presets → Add upload preset.** Signing mode: **Unsigned**. Folder: `mmg`. Allowed formats: `jpg,png,webp,gif`.
   Give it an incoming transformation that limits size (for example `c_limit,w_2400`) so huge files are shrunk.
2. Put the preset name and your cloud name in `config.js` (`cloudinary.uploadPreset`, `cloudinary.cloudName`).

Anyone who knows your cloud name and preset name could upload images to that folder, which is the cost of uploading without a server.
The restrictions above (folder, formats, size limit) are what keep that harmless. A browser cannot delete from Cloudinary without exposing the
API secret, so replaced or deleted images stay in your Cloudinary library; they are no longer used by the site and you can clean them up there.

### 3. GitHub

1. Push this folder to a GitHub repository (branch `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. The *Deploy to GitHub Pages* workflow builds and publishes on every push. Your address is `https://USER.github.io/REPO/`
   (or your custom domain: put it in a `CNAME` file at the repository root and set it under Settings → Pages).

### 4. The first administrator

You need to run this once, on your own computer, with a service account key (Firebase console → Project settings → Service accounts →
Generate new private key; keep the file out of the repository):

```bash
npm ci
export FIREBASE_SERVICE_ACCOUNT="$(cat path/to/key.json)"     # Windows PowerShell:  $env:FIREBASE_SERVICE_ACCOUNT = Get-Content path\to\key.json -Raw
npm run create-admin
```

Then open the site, go to `/admin/login`, and sign in **with your email address**. After that you can add everyone else under *Users & Roles*.

### 5. Already have data from the Express version?

Your Realtime Database and Firebase accounts carry over as they are. Run these once:

```bash
npm run sync-roles     # writes /roles/<uid> for every existing staff member (the rules need it)
npm run reconcile      # builds the first /public copy (or just sign in as a publisher; the CMS does it)
```

Staff now sign in with their **email** (usernames no longer work: a static site cannot look an email up by username without exposing it).

### 6. First-run check (5 minutes)

Do this once after deploying, because the project was tested against simulated Firebase and Cloudinary, not your real accounts:

1. Sign in as the administrator, open *Settings* and press **Republish website data**. Open the public site in a private window: published articles should appear.
2. Create an article, upload an image to the media library, publish it, and reload the public site in the private window.
3. Create a user, then sign in as that user in the private window (check the role limits you expect).
4. In the private window, send a message through the contact form, then look in *Contact Inquiries* as administrator.
5. In the Firebase console, open the Realtime Database *Rules* tab and use the **Rules Playground** to confirm a signed-out read of `/articles` is denied.

## Newsletter (EmailJS)

Visitors sign up on `/newsletter`. Staff with the *Newsletter* permission (managing editors and above) open **Newsletter** in the CMS to see
subscribers, write an issue, pick published stories, send themselves a test, and send it to everyone.

1. Create the template and an email service in EmailJS, then fill the `emailjs` section of `config.js`. Step by step: `emailjs-templates/README.md`.
   The three values (public key, service id, template id) are public identifiers, not secrets. Never use the EmailJS *private* key.
2. Publish the new `database.rules.json` (new paths: `subscribers`, `newsletters`, `public_subscribe`, `public_unsub`).
3. Deploy. The page's content security policy already allows `https://api.emailjs.com`.

How it behaves:

* **One email per subscriber**, about one a second, from the open browser tab. Stop and Resume are on the page; a quota or credential error stops the run
  without marking anyone as failed, and Resume carries on where it stopped. A bad address fails on its own and the run continues.
* **Unsubscribe requests are honoured before every send.** The link in each email carries that person's own token; the website drops the request into
  `/public_unsub` and the CMS applies it the next time a manager opens the Newsletter page or starts a send.
* **Free plan limits:** 200 emails a month and 2 templates. Check the Newsletter page's subscriber count before sending.
* Sent issues are kept as a record and cannot be sent again or edited.

### Password-reset email

Reset emails are sent by Firebase Authentication, not EmailJS, because the reset link can only be created by Firebase. To brand it, paste
`firebase-templates/password-reset.html` into *Authentication → Templates → Password reset → Message* (subject suggestion: `Reset your MMG Newsroom password`,
sender name: `Meridian Media Group Newsroom`). Keep the `%LINK%`, `%EMAIL%` and `%APP_NAME%` placeholders as they are.

## Everyday use

* **Publishing:** workflow is unchanged (draft → review → approved → scheduled/published). Publishing updates `/public` within a second or two.
* **Scheduled articles** go live while a publisher has the CMS open, and, if you add the optional secret below, on time even when nobody is signed in.
* **Optional: scheduled publishing without anyone signed in.** Repository *Settings → Secrets and variables → Actions → New secret* named
  `FIREBASE_SERVICE_ACCOUNT` containing the service account JSON. The *Publish scheduled articles* workflow then runs every 30 minutes.
* **Search engines and link previews:** the deploy workflow pre-renders every public page into static HTML (and writes `sitemap.xml` and `robots.txt`)
  by reading `/public`, which needs no secrets. Set `siteUrl` in `config.js` if you use a custom domain.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Builds the site into `dist/` (`BASE_PATH=/repo` for a project site) |
| `npm run serve` | Serves `dist/` locally on <http://localhost:8080> |
| `npm run prerender` | Writes static HTML for public pages into `dist/` |
| `npm run rules` | Regenerates `database.rules.json` from `scripts/gen-rules.mjs` |
| `npm test` | Rules tests, whole-app tests in a simulated browser, base-path and prerender tests |
| `npm run create-admin` / `sync-roles` / `reconcile` | Maintenance scripts (need the service account) |

To change who may do what, edit `scripts/gen-rules.mjs`, run `npm run rules`, run `npm test`, and publish the new `database.rules.json`.

## Behaviour that differs from the Express version

* **Staff sign in with email**, not username. Password reset is by email link; an administrator cannot set someone else's password,
  so *Reset password* sends them a link. Changing your own password does not sign you out on other devices.
* **Every signed-in staff member can read all drafts** (the database cannot hide individual records from people who may list the table).
  What they can *change* follows their role, and the rules enforce it (writers only touch their own drafts, editors only assigned pieces, and so on).
* **Deactivating a user** blocks their access immediately (the rules check `/roles` on every request). Their Firebase account still exists.
* Contact form messages arrive in a holding area and move into *Contact Inquiries* the next time an administrator opens that page.
* Visitors can add one to a page-view counter, add a search-log entry and send a contact message. Nothing else. Counters and the contact form
  can be spammed; if that becomes a problem, turn on Firebase App Check.
* Public search looks at titles, summaries and the start of each article, not the full text.
* The contact form's rate limit is per browser tab only.
* A browser that blocks WebSockets falls back to long polling; the page's content security policy allows Firebase's hosts for that.

## Troubleshooting

* **"One more step" page:** `config.js` still has the placeholder values.
* **Blank public site / "Permission denied" in the console:** the rules are not published, or `/public` is empty. Press *Republish website data* in Settings.
* **Signed in but "no access" or sent back to login:** the person has no `/roles/<uid>` entry. Run `npm run sync-roles`, or create them from *Users & Roles*.
* **Images fail to upload:** the upload preset is not *Unsigned*, or `cloudName`/`uploadPreset` are wrong in `config.js`.
* **Reset email link goes to the wrong place:** step 5 of the Firebase setup.
* **Pages 404 on refresh:** that is normal on GitHub Pages; the app still loads and shows the page. The pre-rendered copy removes the 404 for public pages.
