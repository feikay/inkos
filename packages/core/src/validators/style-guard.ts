export interface StyleGuardResult {
  readonly pass: boolean;
  readonly issues: ReadonlyArray<string>;
  readonly severity: "low" | "high";
}

export interface StyleGuardChapter {
  readonly title?: string;
  readonly content: string;
}

export interface StyleGuardOptions {
  readonly previousChapters?: ReadonlyArray<string | StyleGuardChapter>;
}

type StructurePattern = "combat-loot-jade" | "explore-sense-combat";

const FORBIDDEN_PHRASE_RULES: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  {
    label: "危险/考验/挑战 + 刚刚开始",
    pattern: /(危险|考验|挑战|战斗|狩猎)[^。！？\n]{0,12}(才)?刚刚开始/u,
  },
  {
    label: "继续 + 深入/前行/探索",
    pattern: /继续[^。！？\n]{0,8}(深入|前行|探索|向前|往前|赶路)/u,
  },
  {
    label: "隐藏 + 秘密",
    pattern: /隐藏[^。！？\n]{0,12}秘密/u,
  },
  {
    label: "冰山一角",
    pattern: /冰山一角/u,
  },
  {
    label: "真相 + 揭开",
    pattern: /(真相[^。！？\n]{0,12}(揭开|揭晓|浮出|显露)|揭开[^。！？\n]{0,12}真相)/u,
  },
];

const OPENING_SUMMARY_PATTERNS: ReadonlyArray<RegExp> = [
  /^随着/u,
  /^经过/u,
  /^自从/u,
  /^在[^。！？\n]{0,20}(之后|以后)/u,
  /^(楚夜|云岚|他们)知道/u,
  /^前方[^。！？\n]{0,20}(未知|危险|秘密)/u,
  /^(这场|这一切|此行|暗河尽头的探索)/u,
  /^(上一章|本章|故事)/u,
];

const OPENING_EVENT_PATTERNS: ReadonlyArray<RegExp> = [
  /忽然|突然|骤然|猛地|传来|响起|亮起|裂开|倒流|发烫|震动|渗出|浮现|现身|扑来|坠落|炸开/u,
  /按住|握住|拔出|抽出|抬手|后退|停下|踩过|推开|撞上|砸在|咬住|伸手|转身|冲出|跪下|横在|吸了/u,
  /咆哮|脚步声|血迹|符文|玉牌|卷轴|石门|尸体|伤口|火光|水声/u,
];

const STRUCTURE_RULES: Record<StructurePattern, {
  readonly label: string;
  readonly sequence: ReadonlyArray<RegExp>;
}> = {
  "combat-loot-jade": {
    label: "战斗 → 掉落 → 玉牌",
    sequence: [
      /战斗|交锋|厮杀|搏杀|迎战|击败|击杀|斩杀|倒下/u,
      /掉落|散落|滚落|收获|搜寻|灵气结晶|药材|资源/u,
      /玉牌/u,
    ],
  },
  "explore-sense-combat": {
    label: "探索 → 感知 → 战斗",
    sequence: [
      /探索|前行|深入|赶路|走向|踏入|进入/u,
      /感知|感觉|察觉|觉察|意识到|气息|波动/u,
      /战斗|迎战|交锋|厮杀|搏杀|拔剑|出手/u,
    ],
  },
};

export function validateStyleGuard(content: string, options: StyleGuardOptions = {}): StyleGuardResult {
  const issues: string[] = [];
  const normalizedContent = normalizeContent(content);

  issues.push(...detectForbiddenPhrases(normalizedContent));
  issues.push(...detectOpeningIssue(normalizedContent));
  issues.push(...detectStructureIssues(normalizedContent, options.previousChapters ?? []));

  const severity = issues.some((issue) => issue.startsWith("[high]")) ? "high" : issues.length > 0 ? "low" : "low";
  return {
    pass: issues.length === 0,
    issues,
    severity,
  };
}

function detectForbiddenPhrases(content: string): string[] {
  const issues: string[] = [];
  for (const rule of FORBIDDEN_PHRASE_RULES) {
    const match = rule.pattern.exec(content);
    if (!match) continue;
    issues.push(`[high] 禁用表达：${rule.label}，命中“${trimEvidence(match[0])}”。`);
  }
  return issues;
}

function detectOpeningIssue(content: string): string[] {
  const firstSentence = extractFirstSentence(content);
  if (!firstSentence) {
    return ["[high] 开头检测：未找到有效正文首句。"];
  }

  if (OPENING_SUMMARY_PATTERNS.some((pattern) => pattern.test(firstSentence))) {
    return [`[high] 开头检测：首句像总结/过渡句，缺少事件触发：“${trimEvidence(firstSentence)}”。`];
  }

  if (!OPENING_EVENT_PATTERNS.some((pattern) => pattern.test(firstSentence))) {
    return [`[low] 开头检测：首句缺少明确动作、异象或事件触发：“${trimEvidence(firstSentence)}”。`];
  }

  return [];
}

function detectStructureIssues(
  content: string,
  previousChapters: ReadonlyArray<string | StyleGuardChapter>,
): string[] {
  const issues: string[] = [];
  const allChapters = [
    ...previousChapters.map((chapter) => typeof chapter === "string" ? normalizeContent(chapter) : normalizeContent(chapter.content)),
    content,
  ];
  if (allChapters.length < 2) return issues;

  const detected = allChapters.map((chapter) => detectStructures(chapter));
  for (let index = 1; index < detected.length; index += 1) {
    for (const pattern of detected[index]!) {
      if (!detected[index - 1]!.has(pattern)) continue;
      issues.push(`[high] 结构复读：连续章节出现“${STRUCTURE_RULES[pattern].label}”流程。`);
    }
  }

  return Array.from(new Set(issues));
}

function detectStructures(content: string): Set<StructurePattern> {
  const result = new Set<StructurePattern>();
  for (const [key, rule] of Object.entries(STRUCTURE_RULES) as ReadonlyArray<[StructurePattern, typeof STRUCTURE_RULES[StructurePattern]]>) {
    if (matchesOrderedSequence(content, rule.sequence)) {
      result.add(key);
    }
  }
  return result;
}

function matchesOrderedSequence(content: string, sequence: ReadonlyArray<RegExp>): boolean {
  let searchFrom = 0;
  for (const pattern of sequence) {
    const slice = content.slice(searchFrom);
    const match = pattern.exec(slice);
    if (!match || match.index === undefined) return false;
    searchFrom += match.index + match[0].length;
  }
  return true;
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .trim();
}

function extractFirstSentence(content: string): string {
  const firstParagraph = content
    .split(/\n+/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
  return firstParagraph.match(/^[^。！？!?]+[。！？!?]?/u)?.[0].trim() ?? firstParagraph;
}

function trimEvidence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}
