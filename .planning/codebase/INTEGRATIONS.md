# External Integrations

**Analysis Date:** 2026-05-15

SmartScroller has no traditional integrations — no REST/GraphQL APIs, no databases, no auth providers, no SaaS SDKs, no webhooks, no analytics, no CDN. The extension never makes a network request. Its "integrations" fall into two categories:

1. **WebExtension API surface** consumed via `globalThis.browser ?? globalThis.chrome` — the contract with the host browser.
2. **DOM contracts** with `youtube.com` and `instagram.com` — fragile, undocumented, page-structure dependencies that the content scripts rely on to identify and annotate videos.

Both are documented below with their stability characteristics.

## APIs & External Services

### WebExtension Runtime APIs (chrome.* / browser.*)

The extension is a pure consumer of host-browser APIs. Every script resolves the namespace as `globalThis.browser ?? globalThis.chrome` (`background/service-worker.js` line 5, `content/classifier.js` line 9, `options/options.js` line 3, `popup/popup.js` line 1) so the same code works under Chrome's callback-or-promise `chrome` namespace and Firefox/Orion's promise-only `browser` namespace.

**`chrome.storage` (permission declared: `manifest.json` line 6):**
- `chrome.storage.sync.get(...)` — read user settings (enabled flag, topics, per-site toggles, pauseUntil). Used in `content/classifier.js` lines 17–28, `options/options.js` line 169, `popup/popup.js` line 5, `background/service-worker.js` line 41.
- `chrome.storage.sync.set(...)` — persist settings. Used in `options/options.js` lines 21–26 and `popup/popup.js` lines 24, 31.
- `chrome.storage.local.get(...)` / `chrome.storage.local.set(...)` — daily stats counter (blurred/allowed). Used in `background/service-worker.js` lines 48, 53, 66, 68, 77, 80; read-only in `options/options.js` line 163 and `popup/popup.js` line 6.
- `chrome.storage.onChanged.addListener(...)` — invalidate the in-memory settings cache when sync changes (`content/classifier.js` lines 32–39) and refresh stats in the options page (`options/options.js` line 215).
- Stability: stable, fully cross-browser. `storage.sync` quota is ~100KB total (Chrome) — topic lists are tiny, well under the cap.

**`chrome.runtime`:**
- `chrome.runtime.onInstalled.addListener(...)` — seed defaults on first install (`background/service-worker.js` line 40).
- `chrome.runtime.onStartup.addListener(...)` — roll the stats day counter (`background/service-worker.js` line 62).
- `chrome.runtime.onMessage.addListener(...)` — receive `{ type: 'ss:stat', kind }` messages from content scripts (`background/service-worker.js` lines 73–85).
- `chrome.runtime.sendMessage(...)` — content scripts post stat increments (`content/classifier.js` line 119, wrapped in try/catch because the extension context may be gone on tab unload).
- `chrome.runtime.openOptionsPage?.()` — open the options page from the popup (`popup/popup.js` line 37) and after first install (`background/service-worker.js` line 57). The `?.` guard handles browsers that don't expose it.
- `chrome.runtime.getURL(...)` — popup fallback when `openOptionsPage` is unavailable (`popup/popup.js` line 38).
- Stability: stable, cross-browser. Note that the MV3 service worker is event-driven and can be terminated; the code already handles "context gone" failures gracefully.

**No other `chrome.*` namespaces are used.** Notably absent: `chrome.tabs`, `chrome.scripting`, `chrome.alarms`, `chrome.notifications`, `chrome.offscreen`, `chrome.webRequest`, `chrome.identity`, `chrome.permissions`. The extension stays inside the minimal `["storage"]` permission set declared in `manifest.json` line 6.

### DOM Web APIs (host page)

Content scripts use only standard DOM APIs available on every modern browser:
- `MutationObserver` — `content/youtube.js` line 160, `content/instagram.js` line 152. Observes `document.body` with `childList: true, subtree: true` for incremental scanning as SPA content hydrates.
- `document.querySelector` / `querySelectorAll` — selector-driven element discovery throughout both content scripts.
- `getComputedStyle` — used before injecting overlays to detect whether the host card is positioned (`content/youtube.js` line 92, `content/instagram.js` line 87). If `position: static`, the script sets `position: relative` to anchor the overlay.
- `Element.getBoundingClientRect` — used by Instagram's `findCard` heuristic (`content/instagram.js` line 31) to walk up to a wrapper of reasonable size.
- `CustomEvent` / `window.addEventListener` — internal pub/sub for settings invalidation, event name `ss:settings-changed` (`content/classifier.js` line 37; listeners in `content/youtube.js` line 177 and `content/instagram.js` line 163).
- `setInterval` for SPA URL-change polling — `content/youtube.js` line 165, `content/instagram.js` line 156, `popup/popup.js` line 42, `options/options.js` line 213.

## Data Storage

**Databases:**
- None. The extension is offline-first and serverless.

**Browser-managed storage:**
- `chrome.storage.sync` — user-editable settings, synced across the user's signed-in browser profile when the host browser supports it. Schema (seeded in `background/service-worker.js` lines 7–30):
  - `enabled: boolean`
  - `topics: Array<{ id: string, name: string, keywords: string[] }>`
  - `sites: { youtube_shorts: boolean, youtube_home: boolean, instagram_reels: boolean }`
  - `pauseUntil: number` (epoch ms)
- `chrome.storage.local` — device-local, not synced. Used only for the daily stats counter:
  - `stats: { day: "YYYY-MM-DD", blurred: number, allowed: number }`

**File Storage:**
- None. The extension reads no files at runtime (no `chrome.runtime.getURL` fetch of bundled assets beyond the `options/options.html` redirect in `popup/popup.js` line 38).

**Caching:**
- In-memory settings cache inside `content/classifier.js` (lines 11–13: `cache` and `pending`). Invalidated by `chrome.storage.onChanged` (lines 32–39). No persistent cache.

## Authentication & Identity

**Auth Provider:**
- None. No user accounts, no OAuth, no tokens, no JWTs. The extension has no identity concept beyond the implicit "current browser profile" of `chrome.storage.sync`.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, no Bugsnag, no Rollbar. The single `try/catch` in the codebase (`content/classifier.js` lines 118–122) swallows `sendMessage` failures silently with a comment about extension-context teardown.

**Logs:**
- None. No `console.log` / `console.error` calls in any source file. No log shipping. Stats are surfaced through the popup and options page UI only.

## CI/CD & Deployment

**Hosting:**
- None. The extension has no server-side component.

**CI Pipeline:**
- None. No `.github/workflows`, no `.gitlab-ci.yml`, no CircleCI/Travis/Jenkins config. Distribution is manual: zip the folder and upload to the relevant browser extension store (see `README.md` lines 19–44 for per-browser install instructions).

## Environment Configuration

**Required env vars:**
- None. The extension has no environment configuration. All runtime settings are user-editable via the options page (`options/options.html` + `options/options.js`).

**Secrets location:**
- N/A. No secrets, no API keys, no tokens. No `.env*` files exist in the repository.

## Webhooks & Callbacks

**Incoming:**
- None (no server).

**Outgoing:**
- None. The extension makes no `fetch`, no `XMLHttpRequest`, no `WebSocket`. Verified by absence of those identifiers across all source files. Listed only as internal event names:
  - `ss:settings-changed` — DOM `CustomEvent` dispatched on `window` (`content/classifier.js` line 37).
  - `ss:stat` — `chrome.runtime` message type (`content/classifier.js` line 119, handler in `background/service-worker.js` line 74).

---

## DOM Contract: youtube.com

**Stability characteristic: fragile but reasonably well-known.** YouTube uses semantic custom-element tags (`ytd-*`, `ytm-*`) that change less often than CSS class names but are still subject to silent renames during UI experiments. The script tolerates this by listing multiple candidate selectors per field and falling back to "leave the item alone if no signal" (`content/youtube.js` lines 122–123).

**Selectors consumed (`content/youtube.js`):**

*Shorts containers* (lines 14–18):
- `ytd-reel-video-renderer` — Shorts page individual reel
- `ytm-shorts-lockup-view-model` — newer Shorts lockup variant
- `ytd-shorts-lockup-view-model` — Shorts lockup variant

*Feed containers* (lines 20–25):
- `ytd-rich-item-renderer` — home page video card
- `ytd-video-renderer` — search result row
- `ytd-compact-video-renderer` — "Up Next" sidebar row
- `ytd-grid-video-renderer` — grid view on channel/playlist pages

*Shorts shelf detection* (line 130): `ytd-rich-shelf-renderer, ytd-reel-shelf-renderer` — used to apply the `youtube_shorts` toggle to shelved shorts on the home page.

*Title extraction selectors* (lines 38–43, 62–67):
- Short: `h2.title yt-formatted-string`, `h2.title`, `.ytReelMetapanelViewModelTitle`, `[id="title"]`
- Feed: `a#video-title-link`, `yt-formatted-string#video-title`, `a#video-title`, `#video-title`

*Channel extraction selectors* (lines 44–49, 68–73):
- Short: `ytd-channel-name a`, `.ytReelChannelBarViewModelChannelName`, `a.ytReelChannelBarViewModelChannelNameLink`, `#channel-name a`
- Feed: `ytd-channel-name#channel-name a`, `#channel-name a`, `#text-container a`, `ytd-channel-name a`

*Description selectors* (lines 50–54, line 74):
- Short: `#description`, `.ytReelMetapanelViewModelDescription`, `yt-formatted-string#description-text`
- Feed: `#description-text`, `#metadata-line`

*Hashtag extraction* (lines 55–57, 75–77): all anchors whose `href` contains `/hashtag/`.

*Thumbnail blur targets* (defined in `content/common.css` lines 7–12): `ytd-thumbnail`, `yt-image`, plus generic `[class*="thumbnail" i]` and `[class*="Thumbnail" i]` fallbacks for renamed components.

**Failure modes:**
- If YouTube renames any of the container tags, `scan()` (`content/youtube.js` lines 145–148) finds zero elements and silently no-ops — extension appears to do nothing. Recovery: add the new tag to `SHORT_SELECTORS` / `FEED_SELECTORS`.
- If only metadata selectors change, items render with an empty meta and are skipped per the hydration guard (lines 122–123), again silently. Recovery: add new selectors to the title/channel arrays.
- SPA navigation is detected by `setInterval` polling `location.href` every 400ms (lines 164–174) rather than `history.pushState` hooks or `chrome.webNavigation`.

## DOM Contract: instagram.com

**Stability characteristic: maximally hostile.** Instagram's class names are hashed and rotate frequently — the script explicitly avoids them. Documented in code comments (`content/instagram.js` lines 2–15) and in `README.md` line 98.

**Strategy: structural heuristics, not class names.**

*Card discovery* (`content/instagram.js` lines 21–37, `findCard`):
1. Start from any `<video>` on the page (the script treats every `<video>` as a potential reel — `scan()` lines 131–141).
2. Prefer `videoEl.closest('article')` — used for feed-mixed reels.
3. Fall back to `videoEl.closest('div[role="presentation"]')` — used on `/reels/`.
4. Final fallback: walk up the parent chain up to 8 hops, returning the first ancestor whose `getBoundingClientRect()` is ≥ 360px tall and ≥ 240px wide.

*Caption extraction* (lines 39–54, `extractCaption`): collects `h1`, `h3`, `div[role="button"] span`, and `span[dir="auto"]` candidates, picks the longest under 1200 chars (early-exits at 60 chars).

*Author extraction* (lines 56–62, `extractAuthor`): first `header a[role="link"]` or `a[role="link"][href^="/"]` whose href is not a post (`/p/`), reel (`/reel/`), or explore (`/explore/`) URL. Falls back to `href` slug if `textContent` is empty.

*Hashtag extraction* (line 67): regex `/#[\wÀ-￿]+/g` over the caption text.

**Three rendering contexts handled** (documented in lines 4–8):
1. `/reels/<id>/` — single-reel vertical scroll
2. `/reels/` — Reels tab grid
3. `/` — Reels mixed into the main feed as `<article>` blocks

**Failure modes:**
- If Instagram drops `<video>` elements (e.g., switches to canvas-based playback), `scan()` finds nothing and the extension silently no-ops.
- If the structural walk doesn't find a card of the minimum size (360×240), the script falls back to `videoEl.parentElement` (line 36) — likely too small to render a meaningful overlay but won't crash.
- Acknowledged false positives (lines 14–15): Stories previews and IGTV videos may also get blurred. Considered acceptable since users can click "Show anyway."
- No URL-change handling specific to Instagram beyond the same 400ms `location.href` poll as YouTube (lines 155–161).

---

*Integration audit: 2026-05-15*
