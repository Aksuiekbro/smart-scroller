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
  blockedTopics: [
    {
      id: "low-value",
      name: "Low-value distractions",
      keywords: [
        "drama", "prank", "rage bait", "celebrity gossip", "reaction",
        "casino", "gambling", "crypto pump", "alpha male", "red pill"
      ]
    }
  ],
  filterMode: "focus",
  prehideUnknown: false,
  hardHideOffTopic: false,
  blockShortsSurfaces: false,
  sites: {
    youtube_shorts: true,
    youtube_home: true,
    instagram_reels: true
  },
  pauseUntil: 0
};

const LOCAL_DEFAULTS = {
  stats: emptyStats(),
  trainingQueue: []
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyStats() {
  return { day: today(), blurred: 0, allowed: 0, tuned: 0, avoided: 0 };
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
    await api.storage.local.set({ stats: emptyStats() });
  }
}

async function incrementStat(kind) {
  const { stats } = await api.storage.local.get('stats');
  const s = stats && stats.day === today()
    ? { blurred: 0, allowed: 0, tuned: 0, avoided: 0, ...stats }
    : emptyStats();
  if (kind === 'blurred') s.blurred++;
  else if (kind === 'allowed') s.allowed++;
  else if (kind === 'tuned') s.tuned++;
  else if (kind === 'avoided') s.avoided++;
  await api.storage.local.set({ stats: s });
  return s;
}

function cleanText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeYouTubeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'youtu.be' && !host.endsWith('.youtube.com')) {
      return '';
    }
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '';
    }
    if (url.pathname.startsWith('/shorts/')) {
      const id = url.pathname.split('/').filter(Boolean)[1];
      return id ? `https://www.youtube.com/shorts/${encodeURIComponent(id)}` : '';
    }
  } catch (_) {
    return '';
  }
  return '';
}

function normalizeQueueItem(raw) {
  const url = normalizeYouTubeUrl(raw?.url);
  const title = cleanText(raw?.title, 160);
  if (!url || !title) return null;
  return {
    source: 'youtube',
    title,
    author: cleanText(raw?.author, 80),
    topic: cleanText(raw?.topic, 80),
    url,
    addedAt: Date.now()
  };
}

async function queueCandidate(rawItem) {
  const item = normalizeQueueItem(rawItem);
  if (!item) return { ok: false, error: 'invalid-item' };

  const { trainingQueue } = await api.storage.local.get('trainingQueue');
  const queue = Array.isArray(trainingQueue) ? trainingQueue : [];
  const withoutDuplicate = queue.filter((existing) => existing?.url !== item.url);
  const added = withoutDuplicate.length === queue.length;
  const next = [item, ...withoutDuplicate].slice(0, 30);
  await api.storage.local.set({ trainingQueue: next });
  return { ok: true, added, count: next.length, item };
}

// Content scripts post stat increments here so we keep counters out of the hot path
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ss:stat') {
    (async () => {
      const s = await incrementStat(msg.kind);
      sendResponse?.({ ok: true, stats: s });
    })();
    return true;
  }
  if (msg?.type === 'ss:queue-candidate') {
    (async () => {
      sendResponse?.(await queueCandidate(msg.item));
    })();
    return true;
  }
});
