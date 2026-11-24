/*
 * IFLL — Replace Mode Engine (Chinese -> Inline English)
 * Fixes:
 * - Left-to-right Fragment assembly (never scrambles multi-word sentences!)
 * - Full original text preservation (100% lossless destroy() even after smooth sentence translation)
 * - Non-blocking bounded queue for fragmented sentence fallback
 * - Incremental MutationObserver (processes only newly added subtrees)
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  let _observer = null;
  let _aborted = false;
  let _statSeen = new Set();
  let _activeSettings = null;
  let _zhMap = null;
  let _enMap = null;
  let _phraseMap = {};
  let _dailyWordSet = new Set();
  let _dueReviewSet = new Set();

  /**
   * Pure DOM assembly: replaces sorted ascending non-overlapping matches inside `node`
   * from LEFT TO RIGHT, preserving exact original text order.
   */
  function replaceInTextNode(node, sortedMatches, dailyWordSet, dueReviewSet, doc = typeof document !== 'undefined' ? document : null, replaceStyle = 'inline') {
    if (!sortedMatches || !sortedMatches.length || !node?.parentNode || !doc) return false;
    const text = node.textContent;
    const ordered = [...sortedMatches].sort((a, b) => a.idx - b.idx);

    const wrapper = doc.createElement('span');
    wrapper.className = 'ifll-replaced';
    wrapper.dataset.originalZh = text;

    let cursor = 0;
    for (const m of ordered) {
      if (m.idx < cursor || m.end > text.length) continue;
      if (m.idx > cursor) {
        wrapper.appendChild(doc.createTextNode(text.slice(cursor, m.idx)));
      }
      if (replaceStyle === 'bilingual') {
        const zhNode = doc.createElement('span');
        zhNode.className = 'ifll-bilingual-zh';
        zhNode.textContent = m.zh;
        wrapper.appendChild(zhNode);
      }
      const span = doc.createElement('span');
      const classes = ['ifll-word'];
      if (replaceStyle === 'bilingual') classes.push('ifll-word-bilingual');
      if (m.isPhrase) classes.push('ifll-word-phrase');
      if (dailyWordSet?.has(m.zh)) classes.push('ifll-word-daily');
      if (dueReviewSet?.has(m.zh)) classes.push('ifll-word-review');
      span.className = classes.join(' ');
      span.dataset.en = m.en;
      span.dataset.zh = m.zh;
      span.dataset.def = m.def || '';
      span.dataset.pos = m.pos || 'noun';
      span.dataset.posCn = m.posCn || '名词';
      span.dataset.ipa = m.ipa || '';
      span.dataset.level = m.level || '';
      span.dataset.examples = JSON.stringify(m.examples || []);
      span.dataset.examplesCn = JSON.stringify(m.examplesCn || []);
      span.textContent = replaceStyle === 'bilingual' ? `(${m.en})` : m.en;
      wrapper.appendChild(span);
      cursor = m.end;
    }

    if (cursor < text.length) {
      wrapper.appendChild(doc.createTextNode(text.slice(cursor)));
    }

    node.parentNode.replaceChild(wrapper, node);
    return true;
  }

  /**
   * Populate an English smooth-translated sentence with clickable annotated vocabulary,
   * preserving `data-original-zh` on the outer wrapper so destroy() restores exact original Chinese.
   */
  function buildSmoothSentenceNode(originalZh, translation, enMap, doc = document) {
    const wrapper = doc.createElement('span');
    wrapper.className = 'ifll-replaced ifll-replaced-smooth';
    wrapper.dataset.originalZh = originalZh;
    wrapper.title = '原文：' + originalZh;

    const words = translation.split(/\b/);
    for (const chunk of words) {
      const hit = enMap ? IFLL.matcher.lookupEnglishLemma(chunk, enMap) : null;
      if (hit) {
        const entry = hit.entry;
        const s = doc.createElement('span');
        s.className = 'ifll-annotated';
        s.dataset.en = entry.en;
        s.dataset.zh = entry.zh;
        s.dataset.zhDisplay = entry.zhDisplay || entry.zh;
        s.dataset.def = entry.def || '';
        s.dataset.pos = entry.pos || 'noun';
        s.dataset.posCn = entry.pos_cn || '名词';
        s.dataset.ipa = entry.ipa || '';
        s.dataset.level = entry.level || '';
        s.dataset.examples = JSON.stringify(entry.examples || []);
        s.dataset.examplesCn = JSON.stringify(entry.examplesCn || []);
        s.textContent = chunk;
        wrapper.appendChild(s);
      } else {
        wrapper.appendChild(doc.createTextNode(chunk));
      }
    }
    return wrapper;
  }

  /**
   * Restore all replaced nodes in `rootEl` back to exact original Chinese text.
   */
  function restoreReplacedNodes(rootEl = typeof document !== 'undefined' ? document : null, doc = typeof document !== 'undefined' ? document : null) {
    if (!rootEl || !doc) return;
    const wrappers = Array.from(rootEl.querySelectorAll('.ifll-replaced'));
    const parents = new Set();
    for (const el of wrappers) {
      if (!el.parentNode) continue;
      let original = el.dataset.originalZh;
      if (original === undefined) {
        original = '';
        for (const child of el.childNodes) {
          if (child.nodeType === 3) original += child.textContent;
          else if (child.dataset?.zh) original += child.dataset.zh;
          else original += child.textContent || '';
        }
      }
      parents.add(el.parentNode);
      el.parentNode.replaceChild(doc.createTextNode(original), el);
    }
    for (const p of parents) {
      try { p.normalize(); } catch (_) {}
    }
  }

  /* Bounded non-blocking queue for fragmented sentence fallback */
  async function processSmoothQueue(tasks) {
    const MAX_SMOOTH = 8;
    const CONCURRENCY = 2;
    const slice = tasks.slice(0, MAX_SMOOTH);
    let idx = 0;

    async function worker() {
      while (idx < slice.length && !_aborted) {
        const task = slice[idx++];
        if (!task.placeholder?.isConnected) continue;
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'IFLL_AI_TRANSLATE',
            text: task.originalText
          });
          if (_aborted || !task.placeholder.isConnected) return;
          if (res?.success && res.translation) {
            _observer?.pause();
            const smooth = buildSmoothSentenceNode(task.originalText, res.translation, _enMap, document);
            task.placeholder.parentNode.replaceChild(smooth, task.placeholder);
            _observer?.resume();
          }
        } catch (_) {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slice.length) }, worker));
  }

  function injectInRoot(rootEl) {
    if (_aborted || !_activeSettings || !_zhMap || !rootEl) return;
    const knownSet = new Set(_activeSettings.knownWords || []);
    const scene = IFLL.domUtils.detectScene();

    const textNodes = IFLL.domUtils.collectTextNodes(rootEl, (t) => /[\u4e00-\u9fff]/.test(t));
    if (!textNodes.length) return;

    const newWords = new Set();
    const smoothQueue = [];

    _observer?.pause();
    try {
      for (const tn of textNodes) {
        if (!tn.isConnected || !tn.parentNode) continue;
        const text = tn.textContent;
        const budget = IFLL.matcher.getReplaceBudget(_activeSettings.frequency, text);
        if (budget <= 0) continue;

        const matches = IFLL.matcher.findChineseMatches(text, {
          zhMap: _zhMap,
          phraseMap: _phraseMap,
          knownSet,
          level: _activeSettings.level
        });
        if (!matches.length) continue;

        const selected = IFLL.matcher.selectReplacements(matches, budget, {
          scene,
          targetLevel: _activeSettings.level,
          dueReviewSet: _dueReviewSet,
          dailyWordSet: _dailyWordSet
        });
        if (!selected.length) continue;

        // Always perform instant inline replacement first (zero blocking);
        // if fragmented and API key exists, upgrade asynchronously to smooth sentence translation.
        const fragmented = _activeSettings.hasApiKey && IFLL.matcher.isFragmented(text, selected);
        const parent = tn.parentNode;
        const nextSibling = tn.nextSibling;

        replaceInTextNode(tn, selected, _dailyWordSet, _dueReviewSet, document);

        if (fragmented && parent) {
          const inserted = nextSibling ? nextSibling.previousSibling : parent.lastChild;
          if (inserted && inserted.classList?.contains('ifll-replaced')) {
            smoothQueue.push({ placeholder: inserted, originalText: text });
          }
        }

        for (const m of selected) {
          if (!_statSeen.has(m.zh)) {
            _statSeen.add(m.zh);
            newWords.add(m.zh);
          }
        }
      }
    } finally {
      _observer?.resume();
    }

    if (newWords.size > 0) {
      chrome.runtime.sendMessage({ type: 'IFLL_TRACK_STAT', stat: 'replace', count: newWords.size }).catch(() => {});
    }
    if (smoothQueue.length > 0) {
      processSmoothQueue(smoothQueue);
    }
  }

  async function start(settings, wordBank) {
    stop();
    _aborted = false;
    _statSeen = new Set();

    const hasKeyResp = await chrome.runtime.sendMessage({ type: 'IFLL_HAS_API_KEY' }).catch(() => ({ hasApiKey: false }));
    _activeSettings = { ...settings, hasApiKey: !!hasKeyResp?.hasApiKey };
    _zhMap = IFLL.storage.buildFullZhMap(wordBank.zhMap, settings.userWords || []);
    _enMap = IFLL.storage.buildFullEnMap(wordBank.enMap, settings.userWords || []);
    _phraseMap = IFLL.storage.resolvePhraseMap(settings);

    const daily = await IFLL.storage.ensureDailyWords(wordBank.list).catch(() => []);
    _dailyWordSet = new Set(daily.map(w => w.zh));

    const now = Date.now();
    _dueReviewSet = new Set(
      (settings.reviewQueue || [])
        .filter(w => (w.nextReview || 0) <= now)
        .map(w => w.zh)
    );

    injectInRoot(document.body);

    _observer = IFLL.domUtils.createIncrementalObserver((roots) => {
      if (_aborted) return;
      for (const r of roots) injectInRoot(r);
    }, 900);
    _observer.start();
  }

  function markWordKnownInDom(zh) {
    const sel = `.ifll-word[data-zh="${IFLL.utils.cssEscape(zh)}"]`;
    document.querySelectorAll(sel).forEach(el => el.classList.add('ifll-known'));
  }

  function stop() {
    _aborted = true;
    if (_observer) {
      _observer.stop();
      _observer = null;
    }
    restoreReplacedNodes(document, document);
    _statSeen.clear();
  }

  const replaceEngine = {
    start,
    stop,
    markWordKnownInDom,
    replaceInTextNode,
    buildSmoothSentenceNode,
    restoreReplacedNodes
  };

  IFLL.replaceEngine = replaceEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = replaceEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
