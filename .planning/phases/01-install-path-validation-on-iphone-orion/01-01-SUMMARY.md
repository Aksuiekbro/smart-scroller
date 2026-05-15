---
phase: 01-install-path-validation-on-iphone-orion
plan: "01"
subsystem: docs
tags: [docs, repo-hygiene, ios, install, plat-02]
dependency_graph:
  requires: []
  provides:
    - docs/install-ios.md (PLAT-02 — re-installable iPhone Orion checklist)
    - README.md updated (stale CWS-unlisted advice removed)
    - .gitignore (*.zip build artifacts excluded)
  affects:
    - README.md (Install in Orion section rewritten)
tech_stack:
  added: []
  patterns: []
key_files:
  created:
    - docs/install-ios.md
    - .gitignore
  modified:
    - README.md
decisions:
  - "Install from File via Orion iOS Extensions menu is the locked primary install path (D-01)"
  - "CWS-unlisted and Xcode-wrapped paths documented as backup only, not primary (D-02)"
  - "*.zip excluded from git index going forward; prior zips untracked but kept on disk"
metrics:
  duration_minutes: 15
  completed: "2026-05-16"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 1
---

# Phase 1 Plan 1: Install iOS Doc + README Fix + Gitignore Summary

**One-liner:** iPhone Orion install checklist (7 sections, Install from File path, Request Desktop prereq) with README pointer and *.zip gitignore hygiene.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write docs/install-ios.md | ccb5dc2 | docs/install-ios.md (created, 98 lines) |
| 2 | Replace stale "Install in Orion" in README.md | d0750ba | README.md (Install in Orion section) |
| 3 | Add *.zip to .gitignore, untrack zip artifacts | 2106f18 | .gitignore (created), zip files untracked |

## What Was Built

**docs/install-ios.md** — 98-line install checklist covering the 7 sections from CONTEXT.md D-06:
1. Zip-build command with `-x "*.DS_Store"` exclusion (D-03)
2. Transfer paths to iPhone (AirDrop preferred, iCloud Drive, email-to-self)
3. Orion iOS install steps using exact UI labels: Menu → Extensions → ↓ → Install from File
4. Request Desktop Website prerequisite (D-10) — explains why it's needed and that Phase 2 removes it
5. Smoke-test checklist (5 items: Shorts blur, Show anyway, Instagram Reels blur, popup counter)
6. Troubleshooting (3 subsections: zip rejected, blur absent, extension disappears)
7. Backup install recipes — CWS-unlisted ($5) and Xcode-wrapped ($99/yr) labeled as fallback only (D-02)

**README.md** — "Install in Orion" section rewritten from 11 lines of stale CWS-as-primary advice to 4 lines pointing at docs/install-ios.md. Chrome/Brave and Firefox subsections preserved verbatim.

**.gitignore** — Created with `*.zip` as the sole entry. `git rm --cached` removed both `smartscroller-v0.1.1.zip` and `smartscroller.zip` from the git index; both files remain on disk.

## Requirements Closed

| Requirement | Status | Notes |
|-------------|--------|-------|
| PLAT-02 | CLOSED | docs/install-ios.md delivers the re-installable checklist directly |
| PLAT-01 | Docs support | Verified install on iPhone Orion pre-plan (commit 52d8e10); this plan documents it |
| PLAT-03 | Docs support | Chrome/Brave install section in README preserved (PLAT-03 dev sandbox documentation) |
| PLAT-04 | Docs support | Extension lifecycle behavior documented in troubleshooting section |

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed, verify gates passed, CONTEXT.md D-01 through D-13 honored.

## Self-Check: PASSED

- FOUND: docs/install-ios.md
- FOUND: .gitignore
- FOUND: commit ccb5dc2 (Task 1)
- FOUND: commit d0750ba (Task 2)
- FOUND: commit 2106f18 (Task 3)
- FOUND on disk: smartscroller-v0.1.1.zip (untracked, not deleted)
- FOUND on disk: smartscroller.zip (untracked, not deleted)
