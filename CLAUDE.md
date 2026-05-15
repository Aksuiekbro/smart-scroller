<!-- GSD:project-start source:PROJECT.md -->
## Project

**SmartScroller**

A personal browser extension that blurs YouTube Shorts, Instagram Reels, and YouTube homepage videos that don't match the topics you actually want to see. Built for one user (the author), running primarily on **iPhone Orion** (Kagi's iOS browser), with desktop Orion/Chrome as a secondary target.

Off-topic content gets a frosted-glass overlay with a small "Show anyway" reveal — the feed stays intact, but only useful content reaches the eyes.

**Core Value:** **You only see Shorts/Reels/videos that actually align with what you're trying to learn — without giving up the feed format itself.**

If everything else fails, this must work: a Short or Reel that is clearly off-topic must be blurred before the user finishes scrolling to it.

### Constraints

- **Platform**: iPhone Orion (iOS Safari Web Extension format) primary — Why: that's where the scrolling actually happens
- **Cost**: $0 ongoing, no API fees — Why: personal tool, not worth paying per Short classified
- **Privacy**: All processing on-device — Why: transcripts and viewing patterns shouldn't leave the phone
- **Bundle size**: Soft cap ~30MB (for the embedding model) — Why: iOS extensions are size-sensitive and download once
- **Dependencies**: Pure vanilla JS/CSS/HTML — no build step, no npm install, no node_modules — Why: keeps the extension installable from source and reduces moving parts; Transformers.js bundle will be the one exception
- **Distribution**: Single device, personal install — Why: no users to onboard, no compatibility matrix
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ES2020+) — all logic. Uses optional chaining (`?.`), nullish coalescing (`??`), `globalThis`, async/await, template literals, and `Intl`-free `toISOString`. No transpilation step; the source is what the browser executes.
- HTML5 — `popup/popup.html` (popup UI) and `options/options.html` (options page).
- CSS3 — `content/common.css` (overlay styles, scoped with `.ss-` prefix), `popup/popup.css`, `options/options.css`. Uses `backdrop-filter`, `-webkit-line-clamp`, CSS custom keyframes.
- JSON — `manifest.json` (WebExtension Manifest V3 declaration).
- Markdown — `README.md` (install + architecture docs).
## Runtime
- WebExtension runtime, Manifest V3. Executes in five host browsers:
- Background service worker — `background/service-worker.js`. Event-driven; can be terminated by the browser between events.
- Content scripts — `content/classifier.js`, `content/youtube.js`, `content/instagram.js`. Injected at `document_idle` into `*://*.youtube.com/*` and `*://*.instagram.com/*` (see `manifest.json` lines 22–37).
- Popup page — `popup/popup.html` + `popup/popup.js`, opened from the toolbar icon.
- Options page — `options/options.html` + `options/options.js`, opened in a tab (`open_in_tab: true`, `manifest.json` line 13).
- None. No `package.json`, no `package-lock.json`, no `node_modules`, no lockfile.
## Frameworks
- None. Plain DOM APIs throughout. No React/Vue/Svelte/jQuery/web-components framework. UI is built by manual `document.createElement` calls (`options/options.js` lines 76–160) and string templates with manual `escapeHtml` (`content/youtube.js` lines 81–85, `content/instagram.js` lines 76–80).
- None. No test framework, no test runner, no test files, no test config.
- None. No bundler (no webpack/rollup/vite/esbuild/parcel), no transpiler (no Babel/TypeScript), no minifier. The repository contents are loaded verbatim as an unpacked extension.
## Key Dependencies
- None (zero npm dependencies). All functionality relies on browser-native APIs.
- WebExtension API surface (`chrome.*` / `browser.*`) — accessed through `globalThis.browser ?? globalThis.chrome` in every script file (see `background/service-worker.js` line 5, `content/classifier.js` line 9, `options/options.js` line 3, `popup/popup.js` line 1). This dual-resolution pattern is the entire cross-browser compatibility layer.
## Configuration
- No `.env` files, no environment variable usage, no runtime feature flags. Settings come from `chrome.storage.sync` (user-editable via the options page) and are seeded by defaults in `background/service-worker.js` lines 7–30.
- No build config files. No `tsconfig.json`, no `.eslintrc`, no `.prettierrc`, no `biome.json`, no `jest.config.*`, no `vitest.config.*`.
- Extension config lives entirely in `manifest.json`:
## Platform Requirements
- Any text editor. No toolchain install required.
- A Chromium-based browser with `chrome://extensions` developer mode for "Load unpacked" (Chrome, Brave, Edge), or Firefox `about:debugging` for temporary load. Orion lacks a direct "load unpacked" UI; the README documents a zip / Chrome Web Store unlisted path (`README.md` lines 19–30).
- Distribution targets: Chrome Web Store, Firefox Add-ons (AMO), Edge Add-ons. The single unmodified codebase loads in Chromium browsers; Firefox requires the `service_worker` → `background.scripts` swap noted in the README.
- No server. No hosted backend. No deployment pipeline. All state lives in the user's browser via `chrome.storage.sync` and `chrome.storage.local`.
## Notable Stack Characteristics
- **Zero-toolchain.** 13 source files; what you read is what runs. No transform, no minification, no source maps needed.
- **No abstraction layer over `chrome.*`.** The `globalThis.browser ?? globalThis.chrome` idiom is repeated in every entry-point file rather than centralized.
- **Code reuse via global injection.** `content/classifier.js` registers `globalThis.SmartScroller` (see `content/classifier.js` line 125); `youtube.js` and `instagram.js` consume it via `globalThis.SmartScroller` (`content/youtube.js` line 11, `content/instagram.js` line 18). The script load order is enforced by `manifest.json` (classifier listed first in each content_scripts entry — lines 25 and 32).
- **No semantic dependencies bundled, but a documented upgrade path.** `README.md` lines 68–76 describes adding `@xenova/transformers` with an offscreen document — not currently in the stack.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- All-lowercase, hyphen-free, single-word where possible: `youtube.js`, `instagram.js`, `classifier.js`, `service-worker.js`, `options.js`, `popup.js`, `common.css`.
- Hyphenated only when the name is multi-word and standardized by the platform: `service-worker.js` (matches MV3 vocab).
- HTML/CSS pair the JS basename: `options.html` / `options.css` / `options.js` in `options/`.
- `camelCase` for all functions: `loadSettings`, `expandHashtag`, `escapeRegex`, `matchKeyword`, `applyBlur`, `findCard`, `extractMeta`, `scheduleScan`, `flashStatus`, `renderTopics`, `renderPauseState`, `rollStatsDay`.
- Short, verb-first when they do something: `scan`, `process`, `classify`, `save`, `load`, `render`.
- Helpers may be terse: `txt(el, selectors)` in `content/youtube.js:27`, `uid()` in `options/options.js:37`, `today()` in `background/service-worker.js:36`.
- `camelCase` locals and module-level: `lastUrl`, `scanTimer`, `saveTimer`, `pauseUntil`, `seenCards`, `pending`, `cache`.
- `SCREAMING_SNAKE_CASE` for module-level config constants: `DEFAULTS`, `LOCAL_DEFAULTS`, `SHORT_SELECTORS`, `FEED_SELECTORS` (`background/service-worker.js:7-30`, `content/youtube.js:14-25`).
- `api` is the universal name for the extension API namespace (see "Browser API Polyfill" below).
- `SS` is the universal short alias for `globalThis.SmartScroller` inside content scripts (`content/youtube.js:11`, `content/instagram.js:18`).
- Every class injected into host pages is prefixed `ss-` to avoid colliding with YouTube/Instagram CSS. Examples: `.ss-blurred`, `.ss-overlay`, `.ss-card`, `.ss-eyebrow`, `.ss-title`, `.ss-author`, `.ss-actions`, `.ss-btn`, `.ss-btn--ghost`, `.ss-overlay--small`, `.ss-reveal` (`content/common.css`).
- Variant modifiers use BEM-style double dash: `.ss-overlay--small`, `.ss-btn--ghost`.
- `data-*` attributes on host nodes are also prefixed: `data-ss-state` with values `"checked" | "blurred" | "revealed"` (`content/youtube.js:88,112,135`).
- Custom events are namespaced `ss:`: `ss:settings-changed`, `ss:stat` (`content/classifier.js:37,119`).
- File header comment is explicit about this: `content/common.css:1` — *"Scoped with .ss- prefix to avoid host CSS clashes."*
- Generated as `t_` + random base36 slug: `uid()` in `options/options.js:37` → `t_8x3kq2a`. The seeded default uses a human-readable slug instead: `id: "ai-programming"` (`background/service-worker.js:11`).
## Browser API Polyfill (mandatory at top of every JS file)
- `background/service-worker.js:5`
- `content/classifier.js:9` (inside the IIFE)
- `options/options.js:3`
- `popup/popup.js:1`
## IIFE Module Pattern (content scripts only)
- `content/classifier.js:8-126` — exposes the public surface as `globalThis.SmartScroller` at the very end.
- `content/youtube.js:10-187` — reads `globalThis.SmartScroller`, no exports.
- `content/instagram.js:17-173` — same pattern.
- Only `classifier.js` writes to `globalThis`. It writes exactly **one** symbol: `SmartScroller`.
- `youtube.js` and `instagram.js` read `globalThis.SmartScroller` into a local `const SS` and early-return if it's missing:
- Manifest load order in `manifest.json:25,32` guarantees `classifier.js` runs first.
## ESM-free Vanilla JS
- No `import` / `export` anywhere. No bundler, no transpiler.
- No npm dependencies. No `package.json`.
- Plain `<script src="...">` tags in `options/options.html:64` and `popup/popup.html:34`.
- Content scripts are concatenated by load order via `manifest.json`'s `content_scripts[].js` array — `classifier.js` before the site script.
- Any new file goes in by adding it to `manifest.json` (for content scripts/background) or with a `<script>` tag (for pages). **Do not** introduce a build step.
## jQuery-style `$` / `$$` Helpers (page scripts only)
- Full pair (both `$` and `$$`): `options/options.js:4-5`.
- Single `$` only (popup is smaller): `popup/popup.js:2` — `const $ = (s) => document.querySelector(s);`
- **Not used in content scripts** — they need `document.querySelectorAll(...).forEach(...)` directly to scan host DOM, and the IIFE pattern keeps `$` from leaking.
## Storage Schema Conventions
- `enabled: boolean` — master kill switch.
- `topics: Array<{ id: string, name: string, keywords: string[] }>` — user-defined topics.
- `sites: { youtube_shorts: boolean, youtube_home: boolean, instagram_reels: boolean }` — per-site toggles. Keys are `snake_case` and match the conceptual surface, not the manifest matches.
- `pauseUntil: number` — epoch ms; `0` means "not paused".
- `stats: { day: "YYYY-MM-DD", blurred: number, allowed: number }` — daily counter. Rolls over on date change (`background/service-worker.js:65-70`).
- Options page coalesces writes with a 250ms `scheduleSave` debouncer (`options/options.js:14-28`) so typing in a chip doesn't fire a write per keystroke.
- Single-action writes (toggle, pause button) write immediately (`popup/popup.js:24-34`).
- `api.storage.onChanged.addListener` is the single source of truth for "settings changed":
## Error Handling — Minimalist
- `node?.textContent?.trim()` (`content/youtube.js:31`)
- `api.runtime.openOptionsPage?.()` (`background/service-worker.js:57`)
- `sendResponse?.({ ok: true, stats: s })` (`background/service-worker.js:81`)
- `local.stats?.blurred ?? 0` (`popup/popup.js:8`)
- `chips.querySelector('.chip-input')?.focus()` (`options/options.js:142`)
## Comment Style — WHY First
- `content/youtube.js:122` — `// If we have no signal yet, leave it for the next pass — YouTube hydrates lazily.`
- `content/youtube.js:130` — `// Items inside the Shorts shelf on the home feed: treat as shorts toggle`
- `content/youtube.js:163` — `// SPA navigation: YouTube swaps content without a full reload`
- `content/youtube.js:168` — `// Reset state on URL change so re-rendered items get re-evaluated`
- `background/service-worker.js:55` — `// Open options page on first install so user can review topics`
- `background/service-worker.js:72` — `// Content scripts post stat increments here so we keep counters out of the hot path`
- `content/classifier.js:36` — `// Notify host scripts so they can re-evaluate already-rendered items`
- `content/classifier.js:50-51` — `// "MachineLearning" -> ["machinelearning", "machine learning"]` — examples are better than prose.
## Function Design
- Positional, max 3 parameters in practice. When more configuration is needed, the last parameter is an options object with a default: `applyBlur(el, meta, hits, opts = {})` (`content/youtube.js:87`).
- Default destructuring is rare — destructuring happens inside the function body (`const { stats } = await api.storage.local.get('stats')`).
- Pure helpers return strings, booleans, or arrays directly: `normalize`, `escapeHtml`, `expandHashtag`, `matchKeyword`.
- Decision-making functions return a tagged object: `{ onTopic, hits, reason }` from `classify` (`content/classifier.js:73-111`).
- Void DOM-mutating functions return nothing: `applyBlur`, `scan`, `process`, `renderTopics`.
- `async`/`await` only — no `.then()` chains except one (`content/classifier.js:19,114` — the cache-promise idiom, where `.then` is genuinely simpler).
- Top-level `await` not used; `load()` is called fire-and-forget in popup (`popup/popup.js:41`) and inside `DOMContentLoaded` in options (`options/options.js:179`).
## Module Design
- Messages are objects with a `type` field prefixed `ss:`: `{ type: 'ss:stat', kind: 'blurred' }` (`content/classifier.js:119`, `background/service-worker.js:74`).
- Handler in `background/service-worker.js:73` switches on `msg?.type` defensively and only handles known types. Always `return true` if you respond asynchronously.
## Import Organization
## Code Style
- 2-space indentation throughout.
- Single quotes for JS string literals (`'ss:stat'`), double quotes for HTML attributes and JSON.
- Semicolons at end of statements.
- Trailing commas in multi-line array/object literals are *inconsistent* — some present (`background/service-worker.js:20`), some absent. Either is fine; match the surrounding block.
- Template literals only when interpolating: `` `Paused for ${mins} more minute...` `` (`options/options.js:55`). Simple strings use single quotes.
- One blank line between functions; no blank lines at the top of a function body.
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
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- Zero build tooling. Plain ES2020 JS, IIFE-wrapped, loaded by `manifest.json`.
- Shared logic between content scripts is published on `globalThis` (no ESM,
- Settings are pull-with-cache + invalidate-on-change, not push.
- Stats are write-only from content scripts; aggregation happens in the SW.
- The UI surfaces (popup, options) are dumb views over `chrome.storage`.
## Layers
- Purpose: Lifecycle hooks, default seeding, stat aggregation.
- Location: `background/service-worker.js`
- Contains: `onInstalled` handler, `onStartup` handler, `onMessage` handler
- Depends on: `chrome.storage.sync`, `chrome.storage.local`, `chrome.runtime`.
- Used by: Content scripts (via `runtime.sendMessage`); browser lifecycle.
- Purpose: Single source of truth for "is this on-topic?".
- Location: `content/classifier.js`
- Contains: Settings cache, `loadSettings()`, `classify(meta)`, `siteEnabled(key)`,
- Depends on: `chrome.storage.sync` (read), `chrome.storage.onChanged`,
- Used by: `content/youtube.js`, `content/instagram.js`.
- Purpose: DOM discovery, metadata extraction, blur overlay rendering.
- Location: `content/youtube.js`, `content/instagram.js`
- Contains: Selector lists, metadata extractors, `applyBlur(el, meta)`,
- Depends on: `globalThis.SmartScroller`, `content/common.css`.
- Used by: Browser content-script injection per `manifest.json` matches.
- Purpose: User-facing controls over settings and live counters.
- Location: `options/`, `popup/`
- Contains: HTML markup, plain CSS, vanilla DOM JS. No frameworks.
- Depends on: `chrome.storage.sync` (read/write settings), `chrome.storage.local` (read stats).
- Used by: User clicks on toolbar icon (popup) or extension settings link (options).
## Data Flow
### Primary Request Path — Classify and Blur an Item
### Settings Change → Re-Classify Already-Rendered Items
### Daily Stats Roll
- Authoritative source = `chrome.storage`. No other store.
- Each runtime context keeps its own in-memory view:
## Key Abstractions
- Purpose: The only contract between `classifier.js` and the host scripts.
- Surface: `{ classify(meta), loadSettings(), siteEnabled(key), reportStat(kind) }`
- Pattern: Module-on-global, established by load order in `manifest.json:25`
- Shape: `{ title: string, author: string, description: string, hashtags: string[] }`
- Producers: `extractShortMeta` / `extractFeedMeta` (`content/youtube.js:37-79`),
- Consumer: `classify(meta)` (`content/classifier.js:73`).
- Values: `undefined` (untouched) → `"checked"` (classified, on-topic) →
- Stored as a DOM `dataset` attribute so it survives in the host page DOM.
- Read every `scan()` to skip already-processed items.
- Cleared in bulk by the `ss:settings-changed` handler.
- Pattern: leading-edge guard via `if (scanTimer) return;` then 250 ms
## Entry Points
- Location: `background/service-worker.js`
- Triggers: Browser starts, extension install/update, message wake.
- Responsibilities: `onInstalled` seeds DEFAULTS into `storage.sync` and
- Location: `content/classifier.js` then `content/youtube.js`, with
- Triggers: Any tab matching `*://*.youtube.com/*`.
- Responsibilities: Discover and classify Shorts + feed cards on this tab.
- Location: `content/classifier.js` then `content/instagram.js`, with
- Triggers: Any tab matching `*://*.instagram.com/*`.
- Responsibilities: Discover and classify Reels.
- Location: `popup/popup.html` (loads `popup.js`).
- Triggers: User clicks the toolbar icon (`manifest.json:15-18`).
- Location: `options/options.html` (loads `options.js`).
- Triggers: First install (`background/service-worker.js:57`), popup "Edit
## Architectural Constraints
- **Threading:** MV3 service worker is a single-threaded event-driven worker
- **Module system:** None. No bundler. Every JS file is loaded directly by
- **Global state:**
- **Permissions:** Only `"storage"` (`manifest.json:6`). Host access is
- **Iframes:** `all_frames: false` in both content script entries
- **Circular imports:** None possible — no imports.
## Anti-Patterns
### Putting classifier or DOM logic in the service worker
### Reading settings directly from `chrome.storage.sync` inside the hot path
### Adding new shared content-script logic via a fourth file
### Stickiness on "Show anyway"
### Mutating `el.style` instead of toggling a class for blur
## Error Handling
- `reportStat()` swallows errors silently because the extension context can
- `extract*Meta()` functions return empty strings rather than throwing when
- `classify()` short-circuits to `onTopic: true` for the disabled / paused /
- `ss-overlay` click handlers call `e.stopPropagation()` to avoid triggering
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
