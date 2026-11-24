import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wordbank = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/wordbank.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/wordbank-meta.json'), 'utf8'));

test('wordbank.json integrity: no duplicates, no slash-polluted en, no redundant def===en, no corrupted POS', () => {
  assert.ok(Array.isArray(wordbank) && wordbank.length >= 5000);
  assert.equal(meta.total, wordbank.length);

  const seenZh = new Set();
  const levelCounts = {};
  let withSchwa = 0;

  for (const e of wordbank) {
    assert.ok(e.zh && typeof e.zh === 'string', 'missing zh');
    assert.ok(e.en && typeof e.en === 'string', 'missing en');
    assert.equal(seenZh.has(e.zh), false, `duplicate zh: ${e.zh}`);
    seenZh.add(e.zh);

    assert.equal(e.en.includes('/'), false, `slash in en: ${e.zh} -> ${e.en}`);
    assert.equal(/的的/.test(e.zh), false, `typo 的的 in zh: ${e.zh}`);
    assert.equal(/measure word|particle|suffix|\(measure\)/i.test(e.en), false, `meta description in en: ${e.zh} -> ${e.en}`);
    assert.equal((e.def || '').toLowerCase() === e.en.toLowerCase(), false, `redundant def===en: ${e.zh}`);
    assert.equal(/[a-zA-Z]/.test(e.pos_cn || ''), false, `English leaked into pos_cn: ${e.zh}`);

    if (e.zh.endsWith('的') && !['目的', '标的', '的士'].includes(e.zh)) {
      assert.notEqual(e.pos, 'noun', `的-adjective mislabeled as noun: ${e.zh}`);
    }
    if (e.ipa && e.ipa.includes('ə')) withSchwa++;
    levelCounts[e.level] = (levelCounts[e.level] || 0) + 1;
  }

  // Every advertised level must have genuine coverage (including IELTS!)
  for (const lvl of ['daily', 'cet4', 'cet6', 'ielts', 'graduate']) {
    assert.ok((levelCounts[lvl] || 0) >= 500, `level ${lvl} coverage too low: ${levelCounts[lvl]}`);
  }
  assert.ok(withSchwa >= 2000, `IPA schwa repair should cover >= 2000 words, got ${withSchwa}`);
});
