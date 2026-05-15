// SmartScroller — Instagram content script
//
// Instagram's DOM is hostile: class names are hashed and change frequently, and
// Reels can render in three contexts:
//   1. /reels/<id>/ — single Reel view with vertical scroll between reels
//   2. /reels/ — Reels tab (grid of Reels under a profile or explore)
//   3. Reels mixed into the main feed (/) — as <article> blocks
//
// We use structural heuristics rather than class names:
//   - Look for elements containing a <video> AND a recognizable caption/header
//   - Walk up to a sensible "card" wrapper (closest article or role=presentation)
//   - Pull author from the nearest header link, caption from h1/h3/span containing #/@ or long text
//
// Worst case some non-Reel videos (Stories previews, IGTV) also get caught —
// that's acceptable; user can still click "Show anyway".

(() => {
  const SS = globalThis.SmartScroller;
  if (!SS) return;

  // IG redesigned: video container and metadata sidebar are now cousins, not parent/child.
  // The old "closest article / role=presentation" path no longer matches.
  // Verified via live DOM probe 2026-05-16: depths 1-6 above <video> contain only the player;
  // depth ~7-8 is where the metadata sidebar joins (profile link + caption spans appear).
  // Heuristic: walk up to the FIRST ancestor that contains exactly one video AND a profile
  // link (e.g. /username/) AND meaningful text content. Fall back to the older heuristics
  // for older IG layouts.
  function isProfileLink(a) {
    const href = a.getAttribute('href') || '';
    return /^\/[A-Za-z0-9._]+\/?$/.test(href);
  }

  function findCard(videoEl) {
    // Old paths first — cheap, harmless if they fail
    let el = videoEl.closest('article');
    if (el && el.querySelector('a[href^="/"]')) return el;
    el = videoEl.closest('div[role="presentation"]');
    if (el && el.querySelector('a[href^="/"]')) return el;

    // New layout: walk up looking for the wrapper that has video + profile link + text
    let node = videoEl.parentElement;
    let hops = 0;
    while (node && hops < 16) {
      const videoCount = node.querySelectorAll('video').length;
      const profileLink = Array.from(node.querySelectorAll('a[href^="/"]')).find(isProfileLink);
      const textLen = (node.textContent || '').trim().length;
      if (videoCount === 1 && profileLink && textLen > 80) {
        return node;
      }
      node = node.parentElement;
      hops++;
    }

    // Last resort: any reasonably-sized container
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
    // Caption can live in h1/h3 (older layouts) OR in long spans (current IG, May 2026).
    // Strategy: collect all text-bearing candidates, return the longest plausible one.
    const candidates = [
      ...card.querySelectorAll('h1'),
      ...card.querySelectorAll('h3'),
      ...card.querySelectorAll('div[role="button"] span'),
      ...card.querySelectorAll('span[dir="auto"]'),
      ...card.querySelectorAll('span') // fallback for current IG (no dir attr on caption spans)
    ];
    let best = '';
    for (const c of candidates) {
      const t = c.textContent?.trim() || '';
      // Skip aria-label noise ("Audio is muted", "Play button icon", etc.) — usually <30 chars
      if (t.length > best.length && t.length > 20 && t.length < 1200) best = t;
      if (best.length > 60) break;
    }
    return best;
  }

  function extractAuthor(card) {
    // Older layouts: header link or role=link
    const old = card.querySelector(
      'header a[role="link"], a[role="link"][href^="/"]:not([href*="/p/"]):not([href*="/reel/"]):not([href*="/explore/"])'
    );
    if (old) {
      return old.textContent?.trim() || old.getAttribute('href')?.replace(/\//g, '') || '';
    }
    // Current IG (May 2026): profile link with href=/username/
    const profile = Array.from(card.querySelectorAll('a[href^="/"]')).find(isProfileLink);
    if (profile) {
      const text = profile.textContent?.trim();
      if (text) return text;
      const href = profile.getAttribute('href') || '';
      return href.replace(/^\/|\/$/g, '');
    }
    return '';
  }

  function extractMeta(card) {
    const caption = extractCaption(card);
    const author = extractAuthor(card);
    const hashtags = (caption.match(/#[\wÀ-￿]+/g) || []);
    return {
      title: caption.slice(0, 200),
      author,
      description: caption,
      hashtags
    };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function applyBlur(card, meta) {
    if (card.dataset.ssState === 'blurred' || card.dataset.ssState === 'revealed') return;
    card.classList.add('ss-blurred');
    card.dataset.ssState = 'blurred';

    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay';
    overlay.innerHTML = `
      <div class="ss-card">
        <div class="ss-eyebrow">Off-topic</div>
        <div class="ss-title">${escapeHtml(meta.title || '(no caption)')}</div>
        <div class="ss-author">${escapeHtml(meta.author ? '@' + meta.author : '')}</div>
        <div class="ss-actions">
          <button class="ss-btn ss-reveal" type="button">Show anyway</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => e.stopPropagation());
    overlay.querySelector('.ss-reveal').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      card.dataset.ssState = 'revealed';
      overlay.remove();
    });
    card.appendChild(overlay);
    SS.reportStat('blurred');
  }

  async function process(card) {
    if (card.dataset.ssState) return;
    const meta = extractMeta(card);
    if (!meta.title && !meta.author) return; // Wait for hydration

    const sites = (await SS.loadSettings()).sites || {};
    if (sites.instagram_reels === false) return;

    card.dataset.ssState = 'checked';
    const result = await SS.classify(meta);
    if (!result.onTopic) {
      applyBlur(card, meta);
    } else {
      SS.reportStat('allowed');
    }
  }

  function scan() {
    // Every <video> on the page is a potential Reel
    const videos = document.querySelectorAll('video');
    const seenCards = new Set();
    videos.forEach((v) => {
      const card = findCard(v);
      if (!card || seenCards.has(card)) return;
      seenCards.add(card);
      process(card);
    });
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleScan();
    }
  }, 400);

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
