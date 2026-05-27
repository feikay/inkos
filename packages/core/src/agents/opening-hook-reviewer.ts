import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaseAgent } from "./base.js";
import { OPENING_HOOK_METHODS } from "../story-methods/opening-hooks.js";
import type { StructureSignals, StructureSignalReport } from "../utils/structure-signals.js";
import { buildStructureSignalReport, STRUCTURE_SIGNAL_DIMENSIONS } from "../utils/structure-signals.js";

export const OPENING_HOOK_DIMENSIONS = [
  "suspense_gap",
  "extreme_contrast",
  "conflict_first",
  "worldview_bomb",
  "extreme_emotion",
] as const;

export type OpeningHookDimension = typeof OPENING_HOOK_DIMENSIONS[number];
export type OpeningHookStatus = "PASS" | "WARN" | "FAIL_STRUCTURAL" | "SKIPPED";
export type HookStrength = "strong" | "moderate" | "weak" | "undetected";

export interface OpeningHookIssue {
  readonly severity: "info" | "warning" | "critical";
  readonly dimension: OpeningHookDimension | "checklist" | "resource_consistency";
  readonly message: string;
  readonly suggestion?: string;
}

export interface OpeningHookChecklist {
  readonly abnormalImage100: boolean;
  readonly conflict300: boolean;
  readonly dilemma500: boolean;
  readonly continueReason: boolean;
  readonly hookTypeMatched: boolean;
}

export interface OpeningHookReviewReport {
  readonly chapterIndex: number;
  readonly chapterTitle?: string;
  readonly status: OpeningHookStatus;
  readonly score: number | null;
  readonly detectedHookType: string | null;
  readonly hookStrength: HookStrength;
  readonly dimensions: Record<OpeningHookDimension, number>;
  readonly dimensionConclusions: Record<OpeningHookDimension, string>;
  readonly checklist: OpeningHookChecklist;
  readonly strengths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<OpeningHookIssue>;
  readonly suggestions: ReadonlyArray<string>;
  readonly summary: string;
  readonly skippedReason?: string;
  readonly structureSignalReport?: StructureSignalReport;
}

export interface OpeningHookReviewInput {
  readonly chapterContent?: string;
  readonly chapterIndex?: number;
  readonly chapterTitle?: string;
  readonly resourceBlocking?: boolean;
  readonly chapterIndexStatus?: string;
  readonly structureSignals?: StructureSignals | null;
}

const DIMENSION_LABELS: Record<OpeningHookDimension, string> = {
  suspense_gap: "悬念留白",
  extreme_contrast: "极度反差",
  conflict_first: "矛盾前置",
  worldview_bomb: "世界观炸弹",
  extreme_emotion: "极致情绪",
};

// Map opening hook dimensions to structure signal dimensions for book-level phrase matching
const DIM_TO_STRUCTURE_SIGNALS: Record<OpeningHookDimension, (typeof STRUCTURE_SIGNAL_DIMENSIONS)[number][]> = {
  suspense_gap: ["opening_hook", "ending_pull"],
  extreme_contrast: ["opening_hook", "pressure_source"],
  conflict_first: ["opening_hook", "pressure_source", "obstacle_dilemma"],
  worldview_bomb: ["world_rule"],
  extreme_emotion: ["opening_hook", "pressure_source"],
};

// Signal groups — shared pattern with golden_3_chapter opening_hook_delivery
const HOOK_SIGNAL_GROUPS: Record<string, ReadonlyArray<RegExp>> = {
  suspense_gap: [
    /疑问|为什么|怎么回事|不知道|秘密|真相|隐藏|掩盖|不为人知|莫名|奇怪|诡异|反常|异常/u,
    /遗书|尸体|失踪|消失|不见.{0,5}了|没.{0,3}回来|再也没/u,
    /谁.{0,5}(?:杀|害|死|做|干|偷|拿|来)了/u,
  ],
  extreme_contrast: [
    /反差|竟然|居然|却.{0,5}(?:是|在|坐|站|拿|穿|说)|明明是.{0,10}却/u,
    /扫地|杂役|废材|废物|乞丐|奴隶|最低.{0,3}(?:身份|地位|等级|修为)/u,
    /坐上|继承|成为|拿到|获得.{0,8}(?:掌门|宗主|皇帝|王座|总裁|家主)/u,
  ],
  conflict_first: [
    /刀|剑|枪|血|杀|死|伤|逃|追|围|困|逼|审|判|关|押|绑/u,
    /威胁|危险|追杀|袭击|背叛|出卖|陷阱|圈套|埋伏/u,
    /刀架|抵在|指着|对准|瞄准.{0,5}(?:脖子|喉咙|头|心口|背)/u,
  ],
  worldview_bomb: [
    /世界|规则|法则|天道|系统|面板|属性|等级|境界|修为|灵力|魔力/u,
    /必须|只能|不得|禁止|不允许|没有.{0,5}(?:敢|能|会)/u,
    /纳税|交税|代价|寿命|支付|消耗.{0,5}(?:影子|记忆|情感|灵魂|时间)/u,
  ],
  extreme_emotion: [
    /不公|委屈|屈辱|羞辱|愤怒|恨|仇|怨|跪|求|哭|泪|践踏|被夺|被抢/u,
    /凭什么|为什么.{0,5}(?:是我|对他|对她|这样)|不配|没资格/u,
    /替.{0,5}(?:跪|死|扛|背|担|受)|替罪|背锅|冤枉/u,
  ],
};

// ---- checklist signals ----
const ABNORMAL_IMAGE_PATTERNS = [
  /异常|奇怪|诡异|不对|不.{0,3}(?:一样|相同|正常|对劲)/u,
  /面板|系统|属性|等级|弹窗|提示|任务.{0,3}(?:发布|出现|更新)/u,
  /死|尸体|血|伤|杀|亡|灭|毁|碎|裂|断|烧/u,
];

const CONFLICT_PATTERNS = [
  /杀|死|打|战|斗|逃|追|围|逼|审|判|关|押|刀|剑|枪|血/u,
  /威胁|危险|冲突|敌人|对手|追杀|袭击|背叛|出卖|陷阱/u,
  /质问|逼问|怒|吼|喝|斥|骂|呵/u,
];

const DILEMMA_PATTERNS = [
  /只能|必须|不得不|没.{0,3}选择|要么.{0,10}要么/u,
  /代价|后果|否则|不然.{0,12}(?:就|会|将|等|所有人|死|活不成)/u,
  /保护|守护|拯救|活下去|逃出去|变强|复仇|护住|守住|挡下/u,
  /目标|倒计时|死局|立刻.{0,8}选择|只要慢半拍/u,
];

const CONTINUE_REASON_PATTERNS = [
  /忽然|突然|下一刻|正要.{0,5}时|就在这时|没想到|竟然/u,
  /新的.{0,5}(?:线索|敌人|问题|危机|任务|消息)/u,
  /决定|选择|准备|打算.{0,5}(?:去|做|找|离|进)/u,
  /倒计时|掠夺权限|强制抽取|死局|必须立刻|裂了.{0,6}缝/u,
  /抬头|转身|睁开.{0,3}眼|笑了|点了点头/u,
];

// ---- review implementation ----

export function buildSkippedOpeningHookReport(
  input: OpeningHookReviewInput,
  reason: string,
): OpeningHookReviewReport {
  return {
    chapterIndex: input.chapterIndex ?? 0,
    chapterTitle: input.chapterTitle,
    status: "SKIPPED",
    score: null,
    detectedHookType: null,
    hookStrength: "undetected",
    dimensions: { ...DEFAULT_HOOK_SCORES },
    dimensionConclusions: defaultHookConclusions(reason),
    checklist: {
      abnormalImage100: false,
      conflict300: false,
      dilemma500: false,
      continueReason: false,
      hookTypeMatched: false,
    },
    strengths: [],
    issues: [{
      severity: "info",
      dimension: "resource_consistency",
      message: reason,
      suggestion: "修复阻断条件后重新运行 opening-hook review。",
    }],
    suggestions: ["修复阻断条件后重新运行 opening-hook review。"],
    summary: `跳过：${reason}`,
    skippedReason: reason,
  };
}

export class OpeningHookReviewerAgent extends BaseAgent {
  get name(): string {
    return "opening-hook-reviewer";
  }

  async review(input: OpeningHookReviewInput): Promise<OpeningHookReviewReport> {
    if (input.resourceBlocking) {
      return buildSkippedOpeningHookReport(input, "资源账本校验失败，跳过开头钩子审核。");
    }
    if (
      input.chapterIndexStatus === "state-degraded" ||
      input.chapterIndexStatus === "blocked-resource-plan"
    ) {
      return buildSkippedOpeningHookReport(
        input,
        `章节状态为 ${input.chapterIndexStatus}，跳过开头钩子审核。`,
      );
    }

    const content = input.chapterContent ?? "";
    if (!content.trim()) {
      return buildSkippedOpeningHookReport(input, "章节正文为空，跳过开头钩子审核。");
    }

    const opening = content.slice(0, 800);
    const dimensions = { ...DEFAULT_HOOK_SCORES };
    const issues: OpeningHookIssue[] = [];
    const strengths: string[] = [];
    const conclusions: Record<OpeningHookDimension, string> = {
      ...defaultHookConclusions("未检测到明显信号。"),
    };

    // ---- 5-type hook signal detection ----
    let bestHookScore = 0;
    let bestHookType = "";
    let totalMatches = 0;

    for (const [hookId, patterns] of Object.entries(HOOK_SIGNAL_GROUPS)) {
      const dim = hookId as OpeningHookDimension;
      const matchCount = patterns.filter((p) => p.test(opening)).length;

      // Count book-level structure signal phrase matches
      let bookMatches = 0;
      if (input.structureSignals) {
        const signalDims = DIM_TO_STRUCTURE_SIGNALS[dim] ?? [];
        for (const signalDim of signalDims) {
          const phrases = input.structureSignals.signals[signalDim] ?? [];
          for (const phrase of phrases) {
            if (opening.includes(phrase)) bookMatches++;
          }
        }
      }

      const totalMatchCount = matchCount + bookMatches;
      totalMatches += totalMatchCount;
      const score = Math.min(100, totalMatchCount * 25 + 40);
      if (totalMatchCount > 0 && score > bestHookScore) {
        bestHookScore = score;
        bestHookType = hookId;
      }
      dimensions[dim] = score;
    }

    let hookStrength: HookStrength;
    if (bestHookScore >= 85) {
      hookStrength = "strong";
    } else if (bestHookScore >= 55) {
      hookStrength = "moderate";
    } else if (bestHookScore >= 25) {
      hookStrength = "weak";
    } else {
      hookStrength = "undetected";
    }

    // Per-dimension conclusions
    for (const dim of OPENING_HOOK_DIMENSIONS) {
      const score = dimensions[dim];
      const methodId = dim.replace(/_/g, "-");
      const hookInfo = OPENING_HOOK_METHODS.find((h) => h.id === methodId);
      const hookName = hookInfo?.name ?? dim;
      if (score >= 85) {
        conclusions[dim] = `开头检测到明确的"${hookName}"信号。`;
      } else if (score >= 55) {
        conclusions[dim] = `开头有一定"${hookName}"信号但强度一般。`;
      } else {
        conclusions[dim] = `开头未检测到明显的"${hookName}"信号。`;
      }
    }

    if (bestHookType) {
      const methodId = bestHookType.replace(/_/g, "-");
      const hookInfo = OPENING_HOOK_METHODS.find((h) => h.id === methodId);
      const hookName = hookInfo?.name ?? bestHookType;
      conclusions[bestHookType as OpeningHookDimension] =
        `主要命中钩子类型为"${hookName}"（${bestHookScore}/100）。`;
      strengths.push(`开头命中"${hookName}"类型钩子（${bestHookScore}/100）。`);
    }

    if (hookStrength === "strong") {
      // No issue for strong hooks
    } else if (hookStrength === "moderate") {
      issues.push({
        severity: "warning",
        dimension: bestHookType as OpeningHookDimension || "conflict_first",
        message: "章节开头钩子信号偏弱，建议加强前300字的冲突、悬念或情绪张力。",
        suggestion: "用具体异常画面、冲突动作或认知反差开场，确保前300字有明确钩子。",
      });
    } else {
      issues.push({
        severity: "critical",
        dimension: "checklist",
        message: "章节开头未检测到五类钩子（悬念留白/极度反差/矛盾前置/颠覆世界观/极致情绪）的明显信号。",
        suggestion: "确保前300字以具体冲突、异常画面或认知反差开场，避免平铺直叙或背景说明。",
      });
    }

    // ---- GOLDEN_OPENING_REVIEW_CHECKLIST ----
    const first100 = content.slice(0, 100);
    const first300 = content.slice(0, 300);
    const first500 = content.slice(0, 500);
    const ending = content.slice(-500);

    const abnormalImage100 = ABNORMAL_IMAGE_PATTERNS.some((p) => p.test(first100));
    const conflict300 = CONFLICT_PATTERNS.some((p) => p.test(first300));
    const dilemma500 = DILEMMA_PATTERNS.some((p) => p.test(first500));
    const continueReason = CONTINUE_REASON_PATTERNS.some((p) => p.test(ending));
    const hookTypeMatched = bestHookType !== "";

    const checklist: OpeningHookChecklist = {
      abnormalImage100,
      conflict300,
      dilemma500,
      continueReason,
      hookTypeMatched,
    };

    const checklistPassed = [abnormalImage100, conflict300, dilemma500, continueReason, hookTypeMatched]
      .filter(Boolean).length;

    if (!abnormalImage100) {
      issues.push({
        severity: "warning",
        dimension: "checklist",
        message: "前100字未检测到异常画面或冲突信号，读者可能在第一屏流失。",
        suggestion: "用具体异常画面、冲突动作或世界观冲击开场。",
      });
    }
    if (!conflict300) {
      issues.push({
        severity: "warning",
        dimension: "checklist",
        message: "前300字未检测到明确冲突信号。",
        suggestion: "在前300字内引入可见冲突、威胁或压力。",
      });
    }
    if (!dilemma500) {
      issues.push({
        severity: "info",
        dimension: "checklist",
        message: "前500字未检测到明确的主角困境信号。",
        suggestion: "让主角面临必须选择或付出代价的局面。",
      });
    }
    if (!continueReason) {
      issues.push({
        severity: "warning",
        dimension: "checklist",
        message: "章末未检测到继续阅读钩子。",
        suggestion: "章末增加新危机、新线索、新决定或情绪悬念。",
      });
    }

    if (checklistPassed >= 4) {
      strengths.push(`黄金开篇清单通过 ${checklistPassed}/5。`);
    }

    // ---- score & status ----
    const avgDimensionScore = Math.round(
      OPENING_HOOK_DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim], 0) /
        OPENING_HOOK_DIMENSIONS.length,
    );
    const checklistScore = checklistPassed * 14; // 5 × 14 = 70
    const score = Math.round(avgDimensionScore * 0.3 + bestHookScore * 0.35 + checklistScore * 0.35);
    // A chapter only needs one dominant opening hook type; don't require every hook type at once.
    const finalScore = Math.max(score, checklistPassed >= 4 ? bestHookScore : avgDimensionScore - 10);

    const hasCritical = issues.some((i) => i.severity === "critical");
    const hasWarning = issues.some((i) => i.severity === "warning");
    let status: OpeningHookStatus;
    if (finalScore >= 80 && !hasCritical) {
      status = "PASS";
    } else if (finalScore >= 60 || (!hasCritical && hasWarning)) {
      status = "WARN";
    } else {
      status = "FAIL_STRUCTURAL";
    }

    const suggestions = issues
      .filter((i) => i.suggestion)
      .map((i) => i.suggestion!);

    let summary: string;
    if (status === "PASS") {
      summary = `章节开头钩子审核通过（${finalScore}/100）。${strengths.join("；")}`;
    } else if (status === "WARN") {
      summary = `章节开头钩子审核警告（${finalScore}/100）。${issues
        .filter((i) => i.severity === "warning")
        .map((i) => i.message)
        .join("；")}`;
    } else {
      summary = `章节开头钩子审核未通过（${finalScore}/100）。${issues
        .filter((i) => i.severity === "critical")
        .map((i) => i.message)
        .join("；")}`;
    }

    const structureSignalReport = input.structureSignals
      ? buildStructureSignalReport(content, input.structureSignals, [
          "opening_hook",
          "pressure_source",
          "obstacle_dilemma",
          "world_rule",
          "ending_pull",
        ])
      : undefined;

    return {
      chapterIndex: input.chapterIndex ?? 0,
      chapterTitle: input.chapterTitle,
      status,
      score: finalScore,
      detectedHookType: bestHookType || null,
      hookStrength,
      dimensions,
      dimensionConclusions: conclusions,
      checklist,
      strengths: [...new Set(strengths)],
      issues,
      suggestions,
      summary,
      structureSignalReport,
    };
  }
}

// ---- helpers ----

function defaultHookConclusions(value: string): Record<OpeningHookDimension, string> {
  return Object.fromEntries(
    OPENING_HOOK_DIMENSIONS.map((dim) => [dim, value]),
  ) as Record<OpeningHookDimension, string>;
}

const DEFAULT_HOOK_SCORES: Record<OpeningHookDimension, number> = {
  suspense_gap: 55,
  extreme_contrast: 55,
  conflict_first: 55,
  worldview_bomb: 55,
  extreme_emotion: 55,
};

// ---- file I/O ----

export async function writeOpeningHookReportFiles(params: {
  readonly report: OpeningHookReviewReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(params.jsonPath), { recursive: true }),
    mkdir(dirname(params.markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(params.jsonPath, JSON.stringify(params.report, null, 2), "utf-8"),
    writeFile(params.markdownPath, renderOpeningHookMarkdown(params.report), "utf-8"),
  ]);
}

export function renderOpeningHookMarkdown(report: OpeningHookReviewReport): string {
  const rows = OPENING_HOOK_DIMENSIONS.map(
    (dim) =>
      `| ${DIMENSION_LABELS[dim]} | ${report.dimensions[dim]} | ${report.dimensionConclusions[dim] || "-"} |`,
  ).join("\n");

  const checklistRows = [
    `| 前100字异常画面 | ${report.checklist.abnormalImage100 ? "通过" : "未通过"} |`,
    `| 前300字明确冲突 | ${report.checklist.conflict300 ? "通过" : "未通过"} |`,
    `| 前500字主角困境 | ${report.checklist.dilemma500 ? "通过" : "未通过"} |`,
    `| 章末继续阅读理由 | ${report.checklist.continueReason ? "通过" : "未通过"} |`,
    `| 命中开头钩子类型 | ${report.checklist.hookTypeMatched ? "通过" : "未通过"} |`,
  ].join("\n");

  const issues = report.issues.length
    ? report.issues
        .map(
          (i) =>
            `- [${i.severity}] ${i.dimension}: ${i.message}${i.suggestion ? ` 建议：${i.suggestion}` : ""}`,
        )
        .join("\n")
    : "- 无";

  const strengths = report.strengths.length
    ? report.strengths.map((item) => `- ${item}`).join("\n")
    : "- 无";

  const suggestions = report.suggestions.length
    ? report.suggestions.map((item) => `- ${item}`).join("\n")
    : "- 无";

  const conclusion =
    report.status === "PASS"
      ? "章节开头钩子审核通过，开头具备基本留存结构。"
      : report.status === "WARN"
        ? "章节开头存在部分钩子弱点，建议人工关注后发布。"
        : report.status === "FAIL_STRUCTURAL"
          ? "章节开头存在严重钩子结构缺陷，建议人工审查后调整。"
          : `跳过：${report.skippedReason ?? "未执行审核。"}`;

  const detectedType = report.detectedHookType;
  const hookTypeLabel = detectedType
    ? OPENING_HOOK_METHODS.find((h) => h.id === detectedType.replace(/_/g, "-"))?.name ?? detectedType
    : "未检测到";

  return `# Opening Hook Review Report

- 章节：${String(report.chapterIndex).padStart(4, "0")}${report.chapterTitle ? ` ${report.chapterTitle}` : ""}
- 状态：${report.status}
- 总分：${report.score ?? "N/A"}
- 检测钩子类型：${hookTypeLabel}
- 钩子强度：${report.hookStrength}

## 五类钩子信号

| 维度 | 分数 | 结论 |
|---|---:|---|
${rows}

## 黄金开篇清单

| 检查项 | 结果 |
|---|---|
${checklistRows}

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

export async function readOpeningHookSummary(
  bookDir: string,
  chapterIndex: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const prefix = String(chapterIndex).padStart(4, "0");
  const file = join(bookDir, "reviews", "opening-hook", `${prefix}.opening-hook.report.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const report = JSON.parse(raw) as Partial<OpeningHookReviewReport>;
    return {
      status: report.status ?? "UNKNOWN",
      score: report.score ?? null,
      summary: report.summary ?? "",
    };
  } catch {
    return undefined;
  }
}
