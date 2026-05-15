# SmartScroller — iPhone Orion Install

Verified working path as of 2026-05-16: **"Install from File" via Orion iOS Extensions menu**, fed a self-built zip. No Xcode, no Chrome Web Store account required.

---

## 1. Build the zip

Run from repo root:

```sh
zip -r smartscroller-v0.1.1.zip manifest.json background/ content/ options/ popup/ -x "*.DS_Store"
```

Bump the filename version number when shipping a new build.

---

## 2. Transfer the zip to iPhone

In order of preference:

1. **AirDrop** — fastest; select the zip in Finder, right-click → Share → AirDrop → your iPhone. No internet, no cloud account.
2. **iCloud Drive** — drop the zip into iCloud Drive on Mac; open Files app on iPhone to download it.
3. **Email to yourself** — last resort; attach the zip, open Mail on iPhone, save attachment to Files.

---

## 3. Install in Orion iOS

1. Open **Orion** on iPhone.
2. Tap the **menu icon** (three-dot or hamburger, top right).
3. Tap **Extensions**.
4. Tap the **download arrow (↓)** button.
5. Tap **Install from File**.
6. Navigate to the zip you transferred and select it.
7. Confirm the install prompt.

SmartScroller appears in the Extensions list. Enable it if the toggle is off.

---

## 4. Enable Request Desktop Website (required)

Without this step, YouTube on iPhone Orion serves `m.youtube.com`, which uses different DOM elements that the current selectors don't cover. Instagram works without this step; YouTube Shorts does not.

1. In Orion, navigate to `youtube.com`.
2. Tap the **"AA" icon** in the address bar (or open the Page Menu).
3. Tap **Request Desktop Website**.
4. Orion remembers this preference per-site across sessions.

> Phase 2 will remove this requirement by adding mobile-specific selectors.

---

## 5. Smoke test

Verify the install in ~30 seconds:

1. Open `youtube.com/shorts/` in Orion with Request Desktop on.
2. Scroll to any Short — a frosted-glass overlay should appear if it isn't AI/programming-related.
3. Tap **Show anyway** on a blurred Short — video should reveal without refreshing the page.
4. Open `instagram.com` → tap a Reel — blur overlay fires without Request Desktop.
5. Tap the SmartScroller toolbar icon — **Blurred today** counter shows at least 1.

---

## 6. Troubleshooting

### "Install from File" rejects the zip

- Confirm the zip was built from the repo root (so `manifest.json` is at the top level of the archive, not inside a subdirectory).
- Try repackaging: `cd smartscroller/ && zip -r ../smartscroller-v0.1.1.zip manifest.json background/ content/ options/ popup/ -x "*.DS_Store"`
- If Orion still rejects it, see the CWS-unlisted backup recipe below.

### Blur doesn't appear on YouTube Shorts

1. Confirm **Request Desktop Website** is on for `youtube.com` (Section 4 above).
2. Open the SmartScroller popup — verify the master toggle is **On**.
3. Check that at least one topic with keywords exists in the options page.
4. Open Orion's DevTools (if available) → Console → look for `SmartScroller` log lines.

### Extension disappears after Orion restart

1. Open **Orion → Extensions** — if SmartScroller is gone, reinstall from the zip (Section 3 above).
2. If it reappears but is disabled, tap the toggle to re-enable.

---

## 7. Backup install recipes

Use these only if **Install from File** ever stops working.

**Chrome Web Store (Unlisted)** — $5 one-time fee. Upload the zip to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), publish as **Unlisted**, then in Orion use **Install Chrome Extension** with the store listing URL. Orion recognizes CWS-hosted extensions. Full instructions: [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole).

**Xcode-wrapped Safari Web Extension** — $99/yr Apple Developer Program. Convert the MV3 extension with Xcode's "Convert Web Extension" wizard, sign, and distribute via TestFlight. Last resort only.

Both options are fallback only — use Install from File first.
