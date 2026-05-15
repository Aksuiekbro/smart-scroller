// Options page logic — auto-saves on every change

const api = globalThis.browser ?? globalThis.chrome;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  enabled: true,
  topics: [],
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

function uid() {
  return 't_' + Math.random().toString(36).slice(2, 9);
}

function render() {
  $('#enabled').checked = state.enabled;
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
  $('#stats').textContent = `Today: ${stats.blurred || 0} blurred, ${stats.allowed || 0} on-topic`;
}

async function load() {
  const d = await api.storage.sync.get(['enabled', 'topics', 'sites', 'pauseUntil']);
  state.enabled = d.enabled !== false;
  state.topics = Array.isArray(d.topics) ? d.topics : [];
  state.sites = d.sites || state.sites;
  state.pauseUntil = d.pauseUntil || 0;
  render();
}

// Event wiring
document.addEventListener('DOMContentLoaded', () => {
  load();

  $('#enabled').addEventListener('change', (e) => {
    state.enabled = e.target.checked;
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
