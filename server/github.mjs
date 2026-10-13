import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CACHE_TTL = 10 * 60 * 1000;
const REQUEST_TIMEOUT = 8000;
const MAX_CACHE_ENTRIES = 256;
const caches = new WeakMap();

function failure(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Accept a repository identity, never an arbitrary URL for the server to fetch. */
export function parseGitHubRepository(spec) {
  const invalid = () => failure('Enter a public GitHub repository as owner/repo or https://github.com/owner/repo.', 400);
  if (typeof spec !== 'string' || spec.length > 300) throw invalid();
  const input = spec.trim();
  const match = input.match(/^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i)
    || input.match(/^git@github\.com:([^/?#]+)\/([^/?#]+)\/?$/i)
    || input.match(/^([^/?#]+)\/([^/?#]+)\/?$/);
  if (!match) throw invalid();
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner)
    || !/^[a-z\d._-]{1,100}$/i.test(repo) || repo === '.' || repo === '..') throw invalid();
  return { owner, repo, fullName: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

/** Read Git configuration only. This does not clone, run hooks, or read source files. */
export async function findGitHubRepository(root) {
  if (typeof root !== 'string' || !root.trim()) return null;
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 4096, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return parseGitHubRepository(stdout.trim());
  } catch {
    // Git's errors can include credentials from a remote URL. Do not expose them.
    return null;
  }
}

function fetchCache(fetchImpl) {
  let cache = caches.get(fetchImpl);
  if (!cache) {
    cache = { values: new Map(), pending: new Map() };
    caches.set(fetchImpl, cache);
  }
  return cache;
}

/**
 * Only public repository metadata is requested; local code never leaves the machine.
 * Endpoint and star field: https://docs.github.com/en/rest/repos/repos#get-a-repository
 * Public limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 */
export async function getGitHubStars(spec, { fetchImpl = globalThis.fetch } = {}) {
  const identity = parseGitHubRepository(spec);
  if (typeof fetchImpl !== 'function') throw failure('GitHub metadata is unavailable on this machine.', 502);
  const cache = fetchCache(fetchImpl);
  const key = identity.fullName.toLowerCase();
  const stored = cache.values.get(key);
  if (stored && Date.now() - stored.timestamp < CACHE_TTL) return { ...stored.value, cached: true };
  cache.values.delete(key);
  if (cache.pending.has(key)) return { ...await cache.pending.get(key), cached: true };

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(failure('GitHub took too long to respond. Try again later.', 502));
      controller.abort();
    }, REQUEST_TIMEOUT);
  });
  const request = (async () => {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}`, {
        method: 'GET', signal: controller.signal, redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitScape', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (response.status === 404) throw failure('This public GitHub repository is unavailable. Check its owner and name.', 404);
      if (response.status === 403 || response.status === 429) throw failure('GitHub has limited requests. Try again later.', 429);
      if (response.status === 401) throw failure('GitHub could not provide public repository metadata.', 401);
      if (!response.ok) throw failure('GitHub could not provide repository metadata. Try again later.', 502);
      let data;
      try { data = await response.json(); } catch { throw failure('GitHub returned an unreadable response. Try again later.', 502); }
      if (data?.private === true || (data?.visibility && data.visibility !== 'public')) {
        throw failure('Only public GitHub repositories are supported.', 404);
      }
      if (!Number.isSafeInteger(data?.stargazers_count) || data.stargazers_count < 0) {
        throw failure('GitHub did not provide a valid star count. Try again later.', 502);
      }
      return { ...identity, stars: data.stargazers_count, fetchedAt: new Date().toISOString(), cached: false };
    } catch (error) {
      if (error.status) throw error;
      // Do not reflect upstream responses, network diagnostics, or private URLs.
      throw failure('Could not reach GitHub. Check your connection and try again.', 502);
    }
  })();
  const pending = Promise.race([request, timeout]);
  cache.pending.set(key, pending);
  try {
    const value = await pending;
    if (cache.values.size >= MAX_CACHE_ENTRIES) cache.values.delete(cache.values.keys().next().value);
    cache.values.set(key, { value, timestamp: Date.now() });
    return { ...value };
  } finally {
    clearTimeout(timer);
    cache.pending.delete(key);
  }
}
