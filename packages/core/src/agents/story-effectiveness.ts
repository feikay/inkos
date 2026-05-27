import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BaseAgent } from "./base.js";

export const STORY_EFFECTIVENESS_DIMENSIONS = [
  "emotion_event",
  "desire_goal",
  "obstacle_pressure",
  "solution_method",
  "climax_payoff",
  "ending_pull",
] as const;

export type StoryEffectivenessDimension = typeof STORY_EFFECTIVENESS_DIMENSIONS[number];
export type StoryEffectivenessStatus = "PASS" | "WARN" | "FAIL_STRUCTURAL" | "SKIPPED";

export interface StoryEffectivenessIssue {
  readonly severity: "info" | "warning" | "critical";
  readonly dimension: StoryEffectivenessDimension | "resource_consistency" | "local_scan";
  readonly message: string;
  readonly suggestion?: string;
}

export interface StoryEffectivenessReport {
  readonly chapter: number;
  readonly status: StoryEffectivenessStatus;
  readonly score: number | null;
  readonly dimensions: Record<StoryEffectivenessDimension, number>;
  readonly dimensionConclusions: Record<StoryEffectivenessDimension, string>;
  readonly strengths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<StoryEffectivenessIssue>;
  readonly suggestions: ReadonlyArray<string>;
  readonly skippedReason?: string;
}

export interface StoryEffectivenessReviewInput {
  readonly chapter: number;
  readonly chapterContent?: string;
  readonly chapterIntent?: string;
  readonly resourceBlocking?: boolean;
  readonly chapterIndexStatus?: string;
}

const DIMENSION_LABELS: Record<StoryEffectivenessDimension, string> = {
  emotion_event: "情绪事件",
  desire_goal: "欲望目标",
  obstacle_pressure: "阻碍困境",
  solution_method: "解决方法",
  climax_payoff: "行动高潮",
  ending_pull: "结局反馈",
};

// ---- hard-scan signal sets ----

const EMOTION_EVENT_SIGNALS = [
  /冲突|压迫|不公|羞辱|威胁|危险|紧张|恐惧|愤怒|绝望|痛苦|挣扎|逼迫|围堵|追杀|袭击|闯入|爆发|炸裂|坍塌|坠毁/u,
  /画面|场景|镜头|只见|看见|听到|感到|闻到了|触到/u,
];

const EMOTION_WEAK_START = [
  /^(?:第[一二三四五六七八九十\d]+章|chapter\s*\d+|[\d]+[\s\n]*$)/iu,
  /^(?:系统|设定|背景|世界观|力量体系|等级|境界|修为)/u,
];

const DESIRE_GOAL_SIGNALS = [
  /目标|目的|一定要|必须要|非得|得去|要去|打算|计划|决定|决心|誓要/u,
  /唯一目标|本章目标|当前目标|必须.{0,12}(?:做出|完成|拿到|救|护|守|挡|逃|赢)/u,
  /为了|为的是|只为|只想|只要.{0,10}就/u,
  /拿到|逃出|揭开|压住|赢过|找到|救出|保护|阻止|破坏|夺取|获得/u,
  /攒够|换.{0,8}(?:武器|物资|积分)|护住|守住|挡下/u,
];

const OBSTACLE_PRESSURE_SIGNALS = [
  /阻碍|阻挡|拦住|挡住|封锁|限制|禁止|门槛|条件|代价|压力|施压|逼迫|威胁|危险|困难|困境|绝境/u,
  /敌人|对手|反派|守卫|巡逻|监视|追兵|伏兵|陷阱|圈套|阴谋|算计/u,
  /不够|不足|缺少|缺乏|没有|耗尽|用光|见底/u,
];

const SOLUTION_METHOD_SIGNALS = [
  /利用|借助|通过|依靠|凭着|趁|顺着|借|以.{0,6}(?:方式|方法|手段|途径)/u,
  /计划|策略|方案|办法|计策|谋划|布局|设局|安排/u,
  /线索|破绽|漏洞|弱点|机会|时机|空子|间隙/u,
  /伏笔|前文|之前|上一次|上一章|上次|曾经|过去.{0,6}(?:得到|学会|获得|知道)/u,
];

const CLIMAX_PAYOFF_SIGNALS = [
  /高潮|爆发|冲.{0,4}(?:破|开|出|进|入)|突破|逆转|反转|翻盘|决胜|一击/u,
  /赢了|成功|做到了|达成了|实现了|拿到了|获得了|解锁|开启|激活/u,
  /付出了|牺牲|失去|消耗|用了|花了|代价|换来了/u,
  /升级|晋升|突破|蜕变|进化|觉醒|强化|变强|提升/u,
];

const ENDING_PULL_SIGNALS = [
  /问题|悬念|疑问|谜|秘密|真相|答案/u,
  /突然|忽然|却见|只见|还没|尚未|未知|不知道|没想到|竟然|居然/u,
  /门外|身后|响起|弹出|面板|提示|下一刻|接下来|下一章|下一卷/u,
  /留下|埋下|新的|更大的|更深|更危险/u,
];

const STRENGTH_PATTERNS: Array<{ readonly pattern: RegExp; readonly dimension: StoryEffectivenessDimension; readonly label: string }> = [
  { pattern: /冲突.{0,10}(?:画面|场景)/u, dimension: "emotion_event", label: "以具体冲突画面开场" },
  { pattern: /目标.{0,6}(?:明确|清晰|单一)/u, dimension: "desire_goal", label: "主角目标明确" },
  { pattern: /阻碍.{0,4}递进/u, dimension: "obstacle_pressure", label: "阻碍递进增压" },
  { pattern: /伏笔|代价.{0,6}(?:换|取)/u, dimension: "solution_method", label: "破局有伏笔或代价支撑" },
  { pattern: /高潮|反转|决胜/u, dimension: "climax_payoff", label: "包含高潮或反转" },
  { pattern: /钩子|悬念|伏笔.*(?:留|埋)/u, dimension: "ending_pull", label: "结尾留下钩子" },
];

export class StoryEffectivenessAgent extends BaseAgent {
  get name(): string {
    return "story-effectiveness";
  }

  async review(input: StoryEffectivenessReviewInput): Promise<StoryEffectivenessReport> {
    // Resource blocking / chapter status degraded → skip
    if (input.resourceBlocking) {
      return buildSkippedEffectivenessReport(input, "资源账本校验失败，跳过故事有效性审核。");
    }
    if (input.chapterIndexStatus === "state-degraded" || input.chapterIndexStatus === "blocked-resource-plan") {
      return buildSkippedEffectivenessReport(input, `章节状态为 ${input.chapterIndexStatus}，跳过故事有效性审核。`);
    }

    const content = input.chapterContent ?? "";
    if (!content.trim()) {
      return buildSkippedEffectivenessReport(input, "章节正文为空，无法执行故事有效性审核。");
    }

    const opening = content.slice(0, 500);
    const ending = content.slice(-500);
    const body = content.length > 1000 ? content.slice(500, -500) : content;
    const goalSpan = `${opening}\n${body}`;

    const dimensions = { ...DEFAULT_SCORES };
    const issues: StoryEffectivenessIssue[] = [];
    const strengths: string[] = [];
    const conclusions: Record<StoryEffectivenessDimension, string> = { ...defaultConclusions("未检测到明显信号。") };

    // ---- emotion_event ----
    const emotionSignals = EMOTION_EVENT_SIGNALS.filter((p) => p.test(opening));
    const weakStart = EMOTION_WEAK_START.some((p) => p.test(opening));
    if (emotionSignals.length >= 2 && !weakStart) {
      dimensions.emotion_event = 90;
      conclusions.emotion_event = "开头包含具体冲突画面或情绪事件。";
      strengths.push("开头以具体冲突画面调动读者情绪。");
    } else if (emotionSignals.length >= 1 && !weakStart) {
      dimensions.emotion_event = 75;
      conclusions.emotion_event = "开头有一定冲突信号但情绪强度可加强。";
      issues.push({
        severity: "warning",
        dimension: "emotion_event",
        message: "开头情绪事件信号偏弱，建议用更具体的冲突画面开场。",
        suggestion: "用一个动作、一句公开羞辱或一个被夺走的东西开场，让读者先看见不公再理解设定。",
      });
    } else if (weakStart) {
      dimensions.emotion_event = 40;
      conclusions.emotion_event = "开头疑似设定说明或章节标题，缺少具体冲突画面。";
      issues.push({
        severity: "critical",
        dimension: "emotion_event",
        message: "开头以设定说明或背景介绍开场，缺少具体冲突画面。",
        suggestion: "先给情绪事件（冲突、不公、压迫），再解释背景。避免用设定说明开场。",
      });
    } else {
      dimensions.emotion_event = 55;
      conclusions.emotion_event = "未在开头检测到明显冲突画面信号。";
      issues.push({
        severity: "warning",
        dimension: "emotion_event",
        message: "开头未检测到明显冲突画面或情绪事件。",
        suggestion: "用一个具体冲突动作开场，而非平铺直叙。",
      });
    }

    // ---- desire_goal ----
    const goalSignals = DESIRE_GOAL_SIGNALS.filter((p) => p.test(goalSpan));
    if (goalSignals.length >= 2) {
      dimensions.desire_goal = 90;
      conclusions.desire_goal = "主角目标明确且可行动。";
      strengths.push("主角目标清晰可追踪。");
    } else if (goalSignals.length >= 1) {
      dimensions.desire_goal = 75;
      conclusions.desire_goal = "检测到主角目标但表达可更明确。";
      issues.push({
        severity: "warning",
        dimension: "desire_goal",
        message: "主角目标信号偏弱，读者可能不清楚本章主角要什么。",
        suggestion: "用可验证的动作动词表达目标：拿到、逃出、揭开、压住、赢过。",
      });
    } else {
      dimensions.desire_goal = 50;
      conclusions.desire_goal = "未检测到明确主角目标。";
      issues.push({
        severity: "critical",
        dimension: "desire_goal",
        message: "正文中未检测到明确的主角目标，章节可能缺乏牵引力。",
        suggestion: "确保主角在本章有单一、清晰、可行动的目标。",
      });
    }

    // ---- obstacle_pressure ----
    const obstacleSignals = OBSTACLE_PRESSURE_SIGNALS.filter((p) => p.test(content));
    if (obstacleSignals.length >= 3) {
      dimensions.obstacle_pressure = 90;
      conclusions.obstacle_pressure = "阻碍来源多样，递进压力充足。";
      strengths.push("阻碍压力充足且来源多样。");
    } else if (obstacleSignals.length >= 1) {
      dimensions.obstacle_pressure = 75;
      conclusions.obstacle_pressure = "检测到阻碍但压力和递进可加强。";
      issues.push({
        severity: "warning",
        dimension: "obstacle_pressure",
        message: "阻碍存在但可能不够递进或不够具体。",
        suggestion: "让阻碍来自故事内在规则（强敌、制度、资源短缺），每个阻碍都让目标更难、更贵或更危险。",
      });
    } else {
      dimensions.obstacle_pressure = 45;
      conclusions.obstacle_pressure = "未检测到明确阻碍或压力。";
      issues.push({
        severity: "critical",
        dimension: "obstacle_pressure",
        message: "正文未检测到明确阻碍困境，故事可能缺乏冲突张力。",
        suggestion: "本章需要有来自反派、制度、资源或环境的明确阻碍。",
      });
    }

    // ---- solution_method ----
    const solutionSignals = SOLUTION_METHOD_SIGNALS.filter((p) => p.test(content));
    if (solutionSignals.length >= 2) {
      dimensions.solution_method = 90;
      conclusions.solution_method = "破局有策略、伏笔或代价支撑。";
      strengths.push("破局方法有依据而非临时开挂。");
    } else if (solutionSignals.length >= 1) {
      dimensions.solution_method = 75;
      conclusions.solution_method = "检测到破局方法但策略感可加强。";
      issues.push({
        severity: "warning",
        dimension: "solution_method",
        message: "破局方法信号偏弱，可能显得主角靠运气过关。",
        suggestion: "让主角利用前文伏笔、性格选择或微小信息差破局。",
      });
    } else {
      dimensions.solution_method = 55;
      conclusions.solution_method = "未检测到明确破局策略信号。";
      issues.push({
        severity: "warning",
        dimension: "solution_method",
        message: "未检测到破局策略或方法信号。",
        suggestion: "让解决方法来自前文伏笔、角色能力或信息差，避免临时开挂。",
      });
    }

    // ---- climax_payoff ----
    const climaxSignals = CLIMAX_PAYOFF_SIGNALS.filter((p) => p.test(content));
    if (climaxSignals.length >= 3) {
      dimensions.climax_payoff = 90;
      conclusions.climax_payoff = "本章包含清晰的高潮场景和收益/代价。";
      strengths.push("高潮有转折且有收益或代价交代。");
    } else if (climaxSignals.length >= 1) {
      dimensions.climax_payoff = 75;
      conclusions.climax_payoff = "检测到高潮信号但力度可加强。";
      issues.push({
        severity: "warning",
        dimension: "climax_payoff",
        message: "高潮信号存在但可能不够强，主角主动权或代价感不足。",
        suggestion: "让高潮由主角主动推进，并付出可见代价换来阶段性胜利。",
      });
    } else {
      dimensions.climax_payoff = 40;
      conclusions.climax_payoff = "未检测到明显高潮或转折。";
      issues.push({
        severity: "critical",
        dimension: "climax_payoff",
        message: "正文未检测到明显高潮或转折信号，本章可能缺乏质变时刻。",
        suggestion: "本章需要有一个让情绪、局势或人物认知升级的行动高潮。",
      });
    }

    // ---- ending_pull ----
    const endingSignals = ENDING_PULL_SIGNALS.filter((p) => p.test(ending));
    if (endingSignals.length >= 2) {
      dimensions.ending_pull = 90;
      conclusions.ending_pull = "结尾有明确钩子或未解决问题。";
      strengths.push("结尾留下悬念或下一章推进方向。");
    } else if (endingSignals.length >= 1) {
      dimensions.ending_pull = 75;
      conclusions.ending_pull = "结尾有一定的延伸感但钩子可更强。";
      issues.push({
        severity: "warning",
        dimension: "ending_pull",
        message: "结尾钩子信号偏弱，读者可能缺乏追读动力。",
        suggestion: "结尾留下新代价、新敌意、新发现或更大的规则裂缝。",
      });
    } else {
      dimensions.ending_pull = 50;
      conclusions.ending_pull = "结尾未检测到明显钩子信号。";
      issues.push({
        severity: "critical",
        dimension: "ending_pull",
        message: "结尾缺少未解决问题或钩子信号，读者可能没有理由翻开下一章。",
        suggestion: "每章结尾必须留下新的未完成欲望：新代价、新敌意、新发现或更大危机。",
      });
    }

    // ---- global strength scan ----
    for (const { pattern, label } of STRENGTH_PATTERNS) {
      if (pattern.test(content) && !strengths.includes(label)) {
        strengths.push(label);
      }
    }

    const score = Math.round(
      STORY_EFFECTIVENESS_DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim], 0) / STORY_EFFECTIVENESS_DIMENSIONS.length,
    );

    const hasCritical = issues.some((issue) => issue.severity === "critical");
    const hasWarning = issues.some((issue) => issue.severity === "warning");
    let status: StoryEffectivenessStatus;
    if (score >= 85 && !hasCritical) {
      status = "PASS";
    } else if (score >= 70 || (!hasCritical && hasWarning)) {
      status = "WARN";
    } else {
      status = "FAIL_STRUCTURAL";
    }

    const suggestions = issues
      .filter((issue) => issue.suggestion)
      .map((issue) => issue.suggestion!);

    return {
      chapter: input.chapter,
      status,
      score,
      dimensions,
      dimensionConclusions: conclusions,
      strengths: [...new Set(strengths)],
      issues,
      suggestions,
    };
  }
}

export function buildSkippedEffectivenessReport(
  input: StoryEffectivenessReviewInput,
  reason: string,
): StoryEffectivenessReport {
  return {
    chapter: input.chapter,
    status: "SKIPPED",
    score: null,
    dimensions: { ...DEFAULT_SCORES },
    dimensionConclusions: defaultConclusions(reason),
    strengths: [],
    issues: [{
      severity: "info",
      dimension: "resource_consistency",
      message: reason,
      suggestion: "先修复资源问题或章节状态后重新审核。",
    }],
    suggestions: ["修复资源闭合或章节状态后重新运行 story-effectiveness review。"],
    skippedReason: reason,
  };
}

export async function writeStoryEffectivenessReportFiles(params: {
  readonly report: StoryEffectivenessReport;
  readonly jsonPath: string;
  readonly markdownPath: string;
}): Promise<void> {
  await Promise.all([
    mkdir(dirname(params.jsonPath), { recursive: true }),
    mkdir(dirname(params.markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(params.jsonPath, JSON.stringify(params.report, null, 2), "utf-8"),
    writeFile(params.markdownPath, renderStoryEffectivenessMarkdown(params.report), "utf-8"),
  ]);
}

export function renderStoryEffectivenessMarkdown(report: StoryEffectivenessReport): string {
  const rows = STORY_EFFECTIVENESS_DIMENSIONS
    .map((dim) => `| ${DIMENSION_LABELS[dim]} | ${report.dimensions[dim]} | ${report.dimensionConclusions[dim] || "-"} |`)
    .join("\n");
  const issues = report.issues.length
    ? report.issues.map((issue) => `- [${issue.severity}] ${issue.dimension}: ${issue.message}${issue.suggestion ? ` 建议：${issue.suggestion}` : ""}`).join("\n")
    : "- 无";
  const strengths = report.strengths.length
    ? report.strengths.map((item) => `- ${item}`).join("\n")
    : "- 无";
  const suggestions = report.suggestions.length
    ? report.suggestions.map((item) => `- ${item}`).join("\n")
    : "- 无";

  const conclusion = report.status === "PASS"
    ? "本章基本满足六步心法故事结构。"
    : report.status === "WARN"
      ? "本章存在部分故事结构弱点，建议人工关注。"
      : report.status === "FAIL_STRUCTURAL"
        ? "本章存在严重故事结构缺陷，建议人工审查后重写相关段落。"
        : `跳过：${report.skippedReason ?? "未执行审核。"}`;

  return `# 第${report.chapter}章 Story Effectiveness Report

- 状态：${report.status}
- 总分：${report.score ?? "N/A"}

## 六步心法维度

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
`;
}

const DEFAULT_SCORES: Record<StoryEffectivenessDimension, number> = {
  emotion_event: 85,
  desire_goal: 85,
  obstacle_pressure: 85,
  solution_method: 85,
  climax_payoff: 85,
  ending_pull: 85,
};

function defaultConclusions(value: string): Record<StoryEffectivenessDimension, string> {
  return Object.fromEntries(
    STORY_EFFECTIVENESS_DIMENSIONS.map((dim) => [dim, value]),
  ) as Record<StoryEffectivenessDimension, string>;
}
