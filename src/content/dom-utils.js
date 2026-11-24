/*
 * IFLL — DOM Traversal, Semantic Filtering, Theme Detection & Incremental Observer
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option',
    'iframe', 'svg', 'code', 'pre', 'canvas', 'kbd', 'samp', 'math',
    'nav', 'header', 'footer', 'button',
    '[role="button"]', '[role="navigation"]', '[role="menubar"]', '[role="toolbar"]',
    '[contenteditable="true"]', '[contenteditable=""]',
    '.ifll-replaced', '.ifll-word', '.ifll-annotated', '.ifll-trans-panel', '#ifll-shadow-host'
  ].join(',');

  /**
   * Single O(depth) skip check for text nodes (fixes O(depth^2) nested closest() bug).
   */
  function shouldSkipTextNode(node, extraSelector = '') {
    const parent = node?.parentElement;
    if (!parent) return true;
    if (parent.closest(SKIP_SELECTOR)) return true;
    if (extraSelector && parent.closest(extraSelector)) return true;
    return false;
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  /**
   * Collect text nodes under `rootEl` matching `predicate(text)`.
   */
  function collectTextNodes(rootEl, predicate, extraSkipSelector = '') {
    if (!rootEl) return [];
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      if (!text || !text.trim()) continue;
      if (shouldSkipTextNode(node, extraSkipSelector)) continue;
      if (predicate && !predicate(text)) continue;
      out.push(node);
    }
    return out;
  }

  /**
   * Detect dominant language of the current page ('zh' | 'en' | 'other').
   */
  function detectPageLanguage() {
    if (!document.body) return 'other';
    // Prefer <main> / <article> if present to avoid noisy chrome
    const target = document.querySelector('article, main, [role="main"]') || document.body;
    const sample = (target.innerText || target.textContent || '').slice(0, 5000);
    return IFLL.utils.detectTextLanguage(sample);
  }

  /* Cached scene detection (computed once per page) */
  let _cachedScene = null;
  function detectScene() {
    if (_cachedScene) return _cachedScene;
    const host = window.location.hostname;
    if (/zhihu|weibo|bilibili|douban|xiaohongshu|tieba|reddit|quora|v2ex/i.test(host)) {
      _cachedScene = 'social';
      return _cachedScene;
    }
    if (/github|stackoverflow|stackexchange|npmjs|pypi|juejin|csdn|cnblogs|docs\.|developer\./i.test(host)) {
      _cachedScene = 'tech';
      return _cachedScene;
    }
    if (/arxiv|scholar\.google|cnki|researchgate|acm|ieee|nature\.com|science\.org/i.test(host)) {
      _cachedScene = 'academic';
      return _cachedScene;
    }
    const sample = (document.body?.innerText || document.body?.textContent || '').slice(0, 5000);
    const techHits = (sample.match(/\b(?:algorithm|function|api|git|deploy|database|compiler|framework)\b|代码|编程|架构|接口|算法/gi) || []).length;
    const acadHits = (sample.match(/\b(?:hypothesis|methodology|empirical|equation|theorem|citation)\b|实验|论文|研究|理论|综述/gi) || []).length;
    if (techHits >= 5) _cachedScene = 'tech';
    else if (acadHits >= 5) _cachedScene = 'academic';
    else _cachedScene = 'general';
    return _cachedScene;
  }

  function parseRgba(colorStr) {
    if (!colorStr) return null;
    const m = colorStr.match(/rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    return { r, g, b, a };
  }

  function isDarkRgb({ r, g, b }) {
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }

  /**
   * Accurate light/dark theme detection:
   * Checks explicit dark hints, then walks body -> html skipping transparent
   * backgrounds (fixes rgba(0,0,0,0) false dark bug!), then checks text luminance
   * and prefers-color-scheme.
   */
  function detectEffectiveTheme(preference = 'auto') {
    if (preference === 'dark' || preference === 'light') return preference;

    const docEl = document.documentElement;
    const dataTheme = (docEl.getAttribute('data-theme') || docEl.getAttribute('data-color-mode') || '').toLowerCase();
    if (dataTheme === 'dark') return 'dark';
    if (dataTheme === 'light') return 'light';
    if (docEl.classList.contains('dark') || document.body?.classList?.contains('dark')) return 'dark';

    const candidates = [document.body, docEl].filter(Boolean);
    for (const el of candidates) {
      const bg = parseRgba(getComputedStyle(el).backgroundColor);
      if (bg && bg.a > 0.15) {
        return isDarkRgb(bg) ? 'dark' : 'light';
      }
    }

    // Both body & html have transparent backgrounds: inspect body text color
    if (document.body) {
      const fg = parseRgba(getComputedStyle(document.body).color);
      if (fg && fg.a > 0.15) {
        // Light text implies dark page; dark text implies light page
        return isDarkRgb(fg) ? 'light' : 'dark';
      }
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * Incremental MutationObserver: queues only added Element subtrees, skips our own UI,
   * supports pause/resume while we mutate DOM.
   */
  function createIncrementalObserver(onRoots, debounceMs = 800) {
    let observer = null;
    let timer = null;
    let paused = false;
    const pendingRoots = new Set();

    const IGNORE_TAGS = /^(SCRIPT|STYLE|IFRAME|IMG|SVG|CANVAS|LINK|META|NOSCRIPT|INPUT|VIDEO|AUDIO)$/i;

    function flush() {
      timer = null;
      if (!pendingRoots.size) return;
      const roots = [];
      for (const el of pendingRoots) {
        if (!el.isConnected) continue;
        // Skip if an ancestor is already in pendingRoots
        let covered = false;
        for (const other of pendingRoots) {
          if (other !== el && other.contains(el)) { covered = true; break; }
        }
        if (!covered) roots.push(el);
      }
      pendingRoots.clear();
      if (roots.length) onRoots(roots);
    }

    function start() {
      if (observer || !document.body) return;
      observer = new MutationObserver((mutations) => {
        if (paused) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (IGNORE_TAGS.test(node.tagName)) continue;
              if (node.id === 'ifll-shadow-host' || node.classList?.contains('ifll-replaced') || node.classList?.contains('ifll-trans-panel') || node.classList?.contains('ifll-annotated')) continue;
              pendingRoots.add(node);
            } else if (node.nodeType === Node.TEXT_NODE && node.parentElement && node.textContent.trim()) {
              if (!node.parentElement.closest('#ifll-shadow-host,.ifll-replaced,.ifll-trans-panel,.ifll-annotated')) {
                pendingRoots.add(node.parentElement);
              }
            }
          }
        }
        if (pendingRoots.size) {
          clearTimeout(timer);
          timer = setTimeout(flush, debounceMs);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    function stop() {
      clearTimeout(timer);
      timer = null;
      pendingRoots.clear();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    function pause() { paused = true; }
    function resume() { paused = false; }

    return { start, stop, pause, resume };
  }

  function resetSceneCache() {
    _cachedScene = null;
  }

  /**
   * Extract the clean surrounding sentence containing `targetWord` (for contextual AI
   * explanation and saving real-world sentences into SM-2 flashcards).
   */
  function extractContextSentence(nodeOrEl, targetWord = '', maxLen = 160) {
    if (!nodeOrEl) return '';
    const el = nodeOrEl.nodeType === 3 ? nodeOrEl.parentElement : nodeOrEl;
    if (!el || !el.closest) return '';
    const block = el.closest('p, li, blockquote, dd, figcaption, td, h1, h2, h3, h4, h5, h6, article, div') || el;
    let raw = (block.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    if (raw.length <= maxLen) return raw;

    const sentences = raw.split(/(?<=[.!?。！？])\s*/).map(s => s.trim()).filter(Boolean);
    if (targetWord) {
      const low = targetWord.toLowerCase();
      const found = sentences.find(s => s.toLowerCase().includes(low));
      if (found) return found.length <= maxLen ? found : found.slice(0, maxLen - 1) + '…';
    }
    return raw.slice(0, maxLen - 1) + '…';
  }

  /**
   * Detect SPA route transitions (works in isolated content-script world where
   * host page history.pushState cannot be monkey-patched directly).
   */
  function watchRouteChange(onRouteChange) {
    let lastUrl = window.location.pathname + window.location.search;
    const check = () => {
      const cur = window.location.pathname + window.location.search;
      if (cur !== lastUrl) {
        lastUrl = cur;
        onRouteChange(cur);
      }
    };
    window.addEventListener('popstate', check);
    window.addEventListener('hashchange', check);
    const timer = setInterval(check, 1000);
    return () => {
      window.removeEventListener('popstate', check);
      window.removeEventListener('hashchange', check);
      clearInterval(timer);
    };
  }

  const domUtils = {
    SKIP_SELECTOR,
    shouldSkipTextNode,
    isElementVisible,
    collectTextNodes,
    detectPageLanguage,
    detectScene,
    resetSceneCache,
    extractContextSentence,
    watchRouteChange,
    parseRgba,
    isDarkRgb,
    detectEffectiveTheme,
    createIncrementalObserver
  };

  IFLL.domUtils = domUtils;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = domUtils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
