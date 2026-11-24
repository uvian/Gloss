/*
 * IFLL — Popup Controller (v0.3)
 */
document.addEventListener('DOMContentLoaded', async () => {
  const { constants, utils, storage } = globalThis.IFLL;

  const els = {
    enabled: document.getElementById('enabled'),
    toggleLabel: document.getElementById('toggleLabel'),
    currentHost: document.getElementById('currentHost'),
    openReviewBtn: document.getElementById('openReviewBtn'),
    reviewBadge: document.getElementById('reviewBadge'),
    openDashboardBtn: document.getElementById('openDashboardBtn'),
    permBanner: document.getElementById('permBanner'),
    grantPermBtn: document.getElementById('grantPermBtn'),
    modeSelector: document.getElementById('modeSelector'),
    modeStatusHint: document.getElementById('modeStatusHint'),
    level: document.getElementById('level'),
    frequency: document.getElementById('frequency'),
    replaceStyle: document.getElementById('replaceStyle'),
    sitePolicy: document.getElementById('sitePolicy'),
    annotateStrategy: document.getElementById('annotateStrategy'),
    dailyCount: document.getElementById('dailyCount'),
    tooltipTheme: document.getElementById('tooltipTheme'),
    enableHoverPreview: document.getElementById('enableHoverPreview'),
    enableSelToolbar: document.getElementById('enableSelToolbar'),
    showFloatBall: document.getElementById('showFloatBall'),
    enableInputTranslate: document.getElementById('enableInputTranslate'),
    enableFreeTranslateFallback: document.getElementById('enableFreeTranslateFallback'),
    wordbankSummary: document.getElementById('wordbankSummary'),
    statLearned: document.getElementById('statLearned'),
    statReplace: document.getElementById('statReplace'),
    statKnown: document.getElementById('statKnown'),
    statReview: document.getElementById('statReview'),
    excludeCurrent: document.getElementById('excludeCurrent'),
    excludedList: document.getElementById('excludedList'),
    apiStatusDot: document.getElementById('apiStatusDot'),
    apiEndpoint: document.getElementById('apiEndpoint'),
    apiEndpointCustomRow: document.getElementById('apiEndpointCustomRow'),
    apiEndpointCustom: document.getElementById('apiEndpointCustom'),
    apiModel: document.getElementById('apiModel'),
    modelCombobox: document.getElementById('modelCombobox'),
    modelToggle: document.getElementById('modelToggle'),
    modelMenu: document.getElementById('modelMenu'),
    refreshModels: document.getElementById('refreshModels'),
    apiKey: document.getElementById('apiKey'),
    apiMsg: document.getElementById('apiMsg'),
    testApi: document.getElementById('testApi'),
    saveApi: document.getElementById('saveApi'),
    batchCount: document.getElementById('batchCount'),
    batchLevel: document.getElementById('batchLevel'),
    batchStart: document.getElementById('batchStart'),
    batchStop: document.getElementById('batchStop'),
    batchProgress: document.getElementById('batchProgress'),
    batchFill: document.getElementById('batchFill'),
    batchText: document.getElementById('batchText'),
    batchMsg: document.getElementById('batchMsg'),
    voiceSelect: document.getElementById('voiceSelect'),
    testVoice: document.getElementById('testVoice'),
    voiceRate: document.getElementById('voiceRate'),
    voiceRateVal: document.getElementById('voiceRateVal'),
    exportIncludeKey: document.getElementById('exportIncludeKey'),
    exportConfig: document.getElementById('exportConfig'),
    importConfig: document.getElementById('importConfig'),
    importFileInput: document.getElementById('importFileInput'),
    ioMsg: document.getElementById('ioMsg'),
    refreshPage: document.getElementById('refreshPage')
  };

  let activeTab = null;
  let activeHost = '';
  let excludedExpanded = false;

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0] || null;
    try {
      activeHost = activeTab?.url ? new URL(activeTab.url).hostname : '';
    } catch (_) {
      activeHost = '';
    }
    els.currentHost.textContent = activeHost || '当前标签页';
    els.currentHost.title = activeHost;
  }

  /* Broadcast once (reads settings ONCE, not N times in a loop!) */
  async function broadcastSettingsChanged() {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id == null) continue;
      chrome.tabs.sendMessage(t.id, { type: 'IFLL_SETTINGS_CHANGED' }).catch(() => {});
    }
  }

  /* ── Custom Model Combobox ── */
  let availableModels = [];
  let comboOpen = false;
  let comboFocusIdx = -1;

  function setAvailableModels(models) {
    const uniq = [];
    const seen = new Set();
    for (const m of models || []) {
      const v = String(m || '').trim();
      if (v && !seen.has(v)) { seen.add(v); uniq.push(v); }
    }
    availableModels = uniq;
    if (comboOpen) renderModelMenu(false);
  }

  function renderModelMenu(filterByInput = true) {
    const curVal = els.apiModel.value.trim();
    const q = filterByInput ? curVal.toLowerCase() : '';
    const exactMatch = availableModels.some(m => m.toLowerCase() === q);
    const list = (!q || exactMatch)
      ? availableModels
      : availableModels.filter(m => m.toLowerCase().includes(q));

    els.modelMenu.innerHTML = '';
    comboFocusIdx = -1;

    if (!list.length && !curVal) {
      const empty = document.createElement('div');
      empty.className = 'p-combo-empty';
      empty.textContent = '暂无预设模型，请直接输入或点击「拉取」';
      els.modelMenu.appendChild(empty);
      return;
    }

    for (const m of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'p-combo-opt' + (m === curVal ? ' selected' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', m === curVal ? 'true' : 'false');
      btn.dataset.modelVal = m;
      const lbl = document.createElement('span');
      lbl.className = 'p-combo-opt-label';
      lbl.textContent = m;
      lbl.title = m;
      btn.appendChild(lbl);
      if (m === curVal) {
        const chk = document.createElement('span');
        chk.className = 'p-combo-check';
        chk.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 5"/></svg>';
        btn.appendChild(chk);
      }
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => selectModelValue(m));
      els.modelMenu.appendChild(btn);
    }

    if (curVal && !availableModels.includes(curVal)) {
      const customBtn = document.createElement('button');
      customBtn.type = 'button';
      customBtn.className = 'p-combo-opt p-combo-custom';
      customBtn.setAttribute('role', 'option');
      customBtn.dataset.modelVal = curVal;
      customBtn.textContent = `使用自定义模型：${curVal}`;
      customBtn.addEventListener('mousedown', (e) => e.preventDefault());
      customBtn.addEventListener('click', () => selectModelValue(curVal));
      els.modelMenu.appendChild(customBtn);
    }
  }

  function positionModelMenu() {
    const rect = els.modelCombobox.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    els.modelCombobox.classList.toggle('open-up', spaceBelow < 185 && spaceAbove > spaceBelow);
  }

  function openModelMenu(filterByInput = false) {
    comboOpen = true;
    positionModelMenu();
    els.modelCombobox.classList.add('open');
    els.apiModel.setAttribute('aria-expanded', 'true');
    renderModelMenu(filterByInput);
  }

  function closeModelMenu() {
    comboOpen = false;
    comboFocusIdx = -1;
    els.modelCombobox.classList.remove('open', 'open-up');
    els.apiModel.setAttribute('aria-expanded', 'false');
  }

  function selectModelValue(val) {
    els.apiModel.value = val;
    closeModelMenu();
  }

  function moveComboFocus(delta) {
    const opts = Array.from(els.modelMenu.querySelectorAll('.p-combo-opt'));
    if (!opts.length) return;
    comboFocusIdx = (comboFocusIdx + delta + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle('focused', i === comboFocusIdx));
    opts[comboFocusIdx].scrollIntoView({ block: 'nearest' });
  }

  els.modelToggle.addEventListener('mousedown', (e) => e.preventDefault());
  els.modelToggle.addEventListener('click', () => {
    if (comboOpen) closeModelMenu();
    else {
      els.apiModel.focus();
      openModelMenu(false);
    }
  });
  els.apiModel.addEventListener('focus', () => openModelMenu(false));
  els.apiModel.addEventListener('click', () => {
    if (!comboOpen) openModelMenu(false);
  });
  els.apiModel.addEventListener('input', () => {
    if (!comboOpen) openModelMenu(true);
    else renderModelMenu(true);
  });
  els.apiModel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!comboOpen) openModelMenu(false);
      moveComboFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!comboOpen) openModelMenu(false);
      moveComboFocus(-1);
    } else if (e.key === 'Enter' && comboOpen) {
      const opts = Array.from(els.modelMenu.querySelectorAll('.p-combo-opt'));
      if (comboFocusIdx >= 0 && opts[comboFocusIdx]) {
        e.preventDefault();
        selectModelValue(opts[comboFocusIdx].dataset.modelVal);
      } else {
        closeModelMenu();
      }
    } else if (e.key === 'Escape' && comboOpen) {
      e.preventDefault();
      closeModelMenu();
    }
  });
  els.apiModel.addEventListener('blur', () => {
    setTimeout(() => {
      if (!els.modelCombobox.contains(document.activeElement)) closeModelMenu();
    }, 120);
  });
  document.addEventListener('mousedown', (e) => {
    if (comboOpen && !els.modelCombobox.contains(e.target)) closeModelMenu();
  });

  function getEffectiveEndpoint() {
    return els.apiEndpoint.value === '__custom__'
      ? utils.normalizeEndpoint(els.apiEndpointCustom.value)
      : els.apiEndpoint.value;
  }

  function setMsg(el, text, cls = '') {
    el.textContent = text;
    el.className = el.className.split(' ')[0] + (cls ? ' ' + cls : '');
  }

  function renderExcluded(sites = []) {
    els.excludedList.innerHTML = '';
    if (!sites.length) {
      const span = document.createElement('span');
      span.className = 'p-empty';
      span.textContent = '暂无排除站点';
      els.excludedList.appendChild(span);
      return;
    }
    const PREVIEW = 5;
    const shown = excludedExpanded ? sites : sites.slice(0, PREVIEW);
    for (const site of shown) {
      const chip = document.createElement('span');
      chip.className = 'p-excluded-item';
      chip.title = site;
      const short = site.replace(/^www\./, '');
      const label = document.createTextNode(short.length > 22 ? short.slice(0, 10) + '…' + short.slice(-8) : short);
      const rm = document.createElement('button');
      rm.className = 'p-excluded-remove';
      rm.textContent = '×';
      rm.title = '移除';
      rm.addEventListener('click', async () => {
        const s = await storage.get();
        const next = (s.excludedSites || []).filter(x => x !== site);
        await storage.set({ excludedSites: next });
        renderExcluded(next);
        await broadcastSettingsChanged();
      });
      chip.appendChild(label);
      chip.appendChild(rm);
      els.excludedList.appendChild(chip);
    }
    if (sites.length > PREVIEW) {
      const toggle = document.createElement('button');
      toggle.className = 'p-excluded-toggle';
      toggle.textContent = excludedExpanded ? '收起' : `共 ${sites.length} 个 · 展开`;
      toggle.addEventListener('click', () => {
        excludedExpanded = !excludedExpanded;
        renderExcluded(sites);
      });
      els.excludedList.appendChild(toggle);
    }
  }

  async function renderAll() {
    const s = await storage.get();
    els.enabled.checked = !!s.enabled;
    els.toggleLabel.textContent = s.enabled ? '已开启' : '已关闭';
    els.level.value = s.level || 'cet4';
    els.frequency.value = s.frequency || 'medium';
    els.replaceStyle.value = s.replaceStyle || 'inline';
    els.sitePolicy.value = s.sitePolicy || 'auto';
    els.annotateStrategy.value = s.annotateStrategy || 'target_and_above';
    els.dailyCount.value = String(s.dailyWordCount || 15);
    els.tooltipTheme.value = s.tooltipTheme || 'auto';
    els.enableHoverPreview.checked = s.enableHoverPreview !== false;
    els.enableSelToolbar.checked = s.enableSelToolbar !== false;
    els.showFloatBall.checked = s.showFloatBall !== false;
    els.enableInputTranslate.checked = s.enableInputTranslate !== false;
    els.enableFreeTranslateFallback.checked = s.enableFreeTranslateFallback !== false;

    // Live active mode sync (fixes auto-mode showing no highlighted button!)
    let activeMode = activeHost && s.siteModes && activeHost in s.siteModes ? s.siteModes[activeHost] : null;
    let isAuto = false;
    if (activeTab?.id != null) {
      const live = await chrome.tabs.sendMessage(activeTab.id, { type: 'IFLL_GET_ACTIVE_MODE' }).catch(() => null);
      if (live?.mode) {
        activeMode = live.mode;
        isAuto = !!live.isAuto;
      }
    }
    els.modeSelector.querySelectorAll('.p-mode-btn').forEach(btn => {
      btn.classList.toggle('p-mode-active', btn.dataset.mode === activeMode);
    });
    if (activeHost && activeMode) {
      els.currentHost.textContent = `${activeHost} · ${isAuto ? '自动' : '固定'}`;
    }

    // Stats
    const ds = s.dailyStats || {};
    els.statLearned.textContent = ds.totalLearned || 0;
    els.statReplace.textContent = (ds.replaceCount || 0) + (ds.annotateCount || 0);
    els.statKnown.textContent = (s.knownWords || []).length;
    els.statReview.textContent = (s.reviewQueue || []).length;

    const dueCount = await storage.getReviewCount();
    if (dueCount > 0) {
      els.openReviewBtn.style.display = 'inline-flex';
      els.reviewBadge.textContent = String(dueCount);
    } else {
      els.openReviewBtn.style.display = 'none';
    }

    // Excluded list
    renderExcluded(s.excludedSites || []);
    const isCurrentExcluded = activeHost && utils.isExcludedHost(activeHost, s.excludedSites);
    els.excludeCurrent.textContent = isCurrentExcluded ? '取消排除' : '排除当前';

    // API config
    els.apiStatusDot.classList.toggle('ok', !!(s.apiKey && s.apiKey.trim()));
    els.apiKey.value = s.apiKey || '';
    const presetUrls = Object.keys(constants.PROVIDER_PRESETS);
    if (presetUrls.includes(s.apiEndpoint)) {
      els.apiEndpoint.value = s.apiEndpoint;
      els.apiEndpointCustomRow.style.display = 'none';
      setAvailableModels(constants.PROVIDER_PRESETS[s.apiEndpoint].models);
    } else if (s.apiEndpoint) {
      els.apiEndpoint.value = '__custom__';
      els.apiEndpointCustom.value = s.apiEndpoint;
      els.apiEndpointCustomRow.style.display = 'block';
      setAvailableModels(s.apiModel ? [s.apiModel] : []);
    }
    els.apiModel.value = s.apiModel || constants.DEFAULTS.apiModel;

    // Voice rate
    const rate = Number(s.voiceRate) || 0.9;
    els.voiceRate.value = String(rate);
    els.voiceRateVal.textContent = rate.toFixed(2).replace(/0$/, '');
  }

  /* Load tiny wordbank-meta.json (100 bytes — instant!) */
  async function loadMeta() {
    const [meta, cacheStats] = await Promise.all([
      storage.loadWordBankMeta().catch(() => null),
      chrome.runtime.sendMessage({ type: 'IFLL_CACHE_STATS' }).catch(() => ({ words: 0 }))
    ]);
    if (meta?.total) {
      els.wordbankSummary.textContent = `内置 ${meta.total} 词 · IPA ${meta.ipaCoverage}% · AI 缓存 ${cacheStats?.words || 0}`;
    } else {
      els.wordbankSummary.textContent = '';
    }
  }

  /* Populate Voices safely without innerHTML XSS (guarded for Android WebView/Firefox) */
  function populateVoices(savedVoice) {
    els.voiceSelect.innerHTML = '';
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = '系统默认';
    els.voiceSelect.appendChild(defOpt);
    if (typeof speechSynthesis === 'undefined' || typeof speechSynthesis.getVoices !== 'function') return;
    const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      els.voiceSelect.appendChild(opt);
    }
    if (savedVoice) els.voiceSelect.value = savedVoice;
  }

  /* Optional Firefox MV3 host-permission check (hidden whenever already granted) */
  async function checkHostPermissions() {
    if (!els.permBanner || !chrome.permissions?.contains) return;
    try {
      const granted = await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
      els.permBanner.style.display = granted ? 'none' : 'flex';
    } catch (_) {}
  }

  const isTouchUi = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (isTouchUi && els.modeStatusHint) {
    els.modeStatusHint.textContent = '点页面右下角悬浮胶囊切模式 · 长按网页划词翻译/查卡';
  }

  /* Batch status renderer (connected to SW batchRunner!) */
  function renderBatchState(state) {
    if (!state || state.status === 'idle') return;
    els.batchProgress.style.display = 'flex';
    const pct = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;
    els.batchFill.style.width = pct + '%';
    els.batchText.textContent = `${state.processed}/${state.total}`;
    els.batchStart.style.display = state.running ? 'none' : 'inline-block';
    els.batchStop.style.display = state.running ? 'inline-block' : 'none';
    setMsg(
      els.batchMsg,
      state.message || '',
      state.status === 'error' ? 'err' : (state.status === 'done' ? 'ok' : '')
    );
    if (state.status === 'done') loadMeta();
  }

  /* ── Initialize ── */
  await getActiveTab();
  await Promise.all([renderAll(), checkHostPermissions()]);
  loadMeta();

  const initialSettings = await storage.get();
  populateVoices(initialSettings.voiceName);
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.onvoiceschanged = async () => {
      const s = await storage.get();
      populateVoices(s.voiceName);
    };
  }

  chrome.runtime.sendMessage({ type: 'IFLL_BATCH_STATUS' })
    .then(renderBatchState)
    .catch(() => {});

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'IFLL_BATCH_PROGRESS') {
      renderBatchState(msg.state);
    }
  });

  /* ── Event Bindings ── */
  if (els.grantPermBtn) {
    els.grantPermBtn.addEventListener('click', async () => {
      try {
        const ok = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
        if (ok) {
          els.permBanner.style.display = 'none';
          if (activeTab?.id != null) chrome.tabs.reload(activeTab.id);
        }
      } catch (_) {}
    });
  }

  els.openReviewBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'IFLL_OPEN_DASHBOARD', tab: 'review' }).catch(() => {});
    if (isTouchUi) window.close();
  });
  els.openDashboardBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'IFLL_OPEN_DASHBOARD', tab: 'vocab' }).catch(() => {});
    if (isTouchUi) window.close();
  });

  els.enabled.addEventListener('change', async () => {
    els.toggleLabel.textContent = els.enabled.checked ? '已开启' : '已关闭';
    await storage.set({ enabled: els.enabled.checked });
    await broadcastSettingsChanged();
  });

  els.modeSelector.querySelectorAll('.p-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!activeHost || !activeTab) return;
      const mode = btn.dataset.mode;
      els.modeSelector.querySelectorAll('.p-mode-btn').forEach(b => b.classList.toggle('p-mode-active', b === btn));
      await storage.setModeForHost(activeHost, mode);
      chrome.tabs.sendMessage(activeTab.id, { type: 'IFLL_MODE_CHANGED', mode }).catch(() => {});
    });
  });

  const bindSetting = (el, key, parse = (v) => v, broadcast = true) => {
    el.addEventListener('change', async () => {
      const val = el.type === 'checkbox' ? el.checked : parse(el.value);
      await storage.set({ [key]: val });
      if (broadcast) await broadcastSettingsChanged();
    });
  };
  bindSetting(els.level, 'level');
  bindSetting(els.frequency, 'frequency');
  bindSetting(els.replaceStyle, 'replaceStyle');
  bindSetting(els.sitePolicy, 'sitePolicy');
  bindSetting(els.annotateStrategy, 'annotateStrategy');
  bindSetting(els.tooltipTheme, 'tooltipTheme');
  bindSetting(els.enableHoverPreview, 'enableHoverPreview');
  bindSetting(els.enableSelToolbar, 'enableSelToolbar');
  bindSetting(els.showFloatBall, 'showFloatBall');
  bindSetting(els.enableInputTranslate, 'enableInputTranslate');
  bindSetting(els.enableFreeTranslateFallback, 'enableFreeTranslateFallback', (v) => v, false);
  els.dailyCount.addEventListener('change', async () => {
    await storage.set({ dailyWordCount: parseInt(els.dailyCount.value, 10) || 15, dailyWordDate: '' });
  });

  els.excludeCurrent.addEventListener('click', async () => {
    if (!activeHost) return;
    const s = await storage.get();
    const list = [...(s.excludedSites || [])];
    const idx = list.indexOf(activeHost);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(activeHost);
    await storage.set({ excludedSites: list });
    renderExcluded(list);
    els.excludeCurrent.textContent = idx >= 0 ? '排除当前' : '取消排除';
    await broadcastSettingsChanged();
  });

  /* Provider change auto-fills preset default model */
  els.apiEndpoint.addEventListener('change', () => {
    const val = els.apiEndpoint.value;
    const isCustom = val === '__custom__';
    els.apiEndpointCustomRow.style.display = isCustom ? 'block' : 'none';
    if (!isCustom && constants.PROVIDER_PRESETS[val]) {
      const preset = constants.PROVIDER_PRESETS[val];
      setAvailableModels(preset.models);
      els.apiModel.value = preset.defaultModel;
    }
  });

  els.refreshModels.addEventListener('click', async () => {
    els.refreshModels.disabled = true;
    els.refreshModels.textContent = '…';
    setMsg(els.apiMsg, '');
    const res = await chrome.runtime.sendMessage({
      type: 'IFLL_LIST_MODELS',
      apiKey: els.apiKey.value.trim(),
      apiEndpoint: getEffectiveEndpoint()
    }).catch(() => ({ error: '后台无响应' }));
    els.refreshModels.disabled = false;
    els.refreshModels.textContent = '拉取';
    if (res?.models?.length) {
      setAvailableModels(res.models);
      setMsg(els.apiMsg, `已获取 ${res.models.length} 个模型`, 'ok');
      openModelMenu(false);
    } else {
      setMsg(els.apiMsg, res?.error || '该端点不支持拉取模型列表，请直接手动输入模型名', 'err');
    }
  });

  els.testApi.addEventListener('click', async () => {
    els.testApi.disabled = true;
    els.testApi.textContent = '测试中…';
    setMsg(els.apiMsg, '');
    const res = await chrome.runtime.sendMessage({
      type: 'IFLL_TEST_API',
      apiKey: els.apiKey.value.trim(),
      apiEndpoint: getEffectiveEndpoint(),
      apiModel: els.apiModel.value.trim()
    }).catch(() => ({ error: '后台无响应' }));
    els.testApi.disabled = false;
    els.testApi.textContent = '测试连接';
    if (res?.success) setMsg(els.apiMsg, '连接成功，模型响应正常', 'ok');
    else setMsg(els.apiMsg, res?.error || '连接失败', 'err');
  });

  els.saveApi.addEventListener('click', async () => {
    const newKey = els.apiKey.value.trim();
    const newEp = getEffectiveEndpoint();
    const newMdl = els.apiModel.value.trim() || constants.DEFAULTS.apiModel;
    await storage.set({ apiKey: newKey, apiEndpoint: newEp, apiModel: newMdl });
    els.apiStatusDot.classList.toggle('ok', !!newKey);
    setMsg(els.apiMsg, '配置已保存', 'ok');
    setTimeout(() => setMsg(els.apiMsg, ''), 2200);
  });

  /* Batch controls */
  els.batchStart.addEventListener('click', async () => {
    const count = parseInt(els.batchCount.value, 10) || 50;
    const level = els.batchLevel.value;
    const state = await chrome.runtime.sendMessage({ type: 'IFLL_BATCH_START', count, level }).catch(() => null);
    if (state) renderBatchState(state);
  });
  els.batchStop.addEventListener('click', async () => {
    const state = await chrome.runtime.sendMessage({ type: 'IFLL_BATCH_STOP' }).catch(() => null);
    if (state) renderBatchState(state);
  });

  /* Voice controls */
  els.voiceSelect.addEventListener('change', async () => {
    await storage.set({ voiceName: els.voiceSelect.value });
  });
  els.voiceRate.addEventListener('input', () => {
    els.voiceRateVal.textContent = Number(els.voiceRate.value).toFixed(2).replace(/0$/, '');
  });
  els.voiceRate.addEventListener('change', async () => {
    await storage.set({ voiceRate: Number(els.voiceRate.value) || 0.9 });
  });
  els.testVoice.addEventListener('click', () => {
    if (typeof speechSynthesis === 'undefined') return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('Immersive learning builds lasting vocabulary.');
      u.lang = 'en-US';
      u.rate = Number(els.voiceRate.value) || 0.9;
      const found = speechSynthesis.getVoices().find(v => v.name === els.voiceSelect.value);
      if (found) u.voice = found;
      speechSynthesis.speak(u);
    } catch (_) {}
  });

  /* Export / Import */
  els.exportConfig.addEventListener('click', async () => {
    const data = await storage.exportAll({ includeApiKey: els.exportIncludeKey.checked });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ifll-backup-${utils.getLocalDateStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setMsg(els.ioMsg, '配置已导出', 'ok');
  });

  els.importConfig.addEventListener('click', () => {
    els.importFileInput.value = '';
    els.importFileInput.click();
  });
  els.importFileInput.addEventListener('change', async () => {
    const file = els.importFileInput.files[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      await storage.importConfig(raw);
      await renderAll();
      await broadcastSettingsChanged();
      setMsg(els.ioMsg, '导入成功并已同步至所有页面', 'ok');
    } catch (err) {
      setMsg(els.ioMsg, err?.message || '导入失败：JSON 无效', 'err');
    }
  });

  els.refreshPage.addEventListener('click', () => {
    if (activeTab?.id != null) chrome.tabs.reload(activeTab.id);
    else chrome.tabs.reload();
  });
});
