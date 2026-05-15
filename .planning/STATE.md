---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: milestone
status: executing
last_updated: "2026-05-16T00:00:00.000Z"
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
  percent: 25
---

# State: SmartScroller

**Last updated:** 2026-05-16

## Project Reference

**Name:** SmartScroller
**Core Value:** A Short or Reel that is clearly off-topic must be blurred before the user finishes scrolling to it.
**Target platform:** iPhone Orion (Kagi iOS browser) — primary; desktop Orion / Chrome / Brave — secondary (dev sandbox)
**Mode:** MVP (vertical slices — every phase ships an end-to-end working capability on iPhone Orion)
**Granularity:** coarse (4 phases)
**Milestone:** v1.0 — "SmartScroller works on my iPhone, with semantic understanding."

**Current focus:** Phase 02 — Mobile DOM port + on-device embedder smoke test

## Current Position

Phase: 01 (install-path-validation-on-iphone-orion) — COMPLETE
Plan: 1 of 1 — COMPLETE

- **Phase:** 1 — Install path validation on iPhone Orion — COMPLETE
- **Plan:** 01-01-PLAN.md — COMPLETE (commits ccb5dc2, d0750ba, 2106f18)
- **Status:** Phase 01 complete. Ready for Phase 02.
- **Progress:**
  - Roadmap: complete
  - Phase 1 plans: 1/1 complete
  - Overall milestone: 1/4 phases complete

```
[x] Phase 1: Install path validation on iPhone Orion           ← DONE
[ ] Phase 2: Mobile DOM port + on-device embedder smoke test   ← next
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
- **Install path locked: Install from File via Orion iOS Extensions menu** (D-01, Phase 1). CWS-unlisted and Xcode-wrapped are backup recipes only. Documented in docs/install-ios.md.
- **Request Desktop Website is a documented user prerequisite** on iPhone for YouTube Shorts (D-10, Phase 1). Phase 2 removes this requirement with mobile-specific selectors.

### Open decisions (must resolve in early phases)

- **Transformers.js version (resolves in Phase 2):** v4.2.0 (latest, smaller bundle) vs v2.x (pinned to avoid the v3 iOS memory regression #1242). Decide by real-device memory measurement, not in advance.
- **Mobile YouTube DOM dialect (resolves in Phase 2):** which UA path does iPhone Orion actually serve — `m.youtube.com` (`ytm-*`) or `www.youtube.com` (`ytd-*`)? On-device check required.

### TODOs

- Plan Phase 02: Mobile DOM port + on-device embedder smoke test.

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

Phase 1 complete (2026-05-16):

- v0.1.1 installed and verified on iPhone Orion (blur fires on YouTube Shorts with Request Desktop on)
- docs/install-ios.md written — 7-section checklist, PLAT-02 closed
- README "Install in Orion" updated — stale CWS-unlisted advice removed, points at docs/install-ios.md
- .gitignore added with *.zip; pre-existing zip artifacts untracked from git index
- Install path locked: Install from File via Orion iOS Extensions menu (D-01)

### Next action

Plan Phase 02: Mobile DOM port + on-device embedder smoke test. Key questions: which UA path does iPhone Orion serve for YouTube (m.youtube.com ytm-* vs www.youtube.com ytd-*), and does Transformers.js v4 load without memory regression on real iPhone hardware.

### Key files

- `.planning/PROJECT.md` — core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — 36 v1 requirements with phase traceability
- `.planning/ROADMAP.md` — 4 phases with success criteria
- `.planning/research/SUMMARY.md` — phase-structure rationale and research tensions
- `.planning/research/PITFALLS.md` — the three CRITICAL iPhone-runtime pitfalls
- `.planning/codebase/ARCHITECTURE.md` — v0.1 four-context model

---
*State initialized: 2026-05-16 after roadmap creation*
