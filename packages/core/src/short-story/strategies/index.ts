import { betrayalRevengePlanStrategy } from "./betrayal-revenge/plan.js";
import { createBetrayalRevengeScene, resolveBetrayalRevengeCast } from "./betrayal-revenge/write.js";
import { thrillerPlanStrategy } from "./thriller/plan.js";
import { createThrillerScene, resolveThrillerCast } from "./thriller/write.js";
import type { ShortStoryChapterPlan, ShortStoryTheme } from "../schema.js";

export interface ShortStoryPlanStrategy {
  readonly id: string;
  readonly matches: (theme: ShortStoryTheme) => boolean;
  readonly describeChapter: (
    theme: ShortStoryTheme,
    chapterFunction: ShortStoryChapterPlan["function"],
    chapterNumber: number,
    chapterCount: number,
  ) => Pick<ShortStoryChapterPlan, "summary" | "conflict" | "endingHook">;
}

export interface ShortStoryCast {
  readonly hero: string;
  readonly villain: string;
  readonly rival: string;
  readonly child: string;
}

export interface ShortStorySceneDraft {
  readonly sceneType: string;
  readonly opening: string;
  readonly continuation: (previousHook: string) => string;
  readonly establishing: string;
  readonly evidence: string;
  readonly risk: string;
  readonly cost: string;
  readonly dialogueBeats: ReadonlyArray<string>;
  readonly actionBeats: ReadonlyArray<string>;
  readonly nextBridge: (nextSummary: string) => string;
  readonly finalBridge: string;
  readonly expansions: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ShortStoryWriteStrategy {
  readonly id: string;
  readonly matches: (theme: ShortStoryTheme) => boolean;
  readonly resolveCast: (theme: ShortStoryTheme) => ShortStoryCast;
  readonly createScene: (
    chapter: ShortStoryChapterPlan,
    cast: ShortStoryCast,
  ) => ShortStorySceneDraft;
}

export function resolveShortStoryPlanStrategy(theme: ShortStoryTheme): ShortStoryPlanStrategy {
  return planStrategies.find((strategy) => strategy.matches(theme)) ?? defaultPlanStrategy;
}

export function resolveShortStoryWriteStrategy(theme: ShortStoryTheme): ShortStoryWriteStrategy {
  return writeStrategies.find((strategy) => strategy.matches(theme)) ?? defaultWriteStrategy;
}

export const planStrategies: ReadonlyArray<ShortStoryPlanStrategy> = [
  betrayalRevengePlanStrategy,
  thrillerPlanStrategy,
];

export const writeStrategies: ReadonlyArray<ShortStoryWriteStrategy> = [
  {
    id: "betrayal-revenge",
    matches: betrayalRevengePlanStrategy.matches,
    resolveCast: resolveBetrayalRevengeCast,
    createScene: createBetrayalRevengeScene,
  },
  {
    id: "thriller",
    matches: thrillerPlanStrategy.matches,
    resolveCast: resolveThrillerCast,
    createScene: createThrillerScene,
  },
];

const defaultPlanStrategy = betrayalRevengePlanStrategy;
const defaultWriteStrategy = writeStrategies[0]!;
