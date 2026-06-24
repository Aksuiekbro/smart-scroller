# Quick task: Auto-disinterest steering (confirm-first)

**Created:** 2026-06-24
**Type:** ad-hoc feature (out-of-roadmap). User explicitly authorized building directly,
outside the normal `/gsd-quick` flow, with `.planning/` synced by hand (this file).
**Branch:** codex/feed-steering-shield
**Status:** in progress

## Why

The user asked for "auto-watching" — turning the extension on so it automatically trains the
YouTube recommender toward useful topics and away from brain-rot. Research + the existing repo
stance (`README.md`: *"SmartScroller deliberately does not auto-watch videos..."*) and Mozilla's
RegretsReporter study (negative signals like "Not interested" / "Don't recommend channel" are the
only controls that meaningfully move recommendations) reframe this to **auto-disinterest**: act on
the classifier's off-topic verdict with YouTube's own native feedback control instead of literally
faking watch sessions.

Decision recorded with the user:
- **Mechanism:** auto-disinterest (auto "Not interested" on classified off-topic feed cards).
- **Autonomy:** confirm-first / dry-run — nothing is sent until the user taps. Highlights what it
  *would* do; user confirms per-card or via a batch "Send all" bar.

This is *not* literal auto-watch and does not change the no-auto-watch stance.

## Scope

- **YouTube feed cards only** (home/search/related). Instagram Reels has no native "Not interested"
  in the DOM; Shorts player has no reliable per-card menu (existing code already gates the manual
  nudge to `kind === 'feed'`).
- Reuses the existing `sendYouTubeFeedback(el, ['not interested'])` path in `content/youtube.js`.
- Fail-open: if the card menu DOM doesn't match (e.g. iPhone Orion `ytm-*` dialect, unverified
  until roadmap Phase 02), the per-card button falls back to "Use menu" and the batch marks the
  card failed — never throws, never breaks the feed.

## Changes

- `background/service-worker.js` — add `autoSteer: false` to `DEFAULTS`.
- `content/classifier.js` — read/expose `autoSteer` in `loadSettings()`.
- `content/youtube.js` — confirm-first queue: off-topic feed cards become `data-ss-steer="queued"`
  with a primary "Send 'Not interested'" button; a floating `.ss-steerbar` shows the count and a
  spaced (~420ms) batch "Send all". Auto-steer keeps cards visible (overlay) even if
  `hardHideOffTopic` is on, so the user can see what they're confirming.
- `content/common.css` — `.ss-tune--primary` + `.ss-steerbar` styles.
- `options/options.{html,js}` — "Auto-steer (confirm before sending)" checkbox.
- `popup/popup.{html,js}` — compact auto-steer quick toggle.
- `tests/extension.test.js` — SW seeds `autoSteer:false`; classifier exposes the flag.
- `README.md` — document the confirm-first auto-steer behavior.

## Out of scope (deliberately)

- Fully-automatic (no-confirm) sending and rate-limited-auto mode — user chose confirm-first.
- Literal background auto-watch / view-botting — rejected (ToS, account-flag, pollutes metrics).
- Instagram steering and Shorts-player steering.

## Verification

- `npm test` (node --test) green.
- On-device confirm-first behavior on iPhone Orion is a roadmap Phase 02 concern (mobile DOM
  dialect); the menu-click path is identical to the already-shipped manual button.
