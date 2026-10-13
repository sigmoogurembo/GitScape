import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { importGitHubRepository, readRepositoryArchive } from '../server/github-import.mjs';

function tarBytes(entries) {
  const parts = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content || '');
    const header = new Header({ path: entry.path, type: entry.type || 'File', linkpath: entry.linkpath || '', size: content.length, mode: 0o644, mtime: new Date(0) });
    header.encode();
    parts.push(header.block, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const archive = entries => gzipSync(tarBytes(entries));
const sourceFiles = [
  { path: 'fixture-HEAD/src/main.ts', content: "import { value } from './value';\nexport const main = value;" },
  { path: 'fixture-HEAD/src/value.ts', content: 'export const value = 42;\n' },
];
const limits = extra => ({ compressed: 48 * 1024 * 1024, expanded: 192 * 1024 * 1024, entries: 100000, timeout: 60000, ...extra });

test('imports default-branch source and resolved links without Git or executing code', async () => {
  const calls = [];
  const result = await importGitHubRepository('https://github.com/example/project.git', {
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(archive(sourceFiles)); },
  });
  assert.equal(result.source, 'github');
  assert.equal(result.name, 'project');
  assert.equal(result.root, null);
  assert.deepEqual(result.files.map(file => file.path), ['src/main.ts', 'src/value.ts']);
  assert.equal(result.files[0].content, sourceFiles[0].content);
  assert.deepEqual(result.edges, [{ from: 'src/main.ts', to: 'src/value.ts' }]);
  assert.deepEqual(result.history, []);
  assert.equal(result.githubRepository.fullName, 'example/project');
  assert.equal(result.snapshot.ref, 'HEAD');
  assert.ok(result.warnings.some(note => note.includes('snapshot of the default branch')));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://codeload.github.com/example/project/tar.gz/HEAD');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('rejects arbitrary URLs before downloading anything', async () => {
  let calls = 0;
  for (const spec of ['http://127.0.0.1/private/repo', 'https://github.com.evil.invalid/owner/repo', 'owner/repo/../../secret', 'https://token@github.com/owner/repo']) {
    await assert.rejects(importGitHubRepository(spec, { fetchImpl: async () => { calls++; } }), { status: 400 });
  }
  assert.equal(calls, 0);
});

test('skips traversal, alternate roots, links, secrets, binaries and oversized files', async () => {
  const result = await readRepositoryArchive(new Response(archive([
    ...sourceFiles,
    { path: 'fixture-HEAD/../../outside.txt', content: 'escape' },
    { path: '/fixture-HEAD/absolute.txt', content: 'absolute' },
    { path: 'fixture-HEAD/C:/Windows/system.txt', content: 'drive' },
    { path: 'fixture-HEAD/back\\..\\..\\outside.txt', content: 'backslash traversal' },
    { path: 'another-root/injected.ts', content: 'extra root' },
    { path: 'fixture-HEAD/link.ts', type: 'SymbolicLink', linkpath: '../../outside' },
    { path: 'fixture-HEAD/hard.ts', type: 'Link', linkpath: '/outside' },
    { path: 'fixture-HEAD/.env', content: 'TOKEN=secret' },
    { path: 'fixture-HEAD/node_modules/dep/index.js', content: 'dependency' },
    { path: 'fixture-HEAD/blob.dat', content: Buffer.from([0, 1, 2]) },
    { path: 'fixture-HEAD/old-encoding.txt', content: Buffer.from([0xff]) },
    { path: 'fixture-HEAD/large.txt', content: 'x'.repeat(200 * 1024 + 1) },
    sourceFiles[0],
  ])).body);
  assert.deepEqual(result.files.map(file => file.path), ['src/main.ts', 'src/value.ts']);
  for (const reason of ['unsafe paths', 'links and special entries', 'potential secret', 'binary', 'non-UTF-8', 'larger than 200 KB', 'duplicate']) {
    assert.ok(result.warnings.some(note => note.includes(reason)), reason);
  }
});

test('caps analyzed files while reporting a partial city', async () => {
  const entries = Array.from({ length: 1803 }, (_, i) => ({ path: `fixture-HEAD/src/file-${i}.ts`, content: 'export const value = 1;' }));
  const result = await readRepositoryArchive(new Response(archive(entries)).body);
  assert.equal(result.files.length, 1800);
  assert.ok(result.warnings.some(note => note.includes('1,800 text files')));
});

test('caps retained text at 24 MB', async () => {
  const entries = Array.from({ length: 125 }, (_, i) => ({ path: `fixture-HEAD/file-${i}.txt`, content: 'x'.repeat(200 * 1024) }));
  const result = await readRepositoryArchive(new Response(archive(entries)).body);
  assert.ok(result.files.reduce((total, file) => total + Buffer.byteLength(file.content), 0) <= 24 * 1024 * 1024);
  assert.ok(result.files.length < entries.length);
  assert.ok(result.warnings.some(note => note.includes('24 MB')));
});

test('bounds compressed bytes, expanded bytes and entry counts', async () => {
  for (const options of [{ compressed: 1 }, { expanded: 512 }, { entries: 1 }]) {
    await assert.rejects(readRepositoryArchive(new Response(archive(sourceFiles)).body, { limits: limits(options) }), { status: 413 });
  }
});

test('rejects corrupt and truncated archives instead of returning a misleading city', async () => {
  const bytes = archive(sourceFiles);
  for (const input of [Buffer.from('not a tarball'), bytes.subarray(0, bytes.length - 12), gzipSync(tarBytes(sourceFiles).subarray(0, 520))]) {
    await assert.rejects(readRepositoryArchive(new Response(input).body), { status: 502 });
  }
});

test('reports missing/rate-limited/empty repositories and cancels oversized responses', async () => {
  for (const [status, expected] of [[404, 404], [403, 429], [429, 429], [500, 502], [302, 502]]) {
    await assert.rejects(importGitHubRepository('example/project', { fetchImpl: async () => new Response(null, { status }) }), { status: expected });
  }
  await assert.rejects(importGitHubRepository('example/project', {
    fetchImpl: async () => new Response(archive([{ path: 'fixture-HEAD/image.png', content: 'media' }])),
  }), { status: 422 });
  let cancelled = false;
  await assert.rejects(importGitHubRepository('example/project', {
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': String(49 * 1024 * 1024) } }),
  }), { status: 413 });
  assert.equal(cancelled, true);
});

test('cancels on client abort and times out both the fetch and streaming body', async () => {
  const waitingFetch = (_, { signal }) => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  const controller = new AbortController();
  const pending = importGitHubRepository('example/project', { fetchImpl: waitingFetch, signal: controller.signal });
  const assertion = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await assertion;
  await assert.rejects(importGitHubRepository('example/project', { fetchImpl: waitingFetch, limits: limits({ timeout: 10 }) }), { status: 504 });
  await assert.rejects(importGitHubRepository('example/project', {
    fetchImpl: async () => new Response(new ReadableStream()), limits: limits({ timeout: 10 }),
  }), { status: 504 });
});
