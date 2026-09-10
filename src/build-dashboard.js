import { readFile, writeFile, mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportsRoot = join(projectRoot, 'reports');
const distRoot = join(projectRoot, 'dist');
const distReports = join(distRoot, 'reports');
const distRuns = join(distRoot, 'runs');

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

async function main() {
  const runs = await findAllCompletedRuns();
  if (runs.length === 0) {
    throw new Error(`No completed runs (with summary.json) found in ${reportsRoot}`);
  }

  await mkdir(distRoot, { recursive: true });
  await mkdir(distReports, { recursive: true });
  await mkdir(distRuns, { recursive: true });

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

  const s = await stat(join(distRoot, 'index.html'));
  console.log(`Built dist/index.html (${s.size} bytes) — latest run ${latest.runId}`);
  console.log(`Built dist/history.html and ${runs.length} per-run dashboard(s) at dist/runs/<runId>/`);
  if (copied > 0) console.log(`Copied raw reports for ${copied} new run(s)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
