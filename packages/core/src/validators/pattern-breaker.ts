export type NarrativePatternTag =
  | "战斗"
  | "掉落"
  | "资源"
  | "人物"
  | "异象"
  | "陷阱"
  | "代价"
  | "玉牌"
  | "卷轴";

export interface ChapterPatternAnalysis {
  readonly tags: readonly NarrativePatternTag[];
  readonly signature: string;
}

export interface PatternBreakerResult {
  readonly repeated: boolean;
  readonly recentPatterns: readonly string[];
  readonly issues: readonly string[];
  readonly directive?: string;
}

const TAG_RULES: ReadonlyArray<{
  readonly tag: NarrativePatternTag;
  readonly pattern: RegExp;
}> = [
  { tag: "战斗", pattern: /战斗|交锋|厮杀|搏杀|迎战|击败|击杀|斩杀|倒下|拔剑|出手|血战/u },
  { tag: "掉落", pattern: /掉落|散落|滚落|掉出|坠落|落在|尸体旁|爪下压着/u },
  { tag: "资源", pattern: /资源|灵气结晶|药材|灵草|丹药|矿石|收获|灵石|晶核/u },
  { tag: "人物", pattern: /黑袍人|灰袍|老者|少年|少女|身影|人影|有人|男子|女子|弟子|长老/u },
  { tag: "异象", pattern: /异象|符文[^。！？\n]{0,18}亮|亮起|倒流|震动|裂开|发烫|雾气|血光|光芒|轰鸣/u },
  { tag: "陷阱", pattern: /陷阱|机关|阵法|封锁|禁制|地面[^。！？\n]{0,18}沉|塌陷|锁链|囚笼/u },
  { tag: "代价", pattern: /代价|反噬|精血|寿元|伤势|刺痛|麻木|崩溃|失去知觉|经脉/u },
  { tag: "玉牌", pattern: /玉牌/u },
  { tag: "卷轴", pattern: /卷轴/u },
];

const COMBAT_LOOT_JADE_PATTERN = /(?:战斗|交锋|厮杀|搏杀|迎战|击败|击杀|斩杀|倒下|拔剑|出手|血战)[\s\S]{0,500}(?:掉落|散落|滚落|掉出|坠落|落在|尸体旁|爪下压着|灵气结晶|药材|资源|收获)[\s\S]{0,260}玉牌/u;
const COMBAT_LOOT_SCROLL_PATTERN = /(?:战斗|交锋|厮杀|搏杀|迎战|击败|击杀|斩杀|倒下|拔剑|出手|血战)[\s\S]{0,500}(?:掉落|散落|滚落|掉出|坠落|落在|尸体旁|爪下压着|灵气结晶|药材|资源|收获)[\s\S]{0,260}卷轴/u;

export function analyzePatternBreaker(
  recentChapters: ReadonlyArray<string>,
  language: "zh" | "en" = "zh",
): PatternBreakerResult {
  const analyses = recentChapters
    .slice(-3)
    .map((chapter) => analyzeChapterPattern(chapter))
    .filter((analysis) => analysis.tags.length > 0);
  const recentPatterns = analyses.map((analysis) => analysis.signature);
  const repeatedPattern = findRepeatedPattern(recentPatterns);

  if (!repeatedPattern) {
    return {
      repeated: false,
      recentPatterns,
      issues: [],
    };
  }

  const issues = [
    language === "en"
      ? `[high] Repeated narrative pattern in recent chapters: ${repeatedPattern}.`
      : `[high] 最近章节叙事流程重复：${repeatedPattern}。`,
  ];

  return {
    repeated: true,
    recentPatterns,
    issues,
    directive: buildPatternBreakerDirective(repeatedPattern, language),
  };
}

export function analyzeChapterPattern(chapter: string): ChapterPatternAnalysis {
  const matches = TAG_RULES.flatMap((rule) => {
    const found = rule.pattern.exec(chapter);
    return found?.index === undefined ? [] : [{ tag: rule.tag, index: found.index }];
  }).sort((left, right) => left.index - right.index);

  const tags: NarrativePatternTag[] = [];
  for (const match of matches) {
    if (!tags.includes(match.tag)) {
      tags.push(match.tag);
    }
  }

  return {
    tags,
    signature: buildSignatureFromContent(chapter, tags),
  };
}

function findRepeatedPattern(patterns: readonly string[]): string | undefined {
  const meaningful = patterns.filter((pattern) => pattern.length > 0);

  for (let index = 1; index < meaningful.length; index += 1) {
    if (meaningful[index] === meaningful[index - 1]) {
      return meaningful[index];
    }
  }

  const counts = new Map<string, number>();
  for (const pattern of meaningful) {
    const next = (counts.get(pattern) ?? 0) + 1;
    if (next >= 2) {
      return pattern;
    }
    counts.set(pattern, next);
  }

  return undefined;
}

function buildSignatureFromContent(chapter: string, tags: readonly NarrativePatternTag[]): string {
  if (COMBAT_LOOT_JADE_PATTERN.test(chapter)) {
    return "战斗 → 掉落 → 玉牌";
  }
  if (COMBAT_LOOT_SCROLL_PATTERN.test(chapter)) {
    return "战斗 → 掉落 → 卷轴";
  }
  if (hasOrderedTags(tags, ["战斗", "掉落", "玉牌"])) {
    return "战斗 → 掉落 → 玉牌";
  }
  if (hasOrderedTags(tags, ["战斗", "掉落", "卷轴"])) {
    return "战斗 → 掉落 → 卷轴";
  }
  if (hasOrderedTags(tags, ["战斗", "资源", "玉牌"])) {
    return "战斗 → 资源 → 玉牌";
  }
  if (hasOrderedTags(tags, ["战斗", "资源", "卷轴"])) {
    return "战斗 → 资源 → 卷轴";
  }

  return tags.slice(0, 4).join(" → ");
}

function hasOrderedTags(tags: readonly NarrativePatternTag[], expected: readonly NarrativePatternTag[]): boolean {
  let cursor = 0;
  for (const tag of tags) {
    if (tag === expected[cursor]) {
      cursor += 1;
    }
    if (cursor >= expected.length) {
      return true;
    }
  }
  return false;
}

function buildPatternBreakerDirective(pattern: string, language: "zh" | "en"): string {
  if (language === "en") {
    return [
      "## Pattern Breaker",
      "Previous chapter structure:",
      pattern,
      "",
      "The last three chapters show a repeated progression. This chapter must not repeat it.",
      "Forbidden:",
      "- Do not open with combat.",
      "- Do not drop a jade token or scroll after a victory.",
      "- Do not use victory loot as the main progression engine.",
      "",
      "Choose one different driver:",
      "- Anomaly-driven: environmental change.",
      "- Character-driven: a new or returning person creates pressure.",
      "- Rule-driven: sect rules, restrictions, contracts, or bans activate.",
      "- Cost-driven: body, power, or technique destabilizes.",
      "- Clue-driven: an unresolved clue or existing object changes.",
    ].join("\n");
  }

  return [
    "## 剧情模式打断器",
    "上一章结构为：",
    pattern,
    "",
    "最近3章出现重复推进模式，本章禁止重复该结构。",
    "禁止：",
    "- 再出现战斗开局",
    "- 再掉落玉牌/卷轴",
    "- 用“战斗胜利后获得资源/玉牌/卷轴”作为主推进",
    "",
    "本章必须选择不同推进方式之一：",
    "- 异象驱动（环境变化）",
    "- 人物驱动（新角色/旧角色带来阻力）",
    "- 规则驱动（宗门/禁制/契约规则启动）",
    "- 代价驱动（身体/能力崩溃）",
    "- 线索驱动（未解谜题或已有物证变化）",
  ].join("\n");
}
