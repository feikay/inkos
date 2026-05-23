import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaseAgent } from "./base.js";
import { TRANSITION_METHODS, HARD_TRANSITION_PATTERNS } from "../story-methods/transition-methods.js";

export const TRANSITION_QUALITY_DIMENSIONS = [
  "emotion_carryover",
  "hook_guided",
  "environmental_cue",
  "action_entry",
  "scene_clarity",
  "paragraph_propulsion",
] as const;

export type TransitionQualityDimension = typeof TRANSITION_QUALITY_DIMENSIONS[number];
export type TransitionQualityStatus = "PASS" | "WARN" | "FAIL_STRUCTURAL" | "SKIPPED";

export interface TransitionQualityIssue {
  readonly severity: "info" | "warning" | "critical";
  readonly dimension: TransitionQualityDimension | "hard_transition" | "resource_consistency";
  readonly message: string;
  readonly suggestion?: string;
}

export interface TransitionQualityReport {
  readonly chapterIndex: number;
  readonly chapterTitle?: string;
  readonly status: TransitionQualityStatus;
  readonly score: number | null;
  readonly dimensions: Record<TransitionQualityDimension, number>;
  readonly dimensionConclusions: Record<TransitionQualityDimension, string>;
  readonly hardTransitionCount: number;
  readonly hardTransitionPhrases: ReadonlyArray<string>;
  readonly strengths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<TransitionQualityIssue>;
  readonly suggestions: ReadonlyArray<string>;
  readonly summary: string;
  readonly skippedReason?: string;
}

export interface TransitionQualityReviewInput {
  readonly chapterContent?: string;
  readonly chapterIndex?: number;
  readonly chapterTitle?: string;
  readonly resourceBlocking?: boolean;
  readonly chapterIndexStatus?: string;
}

const DIMENSION_LABELS: Record<TransitionQualityDimension, string> = {
  emotion_carryover: "情绪延续",
  hook_guided: "钩子引导",
  environmental_cue: "环境暗示",
  action_entry: "以动带进",
  scene_clarity: "场景切换清晰度",
  paragraph_propulsion: "段落推进感",
};

// Map underscore dimension IDs → hyphen method IDs in TRANSITION_METHODS
const DIM_TO_METHOD_ID: Partial<Record<TransitionQualityDimension, string>> = {
  emotion_carryover: "emotion-carryover",
  hook_guided: "hook-guided",
  environmental_cue: "environmental-cue",
  action_entry: "action-entry",
};

const METHOD_BACKED_DIMENSIONS: ReadonlyArray<TransitionQualityDimension> = [
  "emotion_carryover",
  "hook_guided",
  "environmental_cue",
  "action_entry",
];

// ---- signal groups for 6 dimensions ----

const EMOTION_CARRYOVER_SIGNALS: ReadonlyArray<RegExp> = [
  /仍|还.{0,2}(?:在|是|有|带着|残留|未消|未散)/u,
  /拳.{0,2}(?:握|攥|捏|紧|松)/u,
  /血.{0,2}(?:迹|滴|流|未干|犹在)/u,
  /恨|怒|怕|恐|慌|颤|抖|悸/u,
  /心.{0,3}(?:跳|悸|慌|乱|揪|沉|悬)/u,
  /回.{0,2}(?:响|荡|味|忆|想)/u,
  /气.{0,2}(?:未消|未平|难平|不消)/u,
  /余.{0,2}(?:怒|悸|痛|温|韵)/u,
];

const HOOK_GUIDED_SIGNALS: ReadonlyArray<RegExp> = [
  /消息|传讯|传音|通讯|玉简|飞剑传书|灵讯|电话|信息/u,
  /警报|警讯|示警|预警|异动|异变|突变/u,
  /敲门|来人|闯入|冲进|推门|破门/u,
  /忽然|突然|猛然|骤然|猝然|蓦地/u,
  /打断|惊动|惊扰|唤醒|叫醒/u,
  /法器.{0,3}(?:震动|异动|发光|报警|示警)/u,
  /系统.{0,3}(?:提示|通知|警告|任务)/u,
  /决定去看|要去看看|非去不可|不得不去/u,
];

const ENVIRONMENTAL_CUE_SIGNALS: ReadonlyArray<RegExp> = [
  /灯.{0,2}(?:火|光|亮|灭|暗|昏|明)/u,
  /雨.{0,2}(?:味|声|水|滴|落|停)/u,
  /药.{0,2}(?:香|味|气|草)/u,
  /寒|冷|凉|暖|热|烫|温/u,
  /鼓.{0,2}(?:声|响|点|鸣|角)/u,
  /脚下.{0,3}(?:石|砖|木|草|泥|沙|雪|水)/u,
  /味.{0,2}(?:道|觉|儿|飘|散|漫)/u,
  /声.{0,2}(?:音|响|传|起|入耳)/u,
  /光.{0,2}(?:线|芒|亮|暗|影|照|投)/u,
];

const ACTION_ENTRY_SIGNALS: ReadonlyArray<RegExp> = [
  /门.{0,2}(?:被.{0,3})?(?:踹|踢|撞|推|砸|破)开/u,
  /剑.{0,2}(?:落|砍|劈|刺|斩|挥)/u,
  /刀.{0,2}(?:落|砍|劈|斩|挥|架)/u,
  /一拳|一脚|一掌|一指|一爪/u,
  /名单.{0,3}(?:念|读|公布|贴出)/u,
  /(?:喝道|厉喝|暴喝|怒喝|大喝)/u,
  /(?:跪下|住手|站住|别动|不许动)/u,
  /(?:出手|动手|开打|开战)/u,
];

const SCENE_CLARITY_SIGNALS: ReadonlyArray<RegExp> = [
  /场景|画面|镜头|视角/u,
  /地点|位置|所在.{0,3}(?:是|在|位于)/u,
  /此时|此刻|这时|这会儿|当下/u,
  /(?:之前|刚才|刚刚).{0,5}(?:还在|还在|曾是)/u,
  /换到|转到|切到|来到|到了.{0,5}(?:另一边|另一边|另一处)/u,
  /同一时间|与此同时|另一边|另一方面/u,
  /(?:次日|翌日|第二天|三天后|数日后)/u,
];

const PARAGRAPH_PROPULSION_SIGNALS: ReadonlyArray<RegExp> = [
  /于是|接着|然后|随即|当即|立刻|马上/u,
  /(?:转身|回头|抬头|低头|起身).{0,5}(?:就|便|去|走|看)/u,
  /(?:说完|说罢|话落|话音刚落).{0,5}(?:就|便)/u,
  /(?:想到|想到这|想到这里).{0,5}(?:就|便|不由)/u,
  /(?:与此同时|同一时间|另一边)/u,
  /(?:不过|然而|但是|可是|却).{0,3}(?:还是|仍然|依然)/u,
];

const SIGNAL_GROUPS: Record<TransitionQualityDimension, ReadonlyArray<RegExp>> = {
  emotion_carryover: EMOTION_CARRYOVER_SIGNALS,
  hook_guided: HOOK_GUIDED_SIGNALS,
  environmental_cue: ENVIRONMENTAL_CUE_SIGNALS,
  action_entry: ACTION_ENTRY_SIGNALS,
  scene_clarity: SCENE_CLARITY_SIGNALS,
  paragraph_propulsion: PARAGRAPH_PROPULSION_SIGNALS,
};

// ---- hard scan helpers ----

function scanHardTransitions(content: string): { count: number; phrases: string[] } {
  const found = new Set<string>();
  for (const phrase of HARD_TRANSITION_PATTERNS) {
    if (content.includes(phrase)) {
      found.add(phrase);
    }
  }
  return {
    count: found.size,
    phrases: [...found].sort(),
  };
}

function countMethodSignalMatches(
  content: string,
  methodId: string,
): number {
  const method = TRANSITION_METHODS.find((m) => m.id === methodId);
  if (!method) return 0;

  let matches = 0;
  for (const checklistItem of method.reviewChecklist) {
    const keywords = extractKeywords(checklistItem);
    for (const kw of keywords) {
      if (content.includes(kw)) matches++;
    }
  }

  for (const strategy of method.replacementStrategies) {
    const keywords = extractKeywords(strategy);
    for (const kw of keywords) {
      if (content.includes(kw)) matches++;
    }
  }

  return matches;
}

function extractKeywords(text: string): string[] {
  const tokens: string[] = [];
  // Split by Chinese/English punctuation and whitespace
  const segments = text.split(/[，。、；：？！\s]+/);
  for (const seg of segments) {
    if (seg.length >= 2 && seg.length <= 8) {
      tokens.push(seg);
    } else if (seg.length > 8) {
      // For unpunctuated Chinese text, extract sliding 2-4 char n-grams
      for (let i = 0; i <= seg.length - 2; i++) {
        for (let len = 2; len <= 4 && i + len <= seg.length; len++) {
          tokens.push(seg.slice(i, i + len));
        }
      }
    }
  }
  return [...new Set(tokens)];
}

// ---- review implementation ----

export function buildSkippedTransitionQualityReport(
  input: TransitionQualityReviewInput,
  reason: string,
): TransitionQualityReport {
  return {
    chapterIndex: input.chapterIndex ?? 0,
    chapterTitle: input.chapterTitle,
    status: "SKIPPED",
    score: null,
    dimensions: { ...DEFAULT_TRANSITION_SCORES },
    dimensionConclusions: defaultTransitionConclusions(reason),
    hardTransitionCount: 0,
    hardTransitionPhrases: [],
    strengths: [],
    issues: [{
      severity: "info",
      dimension: "resource_consistency",
      message: reason,
      suggestion: "修复阻断条件后重新运行 transition-quality review。",
    }],
    suggestions: ["修复阻断条件后重新运行 transition-quality review。"],
    summary: `跳过：${reason}`,
    skippedReason: reason,
  };
}

export class TransitionQualityReviewerAgent extends BaseAgent {
  get name(): string {
    return "transition-quality-reviewer";
  }

  async review(input: TransitionQualityReviewInput): Promise<TransitionQualityReport> {
    if (input.resourceBlocking) {
      return buildSkippedTransitionQualityReport(input, "资源账本校验失败，跳过转场质量审核。");
    }
    if (
      input.chapterIndexStatus === "state-degraded" ||
      input.chapterIndexStatus === "blocked-resource-plan"
    ) {
      return buildSkippedTransitionQualityReport(
        input,
        `章节状态为 ${input.chapterIndexStatus}，跳过转场质量审核。`,
      );
    }

    const content = input.chapterContent ?? "";
    if (!content.trim()) {
      return buildSkippedTransitionQualityReport(input, "章节正文为空，跳过转场质量审核。");
    }

    // Very short content: still review but flag
    const isVeryShort = content.trim().length < 200;

    // ---- hard scan ----
    const hardScan = scanHardTransitions(content);

    // Per-dimension signal detection
    const dimensions: Record<TransitionQualityDimension, number> = { ...DEFAULT_TRANSITION_SCORES };
    const conclusions: Record<TransitionQualityDimension, string> = {
      ...defaultTransitionConclusions("未检测到明显信号。"),
    };
    const issues: TransitionQualityIssue[] = [];
    const strengths: string[] = [];

    for (const dim of TRANSITION_QUALITY_DIMENSIONS) {
      const patterns = SIGNAL_GROUPS[dim];
      const matchCount = patterns.filter((p) => p.test(content)).length;
      const methodId = DIM_TO_METHOD_ID[dim];
      const methodSignalCount = methodId ? countMethodSignalMatches(content, methodId) : 0;
      const combinedMatches = matchCount + methodSignalCount;
      const score = Math.min(100, combinedMatches * 12 + 40);
      dimensions[dim] = score;
    }

    // Per-dimension conclusions
    for (const dim of TRANSITION_QUALITY_DIMENSIONS) {
      const score = dimensions[dim];
      const methodId = DIM_TO_METHOD_ID[dim];
      const method = methodId ? TRANSITION_METHODS.find((m) => m.id === methodId) : undefined;
      const methodName = method?.name ?? DIMENSION_LABELS[dim];
      if (score >= 80) {
        conclusions[dim] = `检测到明确的"${methodName}"信号，转场手法运用较好。`;
      } else if (score >= 55) {
        conclusions[dim] = `检测到部分"${methodName}"信号，但强度一般。`;
      } else {
        conclusions[dim] = `未检测到明显的"${methodName}"信号。`;
      }
    }

    // ---- hard transition risk assessment ----
    // Count how many dimensions have method evidence (score >= 55)
    const methodEvidenceCount = METHOD_BACKED_DIMENSIONS.filter(
      (dim) => dimensions[dim] >= 55,
    ).length;

    if (hardScan.count > 0) {
      // Hard transition phrases are risk signals, not death sentences
      // High frequency + no method evidence → FAIL_STRUCTURAL
      // Moderate frequency + some method evidence → WARN
      // Low frequency or high method evidence → info only

      if (hardScan.count >= 5 && methodEvidenceCount < 2) {
        issues.push({
          severity: "critical",
          dimension: "hard_transition",
          message: `检测到 ${hardScan.count} 种硬转场短语（${hardScan.phrases.join("、")}），且缺少有效转场方法信号，存在严重流水账风险。`,
          suggestion: "用情绪延续、钩子引导、环境暗示或以动带进替换硬转场短语，确保场景切换有叙事动力。",
        });
      } else if (hardScan.count >= 3 && methodEvidenceCount < 3) {
        issues.push({
          severity: "warning",
          dimension: "hard_transition",
          message: `检测到 ${hardScan.count} 种硬转场短语（${hardScan.phrases.join("、")}），建议增加转场方法信号。`,
          suggestion: "部分硬转场可以用情绪延续或环境暗示替换，提升场景切换的自然感。",
        });
      } else if (hardScan.count >= 1 && methodEvidenceCount >= 3) {
        issues.push({
          severity: "info",
          dimension: "hard_transition",
          message: `检测到 ${hardScan.count} 种硬转场短语（${hardScan.phrases.join("、")}），但有足够方法信号支撑，风险可控。`,
        });
      } else if (hardScan.count >= 1) {
        issues.push({
          severity: "info",
          dimension: "hard_transition",
          message: `检测到 ${hardScan.count} 种硬转场短语（${hardScan.phrases.join("、")}），转场方法信号偏少。`,
          suggestion: "后续可加强情绪延续或钩子引导来提升转场质量。",
        });
      }
    } else {
      strengths.push("未检测到硬转场短语，转场手法自然。");
    }

    // Dimension-specific issues
    if (dimensions.emotion_carryover < 55) {
      issues.push({
        severity: "warning",
        dimension: "emotion_carryover",
        message: "跨场景情绪延续信号不足，场景切换后情绪可能断裂。",
        suggestion: "在转场后保留主角的身体反应或情绪残留，让情绪跨场景流动。",
      });
    }
    if (dimensions.hook_guided < 55) {
      issues.push({
        severity: "info",
        dimension: "hook_guided",
        message: "钩子引导信号不足，场景切换可能缺乏事件驱动力。",
        suggestion: "用突发事件、消息或异变作为换场动力，让读者追着问题进入下一场。",
      });
    }
    if (dimensions.environmental_cue < 55) {
      issues.push({
        severity: "info",
        dimension: "environmental_cue",
        message: "环境暗示信号不足，场景切换可能缺少感官锚点。",
        suggestion: "用视觉、听觉或触觉细节标记空间变化，提升沉浸感。",
      });
    }
    if (dimensions.action_entry < 55) {
      issues.push({
        severity: "info",
        dimension: "action_entry",
        message: "以动带进信号不足，转场可能包含不必要的移动流程。",
        suggestion: "省略无冲突的移动描写，直接切入冲突动作。",
      });
    }
    if (dimensions.scene_clarity < 55) {
      issues.push({
        severity: "info",
        dimension: "scene_clarity",
        message: "场景切换清晰度信号不足，读者可能困惑当前时空位置。",
        suggestion: "转场时用时间标记或位置线索帮助读者定位。",
      });
    }
    if (dimensions.paragraph_propulsion < 55) {
      issues.push({
        severity: "info",
        dimension: "paragraph_propulsion",
        message: "段落推进感信号不足，段落之间衔接可能松散。",
        suggestion: "用因果连接词或动作承接词加强段落推进。",
      });
    }

    if (isVeryShort) {
      issues.push({
        severity: "info",
        dimension: "resource_consistency",
        message: "章节内容极短（<200字），转场质量评估可能不准确。",
      });
    }

    // Strengths
    for (const dim of TRANSITION_QUALITY_DIMENSIONS) {
      if (dimensions[dim] >= 80) {
        const label = DIMENSION_LABELS[dim];
        strengths.push(`"${label}"信号明确（${dimensions[dim]}/100）。`);
      }
    }

    // ---- score & status ----
    const avgDimensionScore = Math.round(
      TRANSITION_QUALITY_DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim], 0) /
        TRANSITION_QUALITY_DIMENSIONS.length,
    );

    // Hard transition penalty
    const hardPenalty = Math.min(30, hardScan.count * 6);
    const methodBonus = methodEvidenceCount * 5;
    const score = Math.max(0, Math.min(100, avgDimensionScore - hardPenalty + methodBonus));

    const hasCritical = issues.some((i) => i.severity === "critical");
    const hasWarning = issues.some((i) => i.severity === "warning");

    let status: TransitionQualityStatus;
    if (score >= 75 && !hasCritical) {
      status = "PASS";
    } else if (score >= 50 || (!hasCritical && hasWarning)) {
      status = "WARN";
    } else {
      status = "FAIL_STRUCTURAL";
    }

    const suggestions = issues
      .filter((i) => i.suggestion)
      .map((i) => i.suggestion!);

    let summary: string;
    if (status === "PASS") {
      summary = `转场质量审核通过（${score}/100），硬转场 ${hardScan.count} 种，方法证据 ${methodEvidenceCount}/4 维。${strengths.slice(0, 2).join("；")}`;
    } else if (status === "WARN") {
      summary = `转场质量审核警告（${score}/100），硬转场 ${hardScan.count} 种，方法证据 ${methodEvidenceCount}/4 维。${issues.filter((i) => i.severity === "warning").map((i) => i.message).join("；")}`;
    } else {
      summary = `转场质量审核未通过（${score}/100），硬转场 ${hardScan.count} 种，方法证据 ${methodEvidenceCount}/4 维。${issues.filter((i) => i.severity === "critical").map((i) => i.message).join("；")}`;
    }

    return {
      chapterIndex: input.chapterIndex ?? 0,
      chapterTitle: input.chapterTitle,
      status,
      score,
      dimensions,
      dimensionConclusions: conclusions,
      hardTransitionCount: hardScan.count,
      hardTransitionPhrases: hardScan.phrases,
      strengths: [...new Set(strengths)],
      issues,
      suggestions,
      summary,
    };
  }
}

// ---- helpers ----

function defaultTransitionConclusions(value: string): Record<TransitionQualityDimension, string> {
  return Object.fromEntries(
    TRANSITION_QUALITY_DIMENSIONS.map((dim) => [dim, value]),
  ) as Record<TransitionQualityDimension, string>;
}

const DEFAULT_TRANSITION_SCORES: Record<TransitionQualityDimension, number> = {
  emotion_carryover: 55,
  hook_guided: 55,
  environmental_cue: 55,
  action_entry: 55,
  scene_clarity: 55,
  paragraph_propulsion: 55,
};

// ---- file I/O ----

export async function writeTransitionQualityReportFiles(params: {
  readonly report: TransitionQualityReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(params.jsonPath), { recursive: true }),
    mkdir(dirname(params.markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(params.jsonPath, JSON.stringify(params.report, null, 2), "utf-8"),
    writeFile(params.markdownPath, renderTransitionQualityMarkdown(params.report), "utf-8"),
  ]);
}

export function renderTransitionQualityMarkdown(report: TransitionQualityReport): string {
  const rows = TRANSITION_QUALITY_DIMENSIONS.map(
    (dim) =>
      `| ${DIMENSION_LABELS[dim]} | ${report.dimensions[dim]} | ${report.dimensionConclusions[dim] || "-"} |`,
  ).join("\n");

  const hardPhrasesDisplay =
    report.hardTransitionPhrases.length > 0
      ? report.hardTransitionPhrases.map((p) => `\`${p}\``).join("、")
      : "无";

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
      ? "转场质量审核通过，章节转场手法自然、有叙事驱动力。"
      : report.status === "WARN"
        ? "转场质量存在部分弱点，建议人工关注后发布。"
        : report.status === "FAIL_STRUCTURAL"
          ? "转场质量存在严重结构缺陷，建议人工审查后调整。"
          : `跳过：${report.skippedReason ?? "未执行审核。"}`;

  return `# Transition Quality Review Report

- 章节：${String(report.chapterIndex).padStart(4, "0")}${report.chapterTitle ? ` ${report.chapterTitle}` : ""}
- 状态：${report.status}
- 总分：${report.score ?? "N/A"}
- 硬转场短语数：${report.hardTransitionCount}
- 硬转场短语：${hardPhrasesDisplay}

## 六维转场质量

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

export async function readTransitionQualitySummary(
  bookDir: string,
  chapterIndex: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const prefix = String(chapterIndex).padStart(4, "0");
  const file = join(bookDir, "reviews", "transition-quality", `${prefix}.transition-quality.report.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const report = JSON.parse(raw) as Partial<TransitionQualityReport>;
    return {
      status: report.status ?? "UNKNOWN",
      score: report.score ?? null,
      summary: report.summary ?? "",
    };
  } catch {
    return undefined;
  }
}
