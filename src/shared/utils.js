/*
 * IFLL — Shared Pure Utilities (v0.4)
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  function getLocalDateStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function escapeHtml(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cssEscape(value) {
    const str = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(str);
    }
    return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~\s])/g, '\\$1');
  }

  function isExcludedHost(hostname, excludedSites) {
    if (!hostname || !Array.isArray(excludedSites) || !excludedSites.length) return false;
    const h = hostname.toLowerCase();
    return excludedSites.some(site => {
      if (!site || typeof site !== 'string') return false;
      const s = site.toLowerCase().trim();
      return s && (h === s || h.endsWith('.' + s));
    });
  }

  function detectTextLanguage(text) {
    if (!text || typeof text !== 'string') return 'other';
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (text.match(/[a-zA-Z]/g) || []).length;
    if (cjk === 0 && latin === 0) return 'other';
    if (cjk >= 2 && cjk / Math.max(1, cjk + latin * 0.45) >= 0.25) return 'zh';
    if (latin >= 4 && latin > cjk * 2) return 'en';
    return cjk >= latin ? 'zh' : 'en';
  }

  function normalizeEndpoint(endpoint) {
    let url = (endpoint || 'https://api.deepseek.com').trim();
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/chat\/completions$/i, '');
    url = url.replace(/\/models$/i, '');
    return url;
  }

  function shouldDisableThinking(endpoint, model) {
    const e = (endpoint || '').toLowerCase();
    const m = (model || '').toLowerCase();
    return /opencode\.ai/i.test(e) || /deepseek-v4|deepseek-reasoner/i.test(m);
  }

  function extractJson(text) {
    if (!text || typeof text !== 'string') return null;

    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

    const fence = cleaned.match(/```(?:json|\w+)?\s*\n?([\s\S]*?)```/i);
    if (fence) {
      cleaned = fence[1].trim();
    } else {
      cleaned = cleaned.replace(/```(?:json|\w+)?\s*\n?/gi, '').trim();
    }

    const start = cleaned.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let end = -1;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }

    const tryParse = (raw) => {
      if (!raw) return null;
      const noTrailing = raw.replace(/,(\s*[}\]])/g, '$1');
      try { return JSON.parse(noTrailing); } catch (_) {}
      let fixed = '';
      let str = false;
      let esc = false;
      for (let i = 0; i < noTrailing.length; i++) {
        const c = noTrailing[i];
        if (esc) { fixed += c; esc = false; continue; }
        if (c === '\\') { fixed += c; esc = true; continue; }
        if (c === '"') { fixed += c; str = !str; continue; }
        if (str && (c === '\n' || c === '\r')) { fixed += ' '; continue; }
        fixed += c;
      }
      try { return JSON.parse(fixed); } catch (_) { return null; }
    };

    if (end > start) {
      return tryParse(cleaned.slice(start, end));
    }

    let tail = cleaned.slice(start);
    if (inString) tail += '"';
    let openBraces = 0;
    let openBrackets = 0;
    let s2 = false, e2 = false;
    for (let i = 0; i < tail.length; i++) {
      const ch = tail[i];
      if (e2) { e2 = false; continue; }
      if (ch === '\\') { e2 = true; continue; }
      if (ch === '"') { s2 = !s2; continue; }
      if (s2) continue;
      if (ch === '{') openBraces++;
      else if (ch === '}') openBraces--;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
    }
    if (openBraces > 0 && openBraces <= 3 && openBrackets >= 0 && openBrackets <= 2) {
      tail = tail.replace(/,\s*$/, '') + ']'.repeat(openBrackets) + '}'.repeat(openBraces);
      return tryParse(tail);
    }
    return null;
  }

  function formatApiError(status, rawBody) {
    let detail = '';
    if (rawBody && typeof rawBody === 'string') {
      try {
        const obj = JSON.parse(rawBody);
        detail = obj?.error?.message || obj?.message || '';
      } catch (_) {
        detail = rawBody.trim().slice(0, 120);
      }
    }
    const brief = detail ? `（${detail.slice(0, 160)}）` : '';
    switch (status) {
      case 400: return `请求参数错误，请检查模型名称或接口地址${brief}`;
      case 401: return `API Key 无效或已过期，请在设置中检查${brief}`;
      case 402: return `API 账户余额不足，请充值后重试${brief}`;
      case 403: return `无访问权限，请检查 Key 权限或地区限制${brief}`;
      case 404: return `接口地址或模型不存在，请核对 API 地址与模型名${brief}`;
      case 429: return `请求过于频繁或触发限流，请稍后再试${brief}`;
      default:
        if (status >= 500) return `AI 服务端暂时异常 (HTTP ${status})，请稍后重试`;
        return `请求失败 (HTTP ${status})${brief}`;
    }
  }

  function sm2Next(item, score, now = Date.now()) {
    const DAY = 86400000;
    const easeAdj = { 4: 0.25, 3: 0.1, 2: -0.2, 1: -0.35 }[score] ?? 0;
    const ease = Math.max(1.3, Number(((item.ease || 2.5) + easeAdj).toFixed(2)));
    let reviewCount = item.reviewCount || 0;
    let intervalDays;

    if (score < 3) {
      reviewCount = 0;
      intervalDays = score === 1 ? 0.5 : 1;
    } else {
      reviewCount += 1;
      const baseIntervals = [1, 3, 7, 14, 30, 60, 120, 240, 365];
      const idx = Math.min(reviewCount - 1, baseIntervals.length - 1);
      const mult = score === 4 ? 1.3 : 1.0;
      intervalDays = Math.min(365, Math.max(1, Math.round(baseIntervals[idx] * (ease / 2.5) * mult)));
    }

    return {
      ...item,
      ease,
      reviewCount,
      lastReviewedAt: now,
      nextReview: now + Math.round(intervalDays * DAY)
    };
  }

  function renderBoldHtml(text) {
    if (!text) return '';
    let result = '';
    let lastIdx = 0;
    const regex = /\*\*(.+?)\*\*/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      result += escapeHtml(text.slice(lastIdx, m.index));
      result += '<strong class="ifll-bold">' + escapeHtml(m[1]) + '</strong>';
      lastIdx = regex.lastIndex;
    }
    result += escapeHtml(text.slice(lastIdx));
    return result;
  }

  async function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }

  function posLabel(pos) {
    const map = IFLL.constants?.POS_LABEL || { verb: 'v.', noun: 'n.', adjective: 'adj.', adverb: 'adv.', conjunction: 'conj.', phrase: 'phr.' };
    return map[pos] || (pos ? pos + '.' : 'n.');
  }

  function getLevelWeight(lvl) {
    const w = IFLL.constants?.LEVEL_WEIGHTS || { all: 0, daily: 1, cet4: 2, cet6: 3, ielts: 4, graduate: 5 };
    return w[lvl] ?? 99;
  }

  /**
   * Parse bulk vocabulary lines (supports TSV, CSV, "word - meaning", "中文, english").
   * Auto-detects column order so users can paste from Eudic / Shanbay / Momo / Anki directly.
   */
  function parseBulkWordList(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const lines = rawText.split(/\r?\n/);
    const out = [];
    const seen = new Set();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      let parts = null;
      if (line.includes('\t')) parts = line.split('\t');
      else if (line.includes(' - ')) parts = line.split(' - ');
      else if (line.includes('：')) parts = line.split('：');
      else if (line.includes(':')) parts = line.split(':');
      else if (line.includes('，')) parts = line.split('，');
      else if (line.includes(',')) parts = line.split(',');

      if (!parts || parts.length < 2) continue;
      const a = parts[0].trim().replace(/^["']|["']$/g, '');
      const b = parts[1].trim().replace(/^["']|["']$/g, '');
      const def = (parts[2] || '').trim().replace(/^["']|["']$/g, '');
      if (!a || !b) continue;

      const aIsZh = /[\u4e00-\u9fff]/.test(a);
      const bIsZh = /[\u4e00-\u9fff]/.test(b);
      let en, zh;
      if (aIsZh && !bIsZh) {
        zh = a; en = b;
      } else {
        en = a; zh = b;
      }

      if (!en || !zh) continue;
      // Skip obvious CSV header row
      if (/^(word|english|front|en)$/i.test(en) && /^(meaning|chinese|back|zh|释义|中文)$/i.test(zh)) continue;

      const key = `${en.toLowerCase()}::${zh}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ en, zh, def });
    }
    return out;
  }

  /**
   * Export vocabulary items into Anki-ready TSV (Front \t Back \t IPA \t Context \t Tags).
   */
  function buildAnkiTsv(items) {
    const cleanField = (v) => String(v || '').replace(/[\t\r\n]+/g, ' ').trim();
    const lines = [];
    for (const item of items || []) {
      if (!item?.en || !item?.zh) continue;
      const front = cleanField(item.en);
      const back = cleanField(item.zh + (item.def ? ` — ${item.def}` : ''));
      const ipa = cleanField(item.ipa || '');
      const ctx = cleanField(item.context || (Array.isArray(item.examples) ? item.examples[0] : '') || '');
      const tags = cleanField(['IFLL', item.level || ''].filter(Boolean).join(' '));
      lines.push([front, back, ipa, ctx, tags].join('\t'));
    }
    return lines.join('\n');
  }

  /**
   * Compute consecutive learning day streak from `learningHistory`.
   */
  function computeStreak(history = {}, todayDate = new Date()) {
    let streak = 0;
    const cursor = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    const todayKey = getLocalDateStr(cursor);
    const todayRec = history[todayKey];
    const hasToday = todayRec && ((todayRec.learned || 0) + (todayRec.reviewed || 0)) > 0;

    if (!hasToday) {
      // Allow streak to continue if yesterday was active (user hasn't studied yet today)
      cursor.setDate(cursor.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
      const k = getLocalDateStr(cursor);
      const rec = history[k];
      if (rec && ((rec.learned || 0) + (rec.reviewed || 0)) > 0) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  /**
   * Mask occurrences of `targetWord` (or its inflected/surface form) inside a sentence
   * for Cloze active-recall training.
   */
  function buildClozeSentence(sentence, targetWord, surfaceForm = '') {
    if (!sentence || !targetWord) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [];

    if (surfaceForm) patterns.push(new RegExp(`\\b${esc(surfaceForm)}\\b`, 'i'));
    patterns.push(new RegExp(`\\b${esc(targetWord)}\\b`, 'i'));

    const low = targetWord.toLowerCase();
    if (low.endsWith('is') && low.length >= 5) {
      patterns.push(new RegExp(`\\b${esc(low.slice(0, -2))}es\\b`, 'i')); // hypothesis -> hypotheses
    } else if (low.endsWith('on') && low.length >= 6) {
      patterns.push(new RegExp(`\\b${esc(low.slice(0, -2))}a\\b`, 'i')); // criterion -> criteria, phenomenon -> phenomena
    } else if (low.endsWith('us') && low.length >= 5) {
      patterns.push(new RegExp(`\\b${esc(low.slice(0, -2))}i\\b`, 'i')); // stimulus -> stimuli
    }
    if (low.length >= 5) {
      patterns.push(new RegExp(`\\b${esc(low.slice(0, -1))}[a-z]{0,4}\\b`, 'i'));
    }
    if (low.length >= 7) {
      patterns.push(new RegExp(`\\b${esc(low.slice(0, -2))}[a-z]{1,5}\\b`, 'i'));
    }

    for (const re of patterns) {
      const m = sentence.match(re);
      if (m) {
        const answer = m[0];
        const masked = sentence.slice(0, m.index) + '______' + sentence.slice(m.index + answer.length);
        return { masked, answer };
      }
    }
    return null;
  }

  const utils = {
    getLocalDateStr,
    escapeHtml,
    cssEscape,
    isExcludedHost,
    detectTextLanguage,
    normalizeEndpoint,
    shouldDisableThinking,
    extractJson,
    formatApiError,
    sm2Next,
    renderBoldHtml,
    copyText,
    posLabel,
    getLevelWeight,
    parseBulkWordList,
    buildAnkiTsv,
    computeStreak,
    buildClozeSentence
  };

  IFLL.utils = utils;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = utils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
