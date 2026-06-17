import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import { readGenreProfile } from "./rules-reader.js";
import type { BookConfig } from "../models/book.js";
import { parseBookRules } from "../models/book-rules.js";
import { CurrentStateStateSchema } from "../models/runtime-state.js";
import {
  ChapterIntentSchema,
  type ChapterConflict,
  type ChapterGoal,
  type ChapterIntent,
  type EndingType,
  type MoodDirective,
} from "../models/input-governance.js";
import type { StoredHook } from "../state/memory-db.js";
import {
  parseChapterSummariesMarkdown,
  renderHookSnapshot,
  renderSummarySnapshot,
  retrieveMemorySelection,
} from "../utils/memory-retrieval.js";
import { parseCurrentStateFacts, parsePendingHooksMarkdown } from "../utils/story-markdown.js";
import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import { buildPlannerHookAgenda } from "../utils/hook-agenda.js";
import { buildChapterGoal } from "../utils/chapter-goal-builder.js";
import { readStructureSignals } from "../utils/structure-signals.js";
import {
  summarizeArcMap,
  summarizeGenreProfile,
  summarizePowerSystem,
} from "../utils/webnovel-inputs.js";
import { describeHookLifecycle, resolveHookPayoffTiming } from "../utils/hook-lifecycle.js";
import { renderCurrentStateProjection } from "../state/state-projections.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

interface OutlineSelection {
  readonly node?: string;
  readonly matchedAnchor: boolean;
  readonly source: "exact" | "range" | "fallback-first" | "fallback-any" | "missing";
}

interface ContinuityAnchor {
  readonly goal?: string;
  readonly outlineNode?: string;
  readonly summaryText?: string;
  readonly firstSummaryText?: string;
}

interface PlannerHookThrottle {
  readonly activeCount: number;
  readonly cap: number;
  readonly suggestedNewHookCap: number;
  readonly shouldThrottle: boolean;
  readonly recentOpenBias: boolean;
  readonly pressuredHookIds: ReadonlyArray<string>;
}

interface HookPressureStateEntry {
  readonly hookId: string;
  readonly state: "normal" | "due" | "overdue" | "must-resolve-now" | "soft-progress";
  readonly timing: string;
  readonly type: string;
  readonly expectedPayoff: string;
  readonly notes: string;
}

interface HookEmergenceDirective {
  readonly pressureStates: ReadonlyArray<HookPressureStateEntry>;
  readonly mustMaterializeHookNow: boolean;
  readonly hookExecutionPhase?: "any" | "late";
  readonly targetHook?: HookPressureStateEntry;
}

interface PlannerCurrentStateResolution {
  readonly markdown: string;
  readonly sourcePath: string;
}

interface ContinuityGoalResolution {
  readonly goal: string;
  readonly conflict?: ChapterConflict;
}

type GoalIntensity = "low" | "medium" | "high";

interface GoalArbitrationResult {
  readonly goal: string;
  readonly goalIntensity: GoalIntensity;
  readonly mustAvoid: ReadonlyArray<string>;
  readonly conflict?: ChapterConflict;
}

/** Normalize Chinese numerals to Arabic digits so "两百" and "200" produce matching bigrams. */
function normalizeNumerals(raw: string): string {
  return raw
    .replace(/零/g, "0")
    .replace(/〇/g, "0")
    .replace(/一/g, "1")
    .replace(/二/g, "2")
    .replace(/两/g, "2")
    .replace(/三/g, "3")
    .replace(/四/g, "4")
    .replace(/五/g, "5")
    .replace(/六/g, "6")
    .replace(/七/g, "7")
    .replace(/八/g, "8")
    .replace(/九/g, "9");
}

export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const sourcePaths = {
      authorIntent: join(storyDir, "author_intent.md"),
      currentFocus: join(storyDir, "current_focus.md"),
      storyBible: join(storyDir, "story_bible.md"),
      volumeOutline: join(storyDir, "volume_outline.md"),
      chapterSummaries: join(storyDir, "chapter_summaries.md"),
      bookRules: join(storyDir, "book_rules.md"),
      currentState: join(storyDir, "current_state.md"),
      pendingHooks: join(storyDir, "pending_hooks.md"),
      foreshadowRegistry: join(storyDir, "foreshadow_registry.json"),
      genreProfile: join(storyDir, "genre_profile.yaml"),
      arcMap: join(storyDir, "arc_map.yaml"),
      powerSystem: join(storyDir, "power_system.yaml"),
    } as const;

    const [
      authorIntent,
      currentFocus,
      storyBible,
      volumeOutline,
      chapterSummaries,
      bookRulesRaw,
      currentStateMarkdown,
      pendingHooksRaw,
      foreshadowRegistryRaw,
      genreProfileRaw,
      arcMapRaw,
      powerSystemRaw,
    ] = await Promise.all([
      this.readFileOrDefault(sourcePaths.authorIntent),
      this.readFileOrDefault(sourcePaths.currentFocus),
      this.readFileOrDefault(sourcePaths.storyBible),
      this.readFileOrDefault(sourcePaths.volumeOutline),
      this.readFileOrDefault(sourcePaths.chapterSummaries),
      this.readFileOrDefault(sourcePaths.bookRules),
      this.readFileOrDefault(sourcePaths.currentState),
      this.readFileOrDefault(sourcePaths.pendingHooks),
      this.readFileOrDefault(sourcePaths.foreshadowRegistry),
      this.readFileOrDefault(sourcePaths.genreProfile),
      this.readFileOrDefault(sourcePaths.arcMap),
      this.readFileOrDefault(sourcePaths.powerSystem),
    ]);
    const language = this.isChineseLanguage(input.book.language) ? "zh" : "en";
    const structureSignalResult = await readStructureSignals(storyDir);
    const structureSignals = structureSignalResult.status === "ok" ? structureSignalResult.signals.signals : undefined;
    const resolvedCurrentState = await this.resolveCurrentStateForPlanning({
      storyDir,
      chapterNumber: input.chapterNumber,
      language,
      currentStateMarkdown,
      chapterSummaries,
    });
    const currentState = resolvedCurrentState.markdown;
    const preferLatestStateAnchor = resolvedCurrentState.sourcePath !== sourcePaths.currentState;
    const genreProfileBase = summarizeGenreProfile(genreProfileRaw, language);
    const parsedGenreResult = await readGenreProfile(this.ctx.projectRoot, input.book.genre).catch(() => null);
    const genreProfileMeta = parsedGenreResult?.profile;
    const genreProfile: typeof genreProfileBase = genreProfileMeta
      ? {
        ...genreProfileBase,
        concretePayoffObjects: genreProfileMeta.concretePayoffObjects ?? genreProfileBase.concretePayoffObjects,
        defaultPayoffActions: genreProfileMeta.structuralSignals?.defaultPayoffActions ?? genreProfileBase.defaultPayoffActions,
        numericalSystem: genreProfileMeta.numericalSystem ?? genreProfileBase.numericalSystem,
        powerScaling: genreProfileMeta.powerScaling ?? genreProfileBase.powerScaling,
      }
      : genreProfileBase;
    const arcMap = summarizeArcMap(arcMapRaw, input.chapterNumber, language);
    const powerSystem = summarizePowerSystem(powerSystemRaw, language);

    const outlineSelection = this.resolveOutlineSelection(volumeOutline, input.chapterNumber);
    const continuityAnchor = this.buildContinuityAnchor({
      currentState,
      currentFocus,
      chapterSummaries,
      chapterNumber: input.chapterNumber,
    });
    const outlineLooksStale = this.shouldDeprioritizeOutlineNode({
      chapterNumber: input.chapterNumber,
      outlineSelection,
      continuityAnchor,
    });
    const outlineNode = outlineLooksStale
      ? continuityAnchor.outlineNode
      : outlineSelection.node;
    const matchedOutlineAnchor = outlineLooksStale
      ? false
      : outlineSelection.matchedAnchor;
    const derivedGoal = this.deriveGoal(
      input.externalContext,
      currentFocus,
      authorIntent,
      (outlineLooksStale || preferLatestStateAnchor) ? continuityAnchor.goal : undefined,
      outlineNode,
      arcMap.goalHint,
      input.chapterNumber,
    );
    const continuityGoal = this.applyContinuityGoalOverride({
      chapterNumber: input.chapterNumber,
      goal: derivedGoal,
      continuityAnchor,
      outlineNode,
      preferLatestStateAnchor,
    });
    let goal = this.ensureGoalFallback({
      goal: continuityGoal.goal,
      currentState,
      chapterSummaries,
      pendingHooksRaw,
      chapterNumber: input.chapterNumber,
      language,
      moodDirective: undefined,
    });
    const parsedRules = parseBookRules(bookRulesRaw);
    const mustKeepBase = this.unique([
      ...this.collectMustKeep(currentState, storyBible),
      ...powerSystem.mustKeep,
    ]).slice(0, 6);
    const mustAvoidBase = this.unique([
      ...this.collectMustAvoid(currentFocus, parsedRules.rules.prohibitions),
      ...genreProfile.mustAvoid,
      ...powerSystem.mustAvoid,
    ]).slice(0, 8);
    const styleEmphasis = this.unique([
      ...this.collectStyleEmphasis(authorIntent, currentFocus, input.chapterNumber),
      ...genreProfile.styleEmphasis,
    ]).slice(0, 6);
    const conflicts = this.collectConflicts(
      input.externalContext,
      currentFocus,
      outlineNode,
      volumeOutline,
      outlineLooksStale,
    );
    const resolvedOutlineNode = conflicts.length > 0 ? undefined : outlineNode;
    const resolvedMatchedAnchor = resolvedOutlineNode ? matchedOutlineAnchor : false;
    const memorySelection = await retrieveMemorySelection({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode: resolvedOutlineNode,
      mustKeep: mustKeepBase,
    });
    const activeHookCount = memorySelection.activeHooks.filter(
      (hook) => this.isActiveHookAtChapter(hook, input.chapterNumber),
    ).length;
    const chapterSupportedHooks = memorySelection.activeHooks.filter((hook) =>
      this.isHookSupportedByChapterContext({
        hook,
        chapterNumber: input.chapterNumber,
        currentFocus,
        currentState,
        outlineNode: resolvedOutlineNode,
        goal,
      }),
    );
    let hookAgenda = buildPlannerHookAgenda({
      hooks: chapterSupportedHooks,
      chapterNumber: input.chapterNumber,
      targetChapters: input.book.targetChapters,
      language: input.book.language ?? "zh",
    });
    const hookThrottle = this.buildPlannerHookThrottle({
      activeHooks: memorySelection.activeHooks,
      chapterSummaries,
      chapterNumber: input.chapterNumber,
      hookAgenda,
    });
    let hookEmergence = this.buildHookEmergenceDirective({
      hooks: chapterSupportedHooks,
      chapterNumber: input.chapterNumber,
      targetChapters: input.book.targetChapters,
    });
    const recentSummaries = parseChapterSummariesMarkdown(chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => left.chapter - right.chapter)
      .slice(-4);
    const cadence = analyzeChapterCadence({
      language: this.isChineseLanguage(input.book.language) ? "zh" : "en",
      rows: recentSummaries.map((summary) => ({
        chapter: summary.chapter,
        title: summary.title,
        mood: summary.mood,
        chapterType: summary.chapterType,
      })),
    });
    const recentEndingTypes = await this.readRecentEndingTypes(storyDir, input.chapterNumber, 4);
    const lastEndingType = recentEndingTypes.at(-1);
    let directives = this.buildStructuredDirectives({
      chapterNumber: input.chapterNumber,
      language: input.book.language,
      volumeOutline,
      outlineNode: resolvedOutlineNode,
      matchedOutlineAnchor: resolvedMatchedAnchor,
      cadence,
      arcMapDirective: arcMap.arcDirective,
      hookEmergence,
      goalIntensity: this.inferGoalIntensity(goal),
      lastEndingType,
      recentEndingTypes,
    });
    const breathHookGovernance = this.applyBreathHookGovernance({
      directives,
      hookAgenda,
      hookEmergence,
      language,
    });
    directives = breathHookGovernance.directives;
    hookAgenda = breathHookGovernance.hookAgenda;
    hookEmergence = breathHookGovernance.hookEmergence;
    goal = this.ensureGoalFallback({
      goal,
      currentState,
      chapterSummaries,
      pendingHooksRaw,
      chapterNumber: input.chapterNumber,
      language,
      moodDirective: directives.moodDirective,
    });
    const goalArbitration = this.arbitrateGoalWithMood({
      goal,
      goalIntensity: this.inferGoalIntensity(goal),
      moodDirective: directives.moodDirective,
      language,
    });
    goal = goalArbitration.goal;

    const rawChapterGoal = buildChapterGoal({
      language,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode: resolvedOutlineNode,
      currentFocus,
      currentState,
      chapterSummaries,
      pendingHooksRaw,
      foreshadowRegistryRaw,
      hookAgenda,
      selectedHooks: chapterSupportedHooks,
      protagonistName: parsedRules.rules.protagonist?.name,
      arcMap,
      genreProfile,
      powerSystem,
      structureSignals,
    });
    const cadenceAdjustedChapterGoal = this.applyCadenceChapterGoalOverrides(rawChapterGoal, cadence, genreProfileMeta);
    const resilientChapterGoal = this.ensureChapterGoalFallback({
      chapterGoal: cadenceAdjustedChapterGoal,
      goal,
      currentState,
      chapterSummaries,
      pendingHooksRaw,
      chapterNumber: input.chapterNumber,
      language,
      moodDirective: directives.moodDirective,
    });
    const singlePayoffGovernance = this.enforceSingleChapterPayoff({
      chapterGoal: resilientChapterGoal,
      language,
    });
    const concreteEventPayoffGovernance = this.enforceConcreteEventPayoff({
      chapterGoal: singlePayoffGovernance.chapterGoal,
      language,
      currentState,
      currentFocus,
      chapterNumber: input.chapterNumber,
      parsedRules,
      genreProfile: genreProfileMeta,
      structureSignals,
    });
    const revealExecutablePayoffGovernance = this.enforceExecutableRevealPayoff({
      chapterGoal: concreteEventPayoffGovernance.chapterGoal,
      language,
      currentState,
      chapterSummaries,
    });
    const breathPayoffGovernance = this.enforceBreathCompatiblePayoff({
      chapterGoal: revealExecutablePayoffGovernance.chapterGoal,
      directives,
      language,
      currentState,
    });
    const breakthroughPayoffGovernance = this.applyBreakthroughPayoffTrigger({
      chapterGoal: breathPayoffGovernance.chapterGoal,
      language,
      currentState,
      genreProfile: genreProfileMeta,
    });
    const payoffGovernance = this.applyPayoffDirectiveGovernance(breakthroughPayoffGovernance.chapterGoal, language);
    const chapterGoal = this.repairChapterPlanControlMainConflict({
      chapterGoal: payoffGovernance.chapterGoal,
      goal,
      currentState,
      chapterSummaries,
      pendingHooksRaw,
      chapterNumber: input.chapterNumber,
      language,
      moodDirective: directives.moodDirective,
      structureSignals,
    });
    const payoffHookGovernance = this.applyPayoffHookGovernance({
      chapterGoal,
      directives,
      hookAgenda,
      hookEmergence,
      language,
    });
    directives = payoffHookGovernance.directives;
    hookAgenda = payoffHookGovernance.hookAgenda;
    hookEmergence = payoffHookGovernance.hookEmergence;
    const mustKeep = this.unique([
      ...mustKeepBase,
      ...this.buildHookEmergenceMustKeep(hookEmergence, language),
    ]).slice(0, 6);
    const mustAvoid = this.unique([
      ...mustAvoidBase,
      ...this.buildHookEmergenceMustAvoid(hookEmergence, language),
    ]).slice(0, 8);
    const payoffDirectives = this.applySinglePayoffDirectiveNote({
      directives,
      directiveNote: this.unique([
        singlePayoffGovernance.directiveNote,
        concreteEventPayoffGovernance.directiveNote,
        revealExecutablePayoffGovernance.directiveNote,
        breathPayoffGovernance.directiveNote,
        breakthroughPayoffGovernance.directiveNote,
      ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" "),
    });
    const payoffPrioritizedDirectives = this.applyPayoffEndingPriority({
      directives: payoffDirectives,
      chapterGoal,
      language,
    });
    const intensityBudget = this.applyIntensityBudget({
      chapterGoal,
      hookAgenda,
      directives: payoffPrioritizedDirectives,
      language,
    });
    const sceneBudget = this.applySceneBudget({
      chapterGoal,
      hookAgenda: intensityBudget.hookAgenda,
      hookEmergence,
      directives: intensityBudget.directives,
      language,
    });
    const throttleConflicts = this.buildHookDebtThrottleConflicts(hookThrottle, chapterGoal.foreshadowToTouch);
    const cadenceMustAvoid = this.buildCadenceMustAvoid(language, cadence);

    const mandatoryItems = this.collectMandatoryItems({
      chapterNumber: input.chapterNumber,
      language,
      currentFocus,
      currentState,
      pendingHooks: memorySelection.hooks,
      chapterGoal,
      hookAgenda: sceneBudget.hookAgenda,
    });

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal,
      goalIntensity: goalArbitration.goalIntensity,
      outlineNode,
      ...sceneBudget.directives,
      mustKeep,
      mustAvoid: this.unique([
        ...mustAvoid,
        ...cadenceMustAvoid,
        ...this.buildHookDebtMustAvoid(hookThrottle, language),
        ...goalArbitration.mustAvoid,
        ...payoffGovernance.mustAvoid,
        ...sceneBudget.mustAvoid,
      ]).slice(0, 8),
      styleEmphasis,
      conflicts: [
        ...conflicts,
        ...(continuityGoal.conflict ? [continuityGoal.conflict] : []),
        ...(goalArbitration.conflict ? [goalArbitration.conflict] : []),
        ...(concreteEventPayoffGovernance.conflict ? [concreteEventPayoffGovernance.conflict] : []),
        ...(revealExecutablePayoffGovernance.conflict ? [revealExecutablePayoffGovernance.conflict] : []),
        ...(breathPayoffGovernance.conflict ? [breathPayoffGovernance.conflict] : []),
        ...(breathHookGovernance.conflict ? [breathHookGovernance.conflict] : []),
        ...(payoffHookGovernance.conflict ? [payoffHookGovernance.conflict] : []),
        ...(intensityBudget.conflict ? [intensityBudget.conflict] : []),
        ...throttleConflicts,
      ],
      chapterGoal,
      hookAgenda: sceneBudget.hookAgenda,
      mandatoryItems,
    });

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(
      intent,
      input.book.language ?? "zh",
      renderHookSnapshot(memorySelection.hooks, input.book.language ?? "zh"),
      renderSummarySnapshot(memorySelection.summaries, input.book.language ?? "zh"),
      activeHookCount,
      hookEmergence,
    );
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    return {
      intent,
      intentMarkdown,
      plannerInputs: this.unique([
        ...Object.values(sourcePaths),
        resolvedCurrentState.sourcePath,
        ...(memorySelection.dbPath ? [memorySelection.dbPath] : []),
      ]),
      runtimePath,
    };
  }

  private applyPayoffEndingPriority(input: {
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly chapterGoal: ChapterGoal;
    readonly language: "zh" | "en";
  }): Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective"> {
    const promisedPayoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver);
    if (!promisedPayoff) {
      return input.directives;
    }

    const payoffPriorityLine = input.language === "en"
      ? "When a payoff is promised, payoff priority is higher than endingType, and the payoff MUST happen in this chapter at least partially."
      : "当存在 payoffToDeliver 时，payoff 优先级高于 endingType，本章也必须至少部分兑现 payoff。";
    const endingCompatibilityLine = input.language === "en"
      ? "EndingType may shape closure, but must not block payoff realization or visible situation change."
      : "endingType 只控制收束方式，不得阻止 payoff 发生与局势变化。";
    const unresolvedCompatibilityLine = input.language === "en" && input.directives.endingType === "unresolved_end"
      ? "For unresolved_end with payoff: complete the payoff first, then leave the situation unresolved by introducing a new threat or question."
      : input.language === "zh" && input.directives.endingType === "unresolved_end"
        ? "当 endingType=unresolved_end 且存在 payoff 时：必须先完成 payoff，再通过新威胁或新问题让局势保持未解。"
        : undefined;
    const mergedSceneDirective = this.unique([
      input.directives.sceneDirective,
      payoffPriorityLine,
      endingCompatibilityLine,
      unresolvedCompatibilityLine,
    ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" ");

    return {
      ...input.directives,
      sceneDirective: mergedSceneDirective,
    };
  }

  private async resolveCurrentStateForPlanning(input: {
    readonly storyDir: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
    readonly currentStateMarkdown: string;
    readonly chapterSummaries: string;
  }): Promise<PlannerCurrentStateResolution> {
    const snapshotPath = join(input.storyDir, "state", "current_state.json");
    const runtimeContextPath = join(
      input.storyDir,
      "runtime",
      `chapter-${String(Math.max(1, input.chapterNumber - 1)).padStart(4, "0")}.context.json`,
    );
    const fallbackPath = join(input.storyDir, "current_state.md");

    const snapshotMarkdown = await this.readCurrentStateSnapshot(snapshotPath, input.language);
    if (snapshotMarkdown) {
      return {
        markdown: snapshotMarkdown,
        sourcePath: snapshotPath,
      };
    }

    const runtimeContextState = await this.readStateFromRuntimeContext({
      runtimeContextPath,
      chapterNumber: input.chapterNumber,
      language: input.language,
    });
    if (runtimeContextState) {
      return {
        markdown: runtimeContextState,
        sourcePath: runtimeContextPath,
      };
    }

    const markdownLooksLagging = this.isMarkdownStateLaggingBehindSummaries({
      currentStateMarkdown: input.currentStateMarkdown,
      chapterSummaries: input.chapterSummaries,
      chapterNumber: input.chapterNumber,
    });
    if (input.currentStateMarkdown.trim() && !markdownLooksLagging) {
      return {
        markdown: input.currentStateMarkdown,
        sourcePath: fallbackPath,
      };
    }

    const summaryFallback = this.deriveStateFromChapterSummaries({
      chapterSummaries: input.chapterSummaries,
      chapterNumber: input.chapterNumber,
      language: input.language,
    });
    if (summaryFallback) {
      return {
        markdown: summaryFallback,
        sourcePath: join(input.storyDir, "chapter_summaries.md"),
      };
    }

    if (input.currentStateMarkdown.trim()) {
      return {
        markdown: input.currentStateMarkdown,
        sourcePath: fallbackPath,
      };
    }

    return {
      markdown: this.buildFallbackCurrentState(input.language, input.chapterNumber),
      sourcePath: fallbackPath,
    };
  }

  private async readCurrentStateSnapshot(path: string, language: "zh" | "en"): Promise<string | undefined> {
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = CurrentStateStateSchema.parse(JSON.parse(raw));
      return renderCurrentStateProjection(parsed, language);
    } catch {
      return undefined;
    }
  }

  private async readStateFromRuntimeContext(input: {
    readonly runtimeContextPath: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
  }): Promise<string | undefined> {
    const raw = await readFile(input.runtimeContextPath, "utf-8").catch(() => undefined);
    if (!raw) return undefined;

    type ContextSource = { source?: string; excerpt?: string };
    type RuntimeContextShape = {
      selectedContext?: ReadonlyArray<ContextSource>;
      chapterGoal?: {
        mainConflict?: string;
        protagonistGoal?: string;
      };
    };

    let parsed: RuntimeContextShape | undefined;
    try {
      parsed = JSON.parse(raw) as RuntimeContextShape;
    } catch {
      return undefined;
    }

    const fields = new Map<string, string>();
    const entries = parsed.selectedContext ?? [];
    for (const entry of entries) {
      if (!entry?.source?.startsWith("story/current_state.md#")) {
        continue;
      }
      const excerpt = entry.excerpt?.trim() ?? "";
      const match = excerpt.match(/^(.+?)\s*\|\s*(.+)$/u);
      if (!match) continue;
      const key = this.normalizeCurrentStateLabel(match[1] ?? "");
      const value = (match[2] ?? "").trim();
      if (!key || !value) continue;
      fields.set(key, value);
    }

    const protagonistGoal = parsed.chapterGoal?.protagonistGoal?.trim();
    if (!fields.has("goal") && protagonistGoal) {
      fields.set("goal", protagonistGoal);
    }
    const mainConflict = parsed.chapterGoal?.mainConflict?.trim();
    if (!fields.has("conflict") && mainConflict) {
      fields.set("conflict", mainConflict);
    }

    if (fields.size === 0) {
      return undefined;
    }

    const projected = CurrentStateStateSchema.parse({
      chapter: Math.max(0, input.chapterNumber - 1),
      facts: [...fields.entries()].map(([key, value]) => ({
        subject: "protagonist",
        predicate: this.denormalizeCurrentStateLabel(key, input.language),
        object: value,
        validFromChapter: Math.max(0, input.chapterNumber - 1),
        validUntilChapter: null,
        sourceChapter: Math.max(0, input.chapterNumber - 1),
      })),
    });
    return renderCurrentStateProjection(projected, input.language);
  }

  private async readRecentEndingTypes(
    storyDir: string,
    chapterNumber: number,
    lookback: number,
  ): Promise<ReadonlyArray<EndingType>> {
    const start = Math.max(1, chapterNumber - lookback);
    const endings: EndingType[] = [];
    for (let chapter = start; chapter < chapterNumber; chapter += 1) {
      const runtimePath = join(storyDir, "runtime", `chapter-${String(chapter).padStart(4, "0")}.intent.md`);
      const raw = await this.readFileOrDefault(runtimePath);
      const endingType = this.extractEndingTypeFromIntentMarkdown(raw);
      if (endingType) {
        endings.push(endingType);
      }
    }
    return endings;
  }

  private extractEndingTypeFromIntentMarkdown(markdown: string): EndingType | undefined {
    const match = markdown.match(/^\s*-\s*endingType:\s*(reveal_end|unresolved_end|resolution_end|twist_end|calm_end)\s*$/imu);
    const value = match?.[1];
    if (
      value === "reveal_end"
      || value === "unresolved_end"
      || value === "resolution_end"
      || value === "twist_end"
      || value === "calm_end"
    ) {
      return value;
    }
    return undefined;
  }

  private deriveStateFromChapterSummaries(input: {
    readonly chapterSummaries: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
  }): string | undefined {
    const latestSummary = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => right.chapter - left.chapter)[0];
    if (!latestSummary) {
      return undefined;
    }

    const facts: Array<{ key: string; value: string }> = [];
    if (latestSummary.events.trim()) {
      facts.push({ key: "goal", value: latestSummary.events.trim() });
    }
    if (latestSummary.stateChanges.trim()) {
      facts.push({ key: "conflict", value: latestSummary.stateChanges.trim() });
    }
    if (latestSummary.characters.trim()) {
      facts.push({ key: "alliances", value: latestSummary.characters.trim() });
    }
    if (facts.length === 0) {
      return undefined;
    }

    const projected = CurrentStateStateSchema.parse({
      chapter: latestSummary.chapter,
      facts: facts.map((item) => ({
        subject: "current_state",
        predicate: this.denormalizeCurrentStateLabel(item.key, input.language),
        object: item.value,
        validFromChapter: latestSummary.chapter,
        validUntilChapter: null,
        sourceChapter: latestSummary.chapter,
      })),
    });
    return renderCurrentStateProjection(projected, input.language);
  }

  private buildFallbackCurrentState(language: "zh" | "en", chapterNumber: number): string {
    const fallback = CurrentStateStateSchema.parse({
      chapter: Math.max(0, chapterNumber - 1),
      facts: [],
    });
    return renderCurrentStateProjection(fallback, language);
  }

  private isMarkdownStateLaggingBehindSummaries(input: {
    readonly currentStateMarkdown: string;
    readonly chapterSummaries: string;
    readonly chapterNumber: number;
  }): boolean {
    const stateChapter = this.extractCurrentStateMarkdownChapter(input.currentStateMarkdown);
    if (stateChapter === undefined) {
      return false;
    }
    const latestSummaryChapter = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => right.chapter - left.chapter)[0]?.chapter;
    if (!latestSummaryChapter) {
      return false;
    }
    return stateChapter < latestSummaryChapter;
  }

  private extractCurrentStateMarkdownChapter(markdown: string): number | undefined {
    const lines = markdown.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith("|")) continue;
      if (line.includes("---")) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      const label = cells[0] ?? "";
      const value = cells[1] ?? "";
      if (!/^(当前章节|current chapter)$/i.test(label)) continue;
      const parsed = Number.parseInt((value.match(/\d+/)?.[0] ?? ""), 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private normalizeCurrentStateLabel(label: string): string {
    const normalized = label.trim().toLowerCase();
    if (/^(current location|当前位置)$/i.test(normalized)) return "location";
    if (/^(protagonist state|主角状态)$/i.test(normalized)) return "protagonist_state";
    if (/^(current goal|当前目标)$/i.test(normalized)) return "goal";
    if (/^(current constraint|当前限制)$/i.test(normalized)) return "constraint";
    if (/^(current alliances|current relationships|当前敌我)$/i.test(normalized)) return "alliances";
    if (/^(current conflict|当前冲突)$/i.test(normalized)) return "conflict";
    return "";
  }

  private denormalizeCurrentStateLabel(
    key: string,
    language: "zh" | "en",
  ): string {
    const labels = language === "zh"
      ? {
        location: "当前位置",
        protagonist_state: "主角状态",
        goal: "当前目标",
        constraint: "当前限制",
        alliances: "当前敌我",
        conflict: "当前冲突",
      }
      : {
        location: "Current Location",
        protagonist_state: "Protagonist State",
        goal: "Current Goal",
        constraint: "Current Constraint",
        alliances: "Current Alliances",
        conflict: "Current Conflict",
      };
    return labels[key as keyof typeof labels] ?? key;
  }

  private applyContinuityGoalOverride(input: {
    readonly chapterNumber: number;
    readonly goal: string;
    readonly continuityAnchor: ContinuityAnchor;
    readonly outlineNode?: string;
    readonly preferLatestStateAnchor: boolean;
  }): ContinuityGoalResolution {
    if (input.chapterNumber < 4) {
      return { goal: input.goal };
    }

    const recentAnchor = this.firstMeaningful([
      input.continuityAnchor.goal,
      input.continuityAnchor.outlineNode,
      input.continuityAnchor.summaryText,
      input.outlineNode,
    ]);
    if (!recentAnchor) {
      return { goal: input.goal };
    }

    const openingAnchor = input.continuityAnchor.firstSummaryText;
    if (!openingAnchor) {
      return { goal: input.goal };
    }

    const looksLikeOpeningRegression = this.hasKeywordOverlap(input.goal, openingAnchor)
      && !this.hasKeywordOverlap(input.goal, recentAnchor);
    const looksLikeStaleAgainstLatestAnchor = input.preferLatestStateAnchor
      && !this.hasKeywordOverlap(input.goal, recentAnchor);
    if (!looksLikeOpeningRegression && !looksLikeStaleAgainstLatestAnchor) {
      return { goal: input.goal };
    }

    const overrideGoal = this.extractFirstDirective(recentAnchor);
    if (!overrideGoal || overrideGoal.trim().toLowerCase() === input.goal.trim().toLowerCase()) {
      return { goal: input.goal };
    }

    return {
      goal: overrideGoal,
      conflict: {
        type: "continuity_goal_override",
        resolution: "prefer latest runtime continuity anchor over stale opening beat",
        detail: overrideGoal,
      },
    };
  }

  private buildStructuredDirectives(input: {
    readonly chapterNumber: number;
    readonly language?: string;
    readonly volumeOutline: string;
    readonly outlineNode: string | undefined;
    readonly matchedOutlineAnchor: boolean;
    readonly cadence: ReturnType<typeof analyzeChapterCadence>;
    readonly arcMapDirective?: string;
    readonly hookEmergence: HookEmergenceDirective;
    readonly goalIntensity: GoalIntensity;
    readonly lastEndingType?: EndingType;
    readonly recentEndingTypes: ReadonlyArray<EndingType>;
  }): Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective"> {
    const rawMoodDirective = this.buildMoodDirective(input.language, input.cadence);
    const rawSceneDirective = this.buildSceneDirective(input.language, input.cadence);
    const chapterMode = this.resolveChapterMode({
      moodDirective: rawMoodDirective,
      sceneDirective: rawSceneDirective,
    });
    const sceneDirective = chapterMode === "breath"
      ? this.buildBreathSceneIsolationDirective(
        this.removeEscalationFromSceneDirective(rawSceneDirective),
        input.language,
      )
      : rawSceneDirective;
    const moodDirective = chapterMode !== "breath" && rawMoodDirective?.targetMode === "breath"
      ? undefined
      : rawMoodDirective;
    const endingType = this.resolveEndingType({
      chapterMode,
      goalIntensity: input.goalIntensity,
      lastEndingType: input.lastEndingType,
      recentEndingTypes: input.recentEndingTypes,
    });
    return {
      chapterMode,
      endingType,
      arcDirective: this.buildArcDirective(
        input.language,
        input.volumeOutline,
        input.outlineNode,
        input.matchedOutlineAnchor,
        input.arcMapDirective,
      ),
      sceneDirective,
      moodDirective,
      directivePriority: {
        ordered: chapterMode === "breath"
          ? ["mood-structure", "scene-plan", "payoff", "hook-emergence"]
          : ["mood-structure", "scene-plan", "hook-emergence", "payoff"],
      },
      titleDirective: this.buildTitleDirective(input.language, input.cadence),
    };
  }

  private applyBreathHookGovernance(input: {
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly hookEmergence: HookEmergenceDirective;
    readonly language: "zh" | "en";
  }): {
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly hookEmergence: HookEmergenceDirective;
    readonly conflict?: ChapterConflict;
  } {
    const isBreathChapter = input.directives.chapterMode === "breath"
      || input.directives.moodDirective?.targetMode === "breath";
    if (!isBreathChapter) {
      return input;
    }

    const downgradedPressureStates = input.hookEmergence.pressureStates.map((entry) => (
      entry.state === "must-resolve-now"
        ? { ...entry, state: "soft-progress" as const }
        : entry
    ));
    const hadHardHook = input.hookEmergence.mustMaterializeHookNow
      || input.hookEmergence.pressureStates.some((entry) => entry.state === "must-resolve-now");
    const hadHardAgenda = input.hookAgenda.mustAdvance.length > 0 || input.hookAgenda.eligibleResolve.length > 0;
    const downgradedHookAgenda: ChapterIntent["hookAgenda"] = {
      ...input.hookAgenda,
      mustAdvance: [],
      eligibleResolve: [],
      pressureMap: input.hookAgenda.pressureMap.map((entry) => ({
        ...entry,
        movement: entry.movement === "advance" || entry.movement === "partial-payoff" || entry.movement === "full-payoff"
          ? "refresh"
          : entry.movement,
        pressure: entry.pressure === "critical" || entry.pressure === "high"
          ? "medium"
          : entry.pressure,
      })),
    };

    if (!hadHardHook && !hadHardAgenda) {
      return {
        ...input,
        hookAgenda: downgradedHookAgenda,
        hookEmergence: {
          ...input.hookEmergence,
          pressureStates: downgradedPressureStates,
          mustMaterializeHookNow: false,
          hookExecutionPhase: undefined,
          targetHook: undefined,
        },
      };
    }

    const directiveNote = input.language === "zh"
      ? "breath-hook-downgrade：mood directive 优先于 hook emergence；must-resolve-now hook 本章降级为 soft-progress，只允许 minor signal / resource hint / 感知变化，不得产生状态跃迁、强制回收或完全兑现。"
      : "breath-hook-downgrade: mood directive has priority over hook emergence; must-resolve-now hooks are downgraded to soft-progress this chapter. Allow only minor signal / resource hint / perception shift, not state jumps, forced resolution, or full payoff.";

    return {
      directives: {
        ...input.directives,
        hookExecutionPhase: undefined,
        sceneDirective: this.unique([
          input.directives.sceneDirective,
          directiveNote,
        ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" "),
      },
      hookAgenda: downgradedHookAgenda,
      hookEmergence: {
        pressureStates: downgradedPressureStates,
        mustMaterializeHookNow: false,
      },
      conflict: {
        type: "breath_hook_downgrade",
        resolution: "mood directive has priority over hook emergence in breath mode",
        detail: directiveNote,
      },
    };
  }

  private applyPayoffHookGovernance(input: {
    readonly chapterGoal: ChapterGoal;
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly hookEmergence: HookEmergenceDirective;
    readonly language: "zh" | "en";
  }): {
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly hookEmergence: HookEmergenceDirective;
    readonly conflict?: ChapterConflict;
  } {
    const promisedPayoff = this.normalizeMeaningfulText(
      input.chapterGoal.payoffDirective?.promisedPayoff ?? input.chapterGoal.payoffToDeliver,
    );
    if (!promisedPayoff || !input.hookEmergence.mustMaterializeHookNow) {
      return input;
    }

    const downgradedPressureStates = input.hookEmergence.pressureStates.map((entry) => (
      entry.state === "must-resolve-now"
        ? { ...entry, state: "soft-progress" as const }
        : entry
    ));
    const primaryHookId = input.hookEmergence.targetHook?.hookId
      ?? this.pickPrimaryHookForSceneBudget(input.hookAgenda);
    const downgradedHookAgenda: ChapterIntent["hookAgenda"] = {
      ...input.hookAgenda,
      mustAdvance: [],
      eligibleResolve: [],
      staleDebt: primaryHookId
        ? input.hookAgenda.staleDebt.filter((hookId) => hookId === primaryHookId)
        : input.hookAgenda.staleDebt,
      pressureMap: primaryHookId
        ? input.hookAgenda.pressureMap
          .filter((entry) => entry.hookId === primaryHookId)
          .map((entry) => ({
            ...entry,
            movement: entry.movement === "advance" || entry.movement === "partial-payoff" || entry.movement === "full-payoff"
              ? "refresh"
              : entry.movement,
            pressure: entry.pressure === "critical" || entry.pressure === "high"
              ? "medium"
              : entry.pressure,
          }))
        : input.hookAgenda.pressureMap.map((entry) => ({
          ...entry,
          movement: entry.movement === "advance" || entry.movement === "partial-payoff" || entry.movement === "full-payoff"
            ? "refresh"
            : entry.movement,
          pressure: entry.pressure === "critical" || entry.pressure === "high"
            ? "medium"
            : entry.pressure,
        })),
    };

    const directiveNote = input.language === "zh"
      ? "payoff-hook-priority：当本章存在 payoffToDeliver 时，payoff 优先于 must-resolve-now hook；该 hook 本章降级为 soft-progress，只允许轻微信号、资源提示或感知变化，不得与 payoff 同章 fully materialize。"
      : "payoff-hook-priority: when a chapter has payoffToDeliver, payoff takes priority over a must-resolve-now hook; the hook is downgraded to soft-progress this chapter and may only surface as a minor signal, resource hint, or perception shift, never fully materializing alongside the payoff.";

    return {
      directives: {
        ...input.directives,
        hookExecutionPhase: undefined,
        sceneDirective: this.unique([
          input.directives.sceneDirective,
          directiveNote,
        ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" "),
      },
      hookAgenda: downgradedHookAgenda,
      hookEmergence: {
        pressureStates: downgradedPressureStates,
        mustMaterializeHookNow: false,
      },
      conflict: {
        type: "payoff_hook_priority",
        resolution: "payoff takes priority and the urgent hook is deferred to soft-progress",
        detail: primaryHookId
          ? `${promisedPayoff} > ${primaryHookId}`
          : promisedPayoff,
      },
    };
  }

  private resolveEndingType(input: {
    readonly chapterMode?: ChapterIntent["chapterMode"];
    readonly goalIntensity: GoalIntensity;
    readonly lastEndingType?: EndingType;
    readonly recentEndingTypes: ReadonlyArray<EndingType>;
  }): EndingType {
    const base = this.selectBaseEndingType(input.chapterMode, input.goalIntensity);
    const recentSet = new Set(input.recentEndingTypes);

    const preferredOrder: ReadonlyArray<EndingType> = [
      "calm_end",
      "reveal_end",
      "resolution_end",
      "twist_end",
      "unresolved_end",
    ];

    if (base !== input.lastEndingType && !recentSet.has(base)) {
      return base;
    }

    const nonRecent = preferredOrder.find((candidate) => candidate !== input.lastEndingType && !recentSet.has(candidate));
    if (nonRecent) {
      return nonRecent;
    }

    const nonDuplicate = preferredOrder.find((candidate) => candidate !== input.lastEndingType);
    return nonDuplicate ?? base;
  }

  private selectBaseEndingType(
    chapterMode: ChapterIntent["chapterMode"] | undefined,
    goalIntensity: GoalIntensity,
  ): EndingType {
    if (chapterMode === "breath") {
      return "calm_end";
    }
    if (chapterMode === "reveal") {
      return "reveal_end";
    }
    if (chapterMode === "escalation" || chapterMode === "combat") {
      return goalIntensity === "high" ? "unresolved_end" : "twist_end";
    }
    if (goalIntensity === "high") {
      return "unresolved_end";
    }
    if (goalIntensity === "medium") {
      return "twist_end";
    }
    return "resolution_end";
  }

  private deriveGoal(
    externalContext: string | undefined,
    currentFocus: string,
    authorIntent: string,
    continuityGoal: string | undefined,
    outlineNode: string | undefined,
    arcGoalHint: string | undefined,
    chapterNumber: number,
  ): string {
    const first = this.extractFirstDirective(externalContext);
    if (first) return first;
    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (localOverride) return localOverride;
    const continuity = this.extractFirstDirective(continuityGoal);
    if (continuity) return continuity;
    const outline = this.extractFirstDirective(outlineNode);
    if (outline) return outline;
    const focus = this.extractFocusGoal(currentFocus);
    if (focus) return focus;
    const author = this.extractFirstDirective(authorIntent);
    if (author) return author;
    const arcHint = this.extractFirstDirective(arcGoalHint);
    if (arcHint) return arcHint;
    return `Advance chapter ${chapterNumber} with clear narrative focus.`;
  }

  private ensureGoalFallback(input: {
    readonly goal: string;
    readonly currentState: string;
    readonly chapterSummaries: string;
    readonly pendingHooksRaw: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
    readonly moodDirective?: MoodDirective;
  }): string {
    const candidate = this.normalizeMeaningfulText(input.goal);
    if (candidate && !this.isGenericGoalTemplate(candidate)) {
      return candidate;
    }
    return this.deriveMinimalGoalFromStateContext(input);
  }

  private ensureChapterGoalFallback(input: {
    readonly chapterGoal: ChapterGoal;
    readonly goal: string;
    readonly currentState: string;
    readonly chapterSummaries: string;
    readonly pendingHooksRaw: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
    readonly moodDirective?: MoodDirective;
  }): ChapterGoal {
    const fallbackMainConflict = this.deriveMinimalMainConflictFromStateContext(input);
    const fallbackProtagonistGoal = this.deriveMinimalGoalFromStateContext({
      goal: input.goal,
      currentState: input.currentState,
      chapterSummaries: input.chapterSummaries,
      pendingHooksRaw: input.pendingHooksRaw,
      chapterNumber: input.chapterNumber,
      language: input.language,
      moodDirective: input.moodDirective,
    });
    const normalizedMainConflict = this.normalizeMeaningfulText(input.chapterGoal.mainConflict);
    const mainConflict = normalizedMainConflict && !this.isChapterPlanControlText(normalizedMainConflict)
      ? normalizedMainConflict
      : fallbackMainConflict;
    const protagonistGoal = this.normalizeMeaningfulText(input.chapterGoal.protagonistGoal) ?? fallbackProtagonistGoal;
    return {
      ...input.chapterGoal,
      mainConflict,
      protagonistGoal,
    };
  }

  private repairChapterPlanControlMainConflict(input: {
    readonly chapterGoal: ChapterGoal;
    readonly goal: string;
    readonly currentState: string;
    readonly chapterSummaries: string;
    readonly pendingHooksRaw: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
    readonly moodDirective?: MoodDirective;
    readonly structureSignals?: Record<string, ReadonlyArray<string>>;
  }): ChapterGoal {
    const payoffConflict = this.deriveConflictFromPayoff(input.chapterGoal.payoffToDeliver, input.structureSignals);
    if (
      payoffConflict
      && (this.isChapterPlanControlText(input.chapterGoal.mainConflict)
        || !this.hasConflictPayoffOverlap(input.chapterGoal.mainConflict, input.chapterGoal.payoffToDeliver, input.structureSignals))
    ) {
      return {
        ...input.chapterGoal,
        mainConflict: payoffConflict,
      };
    }
    if (!this.isChapterPlanControlText(input.chapterGoal.mainConflict)) {
      return input.chapterGoal;
    }
    const primaryHookConflict = this.findPrimaryHookConflict(input.chapterGoal.foreshadowToTouch, input.pendingHooksRaw);
    return {
      ...input.chapterGoal,
      mainConflict: primaryHookConflict ?? this.deriveMinimalMainConflictFromStateContext(input),
    };
  }

  private hasConflictPayoffOverlap(
    conflict: string | undefined,
    payoff: string | undefined,
    structureSignals?: Record<string, ReadonlyArray<string>>,
  ): boolean {
    const combined = `${conflict ?? ""} ${payoff ?? ""}`;
    // Signal-driven overlap: check if both conflict and payoff share tokens from the same signal dimension.
    if (structureSignals) {
      const crisisTokens = this.uniqueSignalTokens([
        ...(structureSignals["pressure_source"] ?? []),
        ...(structureSignals["opening_hook"] ?? []),
      ]);
      if (crisisTokens.length > 0) {
        const conflictHits = this.countTokenOverlaps(conflict ?? "", crisisTokens);
        const payoffHits = this.countTokenOverlaps(payoff ?? "", crisisTokens);
        if (conflictHits >= 1 && payoffHits >= 1) return true;
        return false;
      }
    }
    return true;
  }

  private deriveConflictFromPayoff(
    payoff: string | undefined,
    structureSignals?: Record<string, ReadonlyArray<string>>,
  ): string | undefined {
    const normalized = this.normalizeMeaningfulText(payoff);
    if (!normalized) return undefined;
    // Signal-driven derivation: if payoff tokens overlap with crisis signals, derive a generic conflict.
    if (structureSignals) {
      const crisisTokens = this.uniqueSignalTokens([
        ...(structureSignals["pressure_source"] ?? []),
        ...(structureSignals["opening_hook"] ?? []),
      ]);
      if (crisisTokens.length > 0 && this.countTokenOverlaps(normalized, crisisTokens) >= 2) {
        return "关键压力信号被本章触及";
      }
    }
    return undefined;
  }

  /** Extract unique 2-char bigram tokens from signal phrases for Chinese word-boundary-free matching. */
  private uniqueSignalTokens(phrases: ReadonlyArray<string>): string[] {
    const stopRe = /[的了着过就在被把和与或但而因所以如果虽然然而，。！？、：；""''（）【】《》\s]+/g;
    const tokens = new Set<string>();
    for (const phrase of phrases) {
      const cleaned = normalizeNumerals(phrase.replace(stopRe, ""));
      for (let i = 0; i <= cleaned.length - 2; i++) {
        tokens.add(cleaned.substring(i, i + 2));
      }
    }
    return [...tokens];
  }

  private countTokenOverlaps(text: string, tokens: ReadonlyArray<string>): number {
    const normalizedText = normalizeNumerals(text);
    let count = 0;
    for (const token of tokens) {
      if (normalizedText.includes(token)) count++;
    }
    return count;
  }

  private findPrimaryHookConflict(
    foreshadowToTouch: ReadonlyArray<string>,
    pendingHooksRaw: string,
  ): string | undefined {
    const primaryHookId = foreshadowToTouch[0];
    if (!primaryHookId) return undefined;
    const hook = parsePendingHooksMarkdown(pendingHooksRaw).find((item) => item.hookId === primaryHookId);
    return this.normalizeMeaningfulText(hook?.notes)
      ?? this.normalizeMeaningfulText(hook?.expectedPayoff);
  }

  private deriveMinimalGoalFromStateContext(input: {
    readonly goal: string;
    readonly currentState: string;
    readonly chapterSummaries: string;
    readonly pendingHooksRaw: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
    readonly moodDirective?: MoodDirective;
  }): string {
    const stateFacts = parseCurrentStateFacts(input.currentState, Math.max(0, input.chapterNumber - 1));
    const latestSummary = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => right.chapter - left.chapter)[0];
    const pendingHook = parsePendingHooksMarkdown(input.pendingHooksRaw)
      .filter((hook) => !/^(resolved|deferred|closed|done|已解决|已回收)$/i.test(hook.status.trim()))
      .sort((left, right) => left.lastAdvancedChapter - right.lastAdvancedChapter || left.startChapter - right.startChapter)[0];

    const stateGoal = this.findStateFactValue(stateFacts, ["current goal", "当前目标"]);
    const summaryGoal = this.normalizeMeaningfulText(latestSummary?.events);
    const hookGoal = this.normalizeMeaningfulText(pendingHook?.expectedPayoff) ?? this.normalizeMeaningfulText(pendingHook?.notes);
    const breathDefault = input.language === "zh"
      ? "恢复伤势、稳定状态，并讨论下一步行动。"
      : "Recover, stabilize, and align on the next step.";
    const genericDefault = input.language === "zh"
      ? "推动本章形成一个清晰且可执行的低强度目标。"
      : `Advance chapter ${input.chapterNumber} with one clear, executable goal.`;

    return this.firstMeaningful([
      stateGoal,
      summaryGoal,
      hookGoal,
      this.normalizeMeaningfulText(input.goal),
      input.moodDirective?.targetMode === "breath" ? breathDefault : undefined,
      genericDefault,
    ]) ?? genericDefault;
  }

  private deriveMinimalMainConflictFromStateContext(input: {
    readonly currentState: string;
    readonly chapterSummaries: string;
    readonly pendingHooksRaw: string;
    readonly chapterNumber: number;
    readonly language: "zh" | "en";
    readonly moodDirective?: MoodDirective;
  }): string {
    const stateFacts = parseCurrentStateFacts(input.currentState, Math.max(0, input.chapterNumber - 1));
    const latestSummary = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => right.chapter - left.chapter)[0];
    const pendingHook = parsePendingHooksMarkdown(input.pendingHooksRaw)
      .filter((hook) => !/^(resolved|deferred|closed|done|已解决|已回收)$/i.test(hook.status.trim()))
      .sort((left, right) => left.lastAdvancedChapter - right.lastAdvancedChapter || left.startChapter - right.startChapter)[0];

    const stateConflict = this.findFirstUsableStateFactValue(stateFacts, [
      "current conflict",
      "当前冲突",
      "first conflict",
      "第一个冲突",
      "首个冲突",
    ]);
    const summaryConflict = this.normalizeMeaningfulText(latestSummary?.stateChanges)
      ?? this.normalizeMeaningfulText(latestSummary?.events);
    const hookPressure = this.normalizeMeaningfulText(pendingHook?.notes)
      ?? this.normalizeMeaningfulText(pendingHook?.expectedPayoff);
    const breathDefault = input.language === "zh"
      ? "伤势与外部压力仍在，必须在短暂喘息中稳住局面。"
      : "Injury and external pressure remain, so the chapter must stabilize during a brief breathing window.";
    const genericDefault = input.language === "zh"
      ? "本章需要围绕一条可持续升级的核心冲突推进。"
      : "The chapter needs one core conflict that can escalate in a controlled way.";

    return this.firstMeaningful([
      stateConflict,
      summaryConflict,
      hookPressure,
      input.moodDirective?.targetMode === "breath" ? breathDefault : undefined,
      genericDefault,
    ]) ?? genericDefault;
  }

  private isChapterPlanControlText(value: string): boolean {
    const compact = value.replace(/\s+/g, "");
    return compact.includes("章必须完成")
      || compact.includes("前500字冲突")
      || compact.includes("主钩子类型")
      || compact.includes("核心功能")
      || compact.includes("章节结尾钩子")
      || /golden\s*three|opening\s*hook/i.test(value);
  }

  private findFirstUsableStateFactValue(
    facts: ReadonlyArray<{ predicate: string; object: string }>,
    labels: ReadonlyArray<string>,
  ): string | undefined {
    for (const label of labels) {
      const value = this.findStateFactValue(facts, [label]);
      if (value && !this.isChapterPlanControlText(value)) {
        return value;
      }
    }
    return undefined;
  }

  private findStateFactValue(
    facts: ReadonlyArray<{ predicate: string; object: string }>,
    labels: ReadonlyArray<string>,
  ): string | undefined {
    const match = facts.find((fact) =>
      labels.some((label) => fact.predicate.trim().toLowerCase() === label.trim().toLowerCase()),
    );
    return this.normalizeMeaningfulText(match?.object);
  }

  private normalizeMeaningfulText(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (this.isTemplatePlaceholder(trimmed)) return undefined;
    if (
      /^(?:\(|（)?\s*(todo|tbd|none|null|n\/a|无|空白|待补充|未定义|状态未同步|未设定|未填写|待定)\s*(?:\)|）)?$/iu.test(trimmed)
    ) {
      return undefined;
    }
    return trimmed;
  }

  private isGenericGoalTemplate(goal: string): boolean {
    return /^advance chapter \d+ with clear narrative focus\.?$/i.test(goal.trim());
  }

  private inferGoalIntensity(goal: string): GoalIntensity {
    const normalized = goal.trim();
    if (!normalized) return "medium";

    if (/(生死抉择|终局对抗|核心反转|必须立即行动|立刻行动|谁先死|final confrontation|life[- ]or[- ]death|must act now|core reversal|last stand)/i.test(normalized)) {
      return "high";
    }
    if (/(休整|恢复|疗伤|讨论|计划|交换情报|温和推进|低强度|breath|recovery|regroup|discussion|planning|low[- ]intensity)/i.test(normalized)) {
      return "low";
    }
    return "medium";
  }

  private arbitrateGoalWithMood(input: {
    readonly goal: string;
    readonly goalIntensity: GoalIntensity;
    readonly moodDirective?: MoodDirective;
    readonly language: "zh" | "en";
  }): GoalArbitrationResult {
    if (input.moodDirective?.targetMode !== "breath" || input.goalIntensity !== "high") {
      return {
        goal: input.goal,
        goalIntensity: input.goalIntensity,
        mustAvoid: [],
      };
    }

    const downgradedGoal = input.language === "zh"
      ? `先进行休整与讨论，延后最终决断：${input.goal}`
      : `Prioritize regroup and deliberation first, and defer final life-or-death decisions: ${input.goal}`;

    return {
      goal: downgradedGoal,
      goalIntensity: "medium",
      mustAvoid: [
        input.language === "zh"
          ? "breath 章禁止生死抉择、终局对抗、核心反转、或必须立即行动的危机目标。"
          : "Breath chapters must not center on life-or-death choices, final confrontation, core reversal, or immediate must-act-now crisis goals.",
      ],
      conflict: {
        type: "goal_mood_arbitration",
        resolution: "downgrade high-intensity goal to breath-compatible deliberation",
        detail: downgradedGoal,
      },
    };
  }

  private collectMustKeep(currentState: string, storyBible: string): string[] {
    return this.unique([
      ...this.extractListItems(currentState, 2),
      ...this.extractListItems(storyBible, 2),
    ]).slice(0, 4);
  }

  private collectMustAvoid(currentFocus: string, prohibitions: ReadonlyArray<string>): string[] {
    const avoidSection = this.extractSection(currentFocus, [
      "avoid",
      "must avoid",
      "禁止",
      "避免",
      "避雷",
    ]);
    const focusAvoids = avoidSection
      ? this.extractListItems(avoidSection, 10)
      : currentFocus
        .split("\n")
        .map((line) => line.trim())
        .filter((line) =>
          line.startsWith("-") &&
          /^(?:avoid\b|don't\b|do not\b|never\b|禁止|严禁|不要|避免|不得)/i.test(line.replace(/^[-*]\s*/, "").trim()),
        )
        .map((line) => this.cleanListItem(line))
        .filter((line): line is string => Boolean(line));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string, chapterNumber?: number): string[] {
    const items = this.unique([
      ...this.extractFocusStyleItems(currentFocus),
      ...this.extractListItems(authorIntent, 2),
    ]).slice(0, 4);
    if (!chapterNumber) return items;
    return items.filter((item) => {
      const chapterMatch = item.match(/第(\d+)章/);
      if (!chapterMatch) return true;
      return parseInt(chapterMatch[1]!, 10) === chapterNumber;
    });
  }

  /**
   * Build a concrete, verifiable checklist of items that MUST appear in the
   * chapter body. These are derived from hooks, current_focus chapter blocks,
   * and character relationships — each item has a human-readable description
   * for the LLM and a regex signal for the post-write compliance checker.
   */
  private collectMandatoryItems(params: {
    chapterNumber: number;
    language: "zh" | "en";
    currentFocus: string;
    currentState: string;
    chapterGoal: NonNullable<ChapterIntent["chapterGoal"]>;
    pendingHooks: ReadonlyArray<StoredHook>;
    hookAgenda: ChapterIntent["hookAgenda"];
  }): Array<{ description: string; signal: string }> {
    const items: Array<{ description: string; signal: string }> = [];
    const lang = params.language;

    // --- 1. Time anchor from current_focus chapter block ---
    const focusChapterBlock = this.extractCurrentFocusChapterBlock(params.currentFocus, params.chapterNumber);
    for (const line of focusChapterBlock) {
      // Look for time-anchor patterns like "香港回归倒计时15天" or "距…还有…天"
      const timeMatch = line.match(/(香港回归.*?(\d+)\s*天|距离.{2,8}还有\s*(\d+)\s*天|倒计时\s*(\d+)\s*天)/u);
      if (timeMatch) {
        const days = timeMatch[2] ?? timeMatch[3] ?? timeMatch[4];
        const desc = lang === "zh"
          ? `香港回归倒计时${days}天——通过收音机/路边标语/日历任一方式`
          : `Hong Kong handover countdown: ${days} days — via radio, banner, or calendar`;
        items.push({ description: desc, signal: `回归.*${days}.*天|倒计时.*${days}|handover.*${days}` });
        break;
      }
    }

    // --- 2. Character appearances from hooks that need touching ---
    const foreshadowIds = new Set(params.chapterGoal.foreshadowToTouch ?? []);
    for (const hook of params.pendingHooks) {
      if (!foreshadowIds.has(hook.hookId)) continue;
      // Extract character name from hook notes or hook id
      const charMatch = hook.notes?.match(/苏晴|陈志强|刘文轩|王胖子|马明远|林建国|周秀兰/g);
      if (charMatch) {
        for (const charName of [...new Set(charMatch)]) {
          // only add if not already listed
          if (items.some((item) => item.description.includes(charName))) continue;
          const desc = lang === "zh"
            ? `${charName}出场/提及——1句话，不超过15字，不展开`
            : `${charName} mention — 1 line, no more than 15 words, don't expand`;
          items.push({ description: desc, signal: charName });
        }
      }
    }

    // --- 3. Hook touch requirements ---
    for (const hookId of params.hookAgenda.mustAdvance) {
      const hook = params.pendingHooks.find((h) => h.hookId === hookId);
      if (!hook) continue;
      const hookDesc = hook.notes ?? hook.hookId;
      // Extract key phrases for the signal
      const signalTerms = this.extractSignalTerms(hookDesc);
      if (signalTerms.length === 0) {
        // Fallback: use hook type keywords
        const typeTerms = (hook.type ?? "").includes("情感") ? "吸烟|抽烟|烟" : "";
        if (!typeTerms) continue;
        items.push({
          description: lang === "zh"
            ? `${hook.hookId} 推进——${hookDesc.slice(0, 50)}`
            : `${hook.hookId} advance — ${hookDesc.slice(0, 50)}`,
          signal: typeTerms,
        });
      }
    }

    // --- 4. Deduplicate by description ---
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.description;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6); // cap at 6 to avoid dilution
  }

  /** Extract short signal terms from hook description for regex matching. */
  private extractSignalTerms(hookDesc: string): string[] {
    const terms: string[] = [];
    // Match quoted or parenthesized phrases
    const quoted = hookDesc.match(/[""]([^""]{1,10})[""]|「([^」]{1,10})」|（([^）]{2,8})）|\(([^)]{2,8})\)/g);
    if (quoted) {
      for (const q of quoted) {
        const clean = q.replace(/[""'「」（）\(\)]/g, "");
        if (clean.length >= 2) terms.push(clean);
      }
    }
    return terms;
  }

  private collectConflicts(
    externalContext: string | undefined,
    currentFocus: string,
    outlineNode: string | undefined,
    volumeOutline: string,
    outlineLooksStale: boolean = false,
  ): ChapterConflict[] {
    if (outlineLooksStale) {
      return [
        {
          type: "outline_vs_recent_state",
          resolution: "prefer latest state continuity anchor",
        },
      ];
    }
    const outlineText = outlineNode ?? volumeOutline;
    if (!outlineText || outlineText === "(文件尚未创建)") return [];
    if (externalContext) {
      const indicatesOverride = /ignore|skip|defer|instead|不要|别|先别|暂停/i.test(externalContext);
      if (!indicatesOverride && this.hasKeywordOverlap(externalContext, outlineText)) return [];

      return [
        {
          type: "outline_vs_request",
          resolution: "allow local outline deferral",
        },
      ];
    }

    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (!localOverride || !outlineNode) {
      return [];
    }

    return [
      {
        type: "outline_vs_current_focus",
        resolution: "allow explicit current focus override",
        detail: localOverride,
      },
    ];
  }

  private extractFirstDirective(content?: string): string | undefined {
    if (!content) return undefined;
    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) =>
        line.length > 0
        && !line.startsWith("#")
        && !line.startsWith("-")
        && !this.isTemplatePlaceholder(line),
      );
  }

  private extractListItems(content: string, limit: number): string[] {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => this.cleanListItem(line))
      .filter((line): line is string => Boolean(line))
      .slice(0, limit);
  }

  private extractFocusGoal(currentFocus: string): string | undefined {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    const directives = this.extractFocusStyleItems(focusSection, 3);
    if (directives.length === 0) {
      return this.extractFirstDirective(focusSection);
    }
    return directives.join(this.containsChinese(focusSection) ? "；" : "; ");
  }

  private extractLocalOverrideGoal(currentFocus: string): string | undefined {
    const overrideSection = this.extractSection(currentFocus, [
      "local override",
      "explicit override",
      "chapter override",
      "local task override",
      "局部覆盖",
      "本章覆盖",
      "临时覆盖",
      "当前覆盖",
    ]);
    if (!overrideSection) {
      return undefined;
    }

    const directives = this.extractListItems(overrideSection, 3);
    if (directives.length > 0) {
      return directives.join(this.containsChinese(overrideSection) ? "；" : "; ");
    }

    return this.extractFirstDirective(overrideSection);
  }

  private extractFocusStyleItems(currentFocus: string, limit = 3): string[] {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    return this.extractListItems(focusSection, limit);
  }

  private buildArcDirective(
    language: string | undefined,
    volumeOutline: string,
    outlineNode: string | undefined,
    matchedOutlineAnchor: boolean,
    arcMapDirective?: string,
  ): string | undefined {
    if (matchedOutlineAnchor || !outlineNode || volumeOutline === "(文件尚未创建)") {
      return arcMapDirective;
    }

    const fallbackDirective = this.isChineseLanguage(language)
      ? "不要继续依赖卷纲的 fallback 指令，必须把本章推进到新的弧线节点或地点变化。"
      : "Do not keep leaning on the outline fallback. Force this chapter toward a fresh arc beat or location change.";
    if (!arcMapDirective) {
      return fallbackDirective;
    }
    return this.isChineseLanguage(language)
      ? `${fallbackDirective} ${arcMapDirective}`
      : `${fallbackDirective} ${arcMapDirective}`;
  }

  private buildSceneDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    const directives: string[] = [];

    if (cadence.breathingCollapse) {
      directives.push(
        "Force tension escalation this chapter. Do not produce a third consecutive breathing chapter. Force chapter type: escalation / confrontation / discovery-under-threat.",
      );
    }

    if (cadence.scenePressure?.pressure === "high") {
      const repeatedType = cadence.scenePressure.repeatedType;
      directives.push(
        this.isChineseLanguage(language)
          ? `最近章节连续停留在“${repeatedType}”，本章必须更换场景容器、地点或行动方式。`
          : `Recent chapters are stuck in repeated ${repeatedType} beats. Change the scene container, location, or action pattern this chapter.`,
      );
    }

    return directives.length > 0 ? directives.join(" ") : undefined;
  }

  private buildCadenceMustAvoid(
    language: "zh" | "en",
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string[] {
    if (!cadence.breathingCollapse) {
      return [];
    }

    return language === "zh"
      ? [
          "Do not produce a third consecutive breathing chapter.",
          "Avoid another daily / recovery / bonding-only chapter shell.",
        ]
      : [
          "Do not produce a third consecutive breathing chapter.",
          "Avoid another daily / recovery / bonding-only chapter shell.",
        ];
  }

  private resolveChapterMode(input: {
    readonly moodDirective?: MoodDirective;
    readonly sceneDirective?: string;
  }): NonNullable<ChapterIntent["chapterMode"]> | undefined {
    if (input.moodDirective?.targetMode === "breath") {
      return "breath";
    }

    const scene = input.sceneDirective?.toLowerCase() ?? "";
    if (/(force tension escalation|force chapter type:\s*escalation|force confrontation|escalation override|强制升压|对抗升级)/i.test(scene)) {
      return "escalation";
    }
    if (/(confrontation|combat|battle|厮杀|战斗|对抗)/i.test(scene)) {
      return "combat";
    }
    if (/(reveal|揭示|揭晓|真相)/i.test(scene)) {
      return "reveal";
    }
    return undefined;
  }

  private removeEscalationFromSceneDirective(sceneDirective: string | undefined): string | undefined {
    if (!sceneDirective) {
      return undefined;
    }

    const stripped = sceneDirective
      .replace(/Force tension escalation this chapter\.\s*/giu, "")
      .replace(/Do not produce a third consecutive breathing chapter\.\s*/giu, "")
      .replace(/Force chapter type:\s*escalation\s*\/\s*confrontation\s*\/\s*discovery-under-threat\.\s*/giu, "")
      .replace(/Force confrontation\.\s*/giu, "")
      .replace(/escalation override\.?\s*/giu, "")
      .trim();

    return stripped.length > 0 ? stripped : undefined;
  }

  private applyCadenceChapterGoalOverrides(
    chapterGoal: ChapterGoal,
    cadence: ReturnType<typeof analyzeChapterCadence>,
    genreProfile?: { readonly powerScaling?: boolean },
  ): ChapterGoal {
    if (!cadence.breathingCollapse) {
      return chapterGoal;
    }

    if (chapterGoal.endingHookType !== "reveal" && chapterGoal.endingHookType !== "choice") {
      return chapterGoal;
    }

    return {
      ...chapterGoal,
      endingHookType: this.pickEscalationEndingHookType(chapterGoal, genreProfile),
    };
  }

  private applyPayoffDirectiveGovernance(
    chapterGoal: ChapterGoal,
    language: "zh" | "en",
  ): {
    readonly chapterGoal: ChapterGoal;
    readonly mustAvoid: ReadonlyArray<string>;
  } {
    const payoffDirective = chapterGoal.payoffDirective;
    if (!payoffDirective) {
      return {
        chapterGoal,
        mustAvoid: [],
      };
    }

    const payoffDepth = payoffDirective.payoffDepth ?? "layered";
    const payoffScope = payoffDirective.payoffScope ?? (payoffDepth === "layered" ? "arc" : "chapter");
    const isLayeredArc = payoffDepth === "layered" && payoffScope === "arc";
    const governedGoal: ChapterGoal = {
      ...chapterGoal,
      payoffDirective: {
        ...payoffDirective,
        payoffDepth,
        payoffScope,
        // Semantics: mandatoryByFinalAct now means "must be realized by the end of the payoffScope".
        // For layered+arc promises, do not force full chapter-level realization.
        mandatoryByFinalAct: isLayeredArc ? false : payoffDirective.mandatoryByFinalAct,
      },
      ...(isLayeredArc ? { maxRevealLayersPerChapter: 1 } : {}),
    };

    if (!isLayeredArc) {
      return {
        chapterGoal: governedGoal,
        mustAvoid: [],
      };
    }

    return {
      chapterGoal: governedGoal,
      mustAvoid: [
        language === "zh"
          ? "本章禁止完全解释该 payoff，只允许 partial reveal（一层）。"
          : "Do not fully explain this payoff in one chapter; allow only a partial reveal (one layer).",
      ],
    };
  }

  private enforceSingleChapterPayoff(input: {
    readonly chapterGoal: ChapterGoal;
    readonly language: "zh" | "en";
  }): {
    readonly chapterGoal: ChapterGoal;
    readonly directiveNote?: string;
  } {
    const payoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver);
    if (!payoff) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const segments = this.splitCompositePayoff(payoff);
    if (segments.length <= 1) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const primaryPayoff = this.pickPrimaryPayoffSegment(segments);
    const deferredPayoffs = segments.filter((segment) => segment !== primaryPayoff);
    if (deferredPayoffs.length === 0) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const deferredText = deferredPayoffs.join(input.language === "zh" ? "、" : " and ");
    const rewrittenPull = this.composeDeferredPayoffPull({
      language: input.language,
      primaryPayoff,
      deferredText,
      existingPull: input.chapterGoal.nextChapterPull,
    });
    const directiveNote = input.language === "zh"
      ? `本章 payoff 只保留“${primaryPayoff}”；“${deferredText}”转入后续推进，不要试图在单章内同时完成。`
      : `Keep this chapter payoff to "${primaryPayoff}" only; defer "${deferredText}" into follow-up pressure instead of completing both in one chapter.`;

    return {
      chapterGoal: {
        ...input.chapterGoal,
        payoffToDeliver: primaryPayoff,
        nextChapterPull: rewrittenPull,
        ...(input.chapterGoal.payoffDirective
          ? {
            payoffDirective: {
              ...input.chapterGoal.payoffDirective,
              promisedPayoff: primaryPayoff,
            },
          }
          : {}),
      },
      directiveNote,
    };
  }

  private applySinglePayoffDirectiveNote(
    input: {
      readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
      readonly directiveNote?: string;
    },
  ): Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective"> {
    if (!input.directiveNote) {
      return input.directives;
    }

    return {
      ...input.directives,
      sceneDirective: this.unique([
        input.directives.sceneDirective,
        input.directiveNote,
      ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" "),
    };
  }

  private enforceConcreteEventPayoff(input: {
    readonly chapterGoal: ChapterGoal;
    readonly language: "zh" | "en";
    readonly currentState: string;
    readonly currentFocus?: string;
    readonly chapterNumber?: number;
    readonly parsedRules?: ReturnType<typeof parseBookRules>;
    readonly genreProfile?: any;
    readonly structureSignals?: Record<string, ReadonlyArray<string>>;
  }): {
    readonly chapterGoal: ChapterGoal;
    readonly directiveNote?: string;
    readonly conflict?: ChapterConflict;
  } {
    const payoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver);
    if (!payoff || this.isConcreteEventPayoff(payoff, input.genreProfile)) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const rewrittenPayoff = this.deriveConcreteEventPayoff({
      chapterGoal: input.chapterGoal,
      currentState: input.currentState,
      language: input.language,
      parsedRules: input.parsedRules,
      genreProfile: input.genreProfile,
      structureSignals: input.structureSignals,
    });
    if (!rewrittenPayoff || rewrittenPayoff === payoff) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    return {
      chapterGoal: {
        ...input.chapterGoal,
        payoffToDeliver: rewrittenPayoff,
        nextChapterPull: this.composeConcretePayoffRewritePull({
          language: input.language,
          originalPayoff: payoff,
          rewrittenPayoff,
          existingPull: input.chapterGoal.nextChapterPull,
          currentFocus: input.currentFocus,
          chapterNumber: input.chapterNumber,
        }),
        ...(input.chapterGoal.payoffDirective
          ? {
            payoffDirective: {
              ...input.chapterGoal.payoffDirective,
              promisedPayoff: rewrittenPayoff,
              payoffType: this.inferLowPressurePayoffType(rewrittenPayoff),
            },
          }
          : {}),
      },
      directiveNote: input.language === "zh"
        ? `payoff-non-event：原 payoff“${payoff}”不可直接书写，已改为具体事件“${rewrittenPayoff}”。`
        : `payoff-non-event: original payoff "${payoff}" was not directly writable, so it was rewritten as the concrete event "${rewrittenPayoff}".`,
      conflict: {
        type: "payoff-non-event",
        resolution: "rewrite payoff as one concrete, writable event",
        detail: `${payoff} -> ${rewrittenPayoff}`,
      },
    };
  }

  private composeConcretePayoffRewritePull(input: {
    readonly language: "zh" | "en";
    readonly originalPayoff: string;
    readonly rewrittenPayoff: string;
    readonly existingPull: string;
    readonly currentFocus?: string;
    readonly chapterNumber?: number;
  }): string {
    const existing = this.normalizeMeaningfulText(input.existingPull);
    const endingHook = this.extractCurrentFocusChapterEndingHook(input.currentFocus ?? "", input.chapterNumber ?? 0);
    const shouldReplaceExisting = !existing
      || existing.includes(input.originalPayoff)
      || this.isWeakNextChapterPull(existing);
    if (endingHook && shouldReplaceExisting) {
      const sanitizedEnding = this.normalizeMeaningfulText(endingHook);
      if (sanitizedEnding) {
        return input.language === "zh"
          ? `结尾钩子不能悬空，下章要承接并升级：${sanitizedEnding}`
          : `The ending hook cannot hang loose; the next chapter must carry and escalate it: ${sanitizedEnding}`;
      }
    }
    if (shouldReplaceExisting) {
      return input.language === "zh"
        ? `本章兑现“${input.rewrittenPayoff}”后，下章要把这个结果转成新的行动压力。`
        : `After delivering "${input.rewrittenPayoff}", the next chapter must turn that result into new action pressure.`;
    }
    return existing;
  }

  private isWeakNextChapterPull(value: string): boolean {
    return /(发现异常|关键线索|一条线索|一层表皮|下章升级冲突|更大威胁|真正危险|next chapter escalation|key clue|first layer|real danger)/iu.test(value);
  }

  private enforceExecutableRevealPayoff(input: {
    readonly chapterGoal: ChapterGoal;
    readonly language: "zh" | "en";
    readonly currentState: string;
    readonly chapterSummaries: string;
  }): {
    readonly chapterGoal: ChapterGoal;
    readonly directiveNote?: string;
    readonly conflict?: ChapterConflict;
  } {
    const payoffType = input.chapterGoal.payoffDirective?.payoffType;
    const payoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver);
    if (payoffType !== "reveal" || !payoff) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    if (this.hasExecutableRevealGap({
      payoff,
      currentState: input.currentState,
      chapterSummaries: input.chapterSummaries,
    })) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const rewrittenPayoff = this.deriveExecutableRevealPayoff({
      chapterGoal: input.chapterGoal,
      currentState: input.currentState,
      chapterSummaries: input.chapterSummaries,
      language: input.language,
    });
    if (!rewrittenPayoff || rewrittenPayoff === payoff) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    return {
      chapterGoal: {
        ...input.chapterGoal,
        payoffToDeliver: rewrittenPayoff,
        ...(input.chapterGoal.payoffDirective
          ? {
            payoffDirective: {
              ...input.chapterGoal.payoffDirective,
              promisedPayoff: rewrittenPayoff,
            },
          }
          : {}),
      },
      directiveNote: input.language === "zh"
        ? `reveal-gap-check：原 reveal payoff“${payoff}”缺少可执行信息差，已改写为“${rewrittenPayoff}”。禁止重复揭示同一信息。`
        : `reveal-gap-check: the reveal payoff "${payoff}" had no executable information gap, so it was rewritten as "${rewrittenPayoff}". Do not reveal the same information twice.`,
      conflict: {
        type: "reveal-gap-check",
        resolution: "rewrite repeated or non-executable reveal into deeper reveal/application/consequence",
        detail: `${payoff} -> ${rewrittenPayoff}`,
      },
    };
  }

  private enforceBreathCompatiblePayoff(input: {
    readonly chapterGoal: ChapterGoal;
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly language: "zh" | "en";
    readonly currentState: string;
  }): {
    readonly chapterGoal: ChapterGoal;
    readonly directiveNote?: string;
    readonly conflict?: ChapterConflict;
  } {
    const isBreathChapter = input.directives.chapterMode === "breath"
      || input.directives.moodDirective?.targetMode === "breath";
    if (!isBreathChapter) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const payoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver);
    if (!payoff || !this.isHighPressureBreathPayoff(input.chapterGoal)) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const rewrittenPayoff = this.deriveLowPressureBreathPayoff({
      chapterGoal: input.chapterGoal,
      currentState: input.currentState,
      language: input.language,
    });
    const nextPull = this.composeBreathDeferredPressurePull({
      language: input.language,
      originalPayoff: payoff,
      existingPull: input.chapterGoal.nextChapterPull,
    });

    return {
      chapterGoal: {
        ...input.chapterGoal,
        payoffToDeliver: rewrittenPayoff,
        nextChapterPull: nextPull,
        payoffDirective: {
          promisedPayoff: rewrittenPayoff,
          payoffType: this.inferLowPressurePayoffType(rewrittenPayoff),
          payoffDepth: input.chapterGoal.payoffDirective?.payoffDepth ?? "layered",
          payoffScope: input.chapterGoal.payoffDirective?.payoffScope ?? "chapter",
          mandatoryByFinalAct: input.chapterGoal.payoffDirective?.mandatoryByFinalAct ?? true,
        },
      },
      directiveNote: input.language === "zh"
        ? `breath-payoff-downgrade：原 payoff“${payoff}”属于高压推进，已降级为“${rewrittenPayoff}”；原压力只能作为 scene2 的轻微尾钩，不得在 scene1 fully materialize。`
        : `breath-payoff-downgrade: original payoff "${payoff}" was too high-pressure for breath mode, so it was downgraded to "${rewrittenPayoff}"; the original pressure may only appear as a light Scene2 tail hook and must not fully materialize in Scene1.`,
      conflict: {
        type: "breath-payoff-downgrade",
        resolution: "downgrade high-pressure payoff into recovery/resource/relationship/minor-discovery event",
        detail: `${payoff} -> ${rewrittenPayoff}`,
      },
    };
  }

  private isHighPressureBreathPayoff(chapterGoal: ChapterGoal): boolean {
    const payoffType = chapterGoal.payoffDirective?.payoffType;
    const source = [
      chapterGoal.payoffToDeliver,
      chapterGoal.payoffDirective?.promisedPayoff,
      chapterGoal.mainConflict,
      chapterGoal.protagonistGoal,
    ].filter((value): value is string => Boolean(value && value.trim().length > 0)).join(" ");

    if (payoffType === "reversal") {
      return true;
    }

    if (this.isAllowedBreathPayoff(source, payoffType)) {
      return false;
    }

    return /(规则压制|规则压力|风暴|追杀|追兵围杀|围杀|杀机|濒死|生死|血战|爆发|反噬失控|威胁逼近|笼罩全身|压制全身|强冲突反转|storm|pursuit|chase|kill intent|life[- ]or[- ]death|high[- ]pressure|pressure crushes|rule pressure)/iu.test(source);
  }

  private isAllowedBreathPayoff(source: string, payoffType?: NonNullable<ChapterGoal["payoffDirective"]>["payoffType"]): boolean {
    if (payoffType === "resource" || payoffType === "relationship") {
      return true;
    }

    if (payoffType === "reveal" && /(轻信息|微弱|线索|痕迹|尚未完全|minor|small clue|trace)/iu.test(source)) {
      return true;
    }

    return /(恢复|疗伤|止血|稳住|休整|补给|资源|地图|玉简|腰牌|线索|痕迹|微弱波动|尚未完全激活|关系|信任|结盟|recovery|recover|resource|clue|trace|relationship|minor discovery)/iu.test(source)
      && !/(规则压制|规则压力|风暴|追杀|围杀|濒死|生死|强冲突反转|storm|pursuit|life[- ]or[- ]death|high[- ]pressure)/iu.test(source);
  }

  private deriveLowPressureBreathPayoff(input: {
    readonly chapterGoal: ChapterGoal;
    readonly currentState: string;
    readonly language: "zh" | "en";
  }): string {
    const source = [
      input.chapterGoal.payoffToDeliver,
      input.chapterGoal.mainConflict,
      input.chapterGoal.protagonistGoal,
      input.chapterGoal.nextChapterPull,
      input.currentState,
    ].join(" ");

    if (/(阵纹|法阵|禁纹|规则)/u.test(source)) {
      return input.language === "zh"
        ? "阵纹微弱波动，尚未完全激活"
        : "the formation lines faintly stir without fully activating";
    }
    if (/(风暴|暴风|风眼)/u.test(source)) {
      return input.language === "zh"
        ? "风暴远处传来第一声低鸣"
        : "the storm gives its first distant low rumble";
    }
    if (/(追杀|追兵|围杀|尾随)/u.test(source)) {
      return input.language === "zh"
        ? "远处追踪痕迹第一次显现"
        : "the first distant trace of pursuit appears";
    }
    if (/(伤|血|反噬|经脉|气血)/u.test(source)) {
      return input.language === "zh"
        ? "伤势被暂时稳住"
        : "the injury is temporarily stabilized";
    }
    if (/(云岚|关系|信任|同伴|结盟)/u.test(source)) {
      return input.language === "zh"
        ? "与关键人物建立一次低声信任"
        : "a quiet trust beat forms with a key character";
    }
    if (/(地图|玉简|腰牌|令牌|资源|补给)/u.test(source)) {
      return input.language === "zh"
        ? "一份可立刻使用的小资源被确认"
        : "a small usable resource is confirmed";
    }

    return input.language === "zh"
      ? "一条轻微线索被发现"
      : "a minor clue is discovered";
  }

  private inferLowPressurePayoffType(payoff: string): NonNullable<ChapterGoal["payoffDirective"]>["payoffType"] {
    if (/(信任|关系|结盟|同伴|trust|relationship|alliance)/iu.test(payoff)) {
      return "relationship";
    }
    if (/(资源|补给|地图|玉简|腰牌|令牌|resource|supply|map|token)/iu.test(payoff)) {
      return "resource";
    }
    return "reveal";
  }

  private composeBreathDeferredPressurePull(input: {
    readonly language: "zh" | "en";
    readonly originalPayoff: string;
    readonly existingPull: string;
  }): string {
    const existing = this.normalizeMeaningfulText(input.existingPull);
    const deferred = input.language === "zh"
      ? `原高压 payoff“${input.originalPayoff}”只作为下章压力，不在本章完全爆发。`
      : `Keep the original high-pressure payoff "${input.originalPayoff}" as next-chapter pressure instead of fully detonating it here.`;
    return this.unique([existing, deferred].filter((value): value is string => Boolean(value))).join(input.language === "zh" ? " " : " ");
  }

  private isConcreteEventPayoff(payoff: string, genreProfile?: any): boolean {
    const trimmed = payoff.trim();
    if (!trimmed) {
      return false;
    }

    const defaultActions = genreProfile?.structuralSignals?.defaultPayoffActions ?? [
      "触发", "打开", "拿到", "夺下", "获得", "压住", "觉醒", "突破", "点亮", "揭开", "解开", "发现", "找到", "锁定", "启动", "扯开", "击碎", "稳住", "显现", "亮起", "拿回", "取到", "激活", "开启",
      "awaken", "breakthrough", "get", "gain", "discover", "find", "open", "unlock", "trigger", "stabilize", "ignite", "activate"
    ];
    const customObjects = genreProfile?.concretePayoffObjects ?? [
      "目标", "道具", "钥匙", "门", "线索", "奖励", "文件", "凭证", "物品", "材料", "设备"
    ];


    const customPattern = customObjects.length > 0
      ? new RegExp(`(${customObjects.map((o: string) => this.escapeRegex(o)).join("|")})`, "u")
      : null;

    if (
      /(关键线索|明确线索|逃生线索|具体线索|第一条线索|first concrete clue|clear escape clue|key clue|concrete clue)/i.test(trimmed)
      || this.isExploratoryPayoff(trimmed)
      || this.isPassiveConfirmationPayoff(trimmed)
      || /(?:发现|确认|意识到|确定).{0,12}(?:重生|回到|回了|时间点|年份|199\d|20\d{2})/u.test(trimmed)
      || /(?:重生|回到|回了|时间点|年份|199\d|20\d{2}).{0,12}(?:被)?(?:当场)?(?:确认|坐实)/u.test(trimmed)
      || /(危机|事实|名单|通知|裁员).{0,12}(被)?(?:当场)?(坐实|确认)|(?:坐实|确认).{0,12}(危机|事实|名单|通知|裁员)/u.test(trimmed)
      || (customPattern !== null && customPattern.test(trimmed))
      || /(?:获得|拿到|揭开|发现|显现).{0,10}(关键线索|明确线索|逃生线索|地图信息)/u.test(trimmed)
    ) {
      return true;
    }

    if (
      /\b\d+\s*[-~–—]\s*\d+\s*章\b/u.test(trimmed)
      || /^\d+\s*[-~–—]\s*\d+\s*章$/u.test(trimmed)
      || /^\d+\s*[-~–—]\s*\d+$/u.test(trimmed)
      || /\b\d+\+\s*章\b/u.test(trimmed)
      || /(?:短期|中期|长期|阶段|phase|arc|chapter range)/iu.test(trimmed)
    ) {
      return false;
    }

    if (
      /(阶段推进|推进主线|推进剧情|当前推进|局势推进|形成优势|获得优势|争取优势|保持优势|有所推进|阶段性推进|继续推进|下一阶段|mainline progress|advance the phase|progress the arc|gain advantage|maintain advantage|move things forward)/i.test(trimmed)
    ) {
      return false;
    }

    if (
      /^(?:优势|推进|进展|收益|资源|线索|机缘|突破机会|阶段目标)$/u.test(trimmed)
    ) {
      return false;
    }

    const actionsPattern = defaultActions.length > 0
      ? new RegExp(`(${defaultActions.map((action: string) => this.escapeRegex(action)).join("|")})`, "i")
      : null;
    if (!actionsPattern) {
      return false;
    }
    return actionsPattern.test(trimmed)
      && !/(获得优势|形成优势|阶段推进|有所推进|局势推进)/u.test(trimmed);
  }

  private deriveConcreteEventPayoff(input: {
    readonly chapterGoal: ChapterGoal;
    readonly currentState: string;
    readonly language: "zh" | "en";
    readonly parsedRules?: ReturnType<typeof parseBookRules>;
    readonly genreProfile?: any;
    readonly structureSignals?: Record<string, ReadonlyArray<string>>;
  }): string {
    const source = [
      input.chapterGoal.protagonistGoal,
      input.chapterGoal.mainConflict,
      input.chapterGoal.nextChapterPull,
      input.currentState,
    ].join(" ");

    const payoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver);
    if (payoff && this.isAwakeningPayoff(payoff)) {
      return this.deriveRevealEventPayoff(source, input.language, input.structureSignals);
    }
    if (payoff && this.isExploratoryPayoff(payoff)) {
      return this.deriveExploratoryPayoff(source, input.language);
    }

    const matchedObject = this.extractPayoffEventObject(source, input.genreProfile);
    const defaultActions = input.genreProfile?.structuralSignals?.defaultPayoffActions ?? (input.language === "zh" ? ["拿到", "保住", "夺回"] : ["secure", "protect", "reclaim"]);
    const actionsPattern = new RegExp(`(${defaultActions.map((a: string) => this.escapeRegex(a)).join('|')})`, 'iu');
    const matchedAction = source.match(actionsPattern)?.[1] ?? defaultActions[0];

    const inferredType = input.chapterGoal.payoffDirective?.payoffType;
    const customResources = input.parsedRules?.rules?.numericalSystemOverrides?.resourceTypes || [];
    const systemResourceName = customResources.find((res: string) => /(积分|点数|能量|试用期|权限)/.test(res));

    if (inferredType === "reveal") {
      return this.deriveRevealEventPayoff(source, input.language, input.structureSignals);
    }

    if (matchedObject) {
      return input.language === "zh" ? `${matchedAction}${matchedObject}` : `${matchedAction} the ${matchedObject}`;
    }

    if (this.hasExploratorySourceSignal(source, input.language)) {
      return this.deriveExploratoryPayoff(source, input.language);
    }

    switch (inferredType) {
      case "resource":
        if (systemResourceName) {
          return input.language === "zh"
            ? `获得一份可立刻结算的${systemResourceName}奖励`
            : `a usable ${systemResourceName} reward is secured`;
        }
        return input.language === "zh" ? "一份可立刻使用的关键资源被拿到" : "a usable key resource is secured";
      case "breakthrough":
        if (input.genreProfile?.powerScaling === false) {
          return this.deriveNonPowerBreakthroughPayoff(source, input.language);
        }
        return input.language === "zh" ? "第一次突破被当场触发" : "the first breakthrough is triggered on the spot";
      case "relationship":
        return input.language === "zh" ? "与关键人物达成一次明确结盟" : "a concrete alliance with a key character is formed";
      default:
        return input.language === "zh" ? "局势第一次发生明确反转" : "the situation turns in a clear, concrete way";
    }
  }

  private deriveRevealEventPayoff(
    source: string,
    language: "zh" | "en",
    structureSignals?: Record<string, ReadonlyArray<string>>,
  ): string {
    if (language !== "zh") {
      if (/(return|back).{0,20}(year|past|timeline)|reborn|reincarnat/i.test(source)) {
        return "the protagonist confirms the return to the past timeline";
      }
      const revealMatch = source.match(/(?:discovers?|confirms?|learns?|realizes?)\s+[^.;!?]{4,80}/i);
      return revealMatch?.[0]?.trim() ?? "a key clue is revealed on the spot";
    }

    const rebirthConfirmed = /(?:发现|确认|验证|意识到|确定|醒来发现|猛然惊醒).{0,20}(?:重生|回到|回了|时空|199\d|20\d{2}|时间点|年份)/u.test(source)
      || /(?:重生|回到|回了|时空|199\d|20\d{2}|时间点|年份).{0,20}(?:确认|验证|坐实|确定|发现)/u.test(source);

    // Signal-driven family-crisis detection — no hardcoded family role or crisis-type terms.
    let signalCrisisConfirmed = false;
    if (structureSignals) {
      const crisisTokens = this.uniqueSignalTokens([
        ...(structureSignals["pressure_source"] ?? []),
        ...(structureSignals["opening_hook"] ?? []),
      ]);
      signalCrisisConfirmed = crisisTokens.length > 0 && this.countTokenOverlaps(source, crisisTokens) >= 2;
    }

    const antagonistThreat = /(?:有人|来人|对方|那人|债主|仇家).{0,20}(?:堵门|警告|威胁|上门|逼迫)|(?:堵门|警告|威胁|上门|逼迫).{0,20}(?:有人|来人|对方|那人|债主|仇家)/u.test(source);

    if (rebirthConfirmed && signalCrisisConfirmed) {
      return "确认重生事实，并得知关键危机信号";
    }
    if (rebirthConfirmed) {
      return "确认重生/穿越事实";
    }
    if (signalCrisisConfirmed) {
      return "关键危机信号被触及";
    }
    if (antagonistThreat) {
      return "外部威胁被正面引爆";
    }

    const revealMatch = source.match(/(?:发现|得知|透露|看到|意识到|确认|确定)[^，。；！？,.!?]{2,28}/u);
    return revealMatch?.[0]?.trim() ?? "一条关键线索被当场揭开";
  }

  private isAwakeningPayoff(payoff: string): boolean {
    const normalized = payoff.trim();
    if (!normalized) return false;
    return /^(?:觉醒|苏醒|醒来|重生觉醒|确认时空|验证重生|确认重生|确认新现实)$/u.test(normalized)
      || /\b(?:awakening|awaken|wake up|confirm reality|confirm the new reality|confirm rebirth)\b/i.test(normalized);
  }

  private isExploratoryPayoff(payoff: string): boolean {
    const normalized = payoff.trim();
    if (!normalized) return false;
    return /(?:找到|锁定|确认|发现|明确|识别|摸清|看清).{0,12}(?:机会|方向|路径|来源|入口|办法|方案|线索|突破口|可行性|信息差|赚钱门路|商机)/u.test(normalized)
      || /\b(?:find|identify|lock|confirm|discover|locate|pin down).{0,32}(?:opportunity|path|source|route|lead|opening|plan|way|approach|angle|clue)\b/i.test(normalized);
  }

  private isPassiveConfirmationPayoff(payoff: string): boolean {
    const normalized = payoff.trim();
    if (!normalized) return false;
    return /(?:机会|方向|路径|来源|入口|办法|方案|线索|突破口|可行性|风险|危机|问题|异常|位置|目标|身份|规则|限制).{0,8}(?:被)?(?:确认|锁定|发现|看清|坐实)/u.test(normalized)
      || /\b(?:opportunity|path|source|route|lead|opening|plan|way|approach|angle|clue|risk|threat|problem|identity|rule|limit)\s+(?:is|gets|has been)?\s*(?:confirmed|identified|located|found|locked|revealed)\b/i.test(normalized);
  }

  private hasExploratorySourceSignal(source: string, language: "zh" | "en"): boolean {
    if (language !== "zh") {
      return /(need|needs|needed|must find|must raise|without|lack|lacks|source|path|route|opportunity|opening|way forward|information gap|business lead|first lead)/i.test(source);
    }
    return /(?:需要|无|没有|缺|缺少|至少|想办法|从哪|怎么|来源|路径|机会|商机|赚钱|信息差|门槛最低|可用资源|第一步|下一步|方向|可执行)/u.test(source);
  }

  private deriveExploratoryPayoff(source: string, language: "zh" | "en"): string {
    if (language !== "zh") {
      if (/(fund|cash|money|capital|budget).{0,40}(source|path|route|way|borrow|raise)|(?:source|path|route|way).{0,40}(fund|cash|money|capital)/i.test(source)) {
        return "identify a realistic funding path";
      }
      if (/(business|earn|profit|market|trade|opportunity|information gap|arbitrage)/i.test(source)) {
        return "identify the first actionable earning opportunity";
      }
      if (/(clue|investigat|mystery|truth|lead)/i.test(source)) {
        return "lock onto the next actionable lead";
      }
      if (/(door|gate|entrance|route|path|way in)/i.test(source)) {
        return "identify the next viable route forward";
      }
      return "confirm one actionable next-step path";
    }

    if (/(启动资金|本钱|借钱|筹钱|筹措|资金来源|五毛钱|五毛|100块|100元)/u.test(source)
      && /(?:需要|无|没有|缺|至少|想办法|借|筹|来源|路径|从哪|怎么)/u.test(source)) {
      return "找到启动资金来源";
    }
    if (/(商机|赚钱|生意|信息差|碟片|倒卖|市场|价格|批发|差价|门槛最低)/u.test(source)) {
      return "锁定第一个可执行赚钱方向";
    }
    if (/(线索|调查|真相|疑点|证据|谜团|踪迹)/u.test(source)) {
      return "锁定下一条可执行线索";
    }
    if (/(入口|门|路线|路径|通道|去处|办法|方案)/u.test(source)) {
      return "确认下一步可执行路径";
    }
    return "确认一个可执行的下一步路径";
  }

  private deriveNonPowerBreakthroughPayoff(source: string, language: "zh" | "en"): string {
    if (language !== "zh") {
      if (/fund|cash|money|capital|budget/i.test(source)) {
        return "a realistic funding path is identified";
      }
      if (/partner|ally|cooperation|supplier|contact/i.test(source)) {
        return "a practical cooperation lead is secured";
      }
      return "a concrete practical opening is identified";
    }

    if (/(资金|本钱|现金|钱|筹|借|元|预算)/u.test(source)) {
      return "找到筹措启动资金的现实路径";
    }
    if (/(合作|合伙|老周|人脉|关系|渠道|供应|档口|批发)/u.test(source)) {
      return "锁定一个可执行的合作突破口";
    }
    if (/(线索|信息|报价|价格|批发价|消息)/u.test(source)) {
      return "确认一条可立刻利用的信息差";
    }
    return "找到一个可执行的现实突破口";
  }

  private hasExecutableRevealGap(input: {
    readonly payoff: string;
    readonly currentState: string;
    readonly chapterSummaries: string;
  }): boolean {
    if (/(之谜|谜团|未明|未知|尚未|代价|限制|条件|为何|为什么|后果|只能|无法)/u.test(input.payoff)) {
      return true;
    }
    const revealTarget = this.extractRevealTarget(input.payoff);
    if (!revealTarget) {
      return true;
    }

    const combined = [input.currentState, input.chapterSummaries].join(" ");
    const hasTopic = combined.includes(revealTarget);
    if (!hasTopic) {
      return true;
    }

    const unresolvedPattern = new RegExp(
      `${this.escapeRegex(revealTarget)}.{0,16}(未明|未知|尚未|不清楚|不明|谜|代价|限制|条件|如何|为什么|后果|缺口|漏洞|只能|无法)`,
      "u",
    );
    if (unresolvedPattern.test(combined)) {
      return true;
    }

    const repeatedKnownPattern = new RegExp(
      `(已经|已|早已|再次|又|仍然|依旧).{0,12}${this.escapeRegex(revealTarget)}|${this.escapeRegex(revealTarget)}.{0,12}(已经|已|早已|再次|又|仍然|依旧)`,
      "u",
    );

    return !repeatedKnownPattern.test(combined);
  }

  private deriveExecutableRevealPayoff(input: {
    readonly chapterGoal: ChapterGoal;
    readonly currentState: string;
    readonly chapterSummaries: string;
    readonly language: "zh" | "en";
  }): string {
    const payoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver) ?? "";
    const revealTarget = this.extractRevealTarget(payoff) ?? payoff;
    const combined = [
      input.chapterGoal.mainConflict,
      input.chapterGoal.protagonistGoal,
      input.chapterGoal.nextChapterPull,
      input.currentState,
      input.chapterSummaries,
    ].join(" ");

    if (/(漏洞|缺口|bug|loophole)/iu.test(revealTarget)) {
      if (/(真名).{0,12}(消散|崩解|失控)/u.test(combined)) {
        return input.language === "zh"
          ? "发现漏洞无法阻止真名消散，只能转移代价"
          : "discover that the loophole cannot stop the true-name collapse and can only redirect the cost";
      }
      if (/(代价|反噬|后果|cost|backlash|consequence)/iu.test(combined)) {
        return input.language === "zh"
          ? "发现漏洞的真正代价"
          : "discover the loophole's true cost";
      }
      if (/(限制|条件|只适用|局限|limit|condition|only works)/iu.test(combined)) {
        return input.language === "zh"
          ? "发现漏洞的限制条件"
          : "discover the loophole's limiting conditions";
      }
      return input.language === "zh"
        ? "发现漏洞只适用于某种情况"
        : "discover that the loophole only works under one condition";
    }

    if (/(来源|真相|秘密|身份|契约|线索|source|truth|secret|identity|contract|clue)/iu.test(revealTarget)) {
      if (/(代价|反噬|后果|cost|backlash|consequence)/iu.test(combined)) {
        return input.language === "zh"
          ? `发现${revealTarget}的真正代价`
          : `discover the true cost behind ${revealTarget}`;
      }
      if (/(限制|条件|局限|只在|only when|condition|limit)/iu.test(combined)) {
        return input.language === "zh"
          ? `发现${revealTarget}只在特定条件下成立`
          : `discover that ${revealTarget} only holds under a specific condition`;
      }
      return input.language === "zh"
        ? `发现${revealTarget}更深一层的真相`
        : `discover a deeper layer behind ${revealTarget}`;
    }

    return input.language === "zh"
      ? "发现这一认知突破背后的代价与限制"
      : "discover the cost and limitation behind that reveal";
  }

  private extractPayoffEventObject(source: string, genreProfile?: any): string | undefined {
    const customObjects = genreProfile?.concretePayoffObjects ?? [
      "目标", "道具", "钥匙", "门", "线索", "奖励", "文件", "凭证", "物品", "材料", "设备"
    ];
    const patterns = customObjects.map((o: string) => new RegExp(`(${this.escapeRegex(o)})`, 'u'));
    return patterns
      .map((pattern: RegExp) => source.match(pattern)?.[1])
      .filter((value: string | undefined): value is string => Boolean(value && value.trim().length > 0))
      .find((value: string) => !this.hasUnavailableObjectContext(source, value));
  }

  private hasUnavailableObjectContext(source: string, object: string): boolean {
    const escaped = this.escapeRegex(object);
    const beforeObject = new RegExp(`(?:无|没有|没|缺|缺少|需要|至少|想办法|尚未|还没|未能|无法|不能|得|要|筹|借)[^，。；！？,.!?]{0,16}${escaped}`, "u");
    const afterObject = new RegExp(`${escaped}[^，。；！？,.!?]{0,16}(?:来源|路径|从哪|怎么|还没|尚未|不足|不够|缺口|需求)`, "u");
    const backgroundObject = new RegExp(`(?:身上|口袋里|枕头下|桌上|包里|状态|背景|随身)[^，。；！？,.!?]{0,16}(?:有|带着|压着|放着)[^，。；！？,.!?]{0,16}${escaped}`, "u");
    const englishBefore = new RegExp(`(?:no|without|lack|lacks|need|needs|needed|must raise|must find|source of|path to)[^.;!?]{0,32}${escaped}`, "i");
    const englishAfter = new RegExp(`${escaped}[^.;!?]{0,32}(?:source|path|needed|required|shortfall|gap|not enough|missing)`, "i");
    const englishBackground = new RegExp(`(?:has|carries|keeps|lies|sits)[^.;!?]{0,32}${escaped}[^.;!?]{0,32}(?:background|identity|state|status)`, "i");
    return beforeObject.test(source)
      || afterObject.test(source)
      || backgroundObject.test(source)
      || englishBefore.test(source)
      || englishAfter.test(source)
      || englishBackground.test(source);
  }

  private extractRevealTarget(payoff: string): string | undefined {
    const normalized = payoff.trim();
    const match = normalized.match(/(?:发现|揭开|揭示|看懂|明白|识破|认出|看清)(.+)$/u);
    const candidate = this.normalizeMeaningfulText(match?.[1] ?? normalized);
    if (!candidate) {
      return undefined;
    }
    return candidate.replace(/^(?:了|到|出|这个|这一|该)/u, "").trim();
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private applySceneBudget(input: {
    readonly chapterGoal: ChapterGoal;
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly hookEmergence: HookEmergenceDirective;
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly language: "zh" | "en";
  }): {
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly mustAvoid: ReadonlyArray<string>;
  } {
    const promisedPayoff = this.normalizeMeaningfulText(input.chapterGoal.payoffToDeliver);
    if (!promisedPayoff) {
      return {
        hookAgenda: input.hookAgenda,
        directives: input.directives,
        mustAvoid: [],
      };
    }

    const primaryHookId = input.hookEmergence.mustMaterializeHookNow && input.hookEmergence.targetHook
      ? input.hookEmergence.targetHook.hookId
      : this.pickPrimaryHookForSceneBudget(input.hookAgenda);

    const trimmedHookAgenda = primaryHookId
      ? this.trimHookAgendaToPrimary(input.hookAgenda, primaryHookId)
      : {
        ...input.hookAgenda,
        mustAdvance: [],
        eligibleResolve: [],
        staleDebt: [],
        pressureMap: [],
      };

    const sceneBudgetLine = input.language === "zh"
      ? "Scene Budget：本章最多只允许 1 个 payoff、1 个主 hook 推进，以及最多 1 次场景变化。"
      : "Scene Budget: allow at most 1 payoff, 1 primary hook movement, and at most 1 scene/location change this chapter.";
    const hookTrimLine = primaryHookId
      ? input.language === "zh"
        ? `本章已有 payoff，hook 推进只保留 ${primaryHookId}，其余 hook 延后。`
        : `A payoff is already promised, so keep only ${primaryHookId} as the primary hook movement and defer the rest.`
      : input.language === "zh"
        ? "本章已有 payoff，不要再并行推进多个 hook。"
        : "A payoff is already promised; do not parallel multiple hook movements in this chapter.";
    const sceneDisciplineLine = input.language === "zh"
      ? "禁止一章内多 hook 推进、多场景跳跃、多高潮叠加，优先把篇幅留给 payoff 完成。"
      : "Do not stack multiple hook advances, scene jumps, or climax beats in one chapter; keep the page budget for payoff completion first.";

    return {
      hookAgenda: trimmedHookAgenda,
      directives: {
        ...input.directives,
        sceneDirective: this.unique([
          input.directives.sceneDirective,
          sceneBudgetLine,
          hookTrimLine,
          sceneDisciplineLine,
        ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" "),
      },
      mustAvoid: [
        input.language === "zh"
          ? "本章不要并行推进多个 hook。"
          : "Do not advance multiple hooks in parallel this chapter.",
        input.language === "zh"
          ? "本章不要安排多次场景/地点跳跃。"
          : "Do not schedule multiple scene/location jumps this chapter.",
        input.language === "zh"
          ? "本章不要堆叠多个高潮。"
          : "Do not stack multiple climax beats in this chapter.",
      ],
    };
  }

  private applyIntensityBudget(input: {
    readonly chapterGoal: ChapterGoal;
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly language: "zh" | "en";
  }): {
    readonly hookAgenda: ChapterIntent["hookAgenda"];
    readonly directives: Pick<ChapterIntent, "chapterMode" | "endingType" | "sceneDirective" | "arcDirective" | "moodDirective" | "directivePriority" | "hookExecutionPhase" | "titleDirective">;
    readonly conflict?: ChapterConflict;
  } {
    const payoffType = input.chapterGoal.payoffDirective?.payoffType;
    if (payoffType !== "breakthrough" && payoffType !== "reversal") {
      return {
        hookAgenda: input.hookAgenda,
        directives: input.directives,
      };
    }

    const source = [
      input.chapterGoal.payoffToDeliver,
      input.chapterGoal.payoffDirective?.promisedPayoff,
      input.chapterGoal.mainConflict,
      input.chapterGoal.protagonistGoal,
      input.chapterGoal.nextChapterPull,
    ].filter((value): value is string => Boolean(value && value.trim().length > 0)).join(" ");
    const detectedCompetingClimaxes = this.detectCompetingClimaxSignals(source, payoffType);
    const hasMultipleHooks = input.hookAgenda.mustAdvance.length
      + input.hookAgenda.eligibleResolve.length
      + input.hookAgenda.staleDebt.length > 1
      || input.hookAgenda.pressureMap.length > 1;
    const primaryHookId = this.pickPrimaryHookForSceneBudget(input.hookAgenda);
    const trimmedHookAgenda = primaryHookId
      ? this.trimHookAgendaToPrimary(input.hookAgenda, primaryHookId)
      : {
        ...input.hookAgenda,
        mustAdvance: [],
        eligibleResolve: [],
        staleDebt: [],
        pressureMap: [],
      };
    const shouldApplyBudget = detectedCompetingClimaxes.length > 0 || hasMultipleHooks;
    if (!shouldApplyBudget) {
      return {
        hookAgenda: input.hookAgenda,
        directives: input.directives,
      };
    }

    const climaxList = detectedCompetingClimaxes.join(input.language === "zh" ? "、" : ", ");
    const primaryHookLine = primaryHookId
      ? input.language === "zh"
        ? `本章 hook 只允许保留 ${primaryHookId} 作为次级变化，其余 hook 延后。`
        : `Keep only ${primaryHookId} as the optional secondary change; defer other hooks.`
      : input.language === "zh"
        ? "本章不再额外推进 hook，把篇幅留给 payoff。"
        : "Do not add extra hook movement; reserve the chapter for the payoff.";
    const intensityLine = input.language === "zh"
      ? "Intensity Budget：本章最多 1 个核心高潮（payoff）+ 1 个次级变化。payoffType 为 reversal/breakthrough 时，禁止身份反转、新能力解锁、多重人格变化、多 hook 推进同章叠加。"
      : "Intensity Budget: allow at most 1 core climax (payoff) plus 1 optional secondary change. For reversal/breakthrough payoffs, do not stack identity reversal, new ability unlock, personality shift, or multiple hook advances in the same chapter.";
    const splitLine = input.language === "zh"
      ? `多高潮已拆分：${climaxList || "额外高潮"} 转入后续章节，优先级为 payoff > hook > world-change。`
      : `Split overloaded climax material: ${climaxList || "extra climax beats"} moves to later chapters. Priority is payoff > hook > world-change.`;

    return {
      hookAgenda: trimmedHookAgenda,
      directives: {
        ...input.directives,
        sceneDirective: this.unique([
          input.directives.sceneDirective,
          intensityLine,
          primaryHookLine,
          splitLine,
        ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" "),
      },
      conflict: {
        type: "intensity_budget_split",
        resolution: "split overloaded climax stack across chapters",
        detail: climaxList || primaryHookLine,
      },
    };
  }

  private detectCompetingClimaxSignals(
    source: string,
    payoffType: NonNullable<NonNullable<ChapterGoal["payoffDirective"]>["payoffType"]>,
  ): string[] {
    const signals: string[] = [];
    const has = (pattern: RegExp) => pattern.test(source);

    if (payoffType === "breakthrough") {
      if (has(/身份反转|身世反转|真实身份|血脉真相|不是.+而是|identity reversal|true identity/iu)) {
        signals.push("identity reversal");
      }
      if (has(/新能力|新神通|新技能|解锁能力|能力解锁|掌握新能力|unlock(?:s|ed)? new ability|new power/iu)) {
        signals.push("new ability unlock");
      }
    }

    if (payoffType === "reversal" && has(/觉醒|突破|破境|晋阶|血脉苏醒|awaken|breakthrough|advance realm/iu)) {
      signals.push("breakthrough");
    }

    if (has(/多重人格|人格变化|第二人格|人格切换|personality shift|second persona/iu)) {
      signals.push("personality shift");
    }
    if (has(/世界规则改变|天地规则|世界变化|world change|rule of the world changes/iu)) {
      signals.push("world-change");
    }

    return this.unique(signals);
  }

  private pickPrimaryHookForSceneBudget(hookAgenda: ChapterIntent["hookAgenda"]): string | undefined {
    return hookAgenda.mustAdvance[0]
      ?? hookAgenda.eligibleResolve[0]
      ?? hookAgenda.staleDebt[0]
      ?? hookAgenda.pressureMap[0]?.hookId;
  }

  private trimHookAgendaToPrimary(
    hookAgenda: ChapterIntent["hookAgenda"],
    primaryHookId: string,
  ): ChapterIntent["hookAgenda"] {
    return {
      ...hookAgenda,
      mustAdvance: hookAgenda.mustAdvance.filter((hookId) => hookId === primaryHookId),
      eligibleResolve: hookAgenda.eligibleResolve.filter((hookId) => hookId === primaryHookId),
      staleDebt: hookAgenda.staleDebt.filter((hookId) => hookId === primaryHookId),
      pressureMap: hookAgenda.pressureMap.filter((entry) => entry.hookId === primaryHookId),
    };
  }

  private applyBreakthroughPayoffTrigger(input: {
    readonly chapterGoal: ChapterGoal;
    readonly language: "zh" | "en";
    readonly currentState: string;
    readonly genreProfile?: { readonly powerScaling?: boolean };
  }): {
    readonly chapterGoal: ChapterGoal;
    readonly directiveNote?: string;
  } {
    const payoffDirectiveType = input.chapterGoal.payoffDirective?.payoffType;
    const payoffText = [
      input.chapterGoal.payoffToDeliver,
      input.chapterGoal.protagonistGoal,
      input.chapterGoal.mainConflict,
    ].join(" ");
    const allowsPowerBreakthrough = input.genreProfile?.powerScaling !== false;
    const isBreakthroughPayoff = allowsPowerBreakthrough && (
      payoffDirectiveType === "breakthrough"
      || /(觉醒|突破|破境|晋阶|掌握新能力|血脉苏醒|awaken|breakthrough|advance realm|unlock)/i.test(payoffText)
    );

    if (!isBreakthroughPayoff) {
      return {
        chapterGoal: input.chapterGoal,
      };
    }

    const existingTrigger = this.normalizeMeaningfulText(input.chapterGoal.payoffTrigger);
    const payoffTrigger = existingTrigger ?? this.deriveBreakthroughTrigger({
      chapterGoal: input.chapterGoal,
      currentState: input.currentState,
      language: input.language,
    });

    const directiveNote = input.language === "zh"
      ? `Trigger: ${payoffTrigger}。必须按 buildup → trigger → moment → payoff 展开，禁止无触发直接觉醒或突破。`
      : `Trigger: ${payoffTrigger}. Use buildup -> trigger -> moment -> payoff, and do not allow a breakthrough without a trigger.`;

    return {
      chapterGoal: {
        ...input.chapterGoal,
        payoffTrigger,
      },
      directiveNote,
    };
  }

  private deriveBreakthroughTrigger(input: {
    readonly chapterGoal: ChapterGoal;
    readonly currentState: string;
    readonly language: "zh" | "en";
  }): string {
    const combined = [
      input.chapterGoal.mainConflict,
      input.chapterGoal.protagonistGoal,
      input.chapterGoal.payoffToDeliver,
      input.chapterGoal.nextChapterPull,
      input.currentState,
    ].join(" ");

    if (/(精血|气血).{0,8}(耗尽|枯竭|见底)|耗尽临界|blood.*deplet|essence.*empty/i.test(combined)) {
      return input.language === "zh"
        ? "精血耗尽临界点，引发血脉反噬反转"
        : "essence depletion reaches a critical threshold and flips the backlash";
    }
    if (/(濒死|垂死|将死|重伤|经脉崩裂|五脏受损|near death|dying|mortally wounded|meridians? shatter)/i.test(combined)) {
      return input.language === "zh"
        ? "极限濒死之际，被反噬逼出突破临界点"
        : "near-death pressure forces the breakthrough threshold open";
    }
    if (/(共鸣|呼应|碑|卷轴|残卷|血脉|祭坛|外力|resonance|artifact|tablet|scroll|bloodline|altar)/i.test(combined)) {
      return input.language === "zh"
        ? "外力共鸣撞上体内反噬，触发觉醒临界点"
        : "external resonance collides with the internal backlash and triggers awakening";
    }
    if (/(规则|法则|压制|冲突|反噬|失控|rule|law|suppression|collision|backlash|out of control)/i.test(combined)) {
      return input.language === "zh"
        ? "规则冲突压到极限，逼出反噬反转"
        : "a rule collision reaches critical pressure and flips the backlash";
    }
    if (/(愤怒|执念|悲痛|情绪|怒意|不甘|emotion|rage|grief|desperation|obsession)/i.test(combined)) {
      return input.language === "zh"
        ? "情绪爆发冲破压制，强行撬开觉醒缺口"
        : "an emotional surge breaks the suppression and tears open the awakening gap";
    }

    return input.language === "zh"
      ? "高压战斗把反噬推到临界点，逼出第一次觉醒"
      : "combat pressure pushes the backlash to a critical point and forces the first awakening";
  }

  private splitCompositePayoff(payoff: string): string[] {
    return payoff
      .split(/\s*(?:\+|＋|\/| and | AND |以及|并且|并需|同时完成)\s*/u)
      .map((segment) => this.normalizeMeaningfulText(segment))
      .filter((segment): segment is string => Boolean(segment))
      .filter((segment, index, all) => all.indexOf(segment) === index);
  }

  private pickPrimaryPayoffSegment(segments: ReadonlyArray<string>): string {
    const scored = segments.map((segment, index) => ({
      segment,
      index,
      score: this.scorePayoffSegment(segment),
    }));
    scored.sort((left, right) => right.score - left.score || left.index - right.index);
    return scored[0]?.segment ?? segments[0] ?? "";
  }

  private scorePayoffSegment(segment: string): number {
    let score = 0;

    if (/(觉醒|突破|拿到|获得|发现|找到|压住|掌握|逃离|摆脱|恢复|reveal|awaken|breakthrough|get|gain|find|stabilize|escape)/i.test(segment)) {
      score += 3;
    }
    if (/(压制|威胁|追兵|阴影|危机|危险|追杀|threat|pressure|danger|pursuit|shadow)/i.test(segment)) {
      score -= 2;
    }
    if (segment.length <= 12) {
      score += 1;
    }

    return score;
  }

  private composeDeferredPayoffPull(input: {
    readonly language: "zh" | "en";
    readonly primaryPayoff: string;
    readonly deferredText: string;
    readonly existingPull: string;
  }): string {
    const deferredLine = input.language === "zh"
      ? /(压制|威胁|追兵|阴影|危机|危险|追杀)/u.test(input.deferredText)
        ? `${input.primaryPayoff}后，${input.deferredText}会进一步逼近。`
        : `${input.primaryPayoff}后，${input.deferredText}将转入下章继续推进。`
      : /(pressure|threat|danger|pursuit|shadow)/i.test(input.deferredText)
        ? `After ${input.primaryPayoff}, ${input.deferredText} will close in harder.`
        : `After ${input.primaryPayoff}, ${input.deferredText} should continue in the next chapter.`;

    const existingPull = this.normalizeMeaningfulText(input.existingPull);
    if (!existingPull) {
      return deferredLine;
    }
    if (existingPull.includes(input.deferredText)) {
      return existingPull;
    }
    return this.unique([existingPull, deferredLine]).join(input.language === "zh" ? " " : " ");
  }

  private pickEscalationEndingHookType(
    chapterGoal: ChapterGoal,
    genreProfile?: { readonly powerScaling?: boolean },
  ): ChapterGoal["endingHookType"] {
    const joined = [
      chapterGoal.mainConflict,
      chapterGoal.protagonistGoal,
      chapterGoal.payoffToDeliver,
      chapterGoal.nextChapterPull,
    ].join(" ");

    if (/追|逃|追兵|追杀|追踪|围堵|封锁|pursuit|chase|tracked|escape/i.test(joined)) {
      return "pursuit";
    }
    if (genreProfile?.powerScaling !== false && /突破|破境|掌握|觉醒|晋阶|新能力|breakthrough|awaken|mastered|new ability/i.test(joined)) {
      return "breakthrough";
    }
    return "danger";
  }

  private buildMoodDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): MoodDirective | undefined {
    if (!this.shouldForceMoodDownshift(cadence)) {
      return undefined;
    }
    const moods = cadence.moodPressure?.recentMoods ?? [];

    return {
      targetMode: "breath",
      requiredSceneQuota: 1,
      moodCoverageMin: 0.3,
      forceSceneStructure: true,
      sceneMinShare: 0.3,
      scene1NoThreatEscalation: true,
      scene3ForwardOnly: true,
      forbidDominantMode: "combat-heavy",
      scenePlan: this.isChineseLanguage(language)
        ? {
          scene1: "pure recovery / relationship（mandatory，纯人物表达与情绪展开，>=30%，禁止 hook 推进 / 新威胁 / 规则压力）",
          scene2: "low-intensity forward move（optional，可带 1 次 hook 变化或轻微威胁）",
          scene3: "short exit beat only（如需收束，只保留极短尾拍，不再展开第三个高压场景）",
        }
        : {
          scene1: "pure recovery / relationship (mandatory, character expression only, >=30%, no hook advance or new threat)",
          scene2: "low-intensity forward move (optional, may carry one hook change or mild threat)",
          scene3: "short exit beat only (do not open a third high-pressure scene)",
        },
      note: this.isChineseLanguage(language)
        ? moods.length > 0
          ? `最近${moods.length}章情绪持续高压（${moods.slice(0, 3).join("、")}），本章必须降调——scene1 必须是纯人物/恢复场景，且至少覆盖正文约 30%；hook 推进与轻微威胁只能后置到 scene2。`
          : "最近连续数章都在高压对抗，本章必须降调——scene1 必须是纯人物/恢复场景，且至少覆盖正文约 30%；hook 推进与轻微威胁只能后置到 scene2。"
        : moods.length > 0
          ? `The last ${moods.length} chapters have stayed relentlessly tense (${moods.slice(0, 3).join(", ")}). Scene1 must be a pure recovery/relationship beat over roughly 30% of the chapter, while hook movement or mild threat must stay in Scene2.`
          : "Recent chapters have stayed confrontation-heavy. Scene1 must be a pure recovery/relationship beat over roughly 30% of the chapter, while hook movement or mild threat must stay in Scene2.",
    };
  }

  private buildBreathSceneIsolationDirective(
    baseDirective: string | undefined,
    language: string | undefined,
  ): string {
    const isolationLines = this.isChineseLanguage(language)
      ? [
        "Scene Isolation：scene1 必须是纯人物表达场景，优先恢复 / 关系 / 情绪展开。",
        "scene1 至少占正文 30%，禁止 hook 推进、新威胁、规则压力、风暴爆发。",
        "scene2 才允许低强度推进；最多带 1 次 hook 变化或轻微威胁。",
        "优先级：scene1 > payoff > hook。",
      ]
      : [
        "Scene Isolation: Scene1 must be a pure character-expression beat focused on recovery / relationship / emotional unfolding.",
        "Scene1 must cover at least 30% of the chapter and cannot carry hook advance, new threat, rule pressure, or storm escalation.",
        "Only Scene2 may handle low-intensity movement, with at most one hook change or mild threat.",
        "Priority: Scene1 > payoff > hook.",
      ];

    return this.unique([
      baseDirective,
      ...isolationLines,
    ].filter((value): value is string => Boolean(value && value.trim().length > 0))).join(" ");
  }

  private shouldForceMoodDownshift(
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): boolean {
    if (cadence.moodPressure?.pressure === "high") {
      return true;
    }

    const repeatedType = cadence.scenePressure?.repeatedType?.toLowerCase() ?? "";
    return cadence.scenePressure?.pressure === "high"
      && /(confront|combat|battle|action|对抗|冲突|战斗|厮杀)/i.test(repeatedType)
      && (cadence.scenePressure?.streak ?? 0) >= 3;
  }

  private buildTitleDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.titlePressure?.pressure !== "high") {
      return undefined;
    }
    const repeatedToken = cadence.titlePressure.repeatedToken;

    return this.isChineseLanguage(language)
      ? `标题不要再围绕“${repeatedToken}”重复命名，换一个新的意象或动作焦点。`
      : `Avoid another ${repeatedToken}-centric title. Pick a new image or action focus for this chapter title.`;
  }

  private renderHookBudget(activeCount: number, language: "zh" | "en"): string {
    const cap = 12;
    if (activeCount < 10) {
      return language === "en"
        ? `### Hook Budget\n- ${activeCount} active hooks (capacity: ${cap})`
        : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔（容量：${cap}）`;
    }
    const remaining = Math.max(0, cap - activeCount);
    return language === "en"
      ? `### Hook Budget\n- ${activeCount} active hooks — approaching capacity (${cap}). Only ${remaining} new hook(s) allowed. Prioritize resolving existing debt over opening new threads.`
      : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔——接近容量上限（${cap}）。仅剩 ${remaining} 个新坑位。优先回收旧债，不要轻易开新线。`;
  }

  private extractSection(content: string, headings: ReadonlyArray<string>): string | undefined {
    const targets = headings.map((heading) => this.normalizeHeading(heading));
    const lines = content.split("\n");
    let buffer: string[] | null = null;
    let sectionLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#+)\s*(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const heading = this.normalizeHeading(headingMatch[2]!);

        if (buffer && level <= sectionLevel) {
          break;
        }

        if (targets.includes(heading)) {
          buffer = [];
          sectionLevel = level;
          continue;
        }
      }

      if (buffer) {
        buffer.push(line);
      }
    }

    const section = buffer?.join("\n").trim();
    return section && section.length > 0 ? section : undefined;
  }

  private normalizeHeading(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[*_`:#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanListItem(line: string): string | undefined {
    const cleaned = line.replace(/^-\s*/, "").trim();
    if (cleaned.length === 0) return undefined;
    if (/^[-|]+$/.test(cleaned)) return undefined;
    if (this.isTemplatePlaceholder(cleaned)) return undefined;
    return cleaned;
  }

  private isTemplatePlaceholder(line: string): boolean {
    const normalized = line.trim();
    if (!normalized) return false;

    return (
      /^\((describe|briefly describe|write)\b[\s\S]*\)$/i.test(normalized)
      || /^（(?:在这里描述|描述|填写|写下)[\s\S]*）$/u.test(normalized)
      || /^（(?:未设定|未填写|待定|待补充|待填写|暂无|无）)$/u.test(normalized)
      || /^\((?:not set|unset|tbd|none|n\/a)\)$/iu.test(normalized)
    );
  }

  private containsChinese(content: string): boolean {
    return /[\u4e00-\u9fff]/.test(content);
  }

  private resolveOutlineSelection(volumeOutline: string, chapterNumber: number): OutlineSelection {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchExactOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[1]);
      if (inlineContent) {
        return {
          node: inlineContent,
          matchedAnchor: true,
          source: "exact",
        };
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return {
          node: nextContent,
          matchedAnchor: true,
          source: "exact",
        };
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchRangeOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[3]);
      if (inlineContent) {
        return {
          node: inlineContent,
          matchedAnchor: true,
          source: "range",
        };
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return {
          node: nextContent,
          matchedAnchor: true,
          source: "range",
        };
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!this.isOutlineAnchorLine(line)) continue;

      const exactMatch = this.matchAnyExactOutlineLine(line);
      if (exactMatch) {
        const inlineContent = this.cleanOutlineContent(exactMatch[1]);
        if (inlineContent) {
          return {
            node: inlineContent,
            matchedAnchor: false,
            source: "fallback-first",
          };
        }
      }

      const rangeMatch = this.matchAnyRangeOutlineLine(line);
      if (rangeMatch) {
        const inlineContent = this.cleanOutlineContent(rangeMatch[3]);
        if (inlineContent) {
          return {
            node: inlineContent,
            matchedAnchor: false,
            source: "fallback-first",
          };
        }
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return {
          node: nextContent,
          matchedAnchor: false,
          source: "fallback-first",
        };
      }

      break;
    }

    const fallback = this.extractFirstDirective(volumeOutline);
    return fallback
      ? {
        node: fallback,
        matchedAnchor: false,
        source: "fallback-any",
      }
      : {
        matchedAnchor: false,
        source: "missing",
      };
  }

  private cleanOutlineContent(content?: string): string | undefined {
    const cleaned = content?.trim().replace(/^[*_`~:：\-\s]+/u, "").trim();
    if (!cleaned) return undefined;
    if (/^[*_`~:：-]+$/.test(cleaned)) return undefined;
    return cleaned;
  }

  private findNextOutlineContent(lines: ReadonlyArray<string>, startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line) {
        continue;
      }

      if (this.isOutlineAnchorLine(line)) {
        return undefined;
      }

      if (line.startsWith("#")) {
        continue;
      }

      const cleaned = this.cleanOutlineContent(line);
      if (cleaned) {
        return cleaned;
      }
    }

    return undefined;
  }

  private buildContinuityAnchor(input: {
    readonly currentState: string;
    readonly currentFocus: string;
    readonly chapterSummaries: string;
    readonly chapterNumber: number;
  }): ContinuityAnchor {
    const summaries = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => left.chapter - right.chapter);
    const latestSummary = summaries.at(-1);
    const firstSummary = summaries[0];
    const stateGoal = this.extractCurrentStateField(input.currentState, ["Current Goal", "当前目标"]);
    const stateConflict = this.extractCurrentStateField(input.currentState, ["Current Conflict", "当前冲突"]);
    const stateLocation = this.extractCurrentStateField(input.currentState, ["Current Location", "当前位置"]);
    const latestSummaryText = latestSummary
      ? [latestSummary.events, latestSummary.stateChanges, latestSummary.hookActivity]
        .filter(Boolean)
        .join(" | ")
      : undefined;
    const recentOutlineNode = this.firstMeaningful([
      latestSummaryText,
      [stateGoal, stateConflict, stateLocation].filter(Boolean).join(" | "),
      this.extractFocusGoal(input.currentFocus),
    ]);

    return {
      goal: this.firstMeaningful([stateGoal, latestSummary?.events, stateConflict, this.extractFocusGoal(input.currentFocus)]),
      outlineNode: recentOutlineNode,
      summaryText: latestSummaryText,
      firstSummaryText: firstSummary
        ? [firstSummary.title, firstSummary.events, firstSummary.stateChanges, firstSummary.hookActivity]
          .filter(Boolean)
          .join(" | ")
        : undefined,
    };
  }

  private shouldDeprioritizeOutlineNode(input: {
    readonly chapterNumber: number;
    readonly outlineSelection: OutlineSelection;
    readonly continuityAnchor: ContinuityAnchor;
  }): boolean {
    const outlineNode = input.outlineSelection.node;
    if (!outlineNode) {
      return false;
    }

    const recentAnchor = this.firstMeaningful([
      input.continuityAnchor.goal,
      input.continuityAnchor.outlineNode,
      input.continuityAnchor.summaryText,
    ]);
    if (!recentAnchor) {
      return false;
    }

    const overlapsRecent = this.hasKeywordOverlap(outlineNode, recentAnchor);
    if (overlapsRecent) {
      return false;
    }

    const overlapsOpening = input.continuityAnchor.firstSummaryText
      ? this.hasKeywordOverlap(outlineNode, input.continuityAnchor.firstSummaryText)
      : false;
    if (input.chapterNumber >= 4 && overlapsOpening) {
      return true;
    }

    return input.chapterNumber >= 3
      && (input.outlineSelection.source === "fallback-first" || input.outlineSelection.source === "fallback-any");
  }

  private extractCurrentStateField(currentState: string, labels: ReadonlyArray<string>): string | undefined {
    const rows = currentState
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && !line.includes("---"))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

    for (const row of rows) {
      const label = row[0] ?? "";
      const value = row[1] ?? "";
      if (!label || !value) continue;
      if (labels.some((candidate) => candidate.toLowerCase() === label.toLowerCase())) {
        return value;
      }
    }

    return undefined;
  }

  private firstMeaningful(values: ReadonlyArray<string | undefined>): string | undefined {
    return values.find((value) => Boolean(value && value.trim().length > 0));
  }

  private buildPlannerHookThrottle(input: {
    readonly activeHooks: ReadonlyArray<StoredHook>;
    readonly chapterSummaries: string;
    readonly chapterNumber: number;
    readonly hookAgenda: ChapterIntent["hookAgenda"];
  }): PlannerHookThrottle {
    const cap = 12;
    const activeCount = input.activeHooks.filter((hook) => this.isActiveHookAtChapter(hook, input.chapterNumber)).length;
    const recentSummaries = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => left.chapter - right.chapter)
      .slice(-2);
    const recentNewSignals = recentSummaries.filter((summary) =>
      /seeded|new hook|open(ed)? new|新开|埋下|开坑|新伏笔/u.test(summary.hookActivity),
    ).length;
    const recentResolveSignals = recentSummaries.filter((summary) =>
      /resolve|resolved|payoff|paid off|回收|兑现|揭晓|解决/u.test(summary.hookActivity),
    ).length;
    const pressuredHookIds = this.unique([
      ...input.hookAgenda.mustAdvance,
      ...input.hookAgenda.eligibleResolve,
      ...input.hookAgenda.staleDebt,
    ]);
    const recentOpenBias = recentNewSignals > recentResolveSignals;

    return {
      activeCount,
      cap,
      suggestedNewHookCap: activeCount > cap || recentOpenBias ? 1 : 2,
      shouldThrottle: activeCount > cap || recentOpenBias || pressuredHookIds.length > 0,
      recentOpenBias,
      pressuredHookIds,
    };
  }

  private isActiveHookAtChapter(hook: StoredHook, chapterNumber: number): boolean {
    if (/^(resolved|deferred|closed|done|已解决|已回收)$/i.test(hook.status.trim())) {
      return false;
    }
    return hook.startChapter <= chapterNumber || hook.lastAdvancedChapter > 0;
  }

  private buildHookDebtMustAvoid(
    throttle: PlannerHookThrottle,
    language: "zh" | "en",
  ): string[] {
    if (!throttle.shouldThrottle) {
      return [];
    }

    return [
      language === "en"
        ? `Do not open more than ${throttle.suggestedNewHookCap} new hook family this chapter.`
        : `本章不要再新开超过 ${throttle.suggestedNewHookCap} 个新伏笔家族。`,
      throttle.recentOpenBias
        ? language === "en"
          ? "Recent chapters opened more hooks than they resolved. Favor old debt movement over fresh setup."
          : "最近两章新开伏笔多于回收，优先推进旧债，不要继续堆新坑。"
        : undefined,
    ].filter((item): item is string => Boolean(item));
  }

  private buildHookDebtThrottleConflicts(
    throttle: PlannerHookThrottle,
    foreshadowToTouch: ReadonlyArray<string>,
  ): ChapterConflict[] {
    if (!throttle.shouldThrottle) {
      return [];
    }

    if (foreshadowToTouch.length > 0) {
      return [];
    }

    return [
      {
        type: "hook_debt_throttle",
        resolution: "advance an existing hook before opening parallel debt",
      },
    ];
  }

  private matchExactOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const patterns = [
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chapter\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?第\\s*${chapterNumber}\\s*章(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`),
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchAnyExactOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*\d+\s*章(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchRangeOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const match = this.matchAnyRangeOutlineLine(line);
    if (!match) return undefined;
    if (this.isChapterWithinRange(match[1], match[2], chapterNumber)) {
      return match;
    }

    return undefined;
  }

  private matchAnyRangeOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*(\d+)\s*[-~–—]\s*(\d+)\s*章(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private isOutlineAnchorLine(line: string): boolean {
    return this.matchAnyExactOutlineLine(line) !== undefined
      || this.matchAnyRangeOutlineLine(line) !== undefined;
  }

  private isChapterWithinRange(startText: string | undefined, endText: string | undefined, chapterNumber: number): boolean {
    const start = Number.parseInt(startText ?? "", 10);
    const end = Number.parseInt(endText ?? "", 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return chapterNumber >= lower && chapterNumber <= upper;
  }

  private hasKeywordOverlap(left: string, right: string): boolean {
    const keywords = this.extractKeywords(left);
    if (keywords.length === 0) return false;
    const normalizedRight = right.toLowerCase();
    return keywords.some((keyword) => normalizedRight.includes(keyword.toLowerCase()));
  }

  private extractKeywords(content: string): string[] {
    const english = content.match(/[a-z]{4,}/gi) ?? [];
    const chinese = content.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
    return this.unique([...english, ...chinese]);
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    language: "zh" | "en",
    pendingHooks: string,
    chapterSummaries: string,
    activeHookCount: number,
    hookEmergence: HookEmergenceDirective,
  ): string {
    const conflictLines = intent.conflicts.length > 0
      ? intent.conflicts.map((conflict) =>
        `- ${conflict.type}: ${conflict.resolution}${conflict.detail ? ` (${conflict.detail})` : ""}`,
      ).join("\n")
      : "- none";

    const mustKeep = intent.mustKeep.length > 0
      ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
      : "- none";

    const mustAvoid = intent.mustAvoid.length > 0
      ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
      : "- none";

    const styleEmphasis = intent.styleEmphasis.length > 0
      ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
      : "- none";
    const directives = [
      intent.chapterMode ? `- chapterMode: ${intent.chapterMode}` : undefined,
      intent.endingType ? `- endingType: ${intent.endingType}` : undefined,
      intent.arcDirective ? `- arc: ${intent.arcDirective}` : undefined,
      intent.sceneDirective ? `- scene: ${intent.sceneDirective}` : undefined,
      intent.directivePriority
        ? [
          "- directivePriority:",
          ...intent.directivePriority.ordered.map((item, index) => `  - ${index + 1}. ${item}`),
        ].join("\n")
        : undefined,
      intent.hookExecutionPhase ? `- hookExecutionPhase: ${intent.hookExecutionPhase}` : undefined,
      intent.moodDirective
        ? [
          "- mood:",
          `  - targetMode: ${intent.moodDirective.targetMode}`,
          `  - requiredSceneQuota: ${intent.moodDirective.requiredSceneQuota}`,
          `  - moodCoverageMin: ${intent.moodDirective.moodCoverageMin}`,
          `  - forbidDominantMode: ${intent.moodDirective.forbidDominantMode}`,
          intent.moodDirective.scenePlan
            ? [
              "  - scenePlan:",
              `    - scene1: ${intent.moodDirective.scenePlan.scene1}`,
              `    - scene2: ${intent.moodDirective.scenePlan.scene2}`,
              `    - scene3: ${intent.moodDirective.scenePlan.scene3}`,
            ].join("\n")
            : undefined,
          intent.moodDirective.note ? `  - note: ${intent.moodDirective.note}` : undefined,
        ].filter(Boolean).join("\n")
        : undefined,
      intent.titleDirective ? `- title: ${intent.titleDirective}` : undefined,
    ].filter(Boolean).join("\n") || "- none";
    const chapterGoal = intent.chapterGoal
      ? [
        `- mainConflict: ${intent.chapterGoal.mainConflict}`,
        `- protagonistGoal: ${intent.chapterGoal.protagonistGoal}`,
        `- activeCharacters: ${intent.chapterGoal.activeCharacters.join(", ") || "none"}`,
        `- foreshadowToTouch: ${intent.chapterGoal.foreshadowToTouch.join(", ") || "none"}`,
        `- payoffToDeliver: ${intent.chapterGoal.payoffToDeliver}`,
        intent.chapterGoal.payoffTrigger
          ? `- payoffTrigger: ${intent.chapterGoal.payoffTrigger}`
          : undefined,
        intent.chapterGoal.payoffDirective
          ? [
            `- payoffDirective.promisedPayoff: ${intent.chapterGoal.payoffDirective.promisedPayoff}`,
            `- payoffDirective.payoffType: ${intent.chapterGoal.payoffDirective.payoffType}`,
            `- payoffDirective.payoffDepth: ${intent.chapterGoal.payoffDirective.payoffDepth ?? "layered"}`,
            `- payoffDirective.payoffScope: ${intent.chapterGoal.payoffDirective.payoffScope ?? "chapter"}`,
            `- payoffDirective.mandatoryByFinalAct: ${intent.chapterGoal.payoffDirective.mandatoryByFinalAct}`,
          ].join("\n")
          : undefined,
        intent.chapterGoal.maxRevealLayersPerChapter
          ? `- maxRevealLayersPerChapter: ${intent.chapterGoal.maxRevealLayersPerChapter}`
          : undefined,
        `- endingType: ${intent.endingType ?? this.mapLegacyEndingHookToEndingType(intent.chapterGoal.endingHookType)}`,
        `- nextChapterPull: ${intent.chapterGoal.nextChapterPull}`,
      ].join("\n")
      : "- none";
    const hookAgenda = [
      "### Must Advance",
      intent.hookAgenda.mustAdvance.length > 0
        ? intent.hookAgenda.mustAdvance.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      "### Eligible Resolve",
      intent.hookAgenda.eligibleResolve.length > 0
        ? intent.hookAgenda.eligibleResolve.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      "### Stale Debt",
      intent.hookAgenda.staleDebt.length > 0
        ? intent.hookAgenda.staleDebt.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      "### Avoid New Hook Families",
      intent.hookAgenda.avoidNewHookFamilies.length > 0
        ? intent.hookAgenda.avoidNewHookFamilies.map((item) => `- ${item}`).join("\n")
        : "- none",
      "",
      "### Hook Pressure States",
      hookEmergence.pressureStates.length > 0
        ? hookEmergence.pressureStates
          .map((entry) => `- ${entry.hookId}: ${entry.state} (${entry.timing})`)
          .join("\n")
        : "- none",
      "",
      "### Emergence Directive",
      `- mustMaterializeHookNow: ${hookEmergence.mustMaterializeHookNow}`,
      intent.hookExecutionPhase
        ? `- hookExecutionPhase: ${intent.hookExecutionPhase}`
        : (hookEmergence.hookExecutionPhase ? `- hookExecutionPhase: ${hookEmergence.hookExecutionPhase}` : undefined),
      hookEmergence.targetHook ? `- targetHookId: ${hookEmergence.targetHook.hookId}` : undefined,
      hookEmergence.targetHook ? `- targetHookState: ${hookEmergence.targetHook.state}` : undefined,
      hookEmergence.targetHook ? `- targetHookType: ${hookEmergence.targetHook.type}` : undefined,
      hookEmergence.targetHook ? `- targetHookExpectedPayoff: ${hookEmergence.targetHook.expectedPayoff || "none"}` : undefined,
      hookEmergence.targetHook ? `- targetHookNotes: ${hookEmergence.targetHook.notes || "none"}` : undefined,
      hookEmergence.targetHook
        ? (language === "en"
          ? "- antiStall: Mentioning the hook name or repeating old danger does not count. The hook must gain a new state change this chapter."
          : "- antiStall: 仅仅再次提到 hook 名字、重复旧信息、或只说危险仍在，不算推进；本章必须让这个 hook 产生新状态变化。")
        : undefined,
      "",
      this.renderHookBudget(activeHookCount, language),
    ].filter(Boolean).join("\n");

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      `- goalIntensity: ${intent.goalIntensity}`,
      "",
      "## Outline Node",
      intent.conflicts?.some((c) => c.type === "outline_vs_recent_state" || c.type === "outline_vs_request" || c.type === "outline_vs_current_focus")
        ? "(not found)"
        : (intent.outlineNode ?? "(not found)"),
      "",
      "## Must Keep",
      mustKeep,
      "",
      "## Must Avoid",
      mustAvoid,
      "",
      "## Style Emphasis",
      styleEmphasis,
      "",
      "## Structured Directives",
      directives,
      "",
      "## Chapter Goal",
      chapterGoal,
      "",
      "## Hook Agenda",
      hookAgenda,
      "",
      "## Conflicts",
      conflictLines,
      "",
      "## Pending Hooks Snapshot",
      pendingHooks,
      "",
      "## Chapter Summaries Snapshot",
      chapterSummaries,
      "",
      this.renderMandatoryItems(intent.mandatoryItems, language, intent.sceneDirective),
    ].join("\n");
  }

  private renderMandatoryItems(
    items: ReadonlyArray<{ description: string; signal: string }>,
    language: "zh" | "en",
    sceneDirective?: string,
  ): string {
    if (items.length === 0) return "";
    const header = language === "zh"
      ? "=== MANDATORY_ITEMS ===\n以下条目本章正文必须出现，缺一条则本章不合格："
      : "=== MANDATORY_ITEMS ===\nThe following items MUST appear in this chapter. Missing any = FAIL:";

    // Scene-bound anchors (Plan B): if scene info available, suggest which scene
    // each item should appear in. This converts abstract "must remember" tasks into
    // actionable "do X during scene Y" instructions for the LLM.
    const scenes = this.parseSceneHints(sceneDirective);
    const lines = items.map((item, index) => {
      const sceneHint = this.assignSceneHint(item, scenes, index, items.length);
      const label = sceneHint
        ? `${index + 1}. [${sceneHint}] ${item.description}`
        : `${index + 1}. ${item.description}`;
      return `- [ ] ${label}`;
    });

    return [header, ...lines, ""].join("\n");
  }

  /** Extract scene boundary hints from the scene directive string. */
  private parseSceneHints(sceneDirective?: string): string[] {
    if (!sceneDirective) return [];
    const scenes: string[] = [];
    // Match patterns like "开场" / "核心场景" / "结尾" / "scene1" / "scene2"
    const patterns = [
      /(开场[^，。,\.]{0,15})/gu,
      /(核心场景[^，。,\.]{0,15})/gu,
      /(结尾[^，。,\.]{0,15})/gu,
      /(scene\s*[123][^,\.]{0,15})/giu,
    ];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sceneDirective)) !== null) {
        const clean = match[0].replace(/[：:]/g, "").trim();
        if (clean.length >= 2 && !scenes.some((s) => s.includes(clean.slice(0, 4)))) {
          scenes.push(clean);
        }
      }
    }
    return scenes.slice(0, 4);
  }

  /** Assign a mandatory item to the most appropriate scene position. */
  private assignSceneHint(
    item: { description: string; signal: string },
    scenes: string[],
    index: number,
    total: number,
  ): string | undefined {
    if (scenes.length === 0) return undefined;

    // Heuristic assignment based on item position and content
    const desc = item.description;

    // Time anchors → opening scene
    if (/倒计时|时间|日历|收音机|标语/.test(desc)) {
      return scenes.find((s) => /开场|scene\s*1|opening/i.test(s)) ?? scenes[0];
    }

    // Character appearances → middle scenes (core/transition)
    if (/出场|提及|路过|默念/.test(desc)) {
      const mid = scenes.find((s) => /核心|scene\s*2|middle/i.test(s));
      return mid ?? scenes[Math.min(1, scenes.length - 1)];
    }

    // Setting/hook details → ending scene or last scene
    if (/结尾|钩子|下一步|下一章/.test(desc)) {
      return scenes.find((s) => /结尾|scene\s*3|ending/i.test(s)) ?? scenes[scenes.length - 1];
    }

    // Proportional distribution for remaining items
    const fraction = index / Math.max(total - 1, 1);
    const sceneIndex = Math.min(Math.floor(fraction * scenes.length), scenes.length - 1);
    return scenes[sceneIndex];
  }

  private mapLegacyEndingHookToEndingType(endingHookType: ChapterGoal["endingHookType"]): EndingType {
    switch (endingHookType) {
      case "reveal":
        return "reveal_end";
      case "danger":
      case "pursuit":
        return "unresolved_end";
      case "choice":
      case "breakthrough":
      default:
        return "resolution_end";
    }
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private isHookSupportedByChapterContext(input: {
    readonly hook: StoredHook;
    readonly chapterNumber: number;
    readonly currentFocus: string;
    readonly currentState: string;
    readonly outlineNode?: string;
    readonly goal: string;
  }): boolean {
    const hook = input.hook;
    if (!this.isActiveHookAtChapter(hook, input.chapterNumber)) {
      return false;
    }
    if (hook.lastAdvancedChapter > 0 || hook.startChapter < input.chapterNumber) {
      return true;
    }

    const chapterContext = [
      input.goal,
      input.outlineNode,
      input.currentState,
      this.extractCurrentFocusChapterBlock(input.currentFocus, input.chapterNumber).join("\n"),
    ].filter(Boolean).join("\n");
    if (!chapterContext.trim()) {
      return true;
    }

    const terms = this.extractHookSupportTerms([hook.hookId, hook.type, hook.notes, hook.expectedPayoff].join(" "));
    if (terms.length === 0) {
      return true;
    }
    return terms.some((term) => chapterContext.includes(term));
  }

  private extractCurrentFocusChapterBlock(currentFocus: string, chapterNumber: number): string[] {
    const chapterPattern = new RegExp(`第\\s*${chapterNumber}\\s*章`, "u");
    const anyChapterPattern = /第\s*\d+\s*章/u;
    const lines = currentFocus.split("\n");
    const block: string[] = [];
    let inBlock = false;

    for (const line of lines) {
      if (!inBlock && chapterPattern.test(line)) {
        inBlock = true;
        block.push(line);
        continue;
      }
      if (!inBlock) continue;
      if ((anyChapterPattern.test(line) && !chapterPattern.test(line)) || /^##\s/u.test(line)) {
        break;
      }
      block.push(line);
    }

    return block;
  }

  private extractCurrentFocusChapterEndingHook(currentFocus: string, chapterNumber: number): string | undefined {
    if (!currentFocus.trim() || !Number.isFinite(chapterNumber) || chapterNumber <= 0) {
      return undefined;
    }
    const block = this.extractCurrentFocusChapterBlock(currentFocus, chapterNumber).join("\n");
    const match = block.match(/(?:\*\*)?(?:章节结尾钩子|结尾钩子|Ending hook|Chapter ending hook)(?:\*\*)?\s*[：:]\s*(.+)$/imu);
    const value = this.normalizeMeaningfulText(match?.[1] ?? "");
    return value || undefined;
  }

  private extractHookSupportTerms(text: string): string[] {
    const blocked = new Set([
      "人物伏笔", "事件伏笔", "情感伏笔", "商业伏笔", "家庭伏笔", "对手伏笔", "关系伏笔", "冲突伏笔",
      "伏笔", "首次", "出场", "前世", "主角", "认出", "但未", "主动", "接触", "日后", "线索", "中程", "近期", "慢烧",
    ]);
    const zhTerms = [...text.matchAll(/[\u4e00-\u9fff]{2,4}/gu)]
      .map((match) => match[0])
      .filter((term) => !blocked.has(term))
      .filter((term) => !/^(?:这个|那个|自己|什么|如何|必须|即将|已经|正在|首次|日后)$/u.test(term));
    const enTerms = [...text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g)]
      .map((match) => match[0])
      .filter((term) => !/^(Hook|Chapter|Event|Character)$/i.test(term));

    return this.unique([...zhTerms, ...enTerms])
      .sort((left, right) => right.length - left.length)
      .slice(0, 8);
  }

  private buildHookEmergenceDirective(input: {
    readonly hooks: ReadonlyArray<StoredHook>;
    readonly chapterNumber: number;
    readonly targetChapters?: number;
  }): HookEmergenceDirective {
    const pressureStates = input.hooks
      .filter((hook) => this.isActiveHookAtChapter(hook, input.chapterNumber))
      .map((hook) => {
        const lifecycle = describeHookLifecycle({
          payoffTiming: hook.payoffTiming,
          expectedPayoff: hook.expectedPayoff,
          notes: hook.notes,
          startChapter: hook.startChapter,
          lastAdvancedChapter: hook.lastAdvancedChapter,
          status: hook.status,
          chapterNumber: input.chapterNumber,
          targetChapters: input.targetChapters,
        });
        return {
          hookId: hook.hookId,
          state: this.resolveHookPressureState(lifecycle),
          timing: resolveHookPayoffTiming(hook),
          type: hook.type,
          expectedPayoff: hook.expectedPayoff,
          notes: hook.notes,
          dormancy: lifecycle.dormancy,
        };
      });

    const target = pressureStates
      .filter((hook) => hook.state === "must-resolve-now" || hook.state === "overdue")
      .sort((left, right) => (
        this.hookStateWeight(right.state) - this.hookStateWeight(left.state)
        || right.dormancy - left.dormancy
        || left.hookId.localeCompare(right.hookId)
      ))[0];

    return {
      pressureStates: pressureStates.map(({ dormancy: _dormancy, ...entry }) => entry),
      mustMaterializeHookNow: Boolean(target),
      ...(target ? { hookExecutionPhase: "any" as const } : {}),
      ...(target
        ? {
          targetHook: {
            hookId: target.hookId,
            state: target.state,
            timing: target.timing,
            type: target.type,
            expectedPayoff: target.expectedPayoff,
            notes: target.notes,
          },
        }
        : {}),
    };
  }

  private resolveHookPressureState(lifecycle: ReturnType<typeof describeHookLifecycle>): HookPressureStateEntry["state"] {
    if (lifecycle.overdue && (lifecycle.readyToResolve || lifecycle.dormancy >= 2)) {
      return "must-resolve-now";
    }
    if (lifecycle.overdue) {
      return "overdue";
    }
    if (lifecycle.stale || lifecycle.readyToResolve || lifecycle.dormancy >= 4) {
      return "due";
    }
    return "normal";
  }

  private hookStateWeight(state: HookPressureStateEntry["state"]): number {
    switch (state) {
      case "must-resolve-now":
        return 4;
      case "overdue":
        return 3;
      case "due":
        return 2;
      case "normal":
      default:
        return 1;
    }
  }

  private buildHookEmergenceMustKeep(
    hookEmergence: HookEmergenceDirective,
    language: "zh" | "en",
  ): string[] {
    if (!hookEmergence.mustMaterializeHookNow || !hookEmergence.targetHook) {
      return [];
    }
    return [language === "en"
      ? `Hook ${hookEmergence.targetHook.hookId} must change state this chapter.`
      : `Hook ${hookEmergence.targetHook.hookId} 本章必须发生状态变化。`];
  }

  private buildHookEmergenceMustAvoid(
    hookEmergence: HookEmergenceDirective,
    language: "zh" | "en",
  ): string[] {
    if (!hookEmergence.mustMaterializeHookNow || !hookEmergence.targetHook) {
      return [];
    }
    return [language === "en"
      ? `Do not leave ${hookEmergence.targetHook.hookId} suspended again through a mention-only beat.`
      : `不要再用“只提一嘴”的方式继续拖延 ${hookEmergence.targetHook.hookId}。`];
  }

  private isChineseLanguage(language: string | undefined): boolean {
    return (language ?? "zh").toLowerCase().startsWith("zh");
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }
}
