import { z } from "zod";
import { HookPayoffTimingSchema } from "./runtime-state.js";

export const ChapterConflictSchema = z.object({
  type: z.string().min(1),
  resolution: z.string().min(1),
  detail: z.string().optional(),
});

export type ChapterConflict = z.infer<typeof ChapterConflictSchema>;

export const HookPressurePhaseSchema = z.enum(["opening", "middle", "late"]);
export type HookPressurePhase = z.infer<typeof HookPressurePhaseSchema>;

export const HookMovementSchema = z.enum([
  "quiet-hold",
  "refresh",
  "advance",
  "partial-payoff",
  "full-payoff",
]);
export type HookMovement = z.infer<typeof HookMovementSchema>;

export const HookPressureLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type HookPressureLevel = z.infer<typeof HookPressureLevelSchema>;

export const HookPressureReasonSchema = z.enum([
  "fresh-promise",
  "building-debt",
  "stale-promise",
  "ripe-payoff",
  "overdue-payoff",
  "long-arc-hold",
]);
export type HookPressureReason = z.infer<typeof HookPressureReasonSchema>;

export const HookPressureSchema = z.object({
  hookId: z.string().min(1),
  type: z.string().min(1),
  movement: HookMovementSchema,
  pressure: HookPressureLevelSchema,
  payoffTiming: HookPayoffTimingSchema.optional(),
  phase: HookPressurePhaseSchema,
  reason: HookPressureReasonSchema,
  blockSiblingHooks: z.boolean().default(false),
});

export type HookPressure = z.infer<typeof HookPressureSchema>;

export const HookAgendaSchema = z.object({
  pressureMap: z.array(HookPressureSchema).default([]),
  mustAdvance: z.array(z.string().min(1)).default([]),
  eligibleResolve: z.array(z.string().min(1)).default([]),
  staleDebt: z.array(z.string().min(1)).default([]),
  avoidNewHookFamilies: z.array(z.string().min(1)).default([]),
});

export type HookAgenda = z.infer<typeof HookAgendaSchema>;

export const EndingHookTypeSchema = z.enum([
  "danger",
  "reveal",
  "pursuit",
  "choice",
  "breakthrough",
]);

export type EndingHookType = z.infer<typeof EndingHookTypeSchema>;

export const PayoffTypeSchema = z.enum([
  "reveal",
  "resource",
  "breakthrough",
  "relationship",
  "reversal",
]);

export type PayoffType = z.infer<typeof PayoffTypeSchema>;

export const PayoffDepthSchema = z.enum([
  "shallow",
  "layered",
  "deep",
]);

export type PayoffDepth = z.infer<typeof PayoffDepthSchema>;

export const PayoffScopeSchema = z.enum([
  "chapter",
  "arc",
]);

export type PayoffScope = z.infer<typeof PayoffScopeSchema>;

export const PayoffDirectiveSchema = z.object({
  promisedPayoff: z.string().min(1),
  payoffType: PayoffTypeSchema,
  payoffDepth: PayoffDepthSchema.optional(),
  payoffScope: PayoffScopeSchema.optional(),
  mandatoryByFinalAct: z.boolean().default(true),
});

export type PayoffDirective = z.infer<typeof PayoffDirectiveSchema>;

export const ChapterGoalSchema = z.object({
  mainConflict: z.string().trim().min(1),
  protagonistGoal: z.string().trim().min(1),
  activeCharacters: z.array(z.string().min(1)).max(4).default([]),
  foreshadowToTouch: z.array(z.string().min(1)).max(2).default([]),
  payoffToDeliver: z.string().trim().min(1),
  payoffTrigger: z.string().trim().min(1).optional(),
  payoffDirective: PayoffDirectiveSchema.optional(),
  maxRevealLayersPerChapter: z.number().int().min(1).optional(),
  endingHookType: EndingHookTypeSchema,
  nextChapterPull: z.string().trim().min(1),
});

export type ChapterGoal = z.infer<typeof ChapterGoalSchema>;

export const MoodDirectiveTargetModeSchema = z.enum(["calm", "breath", "warmth", "humor"]);
export type MoodDirectiveTargetMode = z.infer<typeof MoodDirectiveTargetModeSchema>;

export const WritingModeSchema = z.enum(["crisis", "neutral", "breath"]);
export type WritingMode = z.infer<typeof WritingModeSchema>;

export const MoodScenePlanSchema = z.object({
  scene1: z.string().min(1),
  scene2: z.string().min(1),
  scene3: z.string().min(1),
});

export type MoodScenePlan = z.infer<typeof MoodScenePlanSchema>;

export const MoodDirectiveSchema = z.object({
  targetMode: MoodDirectiveTargetModeSchema,
  writingMode: WritingModeSchema.optional(),
  firstPassModeLock: z.boolean().optional(),
  forbidCrisisFallback: z.boolean().optional(),
  requiredSceneQuota: z.number().int().min(1).default(1),
  moodCoverageMin: z.number().min(0.1).max(0.8).default(0.3),
  forbidDominantMode: z.literal("combat-heavy").default("combat-heavy"),
  forceSceneStructure: z.boolean().optional(),
  sceneMinShare: z.number().min(0.1).max(0.5).optional(),
  sceneSemanticEnforced: z.boolean().optional(),
  scene1NoThreatEscalation: z.boolean().optional(),
  scene2InteractionFocus: z.boolean().optional(),
  scene3ForwardOnly: z.boolean().optional(),
  scenePlan: MoodScenePlanSchema.optional(),
  note: z.string().min(1).optional(),
});

export type MoodDirective = z.infer<typeof MoodDirectiveSchema>;

export const HookExecutionPhaseSchema = z.enum(["any", "late"]);
export type HookExecutionPhase = z.infer<typeof HookExecutionPhaseSchema>;

export const ChapterModeSchema = z.enum(["breath", "escalation", "combat", "reveal"]);
export type ChapterMode = z.infer<typeof ChapterModeSchema>;

export const EndingTypeSchema = z.enum([
  "reveal_end",
  "unresolved_end",
  "resolution_end",
  "twist_end",
  "calm_end",
]);
export type EndingType = z.infer<typeof EndingTypeSchema>;

export const DirectivePriorityItemSchema = z.enum([
  "mood-structure",
  "scene-plan",
  "hook-emergence",
  "payoff",
]);
export type DirectivePriorityItem = z.infer<typeof DirectivePriorityItemSchema>;

export const DirectivePrioritySchema = z.object({
  ordered: z.array(DirectivePriorityItemSchema).min(1),
});
export type DirectivePriority = z.infer<typeof DirectivePrioritySchema>;

export const ChapterIntentSchema = z.object({
  chapter: z.number().int().min(1),
  goal: z.string().trim().min(1),
  goalIntensity: z.enum(["low", "medium", "high"]).default("medium"),
  chapterMode: ChapterModeSchema.optional(),
  endingType: EndingTypeSchema.optional(),
  outlineNode: z.string().optional(),
  sceneDirective: z.string().min(1).optional(),
  arcDirective: z.string().min(1).optional(),
  moodDirective: MoodDirectiveSchema.optional(),
  directivePriority: DirectivePrioritySchema.optional(),
  hookExecutionPhase: HookExecutionPhaseSchema.optional(),
  titleDirective: z.string().min(1).optional(),
  mustKeep: z.array(z.string()).default([]),
  mustAvoid: z.array(z.string()).default([]),
  styleEmphasis: z.array(z.string()).default([]),
  conflicts: z.array(ChapterConflictSchema).default([]),
  chapterGoal: ChapterGoalSchema.optional(),
  hookAgenda: HookAgendaSchema.default({
    pressureMap: [],
    mustAdvance: [],
    eligibleResolve: [],
    staleDebt: [],
    avoidNewHookFamilies: [],
  }),
  /** Concrete verifiable items that MUST appear in the chapter body.
   *  Rendered as a checklist at the end of the intent. The post-write
   *  compliance checker validates each item against the draft. */
  mandatoryItems: z.array(z.object({
    description: z.string().trim().min(1),
    signal: z.string().trim().min(1),
  })).default([]),
});

export type ChapterIntent = z.infer<typeof ChapterIntentSchema>;

export const ContextSourceSchema = z.object({
  source: z.string().min(1),
  reason: z.string().min(1),
  excerpt: z.string().optional(),
});

export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const ContextPackageSchema = z.object({
  chapter: z.number().int().min(1),
  selectedContext: z.array(ContextSourceSchema).default([]),
  chapterGoal: ChapterGoalSchema.optional(),
});

export type ContextPackage = z.infer<typeof ContextPackageSchema>;

export const RuleLayerScopeSchema = z.enum(["global", "book", "arc", "local"]);
export type RuleLayerScope = z.infer<typeof RuleLayerScopeSchema>;

export const RuleLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  precedence: z.number().int(),
  scope: RuleLayerScopeSchema,
});

export type RuleLayer = z.infer<typeof RuleLayerSchema>;

export const OverrideEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  allowed: z.boolean(),
  scope: z.string().min(1),
});

export type OverrideEdge = z.infer<typeof OverrideEdgeSchema>;

export const ActiveOverrideSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().min(1),
});

export type ActiveOverride = z.infer<typeof ActiveOverrideSchema>;

export const RuleStackSectionsSchema = z.object({
  hard: z.array(z.string()).default([]),
  soft: z.array(z.string()).default([]),
  diagnostic: z.array(z.string()).default([]),
});

export type RuleStackSections = z.infer<typeof RuleStackSectionsSchema>;

export const RuleStackSchema = z.object({
  layers: z.array(RuleLayerSchema).min(1),
  sections: RuleStackSectionsSchema.default({
    hard: [],
    soft: [],
    diagnostic: [],
  }),
  overrideEdges: z.array(OverrideEdgeSchema).default([]),
  activeOverrides: z.array(ActiveOverrideSchema).default([]),
});

export type RuleStack = z.infer<typeof RuleStackSchema>;

export const ChapterTraceSchema = z.object({
  chapter: z.number().int().min(1),
  plannerInputs: z.array(z.string()),
  composerInputs: z.array(z.string()),
  selectedSources: z.array(z.string()),
  notes: z.array(z.string()).default([]),
});

export type ChapterTrace = z.infer<typeof ChapterTraceSchema>;
