/**
 * Post-write rule-based validator.
 *
 * Deterministic, zero-LLM-cost checks that run after every chapter generation.
 * Catches violations that prompt-only rules cannot guarantee.
 */

import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { ChapterGoal, EndingHookType } from "../models/input-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";

export interface PostWriteViolation {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly description: string;
  readonly suggestion: string;
}

export interface EndingHookCheck {
  readonly expectedType: EndingHookType;
  readonly matched: boolean;
  readonly evidence?: string;
}

export interface PayoffCheck {
  readonly expectedPayoff: string;
  readonly matched: boolean;
  readonly evidence?: string;
}

export interface PostWriteDisciplineChecks {
  readonly endingHookCheck: EndingHookCheck;
  readonly payoffCheck: PayoffCheck;
}

export interface ResourceLedgerFinding {
  readonly kind: "consumption" | "recovery" | "growth" | "injury";
  readonly signal: string;
  readonly matched: boolean;
  readonly evidence: string;
  readonly expectedUpdate: string;
  readonly stateEvidence?: string;
}

export interface ResourceLedgerCheck {
  readonly matched: boolean;
  readonly findings: ReadonlyArray<ResourceLedgerFinding>;
  readonly warnings: ReadonlyArray<string>;
}

export interface HookDebtCheck {
  readonly activeCount: number;
  readonly cap: number;
  readonly newHooksOpened: number;
  readonly oldHooksAdvanced: number;
  readonly matched: boolean;
  readonly warnings: ReadonlyArray<string>;
}

interface ParagraphShape {
  readonly paragraphs: ReadonlyArray<string>;
  readonly shortThreshold: number;
  readonly shortParagraphs: ReadonlyArray<string>;
  readonly shortRatio: number;
  readonly averageLength: number;
  readonly maxConsecutiveShort: number;
}

const ENDING_HOOK_PATTERNS: Record<EndingHookType, ReadonlyArray<RegExp>> = {
  danger: [
    /危险|威胁|杀机|死路|压来|逼近|袭来|追上来|活不下去|撑不住/u,
    /danger|threat|closing in|bearing down|survival pressure|no way out/i,
  ],
  reveal: [
    /真相|秘密|身份|揭开|揭晓|原来|线索|发现|看清|道出|说破/u,
    /reveal|truth|secret|identity|clue|discovered|turned out/i,
  ],
  pursuit: [
    /追兵|追来|追上|追踪|追逃|封锁|咬上来|尾随/u,
    /pursuit|chase|tracked|tracking|closing the gap|hunters/i,
  ],
  choice: [
    /选择|抉择|取舍|两难|必须决定|只能选|要么|不得不决定/u,
    /choice|decision|must choose|either .* or|forced to decide|dilemma/i,
  ],
  breakthrough: [
    /突破|破境|晋阶|觉醒|掌握|领悟|蜕变|提升|新能力/u,
    /breakthrough|ascend|advanced|awakened|mastered|new ability|leveled up/i,
  ],
};

const RESOURCE_SIGNAL_RULES: ReadonlyArray<{
  readonly kind: ResourceLedgerFinding["kind"];
  readonly signal: string;
  readonly patterns: ReadonlyArray<RegExp>;
  readonly statePatterns: ReadonlyArray<RegExp>;
  readonly warningRule: string;
  readonly expectedUpdate: {
    readonly zh: string;
    readonly en: string;
  };
}> = [
  {
    kind: "consumption",
    signal: "qi-blood-consumption",
    patterns: [/气血.{0,8}(下降|减少|亏空|亏损|耗尽|消耗|骤降|暴跌)/u, /blood.*(drain|loss|spent|depleted|drop|plunge)/i],
    statePatterns: [/气血|血气|亏空|耗损|不足/u, /blood|vitality|drain|depleted/i],
    warningRule: "resource-ledger-missing-consumption",
    expectedUpdate: {
      zh: "需要在当前状态或资源账本中记录气血消耗/亏空。",
      en: "Record qi-blood loss or depletion in current state or resource ledger.",
    },
  },
  {
    kind: "consumption",
    signal: "shaqi-consumption",
    patterns: [/煞气.{0,8}(消耗|耗尽|减少|抽空|亏空)|强行催动.{0,8}煞气/u, /sha qi.*(spent|drain|depleted|reduced)|force.*sha qi/i],
    statePatterns: [/煞气|消耗|抽空|亏空/u, /sha qi|depleted|spent|drain/i],
    warningRule: "resource-ledger-missing-consumption",
    expectedUpdate: {
      zh: "需要在资源账本或状态中记录煞气消耗。",
      en: "Record sha-qi expenditure in the ledger or current state.",
    },
  },
  {
    kind: "injury",
    signal: "backlash-or-injury",
    patterns: [/强行催动|反噬|噬心之痛|五脏六腑受损|经脉.{0,6}(刺痛|震伤)|伤口.{0,6}(恶化|崩裂|加重)/u, /backlash|heart-rending pain|organs? damaged|meridians?.*(hurt|shaken)|wound.*(worsen|split|reopen)/i],
    statePatterns: [/伤势|伤口|经脉|反噬|受损|刺痛|震伤/u, /injury|wound|meridian|backlash|damaged|pain/i],
    warningRule: "resource-ledger-missing-injury-update",
    expectedUpdate: {
      zh: "需要在当前状态中同步伤势、反噬或经脉受损。",
      en: "Reflect injury, backlash, or meridian damage in current state.",
    },
  },
  {
    kind: "recovery",
    signal: "recovery",
    patterns: [/气血.{0,8}(恢复|回升)|煞气.{0,8}(补充|恢复|回升)|伤口.{0,8}(止血|愈合)|修复伤势|经脉.{0,8}恢复|体力.{0,8}回升/u, /blood.*recover|sha qi.*recover|wound.*(closed|stopped bleeding|healed)|recover(ed)? strength|meridians?.*recover/i],
    statePatterns: [/恢复|回升|止血|愈合|修复/u, /recover|restored|healed|stopped bleeding/i],
    warningRule: "resource-ledger-missing-recovery",
    expectedUpdate: {
      zh: "需要在当前状态或账本中体现恢复/修复结果。",
      en: "Reflect recovery or repair in current state or ledger.",
    },
  },
  {
    kind: "growth",
    signal: "growth",
    patterns: [/煞气.{0,8}(增加|暴涨|更盛)|境界.{0,8}(提升|突破)|掌握.{0,8}(新手段|新能力)|临时突破/u, /sha qi.*(increase|surge)|realm.*(advance|breakthrough)|mastered.*(ability|method)|temporary breakthrough/i],
    statePatterns: [/提升|突破|掌握|增加|更盛/u, /advance|breakthrough|mastered|increase|surge/i],
    warningRule: "resource-ledger-missing-growth-update",
    expectedUpdate: {
      zh: "需要在状态或账本中同步能力/资源增长。",
      en: "Reflect growth in ability or resources in state or ledger.",
    },
  },
];

// --- Marker word lists ---

/** AI转折/惊讶标记词 */
const SURPRISE_MARKERS = ["仿佛", "忽然", "竟然", "猛地", "猛然", "不禁", "宛如"];

/** 元叙事/编剧旁白模式 */
const META_NARRATION_PATTERNS = [
  /到这里[，,]?算是/,
  /接下来[，,]?(?:就是|将会|即将)/,
  /(?:后面|之后)[，,]?(?:会|将|还会)/,
  /(?:故事|剧情)(?:发展)?到了/,
  /读者[，,]?(?:可能|应该|也许)/,
  /我们[，,]?(?:可以|不妨|来看)/,
];

/** 分析报告式术语（禁止出现在正文中） */
const REPORT_TERMS = [
  "核心动机", "信息边界", "信息落差", "核心风险", "利益最大化",
  "当前处境", "行为约束", "性格过滤", "情绪外化", "锚定效应",
  "沉没成本", "认知共鸣",
];

/** 作者说教词 */
const SERMON_WORDS = ["显然", "毋庸置疑", "不言而喻", "众所周知", "不难看出"];

/** 全场震惊类集体反应 */
const COLLECTIVE_SHOCK_PATTERNS = [
  /(?:全场|众人|所有人|在场的人)[，,]?(?:都|全|齐齐|纷纷)?(?:震惊|惊呆|倒吸凉气|目瞪口呆|哗然|惊呼)/,
  /(?:全场|一片)[，,]?(?:寂静|哗然|沸腾|震动)/,
];

// --- Validator ---

export function validatePostWrite(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  languageOverride?: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];

  // Skip Chinese-specific rules for English content
  const isEnglish = (languageOverride ?? genreProfile.language) === "en";
  if (isEnglish) {
    // For English, only run book-specific prohibitions and paragraph length check
    return validatePostWriteEnglish(content, genreProfile, bookRules);
  }

  // 1. 硬性禁令: "不是…而是…" 句式
  if (/不是[^，。！？\n]{0,30}[，,]?\s*而是/.test(content)) {
    violations.push({
      rule: "禁止句式",
      severity: "error",
      description: "出现了「不是……而是……」句式",
      suggestion: "改用直述句",
    });
  }

  // 2. 硬性禁令: 破折号
  if (content.includes("——")) {
    violations.push({
      rule: "禁止破折号",
      severity: "error",
      description: "出现了破折号「——」",
      suggestion: "用逗号或句号断句",
    });
  }

  // 3. 转折/惊讶标记词密度 ≤ 1次/3000字
  const markerCounts: Record<string, number> = {};
  let totalMarkerCount = 0;
  for (const word of SURPRISE_MARKERS) {
    const matches = content.match(new RegExp(word, "g"));
    const count = matches?.length ?? 0;
    if (count > 0) {
      markerCounts[word] = count;
      totalMarkerCount += count;
    }
  }
  const markerLimit = Math.max(1, Math.floor(content.length / 3000));
  if (totalMarkerCount > markerLimit) {
    const detail = Object.entries(markerCounts)
      .map(([w, c]) => `"${w}"×${c}`)
      .join("、");
    violations.push({
      rule: "转折词密度",
      severity: "warning",
      description: `转折/惊讶标记词共${totalMarkerCount}次（上限${markerLimit}次/${content.length}字），明细：${detail}`,
      suggestion: "改用具体动作或感官描写传递突然性",
    });
  }

  // 4. 高疲劳词检查（从 genreProfile 读取，单章每词 ≤ 1次）
  const fatigueWords = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = content.match(new RegExp(escaped, "g"));
    const count = matches?.length ?? 0;
    if (count > 1) {
      violations.push({
        rule: "高疲劳词",
        severity: "warning",
        description: `高疲劳词"${word}"出现${count}次（上限1次/章）`,
        suggestion: `替换多余的"${word}"为同义但不同形式的表达`,
      });
    }
  }

  // 5. 元叙事检查（编剧旁白）
  for (const pattern of META_NARRATION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        rule: "元叙事",
        severity: "warning",
        description: `出现编剧旁白式表述："${match[0]}"`,
        suggestion: "删除元叙事，让剧情自然展开",
      });
      break; // 报一次即可
    }
  }

  // 6. 分析报告式术语
  const foundTerms: string[] = [];
  for (const term of REPORT_TERMS) {
    if (content.includes(term)) {
      foundTerms.push(term);
    }
  }
  if (foundTerms.length > 0) {
    violations.push({
      rule: "报告术语",
      severity: "error",
      description: `正文中出现分析报告术语：${foundTerms.map(t => `"${t}"`).join("、")}`,
      suggestion: "这些术语只能用于 PRE_WRITE_CHECK 内部推理，正文中用口语化表达替代",
    });
  }

  // 7. 正文中的章节号指称（如"第33章"、"chapter 33"）
  const chapterRefPattern = /(?:第\s*\d+\s*章|[Cc]hapter\s+\d+)/g;
  const chapterRefs = content.match(chapterRefPattern);
  if (chapterRefs && chapterRefs.length > 0) {
    const unique = [...new Set(chapterRefs)];
    violations.push({
      rule: isEnglish ? "chapter-number-reference" : "章节号指称",
      severity: "error",
      description: isEnglish
        ? `Chapter text contains explicit chapter number references: ${unique.map(r => `"${r}"`).join(", ")}. Characters do not know they are in a numbered chapter.`
        : `正文中出现了章节号指称：${unique.map(r => `"${r}"`).join("、")}。角色不知道自己在第几章。`,
      suggestion: isEnglish
        ? "Replace with natural references: 'that night', 'when the warehouse burned', 'the incident at the dock'"
        : '改成自然表达："那天晚上"、"仓库出事那次"、"码头上的事"',
    });
  }

  // 8. 作者说教词
  const foundSermons: string[] = [];
  for (const word of SERMON_WORDS) {
    if (content.includes(word)) {
      foundSermons.push(word);
    }
  }
  if (foundSermons.length > 0) {
    violations.push({
      rule: "作者说教",
      severity: "warning",
      description: `出现说教词：${foundSermons.map(w => `"${w}"`).join("、")}`,
      suggestion: "删除说教词，让读者自己从情节中判断",
    });
  }

  // 8. 全场震惊类集体反应
  for (const pattern of COLLECTIVE_SHOCK_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        rule: "集体反应",
        severity: "warning",
        description: `出现集体反应套话："${match[0]}"`,
        suggestion: "改写成1-2个具体角色的身体反应",
      });
      break;
    }
  }

  // 9. 连续"了"字检查（3句以上连续含"了"）
  const sentences = content
    .split(/[。！？]/)
    .map(s => s.trim())
    .filter(s => s.length > 2);

  let consecutiveLe = 0;
  let maxConsecutiveLe = 0;
  for (const sentence of sentences) {
    if (sentence.includes("了")) {
      consecutiveLe++;
      maxConsecutiveLe = Math.max(maxConsecutiveLe, consecutiveLe);
    } else {
      consecutiveLe = 0;
    }
  }
  if (maxConsecutiveLe >= 6) {
    violations.push({
      rule: "连续了字",
      severity: "warning",
      description: `检测到${maxConsecutiveLe}句连续包含"了"字，节奏拖沓`,
      suggestion: "保留最有力的一个「了」，其余改为无「了」句式",
    });
  }

  // 10. 段落长度检查（手机阅读适配：50-250字/段为宜）
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const longParagraphs = paragraphs.filter(p => p.length > 300);
  if (longParagraphs.length >= 2) {
    violations.push({
      rule: "段落过长",
      severity: "warning",
      description: `${longParagraphs.length}个段落超过300字，不适合手机阅读`,
      suggestion: "长段落拆分为3-5行的短段落，在动作切换或情绪节点处断开",
    });
  }

  violations.push(...detectParagraphShapeWarnings(content, "zh"));

  // 11. Book-level prohibitions
  // Short prohibitions (2-30 chars): exact substring match
  // Long prohibitions (>30 chars): skip — these are conceptual rules for prompt-level enforcement only
  if (bookRules?.prohibitions) {
    for (const prohibition of bookRules.prohibitions) {
      if (prohibition.length >= 2 && prohibition.length <= 30 && content.includes(prohibition)) {
        violations.push({
          rule: "本书禁忌",
          severity: "error",
          description: `出现了本书禁忌内容："${prohibition}"`,
          suggestion: "删除或改写该内容",
        });
      }
    }
  }

  return violations;
}

/**
 * Cross-chapter repetition check.
 * Detects phrases from the current chapter that also appeared in recent chapters.
 */
export function detectCrossChapterRepetition(
  currentContent: string,
  recentChaptersContent: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  if (!recentChaptersContent || recentChaptersContent.length < 100) return [];

  const violations: PostWriteViolation[] = [];
  const isEnglish = language === "en";

  if (isEnglish) {
    // Extract 3-word phrases from current chapter
    const words = currentContent.toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).filter(w => w.length > 2);
    const phraseCounts = new Map<string, number>();
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
    // Check which repeated phrases (2+ in current) also appear in recent chapters
    const recentLower = recentChaptersContent.toLowerCase();
    const crossRepeats: string[] = [];
    for (const [phrase, count] of phraseCounts) {
      if (count >= 2 && recentLower.includes(phrase)) {
        crossRepeats.push(`"${phrase}" (×${count})`);
      }
    }
    if (crossRepeats.length >= 3) {
      violations.push({
        rule: "Cross-chapter repetition",
        severity: "warning",
        description: `${crossRepeats.length} repeated phrases also found in recent chapters: ${crossRepeats.slice(0, 5).join(", ")}`,
        suggestion: "Vary action verbs and descriptive phrases to avoid cross-chapter repetition",
      });
    }
  } else {
    // Chinese: 6-char ngrams
    const chars = currentContent.replace(/[\s\n\r]/g, "");
    const phraseCounts = new Map<string, number>();
    for (let i = 0; i < chars.length - 5; i++) {
      const phrase = chars.slice(i, i + 6);
      if (/^[\u4e00-\u9fff]{6}$/.test(phrase)) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      }
    }
    const recentClean = recentChaptersContent.replace(/[\s\n\r]/g, "");
    const crossRepeats: string[] = [];
    for (const [phrase, count] of phraseCounts) {
      if (count >= 2 && recentClean.includes(phrase)) {
        crossRepeats.push(`"${phrase}"(×${count})`);
      }
    }
    if (crossRepeats.length >= 3) {
      violations.push({
        rule: "跨章重复",
        severity: "warning",
        description: `${crossRepeats.length}个重复短语在近期章节中也出现过：${crossRepeats.slice(0, 5).join("、")}`,
        suggestion: "变换动作描写和场景用语，避免跨章节机械重复",
      });
    }
  }

  return violations;
}

export function detectParagraphLengthDrift(
  currentContent: string,
  recentChaptersContent: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  if (!recentChaptersContent || recentChaptersContent.trim().length === 0) return [];

  const current = analyzeParagraphShape(currentContent, language);
  const recent = analyzeParagraphShape(recentChaptersContent, language);

  if (current.paragraphs.length < 4 || recent.paragraphs.length < 4) return [];
  if (recent.averageLength <= 0 || current.averageLength <= 0) return [];

  const shrinkRatio = current.averageLength / recent.averageLength;
  const shortRatioDelta = current.shortRatio - recent.shortRatio;

  if (shrinkRatio >= 0.6 || current.shortRatio < 0.5 || shortRatioDelta < 0.25) {
    return [];
  }

  const dropPercent = Math.round((1 - shrinkRatio) * 100);

  return [
    language === "en"
      ? {
          rule: "Paragraph density drift",
          severity: "warning",
          description: `Average paragraph length dropped from ${Math.round(recent.averageLength)} to ${Math.round(current.averageLength)} characters (${dropPercent}% shorter) compared with recent chapters.`,
          suggestion: "Let action, observation, and reaction share paragraphs more often instead of cutting every beat into a single short line.",
        }
      : {
          rule: "段落密度漂移",
          severity: "warning",
          description: `当前章平均段长从近期章节的${Math.round(recent.averageLength)}字降到${Math.round(current.averageLength)}字，缩短了${dropPercent}%。`,
          suggestion: "不要把每个动作都切成单独短句；适当把动作、观察和反应并入同一段，恢复段落层次。",
        },
  ];
}

/** English-specific post-write validation rules. */
function validatePostWriteEnglish(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];

  // 1. AI-tell word density (from en-prompt-sections IRON LAW 3)
  const aiTellWords = ["delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "embark", "comprehensive", "nuanced"];
  for (const word of aiTellWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = content.match(regex);
    if (matches && matches.length > Math.ceil(content.length / 3000)) {
      violations.push({
        rule: "AI-tell word density",
        severity: "warning",
        description: `"${word}" appears ${matches.length} times (limit: 1 per 3000 chars)`,
        suggestion: `Replace with a more specific word`,
      });
    }
  }

  // 2. Paragraph overflow (same rule applies to English)
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const longParagraphs = paragraphs.filter((p) => p.length > 500);
  if (longParagraphs.length >= 2) {
    violations.push({
      rule: "Paragraph length",
      severity: "warning",
      description: `${longParagraphs.length} paragraphs exceed 500 characters`,
      suggestion: "Break into shorter paragraphs for readability",
    });
  }

  violations.push(...detectParagraphShapeWarnings(content, "en"));

  // 2.5. Multi-character scene with almost no direct exchange
  const quotedLines = content.match(/"[^"]+"/g) ?? [];
  const englishNames = [...new Set(
    (content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])
      .filter((name) => !ENGLISH_NAME_STOP_WORDS.has(name)),
  )];
  if (englishNames.length >= 2 && quotedLines.length < 2 && content.length >= 120) {
    violations.push({
      rule: "Dialogue pressure",
      severity: "warning",
      description: `Multi-character scene appears to rely on narration with almost no direct exchange (${englishNames.slice(0, 3).join(", ")}).`,
      suggestion: "Add at least one resistance-bearing exchange so characters push back, withhold, or pressure each other directly.",
    });
  }

  // 3. Book-specific prohibitions
  if (bookRules?.prohibitions) {
    for (const prohibition of bookRules.prohibitions) {
      if (prohibition.length >= 2 && prohibition.length <= 50 && content.toLowerCase().includes(prohibition.toLowerCase())) {
        violations.push({
          rule: "Book prohibition",
          severity: "error",
          description: `Found banned content: "${prohibition}"`,
          suggestion: "Remove or rewrite this content",
        });
      }
    }
  }

  // 4. Genre fatigue words
  const fatigueWords = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = content.match(regex);
    if (matches && matches.length > 1) {
      violations.push({
        rule: "Fatigue word",
        severity: "warning",
        description: `"${word}" appears ${matches.length} times (max 1 per chapter)`,
        suggestion: "Vary the vocabulary",
      });
    }
  }

  return violations;
}

function appendParagraphShapeWarnings(
  violations: PostWriteViolation[],
  content: string,
  language: "zh" | "en",
): void {
  const shape = analyzeParagraphShape(content, language);
  if (shape.paragraphs.length < 4) return;

  if (shape.shortParagraphs.length >= 4 && shape.shortRatio >= 0.6) {
    violations.push(
      language === "en"
        ? {
            rule: "Paragraph fragmentation",
            severity: "warning",
            description: `${shape.shortParagraphs.length} of ${shape.paragraphs.length} paragraphs are shorter than ${shape.shortThreshold} characters.`,
            suggestion: "Merge adjacent action, observation, and reaction beats so the chapter does not collapse into one-line paragraphs.",
          }
        : {
            rule: "段落过碎",
            severity: "warning",
            description: `${shape.paragraphs.length}个段落里有${shape.shortParagraphs.length}个不足${shape.shortThreshold}字，段落被切得过碎。`,
            suggestion: "把相邻的动作、观察、反应适当并段，不要每句话都单独起段。",
          },
    );
  }

  if (shape.maxConsecutiveShort >= 3) {
    violations.push(
      language === "en"
        ? {
            rule: "Consecutive short paragraphs",
            severity: "warning",
            description: `${shape.maxConsecutiveShort} short paragraphs appear back to back.`,
            suggestion: "Break the one-beat-per-paragraph rhythm by folding connected beats into fuller paragraphs.",
          }
        : {
            rule: "连续短段",
            severity: "warning",
            description: `连续出现${shape.maxConsecutiveShort}个不足${shape.shortThreshold}字的短段，容易形成短句堆砌。`,
            suggestion: "把连续的碎动作重新编组，至少让一个段落承载完整的动作链或情绪推进。",
          },
    );
  }
}

export function detectParagraphShapeWarnings(
  content: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];
  appendParagraphShapeWarnings(violations, content, language);
  return violations;
}

function isDialogueParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return /^[""「『'《]/.test(trimmed) || /^[""]/.test(trimmed) || /^——/.test(trimmed);
}

function analyzeParagraphShape(content: string, language: "zh" | "en"): ParagraphShape {
  const paragraphs = extractParagraphs(content);
  // Exclude dialogue lines from short paragraph counting — dialogue is naturally short
  const narrativeParagraphs = paragraphs.filter((p) => !isDialogueParagraph(p));
  const shortThreshold = language === "en" ? 120 : 35;
  const shortParagraphs = narrativeParagraphs.filter((paragraph) => paragraph.length < shortThreshold);
  const averageLength = paragraphs.length > 0
    ? paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) / paragraphs.length
    : 0;

  let maxConsecutiveShort = 0;
  let currentConsecutive = 0;
  for (const paragraph of narrativeParagraphs) {
    if (paragraph.length < shortThreshold) {
      currentConsecutive++;
      maxConsecutiveShort = Math.max(maxConsecutiveShort, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }

  return {
    paragraphs,
    shortThreshold,
    shortParagraphs,
    shortRatio: narrativeParagraphs.length > 0 ? shortParagraphs.length / narrativeParagraphs.length : 0,
    averageLength,
    maxConsecutiveShort,
  };
}

function extractParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => paragraph !== "---")
    .filter((paragraph) => !paragraph.startsWith("#"));
}

function extractEndingRegion(content: string): string {
  const paragraphs = extractParagraphs(content);
  if (paragraphs.length === 0) {
    return content.trim();
  }
  return paragraphs.slice(-3).join("\n\n");
}

function detectResourceMatches(
  content: string,
  rule: (typeof RESOURCE_SIGNAL_RULES)[number],
): ResourceLedgerFinding[] {
  const findings: ResourceLedgerFinding[] = [];
  for (const pattern of rule.patterns) {
    for (const match of content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      const evidence = snippetAround(content, match.index ?? 0, (match[0] ?? "").length);
      if (isNegatedSnippet(evidence)) {
        continue;
      }
      findings.push({
        kind: rule.kind,
        signal: rule.signal,
        matched: false,
        evidence,
        expectedUpdate: rule.expectedUpdate.zh,
      });
    }
  }
  return findings;
}

function evaluateResourceFinding(
  finding: ResourceLedgerFinding,
  params: {
    readonly currentState: string;
    readonly updatedState: string;
    readonly originalLedger: string;
    readonly updatedLedger: string;
    readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
    readonly language: "zh" | "en";
  },
): ResourceLedgerFinding {
  const rule = RESOURCE_SIGNAL_RULES.find((candidate) => candidate.signal === finding.signal);
  if (!rule) {
    return finding;
  }

  const updatedCombined = buildResourceComparisonText(
    params.updatedState,
    params.updatedLedger,
    params.runtimeStateSnapshot,
  );
  const originalCombined = buildResourceComparisonText(
    params.currentState,
    params.originalLedger,
    undefined,
  );
  const stateEvidence = findRegexEvidence(updatedCombined, rule.statePatterns);
  const originalEvidence = findRegexEvidence(originalCombined, rule.statePatterns);
  const numericSignal = extractResourceNumericSignal(finding.evidence);
  const numericMatched = numericSignal
    ? containsNumericSignal(updatedCombined, numericSignal)
    : true;
  const changed = normalizeLooseText(stateEvidence ?? "") !== normalizeLooseText(originalEvidence ?? "");
  const matched = Boolean(stateEvidence) && numericMatched && (changed || !originalEvidence);

  return {
    ...finding,
    matched,
    expectedUpdate: params.language === "en" ? rule.expectedUpdate.en : rule.expectedUpdate.zh,
    ...(stateEvidence ? { stateEvidence } : {}),
  };
}

function buildResourceComparisonText(
  stateMarkdown: string,
  ledgerMarkdown: string,
  runtimeStateSnapshot: RuntimeStateSnapshot | undefined,
): string {
  const snapshotText = runtimeStateSnapshot
    ? JSON.stringify({
      manifest: runtimeStateSnapshot.manifest,
      currentState: runtimeStateSnapshot.currentState,
    }, null, 2)
    : "";
  return [stateMarkdown, ledgerMarkdown, snapshotText]
    .filter((value) => hasMeaningfulLedgerSource(value))
    .join("\n");
}

function hasMeaningfulLedgerSource(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "(文件尚未创建)");
}

function extractResourceNumericSignal(evidence: string): { value: string; unit?: string } | undefined {
  const arabicMatch = evidence.match(/(\d+)\s*(缕|点|成|层|分|丝|滴)?/u);
  if (arabicMatch?.[1]) {
    return {
      value: arabicMatch[1],
      ...(arabicMatch[2] ? { unit: arabicMatch[2] } : {}),
    };
  }

  const chineseMatch = evidence.match(/([一二三四五六七八九十百两]+)\s*(缕|点|成|层|分|丝|滴)?/u);
  if (!chineseMatch?.[1]) {
    return undefined;
  }

  return {
    value: normalizeChineseNumber(chineseMatch[1]),
    ...(chineseMatch[2] ? { unit: chineseMatch[2] } : {}),
  };
}

function containsNumericSignal(content: string, signal: { value: string; unit?: string }): boolean {
  const normalized = normalizeLooseText(content);
  if (!normalized.includes(signal.value)) {
    return false;
  }
  if (!signal.unit) {
    return true;
  }
  return content.includes(signal.unit);
}

function normalizeChineseNumber(value: string): string {
  const mapping: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    百: 100,
  };

  if (value === "十") return "10";
  if (value.length === 2 && value.startsWith("十")) {
    return String(10 + (mapping[value[1]!] ?? 0));
  }
  if (value.length === 2 && value.endsWith("十")) {
    return String((mapping[value[0]!] ?? 0) * 10);
  }
  if (value.length === 3 && value[1] === "十") {
    return String((mapping[value[0]!] ?? 0) * 10 + (mapping[value[2]!] ?? 0));
  }
  return String(mapping[value] ?? 0);
}

function determineBaseResourceWarningRule(
  finding: ResourceLedgerFinding,
): string {
  switch (finding.kind) {
    case "consumption":
      return "resource-ledger-missing-consumption";
    case "recovery":
      return "resource-ledger-missing-recovery";
    case "injury":
      return "resource-ledger-missing-injury-update";
    case "growth":
      return "resource-ledger-missing-growth-update";
    default:
      return "resource-ledger-value-mismatch";
  }
}

function hasNumericResourceMismatch(
  finding: ResourceLedgerFinding,
  updatedState: string,
  updatedLedger: string,
): boolean {
  const numericSignal = extractResourceNumericSignal(finding.evidence);
  if (!numericSignal) {
    return false;
  }
  return !containsNumericSignal([updatedState, updatedLedger].join("\n"), numericSignal);
}

function localizeHookDebtWarning(
  rule: string,
  check: HookDebtCheck,
  language: "zh" | "en",
): string {
  if (language === "en") {
    switch (rule) {
      case "hook-debt-over-cap":
        return `Active hooks ${check.activeCount} exceed the recommended cap of ${check.cap}.`;
      case "hook-debt-too-many-new-hooks":
        return `This chapter opened ${check.newHooksOpened} new hooks under the current debt throttle.`;
      case "hook-debt-no-old-hook-advance":
        return "This chapter did not advance or resolve any older hook debt.";
      case "hook-debt-throttle-violation":
        return "The chapter kept opening new hooks while high debt remained untouched.";
      default:
        return "Hook debt throttle warning.";
    }
  }

  switch (rule) {
    case "hook-debt-over-cap":
      return `当前活跃伏笔数 ${check.activeCount} 已超过建议上限 ${check.cap}。`;
    case "hook-debt-too-many-new-hooks":
      return `本章在高债务状态下仍新开了 ${check.newHooksOpened} 条伏笔。`;
    case "hook-debt-no-old-hook-advance":
      return "本章没有推进或回收任何旧伏笔。";
    case "hook-debt-throttle-violation":
      return "高债务状态下，本章仍主要在开新坑而没有处理旧债。";
    default:
      return "伏笔节流警告。";
  }
}

function findRegexEvidence(content: string, patterns: ReadonlyArray<RegExp>): string | undefined {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.index !== undefined) {
      return snippetAround(content, match.index, match[0].length);
    }
  }
  return undefined;
}

function findPayoffEvidence(content: string, expectedPayoff: string): string | undefined {
  const normalizedExpected = normalizeLooseText(expectedPayoff);
  const normalizedContent = normalizeLooseText(content);
  if (normalizedExpected && normalizedContent.includes(normalizedExpected)) {
    const index = normalizedContent.indexOf(normalizedExpected);
    const snippet = snippetAround(content, mapLooseIndexToRaw(content, index), expectedPayoff.length);
    return isNegatedSnippet(snippet) ? undefined : snippet;
  }

  const keywords = extractPayoffKeywords(expectedPayoff);
  if (keywords.length === 0) {
    return undefined;
  }

  const matched = keywords.filter((keyword) => {
    const rawIndex = content.indexOf(keyword);
    if (rawIndex < 0) return false;
    return !isNegatedSnippet(snippetAround(content, rawIndex, keyword.length));
  });
  const threshold = keywords.length >= 3 ? 2 : 1;
  if (matched.length < threshold) {
    return undefined;
  }

  const lead = matched[0]!;
  const rawIndex = content.indexOf(lead);
  return rawIndex >= 0 ? snippetAround(content, rawIndex, lead.length) : matched.join(" / ");
}

function extractPayoffKeywords(text: string): string[] {
  const english = (text.match(/\b[a-z]{4,}\b/gi) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !ENGLISH_PAYOFF_STOPWORDS.has(word));
  const chinese = (text.match(/[\u4e00-\u9fff]{2,12}/gu) ?? [])
    .flatMap((phrase) => buildChinesePayoffFragments(phrase));
  return [...new Set([...english, ...chinese])];
}

function buildChinesePayoffFragments(phrase: string): string[] {
  const cleaned = phrase.trim();
  if (cleaned.length < 2) return [];
  if (CHINESE_PAYOFF_STOPWORDS.has(cleaned)) return [];

  const fragments = new Set<string>();
  if (cleaned.length <= 4) {
    fragments.add(cleaned);
  } else {
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= cleaned.length - size; index += 1) {
        const fragment = cleaned.slice(index, index + size);
        if (!CHINESE_PAYOFF_STOPWORDS.has(fragment)) {
          fragments.add(fragment);
        }
      }
    }
  }

  return [...fragments];
}

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, "");
}

function mapLooseIndexToRaw(raw: string, normalizedIndex: number): number {
  if (normalizedIndex <= 0) return 0;

  let count = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (/[\p{L}\p{N}\u4e00-\u9fff]/u.test(char)) {
      if (count === normalizedIndex) {
        return index;
      }
      count += 1;
    }
  }

  return Math.max(0, raw.length - 1);
}

function snippetAround(content: string, start: number, length: number): string {
  const safeStart = Math.max(0, start - 24);
  const safeEnd = Math.min(content.length, start + length + 24);
  return content.slice(safeStart, safeEnd).replace(/\s+/g, " ").trim();
}

function isNegatedSnippet(value: string): boolean {
  return /没有|未能|未曾|未|还没|没能|并未|尚未|不能|无力|not\b|did not|didn't|without\b|failed to/i.test(value);
}

const ENGLISH_NAME_STOP_WORDS = new Set([
  "The",
  "And",
  "But",
  "When",
  "While",
  "After",
  "Before",
  "Even",
  "Then",
  "They",
]);

const ENGLISH_PAYOFF_STOPWORDS = new Set([
  "first",
  "deliver",
  "reader",
  "chapter",
  "concrete",
  "immediate",
  "before",
  "after",
]);

const CHINESE_PAYOFF_STOPWORDS = new Set([
  "第一次",
  "本章",
  "读者",
  "回报",
  "即时",
  "获得",
  "拿到",
  "一个",
  "关键",
  "线索",
  "资源",
  "小胜",
]);

const CHINESE_TITLE_STOP_WORDS = new Set([
  "这次",
  "正文",
  "标题",
  "重复",
  "不同",
  "完全",
  "只是",
  "碰巧",
  "没有",
  "回头",
]);

const CHINESE_TITLE_STOP_CHARS = new Set(["的", "了", "着", "一", "只", "从", "在", "和", "与", "把", "被", "有", "没", "里", "又", "才"]);

/**
 * Detect duplicate or near-duplicate chapter titles.
 * Compares the new title against existing chapter titles from index.
 */
export function detectDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
): ReadonlyArray<PostWriteViolation> {
  if (!newTitle.trim()) return [];

  const normalized = newTitle.trim().toLowerCase();
  const violations: PostWriteViolation[] = [];

  for (const existing of existingTitles) {
    const existingNorm = existing.trim().toLowerCase();
    if (!existingNorm) continue;

    // Exact match
    if (normalized === existingNorm) {
      violations.push({
        rule: "duplicate-title",
        severity: "warning",
        description: `章节标题"${newTitle}"与已有章节标题完全相同`,
        suggestion: "更换一个不同的章节标题",
      });
      break;
    }

    // Near-duplicate: one is substring of the other, or only differs by punctuation/numbers
    const stripPunct = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
    if (stripPunct(normalized) === stripPunct(existingNorm)) {
      violations.push({
        rule: "near-duplicate-title",
        severity: "warning",
        description: `章节标题"${newTitle}"与已有标题"${existing}"高度相似`,
        suggestion: "避免使用相似的章节标题",
      });
      break;
    }
  }

  return violations;
}

export function resolveDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en" = "zh",
  options?: {
    readonly content?: string;
  },
): {
  readonly title: string;
  readonly issues: ReadonlyArray<PostWriteViolation>;
} {
  const trimmed = newTitle.trim();
  if (!trimmed) {
    return { title: newTitle, issues: [] };
  }

  const duplicateIssues = detectDuplicateTitle(trimmed, existingTitles);
  if (duplicateIssues.length > 0) {
    const regenerated = regenerateDuplicateTitle(trimmed, existingTitles, language, options?.content);
    if (regenerated && detectDuplicateTitle(regenerated, existingTitles).length === 0) {
      return { title: regenerated, issues: duplicateIssues };
    }

    let counter = 2;
    while (counter < 100) {
      const candidate = language === "en"
        ? `${trimmed} (${counter})`
        : `${trimmed}（${counter}）`;
      if (detectDuplicateTitle(candidate, existingTitles).length === 0) {
        return { title: candidate, issues: duplicateIssues };
      }
      counter++;
    }

    return { title: trimmed, issues: duplicateIssues };
  }

  const collapseIssues = detectTitleCollapse(trimmed, existingTitles, language);
  if (collapseIssues.length === 0) {
    return { title: trimmed, issues: [] };
  }

  const regenerated = regenerateCollapsedTitle(trimmed, existingTitles, language, options?.content);
  if (
    regenerated
    && detectDuplicateTitle(regenerated, existingTitles).length === 0
    && detectTitleCollapse(regenerated, existingTitles, language).length === 0
  ) {
    return { title: regenerated, issues: collapseIssues };
  }

  return { title: trimmed, issues: collapseIssues };
}

export function evaluateChapterGoalDiscipline(
  content: string,
  chapterGoal: ChapterGoal,
): PostWriteDisciplineChecks {
  const endingRegion = extractEndingRegion(content);
  const endingEvidence = findRegexEvidence(endingRegion, ENDING_HOOK_PATTERNS[chapterGoal.endingHookType]);
  const payoffEvidence = findPayoffEvidence(content, chapterGoal.payoffToDeliver);

  return {
    endingHookCheck: {
      expectedType: chapterGoal.endingHookType,
      matched: Boolean(endingEvidence),
      ...(endingEvidence ? { evidence: endingEvidence } : {}),
    },
    payoffCheck: {
      expectedPayoff: chapterGoal.payoffToDeliver,
      matched: Boolean(payoffEvidence),
      ...(payoffEvidence ? { evidence: payoffEvidence } : {}),
    },
  };
}

export function toDisciplineWarnings(
  checks: PostWriteDisciplineChecks,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const warnings: PostWriteViolation[] = [];

  if (!checks.endingHookCheck.matched) {
    warnings.push({
      rule: "ending-hook-check",
      severity: "warning",
      description: language === "en"
        ? `The ending does not clearly cash out the expected hook type: ${checks.endingHookCheck.expectedType}.`
        : `章尾没有明显兑现预期的收尾钩子类型：${checks.endingHookCheck.expectedType}。`,
      suggestion: language === "en"
        ? "Strengthen the closing paragraphs with a clearer end-beat signal."
        : "在结尾段补强更明确的章尾信号。",
    });
  }

  if (!checks.payoffCheck.matched) {
    warnings.push({
      rule: "payoff-check",
      severity: "warning",
      description: language === "en"
        ? `The chapter does not clearly deliver the planned payoff: ${checks.payoffCheck.expectedPayoff}.`
        : `本章没有明显兑现预期即时回报：${checks.payoffCheck.expectedPayoff}。`,
      suggestion: language === "en"
        ? "Add one visible payoff beat, clue, win, or resource before the chapter closes."
        : "在本章中补一个读者能明确感知到的回报节点。",
    });
  }

  return warnings;
}

export function evaluateResourceLedgerDiscipline(params: {
  readonly content: string;
  readonly currentState: string;
  readonly updatedState: string;
  readonly originalLedger: string;
  readonly updatedLedger: string;
  readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
  readonly language: "zh" | "en";
}): ResourceLedgerCheck {
  const sourcesAvailable = [
    params.currentState,
    params.updatedState,
    params.originalLedger,
    params.updatedLedger,
    params.runtimeStateSnapshot ? JSON.stringify(params.runtimeStateSnapshot.currentState) : "",
  ].some((value) => hasMeaningfulLedgerSource(value));
  if (!sourcesAvailable) {
    return {
      matched: true,
      findings: [],
      warnings: [],
    };
  }

  const findings = RESOURCE_SIGNAL_RULES
    .flatMap((rule) => detectResourceMatches(params.content, rule))
    .filter((finding, index, list) =>
      list.findIndex((candidate) => candidate.kind === finding.kind && candidate.signal === finding.signal) === index,
    )
    .map((finding) => evaluateResourceFinding(finding, params));

  const warnings = [...new Set(findings
    .filter((finding) => !finding.matched)
    .flatMap((finding) => {
      const rules = [determineBaseResourceWarningRule(finding)];
      if (hasNumericResourceMismatch(finding, params.updatedState, params.updatedLedger)) {
        rules.push("resource-ledger-value-mismatch");
      }
      return rules;
    }))];

  return {
    matched: warnings.length === 0,
    findings,
    warnings,
  };
}

export function toResourceLedgerWarnings(
  check: ResourceLedgerCheck,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const warnings: PostWriteViolation[] = [];
  const seen = new Set<string>();

  for (const finding of check.findings.filter((candidate) => !candidate.matched)) {
    const rules = [determineBaseResourceWarningRule(finding)];
    if (check.warnings.includes("resource-ledger-value-mismatch") && hasNumericResourceMismatch(finding, finding.stateEvidence ?? "", "")) {
      rules.push("resource-ledger-value-mismatch");
    }

    for (const rule of rules) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      warnings.push({
        rule,
        severity: "warning" as const,
        description: language === "en"
          ? `Resource/state drift detected for ${finding.signal}: ${finding.expectedUpdate}`
          : `检测到资源/状态可能漏记：${finding.expectedUpdate}`,
        suggestion: language === "en"
          ? `Update the ledger/state to reflect: ${finding.evidence}`
          : `请在状态或账本中补记：${finding.evidence}`,
      });
    }
  }

  return warnings;
}

export function evaluateHookDebtThrottle(params: {
  readonly snapshot?: RuntimeStateSnapshot;
  readonly delta?: RuntimeStateDelta;
  readonly existingHookIds?: ReadonlyArray<string>;
  readonly cap?: number;
}): HookDebtCheck | undefined {
  if (!params.snapshot || !params.delta) {
    return undefined;
  }

  const cap = params.cap ?? 12;
  const activeHooks = params.snapshot.hooks.hooks.filter((hook) => hook.status !== "resolved");
  const activeCount = activeHooks.length;
  const existingIds = new Set(params.existingHookIds ?? []);
  const newHookIds = [...new Set(
    params.delta.hookOps.upsert
      .map((hook) => hook.hookId)
      .filter((hookId) => !existingIds.has(hookId)),
  )];
  const oldHooksAdvanced = new Set([
    ...params.delta.hookOps.resolve,
    ...params.delta.hookOps.defer,
    ...params.delta.hookOps.upsert
      .filter((hook) => existingIds.has(hook.hookId) && hook.lastAdvancedChapter === params.delta!.chapter)
      .map((hook) => hook.hookId),
  ]);

  const newHookCap = activeCount > cap || existingIds.size > cap ? 1 : 2;
  const warnings: string[] = [];
  if (activeCount > cap) {
    warnings.push("hook-debt-over-cap");
  }
  if (newHookIds.length > newHookCap) {
    warnings.push("hook-debt-too-many-new-hooks");
  }
  if ((activeCount >= cap || existingIds.size >= cap) && oldHooksAdvanced.size === 0) {
    warnings.push("hook-debt-no-old-hook-advance");
  }
  if ((activeCount >= cap || existingIds.size >= cap) && newHookIds.length > 0 && oldHooksAdvanced.size === 0) {
    warnings.push("hook-debt-throttle-violation");
  }

  return {
    activeCount,
    cap,
    newHooksOpened: newHookIds.length,
    oldHooksAdvanced: oldHooksAdvanced.size,
    matched: warnings.length === 0,
    warnings,
  };
}

export function toHookDebtWarnings(
  check: HookDebtCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check) {
    return [];
  }

  return check.warnings.map((rule) => ({
    rule,
    severity: "warning" as const,
    description: localizeHookDebtWarning(rule, check, language),
    suggestion: language === "en"
      ? "Favor advancing or resolving existing hooks before opening parallel debt."
      : "优先推进或回收旧伏笔，再考虑开新坑。",
  }));
}

function detectTitleCollapse(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const recentTitles = existingTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(-3);
  if (recentTitles.length < 3) {
    return [];
  }

  const cadence = analyzeChapterCadence({
    language,
    rows: [...recentTitles, newTitle].map((title, index) => ({
      chapter: index + 1,
      title,
      mood: "",
      chapterType: "",
    })),
  });
  const titlePressure = cadence.titlePressure;
  if (!titlePressure || titlePressure.pressure !== "high") {
    return [];
  }
  if (!newTitle.includes(titlePressure.repeatedToken)) {
    return [];
  }

  return [
    language === "en"
      ? {
          rule: "title-collapse",
          severity: "warning",
          description: `Chapter title "${newTitle}" keeps leaning on the recent "${titlePressure.repeatedToken}" title shell.`,
          suggestion: "Rename the chapter around a new image, action, consequence, or character focus.",
        }
      : {
          rule: "title-collapse",
          severity: "warning",
          description: `章节标题"${newTitle}"仍在沿用近期围绕“${titlePressure.repeatedToken}”的命名壳。`,
          suggestion: "换一个新的意象、动作、后果或人物焦点来命名。",
        },
  ];
}

function regenerateDuplicateTitle(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en",
  content?: string,
): string | undefined {
  if (!content || !content.trim()) {
    return undefined;
  }

  const qualifier = language === "en"
    ? extractEnglishTitleQualifier(baseTitle, existingTitles, content)
    : extractChineseTitleQualifier(baseTitle, existingTitles, content);
  if (!qualifier) {
    return undefined;
  }

  return language === "en"
    ? `${baseTitle}: ${qualifier}`
    : `${baseTitle}：${qualifier}`;
}

function regenerateCollapsedTitle(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en",
  content?: string,
): string | undefined {
  if (!content || !content.trim()) {
    return undefined;
  }

  const fresh = language === "en"
    ? extractEnglishTitleQualifier(baseTitle, existingTitles, content)
    : extractChineseTitleQualifier(baseTitle, existingTitles, content);
  if (!fresh) {
    return undefined;
  }

  return fresh === baseTitle ? undefined : fresh;
}

function extractEnglishTitleQualifier(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  content: string,
): string | undefined {
  const blocked = new Set(extractEnglishTitleTerms([baseTitle, ...existingTitles].join(" ")));
  const words = (content.match(/[A-Za-z]{4,}/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !ENGLISH_NAME_STOP_WORDS.has(capitalize(word)))
    .filter((word) => !blocked.has(word));
  const first = words[0];
  if (!first) {
    return undefined;
  }

  const second = words.find((word) => word !== first && !blocked.has(word));
  return second
    ? `${capitalize(first)} ${capitalize(second)}`
    : capitalize(first);
}

function extractChineseTitleQualifier(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  content: string,
): string | undefined {
  const blocked = new Set(extractChineseTitleTerms([baseTitle, ...existingTitles].join("")));
  const segments = content.match(/[\u4e00-\u9fff]+/g) ?? [];

  for (const segment of segments) {
    for (let start = 0; start < segment.length; start += 1) {
      for (let size = 2; size <= 4; size += 1) {
        const candidate = segment.slice(start, start + size).trim();
        if (candidate.length < 2) continue;
        if (CHINESE_TITLE_STOP_WORDS.has(candidate)) continue;
        if ([...candidate].some((char) => CHINESE_TITLE_STOP_CHARS.has(char))) continue;
        if (blocked.has(candidate)) continue;
        return candidate;
      }
    }
  }

  return undefined;
}

function extractEnglishTitleTerms(text: string): string[] {
  return [...new Set((text.match(/[A-Za-z]{4,}/g) ?? []).map((word) => word.toLowerCase()))];
}

function extractChineseTitleTerms(text: string): string[] {
  const terms = new Set<string>();
  const segments = text.match(/[\u4e00-\u9fff]+/g) ?? [];

  for (const segment of segments) {
    for (let start = 0; start < segment.length; start += 1) {
      for (let size = 2; size <= 4; size += 1) {
        const candidate = segment.slice(start, start + size).trim();
        if (candidate.length < 2) continue;
        if ([...candidate].some((char) => CHINESE_TITLE_STOP_CHARS.has(char))) continue;
        terms.add(candidate);
      }
    }
  }

  return [...terms];
}

function capitalize(word: string): string {
  return word.length === 0 ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`;
}
