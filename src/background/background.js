/*
 * IFLL — Background Entry Point (Chrome MV3 Service Worker + Firefox Desktop/Android Event Page, v0.5)
 */
if (typeof importScripts === 'function') {
  importScripts(
    '/src/shared/constants.js',
    '/src/shared/utils.js',
    '/src/shared/storage.js',
    '/src/background/cache-db.js',
    '/src/background/ai-client.js',
    '/src/background/batch-runner.js'
  );
}

const { constants, utils, storage, cacheDb, aiClient, batchRunner } = globalThis.IFLL;

const BADGE_ALARM = 'ifll-badge-refresh';

/* ── Extension Action Badge (shows SM-2 due review count) ── */
async function updateReviewBadge() {
  try {
    if (!chrome.action?.setBadgeText) return;
    const { reviewQueue } = await chrome.storage.local.get('reviewQueue');
    const now = Date.now();
    const due = Array.isArray(reviewQueue)
      ? reviewQueue.filter(w => (w.nextReview || 0) <= now).length
      : 0;
    await chrome.action.setBadgeText({ text: due > 0 ? (due > 99 ? '99+' : String(due)) : '' });
    if (due > 0 && chrome.action.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: '#2E5090' });
    }
  } catch (_) {}
}

/* ── Context Menus (right-click selection) ── */
function setupContextMenus() {
  if (!chrome.contextMenus) return;
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'ifll-ctx-translate',
        title: 'Gloss 翻译选中文本',
        contexts: ['selection']
      });
      chrome.contextMenus.create({
        id: 'ifll-ctx-card',
        title: 'Gloss 打开词卡与 AI 解析',
        contexts: ['selection']
      });
      chrome.contextMenus.create({
        id: 'ifll-ctx-review',
        title: 'Gloss 加入 SM-2 复习队列',
        contexts: ['selection']
      });
    });
  } catch (_) {}
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !info.selectionText) return;
    const map = {
      'ifll-ctx-translate': 'translate',
      'ifll-ctx-card': 'card',
      'ifll-ctx-review': 'review'
    };
    const action = map[info.menuItemId];
    if (!action) return;
    chrome.tabs.sendMessage(tab.id, {
      type: 'IFLL_CONTEXT_ACTION',
      action,
      text: info.selectionText.trim()
    }).catch(() => {});
  });
}

/* ── Install / Update / Startup ── */
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await storage.migrateBigDataToLocal();
    await cacheDb.migrateLegacyAiCache();

    const syncAll = await chrome.storage.sync.get(null);
    const patch = {};
    for (const [k, v] of Object.entries(constants.DEFAULTS)) {
      if (constants.LOCAL_KEYS.includes(k)) continue;
      if (!(k in syncAll)) patch[k] = v;
    }
    if (Object.keys(patch).length) await chrome.storage.sync.set(patch);

    const localAll = await chrome.storage.local.get(constants.LOCAL_KEYS);
    const localPatch = {};
    for (const k of constants.LOCAL_KEYS) {
      if (!(k in localAll)) localPatch[k] = constants.DEFAULTS[k];
    }
    if (Object.keys(localPatch).length) await chrome.storage.local.set(localPatch);

    setupContextMenus();
    if (chrome.alarms) chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 60 });
    await updateReviewBadge();
    await batchRunner.resumeIfPending();
  } catch (err) {
    console.warn('[IFLL SW] onInstalled error:', err);
  }
});

chrome.runtime.onStartup?.addListener(() => {
  updateReviewBadge();
  batchRunner.resumeIfPending();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) updateReviewBadge();
  else if (alarm.name === batchRunner.ALARM_NAME) batchRunner.resumeIfPending();
});

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes.reviewQueue) {
    updateReviewBadge();
  }
});

/* Refresh badge on SW wake */
updateReviewBadge();

/* ── Single-writer Daily Statistics + 60-day Learning History ── */
let statQueue = Promise.resolve();
function trackStat(stat, count = 1) {
  statQueue = statQueue.then(async () => {
    try {
      const [{ dailyStats }, { learningHistory }] = await Promise.all([
        chrome.storage.sync.get('dailyStats'),
        chrome.storage.local.get('learningHistory')
      ]);
      const today = utils.getLocalDateStr();
      const next = (dailyStats && dailyStats.date === today)
        ? { ...dailyStats }
        : {
            date: today,
            replaceCount: 0,
            annotateCount: 0,
            translateChars: 0,
            clickedCount: 0,
            reviewedCount: 0,
            totalLearned: 0
          };
      const delta = Number(count) || 0;
      if (stat === 'replace') next.replaceCount += delta;
      else if (stat === 'annotate') next.annotateCount += delta;
      else if (stat === 'translate') next.translateChars += delta;
      else if (stat === 'click') next.clickedCount += delta;
      else if (stat === 'review') next.reviewedCount += delta;
      next.totalLearned = next.clickedCount + next.reviewedCount;

      const hist = (learningHistory && typeof learningHistory === 'object') ? { ...learningHistory } : {};
      const dayRec = { ...(hist[today] || { learned: 0, reviewed: 0, replaced: 0 }) };
      if (stat === 'click') dayRec.learned += delta;
      else if (stat === 'review') dayRec.reviewed += delta;
      else if (stat === 'replace' || stat === 'annotate') dayRec.replaced += delta;
      hist[today] = dayRec;

      // Retain most recent 60 calendar days
      const keys = Object.keys(hist).sort();
      while (keys.length > 60) delete hist[keys.shift()];

      await Promise.all([
        chrome.storage.sync.set({ dailyStats: next }),
        chrome.storage.local.set({ learningHistory: hist })
      ]);
    } catch (_) {}
  });
  return statQueue;
}

/* ── Message Router ── */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  const handlers = {
    IFLL_AI_COMBINED: () => aiClient.analyzeWord({
      en: message.en, zh: message.zh, def: message.def, context: message.context, force: !!message.force
    }),
    IFLL_AI_TRANSLATE: () => aiClient.translateText(message.text, message.targetLang),
    IFLL_AI_TRANSLATE_BATCH: () => aiClient.translateBatch(message.texts, message.pageTitle),
    IFLL_SEL_TOOLBAR: () => aiClient.selectionAction(message.action, message.text),
    IFLL_CUSTOM_ACTION: () => aiClient.runCustomAction(message.action, message.en, message.zh, message.def, message.context),
    IFLL_TEST_API: () => aiClient.testConnection({
      apiKey: message.apiKey, apiEndpoint: message.apiEndpoint, apiModel: message.apiModel
    }),
    IFLL_LIST_MODELS: () => aiClient.listModels({
      apiKey: message.apiKey, apiEndpoint: message.apiEndpoint
    }),
    IFLL_TRACK_STAT: () => trackStat(message.stat, message.count).then(() => ({ ok: true })),
    IFLL_TRANSLATE_CACHE_GET: () => cacheDb.getTranslation(message.key),
    IFLL_TRANSLATE_CACHE_SET: () => cacheDb.setTranslation(message.key, message.value),
    IFLL_WORD_CACHE_GET: () => cacheDb.getWordAnalysis(message.en),
    IFLL_WORD_CACHE_SET: () => cacheDb.setWordAnalysis(message.en, message.entry),
    IFLL_WORD_CACHE_DEL: () => cacheDb.deleteWordAnalysis(message.en),
    IFLL_CACHE_STATS: () => cacheDb.getCacheStats(),
    IFLL_CACHE_CLEAR: () => cacheDb.clearAllCaches(),
    IFLL_BATCH_START: () => batchRunner.start(message.count, message.level),
    IFLL_BATCH_STOP: () => Promise.resolve(batchRunner.stop()),
    IFLL_BATCH_STATUS: () => Promise.resolve(batchRunner.getStatus()),
    IFLL_HAS_API_KEY: async () => {
      const { apiKey, enableFreeTranslateFallback } = await chrome.storage.sync.get(['apiKey', 'enableFreeTranslateFallback']);
      const hasApiKey = !!(apiKey && apiKey.trim());
      return { hasApiKey, canTranslate: hasApiKey || enableFreeTranslateFallback !== false };
    },
    IFLL_OPEN_DASHBOARD: async () => {
      const hash = message.tab ? '#' + message.tab : '';
      const url = chrome.runtime.getURL('src/dashboard/dashboard.html') + hash;
      try {
        const existing = await chrome.tabs.query({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') + '*' });
        if (existing.length && existing[0].id != null) {
          await chrome.tabs.update(existing[0].id, { active: true, url });
          if (existing[0].windowId != null && chrome.windows?.update) {
            await chrome.windows.update(existing[0].windowId, { focused: true }).catch(() => {});
          }
          return { ok: true };
        }
      } catch (_) {}
      await chrome.tabs.create({ url });
      return { ok: true };
    }
  };

  const fn = handlers[message.type];
  if (!fn) return;
  Promise.resolve()
    .then(fn)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err?.message || '后台处理异常' }));
  return true;
});

/* ── Streaming Port for Word Analysis ── */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ifll-stream') return;
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'IFLL_AI_COMBINED') {
      aiClient.streamWordAnalysis(port, {
        en: msg.en,
        zh: msg.zh,
        def: msg.def,
        context: msg.context || '',
        force: !!msg.force
      });
    }
  });
});

/* ── Keyboard Shortcuts (chrome.commands) ── */
if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) return;
      await chrome.tabs.sendMessage(tab.id, { type: 'IFLL_COMMAND', command }).catch(() => {});
    } catch (_) {}
  });
}
