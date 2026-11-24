/*
 * IFLL — Single Source of Truth for Constants, Defaults & Presets (v0.4)
 */
(function (root) {
  'use strict';

  const IFLL = (root.IFLL = root.IFLL || {});

  const VERSION = '0.5.1';

  /* Unbounded user-generated collections stored in chrome.storage.local (10MB quota) */
  const LOCAL_KEYS = ['knownWords', 'reviewQueue', 'userWords', 'phraseMap', 'learningHistory'];

  const PROVIDER_PRESETS = {
    'https://api.deepseek.com': {
      name: 'DeepSeek',
      defaultModel: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner']
    },
    'https://api.openai.com/v1': {
      name: 'OpenAI',
      defaultModel: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']
    },
    'https://openrouter.ai/api/v1': {
      name: 'OpenRouter',
      defaultModel: 'deepseek/deepseek-chat-v3-0324',
      models: ['deepseek/deepseek-chat-v3-0324', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash']
    },
    'https://opencode.ai/zen/go/v1': {
      name: 'OpenCode Go',
      defaultModel: 'deepseek-v4-flash',
      models: [
        'deepseek-v4-flash',
        'deepseek-v4.1-flash',
        'deepseek-v4-pro',
        'glm-5.3-flash',
        'glm-5.3',
        'glm-5.2',
        'qwen3.8-flash',
        'kimi-k3',
        'kimi-k2.7-code',
        'kimi-k2.6',
        'minimax-m3',
        'mimo-v2.6-flash'
      ]
    }
  };

  /* Built-in high-value collocation defaults (merged with user phraseMap) */
  const DEFAULT_PHRASE_MAP = {
    '做出决定': 'make a decision',
    '换句话说': 'in other words',
    '另一方面': 'on the other hand',
    '事实上': 'in fact',
    '到目前为止': 'so far',
    '众所周知': 'as we all know',
    '毫无疑问': 'without doubt',
    '归根结底': 'in the final analysis',
    '从长远来看': 'in the long run',
    '在很大程度上': 'to a large extent',
    '发挥重要作用': 'play an important role',
    '毫不犹豫': 'without hesitation',
    '无论如何': 'in any case',
    '采取措施': 'take measures',
    '与此同时': 'meanwhile',
    '除此之外': 'in addition',
    '总的来说': 'in general',
    '值得注意的是': 'notably',
    '顺便说一下': 'by the way',
    '也就是说': 'that is to say',
    '密切相关': 'closely related',
    '充分利用': 'make full use of',
    '达成一致': 'reach an agreement',
    '提出建议': 'put forward a suggestion',
    '解决问题': 'solve the problem',
    '保持联系': 'keep in touch',
    '面对挑战': 'face challenges',
    '产生影响': 'have an impact on',
    '坚持不懈': 'persevere',
    '脱颖而出': 'stand out',
    '循序渐进': 'step by step',
    '一目了然': 'clear at a glance',
    '不可或缺': 'indispensable',
    '与时俱进': 'keep pace with the times',
    '供不应求': 'in short supply',
    '显而易见': 'self-evident',
    '相辅相成': 'complement each other',
    '权衡利弊': 'weigh the pros and cons',
    '打破僵局': 'break the deadlock',
    '全力以赴': 'go all out'
  };

  const DEFAULTS = {
    enabled: true,
    defaultMode: 'replace',
    sitePolicy: 'auto',                    // 'auto' | 'prompt' | 'manual'
    siteModes: {},                         // { [hostname]: 'replace' | 'annotate' | 'translate' | 'off' }
    frequency: 'medium',                   // 'low' | 'medium' | 'high'
    replaceStyle: 'inline',                // 'inline' (study) | 'bilingual' (学习(study))
    level: 'cet4',                         // 'daily' | 'cet4' | 'cet6' | 'ielts' | 'graduate'
    annotateStrategy: 'target_and_above',  // 'target_and_above' | 'all_up_to_target'
    knownWords: [],                        // string[] of zh keys
    excludedSites: [],                     // string[] of hostnames
    apiKey: '',
    apiEndpoint: 'https://api.deepseek.com',
    apiModel: 'deepseek-chat',
    enableFreeTranslateFallback: true,     // zero-key fallback when apiKey is empty
    voiceName: '',
    voiceRate: 0.9,
    reviewQueue: [],                       // [{ zh, en, def?, ipa?, pos?, pos_cn?, context?, sourceUrl?, sourceTitle?, addedAt, reviewCount, nextReview, ease }]
    userWords: [],                         // [{ zh, en, def, pos, pos_cn, ipa?, level, cat, examples?, examplesCn? }]
    phraseMap: {},                         // user overrides / additions: { zh: en }
    disabledDefaultPhrases: [],            // string[] of built-in phrases user deleted
    tooltipTheme: 'auto',                  // 'auto' | 'light' | 'dark'
    showFloatBall: true,
    enableSelToolbar: true,
    enableHoverPreview: true,
    enableInputTranslate: true,            // triple-space or Alt+Y in input/textarea
    customActions: [],                     // [{ id, name, prompt, fields }]
    dailyWordCount: 15,
    dailyWords: [],                        // [{ zh, en, addedAt }]
    dailyWordDate: '',                     // local YYYY-MM-DD
    dailyStats: {
      date: '',
      replaceCount: 0,
      annotateCount: 0,
      translateChars: 0,
      clickedCount: 0,
      reviewedCount: 0,
      totalLearned: 0
    },
    learningHistory: {}                    // { 'YYYY-MM-DD': { learned: n, reviewed: n, replaced: n } } (last 60 days)
  };

  const IMPORT_ALLOWED_KEYS = [
    'enabled', 'defaultMode', 'sitePolicy', 'siteModes', 'frequency', 'replaceStyle', 'level',
    'annotateStrategy', 'apiKey', 'apiEndpoint', 'apiModel', 'enableFreeTranslateFallback',
    'voiceName', 'voiceRate', 'excludedSites', 'knownWords', 'reviewQueue', 'userWords',
    'dailyStats', 'learningHistory', 'phraseMap', 'disabledDefaultPhrases', 'dailyWords',
    'dailyWordDate', 'dailyWordCount', 'tooltipTheme', 'showFloatBall', 'enableSelToolbar',
    'enableHoverPreview', 'enableInputTranslate', 'customActions'
  ];

  const LEVEL_WEIGHTS = {
    all: 0,
    daily: 1,
    cet4: 2,
    cet6: 3,
    ielts: 4,
    graduate: 5
  };

  const LEVEL_LABELS = {
    daily: '日常',
    cet4: 'CET-4',
    cet6: 'CET-6',
    ielts: 'IELTS',
    graduate: '考研',
    all: '通用'
  };

  const MODE_LABELS = {
    replace: '替换学习',
    annotate: '标注学习',
    translate: '对比翻译',
    off: '已关闭'
  };

  const POS_LABEL = {
    verb: 'v.',
    noun: 'n.',
    adjective: 'adj.',
    adverb: 'adv.',
    conjunction: 'conj.',
    preposition: 'prep.',
    pronoun: 'pron.',
    phrase: 'phr.',
    interjection: 'int.',
    determiner: 'det.'
  };

  const POS_CN = {
    verb: '动词',
    noun: '名词',
    adjective: '形容词',
    adverb: '副词',
    conjunction: '连词',
    preposition: '介词',
    pronoun: '代词',
    phrase: '短语',
    interjection: '感叹词',
    determiner: '限定词'
  };

  const SKIP_SINGLE = new Set([
    '的','了','是','在','和','就','都','而','及','等','与','或','被','把',
    '对','从','向','到','让','上','下','中','也','不','这','那','人','我','他','她','们',
    '一','二','三','四','五','六','七','八','九','十','百','千','万','亿',
    '个','只','条','种','些','点','几','何','吗','呢','吧','啊','哦','嗯',
    '又','再','还','已','曾','刚','才','正','将','要','会','能','可',
    '以','为','之','其','所','者','于','因','但','若','虽','然','没','有','很','太','最','更'
  ]);

  const SCENE_KEYS = {
    social:   ['daily', 'verb', 'adj', 'adv', 'emotion'],
    academic: ['abstract', 'academic', 'graduate', 'noun', 'cet6', 'ielts'],
    tech:     ['tech', 'cet6', 'verb', 'noun'],
    general:  []
  };

  const constants = {
    VERSION,
    LOCAL_KEYS,
    PROVIDER_PRESETS,
    DEFAULT_PHRASE_MAP,
    DEFAULTS,
    IMPORT_ALLOWED_KEYS,
    LEVEL_WEIGHTS,
    LEVEL_LABELS,
    MODE_LABELS,
    POS_LABEL,
    POS_CN,
    SKIP_SINGLE,
    SCENE_KEYS
  };

  IFLL.constants = constants;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = constants;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
