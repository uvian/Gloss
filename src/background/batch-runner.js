/*
 * IFLL — Persistent Background Batch Runner (v0.4)
 * Persists remaining queue to chrome.storage.local and schedules a chrome.alarms
 * heartbeat so even if Chrome suspends the MV3 Service Worker after 5 minutes,
 * the batch automatically resumes cleanly without losing progress.
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const CHUNK_SIZE = 10;
  const JOB_KEY = 'ifll_batch_job';
  const ALARM_NAME = 'ifll-batch-resume';

  let _controller = null;
  let _loopActive = false;
  let _state = {
    running: false,
    status: 'idle',
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    currentChunk: 0,
    totalChunks: 0,
    message: ''
  };

  function getStatus() {
    return { ..._state };
  }

  function broadcast() {
    try {
      chrome.runtime.sendMessage({ type: 'IFLL_BATCH_PROGRESS', state: getStatus() }).catch(() => {});
    } catch (_) {}
  }

  async function saveJob(remaining) {
    try {
      await chrome.storage.local.set({
        [JOB_KEY]: {
          state: { ..._state },
          remaining: Array.isArray(remaining) ? remaining : []
        }
      });
    } catch (_) {}
  }

  async function clearJob() {
    try {
      await chrome.storage.local.remove(JOB_KEY);
      if (chrome.alarms) await chrome.alarms.clear(ALARM_NAME);
    } catch (_) {}
  }

  function scheduleResumeAlarm() {
    try {
      if (chrome.alarms) {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
      }
    } catch (_) {}
  }

  async function runQueue(initialQueue) {
    if (_loopActive) return;
    _loopActive = true;
    _controller = new AbortController();
    scheduleResumeAlarm();

    const queue = [...initialQueue];
    try {
      while (queue.length > 0) {
        if (_controller.signal.aborted) break;
        const chunk = queue.splice(0, CHUNK_SIZE);
        _state.currentChunk = Math.min(_state.totalChunks, Math.floor(_state.processed / CHUNK_SIZE) + 1);
        _state.message = `正在解析第 ${_state.currentChunk}/${_state.totalChunks} 批…`;
        broadcast();

        const res = await IFLL.aiClient.analyzeBatchChunk(chunk, _controller.signal);
        if (_controller.signal.aborted || res.aborted) {
          // Put chunk back if aborted before completing
          queue.unshift(...chunk);
          break;
        }

        if (res.success && Array.isArray(res.results)) {
          const byWord = new Map();
          for (const item of res.results) {
            const k = String(item?.word || '').trim().toLowerCase();
            if (k) byWord.set(k, item);
          }
          const idxSafe = res.results.length === chunk.length;
          let chunkOk = 0;
          for (let j = 0; j < chunk.length; j++) {
            const target = chunk[j];
            const match = byWord.get(target.en.toLowerCase()) || (idxSafe ? res.results[j] : null);
            if (match && IFLL.aiClient.hasUsableAnalysis(match)) {
              await IFLL.cacheDb.setWordAnalysis(target.en, IFLL.aiClient.toCacheEntry(match));
              chunkOk++;
            }
          }
          _state.succeeded += chunkOk;
          _state.failed += chunk.length - chunkOk;
        } else {
          _state.failed += chunk.length;
          _state.message = res.error || '当前批次失败，继续下一批…';
          if (res.error && /API Key|余额不足|无访问权限/.test(res.error)) {
            _state.processed = Math.min(_state.total, _state.processed + chunk.length);
            _state.running = false;
            _state.status = 'error';
            await clearJob();
            broadcast();
            return;
          }
        }

        _state.processed = Math.min(_state.total, _state.processed + chunk.length);
        await saveJob(queue);
        broadcast();

        if (!_controller.signal.aborted && queue.length > 0) {
          await new Promise(r => setTimeout(r, 600));
        }
      }

      const stopped = _controller.signal.aborted;
      _state.running = false;
      _state.status = stopped ? 'stopped' : 'done';
      _state.message = stopped
        ? `已停止（成功 ${_state.succeeded}，失败 ${_state.failed}）`
        : `完成（成功 ${_state.succeeded}，失败 ${_state.failed}）`;
      await clearJob();
      broadcast();
    } catch (err) {
      _state.running = false;
      _state.status = 'error';
      _state.message = err?.message || '预处理意外中断';
      await clearJob();
      broadcast();
    } finally {
      _loopActive = false;
      _controller = null;
    }
  }

  async function start(count = 50, levelFilter = 'all') {
    if (_loopActive || _state.running) return getStatus();

    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (!apiKey) {
      _state = { ..._state, running: false, status: 'error', message: '请先配置 AI API Key' };
      broadcast();
      return getStatus();
    }

    const safeCount = Math.max(5, Math.min(500, parseInt(count, 10) || 50));
    let wordList = [];
    try {
      const resp = await fetch(chrome.runtime.getURL('src/data/wordbank.json'));
      wordList = await resp.json();
    } catch (_) {
      _state = { ..._state, running: false, status: 'error', message: '词库加载失败' };
      broadcast();
      return getStatus();
    }

    const cachedKeys = await IFLL.cacheDb.getAllCachedWordKeys();
    const seenEn = new Set();
    const candidates = [];

    for (const w of wordList) {
      const en = (w.en || '').trim();
      const key = en.toLowerCase();
      if (!en || seenEn.has(key) || cachedKeys.has(key)) continue;
      if (levelFilter && levelFilter !== 'all' && w.level !== levelFilter) continue;
      seenEn.add(key);
      candidates.push({ en, zh: w.zh, def: w.def || '' });
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const batch = candidates.slice(0, safeCount);
    if (!batch.length) {
      _state = {
        running: false, status: 'done',
        total: 0, processed: 0, succeeded: 0, failed: 0,
        currentChunk: 0, totalChunks: 0,
        message: '所有候选词均已完成缓存'
      };
      broadcast();
      return getStatus();
    }

    _state = {
      running: true,
      status: 'running',
      total: batch.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      currentChunk: 0,
      totalChunks: Math.ceil(batch.length / CHUNK_SIZE),
      message: '准备开始…'
    };
    await saveJob(batch);
    broadcast();

    runQueue(batch);
    return getStatus();
  }

  async function resumeIfPending() {
    if (_loopActive) return;
    try {
      const data = await chrome.storage.local.get(JOB_KEY);
      const saved = data[JOB_KEY];
      if (!saved || !saved.state?.running || !Array.isArray(saved.remaining) || !saved.remaining.length) {
        if (chrome.alarms) await chrome.alarms.clear(ALARM_NAME);
        return;
      }
      _state = { ...saved.state, running: true, status: 'running', message: '断点续传中…' };
      broadcast();
      runQueue(saved.remaining);
    } catch (_) {}
  }

  function stop() {
    if (_controller) _controller.abort();
    if (_state.running) {
      _state.message = '正在中止…';
      broadcast();
    }
    clearJob();
    return getStatus();
  }

  const batchRunner = { start, stop, getStatus, resumeIfPending, ALARM_NAME };
  IFLL.batchRunner = batchRunner;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = batchRunner;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
