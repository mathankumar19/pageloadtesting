import { readFile, writeFile, mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportsRoot = join(projectRoot, 'reports');
const distRoot = join(projectRoot, 'dist');
const distReports = join(distRoot, 'reports');

async function findLatestRun() {
  const entries = await readdir(reportsRoot, { withFileTypes: true });
  const runFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (runFolders.length === 0) throw new Error(`No runs found in ${reportsRoot}`);
  return runFolders[runFolders.length - 1];
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

function cell(preset, runId) {
  if (!preset) return '<td class="score na">—</td><td class="metric">—</td><td class="metric">—</td><td class="link">—</td>';
  if (preset.error) return `<td class="score na" colspan="3" title="${escapeHtml(preset.error)}">error</td><td class="link">—</td>`;
  const link = `reports/${runId}/${escapeHtml(preset.file)}`;
  return (
    `<td class="score ${scoreClass(preset.perf)}">${preset.perf}</td>` +
    `<td class="metric">${escapeHtml(preset.lcp ?? '—')}</td>` +
    `<td class="metric">${escapeHtml(preset.cls ?? '—')}</td>` +
    `<td class="link"><a href="${link}" target="_blank" rel="noopener">open ↗</a></td>`
  );
}

function renderHtml(summary) {
  const rows = summary.sites.map((s) => `
    <tr>
      <td class="name">${escapeHtml(s.name)}</td>
      <td class="lang">${escapeHtml(s.language)}</td>
      <td class="url"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a></td>
      ${cell(s.mobile, summary.runId)}
      ${cell(s.desktop, summary.runId)}
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
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px; max-width: 1400px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .meta { color: #666; margin-bottom: 24px; font-size: 13px; }
  .fail { color: #b00020; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  thead th { text-align: left; background: #f5f5f5; padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #333; border-bottom: 2px solid #ddd; position: sticky; top: 0; }
  thead th.group { background: #ececec; text-align: center; border-left: 1px solid #ddd; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #eee; }
  tbody tr:hover { background: rgba(0,0,0,0.02); }
  td.name { font-weight: 600; }
  td.lang { color: #666; text-transform: uppercase; font-size: 12px; }
  td.url a { color: #0366d6; text-decoration: none; word-break: break-all; }
  td.url a:hover { text-decoration: underline; }
  td.score { text-align: center; font-weight: 700; font-size: 15px; border-left: 1px solid #eee; }
  td.score.good { color: #0a7c2f; }
  td.score.avg  { color: #b26a00; }
  td.score.poor { color: #c62828; }
  td.score.na   { color: #999; }
  td.metric { text-align: right; color: #444; font-size: 13px; }
  td.link a { color: #0366d6; text-decoration: none; font-size: 13px; }
  td.link a:hover { text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    body { background: #0e0e10; color: #e6e6e6; }
    .meta { color: #999; }
    thead th { background: #1a1a1d; color: #ccc; border-bottom-color: #333; }
    thead th.group { background: #202024; }
    tbody td { border-bottom-color: #222; }
    tbody tr:hover { background: rgba(255,255,255,0.03); }
    td.url a, td.link a { color: #6cb6ff; }
    td.score.good { color: #4cd07d; }
    td.score.avg  { color: #f0b850; }
    td.score.poor { color: #ff6b6b; }
    td.score.na   { color: #666; }
    td.metric { color: #bbb; }
  }
</style>
</head>
<body>
  <h1>Lighthouse Reports</h1>
  <div class="meta">
    Run <b>${escapeHtml(summary.runId)}</b> · started ${escapeHtml(startedAt)} · finished ${escapeHtml(finishedAt)}
    ${failedCount ? `· <span class="fail">${failedCount} audit(s) failed</span>` : ''}
  </div>
  <table>
    <thead>
      <tr>
        <th rowspan="2">Site</th>
        <th rowspan="2">Lang</th>
        <th rowspan="2">URL</th>
        <th class="group" colspan="4">Mobile</th>
        <th class="group" colspan="4">Desktop</th>
      </tr>
      <tr>
        <th class="group">Perf</th><th class="group">LCP</th><th class="group">CLS</th><th class="group">Report</th>
        <th class="group">Perf</th><th class="group">LCP</th><th class="group">CLS</th><th class="group">Report</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</body>
</html>
`;
}

async function copyRunFolder(runId) {
  const src = join(reportsRoot, runId);
  const dst = join(distReports, runId);
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src);
  for (const name of entries) {
    if (name.endsWith('.html')) {
      await copyFile(join(src, name), join(dst, name));
    }
  }
}

async function main() {
  const runId = await findLatestRun();
  const summaryPath = join(reportsRoot, runId, 'summary.json');
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));

  await mkdir(distRoot, { recursive: true });
  await copyRunFolder(runId);
  await writeFile(join(distRoot, 'index.html'), renderHtml(summary));

  const s = await stat(join(distRoot, 'index.html'));
  console.log(`Built dist/index.html (${s.size} bytes) for run ${runId}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
