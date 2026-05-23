import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaseAgent } from "./base.js";
import { SIX_STEP_PLOT_METHOD } from "../story-methods/six-step-plot.js";

export const SIX_STEP_PLOT_DIMENSIONS = [
  "emotion_event",
  "desire_goal",
  "obstacle_dilemma",
  "solution_possibility",
  "action_resolution",
  "ending_feedback",
] as const;

export type SixStepPlotDimension = typeof SIX_STEP_PLOT_DIMENSIONS[number];
export type SixStepPlotStatus = "PASS" | "WARN" | "FAIL_STRUCTURAL" | "SKIPPED";

export interface SixStepPlotIssue {
  readonly severity: "info" | "warning" | "critical";
  readonly dimension: SixStepPlotDimension | "method_compliance" | "resource_consistency";
  readonly message: string;
  readonly suggestion?: string;
}

export interface SixStepPlotMethodCompliance {
  readonly checklistPassed: number;
  readonly checklistTotal: number;
  readonly commonFailuresDetected: string[];
}

export interface SixStepPlotIntentFidelity {
  readonly fieldsMatched: number;
  readonly fieldsTotal: number;
  readonly fieldsPresent: string[];
  readonly fieldsMissing: string[];
}

export interface SixStepPlotReport {
  readonly chapterIndex: number;
  readonly chapterTitle?: string;
  readonly status: SixStepPlotStatus;
  readonly score: number | null;
  readonly dimensions: Record<SixStepPlotDimension, number>;
  readonly dimensionConclusions: Record<SixStepPlotDimension, string>;
  readonly methodCompliance: SixStepPlotMethodCompliance;
  readonly intentFidelity?: SixStepPlotIntentFidelity;
  readonly strengths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<SixStepPlotIssue>;
  readonly suggestions: ReadonlyArray<string>;
  readonly summary: string;
  readonly skippedReason?: string;
}

export interface SixStepPlotReviewInput {
  readonly chapterContent?: string;
  readonly chapterIndex?: number;
  readonly chapterTitle?: string;
  readonly chapterIntent?: string;
  readonly resourceBlocking?: boolean;
  readonly chapterIndexStatus?: string;
}

// ---- dimension labels from SIX_STEP_PLOT_METHOD ----

const DIMENSION_LABELS: Record<SixStepPlotDimension, string> = Object.fromEntries(
  SIX_STEP_PLOT_METHOD.steps.map((s) => {
    const dimId = s.id.replace(/-/g, "_") as SixStepPlotDimension;
    return [dimId, s.name];
  }),
) as Record<SixStepPlotDimension, string>;

// Map dimension IDs → step IDs in SIX_STEP_PLOT_METHOD
const DIM_TO_STEP_ID: Record<SixStepPlotDimension, string> = Object.fromEntries(
  SIX_STEP_PLOT_METHOD.steps.map((s) => {
    const dimId = s.id.replace(/-/g, "_") as SixStepPlotDimension;
    return [dimId, s.id];
  }),
) as Record<SixStepPlotDimension, string>;

// ---- signal groups built from SIX_STEP_PLOT_METHOD ----

function buildSignalsFromHints(hints: readonly string[]): RegExp[] {
  const patterns: RegExp[] = [];
  const seen = new Set<string>();

  for (const hint of hints) {
    // Extract meaningful Chinese phrases from hint text
    const phrases = hint.split(/[，。、；：？！\s""]+/).filter((p) => {
      const len = p.length;
      return len >= 2 && len <= 6 && !/^[的得了着过是]/u.test(p) && !seen.has(p);
    });
    for (const phrase of phrases) {
      seen.add(phrase);
      patterns.push(new RegExp(phrase, "u"));
    }
  }
  return patterns;
}

function buildSignalsFromChecklist(items: readonly string[]): RegExp[] {
  const patterns: RegExp[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    // Extract key nouns and verbs from checklist questions
    const cleaned = item.replace(/是否|具体|明确|单一|清晰|可行动|读者|作者|检查/g, "");
    const phrases = cleaned.split(/[，。、；：？！\s"".、，]+/).filter((p) => {
      const len = p.length;
      return len >= 2 && len <= 10 && !/^[的了着过是]/u.test(p) && !seen.has(p);
    });
    for (const phrase of phrases) {
      seen.add(phrase);
      patterns.push(new RegExp(phrase, "u"));
    }
  }
  return patterns;
}

// Per-dimension signal patterns
const SIGNAL_GROUPS: Record<SixStepPlotDimension, RegExp[]> = (() => {
  const groups: Record<string, RegExp[]> = {};
  for (const step of SIX_STEP_PLOT_METHOD.steps) {
    const dimId = step.id.replace(/-/g, "_");
    const hintSignals = buildSignalsFromHints(step.promptHints);
    const checklistSignals = buildSignalsFromChecklist(step.reviewChecklist);
    groups[dimId] = [...new Set([...hintSignals, ...checklistSignals].map((r) => r.source))].map(
      (s) => new RegExp(s, "u"),
    );
  }
  return groups as Record<SixStepPlotDimension, RegExp[]>;
})();

// ---- common failure patterns from SIX_STEP_PLOT_METHOD ----

const COMMON_FAILURE_PATTERNS = SIX_STEP_PLOT_METHOD.commonFailures.map((failure, idx) => ({
  id: `failure_${idx}`,
  description: failure,
  patterns: (() => {
    // Extract key signals from the failure description
    const p: RegExp[] = [];
    if (failure.includes("设定说明") || failure.includes("冲突画面")) {
      p.push(/设定说明|背景设定|体系介绍|世界观介绍|只写设定|纯设定/u);
    }
    if (failure.includes("目标太散") || failure.includes("牵引力")) {
      // Absence pattern — detected by weak desire_goal score, not regex
    }
    if (failure.includes("为虐而虐") || failure.includes("破局希望")) {
      p.push(/为虐而虐|只虐不|反复折磨|惩罚主角|打压主角/u);
    }
    if (failure.includes("巧合") || failure.includes("反派降智")) {
      p.push(/巧合|凑巧|恰好|碰巧|运气/u);
    }
    if (failure.includes("没有收益") || failure.includes("变化") || failure.includes("下一章")) {
      // Absence pattern — detected by weak ending_feedback score
    }
    return p;
  })(),
}));

// ---- helpers ----

function detectCommonFailures(content: string, dimensions: Record<SixStepPlotDimension, number>): string[] {
  const failures: string[] = [];

  for (const failure of COMMON_FAILURE_PATTERNS) {
    let matched = false;

    // Check regex patterns
    for (const pattern of failure.patterns) {
      if (pattern.test(content)) {
        matched = true;
        break;
      }
    }

    // Special cases based on dimension scores
    if (!matched) {
      if (failure.description.includes("目标太散") && dimensions.desire_goal < 55) {
        matched = true;
      }
      if (failure.description.includes("没有收益") && dimensions.ending_feedback < 55) {
        matched = true;
      }
    }

    if (matched) {
      failures.push(failure.description);
    }
  }

  return failures;
}

function countChecklistPassed(
  content: string,
  stepId: string,
  items: readonly string[],
): number {
  let passed = 0;
  for (const item of items) {
    // Extract key signal words from checklist item
    const keywords = item
      .replace(/是否|具体|明确|读者|作者|检查|避免/g, "")
      .split(/[，。、；：？！\s""]+/)
      .filter((w) => w.length >= 2);
    const matchCount = keywords.filter((kw) => content.includes(kw)).length;
    // Consider passed if at least 1 keyword from this checklist item is found
    if (matchCount >= 1) passed++;
  }
  return passed;
}

// ---- intent fidelity from SIX_STEP_PLOT_METHOD.chapterIntentFields ----

function computeIntentFidelity(chapterIntent?: string): SixStepPlotIntentFidelity | undefined {
  if (!chapterIntent?.trim()) return undefined;

  const fieldsList = SIX_STEP_PLOT_METHOD.chapterIntentFields;
  const fieldsPresent: string[] = [];
  const fieldsMissing: string[] = [];

  for (const field of fieldsList) {
    if (chapterIntent.includes(field)) {
      fieldsPresent.push(field);
    } else {
      fieldsMissing.push(field);
    }
  }

  return {
    fieldsMatched: fieldsPresent.length,
    fieldsTotal: fieldsList.length,
    fieldsPresent,
    fieldsMissing,
  };
}

// ---- review implementation ----

export function buildSkippedSixStepPlotReport(
  input: SixStepPlotReviewInput,
  reason: string,
): SixStepPlotReport {
  return {
    chapterIndex: input.chapterIndex ?? 0,
    chapterTitle: input.chapterTitle,
    status: "SKIPPED",
    score: null,
    dimensions: { ...DEFAULT_PLOT_SCORES },
    dimensionConclusions: defaultPlotConclusions(reason),
    methodCompliance: { checklistPassed: 0, checklistTotal: 12, commonFailuresDetected: [] },
    strengths: [],
    issues: [
      {
        severity: "info",
        dimension: "resource_consistency",
        message: reason,
        suggestion: "修复阻断条件后重新运行 six-step-plot review。",
      },
    ],
    suggestions: ["修复阻断条件后重新运行 six-step-plot review。"],
    summary: `跳过：${reason}`,
    skippedReason: reason,
  };
}

export class SixStepPlotReviewerAgent extends BaseAgent {
  get name(): string {
    return "six-step-plot-reviewer";
  }

  async review(input: SixStepPlotReviewInput): Promise<SixStepPlotReport> {
    if (input.resourceBlocking) {
      return buildSkippedSixStepPlotReport(input, "资源账本校验失败，跳过六步剧情审核。");
    }
    if (
      input.chapterIndexStatus === "state-degraded" ||
      input.chapterIndexStatus === "blocked-resource-plan"
    ) {
      return buildSkippedSixStepPlotReport(
        input,
        `章节状态为 ${input.chapterIndexStatus}，跳过六步剧情审核。`,
      );
    }

    const content = input.chapterContent ?? "";
    if (!content.trim()) {
      return buildSkippedSixStepPlotReport(input, "章节正文为空，跳过六步剧情审核。");
    }

    const isVeryShort = content.trim().length < 200;

    // Intent fidelity — consume SIX_STEP_PLOT_METHOD.chapterIntentFields
    const intentFidelity = computeIntentFidelity(input.chapterIntent);

    // Per-dimension scoring
    const dimensions: Record<SixStepPlotDimension, number> = { ...DEFAULT_PLOT_SCORES };
    const conclusions: Record<SixStepPlotDimension, string> = {
      ...defaultPlotConclusions("未检测到明显信号。"),
    };
    const issues: SixStepPlotIssue[] = [];
    const strengths: string[] = [];

    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      const patterns = SIGNAL_GROUPS[dim];
      const matchCount = patterns ? patterns.filter((p) => p.test(content)).length : 0;
      const stepId = DIM_TO_STEP_ID[dim];
      const step = SIX_STEP_PLOT_METHOD.steps.find((s) => s.id === stepId);
      const checklistPassed = step ? countChecklistPassed(content, stepId, step.reviewChecklist) : 0;

      // Score: signal detection (0-60) + checklist (0-40)
      const signalScore = Math.min(60, matchCount * 8);
      const checklistScore = step ? checklistPassed * 20 : 0; // each of 2 items = 20 pts
      dimensions[dim] = Math.min(100, signalScore + checklistScore);
    }

    // Per-dimension conclusions
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      const score = dimensions[dim];
      const label = DIMENSION_LABELS[dim];
      if (score >= 70) {
        conclusions[dim] = `"${label}"结构完整，方法合规。`;
      } else if (score >= 40) {
        conclusions[dim] = `"${label}"部分信号存在，但结构偏弱。`;
      } else {
        conclusions[dim] = `"${label}"信号不足，六步结构可能缺失。`;
      }
    }

    // Common failures detection
    const commonFailuresDetected = detectCommonFailures(content, dimensions);

    // Dimension-specific issues
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      const score = dimensions[dim];
      const label = DIMENSION_LABELS[dim];
      const stepId = DIM_TO_STEP_ID[dim];
      const step = SIX_STEP_PLOT_METHOD.steps.find((s) => s.id === stepId);

      if (score < 40) {
        issues.push({
          severity: "critical",
          dimension: dim,
          message: `"${label}"信号严重不足，六步结构可能存在断裂。`,
          suggestion: step?.promptHints[0],
        });
      } else if (score < 55) {
        issues.push({
          severity: "warning",
          dimension: dim,
          message: `"${label}"信号偏弱，建议加强该步骤的叙事呈现。`,
          suggestion: step?.promptHints[0],
        });
      }
    }

    // Common failure issues
    for (const failure of commonFailuresDetected) {
      issues.push({
        severity: "warning",
        dimension: "method_compliance",
        message: `检测到常见失败模式：${failure}`,
        suggestion: "参考六步剧情方法调整本章结构。",
      });
    }

    if (isVeryShort) {
      issues.push({
        severity: "info",
        dimension: "resource_consistency",
        message: "章节内容极短（<200字），六步剧情评估可能不准确。",
      });
    }

    // Strengths
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      if (dimensions[dim] >= 70) {
        const label = DIMENSION_LABELS[dim];
        strengths.push(`"${label}"结构完整（${dimensions[dim]}/100）。`);
      }
    }

    // Total checklist passed
    let totalChecklistPassed = 0;
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      const stepId = DIM_TO_STEP_ID[dim];
      const step = SIX_STEP_PLOT_METHOD.steps.find((s) => s.id === stepId);
      if (step) {
        totalChecklistPassed += countChecklistPassed(content, stepId, step.reviewChecklist);
      }
    }

    // ---- score & status ----
    const avgDimensionScore = Math.round(
      SIX_STEP_PLOT_DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim], 0) /
        SIX_STEP_PLOT_DIMENSIONS.length,
    );

    const failurePenalty = Math.min(25, commonFailuresDetected.length * 5);
    const score = Math.max(0, Math.min(100, avgDimensionScore - failurePenalty));

    const hasCritical = issues.some((i) => i.severity === "critical");
    const hasWarning = issues.some((i) => i.severity === "warning");

    let status: SixStepPlotStatus;
    if (score >= 80 && !hasCritical) {
      status = "PASS";
    } else if (score >= 60 || (!hasCritical && hasWarning)) {
      status = "WARN";
    } else {
      status = "FAIL_STRUCTURAL";
    }

    // Intent fidelity issues
    if (intentFidelity && intentFidelity.fieldsMissing.length > 0) {
      issues.push({
        severity: intentFidelity.fieldsMatched === 0 ? "warning" : "info",
        dimension: "method_compliance",
        message: `chapterIntent 字段覆盖率 ${intentFidelity.fieldsMatched}/${intentFidelity.fieldsTotal}，缺失：${intentFidelity.fieldsMissing.slice(0, 5).join("、")}${intentFidelity.fieldsMissing.length > 5 ? "…" : ""}`,
        suggestion: "在 chapter_intent 中补充缺失的六招字段。",
      });
    }

    const suggestions = issues.filter((i) => i.suggestion).map((i) => i.suggestion!);

    const intentSummary = intentFidelity
      ? ` | chapterIntent 字段：${intentFidelity.fieldsMatched}/${intentFidelity.fieldsTotal}`
      : "";

    let summary: string;
    if (status === "PASS") {
      summary = `六步剧情审核通过（${score}/100），checklist ${totalChecklistPassed}/12 项通过。${strengths.slice(0, 2).join("；")}${intentSummary}`;
    } else if (status === "WARN") {
      const warnIssues = issues
        .filter((i) => i.severity === "warning")
        .map((i) => i.message)
        .slice(0, 2);
      summary = `六步剧情审核警告（${score}/100），checklist ${totalChecklistPassed}/12 项通过。${warnIssues.join("；")}${intentSummary}`;
    } else {
      const critIssues = issues
        .filter((i) => i.severity === "critical")
        .map((i) => i.message)
        .slice(0, 2);
      summary = `六步剧情审核未通过（${score}/100），checklist ${totalChecklistPassed}/12 项通过。${critIssues.join("；")}${intentSummary}`;
    }

    return {
      chapterIndex: input.chapterIndex ?? 0,
      chapterTitle: input.chapterTitle,
      status,
      score,
      dimensions,
      dimensionConclusions: conclusions,
      methodCompliance: {
        checklistPassed: totalChecklistPassed,
        checklistTotal: 12,
        commonFailuresDetected,
      },
      intentFidelity,
      strengths: [...new Set(strengths)],
      issues,
      suggestions,
      summary,
    };
  }
}

// ---- helpers ----

function defaultPlotConclusions(value: string): Record<SixStepPlotDimension, string> {
  return Object.fromEntries(
    SIX_STEP_PLOT_DIMENSIONS.map((dim) => [dim, value]),
  ) as Record<SixStepPlotDimension, string>;
}

const DEFAULT_PLOT_SCORES: Record<SixStepPlotDimension, number> = {
  emotion_event: 40,
  desire_goal: 40,
  obstacle_dilemma: 40,
  solution_possibility: 40,
  action_resolution: 40,
  ending_feedback: 40,
};

// ---- file I/O ----

export async function writeSixStepPlotReportFiles(params: {
  readonly report: SixStepPlotReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(params.jsonPath), { recursive: true }),
    mkdir(dirname(params.markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(params.jsonPath, JSON.stringify(params.report, null, 2), "utf-8"),
    writeFile(params.markdownPath, renderSixStepPlotMarkdown(params.report), "utf-8"),
  ]);
}

export function renderSixStepPlotMarkdown(report: SixStepPlotReport): string {
  const rows = SIX_STEP_PLOT_DIMENSIONS.map(
    (dim) =>
      `| ${DIMENSION_LABELS[dim]} | ${report.dimensions[dim]} | ${report.dimensionConclusions[dim] || "-"} |`,
  ).join("\n");

  const cfDisplay =
    report.methodCompliance.commonFailuresDetected.length > 0
      ? report.methodCompliance.commonFailuresDetected.map((f) => `- ${f}`).join("\n")
      : "- 无";

  const intentFidelityDisplay = report.intentFidelity
    ? `- 字段覆盖：${report.intentFidelity.fieldsMatched}/${report.intentFidelity.fieldsTotal}
- 已匹配：${report.intentFidelity.fieldsPresent.length > 0 ? report.intentFidelity.fieldsPresent.join("、") : "无"}
- 缺失：${report.intentFidelity.fieldsMissing.length > 0 ? report.intentFidelity.fieldsMissing.join("、") : "无"}`
    : "- 未提供 chapterIntent，跳过字段覆盖检查";

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
      ? "六步剧情审核通过，章节六步结构完整、方法合规。"
      : report.status === "WARN"
        ? "六步剧情存在部分弱点，建议人工关注后发布。"
        : report.status === "FAIL_STRUCTURAL"
          ? "六步剧情存在严重结构缺陷，建议人工审查后调整。"
          : `跳过：${report.skippedReason ?? "未执行审核。"}`;

  return `# Six-Step Plot Review Report

- 章节：${String(report.chapterIndex).padStart(4, "0")}${report.chapterTitle ? ` ${report.chapterTitle}` : ""}
- 状态：${report.status}
- 总分：${report.score ?? "N/A"}
- Checklist：${report.methodCompliance.checklistPassed}/${report.methodCompliance.checklistTotal}

## 六步剧情维度

| 维度 | 分数 | 结论 |
|---|---:|---|
${rows}

## 方法合规

- Checklist 通过：${report.methodCompliance.checklistPassed}/${report.methodCompliance.checklistTotal}
- 常见失败模式：

${cfDisplay}

## chapterIntent 兑现度

${intentFidelityDisplay}

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

export async function readSixStepPlotSummary(
  bookDir: string,
  chapterIndex: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const prefix = String(chapterIndex).padStart(4, "0");
  const file = join(bookDir, "reviews", "six-step-plot", `${prefix}.six-step-plot.report.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const report = JSON.parse(raw) as Partial<SixStepPlotReport>;
    return {
      status: report.status ?? "UNKNOWN",
      score: report.score ?? null,
      summary: report.summary ?? "",
    };
  } catch {
    return undefined;
  }
}
