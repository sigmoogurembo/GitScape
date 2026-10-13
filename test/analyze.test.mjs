import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { analyzeDirectory, analyzeFiles } from '../server/analyze.mjs';

const temporaryBase = fileURLToPath(new URL('../.test-tmp/', import.meta.url));

async function temporaryDirectory(prefix) {
  // Keep fixtures beside the project: Windows sandbox virtualized OS temp paths
  // can permit writes while rejecting realpath, which local analysis needs.
  await mkdir(temporaryBase, { recursive: true });
  return mkdtemp(path.join(temporaryBase, prefix));
}

function filesByPath(repository) {
  return new Map(repository.files.map((file) => [file.path, file]));
}

function assertEdge(repository, fromPath, toPath) {
  const files = filesByPath(repository);
  assert.ok(files.has(fromPath), `Missing file ${fromPath}`);
  assert.ok(files.has(toPath), `Missing file ${toPath}`);
  assert.ok(
    repository.edges.some((edge) => edge.from === files.get(fromPath).id && edge.to === files.get(toPath).id),
    `Expected import edge ${fromPath} -> ${toPath}`,
  );
}

test('resolves JavaScript extension imports to TypeScript and directory indexes', async () => {
  const repository = await analyzeFiles([
    { path: 'src/main.ts', content: "import { value } from './value.js';\nimport { feature } from './feature';\nimport unused from 'some-package';\nconsole.log(value, feature);\n" },
    { path: 'src/value.ts', content: 'export const value = 42;\n' },
    { path: 'src/feature/index.ts', content: 'export const feature = true;\n' },
  ], { name: 'Resolution fixture', source: 'folder' });

  assertEdge(repository, 'src/main.ts', 'src/value.ts');
  assertEdge(repository, 'src/main.ts', 'src/feature/index.ts');
  assert.equal(repository.edges.length, 2, 'External package imports should not create local bridges');
  assert.equal(repository.stats.files, 3);
  assert.equal(repository.stats.edges, repository.edges.length);
  assert.ok(repository.stats.lines >= 3);
  const main = filesByPath(repository).get('src/main.ts');
  assert.equal(main.directory, 'src');
  assert.equal(main.name, 'main.ts');
  assert.equal(typeof main.content, 'string');
  assert.ok(main.bytes > 0);
  assert.ok(main.lines > 0);
  assert.ok(main.language);
});

test('preserves both directions of a dependency cycle', async () => {
  const repository = await analyzeFiles([
    { path: 'a.js', content: "import './b.js';\nexport const a = 1;\n" },
    { path: 'b.js', content: "import './a.js';\nexport const b = 2;\n" },
  ], { name: 'Cycle fixture' });

  assert.equal(repository.stats.files, 2);
  assert.equal(repository.edges.length, 2);
  assertEdge(repository, 'a.js', 'b.js');
  assertEdge(repository, 'b.js', 'a.js');
});

test('resolves a configured TypeScript alias without adding commented imports', async () => {
  const repository = await analyzeFiles([
    { path: 'tsconfig.json', content: '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}' },
    { path: 'src/main.ts', content: "import { value } from '@/value';\n// import './unused';\n/* import './unused'; */\nconsole.log(value);\n" },
    { path: 'src/value.ts', content: 'export const value = 42;\n' },
    { path: 'src/unused.ts', content: 'export const unused = true;\n' },
  ]);

  assertEdge(repository, 'src/main.ts', 'src/value.ts');
  assert.equal(repository.edges.length, 1, 'Commented imports should not create dependency bridges');
});

test('excludes common secrets and dependency folders in a browser file import', async () => {
  const repository = await analyzeFiles([
    { path: 'src/safe.ts', content: 'export const safe = true;\n' },
    { path: '.env', content: 'TOKEN=fixture\n' },
    { path: '.env.local', content: 'TOKEN=fixture\n' },
    { path: 'credentials.json', content: '{"token":"fixture"}' },
    { path: 'private-key.pem', content: 'fixture' },
    { path: 'node_modules/dependency/index.js', content: 'export default 1;\n' },
  ]);

  assert.deepEqual(repository.files.map((file) => file.path), ['src/safe.ts']);
  assert.equal(repository.stats.files, 1);
  assert.equal(repository.stats.commits, 0);
  assert.equal(repository.history.length, 0);
});

const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

test('reads local Git metadata, changed/deleted paths, and filenames with spaces', { skip: !hasGit }, async () => {
  const root = await temporaryDirectory('gitscape-git-');
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'GitScape Test',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'GitScape Test',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (...args) => execFileSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    git('init', '--quiet');
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'file with spaces.ts'), 'export const version = 1;\n');
    await writeFile(path.join(root, 'src', 'deleted file.js'), 'export const deleted = true;\n');
    git('add', '--', 'src');
    git('commit', '--quiet', '-m', 'Create sample files');
    await writeFile(path.join(root, 'src', 'file with spaces.ts'), 'export const version = 2;\n');
    await rm(path.join(root, 'src', 'deleted file.js'));
    git('add', '--all');
    git('commit', '--quiet', '-m', 'Update one file and remove another');
    await mkdir(path.join(root, 'node_modules', 'fixture'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'fixture', 'index.js'), 'export default 1;\n');
    await writeFile(path.join(root, '.env'), 'TOKEN=fixture\n');

    const repository = await analyzeDirectory(root);
    const currentFile = filesByPath(repository).get('src/file with spaces.ts');
    assert.ok(currentFile, 'The source filename should be preserved without Git quoting');
    assert.match(currentFile.content, /version = 2/);
    assert.equal(currentFile.commits, 2, JSON.stringify({ history: repository.history, warnings: repository.warnings }));
    assert.ok(currentFile.lastModified);
    assert.ok(currentFile.createdAt);
    assert.equal(repository.stats.commits, 2);
    assert.equal(repository.history.length, 2);
    assert.ok(repository.history.every((commit) => commit.hash && commit.date && commit.message));
    assert.ok(repository.history[0].files.includes('src/file with spaces.ts'));
    assert.ok(repository.history[1].files.includes('src/file with spaces.ts'));
    assert.ok(repository.history[1].deleted.includes('src/deleted file.js'));
    assert.equal(repository.history[0].message, 'Create sample files');
    assert.equal(repository.history[1].message, 'Update one file and remove another');
    assert.ok(repository.files.every((file) => !file.path.startsWith('node_modules/') && file.path !== '.env'));
    assert.ok(Array.isArray(repository.warnings));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not follow a directory link outside the selected root', async (context) => {
  const temporaryRoot = await temporaryDirectory('gitscape-symlink-');
  const root = path.join(temporaryRoot, 'project');
  const outside = path.join(temporaryRoot, 'outside');
  try {
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(root, 'safe.js'), 'export const safe = true;\n');
    await writeFile(path.join(outside, 'outside.js'), 'export const outside = true;\n');
    try {
      await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        context.skip('This environment does not allow directory links');
        return;
      }
      throw error;
    }
    const repository = await analyzeDirectory(root);
    assert.deepEqual(repository.files.map((file) => file.path), ['safe.js']);
    assert.ok(!repository.files.some((file) => file.content.includes('outside = true')));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
