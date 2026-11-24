import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/shared/constants.js');
require('../src/shared/utils.js');
const storage = require('../src/shared/storage.js');
require('../src/content/matcher.js');
const replaceEngine = require('../src/content/engine-replace.js');

/* Minimal DOM mock sufficient to verify exact text ordering & lossless restoration */
class MockNode {
  constructor(nodeType, text = '') {
    this.nodeType = nodeType;
    this._text = text;
    this.parentNode = null;
    this.childNodes = [];
    this.dataset = {};
    this.className = '';
  }
  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map(c => c.textContent).join('');
  }
  set textContent(v) {
    const str = String(v);
    if (this.nodeType === 3) {
      this._text = str;
    } else {
      this.childNodes = [];
      if (str) this.appendChild(new MockNode(3, str));
    }
  }
  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  replaceChild(newChild, oldChild) {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx < 0) throw new Error('oldChild not found');
    oldChild.parentNode = null;
    newChild.parentNode = this;
    this.childNodes[idx] = newChild;
    return oldChild;
  }
  normalize() {}
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    const res = [];
    const walk = (n) => {
      if (n.className && n.className.split(/\s+/).includes(cls)) res.push(n);
      for (const c of n.childNodes) walk(c);
    };
    walk(this);
    return res;
  }
}

const mockDoc = {
  createElement: () => new MockNode(1),
  createTextNode: (t) => new MockNode(3, t)
};

test('replaceInTextNode preserves EXACT left-to-right sentence order with multiple replacements (P0 regression)', () => {
  const original = '我今天在学校学习人工智能的现代工作方式。';
  const container = mockDoc.createElement('p');
  const textNode = mockDoc.createTextNode(original);
  container.appendChild(textNode);

  // Deliberately pass matches out of order to verify internal ascending sort
  const matches = [
    { zh: '工作', en: 'work', idx: 15, end: 17 },
    { zh: '今天', en: 'today', idx: 1, end: 3 },
    { zh: '人工智能', en: 'AI', idx: 8, end: 12 },
    { zh: '学校', en: 'school', idx: 4, end: 6 }
  ];

  replaceEngine.replaceInTextNode(textNode, matches, new Set(['今天']), new Set(), mockDoc);
  assert.equal(container.textContent, '我today在school学习AI的现代work方式。');

  // Restore must recover 100% byte-identical original Chinese
  replaceEngine.restoreReplacedNodes(container, mockDoc);
  assert.equal(container.textContent, original);
});

test('buildSmoothSentenceNode + restoreReplacedNodes restores exact original Chinese text', () => {
  const original = '今天的天气很好，我们决定去公园散步。';
  const container = mockDoc.createElement('p');
  const enMap = new Map([
    ['weather', { zh: '天气', en: 'weather', level: 'daily', pos: 'noun', pos_cn: '名词' }],
    ['walk', { zh: '散步', en: 'walk', level: 'daily', pos: 'verb', pos_cn: '动词' }]
  ]);
  const smooth = replaceEngine.buildSmoothSentenceNode(
    original,
    'The weather is nice today, so we decided to take a walk in the park.',
    enMap,
    mockDoc
  );
  container.appendChild(smooth);

  assert.equal(container.textContent, 'The weather is nice today, so we decided to take a walk in the park.');
  replaceEngine.restoreReplacedNodes(container, mockDoc);
  assert.equal(container.textContent, original);
});

test('storage.validateImportData strips invalid types and unknown keys safely', () => {
  const valid = storage.validateImportData({
    enabled: true,
    level: 'ielts',
    knownWords: ['时间', '工作'],
    excludedSites: 'not-an-array', // invalid type -> stripped
    evilKey: 'injected',           // disallowed key -> stripped
    voiceRate: 1.1
  });
  assert.equal(valid.enabled, true);
  assert.equal(valid.level, 'ielts');
  assert.deepEqual(valid.knownWords, ['时间', '工作']);
  assert.equal(valid.voiceRate, 1.1);
  assert.equal('excludedSites' in valid, false);
  assert.equal('evilKey' in valid, false);

  assert.throws(() => storage.validateImportData('invalid'), /格式无效/);
  assert.throws(() => storage.validateImportData({ unknownOnly: 1 }), /未找到有效/);
});

test('storage.resolvePhraseMap merges defaults, user additions, and deletions cleanly', () => {
  const resolved = storage.resolvePhraseMap({
    phraseMap: { '技术债': 'technical debt' },
    disabledDefaultPhrases: ['做出决定']
  });
  assert.equal(resolved['技术债'], 'technical debt');
  assert.equal(resolved['做出决定'], undefined);
  assert.equal(resolved['换句话说'], 'in other words');
});

test('replaceInTextNode supports bilingual inline mode (学习(study)) and lossless restore', () => {
  const original = '我们今天学习工作。';
  const container = mockDoc.createElement('p');
  const tn = mockDoc.createTextNode(original);
  container.appendChild(tn);

  replaceEngine.replaceInTextNode(
    tn,
    [
      { zh: '今天', en: 'today', idx: 2, end: 4 },
      { zh: '工作', en: 'work', idx: 6, end: 8 }
    ],
    new Set(),
    new Set(),
    mockDoc,
    'bilingual'
  );
  assert.equal(container.textContent, '我们今天(today)学习工作(work)。');

  replaceEngine.restoreReplacedNodes(container, mockDoc);
  assert.equal(container.textContent, original);
});
