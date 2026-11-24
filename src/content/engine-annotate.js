/*
 * IFLL — Annotate Mode Engine (English -> Dotted Underline + Chinese Card)
 * Features:
 * - Viewport-lazy IntersectionObserver (no global 80-word cap burned on navbars!)
 * - English lemmatization (matches inflected forms like studied/running/children)
 * - CSS Custom Highlight API (zero DOM mutation) with legacy <span> fallback
 * - Includes userWords, merged multi-sense definitions, link word click support & incremental SPA observer
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const HIGHLIGHT_NAME = 'ifll-annotate';
  const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, figcaption, td, th';
  const MAX_PER_BLOCK = 12;

  let _enMap = null;
  let _settings = null;
  let _knownSet = new Set();
  let _reviewEnSet = new Set();
  let _seenEnSet = new Set();
  let _hits = []; // [{ range, data, block }]
  let _processedBlocks = new WeakSet();
  let _io = null;
  let _mo = null;
  let _running = false;
  let _hoverBound = false;

  function supportsHighlightApi() {
    return typeof CSS !== 'undefined' && typeof Highlight === 'function' && !!CSS.highlights;
  }

  function rebuildHighlights() {
    if (!supportsHighlightApi()) return;
    const alive = [];
    const hl = new Highlight();
    for (const hit of _hits) {
      if (_knownSet.has(hit.data.zh)) continue;
      if (!hit.range.startContainer?.isConnected) continue;
      alive.push(hit);
      hl.add(hit.range);
    }
    _hits = alive;
    try {
      if (alive.length) CSS.highlights.set(HIGHLIGHT_NAME, hl);
      else CSS.highlights.delete(HIGHLIGHT_NAME);
    } catch (_) {}
  }

  function isCoarsePointer() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
      (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches);
  }

  function findHitAtPoint(x, y) {
    if (!_hits.length) return null;
    const pad = isCoarsePointer() ? 8 : 1;
    let bestHit = null;
    let bestDist = Infinity;
    for (const hit of _hits) {
      if (_knownSet.has(hit.data.zh)) continue;
      if (!hit.range.startContainer?.isConnected) continue;
      const rects = hit.range.getClientRects();
      for (const r of rects) {
        if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
          if (pad <= 1) return hit;
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist < bestDist) {
            bestDist = dist;
            bestHit = hit;
          }
        }
      }
    }
    return bestHit;
  }

  /* Lightweight throttled cursor feedback for Highlight API words (desktop fine pointer only) */
  let _lastHoverCheck = 0;
  function onHoverMove(e) {
    if (!_running || !_hits.length) return;
    const now = performance.now();
    if (now - _lastHoverCheck < 80) return;
    _lastHoverCheck = now;
    const hit = findHitAtPoint(e.clientX, e.clientY);
    document.body.classList.toggle('ifll-hl-pointer', !!hit);
  }

  function toTooltipData(entry, surface) {
    return {
      en: entry.en,
      surface: surface || entry.en,
      zh: entry.zh,
      zhDisplay: entry.zhDisplay || entry.zh,
      def: entry.def || '',
      pos: entry.pos || 'noun',
      posCn: entry.pos_cn || '名词',
      ipa: entry.ipa || '',
      level: entry.level || '',
      examples: JSON.stringify(entry.examples || []),
      examplesCn: JSON.stringify(entry.examplesCn || [])
    };
  }

  function annotateBlockHighlight(block) {
    const textNodes = IFLL.domUtils.collectTextNodes(block, (t) => /[a-zA-Z]{3,}/.test(t));
    let added = 0;

    for (const tn of textNodes) {
      if (added >= MAX_PER_BLOCK) break;
      const matches = IFLL.matcher.findEnglishMatches(tn.textContent, {
        enMap: _enMap,
        knownSet: _knownSet,
        reviewEnSet: _reviewEnSet,
        level: _settings.level,
        strategy: _settings.annotateStrategy || 'target_and_above',
        seenEnSet: _seenEnSet,
        limit: MAX_PER_BLOCK - added
      });

      for (const m of matches) {
        try {
          const range = document.createRange();
          range.setStart(tn, m.idx);
          range.setEnd(tn, m.end);
          _hits.push({ range, data: toTooltipData(m.entry, m.surface) });
          added++;
        } catch (_) {}
      }
    }

    if (added > 0) {
      rebuildHighlights();
      chrome.runtime.sendMessage({ type: 'IFLL_TRACK_STAT', stat: 'annotate', count: added }).catch(() => {});
    }
  }

  function annotateBlockLegacy(block) {
    const textNodes = IFLL.domUtils.collectTextNodes(block, (t) => /[a-zA-Z]{3,}/.test(t));
    let added = 0;

    _mo?.pause();
    try {
      for (const tn of textNodes) {
        if (added >= MAX_PER_BLOCK || !tn.parentNode) break;
        const text = tn.textContent;
        const matches = IFLL.matcher.findEnglishMatches(text, {
          enMap: _enMap,
          knownSet: _knownSet,
          reviewEnSet: _reviewEnSet,
          level: _settings.level,
          strategy: _settings.annotateStrategy || 'target_and_above',
          seenEnSet: _seenEnSet,
          limit: MAX_PER_BLOCK - added
        });
        if (!matches.length) continue;

        const frag = document.createDocumentFragment();
        let cursor = 0;
        for (const m of matches) {
          if (m.idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.idx)));
          const data = toTooltipData(m.entry, m.surface);
          const span = document.createElement('span');
          span.className = 'ifll-annotated';
          Object.assign(span.dataset, data);
          span.textContent = m.surface;
          span.title = data.zhDisplay;
          frag.appendChild(span);
          cursor = m.end;
          added++;
        }
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
        tn.parentNode.replaceChild(frag, tn);
      }
    } finally {
      _mo?.resume();
    }

    if (added > 0) {
      chrome.runtime.sendMessage({ type: 'IFLL_TRACK_STAT', stat: 'annotate', count: added }).catch(() => {});
    }
  }

  function annotateBlock(block) {
    if (!_running || !block || _processedBlocks.has(block)) return;
    _processedBlocks.add(block);
    if (!IFLL.domUtils.isElementVisible(block)) return;
    if (supportsHighlightApi()) annotateBlockHighlight(block);
    else annotateBlockLegacy(block);
  }

  function observeBlocksIn(rootEl) {
    if (!rootEl || !_io) return;
    const candidates = rootEl.matches?.(BLOCK_SELECTOR)
      ? [rootEl, ...rootEl.querySelectorAll(BLOCK_SELECTOR)]
      : Array.from(rootEl.querySelectorAll(BLOCK_SELECTOR));

    // Filter out chrome & avoid double-observing outer block when inner block exists
    for (const el of candidates) {
      if (_processedBlocks.has(el)) continue;
      if (el.closest('nav,header,footer,aside,code,pre,script,style,#ifll-shadow-host')) continue;
      if (el.querySelector(BLOCK_SELECTOR)) continue; // Leaf block only
      if (!/[a-zA-Z]{3,}/.test(el.textContent || '')) continue;
      _io.observe(el);
    }
  }

  async function start(settings, wordBank) {
    stop();
    _running = true;
    _settings = settings;
    _enMap = IFLL.storage.buildFullEnMap(wordBank.enMap, settings.userWords || []);
    _knownSet = new Set(settings.knownWords || []);
    _reviewEnSet = new Set((settings.reviewQueue || []).map(w => (w.en || '').toLowerCase().trim()).filter(Boolean));
    _seenEnSet = new Set();
    _hits = [];
    _processedBlocks = new WeakSet();

    if (supportsHighlightApi() && !isCoarsePointer() && !_hoverBound) {
      document.addEventListener('mousemove', onHoverMove, { passive: true });
      _hoverBound = true;
    }

    _io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        _io.unobserve(entry.target);
        annotateBlock(entry.target);
      }
    }, { rootMargin: '250px 0px' });

    observeBlocksIn(document.body);

    _mo = IFLL.domUtils.createIncrementalObserver((roots) => {
      if (!_running) return;
      for (const r of roots) observeBlocksIn(r);
    }, 900);
    _mo.start();
  }

  function markWordKnown(zh) {
    _knownSet.add(zh);
    if (supportsHighlightApi()) {
      rebuildHighlights();
    } else {
      const sel = `.ifll-annotated[data-zh="${IFLL.utils.cssEscape(zh)}"]`;
      document.querySelectorAll(sel).forEach(el => el.classList.add('ifll-known'));
    }
  }

  function stop() {
    _running = false;
    if (_io) { _io.disconnect(); _io = null; }
    if (_mo) { _mo.stop(); _mo = null; }
    if (_hoverBound) {
      document.removeEventListener('mousemove', onHoverMove);
      _hoverBound = false;
    }
    document.body?.classList?.remove('ifll-hl-pointer');

    if (_hits.length) {
      try { CSS.highlights?.delete?.(HIGHLIGHT_NAME); } catch (_) {}
      _hits = [];
    }

    const spans = Array.from(document.querySelectorAll('.ifll-annotated'));
    const parents = new Set();
    for (const el of spans) {
      if (!el.parentNode) continue;
      // Don't strip spans inside smooth-replaced sentences (handled by replaceEngine.stop)
      if (el.closest('.ifll-replaced')) continue;
      parents.add(el.parentNode);
      el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
    }
    for (const p of parents) {
      try { p.normalize(); } catch (_) {}
    }
    _seenEnSet.clear();
  }

  function resetForRoute() {
    if (!_running) return;
    _seenEnSet.clear();
    _processedBlocks = new WeakSet();
    rebuildHighlights();
    observeBlocksIn(document.body);
  }

  const annotateEngine = {
    start,
    stop,
    resetForRoute,
    findHitAtPoint,
    markWordKnown,
    supportsHighlightApi
  };

  IFLL.annotateEngine = annotateEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = annotateEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
