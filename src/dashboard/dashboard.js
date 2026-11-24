/*
 * IFLL — Learning Center Controller (v0.4)
 * Features:
 * - Dark mode sync (auto / light / dark)
 * - 30-day learning heatmap + streak stats
 * - 3 Active Recall modes: Flashcard / Listening-Spelling / Cloze Context Fill-in
 * - Bulk Word Import (TXT/CSV/Paste) + Anki TSV One-Click Export
 * - SW Persistent Batch Runner + IndexedDB Cache + Custom AI Actions
 */
document.addEventListener('DOMContentLoaded', async () => {
  const { constants, utils, storage } = globalThis.IFLL;

  let settings = await storage.get();
  let dueCards = [];
  let currentCard = null;
  let cardFlipped = false;
  let recallMode = 'flashcard'; // 'flashcard' | 'spelling' | 'cloze'
  let sessionDone = 0;
  let activeVocabSub = 'reviewQueue';
  let editingActionId = null;

  /* ── Theme Sync ── */
  const themeBtn = document.getElementById('themeToggleBtn');
  function applyDashboardTheme(pref) {
    const isDark = pref === 'dark' || (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark', isDark);
    if (themeBtn) themeBtn.textContent = isDark ? '浅色' : '暗色';
  }
  applyDashboardTheme(settings.tooltipTheme || 'auto');
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((settings.tooltipTheme || 'auto') === 'auto') applyDashboardTheme('auto');
  });
  themeBtn?.addEventListener('click', async () => {
    const next = document.body.classList.contains('dark') ? 'light' : 'dark';
    settings.tooltipTheme = next;
    await storage.set({ tooltipTheme: next });
    applyDashboardTheme(next);
  });

  const isTouchDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const reviewSubEl = document.getElementById('reviewSub');
  if (isTouchDevice && reviewSubEl) {
    reviewSubEl.textContent = '按遗忘曲线安排复习 · 点击卡片翻面与朗读';
  }

  function speak(text) {
    if (!text || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = Number(settings.voiceRate) || 0.9;
      if (settings.voiceName) {
        const found = speechSynthesis.getVoices().find(v => v.name === settings.voiceName);
        if (found) u.voice = found;
      }
      speechSynthesis.speak(u);
    } catch (_) {}
  }

  function formatRelativeTime(ts) {
    const diff = ts - Date.now();
    if (diff <= 0) return '已到期';
    const hrs = Math.round(diff / 3600000);
    if (hrs < 24) return `${hrs} 小时后`;
    return `${Math.round(diff / 86400000)} 天后`;
  }

  function renderHeatmap() {
    const grid = document.getElementById('heatmapGrid');
    const summary = document.getElementById('hmSummary');
    if (!grid) return;

    const el = utils.createEl;
    const hist = settings.learningHistory || {};
    const streak = utils.computeStreak(hist);
    const knownCount = (settings.knownWords || []).length;
    summary.textContent = `连续打卡 ${streak} 天 · 已掌握 ${knownCount} 词 · 复习队列 ${(settings.reviewQueue || []).length} 词`;

    const today = new Date();
    const frag = document.createDocumentFragment();
    for (let offset = 29; offset >= 0; offset--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
      const key = utils.getLocalDateStr(d);
      const rec = hist[key] || { learned: 0, reviewed: 0, replaced: 0 };
      const total = (rec.learned || 0) + (rec.reviewed || 0);
      const lv = total === 0 ? 0 : (total <= 3 ? 1 : (total <= 10 ? 2 : 3));
      frag.appendChild(el('i', {
        className: `hm-cell lv-${lv}`,
        title: `${key}：学习 ${rec.learned || 0} · 复习 ${rec.reviewed || 0}`
      }));
    }
    grid.replaceChildren(frag);
  }

  async function refreshSettings() {
    settings = await storage.get();
    dueCards = await storage.getDueReviews();
    document.getElementById('navDueBadge').textContent = String(dueCards.length);
    document.getElementById('dueCounter').textContent = String(dueCards.length);
    document.getElementById('cntReview').textContent = String((settings.reviewQueue || []).length);
    document.getElementById('cntKnown').textContent = String((settings.knownWords || []).length);
    document.getElementById('cntUser').textContent = String((settings.userWords || []).length);
    const phrases = storage.resolvePhraseMap(settings);
    document.getElementById('cntPhrases').textContent = String(Object.keys(phrases).length);
    renderHeatmap();
  }

  /* ── Main Tab Switching ── */
  function activateTab(tab) {
    document.querySelectorAll('.d-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.d-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
    if (tab === 'review') renderFlashcardStage();
    else if (tab === 'vocab') renderVocabList();
    else if (tab === 'ai') { refreshCacheStats(); renderCustomActions(); }
  }

  document.getElementById('mainNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.d-nav-btn');
    if (btn?.dataset.tab) {
      history.replaceState(null, '', '#' + btn.dataset.tab);
      activateTab(btn.dataset.tab);
    }
  });

  document.getElementById('recallModes').addEventListener('click', (e) => {
    const btn = e.target.closest('.d-mode-pill');
    if (!btn?.dataset.rmode) return;
    recallMode = btn.dataset.rmode;
    document.querySelectorAll('.d-mode-pill').forEach(x => x.classList.toggle('active', x === btn));
    renderFlashcardStage();
  });

  /* ── TAB 1: SM-2 Active Recall (Flashcard / Spelling / Cloze) ── */
  async function renderFlashcardStage(practiceAll = false) {
    await refreshSettings();
    const stage = document.getElementById('flashcardStage');
    const pool = practiceAll ? [...(settings.reviewQueue || [])] : dueCards;

    if (!pool.length) {
      currentCard = null;
      const el = utils.createEl;
      const totalQueue = (settings.reviewQueue || []).length;
      const actionBtn = totalQueue
        ? el('button', { id: 'practiceEarlyBtn', className: 'd-btn d-btn-primary', text: '提前练习全部队列' })
        : el('button', { id: 'gotoVocabBtn', className: 'd-btn d-btn-primary', text: '前往词库管理' });
      stage.replaceChildren(el('div', { className: 'd-empty-box' },
        el('h2', { text: totalQueue ? '今日到期词汇已全部复习完成' : '复习队列暂无词汇' }),
        el('p', {
          text: totalQueue
            ? `队列中还有 ${totalQueue} 个未到期词汇。你可以休息一下，或提前巩固全部队列。`
            : '浏览网页点击生词并选择「加入复习」，或在「词库与搭配」中批量导入词表。'
        }),
        actionBtn
      ));
      document.getElementById('practiceEarlyBtn')?.addEventListener('click', () => renderFlashcardStage(true));
      document.getElementById('gotoVocabBtn')?.addEventListener('click', () => activateTab('vocab'));
      return;
    }

    currentCard = pool[0];
    cardFlipped = false;
    await drawCard(currentCard, practiceAll);
  }

  async function drawCard(card, practiceAll) {
    const stage = document.getElementById('flashcardStage');
    const el = utils.createEl;
    const cachedAi = await storage.getAiCacheEntry(card.en);

    // Prepare context / example for Cloze mode
    const candidateSentences = [
      card.context,
      ...(Array.isArray(card.examples) ? card.examples : []),
      ...(cachedAi?.examples || []).map(e => e.en)
    ].filter(Boolean);
    let cloze = null;
    for (const s of candidateSentences) {
      cloze = utils.buildClozeSentence(s, card.en);
      if (cloze) break;
    }

    let aiNode;
    if (cachedAi?.deep) {
      const d = cachedAi.deep;
      const aiChildren = [];
      if (d.collocations?.length) {
        aiChildren.push(el('div', { style: 'font-size:12.5px;margin-bottom:4px' },
          el('strong', { text: '搭配：' }),
          d.collocations.join(' · ')
        ));
      }
      if (d.usage) {
        aiChildren.push(el('div', { style: 'font-size:12.5px;color:var(--text-muted)', text: d.usage }));
      }
      for (const ex of (cachedAi.examples || []).slice(0, 2)) {
        aiChildren.push(el('div', { className: 'fc-ex' },
          el('div', { text: ex.en || '' }),
          ex.cn ? el('div', { className: 'fc-ex-cn' }, utils.renderBoldFragment(ex.cn)) : null
        ));
      }
      aiNode = el('div', { className: 'fc-section' }, aiChildren);
    } else {
      aiNode = el('div', { className: 'fc-section', style: 'text-align:center' },
        el('button', { id: 'fcFetchAi', className: 'd-btn d-btn-sm', text: '获取 AI 深度解析与例句' })
      );
    }

    const safeSourceUrl = (card.sourceUrl && /^https?:\/\//i.test(card.sourceUrl)) ? card.sourceUrl : '';
    const contextNode = card.context ? el('div', { className: 'fc-context' },
      el('div', { text: `“${card.context}”` }),
      safeSourceUrl ? el('a', {
        className: 'fc-source-link',
        href: safeSourceUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: `来源：${card.sourceTitle || safeSourceUrl}`
      }) : null
    ) : null;

    const builtInExNode = (Array.isArray(card.examples) && card.examples.length)
      ? el('div', { className: 'fc-section' },
          card.examples.slice(0, 2).map((ex, i) =>
            el('div', { className: 'fc-ex' },
              el('div', { text: ex }),
              card.examplesCn?.[i]
                ? el('div', { className: 'fc-ex-cn' }, utils.renderBoldFragment(card.examplesCn[i]))
                : null
            )
          )
        )
      : null;

    const posText = `${utils.posLabel(card.pos)} ${card.pos_cn || ''}`.trim();
    let frontNode;
    if (recallMode === 'spelling') {
      frontNode = el('div', { className: 'fc-drill-box' },
        el('div', { className: 'fc-zh' }, card.zh, el('span', { className: 'fc-pos', text: posText })),
        el('div', { className: 'fc-ipa-row' },
          card.ipa ? el('span', { text: card.ipa }) : null,
          el('button', { id: 'fcSpeak', className: 'd-btn d-btn-sm', type: 'button', text: isTouchDevice ? '再听一遍' : '再听一遍 (S)' })
        ),
        el('form', { className: 'fc-drill-form', id: 'fcDrillForm' },
          el('input', { type: 'text', className: 'fc-drill-input', id: 'fcDrillInput', placeholder: '输入听到的英文拼写…', autocomplete: 'off', spellcheck: 'false' }),
          el('button', { type: 'submit', className: 'd-btn d-btn-primary', text: '检查' })
        ),
        el('div', { className: 'fc-feedback', id: 'fcFeedback' }),
        el('button', { id: 'fcRevealBtn', className: 'd-btn d-btn-sm', type: 'button', text: '直接看答案' })
      );
    } else if (recallMode === 'cloze') {
      const promptSent = cloze
        ? cloze.masked
        : `请根据中文释义「${card.zh}」拼出对应英文词（该词暂无可挖空英文例句，可点下方获取 AI 例句）。`;
      frontNode = el('div', { className: 'fc-drill-box' },
        el('div', { className: 'fc-cloze-sent', text: promptSent }),
        el('div', { style: 'font-size:13px;color:var(--text-muted)', text: `提示：${card.zh}${card.ipa ? ` · ${card.ipa}` : ''}` }),
        el('form', { className: 'fc-drill-form', id: 'fcDrillForm' },
          el('input', { type: 'text', className: 'fc-drill-input', id: 'fcDrillInput', placeholder: '填入缺失的英文词…', autocomplete: 'off', spellcheck: 'false' }),
          el('button', { type: 'submit', className: 'd-btn d-btn-primary', text: '验证' })
        ),
        el('div', { className: 'fc-feedback', id: 'fcFeedback' }),
        el('button', { id: 'fcRevealBtn', className: 'd-btn d-btn-sm', type: 'button', text: '显示完整答案' })
      );
    } else {
      frontNode = el('div', { className: 'fc-front', id: 'fcFront' },
        el('div', { className: 'fc-word', text: card.en }),
        el('div', { className: 'fc-ipa-row' },
          card.ipa ? el('span', { text: card.ipa }) : null,
          el('button', { id: 'fcSpeak', className: 'd-btn d-btn-sm', type: 'button', text: isTouchDevice ? '朗读' : '朗读 (S)' })
        ),
        el('div', {
          className: 'fc-flip-hint',
          id: 'fcHint',
          style: cardFlipped ? 'display:none' : '',
          text: isTouchDevice ? '轻触卡片显示释义' : '点击卡片或按 Space 显示释义'
        })
      );
    }

    const rateDefs = [
      ['1', 'fc-r1', '忘记', '1 · 12小时'],
      ['2', 'fc-r2', '模糊', '2 · 1天'],
      ['3', 'fc-r3', '正确', '3 · 稳步延长'],
      ['4', 'fc-r4', '轻松', '4 · 加速间隔']
    ];
    const backNode = el('div', { className: 'fc-back', id: 'fcBack', style: cardFlipped ? '' : 'display:none' },
      el('div', { className: 'fc-zh' }, `${card.en} · ${card.zh}`, el('span', { className: 'fc-pos', text: posText })),
      card.def ? el('div', { className: 'fc-def', text: card.def }) : null,
      contextNode,
      builtInExNode,
      el('div', { id: 'fcAiBox' }, aiNode),
      el('div', { className: 'fc-rate-row' },
        rateDefs.map(([score, cls, label, hint]) =>
          el('button', { className: `fc-rate-btn ${cls}`, dataset: { score } }, label, el('small', { text: hint }))
        )
      ),
      el('div', { className: 'fc-foot' },
        el('span', { style: 'font-size:12px;color:var(--text-dim)', text: `已复习 ${card.reviewCount || 0} 次 · 难度系数 ${(card.ease || 2.5).toFixed(2)}` }),
        el('button', { id: 'fcMaster', className: 'd-btn d-btn-sm', text: '✓ 彻底掌握并移出队列' })
      )
    );

    stage.replaceChildren(el('div', { className: 'fc-card' }, frontNode, backNode));

    if (recallMode === 'spelling') {
      speak(card.en);
      document.getElementById('fcDrillInput')?.focus();
    } else if (recallMode === 'cloze') {
      document.getElementById('fcDrillInput')?.focus();
    }

    document.getElementById('fcSpeak')?.addEventListener('click', (e) => { e.stopPropagation(); speak(card.en); });
    document.getElementById('fcFront')?.addEventListener('click', () => flipCard());
    document.getElementById('fcRevealBtn')?.addEventListener('click', () => flipCard());

    document.getElementById('fcDrillForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('fcDrillInput');
      const fb = document.getElementById('fcFeedback');
      const val = (input?.value || '').trim().toLowerCase();
      const expected = (cloze && recallMode === 'cloze' ? cloze.answer : card.en).trim().toLowerCase();
      if (!val) return;
      if (val === expected || val === card.en.toLowerCase()) {
        fb.className = 'fc-feedback ok';
        fb.textContent = `✓ 拼写正确：${card.en}`;
        speak(card.en);
        flipCard();
      } else {
        fb.className = 'fc-feedback err';
        fb.textContent = `✗ 正确答案：${cloze && recallMode === 'cloze' ? cloze.answer : card.en}`;
        flipCard();
      }
    });

    document.getElementById('fcMaster')?.addEventListener('click', async () => {
      await storage.markKnown(card.zh);
      sessionDone++;
      document.getElementById('sessionDone').textContent = String(sessionDone);
      await renderFlashcardStage(practiceAll);
    });
    document.querySelectorAll('.fc-rate-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await rateCurrentCard(parseInt(btn.dataset.score, 10), practiceAll);
      });
    });
    document.getElementById('fcFetchAi')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '解析中…';
      const r = await chrome.runtime.sendMessage({
        type: 'IFLL_AI_COMBINED',
        en: card.en, zh: card.zh, def: card.def || '', context: card.context || ''
      }).catch(() => ({ error: '请求失败' }));
      if (r?.success) {
        cardFlipped = true;
        await drawCard(card, practiceAll);
      } else {
        b.disabled = false;
        b.textContent = r?.error || '失败，点击重试';
      }
    });
  }

  function flipCard() {
    if (!currentCard || cardFlipped) return;
    cardFlipped = true;
    const back = document.getElementById('fcBack');
    const hint = document.getElementById('fcHint');
    if (back) back.style.display = 'block';
    if (hint) hint.style.display = 'none';
  }

  async function rateCurrentCard(score, practiceAll = false) {
    if (!currentCard) return;
    await storage.scoreReview(currentCard.zh, score);
    sessionDone++;
    document.getElementById('sessionDone').textContent = String(sessionDone);
    await renderFlashcardStage(practiceAll);
  }

  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('panel-review').classList.contains('active')) return;
    if (e.target.matches('input, textarea, select')) return;
    if (!currentCard) return;
    if (e.code === 'Space') { e.preventDefault(); flipCard(); }
    else if (e.key.toLowerCase() === 's') { speak(currentCard.en); }
    else if (cardFlipped && ['1', '2', '3', '4'].includes(e.key)) {
      rateCurrentCard(parseInt(e.key, 10));
    }
  });

  /* ── TAB 2: Vocab, Bulk Import & Anki TSV Export ── */
  const bulkPanel = document.getElementById('bulkImportPanel');
  const bulkMsg = document.getElementById('bulkMsg');
  document.getElementById('toggleBulkImportBtn').addEventListener('click', () => {
    bulkPanel.style.display = bulkPanel.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('bulkUploadBtn').addEventListener('click', () => {
    const f = document.getElementById('bulkFileInput');
    f.value = '';
    f.click();
  });
  document.getElementById('bulkFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('bulkTextarea').value = await file.text();
  });
  document.getElementById('bulkConfirmBtn').addEventListener('click', async () => {
    const raw = document.getElementById('bulkTextarea').value;
    const parsed = utils.parseBulkWordList(raw);
    if (!parsed.length) {
      bulkMsg.className = 'd-msg err';
      bulkMsg.textContent = '未识别到有效词条，请检查分隔格式';
      return;
    }
    const alsoAddToReview = document.getElementById('bulkAlsoReview').checked;
    const res = await storage.addUserWordsBulk(parsed, { alsoAddToReview, level: settings.level || 'cet4' });
    bulkMsg.className = 'd-msg ok';
    bulkMsg.textContent = `导入成功：新增 ${res.added} 条，跳过重复 ${res.skipped} 条`;
    document.getElementById('bulkTextarea').value = '';
    await renderVocabList();
  });

  document.getElementById('exportAnkiBtn').addEventListener('click', async () => {
    await refreshSettings();
    const source = activeVocabSub === 'userWords'
      ? (settings.userWords || [])
      : (activeVocabSub === 'phrases'
        ? Object.entries(storage.resolvePhraseMap(settings)).map(([zh, en]) => ({ en, zh, level: 'phrase' }))
        : (settings.reviewQueue || []));
    const tsv = utils.buildAnkiTsv(source);
    if (!tsv) {
      alert('当前分类下没有可导出的词条');
      return;
    }
    const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ifll-anki-${activeVocabSub}-${utils.getLocalDateStr()}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });

  async function renderVocabList() {
    await refreshSettings();
    const q = document.getElementById('vocabSearch').value.trim().toLowerCase();
    const listEl = document.getElementById('vocabList');
    const el = utils.createEl;

    document.getElementById('addUserWordForm').style.display = activeVocabSub === 'userWords' ? 'flex' : 'none';
    document.getElementById('addPhraseForm').style.display = activeVocabSub === 'phrases' ? 'flex' : 'none';
    listEl.textContent = '';

    const renderEmpty = (msg) => {
      listEl.replaceChildren(el('div', { className: 'd-card', style: 'text-align:center;color:var(--text-dim)', text: msg }));
    };

    if (activeVocabSub === 'reviewQueue') {
      const items = (settings.reviewQueue || []).filter(w =>
        !q || w.zh.toLowerCase().includes(q) || w.en.toLowerCase().includes(q)
      );
      if (!items.length) { renderEmpty('暂无符合条件的复习词汇'); return; }
      for (const w of items) {
        const speakBtn = el('button', { className: 'd-btn d-btn-sm', text: '朗读' });
        const knownBtn = el('button', { className: 'd-btn d-btn-sm', text: '已掌握' });
        const rmBtn = el('button', { className: 'd-btn d-btn-sm d-btn-danger', text: '移出' });
        speakBtn.addEventListener('click', () => speak(w.en));
        knownBtn.addEventListener('click', async () => { await storage.markKnown(w.zh); renderVocabList(); });
        rmBtn.addEventListener('click', async () => { await storage.removeFromReview(w.zh); renderVocabList(); });
        listEl.appendChild(el('div', { className: 'd-row-item' },
          el('div', { className: 'd-row-main' },
            el('span', { className: 'd-row-en', text: w.en }),
            el('span', { className: 'd-row-zh', text: w.zh }),
            el('span', { className: 'd-row-meta', text: `${formatRelativeTime(w.nextReview || 0)} · 已复习 ${w.reviewCount || 0} 次${w.context ? ' · 含原句语境' : ''}` })
          ),
          el('div', { className: 'd-row-actions' }, speakBtn, knownBtn, rmBtn)
        ));
      }
    } else if (activeVocabSub === 'knownWords') {
      const items = (settings.knownWords || []).filter(zh => !q || zh.toLowerCase().includes(q));
      if (!items.length) { renderEmpty('暂无已掌握词汇'); return; }
      for (const zh of items.slice(0, 300)) {
        const unmarkBtn = el('button', { className: 'd-btn d-btn-sm', text: '移回学习' });
        unmarkBtn.addEventListener('click', async () => { await storage.markUnknown(zh); renderVocabList(); });
        listEl.appendChild(el('div', { className: 'd-row-item' },
          el('div', { className: 'd-row-main' }, el('span', { className: 'd-row-zh', text: zh })),
          el('div', { className: 'd-row-actions' }, unmarkBtn)
        ));
      }
    } else if (activeVocabSub === 'userWords') {
      const items = (settings.userWords || []).filter(w =>
        !q || w.zh.toLowerCase().includes(q) || w.en.toLowerCase().includes(q)
      );
      if (!items.length) { renderEmpty('暂无自定义生词，可手动添加或点击右上角「批量导入」'); return; }
      for (const w of items) {
        const speakBtn = el('button', { className: 'd-btn d-btn-sm', text: '朗读' });
        const revBtn = el('button', { className: 'd-btn d-btn-sm', text: '加入复习' });
        const delBtn = el('button', { className: 'd-btn d-btn-sm d-btn-danger', text: '删除' });
        speakBtn.addEventListener('click', () => speak(w.en));
        revBtn.addEventListener('click', async () => { await storage.addToReview(w.zh, w.en, w); renderVocabList(); });
        delBtn.addEventListener('click', async () => { await storage.removeUserWord(w.zh); renderVocabList(); });
        listEl.appendChild(el('div', { className: 'd-row-item' },
          el('div', { className: 'd-row-main' },
            el('span', { className: 'd-row-en', text: w.en }),
            el('span', { className: 'd-row-zh', text: w.zh }),
            el('span', { className: 'd-row-meta', text: `${utils.posLabel(w.pos)} ${w.def || ''}`.trim() })
          ),
          el('div', { className: 'd-row-actions' }, speakBtn, revBtn, delBtn)
        ));
      }
    } else if (activeVocabSub === 'phrases') {
      const map = storage.resolvePhraseMap(settings);
      const entries = Object.entries(map).filter(([zh, en]) =>
        !q || zh.toLowerCase().includes(q) || en.toLowerCase().includes(q)
      );
      if (!entries.length) { renderEmpty('暂无匹配搭配短语'); return; }
      for (const [zh, en] of entries) {
        const isBuiltin = zh in constants.DEFAULT_PHRASE_MAP && !(zh in (settings.phraseMap || {}));
        const speakBtn = el('button', { className: 'd-btn d-btn-sm', text: '朗读' });
        const delBtn = el('button', { className: 'd-btn d-btn-sm d-btn-danger', text: '删除' });
        speakBtn.addEventListener('click', () => speak(en));
        delBtn.addEventListener('click', async () => { await storage.removePhrase(zh); renderVocabList(); });
        listEl.appendChild(el('div', { className: 'd-row-item' },
          el('div', { className: 'd-row-main' },
            el('span', { className: 'd-row-zh', text: zh }),
            el('span', { className: 'd-row-en', text: en }),
            el('span', { className: 'd-row-meta', text: isBuiltin ? '内置' : '自定义' })
          ),
          el('div', { className: 'd-row-actions' }, speakBtn, delBtn)
        ));
      }
    }
  }

  document.getElementById('vocabTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.d-subtab');
    if (!b?.dataset.sub) return;
    activeVocabSub = b.dataset.sub;
    document.querySelectorAll('.d-subtab').forEach(x => x.classList.toggle('active', x === b));
    renderVocabList();
  });
  document.getElementById('vocabSearch').addEventListener('input', () => renderVocabList());

  document.getElementById('uwAddBtn').addEventListener('click', async () => {
    const zh = document.getElementById('uwZh').value.trim();
    const en = document.getElementById('uwEn').value.trim();
    const pos = document.getElementById('uwPos').value;
    const def = document.getElementById('uwDef').value.trim();
    if (!zh || !en) return;
    await storage.addUserWord({ zh, en, pos, def, level: settings.level || 'cet4' });
    document.getElementById('uwZh').value = '';
    document.getElementById('uwEn').value = '';
    document.getElementById('uwDef').value = '';
    renderVocabList();
  });

  document.getElementById('phAddBtn').addEventListener('click', async () => {
    const zh = document.getElementById('phZh').value.trim();
    const en = document.getElementById('phEn').value.trim();
    if (!zh || !en) return;
    await storage.setPhrase(zh, en);
    document.getElementById('phZh').value = '';
    document.getElementById('phEn').value = '';
    renderVocabList();
  });
  document.getElementById('phResetBtn').addEventListener('click', async () => {
    await storage.resetDefaultPhrases();
    renderVocabList();
  });

  /* ── TAB 3: AI Batch, Cache & Custom Actions ── */
  async function refreshCacheStats() {
    const stats = await chrome.runtime.sendMessage({ type: 'IFLL_CACHE_STATS' }).catch(() => ({ words: 0, translations: 0 }));
    document.getElementById('cacheWordCnt').textContent = String(stats?.words || 0);
    document.getElementById('cacheTxCnt').textContent = String(stats?.translations || 0);
  }

  function renderBatch(state) {
    if (!state || state.status === 'idle') return;
    document.getElementById('dBatchProg').style.display = 'flex';
    const pct = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;
    document.getElementById('dBatchFill').style.width = pct + '%';
    document.getElementById('dBatchText').textContent = `${state.processed}/${state.total}`;
    document.getElementById('dBatchStart').style.display = state.running ? 'none' : 'inline-block';
    document.getElementById('dBatchStop').style.display = state.running ? 'inline-block' : 'none';
    const msg = document.getElementById('dBatchMsg');
    msg.textContent = state.message || '';
    msg.className = 'd-msg' + (state.status === 'error' ? ' err' : (state.status === 'done' ? ' ok' : ''));
    if (state.status === 'done') refreshCacheStats();
  }

  document.getElementById('dBatchStart').addEventListener('click', async () => {
    const count = parseInt(document.getElementById('dBatchCount').value, 10) || 50;
    const level = document.getElementById('dBatchLevel').value;
    const state = await chrome.runtime.sendMessage({ type: 'IFLL_BATCH_START', count, level }).catch(() => null);
    if (state) renderBatch(state);
  });
  document.getElementById('dBatchStop').addEventListener('click', async () => {
    const state = await chrome.runtime.sendMessage({ type: 'IFLL_BATCH_STOP' }).catch(() => null);
    if (state) renderBatch(state);
  });
  document.getElementById('clearCacheBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'IFLL_CACHE_CLEAR' }).catch(() => {});
    refreshCacheStats();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'IFLL_BATCH_PROGRESS') renderBatch(msg.state);
  });
  chrome.runtime.sendMessage({ type: 'IFLL_BATCH_STATUS' }).then(renderBatch).catch(() => {});

  const ACTION_PRESETS = {
    etymology: {
      name: '词根记忆',
      prompt: '拆解英文单词 {word}（{zh}）的词根词缀来源，给出简明的记忆联想与1个同源词。',
      fields: ['词根', '记忆法', '同源词']
    },
    nuance: {
      name: '近义辨析',
      prompt: '结合语境「{context}」，对比 {word}（{zh}）与 2 个最常见近义词在语域与使用场景上的差异。',
      fields: ['核心差异', '易错提示']
    },
    business: {
      name: '商务表达',
      prompt: '给出在职场邮件或会议中使用 {word}（{zh}）的 2 个地道句子及中文翻译。',
      fields: ['职场例句', '更正式替代']
    }
  };

  async function renderCustomActions() {
    await refreshSettings();
    const list = document.getElementById('customActionsList');
    const acts = settings.customActions || [];
    const el = utils.createEl;
    if (!acts.length) {
      list.replaceChildren(el('div', { style: 'font-size:12.5px;color:var(--text-dim);padding:6px 0', text: '暂无自定义动作，可直接点右上角模板快速创建。' }));
      return;
    }
    list.textContent = '';
    for (const act of acts) {
      const editBtn = el('button', { className: 'd-btn d-btn-sm', text: '编辑' });
      const delBtn = el('button', { className: 'd-btn d-btn-sm d-btn-danger', text: '删除' });
      editBtn.addEventListener('click', () => {
        editingActionId = act.id;
        document.getElementById('actName').value = act.name;
        document.getElementById('actPrompt').value = act.prompt || '';
        document.getElementById('actFields').value = (act.fields || []).join(', ');
        document.getElementById('actCancel').style.display = 'inline-block';
      });
      delBtn.addEventListener('click', async () => {
        const next = (settings.customActions || []).filter(a => a.id !== act.id);
        await storage.set({ customActions: next });
        renderCustomActions();
      });
      list.appendChild(el('div', { className: 'd-row-item' },
        el('div', { className: 'd-row-main' },
          el('span', { className: 'd-row-en', text: act.name }),
          el('span', { className: 'd-row-meta', text: (act.prompt || '').slice(0, 70) })
        ),
        el('div', { className: 'd-row-actions' }, editBtn, delBtn)
      ));
    }
  }

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = ACTION_PRESETS[btn.dataset.preset];
      if (!p) return;
      const acts = [...(settings.customActions || [])];
      acts.push({ id: 'act_' + Date.now().toString(36), ...p });
      await storage.set({ customActions: acts });
      renderCustomActions();
    });
  });

  document.getElementById('actCancel').addEventListener('click', () => {
    editingActionId = null;
    document.getElementById('actName').value = '';
    document.getElementById('actPrompt').value = '';
    document.getElementById('actFields').value = '';
    document.getElementById('actCancel').style.display = 'none';
  });

  document.getElementById('actSave').addEventListener('click', async () => {
    const name = document.getElementById('actName').value.trim();
    const prompt = document.getElementById('actPrompt').value.trim();
    const fields = document.getElementById('actFields').value.split(/[,，]/).map(x => x.trim()).filter(Boolean);
    if (!name || !prompt) return;
    const acts = [...(settings.customActions || [])];
    if (editingActionId) {
      const idx = acts.findIndex(a => a.id === editingActionId);
      if (idx >= 0) acts[idx] = { ...acts[idx], name, prompt, fields };
    } else {
      acts.push({ id: 'act_' + Date.now().toString(36), name, prompt, fields });
    }
    await storage.set({ customActions: acts });
    editingActionId = null;
    document.getElementById('actName').value = '';
    document.getElementById('actPrompt').value = '';
    document.getElementById('actFields').value = '';
    document.getElementById('actCancel').style.display = 'none';
    renderCustomActions();
  });

  const hashTab = (window.location.hash || '#review').slice(1);
  activateTab(['review', 'vocab', 'ai'].includes(hashTab) ? hashTab : 'review');
});
