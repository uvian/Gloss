/*
 * IFLL — Service Worker IndexedDB Cache (Translations + AI Word Analysis)
 * Extension-origin storage shared across all tabs with O(1) indexed lookups
 * and automatic LRU eviction.
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const DB_NAME = 'ifll-cache-v2';
  const DB_VER = 1;
  const STORE_TX = 'translations';
  const STORE_WORD = 'word_analysis';
  const MAX_TX = 1000;
  const MAX_WORDS = 3000;

  let _dbPromise = null;

  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TX)) {
          const s = db.createObjectStore(STORE_TX, { keyPath: 'key' });
          s.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_WORD)) {
          const s = db.createObjectStore(STORE_WORD, { keyPath: 'key' });
          s.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => { _dbPromise = null; };
        db.onversionchange = () => { db.close(); _dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => {
        _dbPromise = null;
        reject(req.error);
      };
    });
    return _dbPromise;
  }

  function evictOldest(store, maxCount) {
    const countReq = store.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - maxCount;
      if (excess <= 0) return;
      const idx = store.index('updatedAt');
      const cur = idx.openCursor();
      let deleted = 0;
      cur.onsuccess = () => {
        const cursor = cur.result;
        if (!cursor || deleted >= excess) return;
        store.delete(cursor.primaryKey);
        deleted++;
        cursor.continue();
      };
    };
  }

  /* ── Translation Cache ── */
  async function getTranslation(key) {
    if (!key) return { hit: false };
    try {
      const db = await openDb();
      const rec = await new Promise((resolve) => {
        const tx = db.transaction(STORE_TX, 'readonly');
        const req = tx.objectStore(STORE_TX).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      if (rec && typeof rec.translation === 'string' && rec.translation) {
        return { hit: true, translation: rec.translation };
      }
      return { hit: false };
    } catch (_) {
      return { hit: false };
    }
  }

  async function setTranslation(key, translation) {
    if (!key || !translation) return { ok: false };
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_TX, 'readwrite');
        const store = tx.objectStore(STORE_TX);
        store.put({ key, translation, updatedAt: Date.now() });
        evictOldest(store, MAX_TX);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      return { ok: true };
    } catch (_) {
      return { ok: false };
    }
  }

  /* ── AI Word Analysis Cache ── */
  async function getWordAnalysis(en) {
    const key = String(en || '').toLowerCase().trim();
    if (!key) return { hit: false };
    try {
      const db = await openDb();
      const rec = await new Promise((resolve) => {
        const tx = db.transaction(STORE_WORD, 'readonly');
        const req = tx.objectStore(STORE_WORD).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      if (rec && rec.entry) {
        return { hit: true, entry: rec.entry };
      }
      return { hit: false };
    } catch (_) {
      return { hit: false };
    }
  }

  async function setWordAnalysis(en, entry) {
    const key = String(en || '').toLowerCase().trim();
    if (!key || !entry) return { ok: false };
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_WORD, 'readwrite');
        const store = tx.objectStore(STORE_WORD);
        store.put({ key, entry, updatedAt: Date.now() });
        evictOldest(store, MAX_WORDS);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      return { ok: true };
    } catch (_) {
      return { ok: false };
    }
  }

  async function deleteWordAnalysis(en) {
    const key = String(en || '').toLowerCase().trim();
    if (!key) return { ok: false };
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_WORD, 'readwrite');
        tx.objectStore(STORE_WORD).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return { ok: true };
    } catch (_) {
      return { ok: false };
    }
  }

  async function getAllCachedWordKeys() {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_WORD, 'readonly');
        const req = tx.objectStore(STORE_WORD).getAllKeys();
        req.onsuccess = () => resolve(new Set(req.result || []));
        req.onerror = () => resolve(new Set());
      });
    } catch (_) {
      return new Set();
    }
  }

  async function getCacheStats() {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction([STORE_TX, STORE_WORD], 'readonly');
        const r1 = tx.objectStore(STORE_TX).count();
        const r2 = tx.objectStore(STORE_WORD).count();
        let txCount = 0, wordCount = 0;
        r1.onsuccess = () => { txCount = r1.result; };
        r2.onsuccess = () => { wordCount = r2.result; };
        tx.oncomplete = () => resolve({ translations: txCount, words: wordCount });
        tx.onerror = () => resolve({ translations: 0, words: 0 });
      });
    } catch (_) {
      return { translations: 0, words: 0 };
    }
  }

  async function clearAllCaches() {
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction([STORE_TX, STORE_WORD], 'readwrite');
        tx.objectStore(STORE_TX).clear();
        tx.objectStore(STORE_WORD).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return { ok: true };
    } catch (_) {
      return { ok: false };
    }
  }

  /**
   * One-time migration from legacy monolithic chrome.storage.local.aiCache
   * (up to 7.5MB JSON blob) into indexed IndexedDB store.
   */
  async function migrateLegacyAiCache() {
    try {
      const { aiCache } = await chrome.storage.local.get('aiCache');
      if (!aiCache || typeof aiCache !== 'object') return 0;
      const entries = Object.entries(aiCache);
      if (!entries.length) {
        await chrome.storage.local.remove('aiCache');
        return 0;
      }
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_WORD, 'readwrite');
        const store = tx.objectStore(STORE_WORD);
        for (const [word, entry] of entries) {
          if (!word || !entry?.deep) continue;
          store.put({
            key: word.toLowerCase().trim(),
            entry,
            updatedAt: entry.deepCachedAt || Date.now()
          });
        }
        evictOldest(store, MAX_WORDS);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      await chrome.storage.local.remove('aiCache');
      return entries.length;
    } catch (_) {
      return 0;
    }
  }

  const cacheDb = {
    getTranslation,
    setTranslation,
    getWordAnalysis,
    setWordAnalysis,
    deleteWordAnalysis,
    getAllCachedWordKeys,
    getCacheStats,
    clearAllCaches,
    migrateLegacyAiCache
  };

  IFLL.cacheDb = cacheDb;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = cacheDb;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
