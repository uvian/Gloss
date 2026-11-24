import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/shared/constants.js');
require('../src/shared/utils.js');
const matcher = require('../src/content/matcher.js');

const sampleZhMap = new Map([
  ['工作', { zh: '工作', en: 'work', level: 'cet4', pos: 'noun', pos_cn: '名词', cat: 'daily' }],
  ['方式', { zh: '方式', en: 'method', level: 'cet4', pos: 'noun', pos_cn: '名词', cat: 'abstract' }],
  ['今天', { zh: '今天', en: 'today', level: 'daily', pos: 'noun', pos_cn: '名词', cat: 'daily' }],
  ['学校', { zh: '学校', en: 'school', level: 'cet4', pos: 'noun', pos_cn: '名词', cat: 'daily' }],
  ['人工智能', { zh: '人工智能', en: 'artificial intelligence', level: 'cet6', pos: 'noun', pos_cn: '名词', cat: 'tech' }],
  ['人工', { zh: '人工', en: 'manual', level: 'cet4', pos: 'adjective', pos_cn: '形容词', cat: 'daily' }],
  ['决定', { zh: '决定', en: 'decision', level: 'cet4', pos: 'noun', pos_cn: '名词', cat: 'daily' }],
  ['重要', { zh: '重要', en: 'important', level: 'cet4', pos: 'adjective', pos_cn: '形容词', cat: 'daily' }],
  ['挑战', { zh: '挑战', en: 'challenge', level: 'cet4', pos: 'noun', pos_cn: '名词', cat: 'daily' }],
  ['时间', { zh: '时间', en: 'time', level: 'cet4', pos: 'noun', pos_cn: '名词', cat: 'daily' }],
  ['发展', { zh: '发展', en: 'develop', level: 'cet4', pos: 'verb', pos_cn: '动词', cat: 'daily' }]
]);

test('findChineseMatches respects Chinese word boundaries and avoids mid-word false cuts', () => {
  // "手工制作" must NOT falsely cut out "工作"
  const falseCut = matcher.findChineseMatches('这是一件精美的手工制作工艺品。', {
    zhMap: sampleZhMap,
    level: 'cet6'
  });
  assert.equal(falseCut.some(m => m.zh === '工作'), false);

  // "人工智能" should match as a full compound rather than splitting into "人工"
  const compound = matcher.findChineseMatches('人工智能正在改变现代工作方式。', {
    zhMap: sampleZhMap,
    level: 'cet6'
  });
  assert.ok(compound.some(m => m.zh === '人工智能' && m.en === 'artificial intelligence'));
  assert.equal(compound.some(m => m.zh === '人工'), false);

  // Matches are strictly non-overlapping and ascending
  for (let i = 1; i < compound.length; i++) {
    assert.ok(compound[i].idx >= compound[i - 1].end, 'matches must never overlap');
  }
});

test('findChineseMatches prioritizes collocation phrases from phraseMap over single words', () => {
  const matches = matcher.findChineseMatches('我们需要尽快做出决定以应对未来的挑战。', {
    zhMap: sampleZhMap,
    phraseMap: { '做出决定': 'make a decision' },
    level: 'cet4'
  });
  assert.ok(matches.some(m => m.zh === '做出决定' && m.en === 'make a decision' && m.isPhrase));
  assert.equal(matches.some(m => m.zh === '决定'), false);
});

test('selectReplacements prioritizes SM-2 due review & daily words, enforces bidirectional spacing, and sorts ascending', () => {
  const matches = [
    { zh: '今天', en: 'today', idx: 0, end: 2, len: 2, level: 'daily', cat: 'daily', pos: 'noun' },
    { zh: '学校', en: 'school', idx: 12, end: 14, len: 2, level: 'cet4', cat: 'daily', pos: 'noun' },
    { zh: '挑战', en: 'challenge', idx: 28, end: 30, len: 2, level: 'cet4', cat: 'daily', pos: 'noun' },
    { zh: '发展', en: 'develop', idx: 31, end: 33, len: 2, level: 'cet4', cat: 'daily', pos: 'verb' }
  ];

  const selected = matcher.selectReplacements(matches, 2, {
    dueReviewSet: new Set(['挑战']),
    dailyWordSet: new Set(['今天']),
    minGap: 6
  });

  assert.equal(selected.length, 2);
  // Must pick both due review ('挑战') and daily word ('今天'), sorted ASCENDING by idx!
  assert.deepEqual(selected.map(m => m.zh), ['今天', '挑战']);
  assert.ok(selected[0].idx < selected[1].idx);
});

test('getReplaceBudget skips short UI labels (< 6 CJK chars)', () => {
  assert.equal(matcher.getReplaceBudget('high', '登录'), 0);
  assert.equal(matcher.getReplaceBudget('high', '我的关注'), 0);
  assert.ok(matcher.getReplaceBudget('medium', '这是一段正常长度的中文新闻正文段落，用来测试替换预算。') >= 1);
});

test('lookupEnglishLemma resolves irregular verbs, plurals, gerunds, past tense, and comparatives', () => {
  const enMap = new Map([
    ['run', { zh: '跑', en: 'run', level: 'daily' }],
    ['study', { zh: '学习', en: 'study', level: 'cet4' }],
    ['child', { zh: '孩子', en: 'child', level: 'daily' }],
    ['develop', { zh: '发展', en: 'develop', level: 'cet4' }],
    ['analyze', { zh: '分析', en: 'analyze', level: 'cet6' }],
    ['stop', { zh: '停止', en: 'stop', level: 'daily' }],
    ['happy', { zh: '开心', en: 'happy', level: 'daily' }],
    ['criterion', { zh: '标准', en: 'criterion', level: 'ielts' }],
    ['write', { zh: '写', en: 'write', level: 'daily' }]
  ]);

  assert.equal(matcher.lookupEnglishLemma('running', enMap)?.lemma, 'run');
  assert.equal(matcher.lookupEnglishLemma('ran', enMap)?.lemma, 'run');
  assert.equal(matcher.lookupEnglishLemma('studies', enMap)?.lemma, 'study');
  assert.equal(matcher.lookupEnglishLemma('studied', enMap)?.lemma, 'study');
  assert.equal(matcher.lookupEnglishLemma('children', enMap)?.lemma, 'child');
  assert.equal(matcher.lookupEnglishLemma('developing', enMap)?.lemma, 'develop');
  assert.equal(matcher.lookupEnglishLemma('analyzed', enMap)?.lemma, 'analyze');
  assert.equal(matcher.lookupEnglishLemma('stopped', enMap)?.lemma, 'stop');
  assert.equal(matcher.lookupEnglishLemma('happier', enMap)?.lemma, 'happy');
  assert.equal(matcher.lookupEnglishLemma('criteria', enMap)?.lemma, 'criterion');
  assert.equal(matcher.lookupEnglishLemma('written', enMap)?.lemma, 'write');
});

test('findEnglishMatches applies target_and_above strategy and deduplicates per page', () => {
  const enMap = new Map([
    ['good', { zh: '好', en: 'good', level: 'daily' }],
    ['hypothesis', { zh: '假设', en: 'hypothesis', level: 'ielts' }],
    ['paradigm', { zh: '范式', en: 'paradigm', level: 'graduate' }]
  ]);
  const seen = new Set();
  const hits = matcher.findEnglishMatches(
    'This is a good hypothesis, and the hypotheses reshape the paradigm.',
    { enMap, level: 'ielts', strategy: 'target_and_above', seenEnSet: seen }
  );
  // 'good' (daily < ielts) excluded; 'hypothesis' matched once ('hypotheses' deduped); 'paradigm' matched
  assert.deepEqual(hits.map(h => h.lemma), ['hypothesis', 'paradigm']);
});
