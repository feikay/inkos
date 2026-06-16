// Models
export { type BookConfig, type Platform, type Genre, type BookStatus, type FanficMode, type WebnovelTemplate, type BookType, type NumericExpressionMode, type WritingRules, BookConfigSchema, PlatformSchema, GenreSchema, BookStatusSchema, FanficModeSchema, WebnovelTemplateSchema, BookTypeSchema, NumericExpressionModeSchema, WritingRulesSchema } from "./models/book.js";
export { type ChapterMeta, type ChapterStatus, ChapterMetaSchema, ChapterStatusSchema } from "./models/chapter.js";
export { type ProjectConfig, type LLMConfig, type NotifyChannel, type DetectionConfig, type QualityGates, type AgentLLMOverride, type InputGovernanceMode, ProjectConfigSchema, LLMConfigSchema, AgentLLMOverrideSchema, DetectionConfigSchema, QualityGatesSchema, InputGovernanceModeSchema } from "./models/project.js";
export { type CurrentState, type ParticleLedger, type PendingHooks, type PendingHook, type LedgerEntry } from "./models/state.js";
export { type GenreProfile, type ParsedGenreProfile, GenreProfileSchema, parseGenreProfile } from "./models/genre-profile.js";
export { type BookRules, type ParsedBookRules, BookRulesSchema, parseBookRules } from "./models/book-rules.js";
export { type DetectionHistoryEntry, type DetectionStats } from "./models/detection.js";
export { type StyleProfile } from "./models/style-profile.js";
export { type LengthCountingMode, type LengthNormalizeMode, type LengthSpec, type LengthTelemetry, type LengthWarning, LengthCountingModeSchema, LengthNormalizeModeSchema, LengthSpecSchema, LengthTelemetrySchema, LengthWarningSchema } from "./models/length-governance.js";
export {
  type RuntimeStateLanguage,
  type StateManifest,
  type HookStatus,
  type HookRecord,
  type HooksState,
  type ChapterSummaryRow,
  type ChapterSummariesState,
  type CurrentStateFact,
  type CurrentStateState,
  type CurrentStatePatch,
  type HookOps,
  type NewHookCandidate,
  type RuntimeStateDelta,
  RuntimeStateLanguageSchema,
  StateManifestSchema,
  HookStatusSchema,
  HookRecordSchema,
  HooksStateSchema,
  ChapterSummaryRowSchema,
  ChapterSummariesStateSchema,
  CurrentStateFactSchema,
  CurrentStateStateSchema,
  CurrentStatePatchSchema,
  HookOpsSchema,
  NewHookCandidateSchema,
  RuntimeStateDeltaSchema,
} from "./models/runtime-state.js";
export {
  type ChapterConflict,
  type EndingHookType,
  type ChapterGoal,
  type HookMovement,
  type HookPressureLevel,
  type HookPressure,
  type ChapterIntent,
  type ContextSource,
  type ContextPackage,
  type RuleLayerScope,
  type RuleLayer,
  type OverrideEdge,
  type ActiveOverride,
  type RuleStackSections,
  type RuleStack,
  type ChapterTrace,
  ChapterConflictSchema,
  EndingHookTypeSchema,
  ChapterGoalSchema,
  HookMovementSchema,
  HookPressureLevelSchema,
  HookPressureSchema,
  ChapterIntentSchema,
  ContextSourceSchema,
  ContextPackageSchema,
  RuleLayerScopeSchema,
  RuleLayerSchema,
  OverrideEdgeSchema,
  ActiveOverrideSchema,
  RuleStackSectionsSchema,
  RuleStackSchema,
  ChapterTraceSchema,
} from "./models/input-governance.js";
export { PlannerAgent, type PlanChapterInput, type PlanChapterOutput } from "./agents/planner.js";
export { ChapterIntentAgent, type ChapterIntentInput, type ChapterIntentResult } from "./agents/chapter-intent.js";
export {
  IntentAlignmentReviewerAgent,
  INTENT_ALIGNMENT_DIMENSIONS,
  type IntentAlignmentDimension,
  type IntentAlignmentIssue,
  type IntentAlignmentReport,
  type IntentAlignmentReviewInput,
  type IntentAlignmentScores,
  type IntentAlignmentSeverity,
  type IntentAlignmentStatus,
} from "./agents/intent-alignment-reviewer.js";
export {
  StoryEffectivenessAgent,
  STORY_EFFECTIVENESS_DIMENSIONS,
  writeStoryEffectivenessReportFiles,
  buildSkippedEffectivenessReport,
  renderStoryEffectivenessMarkdown,
  type StoryEffectivenessDimension,
  type StoryEffectivenessStatus,
  type StoryEffectivenessIssue,
  type StoryEffectivenessReport,
  type StoryEffectivenessReviewInput,
} from "./agents/story-effectiveness.js";
export {
  Golden3ChapterAgent,
  GOLDEN_3_CHAPTER_DIMENSIONS,
  writeGolden3ChapterReportFiles,
  buildSkippedGolden3ChapterReport,
  renderGolden3ChapterMarkdown,
  readGolden3ChapterSummary,
  type Golden3ChapterDimension,
  type Golden3ChapterStatus,
  type Golden3ChapterIssue,
  type Golden3ChapterReport,
  type Golden3ChapterReviewInput,
} from "./agents/golden-3-chapter.js";
export {
  OpeningHookReviewerAgent,
  OPENING_HOOK_DIMENSIONS,
  writeOpeningHookReportFiles,
  buildSkippedOpeningHookReport,
  renderOpeningHookMarkdown,
  readOpeningHookSummary,
  type OpeningHookDimension,
  type OpeningHookStatus,
  type HookStrength,
  type OpeningHookIssue,
  type OpeningHookChecklist,
  type OpeningHookReviewReport,
  type OpeningHookReviewInput,
} from "./agents/opening-hook-reviewer.js";
export {
  AntagonistIntelligenceReviewerAgent,
  ANTAGONIST_INTELLIGENCE_DIMENSIONS,
  writeAntagonistIntelligenceReportFiles,
  renderAntagonistIntelligenceMarkdown,
  readAntagonistIntelligenceSummary,
  type AntagonistIntelligenceDimension,
  type AntagonistIntelligenceStatus,
  type AntagonistIntelligenceIssue,
  type AntagonistIntelligenceReport,
  type AntagonistIntelligenceReviewInput,
} from "./agents/antagonist-intelligence.js";
export {
  TransitionQualityReviewerAgent,
  TRANSITION_QUALITY_DIMENSIONS,
  writeTransitionQualityReportFiles,
  buildSkippedTransitionQualityReport,
  renderTransitionQualityMarkdown,
  readTransitionQualitySummary,
  type TransitionQualityDimension,
  type TransitionQualityStatus,
  type TransitionQualityIssue,
  type TransitionQualityReport,
  type TransitionQualityReviewInput,
} from "./agents/transition-quality.js";
export {
  SixStepPlotReviewerAgent,
  SIX_STEP_PLOT_DIMENSIONS,
  writeSixStepPlotReportFiles,
  buildSkippedSixStepPlotReport,
  renderSixStepPlotMarkdown,
  readSixStepPlotSummary,
  type SixStepPlotDimension,
  type SixStepPlotStatus,
  type SixStepPlotIssue,
  type SixStepPlotMethodCompliance,
  type SixStepPlotIntentFidelity,
  type SixStepPlotReport,
  type SixStepPlotReviewInput,
} from "./agents/six-step-plot-reviewer.js";
export {
  ResourceBlockingRewriterAgent,
  ResourceConsistencyReviserAgent,
  buildAuthoritativeResourceContext,
  buildResourceAuditIssues,
  buildResourceLedgerUpdate,
  buildResourceRecoveryPlans,
  classifyClosureStatus,
  classifyResourceConsistency,
  computeResourceLedger,
  detectFilteredPseudoSkills,
  extractResourceEvents,
  hasForbiddenResourceRecoveryPhrase,
  parseResourceRules,
  repairResourceInconsistencies,
  selectResourceRecoveryPlan,
  syncBalanceClaimsWithLedger,
  syncCurrentStateResources,
  validateResourceMath,
  type ClosureStatus,
  type ResourceConsistencyPipelineResult,
  type ResourceConsistencyStatus,
  type ResourceEvent,
  type ResourceMathIssue,
  type ResourceRepairResult,
  type ResourceRecoveryPlan,
  type ResourceRecoveryStrategy,
  type ResourceValidationResult,
} from "./agents/resource-consistency.js";
export { ComposerAgent, type ComposeChapterInput, type ComposeChapterOutput } from "./agents/composer.js";
export {
  cleanNonNarrativeArtifacts,
  detectNonNarrativeArtifacts,
  type CleanNarrativeResult,
  type NonNarrativeArtifact,
} from "./agents/clean-narrative.js";
export {
  buildChapterResourcePlan,
  renderResourcePlanForPrompt,
  sanitizeIntentAgainstResourcePlan,
  preScanTextAgainstResourcePlan,
  validateIntentAgainstResourcePlan,
  validateResourceEngineAgainstPlan,
  type ChapterResourcePlan,
  type ChapterResourcePlanMode,
  type PlannedResourceEvent,
} from "./agents/resource-plan.js";
export { validateStyleGuard, type StyleGuardChapter, type StyleGuardOptions, type StyleGuardResult } from "./validators/style-guard.js";
export { validateConsistencyGuard, type ConsistencyGuardResult } from "./validators/consistency-guard.js";
export { analyzePatternBreaker, analyzeChapterPattern, type ChapterPatternAnalysis, type NarrativePatternTag, type PatternBreakerResult } from "./validators/pattern-breaker.js";
export { validateRegressionChapters, type RegressionChapter, type RegressionValidationScore } from "./validators/regression-validation.js";
export {
  AutomationModeSchema,
  type AutomationMode,
  normalizeAutomationMode,
} from "./interaction/modes.js";
export {
  InteractionIntentTypeSchema,
  type InteractionIntentType,
  InteractionRequestSchema,
  type InteractionRequest,
} from "./interaction/intents.js";
export {
  ExecutionStatusSchema,
  ExecutionStateSchema,
  InteractionEventSchema,
  type ExecutionStatus,
  type ExecutionState,
  type InteractionEvent,
  isTerminalExecutionStatus,
} from "./interaction/events.js";
export {
  BookCreationDraftSchema,
  DraftRoundSchema,
  PendingDecisionSchema,
  InteractionMessageSchema,
  InteractionSessionSchema,
  type BookCreationDraft,
  type DraftRound,
  type PendingDecision,
  type InteractionMessage,
  type InteractionSession,
  bindActiveBook,
  clearCreationDraft,
  clearPendingDecision,
  updateAutomationMode,
  updateCreationDraft,
  appendInteractionMessage,
  appendInteractionEvent,
  BookSessionSchema,
  GlobalSessionSchema,
  type BookSession,
  type GlobalSession,
  createBookSession,
  appendBookSessionMessage,
} from "./interaction/session.js";
export {
  resolveProjectSessionPath,
  createProjectSession,
  loadProjectSession,
  persistProjectSession,
  resolveSessionActiveBook,
  loadGlobalSession,
  persistGlobalSession,
} from "./interaction/project-session-store.js";
export {
  loadBookSession,
  persistBookSession,
  listBookSessions,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  createAndPersistBookSession,
  SessionAlreadyMigratedError,
} from "./interaction/book-session-store.js";
export { routeInteractionRequest } from "./interaction/request-router.js";
export {
  routeNaturalLanguageIntent,
  type NaturalLanguageRoutingContext,
} from "./interaction/nl-router.js";
export {
  processProjectInteractionInput,
  processProjectInteractionRequest,
} from "./interaction/project-control.js";
export { createInteractionToolsFromDeps } from "./interaction/project-tools.js";
export { buildExportArtifact, writeExportArtifact } from "./interaction/export-artifact.js";
export {
  normalizeTruthFileName,
  classifyTruthAuthority,
  type TruthAuthority,
} from "./interaction/truth-authority.js";
export {
  executeEditTransaction,
  planEditTransaction,
  type EditRequest,
  type EditExecutionDeps,
  type ExecutedEditTransaction,
  type PlannedEditTransaction,
} from "./interaction/edit-controller.js";
export {
  runInteractionRequest,
  type InteractionRuntimeTools,
  type InteractionRuntimeResult,
} from "./interaction/runtime.js";
export {
  parseDraftDirectives,
  createDirectiveStreamFilter,
  type ParsedDraftResponse,
} from "./interaction/draft-directive-parser.js";

// Short story mode
export * from "./short-story/index.js";

// Story methods
export * from "./story-methods/index.js";

// Agent (pi-agent integration)
export * from "./agent/index.js";

// LLM
export { createLLMClient, chatCompletion, chatWithTools, createStreamMonitor, PartialResponseError, type LLMClient, type LLMResponse, type LLMMessage, type ToolDefinition, type ToolCall, type AgentMessage, type ChatWithToolsResult, type StreamProgress, type OnStreamProgress } from "./llm/provider.js";
export { logLlmStart, logLlmSuccess, logLlmError, withLlmUsageLogging, normalizeProviderUsage, type LlmTokenUsage, type LlmUsageRecord } from "./llm/usageLogger.js";
export {
  SERVICE_PRESETS,
  SERVICE_TO_PI_PROVIDER,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServicePiProvider,
  resolveServiceModelsBaseUrl,
  guessServiceFromBaseUrl,
  listModelsForService,
  listServicesWithModelCount,
  type ServicePreset,
  type ModelInfo,
} from "./llm/service-presets.js";
export { resolveServiceModel, type ResolvedModel } from "./llm/service-resolver.js";
export { loadSecrets, saveSecrets, getServiceApiKey, type SecretsFile } from "./llm/secrets.js";
export { migrateConfig, type MigrationResult } from "./llm/config-migration.js";

// Agents
export { BaseAgent, type AgentContext } from "./agents/base.js";
export { ArchitectAgent, type ArchitectOutput } from "./agents/architect.js";
export { WriterAgent, type WriteChapterInput, type WriteChapterOutput, type TokenUsage } from "./agents/writer.js";
export { LengthNormalizerAgent, type NormalizeLengthInput, type NormalizeLengthOutput } from "./agents/length-normalizer.js";
export { ContinuityAuditor, type AuditResult, type AuditIssue } from "./agents/continuity.js";
export {
  runChapterContinuityCheck,
  runLocalChapterContinuityCheck,
  runChapterContinuityFix,
  renderContinuityMarkdown,
  buildContinuityRewritePrompt,
  buildManualFixPrompt,
  resolveContinuityLevel,
  resolveContinuityRewriteMode,
  resolveContinuityStatus,
  chapterNumberPrefix,
  safeFixedChapterFilename,
  type ContinuityIssue,
  type ContinuityFinalStatus,
  type ContinuityLevel,
  type ContinuityReport,
  type ContinuityRewriteMode,
  type ContinuityStatus,
  type RunContinuityCheckInput,
  type RunContinuityFixInput,
} from "./agents/chapter-continuity.js";
export {
  runFanqieQualityCheck,
  runLocalFanqieQualityCheck,
  renderFanqieQualityMarkdown,
  buildFanqiePolishPrompt,
  resolveFanqieQualityLevel,
  resolveFanqieQualityStatus,
  type FanqieQualityIssue,
  type FanqieFinalQualityStatus,
  type FanqieQualityLevel,
  type FanqieQualityReport,
  type FanqieQualityScores,
  type FanqieQualitySeverity,
  type FanqieQualityStatus,
  type RunFanqieQualityCheckInput,
} from "./agents/fanqie-quality.js";
export { ReviserAgent, DEFAULT_REVISE_MODE, type ReviseOutput, type ReviseMode } from "./agents/reviser.js";
export { RadarAgent, type RadarResult, type RadarRecommendation } from "./agents/radar.js";
export { FanqieRadarSource, QidianRadarSource, TextRadarSource, type RadarSource, type PlatformRankings, type RankingEntry } from "./agents/radar-source.js";
export { readGenreProfile, readBookRules, listAvailableGenres, getBuiltinGenresDir } from "./agents/rules-reader.js";
export { buildWriterSystemPrompt } from "./agents/writer-prompts.js";
export { analyzeAITells, type AITellResult, type AITellIssue } from "./agents/ai-tells.js";
export { analyzeSensitiveWords, type SensitiveWordResult, type SensitiveWordMatch } from "./agents/sensitive-words.js";
export { detectAIContent, type DetectionResult } from "./agents/detector.js";
export { analyzeStyle } from "./agents/style-analyzer.js";
export { analyzeDetectionInsights } from "./agents/detection-insights.js";
export { validatePostWrite, detectParagraphLengthDrift, detectParagraphShapeWarnings, detectDuplicateTitle, type PostWriteViolation } from "./agents/post-write-validator.js";
export { ChapterAnalyzerAgent, type AnalyzeChapterInput, type AnalyzeChapterOutput } from "./agents/chapter-analyzer.js";
export { parseWriterOutput, parseCreativeOutput, type ParsedWriterOutput, type CreativeOutput } from "./agents/writer-parser.js";
export { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./agents/settler-prompts.js";
export { parseSettlementOutput, type SettlementOutput } from "./agents/settler-parser.js";
export { parseSettlerDeltaOutput, type SettlerDeltaOutput } from "./agents/settler-delta-parser.js";
export { FanficCanonImporter, type FanficCanonOutput } from "./agents/fanfic-canon-importer.js";
export { getFanficDimensionConfig, FANFIC_DIMENSIONS, type FanficDimensionConfig } from "./agents/fanfic-dimensions.js";
export { buildFanficCanonSection, buildCharacterVoiceProfiles, buildFanficModeInstructions } from "./agents/fanfic-prompt-sections.js";
export { ChapterCompressorAgent } from "./agents/chapter-compressor.js";

// Utils
export { fetchUrl, searchWeb } from "./utils/web-search.js";
export { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "./utils/context-filter.js";
export { extractPOVFromOutline, filterMatrixByPOV, filterHooksByPOV } from "./utils/pov-filter.js";
export { ConsolidatorAgent } from "./agents/consolidator.js";
export { MemoryDB, type Fact, type StoredSummary } from "./state/memory-db.js";
export { StateValidatorAgent } from "./agents/state-validator.js";
export { loadRuntimeStateSnapshot, buildRuntimeStateArtifacts, saveRuntimeStateSnapshot, loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts, type RuntimeStateArtifacts, type NarrativeMemorySeed } from "./state/runtime-state-store.js";
export { splitChapters, type SplitChapter } from "./utils/chapter-splitter.js";
export { countChapterLength, resolveLengthCountingMode, formatLengthCount, buildLengthSpec, isOutsideSoftRange, isOutsideHardRange, chooseNormalizeMode, type LengthLanguage } from "./utils/length-metrics.js";
export { buildNumericExpressionGuidance, buildNumericExpressionGuidanceForBook, readBookNumericExpressionMode, resolveNumericExpressionMode, type NumericExpressionResolution } from "./utils/numeric-expression-mode.js";
export { createLogger, createStderrSink, createJsonLineSink, nullSink, type Logger, type LogSink, type LogLevel, type LogEntry } from "./utils/logger.js";
export { loadProjectConfig, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH, isApiKeyOptionalForEndpoint } from "./utils/config-loader.js";
export { computeAnalytics, type AnalyticsData, type TokenStats } from "./utils/analytics.js";
export {
  collectStaleHookDebt,
  evaluateHookAdmission,
  classifyHookDisposition,
  type HookAdmissionCandidate,
  type HookAdmissionDecision,
  type HookDisposition,
} from "./utils/hook-governance.js";
export { arbitrateRuntimeStateDeltaHooks, type HookArbiterDecision, cleanHooksMarkdown, isStructuralHookId } from "./utils/hook-arbiter.js";
export { analyzeHookHealth } from "./utils/hook-health.js";
export {
  readStructureSignals,
  writeStructureSignals,
  validateStructureSignals,
  createEmptyStructureSignals,
  parseArchitectStructureSignals,
  matchStructureSignals,
  buildStructureSignalReport,
  inspectStructureSignals,
  validateStructureSignalsFull,
  appendStructureSignal,
  STRUCTURE_SIGNAL_DIMENSIONS,
  StructureSignalsSchema,
  type StructureSignals,
  type StructureSignalDimension,
  type StructureSignalMatch,
  type StructureSignalReport,
  type StructureSignalsReadResult,
  type ParseArchitectStructureSignalsResult,
  MIN_PHRASES_PER_DIMENSION,
  MIN_TOTAL_PHRASES,
  type InspectStructureSignalsResult,
  type ValidateStructureSignalsResult,
  type AppendStructureSignalResult,
} from "./utils/structure-signals.js";

// Chapter scope gate
export {
  parseChapterScopeBoundaries,
  evaluateChapterScopeGate,
  buildChapterScopeConstraintBlock,
  buildStructureSignalsScopeConstraint,
  buildChapterRepairBoundaryBlock,
  type ChapterScopeBoundaries,
  type ChapterScopeGateResult,
  type ChapterScopeIssue,
  type ChapterScopeGateInput,
} from "./utils/chapter-scope-gate.js";

// Pipeline
export { PipelineRunner, type PipelineConfig, type ChapterPipelineResult, type DraftResult, type PlanChapterResult, type ComposeChapterResult, type ReviseResult, type TruthFiles, type BookStatusInfo, type ImportChaptersInput, type ImportChaptersResult, type TokenUsageSummary } from "./pipeline/runner.js";
export { Scheduler, type SchedulerConfig } from "./pipeline/scheduler.js";
export { runAgentLoop, AGENT_TOOLS as AGENT_TOOLS, type AgentLoopOptions } from "./pipeline/agent.js";
export { detectChapter, detectAndRewrite, loadDetectionHistory, type DetectChapterResult, type DetectAndRewriteResult } from "./pipeline/detection-runner.js";

// State
export { StateManager } from "./state/manager.js";
export { bootstrapStructuredStateFromMarkdown } from "./state/state-bootstrap.js";
export { renderCurrentStateProjection, renderHooksProjection, renderChapterSummariesProjection } from "./state/state-projections.js";
export { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "./state/state-reducer.js";
export { validateRuntimeState, type RuntimeStateValidationIssue } from "./state/state-validator.js";

// Notify
export { dispatchNotification, dispatchWebhookEvent, type NotifyMessage } from "./notify/dispatcher.js";
export { sendTelegram, type TelegramConfig } from "./notify/telegram.js";
export { sendFeishu, type FeishuConfig } from "./notify/feishu.js";
export { sendWechatWork, type WechatWorkConfig } from "./notify/wechat-work.js";
export { sendWebhook, type WebhookConfig, type WebhookEvent, type WebhookPayload } from "./notify/webhook.js";
