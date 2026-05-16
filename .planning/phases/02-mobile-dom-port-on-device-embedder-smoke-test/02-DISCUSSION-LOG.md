# Phase 2 Discussion Log

**Date:** 2026-05-16
**Phase:** 2 — Mobile DOM port + on-device embedder smoke test
**Mode:** default (interactive, 4 areas)

This is the human-readable trace of the `/gsd-discuss-phase 2` session. Not consumed by downstream agents — they read `02-CONTEXT.md`.

---

## Areas selected (multiSelect)

User selected all four proposed gray areas:
1. Embedder smoke test — load mechanism & success bar
2. Mobile DOM port — coverage scope & selector strategy
3. Failure mode — what 'silent degradation' looks like (CLAS-10)
4. Settings export/import (CACH-04) — format, scope, and trigger

---

## Area 1 — Embedder smoke test

### Q1: Load mechanism for Transformers.js + MiniLM-L6-v2 INT8

| Option | Description |
|--------|-------------|
| **Vendor offline (chosen)** | Ship lib + weights in `vendor/`, reference via `chrome.runtime.getURL`. ~25-30MB. |
| CDN at runtime | Fetch from jsDelivr / HF Hub on first run. CSP and constraint issues. |
| Build step with esbuild/rollup | Tree-shake at build time. Violates zero-toolchain promise. |

**Selected:** Vendor offline. Matches PROJECT.md's "Transformers.js bundle will be the one exception" rule.

### Q2: Where the smoke test runs

| Option | Description |
|--------|-------------|
| Dedicated diagnostic page | Isolated, reusable, crashes don't break YouTube. |
| Inline in content script behind flag | Tests exact Phase 3 context but riskier. |
| **Both (chosen)** | Diagnostic page primary + content-script probe behind debug flag. |

**Selected:** Both. Diagnostic page = primary surface; probe = isolated-world verification for Phase 3 confidence.

### Q3: Pass bar

| Option | Description |
|--------|-------------|
| Basic | One vector + no crash. |
| **Strict (chosen)** | One vector + cold-start ≤ 8s + memory ≤ 250MB. |
| Basic + recorded baseline | Capture measurements without hard gates. |

**Selected:** Strict. Forces a real measurement now; failures block the phase rather than getting kicked down the road.

### Q4: Transformers.js version

| Option | Description |
|--------|-------------|
| **Try v3+ first, fall back to v2 (chosen)** | Default to `@huggingface/transformers` v3+; fall back if WebKit chokes. |
| Lock v2 upfront | Known-stable on Safari; misses v3 perf. |
| Try both, compare | Most data, 2x effort. |

**Selected:** Try v3+ first. Write `TRANSFORMERS-DECISION.md` with chosen version + measurements (the SC#3 artifact).

---

## Area 2 — Mobile DOM port

### Q1: Mobile vs Request Desktop

| Option | Description |
|--------|-------------|
| **Mobile-first (chosen)** | Default mobile must work without Request Desktop. |
| Best-effort mobile, RD recommended | Less ambitious; keeps RD as daily prerequisite. |
| Runtime probe | One bundle, detects mobile/desktop at scan time. |

**Selected:** Mobile-first. `docs/install-ios.md` updates to drop the RD prerequisite section.

### Q2: Selector strategy

| Option | Description |
|--------|-------------|
| Hard-coded list + fallback chain | Same pattern as v0.1. |
| **Hard-coded list + runtime telemetry (chosen)** | Above + console.warn on N consecutive empty scans. |
| Structural heuristics only | Drop selectors entirely; harder for title/channel extraction. |

**Selected:** Hard-coded + telemetry. CONCERNS.md recommended exactly this pattern.

### Q3: Manifest matches

| Option | Description |
|--------|-------------|
| **Keep current matches (chosen)** | `*.youtube.com/*` already covers `m.youtube.com`. |
| Add `youtube-nocookie.com` | Extra install-prompt friction. |
| Split per host | Two content_script entries; complicates classifier load. |

**Selected:** Keep current. All branching happens inside content scripts.

### Q4: Instagram mobile scope

| Option | Description |
|--------|-------------|
| **In scope (chosen)** | Re-probe mobile Reels DOM; update `findCard`/`extractCaption`/`extractAuthor`. |
| Defer | IG already works under RD per Phase 1 D-10; just verify. |

**Selected:** In scope. CONCERNS.md flags this as highest-risk file → AC-02 manual three-context rigor.

---

## Area 3 — Silent failure (CLAS-10)

### Q1: User-visible UI on failure

| Option | Description |
|--------|-------------|
| **Completely silent (chosen)** | Zero UI signal; identical to v0.1 from user POV. |
| Silent feed + subtle popup indicator | Small status line in popup. |
| Silent feed + options page diagnostics | Last error visible on options page. |

**Selected:** Completely silent. Diagnostic page (D-02) is the only failure surface.

### Q2: Where to record load state

| Option | Description |
|--------|-------------|
| **`chrome.storage.local.embedder_ready: boolean` (chosen)** | Plus optional `embedder_last_error: string`. |
| Structured state object | `{status, version, last_loaded_at, last_error, vector_dim}`. |
| Don't persist | Re-attempt every content-script init; 8s cold-start per tab. |

**Selected:** Single boolean. Clean Phase 3 contract.

### Q3: Try/catch contract

| Option | Description |
|--------|-------------|
| **One try/catch, no retry (chosen)** | ANY throw → embedder_ready=false, swallow. |
| Try + one auto-retry after 30s | Covers transient memory pressure. |
| Lazy load — only attempt when classifier needs it | Pushes cost to first scrolling session in Phase 3. |

**Selected:** Single try/catch, no retry. Phase 4 may revisit if transient patterns appear.

---

## Area 4 — Settings export/import (CACH-04)

### Q1: Export scope

| Option | Description |
|--------|-------------|
| **Settings only (chosen)** | `storage.sync` only (topics, enabled, sites, pauseUntil). |
| Settings + stats | Stats merge logic murky. |
| Settings + `embedder_ready` flag | False confidence across platforms. |

**Selected:** Settings only. Stats reset on new install; embedder_ready is platform-dependent.

### Q2: Import UI

| Option | Description |
|--------|-------------|
| **File picker + paste fallback (chosen)** | `<input type="file" accept=".json">` + textarea. |
| Paste-into-textarea only | Higher friction. |
| Both equally surfaced | Same as chosen, just more UI design. |

**Selected:** File picker + paste fallback. Belt-and-suspenders for an unusual install platform.

### Q3: Import behavior on existing settings

| Option | Description |
|--------|-------------|
| **Replace-all with confirmation (chosen)** | Wipe + confirm dialog showing N→M topic counts. |
| Merge by topic name | Forgiving but result depends on prior state. |
| Always ask per-topic | Way too much friction. |

**Selected:** Replace-all. Matches reinstall-from-backup mental model.

---

## Closing

User chose "I'm ready for context — write it" when asked if any more gray areas needed discussion.

No scope creep redirected (user stayed within Phase 2 boundaries throughout).
No "Other" freeform answers given (all chose from offered options).

---

## Deferred items captured

(See `02-CONTEXT.md` `<deferred>` block — 10+ items including Phase 3/4 deferrals and rejected alternatives like auto-retry, popup indicator, and `youtube-nocookie.com` matches.)
