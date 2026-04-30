import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chatCompletion, type LLMClient } from "../llm/provider.js";

export type FanqieQualityLevel = "优秀" | "可发但建议优化" | "不建议发布";
export type FanqieQualityStatus = "QUALITY_PASS" | "QUALITY_NEED_POLISH" | "QUALITY_FAIL";
export type FanqieFinalQualityStatus = "QUALITY_PASS" | "QUALITY_MANUAL_REVIEW";
export type FanqieQualitySeverity = "低" | "中" | "高";

export interface FanqieQualityIssue {
  readonly type: string;
  readonly severity: FanqieQualitySeverity;
  readonly detail: string;
}

export interface FanqieQualityScores {
  readonly hook_payoff: number;
  readonly pacing: number;
  readonly ending_hook: number;
  readonly emotion: number;
  readonly publish_risk: number;
}

export interface FanqieQualityReport {
  readonly book: string;
  readonly chapter_index: number;
  readonly chapter_title: string;
  readonly source_file?: string;
  readonly body_source?: "fixed" | "salvaged" | "polished" | "original";
  readonly source_decision?: string;
  readonly continuity_final_status?: "PASS" | "MANUAL_REVIEW" | "DROP";
  readonly quality_final_status?: FanqieFinalQualityStatus;
  readonly quality_score: number;
  readonly level: FanqieQualityLevel;
  readonly status: FanqieQualityStatus;
  readonly scores: FanqieQualityScores;
  readonly strengths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<FanqieQualityIssue>;
  readonly reader_drop_risks: ReadonlyArray<string>;
  readonly polish_suggestions: ReadonlyArray<string>;
  readonly polish_prompt: string;
  readonly publish_blocked_by_continuity: boolean;
  readonly polish_attempt?: number;
  readonly max_polish_attempts?: number;
  readonly final_quality_score?: number;
  readonly final_quality_status?: FanqieFinalQualityStatus;
  readonly used_polished_file?: string;
}

export interface RunFanqieQualityCheckInput {
  readonly client: LLMClient;
  readonly model: string;
  readonly chapterText: string;
  readonly prevChapter?: string;
  readonly nextOutline?: string;
  readonly bookName: string;
  readonly chapterIndex: number;
  readonly chapterTitle?: string;
  readonly sourceFile?: string;
  readonly bodySource?: "fixed" | "salvaged" | "polished" | "original";
  readonly sourceDecision?: string;
  readonly continuityFinalStatus?: "PASS" | "MANUAL_REVIEW" | "DROP";
  readonly qualityFinalStatus?: FanqieFinalQualityStatus;
  readonly publishBlockedByContinuity?: boolean;
  readonly polishAttempt?: number;
  readonly maxPolishAttempts?: number;
  readonly finalQualityScore?: number;
  readonly finalQualityStatus?: FanqieFinalQualityStatus;
  readonly usedPolishedFile?: string;
  readonly reportJsonPath?: string;
  readonly reportMarkdownPath?: string;
}

export async function runFanqieQualityCheck(input: RunFanqieQualityCheckInput): Promise<FanqieQualityReport> {
  const response = await chatCompletion(input.client, input.model, [
    {
      role: "system",
      content: [
        "你是番茄网文章节发布前质量检测器。",
        "你只评估爽点、节奏、钩子、情绪和留存风险，不评估连续性。",
        "你必须只输出合法 JSON，不要输出 Markdown，不要输出解释。",
      ].join("\n"),
    },
    { role: "user", content: buildFanqieQualityPrompt(input) },
  ], { temperature: 0.1, maxTokens: 4096 });

  const parsed = parseFanqieQualityReport(response.content, input);
  const guarded = normalizeFanqieQualityReport(parsed, input);
  await writeFanqieQualityReportFiles(guarded, input.reportJsonPath, input.reportMarkdownPath);
  return guarded;
}

export async function runLocalFanqieQualityCheck(input: Omit<RunFanqieQualityCheckInput, "client" | "model">): Promise<FanqieQualityReport> {
  const report = normalizeFanqieQualityReport(buildLocalFanqieQualityReport(input), input);
  await writeFanqieQualityReportFiles(report, input.reportJsonPath, input.reportMarkdownPath);
  return report;
}

export function renderFanqieQualityMarkdown(report: FanqieQualityReport): string {
  const issueLines = report.issues.length
    ? report.issues.map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n")
    : "- 无";
  const strengths = report.strengths.length ? report.strengths.map((item) => `- ${item}`).join("\n") : "- 无";
  const risks = report.reader_drop_risks.length ? report.reader_drop_risks.map((item) => `- ${item}`).join("\n") : "- 无";
  const suggestions = report.polish_suggestions.length ? report.polish_suggestions.map((item) => `- ${item}`).join("\n") : "- 无";
  const needPolish = report.status === "QUALITY_PASS" ? "否" : "是";
  const publishAdvice = report.publish_blocked_by_continuity
    ? "连续性未通过，发布前必须先处理 continuity。"
    : report.status === "QUALITY_PASS"
      ? "可发布。"
      : report.status === "QUALITY_NEED_POLISH"
        ? "可发但建议先做轻量优化。"
        : "不建议发布，建议强优化后复检。";

  return `# 番茄质量检测报告

- 书名：${report.book}
- 章节：${String(report.chapter_index).padStart(4, "0")}${report.chapter_title ? ` ${report.chapter_title}` : ""}
- 总分：${report.quality_score}
- 等级：${report.level}
- 状态：${report.status}
- 正文来源：${report.source_file || "未记录"}${report.body_source ? ` (${report.body_source})` : ""}
- 来源决策：${report.source_decision || "未记录"}
- continuity 最终状态：${report.continuity_final_status || "未记录"}
- continuity 阻塞：${report.publish_blocked_by_continuity ? "是" : "否"}
${report.polish_attempt !== undefined ? `- 优化次数：${report.polish_attempt}/${report.max_polish_attempts ?? 0}\n` : ""}${report.final_quality_status ? `- 最终质量状态：${report.final_quality_status}\n` : ""}${report.used_polished_file ? `- 使用优化稿：${report.used_polished_file}\n` : ""}
- 是否需要优化：${needPolish}
- 发布建议：${publishAdvice}

## 各项分数

| item | score |
|---|---:|
| 爽点密度 | ${report.scores.hook_payoff} |
| 节奏推进 | ${report.scores.pacing} |
| 结尾钩子 | ${report.scores.ending_hook} |
| 情绪拉扯 | ${report.scores.emotion} |
| 发布风险 | ${report.scores.publish_risk} |

## 优点

${strengths}

## 主要问题

${issueLines}

## 留存风险

${risks}

## 优化建议

${suggestions}
`;
}

export function resolveFanqieQualityStatus(score: number): FanqieQualityStatus {
  if (score >= 85) return "QUALITY_PASS";
  if (score >= 70) return "QUALITY_NEED_POLISH";
  return "QUALITY_FAIL";
}

export function resolveFanqieQualityLevel(score: number): FanqieQualityLevel {
  if (score >= 85) return "优秀";
  if (score >= 70) return "可发但建议优化";
  return "不建议发布";
}

export function buildFanqiePolishPrompt(params: {
  readonly chapterText: string;
  readonly issues: ReadonlyArray<FanqieQualityIssue> | string;
  readonly qualityScore: number;
}): string {
  if (params.qualityScore >= 85) return "";
  const issues = typeof params.issues === "string"
    ? params.issues
    : params.issues.map((issue) => `[${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n");
  return params.qualityScore >= 70
    ? buildLightPolishPrompt(params.chapterText, issues)
    : buildStrongPolishPrompt(params.chapterText, issues);
}

function buildFanqieQualityPrompt(input: RunFanqieQualityCheckInput): string {
  return `请检测当前章节是否适合番茄发布前跑数据。

【书名】
${input.bookName}

【章节】
${input.chapterIndex}${input.chapterTitle ? ` ${input.chapterTitle}` : ""}

【上一章全文，可选】
${input.prevChapter || "未提供"}

【当前章节全文】
${input.chapterText}

【下一章规划，可选】
${input.nextOutline || "未提供"}

【检测维度】
1. 爽点密度 score_hook_payoff，满分 30。
2. 节奏推进 score_pacing，满分 25。
3. 结尾钩子 score_ending_hook，满分 20。
4. 情绪拉扯 score_emotion，满分 15。
5. 发布风险 score_publish_risk，满分 10，分数越高风险越低。

【输出要求】
必须输出可解析 JSON：
{
  "book": "${input.bookName}",
  "chapter_index": ${input.chapterIndex},
  "chapter_title": "${escapeJsonString(input.chapterTitle || "")}",
  "quality_score": 82,
  "level": "优秀 | 可发但建议优化 | 不建议发布",
  "status": "QUALITY_PASS | QUALITY_NEED_POLISH | QUALITY_FAIL",
  "scores": {
    "hook_payoff": 22,
    "pacing": 20,
    "ending_hook": 16,
    "emotion": 13,
    "publish_risk": 8
  },
  "strengths": [],
  "issues": [{ "type": "爽点不足", "severity": "中", "detail": "..." }],
  "reader_drop_risks": [],
  "polish_suggestions": [],
  "polish_prompt": ""
}

注意：
- quality_score 必须等于五项 scores 相加。
- quality_score >= 85 时 polish_prompt 必须为空字符串。
- 70 <= quality_score < 85 时 polish_prompt 由系统生成，你可以留空。
- quality_score < 70 时 polish_prompt 由系统生成，你可以留空。`;
}

function buildLocalFanqieQualityReport(input: Omit<RunFanqieQualityCheckInput, "client" | "model">): FanqieQualityReport {
  const text = input.chapterText;
  const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const first300 = text.slice(0, 300);
  const ending = text.slice(-500);
  const stimulusMatches = text.match(/压|杀|逃|血|痛|怒|惊|轰|裂|断|反|逼近|危机|真相|秘密|露出|出现|终于|竟然|不对|代价|机会|收获|突破|跪|死/g)?.length ?? 0;
  const dialogueMatches = text.match(/“[^”]+”/g)?.length ?? 0;
  const actionMatches = text.match(/冲|退|抓|挥|斩|砸|撞|拖|拉|踏|扑|按|抬|盯|转身|低吼/g)?.length ?? 0;
  const explanationPenalty = text.match(/因为|所谓|规则|体系|境界|设定|意味着|换句话说/g)?.length ?? 0;
  const openingConflict = /压|杀|逃|血|痛|怒|惊|轰|裂|断|逼近|危机|不对/.test(first300);
  const endingHook = /不对|忽然|下一刻|声音|睁开|出现|逼近|裂开|抬头|笑了|死|活|主人|真相|秘密/.test(ending);
  const hasChoice = /选择|必须|只能|赌|代价|要么|否则|不敢|不能/.test(text);
  const stagnantParagraphs = paragraphs.filter((p) => p.length > 260 && !/[“”]/.test(p) && !/冲|退|杀|血|轰|裂|问|吼|笑|出现/.test(p)).length;

  const hook = clampDimension(Math.round(14 + Math.min(10, stimulusMatches / 4) + (endingHook ? 3 : 0) - stagnantParagraphs), 0, 30);
  const pacing = clampDimension(Math.round(12 + (openingConflict ? 5 : 0) + Math.min(5, actionMatches / 5) + (paragraphs.length >= 20 ? 2 : 0) - stagnantParagraphs * 2), 0, 25);
  const hookEnding = clampDimension(endingHook ? 16 + Math.min(4, stimulusMatches / 12) : 8, 0, 20);
  const emotion = clampDimension(Math.round(7 + (hasChoice ? 3 : 0) + Math.min(3, dialogueMatches / 4) + Math.min(2, stimulusMatches / 10)), 0, 15);
  const risk = clampDimension(Math.round(8 + (dialogueMatches > 0 ? 1 : -1) + (actionMatches > 4 ? 1 : -1) - Math.min(4, explanationPenalty / 3) - stagnantParagraphs), 0, 10);
  const scores = { hook_payoff: hook, pacing, ending_hook: hookEnding, emotion, publish_risk: risk };
  const total = sumScores(scores);
  const issues: FanqieQualityIssue[] = [];
  if (hook < 18) issues.push({ type: "爽点不足", severity: "中", detail: "章节有效刺激偏少，缺少明确反击、反转、收获或信息揭露。" });
  if (pacing < 15) issues.push({ type: "节奏偏慢", severity: "中", detail: "开篇冲突或中段变化不足，行动链不够清晰。" });
  if (hookEnding < 11) issues.push({ type: "结尾钩子偏弱", severity: "高", detail: "结尾没有形成足够明确的新危机、新问题或新期待。" });
  if (risk < 5) issues.push({ type: "发布风险高", severity: "高", detail: "章节可能存在说明偏多、动作对白偏少或目标不清的问题。" });

  return {
    book: input.bookName,
    chapter_index: input.chapterIndex,
    chapter_title: input.chapterTitle || "",
    quality_score: total,
    level: resolveFanqieQualityLevel(total),
    status: resolveFanqieQualityStatus(total),
    scores,
    strengths: [
      ...(openingConflict ? ["开篇较快进入压力或冲突。"] : []),
      ...(endingHook ? ["结尾具备继续阅读期待。"] : []),
      ...(dialogueMatches > 0 ? ["章节包含对白，具备场景互动。"] : []),
    ],
    issues,
    reader_drop_risks: issues.map((issue) => issue.detail),
    polish_suggestions: buildSuggestions(scores),
    polish_prompt: "",
    source_file: input.sourceFile,
    body_source: input.bodySource,
    source_decision: input.sourceDecision,
    continuity_final_status: input.continuityFinalStatus,
    quality_final_status: input.qualityFinalStatus,
    publish_blocked_by_continuity: Boolean(input.publishBlockedByContinuity),
  };
}

function normalizeFanqieQualityReport(report: Partial<FanqieQualityReport>, input: Omit<RunFanqieQualityCheckInput, "client" | "model">): FanqieQualityReport {
  const scores = normalizeScores(report.scores);
  const qualityScore = sumScores(scores);
  const issues = normalizeIssues(report.issues);
  const normalized: FanqieQualityReport = {
    book: stringValue(report.book) || input.bookName,
    chapter_index: normalizePositiveInt(report.chapter_index, input.chapterIndex),
    chapter_title: stringValue(report.chapter_title) || input.chapterTitle || "",
    source_file: input.sourceFile ?? (stringValue(report.source_file) || undefined),
    body_source: input.bodySource ?? normalizeBodySource(report.body_source),
    source_decision: input.sourceDecision ?? (stringValue(report.source_decision) || undefined),
    continuity_final_status: input.continuityFinalStatus ?? normalizeContinuityFinalStatus(report.continuity_final_status),
    quality_final_status: input.qualityFinalStatus ?? report.quality_final_status,
    quality_score: qualityScore,
    level: resolveFanqieQualityLevel(qualityScore),
    status: resolveFanqieQualityStatus(qualityScore),
    scores,
    strengths: stringArray(report.strengths),
    issues,
    reader_drop_risks: stringArray(report.reader_drop_risks),
    polish_suggestions: stringArray(report.polish_suggestions).length ? stringArray(report.polish_suggestions) : buildSuggestions(scores),
    polish_prompt: "",
    publish_blocked_by_continuity: Boolean(input.publishBlockedByContinuity),
    polish_attempt: input.polishAttempt ?? report.polish_attempt,
    max_polish_attempts: input.maxPolishAttempts ?? report.max_polish_attempts,
    final_quality_score: input.finalQualityScore ?? report.final_quality_score,
    final_quality_status: input.finalQualityStatus ?? report.final_quality_status,
    used_polished_file: input.usedPolishedFile ?? report.used_polished_file,
  };
  return {
    ...normalized,
    polish_prompt: buildFanqiePolishPrompt({
      chapterText: input.chapterText,
      issues: normalized.issues,
      qualityScore,
    }),
  };
}

async function writeFanqieQualityReportFiles(
  report: FanqieQualityReport,
  jsonPath?: string,
  markdownPath?: string,
): Promise<void> {
  if (jsonPath) {
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }
  if (markdownPath) {
    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, renderFanqieQualityMarkdown(report), "utf-8");
  }
}

function parseFanqieQualityReport(raw: string, input: Omit<RunFanqieQualityCheckInput, "client" | "model">): Partial<FanqieQualityReport> {
  try {
    return JSON.parse(extractJsonObject(raw)) as Partial<FanqieQualityReport>;
  } catch {
    return buildLocalFanqieQualityReport(input);
  }
}

function normalizeScores(value: unknown): FanqieQualityScores {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    hook_payoff: clampDimension(Number(source.hook_payoff), 0, 30),
    pacing: clampDimension(Number(source.pacing), 0, 25),
    ending_hook: clampDimension(Number(source.ending_hook), 0, 20),
    emotion: clampDimension(Number(source.emotion), 0, 15),
    publish_risk: clampDimension(Number(source.publish_risk), 0, 10),
  };
}

function normalizeBodySource(value: unknown): "fixed" | "salvaged" | "polished" | "original" | undefined {
  return value === "fixed" || value === "salvaged" || value === "polished" || value === "original" ? value : undefined;
}

function normalizeContinuityFinalStatus(value: unknown): "PASS" | "MANUAL_REVIEW" | "DROP" | undefined {
  return value === "PASS" || value === "MANUAL_REVIEW" || value === "DROP" ? value : undefined;
}

function sumScores(scores: FanqieQualityScores): number {
  return scores.hook_payoff + scores.pacing + scores.ending_hook + scores.emotion + scores.publish_risk;
}

function buildSuggestions(scores: FanqieQualityScores): string[] {
  const suggestions: string[] = [];
  if (scores.hook_payoff < 25) suggestions.push("在中段增加一次反击、反转、信息收益或危险逼近。");
  if (scores.pacing < 21) suggestions.push("压缩说明段，每 3~5 段加入动作、阻碍或新信息。");
  if (scores.ending_hook < 17) suggestions.push("结尾增加更具体的新危机、新问题或信息爆点。");
  if (scores.emotion < 13) suggestions.push("强化主角选择、代价和读者代入情绪。");
  if (scores.publish_risk < 8) suggestions.push("减少设定说明，增加动作、对白和冲突。");
  return suggestions;
}

function buildLightPolishPrompt(chapterText: string, issues: string): string {
  return `你正在优化一章“可发布但爽点不足”的番茄网文章节。

【当前章节】
${chapterText}

【检测问题】
${issues}

【优化要求】
1. 不改变剧情主线。
2. 不改变人物关系。
3. 不改变战力层级。
4. 保留原文70%以上内容。
5. 增强中段爽点或危机推进。
6. 每3~5段增加一次变化。
7. 结尾钩子更尖锐，必须让读者想看下一章。
8. 输出完整优化后的章节正文。

禁止输出解释说明。`;
}

function buildStrongPolishPrompt(chapterText: string, issues: string): string {
  return `你正在优化一章“不建议发布”的番茄网文章节。

【当前章节】
${chapterText}

【检测问题】
${issues}

【优化要求】
1. 保留核心事件和本章剧情目的。
2. 可以重排结构和段落。
3. 开篇300字内必须进入冲突。
4. 中段必须有至少一次反转、压迫升级、信息收益或代价交换。
5. 结尾必须形成强钩子。
6. 删除大段说明文。
7. 增加动作、对白、选择和代价。
8. 保持番茄网文风格：短段落、快节奏、强冲突、强期待。

禁止改变主线、战力、人物关系。
禁止输出解释说明。`;
}

function normalizeIssues(value: unknown): FanqieQualityIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const severity: FanqieQualitySeverity = source.severity === "高" || source.severity === "中" || source.severity === "低" ? source.severity : "中";
    return {
      type: stringValue(source.type || "番茄质量问题"),
      severity,
      detail: stringValue(source.detail || item),
    };
  }).filter((issue) => issue.detail);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function clampDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function extractJsonObject(raw: string): string {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found");
  return stripped.slice(start, end + 1);
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
