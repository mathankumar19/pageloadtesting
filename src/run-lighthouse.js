import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PRESETS = [
  { name: 'mobile', config: undefined },
  { name: 'desktop', config: desktopConfig },
];

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sanitize(part) {
  return String(part).replace(/[^A-Za-z0-9._-]+/g, '_');
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
    if (!s.name || !s.language || !s.url) {
      throw new Error(`sites.json entry ${i} is missing name/language/url`);
    }
  }
  return sites;
}

async function runAudit({ url, port, preset }) {
  const options = { logLevel: 'error', output: 'html', port };
  const result = await lighthouse(url, options, preset.config);
  if (!result) throw new Error('Lighthouse returned no result');
  return result;
}

async function main() {
  const sites = await loadSites();
  const runId = timestamp();
  const runFolder = join(projectRoot, 'reports', runId);
  await mkdir(runFolder, { recursive: true });
  console.log(`Reports folder: ${runFolder}\n`);

  const chromePath = await resolveChromePath();
  if (chromePath) console.log(`Using Chromium at: ${chromePath}`);
  const chrome = await chromeLauncher.launch({
    chromePath,
    chromeFlags: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
  });
  console.log(`Chrome launched on port ${chrome.port}\n`);

  const total = sites.length * PRESETS.length;
  const summary = {
    runId,
    startedAt: new Date().toISOString(),
    sites: [],
  };
  let done = 0;
  const failures = [];

  try {
    for (const site of sites) {
      const siteRow = {
        name: site.name,
        language: site.language,
        url: site.url,
        mobile: null,
        desktop: null,
      };
      for (const preset of PRESETS) {
        done += 1;
        const label = `[${done}/${total}] ${site.name}/${site.language}/${preset.name}`;
        process.stdout.write(`${label} ... `);
        const start = Date.now();
        const filename = `${sanitize(site.name)}-${sanitize(site.language)}-${preset.name}.html`;
        try {
          const result = await runAudit({ url: site.url, port: chrome.port, preset });
          const cats = result.lhr.categories;
          const perf = Math.round((cats.performance?.score ?? 0) * 100);
          const a11y = Math.round((cats.accessibility?.score ?? 0) * 100);
          const bp = Math.round((cats['best-practices']?.score ?? 0) * 100);
          const seo = Math.round((cats.seo?.score ?? 0) * 100);
          const lcp = result.lhr.audits['largest-contentful-paint']?.displayValue ?? null;
          const cls = result.lhr.audits['cumulative-layout-shift']?.displayValue ?? null;
          const tbt = result.lhr.audits['total-blocking-time']?.displayValue ?? null;
          await writeFile(join(runFolder, filename), result.report);
          const secs = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`perf ${perf}  LCP ${lcp ?? 'n/a'}  CLS ${cls ?? 'n/a'}  (${secs}s)`);
          siteRow[preset.name] = { file: filename, perf, a11y, bestPractices: bp, seo, lcp, cls, tbt };
        } catch (err) {
          const secs = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`FAILED (${secs}s) - ${err.message}`);
          failures.push({ site: site.name, language: site.language, preset: preset.name, error: err.message });
          siteRow[preset.name] = { file: null, error: err.message };
        }
      }
      summary.sites.push(siteRow);
    }
  } finally {
    await chrome.kill();
  }

  summary.finishedAt = new Date().toISOString();
  summary.failures = failures;
  await writeFile(join(runFolder, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\nDone. Reports saved to: ${runFolder}`);
  if (failures.length) {
    console.log(`\n${failures.length} audit(s) failed:`);
    for (const f of failures) {
      console.log(`  - ${f.site}/${f.language}/${f.preset}: ${f.error}`);
    }
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
