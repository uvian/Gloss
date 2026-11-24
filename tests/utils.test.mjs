import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/shared/constants.js');
const utils = require('../src/shared/utils.js');

test('extractJson handles raw JSON, markdown fences, <think> blocks, trailing commas, and unescaped newlines', () => {
  const withThink = `<think>Let me analyze this word carefully...</think>
\`\`\`json
{
  "synonyms": ["swift", "rapid",],
  "usage": "用于正式语境
适合学术写作",
  "examples": [{"en": "He made a rapid recovery.", "cn": "他**迅速**康复了。"}]
}
\`\`\``;
  const parsed = utils.extractJson(withThink);
  assert.ok(parsed);
  assert.deepEqual(parsed.synonyms, ['swift', 'rapid']);
  assert.match(parsed.usage, /用于正式语境/);
  assert.equal(parsed.examples.length, 1);

  // Must NEVER corrupt values into literal "FIXED"
  const broken = '{"usage": "say "hello" to him"}';
  const res = utils.extractJson(broken);
  assert.notEqual(res?.usage, 'FIXED');

  // Auto-closes minor truncated ending
  const truncated = '{"synonyms":["fast"],"usage":"常用词"';
  const closed = utils.extractJson(truncated);
  assert.deepEqual(closed, { synonyms: ['fast'], usage: '常用词' });
});

test('detectTextLanguage handles Chinese paragraphs starting with English acronyms, numbers, or quotes', () => {
  assert.equal(utils.detectTextLanguage('AI 正在深刻改变现代软件工程的工作方式。'), 'zh');
  assert.equal(utils.detectTextLanguage('2026年发布了全新的版本特性。'), 'zh');
  assert.equal(utils.detectTextLanguage('“这是一个很好的开始。”'), 'zh');
  assert.equal(utils.detectTextLanguage('TypeScript improves maintainability across large codebases.'), 'en');
  assert.equal(utils.detectTextLanguage('The concept of 阴阳 is widely discussed in philosophy.'), 'en');
  assert.equal(utils.detectTextLanguage('123456 --- !!!'), 'other');
});

test('normalizeEndpoint strips trailing slashes and accidental chat/completions suffix', () => {
  assert.equal(utils.normalizeEndpoint('https://api.deepseek.com/'), 'https://api.deepseek.com');
  assert.equal(utils.normalizeEndpoint('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1');
  assert.equal(utils.normalizeEndpoint('https://proxy.example.com/v1/models/'), 'https://proxy.example.com/v1');
});

test('formatApiError returns clear actionable Chinese diagnostics', () => {
  assert.match(utils.formatApiError(401, '{"error":{"message":"invalid api key"}}'), /API Key 无效/);
  assert.match(utils.formatApiError(402, ''), /余额不足/);
  assert.match(utils.formatApiError(404, ''), /模型不存在/);
  assert.match(utils.formatApiError(429, ''), /限流/);
  assert.match(utils.formatApiError(503, ''), /服务端暂时异常/);
});

test('sm2Next schedules intervals monotonically on pass and resets on fail', () => {
  const now = 1_700_000_000_000;
  const base = { zh: '范式', en: 'paradigm', reviewCount: 0, ease: 2.5 };

  const r1 = utils.sm2Next(base, 3, now);
  assert.equal(r1.reviewCount, 1);
  assert.ok(r1.nextReview > now);
  assert.ok(r1.ease > 2.5);

  const r2 = utils.sm2Next(r1, 4, now);
  assert.equal(r2.reviewCount, 2);
  assert.ok(r2.nextReview - now > r1.nextReview - now);

  const fail = utils.sm2Next(r2, 1, now);
  assert.equal(fail.reviewCount, 0);
  assert.ok(fail.ease < r2.ease);
  assert.equal(fail.nextReview - now, 43200000); // 12h
});

test('isExcludedHost matches exact domain and subdomains only', () => {
  const list = ['github.com', 'zhihu.com'];
  assert.equal(utils.isExcludedHost('github.com', list), true);
  assert.equal(utils.isExcludedHost('gist.github.com', list), true);
  assert.equal(utils.isExcludedHost('mygithub.com', list), false);
  assert.equal(utils.isExcludedHost('example.org', list), false);
});

test('getLocalDateStr formats local YYYY-MM-DD cleanly', () => {
  const d = new Date(2026, 0, 5); // Jan 5, 2026 local
  assert.equal(utils.getLocalDateStr(d), '2026-01-05');
});

test('escapeHtml and renderBoldHtml neutralize XSS payloads', () => {
  const xss = '<img src=x onerror=alert(1)> **重点**';
  const rendered = utils.renderBoldHtml(xss);
  assert.ok(!rendered.includes('<img'));
  assert.ok(rendered.includes('&lt;img'));
  assert.ok(rendered.includes('<strong class="ifll-bold">重点</strong>'));
});

test('parseBulkWordList parses TSV, CSV, colon, dash, and auto-detects zh/en column order', () => {
  const raw = `
# comment line
word,meaning
paradigm, 范式
resilient\t有韧性的\table to recover quickly
权衡利弊 - weigh the pros and cons
ubiquitous：无处不在的
paradigm, 范式
`;
  const list = utils.parseBulkWordList(raw);
  assert.equal(list.length, 4);
  assert.deepEqual(list[0], { en: 'paradigm', zh: '范式', def: '' });
  assert.deepEqual(list[1], { en: 'resilient', zh: '有韧性的', def: 'able to recover quickly' });
  assert.deepEqual(list[2], { en: 'weigh the pros and cons', zh: '权衡利弊', def: '' });
  assert.deepEqual(list[3], { en: 'ubiquitous', zh: '无处不在的', def: '' });
});

test('buildAnkiTsv formats clean 5-column TSV without raw tabs/newlines', () => {
  const tsv = utils.buildAnkiTsv([
    { en: 'paradigm', zh: '范式', def: 'a typical\nexample', ipa: '/ˈpærədaɪm/', context: 'A new paradigm\tshifted.', level: 'ielts' }
  ]);
  const cols = tsv.split('\t');
  assert.equal(cols.length, 5);
  assert.equal(cols[0], 'paradigm');
  assert.match(cols[1], /范式 — a typical example/);
  assert.equal(cols[2], '/ˈpærədaɪm/');
  assert.equal(cols[3], 'A new paradigm shifted.');
  assert.equal(cols[4], 'IFLL ielts');
});

test('computeStreak calculates consecutive active days accurately', () => {
  const today = new Date(2026, 10, 23); // 2026-11-23
  const hist = {
    '2026-11-23': { learned: 2, reviewed: 1 },
    '2026-11-22': { learned: 0, reviewed: 4 },
    '2026-11-21': { learned: 3, reviewed: 0 },
    '2026-11-19': { learned: 5, reviewed: 0 } // gap on Nov 20
  };
  assert.equal(utils.computeStreak(hist, today), 3);

  // If today has 0 activity yet, streak still counts from yesterday
  delete hist['2026-11-23'];
  assert.equal(utils.computeStreak(hist, today), 2);
});

test('buildClozeSentence masks exact, regular, and irregular inflected word forms cleanly', () => {
  const r1 = utils.buildClozeSentence('Researchers studied these remarkable phenomena.', 'study');
  assert.ok(r1);
  assert.equal(r1.answer, 'studied');
  assert.equal(r1.masked, 'Researchers ______ these remarkable phenomena.');

  const rIrr = utils.buildClozeSentence('Scientific Hypotheses and Paradigms', 'hypothesis');
  assert.ok(rIrr);
  assert.equal(rIrr.answer, 'Hypotheses');
  assert.equal(rIrr.masked, 'Scientific ______ and Paradigms');

  const r2 = utils.buildClozeSentence('No match here.', 'paradigm');
  assert.equal(r2, null);
});

test('aiClient.parseBatchTranslations validates exact count alignment', () => {
  const aiClient = require('../src/background/ai-client.js');
  const ok = aiClient.parseBatchTranslations('{"translations":["第一句","第二句"]}', 2);
  assert.deepEqual(ok, ['第一句', '第二句']);

  const badCount = aiClient.parseBatchTranslations('{"translations":["只有一句"]}', 2);
  assert.equal(badCount, null);
});

test('aiClient.isOpenCodeEndpoint and buildRequestHeaders inject x-opencode-session only for opencode.ai', () => {
  const aiClient = require('../src/background/ai-client.js');

  assert.equal(aiClient.isOpenCodeEndpoint('https://opencode.ai/zen/go/v1'), true);
  assert.equal(aiClient.isOpenCodeEndpoint('https://opencode.ai/inference/go/v1'), true);
  assert.equal(aiClient.isOpenCodeEndpoint('https://api.opencode.ai/v1'), true);
  assert.equal(aiClient.isOpenCodeEndpoint('https://api.deepseek.com'), false);
  assert.equal(aiClient.isOpenCodeEndpoint('https://api.openai.com/v1'), false);
  assert.equal(aiClient.isOpenCodeEndpoint('https://fakeopencode.ai/v1'), false);

  const oc1 = aiClient.buildRequestHeaders('https://opencode.ai/zen/go/v1', 'sk-oc', true, 'translate');
  const oc2 = aiClient.buildRequestHeaders('https://opencode.ai/zen/go/v1', 'sk-oc', true, 'translate');
  const ocWord = aiClient.buildRequestHeaders('https://opencode.ai/zen/go/v1', 'sk-oc', true, 'word');
  assert.equal(oc1.Authorization, 'Bearer sk-oc');
  assert.equal(oc1['Content-Type'], 'application/json');
  assert.match(oc1['x-opencode-session'], /^session-[a-z0-9-]+$/i);
  assert.equal(oc1['x-opencode-session'], oc2['x-opencode-session']);
  assert.notEqual(oc1['x-opencode-session'], ocWord['x-opencode-session']);

  const t1 = aiClient.buildRequestHeaders('https://opencode.ai/zen/go/v1', 'sk-oc', true, 'test');
  const t2 = aiClient.buildRequestHeaders('https://opencode.ai/zen/go/v1', 'sk-oc', true, 'test');
  assert.match(t1['x-opencode-session'], /^session-/);
  assert.notEqual(t1['x-opencode-session'], t2['x-opencode-session']);

  const ds = aiClient.buildRequestHeaders('https://api.deepseek.com', 'sk-ds', false, 'models');
  assert.equal(ds.Authorization, 'Bearer sk-ds');
  assert.equal(ds['Content-Type'], undefined);
  assert.equal(ds['x-opencode-session'], undefined);
});

