// SmartScroller classifier — shared between youtube.js and instagram.js
// Strategy: normalize text fields, expand hashtags, run keyword/phrase matching
// against the user's topic list. Returns { onTopic, hits, reason }.
//
// Extension point: classifySemantic(meta) is reserved for a future
// Transformers.js embedding-based tier — see README for the upgrade path.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  let cache = null;
  let pending = null;

  async function loadSettings() {
    if (cache) return cache;
    if (!pending) {
      pending = api.storage.sync
        .get([
          'enabled',
          'topics',
          'blockedTopics',
          'filterMode',
          'prehideUnknown',
          'hardHideOffTopic',
          'blockShortsSurfaces',
          'autoSteer',
          'sites',
          'pauseUntil'
        ])
        .then((d) => {
          cache = {
            enabled: d.enabled !== false,
            topics: Array.isArray(d.topics) ? d.topics : [],
            blockedTopics: Array.isArray(d.blockedTopics) ? d.blockedTopics : [],
            filterMode: d.filterMode === 'coach' ? 'coach' : 'focus',
            prehideUnknown: d.prehideUnknown === true,
            hardHideOffTopic: d.hardHideOffTopic === true,
            blockShortsSurfaces: d.blockShortsSurfaces === true,
            autoSteer: d.autoSteer === true,
            sites: d.sites || { youtube_shorts: true, youtube_home: true, instagram_reels: true },
            pauseUntil: d.pauseUntil || 0
          };
          return cache;
        });
    }
    return pending;
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      cache = null;
      pending = null;
      // Notify host scripts so they can re-evaluate already-rendered items
      window.dispatchEvent(new CustomEvent('ss:settings-changed'));
    }
  });

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[#@]/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // "MachineLearning" -> ["machinelearning", "machine learning"]
  // "ai_news" -> ["ai_news", "ai news"]
  function expandHashtag(tag) {
    const t = String(tag || '').replace(/^#/, '');
    if (!t) return [];
    const camelSplit = t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    return [t.toLowerCase(), camelSplit];
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchKeyword(haystack, keyword) {
    const kw = String(keyword || '').toLowerCase().trim();
    if (!kw) return false;
    if (kw.includes(' ')) {
      return haystack.includes(kw);
    }
    const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i');
    return re.test(haystack);
  }

  function matchTopics(topics, haystack) {
    const hits = [];
    for (const topic of topics || []) {
      for (const kw of topic.keywords || []) {
        if (matchKeyword(haystack, kw)) {
          hits.push({ topic: topic.name, keyword: kw });
          break;
        }
      }
    }
    return hits;
  }

  async function classify(meta) {
    const settings = await loadSettings();
    const now = Date.now();

    if (!settings.enabled) {
      return { onTopic: true, hits: [], reason: 'disabled' };
    }
    if (settings.pauseUntil && now < settings.pauseUntil) {
      return { onTopic: true, hits: [], reason: 'paused' };
    }
    if (!settings.topics.length && !settings.blockedTopics.length) {
      return { onTopic: true, hits: [], reason: 'no-topics' };
    }

    const fields = {
      title: normalize(meta.title),
      author: normalize(meta.author),
      description: normalize(meta.description),
      hashtags: (meta.hashtags || []).flatMap(expandHashtag).join(' ')
    };
    const haystack = [fields.title, fields.author, fields.description, fields.hashtags]
      .filter(Boolean)
      .join(' ');

    if (!haystack) {
      return { onTopic: true, hits: [], reason: 'empty' };
    }

    const blockedHits = matchTopics(settings.blockedTopics, haystack);
    if (blockedHits.length > 0) {
      return { onTopic: false, hits: blockedHits, reason: 'blocked' };
    }

    const hits = matchTopics(settings.topics, haystack);
    if (hits.length > 0) {
      return { onTopic: true, hits, reason: 'matched' };
    }

    if (settings.filterMode === 'coach') {
      return { onTopic: true, hits: [], reason: 'neutral' };
    }

    return { onTopic: false, hits: [], reason: 'no-match' };
  }

  function siteEnabled(key) {
    return loadSettings().then((s) => s.sites?.[key] !== false);
  }

  function reportStat(kind) {
    try {
      api.runtime.sendMessage({ type: 'ss:stat', kind });
    } catch (_) {
      /* extension context may be gone on tab unload */
    }
  }

  function queueCandidate(item) {
    try {
      api.runtime.sendMessage({ type: 'ss:queue-candidate', item });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function addBlockedKeyword(keyword, topicName = 'Muted by SmartScroller') {
    const kw = normalize(keyword);
    if (!kw) return false;

    const d = await api.storage.sync.get(['blockedTopics']);
    const blockedTopics = Array.isArray(d.blockedTopics) ? d.blockedTopics : [];
    let topic = blockedTopics.find((t) => t.id === 'smart-muted');
    if (!topic) {
      topic = { id: 'smart-muted', name: topicName, keywords: [] };
      blockedTopics.push(topic);
    }
    if (!Array.isArray(topic.keywords)) topic.keywords = [];
    if (!topic.keywords.includes(kw)) {
      topic.keywords.push(kw);
      await api.storage.sync.set({ blockedTopics });
      reportStat('avoided');
      return true;
    }
    return false;
  }

  globalThis.SmartScroller = {
    classify,
    loadSettings,
    siteEnabled,
    reportStat,
    queueCandidate,
    addBlockedKeyword
  };
})();
