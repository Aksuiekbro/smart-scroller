# Phase 1: Install path validation on iPhone Orion - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning (small phase; most success criteria organically delivered during research/debug, what remains is doc + light verification)

<domain>
## Phase Boundary

Phase 1 delivers v0.1 of the SmartScroller extension installed, running, and producing visible blur on the author's **iPhone Orion** via a documented, repeatable path.

**In scope:**
- Verifying an install path that works on iPhone Orion as of 2026-05-16
- Writing `docs/install-ios.md` so reinstalling later is a checklist, not re-discovery
- Confirming the install persists across Orion app lifecycle events
- Acknowledging selector-stale fixes (v0.1.1) that were necessary to make blur visible during Phase 1 validation
- Editing ROADMAP.md to reflect the actual locked install decision (the roadmap's two proposed paths were superseded by a third one neither research surfaced)

**Out of scope (deferred):**
- Mobile DOM port — Phase 2 (default iPhone YouTube serves `m.youtube.com` which v0.1.1 still doesn't recognize)
- Transformers.js / embeddings — Phase 2
- Transcript fetching — Phase 3
- Threshold tuning, reason badges, calibration log — Phase 4

</domain>

<decisions>
## Implementation Decisions

### Install Path
- **D-01:** Locked install path is **"Install from File" via Orion iOS Extensions menu**, fed a self-built zip of the unpacked extension. Cost: $0 ongoing, $0 one-time. Verified working on-device.
- **D-02:** Both research-surfaced alternatives are explicitly ruled out for this project: Chrome Web Store unlisted ($5 one-time + 1–3 day Google review) and Xcode-wrapped Safari Web Extension ($99/yr Apple Developer Program). Neither is needed because Orion iOS supports direct file install. **Keep as documented backup recipes only**, in case Orion's behavior changes.
- **D-03:** Zip-build command is `zip -r smartscroller-vX.Y.Z.zip manifest.json background/ content/ options/ popup/ -x "*.DS_Store"` — keep `.planning/`, `.git/`, `node_modules/`, dev artifacts out.

### v0.1 → v0.1.1 Selector Fixes (Phase 1 scope clarification)
- **D-04:** v0.1.1 ships two selector fixes that were necessary for the success criterion "visibly observe blur firing" to actually hold. These are **Phase 1 scope**, NOT scope creep into Phase 2:
  - `content/youtube.js`: title selector `yt-shorts-video-title-view-model` + class fallback `.ytShortsVideoTitleViewModelHost` (YouTube DOM drifted post-knowledge-cutoff)
  - `content/instagram.js`: `findCard` rewritten to walk up to the wrapper that contains the metadata sidebar (IG redesigned the video/metadata layout into siblings)
- **D-05:** Both fixes verified against live DOM via Playwright probes under both Chrome-on-Mac and Mac-Safari user agents (matching Orion iOS Request-Desktop mode). Manifest bumped to v0.1.1 and committed.

### Documentation (`docs/install-ios.md`)
- **D-06:** **Scope = comprehensive with troubleshooting.** Doc must include:
  1. Zip-build command (one liner) with the explicit `-x` exclusion patterns
  2. Transfer paths (AirDrop / iCloud / email-to-self), order of preference
  3. Orion iOS install steps: Menu → Extensions → ↓ → Install from File → select zip
  4. Required user step: enable **Request Desktop Website** in Orion (PageMenu / "AA" icon in URL bar). Note that without this, only Instagram works on iPhone; Phase 2 removes this requirement.
  5. Smoke-test checklist (~5 items): "open shorts/<id> → see blur on at least one Short → tap Show anyway → reveal works → open reels → blur fires → popup counter increments"
  6. Troubleshooting: what to do if "Install from File" rejects the zip (try unpacked? CRX-pack?), if blur doesn't appear (check Request Desktop, check enable toggle, check storage.sync), if extension disappears after restart
  7. **Backup install recipe**: brief notes on the CWS-unlisted path and Xcode-wrapped path, marked as fallbacks if the primary stops working
- **D-07:** Target length: ~50–80 lines. Lives at `docs/install-ios.md` (relative to repo root).

### Verification Rigor
- **D-08:** **Pragmatic close** — formal verification is NOT required for the remaining unverified Success Criteria 3 and 4:
  - **SC#3** (Chrome/Brave on Mac still loads v0.1.1) is accepted on the grounds that v0.1.1 only modified DOM-extraction selectors inside two functions; no manifest, no service worker, no message protocol changes. Regression risk is minimal.
  - **SC#4** (extension survives Orion backgrounding + restart) is accepted based on the user's report that they "turned on / turned off / restarted Orion" during the bug investigation and blur continued to fire afterward (in Request-Desktop mode). Phone-reboot and Safari-refresh are not formally tested in Phase 1 closure.
- **D-09:** If Phase 4's smoke playbook (Phase 4 success criterion 5) later surfaces failures of the unverified criteria, they roll back into Phase 1 follow-up — not retroactively re-open Phase 1.

### Mobile DOM Dependency
- **D-10:** Phase 1 closes with **Request Desktop Website as a documented user prerequisite** on iPhone Orion. Default mobile mode does NOT work because `m.youtube.com` serves a third container structure neither v0.1 nor v0.1.1 recognizes.
- **D-11:** Mobile DOM coverage is firmly Phase 2 work, NOT pushed into Phase 1. The Request-Desktop workaround is acceptable for a personal tool because:
  - It's a one-time setup
  - Orion iOS remembers per-site Request Desktop preferences across sessions
  - Building robust `ytm-*` selectors before Phase 2's embedder smoke test would create more code to maintain through an uncertain platform validation

### Roadmap Update
- **D-12:** `.planning/ROADMAP.md` Phase 1 Success Criterion #5 will be edited in-place to reflect the actual locked install decision (Install from File) and explicitly rule out CWS-unlisted and Xcode-wrapping as primary paths. Other Phase 1 criteria stay as written.
- **D-13:** `.planning/research/SUMMARY.md` "Tension #1" (CWS vs Xcode) is no longer a real tension — superseded. Will not be retroactively edited (it's frozen-in-time research output), but the override is documented here and in [[reference-orion-install]].

### Claude's Discretion
- Exact prose of the install doc — write it once, the user reviews and trims if needed.
- Smoke-test checklist exact bullet ordering — pick something sensible.
- Whether to add a `.gitignore` entry for `*.zip` artifacts (probably yes; currently the v0.1.0 and v0.1.1 zips were committed).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (planner, executor) MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — Core Value, Constraints (especially "$0 ongoing"), Out of Scope list
- `.planning/REQUIREMENTS.md` §Platform (PLAT-01..04) — the four Phase 1 v1 requirements
- `.planning/ROADMAP.md` — Phase 1 detail block (Goal, Success Criteria 1–5; SC#5 will be edited as part of this phase per D-12)

### Codebase state
- `.planning/codebase/STACK.md` — current v0.1 stack baseline
- `.planning/codebase/ARCHITECTURE.md` — four-context model (background SW, content scripts, options, popup)
- `.planning/codebase/CONCERNS.md` — flagged YouTube + Instagram selector fragility (which we hit and fixed in v0.1.1)

### Research outputs (frozen — DO NOT retro-edit)
- `.planning/research/SUMMARY.md` — note that "Tension #1" (CWS vs Xcode) is superseded by Install-from-File (this CONTEXT.md is the override)
- `.planning/research/PITFALLS.md` §Pitfall 1 (iPhone install hurdle) — now mostly resolved; the warnings about Xcode pain are still valid as backup-path context

### Files we'll touch in Phase 1 closure
- `docs/install-ios.md` — CREATE (does not exist yet)
- `.planning/ROADMAP.md` — EDIT Phase 1 SC#5
- `.gitignore` — possibly add `*.zip` (Claude's discretion per D-13)

### Memory references
- [[reference-orion-install]] — Orion iOS "Install from File" memory entry capturing the install-path discovery for future sessions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The zip-build command itself** — `zip -r ... manifest.json background/ content/ options/ popup/ -x "*.DS_Store"` already worked once. Drop it into install-ios.md verbatim.
- **`smartscroller-v0.1.1.zip`** — exists at repo root, currently committed. Useful as the reference artifact the doc tells the user to build.
- **`manifest.json` already at MV3 + version 0.1.1** — no manifest changes needed for Phase 1 closure.

### Established Patterns
- **README.md style** — terse, sectioned, lots of code blocks, explicit numbered steps. `docs/install-ios.md` should match this voice.
- **No build step** — extension loads from raw files; the only "build" is `zip`. install-ios.md must reflect this (no `npm install`, no transpile).
- **`globalThis.browser ?? globalThis.chrome`** polyfill exists at the top of every JS file — install path doesn't affect this; just noting it as a stable contract.

### Integration Points
- **None.** Phase 1 closure is doc + roadmap-edit + (optional) `.gitignore` tweak. No new code. The v0.1.1 selector fixes are already committed as part of Phase 1 work (commit `52d8e10`).

</code_context>

<specifics>
## Specific Ideas

- The doc should explicitly mention **Orion iOS's Menu → Extensions → ↓ → Install from File** as the verified path, not just generic "install an extension" instructions. Use the exact UI labels.
- Smoke-test should start with a known-default behavior the user can verify in 30 seconds: "open youtube.com/shorts/, scroll one Short with Request Desktop on, see a frosted overlay if the Short isn't AI/programming-related."
- The fallback CWS-unlisted recipe should NOT be a full how-to — link to the original Google docs and just say "If Install from File ever stops working, you'd need a $5 CWS dev account and your zip uploaded as Unlisted; Orion accepts the listing URL via Install Chrome Extension."

</specifics>

<deferred>
## Deferred Ideas

### Reviewed but not folded
- **Phase 2 absorption of Request-Desktop workaround removal** — User explicitly chose to leave Phase 2 as the roadmap-defined "mobile DOM port + embedder smoke test." Don't collapse Phase 2 into Phase 1.
- **Skip Phase 2 entirely (Request Desktop forever)** — User rejected this option. Mobile DOM port stays planned in Phase 2.
- **`.gitignore` for `*.zip`** — Claude's discretion in the doc-writing pass; not a Phase 1 requirement.
- **Phone-reboot + Safari-refresh formal test** — Deferred to Phase 4 smoke playbook coverage (per D-09).

### Truly out of scope for this phase
- Adding `ytm-*` mobile selectors — Phase 2
- Transcripts, embeddings, threshold tuning — Phases 3 and 4
- Distribution (CWS public listing, App Store) — explicit `Out of Scope` in PROJECT.md

</deferred>

---

*Phase: 1-install-path-validation-on-iphone-orion*
*Context gathered: 2026-05-16*
