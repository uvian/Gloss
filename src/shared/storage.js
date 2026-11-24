/*
 * IFLL — Unified Storage, Wordbank Lazy Loader & Vocabulary State Manager
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  function getConstants() {
    return IFLL.constants;
  }
  function getUtils() {
    return IFLL.utils;
  }

  /* ── Core chrome.storage.sync + local wrapper ── */
  async function get() {
    const { DEFAULTS, LOCAL_KEYS } = getConstants();
    const syncDefaults = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (!LOCAL_KEYS.includes(k)) syncDefaults[k] = v;
    }
    const localDefaults = {};
    for (const k of LOCAL_KEYS) localDefaults[k] = DEFAULTS[k];

    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(syncDefaults),
      chrome.storage.local.get(localDefaults)
    ]);

    const merged = { ...DEFAULTS, ...syncData, ...localData };
    /* Auto-normalize stale dailyStats view if local date moved on */
    const today = getUtils().getLocalDateStr();
    if (merged.dailyStats && merged.dailyStats.date !== today) {
      merged.dailyStats = {
        date: today,
        replaceCount: 0,
        annotateCount: 0,
        translateChars: 0,
        clickedCount: 0,
        reviewedCount: 0,
        totalLearned: 0
      };
    }
    return merged;
  }

  async function set(partial) {
    const { LOCAL_KEYS } = getConstants();
    const syncPart = {};
    const localPart = {};
    for (const [k, v] of Object.entries(partial)) {
      if (LOCAL_KEYS.includes(k)) localPart[k] = v;
      else syncPart[k] = v;
    }
    const tasks = [];
    if (Object.keys(syncPart).length) tasks.push(chrome.storage.sync.set(syncPart));
    if (Object.keys(localPart).length) tasks.push(chrome.storage.local.set(localPart));
    if (tasks.length) await Promise.all(tasks);
  }

  async function migrateBigDataToLocal() {
    const { LOCAL_KEYS } = getConstants();
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get(LOCAL_KEYS),
      chrome.storage.local.get(LOCAL_KEYS)
    ]);
    const toLocal = {};
    const toRemove = [];
    for (const k of LOCAL_KEYS) {
      if (sync[k] !== undefined && local[k] === undefined) {
        toLocal[k] = sync[k];
        toRemove.push(k);
      } else if (sync[k] !== undefined && local[k] !== undefined) {
        toRemove.push(k);
      }
    }
    if (Object.keys(toLocal).length) await chrome.storage.local.set(toLocal);
    if (toRemove.length) await chrome.storage.sync.remove(toRemove);
  }

  /* ── Lazy Wordbank Loader (0 cost on disabled/excluded/off tabs) ── */
  let _wordBankPromise = null;
  let _wordBankCache = null;

  async function loadWordBank() {
    if (_wordBankCache) return _wordBankCache;
    if (!_wordBankPromise) {
      _wordBankPromise = (async () => {
        const url = chrome.runtime.getURL('src/data/wordbank.json');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Failed to load wordbank.json');
        const list = await resp.json();
        const zhMap = new Map();
        const enMap = new Map();

        for (const entry of list) {
          zhMap.set(entry.zh, entry);
          const enKey = (entry.en || '').toLowerCase().trim();
          if (!enKey) continue;
          const existing = enMap.get(enKey);
          if (!existing) {
            enMap.set(enKey, { ...entry, zhList: [entry.zh] });
          } else {
            if (!existing.zhList.includes(entry.zh)) {
              existing.zhList.push(entry.zh);
              existing.zhDisplay = existing.zhList.slice(0, 3).join(' / ');
            }
            if (!existing.ipa && entry.ipa) existing.ipa = entry.ipa;
            if (!existing.def && entry.def) existing.def = entry.def;
            if ((!existing.examples || !existing.examples.length) && entry.examples?.length) {
              existing.examples = entry.examples;
              existing.examplesCn = entry.examplesCn || [];
            }
          }
        }
        _wordBankCache = { list, zhMap, enMap };
        return _wordBankCache;
      })().catch((err) => {
        _wordBankPromise = null;
        throw err;
      });
    }
    return _wordBankPromise;
  }

  async function loadWordBankMeta() {
    const url = chrome.runtime.getURL('src/data/wordbank-meta.json');
    const resp = await fetch(url);
    if (!resp.ok) return { total: 0, ipaCount: 0, ipaCoverage: 0, levels: {} };
    return await resp.json();
  }

  function buildFullZhMap(baseZhMap, userWords = []) {
    const map = new Map(baseZhMap);
    for (const uw of userWords) {
      if (uw && uw.zh && uw.en) {
        map.set(uw.zh, { ...uw, isUserWord: true });
      }
    }
    return map;
  }

  function buildFullEnMap(baseEnMap, userWords = []) {
    const map = new Map(baseEnMap);
    for (const uw of userWords) {
      if (!uw || !uw.en || !uw.zh) continue;
      const enKey = uw.en.toLowerCase().trim();
      const existing = map.get(enKey);
      if (!existing) {
        map.set(enKey, { ...uw, zhList: [uw.zh], zhDisplay: uw.zh, isUserWord: true });
      } else {
        const zhList = existing.zhList ? [...existing.zhList] : [existing.zh];
        if (!zhList.includes(uw.zh)) zhList.unshift(uw.zh);
        map.set(enKey, { ...existing, zhList, zhDisplay: zhList.slice(0, 3).join(' / '), isUserWord: true });
      }
    }
    return map;
  }

  /* ── Site Mode Management ── */
  async function getModeForHost(hostname) {
    const { siteModes } = await get();
    return siteModes && hostname in siteModes ? siteModes[hostname] : null;
  }

  async function setModeForHost(hostname, mode) {
    const { siteModes } = await get();
    const next = { ...(siteModes || {}), [hostname]: mode };
    await set({ siteModes: next });
  }

  async function removeModeForHost(hostname) {
    const { siteModes } = await get();
    const next = { ...(siteModes || {}) };
    delete next[hostname];
    await set({ siteModes: next });
  }

  /* ── Effective Phrase Map (built-in collocations + user overrides - user deletions) ── */
  function resolvePhraseMap(settings) {
    const { DEFAULT_PHRASE_MAP } = getConstants();
    const disabled = new Set(settings.disabledDefaultPhrases || []);
    const merged = {};
    for (const [zh, en] of Object.entries(DEFAULT_PHRASE_MAP)) {
      if (!disabled.has(zh)) merged[zh] = en;
    }
    if (settings.phraseMap && typeof settings.phraseMap === 'object') {
      for (const [zh, en] of Object.entries(settings.phraseMap)) {
        if (zh && en) merged[zh] = en;
      }
    }
    return merged;
  }

  async function getEffectivePhraseMap() {
    const s = await get();
    return resolvePhraseMap(s);
  }

  async function setPhrase(zh, en) {
    const z = String(zh || '').trim();
    const e = String(en || '').trim();
    if (!z || !e) return false;
    const s = await get();
    const phraseMap = { ...(s.phraseMap || {}), [z]: e };
    const disabled = (s.disabledDefaultPhrases || []).filter(k => k !== z);
    await set({ phraseMap, disabledDefaultPhrases: disabled });
    return true;
  }

  async function removePhrase(zh) {
    const { DEFAULT_PHRASE_MAP } = getConstants();
    const s = await get();
    const phraseMap = { ...(s.phraseMap || {}) };
    delete phraseMap[zh];
    const disabled = new Set(s.disabledDefaultPhrases || []);
    if (zh in DEFAULT_PHRASE_MAP) disabled.add(zh);
    await set({ phraseMap, disabledDefaultPhrases: [...disabled] });
  }

  async function resetDefaultPhrases() {
    await set({ disabledDefaultPhrases: [] });
  }

  /* ── Daily Words (local date) ── */
  async function ensureDailyWords(wordBankList) {
    const s = await get();
    const today = getUtils().getLocalDateStr();
    const knownSet = new Set(s.knownWords || []);

    if (s.dailyWordDate === today && Array.isArray(s.dailyWords) && s.dailyWords.length) {
      const remaining = s.dailyWords.filter(w => w && !knownSet.has(w.zh) && w.zh.length >= 2);
      if (remaining.length) return remaining;
    }

    const list = wordBankList || (await loadWordBank()).list;
    const count = s.dailyWordCount || 15;
    const userWords = s.userWords || [];
    const candidates = [];

    const pushCandidate = (entry) => {
      if (!entry?.zh || !entry?.en || entry.zh.length < 2 || knownSet.has(entry.zh)) return;
      let score = Math.random() * 5;
      if (entry.level === s.level || entry.level === 'all') score += 12;
      if (entry.pos && ['verb', 'noun', 'adjective'].includes(entry.pos)) score += 6;
      if (entry.zh.length >= 3) score += 3;
      if (entry.examples?.length) score += 4;
      candidates.push({ zh: entry.zh, en: entry.en, score });
    };

    for (const entry of list) pushCandidate(entry);
    for (const uw of userWords) pushCandidate(uw);

    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates.slice(0, count).map(c => ({
      zh: c.zh, en: c.en, addedAt: Date.now()
    }));

    await set({ dailyWords: selected, dailyWordDate: today });
    return selected;
  }

  /* ── Vocabulary Learning State (Known / Review / User Words) ── */
  async function markKnown(zh) {
    if (!zh) return;
    const { knownWords, reviewQueue } = await get();
    const kw = Array.isArray(knownWords) ? [...knownWords] : [];
    const rq = Array.isArray(reviewQueue) ? reviewQueue.filter(w => w.zh !== zh) : [];
    if (!kw.includes(zh)) kw.push(zh);
    await set({ knownWords: kw, reviewQueue: rq });
  }

  async function markUnknown(zh) {
    if (!zh) return;
    const { knownWords } = await get();
    const kw = (knownWords || []).filter(w => w !== zh);
    await set({ knownWords: kw });
  }

  async function addToReview(zh, en, meta = {}) {
    if (!zh || !en) return false;
    const { reviewQueue, knownWords } = await get();
    const rq = Array.isArray(reviewQueue) ? [...reviewQueue] : [];
    const kw = (knownWords || []).filter(w => w !== zh);
    const existing = rq.find(w => w.zh === zh);
    if (existing) {
      existing.nextReview = Date.now();
      if (meta.def && !existing.def) existing.def = meta.def;
      if (meta.ipa && !existing.ipa) existing.ipa = meta.ipa;
      if (meta.context) existing.context = meta.context;
      if (meta.sourceUrl) existing.sourceUrl = meta.sourceUrl;
      if (meta.sourceTitle) existing.sourceTitle = meta.sourceTitle;
      await set({ reviewQueue: rq, knownWords: kw });
      return false;
    }
    rq.push({
      zh,
      en,
      def: meta.def || '',
      ipa: meta.ipa || '',
      pos: meta.pos || 'noun',
      pos_cn: meta.pos_cn || '名词',
      context: meta.context || '',
      sourceUrl: meta.sourceUrl || '',
      sourceTitle: meta.sourceTitle || '',
      examples: meta.examples || [],
      examplesCn: meta.examplesCn || [],
      addedAt: Date.now(),
      reviewCount: 0,
      nextReview: Date.now(),
      ease: 2.5
    });
    await set({ reviewQueue: rq, knownWords: kw });
    return true;
  }

  async function removeFromReview(zh) {
    const { reviewQueue } = await get();
    const rq = (reviewQueue || []).filter(w => w.zh !== zh);
    await set({ reviewQueue: rq });
  }

  async function scoreReview(zh, score) {
    const { reviewQueue } = await get();
    const rq = Array.isArray(reviewQueue) ? [...reviewQueue] : [];
    const idx = rq.findIndex(w => w.zh === zh);
    if (idx < 0) return null;
    rq[idx] = getUtils().sm2Next(rq[idx], score);
    await set({ reviewQueue: rq });
    try {
      chrome.runtime.sendMessage({ type: 'IFLL_TRACK_STAT', stat: 'review', count: 1 }).catch(() => {});
    } catch (_) {}
    return rq[idx];
  }

  async function getDueReviews() {
    const { reviewQueue } = await get();
    const now = Date.now();
    return (reviewQueue || [])
      .filter(w => (w.nextReview || 0) <= now)
      .sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0));
  }

  async function getReviewCount() {
    return (await getDueReviews()).length;
  }

  async function addUserWord(entry) {
    if (!entry?.zh || !entry?.en) return false;
    const { userWords } = await get();
    const list = Array.isArray(userWords) ? [...userWords] : [];
    const zh = entry.zh.trim();
    const en = entry.en.trim();
    if (!zh || !en) return false;
    const idx = list.findIndex(w => w.zh === zh);
    const normalized = {
      zh,
      en,
      def: (entry.def || '').trim(),
      ipa: (entry.ipa || '').trim(),
      pos: entry.pos || 'noun',
      pos_cn: entry.pos_cn || getConstants().POS_CN[entry.pos] || '名词',
      level: entry.level || 'cet4',
      cat: 'user',
      examples: Array.isArray(entry.examples) ? entry.examples : [],
      examplesCn: Array.isArray(entry.examplesCn) ? entry.examplesCn : [],
      addedAt: Date.now()
    };
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...normalized };
      await set({ userWords: list });
      return false;
    }
    list.push(normalized);
    await set({ userWords: list });
    return true;
  }

  async function addUserWordsBulk(entries, { alsoAddToReview = false, level = 'cet4' } = {}) {
    if (!Array.isArray(entries) || !entries.length) return { added: 0, skipped: 0 };
    const { userWords, reviewQueue, knownWords } = await get();
    const uList = Array.isArray(userWords) ? [...userWords] : [];
    const rList = Array.isArray(reviewQueue) ? [...reviewQueue] : [];
    const knownSet = new Set(knownWords || []);
    const existingZh = new Set(uList.map(w => w.zh));
    const existingReviewZh = new Set(rList.map(w => w.zh));

    let added = 0;
    let skipped = 0;
    const now = Date.now();

    for (const item of entries) {
      const zh = String(item?.zh || '').trim();
      const en = String(item?.en || '').trim();
      if (!zh || !en) { skipped++; continue; }
      if (!existingZh.has(zh)) {
        uList.push({
          zh,
          en,
          def: String(item.def || '').trim(),
          ipa: String(item.ipa || '').trim(),
          pos: item.pos || 'noun',
          pos_cn: item.pos_cn || getConstants().POS_CN[item.pos] || '名词',
          level,
          cat: 'user',
          examples: [],
          examplesCn: [],
          addedAt: now
        });
        existingZh.add(zh);
        added++;
      } else {
        skipped++;
      }
      if (alsoAddToReview && !existingReviewZh.has(zh)) {
        rList.push({
          zh,
          en,
          def: String(item.def || '').trim(),
          ipa: String(item.ipa || '').trim(),
          pos: item.pos || 'noun',
          pos_cn: item.pos_cn || getConstants().POS_CN[item.pos] || '名词',
          context: String(item.context || '').trim(),
          addedAt: now,
          reviewCount: 0,
          nextReview: now,
          ease: 2.5
        });
        existingReviewZh.add(zh);
        knownSet.delete(zh);
      }
    }

    const patch = { userWords: uList };
    if (alsoAddToReview) {
      patch.reviewQueue = rList;
      patch.knownWords = [...knownSet];
    }
    await set(patch);
    return { added, skipped };
  }

  async function removeUserWord(zh) {
    const { userWords } = await get();
    await set({ userWords: (userWords || []).filter(w => w.zh !== zh) });
  }

  /* ── AI Word Analysis Cache via SW IndexedDB ── */
  async function getAiCacheEntry(en) {
    if (!en) return null;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'IFLL_WORD_CACHE_GET', en: en.toLowerCase().trim() });
      return r?.hit ? r.entry : null;
    } catch (_) {
      return null;
    }
  }

  async function setAiCacheEntry(en, entry) {
    if (!en || !entry) return;
    try {
      await chrome.runtime.sendMessage({ type: 'IFLL_WORD_CACHE_SET', en: en.toLowerCase().trim(), entry });
    } catch (_) {}
  }

  async function clearAiCache(en) {
    if (!en) return;
    try {
      await chrome.runtime.sendMessage({ type: 'IFLL_WORD_CACHE_DEL', en: en.toLowerCase().trim() });
    } catch (_) {}
  }

  /* ── Export / Import with Schema Validation ── */
  async function exportAll({ includeApiKey = false } = {}) {
    const { LOCAL_KEYS, VERSION } = getConstants();
    const [syncAll, localBig] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(LOCAL_KEYS)
    ]);
    const merged = { ...syncAll, ...localBig };
    if (!includeApiKey) delete merged.apiKey;
    merged.__ifll_export_version = 2;
    merged.__ifll_app_version = VERSION;
    merged.__ifll_export_date = new Date().toISOString();
    return merged;
  }

  function validateImportData(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('配置文件格式无效（必须是 JSON 对象）');
    }
    const { IMPORT_ALLOWED_KEYS } = getConstants();
    const arrayKeys = new Set([
      'excludedSites', 'knownWords', 'reviewQueue', 'userWords',
      'disabledDefaultPhrases', 'dailyWords', 'customActions'
    ]);
    const objectKeys = new Set(['siteModes', 'phraseMap', 'dailyStats', 'learningHistory']);
    const boolKeys = new Set([
      'enabled', 'showFloatBall', 'enableSelToolbar',
      'enableHoverPreview', 'enableInputTranslate', 'enableFreeTranslateFallback'
    ]);
    const numberKeys = new Set(['dailyWordCount', 'voiceRate']);

    const clean = {};
    for (const k of IMPORT_ALLOWED_KEYS) {
      if (!(k in raw)) continue;
      const val = raw[k];
      if (arrayKeys.has(k) && !Array.isArray(val)) continue;
      if (objectKeys.has(k) && (!val || typeof val !== 'object' || Array.isArray(val))) continue;
      if (boolKeys.has(k) && typeof val !== 'boolean') continue;
      if (numberKeys.has(k) && (typeof val !== 'number' || Number.isNaN(val))) continue;
      clean[k] = val;
    }
    if (!Object.keys(clean).length) {
      throw new Error('文件中未找到有效的 IFLL 配置字段');
    }
    return clean;
  }

  async function importConfig(raw) {
    const clean = validateImportData(raw);
    await set(clean);
    return clean;
  }

  const storage = {
    get,
    set,
    migrateBigDataToLocal,
    loadWordBank,
    loadWordBankMeta,
    buildFullZhMap,
    buildFullEnMap,
    getModeForHost,
    setModeForHost,
    removeModeForHost,
    resolvePhraseMap,
    getEffectivePhraseMap,
    setPhrase,
    removePhrase,
    resetDefaultPhrases,
    ensureDailyWords,
    markKnown,
    markUnknown,
    addToReview,
    removeFromReview,
    scoreReview,
    getDueReviews,
    getReviewCount,
    addUserWord,
    addUserWordsBulk,
    removeUserWord,
    getAiCacheEntry,
    setAiCacheEntry,
    clearAiCache,
    exportAll,
    validateImportData,
    importConfig
  };

  IFLL.storage = storage;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = storage;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
