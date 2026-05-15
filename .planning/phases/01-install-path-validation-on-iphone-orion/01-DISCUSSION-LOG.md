# Phase 1: Install path validation on iPhone Orion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 1-install-path-validation-on-iphone-orion
**Areas discussed:** install-ios.md scope, Verification rigor, Request Desktop dependency, Roadmap update

---

## install-ios.md scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal — just the path that worked | Build zip → AirDrop → Orion Install from File. ~10 lines. README.md-style. (Recommended for a personal tool.) | |
| Comprehensive — with troubleshooting | Above + Request Desktop toggle steps + Install-from-File-fails troubleshooting + CWS-unlisted backup recipe + smoke-test checklist. ~50 lines. | ✓ |
| Defer — write it next time you reinstall | Skip for now. You'll remember the steps for ~3 months. | |

**User's choice:** Comprehensive — with troubleshooting
**Notes:** Doc must cover install flow + Request Desktop user step + smoke-test + troubleshooting + backup recipes. Target ~50–80 lines. Lives at `docs/install-ios.md`.

---

## Verification rigor

| Option | Description | Selected |
|--------|-------------|----------|
| Pragmatic close — accept what's organically verified | SC#4 effectively passes (Orion restart kept blur working). v0.1.1 selector changes are pure DOM-extractor logic; SC#3 (Chrome/Brave) extremely likely to still work. Close Phase 1 today. (Recommended.) | ✓ |
| Verify the high-risk one only | Reboot the iPhone, confirm SmartScroller still blurs without manual re-enable. Skip Chrome/Brave dev-sandbox re-test. | |
| Verify everything | Phone reboot + load unpacked v0.1.1 in Chrome/Brave on Mac + popup/options run-through. ~15 extra minutes. | |

**User's choice:** Pragmatic close — accept what's organically verified
**Notes:** SC#3 and SC#4 marked as accepted without formal test. If Phase 4's smoke playbook later surfaces failures of these, they roll forward as Phase 4 follow-up — not a Phase 1 re-open.

---

## Request Desktop dependency

| Option | Description | Selected |
|--------|-------------|----------|
| Accept as Phase 1 deliverable; mobile DOM stays Phase 2 | Document "toggle Request Desktop in Orion" as a one-time setup step. Phase 2 unchanged. (Recommended.) | ✓ |
| Skip Phase 2 entirely — Request Desktop forever | Mark Phase 2 deferred; cuts ~1 phase of work. Real tradeoff: every fresh phone reset re-defaults to mobile mode. | |
| Push minimum mobile-DOM into Phase 1 | Add just `ytm-shorts-lockup-view-model` selectors so default iPhone YouTube also works. Mid-ground. | |

**User's choice:** Accept as Phase 1 deliverable; mobile DOM stays Phase 2
**Notes:** Phase 1 closes with Request Desktop documented as a user prerequisite on iPhone Orion. Mobile DOM remains Phase 2 scope per roadmap.

---

## Roadmap update

| Option | Description | Selected |
|--------|-------------|----------|
| Edit ROADMAP.md to reflect reality | Update Phase 1 SC#5 to lock "Install from File" as the install path; rule out CWS-unlisted and Xcode by direct evidence. (Recommended.) | ✓ |
| Leave ROADMAP, just note the override in CONTEXT.md | Roadmap as historical record; CONTEXT.md documents actual decision. | |

**User's choice:** Edit ROADMAP.md to reflect reality
**Notes:** Single-line edit to Phase 1 SC#5 in `.planning/ROADMAP.md`. Research SUMMARY.md stays frozen (research output is historical); the override is documented in CONTEXT.md and in the [[reference-orion-install]] memory entry.

---

## Claude's Discretion

- Exact prose of `docs/install-ios.md` — write it once, user reviews and trims if needed.
- Smoke-test checklist bullet ordering.
- Whether to add `*.zip` to `.gitignore` (currently zips are committed to git).

## Deferred Ideas

- **Phase 2 absorption of Request Desktop removal** — User chose to keep Phase 2 as roadmap-defined.
- **Skip Phase 2 (Request Desktop forever)** — User rejected.
- **Phone-reboot + Safari-refresh formal verification** — Deferred to Phase 4 smoke playbook coverage.
- **`.gitignore` for zip artifacts** — Claude's discretion during doc-writing pass.
