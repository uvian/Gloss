/*
 * IFLL — Unified AI API Client (v0.4)
 * Features:
 * - Context-aware word analysis (with current webpage sentence `contextMeaning`)
 * - Micro-batch paragraph translation (merges 2-5 blocks + pageTitle anchor, saves 60%+ tokens)
 * - Optional free zero-Key fallback translation when apiKey is not configured
 * - Instant upstream AbortController cancellation on streaming Port disconnect
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const COMBINED_SYSTEM = `You are an English lexicographer. Return ONLY valid JSON, no markdown, no extra text. Schema:
{"contextMeaning":"如果用户提供了原句语境，用1句简明中文解释该词在当前原句中的确切含义；未提供原句则留空字符串","synonyms":["replaceable synonym"],"antonyms":["true antonym, [] if none"],"collocations":["natural native collocation"],"usage":"简明中文用法说明（语域、搭配、易错点，1-2句）","examples":[{"en":"natural B1-B2 sentence","cn":"地道中文翻译，用**加粗**标出对应词"}]}
Provide 2-3 varied examples. Accuracy over quantity; never fabricate.`;

  async function resolveCredentials(override = {}) {
    const stored = await chrome.storage.sync.get(['apiKey', 'apiEndpoint', 'apiModel', 'enableFreeTranslateFallback']);
    const apiKey = (override.apiKey !== undefined ? override.apiKey : stored.apiKey || '').trim();
    const apiEndpoint = IFLL.utils.normalizeEndpoint(
      override.apiEndpoint !== undefined ? override.apiEndpoint : stored.apiEndpoint || IFLL.constants.DEFAULTS.apiEndpoint
    );
    const apiModel = (override.apiModel !== undefined ? override.apiModel : stored.apiModel || IFLL.constants.DEFAULTS.apiModel).trim();
    const enableFreeFallback = stored.enableFreeTranslateFallback !== false;
    return { apiKey, apiEndpoint, apiModel, enableFreeFallback };
  }

  function extractContent(data) {
    const msg = data?.choices?.[0]?.message;
    return (msg?.content || msg?.reasoning_content || '').trim();
  }

  const _openCodeSessions = new Map();

  function isOpenCodeEndpoint(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'opencode.ai' || host.endsWith('.opencode.ai');
    } catch (_) {
      return /opencode\.ai/i.test(String(url || ''));
    }
  }

  function makeSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return 'session-' + crypto.randomUUID();
    }
    return 'session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getOpenCodeSessionId(scope = 'default') {
    if (scope === 'test') return makeSessionId();
    if (!_openCodeSessions.has(scope)) {
      _openCodeSessions.set(scope, makeSessionId());
    }
    return _openCodeSessions.get(scope);
  }

  function buildRequestHeaders(baseUrl, apiKey, hasBody = false, scope = 'default') {
    const headers = { Authorization: 'Bearer ' + apiKey };
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (isOpenCodeEndpoint(baseUrl)) {
      headers['x-opencode-session'] = getOpenCodeSessionId(scope);
    }
    return headers;
  }

  async function apiFetch(baseUrl, path, apiKey, body, timeoutMs = 25000, externalSignal = null, scope = 'default') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);
    const onAbort = () => controller.abort(new Error('ABORTED'));
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(new Error('ABORTED'));
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const headers = buildRequestHeaders(baseUrl, apiKey, !!body, scope);
      return await fetch(baseUrl + path, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }

  async function callChat({ messages, temperature = 0.4, maxTokens = 1200, jsonMode = false, timeoutMs = 25000, externalSignal = null, override = {}, scope = 'default' }) {
    const { apiKey, apiEndpoint, apiModel } = await resolveCredentials(override);
    if (!apiKey) return { error: '请先在设置中配置 AI API Key', noKey: true };

    const payload = {
      model: apiModel,
      messages,
      temperature,
      max_tokens: maxTokens
    };
    if (jsonMode) payload.response_format = { type: 'json_object' };
    if (IFLL.utils.shouldDisableThinking(apiEndpoint, apiModel)) {
      payload.thinking = { type: 'disabled' };
    }

    try {
      const resp = await apiFetch(apiEndpoint, '/chat/completions', apiKey, payload, timeoutMs, externalSignal, scope);
      if (!resp.ok) {
        const raw = await resp.text().catch(() => '');
        if (resp.status === 400) {
          let retried = false;
          if (jsonMode && payload.response_format && /response_format/i.test(raw)) {
            delete payload.response_format;
            retried = true;
          }
          if (payload.thinking && /thinking|unknown|unsupported|extra/i.test(raw)) {
            delete payload.thinking;
            retried = true;
          }
          if (payload.temperature !== undefined && /temperature/i.test(raw)) {
            delete payload.temperature;
            retried = true;
          }
          if (retried) {
            const retry = await apiFetch(apiEndpoint, '/chat/completions', apiKey, payload, timeoutMs, externalSignal, scope);
            if (retry.ok) {
              const d2 = await retry.json();
              const c2 = extractContent(d2);
              return c2 ? { ok: true, content: c2 } : { error: 'AI 返回内容为空' };
            }
            const raw2 = await retry.text().catch(() => '');
            return { error: IFLL.utils.formatApiError(retry.status, raw2) };
          }
        }
        return { error: IFLL.utils.formatApiError(resp.status, raw) };
      }
      const data = await resp.json();
      const content = extractContent(data);
      if (!content) return { error: 'AI 返回内容为空，请重试或切换模型' };
      return { ok: true, content };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.message === 'ABORTED') {
        return { error: externalSignal?.aborted ? '已取消' : '请求超时，请检查网络或切换模型', aborted: !!externalSignal?.aborted };
      }
      return { error: '网络请求失败：' + (err?.message || '未知错误') };
    }
  }

  /* ── Zero-Key Free Fallback Translator (Google public gtx endpoint) ── */
  async function freeTranslateText(text, targetLang = null) {
    const clean = String(text || '').trim();
    if (!clean) return { error: '空文本' };
    const detected = IFLL.utils.detectTextLanguage(clean);
    const tl = targetLang || (detected === 'zh' ? 'en' : 'zh-CN');
    const sl = targetLang ? 'auto' : (detected === 'zh' ? 'zh-CN' : 'en');
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(clean)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) return { error: `免费翻译接口不可用 (HTTP ${resp.status})，建议配置 AI API Key` };
      const data = await resp.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        return { error: '免费翻译返回格式异常' };
      }
      const translation = data[0].map(seg => (Array.isArray(seg) ? seg[0] : '')).join('').trim();
      if (!translation) return { error: '翻译结果为空' };
      return { success: true, translation, engine: 'free' };
    } catch (err) {
      return { error: err?.name === 'AbortError' ? '免费翻译超时，建议配置 AI API Key' : '免费翻译网络失败，建议配置 AI API Key' };
    } finally {
      clearTimeout(timer);
    }
  }

  function hasUsableAnalysis(parsed) {
    return !!(
      parsed && (
        (typeof parsed.contextMeaning === 'string' && parsed.contextMeaning.trim()) ||
        (Array.isArray(parsed.synonyms) && parsed.synonyms.length) ||
        (Array.isArray(parsed.antonyms) && parsed.antonyms.length) ||
        (Array.isArray(parsed.collocations) && parsed.collocations.length) ||
        (typeof parsed.usage === 'string' && parsed.usage.trim()) ||
        (Array.isArray(parsed.examples) && parsed.examples.length)
      )
    );
  }

  function toCacheEntry(parsed) {
    const now = Date.now();
    return {
      deep: {
        synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms.filter(Boolean) : [],
        antonyms: Array.isArray(parsed.antonyms) ? parsed.antonyms.filter(Boolean) : [],
        collocations: Array.isArray(parsed.collocations) ? parsed.collocations.filter(Boolean) : [],
        usage: typeof parsed.usage === 'string' ? parsed.usage.trim() : ''
      },
      examples: Array.isArray(parsed.examples) ? parsed.examples.filter(e => e && e.en) : [],
      deepCachedAt: now,
      examplesCachedAt: now
    };
  }

  function buildWordUserPrompt(en, zh, def, context) {
    let p = `Word: "${en}"`;
    if (zh) p += ` (${zh}${def ? ', ' + def : ''})`;
    if (context && context.trim()) {
      p += `\nContext sentence: "${context.trim().slice(0, 220)}"`;
    }
    return p;
  }

  /* ── Combined Analysis (supports optional context sentence) ── */
  async function analyzeWord({ en, zh = '', def = '', context = '', force = false }) {
    const key = String(en || '').toLowerCase().trim();
    if (!key) return { error: '缺少目标单词' };
    const hasContext = !!(context && context.trim());

    if (!force && !hasContext) {
      const cached = await IFLL.cacheDb.getWordAnalysis(key);
      if (cached.hit && cached.entry?.deep) {
        return { success: true, data: cached.entry.deep, examples: cached.entry.examples || [], cached: true };
      }
    }

    const res = await callChat({
      messages: [
        { role: 'system', content: COMBINED_SYSTEM },
        { role: 'user', content: buildWordUserPrompt(en, zh, def, context) }
      ],
      temperature: 0.4,
      maxTokens: 1250,
      jsonMode: true,
      scope: 'word'
    });
    if (!res.ok) return { error: res.error };

    const parsed = IFLL.utils.extractJson(res.content);
    if (!parsed || !hasUsableAnalysis(parsed)) return { error: 'AI 返回格式无法解析，请重试' };

    const entry = toCacheEntry(parsed);
    await IFLL.cacheDb.setWordAnalysis(key, entry);
    return {
      success: true,
      data: entry.deep,
      examples: entry.examples,
      contextMeaning: typeof parsed.contextMeaning === 'string' ? parsed.contextMeaning.trim() : '',
      cached: false
    };
  }

  /* ── Streaming Combined Analysis via Port (aborts upstream on disconnect) ── */
  async function streamWordAnalysis(port, { en, zh = '', def = '', context = '', force = false }) {
    const key = String(en || '').toLowerCase().trim();
    const safePost = (msg) => {
      try { port.postMessage(msg); } catch (_) {}
    };

    if (!key) { safePost({ error: '缺少目标单词' }); return; }

    const hasContext = !!(context && context.trim());
    if (!force && !hasContext) {
      const cached = await IFLL.cacheDb.getWordAnalysis(key);
      if (cached.hit && cached.entry?.deep) {
        safePost({
          done: true,
          cached: true,
          data: cached.entry.deep,
          examples: cached.entry.examples || []
        });
        return;
      }
    }

    const { apiKey, apiEndpoint, apiModel } = await resolveCredentials();
    if (!apiKey) { safePost({ error: '请先在设置中配置 AI API Key' }); return; }

    const controller = new AbortController();
    let disconnected = false;
    const onDisconnect = () => {
      disconnected = true;
      controller.abort();
    };
    port.onDisconnect.addListener(onDisconnect);

    const timer = setTimeout(() => controller.abort(), 30000);
    const payload = {
      model: apiModel,
      messages: [
        { role: 'system', content: COMBINED_SYSTEM },
        { role: 'user', content: buildWordUserPrompt(en, zh, def, context) }
      ],
      temperature: 0.4,
      max_tokens: 1250,
      stream: true,
      response_format: { type: 'json_object' }
    };
    if (IFLL.utils.shouldDisableThinking(apiEndpoint, apiModel)) {
      payload.thinking = { type: 'disabled' };
    }

    try {
      const resp = await fetch(apiEndpoint + '/chat/completions', {
        method: 'POST',
        headers: buildRequestHeaders(apiEndpoint, apiKey, true, 'word'),
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!resp.ok) {
        const raw = await resp.text().catch(() => '');
        if (resp.status === 400 && /response_format|stream|thinking|temperature|unsupported|unknown/i.test(raw)) {
          const fallback = await analyzeWord({ en, zh, def, context, force: true });
          if (fallback.success) {
            safePost({
              done: true,
              cached: false,
              data: fallback.data,
              examples: fallback.examples,
              contextMeaning: fallback.contextMeaning || ''
            });
          } else {
            safePost({ error: fallback.error });
          }
          return;
        }
        safePost({ error: IFLL.utils.formatApiError(resp.status, raw) });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let contentAccum = '';
      let reasoningAccum = '';

      const processLine = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        try {
          const p = JSON.parse(data);
          const delta = p.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            reasoningAccum += delta.reasoning_content;
            safePost({ chunk: delta.reasoning_content, reasoning: true });
          }
          if (delta?.content) {
            contentAccum += delta.content;
            safePost({ chunk: delta.content, reasoning: false });
          }
        } catch (_) {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done || disconnected) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      }
      if (buffer && !disconnected) processLine(buffer);
      if (disconnected) return;

      const parsed = IFLL.utils.extractJson(contentAccum || reasoningAccum);
      if (parsed && hasUsableAnalysis(parsed)) {
        const entry = toCacheEntry(parsed);
        await IFLL.cacheDb.setWordAnalysis(key, entry);
        safePost({
          done: true,
          cached: false,
          data: entry.deep,
          examples: entry.examples,
          contextMeaning: typeof parsed.contextMeaning === 'string' ? parsed.contextMeaning.trim() : ''
        });
      } else {
        const fallback = await analyzeWord({ en, zh, def, context, force: true });
        if (fallback.success) {
          safePost({
            done: true,
            cached: false,
            data: fallback.data,
            examples: fallback.examples,
            contextMeaning: fallback.contextMeaning || ''
          });
        } else {
          safePost({ error: fallback.error || 'AI 返回格式无法解析' });
        }
      }
    } catch (err) {
      if (!disconnected) {
        safePost({ error: err?.name === 'AbortError' ? '请求超时，请重试' : '网络请求失败：' + (err?.message || '未知错误') });
      }
    } finally {
      clearTimeout(timer);
      try { port.onDisconnect.removeListener(onDisconnect); } catch (_) {}
    }
  }

  /* ── Single Text Translation (AI primary + optional zero-Key free fallback) ── */
  async function translateText(text, targetLang = null) {
    const clean = String(text || '').trim();
    if (!clean) return { error: '空文本' };

    const cacheKey = targetLang ? `[${targetLang}]${clean}` : clean;
    const cached = await IFLL.cacheDb.getTranslation(cacheKey);
    if (cached.hit) {
      return { success: true, translation: cached.translation, cached: true };
    }

    const { apiKey, enableFreeFallback } = await resolveCredentials();
    if (!apiKey) {
      if (!enableFreeFallback) return { error: '请先在设置中配置 AI API Key' };
      const free = await freeTranslateText(clean, targetLang);
      if (free.success) {
        await IFLL.cacheDb.setTranslation(cacheKey, free.translation);
      }
      return free;
    }

    const lang = IFLL.utils.detectTextLanguage(clean);
    const direction = targetLang === 'en'
      ? 'to natural, idiomatic English'
      : (targetLang === 'zh'
        ? 'to natural, fluent Simplified Chinese'
        : (lang === 'zh' ? 'from Chinese to natural, idiomatic English' : 'from English to natural, fluent Simplified Chinese'));
    const maxTokens = Math.min(4096, Math.max(512, Math.round(clean.length * 1.6)));

    const res = await callChat({
      messages: [
        {
          role: 'system',
          content: `Translate the user text ${direction}. Keep meaning accurate and phrasing natural. Output ONLY the translation itself, with no explanations, quotes, or prefixes.`
        },
        { role: 'user', content: clean }
      ],
      temperature: 0.25,
      maxTokens,
      jsonMode: false,
      timeoutMs: 30000,
      scope: 'translate'
    });

    if (!res.ok) return { error: res.error };

    let translation = res.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (translation.startsWith('{') && translation.endsWith('}')) {
      const maybe = IFLL.utils.extractJson(translation);
      if (maybe?.translation) translation = String(maybe.translation).trim();
    }
    if (!translation) return { error: '翻译结果为空' };

    await IFLL.cacheDb.setTranslation(cacheKey, translation);
    return { success: true, translation, cached: false, engine: 'ai' };
  }

  /**
   * Parse numbered JSON array response from micro-batch translation.
   * Exported for unit testing.
   */
  function parseBatchTranslations(content, expectedCount) {
    const parsed = IFLL.utils.extractJson(content);
    if (!parsed) return null;
    const arr = Array.isArray(parsed.translations) ? parsed.translations : null;
    if (!arr || arr.length !== expectedCount) return null;
    return arr.map(t => String(t ?? '').trim());
  }

  /* ── Micro-Batch Paragraph Translation (saves 60%+ Input Tokens & keeps consistent terminology) ── */
  async function translateBatch(texts, pageTitle = '') {
    if (!Array.isArray(texts) || !texts.length) return { results: [] };
    if (texts.length === 1) {
      const r = await translateText(texts[0]);
      return { results: [r], engine: r.engine };
    }

    const results = new Array(texts.length).fill(null);
    const uncachedIndices = [];

    for (let i = 0; i < texts.length; i++) {
      const clean = String(texts[i] || '').trim();
      if (!clean) { results[i] = { error: '空文本' }; continue; }
      const hit = await IFLL.cacheDb.getTranslation(clean);
      if (hit.hit) {
        results[i] = { success: true, translation: hit.translation, cached: true };
      } else {
        uncachedIndices.push(i);
      }
    }

    if (!uncachedIndices.length) return { results, engine: 'cache' };

    const { apiKey, enableFreeFallback } = await resolveCredentials();
    if (!apiKey) {
      if (!enableFreeFallback) {
        for (const i of uncachedIndices) results[i] = { error: '请先在设置中配置 AI API Key' };
        return { results };
      }
      await Promise.all(uncachedIndices.map(async (i) => {
        const clean = texts[i].trim();
        const r = await freeTranslateText(clean);
        if (r.success) await IFLL.cacheDb.setTranslation(clean, r.translation);
        results[i] = r;
      }));
      return { results, engine: 'free' };
    }

    const batchTexts = uncachedIndices.map(i => texts[i].trim());
    const combinedSample = batchTexts.join(' ');
    const lang = IFLL.utils.detectTextLanguage(combinedSample);
    const direction = lang === 'zh'
      ? 'Chinese to natural, idiomatic English'
      : 'English to natural, fluent Simplified Chinese';

    const numbered = batchTexts.map((t, idx) => `${idx + 1}. ${t}`).join('\n\n');
    const titleCtx = pageTitle ? `Page title context: "${pageTitle.slice(0, 120)}". ` : '';
    const maxTokens = Math.min(4096, Math.max(800, Math.round(combinedSample.length * 1.65)));

    const res = await callChat({
      messages: [
        {
          role: 'system',
          content: `${titleCtx}Translate each numbered paragraph from ${direction} consistently and naturally. Return ONLY valid JSON: {"translations":["translation for 1","translation for 2",...]} with EXACTLY ${batchTexts.length} items in the same order.`
        },
        { role: 'user', content: numbered }
      ],
      temperature: 0.25,
      maxTokens,
      jsonMode: true,
      timeoutMs: 35000,
      scope: 'translate'
    });

    if (res.ok) {
      const arr = parseBatchTranslations(res.content, batchTexts.length);
      if (arr) {
        for (let k = 0; k < uncachedIndices.length; k++) {
          const origIdx = uncachedIndices[k];
          const tr = arr[k];
          if (tr) {
            await IFLL.cacheDb.setTranslation(batchTexts[k], tr);
            results[origIdx] = { success: true, translation: tr, cached: false, engine: 'ai' };
          } else {
            results[origIdx] = { error: '段落译文为空' };
          }
        }
        return { results, engine: 'ai' };
      }
    }

    // Safe per-item fallback if micro-batch JSON misaligned
    for (const i of uncachedIndices) {
      results[i] = await translateText(texts[i]);
    }
    return { results, engine: 'ai' };
  }

  /* ── Selection Toolbar (Translate / Explain) ── */
  async function selectionAction(action, text) {
    const clean = String(text || '').trim();
    if (!clean) return { error: '未选中文本' };

    if (action === 'translate') {
      const r = await translateText(clean);
      return r.success ? { text: r.translation, cached: r.cached, engine: r.engine } : { error: r.error };
    }

    const lang = IFLL.utils.detectTextLanguage(clean);
    const prompt = lang === 'zh'
      ? '用简洁清晰的中文解释这段内容的核心含义，并给出最地道的英文表达（含1个简短例句）。控制在150字以内。'
      : '用简洁清晰的中文解释这段英文的含义、关键词汇或语法要点。控制在180字以内，直入主题。';

    const res = await callChat({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: clean }
      ],
      temperature: 0.35,
      maxTokens: 700,
      jsonMode: false,
      scope: 'selection'
    });
    if (!res.ok) return { error: res.error };
    return { text: res.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() };
  }

  /* ── Custom User-Defined AI Action ── */
  async function runCustomAction(action, en, zh, def = '', context = '') {
    let prompt = (action?.prompt || '用中文解析单词 {word}').trim();
    prompt = prompt
      .replace(/\{word\}/g, en || '')
      .replace(/\{zh\}/g, zh || '')
      .replace(/\{def\}/g, def || '')
      .replace(/\{context\}/g, context || '');
    const fields = Array.isArray(action?.fields) ? action.fields.filter(Boolean) : [];
    const fmt = fields.length
      ? ' Return ONLY valid JSON with keys: {' + fields.map(f => `"${f}":"..."`).join(', ') + '}. No markdown.'
      : ' Return concise plain text without markdown formatting.';

    const res = await callChat({
      messages: [
        { role: 'system', content: prompt + fmt },
        { role: 'user', content: buildWordUserPrompt(en, zh, def, context) }
      ],
      temperature: 0.5,
      maxTokens: 800,
      jsonMode: fields.length > 0,
      scope: 'custom'
    });
    if (!res.ok) return { error: res.error };
    const cleaned = res.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (fields.length) {
      const parsed = IFLL.utils.extractJson(cleaned);
      if (parsed) return { success: true, result: parsed };
    }
    return { success: true, result: { text: cleaned } };
  }

  /* ── Batch Chunk Analysis (10-word chunk) ── */
  async function analyzeBatchChunk(words, externalSignal) {
    if (!Array.isArray(words) || !words.length) return { error: '空词表' };
    const wordList = words.map(w => `"${w.en}" (${w.zh})`).join(', ');
    const prompt = `You are an English lexicographer. Analyze each word accurately (empty array is better than guessing). Return ONLY valid JSON:
{"results":[{"word":"exact English word","synonyms":["..."],"antonyms":["..."],"collocations":["..."],"usage":"1-sentence Chinese note","examples":[{"en":"short natural sentence","cn":"地道中文，**对应词**加粗"}]}]}
Include exactly 1 natural example per word.`;

    const res = await callChat({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Words: ' + wordList }
      ],
      temperature: 0.35,
      maxTokens: 3200,
      jsonMode: true,
      timeoutMs: 60000,
      externalSignal,
      scope: 'batch'
    });
    if (!res.ok) return { error: res.error, aborted: res.aborted };

    const parsed = IFLL.utils.extractJson(res.content);
    if (!parsed || !Array.isArray(parsed.results)) {
      return { error: '批次返回格式无法解析' };
    }
    return { success: true, results: parsed.results };
  }

  async function testConnection(override = {}) {
    const res = await callChat({
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      temperature: 0,
      maxTokens: 16,
      timeoutMs: 15000,
      override,
      scope: 'test'
    });
    if (!res.ok) return { error: res.error };
    return { success: true };
  }

  async function listModels(override = {}) {
    const { apiKey, apiEndpoint } = await resolveCredentials(override);
    if (!apiKey) return { error: '请先填写 API Key' };
    try {
      const resp = await apiFetch(apiEndpoint, '/models', apiKey, null, 15000, null, 'models');
      if (!resp.ok) {
        const raw = await resp.text().catch(() => '');
        return { error: IFLL.utils.formatApiError(resp.status, raw) };
      }
      const data = await resp.json();
      const models = (data.data || [])
        .map(m => (typeof m === 'string' ? m : m?.id))
        .filter(Boolean)
        .sort();
      return { models };
    } catch (err) {
      return { error: err?.name === 'AbortError' ? '拉取模型超时' : '拉取模型失败：' + (err?.message || '') };
    }
  }

  const aiClient = {
    analyzeWord,
    streamWordAnalysis,
    translateText,
    translateBatch,
    parseBatchTranslations,
    freeTranslateText,
    selectionAction,
    runCustomAction,
    analyzeBatchChunk,
    testConnection,
    listModels,
    hasUsableAnalysis,
    toCacheEntry,
    isOpenCodeEndpoint,
    buildRequestHeaders
  };

  IFLL.aiClient = aiClient;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = aiClient;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
