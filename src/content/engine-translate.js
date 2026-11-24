/*
 * IFLL — Bilingual Translation Mode Engine (v0.4 — Micro-Batched & Zero-Key Ready)
 * Features:
 * - IntersectionObserver translates blocks ONLY as user scrolls near them
 * - Micro-batches up to 4 uncached viewport blocks into 1 LLM call (saves 60%+ Input Tokens)
 * - Passes document.title as context anchor for consistent terminology
 * - Supports zero-Key free fallback when apiKey is empty
 * - Valid inline-block span insertion inside block element (never breaks <ul>/Grid/Flex)
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, figcaption';
  const SKIP_ANCESTOR = 'nav, header, footer, aside, code, pre, script, style, noscript, form, button, [role="navigation"], [role="banner"], [role="contentinfo"], #ifll-shadow-host, .ifll-trans-panel';
  const MAX_BATCH_ITEMS = 4;
  const MAX_BATCH_CHARS = 1400;
  const BATCH_DEBOUNCE_MS = 140;
  const MAX_CONCURRENT_BATCHES = 2;

  let _running = false;
  let _hidden = false;
  let _io = null;
  let _mo = null;
  let _memCache = new Map();
  let _trackedBlocks = new WeakSet();
  let _pendingItems = [];     // [{ el, text }]
  let _batchTimer = null;
  let _batchQueue = [];       // array of arrays [{ el, text }]
  let _activeBatches = 0;

  function trimMemCache() {
    while (_memCache.size > 350) {
      _memCache.delete(_memCache.keys().next().value);
    }
  }

  function extractBlockText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.ifll-trans-panel, script, style').forEach(n => n.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function isTranslatableBlock(el) {
    if (!el || _trackedBlocks.has(el)) return false;
    if (el.closest(SKIP_ANCESTOR)) return false;
    if (el.querySelector('.ifll-trans-panel')) return false;
    if (!IFLL.domUtils.isElementVisible(el)) return false;
    if (el.querySelector(BLOCK_SELECTOR)) return false;

    const text = extractBlockText(el);
    const isHeading = /^H[1-6]$/.test(el.tagName);
    const minLen = isHeading ? 4 : 18;
    if (text.length < minLen || text.length > 3500) return false;
    if (!/[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}/.test(text)) return false;
    return true;
  }

  function createPanel(state, textOrError, onRetry) {
    const panel = document.createElement('span');
    panel.className = 'ifll-trans-panel';
    if (_hidden) panel.classList.add('ifll-trans-hidden');

    if (state === 'loading') {
      panel.classList.add('ifll-trans-loading');
      panel.textContent = '翻译中…';
    } else if (state === 'error') {
      panel.classList.add('ifll-trans-error');
      const msg = document.createElement('span');
      msg.textContent = textOrError || '翻译失败';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ifll-trans-retry';
      btn.textContent = '重试';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onRetry?.();
      });
      panel.appendChild(msg);
      panel.appendChild(btn);
    } else {
      panel.textContent = textOrError;
    }
    return panel;
  }

  function renderLoading(el) {
    _mo?.pause();
    const existing = el.querySelector(':scope > .ifll-trans-panel');
    const panel = createPanel('loading');
    if (existing) existing.replaceWith(panel);
    else el.appendChild(panel);
    _mo?.resume();
  }

  function renderResult(el, translation) {
    if (!el?.isConnected) return;
    _mo?.pause();
    const existing = el.querySelector(':scope > .ifll-trans-panel');
    const panel = createPanel('done', translation);
    if (existing) existing.replaceWith(panel);
    else el.appendChild(panel);
    _mo?.resume();
  }

  function renderError(el, text, errMsg) {
    if (!el?.isConnected) return;
    _mo?.pause();
    const existing = el.querySelector(':scope > .ifll-trans-panel');
    const panel = createPanel('error', errMsg, () => {
      _batchQueue.unshift([{ el, text }]);
      pumpBatches();
    });
    if (existing) existing.replaceWith(panel);
    else el.appendChild(panel);
    _mo?.resume();
  }

  async function processMicroBatch(items) {
    const alive = items.filter(it => it.el?.isConnected);
    if (!alive.length || !_running) return;

    // 1. Resolve cached entries immediately without touching network
    const needNet = [];
    for (const item of alive) {
      const mem = _memCache.get(item.text);
      if (mem) {
        renderResult(item.el, mem);
        continue;
      }
      const idb = await chrome.runtime.sendMessage({ type: 'IFLL_TRANSLATE_CACHE_GET', key: item.text }).catch(() => null);
      if (!_running) return;
      if (idb?.hit && idb.translation) {
        _memCache.set(item.text, idb.translation);
        trimMemCache();
        renderResult(item.el, idb.translation);
      } else {
        needNet.push(item);
      }
    }
    if (!needNet.length || !_running) return;

    for (const item of needNet) renderLoading(item.el);

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'IFLL_AI_TRANSLATE_BATCH',
        texts: needNet.map(i => i.text),
        pageTitle: document.title || ''
      });
      if (!_running) return;
      const results = Array.isArray(resp?.results) ? resp.results : [];
      let totalChars = 0;

      for (let i = 0; i < needNet.length; i++) {
        const item = needNet[i];
        if (!item.el.isConnected) continue;
        const r = results[i];
        if (r?.success && r.translation) {
          _memCache.set(item.text, r.translation);
          trimMemCache();
          renderResult(item.el, r.translation);
          totalChars += item.text.length;
        } else {
          renderError(item.el, item.text, r?.error || '翻译失败');
        }
      }
      if (totalChars > 0) {
        chrome.runtime.sendMessage({ type: 'IFLL_TRACK_STAT', stat: 'translate', count: totalChars }).catch(() => {});
      }
    } catch (err) {
      if (!_running) return;
      for (const item of needNet) {
        renderError(item.el, item.text, err?.message || '连接中断');
      }
    }
  }

  function pumpBatches() {
    while (_running && _activeBatches < MAX_CONCURRENT_BATCHES && _batchQueue.length > 0) {
      const batch = _batchQueue.shift();
      _activeBatches++;
      processMicroBatch(batch).finally(() => {
        _activeBatches--;
        pumpBatches();
      });
    }
  }

  function flushPendingIntoBatches() {
    _batchTimer = null;
    if (!_pendingItems.length || !_running) return;

    let current = [];
    let chars = 0;
    for (const item of _pendingItems) {
      if (
        current.length >= MAX_BATCH_ITEMS ||
        (current.length > 0 && chars + item.text.length > MAX_BATCH_CHARS)
      ) {
        _batchQueue.push(current);
        current = [];
        chars = 0;
      }
      current.push(item);
      chars += item.text.length;
    }
    if (current.length) _batchQueue.push(current);
    _pendingItems = [];
    pumpBatches();
  }

  function scheduleBlock(el) {
    if (!_running || !el.isConnected) return;
    const text = extractBlockText(el);
    if (!text) return;

    // Fast path for memory cache hit
    const mem = _memCache.get(text);
    if (mem) {
      renderResult(el, mem);
      return;
    }

    _pendingItems.push({ el, text });
    if (_pendingItems.length >= MAX_BATCH_ITEMS) {
      clearTimeout(_batchTimer);
      flushPendingIntoBatches();
    } else if (!_batchTimer) {
      _batchTimer = setTimeout(flushPendingIntoBatches, BATCH_DEBOUNCE_MS);
    }
  }

  function observeBlocksIn(rootEl) {
    if (!rootEl || !_io) return;
    const list = rootEl.matches?.(BLOCK_SELECTOR)
      ? [rootEl, ...rootEl.querySelectorAll(BLOCK_SELECTOR)]
      : Array.from(rootEl.querySelectorAll(BLOCK_SELECTOR));

    for (const el of list) {
      if (!isTranslatableBlock(el)) continue;
      _trackedBlocks.add(el);
      _io.observe(el);
    }
  }

  async function start() {
    stop();
    const keyResp = await chrome.runtime.sendMessage({ type: 'IFLL_HAS_API_KEY' }).catch(() => ({ hasApiKey: false, canTranslate: false }));
    if (!keyResp?.canTranslate) {
      IFLL.shadowUI?.showToast('对比翻译需要先配置 AI API Key（或开启免费兜底翻译）', 'warn');
      return false;
    }
    if (!keyResp.hasApiKey) {
      IFLL.shadowUI?.showToast('未配置 AI Key，已启用免费翻译引擎', 'info', 2600);
    }

    _running = true;
    _hidden = false;
    _trackedBlocks = new WeakSet();
    _pendingItems = [];
    _batchQueue = [];

    _io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        _io.unobserve(entry.target);
        scheduleBlock(entry.target);
      }
    }, { rootMargin: '300px 0px' });

    observeBlocksIn(document.body);

    _mo = IFLL.domUtils.createIncrementalObserver((roots) => {
      if (!_running) return;
      for (const r of roots) observeBlocksIn(r);
    }, 900);
    _mo.start();
    return true;
  }

  function toggleVisibility() {
    _hidden = !_hidden;
    document.querySelectorAll('.ifll-trans-panel').forEach(el => {
      el.classList.toggle('ifll-trans-hidden', _hidden);
    });
    return !_hidden;
  }

  function isVisible() {
    return !_hidden;
  }

  function stop() {
    _running = false;
    clearTimeout(_batchTimer);
    _batchTimer = null;
    _pendingItems = [];
    _batchQueue = [];
    if (_io) { _io.disconnect(); _io = null; }
    if (_mo) { _mo.stop(); _mo = null; }
    document.querySelectorAll('.ifll-trans-panel').forEach(el => el.remove());
  }

  const translateEngine = {
    start,
    stop,
    toggleVisibility,
    isVisible
  };

  IFLL.translateEngine = translateEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = translateEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
