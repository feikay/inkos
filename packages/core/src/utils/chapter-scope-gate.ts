import { countChapterLength, type LengthLanguage } from "./length-metrics.js";

/**
 * Parsed chapter intent scope boundaries extracted from intent markdown.
 */
export interface ChapterScopeBoundaries {
  /** Chapter surface-level goal / protagonist goal */
  readonly surfaceGoal: string;
  /** Chapter ending hook — what the next chapter naturally pushes toward */
  readonly nextChapterDirection: string;
  /** Unresolved problems that should NOT be solved in this chapter */
  readonly unresolvedProblems: string;
  /** Forbidden items /禁止事项 from the intent */
  readonly forbiddenItems: string;
  /** Chapter-level new foreshadowing allowed? */
  readonly allowedNewForeshadowing: string;
  /** Raw intent content for diagnostics */
  readonly rawIntent: string;
}

/**
 * Result of checking whether a final chapter candidate respects chapter scope.
 */
export interface ChapterScopeGateResult {
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly issues: ReadonlyArray<ChapterScopeIssue>;
  readonly summary: string;
}

export interface ChapterScopeIssue {
  readonly type: "premature_goal_completion" | "premature_hook_fulfillment" | "new_entity_overflow" | "forbidden_item_violation";
  readonly severity: "WARN" | "FAIL";
  readonly detail: string;
}

export interface ChapterScopeGateInput {
  /** Current chapter intent markdown content */
  readonly intentContent: string;
  /** Final/current chapter candidate text */
  readonly chapterText: string;
  /** Pending hooks markdown content (from pending_hooks.md) */
  readonly pendingHooksContent: string;
  /** Current chapter number */
  readonly chapterNumber: number;
  /** Previous chapter candidate text (for entity diff) */
  readonly previousChapterText?: string;
  /** Max allowed new entities before WARN */
  readonly newEntityWarnThreshold?: number;
  /** Max allowed new entities before FAIL */
  readonly newEntityFailThreshold?: number;
}

const DEFAULT_NEW_ENTITY_WARN_THRESHOLD = 3;
const DEFAULT_NEW_ENTITY_FAIL_THRESHOLD = 6;

/**
 * Parse chapter intent content to extract scope boundaries.
 * Extracts key fields from the standard chapter intent template (sections 3, 9, 11).
 */
export function parseChapterScopeBoundaries(intentContent: string): ChapterScopeBoundaries {
  const extract = (sectionLabel: string): string => {
    // Match "## N. sectionName" headers and capture content until next ## header
    const patterns = [
      new RegExp(`##\\s*\\d+[.\\s]*${escapeRegex(sectionLabel)}[\\s\\S]*?(?=\\n##\\s|$)`, "u"),
      new RegExp(`##\\s*${escapeRegex(sectionLabel)}[\\s\\S]*?(?=\\n##\\s|$)`, "u"),
    ];
    for (const pattern of patterns) {
      const match = intentContent.match(pattern);
      if (match?.[0]) {
        return match[0].replace(/^##\s*\d+[.\s]*[^\n]*\n?/u, "").trim();
      }
    }
    return "";
  };

  // Extract surface goal from §3 本章主角目标
  const goalSection = extract("本章主角目标");
  const surfaceGoalMatch = goalSection.match(/(?:表层目标|主角目标)[：:]\s*(.+)/u);
  const surfaceGoal = surfaceGoalMatch?.[1]?.trim() ?? "";

  // Extract next chapter direction from §9 下一章钩子
  const hookSection = extract("下一章钩子");
  const nextDirMatch = hookSection.match(/(?:下一章自然推进方向)[：:]\s*(.+)/u);
  const nextChapterDirection = nextDirMatch?.[1]?.trim() ?? "";
  const unresolvedProblems = extractMultilineField(hookSection, /(?:未解决问题)[：:]\s*/u);

  // Extract forbidden items from §11 写作执行提醒
  const execSection = extract("写作执行提醒");
  const forbiddenItems = extractMultilineField(execSection, /(?:禁止事项)[：:]\s*/u);

  // Extract allowed new foreshadowing from §8 (supports multiline)
  const endingSection = extract("本章结局反馈");
  const allowedNewForeshadowing = extractMultilineField(endingSection, /(?:新增伏笔)[：:]\s*/u);

  return {
    surfaceGoal,
    nextChapterDirection,
    unresolvedProblems,
    forbiddenItems,
    allowedNewForeshadowing,
    rawIntent: intentContent,
  };
}

/**
 * Evaluate whether a chapter candidate violates the chapter scope boundaries.
 * Checks:
 * 1. Whether "next chapter direction" goals are prematurely completed
 * 2. Whether future pending hooks are being fulfilled
 * 3. Whether too many new named entities have been introduced
 * 4. Whether forbidden items are violated
 */
export function evaluateChapterScopeGate(input: ChapterScopeGateInput): ChapterScopeGateResult {
  const boundaries = parseChapterScopeBoundaries(input.intentContent);
  const issues: ChapterScopeIssue[] = [];

  // 1. Check premature goal completion: does the chapter text complete goals
  //    that are listed as "next chapter direction" or "unresolved problems"?
  const prematureGoals = checkPrematureGoalCompletion(
    boundaries.nextChapterDirection,
    boundaries.unresolvedProblems,
    input.chapterText,
  );
  issues.push(...prematureGoals);

  // 2. Check premature hook fulfillment: are pending hooks with expected payoff
  //    > current chapter being fulfilled?
  const prematureHooks = checkPrematureHookFulfillment(
    input.pendingHooksContent,
    input.chapterNumber,
    input.chapterText,
  );
  issues.push(...prematureHooks);

  // 3. Check new entity overflow
  const entityIssues = checkNewEntityOverflow(
    input.chapterText,
    input.previousChapterText,
    input.newEntityWarnThreshold ?? DEFAULT_NEW_ENTITY_WARN_THRESHOLD,
    input.newEntityFailThreshold ?? DEFAULT_NEW_ENTITY_FAIL_THRESHOLD,
  );
  issues.push(...entityIssues);

  // 4. Check forbidden item violations
  const forbiddenIssues = checkForbiddenItemViolations(
    boundaries.forbiddenItems,
    input.chapterText,
  );
  issues.push(...forbiddenIssues);

  // Determine overall status
  const failCount = issues.filter((i) => i.severity === "FAIL").length;
  const warnCount = issues.filter((i) => i.severity === "WARN").length;

  let status: "PASS" | "WARN" | "FAIL";
  if (failCount > 0) {
    status = "FAIL";
  } else if (warnCount > 0) {
    status = "WARN";
  } else {
    status = "PASS";
  }

  const summary = status === "PASS"
    ? "chapter scope gate: no scope violations detected."
    : status === "WARN"
      ? `chapter scope gate: ${warnCount} warning(s). ${issues.map((i) => i.detail).join("; ")}`
      : `chapter scope gate: ${failCount} failure(s), ${warnCount} warning(s). ${issues.map((i) => i.detail).join("; ")}`;

  return { status, issues, summary };
}

/**
 * Build a chapter-scope constraint block for inclusion in repair prompts.
 */
export function buildChapterScopeConstraintBlock(boundaries: ChapterScopeBoundaries): string {
  const parts: string[] = [];

  if (boundaries.surfaceGoal) {
    parts.push(`- 本章主角目标：${boundaries.surfaceGoal}`);
  }
  if (boundaries.nextChapterDirection) {
    parts.push(`- 下一章自然推进方向（本章不得提前完成）：${boundaries.nextChapterDirection}`);
  }
  if (boundaries.unresolvedProblems) {
    parts.push(`- 本章未解决问题（不得在本章解决）：${boundaries.unresolvedProblems}`);
  }
  if (boundaries.forbiddenItems) {
    parts.push(`- 禁止事项：${boundaries.forbiddenItems}`);
  }

  if (parts.length === 0) return "";
  return `【章节作用域硬约束】
以下是当前章节的写作边界，修复时不得突破：
${parts.join("\n")}
- 只修当前章节目标，不提前完成下一章方向。
- 不让"未解决问题"在本章被解决。
- 不新增 intent 禁止的人物/势力/场景。`;
}

// ---- Internal helpers ----

function checkPrematureGoalCompletion(
  nextChapterDirection: string,
  unresolvedProblems: string,
  chapterText: string,
): ChapterScopeIssue[] {
  const issues: ChapterScopeIssue[] = [];

  // Extract key phrases from next chapter direction (Chinese comma/semicolon separated)
  const directionPhrases = extractKeyPhrases(nextChapterDirection);
  for (const phrase of directionPhrases) {
    if (phrase.length < 2) continue;
    // Check if this "next chapter" goal appears to be completed in the text
    // Heuristic: look for the phrase in a context suggesting completion
    const completionPatterns = [
      new RegExp(`${escapeRegex(phrase)}.*?(?:完成|成功|实现|达成|拿到|得到|获得|已经|终于)`, "u"),
      new RegExp(`(?:完成|成功|实现|达成|拿到|得到|获得|已经|终于).*?${escapeRegex(phrase)}`, "u"),
    ];
    for (const pattern of completionPatterns) {
      if (pattern.test(chapterText)) {
        issues.push({
          type: "premature_goal_completion",
          severity: "FAIL",
          detail: `下一章方向"${phrase}"疑似被提前完成`,
        });
        break;
      }
    }
  }

  // Check unresolved problems
  const problemPhrases = extractKeyPhrases(unresolvedProblems);
  for (const phrase of problemPhrases) {
    if (phrase.length < 2) continue;
    const resolutionPatterns = [
      new RegExp(`${escapeRegex(phrase)}.*?(?:解决|化解|消除|处理|搞定|摆平|平息)`, "u"),
      new RegExp(`(?:解决|化解|消除|处理|搞定|摆平|平息).*?${escapeRegex(phrase)}`, "u"),
    ];
    for (const pattern of resolutionPatterns) {
      if (pattern.test(chapterText)) {
        issues.push({
          type: "premature_goal_completion",
          severity: "FAIL",
          detail: `未解决问题"${phrase}"疑似被提前解决`,
        });
        break;
      }
    }
  }

  return issues;
}

function checkPrematureHookFulfillment(
  pendingHooksContent: string,
  currentChapter: number,
  chapterText: string,
): ChapterScopeIssue[] {
  const issues: ChapterScopeIssue[] = [];

  if (!pendingHooksContent || !pendingHooksContent.trim()) return issues;

  // First, try to parse as Markdown table
  const tableResult = parsePendingHooksTable(pendingHooksContent, currentChapter, chapterText);
  issues.push(...tableResult.issues);

  // If table was detected and produced issues, skip legacy format parsing
  if (tableResult.tableDetected && tableResult.issues.length > 0) return issues;

  // Legacy format: parse hooks with expected payoff chapter > current chapter
  const hookPatterns = [
    /(?:预期回收|expected\s*payoff)[：:\s]*第?\s*(\d+)\s*章/giu,
    /(?:回收章|payoff\s*chapter)[：:\s]*(\d+)/giu,
    /[Cc]h(?:apter)?[.\s]*(\d+)/g,
  ];

  // Split hooks into individual entries (by ## headers or - list items)
  const hookSections = pendingHooksContent.split(/\n(?=##\s|###\s|- \*\*)/u);

  for (const section of hookSections) {
    let payoffChapter: number | null = null;
    for (const pattern of hookPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(section);
      if (match?.[1]) {
        payoffChapter = Number.parseInt(match[1], 10);
        break;
      }
    }

    // Only flag hooks with expected payoff > current chapter
    if (payoffChapter === null || payoffChapter <= currentChapter) continue;

    // Extract hook key phrases (2-4 character Chinese phrases or quoted text)
    const hookPhrases = extractHookPhrases(section);
    for (const phrase of hookPhrases) {
      if (phrase.length < 2) continue;
      if (chapterText.includes(phrase)) {
        issues.push({
          type: "premature_hook_fulfillment",
          severity: "WARN",
          detail: `伏笔"${phrase}"预期回收在第${payoffChapter}章，但在第${currentChapter}章已出现`,
        });
      }
    }
  }

  return issues;
}

function checkNewEntityOverflow(
  chapterText: string,
  previousText: string | undefined,
  warnThreshold: number,
  failThreshold: number,
): ChapterScopeIssue[] {
  const issues: ChapterScopeIssue[] = [];

  // Extract named entities (Chinese names, place names, organization names)
  // More conservative: filter out surname+verb/particle false positives
  const extractEntities = (text: string): Set<string> => {
    const entities = new Set<string>();
    // Match Chinese proper nouns: surname + given name, place + suffix, org + suffix
    const surnamePattern = /([李王张刘陈杨赵黄周吴徐孙马胡朱郭何罗高林郑梁谢唐许冯宋韩邓彭曹曾田萧潘袁蔡蒋余于杜叶程魏苏吕丁任卢姚沈钟姜崔谭陆范汪廖石金贾夏付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤温芦康])([一-龥]{1,2})/g;
    let sm;
    while ((sm = surnamePattern.exec(text)) !== null) {
      const full = sm[0];
      const givenPart = full.slice(1); // the "name" part after surname
      // Filter out common non-name patterns
      const commonNonNameEnd = /[边说看去来过回进出在是有的得着嘛吗呢啊吧脑站迎见听见了到上下前后里外中他她它这那什么怎]/;
      const commonNonNameFull = /^(?:脑海|海上|站定|站起|走向|看向|电视|电话|封条|信任|信心|信用|广播|厂长|经理|主任|科长|组长|队长)$/;
      if (givenPart.length >= 1 && (
        commonNonNameEnd.test(givenPart[givenPart.length - 1] ?? "") ||
        commonNonNameFull.test(givenPart)
      )) {
        continue;
      }
      entities.add(full);
    }
    // Place/org suffix matches
    const placePattern = /(?:[一-龥]{2,4})(?:公司|集团|工厂|学校|医院|银行|商场|市场|小区|大厦|酒店|饭店|村|镇|县|市|省|区|路|街|巷|胡同)/g;
    let pm;
    while ((pm = placePattern.exec(text)) !== null) {
      entities.add(pm[0]);
    }
    return entities;
  };

  const currentEntities = extractEntities(chapterText);
  const previousEntities = previousText ? extractEntities(previousText) : new Set<string>();

  const newEntities = [...currentEntities].filter((e) => !previousEntities.has(e));

  // Entity overflow: only WARN, never FAIL (heuristic is imprecise)
  if (newEntities.length >= failThreshold) {
    issues.push({
      type: "new_entity_overflow",
      severity: "WARN",
      detail: `新增${newEntities.length}个疑似计划外专名/实体（阈值${failThreshold}）：${newEntities.slice(0, 10).join("、")}${newEntities.length > 10 ? "等" : ""}`,
    });
  } else if (newEntities.length >= warnThreshold) {
    issues.push({
      type: "new_entity_overflow",
      severity: "WARN",
      detail: `新增${newEntities.length}个疑似计划外专名/实体（阈值${warnThreshold}）：${newEntities.join("、")}`,
    });
  }

  return issues;
}

function checkForbiddenItemViolations(
  forbiddenItems: string,
  chapterText: string,
): ChapterScopeIssue[] {
  const issues: ChapterScopeIssue[] = [];

  if (!forbiddenItems || !forbiddenItems.trim()) return issues;

  // Strip parenthetical examples before extracting phrases
  // "禁止大段解释世界观（时代背景通过细节自然带出：BB机、存折）" → "禁止大段解释世界观"
  // "禁止某事（允许X, Y, Z）" → "禁止某事"
  const cleaned = forbiddenItems
    .replace(/[（(][^）)]*(?:示例|如|例如|比如|通过|允许|自然带出)[^）)]*[）)]/gu, "")
    .replace(/[（(][^）)]*[）)]/gu, "")  // Also strip remaining parens
    .replace(/[：:]\s*[^、,\n]+(?:[、,][^、,\n]+)*$/gmu, ""); // Strip trailing examples after colon

  const forbiddenPhrases = extractKeyPhrases(cleaned);
  // Also extract content words from negation phrases: "不暴露X" → also check "X"
  const expandedPhrases = new Set(forbiddenPhrases);
  for (const phrase of forbiddenPhrases) {
    expandedPhrases.add(phrase);
    // Strip negation prefixes
    const stripped = phrase.replace(/^(?:不|不得|禁止|严禁|不能|不可|不应)/u, "");
    if (stripped.length >= 2 && stripped !== phrase) {
      expandedPhrases.add(stripped);
    }
  }

  for (const phrase of expandedPhrases) {
    if (phrase.length < 2) continue;
    if (chapterText.includes(phrase)) {
      issues.push({
        type: "forbidden_item_violation",
        severity: "FAIL",
        detail: `禁止事项"${phrase}"出现在章节正文中`,
      });
    }
  }

  return issues;
}

/**
 * Extract keywords from pending hook notes for chapter text matching.
 * Extracts both full phrases (2-30 chars split on punctuation) and
 * short core tokens (2-8 chars, filtered against common stop words).
 */
function extractNotesKeywords(notes: string): string[] {
  // Phase 1: Full phrase extraction (3-30 chars)
  const fullPhrases = extractKeyPhrases(notes).filter((p) => p.length >= 3 || isHighSignal2Char(p));

  // Phase 2: Short core token extraction using sliding window
  const tokens: string[] = [];

  const segments = notes.split(/[,，、；;。\s\n]+/u);
  for (const segment of segments) {
    if (segment.length < 3) continue;
    if (segment.length <= 8) {
      tokens.push(segment);
      continue;
    }
    // For longer segments, extract 3-8 char windows only (drop 2-char for long segments)
    for (let w = 3; w <= 8; w += 1) {
      for (let start = 0; start <= segment.length - w; start += 1) {
        const token = segment.slice(start, start + w).trim();
        if (token.length >= 3) tokens.push(token);
      }
    }
  }

  const allPhrases = new Set([...fullPhrases, ...tokens.map((t) => t.trim()).filter((t) => t.length >= 3)]);

  // Comprehensive stop words: generic words that should never be hook keywords
  const stopWords = new Set([
    // Generic narrative terms
    "主角", "关键", "事情", "线索", "重要", "可能", "需要", "已经", "这个", "那个",
    "一些", "什么", "怎么", "为什么", "在哪里", "人物", "冲突", "资源", "开放",
    "未完成", "已完成", "进行中", "待定", "未知", "备注",
    // Family / common nouns
    "家里", "父亲", "母亲", "爸爸", "妈妈", "儿子", "女儿", "哥哥", "姐姐", "弟弟", "妹妹",
    "厂里", "车间", "家里", "门口", "客厅", "卧室", "厨房",
    // Generic items / places / background context
    "电器", "电风扇", "洗衣机", "电视机", "自行车", "摩托车",
    "棉纺", "纺织", "布料", "衣服", "鞋子", "家具",
    "棉纺厂", "纺织厂", "服装厂", "食品厂", "机械厂", "化工厂",
    "家属院", "生活区", "厂房", "车间", "仓库", "办公室",
    "生产线", "流水线", "技术科", "财务科", "供销科",
    // Generic titles/roles
    "厂长", "经理", "主任", "科长", "组长", "队长", "班长",
    "工人", "员工", "同事", "老板",
    "东西", "事情", "问题", "办法", "机会", "时间", "地方",
    // Generic verbs/actions
    "起来", "出来", "进去", "下来", "过去", "回来", "回去", "过来",
    // Economic generic terms
    "倒爷", "倒卖", "批发", "零售", "进货", "出货",
    "存钱", "赚钱", "赔钱", "借钱", "还钱", "花钱",
    "八百", "几千", "几万", "万元", "块钱",
  ]);

  return [...allPhrases].filter((p) => !stopWords.has(p) && (p.length >= 3 || isHighSignal2Char(p)));
}

/**
 * Check if a 2-char token is a high-signal word worth keeping as a hook keyword.
 * High-signal tokens: contain a CJK Unified Ideograph that is not among the
 * most common 500 characters, suggesting it's part of a proper name or rare term.
 * Also accepts tokens that match common noun-suffix patterns (e.g. XX厂, XX会).
 */
function isHighSignal2Char(token: string): boolean {
  if (token.length !== 2) return false;
  // Noun-suffix patterns: organization/event/place suffixes
  if (/[厂会局院院部组队盟商社网]$/.test(token)) return true;
  if (/^[局院商社网]/.test(token)) return true;
  // If either character is outside the top 300 most common CJK characters,
  // it's likely a name/rare term fragment worth keeping
  const commonChars = new Set(
    "的是不我一有人在这他之么下可到你中上个以们为能说也那会主要时出为然没看自日但样还如想去于其前所道将而实之与因从被后等向对已手头把话加点小本新无如里开法此样它理体当相全定度经现力动用产机前都自外家间行种实好明国后道长高你打到学进里能想多天通起都而子那面之如好样和后物从当你又见意从气知手把点前很作小最"
  );
  // Not in top common chars → rarer character → likely name fragment
  for (const ch of token) {
    if (!commonChars.has(ch)) return true;
  }
  return false;
}

/**
 * Extract key phrases from a Chinese text block.
 * Splits on commas, semicolons, Chinese punctuation, and newlines.
 */
function extractKeyPhrases(text: string): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/[,，、；;。\n]+/u)
    .map((s) => s.replace(/^[\s\-*•·]+/u, "").replace(/[\s\-*•·]+$/u, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 30);
}

/**
 * Parse a Markdown table format for pending hooks.
 * Real format:
 * | hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |
 * |---------|---------|------|------|---------|---------|---------|------|
 * | h002 | 0 | 人物 | open | - | 25 | mid-arc | 广州倒爷陈兰的名片... |
 */
function parsePendingHooksTable(
  content: string,
  currentChapter: number,
  chapterText: string,
): { tableDetected: boolean; issues: ChapterScopeIssue[] } {
  const issues: ChapterScopeIssue[] = [];

  // Find pipe-delimited table lines
  const lines = content.split(/\n/);
  const tableRows: Array<{ cells: string[]; lineIdx: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? "";
    // Match pipe-delimited table rows (skip separator lines like |---|---|)
    if (/^\|.+\|$/.test(trimmed) && !/^[\|\s\-:]+$/.test(trimmed)) {
      const cells = trimmed
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      tableRows.push({ cells, lineIdx: i });
    }
  }

  if (tableRows.length < 2) return { tableDetected: false, issues }; // Need at least header + 1 row

  // Parse header to find column indices
  const header = tableRows[0]?.cells ?? [];
  const colMap: Record<string, number> = {};
  for (let ci = 0; ci < header.length; ci += 1) {
    const colName = header[ci]?.trim().toLowerCase() ?? "";
    colMap[colName] = ci;
  }

  // Find column indices for relevant fields (case-insensitive, trim whitespace)
  const payoffIdx = findColumnIndex(header, ["预期回收", "expected payoff", "回收章", "payoff chapter"]);
  const notesIdx = findColumnIndex(header, ["备注", "notes", "内容", "content", "描述", "description"]);
  const statusIdx = findColumnIndex(header, ["状态", "status"]);
  const hookIdIdx = findColumnIndex(header, ["hook_id", "hook id", "id"]);
  const startChapterIdx = findColumnIndex(header, ["起始章节", "start chapter", "起始", "start"]);
  const recentProgressIdx = findColumnIndex(header, ["最近推进", "recent progress", "最近", "recent"]);

  if (payoffIdx < 0) return { tableDetected: true, issues }; // Can't determine payoff chapters

  // Parse data rows
  for (let ri = 1; ri < tableRows.length; ri += 1) {
    const cells = tableRows[ri]?.cells ?? [];
    if (cells.length === 0) continue;

    const payoffRaw = cells[payoffIdx]?.trim() ?? "";
    const payoffChapter = parsePayoffChapter(payoffRaw);

    // Skip if payoff is null, 待定, empty, or <= current chapter
    if (payoffChapter === null || payoffChapter <= currentChapter) continue;

    // Check if this hook is naturally in-progress at current chapter.
    // Only consider it "in-progress" if 最近推进 explicitly mentions current chapter.
    let isInProgressAtCurrentChapter = false;
    if (recentProgressIdx >= 0) {
      const recentRaw = cells[recentProgressIdx]?.trim() ?? "";
      const chPattern = new RegExp(`[Cc]h[.\\s]*${currentChapter}\\b|第\\s*${currentChapter}\\s*章`, "u");
      if (chPattern.test(recentRaw)) {
        isInProgressAtCurrentChapter = true;
      }
    }

    // Skip closed/resolved hooks
    if (statusIdx >= 0) {
      const status = (cells[statusIdx]?.trim() ?? "").toLowerCase();
      if (status === "closed" || status === "resolved" || status === "done" || status === "已回收") {
        continue;
      }
    }

    // Extract keywords from notes column and hook_id column
    const keywords: string[] = [];

    if (notesIdx >= 0) {
      const notes = cells[notesIdx]?.trim() ?? "";
      if (notes) {
        // Extract both long phrases and short core tokens from notes
        keywords.push(...extractNotesKeywords(notes));
      }
    }

    if (hookIdIdx >= 0) {
      const hookId = cells[hookIdIdx]?.trim() ?? "";
      if (hookId) keywords.push(hookId);
    }

    // Check if any keyword appears in chapter text
    for (const kw of keywords) {
      if (kw.length < 2) continue;
      if (chapterText.includes(kw)) {
        // Check for completion markers to decide severity
        const completionMarkers = /完成|成功|实现|达成|拿到|得到|获得|已经|终于|解决|化解|消除|处理|搞定/;
        const hasCompletion = completionMarkers.test(
          chapterText.slice(
            Math.max(0, chapterText.indexOf(kw) - 50),
            Math.min(chapterText.length, chapterText.indexOf(kw) + kw.length + 50),
          ),
        );

        // If hook is naturally in-progress at current chapter, only flag with completion markers
        if (isInProgressAtCurrentChapter && !hasCompletion) {
          continue;
        }

        issues.push({
          type: "premature_hook_fulfillment",
          severity: hasCompletion ? "FAIL" : (isInProgressAtCurrentChapter ? "WARN" : "WARN"),
          detail: `伏笔 keyword "${kw}"（预期回收在第${payoffChapter}章）在第${currentChapter}章${hasCompletion ? "疑似被明显兑现" : "已出现"}`,
        });
        break; // One issue per hook row
      }
    }
  }

  return { tableDetected: true, issues };
}

/**
 * Find a column index by matching candidate header names (case-insensitive).
 */
function findColumnIndex(header: string[], candidates: string[]): number {
  const lowerHeader = header.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lowerHeader.indexOf(candidate.toLowerCase());
    if (idx >= 0) return idx;
  }
  // Fuzzy match: check if any header contains the candidate string
  for (const candidate of candidates) {
    const idx = lowerHeader.findIndex((h) => h.includes(candidate.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Parse payoff chapter from various formats:
 * "25" → 25
 * "第25章" → 25
 * "Ch25" → 25
 * "待定" → null
 * "" → null
 */
function parsePayoffChapter(raw: string): number | null {
  if (!raw || raw.trim() === "") return null;
  const trimmed = raw.trim();

  // Skip placeholder values
  if (/^(待定|未知|unk|unknown|n\/a|-|–|—)$/iu.test(trimmed)) return null;

  // Try "第N章"
  const chineseMatch = trimmed.match(/第\s*(\d+)\s*章/u);
  if (chineseMatch?.[1]) return Number.parseInt(chineseMatch[1], 10);

  // Try "ChN" or "Chapter N"
  const engMatch = trimmed.match(/[Cc]h(?:apter)?[.\s]*(\d+)/);
  if (engMatch?.[1]) return Number.parseInt(engMatch[1], 10);

  // Try plain number
  const numMatch = trimmed.match(/(\d+)/);
  if (numMatch?.[1]) return Number.parseInt(numMatch[1], 10);

  return null;
}

/**
 * Extract hook-specific key phrases from a hook entry.
 */
function extractHookPhrases(hookSection: string): string[] {
  // Extract quoted phrases and key terms
  const phrases: string[] = [];
  // Quoted terms
  const quoted = hookSection.match(/[「「""]([^」」""]{2,10})[」」""]/g);
  if (quoted) {
    for (const q of quoted) {
      phrases.push(q.replace(/[「「""」」""]/g, ""));
    }
  }
  // Bold/emphasized terms
  const bold = hookSection.match(/\*\*([^*]{2,10})\*\*/g);
  if (bold) {
    for (const b of bold) {
      phrases.push(b.replace(/\*\*/g, ""));
    }
  }
  // If no quoted/bold terms found, extract from the first line as the hook name
  if (phrases.length === 0) {
    const firstLine = hookSection.split("\n")[0]?.replace(/^[#\-\s*]+/u, "").trim();
    if (firstLine && firstLine.length >= 2 && firstLine.length <= 30) {
      phrases.push(firstLine);
    }
  }
  return phrases;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract a field value that may span multiple lines with indented continuation.
 *
 * Handles formats like:
 *   - 未解决问题：
 *     1. first item
 *     2. second item
 *   - 禁止事项：
 *     - item one
 *     - item two
 *
 * Also handles single-line format:
 *   未解决问题：单行内容
 */
function extractMultilineField(section: string, labelPattern: RegExp): string {
  const lines = section.split(/\n/);
  let collecting = false;
  const collected: string[] = [];
  let baseIndent = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmedLine = line.trim();

    if (!collecting) {
      const match = labelPattern.exec(line);
      if (match) {
        collecting = true;
        // Get content after the label on the same line
        const afterLabel = line.slice(match.index + match[0].length).trim();
        if (afterLabel) {
          collected.push(afterLabel);
        }
        // Calculate base indentation
        baseIndent = line.length - line.trimStart().length;
      }
    } else {
      // Stop at next section header, blank line followed by non-indented content, or new field label
      if (/^##\s/u.test(trimmedLine)) break;
      if (trimmedLine === "") {
        // Empty line: stop if the next non-empty line is not indented continuation
        continue;
      }
      const lineIndent = line.length - line.trimStart().length;

      // Check if this is a new field label (bullet starting with "xxx：" pattern)
      if (lineIndent <= baseIndent && /^[-*]\s+[^\s]/.test(trimmedLine) && !/^\d+[.、)]/.test(trimmedLine)) {
        break;
      }
      // Check if this line starts with a non-indented new bullet that's not a continuation
      // (continuation lines are indented relative to the base, or are numbered sub-items)
      if (lineIndent <= baseIndent && !/^\d+[.、)]/.test(trimmedLine) && !/^[-*]\s/.test(trimmedLine)) {
        // Non-indented, non-list line → stop
        if (trimmedLine.length > 0) break;
      }

      // This is a continuation line
      collected.push(trimmedLine);
    }
  }

  return collected.join("\n").trim();
}

/**
 * Build a chapter-scope constraint block specifically for limiting
 * structure_signals.json usage in repair contexts.
 */
export function buildStructureSignalsScopeConstraint(
  intentContent: string,
): string {
  const boundaries = parseChapterScopeBoundaries(intentContent);
  return [
    "【书级结构信号使用约束】",
    "书级 structure_signals.json 中的信号词是全书参考词汇，不是当前章必须全部命中的素材。",
    "结构修复只能使用与当前章节 intent 明确相关的 signals。",
    "不得为了命中书级 signals 而提前引入未来人物、未来资源、未来敌人或未来收益。",
    boundaries.surfaceGoal ? `当前章目标：${boundaries.surfaceGoal}` : "",
    "仅使用与上述目标直接相关的结构信号词。",
  ].filter(Boolean).join("\n");
}

/**
 * Build a hard input boundary block for repair-stage prompts
 * (plot-fix, quality-fix, polish). Prevents the LLM from treating
 * future-chapter material as writable content.
 */
export function buildChapterRepairBoundaryBlock(intentContent: string): string {
  const boundaries = parseChapterScopeBoundaries(intentContent);
  const parts = [
    "【修稿输入边界 — 硬性约束】",
    "",
    "你只能使用当前章节已有的事件、人物、场景、冲突进行修复。",
    "",
  ];

  if (boundaries.surfaceGoal) {
    parts.push(`本章唯一目标：${boundaries.surfaceGoal}`);
    parts.push("");
  }

  parts.push(
    "== 允许 ==",
    "- 扩写/重排/润色当前章已有事件和对话。",
    "- 增强当前章已出现的冲突、反转、代价、收益。",
    "- 用当前章已有素材补 Hook / Pressure / Payoff / Pull。",
    "- 强化章尾拉力（基于当前章已有线索）。",
    "",
    "== 禁止 ===",
    "- 禁止从后续章节计划中提取任何新剧情写入当前章。",
    "- 禁止把 pending_hooks 中预期回收章大于当前章的伏笔，当成可写素材。",
    "- 禁止把书级 structure_signals 中未出现在当前章 intent §12 的信号词，新增为正文内容。",
    "- 禁止引入未来人物、未来资源、未来地点、未来势力。",
    "- 禁止为了补字数而新增后续章节事件。",
  );

  if (boundaries.forbiddenItems) {
    parts.push(`- 本章禁止事项：${boundaries.forbiddenItems}`);
  }
  if (boundaries.nextChapterDirection) {
    parts.push(`- 以下方向属于下一章目标，本章不得提前完成：${boundaries.nextChapterDirection}`);
  }
  if (boundaries.unresolvedProblems) {
    parts.push(`- 以下问题不得在本章解决：${boundaries.unresolvedProblems}`);
  }

  parts.push(
    "",
    "== 关于报告/信号的说明 ==",
    "- structure signals / six-step-plot / story-effectiveness 报告是审核器使用的维度，不是要求你把所有关键词写进正文。",
    "- 报告中提到的缺失项，只能用当前章已有素材补强。",
    "- 报告中出现的未来 hook / future signal / 下一章方向，不得写入正文。",
    "- 如果必须牺牲某项结构维度来守住边界，优先守住边界。",
  );

  return parts.join("\n");
}
