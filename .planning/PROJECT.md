# SmartScroller

## What This Is

A personal browser extension that blurs YouTube Shorts, Instagram Reels, and YouTube homepage videos that don't match the topics you actually want to see. Built for one user (the author), running primarily on **iPhone Orion** (Kagi's iOS browser), with desktop Orion/Chrome as a secondary target.

Off-topic content gets a frosted-glass overlay with a small "Show anyway" reveal — the feed stays intact, but only useful content reaches the eyes.

## Core Value

**You only see Shorts/Reels/videos that actually align with what you're trying to learn — without giving up the feed format itself.**

If everything else fails, this must work: a Short or Reel that is clearly off-topic must be blurred before the user finishes scrolling to it.

## Requirements

### Validated

<!-- Inferred from v0.1 codebase. These shipped (as code) but have NOT been validated through real personal use yet — they exist but are unproven on the target platform (iPhone). -->

- ✓ **Topic-based filtering UI** — chip-based keyword editor, multiple topics, per-site toggles — v0.1
- ✓ **Keyword + hashtag matching** with normalization (lowercase, punctuation strip, camelCase hashtag split) — v0.1
- ✓ **Blur overlay + "Show anyway"** banner (per-render, non-sticky) — v0.1
- ✓ **Enable/pause controls** (15m, 1h, custom) — v0.1
- ✓ **Daily stats counter** (blurred vs allowed) — v0.1
- ✓ **Chrome MV3 WebExtension scaffold** (service worker, content scripts, options page, popup) — v0.1
- ✓ **Settings persist via chrome.storage.sync** — v0.1
- ✓ **MutationObserver loop with debounce** for SPA navigation on YouTube/Instagram — v0.1

> **Caveat:** These were built but never run on the target platform (iPhone Orion). They're "implemented" not "validated through use." A first phase exists specifically to make them actually work on the target.

### Active

- [ ] **Run on iPhone Orion** — figure out and document the install path for iOS Orion (Safari Web Extension wrapper via Xcode/TestFlight, or alternative)
- [ ] **Mobile DOM port** — selectors for `m.youtube.com` (`ytm-*` elements), mobile Instagram structural heuristics
- [ ] **Fetch YouTube transcripts** — auto/manual captions via `ytInitialPlayerResponse.captions`, parse XML/JSON track
- [ ] **Local semantic classification** — Transformers.js with `Xenova/all-MiniLM-L6-v2` (~25MB quantized), cosine similarity between topic and transcript embeddings, configurable threshold
- [ ] **Tiered classifier** — keyword tier first (fast, instant), escalate to embeddings only when keywords are inconclusive
- [ ] **Result cache by video ID** — never re-classify the same Short/Reel twice
- [ ] **Smoke-test playbook** — manual test plan for "does this work" since there's no test suite

### Out of Scope

- **Cloud LLM APIs (Claude, OpenAI, Gemini)** — incompatible with "free" constraint
- **Local LLM via Ollama** — requires desktop machine running model; not viable for iPhone-primary tool
- **Instagram transcripts or OCR** — no IG transcript API; OCR on video frames is too heavy for iPhone WebExtension
- **TikTok For You support** — defer indefinitely; not a current scrolling habit
- **Sync across devices** — personal single-user tool, single-device acceptable
- **Distribution / store listing** — purely personal; no Chrome Web Store, no App Store
- **User accounts, telemetry, error reporting** — personal tool, no need
- **Topic library / share topics with others** — single user, no sharing
- **Sticky "Show anyway" reveals** — intentional UX choice; per-render keeps friction high

## Context

**Author/user is a developer** working primarily on Mac (Darwin), using Claude Code and Orion browser. Interests visible in the seeded default topic ("AI & Programming") — AI/ML, LLMs, software engineering.

**Stated problem** (from initial conversation): YouTube Shorts and Instagram Reels scrolling is consuming time better spent on topical learning. The author doesn't want to quit short-form video; they want to redirect it.

**Technical environment:**
- Primary runtime: **iPhone Orion** (Kagi iOS browser, Safari WebKit base)
- Secondary runtime: Desktop Orion (Kagi macOS), Chrome/Brave as dev sandbox
- iOS Orion supports Chrome extensions experimentally via Safari Web Extension compatibility layer, but **unpacked-extension installation is not available on iOS** — a real install requires either an Xcode-wrapped Safari Web Extension (App Store Connect / TestFlight) or hosting at a URL that Orion iOS can install from
- No backend, no server, no cloud anything

**Prior work (v0.1, shipped to disk but untested):**
- Full MV3 extension scaffolded in `/Users/daurenzhunussov/smartscroller/`
- Codebase map exists at `.planning/codebase/` (7 docs, ~1841 lines)
- Highest fragility documented in `CONCERNS.md`: Instagram class names hashed and structural heuristics required; YouTube `ytd-*` selectors are desktop-only and will need mobile counterparts

**Known issues already documented:**
- Per-render (non-sticky) reveals may surprise the user — intentional but worth tracking
- IG selector resilience is heuristic, not anchored
- Daily stats roll may miss if service worker is suspended multi-day

## Constraints

- **Platform**: iPhone Orion (iOS Safari Web Extension format) primary — Why: that's where the scrolling actually happens
- **Cost**: $0 ongoing, no API fees — Why: personal tool, not worth paying per Short classified
- **Privacy**: All processing on-device — Why: transcripts and viewing patterns shouldn't leave the phone
- **Bundle size**: Soft cap ~30MB (for the embedding model) — Why: iOS extensions are size-sensitive and download once
- **Dependencies**: Pure vanilla JS/CSS/HTML — no build step, no npm install, no node_modules — Why: keeps the extension installable from source and reduces moving parts; Transformers.js bundle will be the one exception
- **Distribution**: Single device, personal install — Why: no users to onboard, no compatibility matrix

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build on v0.1, don't start fresh | Existing scaffold works for desktop; mobile port is incremental | — Pending |
| Local embeddings (Transformers.js MiniLM) as the "brain" | Only option that satisfies precise + free + on-device on iPhone | — Pending |
| Pull transcripts as the primary classification signal | Title/channel/hashtags are weak; transcript is the actual content | — Pending |
| Keyword tier stays as the fast-path first filter | Cheaper and faster than embeddings for obvious cases | — Pending |
| Blur + "Show anyway" (not skip / quota / hard-block) | Keep the feed UX, raise the friction of off-topic content | — Pending |
| iPhone is primary, desktop is secondary | That's where the actual scrolling happens | — Pending |
| Instagram stays caption-only (no transcripts) | No IG transcript API; OCR is too heavy on phone | — Pending |
| Personal tool, never distributed | No need for accounts, settings sync, store listings, marketing | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-15 after initialization*
