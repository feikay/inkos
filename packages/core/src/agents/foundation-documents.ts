import type { ArchitectOutput } from "./architect.js";
import type { BookConfig } from "../models/book.js";

export interface FoundationDocumentMeta {
  readonly id?: string;
  readonly title?: string;
  readonly genre?: BookConfig["genre"] | string;
  readonly platform?: BookConfig["platform"] | string;
}

type Language = "zh" | "en";

interface StoryContext {
  readonly genreArchitecture: string;
  readonly worldEngine: string;
  readonly antagonistMap: string;
  readonly motivationMatrix: string;
  readonly first10ChapterPlan: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly hasMissingStorySkeleton: boolean;
}

function sectionOrNote(content: string | undefined, language: Language): string {
  const trimmed = content?.trim();
  if (trimmed) return trimmed;
  return language === "en"
    ? "Missing story skeleton section; complete after regeneration or manual editing."
    : "故事骨架信息缺失，待重新生成或人工补全。";
}

function buildContext(output: ArchitectOutput, language: Language): StoryContext {
  const sections = [
    output.genreArchitecture,
    output.worldEngine,
    output.antagonistMap,
    output.motivationMatrix,
    output.first10ChapterPlan,
  ];
  return {
    genreArchitecture: sectionOrNote(output.genreArchitecture, language),
    worldEngine: sectionOrNote(output.worldEngine, language),
    antagonistMap: sectionOrNote(output.antagonistMap, language),
    motivationMatrix: sectionOrNote(output.motivationMatrix, language),
    first10ChapterPlan: sectionOrNote(output.first10ChapterPlan, language),
    storyBible: output.storyBible,
    volumeOutline: output.volumeOutline,
    bookRules: output.bookRules,
    currentState: output.currentState,
    pendingHooks: output.pendingHooks,
    hasMissingStorySkeleton: sections.some((section) => !section?.trim()),
  };
}

function compact(value: string | undefined, maxLength = 900): string {
  const normalized = (value ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}\n...`
    : normalized;
}

function tableCell(value: string | undefined, maxLength = 180): string {
  return summarizeSingleLine(value, maxLength).replace(/\|/g, "/");
}

function summarizeSingleLine(value: string | undefined, maxLength = 160): string {
  const normalized = (value ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("|---"))
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^>\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join("；");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function extractBulletValue(markdown: string, labels: readonly string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = markdown.match(new RegExp(`^\\s*(?:-\\s*)?${escaped}\\s*[：:]\\s*(.+)$`, "im"));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function extractYamlNestedValue(markdown: string, parent: string, key: string): string {
  const parentEscaped = parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyEscaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^${parentEscaped}\\s*:\\s*$[\\s\\S]*?^\\s{2,}${keyEscaped}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

function extractSection(markdown: string, heading: string, maxLength = 1200): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^#{2,3}\\s+${escaped}\\s*$\\n?([\\s\\S]*?)(?=^#{2,3}\\s+|(?![\\s\\S]))`, "im"));
  return compact(match?.[1] ?? "", maxLength);
}

function extractFirstTable(markdown: string, fallback = ""): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith("|"));
  if (start < 0) return fallback;
  const table: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    if (!line.trim().startsWith("|")) break;
    table.push(line);
  }
  return table.join("\n") || fallback;
}

function inferNameFromMarkdown(markdown: string, labels: readonly string[], fallback: string): string {
  const value = extractBulletValue(markdown, labels);
  if (!value) return fallback;
  const normalized = value.replace(/[（(].*?[）)]/g, "").replace(/[,，].*$/g, "").trim();
  if (!normalized || normalized === fallback) return fallback;
  return normalized;
}

interface ChapterPlanRow {
  readonly chapter: number;
  readonly functionText: string;
  readonly emotionEvent: string;
  readonly goal: string;
  readonly obstacle: string;
  readonly solution: string;
  readonly payoff: string;
  readonly endingHook: string;
}

function parseGoldenThreeChapters(first10ChapterPlan: string): Map<number, Partial<ChapterPlanRow>> {
  const result = new Map<number, Partial<ChapterPlanRow>>();
  for (const chapter of [1, 2, 3]) {
    const zh = extractSection(first10ChapterPlan, `第${chapter}章`, 800);
    const en = extractSection(first10ChapterPlan, `Chapter ${chapter}`, 800);
    const section = zh || en;
    if (!section) continue;
    const mainHook = extractBulletValue(section, ["主钩子类型", "Main hook type"]);
    const conflict = extractBulletValue(section, ["前500字冲突", "First 500-word conflict"]);
    const dilemma = extractBulletValue(section, ["主角困境", "Protagonist dilemma"]);
    const coreFunction = extractBulletValue(section, ["核心功能", "Core function"]);
    const edge = extractBulletValue(section, ["金手指/核心差异如何展示", "How core edge/difference appears"]);
    const obstacle = extractBulletValue(section, ["阻碍如何升级", "How obstacle escalates"]);
    const longGoal = extractBulletValue(section, ["长期目标如何明确", "How long-term goal becomes clear"]);
    const stageEnemy = extractBulletValue(section, ["第一个阶段敌人如何出现", "How first stage enemy appears"]);
    const endingHook = extractBulletValue(section, ["章节结尾钩子", "Ending hook"]);
    result.set(chapter, {
      chapter,
      functionText: coreFunction || mainHook || (chapter === 1 ? "开局入局" : chapter === 2 ? "展示核心差异" : "明确长期目标"),
      emotionEvent: conflict || edge || longGoal || "按黄金三章目标推进情绪事件",
      goal: longGoal || conflict || "推进黄金三章目标",
      obstacle: dilemma || obstacle || stageEnemy || "阻碍升级",
      solution: edge || "用主角选择或核心差异破局",
      payoff: mainHook || coreFunction || "阶段反馈",
      endingHook: endingHook || stageEnemy || "留下下一章钩子",
    });
  }
  return result;
}

function parseChapterTable(first10ChapterPlan: string): ChapterPlanRow[] {
  const tableSource = extractSection(first10ChapterPlan, "2. 前10章章节表", 4000)
    || extractSection(first10ChapterPlan, "2. First 10 Chapter Table", 4000)
    || first10ChapterPlan;
  const table = extractFirstTable(tableSource);
  const rows = table
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/---/.test(line))
    .filter((line) => !/章数|Chapter/i.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

  return rows
    .map((cells) => ({
      chapter: parseInt(cells[0] ?? "", 10),
      functionText: cells[1] ?? "",
      emotionEvent: cells[2] ?? "",
      goal: cells[3] ?? "",
      obstacle: cells[4] ?? "",
      solution: cells[5] ?? "",
      payoff: cells[6] ?? "",
      endingHook: cells[7] ?? "",
    }))
    .filter((row) => Number.isFinite(row.chapter) && row.chapter >= 1 && row.chapter <= 10);
}

function defaultChapterRow(chapter: number): ChapterPlanRow {
  const defaults: Record<number, Omit<ChapterPlanRow, "chapter">> = {
    1: { functionText: "开局入局", emotionEvent: "困境/危机/反差", goal: "活下来并进入主线", obstacle: "开局压迫", solution: "抓住第一处规则缝隙", payoff: "入局，留下结尾钩子", endingHook: "更大威胁出现" },
    2: { functionText: "展示核心差异", emotionEvent: "试探/小爽", goal: "弄清核心差异", obstacle: "压力升级", solution: "初次使用核心差异", payoff: "小爽点或希望感", endingHook: "奖励或代价异常" },
    3: { functionText: "明确目标", emotionEvent: "目标明确/压力升级", goal: "确立第一个阶段目标", obstacle: "第一阶段敌人出现", solution: "主动选择路线", payoff: "主线目标成形", endingHook: "核心反派露影" },
    4: { functionText: "应对阻碍", emotionEvent: "应对阻碍", goal: "推进第一线索", obstacle: "规则或资源压迫", solution: "以行动试错", payoff: "线索推进", endingHook: "新阻碍出现" },
    5: { functionText: "小收益", emotionEvent: "小收益/新问题", goal: "拿到阶段筹码", obstacle: "反派压力显影", solution: "利用前文伏笔", payoff: "小爽点", endingHook: "风险扩大" },
    6: { functionText: "关系拉扯", emotionEvent: "紧迫/关系拉扯", goal: "稳住同伴或资源", obstacle: "人物关系冲突", solution: "做出取舍", payoff: "关系变化", endingHook: "新情报出现" },
    7: { functionText: "伏笔推进", emotionEvent: "收益/伏笔", goal: "推进隐藏线索", obstacle: "资源或规则线阻拦", solution: "验证推断", payoff: "伏笔加深", endingHook: "真相露边" },
    8: { functionText: "危机反转", emotionEvent: "危机/反转", goal: "摆脱阶段危机", obstacle: "计划受阻或身份风险", solution: "用代价换破局", payoff: "反转抬升压力", endingHook: "阶段敌人逼近" },
    9: { functionText: "爆发前夜", emotionEvent: "爆发前夜", goal: "准备阶段对抗", obstacle: "阶段敌人逼近", solution: "整合筹码", payoff: "冲突收束", endingHook: "决战触发" },
    10: { functionText: "阶段爆发", emotionEvent: "阶段爆发/新敌显现", goal: "完成第一次局势变化", obstacle: "阶段敌人全面压迫", solution: "付代价反击", payoff: "局势发生可见变化", endingHook: "打开下一轮矛盾" },
  };
  return { chapter, ...defaults[chapter]! };
}

function normalizeFirst10ChapterRows(first10ChapterPlan: string): ChapterPlanRow[] {
  const golden = parseGoldenThreeChapters(first10ChapterPlan);
  const tableRows = new Map(parseChapterTable(first10ChapterPlan).map((row) => [row.chapter, row]));
  return Array.from({ length: 10 }, (_, index) => {
    const chapter = index + 1;
    const base = defaultChapterRow(chapter);
    const goldenRow = golden.get(chapter);
    const tableRow = tableRows.get(chapter);
    return {
      chapter,
      functionText: tableRow?.functionText || goldenRow?.functionText || base.functionText,
      emotionEvent: tableRow?.emotionEvent || goldenRow?.emotionEvent || base.emotionEvent,
      goal: tableRow?.goal || goldenRow?.goal || base.goal,
      obstacle: tableRow?.obstacle || goldenRow?.obstacle || base.obstacle,
      solution: tableRow?.solution || goldenRow?.solution || base.solution,
      payoff: tableRow?.payoff || goldenRow?.payoff || base.payoff,
      endingHook: tableRow?.endingHook || goldenRow?.endingHook || base.endingHook,
    };
  });
}

function rowsFromFirst10Plan(first10ChapterPlan: string): string[] {
  return normalizeFirst10ChapterRows(first10ChapterPlan).map((row) => {
    const intensity = row.chapter === 1 ? 8 : row.chapter <= 3 ? 7 : row.chapter === 10 ? 9 : 6;
    return `| ${row.chapter} | ${tableCell(row.emotionEvent)} | ${tableCell(row.obstacle)} | ${intensity} | ${tableCell(row.payoff || row.endingHook)} |`;
  });
}

function pickSupportRows(motivationMatrix: string): string[] {
  const table = extractFirstTable(extractSection(motivationMatrix, "重要配角动机表", 1600) || motivationMatrix);
  const rows = table
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/---/.test(line))
    .filter((line) => !/角色|Character/i.test(line));
  return rows.slice(0, 4);
}

interface HookRow {
  readonly hookId: string;
  readonly startChapter: string;
  readonly type: string;
  readonly status: string;
  readonly lastAdvanced: string;
  readonly expectedPayoff: string;
  readonly payoffTiming: string;
  readonly notes: string;
}

function parsePendingHookRows(pendingHooks: string): HookRow[] {
  const table = extractFirstTable(pendingHooks);
  return table
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/---/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 6)
    .filter((cells) => !/hook_id|起始章节|start_chapter/i.test(cells[0] ?? ""))
    .slice(0, 10)
    .map((cells, index) => ({
      hookId: cells[0] || `hook-${index + 1}`,
      startChapter: cells[1] || "1",
      type: cells[2] || "伏笔",
      status: cells[3] || "open",
      lastAdvanced: cells[4] || "0",
      expectedPayoff: cells[5] || "待定",
      payoffTiming: cells[6] || "待定",
      notes: cells[7] || "",
    }));
}

function extractProtagonistName(bookRules: string, storyBible: string, motivationMatrix: string, language: Language): string {
  return extractYamlNestedValue(bookRules, "protagonist", "name")
    || inferNameFromMarkdown(bookRules, ["name", "姓名", "主角名"], "")
    || inferNameFromMarkdown(storyBible, ["姓名", "主角", "Name", "Protagonist"], "")
    || inferNameFromMarkdown(motivationMatrix, ["主角", "Protagonist"], "")
    || (language === "en" ? "Protagonist" : "主角");
}

function extractAntagonistName(antagonistMap: string, language: Language): string {
  return inferNameFromMarkdown(antagonistMap, ["姓名/代号", "姓名", "代号", "Name/code", "Name"], "")
    || (language === "en" ? "Core Antagonist" : "核心反派");
}

export function buildAuthorIntentContent(
  output: ArchitectOutput,
  meta: FoundationDocumentMeta = {},
  language: Language = "zh",
): string {
  const ctx = buildContext(output, language);
  const title = language === "en" ? "Author Intent" : "作者意图";
  const missingNote = ctx.hasMissingStorySkeleton
    ? (language === "en" ? "\n> Some story skeleton sections are missing; complete this after regeneration or manual editing.\n" : "\n> 部分故事骨架信息缺失，待补全。\n")
    : "";
  const coreSellingPoint = extractBulletValue(ctx.genreArchitecture, ["核心卖点", "Core selling point"]) || "参考题材架构";
  const coreEmotion = extractBulletValue(ctx.genreArchitecture, ["核心情绪", "Core emotion"]) || "参考题材架构";
  const targetReaders = extractBulletValue(ctx.genreArchitecture, ["目标读者", "Target readers"]) || "平台目标读者";
  const rhythm = extractSection(ctx.genreArchitecture, language === "en" ? "4. Chapter Rhythm Template" : "4. 章节节奏模板", 800);
  const readerPromise = extractSection(ctx.genreArchitecture, language === "en" ? "2. Reader Promise" : "2. 读者承诺", 800);
  const motivation = extractSection(ctx.motivationMatrix, language === "en" ? "1. Protagonist Motivation" : "1. 主角动机", 700);

  if (language === "en") {
    return `# ${title}
${missingNote}
## 1. Work Positioning
- Title: ${meta.title ?? ""}
- Genre: ${meta.genre ?? ""}
- Platform: ${meta.platform ?? ""}
- Target readers: ${targetReaders}
- Core selling point: ${coreSellingPoint}
- Core emotion: ${coreEmotion}

## 2. Long-Term Creative Direction
- What this book mainly writes: ${compact(readerPromise || ctx.genreArchitecture, 700)}
- Why readers follow it: ${coreSellingPoint}
- Final protagonist change: ${compact(motivation, 500)}
- Final world change: ${compact(extractSection(ctx.worldEngine, "5. Protagonist Anomaly", 500) || ctx.worldEngine, 500)}

## 3. Gratification Promise
${rhythm || "- Small gratification rhythm:\n- Major gratification rhythm:\n- Main gratification types:"}

## 4. Emotional Promise
- Main emotion: ${coreEmotion}
- Avoid long-term oppression without release.
- Avoid ineffective protagonist abuse.

## 5. Creative Prohibitions
- Do not break the protagonist's locked personality.
- Do not make antagonists dumb for convenience.
- Do not contradict system/world rules.
- Do not reduce supporting characters to tools.
- Do not drift away from genre reader expectations.
`;
  }

  return `# ${title}
${missingNote}
## 1. 作品定位
- 书名：${meta.title ?? ""}
- 题材：${meta.genre ?? ""}
- 平台：${meta.platform ?? ""}
- 目标读者：${targetReaders}
- 核心卖点：${coreSellingPoint}
- 核心情绪：${coreEmotion}

## 2. 长期创作方向
- 这本书主要写什么？${compact(readerPromise || ctx.genreArchitecture, 700)}
- 读者追这本书主要为了获得什么？${coreSellingPoint}
- 主角最终要完成什么变化？${compact(motivation, 500)}
- 世界最终要发生什么变化？${compact(extractSection(ctx.worldEngine, "5. 主角异常性", 500) || ctx.worldEngine, 500)}

## 3. 爽点承诺
${rhythm || "- 小爽点节奏：\n- 大爽点节奏：\n- 主要爽点类型："}

## 4. 情绪承诺
- 主要情绪：${coreEmotion}
- 禁止长期压抑：高压后必须有行动、收益或情绪释放。
- 禁止无效虐主：受压必须服务目标、伏笔、反击或人物变化。

## 5. 创作禁忌
- 不允许破坏主角核心性格
- 不允许反派降智
- 不允许系统规则前后矛盾
- 不允许配角工具人
- 不允许偏离题材读者预期
`;
}

export function buildCurrentFocusContent(
  output: ArchitectOutput,
  _meta: FoundationDocumentMeta = {},
  language: Language = "zh",
): string {
  const ctx = buildContext(output, language);
  const ch1 = extractSection(ctx.first10ChapterPlan, language === "en" ? "Chapter 1" : "第1章", 450);
  const ch2 = extractSection(ctx.first10ChapterPlan, language === "en" ? "Chapter 2" : "第2章", 450);
  const ch3 = extractSection(ctx.first10ChapterPlan, language === "en" ? "Chapter 3" : "第3章", 450);
  const currentGoal = extractBulletValue(ctx.currentState, ["当前目标", "Current Goal"]) || extractBulletValue(ctx.motivationMatrix, ["表层目标", "Surface goal"]);
  const currentConstraint = extractBulletValue(ctx.currentState, ["当前限制", "Current Constraint"]);
  const currentConflict = extractBulletValue(ctx.currentState, ["当前冲突", "Current Conflict"]);

  if (language === "en") {
    return `# Current Focus

## Active Focus
- Chapter 1 must complete: ${compact(ch1, 450)}
- Chapter 2 must complete: ${compact(ch2, 450)}
- Chapter 3 must complete: ${compact(ch3, 450)}

## Current Mainline Goal
- Protagonist's most urgent goal: ${currentGoal || "Follow the first-10 chapter plan."}
- Current external pressure: ${currentConflict || "Use antagonist/world pressure from the skeleton."}
- Current constraint: ${currentConstraint || "Respect current_state and motivation_matrix."}
- Current ending direction: Every early chapter must end with a hook.

## Current Conflict Sources
- Resource/rule conflict: ${compact(extractSection(ctx.worldEngine, "6. Reusable Conflict Sources", 600) || ctx.worldEngine, 600)}
- Antagonist pressure: ${compact(extractSection(ctx.antagonistMap, "4. Antagonist Pressure Escalation", 600) || ctx.antagonistMap, 600)}
- Relationship conflict: ${compact(extractSection(ctx.motivationMatrix, "4. Relationship Tension", 600) || ctx.motivationMatrix, 600)}

## Writing Reminders
- Open directly with conflict.
- Do not explain the world in large blocks.
- Show system/world rules through action.
- Every chapter ending must leave a hook.
- Protagonist behavior must obey motivation_matrix.
`;
  }

  return `# 当前聚焦

## 当前重点
- 第1章必须完成：${compact(ch1, 450)}
- 第2章必须完成：${compact(ch2, 450)}
- 第3章必须完成：${compact(ch3, 450)}

## 当前主线目标
- 主角当前最急目标：${currentGoal || "按前10章规划推进。"}
- 当前外部压力：${currentConflict || "使用反派结构和世界发动机中的压力。"}
- 当前限制：${currentConstraint || "遵守 current_state 与 motivation_matrix。"}
- 当前结尾方向：每章结尾必须留钩子。

## 当前冲突来源
- 资源/规则冲突：${compact(extractSection(ctx.worldEngine, "6. 自动产出冲突的方式", 600) || ctx.worldEngine, 600)}
- 反派压力：${compact(extractSection(ctx.antagonistMap, "4. 反派压力递进", 600) || ctx.antagonistMap, 600)}
- 人物关系冲突：${compact(extractSection(ctx.motivationMatrix, "4. 人物关系张力", 600) || ctx.motivationMatrix, 600)}

## 当前写作提醒
- 开头必须直接进入冲突
- 不要大段解释世界观
- 系统规则通过行动展示
- 每章结尾必须留钩子
- 主角行为必须符合 motivation_matrix
`;
}

export function buildCharacterMatrixContent(
  output: ArchitectOutput,
  _meta: FoundationDocumentMeta = {},
  language: Language = "zh",
): string {
  const ctx = buildContext(output, language);
  const protagonistName = extractProtagonistName(ctx.bookRules, ctx.storyBible, ctx.motivationMatrix, language);
  const antagonistName = extractAntagonistName(ctx.antagonistMap, language);
  const protagonistMotivation = extractSection(ctx.motivationMatrix, language === "en" ? "1. Protagonist Motivation" : "1. 主角动机", 1000);
  const antagonistMotivation = extractSection(ctx.motivationMatrix, language === "en" ? "2. Core Antagonist Motivation" : "2. 核心反派动机", 900);
  const antagonistCore = extractSection(ctx.antagonistMap, language === "en" ? "1. Core Antagonist" : "1. 核心反派", 1000);
  const protagonistIdentity = extractBulletValue(ctx.storyBible, ["身份", "Identity"])
    || summarizeSingleLine(extractSection(ctx.storyBible, language === "en" ? "02_Protagonist" : "02_主角", 500), 140);
  const worldConflict = extractBulletValue(ctx.worldEngine, ["主角为什么是世界规则里的异常", "Why is the protagonist an anomaly under world rules"])
    || summarizeSingleLine(extractSection(ctx.worldEngine, language === "en" ? "5. Protagonist Anomaly" : "5. 主角异常性", 500), 160);
  const antagonistConflict = extractBulletValue(ctx.antagonistMap, ["与主角的价值观冲突", "Value conflict with protagonist"])
    || extractBulletValue(ctx.antagonistMap, ["为什么不能容忍主角", "Why they cannot tolerate the protagonist"])
    || summarizeSingleLine(extractSection(ctx.antagonistMap, language === "en" ? "1. Core Antagonist" : "1. 核心反派", 500), 160);
  const supportRows = pickSupportRows(ctx.motivationMatrix);
  const supportSection = supportRows.length > 0
    ? supportRows.map((row, index) => {
        const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
        const name = cells[0] || (language === "en" ? `Supporting Character ${index + 1}` : `重要配角${index + 1}`);
        return language === "en"
          ? `## Important Supporting Character: ${name}
- Identity:
- Surface goal: ${cells[1] ?? ""}
- Deep desire: ${cells[2] ?? ""}
- Fear: ${cells[3] ?? ""}
- Bottom line: ${cells[4] ?? ""}
- Relationship with protagonist: ${cells[7] ?? ""}
- Independent action line: refine from motivation_matrix.
- Writing note: keep this character's independent goal active.`
          : `## 重要配角：${name}
- 身份：
- 表层目标：${cells[1] ?? ""}
- 深层欲望：${cells[2] ?? ""}
- 恐惧：${cells[3] ?? ""}
- 底线：${cells[4] ?? ""}
- 与主角关系：${cells[7] ?? ""}
- 独立行动线：从 motivation_matrix 继续细化。
- 续写注意：不要让该角色只承担工具人功能。`;
      }).join("\n\n")
    : (language === "en"
        ? `## Important Supporting Character: To Be Refined
- Identity:
- Surface goal:
- Deep desire:
- Fear:
- Bottom line:
- Relationship with protagonist:
- Independent action line:
- Writing note: names were not reliably parsed; refine after early chapters.`
        : `## 重要配角：待细化
- 身份：
- 表层目标：
- 深层欲望：
- 恐惧：
- 底线：
- 与主角关系：
- 独立行动线：
- 续写注意：未能可靠解析姓名，后续章节出现后补全。`);

  if (language === "en") {
    return `# Character Matrix

## Protagonist: ${protagonistName}
- Identity: ${protagonistIdentity || "See story_bible.md"}
- Personality lock: ${summarizeSingleLine(extractBulletValue(ctx.bookRules, ["personalityLock"]), 120) || "See book_rules.md"}
- Surface goal: ${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["Surface goal"]), 140)}
- Deep desire: ${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["Deep desire"]), 140)}
- Greatest fear: ${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["Greatest fear"]), 140)}
- Bottom line: ${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["Bottom line"]), 140)}
- Behavioral constraints: ${summarizeSingleLine(extractBulletValue(ctx.bookRules, ["behavioralConstraints"]), 150) || "See book_rules.md"}
- Conflict with world rules: ${worldConflict || "Refine from world_engine.md."}
- Conflict with core antagonist: ${antagonistConflict || "Refine from antagonist_map.md."}
- Writing note: protagonist actions must follow motivation_matrix.

## Core Antagonist: ${antagonistName}
- Surface identity: ${summarizeSingleLine(extractBulletValue(antagonistCore, ["Surface identity"]), 140)}
- Real identity: ${summarizeSingleLine(extractBulletValue(antagonistCore, ["Real identity"]), 140)}
- Antagonist type: ${summarizeSingleLine(extractBulletValue(antagonistCore, ["Antagonist type"]), 120)}
- Public goal: ${summarizeSingleLine(extractBulletValue(antagonistCore, ["Public goal"]), 140)}
- Hidden goal: ${summarizeSingleLine(extractBulletValue(antagonistCore, ["Hidden goal"]), 140)}
- Deep desire: ${summarizeSingleLine(extractBulletValue(antagonistMotivation, ["Deep desire"]), 140)}
- Greatest fear: ${summarizeSingleLine(extractBulletValue(antagonistMotivation, ["Greatest fear"]), 140)}
- Order represented: ${summarizeSingleLine(extractBulletValue(antagonistCore, ["Order defended"]), 140)}
- Why they cannot tolerate protagonist: ${summarizeSingleLine(extractBulletValue(antagonistCore, ["Why they cannot tolerate the protagonist"]), 160)}
- No-dumbing-down rules: victories against this antagonist require foreshadowing, cost, intelligence, or tiny variables.

${supportSection}
`;
  }

  return `# 角色矩阵

## 主角：${protagonistName}
- 身份：${protagonistIdentity || "见 story_bible.md"}
- 性格锁：${summarizeSingleLine(extractBulletValue(ctx.bookRules, ["personalityLock"]), 120) || "见 book_rules.md"}
- 表层目标：${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["表层目标"]), 140)}
- 深层欲望：${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["深层欲望"]), 140)}
- 最大恐惧：${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["最大恐惧"]), 140)}
- 底线：${summarizeSingleLine(extractBulletValue(protagonistMotivation, ["底线"]), 140)}
- 行为约束：${summarizeSingleLine(extractBulletValue(ctx.bookRules, ["behavioralConstraints"]), 150) || "见 book_rules.md"}
- 与世界规则的冲突：${worldConflict || "从 world_engine.md 继续细化。"}
- 与核心反派的冲突：${antagonistConflict || "从 antagonist_map.md 继续细化。"}
- 续写注意：主角行动必须符合 motivation_matrix。

## 核心反派：${antagonistName}
- 表层身份：${summarizeSingleLine(extractBulletValue(antagonistCore, ["表层身份"]), 140)}
- 真实身份：${summarizeSingleLine(extractBulletValue(antagonistCore, ["真实身份"]), 140)}
- 反派类型：${summarizeSingleLine(extractBulletValue(antagonistCore, ["反派类型"]), 120)}
- 公开目标：${summarizeSingleLine(extractBulletValue(antagonistCore, ["公开目标"]), 140)}
- 隐藏目标：${summarizeSingleLine(extractBulletValue(antagonistCore, ["隐藏目标"]), 140)}
- 深层欲望：${summarizeSingleLine(extractBulletValue(antagonistMotivation, ["深层欲望"]), 140)}
- 最大恐惧：${summarizeSingleLine(extractBulletValue(antagonistMotivation, ["最大恐惧"]), 140)}
- 代表的秩序：${summarizeSingleLine(extractBulletValue(antagonistCore, ["维护的秩序"]), 140)}
- 不能容忍主角的原因：${summarizeSingleLine(extractBulletValue(antagonistCore, ["为什么不能容忍主角"]), 160)}
- 不降智规则：主角胜利必须靠伏笔、智慧、代价或微小变量。

${supportSection}
`;
}

export function buildEmotionalArcsContent(
  output: ArchitectOutput,
  _meta: FoundationDocumentMeta = {},
  language: Language = "zh",
): string {
  const ctx = buildContext(output, language);
  const rows = rowsFromFirst10Plan(ctx.first10ChapterPlan).join("\n");
  const supportRows = pickSupportRows(ctx.motivationMatrix);
  const supportEmotionRows = supportRows.length > 0
    ? supportRows.slice(0, 4).map((row) => {
        const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
        return `| ${cells[0] || "待细化"} | ${cells[3] || "目标未满足"} | motivation_matrix | ${cells[7] || "待观察"} |`;
      }).join("\n")
    : "| 待细化配角 | 观望/试探 | motivation_matrix 信息不足 | 待后续章节细化 |";

  if (language === "en") {
    return `# Emotional Arcs

## 1. Protagonist First 10 Chapter Emotional Arc
| Chapter | Emotional State | Trigger Event | Intensity (1-10) | Arc Direction |
|---|---|---|---|---|
${rows}

## 2. Important Supporting Character Emotional Starting Points
| Character | Initial Emotion | Trigger Source | Relationship Change With Protagonist |
|---|---|---|---|
${supportEmotionRows}

## 3. Emotional Rhythm Reminders
- Do not run multiple consecutive chapters with only pressure and no release.
- Provide a small gratification or emotional release at least every 2 chapters.
- Create one stage feedback beat every 10 chapters.
- Funny or gratification-heavy genres should avoid long-term heaviness.
`;
  }

  return `# 情感弧线

## 1. 主角前10章情绪弧线
| 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |
|---|---|---|---|---|
${rows}

## 2. 重要配角情绪起点
| 角色 | 初始情绪 | 触发来源 | 与主角关系变化 |
|---|---|---|---|
${supportEmotionRows}

## 3. 情绪节奏提醒
- 不允许连续多章只有高压，没有释放
- 每2章至少有一个小爽点或情绪释放
- 每10章形成一次阶段反馈
- 搞笑/爽文题材要避免长期沉重
`;
}

export function buildSubplotBoardContent(
  output: ArchitectOutput,
  _meta: FoundationDocumentMeta = {},
  language: Language = "zh",
): string {
  const ctx = buildContext(output, language);
  const hookRows = parsePendingHookRows(ctx.pendingHooks);
  const hookSubplots = hookRows.map((hook, index) => {
    const id = tableCell(hook.hookId || `hook-${index + 1}`, 60);
    const type = tableCell(hook.type, 40);
    const name = language === "en" ? `${type} Hook: ${id}` : `${type}伏笔：${id}`;
    const summary = tableCell([hook.notes, hook.expectedPayoff].filter(Boolean).join("；"), 220);
    return `| hook-${id} | ${name} | 主角/相关角色 | ${tableCell(hook.startChapter, 20) || "1"} | ${tableCell(hook.lastAdvanced, 20) || "0"} | 0 | ${tableCell(hook.status, 40) || "open"} | ${summary || "由 pending_hooks.md 转入支线追踪。"} | ${tableCell(hook.payoffTiming, 60) || "待定"} |`;
  });
  const rows = language === "en"
    ? [
        "| system-secret | System/Core Rule Secret | Protagonist, rule holders | 1 | 0 | 0 | open | Track the hidden logic behind the protagonist's core advantage and world rules. | near-term/mid-arc |",
        "| core-antagonist-plot | Core Antagonist Plot | Core antagonist, stage antagonists | 1 | 0 | 0 | open | Use antagonist_map plan chain as the long pressure line. | mid-arc |",
        "| world-resource-monopoly | World Rule/Resource Monopoly | Protagonist, monopolists | 1 | 0 | 0 | open | Convert world_engine scarcity and power cycle into repeated conflict. | slow-burn |",
        "| first-10-stage-enemy | First 10 Stage Enemy | Protagonist, first stage enemy | 1 | 0 | 0 | open | Follow first_10_chapter_plan pressure and payoff route. | near-term |",
        "| supporting-character-goals | Supporting Character Independent Goals | Important allies/betrayers | 1 | 0 | 0 | open | Keep motivation_matrix supporting goals active, not tool-only. | mid-arc |",
        ...hookSubplots,
        ...(hookRows.length >= 10 ? ["| more-hooks | More Hooks | Related cast | 1 | 0 | 0 | open | More hooks exist; see pending_hooks.md. | mixed |"] : []),
      ]
    : [
        "| system-secret | 系统秘密线 | 主角、规则掌握者 | 1 | 0 | 0 | open | 追踪主角核心差异和世界规则背后的隐藏逻辑。 | 近期/中程 |",
        "| core-antagonist-plot | 核心反派阴谋线 | 核心反派、阶段反派 | 1 | 0 | 0 | open | 使用 antagonist_map 的计划链作为长期压力线。 | 中程 |",
        "| world-resource-monopoly | 世界规则/资源垄断线 | 主角、垄断者 | 1 | 0 | 0 | open | 将 world_engine 的稀缺资源和权力循环转化为反复冲突。 | 慢烧 |",
        "| first-10-stage-enemy | 前10章阶段敌人线 | 主角、第一阶段敌人 | 1 | 0 | 0 | open | 按 first_10_chapter_plan 推进压力和阶段收益。 | 近期 |",
        "| supporting-character-goals | 重要配角独立目标线 | 重要同伴/潜在背叛者 | 1 | 0 | 0 | open | 保持 motivation_matrix 中的配角独立目标，不写成工具人。 | 中程 |",
        ...hookSubplots,
        ...(hookRows.length >= 10 ? ["| more-hooks | 更多伏笔 | 相关角色 | 1 | 0 | 0 | open | 还有更多伏笔，见 pending_hooks.md。 | 混合 |"] : []),
      ];

  if (language === "en") {
    return `# Subplot Board

| Subplot ID | Subplot | Related Characters | Start Chapter | Last Active Chapter | Chapters Since | Status | Progress Summary | Payoff ETA |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
  }

  return `# 支线进度板

| 支线ID | 支线名 | 相关角色 | 起始章 | 最近活跃章 | 距今章数 | 状态 | 进度概述 | 回收ETA |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}
