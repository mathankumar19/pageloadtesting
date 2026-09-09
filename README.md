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
dist/
  index.html                       # dashboard (built by npm run dashboard)
  reports/
    2026-09-09_2015/               # HTML reports copied here for linking
      ...
```

The dashboard always shows the **latest completed run** (folders without a `summary.json` — e.g. from a Ctrl+C'd run — are skipped automatically).

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

`npm run dashboard` reads the latest run's `summary.json` and writes a single self-contained `dist/index.html` — no JS, no external assets, just inline CSS. The table shows one row per site with mobile and desktop columns grouped side by side.

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
