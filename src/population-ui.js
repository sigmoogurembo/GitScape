import './population.css';
import { DENSITY_LEVELS } from './crowd.js';

const STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9Z"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
const format = count => count.toLocaleString('en-US');
const timestamp = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'time unavailable' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** A star count creates anonymous city residents, without requesting user profiles. */
export function createPopulationController({ city, app, notify = () => {} }) {
  const footer = app.querySelector('.statusbar');
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'population-button';
  button.className = 'population-status';
  button.innerHTML = `${STAR}<span></span>`;
  button.setAttribute('aria-haspopup', 'dialog');
  footer.insertBefore(button, footer.querySelector('.status-legend'));

  const dialog = document.createElement('dialog');
  dialog.id = 'population-dialog';
  dialog.className = 'population-dialog';
  dialog.setAttribute('aria-labelledby', 'population-title');
  dialog.innerHTML = `<form id="population-form">
    <div class="population-heading"><span>CITY POPULATION</span><button type="button" class="population-close" aria-label="Close population settings">${CLOSE}</button></div>
    <h2 id="population-title">A city for every star.</h2>
    <p class="population-description">Each GitHub star adds one resident to the city's population. Visible people adapt to your zoom and density setting.</p>
    <div class="population-current" aria-live="polite"><strong></strong><span class="population-source"></span><span class="population-time"></span></div>
    <div class="population-density"><div class="population-density-title">STREET DENSITY <span>Adaptive zoom</span></div><div class="population-density-options" role="group" aria-label="Visible crowd density">${Object.entries(DENSITY_LEVELS).map(([key, profile]) => `<button type="button" data-density="${key}" aria-pressed="false">${profile.label}</button>`).join('')}</div><p>Zoom in to reveal more people. The total population stays the same.</p></div>
    <label for="population-repository">PUBLIC GITHUB REPOSITORY</label>
    <input id="population-repository" name="repository" placeholder="owner/repository or https://github.com/owner/repository" autocomplete="off" spellcheck="false" required aria-describedby="population-help population-error">
    <div id="population-help" class="population-help">Only the public star count is requested. Your local code stays on this computer.</div>
    <div id="population-error" class="population-error" role="alert" hidden></div>
    <button type="submit" class="population-load">Load population <span aria-hidden="true">↗</span></button>
    <div class="population-actions"><button type="button" class="population-refresh" hidden>Refresh count</button><button type="button" class="population-disconnect" hidden>Disconnect GitHub</button></div>
    <p class="population-cache-note">Counts are cached for 10 minutes. Refresh requests never run automatically.</p>
  </form>`;
  app.append(dialog);

  const field = dialog.querySelector('input');
  const statusLabel = button.querySelector('span');
  const currentCount = dialog.querySelector('.population-current strong');
  const sourceLabel = dialog.querySelector('.population-source');
  const timeLabel = dialog.querySelector('.population-time');
  const errorLabel = dialog.querySelector('.population-error');
  const loadButton = dialog.querySelector('.population-load');
  const refreshButton = dialog.querySelector('.population-refresh');
  const disconnectButton = dialog.querySelector('.population-disconnect');
  let repository = null, target = null, stats = null, error = null, busy = false;
  let epoch = 0, pending = null;
  let density = 'lively';
  try {
    const stored = localStorage.getItem('gitscape-population-density');
    if (Object.hasOwn(DENSITY_LEVELS, stored)) density = stored;
  } catch { /* Preferences are optional. */ }
  city?.setPopulationDensity(density);
  const densityButtons = [...dialog.querySelectorAll('[data-density]')];
  function renderDensity() {
    densityButtons.forEach(control => {
      const selected = control.dataset.density === density;
      control.classList.toggle('active', selected);
      control.setAttribute('aria-pressed', String(selected));
    });
  }
  densityButtons.forEach(control => control.addEventListener('click', () => {
    density = control.dataset.density;
    city?.setPopulationDensity(density);
    try { localStorage.setItem('gitscape-population-density', density); } catch { /* Preferences are optional. */ }
    renderDensity(); render();
  }));
  renderDensity();

  function applyBasePopulation() {
    const demo = repository?.source === 'demo';
    city?.setPopulation(demo ? 48 : 0, { source: demo ? 'demo' : 'none', label: demo ? 'Demo residents' : 'No GitHub repository connected' });
  }

  function render() {
    const demo = repository?.source === 'demo' && !target;
    const count = stats?.stars;
    button.classList.toggle('population-pending', busy);
    button.classList.toggle('population-failed', Boolean(error));
    if (stats) {
      statusLabel.textContent = `${format(count)} residents${error ? ' · stale' : ''}`;
      button.title = `${stats.fullName}: ${format(count)} GitHub stars = ${format(count)} total residents. Visible figures adapt to zoom · ${DENSITY_LEVELS[density].label} density. ${stats.cached ? 'Cached' : 'Updated'} ${timestamp(stats.fetchedAt)}.${error ? ' Latest refresh failed.' : ''} Click to manage population.`;
      currentCount.textContent = `${format(count)} stars · ${format(count)} residents`;
      sourceLabel.textContent = stats.fullName;
      timeLabel.textContent = `${stats.cached ? 'Cached' : 'Updated'} · ${timestamp(stats.fetchedAt)}${error ? ' · last known count' : ''}`;
    } else if (busy) {
      statusLabel.textContent = 'Loading residents…';
      button.title = `Reading the public star count for ${target}.`;
      currentCount.textContent = 'Reading star count…';
      sourceLabel.textContent = target || '';
      timeLabel.textContent = '';
    } else if (error) {
      statusLabel.textContent = 'Stars unavailable';
      button.title = `${target}: ${error} Click to retry.`;
      currentCount.textContent = 'Star count unavailable';
      sourceLabel.textContent = target || '';
      timeLabel.textContent = '';
    } else {
      statusLabel.textContent = demo ? '48 demo residents' : 'Connect GitHub';
      button.title = demo ? '48 sample residents. Demo population is not a GitHub star count. Click to connect a public repository.' : 'Connect a public GitHub repository: one star adds one resident.';
      currentCount.textContent = demo ? '48 demo residents' : 'No GitHub population';
      sourceLabel.textContent = demo ? 'Sample repository · demonstration population' : 'Connect a public repository to bring the streets to life.';
      timeLabel.textContent = '';
    }
    errorLabel.hidden = !error;
    errorLabel.textContent = error || '';
    loadButton.disabled = busy;
    loadButton.textContent = busy ? 'Reading GitHub…' : 'Load population ↗';
    refreshButton.hidden = !target;
    refreshButton.disabled = busy;
    disconnectButton.hidden = !target;
  }

  function cancelPending() {
    epoch++;
    pending?.abort();
    pending = null;
    busy = false;
  }

  async function fetchPopulation(value, { automatic = false } = {}) {
    const input = String(value || '').trim();
    if (!input) { field.reportValidity(); return; }
    cancelPending();
    const requestEpoch = epoch;
    // Keep the last known residents only when refreshing the same source.
    if (input !== target) { stats = null; city?.setPopulation(0, { source: 'none', label: 'GitHub stars loading' }); }
    target = input;
    busy = true;
    error = null;
    pending = new AbortController();
    render();
    try {
      const response = await fetch('/api/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: input }), signal: pending.signal });
      let data;
      try { data = await response.json(); } catch { throw new Error('The local server returned an unreadable response.'); }
      if (!response.ok) throw new Error(data.error || 'Unable to read this repository’s GitHub star count.');
      if (!Number.isSafeInteger(data.stars) || data.stars < 0 || !data.fullName) throw new Error('GitHub returned an invalid star count.');
      if (requestEpoch !== epoch) return;
      city?.setPopulation(data.stars, { ...data, source: 'github', label: data.fullName });
      target = data.fullName;
      stats = data;
      field.value = target;
      if (!automatic) notify(`${format(data.stars)} stars · ${format(data.stars)} residents from ${data.fullName}.`);
    } catch (failure) {
      if (failure.name === 'AbortError' || requestEpoch !== epoch) return;
      error = failure.message || 'Unable to connect to GitHub.';
      if (!stats) city?.setPopulation(0, { source: 'none', label: 'GitHub star count unavailable' });
      if (!automatic) notify(error, true);
    } finally {
      if (requestEpoch === epoch) { busy = false; pending = null; render(); }
    }
  }

  function open() {
    field.value = target || repository?.githubRepository?.fullName || '';
    render();
    if (!dialog.open) dialog.showModal();
    field.focus();
    field.select();
  }

  button.addEventListener('click', open);
  dialog.querySelector('.population-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); fetchPopulation(field.value); });
  refreshButton.addEventListener('click', () => fetchPopulation(target));
  disconnectButton.addEventListener('click', () => {
    cancelPending(); target = null; stats = null; error = null; field.value = '';
    applyBasePopulation(); render();
  });

  render();
  return {
    setRepository(data) {
      cancelPending();
      repository = data; target = null; stats = null; error = null;
      field.value = data.githubRepository?.fullName || '';
      applyBasePopulation(); render();
      if (data.githubRepository?.fullName) fetchPopulation(data.githubRepository.fullName, { automatic: true });
    },
    destroy() { cancelPending(); button.remove(); dialog.remove(); }
  };
}
