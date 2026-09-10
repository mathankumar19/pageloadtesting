import { readFile, writeFile, mkdir, readdir, copyFile, stat, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSites } from './load-sites.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportsRoot = join(projectRoot, 'reports');
const distRoot = join(projectRoot, 'dist');
const distReports = join(distRoot, 'reports');
const distRuns = join(distRoot, 'runs');
const sitesJsonPath = join(projectRoot, 'sites.json');

async function findAllCompletedRuns() {
  const entries = await readdir(reportsRoot, { withFileTypes: true });
  const runFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const runs = [];
  for (const runId of runFolders) {
    try {
      const summaryPath = join(reportsRoot, runId, 'summary.json');
      await stat(summaryPath);
      const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
      runs.push({ runId, summary });
    } catch {}
  }
  runs.reverse();
  return runs;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function scoreClass(score) {
  if (score == null) return 'na';
  if (score >= 90) return 'good';
  if (score >= 50) return 'avg';
  return 'poor';
}

function scoreCell(v) {
  return v == null
    ? '<td class="score na">—</td>'
    : `<td class="score ${scoreClass(v)}">${v}</td>`;
}

function cell(preset, runId, linkBase, reportPathBase) {
  if (!preset) {
    return '<td class="score na">—</td>'.repeat(4) + '<td class="link">—</td>';
  }
  if (preset.error) {
    return `<td class="score na" colspan="4" title="${escapeHtml(preset.error)}">error</td><td class="link">—</td>`;
  }
  const link = `${linkBase}${runId}/${escapeHtml(preset.file)}`;
  const reportPath = `${reportPathBase}${runId}/${preset.file}`;
  const pdfHref = `/api/pdf?path=${encodeURIComponent(reportPath)}`;
  return (
    scoreCell(preset.perf) +
    scoreCell(preset.a11y) +
    scoreCell(preset.bestPractices) +
    scoreCell(preset.seo) +
    `<td class="link">` +
      `<a href="${link}" target="_blank" rel="noopener">open ↗</a>` +
      ` <a href="${pdfHref}" class="pdf-link" data-pdf-report>PDF ↓</a>` +
    `</td>`
  );
}

const BASE_CSS = `
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px; max-width: 1400px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .nav { color: #666; margin-bottom: 4px; font-size: 13px; }
  .nav a { color: #0366d6; text-decoration: none; }
  .nav a:hover { text-decoration: underline; }
  .nav .sep { color: #ccc; margin: 0 8px; }
  .meta { color: #666; margin-bottom: 24px; font-size: 13px; }
  .fail { color: #b00020; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  thead th { text-align: left; background: #f5f5f5; padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #333; border-bottom: 2px solid #ddd; position: sticky; top: 0; }
  thead th.group { background: #ececec; text-align: center; border-left: 1px solid #ddd; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #eee; }
  tbody tr:hover { background: rgba(0,0,0,0.02); }
  td.name { font-weight: 600; }
  td.page { font-weight: 500; text-transform: capitalize; color: #333; }
  td.lang { color: #666; text-transform: uppercase; font-size: 12px; }
  td.url a { color: #0366d6; text-decoration: none; word-break: break-all; }
  td.url a:hover { text-decoration: underline; }
  td.score { text-align: center; font-weight: 700; font-size: 15px; border-left: 1px solid #eee; }
  td.score.good { color: #0a7c2f; }
  td.score.avg  { color: #b26a00; }
  td.score.poor { color: #c62828; }
  td.score.na   { color: #999; }
  td.metric { text-align: right; color: #444; font-size: 13px; }
  td.link { white-space: nowrap; }
  td.link a { color: #0366d6; text-decoration: none; font-size: 13px; margin-right: 6px; }
  td.link a:hover { text-decoration: underline; }
  td.link a.pdf-link { color: #6a3d99; }
  button.pdf-btn { background: #f1f3f5; border: 1px solid #d4d4d8; border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; color: #333; margin-left: 8px; }
  button.pdf-btn:hover { background: #e8ebee; }
  @media print {
    body { padding: 12px; max-width: none; color: #000; background: #fff; }
    .nav, button.pdf-btn, .pdf-link { display: none !important; }
    a[href] { color: inherit; text-decoration: none; }
    thead th { position: static; background: #f5f5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th.group { background: #ececec !important; }
    tbody tr:hover { background: transparent; }
    tbody td { padding: 6px 8px; }
    td.score { font-size: 13px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td.url a { color: inherit; word-break: break-all; }
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0e0e10; color: #e6e6e6; }
    .nav, .meta { color: #999; }
    .nav .sep { color: #444; }
    .nav a, td.url a, td.link a { color: #6cb6ff; }
    thead th { background: #1a1a1d; color: #ccc; border-bottom-color: #333; }
    thead th.group { background: #202024; }
    tbody td { border-bottom-color: #222; }
    tbody tr:hover { background: rgba(255,255,255,0.03); }
    td.page { color: #ddd; }
    td.score.good { color: #4cd07d; }
    td.score.avg  { color: #f0b850; }
    td.score.poor { color: #ff6b6b; }
    td.score.na   { color: #666; }
    td.metric { color: #bbb; }
  }
`;

function navBar({ active, depth, runCount }) {
  const prefix = '../'.repeat(depth);
  const items = [
    { key: 'control', label: 'Control',              href: `${prefix}control` },
    { key: 'history', label: `All runs (${runCount})`, href: `${prefix}history.html` },
    { key: 'latest',  label: 'Latest',               href: `${prefix}index.html` },
  ];
  const linksHtml = items
    .map((it) => (it.key === active ? `<b>${it.label}</b>` : `<a href="${it.href}">${it.label}</a>`))
    .join('<span class="sep">·</span>');
  return `<div class="nav">${linksHtml}<button type="button" class="pdf-btn" onclick="window.print()">Download PDF</button></div>`;
}

const PDF_LINK_SCRIPT = `
<script>
(() => {
  // The per-report /api/pdf endpoint only exists when the local dev server is running.
  // On any other host (e.g. a Netlify deploy of dist/), hide the PDF ↓ links.
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname) || location.hostname.endsWith('.local');
  if (!isLocal) {
    for (const el of document.querySelectorAll('[data-pdf-report]')) el.remove();
  }
})();
</script>
`;

function renderRunDashboard(summary, opts) {
  const { linkBase, active, depth, runCount } = opts;
  // PDF endpoint is server-hosted, always addressed by path-relative-to-dist.
  const reportPathBase = 'reports/';
  const rows = summary.sites.map((s) => `
    <tr>
      <td class="name">${escapeHtml(s.name)}</td>
      <td class="page">${escapeHtml(s.page ?? '—')}</td>
      <td class="lang">${escapeHtml(s.language)}</td>
      <td class="url"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a></td>
      ${cell(s.mobile, summary.runId, linkBase, reportPathBase)}
      ${cell(s.desktop, summary.runId, linkBase, reportPathBase)}
    </tr>`).join('');

  const failedCount = summary.failures?.length ?? 0;
  const startedAt = new Date(summary.startedAt).toLocaleString();
  const finishedAt = new Date(summary.finishedAt).toLocaleString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lighthouse Reports — ${escapeHtml(summary.runId)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
  <h1>Lighthouse Reports</h1>
  ${navBar({ active, depth, runCount })}
  <div class="meta">
    Run <b>${escapeHtml(summary.runId)}</b> · started ${escapeHtml(startedAt)} · finished ${escapeHtml(finishedAt)}
    ${failedCount ? `· <span class="fail">${failedCount} audit(s) failed</span>` : ''}
  </div>
  <table>
    <thead>
      <tr>
        <th rowspan="2">Site</th>
        <th rowspan="2">Page</th>
        <th rowspan="2">Lang</th>
        <th rowspan="2">URL</th>
        <th class="group" colspan="5">Mobile</th>
        <th class="group" colspan="5">Desktop</th>
      </tr>
      <tr>
        <th class="group" title="Performance">Perf</th><th class="group" title="Accessibility">Access.</th><th class="group" title="Best Practices">Best Prac.</th><th class="group" title="SEO">SEO</th><th class="group">Report</th>
        <th class="group" title="Performance">Perf</th><th class="group" title="Accessibility">Access.</th><th class="group" title="Best Practices">Best Prac.</th><th class="group" title="SEO">SEO</th><th class="group">Report</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  ${PDF_LINK_SCRIPT}
</body>
</html>
`;
}

function formatDuration(startIso, endIso) {
  const secs = Math.round((new Date(endIso) - new Date(startIso)) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function renderHistoryPage(runs) {
  const rows = runs.map(({ runId, summary }, i) => {
    const started = new Date(summary.startedAt).toLocaleString();
    const duration = formatDuration(summary.startedAt, summary.finishedAt);
    const siteCount = summary.sites.length;
    const failedCount = summary.failures?.length ?? 0;
    const latestBadge = i === 0 ? ' <b style="color:#0a7c2f">(latest)</b>' : '';
    const failCell = failedCount
      ? `<td class="score poor">${failedCount} failed</td>`
      : `<td class="score good">ok</td>`;
    return `
    <tr>
      <td class="name"><a href="runs/${escapeHtml(runId)}/index.html">${escapeHtml(runId)}</a>${latestBadge}</td>
      <td>${escapeHtml(started)}</td>
      <td>${escapeHtml(duration)}</td>
      <td class="metric">${siteCount}</td>
      ${failCell}
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lighthouse Reports — History</title>
<style>${BASE_CSS}</style>
</head>
<body>
  <h1>Lighthouse Reports — History</h1>
  ${navBar({ active: 'history', depth: 0, runCount: runs.length })}
  <div class="meta">${runs.length} completed run(s), newest first.</div>
  <table>
    <thead>
      <tr>
        <th>Run ID</th>
        <th>Started</th>
        <th>Duration</th>
        <th style="text-align:right">Sites</th>
        <th style="text-align:center">Status</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  ${PDF_LINK_SCRIPT}
</body>
</html>
`;
}

async function pruneStale(dir, validIds) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (validIds.has(e.name)) continue;
    await rm(join(dir, e.name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

async function copyRunFolder(runId) {
  const src = join(reportsRoot, runId);
  const dst = join(distReports, runId);
  try {
    await stat(dst);
    return false;
  } catch {}
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src);
  for (const name of entries) {
    if (name.endsWith('.html')) {
      await copyFile(join(src, name), join(dst, name));
    }
  }
  return true;
}

function renderStaticControlPage(sites, runCount) {
  const brands    = [...new Set(sites.map(s => s.name))];
  const pages     = [...new Set(sites.map(s => s.page))];
  const languages = [...new Set(sites.map(s => s.language))];
  const presets   = ['mobile', 'desktop'];
  const inlineData = JSON.stringify({ sites, brands, pages, languages, presets });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Control · Lighthouse</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px; max-width: 1000px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .nav { color: #666; margin-bottom: 24px; font-size: 13px; }
  .nav a { color: #0366d6; text-decoration: none; }
  .nav a:hover { text-decoration: underline; }
  .nav .sep { color: #ccc; margin: 0 8px; }
  .banner { border: 1px solid #f0b850; background: #fff8e1; color: #7a5900; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; }
  .banner code { background: rgba(0,0,0,0.08); padding: 1px 6px; border-radius: 4px; font: 12px ui-monospace, "SF Mono", Consolas, monospace; }
  section.filter { border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  section.filter h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; display: flex; justify-content: space-between; align-items: center; }
  .quicklinks { font-weight: 400; font-size: 12px; text-transform: none; letter-spacing: 0; }
  .quicklinks a { color: #0366d6; text-decoration: none; margin-left: 8px; }
  .quicklinks a:hover { text-decoration: underline; }
  .checkboxes { display: flex; flex-wrap: wrap; gap: 6px 10px; }
  .checkboxes label { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid #d4d4d8; border-radius: 6px; cursor: pointer; user-select: none; font-size: 13px; }
  .checkboxes label.on { background: #eff6ff; border-color: #93c5fd; }
  .checkboxes input { margin: 0; }
  .estimate { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 16px; background: #f6f8fa; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
  .estimate b { font-size: 15px; }
  .estimate .warn { color: #b26a00; }
  .estimate .bad { color: #c62828; }
  .cmd-row { display: flex; gap: 8px; align-items: stretch; }
  pre#cmd { flex: 1; margin: 0; background: #0e0e10; color: #e6e6e6; border-radius: 8px; padding: 14px 16px; font: 13px/1.5 ui-monospace, "SF Mono", Consolas, monospace; white-space: pre-wrap; word-break: break-word; overflow: auto; }
  button#copy { background: #0366d6; color: #fff; border: 0; border-radius: 6px; padding: 0 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
  button#copy:hover { background: #0357b8; }
  button#copy.ok { background: #0a7c2f; }
  #copyStatus { margin-top: 8px; font-size: 12px; color: #666; min-height: 16px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0e0e10; color: #e6e6e6; }
    .nav, section.filter h3, #copyStatus { color: #999; }
    .nav .sep { color: #444; }
    .nav a, .quicklinks a { color: #6cb6ff; }
    .banner { background: #2a2200; color: #f0d060; border-color: #6a5200; }
    .banner code { background: rgba(255,255,255,0.08); }
    section.filter { border-color: #2a2a2e; }
    .checkboxes label { border-color: #2a2a2e; }
    .checkboxes label.on { background: #17293a; border-color: #2b5c95; }
    .estimate { background: #1a1a1d; }
    .estimate .warn { color: #f0b850; }
    .estimate .bad { color: #ff6b6b; }
    pre#cmd { background: #000; }
  }
</style>
</head>
<body>
  <h1>Plan a Lighthouse scan</h1>
  <div class="nav">
    <b>Control</b>
    <span class="sep">·</span><a href="history.html">All runs (${runCount})</a>
    <span class="sep">·</span><a href="index.html">Latest</a>
  </div>

  <div class="banner">
    Scans run on your machine, not on this deployment. Pick filters below and copy the CLI command, then run it locally. To use the interactive runner, run <code>npm run serve</code> and open <code>http://localhost:5005/control</code>.
  </div>

  <section class="filter">
    <h3>Brands <span class="quicklinks"><a href="#" data-all="brand">All</a><a href="#" data-none="brand">None</a></span></h3>
    <div class="checkboxes" id="brands"></div>
  </section>

  <section class="filter">
    <h3>Pages <span class="quicklinks"><a href="#" data-all="page">All</a><a href="#" data-none="page">None</a></span></h3>
    <div class="checkboxes" id="pages"></div>
  </section>

  <section class="filter">
    <h3>Languages <span class="quicklinks"><a href="#" data-all="lang">All</a><a href="#" data-none="lang">None</a></span></h3>
    <div class="checkboxes" id="languages"></div>
  </section>

  <section class="filter">
    <h3>Presets <span class="quicklinks"><a href="#" data-all="preset">All</a></span></h3>
    <div class="checkboxes" id="presets"></div>
  </section>

  <div class="estimate">
    <div>Selected: <b id="auditCount">—</b> audits &nbsp;<span id="breakdown"></span></div>
    <div>Estimated: <b id="timeEst">—</b></div>
  </div>

  <div class="cmd-row">
    <pre id="cmd">npm run report</pre>
    <button id="copy" type="button">Copy</button>
  </div>
  <div id="copyStatus"></div>

<script>
(() => {
  const AUDIT_SECS = 75;
  const DELAY_SECS = 12;
  const DATA = ${inlineData};
  const { sites, brands, pages, languages, presets } = DATA;

  function makeBoxes(container, values, group) {
    for (const v of values) {
      const id = group + '-' + v;
      const label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" name="' + group + '" value="' + v + '" id="' + id + '" checked><span>' + v + '</span>';
      container.appendChild(label);
    }
  }
  makeBoxes(document.getElementById('brands'),    brands,    'brand');
  makeBoxes(document.getElementById('pages'),     pages,     'page');
  makeBoxes(document.getElementById('languages'), languages, 'lang');
  makeBoxes(document.getElementById('presets'),   presets,   'preset');

  const selectedValues = (group) =>
    [...document.querySelectorAll('input[name="' + group + '"]:checked')].map(el => el.value);

  function buildCommand(b, p, lg, pr) {
    const parts = ['npm', 'run', 'report', '--'];
    if (b.length && b.length !== brands.length) parts.push(...b);
    for (const preset of pr) if (preset === 'mobile' || preset === 'desktop') parts.push('--' + preset);
    if (p.length && p.length !== pages.length) parts.push('--page', p.join(','));
    if (lg.length && lg.length !== languages.length) parts.push('--lang', lg.join(','));
    if (parts.length === 4) return 'npm run report';
    return parts.join(' ');
  }

  function refresh() {
    for (const cb of document.querySelectorAll('.checkboxes input')) {
      cb.closest('label').classList.toggle('on', cb.checked);
    }
    const b = selectedValues('brand');
    const p = selectedValues('page');
    const lg = selectedValues('lang');
    const pr = selectedValues('preset');
    const bSet = new Set(b), pSet = new Set(p), lgSet = new Set(lg);
    const filtered = sites.filter(s => bSet.has(s.name) && pSet.has(s.page) && lgSet.has(s.language));
    const audits = filtered.length * pr.length;
    document.getElementById('auditCount').textContent = audits;
    document.getElementById('breakdown').textContent =
      '(' + b.length + ' brand' + (b.length===1?'':'s') + ' × ' +
      p.length + ' page' + (p.length===1?'':'s') + ' × ' +
      lg.length + ' lang' + (lg.length===1?'':'s') + ' × ' +
      pr.length + ' preset' + (pr.length===1?'':'s') + ')';
    const totalSecs = audits > 0 ? audits * AUDIT_SECS + (audits - 1) * DELAY_SECS : 0;
    document.getElementById('timeEst').textContent =
      audits === 0 ? '—' : totalSecs < 90 ? '~' + Math.round(totalSecs) + 's' : '~' + Math.round(totalSecs / 60) + ' min';
    const est = document.querySelector('.estimate b#timeEst');
    est.className = totalSecs > 15 * 60 ? 'bad' : totalSecs > 5 * 60 ? 'warn' : '';
    document.getElementById('cmd').textContent = buildCommand(b, p, lg, pr);
  }

  document.querySelectorAll('.checkboxes input').forEach(cb => cb.addEventListener('change', refresh));
  document.querySelectorAll('[data-all]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('input[name="' + a.dataset.all + '"]').forEach(cb => cb.checked = true);
    refresh();
  }));
  document.querySelectorAll('[data-none]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('input[name="' + a.dataset.none + '"]').forEach(cb => cb.checked = false);
    refresh();
  }));

  const copyBtn = document.getElementById('copy');
  const copyStatus = document.getElementById('copyStatus');
  copyBtn.addEventListener('click', async () => {
    const text = document.getElementById('cmd').textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add('ok');
      copyBtn.textContent = 'Copied';
      copyStatus.textContent = 'Paste this into a terminal in your project folder.';
      setTimeout(() => { copyBtn.classList.remove('ok'); copyBtn.textContent = 'Copy'; }, 1500);
    } catch (e) {
      copyStatus.textContent = 'Copy failed — select the command and copy manually.';
    }
  });

  refresh();
})();
</script>
</body>
</html>
`;
}

async function main() {
  const runs = await findAllCompletedRuns();
  if (runs.length === 0) {
    throw new Error(`No completed runs (with summary.json) found in ${reportsRoot}`);
  }

  await mkdir(distRoot, { recursive: true });
  await mkdir(distReports, { recursive: true });
  await mkdir(distRuns, { recursive: true });

  const validIds = new Set(runs.map((r) => r.runId));
  const prunedReports = await pruneStale(distReports, validIds);
  const prunedRuns = await pruneStale(distRuns, validIds);
  if (prunedReports > 0 || prunedRuns > 0) {
    console.log(`Pruned ${prunedReports} stale report folder(s) and ${prunedRuns} stale per-run dashboard(s)`);
  }

  let copied = 0;
  for (const { runId, summary } of runs) {
    if (await copyRunFolder(runId)) copied++;
    const perRunHtml = renderRunDashboard(summary, {
      linkBase: '../../reports/',
      active: null,
      depth: 2,
      runCount: runs.length,
    });
    const perRunFolder = join(distRuns, runId);
    await mkdir(perRunFolder, { recursive: true });
    await writeFile(join(perRunFolder, 'index.html'), perRunHtml);
  }

  const latest = runs[0];
  const latestHtml = renderRunDashboard(latest.summary, {
    linkBase: 'reports/',
    active: 'latest',
    depth: 0,
    runCount: runs.length,
  });
  await writeFile(join(distRoot, 'index.html'), latestHtml);
  await writeFile(join(distRoot, 'history.html'), renderHistoryPage(runs));

  try {
    const sites = await loadSites(sitesJsonPath);
    await writeFile(join(distRoot, 'control.html'), renderStaticControlPage(sites, runs.length));
    console.log(`Built dist/control.html (${sites.length} site entries)`);
  } catch (e) {
    console.warn(`Skipped dist/control.html — could not load sites.json: ${e.message}`);
  }

  const s = await stat(join(distRoot, 'index.html'));
  console.log(`Built dist/index.html (${s.size} bytes) — latest run ${latest.runId}`);
  console.log(`Built dist/history.html and ${runs.length} per-run dashboard(s) at dist/runs/<runId>/`);
  if (copied > 0) console.log(`Copied raw reports for ${copied} new run(s)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
