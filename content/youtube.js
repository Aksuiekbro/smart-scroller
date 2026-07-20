// SmartScroller YouTube adapter.
// Discovery and metadata extraction are YouTube-specific; moderation lives in
// content/classifier.js behind SmartScroller.start().

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
  const smallHandles = new WeakSet();
  let observer = null;
  let scanTimer = null;
  let sequence = 0;

  function txt(el, selectors) {
    if (!el) return '';
    for (const selector of selectors) {
      const node = el.querySelector(selector);
      const value = node?.textContent?.trim();
      if (value) return value;
    }
    return '';
  }

  function extractShortMeta(el) {
    const title = txt(el, [
      'yt-shorts-video-title-view-model',
      '.ytShortsVideoTitleViewModelHost',
      'h2.title yt-formatted-string',
      'h2.title',
      '.ytReelMetapanelViewModelTitle',
      '[id="title"]'
    ]);
    const author = txt(el, [
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
    return { title, author, description, hashtags };
  }

  function extractFeedMeta(el) {
    const title = txt(el, [
      'a#video-title-link',
      'yt-formatted-string#video-title',
      'a#video-title',
      '#video-title'
    ]);
    const author = txt(el, [
      'ytd-channel-name#channel-name a',
      '#channel-name a',
      '#text-container a',
      'ytd-channel-name a'
    ]);
    const description = txt(el, ['#description-text', '#metadata-line']);
    const hashtags = Array.from(el.querySelectorAll('a[href*="/hashtag/"]'))
      .map((a) => a.textContent.trim())
      .filter(Boolean);
    return { title, author, description, hashtags };
  }

  function toItem(el, meta, surface) {
    const text = [meta.title, meta.author, meta.description, ...meta.hashtags]
      .filter(Boolean)
      .join('\n');
    if (!text) return null;
    const link = el.querySelector('a[href*="/watch"], a[href*="/shorts/"]')?.href || '';
    sequence++;
    return {
      id: link || `youtube_${surface}_${sequence}`,
      platform: 'youtube',
      surface,
      text,
      authorKey: SS.hashAuthor(meta.author),
      links: link ? [link] : [],
      media: [{ kind: 'video', provenance: 'unknown' }],
      locale: document.documentElement.lang || undefined
    };
  }

  function isShortsShelf(el) {
    return Boolean(el.closest('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer'));
  }

  async function scan(emit) {
    const settings = await SS.loadSettings();
    const isShortsPage = location.pathname.startsWith('/shorts/');
    document.querySelectorAll(SHORT_SELECTORS).forEach((el) => {
      if (settings.sites?.youtube_shorts === false) return;
      const meta = extractShortMeta(el);
      const item = toItem(el, meta, 'shorts');
      if (item) emit({ handle: el, item });
    });
    document.querySelectorAll(FEED_SELECTORS).forEach((el) => {
      const inShelf = isShortsShelf(el);
      if (inShelf && settings.sites?.youtube_shorts === false) return;
      if (!inShelf && settings.sites?.youtube_home === false) return;
      const meta = extractFeedMeta(el);
      const item = toItem(el, meta, isShortsPage || inShelf ? 'shorts' : 'home');
      if (item) {
        if (!isShortsPage && !inShelf) smallHandles.add(el);
        emit({ handle: el, item });
      }
    });
  }

  function scheduleScan(emit) {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan(emit).catch((error) => console.debug?.('SmartScroller YouTube scan failed open', error));
    }, 250);
  }

  function reset() {
    document.querySelectorAll('[data-ss-state]').forEach((el) => SS.clear(el));
  }

  const adapter = {
    observe(emit) {
      const run = () => scan(emit).catch((error) => console.debug?.('SmartScroller YouTube scan failed open', error));
      observer = new MutationObserver(() => scheduleScan(emit));
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      let lastUrl = location.href;
      const navigationTimer = setInterval(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          scheduleScan(emit);
        }
      }, 400);
      run();
      return () => {
        observer?.disconnect();
        observer = null;
        clearInterval(navigationTimer);
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = null;
      };
    },
    present(handle, decision, onFeedback) {
      SS.present(handle, decision, onFeedback, { small: smallHandles.has(handle) });
    },
    reset
  };

  SS.start(adapter);
})()
