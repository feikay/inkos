import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { buildWriterSystemPrompt, type FanficContext } from "./writer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import { parseSettlerDeltaOutput } from "./settler-delta-parser.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { readGenreProfile, readBookRules, mergeContentSafetyProfile } from "./rules-reader.js";
import {
  detectCrossChapterRepetition,
  detectParagraphLengthDrift,
  evaluateCadenceDirectiveCompliance,
  evaluateChapterGoalDiscipline,
  evaluateEndingTypeCompliance,
  evaluateEndingIsomorphism,
  evaluateHookEmergenceCompliance,
  evaluateHookDebtThrottle,
  evaluateMoodCadenceCompliance,
  evaluatePayoffImpact,
  evaluateResourceLedgerDiscipline,
  toCadenceDirectiveWarnings,
  toDisciplineWarnings,
  toEndingTypeWarnings,
  toEndingIsomorphismWarnings,
  toHookEmergenceWarnings,
  toHookDebtWarnings,
  toMoodCadenceWarnings,
  toPayoffImpactWarnings,
  toResourceLedgerWarnings,
  validatePostWrite,
  type EndingHookCheck,
  type HookDebtCheck,
  type MoodCadenceCheck,
  type PayoffCheck,
  type PayoffImpactCheck,
  type PostWriteViolation,
  type ResourceLedgerCheck,
} from "./post-write-validator.js";
import { analyzeAITells } from "./ai-tells.js";
import { validateStyleGuard } from "../validators/style-guard.js";
import { validateConsistencyGuard } from "../validators/consistency-guard.js";
import { analyzePatternBreaker } from "../validators/pattern-breaker.js";
import type { ChapterGoal, ChapterTrace, ContextPackage, MoodDirective, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import { buildLengthSpec, countChapterLength } from "../utils/length-metrics.js";
import { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
  mergeCharacterMatrixMarkdown,
  mergeTableMarkdownByKey,
} from "../utils/governed-working-set.js";
import { extractPOVFromOutline, filterMatrixByPOV, filterHooksByPOV } from "../utils/pov-filter.js";
import { parseCreativeOutput } from "./writer-parser.js";
import { buildRuntimeStateArtifacts, saveRuntimeStateSnapshot, type RuntimeStateArtifacts } from "../state/runtime-state-store.js";
import { reconcileSettlementDiff } from "../state/settlement-reconciliation.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import { parsePendingHooksMarkdown } from "../utils/memory-retrieval.js";
import { analyzeHookHealth } from "../utils/hook-health.js";
import { buildEnglishVarianceBrief } from "../utils/long-span-fatigue.js";
import { buildChapterTitleCandidates, resolveChapterTitle } from "../utils/chapter-title-engine.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  preScanTextAgainstResourcePlan,
  renderResourcePlanForPrompt,
  type ChapterResourcePlan,
} from "./resource-plan.js";

export interface WriteChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
  readonly retryHint?: string;
  readonly retryHintPath?: string;
  readonly chapterIntent?: string;
  readonly resourcePlan?: ChapterResourcePlan;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly trace?: ChapterTrace;
  readonly lengthSpec?: LengthSpec;
  readonly wordCountOverride?: number;
  readonly temperatureOverride?: number;
}

export interface SettleChapterStateInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly allowReapply?: boolean;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly validationFeedback?: string;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface IntentPayoffSuppression {
  readonly suppressPayoff: boolean;
  readonly reason?: string;
  readonly removedPayoff?: string;
}

export interface PlannerIntentSanitizationResult {
  readonly sanitizedPlannerIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly suppression: IntentPayoffSuppression;
}

const INTENT_PAYOFF_SUPPRESSION_PATTERNS: ReadonlyArray<RegExp> = [
  /仅提示绑定/u,
  /仅触发绑定/u,
  /系统绑定/u,
  /不直接发放任何福利/u,
  /不提前发放任何福利/u,
  /不直接兑现/u,
  /不得提前兑现/u,
  /后续再逐步展示/u,
  /本章只触发/u,
  /不得直接获得/u,
  /不得提前给主角福利/u,
  /不提前泄露系统功能/u,
  /不得提前泄露系统功能/u,
  /结尾停在系统绑定/u,
  /结尾卡系统绑定/u,
  /不得提前消耗后续剧情/u,
  /不直接给(?:现金|技能|情报)/u,
  /不得完整解锁/u,
  /仅兑现第一层/u,
  /不能完整解释/u,
  /只允许\s*partial reveal/iu,
];

const PAYOFF_DRIFT_PATTERNS: ReadonlyArray<RegExp> = [
  /完整解锁/u,
  /明确逃生(?:线索|路径|路线)/u,
  /他一下子看懂了/u,
  /直接知道/u,
  /藏着外公/u,
  /藏着资金/u,
  /旧码头/u,
  /三号仓库/u,
  /第三块砖/u,
  /S\s*级逃生线索/iu,
  /永久失明/u,
  /左眼失明/u,
  /获得现金/u,
  /解锁技能/u,
  /获得技能/u,
  /获得情报/u,
  /完整真相/u,
  /彻底搞懂/u,
];

const LEGACY_PAYOFF_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /payoffToDeliver\s*:\s*.+/giu,
  /payoffDirective\.[A-Za-z]+\s*:\s*.+/giu,
  /promisedPayoff\s*:\s*.+/giu,
  /当存在\s*payoffToDeliver\s*时，?payoff\s*优先级高于\s*EndingType[^。\n]*(?:。)?/giu,
  /payoff\s*优先级高于\s*endingType[^。\n]*(?:。)?/giu,
  /获得一条明确逃生线索/gu,
  /完整解锁/gu,
  /明确逃生路径/gu,
  /藏着资金/gu,
  /旧码头/gu,
  /第三块砖/gu,
  /永久失明/gu,
  /S\s*级逃生线索/giu,
];

export function detectIntentPayoffSuppression(chapterIntent: string | undefined): IntentPayoffSuppression {
  const intent = chapterIntent?.trim();
  if (!intent) {
    return { suppressPayoff: false };
  }

  const matched = INTENT_PAYOFF_SUPPRESSION_PATTERNS.find((pattern) => pattern.test(intent));
  if (!matched) {
    return { suppressPayoff: false };
  }

  const line = intent
    .split("\n")
    .map((value) => value.trim())
    .find((value) => matched.test(value));
  return {
    suppressPayoff: true,
    reason: line || matched.source,
  };
}

export function sanitizePlannerIntentForChapterIntent(params: {
  readonly plannerIntent?: string;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
}): PlannerIntentSanitizationResult {
  const suppression = detectIntentPayoffSuppression(params.chapterIntent);
  if (!suppression.suppressPayoff) {
    return {
      sanitizedPlannerIntent: params.plannerIntent,
      contextPackage: params.contextPackage,
      suppression,
    };
  }

  const removedPayoff = params.contextPackage?.chapterGoal?.payoffDirective?.promisedPayoff
    ?? params.contextPackage?.chapterGoal?.payoffToDeliver;
  const sanitizedPlannerIntent = params.plannerIntent
    ? [
        LEGACY_PAYOFF_TEXT_PATTERNS.reduce(
          (text, pattern) => text.replace(pattern, ""),
          params.plannerIntent,
        ).replace(/\n{3,}/g, "\n\n").trimEnd(),
        "",
        "## Sanitized Note",
        "旧 payoffDirective 已被 chapter_intent 抑制，本章只允许系统绑定/轻微暗示，不得完整兑现。",
      ].join("\n")
    : params.plannerIntent;
  const contextPackage = params.contextPackage?.chapterGoal
    ? (() => {
        const { payoffDirective: _payoffDirective, ...goalWithoutPayoffDirective } = params.contextPackage!.chapterGoal!;
        return {
          ...params.contextPackage!,
          chapterGoal: {
            ...goalWithoutPayoffDirective,
            protagonistGoal: goalWithoutPayoffDirective.protagonistGoal.replace(/获得一条明确逃生线索/gu, "完成 chapter_intent 指定的本章目标"),
            payoffToDeliver: "chapter_intent 已抑制旧 payoff，本章只允许系统绑定/轻微暗示，不得完整兑现",
            nextChapterPull: goalWithoutPayoffDirective.nextChapterPull.replace(/逃生线索|逃生路线|旧码头|资金/gu, "系统绑定钩子"),
          },
        };
      })()
    : params.contextPackage;

  return {
    sanitizedPlannerIntent,
    contextPackage,
    suppression: {
      ...suppression,
      ...(removedPayoff ? { removedPayoff } : {}),
    },
  };
}

export interface WriteChapterOutput {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
  readonly postSettlement: string;
  readonly runtimeStateDelta?: RuntimeStateDelta;
  readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedChapterSummaries?: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
  readonly settlementConfidence?: number;
  readonly postWriteErrors: ReadonlyArray<PostWriteViolation>;
  readonly postWriteWarnings: ReadonlyArray<PostWriteViolation>;
  readonly endingHookCheck?: EndingHookCheck;
  readonly payoffCheck?: PayoffCheck;
  readonly payoffImpactCheck?: PayoffImpactCheck;
  readonly moodCadenceCheck?: MoodCadenceCheck;
  readonly resourceLedgerCheck?: ResourceLedgerCheck;
  readonly hookDebtCheck?: HookDebtCheck;
  readonly hookHealthIssues?: ReadonlyArray<{
    readonly severity: "critical" | "warning" | "info";
    readonly category: string;
    readonly description: string;
    readonly suggestion: string;
  }>;
  readonly tokenUsage?: TokenUsage;
  readonly isDegraded?: boolean;
}

export class WriterAgent extends BaseAgent {
  get name(): string {
    return "writer";
  }

  private localize(language: "zh" | "en", messages: { zh: string; en: string }): string {
    return language === "en" ? messages.en : messages.zh;
  }

  private logInfo(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.info(this.localize(language, messages));
  }

  private logWarn(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.warn(this.localize(language, messages));
  }

  private minimumWholeChapterWords(lengthSpec: LengthSpec): number {
    if (lengthSpec.target < 1000) {
      return 1;
    }
    return Math.max(1, Math.min(1000, lengthSpec.hardMin));
  }

  private acceptWholeChapterRewrite(params: {
    readonly language: "zh" | "en";
    readonly chapterNumber: number;
    readonly stage: string;
    readonly beforeContent: string;
    readonly afterContent: string;
    readonly countingMode: LengthSpec["countingMode"];
    readonly minWholeChapterWords?: number;
  }): {
    readonly accepted: boolean;
    readonly beforeWords: number;
    readonly afterWords: number;
    readonly rejectedReason?: string;
  } {
    const beforeWords = countChapterLength(params.beforeContent, params.countingMode);
    const afterWords = countChapterLength(params.afterContent, params.countingMode);
    let rejectedReason: string | undefined;
    const enforceWholeChapterGuard = typeof params.minWholeChapterWords === "number"
      && params.minWholeChapterWords > 1
      && beforeWords >= params.minWholeChapterWords;
    const BAD_REWRITE_PATTERNS: ReadonlyArray<RegExp> = [
      /请提供(?:原文|需要修改的原章节)/u,
      /请您提供[^。\n]{0,30}(?:正文|原章节|内容)/u,
      /无法完成/u,
      /需要修改的原章节完整正文内容/u,
      /作为AI/u,
      /我不能/u,
      /抱歉[^。\n]{0,30}(?:无法|不能)/u,
    ];
    const hasBadRewritePattern = BAD_REWRITE_PATTERNS.some((pattern) => pattern.test(params.afterContent));
    if (params.afterContent.trim().length === 0) {
      rejectedReason = "empty-candidate";
    } else if (hasBadRewritePattern) {
      rejectedReason = "bad-rewrite-pattern-detected";
    } else if (enforceWholeChapterGuard && afterWords < 1000) {
      rejectedReason = "below-hard-minimum-1000";
    } else if (enforceWholeChapterGuard && afterWords < Math.ceil(beforeWords * 0.7)) {
      rejectedReason = "below-70%-of-original";
    } else if (enforceWholeChapterGuard && afterWords < Math.ceil(beforeWords * 0.8)) {
      rejectedReason = "below-80%-of-original";
    } else if (
      typeof params.minWholeChapterWords === "number"
      && params.minWholeChapterWords > 1
      && beforeWords >= params.minWholeChapterWords
      && afterWords < params.minWholeChapterWords
    ) {
      rejectedReason = `below-minimum-length-${params.minWholeChapterWords}`;
    }
    const accepted = !rejectedReason;
    const message = {
      zh: `rewrite decision [${params.stage}]: beforeWords=${beforeWords}, afterWords=${afterWords}, accepted=${accepted}, rejectedReason=${rejectedReason ?? "none"}`,
      en: `rewrite decision [${params.stage}]: beforeWords=${beforeWords}, afterWords=${afterWords}, accepted=${accepted}, rejectedReason=${rejectedReason ?? "none"}`,
    };
    if (accepted) {
      this.logInfo(params.language, message);
    } else {
      this.logWarn(params.language, message);
    }
    return { accepted, beforeWords, afterWords, rejectedReason };
  }

  private async rewriteResourcePlanViolationsIfNeeded(params: {
    readonly creative: ReturnType<typeof parseCreativeOutput>;
    readonly resourcePlan?: ChapterResourcePlan;
    readonly creativeSystemPrompt: string;
    readonly creativeUserPrompt: string;
    readonly lockedScene1Block?: string;
    readonly language: "zh" | "en";
    readonly chapterNumber: number;
    readonly maxTokens: number;
    readonly temperature: number;
    readonly countingMode: LengthSpec["countingMode"];
    readonly minWholeChapterWords: number;
    readonly onUsage: (usage: TokenUsage) => void;
  }): Promise<ReturnType<typeof parseCreativeOutput>> {
    if (!params.resourcePlan) return params.creative;
    const scan = preScanTextAgainstResourcePlan(params.creative.content, params.resourcePlan);
    if (scan.ok) {
      this.logInfo(params.language, {
        zh: "writer pre-scan passed",
        en: "writer pre-scan passed",
      });
      return params.creative;
    }

    this.logWarn(params.language, {
      zh: `writer pre-scan detected resource plan violation: ${scan.violations.join("；")}`,
      en: `writer pre-scan detected resource plan violation: ${scan.violations.join("; ")}`,
    });
    this.logWarn(params.language, {
      zh: "writer rewrite due to resource plan violation",
      en: "writer rewrite due to resource plan violation",
    });

    const rewritePrompt = params.language === "en"
      ? [
          params.creativeUserPrompt,
          params.lockedScene1Block ?? "",
          "",
          "## Resource Plan Violation Rewrite",
          "Your previous draft violated the chapter Resource Plan:",
          ...scan.violations.map((violation) => `- ${violation}`),
          "",
          "Rewrite the chapter. Preserve the public confrontation, debate skill payoff, and reputation gains. Delete cash exchange, account credit, transfers, overdraft/advance/debt, and any reduced medical/rent funding gap.",
          "Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks.",
        ].join("\n")
      : [
          params.creativeUserPrompt,
          params.lockedScene1Block ?? "",
          "",
          "## Resource Plan 违规重写",
          "你上一版草稿违反了本章 Resource Plan：",
          ...scan.violations.map((violation) => `- ${violation}`),
          "",
          "请重写本章：保留当众反击汤姆、初级辩论技能、民望增加和下一章希望；删除现金兑换、到账/入账、路人给钱、预支/透支/负债、透析费或房租缺口减少。",
          "只输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块。",
        ].join("\n");

    const response = await this.chat(
      [
        { role: "system", content: params.creativeSystemPrompt },
        { role: "user", content: rewritePrompt },
      ],
      { maxTokens: params.maxTokens, temperature: params.temperature },
    );
    params.onUsage(response.usage);
    const candidate = parseCreativeOutput(params.chapterNumber, response.content, params.countingMode);
    const candidateScan = preScanTextAgainstResourcePlan(candidate.content, params.resourcePlan);
    const decision = this.acceptWholeChapterRewrite({
      language: params.language,
      chapterNumber: params.chapterNumber,
      stage: "resource-plan-prescan",
      beforeContent: params.creative.content,
      afterContent: candidate.content,
      countingMode: params.countingMode,
      minWholeChapterWords: params.minWholeChapterWords,
    });
    if (decision.accepted && candidateScan.ok) {
      this.logInfo(params.language, {
        zh: "writer pre-scan passed after rewrite",
        en: "writer pre-scan passed after rewrite",
      });
      return candidate;
    }
    if (!candidateScan.ok) {
      this.logWarn(params.language, {
        zh: `writer pre-scan still failed after rewrite: ${candidateScan.violations.join("；")}`,
        en: `writer pre-scan still failed after rewrite: ${candidateScan.violations.join("; ")}`,
      });
    }
    return params.creative;
  }

  async writeChapter(input: WriteChapterInput): Promise<WriteChapterOutput> {
    const { book, bookDir, chapterNumber } = input;

    const [
      storyBible, volumeOutline, styleGuide, currentState, ledger, hooks,
      chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
      parentCanon, fanficCanonRaw,
    ] = await Promise.all([
        this.readFileOrDefault(join(bookDir, "story/story_bible.md")),
        this.readFileOrDefault(join(bookDir, "story/volume_outline.md")),
        this.readFileOrDefault(join(bookDir, "story/style_guide.md")),
        this.readFileOrDefault(join(bookDir, "story/current_state.md")),
        this.readFileOrDefault(join(bookDir, "story/particle_ledger.md")),
        this.readFileOrDefault(join(bookDir, "story/pending_hooks.md")),
        this.readFileOrDefault(join(bookDir, "story/chapter_summaries.md")),
        this.readFileOrDefault(join(bookDir, "story/subplot_board.md")),
        this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md")),
        this.readFileOrDefault(join(bookDir, "story/character_matrix.md")),
        this.readFileOrDefault(join(bookDir, "story/style_profile.json")),
        this.readFileOrDefault(join(bookDir, "story/parent_canon.md")),
        this.readFileOrDefault(join(bookDir, "story/fanfic_canon.md")),
      ]);

    const recentChapters = await this.loadRecentChapters(bookDir, chapterNumber);
    const recentEndingChapters = await this.loadRecentChapters(bookDir, chapterNumber, 3);
    // Load more chapters for dialogue fingerprint extraction (voice consistency over longer span)
    const fingerprintChapters = await this.loadRecentChapters(bookDir, chapterNumber, 5);

    // Load genre profile + book rules
    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const bookRulesBody = parsedBookRules?.body ?? "";

    let bookResourceRewards: string[] = [];
    let bookActiveAttempts: string[] = [];
    let bookPayoffRewards: string[] = [];
    try {
      const signalsContent = await this.readFileOrDefault(join(bookDir, "story/structure_signals.json"));
      if (signalsContent && signalsContent.trim() !== "(文件尚未创建)") {
        const parsed = JSON.parse(signalsContent);
        if (parsed?.signals?.resource_reward) bookResourceRewards = parsed.signals.resource_reward;
        if (parsed?.signals?.active_attempt) bookActiveAttempts = parsed.signals.active_attempt;
        if (parsed?.signals?.payoff_reward) bookPayoffRewards = parsed.signals.payoff_reward;
      }
    } catch {
      // Ignore
    }

    const styleFingerprint = this.buildStyleFingerprint(styleProfileRaw);

    const dialogueFingerprints = this.extractDialogueFingerprints(fingerprintChapters, storyBible);
    const relevantSummaries = this.findRelevantSummaries(chapterSummaries, volumeOutline, chapterNumber);

    const hasParentCanon = parentCanon !== "(文件尚未创建)";
    const hasFanficCanon = fanficCanonRaw !== "(文件尚未创建)";
    const resolvedLanguage = book.language ?? genreProfile.language;
    const targetWords = input.lengthSpec?.target ?? input.wordCountOverride ?? book.chapterWordCount;
    const resolvedLengthSpec = input.lengthSpec ?? buildLengthSpec(targetWords, resolvedLanguage);
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;
    const chapterGoal = input.contextPackage?.chapterGoal ?? this.readChapterGoalFromIntentMarkdown(input.chapterIntent);
    const hookEmergenceDirective = this.extractHookEmergenceDirectiveFromIntentMarkdown(input.chapterIntent);
    const payoffSuppression = this.detectIntentPayoffSuppression(input.chapterIntent);
    const recentTitles = this.extractRecentTitles(recentChapters, resolvedLanguage);
    const titleCandidates = buildChapterTitleCandidates({
      language: resolvedLanguage,
      chapterGoal,
      keyEvents: this.buildTitleKeyEvents({
        chapterGoal,
      contextPackage: input.contextPackage,
      currentState,
      relevantSummaries,
      externalContext: input.externalContext,
      }),
      recentTitles,
    });
    const moodDirective = this.extractMoodDirectiveFromIntentMarkdown(input.chapterIntent);
    const englishVarianceBrief = resolvedLanguage === "en"
      ? await buildEnglishVarianceBrief({
          bookDir,
          chapterNumber,
        })
      : null;

    // Build fanfic context if fanfic_canon.md exists
    const fanficContext: FanficContext | undefined = hasFanficCanon && bookRules?.fanficMode
      ? {
          fanficCanon: fanficCanonRaw,
          fanficMode: bookRules.fanficMode,
          allowedDeviations: bookRules.allowedDeviations ?? [],
        }
      : undefined;
    const recentPatternChapters = recentEndingChapters
      .split(/\n\n---\n\n/u)
      .map((chapter) => chapter.trim())
      .filter(Boolean)
      .slice(-3);
    const patternBreaker = analyzePatternBreaker(recentPatternChapters, resolvedLanguage);
    if (patternBreaker.repeated) {
      this.logWarn(resolvedLanguage, {
        zh: `剧情模式打断器：第${chapterNumber}章注入结构打断约束（${patternBreaker.recentPatterns.join(" / ")}）`,
        en: `Pattern breaker: injecting structure-divergence constraints for chapter ${chapterNumber} (${patternBreaker.recentPatterns.join(" / ")})`,
      });
    }

    const mergedSafetyProfile = mergeContentSafetyProfile(genreProfile, bookRules);

    // ── Phase 1: Creative writing (temperature 0.7) ──
    const creativeSystemPrompt = buildWriterSystemPrompt(
      book, genreProfile, bookRules, bookRulesBody, genreBody, styleGuide, styleFingerprint,
      chapterNumber, "creative", fanficContext, resolvedLanguage,
      input.chapterIntent ? "governed" : "legacy",
      resolvedLengthSpec,
      mergedSafetyProfile,
    );

    const creativeUserPrompt = input.chapterIntent && input.contextPackage && input.ruleStack
      ? this.buildGovernedUserPrompt({
          chapterNumber,
          chapterIntent: input.chapterIntent,
          resourcePlan: input.resourcePlan,
          contextPackage: input.contextPackage,
          ruleStack: input.ruleStack,
          trace: input.trace,
          lengthSpec: resolvedLengthSpec,
          language: book.language ?? genreProfile.language,
          varianceBrief: englishVarianceBrief?.text,
          selectedEvidenceBlock: this.joinGovernedEvidenceBlocks(governedMemoryBlocks),
          titleCandidates,
          patternBreakerDirective: patternBreaker.directive,
          retryHint: input.retryHint,
          retryHintPath: input.retryHintPath,
        })
      : (() => {
          // Smart context filtering: inject only relevant parts of truth files
          const filteredHooks = filterHooks(hooks);
          const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
          const filteredSubplots = filterSubplots(subplotBoard);
          const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
          const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRules?.protagonist?.name);

          // POV-aware filtering: limit context to what the POV character knows
          const povCharacter = extractPOVFromOutline(volumeOutline, chapterNumber);
          const povFilteredMatrix = povCharacter
            ? filterMatrixByPOV(filteredMatrix, povCharacter)
            : filteredMatrix;
          const povFilteredHooks = povCharacter
            ? filterHooksByPOV(filteredHooks, povCharacter, chapterSummaries)
            : filteredHooks;

          return this.buildUserPrompt({
            chapterNumber,
            storyBible,
            volumeOutline,
            currentState,
            ledger: genreProfile.numericalSystem ? ledger : "",
            hooks: povFilteredHooks,
            recentChapters,
            lengthSpec: resolvedLengthSpec,
            externalContext: input.externalContext,
            chapterSummaries: filteredSummaries,
            subplotBoard: filteredSubplots,
            emotionalArcs: filteredArcs,
            characterMatrix: povFilteredMatrix,
            dialogueFingerprints,
            relevantSummaries,
            parentCanon: hasParentCanon ? parentCanon : undefined,
            language: book.language ?? genreProfile.language,
            titleCandidates,
            moodDirective,
            chapterGoal,
            resourcePlan: input.resourcePlan,
            hookEmergenceDirective,
            patternBreakerDirective: patternBreaker.directive,
            retryHint: input.retryHint,
            retryHintPath: input.retryHintPath,
          });
        })();

    const creativeTemperature = input.temperatureOverride ?? 0.7;

    if (input.resourcePlan) {
      this.logInfo(resolvedLanguage, {
        zh: "writer resource plan injected",
        en: "writer resource plan injected",
      });
    }

    this.logInfo(resolvedLanguage, {
      zh: `阶段 1：创作正文（第${chapterNumber}章）`,
      en: `Phase 1: creative writing for chapter ${chapterNumber}`,
    });

    // Scale maxTokens to chapter word count (Chinese ≈ 1.5 tokens/char)
    const creativeMaxTokens = Math.max(8192, Math.ceil(targetWords * 2));
    let phaseOneUsage: TokenUsage | undefined;
    const lockedScene1 = moodDirective?.targetMode === "breath"
      ? await this.generateLockedBreathScene1({
          systemPrompt: creativeSystemPrompt,
          baseUserPrompt: creativeUserPrompt,
          language: resolvedLanguage,
          chapterNumber,
          maxTokens: Math.max(2048, Math.ceil(creativeMaxTokens * 0.35)),
          temperature: Math.min(creativeTemperature, 0.55),
          chapterIntent: input.chapterIntent,
          countingMode: resolvedLengthSpec.countingMode,
          onUsage: (usage) => {
            // creativeUsage is initialized immediately after the main creative call.
            phaseOneUsage = usage;
          },
        })
      : undefined;
    const lockedScene1Block = lockedScene1
      ? this.buildLockedScene1Phase2Block(lockedScene1, resolvedLanguage)
      : "";
    const resourcePlanPriorityBlock = input.resourcePlan
      ? resolvedLanguage === "en"
        ? "\n⚠️ The resource plan below takes priority over all other instructions. If the resource plan conflicts with the volume outline or current state, obey the resource plan.\n"
        : "\n⚠️ 以下资源计划优先级高于其他所有指令。如果资源计划与卷纲/状态卡有冲突，以资源计划为准。\n"
      : "";

    const creativeResponse = await this.chat(
      [
        { role: "system", content: creativeSystemPrompt },
        { role: "user", content: `${creativeUserPrompt}${lockedScene1Block}` },
      ],
      { maxTokens: creativeMaxTokens, temperature: creativeTemperature },
    );
    let creativeUsage = phaseOneUsage
      ? {
        promptTokens: phaseOneUsage.promptTokens + creativeResponse.usage.promptTokens,
        completionTokens: phaseOneUsage.completionTokens + creativeResponse.usage.completionTokens,
        totalTokens: phaseOneUsage.totalTokens + creativeResponse.usage.totalTokens,
      }
      : creativeResponse.usage;

    let creative = parseCreativeOutput(chapterNumber, creativeResponse.content, resolvedLengthSpec.countingMode);
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    creative = await this.rewriteResourcePlanViolationsIfNeeded({
      creative,
      resourcePlan: input.resourcePlan,
      creativeSystemPrompt,
      creativeUserPrompt,
      lockedScene1Block,
      language: resolvedLanguage,
      chapterNumber,
      maxTokens: creativeMaxTokens,
      temperature: Math.min(creativeTemperature, 0.45),
      countingMode: resolvedLengthSpec.countingMode,
      minWholeChapterWords: this.minimumWholeChapterWords(resolvedLengthSpec),
      onUsage: (usage) => {
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + usage.totalTokens,
        };
      },
    });
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    creative = await this.rewriteChapterIntentDriftIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
      payoffSuppression,
      language: resolvedLanguage,
      chapterNumber,
      maxTokens: creativeMaxTokens,
      countingMode: resolvedLengthSpec.countingMode,
      onUsage: (usage) => {
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + usage.totalTokens,
        };
      },
    });
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    creative = await this.rewriteForHookEmergenceIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
      hookEmergenceDirective,
      language: resolvedLanguage,
      chapterNumber,
      maxTokens: creativeMaxTokens,
      titleCandidates,
      countingMode: resolvedLengthSpec.countingMode,
      onUsage: (usage) => {
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + usage.totalTokens,
        };
      },
    });
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    creative = await this.rewriteForPayoffDirectiveIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
      payoffSuppression,
      chapterGoal,
      language: resolvedLanguage,
      chapterNumber,
      maxTokens: creativeMaxTokens,
      titleCandidates,
      countingMode: resolvedLengthSpec.countingMode,
      onUsage: (usage) => {
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + usage.totalTokens,
        };
      },
    });
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    creative = await this.rewriteForMoodDirectiveIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
      moodDirective,
      hookEmergenceDirective,
      language: resolvedLanguage,
      chapterNumber,
      maxTokens: creativeMaxTokens,
      titleCandidates,
      countingMode: resolvedLengthSpec.countingMode,
      minWholeChapterWords: this.minimumWholeChapterWords(resolvedLengthSpec),
      onUsage: (usage) => {
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + usage.totalTokens,
        };
      },
    });
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    creative = await this.rewriteForEndingTypeIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
      language: resolvedLanguage,
      chapterNumber,
      maxTokens: creativeMaxTokens,
      titleCandidates,
      countingMode: resolvedLengthSpec.countingMode,
      minWholeChapterWords: this.minimumWholeChapterWords(resolvedLengthSpec),
      onUsage: (usage) => {
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + usage.totalTokens,
        };
      },
    });
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    creative = await this.rewriteChapterIntentDriftIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
      payoffSuppression,
      language: resolvedLanguage,
      chapterNumber,
      maxTokens: creativeMaxTokens,
      countingMode: resolvedLengthSpec.countingMode,
      onUsage: (usage) => {
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + usage.totalTokens,
        };
      },
    });
    creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
    const styleGuardPreviousChapters = recentEndingChapters
      .split(/\n\n---\n\n/u)
      .map((chapter) => chapter.trim())
      .filter(Boolean);
    const initialStyleGuard = resolvedLanguage === "zh"
      ? validateStyleGuard(creative.content, {
          previousChapters: styleGuardPreviousChapters,
          genre: book.genre,
          bookResourceRewards,
          bookActiveAttempts,
          bookPayoffRewards,
        })
      : undefined;
    let consistencyGuardManualIssues: ReadonlyArray<string> = [];
    if (initialStyleGuard && !initialStyleGuard.pass) {
      this.logWarn(resolvedLanguage, {
        zh: `Style guard：第${chapterNumber}章触发自动重写（${initialStyleGuard.issues.length}项）`,
        en: `Style guard: auto-rewriting chapter ${chapterNumber} (${initialStyleGuard.issues.length} issue(s))`,
      });
      const rewrite = await this.rewriteChapter(creative.content, initialStyleGuard.issues, {
        language: resolvedLanguage,
        chapterNumber,
        maxTokens: creativeMaxTokens,
      });
      creativeUsage = {
        promptTokens: creativeUsage.promptTokens + rewrite.usage.promptTokens,
        completionTokens: creativeUsage.completionTokens + rewrite.usage.completionTokens,
        totalTokens: creativeUsage.totalTokens + rewrite.usage.totalTokens,
      };
      const rewriteDecision = this.acceptWholeChapterRewrite({
        language: resolvedLanguage,
        chapterNumber,
        stage: "style-guard",
        beforeContent: creative.content,
        afterContent: rewrite.content,
        countingMode: resolvedLengthSpec.countingMode,
        minWholeChapterWords: this.minimumWholeChapterWords(resolvedLengthSpec),
      });
      if (rewriteDecision.accepted) {
        creative = {
          ...creative,
          content: rewrite.content,
          wordCount: rewriteDecision.afterWords,
        };
        creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
      }
      const consistencyGuard = validateConsistencyGuard(creative.content);
      if (!consistencyGuard.pass) {
        this.logWarn(resolvedLanguage, {
          zh: `Consistency guard：第${chapterNumber}章重写后仍有断裂，触发二次重写（${consistencyGuard.issues.length}项）`,
          en: `Consistency guard: second rewrite for chapter ${chapterNumber} (${consistencyGuard.issues.length} issue(s))`,
        });
        const secondRewrite = await this.rewriteChapter(creative.content, consistencyGuard.issues, {
          language: resolvedLanguage,
          chapterNumber,
          maxTokens: creativeMaxTokens,
        });
        creativeUsage = {
          promptTokens: creativeUsage.promptTokens + secondRewrite.usage.promptTokens,
          completionTokens: creativeUsage.completionTokens + secondRewrite.usage.completionTokens,
          totalTokens: creativeUsage.totalTokens + secondRewrite.usage.totalTokens,
        };
        const secondRewriteDecision = this.acceptWholeChapterRewrite({
          language: resolvedLanguage,
          chapterNumber,
          stage: "consistency-guard",
          beforeContent: creative.content,
          afterContent: secondRewrite.content,
          countingMode: resolvedLengthSpec.countingMode,
          minWholeChapterWords: this.minimumWholeChapterWords(resolvedLengthSpec),
        });
        if (secondRewriteDecision.accepted) {
          creative = {
            ...creative,
            content: secondRewrite.content,
            wordCount: secondRewriteDecision.afterWords,
          };
          creative = this.applyLockedScene1ToCreative(creative, lockedScene1, resolvedLengthSpec.countingMode);
        }
        const finalConsistencyGuard = validateConsistencyGuard(creative.content);
        if (!finalConsistencyGuard.pass) {
          consistencyGuardManualIssues = finalConsistencyGuard.issues;
        }
      }
    }
    if (payoffSuppression.suppressPayoff && this.findChapterIntentDriftPattern(creative.content)) {
      const cleanedContent = this.removeChapterIntentDriftParagraphs(creative.content);
      this.logWarn(resolvedLanguage, {
        zh: `chapter_intent-drift：最终正文仍含提前兑现信号，已拒绝偏移段落（第${chapterNumber}章）`,
        en: `chapter_intent-drift: final draft still contained early payoff signals; rejected drifting paragraphs (chapter ${chapterNumber})`,
      });
      creative = {
        ...creative,
        content: cleanedContent,
        wordCount: countChapterLength(cleanedContent, resolvedLengthSpec.countingMode),
      };
    }
    const resolvedTitle = resolveChapterTitle({
      language: resolvedLanguage,
      rawTitle: creative.title,
      chapterGoal,
      keyEvents: this.buildTitleKeyEvents({
        chapterGoal,
        contextPackage: input.contextPackage,
        currentState,
        relevantSummaries,
        externalContext: input.externalContext,
      }),
      recentTitles,
    }) ?? creative.title;

    // ── Phase 2: State settlement (temperature 0.3) ──
    this.logInfo(resolvedLanguage, {
      zh: `阶段 2：状态结算（第${chapterNumber}章，${creative.wordCount}字）`,
      en: `Phase 2: state settlement for chapter ${chapterNumber} (${creative.wordCount} words)`,
    });
    const isGovernedSettlement = Boolean(input.chapterIntent && input.contextPackage && input.ruleStack);
    const filteredHooksForSettlement = isGovernedSettlement && input.contextPackage
      ? buildGovernedHookWorkingSet({
          hooksMarkdown: hooks,
          contextPackage: input.contextPackage,
          chapterIntent: input.chapterIntent,
          chapterNumber,
          language: resolvedLanguage,
        })
      : hooks;
    const filteredSubplotsForSettlement = isGovernedSettlement
      ? filterSubplots(subplotBoard)
      : subplotBoard;
    const filteredArcsForSettlement = isGovernedSettlement
      ? filterEmotionalArcs(emotionalArcs, chapterNumber)
      : emotionalArcs;
    const filteredMatrixForSettlement = isGovernedSettlement
      ? buildGovernedCharacterMatrixWorkingSet({
          matrixMarkdown: characterMatrix,
          chapterIntent: input.chapterIntent ?? volumeOutline,
          contextPackage: input.contextPackage!,
          protagonistName: bookRules?.protagonist?.name,
        })
      : characterMatrix;

    const settleResult = await this.settle({
      book,
      genreProfile,
      bookRules,
      chapterNumber,
      title: resolvedTitle,
      content: creative.content,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks: filteredHooksForSettlement,
      chapterSummaries: input.contextPackage ? filterSummaries(chapterSummaries, chapterNumber) : chapterSummaries,
      subplotBoard: filteredSubplotsForSettlement,
      emotionalArcs: filteredArcsForSettlement,
      characterMatrix: filteredMatrixForSettlement,
      volumeOutline,
      selectedEvidenceBlock: governedMemoryBlocks
        ? this.joinGovernedEvidenceBlocks(governedMemoryBlocks)
        : undefined,
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      validationFeedback: undefined,
      originalHooks: hooks,
      originalSubplots: subplotBoard,
      originalEmotionalArcs: emotionalArcs,
      originalCharacterMatrix: characterMatrix,
    });
    const settlement = settleResult.settlement;
    const settleUsage = settleResult.usage;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      chapterNumber,
    );
    const reconciledSettlement = reconcileSettlementDiff({
      content: creative.content,
      chapterNumber,
      language: resolvedLanguage,
      oldState: currentState,
      oldHooks: hooks,
      oldLedger: ledger,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      updatedLedger: runtimeStateArtifacts ? (settlement.updatedLedger || ledger) : settlement.updatedLedger,
    });
    const resolvedRuntimeStateDelta = runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta;
    const priorHookIds = new Set(parsePendingHooksMarkdown(hooks).map((hook) => hook.hookId));
    const hookHealthIssues = resolvedRuntimeStateDelta
      && (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)
      ? analyzeHookHealth({
          language: resolvedLanguage,
          chapterNumber,
          targetChapters: book.targetChapters,
          hooks: (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)!.hooks.hooks,
          delta: resolvedRuntimeStateDelta,
          existingHookIds: [...priorHookIds],
        })
      : [];

    // ── Post-write validation (regex + rule-based, zero LLM cost) ──
    const ruleViolations = [
      ...validatePostWrite(creative.content, genreProfile, bookRules, resolvedLanguage, mergedSafetyProfile),
      ...detectCrossChapterRepetition(creative.content, fingerprintChapters, resolvedLanguage),
      ...detectParagraphLengthDrift(creative.content, fingerprintChapters, resolvedLanguage),
    ];
    const disciplineChecks = chapterGoal
      ? evaluateChapterGoalDiscipline(creative.content, chapterGoal)
      : undefined;
    const payoffImpactCheck = chapterGoal && !payoffSuppression.suppressPayoff
      ? evaluatePayoffImpact(creative.content, chapterGoal)
      : undefined;
    const endingTypeCheck = evaluateEndingTypeCompliance(
      creative.content,
      input.chapterIntent,
    );
    const disciplineWarnings = disciplineChecks
      ? toDisciplineWarnings(disciplineChecks, resolvedLanguage)
      : [];
    const endingTypeWarnings = toEndingTypeWarnings(endingTypeCheck, resolvedLanguage);
    const payoffImpactWarnings = payoffSuppression.suppressPayoff
      ? []
      : toPayoffImpactWarnings(payoffImpactCheck, resolvedLanguage);
    const normalizedDisciplineWarnings = disciplineWarnings.filter((warning) =>
      warning.rule !== "ending-hook-check"
      && !(payoffSuppression.suppressPayoff && warning.rule.startsWith("payoff")),
    );
    const cadenceDirectiveCheck = evaluateCadenceDirectiveCompliance(
      creative.content,
      input.chapterIntent,
    );
    const cadenceDirectiveWarnings = toCadenceDirectiveWarnings(cadenceDirectiveCheck, resolvedLanguage);
    const moodCadenceCheck = evaluateMoodCadenceCompliance(
      creative.content,
      input.chapterIntent,
    );
    const moodCadenceWarnings = toMoodCadenceWarnings(moodCadenceCheck, resolvedLanguage);
    const endingIsomorphismCheck = evaluateEndingIsomorphism(
      creative.content,
      recentEndingChapters,
    );
    const endingIsomorphismWarnings = toEndingIsomorphismWarnings(endingIsomorphismCheck, resolvedLanguage);
    const hookEmergenceCheck = evaluateHookEmergenceCompliance(
      creative.content,
      input.chapterIntent,
    );
    const hookEmergenceWarnings = toHookEmergenceWarnings(hookEmergenceCheck, resolvedLanguage);
    const resourceLedgerCheck = evaluateResourceLedgerDiscipline({
      content: creative.content,
      currentState,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      originalLedger: ledger,
      updatedLedger: settlement.updatedLedger,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      language: resolvedLanguage,
    });
    const resourceLedgerWarnings = toResourceLedgerWarnings(resourceLedgerCheck, resolvedLanguage);
    const hookDebtCheck = evaluateHookDebtThrottle({
      snapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      delta: resolvedRuntimeStateDelta,
      existingHookIds: [...priorHookIds],
    });
    const hookDebtWarnings = toHookDebtWarnings(hookDebtCheck, resolvedLanguage);
    const intentDeviationWarnings = this.detectChapterIntentDeviationWarnings({
      content: creative.content,
      chapterIntent: input.chapterIntent,
      payoffSuppression,
      language: resolvedLanguage,
    });
    const styleGuardWarnings = resolvedLanguage === "zh"
      ? this.toStyleGuardPostWriteViolations(validateStyleGuard(creative.content, {
          previousChapters: styleGuardPreviousChapters,
          genre: book.genre,
          bookResourceRewards,
          bookActiveAttempts,
          bookPayoffRewards,
        }))
      : [];
    const consistencyGuardWarnings = this.toConsistencyGuardPostWriteViolations(consistencyGuardManualIssues);
    const allWarnings = [
      ...ruleViolations,
      ...styleGuardWarnings,
      ...consistencyGuardWarnings,
      ...normalizedDisciplineWarnings,
      ...payoffImpactWarnings,
      ...endingTypeWarnings,
      ...cadenceDirectiveWarnings,
      ...moodCadenceWarnings,
      ...endingIsomorphismWarnings,
      ...hookEmergenceWarnings,
      ...resourceLedgerWarnings,
      ...hookDebtWarnings,
      ...intentDeviationWarnings,
    ];
    const aiTellIssues = analyzeAITells(creative.content, resolvedLanguage).issues;

    const postWriteErrors = allWarnings.filter(v => v.severity === "error");
    const postWriteWarnings = allWarnings.filter(v => v.severity === "warning");

    if (allWarnings.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `后写校验：第${chapterNumber}章 ${postWriteErrors.length} 个错误，${postWriteWarnings.length} 个警告`,
        en: `Post-write: ${postWriteErrors.length} errors, ${postWriteWarnings.length} warnings in chapter ${chapterNumber}`,
      });
      for (const v of allWarnings) {
        this.ctx.logger?.warn(`[${v.severity}] ${v.rule}: ${v.description}`);
      }
    }
    if (payoffSuppression.suppressPayoff) {
      this.logWarn(resolvedLanguage, {
        zh: `chapter_intent 抑制 payoff：${payoffSuppression.reason ?? "本章不得完整兑现旧 payoff"}`,
        en: `chapter_intent suppresses payoff: ${payoffSuppression.reason ?? "old payoff must not be fully materialized in this chapter"}`,
      });
    }
    if (aiTellIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `AI 味检查：第${chapterNumber}章发现 ${aiTellIssues.length} 个问题`,
        en: `AI-tell check: ${aiTellIssues.length} issues in chapter ${chapterNumber}`,
      });
      for (const issue of aiTellIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }
    if (hookHealthIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `伏笔健康：第${chapterNumber}章发现 ${hookHealthIssues.length} 条警告`,
        en: `Hook health: ${hookHealthIssues.length} warning(s) in chapter ${chapterNumber}`,
      });
      for (const issue of hookHealthIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }

    // ── Merge into WriteChapterOutput ──
    const tokenUsage: TokenUsage = {
      promptTokens: creativeUsage.promptTokens + settleUsage.promptTokens,
      completionTokens: creativeUsage.completionTokens + settleUsage.completionTokens,
      totalTokens: creativeUsage.totalTokens + settleUsage.totalTokens,
    };

    return {
      chapterNumber,
      title: resolvedTitle,
      content: creative.content,
      wordCount: creative.wordCount,
      preWriteCheck: creative.preWriteCheck,
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: resolvedRuntimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: reconciledSettlement.updatedState,
      updatedLedger: reconciledSettlement.updatedLedger,
      updatedHooks: reconciledSettlement.updatedHooks,
      chapterSummary: resolvedRuntimeStateDelta
        ? this.renderDeltaSummaryRow(resolvedRuntimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      settlementConfidence: reconciledSettlement.settlementConfidence,
      postWriteErrors,
      postWriteWarnings,
      endingHookCheck: disciplineChecks?.endingHookCheck,
      payoffCheck: disciplineChecks?.payoffCheck,
      payoffImpactCheck,
      moodCadenceCheck,
      resourceLedgerCheck,
      hookDebtCheck,
      hookHealthIssues,
      tokenUsage,
      isDegraded: reconciledSettlement.isDegraded,
    };
  }

  async settleChapterState(input: SettleChapterStateInput): Promise<WriteChapterOutput> {
    const [
      currentState,
      ledger,
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
    ] = await Promise.all([
      this.readFileOrDefault(join(input.bookDir, "story/current_state.md")),
      this.readFileOrDefault(join(input.bookDir, "story/particle_ledger.md")),
      this.readFileOrDefault(join(input.bookDir, "story/pending_hooks.md")),
      this.readFileOrDefault(join(input.bookDir, "story/chapter_summaries.md")),
      this.readFileOrDefault(join(input.bookDir, "story/subplot_board.md")),
      this.readFileOrDefault(join(input.bookDir, "story/emotional_arcs.md")),
      this.readFileOrDefault(join(input.bookDir, "story/character_matrix.md")),
      this.readFileOrDefault(join(input.bookDir, "story/volume_outline.md")),
    ]);

    const { profile: genreProfile } = await readGenreProfile(this.ctx.projectRoot, input.book.genre);
    const parsedBookRules = await readBookRules(input.bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const resolvedLanguage = input.book.language ?? genreProfile.language;
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;

    const settleResult = await this.settle({
      book: input.book,
      genreProfile,
      bookRules,
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
      selectedEvidenceBlock: governedMemoryBlocks
        ? this.joinGovernedEvidenceBlocks(governedMemoryBlocks)
        : undefined,
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      validationFeedback: input.validationFeedback,
      originalHooks: hooks,
      originalSubplots: subplotBoard,
      originalEmotionalArcs: emotionalArcs,
      originalCharacterMatrix: characterMatrix,
    });
    const settlement = settleResult.settlement;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      input.bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      input.chapterNumber,
      input.allowReapply,
    );
    const reconciledSettlement = reconcileSettlementDiff({
      content: input.content,
      chapterNumber: input.chapterNumber,
      language: resolvedLanguage,
      oldState: currentState,
      oldHooks: hooks,
      oldLedger: ledger,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      updatedLedger: runtimeStateArtifacts ? (settlement.updatedLedger || ledger) : settlement.updatedLedger,
    });

    return {
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      wordCount: countChapterLength(
        input.content,
        resolvedLanguage === "en" ? "en_words" : "zh_chars",
      ),
      preWriteCheck: "",
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: reconciledSettlement.updatedState,
      updatedLedger: reconciledSettlement.updatedLedger,
      updatedHooks: reconciledSettlement.updatedHooks,
      chapterSummary: settlement.runtimeStateDelta
        ? this.renderDeltaSummaryRow(settlement.runtimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      settlementConfidence: reconciledSettlement.settlementConfidence,
      postWriteErrors: [],
      postWriteWarnings: [],
      endingHookCheck: undefined,
      payoffCheck: undefined,
      payoffImpactCheck: undefined,
      resourceLedgerCheck: undefined,
      hookDebtCheck: undefined,
      tokenUsage: settleResult.usage,
      isDegraded: reconciledSettlement.isDegraded,
    };
  }

  private readChapterGoalFromIntentMarkdown(chapterIntent: string | undefined): ChapterGoal | undefined {
    if (!chapterIntent) {
      return undefined;
    }

    const section = this.extractMarkdownSection(chapterIntent, "## Chapter Goal");
    if (!section) {
      return undefined;
    }

    const entries = new Map<string, string>();
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("-")) continue;
      const body = trimmed.replace(/^-\s*/, "");
      const separator = body.indexOf(":");
      if (separator < 0) continue;
      const key = body.slice(0, separator).trim();
      const value = body.slice(separator + 1).trim();
      if (!key || !value || value === "none") continue;
      entries.set(key, value);
    }

    const mainConflict = entries.get("mainConflict");
    const protagonistGoal = entries.get("protagonistGoal");
    const payoffToDeliver = entries.get("payoffToDeliver");
    const payoffDirectivePromisedPayoff = entries.get("payoffDirective.promisedPayoff");
    const payoffDirectivePayoffType = entries.get("payoffDirective.payoffType");
    const payoffDirectivePayoffDepth = entries.get("payoffDirective.payoffDepth");
    const payoffDirectiveMandatory = entries.get("payoffDirective.mandatoryByFinalAct");
    const endingHookType = entries.get("endingHookType");
    const endingType = entries.get("endingType") ?? this.extractEndingTypeFromIntentMarkdown(chapterIntent);
    const nextChapterPull = entries.get("nextChapterPull");
    if (!mainConflict || !protagonistGoal || !payoffToDeliver || !nextChapterPull) {
      return undefined;
    }

    const resolvedEndingHookType = this.resolveLegacyEndingHookType({
      endingType,
      endingHookType,
    });

    return {
      mainConflict,
      protagonistGoal,
      activeCharacters: this.splitInlineList(entries.get("activeCharacters")),
      foreshadowToTouch: this.splitInlineList(entries.get("foreshadowToTouch")),
      payoffToDeliver,
      ...(payoffDirectivePromisedPayoff && payoffDirectivePayoffType
        ? {
          payoffDirective: {
            promisedPayoff: payoffDirectivePromisedPayoff,
            payoffType: payoffDirectivePayoffType as "reveal" | "resource" | "breakthrough" | "relationship" | "reversal",
            payoffDepth: payoffDirectivePayoffDepth === "shallow" || payoffDirectivePayoffDepth === "deep"
              ? payoffDirectivePayoffDepth
              : "layered",
            mandatoryByFinalAct: payoffDirectiveMandatory !== "false",
          },
        }
        : {}),
      endingHookType: resolvedEndingHookType,
      nextChapterPull,
    };
  }

  private extractEndingTypeFromIntentMarkdown(chapterIntent: string | undefined): "reveal_end" | "unresolved_end" | "resolution_end" | "twist_end" | "calm_end" | undefined {
    if (!chapterIntent) {
      return undefined;
    }
    const match = chapterIntent.match(/## Structured Directives[\s\S]*?-\s*endingType:\s*(reveal_end|unresolved_end|resolution_end|twist_end|calm_end)/i);
    return match?.[1]?.toLowerCase() as "reveal_end" | "unresolved_end" | "resolution_end" | "twist_end" | "calm_end" | undefined;
  }

  private resolveLegacyEndingHookType(input: {
    readonly endingType?: string;
    readonly endingHookType?: string;
  }): ChapterGoal["endingHookType"] {
    if (input.endingType) {
      switch (input.endingType) {
        case "reveal_end":
          return "reveal";
        case "unresolved_end":
          return "danger";
        case "resolution_end":
          return "breakthrough";
        case "twist_end":
          return "choice";
        case "calm_end":
          return "choice";
      }
    }

    if (input.endingHookType && ["danger", "reveal", "pursuit", "choice", "breakthrough"].includes(input.endingHookType)) {
      return input.endingHookType as ChapterGoal["endingHookType"];
    }

    return "danger";
  }

  private splitInlineList(value: string | undefined): string[] {
    if (!value || value === "none") {
      return [];
    }

    return value
      .split(/,|，|、/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private toStyleGuardPostWriteViolations(result: ReturnType<typeof validateStyleGuard>): PostWriteViolation[] {
    if (result.pass) return [];
    return result.issues.map((issue) => {
      const high = issue.startsWith("[high]");
      return {
        rule: "style-guard",
        severity: high ? "error" : "warning",
        description: issue.replace(/^\[(high|low)\]\s*/u, ""),
        suggestion: high
          ? "重写为事件触发、具体线索推进、具体悬念收尾；删除模板句和复读流程。"
          : "补入动作、异象或物理反馈，避免总结式开头。",
      };
    });
  }

  private toConsistencyGuardPostWriteViolations(issues: ReadonlyArray<string>): PostWriteViolation[] {
    return issues.map((issue) => ({
      rule: "consistency-guard",
      severity: "warning",
      description: `自动重写后仍需人工 review：${issue}`,
      suggestion: "人工检查重写段前后衔接、人物状态、道具连续性和节奏断裂；必要时局部手修。",
    }));
  }

  private async rewriteChapter(
    chapter: string,
    issues: ReadonlyArray<string>,
    params: {
      readonly language: "zh" | "en";
      readonly chapterNumber: number;
      readonly maxTokens: number;
    },
  ): Promise<{ readonly content: string; readonly usage: TokenUsage }> {
    const response = await this.chat(
      [
        {
          role: "system",
          content: params.language === "en"
            ? "You are a style-guard rewrite editor. Fix only the flagged prose problems. Preserve plot, character actions, setting facts, event order, combat outcomes, items, and all key information."
            : "你是章节风格校验后的自动修稿编辑。只修复被指出的写作风格问题，必须保留剧情、人物行为、设定事实、事件顺序、战斗结果、道具和关键信息。",
        },
        {
          role: "user",
          content: this.buildStyleGuardRewritePrompt(chapter, issues, params.language),
        },
      ],
      { maxTokens: params.maxTokens, temperature: 0.25 },
    );

    return {
      content: this.extractRewriteChapterContent(response.content),
      usage: response.usage,
    };
  }

  private buildStyleGuardRewritePrompt(
    chapter: string,
    issues: ReadonlyArray<string>,
    language: "zh" | "en",
  ): string {
    if (language === "en") {
      return `Fix the style issues in the chapter below.

Issues:
${issues.map((issue) => `- ${issue}`).join("\n")}

Requirements:
- Do not change the plot.
- Do not change character behavior.
- Do not change worldbuilding, event order, combat outcomes, item gains/losses, or key information.
- Only modify the sentences or paragraphs related to the listed issues.
- Replace template phrases with concrete sensory, physical, or object-driven details.
- Break repeated structure by changing expression and scene emphasis, not by adding new plot.
- Output the complete repaired chapter text only. Do not explain.

Chapter:
${chapter}`;
    }

    return `你需要修复以下章节的写作风格问题：

问题：
${issues.map((issue) => `- ${issue}`).join("\n")}

要求：
- 不改变剧情
- 不改变人物行为
- 不改变设定
- 不改变事件顺序
- 不改变战斗结果
- 不删除关键道具、线索、状态变化或关键信息
- 只修改存在问题的句子或段落

重点：
- 替换模板句
- 增加具体感官、动作或物理反馈
- 打散重复结构，但不得新增关键设定或新剧情
- 输出完整修复后的章节正文，不要解释，不要输出报告

原章节：
${chapter}`;
  }

  private extractRewriteChapterContent(raw: string): string {
    const tagged = raw.match(/===\s*CHAPTER_CONTENT\s*===\s*([\s\S]*?)(?====\s*[A-Z_]+\s*===|$)/);
    if (tagged?.[1]?.trim()) {
      return tagged[1].trim();
    }
    return raw
      .replace(/^```(?:markdown|md|text)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }

  private extractHookEmergenceDirectiveFromIntentMarkdown(chapterIntent: string | undefined): {
    readonly mustMaterializeHookNow: boolean;
    readonly hookExecutionPhase?: "any" | "late";
    readonly targetHookId?: string;
    readonly targetHookState?: string;
    readonly targetHookExpectedPayoff?: string;
    readonly targetHookNotes?: string;
  } | undefined {
    const section = this.extractMarkdownSection(chapterIntent ?? "", "## Hook Agenda");
    if (!section) {
      return undefined;
    }

    const mustMaterializeHookNow = /mustMaterializeHookNow:\s*true/i.test(section);
    if (!mustMaterializeHookNow) {
      return undefined;
    }

    return {
      mustMaterializeHookNow: true,
      ...(section.match(/hookExecutionPhase:\s*(any|late)/i)?.[1]?.trim()
        ? { hookExecutionPhase: section.match(/hookExecutionPhase:\s*(any|late)/i)?.[1]?.trim().toLowerCase() as "any" | "late" }
        : {}),
      ...(section.match(/targetHookId:\s*(.+)/i)?.[1]?.trim() ? { targetHookId: section.match(/targetHookId:\s*(.+)/i)?.[1]?.trim() } : {}),
      ...(section.match(/targetHookState:\s*(.+)/i)?.[1]?.trim() ? { targetHookState: section.match(/targetHookState:\s*(.+)/i)?.[1]?.trim() } : {}),
      ...(section.match(/targetHookExpectedPayoff:\s*(.+)/i)?.[1]?.trim() ? { targetHookExpectedPayoff: section.match(/targetHookExpectedPayoff:\s*(.+)/i)?.[1]?.trim() } : {}),
      ...(section.match(/targetHookNotes:\s*(.+)/i)?.[1]?.trim() ? { targetHookNotes: section.match(/targetHookNotes:\s*(.+)/i)?.[1]?.trim() } : {}),
    };
  }

  private async settle(params: {
    readonly book: BookConfig;
    readonly genreProfile: GenreProfile;
    readonly bookRules: BookRules | null;
    readonly chapterNumber: number;
    readonly title: string;
    readonly content: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly volumeOutline: string;
    readonly selectedEvidenceBlock?: string;
    readonly chapterIntent?: string;
    readonly contextPackage?: ContextPackage;
    readonly ruleStack?: RuleStack;
    readonly validationFeedback?: string;
    readonly originalHooks: string;
    readonly originalSubplots: string;
    readonly originalEmotionalArcs: string;
    readonly originalCharacterMatrix: string;
  }): Promise<{
    settlement: ReturnType<typeof parseSettlementOutput> & {
      runtimeStateDelta?: RuntimeStateDelta;
      runtimeStateSnapshot?: RuntimeStateSnapshot;
    };
    usage: TokenUsage;
  }> {
    // Phase 2a: Observer — extract all facts from the chapter
    const resolvedLang = params.book.language ?? params.genreProfile.language;
    const observerSystem = buildObserverSystemPrompt(params.book, params.genreProfile, resolvedLang);
    const observerUser = buildObserverUserPrompt(params.chapterNumber, params.title, params.content, resolvedLang);

    this.logInfo(resolvedLang, {
      zh: `阶段 2a：提取第${params.chapterNumber}章事实`,
      en: `Phase 2a: observing facts for chapter ${params.chapterNumber}`,
    });
    const observerResponse = await this.chat(
      [
        { role: "system", content: observerSystem },
        { role: "user", content: observerUser },
      ],
      { temperature: 0.5 },
    );
    const observations = observerResponse.content;

    // Phase 2b: Reflector — merge observations into truth files
    this.logInfo(resolvedLang, {
      zh: "阶段 2b：把观察结果回写到真相文件",
      en: "Phase 2b: reflecting observations into truth files",
    });
    const settlerSystem = buildSettlerSystemPrompt(
      params.book, params.genreProfile, params.bookRules, resolvedLang,
    );
    const governedControlBlock = params.chapterIntent && params.contextPackage && params.ruleStack
      ? this.buildSettlerGovernedControlBlock(
          params.chapterIntent,
          params.contextPackage,
          params.ruleStack,
          resolvedLang,
        )
      : undefined;

    const settlerUser = buildSettlerUserPrompt({
      chapterNumber: params.chapterNumber,
      title: params.title,
      content: params.content,
      currentState: params.currentState,
      ledger: params.ledger,
      hooks: params.hooks,
      chapterSummaries: params.chapterSummaries,
      subplotBoard: params.subplotBoard,
      emotionalArcs: params.emotionalArcs,
      characterMatrix: params.characterMatrix,
      volumeOutline: params.volumeOutline,
      observations,
      selectedEvidenceBlock: params.selectedEvidenceBlock,
      governedControlBlock,
      validationFeedback: params.validationFeedback,
    });

    // Settler outputs all truth files — scale with content size
    const settlerMaxTokens = Math.max(8192, Math.ceil(params.content.length * 0.8));

    const response = await this.chat(
      [
        { role: "system", content: settlerSystem },
        { role: "user", content: settlerUser },
      ],
      { maxTokens: settlerMaxTokens, temperature: 0.3 },
    );

    let mergedSettlement: ReturnType<typeof parseSettlementOutput> & {
      runtimeStateDelta?: RuntimeStateDelta;
      runtimeStateSnapshot?: RuntimeStateSnapshot;
    };
    try {
      const deltaOutput = parseSettlerDeltaOutput(response.content);
      mergedSettlement = {
        postSettlement: deltaOutput.postSettlement,
        runtimeStateDelta: deltaOutput.runtimeStateDelta,
        updatedState: "",
        updatedLedger: "",
        updatedHooks: "",
        chapterSummary: "",
        updatedSubplots: "",
        updatedEmotionalArcs: "",
        updatedCharacterMatrix: "",
      };
    } catch {
      const settlement = parseSettlementOutput(response.content, params.genreProfile);
      mergedSettlement = governedControlBlock
        ? {
            ...settlement,
            updatedHooks: mergeTableMarkdownByKey(params.originalHooks, settlement.updatedHooks, [0]),
            updatedSubplots: settlement.updatedSubplots
              ? mergeTableMarkdownByKey(params.originalSubplots, settlement.updatedSubplots, [0])
              : settlement.updatedSubplots,
            updatedEmotionalArcs: settlement.updatedEmotionalArcs
              ? mergeTableMarkdownByKey(params.originalEmotionalArcs, settlement.updatedEmotionalArcs, [0, 1])
              : settlement.updatedEmotionalArcs,
            updatedCharacterMatrix: settlement.updatedCharacterMatrix
              ? mergeCharacterMatrixMarkdown(params.originalCharacterMatrix, settlement.updatedCharacterMatrix)
              : settlement.updatedCharacterMatrix,
          }
        : settlement;
    }

    return {
      settlement: mergedSettlement,
      usage: response.usage,
    };
  }

  async saveChapter(
    bookDir: string,
    output: WriteChapterOutput,
    numericalSystem: boolean = true,
    language: "zh" | "en" = "zh",
  ): Promise<void> {
    const chaptersDir = join(bookDir, "chapters");
    const storyDir = join(bookDir, "story");
    await mkdir(chaptersDir, { recursive: true });

    const paddedNum = String(output.chapterNumber).padStart(4, "0");
    const filename = `${paddedNum}_${this.sanitizeFilename(output.title)}.md`;

    const heading = language === "en"
      ? `# Chapter ${output.chapterNumber}: ${output.title}`
      : `# 第${output.chapterNumber}章 ${output.title}`;
    const chapterContent = [
      heading,
      "",
      output.content,
    ].join("\n");
    const runtimeStateArtifacts = await this.resolveRuntimeStateArtifactsForOutput(
      bookDir,
      output,
      language,
    );

    const writes: Array<Promise<void>> = [
      writeFile(join(chaptersDir, filename), chapterContent, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), runtimeStateArtifacts?.currentStateMarkdown ?? output.updatedState, "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), runtimeStateArtifacts?.hooksMarkdown ?? output.updatedHooks, "utf-8"),
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify(
          this.buildForeshadowRegistry(
            runtimeStateArtifacts?.hooksMarkdown ?? output.updatedHooks,
          ),
          null,
          2,
        ) + "\n",
        "utf-8",
      ),
    ];

    if (runtimeStateArtifacts?.chapterSummariesMarkdown) {
      writes.push(
        writeFile(join(storyDir, "chapter_summaries.md"), runtimeStateArtifacts.chapterSummariesMarkdown, "utf-8"),
      );
    }

    if (runtimeStateArtifacts?.snapshot ?? output.runtimeStateSnapshot) {
      writes.push(saveRuntimeStateSnapshot(bookDir, runtimeStateArtifacts?.snapshot ?? output.runtimeStateSnapshot!));
    }

    if (numericalSystem) {
      writes.push(
        writeFile(join(storyDir, "particle_ledger.md"), output.updatedLedger, "utf-8"),
      );
    }

    await Promise.all(writes);
  }

  private buildUserPrompt(params: {
    readonly chapterNumber: number;
    readonly storyBible: string;
    readonly volumeOutline: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly recentChapters: string;
    readonly lengthSpec: LengthSpec;
    readonly externalContext?: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly dialogueFingerprints?: string;
    readonly relevantSummaries?: string;
    readonly parentCanon?: string;
    readonly language?: "zh" | "en";
    readonly titleCandidates?: ReadonlyArray<{ readonly style: string; readonly title: string }>;
    readonly moodDirective?: MoodDirective;
    readonly chapterGoal?: ChapterGoal;
    readonly resourcePlan?: ChapterResourcePlan;
    readonly hookEmergenceDirective?: {
      readonly mustMaterializeHookNow: boolean;
      readonly targetHookId?: string;
      readonly targetHookState?: string;
      readonly targetHookExpectedPayoff?: string;
      readonly targetHookNotes?: string;
    };
    readonly patternBreakerDirective?: string;
    readonly retryHint?: string;
    readonly retryHintPath?: string;
  }): string {
    const contextBlock = params.externalContext
      ? `\n## 外部指令\n以下是来自外部系统的创作指令，请在本章中融入：\n\n${params.externalContext}\n`
      : "";
    const retryHintBlock = this.buildRetryHintBlock(params.retryHint, params.retryHintPath, params.language ?? "zh");

    const ledgerBlock = params.ledger
      ? `\n## 资源账本\n${params.ledger}\n`
      : "";

    const summariesBlock = params.chapterSummaries !== "(文件尚未创建)"
      ? `\n## 章节摘要（全部历史章节压缩上下文）\n${params.chapterSummaries}\n`
      : "";

    const subplotBlock = params.subplotBoard !== "(文件尚未创建)"
      ? `\n## 支线进度板\n${params.subplotBoard}\n`
      : "";

    const emotionalBlock = params.emotionalArcs !== "(文件尚未创建)"
      ? `\n## 情感弧线\n${params.emotionalArcs}\n`
      : "";

    const matrixBlock = params.characterMatrix !== "(文件尚未创建)"
      ? `\n## 角色交互矩阵\n${params.characterMatrix}\n`
      : "";

    const fingerprintBlock = params.dialogueFingerprints
      ? `\n## 角色对话指纹\n${params.dialogueFingerprints}\n`
      : "";

    const relevantBlock = params.relevantSummaries
      ? `\n## 相关历史章节摘要\n${params.relevantSummaries}\n`
      : "";

    const canonBlock = params.parentCanon
      ? `\n## 正传正典参照（番外写作专用）
本书是番外作品。以下正典约束不可违反，角色不得引用超出其信息边界的信息。
${params.parentCanon}\n`
      : "";
    const titleBlock = this.buildTitleCandidatesBlock(params.titleCandidates, params.language ?? "zh");
    const modeLockBlock = this.buildFirstPassModeLockBlock(params.moodDirective, params.language ?? "zh");
    const moodDirectiveBlock = this.buildMoodDirectiveBlock(params.moodDirective, params.language ?? "zh");
    const characterAuthenticityBlock = this.buildCharacterAuthenticityBlock(params.language ?? "zh");
    const payoffDirectiveBlock = this.buildPayoffDirectiveBlock(params.chapterGoal, params.language ?? "zh");
    const hookEmergenceDirectiveBlock = this.buildHookEmergenceDirectiveBlock({
      directive: params.hookEmergenceDirective,
      language: params.language ?? "zh",
    });
    const patternBreakerBlock = params.patternBreakerDirective
      ? `\n${params.patternBreakerDirective}\n`
      : "";
    const resourcePlanBlock = params.resourcePlan
      ? `\n${renderResourcePlanForPrompt(params.resourcePlan, "writer")}\n`
      : "";
    const resourcePlanPriorityBlock = params.resourcePlan
      ? params.language === "en"
        ? "\n⚠️ The resource plan below takes priority over all other instructions. If the resource plan conflicts with the volume outline or current state, obey the resource plan.\n"
        : "\n⚠️ 以下资源计划优先级高于其他所有指令。如果资源计划与卷纲/状态卡有冲突，以资源计划为准。\n"
      : "";
    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.
${modeLockBlock}
${retryHintBlock}
${contextBlock}
## Current State
${params.currentState}
${ledgerBlock}
## Plot Threads
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
${titleBlock}
${moodDirectiveBlock}
${characterAuthenticityBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
${resourcePlanPriorityBlock}${resourcePlanBlock}
${patternBreakerBlock}
## Recent Chapters
${params.recentChapters || "(This is the first chapter, no previous text)"}

## Worldbuilding
${params.storyBible}

## Volume Outline (Hard Constraint — Must Follow)
${params.volumeOutline}

[Outline Rules]
- This chapter must advance the plot points assigned to it in the volume outline. Do not skip ahead or consume future plot points.
- If the outline specifies an event for chapter N, do not resolve it early.
- Pacing must match the outline's chapter span: if 5 chapters are planned for an arc, do not compress into 1-2.
- PRE_WRITE_CHECK must identify which outline node this chapter covers.

${lengthRequirementBlock}
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

    return `请续写第${params.chapterNumber}章。
${modeLockBlock}
${retryHintBlock}
${contextBlock}
## 当前状态卡
${params.currentState}
${ledgerBlock}
## 伏笔池
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
${titleBlock}
${moodDirectiveBlock}
${characterAuthenticityBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
${resourcePlanPriorityBlock}${resourcePlanBlock}
${patternBreakerBlock}
## 最近章节
${params.recentChapters || "(这是第一章，无前文)"}

## 世界观设定
${params.storyBible}

## 卷纲（硬约束——必须遵守）
${params.volumeOutline}

【卷纲遵守规则】
- 本章内容必须对应卷纲中当前章节范围内的剧情节点，严禁跳过或提前消耗后续节点
- 如果卷纲指定了某个事件/转折发生在第N章，不得提前到本章完成
- 剧情推进速度必须与卷纲规划的章节跨度匹配：如果卷纲规划某段剧情跨5章，不得在1-2章内讲完
- PRE_WRITE_CHECK中必须明确标注本章对应的卷纲节点

${lengthRequirementBlock}
- 先输出写作自检表，再写正文
      - 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }

  private async generateLockedBreathScene1(params: {
    readonly systemPrompt: string;
    readonly baseUserPrompt: string;
    readonly language: "zh" | "en";
    readonly chapterNumber: number;
    readonly maxTokens: number;
    readonly temperature: number;
    readonly chapterIntent?: string;
    readonly countingMode: LengthSpec["countingMode"];
    readonly onUsage: (usage: TokenUsage) => void;
  }): Promise<string | undefined> {
    let accumulatedUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let lastScene1: string | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await this.chat(
        [
          {
            role: "system",
            content: this.buildBreathPhase1SystemPrompt(params.language),
          },
          {
            role: "user",
            content: this.buildBreathPhase1UserPrompt({
              baseUserPrompt: params.baseUserPrompt,
              language: params.language,
              chapterNumber: params.chapterNumber,
              previousScene1: lastScene1,
              previousFailure: lastScene1 ? this.describePhase1PurityFailure(lastScene1, params.language) : undefined,
            }),
          },
        ],
        { maxTokens: params.maxTokens, temperature: params.temperature },
      );
      accumulatedUsage = {
        promptTokens: accumulatedUsage.promptTokens + response.usage.promptTokens,
        completionTokens: accumulatedUsage.completionTokens + response.usage.completionTokens,
        totalTokens: accumulatedUsage.totalTokens + response.usage.totalTokens,
      };

      const scene1 = this.extractLockedScene1(response.content);
      lastScene1 = scene1;
      if (scene1 && this.lockedScene1PassesBreathGate(scene1, params.chapterIntent) && this.phase1SemanticPurityPasses(scene1)) {
        params.onUsage(accumulatedUsage);
        return scene1;
      }
    }

    this.logWarn(params.language, {
      zh: `Phase1 Scene1 连续未通过语义纯净自检，使用安全模板兜底。`,
      en: "Phase1 Scene1 failed semantic purity self-check repeatedly; using safe fallback template.",
    });
    params.onUsage(accumulatedUsage);
    return this.buildFallbackBreathScene1(params.language);
  }

  private buildBreathPhase1SystemPrompt(language: "zh" | "en"): string {
    if (language === "en") {
      return [
        "You are generating ONLY the locked first scene for a breath-mode chapter.",
        "Phase1 output is locked and cannot be overwritten by later rewrites.",
        "Generate only [Scene1]. Do not generate title, PRE_WRITE_CHECK, Scene2, Scene3, payoff, hook advancement, threat, pressure, or death semantics.",
        "Scene1 must feel safe, slow, and temporarily stable. No tension buildup, no foreshadowing of danger.",
        "Forbidden semantic categories: imminent danger, tense/oppressive atmosphere, unease/omen/abnormality, unknown presence approaching.",
        "Allowed semantic categories only: fatigue, pain, light recovery, character dialogue, neutral static environment description.",
      ].join("\n");
    }

    return [
      "你只负责生成 breath 章节的锁定开头 Scene1。",
      "Phase1 输出会被锁定，后续 rewrite 不得覆盖。",
      "只输出 [Scene1]，不要输出标题、PRE_WRITE_CHECK、Scene2、Scene3、payoff、hook 推进、威胁、压力或死亡语义。",
      "Scene1 must feel safe, slow, and temporarily stable. No tension buildup, no foreshadowing of danger.",
      "禁止语义类别：即将发生危险、紧张/压迫氛围、不安/预兆/异常、未知存在靠近。",
      "只允许语义类别：疲惫、疼痛、轻微恢复、人物对话、中性静态环境描写。",
    ].join("\n");
  }

  private buildBreathPhase1UserPrompt(params: {
    readonly baseUserPrompt: string;
    readonly language: "zh" | "en";
    readonly chapterNumber: number;
    readonly previousScene1?: string;
    readonly previousFailure?: string;
  }): string {
    const retryBlock = params.previousScene1
      ? params.language === "en"
        ? [
          "",
          "## Previous Scene1 failed Phase1 semantic purity self-check",
          params.previousFailure ?? "semantic purity failed",
          "Rewrite Scene1 from scratch as safe, slow, temporarily stable recovery/character material.",
          params.previousScene1,
        ].join("\n")
        : [
          "",
          "## 上一次 Scene1 未通过 Phase1 语义纯净自检",
          params.previousFailure ?? "语义纯净失败",
          "请从头重写 Scene1，让它成为安全、缓慢、暂时稳定的恢复/人物场景。",
          params.previousScene1,
        ].join("\n")
      : "";

    if (params.language === "en") {
      return [
        `Generate Phase1 Scene1 for chapter ${params.chapterNumber}.`,
        "Hard requirements:",
        "- Output only [Scene1] followed by the scene text.",
        "- Scene1 is the first 30% of the chapter.",
        "- Scene1 must be pure recovery / character expression.",
        "- Scene1 must feel safe, slow, and temporarily stable.",
        "- Use only character state, injury care, body sensation, dialogue, relationship movement, and emotion unfolding.",
        "- Forbidden: threat, rule pressure, pursuit pressure, storm signals, death semantics, conflict escalation, payoff, hook advancement.",
        "- Also forbidden: tension buildup, oppressive atmosphere, unease, omen, abnormality, or unknown presence approaching.",
        "- Allowed only: fatigue, pain, light recovery, character dialogue, neutral static environment description.",
        "- Phase2 will handle payoff, hook, and forward motion later.",
        retryBlock,
        "## Base chapter context for reference only",
        params.baseUserPrompt,
      ].join("\n");
    }

    return [
      `生成第${params.chapterNumber}章 Phase1 Scene1。`,
      "硬要求：",
      "- 只输出 [Scene1] 和 scene1 正文。",
      "- Scene1 是章节前 30%。",
      "- Scene1 必须是纯 recovery / character：人物状态、伤势处理、身体感知、对话、关系变化、情绪展开。",
      "- Scene1 must feel safe, slow, and temporarily stable.",
      "- 禁止：威胁、规则压力、追杀压力、风暴信号、死亡语义、冲突升级、payoff、hook 推进。",
      "- 也禁止：紧张/压迫氛围、不安、预兆、异常、未知存在靠近。",
      "- 只允许：疲惫、疼痛、轻微恢复、人物对话、中性静态环境描写。",
      "- payoff、hook、剧情推进全部留给 Phase2。",
      retryBlock,
      "## 基础章节上下文（只供参考）",
      params.baseUserPrompt,
    ].join("\n");
  }

  private phase1SemanticPurityPasses(scene1: string): boolean {
    return !this.findPhase1SemanticImpurity(scene1);
  }

  private describePhase1PurityFailure(scene1: string, language: "zh" | "en"): string {
    const match = this.findPhase1SemanticImpurity(scene1);
    if (language === "en") {
      return match
        ? `Forbidden implicit pressure semantic detected: ${match}`
        : "Forbidden implicit pressure semantic detected.";
    }
    return match
      ? `检测到隐性压力语义：${match}`
      : "检测到隐性压力语义。";
  }

  private findPhase1SemanticImpurity(scene1: string): string | undefined {
    const patterns = [
      /像是[^。！？\n]{0,18}(异常|不安|预兆|危险|有人|什么东西|靠近|逼近|压迫|风暴)/u,
      /仿佛[^。！？\n]{0,18}(异常|不安|预兆|危险|有人|什么东西|靠近|逼近|压迫|风暴)/u,
      /似乎[^。！？\n]{0,18}(异常|不安|预兆|危险|有人|什么东西|靠近|逼近|压迫|风暴)/u,
      /沉默[^。！？\n]{0,8}(太久|过长|久得)[^。！？\n]{0,18}(异常|不安|压抑|压迫|怪|冷)/u,
      /紧张|不安|压抑|压迫|预兆|异常|异样|未知.{0,8}(?:靠近|逼近|接近)|靠近|逼近|危险将至|危险临近|似乎有什么|有什么在|阴影|寒意逼近|杀机|威胁|风暴|omen|unease|oppressive|tension|abnormal|unknown presence|approach(?:ing)?|closing in|foreshadow(?:ing)? danger/iu,
    ];
    return patterns
      .map((pattern) => scene1.match(pattern)?.[0])
      .find((value): value is string => Boolean(value));
  }

  private buildFallbackBreathScene1(language: "zh" | "en"): string {
    if (language === "en") {
      return [
        "He sat down with his back against the wall.",
        "",
        "His breathing slowed, one breath at a time.",
        "",
        "Warmth had returned to his palm, though his knuckles still trembled.",
        "",
        "The stone beneath him was cool and steady. Nearby water dripped in a slow, even rhythm.",
        "",
        "Yun Lan handed him the water flask.",
        "",
        "\"Can you keep going?\"",
        "",
        "He nodded without answering.",
        "",
        "His throat was dry.",
        "",
        "But at least he could stand again.",
      ].join("\n");
    }

    return [
      "他靠坐下来，背抵着石壁。",
      "",
      "呼吸一下一下缓下来。",
      "",
      "掌心的温度已经回升，但指节还在发抖。",
      "",
      "身后的石壁很凉，水声从远处慢慢滴下来。",
      "",
      "云岚把水递过来。",
      "",
      "“还能撑吗？”",
      "",
      "他点了点头，没有说话。",
      "",
      "喉咙发干。",
      "",
      "但至少还能走。",
    ].join("\n");
  }

  private buildLockedScene1Phase2Block(scene1: string, language: "zh" | "en"): string {
    if (language === "en") {
      return [
        "",
        "## TWO-PHASE GENERATION LOCK",
        "Phase1 has already generated [Scene1]. It is locked.",
        "You must generate the remaining 70% around this exact Scene1.",
        "Do not rewrite, summarize, shorten, extend, or replace LOCKED_SCENE1.",
        "Only after LOCKED_SCENE1 may you introduce payoff, hook movement, or low-intensity forward motion.",
        "",
        "=== LOCKED_SCENE1 ===",
        "[Scene1]",
        scene1,
        "=== END_LOCKED_SCENE1 ===",
        "",
      ].join("\n");
    }

    return [
      "",
      "## TWO-PHASE GENERATION LOCK",
      "Phase1 已经生成 [Scene1]，该段已锁定。",
      "你必须围绕这个精确 Scene1 生成剩余 70%。",
      "不得重写、概括、缩短、扩写或替换 LOCKED_SCENE1。",
      "只有在 LOCKED_SCENE1 之后，才允许进入 payoff、hook 推进或低强度前推。",
      "",
      "=== LOCKED_SCENE1 ===",
      "[Scene1]",
      scene1,
      "=== END_LOCKED_SCENE1 ===",
      "",
    ].join("\n");
  }

  private extractLockedScene1(raw: string): string | undefined {
    const parsed = parseCreativeOutput(0, raw, "zh_chars");
    const source = parsed.content.trim().length > 0 ? parsed.content : raw;
    const normalized = source.replace(/\r\n/g, "\n").trim();
    const sceneMatch = normalized.match(/\[Scene\s*1\]\s*([\s\S]*?)(?=\n\s*\[Scene\s*2\]|\n\s*===|$)/i);
    const scene = (sceneMatch?.[1] ?? normalized.replace(/^\s*\[Scene\s*1\]\s*/i, "")).trim();
    return scene.length > 0 ? scene : undefined;
  }

  private lockedScene1PassesBreathGate(scene1: string, chapterIntent?: string): boolean {
    const intent = chapterIntent ?? [
      "## Structured Directives",
      "- mood:",
      "  - targetMode: breath",
      "  - requiredSceneQuota: 1",
      "  - moodCoverageMin: 0.3",
      "  - forbidDominantMode: combat-heavy",
    ].join("\n");
    const probe = [
      "[Scene1]",
      scene1,
      "",
      "[Scene2]",
      "两人低声交谈，讨论计划，关系稍稍缓和。",
      "",
      "[Scene3]",
      "他们只做低强度前推，没有立刻触发冲突。",
    ].join("\n\n");
    const check = evaluateMoodCadenceCompliance(probe, intent);
    if (!check) {
      return true;
    }
    return check.scene1IsolationMatched !== false && check.semanticFailures?.includes("scene1-combat-or-escalation") !== true;
  }

  private applyLockedScene1ToCreative(
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    },
    lockedScene1: string | undefined,
    countingMode: LengthSpec["countingMode"],
  ): {
    title: string;
    content: string;
    wordCount: number;
    preWriteCheck: string;
  } {
    if (!lockedScene1) {
      return creative;
    }

    const content = this.applyLockedScene1ToContent(creative.content, lockedScene1);
    return {
      ...creative,
      content,
      wordCount: countChapterLength(content, countingMode),
    };
  }

  private applyLockedScene1ToContent(content: string, lockedScene1: string): string {
    const normalized = content.replace(/\r\n/g, "\n").trim();
    const lockedBlock = `[Scene1]\n${lockedScene1.trim()}`;
    const scene1Index = normalized.search(/\[Scene\s*1\]/i);
    const scene2Index = normalized.search(/\[Scene\s*2\]/i);
    if (scene1Index >= 0 && scene2Index > scene1Index) {
      return `${normalized.slice(0, scene1Index)}${lockedBlock}\n\n${normalized.slice(scene2Index)}`.trim();
    }
    if (scene2Index >= 0) {
      return `${lockedBlock}\n\n${normalized.slice(scene2Index)}`.trim();
    }
    return `${lockedBlock}\n\n[Scene2]\n${normalized}`.trim();
  }

  private buildRetryHintBlock(
    retryHint: string | undefined,
    retryHintPath: string | undefined,
    language: "zh" | "en",
  ): string {
    const hint = retryHint?.trim();
    if (!hint) return "";

    if (language === "en") {
      return `\n## Chapter Retry Hint (Hard Constraints for This Chapter Only)
Source: ${retryHintPath ?? "reviews/write-retry-hints"}

These constraints have higher priority than ordinary style advice, soft constraints, and aesthetic preferences.
Apply them only to this chapter.
Do not use them to overwrite canon, continuity facts, worldbuilding, character identity, or the main plot setup. If any line conflicts with canon or established continuity, preserve canon and satisfy the non-conflicting parts.

${hint}
`;
    }

    return `\n## 章节重试提示（本章专属硬约束）
来源：${retryHintPath ?? "reviews/write-retry-hints"}

以下约束优先级高于普通风格建议、软约束和审美偏好。
只作用于本章，不得外溢到其他章节。
不得用它覆盖正典、连续性事实、世界观、人设身份或主线设定；如果提示与既有硬设定冲突，保留硬设定，并执行不冲突的部分。

${hint}
`;
  }

  private buildGovernedUserPrompt(params: {
    readonly chapterNumber: number;
    readonly chapterIntent: string;
    readonly contextPackage: ContextPackage;
    readonly ruleStack: RuleStack;
    readonly trace?: ChapterTrace;
    readonly lengthSpec: LengthSpec;
    readonly language?: "zh" | "en";
    readonly resourcePlan?: ChapterResourcePlan;
    readonly varianceBrief?: string;
    readonly selectedEvidenceBlock?: string;
    readonly titleCandidates?: ReadonlyArray<{ readonly style: string; readonly title: string }>;
    readonly patternBreakerDirective?: string;
    readonly retryHint?: string;
    readonly retryHintPath?: string;
  }): string {
    const sanitizedChapterIntent = this.stripLegacyEndingHookDirective(params.chapterIntent);
    const contextSections = params.contextPackage.selectedContext
      .map((entry) => [
        `### ${entry.source}`,
        `- reason: ${entry.reason}`,
        entry.excerpt ? `- excerpt: ${entry.excerpt}` : "",
      ].filter(Boolean).join("\n"))
      .join("\n\n");

    const overrideLines = params.ruleStack.activeOverrides.length > 0
      ? params.ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    const diagnosticLines = params.ruleStack.sections.diagnostic.length > 0
      ? params.ruleStack.sections.diagnostic.join(", ")
      : "none";

    const traceNotes = params.trace && params.trace.notes.length > 0
      ? params.trace.notes.map((note) => `- ${note}`).join("\n")
      : "- none";
    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");
    const varianceBlock = params.varianceBrief
      ? `\n${params.varianceBrief}\n`
      : "";
    const selectedEvidenceBlock = params.selectedEvidenceBlock
      ? `\n${params.selectedEvidenceBlock}\n`
      : "";
    const patternBreakerBlock = params.patternBreakerDirective
      ? `\n${params.patternBreakerDirective}\n`
      : "";
    const retryHintBlock = this.buildRetryHintBlock(params.retryHint, params.retryHintPath, params.language ?? "zh");
    const resourcePlanBlock = params.resourcePlan
      ? `\n${renderResourcePlanForPrompt(params.resourcePlan, "writer")}\n`
      : "";
    const resourcePlanPriorityBlock = params.resourcePlan
      ? params.language === "en"
        ? "\n⚠️ The resource plan below takes priority over all other instructions. If the resource plan conflicts with the volume outline or current state, obey the resource plan.\n"
        : "\n⚠️ 以下资源计划优先级高于其他所有指令。如果资源计划与卷纲/状态卡有冲突，以资源计划为准。\n"
      : "";
    const moodDirective = this.extractMoodDirectiveFromIntentMarkdown(sanitizedChapterIntent);
    const modeLockBlock = this.buildFirstPassModeLockBlock(moodDirective, params.language ?? "zh");
    const moodDirectiveBlock = this.buildMoodDirectiveBlock(moodDirective, params.language ?? "zh");
    const characterAuthenticityBlock = this.buildCharacterAuthenticityBlock(params.language ?? "zh");
    const payoffSuppression = this.detectIntentPayoffSuppression(sanitizedChapterIntent);
    const endingTypeDirectiveBlock = this.buildEndingTypeDirectiveBlock(
      sanitizedChapterIntent,
      params.language ?? "zh",
      payoffSuppression,
    );
    const chapterIntentPriorityNotice = this.buildChapterIntentPriorityNotice(
      sanitizedChapterIntent,
      payoffSuppression,
      params.language ?? "zh",
    );
    const payoffDirectiveBlock = this.buildPayoffDirectiveBlock(
      params.contextPackage.chapterGoal,
      params.language ?? "zh",
      payoffSuppression,
    );
    const hookEmergenceDirectiveBlock = this.buildHookEmergenceDirectiveBlock({
      directive: this.extractHookEmergenceDirectiveFromIntentMarkdown(sanitizedChapterIntent),
      language: params.language ?? "zh",
    });
    const titleBlock = this.buildTitleCandidatesBlock(params.titleCandidates, params.language ?? "zh");
    const explicitHookAgenda = this.extractMarkdownSection(sanitizedChapterIntent, "## Hook Agenda");
    const hookAgendaBlock = explicitHookAgenda
      ? params.language === "en"
        ? `\n## Explicit Hook Agenda\n${explicitHookAgenda}\n`
        : `\n## 显式 Hook Agenda\n${explicitHookAgenda}\n`
      : "";

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.
${modeLockBlock}
${retryHintBlock}

## Chapter Intent Execution Contract
- Chapter intent is the highest-priority constraint for this chapter.
- You MUST write according to the chapter intent below.
- You may invent local sensory details and line-level actions, but you MUST NOT change the chapter goal, obstacle, antagonist pressure, climax, ending hook, or character-behavior constraints.
- The chapter intent fields that cannot be overridden are: protagonist goal, obstacle dilemma, antagonist pressure, solution method, action climax, ending feedback, next-chapter hook, character-behavior constraints, and writing execution reminders.
- If planner intent, payoffDirective, Hook Agenda, or outline node conflicts with chapter intent, chapter intent wins.
- Legacy planner intent is auxiliary material only; it may not deepen the chapter beyond the chapter intent.
- If any selected context appears to conflict with the chapter intent, preserve hard canon facts and follow the non-conflicting chapter intent.
${chapterIntentPriorityNotice}
${resourcePlanPriorityBlock}${resourcePlanBlock}

## Chapter Intent
${sanitizedChapterIntent}

## Selected Context
${contextSections || "(none)"}
${selectedEvidenceBlock}
${hookAgendaBlock}
${endingTypeDirectiveBlock}
${moodDirectiveBlock}
${characterAuthenticityBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
${titleBlock}
${patternBreakerBlock}

## Rule Stack
- Hard: ${params.ruleStack.sections.hard.join(", ") || "(none)"}
- Soft: ${params.ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic: ${diagnosticLines}

## Active Overrides
${overrideLines}

## Trace Notes
${traceNotes}

${varianceBlock}
${lengthRequirementBlock}
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

    return `请续写第${params.chapterNumber}章。
${modeLockBlock}
${retryHintBlock}

## 章节意图执行契约
- chapter_intent 是本章最高优先级约束。
- 必须按照下方 chapter_intent 写正文。
- 可以在局部画面、动作和感官细节上发挥，但不得改变本章目标、阻碍、反派压力、行动高潮、结尾钩子和人物行为约束。
- 不得被覆盖的字段包括：本章主角目标、本章阻碍困境、本章反派压力、本章解决方法、本章行动高潮、本章结局反馈、下一章钩子、人物行为约束、写作执行提醒。
- 如果 planner intent、payoffDirective、Hook Agenda 或 outline node 与 chapter_intent 冲突，以 chapter_intent 为准。
- 旧 planner intent 只能作为辅助素材，不能改变 chapter_intent 规定的推进深度。
- 如果已选上下文与 chapter_intent 局部冲突，保留硬设定事实，并执行不冲突的 chapter_intent。
${chapterIntentPriorityNotice}
${resourcePlanPriorityBlock}${resourcePlanBlock}

## 本章意图
${sanitizedChapterIntent}

## 已选上下文
${contextSections || "(无)"}
${selectedEvidenceBlock}
${hookAgendaBlock}
${endingTypeDirectiveBlock}
${moodDirectiveBlock}
${characterAuthenticityBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
${titleBlock}
${patternBreakerBlock}

## 规则栈
- 硬护栏：${params.ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${params.ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${diagnosticLines}

## 当前覆盖
${overrideLines}

## 追踪说明
${traceNotes}

${varianceBlock}
${lengthRequirementBlock}
- 先输出写作自检表，再写正文
- 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }

  private stripLegacyEndingHookDirective(chapterIntent: string): string {
    return chapterIntent
      .split("\n")
      .filter((line) => !/^\s*-\s*endingHookType\s*:/i.test(line))
      .join("\n");
  }

  private buildEndingTypeDirectiveBlock(
    chapterIntent: string | undefined,
    language: "zh" | "en",
    payoffSuppression: IntentPayoffSuppression = { suppressPayoff: false },
  ): string {
    const endingType = this.extractEndingTypeFromIntentMarkdown(chapterIntent);
    if (!endingType) {
      return "";
    }

    const hasPromisedPayoff = !payoffSuppression.suppressPayoff && this.hasPromisedPayoffInIntent(chapterIntent);

    if (language === "en") {
      return [
        "",
        "## Ending Control",
        `- EndingType: ${endingType}`,
        "- Use EndingType as the single authoritative ending directive.",
        "- Ignore legacy endingHookType hints if they appear anywhere.",
        "- The ending MUST strictly follow EndingType. Non-compliance invalidates the chapter.",
        hasPromisedPayoff
          ? "- When a payoff is promised, payoff priority is higher than EndingType, and the payoff MUST happen in this chapter at least partially."
          : undefined,
        hasPromisedPayoff
          ? "- EndingType may shape closure, but it must not block payoff realization or visible situation change."
          : undefined,
        endingType === "unresolved_end" && hasPromisedPayoff
          ? "- You MUST complete the payoff, then leave the situation unresolved by introducing a new threat or question."
          : undefined,
      ].join("\n");
    }

    return [
      "",
      "## 结尾控制",
      `- EndingType: ${endingType}`,
      "- 结尾类型以 EndingType 为唯一权威控制源。",
      "- 若出现旧字段 endingHookType，忽略它，不作为写作约束。",
      "- The ending MUST strictly follow EndingType. Non-compliance invalidates the chapter.",
      hasPromisedPayoff
        ? "- 当存在 payoffToDeliver 时，payoff 优先级高于 EndingType，本章也必须至少部分兑现 payoff。"
        : undefined,
      hasPromisedPayoff
        ? "- EndingType 只控制收束方式，不得阻止 payoff 发生与局势变化。"
        : undefined,
      endingType === "unresolved_end" && hasPromisedPayoff
        ? "- You MUST complete the payoff, then leave the situation unresolved by introducing a new threat or question."
        : undefined,
    ].join("\n");
  }

  private buildCharacterAuthenticityBlock(language: "zh" | "en"): string {
    if (language === "en") {
      return [
        "",
        "## Character Authenticity",
        "- At least once at a key turning point, a main character must make a slightly non-optimal or emotion-driven choice.",
        "- Do not use explanation-heavy inner narration such as 'he realized', 'obviously', 'this meant', or 'he understood'.",
        "- Any explanatory inner monologue is forbidden and will invalidate the chapter.",
        "- Any realization must be expressed as a sequence of perception -> reaction -> implication, never as direct explanation.",
        "- Every perception chain must contain at least 2 sensory signals and at least 1 physical reaction.",
        "- Never rely on a single sensory cue or a single action beat to carry a realization.",
        "- Express inner state through action, pause, sensory detail, or behavior change instead of explanatory summary.",
        "- Do not write direct emotion labels like 'he was angry / nervous / exhausted' without embodiment.",
        "- Emotion must show up as body reaction, hesitation, aggression, silence, grip, breath, gaze, posture, or a changed choice.",
        "- Replace explanation with behavior. Bad: 'He understood he was being watched.' Good: 'He stopped without turning around. His fingers had already tightened on the sleeve edge.'",
        "- Do not pause the scene to explain combat rules or worldbuilding to the reader. Fold it into consequence, pressure, and action instead.",
      ].join("\n");
    }

    return [
      "",
      "## Character Authenticity",
      "- 关键节点里，角色至少要出现一次非最优选择，或明显带情绪驱动的行为。",
      "- 禁止说明式内心：不要直接写“他意识到”“显然”“这意味着”“他明白”。",
      "- Any explanatory inner monologue is forbidden and will invalidate the chapter.",
      "- Any realization must be expressed as a sequence of perception -> reaction -> implication, never as direct explanation.",
      "- Every perception must be reinforced by multiple sensory signals and at least one physical reaction.",
      "- 每个认知链至少要有 2 个感知信号 + 1 个行为反应，不能只靠单一感知或单句行为撑过去。",
      "- 内心必须通过行动、停顿、感知、行为变化来表现，而不是解释给读者。",
      "- 禁止直接写“他很愤怒/紧张/疲惫”这类情绪结论。",
      "- 情绪必须外化为身体反应、动作变化、呼吸、目光、停顿、握紧、后退、沉默或决策偏移。",
      "- 说明要改成行为。错误：他明白自己被盯上了。正确：他停下脚步，没有回头。但手指已经扣紧了袖口。",
      "- 禁止停下来给读者解释战力规则、世界观设定或修炼体系；必须把信息折进后果、压力和行动里。",
    ].join("\n");
  }

  private hasPromisedPayoffInIntent(chapterIntent: string | undefined): boolean {
    if (!chapterIntent) {
      return false;
    }
    const section = this.extractMarkdownSection(chapterIntent, "## Chapter Goal");
    if (!section) {
      return false;
    }
    const match = section.match(/-\s*payoffToDeliver:\s*(.+)/i)?.[1]?.trim();
    return Boolean(match && match.toLowerCase() !== "none");
  }

  private detectIntentPayoffSuppression(chapterIntent: string | undefined): IntentPayoffSuppression {
    return detectIntentPayoffSuppression(chapterIntent);
  }

  private buildChapterIntentPriorityNotice(
    chapterIntent: string | undefined,
    payoffSuppression: IntentPayoffSuppression,
    language: "zh" | "en",
  ): string {
    if (!chapterIntent || !payoffSuppression.suppressPayoff) {
      return "";
    }

    if (language === "en") {
      return [
        "",
        "## Highest-Priority Conflict Handling",
        "- chapter_intent explicitly limits payoff materialization in this chapter.",
        `- Reason: ${payoffSuppression.reason ?? "intent limits payoff depth"}`,
        "- Legacy payoffDirective is downgraded to deferred material or a faint hint only.",
        "- Do not force a complete payoff, resource gain, reveal, skill unlock, major clue, or severe compensating cost.",
        "- Use only the ending feedback and next hook specified by chapter_intent.",
      ].join("\n");
    }

    return [
      "",
      "## 最高优先级冲突处理",
      "- chapter_intent 明确限制本章不得完整兑现 payoff。",
      `- 原因：${payoffSuppression.reason ?? "intent 限制 payoff 深度"}`,
      "- 旧 payoffDirective 降级为“后续伏笔或轻微暗示”。",
      "- 不得强行完整兑现 payoff，不得发放资源收益、完整揭示、技能解锁、重大线索或补偿性严重代价。",
      "- 本章只能按照 chapter_intent 的结局反馈与下一章钩子推进。",
    ].join("\n");
  }

  private detectChapterIntentDeviationWarnings(params: {
    readonly content: string;
    readonly chapterIntent?: string;
    readonly payoffSuppression: IntentPayoffSuppression;
    readonly language: "zh" | "en";
  }): ReadonlyArray<PostWriteViolation> {
    if (!params.payoffSuppression.suppressPayoff || !params.chapterIntent?.trim()) {
      return [];
    }

    const matched = this.findChapterIntentDriftPattern(params.content);
    if (!matched) {
      return [];
    }

    return [{
      rule: "chapter-intent-drift",
      severity: "warning",
      description: params.language === "en"
        ? "Chapter appears to drift from chapter_intent: early payoff or over-advancement was detected."
        : "正文疑似偏离 chapter_intent：检测到提前兑现或过度推进。",
      suggestion: params.language === "en"
        ? "Keep the chapter at the intent-specified payoff depth and ending hook."
        : "保持 chapter_intent 指定的兑现深度和结尾钩子，不要被旧 payoffDirective 带偏。",
    }];
  }

  private findChapterIntentDriftPattern(content: string): RegExp | undefined {
    return PAYOFF_DRIFT_PATTERNS.find((pattern) => {
      const flags = pattern.flags.replace(/g/g, "");
      return new RegExp(pattern.source, flags).test(content);
    });
  }

  private async rewriteChapterIntentDriftIfNeeded(params: {
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    };
    chapterIntent?: string;
    payoffSuppression: IntentPayoffSuppression;
    language: "zh" | "en";
    chapterNumber: number;
    maxTokens: number;
    countingMode: LengthSpec["countingMode"];
    onUsage: (usage: TokenUsage) => void;
  }): Promise<{
    title: string;
    content: string;
    wordCount: number;
    preWriteCheck: string;
  }> {
    const driftPattern = this.findChapterIntentDriftPattern(params.creative.content);
    if (!params.payoffSuppression.suppressPayoff || !driftPattern) {
      return params.creative;
    }

    this.logWarn(params.language, {
      zh: `正文疑似偏离 chapter_intent：检测到提前兑现或过度推进，尝试定向修正（第${params.chapterNumber}章）`,
      en: `Chapter appears to drift from chapter_intent; attempting targeted repair (chapter ${params.chapterNumber})`,
    });

    const response = await this.chat(
      [
        {
          role: "system",
          content: params.language === "en"
            ? "You are a targeted chapter-intent repair editor. Remove early payoff/over-advancement. Preserve prose, continuity, and emotional beats. The chapter must stop at the chapter_intent hook."
            : "你是 chapter_intent 定向修正编辑。删除提前兑现和过度推进，保留正文质感、连续性与情绪节拍。章节必须停在 chapter_intent 指定钩子。",
        },
        {
          role: "user",
          content: params.language === "en"
            ? [
                `Rewrite chapter ${params.chapterNumber} to obey chapter_intent.`,
                "",
                "## chapter_intent",
                params.chapterIntent ?? "(none)",
                "",
                "## Hard Repair Rules",
                "- Delete any complete payoff, escape clue, hidden money/location, skill unlock, full truth, severe compensating cost, or equivalent over-advancement.",
                "- Do not add a replacement major benefit or major cost.",
                "- Stop at system binding / panel appearance / the hook specified by chapter_intent.",
                "",
                "## Original Title",
                params.creative.title,
                "",
                "## Original Content",
                params.creative.content,
                "",
                "Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks.",
              ].join("\n")
            : [
                `请修正第${params.chapterNumber}章，使其服从 chapter_intent。`,
                "",
                "## chapter_intent",
                params.chapterIntent ?? "(无)",
                "",
                "## 硬修规则",
                "- 删除任何完整 payoff、逃生线索、藏钱地址、技能解锁、完整真相、严重补偿性代价或同类过度推进。",
                "- 不得添加替代性重大收益或重大代价。",
                "- 结尾停在系统绑定/面板出现/chapter_intent 指定钩子。",
                "",
                "## 原标题",
                params.creative.title,
                "",
                "## 原正文",
                params.creative.content,
                "",
                "只输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块。",
              ].join("\n"),
        },
      ],
      { maxTokens: params.maxTokens, temperature: 0.35 },
    );
    params.onUsage(response.usage);
    const candidate = parseCreativeOutput(params.chapterNumber, response.content, params.countingMode);
    if (!this.findChapterIntentDriftPattern(candidate.content)) {
      return candidate;
    }

    const fallbackContent = this.removeChapterIntentDriftParagraphs(params.creative.content);
    if (fallbackContent && !this.findChapterIntentDriftPattern(fallbackContent)) {
      this.logWarn(params.language, {
        zh: `chapter_intent 定向修正仍有偏移，已删除明显提前兑现段落（第${params.chapterNumber}章）`,
        en: `Targeted chapter_intent repair still drifted; removed obvious over-advancement paragraphs (chapter ${params.chapterNumber})`,
      });
      return {
        ...params.creative,
        content: fallbackContent,
        wordCount: countChapterLength(fallbackContent, params.countingMode),
      };
    }

    this.logWarn(params.language, {
      zh: `chapter_intent 定向修正后仍疑似偏移，保留当前版本并标记 WARN（第${params.chapterNumber}章）`,
      en: `Targeted chapter_intent repair still appears drifted; keeping current version with WARN (chapter ${params.chapterNumber})`,
    });
    return params.creative;
  }

  private removeChapterIntentDriftParagraphs(content: string): string {
    const paragraphs = content.split(/\n{2,}/u);
    const kept = paragraphs.filter((paragraph) => !this.findChapterIntentDriftPattern(paragraph));
    const cleaned = kept.join("\n\n").trim();
    return cleaned || "系统绑定提示音响起。面板亮起，初始值归零，规则暂未展开。";
  }

  private async rewriteForEndingTypeIfNeeded(params: {
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    };
    chapterIntent?: string;
    language: "zh" | "en";
    chapterNumber: number;
    maxTokens: number;
    titleCandidates: ReadonlyArray<{ title: string }>;
    countingMode: LengthSpec["countingMode"];
    minWholeChapterWords?: number;
    onUsage: (usage: TokenUsage) => void;
  }): Promise<{
    title: string;
    content: string;
    wordCount: number;
    preWriteCheck: string;
  }> {
    const endingTypeCheck = evaluateEndingTypeCompliance(params.creative.content, params.chapterIntent);
    if (!endingTypeCheck || endingTypeCheck.matched) {
      return params.creative;
    }

    let currentCreative = params.creative;
    let check = endingTypeCheck;

    for (let attempt = 1; attempt <= 2 && !check.matched; attempt += 1) {
      this.logWarn(params.language, {
        zh: `Writer ENDING TYPE MODE：第${params.chapterNumber}章 rewrite attempt ${attempt}，endingType=${check.expectedType} 未兑现`,
        en: `Writer ENDING TYPE MODE: chapter ${params.chapterNumber} rewrite attempt ${attempt}, endingType=${check.expectedType} not satisfied`,
      });

      const response = await this.chat(
        [
          {
            role: "system",
            content: this.buildEndingTypeRewriteSystemPrompt(params.language, check.expectedType),
          },
          {
            role: "user",
            content: this.buildEndingTypeRewritePrompt({
              language: params.language,
              chapterNumber: params.chapterNumber,
              expectedType: check.expectedType,
              originalTitle: currentCreative.title,
              originalContent: currentCreative.content,
              preWriteCheck: currentCreative.preWriteCheck,
              titleCandidates: params.titleCandidates,
            }),
          },
        ],
        { maxTokens: params.maxTokens, temperature: 0.45 },
      );
      params.onUsage(response.usage);
      const candidate = parseCreativeOutput(params.chapterNumber, response.content, params.countingMode);
      const decision = this.acceptWholeChapterRewrite({
        language: params.language,
        chapterNumber: params.chapterNumber,
        stage: `ending-type-attempt-${attempt}`,
        beforeContent: currentCreative.content,
        afterContent: candidate.content,
        countingMode: params.countingMode,
        minWholeChapterWords: params.minWholeChapterWords,
      });
      if (!decision.accepted) {
        break;
      }
      currentCreative = candidate;
      check = evaluateEndingTypeCompliance(currentCreative.content, params.chapterIntent) ?? check;
    }

    return currentCreative;
  }

  private buildEndingTypeRewriteSystemPrompt(
    language: "zh" | "en",
    expectedType: "reveal_end" | "unresolved_end" | "resolution_end" | "twist_end" | "calm_end",
  ): string {
    if (language === "en") {
      return [
        "ENDING TYPE ENFORCEMENT MODE",
        `Expected EndingType: ${expectedType}`,
        "The ending MUST strictly follow EndingType. Non-compliance invalidates the chapter.",
        "Rewrite only the final 2-3 paragraphs while preserving chapter facts and continuity.",
        expectedType === "reveal_end"
          ? "Hard rule: ending must contain a concrete new reveal (identity/source/clue/truth), not vague pressure or danger."
          : undefined,
        expectedType === "calm_end"
          ? "Hard rule: ending must close in a calm/resting/regrouping beat and must not introduce new conflict or danger."
          : undefined,
      ].filter(Boolean).join("\n");
    }

    return [
      "ENDING TYPE ENFORCEMENT MODE",
      `Expected EndingType: ${expectedType}`,
      "The ending MUST strictly follow EndingType. Non-compliance invalidates the chapter.",
      "只重写最后 2-3 段，保持章节事实与连续性不变。",
      expectedType === "reveal_end"
        ? "硬规则：结尾必须出现明确的新信息揭示（身份/来源/关键线索/真相），不能只写危险逼近。"
        : undefined,
      expectedType === "calm_end"
        ? "硬规则：结尾必须收束到平缓/休整/安顿，不允许新增冲突或危险。"
        : undefined,
    ].filter(Boolean).join("\n");
  }

  private buildEndingTypeRewritePrompt(params: {
    language: "zh" | "en";
    chapterNumber: number;
    expectedType: "reveal_end" | "unresolved_end" | "resolution_end" | "twist_end" | "calm_end";
    originalTitle: string;
    originalContent: string;
    preWriteCheck: string;
    titleCandidates: ReadonlyArray<{ title: string }>;
  }): string {
    if (params.language === "en") {
      return [
        `Chapter ${params.chapterNumber} failed ending-type compliance.`,
        `- Expected EndingType: ${params.expectedType}`,
        "- Do not rewrite the whole chapter. Only rewrite the ending to satisfy EndingType strictly.",
        "- Keep all established chapter facts unchanged.",
        params.titleCandidates.length > 0 ? `- Keep or prefer one of these titles: ${params.titleCandidates.map((candidate) => candidate.title).join(" | ")}` : undefined,
        "",
        "=== ORIGINAL_PRE_WRITE_CHECK ===",
        params.preWriteCheck || "- ok",
        "",
        "=== ORIGINAL_TITLE ===",
        params.originalTitle,
        "",
        "=== ORIGINAL_CONTENT ===",
        params.originalContent,
      ].filter(Boolean).join("\n");
    }

    return [
      `第${params.chapterNumber}章 endingType 不合规。`,
      `- Expected EndingType: ${params.expectedType}`,
      "- 不要整章重写，只重写结尾 2-3 段并严格满足 EndingType。",
      "- 保持章节既有事实不变。",
      params.titleCandidates.length > 0 ? `- 标题保持或优先使用：${params.titleCandidates.map((candidate) => candidate.title).join(" | ")}` : undefined,
      "",
      "=== ORIGINAL_PRE_WRITE_CHECK ===",
      params.preWriteCheck || "- ok",
      "",
      "=== ORIGINAL_TITLE ===",
      params.originalTitle,
      "",
      "=== ORIGINAL_CONTENT ===",
      params.originalContent,
    ].filter(Boolean).join("\n");
  }

  private joinGovernedEvidenceBlocks(blocks: ReturnType<typeof buildGovernedMemoryEvidenceBlocks> | undefined): string | undefined {
    if (!blocks) {
      return undefined;
    }

    const joined = [
      blocks.titleHistoryBlock,
      blocks.moodTrailBlock,
      blocks.canonBlock,
      blocks.hookDebtBlock,
      blocks.hooksBlock,
      blocks.summariesBlock,
      blocks.volumeSummariesBlock,
    ]
      .filter((block): block is string => Boolean(block))
      .join("\n");

    return joined || undefined;
  }

  private buildTitleCandidatesBlock(
    candidates: ReadonlyArray<{ readonly style: string; readonly title: string }> | undefined,
    language: "zh" | "en",
  ): string {
    if (!candidates || candidates.length === 0) {
      return "";
    }

    const label = language === "en" ? "## Title Candidates" : "## 标题候选";
    const guidance = language === "en"
      ? "- Use these as preferred title directions. Keep the final chapter title between 2-6 words, avoid single-word titles, and do not reuse the recent title pattern."
      : "- 优先从这些候选里择优，或写出同等级别的标题。标题尽量控制在 6-18 字，避免单词标题、纯人名标题，以及和近三章同模版。";
    const lines = candidates
      .slice(0, 3)
      .map((candidate) => {
        const styleLabel = language === "en"
          ? candidate.style
          : candidate.style === "crisis"
            ? "危机型"
            : candidate.style === "payoff"
              ? "爽点型"
              : "悬念型";
        return `- ${styleLabel}: ${candidate.title}`;
      })
      .join("\n");

    return `\n${label}\n${guidance}\n${lines}\n`;
  }

  private extractMoodDirectiveFromIntentMarkdown(chapterIntent: string | undefined): MoodDirective | undefined {
    if (!chapterIntent) {
      return undefined;
    }
    const section = this.extractMarkdownSection(chapterIntent, "## Structured Directives");
    if (!section) {
      return undefined;
    }

    const targetMode = section.match(/targetMode:\s*(calm|breath|warmth|humor)/i)?.[1]?.toLowerCase();
    const writingModeRaw = section.match(/writingMode:\s*(crisis|neutral|breath)/i)?.[1]?.toLowerCase();
    const firstPassModeLockRaw = section.match(/firstPassModeLock:\s*(true|false)/i)?.[1]?.toLowerCase();
    const forbidCrisisFallbackRaw = section.match(/forbidCrisisFallback:\s*(true|false)/i)?.[1]?.toLowerCase();
    const quotaRaw = section.match(/requiredSceneQuota:\s*(\d+)/i)?.[1];
    const coverageRaw = section.match(/moodCoverageMin:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i)?.[1];
    const sceneMinShareRaw = section.match(/sceneMinShare:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i)?.[1];
    const forbidDominantMode = section.match(/forbidDominantMode:\s*([a-z-]+)/i)?.[1];
    const scene1 = section.match(/scene1:\s*(.+)/i)?.[1]?.trim();
    const scene2 = section.match(/scene2:\s*(.+)/i)?.[1]?.trim();
    const scene3 = section.match(/scene3:\s*(.+)/i)?.[1]?.trim();
    const note = section.match(/note:\s*(.+)/i)?.[1]?.trim();

    if (!targetMode || !quotaRaw || !forbidDominantMode) {
      return undefined;
    }

    return {
      targetMode: targetMode as MoodDirective["targetMode"],
      writingMode: ((): MoodDirective["writingMode"] => {
        if (writingModeRaw === "crisis" || writingModeRaw === "neutral" || writingModeRaw === "breath") {
          return writingModeRaw;
        }
        return targetMode === "breath" ? "breath" : "neutral";
      })(),
      firstPassModeLock: firstPassModeLockRaw
        ? firstPassModeLockRaw === "true"
        : targetMode === "breath",
      forbidCrisisFallback: forbidCrisisFallbackRaw
        ? forbidCrisisFallbackRaw === "true"
        : targetMode === "breath",
      requiredSceneQuota: Number.parseInt(quotaRaw, 10),
      moodCoverageMin: coverageRaw ? Number.parseFloat(coverageRaw) : 0.3,
      forceSceneStructure: targetMode === "breath",
      sceneMinShare: sceneMinShareRaw ? Number.parseFloat(sceneMinShareRaw) : 0.2,
      sceneSemanticEnforced: targetMode === "breath",
      scene1NoThreatEscalation: targetMode === "breath",
      scene2InteractionFocus: targetMode === "breath",
      scene3ForwardOnly: targetMode === "breath",
      forbidDominantMode: forbidDominantMode as MoodDirective["forbidDominantMode"],
      ...(scene1 && scene2 && scene3
        ? {
          scenePlan: {
            scene1,
            scene2,
            scene3,
          },
        }
        : {}),
      ...(note ? { note } : {}),
    };
  }

  private buildMoodDirectiveBlock(
    moodDirective: MoodDirective | undefined,
    language: "zh" | "en",
  ): string {
    if (!moodDirective) {
      return "";
    }

    if (language === "en") {
      const minSceneShare = Math.max(0.2, moodDirective.sceneMinShare ?? 0.2);
      const writingMode = moodDirective.writingMode ?? (moodDirective.targetMode === "breath" ? "breath" : "neutral");
      return [
        "",
        "## Mood Cadence Directive",
        `- targetMode: ${moodDirective.targetMode}`,
        `- writingMode: ${writingMode}`,
        `- firstPassModeLock: ${moodDirective.firstPassModeLock ?? (moodDirective.targetMode === "breath")}`,
        `- forbidCrisisFallback: ${moodDirective.forbidCrisisFallback ?? (moodDirective.targetMode === "breath")}`,
        `- requiredSceneQuota: at least ${moodDirective.requiredSceneQuota} scene`,
        `- moodCoverageMin: at least ${Math.round(moodDirective.moodCoverageMin * 100)}% of the final chapter`,
        `- sceneMinShare: each scene >= ${Math.round(minSceneShare * 100)}%`,
        `- forbidDominantMode: ${moodDirective.forbidDominantMode}`,
        "- DIRECTIVE PRIORITY: mood directive > scene plan > payoff > hook.",
        "- FIRST DRAFT MODE: BREATH DRAFTING MODE (do not use default conflict-heavy skeleton).",
        "- The first 30% of the chapter MUST be a pure recovery/character scene. Any threat or escalation in this part invalidates the chapter.",
        "- PRIMARY STRUCTURAL REQUIREMENT: this is not a soft note. The chapter must be structured as Act 1 / Act 2 / Act 3, and at least one act must function as a breath scene.",
        moodDirective.scenePlan
          ? [
            "- scenePlan:",
            `  - scene1: ${moodDirective.scenePlan.scene1}`,
            `  - scene2: ${moodDirective.scenePlan.scene2}`,
            `  - scene3: ${moodDirective.scenePlan.scene3}`,
          ].join("\n")
          : undefined,
        "- Section B must be a real breathing scene with healing, camp rest, eating, travel talk, trust-building, teasing, or lighter character interaction.",
        "- Breath chapter skeleton: Act 1 = aftershock / regroup, Act 2 = full breath scene, Act 3 = small forward motion with a low-intensity hook.",
        "- Hard ordering constraint: the first 60% of the chapter must not be combat-heavy.",
        "- Breath writing mode style: use slower sentence pacing, stronger environmental grounding, embodied sensation, and interaction pauses.",
        "- Must include tactile/body sensations (cold/heat/pain/release), environment signals (smell/sound/light), and character interaction details (dialogue/eye contact/micro-actions).",
        "- Avoid sustained oppressive tone. Do not stack crisis trigger words continuously (danger/kill intent/explosion/collapse/dying).",
        "- Complete recovery / dialogue / relationship scenes first, then move into low-intensity forward motion.",
        "- Invalid pattern: fight first, then add two short rest lines as patchwork.",
        "- Replace part of the dominant combat structure if needed. Do not simply append one calming paragraph at the end.",
        "- OUTPUT FORMAT IS MANDATORY. CHAPTER_CONTENT must use exactly this 3-scene structure:",
        "  [Scene1]",
        "  (recovery / aftershock / regroup)",
        "",
        "  [Scene2]",
        "  (dialogue / relationship / planning / repair)",
        "",
        "  [Scene3]",
        "  (low-intensity forward move / soft hook)",
        "- Do not skip Scene1 or Scene2.",
        "- Do not jump straight into combat-heavy confrontation.",
        "- Do not write climax first and patch front scenes later.",
        "- In the first 30% / [Scene1], do not introduce threats, rule pressure, pursuit pressure, storm signals, or conflict escalation.",
        '- Scene1 semantic hard rule: "Do NOT introduce new threats or escalate conflict."',
        '- Scene2 semantic hard rule: "Focus on interaction, not action."',
        '- Scene3 semantic hard rule: "Only here you may move plot forward."',
        "- Scene1 must include recovery / aftershock / environmental grounding / body-state change.",
        "- Scene2 must include dialogue / relationship movement / planning discussion / emotional release.",
        `- Each scene must occupy at least ${Math.round(minSceneShare * 100)}% of CHAPTER_CONTENT.`,
        `- If breath coverage stays below ${Math.round(moodDirective.moodCoverageMin * 100)}%, the chapter is considered failed and must be rewritten before output.`,
        "- Do not let combat-heavy confrontation dominate the chapter.",
        moodDirective.note ? `- note: ${moodDirective.note}` : undefined,
        "",
      ].filter(Boolean).join("\n");
    }

    const minSceneShare = Math.max(0.2, moodDirective.sceneMinShare ?? 0.2);
    const writingMode = moodDirective.writingMode ?? (moodDirective.targetMode === "breath" ? "breath" : "neutral");
    return [
      "",
      "## 情绪节奏指令",
      `- targetMode: ${moodDirective.targetMode}`,
      `- writingMode: ${writingMode}`,
      `- firstPassModeLock: ${moodDirective.firstPassModeLock ?? (moodDirective.targetMode === "breath")}`,
      `- forbidCrisisFallback: ${moodDirective.forbidCrisisFallback ?? (moodDirective.targetMode === "breath")}`,
      `- requiredSceneQuota: 至少 ${moodDirective.requiredSceneQuota} 段`,
      `- moodCoverageMin: 最终正文至少 ${Math.round(moodDirective.moodCoverageMin * 100)}%`,
      `- sceneMinShare: 每个 Scene 至少 ${Math.round(minSceneShare * 100)}%`,
      `- forbidDominantMode: ${moodDirective.forbidDominantMode}`,
      "- 指令优先级：mood directive > scene plan > payoff > hook。",
      "- FIRST DRAFT MODE：BREATH DRAFTING MODE（首稿不要走默认冲突推进骨架）。",
      "- The first 30% of the chapter MUST be a pure recovery/character scene. Any threat or escalation in this part invalidates the chapter.",
      "- PRIMARY STRUCTURAL REQUIREMENT：这不是软提示。章节必须按 Act1 / Act2 / Act3 组织，其中至少一幕必须是真正的 breath scene。",
      moodDirective.scenePlan
        ? [
          "- scenePlan:",
          `  - scene1: ${moodDirective.scenePlan.scene1}`,
          `  - scene2: ${moodDirective.scenePlan.scene2}`,
          `  - scene3: ${moodDirective.scenePlan.scene3}`,
        ].join("\n")
        : undefined,
      "- Section B 必须承担喘息段功能，内容应为疗伤、扎营、吃东西、休整、路途交谈、人物关系推进、玩笑或调侃之一，而不是继续打斗。",
      "- Breath 章骨架：Act1=余波/ regroup，Act2=完整喘息场景，Act3=小步前推 + 低强度尾钩。",
      "- 硬约束：本章前 60% 不得以战斗为主导。",
      "- Breath writingMode 语气要求：使用慢节奏句式，增强环境锚定、身体感知与互动停顿。",
      "- 必须出现触觉/身体感受（冷、热、痛、缓）、环境要素（气味、声音、光线）以及人物互动细节（对话、眼神、动作）。",
      "- 禁止持续压迫语气，避免连续堆叠危机触发词（危险、杀机、爆发、崩裂、濒死）。",
      "- 必须先完成恢复/对话/关系场景，再进入低强度推进。",
      "- 禁止“先打一场，再补两句休整”的补丁式结构。",
      "- 必要时必须替换掉部分主导性的战斗推进，不能只在结尾追加一小段喘息。",
      "- 输出格式为硬约束：CHAPTER_CONTENT 必须按三段 Scene 输出：",
      "  [Scene1]",
      "  （恢复/余波/重整）",
      "",
      "  [Scene2]",
      "  （对话/关系/计划/修复）",
      "",
      "  [Scene3]",
      "  （低强度推进/软钩子）",
      "- 不允许跳过 Scene1 或 Scene2。",
      "- 不允许直接进入战斗。",
      "- 不允许先写高潮再补前段。",
      "- 正文前 30% / [Scene1] 禁止出现威胁、规则压力、追杀压力、风暴信号或冲突升级。",
      '- Scene1 语义硬规则："Do NOT introduce new threats or escalate conflict."',
      '- Scene2 语义硬规则："Focus on interaction, not action."',
      '- Scene3 语义硬规则："Only here you may move plot forward."',
      "- Scene1 必须包含：恢复 / 余波 / 环境描写 / 身体状态变化。",
      "- Scene2 必须包含：对话 / 关系推进 / 计划讨论 / 情绪释放。",
      `- 每个 Scene 至少占 CHAPTER_CONTENT 的 ${Math.round(minSceneShare * 100)}%。`,
      `- 若 breath coverage 低于 ${Math.round(moodDirective.moodCoverageMin * 100)}%，本章视为失败，必须先重写再输出。`,
      "- 不允许让大篇幅战斗/高压对抗继续主导整章。",
      moodDirective.note ? `- note: ${moodDirective.note}` : undefined,
      "",
    ].filter(Boolean).join("\n");
  }

  private buildFirstPassModeLockBlock(
    moodDirective: MoodDirective | undefined,
    language: "zh" | "en",
  ): string {
    if (!moodDirective || moodDirective.targetMode !== "breath") {
      return "";
    }

    const writingMode = moodDirective.writingMode ?? "breath";
    const firstPassModeLock = moodDirective.firstPassModeLock ?? true;
    const forbidCrisisFallback = moodDirective.forbidCrisisFallback ?? true;

    if (language === "en") {
      return [
        "## FIRST-PASS MODE LOCK",
        "THIS CHAPTER IS A BREATH CHAPTER.",
        `- writingMode: ${writingMode}`,
        `- firstPassModeLock: ${firstPassModeLock}`,
        `- forbidCrisisFallback: ${forbidCrisisFallback}`,
        "- This chapter must fully replace default crisis/conflict-driven drafting mode.",
        "- Do not apply breath as an additive hint; use breath as the only first-pass writing mode.",
        "- Crisis-mode fallback is forbidden in first pass.",
        "- First paragraph hard rule: open with recovery/environment/dialogue details.",
        "- First paragraph must not contain direct conflict trigger, immediate threat, or enemy action.",
      ].join("\n");
    }

    return [
      "## FIRST-PASS MODE LOCK",
      "THIS CHAPTER IS A BREATH CHAPTER.",
      `- writingMode: ${writingMode}`,
      `- firstPassModeLock: ${firstPassModeLock}`,
      `- forbidCrisisFallback: ${forbidCrisisFallback}`,
      "- 本章必须完全替换默认危机/冲突驱动写法。",
      "- 不允许把 breath 当作附加约束；首稿只能使用 breath 写作模式。",
      "- 首稿禁止 crisis-mode fallback。",
      "- 首段硬约束：必须以恢复/环境/对话开场。",
      "- 首段禁止：直接冲突触发、立即危机、敌人行动。",
    ].join("\n");
  }

  private buildPayoffDirectiveBlock(
    chapterGoal: ChapterGoal | undefined,
    language: "zh" | "en",
    payoffSuppression: IntentPayoffSuppression = { suppressPayoff: false },
  ): string {
    const payoffToDeliver = chapterGoal?.payoffToDeliver?.trim();
    const payoffDirective = chapterGoal?.payoffDirective;
    if (!payoffDirective && !payoffToDeliver) {
      return "";
    }
    const promisedPayoff = payoffDirective?.promisedPayoff ?? payoffToDeliver!;
    const payoffType = payoffDirective?.payoffType ?? "resource";
    const payoffDepth = payoffDirective?.payoffDepth ?? "layered";
    const mandatoryByFinalAct = payoffDirective?.mandatoryByFinalAct ?? true;

    if (payoffSuppression.suppressPayoff) {
      return language === "en"
        ? [
            "",
            "## Payoff Directive Suppressed By Chapter Intent",
            `- Legacy promisedPayoff: ${promisedPayoff}`,
            `- Suppression reason: ${payoffSuppression.reason ?? "chapter intent limits payoff depth"}`,
            "- The chapter intent has higher priority than payoffDirective.",
            "- Treat the legacy payoff as deferred material or a faint hint only.",
            "- Do NOT fully materialize this payoff in this chapter.",
            "- Do NOT add new major benefits, new major information, new skills, or new severe costs to compensate.",
            "- The chapter must end on the hook specified by chapter_intent.",
          ].join("\n")
        : [
            "",
            "## 最高优先级冲突处理",
            `- 旧 promisedPayoff：${promisedPayoff}`,
            `- 压制原因：${payoffSuppression.reason ?? "chapter_intent 限制本章 payoff 深度"}`,
            "- chapter_intent 优先级高于 payoffDirective。",
            "- 旧 payoffDirective 只能作为后续伏笔或轻微暗示。",
            "- 本章不得强行完整兑现 payoff。",
            "- 不得额外添加重大收益、重大情报、技能解锁或重大代价来补偿 payoff。",
            "- 结尾必须停在 chapter_intent 指定的钩子上。",
          ].join("\n");
    }

    if (language === "en") {
      return [
        "",
        "## Payoff Realization Directive",
        `- promisedPayoff: ${promisedPayoff}`,
        `- payoffType: ${payoffType}`,
        `- payoffDepth: ${payoffDepth}`,
        `- mandatoryByFinalAct: ${mandatoryByFinalAct}`,
        "Priority is mandatory: payoff > cost > endingType.",
        "If payoff is not realized, the chapter is invalid regardless of cost or ending type.",
        "Execution order is locked: buildup -> trigger -> MOMENT (standalone sentence) -> result -> cost.",
        "Hard lock: trigger must appear before MOMENT; MOMENT must appear before result/cost.",
        "Do not skip the payoff to satisfy cost, calm_end, unresolved_end, or any other endingType.",
        "Every payoff must include: sensory detail, cost paid, visible change in situation.",
        "Every payoff must include vivid sensory detail showing the exact moment of change.",
        "Every payoff must include a clear moment of change (a single, sharp turning instant).",
        "Moment format is mandatory: write the MOMENT as one standalone sentence where the event clearly happens.",
        "The MOMENT must be a hard event, not a gradual process. Invalid: 'gradually opened', 'began to open', 'seemed to open'.",
        "Banned gradual Chinese expressions in MOMENT: '开始打开', '正在打开', '缓缓开启', '似乎裂开'.",
        "Valid MOMENT example: 'The stone door split open with a crack.'",
        "After the MOMENT, you MUST include a resolution phase that stabilizes the situation.",
        "Every payoff MUST include a clear cost that hurts the protagonist.",
        "Cost is mandatory and must land after the moment/result: moment -> result -> cost.",
        "Cost must be at least one of: worsened bodily injury, qi-blood/blood essence/resource consumption, time cost that prevents action, or lingering side effect / worsened state.",
        "No-cost success is invalid. Example: 'The door opened. His right arm went completely numb.'",
        payoffType === "resource"
          ? "For resource payoff, you MUST turn the acquisition into a sharp event with a clear trigger and impact."
          : undefined,
        payoffType === "reveal"
          ? "For reveal payoff, you MUST write one standalone cognitive moment sentence where understanding completes clearly."
          : undefined,
        payoffType === "reveal"
          ? "Invalid reveal wording: 'he seemed to realize', 'he vaguely discovered', 'he felt that'."
          : undefined,
        payoffType === "reveal"
          ? "Valid reveal examples: 'In that instant, he understood the contract.' / 'He finally understood that this was not a contract, but a trap.' / 'All the clues snapped together at that moment.'"
          : undefined,
        payoffType === "resource"
          ? "Resource payoff structure is mandatory: trigger -> MOMENT -> cost -> stabilization."
          : undefined,
        payoffType === "resource"
          ? "Do not write flat resource lines like 'he obtained it' or 'the information appeared in his mind'."
          : undefined,
        "Do not use abstract payoff-only phrasing like 'power increased' or 'suppression disappeared' without concrete sensory rendering.",
        "Painless success is invalid.",
        "The promised payoff MUST happen in this chapter at least partially.",
        "- Act 3 must materialize the payoff as an actual event, not a vague hint.",
        "- If the payoff is reveal/resource/breakthrough/relationship/reversal, the final act must show a concrete reveal, resource gain, breakthrough, relationship shift, or reversal beat.",
        "- Payoff paragraph structure is mandatory: buildup -> MOMENT -> post-moment resolution.",
        "- MOMENT sentence format: one standalone sentence, explicit occurrence, no gradual wording.",
        "- Cost placement is mandatory: moment -> result -> cost. The cost must be concrete and visible.",
        "- Payoff impact must include: sensory detail + turning instant + cost paid + visible change.",
        "- Missing this standalone event sentence triggers missing-moment / payoff-impact-missing.moment.",
        "- MOMENT cannot be the final sentence of the chapter.",
        payoffType === "reveal" && payoffDepth === "layered"
          ? "- For layered reveal, this chapter may realize only one reveal layer (surface OR middle), and must leave at least one unresolved deeper unknown."
          : undefined,
        "- If the promised payoff is missing, the chapter is considered failed and must be rewritten in Payoff Realization Mode.",
        "",
      ].filter(Boolean).join("\n");
    }

    return [
      "",
      "## Payoff Realization Directive",
      `- promisedPayoff: ${promisedPayoff}`,
      `- payoffType: ${payoffType}`,
      `- payoffDepth: ${payoffDepth}`,
      `- mandatoryByFinalAct: ${mandatoryByFinalAct}`,
      "Priority is mandatory: payoff > cost > endingType.",
      "If payoff is not realized, the chapter is invalid regardless of cost or ending type.",
      "执行顺序锁死：buildup（过程）-> trigger（触发）-> MOMENT（必须单独一句）-> result（结果）-> cost（代价）。",
      "硬锁：trigger 必须先于 MOMENT，MOMENT 必须先于 result/cost。",
      "禁止为了满足 cost、calm_end、unresolved_end 或任何 endingType 而跳过 payoff。",
      "Every payoff must include: sensory detail, cost paid, visible change in situation.",
      "Every payoff must include vivid sensory detail showing the exact moment of change.",
      "Every payoff must include a clear moment of change (a single, sharp turning instant).",
      "Moment format is mandatory: write the MOMENT as one standalone sentence where the event clearly happens.",
      "The MOMENT must be a hard event, not a gradual process. Invalid: “逐渐打开 / 开始打开 / 正在打开 / 缓缓开启 / 似乎打开 / 似乎裂开”.",
      "正确 MOMENT 示例：门，被强行打开。",
      "正确 MOMENT 示例：石门猛地裂开。",
      "After the MOMENT, you MUST include a resolution phase that stabilizes the situation.",
      "Every payoff MUST include a clear cost that hurts the protagonist.",
      "Cost is mandatory and must land after the moment/result: moment -> result -> cost.",
      "代价至少满足一种：身体损伤加重、气血/精血/资源消耗、时间代价（无法行动）、后遗症/状态恶化。",
      "禁止无代价成功。错误：门开了。正确：门开了。他的右臂随之彻底失去知觉。",
      payoffType === "resource"
        ? "For resource payoff, you MUST turn the acquisition into a sharp event with a clear trigger and impact."
        : undefined,
      payoffType === "reveal"
        ? "硬规则：reveal 型 payoff 必须写出认知断点句：单独一句，认知在这一句里明确完成。"
        : undefined,
      payoffType === "reveal"
        ? "禁止 reveal 写成“他似乎意识到 / 他隐约发现 / 他感觉到”。"
        : undefined,
      payoffType === "reveal"
        ? "正确 reveal 模板：那一刻，他看懂了这份契约。/ 他终于明白，这不是契约，而是陷阱。/ 所有线索，在这一刻拼合。"
        : undefined,
      payoffType === "resource"
        ? "资源型 payoff 必须写成带触发与冲击的获取事件，结构固定为 trigger -> MOMENT -> cost -> stabilization。"
        : undefined,
      payoffType === "resource"
        ? "禁止直接写“他获得了……”或“信息出现在脑海”。"
        : undefined,
      "禁止只写抽象结果（如“力量增强”“压制消失”）；必须给出变化瞬间的具体感知描写。",
      "Painless success is invalid.",
      "The promised payoff MUST happen in this chapter at least partially.",
      "- Act3 必须把 payoff 兑现成实际事件，而不是模糊暗示。",
      "- 如果 payoffType 是 reveal/resource/breakthrough/relationship/reversal，则章尾主段必须出现对应的真实揭示、资源获得、突破、关系变化或反转节点。",
      "- payoff 段结构必须为：buildup（铺垫）-> MOMENT（爆点）-> post-moment resolution（收束）。",
      "- MOMENT 句格式：必须单独成句，明确发生，不允许渐变表达。",
      "- cost 落点强制：moment -> result -> cost，代价必须具体落地。",
      "- payoff 冲击必须具备：感知层 + 瞬间爆发点 + 代价层 + 结果层。",
      "- 缺少这个单句瞬间事件会触发 missing-moment / payoff-impact-missing.moment。",
      "- MOMENT 不能作为章节最后一句。",
      payoffType === "reveal" && payoffDepth === "layered"
        ? "- layered reveal 只允许本章兑现一层（表层或中层），必须保留至少一个更深未知，不得一章全解释完。"
        : undefined,
      "- 如果 promised payoff 没有兑现，本章视为失败，必须进入 Payoff Realization Mode 重写。",
      "",
    ].filter(Boolean).join("\n");
  }

  private buildHookEmergenceDirectiveBlock(params: {
    readonly directive:
      | {
        readonly mustMaterializeHookNow: boolean;
        readonly hookExecutionPhase?: "any" | "late";
        readonly targetHookId?: string;
        readonly targetHookState?: string;
        readonly targetHookExpectedPayoff?: string;
        readonly targetHookNotes?: string;
      }
      | undefined;
    readonly language: "zh" | "en";
  }): string {
    if (!params.directive?.mustMaterializeHookNow || !params.directive.targetHookId) {
      return "";
    }

    if (params.language === "en") {
      return [
        "",
        "## Hook Emergence Directive",
        `- mustMaterializeHookNow: ${params.directive.mustMaterializeHookNow}`,
        params.directive.hookExecutionPhase ? `- hookExecutionPhase: ${params.directive.hookExecutionPhase}` : undefined,
        `- targetHookId: ${params.directive.targetHookId}`,
        `- targetHookState: ${params.directive.targetHookState ?? "overdue"}`,
        `- targetHookExpectedPayoff: ${params.directive.targetHookExpectedPayoff ?? "none"}`,
        "- This hook cannot stay suspended. The chapter must advance it, partially resolve it, or fully resolve it now.",
        "- Mentioning the hook name again, repeating old information, or merely saying the danger still exists does not count.",
        "- The hook needs a real new state change this chapter.",
        params.directive.hookExecutionPhase === "late"
          ? "- PRIORITY ORDER: mood directive > scene plan > payoff > hook emergence."
          : undefined,
        params.directive.hookExecutionPhase === "late"
          ? "- Hook emergence is allowed only in [Scene3]. [Scene1] and [Scene2] must remain recovery/dialogue-focused."
          : undefined,
        params.directive.hookExecutionPhase === "late"
          ? "- If hook advancement or climax appears in [Scene1]/[Scene2], the chapter is invalid and must be rewritten."
          : undefined,
        "",
      ].join("\n");
    }

    return [
      "",
      "## Hook Emergence Directive",
      `- mustMaterializeHookNow: ${params.directive.mustMaterializeHookNow}`,
      params.directive.hookExecutionPhase ? `- hookExecutionPhase: ${params.directive.hookExecutionPhase}` : undefined,
      `- targetHookId: ${params.directive.targetHookId}`,
      `- targetHookState: ${params.directive.targetHookState ?? "overdue"}`,
      `- targetHookExpectedPayoff: ${params.directive.targetHookExpectedPayoff ?? "none"}`,
      "- 这个 hook 不能继续纯悬置。本章必须让它发生推进、部分兑现或完全回收之一。",
      "- 仅仅再次提到 hook 名字、重复旧信息、或只说危险仍在，不算推进。",
      "- 本章必须让这个 hook 产生真正的新状态变化。",
      params.directive.hookExecutionPhase === "late"
        ? "- 指令优先级：mood directive > scene plan > payoff > hook推进。"
        : undefined,
      params.directive.hookExecutionPhase === "late"
        ? "- Hook 推进只能发生在 [Scene3]。在 [Scene1]/[Scene2] 禁止触发核心冲突或高潮。"
        : undefined,
      params.directive.hookExecutionPhase === "late"
        ? "- 若在 [Scene1]/[Scene2] 提前推进 hook，本章视为无效，必须重写。"
        : undefined,
      "",
    ].join("\n");
  }

  private async rewriteForPayoffDirectiveIfNeeded(params: {
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    };
    chapterIntent?: string;
    payoffSuppression?: IntentPayoffSuppression;
    chapterGoal?: ChapterGoal;
    language: "zh" | "en";
    chapterNumber: number;
    maxTokens: number;
    titleCandidates: ReadonlyArray<{ title: string }>;
    countingMode: LengthSpec["countingMode"];
    minWholeChapterWords?: number;
    onUsage: (usage: TokenUsage) => void;
  }): Promise<{
    title: string;
    content: string;
    wordCount: number;
    preWriteCheck: string;
  }> {
    const chapterGoal = params.chapterGoal;
    if (!chapterGoal || !chapterGoal.payoffToDeliver?.trim()) {
      return params.creative;
    }
    if (params.payoffSuppression?.suppressPayoff) {
      this.logWarn(params.language, {
        zh: `Writer PAYOFF MODE skipped: chapter_intent suppresses payoff（第${params.chapterNumber}章，${params.payoffSuppression.reason ?? "本章不得完整兑现 payoff"}）`,
        en: `Writer PAYOFF MODE skipped: chapter_intent suppresses payoff (chapter ${params.chapterNumber}, ${params.payoffSuppression.reason ?? "payoff must not be fully materialized in this chapter"})`,
      });
      return params.creative;
    }
    const payoffDirective = chapterGoal.payoffDirective ?? {
      promisedPayoff: chapterGoal.payoffToDeliver,
      payoffType: "resource" as const,
      mandatoryByFinalAct: true,
    };

    let currentCreative = params.creative;
    let checks = evaluateChapterGoalDiscipline(currentCreative.content, chapterGoal);
    let impactCheck = evaluatePayoffImpact(currentCreative.content, chapterGoal);
    if (checks.payoffCheck.matchLevel === "full" && (!impactCheck || impactCheck.matched)) {
      return currentCreative;
    }

    for (
      let attempt = 1;
      attempt <= 2 && (checks.payoffCheck.matchLevel !== "full" || (impactCheck ? !impactCheck.matched : false));
      attempt += 1
    ) {
      const forceMomentAnchor = false;
      this.logWarn(params.language, {
        zh: `Writer PAYOFF MODE：第${params.chapterNumber}章 rewrite attempt ${attempt}，payoff ${checks.payoffCheck.matched ? "冲击层缺失" : "尚未真正兑现"}`,
        en: `Writer PAYOFF MODE: chapter ${params.chapterNumber} rewrite attempt ${attempt}, payoff ${checks.payoffCheck.matched ? "impact layers missing" : "still not materialized"}`,
      });

      const response = await this.chat(
        [
          {
            role: "system",
            content: this.buildPayoffRewriteSystemPrompt(params.language, payoffDirective, forceMomentAnchor),
          },
          {
            role: "user",
            content: this.buildPayoffRewritePrompt({
              language: params.language,
              chapterNumber: params.chapterNumber,
              originalTitle: currentCreative.title,
              originalContent: currentCreative.content,
              preWriteCheck: currentCreative.preWriteCheck,
              payoffDirective,
              titleCandidates: params.titleCandidates,
              forceMomentAnchor,
            }),
          },
        ],
        { maxTokens: params.maxTokens, temperature: 0.5 },
      );
      params.onUsage(response.usage);
      let candidate = parseCreativeOutput(params.chapterNumber, response.content, params.countingMode);
      if (forceMomentAnchor) {
        candidate = this.applyForcedMomentAnchor(candidate, chapterGoal, params.language, params.countingMode);
      }
      const decision = this.acceptWholeChapterRewrite({
        language: params.language,
        chapterNumber: params.chapterNumber,
        stage: `payoff-rewrite-attempt-${attempt}`,
        beforeContent: currentCreative.content,
        afterContent: candidate.content,
        countingMode: params.countingMode,
        minWholeChapterWords: params.minWholeChapterWords,
      });
      if (!decision.accepted) {
        break;
      }
      currentCreative = candidate;
      checks = evaluateChapterGoalDiscipline(currentCreative.content, chapterGoal);
      impactCheck = evaluatePayoffImpact(currentCreative.content, chapterGoal);
    }

    return currentCreative;
  }

  private buildPayoffRewriteSystemPrompt(
    language: "zh" | "en",
    payoffDirective: NonNullable<ChapterGoal["payoffDirective"]>,
    forceMomentAnchor = false,
  ): string {
    const payoffDepth = payoffDirective.payoffDepth ?? "layered";
    if (language === "en") {
      const rules = [
        "PAYOFF REALIZATION MODE -- controlled rewrite to materialize a missing payoff.",
        `Promised payoff: ${payoffDirective.promisedPayoff}`,
        `Payoff type: ${payoffDirective.payoffType} | depth: ${payoffDepth}`,
        "",
        "CORE RULES (non-negotiable):",
        "1. PRIORITY: payoff > cost > endingType. If payoff is missing, the chapter fails.",
        "2. STRUCTURE: buildup -> trigger -> MOMENT (standalone sentence) -> result -> cost.",
        "3. MOMENT: one standalone sentence where the event happens all at once. No gradual wording (began to, seemed to, gradually).",
        "4. COST: concrete harm landing after result. No painless success. Body injury, resource drain, time loss, or worsened state.",
        "5. SENSORY: at least one vivid sensory detail (visual/touch/sound/physiological) at the moment of change.",
        "6. ACT 3: the payoff event must appear in Act 3, not as a vague hint.",
        "7. MOMENT must not be the final sentence of the chapter.",
        "",
        "TYPE-SPECIFIC:",
        payoffDirective.payoffType === "resource"
          ? "- Resource: sharp acquisition event with trigger + impact. No flat \"he obtained it\" lines."
          : undefined,
        payoffDirective.payoffType === "reveal"
          ? "- Reveal: one standalone cognitive-moment sentence where understanding completes. No \"he seemed to realize\" / \"he vaguely felt\"."
          : undefined,
        payoffDirective.payoffType === "reveal" && payoffDepth === "layered"
          ? "- Layered reveal: materialize ONE layer only. Leave a deeper unknown unresolved."
          : undefined,
        "",
        "MINIMUM VIABLE PAYOFF:",
        "If you cannot fit a complete payoff scene within the chapter, deliver the minimum viable version:",
        "- At least ONE concrete sentence showing tangible progress toward the promised payoff.",
        "- That sentence must include a cost or trade-off.",
        "- A partial, costly step forward is valid. A vague hint is not.",
        "",
        forceMomentAnchor
          ? "FORCED MOMENT ANCHOR: previous rewrites failed. Insert a standalone MOMENT sentence immediately after the trigger, even if the transition is imperfect. Then add result + cost."
          : undefined,
        "",
        "Insert or replace a scene in Act 3. Do not patch with one sentence -- rewrite the payoff paragraph as a complete impact beat.",
        "Keep chapter facts and continuity intact.",
      ].filter(Boolean).join("\n");
      return rules;
    }

    const rules = [
      "PAYOFF REALIZATION MODE -- \u53d7\u63a7\u91cd\u5199\uff0c\u5151\u73b0\u7f3a\u5931\u7684 payoff\u3002",
      `Promised payoff: ${payoffDirective.promisedPayoff}`,
      `Payoff type: ${payoffDirective.payoffType} | depth: ${payoffDepth}`,
      "",
      "\u6838\u5fc3\u89c4\u5219\uff08\u4e0d\u53ef\u59a5\u534f\uff09\uff1a",
      "1. \u4f18\u5148\u7ea7\uff1apayoff > cost > endingType\u3002payoff \u7f3a\u5931\u5219\u672c\u7ae0\u65e0\u6548\u3002",
      "2. \u7ed3\u6784\uff1abuildup\uff08\u94fa\u57ab\uff09-> trigger\uff08\u89e6\u53d1\uff09-> MOMENT\uff08\u5355\u72ec\u4e00\u53e5\uff09-> result\uff08\u7ed3\u679c\uff09-> cost\uff08\u4ee3\u4ef7\uff09\u3002",
      "3. MOMENT\uff1a\u5fc5\u987b\u5355\u72ec\u4e00\u53e5\uff0c\u4e8b\u4ef6\u77ac\u95f4\u53d1\u751f\u3002\u7981\u6b62\u6e10\u53d8\u8868\u8fbe\uff08\u9010\u6e10/\u5f00\u59cb/\u6b63\u5728/\u7f13\u7f13/\u4f3c\u4e4e\uff09\u3002",
      "4. COST\uff1a\u5177\u4f53\u4ee3\u4ef7\u843d\u5728 result \u4e4b\u540e\uff0c\u771f\u6b63\u4f24\u5230\u4e3b\u89d2\u3002\u8eab\u4f53\u635f\u4f24\u3001\u8d44\u6e90\u6d88\u8017\u3001\u65f6\u95f4\u4ee3\u4ef7\u6216\u72b6\u6001\u6076\u5316\u3002\u7981\u6b62\u65e0\u75db\u6210\u529f\u3002",
      "5. \u611f\u77e5\uff1a\u53d8\u5316\u77ac\u95f4\u81f3\u5c11\u6709\u4e00\u5904\u5177\u4f53\u611f\u5b98\u7ec6\u8282\uff08\u89c6\u89c9/\u89e6\u89c9/\u542c\u89c9/\u751f\u7406\uff09\u3002",
      "6. Act3\uff1apayoff \u4e8b\u4ef6\u5fc5\u987b\u51fa\u73b0\u5728\u7b2c\u4e09\u5e55\uff0c\u4e0d\u80fd\u53ea\u662f\u6a21\u7cca\u6697\u793a\u3002",
      "7. MOMENT \u4e0d\u80fd\u662f\u7ae0\u8282\u6700\u540e\u4e00\u53e5\u3002",
      "",
      "\u6309\u7c7b\u578b\u7ea6\u675f\uff1a",
      payoffDirective.payoffType === "resource"
        ? "- \u8d44\u6e90\u578b\uff1a\u5199\u6210\u5e26\u89e6\u53d1\u4e0e\u51b2\u51fb\u7684\u83b7\u53d6\u4e8b\u4ef6\u3002\u7981\u6b62\u5e73\u94fa\u201c\u4ed6\u83b7\u5f97\u4e86\u2026\u2026\u201d\u3002"
        : undefined,
      payoffDirective.payoffType === "reveal"
        ? "- \u63ed\u793a\u578b\uff1a\u5199\u51fa\u5355\u72ec\u4e00\u53e5\u8ba4\u77e5\u65ad\u70b9\u2014\u2014\u8ba4\u77e5\u5728\u8fd9\u4e00\u53e5\u91cc\u660e\u786e\u5b8c\u6210\u3002\u7981\u6b62\u201c\u4ed6\u4f3c\u4e4e\u610f\u8bc6\u5230/\u9690\u7ea6\u53d1\u73b0/\u611f\u89c9\u5230\u201d\u3002"
        : undefined,
      payoffDirective.payoffType === "reveal" && payoffDepth === "layered"
        ? "- \u5206\u5c42\u63ed\u793a\uff1a\u672c\u7ae0\u53ea\u5151\u73b0\u4e00\u5c42\uff0c\u4fdd\u7559\u81f3\u5c11\u4e00\u4e2a\u66f4\u6df1\u672a\u77e5\u3002"
        : undefined,
      "",
      "\u6700\u5c0f\u53ef\u884c payoff\uff08\u515c\u5e95\u6307\u4ee4\uff09\uff1a",
      "\u5982\u679c\u65e0\u6cd5\u5728\u7ae0\u8282\u4e2d\u5b8c\u6210\u5b8c\u6574 payoff \u573a\u666f\uff0c\u4e5f\u5fc5\u987b\u7ed9\u51fa\u6700\u5c0f\u53ef\u884c\u7248\u672c\uff1a",
      "- \u81f3\u5c11\u4e00\u53e5\u5177\u4f53\u63cf\u5199\uff0c\u5c55\u793a\u5411\u627f\u8bfa payoff \u7684\u5b9e\u8d28\u6027\u63a8\u8fdb\u3002",
      "- \u8be5\u53e5\u5fc5\u987b\u5305\u542b\u4ee3\u4ef7\u6216\u4ea4\u6362\u3002",
      "- \u6709\u4ee3\u4ef7\u7684\u90e8\u5206\u63a8\u8fdb = \u6709\u6548\u3002\u6a21\u7cca\u6697\u793a = \u65e0\u6548\u3002",
      "",
      forceMomentAnchor
        ? "FORCED MOMENT ANCHOR\uff1a\u6b64\u524d rewrite \u5df2\u5931\u8d25\u3002\u5728 trigger \u4e4b\u540e\u63d2\u5165\u6807\u51c6 MOMENT \u5355\u53e5\uff0c\u5373\u4f7f\u8854\u63a5\u7565\u7a81\u5162\u4e5f\u5fc5\u987b\u63d2\u5165\uff0c\u7136\u540e\u7acb\u523b\u8865 result \u548c cost\u3002"
        : undefined,
      "",
      "\u5728 Act3 \u63d2\u5165\u6216\u66ff\u6362\u4e00\u4e2a scene\u3002\u4e0d\u8981\u8865\u4e00\u53e5\u8bdd\u4e86\u4e8b\u2014\u2014\u628a payoff \u6bb5\u91cd\u5199\u6210\u5b8c\u6574\u7684\u51b2\u51fb\u6bb5\u3002",
      "\u4fdd\u7559\u7ae0\u8282\u4e8b\u5b9e\u548c\u8fde\u7eed\u6027\u3002",
    ].filter(Boolean).join("\n");
    return rules;
  }

  private buildPayoffRewritePrompt(params: {
    language: "zh" | "en";
    chapterNumber: number;
    originalTitle: string;
    originalContent: string;
    preWriteCheck: string;
    payoffDirective: NonNullable<ChapterGoal["payoffDirective"]>;
    titleCandidates: ReadonlyArray<{ title: string }>;
    forceMomentAnchor?: boolean;
  }): string {
    const payoffDepth = params.payoffDirective.payoffDepth ?? "layered";
    if (params.language === "en") {
      return [
        `Chapter ${params.chapterNumber} failed payoff materialization.`,
        `Promised payoff: ${params.payoffDirective.promisedPayoff} | type: ${params.payoffDirective.payoffType} | depth: ${payoffDepth}`,
        "",
        "Insert or replace a concrete payoff scene in Act 3. Do not merely strengthen the hint.",
        "Priority: payoff > cost > endingType.",
        "Structure: buildup -> trigger -> MOMENT (standalone sentence) -> result -> cost.",
        "MOMENT: one standalone sentence. No gradual wording. Good example: The stone door split open with a crack.",
        "Cost: concrete harm landing after result. No painless success.",
        "Sensory: at least one vivid sensory detail at the moment of change.",
        "",
        params.payoffDirective.payoffType === "resource"
          ? "Resource payoff: sharp acquisition event with trigger + impact. No flat \"he obtained it\" lines."
          : undefined,
        params.payoffDirective.payoffType === "reveal"
          ? "Reveal payoff: one standalone cognitive-moment sentence. No \"he seemed to realize\" / \"he vaguely felt\"."
          : undefined,
        params.payoffDirective.payoffType === "reveal" && payoffDepth === "layered"
          ? "Reveal only one layer this chapter, leave a deeper unknown unresolved."
          : undefined,
        "",
        "MINIMUM VIABLE PAYOFF: if a full scene will not fit, deliver at least ONE concrete sentence showing tangible progress toward the payoff, with a cost attached. A partial costly step = valid. A vague hint = invalid.",
        "",
        params.forceMomentAnchor
          ? "FORCED MOMENT ANCHOR: insert one standalone MOMENT sentence after trigger, then result + cost, even if the transition is imperfect."
          : undefined,
        "",
        "Rewrite the payoff paragraph as a full impact beat. Do not patch one sentence.",
        "MOMENT must not be the final sentence.",
        "Output PRE_WRITE_CHECK, CHAPTER_TITLE, CHAPTER_CONTENT only.",
        params.titleCandidates.length > 0 ? `Title candidates: ${params.titleCandidates.map((c) => c.title).join(" | ")}` : undefined,
        "",
        "=== ORIGINAL_PRE_WRITE_CHECK ===",
        params.preWriteCheck || "- ok",
        "",
        "=== ORIGINAL_TITLE ===",
        params.originalTitle,
        "",
        "=== ORIGINAL_CONTENT ===",
        params.originalContent,
      ].filter(Boolean).join("\n");
    }

    return [
      `第${params.chapterNumber}章没有真正兑现 promised payoff。`,
      `Promised payoff: ${params.payoffDirective.promisedPayoff} | type: ${params.payoffDirective.payoffType} | depth: ${payoffDepth}`,
      "",
      "在 Act3 插入或替换一个具体的 payoff scene，不要只加强暗示。",
      "优先级：payoff > cost > endingType。",
      "结构：buildup（铺垫）-> trigger（触发）-> MOMENT（单独一句）-> result（结果）-> cost（代价）。",
      "MOMENT：单独一句，瞬间发生。禁止渐变（逐渐/开始/正在/缓缓/似乎）。示例：石门猛地裂开。",
      "代价：具体代价落在 result 之后。禁止无痛成功。",
      "感知：变化瞬间至少有一处具体感官细节。",
      "",
      params.payoffDirective.payoffType === "resource"
        ? "资源型：带触发与冲击的获取事件。禁止平铺\u201c他获得了\u2026\u2026\u201d。"
        : undefined,
      params.payoffDirective.payoffType === "reveal"
        ? "揭示型：单独一句认知断点。禁止\u201c他似乎意识到/隐约发现/感觉到\u201d。"
        : undefined,
      params.payoffDirective.payoffType === "reveal" && payoffDepth === "layered"
        ? "分层揭示：本章只兑现一层，保留至少一个更深未知。"
        : undefined,
      "",
      "最小可行 payoff（兜底）：如果完整场景塞不进本章，至少写一句具体描写展示向 payoff 的实质性推进，并带代价。有代价的部分推进 = 有效；模糊暗示 = 无效。",
      "",
      params.forceMomentAnchor
        ? "FORCED MOMENT ANCHOR：在 trigger 之后插入标准 MOMENT 单句，然后立刻补 result 与 cost。"
        : undefined,
      "",
      "重写 payoff 段为完整冲击段，不要只补一句话。",
      "MOMENT 不能是章节最后一句。",
      "只输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT。",
      params.titleCandidates.length > 0 ? `标题参考：${params.titleCandidates.map((c) => c.title).join(" | ")}` : undefined,
      "",
      "=== ORIGINAL_PRE_WRITE_CHECK ===",
      params.preWriteCheck || "- ok",
      "",
      "=== ORIGINAL_TITLE ===",
      params.originalTitle,
      "",
      "=== ORIGINAL_CONTENT ===",
      params.originalContent,
    ].filter(Boolean).join("\n");
  }

  private applyForcedMomentAnchor(
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    },
    chapterGoal: ChapterGoal,
    language: "zh" | "en",
    countingMode: LengthSpec["countingMode"],
  ): {
    title: string;
    content: string;
    wordCount: number;
    preWriteCheck: string;
  } {
    const momentLikePattern = language === "zh"
      ? /(就在这一刻|那一瞬间|这一刻|猛地|轰然|骤然|门，被强行打开。|石门，轰然裂开。|那扇门，开了。)/
      : /(in that instant|at that instant|all at once|the door was forced open|the stone door split open)/i;
    if (momentLikePattern.test(creative.content)) {
      return creative;
    }

    const paragraphs = creative.content
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) {
      return creative;
    }

    const anchorKind = this.resolveForcedMomentAnchorKind(chapterGoal, creative.content);
    const anchorSentence = this.selectForcedMomentAnchor(creative.content, chapterGoal, language, anchorKind);
    const resultSentence = this.buildForcedMomentAnchorResult(language, anchorKind);
    const costSentence = this.buildForcedMomentAnchorCost(language, anchorKind);
    const triggerPattern = language === "zh"
      ? /(触发|引动|催动|逼到极限|血痕|灼痛|共鸣|反噬|临界|匙钥|钥匙|裂纹|阵纹|符文|卷轴|古卷|石门|门扉|门锁|契约|地图|玉简|真相|记忆|意识|看懂|崩解|消散|失控|觉醒|反转|真名)/
      : /(trigger|resonance|backlash|limit|threshold|key|seal|door|gate|glyph|mark|pain|blood|contract|map|memory|truth|mind|awaken|break apart|identity)/i;
    const triggerIndex = paragraphs.findIndex((paragraph) => triggerPattern.test(paragraph));
    const insertAt = triggerIndex >= 0 ? triggerIndex + 1 : 1;
    const anchorBlock = [anchorSentence, resultSentence, costSentence].join("\n");
    const nextParagraphs = [...paragraphs];
    nextParagraphs.splice(Math.min(insertAt, nextParagraphs.length), 0, anchorBlock);

    return {
      ...creative,
      content: nextParagraphs.join("\n\n"),
      wordCount: countChapterLength(nextParagraphs.join("\n\n"), countingMode),
      preWriteCheck: creative.preWriteCheck.includes("forced moment anchor")
        ? creative.preWriteCheck
        : `${creative.preWriteCheck.trim()}\n- forced moment anchor inserted`.trim(),
    };
  }

  private selectForcedMomentAnchor(
    content: string,
    chapterGoal: ChapterGoal,
    language: "zh" | "en",
    anchorKind: "event" | "resource-cognition" | "state-change" | "reveal-cognition",
  ): string {
    if (language === "en") {
      if (anchorKind === "reveal-cognition") {
        return "In that instant, he understood the contract.";
      }
      if (anchorKind === "resource-cognition") {
        if (/contract/i.test(content)) {
          return "The full contract flooded into his mind.";
        }
        return "In that instant, he understood what he had gained.";
      }
      if (anchorKind === "state-change") {
        if (/true name|name/i.test(content)) {
          return "His true name began to break apart.";
        }
        return "The change inside him lurched into motion.";
      }
      if (/stone door|stone gate/i.test(content)) {
        return "The stone door split open with a crash.";
      }
      if (/door|gate|seal|lock/i.test(content)) {
        return "The door was forced open.";
      }
      return "That door opened.";
    }

    if (anchorKind === "reveal-cognition") {
      if (/陷阱|trap/i.test(content)) {
        return "他终于明白，这不是契约，而是陷阱。";
      }
      if (/线索/.test(content)) {
        return "所有线索，在这一刻拼合。";
      }
      return "那一刻，他看懂了这份契约。";
    }
    if (anchorKind === "resource-cognition") {
      if (/契约/.test(content)) {
        return "契约的全部内容，涌入他的意识。";
      }
      if (/地图|玉简/.test(content)) {
        return "那一刻，他看懂了这份线索。";
      }
      return "那一刻，他看懂了这份契约。";
    }
    if (anchorKind === "state-change") {
      if (/真名/.test(content) || /真名/.test(chapterGoal.payoffToDeliver ?? "")) {
        return "他的真名，开始崩解。";
      }
      return "消散的速度，骤然加快。";
    }
    if (/石门|石壁门|门扉/.test(content)) {
      return "石门，轰然裂开。";
    }
    if (/门|门洞|门锁|封门|封印/.test(content) || chapterGoal.payoffDirective?.payoffType === "resource") {
      return "门，被强行打开。";
    }
    return "那扇门，开了。";
  }

  private resolveForcedMomentAnchorKind(
    chapterGoal: ChapterGoal,
    content: string,
  ): "event" | "resource-cognition" | "state-change" | "reveal-cognition" {
    const payoffType = chapterGoal.payoffDirective?.payoffType;
    const promised = `${chapterGoal.payoffDirective?.promisedPayoff ?? ""} ${chapterGoal.payoffToDeliver ?? ""} ${content}`;
    if (payoffType === "resource") {
      return "resource-cognition";
    }
    if (payoffType === "reveal") {
      return "reveal-cognition";
    }
    if (payoffType === "breakthrough" || payoffType === "reversal") {
      return "state-change";
    }
    if (
      /(揭开|揭示|看懂|明白|真相|线索拼合|认出|识破|看清)/.test(promised)
    ) {
      return "reveal-cognition";
    }
    if (
      /(契约|地图|玉简|线索|信息|真相|记忆|意识|看懂|得知|认出|看清)/.test(promised)
    ) {
      return "resource-cognition";
    }
    if (
      /(真名|崩解|消散|失控|觉醒|突破|反转|污染|侵蚀|蜕变|状态)/.test(promised)
    ) {
      return "state-change";
    }
    return "event";
  }

  private buildForcedMomentAnchorResult(
    language: "zh" | "en",
    anchorKind: "event" | "resource-cognition" | "state-change" | "reveal-cognition",
  ): string {
    if (language === "en") {
      if (anchorKind === "reveal-cognition") {
        return "The hidden meaning locked into place, and the reveal finally became usable truth.";
      }
      if (anchorKind === "resource-cognition") {
        return "New meaning snapped into place, and the scene finally yielded usable knowledge.";
      }
      if (anchorKind === "state-change") {
        return "His condition shifted visibly, pushing the whole situation into a new state.";
      }
      return "The situation lurched forward the instant that sentence became real.";
    }

    if (anchorKind === "reveal-cognition") {
      return "隐去的那一层意思，终于在这一句里锁死成了真相。";
    }
    if (anchorKind === "resource-cognition") {
      return "新的信息，在这一句之后终于落成了可用的认知。";
    }
    if (anchorKind === "state-change") {
      return "他的状态，被这一句硬生生推到了新的阶段。";
    }
    return "局势，在这一句之后被硬生生往前推了一步。";
  }

  private buildForcedMomentAnchorCost(
    language: "zh" | "en",
    anchorKind: "event" | "resource-cognition" | "state-change" | "reveal-cognition",
  ): string {
    if (language === "en") {
      if (anchorKind === "reveal-cognition") {
        return "The price hit with the understanding, leaving his head ringing and his breathing uneven.";
      }
      if (anchorKind === "resource-cognition") {
        return "The cost hit immediately after it, leaving his mind throbbing and his body reeling.";
      }
      if (anchorKind === "state-change") {
        return "The price followed at once, tearing through his body and stripping away control.";
      }
      return "The cost crashed in right after it, dragging pain back through the old wound.";
    }

    if (anchorKind === "reveal-cognition") {
      return "代价也随着这道认知一起压下来，额角发紧，呼吸都乱了一瞬。";
    }
    if (anchorKind === "resource-cognition") {
      return "代价随即压进识海，太阳穴突突作痛，连呼吸都乱了一拍。";
    }
    if (anchorKind === "state-change") {
      return "代价立刻反咬回来，筋骨发紧，失控感顺着血肉往上窜。";
    }
    return "代价也紧跟着压了回来，胸口一沉，旧伤随之发作。";
  }

  private async rewriteForMoodDirectiveIfNeeded(params: {
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    };
    chapterIntent?: string;
    moodDirective?: MoodDirective;
    hookEmergenceDirective?:
      | {
        readonly mustMaterializeHookNow: boolean;
        readonly hookExecutionPhase?: "any" | "late";
        readonly targetHookId?: string;
        readonly targetHookState?: string;
        readonly targetHookExpectedPayoff?: string;
        readonly targetHookNotes?: string;
      }
      | undefined;
    language: "zh" | "en";
    chapterNumber: number;
    maxTokens: number;
    titleCandidates: ReadonlyArray<{ title: string }>;
    countingMode: LengthSpec["countingMode"];
    minWholeChapterWords?: number;
    onUsage: (usage: TokenUsage) => void;
  }): Promise<{
    title: string;
    content: string;
    wordCount: number;
    preWriteCheck: string;
  }> {
    const { creative, chapterIntent, moodDirective, language, chapterNumber, maxTokens, countingMode } = params;
    if (!moodDirective || moodDirective.targetMode !== "breath") {
      return creative;
    }

    const requireSceneStructure = moodDirective.forceSceneStructure ?? true;
    let currentCreative = creative;
    let structureCheck = this.evaluateBreathSceneStructure(currentCreative.content, moodDirective);
    let hookPhaseCheck = this.evaluateHookExecutionPhaseInBreathScenes(currentCreative.content, params.hookEmergenceDirective);
    let moodCheck = evaluateMoodCadenceCompliance(currentCreative.content, chapterIntent);
    if (
      (!moodCheck || moodCheck.matched)
      && (!requireSceneStructure || structureCheck.matched)
      && hookPhaseCheck.matched
    ) {
      return currentCreative;
    }

    const maxAttempts = 4;
    for (
      let attempt = 1;
      attempt <= maxAttempts
      && ((moodCheck && !moodCheck.matched) || (requireSceneStructure && !structureCheck.matched) || !hookPhaseCheck.matched);
      attempt += 1
    ) {
      this.logWarn(language, {
        zh: `Writer REWRITE MODE：第${chapterNumber}章 rewrite attempt ${attempt}，当前 breath coverage=${Math.round((moodCheck?.coverageRatio ?? 0) * 100)}%，sceneStructure=${structureCheck.matched ? "ok" : "failed"}，hookPhase=${hookPhaseCheck.matched ? "ok" : "failed"}`,
        en: `Writer REWRITE MODE: chapter ${chapterNumber} rewrite attempt ${attempt}, current breath coverage=${Math.round((moodCheck?.coverageRatio ?? 0) * 100)}%, sceneStructure=${structureCheck.matched ? "ok" : "failed"}, hookPhase=${hookPhaseCheck.matched ? "ok" : "failed"}`,
      });

      const rewriteResponse = await this.chat(
        [
          {
            role: "system",
            content: this.buildMoodRewriteSystemPrompt({
              language,
              moodDirective,
            }),
          },
          {
            role: "user",
            content: this.buildMoodRewritePrompt({
              language,
              chapterNumber,
              originalTitle: currentCreative.title,
              originalContent: currentCreative.content,
              preWriteCheck: currentCreative.preWriteCheck,
              moodDirective,
              titleCandidates: params.titleCandidates,
              currentCoverageRatio: moodCheck?.coverageRatio ?? 0,
              structureCheck,
              hookPhaseCheck,
              hookEmergenceDirective: params.hookEmergenceDirective,
              attempt,
            }),
          },
        ],
        { maxTokens, temperature: 0.55 },
      );
      params.onUsage(rewriteResponse.usage);

      const candidate = parseCreativeOutput(chapterNumber, rewriteResponse.content, countingMode);
      const decision = this.acceptWholeChapterRewrite({
        language,
        chapterNumber,
        stage: `mood-rewrite-attempt-${attempt}`,
        beforeContent: currentCreative.content,
        afterContent: candidate.content,
        countingMode,
        minWholeChapterWords: params.minWholeChapterWords,
      });
      if (!decision.accepted) {
        break;
      }
      currentCreative = candidate;
      structureCheck = this.evaluateBreathSceneStructure(currentCreative.content, moodDirective);
      hookPhaseCheck = this.evaluateHookExecutionPhaseInBreathScenes(currentCreative.content, params.hookEmergenceDirective);
      moodCheck = evaluateMoodCadenceCompliance(currentCreative.content, chapterIntent);
      if (
        (!moodCheck || moodCheck.matched)
        && (!requireSceneStructure || structureCheck.matched)
        && hookPhaseCheck.matched
      ) {
        return currentCreative;
      }
    }

    return currentCreative;
  }

  private buildMoodRewriteSystemPrompt(params: {
    language: "zh" | "en";
    moodDirective: MoodDirective;
  }): string {
    const targetCoverage = Math.round(params.moodDirective.moodCoverageMin * 100);
    if (params.language === "en") {
      return [
        "REWRITE MODE",
        "FRESH GENERATION MODE",
        "You are not patching the prior draft.",
        "You are performing a controlled full regeneration to satisfy a failed breath-mode directive.",
        "Force writing mode switch: WRITING_MODE=breath.",
        `Hard requirement: final breath coverage must be >= ${targetCoverage}%.`,
        "Hard requirement: regenerate structure from constraints, not patch existing paragraphs.",
        "Move combat-heavy beats to later sections; first 60% must be recovery/dialogue/relationship-oriented.",
        "Hard requirement: add a real breath section and replace part of the combat-heavy stretch if necessary.",
        "Keep chapter facts, outcomes, and plot continuity intact.",
        "Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT.",
      ].join("\n");
    }

    return [
      "REWRITE MODE",
      "FRESH GENERATION MODE",
      "你现在不是补丁式改稿。",
      "你正在执行一次受控的整章重生，用来修复 breath-mode directive 失败。",
      "强制切换写作模式：WRITING_MODE=breath。",
      `硬约束：最终 breath coverage 必须 >= ${targetCoverage}%。`,
      "硬约束：这次要按约束从头重建结构，不是补丁式加内容。",
      "把 combat-heavy 段后移，前 60% 必须是恢复/对话/关系推进场景。",
      "硬约束：必须新增真正的 breath section，并在必要时替换掉部分 combat-heavy 战斗段。",
      "保留章节事实、结果和连续性，不得推翻既有主线。",
      "只输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块。",
    ].join("\n");
  }

  private buildMoodRewritePrompt(params: {
    language: "zh" | "en";
    chapterNumber: number;
    originalTitle: string;
    originalContent: string;
    preWriteCheck: string;
    moodDirective: MoodDirective;
    titleCandidates: ReadonlyArray<{ title: string }>;
    currentCoverageRatio: number;
    structureCheck: {
      readonly matched: boolean;
      readonly missingScenes: ReadonlyArray<"Scene1" | "Scene2" | "Scene3">;
      readonly sceneShares: Readonly<Record<"Scene1" | "Scene2" | "Scene3", number>>;
      readonly minSceneShare: number;
    };
    hookPhaseCheck: {
      readonly matched: boolean;
      readonly violatedScenes: ReadonlyArray<"Scene1" | "Scene2">;
      readonly evidence?: string;
    };
    hookEmergenceDirective?:
      | {
        readonly mustMaterializeHookNow: boolean;
        readonly hookExecutionPhase?: "any" | "late";
        readonly targetHookId?: string;
        readonly targetHookState?: string;
        readonly targetHookExpectedPayoff?: string;
        readonly targetHookNotes?: string;
      }
      | undefined;
    attempt: number;
  }): string {
    const failedScenes = (["Scene1", "Scene2", "Scene3"] as const)
      .filter((scene) => params.structureCheck.sceneShares[scene] < params.structureCheck.minSceneShare)
      .map((scene) => `${scene}(${Math.round(params.structureCheck.sceneShares[scene] * 100)}%)`);
    const missingScenes = params.structureCheck.missingScenes.join(", ") || "none";

    if (params.language === "en") {
      return [
        `Chapter ${params.chapterNumber} failed the local mood self-check on rewrite attempt ${params.attempt}.`,
        "",
        `- currentCoverage=${Math.round(params.currentCoverageRatio * 100)}%`,
        `- targetCoverage>=${Math.round(params.moodDirective.moodCoverageMin * 100)}%`,
        `- sceneStructureMatched=${params.structureCheck.matched}`,
        `- missingScenes=${missingScenes}`,
        `- sceneShares=${JSON.stringify({
          scene1: Math.round(params.structureCheck.sceneShares.Scene1 * 100),
          scene2: Math.round(params.structureCheck.sceneShares.Scene2 * 100),
          scene3: Math.round(params.structureCheck.sceneShares.Scene3 * 100),
        })}%`,
        failedScenes.length > 0 ? `- underMinShareScenes=${failedScenes.join(", ")}` : "- underMinShareScenes=none",
        params.hookEmergenceDirective?.hookExecutionPhase === "late"
          ? `- hookExecutionPhase=late (targetHook=${params.hookEmergenceDirective.targetHookId ?? "unknown"})`
          : undefined,
        params.hookEmergenceDirective?.hookExecutionPhase === "late"
          ? `- hookPhaseMatched=${params.hookPhaseCheck.matched}`
          : undefined,
        params.hookEmergenceDirective?.hookExecutionPhase === "late"
          ? `- hookPhaseViolatedScenes=${params.hookPhaseCheck.violatedScenes.join(", ") || "none"}`
          : undefined,
        params.hookEmergenceDirective?.hookExecutionPhase === "late" && params.hookPhaseCheck.evidence
          ? `- hookPhaseEvidence=${params.hookPhaseCheck.evidence}`
          : undefined,
        "- Keep the chapter facts, outcomes, and core plot beats intact.",
        "- Full-regeneration rule: generate a new chapter body from constraints; do not patch old paragraph structure.",
        "- Force writing mode for this rewrite: WRITING_MODE=breath.",
        "- Tone requirement: slow down sentence pacing and remove sustained high-pressure diction.",
        "- Mandatory semantic payload: tactile/body sensations, environment grounding (smell/sound/light), and interaction details (dialogue/eyes/micro-actions).",
        "- Forbidden semantic pattern: dense repeated crisis lexicon (danger/kill intent/explosion/collapse/dying) across consecutive lines.",
        "- PRIMARY STRUCTURAL REQUIREMENT: organize the chapter as Act 1 / Act 2 / Act 3.",
        "- First paragraph hard rule: must open with recovery/environment/dialogue details.",
        "- First paragraph forbidden content: direct conflict trigger, immediate threat, enemy action.",
        "- FORCE THREE-SCENE OUTPUT. CHAPTER_CONTENT must contain [Scene1], [Scene2], [Scene3] in order.",
        "- Scene1/Scene2/Scene3 are all mandatory. Missing any scene is failure.",
        `- Each scene must be >= ${Math.round(params.structureCheck.minSceneShare * 100)}% of CHAPTER_CONTENT.`,
        "- Breath chapter skeleton: Act 1 = aftershock / regroup, Act 2 = full breath scene, Act 3 = small forward motion with a low-intensity hook.",
        "- Reorder requirement: first 60% must complete breathing/recovery/dialogue before any major confrontation beat.",
        "- You must add a real Section B breath scene, not a token sentence.",
        '- Scene1 semantic hard rule: "Do NOT introduce new threats or escalate conflict."',
        '- Scene2 semantic hard rule: "Focus on interaction, not action."',
        '- Scene3 semantic hard rule: "Only here you may move plot forward."',
        "- You must rewrite at least one combat-heavy segment into: rest/healing, dialogue during joint movement, light warmth/trust progression, or resource sorting/plan discussion.",
        "- If you only append a small breathing beat while combat-heavy material still dominates, this rewrite is a failure.",
        "- You must replace part of the dominant combat structure, not merely append a tiny calm note at the end.",
        params.hookEmergenceDirective?.hookExecutionPhase === "late"
          ? "- Directive priority is fixed: mood directive > scene plan > payoff > hook emergence."
          : undefined,
        params.hookEmergenceDirective?.hookExecutionPhase === "late"
          ? "- Hook advancement is allowed only in [Scene3]. [Scene1]/[Scene2] must stay recovery/dialogue focused."
          : undefined,
        params.hookEmergenceDirective?.hookExecutionPhase === "late"
          ? "- If [Scene1]/[Scene2] contains hook advancement, core conflict trigger, or climax around the target hook, this rewrite still fails."
          : undefined,
        `- If breath coverage stays below ${Math.round(params.moodDirective.moodCoverageMin * 100)}%, this rewrite is still a failure.`,
        "- Output PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT only.",
        params.titleCandidates.length > 0 ? `- Prefer one of these titles if useful: ${params.titleCandidates.map((candidate) => candidate.title).join(" | ")}` : undefined,
        "",
        "=== ORIGINAL_PRE_WRITE_CHECK ===",
        params.preWriteCheck || "- ok",
        "",
        "=== ORIGINAL_TITLE (Reference only) ===",
        params.originalTitle,
        "",
        "=== FACT REFERENCE ONLY (Do not patch sentence structure) ===",
        params.originalContent,
      ].filter(Boolean).join("\n");
    }

    return [
      `第${params.chapterNumber}章在 rewrite attempt ${params.attempt} 仍未通过本地 mood self-check。`,
      "",
      `- 当前 coverage=${Math.round(params.currentCoverageRatio * 100)}%`,
      `- 目标 coverage>=${Math.round(params.moodDirective.moodCoverageMin * 100)}%`,
      `- sceneStructureMatched=${params.structureCheck.matched ? "true" : "false"}`,
      `- missingScenes=${missingScenes}`,
      `- sceneShares=Scene1:${Math.round(params.structureCheck.sceneShares.Scene1 * 100)}% / Scene2:${Math.round(params.structureCheck.sceneShares.Scene2 * 100)}% / Scene3:${Math.round(params.structureCheck.sceneShares.Scene3 * 100)}%`,
      failedScenes.length > 0 ? `- underMinShareScenes=${failedScenes.join("、")}` : "- underMinShareScenes=none",
      params.hookEmergenceDirective?.hookExecutionPhase === "late"
        ? `- hookExecutionPhase=late（targetHook=${params.hookEmergenceDirective.targetHookId ?? "unknown"}）`
        : undefined,
      params.hookEmergenceDirective?.hookExecutionPhase === "late"
        ? `- hookPhaseMatched=${params.hookPhaseCheck.matched ? "true" : "false"}`
        : undefined,
      params.hookEmergenceDirective?.hookExecutionPhase === "late"
        ? `- hookPhaseViolatedScenes=${params.hookPhaseCheck.violatedScenes.join("、") || "none"}`
        : undefined,
      params.hookEmergenceDirective?.hookExecutionPhase === "late" && params.hookPhaseCheck.evidence
        ? `- hookPhaseEvidence=${params.hookPhaseCheck.evidence}`
        : undefined,
      "- 保留章节事实、结果和主线推进，不要推翻既有情节。",
      "- 整章重生规则：按约束重写整章正文，不能沿用旧段落做补丁。",
      "- 本轮强制写作模式：WRITING_MODE=breath。",
      "- 语气硬约束：放慢句式节奏，去掉持续高压措辞。",
      "- 必须补齐语义载荷：触觉/身体感受 + 环境锚定（气味/声音/光线）+ 互动细节（对话/眼神/动作）。",
      "- 禁止语义模式：连续多行堆叠危机词（危险、杀机、爆发、崩裂、濒死）。",
      "- PRIMARY STRUCTURAL REQUIREMENT：章节必须按 Act1 / Act2 / Act3 组织。",
      "- 首段硬约束：必须以恢复/环境/对话开场。",
      "- 首段禁止：直接冲突触发、立即危机、敌人行动。",
      "- 强制三段结构重建：CHAPTER_CONTENT 必须按 [Scene1] / [Scene2] / [Scene3] 顺序输出。",
      "- Scene1/Scene2/Scene3 都是必写项，缺任一项都算失败。",
      `- 每个 Scene 必须 >= ${Math.round(params.structureCheck.minSceneShare * 100)}% 的 CHAPTER_CONTENT。`,
      "- Breath 章骨架：Act1=余波/ regroup，Act2=完整喘息场景，Act3=小步前推 + 低强度尾钩。",
      "- 重排要求：前 60% 必须先完成喘息/恢复/对话，再允许出现主要对抗推进。",
      "- 必须新增真正的 Section B 喘息段，不能只是点到为止的一句话。",
      '- Scene1 语义硬规则："Do NOT introduce new threats or escalate conflict."',
      '- Scene2 语义硬规则："Focus on interaction, not action."',
      '- Scene3 语义硬规则："Only here you may move plot forward."',
      "- 必须把至少一个高压段改写成：休整/疗伤、共同行动中的交谈、轻度温情/信任推进、资源整理/计划讨论之一。",
      "- 如果只是追加一小段喘息而主体仍是 combat-heavy，这次 rewrite 仍算失败。",
      "- 必须替换部分主导性的战斗推进，不能只在结尾补一小段。",
      params.hookEmergenceDirective?.hookExecutionPhase === "late"
        ? "- 指令优先级固定：mood directive > scene plan > payoff > hook推进。"
        : undefined,
      params.hookEmergenceDirective?.hookExecutionPhase === "late"
        ? "- Hook 推进只能发生在 [Scene3]，[Scene1]/[Scene2] 必须保持恢复/对话主导。"
        : undefined,
      params.hookEmergenceDirective?.hookExecutionPhase === "late"
        ? "- 若 [Scene1]/[Scene2] 提前触发 target hook 的推进/高潮，这次 rewrite 仍算失败。"
        : undefined,
      `- 若 breath coverage 仍低于 ${Math.round(params.moodDirective.moodCoverageMin * 100)}%，这次 rewrite 仍算失败。`,
      "- 只输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块。",
      params.titleCandidates.length > 0 ? `- 可优先参考这些标题：${params.titleCandidates.map((candidate) => candidate.title).join(" | ")}` : undefined,
      "",
      "=== ORIGINAL_PRE_WRITE_CHECK ===",
      params.preWriteCheck || "- ok",
      "",
      "=== ORIGINAL_TITLE（仅供参考）===",
      params.originalTitle,
      "",
      "=== FACT REFERENCE ONLY（仅供事实对齐，禁止按原段落修补）===",
      params.originalContent,
    ].filter(Boolean).join("\n");
  }

  private evaluateBreathSceneStructure(content: string, moodDirective: MoodDirective): {
    matched: boolean;
    missingScenes: ReadonlyArray<"Scene1" | "Scene2" | "Scene3">;
    sceneShares: Readonly<Record<"Scene1" | "Scene2" | "Scene3", number>>;
    minSceneShare: number;
  } {
    const minSceneShare = Math.max(0.2, moodDirective.sceneMinShare ?? 0.2);
    const normalized = content.replace(/\r\n/g, "\n");
    const markerRegex = /\[(Scene\s*1|Scene\s*2|Scene\s*3)\]/gi;
    const markers: Array<{ scene: "Scene1" | "Scene2" | "Scene3"; index: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = markerRegex.exec(normalized)) !== null) {
      const raw = match[1]?.replace(/\s+/g, "").toLowerCase();
      const scene = raw === "scene1"
        ? "Scene1"
        : raw === "scene2"
          ? "Scene2"
          : "Scene3";
      if (!markers.some((item) => item.scene === scene)) {
        markers.push({ scene, index: match.index });
      }
    }

    const required: ReadonlyArray<"Scene1" | "Scene2" | "Scene3"> = ["Scene1", "Scene2", "Scene3"];
    const byScene = new Map(markers.map((item) => [item.scene, item.index] as const));
    const missingScenes = required.filter((scene) => !byScene.has(scene));

    const ordered = required.map((scene) => byScene.get(scene) ?? Number.POSITIVE_INFINITY);
    const orderValid = ordered[0] < ordered[1] && ordered[1] < ordered[2];

    const totalChars = normalized.replace(/\s+/g, "").length || 1;
    const segments: Record<"Scene1" | "Scene2" | "Scene3", string> = {
      Scene1: "",
      Scene2: "",
      Scene3: "",
    };
    if (missingScenes.length === 0 && orderValid) {
      const starts = required.map((scene) => byScene.get(scene)!);
      for (let idx = 0; idx < required.length; idx += 1) {
        const scene = required[idx]!;
        const start = starts[idx]!;
        const end = idx + 1 < starts.length ? starts[idx + 1]! : normalized.length;
        segments[scene] = normalized.slice(start, end);
      }
    }

    const sceneShares: Record<"Scene1" | "Scene2" | "Scene3", number> = {
      Scene1: segments.Scene1.replace(/\s+/g, "").length / totalChars,
      Scene2: segments.Scene2.replace(/\s+/g, "").length / totalChars,
      Scene3: segments.Scene3.replace(/\s+/g, "").length / totalChars,
    };
    const shareValid = required.every((scene) => sceneShares[scene] >= minSceneShare);
    const matched = missingScenes.length === 0 && orderValid && shareValid;

    return {
      matched,
      missingScenes,
      sceneShares,
      minSceneShare,
    };
  }

  private evaluateHookExecutionPhaseInBreathScenes(
    content: string,
    directive:
      | {
        readonly mustMaterializeHookNow: boolean;
        readonly hookExecutionPhase?: "any" | "late";
        readonly targetHookId?: string;
        readonly targetHookState?: string;
        readonly targetHookExpectedPayoff?: string;
        readonly targetHookNotes?: string;
      }
      | undefined,
  ): {
    matched: boolean;
    violatedScenes: ReadonlyArray<"Scene1" | "Scene2">;
    evidence?: string;
  } {
    if (!directive?.mustMaterializeHookNow || directive.hookExecutionPhase !== "late") {
      return { matched: true, violatedScenes: [] };
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const sceneText = this.extractSceneTextMap(normalized);
    const signalKeywords = this.extractHookExecutionKeywords(directive);
    if (signalKeywords.length === 0) {
      return { matched: true, violatedScenes: [] };
    }

    const violatedScenes: Array<"Scene1" | "Scene2"> = [];
    const evidenceChunks: string[] = [];
    (["Scene1", "Scene2"] as const).forEach((scene) => {
      const text = (sceneText[scene] ?? "").toLowerCase();
      if (!text) {
        return;
      }
      const matchedKeyword = signalKeywords.find((keyword) => keyword.length > 1 && text.includes(keyword));
      if (matchedKeyword) {
        violatedScenes.push(scene);
        evidenceChunks.push(`${scene}:${matchedKeyword}`);
      }
    });

    return {
      matched: violatedScenes.length === 0,
      violatedScenes,
      ...(evidenceChunks.length > 0 ? { evidence: evidenceChunks.join(", ") } : {}),
    };
  }

  private extractSceneTextMap(content: string): Record<"Scene1" | "Scene2" | "Scene3", string> {
    const markers = [
      { scene: "Scene1" as const, regex: /\[(Scene\s*1)\]/i },
      { scene: "Scene2" as const, regex: /\[(Scene\s*2)\]/i },
      { scene: "Scene3" as const, regex: /\[(Scene\s*3)\]/i },
    ];
    const indexes = markers
      .map(({ scene, regex }) => ({ scene, index: content.search(regex) }))
      .filter((entry) => entry.index >= 0)
      .sort((left, right) => left.index - right.index);

    const segments: Record<"Scene1" | "Scene2" | "Scene3", string> = {
      Scene1: "",
      Scene2: "",
      Scene3: "",
    };
    for (let idx = 0; idx < indexes.length; idx += 1) {
      const current = indexes[idx]!;
      const nextStart = idx + 1 < indexes.length ? indexes[idx + 1]!.index : content.length;
      segments[current.scene] = content.slice(current.index, nextStart);
    }
    return segments;
  }

  private extractHookExecutionKeywords(directive: {
    readonly targetHookId?: string;
    readonly targetHookExpectedPayoff?: string;
    readonly targetHookNotes?: string;
  }): string[] {
    const keywords = new Set<string>();
    const addTokens = (value: string | undefined) => {
      if (!value) return;
      const lower = value.toLowerCase();
      if (lower.trim()) {
        keywords.add(lower.trim());
      }
      for (const token of lower.match(/[a-z0-9_-]{3,}/g) ?? []) {
        keywords.add(token);
      }
      for (const token of lower.match(/[\u4e00-\u9fff]{2,8}/g) ?? []) {
        keywords.add(token);
      }
    };

    addTokens(directive.targetHookId);
    addTokens(directive.targetHookExpectedPayoff);
    addTokens(directive.targetHookNotes);

    return [...keywords];
  }

  private async rewriteForHookEmergenceIfNeeded(params: {
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    };
    chapterIntent?: string;
    hookEmergenceDirective?:
      | {
        readonly mustMaterializeHookNow: boolean;
        readonly targetHookId?: string;
        readonly targetHookState?: string;
        readonly targetHookExpectedPayoff?: string;
        readonly targetHookNotes?: string;
      }
      | undefined;
    language: "zh" | "en";
    chapterNumber: number;
    maxTokens: number;
    titleCandidates: ReadonlyArray<{ title: string }>;
    countingMode: LengthSpec["countingMode"];
    onUsage: (usage: TokenUsage) => void;
  }): Promise<{
    title: string;
    content: string;
    wordCount: number;
    preWriteCheck: string;
  }> {
    if (!params.hookEmergenceDirective?.mustMaterializeHookNow) {
      return params.creative;
    }

    let currentCreative = params.creative;
    let check = evaluateHookEmergenceCompliance(currentCreative.content, params.chapterIntent);
    if (!check || check.matched) {
      return currentCreative;
    }

    for (let attempt = 1; attempt <= 2 && check && !check.matched; attempt += 1) {
      this.logWarn(params.language, {
        zh: `Writer HOOK EMERGENCE MODE：第${params.chapterNumber}章 rewrite attempt ${attempt}，${check.targetHookId ?? "target hook"} 仍未产生新状态变化`,
        en: `Writer HOOK EMERGENCE MODE: chapter ${params.chapterNumber} rewrite attempt ${attempt}, ${check.targetHookId ?? "target hook"} still has no new state change`,
      });

      const response = await this.chat(
        [
          {
            role: "system",
            content: this.buildHookEmergenceRewriteSystemPrompt(params.language, params.hookEmergenceDirective),
          },
          {
            role: "user",
            content: this.buildHookEmergenceRewritePrompt({
              language: params.language,
              chapterNumber: params.chapterNumber,
              originalTitle: currentCreative.title,
              originalContent: currentCreative.content,
              preWriteCheck: currentCreative.preWriteCheck,
              titleCandidates: params.titleCandidates,
              hookEmergenceDirective: params.hookEmergenceDirective,
            }),
          },
        ],
        { maxTokens: params.maxTokens, temperature: 0.5 },
      );
      params.onUsage(response.usage);
      currentCreative = parseCreativeOutput(params.chapterNumber, response.content, params.countingMode);
      check = evaluateHookEmergenceCompliance(currentCreative.content, params.chapterIntent);
    }

    return currentCreative;
  }

  private buildHookEmergenceRewriteSystemPrompt(
    language: "zh" | "en",
    directive: NonNullable<ReturnType<WriterAgent["extractHookEmergenceDirectiveFromIntentMarkdown"]>>,
  ): string {
    if (language === "en") {
      return [
        "HOOK EMERGENCE MODE",
        `Target hook: ${directive.targetHookId ?? "unknown"}`,
        "This overdue hook cannot remain suspended.",
        "The rewrite must advance it, partially resolve it, or fully resolve it now.",
        "Mentioning the hook again or repeating old danger does not count.",
        "Keep chapter facts and continuity intact.",
      ].join("\n");
    }

    return [
      "HOOK EMERGENCE MODE",
      `Target hook: ${directive.targetHookId ?? "unknown"}`,
      "这个 overdue hook 不能继续悬置。",
      "这次重写必须让它发生推进、部分兑现或完全回收之一。",
      "仅仅再次提到 hook 或重复旧危险，不算推进。",
      "保留章节事实与连续性。",
    ].join("\n");
  }

  private buildHookEmergenceRewritePrompt(params: {
    language: "zh" | "en";
    chapterNumber: number;
    originalTitle: string;
    originalContent: string;
    preWriteCheck: string;
    titleCandidates: ReadonlyArray<{ title: string }>;
    hookEmergenceDirective: NonNullable<ReturnType<WriterAgent["extractHookEmergenceDirectiveFromIntentMarkdown"]>>;
  }): string {
    if (params.language === "en") {
      return [
        `Chapter ${params.chapterNumber} failed overdue hook emergence.`,
        `- targetHookId: ${params.hookEmergenceDirective.targetHookId ?? "unknown"}`,
        `- targetHookExpectedPayoff: ${params.hookEmergenceDirective.targetHookExpectedPayoff ?? "none"}`,
        "- You must create a genuine new state change for this hook.",
        "- Valid outcomes: advance / partial resolve / resolve.",
        "- Invalid outcome: merely repeating the old threat.",
        "- Output PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT only.",
        params.titleCandidates.length > 0 ? `- Prefer one of these titles if useful: ${params.titleCandidates.map((candidate) => candidate.title).join(" | ")}` : undefined,
        "",
        "=== ORIGINAL_PRE_WRITE_CHECK ===",
        params.preWriteCheck || "- ok",
        "",
        "=== ORIGINAL_TITLE ===",
        params.originalTitle,
        "",
        "=== ORIGINAL_CONTENT ===",
        params.originalContent,
      ].filter(Boolean).join("\n");
    }

    return [
      `第${params.chapterNumber}章没有真正推进 overdue hook。`,
      `- targetHookId: ${params.hookEmergenceDirective.targetHookId ?? "unknown"}`,
      `- targetHookExpectedPayoff: ${params.hookEmergenceDirective.targetHookExpectedPayoff ?? "none"}`,
      "- 必须让这个 hook 产生真实的新状态变化。",
      "- 合格结果：推进 / 部分兑现 / 完全回收。",
      "- 不合格结果：只是再次提到它、重复旧信息、或只说危险仍在。",
      "- 只输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块。",
      params.titleCandidates.length > 0 ? `- 可优先参考这些标题：${params.titleCandidates.map((candidate) => candidate.title).join(" | ")}` : undefined,
      "",
      "=== ORIGINAL_PRE_WRITE_CHECK ===",
      params.preWriteCheck || "- ok",
      "",
      "=== ORIGINAL_TITLE ===",
      params.originalTitle,
      "",
      "=== ORIGINAL_CONTENT ===",
      params.originalContent,
    ].filter(Boolean).join("\n");
  }

  private extractMarkdownSection(content: string, heading: string): string | undefined {
    const lines = content.split("\n");
    let buffer: string[] | null = null;

    for (const line of lines) {
      if (line.trim() === heading) {
        buffer = [];
        continue;
      }

      if (buffer && line.startsWith("## ") && line.trim() !== heading) {
        break;
      }

      if (buffer) {
        buffer.push(line);
      }
    }

    const section = buffer?.join("\n").trim();
    return section && section.length > 0 ? section : undefined;
  }

  private extractRecentTitles(recentChapters: string, language: "zh" | "en"): string[] {
    if (!recentChapters) {
      return [];
    }

    const pattern = language === "en"
      ? /^#\s*Chapter\s+\d+(?::|\s+)(.+)$/gim
      : /^#\s*第\d+章\s+(.+)$/gmu;
    return [...recentChapters.matchAll(pattern)]
      .map((match) => match[1]?.trim() ?? "")
      .filter(Boolean)
      .slice(-3);
  }

  private buildTitleKeyEvents(params: {
    readonly chapterGoal?: ChapterGoal;
    readonly contextPackage?: ContextPackage;
    readonly currentState: string;
    readonly relevantSummaries?: string;
    readonly externalContext?: string;
  }): string[] {
    const contextExcerpts = params.contextPackage?.selectedContext
      .map((entry) => entry.excerpt?.trim() ?? "")
      .filter(Boolean)
      .slice(0, 4) ?? [];
    const goalEvents = params.chapterGoal
      ? [
          params.chapterGoal.mainConflict,
          params.chapterGoal.protagonistGoal,
          params.chapterGoal.payoffToDeliver,
          params.chapterGoal.nextChapterPull,
        ]
      : [];

    return [
      ...goalEvents,
      ...contextExcerpts,
      params.relevantSummaries ?? "",
      params.currentState,
      params.externalContext ?? "",
    ]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  private buildSettlerGovernedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: "zh" | "en",
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    if (language === "en") {
      return `\n## Chapter Control Inputs
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`;
    }

    return `\n## 本章控制输入
${chapterIntent}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
  }

  private buildLengthRequirementBlock(lengthSpec: LengthSpec, language: "zh" | "en"): string {
    if (language === "en") {
      return `Requirements:
- Target length: ${lengthSpec.target} words
- Acceptable range: ${lengthSpec.softMin}-${lengthSpec.softMax} words`;
    }

    return `要求：
- 目标字数：${lengthSpec.target}字
- 允许区间：${lengthSpec.softMin}-${lengthSpec.softMax}字`;
  }

  private async loadRecentChapters(
    bookDir: string,
    currentChapter: number,
    count = 1,
  ): Promise<string> {
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const mdFiles = files
        .filter((f) => f.endsWith(".md") && !f.startsWith("index"))
        .sort()
        .slice(-count);

      if (mdFiles.length === 0) return "";

      const contents = await Promise.all(
        mdFiles.map(async (f) => {
          const content = await readFile(join(chaptersDir, f), "utf-8");
          return content;
        }),
      );

      return contents.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }

  /** Save new truth files (summaries, subplots, emotional arcs, character matrix). */
  async saveNewTruthFiles(
    bookDir: string,
    output: WriteChapterOutput,
    language: "zh" | "en" = "zh",
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    const writes: Array<Promise<void>> = [];

    // Append chapter summary to chapter_summaries.md
    if (!output.runtimeStateDelta && output.updatedChapterSummaries) {
      writes.push(writeFile(
        join(storyDir, "chapter_summaries.md"),
        output.updatedChapterSummaries,
        "utf-8",
      ));
    } else if (!output.runtimeStateDelta && output.chapterSummary) {
      writes.push(this.appendChapterSummary(storyDir, output.chapterSummary, language));
    }

    // Overwrite subplot board
    if (output.updatedSubplots) {
      writes.push(writeFile(join(storyDir, "subplot_board.md"), output.updatedSubplots, "utf-8"));
    }

    // Overwrite emotional arcs
    if (output.updatedEmotionalArcs) {
      writes.push(writeFile(join(storyDir, "emotional_arcs.md"), output.updatedEmotionalArcs, "utf-8"));
    }

    // Overwrite character matrix
    if (output.updatedCharacterMatrix) {
      writes.push(writeFile(join(storyDir, "character_matrix.md"), output.updatedCharacterMatrix, "utf-8"));
    }

    await Promise.all(writes);
  }

  private buildForeshadowRegistry(hooksMarkdown: string): ReadonlyArray<{
    readonly hookId: string;
    readonly startChapter: number;
    readonly type: string;
    readonly status: string;
    readonly lastAdvancedChapter: number;
    readonly expectedPayoff: string;
    readonly payoffTiming?: string;
    readonly notes: string;
  }> {
    return parsePendingHooksMarkdown(hooksMarkdown).map((hook) => ({
      hookId: hook.hookId,
      startChapter: hook.startChapter,
      type: hook.type,
      status: hook.status,
      lastAdvancedChapter: hook.lastAdvancedChapter,
      expectedPayoff: hook.expectedPayoff,
      ...(hook.payoffTiming ? { payoffTiming: hook.payoffTiming } : {}),
      notes: hook.notes,
    }));
  }

  private renderDeltaSummaryRow(delta: RuntimeStateDelta): string {
    if (!delta.chapterSummary) return "";
    const summary = delta.chapterSummary;
    const row = [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map((value) => String(value).replace(/\|/g, "\\|").trim()).join(" | ");

    return `| ${row} |`;
  }

  private normalizeRuntimeStateDeltaChapter(
    delta: RuntimeStateDelta,
    authoritativeChapterNumber: number,
  ): RuntimeStateDelta {
    const hookOps = delta.hookOps ?? {
      upsert: [],
      mention: [],
      resolve: [],
      defer: [],
    };
    let changed = delta.chapter !== authoritativeChapterNumber;
    const normalizedUpserts = hookOps.upsert.map((hook) => {
      const startChapter = Math.min(hook.startChapter, authoritativeChapterNumber);
      const lastAdvancedChapter = Math.min(hook.lastAdvancedChapter, authoritativeChapterNumber);
      if (startChapter !== hook.startChapter || lastAdvancedChapter !== hook.lastAdvancedChapter) {
        changed = true;
      }
      if (startChapter === hook.startChapter && lastAdvancedChapter === hook.lastAdvancedChapter) {
        return hook;
      }
      return {
        ...hook,
        startChapter,
        lastAdvancedChapter,
      };
    });

    if (delta.chapterSummary?.chapter !== undefined && delta.chapterSummary.chapter !== authoritativeChapterNumber) {
      changed = true;
    }
    if (!changed) {
      return delta;
    }

    return {
      ...delta,
      chapter: authoritativeChapterNumber,
      hookOps: {
        ...hookOps,
        upsert: normalizedUpserts,
      },
      chapterSummary: delta.chapterSummary
        ? {
            ...delta.chapterSummary,
            chapter: authoritativeChapterNumber,
          }
        : undefined,
    };
  }

  private async buildRuntimeStateArtifactsIfPresent(
    bookDir: string,
    delta: RuntimeStateDelta | undefined,
    language: "zh" | "en",
    authoritativeChapterNumber?: number,
    allowReapply?: boolean,
  ): Promise<RuntimeStateArtifacts | null> {
    if (!delta) return null;
    const safeDelta = authoritativeChapterNumber === undefined
      ? delta
      : this.normalizeRuntimeStateDeltaChapter(delta, authoritativeChapterNumber);
    return buildRuntimeStateArtifacts({
      bookDir,
      delta: safeDelta,
      language,
      allowReapply,
    });
  }

  private async resolveRuntimeStateArtifactsForOutput(
    bookDir: string,
    output: WriteChapterOutput,
    language: "zh" | "en",
  ): Promise<RuntimeStateArtifacts | null> {
    if (!output.runtimeStateDelta) return null;
    const safeDelta = this.normalizeRuntimeStateDeltaChapter(
      output.runtimeStateDelta,
      output.chapterNumber,
    );
    if (
      safeDelta === output.runtimeStateDelta
      && output.runtimeStateSnapshot
      && output.updatedChapterSummaries
      && output.updatedState
      && output.updatedHooks
    ) {
      return {
        snapshot: output.runtimeStateSnapshot,
        resolvedDelta: safeDelta,
        currentStateMarkdown: output.updatedState,
        hooksMarkdown: output.updatedHooks,
        chapterSummariesMarkdown: output.updatedChapterSummaries,
      };
    }

    return buildRuntimeStateArtifacts({
      bookDir,
      delta: safeDelta,
      language,
    });
  }

  private async appendChapterSummary(
    storyDir: string,
    summary: string,
    language: "zh" | "en",
  ): Promise<void> {
    const summaryPath = join(storyDir, "chapter_summaries.md");
    let existing = "";
    try {
      existing = await readFile(summaryPath, "utf-8");
    } catch {
      // File doesn't exist yet — start with header
      existing = language === "en"
        ? "# Chapter Summaries\n\n| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n"
        : "# 章节摘要\n\n| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |\n|------|------|----------|----------|----------|----------|----------|----------|\n";
    }

    // Extract only the data row(s) from the summary (skip header lines)
    const dataRows = summary
      .split("\n")
      .filter((line) =>
        line.startsWith("|")
        && !line.startsWith("| 章节")
        && !line.startsWith("| Chapter")
        && !line.startsWith("|--")
        && !line.startsWith("| ---"),
      )
      .join("\n");

    if (dataRows) {
      // Deduplicate: remove existing rows with the same chapter number before appending
      const newChapterNums = new Set(
        dataRows.split("\n")
          .map((line) => line.split("|")[1]?.trim())
          .filter((ch) => ch && /^\d+$/.test(ch)),
      );
      const deduped = existing
        .split("\n")
        .filter((line) => {
          if (!line.startsWith("|")) return true;
          const chNum = line.split("|")[1]?.trim();
          return !chNum || !newChapterNums.has(chNum);
        })
        .join("\n");
      await writeFile(summaryPath, `${deduped.trimEnd()}\n${dataRows}\n`, "utf-8");
    }
  }

  private buildStyleFingerprint(styleProfileRaw: string): string | undefined {
    if (!styleProfileRaw || styleProfileRaw === "(文件尚未创建)") return undefined;
    try {
      const profile = JSON.parse(styleProfileRaw);
      const lines: string[] = [];
      if (profile.avgSentenceLength) lines.push(`- 平均句长：${profile.avgSentenceLength}字`);
      if (profile.sentenceLengthStdDev) lines.push(`- 句长标准差：${profile.sentenceLengthStdDev}`);
      if (profile.avgParagraphLength) lines.push(`- 平均段落长度：${profile.avgParagraphLength}字`);
      if (profile.paragraphLengthRange) lines.push(`- 段落长度范围：${profile.paragraphLengthRange.min}-${profile.paragraphLengthRange.max}字`);
      if (profile.vocabularyDiversity) lines.push(`- 词汇多样性(TTR)：${profile.vocabularyDiversity}`);
      if (profile.topPatterns?.length > 0) lines.push(`- 高频句式：${profile.topPatterns.join("、")}`);
      if (profile.rhetoricalFeatures?.length > 0) lines.push(`- 修辞特征：${profile.rhetoricalFeatures.join("、")}`);
      return lines.length > 0 ? lines.join("\n") : undefined;
    } catch {
      return undefined;
    }
  }


  /**
   * Extract dialogue fingerprints from recent chapters.
   * For each character with multiple dialogue lines, compute speaking style markers.
   */
  private extractDialogueFingerprints(recentChapters: string, _storyBible: string): string {
    if (!recentChapters) return "";

    // Match dialogue patterns:
    // Chinese: "speaker说道：" or dialogue in ""「」
    // English: "dialogue," speaker said. or "dialogue."
    const dialogueRegex = /(?:(.{1,6})(?:说道|道|喝道|冷声道|笑道|怒道|低声道|大声道|喝骂道|冷笑道|沉声道|喊道|叫道|问道|答道)\s*[：:]\s*["""「]([^"""」]+)["""」])|["""「]([^"""」]{2,})["""」]|"([^"]{2,})"/g;

    const characterDialogues = new Map<string, string[]>();
    let match: RegExpExecArray | null;

    while ((match = dialogueRegex.exec(recentChapters)) !== null) {
      const speaker = match[1]?.trim();
      const line = match[2] ?? match[3] ?? "";
      if (speaker && line.length > 1) {
        const existing = characterDialogues.get(speaker) ?? [];
        characterDialogues.set(speaker, [...existing, line]);
      }
    }

    // Only include characters with >=2 dialogue lines
    const fingerprints: string[] = [];
    for (const [character, lines] of characterDialogues) {
      if (lines.length < 2) continue;

      const avgLen = Math.round(lines.reduce((sum, l) => sum + l.length, 0) / lines.length);
      const isShort = avgLen < 15;

      // Find frequent words/phrases (2+ occurrences)
      const wordCounts = new Map<string, number>();
      for (const line of lines) {
        // Extract 2-3 char segments as "words"
        for (let i = 0; i < line.length - 1; i++) {
          const bigram = line.slice(i, i + 2);
          wordCounts.set(bigram, (wordCounts.get(bigram) ?? 0) + 1);
        }
      }
      const frequentWords = [...wordCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w]) => `「${w}」`);

      // Detect style markers
      const markers: string[] = [];
      if (isShort) markers.push("短句为主");
      else markers.push("长句为主");

      const questionCount = lines.filter((l) => l.includes("？") || l.includes("?")).length;
      if (questionCount > lines.length * 0.3) markers.push("反问多");

      if (frequentWords.length > 0) markers.push(`常用${frequentWords.join("")}`);

      fingerprints.push(`${character}：${markers.join("，")}`);
    }

    return fingerprints.length > 0 ? fingerprints.join("；") : "";
  }

  /**
   * Find relevant chapter summaries based on volume outline context.
   * Extracts character names and hook IDs from the current volume's outline,
   * then searches chapter summaries for matching entries.
   */
  private findRelevantSummaries(
    chapterSummaries: string,
    volumeOutline: string,
    chapterNumber: number,
  ): string {
    if (!chapterSummaries || chapterSummaries === "(文件尚未创建)") return "";
    if (!volumeOutline || volumeOutline === "(文件尚未创建)") return "";

    // Extract character names from volume outline (Chinese name patterns)
    const nameRegex = /[\u4e00-\u9fff]{2,4}(?=[，、。：]|$)/g;
    const outlineNames = new Set<string>();
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = nameRegex.exec(volumeOutline)) !== null) {
      outlineNames.add(nameMatch[0]);
    }

    // Extract hook IDs from volume outline
    const hookRegex = /H\d{2,}/g;
    const hookIds = new Set<string>();
    let hookMatch: RegExpExecArray | null;
    while ((hookMatch = hookRegex.exec(volumeOutline)) !== null) {
      hookIds.add(hookMatch[0]);
    }

    if (outlineNames.size === 0 && hookIds.size === 0) return "";

    // Search chapter summaries for matching rows
    const rows = chapterSummaries.split("\n").filter((line) =>
      line.startsWith("|") && !line.startsWith("| 章节") && !line.startsWith("|--") && !line.startsWith("| -"),
    );

    const matchedRows = rows.filter((row) => {
      for (const name of outlineNames) {
        if (row.includes(name)) return true;
      }
      for (const hookId of hookIds) {
        if (row.includes(hookId)) return true;
      }
      return false;
    });

    // Skip only the last chapter (its full text is already in context via loadRecentChapters)
    const filteredRows = matchedRows.filter((row) => {
      const chNumMatch = row.match(/\|\s*(\d+)\s*\|/);
      if (!chNumMatch) return true;
      const num = parseInt(chNumMatch[1]!, 10);
      return num < chapterNumber - 1;
    });

    return filteredRows.length > 0 ? filteredRows.join("\n") : "";
  }

  private sanitizeFilename(title: string): string {
    return title
      .replace(/[/\\?%*:|"<>]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
  }
}
