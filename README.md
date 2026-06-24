# SmartScroller

A browser extension that steers YouTube and Instagram away from low-value loops and toward topics you actually want. It can work as a strict focus filter or as a lighter recommendation coach.

Built as a standard Manifest V3 WebExtension, so it loads in **Orion**, **Chrome**, **Edge**, **Brave**, and **Firefox** (with minor manifest tweaks for Firefox).

## What it does

- **YouTube Shorts** (`youtube.com/shorts/*`) — blurs off-topic shorts, click to reveal.
- **YouTube homepage feed** — blurs off-topic video cards on the home page, search, and Up Next sidebar.
- **Instagram Reels** — blurs off-topic reels both in `/reels/` and when mixed into the main feed.
- **Topic editor** — define topics with a list of keywords/phrases each.
- **Avoid topics** — define channels, phrases, or categories that always get hidden first.
- **Feed steering mode** — Focus mode only shows learning topics; Coach mode only hides avoid topics.
- **YouTube nudges** — one-click "Not interested" on hidden YouTube recommendations when YouTube exposes the action.
- **Auto-steer (confirm-first)** — turn it on and every off-topic YouTube feed card is queued as a "Not interested" nudge; a floating bar sends them all in one tap, spaced out so it never looks like a bot. Nothing is sent until you confirm — it still never auto-watches.
- **Avoid channel** — add a YouTube channel or Instagram author to your local avoid list from the overlay.
- **Training queue** — saves matched YouTube recommendations locally so you can open the next useful video from the popup.
- **Learning search** — opens a YouTube search from your configured learning topics when the queue is empty.
- **Dopamine shield controls** — hard-hide off-topic cards and remove YouTube Shorts surfaces.
- **Per-site toggles** — turn off filtering on any of the three sites individually.
- **Anti-flash option** — blur cards while they are being classified.
- **Pause** — 15 min / 1 hour / custom, then auto-resume.
- **Stats** — see how many videos got blurred, allowed, tuned, and added to avoid today.

Off-topic items get a frosted-glass overlay with a small card showing the video title and quick actions: **Show**, **Avoid channel/author**, and on YouTube cards, **Not interested** when available. The "Show" choice is per-item, not sticky — next time it loads it'll be blurred again.

SmartScroller deliberately does **not** auto-watch videos to train your account. Fake watch sessions can pollute creator metrics, look bot-like, and teach the recommender the wrong lesson. The harder, safer loop is: hide bad candidates locally, remove Shorts surfaces, add recurring bad signals to your avoid list, optionally send YouTube's own "Not interested" feedback from the cards you choose (one at a time, or batched via **auto-steer** — still only after you confirm), and open useful queued videos or learning searches when you actually want to watch. "Not interested" / "Don't recommend channel" are the only feedback signals research finds actually move YouTube's recommendations, which is why the steering leans on them instead of synthetic watch time.

## Install in Orion

The verified path (2026-05-16) is **Install from File** via Orion iOS Extensions menu, fed a self-built zip. No Chrome Web Store account or Xcode required.

See **[docs/install-ios.md](docs/install-ios.md)** for the full checklist: zip-build command, AirDrop/iCloud transfer, Orion iOS install steps, smoke test, troubleshooting, and backup recipes.

> **Prerequisite on iPhone:** enable **Request Desktop Website** for `youtube.com` in Orion (tap "AA" in the address bar). Without it, YouTube Shorts selectors don't match the mobile DOM — only Instagram works. Phase 2 removes this requirement.

### Install in Chrome / Edge / Brave (works today)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `smartscroller/` directory.
4. The options page opens automatically on first install. Edit your topics there.

### Install in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json`.
3. Firefox MV3 doesn't accept the `service_worker` background field — for permanent install you'd swap to `background.scripts` or sign the extension.

## Configure feed steering

Click the SmartScroller toolbar icon → **Edit topics** (or open the options page directly from your browser's extensions list).

- **Learning topics** are what you want more of ("AI", "Cooking", "Boxing").
- **Avoid topics** are what you want less of ("Drama", "Gambling", "Shorts bait").
- **Keywords** can be single words (matched on word boundaries) or multi-word phrases (matched as substrings). Both are case-insensitive.
- **Hashtags** in video metadata are auto-normalized: `#MachineLearning` matches `machine learning`, `#ai_news` matches `ai news`, etc.
- Avoid topics always win. In **Focus** mode, a video is shown only when it matches a learning topic. In **Coach** mode, neutral videos are allowed through unless they match an avoid topic.
- Matched YouTube feed cards are saved into the popup's **Training queue**. Use **Open next** when you want to intentionally watch a useful recommendation.
- Enable **Hard hide off-topic cards** and **Hide YouTube Shorts surfaces** when blur is still too tempting.
- Enable **Auto-steer** (Feed steering section, or the popup quick toggle) to queue a "Not interested" nudge on every off-topic YouTube card. A bar appears at the bottom of the page showing how many are queued; tap **Send "Not interested" ×N** to fire them all, or use each card's button. Auto-steer keeps off-topic cards visible (overlay) even when hard-hide is on, so you can see what you're about to send.

Default seeded topic is "AI & Programming" — edit or replace it.

## How classification works

The matching tier is local and keyword-based with smart normalization:

1. Extract `{ title, author, description, hashtags }` from the rendered DOM.
2. Lowercase, strip punctuation, normalize whitespace.
3. Expand hashtags: `#aiNews` → `["ainews", "ai news"]`.
4. Check avoid topics first. If any avoid keyword matches → blur.
5. Check learning topics. If any learning keyword matches → allow.
6. If nothing matches, Focus mode blurs and Coach mode allows.

This catches the vast majority of cases with no model file, no network calls, and instant latency. It's deliberately permissive: when in doubt, the item shows.

## Test

Run the automated suite with:

```sh
node --test
```

The tests use Node's built-in test runner and mocked browser extension APIs, so there is no dependency install step. `npm test` also works if your Node install includes npm. The suite covers manifest wiring, classifier precedence, Focus vs Coach mode, hashtag matching, avoid-list updates, training-queue storage, shield defaults, and service-worker stats.

## Upgrade path: semantic classification

`content/classifier.js` is structured so a semantic tier slots in cleanly. To add embedding-based matching with [Transformers.js](https://huggingface.co/docs/transformers.js):

1. Bundle `Xenova/all-MiniLM-L6-v2` (~23MB quantized) into an `assets/` folder; reference it via `chrome.runtime.getURL`.
2. Add an offscreen document (`chrome.offscreen`) that hosts the model, since MV3 service workers don't run WebAssembly well.
3. In `classifier.js`, after the keyword pass yields no match, post `{ meta, topicEmbeddings }` to the offscreen doc and compute cosine similarity. Treat anything above ~0.55 as on-topic.

The keyword pass should stay as the first tier — it's free, instant, and catches obvious cases without burning compute.

## Files

```
smartscroller/
├── package.json
├── manifest.json
├── background/service-worker.js   # default settings, stats counter
├── content/
│   ├── classifier.js              # shared classification logic
│   ├── common.css                 # blur + banner styles
│   ├── youtube.js                 # Shorts + home feed
│   └── instagram.js               # Reels (feed + /reels/)
├── options/                       # topic editor
│   ├── options.html, .css, .js
├── popup/                         # toolbar popup
│   ├── popup.html, .css, .js
├── tests/extension.test.js         # mocked WebExtension tests
└── README.md
```

## Known gotchas

- **Instagram class names are hashed and change often.** The script uses structural heuristics (find `<video>`, walk up to the card), so it's resilient — but if Instagram ships a UI overhaul, the `findCard` walk may need tweaks.
- **YouTube hydrates content lazily.** New items get classified after they have a title — until then they're untouched. Scrolling fast may briefly show an un-blurred frame.
- **The "Show anyway" reveal is per-render.** If the same short scrolls back into view (or you navigate away and back), it'll blur again. That's intentional — easy to override, easy to dismiss again.
- **Per-frame iframes are not scanned** (`all_frames: false`) to keep things fast. If YouTube ever embeds Shorts in an iframe, we'd need to relax that.

## Roadmap

- [ ] Semantic similarity via Transformers.js (see upgrade path above)
- [ ] Per-topic toggles (turn off "Cooking" without deleting it)
- [ ] Hard-block mode (full interstitial instead of blur)
- [ ] Daily off-topic quota
- [ ] Feed health dashboard (top avoided channels, recurring bad phrases, tuning history)
- [ ] TikTok For You support
- [ ] Export / import topic lists

## License

MIT — do whatever you want with it.
