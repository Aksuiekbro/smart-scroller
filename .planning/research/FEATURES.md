# Feature Research

**Domain:** Personal short-form video topic-filter (browser extension, single user, iPhone-primary)
**Researched:** 2026-05-15
**Confidence:** HIGH (domain is narrow and the user is the author — most "features" are unambiguously scope-creep)

## Framing

This is **NOT a product**. It is a tool one developer is building for themselves to run on
their own phone. Every feature decision here is filtered through:

1. Does this make the tool stick in **daily** use, or is it polish nobody (= one person) needs?
2. Could the author live without it for 30 days and not notice? If yes → cut.
3. Would removing it cause the tool to silently fail (filter doesn't fire, or fires wrong and
   user has no recourse)? If yes → table stakes.

The Core Value from `PROJECT.md` is the only thing that must work: *"a Short or Reel that is
clearly off-topic must be blurred before the user finishes scrolling to it."* Everything in
this document is graded against that single sentence.

## Existing Tools: What We Learn (and Why None of Them Solve This)

| Tool | What It Does Well | What It Misses (for our case) |
|------|-------------------|------------------------------|
| **Unhook** | Toggle-based: hide shorts, recs, comments, end screens; works on `m.youtube.com` via Firefox Android | Binary — either ALL shorts hidden or all visible. No topic awareness. No Instagram. |
| **DF Tube** | Hides shorts tab, recommendations grid, autoplay; pure CSS so it's bulletproof | Same binary model. Hides categories of UI, not individual videos by content. |
| **BlockTube** | Block channels, videos, keywords; regex; custom JS hooks; the most "power-user" option | Manual blocklist — you have to know who to block. No semantic understanding. No transcript reading. Reviews mention frequent post-update breakage. |
| **UnDistracted** | Multi-platform (YT, IG, FB, X, LinkedIn) hide-feed toggles; per-site config | Hides whole feeds rather than filtering items. Cloud sync via Google account — not desired here. |
| **IGPlus / Antigram** | Instagram-specific hide-reels controls | Hide-everything UX. No topic filter. No "show me reels about X." |
| **Intention / Intentional** | "Why are you here?" prompts; time-quota model | Friction model, not content model. Doesn't address "I want shorts, just *useful* shorts." |
| **Cold Turkey** | Blunt-instrument site/app blocker on desktop OS | All-or-nothing. Wrong layer (OS) for our problem. No mobile. |

**The gap:** Every existing tool answers "show or hide this **surface**" (the shorts tab, the
reels carousel, the homepage feed). None answer "show or hide this **individual item** based
on its content." That gap is exactly what v0.1 of SmartScroller already addresses (keyword
match) and what this milestone is upgrading (transcript + semantic embeddings).

**The takeaway for our feature scope:**

1. Don't try to compete with Unhook/DF Tube on hiding entire UI surfaces — they win, and
   it isn't the problem.
2. Single-item topic classification is the actual differentiator. Defend it ruthlessly.
3. BlockTube's biggest user complaint is **breakage after platform updates**. That is going
   to happen to us too. Plan for resilience (fail-open, easy override) over polish.

## Feature Landscape

### Table Stakes (Tool Fails Without These)

If any of these are missing, the tool is a science project, not a daily-use thing.

| Feature | Why Essential | Complexity | v0.1? | Notes |
|---------|---------------|------------|-------|-------|
| **Runs on iPhone Orion** | Primary platform. Desktop is secondary. If it doesn't run where the scrolling happens, the tool is dead. | HIGH | NO | Safari Web Extension wrapper via Xcode + sideload. Hard step, but the whole project is moot without it. |
| **Topic editor (add/edit/delete keywords + topic names)** | The single user's interests change. No editor = tool calcifies. | LOW | YES | Already in `options/options.js`; just keep it. |
| **Blur overlay with "Show anyway"** | Reversibility. Without it, false positives become traps and user disables the extension. | LOW | YES | Per-render (non-sticky) is an intentional choice in `PROJECT.md` — keep that property. |
| **Transcript-based semantic classification (YouTube)** | The actual upgrade. Title+hashtag matching misses the long tail. Transcript reveals content. | HIGH | NO | YouTube `ytInitialPlayerResponse.captions` + Transformers.js MiniLM + cosine similarity. |
| **Tiered classifier (keyword → embeddings only on miss)** | iPhone CPU + battery budget cannot afford embeddings on every Short. | MEDIUM | NO | Already specced in PROJECT.md Active. Keep it cheap and lazy. |
| **Result cache by video ID** | A Short re-appearing in the feed must not be re-classified. iPhone bandwidth + battery. | LOW | NO | LRU cap, `chrome.storage.local`. ~few KB per 1000 entries. |
| **Per-site toggle (YT on, IG on/off)** | Some days only Reels is the problem. Author needs to scope quickly. | LOW | YES | In v0.1 popup + options. Keep. |
| **Pause control (15m / 1h / custom / resume)** | Necessary escape valve. Without it, "I'll just turn off the extension" → 4 hours later it's still off. | LOW | YES | Already in v0.1. Keep. |
| **Fail-open on errors** | If anything throws, user sees unfiltered feed. Better than a broken page or false-blocking everything. | LOW | YES | Already the explicit strategy in `ARCHITECTURE.md` ("best-effort, fail-open"). |
| **Sane defaults out of the box** | Single-user tool with one developer means: the seeded "AI & Programming" topic must work on first install. No empty-state UX needed (it's the author). | LOW | YES | Default topic already seeded in `background/service-worker.js` DEFAULTS. |
| **Mobile DOM selectors** (`m.youtube.com`, mobile IG) | iPhone Orion renders mobile DOM. Desktop selectors do nothing there. | HIGH | NO | Already in PROJECT.md Active. Genuine work item. |
| **SPA navigation handling** | YouTube/Instagram swap routes without page reload. Without re-scan, the tool stops working after the first navigation. | MEDIUM | YES | MutationObserver + URL poller in v0.1. Verify it survives on iOS Safari. |
| **Daily install / load smoke test** | Tool that silently breaks on a YT update is worse than no tool. Author needs a fast "is it still working?" loop. | LOW | NO | A `SMOKE_TEST.md` playbook (manual). Listed in PROJECT.md Active. |

### Differentiators (Move "Works" → "Trusted")

These aren't strictly required, but they each fix a known failure mode of a personal tool
where the user is also the developer. Each one is graded on whether it pays back the cost
of building it within ~2 weeks of daily use.

| Feature | Value Proposition | Complexity | v0.1? | Build? | Notes |
|---------|-------------------|------------|-------|--------|-------|
| **Per-item "wrong call" feedback button** | When a Short gets blurred and shouldn't have (or vice versa), author tags it. Used **only** to inform threshold/keyword tuning, NOT for online retraining. | MEDIUM | NO | YES (P2) | Add a small "wrong?" affordance on the overlay. Logs `{videoId, classification, reason, topic_id}` to `chrome.storage.local` ring buffer (cap ~100 entries). Author reads it in options ("Recent misclassifications") and edits keywords/thresholds. No ML retraining loop — this is a notepad, not a model. |
| **Per-topic confidence threshold slider** | Cosine similarity threshold is the single most impactful knob. One global value will be wrong. Author needs to tune per topic ("AI" wants 0.45, "Cooking" wants 0.55). | LOW | NO | YES (P2) | One slider per topic in options. Default 0.50. Persist in topic object. |
| **Reason badge on overlay ("matched 'transformer'" or "transcript sim 0.32 to AI topic")** | When the author asks "why was this blurred?", the answer must be in the overlay, not a debug log. Trust is built one explained decision at a time. | LOW | NO | YES (P1) | Already half-there: overlay shows title/author. Add `reason` field from `classify()` return. Free win. |
| **Override domain allowlist (e.g. always show shorts on this channel)** | Some channels are 100% on-topic. Re-classifying every Short from them is waste and risks false negatives. | LOW | NO | YES (P3) | Per-channel "always allow" list, separate from keyword topics. Small UI in options. |
| **Daily counter (blurred vs allowed, today)** | Tells author "is this thing even firing?" — the single most important signal of whether the tool is working. Already in v0.1; keep. | LOW | YES | KEEP | Don't expand to "weekly trends" — that's a product feature, not a personal tool feature. |
| **Custom topic-suggestion from "videos watched past 30s"** | Idea: surface a list of phrases from transcripts the author actually watched a while, propose them as new keywords. | HIGH | NO | NO (defer) | Sounds great, requires watch-time tracking, transcript caching for *allowed* videos too, and a UI to review suggestions. Cut. The author can manually add keywords when they notice patterns; that's faster than building this. |
| **Multiple "modes" (learning mode vs decompression mode)** | Some evenings the author wants useful shorts; some evenings they want any-shorts. Mode-switch toggles the whole topic set. | LOW | NO | MAYBE (P3) | A "decompression" mode = pause + a longer duration option (e.g. "until tomorrow morning"). Already covered by the existing pause-with-custom-duration. Don't build separate modes. |
| **Topic enable/disable toggle (without deleting)** | Author has a topic but wants to mute it temporarily ("not in cooking mode this week"). | LOW | NO | YES (P3) | Boolean per topic. Small option-page change. |
| **"Show last 10 blurred titles" peek** | When the author suspects over-filtering, glance at what got hidden. | LOW | NO | YES (P3) | Append to the same ring buffer as the misclassification log. |
| **Backup / export settings to a JSON file** | Reinstalling the wrapped iOS extension loses settings. Author keeps topics in a file as ground truth. | LOW | NO | YES (P2) | One button in options: dump `chrome.storage.sync` to a `.json` download. Reverse: import. Critical for an iOS sideload world where re-signing/re-installing is routine. |
| **Embedding precompute on idle** | When the author edits a topic, recompute that topic's embedding once and cache it. Don't recompute per-Short. | LOW | NO | YES (P1) | Cached topic embedding lives in `chrome.storage.local`; invalidated only when the topic text changes. This is correctness + perf, not polish. |

### Anti-Features (Tempting, But Build = Mistake)

These look like "obvious next features" if you treat this as a product. It is not a product.
Each one is deliberately NOT built, with reasoning.

| Anti-Feature | Why It Looks Tempting | Why Actually Wrong | Alternative |
|--------------|----------------------|-------------------|-------------|
| **User accounts / login** | "What if I want it on another device?" | One user. One device (the iPhone). The desktop is a dev sandbox, not a daily surface. Accounts add auth, sync conflicts, recovery, all for zero benefit. | Single-device, period. If the author gets a new phone, they re-install and import the JSON backup. |
| **Cloud sync across devices** | "Settings should follow me." | Same as above. `chrome.storage.sync` already gives Chrome-account sync on desktop for free; on iOS Safari there's no sync layer anyway. Building one would mean a backend. We don't have a backend. | Manual JSON export/import on the rare device change. |
| **Distribution to others / Chrome Web Store / App Store listing** | "Other people would love this." | Maybe true, totally irrelevant. Distribution adds: privacy policies, store reviews, support requests, screenshot updates, version compatibility matrices, legal exposure, and a constant pressure to add features non-author users want. | Personal install via Xcode + own Apple Developer account. Source stays in a private repo. |
| **Telemetry / usage analytics / Sentry / error reporting** | "How will I know if it broke?" | The author *is* the user. If it breaks, they will notice within hours. Building a telemetry pipeline means a backend, privacy policy, and exfiltrating personal viewing data off the device — directly against the privacy constraint in PROJECT.md. | The daily counter is the only telemetry needed. If `blurred + allowed == 0` for a day, the author knows the tool stopped firing. |
| **Onboarding flow / first-run tutorial / empty-state walkthroughs** | "Users won't know what to do." | There are no users. Author already knows what to do. Seeded default topic is the entire onboarding. | None. Skip the welcome screen entirely. Options page opens on first install (already does); that's the tutorial. |
| **Premium tier / Pro features / paywall** | "Eventually monetize." | This is a tool. It is not a business. Monetization implies users implies distribution implies all the above. | Nothing. Free for the one person who uses it. |
| **Social features (share topics, public topic library, leaderboards)** | "Other people have curated topic sets." | The author's topics are personal. A shared topic library would either be empty (no users) or require moderating someone else's content, which is a product. | Manually curate your own. Steal good keywords from any source by typing them. |
| **Hard "skip" or "auto-scroll past" instead of blur** | "Why even show it? Just remove it." | (a) On YouTube/IG the page layout depends on the element being there — removing it causes layout bugs and infinite-scroll breakage. (b) Total removal hides false positives invisibly; the author can't ever audit "what got blocked?" | Keep blur+overlay. The overlay IS the audit trail. False positives become visible mistakes the author can fix. |
| **Auto-retrain the model from feedback** | "It should learn." | (a) MiniLM is not trainable in-browser at any useful speed. (b) Author has ~few hundred clicks per month — not even close to enough data. (c) Online learning destabilizes a model the user is otherwise relying on. | Feedback log → manual threshold/keyword adjustment. The author IS the optimizer. |
| **A/B testing different thresholds** | "I should measure what works." | (a) No second user to compare against. (b) The signal (author satisfaction) is subjective and impossible to A/B in n=1. | Just change the slider. If it feels worse, change it back. The "test" is one evening of scrolling. |
| **Notifications ("you blurred 42 shorts today!")** | "Reflection / gamification." | Notifications fight the goal. The point of this tool is to NOT think about scrolling more than necessary. A celebratory ping after a heavy scroll session is exactly the wrong incentive. | The daily counter sits in the popup. If the author wants to know, they look. |
| **Streaks / gamification / "longest day without off-topic content"** | "Behavioral psychology." | Again — fights the goal. Turns a quiet utility into a game with its own attention demands. | None. The tool is meant to be ignored when it's working. |
| **Multi-language NLP support** | "What about non-English shorts?" | The author consumes English-language content. MiniLM is multilingual-capable but tuning thresholds and keywords for languages the author doesn't read is pure waste. | English-only by default. If a topic in another language matters later, add it as a keyword tier match. |
| **TikTok For You support** | "It's the biggest short-form platform." | The author does not use TikTok (PROJECT.md Out of Scope). Building a third site adapter is HIGH complexity for zero personal benefit. | Out of scope. Permanent. |
| **Browser-agnostic distribution (Firefox, Chrome, Edge, Safari, Brave...)** | "Be where the user is." | The user is on iPhone Orion. Period. Desktop Orion + Chrome are dev sandboxes. Five-browser compatibility is product work. | Target iPhone Orion. Anything else is nice-to-have. |
| **Web dashboard / "your scrolling insights" page** | "Self-knowledge!" | Insights without action = noise. The author doesn't need a dashboard to know they scroll too much; they're literally building this tool to deal with that. | The daily counter is sufficient. |
| **Per-video override memory ("I clicked Show anyway on this Short, never blur it again")** | "Convenience." | (a) Encourages opting-out of the friction the tool exists to provide. (b) Creates a "silently-allowed" list the author can't easily audit. (c) PROJECT.md already calls this out as Out of Scope for explicit UX reasons. | Per-render reveal only. If a topic genuinely needs more permeability, raise its threshold. |
| **Customizable blur intensity / overlay theme / dark mode skins** | "Personalization!" | One user. They will configure it once. CSS exists, edit the file. | Edit `content/common.css` directly. No options-page knob needed. |
| **Keyboard shortcuts (J/K/L to allow/block/reveal)** | "Power user." | On iPhone there is no keyboard while scrolling shorts. Desktop usage is too rare to justify the complexity. | None. Tap "Show anyway." |
| **Watch-time tracking** | "Measure what the filter is actually doing to my behavior." | (a) Requires sustained presence on the page, content scripts running long-lived timers, and a fragile model of "watched" vs "scrolled past." (b) Privacy-touching even on-device — it's a log of every video you watched. (c) Not actionable: knowing you watched 18 min today doesn't tell you what to change. | None. The blurred-vs-allowed daily count is the lightweight signal. |
| **Pre-fetch transcripts in the background for upcoming feed items** | "Speed." | (a) IG/YT don't expose "what's next" — feed is infinite and lazy. (b) Speculative network requests = battery + data. (c) Late-classification (item arrives, gets classified, blur appears within ~300ms) is already good enough. | Classify on-render. The MutationObserver is the right trigger. |
| **Topic suggestion via watch history scan** | "It would learn your taste." | (a) Requires API access to YouTube watch history (not exposed to extensions on mobile). (b) Author can just type the keywords they care about. | Author manually edits topics. Faster, more honest. |
| **i18n / accessibility (screen reader support, reduced-motion variants, etc.)** | "Be a good citizen." | One user, no accessibility need stated. The blur+overlay is an opt-in UI on a feed the author already uses. | Skip until needed. |

## Feature Dependencies

```text
Runs on iPhone Orion (HIGH)
    └── Mobile DOM selectors (HIGH)
            └── SPA navigation handling (existing, verify on iOS)
                    └── Per-item blur + Show anyway (existing)
                            └── Reason badge on overlay
                                    └── Per-item "wrong call" feedback button
                                            └── Misclassification log (ring buffer)

Transcript-based classification (HIGH)
    ├── Tiered classifier (keyword → embeddings)
    │       └── Embedding precompute on idle (cache topic embeddings)
    │               └── Per-topic confidence threshold slider
    └── Result cache by video ID (LOW)

Topic editor (LOW, existing)
    ├── Topic enable/disable toggle
    └── Override domain/channel allowlist

Pause control (LOW, existing)
    └── Per-site toggle (LOW, existing)

Backup / export settings (LOW)
    └── No dependencies — standalone, but unlocks "re-installable iOS extension"
```

### Dependency Notes

- **Mobile DOM selectors blocks everything else on iPhone:** Without working selectors for
  `m.youtube.com`, no other feature reaches the author's primary surface. Phase 1 must
  unblock this before anything semantic ships.
- **Tiered classifier blocks topic-threshold sliders:** The slider only makes sense once
  embeddings are running, because keywords don't have a continuous similarity score.
- **Reason badge enables wrong-call feedback:** Author can't say "this is wrong" usefully
  without seeing *why* the tool decided what it decided.
- **Backup/export is independent but pairs with iOS install reality:** Every iOS reinstall
  loses sync state. Export/import is the safety net that makes routine re-signing tolerable.

## MVP Definition

### Launch With (Milestone v0.2 — "Works on my phone")

The smallest thing that makes the upgrade real on the target device.

- [x] (v0.1) Topic editor, blur overlay, pause, per-site toggle, daily counter
- [ ] **Runs on iPhone Orion** — wrapped Safari Web Extension, installable, content scripts inject
- [ ] **Mobile DOM selectors for `m.youtube.com` Shorts + feed**
- [ ] **YouTube transcript fetch** via `ytInitialPlayerResponse.captions`
- [ ] **Local embeddings (MiniLM-L6-v2) + cosine similarity** with tiered classifier (keyword first, embeddings on inconclusive)
- [ ] **Topic embedding cache** (precomputed on topic edit, persisted)
- [ ] **Per-video result cache** (LRU in `chrome.storage.local`)
- [ ] **Reason badge on blur overlay** (free win, builds trust)
- [ ] **Manual smoke-test playbook** (5-minute checklist the author runs after any platform-side change)

That's the milestone. Everything else is later.

### Add After Validation (v0.3 — "Trustable")

Once v0.2 has run for ~2 weeks of real personal use and the author has at least one
"this got the wrong call" moment.

- [ ] **Per-topic confidence threshold slider**
- [ ] **"Wrong call" feedback button + ring-buffer log of last N misclassifications**
- [ ] **Settings JSON export/import** (needed if a reinstall happens during the v0.2 period)

### Future Consideration (v0.4+ — defer until someone complains)

- [ ] **Topic enable/disable toggle (without deleting)** — small, but only useful once there are 3+ topics
- [ ] **Channel/domain allowlist** — only matters if a specific channel becomes a repeat false-positive
- [ ] **"Show last 10 blurred titles" peek** — only matters if author starts suspecting over-filtering
- [ ] **Mobile Instagram structural-heuristic refinement** — already in v0.1 caption-only mode; revisit if IG breaks

## Feature Prioritization Matrix

| Feature | Personal Value | Cost | Priority |
|---------|----------------|------|----------|
| Run on iPhone Orion | HIGH | HIGH | **P1** |
| Mobile DOM selectors (`m.youtube.com`, IG) | HIGH | HIGH | **P1** |
| Transcript fetch + tiered semantic classifier | HIGH | HIGH | **P1** |
| Topic embedding cache | HIGH | LOW | **P1** |
| Per-video result cache | HIGH | LOW | **P1** |
| Reason badge on overlay | MEDIUM | LOW | **P1** (cheap, big trust-payoff) |
| Smoke-test playbook | MEDIUM | LOW | **P1** |
| Per-topic threshold slider | HIGH | LOW | **P2** |
| Wrong-call feedback + log | MEDIUM | MEDIUM | **P2** |
| Settings JSON export/import | MEDIUM | LOW | **P2** |
| Topic enable/disable toggle | LOW | LOW | **P3** |
| Channel/domain allowlist | LOW | LOW | **P3** |
| "Last 10 blurred" peek | LOW | LOW | **P3** |
| Anything in the Anti-Features list | NEGATIVE | varies | **Do not build** |

## Competitor Feature Analysis

| Capability | Unhook | BlockTube | IGPlus | Our v0.2 |
|------------|--------|-----------|--------|----------|
| Per-item content filtering | NO (binary surface toggle) | YES (manual blocklist/regex) | NO | **YES (semantic, automated)** |
| Topic-based / interest-aware | NO | NO | NO | **YES** |
| Transcript-based classification | NO | NO | NO | **YES (YouTube only)** |
| Works on mobile (iOS) | Firefox Android only | Desktop only | Desktop only | **iPhone Orion (primary target)** |
| On-device, no cloud | YES | YES | YES | **YES** |
| Reversible (per-item undo) | N/A | NO (hard block) | N/A | **YES (Show anyway, per-render)** |
| Survives platform updates without manual fix | Mostly (CSS-only) | NO (frequent breakage) | Mostly | **MEDIUM (selectors will drift; smoke-test catches it)** |
| Resilient to false positives | N/A | Manual unblock | N/A | **Per-render reveal + feedback log** |

The "Our v0.2" column is the entire reason this project exists. Everything else in the table
is something an existing tool already does — building it again would be a waste.

## Sources

- [UnDistracted - Chrome Web Store](https://chromewebstore.google.com/detail/undistracted-hide-faceboo/pjjgklgkfeoeiebjogplpnibpfnffkng?hl=en) — confirms binary surface-toggle model
- [DF Tube - Chrome Web Store](https://chromewebstore.google.com/detail/df-tube-distraction-free/mcigjliffjfjceioeeiolliiimglknji) — CSS-only hiding approach; no content awareness
- [BlockTube - Chrome Web Store](https://chromewebstore.google.com/detail/blocktube/bbeaicapbccfllodepmimpkgecanonai) — manual blocklist + regex; user reviews mention update breakage
- [BlockTube GitHub](https://github.com/amitbl/blocktube) — confirms architecture (no semantic, no transcript)
- [Unhook - Chrome Web Store](https://chromewebstore.google.com/detail/unhook-remove-youtube-rec/khncfooichmfjbepaaaebmommgaepoid) — toggle-based, Firefox Android for mobile
- [IGPlus](https://chromewebstore.google.com/detail/igplus-hide-instagram-ree/dbbopjndlaginbghfoibbndhlbpdpapd) — Instagram surface-toggle
- [Antigram](https://chromewebstore.google.com/detail/antigram-explore-reels-bl/igbheapdmolhhmmklmkfjjjncmhihfjh) — IG block-feature checkboxes
- [Intention - Chrome Web Store](https://chromewebstore.google.com/detail/intention-stop-mindless-b/dladanhaondcgpahgiflodhckhoeohoe) — friction-prompt model (not content filter)
- [Intentional - Chrome Web Store](https://chromewebstore.google.com/detail/intentional-block-distrac/aapcigpegmhncjofolnjdibbimmegdpo) — time-quota model
- `/Users/daurenzhunussov/smartscroller/.planning/PROJECT.md` — Core Value, Out of Scope, Constraints
- `/Users/daurenzhunussov/smartscroller/.planning/codebase/ARCHITECTURE.md` — what v0.1 already provides

---
*Feature research for: personal short-form video topic-filter, iPhone-primary*
*Researched: 2026-05-15*
