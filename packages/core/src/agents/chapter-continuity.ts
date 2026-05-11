import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { chatCompletion, type LLMClient } from "../llm/provider.js";

export type ContinuityStatus = "PASS" | "NEED_FIX" | "REWRITE_REQUIRED" | "MANUAL_REVIEW";
export type ContinuityLevel = "优秀" | "可用" | "不合格";
export type ContinuityRewriteMode = "none" | "light_fix" | "full_rewrite";
export type ContinuityRewriteStrategy = "salvage_rewrite";
export type ContinuityFinalStatus = "PASS" | "MANUAL_REVIEW" | "DROP" | "RETRY";
export type ContinuityLengthStatus = "PASS" | "TOO_SHORT";
export type ContinuityPublishReadiness = "PASS" | "BLOCKED";

export interface ContinuityIssue {
  readonly type: string;
  readonly severity: "低" | "中" | "高";
  readonly detail: string;
}

export interface ContinuityPublishBlocker {
  readonly type: string;
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
  readonly rewrite_strategy?: ContinuityRewriteStrategy;
  readonly rewrite_prompt: string;
  readonly manual_fix_prompt: string;
  readonly used_file?: string;
  readonly decision_source?: string;
  readonly body_source?: string;
  readonly stale_reports_ignored?: ReadonlyArray<string>;
  readonly word_count: number;
  readonly min_chapter_words: number;
  readonly length_status: ContinuityLengthStatus;
  readonly publish_readiness: ContinuityPublishReadiness;
  readonly publish_blockers: ReadonlyArray<ContinuityPublishBlocker>;
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
  readonly minChapterWords?: number;
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
  ], { temperature: 0.1, maxTokens: 4096, stage: "continuity" });

  const parsed = parseContinuityReport(response.content);
  const guarded = applyContinuityGuardrails(parsed, input.prevChapter, input.currentChapter, {
    fixAttempt: input.fixAttempt ?? 0,
    maxFixAttempts: input.maxFixAttempts ?? 2,
    minChapterWords: input.minChapterWords ?? 1000,
  });

  if (input.reportJsonPath) {
    await mkdir(dirname(input.reportJsonPath), { recursive: true });
    await writeFile(input.reportJsonPath, `${JSON.stringify(guarded, null, 2)}\n`, "utf-8");
  }
  if (input.reportMarkdownPath) {
    await mkdir(dirname(input.reportMarkdownPath), { recursive: true });
    await writeFile(input.reportMarkdownPath, renderContinuityMarkdown(guarded, input.chapterIndex, input.chapterTitle), "utf-8");
    await writeManualFixFileIfNeeded(guarded, input.reportMarkdownPath);
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
  readonly minChapterWords?: number;
}): Promise<ContinuityReport> {
  const report = applyContinuityGuardrails(
    buildLocalContinuityReport(input.prevChapter, input.currentChapter),
    input.prevChapter,
    input.currentChapter,
    {
      fixAttempt: input.fixAttempt ?? 0,
      maxFixAttempts: input.maxFixAttempts ?? 2,
      minChapterWords: input.minChapterWords ?? 1000,
    },
  );
  if (input.reportJsonPath) {
    await mkdir(dirname(input.reportJsonPath), { recursive: true });
    await writeFile(input.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }
  if (input.reportMarkdownPath) {
    await mkdir(dirname(input.reportMarkdownPath), { recursive: true });
    await writeFile(input.reportMarkdownPath, renderContinuityMarkdown(report, input.chapterIndex, input.chapterTitle), "utf-8");
    await writeManualFixFileIfNeeded(report, input.reportMarkdownPath);
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
  ], { temperature: 0.35, maxTokens: 8192, stage: "continuity" });

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
${report.rewrite_strategy ? `- 重写策略：${report.rewrite_strategy}\n` : ""}
- 修复次数：${report.fix_attempt}/${report.max_fix_attempts}
- 最终状态：${report.final_status}
${report.decision_source ? `- 裁决来源：${report.decision_source}\n` : ""}${report.used_file ? `- 使用文件：${report.used_file}\n` : ""}${report.stale_reports_ignored?.length ? `- 已忽略旧报告：${report.stale_reports_ignored.join("、")}\n` : ""}
- 有效字数：${report.word_count}/${report.min_chapter_words}
- 字数状态：${report.length_status}
- 发布就绪：${report.publish_readiness}
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
${report.manual_fix_prompt ? `\n## 人工修复建议\n\n${report.manual_fix_prompt}\n` : ""}
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
  readonly lengthGate?: NovelLengthGate;
}): string {
  if (params.mode === "none") return "";
  const issues = typeof params.issues === "string"
    ? params.issues
    : params.issues.map((issue) => `[${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n");
  const lengthRequirement = buildLengthExpansionRequirement(params.lengthGate);
  return params.mode === "light_fix"
    ? buildLightFixRewritePrompt(params.prevChapter, params.currentChapter, issues, lengthRequirement)
    : buildFullRewritePrompt(params.prevChapter, params.currentChapter, issues, lengthRequirement);
}

interface NovelLengthGate {
  readonly wordCount: number;
  readonly minChapterWords: number;
  readonly lengthStatus: ContinuityLengthStatus;
}

function buildLengthExpansionRequirement(lengthGate?: NovelLengthGate): string {
  if (!lengthGate || lengthGate.lengthStatus !== "TOO_SHORT") return "";
  return `\n\n【字数扩写要求】\n当前正文有效字数：${lengthGate.wordCount}\n最低要求：${lengthGate.minChapterWords}\n\n请在不改变主线、不注水、不重复解释的前提下，将章节扩写到至少 ${lengthGate.minChapterWords} 字。\n\n扩写方向：\n1. 增加即时动作链\n2. 增加角色反应\n3. 增加危机压迫\n4. 增加对抗过程\n5. 增加选择与代价\n6. 增加结尾钩子铺垫\n\n禁止：\n- 禁止水字数\n- 禁止重复设定\n- 禁止大段说明\n- 禁止无意义心理独白`;
}

function buildLightFixRewritePrompt(prevChapter: string, currentChapter: string, issues: string, lengthRequirement = ""): string {
  return `你正在修复一章“轻微连续性不足”的番茄网文连载章节。

请根据以下内容，对 current_chapter 做轻量修复：

【上一章全文】
${prevChapter}

【当前章节原文】
${currentChapter}

【检测问题】
${issues || "无明确问题，但检测分数低于发布阈值。"}
${lengthRequirement}

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

function buildFullRewritePrompt(prevChapter: string, currentChapter: string, issues: string, lengthRequirement = ""): string {
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
${lengthRequirement}

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
min_chapter_words: ${input.minChapterWords ?? 1000}

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
score >= 85 且正文有效字数 >= min_chapter_words：level=优秀，status=PASS，rewrite_mode=none，rewrite_prompt 必须为空字符串。
score >= 85 但正文有效字数 < min_chapter_words：status=NEED_FIX，rewrite_mode=light_fix，final_status=RETRY，并增加“章节字数不足，需扩写到至少 min_chapter_words 字”。
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
      "manual_fix_prompt": "",
      "word_count": 1800,
      "min_chapter_words": ${input.minChapterWords ?? 1000},
      "length_status": "PASS",
      "publish_readiness": "PASS",
      "publish_blockers": [],
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
    manual_fix_prompt: "",
    word_count: 0,
    min_chapter_words: 1000,
    length_status: "PASS",
    publish_readiness: "BLOCKED",
    publish_blockers: [],
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
    rewrite_strategy: parsed.rewrite_strategy === "salvage_rewrite" ? "salvage_rewrite" : undefined,
    rewrite_prompt: stringValue(parsed.rewrite_prompt),
    manual_fix_prompt: stringValue(parsed.manual_fix_prompt),
    used_file: stringValue(parsed.used_file) || undefined,
    decision_source: stringValue(parsed.decision_source) || undefined,
    body_source: stringValue(parsed.body_source) || undefined,
    stale_reports_ignored: stringArray(parsed.stale_reports_ignored),
    word_count: normalizeNonNegativeInt(parsed.word_count, 0),
    min_chapter_words: normalizePositiveInt(parsed.min_chapter_words, 1000),
    length_status: parsed.length_status === "TOO_SHORT" ? "TOO_SHORT" : "PASS",
    publish_readiness: parsed.publish_readiness === "BLOCKED" ? "BLOCKED" : "PASS",
    publish_blockers: normalizePublishBlockers(parsed.publish_blockers),
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
  attempts?: { readonly fixAttempt: number; readonly maxFixAttempts: number; readonly minChapterWords?: number },
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
  attempts?: { readonly fixAttempt: number; readonly maxFixAttempts: number; readonly minChapterWords?: number },
): ContinuityReport {
  const score = clampScore(report.score);
  const minChapterWords = normalizePositiveInt(attempts?.minChapterWords ?? report.min_chapter_words, 1000);
  const lengthGate = countChineseNovelWords(currentChapter, minChapterWords);
  const tooShort = lengthGate.length_status === "TOO_SHORT";
  const status = tooShort && score >= 85 ? "NEED_FIX" : resolveContinuityStatus(score);
  const level = resolveContinuityLevel(score);
  const rewriteMode = tooShort && score >= 85 ? "light_fix" : resolveContinuityRewriteMode(score);
  const maxFixAttempts = normalizePositiveInt(attempts?.maxFixAttempts ?? report.max_fix_attempts, 2);
  const fixAttempt = Math.min(normalizeNonNegativeInt(attempts?.fixAttempt ?? report.fix_attempt, 0), maxFixAttempts);
  const finalStatus = report.final_status === "DROP"
    ? "DROP"
    : tooShort && fixAttempt >= maxFixAttempts
      ? "MANUAL_REVIEW"
      : tooShort
        ? "RETRY"
        : resolveFinalStatus(score, fixAttempt, maxFixAttempts);
  const lengthIssue: ContinuityIssue = {
    type: "章节字数不足",
    severity: "高",
    detail: `正文有效字数 ${lengthGate.word_count}，低于最低要求 ${lengthGate.min_chapter_words}，需扩写到至少 ${lengthGate.min_chapter_words} 字。`,
  };
  const issues = tooShort && !report.issues.some((issue) => issue.type === lengthIssue.type)
    ? [...report.issues, lengthIssue]
    : report.issues;
  const publishBlockers: ContinuityPublishBlocker[] = [
    ...report.publish_blockers.filter((blocker) => blocker.type !== "TOO_SHORT"),
    ...(tooShort ? [{ type: "TOO_SHORT", detail: `正文有效字数 ${lengthGate.word_count}，低于最低要求 ${lengthGate.min_chapter_words}` }] : []),
  ];
  const publishReadiness: ContinuityPublishReadiness = score >= 85 && !tooShort && report.final_status !== "DROP" ? "PASS" : "BLOCKED";
  const rewritePrompt = rewriteMode === "none"
    ? ""
    : buildContinuityRewritePrompt({
        prevChapter,
        currentChapter,
        issues,
        mode: rewriteMode,
        lengthGate: {
          wordCount: lengthGate.word_count,
          minChapterWords: lengthGate.min_chapter_words,
          lengthStatus: lengthGate.length_status,
        },
      });
  const manual_fix_prompt = finalStatus === "DROP" || finalStatus === "MANUAL_REVIEW"
    ? buildManualFixPrompt({
        prevChapter,
        currentChapter,
        report: {
          ...report,
          score,
          status,
          level,
          issues,
          rewrite_mode: rewriteMode,
          rewrite_prompt: rewritePrompt,
          final_status: finalStatus,
          word_count: lengthGate.word_count,
          min_chapter_words: lengthGate.min_chapter_words,
          length_status: lengthGate.length_status,
          publish_readiness: publishReadiness,
          publish_blockers: publishBlockers,
        },
      })
    : "";
  return {
    ...report,
    score,
    status,
    level,
    issues,
    rewrite_mode: rewriteMode,
    rewrite_prompt: rewritePrompt,
    manual_fix_prompt,
    word_count: lengthGate.word_count,
    min_chapter_words: lengthGate.min_chapter_words,
    length_status: lengthGate.length_status,
    publish_readiness: publishReadiness,
    publish_blockers: publishBlockers,
    fix_attempt: fixAttempt,
    max_fix_attempts: maxFixAttempts,
    final_status: finalStatus,
  };
}

export function buildManualFixPrompt(params: {
  readonly prevChapter: string;
  readonly currentChapter: string;
  readonly report: ContinuityReport;
}): string {
  const prevHook = extractContinuityHook(params.prevChapter);
  const currentOpening = firstNonEmptyParagraphs(params.currentChapter, 2).join("\n\n") || "当前章开头缺失或无法识别。";
  const ignoredHooks = extractIgnoredHooks(params.report.foreshadowing_continuity);
  const issueSummary = buildManualIssueSummary(params.report, prevHook);
  const openingProblem = openingProblemText(params.report, currentOpening, prevHook);
  const currentGoal = params.report.current_goal.trim().replace(/[。！？.!?]+$/u, "");
  const goalProblem = params.report.goal_clear === "YES" && params.report.current_goal.trim()
    ? `当前目标已有雏形：${currentGoal}，但需要在开头后持续落到动作上。`
    : "主角当前要做什么不够明确，读者不知道他是在逃、探、破局，还是等待事件发生。";
  const crisisProblem = params.report.crisis_progress === "升级"
    ? "危机已有推进，但压迫要更具体，最好让威胁在三段内逼近或出手。"
    : `危机推进为“${params.report.crisis_progress || "未识别"}”，目前更像停留在观察或说明，没有形成新的阻碍。`;
  const hookToAdvance = ignoredHooks[0] || inferHookToAdvance(prevHook, params.report);
  const example = buildOpeningRewriteExample(prevHook, hookToAdvance, currentGoal);

  return `# 第${extractChapterNumber(params.currentChapter) || ""}章人工修复建议

## 问题总结
${issueSummary.map((item) => `- ${item}`).join("\n")}

## 必须修改

### 1. 开头
当前问题：
${openingProblem}

修改方式：
直接承接上一章尾钩“${prevHook || "上一章最后的声音、动作或危机"}”。第一段写威胁更近，第二段写主角/同伴即时反应，第三段进入选择或冲突。

### 2. 主角目标
当前问题：
${goalProblem}

修改方式：
把目标写成可执行动作，例如“避开正面冲突，找到通道”“抢在敌人合围前破开机关”“带云岚脱离当前死局”。目标出现后，每一小节都要围绕它推进。

### 3. 危机推进
当前问题：
${crisisProblem}

修改方式：
推进伏笔“${hookToAdvance}”，让它变成具体阻碍：敌人现身、机关反噬、伤势恶化、通道封死或同伴被锁定。不要只解释设定。

## 可选优化
- 删除与上一章重复的世界观、境界、真名或战力说明。
- 增加一次主角和同伴的短对话，用来确认目标和代价。
- 在中段加入一次失败或反噬，让危机比上一章更近、更具体。

## 示例改写（开头）

${example}

## 修改后目标
- 开头直接承接上一章，不重新铺环境。
- 3段内进入危机或行动选择。
- 明确主角目标，并让目标贯穿本章。
- 至少推进一个上一章伏笔。
- 结尾形成新的危险钩子。`;
}

async function writeManualFixFileIfNeeded(report: ContinuityReport, reportMarkdownPath: string): Promise<void> {
  if (!report.manual_fix_prompt.trim()) return;
  const outputPath = manualFixPathFromReportPath(reportMarkdownPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${report.manual_fix_prompt.trimEnd()}\n`, "utf-8");
}

function manualFixPathFromReportPath(reportMarkdownPath: string): string {
  const name = basename(reportMarkdownPath).replace(/\.(?:report|final-report|salvage-report)\.md$/u, ".manual-fix.md");
  return join(dirname(reportMarkdownPath), name);
}

function buildManualIssueSummary(report: ContinuityReport, prevHook: string): string[] {
  const issues = report.issues
    .slice(0, 3)
    .map((issue) => summarizeIssue(issue));
  if (issues.length) return issues;

  const summary = [];
  if (report.opening_check && JSON.stringify(report.opening_check).includes("FAIL")) {
    summary.push(`开头没有承接上一章“${prevHook}”，导致断链。`);
  }
  if (report.goal_clear !== "YES") summary.push("中段缺少明确行动目标，主角像在被剧情推着走。");
  if (report.crisis_progress !== "升级") summary.push("危机没有推进，整体停滞。");
  return summary.slice(0, 3).length ? summary.slice(0, 3) : ["当前章未达到发布连续性标准，需要人工重修开头、目标和危机推进。"];
}

function summarizeIssue(issue: ContinuityIssue): string {
  const detail = issue.detail.replace(/\s+/g, " ").trim();
  return `${issue.type}：${detail || "需要人工检查并修复。"}`
    .replace(/。$/, "");
}

function openingProblemText(report: ContinuityReport, currentOpening: string, prevHook: string): string {
  const opening = JSON.stringify(report.opening_check);
  if (opening.includes("FAIL")) {
    return `当前开头没有直接接住上一章“${prevHook || "尾钩"}”，而是从新画面或说明开始。`;
  }
  if (/重复|说明|设定/.test(`${opening}\n${currentOpening}`)) {
    return "当前开头虽然有关联，但说明和回顾偏多，危机没有立刻压到人物身上。";
  }
  return "当前开头承接不够锋利，需要把上一章尾钩转成更近的动作、声音或攻击。";
}

function buildOpeningRewriteExample(prevHook: string, hookToAdvance: string, currentGoal: string): string {
  const hook = prevHook || "黑暗深处的动静";
  const goal = currentGoal?.trim() || "先避开正面冲突，找到能破局的通道";
  const threat = hookToAdvance || "上一章留下的危险";
  const threatAction = /声|脚步|拖拽/.test(threat)
    ? `${threat}骤然贴近`
    : `${threat}骤然亮起`;
  return [
    `${hook}没有远去，反而贴着石壁一点点逼近。楚夜握紧手里的短刃，右臂废掉后的麻木还在往肩头爬，云岚后颈那道疤却先一步发烫。`,
    `“别回头。”楚夜压低声音，目光扫过脚下暗河的水线，“我们不能和它硬碰，先找通道。”`,
    `话音刚落，${threatAction}，一道冷光从黑暗里斩出，正落在两人刚才站立的位置。碎石迸溅，退路被硬生生截断。`,
  ].join("\n\n");
}

function extractContinuityHook(text: string): string {
  const tail = firstNonEmptyParagraphs(text, 6, "tail").join(" ");
  const matches = [...tail.matchAll(/([^。！？\n]*(?:拖拽|铁器|脚步|声音|逼近|裂开|苏醒|黑影|血|门|暗河|疤痕|图纹|棺|石碑)[^。！？\n]*[。！？]?)/gu)];
  return cleanSnippet(matches.at(-1)?.[1] || firstNonEmptyParagraphs(text, 1, "tail")[0] || "");
}

function extractIgnoredHooks(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  const ignored = source["被忽略元素"] || source.ignored || source.missing;
  return Array.isArray(ignored) ? ignored.map((item) => cleanSnippet(String(item))).filter(Boolean) : [];
}

function inferHookToAdvance(prevHook: string, report: ContinuityReport): string {
  const text = `${prevHook}\n${JSON.stringify(report.foreshadowing_continuity)}\n${report.summary}`;
  if (/铁器|拖拽/.test(text)) return "逼近的铁器拖拽声";
  if (/脚步/.test(text)) return "逼近的脚步声";
  if (/石碑|符文|图纹/.test(text)) return "石碑/图纹异动";
  if (/疤痕|云岚|后颈/.test(text)) return "云岚后颈疤痕共鸣";
  if (/血|伤|右臂|反噬/.test(text)) return "楚夜伤势或反噬";
  if (/暗河|通道|门/.test(text)) return "暗河通道";
  return "上一章最后留下的危险";
}

function firstNonEmptyParagraphs(text: string, count: number, from: "head" | "tail" = "head"): string[] {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const selected = from === "tail" ? paragraphs.slice(-count) : paragraphs.slice(0, count);
  return selected.map(cleanSnippet).filter(Boolean);
}

function cleanSnippet(text: string): string {
  return text
    .replace(/^#{1,6}\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function extractChapterNumber(text: string): string {
  const match = text.match(/第\s*(\d+)\s*章/u);
  return match?.[1] || "";
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

function normalizePublishBlockers(value: unknown): ContinuityPublishBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      type: stringValue(source.type || "BLOCKED"),
      detail: stringValue(source.detail || item),
    };
  }).filter((item) => item.type || item.detail);
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

export function countChineseNovelWords(text: string, minChapterWords = 1000): {
  readonly word_count: number;
  readonly min_chapter_words: number;
  readonly length_status: ContinuityLengthStatus;
} {
  const withoutCode = text.replace(/```[\s\S]*?```/g, "\n");
  const body = withoutCode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:#{1,6}\s*)?第\s*\d+\s*章(?:\s+.*)?$/u.test(line))
    .map((line) => line.replace(/^#{1,6}\s*/u, ""))
    .join("\n");

  const chineseChars = body.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const latinTokens = body
    .replace(/[\u3400-\u9fff]/gu, " ")
    .match(/[A-Za-z0-9]+(?:[-_'][A-Za-z0-9]+)*/g)?.length ?? 0;
  const wordCount = chineseChars + latinTokens;
  const minWords = normalizePositiveInt(minChapterWords, 1000);
  return {
    word_count: wordCount,
    min_chapter_words: minWords,
    length_status: wordCount >= minWords ? "PASS" : "TOO_SHORT",
  };
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
  return value === "PASS" || value === "MANUAL_REVIEW" || value === "DROP" || value === "RETRY";
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
