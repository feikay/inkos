import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { buildWriterSystemPrompt, type FanficContext } from "./writer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import { parseSettlerDeltaOutput } from "./settler-delta-parser.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import {
  detectCrossChapterRepetition,
  detectParagraphLengthDrift,
  evaluateCadenceDirectiveCompliance,
  evaluateChapterGoalDiscipline,
  evaluateEndingIsomorphism,
  evaluateHookEmergenceCompliance,
  evaluateHookDebtThrottle,
  evaluateMoodCadenceCompliance,
  evaluateResourceLedgerDiscipline,
  toCadenceDirectiveWarnings,
  toDisciplineWarnings,
  toEndingIsomorphismWarnings,
  toHookEmergenceWarnings,
  toHookDebtWarnings,
  toMoodCadenceWarnings,
  toResourceLedgerWarnings,
  validatePostWrite,
  type EndingHookCheck,
  type HookDebtCheck,
  type MoodCadenceCheck,
  type PayoffCheck,
  type PostWriteViolation,
  type ResourceLedgerCheck,
} from "./post-write-validator.js";
import { analyzeAITells } from "./ai-tells.js";
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
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import { parsePendingHooksMarkdown } from "../utils/memory-retrieval.js";
import { analyzeHookHealth } from "../utils/hook-health.js";
import { buildEnglishVarianceBrief } from "../utils/long-span-fatigue.js";
import { buildChapterTitleCandidates, resolveChapterTitle } from "../utils/chapter-title-engine.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface WriteChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
  readonly chapterIntent?: string;
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
  readonly postWriteErrors: ReadonlyArray<PostWriteViolation>;
  readonly postWriteWarnings: ReadonlyArray<PostWriteViolation>;
  readonly endingHookCheck?: EndingHookCheck;
  readonly payoffCheck?: PayoffCheck;
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

    // ── Phase 1: Creative writing (temperature 0.7) ──
    const creativeSystemPrompt = buildWriterSystemPrompt(
      book, genreProfile, bookRules, bookRulesBody, genreBody, styleGuide, styleFingerprint,
      chapterNumber, "creative", fanficContext, resolvedLanguage,
      input.chapterIntent ? "governed" : "legacy",
      resolvedLengthSpec,
    );

    const creativeUserPrompt = input.chapterIntent && input.contextPackage && input.ruleStack
      ? this.buildGovernedUserPrompt({
          chapterNumber,
          chapterIntent: input.chapterIntent,
          contextPackage: input.contextPackage,
          ruleStack: input.ruleStack,
          trace: input.trace,
          lengthSpec: resolvedLengthSpec,
          language: book.language ?? genreProfile.language,
          varianceBrief: englishVarianceBrief?.text,
          selectedEvidenceBlock: this.joinGovernedEvidenceBlocks(governedMemoryBlocks),
          titleCandidates,
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
            hookEmergenceDirective,
          });
        })();

    const creativeTemperature = input.temperatureOverride ?? 0.7;

    this.logInfo(resolvedLanguage, {
      zh: `阶段 1：创作正文（第${chapterNumber}章）`,
      en: `Phase 1: creative writing for chapter ${chapterNumber}`,
    });

    // Scale maxTokens to chapter word count (Chinese ≈ 1.5 tokens/char)
    const creativeMaxTokens = Math.max(8192, Math.ceil(targetWords * 2));

    const creativeResponse = await this.chat(
      [
        { role: "system", content: creativeSystemPrompt },
        { role: "user", content: creativeUserPrompt },
      ],
      { maxTokens: creativeMaxTokens, temperature: creativeTemperature },
    );
    let creativeUsage = creativeResponse.usage;

    let creative = parseCreativeOutput(chapterNumber, creativeResponse.content, resolvedLengthSpec.countingMode);
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
    creative = await this.rewriteForPayoffDirectiveIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
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
    creative = await this.rewriteForMoodDirectiveIfNeeded({
      creative,
      chapterIntent: input.chapterIntent,
      moodDirective,
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
      ...validatePostWrite(creative.content, genreProfile, bookRules, resolvedLanguage),
      ...detectCrossChapterRepetition(creative.content, fingerprintChapters, resolvedLanguage),
      ...detectParagraphLengthDrift(creative.content, fingerprintChapters, resolvedLanguage),
    ];
    const disciplineChecks = chapterGoal
      ? evaluateChapterGoalDiscipline(creative.content, chapterGoal)
      : undefined;
    const disciplineWarnings = disciplineChecks
      ? toDisciplineWarnings(disciplineChecks, resolvedLanguage)
      : [];
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
    const allWarnings = [
      ...ruleViolations,
      ...disciplineWarnings,
      ...cadenceDirectiveWarnings,
      ...moodCadenceWarnings,
      ...endingIsomorphismWarnings,
      ...hookEmergenceWarnings,
      ...resourceLedgerWarnings,
      ...hookDebtWarnings,
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
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: resolvedRuntimeStateDelta
        ? this.renderDeltaSummaryRow(resolvedRuntimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors,
      postWriteWarnings,
      endingHookCheck: disciplineChecks?.endingHookCheck,
      payoffCheck: disciplineChecks?.payoffCheck,
      moodCadenceCheck,
      resourceLedgerCheck,
      hookDebtCheck,
      hookHealthIssues,
      tokenUsage,
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
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: settlement.runtimeStateDelta
        ? this.renderDeltaSummaryRow(settlement.runtimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors: [],
      postWriteWarnings: [],
      endingHookCheck: undefined,
      payoffCheck: undefined,
      resourceLedgerCheck: undefined,
      hookDebtCheck: undefined,
      tokenUsage: settleResult.usage,
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
    const payoffDirectiveMandatory = entries.get("payoffDirective.mandatoryByFinalAct");
    const endingHookType = entries.get("endingHookType");
    const nextChapterPull = entries.get("nextChapterPull");
    if (!mainConflict || !protagonistGoal || !payoffToDeliver || !endingHookType || !nextChapterPull) {
      return undefined;
    }

    if (!["danger", "reveal", "pursuit", "choice", "breakthrough"].includes(endingHookType)) {
      return undefined;
    }

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
            mandatoryByFinalAct: payoffDirectiveMandatory !== "false",
          },
        }
        : {}),
      endingHookType: endingHookType as ChapterGoal["endingHookType"],
      nextChapterPull,
    };
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

  private extractHookEmergenceDirectiveFromIntentMarkdown(chapterIntent: string | undefined): {
    readonly mustMaterializeHookNow: boolean;
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
    readonly hookEmergenceDirective?: {
      readonly mustMaterializeHookNow: boolean;
      readonly targetHookId?: string;
      readonly targetHookState?: string;
      readonly targetHookExpectedPayoff?: string;
      readonly targetHookNotes?: string;
    };
  }): string {
    const contextBlock = params.externalContext
      ? `\n## 外部指令\n以下是来自外部系统的创作指令，请在本章中融入：\n\n${params.externalContext}\n`
      : "";

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
    const moodDirectiveBlock = this.buildMoodDirectiveBlock(params.moodDirective, params.language ?? "zh");
    const payoffDirectiveBlock = this.buildPayoffDirectiveBlock(params.chapterGoal, params.language ?? "zh");
    const hookEmergenceDirectiveBlock = this.buildHookEmergenceDirectiveBlock({
      directive: params.hookEmergenceDirective,
      language: params.language ?? "zh",
    });
    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.
${contextBlock}
## Current State
${params.currentState}
${ledgerBlock}
## Plot Threads
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
${titleBlock}
${moodDirectiveBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
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
${contextBlock}
## 当前状态卡
${params.currentState}
${ledgerBlock}
## 伏笔池
${params.hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
${titleBlock}
${moodDirectiveBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
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

  private buildGovernedUserPrompt(params: {
    readonly chapterNumber: number;
    readonly chapterIntent: string;
    readonly contextPackage: ContextPackage;
    readonly ruleStack: RuleStack;
    readonly trace?: ChapterTrace;
    readonly lengthSpec: LengthSpec;
    readonly language?: "zh" | "en";
    readonly varianceBrief?: string;
    readonly selectedEvidenceBlock?: string;
    readonly titleCandidates?: ReadonlyArray<{ readonly style: string; readonly title: string }>;
  }): string {
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
    const moodDirective = this.extractMoodDirectiveFromIntentMarkdown(params.chapterIntent);
    const moodDirectiveBlock = this.buildMoodDirectiveBlock(moodDirective, params.language ?? "zh");
    const payoffDirectiveBlock = this.buildPayoffDirectiveBlock(params.contextPackage.chapterGoal, params.language ?? "zh");
    const hookEmergenceDirectiveBlock = this.buildHookEmergenceDirectiveBlock({
      directive: this.extractHookEmergenceDirectiveFromIntentMarkdown(params.chapterIntent),
      language: params.language ?? "zh",
    });
    const titleBlock = this.buildTitleCandidatesBlock(params.titleCandidates, params.language ?? "zh");
    const explicitHookAgenda = this.extractMarkdownSection(params.chapterIntent, "## Hook Agenda");
    const hookAgendaBlock = explicitHookAgenda
      ? params.language === "en"
        ? `\n## Explicit Hook Agenda\n${explicitHookAgenda}\n`
        : `\n## 显式 Hook Agenda\n${explicitHookAgenda}\n`
      : "";

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.

## Chapter Intent
${params.chapterIntent}

## Selected Context
${contextSections || "(none)"}
${selectedEvidenceBlock}
${hookAgendaBlock}
${moodDirectiveBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
${titleBlock}

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

## 本章意图
${params.chapterIntent}

## 已选上下文
${contextSections || "(无)"}
${selectedEvidenceBlock}
${hookAgendaBlock}
${moodDirectiveBlock}
${payoffDirectiveBlock}
${hookEmergenceDirectiveBlock}
${titleBlock}

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
    const quotaRaw = section.match(/requiredSceneQuota:\s*(\d+)/i)?.[1];
    const coverageRaw = section.match(/moodCoverageMin:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i)?.[1];
    const forbidDominantMode = section.match(/forbidDominantMode:\s*([a-z-]+)/i)?.[1];
    const note = section.match(/note:\s*(.+)/i)?.[1]?.trim();

    if (!targetMode || !quotaRaw || !forbidDominantMode) {
      return undefined;
    }

    return {
      targetMode: targetMode as MoodDirective["targetMode"],
      requiredSceneQuota: Number.parseInt(quotaRaw, 10),
      moodCoverageMin: coverageRaw ? Number.parseFloat(coverageRaw) : 0.3,
      forbidDominantMode: forbidDominantMode as MoodDirective["forbidDominantMode"],
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
      return [
        "",
        "## Mood Cadence Directive",
        `- targetMode: ${moodDirective.targetMode}`,
        `- requiredSceneQuota: at least ${moodDirective.requiredSceneQuota} scene`,
        `- moodCoverageMin: at least ${Math.round(moodDirective.moodCoverageMin * 100)}% of the final chapter`,
        `- forbidDominantMode: ${moodDirective.forbidDominantMode}`,
        "- PRIMARY STRUCTURAL REQUIREMENT: this is not a soft note. The chapter must be structured as Act 1 / Act 2 / Act 3, and at least one act must function as a breath scene.",
        "- Section B must be a real breathing scene with healing, camp rest, eating, travel talk, trust-building, teasing, or lighter character interaction.",
        "- Breath chapter skeleton: Act 1 = aftershock / regroup, Act 2 = full breath scene, Act 3 = small forward motion with a low-intensity hook.",
        "- Replace part of the dominant combat structure if needed. Do not simply append one calming paragraph at the end.",
        `- If breath coverage stays below ${Math.round(moodDirective.moodCoverageMin * 100)}%, the chapter is considered failed and must be rewritten before output.`,
        "- Do not let combat-heavy confrontation dominate the chapter.",
        moodDirective.note ? `- note: ${moodDirective.note}` : undefined,
        "",
      ].filter(Boolean).join("\n");
    }

    return [
      "",
      "## 情绪节奏指令",
      `- targetMode: ${moodDirective.targetMode}`,
      `- requiredSceneQuota: 至少 ${moodDirective.requiredSceneQuota} 段`,
      `- moodCoverageMin: 最终正文至少 ${Math.round(moodDirective.moodCoverageMin * 100)}%`,
      `- forbidDominantMode: ${moodDirective.forbidDominantMode}`,
      "- PRIMARY STRUCTURAL REQUIREMENT：这不是软提示。章节必须按 Act1 / Act2 / Act3 组织，其中至少一幕必须是真正的 breath scene。",
      "- Section B 必须承担喘息段功能，内容应为疗伤、扎营、吃东西、休整、路途交谈、人物关系推进、玩笑或调侃之一，而不是继续打斗。",
      "- Breath 章骨架：Act1=余波/ regroup，Act2=完整喘息场景，Act3=小步前推 + 低强度尾钩。",
      "- 必要时必须替换掉部分主导性的战斗推进，不能只在结尾追加一小段喘息。",
      `- 若 breath coverage 低于 ${Math.round(moodDirective.moodCoverageMin * 100)}%，本章视为失败，必须先重写再输出。`,
      "- 不允许让大篇幅战斗/高压对抗继续主导整章。",
      moodDirective.note ? `- note: ${moodDirective.note}` : undefined,
      "",
    ].filter(Boolean).join("\n");
  }

  private buildPayoffDirectiveBlock(
    chapterGoal: ChapterGoal | undefined,
    language: "zh" | "en",
  ): string {
    const payoffDirective = chapterGoal?.payoffDirective;
    if (!payoffDirective) {
      return "";
    }

    if (language === "en") {
      return [
        "",
        "## Payoff Realization Directive",
        `- promisedPayoff: ${payoffDirective.promisedPayoff}`,
        `- payoffType: ${payoffDirective.payoffType}`,
        `- mandatoryByFinalAct: ${payoffDirective.mandatoryByFinalAct}`,
        "- Act 3 must materialize the payoff as an actual event, not a vague hint.",
        "- If the payoff is reveal/resource/breakthrough/relationship/reversal, the final act must show a concrete reveal, resource gain, breakthrough, relationship shift, or reversal beat.",
        "- If the promised payoff is missing, the chapter is considered failed and must be rewritten in Payoff Realization Mode.",
        "",
      ].join("\n");
    }

    return [
      "",
      "## Payoff Realization Directive",
      `- promisedPayoff: ${payoffDirective.promisedPayoff}`,
      `- payoffType: ${payoffDirective.payoffType}`,
      `- mandatoryByFinalAct: ${payoffDirective.mandatoryByFinalAct}`,
      "- Act3 必须把 payoff 兑现成实际事件，而不是模糊暗示。",
      "- 如果 payoffType 是 reveal/resource/breakthrough/relationship/reversal，则章尾主段必须出现对应的真实揭示、资源获得、突破、关系变化或反转节点。",
      "- 如果 promised payoff 没有兑现，本章视为失败，必须进入 Payoff Realization Mode 重写。",
      "",
    ].join("\n");
  }

  private buildHookEmergenceDirectiveBlock(params: {
    readonly directive:
      | {
        readonly mustMaterializeHookNow: boolean;
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
        `- targetHookId: ${params.directive.targetHookId}`,
        `- targetHookState: ${params.directive.targetHookState ?? "overdue"}`,
        `- targetHookExpectedPayoff: ${params.directive.targetHookExpectedPayoff ?? "none"}`,
        "- This hook cannot stay suspended. The chapter must advance it, partially resolve it, or fully resolve it now.",
        "- Mentioning the hook name again, repeating old information, or merely saying the danger still exists does not count.",
        "- The hook needs a real new state change this chapter.",
        "",
      ].join("\n");
    }

    return [
      "",
      "## Hook Emergence Directive",
      `- mustMaterializeHookNow: ${params.directive.mustMaterializeHookNow}`,
      `- targetHookId: ${params.directive.targetHookId}`,
      `- targetHookState: ${params.directive.targetHookState ?? "overdue"}`,
      `- targetHookExpectedPayoff: ${params.directive.targetHookExpectedPayoff ?? "none"}`,
      "- 这个 hook 不能继续纯悬置。本章必须让它发生推进、部分兑现或完全回收之一。",
      "- 仅仅再次提到 hook 名字、重复旧信息、或只说危险仍在，不算推进。",
      "- 本章必须让这个 hook 产生真正的新状态变化。",
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
    chapterGoal?: ChapterGoal;
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
    const payoffDirective = params.chapterGoal?.payoffDirective;
    if (!params.chapterGoal || !payoffDirective?.mandatoryByFinalAct) {
      return params.creative;
    }

    let currentCreative = params.creative;
    let checks = evaluateChapterGoalDiscipline(currentCreative.content, params.chapterGoal);
    if (checks.payoffCheck.matched) {
      return currentCreative;
    }

    for (let attempt = 1; attempt <= 2 && !checks.payoffCheck.matched; attempt += 1) {
      this.logWarn(params.language, {
        zh: `Writer PAYOFF MODE：第${params.chapterNumber}章 rewrite attempt ${attempt}，payoff 尚未真正兑现`,
        en: `Writer PAYOFF MODE: chapter ${params.chapterNumber} rewrite attempt ${attempt}, payoff still not materialized`,
      });

      const response = await this.chat(
        [
          {
            role: "system",
            content: this.buildPayoffRewriteSystemPrompt(params.language, payoffDirective),
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
            }),
          },
        ],
        { maxTokens: params.maxTokens, temperature: 0.5 },
      );
      params.onUsage(response.usage);
      currentCreative = parseCreativeOutput(params.chapterNumber, response.content, params.countingMode);
      checks = evaluateChapterGoalDiscipline(currentCreative.content, params.chapterGoal);
    }

    return currentCreative;
  }

  private buildPayoffRewriteSystemPrompt(
    language: "zh" | "en",
    payoffDirective: NonNullable<ChapterGoal["payoffDirective"]>,
  ): string {
    if (language === "en") {
      return [
        "PAYOFF REALIZATION MODE",
        "You are performing a controlled rewrite to materialize a missing promised payoff.",
        `Promised payoff: ${payoffDirective.promisedPayoff}`,
        `Payoff type: ${payoffDirective.payoffType}`,
        "Hard rule: Act 3 must contain the concrete payoff event, not a vague hint.",
        "Insert or replace a scene so the promised object produces new information, a new resource, a breakthrough, a relationship shift, or a reversal now.",
        "Keep chapter facts and continuity intact.",
      ].join("\n");
    }

    return [
      "PAYOFF REALIZATION MODE",
      "你正在执行一次受控重写，用来兑现缺失的 promised payoff。",
      `Promised payoff: ${payoffDirective.promisedPayoff}`,
      `Payoff type: ${payoffDirective.payoffType}`,
      "硬规则：Act3 必须出现具体 payoff 事件，而不是模糊暗示。",
      "必须插入或替换一个具体 scene，让承诺对象现在就产出新信息、新资源、新突破、关系变化或反转结果。",
      "保留章节事实和连续性。",
    ].join("\n");
  }

  private buildPayoffRewritePrompt(params: {
    language: "zh" | "en";
    chapterNumber: number;
    originalTitle: string;
    originalContent: string;
    preWriteCheck: string;
    payoffDirective: NonNullable<ChapterGoal["payoffDirective"]>;
    titleCandidates: ReadonlyArray<{ title: string }>;
  }): string {
    if (params.language === "en") {
      return [
        `Chapter ${params.chapterNumber} failed payoff materialization.`,
        "- Do not merely strengthen the hint.",
        "- Insert or replace a concrete payoff scene in Act 3.",
        `- The promised payoff is: ${params.payoffDirective.promisedPayoff}`,
        "- The scene must show real new information / resource / breakthrough / relationship shift / reversal.",
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
      `第${params.chapterNumber}章没有真正兑现 promised payoff。`,
      "- 不要只加强暗示。",
      "- 必须在 Act3 插入或替换一个具体的 payoff scene。",
      `- promisedPayoff: ${params.payoffDirective.promisedPayoff}`,
      "- 该 scene 必须让承诺对象真的产出新信息 / 新资源 / 新突破 / 关系变化 / 反转之一。",
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

  private async rewriteForMoodDirectiveIfNeeded(params: {
    creative: {
      title: string;
      content: string;
      wordCount: number;
      preWriteCheck: string;
    };
    chapterIntent?: string;
    moodDirective?: MoodDirective;
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
    const { creative, chapterIntent, moodDirective, language, chapterNumber, maxTokens, countingMode } = params;
    if (!moodDirective || moodDirective.targetMode !== "breath") {
      return creative;
    }

    let currentCreative = creative;
    let moodCheck = evaluateMoodCadenceCompliance(currentCreative.content, chapterIntent);
    if (!moodCheck || moodCheck.matched) {
      return currentCreative;
    }

    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts && moodCheck && !moodCheck.matched; attempt += 1) {
      this.logWarn(language, {
        zh: `Writer REWRITE MODE：第${chapterNumber}章 rewrite attempt ${attempt}，当前 breath coverage=${Math.round((moodCheck.coverageRatio ?? 0) * 100)}%`,
        en: `Writer REWRITE MODE: chapter ${chapterNumber} rewrite attempt ${attempt}, current breath coverage=${Math.round((moodCheck.coverageRatio ?? 0) * 100)}%`,
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
              currentCoverageRatio: moodCheck.coverageRatio ?? 0,
              attempt,
            }),
          },
        ],
        { maxTokens, temperature: 0.55 },
      );
      params.onUsage(rewriteResponse.usage);

      currentCreative = parseCreativeOutput(chapterNumber, rewriteResponse.content, countingMode);
      moodCheck = evaluateMoodCadenceCompliance(currentCreative.content, chapterIntent);
      if (!moodCheck || moodCheck.matched) {
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
        "You are not drafting from scratch and you are not retrying the same prompt.",
        "You are performing a controlled structural rewrite to satisfy a failed breath-mode directive.",
        `Hard requirement: final breath coverage must be >= ${targetCoverage}%.`,
        "Hard requirement: add a real breath section and replace part of the combat-heavy stretch if necessary.",
        "Keep chapter facts, outcomes, and plot continuity intact.",
        "Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT.",
      ].join("\n");
    }

    return [
      "REWRITE MODE",
      "你现在不是重跑原始写作 prompt，也不是普通 retry。",
      "你正在执行一次受控的结构重写，用来修复 breath-mode directive 失败。",
      `硬约束：最终 breath coverage 必须 >= ${targetCoverage}%。`,
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
    attempt: number;
  }): string {
    if (params.language === "en") {
      return [
        `Chapter ${params.chapterNumber} failed the local mood self-check on rewrite attempt ${params.attempt}.`,
        "",
        `- currentCoverage=${Math.round(params.currentCoverageRatio * 100)}%`,
        `- targetCoverage>=${Math.round(params.moodDirective.moodCoverageMin * 100)}%`,
        "- Keep the chapter facts, outcomes, and core plot beats intact.",
        "- PRIMARY STRUCTURAL REQUIREMENT: organize the chapter as Act 1 / Act 2 / Act 3.",
        "- Breath chapter skeleton: Act 1 = aftershock / regroup, Act 2 = full breath scene, Act 3 = small forward motion with a low-intensity hook.",
        "- You must add a real Section B breath scene, not a token sentence.",
        "- You must rewrite at least one combat-heavy segment into: rest/healing, dialogue during joint movement, light warmth/trust progression, or resource sorting/plan discussion.",
        "- If you only append a small breathing beat while combat-heavy material still dominates, this rewrite is a failure.",
        "- You must replace part of the dominant combat structure, not merely append a tiny calm note at the end.",
        `- If breath coverage stays below ${Math.round(params.moodDirective.moodCoverageMin * 100)}%, this rewrite is still a failure.`,
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
      `第${params.chapterNumber}章在 rewrite attempt ${params.attempt} 仍未通过本地 mood self-check。`,
      "",
      `- 当前 coverage=${Math.round(params.currentCoverageRatio * 100)}%`,
      `- 目标 coverage>=${Math.round(params.moodDirective.moodCoverageMin * 100)}%`,
      "- 保留章节事实、结果和主线推进，不要推翻既有情节。",
      "- PRIMARY STRUCTURAL REQUIREMENT：章节必须按 Act1 / Act2 / Act3 组织。",
      "- Breath 章骨架：Act1=余波/ regroup，Act2=完整喘息场景，Act3=小步前推 + 低强度尾钩。",
      "- 必须新增真正的 Section B 喘息段，不能只是点到为止的一句话。",
      "- 必须把至少一个高压段改写成：休整/疗伤、共同行动中的交谈、轻度温情/信任推进、资源整理/计划讨论之一。",
      "- 如果只是追加一小段喘息而主体仍是 combat-heavy，这次 rewrite 仍算失败。",
      "- 必须替换部分主导性的战斗推进，不能只在结尾补一小段。",
      `- 若 breath coverage 仍低于 ${Math.round(params.moodDirective.moodCoverageMin * 100)}%，这次 rewrite 仍算失败。`,
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
