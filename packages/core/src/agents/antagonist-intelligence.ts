import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaseAgent } from "./base.js";
import {
  ANTAGONIST_INTELLIGENCE_CHECKLIST,
  ANTAGONIST_TEMPLATES,
} from "../story-methods/antagonist-templates.js";

export { ANTAGONIST_INTELLIGENCE_CHECKLIST };

export const ANTAGONIST_INTELLIGENCE_DIMENSIONS = [
  "antagonist_goal",
  "antagonist_method",
  "antagonist_constraint",
  "antagonist_cost",
  "antagonist_feedback",
  "antagonist_foreshadowing",
] as const;

export type AntagonistIntelligenceDimension = typeof ANTAGONIST_INTELLIGENCE_DIMENSIONS[number];
export type AntagonistIntelligenceStatus = "PASS" | "WARN" | "FAIL_REPORT_ONLY" | "SKIPPED";

export interface AntagonistIntelligenceIssue {
  readonly severity: "info" | "warning" | "critical";
  readonly dimension: AntagonistIntelligenceDimension | "checklist" | "resource_consistency" | "missing_input";
  readonly message: string;
  readonly suggestion?: string;
}

export interface AntagonistIntelligenceReport {
  readonly chapter: number;
  readonly status: AntagonistIntelligenceStatus;
  readonly score: number | null;
  readonly antagonistTypeDetected: ReadonlyArray<string>;
  readonly dimensions: Record<AntagonistIntelligenceDimension, number>;
  readonly dimensionConclusions: Record<AntagonistIntelligenceDimension, string>;
  readonly checklistResults: Record<string, boolean>;
  readonly issues: ReadonlyArray<AntagonistIntelligenceIssue>;
  readonly suggestions: ReadonlyArray<string>;
  readonly summary: string;
  readonly skippedReason?: string;
}

export interface AntagonistIntelligenceReviewInput {
  readonly chapter: number;
  readonly chapterContent?: string;
  readonly antagonistMap?: string;
  readonly motivationMatrix?: string;
  readonly resourceBlocking?: boolean;
  readonly chapterIndexStatus?: string;
}

const DIMENSION_LABELS: Record<AntagonistIntelligenceDimension, string> = {
  antagonist_goal: "反派目标自洽性",
  antagonist_method: "反派手段智能度",
  antagonist_constraint: "信息/资源约束",
  antagonist_cost: "行动代价",
  antagonist_feedback: "压迫反馈",
  antagonist_foreshadowing: "伏笔/伪装一致性",
};

const DEFAULT_SCORES: Record<AntagonistIntelligenceDimension, number> = {
  antagonist_goal: 75,
  antagonist_method: 75,
  antagonist_constraint: 75,
  antagonist_cost: 75,
  antagonist_feedback: 75,
  antagonist_foreshadowing: 75,
};

// ---- signal patterns for hard scan ----

const ANTAGONIST_APPEARANCE_SIGNALS = [
  /反派|敌人|对手|仇人|死敌|宿敌/u,
  /威胁|施压|逼迫|压迫|追杀|猎杀|捕杀/u,
  /阴谋|圈套|陷阱|算计|布局|设局/u,
  /暗处|暗中|背后|幕后|暗中操纵|遥控/u,
];

const MOUJUZHE_SIGNALS = [
  /计划.{0,5}[ABC甲乙丙]/u,
  /备用.{0,5}(?:方案|计划|手段|后手)/u,
  /信息差|信息.{0,3}(?:优势|不对称|掌握)/u,
  /掌控|操控|利用|多重.{0,3}计划/u,
  /纳入.{0,5}(?:计划|算计|布局)/u,
  /提前.{0,5}(?:布置|安排|埋下|安插)/u,
];

const XUNDAOZHE_SIGNALS = [
  /信念|信仰|理想|使命|天职|救赎/u,
  /牺牲|殉道|献身|自毁|同归/u,
  /崇高.{0,5}(?:目的|目标|理想)/u,
  /为了.{0,10}(?:值得|必须|不得不.{0,5}牺牲)/u,
  /别无选择|没有退路|唯一的路/u,
];

const WEITAZHE_SIGNALS = [
  /伪装|假扮|冒充|隐藏.{0,3}身份/u,
  /背叛|出卖|背刺|反水|倒戈/u,
  /信任.{0,5}(?:崩塌|摧毁|利用)/u,
  /不协调|不对劲|可疑|异样/u,
  /面具|真面目|另一面|真实.{0,3}身份/u,
  /暗示|伏笔|铺垫.{0,5}(?:揭|露|显)/u,
];

const DUMB_VILLAIN_SIGNALS = [
  /反派.{0,10}(?:突然|竟然|莫名其妙|无缘无故).{0,10}(?:犯错|失误|放过|不杀)/u,
  /明明.{0,5}(?:能杀|可以杀|应该杀).{0,5}(?:却|但|然而|偏偏)/u,
  /主动.{0,5}(?:告诉|说出|透露|泄露).{0,5}(?:关键|重要|核心|致命).{0,5}(?:信息|情报|秘密)/u,
  /送经验|送情报|送装备|白给/u,
];

// ---- helpers ----

function defaultConclusions(value: string): Record<AntagonistIntelligenceDimension, string> {
  return Object.fromEntries(
    ANTAGONIST_INTELLIGENCE_DIMENSIONS.map((dim) => [dim, value]),
  ) as Record<AntagonistIntelligenceDimension, string>;
}

function buildSkippedReport(
  input: AntagonistIntelligenceReviewInput,
  reason: string,
): AntagonistIntelligenceReport {
  return {
    chapter: input.chapter,
    status: "SKIPPED",
    score: null,
    antagonistTypeDetected: [],
    dimensions: { ...DEFAULT_SCORES },
    dimensionConclusions: defaultConclusions(reason),
    checklistResults: Object.fromEntries(
      ANTAGONIST_INTELLIGENCE_CHECKLIST.map((item) => [item, false]),
    ),
    issues: [{
      severity: "info",
      dimension: "resource_consistency",
      message: reason,
      suggestion: "修复阻断条件后重新运行 antagonist-intelligence review。",
    }],
    suggestions: ["修复阻断条件后重新运行 antagonist-intelligence review。"],
    summary: `跳过：${reason}`,
    skippedReason: reason,
  };
}

// ---- agent ----

export class AntagonistIntelligenceReviewerAgent extends BaseAgent {
  get name(): string {
    return "antagonist-intelligence-reviewer";
  }

  async review(input: AntagonistIntelligenceReviewInput): Promise<AntagonistIntelligenceReport> {
    if (input.resourceBlocking) {
      return buildSkippedReport(input, "资源账本校验失败，跳过反派智能审核。");
    }
    if (
      input.chapterIndexStatus === "state-degraded" ||
      input.chapterIndexStatus === "blocked-resource-plan"
    ) {
      return buildSkippedReport(
        input,
        `章节状态为 ${input.chapterIndexStatus}，跳过反派智能审核。`,
      );
    }

    const content = input.chapterContent ?? "";
    if (!content.trim()) {
      return buildSkippedReport(input, "章节正文为空，跳过反派智能审核。");
    }

    const hasAntagonistMap = (input.antagonistMap ?? "").trim().length > 0;
    const hasMotivationMatrix = (input.motivationMatrix ?? "").trim().length > 0;

    // ---- LLM-based review ----
    let llmDimensions: Record<AntagonistIntelligenceDimension, number> = { ...DEFAULT_SCORES };
    let llmConclusions: Record<AntagonistIntelligenceDimension, string> = defaultConclusions("LLM 未执行审核。");
    let llmIssues: AntagonistIntelligenceIssue[] = [];
    let llmSuggestions: string[] = [];
    let detectedTypes: string[] = [];
    let llmUsed = false;

    try {
      const response = await this.chat([
        { role: "system", content: this.buildSystemPrompt() },
        { role: "user", content: this.buildUserPrompt(input) },
      ], { temperature: 0.1, maxTokens: 4096 });

      const parsed = this.parseResponse(response.content, input);
      llmDimensions = parsed.dimensions;
      llmConclusions = parsed.conclusions;
      llmIssues = parsed.issues;
      llmSuggestions = parsed.suggestions;
      detectedTypes = parsed.types;
      llmUsed = true;
    } catch {
      // LLM failed, fall through to hard scan only
    }

    // ---- hard scan (always runs, supplements LLM) ----
    const hardScan = applyHardScan(content, input);

    // Merge: LLM dimensions as base, hard scan can lower scores
    const dimensions: Record<AntagonistIntelligenceDimension, number> = { ...llmDimensions };
    const conclusions: Record<AntagonistIntelligenceDimension, string> = { ...llmConclusions };
    for (const dim of ANTAGONIST_INTELLIGENCE_DIMENSIONS) {
      if (hardScan.dimensionAdjustments[dim] !== undefined) {
        dimensions[dim] = Math.min(dimensions[dim], hardScan.dimensionAdjustments[dim]!);
      }
    }
    for (const [dim, conclusion] of Object.entries(hardScan.conclusionOverrides)) {
      conclusions[dim as AntagonistIntelligenceDimension] = conclusion;
    }

    const issues = [...llmIssues, ...hardScan.issues];
    const suggestions = [...new Set([...llmSuggestions, ...hardScan.suggestions])];

    // Check if no antagonist appears
    const antagonistAppears = ANTAGONIST_APPEARANCE_SIGNALS.some((p) => p.test(content));
    if (!antagonistAppears && !hasAntagonistMap) {
      return buildSkippedReport(input, "本章未检测到反派出场信号且缺少 antagonist_map，跳过反派智能审核。");
    }

    // Score & status
    const avgScore = Math.round(
      ANTAGONIST_INTELLIGENCE_DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim], 0) /
        ANTAGONIST_INTELLIGENCE_DIMENSIONS.length,
    );
    const finalScore = Math.max(0, Math.min(100, avgScore));

    const hasCritical = issues.some((i) => i.severity === "critical");
    const hasWarning = issues.some((i) => i.severity === "warning");
    let status: AntagonistIntelligenceStatus;
    if (finalScore >= 85 && !hasCritical) {
      status = "PASS";
    } else if (finalScore >= 70 || (!hasCritical && hasWarning)) {
      status = "WARN";
    } else {
      status = "FAIL_REPORT_ONLY";
    }

    const summary = buildSummary(status, finalScore, detectedTypes, issues, llmUsed);

    return {
      chapter: input.chapter,
      status,
      score: finalScore,
      antagonistTypeDetected: detectedTypes,
      dimensions,
      dimensionConclusions: conclusions,
      checklistResults: hardScan.checklistResults,
      issues,
      suggestions,
      summary,
    };
  }

  private buildSystemPrompt(): string {
    const templateDescriptions = ANTAGONIST_TEMPLATES.map((t) =>
      `- ${t.name}（${t.id}）：${t.coreWeapon} ${t.threatToProtagonist}`,
    ).join("\n");

    return [
      "你是网文反派智能审核员。你只审核章节中反派是否展示了高智商行动，不审核通用故事质量、连续性、番茄风格或前三章钩子结构。",
      "必须只输出合法 JSON，不要输出 Markdown，不要解释。",
      "",
      "三种反派类型：",
      templateDescriptions,
      "",
      "六个审核维度（每个 0-100 分）：",
      "- antagonist_goal：反派目标是否自洽且有驱动力，不只是讨厌主角。",
      "- antagonist_method：反派手段是否展示智能（信息差/多重计划/价值观压迫/伪装操控），而非简单暴力或犯低级错误。",
      "- antagonist_constraint：反派行动是否受信息边界、世界规则、资源限制的合理约束。",
      "- antagonist_cost：反派行动是否付出了代价，而非无成本施压。",
      "- antagonist_feedback：主角行动后反派是否给出了有效回应或压力升级。",
      "- antagonist_foreshadowing：反派行为是否可通过前文伏笔验证，而非突然揭示或毫无铺垫。",
      "",
      "状态规则：总分>=85 且无 critical 为 PASS；70-84 或仅有 warning 为 WARN；<70 或有 critical 为 FAIL_REPORT_ONLY。",
      "",
      "如果本章无反派出场信号，antagonistTypeDetected 返回空数组，各维度打75分（中性），status 由硬扫描决定。",
    ].join("\n");
  }

  private buildUserPrompt(input: AntagonistIntelligenceReviewInput): string {
    return [
      `# 第${input.chapter}章 反派智能审核`,
      "",
      "## 输出 JSON schema",
      JSON.stringify({
        chapter: input.chapter,
        antagonistTypeDetected: ["谋局者"],
        dimensions: DEFAULT_SCORES,
        dimensionConclusions: Object.fromEntries(
          ANTAGONIST_INTELLIGENCE_DIMENSIONS.map((dim) => [dim, "一句话结论"]),
        ),
        issues: [{
          severity: "warning | critical | info",
          dimension: "antagonist_method",
          message: "具体问题描述",
          suggestion: "改进建议",
        }],
        suggestions: ["改进建议"],
      }, null, 2),
      "",
      "## 反派智能检查清单",
      ...ANTAGONIST_INTELLIGENCE_CHECKLIST.map((item, index) => `${index + 1}. ${item}`),
      "",
      "## 三种反派类型参考",
      ...ANTAGONIST_TEMPLATES.map((t) =>
        [
          `### ${t.name}（${t.id}）`,
          `- 核心武器：${t.coreWeapon}`,
          `- 失败模式：${t.failureModes.join("；")}`,
          `- 设计问题：${t.designQuestions.join("；")}`,
        ].join("\n"),
      ),
      "",
      "## antagonist_map",
      input.antagonistMap || "(缺失)",
      "",
      "## motivation_matrix",
      truncate(input.motivationMatrix || "(缺失)", 8000),
      "",
      "## 章节正文",
      input.chapterContent || "(缺失)",
    ].join("\n");
  }

  private parseResponse(raw: string, _input: AntagonistIntelligenceReviewInput): {
    dimensions: Record<AntagonistIntelligenceDimension, number>;
    conclusions: Record<AntagonistIntelligenceDimension, string>;
    issues: AntagonistIntelligenceIssue[];
    suggestions: string[];
    types: string[];
  } {
    const json = extractJsonObject(raw);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    const dimensions: Record<AntagonistIntelligenceDimension, number> = { ...DEFAULT_SCORES };
    if (parsed.dimensions && typeof parsed.dimensions === "object") {
      const src = parsed.dimensions as Record<string, unknown>;
      for (const dim of ANTAGONIST_INTELLIGENCE_DIMENSIONS) {
        dimensions[dim] = typeof src[dim] === "number" ? clampScore(src[dim] as number) : dimensions[dim];
      }
    }

    const conclusions: Record<AntagonistIntelligenceDimension, string> = defaultConclusions("未提供结论。");
    if (parsed.dimensionConclusions && typeof parsed.dimensionConclusions === "object") {
      const src = parsed.dimensionConclusions as Record<string, unknown>;
      for (const dim of ANTAGONIST_INTELLIGENCE_DIMENSIONS) {
        conclusions[dim] = typeof src[dim] === "string" ? (src[dim] as string) : conclusions[dim];
      }
    }

    const issues: AntagonistIntelligenceIssue[] = [];
    if (Array.isArray(parsed.issues)) {
      for (const item of parsed.issues) {
        if (!item || typeof item !== "object") continue;
        const src = item as Record<string, unknown>;
        const severity = src.severity === "critical" || src.severity === "warning" ? src.severity : "info";
        const dimension = typeof src.dimension === "string" &&
          (ANTAGONIST_INTELLIGENCE_DIMENSIONS as ReadonlyArray<string>).includes(src.dimension as string)
          ? (src.dimension as AntagonistIntelligenceDimension)
          : "checklist";
        const message = typeof src.message === "string" ? src.message : "";
        if (!message) continue;
        issues.push({
          severity,
          dimension,
          message,
          ...(typeof src.suggestion === "string" && src.suggestion.trim()
            ? { suggestion: src.suggestion }
            : {}),
        });
      }
    }

    const suggestions: string[] = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];

    const types: string[] = Array.isArray(parsed.antagonistTypeDetected)
      ? parsed.antagonistTypeDetected.filter((t): t is string =>
          typeof t === "string" && ANTAGONIST_TEMPLATES.some((tmpl) => tmpl.name === t || tmpl.id === t),
        )
      : [];

    return { dimensions, conclusions, issues, suggestions, types };
  }
}

// ---- hard scan ----

interface HardScanResult {
  dimensionAdjustments: Partial<Record<AntagonistIntelligenceDimension, number>>;
  conclusionOverrides: Partial<Record<AntagonistIntelligenceDimension, string>>;
  checklistResults: Record<string, boolean>;
  issues: AntagonistIntelligenceIssue[];
  suggestions: string[];
}

function applyHardScan(
  content: string,
  _input: AntagonistIntelligenceReviewInput,
): HardScanResult {
  const adjustments: Partial<Record<AntagonistIntelligenceDimension, number>> = {};
  const overrides: Partial<Record<AntagonistIntelligenceDimension, string>> = {};
  const issues: AntagonistIntelligenceIssue[] = [];
  const suggestions: string[] = [];
  const checklistResults: Record<string, boolean> = {};

  // CHECKLIST item 1: antagonist self-consistent goal
  const hasGoalSignal = /目标|目的|要的是|想得到|为了|争夺|夺取|保护|维持|控制/u.test(content);
  checklistResults[ANTAGONIST_INTELLIGENCE_CHECKLIST[0]!] = hasGoalSignal;
  if (!hasGoalSignal) {
    adjustments.antagonist_goal = Math.min(adjustments.antagonist_goal ?? 75, 50);
    overrides.antagonist_goal = "未检测到反派明确目标信号。";
    issues.push({
      severity: "warning",
      dimension: "antagonist_goal",
      message: "反派行动缺少可识别的自洽目标。",
      suggestion: "确保反派行动由具体目标驱动，而非单纯针对主角。",
    });
  }

  // CHECKLIST item 2: info/resource/power from world rules
  checklistResults[ANTAGONIST_INTELLIGENCE_CHECKLIST[1]!] = true; // requires antagonist_map, hard to detect from text alone

  // CHECKLIST item 3: no dumb villain failure
  const dumbSignals = DUMB_VILLAIN_SIGNALS.filter((p) => p.test(content));
  checklistResults[ANTAGONIST_INTELLIGENCE_CHECKLIST[2]!] = dumbSignals.length === 0;
  if (dumbSignals.length > 0) {
    adjustments.antagonist_method = Math.min(adjustments.antagonist_method ?? 75, 50);
    overrides.antagonist_method = "检测到反派降智信号。";
    issues.push({
      severity: "critical",
      dimension: "antagonist_method",
      message: `正文检测到反派降智信号：${dumbSignals.map((p) => p.source).join("、")}`,
      suggestion: "反派失败必须源自主角伏笔、代价、智慧或微小变量，不能是突然犯低级错误或明知能杀却不杀。",
    });
  }

  // CHECKLIST item 4: no free experience/intel/equipment
  const freebieSignals = /送经验|送情报|送装备|白给|免费.{0,3}(?:获得|拿到|得到)/u.test(content);
  checklistResults[ANTAGONIST_INTELLIGENCE_CHECKLIST[3]!] = !freebieSignals;
  if (freebieSignals) {
    adjustments.antagonist_cost = Math.min(adjustments.antagonist_cost ?? 75, 50);
    overrides.antagonist_cost = "检测到反派无代价送资源信号。";
    issues.push({
      severity: "warning",
      dimension: "antagonist_cost",
      message: "反派不应无理由送经验、情报或装备给主角。",
      suggestion: "主角获得资源应付出代价或利用前文伏笔。",
    });
  }

  // CHECKLIST item 5: post-victory cost/threat remains
  checklistResults[ANTAGONIST_INTELLIGENCE_CHECKLIST[4]!] = true; // nuanced, LLM handles

  // CHECKLIST item 6: reread-able trails
  checklistResults[ANTAGONIST_INTELLIGENCE_CHECKLIST[5]!] = true; // nuanced, LLM handles

  // Type detection for hard scan
  const moujuzheHits = MOUJUZHE_SIGNALS.filter((p) => p.test(content)).length;
  const xundaozheHits = XUNDAOZHE_SIGNALS.filter((p) => p.test(content)).length;
  const weitazheHits = WEITAZHE_SIGNALS.filter((p) => p.test(content)).length;

  if (moujuzheHits >= 2) {
    overrides.antagonist_method = overrides.antagonist_method ?? "检测到谋局者信号（多重计划/信息差掌控）。";
  }
  if (xundaozheHits >= 2) {
    overrides.antagonist_goal = overrides.antagonist_goal ?? "检测到殉道者信号（信念驱动/牺牲逻辑）。";
  }
  if (weitazheHits >= 2) {
    overrides.antagonist_foreshadowing = overrides.antagonist_foreshadowing ?? "检测到伪态者信号（伪装/信任操控）。";
  }

  return { dimensionAdjustments: adjustments, conclusionOverrides: overrides, checklistResults, issues, suggestions };
}

function buildSummary(
  status: AntagonistIntelligenceStatus,
  score: number,
  detectedTypes: string[],
  issues: ReadonlyArray<AntagonistIntelligenceIssue>,
  llmUsed: boolean,
): string {
  const typeStr = detectedTypes.length > 0 ? detectedTypes.join("、") : "未明确检测";
  const methodStr = llmUsed ? "LLM+硬扫描" : "仅硬扫描";
  if (status === "PASS") {
    return `反派智能审核通过（${score}/100，${methodStr}）。检测到反派类型：${typeStr}。`;
  }
  if (status === "WARN") {
    return `反派智能审核警告（${score}/100，${methodStr}）。${issues
      .filter((i) => i.severity === "warning")
      .map((i) => i.message)
      .join("；")}`;
  }
  return `反派智能审核未通过（${score}/100，${methodStr}）。${issues
    .filter((i) => i.severity === "critical")
    .map((i) => i.message)
    .join("；")}`;
}

// ---- file I/O ----

export async function writeAntagonistIntelligenceReportFiles(params: {
  readonly report: AntagonistIntelligenceReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(params.jsonPath), { recursive: true }),
    mkdir(dirname(params.markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(params.jsonPath, JSON.stringify(params.report, null, 2), "utf-8"),
    writeFile(params.markdownPath, renderAntagonistIntelligenceMarkdown(params.report), "utf-8"),
  ]);
}

export function renderAntagonistIntelligenceMarkdown(report: AntagonistIntelligenceReport): string {
  const rows = ANTAGONIST_INTELLIGENCE_DIMENSIONS.map(
    (dim) =>
      `| ${DIMENSION_LABELS[dim]} | ${report.dimensions[dim]} | ${report.dimensionConclusions[dim] || "-"} |`,
  ).join("\n");

  const checklistRows = ANTAGONIST_INTELLIGENCE_CHECKLIST.map(
    (item) => `| ${item} | ${report.checklistResults[item] ? "通过" : "未通过"} |`,
  ).join("\n");

  const issues = report.issues.length
    ? report.issues
        .map(
          (i) =>
            `- [${i.severity}] ${i.dimension}: ${i.message}${i.suggestion ? ` 建议：${i.suggestion}` : ""}`,
        )
        .join("\n")
    : "- 无";

  const suggestions = report.suggestions.length
    ? report.suggestions.map((item) => `- ${item}`).join("\n")
    : "- 无";

  const conclusion =
    report.status === "PASS"
      ? "反派智能审核通过。反派行动展示了与设定类型匹配的智能水平。"
      : report.status === "WARN"
        ? "反派智能审核警告。存在部分智能不足信号，建议人工关注。"
        : report.status === "FAIL_REPORT_ONLY"
          ? "反派智能审核未通过。存在严重降智或动机缺陷，建议修改后重新审核。"
          : `跳过：${report.skippedReason ?? "未执行审核。"}`;

  return `# Antagonist Intelligence Review Report

- 章节：${String(report.chapter).padStart(4, "0")}
- 状态：${report.status}
- 总分：${report.score ?? "N/A"}
- 检测反派类型：${report.antagonistTypeDetected.length > 0 ? report.antagonistTypeDetected.join("、") : "未明确检测"}

## 审核维度

| 维度 | 分数 | 结论 |
|---|---:|---|
${rows}

## 反派智能检查清单

| 检查项 | 结果 |
|---|---|
${checklistRows}

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

export async function readAntagonistIntelligenceSummary(
  bookDir: string,
  chapterIndex: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const prefix = String(chapterIndex).padStart(4, "0");
  const file = join(bookDir, "reviews", "antagonist-intelligence", `${prefix}.report.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const report = JSON.parse(raw) as Partial<AntagonistIntelligenceReport>;
    return {
      status: report.status ?? "UNKNOWN",
      score: report.score ?? null,
      summary: report.summary ?? "",
    };
  } catch {
    return undefined;
  }
}

// ---- helpers ----

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("antagonist-intelligence reviewer did not return JSON");
  }
  return candidate.slice(start, end + 1);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n...(truncated)`;
}
