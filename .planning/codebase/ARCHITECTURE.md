<!-- refreshed: 2026-05-15 -->
# Architecture

**Analysis Date:** 2026-05-15

## System Overview

SmartScroller is a Manifest V3 WebExtension with four runtime contexts that
share no direct memory and communicate exclusively through `chrome.storage`
(reactive settings/stats) and `chrome.runtime.sendMessage` (one-way stat
increments). There is no bundler, no build step, and no module system —
every JS file is a self-invoking IIFE loaded directly by the browser.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER SURFACES (no business logic — just read/write chrome.storage)         │
├──────────────────────────────────────┬──────────────────────────────────────┤
│  Popup (toolbar dropdown)            │  Options page (full-tab settings)    │
│  `popup/popup.html` + `popup.js`     │  `options/options.html` +            │
│  - enable/disable                    │   `options.js`                       │
│  - pause 15m/1h/resume               │  - topic editor (name + keywords)    │
│  - shows today's blurred/allowed     │  - per-site toggles                  │
│  - opens options page                │  - pause controls + live stats       │
└──────────────┬───────────────────────┴───────────────────────┬──────────────┘
               │                                               │
               │  reads/writes                  reads/writes   │
               ▼                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    chrome.storage (the bus)                                  │
│  storage.sync  : enabled, topics[], sites{}, pauseUntil   (settings)         │
│  storage.local : stats { day, blurred, allowed }          (counters)         │
│  onChanged event fans out to every context that subscribed                   │
└──────────────▲────────────────────────────────────────────▲─────────────────┘
               │                                            │
               │  storage.onChanged                         │  storage.sync.get
               │  (cache invalidation)                      │
               │                                            │
┌──────────────┴─────────────────────────┐    ┌─────────────┴─────────────────┐
│  Background service worker             │    │  Content scripts (per tab)    │
│  `background/service-worker.js`        │    │                               │
│  - seeds DEFAULTS on onInstalled       │    │  YouTube tabs:                │
│  - rolls daily stats on onStartup      │    │   `content/classifier.js`     │
│  - listens for runtime msg 'ss:stat'   │◀───┤   `content/youtube.js`        │
│    and increments storage.local.stats  │    │                               │
│  - opens options on first install      │    │  Instagram tabs:              │
│                                        │    │   `content/classifier.js`    │
│  (ephemeral — MV3 wakes/sleeps it)     │    │   `content/instagram.js`     │
└────────────────────────────────────────┘    │                               │
                ▲                             │  classifier.js runs first,    │
                │ runtime.sendMessage         │  publishes globalThis.        │
                │ { type: 'ss:stat',          │  SmartScroller; host scripts  │
                │   kind: 'blurred'|'allowed'}│  consume it.                  │
                └─────────────────────────────┤                               │
                                              │  DOM: MutationObserver +      │
                                              │  250–300ms debounce + SPA     │
                                              │  URL poller (400ms)           │
                                              └───────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Service worker | Seed defaults, roll daily stats, aggregate counters from content scripts | `background/service-worker.js` |
| Classifier (shared) | Load+cache settings, normalize text, run keyword/phrase match, expose `globalThis.SmartScroller` | `content/classifier.js` |
| YouTube host script | Find Shorts + feed elements, extract title/channel/hashtags, apply blur overlay | `content/youtube.js` |
| Instagram host script | Find `<video>` cards via structural heuristics, extract caption/author, apply blur overlay | `content/instagram.js` |
| Blur styles | `.ss-blurred` filter + `.ss-overlay` card UI, scoped with `ss-` prefix | `content/common.css` |
| Options page | Edit topics, toggle sites, pause controls, read stats | `options/options.html`, `options/options.js`, `options/options.css` |
| Popup | Compact enable/pause/stats; entry to options | `popup/popup.html`, `popup/popup.js`, `popup/popup.css` |
| Manifest | Permissions, host matches, content script ordering, MV3 service worker registration | `manifest.json` |

## Pattern Overview

**Overall:** Event-driven, storage-as-bus, MV3 four-context model. There is
no central runtime — every context is independent and communicates through
`chrome.storage.{sync,local}` events plus a single `runtime.sendMessage`
channel for stat increments.

**Key Characteristics:**
- Zero build tooling. Plain ES2020 JS, IIFE-wrapped, loaded by `manifest.json`.
- Shared logic between content scripts is published on `globalThis` (no ESM,
  no `importScripts`) — `manifest.json` lists `classifier.js` *before* the
  host script so the global is defined by the time the host script runs.
- Settings are pull-with-cache + invalidate-on-change, not push.
- Stats are write-only from content scripts; aggregation happens in the SW.
- The UI surfaces (popup, options) are dumb views over `chrome.storage`.

## Layers

**Background (service worker):**
- Purpose: Lifecycle hooks, default seeding, stat aggregation.
- Location: `background/service-worker.js`
- Contains: `onInstalled` handler, `onStartup` handler, `onMessage` handler
  for `ss:stat`, the `DEFAULTS` and `LOCAL_DEFAULTS` constants.
- Depends on: `chrome.storage.sync`, `chrome.storage.local`, `chrome.runtime`.
- Used by: Content scripts (via `runtime.sendMessage`); browser lifecycle.

**Content (shared classifier):**
- Purpose: Single source of truth for "is this on-topic?".
- Location: `content/classifier.js`
- Contains: Settings cache, `loadSettings()`, `classify(meta)`, `siteEnabled(key)`,
  `reportStat(kind)`. Publishes `globalThis.SmartScroller`.
- Depends on: `chrome.storage.sync` (read), `chrome.storage.onChanged`,
  `chrome.runtime.sendMessage`.
- Used by: `content/youtube.js`, `content/instagram.js`.

**Content (per-site host scripts):**
- Purpose: DOM discovery, metadata extraction, blur overlay rendering.
- Location: `content/youtube.js`, `content/instagram.js`
- Contains: Selector lists, metadata extractors, `applyBlur(el, meta)`,
  `scan()`, `scheduleScan()` debouncer, `MutationObserver`, SPA URL poller,
  `ss:settings-changed` listener.
- Depends on: `globalThis.SmartScroller`, `content/common.css`.
- Used by: Browser content-script injection per `manifest.json` matches.

**UI (options + popup):**
- Purpose: User-facing controls over settings and live counters.
- Location: `options/`, `popup/`
- Contains: HTML markup, plain CSS, vanilla DOM JS. No frameworks.
- Depends on: `chrome.storage.sync` (read/write settings), `chrome.storage.local` (read stats).
- Used by: User clicks on toolbar icon (popup) or extension settings link (options).

## Data Flow

### Primary Request Path — Classify and Blur an Item

1. Page loads, browser injects `content/classifier.js` then host script
   (e.g. `content/youtube.js`) per `manifest.json:22-37`.
2. `classifier.js` IIFE runs, publishes `globalThis.SmartScroller`
   (`content/classifier.js:125`).
3. Host script captures `globalThis.SmartScroller` into local `SS`
   (`content/youtube.js:11`, `content/instagram.js:18`); bails if undefined.
4. Host script calls `scan()` once eagerly (`content/youtube.js:186`,
   `content/instagram.js:172`) and attaches `MutationObserver` to
   `document.body` with `{childList: true, subtree: true}` and a
   `setInterval` URL-change poller for SPA navigation.
5. For each candidate element, `process(el, kind)`:
   - Skips if `el.dataset.ssState` is already set.
   - Extracts `{title, author, description, hashtags}` from the DOM via
     selector probes (`extractShortMeta` / `extractFeedMeta` / `extractMeta`).
   - Returns early if metadata is empty — YouTube/Instagram hydrate lazily;
     the next mutation pass will retry.
   - Checks per-site toggles via `await SS.loadSettings()`.
   - Marks `el.dataset.ssState = 'checked'`, calls `await SS.classify(meta)`.
6. `SS.classify(meta)` (`content/classifier.js:73`):
   - Returns `{onTopic: true, reason: 'disabled'|'paused'|'no-topics'|'empty'}`
     for short-circuits.
   - Otherwise normalizes fields, joins into a single haystack, walks every
     `topic.keywords[]`, returns `{onTopic, hits, reason}`.
7. If `!result.onTopic`, host script calls `applyBlur(el, meta)`:
   - Adds class `ss-blurred`, sets `data-ss-state="blurred"`, ensures
     `position: relative`, appends an `.ss-overlay` card with title/author
     and a "Show anyway" button.
   - Click → sets `data-ss-state="revealed"`, removes overlay (CSS at
     `content/common.css:17-22` then unblurs media via attribute selector).
   - Fires `SS.reportStat('blurred')`.
8. `SS.reportStat(kind)` → `chrome.runtime.sendMessage({type:'ss:stat', kind})`.
9. Service worker `onMessage` handler (`background/service-worker.js:73-85`)
   wakes, reads `storage.local.stats`, increments the right counter, writes
   back. `return true` keeps the response channel open for the async write.

### Settings Change → Re-Classify Already-Rendered Items

1. User toggles a switch in options or popup. The page calls
   `chrome.storage.sync.set({...})` (`options/options.js:20-28`,
   `popup/popup.js:24`).
2. Browser fires `chrome.storage.onChanged` in every context where it's
   subscribed.
3. `classifier.js:32-39` handler:
   - Invalidates `cache = null; pending = null` so the next `loadSettings()`
     re-reads from storage.
   - Dispatches a `CustomEvent('ss:settings-changed')` on `window` (page
     world) so host scripts can rebuild blurs without re-loading the page.
4. Host script `ss:settings-changed` listener
   (`content/youtube.js:177-184`, `content/instagram.js:163-170`):
   - For every element with `[data-ss-state]`: remove `.ss-blurred`, remove
     the inline `.ss-overlay`, delete `data-ss-state`.
   - Calls `scheduleScan()` which triggers `scan()` after the debounce.
5. `scan()` finds all candidates again; since `data-ss-state` is gone,
   `process()` re-classifies and re-applies blur with the new settings.

### Daily Stats Roll

1. Service worker boots (`background/service-worker.js:62-63`): subscribes
   `onStartup` and also runs `rollStatsDay()` once immediately.
2. `rollStatsDay()` reads `storage.local.stats`; if `stats.day !== today()`,
   overwrites with a fresh `{ day, blurred: 0, allowed: 0 }`.
3. Options page `storage.onChanged` listener at `options/options.js:215-217`
   re-renders the stats line whenever `area === 'local' && changes.stats`.
4. Popup polls every 15s (`popup/popup.js:42`) by re-running `load()`.

**State Management:**
- Authoritative source = `chrome.storage`. No other store.
- Each runtime context keeps its own in-memory view:
  - `classifier.js` caches the parsed settings object behind `cache`/`pending`
    (`content/classifier.js:11-30`), invalidated on `storage.onChanged`.
  - `options.js` holds a `state` object (`options/options.js:7-12`),
    debounce-saves on edits at 250 ms.
  - `popup.js` is stateless — re-reads on load and on a 15s `setInterval`.
  - Service worker is intentionally stateless beyond what's in storage —
    MV3 may suspend it at any time.

## Key Abstractions

**`globalThis.SmartScroller` (the cross-script API):**
- Purpose: The only contract between `classifier.js` and the host scripts.
- Surface: `{ classify(meta), loadSettings(), siteEnabled(key), reportStat(kind) }`
  (`content/classifier.js:125`).
- Pattern: Module-on-global, established by load order in `manifest.json:25`
  and `manifest.json:32`. Host scripts guard with
  `const SS = globalThis.SmartScroller; if (!SS) return;`.

**`meta` envelope (the classifier input):**
- Shape: `{ title: string, author: string, description: string, hashtags: string[] }`
- Producers: `extractShortMeta` / `extractFeedMeta` (`content/youtube.js:37-79`),
  `extractMeta` (`content/instagram.js:64-74`).
- Consumer: `classify(meta)` (`content/classifier.js:73`).

**`data-ss-state` (per-element state machine):**
- Values: `undefined` (untouched) → `"checked"` (classified, on-topic) →
  `"blurred"` (off-topic with overlay) → `"revealed"` (user clicked Show anyway).
- Stored as a DOM `dataset` attribute so it survives in the host page DOM.
- Read every `scan()` to skip already-processed items.
- Cleared in bulk by the `ss:settings-changed` handler.

**`scheduleScan()` (debounced mutation handler):**
- Pattern: leading-edge guard via `if (scanTimer) return;` then 250 ms
  (YouTube) or 300 ms (Instagram) `setTimeout`. Coalesces bursts of mutations
  into a single `scan()`.

## Entry Points

**Service worker boot:**
- Location: `background/service-worker.js`
- Triggers: Browser starts, extension install/update, message wake.
- Responsibilities: `onInstalled` seeds DEFAULTS into `storage.sync` and
  LOCAL_DEFAULTS into `storage.local`; opens options page if everything was
  set fresh. `onStartup` and a top-level call both run `rollStatsDay()`.
  `onMessage` handles `ss:stat`.

**Content script injection (YouTube tab):**
- Location: `content/classifier.js` then `content/youtube.js`, with
  `content/common.css`, at `document_idle`, top frame only
  (`manifest.json:22-29`).
- Triggers: Any tab matching `*://*.youtube.com/*`.
- Responsibilities: Discover and classify Shorts + feed cards on this tab.

**Content script injection (Instagram tab):**
- Location: `content/classifier.js` then `content/instagram.js`, with
  `content/common.css` (`manifest.json:30-36`).
- Triggers: Any tab matching `*://*.instagram.com/*`.
- Responsibilities: Discover and classify Reels.

**Popup open:**
- Location: `popup/popup.html` (loads `popup.js`).
- Triggers: User clicks the toolbar icon (`manifest.json:15-18`).

**Options page open:**
- Location: `options/options.html` (loads `options.js`).
- Triggers: First install (`background/service-worker.js:57`), popup "Edit
  topics" button (`popup/popup.js:36-39`), or browser extensions UI link
  (`manifest.json:11-14`, `open_in_tab: true`).

## Architectural Constraints

- **Threading:** MV3 service worker is a single-threaded event-driven worker
  with no DOM, may be suspended any time the browser pleases. The
  `runtime.onMessage` handler at `background/service-worker.js:73-85`
  returns `true` to keep the async response channel open while it awaits
  the storage write. Content scripts run in the page's isolated world,
  one per matching tab.
- **Module system:** None. No bundler. Every JS file is loaded directly by
  the browser as a classic script (or as the MV3 SW module). Cross-script
  sharing between `classifier.js` and the host scripts is by
  `globalThis.SmartScroller`, which works because both run in the same
  isolated world per tab and `manifest.json` lists them in load order.
- **Global state:**
  - `globalThis.SmartScroller` in each content-script isolated world
    (`content/classifier.js:125`).
  - `cache` / `pending` module-locals in `classifier.js` (shared across
    every `classify()` call in the same tab).
  - The service worker has no global state that's safe to rely on across
    suspensions — everything important lives in `chrome.storage`.
- **Permissions:** Only `"storage"` (`manifest.json:6`). Host access is
  scoped to YouTube and Instagram only (`manifest.json:7-10`). No tab
  permission, no scripting permission, no network requests.
- **Iframes:** `all_frames: false` in both content script entries
  (`manifest.json:28`, `manifest.json:35`). Embedded iframes are not
  scanned by design.
- **Circular imports:** None possible — no imports.

## Anti-Patterns

### Putting classifier or DOM logic in the service worker

**What happens:** Service workers in MV3 have no DOM and can be suspended at
any time. Any state held in module scope is volatile across wakes.
**Why it's wrong:** Classification requires reading from the DOM (or at
least running synchronous string ops at high frequency); doing it in the SW
adds a round-trip and risks suspension mid-classify.
**Do this instead:** Keep classification in `content/classifier.js`
running in the tab. Use the SW only for cross-tab aggregation (stats), which
is what `background/service-worker.js:73-85` already does.

### Reading settings directly from `chrome.storage.sync` inside the hot path

**What happens:** Every blur decision triggers a storage read.
**Why it's wrong:** `storage.sync.get()` is async and not free; the
MutationObserver fires often, and YouTube can render dozens of items per
scroll burst.
**Do this instead:** Use the cached `loadSettings()` from `classifier.js`
(`content/classifier.js:14-30`). The cache is invalidated automatically by
the `storage.onChanged` handler at `content/classifier.js:32-39`.

### Adding new shared content-script logic via a fourth file

**What happens:** Author drops a new `content/foo.js`, references its helpers
from `youtube.js` / `instagram.js`.
**Why it's wrong:** Without a module system, every shared file must be
listed in `manifest.json` *before* the consumers and must publish to
`globalThis` itself. Forgetting either causes silent `undefined` failures
at page load.
**Do this instead:** Extend `globalThis.SmartScroller` in
`content/classifier.js`, or add the new file ahead of `classifier.js` in
`manifest.json` (`manifest.json:25`, `manifest.json:32`) and publish to
`globalThis` from inside its IIFE.

### Stickiness on "Show anyway"

**What happens:** Tempting to persist `data-ss-state="revealed"` per video
ID in storage.
**Why it's wrong:** Storage writes per click are expensive and create a
"silently allowed" list the user can't audit. The current design treats
reveal as per-render only — easy to override, easy to dismiss again
(documented in `README.md:99-100`).
**Do this instead:** Keep `data-ss-state` purely in DOM. If long-term reveal
is needed, add a per-topic "allow" UI instead of per-video memory.

### Mutating `el.style` instead of toggling a class for blur

**What happens:** Author sets `el.style.filter = 'blur(28px)'` directly.
**Why it's wrong:** YouTube/Instagram rewrite inline styles freely; the
filter is applied to the wrong target (the card, not its media); host CSS
specificity wins.
**Do this instead:** Add `ss-blurred` class and let `content/common.css`
target the *media descendants* with `!important`
(`content/common.css:7-15`). The overlay is a separate absolutely-positioned
child.

## Error Handling

**Strategy:** Best-effort, fail-open. Filtering is a UX nicety — if
anything throws or storage is unavailable, the user sees the unfiltered
feed (the safe default).

**Patterns:**
- `reportStat()` swallows errors silently because the extension context can
  be invalidated on tab unload (`content/classifier.js:117-123`).
- `extract*Meta()` functions return empty strings rather than throwing when
  selectors miss. `process()` then bails on empty metadata, leaving the item
  for a later mutation pass (lazy hydration tolerance:
  `content/youtube.js:123`, `content/instagram.js:117`).
- `classify()` short-circuits to `onTopic: true` for the disabled / paused /
  no-topics / empty-haystack cases (`content/classifier.js:77-99`), so the
  user always sees more, never less, when the extension is unsure.
- `ss-overlay` click handlers call `e.stopPropagation()` to avoid triggering
  YouTube/Instagram's own card click handlers
  (`content/youtube.js:108`, `content/instagram.js:103`).

## Cross-Cutting Concerns

**Logging:** None. No `console.log` left in production code. Debug by
adding ad-hoc logs in `classify()` or `process()`.

**Validation:** Minimal. `options.js` validates only that a keyword is
non-empty and not a duplicate before adding (`options/options.js:136-138`).
Topic schema is `{ id, name, keywords[] }` with `id` generated by `uid()`.

**Authentication:** N/A — no remote calls, no user accounts.

**Internationalization:** `normalize()` uses Unicode property escapes
(`\p{L}\p{N}`) for letter/number matching across scripts
(`content/classifier.js:46`); Instagram hashtag regex uses `[\wÀ-￿]+`
(`content/instagram.js:67`).

**CSS scoping:** All blur/overlay classes are prefixed `ss-` and applied to
host elements (`content/common.css`). Z-index uses `2147483600` to outrank
host overlays without colliding with maximum int.

**SPA navigation:** Both content scripts run a 400 ms `setInterval` URL
poller (`content/youtube.js:165-174`, `content/instagram.js:156-161`) on
top of the `MutationObserver` because YouTube/Instagram swap routes without
firing `popstate` reliably.

---

*Architecture analysis: 2026-05-15*
