/*
 * IFLL — Input Box Quick Translate Enhancement (Read + Write Learning Loop)
 * Press Space × 3 rapidly (within 750ms) inside any text input/textarea/contenteditable
 * containing Chinese, OR press Alt+Y, to translate into idiomatic English with 1-click Undo.
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  let _enabled = false;
  let _bound = false;
  let _spaceTimes = [];
  let _translating = false;

  function isEligibleEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest?.('#ifll-shadow-host')) return false;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url'].includes(t) && !el.readOnly && !el.disabled;
    }
    return !!el.isContentEditable;
  }

  function readText(el) {
    return el.isContentEditable ? (el.innerText || el.textContent || '') : (el.value || '');
  }

  function writeText(el, nextText) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = nextText;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, nextText);
      else el.value = nextText;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async function translateFocusedInput(explicitEl = null, stripTrailingSpaces = false) {
    if (_translating) return false;
    const el = explicitEl || document.activeElement;
    if (!isEligibleEditable(el)) {
      IFLL.shadowUI?.showToast('请先将光标定位到输入框内', 'warn', 2000);
      return false;
    }

    const raw = readText(el);
    const cleaned = stripTrailingSpaces ? raw.replace(/\s+$/, '') : raw.trim();
    if (!cleaned || !/[\u4e00-\u9fff]/.test(cleaned)) return false;

    _translating = true;
    IFLL.shadowUI?.showToast('正在将输入内容译为英文…', 'info', 2500);

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'IFLL_AI_TRANSLATE',
        text: cleaned,
        targetLang: 'en'
      });
      if (res?.success && res.translation) {
        const original = cleaned;
        writeText(el, res.translation);
        IFLL.shadowUI?.showToast('已替换为英文译文', 'info', 4500, {
          actionLabel: '撤销',
          onAction: () => {
            if (el.isConnected) writeText(el, original);
          }
        });
        return true;
      } else {
        IFLL.shadowUI?.showToast(res?.error || '输入框翻译失败', 'warn', 3000);
        return false;
      }
    } catch (_) {
      IFLL.shadowUI?.showToast('输入框翻译连接失败', 'warn', 2500);
      return false;
    } finally {
      _translating = false;
    }
  }

  function onKeyDown(e) {
    if (!_enabled) return;
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key !== 'Shift') _spaceTimes = [];
      return;
    }
    const el = e.target;
    if (!isEligibleEditable(el)) return;

    const now = Date.now();
    _spaceTimes = _spaceTimes.filter(t => now - t < 750);
    _spaceTimes.push(now);

    if (_spaceTimes.length >= 3) {
      _spaceTimes = [];
      const cur = readText(el);
      if (/[\u4e00-\u9fff]/.test(cur)) {
        e.preventDefault();
        translateFocusedInput(el, true);
      }
    }
  }

  function configure(enabled) {
    _enabled = !!enabled;
    if (_enabled && !_bound) {
      document.addEventListener('keydown', onKeyDown, true);
      _bound = true;
    }
  }

  const inputEnhance = {
    configure,
    translateFocusedInput
  };

  IFLL.inputEnhance = inputEnhance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = inputEnhance;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
