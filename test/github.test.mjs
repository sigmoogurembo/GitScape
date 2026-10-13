import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGitHubRepository, findGitHubRepository, getGitHubStars } from '../server/github.mjs';

function response(stars, status = 200, extra = {}) {
  return { status, ok: status === 200, json: async () => ({ stargazers_count: stars, private: false, ...extra }) };
}

test('parses GitHub HTTPS, shorthand and SSH identities without a clone', () => {
  const expected = { owner: 'octocat', repo: 'Hello-World', fullName: 'octocat/Hello-World', url: 'https://github.com/octocat/Hello-World' };
  for (const input of [
    'octocat/Hello-World', ' octocat/Hello-World.git/ ',
    'https://github.com/octocat/Hello-World', 'https://github.com/octocat/Hello-World.git/',
    'git@github.com:octocat/Hello-World.git',
  ]) assert.deepEqual(parseGitHubRepository(input), expected);
});

test('rejects hosts, credentials, query strings and traversal without leaking input', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return response(10); };
  for (const input of [
    'https://127.0.0.1/private/repo', 'http://github.com/owner/repo',
    'https://github.com.evil.invalid/owner/repo', 'https://github.com:443/owner/repo',
    'https://secret-token@github.com/owner/repo', 'https://github.com/owner/repo?token=secret-token',
    'https://github.com/owner/repo#secret-token', 'https://github.com/owner/../repo',
    'https://github.com/owner/%2e%2e', 'owner/..', 'owner/.', 'owner/repo/extra',
    'owner\\name/repo', 'owner/repo%2fextra', 'owner/repo?secret-token', '', null, {},
  ]) {
    assert.throws(() => parseGitHubRepository(input), error => error.status === 400 && !error.message.includes('secret-token'));
    await assert.rejects(getGitHubStars(input, { fetchImpl }), { status: 400 });
  }
  assert.equal(requests, 0);
});

test('requests only the fixed public metadata endpoint and caches actual counts', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return response(37); };
  const first = await getGitHubStars('octocat/cache-fixture', { fetchImpl });
  const second = await getGitHubStars('https://github.com/OCTOCAT/CACHE-FIXTURE.git', { fetchImpl });
  assert.equal(first.stars, 37);
  assert.equal(first.cached, false);
  assert.equal(second.stars, 37);
  assert.equal(second.cached, true);
  assert.equal(second.fetchedAt, first.fetchedAt);
  assert.equal(new Date(first.fetchedAt).toISOString(), first.fetchedAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/octocat/cache-fixture');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  first.stars = 100;
  assert.equal((await getGitHubStars('octocat/cache-fixture', { fetchImpl })).stars, 37);
});

test('expires cached metadata after ten minutes', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  let calls = 0;
  const fetchImpl = async () => response(++calls);
  assert.equal((await getGitHubStars('octocat/expiry-fixture', { fetchImpl })).stars, 1);
  context.mock.timers.tick(10 * 60 * 1000 - 1);
  assert.equal((await getGitHubStars('octocat/expiry-fixture', { fetchImpl })).cached, true);
  context.mock.timers.tick(1);
  assert.equal((await getGitHubStars('octocat/expiry-fixture', { fetchImpl })).stars, 2);
  assert.equal(calls, 2);
});

test('deduplicates concurrent metadata requests', async () => {
  let resolve;
  let calls = 0;
  const fetchImpl = () => { calls++; return new Promise(done => { resolve = done; }); };
  const one = getGitHubStars('octocat/concurrent-fixture', { fetchImpl });
  const two = getGitHubStars('octocat/concurrent-fixture', { fetchImpl });
  resolve(response(4));
  const results = await Promise.all([one, two]);
  assert.equal(calls, 1);
  assert.equal(results[0].stars, 4);
  assert.equal(results[1].cached, true);
});

test('preserves a confirmed zero count but rejects missing and malformed counts', async () => {
  assert.equal((await getGitHubStars('octocat/zero-fixture', { fetchImpl: async () => response(0) })).stars, 0);
  for (const count of [undefined, null, '12', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(getGitHubStars('octocat/invalid-fixture', { fetchImpl: async () => response(count) }), { status: 502 });
  }
  await assert.rejects(getGitHubStars('octocat/unreadable-fixture', {
    fetchImpl: async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('upstream content'); } }),
  }), error => error.status === 502 && !error.message.includes('upstream content'));
});

test('reports unavailable/rate-limited metadata and allows failures to be retried', async () => {
  for (const [status, expectedStatus] of [[404, 404], [401, 401], [403, 429], [429, 429], [500, 502], [301, 502]]) {
    let calls = 0;
    const fetchImpl = async () => { calls++; return response(9, calls === 1 ? status : 200); };
    await assert.rejects(getGitHubStars('octocat/failure-fixture', { fetchImpl }), { status: expectedStatus });
    assert.equal((await getGitHubStars('octocat/failure-fixture', { fetchImpl })).stars, 9);
    assert.equal(calls, 2);
  }
  await assert.rejects(getGitHubStars('octocat/private-fixture', { fetchImpl: async () => response(9, 200, { private: true }) }), { status: 404 });
  await assert.rejects(getGitHubStars('octocat/network-fixture', { fetchImpl: async () => { throw new Error('secret-token'); } }),
    error => error.status === 502 && !error.message.includes('secret-token'));
});

test('bounds both fetching and response parsing to eight seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const delayedBody of [false, true]) {
    let signal;
    const fetchImpl = async (_, options) => {
      signal = options.signal;
      if (delayedBody) return { status: 200, ok: true, json: () => new Promise(() => {}) };
      return new Promise(() => {});
    };
    const assertion = assert.rejects(getGitHubStars('octocat/timeout-fixture', { fetchImpl }),
      error => error.status === 502 && /too long/.test(error.message));
    await Promise.resolve();
    context.mock.timers.tick(8000);
    await assertion;
    assert.equal(signal.aborted, true);
  }
});

const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
test('reads only local origin metadata and returns null for non-GitHub/credential remotes', { skip: !hasGit }, async () => {
  const temporaryBase = fileURLToPath(new URL('../.test-tmp/', import.meta.url));
  await mkdir(temporaryBase, { recursive: true });
  const root = await mkdtemp(path.join(temporaryBase, 'github-origin-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    assert.equal(await findGitHubRepository(root), null);
    git('init', '--quiet');
    assert.equal(await findGitHubRepository(root), null);
    git('remote', 'add', 'origin', 'git@github.com:octocat/Hello-World.git');
    assert.deepEqual(await findGitHubRepository(root), parseGitHubRepository('octocat/Hello-World'));
    git('remote', 'set-url', 'origin', 'https://other.invalid/owner/repo');
    assert.equal(await findGitHubRepository(root), null);
    git('remote', 'set-url', 'origin', 'https://secret-token@github.com/owner/repo');
    assert.equal(await findGitHubRepository(root), null);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryBase) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
