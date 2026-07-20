// Options page logic - auto-saves on every change

const api = globalThis.browser ?? globalThis.chrome;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  enabled: true,
  topics: [],
  blockedTopics: [],
  filterMode: 'focus',
  prehideUnknown: false,
  hardHideOffTopic: false,
  blockShortsSurfaces: false,
  autoSteer: false,
  qualityEnabled: true,
  qualityMode: 'balanced',
  showReasons: true,
  sites: { youtube_shorts: true, youtube_home: true, instagram_reels: true },
  pauseUntil: 0
};

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

async function save() {
  await api.storage.sync.set({
    enabled: state.enabled,
    topics: state.topics,
    blockedTopics: state.blockedTopics,
    filterMode: state.filterMode,
    prehideUnknown: state.prehideUnknown,
    hardHideOffTopic: state.hardHideOffTopic,
    blockShortsSurfaces: state.blockShortsSurfaces,
    autoSteer: state.autoSteer,
    qualityEnabled: state.qualityEnabled,
    qualityMode: state.qualityMode,
    showReasons: state.showReasons,
    sites: state.sites,
    pauseUntil: state.pauseUntil
  });
  flashStatus('Saved');
}

let statusTimer = null;
function flashStatus(msg) {
  $('#status').textContent = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($('#status').textContent = ''), 1500);
}

function uid(prefix = 't') {
  return `${prefix}_` + Math.random().toString(36).slice(2, 9);
}

function render() {
  $('#enabled').checked = state.enabled;
  $('#filterMode').value = state.filterMode;
  $('#prehideUnknown').checked = state.prehideUnknown;
  $('#hardHideOffTopic').checked = state.hardHideOffTopic;
  $('#blockShortsSurfaces').checked = state.blockShortsSurfaces;
  $('#autoSteer').checked = state.autoSteer;
  $('#qualityEnabled').checked = state.qualityEnabled;
  $('#qualityMode').value = state.qualityMode;
  $('#showReasons').checked = state.showReasons;
  for (const cb of $$('input[data-site]')) {
    cb.checked = state.sites[cb.dataset.site] !== false;
  }
  renderPauseState();
  renderTopicList({
    root: $('#topics'),
    listKey: 'topics',
    emptyText: 'No learning topics yet. Add one to steer the feed toward useful videos.'
  });
  renderTopicList({
    root: $('#blockedTopics'),
    listKey: 'blockedTopics',
    emptyText: 'No avoid topics yet. Add channels, phrases, or categories you want scrubbed.'
  });
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

function renderTopicList({ root, listKey, emptyText }) {
  root.innerHTML = '';
  const list = state[listKey];
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = emptyText;
    root.appendChild(empty);
    return;
  }
  for (const topic of list) {
    root.appendChild(topicCard(topic, listKey));
  }
}

function topicCard(topic, listKey) {
  const card = document.createElement('div');
  card.className = 'topic';
  card.dataset.id = topic.id;

  const head = document.createElement('div');
  head.className = 'topic-head';

  const name = document.createElement('input');
  name.className = 'topic-name';
  name.type = 'text';
  name.value = topic.name || '';
  name.placeholder = listKey === 'blockedTopics'
    ? 'Avoid topic name (e.g. Drama, Gambling, Shorts bait)'
    : 'Learning topic name (e.g. AI, Cooking, Boxing)';
  name.addEventListener('input', () => {
    topic.name = name.value;
    scheduleSave();
  });

  const del = document.createElement('button');
  del.className = 'btn danger';
  del.textContent = 'Remove';
  del.addEventListener('click', () => {
    state[listKey] = state[listKey].filter((t) => t.id !== topic.id);
    renderTopicList({
      root: listKey === 'blockedTopics' ? $('#blockedTopics') : $('#topics'),
      listKey,
      emptyText: listKey === 'blockedTopics'
        ? 'No avoid topics yet. Add channels, phrases, or categories you want scrubbed.'
        : 'No learning topics yet. Add one to steer the feed toward useful videos.'
    });
    scheduleSave();
  });

  head.appendChild(name);
  head.appendChild(del);

  const chips = document.createElement('div');
  chips.className = 'chips';

  function renderChips() {
    chips.innerHTML = '';
    for (const kw of topic.keywords || []) {
      const chip = document.createElement('span');
      chip.className = listKey === 'blockedTopics' ? 'chip chip--avoid' : 'chip';
      const span = document.createElement('span');
      span.textContent = kw;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = 'x';
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
    input.placeholder = listKey === 'blockedTopics' ? 'avoid keyword, press enter' : 'add keyword, press enter';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = input.value.trim().toLowerCase();
        if (v && !(topic.keywords || []).includes(v)) {
          if (!Array.isArray(topic.keywords)) topic.keywords = [];
          topic.keywords.push(v);
          renderChips();
          scheduleSave();
          chips.querySelector('.chip-input')?.focus();
        } else {
          input.value = '';
        }
      } else if (e.key === 'Backspace' && !input.value && topic.keywords?.length) {
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
  $('#stats').textContent =
    `Today: ${stats.blurred || 0} blurred, ${stats.allowed || 0} allowed, ` +
    `${stats.labeled || 0} labeled, ${stats.tuned || 0} tuned, ${stats.avoided || 0} avoided`;
}

async function load() {
  const d = await api.storage.sync.get([
    'enabled',
    'topics',
    'blockedTopics',
    'filterMode',
    'prehideUnknown',
    'hardHideOffTopic',
    'blockShortsSurfaces',
    'autoSteer',
    'qualityEnabled',
    'qualityMode',
    'showReasons',
    'sites',
    'pauseUntil'
  ]);
  state.enabled = d.enabled !== false;
  state.topics = Array.isArray(d.topics) ? d.topics : [];
  state.blockedTopics = Array.isArray(d.blockedTopics) ? d.blockedTopics : [];
  state.filterMode = d.filterMode === 'coach' ? 'coach' : 'focus';
  state.prehideUnknown = d.prehideUnknown === true;
  state.hardHideOffTopic = d.hardHideOffTopic === true;
  state.blockShortsSurfaces = d.blockShortsSurfaces === true;
  state.autoSteer = d.autoSteer === true;
  state.qualityEnabled = d.qualityEnabled === true;
  state.qualityMode = ['gentle', 'balanced', 'strict'].includes(d.qualityMode)
    ? d.qualityMode
    : 'balanced';
  state.showReasons = d.showReasons !== false;
  state.sites = d.sites || state.sites;
  state.pauseUntil = d.pauseUntil || 0;
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  load();

  $('#enabled').addEventListener('change', (e) => {
    state.enabled = e.target.checked;
    scheduleSave();
  });

  $('#filterMode').addEventListener('change', (e) => {
    state.filterMode = e.target.value === 'coach' ? 'coach' : 'focus';
    scheduleSave();
  });

  $('#prehideUnknown').addEventListener('change', (e) => {
    state.prehideUnknown = e.target.checked;
    scheduleSave();
  });

  $('#hardHideOffTopic').addEventListener('change', (e) => {
    state.hardHideOffTopic = e.target.checked;
    scheduleSave();
  });

  $('#blockShortsSurfaces').addEventListener('change', (e) => {
    state.blockShortsSurfaces = e.target.checked;
    scheduleSave();
  });

  $('#autoSteer').addEventListener('change', (e) => {
    state.autoSteer = e.target.checked;
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
    cb.addEventListener('change', (e) => {
      state.sites[e.target.dataset.site] = e.target.checked;
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
    state.topics.push({ id: uid('learn'), name: '', keywords: [] });
    renderTopicList({
      root: $('#topics'),
      listKey: 'topics',
      emptyText: 'No learning topics yet. Add one to steer the feed toward useful videos.'
    });
    const topicCards = $$('.topic', $('#topics'));
    topicCards[topicCards.length - 1]?.querySelector('.topic-name')?.focus();
    scheduleSave();
  });

  $('#addBlockedTopic').addEventListener('click', () => {
    state.blockedTopics.push({ id: uid('avoid'), name: '', keywords: [] });
    renderTopicList({
      root: $('#blockedTopics'),
      listKey: 'blockedTopics',
      emptyText: 'No avoid topics yet. Add channels, phrases, or categories you want scrubbed.'
    });
    const blockedTopicCards = $$('.topic', $('#blockedTopics'));
    blockedTopicCards[blockedTopicCards.length - 1]?.querySelector('.topic-name')?.focus();
    scheduleSave();
  });
});

setInterval(renderPauseState, 30_000);

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderStats();
});
