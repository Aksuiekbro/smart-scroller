// SmartScroller deep moderation runtime.
//
// The public seam is intentionally small:
//   SmartScroller.start(adapter)
//   SmartScroller.review(feedItem)
//   SmartScroller.recordFeedback(feedback)
//
// Platform scripts only discover candidates and provide a host element. This
// module owns settings, relevance, quality scoring, presentation, feedback,
// statistics, and the fail-open circuit breaker.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.storage?.sync) return;

  const RULESET_VERSION = 'quality-v1';
  const SETTINGS_VERSION = 2;
  const DEFAULT_SITES = {
    youtube_shorts: true,
    youtube_home: true,
    instagram_reels: true
  };
  const DEFAULT_SETTINGS = {
    schemaVersion: SETTINGS_VERSION,
    enabled: true,
    topics: [],
    sites: DEFAULT_SITES,
    pauseUntil: 0,
    qualityEnabled: true,
    qualityMode: 'balanced',
    showReasons: true
  };
  const THRESHOLDS = {
    gentle: { label: 0.7, blur: 0.9 },
    balanced: { label: 0.55, blur: 0.8 },
    strict: { label: 0.45, blur: 0.65 }
  };
  const LABEL_LIMIT = 0.15;
  const DECISION_LIMIT = 300;

  let settingsCache = null;
  let settingsPending = null;
  let feedbackCache = null;
  let feedbackPending = null;
  let activeRuntimeStop = null;
  let decisionSequence = 0;
  const positionOverrides = new WeakMap();

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[#@]/g, ' ')
      .replace(/[^\p{L}\p{N}\s:/._-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeForMatch(value) {
    return normalize(value).replace(/https?:\/\/\S+/g, ' ');
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchKeyword(haystack, keyword) {
    const kw = normalizeForMatch(keyword);
    if (!kw) return false;
    if (kw.includes(' ')) return haystack.includes(kw);
    return new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(haystack);
  }

  // This is deliberately a one-way local key, not a claim of cryptographic
  // identity. Raw author labels are never written to storage.
  function hashAuthor(author) {
    const value = normalize(author);
    if (!value) return '';
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `author_${(hash >>> 0).toString(16)}`;
  }

  function makeDecisionId() {
    decisionSequence = (decisionSequence + 1) % 1_000_000;
    return `ss_${Date.now().toString(36)}_${decisionSequence.toString(36)}`;
  }

  async function migrateSettings() {
    const existing = await api.storage.sync.get([
      'schemaVersion',
      'enabled',
      'topics',
      'sites',
      'pauseUntil',
      'qualityEnabled',
      'qualityMode',
      'showReasons'
    ]);

    if (existing.schemaVersion === SETTINGS_VERSION) return existing;

    const isExistingUser =
      existing.enabled !== undefined ||
      existing.topics !== undefined ||
      existing.sites !== undefined ||
      existing.pauseUntil !== undefined;

    const patch = {
      schemaVersion: SETTINGS_VERSION,
      enabled: existing.enabled !== false,
      topics: Array.isArray(existing.topics) ? existing.topics : [],
      sites: { ...DEFAULT_SITES, ...(existing.sites || {}) },
      pauseUntil: Number(existing.pauseUntil) || 0,
      // Existing users keep the old topic-only behavior until they opt in.
      // New installs get the quality filter immediately.
      qualityEnabled: isExistingUser ? false : true,
      qualityMode: THRESHOLDS[existing.qualityMode] ? existing.qualityMode : 'balanced',
      showReasons: existing.showReasons !== false
    };
    await api.storage.sync.set(patch);
    return patch;
  }

  async function loadSettings() {
    if (settingsCache) return settingsCache;
    if (!settingsPending) {
      settingsPending = migrateSettings()
        .then((value) => {
          settingsCache = {
            ...DEFAULT_SETTINGS,
            ...value,
            sites: { ...DEFAULT_SITES, ...(value.sites || {}) },
            topics: Array.isArray(value.topics) ? value.topics : []
          };
          return settingsCache;
        })
        .finally(() => {
          settingsPending = null;
        });
    }
    return settingsPending;
  }

  async function loadFeedback() {
    if (feedbackCache) return feedbackCache;
    if (!feedbackPending) {
      feedbackPending = api.storage.local.get('feedback')
        .then(({ feedback }) => {
          feedbackCache = {
            version: 1,
            labelAdjustments: {},
            allowAuthors: {},
            blockLabels: {},
            ...(feedback || {})
          };
          return feedbackCache;
        })
        .finally(() => {
          feedbackPending = null;
        });
    }
    return feedbackPending;
  }

  function reportStat(kind) {
    try {
      api.runtime?.sendMessage?.({ type: 'ss:stat', kind });
    } catch (_) {
      // The host page may unload while the content script is reporting.
    }
  }

  function extractLinks(item, text) {
    const links = Array.isArray(item.links) ? item.links : [];
    const fromText = String(text || '').match(/https?:\/\/[^\s)]+/g) || [];
    return [...new Set([...links, ...fromText])].slice(0, 20);
  }

  function extractClaimCandidates(text) {
    const sentences = String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 40 && sentence.length <= 280);
    const claimPattern = /\b(is|are|was|were|will|won't|can|can't|always|never|proves|guaranteed|causes|reduces|increases|replaces?)\b/i;
    return sentences.filter((sentence) => claimPattern.test(sentence)).slice(0, 3);
  }

  function topicMatch(item, settings) {
    if (!settings.topics.length) return { relevance: 'unknown', hits: [] };
    const haystack = normalizeForMatch(item.text);
    if (!haystack) return { relevance: 'unknown', hits: [] };
    const hits = [];
    for (const topic of settings.topics) {
      for (const keyword of topic.keywords || []) {
        if (matchKeyword(haystack, keyword)) {
          hits.push({ topic: topic.name || 'Topic', keyword });
          break;
        }
      }
    }
    return { relevance: hits.length ? 'wanted' : 'unwanted', hits };
  }

  function scoreQuality(item, feedback) {
    const text = String(item.text || '').trim();
    const normalized = normalize(text);
    const links = extractLinks(item, text);
    const wordCount = normalized ? normalized.split(' ').length : 0;
    const lineCount = text.split(/\n/).length;
    const labels = [];
    const reasons = [];
    const positive = [];
    let score = 0;

    function addNegative(label, amount, reason) {
      const adjustment = Number(feedback.labelAdjustments?.[label]) || 0;
      score += amount + clamp(adjustment, -LABEL_LIMIT, LABEL_LIMIT);
      if (!labels.includes(label)) labels.push(label);
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }

    function addPositive(label, amount, reason) {
      score -= amount;
      if (!positive.includes(label)) positive.push(label);
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }

    const aiWords = /\b(ai|artificial intelligence|llm|claude|gpt|openai|agentic|copilot|machine learning)\b/i.test(text);
    const replacementPromise = /\b(replace|replaces|replacing|eliminate|eliminates|obsolete|end of|entire|whole)\b.{0,40}\b(team|developers?|engineers?|jobs?|company|workforce|software)\b/i.test(text);
    const aiListicle = /\b(?:these|here are|top|best)\s+\d+\b.{0,50}\b(ai|tools?|apps?|prompts?|agents?)\b/i.test(text);
    const engagementBait = /\b(comment|dm|like|follow|share| repost|drop)\b.{0,40}\b(pdf|guide|link|below|word|thoughts|agree|me\b)/i.test(text) ||
      /\bwho else\b|\bagree\s*\?|\bthoughts\s*\?/i.test(text);
    const strongClaim = /\b(always|never|everyone|nobody|guaranteed|proves|will|won't|cannot|can't|must)\b/i.test(text);
    const hasConcreteSignal =
      links.length > 0 ||
      /\b(for example|benchmark|measured|dataset|repository|repo|source|because|trade[- ]off|failure|migration|latency|ms|%|github|code)\b/i.test(text) ||
      /\b\d+(?:\.\d+)?\s*(?:%|ms|seconds?|minutes?|hours?|requests?|users?|items?|records?|gb|mb)\b/i.test(text);
    const hasCaveat = /\b(may|might|depends| limitation| caveat|however|in practice|we found|our result)\b/i.test(text);
    const emojiCount = (text.match(/[\p{Extended_Pictographic}]/gu) || []).length;
    const genericTemplate = /\b(here's the truth|let that sink in|read that again|the future is here|stop scrolling|unpopular opinion)\b/i.test(text);

    if (aiWords && (replacementPromise || aiListicle)) {
      addNegative('AI_HYPE', 0.34, 'AI is framed as a guaranteed replacement or generic tool list.');
    } else if (replacementPromise) {
      addNegative('UNSUPPORTED_CLAIM', 0.24, 'A sweeping replacement claim is made without enough qualification.');
    }
    if (engagementBait) {
      addNegative('ENGAGEMENT_BAIT', 0.24, 'The post asks for engagement instead of giving the promised information.');
    }
    if (genericTemplate || (wordCount >= 20 && !hasConcreteSignal && lineCount >= 4)) {
      addNegative('EMPTY_NARRATIVE', 0.15, 'The post uses a theatrical narrative but provides little concrete information.');
    }
    if (strongClaim && !hasConcreteSignal && !links.length) {
      addNegative('UNSUPPORTED_CLAIM', 0.22, 'A strong factual claim has no visible source, example, or limitation.');
    }
    if ((lineCount >= 7 && wordCount < 120) || (emojiCount >= 5 && !hasConcreteSignal)) {
      addNegative('REPETITIVE_TEMPLATE', 0.1, 'The formatting resembles a low-information reusable post template.');
    }
    if (item.media?.some((media) => media.provenance === 'declared-synthetic')) {
      addNegative('DECLARED_SYNTHETIC_MEDIA', 0.12, 'The platform declares that attached media was synthetically generated.');
    }

    if (links.length) addPositive('PRIMARY_EVIDENCE', 0.18, 'The post includes a source or link for follow-up.');
    if (/```|\{[^}]+\}|;|=>|\bcode\b|\bquery\b/i.test(text)) {
      addPositive('CONCRETE_EXAMPLE', 0.17, 'The post includes a concrete implementation detail or example.');
    } else if (hasConcreteSignal && wordCount >= 35) {
      addPositive('CONCRETE_EXAMPLE', 0.1, 'The post includes concrete details rather than only a general claim.');
    }
    if (hasCaveat) addPositive('CAVEATED_ANALYSIS', 0.11, 'The author acknowledges limits, uncertainty, or context.');
    if (wordCount >= 180 && hasConcreteSignal) addPositive('CONCRETE_EXAMPLE', 0.05, 'The post has enough detail to support a useful explanation.');

    return {
      score: clamp(score),
      labels: [...labels, ...positive],
      reasons,
      evidenceCount: labels.length + positive.length
    };
  }

  function confidenceFor(score, evidenceCount, text) {
    if (String(text || '').trim().length < 35 || evidenceCount < 2) return 'low';
    if (score >= 0.8 || evidenceCount >= 4) return 'high';
    return 'medium';
  }

  function actionFor(score, mode) {
    const thresholds = THRESHOLDS[mode] || THRESHOLDS.balanced;
    if (score >= thresholds.blur) return 'blur';
    if (score >= thresholds.label) return 'label';
    return 'show';
  }

  async function review(feedItem = {}) {
    const settings = await loadSettings();
    const feedback = await loadFeedback();
    const now = Date.now();
    const item = {
      ...feedItem,
      text: String(feedItem.text || '').trim(),
      authorKey: feedItem.authorKey || hashAuthor(feedItem.author || ''),
      links: extractLinks(feedItem, feedItem.text),
      media: Array.isArray(feedItem.media) ? feedItem.media : []
    };
    const topic = topicMatch(item, settings);
    const quality = scoreQuality(item, feedback);
    const paused = settings.pauseUntil && now < settings.pauseUntil;
    const enabled = settings.enabled !== false && !paused;
    const allowedAuthor = item.authorKey && feedback.allowAuthors?.[item.authorKey] === true;
    const decision = {
      id: makeDecisionId(),
      action: 'show',
      slopScore: quality.score,
      relevance: topic.relevance,
      confidence: confidenceFor(quality.score, quality.evidenceCount, item.text),
      labels: quality.labels,
      reasons: quality.reasons.slice(),
      claimCandidates: extractClaimCandidates(item.text),
      rulesetVersion: RULESET_VERSION,
      showReasons: settings.showReasons !== false
    };

    if (!enabled || !item.text) {
      decision.relevance = 'unknown';
      decision.action = 'show';
      decision.reasons = paused ? ['Filtering is paused.'] : ['Filtering is disabled or the post has no readable text.'];
    } else if (topic.relevance === 'unwanted') {
      decision.action = 'blur';
      decision.reasons.unshift('This does not match any selected topic.');
    } else if (settings.qualityEnabled && !allowedAuthor) {
      decision.action = actionFor(quality.score, settings.qualityMode);
    } else if (allowedAuthor) {
      decision.reasons = ['This author is allowed by your local preference.'];
    }

    if (decision.action !== 'show' && !decision.reasons.length) {
      decision.reasons.push('This post matched low-information patterns.');
    }

    if (decisions.size >= DECISION_LIMIT) {
      const first = decisions.keys().next().value;
      decisions.delete(first);
    }
    decisions.set(decision.id, { decision, item });
    return decision;
  }

  const decisions = new Map();

  async function recordFeedback(feedback = {}) {
    const record = decisions.get(feedback.decisionId);
    if (!record || !feedback.kind) return;
    const state = await loadFeedback();
    const next = {
      version: 1,
      labelAdjustments: { ...(state.labelAdjustments || {}) },
      allowAuthors: { ...(state.allowAuthors || {}) },
      blockLabels: { ...(state.blockLabels || {}) }
    };

    if (feedback.kind === 'always_allow_author' && record.item.authorKey) {
      next.allowAuthors[record.item.authorKey] = true;
    }
    if (feedback.kind === 'block_label') {
      for (const label of record.decision.labels || []) {
        if (!label.startsWith('AI_') && !['EMPTY_NARRATIVE', 'ENGAGEMENT_BAIT', 'REPETITIVE_TEMPLATE', 'UNSUPPORTED_CLAIM', 'DECLARED_SYNTHETIC_MEDIA'].includes(label)) continue;
        next.blockLabels[label] = true;
        next.labelAdjustments[label] = clamp((Number(next.labelAdjustments[label]) || 0) + 0.05, -LABEL_LIMIT, LABEL_LIMIT);
      }
    }
    if (feedback.kind === 'useful') {
      for (const label of record.decision.labels || []) {
        if (!next.labelAdjustments[label]) next.labelAdjustments[label] = 0;
        next.labelAdjustments[label] = clamp(Number(next.labelAdjustments[label]) - 0.04, -LABEL_LIMIT, LABEL_LIMIT);
      }
    }
    if (feedback.kind === 'slop') {
      for (const label of record.decision.labels || ['EMPTY_NARRATIVE']) {
        next.labelAdjustments[label] = clamp((Number(next.labelAdjustments[label]) || 0) + 0.04, -LABEL_LIMIT, LABEL_LIMIT);
      }
    }

    feedbackCache = next;
    await api.storage.local.set({ feedback: next });
    reportStat(feedback.kind === 'useful' ? 'useful_correction' : feedback.kind === 'slop' ? 'slop_correction' : 'feedback');
  }

  function setElementState(handle, state) {
    if (handle?.dataset) handle.dataset.ssState = state;
  }

  function removeOverlay(handle) {
    if (!handle?.querySelector) return;
    handle.querySelector(':scope > .ss-overlay')?.remove();
    handle.querySelector(':scope > .ss-feedback')?.remove();
    handle.classList.remove('ss-blurred', 'ss-labeled');
    const original = positionOverrides.get(handle);
    if (original) {
      if (original.value) handle.style.setProperty('position', original.value, original.priority);
      else handle.style.removeProperty('position');
      positionOverrides.delete(handle);
    }
  }

  function ensurePosition(handle) {
    if (!handle?.style || getComputedStyle(handle).position !== 'static') return;
    if (!positionOverrides.has(handle)) {
      positionOverrides.set(handle, {
        value: handle.style.getPropertyValue('position'),
        priority: handle.style.getPropertyPriority('position')
      });
    }
    handle.style.setProperty('position', 'relative');
  }

  function textNode(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function createButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function renderFeedbackBadge(handle, decision, onFeedback) {
    if (!handle?.appendChild || handle.querySelector(':scope > .ss-feedback')) return;
    ensurePosition(handle);
    const badge = document.createElement('div');
    badge.className = 'ss-feedback';
    badge.appendChild(createButton('Flag slop', 'ss-btn ss-btn--ghost', () => onFeedback('slop')));
    badge.title = decision.reasons?.[0] || 'Review this post';
    badge.addEventListener('click', (event) => event.stopPropagation());
    handle.appendChild(badge);
  }

  function presentDecision(handle, decision, onFeedback, opts = {}) {
    if (!handle?.appendChild) return;
    removeOverlay(handle);
    setElementState(handle, decision.action === 'blur' ? 'blurred' : decision.action === 'label' ? 'labeled' : 'checked');
    if (decision.action === 'show') {
      renderFeedbackBadge(handle, decision, onFeedback);
      reportStat('decision_show');
      return;
    }

    if (decision.action === 'blur') {
      handle.classList.add('ss-blurred');
      reportStat('decision_blur');
    } else {
      handle.classList.add('ss-labeled');
      reportStat('decision_label');
    }
    ensurePosition(handle);

    const overlay = document.createElement('div');
    overlay.className = `ss-overlay${opts.small ? ' ss-overlay--small' : ''}${decision.action === 'label' ? ' ss-overlay--label' : ''}`;
    const card = document.createElement('div');
    card.className = 'ss-card';
    card.appendChild(textNode('div', 'ss-eyebrow', decision.action === 'blur' ? 'Low signal' : 'Review'));
    card.appendChild(textNode('div', 'ss-title', decision.showReasons === false ? 'This post was filtered by your settings.' : (decision.reasons?.[0] || 'This post matched low-information patterns.')));
    if (decision.showReasons !== false && decision.labels?.length) card.appendChild(textNode('div', 'ss-reasons', decision.labels.slice(0, 3).join(' · ')));
    const actions = document.createElement('div');
    actions.className = 'ss-actions';
    actions.appendChild(createButton('Show once', 'ss-btn', () => onFeedback('show_once')));
    actions.appendChild(createButton('Useful', 'ss-btn ss-btn--ghost', () => onFeedback('useful')));
    actions.appendChild(createButton('Allow author', 'ss-btn ss-btn--ghost', () => onFeedback('always_allow_author')));
    actions.appendChild(createButton('Hide more', 'ss-btn ss-btn--ghost', () => onFeedback('block_label')));
    card.appendChild(actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (event) => event.stopPropagation());
    handle.appendChild(overlay);
  }

  function clearElement(handle, state = 'revealed') {
    removeOverlay(handle);
    setElementState(handle, state);
    if (handle?.dataset) delete handle.dataset.ssState;
  }

  function applyUserSlop(handle, decision) {
    const next = {
      ...decision,
      action: 'blur',
      reasons: ['You marked this post as low signal.'],
      labels: [...new Set([...(decision.labels || []), 'EMPTY_NARRATIVE'])]
    };
    presentDecision(handle, next, () => {}, {});
  }

  function start(adapter) {
    if (!adapter || typeof adapter.observe !== 'function' || typeof adapter.present !== 'function' || typeof adapter.reset !== 'function') {
      throw new TypeError('SmartScroller.start requires observe, present, and reset adapter methods');
    }
    activeRuntimeStop?.();
    let stopped = false;
    let disabled = false;
    let failures = 0;
    let failureWindow = Date.now();
    let states = new WeakMap();
    const onSettingsChanged = () => {
      states = new WeakMap();
      disabled = false;
      failures = 0;
      try { adapter.reset(); } catch (_) { /* fail open */ }
    };
    const onCandidate = async (candidate) => {
      if (stopped || disabled || !candidate) return;
      const handle = candidate.handle || candidate.element;
      const item = candidate.item || candidate;
      if (!handle || !item?.text || states.has(handle)) return;
      states.set(handle, 'processing');
      try {
        const decision = await review(item);
        if (stopped || disabled) return;
        const onFeedback = async (kind) => {
          await recordFeedback({ decisionId: decision.id, kind });
          if (kind === 'show_once' || kind === 'useful' || kind === 'always_allow_author') {
            clearElement(handle);
            states.set(handle, 'revealed');
            if (kind === 'show_once') reportStat('reveal');
          } else if (kind === 'slop') {
            applyUserSlop(handle, decision);
            states.set(handle, 'blurred');
          } else if (kind === 'block_label') {
            presentDecision(handle, {
              ...decision,
              action: 'blur',
              reasons: ['You chose to hide similar posts.']
            }, () => {}, {});
            states.set(handle, 'blurred');
          }
        };
        adapter.present(handle, decision, onFeedback);
        states.set(handle, decision.action);
      } catch (error) {
        const now = Date.now();
        if (now - failureWindow > 60_000) {
          failureWindow = now;
          failures = 0;
        }
        failures++;
        reportStat('adapter_error');
        // Repeated adapter failures disable this surface for the session.
        if (failures >= 5) {
          disabled = true;
          reportStat('adapter_disabled');
          try { adapter.reset(); } catch (_) { /* fail open */ }
        }
        console.debug?.('SmartScroller failed open', error);
      }
    };
    window.addEventListener('ss:settings-changed', onSettingsChanged);
    let stopObserve;
    try {
      stopObserve = adapter.observe(onCandidate);
    } catch (error) {
      failures = 5;
      reportStat('adapter_disabled');
      console.debug?.('SmartScroller adapter failed open', error);
    }
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('ss:settings-changed', onSettingsChanged);
      try { stopObserve?.(); } catch (_) { /* fail open */ }
      try { adapter.reset(); } catch (_) { /* fail open */ }
    };
    activeRuntimeStop = stop;
    return stop;
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      settingsCache = null;
      settingsPending = null;
      window.dispatchEvent(new CustomEvent('ss:settings-changed'));
    }
    if (area === 'local' && changes.feedback) {
      feedbackCache = null;
      feedbackPending = null;
    }
  });

  // A browser extension page can use the same deep review seam without a DOM
  // adapter, which powers the popup companion analyzer and unit tests.
  globalThis.SmartScroller = {
    start,
    review,
    recordFeedback,
    loadSettings,
    reportStat,
    hashAuthor,
    present: presentDecision,
    clear: clearElement,
    RULESET_VERSION,
    FactChecker: {
      async check() {
        return { status: 'unavailable', reviews: [] };
      }
    }
  };
})()
