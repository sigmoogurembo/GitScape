export function renderShell(icon) {
  return `
    <header class="topbar">
      <a class="brand" href="/" aria-label="GitScape home">${icon('city')}<strong>GitScape</strong><span class="version">0.1</span></a>
      <button id="explorer-btn" class="header-button" aria-label="Toggle explorer" aria-expanded="false">${icon('folder')}<span>Explorer</span></button>
      <span id="header-repo" class="header-repo">harbor-board</span>
      <div class="style-switch" role="group" aria-label="Visual style"><button id="style-game" class="active" aria-pressed="true">City</button><button id="style-tool" aria-pressed="false">Workbench</button></div>
      <button id="help-btn" class="icon-btn" title="Controls" aria-label="Controls and help">${icon('help')}</button>
      <button id="open-btn" class="primary">${icon('folder')}<span>Open repo</span></button>
    </header>

    <div id="viewport" aria-label="Interactive 3D repository city"></div>
    <div class="map-key"><span class="map-key-index">01</span><div><strong id="map-title">harbor-board</strong><span id="map-description">Source code / city view</span></div></div>
    <div class="map-instruction" id="map-instruction">Select a building to trace its imports.</div>

    <aside class="sidebar panel" aria-label="Repository explorer">
      <div class="section-heading">EXPLORER <span id="repo-source" class="tag">DEMO</span></div>
      <h1 id="repo-name">Loading…</h1><div id="repo-detail" class="repo-detail">Local files</div>
      <label class="search-box">${icon('search')}<input id="search" type="search" placeholder="Search files" aria-label="Search files"><kbd>/</kbd></label>
      <div id="search-results" class="search-results" hidden></div>
      <div class="stats"><div><strong id="stat-files">—</strong><span>files</span></div><div><strong id="stat-lines">—</strong><span>lines</span></div><div><strong id="stat-districts">—</strong><span>folders</span></div><div><strong id="stat-links">—</strong><span>imports</span></div></div>
      <div class="section-heading district-heading">DIRECTORIES <span id="district-total"></span></div>
      <div id="district-list" class="district-list"></div>
      <div class="language-section"><div class="section-heading">LANGUAGES <button id="clear-language" class="text-btn" hidden>Clear filter</button></div><div id="languages" class="languages"></div></div>
      <details id="analysis-notes" class="analysis-notes"><summary>Analysis notes</summary><ul id="analysis-note-list"></ul></details>
    </aside>

    <div class="bottom-area">
      <nav class="toolbar" aria-label="City controls">
        <div class="mode-switch"><button id="orbit-btn" class="active" title="Orbit the city">${icon('globe')} Orbit</button><button id="fly-btn" title="Fly through the city">${icon('fly')} Fly</button></div>
        <span class="toolbar-divider"></span><button id="reset-btn" class="tool-btn" title="Frame the entire city">${icon('reset')}<span>Frame</span></button>
        <button id="bridges-btn" class="tool-btn" aria-pressed="false" title="Show all imports">${icon('link')}<span>All imports</span></button>
        <button id="tour-btn" class="tool-btn" aria-pressed="false" title="Slow cinematic orbit">${icon('play')}<span>Auto orbit</span></button>
        <button id="capture-btn" class="tool-btn" title="Save a PNG of your city">${icon('camera')}<span>PNG</span></button>
        <div id="control-hint" class="control-hint"><span><b>DRAG</b> orbit</span><span><b>SCROLL</b> zoom</span><span><b>CLICK</b> inspect</span></div>
      </nav>
      <div class="timeline" id="timeline"><button id="history-play" class="icon-btn" title="Play commit activity" aria-label="Play commit activity">${icon('play')}</button><div class="timeline-inner"><div class="timeline-title"><span>${icon('branch')} <span id="history-title">COMMIT ACTIVITY</span></span><span id="history-date">HEAD</span></div><input type="range" id="history-range" min="0" max="0" value="0" aria-label="Commit activity timeline"><div class="timeline-caption"><span id="history-message">Current sizes · sampled commit activity</span><button id="history-live" class="text-btn">HEAD ${icon('arrow')}</button></div></div></div>
    </div>

    <footer class="statusbar"><span class="status-local"><i></i>LOCAL</span><span id="visible-count">Reading files</span><span class="status-legend">Type: file role · Roof: language</span><span id="fps">— FPS</span></footer>
    <aside id="inspector" class="inspector panel" hidden></aside>
    <div id="hover-card" class="hover-card panel" hidden></div><div id="toast" class="toast" role="status" hidden></div>
    <div id="loading" class="loading"><span class="loading-mark">${icon('city')}</span><strong>Reading repository</strong><span id="loading-detail">Indexing source files…</span></div>

    <dialog id="import-modal" class="modal" aria-labelledby="import-title"><form id="import-form">
      <div class="modal-top"><span>OPEN REPOSITORY</span><button type="button" class="icon-btn" data-close="import-modal" aria-label="Close">${icon('close')}</button></div>
      <h2 id="import-title">Build a city from code.</h2>
      <p>Open a public GitHub repository or a folder on this computer.</p>
      <div class="import-sources" role="group" aria-label="Repository source"><button type="button" id="import-github" class="active" aria-pressed="true">${icon('branch')} GitHub</button><button type="button" id="import-local" aria-pressed="false">${icon('folder')} Local folder</button></div>
      <div id="github-source"><label class="field-label" for="repo-url">GITHUB REPOSITORY</label><input id="repo-url" class="path-input" placeholder="https://github.com/owner/repository" autocomplete="off" spellcheck="false" required aria-describedby="github-hint"><div id="github-hint" class="field-hint">Paste a link or owner/repo. Opens the default branch; stars become residents.</div></div>
      <div id="local-source" hidden><label class="field-label" for="repo-path">ABSOLUTE PATH</label><input id="repo-path" class="path-input" placeholder="C:\\Projects\\my-repository" autocomplete="off" spellcheck="false"><div class="field-hint">Include Git history by entering a local path. Repository code is never executed.</div></div>
      <div id="import-error" class="inline-error" role="alert" hidden></div>
      <div id="import-status" class="import-status" role="status" hidden></div>
      <button type="submit" id="build-btn" class="primary wide">Open GitHub repository ${icon('arrow')}</button>
      <div id="local-picker" hidden><div class="or-separator"></div><button id="folder-btn" type="button" class="secondary wide">${icon('folder')} Choose folder</button><p class="small-note">Folder selection excludes Git history.</p></div>
      <button id="demo-btn" type="button" class="text-btn demo-link">Load sample repository ${icon('arrow')}</button>
    </form></dialog>
    <input type="file" id="folder-input" webkitdirectory directory multiple hidden>
    <dialog id="help-modal" class="modal"><div class="modal-top"><span>CONTROLS</span><button class="icon-btn" data-close="help-modal" aria-label="Close">${icon('close')}</button></div><h2>Explore the repository</h2><div class="help-grid"><strong>Orbit</strong><span>Drag to rotate. Scroll to zoom. Right drag to pan.</span><strong>Fly</strong><span>W A S D to move. Q / E for altitude. Shift for speed. Right drag to look.</span><strong>Inspect</strong><span>Select a building to see its source and imports. Only its connections appear by default.</span><strong>Search</strong><span>Press / to search files. Escape clears the selection.</span><strong>History</strong><span>Scrub commit activity to highlight changed files. Geometry and source remain current.</span><strong>Views</strong><span>City shows a populated diorama. Workbench shows an architectural code map.</span></div></dialog>
  `;
}
