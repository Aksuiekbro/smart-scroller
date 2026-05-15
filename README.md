# SmartScroller

A browser extension that blurs YouTube Shorts, Instagram Reels, and YouTube homepage videos that aren't in your allowed topics. The feed still works — but only on the stuff you actually want to learn from.

Built as a standard Manifest V3 WebExtension, so it loads in **Orion**, **Chrome**, **Edge**, **Brave**, and **Firefox** (with minor manifest tweaks for Firefox).

## What it does

- **YouTube Shorts** (`youtube.com/shorts/*`) — blurs off-topic shorts, click to reveal.
- **YouTube homepage feed** — blurs off-topic video cards on the home page, search, and Up Next sidebar.
- **Instagram Reels** — blurs off-topic reels both in `/reels/` and when mixed into the main feed.
- **Topic editor** — define topics with a list of keywords/phrases each.
- **Per-site toggles** — turn off filtering on any of the three sites individually.
- **Pause** — 15 min / 1 hour / custom, then auto-resume.
- **Stats** — see how many videos got blurred today.

Off-topic items get a frosted-glass overlay with a small card showing the video title and a **"Show anyway"** button. The "Show anyway" choice is per-item, not sticky — next time it loads it'll be blurred again.

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

## Configure topics

Click the SmartScroller toolbar icon → **Edit topics** (or open the options page directly from your browser's extensions list).

- **Topic name** is just a label for you ("AI", "Cooking", "Boxing").
- **Keywords** can be single words (matched on word boundaries) or multi-word phrases (matched as substrings). Both are case-insensitive.
- **Hashtags** in video metadata are auto-normalized: `#MachineLearning` matches `machine learning`, `#ai_news` matches `ai news`, etc.
- A video is shown if **any** keyword in **any** topic matches **any** of: title, channel/author, description, or hashtags.

Default seeded topic is "AI & Programming" — edit or replace it.

## How classification works

The matching tier is local and keyword-based with smart normalization:

1. Extract `{ title, author, description, hashtags }` from the rendered DOM.
2. Lowercase, strip punctuation, normalize whitespace.
3. Expand hashtags: `#aiNews` → `["ainews", "ai news"]`.
4. For each topic, check if any of its keywords match. Multi-word keywords match as substrings; single words match on word boundaries.
5. If at least one topic matches → on-topic. Otherwise → blur.

This catches the vast majority of cases with no model file, no network calls, and instant latency. It's deliberately permissive: when in doubt, the item shows.

## Upgrade path: semantic classification

`content/classifier.js` is structured so a semantic tier slots in cleanly. To add embedding-based matching with [Transformers.js](https://huggingface.co/docs/transformers.js):

1. Bundle `Xenova/all-MiniLM-L6-v2` (~23MB quantized) into an `assets/` folder; reference it via `chrome.runtime.getURL`.
2. Add an offscreen document (`chrome.offscreen`) that hosts the model, since MV3 service workers don't run WebAssembly well.
3. In `classifier.js`, after the keyword pass yields no match, post `{ meta, topicEmbeddings }` to the offscreen doc and compute cosine similarity. Treat anything above ~0.55 as on-topic.

The keyword pass should stay as the first tier — it's free, instant, and catches obvious cases without burning compute.

## Files

```
smartscroller/
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
- [ ] TikTok For You support
- [ ] Export / import topic lists

## License

MIT — do whatever you want with it.
