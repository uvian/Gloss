#!/usr/bin/env python3
"""
IFLL Wordbank Cleaner & Builder
Reads raw wordbank entries (from legacy src/lib/wordbank.js or src/data/wordbank.json),
cleans corrupted entries, fixes POS / IPA / duplicates / levels, and outputs
compact, verified src/data/wordbank.json.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEGACY_JS = ROOT / "src" / "lib" / "wordbank.js"
OUT_JSON = ROOT / "src" / "data" / "wordbank.json"

POS_NORMALIZE = {
    "noun": ("noun", "名词"),
    "verb": ("verb", "动词"),
    "adjective": ("adjective", "形容词"),
    "adj": ("adjective", "形容词"),
    "adverb": ("adverb", "副词"),
    "adv": ("adverb", "副词"),
    "conjunction": ("conjunction", "连词"),
    "conj": ("conjunction", "连词"),
    "preposition": ("preposition", "介词"),
    "prep": ("preposition", "介词"),
    "pronoun": ("pronoun", "代词"),
    "phrase": ("phrase", "短语"),
    "interjection": ("interjection", "感叹词"),
    "determiner": ("determiner", "限定词"),
}

# Explicit fixes for known corrupted / awkward entries
ZH_DROP = {
    "的", "地", "得", "过", "吧", "顿", "封", "趟", "条", "篇", "双",
    "GDP", "所以他们", "换句话说这意味着", "换句话说吧", "事实上说",
    "大酒桶",  # mapped to 'butt'
}

ZH_RENAME = {
    "外围的的": "外围的",
}

EN_FIX = {
    "afterall": "after all",
    "rice/meal": "meal",
    "class/lesson": "lesson",
    "think/want": "think",
    "at/in": "at",
    "and/with": "with",
    "and/as well as": "as well as",
    "by/from": "from",
    "in/at/on": "in",
    "still/yet": "still",
    "just/right": "just",
    "can/may": "may",
    "will/can": "will",
    "can/be able": "can",
    "may/can": "can",
    "hit/strike": "strike",
    "let/allow": "allow",
    "poor/inferior": "inferior",
    "hold/conduct": "host",
    "fall/drop": "drop",
    "draw/paint": "paint",
    "festival/section": "festival",
    "borrow/lend": "borrow",
    "lift/raise": "raise",
    "afraid/fear": "afraid",
    "piece/cube": "piece",
    "do/manage": "handle",
    "clap/pat": "pat",
    "touch/bump": "touch",
    "front/before": "front",
    "take/get": "fetch",
    "but/yet": "yet",
    "think/believe": "believe",
    "ripe/cooked": "ripe",
    "smooth/along": "smooth",
    "carry/raise": "lift",
    "quite/rather": "quite",
    "open/through": "through",
    "remove/take off": "remove",
    "position/seat": "seat",
    "Mr./gentleman": "gentleman",
    "like/resemble": "resemble",
    "heart/mind": "mind",
    "letter/mail": "letter",
    "OK/able": "okay",
    "pick/pluck": "pick",
    "shine/reflect": "shine",
    "point/finger": "point",
    "kind/type": "type",
    "grab/catch": "grab",
    "earn/make money": "earn",
    "thin/sparse": "sparse",
    "do/make": "make",
    "bake/roast": "roast",
}

# Known specific POS overrides for entries mislabeled in bulk imports
EN_POS_FIX = {
    "cathedral": "noun",
    "surgeon": "noun",
    "burglar": "noun",
    "calorie": "noun",
    "mansion": "noun",
    "steak": "noun",
    "outcry": "noun",
    "majority": "noun",
    "massacre": "noun",
    "multitude": "noun",
    "pressure": "noun",
    "catastrophe": "noun",
    "gorilla": "noun",
    "thigh": "noun",
    "prairie": "noun",
    "barley": "noun",
    "astronomy": "noun",
    "overpass": "noun",
    "velvet": "noun",
    "dysfunction": "noun",
    "fertility": "noun",
    "overcharge": "verb",
    "exotic": "adjective",
    "redundant": "adjective",
    "versatile": "adjective",
    "windy": "adjective",
    "metropolitan": "adjective",
    "dizzy": "adjective",
    "bound": "adjective",
    "consistent": "adjective",
    "generic": "adjective",
    "triple": "adjective",
    "triangular": "adjective",
    "upward": "adjective",
    "superior": "adjective",
    "upper": "adjective",
    "nasty": "adjective",
    "inferior": "adjective",
    "rainy": "adjective",
    "peripheral": "adjective",
    "mountainous": "adjective",
    "substantial": "adjective",
    "continental": "adjective",
    "astronomical": "adjective",
    "dramatically": "adverb",
    "descendant": "noun",
}

# Suffix patterns strongly indicating English POS when entry was bulk-imported as noun
ADJ_SUFFIXES = (
    "ous", "ful", "less", "able", "ible", "ive", "ic", "ical",
    "ish", "ary", "ory", "ant", "ent", "al", "ar",
)
ADV_SUFFIXES = ("ly",)

# Nouns whose zh ends in 的 (genuine nouns, NOT adjectives)
ZH_DE_NOUNS = {"目的", "标的", "的士"}

# Words whose stressed syllable genuinely contains /ʌ/ in a non-first syllable
STRESSED_CARET_ROOTS = (
    "struct", "duct", "rupt", "sult", "just", "trust", "gust", "luct",
    "fund", "cuss", "judge", "brush", "rush", "touch", "rough", "tough",
    "nough", "bove", "mong", "front", "come", "done", "love", "cover",
    "other", "mother", "brother", "young", "tongue", "struck", "stuck",
    "luck", "buck", "duck", "truck", "pub", "bund", "dund", "plund",
    "stun", "run", "sun", "fun", "gun", "pun", "up", "cut", "shut",
    "adult", "occult", "rebut", "unjust", "distrust", "entrust",
    "abrupt", "corrupt", "disrupt", "erupt", "interrupt", "bankrupt",
    "construct", "instruct", "destruct", "obstruct", "conduct", "deduct",
    "abduct", "induct", "reluctant", "redundant", "abundant", "republic",
    "discuss", "percuss", "repercuss", "result", "consult", "insult",
    "exult", "adjust", "disgust", "above", "among", "enough", "become",
    "overcome", "discover", "recover", "uncover", "another", "confront",
    "affront", "refund", "succumb", "benumb", "outnumber", "encumber",
)

# First-syllable stressed /ʌ/ words (keep /ʌ/ in first syllable)
FIRST_SYL_STRESSED_CARET = {
    "color", "colour", "comfort", "company", "couple", "cousin", "country",
    "cover", "courage", "custom", "customer", "culture", "current", "currency",
    "curtain", "butter", "button", "budget", "bucket", "bubble", "buffer",
    "bundle", "burden", "double", "trouble", "public", "publish", "punish",
    "puppet", "puppy", "puzzle", "summer", "summit", "summary", "sunday",
    "sunny", "sunset", "sunshine", "supper", "suffer", "subtle", "subject",
    "substance", "subsidy", "suburb", "subway", "sudden", "number", "nuclear",
    "hundred", "hungry", "hunter", "humble", "humor", "humour", "husband",
    "hurry", "under", "upper", "utter", "ugly", "ultra", "uncle", "other",
    "mother", "brother", "money", "monkey", "monday", "month", "monthly",
    "nothing", "honey", "hover", "govern", "government", "governor", "glove",
    "lovely", "lover", "dozen", "onion", "oven", "southern", "stomach",
    "study", "student", "studio", "stumble", "struggle", "structure", "thunder",
    "thumb", "tunnel", "tumble", "turkey", "turtle", "muscle", "mushroom",
    "mustard", "mutter", "mutual", "rubber", "rubbish", "rudder", "rugged",
    "rumor", "rumour", "runner", "rural", "rustic", "cluster", "clumsy",
    "clutch", "crumble", "crunch", "crust", "flutter", "frustrate", "function",
    "funny", "jungle", "junior", "justice", "justify", "luxury", "luggage",
    "lumber", "lucky", "lunch", "luster", "lustre", "multiply", "multiple",
    "multitude", "mumble", "plunge", "plumber", "puppet", "purple", "purpose",
    "purchase", "pursue", "scuffle", "sculpture", "shuttle", "shutter",
    "slumber", "smuggle", "snuggle", "sputter", "stutter", "sullen", "sulphur",
    "sulfur", "summon", "supple", "surplus", "trumpet", "truffle", "tussle",
    "ultimate", "umbrella", "umpire", "upward", "upwards", "upbeat", "update",
    "upgrade", "uphill", "uphold", "upland", "upload", "upright", "uprising",
    "uproar", "upset", "upside", "upstairs", "upstream", "uptown", "upbringing",
    "vulgar", "vulnerable", "wonder", "wonderful", "worry", "worship",
    "worthy", "worthy", "younger", "youngest", "cutlery", "cupboard",
    "current", "curriculum", "cushion", "custody", "cutback", "cutoff",
    "judgment", "judgement", "junction", "juncture", "bucket", "buckle",
    "buffalo", "buffet", "buggy", "bulky", "bullet", "bulletin", "bully",
    "bumper", "bunch", "bungalow", "bunker", "buoyant", "burlap", "burly",
    "burnish", "burrow", "bustle", "butcher", "butler", "buttress",
    "chuckle", "clutter", "cuddle", "culprit", "cultivate", "cumbersome",
    "cunning", "cupcake", "curdle", "curfew", "curious", "curly", "currant",
    "curry", "cursor", "cursory", "curtail", "custard", "cuttlefish",
    "dubble", "duchess", "ductile", "duffel", "dullard", "dummy", "dumpling",
    "dungeon", "fluctuate", "fluffy", "flurry", "fluster", "fumble",
    "fundamental", "funeral", "fungus", "funnel", "furious", "furlough",
    "furnace", "furnish", "furniture", "furrow", "further", "furthermore",
    "fury", "fussy", "futile", "future", "fuzzy", "glutton", "grumble",
    "grumpy", "gully", "gumption", "gunfire", "gunpowder", "guppy", "gurgle",
    "gusset", "gusto", "gusty", "gutter", "guzzle", "huddle", "huffy",
    "hulk", "hullabaloo", "human", "humane", "humanity", "humid", "humiliate",
    "humility", "hummock", "humpback", "humus", "hunchback", "hunger",
    "hurdle", "hurl", "hurricane", "hurried", "hurtful", "hurtle", "husk",
    "husky", "hussar", "hustle", "hutch", "juggle", "jugular", "juicy",
    "jumble", "jumbo", "jumper", "jumpy", "juniper", "junket", "junkie",
    "junta", "juror", "jury", "justly", "juvenile", "knuckle", "lullaby",
    "lumbar", "luminous", "lumpish", "lumpy", "lunar", "lunatic", "luncheon",
    "lunge", "lupine", "lurch", "lurid", "luscious", "lush", "lustful",
    "lustrous", "lusty", "luxurious", "muddle", "muffin", "muffle", "muffler",
    "mufti", "mugger", "muggy", "mulberry", "mulch", "mule", "mull",
    "mulligan", "mullion", "mummy", "mumps", "munch", "mundane", "municipal",
    "munificent", "munition", "mural", "murder", "murderer", "murderous",
    "murky", "murmur", "muscular", "muse", "museum", "mush", "mushy",
    "music", "musical", "musician", "musk", "musket", "muskrat", "muslin",
    "mussel", "muster", "musty", "mutable", "mutant", "mutate", "mutation",
    "mute", "mutilate", "mutineer", "mutinous", "mutiny", "mutt", "mutton",
    "muzzle", "nudge", "nugget", "nuisance", "nullify", "numb", "numeral",
    "numeric", "numerical", "numerous", "numskull", "nunnery", "nuptial",
    "nurse", "nursery", "nurture", "nutcracker", "nutmeg", "nutrient",
    "nutriment", "nutrition", "nutritious", "nutshell", "nutty", "nuzzle",
    "plumage", "plumb", "plume", "plummet", "plump", "plunder", "plural",
    "plush", "plutocrat", "pucker", "pudding", "puddle", "pueblo", "puerile",
    "puff", "puffin", "puffy", "pugilist", "pugnacious", "puissant", "puke",
    "pulchritude", "pule", "pull", "pullet", "pulley", "pullover", "pulmonary",
    "pulp", "pulpit", "pulsate", "pulse", "pulverize", "puma", "pumice",
    "pummel", "pump", "pumpkin", "pun", "punch", "punctilious", "punctual",
    "punctuate", "puncture", "pundit", "pungent", "punitive", "punk",
    "punt", "puny", "pup", "pupa", "pupil", "purchaser", "pure", "puree",
    "purgative", "purgatory", "purge", "purify", "purist", "puritan",
    "purity", "purl", "purloin", "purport", "purposely", "purr", "purse",
    "purser", "pursuance", "pursuant", "pursuit", "purvey", "purveyor",
    "purview", "pus", "push", "pushover", "pushy", "pusillanimous", "puss",
    "pussy", "pustule", "put", "putative", "putrefy", "putrescent", "putrid",
    "putsch", "putt", "putter", "putty", "rucksack", "ruckus", "ruction",
    "ruddy", "rude", "rudiment", "rudimentary", "rue", "rueful", "ruff",
    "ruffian", "ruffle", "rug", "rugby", "ruin", "ruination", "ruinous",
    "rule", "ruler", "ruling", "rum", "rumba", "rumble", "ruminant",
    "ruminate", "rummage", "rummy", "rump", "rumple", "rumpus", "run",
    "runaway", "rundown", "rune", "rung", "runnel", "running", "runny",
    "runt", "runway", "rupee", "rupture", "ruse", "rush", "rusk", "russet",
    "rust", "rustle", "rustler", "rusty", "rut", "rutabaga", "ruthless",
    "scud", "scuff", "scull", "scullery", "sculpt", "sculptor", "scum",
    "scupper", "scurf", "scurrilous", "scurry", "scurvy", "scuttle",
    "shuck", "shudder", "shuffle", "shun", "shunt", "shush", "shut",
    "shutdown", "shutout", "skulk", "skull", "skunk", "sludge", "slug",
    "sluggard", "sluggish", "sluice", "slum", "slump", "slur", "slurp",
    "slurry", "slush", "slushy", "smudge", "smug", "smut", "smutty",
    "snub", "snuff", "snuffle", "snug", "snugly", "stub", "stubble",
    "stubborn", "stucco", "stud", "stuffed", "stuffy", "stump", "stumpy",
    "stun", "stunt", "stupefy", "stupendous", "stupid", "stupidity",
    "stupor", "sturdy", "sturgeon", "stygian", "subdue", "subjugate",
    "sublime", "submarine", "submerge", "submit", "subordinate", "subpoena",
    "subscribe", "subsequent", "subservient", "subside", "subsidize",
    "subsist", "substantial", "substantiate", "substitute", "subterfuge",
    "subterranean", "subtract", "subtropical", "suburban", "subvert",
    "succeed", "success", "successful", "succession", "successive", "successor",
    "succinct", "succor", "succulent", "such", "suck", "sucker", "suckle",
    "suction", "sudorific", "suds", "sue", "suede", "suet", "suffice",
    "sufficient", "suffix", "suffocate", "suffrage", "suffragist", "suffuse",
    "sugar", "suggest", "suggestion", "suggestive", "suicidal", "suicide",
    "suit", "suitable", "suitcase", "suite", "suitor", "sulk", "sulky",
    "sully", "sultan", "sultana", "sultry", "sum", "sumac", "summarize",
    "sump", "sumptuous", "sun", "sunbeam", "sunburn", "sundae", "sunder",
    "sundial", "sundown", "sundry", "sunflower", "sunglasses", "sunken",
    "sunlight", "sunlit", "sunrise", "sunscreen", "sunstroke", "suntan",
    "sup", "super", "superb", "supercilious", "superficial", "superfluous",
    "superhuman", "superimpose", "superintend", "superior", "superlative",
    "supermarket", "supernatural", "supernova", "supernumerary", "supersede",
    "supersonic", "superstition", "superstitious", "superstructure", "supervise",
    "supervisor", "supervisory", "supine", "supplant", "supplement", "suppliant",
    "supplicate", "supply", "support", "suppose", "supposedly", "supposition",
    "suppress", "suppression", "suppurate", "supranational", "supremacy",
    "supreme", "surcharge", "sure", "surely", "surety", "surf", "surface",
    "surfboard", "surfeit", "surge", "surgeon", "surgery", "surgical",
    "surly", "surmise", "surmount", "surname", "surpass", "surplice",
    "surprise", "surreal", "surrealism", "surrender", "surreptitious",
    "surrey", "surrogate", "surround", "surrounding", "surtax", "surveillance",
    "survey", "surveyor", "survival", "survive", "survivor", "susceptible",
    "suspect", "suspend", "suspender", "suspense", "suspension", "suspicion",
    "suspicious", "sustain", "sustenance", "suture", "suzerain",
    "thud", "thug", "thump", "thus", "thwack", "thwart", "tuck", "tuft",
    "tug", "tugboat", "tuition", "tulip", "tulle", "tumbler", "tumbrel",
    "tumescent", "tumid", "tummy", "tumor", "tumour", "tumult", "tumultuous",
    "tumulus", "tun", "tuna", "tundra", "tune", "tuneful", "tuner",
    "tungsten", "tunic", "turban", "turbid", "turbine", "turbojet",
    "turbot", "turbulence", "turbulent", "tureen", "turf", "turgid",
    "turmoil", "turn", "turncoat", "turndown", "turner", "turning",
    "turnip", "turnkey", "turnout", "turnover", "turnpike", "turnstile",
    "turntable", "turpentine", "turpitude", "turquoise", "turret", "turtledove",
    "turtleneck", "tusk", "tut", "tutelage", "tutor", "tutorial", "tutu",
    "tuxedo", "udder", "ukulele", "ulcer", "ulcerate", "ulcerous", "ulna",
    "ulster", "ulterior", "ultimatum", "ultramarine", "ultrasonic",
    "ultraviolet", "ululate", "umbel", "umber", "umbilical", "umbilicus",
    "umbra", "umbrage", "umlaut", "unanimous", "unassuming", "unaware",
    "unawares", "unbalanced", "unbearable", "unbecoming", "unbelievable",
    "unbend", "unbiased", "unbidden", "unbind", "unblemished", "unblushing",
    "unborn", "unbosom", "unbounded", "unbridled", "unbroken", "unbuckle",
    "unburden", "unbutton", "uncalled", "uncanny", "unceasing", "uncertain",
    "uncertainty", "uncharted", "unchecked", "uncivil", "unclad", "unclasp",
    "unclean", "uncloak", "unclose", "unclothe", "unclouded", "uncoil",
    "uncomfortable", "uncommon", "uncompromising", "unconcern", "unconditional",
    "unconscionable", "unconscious", "unconstitutional", "uncontrollable",
    "unconventional", "uncork", "uncounted", "uncouple", "uncouth", "uncover",
    "unction", "unctuous", "uncut", "undaunted", "undecided", "undeniable",
    "underarm", "underbelly", "underbid", "underbrush", "undercarriage",
    "undercharge", "underclass", "underclothes", "undercoat", "undercover",
    "undercurrent", "undercut", "underdeveloped", "underdog", "underdone",
    "underestimate", "underexpose", "underfed", "underfoot", "undergarment",
    "undergo", "undergrad", "undergraduate", "underground", "undergrowth",
    "underhand", "underhanded", "underlay", "underlie", "underline",
    "underling", "underlying", "undermine", "underneath", "undernourished",
    "underpaid", "underpants", "underpass", "underpay", "underpin",
    "underpinning", "underplay", "underprivileged", "underrate", "underscore",
    "undersea", "undersecretary", "undersell", "undershirt", "underside",
    "undersigned", "undersized", "underskirt", "understand", "understanding",
    "understate", "understatement", "understudy", "undertake", "undertaker",
    "undertaking", "undertone", "undertow", "undervalue", "underwater",
    "underwear", "underweight", "underwent", "underworld", "underwrite",
    "underwriter", "undesirable", "undies", "undivided", "undo", "undoing",
    "undone", "undoubted", "undress", "undue", "undulate", "undulation",
    "unduly", "undying", "unearth", "unearthly", "unease", "uneasy",
    "uneducated", "unemployed", "unemployment", "unending", "unequal",
    "unequaled", "unequivocal", "unerring", "uneven", "uneventful",
    "unexampled", "unexceptionable", "unexpected", "unfailing", "unfair",
    "unfaithful", "unfaltering", "unfamiliar", "unfashionable", "unfasten",
    "unfathomable", "unfavorable", "unfeeling", "unfeigned", "unfettered",
    "unfinished", "unfit", "unflagging", "unflappable", "unflinching",
    "unfold", "unforeseen", "unforgettable", "unforgivable", "unfortunate",
    "unfounded", "unfriendly", "unfrock", "unfurl", "unfurnished", "ungainly",
    "ungodly", "ungovernable", "ungracious", "ungrateful", "ungrounded",
    "unguarded", "unguent", "unhallowed", "unhand", "unhappy", "unharmed",
    "unhealthy", "unheard", "unheeded", "unhesitating", "unhinge", "unholy",
    "unhook", "unhorse", "unhurt", "unicorn", "unicycle", "unification",
    "uniform", "uniformity", "unify", "unilateral", "unimpeachable",
    "unimportant", "uninformed", "uninhabited", "uninhibited", "uninjured",
    "uninspired", "unintelligible", "unintended", "unintentional",
    "uninterested", "uninterrupted", "uninvited", "union", "unionize",
    "unique", "unison", "unit", "unitary", "unite", "united", "unity",
    "univalent", "universal", "universe", "university", "unjointed", "unjust",
    "unkempt", "unkind", "unknowing", "unknown", "unlace", "unlatch",
    "unlawful", "unlearn", "unleash", "unleavened", "unless", "unlettered",
    "unlike", "unlikely", "unlimited", "unlisted", "unload", "unlock",
    "unlooked", "unloose", "unloosen", "unlucky", "unmake", "unman",
    "unmanageable", "unmanly", "unmanned", "unmannerly", "unmarked",
    "unmarried", "unmask", "unmatched", "unmeaning", "unmeasured", "unmentionable",
    "unmerciful", "unmindful", "unmistakable", "unmitigated", "unmixed",
    "unmolested", "unmoor", "unmoral", "unmoved", "unmuffle", "unnatural",
    "unnecessary", "unnerve", "unnoticed", "unnumbered", "unobjectionable",
    "unobservable", "unobservant", "unobserved", "unobstructed", "unobtainable",
    "unobtrusive", "unoccupied", "unofficial", "unopened", "unopposed",
    "unorganized", "unorthodox", "unpack", "unpaid", "unpalatable",
    "unparalleled", "unpardonable", "unparliamentary", "unperturbed",
    "unpick", "unpin", "unplaced", "unplanned", "unpleasant", "unplug",
    "unplumbed", "unpolished", "unpolluted", "unpopular", "unpracticed",
    "unprecedented", "unpredictable", "unprejudiced", "unpremeditated",
    "unprepared", "unprepossessing", "unpretentious", "unprincipled",
    "unprintable", "unprivileged", "unproductive", "unprofessional",
    "unprofitable", "unpromising", "unprompted", "unpronounceable",
    "unpropitious", "unprotected", "unproved", "unproven", "unprovided",
    "unprovoked", "unpublished", "unpunished", "unqualified", "unquenchable",
    "unquestionable", "unquestioned", "unquestioning", "unquiet", "unquote",
    "unravel", "unread", "unreadable", "unready", "unreal", "unrealistic",
    "unreasonable", "unreasoning", "unrecognizable", "unrecognized",
    "unreconciled", "unrecorded", "unredeemed", "unrefined", "unreflecting",
    "unreformed", "unregarded", "unregenerate", "unregistered", "unregulated",
    "unrehearsed", "unrelated", "unrelenting", "unreliable", "unrelieved",
    "unremarkable", "unremitting", "unremunerative", "unrepeatable",
    "unrepentant", "unreported", "unrepresentative", "unrepresented",
    "unrequited", "unreserved", "unresisting", "unresolved", "unresponsive",
    "unrest", "unrestrained", "unrestricted", "unrewarded", "unrewarding",
    "unrighteous", "unripe", "unrivaled", "unroll", "unromantic", "unruffled",
    "unruly", "unsaddle", "unsafe", "unsaid", "unsalable", "unsalted",
    "unsanctified", "unsanitary", "unsatisfactory", "unsatisfied", "unsavory",
    "unsay", "unscathed", "unscheduled", "unschooled", "unscientific",
    "unscramble", "unscrew", "unscripted", "unscrupulous", "unseal",
    "unsearchable", "unseasonable", "unseasoned", "unseat", "unseeing",
    "unseemly", "unseen", "unselfish", "unsentimental", "unsettle", "unsettled",
    "unshackle", "unshaded", "unshakable", "unshaken", "unshaped", "unshapely",
    "unshaven", "unsheathe", "unshielded", "unshifted", "unshod", "unshorn",
    "unsightly", "unsigned", "unsinkable", "unskilled", "unskillful",
    "unsmiling", "unsnap", "unsnarl", "unsociable", "unsocial", "unsoiled",
    "unsold", "unsolder", "unsolicited", "unsolved", "unsophisticated",
    "unsorted", "unsought", "unsound", "unsparing", "unspeakable",
    "unspecified", "unspectacular", "unspent", "unspoiled", "unspoilt",
    "unspoken", "unsportsmanlike", "unspotted", "unstable", "unstained",
    "unstamped", "unstandardized", "unsteadiness", "unsteady", "unstick",
    "unstinted", "unstinting", "unstitch", "unstop", "unstoppable",
    "unstrained", "unstrap", "unstratified", "unstressed", "unstring",
    "unstructured", "unstrung", "unstuck", "unstudied", "unsubstantial",
    "unsubstantiated", "unsubtle", "unsuccessful", "unsuitable", "unsuited",
    "unsullied", "unsung", "unsupervised", "unsupportable", "unsupported",
    "unsure", "unsurmountable", "unsurpassed", "unsuspected", "unsuspecting",
    "unsustainable", "unswayed", "unsweetened", "unswept", "unswerving",
    "unsymmetrical", "unsympathetic", "unsystematic", "untainted", "untalented",
    "untamed", "untangle", "untapped", "untarnished", "untasted", "untaught",
    "untaxed", "unteachable", "untenable", "untenanted", "untended",
    "untested", "untether", "unthankful", "unthinkable", "unthinking",
    "unthought", "unthread", "unthrift", "unthrifty", "untidy", "untie",
    "until", "untimely", "untiring", "untitled", "unto", "untold", "untouchable",
    "untouched", "untoward", "untraceable", "untracked", "untrained",
    "untrammeled", "untranslatable", "untraveled", "untreated", "untried",
    "untrimmed", "untrod", "untrodden", "untroubled", "untrue", "untrustworthy",
    "untruth", "untruthful", "untuck", "untufted", "untuned", "untutored",
    "untwine", "untwist", "unusable", "unused", "unusual", "unutterable",
    "unvarnished", "unvarying", "unveil", "unventilated", "unverifiable",
    "unverified", "unversed", "unvisited", "unvoiced", "unwanted",
    "unwarranted", "unwary", "unwashed", "unwatched", "unwatered", "unwavering",
    "unweaned", "unwearied", "unwed", "unweeded", "unwelcome", "unwell",
    "unwept", "unwholesome", "unwieldy", "unwilling", "unwind", "unwise",
    "unwished", "unwitting", "unwonted", "unworkable", "unworldly", "unworn",
    "unworried", "unworthy", "unwound", "unwoven", "unwrap", "unwrinkled",
    "unwritten", "unwrought", "unyielding", "unyoke", "unzip",
}

STRESSED_ER_ENDINGS = (
    "prefer", "refer", "occur", "confer", "infer", "defer", "transfer",
    "deter", "inter", "demur", "recur", "incur", "concur", "aver",
    "amateur", "connoisseur", "entrepreneur", "chauffeur", "saboteur",
)

VOWEL_RE = re.compile(r"(?:ɑː|ɔː|ɜːr|iː|uː|aɪ|aʊ|eɪ|oʊ|ɔɪ|æ|ɛ|ɪ|ʊ|ʌ|ə)")


def fix_ipa(en: str, ipa: str) -> str:
    """Repair systematic ARPABET->IPA errors from stress-stripped CMU conversion."""
    if not ipa:
        return ""
    raw = ipa.strip().strip("/")
    if not raw:
        return ""
    word = en.strip().lower()
    # Multi-word phrases: keep as-is except obvious final iː/ɜːr fixes
    if " " in word:
        return "/" + raw + "/"

    vowels = list(VOWEL_RE.finditer(raw))
    if len(vowels) <= 1:
        return "/" + raw + "/"

    chars = list(raw)
    # Build vowel spans for positional checks
    # 1) Repair unstressed /ʌ/ -> /ə/
    first_caret_stressed = (
        word in FIRST_SYL_STRESSED_CARET
        or (word.startswith(("un", "up", "sub", "pub", "num", "sum", "fun", "run", "sun", "hun", "bun", "cut", "but", "mud", "rud", "stud", "strug", "struc", "plun", "blun", "clun", "crun", "drunk", "shrug", "smug", "snug", "thun", "trun", "tumb", "mumb", "humb", "fumb", "jumb", "lumb", "numb", "rumb", "stumb", "cumb")) and not word.startswith(("until", "unless", "upon", "unite", "unit", "univ", "uniq", "union")))
    )
    has_stressed_caret_root = any(r in word for r in STRESSED_CARET_ROOTS)

    result = raw
    # Replace vowel nuclei carefully by iterating matches from right to left
    spans = [(m.start(), m.end(), m.group(0)) for m in VOWEL_RE.finditer(result)]
    total_v = len(spans)
    pieces = []
    last = 0
    for idx, (s, e, v) in enumerate(spans):
        pieces.append(result[last:s])
        new_v = v
        if v == "ʌ":
            if idx == 0:
                if not first_caret_stressed:
                    # First syllable /ʌ/ in words like today, tomorrow, ability, condition, support, phenomenon, majority
                    new_v = "ə"
            else:
                # Non-first syllable /ʌ/ is almost always schwa unless a known stressed root
                if idx == total_v - 1:
                    # Final syllable is almost never stressed /ʌ/ unless root ends the word
                    if not (has_stressed_caret_root and any(word.endswith(r) for r in ("struct", "duct", "rupt", "sult", "just", "trust", "gust", "fund", "cuss", "judge", "touch", "rough", "tough", "nough", "bove", "mong", "front", "come", "done", "love", "adult", "occult", "rebut", "succumb", "benumb", "up", "cut", "shut", "run", "sun", "fun", "gun"))):
                        new_v = "ə"
                else:
                    if not has_stressed_caret_root:
                        new_v = "ə"
        elif v == "ɜːr":
            # Multi-syllable unstressed r-colored vowel -> ər
            if idx == total_v - 1 and not word.endswith(STRESSED_ER_ENDINGS):
                new_v = "ər"
            elif idx == 0 and word.startswith(("per", "pur", "sur", "for", "her")) and not word.startswith(("person", "perfect", "perman", "purchas", "purple", "purpos", "surfac", "surger", "surgeo", "surplu", "furnit", "furnac", "furthe", "herba", "herbi", "hermit")):
                new_v = "ər"
            elif 0 < idx < total_v - 1 and not any(root in word for root in ("serv", "vers", "vert", "cert", "term", "firm", "turn", "burn", "curt", "merc", "nerv", "herb", "verb", "work", "worl", "wors", "wort", "circ", "thir", "firs", "birt", "girt", "dirt", "shir", "skir", "swir", "twir", "whir", "chir", "blur", "slur", "spur", "curb", "curl", "curv", "hurl", "furl", "purl", "surf", "turf", "turk", "turt", "murm", "murd", "burd", "burg", "burl", "burp", "burs", "chur", "lurk", "lurc", "murk", "nurs", "purs", "scur", "turg", "turm", "urg", "urb")):
                new_v = "ər"
        elif v == "iː" and idx == total_v - 1 and e == len(result):
            # Final unstressed -y / -ie / -ey in multi-syllable words: /fæməli/, /sɪti/
            if word.endswith(("y", "ie", "ey")) and not word.endswith(("ee", "ea", "key", "ski", "agree", "degree", "referee", "employee", "trustee", "guarantee", "committee")):
                new_v = "i"
        pieces.append(new_v)
        last = e
    pieces.append(result[last:])
    return "/" + "".join(pieces) + "/"


# Curated academic / high-frequency IELTS vocabulary set to ensure IELTS band has real coverage
IELTS_CATS = {"academic", "abstract", "society", "nature", "business", "tech", "logic"}


def load_raw_entries():
    if LEGACY_JS.exists():
        js = (
            'const fs = require("fs");'
            f'const code = fs.readFileSync({json.dumps(str(LEGACY_JS))}, "utf8");'
            'const { WORD_BANK } = new Function(code + "; return { WORD_BANK };")();'
            'process.stdout.write(JSON.stringify(WORD_BANK));'
        )
        res = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True)
        return json.loads(res.stdout)
    elif OUT_JSON.exists():
        with open(OUT_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    raise FileNotFoundError("Neither legacy wordbank.js nor wordbank.json found.")


def score_entry_richness(entry: dict) -> int:
    score = 0
    if entry.get("example") or entry.get("examples"):
        score += 10
    if entry.get("def") and entry["def"].strip().lower() != entry.get("en", "").strip().lower():
        score += 5
    if entry.get("ipa"):
        score += 3
    if entry.get("cat") not in ("cet4", "cet6", "graduate", ""):
        score += 2
    return score


def clean_pos(zh: str, en: str, pos: str, pos_cn: str):
    en_low = en.lower().strip()
    if zh.endswith("的") and zh not in ZH_DE_NOUNS:
        return POS_NORMALIZE["adjective"]
    if en_low in EN_POS_FIX:
        p = EN_POS_FIX[en_low]
        return POS_NORMALIZE[p]
    norm = POS_NORMALIZE.get((pos or "").lower().strip())
    if norm:
        p, pcn = norm
    else:
        p, pcn = ("noun", "名词")

    # Fix adverbs whose Chinese ends in '地' and English ends in -ly
    if zh.endswith("地") and en_low.endswith("ly") and p == "noun":
        p, pcn = ("adverb", "副词")

    # Phrase detection
    if " " in en_low and p not in ("phrase", "verb", "noun", "adverb", "conjunction"):
        p, pcn = ("phrase", "短语")
    return p, pcn


def clean_wordbank(raw_entries: list[dict]) -> list[dict]:
    by_zh: dict[str, dict] = {}
    dropped = 0

    for item in raw_entries:
        zh = (item.get("zh") or "").strip()
        en = (item.get("en") or "").strip()
        if not zh or not en:
            dropped += 1
            continue
        if zh in ZH_DROP:
            dropped += 1
            continue
        zh = ZH_RENAME.get(zh, zh)

        # Skip non-Chinese headwords or meta-linguistic explanations
        if not re.search(r"[\u4e00-\u9fff]", zh):
            dropped += 1
            continue
        if re.search(r"\b(?:particle|measure word|suffix|prefix)\b|\(measure\)", en, re.I):
            dropped += 1
            continue

        # Fix slash-polluted English
        if en in EN_FIX:
            en = EN_FIX[en]
        elif "/" in en:
            en = en.split("/")[0].strip()

        # Skip overly long / malformed zh (> 6 chars) unless genuine phrase
        if len(zh) > 6:
            dropped += 1
            continue

        pos, pos_cn = clean_pos(zh, en, item.get("pos", ""), item.get("pos_cn", ""))

        # Clean definition: omit redundant def === en
        raw_def = (item.get("def") or "").strip()
        if raw_def.lower() == en.lower():
            raw_def = ""

        # Clean examples
        examples = []
        examples_cn = []
        if isinstance(item.get("examples"), list) and item["examples"]:
            examples = [str(x).strip() for x in item["examples"] if str(x).strip()]
            if isinstance(item.get("examplesCn"), list):
                examples_cn = [str(x).strip() for x in item["examplesCn"]]
        elif item.get("example"):
            examples = [str(item["example"]).strip()]
            if item.get("example_cn"):
                examples_cn = [str(item["example_cn"]).strip()]

        # Normalize level & populate IELTS band meaningfully
        level = (item.get("level") or "cet4").strip().lower()
        cat = (item.get("cat") or "").strip().lower()
        if level not in ("all", "daily", "cet4", "cet6", "ielts", "graduate"):
            level = "cet4"

        # Clean IPA
        ipa = fix_ipa(en, item.get("ipa") or "")

        cleaned = {
            "zh": zh,
            "en": en,
            "pos": pos,
            "pos_cn": pos_cn,
            "level": level,
        }
        if cat:
            cleaned["cat"] = cat
        if ipa:
            cleaned["ipa"] = ipa
        if raw_def:
            cleaned["def"] = raw_def
        if examples:
            cleaned["examples"] = examples
            if examples_cn:
                cleaned["examplesCn"] = examples_cn

        # Deduplicate by zh: keep richer entry (and preserve ipa/examples from the other)
        if zh in by_zh:
            existing = by_zh[zh]
            if score_entry_richness(cleaned) > score_entry_richness(existing):
                if not cleaned.get("ipa") and existing.get("ipa"):
                    cleaned["ipa"] = existing["ipa"]
                if not cleaned.get("examples") and existing.get("examples"):
                    cleaned["examples"] = existing["examples"]
                    if existing.get("examplesCn"):
                        cleaned["examplesCn"] = existing["examplesCn"]
                by_zh[zh] = cleaned
            else:
                if not existing.get("ipa") and cleaned.get("ipa"):
                    existing["ipa"] = cleaned["ipa"]
                if not existing.get("def") and cleaned.get("def"):
                    existing["def"] = cleaned["def"]
        else:
            by_zh[zh] = cleaned

    entries = list(by_zh.values())

    # Assign genuine IELTS tier (~500 academic/high-band cet6+ words so IELTS level has strong coverage)
    ielts_count = sum(1 for e in entries if e["level"] == "ielts")
    if ielts_count == 0:
        for e in entries:
            if e["level"] == "cet6" and (
                e.get("cat") in IELTS_CATS
                or (len(e["en"]) >= 8 and " " not in e["en"] and e["pos"] in ("noun", "verb", "adjective", "adverb"))
            ):
                e["level"] = "ielts"
                ielts_count += 1
                if ielts_count >= 550:
                    break

    return entries


def main():
    raw = load_raw_entries()
    cleaned = clean_wordbank(raw)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, separators=(",", ":"))

    levels = {}
    pos_counts = {}
    schwa_count = 0
    ipa_count = 0
    for e in cleaned:
        levels[e["level"]] = levels.get(e["level"], 0) + 1
        pos_counts[e["pos"]] = pos_counts.get(e["pos"], 0) + 1
        if e.get("ipa"):
            ipa_count += 1
            if "ə" in e["ipa"]:
                schwa_count += 1

    size_kb = OUT_JSON.stat().st_size / 1024
    meta = {
        "total": len(cleaned),
        "ipaCount": ipa_count,
        "ipaCoverage": round(ipa_count * 100 / len(cleaned)) if cleaned else 0,
        "levels": levels,
    }
    meta_path = OUT_JSON.parent / "wordbank-meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Cleaned wordbank: {len(raw)} -> {len(cleaned)} entries ({size_kb:.1f} KB)")
    print(f"Levels: {levels}")
    print(f"POS: {pos_counts}")
    print(f"IPA coverage: {ipa_count}/{len(cleaned)} ({ipa_count*100/len(cleaned):.1f}%), with schwa: {schwa_count}")


if __name__ == "__main__":
    main()
