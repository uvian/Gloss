/*
 * IFLL — Shadow DOM Isolated Content UI (v0.4)
 * Features:
 * - Word Card with context sentence quote, contextual AI meaning, SVG icons, TTS rate/voice, drag & Esc
 * - Hover Mini-Preview (260ms delay, non-intrusive single-line gloss)
 * - Selection Toolbar with Translate / Explain / Word Card / Speak / Copy
 * - Floating Mode Capsule + Popover Menu
 * - Actionable Toasts (supports 1-click Undo for input translation)
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const ICONS = {
    speak: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    regen: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
  };

  const SHADOW_CSS = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
      pointer-events: none;
      font-family: -apple-system, 'Helvetica Neue', BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }

    .ifll-root {
      --bg: #FAF9F7;
      --surface: #FFFFFF;
      --muted: #F3F0EB;
      --text: #1A1A1A;
      --text-muted: #66605A;
      --text-dim: #9A938B;
      --accent: #2E5090;
      --accent-soft: #E8EDF5;
      --border: #E5E0D8;
      --border-soft: #F0ECE6;
      --success: #2D6A4F;
      --success-soft: #EEF6F1;
      --warn: #9A6B1C;
      --warn-soft: #FDF6E3;
      --danger: #C53030;
      --danger-soft: #FFF5F5;
      --shadow: 0 8px 28px rgba(26, 26, 26, 0.12), 0 1px 4px rgba(26, 26, 26, 0.06);
      font-size: 13px;
      color: var(--text);
      line-height: 1.5;
    }
    .ifll-root.dark {
      --bg: #1B1C20;
      --surface: #222429;
      --muted: #2B2D34;
      --text: #EAE6E0;
      --text-muted: #A6A099;
      --text-dim: #78726C;
      --accent: #7EA6E0;
      --accent-soft: #253047;
      --border: #353740;
      --border-soft: #2B2D34;
      --success: #6DBF93;
      --success-soft: #1B2E24;
      --warn: #E2B459;
      --warn-soft: #2F2818;
      --danger: #F08A8A;
      --danger-soft: #311D1D;
      --shadow: 0 10px 32px rgba(0, 0, 0, 0.48), 0 2px 6px rgba(0, 0, 0, 0.28);
    }

    /* ── Hover Mini-Preview ── */
    .hover-pill {
      position: fixed;
      pointer-events: none;
      display: none;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 7px;
      box-shadow: var(--shadow);
      font-size: 12px;
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      animation: ttIn 0.12s ease-out;
    }
    .hover-en { font-weight: 650; color: var(--accent); }
    .hover-ipa { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; color: var(--text-dim); }
    .hover-zh { color: var(--text); }

    /* ── Word Tooltip Card ── */
    .tt-card {
      position: fixed;
      pointer-events: auto;
      display: none;
      width: 330px;
      max-width: calc(100vw - 16px);
      max-height: min(520px, calc(100vh - 24px));
      overflow-y: auto;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow);
      animation: ttIn 0.15s ease-out;
    }
    @keyframes ttIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .tt-card::-webkit-scrollbar { width: 5px; }
    .tt-card::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    .tt-handle {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 18px;
      background: var(--bg);
      cursor: move;
      border-radius: 10px 10px 0 0;
      user-select: none;
    }
    .tt-handle-bar { width: 34px; height: 3.5px; border-radius: 2px; background: var(--border); transition: background 0.15s; }
    .tt-handle:hover .tt-handle-bar { background: var(--text-dim); }
    .tt-close {
      position: absolute; right: 6px; top: 4px; width: 22px; height: 22px;
      border: none; border-radius: 5px; background: transparent; color: var(--text-dim);
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    }
    .tt-close:hover { background: var(--muted); color: var(--text); }

    .tt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 14px; }
    .tt-word-wrap { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .tt-en { font-size: 19px; font-weight: 650; letter-spacing: -0.01em; color: var(--text); word-break: break-word; }
    .tt-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border: 1px solid transparent; border-radius: 6px;
      background: transparent; color: var(--text-muted); cursor: pointer; flex-shrink: 0;
      transition: all 0.12s; padding: 0;
    }
    .tt-icon-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .tt-icon-btn.spinning svg { animation: ifllSpin 0.9s linear infinite; }
    @keyframes ifllSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .tt-badge {
      font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
      padding: 2px 6px; border-radius: 4px; background: var(--muted); color: var(--text-dim); flex-shrink: 0;
    }
    .tt-meta {
      padding: 0 14px 6px 14px; font-size: 12.5px; color: var(--text-muted);
      display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
    }
    .tt-zh { color: var(--text); font-weight: 500; }
    .tt-ipa { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 11.5px; color: var(--text-dim); }
    .tt-pos { color: var(--accent); font-weight: 600; font-size: 11.5px; }
    .tt-surface { font-size: 11px; color: var(--text-dim); font-style: italic; }

    .tt-def { padding: 3px 14px 6px 14px; font-size: 12.5px; color: var(--text-muted); line-height: 1.5; }
    .tt-context {
      margin: 4px 14px 6px; padding: 6px 9px; font-size: 12px; color: var(--text-muted);
      background: var(--muted); border-left: 2.5px solid var(--accent); border-radius: 0 5px 5px 0;
      line-height: 1.48;
    }
    .tt-context-meaning {
      margin-bottom: 6px; padding: 6px 9px; font-size: 12.5px; color: var(--accent);
      background: var(--accent-soft); border-radius: 6px; line-height: 1.5; font-weight: 500;
    }

    .tt-divider { height: 1px; background: var(--border-soft); margin: 6px 14px; }
    .tt-section-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 14px; }
    .tt-label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-dim); }
    .tt-cached-tag { font-size: 10px; color: var(--text-dim); font-style: italic; }

    .tt-ex-item {
      position: relative; margin: 4px 14px; padding: 6px 46px 6px 9px;
      background: var(--surface); border: 1px solid var(--border-soft);
      border-left: 2.5px solid var(--accent-soft); border-radius: 5px;
    }
    .tt-ex-en { font-size: 12.5px; color: var(--text); line-height: 1.48; }
    .tt-ex-cn { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.45; }
    .tt-ex-tools { position: absolute; right: 4px; top: 4px; display: flex; gap: 1px; }
    .tt-ex-tools .tt-icon-btn { width: 22px; height: 22px; }
    .ifll-bold { font-weight: 650; color: var(--text); }

    .tt-deep-box { padding: 4px 14px 6px 14px; }
    .tt-deep-row { font-size: 12.5px; color: var(--text); margin-bottom: 4px; line-height: 1.5; }
    .tt-deep-tag {
      display: inline-block; background: var(--muted); color: var(--text-muted);
      font-size: 10.5px; font-weight: 600; padding: 1px 5px; border-radius: 3px; margin-right: 5px;
    }
    .tt-deep-usage { font-size: 12.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.55; white-space: pre-wrap; }
    .tt-stream {
      font-size: 12px; color: var(--text-muted); background: var(--surface);
      border: 1px solid var(--border-soft); border-radius: 6px; padding: 7px 9px;
      white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow-y: auto;
    }
    .tt-stream.reasoning { color: var(--text-dim); font-style: italic; }
    .tt-cursor { color: var(--accent); animation: ttBlink 1s step-end infinite; }
    @keyframes ttBlink { 50% { opacity: 0; } }
    .tt-err { font-size: 12px; color: var(--danger); margin: 4px 0; }

    .tt-actions { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 14px 10px 14px; }
    .tt-actions-tight { padding-top: 0; }
    .tt-btn {
      flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 6px;
      background: var(--surface); color: var(--text-muted); font-size: 11.5px; font-weight: 500;
      padding: 5px 8px; cursor: pointer; transition: all 0.12s; white-space: nowrap; text-align: center;
    }
    .tt-btn:hover:not(:disabled) { background: var(--muted); color: var(--text); }
    .tt-btn:active:not(:disabled) { transform: scale(0.97); }
    .tt-btn:disabled { opacity: 0.55; cursor: default; }
    .tt-btn-accent { border-color: var(--accent-soft); color: var(--accent); background: var(--accent-soft); }
    .tt-btn-accent:hover:not(:disabled) { filter: brightness(0.96); color: var(--accent); }
    .tt-btn-known { border-color: var(--success); color: var(--success); background: var(--surface); }
    .tt-btn-known:hover:not(:disabled) { background: var(--success-soft); }
    .tt-btn-danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); border-color: var(--danger); }

    .tt-r4 { background: var(--success-soft); color: var(--success); border-color: transparent; }
    .tt-r3 { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
    .tt-r2 { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
    .tt-r1 { background: var(--danger-soft); color: var(--danger); border-color: transparent; }

    /* ── Selection Toolbar ── */
    .sel-wrap {
      position: fixed; pointer-events: auto; display: none; flex-direction: column;
      background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
      box-shadow: var(--shadow); max-width: min(370px, calc(100vw - 16px)); overflow: hidden;
    }
    .sel-bar { display: flex; align-items: center; gap: 2px; padding: 3px 4px; }
    .sel-btn {
      border: none; background: transparent; color: var(--text-muted); font-size: 12px; font-weight: 500;
      padding: 4px 8px; border-radius: 5px; cursor: pointer; white-space: nowrap; transition: all 0.12s;
    }
    .sel-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); }
    .sel-btn:disabled { opacity: 0.55; }
    .sel-result {
      display: none; border-top: 1px solid var(--border-soft); padding: 9px 11px;
      background: var(--surface); font-size: 12.5px; color: var(--text); line-height: 1.58;
      max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
    }
    .sel-result-foot {
      display: flex; justify-content: flex-end; gap: 6px; margin-top: 7px; padding-top: 6px;
      border-top: 1px solid var(--border-soft);
    }
    .sel-foot-btn {
      border: 1px solid var(--border); background: var(--bg); color: var(--text-muted);
      font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
    }
    .sel-foot-btn:hover { color: var(--accent); border-color: var(--accent); }

    /* ── Floating Mode Capsule + Popover Menu ── */
    .float-wrap {
      position: fixed; right: 20px; bottom: 22px; pointer-events: auto;
      display: none; flex-direction: column; align-items: flex-end; gap: 8px;
    }
    .float-menu {
      display: none; flex-direction: column; gap: 3px; min-width: 146px; padding: 6px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow);
    }
    .float-menu.open { display: flex; }
    .float-menu-item {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border: none; background: transparent; color: var(--text-muted); font-size: 12px; font-weight: 500;
      padding: 6px 9px; border-radius: 6px; cursor: pointer; text-align: left;
    }
    .float-menu-item:hover { background: var(--muted); color: var(--text); }
    .float-menu-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .float-menu-sep { height: 1px; background: var(--border-soft); margin: 3px 4px; }
    .float-pill {
      display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px;
      border-radius: 17px; border: 1px solid var(--border); background: var(--bg);
      color: var(--text-muted); font-size: 11.5px; font-weight: 600; cursor: pointer;
      box-shadow: var(--shadow); opacity: 0.86; transition: all 0.16s;
    }
    .float-pill:hover { opacity: 1; transform: translateY(-1px); color: var(--text); }
    .float-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot-replace { background: #2E5090; }
    .dot-annotate { background: #2D6A4F; }
    .dot-translate { background: #C28A22; }
    .dot-off { background: #A09A94; }

    /* ── Prompt Banner ── */
    .prompt-bar {
      position: fixed; top: 14px; left: 50%; transform: translateX(-50%); pointer-events: auto;
      display: flex; align-items: center; gap: 12px; padding: 9px 14px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: var(--shadow); max-width: calc(100vw - 24px);
    }
    .prompt-title { font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; }
    .prompt-actions { display: flex; gap: 5px; }
    .prompt-btn {
      border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
      font-size: 11.5px; font-weight: 500; padding: 4px 9px; border-radius: 6px; cursor: pointer; white-space: nowrap;
    }
    .prompt-btn:hover { background: var(--muted); color: var(--text); }
    .prompt-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }

    /* ── Toast (supports optional action button) ── */
    .toast {
      position: fixed; bottom: calc(66px + env(safe-area-inset-bottom, 0px)); right: calc(20px + env(safe-area-inset-right, 0px)); pointer-events: auto;
      display: flex; align-items: center; gap: 10px;
      padding: 9px 14px; border-radius: 8px; background: var(--bg);
      border: 1px solid var(--border); color: var(--text); font-size: 12.5px;
      box-shadow: var(--shadow); max-width: min(340px, calc(100vw - 24px)); animation: ttIn 0.16s ease-out;
    }
    .toast.warn { border-left: 3px solid var(--warn); }
    .toast.info { border-left: 3px solid var(--accent); }
    .toast-action {
      border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent);
      font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 4px; cursor: pointer;
    }

    /* ── Mobile Bottom Sheet & Touch Ergonomics (desktop unchanged) ── */
    .float-wrap { z-index: 10; }
    .sel-wrap { z-index: 20; }
    .tt-backdrop {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: none;
      pointer-events: auto;
      background: rgba(18, 20, 26, 0.34);
      backdrop-filter: blur(1px);
      -webkit-backdrop-filter: blur(1px);
      animation: fadeIn 0.16s ease-out;
    }
    .tt-card { z-index: 40; }
    .prompt-bar { z-index: 45; }
    .toast { z-index: 50; }
    @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes sheetUp {
      from { opacity: 0.7; transform: translateY(28px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .tt-card.mobile-sheet {
      left: 0 !important;
      right: 0;
      top: auto !important;
      bottom: 0;
      width: 100% !important;
      max-width: 100vw;
      max-height: min(76dvh, 76vh);
      border-radius: 16px 16px 0 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
      animation: sheetUp 0.18s ease-out;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
    }
    .tt-card.mobile-sheet .tt-handle {
      height: 28px;
      touch-action: none;
      border-radius: 16px 16px 0 0;
    }
    .tt-card.mobile-sheet .tt-handle-bar { width: 42px; height: 4px; }
    .tt-card.mobile-sheet .tt-close { width: 32px; height: 32px; right: 10px; top: 6px; }
    .tt-card.mobile-sheet .tt-icon-btn { width: 32px; height: 32px; }
    .tt-card.mobile-sheet .tt-btn { padding: 9px 10px; font-size: 13px; min-height: 36px; }
    .tt-card.mobile-sheet .tt-en { font-size: 21px; }
    .tt-card.mobile-sheet .tt-ex-item { padding-right: 68px; }
    .tt-card.mobile-sheet .tt-ex-tools .tt-icon-btn { width: 30px; height: 30px; }

    @media (pointer: coarse), (max-width: 640px) {
      .float-wrap {
        right: calc(14px + env(safe-area-inset-right, 0px));
        bottom: calc(18px + env(safe-area-inset-bottom, 0px));
      }
      .float-pill {
        height: 38px;
        padding: 0 13px;
        border-radius: 19px;
        font-size: 12.5px;
        touch-action: none;
      }
      .float-menu { min-width: 160px; padding: 7px; }
      .float-menu-item { padding: 9px 12px; font-size: 13px; }
      .sel-bar { padding: 4px; gap: 3px; flex-wrap: wrap; justify-content: center; }
      .sel-btn { padding: 7px 10px; font-size: 13px; }
      .sel-foot-btn { padding: 5px 10px; font-size: 12px; }
      .prompt-bar {
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        width: calc(100vw - 20px);
        padding: 10px 12px;
      }
      .prompt-btn { padding: 6px 12px; font-size: 12.5px; }
      .toast {
        left: 12px;
        right: 12px;
        max-width: none;
        justify-content: space-between;
        bottom: calc(68px + env(safe-area-inset-bottom, 0px));
      }
    }
  `;

  let _host = null;
  let _shadow = null;
  let _rootEl = null;
  let _ttBackdrop = null;
  let _ttEl = null;
  let _hoverPill = null;
  let _selWrap = null;
  let _selResult = null;
  let _selCardBtn = null;
  let _floatWrap = null;
  let _floatMenu = null;
  let _floatPill = null;

  let _settings = null;
  let _currentMode = 'off';
  let _onSwitchMode = null;
  let _activeWord = null;
  let _renderToken = 0;
  let _activePort = null;
  let _dragState = null;
  let _lastDragEnd = 0;
  let _floatJustDragged = false;
  let _globalListenersBound = false;
  let _selTimer = null;
  let _hoverTimer = null;
  let _capturedSelText = '';
  let _capturedSelContext = '';
  let _lastSelRect = null;
  let _lastAnchorRect = null;

  function isTouchDevice() {
    return typeof window.matchMedia === 'function' &&
      (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches);
  }

  function isMobileSheet() {
    const vp = window.visualViewport;
    const vw = vp ? vp.width : window.innerWidth;
    if (vw <= 640) return true;
    if (!isTouchDevice()) return false;
    const sw = (window.screen && window.screen.width) ? Math.min(window.screen.width, vw) : vw;
    return sw <= 820;
  }

  function getViewportBox() {
    const vp = window.visualViewport;
    if (vp) {
      return { left: vp.offsetLeft, top: vp.offsetTop, width: vp.width, height: vp.height };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function ensureMounted() {
    if (_host && _host.isConnected) return;
    _host = document.createElement('div');
    _host.id = 'ifll-shadow-host';
    _shadow = _host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    _shadow.appendChild(style);

    _rootEl = document.createElement('div');
    _rootEl.className = 'ifll-root';
    _shadow.appendChild(_rootEl);

    // 1. Hover Mini-Preview
    _hoverPill = document.createElement('div');
    _hoverPill.className = 'hover-pill';
    _rootEl.appendChild(_hoverPill);

    // 2. Mobile Backdrop + Tooltip Card
    _ttBackdrop = document.createElement('div');
    _ttBackdrop.className = 'tt-backdrop';
    _ttBackdrop.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTooltip();
    });
    _rootEl.appendChild(_ttBackdrop);

    _ttEl = document.createElement('div');
    _ttEl.className = 'tt-card';
    _rootEl.appendChild(_ttEl);

    // 3. Selection Toolbar (with 词卡 button for short selections!)
    _selWrap = document.createElement('div');
    _selWrap.className = 'sel-wrap';
    _selWrap.innerHTML = `
      <div class="sel-bar">
        <button class="sel-btn" data-sel="translate">翻译</button>
        <button class="sel-btn" data-sel="explain">解释</button>
        <button class="sel-btn" data-sel="card" id="selCardBtn">词卡</button>
        <button class="sel-btn" data-sel="speak">朗读</button>
        <button class="sel-btn" data-sel="copy">复制</button>
      </div>
      <div class="sel-result"></div>
    `;
    _selResult = _selWrap.querySelector('.sel-result');
    _selCardBtn = _selWrap.querySelector('#selCardBtn');
    const selBar = _selWrap.querySelector('.sel-bar');
    selBar.addEventListener('mousedown', (e) => e.preventDefault());
    selBar.addEventListener('click', onSelActionClick);
    _rootEl.appendChild(_selWrap);

    // 4. Floating Mode Capsule (supports vertical thumb-drag on mobile)
    _floatWrap = document.createElement('div');
    _floatWrap.className = 'float-wrap';
    _floatWrap.innerHTML = `
      <div class="float-menu">
        <button class="float-menu-item" data-mode="replace"><span>替换学习</span><span class="float-dot dot-replace"></span></button>
        <button class="float-menu-item" data-mode="annotate"><span>标注学习</span><span class="float-dot dot-annotate"></span></button>
        <button class="float-menu-item" data-mode="translate"><span>对比翻译</span><span class="float-dot dot-translate"></span></button>
        <button class="float-menu-item" data-mode="off"><span>关闭本页</span><span class="float-dot dot-off"></span></button>
        <div class="float-menu-sep"></div>
        <button class="float-menu-item" data-cmd="toggle-trans" style="display:none"><span>显隐译文</span>${ICONS.eye}</button>
        <button class="float-menu-item" data-cmd="dashboard"><span>学习中心</span>${ICONS.book}</button>
      </div>
      <button class="float-pill" type="button" title="IFLL 快捷切换">
        <span class="float-dot dot-off"></span>
        <span class="float-label">IFLL</span>
      </button>
    `;
    _floatMenu = _floatWrap.querySelector('.float-menu');
    _floatPill = _floatWrap.querySelector('.float-pill');

    let pillTouch = null;
    _floatPill.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const rect = _floatWrap.getBoundingClientRect();
      pillTouch = { startY: t.clientY, startBottom: Math.max(12, window.innerHeight - rect.bottom), moved: false };
    }, { passive: true });
    _floatPill.addEventListener('touchmove', (e) => {
      if (!pillTouch || e.touches.length !== 1) return;
      const dy = pillTouch.startY - e.touches[0].clientY;
      if (Math.abs(dy) > 8) pillTouch.moved = true;
      if (pillTouch.moved) {
        e.preventDefault();
        const maxBottom = Math.max(60, window.innerHeight - 90);
        const nextBottom = Math.max(14, Math.min(maxBottom, pillTouch.startBottom + dy));
        _floatWrap.style.bottom = Math.round(nextBottom) + 'px';
      }
    }, { passive: false });
    _floatPill.addEventListener('touchend', () => {
      if (pillTouch?.moved) {
        _floatJustDragged = true;
        setTimeout(() => { _floatJustDragged = false; }, 260);
      }
      pillTouch = null;
    });

    _floatPill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_floatJustDragged) return;
      _floatMenu.classList.toggle('open');
    });
    _floatMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      _floatMenu.classList.remove('open');
      if (btn.dataset.mode) {
        _onSwitchMode?.(btn.dataset.mode);
      } else if (btn.dataset.cmd === 'toggle-trans') {
        IFLL.translateEngine?.toggleVisibility();
      } else if (btn.dataset.cmd === 'dashboard') {
        chrome.runtime.sendMessage({ type: 'IFLL_OPEN_DASHBOARD', tab: 'review' }).catch(() => {});
      }
    });
    _rootEl.appendChild(_floatWrap);

    (document.documentElement || document.body).appendChild(_host);
    applyTheme();
    bindGlobalEvents();
  }

  function applyTheme() {
    if (!_rootEl) return;
    const pref = _settings?.tooltipTheme || 'auto';
    const theme = IFLL.domUtils.detectEffectiveTheme(pref);
    _rootEl.classList.toggle('dark', theme === 'dark');
  }

  function speakText(text, forceLang = null) {
    if (!text || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const lang = forceLang || (IFLL.utils.detectTextLanguage(text) === 'zh' ? 'zh-CN' : 'en-US');
      u.lang = lang;
      u.rate = Number(_settings?.voiceRate) || 0.9;
      u.pitch = 1;
      if (lang.startsWith('en') && _settings?.voiceName) {
        const found = window.speechSynthesis.getVoices().find(v => v.name === _settings.voiceName);
        if (found) u.voice = found;
      }
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  /* ── Hover Mini-Preview (desktop fine pointer only) ── */
  function hideHoverPreview() {
    clearTimeout(_hoverTimer);
    _hoverTimer = null;
    if (_hoverPill) _hoverPill.style.display = 'none';
  }

  function isTooltipOpen() {
    return !!(_ttEl && _ttEl.style.display === 'block');
  }

  function showHoverPreview(data, rect) {
    if (isTouchDevice()) return;
    if (_settings?.enableHoverPreview === false) return;
    if (isTooltipOpen()) return;
    ensureMounted();
    applyTheme();
    const esc = IFLL.utils.escapeHtml;
    const zh = data.zhDisplay || data.zh || '';
    _hoverPill.innerHTML = `<span class="hover-en">${esc(data.en)}</span>${data.ipa ? `<span class="hover-ipa">${esc(data.ipa)}</span>` : ''}${zh ? `<span class="hover-zh">${esc(zh)}</span>` : ''}`;
    _hoverPill.style.display = 'flex';

    const margin = 8;
    const w = _hoverPill.offsetWidth || 180;
    const h = _hoverPill.offsetHeight || 26;
    let left = rect.left + rect.width / 2 - w / 2;
    if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
    if (left < margin) left = margin;
    let top = rect.top - h - 6;
    if (top < margin) top = rect.bottom + 6;
    _hoverPill.style.left = Math.round(left) + 'px';
    _hoverPill.style.top = Math.round(top) + 'px';
  }

  function cancelActiveStream() {
    if (_activePort) {
      try { _activePort.disconnect(); } catch (_) {}
      _activePort = null;
    }
  }

  function positionTooltip(anchorRect) {
    if (!_ttEl || _ttEl.style.display === 'none') return;
    if (anchorRect) _lastAnchorRect = anchorRect;

    if (isMobileSheet()) {
      _ttEl.classList.add('mobile-sheet');
      _ttEl.style.left = '';
      _ttEl.style.top = '';
      _ttEl.style.transform = '';
      if (_ttBackdrop) _ttBackdrop.style.display = 'block';
      return;
    }

    _ttEl.classList.remove('mobile-sheet');
    if (_ttBackdrop) _ttBackdrop.style.display = 'none';

    const rect = anchorRect || _lastAnchorRect;
    if (!rect) return;
    const vp = getViewportBox();
    const margin = 8;
    const ttW = _ttEl.offsetWidth || 330;
    const ttH = _ttEl.offsetHeight || 200;

    let left = rect.left;
    if (left + ttW > vp.left + vp.width - margin) left = vp.left + vp.width - ttW - margin;
    if (left < vp.left + margin) left = vp.left + margin;

    const spaceBelow = vp.top + vp.height - rect.bottom - margin;
    const spaceAbove = rect.top - vp.top - margin;
    let top = (ttH <= spaceBelow || spaceBelow >= spaceAbove) ? rect.bottom + 6 : rect.top - ttH - 6;
    if (top + ttH > vp.top + vp.height - margin) top = vp.top + vp.height - ttH - margin;
    if (top < vp.top + margin) top = vp.top + margin;

    _ttEl.style.left = Math.round(left) + 'px';
    _ttEl.style.top = Math.round(top) + 'px';
  }

  function closeTooltip() {
    cancelActiveStream();
    if (_ttEl) {
      _ttEl.style.display = 'none';
      _ttEl.style.transform = '';
      _ttEl.classList.remove('mobile-sheet');
    }
    if (_ttBackdrop) _ttBackdrop.style.display = 'none';
    _activeWord = null;
  }

  function renderExamplesHtml(examples, examplesCn) {
    if (!examples || !examples.length) return '';
    const esc = IFLL.utils.escapeHtml;
    const bold = IFLL.utils.renderBoldHtml;
    return examples.slice(0, 3).map((ex, i) => {
      const enText = typeof ex === 'string' ? ex : (ex.en || '');
      const cnText = typeof ex === 'string' ? (examplesCn?.[i] || '') : (ex.cn || '');
      if (!enText) return '';
      return `
        <div class="tt-ex-item">
          <div class="tt-ex-en">${esc(enText)}</div>
          ${cnText ? `<div class="tt-ex-cn">${bold(cnText)}</div>` : ''}
          <div class="tt-ex-tools">
            <button class="tt-icon-btn" data-ex-speak="${esc(enText)}" title="朗读例句">${ICONS.speak}</button>
            <button class="tt-icon-btn" data-ex-copy="${esc(enText)}" title="复制例句">${ICONS.copy}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderDeepResultHtml(data, examples, cached, contextMeaning = '') {
    const esc = IFLL.utils.escapeHtml;
    let body = '';
    if (contextMeaning) {
      body += `<div class="tt-context-meaning">本句语境：${esc(contextMeaning)}</div>`;
    }
    if (Array.isArray(data?.synonyms) && data.synonyms.length) {
      body += `<div class="tt-deep-row"><span class="tt-deep-tag">同义</span>${esc(data.synonyms.join(', '))}</div>`;
    }
    if (Array.isArray(data?.antonyms) && data.antonyms.length) {
      body += `<div class="tt-deep-row"><span class="tt-deep-tag">反义</span>${esc(data.antonyms.join(', '))}</div>`;
    }
    if (Array.isArray(data?.collocations) && data.collocations.length) {
      body += `<div class="tt-deep-row"><span class="tt-deep-tag">搭配</span>${esc(data.collocations.join(' · '))}</div>`;
    }
    if (data?.usage) {
      body += `<div class="tt-deep-usage">${esc(data.usage)}</div>`;
    }
    const exList = Array.isArray(examples) && examples.length ? examples : (data?.examples || []);
    if (exList.length) {
      body += `<div class="tt-divider"></div><div class="tt-section-head"><span class="tt-label">AI 例句</span></div>` + renderExamplesHtml(exList);
    }
    if (!body) body = `<div class="tt-deep-usage">暂无更多解析数据</div>`;

    return `
      <div class="tt-section-head">
        <span class="tt-label">AI 深度解析 ${cached ? '<span class="tt-cached-tag">· 已缓存</span>' : ''}</span>
        <button class="tt-icon-btn" data-action="regen-deep" title="结合本句重新生成">${ICONS.regen}</button>
      </div>
      <div class="tt-deep-box">${body}</div>
    `;
  }

  async function showWordCard(wordData, anchorRect, { autoAnalyze = false } = {}) {
    ensureMounted();
    hideHoverPreview();
    applyTheme();
    cancelActiveStream();

    const token = ++_renderToken;
    let examples = [];
    let examplesCn = [];
    try { examples = typeof wordData.examples === 'string' ? JSON.parse(wordData.examples) : (wordData.examples || []); } catch (_) {}
    try { examplesCn = typeof wordData.examplesCn === 'string' ? JSON.parse(wordData.examplesCn) : (wordData.examplesCn || []); } catch (_) {}

    _activeWord = {
      en: wordData.en || '',
      surface: wordData.surface || '',
      zh: wordData.zh || wordData.en || '',
      zhDisplay: wordData.zhDisplay || wordData.zh || '',
      def: wordData.def || '',
      pos: wordData.pos || 'noun',
      posCn: wordData.posCn || '名词',
      ipa: wordData.ipa || '',
      level: wordData.level || '',
      context: wordData.context || '',
      sourceUrl: window.location.href,
      sourceTitle: document.title || window.location.hostname,
      examples,
      examplesCn
    };

    chrome.runtime.sendMessage({ type: 'IFLL_TRACK_STAT', stat: 'click', count: 1 }).catch(() => {});

    const [latestSettings, cachedAi] = await Promise.all([
      IFLL.storage.get(),
      IFLL.storage.getAiCacheEntry(_activeWord.en)
    ]);
    if (token !== _renderToken) return;
    _settings = latestSettings;

    const w = _activeWord;
    const esc = IFLL.utils.escapeHtml;
    const inReview = (latestSettings.reviewQueue || []).some(r => r.zh === w.zh || r.en.toLowerCase() === w.en.toLowerCase());
    const isKnown = (latestSettings.knownWords || []).includes(w.zh);
    const levelLabel = IFLL.constants.LEVEL_LABELS[w.level] || w.level || '';
    const customActions = latestSettings.customActions || [];

    let html = `
      <div class="tt-handle"><span class="tt-handle-bar"></span><button class="tt-close" data-action="close" title="关闭 (Esc)">${ICONS.close}</button></div>
      <div class="tt-head">
        <div class="tt-word-wrap">
          <span class="tt-en">${esc(w.en)}</span>
          <button class="tt-icon-btn" data-action="speak" title="朗读发音">${ICONS.speak}</button>
        </div>
        ${levelLabel ? `<span class="tt-badge">${esc(levelLabel)}</span>` : ''}
      </div>
      <div class="tt-meta">
        ${w.zhDisplay ? `<span class="tt-zh">${esc(w.zhDisplay)}</span>` : ''}
        ${w.ipa ? `<span>·</span><span class="tt-ipa">${esc(w.ipa)}</span>` : ''}
        <span>·</span><span class="tt-pos">${esc(IFLL.utils.posLabel(w.pos))}</span><span>${esc(w.posCn)}</span>
        ${w.surface && w.surface.toLowerCase() !== w.en.toLowerCase() ? `<span class="tt-surface">(${esc(w.surface)})</span>` : ''}
      </div>
      ${w.def ? `<div class="tt-def">${esc(w.def)}</div>` : ''}
      ${w.context ? `<div class="tt-context" title="当前网页语境">“${esc(w.context)}”</div>` : ''}
    `;

    if (w.examples.length) {
      html += `<div class="tt-divider"></div><div class="tt-section-head"><span class="tt-label">内置例句</span></div>` + renderExamplesHtml(w.examples, w.examplesCn);
    }

    html += `<div class="tt-divider"></div><div id="deep-section">`;
    if (cachedAi?.deep && !autoAnalyze) {
      html += renderDeepResultHtml(cachedAi.deep, cachedAi.examples, true);
    } else {
      html += `
        <div class="tt-section-head"><span class="tt-label">AI 解析</span></div>
        <div class="tt-deep-box">
          <button class="tt-btn tt-btn-accent" data-action="deep-analyze" style="width:100%">${w.context ? 'AI 结合本句深度解析' : 'AI 深度解析与例句'}</button>
        </div>
      `;
    }
    html += `</div>`;

    if (customActions.length) {
      html += `<div class="tt-divider"></div><div class="tt-section-head"><span class="tt-label">自定义动作</span></div><div class="tt-actions" id="custom-section">`;
      for (const act of customActions) {
        html += `<button class="tt-btn" data-custom-id="${esc(act.id)}">${esc(act.name)}</button>`;
      }
      html += `</div><div class="tt-deep-box" id="custom-result" style="display:none"></div>`;
    }

    html += `
      <div class="tt-divider"></div>
      <div class="tt-actions">
        <button class="tt-btn tt-btn-known" data-action="known" ${isKnown ? 'disabled' : ''}>${isKnown ? '✓ 已掌握' : '✓ 认识'}</button>
        <button class="tt-btn" data-action="unknown">✗ 加入复习</button>
        <button class="tt-btn" data-action="add-word">+ 生词本</button>
      </div>
      <div class="tt-actions tt-actions-tight">
        <button class="tt-btn tt-btn-danger" data-action="exclude-site">排除此站</button>
        <button class="tt-btn" data-action="open-dashboard">打开复习中心</button>
      </div>
    `;

    if (inReview) {
      html += `
        <div class="tt-divider"></div>
        <div class="tt-section-head"><span class="tt-label">间隔重复评分</span></div>
        <div class="tt-actions" id="review-section">
          <button class="tt-btn tt-r1" data-review="1">忘记</button>
          <button class="tt-btn tt-r2" data-review="2">模糊</button>
          <button class="tt-btn tt-r3" data-review="3">正确</button>
          <button class="tt-btn tt-r4" data-review="4">轻松</button>
        </div>
      `;
    }

    _ttEl.innerHTML = html;
    _ttEl.style.display = 'block';
    positionTooltip(anchorRect);
    bindTooltipEvents(token);

    if (autoAnalyze) {
      runDeepAnalysis(token, false);
    }
  }

  function runDeepAnalysis(token, force = false) {
    if (!_activeWord || token !== _renderToken) return;
    cancelActiveStream();

    const w = _activeWord;
    const section = _ttEl.querySelector('#deep-section');
    if (!section) return;

    section.innerHTML = `
      <div class="tt-section-head">
        <span class="tt-label">AI 解析中…</span>
        <button class="tt-icon-btn spinning" disabled>${ICONS.regen}</button>
      </div>
      <div class="tt-deep-box"><div class="tt-stream" id="stream-box">连接模型…<span class="tt-cursor">▌</span></div></div>
    `;
    positionTooltip();

    let port;
    try {
      port = chrome.runtime.connect({ name: 'ifll-stream' });
      _activePort = port;
    } catch (_) {
      renderDeepError(section, token, '无法连接后台服务，请刷新页面重试');
      return;
    }

    let accum = '';
    port.onMessage.addListener((msg) => {
      if (token !== _renderToken) {
        cancelActiveStream();
        return;
      }
      if (msg.chunk) {
        accum += msg.chunk;
        const box = _ttEl.querySelector('#stream-box');
        if (box) {
          box.classList.toggle('reasoning', !!msg.reasoning);
          const tail = accum.length > 260 ? '…' + accum.slice(-260) : accum;
          box.innerHTML = IFLL.utils.escapeHtml(tail) + '<span class="tt-cursor">▌</span>';
          box.scrollTop = box.scrollHeight;
        }
      } else if (msg.done) {
        _activePort = null;
        try { port.disconnect(); } catch (_) {}
        section.innerHTML = renderDeepResultHtml(msg.data, msg.examples, !!msg.cached, msg.contextMeaning || '');
        positionTooltip();
      } else if (msg.error) {
        _activePort = null;
        try { port.disconnect(); } catch (_) {}
        renderDeepError(section, token, msg.error);
      }
    });

    port.onDisconnect.addListener(() => {
      if (_activePort === port) _activePort = null;
    });

    port.postMessage({
      type: 'IFLL_AI_COMBINED',
      en: w.en,
      zh: w.zh,
      def: w.def,
      context: w.context || '',
      force
    });
  }

  function renderDeepError(section, token, errorMsg) {
    if (token !== _renderToken) return;
    section.innerHTML = `
      <div class="tt-section-head">
        <span class="tt-label">AI 解析</span>
        <button class="tt-icon-btn" data-action="regen-deep" title="重试">${ICONS.regen}</button>
      </div>
      <div class="tt-deep-box">
        <div class="tt-err">${IFLL.utils.escapeHtml(errorMsg)}</div>
        <button class="tt-btn tt-btn-accent" data-action="deep-analyze" style="width:100%">重试解析</button>
      </div>
    `;
    positionTooltip();
  }

  function bindTooltipEvents(token) {
    const handle = _ttEl.querySelector('.tt-handle');
    if (handle) {
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button') || _ttEl.classList.contains('mobile-sheet')) return;
        _dragState = { offX: e.clientX - _ttEl.offsetLeft, offY: e.clientY - _ttEl.offsetTop };
        e.preventDefault();
      });

      let sheetStartY = null;
      let sheetDy = 0;
      handle.addEventListener('touchstart', (e) => {
        if (e.target.closest('button') || !_ttEl.classList.contains('mobile-sheet') || e.touches.length !== 1) return;
        sheetStartY = e.touches[0].clientY;
        sheetDy = 0;
        _ttEl.style.transition = 'none';
      }, { passive: true });
      handle.addEventListener('touchmove', (e) => {
        if (sheetStartY === null || e.touches.length !== 1) return;
        sheetDy = Math.max(0, e.touches[0].clientY - sheetStartY);
        if (sheetDy > 0) {
          e.preventDefault();
          _ttEl.style.transform = `translateY(${Math.round(sheetDy)}px)`;
        }
      }, { passive: false });
      handle.addEventListener('touchend', () => {
        if (sheetStartY === null) return;
        sheetStartY = null;
        _ttEl.style.transition = '';
        if (sheetDy > 64) {
          closeTooltip();
        } else {
          _ttEl.style.transform = '';
        }
        sheetDy = 0;
      });
    }

    _ttEl.onclick = async (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled || !_activeWord) return;
      const w = _activeWord;

      if (btn.dataset.exSpeak) { speakText(btn.dataset.exSpeak, 'en-US'); return; }
      if (btn.dataset.exCopy) {
        const ok = await IFLL.utils.copyText(btn.dataset.exCopy);
        btn.innerHTML = ok ? ICONS.check : ICONS.close;
        setTimeout(() => { btn.innerHTML = ICONS.copy; }, 1400);
        return;
      }
      if (btn.dataset.review) {
        await IFLL.storage.scoreReview(w.zh, parseInt(btn.dataset.review, 10));
        const box = _ttEl.querySelector('#review-section');
        if (box) box.innerHTML = '<span style="font-size:12px;color:var(--text-dim);padding:4px 0">复习进度已更新</span>';
        return;
      }
      if (btn.dataset.customId) {
        const act = (_settings?.customActions || []).find(a => a.id === btn.dataset.customId);
        if (!act) return;
        const orig = btn.textContent;
        btn.textContent = '请求中…';
        btn.disabled = true;
        const res = await chrome.runtime.sendMessage({
          type: 'IFLL_CUSTOM_ACTION',
          action: { prompt: act.prompt, fields: act.fields },
          en: w.en, zh: w.zh, def: w.def, context: w.context || ''
        }).catch(() => ({ error: '请求失败' }));
        btn.textContent = orig;
        btn.disabled = false;
        const out = _ttEl.querySelector('#custom-result');
        if (out) {
          out.style.display = 'block';
          if (res?.error) {
            out.innerHTML = `<div class="tt-err">${IFLL.utils.escapeHtml(res.error)}</div>`;
          } else {
            const data = res?.result || {};
            let h = '';
            if (data.text) h += `<div class="tt-deep-usage">${IFLL.utils.escapeHtml(data.text)}</div>`;
            for (const [k, v] of Object.entries(data)) {
              if (k === 'text') continue;
              if (Array.isArray(v) && v.length) {
                h += `<div class="tt-deep-row"><span class="tt-deep-tag">${IFLL.utils.escapeHtml(k)}</span>${IFLL.utils.escapeHtml(v.join(', '))}</div>`;
              } else if (typeof v === 'string' && v) {
                h += `<div class="tt-deep-row"><span class="tt-deep-tag">${IFLL.utils.escapeHtml(k)}</span>${IFLL.utils.escapeHtml(v)}</div>`;
              }
            }
            out.innerHTML = h || '<div class="tt-deep-usage">无结果</div>';
          }
          positionTooltip();
        }
        return;
      }

      switch (btn.dataset.action) {
        case 'close':
          closeTooltip();
          break;
        case 'speak':
          speakText(w.en, 'en-US');
          break;
        case 'deep-analyze':
          runDeepAnalysis(token, false);
          break;
        case 'regen-deep':
          await IFLL.storage.clearAiCache(w.en);
          runDeepAnalysis(token, true);
          break;
        case 'known':
          await IFLL.storage.markKnown(w.zh);
          btn.textContent = '✓ 已掌握';
          btn.disabled = true;
          IFLL.replaceEngine?.markWordKnownInDom(w.zh);
          IFLL.annotateEngine?.markWordKnown(w.zh);
          break;
        case 'unknown':
          await IFLL.storage.addToReview(w.zh, w.en, {
            def: w.def, ipa: w.ipa, pos: w.pos, pos_cn: w.posCn,
            context: w.context, sourceUrl: w.sourceUrl, sourceTitle: w.sourceTitle,
            examples: w.examples, examplesCn: w.examplesCn
          });
          btn.textContent = '✓ 已入复习';
          btn.disabled = true;
          break;
        case 'add-word': {
          const added = await IFLL.storage.addUserWord({
            zh: w.zh, en: w.en, def: w.def, ipa: w.ipa,
            pos: w.pos, pos_cn: w.posCn, level: _settings?.level || 'cet4',
            examples: w.examples, examplesCn: w.examplesCn
          });
          btn.textContent = added ? '✓ 已收藏' : '已在词库';
          btn.disabled = true;
          break;
        }
        case 'exclude-site': {
          const h = window.location.hostname;
          const s = await IFLL.storage.get();
          const sites = [...(s.excludedSites || [])];
          if (!sites.includes(h)) {
            sites.push(h);
            await IFLL.storage.set({ excludedSites: sites });
          }
          closeTooltip();
          _onSwitchMode?.('off', true);
          showToast(`已排除 ${h}`, 'info');
          break;
        }
        case 'open-dashboard':
          chrome.runtime.sendMessage({ type: 'IFLL_OPEN_DASHBOARD', tab: 'review' }).catch(() => {});
          break;
      }
    };
  }

  /* ── Open Full Word Card directly for ANY selected word/phrase ── */
  async function openCardForSelection(rawText, anchorRect, contextSentence = '') {
    const clean = String(rawText || '').trim();
    if (!clean) return;
    const rect = anchorRect || { left: window.innerWidth / 2 - 165, top: 80, right: window.innerWidth / 2, bottom: 100, width: 100, height: 20 };

    let entry = null;
    try {
      const wb = await IFLL.storage.loadWordBank();
      const s = await IFLL.storage.get();
      const lang = IFLL.utils.detectTextLanguage(clean);
      if (lang === 'zh') {
        const zhMap = IFLL.storage.buildFullZhMap(wb.zhMap, s.userWords || []);
        entry = zhMap.get(clean) || null;
      } else {
        const enMap = IFLL.storage.buildFullEnMap(wb.enMap, s.userWords || []);
        const hit = IFLL.matcher.lookupEnglishLemma(clean, enMap);
        entry = hit?.entry || enMap.get(clean.toLowerCase()) || null;
      }
    } catch (_) {}

    if (entry) {
      await showWordCard({
        en: entry.en,
        surface: clean,
        zh: entry.zh,
        zhDisplay: entry.zhDisplay || entry.zh,
        def: entry.def || '',
        pos: entry.pos || 'noun',
        posCn: entry.pos_cn || '名词',
        ipa: entry.ipa || '',
        level: entry.level || '',
        context: contextSentence,
        examples: entry.examples || [],
        examplesCn: entry.examplesCn || []
      }, rect);
      return;
    }

    // Word/phrase not in local bank -> quick translate + open card with AI analysis ready!
    const lang = IFLL.utils.detectTextLanguage(clean);
    let quickTrans = '';
    const tx = await chrome.runtime.sendMessage({ type: 'IFLL_AI_TRANSLATE', text: clean }).catch(() => null);
    if (tx?.success && tx.translation) quickTrans = tx.translation;

    const en = lang === 'zh' ? (quickTrans || clean) : clean;
    const zh = lang === 'zh' ? clean : (quickTrans || clean);

    await showWordCard({
      en,
      surface: clean,
      zh,
      zhDisplay: zh,
      def: '',
      pos: en.includes(' ') ? 'phrase' : 'noun',
      posCn: en.includes(' ') ? '短语' : '词汇',
      ipa: '',
      level: '',
      context: contextSentence,
      examples: [],
      examplesCn: []
    }, rect, { autoAnalyze: false });
  }

  /* ── Selection Toolbar Logic ── */
  function hideSelToolbar() {
    if (_selWrap) {
      _selWrap.style.display = 'none';
      _selResult.style.display = 'none';
      _selResult.innerHTML = '';
    }
  }

  function positionSelToolbar(rect) {
    if (!_selWrap || _selWrap.style.display === 'none' || !rect) return;
    const vp = getViewportBox();
    const margin = 8;
    const w = _selWrap.offsetWidth || 240;
    const h = _selWrap.offsetHeight || 40;
    let left = rect.left + (rect.width / 2) - (w / 2);
    if (left + w > vp.left + vp.width - margin) left = vp.left + vp.width - w - margin;
    if (left < vp.left + margin) left = vp.left + margin;

    let top;
    if (isTouchDevice()) {
      // Android/iOS native Copy/Share bar opens ABOVE the selection -> place ours BELOW to avoid overlap
      top = rect.bottom + 14;
      if (top + h > vp.top + vp.height - margin) {
        top = Math.max(vp.top + margin, vp.top + vp.height - h - margin);
      }
    } else {
      top = rect.top - h - 8;
      if (top < vp.top + margin) top = rect.bottom + 8;
      if (top + h > vp.top + vp.height - margin) top = vp.top + vp.height - h - margin;
    }

    _selWrap.style.left = Math.round(left) + 'px';
    _selWrap.style.top = Math.round(top) + 'px';
  }

  async function runSelectionResult(action, text, anchorRect) {
    ensureMounted();
    applyTheme();
    _capturedSelText = text;
    _lastSelRect = anchorRect || { left: window.innerWidth / 2 - 120, top: 80, right: window.innerWidth / 2, bottom: 100, width: 120, height: 24 };
    _selWrap.style.display = 'flex';
    _selResult.style.display = 'block';
    _selResult.textContent = '请求中…';
    positionSelToolbar(_lastSelRect);

    const res = await chrome.runtime.sendMessage({ type: 'IFLL_SEL_TOOLBAR', action, text }).catch(() => ({ error: '请求失败' }));
    if (res?.text) {
      const esc = IFLL.utils.escapeHtml;
      const lang = IFLL.utils.detectTextLanguage(text);
      const canSaveWord = text.length <= 45 && text.split(/\s+/).length <= 5;
      _selResult.innerHTML = `
        <div>${esc(res.text)}</div>
        <div class="sel-result-foot">
          <button class="sel-foot-btn" data-res="copy">复制结果</button>
          <button class="sel-foot-btn" data-res="speak">朗读</button>
          ${canSaveWord ? '<button class="sel-foot-btn" data-res="save">加入复习</button>' : ''}
          <button class="sel-foot-btn" data-res="close">关闭</button>
        </div>
      `;
      _selResult.onclick = async (ev) => {
        const fb = ev.target.closest('button');
        if (!fb) return;
        if (fb.dataset.res === 'copy') {
          await IFLL.utils.copyText(res.text);
          fb.textContent = '已复制';
        } else if (fb.dataset.res === 'speak') {
          speakText(res.text);
        } else if (fb.dataset.res === 'save') {
          const zh = lang === 'zh' ? text : res.text.slice(0, 30);
          const en = lang === 'en' ? text : res.text.slice(0, 45);
          await IFLL.storage.addToReview(zh, en, {
            def: res.text,
            context: _capturedSelContext,
            sourceUrl: window.location.href,
            sourceTitle: document.title || window.location.hostname
          });
          fb.textContent = '已加入';
          fb.disabled = true;
        } else if (fb.dataset.res === 'close') {
          hideSelToolbar();
        }
      };
    } else {
      _selResult.innerHTML = `<div class="tt-err">${IFLL.utils.escapeHtml(res?.error || '请求失败')}</div>`;
    }
    positionSelToolbar(_lastSelRect);
  }

  async function onSelActionClick(e) {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.sel;
    const text = _capturedSelText;
    if (!text) return;

    if (action === 'copy') {
      const ok = await IFLL.utils.copyText(text);
      const orig = btn.textContent;
      btn.textContent = ok ? '已复制' : '失败';
      setTimeout(() => { btn.textContent = orig; }, 1200);
      return;
    }
    if (action === 'speak') { speakText(text); return; }
    if (action === 'card') {
      hideSelToolbar();
      await openCardForSelection(text, _lastSelRect, _capturedSelContext);
      return;
    }

    const origLabel = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    try {
      await runSelectionResult(action, text, _lastSelRect);
    } finally {
      btn.textContent = origLabel;
      btn.disabled = false;
    }
  }

  /* ── Right-Click Context Menu Dispatcher ── */
  async function handleContextAction(action, text) {
    if (!text) return;
    const sel = window.getSelection();
    let rect = null;
    let ctxSentence = '';
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
      ctxSentence = IFLL.domUtils.extractContextSentence(range.startContainer, text);
    }
    _capturedSelContext = ctxSentence;
    if (action === 'card') {
      await openCardForSelection(text, rect, ctxSentence);
    } else if (action === 'translate') {
      await runSelectionResult('translate', text, rect);
    } else if (action === 'review') {
      const lang = IFLL.utils.detectTextLanguage(text);
      const tx = await chrome.runtime.sendMessage({ type: 'IFLL_AI_TRANSLATE', text }).catch(() => null);
      const tr = tx?.translation || '';
      const en = lang === 'zh' ? (tr || text) : text;
      const zh = lang === 'zh' ? text : (tr || text);
      await IFLL.storage.addToReview(zh, en, {
        def: tr, context: ctxSentence,
        sourceUrl: window.location.href, sourceTitle: document.title || window.location.hostname
      });
      showToast(`已将「${en}」加入复习队列`, 'info', 2500);
    }
  }

  /* ── Floating Capsule Control ── */
  function updateFloatCapsule(mode, visible = true) {
    ensureMounted();
    _currentMode = mode;
    if (!_floatWrap) return;
    const show = visible && _settings?.showFloatBall !== false;
    _floatWrap.style.display = show ? 'flex' : 'none';
    if (!show) return;

    const shortLabel = { replace: '替换', annotate: '标注', translate: '翻译', off: '关' }[mode] || 'IFLL';
    _floatPill.querySelector('.float-dot').className = 'float-dot dot-' + mode;
    _floatPill.querySelector('.float-label').textContent = shortLabel;

    _floatMenu.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const toggleTransBtn = _floatMenu.querySelector('[data-cmd="toggle-trans"]');
    if (toggleTransBtn) toggleTransBtn.style.display = mode === 'translate' ? 'flex' : 'none';
  }

  function showWelcomePrompt(hostname, defaultSuggestedMode) {
    ensureMounted();
    applyTheme();
    return new Promise((resolve) => {
      const bar = document.createElement('div');
      bar.className = 'prompt-bar';
      bar.innerHTML = `
        <span class="prompt-title">IFLL · 选择当前页面学习模式</span>
        <div class="prompt-actions">
          <button class="prompt-btn ${defaultSuggestedMode === 'replace' ? 'primary' : ''}" data-m="replace">替换</button>
          <button class="prompt-btn ${defaultSuggestedMode === 'annotate' ? 'primary' : ''}" data-m="annotate">标注</button>
          <button class="prompt-btn" data-m="translate">翻译</button>
          <button class="prompt-btn" data-m="off">暂不</button>
        </div>
      `;
      _rootEl.appendChild(bar);
      let done = false;
      const finish = (m) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        bar.remove();
        resolve(m);
      };
      const timer = setTimeout(() => finish('off'), 7000);
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b?.dataset.m) finish(b.dataset.m);
      });
    });
  }

  function showToast(message, kind = 'info', duration = 3500, { actionLabel, onAction } = {}) {
    ensureMounted();
    applyTheme();
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    el.appendChild(textSpan);
    if (actionLabel && typeof onAction === 'function') {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = actionLabel;
      btn.addEventListener('click', () => {
        onAction();
        el.remove();
      });
      el.appendChild(btn);
    }
    _rootEl.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  /* ── Global Document Listeners ── */
  function isInsideShadowHost(e) {
    const path = e.composedPath?.() || [];
    return path.includes(_host);
  }

  function findInteractiveTarget(e) {
    const t = e.target;
    if (t && t.nodeType === Node.ELEMENT_NODE) {
      const span = t.closest?.('.ifll-word, .ifll-annotated');
      if (span) {
        const ctx = IFLL.domUtils.extractContextSentence(span, span.dataset.en || span.dataset.zh || '');
        return { span, data: { ...span.dataset, context: ctx }, rect: span.getBoundingClientRect() };
      }
    }
    const hit = IFLL.annotateEngine?.findHitAtPoint(e.clientX, e.clientY);
    if (hit) {
      const rects = hit.range.getClientRects();
      const rect = rects[0] || { left: e.clientX - 8, top: e.clientY - 8, right: e.clientX + 8, bottom: e.clientY + 8, width: 16, height: 16 };
      const ctx = IFLL.domUtils.extractContextSentence(hit.range.startContainer, hit.data.surface || hit.data.en || '');
      return { span: null, hit, data: { ...hit.data, context: ctx }, rect };
    }
    return null;
  }

  function bindGlobalEvents() {
    if (_globalListenersBound) return;
    _globalListenersBound = true;

    // Drag move/up + Hover Mini-Preview (desktop fine pointer only)
    let lastHoverTarget = null;
    document.addEventListener('mousemove', (e) => {
      if (_dragState && _ttEl) {
        const x = Math.max(4, Math.min(e.clientX - _dragState.offX, window.innerWidth - _ttEl.offsetWidth - 4));
        const y = Math.max(4, Math.min(e.clientY - _dragState.offY, window.innerHeight - _ttEl.offsetHeight - 4));
        _ttEl.style.left = Math.round(x) + 'px';
        _ttEl.style.top = Math.round(y) + 'px';
        return;
      }

      if (isTouchDevice()) return;
      if (_settings?.enableHoverPreview === false) return;
      if (isTooltipOpen()) { hideHoverPreview(); return; }
      if (isInsideShadowHost(e)) return;

      const t = e.target;
      const span = t?.nodeType === 1 ? t.closest?.('.ifll-word, .ifll-annotated') : null;
      const hlHit = !span ? IFLL.annotateEngine?.findHitAtPoint(e.clientX, e.clientY) : null;
      const key = span || hlHit || null;

      if (key === lastHoverTarget) return;
      lastHoverTarget = key;
      hideHoverPreview();

      if (span) {
        _hoverTimer = setTimeout(() => {
          if (lastHoverTarget === span && span.isConnected) {
            showHoverPreview(span.dataset, span.getBoundingClientRect());
          }
        }, 260);
      } else if (hlHit) {
        _hoverTimer = setTimeout(() => {
          if (lastHoverTarget === hlHit && hlHit.range.startContainer?.isConnected) {
            const r = hlHit.range.getClientRects()[0];
            if (r) showHoverPreview(hlHit.data, r);
          }
        }, 260);
      }
    }, { passive: true });

    document.addEventListener('mouseup', () => {
      if (_dragState) {
        _dragState = null;
        _lastDragEnd = Date.now();
      }
    });

    document.addEventListener('mousedown', (e) => {
      hideHoverPreview();
      if (isInsideShadowHost(e)) return;
      if (_floatMenu?.classList.contains('open')) _floatMenu.classList.remove('open');
      if (_selWrap?.style.display === 'flex') hideSelToolbar();

      const target = findInteractiveTarget(e);
      if (target && (target.span?.closest('a') || (target.hit && target.hit.range.startContainer.parentElement?.closest('a')))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    document.addEventListener('touchstart', (e) => {
      hideHoverPreview();
      if (isInsideShadowHost(e)) return;
      if (_floatMenu?.classList.contains('open')) _floatMenu.classList.remove('open');
      if (_selWrap?.style.display === 'flex') hideSelToolbar();
    }, { capture: true, passive: true });

    document.addEventListener('click', (e) => {
      if (isInsideShadowHost(e)) return;
      if (Date.now() - _lastDragEnd < 250) return;

      const target = findInteractiveTarget(e);
      if (target) {
        const insideLink = target.span?.closest('a') || (target.hit && target.hit.range.startContainer.parentElement?.closest('a'));
        if (insideLink) {
          e.preventDefault();
          e.stopPropagation();
        }
        showWordCard(target.data, target.rect);
        return;
      }

      if (isTooltipOpen()) {
        closeTooltip();
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeTooltip();
        hideSelToolbar();
        hideHoverPreview();
        _floatMenu?.classList.remove('open');
      }
    });

    function scheduleSelectionCheck(delayMs) {
      if (!_settings?.enabled || _settings?.enableSelToolbar === false) return;
      if (IFLL.utils.isExcludedHost(window.location.hostname, _settings.excludedSites)) return;
      if (isTooltipOpen()) return;

      clearTimeout(_selTimer);
      _selTimer = setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (!text || text.length < 2 || text.length > 600 || !sel.rangeCount) {
          hideSelToolbar();
          return;
        }
        const range = sel.getRangeAt(0);
        const anchorEl = range.startContainer?.nodeType === 1 ? range.startContainer : range.startContainer?.parentElement;
        if (anchorEl?.closest?.('#ifll-shadow-host, input, textarea, [contenteditable="true"], [contenteditable=""]')) {
          return;
        }
        const rect = range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return;
        _capturedSelText = text;
        _capturedSelContext = IFLL.domUtils.extractContextSentence(range.startContainer, text);
        _lastSelRect = rect;
        ensureMounted();
        applyTheme();
        const isShortLookup = text.length <= 36 && text.split(/\s+/).length <= 4;
        if (_selCardBtn) _selCardBtn.style.display = isShortLookup ? 'inline-block' : 'none';
        _selResult.style.display = 'none';
        _selResult.innerHTML = '';
        _selWrap.style.display = 'flex';
        positionSelToolbar(rect);
      }, delayMs);
    }

    document.addEventListener('mouseup', (e) => {
      if (isInsideShadowHost(e)) return;
      if (e.target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
      scheduleSelectionCheck(240);
    });

    // Mobile long-press / drag-handle text selection support (Firefox Android / touchscreens)
    document.addEventListener('selectionchange', () => {
      if (!isTouchDevice()) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text) {
        clearTimeout(_selTimer);
        if (_selWrap?.style.display === 'flex' && _selResult?.style.display !== 'block') {
          hideSelToolbar();
        }
        return;
      }
      scheduleSelectionCheck(380);
    });

    document.addEventListener('touchend', (e) => {
      if (!isTouchDevice()) return;
      if (isInsideShadowHost(e)) return;
      if (e.target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length >= 2) {
        scheduleSelectionCheck(260);
      }
    }, { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (isTooltipOpen()) positionTooltip();
        if (_selWrap?.style.display === 'flex' && _lastSelRect) positionSelToolbar(_lastSelRect);
      });
    }
  }

  function configure(settings, onSwitchMode) {
    _settings = settings;
    if (onSwitchMode) _onSwitchMode = onSwitchMode;
    if (_rootEl) applyTheme();
  }

  function destroyUi() {
    closeTooltip();
    hideSelToolbar();
    hideHoverPreview();
    if (_floatWrap) _floatWrap.style.display = 'none';
  }

  const shadowUI = {
    ensureMounted,
    configure,
    applyTheme,
    showWordCard,
    openCardForSelection,
    handleContextAction,
    closeTooltip,
    updateFloatCapsule,
    showWelcomePrompt,
    showToast,
    speakText,
    destroyUi
  };

  IFLL.shadowUI = shadowUI;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = shadowUI;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
