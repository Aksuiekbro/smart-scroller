// SmartScroller background service worker
// - Seeds default settings on first install
// - Rolls daily stats counter

const api = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = {
  enabled: true,
  topics: [
    {
      id: "ai-programming",
      name: "AI & Programming",
      keywords: [
        "ai", "artificial intelligence", "machine learning", "ml", "llm",
        "claude", "gpt", "openai", "anthropic", "neural network",
        "deep learning", "transformer", "agent", "rag", "embedding",
        "programming", "coding", "developer", "software engineer",
        "python", "javascript", "typescript", "rust", "go", "golang",
        "react", "next.js", "compiler", "algorithm", "open source",
        "github", "vim", "linux", "terminal", "shell"
      ]
    }
  ],
  sites: {
    youtube_shorts: true,
    youtube_home: true,
    instagram_reels: true
  },
  pauseUntil: 0
};

const LOCAL_DEFAULTS = {
  stats: { day: today(), blurred: 0, allowed: 0 }
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

api.runtime.onInstalled.addListener(async () => {
  const sync = await api.storage.sync.get(Object.keys(DEFAULTS));
  const toSet = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (sync[k] === undefined) toSet[k] = v;
  }
  if (Object.keys(toSet).length) await api.storage.sync.set(toSet);

  const local = await api.storage.local.get(Object.keys(LOCAL_DEFAULTS));
  const toSetLocal = {};
  for (const [k, v] of Object.entries(LOCAL_DEFAULTS)) {
    if (local[k] === undefined) toSetLocal[k] = v;
  }
  if (Object.keys(toSetLocal).length) await api.storage.local.set(toSetLocal);

  // Open options page on first install so user can review topics
  if (Object.keys(toSet).length === Object.keys(DEFAULTS).length) {
    api.runtime.openOptionsPage?.();
  }
});

// Roll stats day on every wake
api.runtime.onStartup.addListener(rollStatsDay);
rollStatsDay();

async function rollStatsDay() {
  const { stats } = await api.storage.local.get('stats');
  if (!stats || stats.day !== today()) {
    await api.storage.local.set({ stats: { day: today(), blurred: 0, allowed: 0 } });
  }
}

// Content scripts post stat increments here so we keep counters out of the hot path
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ss:stat') {
    (async () => {
      const { stats } = await api.storage.local.get('stats');
      const s = stats && stats.day === today() ? stats : { day: today(), blurred: 0, allowed: 0 };
      if (msg.kind === 'blurred') s.blurred++;
      else if (msg.kind === 'allowed') s.allowed++;
      await api.storage.local.set({ stats: s });
      sendResponse?.({ ok: true, stats: s });
    })();
    return true;
  }
});
