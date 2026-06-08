import type { LLMClient, OnStreamProgress } from "../llm/provider.js";
import { chatCompletion, createLLMClient } from "../llm/provider.js";
import { resolveServiceProviderFamily } from "../llm/service-presets.js";
import type { Logger } from "../utils/logger.js";
import type { BookConfig, FanficMode } from "../models/book.js";
import type { ChapterMeta, ChapterStatus } from "../models/chapter.js";
import type { NotifyChannel, LLMConfig, AgentLLMOverride, InputGovernanceMode } from "../models/project.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { ArchitectAgent, type ArchitectOutput } from "../agents/architect.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { validateFirst10ChapterPlan, validateFoundationDocuments } from "../agents/foundation-documents.js";
import { PlannerAgent, type PlanChapterOutput } from "../agents/planner.js";
import { ComposerAgent } from "../agents/composer.js";
import { sanitizePlannerIntentForChapterIntent, WriterAgent, type WriteChapterInput, type WriteChapterOutput } from "../agents/writer.js";
import { ChapterIntentAgent } from "../agents/chapter-intent.js";
import {
  buildSkippedIntentAlignmentReport,
  IntentAlignmentReviewerAgent,
  writeIntentAlignmentReportFiles,
  type IntentAlignmentReport,
} from "../agents/intent-alignment-reviewer.js";
import {
  StoryEffectivenessAgent,
  writeStoryEffectivenessReportFiles,
  type StoryEffectivenessReport,
} from "../agents/story-effectiveness.js";
import {
  Golden3ChapterAgent,
  writeGolden3ChapterReportFiles,
  type Golden3ChapterReport,
} from "../agents/golden-3-chapter.js";
import {
  OpeningHookReviewerAgent,
  writeOpeningHookReportFiles,
  type OpeningHookReviewReport,
} from "../agents/opening-hook-reviewer.js";
import {
  AntagonistIntelligenceReviewerAgent,
  writeAntagonistIntelligenceReportFiles,
  type AntagonistIntelligenceReport,
} from "../agents/antagonist-intelligence.js";
import {
  cleanNonNarrativeArtifacts,
  detectNonNarrativeArtifacts,
  type CleanNarrativeResult,
} from "../agents/clean-narrative.js";
import {
  applyResourcePlanExpectedBalances,
  buildChapterResourcePlan,
  isNoBalanceChangePlan,
  validateResourceEngineAgainstPlan,
  validateTextAgainstChapterResourcePlanFinal,
  type ChapterResourcePlan,
} from "../agents/resource-plan.js";
import {
  buildAuthoritativeResourceContext,
  buildResourceAuditIssues,
  buildResourceAuthoritySummary,
  buildResourceLedgerUpdate,
  buildResourceRecoveryPlans,
  classifyClosureStatus,
  classifyResourceConsistency,
  detectFilteredPseudoSkills,
  extractResourceEvents,
  applyDeferExchangeTemplatePatch,
  hasForbiddenResourceRecoveryPhrase,
  repairResourceInconsistencies,
  ResourceBlockingRewriterAgent,
  ResourceConsistencyReviserAgent,
  selectResourceRecoveryPlan,
  parseResourceRules,
  syncCurrentStateResources,
  validateResourceMath,
  type ClosureStatus,
  type ResourceConsistencyPipelineResult,
  type ResourceRules,
  type ResourceValidationResult,
  type ResourceConsistencyStatus,
} from "../agents/resource-consistency.js";
import { stripNonProseArtifacts } from "../agents/writer-parser.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { ReviserAgent, DEFAULT_REVISE_MODE, type ReviseMode } from "../agents/reviser.js";
import { StateValidatorAgent, type ValidationResult, type ValidationWarning } from "../agents/state-validator.js";
import { RadarAgent } from "../agents/radar.js";
import type { RadarSource } from "../agents/radar-source.js";
import { readGenreProfile } from "../agents/rules-reader.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import { analyzeSensitiveWords } from "../agents/sensitive-words.js";
import { StateManager } from "../state/manager.js";
import { MemoryDB, type Fact } from "../state/memory-db.js";
import { dispatchNotification, dispatchWebhookEvent } from "../notify/dispatcher.js";
import type { WebhookEvent } from "../notify/webhook.js";
import type { AgentContext } from "../agents/base.js";
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { RadarResult } from "../agents/radar.js";
import type { LengthSpec, LengthTelemetry } from "../models/length-governance.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import { buildLengthSpec, countChapterLength, formatLengthCount, isOutsideHardRange, isOutsideSoftRange, resolveLengthCountingMode, type LengthLanguage } from "../utils/length-metrics.js";
import { analyzeLongSpanFatigue } from "../utils/long-span-fatigue.js";
import { loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts } from "../state/runtime-state-store.js";
import { rewriteStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import { readFile, readdir, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  parseStateDegradedReviewNote,
  resolveStateDegradedBaseStatus,
  retrySettlementAfterValidationFailure,
} from "./chapter-state-recovery.js";
import { persistChapterArtifacts } from "./chapter-persistence.js";
import { runChapterReviewCycle } from "./chapter-review-cycle.js";
import { validateChapterTruthPersistence } from "./chapter-truth-validation.js";
import { loadPersistedPlan, relativeToBookDir } from "./persisted-governed-plan.js";

const SEQUENCE_LEVEL_CATEGORIES = new Set([
  "Pacing Monotony", "节奏单调",
  "Mood Monotony", "情绪单调",
  "Title Collapse", "标题重复",
  "Title Clustering", "标题聚集",
  "Opening Pattern Repetition", "开头同构",
  "Ending Pattern Repetition", "结尾同构",
]);

function isSequenceLevelCategory(category: string): boolean {
  return SEQUENCE_LEVEL_CATEGORIES.has(category);
}

export interface PipelineConfig {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly defaultLLMConfig?: LLMConfig;
  readonly notifyChannels?: ReadonlyArray<NotifyChannel>;
  readonly radarSources?: ReadonlyArray<RadarSource>;
  readonly externalContext?: string;
  readonly modelOverrides?: Record<string, string | AgentLLMOverride>;
  readonly inputGovernanceMode?: InputGovernanceMode;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
  readonly skipPlanningValidation?: boolean;
  readonly skipStateDegradationCheck?: boolean;
}

export interface TokenUsageSummary {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface WriteRetryHintConsumption {
  readonly chapter: string;
  readonly path: string;
  readonly consumed: boolean;
}

export interface ChapterPipelineResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly auditResult: AuditResult;
  readonly revised: boolean;
  readonly status: ChapterStatus;
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly tokenUsage?: TokenUsageSummary;
  readonly writeRetryHint?: WriteRetryHintConsumption;
}

// Atomic operation results
export interface DraftResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly filePath: string;
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly tokenUsage?: TokenUsageSummary;
}

export interface PlanChapterResult {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly intentPath: string;
  readonly goal: string;
  readonly conflicts: ReadonlyArray<string>;
}

export interface ComposeChapterResult extends PlanChapterResult {
  readonly contextPath: string;
  readonly ruleStackPath: string;
  readonly tracePath: string;
}

export interface ReviseResult {
  readonly chapterNumber: number;
  readonly wordCount: number;
  readonly fixedIssues: ReadonlyArray<string>;
  readonly applied: boolean;
  readonly status: "unchanged" | "ready-for-review" | "audit-failed";
  readonly skippedReason?: string;
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
}

export interface TruthFiles {
  readonly currentState: string;
  readonly particleLedger: string;
  readonly pendingHooks: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
}

export interface BookStatusInfo {
  readonly bookId: string;
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly chapters: ReadonlyArray<ChapterMeta>;
}

interface MergedAuditEvaluation {
  readonly auditResult: AuditResult;
  readonly aiTellCount: number;
  readonly blockingCount: number;
  readonly criticalCount: number;
  readonly revisionBlockingIssues: ReadonlyArray<AuditIssue>;
}

export interface ImportChaptersInput {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>;
  readonly resumeFrom?: number;
  /** "continuation" (default) = pick up where the text left off, no new spacetime.
   *  "series" = shared universe but independent new story, requires new spacetime. */
  readonly importMode?: "continuation" | "series";
}

export interface ImportChaptersResult {
  readonly bookId: string;
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
}

export interface InitBookOptions {
  readonly externalContext?: string;
  readonly authorIntent?: string;
  readonly currentFocus?: string;
}

export class PipelineRunner {
  private readonly state: StateManager;
  private readonly config: PipelineConfig;
  private readonly agentClients = new Map<string, LLMClient>();
  private memoryIndexFallbackWarned = false;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.state = new StateManager(config.projectRoot);
  }

  private localize(language: LengthLanguage, messages: { zh: string; en: string }): string {
    return language === "en" ? messages.en : messages.zh;
  }

  private async resolveBookLanguage(
    book: Pick<BookConfig, "genre" | "language">,
  ): Promise<LengthLanguage> {
    if (book.language) {
      return book.language;
    }

    try {
      const { profile } = await this.loadGenreProfile(book.genre);
      return profile.language;
    } catch {
      return "zh";
    }
  }

  private async resolveBookLanguageById(bookId: string): Promise<LengthLanguage> {
    try {
      const book = await this.state.loadBookConfig(bookId);
      return await this.resolveBookLanguage(book);
    } catch {
      return "zh";
    }
  }

  private languageFromLengthSpec(lengthSpec: Pick<LengthSpec, "countingMode">): LengthLanguage {
    return lengthSpec.countingMode === "en_words" ? "en" : "zh";
  }

  private logStage(language: LengthLanguage, message: { zh: string; en: string }): void {
    this.config.logger?.info(
      `${this.localize(language, { zh: "阶段：", en: "Stage: " })}${this.localize(language, message)}`,
    );
  }

  private logInfo(language: LengthLanguage, message: { zh: string; en: string }): void {
    this.config.logger?.info(this.localize(language, message));
  }

  private logWarn(language: LengthLanguage, message: { zh: string; en: string }): void {
    this.config.logger?.warn(this.localize(language, message));
  }

  private minimumWholeChapterWords(lengthSpec: LengthSpec): number {
    if (lengthSpec.target < 1000) {
      return 1;
    }
    return Math.max(1, Math.min(1000, lengthSpec.hardMin));
  }

  private buildFailedWriteResult(params: {
    readonly chapterNumber: number;
    readonly title: string;
    readonly wordCount: number;
    readonly issue: AuditIssue;
    readonly revised: boolean;
    readonly tokenUsage: TokenUsageSummary;
    readonly lengthSpec: LengthSpec;
    readonly writerCount: number;
    readonly postWriterNormalizeCount?: number;
    readonly postReviseCount?: number;
    readonly normalizeApplied?: boolean;
    readonly writeRetryHint?: WriteRetryHintConsumption;
  }): ChapterPipelineResult {
    const lengthWarnings = this.buildLengthWarnings(
      params.chapterNumber,
      params.wordCount,
      params.lengthSpec,
    );
    return {
      chapterNumber: params.chapterNumber,
      title: params.title,
      wordCount: params.wordCount,
      revised: params.revised,
      status: "audit-failed",
      auditResult: {
        passed: false,
        issues: [params.issue],
        summary: params.issue.description,
      },
      lengthWarnings,
      lengthTelemetry: this.buildLengthTelemetry({
        lengthSpec: params.lengthSpec,
        writerCount: params.writerCount,
        postWriterNormalizeCount: params.postWriterNormalizeCount ?? params.writerCount,
        postReviseCount: params.postReviseCount ?? 0,
        finalCount: params.wordCount,
        normalizeApplied: params.normalizeApplied ?? false,
        lengthWarning: lengthWarnings.length > 0,
      }),
      tokenUsage: params.tokenUsage,
      ...(params.writeRetryHint ? { writeRetryHint: params.writeRetryHint } : {}),
    };
  }

  private buildStateSettlementBlocker(params: {
    readonly chapterNumber: number;
    readonly wordCount: number;
    readonly minWholeChapterWords: number;
    readonly postWriteErrors?: WriteChapterOutput["postWriteErrors"];
    readonly enforceLength?: boolean;
    readonly language: LengthLanguage;
  }): AuditIssue | null {
    if (params.enforceLength && params.wordCount < params.minWholeChapterWords) {
      this.logWarn(params.language, {
        zh: `Chapter ${String(params.chapterNumber).padStart(4, "0")} is under minimum length after rewrite. State update skipped.`,
        en: `Chapter ${String(params.chapterNumber).padStart(4, "0")} is under minimum length after rewrite. State update skipped.`,
      });
      return {
        severity: "critical",
        category: "failed-write-under-min-length",
        description: `Chapter ${String(params.chapterNumber).padStart(4, "0")} has only ${params.wordCount} effective words/chars after rewrite; state update skipped.`,
        suggestion: "Regenerate or manually repair the chapter before running state settlement.",
      };
    }

    const payoffError = params.postWriteErrors?.find((violation) => violation.rule === "payoff-missing");
    if (payoffError) {
      this.logWarn(params.language, {
        zh: `Chapter ${String(params.chapterNumber).padStart(4, "0")} payoff still missing: ${payoffError.description}. State update skipped.`,
        en: `Chapter ${String(params.chapterNumber).padStart(4, "0")} payoff still missing: ${payoffError.description}. State update skipped.`,
      });
      return {
        severity: "critical",
        category: "failed-write-payoff-missing",
        description: `Chapter ${String(params.chapterNumber).padStart(4, "0")} payoff still missing: ${payoffError.description}. State update skipped.`,
        suggestion: payoffError.suggestion || "Apply a targeted payoff patch or mark for manual review before state settlement.",
      };
    }

    return null;
  }

  private async tryGenerateStyleGuide(
    bookId: string,
    referenceText: string,
    sourceName: string | undefined,
    language?: LengthLanguage,
  ): Promise<void> {
    try {
      await this.generateStyleGuide(bookId, referenceText, sourceName);
    } catch (error) {
      const resolvedLanguage = language ?? await this.resolveBookLanguageById(bookId);
      const detail = error instanceof Error ? error.message : String(error);
      this.logWarn(resolvedLanguage, {
        zh: `风格指纹提取失败，已跳过：${detail}`,
        en: `Style fingerprint extraction failed and was skipped: ${detail}`,
      });
    }
  }

  private async generateAndReviewFoundation(params: {
    readonly generate: (reviewFeedback?: string) => Promise<ArchitectOutput>;
    readonly repair?: (foundation: ArchitectOutput, reviewFeedback?: string) => Promise<ArchitectOutput>;
    readonly reviewer: FoundationReviewerAgent;
    readonly mode: "original" | "fanfic" | "series";
    readonly sourceCanon?: string;
    readonly styleGuide?: string;
    readonly language: "zh" | "en";
    readonly stageLanguage: LengthLanguage;
    readonly maxRetries?: number;
  }): Promise<ArchitectOutput> {
    const maxRetries = params.maxRetries ?? 2;
    const generateSafely = async (feedback?: string): Promise<ArchitectOutput> => {
      let nextFeedback = feedback;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const generated = await params.generate(nextFeedback);
          return params.repair ? await params.repair(generated, nextFeedback) : generated;
        } catch (error) {
          if (!this.isFoundationSectionGenerationError(error) || attempt >= maxRetries) {
            throw error;
          }
          const generationFeedback = this.buildFoundationGenerationErrorFeedback(error, params.language);
          nextFeedback = nextFeedback
            ? `${nextFeedback}\n\n${generationFeedback}`
            : generationFeedback;
          this.logWarn(params.stageLanguage, {
            zh: `基础设定输出缺少必需 section，正在带错误反馈重新生成...`,
            en: `Foundation output missed required sections, regenerating with error feedback...`,
          });
        }
      }
      throw new Error("Unreachable foundation generation retry state");
    };

    let foundation = await generateSafely();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      this.logStage(params.stageLanguage, {
        zh: `审核基础设定（第${attempt + 1}轮）`,
        en: `reviewing foundation (round ${attempt + 1})`,
      });

      const review = await params.reviewer.review({
        foundation,
        mode: params.mode,
        sourceCanon: params.sourceCanon,
        styleGuide: params.styleGuide,
        language: params.language,
      });

      this.config.logger?.info(
        `Foundation review: ${review.totalScore}/100 ${review.passed ? "PASSED" : "REJECTED"}`,
      );
      for (const dim of review.dimensions) {
        this.config.logger?.info(`  [${dim.score}] ${dim.name.slice(0, 40)}`);
      }

      const structureIssues = validateFoundationDocuments(foundation, {}, params.language);

      if (review.passed && structureIssues.length === 0) {
        return foundation;
      }

      if (structureIssues.length > 0) {
        this.logWarn(params.stageLanguage, {
          zh: `基础设定结构校验未通过：${structureIssues.join("；")}，正在重新生成...`,
          en: `Foundation structural validation failed: ${structureIssues.join("; ")}, regenerating...`,
        });
      } else {
        this.logWarn(params.stageLanguage, {
          zh: `基础设定未通过审核（${review.totalScore}分），正在重新生成...`,
          en: `Foundation rejected (${review.totalScore}/100), regenerating...`,
        });
      }

      foundation = await generateSafely(this.buildFoundationReviewFeedback(review, params.language, structureIssues));
    }

    // Final review
    const finalReview = await params.reviewer.review({
      foundation,
      mode: params.mode,
      sourceCanon: params.sourceCanon,
      styleGuide: params.styleGuide,
      language: params.language,
    });
    this.config.logger?.info(
      `Foundation final review: ${finalReview.totalScore}/100 ${finalReview.passed ? "PASSED" : "ACCEPTED (max retries)"}`,
    );

    const finalStructureIssues = validateFoundationDocuments(foundation, {}, params.language);
    if (finalStructureIssues.length > 0) {
      throw new Error(`[architect] foundation structural validation failed after review retries: ${finalStructureIssues.join("; ")}`);
    }

    return foundation;
  }

  private buildFoundationReviewFeedback(
    review: {
      readonly dimensions: ReadonlyArray<{
        readonly name: string;
        readonly score: number;
        readonly feedback: string;
      }>;
      readonly overallFeedback: string;
    },
    language: "zh" | "en",
    structureIssues: readonly string[] = [],
  ): string {
    const dimensionLines = review.dimensions
      .map((dimension) => (
        language === "en"
          ? `- ${dimension.name} [${dimension.score}]: ${dimension.feedback}`
          : `- ${dimension.name}（${dimension.score}分）：${dimension.feedback}`
      ))
      .join("\n");

    return language === "en"
      ? [
          "## Overall Feedback",
          review.overallFeedback,
          "",
          "## Dimension Notes",
          dimensionLines || "- none",
          "",
          "## Local Structural Validation Errors",
          structureIssues.length > 0 ? structureIssues.map((issue) => `- ${issue}`).join("\n") : "- none",
        ].join("\n")
      : [
          "## 总评",
          review.overallFeedback,
          "",
          "## 分项问题",
          dimensionLines || "- 无",
          "",
          "## 本地结构校验错误",
          structureIssues.length > 0 ? structureIssues.map((issue) => `- ${issue}`).join("\n") : "- 无",
        ].join("\n");
  }

  private isFoundationSectionGenerationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Architect output missing required section/i.test(message);
  }

  private buildFoundationGenerationErrorFeedback(
    error: unknown,
    language: "zh" | "en",
  ): string {
    const message = error instanceof Error ? error.message : String(error);
    return language === "en"
      ? [
          "## Local Parse Error",
          message,
          "",
          "You must regenerate the full foundation and include every required section tag exactly:",
          "=== SECTION: story_bible ===",
          "=== SECTION: volume_outline ===",
          "=== SECTION: book_rules ===",
          "=== SECTION: current_state ===",
          "=== SECTION: pending_hooks ===",
          "=== SECTION: genre_architecture ===",
          "=== SECTION: world_engine ===",
          "=== SECTION: antagonist_map ===",
          "=== SECTION: motivation_matrix ===",
          "=== SECTION: first_10_chapter_plan ===",
          "=== SECTION: structure_signals ===",
        ].join("\n")
      : [
          "## 本地解析错误",
          message,
          "",
          "你必须重新生成完整基础设定，并包含以下每一个必需 section 标签：",
          "=== SECTION: story_bible ===",
          "=== SECTION: volume_outline ===",
          "=== SECTION: book_rules ===",
          "=== SECTION: current_state ===",
          "=== SECTION: pending_hooks ===",
          "=== SECTION: genre_architecture ===",
          "=== SECTION: world_engine ===",
          "=== SECTION: antagonist_map ===",
          "=== SECTION: motivation_matrix ===",
          "=== SECTION: first_10_chapter_plan ===",
          "=== SECTION: structure_signals ===",
        ].join("\n");
  }

  private agentCtx(bookId?: string): AgentContext {
    return {
      client: this.config.client,
      model: this.config.model,
      projectRoot: this.config.projectRoot,
      bookId,
      logger: this.config.logger,
      onStreamProgress: this.config.onStreamProgress,
    };
  }

  private resolveOverride(agentName: string): { model: string; client: LLMClient } {
    const override = this.config.modelOverrides?.[agentName];
    if (!override) {
      return { model: this.config.model, client: this.config.client };
    }
    if (typeof override === "string") {
      return { model: override, client: this.config.client };
    }

    const needsDedicatedClient = Boolean(
      override.baseUrl
      || override.provider
      || override.apiKeyEnv
      || override.stream !== undefined
      || override.temperature !== undefined
      || override.maxTokens !== undefined,
    );
    if (!needsDedicatedClient) {
      return { model: override.model, client: this.config.client };
    }

    const base = this.config.defaultLLMConfig;
    const overrideProvider = override.provider;
    const providerIsService = overrideProvider !== undefined && !["openai", "anthropic", "custom"].includes(overrideProvider);
    const service = providerIsService
      ? overrideProvider
      : base?.service ?? "custom";
    const provider = (
      overrideProvider === "openai"
      || overrideProvider === "anthropic"
      || overrideProvider === "custom"
        ? overrideProvider
        : overrideProvider === undefined
          ? base?.provider ?? resolveServiceProviderFamily(service) ?? "custom"
          : resolveServiceProviderFamily(service) ?? base?.provider ?? "custom"
    ) as "openai" | "anthropic" | "custom";
    const apiKeySource = override.apiKeyEnv
      ? `env:${override.apiKeyEnv}`
      : `base:${base?.apiKey ?? ""}`;
    const stream = override.stream ?? base?.stream ?? true;
    const apiFormat = base?.apiFormat ?? "chat";
    const temperature = override.temperature ?? base?.temperature ?? 0.7;
    const maxTokens = override.maxTokens ?? base?.maxTokens ?? 8192;
    const baseUrl = override.baseUrl ?? (providerIsService ? "" : base?.baseUrl ?? "");
    const cacheKey = [
      provider,
      service,
      baseUrl,
      apiKeySource,
      `stream:${stream}`,
      `format:${apiFormat}`,
      `temperature:${temperature}`,
      `maxTokens:${maxTokens}`,
    ].join("|");
    let client = this.agentClients.get(cacheKey);
    if (!client) {
      const apiKey = override.apiKeyEnv
        ? process.env[override.apiKeyEnv] ?? ""
        : base?.apiKey ?? "";
      client = createLLMClient({
        provider,
        service,
        configSource: base?.configSource ?? "env",
        baseUrl,
        apiKey,
        model: override.model,
        temperature,
        maxTokens,
        thinkingBudget: base?.thinkingBudget ?? 0,
        apiFormat,
        stream,
      });
      this.agentClients.set(cacheKey, client);
    }
    return { model: override.model, client };
  }

  private agentCtxFor(agent: string, bookId?: string): AgentContext {
    const { model, client } = this.resolveOverride(agent);
    return {
      client,
      model,
      projectRoot: this.config.projectRoot,
      bookId,
      logger: this.config.logger?.child(agent),
      onStreamProgress: this.config.onStreamProgress,
    };
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private async loadGenreProfile(genre: string): Promise<{ profile: GenreProfile }> {
    const parsed = await readGenreProfile(this.config.projectRoot, genre);
    return { profile: parsed.profile };
  }

  // ---------------------------------------------------------------------------
  // Atomic operations (composable by OpenClaw or agent mode)
  // ---------------------------------------------------------------------------

  async runRadar(): Promise<RadarResult> {
    const radar = new RadarAgent(this.agentCtxFor("radar"), this.config.radarSources);
    return radar.scan();
  }

  async initBook(book: BookConfig, options: InitBookOptions = {}): Promise<void> {
    const architect = new ArchitectAgent(this.agentCtxFor("architect", book.id));
    const bookDir = this.state.bookDir(book.id);
    const stagingBookDir = join(
      this.state.booksDir,
      `.tmp-book-create-${book.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const stageLanguage = await this.resolveBookLanguage(book);

    this.logStage(stageLanguage, { zh: "生成基础设定", en: "generating foundation" });
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const reviewer = new FoundationReviewerAgent(this.agentCtxFor("foundation-reviewer", book.id));
    const resolvedLanguage = (book.language ?? gp.language) === "en" ? "en" as const : "zh" as const;
    const foundation = await this.generateAndReviewFoundation({
      generate: (reviewFeedback) => architect.generateFoundation(
        book,
        options.externalContext ?? this.config.externalContext,
        reviewFeedback,
      ),
      repair: (foundation, reviewFeedback) => architect.completeStorySkeletonSections(book, foundation, reviewFeedback),
      reviewer,
      mode: "original",
      language: resolvedLanguage,
      stageLanguage,
    });
    const completedFoundation = await architect.completeStructureSignals(book, foundation);
    try {
      this.logStage(stageLanguage, { zh: "保存书籍配置", en: "saving book config" });
      await this.state.saveBookConfigAt(stagingBookDir, book);

      this.logStage(stageLanguage, { zh: "写入基础设定文件", en: "writing foundation files" });
      await architect.writeFoundationFiles(
        stagingBookDir,
        completedFoundation,
        gp.numericalSystem,
        book.language ?? gp.language,
        book.webnovelTemplate,
        book,
      );

      this.logStage(stageLanguage, { zh: "初始化控制文档", en: "initializing control documents" });
      await this.state.ensureControlDocumentsAt(
        stagingBookDir,
        book.language ?? gp.language,
        options.authorIntent ?? this.config.externalContext,
        book.webnovelTemplate,
      );
      const authorIntentOverride = options.authorIntent ?? this.config.externalContext;
      if (authorIntentOverride?.trim()) {
        await writeFile(
          join(stagingBookDir, "story", "author_intent.md"),
          authorIntentOverride.trimEnd() + "\n",
          "utf-8",
        );
      }
      if (options.currentFocus?.trim()) {
        await writeFile(
          join(stagingBookDir, "story", "current_focus.md"),
          options.currentFocus.trimEnd() + "\n",
          "utf-8",
        );
      }

      await this.state.saveChapterIndexAt(stagingBookDir, []);

      this.logStage(stageLanguage, { zh: "创建初始快照", en: "creating initial snapshot" });
      await this.state.snapshotStateAt(stagingBookDir, 0);

      if (await this.pathExists(bookDir)) {
        if (await this.state.isCompleteBookDirectory(bookDir)) {
          throw new Error(`Book "${book.id}" already exists at books/${book.id}/. Use a different title or delete the existing book first.`);
        }
        await rm(bookDir, { recursive: true, force: true });
      }

      await rename(stagingBookDir, bookDir);
    } catch (error) {
      await rm(stagingBookDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Import external source material and generate fanfic_canon.md */
  async importFanficCanon(
    bookId: string,
    sourceText: string,
    sourceName: string,
    fanficMode: FanficMode,
  ): Promise<string> {
    const { FanficCanonImporter } = await import("../agents/fanfic-canon-importer.js");
    const importer = new FanficCanonImporter(this.agentCtxFor("fanfic-canon-importer", bookId));
    const result = await importer.importFromText(sourceText, sourceName, fanficMode);

    const bookDir = this.state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "fanfic_canon.md"), result.fullDocument, "utf-8");

    return result.fullDocument;
  }

  /** One-step fanfic book creation: create book + import canon + generate foundation */
  async initFanficBook(
    book: BookConfig,
    sourceText: string,
    sourceName: string,
    fanficMode: FanficMode,
  ): Promise<void> {
    const bookDir = this.state.bookDir(book.id);
    const stageLanguage = await this.resolveBookLanguage(book);

    this.logStage(stageLanguage, { zh: "保存书籍配置", en: "saving book config" });
    await this.state.saveBookConfig(book.id, book);

    // Step 1: Import source material → fanfic_canon.md
    this.logStage(stageLanguage, { zh: "导入同人正典", en: "importing fanfic canon" });
    const fanficCanon = await this.importFanficCanon(book.id, sourceText, sourceName, fanficMode);

    // Step 2: Generate foundation with review loop
    const architect = new ArchitectAgent(this.agentCtxFor("architect", book.id));
    const reviewer = new FoundationReviewerAgent(this.agentCtxFor("foundation-reviewer", book.id));
    this.logStage(stageLanguage, { zh: "生成同人基础设定", en: "generating fanfic foundation" });
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const resolvedLanguage = (book.language ?? gp.language) === "en" ? "en" as const : "zh" as const;
    const foundation = await this.generateAndReviewFoundation({
      generate: (reviewFeedback) => architect.generateFanficFoundation(
        book,
        fanficCanon,
        fanficMode,
        reviewFeedback,
      ),
      repair: (foundation, reviewFeedback) => architect.completeStorySkeletonSections(book, foundation, reviewFeedback),
      reviewer,
      mode: "fanfic",
      sourceCanon: fanficCanon,
      language: resolvedLanguage,
      stageLanguage,
    });
    const completedFoundation = await architect.completeStructureSignals(book, foundation);
    this.logStage(stageLanguage, { zh: "写入基础设定文件", en: "writing foundation files" });
    await architect.writeFoundationFiles(
      bookDir,
      completedFoundation,
      gp.numericalSystem,
      book.language ?? gp.language,
      book.webnovelTemplate,
      book,
    );
    this.logStage(stageLanguage, { zh: "初始化控制文档", en: "initializing control documents" });
    await this.state.ensureControlDocuments(book.id, this.config.externalContext, book.webnovelTemplate);

    // Step 3: Generate style guide from source material
    if (sourceText.length >= 500) {
      this.logStage(stageLanguage, { zh: "提取原作风格指纹", en: "extracting source style fingerprint" });
      await this.tryGenerateStyleGuide(book.id, sourceText, sourceName, stageLanguage);
    }

    // Step 4: Initialize chapters directory + snapshot
    this.logStage(stageLanguage, { zh: "创建初始快照", en: "creating initial snapshot" });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await this.state.saveChapterIndex(book.id, []);
    await this.state.snapshotState(book.id, 0);
  }

  /** Write a single draft chapter. Saves chapter file + truth files + index + snapshot. */
  async writeDraft(bookId: string, context?: string, wordCount?: number): Promise<DraftResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      await this.state.ensureControlDocuments(bookId);
      const book = await this.state.loadBookConfig(bookId);
      const bookDir = this.state.bookDir(bookId);
      const chapterNumber = await this.state.getNextChapterNumber(bookId);
      const stageLanguage = await this.resolveBookLanguage(book);
      this.logStage(stageLanguage, { zh: "准备章节输入", en: "preparing chapter inputs" });
      const writeInput = await this.prepareWriteInput(
        book,
        bookDir,
        chapterNumber,
        context ?? this.config.externalContext,
      );

      const { profile: gp } = await this.loadGenreProfile(book.genre);
      const lengthSpec = buildLengthSpec(
        wordCount ?? book.chapterWordCount,
        book.language ?? gp.language,
      );

      const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
      this.logStage(stageLanguage, { zh: "撰写章节草稿", en: "writing chapter draft" });
      const output = await writer.writeChapter({
        book,
        bookDir,
        chapterNumber,
        ...writeInput,
        lengthSpec,
        ...(wordCount ? { wordCountOverride: wordCount } : {}),
      });
      const writerCount = countChapterLength(output.content, lengthSpec.countingMode);
      let totalUsage: TokenUsageSummary = output.tokenUsage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      const normalizedDraft = await this.normalizeDraftLengthIfNeeded({
        bookId,
        chapterNumber,
        chapterContent: output.content,
        lengthSpec,
        chapterIntent: writeInput.chapterIntent,
      });
      totalUsage = PipelineRunner.addUsage(totalUsage, normalizedDraft.tokenUsage);
      const draftOutput: WriteChapterOutput = {
        ...output,
        content: normalizedDraft.content,
        wordCount: normalizedDraft.wordCount,
        tokenUsage: totalUsage,
      };
      const lengthWarnings = this.buildLengthWarnings(
        chapterNumber,
        draftOutput.wordCount,
        lengthSpec,
      );
      const lengthTelemetry = this.buildLengthTelemetry({
        lengthSpec,
        writerCount,
        postWriterNormalizeCount: normalizedDraft.wordCount,
        postReviseCount: 0,
        finalCount: draftOutput.wordCount,
        normalizeApplied: normalizedDraft.applied,
        lengthWarning: lengthWarnings.length > 0,
      });
      this.logLengthWarnings(lengthWarnings);

      // Save chapter file
      const chaptersDir = join(bookDir, "chapters");
      const paddedNum = String(chapterNumber).padStart(4, "0");
      const sanitized = draftOutput.title.replace(/[/\\?%*:|"<>]/g, "").replace(/\s+/g, "_").slice(0, 50);
      const filename = `${paddedNum}_${sanitized}.md`;
      const filePath = join(chaptersDir, filename);

      const resolvedLang = book.language ?? gp.language;
      const heading = resolvedLang === "en"
        ? `# Chapter ${chapterNumber}: ${draftOutput.title}`
        : `# 第${chapterNumber}章 ${draftOutput.title}`;
      await writeFile(filePath, `${heading}\n\n${draftOutput.content}`, "utf-8");

      // Save truth files
      this.logStage(stageLanguage, { zh: "落盘草稿与真相文件", en: "persisting draft and truth files" });
      await writer.saveChapter(bookDir, draftOutput, gp.numericalSystem, resolvedLang);
      await writer.saveNewTruthFiles(bookDir, draftOutput, resolvedLang);
      await this.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, draftOutput);
      await this.syncNarrativeMemoryIndex(bookId, chapterNumber);

      // Update index
      const existingIndex = await this.state.loadChapterIndex(bookId);
      const now = new Date().toISOString();
      const newEntry: ChapterMeta = {
        number: chapterNumber,
        title: draftOutput.title,
        status: "drafted",
        wordCount: draftOutput.wordCount,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings,
        lengthTelemetry,
        ...(draftOutput.tokenUsage ? { tokenUsage: draftOutput.tokenUsage } : {}),
      };
      const existingIdx = existingIndex.findIndex((e) => e.number === chapterNumber);
      const updatedIndex = existingIdx >= 0
        ? existingIndex.map((e, i) => i === existingIdx ? newEntry : e)
        : [...existingIndex, newEntry];
      await this.state.saveChapterIndex(bookId, updatedIndex);
      await this.markBookActiveIfNeeded(bookId);

      // Snapshot
      this.logStage(stageLanguage, { zh: "更新章节索引与快照", en: "updating chapter index and snapshots" });
      await this.state.snapshotState(bookId, chapterNumber);
      await this.syncCurrentStateFactHistory(bookId, chapterNumber);

      await this.emitWebhook("chapter-complete", bookId, chapterNumber, {
        title: draftOutput.title,
        wordCount: draftOutput.wordCount,
      });

      return {
        chapterNumber,
        title: draftOutput.title,
        wordCount: draftOutput.wordCount,
        filePath,
        lengthWarnings,
        lengthTelemetry,
        tokenUsage: draftOutput.tokenUsage,
      };
    } finally {
      await releaseLock();
    }
  }

  async planChapter(bookId: string, context?: string): Promise<PlanChapterResult> {
    await this.state.ensureControlDocuments(bookId);
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const chapterNumber = await this.state.getNextChapterNumber(bookId);
    const stageLanguage = await this.resolveBookLanguage(book);
    this.logStage(stageLanguage, { zh: "规划下一章意图", en: "planning next chapter intent" });
    const { plan } = await this.createGovernedArtifacts(
      book,
      bookDir,
      chapterNumber,
      context ?? this.config.externalContext,
      { reuseExistingIntentWhenContextMissing: false },
    );

    return {
      bookId,
      chapterNumber,
      intentPath: relativeToBookDir(bookDir, plan.runtimePath),
      goal: plan.intent.goal,
      conflicts: plan.intent.conflicts.map((conflict) => `${conflict.type}: ${conflict.resolution}`),
    };
  }

  async composeChapter(bookId: string, context?: string): Promise<ComposeChapterResult> {
    await this.state.ensureControlDocuments(bookId);
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const chapterNumber = await this.state.getNextChapterNumber(bookId);
    const stageLanguage = await this.resolveBookLanguage(book);
    this.logStage(stageLanguage, { zh: "组装章节运行时上下文", en: "composing chapter runtime context" });
    const { plan, composed } = await this.createGovernedArtifacts(
      book,
      bookDir,
      chapterNumber,
      context ?? this.config.externalContext,
      { reuseExistingIntentWhenContextMissing: true },
    );

    return {
      bookId,
      chapterNumber,
      intentPath: relativeToBookDir(bookDir, plan.runtimePath),
      goal: plan.intent.goal,
      conflicts: plan.intent.conflicts.map((conflict) => `${conflict.type}: ${conflict.resolution}`),
      contextPath: relativeToBookDir(bookDir, composed.contextPath),
      ruleStackPath: relativeToBookDir(bookDir, composed.ruleStackPath),
      tracePath: relativeToBookDir(bookDir, composed.tracePath),
    };
  }

  /** Audit the latest (or specified) chapter. Read-only, no lock needed. */
  async auditDraft(bookId: string, chapterNumber?: number): Promise<AuditResult & { readonly chapterNumber: number }> {
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const targetChapter = chapterNumber ?? (await this.state.getNextChapterNumber(bookId)) - 1;
    if (targetChapter < 1) {
      throw new Error(`No chapters to audit for "${bookId}"`);
    }

    const content = await this.readChapterContent(bookDir, targetChapter);
    const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const language = book.language ?? gp.language;
    this.logStage(language, {
      zh: `审计第${targetChapter}章`,
      en: `auditing chapter ${targetChapter}`,
    });
    const evaluation = await this.evaluateMergedAudit({
      auditor,
      book,
      bookDir,
      chapterContent: content,
      chapterNumber: targetChapter,
      language,
    });
    const result = evaluation.auditResult;

    // Update index with audit result
    const index = await this.state.loadChapterIndex(bookId);
    const updated = index.map((ch) =>
      ch.number === targetChapter
        ? {
            ...ch,
            status: (result.passed ? "ready-for-review" : "audit-failed") as ChapterMeta["status"],
            updatedAt: new Date().toISOString(),
            auditIssues: result.issues.map((i) => `[${i.severity}] ${i.description}`),
          }
        : ch,
    );
    await this.state.saveChapterIndex(bookId, updated);
    const latestChapter = index.length > 0 ? Math.max(...index.map((chapter) => chapter.number)) : targetChapter;
    if (targetChapter === latestChapter) {
      await this.persistAuditDriftGuidance({
        bookDir,
        chapterNumber: targetChapter,
        issues: result.issues.filter((issue) => issue.severity === "critical" || issue.severity === "warning"),
        language,
      }).catch(() => undefined);
    }

    await this.emitWebhook(
      result.passed ? "audit-passed" : "audit-failed",
      bookId,
      targetChapter,
      { summary: result.summary, issueCount: result.issues.length },
    );

    return { ...result, chapterNumber: targetChapter };
  }

  /** Revise the latest (or specified) chapter based on audit issues. */
  async reviseDraft(bookId: string, chapterNumber?: number, mode: ReviseMode = DEFAULT_REVISE_MODE): Promise<ReviseResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      const book = await this.state.loadBookConfig(bookId);
      const bookDir = this.state.bookDir(bookId);
      const targetChapter = chapterNumber ?? (await this.state.getNextChapterNumber(bookId)) - 1;
      if (targetChapter < 1) {
        throw new Error(`No chapters to revise for "${bookId}"`);
      }

      const stageLanguage = await this.resolveBookLanguage(book);
      // Read the current audit issues from index
      this.logStage(stageLanguage, {
        zh: `加载第${targetChapter}章修订上下文`,
        en: `loading revision context for chapter ${targetChapter}`,
      });
      const index = await this.state.loadChapterIndex(bookId);
      const chapterMeta = index.find((ch) => ch.number === targetChapter);
      if (!chapterMeta) {
        throw new Error(`Chapter ${targetChapter} not found in index`);
      }

      // Re-audit to get structured issues (index only stores strings)
      const content = await this.readChapterContent(bookDir, targetChapter);
      const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
      const { profile: gp } = await this.loadGenreProfile(book.genre);
      const language = book.language ?? gp.language;
      const countingMode = resolveLengthCountingMode(language);
      const reviseControlInput = (this.config.inputGovernanceMode ?? "v2") === "legacy"
        ? undefined
        : await this.createGovernedArtifacts(
          book,
          bookDir,
          targetChapter,
          this.config.externalContext,
          { reuseExistingIntentWhenContextMissing: true, skipPlanningValidation: true },
        );
      const preRevision = await this.evaluateMergedAudit({
        auditor,
        book,
        bookDir,
        chapterContent: content,
        chapterNumber: targetChapter,
        language,
        auditOptions: reviseControlInput
          ? {
              chapterIntent: reviseControlInput.plan.intentMarkdown,
              contextPackage: reviseControlInput.composed.contextPackage,
              ruleStack: reviseControlInput.composed.ruleStack,
            }
          : undefined,
      });

      if (preRevision.blockingCount === 0 && preRevision.aiTellCount === 0) {
        return {
          chapterNumber: targetChapter,
          wordCount: countChapterLength(content, countingMode),
          fixedIssues: [],
          applied: false,
          status: "unchanged",
          skippedReason: "No warning, critical, or AI-tell issues to fix.",
        };
      }

      const chapterLengthTarget = chapterMeta.lengthTelemetry?.target ?? book.chapterWordCount;
      const lengthLanguage = chapterMeta.lengthTelemetry?.countingMode === "en_words"
        ? "en"
        : language;
      const lengthSpec = buildLengthSpec(
        chapterLengthTarget,
        lengthLanguage,
      );

      const reviser = new ReviserAgent(this.agentCtxFor("reviser", bookId));
      this.logStage(stageLanguage, {
        zh: `修订第${targetChapter}章`,
        en: `revising chapter ${targetChapter}`,
      });
      const reviseOutput = await reviser.reviseChapter(
        bookDir,
        content,
        targetChapter,
        preRevision.auditResult.issues,
        mode,
        book.genre,
        reviseControlInput
          ? {
              chapterIntent: reviseControlInput.plan.intentMarkdown,
              contextPackage: reviseControlInput.composed.contextPackage,
              ruleStack: reviseControlInput.composed.ruleStack,
              lengthSpec,
            }
          : { lengthSpec },
      );

      if (reviseOutput.revisedContent.length === 0) {
        throw new Error("Reviser returned empty content");
      }
      const normalizedRevision = await this.normalizeDraftLengthIfNeeded({
        bookId,
        chapterNumber: targetChapter,
        chapterContent: reviseOutput.revisedContent,
        lengthSpec,
      });
      const postRevision = await this.evaluateMergedAudit({
        auditor,
        book,
        bookDir,
        chapterContent: normalizedRevision.content,
        chapterNumber: targetChapter,
        language,
        auditOptions: reviseControlInput
          ? {
              temperature: 0,
              chapterIntent: reviseControlInput.plan.intentMarkdown,
              contextPackage: reviseControlInput.composed.contextPackage,
              ruleStack: reviseControlInput.composed.ruleStack,
              truthFileOverrides: {
                currentState: reviseOutput.updatedState !== "(状态卡未更新)" ? reviseOutput.updatedState : undefined,
                ledger: reviseOutput.updatedLedger !== "(账本未更新)" ? reviseOutput.updatedLedger : undefined,
                hooks: reviseOutput.updatedHooks !== "(伏笔池未更新)" ? reviseOutput.updatedHooks : undefined,
              },
            }
          : {
              temperature: 0,
              truthFileOverrides: {
                currentState: reviseOutput.updatedState !== "(状态卡未更新)" ? reviseOutput.updatedState : undefined,
                ledger: reviseOutput.updatedLedger !== "(账本未更新)" ? reviseOutput.updatedLedger : undefined,
                hooks: reviseOutput.updatedHooks !== "(伏笔池未更新)" ? reviseOutput.updatedHooks : undefined,
              },
            },
      });
      const effectivePostRevision = this.restoreActionableAuditIfLost(
        preRevision,
        postRevision,
      );
      const revisionBaseCount = countChapterLength(content, lengthSpec.countingMode);
      const lengthWarnings = this.buildLengthWarnings(
        targetChapter,
        normalizedRevision.wordCount,
        lengthSpec,
      );
      const lengthTelemetry = this.buildLengthTelemetry({
        lengthSpec,
        writerCount: revisionBaseCount,
        postWriterNormalizeCount: 0,
        postReviseCount: normalizedRevision.wordCount,
        finalCount: normalizedRevision.wordCount,
        normalizeApplied: normalizedRevision.applied,
        lengthWarning: lengthWarnings.length > 0,
      });

      const improvedBlocking = effectivePostRevision.blockingCount < preRevision.blockingCount;
      const improvedAITells = effectivePostRevision.aiTellCount < preRevision.aiTellCount;
      const blockingDidNotWorsen = effectivePostRevision.blockingCount <= preRevision.blockingCount;
      const criticalDidNotWorsen = effectivePostRevision.criticalCount <= preRevision.criticalCount;
      const aiDidNotWorsen = effectivePostRevision.aiTellCount <= preRevision.aiTellCount;
      const shouldApplyRevision = blockingDidNotWorsen
        && criticalDidNotWorsen
        && aiDidNotWorsen
        && (improvedBlocking || improvedAITells);

      if (!shouldApplyRevision) {
        return {
          chapterNumber: targetChapter,
          wordCount: revisionBaseCount,
          fixedIssues: [],
          applied: false,
          status: "unchanged",
          skippedReason: "Manual revision did not improve merged audit or AI-tell metrics; kept original chapter.",
        };
      }
      this.logLengthWarnings(lengthWarnings);

      // Save revised chapter file
      this.logStage(stageLanguage, {
        zh: `落盘第${targetChapter}章修订结果`,
        en: `persisting revision for chapter ${targetChapter}`,
      });
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(targetChapter).padStart(4, "0");
      const existingFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!existingFile) {
        throw new Error(`Chapter ${targetChapter} file not found in ${chaptersDir} (expected filename starting with ${paddedNum})`);
      }
      const reviseLang = book.language ?? gp.language;
      const reviseHeading = reviseLang === "en"
        ? `# Chapter ${targetChapter}: ${chapterMeta.title}`
        : `# 第${targetChapter}章 ${chapterMeta.title}`;
      await writeFile(
        join(chaptersDir, existingFile),
        `${reviseHeading}\n\n${normalizedRevision.content}`,
        "utf-8",
      );

      // Update truth files
      const storyDir = join(bookDir, "story");
      if (reviseOutput.updatedState !== "(状态卡未更新)") {
        await writeFile(join(storyDir, "current_state.md"), reviseOutput.updatedState, "utf-8");
      }
      if (gp.numericalSystem && reviseOutput.updatedLedger && reviseOutput.updatedLedger !== "(账本未更新)") {
        await writeFile(join(storyDir, "particle_ledger.md"), reviseOutput.updatedLedger, "utf-8");
      }
      if (reviseOutput.updatedHooks !== "(伏笔池未更新)") {
        await writeFile(join(storyDir, "pending_hooks.md"), reviseOutput.updatedHooks, "utf-8");
      }
      await this.syncLegacyStructuredStateFromMarkdown(bookDir, targetChapter);

      // Update index
      const updatedIndex = index.map((ch) =>
        ch.number === targetChapter
          ? {
              ...ch,
              status: (effectivePostRevision.auditResult.passed ? "ready-for-review" : "audit-failed") as ChapterMeta["status"],
              wordCount: normalizedRevision.wordCount,
              updatedAt: new Date().toISOString(),
              auditIssues: effectivePostRevision.auditResult.issues.map((i) => `[${i.severity}] ${i.description}`),
              lengthWarnings,
              lengthTelemetry,
            }
          : ch,
      );
      await this.state.saveChapterIndex(bookId, updatedIndex);
      const latestChapter = index.length > 0 ? Math.max(...index.map((chapter) => chapter.number)) : targetChapter;
      if (targetChapter === latestChapter) {
        await this.persistAuditDriftGuidance({
          bookDir,
          chapterNumber: targetChapter,
          issues: effectivePostRevision.auditResult.issues.filter(
            (issue) => issue.severity === "critical" || issue.severity === "warning",
          ),
          language,
        }).catch(() => undefined);
      }

      // Re-snapshot
      this.logStage(stageLanguage, {
        zh: `更新第${targetChapter}章索引与快照`,
        en: `updating chapter index and snapshots for chapter ${targetChapter}`,
      });
      await this.state.snapshotState(bookId, targetChapter);
      await this.syncNarrativeMemoryIndex(bookId, targetChapter);
      await this.syncCurrentStateFactHistory(bookId, targetChapter);

      await this.emitWebhook("revision-complete", bookId, targetChapter, {
        wordCount: normalizedRevision.wordCount,
        fixedCount: reviseOutput.fixedIssues.length,
      });

      return {
        chapterNumber: targetChapter,
        wordCount: normalizedRevision.wordCount,
        fixedIssues: reviseOutput.fixedIssues,
        applied: true,
        status: effectivePostRevision.auditResult.passed ? "ready-for-review" : "audit-failed",
        lengthWarnings,
        lengthTelemetry,
      };
    } finally {
      await releaseLock();
    }
  }

  /** Read all truth files for a book. */
  async readTruthFiles(bookId: string): Promise<TruthFiles> {
    const bookDir = this.state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    const readSafe = async (path: string): Promise<string> => {
      try {
        return await readFile(path, "utf-8");
      } catch {
        return "(文件不存在)";
      }
    };

    const [currentState, particleLedger, pendingHooks, storyBible, volumeOutline, bookRules] =
      await Promise.all([
        readSafe(join(storyDir, "current_state.md")),
        readSafe(join(storyDir, "particle_ledger.md")),
        readSafe(join(storyDir, "pending_hooks.md")),
        readSafe(join(storyDir, "story_bible.md")),
        readSafe(join(storyDir, "volume_outline.md")),
        readSafe(join(storyDir, "book_rules.md")),
      ]);

    return { currentState, particleLedger, pendingHooks, storyBible, volumeOutline, bookRules };
  }

  /** Get book status overview. */
  async getBookStatus(bookId: string): Promise<BookStatusInfo> {
    const book = await this.state.loadBookConfig(bookId);
    const chapters = await this.state.loadChapterIndex(bookId);
    const nextChapter = await this.state.getNextChapterNumber(bookId);
    const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

    return {
      bookId,
      title: book.title,
      genre: book.genre,
      platform: book.platform,
      status: book.status,
      chaptersWritten: chapters.length,
      totalWords,
      nextChapter,
      chapters: [...chapters],
    };
  }

  // ---------------------------------------------------------------------------
  // Full pipeline (convenience — runs draft + audit + revise in one shot)
  // ---------------------------------------------------------------------------

  async writeNextChapter(bookId: string, wordCount?: number, temperatureOverride?: number): Promise<ChapterPipelineResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      return await this._writeNextChapterLocked(bookId, wordCount, temperatureOverride);
    } finally {
      await releaseLock();
    }
  }

  async repairChapterState(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      return await this._repairChapterStateLocked(bookId, chapterNumber);
    } finally {
      await releaseLock();
    }
  }

  async resyncChapterArtifacts(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      return await this._resyncChapterArtifactsLocked(bookId, chapterNumber);
    } finally {
      await releaseLock();
    }
  }

  private async _writeNextChapterLocked(bookId: string, wordCount?: number, temperatureOverride?: number): Promise<ChapterPipelineResult> {
    await this.state.ensureControlDocuments(bookId);
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    await this.assertNoPendingStateRepair(bookId);
    const chapterNumber = await this.state.getNextChapterNumber(bookId);
    const retryHint = await this.readWriteRetryHint(bookDir, chapterNumber);
    const stageLanguage = await this.resolveBookLanguage(book);
    if (retryHint) {
      this.logStage(stageLanguage, {
        zh: `读取章节重试提示：${retryHint.report.path}`,
        en: `loaded chapter retry hint: ${retryHint.report.path}`,
      });
    }
    this.logStage(stageLanguage, { zh: "准备章节输入", en: "preparing chapter inputs" });
    const baseWriteInput = await this.prepareWriteInput(
      book,
      bookDir,
      chapterNumber,
      this.config.externalContext,
    );
    const writeInput = await this.prepareChapterIntentInput({
      book,
      bookDir,
      chapterNumber,
      writeInput: baseWriteInput,
      language: stageLanguage,
    });
    const reducedControlInput = writeInput.chapterIntent && writeInput.contextPackage && writeInput.ruleStack
      ? {
          chapterIntent: writeInput.chapterIntent,
          contextPackage: writeInput.contextPackage,
          ruleStack: writeInput.ruleStack,
        }
      : undefined;
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const pipelineLang = book.language ?? gp.language;
    const lengthSpec = buildLengthSpec(
      wordCount ?? book.chapterWordCount,
      pipelineLang,
    );

    // 1. Write chapter
    const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
    this.logStage(stageLanguage, { zh: "撰写章节草稿", en: "writing chapter draft" });
    const output = await writer.writeChapter({
      book,
      bookDir,
      chapterNumber,
      ...writeInput,
      ...(retryHint ? { retryHint: retryHint.content, retryHintPath: retryHint.report.path } : {}),
      lengthSpec,
      ...(wordCount ? { wordCountOverride: wordCount } : {}),
      ...(temperatureOverride ? { temperatureOverride } : {}),
    });
    const writerCount = countChapterLength(output.content, lengthSpec.countingMode);
    const minWholeChapterWords = this.minimumWholeChapterWords(lengthSpec);

    // Token usage accumulator
    let totalUsage: TokenUsageSummary = output.tokenUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const initialLengthBlocker = this.buildStateSettlementBlocker({
      chapterNumber,
      wordCount: writerCount,
      minWholeChapterWords,
      postWriteErrors: [],
      enforceLength: writerCount >= 100 && (output.postWriteErrors.length > 0 || output.postWriteWarnings.length > 0),
      language: pipelineLang,
    });
    if (initialLengthBlocker) {
      return this.buildFailedWriteResult({
        chapterNumber,
        title: output.title,
        wordCount: writerCount,
        issue: initialLengthBlocker,
        revised: false,
        tokenUsage: totalUsage,
        lengthSpec,
        writerCount,
        ...(retryHint ? { writeRetryHint: retryHint.report } : {}),
      });
    }

    const auditor = new ContinuityAuditor(this.agentCtxFor("auditor", bookId));
    const reviewResult = await runChapterReviewCycle({
      book: { genre: book.genre },
      bookDir,
      chapterNumber,
      initialOutput: output,
      reducedControlInput,
      lengthSpec,
      initialUsage: totalUsage,
      createReviser: () => new ReviserAgent(this.agentCtxFor("reviser", bookId)),
      auditor,
      normalizeDraftLengthIfNeeded: (chapterContent) => this.normalizeDraftLengthIfNeeded({
        bookId,
        chapterNumber,
        chapterContent,
        lengthSpec,
        chapterIntent: writeInput.chapterIntent,
      }),
      assertChapterContentNotEmpty: (content, stage) =>
        this.assertChapterContentNotEmpty(content, chapterNumber, stage),
      addUsage: PipelineRunner.addUsage,
      restoreLostAuditIssues: (previous, next) => this.restoreLostAuditIssues(previous, next),
      analyzeAITells,
      analyzeSensitiveWords,
      logWarn: (message) => this.logWarn(pipelineLang, message),
      logStage: (message) => this.logStage(stageLanguage, message),
      minWholeChapterWords,
      logRewriteDecision: (message) => {
        const log = message.decision.accepted ? this.logInfo.bind(this) : this.logWarn.bind(this);
        log(pipelineLang, { zh: message.zh, en: message.en });
      },
    });
    totalUsage = reviewResult.totalUsage;
    let finalContent = reviewResult.finalContent;
    let finalWordCount = reviewResult.finalWordCount;
    let revised = reviewResult.revised;
    let auditResult = reviewResult.auditResult;
    const postReviseCount = reviewResult.postReviseCount;
    const normalizeApplied = reviewResult.normalizeApplied;
    this.config.logger?.child("writer")?.info(this.localize(pipelineLang, {
      zh: `阶段 1c：资源引擎校验（第${chapterNumber}章）`,
      en: `Phase 1c: resource engine check for chapter ${chapterNumber}`,
    }));
    let resourceConsistency = await this.runResourceConsistencyPass({
      bookId,
      bookDir,
      chapterNumber,
      content: finalContent,
      wordCount: finalWordCount,
      lengthSpec,
      language: pipelineLang,
      resourcePlan: writeInput.resourcePlan,
    });
    totalUsage = PipelineRunner.addUsage(totalUsage, resourceConsistency.tokenUsage);
    if (resourceConsistency.repaired) {
      finalContent = resourceConsistency.content;
      finalWordCount = resourceConsistency.wordCount;
      revised = true;
    }
    if (resourceConsistency.auditIssues.length > 0) {
      auditResult = {
        ...auditResult,
        issues: [...auditResult.issues, ...resourceConsistency.auditIssues],
      };
    }
    let resourceAuthoritySummary = resourceConsistency.validation.events.length > 0 && !resourceConsistency.blocking
      ? buildResourceAuthoritySummary({
          chapter: chapterNumber,
          validation: resourceConsistency.validation,
          status: resourceConsistency.status,
          recoveryPlan: resourceConsistency.fallbackRecoveryPlan ?? resourceConsistency.recoveryPlan,
        })
      : undefined;
    let cleanNarrativeResult: CleanNarrativeResult | undefined;
    {
      const storyDirForClean = join(bookDir, "story");
      const bookRules = await readFile(join(storyDirForClean, "book_rules.md"), "utf-8").catch(() => "");
      const currentLedger = await readFile(join(storyDirForClean, "particle_ledger.md"), "utf-8").catch(() => "");
      const currentState = await readFile(join(storyDirForClean, "current_state.md"), "utf-8").catch(() => "");
      const chapterIntent = await readFile(join(storyDirForClean, "runtime", "chapter-intents", `${String(chapterNumber).padStart(4, "0")}.md`), "utf-8").catch(() => "");
      cleanNarrativeResult = cleanNonNarrativeArtifacts(finalContent);
      if (cleanNarrativeResult.changed) {
        finalContent = cleanNarrativeResult.cleanedText;
        finalWordCount = countChapterLength(finalContent, lengthSpec.countingMode);
        revised = true;
        const validation = this.revalidateResourceConsistency({
          content: finalContent,
          bookRules,
          currentLedger,
          currentState,
          chapterIntent,
        });
        const classification = classifyResourceConsistency({
          validation,
          repaired: resourceConsistency.repaired,
        });
        resourceConsistency = {
          ...resourceConsistency,
          content: finalContent,
          wordCount: finalWordCount,
          validation,
          status: cleanNarrativeResult.blocking ? "FAILED" : classification.status,
          blocking: cleanNarrativeResult.blocking || classification.blocking,
          shouldPersistLedger: !cleanNarrativeResult.blocking && classification.shouldPersistLedger,
          shouldPersistStateResources: !cleanNarrativeResult.blocking && classification.shouldPersistStateResources,
          repaired: true,
        };
        auditResult = {
          ...auditResult,
          passed: auditResult.passed && !resourceConsistency.blocking,
          issues: [...auditResult.issues, {
            severity: resourceConsistency.blocking ? "critical" : "info",
            category: "clean-narrative",
            description: resourceConsistency.blocking
              ? "clean-narrative: 正文包含非正文草稿批注，需人工清理。"
              : "clean-narrative: 已清理正文中的非正文草稿批注。",
            suggestion: resourceConsistency.blocking
              ? "删除 LLM 自我纠错、提示词意图、资源计算草稿后再重新校验资源账本。"
              : "已删除非正文草稿批注，并重新执行 Resource Engine 校验。",
          }],
        };
        await this.writeCleanNarrativeReport({
          bookDir,
          chapterNumber,
          result: cleanNarrativeResult,
          status: resourceConsistency.blocking ? "FAILED" : "CLEANED",
          blocking: resourceConsistency.blocking,
        });
        await this.writeResourceConsistencyReport({
          bookDir,
          chapterNumber,
          validation: resourceConsistency.validation,
          status: resourceConsistency.status,
          blocking: resourceConsistency.blocking,
          closureStatus: resourceConsistency.closureStatus,
          recoveryAttempted: resourceConsistency.recoveryAttempted,
          recoveryPlan: resourceConsistency.recoveryPlan,
          secondValidation: resourceConsistency.secondValidation,
          recoveryPlanResult: resourceConsistency.recoveryPlanResult,
          fallbackRecoveryAttempted: resourceConsistency.fallbackRecoveryAttempted,
          fallbackRecoveryPlan: resourceConsistency.fallbackRecoveryPlan,
          fallbackSecondValidation: resourceConsistency.fallbackSecondValidation,
          templatePatchAttempted: resourceConsistency.templatePatchAttempted,
          templatePatchApplied: resourceConsistency.templatePatchApplied,
          templatePatchValidation: resourceConsistency.templatePatchValidation,
          templatePatchReason: resourceConsistency.templatePatchReason,
          removedCashFlowSnippets: resourceConsistency.removedCashFlowSnippets,
          balanceClaimPatchAttempted: resourceConsistency.balanceClaimPatchAttempted,
          balanceClaimPatchApplied: resourceConsistency.balanceClaimPatchApplied,
          balanceClaimPatchResource: resourceConsistency.balanceClaimPatchResource,
          balanceClaimPatchFrom: resourceConsistency.balanceClaimPatchFrom,
          balanceClaimPatchTo: resourceConsistency.balanceClaimPatchTo,
          balanceClaimPatchReason: resourceConsistency.balanceClaimPatchReason,
          filteredPseudoSkills: resourceConsistency.filteredPseudoSkills ?? detectFilteredPseudoSkills(finalContent),
          resourcePlan: writeInput.resourcePlan,
          resourcePlanViolations: writeInput.resourcePlan
            ? validateTextAgainstChapterResourcePlanFinal({
                text: finalContent,
                plan: writeInput.resourcePlan,
                validation: resourceConsistency.validation,
              }).violations
            : [],
        });
        resourceAuthoritySummary = resourceConsistency.validation.events.length > 0 && !resourceConsistency.blocking
          ? buildResourceAuthoritySummary({
              chapter: chapterNumber,
              validation: resourceConsistency.validation,
              status: resourceConsistency.status,
              recoveryPlan: resourceConsistency.fallbackRecoveryPlan ?? resourceConsistency.recoveryPlan,
            })
          : undefined;
      } else {
        cleanNarrativeResult = {
          ...cleanNarrativeResult,
          artifacts: detectNonNarrativeArtifacts(finalContent),
        };
      }
    }
    const cleanedFinalContent = stripNonProseArtifacts(finalContent);
    if (cleanedFinalContent !== finalContent.trim()) {
      finalContent = cleanedFinalContent;
      finalWordCount = countChapterLength(finalContent, lengthSpec.countingMode);
      this.logWarn(pipelineLang, {
        zh: `第${chapterNumber}章落盘前已清理非正文检查块，清理后字数=${finalWordCount}`,
        en: `Chapter ${chapterNumber}: removed non-prose check blocks before persistence; cleaned word count=${finalWordCount}`,
      });
    }
    const storyDir = join(bookDir, "story");
    {
      const bookRules = await readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => "");
      const currentLedger = await readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => "");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => "");
      const chapterIntent = await readFile(join(storyDir, "runtime", "chapter-intents", `${String(chapterNumber).padStart(4, "0")}.md`), "utf-8").catch(() => "");
      const deferPlan = [resourceConsistency.fallbackRecoveryPlan, resourceConsistency.recoveryPlan]
        .find((plan) => plan?.strategy === "defer_exchange");
      if (deferPlan && hasForbiddenResourceRecoveryPhrase(finalContent, deferPlan)) {
        this.config.logger?.child("writer")?.info("resource-engine: defer_exchange cash-flow detected in final candidate, applying template patch");
        const templateAttempt = this.tryDeferExchangeTemplatePatch({
          content: finalContent,
          bookRules,
          currentLedger,
          currentState,
          chapterIntent,
          recoveryPlan: deferPlan,
        });
        resourceConsistency = {
          ...resourceConsistency,
          validation: templateAttempt.validation,
          templatePatchAttempted: true,
          templatePatchApplied: templateAttempt.applied,
          templatePatchValidation: templateAttempt.validationPassed ? "PASS" : "FAILED",
          templatePatchReason: templateAttempt.reason,
          removedCashFlowSnippets: templateAttempt.removedSnippets,
          balanceClaimPatchAttempted: templateAttempt.balanceClaimPatchAttempted,
          balanceClaimPatchApplied: templateAttempt.balanceClaimPatchApplied,
          balanceClaimPatchResource: templateAttempt.balanceClaimPatchResource,
          balanceClaimPatchFrom: templateAttempt.balanceClaimPatchFrom,
          balanceClaimPatchTo: templateAttempt.balanceClaimPatchTo,
          balanceClaimPatchReason: templateAttempt.balanceClaimPatchReason,
          filteredPseudoSkills: detectFilteredPseudoSkills(templateAttempt.content),
        };
        const finalClosureClassification = classifyResourceConsistency({
          validation: templateAttempt.validation,
          repaired: templateAttempt.validationPassed || resourceConsistency.repaired,
        });
        if (templateAttempt.validationPassed) {
          finalContent = templateAttempt.content;
          finalWordCount = countChapterLength(finalContent, lengthSpec.countingMode);
          revised = true;
          resourceConsistency = {
            ...resourceConsistency,
            content: finalContent,
            wordCount: finalWordCount,
            status: finalClosureClassification.status,
            blocking: finalClosureClassification.blocking,
            shouldPersistLedger: finalClosureClassification.shouldPersistLedger,
            shouldPersistStateResources: finalClosureClassification.shouldPersistStateResources,
            repaired: true,
          };
          auditResult = {
            ...auditResult,
            issues: [...auditResult.issues, {
              severity: "info",
              category: "resource-consistency",
              description: "resource-consistency: defer_exchange 模板 patch 已删除本章现金兑现，资源链恢复自洽。",
              suggestion: "已按程序模板延后现金兑换，仍建议检查 resource-consistency report。",
            }],
          };
          this.config.logger?.child("writer")?.info("resource-engine: template patch validation passed");
          resourceAuthoritySummary = resourceConsistency.validation.events.length > 0 && !resourceConsistency.blocking
            ? buildResourceAuthoritySummary({
                chapter: chapterNumber,
                validation: resourceConsistency.validation,
                status: resourceConsistency.status,
                recoveryPlan: resourceConsistency.fallbackRecoveryPlan ?? resourceConsistency.recoveryPlan ?? deferPlan,
              })
            : undefined;
        } else {
          resourceConsistency = {
            ...resourceConsistency,
            status: "FAILED",
            blocking: true,
            shouldPersistLedger: false,
            shouldPersistStateResources: false,
          };
          auditResult = {
            ...auditResult,
            passed: false,
            issues: [...auditResult.issues, {
              severity: "critical",
              category: "resource-consistency",
              description: "resource-consistency: defer_exchange 现金流仍未闭合，程序模板 patch 未能修复。",
              suggestion: "人工删除本章现金到账/兑换段落，或重写本章资源链；修复前不要基于本章继续续写。",
            }],
          };
          this.config.logger?.child("writer")?.warn("resource-engine: defer_exchange cash-flow remained after template patch");
          resourceAuthoritySummary = undefined;
        }
        await this.writeResourceConsistencyReport({
          bookDir,
          chapterNumber,
          validation: resourceConsistency.validation,
          status: resourceConsistency.status,
          blocking: resourceConsistency.blocking,
          closureStatus: resourceConsistency.closureStatus,
          recoveryAttempted: resourceConsistency.recoveryAttempted,
          recoveryPlan: resourceConsistency.recoveryPlan,
          secondValidation: resourceConsistency.secondValidation,
          recoveryPlanResult: resourceConsistency.recoveryPlanResult,
          fallbackRecoveryAttempted: resourceConsistency.fallbackRecoveryAttempted,
          fallbackRecoveryPlan: resourceConsistency.fallbackRecoveryPlan ?? deferPlan,
          fallbackSecondValidation: resourceConsistency.fallbackSecondValidation,
          templatePatchAttempted: resourceConsistency.templatePatchAttempted,
          templatePatchApplied: resourceConsistency.templatePatchApplied,
          templatePatchValidation: resourceConsistency.templatePatchValidation,
          templatePatchReason: resourceConsistency.templatePatchReason,
          removedCashFlowSnippets: resourceConsistency.removedCashFlowSnippets,
          balanceClaimPatchAttempted: resourceConsistency.balanceClaimPatchAttempted,
          balanceClaimPatchApplied: resourceConsistency.balanceClaimPatchApplied,
          balanceClaimPatchResource: resourceConsistency.balanceClaimPatchResource,
          balanceClaimPatchFrom: resourceConsistency.balanceClaimPatchFrom,
          balanceClaimPatchTo: resourceConsistency.balanceClaimPatchTo,
          balanceClaimPatchReason: resourceConsistency.balanceClaimPatchReason,
          filteredPseudoSkills: resourceConsistency.filteredPseudoSkills ?? detectFilteredPseudoSkills(finalContent),
          resourcePlan: writeInput.resourcePlan,
          resourcePlanViolations: writeInput.resourcePlan
            ? validateTextAgainstChapterResourcePlanFinal({
                text: finalContent,
                plan: writeInput.resourcePlan,
                validation: resourceConsistency.validation,
              }).violations
            : [],
        });
      }
    }
    const settlementBlocker = this.buildStateSettlementBlocker({
      chapterNumber,
      wordCount: finalWordCount,
      minWholeChapterWords,
      postWriteErrors: output.postWriteErrors,
      enforceLength: finalWordCount >= 100 && (output.postWriteErrors.length > 0 || output.postWriteWarnings.length > 0),
      language: pipelineLang,
    });
    if (settlementBlocker) {
      return this.buildFailedWriteResult({
        chapterNumber,
        title: output.title,
        wordCount: finalWordCount,
        issue: settlementBlocker,
        revised,
        tokenUsage: totalUsage,
        lengthSpec,
        writerCount,
        postWriterNormalizeCount: reviewResult.preAuditNormalizedWordCount,
        postReviseCount,
        normalizeApplied,
        ...(retryHint ? { writeRetryHint: retryHint.report } : {}),
      });
    }

    // 4. Save the final chapter and truth files from a single persistence source
    this.logStage(stageLanguage, { zh: "落盘最终章节", en: "persisting final chapter" });
    this.logStage(stageLanguage, { zh: "生成最终真相文件", en: "rebuilding final truth files" });
    const chapterIndexBeforePersist = await this.state.loadChapterIndex(bookId);
    const { resolveDuplicateTitle } = await import("../agents/post-write-validator.js");
    const { assertFinalTitleAllowed, enforceFinalTitleAnchorGuard } = await import("../utils/chapter-title-engine.js");
    const existingChapterTitles = chapterIndexBeforePersist.map((chapter) => chapter.title);
    const initialTitleResolution = resolveDuplicateTitle(
      output.title,
      existingChapterTitles,
      pipelineLang,
      { content: finalContent },
    );
    let persistenceOutput = await this.buildPersistenceOutput(
      bookId,
      book,
      bookDir,
      chapterNumber,
      initialTitleResolution.title === output.title
        ? output
        : { ...output, title: initialTitleResolution.title },
      finalContent,
      lengthSpec.countingMode,
      reducedControlInput,
      resourceAuthoritySummary,
    );
    const preferredTitleBeforeFinalizer = persistenceOutput.title;
    const finalTitleResolution = resolveDuplicateTitle(
      persistenceOutput.title,
      existingChapterTitles,
      pipelineLang,
      { content: finalContent },
    );
    const finalTitleCandidate = finalTitleResolution.title !== persistenceOutput.title
      ? finalTitleResolution.title
      : persistenceOutput.title;
    const FINAL_TITLE = enforceFinalTitleAnchorGuard({
      language: pipelineLang,
      finalTitle: finalTitleCandidate,
      fallbackTitle: preferredTitleBeforeFinalizer,
      recentTitles: existingChapterTitles,
    });
    assertFinalTitleAllowed({
      language: pipelineLang,
      finalTitle: FINAL_TITLE,
      recentTitles: existingChapterTitles,
    });
    const frozenFinalTitle = Object.freeze({ title: FINAL_TITLE });
    persistenceOutput = {
      ...persistenceOutput,
      title: frozenFinalTitle.title,
    };
    resourceConsistency = {
      ...resourceConsistency,
      validation: this.revalidateResourceConsistency({
        content: finalContent,
        validation: resourceConsistency.validation,
        bookRules: await readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => ""),
        currentLedger: await readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => ""),
        currentState: await readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
        chapterIntent: await readFile(join(storyDir, "runtime", "chapter-intents", `${String(chapterNumber).padStart(4, "0")}.md`), "utf-8").catch(() => ""),
      }),
    };
    const finalResourceClassification = classifyResourceConsistency({
      validation: resourceConsistency.validation,
      repaired: resourceConsistency.repaired,
    });
    const finalResourcePlanValidation = validateTextAgainstChapterResourcePlanFinal({
      text: finalContent,
      plan: writeInput.resourcePlan,
      validation: resourceConsistency.validation,
    });
    if (!finalResourcePlanValidation.passed) {
      this.config.logger?.child("writer")?.warn(`final resource-plan validation failed: ${finalResourcePlanValidation.violations.join("；")}`);
      auditResult = {
        ...auditResult,
        passed: false,
        issues: [
          ...auditResult.issues,
          ...buildResourcePlanAuditIssues(finalResourcePlanValidation.violations),
        ],
      };
    } else if (writeInput.resourcePlan && writeInput.resourcePlan.mode !== "no_resource_change") {
      resourceConsistency = {
        ...resourceConsistency,
        validation: applyResourcePlanExpectedBalances(resourceConsistency.validation, writeInput.resourcePlan),
        resourcePlanViolations: [],
      };
      this.config.logger?.child("writer")?.info("final resource-plan validation passed");
    }
    resourceConsistency = {
      ...resourceConsistency,
      status: finalResourcePlanValidation.passed ? finalResourceClassification.status : "FAILED",
      blocking: finalResourceClassification.blocking || !finalResourcePlanValidation.passed,
      shouldPersistLedger: finalResourcePlanValidation.passed && finalResourceClassification.shouldPersistLedger,
      shouldPersistStateResources: finalResourcePlanValidation.passed && finalResourceClassification.shouldPersistStateResources,
      resourcePlanViolations: finalResourcePlanValidation.violations,
    };
    if (resourceConsistency.validation.events.length > 0 && resourceConsistency.shouldPersistLedger) {
      persistenceOutput = {
        ...persistenceOutput,
        updatedLedger: buildResourceLedgerUpdate({
          chapterNumber,
          currentLedger: await readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => ""),
          validation: resourceConsistency.validation,
          resourcePlan: writeInput.resourcePlan,
        }),
        updatedState: resourceConsistency.shouldPersistStateResources ? syncCurrentStateResources({
          currentState: persistenceOutput.updatedState,
          validation: resourceConsistency.validation,
          resourcePlan: writeInput.resourcePlan,
        }) : persistenceOutput.updatedState,
      };
      this.config.logger?.child("writer")?.info("resource-engine: particle_ledger.md updated");
    } else if (resourceConsistency.validation.events.length > 0 && resourceConsistency.blocking) {
      this.config.logger?.child("writer")?.warn("resource-engine: skipped particle_ledger update to avoid pollution");
    }
    await this.writeResourceConsistencyReport({
      bookDir,
      chapterNumber,
      validation: resourceConsistency.validation,
      status: resourceConsistency.status,
      blocking: resourceConsistency.blocking,
      closureStatus: resourceConsistency.closureStatus,
      recoveryAttempted: resourceConsistency.recoveryAttempted,
      recoveryPlan: resourceConsistency.recoveryPlan,
      secondValidation: resourceConsistency.secondValidation,
      recoveryPlanResult: resourceConsistency.recoveryPlanResult,
      fallbackRecoveryAttempted: resourceConsistency.fallbackRecoveryAttempted,
      fallbackRecoveryPlan: resourceConsistency.fallbackRecoveryPlan,
      fallbackSecondValidation: resourceConsistency.fallbackSecondValidation,
      templatePatchAttempted: resourceConsistency.templatePatchAttempted,
      templatePatchApplied: resourceConsistency.templatePatchApplied,
      templatePatchValidation: resourceConsistency.templatePatchValidation,
      templatePatchReason: resourceConsistency.templatePatchReason,
      removedCashFlowSnippets: resourceConsistency.removedCashFlowSnippets,
      balanceClaimPatchAttempted: resourceConsistency.balanceClaimPatchAttempted,
      balanceClaimPatchApplied: resourceConsistency.balanceClaimPatchApplied,
      balanceClaimPatchResource: resourceConsistency.balanceClaimPatchResource,
      balanceClaimPatchFrom: resourceConsistency.balanceClaimPatchFrom,
      balanceClaimPatchTo: resourceConsistency.balanceClaimPatchTo,
      balanceClaimPatchReason: resourceConsistency.balanceClaimPatchReason,
      filteredPseudoSkills: resourceConsistency.filteredPseudoSkills ?? detectFilteredPseudoSkills(finalContent),
      resourcePlan: writeInput.resourcePlan,
      resourcePlanViolations: finalResourcePlanValidation.violations,
    });
    if (frozenFinalTitle.title !== output.title) {
      const description = pipelineLang === "en"
        ? `Chapter title "${output.title}" was auto-adjusted to "${frozenFinalTitle.title}".`
        : `章节标题"${output.title}"已自动调整为"${frozenFinalTitle.title}"。`;
      this.config.logger?.warn(`[title] ${description}`);
      auditResult = {
        ...auditResult,
        issues: [...auditResult.issues, {
          severity: "warning",
          category: "title-dedup",
          description,
          suggestion: pipelineLang === "en"
            ? "If the auto-renamed title is weak, revise the chapter title manually."
            : "如果自动改名不理想，可以在后续手动修订章节标题。",
        }],
      };
    }
    const longSpanFatigue = await analyzeLongSpanFatigue({
      bookDir,
      chapterNumber,
      chapterContent: finalContent,
      chapterSummary: persistenceOutput.chapterSummary,
      language: pipelineLang,
    });
    auditResult = {
      ...auditResult,
      issues: [
        ...auditResult.issues,
        ...longSpanFatigue.issues,
        ...(persistenceOutput.hookHealthIssues ?? []),
      ],
    };
    finalWordCount = persistenceOutput.wordCount;
    const lengthWarnings = this.buildLengthWarnings(
      chapterNumber,
      finalWordCount,
      lengthSpec,
    );
    const lengthTelemetry = this.buildLengthTelemetry({
      lengthSpec,
      writerCount,
      postWriterNormalizeCount: reviewResult.preAuditNormalizedWordCount,
      postReviseCount,
      finalCount: finalWordCount,
      normalizeApplied,
      lengthWarning: lengthWarnings.length > 0,
    });
    this.logLengthWarnings(lengthWarnings);

    // 4.1 Validate settler output before writing
    this.logStage(stageLanguage, { zh: "校验真相文件变更", en: "validating truth file updates" });
    const [oldState, oldHooks, oldLedger] = await Promise.all([
      readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => ""),
    ]);
    const validator = new StateValidatorAgent(this.agentCtxFor("state-validator", bookId));
    const truthValidation = await validateChapterTruthPersistence({
      writer,
      validator,
      book,
      bookDir,
      chapterNumber,
      title: frozenFinalTitle.title,
      content: finalContent,
      persistenceOutput,
      auditResult,
      previousTruth: {
        oldState,
        oldHooks,
        oldLedger,
      },
      reducedControlInput,
      language: pipelineLang,
      logWarn: (message) => this.logWarn(pipelineLang, message),
      logger: this.config.logger,
    });
    let chapterStatus: ChapterPipelineResult["status"] | null = truthValidation.chapterStatus;
    let degradedIssues: ReadonlyArray<AuditIssue> = truthValidation.degradedIssues;
    if (truthValidation.persistenceOutput.title !== frozenFinalTitle.title) {
      throw new Error(
        pipelineLang === "en"
          ? `FINAL_TITLE mutated after freeze: expected "${frozenFinalTitle.title}", received "${truthValidation.persistenceOutput.title}"`
          : `FINAL_TITLE 在 freeze 后被改写：期望“${frozenFinalTitle.title}”，实际得到“${truthValidation.persistenceOutput.title}”`,
      );
    }
    persistenceOutput = {
      ...truthValidation.persistenceOutput,
      title: frozenFinalTitle.title,
    };
    auditResult = truthValidation.auditResult;
    assertFinalTitleAllowed({
      language: pipelineLang,
      finalTitle: frozenFinalTitle.title,
      recentTitles: existingChapterTitles,
    });

    // 4.2 Final paragraph shape check on persisted content (post-normalize, post-revise)
    {
      const {
        detectParagraphLengthDrift,
        detectParagraphShapeWarnings,
      } = await import("../agents/post-write-validator.js");
      const chapDir = join(bookDir, "chapters");
      const recentFiles = (await readdir(chapDir).catch(() => [] as string[]))
        .filter((f) => f.endsWith(".md") && /^\d{4}/.test(f))
        .sort()
        .slice(-5);
      const recentContent = (await Promise.all(
        recentFiles.map((f) => readFile(join(chapDir, f), "utf-8").catch(() => "")),
      )).join("\n\n");
      const paragraphIssues = [
        ...detectParagraphShapeWarnings(finalContent, pipelineLang),
        ...detectParagraphLengthDrift(finalContent, recentContent, pipelineLang),
      ];
      if (paragraphIssues.length > 0) {
        for (const issue of paragraphIssues) {
          this.config.logger?.warn(`[paragraph] ${issue.description}`);
        }
        auditResult = {
          ...auditResult,
          issues: [...auditResult.issues, ...paragraphIssues.map((v) => ({
            severity: v.severity as "warning",
            category: "paragraph-shape",
            description: v.description,
            suggestion: v.suggestion,
          }))],
        };
      }
    }

    this.logStage(stageLanguage, { zh: "章节意图一致性审核", en: "reviewing chapter intent alignment" });
    const intentAlignmentReport = await this.runIntentAlignmentReview({
      bookId,
      bookDir,
      chapterNumber,
      finalTitle: frozenFinalTitle.title,
      finalContent,
      storyDir,
      language: pipelineLang,
      resourceBlocking: resourceConsistency.blocking,
      resourcePlan: writeInput.resourcePlan,
    });
    this.config.logger?.info(
      `Intent alignment: ${intentAlignmentReport.score ?? "N/A"}/100 ${intentAlignmentReport.status}`,
    );
    const reportableIntentIssues = intentAlignmentReport.issues.filter(
      (issue) => intentAlignmentReport.status === "WARN" || intentAlignmentReport.status === "FAIL_REPORT_ONLY"
        ? issue.severity === "warning" || issue.severity === "critical"
        : false,
    );
    if (reportableIntentIssues.length > 0) {
      this.logWarn(pipelineLang, {
        zh: `Intent alignment: 第${chapterNumber}章发现 ${reportableIntentIssues.length} 条警告`,
        en: `Intent alignment: chapter ${chapterNumber} found ${reportableIntentIssues.length} warning(s)`,
      });
      auditResult = {
        ...auditResult,
        issues: [
          ...auditResult.issues,
          ...reportableIntentIssues.map((issue) => ({
            severity: issue.severity,
            category: `intent-alignment:${issue.dimension}`,
            description: issue.message,
            suggestion: issue.suggestion ?? "人工检查 chapter_intent 与最终正文的一致性；本轮只报告不自动重写。",
          })),
        ],
      };
    }

    this.logStage(stageLanguage, { zh: "故事有效性审核", en: "reviewing story effectiveness" });
    const storyEffectivenessReport = await this.runStoryEffectivenessReview({
      bookId,
      bookDir,
      chapterNumber,
      finalTitle: frozenFinalTitle.title,
      finalContent,
      storyDir,
      language: pipelineLang,
      resourceBlocking: resourceConsistency.blocking,
      chapterIndexStatus: chapterStatus ?? undefined,
    });
    this.config.logger?.info(
      `Story effectiveness: ${storyEffectivenessReport.score ?? "N/A"}/100 ${storyEffectivenessReport.status}`,
    );

    // Golden 3-chapter review: only for ch1-3 with incremental update
    if (chapterNumber >= 1 && chapterNumber <= 3) {
      this.logStage(stageLanguage, { zh: "前三章开篇审核", en: "reviewing golden 3-chapter opening" });
      const golden3Report = await this.runGolden3ChapterReview({
        bookId,
        bookDir,
        chapterNumber,
        language: pipelineLang,
        resourceBlocking: resourceConsistency.blocking,
        chapterIndexStatus: chapterStatus ?? undefined,
      });
      this.config.logger?.info(
        `Golden 3-chapter: ${golden3Report.score ?? "N/A"}/100 ${golden3Report.status}`,
      );
    }

    // Opening-hook review: all chapters
    this.logStage(stageLanguage, { zh: "开头钩子审核", en: "reviewing opening hook" });
    const openingHookReport = await this.runOpeningHookReview({
      bookId,
      bookDir,
      chapterNumber,
      chapterContent: finalContent,
      chapterTitle: frozenFinalTitle.title,
      language: pipelineLang,
      resourceBlocking: resourceConsistency.blocking,
      chapterIndexStatus: chapterStatus ?? undefined,
    });
    this.config.logger?.info(
      `Opening hook: ${openingHookReport.score ?? "N/A"}/100 ${openingHookReport.status}`,
    );

    // Antagonist-intelligence review: all chapters
    this.logStage(stageLanguage, { zh: "反派智能审核", en: "reviewing antagonist intelligence" });
    const antagonistIntelReport = await this.runAntagonistIntelligenceReview({
      bookId,
      bookDir,
      chapterNumber,
      finalContent,
      storyDir,
      language: pipelineLang,
      resourceBlocking: resourceConsistency.blocking,
      chapterIndexStatus: chapterStatus ?? undefined,
    });
    this.config.logger?.info(
      `Antagonist intelligence: ${antagonistIntelReport.score ?? "N/A"}/100 ${antagonistIntelReport.status}`,
    );

    const resourceIndexGuard = detectResourceIndexReadinessBlocker({
      auditIssues: auditResult.issues,
      updatedState: persistenceOutput.updatedState,
      resourceBlocking: resourceConsistency.blocking,
    });
    if (resourceIndexGuard) {
      auditResult = {
        ...auditResult,
        passed: false,
        issues: auditResult.issues.some((issue) => issue.category === "resource-consistency" && issue.description.includes("RESOURCE_CONSISTENCY_NOT_CLOSED"))
          ? auditResult.issues
          : [...auditResult.issues, {
              severity: "critical",
              category: "resource-consistency",
              description: `RESOURCE_CONSISTENCY_NOT_CLOSED: ${resourceIndexGuard.reason}`,
              suggestion: "资源账本闭合前不得标记 ready-for-review；请修复正文资源链或重写本章。",
            }],
      };
      const hasResourcePlanViolation = (resourceConsistency.resourcePlanViolations?.length ?? 0) > 0
        || auditResult.issues.some((issue) => issue.category === "resource-plan");
      chapterStatus = hasResourcePlanViolation ? "blocked-resource-plan" : "state-degraded";
      degradedIssues = [
        ...degradedIssues,
        {
          severity: "critical",
          category: "resource-consistency",
          description: `RESOURCE_CONSISTENCY_NOT_CLOSED: ${resourceIndexGuard.reason}`,
          suggestion: "资源账本闭合前不得标记 ready-for-review；请修复正文资源链或重写本章。",
        },
      ];
      this.config.logger?.child("writer")?.warn(`resource-engine: final resource closure guard forced ${chapterStatus}`);
    }

    if (resourceConsistency.blocking || resourceIndexGuard) {
      const hasResourcePlanViolation = (resourceConsistency.resourcePlanViolations?.length ?? 0) > 0
        || auditResult.issues.some((issue) => issue.category === "resource-plan");
      chapterStatus = hasResourcePlanViolation ? "blocked-resource-plan" : "state-degraded";
      persistenceOutput = {
        ...persistenceOutput,
        updatedState: oldState,
        updatedHooks: oldHooks,
        updatedLedger: oldLedger,
      };
      degradedIssues = [
        ...degradedIssues,
        ...resourceConsistency.auditIssues.filter((issue) => issue.severity === "critical" || issue.severity === "warning"),
      ];
      auditResult = { ...auditResult, passed: false };
    }
    const resolvedStatus = chapterStatus ?? (auditResult.passed ? "ready-for-review" : "audit-failed");
    await persistChapterArtifacts({
      chapterNumber,
      chapterTitle: frozenFinalTitle.title,
      status: resolvedStatus,
      auditResult,
      finalWordCount,
      lengthWarnings,
      lengthTelemetry,
      degradedIssues,
      tokenUsage: totalUsage,
      loadChapterIndex: () => this.state.loadChapterIndex(bookId),
      saveChapter: () => writer.saveChapter(bookDir, { ...persistenceOutput, title: frozenFinalTitle.title }, gp.numericalSystem, pipelineLang),
      saveTruthFiles: async () => {
        const frozenPersistenceOutput = { ...persistenceOutput, title: frozenFinalTitle.title };
        await writer.saveNewTruthFiles(bookDir, frozenPersistenceOutput, pipelineLang);
        await this.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, frozenPersistenceOutput);
        this.logStage(stageLanguage, { zh: "同步记忆索引", en: "syncing memory indexes" });
        await this.syncNarrativeMemoryIndex(bookId, chapterNumber);
      },
      saveChapterIndex: (index) => this.state.saveChapterIndex(bookId, index),
      markBookActiveIfNeeded: () => this.markBookActiveIfNeeded(bookId),
      persistAuditDriftGuidance: (issues) => this.persistAuditDriftGuidance({
        bookDir,
        chapterNumber,
        issues,
        language: stageLanguage,
      }).catch(() => undefined),
      snapshotState: () => this.state.snapshotState(bookId, chapterNumber),
      syncCurrentStateFactHistory: () => this.syncCurrentStateFactHistory(bookId, chapterNumber),
      logSnapshotStage: () =>
        this.logStage(stageLanguage, { zh: "更新章节索引与快照", en: "updating chapter index and snapshots" }),
    });

    // 6. Send notification
    if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
      const statusEmoji = resolvedStatus === "state-degraded" || resolvedStatus === "blocked-resource-plan"
        ? "🧯"
        : auditResult.passed ? "✅" : "⚠️";
      const chapterLength = formatLengthCount(finalWordCount, lengthSpec.countingMode);
      await dispatchNotification(this.config.notifyChannels, {
        title: `${statusEmoji} ${book.title} 第${chapterNumber}章`,
        body: [
          `**${frozenFinalTitle.title}** | ${chapterLength}`,
          revised ? "📝 已自动修正" : "",
          resolvedStatus === "state-degraded" || resolvedStatus === "blocked-resource-plan"
            ? "状态结算: 已阻断 truth files 更新，需先修复资源/状态再继续"
            : `审稿: ${auditResult.passed ? "通过" : "需人工审核"}`,
          ...auditResult.issues
            .filter((i) => i.severity !== "info")
            .map((i) => `- [${i.severity}] ${i.description}`),
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }

    await this.emitWebhook("pipeline-complete", bookId, chapterNumber, {
      title: frozenFinalTitle.title,
      wordCount: finalWordCount,
      passed: auditResult.passed,
      revised,
      status: resolvedStatus,
    });

    return {
      chapterNumber,
      title: frozenFinalTitle.title,
      wordCount: finalWordCount,
      auditResult,
      revised,
      status: resolvedStatus,
      lengthWarnings,
      lengthTelemetry,
      tokenUsage: totalUsage,
      ...(retryHint ? { writeRetryHint: { ...retryHint.report, consumed: true } } : {}),
    };
  }

  private async _repairChapterStateLocked(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const stageLanguage = await this.resolveBookLanguage(book);
    const index = [...(await this.state.loadChapterIndex(bookId))];
    if (index.length === 0) {
      throw new Error(`Book "${bookId}" has no persisted chapters to repair.`);
    }

    const targetChapter = chapterNumber ?? index[index.length - 1]!.number;
    const targetIndex = index.findIndex((chapter) => chapter.number === targetChapter);
    if (targetIndex < 0) {
      throw new Error(`Chapter ${targetChapter} not found in "${bookId}".`);
    }
    const targetMeta = index[targetIndex]!;
    const latestChapter = Math.max(...index.map((chapter) => chapter.number));
    if (targetMeta.status !== "state-degraded") {
      throw new Error(`Chapter ${targetChapter} is not state-degraded.`);
    }
    if (targetChapter !== latestChapter) {
      throw new Error(`Only the latest state-degraded chapter can be repaired safely (latest is ${latestChapter}).`);
    }

    this.logStage(stageLanguage, { zh: "修复章节状态结算", en: "repairing chapter state settlement" });
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const pipelineLang = book.language ?? gp.language;
    const content = await this.readChapterContent(bookDir, targetChapter);
    const storyDir = join(bookDir, "story");
    const [oldState, oldHooks] = await Promise.all([
      readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
    ]);

    const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
    let repairedOutput = await writer.settleChapterState({
      book,
      bookDir,
      chapterNumber: targetChapter,
      title: targetMeta.title,
      content,
      allowReapply: true,
    });
    const validator = new StateValidatorAgent(this.agentCtxFor("state-validator", bookId));
    let validation = await validator.validate(
      content,
      targetChapter,
      oldState,
      repairedOutput.updatedState,
      oldHooks,
      repairedOutput.updatedHooks,
      pipelineLang,
    );

    if (!validation.passed) {
      const recovery = await retrySettlementAfterValidationFailure({
        writer,
        validator,
        book,
        bookDir,
        chapterNumber: targetChapter,
        title: targetMeta.title,
        content,
        oldState,
        oldHooks,
        originalValidation: validation,
        language: pipelineLang,
        logWarn: (message) => this.logWarn(pipelineLang, message),
        logger: this.config.logger,
      });
      if (recovery.kind !== "recovered") {
        throw new Error(
          recovery.issues[0]?.description
            ?? `State repair still failed for chapter ${targetChapter}.`,
        );
      }
      repairedOutput = recovery.output;
      validation = recovery.validation;
    }

    if (!validation.passed) {
      throw new Error(`State repair still failed for chapter ${targetChapter}.`);
    }

    await writer.saveChapter(bookDir, repairedOutput, gp.numericalSystem, pipelineLang);
    await writer.saveNewTruthFiles(bookDir, repairedOutput, pipelineLang);
    await this.syncLegacyStructuredStateFromMarkdown(bookDir, targetChapter, repairedOutput);
    await this.syncNarrativeMemoryIndex(bookId, targetChapter);
    await this.state.snapshotState(bookId, targetChapter);
    await this.syncCurrentStateFactHistory(bookId, targetChapter);

    const baseStatus = resolveStateDegradedBaseStatus(targetMeta);
    const degradedMetadata = parseStateDegradedReviewNote(targetMeta.reviewNote);
    const injectedIssues = new Set(degradedMetadata?.injectedIssues ?? []);
    index[targetIndex] = {
      ...targetMeta,
      status: baseStatus,
      updatedAt: new Date().toISOString(),
      auditIssues: targetMeta.auditIssues.filter((issue) => !injectedIssues.has(issue)),
      reviewNote: undefined,
    };
    await this.state.saveChapterIndex(bookId, index);

    const repairedPassesAudit = baseStatus !== "audit-failed";
    return {
      chapterNumber: targetChapter,
      title: targetMeta.title,
      wordCount: targetMeta.wordCount,
      auditResult: {
        passed: repairedPassesAudit,
        issues: [],
        summary: repairedPassesAudit ? "state repaired" : "state repaired but chapter still needs review",
      },
      revised: false,
      status: baseStatus,
      lengthWarnings: targetMeta.lengthWarnings,
      lengthTelemetry: targetMeta.lengthTelemetry,
      tokenUsage: targetMeta.tokenUsage,
    };
  }

  private async _resyncChapterArtifactsLocked(bookId: string, chapterNumber?: number): Promise<ChapterPipelineResult> {
    const book = await this.state.loadBookConfig(bookId);
    const bookDir = this.state.bookDir(bookId);
    const stageLanguage = await this.resolveBookLanguage(book);
    const index = [...(await this.state.loadChapterIndex(bookId))];
    if (index.length === 0) {
      throw new Error(`Book "${bookId}" has no persisted chapters to sync.`);
    }

    const targetChapter = chapterNumber ?? index[index.length - 1]!.number;
    const targetIndex = index.findIndex((chapter) => chapter.number === targetChapter);
    if (targetIndex < 0) {
      throw new Error(`Chapter ${targetChapter} not found in "${bookId}".`);
    }

    const targetMeta = index[targetIndex]!;
    const latestChapter = Math.max(...index.map((chapter) => chapter.number));
    if (targetChapter !== latestChapter) {
      throw new Error(`Only the latest persisted chapter can be synced safely (latest is ${latestChapter}).`);
    }

    this.logStage(stageLanguage, { zh: "根据已编辑正文同步真相文件与索引", en: "syncing truth files and indexes from edited chapter body" });
    const { profile: gp } = await this.loadGenreProfile(book.genre);
    const pipelineLang = book.language ?? gp.language;
    const content = await this.readChapterContent(bookDir, targetChapter);
    const storyDir = join(bookDir, "story");
    const [oldState, oldHooks] = await Promise.all([
      readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
    ]);

    const reducedControlInput = (this.config.inputGovernanceMode ?? "v2") === "legacy"
      ? undefined
      : await this.createGovernedArtifacts(
        book,
        bookDir,
        targetChapter,
        this.config.externalContext,
        { reuseExistingIntentWhenContextMissing: true, skipPlanningValidation: true },
      );

    const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
    let syncedOutput = await writer.settleChapterState({
      book,
      bookDir,
      chapterNumber: targetChapter,
      title: targetMeta.title,
      content,
      chapterIntent: reducedControlInput?.plan.intentMarkdown,
      contextPackage: reducedControlInput?.composed.contextPackage,
      ruleStack: reducedControlInput?.composed.ruleStack,
      allowReapply: true,
    });
    const validator = new StateValidatorAgent(this.agentCtxFor("state-validator", bookId));
    let validation = await validator.validate(
      content,
      targetChapter,
      oldState,
      syncedOutput.updatedState,
      oldHooks,
      syncedOutput.updatedHooks,
      pipelineLang,
    );

    if (!validation.passed) {
      const recovery = await retrySettlementAfterValidationFailure({
        writer,
        validator,
        book,
        bookDir,
        chapterNumber: targetChapter,
        title: targetMeta.title,
        content,
        reducedControlInput: reducedControlInput
          ? {
              chapterIntent: reducedControlInput.plan.intentMarkdown,
              contextPackage: reducedControlInput.composed.contextPackage,
              ruleStack: reducedControlInput.composed.ruleStack,
            }
          : undefined,
        oldState,
        oldHooks,
        originalValidation: validation,
        language: pipelineLang,
        logWarn: (message) => this.logWarn(pipelineLang, message),
        logger: this.config.logger,
      });
      if (recovery.kind !== "recovered") {
        throw new Error(
          recovery.issues[0]?.description
            ?? `Chapter sync still failed for chapter ${targetChapter}.`,
        );
      }
      syncedOutput = recovery.output;
      validation = recovery.validation;
    }

    if (!validation.passed) {
      throw new Error(`Chapter sync still failed for chapter ${targetChapter}.`);
    }

    await writer.saveChapter(bookDir, syncedOutput, gp.numericalSystem, pipelineLang);
    await writer.saveNewTruthFiles(bookDir, syncedOutput, pipelineLang);
    await this.syncLegacyStructuredStateFromMarkdown(bookDir, targetChapter, syncedOutput);
    await this.syncNarrativeMemoryIndex(bookId, targetChapter);
    await this.state.snapshotState(bookId, targetChapter);
    await this.syncCurrentStateFactHistory(bookId, targetChapter);

    const finalStatus: ChapterMeta["status"] = targetMeta.status === "state-degraded"
      ? resolveStateDegradedBaseStatus(targetMeta)
      : targetMeta.status;

    if (targetMeta.status === "state-degraded") {
      const degradedMetadata = parseStateDegradedReviewNote(targetMeta.reviewNote);
      const injectedIssues = new Set(degradedMetadata?.injectedIssues ?? []);
      index[targetIndex] = {
        ...targetMeta,
        status: finalStatus,
        updatedAt: new Date().toISOString(),
        auditIssues: targetMeta.auditIssues.filter((issue) => !injectedIssues.has(issue)),
        reviewNote: undefined,
      };
    } else {
      index[targetIndex] = {
        ...targetMeta,
        status: finalStatus,
        updatedAt: new Date().toISOString(),
      };
    }
    await this.state.saveChapterIndex(bookId, index);
    return {
      chapterNumber: targetChapter,
      title: targetMeta.title,
      wordCount: targetMeta.wordCount,
      auditResult: {
        passed: finalStatus !== "audit-failed",
        issues: [],
        summary: finalStatus === "audit-failed"
          ? "chapter truth/state resynced from edited body, but chapter still needs audit fixes"
          : "chapter truth/state resynced from edited body",
      },
      revised: false,
      status: finalStatus,
      lengthWarnings: targetMeta.lengthWarnings,
      lengthTelemetry: targetMeta.lengthTelemetry,
      tokenUsage: targetMeta.tokenUsage,
    };
  }

  // ---------------------------------------------------------------------------
  // Import operations (style imitation + canon for spinoff)
  // ---------------------------------------------------------------------------

  /**
   * Generate a qualitative style guide from reference text via LLM.
   * Also saves the statistical style_profile.json.
   */
  async generateStyleGuide(bookId: string, referenceText: string, sourceName?: string): Promise<string> {
    if (referenceText.length < 500) {
      throw new Error(`Reference text too short (${referenceText.length} chars, minimum 500). Provide at least 2000 chars for reliable style extraction.`);
    }

    const { analyzeStyle } = await import("../agents/style-analyzer.js");
    const bookDir = this.state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    // Statistical fingerprint
    const profile = analyzeStyle(referenceText, sourceName);
    await writeFile(join(storyDir, "style_profile.json"), JSON.stringify(profile, null, 2), "utf-8");

    // LLM qualitative extraction
    const response = await chatCompletion(this.config.client, this.config.model, [
      {
        role: "system",
        content: `你是一位文学风格分析专家。分析参考文本的写作风格，提取可供模仿的定性特征。

输出格式（Markdown）：
## 叙事声音与语气
（冷峻/热烈/讽刺/温情/...，附1-2个原文例句）

## 对话风格
（角色说话的共性特征：句子长短、口头禅倾向、方言痕迹、对话节奏）

## 场景描写特征
（五感偏好、意象选择、描写密度、环境与情绪的关联方式）

## 转折与衔接手法
（场景如何切换、时间跳跃的处理方式、段落间的过渡特征）

## 节奏特征
（长短句分布、段落长度偏好、高潮/舒缓的交替方式）

## 词汇偏好
（高频特色用词、比喻/修辞倾向、口语化程度）

## 情绪表达方式
（直白抒情 vs 动作外化、内心独白的频率和风格）

## 独特习惯
（任何值得模仿的个人写作习惯）

分析必须基于原文实际特征，不要泛泛而谈。每个部分用1-2个原文例句佐证。`,
      },
      {
        role: "user",
        content: `分析以下参考文本的写作风格：\n\n${referenceText.slice(0, 20000)}`,
      },
    ], { temperature: 0.3, stage: "style-extraction", projectRoot: this.config.projectRoot });

    await writeFile(join(storyDir, "style_guide.md"), response.content, "utf-8");
    return response.content;
  }

  /**
   * Import canon from parent book for spinoff writing.
   * Reads parent's truth files, uses LLM to generate parent_canon.md in target book.
   */
  async importCanon(targetBookId: string, parentBookId: string): Promise<string> {
    // Validate both books exist
    const bookIds = await this.state.listBooks();
    if (!bookIds.includes(parentBookId)) {
      throw new Error(`Parent book "${parentBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
    }
    if (!bookIds.includes(targetBookId)) {
      throw new Error(`Target book "${targetBookId}" not found. Available: ${bookIds.join(", ") || "(none)"}`);
    }

    const parentDir = this.state.bookDir(parentBookId);
    const targetDir = this.state.bookDir(targetBookId);
    const storyDir = join(targetDir, "story");
    await mkdir(storyDir, { recursive: true });

    const readSafe = async (path: string): Promise<string> => {
      try { return await readFile(path, "utf-8"); } catch { return "(无)"; }
    };

    const parentBook = await this.state.loadBookConfig(parentBookId);

    const [storyBible, currentState, ledger, hooks, summaries, subplots, emotions, matrix] =
      await Promise.all([
        readSafe(join(parentDir, "story/story_bible.md")),
        readSafe(join(parentDir, "story/current_state.md")),
        readSafe(join(parentDir, "story/particle_ledger.md")),
        readSafe(join(parentDir, "story/pending_hooks.md")),
        readSafe(join(parentDir, "story/chapter_summaries.md")),
        readSafe(join(parentDir, "story/subplot_board.md")),
        readSafe(join(parentDir, "story/emotional_arcs.md")),
        readSafe(join(parentDir, "story/character_matrix.md")),
      ]);

    const response = await chatCompletion(this.config.client, this.config.model, [
      {
        role: "system",
        content: `你是一位网络小说架构师。基于正传的全部设定和状态文件，生成一份完整的"正传正典参照"文档，供番外写作和审计使用。

输出格式（Markdown）：
# 正传正典（《{正传书名}》）

## 世界规则（完整，来自正传设定）
（力量体系、地理设定、阵营关系、核心规则——完整复制，不压缩）

## 正典约束（不可违反的事实）
| 约束ID | 类型 | 约束内容 | 严重性 |
|---|---|---|---|
| C01 | 人物存亡 | ... | critical |
（列出所有硬性约束：谁活着、谁死了、什么事件已经发生、什么规则不可违反）

## 角色快照
| 角色 | 当前状态 | 性格底色 | 对话特征 | 已知信息 | 未知信息 |
|---|---|---|---|---|---|
（从状态卡和角色矩阵中提取每个重要角色的完整快照）

## 角色双态处理原则
- 未来会变强的角色：写潜力暗示
- 未来会黑化的角色：写微小裂痕
- 未来会死的角色：写导致死亡的性格底色

## 关键事件时间线
| 章节 | 事件 | 涉及角色 | 对番外的约束 |
|---|---|---|---|
（从章节摘要中提取关键事件）

## 伏笔状态
| Hook ID | 类型 | 状态 | 内容 | 预期回收 |
|---|---|---|---|---|

## 资源账本快照
（当前资源状态）

---
meta:
  parentBookId: "{parentBookId}"
  parentTitle: "{正传书名}"
  generatedAt: "{ISO timestamp}"

要求：
1. 世界规则完整复制，不压缩——准确性优先
2. 正典约束必须穷尽，遗漏会导致番外与正传矛盾
3. 角色快照必须包含信息边界（已知/未知），防止番外中角色引用不该知道的信息`,
      },
      {
        role: "user",
        content: `正传书名：${parentBook.title}
正传ID：${parentBookId}

## 正传世界设定
${storyBible}

## 正传当前状态卡
${currentState}

## 正传资源账本
${ledger}

## 正传伏笔池
${hooks}

## 正传章节摘要
${summaries}

## 正传支线进度
${subplots}

## 正传情感弧线
${emotions}

## 正传角色矩阵
${matrix}`,
      },
    ], { temperature: 0.3, stage: "architect", projectRoot: this.config.projectRoot });

    // Append deterministic meta block (LLM may hallucinate timestamps)
    const metaBlock = [
      "",
      "---",
      "meta:",
      `  parentBookId: "${parentBookId}"`,
      `  parentTitle: "${parentBook.title}"`,
      `  generatedAt: "${new Date().toISOString()}"`,
    ].join("\n");
    const canon = response.content + metaBlock;

    await writeFile(join(storyDir, "parent_canon.md"), canon, "utf-8");

    // Also generate style guide from parent's chapter text if available
    const parentChaptersDir = join(parentDir, "chapters");
    const parentChapterText = await this.readParentChapterSample(parentChaptersDir);
    if (parentChapterText.length >= 500) {
      await this.tryGenerateStyleGuide(targetBookId, parentChapterText, parentBook.title);
    }

    return canon;
  }

  private async readParentChapterSample(chaptersDir: string): Promise<string> {
    try {
      const entries = await readdir(chaptersDir);
      const mdFiles = entries
        .filter((file) => file.endsWith(".md"))
        .sort()
        .slice(0, 5);
      const chunks: string[] = [];
      let totalLength = 0;
      for (const file of mdFiles) {
        if (totalLength >= 20000) break;
        const content = await readFile(join(chaptersDir, file), "utf-8");
        chunks.push(content);
        totalLength += content.length;
      }
      return chunks.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  // ---------------------------------------------------------------------------
  // Chapter import (for continuation writing from existing chapters)
  // ---------------------------------------------------------------------------

  /**
   * Import existing chapters into a book. Reverse-engineers all truth files
   * via sequential replay so the Writer and Auditor can continue naturally.
   *
   * Step 1: Generate foundation (story_bible, volume_outline, book_rules) from all chapters.
   * Step 2: Sequentially replay each chapter through ChapterAnalyzer to build truth files.
   */
  async importChapters(input: ImportChaptersInput): Promise<ImportChaptersResult> {
    const releaseLock = await this.state.acquireBookLock(input.bookId);
    try {
      const book = await this.state.loadBookConfig(input.bookId);
      const bookDir = this.state.bookDir(input.bookId);
      const { profile: gp } = await this.loadGenreProfile(book.genre);
      const resolvedLanguage = book.language ?? gp.language;

      const startFrom = input.resumeFrom ?? 1;

      const log = this.config.logger?.child("import");

      // Step 1: Generate foundation on first run (not on resume)
      if (startFrom === 1) {
        log?.info(this.localize(resolvedLanguage, {
          zh: `步骤 1：从 ${input.chapters.length} 章生成基础设定...`,
          en: `Step 1: Generating foundation from ${input.chapters.length} chapters...`,
        }));
        const allText = input.chapters.map((c, i) =>
          resolvedLanguage === "en"
            ? `Chapter ${i + 1}: ${c.title}\n\n${c.content}`
            : `第${i + 1}章 ${c.title}\n\n${c.content}`,
        ).join("\n\n---\n\n");

        const architect = new ArchitectAgent(this.agentCtxFor("architect", input.bookId));
        const isSeries = input.importMode === "series";
        const foundation = isSeries
          ? await this.generateAndReviewFoundation({
              generate: (reviewFeedback) => architect.generateFoundationFromImport(book, allText, undefined, reviewFeedback, { importMode: "series" }),
              repair: (foundation, reviewFeedback) => architect.completeStorySkeletonSections(book, foundation, reviewFeedback),
              reviewer: new FoundationReviewerAgent(this.agentCtxFor("foundation-reviewer", input.bookId)),
              mode: "series",
              language: resolvedLanguage === "en" ? "en" : "zh",
              stageLanguage: resolvedLanguage,
            })
          : await architect.completeStorySkeletonSections(
              book,
              await architect.generateFoundationFromImport(book, allText),
            );
        const completedFoundation = await architect.completeStructureSignals(book, foundation);
        await architect.writeFoundationFiles(
          bookDir,
          completedFoundation,
          gp.numericalSystem,
          resolvedLanguage,
          undefined,
          book,
        );
        await this.resetImportReplayTruthFiles(bookDir, resolvedLanguage);
        await this.state.saveChapterIndex(input.bookId, []);
        await this.state.snapshotState(input.bookId, 0);

        // Generate style guide from imported chapters
        if (allText.length >= 500) {
          log?.info(this.localize(resolvedLanguage, {
            zh: "提取原文风格指纹...",
            en: "Extracting source style fingerprint...",
          }));
          await this.tryGenerateStyleGuide(input.bookId, allText, book.title, resolvedLanguage);
        }

        log?.info(this.localize(resolvedLanguage, {
          zh: "基础设定已生成。",
          en: "Foundation generated.",
        }));
      }

      // Step 2: Sequential replay
      log?.info(this.localize(resolvedLanguage, {
        zh: `步骤 2：从第 ${startFrom} 章开始顺序回放...`,
        en: `Step 2: Sequential replay from chapter ${startFrom}...`,
      }));
      const analyzer = new ChapterAnalyzerAgent(this.agentCtxFor("chapter-analyzer", input.bookId));
      const writer = new WriterAgent(this.agentCtxFor("writer", input.bookId));
      const countingMode = resolveLengthCountingMode(book.language ?? gp.language);
      let totalWords = 0;
      let importedCount = 0;

      for (let i = startFrom - 1; i < input.chapters.length; i++) {
        const ch = input.chapters[i]!;
        const chapterNumber = i + 1;
        const governedInput = await this.prepareWriteInput(book, bookDir, chapterNumber);

        log?.info(this.localize(resolvedLanguage, {
          zh: `分析章节 ${chapterNumber}/${input.chapters.length}：${ch.title}...`,
          en: `Analyzing chapter ${chapterNumber}/${input.chapters.length}: ${ch.title}...`,
        }));

        // Analyze chapter to get truth file updates
        const output = await analyzer.analyzeChapter({
          book,
          bookDir,
          chapterNumber,
          chapterContent: ch.content,
          chapterTitle: ch.title,
          chapterIntent: governedInput.chapterIntent,
          contextPackage: governedInput.contextPackage,
          ruleStack: governedInput.ruleStack,
        });

        // Save chapter file + core truth files (state, ledger, hooks)
        await writer.saveChapter(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        }, gp.numericalSystem, resolvedLanguage);

        // Save extended truth files (summaries, subplots, emotional arcs, character matrix)
        await writer.saveNewTruthFiles(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        }, resolvedLanguage);
        await this.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, output);
        await this.syncNarrativeMemoryIndex(input.bookId, chapterNumber);

        // Update chapter index
        const existingIndex = await this.state.loadChapterIndex(input.bookId);
        const now = new Date().toISOString();
        const chapterWordCount = countChapterLength(ch.content, countingMode);
        const newEntry: ChapterMeta = {
          number: chapterNumber,
          title: output.title,
          status: "imported",
          wordCount: chapterWordCount,
          createdAt: now,
          updatedAt: now,
          auditIssues: [],
          lengthWarnings: [],
        };
        // Replace if exists (resume case), otherwise append
        const existingIdx = existingIndex.findIndex((e) => e.number === chapterNumber);
        const updatedIndex = existingIdx >= 0
          ? existingIndex.map((e, idx) => idx === existingIdx ? newEntry : e)
          : [...existingIndex, newEntry];
        await this.state.saveChapterIndex(input.bookId, updatedIndex);

        // Snapshot state after each chapter for rollback + resume support
        await this.state.snapshotState(input.bookId, chapterNumber);

        importedCount++;
        totalWords += chapterWordCount;
      }

      if (input.chapters.length > 0) {
        await this.markBookActiveIfNeeded(input.bookId);
        await this.syncCurrentStateFactHistory(input.bookId, input.chapters.length);
      }

      const nextChapter = input.chapters.length + 1;
      log?.info(this.localize(resolvedLanguage, {
        zh: `完成。已导入 ${importedCount} 章，共 ${formatLengthCount(totalWords, countingMode)}。下一章：${nextChapter}`,
        en: `Done. ${importedCount} chapters imported, ${formatLengthCount(totalWords, countingMode)}. Next chapter: ${nextChapter}`,
      }));

      return {
        bookId: input.bookId,
        importedCount,
        totalWords,
        nextChapter,
      };
    } finally {
      await releaseLock();
    }
  }

  async rebuildStoryState(bookId: string): Promise<void> {
    const releaseLock = await this.state.acquireBookLock(bookId);
    try {
      const book = await this.state.loadBookConfig(bookId);
      const bookDir = this.state.bookDir(bookId);
      const { profile: gp } = await this.loadGenreProfile(book.genre);
      const resolvedLanguage = book.language ?? gp.language;

      const index = await this.state.loadChapterIndex(bookId);
      const activeChapters = index.filter((ch) => ch.status !== "rejected");

      if (activeChapters.length === 0) {
        throw new Error(`Book "${bookId}" has no approved or active chapters to rebuild state from.`);
      }

      const log = this.config.logger?.child("rebuild-state");
      log?.info(this.localize(resolvedLanguage, {
        zh: `开始重建书籍 "${book.title}" 的故事状态，共 ${activeChapters.length} 章...`,
        en: `Rebuilding story state for "${book.title}" from ${activeChapters.length} chapters...`,
      }));

      // 1. Reset all truth files to chapter 0 seeds
      await this.resetImportReplayTruthFiles(bookDir, resolvedLanguage);
      await this.state.saveChapterIndex(bookId, []);
      await this.state.snapshotState(bookId, 0);

      // 2. Sequential replay and analyze each chapter
      const analyzer = new ChapterAnalyzerAgent(this.agentCtxFor("chapter-analyzer", bookId));
      const writer = new WriterAgent(this.agentCtxFor("writer", bookId));
      const countingMode = resolveLengthCountingMode(book.language ?? gp.language);

      const rebuiltIndex: ChapterMeta[] = [];

      for (const chMeta of activeChapters) {
        const chapterNumber = chMeta.number;

        log?.info(this.localize(resolvedLanguage, {
          zh: `分析章节 ${chapterNumber}/${activeChapters.length}：${chMeta.title}...`,
          en: `Analyzing chapter ${chapterNumber}/${activeChapters.length}: ${chMeta.title}...`,
        }));

        const content = await this.readChapterContent(bookDir, chapterNumber);
        const governedInput = await this.prepareWriteInput(book, bookDir, chapterNumber);

        // Analyze chapter to get truth file updates
        const output = await analyzer.analyzeChapter({
          book,
          bookDir,
          chapterNumber,
          chapterContent: content,
          chapterTitle: chMeta.title,
          chapterIntent: governedInput.chapterIntent,
          contextPackage: governedInput.contextPackage,
          ruleStack: governedInput.ruleStack,
        });

        // Save core truth files (state, ledger, hooks)
        await writer.saveChapter(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        }, gp.numericalSystem, resolvedLanguage);

        // Save extended truth files (summaries, subplots, emotional arcs, character matrix)
        await writer.saveNewTruthFiles(bookDir, {
          ...output,
          postWriteErrors: [],
          postWriteWarnings: [],
        }, resolvedLanguage);

        await this.syncLegacyStructuredStateFromMarkdown(bookDir, chapterNumber, output);
        await this.syncNarrativeMemoryIndex(bookId, chapterNumber);

        // Save entry in index
        const now = new Date().toISOString();
        const wordCount = countChapterLength(content, countingMode);
        const entry: ChapterMeta = {
          ...chMeta,
          wordCount,
          updatedAt: now,
        };
        rebuiltIndex.push(entry);
        await this.state.saveChapterIndex(bookId, rebuiltIndex);

        // Snapshot state + fact history
        await this.state.snapshotState(bookId, chapterNumber);
        await this.syncCurrentStateFactHistory(bookId, chapterNumber);
      }

      log?.info(this.localize(resolvedLanguage, {
        zh: `完成。已重建 ${rebuiltIndex.length} 章的故事状态。`,
        en: `Done. Rebuilt story state for ${rebuiltIndex.length} chapters.`,
      }));
    } finally {
      await releaseLock();
    }
  }

  private static addUsage(
    a: TokenUsageSummary,
    b?: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number },
  ): TokenUsageSummary {
    if (!b) return a;
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
    };
  }

  private async buildPersistenceOutput(
    bookId: string,
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    output: WriteChapterOutput,
    finalContent: string,
    countingMode: Parameters<typeof countChapterLength>[1],
    reducedControlInput?: {
      chapterIntent: string;
      contextPackage: ContextPackage;
      ruleStack: RuleStack;
    },
    resourceAuthoritySummary?: string,
  ): Promise<WriteChapterOutput> {
    if (finalContent === output.content) {
      return output;
    }

    const analyzer = new ChapterAnalyzerAgent(this.agentCtxFor("chapter-analyzer", bookId));
    const analyzed = await analyzer.analyzeChapter({
      book,
      bookDir,
      chapterNumber,
      chapterContent: finalContent,
      chapterTitle: output.title,
      chapterIntent: reducedControlInput?.chapterIntent,
      contextPackage: reducedControlInput?.contextPackage,
      ruleStack: reducedControlInput?.ruleStack,
      resourceAuthoritySummary,
    });

    return {
      ...analyzed,
      content: finalContent,
      wordCount: countChapterLength(finalContent, countingMode),
      postWriteErrors: [],
      postWriteWarnings: [],
      hookHealthIssues: output.hookHealthIssues,
      tokenUsage: output.tokenUsage,
    };
  }

  private async assertNoPendingStateRepair(bookId: string): Promise<void> {
    const existingIndex = await this.state.loadChapterIndex(bookId);
    const latestChapter = [...existingIndex].sort((left, right) => right.number - left.number)[0];
    if (latestChapter?.status !== "state-degraded" && latestChapter?.status !== "blocked-resource-plan") {
      return;
    }

    throw new Error(
      `Latest chapter ${latestChapter.number} is ${latestChapter.status}. Repair state/resource plan or rewrite that chapter before continuing.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async prepareWriteInput(
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    externalContext?: string,
  ): Promise<Pick<WriteChapterInput, "externalContext" | "chapterIntent" | "resourcePlan" | "contextPackage" | "ruleStack" | "trace">> {
    if ((this.config.inputGovernanceMode ?? "v2") === "legacy") {
      return { externalContext };
    }

    const { plan, composed } = await this.createGovernedArtifacts(
      book,
      bookDir,
      chapterNumber,
      externalContext,
      { reuseExistingIntentWhenContextMissing: true },
    );

    return {
      chapterIntent: plan.intentMarkdown,
      contextPackage: composed.contextPackage,
      ruleStack: composed.ruleStack,
      trace: composed.trace,
    };
  }

  private async prepareResourcePlan(params: {
    readonly book: BookConfig;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly chapterGoal?: string;
    readonly language: LengthLanguage;
  }): Promise<ChapterResourcePlan> {
    const storyDir = join(params.bookDir, "story");
    const [bookRules, particleLedger, currentState, chapterSummaries, pendingHooks] = await Promise.all([
      readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
    ]);
    const resourcePlan = buildChapterResourcePlan({
      chapter: params.chapterNumber,
      bookRules,
      particleLedger,
      currentState,
      previousChapterSummary: this.extractPreviousChapterSummary(chapterSummaries, params.chapterNumber),
      chapterGoal: params.chapterGoal,
      chapterHooks: pendingHooks,
      genre: params.book.genre,
      systemMode: params.book.platform,
    });
    this.config.logger?.child("writer")?.info(this.localize(params.language, {
      zh: `Resource Plan generated: ${resourcePlan.mode}`,
      en: `Resource Plan generated: ${resourcePlan.mode}`,
    }));
    return resourcePlan;
  }

  private extractPreviousChapterSummary(chapterSummaries: string, chapterNumber: number): string {
    if (!chapterSummaries.trim() || chapterNumber <= 1) return "";
    const previous = chapterNumber - 1;
    const escaped = String(previous).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\|)\\s*(?:第)?${escaped}(?:章)?\\s*(?:\\||[:：])`, "u");
    return chapterSummaries.split("\n").find((line) => pattern.test(line)) ?? "";
  }

  private async prepareChapterIntentInput(params: {
    readonly book: BookConfig;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly writeInput: Pick<WriteChapterInput, "externalContext" | "chapterIntent" | "resourcePlan" | "contextPackage" | "ruleStack" | "trace">;
    readonly language: LengthLanguage;
  }): Promise<Pick<WriteChapterInput, "externalContext" | "chapterIntent" | "resourcePlan" | "contextPackage" | "ruleStack" | "trace">> {
    const writerLogger = this.config.logger?.child("writer");
    writerLogger?.info(this.localize(params.language, {
      zh: `阶段 0：生成章节意图卡（第${params.chapterNumber}章）`,
      en: `Phase 0: generating chapter intent card for chapter ${params.chapterNumber}`,
    }));

    const agent = new ChapterIntentAgent(this.agentCtxFor("chapter-intent", params.book.id));
    const resourcePlan = await this.prepareResourcePlan({
      book: params.book,
      bookDir: params.bookDir,
      chapterNumber: params.chapterNumber,
      chapterGoal: params.writeInput.chapterIntent,
      language: params.language,
    });
    const result = await agent.generate({
      book: params.book,
      bookDir: params.bookDir,
      chapterNumber: params.chapterNumber,
      plannerIntent: params.writeInput.chapterIntent,
      resourcePlan,
      skipPlanningValidation: this.config.skipPlanningValidation,
    });
    writerLogger?.info(this.localize(params.language, {
      zh: "chapter-intent resource plan injected",
      en: "chapter-intent resource plan injected",
    }));
    if (result.isFallback) {
      writerLogger?.warn(this.localize(params.language, {
        zh: "章节意图卡生成失败，使用 fallback intent",
        en: "Chapter intent generation failed; using fallback intent",
      }));
    }
    writerLogger?.info(this.localize(params.language, {
      zh: `章节意图卡已写入：${relativeToBookDir(params.bookDir, result.runtimePath)}`,
      en: `Chapter intent card written: ${relativeToBookDir(params.bookDir, result.runtimePath)}`,
    }));
    const sanitized = sanitizePlannerIntentForChapterIntent({
      plannerIntent: params.writeInput.chapterIntent,
      chapterIntent: result.content,
      contextPackage: params.writeInput.contextPackage,
    });
    if (sanitized.suppression.suppressPayoff) {
      writerLogger?.warn(this.localize(params.language, {
        zh: `chapter_intent suppresses planner payoff; payoffDirective sanitized${sanitized.suppression.removedPayoff ? ` (${sanitized.suppression.removedPayoff})` : ""}`,
        en: `chapter_intent suppresses planner payoff; payoffDirective sanitized${sanitized.suppression.removedPayoff ? ` (${sanitized.suppression.removedPayoff})` : ""}`,
      }));
    }

    return {
      ...params.writeInput,
      chapterIntent: result.content,
      resourcePlan,
      contextPackage: sanitized.contextPackage,
    };
  }

  private async runIntentAlignmentReview(params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly storyDir: string;
    readonly chapterNumber: number;
    readonly finalTitle: string;
    readonly finalContent: string;
    readonly language: LengthLanguage;
    readonly resourceBlocking?: boolean;
    readonly resourcePlan?: ChapterResourcePlan;
  }): Promise<IntentAlignmentReport> {
    const padded = String(params.chapterNumber).padStart(4, "0");
    const intentFullPath = join(params.storyDir, "runtime", "chapter-intents", `${padded}.md`);
    const reportDir = join(params.bookDir, "reviews", "intent-alignment");
    const jsonPath = join(reportDir, `${padded}.report.json`);
    const markdownPath = join(reportDir, `${padded}.report.md`);
    const input = {
      chapter: params.chapterNumber,
      intentMarkdown: await readFile(intentFullPath, "utf-8").catch(() => ""),
      chapterContent: params.finalContent,
      bookRules: await readFile(join(params.storyDir, "book_rules.md"), "utf-8").catch(() => ""),
      antagonistMap: await readFile(join(params.storyDir, "antagonist_map.md"), "utf-8").catch(() => ""),
      motivationMatrix: await readFile(join(params.storyDir, "motivation_matrix.md"), "utf-8").catch(() => ""),
      intentPath: relativeToBookDir(params.bookDir, intentFullPath),
      chapterPath: join("chapters", `${padded}_${this.sanitizeReportFilename(params.finalTitle)}.md`),
      resourcePlan: params.resourcePlan,
    };

    let report: IntentAlignmentReport;
    if (params.resourceBlocking) {
      report = {
        chapter: params.chapterNumber,
        status: "SKIPPED_DUE_RESOURCE_FAILURE",
        score: null,
        dimensions: {
          goal_alignment: 85,
          obstacle_alignment: 85,
          antagonist_pressure_alignment: 85,
          climax_payoff_alignment: 0,
          ending_hook_alignment: 85,
          behavior_safety_alignment: 85,
        },
        dimensionConclusions: {
          goal_alignment: "资源账本校验失败，本章目标对齐未继续判定。",
          obstacle_alignment: "资源账本校验失败，本章阻碍对齐未继续判定。",
          antagonist_pressure_alignment: "资源账本校验失败，本章反派压力未继续判定。",
          climax_payoff_alignment: "资源账本校验失败，本章资源收益/消耗不可确认，因此无法判定高潮收益完全对齐。",
          ending_hook_alignment: "资源账本校验失败，本章结尾钩子未继续判定。",
          behavior_safety_alignment: "资源账本校验失败，本章安全维度未继续判定。",
        },
        issues: [{
          severity: "critical",
          dimension: "resource_consistency",
          message: "资源账本校验失败，本章资源收益/消耗不可确认，因此跳过 intent alignment PASS 判定。",
          suggestion: "先人工修复或重写资源数值链路，再重新执行 intent alignment。",
        }],
        suggestions: ["修复 Resource Engine 报告中的 blocking issue 后重新审核。"],
        intentPath: input.intentPath,
        chapterPath: input.chapterPath,
      };
    } else {
      try {
      const reviewer = new IntentAlignmentReviewerAgent(this.agentCtxFor("intent-alignment-reviewer", params.bookId));
      report = await reviewer.review(input);
      } catch (error) {
        report = buildSkippedIntentAlignmentReport(input, error);
        this.logWarn(params.language, {
          zh: `intent-alignment-reviewer 调用失败，已生成 SKIPPED 报告：${error instanceof Error ? error.message : String(error)}`,
          en: `intent-alignment-reviewer failed; wrote SKIPPED report: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    await writeIntentAlignmentReportFiles({ report, jsonPath, markdownPath });
    return report;
  }

  private async runStoryEffectivenessReview(params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly storyDir: string;
    readonly chapterNumber: number;
    readonly finalTitle: string;
    readonly finalContent: string;
    readonly language: LengthLanguage;
    readonly resourceBlocking?: boolean;
    readonly chapterIndexStatus?: string;
  }): Promise<StoryEffectivenessReport> {
    const padded = String(params.chapterNumber).padStart(4, "0");
    const reportDir = join(params.bookDir, "reviews", "story-effectiveness");
    const jsonPath = join(reportDir, `${padded}.report.json`);
    const markdownPath = join(reportDir, `${padded}.report.md`);
    const chapterIntentPath = join(params.storyDir, "runtime", "chapter-intents", `${padded}.md`);
    const input = {
      chapter: params.chapterNumber,
      chapterContent: params.finalContent,
      chapterIntent: await readFile(chapterIntentPath, "utf-8").catch(() => ""),
      resourceBlocking: params.resourceBlocking,
      chapterIndexStatus: params.chapterIndexStatus,
    };

    let report: StoryEffectivenessReport;
    try {
      const reviewer = new StoryEffectivenessAgent(this.agentCtxFor("story-effectiveness", params.bookId));
      report = await reviewer.review(input);
    } catch (error) {
      report = {
        chapter: params.chapterNumber,
        status: "SKIPPED",
        score: null,
        dimensions: {
          emotion_event: 85,
          desire_goal: 85,
          obstacle_pressure: 85,
          solution_method: 85,
          climax_payoff: 85,
          ending_pull: 85,
        },
        dimensionConclusions: {
          emotion_event: "reviewer 调用失败，未执行审核。",
          desire_goal: "reviewer 调用失败，未执行审核。",
          obstacle_pressure: "reviewer 调用失败，未执行审核。",
          solution_method: "reviewer 调用失败，未执行审核。",
          climax_payoff: "reviewer 调用失败，未执行审核。",
          ending_pull: "reviewer 调用失败，未执行审核。",
        },
        strengths: [],
        issues: [{
          severity: "warning",
          dimension: "local_scan",
          message: `story-effectiveness reviewer 调用失败：${error instanceof Error ? error.message : String(error)}`,
          suggestion: "稍后重新运行审核或人工检查本章故事结构。",
        }],
        suggestions: ["稍后重新执行 story-effectiveness review。"],
        skippedReason: `reviewer error: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.logWarn(params.language, {
        zh: `story-effectiveness reviewer 调用失败，已生成 SKIPPED 报告：${error instanceof Error ? error.message : String(error)}`,
        en: `story-effectiveness reviewer failed; wrote SKIPPED report: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    await writeStoryEffectivenessReportFiles({ report, jsonPath, markdownPath });
    return report;
  }

  private async runGolden3ChapterReview(params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly language: LengthLanguage;
    readonly resourceBlocking?: boolean;
    readonly chapterIndexStatus?: string;
  }): Promise<Golden3ChapterReport> {
    const reportDir = join(params.bookDir, "reviews", "golden-3-chapter");
    const jsonPath = join(reportDir, "golden-3-chapter.report.json");
    const markdownPath = join(reportDir, "golden-3-chapter.report.md");
    const chaptersDir = join(params.bookDir, "chapters");

    // Read chapter files from disk
    const readChapterContent = async (chNum: number): Promise<string> => {
      try {
        const files = await readdir(chaptersDir);
        const padded = String(chNum).padStart(4, "0");
        const file = files.find((f) => f.startsWith(padded) && f.endsWith(".md"));
        if (!file) return "";
        const raw = await readFile(join(chaptersDir, file), "utf-8");
        // Strip heading line
        const headingEnd = raw.indexOf("\n\n");
        return headingEnd >= 0 ? raw.slice(headingEnd + 2).trim() : raw.trim();
      } catch {
        return "";
      }
    };

    const ch1Content = await readChapterContent(1);
    const ch2Content = await readChapterContent(2);
    const ch3Content = await readChapterContent(3);

    // Read first_10_chapter_plan from story dir
    let first10Plan: string | undefined;
    try {
      const storyDir = join(params.bookDir, "story");
      const planPath = join(storyDir, "first_10_chapter_plan.md");
      first10Plan = await readFile(planPath, "utf-8");
    } catch {
      // Plan may not exist — continue without it
    }

    const input = {
      chapter1Content: ch1Content,
      chapter2Content: ch2Content,
      chapter3Content: ch3Content,
      first10ChapterPlan: first10Plan,
      resourceBlocking: params.resourceBlocking,
      chapterIndexStatus: params.chapterIndexStatus,
    };

    let report: Golden3ChapterReport;
    try {
      const reviewer = new Golden3ChapterAgent(this.agentCtxFor("golden-3-chapter", params.bookId));
      report = await reviewer.review(input);
    } catch (error) {
      report = {
        chapterRange: [1, 3],
        status: "SKIPPED",
        score: null,
        dimensions: {
          opening_hook_delivery: 85,
          core_differentiator_visible: 85,
          long_term_goal_established: 85,
          three_chapter_arc: 85,
          setup_ratio_safe: 85,
        },
        dimensionConclusions: {
          opening_hook_delivery: "reviewer 调用失败，未执行审核。",
          core_differentiator_visible: "reviewer 调用失败，未执行审核。",
          long_term_goal_established: "reviewer 调用失败，未执行审核。",
          three_chapter_arc: "reviewer 调用失败，未执行审核。",
          setup_ratio_safe: "reviewer 调用失败，未执行审核。",
        },
        strengths: [],
        issues: [{
          severity: "warning",
          dimension: "local_scan",
          message: `golden-3-chapter reviewer 调用失败：${error instanceof Error ? error.message : String(error)}`,
          suggestion: "稍后重新运行 golden_3_chapter review。",
        }],
        suggestions: ["稍后重新执行 golden_3_chapter review。"],
        summary: `跳过：reviewer error: ${error instanceof Error ? error.message : String(error)}`,
        skippedReason: `reviewer error: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.logWarn(params.language, {
        zh: `golden-3-chapter reviewer 调用失败，已生成 SKIPPED 报告：${error instanceof Error ? error.message : String(error)}`,
        en: `golden-3-chapter reviewer failed; wrote SKIPPED report: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    await writeGolden3ChapterReportFiles({ report, jsonPath, markdownPath });
    return report;
  }

  private async runOpeningHookReview(params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly chapterContent: string;
    readonly chapterTitle: string;
    readonly language: LengthLanguage;
    readonly resourceBlocking?: boolean;
    readonly chapterIndexStatus?: string;
  }): Promise<OpeningHookReviewReport> {
    const padded = String(params.chapterNumber).padStart(4, "0");
    const reportDir = join(params.bookDir, "reviews", "opening-hook");
    const jsonPath = join(reportDir, `${padded}.opening-hook.report.json`);
    const markdownPath = join(reportDir, `${padded}.opening-hook.report.md`);

    const input = {
      chapterContent: params.chapterContent,
      chapterIndex: params.chapterNumber,
      chapterTitle: params.chapterTitle,
      resourceBlocking: params.resourceBlocking,
      chapterIndexStatus: params.chapterIndexStatus,
    };

    let report: OpeningHookReviewReport;
    try {
      const reviewer = new OpeningHookReviewerAgent(this.agentCtxFor("opening-hook-reviewer", params.bookId));
      report = await reviewer.review(input);
    } catch (error) {
      report = {
        chapterIndex: params.chapterNumber,
        chapterTitle: params.chapterTitle,
        status: "SKIPPED",
        score: null,
        detectedHookType: null,
        hookStrength: "undetected",
        dimensions: {
          suspense_gap: 55,
          extreme_contrast: 55,
          conflict_first: 55,
          worldview_bomb: 55,
          extreme_emotion: 55,
        },
        dimensionConclusions: {
          suspense_gap: "reviewer 调用失败，未执行审核。",
          extreme_contrast: "reviewer 调用失败，未执行审核。",
          conflict_first: "reviewer 调用失败，未执行审核。",
          worldview_bomb: "reviewer 调用失败，未执行审核。",
          extreme_emotion: "reviewer 调用失败，未执行审核。",
        },
        checklist: {
          abnormalImage100: false,
          conflict300: false,
          dilemma500: false,
          continueReason: false,
          hookTypeMatched: false,
        },
        strengths: [],
        issues: [{
          severity: "warning",
          dimension: "resource_consistency",
          message: `opening-hook-reviewer 调用失败：${error instanceof Error ? error.message : String(error)}`,
          suggestion: "稍后重新运行 opening-hook review。",
        }],
        suggestions: ["稍后重新执行 opening-hook review。"],
        summary: `跳过：reviewer error: ${error instanceof Error ? error.message : String(error)}`,
        skippedReason: `reviewer error: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.logWarn(params.language, {
        zh: `opening-hook-reviewer 调用失败，已生成 SKIPPED 报告：${error instanceof Error ? error.message : String(error)}`,
        en: `opening-hook-reviewer failed; wrote SKIPPED report: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    await writeOpeningHookReportFiles({ report, jsonPath, markdownPath });
    return report;
  }

  private async runAntagonistIntelligenceReview(params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly finalContent: string;
    readonly storyDir: string;
    readonly language: LengthLanguage;
    readonly resourceBlocking?: boolean;
    readonly chapterIndexStatus?: string;
  }): Promise<AntagonistIntelligenceReport> {
    const padded = String(params.chapterNumber).padStart(4, "0");
    const reportDir = join(params.bookDir, "reviews", "antagonist-intelligence");
    const jsonPath = join(reportDir, `${padded}.report.json`);
    const markdownPath = join(reportDir, `${padded}.report.md`);

    const input = {
      chapter: params.chapterNumber,
      chapterContent: params.finalContent,
      antagonistMap: await readFile(join(params.storyDir, "antagonist_map.md"), "utf-8").catch(() => ""),
      motivationMatrix: await readFile(join(params.storyDir, "motivation_matrix.md"), "utf-8").catch(() => ""),
      resourceBlocking: params.resourceBlocking,
      chapterIndexStatus: params.chapterIndexStatus,
    };

    let report: AntagonistIntelligenceReport;
    try {
      const reviewer = new AntagonistIntelligenceReviewerAgent(
        this.agentCtxFor("antagonist-intelligence-reviewer", params.bookId),
      );
      report = await reviewer.review(input);
    } catch (error) {
      report = {
        chapter: params.chapterNumber,
        status: "SKIPPED",
        score: null,
        antagonistTypeDetected: [],
        dimensions: {
          antagonist_goal: 75,
          antagonist_method: 75,
          antagonist_constraint: 75,
          antagonist_cost: 75,
          antagonist_feedback: 75,
          antagonist_foreshadowing: 75,
        },
        dimensionConclusions: {
          antagonist_goal: "reviewer 调用失败，未执行审核。",
          antagonist_method: "reviewer 调用失败，未执行审核。",
          antagonist_constraint: "reviewer 调用失败，未执行审核。",
          antagonist_cost: "reviewer 调用失败，未执行审核。",
          antagonist_feedback: "reviewer 调用失败，未执行审核。",
          antagonist_foreshadowing: "reviewer 调用失败，未执行审核。",
        },
        checklistResults: {
          "反派是否有自洽目标，而不是单纯讨厌主角？": false,
          "反派掌握的信息、资源和权力是否来自世界规则？": false,
          "反派失败是否因为主角伏笔、代价、智慧或微小变量，而不是突然降智？": false,
          "反派是否避免无理由送经验、送情报、送装备？": false,
          "主角胜利后，反派是否仍留下代价、后果或下一层威胁？": false,
          "读者回看前文时，是否能发现反派行动的合理痕迹？": false,
        },
        issues: [{
          severity: "warning",
          dimension: "resource_consistency",
          message: `antagonist-intelligence-reviewer 调用失败：${error instanceof Error ? error.message : String(error)}`,
          suggestion: "稍后重新运行 antagonist-intelligence review。",
        }],
        suggestions: ["稍后重新执行 antagonist-intelligence review。"],
        summary: `跳过：reviewer error: ${error instanceof Error ? error.message : String(error)}`,
        skippedReason: `reviewer error: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.logWarn(params.language, {
        zh: `antagonist-intelligence-reviewer 调用失败，已生成 SKIPPED 报告：${error instanceof Error ? error.message : String(error)}`,
        en: `antagonist-intelligence-reviewer failed; wrote SKIPPED report: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    await writeAntagonistIntelligenceReportFiles({ report, jsonPath, markdownPath });
    return report;
  }

  private async runResourceConsistencyPass(params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly content: string;
    readonly wordCount: number;
    readonly lengthSpec: LengthSpec;
    readonly language: LengthLanguage;
    readonly resourcePlan?: ChapterResourcePlan;
  }): Promise<ResourceConsistencyPipelineResult> {
    const storyDir = join(params.bookDir, "story");
    const padded = String(params.chapterNumber).padStart(4, "0");
    const [bookRules, currentLedger, currentState, chapterIntent] = await Promise.all([
      readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "current_state.md"), "utf-8").catch(() => ""),
      readFile(join(storyDir, "runtime", "chapter-intents", `${padded}.md`), "utf-8").catch(() => ""),
    ]);
    let validation = this.revalidateResourceConsistency({
      content: params.content,
      bookRules,
      currentLedger,
      currentState,
      chapterIntent,
    });
    const resourcePlanViolations = params.resourcePlan
      ? validateResourceEngineAgainstPlan({ text: params.content, validation, plan: params.resourcePlan })
      : [];
    if (validation.events.length === 0) {
      const classification = classifyResourceConsistency({ validation, repaired: false });
      const hasResourcePlanViolations = resourcePlanViolations.length > 0;
      const finalBlocking = classification.blocking || hasResourcePlanViolations;
      const finalStatus: ResourceConsistencyStatus = hasResourcePlanViolations ? "FAILED" : classification.status;
      if (hasResourcePlanViolations) {
        this.config.logger?.child("writer")?.warn(`resource-engine: resource plan violations detected (${resourcePlanViolations.length}), forcing blocking state`);
      }
      const closureStatus: ClosureStatus = classifyClosureStatus({
        hasResourcePlan: !!params.resourcePlan,
        hasEvents: false,
        hasIssues: false,
        hasResourcePlanViolations,
        blocking: finalBlocking,
        status: finalStatus,
      });
      return {
        content: params.content,
        wordCount: params.wordCount,
        validation,
        status: finalStatus,
        blocking: finalBlocking,
        shouldPersistLedger: !finalBlocking,
        shouldPersistStateResources: !finalBlocking,
        repaired: false,
        closureStatus,
        ...(params.resourcePlan ? {
          resourcePlanMode: params.resourcePlan.mode,
          resourcePlanExpectedClosingBalances: params.resourcePlan.expectedClosingBalances,
          resourcePlanAllowedEvents: params.resourcePlan.allowedEvents,
          resourcePlanForbiddenEvents: params.resourcePlan.forbiddenEvents,
          resourcePlanViolations,
        } : {}),
        auditIssues: hasResourcePlanViolations ? buildResourcePlanAuditIssues(resourcePlanViolations) : [],
      };
    }
    if (validation.issues.length === 0) {
      const classification = classifyResourceConsistency({ validation, repaired: false });
      const hasResourcePlanViolations = resourcePlanViolations.length > 0;
      const finalBlocking = classification.blocking || hasResourcePlanViolations;
      const finalStatus: ResourceConsistencyStatus = hasResourcePlanViolations ? "FAILED" : classification.status;
      if (hasResourcePlanViolations) {
        this.config.logger?.child("writer")?.warn(`resource-engine: resource plan violations detected (${resourcePlanViolations.length}), forcing blocking state`);
      }
      const closureStatus: ClosureStatus = classifyClosureStatus({
        hasResourcePlan: !!params.resourcePlan,
        hasEvents: validation.events.length > 0,
        hasIssues: false,
        hasResourcePlanViolations,
        blocking: finalBlocking,
        status: finalStatus,
      });
      return {
        content: params.content,
        wordCount: params.wordCount,
        validation,
        status: finalStatus,
        blocking: finalBlocking,
        shouldPersistLedger: !finalBlocking,
        shouldPersistStateResources: !finalBlocking,
        repaired: false,
        closureStatus,
        ...(params.resourcePlan ? {
          resourcePlanMode: params.resourcePlan.mode,
          resourcePlanExpectedClosingBalances: params.resourcePlan.expectedClosingBalances,
          resourcePlanAllowedEvents: params.resourcePlan.allowedEvents,
          resourcePlanForbiddenEvents: params.resourcePlan.forbiddenEvents,
          resourcePlanViolations,
        } : {}),
        auditIssues: hasResourcePlanViolations ? buildResourcePlanAuditIssues(resourcePlanViolations) : [],
      };
    }

    this.config.logger?.child("writer")?.warn(this.localize(params.language, {
      zh: `resource-engine: extracted ${validation.events.length} resource events; detected ${validation.issues.length} issue(s)`,
      en: `resource-engine: extracted ${validation.events.length} resource event(s); detected ${validation.issues.length} issue(s)`,
    }));
    if (validation.issues.some((issue) => issue.code === "exchange-rate-mismatch" || issue.code === "exchange-ratio-mismatch")) {
      this.config.logger?.child("writer")?.warn("resource-engine: exchange-rate-mismatch detected");
    }

    const originalIssues = validation.issues;
    const localRepair = repairResourceInconsistencies(params.content, validation);
    let content = localRepair.content;
    let tokenUsage: TokenUsageSummary | undefined;
    let repaired = localRepair.repaired;
    validation = this.revalidateResourceConsistency({ content, bookRules, currentLedger, currentState, chapterIntent });

    if (validation.issues.length > 0) {
      try {
        const reviser = new ResourceConsistencyReviserAgent(this.agentCtxFor("resource-consistency-reviser", params.bookId));
        const revised = await reviser.revise({
          chapterContent: content,
          issues: validation.issues,
          authoritativeContext: buildAuthoritativeResourceContext(validation),
          bookRules,
          currentLedger,
          currentState,
        });
        tokenUsage = revised.usage;
        const afterWords = countChapterLength(revised.content, params.lengthSpec.countingMode);
        const decision = {
          beforeWords: countChapterLength(content, params.lengthSpec.countingMode),
          afterWords,
          accepted: revised.content.trim().length > 0
            && (params.wordCount < this.minimumWholeChapterWords(params.lengthSpec)
              || afterWords >= Math.ceil(countChapterLength(content, params.lengthSpec.countingMode) * 0.8)),
        };
        const logger = decision.accepted ? this.logInfo.bind(this) : this.logWarn.bind(this);
        logger(params.language, {
          zh: `rewrite decision [resource-consistency-fix]: beforeWords=${decision.beforeWords}, afterWords=${decision.afterWords}, accepted=${decision.accepted}, rejectedReason=${decision.accepted ? "none" : "below-80%-of-original-or-empty"}`,
          en: `rewrite decision [resource-consistency-fix]: beforeWords=${decision.beforeWords}, afterWords=${decision.afterWords}, accepted=${decision.accepted}, rejectedReason=${decision.accepted ? "none" : "below-80%-of-original-or-empty"}`,
        });
        if (decision.accepted) {
          content = revised.content;
          repaired = true;
          validation = this.revalidateResourceConsistency({ content, bookRules, currentLedger, currentState, chapterIntent });
          if (validation.issues.length === 0) {
            this.config.logger?.child("writer")?.info("resource-engine: second validation passed");
          } else {
            this.config.logger?.child("writer")?.warn("resource-engine: second validation failed, blocking chapter");
          }
        }
      } catch (error) {
        this.logWarn(params.language, {
          zh: `resource-consistency-reviser 调用失败，保留正文并写入 auditIssues：${error instanceof Error ? error.message : String(error)}`,
          en: `resource-consistency-reviser failed; keeping chapter and writing auditIssues: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else if (localRepair.repaired) {
      this.logInfo(params.language, {
        zh: `rewrite decision [resource-consistency-fix]: beforeWords=${params.wordCount}, afterWords=${countChapterLength(content, params.lengthSpec.countingMode)}, accepted=true, rejectedReason=none`,
        en: `rewrite decision [resource-consistency-fix]: beforeWords=${params.wordCount}, afterWords=${countChapterLength(content, params.lengthSpec.countingMode)}, accepted=true, rejectedReason=none`,
      });
      this.config.logger?.child("writer")?.info("resource-engine: second validation passed");
    }

    let classification = classifyResourceConsistency({ validation, repaired });
    let recoveryAttempted = false;
    let recoveryPlan: ReturnType<typeof selectResourceRecoveryPlan> | undefined;
    let secondValidation: "PASS" | "FAILED" | undefined;
    let recoveryPlanResult: "PASS" | "FAILED" | undefined;
    let fallbackRecoveryAttempted = false;
    let fallbackRecoveryPlan: ReturnType<typeof selectResourceRecoveryPlan> | undefined;
    let fallbackSecondValidation: "PASS" | "FAILED" | undefined;
    let templatePatchAttempted = false;
    let templatePatchApplied = false;
    let templatePatchValidation: "PASS" | "FAILED" | undefined;
    let templatePatchReason: string | undefined;
    let removedCashFlowSnippets: ReadonlyArray<string> = [];
    let balanceClaimPatchAttempted = false;
    let balanceClaimPatchApplied = false;
    let balanceClaimPatchResource: string | undefined;
    let balanceClaimPatchFrom: number | undefined;
    let balanceClaimPatchTo: number | undefined;
    let balanceClaimPatchReason: string | undefined;
    if (classification.blocking) {
      recoveryAttempted = true;
      this.config.logger?.child("writer")?.info("resource-engine: second validation failed, attempting blocking recovery");
      recoveryPlan = selectResourceRecoveryPlan({ validation, chapterIntent });
      this.config.logger?.child("writer")?.info(`resource-engine: recovery plan selected: ${recoveryPlan.planId}`);
      try {
        const rewriter = new ResourceBlockingRewriterAgent(this.agentCtxFor("resource-blocking-rewrite", params.bookId));
        const attempt = await this.tryResourceBlockingRewrite({
          rewriter,
          content,
          chapterIntent,
          validation,
          recoveryPlan,
          bookRules,
          currentLedger,
          currentState,
          lengthSpec: params.lengthSpec,
          originalWordCount: params.wordCount,
          language: params.language,
          logLabel: "resource-blocking-rewrite",
        });
        tokenUsage = tokenUsage && attempt.usage
          ? PipelineRunner.addUsage(tokenUsage, attempt.usage)
          : attempt.usage ?? tokenUsage;
        if (attempt.accepted) {
          content = attempt.content;
          validation = attempt.validation;
          repaired = true;
          secondValidation = "PASS";
          recoveryPlanResult = "PASS";
          classification = classifyResourceConsistency({ validation, repaired });
          this.config.logger?.child("writer")?.info("resource-engine: recovery validation passed");
          this.config.logger?.child("writer")?.info("resource-engine: blocking recovered, continuing normal flow");
        } else {
          secondValidation = "FAILED";
          recoveryPlanResult = "FAILED";
          this.config.logger?.child("writer")?.warn(`resource-engine: recovery validation failed for ${recoveryPlan.planId}`);
          const resourceRulesForFallback = parseResourceRules(bookRules, currentLedger, currentState);
          const planModeForFallback = params.resourcePlan?.mode ?? "no_resource_change";
          const exchangeAllowed = isExchangeStrategyAllowed({
            resourceRules: resourceRulesForFallback,
            planMode: planModeForFallback,
          });
          const fallback = exchangeAllowed
            ? buildFallbackRecoveryPlan({
              validation,
              chapterIntent,
              failedPlan: recoveryPlan,
            })
            : undefined;
          if (fallback && fallback.planId !== recoveryPlan.planId) {
            fallbackRecoveryAttempted = true;
            fallbackRecoveryPlan = fallback;
            this.config.logger?.child("writer")?.info(`resource-engine: falling back to ${fallback.strategy}`);
            this.config.logger?.child("writer")?.info(`resource-engine: fallback recovery plan selected: ${fallbackRecoveryPlan.planId}`);
            const fallbackAttempt = await this.tryResourceBlockingRewrite({
              rewriter,
              content,
              chapterIntent,
              validation,
              recoveryPlan: fallbackRecoveryPlan,
              bookRules,
              currentLedger,
              currentState,
              lengthSpec: params.lengthSpec,
              originalWordCount: params.wordCount,
              language: params.language,
              logLabel: "resource-blocking-rewrite",
              isFallback: true,
            });
            tokenUsage = tokenUsage && fallbackAttempt.usage
              ? PipelineRunner.addUsage(tokenUsage, fallbackAttempt.usage)
              : fallbackAttempt.usage ?? tokenUsage;
            if (fallbackAttempt.accepted) {
              content = fallbackAttempt.content;
              validation = fallbackAttempt.validation;
              repaired = true;
              fallbackSecondValidation = "PASS";
              secondValidation = "PASS";
              classification = classifyResourceConsistency({ validation, repaired });
              this.config.logger?.child("writer")?.info("resource-engine: fallback recovery validation passed");
              this.config.logger?.child("writer")?.info("resource-engine: blocking recovered by defer_exchange");
            } else {
              fallbackSecondValidation = "FAILED";
              this.config.logger?.child("writer")?.warn("resource-engine: fallback recovery validation failed");
              const templateAttempt = this.tryDeferExchangeTemplatePatch({
                content: fallbackAttempt.content,
                bookRules,
                currentLedger,
                currentState,
                chapterIntent,
                recoveryPlan: fallbackRecoveryPlan,
              });
              if (templateAttempt.attempted) {
                templatePatchAttempted = true;
                templatePatchApplied = templateAttempt.applied;
                templatePatchValidation = templateAttempt.validationPassed ? "PASS" : "FAILED";
                templatePatchReason = templateAttempt.reason;
                removedCashFlowSnippets = templateAttempt.removedSnippets;
                balanceClaimPatchAttempted = Boolean(templateAttempt.balanceClaimPatchAttempted);
                balanceClaimPatchApplied = Boolean(templateAttempt.balanceClaimPatchApplied);
                balanceClaimPatchResource = templateAttempt.balanceClaimPatchResource;
                balanceClaimPatchFrom = templateAttempt.balanceClaimPatchFrom;
                balanceClaimPatchTo = templateAttempt.balanceClaimPatchTo;
                balanceClaimPatchReason = templateAttempt.balanceClaimPatchReason;
                if (templateAttempt.validationPassed) {
                  content = templateAttempt.content;
                  validation = templateAttempt.validation;
                  repaired = true;
                  secondValidation = "PASS";
                  classification = classifyResourceConsistency({ validation, repaired });
                  this.config.logger?.child("writer")?.info("resource-engine: template patch validation passed");
                  this.config.logger?.child("writer")?.info("resource-engine: blocking recovered by defer_exchange template patch");
                } else {
                  this.config.logger?.child("writer")?.warn("resource-engine: template patch validation failed");
                }
              }
            }
          }
        }
      } catch (error) {
        secondValidation = "FAILED";
        this.logWarn(params.language, {
          zh: `resource-blocking-rewrite 调用失败，保持 state-degraded：${error instanceof Error ? error.message : String(error)}`,
          en: `resource-blocking-rewrite failed; keeping state-degraded: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const repairSummary = repairResourceInconsistencies(params.content, {
      ...validation,
      issues: validation.issues,
    });
    const auditIssues = buildResourceAuditIssues({
      repair: {
        ...repairSummary,
        repairedIssues: repaired && validation.issues.length === 0
          ? (localRepair.repairedIssues.length > 0 ? localRepair.repairedIssues : originalIssues)
          : [],
        unresolvedIssues: validation.issues,
      },
      validation,
    });
    const finalAuditIssues = recoveryAttempted && secondValidation === "PASS"
      ? [
          ...auditIssues,
          {
            severity: "info" as const,
            category: "resource-consistency",
            description: templatePatchValidation === "PASS"
              ? "resource-consistency: defer_exchange 模板 patch 已删除本章现金兑现，资源链恢复自洽。"
              : "resource-consistency: Resource Engine blocking 已通过程序约束重写修复。",
            suggestion: templatePatchValidation === "PASS"
              ? "已按程序模板延后现金兑换，仍建议检查 resource-consistency report。"
              : "已按程序恢复资源链，仍建议检查 resource-consistency report。",
          },
        ]
      : auditIssues;
    if (classification.blocking) {
      this.config.logger?.child("writer")?.warn("resource-engine: second validation failed, blocking chapter");
      this.config.logger?.child("writer")?.warn("resource-engine: skipped particle_ledger update to avoid pollution");
      this.config.logger?.child("writer")?.warn("resource-engine: chapter status set to state-degraded");
    }
    const finalResourcePlanViolations = params.resourcePlan
      ? validateResourceEngineAgainstPlan({ text: content, validation, plan: params.resourcePlan })
      : [];
    const hasFinalResourcePlanViolations = finalResourcePlanViolations.length > 0;
    let finalAuditIssuesWithPlan: ReadonlyArray<AuditIssue> = finalAuditIssues;
    if (hasFinalResourcePlanViolations) {
      this.config.logger?.child("writer")?.warn(`resource-engine: final resource plan violations detected (${finalResourcePlanViolations.length}), forcing blocking state`);
      classification = {
        status: "FAILED",
        blocking: true,
        shouldPersistLedger: false,
        shouldPersistStateResources: false,
      };
      finalAuditIssuesWithPlan = [
        ...finalAuditIssues,
        ...buildResourcePlanAuditIssues(finalResourcePlanViolations),
      ];
    }

    const finalClosureStatus: ClosureStatus = classifyClosureStatus({
      hasResourcePlan: !!params.resourcePlan,
      hasEvents: validation.events.length > 0,
      hasIssues: validation.issues.length > 0,
      hasResourcePlanViolations: hasFinalResourcePlanViolations,
      blocking: classification.blocking,
      status: classification.status,
    });

    await this.writeResourceConsistencyReport({
      bookDir: params.bookDir,
      chapterNumber: params.chapterNumber,
      validation,
      status: classification.status,
      blocking: classification.blocking,
      closureStatus: finalClosureStatus,
      recoveryAttempted,
      recoveryPlan,
      secondValidation,
      recoveryPlanResult,
      fallbackRecoveryAttempted,
      fallbackRecoveryPlan,
      fallbackSecondValidation,
      templatePatchAttempted,
      templatePatchApplied,
      templatePatchValidation,
      templatePatchReason,
      removedCashFlowSnippets,
      balanceClaimPatchAttempted,
      balanceClaimPatchApplied,
      balanceClaimPatchResource,
      balanceClaimPatchFrom,
      balanceClaimPatchTo,
      balanceClaimPatchReason,
      filteredPseudoSkills: detectFilteredPseudoSkills(content),
      resourcePlan: params.resourcePlan,
      resourcePlanViolations: finalResourcePlanViolations,
    });

    return {
      content,
      wordCount: countChapterLength(content, params.lengthSpec.countingMode),
      validation,
      status: classification.status,
      blocking: classification.blocking,
      shouldPersistLedger: classification.shouldPersistLedger,
      shouldPersistStateResources: classification.shouldPersistStateResources,
      repaired,
      closureStatus: finalClosureStatus,
      ...(recoveryAttempted ? { recoveryAttempted } : {}),
      ...(recoveryPlan ? { recoveryPlan } : {}),
      ...(recoveryPlanResult ? { recoveryPlanResult } : {}),
      ...(fallbackRecoveryAttempted ? { fallbackRecoveryAttempted } : {}),
      ...(fallbackRecoveryPlan ? { fallbackRecoveryPlan } : {}),
      ...(fallbackSecondValidation ? { fallbackSecondValidation } : {}),
      ...(templatePatchAttempted ? { templatePatchAttempted } : {}),
      ...(templatePatchApplied ? { templatePatchApplied } : {}),
      ...(templatePatchValidation ? { templatePatchValidation } : {}),
      ...(templatePatchReason ? { templatePatchReason } : {}),
      ...(removedCashFlowSnippets.length > 0 ? { removedCashFlowSnippets } : {}),
      ...(balanceClaimPatchAttempted ? { balanceClaimPatchAttempted } : {}),
      ...(balanceClaimPatchApplied ? { balanceClaimPatchApplied } : {}),
      ...(balanceClaimPatchResource ? { balanceClaimPatchResource } : {}),
      ...(balanceClaimPatchFrom !== undefined ? { balanceClaimPatchFrom } : {}),
      ...(balanceClaimPatchTo !== undefined ? { balanceClaimPatchTo } : {}),
      ...(balanceClaimPatchReason ? { balanceClaimPatchReason } : {}),
      ...(detectFilteredPseudoSkills(content).length > 0 ? { filteredPseudoSkills: detectFilteredPseudoSkills(content) } : {}),
      ...(params.resourcePlan ? {
        resourcePlanMode: params.resourcePlan.mode,
        resourcePlanExpectedClosingBalances: params.resourcePlan.expectedClosingBalances,
        resourcePlanAllowedEvents: params.resourcePlan.allowedEvents,
        resourcePlanForbiddenEvents: params.resourcePlan.forbiddenEvents,
        resourcePlanViolations: finalResourcePlanViolations,
      } : {}),
      ...(secondValidation ? { secondValidation } : {}),
      auditIssues: finalAuditIssuesWithPlan,
      ...(tokenUsage ? { tokenUsage } : {}),
    };
  }

  private async tryResourceBlockingRewrite(params: {
    readonly rewriter: ResourceBlockingRewriterAgent;
    readonly content: string;
    readonly chapterIntent: string;
    readonly validation: ResourceValidationResult;
    readonly recoveryPlan: ReturnType<typeof selectResourceRecoveryPlan>;
    readonly bookRules: string;
    readonly currentLedger: string;
    readonly currentState: string;
    readonly lengthSpec: LengthSpec;
    readonly originalWordCount: number;
    readonly language: LengthLanguage;
    readonly logLabel: string;
    readonly isFallback?: boolean;
  }): Promise<{
    readonly accepted: boolean;
    readonly content: string;
    readonly validation: ResourceValidationResult;
    readonly usage?: TokenUsageSummary;
  }> {
    const rewritten = await params.rewriter.rewrite({
      chapterContent: params.content,
      chapterIntent: params.chapterIntent,
      validation: params.validation,
      recoveryPlan: params.recoveryPlan,
      bookRules: params.bookRules,
      currentLedger: params.currentLedger,
      currentState: params.currentState,
    });
    this.config.logger?.child("writer")?.info(params.isFallback
      ? "resource-engine: fallback recovery returned, validating by program"
      : "resource-engine: recovery rewrite returned, validating by program");
    const candidateValidation = this.revalidateResourceConsistency({
      content: rewritten.content,
      bookRules: params.bookRules,
      currentLedger: params.currentLedger,
      currentState: params.currentState,
      chapterIntent: params.chapterIntent,
    });
    const candidateClassification = classifyResourceConsistency({ validation: candidateValidation, repaired: true });
    const forbidden = hasForbiddenResourceRecoveryPhrase(rewritten.content, params.recoveryPlan);
    const afterWords = countChapterLength(rewritten.content, params.lengthSpec.countingMode);
    const accepted = rewritten.content.trim().length > 0
      && !forbidden
      && candidateValidation.issues.length === 0
      && !candidateClassification.blocking
      && (params.originalWordCount < this.minimumWholeChapterWords(params.lengthSpec)
        || afterWords >= Math.ceil(countChapterLength(params.content, params.lengthSpec.countingMode) * 0.8));
    this.logInfo(params.language, {
      zh: `rewrite decision [${params.logLabel}]: beforeWords=${countChapterLength(params.content, params.lengthSpec.countingMode)}, afterWords=${afterWords}, accepted=${accepted}, rejectedReason=${accepted ? "none" : forbidden ? "forbidden-resource-phrase-or-rule" : candidateValidation.issues.length > 0 ? "resource-validation-failed" : "below-80%-of-original-or-empty"}`,
      en: `rewrite decision [${params.logLabel}]: beforeWords=${countChapterLength(params.content, params.lengthSpec.countingMode)}, afterWords=${afterWords}, accepted=${accepted}, rejectedReason=${accepted ? "none" : forbidden ? "forbidden-resource-phrase-or-rule" : candidateValidation.issues.length > 0 ? "resource-validation-failed" : "below-80%-of-original-or-empty"}`,
    });
    return {
      accepted,
      content: rewritten.content,
      validation: candidateValidation,
      ...(rewritten.usage ? { usage: rewritten.usage } : {}),
    };
  }

  private tryDeferExchangeTemplatePatch(params: {
    readonly content: string;
    readonly bookRules: string;
    readonly currentLedger: string;
    readonly currentState: string;
    readonly chapterIntent: string;
    readonly recoveryPlan?: ReturnType<typeof selectResourceRecoveryPlan>;
  }): {
    readonly attempted: boolean;
    readonly applied: boolean;
    readonly validationPassed: boolean;
    readonly content: string;
    readonly validation: ResourceValidationResult;
    readonly reason?: string;
    readonly removedSnippets: ReadonlyArray<string>;
    readonly balanceClaimPatchAttempted?: boolean;
    readonly balanceClaimPatchApplied?: boolean;
    readonly balanceClaimPatchResource?: string;
    readonly balanceClaimPatchFrom?: number;
    readonly balanceClaimPatchTo?: number;
    readonly balanceClaimPatchReason?: string;
  } {
    if (params.recoveryPlan?.strategy !== "defer_exchange") {
      return {
        attempted: false,
        applied: false,
        validationPassed: false,
        content: params.content,
        validation: this.revalidateResourceConsistency({
          content: params.content,
          bookRules: params.bookRules,
          currentLedger: params.currentLedger,
          currentState: params.currentState,
          chapterIntent: params.chapterIntent,
        }),
        removedSnippets: [],
        balanceClaimPatchAttempted: false,
        balanceClaimPatchApplied: false,
      };
    }
    const patch = applyDeferExchangeTemplatePatch({
      chapterText: params.content,
      bookRules: params.bookRules,
      currentLedger: params.currentLedger,
      currentState: params.currentState,
    });
    if (!patch.patchApplied) {
      return {
        attempted: false,
        applied: false,
        validationPassed: false,
        content: params.content,
        validation: this.revalidateResourceConsistency({
          content: params.content,
          bookRules: params.bookRules,
          currentLedger: params.currentLedger,
          currentState: params.currentState,
          chapterIntent: params.chapterIntent,
        }),
        reason: patch.reason,
        removedSnippets: [],
        balanceClaimPatchAttempted: patch.balanceClaimPatchAttempted,
        balanceClaimPatchApplied: patch.balanceClaimPatchApplied,
        balanceClaimPatchResource: patch.balanceClaimPatchResource,
        balanceClaimPatchFrom: patch.balanceClaimPatchFrom,
        balanceClaimPatchTo: patch.balanceClaimPatchTo,
        balanceClaimPatchReason: patch.balanceClaimPatchReason,
      };
    }
    this.config.logger?.child("writer")?.info("resource-engine: applying defer_exchange template patch");
    this.config.logger?.child("writer")?.info(`resource-engine: removed ${patch.removedSnippets.length} cash-flow paragraph(s)`);
    this.config.logger?.child("writer")?.info("resource-engine: template patch returned, validating by program");
    const cleanAfterPatch = cleanNonNarrativeArtifacts(patch.patchedText);
    const contentForValidation = cleanAfterPatch.cleanedText;
    const validation = this.revalidateResourceConsistency({
      content: contentForValidation,
      bookRules: params.bookRules,
      currentLedger: params.currentLedger,
      currentState: params.currentState,
      chapterIntent: params.chapterIntent,
    });
    const classification = classifyResourceConsistency({ validation, repaired: true });
    const forbidden = hasForbiddenResourceRecoveryPhrase(contentForValidation, params.recoveryPlan);
    const requiredSkills = params.recoveryPlan.requiredEvents
      .filter((event) => event.kind === "unlock" && event.label)
      .map((event) => event.label!);
    const hasRequiredSkills = requiredSkills.every((skill) => validation.unlockedSkills.includes(skill));
    const openingFederalCoins = validation.openingBalances["联邦币"] ?? 0;
    const closingFederalCoins = validation.closingBalances["联邦币"] ?? openingFederalCoins;
    const closingReputation = validation.closingBalances["民望值"] ?? 0;
    const validationPassed = !forbidden
      && validation.issues.length === 0
      && !classification.blocking
      && hasRequiredSkills
      && closingFederalCoins <= openingFederalCoins
      && closingReputation >= 0;
    return {
      attempted: true,
      applied: true,
      validationPassed,
      content: contentForValidation,
      validation,
      reason: patch.reason,
      removedSnippets: [...patch.removedSnippets, ...cleanAfterPatch.removedSnippets],
      balanceClaimPatchAttempted: patch.balanceClaimPatchAttempted,
      balanceClaimPatchApplied: patch.balanceClaimPatchApplied,
      balanceClaimPatchResource: patch.balanceClaimPatchResource,
      balanceClaimPatchFrom: patch.balanceClaimPatchFrom,
      balanceClaimPatchTo: patch.balanceClaimPatchTo,
      balanceClaimPatchReason: patch.balanceClaimPatchReason,
    };
  }

  private async writeResourceConsistencyReport(params: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly validation: ResourceValidationResult;
    readonly status: string;
    readonly blocking: boolean;
    readonly recoveryAttempted?: boolean;
    readonly recoveryPlan?: ReturnType<typeof selectResourceRecoveryPlan>;
    readonly secondValidation?: "PASS" | "FAILED";
    readonly recoveryPlanResult?: "PASS" | "FAILED";
    readonly fallbackRecoveryAttempted?: boolean;
    readonly fallbackRecoveryPlan?: ReturnType<typeof selectResourceRecoveryPlan>;
    readonly fallbackSecondValidation?: "PASS" | "FAILED";
    readonly templatePatchAttempted?: boolean;
    readonly templatePatchApplied?: boolean;
    readonly templatePatchValidation?: "PASS" | "FAILED";
    readonly templatePatchReason?: string;
    readonly removedCashFlowSnippets?: ReadonlyArray<string>;
    readonly balanceClaimPatchAttempted?: boolean;
    readonly balanceClaimPatchApplied?: boolean;
    readonly balanceClaimPatchResource?: string;
    readonly balanceClaimPatchFrom?: number;
    readonly balanceClaimPatchTo?: number;
    readonly balanceClaimPatchReason?: string;
    readonly filteredPseudoSkills?: ReadonlyArray<string>;
    readonly resourcePlan?: ChapterResourcePlan;
    readonly resourcePlanViolations?: ReadonlyArray<string>;
    readonly closureStatus: ClosureStatus;
  }): Promise<void> {
    const padded = String(params.chapterNumber).padStart(4, "0");
    const reportDir = join(params.bookDir, "reviews", "resource-consistency");
    await mkdir(reportDir, { recursive: true });
    const events = params.validation.events.map((event) => ({
      kind: event.kind,
      resource: event.resource,
      amount: event.amount,
      targetResource: event.targetResource,
      label: event.label,
      evidence: event.evidence,
    }));
    const resourcePlanViolationCount = (params.resourcePlanViolations ?? []).length;
    const balanceMutationEvents = params.validation.events
      .filter((event) => event.kind === "gain" || event.kind === "consume" || event.kind === "balance_jump" || event.kind === "unlock")
      .map((event) => `${event.kind} ${event.resource}${event.amount !== undefined ? ` ${event.amount}` : ""}${event.label ? ` ${event.label}` : ""}: ${event.evidence}`);
    const noChangeInferred = Boolean(params.resourcePlan && isNoBalanceChangePlan(params.resourcePlan) && balanceMutationEvents.length === 0 && resourcePlanViolationCount === 0);
    const closureRequirement = params.resourcePlan?.closureRequirement
      ?? (params.resourcePlan && isNoBalanceChangePlan(params.resourcePlan) ? "inferred_no_change_allowed" : "-");
    const closureSource = noChangeInferred ? "inferred_no_change" : "-";
    const effectiveStatus = resourcePlanViolationCount > 0
      ? "BLOCKED_BY_RESOURCE_PLAN"
      : params.status;
    const effectiveBlocking = params.blocking || resourcePlanViolationCount > 0;
    const report = {
      chapter: params.chapterNumber,
      status: effectiveStatus,
      blocking: effectiveBlocking,
      events,
      openingBalances: params.validation.openingBalances,
      closingBalances: params.validation.closingBalances,
      unlockedSkills: params.validation.unlockedSkills,
      issues: params.validation.issues,
      suggestions: buildResourceRepairSuggestions(params.validation),
      recoveryAttempted: params.recoveryAttempted ?? false,
      recoveryPlan: params.recoveryPlan?.planId ?? null,
      recoveryPlanResult: params.recoveryPlanResult ?? null,
      secondValidation: params.secondValidation ?? null,
      fallbackRecoveryAttempted: params.fallbackRecoveryAttempted ?? false,
      fallbackRecoveryPlan: params.fallbackRecoveryPlan?.planId ?? null,
      fallbackSecondValidation: params.fallbackSecondValidation ?? null,
      templatePatchAttempted: params.templatePatchAttempted ?? false,
      templatePatchApplied: params.templatePatchApplied ?? false,
      templatePatchValidation: params.templatePatchValidation ?? null,
      templatePatchReason: params.templatePatchReason ?? null,
      removedCashFlowSnippets: params.removedCashFlowSnippets ?? [],
      balanceClaimPatchAttempted: params.balanceClaimPatchAttempted ?? false,
      balanceClaimPatchApplied: params.balanceClaimPatchApplied ?? false,
      balanceClaimPatchResource: params.balanceClaimPatchResource ?? null,
      balanceClaimPatchFrom: params.balanceClaimPatchFrom ?? null,
      balanceClaimPatchTo: params.balanceClaimPatchTo ?? null,
      balanceClaimPatchReason: params.balanceClaimPatchReason ?? null,
      filteredPseudoSkills: params.filteredPseudoSkills ?? [],
      resourcePlanMode: params.resourcePlan?.mode ?? null,
      resourcePlanExpectedClosingBalances: params.resourcePlan?.expectedClosingBalances ?? null,
      resourcePlanAllowedEvents: params.resourcePlan?.allowedEvents ?? [],
      resourcePlanForbiddenEvents: params.resourcePlan?.forbiddenEvents ?? [],
      resourcePlanViolations: params.resourcePlanViolations ?? [],
      closureStatus: params.closureStatus,
      closureRequirement,
      closureSource,
      noChangeInferred,
      balanceMutationEvents,
      forbiddenMutationHits: params.resourcePlanViolations ?? [],
    };
    await writeFile(join(reportDir, `${padded}.report.json`), JSON.stringify(report, null, 2), "utf-8");
    const issueLines = params.validation.issues.length
      ? params.validation.issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}\n  - 建议：${issue.suggestion}`)
      : resourcePlanViolationCount > 0 ? [] : ["- 无"];
    const eventLines = events.length
      ? events.map((event) => `- ${event.kind} ${event.resource}${event.amount !== undefined ? ` ${event.amount}` : ""}${event.targetResource ? ` -> ${event.targetResource}` : ""}：${event.evidence}`)
      : ["- 无"];
    const suggestionLines = resourcePlanViolationCount > 0
      ? []
      : report.suggestions.map((suggestion) => `- ${suggestion}`);
    const resourcePlanViolationLines = resourcePlanViolationCount > 0
      ? (params.resourcePlanViolations ?? []).map((violation) => `- [critical] ${violation}`)
      : ["- 无"];
    const resourcePlanProblemLines = resourcePlanViolationCount > 0
      ? (params.resourcePlanViolations ?? []).map((violation) => `- Resource Plan 违规：${violation}\n  - 建议：修复正文资源链使其符合 Resource Plan expectedClosingBalances 与 allowedEvents；本章未修复前不得标记 ready-for-review。`)
      : [];
    const resourcePlanSuggestionLines = resourcePlanViolationCount > 0
      ? [
          "- Resource Plan violations 存在，必须修复：",
          "  1. 检查 expectedClosingBalances 是否与正文结尾面板匹配",
          "  2. 检查 allowedEvents 是否全部出现在正文",
          "  3. 检查 forbiddenEvents 是否出现在正文",
          "  4. 修复后重新运行 write next 或人工修改正文",
        ]
      : [];
    await writeFile(join(reportDir, `${padded}.report.md`), [
      `# 第${params.chapterNumber}章 Resource Consistency Report`,
      "",
      `- 状态：${effectiveStatus}`,
      `- Blocking：${effectiveBlocking ? "YES" : "NO"}`,
      `- Recovery Attempted：${params.recoveryAttempted ? "YES" : "NO"}`,
      `- Recovery Plan：${params.recoveryPlan?.planId ?? "-"}`,
      `- Recovery Plan Result：${params.recoveryPlanResult ?? "-"}`,
      `- Fallback Recovery Attempted：${params.fallbackRecoveryAttempted ? "YES" : "NO"}`,
      `- Fallback Recovery Plan：${params.fallbackRecoveryPlan?.planId ?? "-"}`,
      `- Fallback Second Validation：${params.fallbackSecondValidation ?? "-"}`,
      `- Template Patch Attempted：${params.templatePatchAttempted ? "YES" : "NO"}`,
      `- Template Patch Applied：${params.templatePatchApplied ? "YES" : "NO"}`,
      `- Template Patch Validation：${params.templatePatchValidation ?? "-"}`,
      `- Template Patch Reason：${params.templatePatchReason ?? "-"}`,
      `- Balance Claim Patch Attempted：${params.balanceClaimPatchAttempted ? "YES" : "NO"}`,
      `- Balance Claim Patch Applied：${params.balanceClaimPatchApplied ? "YES" : "NO"}`,
      `- Balance Claim Patch：${params.balanceClaimPatchResource ?? "-"} ${params.balanceClaimPatchFrom ?? "-"} -> ${params.balanceClaimPatchTo ?? "-"} (${params.balanceClaimPatchReason ?? "-"})`,
      `- Filtered Pseudo Skills：${params.filteredPseudoSkills?.join("、") || "-"}`,
      `- Resource Plan Mode：${params.resourcePlan?.mode ?? "-"}`,
      `- Closure Status：${params.closureStatus}`,
      `- Closure Requirement：${closureRequirement}`,
      `- Closure Source：${closureSource}`,
      `- No Change Inferred：${noChangeInferred ? "YES" : "NO"}`,
      `- Second Validation：${params.secondValidation ?? "-"}`,
      "",
      "## 抽取事件",
      ...eventLines,
      "",
      "## 程序账本",
      "```json",
      JSON.stringify({
        openingBalances: params.validation.openingBalances,
        closingBalances: params.validation.closingBalances,
        unlockedSkills: params.validation.unlockedSkills,
        resourcePlanExpectedClosingBalances: params.resourcePlan?.expectedClosingBalances ?? null,
        resourcePlanViolations: params.resourcePlanViolations ?? [],
        closureStatus: params.closureStatus,
        closureRequirement,
        closureSource,
        noChangeInferred,
        balanceMutationEvents,
      }, null, 2),
      "```",
      "",
      "## Resource Plan",
      `- mode: ${params.resourcePlan?.mode ?? "-"}`,
      `- expectedClosingBalances: ${params.resourcePlan ? JSON.stringify(params.resourcePlan.expectedClosingBalances) : "-"}`,
      `- allowedEvents: ${params.resourcePlan ? params.resourcePlan.allowedEvents.length : 0}`,
      `- forbiddenEvents: ${params.resourcePlan ? params.resourcePlan.forbiddenEvents.length : 0}`,
      `- closureRequirement: ${closureRequirement}`,
      `- closureSource: ${closureSource}`,
      `- noChangeInferred: ${noChangeInferred ? "YES" : "NO"}`,
      `- balanceMutationEvents: ${balanceMutationEvents.length ? balanceMutationEvents.join("；") : "none"}`,
      `- forbiddenMutationHits: ${(params.resourcePlanViolations ?? []).length ? (params.resourcePlanViolations ?? []).join("；") : "none"}`,
      "",
      "## Resource Plan Violations",
      ...resourcePlanViolationLines,
      "",
      "## 问题",
      ...issueLines,
      ...resourcePlanProblemLines,
      "",
      "## 模板 Patch 删除片段",
      ...((params.removedCashFlowSnippets ?? []).length
        ? (params.removedCashFlowSnippets ?? []).map((snippet) => `- ${snippet}`)
        : ["- 无"]),
      "",
      "## 修复建议",
      ...suggestionLines,
      ...resourcePlanSuggestionLines,
      "",
    ].join("\n"), "utf-8");
  }

  private async writeCleanNarrativeReport(params: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly result: CleanNarrativeResult;
    readonly status: "PASS" | "CLEANED" | "FAILED";
    readonly blocking: boolean;
  }): Promise<void> {
    const padded = String(params.chapterNumber).padStart(4, "0");
    const reportDir = join(params.bookDir, "reviews", "clean-narrative");
    await mkdir(reportDir, { recursive: true });
    const report = {
      chapter: params.chapterNumber,
      status: params.status,
      blocking: params.blocking,
      changed: params.result.changed,
      artifacts: params.result.artifacts,
      removedSnippets: params.result.removedSnippets,
    };
    await writeFile(join(reportDir, `${padded}.report.json`), JSON.stringify(report, null, 2), "utf-8");
    const artifactLines = params.result.artifacts.length
      ? params.result.artifacts.map((artifact) => `- [${artifact.severity}] ${artifact.type}: ${artifact.reason}\n  - ${artifact.text}`)
      : ["- 无"];
    const removedLines = params.result.removedSnippets.length
      ? params.result.removedSnippets.map((snippet) => `- ${snippet}`)
      : ["- 无"];
    await writeFile(join(reportDir, `${padded}.report.md`), [
      `# 第${params.chapterNumber}章 Clean Narrative Report`,
      "",
      `- 状态：${params.status}`,
      `- Blocking：${params.blocking ? "YES" : "NO"}`,
      `- Changed：${params.result.changed ? "YES" : "NO"}`,
      "",
      "## 检测项",
      ...artifactLines,
      "",
      "## 删除片段",
      ...removedLines,
      "",
    ].join("\n"), "utf-8");
  }

  private revalidateResourceConsistency(params: {
    readonly content: string;
    readonly bookRules: string;
    readonly currentLedger: string;
    readonly currentState: string;
    readonly chapterIntent?: string;
    readonly validation?: ResourceValidationResult;
  }): ResourceValidationResult {
    const events = extractResourceEvents(params.content, params.bookRules, params.currentLedger);
    return validateResourceMath({
      events,
      currentLedger: params.currentLedger,
      currentState: params.currentState,
      bookRules: params.bookRules,
      chapterIntent: params.chapterIntent,
      chapterText: params.content,
    });
  }

  private sanitizeReportFilename(title: string): string {
    return title
      .replace(/[/\\?%*:|"<>]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
  }

  private async readWriteRetryHint(
    bookDir: string,
    chapterNumber: number,
  ): Promise<{ readonly content: string; readonly report: WriteRetryHintConsumption } | undefined> {
    const chapter = String(chapterNumber).padStart(4, "0");
    const hintFile = join(bookDir, "reviews", "write-retry-hints", `${chapter}.md`);
    const content = await readFile(hintFile, "utf-8").catch(() => "");
    if (!content.trim()) return undefined;

    return {
      content,
      report: {
        chapter,
        path: relativeToBookDir(bookDir, hintFile),
        consumed: false,
      },
    };
  }

  private async resetImportReplayTruthFiles(
    bookDir: string,
    language: LengthLanguage,
  ): Promise<void> {
    const storyDir = join(bookDir, "story");

    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        this.buildImportReplayStateSeed(language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        this.buildImportReplayHooksSeed(language),
        "utf-8",
      ),
      rm(join(storyDir, "chapter_summaries.md"), { force: true }),
      rm(join(storyDir, "subplot_board.md"), { force: true }),
      rm(join(storyDir, "emotional_arcs.md"), { force: true }),
      rm(join(storyDir, "character_matrix.md"), { force: true }),
      rm(join(storyDir, "volume_summaries.md"), { force: true }),
      rm(join(storyDir, "particle_ledger.md"), { force: true }),
      rm(join(storyDir, "memory.db"), { force: true }),
      rm(join(storyDir, "memory.db-shm"), { force: true }),
      rm(join(storyDir, "memory.db-wal"), { force: true }),
      rm(join(storyDir, "state"), { recursive: true, force: true }),
      rm(join(storyDir, "snapshots"), { recursive: true, force: true }),
    ]);
  }

  private buildImportReplayStateSeed(language: LengthLanguage): string {
    if (language === "en") {
      return [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 0 |",
        "| Current Location | (not set) |",
        "| Protagonist State | (not set) |",
        "| Current Goal | (not set) |",
        "| Current Constraint | (not set) |",
        "| Current Alliances | (not set) |",
        "| Current Conflict | (not set) |",
        "",
      ].join("\n");
    }

    return [
      "# 当前状态",
      "",
      "| 字段 | 值 |",
      "| --- | --- |",
      "| 当前章节 | 0 |",
      "| 当前位置 | （未设定） |",
      "| 主角状态 | （未设定） |",
      "| 当前目标 | （未设定） |",
      "| 当前限制 | （未设定） |",
      "| 当前敌我 | （未设定） |",
      "| 当前冲突 | （未设定） |",
      "",
    ].join("\n");
  }

  private buildImportReplayHooksSeed(language: LengthLanguage): string {
    if (language === "en") {
      return [
        "# Pending Hooks",
        "",
        "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "",
      ].join("\n");
    }

    return [
      "# 伏笔池",
      "",
      "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "",
    ].join("\n");
  }

  private async normalizeDraftLengthIfNeeded(params: {
    bookId: string;
    chapterNumber: number;
    chapterContent: string;
    lengthSpec: LengthSpec;
    chapterIntent?: string;
  }): Promise<{
    content: string;
    wordCount: number;
    applied: boolean;
    tokenUsage?: TokenUsageSummary;
  }> {
    const writerCount = countChapterLength(
      params.chapterContent,
      params.lengthSpec.countingMode,
    );
    if (!isOutsideSoftRange(writerCount, params.lengthSpec)) {
      return {
        content: params.chapterContent,
        wordCount: writerCount,
        applied: false,
      };
    }

    const normalizer = new LengthNormalizerAgent(
      this.agentCtxFor("length-normalizer", params.bookId),
    );
    const normalized = await normalizer.normalizeChapter({
      chapterContent: params.chapterContent,
      lengthSpec: params.lengthSpec,
      chapterIntent: params.chapterIntent,
    });

    // Safety net: if normalizer output is less than 25% of original, it was too destructive.
    // Reject and keep original content.
    if (normalized.finalCount < writerCount * 0.25) {
      this.logWarn(this.languageFromLengthSpec(params.lengthSpec), {
        zh: `字数归一化被拒绝：第${params.chapterNumber}章 ${writerCount} -> ${normalized.finalCount}（砍了${Math.round((1 - normalized.finalCount / writerCount) * 100)}%，超过安全阈值）`,
        en: `Length normalization rejected for chapter ${params.chapterNumber}: ${writerCount} -> ${normalized.finalCount} (cut ${Math.round((1 - normalized.finalCount / writerCount) * 100)}%, exceeds safety threshold)`,
      });
      return {
        content: params.chapterContent,
        wordCount: writerCount,
        applied: false,
      };
    }

    this.logInfo(this.languageFromLengthSpec(params.lengthSpec), {
      zh: `审计前字数归一化：第${params.chapterNumber}章 ${writerCount} -> ${normalized.finalCount}`,
      en: `Length normalization before audit for chapter ${params.chapterNumber}: ${writerCount} -> ${normalized.finalCount}`,
    });

    return {
      content: normalized.normalizedContent,
      wordCount: normalized.finalCount,
      applied: normalized.applied,
      tokenUsage: normalized.tokenUsage,
    };
  }

  private assertChapterContentNotEmpty(content: string, chapterNumber: number, stage: string): void {
    if (content.trim().length > 0) return;
    throw new Error(`Chapter ${chapterNumber} has empty chapter content after ${stage}`);
  }

  private async syncCurrentStateFactHistory(bookId: string, uptoChapter: number): Promise<void> {
    const bookDir = this.state.bookDir(bookId);
    try {
      await this.rebuildCurrentStateFactHistory(bookDir, uptoChapter);
    } catch (error) {
      if (this.isMemoryIndexUnavailableError(error)) {
        if (this.canOpenMemoryIndex(bookDir)) {
          try {
            await this.rebuildCurrentStateFactHistory(bookDir, uptoChapter);
            return;
          } catch (retryError) {
            error = retryError;
          }
        } else {
          if (!this.memoryIndexFallbackWarned) {
            this.memoryIndexFallbackWarned = true;
            this.logWarn(await this.resolveBookLanguageById(bookId), {
              zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
              en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
            });
            await this.logMemoryIndexDebugInfo(bookId, error);
          }
          return;
        }
      }
      this.logWarn(await this.resolveBookLanguageById(bookId), {
        zh: `状态事实同步已跳过：${String(error)}`,
        en: `State fact sync skipped: ${String(error)}`,
      });
    }
  }

  private async syncLegacyStructuredStateFromMarkdown(
    bookDir: string,
    chapterNumber: number,
    output?: {
      readonly runtimeStateDelta?: WriteChapterOutput["runtimeStateDelta"];
      readonly runtimeStateSnapshot?: WriteChapterOutput["runtimeStateSnapshot"];
    },
  ): Promise<void> {
    if (output?.runtimeStateDelta || output?.runtimeStateSnapshot) {
      return;
    }

    await rewriteStructuredStateFromMarkdown({
      bookDir,
      fallbackChapter: chapterNumber,
      skipDegradationCheck: this.config.skipStateDegradationCheck ?? (process.env.VITEST !== undefined || process.env.NODE_ENV === "test"),
    });
  }

  private async syncNarrativeMemoryIndex(bookId: string, fallbackChapter?: number): Promise<void> {
    const bookDir = this.state.bookDir(bookId);
    try {
      await this.rebuildNarrativeMemoryIndex(bookDir, fallbackChapter);
    } catch (error) {
      if (this.isMemoryIndexUnavailableError(error)) {
        if (this.canOpenMemoryIndex(bookDir)) {
          try {
            await this.rebuildNarrativeMemoryIndex(bookDir, fallbackChapter);
            return;
          } catch (retryError) {
            error = retryError;
          }
        } else {
          if (!this.memoryIndexFallbackWarned) {
            this.memoryIndexFallbackWarned = true;
            this.logWarn(await this.resolveBookLanguageById(bookId), {
              zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
              en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
            });
            await this.logMemoryIndexDebugInfo(bookId, error);
          }
          return;
        }
      }
      this.logWarn(await this.resolveBookLanguageById(bookId), {
        zh: `叙事记忆同步已跳过：${String(error)}`,
        en: `Narrative memory sync skipped: ${String(error)}`,
      });
    }
  }

  private async rebuildCurrentStateFactHistory(bookDir: string, uptoChapter: number): Promise<void> {
    const memoryDb = await this.withMemoryIndexRetry(async () => {
      const db = new MemoryDB(bookDir);
      try {
        db.resetFacts();

        const activeFacts = new Map<string, { id: number; object: string }>();

        for (let chapter = 0; chapter <= uptoChapter; chapter++) {
          const snapshotFacts = await loadSnapshotCurrentStateFacts(bookDir, chapter);
          if (snapshotFacts.length === 0) continue;
          const nextFacts = new Map<string, Omit<Fact, "id">>();

          for (const fact of snapshotFacts) {
            nextFacts.set(this.factKey(fact), {
              subject: fact.subject,
              predicate: fact.predicate,
              object: fact.object,
              validFromChapter: chapter,
              validUntilChapter: null,
              sourceChapter: chapter,
            });
          }

          for (const [key, previous] of activeFacts.entries()) {
            const next = nextFacts.get(key);
            if (!next || next.object !== previous.object) {
              db.invalidateFact(previous.id, chapter);
              activeFacts.delete(key);
            }
          }

          for (const [key, fact] of nextFacts.entries()) {
            if (activeFacts.has(key)) continue;
            const id = db.addFact(fact);
            activeFacts.set(key, { id, object: fact.object });
          }
        }

        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    });

    try {
      // No-op: keep the db open only for the duration of the rebuild.
    } finally {
      memoryDb.close();
    }
  }

  private async rebuildNarrativeMemoryIndex(bookDir: string, fallbackChapter?: number): Promise<void> {
    const memorySeed = await loadNarrativeMemorySeed(bookDir, fallbackChapter);

    const memoryDb = await this.withMemoryIndexRetry(() => {
      const db = new MemoryDB(bookDir);
      try {
        db.replaceSummaries(memorySeed.summaries);
        db.replaceHooks(memorySeed.hooks);
        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    });

    try {
      // No-op: keep the db open only for the duration of the rebuild.
    } finally {
      memoryDb.close();
    }
  }

  private canOpenMemoryIndex(bookDir: string): boolean {
    let memoryDb: MemoryDB | null = null;
    try {
      memoryDb = new MemoryDB(bookDir);
      return true;
    } catch {
      return false;
    } finally {
      memoryDb?.close();
    }
  }

  private async logMemoryIndexDebugInfo(bookId: string, error: unknown): Promise<void> {
    if (process.env.INKOS_DEBUG_SQLITE_MEMORY !== "1") {
      return;
    }

    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const message = error instanceof Error
      ? error.message
      : String(error);

    this.logWarn(await this.resolveBookLanguageById(bookId), {
      zh: `SQLite 记忆索引调试：node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
      en: `SQLite memory debug: node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
    });
  }

  private async withMemoryIndexRetry<T>(operation: () => Promise<T> | T): Promise<T> {
    const retryDelaysMs = [0, 25, 75];
    let lastError: unknown;

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isMemoryIndexBusyError(error) || attempt === retryDelaysMs.length - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt + 1]!));
      }
    }

    throw lastError;
  }

  private isMemoryIndexUnavailableError(error: unknown): boolean {
    if (!error) return false;

    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const message = error instanceof Error
      ? error.message
      : String(error);
    const normalizedMessage = message.trim();

    return /^No such built-in module:\s*node:sqlite$/i.test(normalizedMessage)
      || /^Cannot find module ['"]node:sqlite['"]$/i.test(normalizedMessage)
      || (code === "ERR_UNKNOWN_BUILTIN_MODULE" && /\bnode:sqlite\b/i.test(normalizedMessage));
  }

  private isMemoryIndexBusyError(error: unknown): boolean {
    if (!error) return false;

    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const message = error instanceof Error
      ? error.message
      : String(error);

    return code === "SQLITE_BUSY"
      || code === "SQLITE_LOCKED"
      || /\bSQLITE_BUSY\b/i.test(message)
      || /\bSQLITE_LOCKED\b/i.test(message)
      || /database is locked/i.test(message)
      || /database is busy/i.test(message);
  }

  private factKey(fact: Pick<Fact, "subject" | "predicate">): string {
    return `${fact.subject}::${fact.predicate}`;
  }

  private buildLengthWarnings(
    chapterNumber: number,
    finalCount: number,
    lengthSpec: LengthSpec,
  ): string[] {
    if (!isOutsideHardRange(finalCount, lengthSpec)) {
      return [];
    }
    return [
      this.localize(this.languageFromLengthSpec(lengthSpec), {
        zh: `第${chapterNumber}章经过一次字数归一化后仍超出硬区间（${lengthSpec.hardMin}-${lengthSpec.hardMax}，实际 ${finalCount}）。`,
        en: `Chapter ${chapterNumber} remains outside hard range (${lengthSpec.hardMin}-${lengthSpec.hardMax}, actual ${finalCount}) after a single normalization pass.`,
      }),
    ];
  }

  private buildLengthTelemetry(params: {
    lengthSpec: LengthSpec;
    writerCount: number;
    postWriterNormalizeCount: number;
    postReviseCount: number;
    finalCount: number;
    normalizeApplied: boolean;
    lengthWarning: boolean;
  }): LengthTelemetry {
    return {
      target: params.lengthSpec.target,
      softMin: params.lengthSpec.softMin,
      softMax: params.lengthSpec.softMax,
      hardMin: params.lengthSpec.hardMin,
      hardMax: params.lengthSpec.hardMax,
      countingMode: params.lengthSpec.countingMode,
      writerCount: params.writerCount,
      postWriterNormalizeCount: params.postWriterNormalizeCount,
      postReviseCount: params.postReviseCount,
      finalCount: params.finalCount,
      normalizeApplied: params.normalizeApplied,
      lengthWarning: params.lengthWarning,
    };
  }

  private async persistAuditDriftGuidance(params: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly issues: ReadonlyArray<AuditIssue>;
    readonly language: LengthLanguage;
  }): Promise<void> {
    const storyDir = join(params.bookDir, "story");
    const driftPath = join(storyDir, "audit_drift.md");
    const statePath = join(storyDir, "current_state.md");
    const currentState = await readFile(statePath, "utf-8").catch(() => "");
    const sanitizedState = this.stripAuditDriftCorrectionBlock(currentState).trimEnd();

    if (sanitizedState !== currentState) {
      await writeFile(statePath, sanitizedState, "utf-8");
    }

    if (params.issues.length === 0) {
      await rm(driftPath, { force: true }).catch(() => undefined);
      return;
    }

    const block = [
      this.localize(params.language, {
        zh: "# 审计纠偏",
        en: "# Audit Drift",
      }),
      "",
      this.localize(params.language, {
        zh: "## 审计纠偏（自动生成，下一章写作前参照）",
        en: "## Audit Drift Correction",
      }),
      "",
      this.localize(params.language, {
        zh: `> 第${params.chapterNumber}章审计发现以下问题，下一章写作时必须避免：`,
        en: `> Chapter ${params.chapterNumber} audit found the following issues to avoid in the next chapter:`,
      }),
      ...params.issues.map((issue) => `> - [${issue.severity}] ${issue.category}: ${issue.description}`),
      "",
    ].join("\n");

    await writeFile(driftPath, block, "utf-8");
  }

  private stripAuditDriftCorrectionBlock(currentState: string): string {
    const headers = [
      "## 审计纠偏（自动生成，下一章写作前参照）",
      "## Audit Drift Correction",
      "# 审计纠偏",
      "# Audit Drift",
    ];

    let cutIndex = -1;
    for (const header of headers) {
      const index = currentState.indexOf(header);
      if (index >= 0 && (cutIndex < 0 || index < cutIndex)) {
        cutIndex = index;
      }
    }

    if (cutIndex < 0) {
      return currentState;
    }

    return currentState.slice(0, cutIndex).trimEnd();
  }

  private logLengthWarnings(lengthWarnings: ReadonlyArray<string>): void {
    for (const warning of lengthWarnings) {
      this.config.logger?.warn(warning);
    }
  }

  private restoreLostAuditIssues(previous: AuditResult, next: AuditResult): AuditResult {
    if (next.passed || next.issues.length > 0 || previous.issues.length === 0) {
      return next;
    }

    return {
      ...next,
      issues: previous.issues,
      summary: next.summary || previous.summary,
    };
  }

  private restoreActionableAuditIfLost(
    previous: {
      auditResult: AuditResult;
      aiTellCount: number;
      blockingCount: number;
      criticalCount: number;
      revisionBlockingIssues: ReadonlyArray<AuditIssue>;
    },
    next: {
      auditResult: AuditResult;
      aiTellCount: number;
      blockingCount: number;
      criticalCount: number;
      revisionBlockingIssues: ReadonlyArray<AuditIssue>;
    },
  ): MergedAuditEvaluation {
    const auditResult = this.restoreLostAuditIssues(previous.auditResult, next.auditResult);
    if (auditResult === next.auditResult) {
      return next;
    }

    return {
      ...next,
      auditResult,
      revisionBlockingIssues: previous.revisionBlockingIssues,
      blockingCount: previous.blockingCount,
      criticalCount: previous.criticalCount,
    };
  }

  private async evaluateMergedAudit(params: {
    auditor: ContinuityAuditor;
    book: BookConfig;
    bookDir: string;
    chapterContent: string;
    chapterNumber: number;
    language: LengthLanguage;
    auditOptions?: {
      temperature?: number;
      chapterIntent?: string;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      truthFileOverrides?: {
        currentState?: string;
        ledger?: string;
        hooks?: string;
      };
    };
  }): Promise<MergedAuditEvaluation> {
    const llmAudit = await params.auditor.auditChapter(
      params.bookDir,
      params.chapterContent,
      params.chapterNumber,
      params.book.genre,
      params.auditOptions,
    );
    const aiTells = analyzeAITells(params.chapterContent, params.language);
    const sensitiveResult = analyzeSensitiveWords(params.chapterContent, undefined, params.language);
    const longSpanFatigue = await analyzeLongSpanFatigue({
      bookDir: params.bookDir,
      chapterNumber: params.chapterNumber,
      chapterContent: params.chapterContent,
      language: params.language,
    });
    const hasBlockedWords = sensitiveResult.found.some((f) => f.severity === "block");
    const issues: ReadonlyArray<AuditIssue> = [
      ...llmAudit.issues,
      ...aiTells.issues,
      ...sensitiveResult.issues,
      ...longSpanFatigue.issues,
    ];
    // revisionBlockingIssues excludes long-span-fatigue issues by
    // construction (not by category name) so that an LLM-reported issue
    // sharing a category label with a long-span issue is still counted.
    const revisionBlockingIssues: ReadonlyArray<AuditIssue> = [
      ...llmAudit.issues,
      ...aiTells.issues,
      ...sensitiveResult.issues,
    ];

    return {
      auditResult: {
        passed: hasBlockedWords ? false : llmAudit.passed,
        issues,
        summary: llmAudit.summary,
        tokenUsage: llmAudit.tokenUsage,
      },
      aiTellCount: aiTells.issues.length,
      blockingCount: revisionBlockingIssues.filter((issue) => issue.severity === "warning" || issue.severity === "critical").length,
      criticalCount: revisionBlockingIssues.filter((issue) => issue.severity === "critical").length,
      revisionBlockingIssues,
    };
  }

  private async markBookActiveIfNeeded(bookId: string): Promise<void> {
    const book = await this.state.loadBookConfig(bookId);
    if (book.status !== "outlining") return;

    await this.state.saveBookConfig(bookId, {
      ...book,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
  }

  private async createGovernedArtifacts(
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    externalContext?: string,
    options?: {
      readonly reuseExistingIntentWhenContextMissing?: boolean;
      readonly skipPlanningValidation?: boolean;
    },
  ): Promise<{
    plan: PlanChapterOutput;
    composed: Awaited<ReturnType<ComposerAgent["composeChapter"]>>;
  }> {
    const plan = await this.resolveGovernedPlan(book, bookDir, chapterNumber, externalContext, options);
    const skipPlanning = options?.skipPlanningValidation ?? this.config.skipPlanningValidation ?? (process.env.VITEST !== undefined || process.env.NODE_ENV === "test");

    // P0-4: 前 10 章规划完整性高精度校验
    if (chapterNumber <= 10 && !skipPlanning) {
      const first10PlanPath = join(bookDir, "story/first_10_chapter_plan.md");
      const first10Plan = await readFile(first10PlanPath, "utf-8").catch(() => "");
      const planValidation = validateFirst10ChapterPlan(first10Plan);
      if (!planValidation.passed) {
        const existingIndex = await this.state.loadChapterIndex(book.id);
        const errorMsg = `[planning-degraded] First 10 Chapter Plan validation failed: ${planValidation.reason}`;
        const now = new Date().toISOString();
        const existingEntry = existingIndex.find((e) => e.number === chapterNumber);
        const newEntry: ChapterMeta = {
          number: chapterNumber,
          title: existingEntry?.title ?? `Chapter ${chapterNumber}`,
          status: "planning-degraded",
          wordCount: existingEntry?.wordCount ?? 0,
          createdAt: existingEntry?.createdAt ?? now,
          updatedAt: now,
          auditIssues: existingEntry?.auditIssues
            ? [...new Set([...existingEntry.auditIssues, errorMsg])]
            : [errorMsg],
          lengthWarnings: existingEntry?.lengthWarnings ?? [],
          lengthTelemetry: existingEntry?.lengthTelemetry,
        };
        const existingIdx = existingIndex.findIndex((e) => e.number === chapterNumber);
        const updatedIndex = existingIdx >= 0
          ? existingIndex.map((e, i) => i === existingIdx ? newEntry : e)
          : [...existingIndex, newEntry];
        await this.state.saveChapterIndex(book.id, updatedIndex);

        throw new Error(`Planning degraded: Chapter ${chapterNumber} <= 10 and first_10_chapter_plan.md validation failed. Reason: ${planValidation.reason}. Status marked as planning-degraded.`);
      }
    }

    // P0-3: 规划/伏笔空白硬拦截
    if (chapterNumber > 1 && !skipPlanning) {
      const goalIsBlank = !plan.intent.chapterGoal ||
        !plan.intent.chapterGoal.protagonistGoal ||
        /^(?:未设定|无|none|)$/i.test(plan.intent.chapterGoal.protagonistGoal.trim());
      const hooksAreBlank = !plan.intent.hookAgenda || (
        (!plan.intent.hookAgenda.pressureMap || plan.intent.hookAgenda.pressureMap.length === 0) &&
        (!plan.intent.hookAgenda.mustAdvance || plan.intent.hookAgenda.mustAdvance.length === 0) &&
        (!plan.intent.hookAgenda.eligibleResolve || plan.intent.hookAgenda.eligibleResolve.length === 0) &&
        (!plan.intent.hookAgenda.staleDebt || plan.intent.hookAgenda.staleDebt.length === 0)
      );

      if (goalIsBlank && hooksAreBlank) {
        const previousState = await readFile(join(bookDir, "story/current_state.md"), "utf-8").catch(() => "");
        const previousHooks = await readFile(join(bookDir, "story/pending_hooks.md"), "utf-8").catch(() => "");
        const hasPrevState = previousState.trim() && !/未更新/.test(previousState) && previousState.includes("-");
        const hasPrevHooks = previousHooks.trim() && !/未更新/.test(previousHooks) && previousHooks.includes("|");

        if (hasPrevState || hasPrevHooks) {
          throw new Error(`Planning collapse: Chapter ${chapterNumber} resolved plan has blank goal and empty hook agenda, but previous chapter has active state/hooks. Blocking execution to prevent planning blindness.`);
        }
      }
    }

    const composer = new ComposerAgent(this.agentCtxFor("composer", book.id));
    const composed = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber,
      plan,
    });

    return { plan, composed };
  }

  private async resolveGovernedPlan(
    book: BookConfig,
    bookDir: string,
    chapterNumber: number,
    externalContext?: string,
    options?: {
      readonly reuseExistingIntentWhenContextMissing?: boolean;
      readonly skipPlanningValidation?: boolean;
    },
  ): Promise<PlanChapterOutput> {
    if (
      options?.reuseExistingIntentWhenContextMissing &&
      (!externalContext || externalContext.trim().length === 0)
    ) {
      const persisted = await loadPersistedPlan(bookDir, chapterNumber);
      if (persisted) return persisted;
    }

    const planner = new PlannerAgent(this.agentCtxFor("planner", book.id));
    return planner.planChapter({
      book,
      bookDir,
      chapterNumber,
      externalContext,
    });
  }

  private async emitWebhook(
    event: WebhookEvent,
    bookId: string,
    chapterNumber?: number,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.config.notifyChannels || this.config.notifyChannels.length === 0) return;
    await dispatchWebhookEvent(this.config.notifyChannels, {
      event,
      bookId,
      chapterNumber,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  private async readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const reviewedDir = join(bookDir, "chapters-reviewed");
    const reviewedFile = join(reviewedDir, `${paddedNum}_final.md`);
    
    let raw: string;
    try {
      raw = await readFile(reviewedFile, "utf-8");
    } catch {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!chapterFile) {
        throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir} or ${reviewedDir}`);
      }
      raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    }

    const lines = raw.split("\n");
    const firstNonEmptyIndex = lines.findIndex((l) => l.trim().length > 0);
    if (firstNonEmptyIndex >= 0) {
      const firstLine = lines[firstNonEmptyIndex]!.trim();
      const isHeading = firstLine.startsWith("#") || /^(第\s*\d+\s*章|Chapter\s*\d+)/i.test(firstLine);
      if (isHeading) {
        const contentStart = lines.findIndex((l, i) => i > firstNonEmptyIndex && l.trim().length > 0);
        return contentStart >= 0 ? lines.slice(contentStart).join("\n") : "";
      }
    }
    return raw;
  }
}

function buildResourceRepairSuggestions(validation: ResourceValidationResult): string[] {
  if (validation.issues.length === 0) {
    return ["资源账本校验通过，无需人工处理。"];
  }
  const blockingLike = validation.issues.some((issue) =>
    issue.severity === "critical"
    || issue.code === "balance-mismatch"
    || issue.code === "exchange-rate-mismatch"
    || issue.code === "exchange-ratio-mismatch"
    || issue.code === "skill-cost-mismatch"
    || issue.code === "missing-skill-unlock"
    || issue.code === "negative-balance"
    || issue.code === "resource-rule-conflict"
    || issue.code === "unauthorized-resource-rule");
  const suggestions = blockingLike
    ? [
        "修复前不要基于本章继续续写。",
        "优先让正文资源事件满足程序账本，而不是修改兑换比例。",
      ]
    : [
        "本章存在轻微资源提示，可人工复核后继续。",
        "优先让正文资源事件满足程序账本，而不是修改兑换比例。",
      ];
  if (validation.issues.some((issue) => issue.code === "negative-balance")) {
    suggestions.push("若资源余额不足，延后兑换、补足合理获得事件，或降低本章收益/消耗，不要发明透支规则。");
  }
  if (validation.issues.some((issue) => issue.code === "exchange-rate-mismatch" || issue.code === "exchange-ratio-mismatch")) {
    suggestions.push("按 book_rules 中的兑换比例修正消耗与收益，例如 1点民望值=10联邦币 时，1000联邦币必须消耗100民望值。");
  }
  if (validation.issues.some((issue) => issue.code === "unauthorized-resource-rule")) {
    suggestions.push("删除正文中的透支/负债/信用额度设定；除非 book_rules 显式声明 allowNegative 或 creditLimit。");
  }
  return suggestions;
}

function buildResourcePlanAuditIssues(violations: ReadonlyArray<string>): AuditIssue[] {
  return [...new Set(violations)].map((violation) => ({
    severity: "critical" as const,
    category: "resource-plan",
    description: `RESOURCE_PLAN_NOT_CLOSED: ${violation}`,
    suggestion: "Resource Plan 是本章资源真相；修复正文资源链并二次验证通过前，不得更新 state/ledger，也不得标记 ready-for-review。",
  }));
}

function detectResourceIndexReadinessBlocker(params: {
  readonly auditIssues: ReadonlyArray<AuditIssue>;
  readonly updatedState: string;
  readonly resourceBlocking: boolean;
}): { readonly reason: string } | undefined {
  if (params.resourceBlocking) {
    return { reason: "Resource Engine blocking=true" };
  }
  const issueText = params.auditIssues
    .map((issue) => `${issue.category ?? ""} ${issue.description} ${issue.suggestion}`)
    .join("\n");
  const resourceIssuePattern = /RESOURCE_PLAN_NOT_CLOSED|resource-plan|resource-consistency:\s*程序账本校验(?:仍)?失败|resource-consistency:.*需人工确认|balance-mismatch|exchange-rate-mismatch|negative-balance|resource-rule-conflict|missing-skill-unlock|unlockedSkills\s*为空|资源账本校验存在冲突/u;
  if (resourceIssuePattern.test(issueText)) {
    return { reason: "auditIssues contain unresolved resource consistency markers" };
  }
  const stateConflictPattern = /当前资源[^|\n]*(?:资源账本校验存在冲突|需人工确认|未确认|待人工处理|state conflict)|资源账本校验存在冲突，需人工确认/u;
  if (stateConflictPattern.test(params.updatedState)) {
    return { reason: "current_state resource field is unresolved" };
  }
  return undefined;
}

function buildFallbackRecoveryPlan(params: {
  readonly validation: ResourceValidationResult;
  readonly chapterIntent: string;
  readonly failedPlan: ReturnType<typeof selectResourceRecoveryPlan>;
}): ReturnType<typeof selectResourceRecoveryPlan> | undefined {
  if (params.failedPlan.strategy !== "add_earned_resource_before_spend") return undefined;
  return buildResourceRecoveryPlans({
    validation: params.validation,
    chapterIntent: params.chapterIntent,
  }).find((plan) => plan.strategy === "defer_exchange");
}

function isExchangeStrategyAllowed(params: {
  resourceRules: ResourceRules;
  planMode: string;
}): boolean {
  const hasExchangeRates = params.resourceRules.exchangeRates.length > 0;
  // Only block exchange when the plan mode explicitly forbids resource events
  const exchangeBlocked = ["system_bootstrap", "resource_rule_reveal"].includes(params.planMode);
  return hasExchangeRates && !exchangeBlocked;
}
