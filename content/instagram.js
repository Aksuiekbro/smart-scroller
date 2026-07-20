// SmartScroller Instagram adapter.
// Instagram class names change often, so discovery remains structural and
// deliberately fails open when a card is ambiguous.

(() => {
  const SS = globalThis.SmartScroller;
  if (!SS) return;

  let observer = null;
  let scanTimer = null;
  let sequence = 0;

  function isProfileLink(anchor) {
    const href = anchor.getAttribute('href') || '';
    return /^\/[A-Za-z0-9._]+\/?$/.test(href);
  }

  function findCard(videoEl) {
    let el = videoEl.closest('article');
    if (el && el.querySelector('a[href^="/"]')) return el;
    el = videoEl.closest('div[role="presentation"]');
    if (el && el.querySelector('a[href^="/"]')) return el;

    let node = videoEl.parentElement;
    let hops = 0;
    while (node && hops < 16) {
      const videoCount = node.querySelectorAll('video').length;
      const profileLink = Array.from(node.querySelectorAll('a[href^="/"]')).find(isProfileLink);
      const textLength = (node.textContent || '').trim().length;
      if (videoCount === 1 && profileLink && textLength > 80) return node;
      node = node.parentElement;
      hops++;
    }

    node = videoEl.parentElement;
    hops = 0;
    while (node && hops < 8) {
      const rect = node.getBoundingClientRect();
      if (rect.height >= 360 && rect.width >= 240) return node;
      node = node.parentElement;
      hops++;
    }
    return videoEl.parentElement;
  }

  function extractCaption(card) {
    const candidates = [
      ...card.querySelectorAll('h1'),
      ...card.querySelectorAll('h3'),
      ...card.querySelectorAll('div[role="button"] span'),
      ...card.querySelectorAll('span[dir="auto"]'),
      ...card.querySelectorAll('span')
    ];
    let best = '';
    for (const candidate of candidates) {
      const text = candidate.textContent?.trim() || '';
      if (text.length > best.length && text.length > 20 && text.length < 1200) best = text;
      if (best.length > 60) break;
    }
    return best;
  }

  function extractAuthor(card) {
    const old = card.querySelector(
      'header a[role="link"], a[role="link"][href^="/"]:not([href*="/p/"]):not([href*="/reel/"]):not([href*="/explore/"])'
    );
    if (old) return old.textContent?.trim() || old.getAttribute('href')?.replace(/\//g, '') || '';
    const profile = Array.from(card.querySelectorAll('a[href^="/"]')).find(isProfileLink);
    if (profile) return profile.textContent?.trim() || (profile.getAttribute('href') || '').replace(/^\/|\/$/g, '');
    return '';
  }

  function toItem(card) {
    const caption = extractCaption(card);
    const author = extractAuthor(card);
    const hashtags = caption.match(/#[\wÀ-￿]+/g) || [];
    const text = [caption, author, ...hashtags].filter(Boolean).join('\n');
    if (!text) return null;
    const link = card.querySelector('a[href*="/reel/"]')?.href || location.href;
    sequence++;
    return {
      id: link || `instagram_reels_${sequence}`,
      platform: 'instagram',
      surface: 'reels',
      text,
      authorKey: SS.hashAuthor(author),
      links: link ? [link] : [],
      media: [{ kind: 'video', provenance: 'unknown' }],
      locale: document.documentElement.lang || undefined
    };
  }

  async function scan(emit) {
    const settings = await SS.loadSettings();
    if (settings.sites?.instagram_reels === false) return;
    const seenCards = new Set();
    document.querySelectorAll('video').forEach((video) => {
      const card = findCard(video);
      if (!card || seenCards.has(card)) return;
      seenCards.add(card);
      const item = toItem(card);
      if (item) emit({ handle: card, item });
    });
  }

  function scheduleScan(emit) {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan(emit).catch((error) => console.debug?.('SmartScroller Instagram scan failed open', error));
    }, 300);
  }

  function reset() {
    document.querySelectorAll('[data-ss-state]').forEach((el) => SS.clear(el));
  }

  const adapter = {
    observe(emit) {
      const run = () => scan(emit).catch((error) => console.debug?.('SmartScroller Instagram scan failed open', error));
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
      SS.present(handle, decision, onFeedback);
    },
    reset
  };

  SS.start(adapter);
})()
