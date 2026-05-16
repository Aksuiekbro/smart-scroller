# Phase 2: Mobile DOM port + on-device embedder smoke test - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers two coupled outcomes on the author's iPhone Orion:

1. **Mobile DOM port** — v0.1 blur behavior works on default mobile YouTube (`m.youtube.com`, `youtube.com/shorts/*`) and Instagram (`m.instagram.com/reels/*`) **WITHOUT** the Request Desktop Website prerequisite Phase 1 left in place (D-10 from Phase 1). All current keyword-tier behavior is preserved.

2. **Embedder smoke test** — a one-shot proof that Transformers.js + `Xenova/all-MiniLM-L6-v2` (INT8) loads inside the iPhone Orion content-script isolated world, emits one 384-dim vector, and stays within strict cold-start and memory budgets. The embedder is NOT yet wired into the live classifier — that's Phase 3.

Phase 2 also closes CACH-04 (settings export/import) since iOS reinstall cycles are the realistic backup story for a phone-primary tool.

**In scope:**
- Vendoring Transformers.js + MiniLM-L6-v2 INT8 weights under `vendor/`
- Building `diagnostic/diagnostic.html` page + content-script debug probe to prove the model loads on iPhone Orion
- Mobile YouTube (`ytm-*`) and Mobile Instagram selectors as first-class equals to current desktop selectors; runtime "selectors stale" console warning when scans yield zero cards
- `SELECTORS.md` documenting every selector with last-verified date (DOM-05)
- `TRANSFORMERS-DECISION.md` recording the v3+ vs v2 choice and measured numbers (SC#3)
- `chrome.storage.local.embedder_ready: boolean` + optional `embedder_last_error: string`; truly silent fallback to v0.1 keyword tier on failure (CLAS-10)
- Settings export/import on the options page: file picker primary, paste-textarea fallback, replace-all on import with confirmation dialog (CACH-04)
- Updating `docs/install-ios.md` to drop the Request Desktop prerequisite once mobile-default works
- UX-01/02/04/05/07 are preserved behaviors — verify on iPhone Orion that they still work; no rebuild expected
- CALI-05 is an architectural constraint to honor (service worker stays message-router only; classifier critical path never `await`s `runtime.sendMessage`)

**Out of scope (deferred):**
- The actual semantic tier wiring (embedder inside classify()) — **Phase 3**
- Transcript fetching — **Phase 3**
- Per-video result cache (IndexedDB) — **Phase 3**
- Reason badges on the blur overlay (UX-03), per-topic confidence slider (UX-06), override ring buffer, transcript-success popup metric — **Phase 4**
- Phone-reboot + iOS Safari refresh persistence verification — **Phase 4 smoke playbook** (carried over from Phase 1 D-09)
- Public distribution paths (CWS, Xcode) — explicit `Out of Scope` in PROJECT.md

</domain>

<decisions>
## Implementation Decisions

### Embedder smoke test (CLAS-05, SC#3)

- **D-01:** **Vendor Transformers.js + MiniLM-L6-v2 INT8 weights offline.** Both ship inside the extension `.zip` under `vendor/` (e.g. `vendor/transformers/transformers.min.js`, `vendor/models/all-MiniLM-L6-v2/...`). Reference via `chrome.runtime.getURL` so the extension stays installable offline and the "all processing on-device" constraint holds in spirit. No build step; no `npm install` for runtime use. Bundle size ~25–30MB — matches PROJECT.md's "soft cap ~30MB" constraint exactly.

- **D-02:** **Smoke test runs in two places.** Primary: a new `diagnostic/diagnostic.html` page opened from a button in the options page — its own tab, so a crash kills only the diagnostic context. Secondary: an opt-in content-script probe behind a `diagnostic_mode: true` storage flag, so the author can verify the load inside the exact isolated-world context Phase 3's classifier will use.

- **D-03:** **Strict pass bar.** All three must hold on iPhone Orion:
  - One 384-dim Float32Array vector emitted by `pipe('hello world')`
  - Cold-start total (script import + pipeline init + first embed) ≤ **8s**
  - Tab memory ≤ **250MB** during one embedding (measured via Safari Web Inspector / `performance.memory` if exposed)

  Breaching any threshold fails the phase's embedder gate. Recorded numbers go into `TRANSFORMERS-DECISION.md` regardless.

- **D-04:** **Try Transformers.js v3+ first, fall back to v2.** Default to current `@huggingface/transformers` (v3+, ESM). If iOS WebKit chokes on CSP / WASM / ESM, fall back to `@xenova/transformers` (v2). Either way write `TRANSFORMERS-DECISION.md` recording: chosen version, what failed about the other, bundle size, cold-load ms, embed ms. **This is the SC#3 artifact** — Phase 3 reads this file before designing the classifier interface.

### Mobile DOM port (DOM-01..05)

- **D-05:** **Mobile-first.** After Phase 2 the user installs the extension, opens `m.youtube.com/shorts/...` on iPhone Orion **without** toggling Request Desktop, and sees blur. `ytm-*` selectors are first-class equals to `ytd-*` selectors. Request Desktop becomes truly optional — a fallback for selector breakage, not a daily prerequisite. **`docs/install-ios.md` updates as part of this phase** to drop the RD prerequisite from §4.

- **D-06:** **Hard-coded ordered selector arrays + runtime telemetry.** Same pattern v0.1 already uses in `content/youtube.js` `SHORT_SELECTORS`/`FEED_SELECTORS` and the `txt()` fallback chain. Mobile selectors go FIRST in the list, desktop selectors fall back. Add a runtime "selectors stale" warning: when N consecutive scans on a `/shorts/...` or `m.youtube.com/` URL match zero cards, `console.warn` with the URL and a 200-char `outerHTML` sample. CONCERNS.md recommended this; it's cheap (~10 LOC).

- **D-07:** **Manifest `content_scripts` matches unchanged.** Existing wildcards `*://*.youtube.com/*` and `*://*.instagram.com/*` already cover `m.youtube.com` and `m.instagram.com`. All mobile/desktop branching happens inside the existing content scripts. No new content-script entry, no extra host_permissions consent prompt.

- **D-08:** **Instagram mobile-default IS in scope.** DOM-03 explicitly says "on iPhone Orion using structural heuristics" — so mobile IG is the target. Re-probe `m.instagram.com/reels/...` live with Playwright (matching prior Phase 1 D-05 method), update `findCard` / `extractCaption` / `extractAuthor` heuristics in `content/instagram.js` as needed. **Extra rigor required** — CONCERNS.md flags this as the single highest-risk file. Specifically: keep the `>= 360 x 240` card-size threshold but verify it against real mobile Reel dimensions; if the bare `videoEl.parentElement` fallback fires on mobile, add a size-check guard so we don't render broken overlays.

### Failure mode — silent degradation (CLAS-10)

- **D-09:** **Truly silent.** When the embedder fails to load, the user sees the exact v0.1 blur behavior — no toast, no badge, no popup change, no options-page banner. The diagnostic page (D-02) is the only surface where failure is observable. Matches CLAS-10 literally. This is intentional even at the cost of "you might not notice for weeks" — discoverability lives in the diagnostic page, not the feed surface.

- **D-10:** **Embedder load state in `chrome.storage.local`.** Single boolean `embedder_ready: boolean` set to `true` after a successful warm-up embedding; `false` (or absent) otherwise. Optional `embedder_last_error: string` (just the `error.message`) so the diagnostic page can show what failed. Phase 3's classifier reads this flag to short-circuit to keyword-only when `false`. No version field, no enum status — keep it boolean for a clean Phase 3 contract.

- **D-11:** **One try/catch, no retry.** A single `try/catch` wraps `import(transformers) + new pipeline() + await pipe('warmup')`. ANY exception (CSP, OOM, model 404, WebKit incompat, version mismatch) → set `embedder_ready=false`, store `error.message` in `embedder_last_error`, swallow the throw. No automatic retry, no `embedder_retry_blocked_until` timestamp. v0.1 keyword tier is the absolute fallback. If real-world failures show transient patterns, Phase 4 may revisit.

### Settings export/import (CACH-04)

- **D-12:** **Export = `chrome.storage.sync` only.** JSON payload contains: `topics`, `enabled`, `sites`, `pauseUntil`. Stats (in `storage.local`) and the Phase 2 `embedder_ready` flag are **excluded** — stats are vanity counters that should reset on a new install, and `embedder_ready` is platform-dependent (the new install's WebKit version may differ).

- **D-13:** **Import UI = file picker + paste fallback.** Primary: `<input type="file" accept="application/json,.json">` button on the options page; iOS Files / iCloud Drive integration via the standard iOS picker. Fallback: a paste-into-textarea section on the same page in case Orion's file picker misbehaves. Both backed by one shared import handler. Belt-and-suspenders is worth ~30 LOC for a tool whose install path is itself unusual.

- **D-14:** **Import = replace-all with confirmation.** Before commit, show `confirm("⚠ This will replace your N existing topic(s) with M from the file. Continue?")`. Replace `chrome.storage.sync` wholesale with the imported payload. No merge logic, no per-topic prompting. Deterministic; matches the reinstall-from-backup mental model.

### Architectural constraints to honor

- **AC-01 (from CALI-05):** Service worker stays message-router only. No classification logic, no embedding calls, no `await` of `runtime.sendMessage` from the classifier critical path. The diagnostic page may message the SW for the `embedder_last_error` snapshot, but the live YouTube/Instagram blur path must not depend on SW responses.
- **AC-02 (from CONCERNS.md Risk Concentration):** Any change to `content/instagram.js` requires a manual three-context smoke test (Mac Safari, mobile Chrome user agent, real iPhone Orion if reachable) until a test harness exists.
- **AC-03 (PROJECT.md):** Pure vanilla JS / CSS / HTML for the extension. The vendored Transformers.js bundle is the **one** documented exception; do not introduce other npm deps for runtime.

### Claude's Discretion

- Exact filename and directory layout under `vendor/` — pick something the planner can grep cleanly.
- Diagnostic-page styling — minimal, matches options/options.css aesthetic; not a polish phase.
- Exact wording of console "selectors stale" warning.
- Whether to extract the duplicated `escapeHtml` and `applyBlur` shape (CONCERNS.md LOW) into `content/classifier.js` while touching mobile selectors — **discretion**, not required.
- Default `N` for "N consecutive empty scans before warning" — pick something between 3 and 8.
- Whether the diagnostic page exposes a "re-test" button — yes if cheap, no if it complicates the cold-start measurement.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before researching or planning.**

### Project context
- `.planning/PROJECT.md` — Core Value, Constraints ("$0 ongoing", "Bundle size ~30MB", "Pure vanilla JS — Transformers.js bundle will be the one exception"), Out of Scope (rules out cloud LLMs, local LLMs, IG transcripts, TikTok)
- `.planning/REQUIREMENTS.md` — DOM-01..05, CLAS-05, CLAS-10, UX-01/02/04/05/07, CACH-04, CALI-05 (the 14 Phase 2 requirements)
- `.planning/ROADMAP.md` — Phase 2 block (Goal, 7 Success Criteria, **UI hint: yes**)

### Prior phase context (carry-forward decisions)
- `.planning/phases/01-install-path-validation-on-iphone-orion/01-CONTEXT.md` — especially D-10 (Request Desktop is a documented user prerequisite TODAY) and D-11 (mobile DOM coverage is firmly Phase 2). Phase 2 explicitly removes the RD prerequisite per D-05 above.
- `.planning/phases/01-install-path-validation-on-iphone-orion/01-VERIFICATION.md` — Phase 1 closed with SC#1/SC#3/SC#4 accepted under pragmatic-close D-08; if Phase 2 breaks any of those, escalate immediately.

### Codebase state
- `.planning/codebase/STACK.md` — zero-toolchain stack baseline (the vendored Transformers.js bundle is the only documented exception)
- `.planning/codebase/ARCHITECTURE.md` — four-context model (background SW, content scripts, options, popup). Diagnostic page = a new fifth context.
- `.planning/codebase/CONCERNS.md` — **CRITICAL**: read the "Risk Concentration" section on `content/instagram.js` before touching IG selectors. Read the "Selector dependencies" section before touching YouTube selectors. Apply AC-02 rigor.
- `.planning/codebase/CONVENTIONS.md` — IIFE pattern, `globalThis.browser ?? globalThis.chrome` polyfill, `ss-` class prefix on host-injected DOM.

### Research outputs (frozen)
- `.planning/research/STACK.md` — original Transformers.js recommendation (worth a re-read since Phase 2 actualizes it)
- `.planning/research/PITFALLS.md` — mobile-DOM pitfalls (read before writing `ytm-*` selectors)

### Files Phase 2 will create
- `vendor/transformers/...` — Transformers.js bundle (v3+ default, v2 fallback per D-04)
- `vendor/models/all-MiniLM-L6-v2/...` — INT8 ONNX weights + tokenizer
- `diagnostic/diagnostic.html` + `diagnostic/diagnostic.js` (+ optional `diagnostic/diagnostic.css`)
- `SELECTORS.md` (at repo root, per DOM-05)
- `TRANSFORMERS-DECISION.md` (location TBD by planner — repo root or `docs/`)

### Files Phase 2 will modify
- `content/youtube.js` — add mobile selectors first in the ordered selector arrays
- `content/instagram.js` — verify/update structural heuristics for mobile Reels
- `manifest.json` — add `web_accessible_resources` for the vendored Transformers.js + ONNX weights so `chrome.runtime.getURL` works; add `diagnostic/diagnostic.html` if Orion needs it listed
- `options/options.html` + `options/options.js` + `options/options.css` — Export / Import section, "Open Diagnostics" button
- `docs/install-ios.md` — drop the Request Desktop prerequisite section once mobile-default works (per D-05)
- `background/service-worker.js` — optionally cleared of unused `runtime.onStartup` redundancy if convenient (AC-01 honor)

### Memory references
- [[user_browser]] — Orion is the user's primary browser; `chrome.*` API surface with `browser`/`chrome` polyfill applies
- [[reference_orion_install]] — install-from-file path (from Phase 1); install-ios.md is the source of truth

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Selector fallback chain pattern** — `content/youtube.js:38-49`, `:50-54`, `:62-67`, `:68-73` already use ordered selector lists with `txt(el, selectors)`. Phase 2 adds mobile entries to the head of each array; the helper itself doesn't change.
- **`txt()` helper** at `content/youtube.js:27` — keep as-is. Already returns the first non-empty match across selector candidates.
- **Phase 1 D-04 mobile additions** — `yt-shorts-video-title-view-model` + `.ytShortsVideoTitleViewModelHost` already in place (commit `52d8e10`). Build on these; do not replace.
- **`globalThis.SmartScroller`** registration at `content/classifier.js:125` — the natural place to hang a future `loadEmbedder()` helper. Diagnostic page can read this same surface.
- **Settings options-page debouncer** at `options/options.js:14-28` — the 250ms `scheduleSave` already exists. Export/Import handlers slot into the same file alongside `renderTopics()`.
- **`chrome.storage.local` daily-stats pattern** at `background/service-worker.js:62-70` — same shape pattern (`{key: serialized_object}`) for `embedder_ready` / `embedder_last_error`.

### Established Patterns
- **IIFE module pattern** in content scripts — `content/classifier.js:8-126`, `content/youtube.js:10-187`, `content/instagram.js:17-173`. Embedder loader code (when added in a Phase 3 prep) lives inside `content/classifier.js`'s IIFE.
- **`api` alias** for `globalThis.browser ?? globalThis.chrome` — every new JS file (diagnostic, etc.) MUST start with this.
- **`ss-` class prefix** on every host-page-injected DOM node (`content/common.css`). The diagnostic page is NOT host-injected, so it can use unprefixed classes like options/popup do.
- **Console-only diagnostics** — there's no telemetry; "selectors stale" warnings via `console.warn(...)` match existing instrumentation style (zero of which exists currently — this is new but harmonious).
- **Custom events with `ss:` namespace** (`content/classifier.js:37`) — if the diagnostic page needs to signal "embedder loaded", use `ss:embedder-ready`.

### Integration Points
- **`web_accessible_resources` MANDATORY for vendored model weights.** `manifest.json` has none today. To load model files via `chrome.runtime.getURL` from the content script (or even the diagnostic page reading via `fetch`), they MUST be listed. Planner: add a `web_accessible_resources` entry with `resources: ["vendor/*"]` and `matches: ["*://*.youtube.com/*", "*://*.instagram.com/*"]` (the diagnostic page is at extension origin and doesn't need it).
- **Service worker stat aggregation** at `background/service-worker.js:73-83` already handles `ss:stat` messages with `return true` for async. Same pattern works if the diagnostic page wants to post a `ss:embedder-ready` ack — but per AC-01, the classifier critical path does NOT depend on SW responses.
- **`docs/install-ios.md` §4** (Request Desktop prerequisite, ~6 lines) is the surgical edit Phase 2 makes after mobile-first lands.

### Anti-patterns to avoid (from CONCERNS.md + existing CONVENTIONS.md)
- **Do NOT** put classifier or embedder logic in `background/service-worker.js` (CALI-05, AC-01, CONCERNS.md anti-pattern).
- **Do NOT** rely on Instagram class names — Instagram hashes them. Structural heuristics only (AC-02).
- **Do NOT** introduce a build step. `npm install` is not in the runtime install path; even the smoke test must run on what's vendored (D-01).
- **Do NOT** add UI surfaces for embedder failure beyond the diagnostic page (D-09).
- **Do NOT** await `runtime.sendMessage` on the blur critical path (CALI-05, AC-01).

</code_context>

<specifics>
## Specific Ideas

- **Diagnostic page UI** — minimal, three rows: (1) "Load embedder" button → spinner → ✓ with measurements OR ✗ with error.message; (2) Last result table: status, version, cold-load ms, embed ms, vector dim, peak memory; (3) "Copy to TRANSFORMERS-DECISION.md" button that dumps current measurements as a markdown block the author pastes.
- **Pinned selector probe** — when probing mobile YouTube live for D-06, pick one canonical Shorts URL the author actually watches today (or use `youtube.com/shorts/dQw4w9WgXcQ` as a stable test) and record the exact `outerHTML` snapshot snippet in SELECTORS.md as the "verified DOM shape" so future maintainers know what was working.
- **Instagram heuristic safeguard** — for D-08, the `findCard` `videoEl.parentElement` fallback at `content/instagram.js:36` is unsafe. Add: if walk-up returns the bare `parentElement` AND its `getBoundingClientRect()` is `< 360 x 240`, return `null` (skip blurring this video). Better to miss a blur than render a broken overlay.
- **TRANSFORMERS-DECISION.md skeleton** — short markdown: `## Chosen: v{X}.{Y}` / `### What we tried first` / `### Why it {worked|failed}` / `### What we fell back to (if any)` / `### Measurements (iPhone Orion 2026-05-{DD})` (cold-load ms, embed ms, bundle delta, peak memory). 30–50 lines; lives at repo root next to `README.md`.
- **SELECTORS.md skeleton** — table per host: `Site | Selector | Used for | Last verified | Notes`. Each row dated. Refresh-by-grepping. Lives at repo root.
- **Embedder version commit message** — use `feat(02): vendor transformers.js v{X.Y} + MiniLM-L6-v2 INT8 (~{MB}MB)` for the bundling commit so it's grep-friendly in `git log`.

</specifics>

<deferred>
## Deferred Ideas

### Reviewed but not folded into Phase 2
- **Wire embedder into live `classify()`** — that IS Phase 3. Phase 2 only proves it loads.
- **Transcript fetching** — Phase 3.
- **Per-video IndexedDB cache** — Phase 3 (CACH-01..03).
- **Reason badges on the blur overlay** — Phase 4 (UX-03).
- **Per-topic confidence slider, override ring buffer, transcript-success metric** — Phase 4 (UX-06, CALI-01..04).
- **Phone-reboot + iOS Safari refresh persistence** — Phase 4 smoke playbook (carried from Phase 1 D-09).
- **Lazy load embedder only on first classify** — considered for D-11, rejected in favor of eager warm-up so we get clear pass/fail at startup. Phase 4 may revisit if cold-start UX matters.
- **Automatic retry / exponential backoff on embedder fail** — rejected in D-11. Reconsider only if Phase 4 telemetry shows transient failures dominate.
- **Subtle popup indicator for `embedder_ready`** — considered for D-09, rejected. Pure silence honors CLAS-10. Phase 4 may add it as part of the trust surface.
- **Settings export auto-trigger on every change** — rejected; manual export only.
- **Test harness for the structural-heuristics IG code** — CONCERNS.md TECH DEBT item; deferred (no test framework in the project yet). AC-02 manual three-context rigor stands in.
- **`*://*.youtube-nocookie.com/*` host_permission** — not worth the install-time prompt friction for a personal tool. Add only if real off-topic embeds slip through.
- **Refactor duplicated `escapeHtml`/`applyBlur`** — CONCERNS.md LOW. Claude's discretion to do it opportunistically while touching mobile selectors, not required.

### Truly out of scope
- Cloud LLM APIs (Claude, OpenAI, Gemini) — `Out of Scope` in PROJECT.md
- Local LLM via Ollama — `Out of Scope`
- TikTok For You support — `Out of Scope`
- User accounts / telemetry / error reporting — `Out of Scope`
- CWS public listing, App Store distribution — `Out of Scope`

</deferred>

---

*Phase: 2-mobile-dom-port-on-device-embedder-smoke-test*
*Context gathered: 2026-05-16*
