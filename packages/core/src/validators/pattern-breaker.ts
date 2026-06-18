export type NarrativePatternTag = string;

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

// Universal narrative pattern tags — no genre-specific terms.
// Genre-specific tags come from genre profile or structure_signals.
const UNIVERSAL_TAG_RULES: ReadonlyArray<{
  readonly tag: NarrativePatternTag;
  readonly pattern: RegExp;
}> = [
  { tag: "冲突", pattern: /冲突|交锋|对抗|迎战|击败|阻止/u },
  { tag: "获得", pattern: /获得|取得|找到|收获|拿到|入手/u },
  { tag: "揭示", pattern: /发现|得知|透露|看到|意识到|确认/u },
  { tag: "代价", pattern: /代价|伤势|损失|失去|牺牲/u },
];

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
  const matches = UNIVERSAL_TAG_RULES.flatMap((rule) => {
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
  if (hasOrderedTags(tags, ["冲突", "获得"])) {
    return "冲突 → 获得";
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
      "- Do not use the same progression pattern as previous chapters.",
      "- Do not rely on a single acquisition event as the main driver.",
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
    "- 再重复同样的开局模式",
    "- 再用同样的获得方式推进",
    "- 用相同的事件链条作为主推进",
    "",
    "本章必须选择不同推进方式之一：",
    "- 异象驱动（环境变化）",
    "- 人物驱动（新角色/旧角色带来阻力）",
    "- 规则驱动（宗门/禁制/契约规则启动）",
    "- 代价驱动（身体/能力崩溃）",
    "- 线索驱动（未解谜题或已有物证变化）",
  ].join("\n");
}
