# Requirements: SmartScroller

**Defined:** 2026-05-16
**Core Value:** A Short or Reel that is clearly off-topic must be blurred before the user finishes scrolling to it.

## v1 Requirements

Requirements for the v1.0 milestone: **"SmartScroller works on my iPhone, with semantic understanding."** Each maps to a roadmap phase.

### Platform

- [ ] **PLAT-01**: Extension installs and runs on iPhone Orion (Kagi iOS browser) using a verified install path (Chrome Web Store unlisted or Xcode-wrapped Safari Web Extension fallback)
- [ ] **PLAT-02**: Author can re-install the extension on iPhone in under 10 minutes using a documented checklist (`docs/install-ios.md`)
- [ ] **PLAT-03**: Extension continues to run unchanged on desktop Orion and Chrome/Brave (used as development sandbox)
- [ ] **PLAT-04**: Extension survives an iOS Safari refresh / Orion app backgrounding / phone restart without manual re-enable

### DOM Coverage

- [ ] **DOM-01**: Blur fires on YouTube Shorts (`youtube.com/shorts/*`) on iPhone Orion via mobile (`ytm-*`) and desktop (`ytd-*`) selector sets
- [ ] **DOM-02**: Blur fires on the YouTube homepage feed on iPhone Orion (mobile `m.youtube.com` and desktop `www.youtube.com` user-agent paths)
- [ ] **DOM-03**: Blur fires on Instagram Reels on iPhone Orion using structural heuristics (caption + author + hashtags only — no transcripts available)
- [ ] **DOM-04**: SPA navigation (route change without page reload) re-triggers classification on the new content
- [ ] **DOM-05**: A `SELECTORS.md` file documents every selector with last-verified date and host

### Classification

- [ ] **CLAS-01**: Keyword tier (existing v0.1 behavior) matches title, channel, description, and normalized hashtags against per-topic keyword lists
- [ ] **CLAS-02**: Transcript fetcher pulls YouTube captions for a video using `ytInitialPlayerResponse.captions` first, falling back to `/youtubei/v1/player` POST with ANDROID client context
- [ ] **CLAS-03**: Transcript fetch hard-times-out at 1500ms and never blocks the blur decision
- [ ] **CLAS-04**: Transcript fetch failures fall back gracefully to keyword-only classification (fail-open)
- [ ] **CLAS-05**: Semantic tier uses `Xenova/all-MiniLM-L6-v2` (INT8 quantized) via Transformers.js in the content script's isolated world (NOT in the service worker)
- [ ] **CLAS-06**: Semantic tier computes cosine similarity between video text (transcript or title+description fallback) and each topic's precomputed embedding
- [ ] **CLAS-07**: Classifier is tiered — keyword tier short-circuits; semantic tier fires only on inconclusive keyword result
- [ ] **CLAS-08**: Default semantic threshold is 0.55 with a per-topic override available in options
- [ ] **CLAS-09**: A video classified once during a session keeps its verdict for the session (no flickering decisions)
- [ ] **CLAS-10**: If the embedding model fails to load on iPhone, extension silently degrades to keyword-only v0.1 behavior

### Caching & Persistence

- [ ] **CACH-01**: Per-video classification verdicts persist in IndexedDB keyed by `videoId` (LRU evict at ~50MB soft cap)
- [ ] **CACH-02**: Per-topic embeddings are precomputed when a topic is added or edited, persisted in `chrome.storage.sync`, and reused without recomputation
- [ ] **CACH-03**: Fetched transcripts cache in `chrome.storage.local` by `videoId` (capped ~1000 entries)
- [ ] **CACH-04**: Settings can be exported to a JSON file from the options page and re-imported (survives iOS reinstall cycles)
- [ ] **CACH-05**: Options page exposes a "Clear caches" button (verdicts + embeddings + transcripts; settings preserved)

### UX & Trust

- [ ] **UX-01**: Off-topic Shorts/Reels are blurred with an overlay containing title, author, and "Show anyway" button (existing v0.1 behavior — preserved)
- [ ] **UX-02**: "Show anyway" reveal is per-render (not sticky across sessions or navigations) — intentional UX constraint
- [ ] **UX-03**: Blur overlay displays a reason badge: keyword match (e.g. `matched "transformer"`) or semantic score (e.g. `cosine 0.32 to AI & Programming`)
- [ ] **UX-04**: Per-site toggles (YouTube Shorts, YouTube homepage, Instagram Reels) work on iPhone Orion (existing v0.1 controls — verified on platform)
- [ ] **UX-05**: Pause control (15m / 1h / custom) works on iPhone Orion (existing v0.1 control — verified on platform)
- [ ] **UX-06**: Per-topic confidence threshold slider in the options page (0.30–0.80 range, default 0.55)
- [ ] **UX-07**: Daily counter (blurred vs allowed) is visible in the popup and continues to update on iPhone Orion (existing v0.1 counter — verified on platform)

### Calibration & Quality

- [ ] **CALI-01**: "Show anyway" clicks write `{videoId, decision, score, topic, transcriptExcerpt, timestamp}` to a `chrome.storage.local` ring buffer (cap 100 entries)
- [ ] **CALI-02**: Options page surfaces the last N misclassifications as a "Recent overrides" panel for the author to review
- [ ] **CALI-03**: A `SMOKE_TEST.md` playbook documents a 5-minute manual checklist to run after any YouTube/Instagram/iOS-Orion update
- [ ] **CALI-04**: Popup shows transcript fetch success rate (rolling 24h) — if it drops below 60%, the user knows YouTube has changed the contract
- [ ] **CALI-05**: Service worker is treated as message-router only; classification critical-path never `await`s `runtime.sendMessage` (defensive against iOS SW death)

## v2 Requirements

Deferred to a future milestone after v1 ships and the author has used it for ~2 weeks of real personal scrolling.

### Refinement

- **REFN-01**: Topic enable/disable toggle (without deleting the topic) — only useful with 3+ topics
- **REFN-02**: Per-channel/domain allowlist for channels that are 100% on-topic
- **REFN-03**: "Show last N blurred titles" peek in the popup for over-filtering audits
- **REFN-04**: Multilingual fallback model (e.g. `Xenova/multilingual-e5-small`) — only if non-English topics become a real need
- **REFN-05**: Mobile Instagram structural-heuristic refinement (only if IG breaks badly post-v1)

### Modes

- **MODE-01**: Soft-zone classification (below low threshold = full blur, between = light blur, above = pass-through) instead of binary cliff

## Out of Scope

Explicitly excluded. The Features research surfaces 19 anti-features; the highest-leverage exclusions are below. The reasoning matters more than the list.

| Feature | Reason |
|---------|--------|
| User accounts / login | Single user, single device — no auth surface needed |
| Cloud sync across devices | Single device (iPhone); manual JSON export/import covers reinstall edge cases |
| Distribution / store listing / marketing | Personal tool, never to be distributed |
| Telemetry / analytics / Sentry / error reporting | Author is the user; if it breaks, they notice. Privacy constraint forbids exfiltration. |
| Onboarding flow / first-run tutorial | No users to onboard — seeded default topic IS the onboarding |
| Premium tier / monetization | This is a tool, not a business |
| Social features (share topics, public library, leaderboards) | No second user |
| Hard skip / auto-scroll past off-topic items | Breaks page layout; hides false positives invisibly. Blur+overlay is the audit trail. |
| Auto-retrain model from feedback | MiniLM not trainable in-browser; n=few-clicks/month is too little data |
| Notifications / streaks / gamification | Fights the goal — the tool is meant to be ignored when it's working |
| Multi-language NLP support | Author consumes English content |
| TikTok For You support | Author does not use TikTok |
| Web dashboard / "your scrolling insights" page | Insights without action = noise; daily counter is sufficient |
| Per-video override memory ("never blur this again") | Encourages opting out of the friction the tool exists to provide |
| Cloud LLM APIs (Claude, OpenAI, Gemini) | Violates $0 + privacy constraints |
| Local LLM via Ollama / WebLLM | Wrong runtime envelope for iPhone (~GB models) |
| Browser-agnostic distribution (Firefox, Edge, Brave, Safari) | Author runs Orion on iPhone — anything else is dev sandbox |
| Keyboard shortcuts (J/K/L) | No keyboard on iPhone while scrolling |
| Watch-time tracking | Privacy-touching even on-device; not actionable |
| OCR on Instagram Reel video frames | Too heavy on iPhone; IG transcripts are unavailable; caption-only is the realistic ceiling |
| Whisper / in-browser ASR | YouTube already provides captions; iPhone WASM ASR is multi-second per Short |
| `chrome.offscreen` document | Does not exist on iOS Safari Web Extensions |
| WebGPU as a required backend | Unverified in extension content-script context on iOS; WASM is the floor |
| Sticky / persistent "Show anyway" reveals | Per-render is intentional — raises friction of off-topic content |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLAT-01 | Phase 1 | Pending |
| PLAT-02 | Phase 1 | Pending |
| PLAT-03 | Phase 1 | Pending |
| PLAT-04 | Phase 1 | Pending |
| DOM-01 | Phase 2 | Pending |
| DOM-02 | Phase 2 | Pending |
| DOM-03 | Phase 2 | Pending |
| DOM-04 | Phase 2 | Pending |
| DOM-05 | Phase 2 | Pending |
| CLAS-01 | Phase 3 | Pending |
| CLAS-02 | Phase 3 | Pending |
| CLAS-03 | Phase 3 | Pending |
| CLAS-04 | Phase 3 | Pending |
| CLAS-05 | Phase 2 | Pending |
| CLAS-06 | Phase 3 | Pending |
| CLAS-07 | Phase 3 | Pending |
| CLAS-08 | Phase 3 | Pending |
| CLAS-09 | Phase 3 | Pending |
| CLAS-10 | Phase 2 | Pending |
| CACH-01 | Phase 3 | Pending |
| CACH-02 | Phase 3 | Pending |
| CACH-03 | Phase 3 | Pending |
| CACH-04 | Phase 2 | Pending |
| CACH-05 | Phase 3 | Pending |
| UX-01 | Phase 2 | Pending |
| UX-02 | Phase 2 | Pending |
| UX-03 | Phase 4 | Pending |
| UX-04 | Phase 2 | Pending |
| UX-05 | Phase 2 | Pending |
| UX-06 | Phase 4 | Pending |
| UX-07 | Phase 2 | Pending |
| CALI-01 | Phase 4 | Pending |
| CALI-02 | Phase 4 | Pending |
| CALI-03 | Phase 4 | Pending |
| CALI-04 | Phase 4 | Pending |
| CALI-05 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 36 total
- Mapped to phases: 36 (100%)
- Unmapped: 0

**Per-phase counts:**
- Phase 1 (Install path validation): 4 requirements — PLAT-01..04
- Phase 2 (Mobile DOM + embedder smoke test): 14 requirements — DOM-01..05, CLAS-05, CLAS-10, UX-01, UX-02, UX-04, UX-05, UX-07, CACH-04, CALI-05
- Phase 3 (Transcript + tiered classifier): 12 requirements — CLAS-01..04, CLAS-06..09, CACH-01..03, CACH-05
- Phase 4 (Tuning, trust, smoke playbook): 6 requirements — UX-03, UX-06, CALI-01..04

---
*Requirements defined: 2026-05-16*
*Last updated: 2026-05-16 after roadmap creation (traceability populated)*
