# Pitfalls Research

**Domain:** Personal browser extension — content classification (transcripts + on-device embeddings) on iOS Safari Web Extension
**Researched:** 2026-05-15
**Confidence:** MEDIUM-HIGH (HIGH for documented iOS/Transformers.js issues with citations; MEDIUM for YouTube transcript fragility — sources confirm breakage but not specific contract changes; MEDIUM for personal-tool behavioral pitfalls — inference, not citation)

**Scope note:** This document covers **forward-looking pitfalls** specific to v0.2 (mobile DOM port, transcript fetch, embedding tier, iOS install). Existing v0.1 fragility (Instagram structural heuristics, MutationObserver hot path, `escapeHtml` duplication, UTC day-roll, etc.) is already documented in `.planning/codebase/CONCERNS.md` and is NOT duplicated here. Where v0.2 work makes a v0.1 concern materially worse, that interaction is called out explicitly.

---

## Critical Pitfalls

### Pitfall 1: The iPhone install hurdle kills the project before it ships

**What goes wrong:**
You finish v0.2 (transcripts + embeddings working in desktop Chrome/Brave), open Xcode for the first time to wrap it as a Safari Web Extension, hit signing/provisioning/AppGroup/entitlement errors, lose 1–2 weekends, set it aside "until I have time," and never come back. The desktop branch keeps working; the iPhone — *where the actual scrolling happens* — never sees the extension. The project meets its codebase milestones and fails its core value (`PROJECT.md:13`).

**Why it happens:**
- iOS does not support unpacked extensions. The *only* install paths are: (a) Xcode-wrapped Safari Web Extension installed to a paired device via Xcode, (b) TestFlight, or (c) App Store. All three require Apple Developer account + provisioning profile + bundle ID + signing cert.
- Xcode's Safari Web Extension template creates a 4-target multiplatform project (iOS app, iOS extension, macOS app, macOS extension) with shared AppGroups — that's a lot of unfamiliar surface for someone who has only written vanilla JS.
- TestFlight builds **expire after 90 days** ([Apple TestFlight docs](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)). For a personal tool you don't intend to distribute, this means a recurring "re-upload a new build to TestFlight every 90 days or lose access" maintenance cost. Easy to forget; one expiry and your filter is gone for a weekend.
- Free Apple Developer accounts ($0) work for direct-from-Xcode installs but the **provisioning profile expires every 7 days** — meaning you'd need to plug the iPhone into Xcode and re-deploy *weekly* just to keep the extension installed. That cadence is fatal for a tool that's supposed to disappear into the background.

**Prevention:**
1. **Spike the install path in Phase 1, before writing any new code.** Goal: "extension v0.1 (current state, no embeddings, no transcripts) running on iPhone Orion, installed via Xcode-wrapped Safari Web Extension." If this can't be done in a weekend, the whole project plan needs to change — there is no point implementing mobile DOM selectors for a runtime you can't deploy to. Treat this as a hard gate.
2. **Pay the $99/year Apple Developer fee.** It removes the 7-day provisioning expiry and unlocks TestFlight (90-day rolling). The "free constraint" in `PROJECT.md:46` is about *ongoing API/cloud costs*, not one-time tooling — clarify this with yourself upfront so you don't talk yourself out of $99 that unblocks the entire project.
3. **Once installed, document the exact Xcode steps in a `docs/install-ios.md`** so the next 90-day refresh is a 10-minute checklist, not a re-learning exercise. Include: bundle ID, signing team, AppGroup identifier, TestFlight upload command line if using `xcrun altool` or Transporter.
4. **Set a calendar reminder for day 75** after each TestFlight upload to refresh the build before expiry.
5. **Alternative escape valve:** if Xcode is genuinely a blocker, fall back to **Orion macOS-only** for this milestone and document iPhone as deferred. Honest re-scoping beats a half-finished iPhone install that doesn't actually run.

**Warning signs:**
- You catch yourself saying "I'll do the iOS install last, once the embeddings work." This is the death sentence. Reverse the order.
- You find yourself reading Xcode error messages on a Saturday and feeling annoyed. Stop and either (a) commit the next 4 hours to it, or (b) explicitly re-scope to macOS-only and write it down.
- It's been 2 weeks since you last opened the extension on your phone. The project is dying.

**Phase to address:** **Phase 1 (Install path spike) — must be the FIRST phase, before mobile DOM, before transcripts, before embeddings.**

**Severity: CRITICAL**

---

### Pitfall 2: Embedding model file refuses to load inside the iOS Safari Web Extension sandbox

**What goes wrong:**
On desktop Chrome the Transformers.js + `Xenova/all-MiniLM-L6-v2` model loads from a bundled `.onnx` file (or remotely from HuggingFace CDN). You port the same code to the Xcode-wrapped iOS Safari Web Extension and one of the following fails:
- The 25MB quantized model file isn't packaged into the Safari extension bundle correctly, so `pipeline()` 404s.
- The model loads but Transformers.js v3 immediately crashes with growing memory on iOS — this is a documented v3 regression ([huggingface/transformers.js#1242](https://github.com/huggingface/transformers.js/issues/1242)). Symptoms: "Application crashes on iOS (both Safari and Chrome)" and "extremely high and growing memory usage."
- The WASM backend tries to allocate and Safari throws `RangeError: Out of memory` ([transformers.js#953](https://github.com/huggingface/transformers.js/issues/953)).
- The fetch to HuggingFace CDN is blocked by the extension CSP or by a tracking-prevention policy in iOS Safari, and there's no fallback to a bundled file.

You discover this only *after* you've finished the embedding tier on desktop and tried to deploy.

**Why it happens:**
- iOS Safari Web Extensions run inside an App Sandbox with stricter file access than Chrome MV3 extensions. Resource URLs (`safari-web-extension://...`) work differently from `chrome-extension://...` and the path-resolution logic Transformers.js uses to find the ONNX file may need an explicit `env.localModelPath` override.
- Safari's WebGPU support is experimental and **not available** in Safari Web Extension contexts at all on iOS as of 2026; you will *always* fall back to WASM. The 1.5–2GB device-memory budget on iPhone is shared between all of Safari, all background processes, and your extension — and **extensions get killed harder than tabs** under memory pressure.
- Apple's Safari Extensions memory ceiling was historically **6MB** for the entire extension runtime ([Apple Developer Forums thread 687642](https://developer.apple.com/forums/thread/687642)); even on modern iOS that ceiling is *much* lower than the desktop budget. A 25MB model loaded into memory plus its WASM working set will press hard against this.

**Prevention:**
1. **Test on real iPhone hardware as early as possible — ideally Phase 2, immediately after the install path spike works.** Specifically: get a stub Transformers.js `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')` call returning a single embedding on iPhone Orion *before* writing any of the classification logic. If this doesn't work, no amount of well-designed classification code matters.
2. **Bundle the ONNX model file into the extension** (not CDN fetch). Use `env.allowRemoteModels = false; env.localModelPath = chrome.runtime.getURL('models/')`. Verify the `models/` directory is included in the Xcode bundle resources.
3. **Pin to Transformers.js v2.x until v3's iOS memory regression is fixed** ([#1242](https://github.com/huggingface/transformers.js/issues/1242)). The blog post promoting v3 ([HuggingFace transformersjs-v3](https://huggingface.co/blog/transformersjs-v3)) does not mention iOS regressions; check the issue tracker, not the announcement.
4. **Run embedding inference in an offscreen document or dedicated content-script worker, not in the service worker.** iOS Safari kills service workers aggressively (see Pitfall 3) and a mid-classification kill would orphan a 25MB allocation.
5. **Measure peak memory during a 100-Short scroll session on a real iPhone 12 or 13** (low end of likely target hardware) before declaring the embedding tier "done." Use Safari Web Inspector → Timelines → Memory.
6. **Have a graceful degrade path:** if `pipeline()` rejects on load, the extension should silently fall back to the keyword-only v0.1 classifier. Never let a model-load failure brick the whole filter.

**Warning signs:**
- Safari Web Inspector shows memory climbing across multiple scans without dropping back down after GC.
- The extension goes silent after ~30–60 seconds of scrolling (service worker killed mid-session — see Pitfall 3 for the related symptom).
- `pipeline()` throws on first call on iPhone but works on desktop. CSP, file path, or bundle-resource issue.
- Cold-start latency is >5s on iPhone for the first inference (this can be acceptable; >15s is not).

**Phase to address:** **Phase 2 (Embedding feasibility on iOS) — happens AFTER install path, BEFORE writing classification logic.**

**Severity: CRITICAL**

---

### Pitfall 3: iOS Safari extension service worker dies mid-scroll and never wakes back up

**What goes wrong:**
The user is mid-Shorts-scroll. The service worker is killed by iOS (memory pressure, time-based termination, or thermal). The classifier in the content script keeps trying to `chrome.runtime.sendMessage` to report stats, get cached embeddings, or fetch a transcript — every call rejects. New Shorts scroll past unblurred because the embedding-tier work is enqueued through the (now-dead) worker. The user sees off-topic content and the filter looks broken. **The extension does not recover until the user manually disables and re-enables it** ([Apple Developer Forums thread 758346](https://developer.apple.com/forums/thread/758346)).

**Why it happens:**
- iOS Safari Web Extension service workers are killed under memory pressure when "RAM usage hits approx 80%" — this is documented behavior, not a bug ([Apple Developer Forums thread 721222](https://developer.apple.com/forums/thread/721222)).
- Worse: since iOS 17.4.x onward there has been a regression where **the background script is permanently killed after 30–45 seconds and the only recovery is manual extension toggle** ([Apple Developer Forums thread 758346](https://developer.apple.com/forums/thread/758346)). This may or may not be fixed by 2026-05; verify on target iOS version.
- This compounds with existing v0.1 fragility: `CONCERNS.md` already flags that the **daily stats roll** depends on the SW waking up, and that **the SW handler is unauthenticated and stateful**. Adding an embedding-result cache and a transcript-fetch coordinator to the SW makes more things fail when it dies.

**Prevention:**
1. **Move stateful classification work OUT of the service worker.** Specifically: the embedding cache, transcript cache, and result cache should live in `chrome.storage.local` (persistent across SW death) or as a module-scoped cache in the content script (reset on page navigation, acceptable). Treat the SW as message router only — never as a long-running computer.
2. **Never `await sendMessage()` on the critical blur path.** If the SW is dead, the await hangs (Safari) or rejects (Chrome). The blur decision must complete using only content-script-local state. Move classification logic fully into the content script context.
3. **Use `chrome.storage.local` (NOT `chrome.storage.sync`) for caches.** Sync has tiny quotas (8KB per item, 100KB total — `CONCERNS.md` flags this) and is irrelevant for a single-user tool anyway.
4. **Make every `runtime.sendMessage` call fire-and-forget with try/catch.** `content/classifier.js:117-123` already does this for stats; the same defensive posture applies to any new SW messages introduced for embeddings/transcripts.
5. **Add an "SW alive?" diagnostic** to the popup: show last-message-received timestamp from the SW. If it's been >5 minutes during active use, you know the worker is dead and that's your signal to look at iOS version notes.

**Warning signs:**
- The popup shows stats that haven't updated in 10+ minutes despite known blurs happening.
- Switching to the YouTube tab after >5 minutes idle results in the first Short loading slowly or unblurred (SW cold-starting or dead).
- Console (via Safari Web Inspector → connected iPhone) shows "Could not establish connection. Receiving end does not exist" on `sendMessage` calls.
- Toggling the extension off and on in iOS Settings "fixes" the filter for another short window.

**Phase to address:** **Phase 2 (Architecture decision) — Move all stateful work to content script + `chrome.storage.local`. Watch throughout.**

**Severity: CRITICAL**

---

### Pitfall 4: Threshold tuning death — you spend a weekend chasing a single number and the filter still feels wrong

**What goes wrong:**
The embedding tier produces a cosine similarity score in `[-1, 1]` (in practice, for unrelated content, scores cluster in `[0.0, 0.4]`; for related, in `[0.4, 0.8]`). You set the threshold to 0.55 (default suggested in v0.1 README). False positives erode trust ("why did it blur a Karpathy video?"); you lower it to 0.45. Now false negatives explode ("AI girlfriend" Shorts leak through). You raise to 0.50. Now the boundary feels unpredictable — sometimes Karpathy is blurred, sometimes "AI dating advice" gets through. You spend hours scrolling and tweaking. The tool is now actively annoying.

**Why it happens:**
- `all-MiniLM-L6-v2` produces semantically *useful* embeddings but the boundary between "related to my topic" and "mentions my topic words" is fuzzy. A clickbait Short titled "Why I quit AI engineering" and a substantive technical Short titled "How transformers work" can both land in `[0.55, 0.70]` cosine similarity to the topic "AI & Programming."
- Academic work on this exact model documents that "all-MiniLM-L6-v2 was selected as a balanced choice for semantic retrieval" with calculated thresholds around **0.659** for relevance retrieval ([arxiv.org/html/2509.15292v1](https://arxiv.org/html/2509.15292v1)) — but that's for academic literature, not 30-second Short transcripts.
- Short transcripts (often <200 words, sometimes <50 for fast-cut Shorts) provide weak signal — high variance in embedding space means thresholds that work for long-form video fail for Shorts.
- Quantized embeddings (which you'll use to fit in mobile memory) lose ~5% similarity to original-precision embeddings ([HuggingFace quantized variants](https://huggingface.co/Ayeshas21/sentence-transformers-all-MiniLM-L6-v2-quantized)) — this compounds.

**Prevention:**
1. **Don't ship one threshold. Ship per-topic thresholds.** Different topics have different "tightness" in embedding space — "AI & Programming" is broad and noisy; "Sourdough baking" is narrower and crisper. A single global number is a category error.
2. **Build a calibration log from day 1.** Every time the user clicks "Show anyway" (false positive on blur) or scrolls past an off-topic Short unblurred (false negative), record `{ video_id, transcript_excerpt, cosine_score, decision, user_action }` in `chrome.storage.local`. After 50 logged decisions, eyeball the distribution; the right threshold is the one that minimizes regret on actual personal viewing.
3. **Use a "soft zone" instead of a binary cliff.** Below threshold-low: blur with full overlay. Above threshold-high: never blur. Between: blur with a *less-aggressive* style (e.g. 50% opacity instead of fully frosted) to flag uncertainty. Visual feedback that the classifier is unsure beats a confident-but-wrong decision.
4. **Pre-compute and inspect topic embeddings in the options page.** Show "Your 'AI & Programming' topic clusters near: machine learning, neural networks, GPT. It's pulling away from: AI girlfriend, AI lawsuit, AI music." This makes the boundary tangible and surfaces vocab problems before they become blur problems.
5. **Cache `(video_id, score)` aggressively.** A flickering decision (blur this scan, unblur the next) is the single most trust-destroying failure mode. Once classified, that video ID's decision is locked for the session at minimum.
6. **Accept that perfect classification is impossible.** The product spec already accepts this — "Show anyway" exists precisely because the filter will be wrong. Lean into making the wrong decisions cheap to override (which v0.1 already does well) rather than chasing zero false positives.

**Warning signs:**
- You find yourself adjusting the threshold more than once a week.
- The same video gets blurred on one scan and revealed on the next within the same session.
- You start adding individual keywords ("not_ai_girlfriend", "not_ai_music") to compensate for embedding shortcomings — this is the keyword-tier and embedding-tier fighting each other.
- You stop using the tool because the friction of "Show anyway" on real-content false positives exceeds the savings on filtered junk.

**Phase to address:** **Phase 3 (Classification tuning) — after embeddings are working but before declaring the milestone done. Calibration logging should be Phase 2 infrastructure so data exists when Phase 3 starts.**

**Severity: HIGH (CRITICAL if it causes the user to stop using the tool — which is the project's failure mode by definition)**

---

### Pitfall 5: YouTube transcript fetch becomes unreliable across regions, ages, and Short auto-captions

**What goes wrong:**
The plan in `PROJECT.md:36` is to pull transcripts via `ytInitialPlayerResponse.captions` and parse the timedtext track. In practice:
- **20–40% of Shorts have no usable transcript** — captions disabled by uploader, auto-captions not yet generated (Shorts can take "a few hours to a few days" to get auto-captions per [YouTube help](https://support.google.com/youtube/answer/6373554)), or video is too short/musical for auto-caption to fire.
- **Auto-caption quality is ~85% on clear speech and much worse on accents, slang, technical terms, music, or background noise** — exactly the conditions in fast-cut Shorts.
- **Age-restricted, region-locked, or private videos** return no caption track.
- **YouTube changes the API contract without notice.** Documented breakage: "YouTube scrapers that were working previously stopped functioning, with errors indicating 'Subtitles are not available in the top 30 languages'" ([ActivePieces YouTube Scraper Broken](https://community.activepieces.com/t/youtube-scraper-broken/5245)). Cookie-based authentication for transcript extraction has also been broken by recent YouTube API changes.
- **Rate limiting / IP blocks** if the extension fires N transcript fetches per scroll session — although this is less likely for a personal-scale single-IP tool than for a scraper, repeated rapid fetches of `/api/timedtext` or repeated parses of `/watch?v=...` HTML can trigger captchas.

**Why it happens:**
- `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks[].baseUrl` is an unofficial, undocumented data structure. YouTube can rename `playerCaptionsTracklistRenderer` to `playerCaptionsRenderer` (or vice versa, it has flipped before) and break every transcript scraper overnight.
- Shorts URLs (`youtube.com/shorts/<id>`) require slightly different fetch logic than `youtube.com/watch?v=<id>` — the `ytInitialPlayerResponse` is embedded at a different position on the page.
- The transcript XML format itself occasionally changes (the move to JSON3 / SRV3 / TTML variants).

**Prevention:**
1. **Tier the classifier so transcript fetch is never required.** Architecture should be: (a) keyword tier on title/channel/hashtags → blur if confident off-topic, allow if confident on-topic, otherwise (b) fetch transcript and run embedding tier. If transcript fetch fails or returns empty, fall back to "treat as on-topic" (the default-allow stance from `CONCERNS.md` rationale — empty haystack returns `onTopic: true`). **Never block the blur decision on a transcript fetch succeeding.**
2. **Cache transcripts by video ID forever** (`chrome.storage.local`, capped at e.g. 1000 most recent IDs). Same Short scrolling past twice should never re-fetch. This also makes you robust to a fetch failure: if you got the transcript last time, you can use it next time even if the API is now broken.
3. **Time-box the transcript fetch.** 1500ms hard timeout. A Short is ~30 seconds; if you can't classify in under 1.5s, the user has already scrolled past and your work is wasted compute. Race the fetch against `setTimeout(reject, 1500)`.
4. **Don't trust the transcript.** Combine transcript signal with title/channel signal — a Short whose transcript is "(music)" but whose title is "AI girlfriend" should not be classified as on-topic for "AI & Programming." The transcript is *one* signal, not *the* signal.
5. **Build a "transcript-unavailable" telemetry counter in the popup.** If 30%+ of attempted classifications fall back to keyword-only because transcript fetch failed, that's diagnostic information for tuning the keyword tier and for spotting when YouTube has broken the contract.
6. **Monitor the contract.** Add a smoke-test script (even a manual one): given a known stable video ID, fetch transcript via your code path and assert it returns non-empty text. Run it after every YouTube-side change you notice (a UI refresh is the canary).
7. **Have a fallback signal source.** Title + channel + first hashtags are still useful even with no transcript. The Shorts description (where present) is a third signal. Don't architect a world where "no transcript = no decision."

**Warning signs:**
- Popup stat "transcript-fetched" / "transcript-failed" ratio drops below 60% successful.
- All previously-blurred Shorts start coming through unblurred after a YouTube update (transcript fetch returning empty silently).
- Network panel shows `/api/timedtext` returning 429 or empty XML.
- A scroll session shows multiple-second pauses (transcript fetch blocking the UI thread or timing out without cancellation).

**Phase to address:** **Phase 3 (Transcript integration) — implementation includes the timeout, cache, and fallback architecture from day one, not as a follow-up hardening pass.**

**Severity: HIGH**

---

## Moderate Pitfalls

### Pitfall 6: Mobile DOM selectors break more often than desktop, and `m.youtube.com` is a different namespace entirely

**What goes wrong:**
You port the YouTube selectors from `content/youtube.js:14-25` to mobile by adding `ytm-*` variants. Six weeks later, mobile YouTube ships a refresh that renames `ytm-reel-shelf-renderer` to `ytm-reel-item-renderer` (hypothetical but the pattern is real), and blurring silently stops working on iPhone — but not on desktop, because desktop selectors weren't affected. You don't notice for days because you only check desktop while developing.

**Why it happens:**
- Mobile YouTube uses the `ytm-` prefix namespace (vs `ytd-` on desktop) — verified in search results. The component vocabularies are parallel but not identical.
- Mobile YouTube ships UI experiments more aggressively than desktop (smaller surface area, more A/B testing). Selector lifecycle is shorter.
- iOS Safari may serve `m.youtube.com` *or* `www.youtube.com` depending on Safari's "Request Desktop Website" setting — and Orion may behave differently again. The extension needs to handle both hosts.
- `CONCERNS.md` already flags YouTube selectors as HIGH-risk; mobile is HIGH+.

**Prevention:**
1. **Maintain a `SELECTORS.md` (per `CONCERNS.md` mitigation suggestion) with last-verified date AND host (`youtube.com` vs `m.youtube.com`).** When mobile breaks, you know which file/section needs updating.
2. **Test on real iPhone Orion specifically — not iOS Simulator, not desktop Safari with mobile user-agent.** Real device, real Orion, real Safari WebKit. The DOM is sometimes different across these.
3. **Add `host_permissions` for `m.youtube.com` explicitly** in addition to `youtube.com`. Currently `manifest.json` covers `*://*.youtube.com/*` which includes `m.` — verify this still works under iOS Safari Web Extension's stricter host-permission handling.
4. **Have both selector sets in the same file with explicit comments.** Don't fork into `youtube-desktop.js` + `youtube-mobile.js` — that doubles the maintenance burden. Use the existing pattern of multiple selectors per field, and add `ytm-*` variants to each list.
5. **Build the "selectors stale" telemetry counter from `CONCERNS.md` first** so you find out about mobile-only breakage from the popup, not from watching off-topic Shorts.

**Warning signs:**
- Popup blur count is high on desktop, near-zero on iPhone for the same scroll session.
- DevTools (Safari Web Inspector connected to iPhone) shows `document.querySelectorAll(SHORT_SELECTORS)` returning 0 on a Shorts page.
- A Short element in DevTools has `ytm-*` tags that aren't in your selector list.

**Phase to address:** **Phase 2 (Mobile DOM port).**

**Severity: HIGH**

---

### Pitfall 7: Gesture and scroll conflicts on mobile — overlay UX fights the platform

**What goes wrong:**
You ship the blur overlay on iPhone. It looks fine in screenshots. In actual use:
- The "Show anyway" button is too small to tap accurately while scrolling (Apple's recommended 44pt minimum; v0.1 CSS has it tuned for mouse cursors).
- Tapping the overlay accidentally pauses/plays the video underneath because the touch propagates.
- Vertical swipe on a blurred Short is supposed to scroll to the next Short — but the overlay div catches it and the scroll doesn't fire.
- The frosted-glass `backdrop-filter` is GPU-heavy and stutters on iPhone 12 mini / SE during fast scroll.
- The overlay's z-index fight with YouTube's own controls is worse on mobile because YouTube's mobile controls overlay at higher z-indexes than desktop.

**Why it happens:**
- The overlay was designed for desktop pointer interactions. iOS gestures use the same `touchstart`/`touchend` events but YouTube's mobile player heavily uses gesture recognizers for swipe-up, swipe-left, double-tap, long-press.
- `CONCERNS.md` already notes the overlay's z-index of `2147483600` "may lose to a host element."
- `pointer-events: none` on inner overlay parts can fix some but breaks the "Show anyway" tap target.

**Prevention:**
1. **Test the overlay on iPhone in actual scroll sessions, not just by loading a single Short.** The conflicts only emerge when scrolling quickly through 10+ items.
2. **Use `touch-action: pan-y` on the overlay** to let vertical swipes pass through to the underlying scroll container while still allowing tap on "Show anyway."
3. **Size the tap target to ≥44pt** per [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/buttons). The v0.1 CSS uses small buttons sized for cursor accuracy; mobile needs bigger.
4. **Drop the `backdrop-filter: blur(...)` to `backdrop-filter: blur(8px)` or solid color on mobile** — measure FPS in Safari Web Inspector during a 30-second scroll. If <50fps, simplify the visual.
5. **Capture touch events with `{ passive: true }`** so they never block scroll synchronously.
6. **Make the overlay click area cover the *card* but the "Show anyway" button be a clearly distinct sub-region** — accidental tap-to-reveal is worse than no-reveal because it teaches the user the filter is unreliable.

**Warning signs:**
- Scrolling on a Shorts page with blurs feels juddery on iPhone but smooth on desktop.
- You fat-finger "Show anyway" 1-in-5 times.
- You scroll past 3 Shorts when you meant to scroll 1 because gesture is over-firing.
- Safari Web Inspector → Timelines → Rendering shows >16ms frames during scroll.

**Phase to address:** **Phase 2 (Mobile DOM port) — these are mobile UX, address with the mobile port, not as a separate phase.**

**Severity: MEDIUM**

---

### Pitfall 8: Bundled file size pushes against extension install limits and download patience

**What goes wrong:**
The quantized `all-MiniLM-L6-v2` ONNX is ~23–25MB. Plus the Transformers.js runtime (~1MB), plus the ONNX runtime WASM (~10MB unstripped), plus the tokenizer.json (~700KB). You hit ~36MB before any of your code. iOS App Store has stricter requirements than Chrome Web Store; the Xcode-wrapped extension bundle includes a host iOS app plus the extension. Total install size approaches 40MB+. For a personal tool, that's a one-time pain. For a TestFlight build that gets refreshed every 90 days, that's a 40MB download every 90 days over potentially-slow networks.

**Why it happens:**
- The `PROJECT.md:81` soft cap of "~30MB" is for the embedding model alone; once you add ONNX runtime + tokenizer + your code, you blow past.
- ONNX runtime ships several backend `.wasm` files (with-threads, without-threads, with-SIMD, without-SIMD) and bundlers often include all variants for cross-browser fallback. iOS only needs one or two.
- Apple's App Store has a [cellular download cap of 200MB for apps](https://developer.apple.com/news/?id=09232020a) so 40MB is fine in absolute terms, but feels heavy for a personal utility.

**Prevention:**
1. **Strip unused ONNX runtime variants from the bundle.** Manually inspect the Transformers.js dist directory and remove `.wasm` files for backends you don't use (no threading on iOS Safari → drop the threaded variant; SIMD support is browser-dependent → check Safari's status).
2. **Use the most aggressively quantized model variant that still passes your accuracy bar.** `Xenova/all-MiniLM-L6-v2` has `model_quantized.onnx` at ~23MB and may have an even smaller int8 variant. Validate accuracy on a held-out set of 50 real Shorts before committing.
3. **Don't ship the tokenizer.json as a separate file if Transformers.js can bundle it inline.** Verify with the actual production build.
4. **Measure final bundle size in the Xcode build output** and write it down. Track over time — if it grows 5MB per minor version of Transformers.js, that's a regression to flag.
5. **Accept that v0.2 will be ~30–40MB on iPhone.** It's a one-time cost for a personal tool. Don't engineer to halve it unless the install actually fails — that's a Phase 4+ optimization.

**Warning signs:**
- Final `.ipa` from Xcode is >50MB.
- TestFlight install takes >2 minutes on WiFi.
- iPhone Settings → General → iPhone Storage shows the extension at >100MB after a week of use (could indicate runaway WASM heap or model duplicated across versions).

**Phase to address:** **Phase 2 (Embedding feasibility on iOS) — measure bundle size as part of the feasibility spike, before writing classification code.**

**Severity: MEDIUM**

---

### Pitfall 9: Cold-start jank — first classification of the session takes 5+ seconds and the user has already scrolled past

**What goes wrong:**
The user opens YouTube Shorts on iPhone. The extension's content script loads. The first Short renders. The classifier wants to embed the transcript but Transformers.js hasn't loaded the model yet — `pipeline()` is a one-time async init that on iPhone takes 3–8 seconds for the 23MB ONNX file + WASM compilation + first inference. During those seconds, the first 3–4 Shorts scroll past unblurred. The user concludes the filter is broken and scrolls onward indifferent.

**Why it happens:**
- Transformers.js `pipeline()` is lazy: model load + tokenizer init + WASM compilation all happen on first call. WebGPU shader compilation alone can take "several seconds on first use" ([Medium: WebGPU bugs holding back browser AI](https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca)) — and on iOS Safari there's no WebGPU at all, so you're on WASM which has its own multi-second first-inference cost.
- The content script only runs when the user navigates to a YouTube tab. The "warmup" doesn't happen before the user is scrolling.
- Pre-warming in the service worker doesn't help because (a) the SW can't share a model instance with the content script and (b) the SW may be dead anyway (Pitfall 3).

**Prevention:**
1. **Always run the keyword tier first.** Per `PROJECT.md:38` this is already the plan. Reinforce it: keyword tier returns synchronously and handles obvious cases without waiting for the model. The first 5 Shorts of a session will be classified by keyword only — *that's the design*, not a bug.
2. **Pre-warm the model on the first content-script load, not on the first classification call.** As soon as the YouTube DOM is detected, fire `pipeline()` in the background while the keyword tier handles incoming Shorts. By the time the user has scrolled 10–20 Shorts, the model is loaded for the rest of the session.
3. **Show a subtle "warming up" indicator** in the overlay's small text — "(quick filter only)" vs "(deep filter active)" — so the user knows the difference between "first 30 seconds" and "steady state."
4. **Cache previously-seen video IDs aggressively.** Same Short scrolling past again should be cached, not re-classified.
5. **Measure on real iPhone hardware:** time from `pipeline()` call to first inference result. If >5s on iPhone 12, decompose: model file load time vs WASM init vs first inference vs tokenizer init. Optimize the longest leg.

**Warning signs:**
- Popup stats show low blur count in the first minute of a session and higher after.
- The user can articulate "the filter takes a bit to wake up" — that's a sign they've noticed; cold-start is too slow.
- DevTools shows the content script doing `pipeline()` only on first Short, not on script load.

**Phase to address:** **Phase 2 (Embedding tier implementation) — pre-warm as part of the initial integration, not as a follow-up perf pass.**

**Severity: MEDIUM**

---

### Pitfall 10: The "I built it but never use it" failure mode

**What goes wrong:**
v0.2 ships. It works on iPhone Orion. You scroll YouTube Shorts on Saturday and the filter does its job. By Wednesday you've stopped looking at the popup stats. By the next month, the install has expired (Pitfall 1) and you haven't bothered to refresh it because the friction of opening Xcode > Connect iPhone > Run is higher than just scrolling without the filter. The tool has solved the technical problem but failed the behavior change.

**Why it happens:**
- Personal tools that aren't on the critical path of daily life atrophy. A spam filter you've never seen working is invisible — and invisible feels like "maybe I don't need this."
- TestFlight 90-day expiry creates a recurring friction event.
- iOS extension settings reset surprisingly often (after iOS updates, restoring from backup, or sometimes apparently at random) — and re-enabling extension permissions for hosts requires going into Safari settings, which is annoying enough to defer.
- The default-allow stance on unknown content (`empty` reason returns `onTopic: true`) means many Shorts that *should* be blurred pass through silently — the user doesn't see the filter "doing something," and concludes it's broken or unnecessary.

**Prevention:**
1. **Build the popup to show daily impact, not just current state.** "47 Shorts blurred today, 19 minutes of scroll prevented" is motivating. "Currently enabled" is forgettable.
2. **Set the install-refresh calendar reminder (Pitfall 1) and treat it as a scheduled task.**
3. **Re-validate the tool's value at every milestone** — `PROJECT.md:108` already has this as part of the GSD workflow. Honestly answer: "Am I using this? Has it changed my Shorts scrolling?" If no after 2 weeks of working install, the project's done — declare it learning, move on. Don't keep building features for a tool you won't use.
4. **Don't ship features speculatively.** The roadmap should be: install → embeddings → calibrate against real personal usage → maybe more. NOT: install → embeddings → multi-device sync → topic export → hard-block mode → daily quota. `PROJECT.md` "Out of Scope" is already aggressive here; keep it that way.
5. **Make the install repeatable for *yourself*** — write the `docs/install-ios.md` as a script you could hand to past-you who has never opened Xcode. If you can't follow it cold, future-you won't.

**Warning signs:**
- You haven't opened the popup in a week.
- The popup's blurred count is in single digits per day after the first week.
- You catch yourself thinking "let me just disable the filter to see this one Short" more than once a week.
- Your TestFlight expiry passes and you don't immediately refresh.

**Phase to address:** **Phase 3 (Validation) and watch throughout. Especially: every milestone-complete review.**

**Severity: HIGH (this is the *project's* failure mode by definition — `PROJECT.md:13` says "if everything else fails, this must work")**

---

## Minor Pitfalls

### Pitfall 11: Overengineering for a hypothetical user base

**What goes wrong:**
You start adding multi-language transcript support, topic-sharing exports, sync-across-devices, A/B threshold testing — because the architecture "should" support them. Each is 1–2 days of work. None get used. Meanwhile mobile DOM selectors are out of date.

**Why it happens:** Developer reflex. Building features is more fun than tuning thresholds.

**Prevention:** `PROJECT.md` "Out of Scope" is the contract. When tempted, re-read lines 44–53. The list of "personal-tool things to NOT build" is correct.

**Phase to address:** Watch throughout. Every phase review checks against Out of Scope.

**Severity: MEDIUM**

---

### Pitfall 12: Instagram caption-only classifier becomes worthless when topics need transcript signal

**What goes wrong:**
v0.2 ships transcripts for YouTube and the embedding tier is great. Then user scrolls Instagram Reels. The classifier has only the caption to work from (per `PROJECT.md:46` — no IG transcripts). The embedding signal on captions ("✨ vibes ✨ #fyp") is uniformly weak. Either: (a) the Instagram tier silently degrades to allowing nearly everything (false-negative-heavy), or (b) it produces noisy embeddings off short captions and blurs randomly.

**Why it happens:** Instagram Reels captions are stylized, often emoji-heavy, often unrelated to video content. The signal-to-noise is materially worse than YouTube titles, let alone transcripts.

**Prevention:**
1. Accept that Instagram is keyword-tier-only for v0.2. Don't run the embedding tier on Instagram captions; the cost-benefit isn't there.
2. Document this in `PROJECT.md` decisions if it ends up being the v0.2 outcome.
3. Don't let Instagram's weaker signal contaminate your sense of whether the YouTube tier is working — measure them separately in the popup stats.

**Phase to address:** Phase 3 (Classification tuning).

**Severity: LOW-MEDIUM**

---

### Pitfall 13: Existing v0.1 fragility compounds with v0.2 additions

**What goes wrong:**
`CONCERNS.md` already flags `content/instagram.js` as CRITICAL, MutationObserver as HIGH, daily stats roll as HIGH. v0.2 adds:
- New code paths that go through the service worker (transcript caching, embedding cache) → multiplies the SW-suspended risk surface (`CONCERNS.md` HIGH).
- New per-card async work (transcript fetch, embedding inference) inside the MutationObserver/scan path → multiplies the per-scan cost (`CONCERNS.md` HIGH).
- New storage keys (transcript cache, embedding cache, calibration log) → multiplies the "settings schema duplicated across 4 files" problem (`CONCERNS.md` MEDIUM).
- New event-listener registrations (model load complete) → multiplies the `ss:settings-changed` stringly-typed pub-sub problem (`CONCERNS.md` HIGH).

**Prevention:** Read `CONCERNS.md` before each phase and check whether the planned changes make any of those concerns materially worse. If yes, fix the concern *first* (or schedule the fix in the same phase).

**Phase to address:** Watch throughout. Specifically: before starting Phase 2 (mobile DOM + embeddings), do a 1-hour review of `CONCERNS.md` and decide which existing concerns must be addressed in Phase 2 vs deferred.

**Severity: MEDIUM (severity of the underlying v0.1 concerns is already documented; this is about not making them worse)**

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: iOS install path spike | Pitfall 1 (Xcode rabbit hole) | Time-box to 2 days; pay the $99; document the install in `docs/install-ios.md` |
| Phase 1: iOS install path spike | Pitfall 8 (bundle size) | Measure base bundle size with v0.1 code only — establish the baseline before adding embeddings |
| Phase 2: Mobile DOM port | Pitfall 6 (selector divergence) | Test on real iPhone Orion against `m.youtube.com` AND `youtube.com` |
| Phase 2: Mobile DOM port | Pitfall 7 (gesture conflicts) | Scroll-session testing on iPhone, not single-Short testing |
| Phase 2: Embedding feasibility | Pitfall 2 (model loads in iOS sandbox) | Stub `pipeline()` returning one embedding on iPhone — gate before anything else |
| Phase 2: Embedding feasibility | Pitfall 3 (SW death) | Move all stateful work to content script + `chrome.storage.local` |
| Phase 2: Embedding feasibility | Pitfall 8 (bundle size) | Strip unused ONNX WASM variants; measure final `.ipa` size |
| Phase 2: Embedding feasibility | Pitfall 9 (cold-start jank) | Pre-warm `pipeline()` on content-script load, not on first call |
| Phase 3: Transcript integration | Pitfall 5 (transcript fetch unreliability) | Cache forever; 1.5s timeout; fallback to keyword tier; never block on transcript |
| Phase 3: Classification tuning | Pitfall 4 (threshold death) | Per-topic thresholds; calibration log from day 1; soft zone visual; cache decisions per video ID |
| Phase 3: Classification tuning | Pitfall 12 (IG caption-only) | Don't run embeddings on IG; keep keyword tier only there |
| Validation / milestone close | Pitfall 10 (built but unused) | Honestly answer "am I using this?" — kill the project if no |
| Watch throughout | Pitfall 11 (overengineering) | Out-of-Scope list in `PROJECT.md` is the contract |
| Watch throughout | Pitfall 13 (v0.1 fragility compounding) | Re-read `CONCERNS.md` before each phase |

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| No automated tests for embedding tier (continues v0.1 posture) | Faster shipping of v0.2 | Embedding regressions silent; threshold changes can't be validated; selector edits already flagged HIGH in `CONCERNS.md` | Acceptable through v0.2 *only if* a calibration log captures real decisions for after-the-fact validation. Stop being acceptable when adding a third site (per `CONCERNS.md` deferred recommendations). |
| CDN fetch of model on first use (vs bundled) | Smaller initial extension bundle | iOS Safari Web Extension may block; offline use breaks; CDN is a runtime dependency for a tool that brags about "no backend" | **Never acceptable for this project.** Bundle the model. |
| Single global threshold for embeddings | Simpler options UI; one knob | Pitfall 4 (threshold death) | Acceptable for v0.2 first ship; commit to per-topic thresholds before adding a 3rd topic |
| Service worker holding embedding cache | Centralized cache | Pitfall 3 (SW death loses cache); needs cold reload | **Never** — use `chrome.storage.local` |
| Re-using v0.1's escape-by-convention `innerHTML` for new overlay states | Faster; matches existing code | `CONCERNS.md` MEDIUM already flags this; new states are new XSS surfaces | Acceptable to defer until a refactor pass; not acceptable to *add* new `innerHTML` template strings during v0.2 |
| Skipping `host_permissions` for `m.youtube.com` (assuming wildcard covers it) | One less manifest line | Pitfall 6 — silent failure on mobile | Never acceptable. Add it explicitly. |
| Ignoring TestFlight 90-day expiry until first failure | One less calendar reminder | Pitfall 1 — extension dies, project momentum dies | Never acceptable for a project where the iPhone IS the primary runtime |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| YouTube `/api/timedtext` | Treating it as a stable API | Treat as scraped contract; cache aggressively; have keyword fallback; smoke-test on each YouTube refresh |
| `ytInitialPlayerResponse.captions` | Assuming the key path is stable (`playerCaptionsTracklistRenderer` has flipped names historically) | Defensive optional-chaining; log when shape is unexpected; multiple fallback paths |
| Transformers.js `pipeline()` | Lazy-loading on first classification call | Pre-warm on content-script init; gate UI on warm-up status |
| Transformers.js v3 on iOS | Using latest version per blog post | Pin to v2.x until [#1242](https://github.com/huggingface/transformers.js/issues/1242) is resolved on target iOS version |
| ONNX Runtime WASM | Bundling all WASM variants | Strip unused variants from bundle |
| `chrome.storage.sync` | Using it for caches | Use `chrome.storage.local` — sync has 8KB/item quota and is irrelevant for single-user |
| iOS Safari Web Extension `chrome.runtime.sendMessage` | Awaiting the response on the blur critical path | Fire-and-forget with try/catch; never block UI on SW |
| Safari Web Extension host permissions | Assuming MV3 manifest patterns from Chrome map 1:1 | Verify each permission on real iPhone Orion; Safari is stricter |
| Xcode + Safari Web Extension AppGroup | Forgetting to configure the AppGroup → app can't read extension storage | Use the template's default AppGroup; document the identifier in `docs/install-ios.md` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Embedding inference on every visible card synchronously | iPhone gets warm; scroll stutters | Tier through keyword first; embed only when keyword is inconclusive | Immediately on dense Shorts feeds (10+ visible cards) |
| Model loaded twice (SW + content script) | 2x memory; iOS kills extension | Load only in content script; SW is router only | First sustained scroll session on iPhone |
| Re-classifying same video ID per scan | CPU saturated by repeat work | Cache decisions by video ID in `chrome.storage.local` | Within 5 minutes of opening a YouTube tab — scroll-back patterns reveal it instantly |
| `backdrop-filter: blur(20px)` on multiple overlays during scroll | Jank on iPhone 12 mini and earlier | Reduce blur radius on mobile, or use solid frosted background | First test on iPhone hardware (won't show in Simulator) |
| MutationObserver firing transcript fetches per mutation | Network panel floods with `/api/timedtext` requests; rate-limit triggered | Already-debounced in v0.1; ensure transcript fetch is downstream of the debounced scan, not raw observer | First long YouTube session — within 5 minutes |
| WASM heap growth across session | Memory monotonically climbing in Safari Web Inspector | Free intermediate tensors; explicit `model.dispose()` between batches if API supports; cap embedding cache size | After ~50–100 classifications in a single session |

---

## Security Mistakes

(Most are inherited from v0.1 and documented in `CONCERNS.md`. v0.2-specific additions below.)

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bundling the model from CDN at runtime | Supply-chain risk; CDN could serve modified model; CSP/connect-src tightening could break it | Bundle the model file inside the extension; verify file hash at build time |
| Logging full transcripts to calibration log | Privacy leak if `chrome.storage.local` is ever exfiltrated or synced | Log transcript excerpts (first 200 chars) + cosine score, not full transcripts |
| Treating extension storage as private to iOS Safari | iOS extension storage is sandboxed but is included in iCloud backups by default | Don't store anything in extension storage you wouldn't want in an unencrypted iCloud backup |
| Trusting transcript content for HTML rendering | Transcripts can contain crafted strings if shown in overlay | Use `textContent` not `innerHTML` (already a `CONCERNS.md` MEDIUM); applies to any new overlay element |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Filter appears "off" for first 5–10s of session (cold start) | User thinks extension is broken; learns to mistrust | Pre-warm; show "(quick filter)" indicator vs "(deep filter active)" |
| Blur flicker — same Short blurred this scan, revealed next, blurred again | Trust destroyed within 2 minutes | Cache decisions per video ID for entire session; never recompute |
| "Show anyway" button too small on iPhone | Mistaps; accidental reveals; frustration | ≥44pt tap target |
| Overlay catches the scroll gesture | Can't scroll past blurred Shorts on iPhone | `touch-action: pan-y` on overlay; never `preventDefault()` on touchmove |
| Blur applied to entire Story rail because video is detected | False positive on non-Reel surface ([already noted in `CONCERNS.md` for IG](file:///Users/daurenzhunussov/smartscroller/.planning/codebase/CONCERNS.md)) | Continue accepting for v0.2; document explicitly in popup so user understands |
| Per-render blur of revealed item (`CONCERNS.md` MEDIUM) made worse on Shorts because user scrolls back more often | User clicks "Show anyway" repeatedly on same Short | Consider per-session reveal cache (separate from per-video-ID classification cache) — small TTL allowlist |
| No way to see *why* a Short was blurred | User can't tell if it's a false positive or correct rejection | Overlay shows the matched topic name + (in dev) the cosine score |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces. Run through this before declaring v0.2 milestone complete.

- [ ] **iPhone install:** Extension is installed via Xcode/TestFlight on the actual iPhone, not just "running in iOS Simulator." Verify by physically holding the phone and scrolling.
- [ ] **iPhone install:** TestFlight expiry calendar reminder set for day 75 after upload.
- [ ] **iPhone install:** `docs/install-ios.md` exists and a cold-read execution would succeed.
- [ ] **Mobile DOM:** Tested on `m.youtube.com` AND `youtube.com` (Safari's "Request Desktop Website" can route either way).
- [ ] **Mobile DOM:** Tested on a Shorts page, the home feed, the search results page, AND the watch-page Up Next on iPhone.
- [ ] **Embedding tier:** Model loads on iPhone after a cold app launch (not just after warm reload).
- [ ] **Embedding tier:** First-classification latency measured on iPhone hardware; documented in milestone notes.
- [ ] **Embedding tier:** Memory measured during a 100-Short scroll on iPhone; documented.
- [ ] **Embedding tier:** Graceful fallback to keyword-only tier verified when `pipeline()` rejects (manually break the model URL and confirm filter still functions).
- [ ] **Transcript fetch:** 1.5s timeout enforced and tested (artificially delay the fetch and verify the keyword tier handles it).
- [ ] **Transcript fetch:** Cache by video ID — same Short scrolled past twice doesn't re-fetch (verified in Network panel).
- [ ] **Transcript fetch:** Works on a Short whose channel is in a region different from the iPhone's region setting.
- [ ] **Service worker:** Extension still functions after the SW has clearly been killed (let it idle for 10+ minutes, then test).
- [ ] **Calibration log:** Stores decisions in `chrome.storage.local`; can be exported for inspection.
- [ ] **Popup stats:** Show blurred count, transcript-fetched count, transcript-failed count, embedding-classified count, keyword-classified count.
- [ ] **Existing v0.1 surfaces:** Still work — desktop YouTube/Instagram blurring not regressed by mobile additions. Re-run the manual smoke test from `TESTING.md` sections 2–6.
- [ ] **Touch gestures:** Vertical swipe on a blurred Short still scrolls to the next Short on iPhone.
- [ ] **Touch gestures:** "Show anyway" tap area is ≥44pt and doesn't accidentally fire from a swipe.
- [ ] **You have actually used this for a week.** Not "tested." Used. As your default Shorts scrolling experience.

---

## Recovery Strategies

When pitfalls occur despite prevention.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Pitfall 1 (Install hurdle): Lost weekend on Xcode | MEDIUM | Pivot to macOS-only for the milestone; honestly re-scope `PROJECT.md`; revisit Xcode with a fresh `docs/install-ios.md` from someone else's tutorial |
| Pitfall 1 (Install hurdle): TestFlight expired and extension dead | LOW | 30 minutes: open Xcode, archive, upload via Transporter, refresh on iPhone. The pain is the context-switch, not the steps. |
| Pitfall 2 (Model won't load on iOS) | HIGH | Diagnose: (a) CSP error? (b) File path? (c) Memory? (d) Transformers.js version? — Worst case: drop to a smaller model (e.g. `Xenova/paraphrase-multilingual-MiniLM-L12-v2` distilled further, or a TFLite/CoreML route via a native bridge — significant rework) |
| Pitfall 3 (SW dying) | MEDIUM | Audit every `sendMessage` call; move state to `chrome.storage.local`; add fire-and-forget try/catch; consider abandoning the SW entirely for v0.2 functions if iOS makes it unreliable |
| Pitfall 4 (Threshold death) | LOW-MEDIUM | Stop tweaking; collect 50 real decisions in calibration log; data-drive the threshold from observed false-positive/false-negative ratios; commit to per-topic thresholds |
| Pitfall 5 (Transcript fetch broken by YouTube) | MEDIUM | Inspect `ytInitialPlayerResponse` structure on the current YouTube version; find new path; update fetch logic; document new contract in `SELECTORS.md` |
| Pitfall 6 (Mobile selectors broken) | LOW | Add new `ytm-*` variants to the existing selector list; ship. Don't refactor on a regression. |
| Pitfall 7 (Gesture conflicts) | LOW | CSS tweaks: `touch-action`, `pointer-events`, larger tap targets. ~30 min iteration cycle on real iPhone. |
| Pitfall 9 (Cold-start jank) | LOW | Move `pipeline()` call to content-script top-level; verify pre-warm completes before first user interaction |
| Pitfall 10 (Built but unused) | HIGH (project-existential) | Stop. Honestly evaluate. Possibly declare project complete-with-learnings and move on. Don't keep building. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Pitfall 1 (Install hurdle) | **Phase 1** | Extension v0.1 (no new features) running on real iPhone via Xcode/TestFlight; install doc exists |
| Pitfall 2 (Model load in iOS sandbox) | **Phase 2** | Stub `pipeline()` returns embedding on iPhone; memory measured during scroll |
| Pitfall 3 (SW death) | **Phase 2** + watch throughout | No state in SW; `sendMessage` is fire-and-forget; extension still works after SW idle-kill |
| Pitfall 4 (Threshold death) | **Phase 3** | Calibration log captures decisions; per-topic thresholds available; soft zone visual implemented |
| Pitfall 5 (Transcript unreliability) | **Phase 3** | 1.5s timeout enforced; cache works; keyword fallback verified by breaking transcript URL |
| Pitfall 6 (Mobile selector divergence) | **Phase 2** | Selectors tested on `m.youtube.com` AND `youtube.com`; `SELECTORS.md` exists |
| Pitfall 7 (Gesture conflicts) | **Phase 2** | Scroll-session test on iPhone; 44pt tap targets; `touch-action: pan-y` |
| Pitfall 8 (Bundle size) | **Phase 2** | Final `.ipa` size <50MB; bundle composition documented |
| Pitfall 9 (Cold-start jank) | **Phase 2** | Pre-warm on content-script load; cold-start latency measured |
| Pitfall 10 (Built but unused) | **Phase 3** + every milestone close | Weekly self-check; honest re-scope at milestone boundaries |
| Pitfall 11 (Overengineering) | Watch throughout | Out-of-Scope check at each phase review |
| Pitfall 12 (IG caption-only weakness) | **Phase 3** | IG metrics tracked separately; embedding tier disabled for IG |
| Pitfall 13 (v0.1 fragility compounding) | Watch throughout | `CONCERNS.md` re-read before each phase; new code doesn't worsen documented HIGHs |

---

## Sources

**Verified (HIGH confidence — official documentation or issue trackers):**
- [Apple: Optimizing your web extension for Safari](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)
- [Apple: Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
- [Apple Developer Forums #758346: Safari Extension Service Worker Permanently Killed on iOS](https://developer.apple.com/forums/thread/758346)
- [Apple Developer Forums #721222: Service worker is killed when Device memory usage](https://developer.apple.com/forums/thread/721222)
- [Apple Developer Forums #687642: iOS Safari Extension Memory Limit](https://developer.apple.com/forums/thread/687642)
- [WebKit Bug 211018: iOS PWAs using Service Workers freeze after being backgrounded](https://bugs.webkit.org/show_bug.cgi?id=211018)
- [huggingface/transformers.js#1242: v3 crashes on iOS due to increasing memory](https://github.com/huggingface/transformers.js/issues/1242)
- [huggingface/transformers.js#953: Out of memory in WASM backend](https://github.com/huggingface/transformers.js/issues/953)
- [Transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/guides/webgpu)
- [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [YouTube Help: Use automatic captioning](https://support.google.com/youtube/answer/6373554)

**MEDIUM confidence (WebSearch findings, multiple corroborating sources):**
- [SitePoint: WebGPU vs WASM browser inference benchmarks](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)
- [Medium / Marcelo Emmerich: WebGPU bugs holding back browser AI](https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca)
- [ActivePieces forum: YouTube scraper broken](https://community.activepieces.com/t/youtube-scraper-broken/5245)
- [Scrapfly: How to Scrape YouTube (2026)](https://scrapfly.io/blog/posts/how-to-scrape-youtube)
- [arxiv.org/html/2509.15292v1: Semantic similarity threshold tuning with MiniLM](https://arxiv.org/html/2509.15292v1)
- [GitHub: youtube_shorts_remover_tampermonkey](https://github.com/Aksor9/youtube_shorts_remover_tampermonkey) (mobile vs desktop selector patterns)
- [Apple TestFlight: 90-day expiration notice (LoopKit GitHub issue)](https://github.com/LoopKit/Loop/issues/1881)
- [Why No TestFlight: Getting started with Safari Web Extensions](https://www.whynotestflight.com/excuses/getting-started-with-safari-web-extensions/)

**Project-internal sources:**
- `/Users/daurenzhunussov/smartscroller/.planning/PROJECT.md`
- `/Users/daurenzhunussov/smartscroller/.planning/codebase/CONCERNS.md`
- `/Users/daurenzhunussov/smartscroller/.planning/codebase/TESTING.md`

**LOW confidence (inference from project context, no direct citation):**
- Pitfall 10 ("built but unused") behavioral pattern — common in personal-tool literature but not domain-specifically cited
- Pitfall 11 (overengineering) — author's own discipline question, not external research
- Specific cold-start latency numbers (3–8s) — extrapolated from Transformers.js benchmarks, not measured on iPhone Orion

---
*Pitfalls research for: personal browser extension with transcripts + on-device embeddings on iOS Safari Web Extension*
*Researched: 2026-05-15*
