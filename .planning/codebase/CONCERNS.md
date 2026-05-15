# Codebase Concerns

**Analysis Date:** 2026-05-15

This document is an honest inventory of fragility, debt, and risk in SmartScroller v0.1.0. The extension is small (~700 LOC across 4 JS files) and the architecture is deliberately simple, but it lives on top of two of the most aggressively-changing DOMs on the web. Almost every concern in this document traces back to that single fact.

Severity tags: **[CRITICAL]** = high probability of breaking in production, **[HIGH]** = will degrade noticeably under realistic conditions, **[MEDIUM]** = worth tracking, **[LOW]** = acceptable for v0.1 but should be planned.

---

## Risk Concentration

**`content/instagram.js` is the single highest-risk file in the codebase.** [CRITICAL]

Why it dominates the risk profile:

- Instagram's production DOM uses **hashed, build-stamped class names** that rotate on every deploy (sometimes multiple times per week). Nothing in `content/instagram.js` can anchor on a class.
- The script therefore relies on **purely structural heuristics**: find every `<video>`, walk up to a "card-like" ancestor (`findCard` in `content/instagram.js:21-37`), then guess at caption/author via `h1`/`h3`/`span[dir="auto"]`/profile-link patterns (`extractCaption` in `content/instagram.js:39-54`, `extractAuthor` in `content/instagram.js:56-62`).
- These heuristics depend on properties Instagram could change without warning:
  - That a Reel is contained in `<article>` or `div[role="presentation"]` (`content/instagram.js:23-26`).
  - That the card bounding box is `>= 360 x 240` after at most 8 parent hops (`content/instagram.js:28-35`). A wrapper redesign can move this past the threshold and silently return `videoEl.parentElement`, which then can't render a meaningful overlay.
  - That captions live in `h1` / `h3` / `span[dir="auto"]` (`content/instagram.js:42-46`).
  - That author links match the negative-pattern selector at `content/instagram.js:58-60`, which excludes `/p/`, `/reel/`, `/explore/` — any new Instagram URL pattern (e.g. a new `/clips/` or `/watch/`) will leak through and produce wrong author names.
- The script also blurs **every `<video>` on the page**, not specifically Reels (`scan` in `content/instagram.js:131-141`). Stories previews, IGTV, profile video grids, and embedded video posts are all swept up. This is acknowledged in the file header as acceptable, but it means the **false-positive rate on Instagram is structurally higher than on YouTube** — a Story preview with no caption will get a "(no caption)" overlay, which users will report as a bug.
- There is **no fallback path** if `findCard` returns the bare `videoEl.parentElement`. The overlay attaches to whatever that is, with no size check, and `applyBlur` (`content/instagram.js:82-112`) will happily flip its `position` and inject an absolute-positioned overlay into a node that may not visually be a card. This can produce broken-looking blurs that span the wrong region.

**Recommendation when this file breaks (it will):**
1. Reproduce on three URLs: `instagram.com/`, `instagram.com/reels/`, `instagram.com/reels/<id>/`.
2. Update `findCard` first — it's the highest-leverage selector. Print `card.tagName`, `card.getBoundingClientRect()`, and `card.outerHTML.slice(0, 200)` while iterating.
3. Update `extractCaption` and `extractAuthor` second; these can be wrong without blocking the blur (just an ugly overlay).
4. Treat any change to `content/instagram.js` as requiring a **manual three-context smoke test** until a test harness exists.

---

## Tech Debt

### No automated tests of any kind [CRITICAL]

**Files:** entire repo — no `*.test.*`, no `*.spec.*`, no `jest.config.*`, `vitest.config.*`, `playwright.config.*`, or `package.json`.

**Impact:** Every selector change, classifier tweak, or storage-shape edit is verified by manual smoke testing only. Given that YouTube and Instagram change their DOM independently, this means breakage is detected **by users in production**, not by CI. The codebase is small enough today that this is survivable, but the cost compounds with every added topic-matching rule or selector.

**Fix approach:**
- Snapshot fixtures: capture real `outerHTML` of one short, one home-feed card, one Reel feed item, one Reel page, save as static HTML, run `extractShortMeta`/`extractFeedMeta`/`extractMeta` against them in a Vitest + jsdom suite. This guards 80% of the extraction surface against silent regressions.
- Pure-function tests for `classifier.js`: `normalize`, `expandHashtag`, `matchKeyword`, `classify` are all deterministic and have zero DOM dependencies — they should be the first thing covered.
- Defer end-to-end Playwright tests against live YouTube/Instagram until v0.2; they're flaky and the sites' anti-bot measures will eventually fight back.

### No build pipeline, no `package.json`, no linter, no formatter [MEDIUM]

**Files:** repo root — no `package.json`, `.eslintrc*`, `.prettierrc*`, `tsconfig.json`, `biome.json`.

**Impact:** Style drift is invisible (current style is consistent only because there's one author). No type-checking means storage-shape mismatches (e.g. `state.sites` shape vs `DEFAULTS.sites` shape) are caught at runtime in the browser, not at edit time. No bundler means the planned Transformers.js upgrade (see "Missing Critical Features" below) will require introducing one anyway.

**Fix approach:** Adding `package.json` + Biome (lint+format in one tool) + a minimal `vitest` setup is a half-day task and unblocks every other quality improvement. Defer TypeScript until the codebase is 2–3x larger.

### No icons in `manifest.json` [LOW] *(documented intentional)*

**Files:** `manifest.json` — no `"icons"` or `"action.default_icon"` keys.

**Impact:** Some browsers (notably newer Chrome builds and Edge) emit a warning on load; the extension still functions. Firefox is stricter about this on signed listings. Toolbar action falls back to a generic icon, which hurts perceived polish.

**Fix approach:** Drop a 16/32/48/128 PNG set into an `icons/` dir and reference them in `manifest.json`. Use the same glyph for both `icons` and `action.default_icon`.

### Orion install path is non-trivial [LOW] *(documented in README, lines 19–30)*

**Files:** `README.md:19-30` describes the workaround (publish privately to Chrome Web Store as Unlisted; Orion picks it up). There is no `web-ext` script, no zip artifact in CI, and no signed `.xpi`.

**Impact:** Orion users — the explicit target browser in the README's tagline — cannot install locally without going through Chrome Web Store first. Friction for the primary audience.

**Fix approach:** Once Orion adds an official `load unpacked` path this becomes moot. Until then, document the exact CWS-unlisted workflow with screenshots, or maintain a signed Mozilla Add-ons listing as a parallel distribution channel.

### Service worker re-runs `rollStatsDay` at top level on every wake [LOW]

**Files:** `background/service-worker.js:62-63` — `rollStatsDay()` is both registered on `onStartup` *and* invoked at module top-level.

**Impact:** Service workers in MV3 are evaluated on every wake, so the bare `rollStatsDay()` call already covers the startup case. The `onStartup` listener is redundant. Harmless but confusing — and the top-level call also fires on every event-driven wake (including `runtime.onMessage` from stat reports), which means a stats-handling message can race a same-tick day-roll write. In practice the writes converge correctly because both paths read-modify-write the same key, but it's unnecessary churn on `chrome.storage.local`.

**Fix approach:** Remove the redundant `api.runtime.onStartup.addListener(rollStatsDay)` (`background/service-worker.js:62`) and rely solely on the top-level call. Or invert: keep `onStartup`, drop the top-level call.

### Duplicated `escapeHtml` + duplicated `applyBlur` shape [LOW]

**Files:** `content/youtube.js:81-85` and `content/instagram.js:76-80` (identical `escapeHtml`); `content/youtube.js:87-117` and `content/instagram.js:82-112` (near-identical `applyBlur`).

**Impact:** Bug fixes (e.g. event-listener leak on overlay teardown, accessibility attributes, focus management) must be applied in two places. Easy to forget one.

**Fix approach:** Move both helpers to `content/classifier.js` and hang them off `globalThis.SmartScroller`. The classifier already plays the role of a shared library; it's the natural home.

### `youtube.js` SPA-navigation reset is a no-op [LOW]

**Files:** `content/youtube.js:165-174` — the `setInterval` polls `location.href`, and on change iterates `[data-ss-state]` elements but the body of the `forEach` is just a comment ("Only reset for items the new view won't display anymore"). It performs no actual reset work; only `scheduleScan()` runs.

**Impact:** Dead code that reads like it does something. Future maintainer will assume there's logic here. In practice the system relies on YouTube actually removing old nodes from the DOM, which it does — so the result is correct, but the code is misleading.

**Fix approach:** Delete the empty `forEach` (`content/youtube.js:169-171`) and add a one-line comment explaining that YouTube removes old nodes on SPA nav, so no manual reset is needed.

---

## Fragility Points

### Selector dependencies (the biggest single category) [CRITICAL]

**YouTube selectors (`content/youtube.js:14-25`, `:38-58`, `:62-78`):**

The script hard-codes the `ytd-*` custom-element vocabulary:
- `ytd-reel-video-renderer`, `ytm-shorts-lockup-view-model`, `ytd-shorts-lockup-view-model` for Shorts
- `ytd-rich-item-renderer`, `ytd-video-renderer`, `ytd-compact-video-renderer`, `ytd-grid-video-renderer` for the feed
- `ytd-rich-shelf-renderer`, `ytd-reel-shelf-renderer` for the Shorts-shelf detection (`content/youtube.js:130`)
- `ytd-channel-name`, `yt-formatted-string`, `#video-title`, `#channel-name`, `#description-text`, `#metadata-line` for field extraction

YouTube **renames or replaces these element tags during major UI revamps** (the `ytm-` / `viewModel` lineage is itself a recent migration). The fallback selectors in each `txt()` call (`content/youtube.js:38-49`, `:50-54`, `:62-67`, `:68-73`) provide some redundancy — multiple selectors are tried in order — but if YouTube drops the `ytd-` prefix entirely or moves to a fully view-model-based render tree, the top-level container selector lists will need a full rewrite.

The `extractFeedMeta` path is more fragile than `extractShortMeta` because feed cards have far more layout variants (search results, watch-page sidebar, channel pages, home grid). Adding a new context like `ytd-shelf-renderer` children may silently fail to be classified.

**Instagram selectors (`content/instagram.js`):**

Already covered in **Risk Concentration** above — there are no class-name selectors at all, only structural heuristics, which is the right design given Instagram's hashing, but makes the script vulnerable to layout changes rather than class renames.

**Mitigation strategies for both:**
1. Add a "selectors stale" telemetry signal: count consecutive scans where `document.querySelectorAll(SHORT_SELECTORS)` returns 0 on `/shorts/*`, log to console after N consecutive zeros. Surfaces breakage during dev.
2. Maintain a `SELECTORS.md` (or comment block at the top of each content script) with the **last verified date** for each selector.
3. When a selector breaks, add the old selector to the list rather than replacing — both YouTube and Instagram sometimes ship A/B-tested variants in parallel.

### Classifier cache invalidation across content scripts [HIGH]

**Files:** `content/classifier.js:11-12` (`cache`, `pending`), `:32-39` (`storage.onChanged` listener), `content/youtube.js:177-184` and `content/instagram.js:163-170` (the `ss:settings-changed` window-event handlers).

**The mechanism today:**
1. Settings live in `chrome.storage.sync`; classifier caches them in a per-content-script-context module-scoped `cache` (`content/classifier.js:11`).
2. When `chrome.storage.sync` changes, `storage.onChanged` fires inside every content-script context, the cache is nulled, and a `window.dispatchEvent(new CustomEvent('ss:settings-changed'))` is emitted (`content/classifier.js:36-37`).
3. `youtube.js` and `instagram.js` listen for that custom event, strip every `[data-ss-state]` attribute, remove every overlay, and trigger a rescan.

**Why this is fragile:**
- The classifier and the host script are **separate IIFEs sharing a window**, communicating via a custom event. If the host script's IIFE were ever moved into a module, or if the listener registration timing changed (e.g. classifier runs after host script), the event would fire into the void and existing overlays would never refresh.
- The `storage.onChanged` callback is registered **once per content-script load** (`content/classifier.js:32`). Content scripts don't re-execute on SPA navigation, so this is fine — but if `manifest.json` is ever changed to inject the scripts dynamically per route, the listener lifecycle has to be reconsidered.
- There's no "version" or "epoch" on the cached settings, so a race between an in-flight `classify()` and a `storage.onChanged` invalidation can apply a blur using stale topics. The misclassified item then sits as `[data-ss-state=blurred]` until the `ss:settings-changed` cleanup pass — which does happen, so the net result is eventually-consistent. But the inflight call still consumed work.
- The event name `ss:settings-changed` is a stringly-typed contract with no central definition. Add a constant in `content/classifier.js` and import-by-reference once a build step exists.

**Fix approach:** Make the `SmartScroller` API surface (`content/classifier.js:125`) expose an `onSettingsChanged(callback)` subscription rather than relying on a window event. That collapses the contract from "stringly-typed pub/sub on the global window" to a direct function call, which is testable and rename-safe.

### Daily stats roll on multi-day service-worker suspension [HIGH]

**Files:** `background/service-worker.js:36-38` (`today()`), `:62-70` (`rollStatsDay` + registration), `:73-85` (the message handler).

**The mechanism today:**
- Stats are stored under `chrome.storage.local.stats` as `{ day, blurred, allowed }` (`background/service-worker.js:32-34`).
- `rollStatsDay` resets the counters if `stats.day !== today()` (`:67-69`).
- It's called on `runtime.onStartup` and at module top level on every service-worker wake (`:62-63`).
- The stat-increment handler **also defensively re-checks the day** (`:77` — `stats && stats.day === today() ? stats : { ... }`) before updating, so a missed roll is corrected on the next stat event.

**Why this is still fragile:**
- If the service worker stays suspended for multiple days **with no user activity on YouTube or Instagram** (no stat messages arriving), `rollStatsDay` never runs and the stale `stats.day` persists. The first stat event after multi-day inactivity will silently overwrite the stale counters with a fresh `{ day: today(), blurred: 0, allowed: 0 }` (`:77`) — which is correct, but **the previous day's counters are lost** without being reported anywhere.
- There is no historical store: the popup (`popup/popup.js:8-9`) and options page (`options/options.js:162-166`) only ever read the current-day stats. If the user wants weekly trends, the data isn't there.
- The day boundary is local-time-based (`new Date().toISOString().slice(0, 10)`) but `toISOString` returns UTC, so "today" rolls at UTC midnight, not local midnight. For a user in PT, the counter resets at 4–5pm local time, which is surprising.

**Fix approach:**
1. Use a local-date string (`new Date().toLocaleDateString('en-CA')`) so the roll matches user expectation.
2. On every roll, archive the outgoing day's counters into `chrome.storage.local.statsHistory` (an array, capped at 30 days).
3. Optional: `chrome.alarms.create('roll-stats', { periodInMinutes: 60 })` so the SW is woken hourly to check the date — guarantees the roll fires even with zero user activity.

### MutationObserver on `document.body` with subtree:true [HIGH]

**Files:** `content/youtube.js:160-161` and `content/instagram.js:152-153`.

Both content scripts attach a `MutationObserver` with `{ childList: true, subtree: true }` rooted at `document.body`. That's the largest possible observation surface — every DOM mutation anywhere in the page fires the callback.

**Why this is on the hot path:**
- YouTube's home feed continuously mutates as videos lazy-load thumbnails, channel avatars stream in, and engagement counters tick. On a busy YouTube page the observer fires **hundreds of times per second**.
- The mitigation is the debounce in `scheduleScan` (`content/youtube.js:152-158`, `content/instagram.js:144-150`) — a 250–300ms timer that coalesces bursts into one scan. This is the right pattern, **but**:
  - The mutation callback itself still runs on every change, even though only one scan is enqueued. That's a function call (`scheduleScan`), an `if (scanTimer) return` check, and a `setTimeout`. Cheap, but it's CPU time on every YouTube DOM mutation.
  - Each scan calls `document.querySelectorAll(SHORT_SELECTORS)` and `document.querySelectorAll(FEED_SELECTORS)` over the whole document (`content/youtube.js:146-147`). On a feed with hundreds of items this is O(n) per scan. Combined with the 250ms debounce, this is the dominant CPU cost of the extension.
- The Instagram observer (`content/instagram.js:152`) is slightly worse because `scan()` (`:131-141`) calls `document.querySelectorAll('video')` and then `findCard` for every video, which walks up to 8 ancestors per video. On a Reels grid this is acceptable; on a feed with many embedded videos it's measurable.

**Fix approach:**
- Narrow the observer root to a more specific container once the first scan finds one (e.g. `ytd-app` on YouTube, the main content area on Instagram). Falls back gracefully if the container isn't found.
- Filter `MutationRecord` entries in the callback: skip mutations whose `addedNodes` contain only text nodes or only `style`/`script` elements. Early-out reduces the work even more before the debounce kicks in.
- Maintain a `Set<Element>` of already-processed items and `querySelector` only nodes inside `mutation.addedNodes` rather than the whole document.

### `ss:reveal` decision is intentionally not sticky [MEDIUM] *(design decision, will be reported as a bug)*

**Files:** `content/youtube.js:108-114` and `content/instagram.js:104-109` (the reveal click handler); `README.md:100` (documented intent).

When the user clicks **Show anyway**, the overlay is removed and `data-ss-state="revealed"` is set on the card. But this state lives only on the DOM node. As soon as YouTube/Instagram unmounts that node (scrolling away on Shorts, navigating away, or the SPA re-rendering the feed), the item will be re-evaluated from scratch and **re-blurred** on next render.

This is **intentional** per `README.md:100` ("If the same short scrolls back into view (or you navigate away and back), it'll blur again. That's intentional — easy to override, easy to dismiss again"). The product reasoning: a "Show anyway" decision shouldn't permanently whitelist an item.

**Why it's still a concern:** Users almost universally interpret "Show anyway" as a persistent choice. Expect bug reports along the lines of "I clicked Show anyway and it re-blurred when I scrolled back." This is a **UX-vs-spec mismatch**, not a code defect, but it should be:
1. Surfaced in the overlay UI — e.g. button label "Show this once" instead of "Show anyway".
2. Tracked as a roadmap item with an explicit decision: sticky reveals (with a TTL?), per-item allowlist, or status quo.

**Fix approach (if changing):** add a `revealed:{ [hashOfMeta]: timestamp }` map in `chrome.storage.local`, check it before applying blur. Costs ~50 LOC and a migration.

---

## Security Considerations

The extension's permission posture is **deliberately minimal**, which is good. But a few things are worth noting:

### Permissions are tight [LOW] *(positive finding)*

**Files:** `manifest.json:6-10`.

- `permissions`: `["storage"]` only.
- `host_permissions`: `*://*.youtube.com/*` and `*://*.instagram.com/*` only.
- No `tabs`, no `webRequest`, no `scripting`, no `cookies`, no `<all_urls>`.

This is a healthy posture for a content-filtering extension. Users can audit it quickly. Keep it this way; adding broader permissions for future features (e.g. TikTok) should require explicit justification.

### Inline `innerHTML` for overlay markup [MEDIUM]

**Files:** `content/youtube.js:98-107`, `content/instagram.js:93-102`.

The overlay HTML is built via `overlay.innerHTML = \`<div ...>${escapeHtml(meta.title)}...\`` — user-controlled fields are escaped via `escapeHtml` (`content/youtube.js:81-85`, `content/instagram.js:76-80`), which covers `& < > " '`. This is sound for XSS prevention against the values flowing through.

**However:**
- `escapeHtml` is correct but unfollowable at a glance — anyone editing the template must remember every interpolation is `escapeHtml`-wrapped. A single bare `${meta.title}` would re-introduce XSS via a crafted YouTube video title or Instagram caption (both attacker-controllable in practice).
- The safer pattern is to build the overlay via `document.createElement` + `textContent`, eliminating the escape requirement entirely. This is what the options page does (`options/options.js:84-104`) and what the rest of the codebase should converge to.
- CSP for content scripts inherits from the host page; YouTube and Instagram both ship strict CSPs that would block injected `<script>` regardless. So the **practical** XSS risk is low. The concern is about **defensive coding hygiene**, not an active vuln.

**Fix approach:** Replace both `innerHTML` blocks with DOM construction. ~15 LOC each, safer, removes the need for `escapeHtml` (which can then move to a single shared util or be deleted).

### No content-security-policy declared in manifest [LOW]

**Files:** `manifest.json` — no `content_security_policy` key.

MV3 applies a strict default CSP (`script-src 'self'; object-src 'self'`) for extension pages, which is fine for v0.1. Worth declaring explicitly once the Transformers.js path lands, because WASM workers will need `wasm-unsafe-eval` and you'll want that decision documented.

### Stat-message channel is unauthenticated [LOW]

**Files:** `background/service-worker.js:73-85` (handler), `content/classifier.js:117-123` (sender).

The `runtime.sendMessage({ type: 'ss:stat', kind })` channel accepts any message of that shape. In MV3, `runtime.onMessage` from content scripts is implicitly trusted (only this extension's scripts can send to it), so there's no real attack surface. But the handler has no `sender` validation (`background/service-worker.js:73`) — `_sender` is even prefixed with underscore. If `externally_connectable` is ever added to `manifest.json`, this would become a vulnerability.

**Fix approach:** When/if `externally_connectable` is added, check `sender.id === chrome.runtime.id` before handling.

---

## Performance Concerns

### MutationObserver hot path

Covered in detail under **Fragility Points → MutationObserver**. Summary: debounced but still firing constantly; full-document `querySelectorAll` on each scan; could be narrowed.

### Per-scan `querySelectorAll('video')` on Instagram [MEDIUM]

**Files:** `content/instagram.js:133`.

Selects every `<video>` on the page on every scan. On Instagram's feed with multiple Reels and Stories videos this is fine; on a profile grid with many video tiles it can grow. Combined with `findCard` walking up to 8 levels per video, the per-scan cost is roughly `O(videos × 8)`. Acceptable now, will need a processed-set cache if Instagram ever introduces denser video grids.

### `await SS.loadSettings()` is awaited inside `process()` on every item [MEDIUM]

**Files:** `content/youtube.js:125` and `content/instagram.js:119`.

The per-content-script `cache` in `content/classifier.js:11` makes this nearly free after the first call (subsequent calls return the cached object synchronously via a resolved promise), but it's still an extra microtask per card. With dozens of cards per scan, that's dozens of microtasks before any classification work begins.

**Fix approach:** Resolve settings once per scan and pass into `process()` rather than re-awaiting per item. Marginal in absolute terms, but it keeps the scan synchronous-feeling for the user.

### `setInterval(load, 15_000)` in the popup [LOW]

**Files:** `popup/popup.js:42`.

The popup polls `chrome.storage` every 15s while open. That's fine for an occasionally-opened popup. But there's also `setInterval(renderPauseState, 30_000)` in `options/options.js:213`. Neither interval is cleared on page hide; in practice browsers throttle hidden tabs so this is harmless. Note for the record.

---

## Fragile Areas

### `content/instagram.js` as a whole [CRITICAL]

See **Risk Concentration**. Treat any edit here as one-revert-away-from-breaking-all-three-Instagram-contexts.

### `content/youtube.js` selector lists [HIGH]

The arrays at `content/youtube.js:14-25` are the contract with YouTube's element vocabulary. Any change to them (adding a new selector, removing one) should be tested across:
- `youtube.com/` (home feed)
- `youtube.com/shorts/<id>` (Shorts player)
- `youtube.com/results?search_query=...` (search)
- `youtube.com/watch?v=...` (watch page sidebar / Up Next)
- `youtube.com/@channel` (channel page)

No automation currently checks any of these.

### Settings shape vs `DEFAULTS` shape [MEDIUM]

**Files:** `background/service-worker.js:7-30` defines `DEFAULTS.sites` as `{ youtube_shorts, youtube_home, instagram_reels }`. The classifier and host scripts also use these keys (`content/classifier.js:23`, `content/youtube.js:127-133`, `content/instagram.js:120`). The options page initialises `state.sites` with the same keys (`options/options.js:10`).

There is **no central schema**. Adding a fourth site key (e.g. `tiktok_fyp`) means editing four files and hoping you found all of them. The classifier's default-fallback at `content/classifier.js:23` would silently miss a new key, defaulting it to `true`, which is permissive enough that the bug wouldn't crash anything — just behave wrong.

**Fix approach:** Centralise the site key list in `content/classifier.js` (or a new `content/schema.js`) as a single source of truth. Defer until adding the second post-MVP site.

---

## Scaling Limits

### Topic-count and keyword-count [LOW]

**Files:** `content/classifier.js:101-109`.

The classifier loop is `O(topics × keywords-per-topic)` per item, executed per card per scan. For the seeded default (1 topic, ~34 keywords; `background/service-worker.js:13-21`), this is trivial. With 20 topics × 30 keywords = 600 ops per item × 100 items per scan = 60k ops per scan. Still well under a frame budget.

Where it would matter: if/when semantic embedding classification is added, the per-item cost moves from microseconds to milliseconds, and the per-scan cost can exceed a frame. Plan the offscreen-document architecture for that tier from day one (already noted in `README.md:73-75`).

### `chrome.storage.sync` quota [LOW]

`chrome.storage.sync` has an 8 KB-per-item cap and 100 KB total. A user with 50 topics × 50 keywords × ~15 chars/keyword + JSON overhead ≈ 40–60 KB. Realistic users will be well under this. Heavy users (someone building a 200-topic taxonomy) could hit it.

**Fix approach:** When the largest topics array crosses ~30 KB serialised, migrate to `chrome.storage.local` for topic storage (drop sync) and add an explicit import/export flow (already on the roadmap, `README.md:108`).

---

## Dependencies at Risk

### None — the extension has zero runtime dependencies [LOW] *(positive finding)*

There is no `package.json`, no `node_modules`, no `lib/` with vendored libraries. Everything is plain DOM and `chrome.*` APIs. This is a strength: nothing in npm can break this extension. The flip side is the lack of build tooling (see **Tech Debt → No build pipeline**), but on the dependency-supply-chain axis the posture is excellent.

The only **external dependencies** are the structural contracts with YouTube and Instagram's DOMs, which are covered exhaustively above.

---

## Missing Critical Features

### Semantic NLP classification tier [HIGH] *(roadmap, not implemented)*

**Files:** `content/classifier.js:5-7` (comment hook), `README.md:68-76` (upgrade-path doc).

Promised in the README and called out as the next major feature. Today, classification is **purely keyword-based** (`content/classifier.js:73-111`). This means:
- Topic "AI" with keyword `"ai"` matches "AI lawsuit", "AI girlfriend", "AI is dangerous" — semantically off-topic for someone wanting AI engineering content.
- Conversely, "Anthropic announces Claude 4.7" won't match unless `claude` or `anthropic` is in the keyword list (it is in the seed, but a user starting fresh wouldn't have it).
- Multi-word keywords match as substrings (`content/classifier.js:66`); single words match on word boundaries (`content/classifier.js:69`). No fuzzy match, no stemming, no synonyms beyond hashtag expansion.

The architecture has a clear extension point (the classifier returns a `{ reason }` field that lets a semantic tier slot in after a keyword no-match), but the implementation work is real: bundle a quantized embedding model (~23 MB), set up an offscreen document for WASM execution, manage embedding caches, tune the similarity threshold.

**Impact:** Users with non-trivial topic definitions will see misclassifications. The keyword tier alone is a v0.1 floor, not a final solution.

**Fix approach:** Already documented in `README.md:68-76`. Three-stage rollout: (1) Transformers.js + offscreen doc plumbing, (2) topic embedding pre-compute on options-page save, (3) cosine-similarity gate with a user-tunable threshold (default 0.55).

### No per-topic toggle [MEDIUM] *(roadmap)*

**Files:** `options/options.js:71-160` — topics are all-on or deleted.

Users can't pause "Cooking" temporarily without deleting it. Documented in `README.md:106`. Trivial to add: topic-level `enabled: boolean`, gate the keyword loop on it in `content/classifier.js:102`.

### No "hard block" mode [LOW] *(roadmap)*

Documented in `README.md:107`. Today blur is the only blocking style. Some users want a full interstitial (similar to LeechBlock or StayFocusd). Architecturally this is a CSS variant — same overlay structure, different content.

### No daily quota [LOW] *(roadmap)*

Documented in `README.md:108`. "You've watched 5 off-topic Shorts today, that's your limit" — would need a per-day counter on revealed items, separate from the existing stats roll.

### No TikTok support [LOW] *(roadmap)*

Documented in `README.md:109`. Adding TikTok means a third content script with similarly hostile selectors. Wait until the YouTube/Instagram pair is stable.

### No export/import for topics [LOW] *(roadmap)*

Documented in `README.md:110`. Users with carefully-tuned taxonomies can't back them up or share them. Trivial: JSON download/upload from the options page.

---

## Test Coverage Gaps

Because there are zero tests, "gaps" is really "everything". Prioritised list:

### `content/classifier.js` — pure-function tier [HIGH]

**What's not tested:** `normalize`, `expandHashtag`, `escapeRegex`, `matchKeyword`, `classify`. All are pure functions of their inputs (modulo `loadSettings`, which can be stubbed).

**Why this is highest priority:** Classification is the product. If `normalize` ever drops a code point or `matchKeyword` regresses on multi-word vs single-word handling, every blur decision is wrong. These functions are also the easiest to test (no DOM, no async-on-storage).

**Risk:** A normalize/regex edit silently changing behaviour. Specifically, the unicode property escape `\p{L}\p{N}` in `content/classifier.js:45` requires `u` flag (it has it) — but a future "simplification" could drop the flag and silently break non-ASCII titles.

### Metadata extraction — `extractShortMeta`, `extractFeedMeta`, `extractMeta` [HIGH]

**Files:** `content/youtube.js:37-79`, `content/instagram.js:64-74`.

**Why:** These functions encode the brittle selector contracts. Snapshot-based tests using captured `outerHTML` would catch most regressions before they ship.

**Risk:** Selector list edits that silently return empty strings — the script then treats the item as "not yet hydrated" (`content/youtube.js:123`, `content/instagram.js:117`) and never classifies it. Net effect: extension stops working entirely with no error.

### Background stats handler [MEDIUM]

**Files:** `background/service-worker.js:65-85`.

**Why:** Day-roll logic is subtle (UTC vs local, multi-day suspension, race with stat-message handler). Easy to break with a one-line edit.

**Risk:** Stats counter mysteriously resets mid-day, or never resets, depending on the regression.

### Storage shape compatibility / migrations [MEDIUM]

**What's not tested:** Loading settings that were written by an older version of the extension. There's no version field on stored settings; if the schema changes (e.g. `sites.tiktok_fyp` added), the existing fallbacks in `content/classifier.js:23` and `options/options.js:172` will silently substitute defaults — possibly hiding migration bugs.

**Risk:** Future upgrades silently lose user configuration.

### Overlay DOM / event handling [LOW]

**Files:** `applyBlur` in both content scripts.

**Why:** Visual regression tests for the overlay would be nice but are low-leverage compared to the items above. The overlay itself is simple and rarely changes.

---

## Severity-Tagged Issue Summary

| Severity | Concern | File(s) |
|----------|---------|---------|
| CRITICAL | Instagram structural heuristics + no tests | `content/instagram.js` |
| CRITICAL | No automated test coverage anywhere | repo-wide |
| HIGH | YouTube `ytd-*` selector dependency | `content/youtube.js:14-25` |
| HIGH | Classifier cache invalidation via window CustomEvent | `content/classifier.js:32-39`, host scripts |
| HIGH | Daily stats roll on multi-day SW suspension; UTC day boundary | `background/service-worker.js:36-70` |
| HIGH | MutationObserver on `document.body` + full-document `querySelectorAll` per scan | both content scripts |
| HIGH | No semantic classification tier — keyword-only is product floor | `content/classifier.js` |
| MEDIUM | "Show anyway" not sticky — UX-vs-spec mismatch | both content scripts; `README.md:100` |
| MEDIUM | Inline `innerHTML` for overlays — escape-by-convention | both content scripts |
| MEDIUM | No build pipeline / lint / format / typecheck | repo-wide |
| MEDIUM | Settings schema duplicated across 4 files | `service-worker.js`, `classifier.js`, `options.js`, host scripts |
| LOW | No icons in manifest (intentional v0.1) | `manifest.json` |
| LOW | Orion install path is non-trivial | `README.md:19-30` |
| LOW | Redundant `rollStatsDay` registration | `background/service-worker.js:62-63` |
| LOW | Duplicated `escapeHtml` / `applyBlur` between content scripts | both content scripts |
| LOW | Dead reset code in YouTube SPA-nav handler | `content/youtube.js:165-174` |
| LOW | No CSP declared in manifest | `manifest.json` |
| LOW | Polling intervals in popup/options not cleared on hide | `popup/popup.js:42`, `options/options.js:213` |
| LOW | `chrome.storage.sync` quota at extreme topic counts | `content/classifier.js`, `options/options.js` |

---

*Concerns audit: 2026-05-15*
