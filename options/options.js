// Options page logic — auto-saves on every change

const api = globalThis.browser ?? globalThis.chrome;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const SITE_ORIGINS = {
  youtube: ['*://*.youtube.com/*'],
  instagram: ['*://*.instagram.com/*']
};

function permissionGroup(site) {
  return site.startsWith('youtube_') ? 'youtube' : site.startsWith('instagram_') ? 'instagram' : null;
}

async function hasSitePermission(site) {
  const group = permissionGroup(site);
  if (!group || !api.permissions?.contains) return true;
  try {
    return await api.permissions.contains({ origins: SITE_ORIGINS[group] });
  } catch (_) {
    return false;
  }
}

async function requestSitePermission(site) {
  const group = permissionGroup(site);
  if (!group || !api.permissions?.request) return true;
  try {
    return await api.permissions.request({ origins: SITE_ORIGINS[group] });
  } catch (_) {
    return false;
  }
}

async function updateSitePermission(site, enabled) {
  const group = permissionGroup(site);
  if (!group) return true;
  if (enabled) {
    const granted = await requestSitePermission(site);
    if (granted) api.runtime.sendMessage?.({ type: 'ss:register-scripts' });
    return granted;
  }
  const paired = group === 'youtube' ? ['youtube_shorts', 'youtube_home'] : ['instagram_reels'];
  const anyStillEnabled = paired.some((key) => key !== site && state.sites[key] !== false);
  if (!anyStillEnabled && api.permissions?.remove) {
    try { await api.permissions.remove({ origins: SITE_ORIGINS[group] }); } catch (_) { /* best effort */ }
  }
  return true;
}

const state = {
  schemaVersion: 2,
  enabled: true,
  topics: [],
  sites: { youtube_shorts: true, youtube_home: true, instagram_reels: true },
  pauseUntil: 0,
  qualityEnabled: true,
  qualityMode: 'balanced',
  showReasons: true
};

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

async function save() {
  await api.storage.sync.set({
    schemaVersion: 2,
    enabled: state.enabled,
    topics: state.topics,
    sites: state.sites,
    pauseUntil: state.pauseUntil,
    qualityEnabled: state.qualityEnabled,
    qualityMode: state.qualityMode,
    showReasons: state.showReasons
  });
  flashStatus('Saved');
}

let statusTimer = null;
function flashStatus(msg) {
  $('#status').textContent = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($('#status').textContent = ''), 1500);
}

function uid() {
  return 't_' + Math.random().toString(36).slice(2, 9);
}

function render() {
  $('#enabled').checked = state.enabled;
  $('#qualityEnabled').checked = state.qualityEnabled;
  $('#qualityMode').value = state.qualityMode;
  $('#showReasons').checked = state.showReasons;
  for (const cb of $$('input[data-site]')) {
    cb.checked = state.sites[cb.dataset.site] !== false;
  }
  renderPauseState();
  renderTopics();
  renderStats();
}

function renderPauseState() {
  const el = $('#pauseState');
  if (state.pauseUntil && Date.now() < state.pauseUntil) {
    const mins = Math.ceil((state.pauseUntil - Date.now()) / 60000);
    el.textContent = `Paused for ${mins} more minute${mins === 1 ? '' : 's'}`;
  } else {
    el.textContent = '';
  }
}

function renderTopics() {
  const root = $('#topics');
  root.innerHTML = '';
  if (state.topics.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No topics yet — add one to start filtering.';
    root.appendChild(empty);
    return;
  }
  for (const topic of state.topics) {
    root.appendChild(topicCard(topic));
  }
}

function topicCard(topic) {
  const card = document.createElement('div');
  card.className = 'topic';
  card.dataset.id = topic.id;

  const head = document.createElement('div');
  head.className = 'topic-head';

  const name = document.createElement('input');
  name.className = 'topic-name';
  name.type = 'text';
  name.value = topic.name || '';
  name.placeholder = 'Topic name (e.g. AI, Cooking, Boxing)';
  name.addEventListener('input', () => {
    topic.name = name.value;
    scheduleSave();
  });

  const del = document.createElement('button');
  del.className = 'btn danger';
  del.textContent = 'Remove';
  del.addEventListener('click', () => {
    state.topics = state.topics.filter((t) => t.id !== topic.id);
    renderTopics();
    scheduleSave();
  });

  head.appendChild(name);
  head.appendChild(del);

  const chips = document.createElement('div');
  chips.className = 'chips';

  function renderChips() {
    chips.innerHTML = '';
    for (const kw of topic.keywords) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const span = document.createElement('span');
      span.textContent = kw;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Remove keyword';
      x.addEventListener('click', () => {
        topic.keywords = topic.keywords.filter((k) => k !== kw);
        renderChips();
        scheduleSave();
      });
      chip.appendChild(span);
      chip.appendChild(x);
      chips.appendChild(chip);
    }
    const input = document.createElement('input');
    input.className = 'chip-input';
    input.type = 'text';
    input.placeholder = 'add keyword, press enter';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = input.value.trim().toLowerCase();
        if (v && !topic.keywords.includes(v)) {
          topic.keywords.push(v);
          renderChips();
          scheduleSave();
          // Refocus the new input
          chips.querySelector('.chip-input')?.focus();
        } else {
          input.value = '';
        }
      } else if (e.key === 'Backspace' && !input.value && topic.keywords.length) {
        topic.keywords.pop();
        renderChips();
        scheduleSave();
        chips.querySelector('.chip-input')?.focus();
      }
    });
    chips.appendChild(input);
  }
  renderChips();

  card.appendChild(head);
  card.appendChild(chips);
  return card;
}

async function renderStats() {
  const { stats } = await api.storage.local.get('stats');
  if (!stats) return;
  $('#stats').textContent = `Today: ${stats.blurred || 0} blurred, ${stats.labeled || 0} labeled, ${stats.reveals || 0} revealed, ${stats.usefulCorrections || 0} useful corrections`;
}

async function load() {
  const d = await api.storage.sync.get([
    'schemaVersion',
    'enabled',
    'topics',
    'sites',
    'pauseUntil',
    'qualityEnabled',
    'qualityMode',
    'showReasons'
  ]);
  state.schemaVersion = 2;
  state.enabled = d.enabled !== false;
  state.topics = Array.isArray(d.topics) ? d.topics : [];
  state.sites = d.sites || state.sites;
  state.pauseUntil = d.pauseUntil || 0;
  state.qualityEnabled = d.qualityEnabled === true;
  state.qualityMode = ['gentle', 'balanced', 'strict'].includes(d.qualityMode) ? d.qualityMode : 'balanced';
  state.showReasons = d.showReasons !== false;
  render();
  for (const cb of $$('input[data-site]')) {
    const granted = await hasSitePermission(cb.dataset.site);
    cb.closest('label')?.classList.toggle('site-unavailable', !granted);
    cb.title = granted ? 'Site access granted' : 'Enable this switch to grant site access';
    if (!granted) {
      cb.checked = false;
      state.sites[cb.dataset.site] = false;
    }
  }
}

// Event wiring
document.addEventListener('DOMContentLoaded', () => {
  load();

  $('#enabled').addEventListener('change', (e) => {
    state.enabled = e.target.checked;
    scheduleSave();
  });

  $('#qualityEnabled').addEventListener('change', (e) => {
    state.qualityEnabled = e.target.checked;
    scheduleSave();
  });

  $('#qualityMode').addEventListener('change', (e) => {
    state.qualityMode = e.target.value;
    scheduleSave();
  });

  $('#showReasons').addEventListener('change', (e) => {
    state.showReasons = e.target.checked;
    scheduleSave();
  });

  $$('input[data-site]').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const site = e.target.dataset.site;
      const requested = e.target.checked;
      state.sites[site] = requested;
      const granted = await updateSitePermission(site, requested);
      if (requested && !granted) {
        state.sites[site] = false;
        e.target.checked = false;
        flashStatus('Site access was not granted');
      } else {
        flashStatus(requested ? 'Site access granted' : 'Site paused');
      }
      scheduleSave();
    });
  });

  $$('button[data-pause]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = Number(btn.dataset.pause);
      state.pauseUntil = mins > 0 ? Date.now() + mins * 60_000 : 0;
      renderPauseState();
      scheduleSave();
    });
  });

  $('#addTopic').addEventListener('click', () => {
    state.topics.push({ id: uid(), name: '', keywords: [] });
    renderTopics();
    // Focus the new topic's name input
    const cards = $$('.topic');
    cards[cards.length - 1]?.querySelector('.topic-name')?.focus();
    scheduleSave();
  });
});

// Update pause countdown every 30s while page is open
setInterval(renderPauseState, 30_000);

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderStats();
});
