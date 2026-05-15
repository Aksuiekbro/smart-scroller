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
    return { title, author: channel, description, hashtags };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function applyBlur(el, meta, hits, opts = {}) {
    if (el.dataset.ssState === 'blurred' || el.dataset.ssState === 'revealed') return;
    el.classList.add('ss-blurred');
    el.dataset.ssState = 'blurred';

    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay' + (opts.small ? ' ss-overlay--small' : '');
    overlay.innerHTML = `
      <div class="ss-card">
        <div class="ss-eyebrow">Off-topic</div>
        <div class="ss-title">${escapeHtml(meta.title || '(untitled)')}</div>
        <div class="ss-author">${escapeHtml(meta.author || '')}</div>
        <div class="ss-actions">
          <button class="ss-btn ss-reveal" type="button">Show anyway</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => e.stopPropagation());
    overlay.querySelector('.ss-reveal').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      el.dataset.ssState = 'revealed';
      overlay.remove();
    });
    el.appendChild(overlay);
    SS.reportStat('blurred');
  }

  async function process(el, kind) {
    if (el.dataset.ssState) return;
    const meta = kind === 'short' ? extractShortMeta(el) : extractFeedMeta(el);
    // If we have no signal yet, leave it for the next pass — YouTube hydrates lazily.
    if (!meta.title && !meta.author) return;

    const sites = (await SS.loadSettings()).sites || {};
    const isShortsPage = location.pathname.startsWith('/shorts/');
    if (kind === 'short' && sites.youtube_shorts === false) return;
    if (kind === 'feed') {
      // Items inside the Shorts shelf on the home feed: treat as shorts toggle
      const inShortsShelf = el.closest('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer');
      if (inShortsShelf && sites.youtube_shorts === false) return;
      if (!inShortsShelf && sites.youtube_home === false) return;
    }

    el.dataset.ssState = 'checked';
    const result = await SS.classify(meta);
    if (!result.onTopic) {
      const small = kind === 'feed' && !isShortsPage;
      applyBlur(el, meta, result.hits, { small });
    } else {
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
      el.querySelector(':scope > .ss-overlay')?.remove();
      delete el.dataset.ssState;
    });
    scheduleScan();
  });

  scan();
})();
