# IFLL — Immersive Foreign Language Learning & Bilingual Translator

A Manifest V3 browser extension (Chrome / Edge / Firefox) for immersive English learning and bilingual web translation — zero build tools, local-first privacy, modular Vanilla JS.

[中文文档](README.md) | English

## Features

- **Smart Replace Mode (Chinese pages)**: Native `Intl.Segmenter` word-boundary segmentation + collocation phrase priority + SM-2 due & daily word boosting, supporting both **inline swap** and **bilingual (`学习(study)`)** styles, 260ms hover mini-preview, and 100% lossless restoration.
- **Lemmatized Annotate Mode (English pages)**: Built-in English lemmatizer (irregular forms + suffixes), zero-DOM-mutation CSS Custom Highlight API, viewport-lazy `IntersectionObserver` loading, SPA route-change awareness, and level-aware filtering.
- **Micro-Batched Bilingual Translation**: Viewport-triggered paragraph & heading translation that bundles up to 4 blocks per LLM call with `document.title` context (cutting input tokens by 60%+), persistent IndexedDB cross-tab cache, show/hide toggle, and optional **zero-key free fallback**.
- **Input Box Quick Translation (Read + Write Loop)**: Press `Space × 3` rapidly or `Alt + Y` inside any Chinese text input/textarea to replace with natural English + 1-click Undo.
- **Shadow DOM Isolated UI + Context Menus**: Word card with real webpage **context sentence & contextual AI meaning**, direct Selection Word Card lookup, floating mode capsule, and right-click context menu shortcuts.
- **Learning Center Dashboard**: Light & Dark theme, **30-day learning heatmap & streak tracking**, **3 active recall modes** (Flashcard / Listening-Spelling / Context Cloze), bulk vocabulary import (TXT/CSV/TSV), 1-click **Anki TSV export**, toolbar due-review badge, and `chrome.alarms`-resumable Service Worker batch pre-processing.
- **Cleaned Lazy-Loaded Wordbank**: 5,649 verified bilingual entries across Daily / CET-4 / CET-6 / IELTS / Graduate tiers with repaired IPA schwa transcriptions, loaded on demand from `src/data/wordbank.json`.

## Installation

1. Clone or download this repository.
2. **Chrome / Edge**: open `chrome://extensions` → enable **Developer mode** → click **Load unpacked** → select the **repository root folder** (where `manifest.json` lives).
3. **Firefox 125+**: open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `manifest.json`.

### Keyboard Shortcuts

- `Alt + T`: Toggle bilingual translation / hide-show translated blocks
- `Alt + M`: Cycle learning mode (Replace / Annotate / Translate / Off)
- `Alt + Y` or `Space × 3` in text inputs: Translate typed Chinese into English with 1-click Undo
- `Esc`: Dismiss word card or selection toolbar

## Testing & Verification

```bash
./prepush-check.sh       # Syntax checks + manifest checks + 25 unit/integrity tests
python3 tests/e2e.py     # Real Chromium MV3 end-to-end verification (Playwright)
```

## License

GPL v3. See [LICENSE](LICENSE). All user data and API credentials stay on your device.
