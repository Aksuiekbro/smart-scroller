# Roadmap: SmartScroller v1.0

**Milestone:** "SmartScroller works on my iPhone, with semantic understanding."
**Created:** 2026-05-16
**Granularity:** coarse (4 phases)
**Mode:** mvp — every phase delivers an end-to-end working capability on iPhone Orion
**Core Value:** A Short or Reel that is clearly off-topic must be blurred before the user finishes scrolling to it.
**Coverage:** 36/36 v1 requirements mapped

## Phases

- [ ] **Phase 1: Install path validation on iPhone Orion** — Prove v0.1 (unchanged) installs and runs on iPhone Orion via a documented, repeatable path
- [ ] **Phase 2: Mobile DOM port + on-device embedder smoke test** — Existing v0.1 features work on mobile YouTube/Instagram DOMs, and the embedding model proves itself viable on real iPhone hardware
- [ ] **Phase 3: Transcript fetch + tiered semantic classifier** — Off-topic Shorts/Reels get blurred using transcripts + on-device embeddings, with keyword tier as the fast path
- [ ] **Phase 4: Tuning, trust, and the smoke playbook** — Author can calibrate thresholds, see why something was blurred, and run a 5-minute manual check after platform changes

## Phase Details

### Phase 1: Install path validation on iPhone Orion
**Goal:** v0.1 (current code, unchanged) installs and runs visibly on the author's iPhone Orion, with a re-installable, documented path
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** PLAT-01, PLAT-02, PLAT-03, PLAT-04
**Success Criteria** (what must be TRUE on iPhone Orion):
  1. Author can open YouTube Shorts on their iPhone Orion and visibly observe the v0.1 keyword-only blur firing on at least one off-topic Short, without any code changes vs. the v0.1 checkout
  2. A `docs/install-ios.md` checklist exists and the author can re-install the extension from scratch on their iPhone in under 10 minutes by following it
  3. The same extension build (or its desktop equivalent) still loads in desktop Orion or Chrome/Brave so the author retains a dev sandbox
  4. After backgrounding the Orion app, killing it, restarting the phone, or completing an iOS Safari refresh, the extension is still enabled and still blurring without manual toggling
  5. A single documented decision exists for which distribution path the project uses: **"Install from File" via Orion iOS Extensions menu, fed a self-built zip of the unpacked extension** (verified on-device 2026-05-16). Both originally-proposed paths — Chrome Web Store unlisted ($5 one-time) and Xcode-wrapped Safari Web Extension ($99/yr) — are explicitly ruled out as primary; they remain documented as backup recipes only. See `.planning/phases/01-install-path-validation-on-iphone-orion/01-CONTEXT.md` (D-01, D-02) for the locked decision.
**Plans:** 1 plan
Plans:
- [ ] 01-01-PLAN.md — Write docs/install-ios.md, update README Install in Orion section, add *.zip to .gitignore

### Phase 2: Mobile DOM port + on-device embedder smoke test
**Goal:** Existing v0.1 behaviors keep working on the actual mobile YouTube and Instagram DOMs that iPhone Orion sees, and the embedding model is proven loadable on real iPhone hardware
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** DOM-01, DOM-02, DOM-03, DOM-04, DOM-05, CLAS-05, CLAS-10, UX-01, UX-02, UX-04, UX-05, UX-07, CACH-04, CALI-05
**Success Criteria** (what must be TRUE on iPhone Orion):
  1. On iPhone Orion, opening `youtube.com/shorts/*`, the YouTube homepage feed, and Instagram Reels each produces a visible blur on at least one off-topic item using the v0.1 keyword tier with mobile-aware selectors
  2. After scrolling past several Shorts/Reels and triggering SPA route changes (navigating between Shorts, between Reel and feed, etc.) on iPhone Orion, the new content is re-classified and blurred — no stale blur and no missed item from the new view
  3. A one-shot diagnostic page on iPhone Orion successfully loads Transformers.js + `Xenova/all-MiniLM-L6-v2` (INT8) in the content-script context and returns one 384-dim embedding without crashing the tab or causing unbounded memory growth observable via Safari Web Inspector — settling the Transformers.js v4 vs v2 question with a recorded decision
  4. With the embedding-model load deliberately disabled (or stubbed to fail), the extension silently keeps blurring using v0.1 keyword behavior on iPhone Orion — no broken UI, no error toast
  5. The popup's per-site toggles, pause control (15m/1h/custom), daily counter, and the blur overlay with "Show anyway" all work end-to-end on iPhone Orion, with reveal staying per-render (not sticky)
  6. The author can export current settings to a JSON file from the options page on iPhone Orion and re-import them on a fresh install, recovering all topics and toggles
  7. A `SELECTORS.md` file exists in-repo listing every YouTube/Instagram selector the extension relies on, with the host and last-verified date for each; the service worker holds no classification state and the critical blur path never `await`s a `runtime.sendMessage` call
**Plans:** TBD
**UI hint:** yes

### Phase 3: Transcript fetch + tiered semantic classifier
**Goal:** Off-topic Shorts/Reels get blurred using transcript-aware semantic classification on iPhone Orion, with the keyword tier as a fast short-circuit and verdicts cached so the same video is never re-classified
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** CLAS-01, CLAS-02, CLAS-03, CLAS-04, CLAS-06, CLAS-07, CLAS-08, CLAS-09, CACH-01, CACH-02, CACH-03, CACH-05
**Success Criteria** (what must be TRUE on iPhone Orion):
  1. On iPhone Orion, a YouTube Short whose title/channel/hashtags match no keywords but whose transcript clearly aligns with a configured topic is allowed (not blurred), while a Short whose transcript clearly does not align is blurred — both decisions made before the user finishes scrolling to the next item
  2. On iPhone Orion, when YouTube returns no usable transcript or the transcript fetch exceeds 1500ms, the extension falls back to keyword-only classification and still produces a blur/allow decision in time — the user never sees a frozen, un-classified Short
  3. Scrolling back to a previously-seen Short or Reel on iPhone Orion shows the exact same verdict it received the first time (no flickering, no re-decision), and the verdict survives a tab reload because it persists in IndexedDB
  4. After editing a topic's keyword list in the options page on iPhone Orion, the topic's embedding is precomputed once and reused on every subsequent classification without re-embedding the topic text
  5. A "Clear caches" button in the options page on iPhone Orion wipes per-video verdicts, transcripts, and topic embeddings while preserving user settings, and the next Short visited triggers a fresh classification
  6. With the default 0.55 cosine threshold, the keyword tier short-circuits when matches/non-matches are obvious; the semantic tier fires only for inconclusive keyword results, and this can be observed by inspecting which tier produced each verdict
**Plans:** TBD
**UI hint:** yes

### Phase 4: Tuning, trust, and the smoke playbook
**Goal:** The author can understand and adjust why anything got blurred or allowed on iPhone Orion, and a repeatable 5-minute manual check tells them when YouTube/IG/iOS has broken the contract
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** UX-03, UX-06, CALI-01, CALI-02, CALI-03, CALI-04
**Success Criteria** (what must be TRUE on iPhone Orion):
  1. Every blur overlay on iPhone Orion shows a reason badge that is either a keyword match (e.g. `matched "transformer"`) or a cosine score against a named topic (e.g. `cosine 0.32 to AI & Programming`), so the author always knows which tier decided and why
  2. The options page on iPhone Orion offers a per-topic confidence threshold slider in the 0.30–0.80 range (default 0.55), and changing it visibly shifts which Shorts get blurred without requiring a tab reload
  3. Every "Show anyway" click on iPhone Orion appends `{videoId, decision, score, topic, transcriptExcerpt, timestamp}` to a 100-entry ring buffer in `chrome.storage.local`, viewable as a "Recent overrides" panel in the options page that the author can scan after a real scrolling session
  4. The popup on iPhone Orion shows a rolling 24-hour transcript-fetch success rate; if the author intentionally breaks the fetch path (e.g. by toggling a host permission off) the rate visibly drops below 60% within minutes
  5. A `SMOKE_TEST.md` playbook exists and the author can run through every step on iPhone Orion in under 5 minutes to confirm Shorts blur, Reels blur, homepage feed blur, "Show anyway" works, daily counter ticks, and pause works — and the playbook is what they will run after any YouTube/Instagram/Orion-iOS update
**Plans:** TBD
**UI hint:** yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Install path validation on iPhone Orion | 0/1 | Not started | - |
| 2. Mobile DOM port + on-device embedder smoke test | 0/0 | Not started | - |
| 3. Transcript fetch + tiered semantic classifier | 0/0 | Not started | - |
| 4. Tuning, trust, and the smoke playbook | 0/0 | Not started | - |

## Coverage

- v1 requirements: 36 total
- Mapped to phases: 36
- Orphans: 0

| Category | Count | Phases |
|----------|-------|--------|
| Platform (PLAT) | 4 | Phase 1 |
| DOM Coverage (DOM) | 5 | Phase 2 |
| Classification (CLAS) | 10 | Phases 2, 3 |
| Caching & Persistence (CACH) | 5 | Phases 2, 3 |
| UX & Trust (UX) | 7 | Phases 2, 4 |
| Calibration & Quality (CALI) | 5 | Phases 2, 4 |

## Phase Dependencies

```
Phase 1 (Install)  →  Phase 2 (Mobile DOM + embedder smoke)
                          ↓
                      Phase 3 (Transcript + tiered classifier)
                          ↓
                      Phase 4 (Tuning + trust + smoke playbook)
```

The chain is forced by the research's CRITICAL pitfalls:
- Phase 1 first because deployability on iPhone Orion is the single highest-risk unknown; everything else compounds on it.
- Phase 2 second because both the mobile DOM dialect and the embedder's iOS viability must be verified on the actual platform before any classification rewrite.
- Phase 3 third because tiered classification needs both a working platform (Phase 1) and a proven embedder (Phase 2).
- Phase 4 last because calibration data only matters once the embedding tier is actually shipping decisions.

---
*Roadmap created: 2026-05-16*
*Last updated: 2026-05-16 after Phase 1 plan creation (Plans count finalized for Phase 1)*
