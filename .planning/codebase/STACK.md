# Technology Stack

**Analysis Date:** 2026-05-15

## Languages

**Primary:**
- JavaScript (ES2020+) — all logic. Uses optional chaining (`?.`), nullish coalescing (`??`), `globalThis`, async/await, template literals, and `Intl`-free `toISOString`. No transpilation step; the source is what the browser executes.
- HTML5 — `popup/popup.html` (popup UI) and `options/options.html` (options page).
- CSS3 — `content/common.css` (overlay styles, scoped with `.ss-` prefix), `popup/popup.css`, `options/options.css`. Uses `backdrop-filter`, `-webkit-line-clamp`, CSS custom keyframes.

**Secondary:**
- JSON — `manifest.json` (WebExtension Manifest V3 declaration).
- Markdown — `README.md` (install + architecture docs).

## Runtime

**Environment:**
- WebExtension runtime, Manifest V3. Executes in five host browsers:
  - Chrome / Chromium (target reference implementation)
  - Brave
  - Microsoft Edge
  - Orion by Kagi (Chrome- and Firefox-extension compatible)
  - Firefox (with the caveat noted in `README.md` lines 41–44: MV3 `service_worker` field needs swapping to `background.scripts` for permanent install)

**Execution contexts inside the extension:**
- Background service worker — `background/service-worker.js`. Event-driven; can be terminated by the browser between events.
- Content scripts — `content/classifier.js`, `content/youtube.js`, `content/instagram.js`. Injected at `document_idle` into `*://*.youtube.com/*` and `*://*.instagram.com/*` (see `manifest.json` lines 22–37).
- Popup page — `popup/popup.html` + `popup/popup.js`, opened from the toolbar icon.
- Options page — `options/options.html` + `options/options.js`, opened in a tab (`open_in_tab: true`, `manifest.json` line 13).

**Package Manager:**
- None. No `package.json`, no `package-lock.json`, no `node_modules`, no lockfile.

## Frameworks

**Core:**
- None. Plain DOM APIs throughout. No React/Vue/Svelte/jQuery/web-components framework. UI is built by manual `document.createElement` calls (`options/options.js` lines 76–160) and string templates with manual `escapeHtml` (`content/youtube.js` lines 81–85, `content/instagram.js` lines 76–80).

**Testing:**
- None. No test framework, no test runner, no test files, no test config.

**Build/Dev:**
- None. No bundler (no webpack/rollup/vite/esbuild/parcel), no transpiler (no Babel/TypeScript), no minifier. The repository contents are loaded verbatim as an unpacked extension.

## Key Dependencies

**Critical:**
- None (zero npm dependencies). All functionality relies on browser-native APIs.

**Infrastructure:**
- WebExtension API surface (`chrome.*` / `browser.*`) — accessed through `globalThis.browser ?? globalThis.chrome` in every script file (see `background/service-worker.js` line 5, `content/classifier.js` line 9, `options/options.js` line 3, `popup/popup.js` line 1). This dual-resolution pattern is the entire cross-browser compatibility layer.

## Configuration

**Environment:**
- No `.env` files, no environment variable usage, no runtime feature flags. Settings come from `chrome.storage.sync` (user-editable via the options page) and are seeded by defaults in `background/service-worker.js` lines 7–30.

**Build:**
- No build config files. No `tsconfig.json`, no `.eslintrc`, no `.prettierrc`, no `biome.json`, no `jest.config.*`, no `vitest.config.*`.
- Extension config lives entirely in `manifest.json`:
  - `manifest_version: 3`
  - `permissions: ["storage"]` (line 6) — only `chrome.storage` is requested
  - `host_permissions: ["*://*.youtube.com/*", "*://*.instagram.com/*"]` (lines 7–10)
  - `content_scripts[].run_at: "document_idle"` (lines 27, 35)
  - `content_scripts[].all_frames: false` (lines 28, 36) — top frame only
  - `options_ui.open_in_tab: true` (line 13)

## Platform Requirements

**Development:**
- Any text editor. No toolchain install required.
- A Chromium-based browser with `chrome://extensions` developer mode for "Load unpacked" (Chrome, Brave, Edge), or Firefox `about:debugging` for temporary load. Orion lacks a direct "load unpacked" UI; the README documents a zip / Chrome Web Store unlisted path (`README.md` lines 19–30).

**Production:**
- Distribution targets: Chrome Web Store, Firefox Add-ons (AMO), Edge Add-ons. The single unmodified codebase loads in Chromium browsers; Firefox requires the `service_worker` → `background.scripts` swap noted in the README.
- No server. No hosted backend. No deployment pipeline. All state lives in the user's browser via `chrome.storage.sync` and `chrome.storage.local`.

## Notable Stack Characteristics

- **Zero-toolchain.** 13 source files; what you read is what runs. No transform, no minification, no source maps needed.
- **No abstraction layer over `chrome.*`.** The `globalThis.browser ?? globalThis.chrome` idiom is repeated in every entry-point file rather than centralized.
- **Code reuse via global injection.** `content/classifier.js` registers `globalThis.SmartScroller` (see `content/classifier.js` line 125); `youtube.js` and `instagram.js` consume it via `globalThis.SmartScroller` (`content/youtube.js` line 11, `content/instagram.js` line 18). The script load order is enforced by `manifest.json` (classifier listed first in each content_scripts entry — lines 25 and 32).
- **No semantic dependencies bundled, but a documented upgrade path.** `README.md` lines 68–76 describes adding `@xenova/transformers` with an offscreen document — not currently in the stack.

---

*Stack analysis: 2026-05-15*
