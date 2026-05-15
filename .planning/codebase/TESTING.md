# Testing Patterns

**Analysis Date:** 2026-05-15

## Current Posture: No Automated Tests

This codebase has **no test suite of any kind**. The honest picture:

- No test runner (no Jest, Vitest, Mocha, Playwright, web-ext, Karma, anything).
- No `*.test.js`, `*.spec.js`, or `__tests__/` directory anywhere in the repo.
- No CI — no `.github/workflows/`, no `.gitlab-ci.yml`, no `circle.yml`.
- No `package.json`, so there's not even a `"scripts"` block to add a test command to.
- No coverage tool, no coverage target.
- No linter (`.eslintrc`, `biome.json`, etc.) that could act as a static safety net.
- No type checker — vanilla JS, no TypeScript, no `tsconfig.json`, no JSDoc `@type` annotations.

What this means in practice: every change is validated by **manually loading the unpacked extension and exercising it against live YouTube and Instagram in a real browser**. This document describes that manual test surface and the gaps in it, so future contributors aren't guessing.

## Test Framework

**Runner:** None. No config file exists for any test runner.

**Assertion Library:** None.

**Run Commands:**

```bash
# There are no test commands. The "run tests" workflow is:
# 1. chrome://extensions → toggle Developer mode → Load unpacked → pick /Users/daurenzhunussov/smartscroller
# 2. Open youtube.com and instagram.com in real tabs and exercise the flows in "Manual Test Surface" below.
# 3. For Firefox: about:debugging#/runtime/this-firefox → Load Temporary Add-on → pick manifest.json
#    (Note: MV3 service_worker field is not accepted by Firefox without manifest edits — see README.md:43.)
```

## Test File Organization

**Not applicable.** There are no test files. If a test suite is added in the future, suggested conventions (to match the rest of the codebase) would be:

- Co-locate as `classifier.test.js` next to `content/classifier.js` for the only piece of code that's pure enough to unit test without a DOM.
- Use vanilla Node's built-in `node:test` to avoid introducing a dependency — the project deliberately has zero npm dependencies.
- DOM-dependent code (`content/youtube.js`, `content/instagram.js`, `options/options.js`, `popup/popup.js`) is currently only testable end-to-end against a real browser; jsdom can approximate but won't reproduce YouTube's hydration or Instagram's hashed class churn.

## Manual Test Surface

The matrix below is the de facto regression suite. Run all of it before shipping a change to a content script or to `classifier.js`.

### 1. Classifier logic (`content/classifier.js`)

This is the highest-leverage piece to test because both content scripts depend on it. Test by opening the **extension service worker console** (chrome://extensions → SmartScroller → "service worker" link → DevTools opens) and... actually you can't, the classifier runs in the content script context, not the worker. The practical test path:

1. Open YouTube in a tab.
2. Open DevTools on that tab → Console.
3. Run:
   ```js
   await SmartScroller.classify({ title: 'How transformers work', author: 'Three Blue One Brown', description: '', hashtags: [] });
   ```
4. Expect: `{ onTopic: true, hits: [{ topic: 'AI & Programming', keyword: 'transformer' }], reason: 'matched' }`.

**Cases to cover when changing classifier rules:**

| Case | Input | Expected |
|------|-------|----------|
| Single-word keyword, word boundary | `{ title: 'Why I quit AI research', ... }` with topic keyword `ai` | onTopic: true, reason: 'matched' |
| Single-word keyword, no false-positive on substring | `{ title: 'Maintainability', ... }` with topic keyword `ai` | onTopic: false (NOT matched on "**ai**ntainability") |
| Multi-word phrase, substring | `{ title: 'Intro to machine learning models', ... }` with keyword `machine learning` | onTopic: true |
| Hashtag camelCase split | `{ hashtags: ['#MachineLearning'] }` with keyword `machine learning` | onTopic: true |
| Hashtag underscore split | `{ hashtags: ['#ai_news'] }` with keyword `ai news` | onTopic: true |
| Empty haystack (no metadata yet) | `{ title: '', author: '', description: '', hashtags: [] }` | onTopic: true, reason: 'empty' |
| No topics defined | settings.topics = [] | onTopic: true, reason: 'no-topics' |
| Disabled | settings.enabled = false | onTopic: true, reason: 'disabled' |
| Paused | settings.pauseUntil > Date.now() | onTopic: true, reason: 'paused' |
| Case insensitivity | `{ title: 'CLAUDE released a new model' }` keyword `claude` | onTopic: true |
| Punctuation stripping | `{ title: 'GPT-4: a deep-dive!' }` keyword `gpt` | onTopic: true |
| Non-ASCII characters preserved by `\p{L}\p{N}` | `{ title: 'Énergie' }` | normalize keeps "énergie" |

**Where the logic lives:** `content/classifier.js:41-71` (`normalize`, `expandHashtag`, `escapeRegex`, `matchKeyword`). When tweaking any of those four functions, run the full matrix above.

**Settings cache invalidation:** After changing a topic in the options page, confirm `cache = null; pending = null;` runs (`content/classifier.js:32-39`) and the next `classify()` call re-reads from storage. The user-visible symptom is: edit a keyword, then scroll the YouTube feed; previously-blurred items should re-classify after the `ss:settings-changed` event fires.

### 2. YouTube content script (`content/youtube.js`)

**DOM contracts that matter** — these selectors are the contract with YouTube's rendered DOM. If YouTube changes any of them, blurring silently stops working for that surface:

**Shorts page (`youtube.com/shorts/*`):**
- Card selectors (`content/youtube.js:14-18`): `ytd-reel-video-renderer`, `ytm-shorts-lockup-view-model`, `ytd-shorts-lockup-view-model`.
- Title selectors (`content/youtube.js:38-43`): `h2.title yt-formatted-string`, `h2.title`, `.ytReelMetapanelViewModelTitle`, `[id="title"]`.
- Channel selectors (`content/youtube.js:44-49`): `ytd-channel-name a`, `.ytReelChannelBarViewModelChannelName`, `a.ytReelChannelBarViewModelChannelNameLink`, `#channel-name a`.
- Hashtag selector: `a[href*="/hashtag/"]` (`content/youtube.js:55`).

**Home feed / search / sidebar:**
- Card selectors (`content/youtube.js:20-25`): `ytd-rich-item-renderer`, `ytd-video-renderer`, `ytd-compact-video-renderer`, `ytd-grid-video-renderer`.
- Title selectors (`content/youtube.js:62-67`): `a#video-title-link`, `yt-formatted-string#video-title`, `a#video-title`, `#video-title`.
- Channel selectors (`content/youtube.js:68-73`): `ytd-channel-name#channel-name a`, `#channel-name a`, `#text-container a`, `ytd-channel-name a`.

**Manual smoke test (run after any YT-side change):**

1. **Home feed** — load `youtube.com`. Wait for hydration (~1s). Off-topic cards should get the blur + small overlay with title. On-topic cards should not.
2. **Shorts** — load `youtube.com/shorts/<any id>`. Scroll between shorts. Each off-topic short shows the full-size overlay. "Show anyway" reveals; next scroll back blurs again (per-render behavior is intentional — see `README.md:100`).
3. **Search results** — search any term and confirm `ytd-video-renderer` cards on the results page get processed.
4. **Sidebar / Up Next** — open a video; the sidebar uses `ytd-compact-video-renderer`. Off-topic items should blur there too.
5. **SPA navigation** — navigate home → shorts → home without reloading. The 400ms URL poll (`content/youtube.js:165-174`) should trigger a rescan. State must NOT leak: blurred cards on the previous view should not reappear unblurred on the new view (the polling resets state for new items via `data-ss-state` checks).
6. **Settings live-update** — open options in another tab, edit a topic keyword. Within ~1s the YouTube tab should re-classify everything visible. Driven by `ss:settings-changed` (`content/youtube.js:177-184`).
7. **Shorts shelf on home** — scroll to the "Shorts" shelf on the home page. Items inside `ytd-rich-shelf-renderer` / `ytd-reel-shelf-renderer` should respect the **shorts** toggle, not the home toggle (`content/youtube.js:129-133`).
8. **Per-site toggle** — turn off "YouTube homepage feed" in options; confirm home cards stop blurring but `/shorts/` still does.
9. **Pause** — click "Pause 15 min" in the popup. All blurs should remain on already-rendered items (they're cached as `data-ss-state="blurred"`), but new items load unblurred. After the pause expires (you can verify by setting `pauseUntil` to a past timestamp via DevTools storage panel), behavior resumes.

### 3. Instagram content script (`content/instagram.js`)

**DOM contracts that matter** — Instagram is the fragile one. `content/instagram.js:1-16` literally documents that the class names are hashed. The script avoids them entirely and relies on **structural heuristics**:

- `findCard(videoEl)` (`content/instagram.js:21-37`): walks up from a `<video>` looking for `<article>` → `div[role="presentation"]` → first ancestor at least 360×240px → fallback to parent. If Instagram changes this structure, blurring breaks on whichever surface (feed reels, `/reels/`, `/reels/<id>/`) is affected first.
- `extractCaption(card)` (`content/instagram.js:39-54`): scans `h1`, `h3`, `div[role="button"] span`, `span[dir="auto"]` and picks the longest text under 1200 chars.
- `extractAuthor(card)` (`content/instagram.js:56-62`): `header a[role="link"]`, falling back to any `a[role="link"][href^="/"]` that is not a `/p/`, `/reel/`, or `/explore/` link.
- Hashtag regex: `/#[\wÀ-￿]+/g` (`content/instagram.js:67`) — supports non-ASCII captions.

**Manual smoke test (run after any IG-side change or Instagram UI refresh):**

1. **Single Reel view** — open `instagram.com/reels/<id>/`. Off-topic reel should blur fully with overlay showing caption and `@author`. Scroll to the next reel — should re-process. "Show anyway" reveals only the current one.
2. **Main feed with reels mixed in** — open `instagram.com/` and scroll until reels appear inline as `<article>` blocks. Each should be processed independently. Non-reel videos (e.g. Stories preview rails) may also catch the filter — `content/instagram.js:15` calls this out as acceptable.
3. **Reels grid (`/reels/` or profile tabs)** — open a profile and click the Reels tab; each grid item is a card with a `<video>`. Confirm blurring applies. This is the surface most likely to break when IG ships UI overhauls because the cards don't have `<article>` wrappers.
4. **Caption-only filtering** — reels with no caption should remain visible (`onTopic: true, reason: 'empty'`) rather than blurring "(no caption)". Test by finding a reel with no caption — it should NOT blur.
5. **Settings live-update** — same as YouTube: edit options in another tab; instagram tab should re-evaluate.
6. **Author extraction** — confirm `@author` appears in the overlay. If extraction is broken, the overlay shows an empty `ss-author` div (still functional, just less informative).

### 4. Options page (`options/options.js`)

Manual smoke test:

1. Load the extension fresh. The options page should open automatically on install (`background/service-worker.js:55-58` — opens when *all* defaults were missing).
2. Enabled toggle should be on; default topic "AI & Programming" should be present with ~35 keywords.
3. Type a keyword in a chip input → press Enter. Chip appears, autosave fires within 250ms ("Saved" flash). Press Backspace twice on an empty input → last chip removed.
4. Add a new topic via "+ Add topic". The name input should auto-focus. Type a name, then add keywords. All autosave.
5. Toggle a per-site checkbox. Switch to a YouTube tab; behavior should change within ~1s (driven by `ss:settings-changed` round-trip).
6. Click "Pause 15 min" → `pauseState` shows "Paused for 15 more minutes". The 30s interval (`options/options.js:213`) keeps the countdown live.
7. Click "Remove" on a topic → topic disappears, autosave fires.
8. Stats line in the footer should match what the popup shows. Edit a topic to cause some YT blurs, return to options — stats should update via the `storage.onChanged` listener (`options/options.js:215-217`).

### 5. Popup (`popup/popup.js`)

Manual smoke test:

1. Click toolbar icon. Popup shows: enabled switch, blurred/allowed stat cards, pause state, pause buttons, "Edit topics →" link.
2. Toggle enabled — change should immediately propagate to active YT/IG tabs (via `storage.onChanged` → classifier cache bust → `ss:settings-changed` event).
3. Click "15m" → pause state updates immediately, the 15s interval (`popup/popup.js:42`) keeps it accurate while open.
4. "Edit topics" should open the options page in a new tab.

### 6. Background service worker (`background/service-worker.js`)

- **First-install behavior:** uninstall extension, reinstall. Options page should auto-open. All default keys present in `chrome.storage.sync`.
- **Already-installed re-install / update:** install over existing version. Defaults should NOT overwrite user settings (`background/service-worker.js:43-46` only sets keys that are `undefined`). Options page should NOT auto-open (`background/service-worker.js:56` — only opens when ALL defaults were missing).
- **Stats day rollover:** Set system clock past midnight (or hand-edit `stats.day` via DevTools storage panel to an earlier date). Reload an extension page. `rollStatsDay()` should reset counters (`background/service-worker.js:65-70`).
- **Stat message handling:** Manually run `chrome.runtime.sendMessage({ type: 'ss:stat', kind: 'blurred' })` from a content script context; the response should include `{ ok: true, stats: { ... } }` with incremented count. Service worker handler at `background/service-worker.js:73-85`.

## Debugging Recipes

### "A video isn't blurring"

Run this checklist in order, against a real failing case:

1. **Is the extension enabled and not paused?** Click the toolbar icon. Confirm switch is on and "Not paused". Common: paused from earlier session.
2. **Is the per-site toggle on for this surface?** Open options. Confirm the right checkbox (e.g. "YouTube Shorts", "YouTube homepage feed", "Instagram Reels") is checked. The script returns early in `process()` if its surface is disabled (`content/youtube.js:127-133`, `content/instagram.js:120`).
3. **Are there topics defined with at least one keyword?** Empty topics list → `classify()` returns `{ onTopic: true, reason: 'no-topics' }` (`content/classifier.js:83-85`).
4. **Does the card have a `data-ss-state` attribute yet?** In DevTools Elements panel, select the card. If no `data-ss-state`, the scan hasn't reached it yet — wait a beat or scroll to trigger `MutationObserver`. If `data-ss-state="checked"`, the classifier ran and decided it's on-topic.
5. **What does the classifier actually see?** In the DevTools console of the page:
   ```js
   // YouTube:
   const el = document.querySelector('ytd-rich-item-renderer');  // or the problematic card
   // copy the extract logic from content/youtube.js:61-79 inline, or:
   const meta = { title: el.querySelector('#video-title')?.textContent?.trim(), author: el.querySelector('#channel-name a')?.textContent?.trim() };
   await SmartScroller.classify(meta);
   ```
   If `reason: 'no-match'`, the keywords genuinely don't match — that's a topics problem, not a code problem. If `reason: 'empty'`, the metadata extraction failed — likely YouTube changed a selector. Update the selector list in `content/youtube.js:38-49` or `:62-73`.
6. **Did YouTube change a selector?** Inspect the card in Elements. The title is no longer in `a#video-title-link` etc.? Add the new selector to the list.
7. **For Instagram, did `findCard` walk to the wrong ancestor?** Add `console.log(card)` inside `process()` (`content/instagram.js:114`) and confirm you're getting the reel wrapper, not the entire page section.
8. **Is the `ss:settings-changed` event firing?** In the page console: `window.addEventListener('ss:settings-changed', () => console.log('settings changed'))`. Edit a topic in options. You should see the log within ~500ms. If not, `storage.onChanged` isn't reaching the classifier — uncommon but possible if the extension context was invalidated by a reload.
9. **Is the overlay actually mounted but invisible?** Search the card subtree for `.ss-overlay`. If it's there, the z-index (`2147483600` in `content/common.css:30`) may be losing to a host element — rare, but YouTube and Instagram both use very high z-indexes occasionally.
10. **Service worker died?** `chrome://extensions` → service worker status. MV3 workers can be terminated; the `chrome.runtime.sendMessage` from `reportStat` will throw and is swallowed (`content/classifier.js:117-123`). That's harmless for blurring (it only affects stats).

### "Settings aren't saving"

1. Confirm the options page shows "Saved" briefly after edits (`options/options.js:27`). If not, the `scheduleSave` debouncer might be cancelled by an error in `save()` — check the options page console.
2. Confirm `chrome.storage.sync.get(['topics'])` in the options page console returns the expected shape.
3. Storage sync has quotas (~100KB total, ~8KB per item). A pathological topics list could exceed it; `chrome.storage.sync.set` would throw an unhandled rejection visible in the options console.

### "Stats are wrong / not incrementing"

1. Open the popup; check `blurred today` / `on-topic`. These come from `chrome.storage.local.get('stats')` (`popup/popup.js:6`).
2. Open the service worker console (`chrome://extensions` → "service worker" link). Cause a blur on YouTube. You should see no logs (we don't log) but `chrome.storage.local.get('stats')` from the SW console should reflect the increment.
3. If date changed but counter didn't reset, `rollStatsDay` didn't fire — reload the extension or trigger `chrome.runtime.onStartup` (browser restart).

## Coverage

**Requirements:** None enforced. No coverage tool installed.

**View Coverage:** Not applicable.

## Test Types

**Unit Tests:** None.

**Integration Tests:** None.

**E2E Tests:** None automated. The entire test surface is manual against live YouTube and Instagram in a real browser. There is no Playwright / Puppeteer / WebDriver harness.

## Gaps and Risks (Honest Assessment)

Where the lack of tests bites hardest:

1. **Classifier correctness regressions are silent.** `normalize`, `matchKeyword`, and `expandHashtag` are pure functions with well-defined I/O. They're the lowest-hanging fruit for unit tests and the highest-value target — a regex bug in `escapeRegex` or `matchKeyword` could blur on-topic content or fail to blur off-topic content, and you'd only catch it by chance browsing. Suggested first test investment: ~30 lines of `node:test` covering the matrix in section 1 above.

2. **YouTube/Instagram DOM changes are caught only when a user notices.** Selector drift is the most likely production failure. There's no monitoring, no alerting, no fixture-based test. The only mitigation is the redundancy in the selector lists (`content/youtube.js:38-78`) — try multiple selectors per field — which works until *all* the candidates break at once.

3. **No CI means no enforcement of any future quality bar.** If you add a test, it can only be run by remembering to run it. Adding a `.github/workflows/test.yml` that runs `node --test` would be a 10-line investment with permanent payoff once any tests exist.

4. **No type safety.** Storage objects are read-defensively (`d.topics`, `d.enabled !== false`) but typos in `state.sites.youtube_shorts` vs `state.sites.youtube_short` would silently misbehave. TypeScript or even JSDoc `@typedef` annotations on the storage schema would catch this; current cost-of-introduction is high (no build) and benefit is moderate (codebase is tiny).

5. **No fuzz testing against real metadata.** A 5-minute investment scraping 100 real YouTube titles and running them through `classify` with the default topics would surface edge cases (emoji-heavy titles, non-Latin scripts, all-caps clickbait). Untested.

6. **No accessibility audit.** The options form has placeholder-only chip inputs (`options/options.js:131`) and no `<label for>` associations. Screen-reader behavior is untested.

7. **Cross-browser parity untested.** README claims Orion/Chrome/Edge/Brave/Firefox support, but only the developer's primary browser is exercised in practice. Firefox specifically needs manifest edits (`README.md:43`) that aren't applied in the committed `manifest.json`.

## Common Patterns (Reserved for Future Tests)

There aren't any to describe yet. If/when tests are added, the patterns to establish are:

- **Async testing:** classifier returns promises; use `await` directly in `node:test` async test functions.
- **Error testing:** `classify` doesn't throw — it returns `{ reason }`. Assert on `reason` rather than expecting exceptions.
- **DOM mocking:** If `content/youtube.js` is ever unit-tested, build minimal fixture DOMs as HTML strings and parse them with `JSDOM` (would be the *only* dev dependency, weighed against the project's no-deps stance).

---

*Testing analysis: 2026-05-15*
