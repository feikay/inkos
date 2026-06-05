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
  readonly genre?: string;
  readonly bookResourceRewards?: ReadonlyArray<string>;
  readonly bookActiveAttempts?: ReadonlyArray<string>;
  readonly bookPayoffRewards?: ReadonlyArray<string>;
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
  /^([^。！？\n]{1,6}知道)/u, // 🟢 泛化为匹配任意人名开头的“知道”（如楚夜/陈安/他知道）
  /^前方[^。！？\n]{0,20}(未知|危险|秘密)/u,
  /^(这场|这一切|此行|本次)/u, // 🟢 泛化为匹配通用的“这场/本次任务”
  /^(上一章|本章|故事)/u,
];

const OPENING_EVENT_PATTERNS: ReadonlyArray<RegExp> = [
  /忽然|突然|骤然|猛地|传来|响起|亮起|裂开|倒流|发烫|震动|渗出|浮现|现身|扑来|坠落|炸开/u,
  /按住|握住|拔出|抽出|抬手|后退|停下|踩过|推开|撞上|砸在|咬住|伸手|转身|冲出|跪下|横在|吸了/u,
  /咆哮|脚步声|血迹|符文|警告|弹窗|面板|道具|线索|提示|尸体|伤口|火光|水声/u, // 🟢 增加警告、弹窗、面板、道具、线索、提示等通用词
];

function compileStructureRules(options: StyleGuardOptions) {
  // 动态编译资源正则词，如果书里配置了“系统积分、bug点数”则匹配它们，否则 fallback 兼容原有“玉牌、灵石”
  const resourcesPattern = options.bookResourceRewards?.length
    ? new RegExp(options.bookResourceRewards.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "u")
    : /玉牌|灵石|法宝|资源/u;

  // 动态编译行为正则词，如果书里配置了“卡bug、测规则”则匹配它们，否则 fallback 兼容原有“战斗、迎战、拔剑”
  const actionPattern = options.bookActiveAttempts?.length
    ? new RegExp([...options.bookActiveAttempts, "战斗", "交锋", "冲突", "对抗", "动手"].map(a => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "u")
    : /战斗|迎战|交锋|厮杀|搏杀|拔剑|出手/u;

  return {
    "combat-loot-jade": {
      label: options.bookResourceRewards?.length ? "对抗/行动 → 掉落/结算 → 资源获得" : "战斗 → 掉落 → 玉牌",
      sequence: [
        /战斗|交锋|厮杀|对峙|提交|完成|判定|击杀|失败/u,
        /掉落|散落|结算|奖励|到账|获得|获取|搜寻/u,
        resourcesPattern,
      ],
    },
    "explore-sense-combat": {
      label: options.bookActiveAttempts?.length ? "探索/分析 → 感知/发现 → 冲突/动作" : "探索 → 感知 → 战斗",
      sequence: [
        /探索|前行|深入|分析|理清|查看|进入/u,
        /感知|感觉|察觉|意识到|发现|提示|弹出/u,
        actionPattern,
      ],
    },
  };
}

export function validateStyleGuard(content: string, options: StyleGuardOptions = {}): StyleGuardResult {
  const issues: string[] = [];
  const normalizedContent = normalizeContent(content);

  issues.push(...detectForbiddenPhrases(normalizedContent));
  issues.push(...detectOpeningIssue(normalizedContent));

  // 🟢 动态装配结构规则进行校验
  const structureRules = compileStructureRules(options);
  issues.push(...detectStructureIssues(normalizedContent, options.previousChapters ?? [], structureRules));

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
  structureRules: ReturnType<typeof compileStructureRules>,
): string[] {
  const issues: string[] = [];
  const allChapters = [
    ...previousChapters.map((chapter) => typeof chapter === "string" ? normalizeContent(chapter) : normalizeContent(chapter.content)),
    content,
  ];
  if (allChapters.length < 2) return issues;

  const detected = allChapters.map((chapter) => detectStructures(chapter, structureRules));
  for (let index = 1; index < detected.length; index += 1) {
    for (const pattern of detected[index]!) {
      if (!detected[index - 1]!.has(pattern)) continue;
      issues.push(`[high] 结构复读：连续章节出现“${structureRules[pattern].label}”流程。`);
    }
  }

  return Array.from(new Set(issues));
}

function detectStructures(content: string, structureRules: ReturnType<typeof compileStructureRules>): Set<StructurePattern> {
  const result = new Set<StructurePattern>();
  for (const [key, rule] of Object.entries(structureRules) as ReadonlyArray<[StructurePattern, typeof structureRules[StructurePattern]]>) {
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
