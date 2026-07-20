const api = globalThis.browser ?? globalThis.chrome;
const $ = (s) => document.querySelector(s);

let trainingQueue = [];

async function load() {
  const sync = await api.storage.sync.get(['enabled', 'pauseUntil', 'filterMode', 'autoSteer']);
  const local = await api.storage.local.get(['stats', 'trainingQueue']);
  trainingQueue = Array.isArray(local.trainingQueue) ? local.trainingQueue : [];
  $('#enabled').checked = sync.enabled !== false;
  $('#autoSteer').checked = sync.autoSteer === true;
  $('#blurred').textContent = local.stats?.blurred ?? 0;
  $('#allowed').textContent = local.stats?.allowed ?? 0;
  $('#labeled').textContent = local.stats?.labeled ?? 0;
  $('#tuned').textContent = local.stats?.tuned ?? 0;
  $('#avoided').textContent = local.stats?.avoided ?? 0;
  $('#mode').textContent = sync.filterMode === 'coach' ? 'Coach mode' : 'Focus mode';
  renderPause(sync.pauseUntil || 0);
  renderQueue();
}

function renderPause(until) {
  const el = $('#pauseState');
  if (until && Date.now() < until) {
    const mins = Math.ceil((until - Date.now()) / 60000);
    el.textContent = `Paused — ${mins} min remaining`;
  } else {
    el.textContent = 'Not paused';
  }
}

function renderQueue() {
  const count = trainingQueue.length;
  const next = trainingQueue[0];
  $('#queueCount').textContent = `${count} saved`;
  $('#queuePreview').textContent = next
    ? [next.title, next.author].filter(Boolean).join(' - ')
    : 'No useful videos saved yet.';
  $('#openNext').disabled = count === 0;
  $('#clearQueue').disabled = count === 0;
}

function openUrl(url) {
  try {
    if (api.tabs?.create) api.tabs.create({ url });
    else window.open(url, '_blank');
  } catch (_) {
    window.open(url, '_blank');
  }
}

function searchTerms(topics) {
  const seen = new Set();
  const terms = [];
  for (const topic of topics || []) {
    for (const value of [topic.name, ...(topic.keywords || [])]) {
      const term = String(value || '').replace(/\s+/g, ' ').trim();
      const key = term.toLowerCase();
      if (term.length >= 2 && !seen.has(key)) {
        terms.push(term);
        seen.add(key);
      }
    }
  }
  return terms;
}

async function saveQueue(nextQueue) {
  trainingQueue = nextQueue;
  await api.storage.local.set({ trainingQueue });
  renderQueue();
}

$('#enabled').addEventListener('change', async (e) => {
  await api.storage.sync.set({ enabled: e.target.checked });
});

$('#autoSteer').addEventListener('change', async (e) => {
  await api.storage.sync.set({ autoSteer: e.target.checked });
});

document.querySelectorAll('button[data-pause]').forEach((b) => {
  b.addEventListener('click', async () => {
    const mins = Number(b.dataset.pause);
    const pauseUntil = mins > 0 ? Date.now() + mins * 60_000 : 0;
    await api.storage.sync.set({ pauseUntil });
    renderPause(pauseUntil);
  });
});

$('#openNext').addEventListener('click', async () => {
  const [next, ...rest] = trainingQueue;
  if (!next?.url) return;
  await saveQueue(rest);
  openUrl(next.url);
});

$('#openSearch').addEventListener('click', async () => {
  const sync = await api.storage.sync.get(['topics']);
  const local = await api.storage.local.get(['trainingSearchIndex']);
  const terms = searchTerms(sync.topics);
  const term = terms[Number(local.trainingSearchIndex || 0) % Math.max(terms.length, 1)] || 'programming tutorial';
  await api.storage.local.set({ trainingSearchIndex: Number(local.trainingSearchIndex || 0) + 1 });
  openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`);
});

$('#clearQueue').addEventListener('click', () => {
  saveQueue([]);
});

$('#openOptions').addEventListener('click', () => {
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
  else window.open(api.runtime.getURL('options/options.html'));
});

$('#analyze').addEventListener('click', async () => {
  const text = $('#analyzerText').value.trim();
  const result = $('#analysisResult');
  if (!text) {
    result.textContent = 'Paste some text first.';
    return;
  }
  const engine = globalThis.SmartScroller;
  if (!engine?.review) {
    result.textContent = 'The local reviewer is unavailable.';
    return;
  }
  result.textContent = 'Reviewing…';
  try {
    const decision = await engine.review({
      id: `companion_${Date.now()}`,
      platform: 'companion',
      surface: 'companion',
      text,
      links: [],
      media: []
    });
    const score = Math.round(decision.slopScore * 100);
    const reasons = decision.reasons?.slice(0, 2).join(' ') || 'No strong low-signal pattern found.';
    result.textContent = `${decision.action.toUpperCase()} · ${score}% signal risk. ${reasons}`;
  } catch (_) {
    result.textContent = 'Could not review this text; it was left unchanged.';
  }
});

load();
setInterval(load, 15_000);

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.trainingQueue) {
    trainingQueue = Array.isArray(changes.trainingQueue.newValue)
      ? changes.trainingQueue.newValue
      : [];
    renderQueue();
  }
  if (changes.stats) load();
});
