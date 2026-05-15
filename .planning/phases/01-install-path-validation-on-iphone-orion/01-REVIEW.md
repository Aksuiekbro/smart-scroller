---
phase: "01"
reviewed: "2026-05-16T00:00:00Z"
depth: quick
files_reviewed: 3
files_reviewed_list:
  - docs/install-ios.md
  - README.md
  - .gitignore
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-16
**Depth:** quick
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Phase 01 is a docs + repo-hygiene phase. Three files reviewed: the new `docs/install-ios.md` install checklist, the rewritten `README.md` "Install in Orion" section, and the new `.gitignore`. No code was introduced.

The structural requirements are largely met: all 7 D-06 sections are present in `docs/install-ios.md`, the Install from File path is correctly primary, Request Desktop Website is documented, CWS/Xcode are correctly labeled as fallbacks only, the README no longer recommends CWS-unlisted as primary, and `.gitignore` contains the correct `*.zip` entry.

Three warnings and two info items were found. The most impactful is a technically incorrect zip exclusion glob that will silently fail to strip subdirectory `.DS_Store` files, and a troubleshooting alternative command that hardcodes an assumption about the repo's parent folder name. Neither causes data loss or security risk, but both will produce subtle build artifact problems if the user follows them literally.

## Warnings

### WR-01: `-x "*.DS_Store"` glob does not exclude subdirectory `.DS_Store` files

**File:** `docs/install-ios.md:12`

**Issue:** The zip command uses `-x "*.DS_Store"` as the exclusion pattern. When the shell double-quotes a glob and passes it to `zip`, the shell does NOT expand the pattern — instead `zip` receives the literal string `*.DS_Store` and applies its own glob matching. `zip`'s built-in `*` matches within a single path component, so `*.DS_Store` only excludes a `.DS_Store` at the root of the archive. Files at `content/.DS_Store`, `background/.DS_Store`, etc. are silently included. This is the command from CONTEXT.md D-03, so the error is inherited, but the doc as written is factually incorrect.

**Fix:**
```sh
zip -r smartscroller-v0.1.1.zip manifest.json background/ content/ options/ popup/ -x "*/.DS_Store" -x ".DS_Store"
```
Or use a backslash-escape so zip receives the glob unmodified by the shell, which `zip` then applies recursively:
```sh
zip -r smartscroller-v0.1.1.zip manifest.json background/ content/ options/ popup/ -x \*.DS_Store
```
The backslash-escaped form is the conventional idiom and is what macOS `zip(1)` man page examples use.

---

### WR-02: Troubleshooting repackage command assumes repo folder name `smartscroller/`

**File:** `docs/install-ios.md:73`

**Issue:** The troubleshooting alternative is:
```sh
cd smartscroller/ && zip -r ../smartscroller-v0.1.1.zip manifest.json background/ content/ options/ popup/ -x "*.DS_Store"
```
This silently assumes (a) the user's current working directory is the repo's parent, and (b) the repository folder on disk is named exactly `smartscroller/`. If the repo was cloned into a differently-named folder (e.g., `SmartScroller/`, `ss/`, or a path with spaces), the `cd` will fail and the user will be left with no zip and no clear error. The primary Section 1 command correctly says "Run from repo root" — the troubleshooting alternative contradicts this convention without explanation.

**Fix:** Replace the troubleshooting alternative with the same repo-root-relative form as Section 1, or instruct the user to `cd` to their repo root first:
```sh
# From repo root:
zip -r smartscroller-v0.1.1.zip manifest.json background/ content/ options/ popup/ -x \*.DS_Store
```
If the intent is to build the zip one directory up (for cleaner separation from the source), say so explicitly and note the assumption.

---

### WR-03: Troubleshooting §"Install from File rejects the zip" omits plan-specified alternatives

**File:** `docs/install-ios.md:70-74`

**Issue:** CONTEXT.md D-06 item 6(a) and the PLAN task spec (task 6 paragraph a) both require this troubleshooting subsection to suggest "unpacked dir / CRX-pack as fallback" when Orion rejects the zip. The doc omits both suggestions — it only offers a repackage-from-different-cwd workaround and then defers to the CWS-unlisted backup recipe. If Orion's zip-install is flaky (a plausible failure mode), the author has no immediate in-scope remedy documented, and is pushed to the $5 CWS path unnecessarily.

**Fix:** Add one sentence covering the two plan-specified alternatives:
```markdown
- If Orion still rejects it, try loading the extension unpacked from Chrome/Brave first to verify the manifest is valid, or use `chrome.packExtension` to produce a signed `.crx` before returning to Orion.
```

---

## Info

### IN-01: Troubleshooting repackage command hardcodes version `v0.1.1`

**File:** `docs/install-ios.md:73`

**Issue:** The troubleshooting repackage command uses `smartscroller-v0.1.1.zip` as the output filename. Section 1 (line 15) correctly tells the user to "Bump the filename version number when shipping a new build." A user following the troubleshooting path on a future version (v0.2.0, etc.) will produce a mis-versioned artifact, which can cause confusion about which build is installed.

**Fix:** Use a placeholder consistent with Section 1:
```sh
cd smartscroller/ && zip -r ../smartscroller-vX.Y.Z.zip manifest.json background/ content/ options/ popup/ -x \*.DS_Store
```

---

### IN-02: Smoke test URL `youtube.com/shorts/` uses trailing slash with no video ID

**File:** `docs/install-ios.md:60`

**Issue:** The smoke test says `Open youtube.com/shorts/ in Orion`. The URL `youtube.com/shorts/` (trailing slash, no video ID) is not a valid Shorts permalink — YouTube either redirects it to the homepage or shows an empty page in some browser configurations, which would cause the smoke test to silently pass with no Shorts visible to blur. The Shorts feed is accessible at `youtube.com/shorts` (no trailing slash, sometimes shows a vertical Shorts feed) or more reliably by navigating to the YouTube homepage and scrolling to the Shorts shelf.

**Fix:** Replace the URL example with one guaranteed to surface blurrable content:
```markdown
1. Open `youtube.com` in Orion (with Request Desktop on) and scroll to the Shorts shelf, or open any Shorts permalink (e.g., `youtube.com/shorts/<id>`).
```

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
