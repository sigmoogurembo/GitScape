import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Parser } from 'tar';
import { analyzeFiles, ANALYSIS_LIMITS, sourceSkipReason } from './analyze.mjs';
import { parseGitHubRepository } from './github.mjs';

const ARCHIVE_LIMITS = Object.freeze({ compressed: 48 * 1024 * 1024, expanded: 192 * 1024 * 1024, entries: 100000, timeout: 60000 });

function failure(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function byteLimit(maximum, message) {
  let bytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maximum ? failure(message, 413) : null, chunk);
    },
  });
}

function archivePath(value) {
  // GitHub archives have one enclosing directory. Never extract an entry to disk.
  if (typeof value !== 'string' || value.length > 4096 || /[\\\0:]/.test(value) || value.startsWith('/')) return null;
  const parts = value.split('/');
  if (parts.some(part => part === '..' || part === '.') || !parts[0]) return null;
  return { root: parts[0], path: parts.slice(1).join('/') };
}

/** Read a public GitHub tarball in memory; links and executable actions are never followed. */
export async function readRepositoryArchive(body, { signal, limits = ARCHIVE_LIMITS } = {}) {
  const files = [];
  const warnings = [];
  const skipped = new Map();
  const seen = new Set();
  let root = null, entries = 0, totalBytes = 0, limitedFiles = false, limitedBytes = false;
  const skip = reason => skipped.set(reason, (skipped.get(reason) || 0) + 1);
  const parser = new Parser({
    strict: true, maxMetaEntrySize: 64 * 1024,
    onReadEntry(entry) {
      entries++;
      if (entries > limits.entries) {
        entry.resume();
        parser.abort(failure('This repository contains too many archive entries. Open a local clone instead.', 413));
        return;
      }
      const location = archivePath(entry.path);
      if (!location || (root && location.root !== root)) { skip('unsafe paths'); entry.resume(); return; }
      root ||= location.root;
      if (entry.type === 'Directory') { entry.resume(); return; }
      if (entry.type !== 'File' && entry.type !== 'OldFile') { skip('links and special entries'); entry.resume(); return; }
      const filePath = location.path;
      if (!filePath || filePath.endsWith('/')) { skip('unsafe paths'); entry.resume(); return; }
      const reason = sourceSkipReason(filePath);
      if (reason) { if (reason !== 'ignored') skip(reason === 'secret' ? 'potential secret files' : `${reason} files`); entry.resume(); return; }
      if (seen.has(filePath)) { skip('duplicate paths'); entry.resume(); return; }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > ANALYSIS_LIMITS.fileBytes) { skip('files larger than 200 KB'); entry.resume(); return; }
      if (files.length >= ANALYSIS_LIMITS.files) { limitedFiles = true; entry.resume(); return; }
      if (totalBytes + entry.size > ANALYSIS_LIMITS.totalBytes) { limitedBytes = true; entry.resume(); return; }
      const chunks = [];
      entry.on('data', chunk => chunks.push(chunk));
      entry.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (bytes.includes(0)) { skip('binary files'); return; }
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { skip('non-UTF-8 files'); return; }
        seen.add(filePath);
        totalBytes += bytes.length;
        files.push({ path: filePath, content });
      });
      entry.resume();
    },
  });
  const compressed = byteLimit(limits.compressed, 'The GitHub archive exceeds the 48 MB download limit. Open a local clone instead.');
  const expanded = byteLimit(limits.expanded, 'The expanded GitHub archive exceeds 192 MB. Open a local clone instead.');
  try {
    await pipeline(Readable.fromWeb(body), compressed, createGunzip(), expanded, parser, { signal });
  } catch (error) {
    if (error.name === 'AbortError' || error.status) throw error;
    throw failure('GitHub returned an incomplete or unreadable source archive. Try again.');
  }
  if (limitedFiles) warnings.push('Analysis is limited to 1,800 text files; additional files were skipped.');
  if (limitedBytes) warnings.push('Analysis is limited to 24 MB of text content; additional files were skipped.');
  for (const [reason, count] of skipped) warnings.push(`Skipped ${count} ${reason}.`);
  return { files, warnings };
}

/** Download only the canonical codeload host. No Git installation, credentials, or clone is needed. */
export async function importGitHubRepository(spec, { fetchImpl = globalThis.fetch, signal, limits = ARCHIVE_LIMITS } = {}) {
  const identity = parseGitHubRepository(spec);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  let timedOut = false;
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limits.timeout);
  let response;
  try {
    // HEAD resolves to the default branch. The server never fetches a user-supplied host.
    const url = `https://codeload.github.com/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}/tar.gz/HEAD`;
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { 'User-Agent': 'GitScape', Accept: 'application/gzip' } });
    if (response.status === 404) throw failure('This public GitHub repository is unavailable or empty. Check the link; private repositories are not supported.', 404);
    if (response.status === 403 || response.status === 429) throw failure('GitHub has limited downloads. Try again later.', 429);
    if (!response.ok || !response.body) throw failure('GitHub could not provide a source archive. Try again later.');
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > limits.compressed) throw failure('The GitHub archive exceeds the 48 MB download limit. Open a local clone instead.', 413);
    const archive = await readRepositoryArchive(response.body, { signal: controller.signal, limits });
    if (!archive.files.length) throw failure('No supported text files were found in this repository.', 422);
    const result = await analyzeFiles(archive.files, { name: identity.repo, source: 'github' });
    result.githubRepository = identity;
    result.snapshot = { ref: 'HEAD', fetchedAt: new Date().toISOString() };
    result.warnings.push(...archive.warnings);
    return result;
  } catch (error) {
    if (timedOut) throw failure('The GitHub download took longer than one minute. Try again or open a local clone.', 504);
    if (signal?.aborted) throw error;
    if (error.status) throw error;
    throw failure('Could not download from GitHub. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
