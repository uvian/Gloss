/*
 * IFLL — Content Script Bootstrap & SPA Lifecycle Coordinator (v0.4)
 */
(function () {
  'use strict';

  const { utils, storage, domUtils, replaceEngine, annotateEngine, translateEngine, inputEnhance, shadowUI } = globalThis.IFLL;

  let currentMode = 'off';
  let currentIsAuto = false;
  let currentSettings = null;
  let initialized = false;

  function stopAllEngines() {
    replaceEngine.stop();
    annotateEngine.stop();
    translateEngine.stop();
    shadowUI.closeTooltip();
  }

  async function applyMode(mode, { persist = false, silent = false, isAuto = false } = {}) {
    stopAllEngines();
    currentMode = mode;
    currentIsAuto = isAuto;

    const hostname = window.location.hostname;
    if (persist && hostname) {
      currentIsAuto = false;
      await storage.setModeForHost(hostname, mode);
    }

    const disabled = !currentSettings?.enabled || utils.isExcludedHost(hostname, currentSettings.excludedSites);
    inputEnhance.configure(!disabled && currentSettings?.enableInputTranslate !== false);

    if (disabled) {
      shadowUI.destroyUi();
      return;
    }

    shadowUI.configure(currentSettings, (nextMode, skipPersist = false) => {
      applyMode(nextMode, { persist: !skipPersist, isAuto: false });
    });
    shadowUI.updateFloatCapsule(mode, true);

    if (mode === 'off') return;

    if (mode === 'replace' || mode === 'annotate') {
      try {
        const wordBank = await storage.loadWordBank();
        if (currentMode !== mode) return;
        if (mode === 'replace') {
          await replaceEngine.start(currentSettings, wordBank);
        } else {
          await annotateEngine.start(currentSettings, wordBank);
        }
      } catch (err) {
        console.warn('[IFLL] engine start error:', err);
        if (!silent) shadowUI.showToast('词库加载失败，请刷新页面重试', 'warn');
      }
    } else if (mode === 'translate') {
      const ok = await translateEngine.start();
      if (!ok) {
        currentMode = 'off';
        shadowUI.updateFloatCapsule('off', true);
      }
    }
  }

  async function resolveInitialMode(settings) {
    const hostname = window.location.hostname;
    const savedHostMode = settings.siteModes && hostname in settings.siteModes
      ? settings.siteModes[hostname]
      : null;

    if (savedHostMode) return { mode: savedHostMode, isAuto: false };

    const sessionChoice = sessionStorage.getItem('ifll_session_mode_' + hostname);
    if (sessionChoice && ['replace', 'annotate', 'translate', 'off'].includes(sessionChoice)) {
      return { mode: sessionChoice, isAuto: false };
    }

    const pageLang = domUtils.detectPageLanguage();
    const suggested = pageLang === 'en' ? 'annotate' : (pageLang === 'zh' ? 'replace' : settings.defaultMode || 'off');
    const policy = settings.sitePolicy || 'auto';

    if (policy === 'manual') return { mode: 'off', isAuto: true };
    if (policy === 'auto') {
      return { mode: pageLang === 'other' ? 'off' : suggested, isAuto: true };
    }

    if (pageLang === 'other') return { mode: 'off', isAuto: true };
    const picked = await shadowUI.showWelcomePrompt(hostname, suggested);
    sessionStorage.setItem('ifll_session_mode_' + hostname, picked);
    if (picked !== 'off') {
      await storage.setModeForHost(hostname, picked);
    }
    return { mode: picked, isAuto: false };
  }

  /* Handle SPA route changes (GitHub / Zhihu / Reddit / X / Notion) */
  let _routeTimer = null;
  function handleRouteChange() {
    clearTimeout(_routeTimer);
    _routeTimer = setTimeout(async () => {
      if (!currentSettings?.enabled || utils.isExcludedHost(window.location.hostname, currentSettings.excludedSites)) return;
      domUtils.resetSceneCache();
      shadowUI.closeTooltip();

      if (currentIsAuto && currentSettings.sitePolicy === 'auto') {
        const next = await resolveInitialMode(currentSettings);
        if (next.mode !== currentMode) {
          await applyMode(next.mode, { persist: false, silent: true, isAuto: true });
          return;
        }
      }
      if (currentMode === 'annotate') {
        annotateEngine.resetForRoute();
      }
    }, 600);
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    currentSettings = await storage.get();
    shadowUI.configure(currentSettings, (nextMode, skipPersist = false) => {
      applyMode(nextMode, { persist: !skipPersist, isAuto: false });
    });

    const hostname = window.location.hostname;
    const disabled = !currentSettings.enabled || utils.isExcludedHost(hostname, currentSettings.excludedSites);
    inputEnhance.configure(!disabled && currentSettings.enableInputTranslate !== false);
    if (disabled) return;

    const { mode, isAuto } = await resolveInitialMode(currentSettings);
    await applyMode(mode, { persist: false, silent: true, isAuto });
    domUtils.watchRouteChange(handleRouteChange);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'IFLL_GET_ACTIVE_MODE') {
      sendResponse({ mode: currentMode, isAuto: currentIsAuto });
      return;
    }

    if (message.type === 'IFLL_SETTINGS_CHANGED') {
      (async () => {
        const prev = currentSettings;
        currentSettings = await storage.get();
        shadowUI.configure(currentSettings);
        const hostname = window.location.hostname;
        const disabled = !currentSettings.enabled || utils.isExcludedHost(hostname, currentSettings.excludedSites);
        inputEnhance.configure(!disabled && currentSettings.enableInputTranslate !== false);

        if (disabled) {
          stopAllEngines();
          shadowUI.destroyUi();
          return;
        }

        const needRestart =
          !prev ||
          prev.enabled !== currentSettings.enabled ||
          prev.frequency !== currentSettings.frequency ||
          prev.replaceStyle !== currentSettings.replaceStyle ||
          prev.level !== currentSettings.level ||
          prev.annotateStrategy !== currentSettings.annotateStrategy ||
          (prev.excludedSites || []).join(',') !== (currentSettings.excludedSites || []).join(',');

        if (needRestart) {
          const { mode, isAuto } = await resolveInitialMode(currentSettings);
          await applyMode(mode, { persist: false, silent: true, isAuto });
        } else {
          shadowUI.updateFloatCapsule(currentMode, true);
          shadowUI.applyTheme();
        }
      })();
      return;
    }

    if (message.type === 'IFLL_MODE_CHANGED') {
      (async () => {
        currentSettings = await storage.get();
        const mode = message.mode;
        sessionStorage.setItem('ifll_session_mode_' + window.location.hostname, mode);
        await applyMode(mode, { persist: false, isAuto: false });
      })();
      return;
    }

    if (message.type === 'IFLL_CONTEXT_ACTION') {
      shadowUI.handleContextAction(message.action, message.text);
      return;
    }

    if (message.type === 'IFLL_COMMAND') {
      (async () => {
        currentSettings = await storage.get();
        if (!currentSettings.enabled) return;

        if (message.command === 'toggle-translate') {
          if (currentMode === 'translate') {
            const visible = translateEngine.toggleVisibility();
            shadowUI.showToast(visible ? '已显示译文' : '已隐藏译文', 'info', 1600);
          } else {
            await applyMode('translate', { persist: true });
            shadowUI.showToast('已开启对比翻译', 'info', 1800);
          }
        } else if (message.command === 'cycle-mode') {
          const order = ['replace', 'annotate', 'translate', 'off'];
          const next = order[(order.indexOf(currentMode) + 1) % order.length];
          await applyMode(next, { persist: true });
          shadowUI.showToast('当前模式：' + (globalThis.IFLL.constants.MODE_LABELS[next] || next), 'info', 1800);
        } else if (message.command === 'translate-input') {
          await inputEnhance.translateFocusedInput();
        }
      })();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
