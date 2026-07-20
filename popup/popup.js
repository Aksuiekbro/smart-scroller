const api = globalThis.browser ?? globalThis.chrome;
const $ = (s) => document.querySelector(s);

async function load() {
  const sync = await api.storage.sync.get(['enabled', 'pauseUntil']);
  const local = await api.storage.local.get(['stats']);
  $('#enabled').checked = sync.enabled !== false;
  $('#blurred').textContent = local.stats?.blurred ?? 0;
  $('#labeled').textContent = local.stats?.labeled ?? 0;
  renderPause(sync.pauseUntil || 0);
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

$('#enabled').addEventListener('change', async (e) => {
  await api.storage.sync.set({ enabled: e.target.checked });
});

document.querySelectorAll('button[data-pause]').forEach((b) => {
  b.addEventListener('click', async () => {
    const mins = Number(b.dataset.pause);
    const pauseUntil = mins > 0 ? Date.now() + mins * 60_000 : 0;
    await api.storage.sync.set({ pauseUntil });
    renderPause(pauseUntil);
  });
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
