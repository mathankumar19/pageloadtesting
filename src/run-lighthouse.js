import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const PRESETS = [
  { name: 'mobile',  config: undefined,     userAgent: MOBILE_UA },
  { name: 'desktop', config: desktopConfig, userAgent: DESKTOP_UA },
];

const DELAY_BETWEEN_AUDITS_MS = Number(process.env.AUDIT_DELAY_MS ?? 12000);
const RETRY_ATTEMPTS = Number(process.env.AUDIT_RETRIES ?? 1);
const RETRY_BACKOFF_MS = Number(process.env.AUDIT_RETRY_BACKOFF_MS ?? 30000);

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sanitize(part) {
  return String(part).replace(/[^A-Za-z0-9._-]+/g, '_');
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function resolveChromePath() {
  try {
    const puppeteer = await import('puppeteer');
    return puppeteer.default.executablePath();
  } catch {
    return undefined;
  }
}

async function loadSites() {
  const raw = await readFile(join(projectRoot, 'sites.json'), 'utf8');
  const sites = JSON.parse(raw);
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error('sites.json must be a non-empty array');
  }
  for (const [i, s] of sites.entries()) {
    if (!s.name || !s.language || !s.page || !s.url) {
      throw new Error(`sites.json entry ${i} is missing name/language/page/url`);
    }
  }
  return sites;
}

function filterSitesByNames(sites, requestedNames) {
  if (requestedNames.length === 0) return sites;
  const wanted = new Set(requestedNames.map((n) => n.toLowerCase()));
  const available = new Set(sites.map((s) => s.name.toLowerCase()));
  const unknown = [...wanted].filter((n) => !available.has(n));
  if (unknown.length) {
    const availList = [...available].sort().join(', ');
    throw new Error(`Unknown site name(s): ${unknown.join(', ')}. Available: ${availList}`);
  }
  return sites.filter((s) => wanted.has(s.name.toLowerCase()));
}

const KNOWN_BOOL_FLAGS = new Set(['--mobile', '--desktop']);
const KNOWN_VALUE_FLAGS = new Set(['--page']);

function parseCliArgs(argv) {
  const brands = [];
  const presetFlags = new Set();
  const pageFilters = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      brands.push(a);
      continue;
    }
    const eqIdx = a.indexOf('=');
    const flagName = eqIdx >= 0 ? a.slice(0, eqIdx) : a;
    if (KNOWN_BOOL_FLAGS.has(flagName)) {
      if (eqIdx >= 0) throw new Error(`Flag ${flagName} does not take a value`);
      presetFlags.add(flagName.slice(2));
    } else if (KNOWN_VALUE_FLAGS.has(flagName)) {
      let value;
      if (eqIdx >= 0) {
        value = a.slice(eqIdx + 1);
      } else {
        value = argv[++i];
        if (value === undefined || value.startsWith('--')) {
          throw new Error(`Flag ${flagName} requires a value (e.g. ${flagName} home)`);
        }
      }
      for (const v of value.split(',')) {
        const trimmed = v.trim();
        if (trimmed) pageFilters.add(trimmed.toLowerCase());
      }
    } else {
      throw new Error(`Unknown flag: ${flagName}. Known flags: --mobile, --desktop, --page`);
    }
  }
  return { brands, presetFlags, pageFilters };
}

function filterPresets(presets, presetFlags) {
  if (presetFlags.size === 0) return presets;
  return presets.filter((p) => presetFlags.has(p.name));
}

function filterSitesByPages(sites, pageFilters) {
  if (pageFilters.size === 0) return sites;
  const available = new Set(sites.map((s) => s.page.toLowerCase()));
  const unknown = [...pageFilters].filter((p) => !available.has(p));
  if (unknown.length) {
    const availList = [...available].sort().join(', ');
    throw new Error(`Unknown page(s): ${unknown.join(', ')}. Available: ${availList}`);
  }
  return sites.filter((s) => pageFilters.has(s.page.toLowerCase()));
}

async function launchChrome(chromePath, preset) {
  return chromeLauncher.launch({
    chromePath,
    chromeFlags: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-agent=${preset.userAgent}`,
      '--lang=en-US',
      '--accept-lang=en-US,en;q=0.9',
    ],
  });
}

async function runAudit({ url, port, preset }) {
  const options = {
    logLevel: 'error',
    output: 'html',
    port,
    emulatedUserAgent: preset.userAgent,
    extraHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
  const result = await lighthouse(url, options, preset.config);
  if (!result) throw new Error('Lighthouse returned no result');
  return result;
}

async function auditWithFreshChrome({ url, preset, chromePath }) {
  const chrome = await launchChrome(chromePath, preset);
  try {
    return await runAudit({ url, port: chrome.port, preset });
  } finally {
    await chrome.kill();
  }
}

async function auditWithRetries({ site, preset, chromePath, label }) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS + 1; attempt++) {
    const suffix = attempt > 1 ? ` (retry ${attempt - 1}/${RETRY_ATTEMPTS})` : '';
    process.stdout.write(`${label}${suffix} ... `);
    const start = Date.now();
    try {
      const result = await auditWithFreshChrome({ url: site.url, preset, chromePath });
      const cats = result.lhr.categories;
      const perf = Math.round((cats.performance?.score ?? 0) * 100);
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      if (perf === 0 && attempt <= RETRY_ATTEMPTS) {
        console.log(`perf 0 (soft-fail, will retry in ${RETRY_BACKOFF_MS / 1000}s) (${secs}s)`);
        lastError = new Error('perf=0 (likely blocked or empty response)');
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      const a11y = Math.round((cats.accessibility?.score ?? 0) * 100);
      const bp = Math.round((cats['best-practices']?.score ?? 0) * 100);
      const seo = Math.round((cats.seo?.score ?? 0) * 100);
      const lcp = result.lhr.audits['largest-contentful-paint']?.displayValue ?? null;
      const cls = result.lhr.audits['cumulative-layout-shift']?.displayValue ?? null;
      const tbt = result.lhr.audits['total-blocking-time']?.displayValue ?? null;
      console.log(`perf ${perf}  LCP ${lcp ?? 'n/a'}  CLS ${cls ?? 'n/a'}  (${secs}s)`);
      return { ok: true, data: { perf, a11y, bestPractices: bp, seo, lcp, cls, tbt, report: result.report } };
    } catch (err) {
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      lastError = err;
      if (attempt <= RETRY_ATTEMPTS) {
        console.log(`FAILED (${secs}s) - ${err.message} (retrying in ${RETRY_BACKOFF_MS / 1000}s)`);
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      console.log(`FAILED (${secs}s) - ${err.message}`);
    }
  }
  return { ok: false, error: lastError };
}

async function main() {
  const { brands, presetFlags, pageFilters } = parseCliArgs(process.argv.slice(2));
  const allSites = await loadSites();
  const brandFiltered = filterSitesByNames(allSites, brands);
  const sites = filterSitesByPages(brandFiltered, pageFilters);
  const presets = filterPresets(PRESETS, presetFlags);
  if (sites.length === 0) {
    throw new Error('No entries remain after filters. Check your brand and --page values against sites.json.');
  }
  const runId = timestamp();
  const runFolder = join(projectRoot, 'reports', runId);
  await mkdir(runFolder, { recursive: true });
  console.log(`Reports folder: ${runFolder}`);
  if (brands.length) {
    const selected = [...new Set(sites.map((s) => s.name))].join(', ');
    console.log(`Brand filter:  ${selected}  (${sites.length}/${allSites.length} entries)`);
  }
  if (pageFilters.size) {
    console.log(`Page filter:   ${[...pageFilters].join(', ')}`);
  }
  if (presetFlags.size) {
    console.log(`Preset filter: ${presets.map((p) => p.name).join(', ')}`);
  }
  console.log();

  const chromePath = await resolveChromePath();
  if (chromePath) console.log(`Using Chromium at: ${chromePath}`);
  console.log(`Delay between audits: ${DELAY_BETWEEN_AUDITS_MS}ms  ·  retries per audit: ${RETRY_ATTEMPTS}\n`);

  const total = sites.length * presets.length;
  const summary = { runId, startedAt: new Date().toISOString(), sites: [] };
  let done = 0;
  const failures = [];

  for (const site of sites) {
    const siteRow = {
      name: site.name,
      language: site.language,
      page: site.page,
      url: site.url,
      mobile: null,
      desktop: null,
    };
    for (const preset of presets) {
      done += 1;
      const label = `[${done}/${total}] ${site.name}/${site.page}/${site.language}/${preset.name}`;
      const filename = `${sanitize(site.name)}-${sanitize(site.page)}-${sanitize(site.language)}-${preset.name}.html`;
      const outcome = await auditWithRetries({ site, preset, chromePath, label });
      if (outcome.ok) {
        const { report, ...metrics } = outcome.data;
        await writeFile(join(runFolder, filename), report);
        siteRow[preset.name] = { file: filename, ...metrics };
      } else {
        const errMsg = outcome.error?.message ?? 'unknown error';
        failures.push({ site: site.name, page: site.page, language: site.language, preset: preset.name, error: errMsg });
        siteRow[preset.name] = { file: null, error: errMsg };
      }
      if (done < total && DELAY_BETWEEN_AUDITS_MS > 0) {
        await sleep(DELAY_BETWEEN_AUDITS_MS);
      }
    }
    summary.sites.push(siteRow);
  }

  summary.finishedAt = new Date().toISOString();
  summary.failures = failures;
  await writeFile(join(runFolder, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\nDone. Reports saved to: ${runFolder}`);
  if (failures.length) {
    console.log(`\n${failures.length} audit(s) failed:`);
    for (const f of failures) {
      console.log(`  - ${f.site}/${f.page}/${f.language}/${f.preset}: ${f.error}`);
    }
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
