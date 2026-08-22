# XYZ Accounting — built front-end assets

Build output only. The source lives in the private `Royal-MCP` repository under
`xyz-accounting-site/`; nothing here is edited by hand.

These files exist because the site's WordPress.com deployment rejects `.js`,
`.css` and `.woff2` uploads to its media library, so the browser has nowhere on
that host to fetch them from. They are served to it over jsDelivr:

```
https://cdn.jsdelivr.net/gh/brseeger-cloud/xyz-accounting-assets@main/islands/<Calculator>.js
```

## Contents

| Path | What it is |
| --- | --- |
| `islands/*.js` | One self-contained bundle per calculator. Hydrates the server-rendered markup already present in the page, so the calculator is visible before the bundle runs and simply becomes interactive. |
| `site.css` | The compiled stylesheet, scoped under `.xyz-content`. Installed as the theme's custom CSS rather than linked, and kept here for reference. |

Each bundle carries its own copy of the rendering runtime (`preact/compat`
aliased over `react`), which is why they are 37–56 KB rather than ~208 KB.

## Regenerating

From `xyz-accounting-site/` in the source repository:

```
pnpm build
node scripts/wp-bundle.mjs
node scripts/wp-css.mjs
```

Then copy `.wp/islands/*.js` and `.wp/site.css` here and push. jsDelivr caches
a branch reference for up to 12 hours, so a change is not instant.
