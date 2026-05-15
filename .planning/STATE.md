# State: SmartScroller

**Last updated:** 2026-05-16

## Project Reference

**Name:** SmartScroller
**Core Value:** A Short or Reel that is clearly off-topic must be blurred before the user finishes scrolling to it.
**Target platform:** iPhone Orion (Kagi iOS browser) — primary; desktop Orion / Chrome / Brave — secondary (dev sandbox)
**Mode:** MVP (vertical slices — every phase ships an end-to-end working capability on iPhone Orion)
**Granularity:** coarse (4 phases)
**Milestone:** v1.0 — "SmartScroller works on my iPhone, with semantic understanding."

**Current focus:** Phase 1 — Install path validation on iPhone Orion. Highest-risk unknown in the project; nothing else delivers value until this lands.

## Current Position

- **Phase:** 1 — Install path validation on iPhone Orion
- **Plan:** None yet (awaiting `/gsd:plan-phase 1`)
- **Status:** Not started
- **Progress:**
  - Roadmap: complete
  - Phase 1 plans: 0/0 (not yet decomposed)
  - Overall milestone: 0/4 phases complete

```
[ ] Phase 1: Install path validation on iPhone Orion           ← next
[ ] Phase 2: Mobile DOM port + on-device embedder smoke test
[ ] Phase 3: Transcript fetch + tiered semantic classifier
[ ] Phase 4: Tuning, trust, and the smoke playbook
```

## Performance Metrics

| Metric | Value | Source |
|--------|-------|--------|
| v1 requirements | 36 | REQUIREMENTS.md |
| Requirements mapped | 36/36 (100%) | ROADMAP.md |
| Phases planned | 4 | ROADMAP.md |
| Phases shipped | 0 | — |
| v0.1 features validated on iPhone | 0/8 | — |

## Accumulated Context

### Decisions (locked)

- **Build on v0.1, don't restart.** The existing Chrome MV3 scaffold ships; v1 is incremental mobile + semantic work.
- **iPhone Orion is the primary target.** Desktop is the dev sandbox. No other browsers in scope.
- **Tiered classifier: keyword first, semantic second.** Keyword tier short-circuits when the answer is obvious; embeddings only fire on inconclusive results.
- **Local embeddings only.** Transformers.js + `Xenova/all-MiniLM-L6-v2` (INT8, ~23MB). No cloud APIs, no Ollama. WASM is the floor; WebGPU is opportunistic.
- **No build step, except for the embedder bundle.** v0.1's "vanilla JS, IIFE, no node_modules" rule relaxes only for the one Transformers.js bundle (esbuild).
- **Service worker is message-router only.** Never load the model in the SW; iOS kills it. Caches go to content-script scope or `chrome.storage.local`. The critical blur path never `await`s `runtime.sendMessage`.
- **Per-render reveals stay non-sticky.** Intentional UX friction; do not persist "Show anyway" across sessions or navigations.

### Open decisions (must resolve in early phases)

- **Install path (resolves in Phase 1):** Chrome Web Store unlisted ($5 one-time) vs Xcode-wrapped Safari Web Extension ($99/yr). Try CWS-unlisted first; fall back to Xcode only if it fails.
- **Transformers.js version (resolves in Phase 2):** v4.2.0 (latest, smaller bundle) vs v2.x (pinned to avoid the v3 iOS memory regression #1242). Decide by real-device memory measurement, not in advance.
- **Mobile YouTube DOM dialect (resolves in Phase 2):** which UA path does iPhone Orion actually serve — `m.youtube.com` (`ytm-*`) or `www.youtube.com` (`ytd-*`)? On-device check required.

### TODOs

- Run `/gsd:plan-phase 1` to decompose Phase 1 into executable plans.
- Phase 1 plan must include: try CWS-unlisted install path first; have Xcode-wrapped Safari Web Extension fallback partially scaffolded.

### Blockers

None. Roadmap is complete and Phase 1 is ready to plan.

### Risks (carry into planning)

- **CRITICAL:** iPhone install hurdle. If Phase 1 fails after both paths have been tried, the milestone re-scopes to desktop-Orion-only and the iPhone bit is deferred.
- **CRITICAL:** Transformers.js iOS memory regression. v3 has a documented unbounded-memory crash on iOS. Phase 2 must validate v4 on real device before committing.
- **CRITICAL:** iOS Safari extension service workers die mid-scroll and don't wake. Architectural constraint: SW does no classification work; ever.
- **HIGH:** Threshold tuning death. A single global cosine threshold won't work. Per-topic thresholds + calibration log from Phase 2 onward.
- **HIGH:** YouTube transcript contract drift. 20–40% of Shorts have no usable transcript; fetcher must be fail-open with a 1500ms hard timeout from day one.

## Session Continuity

### Where we are

Project initialization is complete:
- PROJECT.md, REQUIREMENTS.md, and research (STACK / FEATURES / ARCHITECTURE / PITFALLS / SUMMARY) all exist
- Codebase is mapped under `.planning/codebase/`
- v1.0 milestone scope is set: "SmartScroller works on my iPhone, with semantic understanding."
- Roadmap is created and all 36 v1 requirements are mapped to phases
- Phase 1 is the immediate next step

### Next action

Run `/gsd:plan-phase 1` to decompose Phase 1 (Install path validation on iPhone Orion) into executable plans. Phase 1 is itself a spike — plan it as throwaway investigation work that must produce: (a) a working install on the author's iPhone Orion, (b) a re-installable `docs/install-ios.md`, (c) a locked decision between CWS-unlisted and Xcode-wrapped paths.

### Key files

- `.planning/PROJECT.md` — core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — 36 v1 requirements with phase traceability
- `.planning/ROADMAP.md` — 4 phases with success criteria
- `.planning/research/SUMMARY.md` — phase-structure rationale and research tensions
- `.planning/research/PITFALLS.md` — the three CRITICAL iPhone-runtime pitfalls
- `.planning/codebase/ARCHITECTURE.md` — v0.1 four-context model

---
*State initialized: 2026-05-16 after roadmap creation*
