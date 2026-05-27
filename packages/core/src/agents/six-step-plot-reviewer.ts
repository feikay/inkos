import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaseAgent } from "./base.js";
import { SIX_STEP_PLOT_METHOD } from "../story-methods/six-step-plot.js";
import type { StructureSignals, StructureSignalReport } from "../utils/structure-signals.js";
import { buildStructureSignalReport, STRUCTURE_SIGNAL_DIMENSIONS } from "../utils/structure-signals.js";

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
  readonly structureSignalReport?: StructureSignalReport;
}

export interface SixStepPlotReviewInput {
  readonly chapterContent?: string;
  readonly chapterIndex?: number;
  readonly chapterTitle?: string;
  readonly chapterIntent?: string;
  readonly resourceBlocking?: boolean;
  readonly chapterIndexStatus?: string;
  readonly structureSignals?: StructureSignals | null;
}

// ---- dimension labels from SIX_STEP_PLOT_METHOD ----

// Map six-step-plot dimensions to structure signal dimensions for book-level phrase matching
const DIM_TO_STRUCTURE_SIGNALS: Partial<Record<SixStepPlotDimension, (typeof STRUCTURE_SIGNAL_DIMENSIONS)[number][]>> = {
  emotion_event: ["opening_hook", "pressure_source"],
  desire_goal: ["protagonist_goal"],
  obstacle_dilemma: ["obstacle_dilemma", "antagonist_pressure"],
  solution_possibility: ["solution_possibility", "world_rule"],
  action_resolution: ["active_attempt", "resource_reward"],
  ending_feedback: ["ending_pull", "payoff_reward"],
};

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

const MANUAL_SIGNAL_GROUPS: Record<SixStepPlotDimension, RegExp[]> = {
  emotion_event: [
    /血|枪|刀|伤|杀|死|踹|砸|哭|吼|威胁|逼|抢|烧|炸|倒计时|红雾/u,
    /不交.{0,12}(?:死|杀|烧)|半小时|十分钟|晚一秒/u,
  ],
  desire_goal: [
    /目标|必须|一定要|当前唯一|唯一目标|决定|打算/u,
    /攒够|拿到|换取|兑换|救出|护住|守住|挡下|逃出|赢过|阻止/u,
  ],
  obstacle_dilemma: [
    /阻碍|困境|死局|代价|否则|不然|没.{0,3}选择|要么.{0,10}要么/u,
    /不信|防备|提前|只剩|倒计时|强敌|威胁|逼近|短缺|不足|不够/u,
  ],
  solution_possibility: [
    /线索|机会|破绽|规则|漏洞|权限|能力|盟友|变量|办法|策略|方案/u,
    /激活|兑换|换取|利用|借助|依靠|凭着|代价|伏笔|信息差/u,
  ],
  action_resolution: [
    /行动|选择|冲|挡|救|换|兑换|激活|扣|射|砍|撞|解决|破局/u,
    /付出|消耗|代价|流血|伤口|体力|阶段性|净赚|获得|解锁/u,
  ],
  ending_feedback: [
    /获得|净赚|解锁|变化|代价|新敌|新危机|新任务|下一|未解决/u,
    /倒计时|强制|抽取|裂.{0,4}缝|冲破|选择|第一箭|必须立刻/u,
  ],
};

// Per-dimension signal patterns
const SIGNAL_GROUPS: Record<SixStepPlotDimension, RegExp[]> = (() => {
  const groups: Record<string, RegExp[]> = {};
  for (const step of SIX_STEP_PLOT_METHOD.steps) {
    const dimId = step.id.replace(/-/g, "_");
    const hintSignals = buildSignalsFromHints(step.promptHints);
    const checklistSignals = buildSignalsFromChecklist(step.reviewChecklist);
    const manualSignals = MANUAL_SIGNAL_GROUPS[dimId as SixStepPlotDimension] ?? [];
    groups[dimId] = [...new Set([...hintSignals, ...checklistSignals, ...manualSignals].map((r) => r.source))].map(
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
    if (semanticChecklistPassed(content, stepId, item)) {
      passed++;
      continue;
    }
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

function semanticChecklistPassed(content: string, stepId: string, item: string): boolean {
  const opening = content.slice(0, 600);
  const ending = content.slice(-600);

  if (stepId === "emotion-event") {
    if (/压迫|不公|冲突画面/u.test(item)) {
      return /血|枪|刀|伤|杀|死|踹|砸|哭|吼|威胁|逼|抢|烧|炸|倒计时|红雾/u.test(opening);
    }
    if (/避免|抽象概括/u.test(item)) {
      return !/^(?:系统|设定|背景|世界观|力量体系)/u.test(opening.trim())
        && /[，。！？]/u.test(opening)
        && /血|枪|伤|威胁|倒计时|必须|不然|否则/u.test(opening);
    }
  }

  if (stepId === "desire-goal") {
    if (/单一|清晰|可行动/u.test(item)) {
      return /目标|必须|一定要|当前唯一|唯一目标|攒够|拿到|换取|兑换|护住|守住|挡下|逃出|阻止/u.test(content);
    }
    if (/推动下一场冲突|愿望/u.test(item)) {
      return /倒计时|威胁|提前|折返|敌|冲突|选择|死局|下一|马上|即将/u.test(content);
    }
  }

  if (stepId === "obstacle-dilemma") {
    if (/内在规则|硬拦/u.test(item)) {
      return /规则|权限|系统|资源|倒计时|强制|条件|代价/u.test(content);
    }
    if (/积蓄爆发|单纯虐/u.test(item)) {
      return /提前|只剩|逼近|越来越|爆发|冲破|裂.{0,4}缝|死局|必须立刻/u.test(content);
    }
  }

  if (stepId === "solution-possibility") {
    if (/线索|能力|盟友|规则漏洞/u.test(item)) {
      return /线索|能力|盟友|规则|漏洞|权限|兑换|系统|机会|办法/u.test(content);
    }
    if (/没有被困境写死/u.test(item)) {
      return /还能|还有|可以|机会|办法|兑换|激活|换取|选择/u.test(content);
    }
  }

  if (stepId === "action-resolution") {
    if (/主角选择|外力代劳/u.test(item)) {
      return /(?:摸出|开口|拿起|兑换|选择|扣|射)|他没有留/u.test(content);
    }
    if (/情绪|局势|认知升级/u.test(item)) {
      return /这才反应|分明|提前|盯准|强制|死局|净赚|效率/u.test(content);
    }
  }

  if (stepId === "ending-feedback") {
    if (/变强|拿到东西|心态变化|关系变化/u.test(item)) {
      return /获得|净赚|兑换|体力|伤口|代价|效率|坐实/u.test(content);
    }
    if (/下一轮问题|彻底停住/u.test(item)) {
      return /下一|未解决|倒计时|强制抽取|裂.{0,4}缝|冲破|死局|第一箭|选择/u.test(ending);
    }
  }

  return false;
}

// ---- intent fidelity from SIX_STEP_PLOT_METHOD.chapterIntentFields ----

function computeIntentFidelity(chapterIntent?: string): SixStepPlotIntentFidelity | undefined {
  if (!chapterIntent?.trim()) return undefined;

  const fieldsList = SIX_STEP_PLOT_METHOD.chapterIntentFields;
  const fieldsPresent: string[] = [];
  const fieldsMissing: string[] = [];

  for (const field of fieldsList) {
    const aliases = CHAPTER_INTENT_FIELD_ALIASES[field] ?? [field];
    if (aliases.some((alias) => chapterIntent.includes(alias))) {
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

const CHAPTER_INTENT_FIELD_ALIASES: Record<string, string[]> = {
  openingEmotion: ["openingEmotion", "开场情绪", "本章情绪事件"],
  specificConflictImage: ["specificConflictImage", "具体画面", "具体冲突画面"],
  protagonistGoal: ["protagonistGoal", "本章主角目标", "表层目标"],
  goalStakes: ["goalStakes", "如果主角失败", "失败，会失去什么", "深层目标"],
  mainObstacle: ["mainObstacle", "本章阻碍困境", "阻碍来源", "具体阻碍"],
  dilemmaPressure: ["dilemmaPressure", "阻碍强度", "致命级", "压力"],
  possibleSolution: ["possibleSolution", "本章解决方法", "凭什么还有戏", "使用的能力"],
  solutionCost: ["solutionCost", "是否需要付出代价", "付出代价"],
  climaxAction: ["climaxAction", "本章行动高潮", "高潮场景"],
  turningPoint: ["turningPoint", "冲突升级方式", "爽点/反转"],
  chapterPayoff: ["chapterPayoff", "本章结局反馈", "主角获得", "阶段性收益"],
  nextHook: ["nextHook", "下一章钩子", "结尾画面", "未解决问题"],
};

const INTENT_SECTION_ALIASES: Record<SixStepPlotDimension, string[]> = {
  emotion_event: ["本章情绪事件", "情绪事件", "openingEmotion", "specificConflictImage"],
  desire_goal: ["本章主角目标", "主角目标", "表层目标", "protagonistGoal", "goalStakes"],
  obstacle_dilemma: ["本章阻碍困境", "阻碍困境", "阻碍来源", "具体阻碍", "mainObstacle", "dilemmaPressure"],
  solution_possibility: ["本章解决方法", "解决方法", "possibleSolution", "solutionCost"],
  action_resolution: ["本章行动高潮", "行动高潮", "高潮场景", "climaxAction", "turningPoint"],
  ending_feedback: ["本章结局反馈", "结局反馈", "下一章钩子", "chapterPayoff", "nextHook"],
};

function intentOverlapScore(content: string, chapterIntent: string | undefined, dimension: SixStepPlotDimension): number {
  const section = extractIntentSection(chapterIntent, INTENT_SECTION_ALIASES[dimension]);
  if (!section) return 0;
  const keywords = extractIntentKeywords(section);
  if (!keywords.length) return 0;
  const matched = keywords.filter((keyword) => content.includes(keyword)).length;
  return Math.min(60, matched * 10);
}

function extractIntentSection(chapterIntent: string | undefined, aliases: readonly string[]): string {
  if (!chapterIntent?.trim()) return "";
  const lines = chapterIntent.split(/\r?\n/);
  const collected: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^\s*#{1,6}\s*(.+?)\s*$/)?.[1]?.trim();
    if (heading) {
      const matches = aliases.some((alias) => heading.includes(alias));
      if (inSection && !matches) break;
      inSection = matches;
      continue;
    }
    if (inSection) collected.push(line);
  }
  return collected.join("\n");
}

function extractIntentKeywords(section: string): string[] {
  const stopWords = new Set([
    "本章", "主角", "读者", "应该", "产生", "是否", "不得", "禁止", "没有", "相关", "要求",
    "目标", "阻碍", "解决", "方法", "具体", "情绪", "场景", "关系", "变化", "阶段",
    "一个", "本次", "当前", "必须", "需要", "可以", "不能", "不会", "不是", "以及",
  ]);
  const rawTokens = section
    .replace(/[「」『』【】《》“”"'`*_#>\-[\]（）()]/g, " ")
    .split(/[，。、；：？！\s/\\|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 12)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !stopWords.has(token));
  const keywords: string[] = [];
  for (const token of rawTokens) {
    keywords.push(token);
    if (/[\u4e00-\u9fff]/u.test(token) && token.length >= 4) {
      for (let size = 4; size >= 2; size -= 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          const part = token.slice(index, index + size);
          if (!stopWords.has(part)) keywords.push(part);
        }
      }
    }
  }
  return [...new Set(keywords)]
    .filter((keyword) => !stopWords.has(keyword))
    .slice(0, 240);
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
      const intentScore = intentOverlapScore(content, input.chapterIntent, dim);

      // Book-level structure signal phrase matching (boosts score when available)
      let bookSignalBonus = 0;
      if (input.structureSignals) {
        const signalDims = DIM_TO_STRUCTURE_SIGNALS[dim] ?? [];
        for (const signalDim of signalDims) {
          const phrases = input.structureSignals.signals[signalDim] ?? [];
          for (const phrase of phrases) {
            if (content.includes(phrase)) {
              bookSignalBonus += 4;
            }
          }
        }
      }

      // Score: generic signal detection (0-60 without book signals, 0-40 + book bonus otherwise)
      // + checklist (0-40), with chapter_intent overlap as a generic floor.
      const signalScore = input.structureSignals
        ? Math.min(60, Math.min(40, matchCount * 6) + bookSignalBonus)
        : Math.min(60, matchCount * 8);
      const checklistScore = step ? checklistPassed * 20 : 0; // each of 2 items = 20 pts
      dimensions[dim] = Math.min(100, Math.max(signalScore, intentScore) + checklistScore);
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
    } else if (score >= 60 || (!hasCritical && (score >= 55 || hasWarning))) {
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

    const structureSignalReport = input.structureSignals
      ? buildStructureSignalReport(content, input.structureSignals, [
          "opening_hook",
          "protagonist_goal",
          "pressure_source",
          "obstacle_dilemma",
          "solution_possibility",
          "active_attempt",
          "payoff_reward",
          "ending_pull",
          "antagonist_pressure",
        ])
      : undefined;

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
      structureSignalReport,
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
