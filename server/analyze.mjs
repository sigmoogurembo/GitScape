import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_FILES = 1800;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
export const ANALYSIS_LIMITS = Object.freeze({ files: MAX_FILES, fileBytes: MAX_FILE_BYTES, totalBytes: MAX_TOTAL_BYTES });
const MAX_COMMITS = 120;
const IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn', '.test-tmp', 'node_modules', 'vendor', 'dist', 'build', 'out',
  'coverage', '.next', '.nuxt', '.cache', '.parcel-cache', '.turbo',
  '__pycache__', '.venv', 'venv', 'env', 'target', 'bin', 'obj',
  '.idea', '.vscode', '.gradle', '.dart_tool', 'bower_components',
  '.ssh', '.aws', '.gnupg', 'secrets', 'credentials',
]);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.mov', '.webm', '.avi',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.br',
  '.7z', '.rar', '.tar', '.exe', '.dll', '.so', '.dylib', '.class', '.jar',
  '.pyc', '.pyo', '.wasm', '.sqlite', '.db', '.psd', '.blend', '.glb', '.gltf',
  '.pdb', '.map', '.lockb',
]);
const LANGUAGE_BY_EXTENSION = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.pyi': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java',
  '.kt': 'Kotlin', '.kts': 'Kotlin', '.cs': 'C#', '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++', '.rb': 'Ruby', '.php': 'PHP',
  '.swift': 'Swift', '.dart': 'Dart', '.vue': 'Vue', '.svelte': 'Svelte',
  '.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS',
  '.html': 'HTML', '.htm': 'HTML', '.svg': 'SVG', '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML', '.xml': 'XML',
  '.md': 'Markdown', '.mdx': 'Markdown', '.rst': 'Documentation',
  '.txt': 'Text', '.sql': 'SQL', '.sh': 'Shell', '.bash': 'Shell',
  '.ps1': 'PowerShell', '.bat': 'Shell', '.cmd': 'Shell',
};
const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json', '.vue', '.svelte', '.css', '.scss', '.less'];

function normalizePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const portable = value.replaceAll('\\', '/');
  if (portable.startsWith('/') || /^[A-Za-z]:/.test(portable)) return null;
  const normalized = path.posix.normalize(portable).replace(/^\.\//, '');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function isSecretName(name) {
  const lower = name.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.') ||
    /^(?:credentials?|secrets?)(?:[._-].*)?$/.test(lower) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\..*)?$/.test(lower) ||
    /(?:^|[._-])(?:private[-_]?key|api[-_]?keys?|access[-_]?tokens?)(?:[._-]|$)/.test(lower) ||
    /\.(?:pem|key|p12|pfx|keystore)$/.test(lower) ||
    lower === '.npmrc' || lower === '.netrc' || lower === '.pypirc';
}

function skipReason(filePath) {
  const parts = filePath.split('/');
  if (parts.some(part => IGNORE_DIRS.has(part.toLowerCase()))) return 'ignored';
  if (parts.some(isSecretName)) return 'secret';
  const filename = parts.at(-1).toLowerCase();
  if (BINARY_EXTENSIONS.has(path.posix.extname(filename))) return 'binary';
  if (['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'cargo.lock'].includes(filename)) return 'generated';
  return null;
}
export { skipReason as sourceSkipReason };

function warningCollector() {
  const warnings = [];
  const counts = new Map();
  return {
    warnings,
    add(message) { if (warnings.length < 24 && !warnings.includes(message)) warnings.push(message); },
    skip(reason) { counts.set(reason, (counts.get(reason) || 0) + 1); },
    finish() {
      const descriptions = {
        secret: 'files or folders that may contain secrets',
        binary: 'binary or unsupported media files',
        oversized: `files larger than ${MAX_FILE_BYTES / 1024} KB`,
        invalid: 'invalid or unsafe paths',
        duplicate: 'duplicate paths',
        generated: 'generated lock files',
        symlink: 'symbolic links and junctions',
        unreadable: 'files or folders that could not be read',
      };
      for (const [reason, count] of counts) {
        if (descriptions[reason]) this.add(`Skipped ${count} ${descriptions[reason]}.`);
      }
      return warnings;
    },
  };
}

function countLines(content) {
  if (!content.length) return 0;
  const newlines = (content.match(/\n/g) || []).length;
  return newlines + (content.endsWith('\n') ? 0 : 1);
}

function fileRecord(filePath, content, metadata = {}) {
  const name = path.posix.basename(filePath);
  return {
    id: filePath,
    path: filePath,
    name,
    directory: path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath),
    language: LANGUAGE_BY_EXTENSION[path.posix.extname(name).toLowerCase()] ||
      (name.toLowerCase() === 'dockerfile' ? 'Docker' : 'Text'),
    lines: countLines(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    content,
    imports: [],
    commits: 0,
    lastModified: metadata.lastModified || null,
    createdAt: metadata.createdAt || null,
  };
}

// Keep string literals intact while removing comments, so commented imports do not become bridges.
function withoutComments(code, python = false) {
  let output = '';
  let quote = null;
  let triple = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      output += c;
      if (c === '\\') { output += code[++i] || ''; continue; }
      if (c === quote) {
        if (!triple) quote = null;
        else if (code.slice(i, i + 3) === quote.repeat(3)) {
          output += code.slice(i + 1, i + 3); i += 2; quote = null; triple = false;
        }
      }
      continue;
    }
    if (c === '"' || c === "'" || (!python && c === '`')) {
      quote = c;
      triple = python && code.slice(i, i + 3) === c.repeat(3);
      output += c;
      if (triple) { output += c.repeat(2); i += 2; }
    } else if ((python && c === '#') || (!python && c === '/' && code[i + 1] === '/')) {
      while (i < code.length && code[i] !== '\n') i++;
      output += '\n';
    } else if (!python && c === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        output += code[i] === '\n' ? '\n' : ' '; i++;
      }
      i++;
    } else output += c;
  }
  return output;
}

function parseJsonConfig(content) {
  return JSON.parse(withoutComments(content).replace(/,\s*([}\]])/g, '$1'));
}

function tsConfigs(files, notes) {
  const configs = [];
  const byPath = new Map(files.map(file => [file.path, file]));
  const cache = new Map();
  function read(file, visited = new Set()) {
    if (cache.has(file.path)) return cache.get(file.path);
    if (visited.has(file.path)) return {};
    visited.add(file.path);
    try {
      const json = parseJsonConfig(file.content);
      const directory = file.directory;
      let inherited = {};
      if (typeof json.extends === 'string' && json.extends.startsWith('.')) {
        const base = path.posix.normalize(path.posix.join(directory, json.extends));
        const parentFile = byPath.get(base) || byPath.get(base + '.json');
        if (parentFile) inherited = read(parentFile, visited);
      }
      const own = json.compilerOptions || {};
      const options = { ...inherited, ...own };
      // Store the origin of inherited paths/baseUrl; relative values belong to their defining config.
      options._base = own.baseUrl !== undefined ? path.posix.join(directory, own.baseUrl) :
        inherited._base || directory;
      options._pathsBase = own.paths !== undefined ? options._base : inherited._pathsBase || options._base;
      cache.set(file.path, options);
      return options;
    } catch {
      notes.add(`Could not parse ${file.path}; its import aliases were not used.`);
      return {};
    }
  }
  for (const file of files) {
    if (/^(?:tsconfig|jsconfig)(?:\.[^.]+)?\.json$/i.test(file.name)) {
      const options = read(file);
      configs.push({ directory: file.directory, options });
    }
  }
  return configs.sort((a, b) => b.directory.length - a.directory.length);
}

function resolveModules(files, notes) {
  const available = new Set(files.map(file => file.path));
  const configs = tsConfigs(files, notes);
  const edges = [];

  function resolveCandidate(candidate, python = false) {
    const normalized = normalizePath(candidate);
    if (!normalized) return null;
    const candidates = [normalized];
    if (python) {
      candidates.push(normalized + '.py', normalized + '.pyi', normalized + '/__init__.py');
    } else {
      if (/\.(?:js|jsx|mjs|cjs)$/i.test(normalized)) {
        const stem = normalized.replace(/\.(?:js|jsx|mjs|cjs)$/i, '');
        candidates.push(stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.cts');
      }
      if (!path.posix.extname(normalized)) {
        candidates.push(...MODULE_EXTENSIONS.map(ext => normalized + ext));
      }
      candidates.push(...MODULE_EXTENSIONS.map(ext => normalized + '/index' + ext));
    }
    return candidates.find(candidatePath => available.has(candidatePath)) || null;
  }

  function resolveJs(specifier, file) {
    const clean = specifier.split(/[?#]/)[0];
    if (clean.startsWith('.')) return resolveCandidate(path.posix.join(file.directory, clean));
    const config = configs.find(candidate => !candidate.directory ||
      file.path.startsWith(candidate.directory + '/'));
    if (!config) return null;
    const aliases = config.options.paths || {};
    for (const [pattern, targets] of Object.entries(aliases)) {
      if (!Array.isArray(targets)) continue;
      const star = pattern.indexOf('*');
      let capture = '';
      if (star < 0) { if (clean !== pattern) continue; }
      else {
        const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
        if (!clean.startsWith(prefix) || !clean.endsWith(suffix) || clean.length < prefix.length + suffix.length) continue;
        capture = clean.slice(prefix.length, clean.length - suffix.length || undefined);
      }
      for (const target of targets) {
        if (typeof target !== 'string') continue;
        const resolved = resolveCandidate(path.posix.join(config.options._pathsBase,
          target.replace('*', capture)));
        if (resolved) return resolved;
      }
    }
    if (config.options.baseUrl !== undefined) {
      return resolveCandidate(path.posix.join(config.options._base, clean));
    }
    return null;
  }

  function resolvePython(module, file) {
    const relative = module.match(/^\.+/)?.[0].length || 0;
    const remainder = module.slice(relative).replaceAll('.', '/');
    if (relative) {
      let base = file.directory;
      for (let i = 1; i < relative; i++) base = path.posix.dirname(base);
      return resolveCandidate(path.posix.join(base, remainder), true);
    }
    for (const base of ['', 'src', file.directory]) {
      const resolved = resolveCandidate(path.posix.join(base, remainder), true);
      if (resolved) return resolved;
    }
    return null;
  }

  for (const file of files) {
    const imports = new Set();
    const extension = path.posix.extname(file.path).toLowerCase();
    if (JS_EXTENSIONS.has(extension)) {
      const code = withoutComments(file.content);
      const patterns = [
        /\b(?:import|export)\s+(?:[^;"'()]*?\s+from\s*)?["']([^"']+)["']/g,
        /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
      ];
      for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
          const resolved = resolveJs(match[1], file);
          if (resolved && resolved !== file.path) imports.add(resolved);
        }
      }
    } else if (extension === '.py' || extension === '.pyi') {
      const code = withoutComments(file.content, true);
      for (const match of code.matchAll(/^\s*from\s+([\w.]+)\s+import\s+([^\n]+)/gm)) {
        const resolved = resolvePython(match[1], file);
        if (resolved && resolved !== file.path) imports.add(resolved);
        for (const member of match[2].replace(/[()]/g, '').split(',')) {
          const name = member.trim().split(/\s+/)[0];
          if (/^\w+$/.test(name)) {
            const child = resolvePython(match[1] + (match[1].endsWith('.') ? '' : '.') + name, file);
            if (child && child !== file.path) imports.add(child);
          }
        }
      }
      for (const match of code.matchAll(/^\s*import\s+([^\n]+)/gm)) {
        for (const module of match[1].split(',')) {
          const resolved = resolvePython(module.trim().split(/\s+/)[0], file);
          if (resolved && resolved !== file.path) imports.add(resolved);
        }
      }
    }
    file.imports = [...imports].sort();
    for (const target of file.imports) edges.push({ from: file.path, to: target });
  }
  notes.add('Import bridges use static pattern matching for JavaScript/TypeScript and Python. Dynamic expressions, external packages and other languages are not resolved.');
  return edges;
}

function repository(files, { name, root = null, source = 'folder', history = [], notes }) {
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const edges = resolveModules(files, notes);
  const directories = new Set();
  for (const file of files) {
    let directory = file.directory;
    while (directory && directory !== '.') {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return {
    name, root, source, files, edges, history,
    stats: {
      files: files.length,
      lines: files.reduce((sum, file) => sum + file.lines, 0),
      edges: edges.length,
      directories: directories.size,
      commits: history.length,
    },
    warnings: notes.finish(),
  };
}

/** Analyze text files supplied by a browser folder import. Never executes repository code. */
export async function analyzeFiles(inputFiles, { name = 'Imported repository', source = 'folder' } = {}) {
  if (!Array.isArray(inputFiles)) throw new TypeError('Expected an array of { path, content } files.');
  if (!['folder', 'local', 'demo', 'github'].includes(source)) throw new TypeError('Unknown repository source.');
  const notes = warningCollector();
  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const input of inputFiles) {
    const filePath = normalizePath(input?.path);
    if (!filePath) { notes.skip('invalid'); continue; }
    const reason = skipReason(filePath);
    if (reason) { notes.skip(reason); continue; }
    if (seen.has(filePath)) { notes.skip('duplicate'); continue; }
    if (typeof input.content !== 'string') { notes.skip('binary'); continue; }
    const bytes = Buffer.byteLength(input.content, 'utf8');
    if (bytes > MAX_FILE_BYTES) { notes.skip('oversized'); continue; }
    if (input.content.includes('\0')) { notes.skip('binary'); continue; }
    if (files.length >= MAX_FILES) {
      notes.add(`Analysis is limited to ${MAX_FILES} text files; additional files were skipped.`);
      break;
    }
    if (totalBytes + bytes > MAX_TOTAL_BYTES) {
      notes.add('Analysis is limited to 24 MB of text content; additional files were skipped.');
      break;
    }
    totalBytes += bytes;
    seen.add(filePath);
    files.push(fileRecord(filePath, input.content));
  }
  if (source === 'folder') notes.add('Browser folder imports do not include Git history. Use a local repository path for the commit timeline.');
  if (source === 'github') notes.add('GitHub imports show a snapshot of the default branch. Use a local clone for Git history.');
  return repository(files, { name: String(name || 'Imported repository').slice(0, 200), source, notes });
}

async function gitHistory(root, files, notes) {
  let top;
  try {
    const result = await execFileAsync('git', ['-C', root, 'rev-parse', '--show-toplevel'],
      { timeout: 2500, maxBuffer: 64 * 1024, windowsHide: true });
    top = result.stdout.trim();
  } catch (error) {
    notes.add(error.code === 'ENOENT' ? 'Git is not installed; the commit timeline is unavailable.' :
      'This folder has no readable Git history; the commit timeline is unavailable.');
    return [];
  }
  const prefix = path.relative(top, root).replaceAll('\\', '/');
  if (prefix === '..' || prefix.startsWith('../') || path.isAbsolute(prefix)) {
    notes.add('Git reported a root outside the selected folder; history was skipped.');
    return [];
  }
  let stdout;
  try {
    ({ stdout } = await execFileAsync('git', [
      '-C', root, 'log', `-n${MAX_COMMITS}`, '--date=iso-strict',
      '--format=%x1e%H%x00%aI%x00%s%x00', '--name-status', '-z', '--no-renames',
      '--', '.',
    ], { timeout: 7000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }));
  } catch {
    notes.add('Git history could not be read within the time or size limit. The city is still available.');
    return [];
  }
  const history = [];
  const byPath = new Map(files.map(file => [file.path, file]));
  for (const block of stdout.split('\x1e').filter(Boolean)) {
    const parts = block.split('\0');
    const [hash, dateText, message] = parts;
    const date = new Date(dateText);
    if (!/^[a-f\d]{40,64}$/i.test(hash) || Number.isNaN(date.getTime())) continue;
    const changed = new Set(), deleted = new Set();
    const nameStatus = parts.slice(3);
    while (nameStatus.length && !nameStatus[0].trim()) nameStatus.shift();
    for (let i = 0; i + 1 < nameStatus.length; i += 2) {
      const status = nameStatus[i].replace(/^\s+/, '');
      const gitPath = nameStatus[i + 1];
      if (!status || !gitPath) continue;
      if (prefix && !gitPath.startsWith(prefix + '/')) continue;
      const filePath = normalizePath(prefix ? gitPath.slice(prefix.length + 1) : gitPath);
      if (!filePath || skipReason(filePath)) continue;
      changed.add(filePath);
      if (status.startsWith('D')) deleted.add(filePath);
    }
    history.push({ hash, date: date.toISOString(), message: message || '', files: [...changed], deleted: [...deleted] });
  }
  history.reverse();
  history.sort((a, b) => a.date.localeCompare(b.date));
  for (const commit of history) {
    for (const filePath of commit.files) {
      const file = byPath.get(filePath);
      if (!file) continue;
      file.commits++;
      if (file.commits === 1) file.createdAt = commit.date;
      file.lastModified = commit.date;
    }
  }
  if (history.length) notes.add(`Activity and file dates are based on the latest ${history.length} Git commits (maximum ${MAX_COMMITS}); older history is not loaded.`);
  return history;
}

/** Scan a local directory. Symlinks, generated trees, binaries and common secret paths are skipped. */
export async function analyzeDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0')) {
    throw new TypeError('Provide a local repository directory.');
  }
  const root = await fs.realpath(path.resolve(directory));
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new TypeError('The selected path is not a directory.');
  const notes = warningCollector();
  const files = [];
  let limited = false;
  let totalBytes = 0;
  let sizeLimited = false;
  async function scan(absolute, relative = '') {
    let entries;
    try { entries = await fs.readdir(absolute, { withFileTypes: true }); }
    catch { notes.skip('unreadable'); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (limited) return;
      const filePath = relative ? `${relative}/${entry.name}` : entry.name;
      const reason = skipReason(filePath);
      if (reason) { notes.skip(reason); continue; }
      const target = path.join(absolute, entry.name);
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) { notes.skip('symlink'); continue; }
        // Also guard against a junction or entry changed between directory listing and inspection.
        const real = await fs.realpath(target);
        const inside = path.relative(root, real);
        if (inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) {
          notes.skip('symlink'); continue;
        }
        if (stat.isDirectory()) { await scan(real, filePath); continue; }
        if (!stat.isFile()) { notes.skip('binary'); continue; }
        if (stat.size > MAX_FILE_BYTES) { notes.skip('oversized'); continue; }
        if (files.length >= MAX_FILES) { limited = true; break; }
        const data = await fs.readFile(real);
        if (data.length > MAX_FILE_BYTES) { notes.skip('oversized'); continue; }
        if (data.includes(0)) { notes.skip('binary'); continue; }
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); }
        catch { notes.skip('binary'); continue; }
        if (totalBytes + data.length > MAX_TOTAL_BYTES) { limited = true; sizeLimited = true; break; }
        totalBytes += data.length;
        files.push(fileRecord(filePath, content, {
          lastModified: stat.mtime.toISOString(),
          createdAt: stat.birthtimeMs > 0 ? stat.birthtime.toISOString() : null,
        }));
      } catch { notes.skip('unreadable'); }
    }
  }
  await scan(root);
  if (limited) notes.add(sizeLimited ? 'Analysis is limited to 24 MB of text content; additional files were skipped.' :
    `Analysis is limited to ${MAX_FILES} text files; additional files were skipped.`);
  const history = await gitHistory(root, files, notes);
  return repository(files, { name: path.basename(root) || root, root, source: 'local', history, notes });
}
