# XYZ Accounting — built front-end assets

Two jobs:

1. **Serving.** The built front-end assets the live site loads over jsDelivr.
2. **Backup.** A daily copy of the site's content under `backup/`, so what is
   published exists somewhere other than the WordPress database.

The source for the assets lives in the private `Royal-MCP` repository under
`xyz-accounting-site/`; nothing in `islands/` or `site.css` is edited by hand.

## Serving

The site's WordPress.com deployment rejects `.js`, `.css` and `.woff2` uploads to
its media library, so the browser has nowhere on that host to fetch them from.
They are served to it over jsDelivr:

```
https://cdn.jsdelivr.net/gh/brseeger-cloud/xyz-accounting-assets@main/islands/<Calculator>.js
```

| Path | What it is |
| --- | --- |
| `islands/*.js` | One self-contained bundle per calculator. Hydrates the server-rendered markup already present in the page, so the calculator is visible before the bundle runs and simply becomes interactive. |
| `site.css` | The compiled stylesheet, scoped under `.xyz-content`. Installed as the theme's custom CSS rather than linked, and kept here for reference. |

Each bundle carries its own copy of the rendering runtime (`preact/compat`
aliased over `react`), which is why they are 37–56 KB rather than ~208 KB.

This repository must stay public: jsDelivr will not serve a private one.

### Regenerating

From `xyz-accounting-site/` in the source repository:

```
pnpm build
node scripts/wp-bundle.mjs
node scripts/wp-css.mjs
```

Then copy `.wp/islands/*.js` and `.wp/site.css` here and push. jsDelivr caches a
branch reference for up to 12 hours, so a change is not instant.

### Known drift

Two things are true of the current contents and are deliberate, not oversights:

- **`site.css` is behind the site.** The stylesheet actually installed as the
  theme's custom CSS is ~51.8 KB and uses Public Sans with IBM Plex Mono; the
  build output committed here is ~36.1 KB and uses Bricolage Grotesque with
  JetBrains Mono. Nothing is broken, because the site does not load this file —
  but it no longer describes production. `backup/theme/custom.css` is the live
  truth. Resolve it by rebuilding from source and comparing.
- **`islands/HomeCalculator.js` is unreferenced.** No page loads it. Either a
  page is missing its embed or the bundle outlived its page. It is kept because
  deleting it would break whichever page is meant to use it.

Both are reported on every backup run, so neither can drift further unnoticed.

## Backing the site up

`.github/workflows/wp-backup.yml` pulls the site through the WordPress REST API
and commits the result to `backup/`. It runs:

- **daily**, at 16:23 UTC (~02:23 Australian eastern time);
- **on webhook**, whenever a `wp-content-changed` dispatch arrives (below);
- **on demand**, from the Actions tab.

A run that finds nothing changed makes no commit — the output carries no
timestamps, so the diff is real content or nothing. Each run also reconciles the
CDN assets the live pages request against the bundles committed here, and **fails**
if a page asks for a file this repository does not have, because that is a
calculator that is broken in production right now.

What lands in `backup/`:

| Path | Contents |
| --- | --- |
| `pages/`, `posts/` | One `.json` (full record) and one `.html` (rendered body) per item, so editing one page is a one-file diff |
| `*.index.json` | Slug, status, title and last-modified for each item, for scanning at a glance |
| `media.json`, `categories.json`, `tags.json`, `navigation.json`, `blocks.json` | Whole collections |
| `theme/custom.css` | The installed custom CSS, which lives nowhere else |
| `asset-usage.json` | Which page loads which CDN bundle, and both directions of mismatch |
| `MANIFEST.json` | Counts and audit results |

### Running it locally

```
node scripts/wp-backup.mjs
```

### Credentials

None are required: published content, media and navigation are all readable
anonymously, and that is what the workflow captures by default.

To also capture **drafts, private pages, menus and site settings** — which the
REST API refuses anonymously — add an
[application password](https://wordpress.com/support/application-passwords/) and
set two repository secrets:

| Secret | Value |
| --- | --- |
| `WP_USER` | The WordPress username the application password belongs to |
| `WP_APP_PASSWORD` | The generated application password |

Optionally set the `WP_SITE_URL` repository *variable* to point the backup at a
different host; it defaults to the current staging URL. Change it when the site
moves to its production domain.

### Wiring up the webhook

The workflow already listens. Anything that can make an authenticated POST can
trigger a backup the moment content changes:

```
curl -X POST \
  -H 'Accept: application/vnd.github+json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  https://api.github.com/repos/brseeger-cloud/xyz-accounting-assets/dispatches \
  -d '{"event_type":"wp-content-changed"}'
```

`<TOKEN>` is a fine-grained personal access token scoped to this repository with
**Contents: read and write** (a classic token needs the `repo` scope). A `204`
means the run started.

WordPress will not send that request on its own — no plugin currently installed
on the site emits outbound webhooks, and WordPress.com does not offer them
natively. Pick one sender:

- **Zapier / Make** — a *WordPress → new or updated post* trigger into a
  *Webhooks → POST* step holding the token. Nothing to install on the site.
- **A webhook plugin** — e.g. WP Webhooks, if the plan allows plugin installs,
  firing on `publish_post` / `publish_page`.
- **An mu-plugin** — a few lines on `save_post` calling `wp_remote_post()`, with
  the token in `wp-config.php`. Needs filesystem access to the site.

Until one of those exists the daily schedule is the backup, and it is enough:
the webhook only shortens the window between publishing and being backed up.

> GitHub only runs `schedule` and `repository_dispatch` workflows from the
> repository's **default branch**. The workflow does nothing until it is on `main`.
