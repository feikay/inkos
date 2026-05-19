import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BaseAgent } from "./base.js";

export const INTENT_ALIGNMENT_DIMENSIONS = [
  "goal_alignment",
  "obstacle_alignment",
  "antagonist_pressure_alignment",
  "climax_payoff_alignment",
  "ending_hook_alignment",
  "behavior_safety_alignment",
] as const;

export type IntentAlignmentDimension = typeof INTENT_ALIGNMENT_DIMENSIONS[number];

export type IntentAlignmentStatus = "PASS" | "WARN" | "FAIL_REPORT_ONLY" | "SKIPPED" | "SKIPPED_DUE_RESOURCE_FAILURE" | "MISSING_INTENT" | "MISSING_CHAPTER";
export type IntentAlignmentSeverity = "info" | "warning" | "critical";

export interface IntentAlignmentIssue {
  readonly severity: IntentAlignmentSeverity;
  readonly dimension: IntentAlignmentDimension | "reviewer_failed" | "missing_intent" | "missing_chapter" | "local_scan" | "resource_consistency";
  readonly message: string;
  readonly suggestion?: string;
}

export type IntentAlignmentScores = Record<IntentAlignmentDimension, number>;

export interface IntentAlignmentReport {
  readonly chapter: number;
  readonly status: IntentAlignmentStatus;
  readonly score: number | null;
  readonly dimensions: IntentAlignmentScores;
  readonly dimensionConclusions: Record<IntentAlignmentDimension, string>;
  readonly issues: ReadonlyArray<IntentAlignmentIssue>;
  readonly suggestions: ReadonlyArray<string>;
  readonly intentPath: string;
  readonly chapterPath: string;
}

export interface IntentAlignmentReviewInput {
  readonly chapter: number;
  readonly intentMarkdown?: string;
  readonly chapterContent?: string;
  readonly bookRules?: string;
  readonly antagonistMap?: string;
  readonly motivationMatrix?: string;
  readonly intentPath: string;
  readonly chapterPath: string;
  readonly resourcePlan?: import("./resource-plan.js").ChapterResourcePlan;
}

const DIMENSION_LABELS: Record<IntentAlignmentDimension, string> = {
  goal_alignment: "本章目标一致性",
  obstacle_alignment: "阻碍困境一致性",
  antagonist_pressure_alignment: "反派压力一致性",
  climax_payoff_alignment: "高潮与收益一致性",
  ending_hook_alignment: "结尾钩子一致性",
  behavior_safety_alignment: "人物行为与安全规则一致性",
};

const DEFAULT_SCORES: IntentAlignmentScores = {
  goal_alignment: 85,
  obstacle_alignment: 85,
  antagonist_pressure_alignment: 85,
  climax_payoff_alignment: 85,
  ending_hook_alignment: 85,
  behavior_safety_alignment: 85,
};

export class IntentAlignmentReviewerAgent extends BaseAgent {
  get name(): string {
    return "intent-alignment-reviewer";
  }

  async review(input: IntentAlignmentReviewInput): Promise<IntentAlignmentReport> {
    if (!input.intentMarkdown?.trim()) {
      return normalizeIntentAlignmentReport({
        chapter: input.chapter,
        status: "MISSING_INTENT",
        score: null,
        dimensions: { ...DEFAULT_SCORES },
        dimensionConclusions: defaultConclusions("缺少 chapter_intent，未执行语义审核。"),
        issues: [{
          severity: "warning",
          dimension: "missing_intent",
          message: "chapter_intent 缺失，无法判断最终正文是否符合预写意图。",
          suggestion: "重新运行 write next 或补齐 story/runtime/chapter-intents 对应章节文件。",
        }],
        suggestions: ["补齐 chapter_intent 后重新审核。"],
        intentPath: input.intentPath,
        chapterPath: input.chapterPath,
      });
    }

    if (!input.chapterContent?.trim()) {
      return normalizeIntentAlignmentReport({
        chapter: input.chapter,
        status: "MISSING_CHAPTER",
        score: null,
        dimensions: { ...DEFAULT_SCORES },
        dimensionConclusions: defaultConclusions("缺少最终正文，未执行语义审核。"),
        issues: [{
          severity: "critical",
          dimension: "missing_chapter",
          message: "最终正文缺失，无法执行 intent alignment 审核。",
          suggestion: "先完成章节生成并确认章节正文已落盘。",
        }],
        suggestions: ["确认章节正文存在后重新审核。"],
        intentPath: input.intentPath,
        chapterPath: input.chapterPath,
      });
    }

    const response = await this.chat([
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: this.buildUserPrompt(input) },
    ], { temperature: 0.1, maxTokens: 4096 });

    const parsed = parseIntentAlignmentReport(response.content, input);
    return applyIntentAlignmentHardScan(parsed, input);
  }

  private buildSystemPrompt(): string {
    return [
      "你是 serialized web novel 的 chapter_intent 一致性审核员。",
      "你只检查最终正文是否符合 chapter_intent，不重写正文，不阻断落盘。",
      "必须只输出合法 JSON，不要输出 Markdown，不要解释。",
      "六个维度均需 0-100 打分：goal_alignment, obstacle_alignment, antagonist_pressure_alignment, climax_payoff_alignment, ending_hook_alignment, behavior_safety_alignment。",
      "状态规则：总分 >=85 且无 critical 为 PASS；70-84 或有 warning 为 WARN；<70 或有 critical 为 FAIL_REPORT_ONLY。",
    ].join("\n");
  }

  private buildUserPrompt(input: IntentAlignmentReviewInput): string {
    return [
      `# 第${input.chapter}章 Intent Alignment 审核`,
      "",
      "## 输出 JSON schema",
      JSON.stringify({
        chapter: input.chapter,
        status: "PASS | WARN | FAIL_REPORT_ONLY",
        score: 88,
        dimensions: DEFAULT_SCORES,
        dimensionConclusions: Object.fromEntries(INTENT_ALIGNMENT_DIMENSIONS.map((dimension) => [dimension, "一句话结论"])),
        issues: [{
          severity: "warning | critical | info",
          dimension: "ending_hook_alignment",
          message: "具体偏离",
          suggestion: "修正建议",
        }],
        suggestions: ["下一步建议"],
      }, null, 2),
      "",
      "## 审核维度",
      "- goal_alignment：表层目标/深层目标是否体现，是否换主目标，是否提前完成不该完成的目标。",
      "- obstacle_alignment：阻碍来源、具体阻碍、阻碍强度是否符合 intent。",
      "- antagonist_pressure_alignment：指定反派是否施压，行动是否符合 antagonist_map / intent，是否降智送经验。",
      "- climax_payoff_alignment：高潮是否符合 intent，是否提前兑现 payoff，是否给出不该给的现金/技能/情报/真相/重大代价。",
      "- ending_hook_alignment：结尾是否停在 intent 钩子，是否提前写完下一章，是否没有钩子。",
      "- behavior_safety_alignment：人物行为约束、配角工具人化、反派降智、题材安全、现实政治映射、身份羞辱词。",
      "",
      "## chapter_intent",
      input.intentMarkdown,
      "",
      "## final chapter content",
      input.chapterContent,
      "",
      "## book_rules",
      input.bookRules || "(缺失)",
      "",
      "## antagonist_map",
      truncate(input.antagonistMap || "(缺失)", 8000),
      "",
      "## motivation_matrix",
      truncate(input.motivationMatrix || "(缺失)", 8000),
    ].join("\n");
  }
}

export function parseIntentAlignmentReport(raw: string, input: IntentAlignmentReviewInput): IntentAlignmentReport {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as Partial<IntentAlignmentReport>;
  return normalizeIntentAlignmentReport({
    chapter: input.chapter,
    status: parsed.status,
    score: parsed.score,
    dimensions: parsed.dimensions,
    dimensionConclusions: parsed.dimensionConclusions,
    issues: parsed.issues,
    suggestions: parsed.suggestions,
    intentPath: input.intentPath,
    chapterPath: input.chapterPath,
  });
}

export function buildSkippedIntentAlignmentReport(
  input: IntentAlignmentReviewInput,
  error: unknown,
): IntentAlignmentReport {
  const detail = error instanceof Error ? error.message : String(error);
  return normalizeIntentAlignmentReport({
    chapter: input.chapter,
    status: "SKIPPED",
    score: null,
    dimensions: { ...DEFAULT_SCORES },
    dimensionConclusions: defaultConclusions("reviewer 调用失败，未执行语义审核。"),
    issues: [{
      severity: "warning",
      dimension: "reviewer_failed",
      message: `intent-alignment-reviewer 调用失败：${detail}`,
      suggestion: "正文已照常保留；可稍后重新运行审核或人工检查本章 intent 对齐情况。",
    }],
    suggestions: ["稍后重新执行 intent alignment 审核。"],
    intentPath: input.intentPath,
    chapterPath: input.chapterPath,
  });
}

export function applyIntentAlignmentHardScan(
  report: IntentAlignmentReport,
  input: IntentAlignmentReviewInput,
): IntentAlignmentReport {
  const content = input.chapterContent ?? "";
  const intent = input.intentMarkdown ?? "";
  const dimensions: IntentAlignmentScores = { ...report.dimensions };
  const issues: IntentAlignmentIssue[] = [...report.issues];
  const suggestions = new Set(report.suggestions);
  const conclusions: Record<IntentAlignmentDimension, string> = { ...report.dimensionConclusions };

  if (/(PRE_WRITE_CHECK|POST_WRITE_CHECK|自检|检查项表格)/iu.test(content)) {
    dimensions.behavior_safety_alignment = Math.min(dimensions.behavior_safety_alignment, 50);
    issues.push({
      severity: "critical",
      dimension: "behavior_safety_alignment",
      message: "正文残留 PRE_WRITE_CHECK / POST_WRITE_CHECK / 自检类非正文检查块。",
      suggestion: "清理所有非正文检查块，只保留章节正文。",
    });
    conclusions.behavior_safety_alignment = "发现非正文检查块残留，需人工清理。";
  }

  const suppressesPayoff = /(不得|禁止|不要|不能).{0,20}(提前|完整)?.{0,20}(兑现|解锁|发放|福利|技能|线索)|suppress\s*=\s*true/iu.test(intent);
  const earlyPayoffKeywords = [
    "明确逃生线索",
    "完整解锁",
    "旧码头",
    "三号仓库",
    "第三块砖",
    "永久失明",
    "S级逃生线索",
    "获得现金",
    "现金到账",
    "银行到账",
    "1000联邦币",
    "解锁技能",
    "初级辩论技能",
  ];
  const plan = input.resourcePlan;
  const isAllowedByResourcePlan = (keyword: string): boolean => {
    if (!plan || plan.mode === "no_resource_change") return false;
    const allowedEventLabels = plan.allowedEvents.map((event) => {
      if (event.kind === "unlock" && event.skill) return event.skill;
      if (event.kind === "gain") return `${event.resource}+${event.amount}`;
      return `${event.kind}:${event.resource}`;
    });
    const forbiddenText = plan.forbiddenEvents.join("\n");
    if (keyword === "解锁技能" && allowedEventLabels.some((label) => label.includes("技能"))) return true;
    if (keyword.includes("现金") || keyword.includes("到账") || keyword.includes("联邦币")) {
      return false;
    }
    if (keyword.includes("技能") && allowedEventLabels.some((label) => label.includes(keyword) || keyword.includes(label))) return true;
    if (forbiddenText.includes(keyword)) return false;
    if (allowedEventLabels.some((label) => label.includes(keyword))) return true;
    return false;
  };
  const matchedPayoffs = suppressesPayoff
    ? earlyPayoffKeywords.filter((keyword) => content.includes(keyword) && !isAllowedByResourcePlan(keyword))
    : [];
  if (matchedPayoffs.length > 0) {
    dimensions.climax_payoff_alignment = Math.min(dimensions.climax_payoff_alignment, 60);
    issues.push({
      severity: "warning",
      dimension: "climax_payoff_alignment",
      message: `chapter_intent 禁止提前兑现，但正文出现疑似提前 payoff：${matchedPayoffs.join("、")}。`,
      suggestion: "将相关 payoff 降级为轻微暗示，章节结尾停在 intent 指定钩子。",
    });
    suggestions.add("检查高潮与收益是否推进过猛，必要时人工删减提前兑现信息。");
    conclusions.climax_payoff_alignment = "本地扫描发现疑似提前兑现关键词。";
  }

  const identityInsults = ["黑鬼", "支那", "白皮猪", "黄皮猴", "地域狗", "女拳婊"];
  const matchedInsults = identityInsults.filter((keyword) => content.includes(keyword));
  if (matchedInsults.length > 0) {
    dimensions.behavior_safety_alignment = Math.min(dimensions.behavior_safety_alignment, 50);
    issues.push({
      severity: "critical",
      dimension: "behavior_safety_alignment",
      message: `正文出现直接身份羞辱词：${matchedInsults.join("、")}。`,
      suggestion: "删除直接身份羞辱表达，改为虚构势力冲突或非身份化矛盾。",
    });
    conclusions.behavior_safety_alignment = "发现直接身份羞辱词，存在发布安全风险。";
  }

  const politicalNames = ["习近平", "特朗普", "川普", "拜登", "奥巴马", "普京", "泽连斯基", "马克龙", "默克尔"];
  const matchedPolitics = politicalNames.filter((keyword) => content.includes(keyword));
  if (matchedPolitics.length > 0) {
    dimensions.behavior_safety_alignment = Math.min(dimensions.behavior_safety_alignment, 60);
    issues.push({
      severity: "warning",
      dimension: "behavior_safety_alignment",
      message: `正文出现现实政治人物名：${matchedPolitics.join("、")}。`,
      suggestion: "改用完全虚构的平行世界人物和机构，避免现实政治映射。",
    });
    conclusions.behavior_safety_alignment = "发现现实政治人物名，需检查题材安全边界。";
  }

  const ending = content.trim().slice(-500);
  if (ending && !/[？?]|忽然|突然|却见|只见|还没|尚未|未知|谜|门外|身后|响起|弹出|面板|提示|下一刻/u.test(ending)) {
    dimensions.ending_hook_alignment = Math.min(dimensions.ending_hook_alignment, 80);
    issues.push({
      severity: "warning",
      dimension: "ending_hook_alignment",
      message: "正文结尾缺少明显未解决问题或下一章钩子信号。",
      suggestion: "人工确认结尾是否停在 chapter_intent 指定钩子上。",
    });
    conclusions.ending_hook_alignment = "本地扫描提示结尾钩子可能偏弱。";
  }

  return normalizeIntentAlignmentReport({
    ...report,
    dimensions,
    dimensionConclusions: conclusions,
    issues,
    suggestions: [...suggestions],
  });
}

export async function writeIntentAlignmentReportFiles(params: {
  readonly report: IntentAlignmentReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(params.jsonPath), { recursive: true }),
    mkdir(dirname(params.markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(params.jsonPath, JSON.stringify(params.report, null, 2), "utf-8"),
    writeFile(params.markdownPath, renderIntentAlignmentMarkdown(params.report), "utf-8"),
  ]);
}

export function renderIntentAlignmentMarkdown(report: IntentAlignmentReport): string {
  const rows = INTENT_ALIGNMENT_DIMENSIONS
    .map((dimension) => `| ${dimension} | ${report.dimensions[dimension]} | ${report.dimensionConclusions[dimension] || "-"} |`)
    .join("\n");
  const issues = report.issues.length
    ? report.issues.map((issue) => `- [${issue.severity}] ${issue.dimension}: ${issue.message}${issue.suggestion ? ` 建议：${issue.suggestion}` : ""}`).join("\n")
    : "- 无";
  const suggestions = report.suggestions.length
    ? report.suggestions.map((item) => `- ${item}`).join("\n")
    : "- 无";
  const conclusion = report.status === "PASS"
    ? "本章基本符合 chapter_intent。"
    : report.status === "WARN"
      ? "本章存在轻微偏离，请人工关注 warning。"
      : report.status === "FAIL_REPORT_ONLY"
        ? "本章明显偏离 chapter_intent，但本轮只报告不阻断。"
        : "本章未完成 intent alignment 语义审核。";

  return `# 第${report.chapter}章 Intent Alignment Report

- 状态：${report.status}
- 总分：${report.score ?? "N/A"}
- Intent：${report.intentPath}
- Chapter：${report.chapterPath}

## 维度评分
| 维度 | 分数 | 结论 |
|---|---:|---|
${rows}

## 主要问题
${issues}

## 修改建议
${suggestions}

## 结论
${conclusion}
`;
}

function normalizeIntentAlignmentReport(input: Partial<IntentAlignmentReport> & {
  readonly chapter: number;
  readonly intentPath: string;
  readonly chapterPath: string;
}): IntentAlignmentReport {
  const dimensions = normalizeScores(input.dimensions);
  const issues = normalizeIssues(input.issues);
  const score = input.score === null || input.score === undefined
    ? input.score ?? null
    : clampScore(input.score);
  const computedScore = score ?? (
    input.status === "SKIPPED"
    || input.status === "SKIPPED_DUE_RESOURCE_FAILURE"
    || input.status === "MISSING_INTENT"
    || input.status === "MISSING_CHAPTER"
    ? null
    : Math.round(INTENT_ALIGNMENT_DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension], 0) / INTENT_ALIGNMENT_DIMENSIONS.length));
  const status = normalizeStatus(input.status, computedScore, issues);
  const dimensionConclusions = {
    ...defaultConclusions("未提供结论。"),
    ...input.dimensionConclusions,
  };
  return {
    chapter: input.chapter,
    status,
    score: computedScore,
    dimensions,
    dimensionConclusions,
    issues,
    suggestions: Array.isArray(input.suggestions) ? input.suggestions.filter((item) => typeof item === "string" && item.trim()) : [],
    intentPath: input.intentPath,
    chapterPath: input.chapterPath,
  };
}

function normalizeScores(input: unknown): IntentAlignmentScores {
  const source = typeof input === "object" && input ? input as Record<string, unknown> : {};
  const scores = { ...DEFAULT_SCORES };
  for (const dimension of INTENT_ALIGNMENT_DIMENSIONS) {
    const value = source[dimension];
    scores[dimension] = typeof value === "number" ? clampScore(value) : scores[dimension];
  }
  return scores;
}

function normalizeIssues(input: unknown): IntentAlignmentIssue[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((issue): IntentAlignmentIssue | null => {
      if (!issue || typeof issue !== "object") return null;
      const source = issue as Record<string, unknown>;
      const severity = source.severity === "critical" || source.severity === "warning" || source.severity === "info"
        ? source.severity
        : "warning";
      const dimension = typeof source.dimension === "string" && (
        INTENT_ALIGNMENT_DIMENSIONS.includes(source.dimension as IntentAlignmentDimension)
        || source.dimension === "reviewer_failed"
        || source.dimension === "missing_intent"
        || source.dimension === "missing_chapter"
        || source.dimension === "resource_consistency"
        || source.dimension === "local_scan"
      )
        ? source.dimension as IntentAlignmentIssue["dimension"]
        : "local_scan";
      const message = typeof source.message === "string" && source.message.trim()
        ? source.message
        : typeof source["detail"] === "string" && source["detail"].trim()
          ? source["detail"]
          : "";
      if (!message) return null;
      return {
        severity,
        dimension,
        message,
        ...(typeof source.suggestion === "string" && source.suggestion.trim() ? { suggestion: source.suggestion } : {}),
      };
    })
    .filter((issue): issue is IntentAlignmentIssue => Boolean(issue));
}

function normalizeStatus(
  input: unknown,
  score: number | null,
  issues: ReadonlyArray<IntentAlignmentIssue>,
): IntentAlignmentStatus {
  if (input === "SKIPPED" || input === "SKIPPED_DUE_RESOURCE_FAILURE" || input === "MISSING_INTENT" || input === "MISSING_CHAPTER") {
    return input;
  }
  const hasCritical = issues.some((issue) => issue.severity === "critical");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  if (score !== null && (score < 70 || hasCritical)) return "FAIL_REPORT_ONLY";
  if (score !== null && (score < 85 || hasWarning)) return "WARN";
  return "PASS";
}

function defaultConclusions(value: string): Record<IntentAlignmentDimension, string> {
  return Object.fromEntries(INTENT_ALIGNMENT_DIMENSIONS.map((dimension) => [dimension, value])) as Record<IntentAlignmentDimension, string>;
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("intent alignment reviewer did not return JSON");
  }
  return candidate.slice(start, end + 1);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n...(truncated)`;
}

export { DIMENSION_LABELS as INTENT_ALIGNMENT_DIMENSION_LABELS };
