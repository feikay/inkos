import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaseAgent } from "./base.js";
import { OPENING_HOOK_METHODS } from "../story-methods/opening-hooks.js";

export const GOLDEN_3_CHAPTER_DIMENSIONS = [
  "opening_hook_delivery",
  "core_differentiator_visible",
  "long_term_goal_established",
  "three_chapter_arc",
  "setup_ratio_safe",
] as const;

export type Golden3ChapterDimension = typeof GOLDEN_3_CHAPTER_DIMENSIONS[number];
export type Golden3ChapterStatus = "PASS" | "WARN" | "FAIL_STRUCTURAL" | "SKIPPED";

export interface Golden3ChapterIssue {
  readonly severity: "info" | "warning" | "critical";
  readonly dimension: Golden3ChapterDimension | "resource_consistency" | "local_scan";
  readonly message: string;
  readonly suggestion?: string;
}

export interface Golden3ChapterReport {
  readonly chapterRange: [number, number];
  readonly status: Golden3ChapterStatus;
  readonly score: number | null;
  readonly dimensions: Record<Golden3ChapterDimension, number>;
  readonly dimensionConclusions: Record<Golden3ChapterDimension, string>;
  readonly strengths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<Golden3ChapterIssue>;
  readonly suggestions: ReadonlyArray<string>;
  readonly summary: string;
  readonly skippedReason?: string;
}

export interface Golden3ChapterReviewInput {
  readonly chapter1Content?: string;
  readonly chapter2Content?: string;
  readonly chapter3Content?: string;
  readonly first10ChapterPlan?: string;
  readonly resourceBlocking?: boolean;
  readonly chapterIndexStatus?: string;
}

const DIMENSION_LABELS: Record<Golden3ChapterDimension, string> = {
  opening_hook_delivery: "开头钩子兑现",
  core_differentiator_visible: "核心差异可见",
  long_term_goal_established: "长期目标建立",
  three_chapter_arc: "前三章弧线完整",
  setup_ratio_safe: "设定比例安全",
};

// ---- hard-scan signal sets ----

// opening_hook_delivery: Check ch1 for 5 hook type signals
const OPENING_HOOK_SIGNAL_GROUPS: Record<string, ReadonlyArray<RegExp>> = {
  "suspense-gap": [
    /疑问|为什么|怎么回事|不知道|秘密|真相|隐藏|掩盖|不为人知|莫名|奇怪|诡异|反常|异常/u,
    /遗书|尸体|失踪|消失|不见.{0,5}了|没.{0,3}回来|再也没/u,
    /谁.{0,5}(?:杀|害|死|做|干|偷|拿|来)了/u,
  ],
  "extreme-contrast": [
    /反差|竟然|居然|却.{0,5}(?:是|在|坐|站|拿|穿|说)|明明是.{0,10}却/u,
    /扫地|杂役|废材|废物|乞丐|奴隶|最低.{0,3}(?:身份|地位|等级|修为)/u,
    /坐上|继承|成为|拿到|获得.{0,8}(?:掌门|宗主|皇帝|王座|总裁|家主)/u,
  ],
  "conflict-first": [
    /刀|剑|枪|血|杀|死|伤|逃|追|围|困|逼|审|判|关|押|绑/u,
    /威胁|危险|追杀|袭击|背叛|出卖|陷阱|圈套|埋伏/u,
    /刀架|抵在|指着|对准|瞄准.{0,5}(?:脖子|喉咙|头|心口|背)/u,
  ],
  "worldview-bomb": [
    /世界|规则|法则|天道|系统|面板|属性|等级|境界|修为|灵力|魔力/u,
    /必须|只能|不得|禁止|不允许|没有.{0,5}(?:敢|能|会)/u,
    /纳税|交税|代价|寿命|支付|消耗.{0,5}(?:影子|记忆|情感|灵魂|时间)/u,
  ],
  "extreme-emotion": [
    /不公|委屈|屈辱|羞辱|愤怒|恨|仇|怨|跪|求|哭|泪|践踏|被夺|被抢/u,
    /凭什么|为什么.{0,5}(?:是我|对他|对她|这样)|不配|没资格/u,
    /替.{0,5}(?:跪|死|扛|背|担|受)|替罪|背锅|冤枉/u,
  ],
};

// core_differentiator_visible: Check ch2 for golden finger / ability / difference exposition
const CORE_DIFFERENTIATOR_SIGNALS = [
  /金手指|系统|面板|能力|技能|天赋|觉醒|解锁|开启|激活|获得.{0,5}(?:了|到)/u,
  /独有|唯一|特殊|不同|不一样|区别|差距|优势|领先/u,
  /别人.{0,5}(?:没有|不会|做不到|不知道|看不到)/u,
  /只有.{0,5}(?:他|她|我|主角)/u,
  /境界|等级|修为|段位|层次.{0,5}(?:突破|提升|进阶|跨越)/u,
  /核心|本源|法则|奥义|真意|道.{0,5}(?:领悟|掌握|突破)/u,
];

// long_term_goal_established: Check ch3 for clear long-term goal
const LONG_TERM_GOAL_SIGNALS = [
  /目标|目地|方向.{0,5}(?:明确|清晰|确定)/u,
  /一定要|必须要|非要|非得|誓要|决心|决定|立志/u,
  /复仇|崛起|成神|成仙|登顶|称霸|统一|覆灭|颠覆/u,
  /变强|成长|修炼|升级|进化.{0,5}(?:到底|到顶|至极|巅峰)/u,
  /保护|守护|拯救|解放.{0,5}(?:家人|朋友|宗门|国家|世界|所有人)/u,
  /查出|揭开|找出|找到.{0,5}(?:真相|秘密|凶手|答案)/u,
];

// three_chapter_arc: Content signals for arc progression
const ARC_SIGNALS_CH1 = [
  /冲突|威胁|危险|问题|困境|危机|异常|变故/u,
  /开始|降临|出现|发生|爆发|闯入/u,
];

const ARC_SIGNALS_CH2 = [
  /规则|方法|方式|途径|系统|面板|能力|技能|天赋/u,
  /了解|知道|明白|发现|察觉|意识.{0,5}到/u,
];

const ARC_SIGNALS_CH3 = [
  /推进|进展|进步|突破|向前|迈出|走出/u,
  /第一次|首次|初.{0,3}(?:次|回|步|战|试)/u,
  /结果|成果|收获|回报|变化/u,
];

// setup_ratio_safe: Detect excessive setting/explanation paragraphs
const SETUP_INDICATOR_PATTERNS = [
  /^(?:系统|设定|背景|世界观|力量体系|等级|境界|修为|规则|法则|说明|介绍|概述)/u,
  /(?:体系|规则|等级|境界)如下[:：]/u,
  /(?:分为|包括|包含)(?:下列|以下|三种|四种|五种|几种|多)/u,
  /(?:首先|其次|再次|最后|第一|第二|第三).{0,3}(?:是|，|。|：|:)/u,
];

// ---- review implementation ----

export function buildSkippedGolden3ChapterReport(input: Golden3ChapterReviewInput, reason: string): Golden3ChapterReport {
  return {
    chapterRange: [1, 3],
    status: "SKIPPED",
    score: null,
    dimensions: { ...DEFAULT_GOLDEN_SCORES },
    dimensionConclusions: defaultGoldenConclusions(reason),
    strengths: [],
    issues: [{
      severity: "info",
      dimension: "resource_consistency",
      message: reason,
      suggestion: "修复资源问题或补齐前三章后重新审核。",
    }],
    suggestions: ["修复资源闭合或补齐前三章后重新运行 golden_3_chapter review。"],
    summary: `跳过：${reason}`,
    skippedReason: reason,
  };
}

export class Golden3ChapterAgent extends BaseAgent {
  get name(): string {
    return "golden-3-chapter";
  }

  async review(input: Golden3ChapterReviewInput): Promise<Golden3ChapterReport> {
    // Resource blocking / chapter status degraded → skip
    if (input.resourceBlocking) {
      return buildSkippedGolden3ChapterReport(input, "资源账本校验失败，跳过前三章开篇审核。");
    }
    if (input.chapterIndexStatus === "state-degraded" || input.chapterIndexStatus === "blocked-resource-plan") {
      return buildSkippedGolden3ChapterReport(input, `章节状态为 ${input.chapterIndexStatus}，跳过前三章开篇审核。`);
    }

    const ch1 = input.chapter1Content ?? "";
    const ch2 = input.chapter2Content ?? "";
    const ch3 = input.chapter3Content ?? "";

    // Require all three chapters; any missing → skip to avoid misjudging incomplete input
    if (!ch1.trim() || !ch2.trim() || !ch3.trim()) {
      const missing = [];
      if (!ch1.trim()) missing.push("第1章");
      if (!ch2.trim()) missing.push("第2章");
      if (!ch3.trim()) missing.push("第3章");
      return buildSkippedGolden3ChapterReport(input, `前三章未齐全（缺失：${missing.join("、")}），无法执行完整开篇审核。`);
    }

    const dimensions = { ...DEFAULT_GOLDEN_SCORES };
    const issues: Golden3ChapterIssue[] = [];
    const strengths: string[] = [];
    const conclusions: Record<Golden3ChapterDimension, string> = { ...defaultGoldenConclusions("未检测到明显信号。") };

    // Detect selected hook type from first_10_chapter_plan
    const selectedHookType = detectHookTypeFromPlan(input.first10ChapterPlan);

    // ---- opening_hook_delivery ----
    const ch1Opening = ch1.slice(0, 800);
    let bestHookScore = 0;
    let bestHookType = "";

    for (const [hookId, patterns] of Object.entries(OPENING_HOOK_SIGNAL_GROUPS)) {
      const matchCount = patterns.filter((p) => p.test(ch1Opening)).length;
      const score = Math.min(100, matchCount * 30 + 40);
      if (score > bestHookScore) {
        bestHookScore = score;
        bestHookType = hookId;
      }
    }

    if (bestHookScore >= 85) {
      dimensions.opening_hook_delivery = 90;
      const hookName = OPENING_HOOK_METHODS.find((h) => h.id === bestHookType)?.name ?? bestHookType;
      conclusions.opening_hook_delivery = `第1章开头检测到明确的"${hookName}"类型钩子信号。`;
      strengths.push(`第1章开头具备"${hookName}"钩子特征。`);
      if (selectedHookType && bestHookType !== selectedHookType) {
        issues.push({
          severity: "warning",
          dimension: "opening_hook_delivery",
          message: `实际检测到钩子类型为"${bestHookType}"，与 first_10_chapter_plan 选择的"${selectedHookType}"不一致。`,
          suggestion: "确认钩子类型是否刻意调整，或更新 first_10_chapter_plan 保持一致。",
        });
      }
    } else if (bestHookScore >= 55) {
      dimensions.opening_hook_delivery = 70;
      conclusions.opening_hook_delivery = "第1章开头有一定钩子信号但强度可加强。";
      issues.push({
        severity: "warning",
        dimension: "opening_hook_delivery",
        message: "第1章开头钩子信号偏弱，可能无法在前100-300字内抓住读者。",
        suggestion: "用具体异常画面、冲突动作或认知反差开场，确保前300字有明确钩子。",
      });
    } else {
      dimensions.opening_hook_delivery = 40;
      conclusions.opening_hook_delivery = "第1章开头未检测到明确钩子类型信号。";
      issues.push({
        severity: "critical",
        dimension: "opening_hook_delivery",
        message: "第1章开头未检测到五类钩子（悬念留白/极度反差/矛盾前置/颠覆世界观/极致情绪）的明显信号。",
        suggestion: "确保前300字以具体冲突、异常画面或认知反差开场，避免平铺直叙或背景说明。",
      });
    }

    // ---- core_differentiator_visible ----
    const ch2Body = ch2 || "";
    const diffSignals = CORE_DIFFERENTIATOR_SIGNALS.filter((p) => p.test(ch2Body));
    if (diffSignals.length >= 2) {
      dimensions.core_differentiator_visible = 90;
      conclusions.core_differentiator_visible = "第2章明确展示了核心金手指/能力/世界观差异。";
      strengths.push("第2章核心差异展示清晰。");
    } else if (diffSignals.length >= 1) {
      dimensions.core_differentiator_visible = 75;
      conclusions.core_differentiator_visible = "第2章有核心差异信号但展示可更具体。";
      issues.push({
        severity: "warning",
        dimension: "core_differentiator_visible",
        message: "第2章核心差异/金手指展示偏弱，读者可能不清楚这本书的独特卖点。",
        suggestion: "让主角在第2章至少使用一次核心能力/金手指，并展示其边界和代价。",
      });
    } else if (!ch2.trim()) {
      dimensions.core_differentiator_visible = 50;
      conclusions.core_differentiator_visible = "第2章正文不存在，无法评估。";
      issues.push({
        severity: "info",
        dimension: "core_differentiator_visible",
        message: "第2章尚未完成，待写入后重新审核。",
        suggestion: "写入第2章后重新运行 golden_3_chapter review。",
      });
    } else {
      dimensions.core_differentiator_visible = 45;
      conclusions.core_differentiator_visible = "第2章未检测到明确核心差异/金手指展示。";
      issues.push({
        severity: "critical",
        dimension: "core_differentiator_visible",
        message: "第2章未展示核心金手指、世界观差异或能力边界，读者可能缺乏继续阅读的独特理由。",
        suggestion: "第2章应展示主角的独特优势、系统面板、核心能力或世界观差异规则。",
      });
    }

    // ---- long_term_goal_established ----
    const ch3Body = ch3 || "";
    const goalSignals = LONG_TERM_GOAL_SIGNALS.filter((p) => p.test(ch3Body));
    if (goalSignals.length >= 2) {
      dimensions.long_term_goal_established = 90;
      conclusions.long_term_goal_established = "第3章明确了主角阶段性长期目标。";
      strengths.push("第3章长期目标清晰可追踪。");
    } else if (goalSignals.length >= 1) {
      dimensions.long_term_goal_established = 75;
      conclusions.long_term_goal_established = "第3章有目标方向但可更明确。";
      issues.push({
        severity: "warning",
        dimension: "long_term_goal_established",
        message: "第3章长期目标信号偏弱，读者可能不清楚主角的终极方向。",
        suggestion: "在第3章结尾或关键情节中，让主角明确说出或展示其阶段性长期目标。",
      });
    } else if (!ch3.trim()) {
      dimensions.long_term_goal_established = 50;
      conclusions.long_term_goal_established = "第3章正文不存在，无法评估。";
      issues.push({
        severity: "info",
        dimension: "long_term_goal_established",
        message: "第3章尚未完成，待写入后重新审核。",
        suggestion: "写入第3章后重新运行 golden_3_chapter review。",
      });
    } else {
      dimensions.long_term_goal_established = 45;
      conclusions.long_term_goal_established = "第3章未检测到明确长期目标。";
      issues.push({
        severity: "critical",
        dimension: "long_term_goal_established",
        message: "第3章未建立主角长期目标，前三章闭合后读者可能缺乏追读方向。",
        suggestion: "第3章需要明确主角的阶段性长期目标：复仇对象、成长方向、守护目标或真相探索。",
      });
    }

    // ---- three_chapter_arc ----
    if (ch1.trim() && ch2.trim() && ch3.trim()) {
      const ch1Arc = ARC_SIGNALS_CH1.filter((p) => p.test(ch1));
      const ch2Arc = ARC_SIGNALS_CH2.filter((p) => p.test(ch2));
      const ch3Arc = ARC_SIGNALS_CH3.filter((p) => p.test(ch3));

      const arcScore = Math.min(100,
        (ch1Arc.length >= 1 ? 30 : 10) +
        (ch2Arc.length >= 1 ? 35 : 15) +
        (ch3Arc.length >= 1 ? 35 : 15),
      );

      if (arcScore >= 80) {
        dimensions.three_chapter_arc = arcScore;
        conclusions.three_chapter_arc = "前三章形成'冲突暴露→规则/目标建立→第一次可见推进'的追读闭环。";
        strengths.push("前三章弧线完整，形成追读闭环。");
      } else if (arcScore >= 55) {
        dimensions.three_chapter_arc = arcScore;
        conclusions.three_chapter_arc = "前三章有一定弧线但闭环感可加强。";
        issues.push({
          severity: "warning",
          dimension: "three_chapter_arc",
          message: "前三章弧线不完整，可能缺少冲突暴露、规则建立或可见推进中的某一环。",
          suggestion: "确保：ch1暴露冲突/问题，ch2建立规则/能力，ch3展示第一次可见推进。",
        });
      } else {
        dimensions.three_chapter_arc = 40;
        conclusions.three_chapter_arc = "前三章未形成清晰追读闭环。";
        issues.push({
          severity: "critical",
          dimension: "three_chapter_arc",
          message: "前三章之间缺乏清晰的因果推进链（冲突→规则→推进），读者可能在三章内流失。",
          suggestion: "重审 ch1 冲突、ch2 规则展示、ch3 推进里程碑是否各自到位。",
        });
      }
    } else {
      dimensions.three_chapter_arc = 50;
      conclusions.three_chapter_arc = "前三章不全，无法完整评估弧线。";
      issues.push({
        severity: "info",
        dimension: "three_chapter_arc",
        message: "前三章未齐全，仅基于已有章节做部分评估。",
        suggestion: "完成全部前三章后重新运行以获得完整弧线评估。",
      });
    }

    // ---- setup_ratio_safe ----
    const allContent = ch1 + ch2 + ch3;
    const totalChars = allContent.replace(/\s/g, "").length;
    const paragraphs = allContent.split(/\n\n+/).filter((p) => p.trim());
    const setupParagraphs = paragraphs.filter((p) =>
      SETUP_INDICATOR_PATTERNS.some((pat) => pat.test(p.trim()))
    ).length;
    const setupRatio = paragraphs.length > 0 ? setupParagraphs / paragraphs.length : 0;

    // Also estimate setting proportion by character count in long explanatory paragraphs
    const longExplanatoryChars = paragraphs
      .filter((p) => p.replace(/\s/g, "").length > 200 && SETUP_INDICATOR_PATTERNS.some((pat) => pat.test(p.trim())))
      .reduce((sum, p) => sum + p.replace(/\s/g, "").length, 0);
    const explanatoryRatio = totalChars > 0 ? longExplanatoryChars / totalChars : 0;

    if (setupRatio <= 0.1 && explanatoryRatio <= 0.08) {
      dimensions.setup_ratio_safe = 90;
      conclusions.setup_ratio_safe = "设定/说明文字占比合理，不会挤压故事空间。";
      strengths.push("前三章设定比例安全，以故事推进为主。");
    } else if (setupRatio <= 0.2 && explanatoryRatio <= 0.15) {
      dimensions.setup_ratio_safe = 75;
      conclusions.setup_ratio_safe = "设定/说明文字占比略高但仍在可接受范围。";
      issues.push({
        severity: "warning",
        dimension: "setup_ratio_safe",
        message: "前三章设定说明段落占比偏高，可能拖慢开篇节奏。",
        suggestion: "将设定信息融入冲突动作，用主角体验代替百科式介绍。",
      });
    } else {
      dimensions.setup_ratio_safe = 45;
      conclusions.setup_ratio_safe = "设定/说明文字占比过高，严重影响开篇节奏。";
      issues.push({
        severity: "critical",
        dimension: "setup_ratio_safe",
        message: `前三章设定/说明段落占比过高（${Math.round(setupRatio * 100)}% 段落为设定性质），开篇节奏可能被拖累。`,
        suggestion: "大幅减少设定说明段落，将世界规则通过冲突和选择展示，而非在前三章集中介绍。",
      });
    }

    // ---- Compute overall score and status ----
    const score = Math.round(
      GOLDEN_3_CHAPTER_DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim], 0) / GOLDEN_3_CHAPTER_DIMENSIONS.length,
    );

    const hasCritical = issues.some((i) => i.severity === "critical");
    const hasWarning = issues.some((i) => i.severity === "warning");
    let status: Golden3ChapterStatus;
    if (score >= 85 && !hasCritical) {
      status = "PASS";
    } else if (score >= 70 || (!hasCritical && hasWarning)) {
      status = "WARN";
    } else {
      status = "FAIL_STRUCTURAL";
    }

    const suggestions = issues
      .filter((i) => i.suggestion)
      .map((i) => i.suggestion!);

    let summary: string;
    if (status === "PASS") {
      summary = `前三章开篇审核通过（${score}/100）。${strengths.join("；")}`;
    } else if (status === "WARN") {
      summary = `前三章开篇审核警告（${score}/100）。${issues.filter((i) => i.severity === "warning").map((i) => i.message).join("；")}`;
    } else {
      summary = `前三章开篇审核未通过（${score}/100）。${issues.filter((i) => i.severity === "critical").map((i) => i.message).join("；")}`;
    }

    return {
      chapterRange: [1, 3],
      status,
      score,
      dimensions,
      dimensionConclusions: conclusions,
      strengths: [...new Set(strengths)],
      issues,
      suggestions,
      summary,
    };
  }
}

// ---- helpers ----

function detectHookTypeFromPlan(plan?: string): string | null {
  if (!plan) return null;
  for (const hook of OPENING_HOOK_METHODS) {
    if (plan.includes(hook.id) || plan.includes(hook.name)) {
      return hook.id;
    }
  }
  return null;
}

function defaultGoldenConclusions(value: string): Record<Golden3ChapterDimension, string> {
  return Object.fromEntries(
    GOLDEN_3_CHAPTER_DIMENSIONS.map((dim) => [dim, value]),
  ) as Record<Golden3ChapterDimension, string>;
}

const DEFAULT_GOLDEN_SCORES: Record<Golden3ChapterDimension, number> = {
  opening_hook_delivery: 85,
  core_differentiator_visible: 85,
  long_term_goal_established: 85,
  three_chapter_arc: 85,
  setup_ratio_safe: 85,
};

// ---- file I/O ----

export async function writeGolden3ChapterReportFiles(params: {
  readonly report: Golden3ChapterReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(params.jsonPath), { recursive: true }),
    mkdir(dirname(params.markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(params.jsonPath, JSON.stringify(params.report, null, 2), "utf-8"),
    writeFile(params.markdownPath, renderGolden3ChapterMarkdown(params.report), "utf-8"),
  ]);
}

export function renderGolden3ChapterMarkdown(report: Golden3ChapterReport): string {
  const rows = GOLDEN_3_CHAPTER_DIMENSIONS
    .map((dim) => `| ${DIMENSION_LABELS[dim]} | ${report.dimensions[dim]} | ${report.dimensionConclusions[dim] || "-"} |`)
    .join("\n");
  const issues = report.issues.length
    ? report.issues.map((i) => `- [${i.severity}] ${i.dimension}: ${i.message}${i.suggestion ? ` 建议：${i.suggestion}` : ""}`).join("\n")
    : "- 无";
  const strengths = report.strengths.length
    ? report.strengths.map((item) => `- ${item}`).join("\n")
    : "- 无";
  const suggestions = report.suggestions.length
    ? report.suggestions.map((item) => `- ${item}`).join("\n")
    : "- 无";

  const conclusion = report.status === "PASS"
    ? "前三章开篇审核通过，具备基本的开篇留存结构。"
    : report.status === "WARN"
      ? "前三章存在部分开篇弱点，建议人工关注后发布。"
      : report.status === "FAIL_STRUCTURAL"
        ? "前三章存在严重开篇结构缺陷，建议人工审查后调整。"
        : `跳过：${report.skippedReason ?? "未执行审核。"}`;

  return `# Golden 3-Chapter Review Report

- 范围：第${report.chapterRange[0]}-${report.chapterRange[1]}章
- 状态：${report.status}
- 总分：${report.score ?? "N/A"}

## 五维度开篇审核

| 维度 | 分数 | 结论 |
|---|---:|---|
${rows}

## 优点

${strengths}

## 问题

${issues}

## 建议

${suggestions}

## 结论

${conclusion}

## 摘要

${report.summary}
`;
}

export async function readGolden3ChapterSummary(
  bookDir: string,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const file = join(bookDir, "reviews", "golden-3-chapter", "golden-3-chapter.report.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const report = JSON.parse(raw) as Partial<Golden3ChapterReport>;
    return {
      status: report.status ?? "UNKNOWN",
      score: report.score ?? null,
      summary: report.summary ?? "",
    };
  } catch {
    return undefined;
  }
}
