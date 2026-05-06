import { resolveShortStoryPlanStrategy } from "./strategies/index.js";
import type {
  ShortStoryBaseWorld,
  ShortStoryDerivedWorld,
  ShortStoryHookMode,
  ShortStoryTheme,
  ShortStoryVariant,
  ShortStoryWritingMode,
} from "./schema.js";
import { createShortStoryBaseWorld, createShortStoryForeignNames } from "./world-builder.js";

export interface ShortStoryVariantInput {
  readonly theme: ShortStoryTheme;
  readonly runIndex?: number;
  readonly timestamp?: string;
  readonly seed?: string;
  readonly writingMode?: ShortStoryWritingMode;
  readonly hookMode?: ShortStoryHookMode;
}

export function createShortStoryVariant(input: ShortStoryVariantInput): ShortStoryVariant {
  const strategy = resolveShortStoryPlanStrategy(input.theme);
  const runIndex = input.runIndex ?? 1;
  const seed = input.seed ?? `${input.theme}-${input.timestamp ?? "default"}-${runIndex}`;
  const writingMode = input.writingMode ?? pickWritingMode(input.theme, input.timestamp ?? input.seed ?? "default", runIndex);
  const hookMode = input.hookMode ?? pickHookMode(runIndex);
  const baseWorld = createShortStoryBaseWorld({
    theme: input.theme,
    runIndex,
    timestamp: input.timestamp,
    seed: input.seed,
  });
  const derived = strategy.id === "thriller"
    ? deriveThrillerWorld(baseWorld, runIndex)
    : deriveRevengeWorld(baseWorld, runIndex);

  return createVariant({
    theme: input.theme,
    runIndex,
    seed,
    writingMode,
    hookMode,
    baseWorld,
    derived,
  });
}

export function createVariant(input: {
  readonly theme: ShortStoryTheme;
  readonly runIndex: number;
  readonly seed: string;
  readonly writingMode?: ShortStoryWritingMode;
  readonly hookMode?: ShortStoryHookMode;
  readonly baseWorld: ShortStoryBaseWorld;
  readonly derived: ShortStoryDerivedWorld;
}): ShortStoryVariant {
  const variant = {
    theme: input.theme,
    runIndex: input.runIndex,
    seed: input.seed,
    writingMode: input.writingMode ?? pickWritingMode(input.theme, input.seed, input.runIndex),
    hookMode: input.hookMode ?? pickHookMode(input.runIndex),
    baseWorld: input.baseWorld,
    derived: input.derived,
  } as ShortStoryVariant;
  defineVariantAccessors(variant);
  return variant;
}

function defineVariantAccessors(variant: ShortStoryVariant): void {
  const accessors: Record<string, () => unknown> = {
    premise: () => variant.derived.premise,
    protagonist: () => variant.baseWorld.protagonist,
    role: () => variant.baseWorld.role,
    antagonist: () => variant.derived.antagonist,
    ally: () => variant.derived.ally,
    keyRelation: () => variant.derived.keyRelation,
    setting: () => variant.baseWorld.setting,
    coreMystery: () => variant.baseWorld.hiddenTruth ?? variant.baseWorld.secret ?? variant.derived.twistDirection,
    supportingCharacters: () => variant.baseWorld.supportingCharacters,
    forbiddenElements: () => variant.derived.forbiddenElements,
    coreConflict: () => variant.baseWorld.coreConflict,
    openingIncident: () => variant.derived.openingIncident,
    coreSecret: () => variant.derived.mainThreat,
    twist: () => variant.derived.twistDirection,
    ending: () => variant.derived.ending,
  };

  for (const [name, get] of Object.entries(accessors)) {
    Object.defineProperty(variant, name, {
      enumerable: false,
      get,
    });
  }
}

const writingModes: ReadonlyArray<ShortStoryWritingMode> = ["logic", "emotion", "conflict", "weird"];
const hookModes: ReadonlyArray<ShortStoryHookMode> = ["normal", "strong", "viral"];

function pickWritingMode(theme: ShortStoryTheme, seed: string, runIndex: number): ShortStoryWritingMode {
  const offset = Math.abs(hashVariantSeed(`${theme}:${seed}:writing-mode`)) % writingModes.length;
  return writingModes[(offset + runIndex - 1) % writingModes.length]!;
}

function pickHookMode(runIndex: number): ShortStoryHookMode {
  return hookModes[(runIndex - 1) % hookModes.length]!;
}

function hashVariantSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  return hash;
}

function deriveThrillerWorld(baseWorld: ShortStoryBaseWorld, runIndex: number): ShortStoryDerivedWorld {
  const [primary = "知情人", secondary = "协助者", relation = "旧线索"] = baseWorld.supportingCharacters;
  return {
    mainThreat: `${baseWorld.hiddenTruth ?? baseWorld.secret ?? baseWorld.coreConflict}正在被人重新掩盖`,
    twistDirection: `${secondary}并非偶然靠近${baseWorld.protagonist}，而是早就被${relation}牵进同一条线`,
    premise: `${baseWorld.role}追查${baseWorld.setting}里的异常记录`,
    antagonist: primary,
    ally: secondary,
    keyRelation: relation,
    openingIncident: `${baseWorld.protagonist}在${baseWorld.setting}撞见一处无法解释的异常，现场细节偏偏指向自己`,
    coreSecret: `${baseWorld.hiddenTruth ?? baseWorld.secret ?? baseWorld.coreConflict}才是所有异常的源头`,
    ending: `${baseWorld.protagonist}公开关键记录，切断${primary}继续操控真相的通道`,
    forbiddenElements: buildForbiddenElements(baseWorld, runIndex, thrillerForbiddenTerms),
  };
}

function deriveRevengeWorld(baseWorld: ShortStoryBaseWorld, runIndex: number): ShortStoryDerivedWorld {
  const [primary = "对手", secondary = "盟友", relation = "关键证人"] = baseWorld.supportingCharacters;
  return {
    mainThreat: `${primary}试图用${baseWorld.coreConflict}继续压制${baseWorld.protagonist}`,
    twistDirection: `${relation}手里的旧证据证明，${baseWorld.hiddenTruth ?? baseWorld.secret ?? baseWorld.coreConflict}`,
    premise: `${baseWorld.role}在${baseWorld.setting}反击身边人的算计`,
    antagonist: primary,
    ally: secondary,
    keyRelation: relation,
    openingIncident: `${baseWorld.protagonist}在${baseWorld.setting}当众拿出第一份证据，让${primary}措手不及`,
    coreSecret: `${baseWorld.hiddenTruth ?? baseWorld.secret ?? baseWorld.coreConflict}才是${primary}最怕曝光的真相`,
    ending: `${baseWorld.protagonist}夺回主动权，把旧账清算后离开被操控的关系`,
    forbiddenElements: buildForbiddenElements(baseWorld, runIndex, revengeForbiddenTerms),
  };
}

function buildForbiddenElements(
  baseWorld: ShortStoryBaseWorld,
  runIndex: number,
  strategyTerms: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const ownText = [
    baseWorld.protagonist,
    baseWorld.role,
    baseWorld.setting,
    baseWorld.coreConflict,
    baseWorld.hiddenTruth,
    baseWorld.secret,
    ...baseWorld.supportingCharacters,
  ].filter(Boolean).join("\n");
  const foreignNames = createShortStoryForeignNames(baseWorld, runIndex);
  const foreignTerms = strategyTerms.filter((term) => !ownText.includes(term));
  return [...new Set([...foreignNames, ...foreignTerms])].slice(0, 24);
}

const thrillerForbiddenTerms = [
  "十周年宴",
  "孕检单",
  "净身协议",
  "婚礼曝光",
  "股权清算",
  "离婚协议",
];

const revengeForbiddenTerms = [
  "医院",
  "停尸间",
  "太平间",
  "冷柜",
  "冷库",
  "尸体",
  "主任",
  "病历",
  "火化",
  "殡仪馆",
  "墙内",
];
