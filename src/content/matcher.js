/*
 * IFLL — Linguistic Matcher Engine (Pure & Unit-Testable)
 * 1. Chinese word-boundary matching using native Intl.Segmenter + multi-segment phrase merge
 * 2. Learning-driven replacement scoring (SM-2 due > Daily new > Phrase > Scene/Level)
 * 3. Bidirectional spacing + fragmentation detection
 * 4. English lemmatizer (irregular table + morphological rules) + level-aware matching
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  /* ── Lazy Intl.Segmenter for Chinese word boundaries ── */
  let _zhSegmenter = null;
  function getZhSegmenter() {
    if (_zhSegmenter === null && typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      try {
        _zhSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
      } catch (_) {
        _zhSegmenter = false;
      }
    }
    return _zhSegmenter || null;
  }

  /**
   * Compute target replacement count for a text node.
   * Short UI labels (< 6 CJK chars) return 0 so buttons/tabs aren't mangled.
   */
  function getReplaceBudget(frequency, text) {
    const cjkLen = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjkLen < 6) return 0;
    const ratios = { low: 0.015, medium: 0.032, high: 0.06 };
    const caps = { low: 2, medium: 3, high: 5 };
    const ratio = ratios[frequency] || ratios.medium;
    const cap = caps[frequency] || caps.medium;
    return Math.max(1, Math.min(cap, Math.round(cjkLen * ratio)));
  }

  /**
   * Find strictly non-overlapping Chinese matches aligned to word boundaries.
   * Phrases from phraseMap take priority over single words and can span up to 6 adjacent segments.
   */
  function findChineseMatches(text, { zhMap, phraseMap = {}, knownSet = new Set(), level = 'cet4', skipSingle }) {
    if (!text || !/[\u4e00-\u9fff]/.test(text)) return [];
    const skip = skipSingle || IFLL.constants?.SKIP_SINGLE || new Set();
    const getWeight = IFLL.utils?.getLevelWeight || ((l) => ({ all: 0, daily: 1, cet4: 2, cet6: 3, ielts: 4, graduate: 5 }[l] ?? 99));
    const maxLevelWeight = getWeight(level);
    const segmenter = getZhSegmenter();

    const makePhraseMatch = (zh, en, idx, end) => ({
      zh,
      en,
      def: '',
      pos: 'phrase',
      posCn: '短语',
      examples: [],
      examplesCn: [],
      ipa: '',
      level: 'all',
      cat: 'phrase',
      isPhrase: true,
      idx,
      end,
      len: end - idx
    });

    const makeWordMatch = (entry, idx, end) => ({
      zh: entry.zh,
      en: entry.en,
      def: entry.def || '',
      pos: entry.pos || 'noun',
      posCn: entry.pos_cn || '名词',
      examples: entry.examples || [],
      examplesCn: entry.examplesCn || [],
      ipa: entry.ipa || '',
      level: entry.level || 'cet4',
      cat: entry.cat || '',
      isPhrase: entry.pos === 'phrase',
      isUserWord: !!entry.isUserWord,
      idx,
      end,
      len: end - idx
    });

    const isEligibleWord = (entry) => {
      if (!entry || knownSet.has(entry.zh)) return false;
      if (entry.zh.length === 1) {
        if (skip.has(entry.zh)) return false;
        return false; // Avoid noisy single-character Chinese replacements in prose
      }
      if (!entry.isUserWord && entry.level !== 'all' && getWeight(entry.level) > maxLevelWeight) return false;
      return true;
    };

    const matches = [];

    if (segmenter) {
      const segments = [];
      for (const seg of segmenter.segment(text)) {
        segments.push({ text: seg.segment, index: seg.index, isWordLike: seg.isWordLike });
      }

      let i = 0;
      while (i < segments.length) {
        const cur = segments[i];
        if (!cur.isWordLike || !/[\u4e00-\u9fff]/.test(cur.text)) {
          i++;
          continue;
        }

        // Longest multi-segment match first (up to 5 adjacent segments, max 8 chars)
        let matched = null;
        let advance = 1;
        const maxSpan = Math.min(5, segments.length - i);

        for (let span = maxSpan; span >= 1; span--) {
          let combined = '';
          let validSpan = true;
          for (let k = 0; k < span; k++) {
            const s = segments[i + k];
            if (!s.isWordLike || !/[\u4e00-\u9fff]/.test(s.text)) {
              validSpan = false;
              break;
            }
            combined += s.text;
          }
          if (!validSpan || combined.length > 8) continue;
          const startIdx = cur.index;
          const endIdx = segments[i + span - 1].index + segments[i + span - 1].text.length;

          // 1. Check phraseMap first
          if (phraseMap[combined] && !knownSet.has(combined)) {
            matched = makePhraseMatch(combined, phraseMap[combined], startIdx, endIdx);
            advance = span;
            break;
          }
          // 2. Check zhMap (dictionary + user words)
          const entry = zhMap.get(combined);
          if (entry && isEligibleWord(entry)) {
            matched = makeWordMatch(entry, startIdx, endIdx);
            advance = span;
            break;
          }
        }

        if (matched) {
          matches.push(matched);
          i += advance;
        } else {
          i++;
        }
      }
      return matches;
    }

    // Fallback when Intl.Segmenter is unavailable: greedy longest-match scan
    let pos = 0;
    while (pos < text.length) {
      if (!/[\u4e00-\u9fff]/.test(text[pos])) { pos++; continue; }
      let matched = null;
      const maxLen = Math.min(6, text.length - pos);
      for (let len = maxLen; len >= 2; len--) {
        const sub = text.slice(pos, pos + len);
        if (phraseMap[sub] && !knownSet.has(sub)) {
          matched = makePhraseMatch(sub, phraseMap[sub], pos, pos + len);
          break;
        }
        const entry = zhMap.get(sub);
        if (entry && isEligibleWord(entry)) {
          matched = makeWordMatch(entry, pos, pos + len);
          break;
        }
      }
      if (matched) {
        matches.push(matched);
        pos = matched.end;
      } else {
        pos++;
      }
    }
    return matches;
  }

  /**
   * Rank & select non-overlapping, well-spaced replacements.
   * Always returns matches sorted ASCENDING by `idx`.
   */
  function selectReplacements(matches, count, {
    scene = 'general',
    targetLevel = 'cet4',
    dueReviewSet = new Set(),
    dailyWordSet = new Set(),
    minGap = 6
  } = {}) {
    if (!matches.length || count <= 0) return [];

    const sceneCats = IFLL.constants?.SCENE_KEYS?.[scene] || [];
    const scored = matches.map((m) => {
      let score = 0;
      if (dueReviewSet.has(m.zh)) score += 35;        // Highest priority: due SM-2 review
      if (dailyWordSet.has(m.zh)) score += 25;        // Today's target words
      if (m.isUserWord) score += 20;                  // User's own vocabulary
      if (m.isPhrase) score += 15;                    // Natural collocation priority
      if (m.level === targetLevel) score += 10;       // Match learner's current band
      if (m.len >= 3) score += 4;
      if (sceneCats.includes(m.cat)) score += 5;
      if (sceneCats.includes(m.pos)) score += 2;
      if (m.examples?.length) score += 2;
      return { m, score };
    });

    scored.sort((a, b) => b.score - a.score || a.m.idx - b.m.idx);

    const selected = [];
    const seenZh = new Set();

    const fitsSpacing = (candidate, gap) => {
      for (const s of selected) {
        // Strict overlap check + bidirectional spacing check
        if (candidate.idx < s.end + gap && s.idx < candidate.end + gap) {
          return false;
        }
      }
      return true;
    };

    // Pass 1: unique words with comfortable spacing
    for (const { m } of scored) {
      if (selected.length >= count) break;
      if (seenZh.has(m.zh)) continue;
      if (fitsSpacing(m, minGap)) {
        selected.push(m);
        seenZh.add(m.zh);
      }
    }

    // Pass 2: if still under budget on dense prose, relax gap to 2 chars (never overlapping)
    if (selected.length < count) {
      for (const { m } of scored) {
        if (selected.length >= count) break;
        if (seenZh.has(m.zh)) continue;
        if (fitsSpacing(m, 2)) {
          selected.push(m);
          seenZh.add(m.zh);
        }
      }
    }

    // Always sort ascending by position for left-to-right DOM assembly & fragment analysis
    selected.sort((a, b) => a.idx - b.idx);
    return selected;
  }

  /**
   * Detect choppy mixed-language fragmentation ("today的 weather很好")
   * on ascending-sorted replacements.
   */
  function isFragmented(text, sortedSelected) {
    if (!sortedSelected || sortedSelected.length < 2) return false;
    let choppyGaps = 0;
    for (let i = 1; i < sortedSelected.length; i++) {
      const prev = sortedSelected[i - 1];
      const cur = sortedSelected[i];
      if (cur.idx < prev.end) continue;
      const gap = text.slice(prev.end, cur.idx);
      if (gap.length <= 4 && /[的地得了着过和与在就是都也把被]/.test(gap)) {
        choppyGaps++;
      }
    }
    return choppyGaps >= 2;
  }

  /* ── English Lemmatizer (irregulars + morphological suffix stripping) ── */
  const IRREGULAR_EN = {
    // Verbs
    am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
    has: 'have', had: 'have', having: 'have',
    does: 'do', did: 'do', done: 'do',
    went: 'go', gone: 'go', goes: 'go',
    saw: 'see', seen: 'see',
    came: 'come', became: 'become', overcame: 'overcome',
    took: 'take', taken: 'take', undertook: 'undertake', undertaken: 'undertake',
    made: 'make', gave: 'give', given: 'give',
    got: 'get', gotten: 'get', forgot: 'forget', forgotten: 'forget',
    found: 'find', thought: 'think', told: 'tell', sold: 'sell',
    felt: 'feel', left: 'leave', kept: 'keep', slept: 'sleep', swept: 'sweep', wept: 'weep', crept: 'creep',
    brought: 'bring', bought: 'buy', caught: 'catch', taught: 'teach', fought: 'fight', sought: 'seek',
    began: 'begin', begun: 'begin', drank: 'drink', drunk: 'drink',
    sang: 'sing', sung: 'sing', sank: 'sink', sunk: 'sink', swam: 'swim', swum: 'swim',
    rang: 'ring', rung: 'ring', sprang: 'spring', sprung: 'spring', shrank: 'shrink', shrunk: 'shrink',
    wrote: 'write', written: 'write', drove: 'drive', driven: 'drive', rode: 'ride', ridden: 'ride',
    rose: 'rise', risen: 'rise', arose: 'arise', arisen: 'arise',
    spoke: 'speak', spoken: 'speak', broke: 'break', broken: 'break',
    chose: 'choose', chosen: 'choose', froze: 'freeze', frozen: 'freeze',
    stole: 'steal', stolen: 'steal', woke: 'wake', woken: 'wake',
    wore: 'wear', worn: 'wear', tore: 'tear', torn: 'tear', bore: 'bear', born: 'bear', borne: 'bear',
    swore: 'swear', sworn: 'swear',
    knew: 'know', known: 'know', grew: 'grow', grown: 'grow',
    drew: 'draw', drawn: 'draw', withdrew: 'withdraw', withdrawn: 'withdraw',
    threw: 'throw', thrown: 'throw', blew: 'blow', blown: 'blow', flew: 'fly', flown: 'fly',
    shown: 'show', showed: 'show',
    ate: 'eat', eaten: 'eat', fell: 'fall', fallen: 'fall',
    ran: 'run', sat: 'sit', stood: 'stand', understood: 'understand',
    met: 'meet', fed: 'feed', led: 'lead', bled: 'bleed', bred: 'breed', fled: 'flee', sped: 'speed',
    held: 'hold', upheld: 'uphold', withheld: 'withhold',
    built: 'build', rebuilt: 'rebuild', sent: 'send', spent: 'spend', lent: 'lend', bent: 'bend',
    meant: 'mean', dealt: 'deal', dreamt: 'dream', learnt: 'learn', burnt: 'burn',
    paid: 'pay', said: 'say', laid: 'lay', slain: 'slay',
    heard: 'hear', bound: 'bind', wound: 'wind', ground: 'grind',
    lost: 'lose', shot: 'shoot', lit: 'light', bit: 'bite', bitten: 'bite',
    hid: 'hide', hidden: 'hide', slid: 'slide',
    struck: 'strike', stuck: 'stick', hung: 'hang', swung: 'swing', dug: 'dig', won: 'win', spun: 'spin',
    forgave: 'forgive', forgiven: 'forgive', forbade: 'forbid', forbidden: 'forbid',
    shook: 'shake', shaken: 'shake', proven: 'prove',
    // Irregular plurals & comparatives
    men: 'man', women: 'woman', children: 'child', people: 'person',
    feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose',
    lives: 'life', wives: 'wife', knives: 'knife', leaves: 'leaf',
    shelves: 'shelf', halves: 'half', wolves: 'wolf', thieves: 'thief', loaves: 'loaf',
    criteria: 'criterion', phenomena: 'phenomenon', analyses: 'analysis',
    crises: 'crisis', theses: 'thesis', hypotheses: 'hypothesis',
    bases: 'basis', indices: 'index', appendices: 'appendix', stimuli: 'stimulus',
    fungi: 'fungus', nuclei: 'nucleus', radii: 'radius', curricula: 'curriculum',
    better: 'good', best: 'good', worse: 'bad', worst: 'bad',
    further: 'far', furthest: 'far', farther: 'far', farthest: 'far',
    less: 'little', least: 'little', more: 'much', most: 'much',
    elder: 'old', eldest: 'old', studies: 'study', studied: 'study'
  };

  /**
   * Resolve an inflected English word against `enMap`, returning `{ lemma, entry }` or `null`.
   */
  function lookupEnglishLemma(rawWord, enMap) {
    if (!rawWord || !enMap) return null;
    const w = rawWord.toLowerCase();
    if (w.length < 3) return null;

    if (enMap.has(w)) return { lemma: w, entry: enMap.get(w) };

    const irr = IRREGULAR_EN[w];
    if (irr && enMap.has(irr)) return { lemma: irr, entry: enMap.get(irr) };

    const candidates = [];

    // Plurals & 3rd-person singular
    if (w.endsWith('ies') && w.length > 4) candidates.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ves') && w.length > 4) {
      candidates.push(w.slice(0, -3) + 'f', w.slice(0, -3) + 'fe');
    }
    if (w.endsWith('es') && w.length > 4) candidates.push(w.slice(0, -2));
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) candidates.push(w.slice(0, -1));

    // Past tense & past participle
    if (w.endsWith('ied') && w.length > 4) candidates.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ed') && w.length > 4) {
      const stem = w.slice(0, -2);
      candidates.push(stem, stem + 'e');
      // Doubled final consonant: stopped -> stop, planned -> plan
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        candidates.push(stem.slice(0, -1));
      }
    }

    // Present participle / gerund
    if (w.endsWith('ing') && w.length > 5) {
      const stem = w.slice(0, -3);
      candidates.push(stem, stem + 'e');
      if (stem.endsWith('y')) candidates.push(stem.slice(0, -1) + 'ie'); // dying -> die
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        candidates.push(stem.slice(0, -1)); // running -> run
      }
    }

    // Comparatives / superlatives
    if (w.endsWith('ier') && w.length > 4) candidates.push(w.slice(0, -3) + 'y');
    if (w.endsWith('iest') && w.length > 5) candidates.push(w.slice(0, -4) + 'y');
    if (w.endsWith('er') && w.length > 4) {
      const stem = w.slice(0, -2);
      candidates.push(stem, stem + 'e');
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        candidates.push(stem.slice(0, -1));
      }
    }
    if (w.endsWith('est') && w.length > 5) {
      const stem = w.slice(0, -3);
      candidates.push(stem, stem + 'e');
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        candidates.push(stem.slice(0, -1));
      }
    }

    // Adverbs
    if (w.endsWith('ily') && w.length > 5) candidates.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ly') && w.length > 5) candidates.push(w.slice(0, -2));

    for (const c of candidates) {
      if (c.length >= 3 && enMap.has(c)) {
        return { lemma: c, entry: enMap.get(c) };
      }
    }
    return null;
  }

  /**
   * Find English words to annotate in a text string.
   * Respects knownWords, reviewQueue priority, annotateStrategy, and per-page deduplication.
   */
  function findEnglishMatches(text, {
    enMap,
    knownSet = new Set(),
    reviewEnSet = new Set(),
    level = 'cet4',
    strategy = 'target_and_above', // 'target_and_above' | 'all_up_to_target'
    seenEnSet = null,
    limit = Infinity
  }) {
    if (!text || !/[a-zA-Z]{3,}/.test(text)) return [];
    const getWeight = IFLL.utils?.getLevelWeight || ((l) => ({ all: 0, daily: 1, cet4: 2, cet6: 3, ielts: 4, graduate: 5 }[l] ?? 99));
    const targetWeight = getWeight(level);

    const re = /[a-zA-Z]+(?:[-'][a-zA-Z]+)*/g;
    const results = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      if (results.length >= limit) break;
      const surface = m[0];
      if (surface.length < 3) continue;
      // Skip ALL-CAPS short acronyms like API, URL, JSON, HTTP
      if (surface.length <= 5 && surface === surface.toUpperCase()) continue;

      const hit = lookupEnglishLemma(surface, enMap);
      if (!hit) continue;
      const { lemma, entry } = hit;

      // Known check: skip if primary zh or all zh senses are marked known
      if (knownSet.has(entry.zh)) continue;
      if (seenEnSet && seenEnSet.has(lemma)) continue;

      const inReview = reviewEnSet.has(lemma);
      const isUser = !!entry.isUserWord;
      const w = getWeight(entry.level);

      if (!inReview && !isUser) {
        if (strategy === 'target_and_above') {
          // For reading English pages: annotate words at or above the learner's target band
          // (so CET-6/IELTS/考研 learners aren't spammed with "time", "good", "school")
          if (w < targetWeight) continue;
        } else {
          if (entry.level !== 'all' && w > targetWeight) continue;
        }
      }

      if (seenEnSet) seenEnSet.add(lemma);
      results.push({
        surface,
        lemma,
        idx: m.index,
        end: m.index + surface.length,
        entry
      });
    }
    return results;
  }

  const matcher = {
    getReplaceBudget,
    findChineseMatches,
    selectReplacements,
    isFragmented,
    lookupEnglishLemma,
    findEnglishMatches,
    IRREGULAR_EN
  };

  IFLL.matcher = matcher;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = matcher;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
