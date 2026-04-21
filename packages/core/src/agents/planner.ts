import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { parseBookRules } from "../models/book-rules.js";
import {
  ChapterIntentSchema,
  type ChapterConflict,
  type ChapterGoal,
  type ChapterIntent,
  type MoodDirective,
} from "../models/input-governance.js";
import type { StoredHook } from "../state/memory-db.js";
import {
  parseChapterSummariesMarkdown,
  renderHookSnapshot,
  renderSummarySnapshot,
  retrieveMemorySelection,
} from "../utils/memory-retrieval.js";
import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import { buildPlannerHookAgenda } from "../utils/hook-agenda.js";
import { buildChapterGoal } from "../utils/chapter-goal-builder.js";
import {
  summarizeArcMap,
  summarizeGenreProfile,
  summarizePowerSystem,
} from "../utils/webnovel-inputs.js";
import { describeHookLifecycle, resolveHookPayoffTiming } from "../utils/hook-lifecycle.js";

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
  readonly state: "normal" | "due" | "overdue" | "must-resolve-now";
  readonly timing: string;
  readonly type: string;
  readonly expectedPayoff: string;
  readonly notes: string;
}

interface HookEmergenceDirective {
  readonly pressureStates: ReadonlyArray<HookPressureStateEntry>;
  readonly mustMaterializeHookNow: boolean;
  readonly targetHook?: HookPressureStateEntry;
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
      currentState,
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
    const genreProfile = summarizeGenreProfile(genreProfileRaw, language);
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
    const goal = this.deriveGoal(
      input.externalContext,
      currentFocus,
      authorIntent,
      outlineLooksStale ? continuityAnchor.goal : undefined,
      outlineNode,
      arcMap.goalHint,
      input.chapterNumber,
    );
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
      ...this.collectStyleEmphasis(authorIntent, currentFocus),
      ...genreProfile.styleEmphasis,
    ]).slice(0, 6);
    const conflicts = this.collectConflicts(
      input.externalContext,
      currentFocus,
      outlineNode,
      volumeOutline,
      outlineLooksStale,
    );
    const planningAnchor = conflicts.length > 0 ? undefined : outlineNode;
    const memorySelection = await retrieveMemorySelection({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode: planningAnchor,
      mustKeep: mustKeepBase,
    });
    const activeHookCount = memorySelection.activeHooks.filter(
      (hook) => hook.status !== "resolved" && hook.status !== "deferred",
    ).length;
    const hookAgenda = buildPlannerHookAgenda({
      hooks: memorySelection.activeHooks,
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
    const hookEmergence = this.buildHookEmergenceDirective({
      hooks: memorySelection.activeHooks,
      chapterNumber: input.chapterNumber,
      targetChapters: input.book.targetChapters,
    });
    const mustKeep = this.unique([
      ...mustKeepBase,
      ...this.buildHookEmergenceMustKeep(hookEmergence, language),
    ]).slice(0, 6);
    const mustAvoid = this.unique([
      ...mustAvoidBase,
      ...this.buildHookEmergenceMustAvoid(hookEmergence, language),
    ]).slice(0, 8);
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
    const rawChapterGoal = buildChapterGoal({
      language,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode,
      currentFocus,
      currentState,
      chapterSummaries,
      pendingHooksRaw,
      foreshadowRegistryRaw,
      hookAgenda,
      selectedHooks: memorySelection.activeHooks,
      arcMap,
      genreProfile,
      powerSystem,
    });
    const chapterGoal = this.applyCadenceChapterGoalOverrides(rawChapterGoal, cadence);
    const directives = this.buildStructuredDirectives({
      chapterNumber: input.chapterNumber,
      language: input.book.language,
      volumeOutline,
      outlineNode,
      matchedOutlineAnchor,
      cadence,
      arcMapDirective: arcMap.arcDirective,
    });
    const throttleConflicts = this.buildHookDebtThrottleConflicts(hookThrottle, chapterGoal.foreshadowToTouch);
    const cadenceMustAvoid = this.buildCadenceMustAvoid(language, cadence);

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal,
      outlineNode,
      ...directives,
      mustKeep,
      mustAvoid: this.unique([
        ...mustAvoid,
        ...cadenceMustAvoid,
        ...this.buildHookDebtMustAvoid(hookThrottle, language),
      ]).slice(0, 8),
      styleEmphasis,
      conflicts: [...conflicts, ...throttleConflicts],
      chapterGoal,
      hookAgenda,
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
      plannerInputs: [
        ...Object.values(sourcePaths),
        ...(memorySelection.dbPath ? [memorySelection.dbPath] : []),
      ],
      runtimePath,
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
  }): Pick<ChapterIntent, "sceneDirective" | "arcDirective" | "moodDirective" | "titleDirective"> {
    return {
      arcDirective: this.buildArcDirective(
        input.language,
        input.volumeOutline,
        input.outlineNode,
        input.matchedOutlineAnchor,
        input.arcMapDirective,
      ),
      sceneDirective: this.buildSceneDirective(input.language, input.cadence),
      moodDirective: this.buildMoodDirective(input.language, input.cadence),
      titleDirective: this.buildTitleDirective(input.language, input.cadence),
    };
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
          /avoid|don't|do not|不要|别|禁止/i.test(line),
        )
        .map((line) => this.cleanListItem(line))
        .filter((line): line is string => Boolean(line));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractFocusStyleItems(currentFocus),
      ...this.extractListItems(authorIntent, 2),
    ]).slice(0, 4);
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

  private applyCadenceChapterGoalOverrides(
    chapterGoal: ChapterGoal,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): ChapterGoal {
    if (!cadence.breathingCollapse) {
      return chapterGoal;
    }

    if (chapterGoal.endingHookType !== "reveal" && chapterGoal.endingHookType !== "choice") {
      return chapterGoal;
    }

    return {
      ...chapterGoal,
      endingHookType: this.pickEscalationEndingHookType(chapterGoal),
    };
  }

  private pickEscalationEndingHookType(chapterGoal: ChapterGoal): ChapterGoal["endingHookType"] {
    const joined = [
      chapterGoal.mainConflict,
      chapterGoal.protagonistGoal,
      chapterGoal.payoffToDeliver,
      chapterGoal.nextChapterPull,
    ].join(" ");

    if (/追|逃|追兵|追杀|追踪|围堵|封锁|pursuit|chase|tracked|escape/i.test(joined)) {
      return "pursuit";
    }
    if (/突破|破境|掌握|觉醒|晋阶|新能力|breakthrough|awaken|mastered|new ability/i.test(joined)) {
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
      forbidDominantMode: "combat-heavy",
      note: this.isChineseLanguage(language)
        ? moods.length > 0
          ? `最近${moods.length}章情绪持续高压（${moods.slice(0, 3).join("、")}），本章必须降调——至少安排 1 段日常/喘息/温情/幽默场景，且相关内容至少覆盖正文约 30%。`
          : "最近连续数章都在高压对抗，本章必须降调——至少安排 1 段日常/喘息/温情/幽默场景，且相关内容至少覆盖正文约 30%。"
        : moods.length > 0
          ? `The last ${moods.length} chapters have stayed relentlessly tense (${moods.slice(0, 3).join(", ")}). This chapter must downshift, include at least one breathing / warm / humorous scene, and keep that mode over roughly 30% of the chapter.`
          : "Recent chapters have stayed confrontation-heavy. This chapter must downshift, include at least one breathing / warm / humorous scene, and keep that mode over roughly 30% of the chapter.",
    };
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
    const cleaned = content?.trim();
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
    const activeCount = input.activeHooks.filter((hook) => !/^(resolved|deferred)$/i.test(hook.status)).length;
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
      ? intent.conflicts.map((conflict) => `- ${conflict.type}: ${conflict.resolution}`).join("\n")
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
      intent.arcDirective ? `- arc: ${intent.arcDirective}` : undefined,
      intent.sceneDirective ? `- scene: ${intent.sceneDirective}` : undefined,
      intent.moodDirective
        ? [
          "- mood:",
          `  - targetMode: ${intent.moodDirective.targetMode}`,
          `  - requiredSceneQuota: ${intent.moodDirective.requiredSceneQuota}`,
          `  - moodCoverageMin: ${intent.moodDirective.moodCoverageMin}`,
          `  - forbidDominantMode: ${intent.moodDirective.forbidDominantMode}`,
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
        intent.chapterGoal.payoffDirective
          ? [
            `- payoffDirective.promisedPayoff: ${intent.chapterGoal.payoffDirective.promisedPayoff}`,
            `- payoffDirective.payoffType: ${intent.chapterGoal.payoffDirective.payoffType}`,
            `- payoffDirective.mandatoryByFinalAct: ${intent.chapterGoal.payoffDirective.mandatoryByFinalAct}`,
          ].join("\n")
          : undefined,
        `- endingHookType: ${intent.chapterGoal.endingHookType}`,
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
      "",
      "## Outline Node",
      intent.outlineNode ?? "(not found)",
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
    ].join("\n");
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private buildHookEmergenceDirective(input: {
    readonly hooks: ReadonlyArray<StoredHook>;
    readonly chapterNumber: number;
    readonly targetChapters?: number;
  }): HookEmergenceDirective {
    const pressureStates = input.hooks
      .filter((hook) => !/^(resolved|closed|done|已回收|已解决)$/i.test(hook.status.trim()))
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
