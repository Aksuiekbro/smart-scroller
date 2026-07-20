import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../content/classifier.js', import.meta.url), 'utf8');

function makeContext(sync = {}, local = {}) {
  const syncData = { ...sync };
  const localData = { ...local };
  const listeners = [];
  const events = new Map();
  const window = {
    addEventListener(type, handler) {
      events.set(type, handler);
    },
    removeEventListener(type) {
      events.delete(type);
    },
    dispatchEvent(event) {
      events.get(event.type)?.(event);
    }
  };
  const area = (data, areaName) => ({
    async get(keys) {
      if (keys === undefined) return { ...data };
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, data[key]]));
      return Object.fromEntries(Object.keys(keys).map((key) => [key, data[key] ?? keys[key]]));
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      for (const listener of listeners) listener(changes, areaName);
    }
  });
  const context = {
    console: { ...console, debug() {} },
    Date,
    Math,
    String,
    Number,
    RegExp,
    Object,
    Array,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type) { this.type = type; }
    },
    window,
    browser: {
      storage: {
        sync: area(syncData, 'sync'),
        local: area(localData, 'local'),
        onChanged: { addListener(listener) { listeners.push(listener); } }
      },
      runtime: { sendMessage() {} }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'classifier.js' });
  return { engine: context.SmartScroller, syncData, localData };
}

function baseContext(overrides = {}) {
  return makeContext({
    schemaVersion: 2,
    enabled: true,
    topics: [],
    sites: { youtube_shorts: true, youtube_home: true, instagram_reels: true },
    pauseUntil: 0,
    qualityEnabled: true,
    qualityMode: 'balanced',
    showReasons: true,
    ...overrides
  });
}

test('blurs a hype/listicle post and explains the decision', async () => {
  const { engine } = baseContext();
  const decision = await engine.review({
    id: '1',
    platform: 'companion',
    surface: 'companion',
    text: 'These 7 AI tools will replace your entire team. Comment PDF and I will send the guide.',
    links: [],
    media: []
  });

  assert.equal(decision.action, 'blur');
  assert.ok(decision.slopScore >= 0.8);
  assert.ok(decision.labels.includes('AI_HYPE'));
  assert.ok(decision.labels.includes('ENGAGEMENT_BAIT'));
  assert.ok(decision.reasons.length > 0);
});

test('keeps a concrete technical post visible even when it discusses AI', async () => {
  const { engine } = baseContext();
  const decision = await engine.review({
    id: '2',
    platform: 'companion',
    surface: 'companion',
    text: 'We replaced Redis with Postgres. The benchmark covered 2 million requests, the migration took 3 hours, and the repository is https://example.com/repo. In practice, latency improved by 18%, but write-heavy workloads still need a queue.',
    links: ['https://example.com/repo'],
    media: []
  });

  assert.equal(decision.action, 'show');
  assert.equal(decision.slopScore, 0);
  assert.ok(decision.labels.includes('PRIMARY_EVIDENCE'));
  assert.ok(decision.labels.includes('CAVEATED_ANALYSIS'));
});

test('preserves legacy topic filtering independently of quality filtering', async () => {
  const { engine } = baseContext({
    qualityEnabled: false,
    topics: [{ id: 'systems', name: 'Systems', keywords: ['distributed systems'] }]
  });
  const decision = await engine.review({
    id: '3',
    platform: 'youtube',
    surface: 'home',
    text: 'A cooking tutorial with a recipe for sourdough bread.',
    links: [],
    media: []
  });

  assert.equal(decision.relevance, 'unwanted');
  assert.equal(decision.action, 'blur');
  assert.match(decision.reasons[0], /selected topic/i);
});

test('an author allow rule overrides quality filtering but not topic filtering', async () => {
  const { engine } = baseContext();
  const item = {
    id: '4',
    platform: 'companion',
    surface: 'companion',
    authorKey: engine.hashAuthor('Ada Example'),
    text: 'These 7 AI tools will replace your entire team. Comment PDF.',
    links: [],
    media: []
  };
  const first = await engine.review(item);
  assert.equal(first.action, 'blur');
  await engine.recordFeedback({ decisionId: first.id, kind: 'always_allow_author' });
  const second = await engine.review(item);
  assert.equal(second.action, 'show');
  assert.match(second.reasons[0], /author is allowed/i);
});

test('feedback adjustments stay bounded and do not persist raw post text', async () => {
  const { engine, localData } = baseContext();
  const decision = await engine.review({
    id: '5',
    platform: 'companion',
    surface: 'companion',
    text: 'Everyone will be replaced by AI. Comment PDF.',
    links: [],
    media: []
  });
  for (let i = 0; i < 20; i++) {
    await engine.recordFeedback({ decisionId: decision.id, kind: 'slop' });
  }
  assert.ok(localData.feedback.labelAdjustments.UNSUPPORTED_CLAIM <= 0.15);
  assert.ok(!JSON.stringify(localData).includes('Everyone will be replaced'));
});

test('legacy settings migrate with quality filtering opt-in', async () => {
  const { engine, syncData } = makeContext({
    enabled: true,
    topics: [{ id: 'old', name: 'Old', keywords: ['old'] }],
    sites: { youtube_home: true },
    pauseUntil: 0
  });
  const settings = await engine.loadSettings();
  assert.equal(settings.schemaVersion, 2);
  assert.equal(settings.qualityEnabled, false);
  assert.equal(syncData.schemaVersion, 2);
});

test('disabled and paused states fail open', async () => {
  const disabled = baseContext({ enabled: false });
  const disabledDecision = await disabled.engine.review({ text: 'Everyone will be replaced by AI. Comment PDF.' });
  assert.equal(disabledDecision.action, 'show');

  const paused = baseContext({ pauseUntil: Date.now() + 60_000 });
  const pausedDecision = await paused.engine.review({ text: 'Everyone will be replaced by AI. Comment PDF.' });
  assert.equal(pausedDecision.action, 'show');
  assert.match(pausedDecision.reasons[0], /paused/i);
});

test('fact-check seam fails closed without a configured provider', async () => {
  const { engine } = baseContext();
  const result = await engine.FactChecker.check({ claim: 'A claim' });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reviews.length, 0);
});

test('adapter failures trip the local circuit breaker and fail open', async () => {
  const { engine } = baseContext();
  let emit;
  let resets = 0;
  const stop = engine.start({
    observe(callback) {
      emit = callback;
      return () => {};
    },
    present() {
      throw new Error('fixture adapter failure');
    },
    reset() {
      resets++;
    }
  });

  for (let i = 0; i < 5; i++) {
    emit({
      handle: {},
      item: { text: `A concrete fixture post ${i} with a benchmark and a source.` }
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(resets >= 1);
  stop();
});
