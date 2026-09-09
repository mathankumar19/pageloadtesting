# pageloadtesting

Runs [Lighthouse](https://developer.chrome.com/docs/lighthouse) audits against a list of URLs (mobile + desktop) and generates a static HTML dashboard summarizing the results. Publishes to Netlify.

## Requirements

- **Node.js** ≥ 18.16 (project pinned to Node 20 on Netlify)
- **npm** (ships with Node)
- Enough disk space for Chrome (~180 MB, downloaded on first run into Puppeteer's cache)

## Install

```bash
npm install
```

## Configure sites

Edit `sites.json` — an array of the URLs to audit. Each entry needs all four fields:

```json
[
  { "name": "max", "language": "en", "page": "home",       "url": "https://www.maxfashion.com/ae/en" },
  { "name": "max", "language": "en", "page": "department", "url": "https://www.maxfashion.com/ae/en/department/women" }
]
```

Every entry is audited twice (mobile + desktop), so N entries → 2N audits.

`sites.json` is validated on startup — the file must be a non-empty array and every entry must have all four fields, or the run aborts before launching Chrome.

**Grouping by brand** — the `name` field is your brand grouping (e.g. `max`, `centrepoint`, `homecentre`). Keep it consistent across all pages of the same brand so you can filter by brand at run time (see [Run one or more brands](#run-one-or-more-brands) below).

Example — three brands in one file:

```json
[
  { "name": "max",         "language": "en", "page": "home",       "url": "https://www.maxfashion.com/ae/en" },
  { "name": "max",         "language": "en", "page": "department", "url": "https://www.maxfashion.com/ae/en/department/women" },
  { "name": "centrepoint", "language": "en", "page": "home",       "url": "https://www.centrepointstores.com/ae/en" },
  { "name": "homecentre",  "language": "en", "page": "home",       "url": "https://www.homecentre.com/ae/en" }
]
```

## What gets measured

Each audit captures the four Lighthouse category scores plus three Core Web Vitals:

| Field | Source | Shown on dashboard? |
|---|---|---|
| `perf` | Performance score (0–100) | ✅ |
| `a11y` | Accessibility score (0–100) | stored in `summary.json` only |
| `bestPractices` | Best Practices score (0–100) | stored in `summary.json` only |
| `seo` | SEO score (0–100) | stored in `summary.json` only |
| `lcp` | Largest Contentful Paint (display value, e.g. `2.1 s`) | ✅ |
| `cls` | Cumulative Layout Shift (display value) | ✅ |
| `tbt` | Total Blocking Time (display value) | stored in `summary.json` only |

Mobile and desktop runs use distinct emulated User-Agents (Pixel 7 / macOS Chrome 131) and pass anti-automation Chrome flags, which reduces — but does not eliminate — the chance of a site returning a bot-detection page.

## Run

### One-shot: audit + build dashboard

```bash
npm run build
```

This chains three steps:
1. `install-chrome` — downloads Chrome for Puppeteer (skipped if already cached)
2. `report` — runs Lighthouse against every site × mobile/desktop, writes reports to `reports/<timestamp>/`
3. `dashboard` — builds `dist/index.html` from the latest completed run

Expect **~60–90 s per audit** against a slow site, plus a configurable delay between audits.

**Exit codes:**
- `0` — every audit produced results
- `1` — fatal error (bad `sites.json`, Chrome couldn't launch, etc.); no `summary.json` written
- `2` — at least one audit failed after all retries; a `summary.json` is still written with the failures listed in `summary.failures`

### Run steps individually

```bash
npm run install-chrome    # downloads Chrome (idempotent)
npm run report            # runs Lighthouse audits
npm run dashboard         # rebuilds dist/ from the latest run
```

### Choose brands, pages and/or presets at run time

`npm run report` accepts three independent filters after `--`:

- **Brand filter** — any positional argument is treated as a brand name (matched case-insensitively against the `name` field in `sites.json`). No positional args = all brands.
- **Page filter** — `--page <value>` restricts to specific pages (matched case-insensitively against the `page` field). Can be repeated (`--page home --page PDP`), comma-separated (`--page home,PDP`), or use `=` (`--page=home`). No flag = all pages.
- **Preset filter** — `--mobile` and/or `--desktop` restrict the run to those presets. No flag = both presets (same as passing both).

Filters are combined with AND — e.g. `max --page cart --mobile` runs "max's cart page on mobile only" = 1 audit. Args can appear in any order.

```bash
# Brand only
npm run report                                    # all brands × all pages × mobile + desktop  (default)
npm run report -- max                             # just max
npm run report -- max centrepoint                 # max + centrepoint

# Page only
npm run report -- --page home                     # all brands × home only × mobile + desktop
npm run report -- --page home,PDP                 # all brands × home + PDP
npm run report -- --page home --page PDP          # same, repeated-flag form

# Preset only
npm run report -- --mobile                        # all brands × all pages × mobile only
npm run report -- --desktop                       # all brands × all pages × desktop only

# Any combination
npm run report -- max --page cart --mobile        # 1 audit: max/cart/mobile
npm run report -- max centrepoint --page home     # 4 audits: 2 brands × home × mobile+desktop
npm run report -- --page PDP --mobile             # 3 audits: 3 brands × PDP × mobile only
```

- Positional args, `--page` values, and preset flags are all case-insensitive (`--page pdp` matches `PDP`).
- An unrecognised brand, page, or flag aborts the run and lists what's available.
- If the combined filters leave zero entries (e.g. `max --page nonexistent`), the run aborts with a hint.
- The filter only affects `npm run report` — `npm run dashboard` always builds from whatever the latest completed run contains. Skipped presets show `—` in the dashboard.
- `npm run build` runs the report unfiltered. For a filtered end-to-end build, run the steps separately:
  ```bash
  npm run report -- max --page home --mobile && npm run dashboard
  ```

### View the dashboard locally

```bash
npm run serve
```

Then open [http://localhost:5005/](http://localhost:5005/).

To use a different port for one run:
```bash
PORT=5005 npm run serve
```

To change the default port permanently, edit `src/serve.js` line 7.

**Stop the server**: `Ctrl+C` in that terminal, or from another terminal:
```bash
lsof -ti :5005 | xargs kill
```

## Tuning knobs (env vars)

All optional. Defaults are set for local runs; `netlify.toml` overrides them with more conservative values for Netlify's 15-minute build limit.

| Variable | Default (local) | Default (Netlify) | Purpose |
|---|---|---|---|
| `AUDIT_DELAY_MS` | `12000` | `8000` | Pause between audits, in ms. Higher = less risk of rate-limiting. |
| `AUDIT_RETRIES` | `1` | `1` | Retries when an audit throws or returns `perf=0` (usually means blocked/empty). |
| `AUDIT_RETRY_BACKOFF_MS` | `30000` | `20000` | Wait before a retry, in ms. |
| `PORT` | `5005` | n/a | Port for `npm run serve`. |
| `PUPPETEER_CACHE_DIR` | Puppeteer default | `/opt/build/repo/.cache/puppeteer` | Where Chrome is stored. |

Example — slow things down further to avoid getting blocked:

```bash
AUDIT_DELAY_MS=20000 AUDIT_RETRIES=2 npm run report
```

## Output layout

```
reports/
  2026-09-09_2015/                 # one folder per run (yyyy-mm-dd_HHMM)
    max-home-en-mobile.html        # full Lighthouse HTML report
    max-home-en-desktop.html
    max-department-en-mobile.html
    max-department-en-desktop.html
    summary.json                   # scores + metrics for all audits
  2026-09-09_2039/                 # another run
    ...
dist/
  index.html                       # latest run's dashboard
  history.html                     # list of every completed run
  runs/
    2026-09-09_2015/index.html     # per-run dashboard (permanent link)
    2026-09-09_2039/index.html
  reports/
    2026-09-09_2015/               # raw Lighthouse HTMLs, per run
      ...
    2026-09-09_2039/
      ...
```

`npm run dashboard` rebuilds `dist/` from **every** completed run in `reports/` (folders without a `summary.json` — e.g. a Ctrl+C'd run — are skipped). Each run gets a permanent per-run dashboard at `dist/runs/<runId>/index.html`, plus:

- `dist/index.html` — mirrors the latest run
- `dist/history.html` — clickable list of every run, newest first

Raw Lighthouse HTMLs from a run are copied to `dist/reports/<runId>/` on first build and reused on subsequent builds (idempotent — an unchanged run's raw reports aren't re-copied).

### Viewing an older run

From either `dist/index.html` or `dist/history.html`, click **All runs** to see every completed run, then pick one — you land on that run's dashboard with the same layout as latest, and the same raw-report links. Each run's URL is stable (`/runs/<runId>/`), so you can bookmark or share it.

### `summary.json` shape

```json
{
  "runId": "2026-09-09_2015",
  "startedAt": "2026-09-09T20:15:03.412Z",
  "finishedAt": "2026-09-09T20:22:47.881Z",
  "sites": [
    {
      "name": "max",
      "language": "en",
      "page": "home",
      "url": "https://www.maxfashion.com/ae/en",
      "mobile":  { "file": "max-home-en-mobile.html",  "perf": 42, "a11y": 88, "bestPractices": 92, "seo": 100, "lcp": "3.2 s", "cls": "0.01", "tbt": "310 ms" },
      "desktop": { "file": "max-home-en-desktop.html", "perf": 78, "a11y": 88, "bestPractices": 92, "seo": 100, "lcp": "1.4 s", "cls": "0.00", "tbt": "60 ms" }
    }
  ],
  "failures": [
    { "site": "max", "page": "department", "language": "en", "preset": "mobile", "error": "perf=0 (likely blocked or empty response)" }
  ]
}
```

Failed audits appear in `summary.sites[].{mobile,desktop}` as `{ "file": null, "error": "..." }` and are also collected in the top-level `failures` array. `sites[]` preserves the order from `sites.json`.

## Dashboard

`npm run dashboard` reads every completed run's `summary.json` and writes:

- `dist/index.html` — mirrors the latest run
- `dist/runs/<runId>/index.html` — permanent per-run dashboard, one per completed run
- `dist/history.html` — clickable list of every run (newest first, with started time, duration, sites, failure count)

All three page types share the same self-contained HTML — no JS, no external assets, just inline CSS. The audit table shows one row per site with mobile and desktop columns grouped side by side.

- **Navigation** — every page has a small header with "Latest run" and "All runs (N)" links, so you can jump between them
- **Score color coding** — green ≥ 90, amber ≥ 50, red < 50, grey for missing/failed audits
- **Failed audits** — render as an `error` cell with the failure message on hover; a summary count also appears in the header
- **Dark mode** — respects `prefers-color-scheme` automatically
- **Sticky header** — the top row stays visible while scrolling
- **Report links** — each cell has an "open ↗" link to the full Lighthouse HTML report

Filenames in `reports/<timestamp>/` follow the pattern `<name>-<page>-<language>-<preset>.html`, with any character outside `[A-Za-z0-9._-]` replaced by `_`.

## Deploy to Netlify

`netlify.toml` is pre-configured. On each deploy Netlify runs `npm run build`, which produces `dist/`, which is what gets served.

**Caveat**: running Lighthouse from Netlify's build servers against third-party production sites is fragile — the target CDN may throttle or block Netlify's AWS IPs, producing `perf=0` results even though the audit "completes". If that happens, you'll see mostly zeros or `error` cells in the dashboard. Options in that case:
- Increase `AUDIT_DELAY_MS` / `AUDIT_RETRIES` in `netlify.toml`
- Run `npm run build` locally, commit `reports/` + `dist/` to the repo, and let Netlify only serve the static files
- Route Netlify's outbound traffic through a residential proxy

## Project layout

```
src/
  run-lighthouse.js    # runs Lighthouse audits, writes reports/<timestamp>/
  build-dashboard.js   # reads latest summary.json, writes dist/index.html
  serve.js             # tiny Node static file server for dist/
sites.json             # list of URLs to audit
package.json           # scripts: build, report, dashboard, serve, install-chrome
netlify.toml           # Netlify build config + env var overrides
reports/               # audit output (gitignored in typical setups)
dist/                  # dashboard build output (Netlify's publish dir)
```

## Troubleshooting

**`ENOENT ... chrome`** — Chrome isn't installed. Run `npm run install-chrome` or `npm run build` (which does it first).

**`ENOENT ... summary.json`** — the latest run in `reports/` was aborted (no `summary.json`). The dashboard now skips these automatically; if you still see this, delete the empty folder:
```bash
rmdir reports/<timestamp>
```

**Audits keep returning `perf=0`** — target site is likely blocking/throttling the source IP. Increase `AUDIT_DELAY_MS`, or run somewhere with a different IP. See the Netlify caveat above.

**Port 5005 already in use** — another process (maybe an old `npm run serve`) is holding it:
```bash
lsof -ti :5005 | xargs kill
```




┌─────────────────────────────────────────────────┬────────┬─────────┐
│                     Command                     │ Audits │  ~Time  │
├─────────────────────────────────────────────────┼────────┼─────────┤
│ npm run report -- max --mobile                  │ 6      │ ~8 min  │
├─────────────────────────────────────────────────┼────────┼─────────┤
│ npm run report -- max                           │ 12     │ ~17 min │
├─────────────────────────────────────────────────┼────────┼─────────┤
│ npm run report -- max centrepoint --mobile      │ 12     │ ~17 min │
├─────────────────────────────────────────────────┼────────┼─────────┤
│ npm run report -- --mobile (all brands, mobile) │ 18     │ ~26 min │
├─────────────────────────────────────────────────┼────────┼─────────┤
│ npm run report -- max centrepoint               │ 24     │ ~35 min │
├─────────────────────────────────────────────────┼────────┼─────────┤
│ npm run report (everything)                     │ 36     │ ~52 min │
└─────────────────────────────────────────────────┴────────┴─────────┘