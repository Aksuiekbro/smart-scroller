# Coding Conventions

**Analysis Date:** 2026-05-15

These conventions are **de facto, not enforced** — there is no `.eslintrc`, no `.prettierrc`, no `tsconfig.json`, no formatter, and no pre-commit hook in this repo. The rules below were extracted by reading every JS/CSS/HTML file and identifying what is consistently true across all 13 files. New code should match these patterns by inspection.

## Naming Patterns

**Files:**
- All-lowercase, hyphen-free, single-word where possible: `youtube.js`, `instagram.js`, `classifier.js`, `service-worker.js`, `options.js`, `popup.js`, `common.css`.
- Hyphenated only when the name is multi-word and standardized by the platform: `service-worker.js` (matches MV3 vocab).
- HTML/CSS pair the JS basename: `options.html` / `options.css` / `options.js` in `options/`.

**Functions:**
- `camelCase` for all functions: `loadSettings`, `expandHashtag`, `escapeRegex`, `matchKeyword`, `applyBlur`, `findCard`, `extractMeta`, `scheduleScan`, `flashStatus`, `renderTopics`, `renderPauseState`, `rollStatsDay`.
- Short, verb-first when they do something: `scan`, `process`, `classify`, `save`, `load`, `render`.
- Helpers may be terse: `txt(el, selectors)` in `content/youtube.js:27`, `uid()` in `options/options.js:37`, `today()` in `background/service-worker.js:36`.

**Variables:**
- `camelCase` locals and module-level: `lastUrl`, `scanTimer`, `saveTimer`, `pauseUntil`, `seenCards`, `pending`, `cache`.
- `SCREAMING_SNAKE_CASE` for module-level config constants: `DEFAULTS`, `LOCAL_DEFAULTS`, `SHORT_SELECTORS`, `FEED_SELECTORS` (`background/service-worker.js:7-30`, `content/youtube.js:14-25`).
- `api` is the universal name for the extension API namespace (see "Browser API Polyfill" below).
- `SS` is the universal short alias for `globalThis.SmartScroller` inside content scripts (`content/youtube.js:11`, `content/instagram.js:18`).

**CSS classes — `ss-` prefix is mandatory:**
- Every class injected into host pages is prefixed `ss-` to avoid colliding with YouTube/Instagram CSS. Examples: `.ss-blurred`, `.ss-overlay`, `.ss-card`, `.ss-eyebrow`, `.ss-title`, `.ss-author`, `.ss-actions`, `.ss-btn`, `.ss-btn--ghost`, `.ss-overlay--small`, `.ss-reveal` (`content/common.css`).
- Variant modifiers use BEM-style double dash: `.ss-overlay--small`, `.ss-btn--ghost`.
- `data-*` attributes on host nodes are also prefixed: `data-ss-state` with values `"checked" | "blurred" | "revealed"` (`content/youtube.js:88,112,135`).
- Custom events are namespaced `ss:`: `ss:settings-changed`, `ss:stat` (`content/classifier.js:37,119`).
- File header comment is explicit about this: `content/common.css:1` — *"Scoped with .ss- prefix to avoid host CSS clashes."*

**Topic IDs:**
- Generated as `t_` + random base36 slug: `uid()` in `options/options.js:37` → `t_8x3kq2a`. The seeded default uses a human-readable slug instead: `id: "ai-programming"` (`background/service-worker.js:11`).

## Browser API Polyfill (mandatory at top of every JS file)

Every JS file that touches `chrome.*` / `browser.*` starts with this single line:

```js
const api = globalThis.browser ?? globalThis.chrome;
```

Occurrences:
- `background/service-worker.js:5`
- `content/classifier.js:9` (inside the IIFE)
- `options/options.js:3`
- `popup/popup.js:1`

Then **every** extension API call goes through `api`, not `chrome` or `browser` directly: `api.storage.sync.get(...)`, `api.runtime.onInstalled.addListener(...)`, `api.runtime.sendMessage(...)`, `api.runtime.openOptionsPage?.()`, `api.storage.onChanged.addListener(...)`.

Rationale (implicit, but visible in `README.md:5`): targets Chrome, Edge, Brave, Orion, **and** Firefox from one source. Firefox exposes `browser.*` as promises; Chrome/Chromium exposes both `chrome.*` and `browser.*` in MV3. Picking `browser` first means Firefox uses native promises and Chromium falls through to its compat layer.

Optional-chain any API method that may be missing in older runtimes: `api.runtime.openOptionsPage?.()` (`background/service-worker.js:57`, `popup/popup.js:37`).

## IIFE Module Pattern (content scripts only)

The two host-page scripts and the shared classifier are wrapped in an IIFE so nothing leaks to host-page globals:

```js
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  // ... locals ...
  globalThis.SmartScroller = { classify, loadSettings, siteEnabled, reportStat };
})();
```

Used in:
- `content/classifier.js:8-126` — exposes the public surface as `globalThis.SmartScroller` at the very end.
- `content/youtube.js:10-187` — reads `globalThis.SmartScroller`, no exports.
- `content/instagram.js:17-173` — same pattern.

**Convention:**
- Only `classifier.js` writes to `globalThis`. It writes exactly **one** symbol: `SmartScroller`.
- `youtube.js` and `instagram.js` read `globalThis.SmartScroller` into a local `const SS` and early-return if it's missing:

  ```js
  const SS = globalThis.SmartScroller;
  if (!SS) return;
  ```

  (`content/youtube.js:11-12`, `content/instagram.js:18-19`). This handles the case where `classifier.js` somehow didn't run.
- Manifest load order in `manifest.json:25,32` guarantees `classifier.js` runs first.

**Extension/options/popup scripts are NOT wrapped in IIFEs** — they're loaded into their own pages, so global pollution doesn't matter. They use module-level `const`/`let` directly.

## ESM-free Vanilla JS

- No `import` / `export` anywhere. No bundler, no transpiler.
- No npm dependencies. No `package.json`.
- Plain `<script src="...">` tags in `options/options.html:64` and `popup/popup.html:34`.
- Content scripts are concatenated by load order via `manifest.json`'s `content_scripts[].js` array — `classifier.js` before the site script.
- Any new file goes in by adding it to `manifest.json` (for content scripts/background) or with a `<script>` tag (for pages). **Do not** introduce a build step.

## jQuery-style `$` / `$$` Helpers (page scripts only)

The options and popup pages define short DOM helpers at the top of the file:

```js
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
```

- Full pair (both `$` and `$$`): `options/options.js:4-5`.
- Single `$` only (popup is smaller): `popup/popup.js:2` — `const $ = (s) => document.querySelector(s);`
- **Not used in content scripts** — they need `document.querySelectorAll(...).forEach(...)` directly to scan host DOM, and the IIFE pattern keeps `$` from leaking.

Convention: if a page script grows past ~20 DOM lookups, define `$` and `$$` at the top. Otherwise raw `document.querySelector` is fine.

## Storage Schema Conventions

Storage is split deliberately between `sync` and `local`:

**`api.storage.sync`** — user-editable settings, roams across browsers signed into the same account:
- `enabled: boolean` — master kill switch.
- `topics: Array<{ id: string, name: string, keywords: string[] }>` — user-defined topics.
- `sites: { youtube_shorts: boolean, youtube_home: boolean, instagram_reels: boolean }` — per-site toggles. Keys are `snake_case` and match the conceptual surface, not the manifest matches.
- `pauseUntil: number` — epoch ms; `0` means "not paused".

Defined in `background/service-worker.js:7-30`. Read consistently in `content/classifier.js:17-30`, `options/options.js:169`, `popup/popup.js:5`.

**`api.storage.local`** — device-only, high-write counters:
- `stats: { day: "YYYY-MM-DD", blurred: number, allowed: number }` — daily counter. Rolls over on date change (`background/service-worker.js:65-70`).

Why split: `storage.sync` has quotas and rate limits — stats would burn through them in minutes. Defined in `background/service-worker.js:32-34`.

**Read pattern — always defensive:**

```js
const d = await api.storage.sync.get(['enabled', 'topics', 'sites', 'pauseUntil']);
state.enabled = d.enabled !== false;                       // default true
state.topics = Array.isArray(d.topics) ? d.topics : [];    // default []
state.sites = d.sites || state.sites;                       // default object
state.pauseUntil = d.pauseUntil || 0;                       // default 0
```

(`options/options.js:168-174`). Every read has an explicit fallback. Treat missing keys, wrong types, and `undefined` as "use the default."

**Write pattern — batched, debounced (in editors):**
- Options page coalesces writes with a 250ms `scheduleSave` debouncer (`options/options.js:14-28`) so typing in a chip doesn't fire a write per keystroke.
- Single-action writes (toggle, pause button) write immediately (`popup/popup.js:24-34`).

**Reactive invalidation:**
- `api.storage.onChanged.addListener` is the single source of truth for "settings changed":
  - `content/classifier.js:32-39` — invalidates the in-memory `cache` and dispatches a `ss:settings-changed` window event so host scripts can re-evaluate.
  - `options/options.js:215-217` — listens for `local` changes to live-update the stats display.

## Error Handling — Minimalist

There is **no** error-reporting framework, no try/catch wrapper, no error boundary. The codebase handles only the failure modes that are known to occur in practice:

**One try/catch in the whole codebase:**

```js
function reportStat(kind) {
  try {
    api.runtime.sendMessage({ type: 'ss:stat', kind });
  } catch (_) {
    /* extension context may be gone on tab unload */
  }
}
```

(`content/classifier.js:117-123`). The comment explains *why* we swallow it: during tab unload the extension context is invalidated and `sendMessage` throws. There's nothing useful to do — the stat is best-effort.

**Optional chaining over try/catch:**
- `node?.textContent?.trim()` (`content/youtube.js:31`)
- `api.runtime.openOptionsPage?.()` (`background/service-worker.js:57`)
- `sendResponse?.({ ok: true, stats: s })` (`background/service-worker.js:81`)
- `local.stats?.blurred ?? 0` (`popup/popup.js:8`)
- `chips.querySelector('.chip-input')?.focus()` (`options/options.js:142`)

**Early returns over nesting:**

```js
async function process(el, kind) {
  if (el.dataset.ssState) return;
  const meta = kind === 'short' ? extractShortMeta(el) : extractFeedMeta(el);
  if (!meta.title && !meta.author) return;
  // ...
}
```

(`content/youtube.js:119-143`, mirrored in `content/instagram.js:114-129`). Guard clauses up top, happy path runs straight through.

**Sentinel returns from `classify`:**

Instead of throwing, `classify` always resolves to `{ onTopic, hits, reason }`. The `reason` enumerates *why* a non-classification decision was made: `'disabled' | 'paused' | 'no-topics' | 'empty' | 'matched' | 'no-match'` (`content/classifier.js:73-111`). Callers treat `onTopic: true` as "let it through" regardless of reason.

**No logging in production paths.** No `console.log`, `console.warn`, or `console.error` exists anywhere in the codebase. Adding one is a deliberate choice — content scripts run in the host page and noisy logs are user-visible.

## Comment Style — WHY First

The dominant comment style is *rationale*, not *paraphrase*. Comments explain why a decision was made, what the gotcha is, or what subtle invariant must hold. They almost never restate what the next line does.

**File-header comments describe the architecture and tradeoffs:**

`content/instagram.js:1-16` is the strongest example:

```js
// SmartScroller — Instagram content script
//
// Instagram's DOM is hostile: class names are hashed and change frequently, and
// Reels can render in three contexts:
//   1. /reels/<id>/ — single Reel view with vertical scroll between reels
//   2. /reels/ — Reels tab (grid of Reels under a profile or explore)
//   3. Reels mixed into the main feed (/) — as <article> blocks
//
// We use structural heuristics rather than class names:
//   - Look for elements containing a <video> AND a recognizable caption/header
//   - Walk up to a sensible "card" wrapper (closest article or role=presentation)
//   - Pull author from the nearest header link, caption from h1/h3/span containing #/@ or long text
//
// Worst case some non-Reel videos (Stories previews, IGTV) also get caught —
// that's acceptable; user can still click "Show anyway".
```

Compare with `content/youtube.js:1-8`, `content/classifier.js:1-6`, `background/service-worker.js:1-3`. Every entry-point file opens with a "what this is, why it's structured this way" block.

**Inline comments call out gotchas:**

- `content/youtube.js:122` — `// If we have no signal yet, leave it for the next pass — YouTube hydrates lazily.`
- `content/youtube.js:130` — `// Items inside the Shorts shelf on the home feed: treat as shorts toggle`
- `content/youtube.js:163` — `// SPA navigation: YouTube swaps content without a full reload`
- `content/youtube.js:168` — `// Reset state on URL change so re-rendered items get re-evaluated`
- `background/service-worker.js:55` — `// Open options page on first install so user can review topics`
- `background/service-worker.js:72` — `// Content scripts post stat increments here so we keep counters out of the hot path`
- `content/classifier.js:36` — `// Notify host scripts so they can re-evaluate already-rendered items`
- `content/classifier.js:50-51` — `// "MachineLearning" -> ["machinelearning", "machine learning"]` — examples are better than prose.

**Don't comment what the code obviously does.** There are no comments like `// loop through keywords` or `// set the class to blurred`. Code is named clearly enough not to need them.

## Function Design

**Size:** Functions are small. The longest is `topicCard()` in `options/options.js:76-160` at ~85 lines, and that's a self-contained DOM-builder for a complex form widget. Most are 5-20 lines. `classify()` is the longest in logic-heavy code at 38 lines (`content/classifier.js:73-111`).

**Parameters:**
- Positional, max 3 parameters in practice. When more configuration is needed, the last parameter is an options object with a default: `applyBlur(el, meta, hits, opts = {})` (`content/youtube.js:87`).
- Default destructuring is rare — destructuring happens inside the function body (`const { stats } = await api.storage.local.get('stats')`).

**Return values:**
- Pure helpers return strings, booleans, or arrays directly: `normalize`, `escapeHtml`, `expandHashtag`, `matchKeyword`.
- Decision-making functions return a tagged object: `{ onTopic, hits, reason }` from `classify` (`content/classifier.js:73-111`).
- Void DOM-mutating functions return nothing: `applyBlur`, `scan`, `process`, `renderTopics`.

**Async style:**
- `async`/`await` only — no `.then()` chains except one (`content/classifier.js:19,114` — the cache-promise idiom, where `.then` is genuinely simpler).
- Top-level `await` not used; `load()` is called fire-and-forget in popup (`popup/popup.js:41`) and inside `DOMContentLoaded` in options (`options/options.js:179`).

## Module Design

**No exports.** No file exports anything via `export` or `module.exports`. Sharing happens through:
1. `globalThis.SmartScroller` (only `content/classifier.js:125` writes it).
2. `globalThis.browser ?? globalThis.chrome` (the WebExtension API itself).
3. Custom DOM events (`ss:settings-changed`).
4. `api.runtime.sendMessage` for cross-context (content → background) RPC.

**No barrel files** — there are no `index.js` files at all. Each role (background, content, options, popup) is exactly the files it needs, listed explicitly in `manifest.json` or `<script>` tags.

**Cross-context messaging convention:**
- Messages are objects with a `type` field prefixed `ss:`: `{ type: 'ss:stat', kind: 'blurred' }` (`content/classifier.js:119`, `background/service-worker.js:74`).
- Handler in `background/service-worker.js:73` switches on `msg?.type` defensively and only handles known types. Always `return true` if you respond asynchronously.

## Import Organization

**Not applicable** — there is no `import` syntax anywhere in this codebase. Scripts are loaded in the order defined by `manifest.json` (for content scripts) or by `<script>` tag order in HTML pages. There are no path aliases.

## Code Style

**Formatting (observed, not enforced):**
- 2-space indentation throughout.
- Single quotes for JS string literals (`'ss:stat'`), double quotes for HTML attributes and JSON.
- Semicolons at end of statements.
- Trailing commas in multi-line array/object literals are *inconsistent* — some present (`background/service-worker.js:20`), some absent. Either is fine; match the surrounding block.
- Template literals only when interpolating: `` `Paused for ${mins} more minute...` `` (`options/options.js:55`). Simple strings use single quotes.
- One blank line between functions; no blank lines at the top of a function body.

**Linting:** No linter is configured. Match the surrounding code by inspection. If you ever add a linter, `eslint:recommended` plus the no-`var` rule would catch nothing in the current codebase (already clean).

## HTML Conventions

- `<!doctype html>` lowercase, no charset/lang surprises.
- `lang="en"` on `<html>` (`options/options.html:2`, `popup/popup.html:2`).
- `<meta charset="utf-8" />` and `<meta name="viewport" ...>` for the options page (`options/options.html:4-5`); popup omits viewport (it's a fixed-size popup).
- `<script>` tags go at the end of `<body>`, no `defer`/`async` needed since they're already at the end (`options/options.html:64`, `popup/popup.html:34`).
- `aria-live="polite"` for the status indicator (`options/options.html:16`) — minimal a11y attention where it matters (live regions, button labels). Form inputs in `topicCard()` rely on placeholders rather than `<label>` — acceptable for a settings panel but the one weakness in the a11y story.
- `data-*` attributes drive behavior: `data-site="youtube_shorts"`, `data-pause="15"`. Picked up in JS via `e.target.dataset.site` / `btn.dataset.pause` — no inline `onclick`.

## CSS Conventions

- Custom properties on `:root` for theming, with a `prefers-color-scheme: dark` block overriding them (`options/options.css:1-24`, `popup/popup.css:1-16`).
- `color-scheme: light dark;` declared so native form controls follow the theme.
- `font-family` chain starts with Apple system fonts: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif` — the project targets Orion (a macOS-first browser) but degrades gracefully.
- `* { box-sizing: border-box; }` reset.
- Class names in extension UI pages use generic single-word lowercase (`.card`, `.row`, `.chip`, `.btn`, `.switch`, `.slider`, `.hint`, `.topic`) because they're sandboxed inside the extension page — **no `ss-` prefix here**.
- The `ss-` prefix rule is *only* for `content/common.css`, which gets injected into host pages.
- Z-index for overlays uses `2147483600` (`content/common.css:30`) — just below the i32 max, since host pages may use very high z-indexes.

---

*Convention analysis: 2026-05-15*
