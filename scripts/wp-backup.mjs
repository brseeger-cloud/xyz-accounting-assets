#!/usr/bin/env node
/**
 * Pulls the XYZ Accounting WordPress site into `backup/` so this repository is a
 * restorable copy of what is actually published.
 *
 * Published content needs no credentials. Set WP_USER + WP_APP_PASSWORD to also
 * capture drafts, private pages, menus and site settings, which the REST API
 * refuses anonymously.
 *
 * Output is deterministic: no timestamps are written into tracked files, so a run
 * that finds nothing changed produces no diff and the workflow makes no commit.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SITE = (process.env.WP_SITE_URL ?? 'https://superblyladyec52fb18e8-stxdq.wpcomstaging.com').replace(/\/+$/, '');
const OUT = process.env.WP_BACKUP_DIR ?? 'backup';
const REPO = process.env.GITHUB_REPOSITORY ?? 'brseeger-cloud/xyz-accounting-assets';

const USER = process.env.WP_USER;
const PASS = process.env.WP_APP_PASSWORD;
const AUTHED = Boolean(USER && PASS);
const AUTH_HEADER = AUTHED
  ? 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')
  : null;

/** Collections worth keeping. `authed` ones are skipped when we have no credentials. */
const COLLECTIONS = [
  { name: 'pages', base: 'pages', perItem: true },
  { name: 'posts', base: 'posts', perItem: true },
  { name: 'media', base: 'media' },
  { name: 'categories', base: 'categories' },
  { name: 'tags', base: 'tags' },
  { name: 'navigation', base: 'navigation' },
  { name: 'blocks', base: 'blocks' },
  { name: 'menus', base: 'menus', authed: true },
  { name: 'menu-items', base: 'menu-items', authed: true },
];

/** Fields that change on every request or just restate the URL. Dropping them keeps diffs honest. */
const NOISE = ['_links', 'jetpack-related-posts', 'jetpack_shortlink', 'class_list'];

const warnings = [];

async function get(path, { raw = false } = {}) {
  const url = path.startsWith('http') ? path : `${SITE}${path}`;
  const headers = { 'user-agent': `xyz-accounting-assets-backup (+https://github.com/${REPO})` };
  if (AUTH_HEADER) headers.authorization = AUTH_HEADER;

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.status = res.status;
        // Client errors will not fix themselves on a retry.
        if (res.status >= 400 && res.status < 500) throw err;
        lastErr = err;
      } else {
        return raw ? { body: await res.text(), res } : { body: await res.json(), res };
      }
    } catch (err) {
      if (err.status >= 400 && err.status < 500) throw err;
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

/** Walks every page of a REST collection. */
async function collect(base, extra = '') {
  const items = [];
  for (let page = 1; ; page++) {
    const { body, res } = await get(`/wp-json/wp/v2/${base}?per_page=100&page=${page}&orderby=id&order=asc${extra}`);
    if (!Array.isArray(body)) throw new Error(`Expected a list from ${base}, got ${typeof body}`);
    items.push(...body);
    const total = Number(res.headers.get('x-wp-total-pages') ?? 1);
    if (page >= total || body.length === 0) break;
  }
  return items;
}

/** Recursively sorts object keys so serialisation order never causes a spurious diff. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => !NOISE.includes(k))
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  }
  return value;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(stable(value), null, 2) + '\n');
}

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text.endsWith('\n') ? text : text + '\n');
}

function fileName(item) {
  const slug = String(item.slug || 'untitled').replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');
  return `${String(item.id).padStart(4, '0')}-${slug || 'untitled'}`;
}

/**
 * The theme's custom CSS lives only in the WordPress database — it is installed
 * through the customiser rather than linked from this repo, so nothing else holds
 * a copy. The stylesheet URL carries a content hash, discoverable from any page.
 */
async function backupCustomCss() {
  const { body: home } = await get('/', { raw: true });
  const match = home.match(/\?custom-css=([a-f0-9]+)/i);
  if (!match) {
    warnings.push('No custom-css stylesheet link found on the homepage — theme CSS not backed up.');
    return null;
  }
  const { body: css } = await get(`/?custom-css=${match[1]}`, { raw: true });
  await writeText(join(OUT, 'theme', 'custom.css'), css);
  return { bytes: Buffer.byteLength(css) };
}

/**
 * Records which CDN asset each page pulls, and reconciles that against the bundles
 * actually committed here. A page pointing at a file we do not have is a broken
 * calculator; a committed bundle nobody references is dead weight. Both show up as
 * a diff in this file the moment they happen.
 */
async function auditAssets(pages) {
  const pattern = new RegExp(`cdn\\.jsdelivr\\.net/gh/${REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@([^/]+)/([^"'<>\\s)]+)`, 'gi');

  const referenced = {};
  const refs = new Set();
  for (const page of pages) {
    const haystack = `${page.content?.rendered ?? ''}${page.excerpt?.rendered ?? ''}`;
    for (const [, ref, path] of haystack.matchAll(pattern)) {
      refs.add(ref);
      (referenced[path] ??= []).push(page.link?.replace(SITE, '') ?? `#${page.id}`);
    }
  }
  for (const list of Object.values(referenced)) list.sort();

  let committed = [];
  try {
    committed = (await readdir('islands')).filter((f) => f.endsWith('.js')).map((f) => `islands/${f}`);
  } catch {
    warnings.push('No islands/ directory found — skipped the committed-bundle reconciliation.');
  }

  const missing = Object.keys(referenced).filter((p) => !committed.includes(p)).sort();
  const unreferenced = committed.filter((p) => !(p in referenced)).sort();

  if (missing.length) warnings.push(`Pages reference assets absent from this repo: ${missing.join(', ')}`);
  if (unreferenced.length) warnings.push(`Committed bundles no page references: ${unreferenced.join(', ')}`);
  if (refs.size > 1) warnings.push(`Pages pin more than one git ref: ${[...refs].sort().join(', ')}`);

  await writeJson(join(OUT, 'asset-usage.json'), {
    cdn_refs_in_use: [...refs].sort(),
    referenced_by_page: referenced,
    referenced_but_not_committed: missing,
    committed_but_unreferenced: unreferenced,
  });

  return { missing, unreferenced };
}

async function main() {
  console.log(`Backing up ${SITE} -> ${OUT}/ (${AUTHED ? 'authenticated' : 'anonymous — published content only'})`);

  // Rebuilt from scratch each run so deletions upstream become deletions here.
  await rm(OUT, { recursive: true, force: true });

  const counts = {};
  let pages = [];

  for (const { name, base, perItem, authed } of COLLECTIONS) {
    if (authed && !AUTHED) {
      console.log(`  ${name}: skipped (needs WP_USER + WP_APP_PASSWORD)`);
      continue;
    }
    // With credentials we can see everything; without them the API only ever returns published items.
    const extra = AUTHED && ['pages', 'posts'].includes(base) ? '&status=any' : '';
    let items;
    try {
      items = await collect(base, extra);
    } catch (err) {
      warnings.push(`Could not back up ${name}: ${err.message}`);
      console.log(`  ${name}: FAILED — ${err.message}`);
      continue;
    }

    counts[name] = items.length;
    console.log(`  ${name}: ${items.length}`);

    if (perItem) {
      // One file per item, so a single edited page is a single-file diff.
      for (const item of items) {
        const stem = join(OUT, name, fileName(item));
        await writeJson(`${stem}.json`, item);
        await writeText(`${stem}.html`, item.content?.rendered ?? '');
      }
      await writeJson(join(OUT, `${name}.index.json`), items.map((i) => ({
        id: i.id, slug: i.slug, status: i.status, title: i.title?.rendered, link: i.link, modified_gmt: i.modified_gmt,
      })));
    } else {
      await writeJson(join(OUT, `${name}.json`), items);
    }

    if (base === 'pages') pages = items;
  }

  const css = await backupCustomCss();
  if (css) console.log(`  theme custom CSS: ${css.bytes} bytes`);

  const audit = await auditAssets(pages);

  let settings = null;
  if (AUTHED) {
    try {
      ({ body: settings } = await get('/wp-json/wp/v2/settings'));
      await writeJson(join(OUT, 'settings.json'), settings);
    } catch (err) {
      warnings.push(`Could not back up settings: ${err.message}`);
    }
  }

  await writeJson(join(OUT, 'MANIFEST.json'), {
    site: SITE,
    scope: AUTHED ? 'all statuses, menus and settings' : 'published content only',
    counts,
    theme_custom_css_bytes: css?.bytes ?? null,
    asset_audit: {
      referenced_but_not_committed: audit.missing,
      committed_but_unreferenced: audit.unreferenced,
    },
  });

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(`Backup failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
