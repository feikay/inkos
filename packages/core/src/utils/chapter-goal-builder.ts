import type { HookAgenda, ChapterGoal, EndingHookType, PayoffDirective, PayoffType } from "../models/input-governance.js";
import type { StoredHook } from "../state/memory-db.js";
import { parseChapterSummariesMarkdown, parseCurrentStateFacts, parsePendingHooksMarkdown } from "./story-markdown.js";
import type {
  ArcMapSummary,
  GenreProfileSummary,
  PowerSystemSummary,
} from "./webnovel-inputs.js";

interface RegistryHookRecord {
  readonly hookId?: string;
  readonly startChapter?: number;
  readonly type?: string;
  readonly status?: string;
  readonly lastAdvancedChapter?: number;
  readonly expectedPayoff?: string;
  readonly payoffTiming?: string;
  readonly notes?: string;
}

export interface BuildChapterGoalInput {
  readonly language: "zh" | "en";
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode?: string;
  readonly currentFocus: string;
  readonly currentState: string;
  readonly chapterSummaries: string;
  readonly pendingHooksRaw: string;
  readonly foreshadowRegistryRaw: string;
  readonly hookAgenda: HookAgenda;
  readonly selectedHooks?: ReadonlyArray<StoredHook>;
  readonly protagonistName?: string;
  readonly arcMap: ArcMapSummary;
  readonly genreProfile: GenreProfileSummary;
  readonly powerSystem: PowerSystemSummary;
}

interface ChapterGoalHook {
  readonly hookId: string;
  readonly type: string;
  readonly status: string;
  readonly startChapter: number;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff: string;
  readonly notes: string;
}

export function buildChapterGoal(input: BuildChapterGoalInput): ChapterGoal {
  const stateFacts = parseCurrentStateFacts(input.currentState, input.chapterNumber);
  const registryHooks = parseForeshadowRegistry(input.foreshadowRegistryRaw);
  const hooks = registryHooks.length > 0
    ? registryHooks
    : resolveChapterGoalHooks(
      input.foreshadowRegistryRaw,
      input.pendingHooksRaw,
      input.selectedHooks,
    );
  const hooksById = new Map(hooks.map((hook) => [hook.hookId, hook]));
  const agendaHookIds = unique([
    ...input.hookAgenda.eligibleResolve,
    ...input.hookAgenda.mustAdvance,
    ...input.hookAgenda.staleDebt,
  ]);
  const foreshadowToTouch = [
    ...agendaHookIds.filter((hookId) => hooksById.has(hookId)),
    ...(agendaHookIds.length === 0 || !agendaHookIds.some((hookId) => hooksById.has(hookId))
      ? hooks
        .filter((hook) => !/^(resolved|closed|done|已回收|已解决)$/i.test(hook.status))
        .sort((left, right) => left.lastAdvancedChapter - right.lastAdvancedChapter || left.startChapter - right.startChapter)
        .map((hook) => hook.hookId)
      : []),
  ].slice(0, 2);

  const mainConflict = pickFirstMeaningfulChapterGoalText([
    findStateFact(stateFacts, input.language, ["current conflict", "当前冲突"]),
    findStateFact(stateFacts, input.language, ["first conflict", "第一个冲突", "首个冲突"]),
    extractLabeledSection(input.currentFocus, input.language, ["当前冲突来源", "conflict source", "conflict sources"]),
    extractChapterFocusField(input.currentFocus, input.chapterNumber, input.language, [
      "核心冲突",
      "主角困境",
      "困境",
      "阻碍困境",
      "冲突",
      "core conflict",
      "dilemma",
      "obstacle",
    ]),
    input.outlineNode,
    input.arcMap.goalHint,
    input.goal,
  ]) ?? defaultSentence(
    input.language,
    "Keep the chapter centered on a single escalating conflict.",
    "让本章围绕一条清晰升级的核心冲突推进。",
  );

  const protagonistGoal = pickFirstMeaningfulChapterGoalText([
    findStateFact(stateFacts, input.language, ["current goal", "当前目标"]),
    input.goal,
    input.outlineNode,
    input.arcMap.goalHint,
  ]) ?? defaultSentence(
    input.language,
    "Secure one tangible step forward before the chapter closes.",
    "在本章结束前拿到一个看得见的推进结果。",
  );

  const activeCharacters = selectActiveCharacters({
    language: input.language,
    chapterSummaries: input.chapterSummaries,
    currentState: input.currentState,
    protagonistName: input.protagonistName,
    texts: [
      protagonistGoal,
      mainConflict,
      extractChapterFocusBlock(input.currentFocus, input.chapterNumber).join("\n"),
      input.currentState,
      input.outlineNode,
      ...foreshadowToTouch.map((hookId) => hooksById.get(hookId)?.notes),
    ],
  });

  const payoffHook = foreshadowToTouch
    .map((hookId) => hooksById.get(hookId))
    .find((hook): hook is ChapterGoalHook => Boolean(hook && hook.expectedPayoff.trim()));
  const payoffToDeliver = derivePayoffToDeliver({
    language: input.language,
    protagonistGoal,
    goal: input.goal,
    mainConflict,
    outlineNode: input.outlineNode,
    currentState: input.currentState,
    chapterSummaries: input.chapterSummaries,
    currentFocus: input.currentFocus,
    chapterNumber: input.chapterNumber,
    stateFacts,
    payoffHook,
    genreProfile: input.genreProfile,
  });

  const endingHookType = inferEndingHookType({
    goal: input.goal,
    protagonistGoal,
    mainConflict,
    payoffToDeliver,
    genreProfile: input.genreProfile,
  });
  const nextChapterPull = buildNextChapterPull({
    language: input.language,
    endingHookType,
    foreshadowToTouch,
    hooksById,
    payoffToDeliver,
    arcMapDirective: input.arcMap.arcDirective,
    chapterEndingHook: extractChapterFocusField(input.currentFocus, input.chapterNumber, input.language, [
      "章节结尾钩子",
      "结尾钩子",
      "Ending hook",
      "Chapter ending hook",
    ]),
  });

  return {
    mainConflict: sanitizeChapterGoalText(mainConflict) ?? defaultSentence(
      input.language,
      "Keep the chapter centered on a single escalating conflict.",
      "让本章围绕一条清晰升级的核心冲突推进。",
    ),
    protagonistGoal: sanitizeChapterGoalText(protagonistGoal) ?? defaultSentence(
      input.language,
      "Secure one tangible step forward before the chapter closes.",
      "在本章结束前拿到一个看得见的推进结果。",
    ),
    activeCharacters,
    foreshadowToTouch,
    payoffToDeliver: sanitizeChapterGoalText(payoffToDeliver) ?? defaultConcretePayoff(input.language, [
      protagonistGoal,
      input.goal,
      mainConflict,
      input.outlineNode,
      input.currentState,
      input.chapterSummaries,
    ], input.genreProfile),
    payoffDirective: buildPayoffDirective(
      sanitizeChapterGoalText(payoffToDeliver) ?? defaultConcretePayoff(input.language, [
        protagonistGoal,
        input.goal,
        mainConflict,
        input.outlineNode,
        input.currentState,
        input.chapterSummaries,
      ], input.genreProfile),
      input.genreProfile,
    ),
    endingHookType,
    nextChapterPull: sanitizeChapterGoalText(nextChapterPull) ?? defaultSentence(
      input.language,
      "The chapter ends with pressure that immediately rolls into the next beat.",
      "本章结尾要留下会立刻推到下章的压力。",
    ),
  };
}

function buildPayoffDirective(promisedPayoff: string, genreProfile?: GenreProfileSummary, wordBudget?: number): PayoffDirective {
  const payoffType = inferPayoffType(promisedPayoff, genreProfile);
  const payoffDepth = inferPayoffDepth(promisedPayoff, payoffType);
  const payoffScope = payoffDepth === "layered" ? "arc" : "chapter";
  const directive: PayoffDirective = {
    promisedPayoff,
    payoffType,
    payoffDepth,
    payoffScope,
    mandatoryByFinalAct: payoffScope === "chapter",
  };

  // Apply word-budget compaction for standard ~1000-word chapters
  const budget = wordBudget ?? 1000;
  if (budget <= 1500) {
    const language = /[一-鿿]/.test(promisedPayoff) ? "zh" as const : "en" as const;
    const compacted = compactPayoffForWordBudget(promisedPayoff, language, budget, genreProfile);
    if (compacted.payoff !== promisedPayoff) {
      directive.promisedPayoff = compacted.payoff;
      directive.payoffDepth = compacted.depth;
      directive.payoffScope = compacted.scope;
      directive.mandatoryByFinalAct = compacted.scope === "chapter";
    }
  }

  return directive;
}

function inferPayoffDepth(payoff: string, payoffType: PayoffType): PayoffDirective["payoffDepth"] {
  if (payoffType === "reveal" && /全部|彻底|完整|一次说清|all\b|complete\b|full\b/i.test(payoff)) {
    return "deep";
  }
  return "layered";
}

/**
 * Compact an over-ambitious payoff promise to fit within a typical chapter word budget.
 * Chapters target ~1000 Chinese characters (728-1272 range).
 * Arc-level / situational payoffs are downgraded to atomic, concrete, achievable sub-elements.
 */
function compactPayoffForWordBudget(
  payoff: string,
  language: "zh" | "en",
  wordBudget?: number,
  genreProfile?: GenreProfileSummary,
): { payoff: string; depth: PayoffDirective["payoffDepth"]; scope: PayoffDirective["payoffScope"] } {
  const budget = wordBudget ?? 1000;
  const payoffType = inferPayoffType(payoff, genreProfile);

  // Chapters with sufficient word budget can support layered/arc payoffs
  if (budget > 1500) {
    return { payoff, depth: inferPayoffDepth(payoff, payoffType), scope: payoffType === "reversal" ? "arc" : "chapter" };
  }

  // For standard ~1000-char chapters, detect and compact over-ambitious payoffs
  if (language === "zh") {
    // Situational reversal: "局势发生反转", "战局逆转", "翻盘" → atomic tactical advantage
    if (payoffType === "reversal" && /反转|逆转|翻盘|局势|局面|战局|态势|扭转乾坤|反败为胜|逆袭/u.test(payoff)) {
      const compacted = /逃|脱身|脱离|甩开|拉开距离|突围|冲出/u.test(payoff)
        ? "获得一次暂时脱身或战术喘息"
        : "拿到一个局部战术优势或喘息窗口";
      return { payoff: compacted, depth: inferPayoffDepth(payoff, payoffType), scope: "chapter" };
    }

    // Deep reveal: "查明真相", "完整揭示" → atomic clue discovery
    if (payoffType === "reveal" && /真相|全部揭开|完整揭示|彻底查明|水落石出/u.test(payoff)) {
      return {
        payoff: payoff.replace(/真相|全部揭开|完整揭示|彻底查明|水落石出/gu, "可追踪的新线索").replace(/被当场揭开/gu, "露出可追踪的痕迹"),
        depth: inferPayoffDepth(payoff, payoffType),
        scope: "chapter",
      };
    }

    // Major breakthrough: "突破境界", "觉醒能力", "掌握新力量" → incremental progress
    if (payoffType === "breakthrough" && /突破|晋升|觉醒|晋阶|打通|领悟/u.test(payoff)) {
      return {
        payoff: payoff.replace(/突破(境界|瓶颈)?/gu, "取得突破性进展").replace(/觉醒/gu, "触动").replace(/晋阶/gu, "积累"),
        depth: inferPayoffDepth(payoff, payoffType),
        scope: "chapter",
      };
    }

    // Relationship payoff: "建立信任", "结盟" → atomic trust gesture
    if (payoffType === "relationship" && /结盟|联手|信任|归心|效忠|托付终身/u.test(payoff)) {
      return { payoff: "获得一个可信的合作信号或试探性让步", depth: inferPayoffDepth(payoff, payoffType), scope: "chapter" };
    }
  } else {
    if (payoffType === "reversal" && /reversal|turn the tide|flip the situation|reverse the battle/i.test(payoff)) {
      return { payoff: "Secure a tactical advantage or breathing room.", depth: inferPayoffDepth(payoff, payoffType), scope: "chapter" };
    }
    if (payoffType === "reveal" && /key clue|full truth|complete reveal|uncover everything/i.test(payoff)) {
      return { payoff: "Discover one trackable new lead.", depth: inferPayoffDepth(payoff, payoffType), scope: "chapter" };
    }
    if (payoffType === "breakthrough" && /breakthrough|awaken|ascend|master/i.test(payoff)) {
      return { payoff: "Make incremental progress toward a breakthrough.", depth: inferPayoffDepth(payoff, payoffType), scope: "chapter" };
    }
    if (payoffType === "relationship" && /alliance|trust|swear loyalty|bond/i.test(payoff)) {
      return { payoff: "Obtain a credible signal of cooperation.", depth: inferPayoffDepth(payoff, payoffType), scope: "chapter" };
    }
  }

  const depth = inferPayoffDepth(payoff, payoffType);
  return { payoff, depth, scope: depth === "layered" ? "arc" : "chapter" };
}

function inferPayoffType(payoff: string, genreProfile?: GenreProfileSummary): PayoffType {
  const allowsPowerBreakthrough = genreProfile?.powerScaling !== false;
  if (
    /真相|来历|来源|身份|揭开|揭示|发现|查明|确认|坐实|线索|秘密|origin|source|truth|reveal|confirm|confirmed|identity|clue/i.test(payoff)
    || /(?:找到|锁定|明确|识别|摸清|看清).{0,12}(?:机会|方向|路径|来源|入口|办法|方案|突破口|可行性|信息差|赚钱门路|商机)/u.test(payoff)
    || /\b(?:find|identify|lock|discover|locate|pin down).{0,32}(?:opportunity|path|source|route|lead|opening|plan|way|approach|angle)\b/i.test(payoff)
  ) {
    return "reveal";
  }
  if (/获得|拿到|夺得|资源|地图|腰牌|卷轴|残卷|药材|灵石|resource|obtain|gain|map|token|scroll/i.test(payoff)) {
    return "resource";
  }
  if (!allowsPowerBreakthrough && /突破口|缺口|切入口|现实路径|合作入口|practical opening|path/i.test(payoff)) {
    return "reveal";
  }
  if (allowsPowerBreakthrough && /突破|晋阶|掌握|觉醒|学会|压住|稳住|新能力|breakthrough|master|awaken|stabilize|new ability/i.test(payoff)) {
    return "breakthrough";
  }
  if (/信任|和解|关系|告白|结盟|relationship|trust|bond|reconcile|alliance/i.test(payoff)) {
    return "relationship";
  }
  return "reversal";
}

function resolveChapterGoalHooks(
  foreshadowRegistryRaw: string,
  pendingHooksRaw: string,
  selectedHooks: ReadonlyArray<StoredHook> | undefined,
): ChapterGoalHook[] {
  const registryHooks = parseForeshadowRegistry(foreshadowRegistryRaw);
  if (registryHooks.length > 0) {
    return registryHooks;
  }

  if (selectedHooks !== undefined) {
    return selectedHooks.map(normalizeStoredHook);
  }

  const pendingHooks = parsePendingHooksMarkdown(pendingHooksRaw);
  if (pendingHooks.length > 0) {
    return pendingHooks.map(normalizeStoredHook);
  }

  return [];
}

function parseForeshadowRegistry(raw: string): ChapterGoalHook[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeRegistryHook(entry))
      .filter((entry): entry is ChapterGoalHook => entry !== null);
  } catch {
    return [];
  }
}

function normalizeRegistryHook(entry: unknown): ChapterGoalHook | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const hook = entry as RegistryHookRecord;
  const hookId = typeof hook.hookId === "string" ? hook.hookId.trim() : "";
  if (!hookId) {
    return null;
  }

  return {
    hookId,
    type: typeof hook.type === "string" ? hook.type.trim() : "",
    status: typeof hook.status === "string" ? hook.status.trim() : "open",
    startChapter: normalizeInteger(hook.startChapter),
    lastAdvancedChapter: normalizeInteger(hook.lastAdvancedChapter),
    expectedPayoff: sanitizePayoffText(typeof hook.expectedPayoff === "string" ? hook.expectedPayoff.trim() : "") ?? "",
    notes: typeof hook.notes === "string" ? hook.notes.trim() : "",
  };
}

function normalizeStoredHook(hook: StoredHook): ChapterGoalHook {
  return {
    hookId: hook.hookId,
    type: hook.type,
    status: hook.status,
    startChapter: hook.startChapter,
    lastAdvancedChapter: hook.lastAdvancedChapter,
    expectedPayoff: sanitizePayoffText(hook.expectedPayoff) ?? "",
    notes: hook.notes,
  };
}

function normalizeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function findStateFact(
  facts: ReturnType<typeof parseCurrentStateFacts>,
  language: "zh" | "en",
  labels: ReadonlyArray<string>,
): string | undefined {
  const normalizedLabels = labels.map((label) => normalizeText(label));
  const fact = facts.find((item) => normalizedLabels.includes(normalizeText(item.predicate)));
  if (!fact?.object) return undefined;
  return language === "zh" ? fact.object.replace(/^当前[目标冲突]\s*[:：]?\s*/u, "") : fact.object;
}

function extractLabeledSection(
  content: string,
  language: "zh" | "en",
  headings: ReadonlyArray<string>,
): string | undefined {
  const lines = content.split("\n");
  const normalizedHeadings = headings.map((heading) => normalizeText(heading));
  let active = false;
  let matchedLevel = 0;
  const buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#+)\s*(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = normalizeText(headingMatch[2] ?? "");
      if (normalizedHeadings.includes(heading)) {
        active = true;
        matchedLevel = level;
        continue;
      }
      if (active && level <= matchedLevel) {
        break;
      }
    }

    if (!active) continue;
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cleaned = trimmed.replace(/^-\s*/, "").trim();
    if (cleaned) {
      buffer.push(cleaned);
    }
  }

  if (buffer.length > 0) {
    return buffer.slice(0, 2).join(language === "zh" ? "；" : "; ");
  }

  return extractFirstDirective(content);
}

function extractChapterFocusField(
  currentFocus: string,
  chapterNumber: number,
  language: "zh" | "en",
  labels: ReadonlyArray<string>,
): string | undefined {
  const blockLines = extractChapterFocusBlock(currentFocus, chapterNumber);
  if (blockLines.length === 0) return undefined;

  const normalizedLabels = labels.map((label) => normalizeText(label));
  const fieldPattern = /^[-*]?\s*(?:\*\*)?([^：:]+?)(?:\*\*)?\s*[：:]\s*(.+)$/u;

  for (const rawLine of blockLines) {
    const line = rawLine.trim().replace(/^[-*]\s*/, "").trim();
    const match = line.match(fieldPattern);
    if (!match) continue;
    const label = normalizeText(match[1] ?? "");
    if (!normalizedLabels.includes(label)) continue;
    const value = sanitizeChapterGoalText(match[2]);
    if (value) return value;
  }

  void language;
  return undefined;
}

function extractChapterFocusBlock(currentFocus: string, chapterNumber: number): string[] {
  const chapterPattern = new RegExp(`第\\s*${chapterNumber}\\s*章`, "u");
  const nextChapterPattern = /第\s*\d+\s*章/u;
  const lines = currentFocus.split("\n");
  let inBlock = false;
  const blockLines: string[] = [];

  for (const line of lines) {
    if (!inBlock && chapterPattern.test(line)) {
      inBlock = true;
      blockLines.push(line);
      continue;
    }
    if (!inBlock) continue;

    if ((nextChapterPattern.test(line) && !chapterPattern.test(line)) || /^##\s/.test(line)) {
      break;
    }
    blockLines.push(line);
  }

  return blockLines;
}

function extractFirstDirective(content?: string): string | undefined {
  if (!content) return undefined;
  return content
    .split("\n")
    .map((line) => line.trim())
    .find((line) =>
      line.length > 0
      && !line.startsWith("#")
      && !line.startsWith("-")
      && !/^\(.+\)$/u.test(line),
    );
}

function selectActiveCharacters(input: {
  readonly language: "zh" | "en";
  readonly chapterSummaries: string;
  readonly currentState: string;
  readonly protagonistName?: string;
  readonly texts: ReadonlyArray<string | undefined>;
}): string[] {
  const protagonistName = sanitizeCharacterCandidateForLanguage(input.protagonistName, input.language);
  const structuredCandidates = input.language === "zh"
    ? extractSummaryCharacterCandidates(input.chapterSummaries)
    : [
      ...extractEnglishSummaryCharacterCandidates(input.chapterSummaries),
      ...extractSummaryCharacterCandidates(input.chapterSummaries),
    ];
  const structuredUnique = normalizeProtagonistCandidateNames(
    unique(structuredCandidates),
    protagonistName,
    input.language,
  ).slice(0, 4);
  if (structuredUnique.length > 0) {
    return structuredUnique;
  }

  const candidates = input.language === "zh"
    ? extractChineseCharacterCandidates(input.texts)
    : [
      ...extractEnglishCharacterCandidates(input.texts),
      ...extractChineseCharacterCandidates(input.texts),
    ];
  const uniqueCandidates = normalizeProtagonistCandidateNames(
    unique(candidates),
    protagonistName,
    input.language,
  ).slice(0, 4);

  if (uniqueCandidates.length > 0) {
    return uniqueCandidates;
  }

  return [protagonistName ?? (input.language === "zh" ? "主角" : "protagonist")];
}

function normalizeProtagonistCandidateNames(
  candidates: ReadonlyArray<string>,
  protagonistName: string | undefined,
  language: "zh" | "en",
): string[] {
  if (!protagonistName) {
    return [...candidates];
  }
  const genericRole = language === "zh" ? "主角" : "protagonist";
  const normalized = unique(candidates.map((candidate) =>
    candidate.trim().toLowerCase() === genericRole.toLowerCase()
      ? protagonistName
      : candidate,
  ));
  if (language === "zh" && normalized.length === 0 && protagonistName) {
    return [protagonistName];
  }
  return normalized;
}

function sanitizeCharacterCandidateForLanguage(
  candidate: string | undefined,
  language: "zh" | "en",
): string | undefined {
  if (!candidate) return undefined;
  return language === "zh"
    ? sanitizeChineseCharacterCandidate(candidate)
    : sanitizeEnglishCharacterCandidate(candidate) ?? sanitizeChineseCharacterCandidate(candidate);
}

function extractSummaryCharacterCandidates(chapterSummaries: string): string[] {
  const summaries = parseChapterSummariesMarkdown(chapterSummaries)
    .sort((left, right) => left.chapter - right.chapter)
    .slice(-3);

  return summaries.flatMap((summary) =>
    splitCharacterField(summary.characters)
      .map((candidate) => sanitizeChineseCharacterCandidate(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
}

function extractEnglishSummaryCharacterCandidates(chapterSummaries: string): string[] {
  const summaries = parseChapterSummariesMarkdown(chapterSummaries)
    .sort((left, right) => left.chapter - right.chapter)
    .slice(-3);

  return summaries.flatMap((summary) =>
    splitCharacterField(summary.characters)
      .map((candidate) => sanitizeEnglishCharacterCandidate(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
}

function splitCharacterField(value: string): string[] {
  return value
    .split(/,|，|、|\/|;|；/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractChineseCharacterCandidates(texts: ReadonlyArray<string | undefined>): string[] {
  const results: string[] = [];
  const stableRoleTitles = ["主角", "碑灵", "守卫", "追兵", "守门人", "掌柜", "长老", "师父", "师兄", "师姐", "族老"];

  for (const text of texts) {
    if (!text) continue;
    if (isStructuredControlText(text)) continue;

    const cueMatches = [
      ...text.matchAll(/(?:^|[，。；、\s])([\u4e00-\u9fff]{2,3})(?:先|必须|正在|仍|刚|又|已|会|想|准备|试图|决定|需要)/gu),
      ...text.matchAll(/(?:与|和|找|见|救|护|问|面对|联手|拦住|遇见|撞见)([\u4e00-\u9fff]{2,3})(?=确认|会合|联手|开口|现身|出手|出现|留下|$|[，。；、])/gu),
      ...text.matchAll(/([\u4e00-\u9fff]{2,3})(?:说道|开口|现身|出手|追来|拦住|赶到|出现|留下)/gu),
      ...text.matchAll(/(?:角色|人物|主角|配角)[:：]\s*([\u4e00-\u9fff]{2,4})/gu),
      ...text.matchAll(/(?:^|[，。；、\s])(主角|碑灵|守卫|追兵|守门人|掌柜|长老|师父|师兄|师姐|族老)(?=$|[，。；、\s])/gu),
    ];
    for (const match of cueMatches) {
      const candidate = (match[1] ?? "").trim();
      const sanitized = stableRoleTitles.includes(candidate)
        ? candidate
        : sanitizeChineseCharacterCandidate(candidate);
      if (sanitized) {
        results.push(sanitized);
      }
    }
  }

  return results;
}

function extractEnglishCharacterCandidates(texts: ReadonlyArray<string | undefined>): string[] {
  const results: string[] = [];
  const stopwords = new Set([
    "Current",
    "Current Focus",
    "Active Focus",
    "Current State",
    "Chapter",
    "Volume",
    "Goal",
    "Conflict",
    "Outline",
    "Field",
    "Value",
  ]);

  for (const text of texts) {
    if (!text) continue;
    if (isStructuredControlText(text)) continue;
    const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
    for (const match of matches) {
      const sanitized = sanitizeEnglishCharacterCandidate(match);
      if (sanitized && !stopwords.has(sanitized)) {
        results.push(sanitized);
      }
    }
  }

  return results;
}

function derivePayoffToDeliver(input: {
  readonly language: "zh" | "en";
  readonly protagonistGoal: string;
  readonly goal: string;
  readonly mainConflict: string;
  readonly outlineNode?: string;
  readonly currentState: string;
  readonly chapterSummaries: string;
  readonly currentFocus: string;
  readonly chapterNumber: number;
  readonly stateFacts: ReturnType<typeof parseCurrentStateFacts>;
  readonly payoffHook?: ChapterGoalHook;
  readonly genreProfile?: GenreProfileSummary;
}): string {
  const chapterHookPayoff = extractChapterEndingPayoff(
    input.currentFocus,
    input.chapterNumber,
    input.language,
  );
  if (chapterHookPayoff) {
    return chapterHookPayoff;
  }

  const firstConflictPayoff = extractCrisisPayoffFromState(input.stateFacts, input.language);
  if (firstConflictPayoff) {
    return firstConflictPayoff;
  }

  const hookPayoff = sanitizePayoffText(input.payoffHook?.expectedPayoff);
  if (hookPayoff) {
    return hookPayoff;
  }

  const hookNotes = sanitizePayoffText(input.payoffHook?.notes);
  if (hookNotes) {
    return hookNotes;
  }

  const directSignal = sanitizePayoffText(
    pickDirectPayoffSignal(input.protagonistGoal)
      ?? pickDirectPayoffSignal(input.goal)
      ?? pickDirectPayoffSignal(input.mainConflict),
  );
  if (directSignal) {
    return directSignal;
  }

  const stateSignal = sanitizePayoffText(
    pickStateDeltaPayoffSignal(input.stateFacts, input.currentState),
  );
  if (stateSignal) {
    return stateSignal;
  }

  const outlineSignal = sanitizePayoffText(
    pickDirectPayoffSignal(input.outlineNode ?? "")
      ?? pickRecentSummaryPayoffSignal(input.chapterSummaries),
  );
  if (outlineSignal) {
    return outlineSignal;
  }

  const focusPayoff = extractChapterFocusPayoff(
    input.currentFocus,
    input.chapterNumber,
    input.genreProfile,
  );
  if (focusPayoff) {
    return focusPayoff;
  }

  return defaultConcretePayoff(input.language, [
    input.protagonistGoal,
    input.goal,
    input.mainConflict,
    input.outlineNode,
    input.currentState,
    input.chapterSummaries,
  ], input.genreProfile);
}

function extractChapterEndingPayoff(
  currentFocus: string,
  chapterNumber: number,
  language: "zh" | "en",
): string | undefined {
  const ending = extractChapterFocusField(currentFocus, chapterNumber, language, [
    "章节结尾钩子",
    "结尾钩子",
    "ending hook",
    "chapter ending hook",
  ]);
  if (!ending) return undefined;
  return eventPayoffFromText(ending, language);
}

function extractCrisisPayoffFromState(
  stateFacts: ReturnType<typeof parseCurrentStateFacts>,
  language: "zh" | "en",
): string | undefined {
  const conflict = findStateFact(stateFacts, language, [
    "first conflict",
    "第一个冲突",
    "首个冲突",
    "current conflict",
    "当前冲突",
  ]);
  if (!conflict) return undefined;
  return eventPayoffFromText(conflict, language);
}

function eventPayoffFromText(text: string, language: "zh" | "en"): string | undefined {
  const normalized = sanitizeChapterGoalText(text);
  if (!normalized) return undefined;

  if (language === "zh") {
    if (/(父亲|爸爸).{0,24}(失业|危机|变故)|(?:失业|危机|变故).{0,24}(父亲|爸爸)/u.test(normalized)) {
      return "家庭危机被当场坐实";
    }
    if (/(名单|通知).{0,12}(出现|摆|放|写着|看到)|(?:看到|发现).{0,16}(名单|通知)/u.test(normalized)) {
      const target = normalized.match(/(?:名单|通知)/u)?.[0] ?? "关键信息";
      return `${target}被当场确认`;
    }
    if (/(重生|回到|穿越|我回来了|199\d).{0,20}(确认|意识到|不是梦|时间点|年份)|(?:确认|意识到|发现|确定).{0,20}(重生|不是梦|回到|199\d)/u.test(normalized)) {
      return "重生事实被当场确认";
    }
    if (/(商机|赚钱门路|机会|信息差).{0,20}(发现|找到|确认)|(?:发现|找到|确认).{0,20}(商机|赚钱门路|机会|信息差)/u.test(normalized)) {
      return "第一个赚钱机会被确认";
    }
  }

  if (/layoff|laid off|redundancy/i.test(normalized)) {
    return "the family layoff crisis is confirmed";
  }
  if (/reborn|returned to|time travel|not a dream/i.test(normalized)) {
    return "the rebirth is confirmed as real";
  }
  if (/opportunity|business lead|information gap/i.test(normalized)) {
    return "the first actionable opportunity is confirmed";
  }

  return undefined;
}

function pickDirectPayoffSignal(text: string): string | undefined {
  const sentences = text
    .split(/[。！？.!?]/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const payoffSentence = sentences.find((sentence) =>
    /获得|拿到|夺得|掌握|学会|压住|稳住|逃离|逃出|摆脱|反杀|突破|觉醒|发现|查明|找到|止血|恢复|修复|补充|secure|gain|obtain|escape|break free|stabilize|suppress|master|learn|reveal|find|recover|heal|breakthrough/i.test(sentence));
  if (payoffSentence) {
    return compactSpecificPayoff(payoffSentence);
  }
  return undefined;
}

function pickStateDeltaPayoffSignal(
  stateFacts: ReturnType<typeof parseCurrentStateFacts>,
  currentState: string,
): string | undefined {
  const factSignal = stateFacts
    .map((fact) => fact.object)
    .find((value) =>
      /恢复|回升|修复|止血|获得|拿到|线索|资源|掌握|突破|脱离|压住|稳住|recover|heal|gain|resource|clue|master|breakthrough|escape|stabilize/i.test(value),
    );
  if (factSignal) {
    return compactSpecificPayoff(factSignal);
  }

  const lines = currentState
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") && !line.startsWith("|"));
  return lines
    .map((line) => line.replace(/^-\s*/, "").trim())
    .map((line) => compactSpecificPayoff(line))
    .find((line) =>
      Boolean(line)
      && /恢复|回升|修复|止血|获得|拿到|线索|资源|掌握|突破|脱离|压住|稳住|recover|heal|gain|resource|clue|master|breakthrough|escape|stabilize/i.test(line)
    );
}

function pickRecentSummaryPayoffSignal(chapterSummaries: string): string | undefined {
  const summaries = parseChapterSummariesMarkdown(chapterSummaries)
    .sort((left, right) => left.chapter - right.chapter)
    .slice(-3)
    .reverse();

  for (const summary of summaries) {
    const signal = pickDirectPayoffSignal(summary.stateChanges)
      ?? pickDirectPayoffSignal(summary.events);
    if (signal) {
      return signal;
    }
  }

  return undefined;
}

/**
 * Extract a chapter-specific payoff from current_focus.md by finding
 * the block for this chapter and matching genre-specific objects/actions.
 *
 * Falls back to a generic action+object construction only if the chapter
 * block contains a matching concrete object; otherwise returns undefined
 * so the caller can try other sources.
 */
function extractChapterFocusPayoff(
  currentFocus: string,
  chapterNumber: number,
  genreProfile?: GenreProfileSummary,
): string | undefined {
  const objects = genreProfile?.concretePayoffObjects ?? [];
  if (objects.length === 0) return undefined;

  // Locate the chapter-specific block in current_focus.md.
  // Blocks are introduced by patterns like "第1章必须完成：" or "- 第1章".
  const chapterPattern = new RegExp(`第\\s*${chapterNumber}\\s*章`, "u");
  const lines = currentFocus.split("\n");
  let inBlock = false;
  const blockLines: string[] = [];

  for (const line of lines) {
    if (chapterPattern.test(line)) {
      inBlock = true;
      blockLines.push(line);
      continue;
    }
    if (inBlock) {
      // Stop at the next chapter boundary or a new top-level section.
      if (/第\s*\d+\s*章/.test(line) || /^##\s/.test(line)) {
        break;
      }
      blockLines.push(line);
    }
  }

  if (blockLines.length === 0) return undefined;
  const blockText = blockLines.join(" ");

  // Find which concrete objects appear in this chapter block.
  // Prefer the longest match (most specific object).
  const matchedObjects = objects
    .filter((obj) => blockText.includes(obj))
    .sort((a, b) => b.length - a.length);
  if (matchedObjects.length === 0) return undefined;

  const bestObject = matchedObjects[0]!;

  // Pick the best action: prefer one that appears in the block text,
  // otherwise infer from scene tone (protective vs acquisitive).
  const actions = genreProfile?.defaultPayoffActions ?? [];
  const matchedAction = actions.find((act) => blockText.includes(act));
  if (matchedAction) {
    return sanitizePayoffText(`${matchedAction}${bestObject}`) ?? undefined;
  }

  // No action found in text — infer the appropriate action from scene context.
  const conflictKeywords = /冲突|困境|危险|否则|打水漂|重蹈覆辙|阻止|拦住|救|保|夺回/u;
  const isProtectiveScene = conflictKeywords.test(blockText);
  const protectiveActions = actions.filter((a) => /保住|拦下|夺回|避开|阻止|救/u.test(a));
  const defaultAction = isProtectiveScene && protectiveActions.length > 0
    ? protectiveActions[0]!
    : actions[0];

  if (!defaultAction) return undefined;

  // Try to enrich the payoff with context from the sentence containing the object.
  const sentences = blockText.split(/[。！？.!?]/u).filter((s) => s.trim());
  const objectSentence = sentences.find((s) => s.includes(bestObject));
  if (objectSentence) {
    const quantityMatch = objectSentence.match(/(\d+\s*(?:元|块|万|千|百|张|个|份|台|成|折))/u);
    if (quantityMatch) {
      return sanitizePayoffText(`${defaultAction}${quantityMatch[0]}${bestObject}`) ?? undefined;
    }
  }

  return sanitizePayoffText(`${defaultAction}${bestObject}`) ?? undefined;
}

function inferEndingHookType(input: {
  readonly goal: string;
  readonly protagonistGoal: string;
  readonly mainConflict: string;
  readonly payoffToDeliver: string;
  readonly genreProfile?: GenreProfileSummary;
}): EndingHookType {
  const combined = [
    input.goal,
    input.protagonistGoal,
    input.mainConflict,
    input.payoffToDeliver,
  ].filter(Boolean).join(" ");

  if (input.genreProfile?.powerScaling !== false && /突破|晋阶|破境|觉醒|掌握|realm|breakthrough|ascend/i.test(combined)) {
    return "breakthrough";
  }
  if (/真相|身份|秘密|来历|揭开|发现|reveal|truth|secret|identity/i.test(combined)) {
    return "reveal";
  }
  if (/追|逃|追杀|追兵|hunt|chase|pursuit|escape/i.test(combined)) {
    return "pursuit";
  }
  if (/选择|抉择|取舍|choice|decide|decision/i.test(combined)) {
    return "choice";
  }
  return "danger";
}

function buildNextChapterPull(input: {
  readonly language: "zh" | "en";
  readonly endingHookType: EndingHookType;
  readonly foreshadowToTouch: ReadonlyArray<string>;
  readonly hooksById: ReadonlyMap<string, ChapterGoalHook>;
  readonly payoffToDeliver: string;
  readonly arcMapDirective?: string;
  readonly chapterEndingHook?: string;
}): string {
  const primaryHook = input.foreshadowToTouch
    .map((hookId) => input.hooksById.get(hookId))
    .find((hook): hook is ChapterGoalHook => Boolean(hook));
  const hookSignal = sanitizePayoffText(primaryHook?.expectedPayoff)
    ?? sanitizePayoffText(primaryHook?.notes)
    ?? sanitizePayoffText(input.chapterEndingHook)
    ?? sanitizePayoffText(input.arcMapDirective)
    ?? sanitizePayoffText(input.payoffToDeliver)
    ?? defaultSentence(
      input.language,
      "the next chapter escalation",
      "下章升级冲突",
    );

  if (input.language === "zh") {
    switch (input.endingHookType) {
      case "breakthrough":
        return sanitizeChapterGoalText(`刚兑现的提升只够打开第一道门，真正的代价与更高层对手会在下章逼近：${hookSignal}`)
          ?? "刚兑现的提升只够打开第一道门，真正的代价与更高层对手会在下章逼近。";
      case "reveal":
        return sanitizeChapterGoalText(`本章揭开的信息只是一层表皮，真正的真相会把局势再往前推一步：${hookSignal}`)
          ?? "本章揭开的信息只是一层表皮，真正的真相会把局势再往前推一步。";
      case "pursuit":
        return sanitizeChapterGoalText(`这一章刚跑出缺口，下章追兵或反扑就会咬上来：${hookSignal}`)
          ?? "这一章刚跑出缺口，下章追兵或反扑就会咬上来。";
      case "choice":
        return sanitizeChapterGoalText(`本章留下的选择不会自己消失，下章必须为代价买单：${hookSignal}`)
          ?? "本章留下的选择不会自己消失，下章必须为代价买单。";
      case "danger":
      default:
        return sanitizeChapterGoalText(`本章刚拿到一点喘息，真正危险已经顺着这条线逼近下章：${hookSignal}`)
          ?? "本章刚拿到一点喘息，真正危险已经顺着这条线逼近下章。";
    }
  }

  switch (input.endingHookType) {
    case "breakthrough":
      return sanitizeChapterGoalText(`The gain landed this chapter only opens the first door; the price and stronger opposition arrive next: ${hookSignal}`)
        ?? "The gain landed this chapter only opens the first door; the price and stronger opposition arrive next.";
    case "reveal":
      return sanitizeChapterGoalText(`This chapter only peeled back the first layer of truth; the next chapter turns that reveal into pressure: ${hookSignal}`)
        ?? "This chapter only peeled back the first layer of truth; the next chapter turns that reveal into pressure.";
    case "pursuit":
      return sanitizeChapterGoalText(`The chapter creates a gap, but the chase tightens immediately in the next one: ${hookSignal}`)
        ?? "The chapter creates a gap, but the chase tightens immediately in the next one.";
    case "choice":
      return sanitizeChapterGoalText(`The choice left at the end of this chapter cannot sit still; the next chapter cashes out the cost: ${hookSignal}`)
        ?? "The choice left at the end of this chapter cannot sit still; the next chapter cashes out the cost.";
    case "danger":
    default:
      return sanitizeChapterGoalText(`The chapter earns brief relief, but the real danger is already moving into the next beat: ${hookSignal}`)
        ?? "The chapter earns brief relief, but the real danger is already moving into the next beat.";
  }
}

function pickFirstNonEmpty(values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value && value.trim().length > 0));
}

function pickFirstMeaningfulChapterGoalText(values: ReadonlyArray<string | undefined>): string | undefined {
  for (const value of values) {
    const sanitized = sanitizeChapterGoalText(value);
    if (sanitized) {
      return sanitized;
    }
  }
  return undefined;
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*_`:#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultSentence(language: "zh" | "en", english: string, chinese: string): string {
  return language === "zh" ? chinese : english;
}

function sanitizePayoffText(value: string | undefined): string | undefined {
  const normalized = sanitizeChapterGoalText(value);
  if (!normalized) return undefined;
  if (/^\d+$/.test(normalized)) return undefined;
  if (/^\d+\s*[-~–—]\s*\d+$/.test(normalized)) return undefined;
  if (/^(chapter|第)?\s*\d+$/iu.test(normalized)) return undefined;
  if (isTimingMetadataText(normalized)) return undefined;
  if (isTemplateishPayoff(normalized)) return undefined;
  if (isAbstractPayoff(normalized)) return undefined;
  if (normalized.length <= 1) return undefined;
  return normalized;
}

function sanitizeChapterGoalText(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const cleaned = value
    .replace(/\r/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\|\s*-+\s*\|.*$/gmu, "")
    .replace(/\|\s*-+\s*\|/g, " ")
    .replace(/\s*\|\s*/g, " ")
    .replace(/[\\]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-:*：\s]+/u, "")
    .replace(/[\\]+$/u, "")
    .trim();

  if (!cleaned) return undefined;
  if (isPlaceholderChapterGoalText(cleaned)) return undefined;
  return cleaned;
}

function isPlaceholderChapterGoalText(value: string): boolean {
  return (
    /^(current focus|todo|none)$/iu.test(value)
    || /^（?描述接下来1-3章[\s\S]*）?$/u.test(value)
    || /^(describe the next 1-3 chapters?|fill this in|placeholder)$/iu.test(value)
    || /^（(?:未设定|未填写|待定|待补充|暂无|无）)$/u.test(value)
    || /^\((?:not set|unset|tbd|none|n\/a)\)$/iu.test(value)
  );
}

function isTemplateishPayoff(value: string): boolean {
  return (
    /给读者一个看得见的即时收益/u.test(value)
    || /即时收益|看得见的收益/u.test(value)
    || /遭遇压制\s*[-=~>]+\s*获得线索\/资源\/机缘/u.test(value)
    || /遭遇压制.*获得线索\/资源\/机缘/u.test(value)
    || /冒险试错/u.test(value)
    || /本章至少让主角获得一个可见资源、线索、脱身结果或战术优势/u.test(value)
    || /本章至少让主角获得一个可见资源、线索或脱离当前压制/u.test(value)
    || /core loop/i.test(value)
    || /visible immediate gain/i.test(value)
    || /win, clue, or resource before the chapter closes/i.test(value)
  );
}

function isTimingMetadataText(value: string): boolean {
  return (
    /^(短期|中期|长期)(?:\(\d+(?:-\d+|\+)?章\))?$/u.test(value)
    || /^(short-term|near-term|mid-arc|long-term|late-arc)$/i.test(value)
    || /^\d+(?:-\d+|\+)?章$/u.test(value)
    || /^(短期|中期|长期)\s*\(\d+(?:-\d+|\+)?章\)$/u.test(value)
    || /^(short-term|near-term|mid-arc|long-term|late-arc)\s*\(\d+(?:-\d+|\+)?\s*chapters?\)$/i.test(value)
  );
}

function isAbstractPayoff(value: string): boolean {
  return (
    /^(获得收益|得到线索|有所推进|形成优势|获得战术优势|获得资源或线索|争取喘息空间|可见收益|即时收益|本章收益|进展|推进主线)$/u.test(value)
    || /^(gain a benefit|get a clue|make progress|create an advantage|gain a tactical advantage)$/i.test(value)
    || (/收益|线索|资源|优势|进展|推进/u.test(value)
      && !/(腰牌|残卷|刻痕|追兵|追捕|反噬|封锁|逃离|逃出|甩开|地图|徽记|毒囊|符印|石碑|名册|令牌|洞口|黑市|血焰录)/u.test(value)
      && value.length <= 10)
  );
}

function compactSpecificPayoff(text: string): string {
  const sanitized = sanitizeChapterGoalText(text);
  if (!sanitized) {
    return "";
  }

  const payoffPattern = /(?:获得|拿到|夺得|掌握|学会|压住|稳住|逃离|逃出|摆脱|反杀|突破|觉醒|发现|查明|找到|止血|恢复|修复|补充)[^，。；！？,.!?]{0,24}/u;
  const englishPattern = /(?:gain|obtain|secure|escape|break free|stabilize|suppress|master|learn|reveal|find|recover|heal)[^,.;!?]{0,40}/i;
  const match = sanitized.match(payoffPattern) ?? sanitized.match(englishPattern);
  return match?.[0]?.trim() ?? sanitized;
}

function defaultConcretePayoff(
  language: "zh" | "en",
  sources: ReadonlyArray<string | undefined>,
  genreProfile?: GenreProfileSummary,
): string {
  const combined = sources.filter(Boolean).join(" ");
  const objects = genreProfile?.concretePayoffObjects ?? [];
  const actions = genreProfile?.defaultPayoffActions ?? (language === "zh" ? ["拿到", "保住", "夺回"] : ["secure", "protect", "reclaim"]);

  const matchedObject = objects.find((obj) => combined.includes(obj));
  const matchedAction = actions.find((act) => combined.includes(act)) ?? actions[0];

  if (matchedObject) {
    return language === "zh" ? `${matchedAction}${matchedObject}` : `${matchedAction} the ${matchedObject}`;
  }

  if (/逃|追捕|追兵|封锁|围堵/u.test(combined)) {
    return language === "zh" ? "暂时脱离当前压制" : "Temporarily break free from the current pressure.";
  }
  if (/(失业|家庭|父亲|母亲|家里|危机|压力|变故)/u.test(combined)) {
    return language === "zh" ? "确认一个迫在眉睫的现实危机" : "Confirm an urgent real-world crisis.";
  }
  if (/(商机|赚钱|生意|信息差|批发|价格|渠道|本钱|资金)/u.test(combined)) {
    return language === "zh" ? "发现一个可执行的赚钱机会" : "Identify an actionable earning opportunity.";
  }

  return language === "zh"
    ? "确认一个可执行的现实推进点"
    : "Confirm one actionable practical step.";
}

function isStructuredControlText(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  return normalized.startsWith("#") || normalized.startsWith("|");
}

function sanitizeChineseCharacterCandidate(candidate: string | undefined): string | undefined {
  const normalized = candidate?.trim();
  if (!normalized) return undefined;
  if (normalized.length < 2 || normalized.length > 4) return undefined;

  const exactStopwords = new Set([
    "当前状态",
    "当前目标",
    "当前冲突",
    "核心冲突",
    "本章",
    "读者",
    "章节",
    "主角",
    "自己",
    "我们",
    "你们",
    "他们",
    "她们",
    "它们",
    "我不",
    "我会",
    "我要",
    "我想",
    "他不",
    "他会",
    "她不",
    "她会",
    "安全地点",
    "安全区域",
    "一道身影",
    "信任",
    "怀疑",
    "担忧",
    "危机",
    "代价",
    "秘密",
    "态度",
    "关系",
    "威胁",
    "困境",
    "希望",
    "结果",
    "瓶颈",
    "计划",
    "处境",
    "情况",
    "局势",
    "局面",
    "细节",
    "限制",
    "规则",
    "障碍",
    "选择",
    "行动",
    "冲突",
    "目标",
    "底牌",
    "原因",
    "方法",
    "途径",
    "过程",
    "背景",
    "时间",
    "空间",
    "距离",
    "记忆",
    "情感",
    "手段",
    "事件",
    "约束",
    "条件",
    "分歧",
    "进展",
    "成果",
    "悬念",
    "动机",
    "压力",
    "情绪",
    "反馈",
    "回报",
    "收益",
    "契机",
    "痕迹",
    "金手指",
  ]);
  if (exactStopwords.has(normalized)) return undefined;
  if (/^[我你他她它咱俺][不也会想要能再已正将]/u.test(normalized)) return undefined;
  if (/^(?:我们|你们|他们|她们|它们|自己)/u.test(normalized)) return undefined;

  const blockedSubstrings = [
    "地点",
    "山洞",
    "尸坑",
    "暗河",
    "洞口",
    "黑市",
    "营地",
    "符文",
    "石片",
    "腰牌",
    "毒囊",
    "地图",
    "刻痕",
    "骸骨",
    "真相",
    "线索",
    "资源",
    "机缘",
    "力量",
    "反噬",
    "突破",
    "进入",
    "到骸",
    "看守",
    "追兵的",
  ];
  if (blockedSubstrings.some((fragment) => normalized.includes(fragment))) return undefined;
  if (/[到去进从的了着]/u.test(normalized)) return undefined;
  if (/^[第这那本该各某每两一二三四五六七八九十]+/u.test(normalized)) return undefined;
  if (/(?:进入|赶到|找到|追到|走到|来到|看见|见到)$/u.test(normalized)) return undefined;

  const stableRoleTitles = new Set(["碑灵", "守卫", "追兵", "守门人", "掌柜", "长老", "师父", "师兄", "师姐", "族老"]);
  const personSuffixes = ["老", "师", "叔", "伯", "兄", "姐", "妹", "父", "母", "爷", "娘", "灵"];
  if (stableRoleTitles.has(normalized)) return normalized;
  if (normalized.length <= 3 && !/(山|洞|河|谷|坑|符|牌|骨|图|痕)/u.test(normalized)) {
    return normalized;
  }
  if (personSuffixes.some((suffix) => normalized.startsWith(suffix) || normalized.endsWith(suffix))) {
    return normalized;
  }
  return undefined;
}

function sanitizeEnglishCharacterCandidate(candidate: string | undefined): string | undefined {
  const normalized = candidate?.trim();
  if (!normalized) return undefined;
  const blocked = ["Current", "Current Focus", "Active Focus", "Current State", "Goal", "Conflict", "Outline", "Field", "Value"];
  if (blocked.includes(normalized)) return undefined;
  return normalized;
}
