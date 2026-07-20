// SmartScroller — YouTube content script
// Handles:
//   - Shorts on /shorts/* (ytd-reel-video-renderer)
//   - Home feed (ytd-rich-item-renderer) and search/related (ytd-video-renderer, ytd-compact-video-renderer)
//
// YouTube is a SPA, so we observe the DOM for added nodes and rescan on URL changes.
// Items get a data-ss-state attribute: "checked" once we've classified, "blurred" if
// off-topic, "revealed" if the user clicked "Show anyway".

(() => {
  const SS = globalThis.SmartScroller;
  if (!SS) return;

  const SHORT_SELECTORS = [
    'ytd-reel-video-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-shorts-lockup-view-model'
  ].join(',');

  const FEED_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer'
  ].join(',');

  function txt(el, selectors) {
    if (!el) return '';
    for (const sel of selectors) {
      const node = el.querySelector(sel);
      const t = node?.textContent?.trim();
      if (t) return t;
    }
    return '';
  }

  function extractShortMeta(el) {
    const title = txt(el, [
      // Current (mid-2026) Shorts title view-model — verified via live DOM probe
      'yt-shorts-video-title-view-model',
      '.ytShortsVideoTitleViewModelHost',
      // Older variants kept for backward compat
      'h2.title yt-formatted-string',
      'h2.title',
      '.ytReelMetapanelViewModelTitle',
      '[id="title"]'
    ]);
    const channel = txt(el, [
      'ytd-channel-name a',
      '.ytReelChannelBarViewModelChannelName',
      'a.ytReelChannelBarViewModelChannelNameLink',
      '#channel-name a'
    ]);
    const description = txt(el, [
      '#description',
      '.ytReelMetapanelViewModelDescription',
      'yt-formatted-string#description-text'
    ]);
    const hashtags = Array.from(el.querySelectorAll('a[href*="/hashtag/"]'))
      .map((a) => a.textContent.trim())
      .filter(Boolean);
    return { title, author: channel, description, hashtags };
  }

  function extractFeedMeta(el) {
    const title = txt(el, [
      'a#video-title-link',
      'yt-formatted-string#video-title',
      'a#video-title',
      '#video-title'
    ]);
    const channel = txt(el, [
      'ytd-channel-name#channel-name a',
      '#channel-name a',
      '#text-container a',
      'ytd-channel-name a'
    ]);
    const description = txt(el, ['#description-text', '#metadata-line']);
    const hashtags = Array.from(el.querySelectorAll('a[href*="/hashtag/"]'))
      .map((a) => a.textContent.trim())
      .filter(Boolean);
    const link = el.querySelector(
      'a#video-title-link, a#video-title, a[href*="/watch?v="], a[href^="/shorts/"]'
    );
    const url = link?.href || '';
    return { title, author: channel, description, hashtags, url };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findMenuButton(el) {
    const selectors = [
      'ytd-menu-renderer yt-icon-button button',
      'ytd-menu-renderer button[aria-label]',
      'button[aria-label*="Action menu" i]',
      'button[aria-label*="More actions" i]',
      '.dropdown-trigger > button'
    ];
    for (const sel of selectors) {
      const button = el.querySelector(sel);
      if (button) return button;
    }
    return null;
  }

  function findMenuItem(labels) {
    const lowered = labels.map((label) => label.toLowerCase());
    const candidates = Array.from(document.querySelectorAll(
      'ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model, [role="menuitem"]'
    ));
    return candidates.find((node) => {
      const text = (node.textContent || '').trim().toLowerCase();
      return lowered.some((label) => text.includes(label));
    });
  }

  async function sendYouTubeFeedback(el, labels) {
    const button = findMenuButton(el);
    if (!button) throw new Error('menu-not-found');
    button.click();
    await sleep(180);
    const item = findMenuItem(labels);
    if (!item) throw new Error('feedback-action-not-found');
    item.click();
    SS.reportStat('tuned');
    return true;
  }

  function buttonBusy(button, text) {
    button.disabled = true;
    button.textContent = text;
  }

  // --- Auto-steer (confirm-first) -------------------------------------------
  // Off-topic feed cards get marked data-ss-steer="queued". Nothing is sent to
  // YouTube until the user taps a card's button or the batch bar — that is the
  // dry-run/confirm-first contract. The batch send spaces clicks out so it never
  // fires a bot-like burst of menu interactions.
  let steerBar = null;

  function queuedCards() {
    return Array.from(document.querySelectorAll('[data-ss-steer="queued"]'));
  }

  function ensureSteerBar() {
    if (steerBar && document.body.contains(steerBar)) return steerBar;
    steerBar = document.createElement('div');
    steerBar.className = 'ss-steerbar';
    steerBar.innerHTML = `
      <span class="ss-steerbar-label"></span>
      <button class="ss-btn ss-steerbar-send" type="button">Send all</button>
      <button class="ss-btn ss-btn--ghost ss-steerbar-dismiss" type="button">Hide</button>
    `;
    steerBar.addEventListener('click', (e) => e.stopPropagation());
    steerBar.querySelector('.ss-steerbar-send').addEventListener('click', sendAllQueued);
    steerBar.querySelector('.ss-steerbar-dismiss').addEventListener('click', () => {
      steerBar.dataset.dismissed = '1';
      steerBar.style.display = 'none';
    });
    document.body.appendChild(steerBar);
    return steerBar;
  }

  function updateSteerBar() {
    const cards = queuedCards();
    if (!cards.length) {
      if (steerBar) {
        // A fresh batch later is allowed to re-show even after a dismiss.
        delete steerBar.dataset.dismissed;
        steerBar.style.display = 'none';
      }
      return;
    }
    const bar = ensureSteerBar();
    if (bar.dataset.dismissed) return;
    bar.style.display = 'flex';
    bar.querySelector('.ss-steerbar-label').textContent =
      `${cards.length} off-topic card${cards.length === 1 ? '' : 's'} ready to nudge`;
    bar.querySelector('.ss-steerbar-send').textContent =
      `Send “Not interested” ×${cards.length}`;
  }

  async function sendAllQueued() {
    const cards = queuedCards();
    const sendBtn = steerBar?.querySelector('.ss-steerbar-send');
    if (sendBtn) buttonBusy(sendBtn, 'Sending…');
    for (const el of cards) {
      try {
        await sendYouTubeFeedback(el, ['not interested']);
        el.dataset.ssSteer = 'sent';
        el.style.display = 'none';
      } catch (_) {
        el.dataset.ssSteer = 'failed';
      }
      // Human-like spacing between menu interactions.
      await sleep(420);
    }
    if (sendBtn) sendBtn.disabled = false;
    updateSteerBar();
  }

  function hideElement(el) {
    if (el.dataset.ssState === 'hidden') return;
    el.classList.add('ss-hidden');
    el.dataset.ssState = 'hidden';
    SS.reportStat('blurred');
  }

  function applyBlur(el, meta, hits, opts = {}) {
    if (el.dataset.ssState === 'blurred' || el.dataset.ssState === 'revealed') return;
    el.classList.add('ss-blurred');
    el.dataset.ssState = 'blurred';

    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }

    if (opts.steer) el.dataset.ssSteer = 'queued';

    // In steer mode the "Not interested" action is the primary, clearly-labelled CTA —
    // the user is confirming a real signal to YouTube, so it must not look incidental.
    const tuneClass = opts.steer ? 'ss-btn ss-tune ss-tune--primary' : 'ss-btn ss-btn--ghost ss-tune';
    const tuneLabel = opts.steer ? 'Send “Not interested”' : 'Not interested';
    const eyebrow = opts.steer
      ? 'Queued · Not interested'
      : (opts.reason === 'blocked' ? 'Avoid topic' : opts.reason === 'low-signal' ? 'Low signal' : 'Off-topic');
    const signalReason = opts.reason === 'low-signal'
      ? opts.decision?.reasons?.[0] || 'This item matched low-information patterns.'
      : '';

    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay' + (opts.small ? ' ss-overlay--small' : '');
    overlay.innerHTML = `
      <div class="ss-card">
        <div class="ss-eyebrow">${eyebrow}</div>
        <div class="ss-title">${escapeHtml(meta.title || '(untitled)')}</div>
        <div class="ss-author">${escapeHtml(meta.author || '')}</div>
        ${signalReason ? `<div class="ss-reasons">${escapeHtml(signalReason)}</div>` : ''}
        <div class="ss-actions">
          ${opts.canTune ? `<button class="${tuneClass}" type="button">${tuneLabel}</button>` : ''}
          ${meta.author ? '<button class="ss-btn ss-btn--ghost ss-avoid" type="button">Avoid channel</button>' : ''}
          <button class="ss-btn ss-reveal" type="button">Show</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => e.stopPropagation());
    overlay.querySelector('.ss-tune')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const button = e.currentTarget;
      buttonBusy(button, 'Tuning...');
      try {
        await sendYouTubeFeedback(el, ['not interested']);
        el.dataset.ssSteer = 'sent';
        el.style.display = 'none';
        updateSteerBar();
      } catch (_) {
        button.disabled = false;
        button.textContent = 'Use menu';
        button.title = 'Open the card menu and choose Not interested';
      }
    });
    overlay.querySelector('.ss-avoid')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const button = e.currentTarget;
      buttonBusy(button, 'Saved');
      await SS.addBlockedKeyword(meta.author);
    });
    overlay.querySelector('.ss-reveal').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      el.dataset.ssState = 'revealed';
      overlay.remove();
    });
    el.appendChild(overlay);
    SS.reportStat('blurred');
  }

  function applySignalLabel(el, result, small) {
    if (el.dataset.ssState === 'labeled' || el.dataset.ssState === 'revealed') return;
    el.classList.add('ss-labeled');
    el.dataset.ssState = 'labeled';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const decision = result.decision || {};
    const overlay = document.createElement('div');
    overlay.className = `ss-overlay ss-overlay--label${small ? ' ss-overlay--small' : ''}`;
    overlay.innerHTML = `
      <div class="ss-card">
        <div class="ss-eyebrow">Review</div>
        <div class="ss-title">${escapeHtml(decision.reasons?.[0] || 'This item may be low signal.')}</div>
        <div class="ss-reasons">${escapeHtml((decision.labels || []).slice(0, 3).join(' · '))}</div>
        <div class="ss-actions"><button class="ss-btn ss-reveal" type="button">Dismiss</button></div>
      </div>
    `;
    overlay.addEventListener('click', (event) => event.stopPropagation());
    overlay.querySelector('.ss-reveal').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.classList.remove('ss-labeled');
      el.dataset.ssState = 'revealed';
      overlay.remove();
    });
    el.appendChild(overlay);
    SS.reportStat('decision_label');
  }

  async function process(el, kind) {
    if (el.dataset.ssState) return;
    const meta = kind === 'short' ? extractShortMeta(el) : extractFeedMeta(el);
    // If we have no signal yet, leave it for the next pass — YouTube hydrates lazily.
    if (!meta.title && !meta.author) return;

    const settings = await SS.loadSettings();
    const sites = settings.sites || {};
    const isShortsPage = location.pathname.startsWith('/shorts/');
    const inShortsShelf = kind === 'feed'
      ? el.closest('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer')
      : null;
    if (kind === 'short') {
      if (sites.youtube_shorts === false) return;
      if (settings.blockShortsSurfaces) {
        hideElement(el);
        return;
      }
    }
    if (kind === 'feed') {
      // Items inside the Shorts shelf on the home feed: treat as shorts toggle
      if (inShortsShelf && sites.youtube_shorts === false) return;
      if (!inShortsShelf && sites.youtube_home === false) return;
      if (inShortsShelf && settings.blockShortsSurfaces) {
        hideElement(el);
        return;
      }
    }

    el.dataset.ssState = 'checked';
    if (settings.prehideUnknown) el.classList.add('ss-checking');
    const result = await SS.classify(meta);
    el.classList.remove('ss-checking');
    if (!result.onTopic) {
      const small = kind === 'feed' && !isShortsPage;
      const canTune = kind === 'feed';
      // Confirm-first auto-steer: queue a "Not interested" nudge the user can confirm.
      // Keep the card visible (overlay, not hard-hide) so they can see what they're about
      // to send; hard-hide still wins when auto-steer is off.
      const steer = settings.autoSteer && canTune;
      if (settings.hardHideOffTopic && !steer) {
        hideElement(el);
      } else {
        applyBlur(el, meta, result.hits, {
          small,
          reason: result.reason,
          decision: result.decision,
          canTune,
          steer
        });
        if (steer) updateSteerBar();
      }
    } else {
      if (result.reason === 'low-signal-label') {
        applySignalLabel(el, result, kind === 'feed' && !isShortsPage);
        return;
      }
      if (kind === 'feed' && result.reason === 'matched' && meta.url) {
        SS.queueCandidate({
          source: 'youtube',
          title: meta.title,
          author: meta.author,
          url: meta.url,
          topic: result.hits?.[0]?.topic || ''
        });
      }
      SS.reportStat('allowed');
    }
  }

  function scan() {
    document.querySelectorAll(SHORT_SELECTORS).forEach((el) => process(el, 'short'));
    document.querySelectorAll(FEED_SELECTORS).forEach((el) => process(el, 'feed'));
  }

  // Debounced rescans driven by mutations
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 250);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA navigation: YouTube swaps content without a full reload
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Reset state on URL change so re-rendered items get re-evaluated
      document.querySelectorAll('[data-ss-state]').forEach((el) => {
        // Only reset for items the new view won't display anymore — safe to leave existing blurs
      });
      scheduleScan();
    }
  }, 400);

  // Re-classify everything when settings change
  window.addEventListener('ss:settings-changed', () => {
    document.querySelectorAll('[data-ss-state]').forEach((el) => {
      el.classList.remove('ss-blurred');
      el.classList.remove('ss-checking');
      el.classList.remove('ss-hidden');
      el.querySelector(':scope > .ss-overlay')?.remove();
      delete el.dataset.ssState;
      delete el.dataset.ssSteer;
    });
    if (steerBar) {
      delete steerBar.dataset.dismissed;
      steerBar.style.display = 'none';
    }
    scheduleScan();
  });

  scan();
})();
