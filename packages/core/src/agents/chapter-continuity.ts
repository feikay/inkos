import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { chatCompletion, type LLMClient } from "../llm/provider.js";

export type ContinuityStatus = "PASS" | "NEED_FIX" | "REWRITE_REQUIRED" | "MANUAL_REVIEW";
export type ContinuityLevel = "优秀" | "可用" | "不合格";
export type ContinuityRewriteMode = "none" | "light_fix" | "full_rewrite";
export type ContinuityFinalStatus = "PASS" | "MANUAL_REVIEW" | "RETRY";

export interface ContinuityIssue {
  readonly type: string;
  readonly severity: "低" | "中" | "高";
  readonly detail: string;
}

export interface ContinuityReport {
  readonly score: number;
  readonly level: ContinuityLevel;
  readonly status: ContinuityStatus;
  readonly summary: string;
  readonly strengths: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<ContinuityIssue>;
  readonly opening_check: unknown;
  readonly repeated_info_check: unknown;
  readonly current_goal: string;
  readonly goal_clear: "YES" | "NO";
  readonly foreshadowing_continuity: unknown;
  readonly crisis_progress: string;
  readonly fix_suggestions: ReadonlyArray<string>;
  readonly rewrite_mode: ContinuityRewriteMode;
  readonly rewrite_prompt: string;
  readonly fix_attempt: number;
  readonly max_fix_attempts: number;
  readonly final_status: ContinuityFinalStatus;
}

export interface RunContinuityCheckInput {
  readonly client: LLMClient;
  readonly model: string;
  readonly prevChapter: string;
  readonly currentChapter: string;
  readonly chapterIndex: number;
  readonly chapterTitle?: string;
  readonly reportJsonPath?: string;
  readonly reportMarkdownPath?: string;
  readonly fixAttempt?: number;
  readonly maxFixAttempts?: number;
}

export interface RunContinuityFixInput {
  readonly client: LLMClient;
  readonly model: string;
  readonly reportJsonPath: string;
  readonly outputPath: string;
  readonly chapterTitle?: string;
}

export async function runChapterContinuityCheck(
  input: RunContinuityCheckInput,
): Promise<ContinuityReport> {
  const prompt = buildContinuityCheckPrompt(input);
  const response = await chatCompletion(input.client, input.model, [
    {
      role: "system",
      content: [
        "你是网文连载章节连续性检测器。",
        "你必须只输出合法 JSON，不要输出 Markdown，不要输出解释。",
        "所有字段必须符合用户给定 schema。",
      ].join("\n"),
    },
    { role: "user", content: prompt },
  ], { temperature: 0.1, maxTokens: 4096 });

  const parsed = parseContinuityReport(response.content);
  const guarded = applyContinuityGuardrails(parsed, input.prevChapter, input.currentChapter, {
    fixAttempt: input.fixAttempt ?? 0,
    maxFixAttempts: input.maxFixAttempts ?? 2,
  });

  if (input.reportJsonPath) {
    await mkdir(dirname(input.reportJsonPath), { recursive: true });
    await writeFile(input.reportJsonPath, `${JSON.stringify(guarded, null, 2)}\n`, "utf-8");
  }
  if (input.reportMarkdownPath) {
    await mkdir(dirname(input.reportMarkdownPath), { recursive: true });
    await writeFile(input.reportMarkdownPath, renderContinuityMarkdown(guarded, input.chapterIndex, input.chapterTitle), "utf-8");
  }

  return guarded;
}

export async function runLocalChapterContinuityCheck(input: {
  readonly prevChapter: string;
  readonly currentChapter: string;
  readonly chapterIndex: number;
  readonly chapterTitle?: string;
  readonly reportJsonPath?: string;
  readonly reportMarkdownPath?: string;
  readonly fixAttempt?: number;
  readonly maxFixAttempts?: number;
}): Promise<ContinuityReport> {
  const report = applyContinuityGuardrails(
    buildLocalContinuityReport(input.prevChapter, input.currentChapter),
    input.prevChapter,
    input.currentChapter,
    {
      fixAttempt: input.fixAttempt ?? 0,
      maxFixAttempts: input.maxFixAttempts ?? 2,
    },
  );
  if (input.reportJsonPath) {
    await mkdir(dirname(input.reportJsonPath), { recursive: true });
    await writeFile(input.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }
  if (input.reportMarkdownPath) {
    await mkdir(dirname(input.reportMarkdownPath), { recursive: true });
    await writeFile(input.reportMarkdownPath, renderContinuityMarkdown(report, input.chapterIndex, input.chapterTitle), "utf-8");
  }
  return report;
}

export async function runChapterContinuityFix(
  input: RunContinuityFixInput,
): Promise<string> {
  const raw = await readFile(input.reportJsonPath, "utf-8");
  const report = JSON.parse(raw) as ContinuityReport;
  if (report.rewrite_mode === "none" || report.status === "PASS") {
    return "";
  }
  if (!report.rewrite_prompt?.trim()) {
    throw new Error(`Continuity report has empty rewrite_prompt: ${input.reportJsonPath}`);
  }

  const response = await chatCompletion(input.client, input.model, [
    {
      role: "system",
      content: [
        "你是网文连载章节连续性修复编辑。",
        "只输出修复后的完整章节正文。",
        "不要输出说明、报告、JSON、Markdown 代码块。",
      ].join("\n"),
    },
    { role: "user", content: report.rewrite_prompt },
  ], { temperature: 0.35, maxTokens: 8192 });

  const fixed = stripCodeFence(response.content).trim();
  if (!fixed) {
    throw new Error("Continuity fix returned empty chapter content");
  }
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, `${fixed.trimEnd()}\n`, "utf-8");
  return fixed;
}

export function renderContinuityMarkdown(
  report: ContinuityReport,
  chapterIndex: number,
  chapterTitle = "",
): string {
  const issueLines = report.issues.length
    ? report.issues.map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n")
    : "- 无";
  const strengths = report.strengths.length
    ? report.strengths.map((item) => `- ${item}`).join("\n")
    : "- 无";
  const suggestions = report.fix_suggestions.length
    ? report.fix_suggestions.map((item) => `- ${item}`).join("\n")
    : "- 无";

  return `# 连续性检测报告

- 章节：${chapterIndex}${chapterTitle ? ` ${chapterTitle}` : ""}
- 分数：${report.score}
- 等级：${report.level}
- 状态：${report.status}
- 修复模式：${report.rewrite_mode}
- 修复次数：${report.fix_attempt}/${report.max_fix_attempts}
- 最终状态：${report.final_status}
- 当前目标：${report.current_goal || "未识别"}
- 目标清晰：${report.goal_clear}
- 危机推进：${report.crisis_progress}

## 摘要

${report.summary}

## 优点

${strengths}

## 问题

${issueLines}

## 开头承接

\`\`\`json
${JSON.stringify(report.opening_check, null, 2)}
\`\`\`

## 重复信息

\`\`\`json
${JSON.stringify(report.repeated_info_check, null, 2)}
\`\`\`

## 伏笔连续性

\`\`\`json
${JSON.stringify(report.foreshadowing_continuity, null, 2)}
\`\`\`

## 修复建议

${suggestions}
`;
}

export function resolveContinuityStatus(score: number): ContinuityStatus {
  if (score >= 85) return "PASS";
  if (score >= 70) return "NEED_FIX";
  return "REWRITE_REQUIRED";
}

export function resolveContinuityLevel(score: number): ContinuityLevel {
  if (score >= 85) return "优秀";
  if (score >= 70) return "可用";
  return "不合格";
}

export function resolveContinuityRewriteMode(score: number): ContinuityRewriteMode {
  if (score >= 85) return "none";
  if (score >= 70) return "light_fix";
  return "full_rewrite";
}

export function resolveFinalStatus(
  score: number,
  attempt: number,
  maxFixAttempts: number,
): ContinuityFinalStatus {
  if (score >= 85) return "PASS";
  if (attempt >= maxFixAttempts) return "MANUAL_REVIEW";
  return "RETRY";
}

export function buildContinuityRewritePrompt(params: {
  readonly prevChapter: string;
  readonly currentChapter: string;
  readonly issues: ReadonlyArray<ContinuityIssue> | string;
  readonly mode: ContinuityRewriteMode;
}): string {
  if (params.mode === "none") return "";
  const issues = typeof params.issues === "string"
    ? params.issues
    : params.issues.map((issue) => `[${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n");
  return params.mode === "light_fix"
    ? buildLightFixRewritePrompt(params.prevChapter, params.currentChapter, issues)
    : buildFullRewritePrompt(params.prevChapter, params.currentChapter, issues);
}

function buildLightFixRewritePrompt(prevChapter: string, currentChapter: string, issues: string): string {
  return `你正在修复一章“轻微连续性不足”的番茄网文连载章节。

请根据以下内容，对 current_chapter 做轻量修复：

【上一章全文】
${prevChapter}

【当前章节原文】
${currentChapter}

【检测问题】
${issues || "无明确问题，但检测分数低于发布阈值。"}

【修复目标】
1. 开头必须更直接承接上一章最后画面、声音、动作或危机。
2. 删除或压缩重复解释，包括修炼体系、真名机制、战力规则、上一章刚讲过的信息。
3. 明确主角当前行动目标，并让目标在本章中持续存在。
4. 承接上一章关键伏笔，至少推进一个伏笔。
5. 危机必须比上一章更近、更具体、更危险。
6. 保留当前章节主线事件。
7. 尽量保留原文中可用的动作、对白、场景与伏笔。
8. 尽量保留原文 70% 以上内容。
9. 输出完整修复后的章节正文。

【禁止】
- 禁止改主线
- 禁止新增无关人物
- 禁止新增重大设定
- 禁止改变人物关系
- 禁止改变战力层级
- 禁止大幅重写成另一章
- 禁止输出解释说明`;
}

function buildFullRewritePrompt(prevChapter: string, currentChapter: string, issues: string): string {
  return `你正在重写一章“严重连续性不足”的番茄网文连载章节。

当前章节不能直接发布，必须完整重写。

请根据以下内容重新生成 current_chapter：

【上一章全文】
${prevChapter}

【当前章节原文，仅作为剧情素材参考】
current_chapter 仅作为剧情素材参考。
${currentChapter}

【检测问题】
${issues || "无明确问题，但检测分数低于发布阈值。"}

【重写目标】
1. 本章开头必须直接接住上一章最后一句、最后动作、最后危机或最后钩子。
2. 前三段必须进入危机，不允许重新铺世界观。
3. 主角必须有明确行动目标，并且目标贯穿全章。
4. 必须承接上一章关键伏笔，至少推进一个关键伏笔。
5. 必须让危机升级，不能停留在原地描写。
6. 必须保留原章节的核心事件、关键设定、人物状态和结尾方向。
7. 可以重排段落结构，可以重写动作链和对白。
8. 结尾必须形成新的升级钩子。
9. 输出完整重写后的章节正文。
10. 保持番茄网文风格：短段落、强动作、强钩子、少说明、多冲突。

【禁止】
- 禁止跳过上一章结尾
- 禁止另起新剧情
- 禁止新增无关人物
- 禁止新增重大世界观
- 禁止改变主角战力层级
- 禁止改变人物关系
- 禁止改变既有伏笔含义
- 禁止输出解释说明`;
}

function buildContinuityCheckPrompt(input: RunContinuityCheckInput): string {
  return `【任务】
检测当前章节是否与上一章节“连续”，并在必要时给出可直接用于自动重写的修复指令。

【输入】
chapter_index: ${input.chapterIndex}
chapter_title: ${input.chapterTitle ?? ""}

【prev_chapter】
${input.prevChapter}

【current_chapter】
${input.currentChapter}

【检测维度】
1. 开头承接检测（权重：30%）：判断当前章节开头是否直接承接上一章结尾，输出 PASS/FAIL 和问题说明。
2. 重复信息检测（权重：20%）：检查修炼体系、真名机制、战力规则、已出现设定、上一章刚讲过的信息，输出重复段落列表和严重程度。
3. 行动目标检测（权重：20%）：回答“主角现在要干什么？”，输出目标描述和是否清晰 YES/NO。
4. 伏笔连续性检测（权重：15%）：检查上一章结尾危机、新增线索、人物状态、伤势、道具、位置、敌人是否一致。
5. 危机推进检测（权重：15%）：判断危机是否更近、信息是否更具体、目标是否被阻碍，输出“升级 / 停滞 / 回退”。

【评分规则】
score 为 0 到 100 的数字。
score >= 85：level=优秀，status=PASS，rewrite_mode=none，rewrite_prompt 必须为空字符串。
70 <= score < 85：level=可用，status=NEED_FIX，rewrite_mode=light_fix，rewrite_prompt 必须非空。
score < 70：level=不合格，status=REWRITE_REQUIRED，rewrite_mode=full_rewrite，rewrite_prompt 必须非空。

【防虚高校验】
如果 score >= 90，但当前章字数 < 上一章字数 * 0.6，强制降级为 NEED_FIX，并增加 issue：“当前章长度显著低于上一章，可能存在短而空的假连续问题”。
如果 score >= 90，但 current_goal 为空，强制降级为 NEED_FIX。
如果 score >= 90，但 crisis_progress 不是“升级”，强制降级为 NEED_FIX。

【输出格式】
只输出可解析 JSON，字段必须完整：
{
  "score": 82,
  "level": "可用",
  "status": "NEED_FIX",
  "summary": "当前章节基本承接上一章，但开头仍有少量重复解释，危机推进不够强。",
  "strengths": ["承接了上一章铁器拖拽声"],
  "issues": [{"type": "重复解释", "severity": "中", "detail": "当前章节再次解释真名剥离机制。"}],
  "opening_check": {"result": "PASS", "detail": "..."},
  "repeated_info_check": {"severity": "低", "repeated_paragraphs": [], "detail": "..."},
  "current_goal": "楚夜带云岚避开铁器威胁，并寻找暗河通道。",
  "goal_clear": "YES",
  "foreshadowing_continuity": {"已承接元素": [], "被忽略元素": []},
  "crisis_progress": "升级",
  "fix_suggestions": [],
  "rewrite_mode": "none",
  "rewrite_prompt": "",
  "fix_attempt": 0,
  "max_fix_attempts": 2,
  "final_status": "PASS"
}`;
}

function buildLocalContinuityReport(prevChapter: string, currentChapter: string): ContinuityReport {
  const prevTail = prevChapter.slice(-900);
  const currentHead = currentChapter.slice(0, 900);
  const currentAll = currentChapter;

  const issues: ContinuityIssue[] = [];
  const strengths: string[] = [];
  let score = 45;

  const tailSignals = keywordMatches(prevTail, [
    "拖拽", "铁器", "越来越近", "短刃", "跟上", "黑暗", "脊椎", "图纹", "云岚", "后颈", "暗河",
  ]);
  const headSignals = keywordMatches(currentHead, [
    "拖拽", "铁器", "更近", "短刃", "云岚", "后颈", "脊骨", "图纹", "黑曜石", "暗河",
  ]);
  const sharedSignals = tailSignals.filter((item) => headSignals.includes(item));
  const openingPass = sharedSignals.length >= 2 || (/拖拽|铁器/.test(prevTail) && /拖拽|铁器|更近/.test(currentHead));

  if (openingPass) {
    score += 25;
    strengths.push("开头直接承接上一章结尾的声音、危机或动作。");
  } else {
    issues.push({
      type: "开头承接",
      severity: "高",
      detail: "当前章开头没有明显延续上一章最后动作、声音或危机。",
    });
  }

  const repeatedPatterns = [
    "炼体", "聚气", "筑基", "化灵", "神府", "战力规则", "境界压制", "天地间存在葬渊之力", "真名机制",
  ].filter((pattern) => currentAll.includes(pattern));
  if (repeatedPatterns.length) {
    score -= 12;
    issues.push({
      type: "重复解释",
      severity: repeatedPatterns.length >= 3 ? "高" : "中",
      detail: `疑似重复解释：${repeatedPatterns.join("、")}`,
    });
  } else {
    score += 12;
    strengths.push("未发现修炼体系、真名机制、战力规则等明显重复说明。");
  }

  const goal = inferLocalGoal(currentAll);
  if (goal) {
    score += 12;
    strengths.push("主角行动目标明确，并在章节中持续执行。");
  } else {
    issues.push({
      type: "行动目标",
      severity: "高",
      detail: "未识别到明确的主角即时行动目标。",
    });
  }

  const carried = [
    ["铁器拖拽声逼近", /拖拽|铁器/.test(prevTail) && /拖拽|铁器/.test(currentAll)],
    ["脊骨图纹", /脊椎|脊骨|图纹/.test(prevTail) && /脊椎|脊骨|图纹/.test(currentAll)],
    ["云岚后颈疤痕或血脉共鸣", /后颈|疤痕|云岚/.test(prevTail) && /后颈|疤痕|血脉|云岚/.test(currentAll)],
    ["楚夜右臂废损", /右臂.*废|右臂/.test(prevTail) && /右臂.*废|右臂/.test(currentAll)],
    ["暗河位置", /暗河/.test(prevTail) && /暗河/.test(currentAll)],
  ].filter(([, ok]) => ok).map(([name]) => String(name));

  if (carried.length >= 3) {
    score += 10;
    strengths.push("上一章关键危机、伏笔、伤势和位置得到承接。");
  } else {
    issues.push({
      type: "伏笔连续性",
      severity: "中",
      detail: "上一章关键元素承接不足。",
    });
  }

  const crisisProgress = inferLocalCrisisProgress(currentAll);
  if (crisisProgress === "升级") {
    score += 8;
    strengths.push("危机从声音逼近升级为实体威胁或新钩子。");
  } else {
    issues.push({
      type: "危机推进",
      severity: "中",
      detail: "危机没有明显升级，可能停留在原地描写。",
    });
  }

  const finalScore = clampScore(score);
  const status = resolveContinuityStatus(finalScore);
  return {
    score: finalScore,
    level: resolveContinuityLevel(finalScore),
    status,
    summary: status === "PASS"
      ? "当前章节与上一章形成连续叙事，开头承接明确，目标清晰，伏笔和危机均有推进。"
      : "当前章节存在连续性风险，需要按报告修复后再发布。",
    strengths,
    issues,
    opening_check: {
      result: openingPass ? "PASS" : "FAIL",
      detail: openingPass
        ? "当前章开头与上一章结尾共享关键声音、动作或危机信号。"
        : "未在开头识别到上一章结尾关键危机的直接延续。",
    },
    repeated_info_check: {
      severity: repeatedPatterns.length ? (repeatedPatterns.length >= 3 ? "高" : "中") : "低",
      repeated_paragraphs: repeatedPatterns,
      detail: repeatedPatterns.length ? "检测到疑似重复设定说明。" : "未发现明显重复设定说明。",
    },
    current_goal: goal,
    goal_clear: goal ? "YES" : "NO",
    foreshadowing_continuity: {
      已承接元素: carried,
      被忽略元素: [],
    },
    crisis_progress: crisisProgress,
    fix_suggestions: issues.map((issue) => issue.detail),
    rewrite_mode: "none",
    rewrite_prompt: "",
    fix_attempt: 0,
    max_fix_attempts: 2,
    final_status: "MANUAL_REVIEW",
  };
}

function keywordMatches(text: string, keywords: ReadonlyArray<string>): string[] {
  return keywords.filter((keyword) => text.includes(keyword));
}

function inferLocalGoal(text: string): string {
  if (/带.*云岚.*(?:避开|绕|走|下去|拖进|进入)|走水边|打开.*通道|拉.*门/.test(text)) {
    return "楚夜带云岚避开铁器威胁，借脊骨图纹和暗河通道脱离正面冲突。";
  }
  if (/逃|撤|躲|避战|绕过去/.test(text)) return "主角试图避开当前威胁并寻找活路。";
  if (/探查|查清|验证/.test(text)) return "主角试图探查并验证当前线索。";
  return "";
}

function inferLocalCrisisProgress(text: string): string {
  if (/更多.*铁器|不是一具|现身|铁钩|铜铃|回应|砸出|主人终于露出/.test(text)) return "升级";
  if (/逼近|更近|靠近|锁定/.test(text)) return "升级";
  if (/退去|远去|平息/.test(text)) return "回退";
  return "停滞";
}

function parseContinuityReport(raw: string): ContinuityReport {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as Partial<ContinuityReport>;
  const score = clampScore(Number(parsed.score));
  const status = isContinuityStatus(parsed.status) ? parsed.status : resolveContinuityStatus(score);
  const rewriteMode = isContinuityRewriteMode(parsed.rewrite_mode)
    ? parsed.rewrite_mode
    : resolveContinuityRewriteMode(score);
  return {
    score,
    level: isContinuityLevel(parsed.level) ? parsed.level : resolveContinuityLevel(score),
    status,
    summary: stringValue(parsed.summary),
    strengths: stringArray(parsed.strengths),
    issues: normalizeIssues(parsed.issues),
    opening_check: parsed.opening_check ?? {},
    repeated_info_check: parsed.repeated_info_check ?? {},
    current_goal: stringValue(parsed.current_goal),
    goal_clear: parsed.goal_clear === "YES" ? "YES" : "NO",
    foreshadowing_continuity: parsed.foreshadowing_continuity ?? {},
    crisis_progress: stringValue(parsed.crisis_progress),
    fix_suggestions: stringArray(parsed.fix_suggestions),
    rewrite_mode: rewriteMode,
    rewrite_prompt: stringValue(parsed.rewrite_prompt),
    fix_attempt: normalizeNonNegativeInt(parsed.fix_attempt, 0),
    max_fix_attempts: normalizePositiveInt(parsed.max_fix_attempts, 2),
    final_status: isContinuityFinalStatus(parsed.final_status)
      ? parsed.final_status
      : resolveFinalStatus(score, normalizeNonNegativeInt(parsed.fix_attempt, 0), normalizePositiveInt(parsed.max_fix_attempts, 2)),
  };
}

function applyContinuityGuardrails(
  report: ContinuityReport,
  prevChapter: string,
  currentChapter: string,
  attempts?: { readonly fixAttempt: number; readonly maxFixAttempts: number },
): ContinuityReport {
  let next = normalizeStatusAndPrompt(report, prevChapter, currentChapter, attempts);
  const issues = [...next.issues];
  let score = next.score;
  let forced = false;

  if (score >= 90 && countChars(currentChapter) < countChars(prevChapter) * 0.6) {
    forced = true;
    score = Math.min(score, 84);
    issues.push({
      type: "防虚高校验",
      severity: "中",
      detail: "当前章长度显著低于上一章，可能存在短而空的假连续问题",
    });
  }
  if (score >= 90 && !next.current_goal.trim()) {
    forced = true;
    score = Math.min(score, 84);
    issues.push({
      type: "防虚高校验",
      severity: "高",
      detail: "current_goal 为空，无法证明主角行动目标清晰。",
    });
  }
  if (score >= 90 && next.crisis_progress.trim() !== "升级") {
    forced = true;
    score = Math.min(score, 84);
    issues.push({
      type: "防虚高校验",
      severity: "中",
      detail: "crisis_progress 不是“升级”，高分连续性存在虚高风险。",
    });
  }

  if (forced) {
    next = { ...next, score, issues };
  }
  return normalizeStatusAndPrompt(next, prevChapter, currentChapter, attempts);
}

function normalizeStatusAndPrompt(
  report: ContinuityReport,
  prevChapter: string,
  currentChapter: string,
  attempts?: { readonly fixAttempt: number; readonly maxFixAttempts: number },
): ContinuityReport {
  const score = clampScore(report.score);
  const status = resolveContinuityStatus(score);
  const level = resolveContinuityLevel(score);
  const rewriteMode = resolveContinuityRewriteMode(score);
  const maxFixAttempts = normalizePositiveInt(attempts?.maxFixAttempts ?? report.max_fix_attempts, 2);
  const fixAttempt = Math.min(normalizeNonNegativeInt(attempts?.fixAttempt ?? report.fix_attempt, 0), maxFixAttempts);
  const finalStatus = resolveFinalStatus(score, fixAttempt, maxFixAttempts);
  const rewritePrompt = rewriteMode === "none"
    ? ""
    : buildContinuityRewritePrompt({
        prevChapter,
        currentChapter,
        issues: report.issues,
        mode: rewriteMode,
      });
  return {
    ...report,
    score,
    status,
    level,
    rewrite_mode: rewriteMode,
    rewrite_prompt: rewritePrompt,
    fix_attempt: fixAttempt,
    max_fix_attempts: maxFixAttempts,
    final_status: finalStatus,
  };
}

function extractJsonObject(raw: string): string {
  const stripped = stripCodeFence(raw).trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`Continuity checker did not return JSON: ${raw.slice(0, 200)}`);
  }
  return stripped.slice(start, end + 1);
}

function stripCodeFence(raw: string): string {
  return raw
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeIssues(value: unknown): ContinuityIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const severity = source.severity === "高" || source.severity === "中" || source.severity === "低"
      ? source.severity
      : "中";
    return {
      type: stringValue(source.type || "连续性问题"),
      severity,
      detail: stringValue(source.detail || item),
    };
  });
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

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function countChars(text: string): number {
  return [...text.replace(/\s/g, "")].length;
}

function isContinuityStatus(value: unknown): value is ContinuityStatus {
  return value === "PASS" || value === "NEED_FIX" || value === "REWRITE_REQUIRED" || value === "MANUAL_REVIEW";
}

function isContinuityLevel(value: unknown): value is ContinuityLevel {
  return value === "优秀" || value === "可用" || value === "不合格";
}

function isContinuityRewriteMode(value: unknown): value is ContinuityRewriteMode {
  return value === "none" || value === "light_fix" || value === "full_rewrite";
}

function isContinuityFinalStatus(value: unknown): value is ContinuityFinalStatus {
  return value === "PASS" || value === "MANUAL_REVIEW" || value === "RETRY";
}

export function chapterNumberPrefix(chapterNumber: number): string {
  return String(chapterNumber).padStart(4, "0");
}

export function safeFixedChapterFilename(chapterNumber: number, sourceFile: string, chapterTitle = ""): string {
  const baseTitle = chapterTitle
    || basename(sourceFile).replace(/^0*\d+(?:[_\-.])?/, "").replace(/\.(md|txt)$/i, "")
    || "修复章节";
  const safe = baseTitle
    .replace(/^第\s*\d+\s*章\s*/, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 40)
    || "修复章节";
  return `${chapterNumberPrefix(chapterNumber)}_${safe}.md`;
}
