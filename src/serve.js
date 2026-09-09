import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 5005);

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(projectRoot, 'dist');
const distRuns = join(distRoot, 'runs');
const controlUiPath = join(projectRoot, 'src', 'control-ui.html');
const sitesJsonPath = join(projectRoot, 'sites.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
};

let currentJob = null;

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('invalid JSON: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

function buildRunArgs({ brands = [], pages = [], presets = [] }) {
  const args = ['src/run-lighthouse.js'];
  for (const b of brands) args.push(String(b));
  for (const p of presets) {
    if (p === 'mobile' || p === 'desktop') args.push(`--${p}`);
  }
  if (pages.length) {
    args.push('--page', pages.map(String).join(','));
  }
  return args;
}

function broadcast(job, line) {
  job.log.push(line);
  if (job.log.length > 5000) job.log.splice(0, job.log.length - 5000);
  for (const res of job.sseClients) {
    try {
      res.write(`event: log\ndata: ${line.replace(/\r?\n/g, '\\n')}\n\n`);
    } catch {}
  }
}

function finish(job, exitCode) {
  job.done = true;
  job.exitCode = exitCode;
  const payload = JSON.stringify({ exitCode });
  for (const res of job.sseClients) {
    try {
      res.write(`event: done\ndata: ${payload}\n\n`);
      res.end();
    } catch {}
  }
  job.sseClients.clear();
}

function pipeChildOutput(child, job) {
  const handle = (buf) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.length) broadcast(job, line);
    }
  };
  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
}

function startRun(filters) {
  if (currentJob && !currentJob.done) {
    return { ok: false, error: 'A scan is already in progress.' };
  }
  const args = buildRunArgs(filters);
  const job = {
    id: Date.now().toString(36),
    args,
    log: [],
    sseClients: new Set(),
    done: false,
    exitCode: null,
    startedAt: new Date().toISOString(),
  };
  currentJob = job;

  broadcast(job, `$ node ${args.join(' ')}`);
  const report = spawn(process.execPath, args, { cwd: projectRoot, env: process.env });
  pipeChildOutput(report, job);

  report.on('error', (err) => {
    broadcast(job, `spawn error: ${err.message}`);
    finish(job, -1);
  });

  report.on('exit', (reportCode) => {
    broadcast(job, `[report exit ${reportCode}]`);
    broadcast(job, '$ node src/build-dashboard.js');
    const dash = spawn(process.execPath, ['src/build-dashboard.js'], { cwd: projectRoot, env: process.env });
    pipeChildOutput(dash, job);
    dash.on('error', (err) => {
      broadcast(job, `dashboard spawn error: ${err.message}`);
      finish(job, reportCode ?? -1);
    });
    dash.on('exit', (dashCode) => {
      broadcast(job, `[dashboard exit ${dashCode}]`);
      finish(job, dashCode === 0 ? (reportCode ?? 0) : (dashCode ?? -1));
    });
  });

  return { ok: true, id: job.id };
}

async function handleSSE(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  if (!currentJob) {
    res.write('event: done\ndata: {"exitCode":null,"note":"no job"}\n\n');
    res.end();
    return;
  }
  const job = currentJob;
  for (const line of job.log) {
    res.write(`event: log\ndata: ${line.replace(/\r?\n/g, '\\n')}\n\n`);
  }
  if (job.done) {
    res.write(`event: done\ndata: ${JSON.stringify({ exitCode: job.exitCode })}\n\n`);
    res.end();
    return;
  }
  job.sseClients.add(res);
  req.on('close', () => job.sseClients.delete(res));
}

async function countBuiltRuns() {
  try {
    const entries = await readdir(distRuns, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function handleConfig(res) {
  try {
    const sites = JSON.parse(await readFile(sitesJsonPath, 'utf8'));
    const alreadyRunning = currentJob && !currentJob.done
      ? { id: currentJob.id, args: currentJob.args, log: currentJob.log.slice() }
      : null;
    json(res, 200, {
      sites,
      presets: ['mobile', 'desktop'],
      runCount: await countBuiltRuns(),
      alreadyRunning,
    });
  } catch (e) {
    json(res, 500, { error: `Failed to read sites.json: ${e.message}` });
  }
}

async function handleRun(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return json(res, 400, { error: e.message }); }
  const result = startRun({
    brands: Array.isArray(body.brands) ? body.brands : [],
    pages: Array.isArray(body.pages) ? body.pages : [],
    presets: Array.isArray(body.presets) ? body.presets : [],
  });
  if (!result.ok) return json(res, 409, { error: result.error });
  json(res, 200, { id: result.id });
}

async function resolveStaticFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const safe = clean.replace(/\.\.+/g, '.');
  let filePath = join(distRoot, safe);
  if (!filePath.startsWith(distRoot)) return null;
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
    return filePath;
  } catch {
    return null;
  }
}

async function serveStatic(req, res) {
  const filePath = await resolveStaticFile(req.url ?? '/');
  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (url === '/control' || url === '/control/') {
    try {
      const html = await readFile(controlUiPath);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('control-ui.html missing: ' + e.message);
    }
    return;
  }

  if (url === '/api/config' && req.method === 'GET') return handleConfig(res);
  if (url === '/api/run' && req.method === 'POST') return handleRun(req, res);
  if (url === '/api/stream' && req.method === 'GET') return handleSSE(req, res);
  if (url === '/api/status' && req.method === 'GET') {
    return json(res, 200, currentJob
      ? { id: currentJob.id, done: currentJob.done, exitCode: currentJob.exitCode, lines: currentJob.log.length }
      : { id: null, done: null });
  }

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Dashboard served at http://localhost:${PORT}/`);
  console.log(`Control UI at   http://localhost:${PORT}/control`);
  console.log(`Serving from ${distRoot}`);
});
