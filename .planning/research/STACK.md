# Stack Research

**Domain:** Personal browser extension (iOS Orion + desktop) — short-form video classification using YouTube transcripts and on-device semantic embeddings
**Researched:** 2026-05-15
**Confidence:** HIGH for runtime/ML library choices; MEDIUM for the Orion iOS install path (Orion-specific docs are sparse and the team's "preliminary support" disclaimer applies)

**Scope note.** v0.1 already ships a working MV3 scaffold (manifest, content scripts, options/popup, `chrome.storage`, MutationObserver loop). This document does **not** re-recommend any of that. It recommends the **net-new stack** required to take v0.1 from "desktop keyword extension" to "iPhone Orion + transcripts + local semantic classification": the install pipeline, the ML stack, the transcript fetch path, and the mobile YouTube selector contract. The v0.1 stack itself is documented at `.planning/codebase/STACK.md`.

---

## Recommended Stack

### Core Technologies (additions to v0.1)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **`@huggingface/transformers`** | **4.2.0** (current as of 2026-05-15) | On-device sentence embeddings via ONNX Runtime Web | Only mature JS library that runs transformer-class embedding models in a browser/extension context with both WebGPU and WASM backends. Pure JS bundle works inside an MV3 content script context. **Use `@huggingface/transformers`, not the older `@xenova/transformers` (v2)** — `@xenova/transformers` is the deprecated package name. The org moved to `@huggingface/transformers` at v3, and v4 (March 2026 GA) brought a C++-rewritten WebGPU runtime tested across ~200 architectures. v4 also dropped `transformers.web.js` size by 53% vs v3, which matters for the iOS bundle budget. **HIGH confidence.** |
| **ONNX Runtime Web (WASM backend)** | bundled with `@huggingface/transformers` | The actual inference engine | Don't install separately — `@huggingface/transformers` pins the right `onnxruntime-web` version. The WASM backend is the **primary** target for this project (see "Stack Patterns by Variant" below for WebGPU rationale). **HIGH confidence.** |
| **Embedding model: `Xenova/all-MiniLM-L6-v2`** | quantized ONNX (`int8` / `q8`) | Encode topic strings and transcripts into a 384-d shared space; cosine-similarity for classification | 22.7M parameters, 6 layers, 384 hidden dims. Quantized ONNX weights ship at **~23 MB total** (model + tokenizer + config), fits inside the 30 MB iOS bundle budget called out in `PROJECT.md` line 81. English-only; trained on 1B sentence pairs; ranks well on STS benchmarks for its size. Already named as the v1.0 target in `PROJECT.md` line 37 and `README.md` lines 68–76. **HIGH confidence.** |
| **Embedding model upgrade path: `Xenova/multilingual-e5-small`** | quantized ONNX (`q8`) | Multilingual fallback if user starts watching non-English content | 118M parameters, 384-d output (same dimension as MiniLM — can be hot-swapped without changing the cosine code). Quantized at **~120 MB** — exceeds the iOS budget. **Defer until a real need surfaces.** For a single-user English-speaking author per `PROJECT.md`, MiniLM is sufficient. **MEDIUM confidence** (no need to commit until used). |
| **InnerTube `/youtubei/v1/player` API** | n/a (HTTP endpoint) | Fetch caption-track metadata for a YouTube video ID | The most reliable transcript-fetch path as of 2026. The old "scrape `ytInitialPlayerResponse` from the page HTML" approach still works for desktop watch pages but is unreliable for Shorts (`m.youtube.com` / iOS Safari often serves a different player payload) and broke for several maintained libraries in late 2025 / early 2026. The `/youtubei/v1/player` endpoint accepts a JSON POST with `{ videoId, context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", ... } } }` and returns `captions.playerCaptionsTracklistRenderer.captionTracks[]` with a `baseUrl` per language. **MEDIUM-HIGH confidence** — confirmed by multiple 2026 sources (RankStudio, Medium guides). |
| **Caption format: `&fmt=json3`** | n/a | Append to each `captionTrack.baseUrl` before `fetch()` | Returns `{ events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }` — easier to flatten than XML and stable across YouTube's caption infrastructure. **HIGH confidence.** |

### Supporting Libraries (additions)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **`esbuild`** | latest (0.24.x as of May 2026) | Single-file bundle the Transformers.js IIFE for content-script injection | Once Transformers.js enters the project, the zero-build constraint in `PROJECT.md` line 82 has to relax for *one* file. `esbuild` is the minimum-viable bundler — single binary, no config, no Babel, produces an IIFE. **Don't** use Webpack/Rollup/Vite/Plasmo here — they add toolchain weight without solving anything Transformers.js needs. **HIGH confidence.** |
| **`vitest` + `@vitest/web-worker` + `jsdom`** | latest | Test the pure functions in `classifier.js` and metadata extractors against snapshot HTML fixtures | `CONCERNS.md` lines 37–46 calls out the missing test surface as CRITICAL. The classifier is now provably untestable when it depends on Transformers.js (worker boundary). Vitest with `jsdom` covers the keyword tier and metadata extraction; the embedding tier itself stays smoke-tested. **HIGH confidence.** |
| **`web-ext` (Mozilla)** | latest | Lint/sign/zip the extension for distribution (Firefox-side) | Not strictly required for personal Orion install, but cheap insurance: catches manifest issues, produces signed `.xpi` for Firefox Mobile if that ever becomes a fallback. **LOW priority.** |

### No additional core dependencies

Everything else stays at v0.1's "zero npm deps, plain DOM, `globalThis.browser ?? globalThis.chrome`" baseline documented in `.planning/codebase/STACK.md`. Resist the urge to introduce React/Lit/Preact for the options page or a state manager — `options.js` works fine as-is.

### Development Tools (additions)

| Tool | Purpose | Notes |
|------|---------|-------|
| **`esbuild`** | Bundle `@huggingface/transformers` into one file per content script | Command: `esbuild content/embedder.entry.js --bundle --format=iife --target=es2020 --outfile=content/embedder.bundle.js`. Output gets referenced as a content_script in `manifest.json`. |
| **`vitest`** | Run pure-function and snapshot tests | Add a `package.json` with `"test": "vitest"`. Keep `node_modules` out of the bundled extension via `.web-ext-include` or a small `dist/` step. |
| **`biome`** | One-tool lint+format | `CONCERNS.md` line 54 recommends this. ~5-minute config; replaces ESLint+Prettier for a project of this size. |
| **Chrome Web Store developer account** | **One-time $5 USD fee** | **This is the install pipeline for iOS Orion** — see "Stack Patterns by Variant" below. The dashboard supports an "Unlisted" visibility setting; the extension never appears in public search results, but the install URL works for the author's Orion iOS install. |

---

## Installation

Once a `package.json` exists:

```bash
# Core ML stack
npm install @huggingface/transformers@^4.2.0

# Bundler (the one exception to "no build step")
npm install -D esbuild

# Tests + tooling
npm install -D vitest jsdom @vitest/web-worker
npm install -D @biomejs/biome

# Optional: distribution-side helpers
npm install -D web-ext
```

**Build command** (single line, no config file needed):

```bash
npx esbuild content/embedder.entry.js \
  --bundle --format=iife --target=es2020 --platform=browser \
  --outfile=content/embedder.bundle.js
```

**Model download.** Don't `npm install` the model weights. At first use, Transformers.js fetches them from `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/...` and caches them in IndexedDB. This means **`host_permissions` must include `https://huggingface.co/*` and `https://cdn-lfs.huggingface.co/*`** (the latter is where actual ONNX bytes are served). Add these to `manifest.json` alongside the existing YouTube and Instagram hosts.

**Alternative: ship the model in the extension bundle.** Possible but inadvisable for v1.0 — adds ~23 MB to every extension update, and iOS extension updates require re-review. Stay with on-first-use fetch + IndexedDB cache.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@huggingface/transformers` v4 | `@xenova/transformers` v2.x | Never — the package was renamed and v2 lacks WebGPU support and recent ONNX Runtime fixes. Any "use @xenova/transformers" Stack Overflow answer from 2024 is stale. |
| `Xenova/all-MiniLM-L6-v2` (int8) | `Xenova/bge-small-en-v1.5` (int8) | BGE-small is ~50 MB quantized and scores slightly better on retrieval benchmarks. Use only if MiniLM proves inadequate on real Shorts — unlikely for this domain (single user, ~5 topics, short transcripts). |
| `Xenova/all-MiniLM-L6-v2` (int8) | `Xenova/all-MiniLM-L6-v2` (fp16/fp32) | fp16 doubles size to ~46 MB, fp32 quadruples it to ~90 MB. Quality gain is marginal for cosine similarity at this dimensionality. Stay with int8 unless you measure misclassification specifically attributable to quantization. |
| InnerTube `/youtubei/v1/player` | Scrape `ytInitialPlayerResponse` regex from page HTML | The page-scrape path still works on desktop `youtube.com/watch?v=...` and `youtube.com/shorts/...`. Prefer it as the **first** attempt (zero extra request, no auth headers) — it's already in the SPA you're scrolling. **Fall back to InnerTube only if the page-embedded payload lacks `captionTracks`** (which happens on some mobile responses). Document this as a two-tier fetcher. |
| InnerTube `/youtubei/v1/player` | `youtube-transcript` npm package (1.3.x) | Tempting but the package bundles `node-fetch` polyfills and was last fixed under YouTube's pre-Innertube-hardening era. CORS blocks direct browser use anyway. **Don't ship it.** Roll a ~80-line fetcher tailored to the extension's host-permission model. |
| `esbuild` | Webpack / Rollup / Vite / Plasmo / WXT | All overkill for "bundle one library into one IIFE". `esbuild` has no config requirement; the others all introduce a config surface. Plasmo and WXT specifically target full-scaffold extensions, which is the opposite of v0.1's grown-up vanilla scaffold. |
| Chrome Web Store (unlisted) for Orion iOS install | Safari App Extension wrapped via Xcode + TestFlight | Apple's 2025 update **did** add a no-Xcode path (upload ZIP → App Store Connect → TestFlight), but it still requires a $99/year Apple Developer Program membership and 7-day TestFlight token rotation. **Not viable for a $0-ongoing personal tool.** Chrome Web Store unlisted is one $5 lifetime fee and produces an install URL Orion iOS accepts. |
| Chrome Web Store (unlisted) | Firefox Add-ons (AMO) unlisted / self-signed | Mozilla signs unlisted XPIs for free — appealing for cost. But **Orion iOS prefers Chrome-side extensions for the YouTube/Instagram class of DOM-mutating content scripts** (Firefox-format support on Orion iOS is shallower per Kagi docs and the `crxjs/chrome-extension-tools#887` bug). Keep AMO as a backup distribution if CWS ever ejects the listing. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Whisper / `whisper.cpp` / `Xenova/whisper-tiny`** in-browser | 39M params at fp16 ≈ 78 MB. Inference on iPhone WASM is multiple seconds per Short. We already get transcripts from YouTube's caption pipeline — no need to re-ASR audio. Defer audio-side ASR forever. | YouTube `timedtext`/InnerTube fetch. ASR is a non-goal per `PROJECT.md` line 45. |
| **Cloud LLM APIs** (OpenAI, Anthropic, Gemini) for classification | Explicitly out of scope (`PROJECT.md` line 44). $0 constraint. Privacy constraint. | Local MiniLM embeddings + cosine. |
| **Local LLM via Ollama / `webllm` / `mlc-llm`** | `webllm` runs in-browser but needs WebGPU + multi-GB models. Doesn't fit the 30 MB budget or the iPhone runtime envelope. Already vetoed in `PROJECT.md` line 46. | Sentence embeddings — the right tool for "does this text match this topic". |
| **`@xenova/transformers` v2.x** (the old npm name) | Deprecated namespace. v2 lacks WebGPU, lacks the v4 ONNX Runtime improvements, lacks the int8 quantization story. Search results dated 2024 will tell you to use this — those are stale. | `@huggingface/transformers` v4. |
| **TensorFlow.js + Universal Sentence Encoder** | TF.js is ~800 KB just for the runtime; USE-lite is ~25 MB but lower-quality than MiniLM at the same dimensionality. The ecosystem moved on; new sentence-embedding work all targets ONNX. | `@huggingface/transformers` + MiniLM. |
| **`youtube-transcript` (npm, v1.3.x)** | Browser-incompatible in practice (CORS, fetch polyfills); last meaningful update predates the late-2025 YouTube hardening that broke ~half the scrapers. | Roll a ~80-line fetcher: try page-embedded `ytInitialPlayerResponse` first, fall back to `/youtubei/v1/player` POST with an Android client context. |
| **Safari App Extension (.appex) wrapping via Xcode** | Requires $99/year Apple Developer Program. TestFlight builds expire every 90 days and require Mac-side rebuilds. Both are friction for a single-user tool. | Chrome Web Store unlisted listing. Orion iOS installs it. |
| **`.crx` sideload / "load unpacked" on iOS Orion** | **Does not exist on Orion iOS.** Confirmed by Kagi docs (which only mention installing from Chrome/Firefox stores) and by the open Orion feedback thread `orionfeedback.org/d/4209`. Desktop-only feature. | Chrome Web Store unlisted listing as the install transport. |
| **CRXJS-based build tools** | Open issue `crxjs/chrome-extension-tools#887`: CRXJS-built extensions install on Orion iOS but **don't run** — service worker startup silently fails. Closed as "not planned." | Plain manifest + esbuild for the one library that needs bundling. Stay closer to vanilla. |
| **`MutationObserver` rooted at `document.body`** in the YouTube/Instagram content scripts (carry-over from v0.1) | `CONCERNS.md` lines 162–177 flags this as the #1 perf-hot-path. On a busy YouTube feed it fires hundreds of times per second. Pre-Transformers.js this was a debounce-only concern; with embeddings firing in a worker, the per-tick cost compounds. | Narrow the observer root once `ytm-app` / `ytd-app` is found. Filter mutation records before debouncing. Not a new dependency — a code change. |

---

## Stack Patterns by Variant

### Primary platform: iPhone Orion (iOS 18+)

**Install path:**
1. Pay the **$5 one-time Chrome Web Store registration fee** (`https://chrome.google.com/u/0/webstore/devconsole`).
2. Upload the SmartScroller zip as a new extension with visibility **Unlisted**.
3. Wait for Google's review (typically 1–3 business days for an extension with no remote code execution and minimal permissions — SmartScroller qualifies).
4. Once approved, the listing has a stable Chrome Web Store URL. On the iPhone: Orion → **Menu → Settings → Advanced → enable Chrome Extensions → Menu → Extensions → + → Install Chrome Extension** → paste the listing URL.
5. Orion downloads the extension, wraps it through its WebExtensions compatibility shim on top of WebKit, and registers it.

**Confidence: MEDIUM.** Kagi docs confirm one-click install from `chrome.google.com/webstore/...` works. The "unlisted" path is inferred from the documented "one-click from Chrome extension website" mechanism; an unlisted extension is still served from the same domain. **Validate this end-to-end as the first thing in v1.0 — if it fails, the whole milestone is blocked and you fall back to either (a) the Mozilla AMO unlisted route, or (b) self-hosted XPI for Orion Firefox-side. The CWS approach must be smoke-tested before any other v1.0 work.**

**WebGPU on iOS Orion:**
- Safari 26 (shipped September 2025, current as of May 2026) **enabled WebGPU by default on iOS 26+**. Orion iOS runs on WebKit and inherits this.
- BUT: WebGPU inside an MV3 service worker on iOS is **not** something Apple, Kagi, or the Transformers.js team have validated. The Chromium-side `onnxruntime`/`transformers.js` issues #787 and #20876 document the *desktop* equivalent fight; on iOS this is uncharted.
- **Default to WASM**, opportunistically check for WebGPU and prefer it if available. Pseudo-code:
  ```js
  const device = (typeof navigator !== 'undefined' && navigator.gpu)
    ? 'webgpu' : 'wasm';
  const extractor = await pipeline('feature-extraction',
    'Xenova/all-MiniLM-L6-v2', { device, dtype: 'q8' });
  ```
- Expect WASM SIMD performance to land around **15–40 ms per embedding** on iPhone 14/15/16-class hardware. For a single Short with a 30-second transcript (~6 sentences), that's <250 ms — well under the "blur before the user finishes scrolling" budget. **MEDIUM confidence** on the iPhone-specific numbers; benchmarks above are extrapolated from M2 desktop numbers and Apple Silicon WASM-SIMD parity claims.

**MV3 features that are *restricted* on iOS Safari Web Extension runtime** (Orion inherits these):
- `chrome.offscreen` — **not implemented.** This is a problem: the recommended Chromium pattern is "run heavy model code in an offscreen document because service workers can't keep WebGPU/WASM alive." On iOS you can't do that. Mitigation: **run the embedder inside the YouTube/Instagram content script itself**, not the service worker. The content script is long-lived as long as the tab is open, which is exactly when classification matters.
- `chrome.scripting.executeScript({ world: 'MAIN' })` — partial support; verify before relying on it for `ytInitialPlayerResponse` extraction.
- `chrome.declarativeNetRequest` — Apple-restricted scope; not needed for this project.
- Service worker `wake-on-event` semantics differ from Chrome — assume the SW may be unavailable for long stretches. Already handled by the existing "context gone" try/catch in `content/classifier.js`.

### Secondary platform: Desktop Orion (macOS) / Chrome / Brave (development)

**Install path:** "Load unpacked" from `chrome://extensions` with developer mode enabled. Same `dist/` folder that gets zipped for CWS. **Unchanged from v0.1.**

**Runtime differences from iOS:**
- WebGPU works in Chromium-based desktop browsers for several years. Set `device: 'webgpu'` and the model will run on the integrated/discrete GPU.
- `chrome.offscreen` is available — could move embedder there for cleaner architecture. **Don't.** Keep the architecture identical to iOS so there's one code path to debug. The cost on desktop is negligible.

### Tertiary platform: Firefox / Firefox Mobile (fallback only)

**If CWS install on Orion iOS fails reviews or gets ejected**, fall back to AMO unlisted XPI. Requires the v0.1-documented `service_worker` → `background.scripts` manifest swap. Transformers.js works in Firefox; the swap doesn't affect the ML stack. **Don't pre-build this — keep it as the documented escape hatch.**

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@huggingface/transformers@^4.2.0` | `Xenova/all-MiniLM-L6-v2` ONNX weights as of mid-2025 | The model card was published before v4 but uses the v3-compatible op set; v4 reads it. **HIGH confidence.** |
| `@huggingface/transformers@^4.2.0` | ONNX Runtime Web (bundled) | Don't pin a separate `onnxruntime-web` version — let `@huggingface/transformers` resolve it. The library was rewritten in v4 to use a single coherent ORT version. |
| `esbuild@^0.24` | `@huggingface/transformers@^4.2.0` IIFE bundle | Set `--target=es2020` (or newer). Don't go below — Transformers.js uses dynamic import for tokenizer JSON loading; older targets force transpilation that breaks WASM URL resolution. |
| Manifest V3 `host_permissions` | `https://huggingface.co/*` + `https://cdn-lfs.huggingface.co/*` | Both are required at first model fetch. Document this in the install README so the user understands why Orion shows the permission. |
| `chrome.storage.sync` 100KB quota | MiniLM model | Model weights go to IndexedDB (Transformers.js default `env.cacheDir`), not `storage.sync`. No quota impact on settings. **HIGH confidence.** |
| iOS Safari 26+ / Orion iOS (current) | WebGPU API | Available, enabled by default. But unverified inside an extension content-script context — prefer WASM with WebGPU as an optimistic upgrade. **MEDIUM confidence.** |

---

## Architectural sketch (where the new pieces land)

```
content/
  classifier.js               (v0.1: keyword tier, unchanged)
  embedder.entry.js           (NEW: imports @huggingface/transformers,
                                    exposes globalThis.SmartScroller.embed)
  embedder.bundle.js          (NEW: esbuild output, listed in manifest.json
                                    after classifier.js, before youtube.js)
  transcript-fetcher.js       (NEW: ytInitialPlayerResponse first, then
                                    /youtubei/v1/player fallback;
                                    cache by videoId in chrome.storage.local)
  youtube.js                  (v0.1: extend extractFeedMeta/extractShortMeta
                                    to also call transcript-fetcher +
                                    SmartScroller.classify(meta, transcript))
  instagram.js                (v0.1: unchanged - no transcripts available)

manifest.json (delta):
  host_permissions:
    + "https://www.youtube.com/youtubei/*"
    + "https://huggingface.co/*"
    + "https://cdn-lfs.huggingface.co/*"
    + (existing youtube.com, instagram.com)
  content_scripts:
    + "matches": ["*://m.youtube.com/*"]  (mobile DOM port)
    + load embedder.bundle.js after classifier.js
  web_accessible_resources:
    + the WASM files inside @huggingface/transformers (esbuild can
      inline these; recommended for the personal-distribution case)
```

---

## Open questions for downstream phases

1. **CWS-unlisted on iOS Orion has not been validated end-to-end by Kagi docs.** The very first thing v1.0 must do is publish a "hello world" version of SmartScroller as unlisted, prove it installs on the author's iPhone, and only then start building. If it fails, the whole roadmap pivots. (Severity: blocker. `PROJECT.md` line 34 already lists "figure out and document the install path" as Active.)
2. **Mobile YouTube selectors on iOS Safari may differ from `m.youtube.com` on desktop Safari.** Confirmed `ytm-*` element prefix exists on `m.youtube.com` (filter-list ecosystems use it heavily — e.g. `gijsdev/ublock-hide-yt-shorts`). But the iPhone-rendered version sometimes serves the desktop `ytd-*` tree depending on user-agent and the YouTube serving experiment. The mobile DOM port (`PROJECT.md` line 35) must enumerate both `ytm-*` and `ytd-*` selectors. Worth confirming on-device early.
3. **InnerTube client header rotation.** The "ANDROID, 20.10.38" client identity has held since late 2025 but YouTube's anti-scraping team has rotated this twice in the past 18 months. Build the transcript fetcher with a single configurable `CLIENT_CONTEXT` constant so future rotation is a one-line edit, not a hunt.
4. **iOS Safari WebGPU inside an extension content script** — no confirmed test data. Plan to ship with WASM and only enable WebGPU after measuring it works.
5. **What happens to YouTube Shorts that have no captions** (live, music-only, or recently uploaded without auto-captioning yet)? Fall back to the keyword tier on title + channel + hashtags, which is the v0.1 behavior. Don't block scrolling waiting for ASR or any other heroics.

---

## Sources

**HIGH confidence (primary/official, 2025–2026 dated):**
- [Transformers.js v4 release blog (Hugging Face, 2026)](https://huggingface.co/blog/transformersjs-v4) — v4 GA, package name, WebGPU rewrite, bundle size deltas
- [`@huggingface/transformers` on npm](https://www.npmjs.com/package/@huggingface/transformers) — v4.2.0 confirmed current
- [Xenova/all-MiniLM-L6-v2 model card (Hugging Face)](https://huggingface.co/Xenova/all-MiniLM-L6-v2) — 384-d output, ONNX format, quantized weights, install snippet
- [Transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/guides/webgpu) — device flag, fallback semantics
- [WebKit Safari 26 release notes](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/) — WebGPU shipped on iOS 26 default
- [Safari 26.2 release notes (Apple Developer)](https://developer.apple.com/documentation/safari-release-notes/safari-26_2-release-notes) — confirms Dec 2025 ship
- [Kagi Orion iOS Web Extensions docs](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html) — primary source on iOS install paths

**MEDIUM confidence (community/secondary, multi-source agreement):**
- [Extracting YouTube Transcripts with JavaScript (Nidhin's blog, 2025)](https://blog.nidhin.dev/extracting-youtube-transcripts-with-javascript) — ytInitialPlayerResponse regex + json3 fmt parameter
- [Extract YouTube Transcripts Using Innertube API 2025 (Medium)](https://medium.com/@aqib-2/extract-youtube-transcripts-using-innertube-api-2025-javascript-guide-dc417b762f49) — `/youtubei/v1/player` POST schema with ANDROID client context
- [YouTube Transcript Guide (RankStudio, 2026)](https://rankstudio.net/articles/en/get-youtube-transcript-llm-api) — confirms InnerTube as the current canonical path post-2025 hardening
- [Transformers.js in Chrome Extension (Hugging Face blog)](https://huggingface.co/blog/transformersjs-chrome-extension) — MV3 patterns; **note: assumes desktop Chrome `chrome.offscreen`, which iOS Orion lacks**
- [Chrome Web Store registration ($5 one-time fee, 2026)](https://www.extensionradar.com/blog/chrome-web-store-developer-fee-2026) — confirms unchanged $5 fee, unlisted-visibility option
- [WebGPU vs WebASM benchmarks (SitePoint, 2025)](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/) — for small embedding models on Apple Silicon, WASM matches or beats WebGPU at single-inference latency
- [ublock-hide-yt-shorts filter list (gijsdev)](https://github.com/gijsdev/ublock-hide-yt-shorts/blob/master/list.txt) — primary evidence that `ytm-shorts-lockup-view-model` + `ytm-rich-item-renderer` are the canonical mobile YouTube containers

**LOW confidence (single-source / inferential — flagged for validation):**
- iPhone WASM SIMD latency numbers for MiniLM (extrapolated from M2 benchmarks; no published iPhone-specific data for `@huggingface/transformers` v4)
- "Chrome Web Store *unlisted* listing installs on Orion iOS" — Kagi docs only document one-click install from the public CWS pages. Inferred but not explicitly tested. **First v1.0 task should validate this on-device.**
- iOS Safari WebGPU inside an extension content script — works in regular page contexts per Apple, but not verified inside the extension sandbox
- `crxjs/chrome-extension-tools#887` documents Orion iOS service-worker startup quirks — informs the "don't use CRXJS" recommendation but doesn't tell us *why* it fails; treat all SW-heavy patterns as suspect on iOS until measured

---

*Stack research for: SmartScroller v1.0 (iPhone Orion + transcripts + semantic classification)*
*Researched: 2026-05-15*
