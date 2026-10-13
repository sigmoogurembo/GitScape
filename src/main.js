import { renderShell } from "./shell.js";
import { createPopulationController } from './population-ui.js';
import './style.css';
import { CodeCity, colorFor } from './city.js';

const icons = {
  city: '<path d="M3 21V11h5v10m2 0V3h5v18m2 0V8h4v13M2 21h20"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  fly: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="m11 13 11-11"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 0-6-6l-4 4a4 4 0 0 0 0 6" transform="translate(3 2) scale(.85)"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10a10 10 0 0 1-12 10"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.code}</svg>`;
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = n => Number(n || 0).toLocaleString('en-US');
const $ = selector => document.querySelector(selector);
const app = $('#app');
app.innerHTML = renderShell(icon);

let repo = null, city = null, selected = null, language = null, historyIndex = -1, playback = null, toastTimer = null;
let populationController = null;
let importSource = 'github', pendingImport = null;
let visualStyle = new URLSearchParams(location.search).get('view');
try { visualStyle ||= localStorage.getItem('gitscape-view'); } catch { /* Storage can be disabled. */ }
if (!['game', 'tool'].includes(visualStyle)) visualStyle = 'game';
app.dataset.style = visualStyle;
app.classList.toggle('explorer-open', visualStyle === 'tool' && innerWidth > 760);
try {
  city = new CodeCity($('#viewport'), {
    onSelect: file => inspect(file),
    onMode: mode => { if (mode === 'orbit') setOrbitUI(); },
    onHover: (file, event) => {
      const card = $('#hover-card'); card.hidden = !file;
      if (!file) return;
      card.innerHTML = `<span class="language-dot" style="--color:${colorFor(file.language)}"></span><strong>${esc(file.name)}</strong><span>${number(file.lines)} lines · ${esc(file.language)}</span>`;
      card.style.left = `${Math.min(event.clientX + 16, innerWidth - 260)}px`; card.style.top = `${Math.min(event.clientY + 16, innerHeight - 100)}px`;
    },
    onFrame: fps => { $('#fps').textContent = `${fps} FPS`; }
  });
  city.setStyle(visualStyle);
} catch (error) {
  $('#loading').innerHTML = '<strong>WebGL could not start</strong><span>Open GitScape in a browser with hardware acceleration enabled.</span>';
  console.error(error);
}

if (city) populationController = createPopulationController({ city, app, notify: toast });

function toast(text, isError = false) {
  clearTimeout(toastTimer); const el = $('#toast'); el.textContent = text; el.classList.toggle('error', isError); el.hidden = false;
  toastTimer = setTimeout(() => el.hidden = true, 4500);
}
function loading(on, detail = 'Indexing source files…') { $('#loading').hidden = !on; $('#loading-detail') && ($('#loading-detail').textContent = detail); }
function setStyle(style) {
  visualStyle = style;
  app.dataset.style = style;
  app.classList.toggle('explorer-open', style === 'tool' && innerWidth > 760);
  $('#style-game').classList.toggle('active', style === 'game');
  $('#style-tool').classList.toggle('active', style === 'tool');
  $('#style-game').setAttribute('aria-pressed', style === 'game');
  $('#style-tool').setAttribute('aria-pressed', style === 'tool');
  $('#explorer-btn').setAttribute('aria-expanded', app.classList.contains('explorer-open'));
  $('#map-description').textContent = style === 'game' ? 'Source code / city view' : 'Current files / dependency map';
  $('.map-key-index').textContent = style === 'game' ? '01' : '02';
  const inspectorHeading = $('#inspector .section-heading');
  if (inspectorHeading) inspectorHeading.textContent = style === 'game' ? 'BUILDING INSPECTOR' : 'FILE INSPECTOR';
  try { localStorage.setItem('gitscape-view', style); } catch { /* Preferences are optional. */ }
  const url = new URL(location.href); url.searchParams.set('view', style); history.replaceState(null, '', url);
  city?.setStyle(style);
  requestAnimationFrame(() => city?.resize());
}
function closeInspector() {
  $('#inspector').hidden = true; app.classList.remove('inspecting'); selected = null; city?.select(null);
  $('#map-instruction').textContent = 'Select a building to trace its imports.';
}
async function request(url, input, { signal } = {}) {
  const response = await fetch(url, { ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}), signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load repository.'); return data;
}
function stopPlayback() { if (playback) clearInterval(playback); playback = null; $('#history-play').innerHTML = icon('play'); $('#history-play').setAttribute('aria-label', 'Play commit activity'); }
function setMode(mode) {
  city.setMode(mode); $('#orbit-btn').classList.toggle('active', mode === 'orbit'); $('#fly-btn').classList.toggle('active', mode === 'fly');
  $('#control-hint').innerHTML = mode === 'fly' ? '<span><b>W A S D</b> move</span><span><b>Q / E</b> altitude</span><span><b>RIGHT DRAG</b> look</span><span><b>SHIFT</b> boost</span>' : '<span><b>DRAG</b> orbit</span><span><b>SCROLL</b> zoom</span><span><b>RIGHT DRAG</b> pan</span><span><b>CLICK</b> inspect</span>';
}
function setRepository(data) {
  if (!data.files.length) throw new Error('No supported text files found in this folder.');
  clearTimeout(toastTimer); $('#toast').hidden = true;
  stopPlayback(); repo = data; selected = null; language = null; historyIndex = -1;
  $('#search').value = ''; $('#search-results').hidden = true; $('#inspector').hidden = true; app.classList.remove('inspecting');
  city.load(data); setMode('orbit');
  populationController?.setRepository(data);
  $('#repo-name').textContent = data.source === 'demo' ? data.name.replace(' · fictional demo', '') : data.name; $('#repo-name').title = data.name;
  $('#repo-source').textContent = data.source === 'demo' ? 'DEMO' : data.source === 'github' ? 'GITHUB' : 'LOCAL';
  $('#repo-detail').textContent = data.source === 'demo' ? 'Sample repository · generated locally' : data.source === 'github' ? `${data.githubRepository.fullName} · default branch` : data.root || 'Imported folder / local files';
  $('#repo-detail').title = data.githubRepository?.url || data.root || data.name;
  $('#stat-files').textContent = number(data.files.length); $('#stat-lines').textContent = number(data.stats.lines);
  $('#stat-districts').textContent = number(city.districts.length); $('#stat-links').textContent = number(data.edges.length);
  $('#header-repo').textContent = $('#repo-name').textContent;
  $('#map-title').textContent = $('#repo-name').textContent;
  $('#map-instruction').textContent = 'Select a building to trace its imports.';
  $('#analysis-note-list').innerHTML = (data.warnings || []).map(note => `<li>${esc(note)}</li>`).join('');
  $('#analysis-notes').hidden = !data.warnings?.length;
  $('#bridges-btn').classList.toggle('enabled', city.bridges); $('#bridges-btn').setAttribute('aria-pressed', city.bridges);
  $('#district-total').textContent = `${city.districts.length}`;
  $('#district-list').innerHTML = city.districts.map((district, i) => `<button class="district-row" data-district="${i}"><span class="district-icon">${icon('folder')}</span><span class="district-name">${esc(district.name)}</span><span class="district-count">${district.files.length}</span><span class="district-arrow">↗</span></button>`).join('');
  $('#district-list').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { city.focusDistrict(city.districts[Number(button.dataset.district)].name); setOrbitUI(); }));
  const langs = new Map(); data.files.forEach(file => langs.set(file.language, (langs.get(file.language) || 0) + 1));
  $('#languages').innerHTML = [...langs].sort((a, b) => b[1] - a[1]).map(([lang, count]) => `<button class="language-btn" data-language="${esc(lang)}"><span class="language-dot" style="--color:${colorFor(lang)}"></span>${esc(lang)}<span>${count}</span></button>`).join('');
  $('#languages').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { language = language === button.dataset.language ? null : button.dataset.language; updateFilters(); }));
  $('#history-range').max = Math.max(0, data.history.length - 1); $('#history-range').value = Math.max(0, data.history.length - 1);
  $('#history-range').disabled = !data.history.length; $('#history-play').disabled = !data.history.length; $('#history-live').disabled = !data.history.length;
  $('#history-title').textContent = data.history.length ? `COMMIT ACTIVITY / ${data.history.length} COMMITS` : data.source === 'github' ? 'GITHUB / DEFAULT BRANCH' : 'COMMIT ACTIVITY / NO HISTORY';
  $('#history-date').textContent = 'HEAD'; $('#history-message').textContent = data.history.length ? 'Current sizes · sampled commit activity' : data.source === 'github' ? 'Source snapshot · open a local clone for commit history' : 'No Git history for this source';
  updateFilters(); loading(false);
}
function setOrbitUI() { $('#orbit-btn').classList.add('active'); $('#fly-btn').classList.remove('active'); $('#control-hint').innerHTML = '<span><b>DRAG</b> orbit</span><span><b>SCROLL</b> zoom</span><span><b>RIGHT DRAG</b> pan</span><span><b>CLICK</b> inspect</span>'; }
function updateFilters() {
  if (!repo) return;
  const query = $('#search').value.trim(); const visible = city.filter(query, language, historyIndex);
  $('#visible-count').textContent = `${number(visible)} / ${number(repo.files.length)} files`;
  $('#clear-language').hidden = !language;
  $('#languages').querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.language === language));
  const results = $('#search-results'); results.hidden = !query;
  if (query) {
    const matches = repo.files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()) && (!language || file.language === language));
    results.innerHTML = matches.length ? `<div class="result-summary">${matches.length} files found</div>${matches.slice(0, 25).map(file => `<button class="result-row" data-file="${esc(file.id)}"><span class="language-dot" style="--color:${colorFor(file.language)}"></span><span>${esc(file.path)}</span></button>`).join('')}` : '<div class="result-summary">No matching files. Try another name.</div>';
    results.querySelectorAll('button').forEach(button => button.addEventListener('click', () => inspect(repo.files.find(file => file.id === button.dataset.file), true)));
  }
}
function inspect(file, focus = false) {
  if (!file) return;
  const currentCommit = repo.history[historyIndex];
  if (focus && currentCommit && file.commits > 0 && file.createdAt && new Date(file.createdAt) > new Date(currentCommit.date)) showHead();
  if (focus) { $('#search').value = ''; language = null; updateFilters(); }
  selected = file; city.select(file.id); if (focus) { city.focus(file); setOrbitUI(); }
  const outgoing = repo.edges.filter(edge => edge.from === file.id); const incoming = repo.edges.filter(edge => edge.to === file.id);
  $('#map-instruction').textContent = `${file.path} · ${outgoing.length} imports · ${incoming.length} references`;
  $('#inspector').hidden = false; app.classList.add('inspecting');
  $('#inspector').innerHTML = `<div class="inspector-top"><span class="section-heading">BUILDING INSPECTOR</span><button id="close-inspector" class="icon-btn" aria-label="Close inspector">${icon('close')}</button></div><div class="file-icon" style="--color:${colorFor(file.language)}">${icon('code')}</div><h2>${esc(file.name)}</h2><div class="file-path">${esc(file.path)}</div><div class="file-language"><span class="language-dot" style="--color:${colorFor(file.language)}"></span>${esc(file.language)}<span>${number(file.bytes)} bytes</span></div><div class="file-metrics"><div><strong>${number(file.lines)}</strong><span>lines</span></div><div><strong>${number(outgoing.length + incoming.length)}</strong><span>links</span></div><div><strong>${number(file.commits)}</strong><span>commits*</span></div></div><div class="inspector-tabs"><button id="tab-connections" class="active">Connections</button><button id="tab-source">Source code</button></div><div id="connections-pane"><div class="connection-heading">IMPORTS <span>${outgoing.length}</span></div>${connectionRows(outgoing.map(edge => edge.to))}<div class="connection-heading">IMPORTED BY <span>${incoming.length}</span></div>${connectionRows(incoming.map(edge => edge.from))}<div class="inspector-note">* Commit counts cover the loaded history window.<br>${file.lastModified ? `Last changed: ${esc(new Date(file.lastModified).toLocaleDateString('en-GB'))}` : 'Git metadata unavailable for this file.'}</div></div><div id="source-pane" hidden><div class="source-top"><span>Current file contents</span><button id="copy-source" class="text-btn">${icon('copy')} Copy</button></div><pre class="source-code">${file.content.split('\n').slice(0, 2500).map((line, i) => `<span class="code-line"><span class="line-number">${i + 1}</span><code>${highlight(line)}</code></span>`).join('')}</pre>${file.content.split('\n').length > 2500 ? '<div class="inspector-note">Showing the first 2,500 lines.</div>' : ''}</div><button id="focus-file" class="secondary wide">${icon('fly')} Fly to this building</button>`;
  $('#inspector .section-heading').textContent = visualStyle === 'game' ? 'BUILDING INSPECTOR' : 'FILE INSPECTOR';
  $('#close-inspector').addEventListener('click', closeInspector);
  $('#focus-file').addEventListener('click', () => { city.focus(file); setOrbitUI(); });
  $('#tab-connections').addEventListener('click', () => toggleSource(false)); $('#tab-source').addEventListener('click', () => toggleSource(true));
  $('#copy-source').addEventListener('click', async () => { try { await navigator.clipboard.writeText(file.content); toast('Source copied to clipboard.'); } catch { toast('Clipboard unavailable in this browser.', true); } });
  $('#inspector').querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => inspect(repo.files.find(f => f.id === button.dataset.target), true)));
}
function connectionRows(ids) { return ids.length ? ids.map(id => { const file = repo.files.find(f => f.id === id); return `<button class="connection-row" data-target="${esc(id)}"><span class="language-dot" style="--color:${colorFor(file?.language)}"></span><span>${esc(id)}</span>${icon('arrow')}</button>`; }).join('') : '<div class="empty-connections">No resolved connections</div>'; }
function toggleSource(on) { $('#source-pane').hidden = !on; $('#connections-pane').hidden = on; $('#tab-source').classList.toggle('active', on); $('#tab-connections').classList.toggle('active', !on); }
function highlight(line) {
  // Tokenize before escaping. Source is never interpreted as HTML.
  const pattern = /(\/\/.*$|#.*$|(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(?:import|export|from|const|let|var|function|return|async|await|if|else|class|new|throw|try|catch|def|self|True|False|None|true|false|null|interface|type|extends|public|private)\b|\b\d+(?:\.\d+)?\b)/g;
  let output = '', end = 0;
  for (const match of line.matchAll(pattern)) { output += esc(line.slice(end, match.index)); const token = match[0]; const cls = token.startsWith('//') || token.startsWith('#') ? 'comment' : /^["'`]/.test(token) ? 'string' : /^\d/.test(token) ? 'num' : 'keyword'; output += `<span class="syntax-${cls}">${esc(token)}</span>`; end = match.index + token.length; }
  return output + esc(line.slice(end));
}
function setHistory(index) {
  historyIndex = index; $('#history-range').value = index;
  const commit = repo.history[index]; if (!commit) return;
  $('#history-date').textContent = new Date(commit.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  $('#history-message').textContent = `${commit.hash.slice(0, 7)} · ${commit.message}`; $('#history-message').title = commit.message;
  updateFilters();
}
function showHead() {
  stopPlayback(); historyIndex = -1;
  $('#history-range').value = Math.max(0, repo.history.length - 1);
  $('#history-date').textContent = 'HEAD';
  $('#history-message').textContent = 'Current sizes · sampled commit activity';
  updateFilters();
}
$('#search').addEventListener('input', updateFilters); $('#clear-language').addEventListener('click', () => { language = null; updateFilters(); });
$('#style-game').addEventListener('click', () => setStyle('game'));
$('#style-tool').addEventListener('click', () => setStyle('tool'));
$('#explorer-btn').addEventListener('click', () => {
  app.classList.toggle('explorer-open'); $('#explorer-btn').setAttribute('aria-expanded', app.classList.contains('explorer-open'));
});
$('#open-btn').addEventListener('click', () => $('#import-modal').showModal());
$('#help-btn').addEventListener('click', () => $('#help-modal').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('#orbit-btn').addEventListener('click', () => setMode('orbit')); $('#fly-btn').addEventListener('click', () => { setMode('fly'); city.rotation = false; $('#tour-btn').classList.remove('enabled'); $('#tour-btn').setAttribute('aria-pressed', 'false'); });
$('#reset-btn').addEventListener('click', () => { city.fit(); setOrbitUI(); });
$('#bridges-btn').addEventListener('click', () => { city.bridges = !city.bridges; city.updateLinks(); $('#bridges-btn').classList.toggle('enabled', city.bridges); $('#bridges-btn').setAttribute('aria-pressed', city.bridges); });
$('#tour-btn').addEventListener('click', () => { if (city.mode !== 'orbit') setMode('orbit'); city.rotation = !city.rotation; $('#tour-btn').classList.toggle('enabled', city.rotation); $('#tour-btn').setAttribute('aria-pressed', city.rotation); });
$('#capture-btn').addEventListener('click', async () => { if (repo) { try { await city.screenshot(); toast('PNG download requested. Check your downloads folder.'); } catch (error) { toast(error.message, true); } } });
$('#history-range').addEventListener('input', event => { stopPlayback(); setHistory(Number(event.target.value)); });
$('#history-live').addEventListener('click', showHead);
$('#history-play').addEventListener('click', () => {
  if (playback) return stopPlayback(); if (!repo?.history.length) return;
  if (historyIndex < 0 || historyIndex >= repo.history.length - 1) setHistory(0);
  $('#history-play').innerHTML = icon('pause'); $('#history-play').setAttribute('aria-label', 'Pause commit activity');
  playback = setInterval(() => { if (historyIndex >= repo.history.length - 1) stopPlayback(); else setHistory(historyIndex + 1); }, 1300);
});
function setImportSource(source) {
  if (pendingImport) return;
  importSource = source;
  for (const mode of ['github', 'local']) {
    const active = mode === source;
    $(`#import-${mode}`).classList.toggle('active', active);
    $(`#import-${mode}`).setAttribute('aria-pressed', String(active));
    $(`#${mode}-source`).hidden = !active;
  }
  $('#local-picker').hidden = source !== 'local';
  $('#repo-url').required = source === 'github';
  $('#repo-path').required = source === 'local';
  $('#import-error').hidden = true;
  $('#build-btn').innerHTML = `${source === 'github' ? 'Open GitHub repository' : 'Open repository'} ${icon('arrow')}`;
}
function setImportBusy(busy) {
  for (const selector of ['#build-btn', '#import-github', '#import-local', '#repo-url', '#repo-path', '#folder-btn', '#demo-btn']) $(selector).disabled = busy;
  $('#import-status').hidden = !busy;
  $('#build-btn').innerHTML = busy ? (importSource === 'github' ? 'Opening GitHub…' : 'Reading repository…') : `${importSource === 'github' ? 'Open GitHub repository' : 'Open repository'} ${icon('arrow')}`;
}
$('#import-github').addEventListener('click', () => { setImportSource('github'); $('#repo-url').focus(); });
$('#import-local').addEventListener('click', () => { setImportSource('local'); $('#repo-path').focus(); });
$('#import-modal').addEventListener('close', () => { pendingImport?.abort(); pendingImport = null; setImportBusy(false); });
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (pendingImport) return;
  const field = importSource === 'github' ? $('#repo-url') : $('#repo-path');
  const value = field.value.trim();
  if (!value) { field.focus(); return; }
  const controller = new AbortController();
  pendingImport = controller;
  setImportBusy(true); $('#import-error').hidden = true;
  $('#import-status').textContent = importSource === 'github' ? 'Downloading and analyzing source files… Close to cancel.' : 'Reading source files and Git history…';
  try {
    const data = await request(importSource === 'github' ? '/api/github/import' : '/api/analyze', importSource === 'github' ? { repository: value } : { path: value }, { signal: controller.signal });
    if (controller.signal.aborted) return;
    $('#import-status').textContent = 'Building the city…';
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (controller.signal.aborted) return;
    setRepository(data); $('#import-modal').close(); toast(`Built ${number(data.files.length)} buildings from ${data.githubRepository?.fullName || data.name}.`);
  } catch (error) {
    if (controller.signal.aborted) return;
    $('#import-error').textContent = error.message; $('#import-error').hidden = false;
  } finally {
    if (pendingImport === controller) { pendingImport = null; setImportBusy(false); }
  }
});
$('#folder-btn').addEventListener('click', () => $('#folder-input').click());
$('#folder-input').addEventListener('change', async event => {
  const files = [...event.target.files]; if (!files.length) return;
  const rootName = files[0].webkitRelativePath.split('/')[0]; $('#import-modal').close(); loading(true, 'Reading the selected folder…');
  try {
    const supported = /\.(?:[cm]?[jt]sx?|py|rs|go|java|c|h|cpp|hpp|cs|css|scss|sass|less|html?|json|md|mdx|ya?ml|toml|sql|sh|vue|svelte|txt|xml)$/i;
    const filtered = files.filter(file => supported.test(file.name) && file.size <= 200 * 1024 && !/(?:^|\/)(?:node_modules|\.git|dist|build|coverage|\.next|vendor|__pycache__)(?:\/|$)/.test(file.webkitRelativePath));
    const chosen = filtered.slice(0, 1800); const total = chosen.reduce((sum, file) => sum + file.size, 0); if (total > 24 * 1024 * 1024) throw new Error('Selected source files exceed 24 MB. Open the local path instead.');
    const input = [];
    for (let i = 0; i < chosen.length; i += 40) input.push(...await Promise.all(chosen.slice(i, i + 40).map(async file => ({ path: file.webkitRelativePath.slice(rootName.length + 1), content: await file.text() }))));
    const data = await request('/api/import', { name: rootName, files: input });
    if (filtered.length > chosen.length) data.warnings.push('Folder import limited to 1,800 files.'); setRepository(data); toast(`Built ${data.files.length} buildings from ${rootName}.`);
  } catch (error) { loading(false); toast(error.message, true); } finally { event.target.value = ''; }
});
async function demo() { loading(true); try { setRepository(await request('/api/demo')); } catch (error) { loading(false); toast(error.message, true); } }
$('#demo-btn').addEventListener('click', () => { $('#import-modal').close(); demo(); });
window.addEventListener('keydown', event => {
  if (event.key === '/' && !/INPUT|TEXTAREA/.test(event.target.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); app.classList.add('explorer-open'); $('#explorer-btn').setAttribute('aria-expanded', 'true'); $('#search').focus(); }
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closeInspector();
});
setStyle(visualStyle);
if (city) demo();
