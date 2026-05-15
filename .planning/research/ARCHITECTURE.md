# Architecture Research

**Domain:** Browser extension (MV3) — YouTube/Instagram content filter with on-device semantic embeddings, primary target iOS Safari Web Extension (Orion iOS)
**Researched:** 2026-05-15
**Confidence:** MEDIUM-HIGH (component placement and constraints HIGH; Orion-specific quirks MEDIUM — Orion iOS is not separately documented, treated as standard Safari Web Extension on WebKit)

---

## TL;DR

**Verdict:** Keep the v0.1 four-context model. Do **not** introduce an offscreen document — it does not exist on iOS Safari. Instead, push the embedding model into the **content script's isolated world** (loaded once per tab, lazy on first uncertain video), keep transcript fetching in the **content script** (same-origin, no CORS friction), and store classification results in **`chrome.storage.local`** (small, structured) with embeddings cached in **IndexedDB** (large, opaque blobs). The service worker stays an aggregator — never load the model there, because iOS kills it.

The v1.0 architecture is therefore **v0.1 + two new modules inside the content-script isolated world + two new persistent caches**. No new top-level contexts.

---

## Standard Architecture

### v0.1 → v1.0 System Overview

The diagram below shows the full v1.0 architecture. Boxes marked **`[NEW v1.0]`** are added in this milestone. Everything else is preserved from v0.1.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER SURFACES (unchanged from v0.1)                                         │
├──────────────────────────────────────┬──────────────────────────────────────┤
│  Popup (popup/popup.{html,js,css})   │  Options (options/options.{html,js}) │
│  enable / pause / today's stats      │  topics, sites, pause, threshold     │
│                                      │  [NEW v1.0] semantic threshold slider│
│                                      │  [NEW v1.0] cache stats + clear-btn  │
└──────────────┬───────────────────────┴───────────────────────┬──────────────┘
               │ read/write                     read/write     │
               ▼                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  chrome.storage  (the settings/stats bus — unchanged)                        │
│  storage.sync  : enabled, topics[], sites{}, pauseUntil,                     │
│                  [NEW] semanticThreshold, [NEW] topicEmbeddings{topicId:f32} │
│  storage.local : stats{day,blurred,allowed}, [NEW] verdictCache (LRU)        │
└──────────────▲────────────────────────────────────────────▲─────────────────┘
               │  storage.onChanged                         │ storage.sync.get
               │                                            │
┌──────────────┴────────────────────┐    ┌─────────────────┴──────────────────┐
│  Background service worker (MV3)  │    │  Content script (per tab)          │
│  background/service-worker.js     │    │  isolated world, two-IIFE module-  │
│  - seeds DEFAULTS on install      │    │  on-globalThis pattern             │
│  - rolls daily stats              │    │                                    │
│  - [NEW] handles 'ss:precompute-  │    │  ┌──────────────────────────────┐  │
│    topic-embeddings' from options │    │  │ content/classifier.js (v0.1) │  │
│    page — orchestrates only,      │    │  │  keyword tier (Tier 1)       │  │
│    does NOT load model            │    │  │  publishes globalThis.       │  │
│  - 'ss:stat' aggregator           │    │  │  SmartScroller               │  │
│                                   │    │  └──────────────┬───────────────┘  │
│  ❌ NEVER loads model             │    │                 │ extends           │
│  ❌ NEVER fetches transcripts     │    │                 ▼                   │
│  (iOS kills it; 64MB msg cap)     │    │  ┌──────────────────────────────┐  │
└───────────────────────────────────┘    │  │ [NEW] content/transcript.js  │  │
                                         │  │  fetch ytInitialPlayerResp.  │  │
                                         │  │  caption track XML/JSON      │  │
                                         │  │  (same-origin, no CORS)      │  │
                                         │  │  in-tab LRU keyed by videoId │  │
                                         │  └──────────────┬───────────────┘  │
                                         │                 ▼                   │
                                         │  ┌──────────────────────────────┐  │
                                         │  │ [NEW] content/embedder.js    │  │
                                         │  │  lazy-load Transformers.js + │  │
                                         │  │  Xenova/all-MiniLM-L6-v2     │  │
                                         │  │  (~23MB INT8, WASM backend)  │  │
                                         │  │  embed(text) → Float32(384)  │  │
                                         │  │  cosine(topicVec, vidVec)    │  │
                                         │  │  classifySemantic(meta,txt)  │  │
                                         │  │  Tier 2 — only when Tier 1   │  │
                                         │  │  is inconclusive             │  │
                                         │  └──────────────┬───────────────┘  │
                                         │                 │                   │
                                         │                 ▼                   │
                                         │  ┌──────────────────────────────┐  │
                                         │  │ [NEW] content/cache.js       │  │
                                         │  │  IndexedDB wrapper:          │  │
                                         │  │   - 'verdicts' store         │  │
                                         │  │     (videoId → {onTopic,     │  │
                                         │  │      score, ts, tier})       │  │
                                         │  │   - 'embeddings' store       │  │
                                         │  │     (videoId → Float32Array) │  │
                                         │  │   - 'modelBlobs' store       │  │
                                         │  │     (Transformers.js auto-   │  │
                                         │  │      caches here via its     │  │
                                         │  │      built-in cache layer)   │  │
                                         │  │  LRU evict at ~50MB soft cap │  │
                                         │  └──────────────────────────────┘  │
                                         │                                    │
                                         │  ┌──────────────────────────────┐  │
                                         │  │ content/youtube.js (v0.1++)  │  │
                                         │  │ content/instagram.js (v0.1)  │  │
                                         │  │  [+ mobile selectors:        │  │
                                         │  │    ytm-shorts-lockup-view-   │  │
                                         │  │    model, ytm-reel-shelf-    │  │
                                         │  │    renderer for m.youtube]   │  │
                                         │  │  DOM scan + MutationObserver │  │
                                         │  │  + SPA URL poller            │  │
                                         │  └──────────────────────────────┘  │
                                         └────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | File | Status |
|-----------|----------------|------|--------|
| Service worker | Lifecycle seeding, daily stats roll, stat aggregation, topic-embedding precompute orchestration *(message-only — never loads the model itself)* | `background/service-worker.js` | v0.1 + thin extension |
| Keyword classifier (Tier 1) | Normalize text, match `topic.keywords[]`, return early verdict | `content/classifier.js` | v0.1 |
| Transcript fetcher | From DOM, read `ytInitialPlayerResponse.captions`, fetch caption track XML, return plain text | `content/transcript.js` | **NEW v1.0** |
| Embedder + semantic classifier (Tier 2) | Lazy-load Transformers.js + MiniLM, embed video text, cosine-vs-topic, threshold gate | `content/embedder.js` | **NEW v1.0** |
| Verdict + embeddings cache | IndexedDB-backed cache keyed by `videoId`; expose `get`, `put`, `evictOldest` | `content/cache.js` | **NEW v1.0** |
| YouTube host script | DOM discovery, metadata extraction, blur overlay + mobile selectors for `m.youtube.com` | `content/youtube.js` | v0.1 + mobile selectors |
| Instagram host script | DOM discovery, caption extraction, blur overlay | `content/instagram.js` | v0.1 (caption-only — no transcripts available) |
| Options page | Topic editor, semantic threshold slider, cache-clear button | `options/options.{html,js,css}` | v0.1 + 2 controls |
| Popup | Enable/pause/stats — unchanged | `popup/popup.{html,js,css}` | v0.1 |
| Manifest | Add `web_accessible_resources` for model assets + WASM; declare `host_permissions` for transcript fetch endpoints | `manifest.json` | v0.1 + 2 keys |

---

## Recommended Project Structure (v1.0)

```text
smartscroller/
├── manifest.json                       # + web_accessible_resources for assets/
├── README.md
├── background/
│   └── service-worker.js               # + 'ss:precompute-topic-embeddings' message
├── content/
│   ├── classifier.js                   # Tier 1 + publishes globalThis.SmartScroller
│   ├── transcript.js                   # NEW — YouTube transcript fetcher
│   ├── embedder.js                     # NEW — Transformers.js + MiniLM + cosine
│   ├── cache.js                        # NEW — IndexedDB wrapper (verdicts + vectors)
│   ├── youtube.js                      # + mobile (m.youtube.com) selectors
│   ├── instagram.js                    # unchanged (caption-only)
│   └── common.css
├── options/
│   ├── options.html                    # + threshold slider, cache-clear
│   ├── options.js                      # + precompute trigger on topic save
│   └── options.css
├── popup/
│   └── popup.{html,js,css}             # unchanged
├── assets/                             # NEW directory
│   ├── transformers.min.js             # bundled Transformers.js (no CDN — offline)
│   ├── ort-wasm-simd-threaded.wasm     # ONNX runtime WASM
│   ├── ort-wasm-simd-threaded.jsep.wasm
│   └── models/
│       └── Xenova/all-MiniLM-L6-v2/    # model.onnx_int8 + tokenizer.json + config.json
└── .planning/                          # not shipped
```

### Structure Rationale

- **`content/` gains three new files**, not new top-level dirs. Browser extensions are flat by convention, and every new content-script file must be listed in `manifest.json` in load order (`classifier.js` first, then helpers, then host scripts). Keeping the new modules in `content/` matches the v0.1 convention documented in `STRUCTURE.md:39-52`.
- **`assets/` is new and must be in `web_accessible_resources`** so the content script can `chrome.runtime.getURL('assets/...')` and Transformers.js can fetch the WASM and model files via that URL. This is the established pattern from the Hugging Face Chrome-extension guide.
- **No `offscreen/` directory**, despite `STRUCTURE.md:165-172` floating it as future work. iOS Safari Web Extensions do not support `chrome.offscreen` — see Anti-Pattern 1 below. Running the model in the content script's isolated world is the only portable option.
- **No `src/` vs `dist/` split.** v0.1 has no build step; v1.0 introduces a one-time vendor copy of Transformers.js + WASM + model into `assets/` but does not need a bundler. Transformers.js ships pre-built ESM/UMD; we copy the UMD build into `assets/transformers.min.js` and reference via a `<script>` injected through `chrome.scripting`-less path (i.e. dynamic `import()` inside the content script, or eager load via manifest).

---

## Architectural Patterns

### Pattern 1: Tiered Classifier — Cheap First, Expensive Only on Doubt

**What:** Three sequential tiers, each gating the next. Most videos exit after Tier 1.

```text
process(el, meta)
  │
  ├─► Tier 0 — short-circuits (settings disabled, paused, no topics, empty meta)
  │     └─► return onTopic:true   (~50 µs)
  │
  ├─► Tier 1 — keyword match on (title + author + description + hashtags)
  │     ├─► hit  → return onTopic:true,  reason:'keyword-hit'   (~200 µs)
  │     └─► miss → continue                                       (Tier 2)
  │
  ├─► Cache check  — verdictCache.get(videoId)
  │     └─► hit  → return cached verdict                          (~5 ms IDB)
  │
  ├─► Tier 2a — transcript fetch
  │     ├─► success → embed(transcript[:512 tokens])              (~80 ms first time, ~30 ms warm)
  │     │              cosine vs each topic embedding             (~50 µs)
  │     │              max(cosine) ≥ threshold → onTopic:true     (default 0.55)
  │     └─► no transcript → Tier 2b
  │
  └─► Tier 2b — fallback: embed(title + description) only         (~30 ms)
        ├─► cosine ≥ threshold → onTopic:true
        └─► else                → onTopic:false (BLUR)
```

**When to use:** Always. The keyword tier remains the right first filter (the v0.1 `CONCERNS.md:295-302` analysis is correct: 60k keyword-ops/scan is well under a frame budget; an embedding-only design would be 1000× slower per item).

**Trade-offs:**
- (+) Fast path stays fast. ~95% of "AI lawsuit"-vs-"AI engineering" miscalls happen on items that *don't* match keywords today; those are the items that escalate.
- (+) Semantic cost is bounded by cache hit rate. Once a video is classified, its verdict is permanent (cache is keyed by `videoId`, never re-computed).
- (–) Threshold tuning is per-user. Default 0.55 from the `README.md:73` roadmap note; expose a slider.
- (–) Tier 2b (no-transcript fallback) is weaker than Tier 2a. Title-only embeddings are noisier than transcript embeddings, so the threshold may need to be a touch lower for this branch (or accept higher false-positive blur rate on captionless videos — this is acceptable for Shorts where titles are usually descriptive).

**Decision flow when transcript is unavailable** (call this out explicitly per the quality gate):

```text
fetchTranscript(videoId)
  │
  ├─► ytInitialPlayerResponse.captions is missing entirely
  │     │ (live streams, music videos with no auto-captions, age-restricted,
  │     │  brand-new uploads before auto-captions process)
  │     └─► fall through to Tier 2b (title+description embedding only)
  │
  ├─► captionTracks exists but only contains non-target languages
  │     └─► pick first available; MiniLM is English-trained but tolerates
  │         common Romance/Germanic languages (lower accuracy expected)
  │
  ├─► caption track URL fetch returns 4xx/5xx
  │     │ (YouTube periodically rotates the signed URL format)
  │     └─► Tier 2b fallback, AND record a "transcript-fetch-failed"
  │         signal in storage.local for debugging
  │
  └─► success → parse XML or JSON3, strip <c>/<i>/<b> tags, dedupe lines,
      truncate to ~512 tokens (~2000 chars), embed
```

### Pattern 2: Model-In-Content-Script (Per-Tab, Lazy)

**What:** Load Transformers.js + MiniLM **inside the content-script isolated world**, on the **first** Tier-2 escalation in that tab. Once loaded, hold in module scope and reuse for every subsequent classification in that tab.

```javascript
// content/embedder.js — outline
(function () {
  const SS = globalThis.SmartScroller;
  let pipeline = null;        // null = not loaded, Promise = loading, fn = ready
  let topicVecs = null;       // Map<topicId, Float32Array(384)>

  async function ensureLoaded() {
    if (pipeline) return pipeline;
    pipeline = (async () => {
      // dynamic import of bundled UMD
      await import(chrome.runtime.getURL('assets/transformers.min.js'));
      const { pipeline: p, env } = self.transformers;
      env.allowRemoteModels = false;
      env.allowLocalModels  = true;
      env.localModelPath    = chrome.runtime.getURL('assets/models/');
      env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('assets/');
      env.backends.onnx.wasm.numThreads = 1; // iOS Safari: single-thread WASM is more predictable
      return await p('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
    })();
    return pipeline;
  }

  async function embed(text) {
    const fn = await ensureLoaded();
    const out = await fn(text, { pooling: 'mean', normalize: true });
    return out.data; // Float32Array(384)
  }

  async function classifySemantic(meta, transcript) {
    const text = transcript || `${meta.title}. ${meta.description}`;
    const vec  = await embed(text.slice(0, 2000));
    if (!topicVecs) topicVecs = await SS.loadTopicEmbeddings();
    let best = 0;
    for (const tv of topicVecs.values()) best = Math.max(best, cosine(vec, tv));
    const threshold = (await SS.loadSettings()).semanticThreshold ?? 0.55;
    return { onTopic: best >= threshold, score: best };
  }

  SS.classifySemantic = classifySemantic;
  SS.precomputeTopicEmbedding = async (text) => Array.from(await embed(text));
})();
```

**When to use:** When you need ML inference inside a WebExtension that must run on iOS Safari. There is no other portable option.

**Trade-offs:**
- (+) **Survives iOS service-worker termination.** The page (and its content scripts) lives independent of the SW. If the SW is killed (which iOS does at ~80% RAM or after ~30–45s on iOS 17.4+, per the Apple Developer Forums report), the model stays loaded in the tab.
- (+) **No message-passing on the hot path.** Background-worker hosted models require `runtime.sendMessage` round trips per classification; on iOS that has a 64MB payload cap and adds latency.
- (–) **Per-tab cost.** If the user has 3 YouTube tabs open, the model loads 3 times (~23MB × 3 = ~69MB of JS heap across tabs). Mitigated by the fact that v1.0 use is overwhelmingly single-tab (scrolling Shorts on a phone), and by Transformers.js auto-caching the model weights in IndexedDB so subsequent loads after first install are fast (~80ms parse, not a 23MB download).
- (–) **Page CPU contention.** Inference will happen on the page's main thread, contending with YouTube's renderer. Mitigated by Tier-1 short-circuiting (~95% of items never reach Tier 2) and by debouncing on the existing `scheduleScan()` (250ms).
- (–) **Cold start.** First Tier-2 escalation in a session pays ~500ms–1s for `pipeline = await p(...)` (parse WASM, instantiate ONNX runtime, load tokenizer). Hide this from the user by making the first uncertain video keyword-pass through ("don't blur until we're sure"), which is the fail-open posture v0.1 already uses (`content/classifier.js:77-99`).

### Pattern 3: Two-Cache Strategy — `chrome.storage.local` for Verdicts, IndexedDB for Vectors

**What:** Two physically separate caches with different shapes and quotas.

| Cache | Backend | Shape | Size budget | Why |
|-------|---------|-------|-------------|-----|
| Verdict cache | `chrome.storage.local` | `{ [videoId]: { onTopic: bool, score: f32, tier: 1\|2a\|2b, ts: int } }` | ~1MB (5k entries × ~200B) | Small, structured, queryable, survives SW restart. `storage.local` has a 10MB extension quota (`unlimitedStorage` would push it higher but is iOS-fragile). |
| Vector cache | IndexedDB (`smartscroller-cache` DB) | `{ videoId: string, vec: Float32Array(384), ts: int }` | ~50MB soft cap (~32k entries × ~1.6KB) | Float32Array blobs are wasteful in JSON; IndexedDB stores them natively as `ArrayBuffer`. Plus Transformers.js's own model-weight cache is already in IDB, so we're already using that storage layer. |
| Model weights | IndexedDB (managed by Transformers.js) | opaque ONNX blobs | ~23MB | Auto-managed. First call downloads from `web_accessible_resources` (a `chrome-extension://` URL, instant), parses, and caches. Subsequent loads are instant-parse. |

**When to use:** Always for v1.0. Splitting by access pattern is the right call because the verdict cache is read on **every** scan (hot path), while the vector cache is read only when a topic-list change forces recomputation (cold path).

**Trade-offs:**
- (+) Verdict-cache reads via `chrome.storage.local.get(videoId)` are SW-friendly (the popup and options page can introspect verdict counts for the cache-stats UI without opening an IDB connection).
- (+) Vector cache stays in the content-script context where it's actually used. No cross-context serialisation of `Float32Array`s.
- (–) Two caches mean two eviction policies. Verdict cache uses simple "if size > 5k, drop oldest 10%" inside the SW (cheap, runs on `onAlarm` once a day). Vector cache uses the same policy inside the content script (runs on `cache.put` if `await navigator.storage.estimate()` shows we're over budget).
- (–) On iOS, **WebKit may evict either cache after 7 days of no extension use** (the "7-day rule" per the WebKit storage policy update). For a personal tool used daily this is irrelevant; for a sporadic user it would mean re-classifying everything. Document this; don't fight it.

**Eviction policy summary:**

```text
verdictCache:
  - LRU by ts
  - hard cap 5000 entries
  - daily roll: alarm fires, SW reads, drops oldest 10% if over cap
  - cleared explicitly on options-page "Clear cache" button

vectorCache (IDB):
  - LRU by ts
  - soft cap when navigator.storage.estimate().usage > 50MB
  - drop oldest 1000 entries when over
  - cleared automatically on topic-list change (vectors are not invalidated by
    topic changes — only verdicts are — so this is just a size guard)

modelBlobs (IDB, Transformers.js):
  - managed by Transformers.js; left alone
  - WebKit may evict after 7 days no activity; first call re-downloads from
    web_accessible_resources (fast: it's a chrome-extension:// URL, no network)
```

### Pattern 4: Topic Embeddings Precomputed at Save Time

**What:** When the user saves a topic in the options page, precompute its embedding **once**, store the 384-float vector in `chrome.storage.sync` under the topic record. Content scripts read the vector — they never re-embed topics.

```text
options.js: user clicks save on topic "AI engineering"
  │
  ├─► debounced save runs
  ├─► chrome.runtime.sendMessage({ type: 'ss:precompute-topic-embeddings',
  │     topics: [{ id, name, keywords }] })
  │
  └─► SW receives message
        │
        ├─► SW does NOT load model (iOS would kill it)
        ├─► SW forwards to a YouTube/Instagram tab via tabs.sendMessage,
        │   OR (cleaner) opens a hidden tab on a chrome-extension:// URL
        │   that injects embedder.js. Approach TBD in implementation.
        │
        └─► tab embeds(topic.name + " " + topic.keywords.join(" "))
            returns Float32(384) → SW writes back to
            storage.sync.topicEmbeddings[topic.id]
```

**When to use:** Whenever topic vectors must be available to fresh tabs without re-embedding. The alternative (each tab embeds topics on first run) wastes ~50ms × N tabs and burns model-cold-start time on every tab open.

**Trade-offs:**
- (+) Content scripts can start classifying within milliseconds — no per-tab topic-embedding warmup.
- (+) Topic vectors are tiny (~1.5KB each × 20 topics = 30KB — comfortably under the 100KB `storage.sync` quota).
- (–) Requires a slightly contrived workflow on save (route through a YouTube tab that already has the model loaded, or open a hidden `chrome-extension://`-URL page just to run the model once). On iOS, the cleaner solution is to **let the next YouTube tab load opportunistically embed** any topics missing a vector in storage, and write back. This trades one-time first-classify latency for architectural simplicity. **Recommendation: opportunistic embed-and-write-back, not eager precompute.**

---

## Data Flow

### Primary Path — User Scrolls to a Short, Decision is Blur or Pass-Through

```text
1. User scrolls. YouTube renders a new ytm-shorts-lockup-view-model into the DOM.

2. MutationObserver in content/youtube.js fires.
   scheduleScan() debounces 250ms, then scan() runs.

3. scan() finds the new element, calls process(el, 'short').

4. process() extracts meta = { title, author, description, hashtags, videoId }
   (videoId is NEW — pulled from href "/shorts/<id>" or data-context-item-id).

5. process() consults SS.loadSettings() (cached). Site enabled? Not paused? OK.

6. ╔ Tier 0 short-circuits ═══════════════════════════════════════════════╗
   ║   classify() returns {onTopic:true, reason:'disabled'/'paused'/...}  ║
   ║   → no blur, mark data-ss-state='checked'                            ║
   ╚══════════════════════════════════════════════════════════════════════╝
   else continue.

7. ╔ Cache check ════════════════════════════════════════════════════════╗
   ║   verdict = await SS.cache.getVerdict(videoId)                      ║
   ║   if verdict exists and !staleByTopicChange:                        ║
   ║       skip to step 12 with the cached verdict                       ║
   ╚══════════════════════════════════════════════════════════════════════╝

8. ╔ Tier 1 — Keyword (existing v0.1 logic) ═════════════════════════════╗
   ║   result = SS.classify(meta)                                         ║
   ║   if result.onTopic: cache as {onTopic:true, tier:1}, goto 12       ║
   ║   else: continue                                                     ║
   ╚══════════════════════════════════════════════════════════════════════╝

9. ╔ Tier 2a — Transcript fetch ══════════════════════════════════════════╗
   ║   transcript = await SS.transcript.fetch(videoId)                    ║
   ║      reads window.__INITIAL_PLAYER_RESPONSE__ or extracts from        ║
   ║      ytInitialPlayerResponse via document HTML if not in window;     ║
   ║      pulls captionTracks[0].baseUrl, fetches it (same-origin: no     ║
   ║      CORS); parses XML <text> nodes → plain string                  ║
   ║   if transcript == null: goto step 10 (Tier 2b)                      ║
   ║   else:                                                              ║
   ║       vec = await SS.embedder.embed(transcript.slice(0,2000))        ║
   ║       await SS.cache.putVector(videoId, vec)                         ║
   ║       score = max(cosine(vec, topicVec) for topicVec in loadedTopics)║
   ║       onTopic = score >= settings.semanticThreshold                  ║
   ║       cache as {onTopic, score, tier:'2a'}; goto 12                  ║
   ╚══════════════════════════════════════════════════════════════════════╝

10. ╔ Tier 2b — Title+description fallback ═══════════════════════════════╗
    ║   text = `${meta.title}. ${meta.description}`                       ║
    ║   vec = await SS.embedder.embed(text)                               ║
    ║   score = max(cosine(...))                                          ║
    ║   onTopic = score >= settings.semanticThreshold                     ║
    ║   cache as {onTopic, score, tier:'2b'}; continue to 12              ║
    ╚══════════════════════════════════════════════════════════════════════╝

11. (No step 11 — flow jumps 10 → 12.)

12. Apply verdict.
    if !onTopic: applyBlur(el, meta); SS.reportStat('blurred')
    else:        mark data-ss-state='checked'; SS.reportStat('allowed')
```

### Settings Change → Re-Classify

Identical to v0.1 (storage.onChanged → null cache → ss:settings-changed event → strip state → rescan), with one addition: **a topic-list change also invalidates the verdict cache**. Vector cache stays — embeddings are stable; only the cosine threshold + topic set changed. The SW listens for `storage.sync.onChanged` for `topics`, then sets a "verdict-cache-epoch" counter in `storage.local`. On the next scan, the content script sees the epoch bumped and discards cached verdicts.

### Topic Embedding Compute (Opportunistic)

```text
1. options.js: user adds topic "Anthropic news". Debounced save fires.
2. storage.sync.set({ topics: [..., {id, name, keywords, embedding: null}] })
3. Service worker sees no embedding for this topic — does NOT compute.
4. Next time a YouTube tab loads (or runs a scan), content/embedder.js
   notices a topic with embedding:null, computes it, writes it back via
   chrome.storage.sync.set under that topic's id. All other tabs pick it
   up via storage.onChanged.
```

---

## Scaling Considerations

This is a single-user personal tool — "scaling" here means **single-user growth**: more topics, more videos, longer use.

| Scale axis | Approach |
|-----------|----------|
| **Topics:** 1 → 20 | Linear in cosine compute: 20 × 384 mul-adds per classify ≈ 7680 ops ≈ <0.1 ms. Trivial. |
| **Topics:** 20 → 200 | Still <1 ms cosine. Bottleneck moves to `storage.sync` quota (~100KB total, 8KB per item) — at 200 topics × ~700B/topic-vector = 140KB. **Migrate `topicEmbeddings` from `storage.sync` to `storage.local`** when topic count crosses ~50, with topics-list staying in sync. |
| **Videos classified:** 0 → 5k | LRU cap holds. No action. |
| **Videos classified:** 5k → 50k | Evict oldest at LRU cap on both caches. |
| **Session length:** model loaded for hours | JS heap holds ~30–40MB resident (Transformers.js + MiniLM + tokenizer + topic vectors). Comfortable inside 80MB iOS extension memory limit, but **leave headroom** — large pages (YouTube watch with many comments) eat into the same 80MB. Monitor with `performance.memory` if available. |
| **Days idle:** 7+ | WebKit may evict IDB caches (the 7-day rule). First post-eviction session re-downloads model from `chrome-extension://` URL (instant), re-embeds first ~20 videos slower (Tier 2 cold). Acceptable. |

### Scaling Priorities

1. **First bottleneck: iOS extension memory ceiling (80MB).** The ~23MB MiniLM ONNX blob + ~10–15MB WASM runtime + per-tab JS heap means the model is non-trivial against the limit. Mitigation: keep the embedding model size as the **non-negotiable budget** (don't upgrade to MiniLM-L12 or larger without measuring). Aggressively GC topic-vec Maps when the tab is hidden.
2. **Second bottleneck: model cold start UX (~500ms–1s on first Tier-2 escalation).** Mitigation: fail-open during cold start — keyword-uncertain items pass through unblurred for the first ~1s of a session, then the next scan applies the missed blurs. The current `data-ss-state` rescan-on-settings-change loop already handles this without modification.
3. **Third bottleneck: transcript fetch failures.** If YouTube rotates the caption URL signing scheme, every Tier-2a path collapses to Tier-2b (title-only). Mitigation: log failure rate; if >50% over a day, surface a banner in options. Title-only embeddings still beat keyword-only.

---

## Anti-Patterns

### Anti-Pattern 1: Use an Offscreen Document for the Embedding Model

**What people do:** Read the Chrome `chrome.offscreen` docs (or the Hugging Face Chrome-extension guide), assume that's the recommended place for models, set up `offscreen/embedder.html` + `offscreen/embedder.js` and route messages through the service worker.

**Why it's wrong:**
- **`chrome.offscreen` is not available on iOS Safari Web Extensions.** Safari's stance on the W3C WebExtensions issue tracker is "not opposed or supportive", meaning no implementation. Chrome ships it; Safari doesn't. An offscreen-document architecture would simply not run on Orion iOS — the primary target.
- Even on Chrome desktop, `chrome.offscreen` only delays the inevitable — the service worker still has to message-pass to it, and iOS has neither.

**Do this instead:** Load the model in the **content-script isolated world** (Pattern 2 above). The model lives in the tab, lives as long as the tab, and survives service-worker termination. This is the only architecture that works on both Chrome (where offscreen exists but is unnecessary) and iOS Safari (where offscreen doesn't exist).

### Anti-Pattern 2: Load the Embedding Model in the Background Service Worker

**What people do:** Treat the service worker as "the backend" and put Transformers.js there, classifying via `runtime.sendMessage({type:'classify', meta})` from content scripts.

**Why it's wrong:**
- **iOS Safari aggressively kills the service worker.** From iOS 17.4 onward, multiple developers report the SW being permanently killed ~30–45 seconds after install, never to wake again. Even when it does wake, iOS terminates it at ~80% device RAM. A 23MB model in there is a tombstone.
- **`runtime.sendMessage` has a 64MB payload cap on iOS** (per Apple's documentation cited in the developer forums) and adds latency to every classify call.
- The SW has no DOM, no `Float32Array` views over `ArrayBuffer`s that survive a `postMessage` roundtrip without copying.

**Do this instead:** Same as Anti-Pattern 1 — model in content script. SW does only what it already does well: stat aggregation, lifecycle seeding, and *orchestrating* (not performing) topic-embedding precompute.

### Anti-Pattern 3: Fetch Transcripts from the Service Worker

**What people do:** "Network requests belong in the background worker" — set up `fetch(youtubeCaptionUrl)` in the SW, route results back to content scripts.

**Why it's wrong:**
- **YouTube transcript URLs require same-origin context.** The caption-track URLs are signed with parameters that assume the request originates from a `youtube.com` page; cross-origin requests get rejected or rate-limited. Content scripts run in the page's isolated world but share its origin for `fetch` purposes, so `fetch(captionUrl)` from a content script is same-origin.
- Service workers must request `host_permissions` for every fetched origin, and the URL signing scheme means a CORS preflight is added unnecessarily.
- It serialises the captions XML across the SW boundary for no gain.

**Do this instead:** Fetch from the content script, period. The `ytInitialPlayerResponse` is on the same page; the caption URL is one `fetch()` away with no CORS friction.

### Anti-Pattern 4: Store Verdicts in `chrome.storage.sync`

**What people do:** Add `verdictCache` to the existing `storage.sync` payload "for consistency".

**Why it's wrong:**
- `storage.sync` has an **8KB per-item, 100KB total quota**. Verdict cache will blow this in ~50 videos.
- `storage.sync` writes are rate-limited (120 ops/minute on Chrome) and replicated across the user's devices — neither needed for an ephemeral cache.

**Do this instead:** Verdicts in `storage.local` (10MB quota, no rate limit, local-only). Embeddings in IndexedDB (gigabytes available). Settings stay in `storage.sync`.

### Anti-Pattern 5: Re-Embed Topics on Every Classify

**What people do:** `for each video: for each topic: embedAndCosine(topic, video)`.

**Why it's wrong:**
- A topic embedding is deterministic per `(topic.name + topic.keywords)`. Computing it on every classify means N × M × inference where the M dimension is pure waste.
- 20 topics × 30ms each = 600ms per scan. That's a stalled frame on iOS.

**Do this instead:** Embed each topic **once** (lazy, on first use, opportunistically — see Pattern 4), persist the 384-float vector in `storage.sync.topicEmbeddings`, invalidate only when that topic's text changes.

### Anti-Pattern 6: Trust the Service Worker to Live Across Days for Stats Roll

**What people do:** "Daily stats roll happens on the SW alarm." (Inherited concern from v0.1, see `CONCERNS.md:142-158`.)

**Why it's wrong (on iOS):**
- iOS may suspend the SW indefinitely. `chrome.alarms.create({periodInMinutes: 60})` is honoured on Chrome but **unreliable on iOS Safari** — alarms can be coalesced or dropped.

**Do this instead:** On every stat report (which is content-script-initiated, so it always wakes the SW), check `stats.day !== today()` and roll if needed. This already exists in v0.1 at `background/service-worker.js:77`. Keep it; do not add iOS-fragile alarm scheduling.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| YouTube `ytInitialPlayerResponse` | DOM read (`window.ytInitialPlayerResponse` or regex over page HTML) | Same-origin, no auth. Format changes silently — keep a fallback parser. |
| YouTube caption track URL | `fetch()` from content script | Same-origin. Returns XML by default; pass `&fmt=json3` for cleaner parsing. URL signature can rotate without notice. |
| Instagram | None — no transcript API | Stays caption-only per `PROJECT.md:46`. |
| Hugging Face model hub | None at runtime — model is vendored | Model files (`Xenova/all-MiniLM-L6-v2/*.onnx`, `tokenizer.json`, `config.json`) are downloaded **once during extension build/development** and committed to `assets/models/`. The extension never reaches HuggingFace at runtime. This is required for the "$0 ongoing" + "all on-device" constraints. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Content script ↔ Service worker | `chrome.runtime.sendMessage` for stats (one-way, fire-and-forget) | Unchanged from v0.1. Do not add new request/response message types for hot-path operations. |
| `classifier.js` ↔ `embedder.js` / `transcript.js` / `cache.js` | `globalThis.SmartScroller` extension. Each new module loads after `classifier.js` and attaches methods to `SS`. | Same pattern as v0.1; load order in `manifest.json` is the contract. |
| Service worker ↔ chrome.storage | Reads on wake, writes on stat/lifecycle events | Unchanged. |
| Options page ↔ content scripts (for topic embedding) | `storage.onChanged` propagation. Options writes `topics[i].embedding=null`, content script picks up the null on next scan and fills it. | No direct cross-context message — entirely storage-mediated. Matches v0.1's "storage as bus" pattern. |
| Tab A ↔ Tab B (sharing topic embeddings) | `storage.sync.onChanged` — tab A computes, writes back; tab B picks up. | Eventually consistent. Acceptable. |

---

## iOS-Specific Architecture Notes

(Surfaced here because they don't fit cleanly in any single pattern but materially affect the design.)

1. **Memory ceiling: 80MB per extension (iOS 15.1+).** Model + WASM + JS heap + DOM views must fit. Budget: ~25MB model, ~15MB WASM/ORT, ~10MB tokenizer + buffers, ~30MB working set. No headroom for a second model.
2. **Service worker can be killed permanently.** Architectural implication: **never put anything time-sensitive or memory-heavy in the SW.** Keep it idle-by-design.
3. **No `chrome.offscreen`.** Settled — design around it (see Anti-Pattern 1).
4. **WebGPU lands in Safari 26 Beta (per the WWDC track).** For now, **target WASM backend exclusively**. WebGPU adoption is a future optimisation, not a v1.0 requirement.
5. **`runtime.sendMessage` 64MB cap.** Don't ship `Float32Array(384)` × thousands across the message bus. The chosen design doesn't (vectors stay in the content script that produced them).
6. **WebKit storage 7-day eviction.** Tolerable: a 7-day idle user does a one-time re-download from the extension bundle (instant) and re-classifies their next ~20 videos at Tier-2 latency.
7. **Mobile YouTube DOM is different.** `m.youtube.com` uses `ytm-shorts-lockup-view-model` nested in `ytm-rich-section-renderer`, plus `ytm-reel-shelf-renderer`. The v0.1 selector list already includes `ytm-shorts-lockup-view-model` (`content/youtube.js:14-25`), which is partial coverage. Mobile selector port adds: `ytm-reel-shelf-renderer`, `ytm-rich-section-renderer` for shelf detection on mobile. **Instagram's mobile DOM uses the same hashed-class pattern as desktop**; structural heuristics in v0.1 carry over.
8. **Orion iOS install path is unique.** Orion ships an Apple-mandated Chrome-extensions-via-Safari-WebExtension-wrapper compatibility layer; the architecture above is portable because it's plain MV3 with no Chrome-only APIs. The install mechanism (Xcode-signed Safari Web Extension or Chrome Web Store unlisted listing per `PROJECT.md:63`) is orthogonal to the architecture.

---

## Suggested Build Order

Justified by dependencies — each step unlocks an end-to-end demoable improvement.

```text
Step 0: v0.1 baseline (already on disk; unvalidated on iOS).
        Includes the four-context model and keyword classifier.
        Action item before any v1.0 work: verify v0.1 runs on Orion iOS.
        Without that, every later step builds on quicksand.

Step 1: content/cache.js — IndexedDB wrapper.
        ✓ Standalone, no model dependency.
        ✓ Unblocks: per-video memoisation of even Tier-1 verdicts (a small
          but real perf win on repeat scrolls of the same video, which
          happens constantly when the user dismisses and re-enters Shorts).
        ✓ Risk: low. IDB is well-understood; the wrapper is ~100 LOC.
        End-to-end value: dedupes redundant classifications.

Step 2: content/youtube.js mobile-selector port.
        ✓ Parallel to step 1 — purely DOM work.
        ✓ Unblocks: actually-running on iPhone Orion (validates v0.1).
        ✓ Risk: medium. Mobile YouTube DOM is documented but underused.
        End-to-end value: extension works on the primary target device.

Step 3: content/transcript.js — fetcher only, no embedding yet.
        ✓ Builds on iOS-validated content/youtube.js (step 2).
        ✓ Independent of model/embedding work.
        ✓ Unblocks: transcripts are visible in console/storage for debugging.
        ✓ Test independently: scroll a Short, log the transcript.
        ✓ Risk: medium-high (YouTube API rotation).
        End-to-end value: signal for Tier 2 is in hand, even before Tier 2 exists.

Step 4: content/embedder.js — Transformers.js + MiniLM + cosine, manual trigger only.
        ✓ Builds on cache.js (step 1) for vector persistence.
        ✓ Heaviest step; isolate from production path until verified.
        ✓ First gate: model loads on iOS Orion at all (memory limit test).
        ✓ Risk: high. The single biggest unknown in the whole milestone.
        End-to-end value: embeddings work, even if not yet wired into classify.

Step 5: Tiered classifier integration in content/classifier.js.
        ✓ Combines Tier 1 (existing) + Tier 2a (steps 3+4) + Tier 2b (step 4).
        ✓ Add semanticThreshold to settings + options-page slider.
        ✓ Add cache-epoch invalidation on topic-list change.
        ✓ Risk: medium. Sequencing logic is straightforward but failure modes
          (model not loaded yet, transcript fetch fail) need explicit handling.
        End-to-end value: the core feature works end-to-end.

Step 6: Opportunistic topic-embedding compute.
        ✓ Final polish. Options page marks topic.embedding=null on save;
          next scan in any tab fills it in and writes back.
        ✓ Risk: low. Pure storage-mediated propagation, no new contexts.
        End-to-end value: topics update without explicit "rebuild" step.

Step 7: Cache stats + cache-clear UI in options.
        ✓ Polish. Reads verdict count from storage.local, IDB usage from
          navigator.storage.estimate(). Button clears both caches.
        ✓ Risk: trivial.
        End-to-end value: user can audit/reset state.
```

**Why this order:** The riskiest step (step 4 — does Transformers.js run on iOS Orion at all?) is reachable in three steps' worth of foundation work, none of which depend on the model. If step 4 fails (memory-limited, WASM-incompatible, model-load-bombs), the work in steps 1–3 still ships: transcript fetching alone improves classification by feeding `meta.description` from caption snippets into the keyword tier. Steps 5–7 are sequencing/UX work on top of a working stack.

---

## Sources

### iOS Safari Web Extension constraints (HIGH confidence)
- [Optimizing your web extension for Safari — Apple Developer Documentation](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)
- [Service worker is killed when Device memory usage… — Apple Developer Forums](https://developer.apple.com/forums/thread/721222)
- [Safari Extension Service Worker Permanently Killed on iOS — Apple Developer Forums](https://developer.apple.com/forums/thread/758346)
- [iOS Safari Extension Memory Limit — Apple Developer Forums](https://developer.apple.com/forums/thread/687642)
- [Apple Safari 15.4 brings extension Manifest v3 support — Extension.Ninja](https://www.extension.ninja/blog/post/apple-safari-manifest-v3-support/)
- [Updates to Storage Policy — WebKit Blog](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [IndexedDB quota REGRESSION (iOS 13) — WebKit Bugzilla](https://bugs.webkit.org/show_bug.cgi?id=199614)

### chrome.offscreen API support (HIGH confidence — confirmed absent on iOS)
- [chrome.offscreen — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Proposal: Offscreen Documents for Manifest V3 — w3c/webextensions](https://github.com/w3c/webextensions/issues/170)

### Transformers.js + MiniLM in browser extensions (HIGH confidence)
- [How to Use Transformers.js in a Chrome Extension — Hugging Face Blog](https://huggingface.co/blog/transformersjs-chrome-extension)
- [Running Transformers.js inside a Chrome extension (MV3): a practical patch — Medium](https://medium.com/@vprprudhvi/running-transformers-js-inside-a-chrome-extension-manifest-v3-a-practical-patch-d7ce4d6a0eac)
- [Transformers.js v4: Now Available on NPM — Hugging Face Blog](https://huggingface.co/blog/transformersjs-v4)
- [WebGPU vs WebASM: Browser Inference Benchmarks — SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)
- [Optimizing Transformers.js for Production Web Apps — SitePoint](https://www.sitepoint.com/optimizing-transformers-js-production/)
- [sentence-transformers/all-MiniLM-L6-v2 — Hugging Face](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)

### YouTube transcript extraction (MEDIUM confidence — third-party patterns, API is undocumented)
- [Extracting YouTube Transcripts with JavaScript — Nidhin's blog](https://blog.nidhin.dev/extracting-youtube-transcripts-with-javascript)
- [How ytranscript Works: Reverse-Engineering YouTube Captions — Nadim Tuhin](https://nadimtuhin.com/blog/ytranscript-how-it-works)
- [Extract YouTube Transcripts Using Innertube API — Medium](https://medium.com/@aqib-2/extract-youtube-transcripts-using-innertube-api-2025-javascript-guide-dc417b762f49)

### Mobile YouTube DOM structure (MEDIUM confidence)
- [How to Disable YouTube Shorts Completely — Gizmodotech (notes mobile selectors)](https://gizmodotech.com/how-to-disable-youtube-shorts/)
- [ublock-hide-yt-shorts/list.txt — gijsdev (concrete selector inventory)](https://github.com/gijsdev/ublock-hide-yt-shorts/blob/master/list.txt)

### Internal references (project-local, HIGH confidence)
- `/Users/daurenzhunussov/smartscroller/.planning/PROJECT.md` — constraints, scope, and the "all on-device, iPhone-primary" non-negotiables
- `/Users/daurenzhunussov/smartscroller/.planning/codebase/ARCHITECTURE.md` — v0.1 four-context model preserved as the v1.0 base
- `/Users/daurenzhunussov/smartscroller/.planning/codebase/STRUCTURE.md` — directory conventions extended (not replaced) in v1.0
- `/Users/daurenzhunussov/smartscroller/.planning/codebase/CONCERNS.md` — pre-existing fragility (Instagram heuristics, YouTube selector contracts, MutationObserver hot path) carries forward unchanged

---
*Architecture research for: SmartScroller v1.0 — on-device semantic classification on iOS Safari Web Extension*
*Researched: 2026-05-15*
