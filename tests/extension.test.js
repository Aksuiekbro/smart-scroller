const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plain(value) {
  return clone(value);
}

function storageGet(store, keys) {
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, clone(store[key])]));
  }
  if (typeof keys === 'string') {
    return { [keys]: clone(store[keys]) };
  }
  if (keys && typeof keys === 'object') {
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [
        key,
        store[key] === undefined ? clone(fallback) : clone(store[key])
      ])
    );
  }
  return clone(store) || {};
}

function createMockApi({ sync = {}, local = {} } = {}) {
  const syncStore = clone(sync) || {};
  const localStore = clone(local) || {};
  const storageChangedListeners = [];
  const sentMessages = [];
  const runtimeListeners = {
    installed: [],
    startup: [],
    message: []
  };
  let openOptionsCalls = 0;

  function makeArea(store, area) {
    return {
      async get(keys) {
        return storageGet(store, keys);
      },
      async set(values) {
        const changes = {};
        for (const [key, newValue] of Object.entries(values)) {
          changes[key] = { oldValue: clone(store[key]), newValue: clone(newValue) };
          store[key] = clone(newValue);
        }
        for (const listener of storageChangedListeners) {
          listener(changes, area);
        }
      }
    };
  }

  const api = {
    storage: {
      sync: makeArea(syncStore, 'sync'),
      local: makeArea(localStore, 'local'),
      onChanged: {
        addListener(listener) {
          storageChangedListeners.push(listener);
        }
      }
    },
    runtime: {
      sendMessage(message) {
        sentMessages.push(message);
      },
      openOptionsPage() {
        openOptionsCalls += 1;
      },
      onInstalled: {
        addListener(listener) {
          runtimeListeners.installed.push(listener);
        }
      },
      onStartup: {
        addListener(listener) {
          runtimeListeners.startup.push(listener);
        }
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.message.push(listener);
        }
      }
    }
  };

  return {
    api,
    syncStore,
    localStore,
    sentMessages,
    runtimeListeners,
    get openOptionsCalls() {
      return openOptionsCalls;
    }
  };
}

function loadClassifier(sync) {
  const harness = createMockApi({ sync });
  const dispatchedEvents = [];
  const context = {
    browser: harness.api,
    chrome: undefined,
    console,
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
    window: {
      dispatchEvent(event) {
        dispatchedEvents.push(event.type);
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'content/classifier.js'), 'utf8'),
    context,
    { filename: 'content/classifier.js' }
  );
  return { ...harness, SmartScroller: context.SmartScroller, dispatchedEvents };
}

function loadServiceWorker(stores) {
  const harness = createMockApi(stores);
  const context = {
    browser: harness.api,
    chrome: undefined,
    console,
    URL
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'background/service-worker.js'), 'utf8'),
    context,
    { filename: 'background/service-worker.js' }
  );
  return harness;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

test('manifest loads classifier before platform content scripts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const youtube = manifest.content_scripts.find((script) =>
    script.matches.includes('*://*.youtube.com/*')
  );
  const instagram = manifest.content_scripts.find((script) =>
    script.matches.includes('*://*.instagram.com/*')
  );

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(youtube.js, ['content/classifier.js', 'content/youtube.js']);
  assert.deepEqual(instagram.js, ['content/classifier.js', 'content/instagram.js']);
  assert.equal(youtube.all_frames, false);
  assert.equal(instagram.all_frames, false);
});

test('classifier blocks avoid topics before allowing learning-topic matches', async () => {
  const { SmartScroller } = loadClassifier({
    topics: [{ name: 'AI', keywords: ['ai'] }],
    blockedTopics: [{ name: 'Low value', keywords: ['drama'] }],
    filterMode: 'focus'
  });

  const result = await SmartScroller.classify({
    title: 'AI drama recap',
    author: '',
    description: '',
    hashtags: []
  });

  assert.equal(result.onTopic, false);
  assert.equal(result.reason, 'blocked');
  assert.deepEqual(plain(result.hits), [{ topic: 'Low value', keyword: 'drama' }]);
});

test('classifier supports Focus and Coach modes for neutral videos', async () => {
  const focus = loadClassifier({
    topics: [{ name: 'Programming', keywords: ['javascript'] }],
    blockedTopics: [{ name: 'Distractions', keywords: ['casino'] }],
    filterMode: 'focus'
  });
  const coach = loadClassifier({
    topics: [{ name: 'Programming', keywords: ['javascript'] }],
    blockedTopics: [{ name: 'Distractions', keywords: ['casino'] }],
    filterMode: 'coach'
  });
  const meta = { title: 'Woodworking basics', author: '', description: '', hashtags: [] };

  assert.deepEqual(plain(await focus.SmartScroller.classify(meta)), {
    onTopic: false,
    hits: [],
    reason: 'no-match'
  });
  assert.deepEqual(plain(await coach.SmartScroller.classify(meta)), {
    onTopic: true,
    hits: [],
    reason: 'neutral'
  });
});

test('classifier matches phrases, whole words, authors, descriptions, and expanded hashtags', async () => {
  const { SmartScroller } = loadClassifier({
    topics: [{ name: 'ML', keywords: ['machine learning', 'python', 'trusted author'] }],
    blockedTopics: [],
    filterMode: 'focus'
  });

  assert.equal((await SmartScroller.classify({
    title: '',
    author: '',
    description: '',
    hashtags: ['#MachineLearning']
  })).onTopic, true);
  assert.equal((await SmartScroller.classify({
    title: 'A python tutorial',
    author: '',
    description: '',
    hashtags: []
  })).onTopic, true);
  assert.equal((await SmartScroller.classify({
    title: 'Serpent documentary',
    author: '',
    description: 'No language keyword here',
    hashtags: []
  })).onTopic, false);
  assert.equal((await SmartScroller.classify({
    title: '',
    author: 'Trusted Author',
    description: '',
    hashtags: []
  })).onTopic, true);
});

test('classifier resets cached settings when sync storage changes', async () => {
  const { SmartScroller, api, dispatchedEvents } = loadClassifier({
    topics: [],
    blockedTopics: []
  });

  assert.equal((await SmartScroller.classify({
    title: 'Rust compiler internals',
    author: '',
    description: '',
    hashtags: []
  })).reason, 'no-topics');

  await api.storage.sync.set({
    topics: [{ name: 'Systems', keywords: ['rust'] }],
    blockedTopics: [],
    filterMode: 'focus'
  });

  assert.deepEqual(dispatchedEvents, ['ss:settings-changed']);
  assert.equal((await SmartScroller.classify({
    title: 'Rust compiler internals',
    author: '',
    description: '',
    hashtags: []
  })).reason, 'matched');
});

test('addBlockedKeyword normalizes, deduplicates, stores, and reports avoided stats', async () => {
  const { SmartScroller, syncStore, sentMessages } = loadClassifier({
    blockedTopics: []
  });

  assert.equal(await SmartScroller.addBlockedKeyword('@Bad Channel!'), true);
  assert.deepEqual(syncStore.blockedTopics, [
    {
      id: 'smart-muted',
      name: 'Muted by SmartScroller',
      keywords: ['bad channel']
    }
  ]);
  assert.deepEqual(plain(sentMessages), [{ type: 'ss:stat', kind: 'avoided' }]);

  assert.equal(await SmartScroller.addBlockedKeyword('bad channel'), false);
  assert.equal(syncStore.blockedTopics[0].keywords.length, 1);
  assert.equal(sentMessages.length, 1);
});

test('queueCandidate sends a local training candidate message', () => {
  const { SmartScroller, sentMessages } = loadClassifier({});

  assert.equal(SmartScroller.queueCandidate({
    source: 'youtube',
    title: 'Useful TypeScript Patterns',
    author: 'Example Dev',
    url: 'https://www.youtube.com/watch?v=abc123',
    topic: 'Programming'
  }), true);

  assert.deepEqual(plain(sentMessages), [
    {
      type: 'ss:queue-candidate',
      item: {
        source: 'youtube',
        title: 'Useful TypeScript Patterns',
        author: 'Example Dev',
        url: 'https://www.youtube.com/watch?v=abc123',
        topic: 'Programming'
      }
    }
  ]);
});

test('service worker seeds new feed-steering defaults on install', async () => {
  const harness = loadServiceWorker({ sync: {}, local: {} });

  await harness.runtimeListeners.installed[0]();

  assert.equal(harness.syncStore.enabled, true);
  assert.equal(harness.syncStore.filterMode, 'focus');
  assert.equal(harness.syncStore.prehideUnknown, false);
  assert.equal(harness.syncStore.hardHideOffTopic, false);
  assert.equal(harness.syncStore.blockShortsSurfaces, false);
  assert.equal(harness.syncStore.blockedTopics[0].id, 'low-value');
  assert.equal(harness.syncStore.sites.youtube_home, true);
  assert.deepEqual(harness.localStore.trainingQueue, []);
  assert.deepEqual(Object.keys(harness.localStore.stats).sort(), [
    'allowed',
    'avoided',
    'blurred',
    'day',
    'tuned'
  ]);
  assert.equal(harness.openOptionsCalls, 1);
});

test('service worker increments and backfills stats counters', async () => {
  const harness = loadServiceWorker({
    local: { stats: { day: today(), blurred: 2, allowed: 3 } }
  });
  const listener = harness.runtimeListeners.message[0];

  const response = await new Promise((resolve) => {
    const keepAlive = listener({ type: 'ss:stat', kind: 'tuned' }, {}, resolve);
    assert.equal(keepAlive, true);
  });

  assert.equal(response.ok, true);
  assert.deepEqual(harness.localStore.stats, {
    day: today(),
    blurred: 2,
    allowed: 3,
    tuned: 1,
    avoided: 0
  });
});

test('service worker sanitizes and deduplicates training queue candidates', async () => {
  const harness = loadServiceWorker({
    local: {
      trainingQueue: [
        {
          source: 'youtube',
          title: 'Older item',
          author: 'Older author',
          topic: 'Programming',
          url: 'https://www.youtube.com/watch?v=old',
          addedAt: 1
        }
      ]
    }
  });
  const listener = harness.runtimeListeners.message[0];

  const response = await new Promise((resolve) => {
    listener({
      type: 'ss:queue-candidate',
      item: {
        title: '  Better   Rust  ',
        author: ' Systems Channel ',
        topic: ' Programming ',
        url: 'https://www.youtube.com/watch?v=rust123&list=ignored'
      }
    }, {}, resolve);
  });

  assert.equal(response.ok, true);
  assert.equal(response.added, true);
  assert.equal(response.count, 2);
  assert.equal(harness.localStore.trainingQueue[0].title, 'Better Rust');
  assert.equal(harness.localStore.trainingQueue[0].author, 'Systems Channel');
  assert.equal(harness.localStore.trainingQueue[0].topic, 'Programming');
  assert.equal(harness.localStore.trainingQueue[0].url, 'https://www.youtube.com/watch?v=rust123');

  const duplicate = await new Promise((resolve) => {
    listener({
      type: 'ss:queue-candidate',
      item: {
        title: 'Better Rust, refreshed',
        url: 'https://www.youtube.com/watch?v=rust123'
      }
    }, {}, resolve);
  });

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.added, false);
  assert.equal(harness.localStore.trainingQueue.length, 2);
  assert.equal(harness.localStore.trainingQueue[0].title, 'Better Rust, refreshed');
});

test('service worker rejects invalid training queue candidates', async () => {
  const harness = loadServiceWorker({ local: { trainingQueue: [] } });
  const listener = harness.runtimeListeners.message[0];

  const response = await new Promise((resolve) => {
    listener({
      type: 'ss:queue-candidate',
      item: {
        title: 'External video',
        url: 'https://example.com/watch?v=not-youtube'
      }
    }, {}, resolve);
  });

  assert.deepEqual(plain(response), { ok: false, error: 'invalid-item' });
  assert.deepEqual(harness.localStore.trainingQueue, []);
});
