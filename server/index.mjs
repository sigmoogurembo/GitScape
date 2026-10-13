import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDirectory, analyzeFiles } from './analyze.mjs';
import { demoRepository } from './demo.mjs';
import { findGitHubRepository, getGitHubStars } from './github.mjs';
import { importGitHubRepository } from './github-import.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const port = Number(process.env.GITSCAPE_PORT || 4173);
const host = '127.0.0.1';
let githubImports = 0;
const vite = production ? null : await (await import('vite')).createServer({ root: project, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
async function body(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 30 * 1024 * 1024) { const err = new Error('Import is too large. Limit: 30 MB.'); err.status = 413; throw err; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { const err = new Error('Invalid JSON request.'); err.status = 400; throw err; }
}
const server = http.createServer(async (req, res) => {
  const expectedHost = `${host}:${port}`;
  if (req.headers.host !== expectedHost && req.headers.host !== `localhost:${port}`) return json(res, 403, { error: 'GitScape is available on localhost only.' });
  if (req.headers.origin && ![`http://${expectedHost}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
  const pathname = new URL(req.url, `http://${expectedHost}`).pathname;
  try {
    if (pathname === '/api/demo' && req.method === 'GET') return json(res, 200, await demoRepository());
    if (pathname === '/api/github/import' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected application/json.' });
      const input = await body(req);
      if (githubImports >= 2) return json(res, 429, { error: 'Two GitHub imports are already running. Wait for a download to finish.' });
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', cancel);
      githubImports++;
      try {
        const repository = await importGitHubRepository(input.repository, { signal: controller.signal });
        if (!res.destroyed) return json(res, 200, repository);
        return;
      } finally {
        githubImports--;
        res.off('close', cancel);
      }
    }
    if (pathname === '/api/github' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected application/json.' });
      const input = await body(req);
      return json(res, 200, await getGitHubStars(input.repository));
    }
    if (pathname === '/api/analyze' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected application/json.' });
      const input = await body(req);
      if (typeof input.path !== 'string' || !input.path.trim()) return json(res, 400, { error: 'Enter an absolute path to your repository.' });
      if (!path.isAbsolute(input.path)) return json(res, 400, { error: 'Repository path must be absolute.' });
      const repository = await analyzeDirectory(input.path.trim());
      repository.githubRepository = await findGitHubRepository(repository.root);
      return json(res, 200, repository);
    }
    if (pathname === '/api/import' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected application/json.' });
      const input = await body(req);
      if (!Array.isArray(input.files) || input.files.length > 10000) return json(res, 400, { error: 'Invalid file list. Maximum: 10,000 entries before filtering.' });
      return json(res, 200, await analyzeFiles(input.files, { name: String(input.name || 'Imported repository').slice(0, 200), source: 'folder' }));
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown endpoint.' });
    if (vite) return vite.middlewares(req, res, () => { res.writeHead(404); res.end('Not found'); });
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    let file = path.resolve(project, 'dist', relative);
    if (!file.startsWith(path.join(project, 'dist') + path.sep) && file !== path.join(project, 'dist')) return json(res, 403, { error: 'Invalid path.' });
    try { if (!(await fs.stat(file)).isFile()) file = path.join(project, 'dist', 'index.html'); } catch { file = path.join(project, 'dist', 'index.html'); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(await fs.readFile(file));
  } catch (error) { if (!res.destroyed) json(res, error.status || 400, { error: error.message || 'Unable to read this repository.' }); }
});
server.listen(port, host, () => console.log(`GitScape ready: http://${host}:${port}\nLocal analysis only. Your code stays on this machine.`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
async function stop() { await vite?.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
