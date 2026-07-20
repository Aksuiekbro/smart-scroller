// SmartScroller background service worker
// - Seeds default settings on first install
// - Rolls daily stats counter

const api = globalThis.browser ?? globalThis.chrome;

const PLATFORM_SCRIPTS = [
  {
    id: 'smartscroller-youtube',
    origins: ['*://*.youtube.com/*'],
    js: ['content/classifier.js', 'content/youtube.js'],
    css: ['content/common.css']
  },
  {
    id: 'smartscroller-instagram',
    origins: ['*://*.instagram.com/*'],
    js: ['content/classifier.js', 'content/instagram.js'],
    css: ['content/common.css']
  }
];

const DEFAULTS = {
  schemaVersion: 2,
  enabled: true,
  topics: [],
  sites: {
    youtube_shorts: true,
    youtube_home: true,
    instagram_reels: true
  },
  pauseUntil: 0,
  qualityEnabled: true,
  qualityMode: "balanced",
  showReasons: true
};

const LOCAL_DEFAULTS = {
  stats: {
    day: today(),
    decisions: 0,
    shown: 0,
    labeled: 0,
    blurred: 0,
    allowed: 0,
    reveals: 0,
    usefulCorrections: 0,
    slopCorrections: 0,
    feedback: 0,
    estimatedAvoided: 0,
    adapterErrors: 0,
    adapterDisabled: 0
  },
  feedback: {
    version: 1,
    labelAdjustments: {},
    allowAuthors: {},
    blockLabels: {}
  }
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyStats() {
  return {
    day: today(),
    decisions: 0,
    shown: 0,
    labeled: 0,
    blurred: 0,
    allowed: 0,
    reveals: 0,
    usefulCorrections: 0,
    slopCorrections: 0,
    feedback: 0,
    estimatedAvoided: 0,
    adapterErrors: 0,
    adapterDisabled: 0
  };
}

api.runtime.onInstalled.addListener(async () => {
  const sync = await api.storage.sync.get(Object.keys(DEFAULTS));
  const toSet = {};
  const existingUser = sync.schemaVersion === undefined && (
    sync.enabled !== undefined ||
    sync.topics !== undefined ||
    sync.sites !== undefined ||
    sync.pauseUntil !== undefined
  );
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (sync[k] === undefined) toSet[k] = v;
  }
  if (existingUser) {
    // Keep the old topic-only behavior until the user explicitly enables the
    // new signal filter from the options page.
    toSet.schemaVersion = 2;
    toSet.qualityEnabled = false;
  }
  if (Object.keys(toSet).length) await api.storage.sync.set(toSet);

  const local = await api.storage.local.get(Object.keys(LOCAL_DEFAULTS));
  const toSetLocal = {};
  for (const [k, v] of Object.entries(LOCAL_DEFAULTS)) {
    if (local[k] === undefined) toSetLocal[k] = v;
  }
  if (Object.keys(toSetLocal).length) await api.storage.local.set(toSetLocal);

  await registerGrantedScripts();

  // Open options page on first install so user can review topics
  if (Object.keys(toSet).length === Object.keys(DEFAULTS).length) {
    api.runtime.openOptionsPage?.();
  }
});

// Roll stats day on every wake
api.runtime.onStartup.addListener(rollStatsDay);
rollStatsDay();
registerGrantedScripts();

async function hasOriginPermission(origins) {
  if (!api.permissions?.contains) return false;
  try {
    return await api.permissions.contains({ origins });
  } catch (_) {
    return false;
  }
}

async function registerGrantedScripts() {
  if (!api.scripting?.registerContentScripts && !api.contentScripts?.register) return;
  for (const platform of PLATFORM_SCRIPTS) {
    if (!(await hasOriginPermission(platform.origins))) continue;
    try {
      if (api.scripting?.registerContentScripts && api.scripting.getRegisteredContentScripts && api.scripting.unregisterContentScripts) {
        const existing = await api.scripting.getRegisteredContentScripts({ ids: [platform.id] });
        if (existing.length) await api.scripting.unregisterContentScripts({ ids: [platform.id] });
      }
      if (api.scripting?.registerContentScripts) {
        await api.scripting.registerContentScripts([{
          id: platform.id,
          matches: platform.origins,
          js: platform.js,
          css: platform.css,
          runAt: 'document_idle',
          allFrames: false,
          persistAcrossSessions: true
        }]);
      } else {
        // Firefox/Orion-style WebExtension implementations expose the older
        // contentScripts seam instead of chrome.scripting.
        await api.contentScripts.register({
          matches: platform.origins,
          js: platform.js.map((file) => ({ file })),
          css: platform.css.map((file) => ({ file })),
          runAt: 'document_idle',
          allFrames: false
        });
      }
    } catch (error) {
      console.debug?.('SmartScroller could not register platform script', platform.id, error);
    }
  }
}

async function rollStatsDay() {
  const { stats } = await api.storage.local.get('stats');
  if (!stats || stats.day !== today()) {
    await api.storage.local.set({ stats: emptyStats() });
  }
}

function incrementStats(stats, kind) {
  stats.decisions = Number(stats.decisions) || 0;
  stats.shown = Number(stats.shown) || 0;
  stats.labeled = Number(stats.labeled) || 0;
  stats.blurred = Number(stats.blurred) || 0;
  stats.allowed = Number(stats.allowed) || 0;
  stats.reveals = Number(stats.reveals) || 0;
  stats.usefulCorrections = Number(stats.usefulCorrections) || 0;
  stats.slopCorrections = Number(stats.slopCorrections) || 0;
  stats.feedback = Number(stats.feedback) || 0;
  stats.estimatedAvoided = Number(stats.estimatedAvoided) || 0;
  stats.adapterErrors = Number(stats.adapterErrors) || 0;
  stats.adapterDisabled = Number(stats.adapterDisabled) || 0;
  if (kind === 'decision_show') {
    stats.decisions++;
    stats.shown++;
  } else if (kind === 'decision_label') {
    stats.decisions++;
    stats.labeled++;
  } else if (kind === 'decision_blur') {
    stats.decisions++;
    stats.blurred++;
    stats.estimatedAvoided++;
  } else if (kind === 'allowed') stats.allowed++;
  else if (kind === 'reveal') stats.reveals++;
  else if (kind === 'useful_correction') stats.usefulCorrections++;
  else if (kind === 'slop_correction') stats.slopCorrections++;
  else if (kind === 'feedback') stats.feedback++;
  else if (kind === 'adapter_error') stats.adapterErrors++;
  else if (kind === 'adapter_disabled') stats.adapterDisabled++;
  return stats;
}

// Content scripts post stat increments here so we keep counters out of the hot path
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ss:register-scripts') {
    registerGrantedScripts().then(() => sendResponse?.({ ok: true }));
    return true;
  }
  if (msg?.type === 'ss:stat') {
    (async () => {
      const { stats } = await api.storage.local.get('stats');
      const s = stats && stats.day === today() ? stats : emptyStats();
      incrementStats(s, msg.kind);
      await api.storage.local.set({ stats: s });
      sendResponse?.({ ok: true, stats: s });
    })();
    return true;
  }
});
