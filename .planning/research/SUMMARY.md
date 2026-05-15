# Project Research Summary

**Project:** SmartScroller
**Domain:** Personal browser extension — short-form video topic filter (transcripts + on-device embeddings) on iPhone Orion
**Researched:** 2026-05-16
**Confidence:** MEDIUM-HIGH overall — HIGH on ML/feature scope, **MEDIUM with one CRITICAL unresolved tension on the iOS install path**

## Executive Summary

SmartScroller v0.1 ships a working Chrome MV3 scaffold that blurs off-topic Shorts/Reels using keyword matching. The v1.0 milestone is **not** "add features" — it's "make v0.1 actually work on the only device the user scrolls on (iPhone Orion), then add transcript-based semantic classification on top." The research strongly agrees that:

- The **ML stack** is settled: Transformers.js + `Xenova/all-MiniLM-L6-v2` (INT8 quantized, ~23MB) running WASM-backed in the content script's isolated world. WebGPU on iOS Safari Web Extensions is uncharted — treat as optimistic upgrade only.
- The **classifier architecture** is tiered: keyword tier first (fast, free, already works), escalate to transcript-fetch + embedding-cosine only when keywords are inconclusive. Verdict cache per `videoId` is non-negotiable for iPhone battery.
- The **feature scope** is honest about being personal: no accounts, no sync, no store listing, no telemetry, no gamification. Most "obvious next features" are anti-features for a single-user tool.

**Two real cross-document tensions that you must resolve before locking the roadmap** — see the "Research Tensions" section below. The biggest one is **whether the iOS install path is "Chrome Web Store unlisted ($5 one-time)" or "Xcode-wrapped Safari Web Extension ($99/yr Apple Developer)"** — STACK and PITFALLS recommend incompatible paths with confidence levels that don't agree. This question dominates Phase 1 and cannot be deferred.

## Key Findings

### Recommended Stack

(Detail: `.planning/research/STACK.md`)

**Core technologies (additions to v0.1):**
- **`@huggingface/transformers` v4.2.0** — on-device sentence embeddings via bundled ONNX Runtime Web. Use the new package name, not `@xenova/transformers` v2 (deprecated). v4's C++-rewritten WebGPU runtime and 53% bundle-size drop matter for the iOS budget. **HIGH confidence on desktop; MEDIUM on iOS.** ⚠️ See tension #2 below — Pitfalls research recommends pinning to v2.x.
- **Model: `Xenova/all-MiniLM-L6-v2`** (INT8 quantized, ~23 MB) — 384-d embeddings, English-only, well-benchmarked on STS. Fits the 30 MB iOS bundle ceiling from PROJECT.md. **HIGH confidence.**
- **Transcript fetch: tiered** — first try the in-page `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks[].baseUrl` (zero extra request), fall back to `/youtubei/v1/player` POST with ANDROID client context if the page payload lacks captions. Append `&fmt=json3` for stable parsing. **MEDIUM-HIGH confidence.**
- **`esbuild` (single bundler exception)** — bundle Transformers.js + worker glue into one IIFE per content script. The v0.1 "no build step" rule relaxes for exactly this one file. Don't use Webpack/Rollup/Vite/Plasmo/WXT/CRXJS — all introduce config surface and CRXJS specifically [does not work on Orion iOS](https://github.com/crxjs/chrome-extension-tools/issues/887). **HIGH confidence.**
- **Mobile DOM: `ytm-*` element prefix** for `m.youtube.com` (e.g. `ytm-shorts-lockup-view-model`, `ytm-reel-shelf-renderer`). Source: filter-list ecosystems already targeting these. **HIGH confidence on element names; MEDIUM on which page iOS Safari actually serves** (UA-dependent — sometimes ships desktop `ytd-*` tree on iPhone).

**Explicit anti-stack** (do NOT use):
- Cloud LLM APIs (Claude/OpenAI/Gemini) — violates $0 + privacy constraint
- Local LLM via Ollama / WebLLM — too big, wrong runtime envelope for iPhone
- TF.js + Universal Sentence Encoder — ecosystem moved to ONNX; lower quality at same dim
- `youtube-transcript` npm package — CORS-broken in browser, last meaningful update pre-2025 hardening
- Safari App Extension via Xcode for distribution **OR** unpacked extensions on iOS — see tension #1
- `MutationObserver` rooted at `document.body` (v0.1 carry-over) — already-known perf hot path; will be worse once embeddings run

### Expected Features

(Detail: `.planning/research/FEATURES.md`)

**Must have (table stakes for v0.2 — "Works on my phone"):**
- Runs on iPhone Orion (the project is moot without this) — HIGH complexity
- Mobile DOM selectors for `m.youtube.com` Shorts + feed — HIGH complexity
- YouTube transcript fetch — HIGH complexity (network + format brittleness)
- Tiered classifier (keyword → semantic) with per-video verdict cache — MEDIUM
- Topic embedding cache (precomputed on topic save, persisted) — LOW
- Reason badge on blur overlay ("matched 'transformer'" / "cosine 0.32 to AI") — LOW; trust-building win
- Manual smoke-test playbook (since there are no automated tests) — LOW
- Keep all v0.1 features that already work: topic editor, blur overlay, "Show anyway", per-site toggles, pause controls, daily stats

**Should have (v0.3 — "Trustable", post-real-use validation):**
- Per-topic confidence threshold slider — embeddings need per-topic calibration
- "Wrong call" feedback button + ring-buffer log of last N misclassifications
- Settings JSON export/import (critical for iOS reinstall cycles)

**Defer (v0.4+):**
- Topic enable/disable toggle (without deleting)
- Per-channel/domain allowlist
- "Show last 10 blurred" peek
- Mobile Instagram structural refinement (revisit if IG breaks)

**Explicit anti-features** (Features research is unusually thorough here — 19 things deliberately NOT being built):
- User accounts, cloud sync, distribution, store listing, telemetry, onboarding flow, premium tier, social features
- Hard-skip / auto-scroll (breaks page layout and hides false positives invisibly)
- Auto-retrain from feedback (n=few clicks, MiniLM not trainable in-browser)
- Notifications / streaks / gamification (fights the goal)
- TikTok, multi-language, watch-time tracking, web dashboard
- Per-video override memory ("never blur this Short again") — explicitly Out of Scope in PROJECT.md
- Keyboard shortcuts (no keyboard on iPhone while scrolling)

### Architecture Approach

(Detail: `.planning/research/ARCHITECTURE.md`)

**Verdict from architecture research:** *Keep the v0.1 four-context model. Do **not** introduce an offscreen document — it does not exist on iOS Safari Web Extensions. Push the embedding model into the content script's isolated world (loaded once per tab, lazy on first uncertain video). Keep transcript fetching in the content script (same-origin, no CORS). Store verdicts in `chrome.storage.local`; store embeddings in IndexedDB. Service worker stays an aggregator — never load the model there, because iOS kills it.*

**Major components (v0.1 + 3 new + 2 caches):**
1. **`content/transcript.js`** *(NEW)* — Fetch `ytInitialPlayerResponse.captions` → caption track XML/JSON, return plain text. In-tab LRU keyed by `videoId`. Same-origin, no CORS.
2. **`content/embedder.js`** *(NEW)* — Lazy-load Transformers.js + MiniLM, `embed(text) → Float32(384)`, `cosine(topicVec, vidVec)`, `classifySemantic(meta, transcript)`. Tier 2 — fires only when keyword tier is inconclusive.
3. **`content/cache.js`** *(NEW)* — IndexedDB wrapper: `verdicts` store (videoId → {onTopic, score, ts, tier}), `embeddings` store (videoId → Float32Array), `modelBlobs` store (Transformers.js auto-caches here). LRU evict at ~50MB soft cap.
4. **`content/classifier.js`** *(v0.1)* — Tier 1 keyword matcher; publishes `globalThis.SmartScroller`. Unchanged.
5. **`content/youtube.js`** *(v0.1++ )* — Add `ytm-*` mobile selectors alongside `ytd-*`. Same file, both DOM dialects.
6. **`content/instagram.js`** *(v0.1)* — Unchanged. No transcripts available — stays caption-only.
7. **`background/service-worker.js`** *(v0.1 + thin extension)* — Add `ss:precompute-topic-embeddings` message handler (orchestration only — never loads model). Keep stats aggregation. **Never** load the model in the SW; iOS kills it.
8. **`options/options.js`** *(v0.1 + 2 controls)* — Add semantic threshold slider, cache-clear button.
9. **`manifest.json`** — Add `web_accessible_resources` for `assets/` (model files + WASM); declare `host_permissions` for `https://huggingface.co/*`, `https://cdn-lfs.huggingface.co/*`, `https://www.youtube.com/youtubei/*`, and `*://m.youtube.com/*`.

**Build order** (forced by dependencies):
- (a) Install path validation (Phase 1, blocks everything)
- (b) Mobile DOM port (Phase 2, unblocks any iPhone work)
- (c) Transcript fetch with timeout + cache + fallback (Phase 3a, no embedding dependency)
- (d) Embedder + cosine + verdict cache (Phase 3b, depends on transcripts)
- (e) Tuning + threshold slider + reason badge + smoke playbook (Phase 4)

### Critical Pitfalls

(Detail: `.planning/research/PITFALLS.md`)

**Three CRITICAL-severity pitfalls. All of them target the iPhone install/runtime envelope.**

1. **The iPhone install hurdle kills the project before it ships.** You finish v0.2 on desktop, open Xcode for the first time, hit signing/provisioning errors, lose two weekends, and never deploy. *Mitigation:* Spike the install path **first** — before any new code. If you can't get v0.1 (current state) running on iPhone Orion in a weekend, the whole milestone needs re-scoping to desktop-Orion-only and the iPhone bit is deferred. Don't write embedding code for a runtime you can't deploy to.

2. **Transformers.js v3 has a documented iOS memory regression** ([huggingface/transformers.js#1242](https://github.com/huggingface/transformers.js/issues/1242)) — model loads but memory grows unbounded, app crashes. *Mitigation:* Test on real iPhone hardware in Phase 2 with the minimum-viable model load (stub `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')` returning one embedding) before writing any classification logic. Pin Transformers.js to v2.x if v3/v4 reproduces the regression. Bundle the ONNX model in the extension (not CDN fetch) with `env.allowRemoteModels = false`. Have a graceful degrade: if `pipeline()` rejects, fall back silently to v0.1 keyword-only behavior. ⚠️ See tension #2.

3. **iOS Safari extension service workers die mid-scroll and don't wake back up.** Documented behavior at ~80% memory pressure ([Apple Forums 721222](https://developer.apple.com/forums/thread/721222)) and a separate iOS 17.4+ regression where the SW is permanently killed after 30–45s ([Apple Forums 758346](https://developer.apple.com/forums/thread/758346)) requiring manual extension toggle to recover. *Mitigation:* Move **all** stateful classification work out of the service worker. SW is message-router only. Caches go to `chrome.storage.local` (persistent) or content-script module scope (reset on nav). Never `await sendMessage()` on the critical blur path. Every `runtime.sendMessage` is fire-and-forget with try/catch.

**Two HIGH-severity pitfalls worth roadmap-level attention:**

4. **Threshold tuning death** — single global cosine threshold won't work. Different topics have different "tightness" in embedding space. *Mitigation:* Build per-topic thresholds from the start. Add a calibration log (every "Show anyway" + every off-topic-allowed scroll → `chrome.storage.local`) from Phase 2 so data exists when Phase 4 tuning needs it. Lock a videoId's verdict for the session — a flickering decision is the most trust-destroying failure mode. Accept that perfect classification is impossible; "Show anyway" exists because the filter will be wrong.

5. **YouTube transcript fetch is unreliable across regions, ages, Short auto-captions** (20–40% of Shorts have no usable transcript). *Mitigation:* Never block the blur decision on a transcript fetch succeeding. 1500ms hard timeout (a Short is ~30s; if you can't classify in <1.5s, user has already scrolled). Cache transcripts forever by `videoId` (capped at 1000 entries). Fall back to keyword-only if transcript fetch returns empty. Treat transcript as *one* signal, combine with title/channel — a Short whose transcript is "(music)" but title is "AI girlfriend" should not be on-topic for "AI & Programming."

**Plus moderate pitfalls** (worth mentioning, less urgent):
- Mobile selectors break more often than desktop — needs `SELECTORS.md` with last-verified date per host
- Cold-start latency for the embedding model can hit multi-second on iPhone — Phase 2 measures this on real device

## Research Tensions

Surfacing these because they are unresolved and dominate Phase 1.

### Tension #1 — iOS install path: CWS-unlisted vs Xcode-Safari-Web-Extension

| Source | Recommendation | Cost | Confidence | Rationale |
|--------|----------------|------|------------|-----------|
| **STACK.md** | Chrome Web Store unlisted listing | $5 one-time | MEDIUM | Kagi docs document "one-click install from chrome.google.com/webstore/..." on Orion iOS. Unlisted listings have the same install URL transport. Inferred-but-not-tested for the unlisted case. |
| **PITFALLS.md** | Xcode-wrapped Safari Web Extension + TestFlight | $99/year Apple Developer Program | HIGH | Source explicitly says iOS does not support unpacked extensions; only paths are Xcode/TestFlight/App Store, all requiring Apple Developer membership. Treats the "free constraint" in PROJECT.md as about *ongoing* costs, not one-time tooling. |

**These two recommendations are not just different — they are mutually exclusive paths with different cost profiles.** This must be settled by the first concrete action in Phase 1: **try the CWS-unlisted path first** (cheaper, validates Kagi's docs) and **fall back to the Xcode path** only if that fails. The architecture & code don't change either way — only the distribution channel changes.

The user's `PROJECT.md` Constraints say "$0 ongoing, no API fees" — both paths satisfy this. CWS is $5 one-time; Apple Developer is $99/year *ongoing*. CWS therefore wins on stated constraints **if it works on Orion iOS**. Validating this end-to-end is the single highest-leverage hour you can spend on the whole project.

### Tension #2 — Transformers.js version: v4.2.0 (latest) vs v2.x (pinned)

| Source | Recommendation | Confidence | Rationale |
|--------|----------------|------------|-----------|
| **STACK.md** | `@huggingface/transformers@^4.2.0` | HIGH | March 2026 GA, C++-rewritten WebGPU runtime, 53% smaller bundle, tested across ~200 architectures. The v2 package (`@xenova/transformers`) is deprecated. |
| **PITFALLS.md** | Pin to v2.x until v3 iOS memory regression is fixed | HIGH (cites [issue #1242](https://github.com/huggingface/transformers.js/issues/1242)) | v3 has documented "Application crashes on iOS (both Safari and Chrome) / extremely high and growing memory usage." v4 is rewritten — Pitfalls research did not verify if the v3 regression carries forward. |

**Resolution path:** Phase 2 must include a "Transformers.js iOS smoke test" task — load the model, run one inference on a real iPhone 12 or 13, monitor memory in Safari Web Inspector. If v4 is stable on iOS → use v4 (better bundle size, the v2 namespace is deprecated). If v4 reproduces #1242 → pin v2.x and accept the older WebGPU/quantization story. Don't make this decision in advance; measure.

## Implications for Roadmap

Based on research, suggested phase structure for the v1.0 milestone ("SmartScroller works on my iPhone, with semantic understanding"):

### Phase 1: Install path validation (iPhone Orion)

**Rationale:** Single highest-risk unknown in the project. If we can't deploy v0.1 *as-is* to iPhone Orion, no other phase delivers value to the user. Two distribution paths (CWS-unlisted vs Xcode) need to be tried in cost order.
**Delivers:** v0.1 (current code, no changes) installed and visibly running on the author's iPhone Orion. A documented `docs/install-ios.md` with the exact steps for re-installation. A go/no-go decision on which distribution path the project uses.
**Avoids:** Pitfall #1 (iPhone install hurdle).
**Research flag:** **HIGH** — Phase 1 is itself a spike. Plan it as throwaway investigation work.

### Phase 2: Mobile DOM port + on-device model smoke test

**Rationale:** Two parallel-ish workstreams that are both prerequisites for any classification work but neither depends on the other. Catch them in one phase.
**Delivers:**
- `content/youtube.js` updated with `ytm-*` selectors for `m.youtube.com`, validated on iPhone Orion against live YouTube Shorts.
- Transformers.js + MiniLM loaded and producing one embedding on iPhone (a hello-world `pipeline()` call). Resolves tension #2.
- `SELECTORS.md` created with last-verified date + host.
- `chrome.storage.local` calibration log scaffolding in place (used in Phase 4).
**Uses:** ML stack from STACK.md (Transformers.js + MiniLM-int8 + WASM backend).
**Implements:** Architecture's mobile DOM update + content/embedder.js skeleton.
**Avoids:** Pitfalls #2, #3, #6.
**Research flag:** **MEDIUM** — Mobile selectors are well-known but iOS-specific renders may differ; embedder feasibility on iPhone is the unverified piece.

### Phase 3: Transcript fetch + tiered classifier

**Rationale:** Once the platform works (Phase 1) and embeddings are proven on the platform (Phase 2), the actual upgrade can ship.
**Delivers:**
- `content/transcript.js` — two-tier fetch (page-embedded `ytInitialPlayerResponse` first, `/youtubei/v1/player` POST fallback) with 1500ms timeout + by-videoId cache.
- `content/embedder.js` complete — `embed()`, `cosine()`, `classifySemantic()`.
- `content/cache.js` — IndexedDB verdict + embedding caches with LRU eviction at ~50MB.
- `content/classifier.js` extended — keyword tier short-circuits unchanged; on inconclusive, transcript-fetch then embedder tier runs.
- Default semantic threshold (0.55) wired up — per-topic comes in Phase 4.
**Uses:** Transformers.js pipeline, ytInitialPlayerResponse + InnerTube fetch.
**Implements:** The full v1.0 tiered classification architecture.
**Avoids:** Pitfall #5 (transcript fragility) — by design (timeout + fallback + cache from day one).
**Research flag:** **MEDIUM** — transcript fetch contract changes; build the smoke-test script in this phase.

### Phase 4: Tuning, trust, and the smoke playbook

**Rationale:** Embeddings are not "done" when they run — they're done when their decisions feel right to the user. This is where you discover the threshold is wrong and the keyword tier is fighting the semantic tier. Calibration data from Phase 2 makes this phase data-driven instead of vibes-driven.
**Delivers:**
- Per-topic confidence threshold slider in options page.
- Reason badge on blur overlay ("matched 'transformer'" / "cosine 0.32 to AI").
- "Show anyway" feedback button writes to `chrome.storage.local` calibration ring buffer.
- "Recent misclassifications" panel in options showing the last N entries.
- `SMOKE_TEST.md` playbook — manual checklist the author runs after every YouTube/IG/iOS UI refresh.
- Settings JSON export/import (a Phase 0.3 differentiator) — graduated up because iOS reinstall cycles make it close to table-stakes.
**Avoids:** Pitfalls #4 (threshold tuning death), #6 (silent mobile breakage).
**Research flag:** **LOW** — well-trodden ground (UI tweaks + structured logs).

### Phase Ordering Rationale

- **Phase 1 must come first.** Install path is the highest-leverage unknown. Every other phase compounds on it. If Phase 1 fails, the milestone re-scopes; if it succeeds cheaply, the project gets months of momentum back.
- **Phase 2 packages two prerequisites** (mobile DOM, embedder iOS feasibility) into one phase. They're independent but both block Phase 3, and shipping them together avoids two separate "phase complete, can I deploy" round trips.
- **Phase 3 is the actual product-value phase.** Everything before is unlocking. This is where the user starts noticing the tool getting smarter.
- **Phase 4 is "from technically works to trustably useful."** Without it, the embedding tier ships but the user stops trusting the filter after the first weird false positive.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1: HIGH research flag** — the install path is partially-documented at best. Plan-phase research should validate Kagi's CWS-install docs on the author's actual iOS version + Orion build. Have the Xcode fallback path partially planned in case.
- **Phase 2: MEDIUM research flag** — the Transformers.js v4 vs v2 decision and the iOS memory measurement need a real-device test plan.
- **Phase 3: MEDIUM research flag** — InnerTube client header rotation is a moving target; planner should check whether the "ANDROID 20.10.38" client identity is still working on the day of plan creation.

Phases with standard patterns:
- **Phase 4: LOW research flag** — UI sliders, logs, and a manual test playbook are well-documented patterns. Plan from requirements.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack — ML | HIGH | Transformers.js + MiniLM-int8 is well-trodden territory on desktop |
| Stack — transcripts | MEDIUM-HIGH | InnerTube path confirmed by multiple 2026 sources; YouTube contract drift is a known risk |
| Stack — install path | MEDIUM | The single biggest unverified claim in the project (see Tension #1) |
| Features | HIGH | Personal-tool framing is unambiguous; comparable tools surveyed |
| Architecture | HIGH | Four-context model + tiered classifier is structurally correct for iOS constraints |
| Pitfalls | MEDIUM-HIGH | iOS-specific issues all have Apple Developer Forum citations; threshold-tuning pitfall is inferential but credible |

**Overall confidence:** **MEDIUM-HIGH** with one explicit blocker (install path validation).

### Gaps to Address

- **Install path end-to-end validation** — must be the FIRST concrete action in Phase 1. Until verified, every subsequent phase is conditional. (See Tension #1.)
- **Transformers.js iOS memory behavior on v4** — Pitfalls research cites v3 regression but did not test v4. Phase 2 must measure on real device. (See Tension #2.)
- **iOS Safari WebGPU inside extension content-script context** — not validated by any source. Default to WASM; treat WebGPU as opportunistic. Don't plan around it.
- **`m.youtube.com` vs `youtube.com` on iOS Safari Web Extension** — UA-dependent; needs on-device check in Phase 2.
- **InnerTube client context rotation cadence** — YouTube has rotated ANDROID client identity twice in the past 18 months. Build the fetcher with a single `CLIENT_CONTEXT` constant so future rotation is a one-line edit, not a hunt.

## Sources

### Primary (HIGH confidence)
- [Transformers.js v4 release blog (Hugging Face)](https://huggingface.co/blog/transformersjs-v4) — v4 GA, package rename, WebGPU rewrite
- [`@huggingface/transformers` on npm](https://www.npmjs.com/package/@huggingface/transformers) — v4.2.0 confirmed
- [Xenova/all-MiniLM-L6-v2 model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2) — 384-d output, INT8 ONNX
- [Kagi Orion iOS Web Extensions docs](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html) — primary source on iOS install
- [Apple Developer Forums 721222](https://developer.apple.com/forums/thread/721222) — Safari extension SW memory-pressure kill behavior
- [Apple Developer Forums 758346](https://developer.apple.com/forums/thread/758346) — iOS 17.4+ SW permanent-kill regression
- [huggingface/transformers.js#1242](https://github.com/huggingface/transformers.js/issues/1242) — v3 iOS memory regression

### Secondary (MEDIUM confidence)
- [InnerTube transcript-fetch guides (2025–2026)](https://medium.com/@aqib-2/extract-youtube-transcripts-using-innertube-api-2025-javascript-guide-dc417b762f49) — `/youtubei/v1/player` POST schema
- [ublock-hide-yt-shorts filter list](https://github.com/gijsdev/ublock-hide-yt-shorts/blob/master/list.txt) — `ytm-*` mobile YouTube selectors
- [Chrome Web Store unlisted listing path](https://www.extensionradar.com/blog/chrome-web-store-developer-fee-2026) — $5 one-time fee, unlisted visibility
- Competitor tool surveys (Unhook, DF Tube, BlockTube, UnDistracted, IGPlus, Intention, Cold Turkey) — confirmed the surface-toggle-vs-content-filter gap that motivates this project

### Tertiary (LOW confidence — needs validation)
- "Chrome Web Store *unlisted* installs on Orion iOS" — inferred from public-store install behavior; not explicitly tested
- iPhone WASM SIMD latency for MiniLM (~15–40ms/embedding) — extrapolated from M2 desktop, not iPhone-measured
- iOS Safari WebGPU inside extension content script — works in regular pages, unverified in extension sandbox

---
*Research completed: 2026-05-16*
*Ready for roadmap: yes — with explicit Phase 1 blocker (install path validation) called out*
