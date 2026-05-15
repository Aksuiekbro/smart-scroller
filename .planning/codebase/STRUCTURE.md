# Codebase Structure

**Analysis Date:** 2026-05-15

## Directory Layout

```
smartscroller/
├── manifest.json                  # MV3 manifest — permissions, content scripts, popup/options/SW registration
├── README.md                      # User-facing install + topic-editor docs
├── background/
│   └── service-worker.js          # MV3 service worker — default seeding, stats aggregation
├── content/                       # Content scripts injected into YouTube + Instagram tabs
│   ├── classifier.js              # Shared keyword classifier, publishes globalThis.SmartScroller
│   ├── common.css                 # .ss-blurred / .ss-overlay styles (loaded by both sites)
│   ├── youtube.js                 # YouTube Shorts + home feed host script
│   └── instagram.js               # Instagram Reels host script
├── options/                       # Full-tab settings page (chrome-extension://…/options/options.html)
│   ├── options.html               # Markup: enable switch, site toggles, pause, topic editor
│   ├── options.js                 # State + render + debounced auto-save to storage.sync
│   └── options.css                # Layout + control styles for the options page
├── popup/                         # Toolbar dropdown (chrome-extension://…/popup/popup.html)
│   ├── popup.html                 # Compact UI: enable switch, stats, pause, link to options
│   ├── popup.js                   # Reads storage.sync + storage.local, polls every 15s
│   └── popup.css                  # Popup styles
└── .planning/                     # GSD planning artifacts (not part of the shipped extension)
    └── codebase/                  # Auto-generated codebase maps (this file, ARCHITECTURE.md, …)
```

## Directory Purposes

**`background/`:**
- Purpose: Houses the MV3 service worker referenced from `manifest.json:19-21`.
- Contains: A single JS file — the worker entry point. No imports, no other files.
- Key files: `background/service-worker.js` — lifecycle hooks + stats aggregator.
- Convention: Service worker code does not depend on the DOM and must
  tolerate being suspended/restarted at any moment.

**`content/`:**
- Purpose: Per-tab scripts and styles injected by the manifest into matching
  pages.
- Contains: Plain JS files (one shared, one per supported site) and one CSS
  file.
- Key files:
  - `content/classifier.js` — shared logic; always loaded first.
  - `content/youtube.js` — YouTube-specific DOM walking.
  - `content/instagram.js` — Instagram-specific DOM walking.
  - `content/common.css` — visual treatment (`.ss-blurred`, `.ss-overlay`).
- Convention: One JS file per supported site, plus exactly one shared
  classifier. The shared file must be listed before host scripts in
  `manifest.json` and must publish its API on `globalThis`.

**`options/`:**
- Purpose: The standalone settings page opened via `chrome.runtime.openOptionsPage()`
  or directly at `chrome-extension://…/options/options.html`.
- Contains: One HTML, one JS, one CSS file. No frameworks, no build.
- Key files: `options/options.html` (markup), `options/options.js` (logic),
  `options/options.css` (styles).
- Convention: Co-located trio — `<page>.html`, `<page>.js`, `<page>.css`.

**`popup/`:**
- Purpose: The toolbar button dropdown registered at `manifest.json:15-18`.
- Contains: One HTML, one JS, one CSS file.
- Key files: `popup/popup.html`, `popup/popup.js`, `popup/popup.css`.
- Convention: Same co-located trio as `options/`. Popup keeps no in-memory
  state across opens — it re-reads `chrome.storage` on every open and
  polls every 15s while open.

**`.planning/codebase/`:**
- Purpose: Codebase analysis docs produced by `/gsd:map-codebase` for use by
  later GSD commands.
- Contains: `ARCHITECTURE.md`, `STRUCTURE.md`, plus other map docs.
- Convention: UPPERCASE.md filenames; not part of the shipped extension.

## Key File Locations

**Entry Points:**
- `manifest.json` — declares everything else; the only file the browser
  reads first.
- `background/service-worker.js` — MV3 service worker entry (`manifest.json:20`).
- `content/classifier.js` + `content/youtube.js` — injected into YouTube tabs
  (`manifest.json:22-29`).
- `content/classifier.js` + `content/instagram.js` — injected into Instagram
  tabs (`manifest.json:30-36`).
- `popup/popup.html` — toolbar action (`manifest.json:15-18`).
- `options/options.html` — options page (`manifest.json:11-14`).

**Configuration:**
- `manifest.json` — single source of truth for permissions, host matches,
  script load order. No `.env`, no `tsconfig`, no bundler config.

**Core Logic:**
- `content/classifier.js` — `classify(meta)`, `loadSettings()`, settings
  cache + invalidation on `chrome.storage.onChanged`.
- `content/youtube.js` — selectors, metadata extraction, `applyBlur`,
  MutationObserver + debounce + SPA URL poller.
- `content/instagram.js` — `findCard` heuristic, caption/author extraction,
  same observer/poller pattern as YouTube.
- `background/service-worker.js` — `DEFAULTS` (settings) and
  `LOCAL_DEFAULTS` (stats), `rollStatsDay`, `ss:stat` message handler.

**Testing:**
- Not applicable — no test directory, no test runner, no CI config.
  Verification is manual via "Load unpacked" in the browser (see
  `README.md:32-44`).

## Naming Conventions

**Files:**
- All lowercase, hyphenated where needed: `service-worker.js`, `popup.html`.
- One file = one responsibility.
- Co-located triples for UI pages: `<page>.html`, `<page>.js`, `<page>.css`.

**Directories:**
- All lowercase, singular for "type of code" (`content/`, `popup/`,
  `options/`, `background/`). No deeper nesting.

**JS identifiers (in code):**
- `camelCase` for functions and locals (`extractShortMeta`, `scheduleScan`,
  `loadSettings`).
- `SCREAMING_SNAKE_CASE` for module-level constants (`DEFAULTS`,
  `LOCAL_DEFAULTS`, `SHORT_SELECTORS`, `FEED_SELECTORS`).
- `globalThis.SmartScroller` is the only `PascalCase` global (a deliberate
  "namespace" marker).

**CSS classes:**
- All prefixed `ss-` to avoid host CSS collisions (`ss-blurred`,
  `ss-overlay`, `ss-card`, `ss-eyebrow`, `ss-title`, `ss-author`,
  `ss-actions`, `ss-btn`, `ss-reveal`).
- BEM-ish modifiers: `ss-overlay--small` for thumbnail-sized variants
  (`content/common.css:111-120`).

**DOM data attributes (used as state):**
- `data-ss-state` on classified elements — values `"checked" | "blurred" | "revealed"`.
- `data-site` on options checkboxes — links to `state.sites[key]`
  (`options/options.html:41-43`, `options/options.js:43-47`).
- `data-pause` on pause buttons — minutes value
  (`options/options.html:31-33`, `popup/popup.html:26-28`).

**Message types:**
- Namespaced with `ss:` prefix — currently only `{type: 'ss:stat', kind: 'blurred'|'allowed'}`
  (`content/classifier.js:119`, `background/service-worker.js:74`).

**Custom DOM events:**
- Same `ss:` prefix — `'ss:settings-changed'`
  (`content/classifier.js:37`, `content/youtube.js:177`, `content/instagram.js:163`).

## Where to Add New Code

**Adding support for a new site (e.g. TikTok):**
- New host script: `content/tiktok.js` — copy the structure of
  `content/instagram.js` (IIFE, captures `globalThis.SmartScroller`,
  `findCard`/`extractMeta`/`applyBlur`/`scan`/`scheduleScan`/observer/URL
  poller/`ss:settings-changed` listener).
- Register in `manifest.json` under `content_scripts`: add a new entry with
  `matches: ["*://*.tiktok.com/*"]`, `js: ["content/classifier.js", "content/tiktok.js"]`,
  `css: ["content/common.css"]`, `run_at: "document_idle"`.
- Add a new site flag in `background/service-worker.js` `DEFAULTS.sites`
  (e.g. `tiktok_foryou: true`) and a new checkbox in `options/options.html`
  with `data-site="tiktok_foryou"`.
- Update `host_permissions` in `manifest.json:7-10`.
- No tests to add (none exist).

**Extending classification (e.g. semantic tier):**
- Primary code: `content/classifier.js` — add `classifySemantic(meta)` and
  call it as a second tier inside `classify()` after the keyword pass.
  See `README.md:68-76` for the documented upgrade plan.
- Bundle model assets under a new `assets/` directory and reference via
  `chrome.runtime.getURL`.
- If the model needs WASM, add a `chrome.offscreen` document under a new
  `offscreen/` directory and route messages through the service worker.

**New setting (e.g. hard-block mode):**
- Add to `DEFAULTS` in `background/service-worker.js:7-30`.
- Add field to `loadSettings()` return shape in `content/classifier.js:14-30`.
- Add a UI control in `options/options.html` + wiring in `options/options.js`.
- Optionally expose in `popup/popup.html` if it should be quickly toggled.
- Consume in `content/youtube.js` / `content/instagram.js` `applyBlur`
  branches.

**New UI surface (e.g. a stats history page):**
- Create `stats/stats.html`, `stats/stats.js`, `stats/stats.css`.
- Either register as a second `options_ui` (not allowed — only one), or link
  it from `popup/popup.html` / `options/options.html` and open with
  `window.open(chrome.runtime.getURL('stats/stats.html'))`.

**New utility shared across content scripts:**
- Add it to `content/classifier.js` and extend the `globalThis.SmartScroller`
  object at `content/classifier.js:125`.
- Do not introduce a new file in `content/` unless it justifies its own
  manifest entry — every extra content-script file is another `manifest.json`
  edit and another point of load-order coupling.

**Shared styles between content scripts:**
- Add to `content/common.css` with the `ss-` prefix.
- It's already loaded into both YouTube and Instagram pages
  (`manifest.json:26`, `manifest.json:33`).

## Special Directories

**`.planning/`:**
- Purpose: GSD agent scratch space (plans, codebase maps).
- Generated: Yes (by `/gsd:*` commands).
- Committed: Optional — repo-local convention; not loaded by the extension.
- Not referenced from `manifest.json`; not shipped to the store.

**`assets/` (does not yet exist):**
- Documented future location for bundled model files for the semantic tier
  (`README.md:71-72`). If added, would be referenced via
  `chrome.runtime.getURL('assets/…')` and would need to be `web_accessible`
  if loaded from a content script.

---

*Structure analysis: 2026-05-15*
