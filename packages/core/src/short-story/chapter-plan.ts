import type { ShortStoryChapterFunction, ShortStoryChapterPlan, ShortStoryConfig } from "./schema.js";
import { resolveShortStoryPlanStrategy } from "./strategies/index.js";

export const SHORT_STORY_MIN_WORDS = 8_000;
export const SHORT_STORY_MAX_WORDS = 80_000;
export const SHORT_STORY_DEFAULT_CHAPTER_WORDS = 1_500;
export const SHORT_STORY_MIN_CHAPTER_WORDS = 800;
export const SHORT_STORY_MAX_CHAPTER_WORDS = 2_200;
export const SHORT_STORY_RECOMMENDED_MIN_CHAPTER_WORDS = 1_200;
export const SHORT_STORY_RECOMMENDED_MAX_CHAPTER_WORDS = 1_800;

export function createShortStoryChapterPlan(
  config: ShortStoryConfig,
): ReadonlyArray<ShortStoryChapterPlan> {
  const targetWords = assertPositiveInteger(config.targetWords, "targetWords");
  const chapterTargetWords = config.chapterTargetWords === undefined
    ? SHORT_STORY_DEFAULT_CHAPTER_WORDS
    : assertPositiveInteger(config.chapterTargetWords, "chapterTargetWords");

  if (
    chapterTargetWords < SHORT_STORY_MIN_CHAPTER_WORDS ||
    chapterTargetWords > SHORT_STORY_MAX_CHAPTER_WORDS
  ) {
    throw new Error(
      `chapterTargetWords must be between ${SHORT_STORY_MIN_CHAPTER_WORDS} and ${SHORT_STORY_MAX_CHAPTER_WORDS}`,
    );
  }

  const chapterCount = calculateShortStoryChapterCount(targetWords, chapterTargetWords);
  const targets = distributeShortStoryChapterWords(targetWords, chapterCount);

  return targets.map((chapterWords, index) => {
    const chapterNumber = index + 1;
    const chapterFunction = resolveChapterFunction(chapterNumber, chapterCount);
    const role = resolveChapterRole(chapterNumber, chapterCount);
    const structure = resolveShortStoryPlanStrategy(config.theme)
      .describeChapter(config.theme, chapterFunction, chapterNumber, chapterCount, config.variant);
    return {
      chapterNumber,
      title: `第${chapterNumber}章`,
      targetWords: chapterWords,
      function: chapterFunction,
      summary: structure.summary,
      conflict: structure.conflict,
      endingHook: structure.endingHook,
      role,
      endingHookRequired: role !== "ending",
    };
  });
}

export function calculateShortStoryChapterCount(
  targetWords: number,
  chapterTargetWords = SHORT_STORY_DEFAULT_CHAPTER_WORDS,
): number {
  const minByHardMax = Math.ceil(targetWords / SHORT_STORY_MAX_CHAPTER_WORDS);
  const maxByHardMin = Math.floor(targetWords / SHORT_STORY_MIN_CHAPTER_WORDS);
  const desired = Math.max(1, Math.round(targetWords / chapterTargetWords));
  return clamp(desired, Math.max(5, minByHardMax), Math.max(5, maxByHardMin));
}

export function distributeShortStoryChapterWords(
  targetWords: number,
  chapterCount: number,
): ReadonlyArray<number> {
  if (chapterCount <= 0) {
    throw new Error("chapterCount must be positive");
  }
  if (chapterCount === 1) {
    return [targetWords];
  }

  const average = targetWords / chapterCount;
  const endingTarget = clamp(
    Math.round(average * 0.9),
    SHORT_STORY_MIN_CHAPTER_WORDS,
    SHORT_STORY_MAX_CHAPTER_WORDS,
  );
  const remainingWords = targetWords - endingTarget;
  const base = Math.floor(remainingWords / (chapterCount - 1));
  const remainder = remainingWords - base * (chapterCount - 1);

  const targets: number[] = [];
  for (let i = 0; i < chapterCount - 1; i += 1) {
    targets.push(base + (i < remainder ? 1 : 0));
  }
  targets.push(endingTarget);
  return targets;
}

function resolveChapterRole(
  chapterNumber: number,
  chapterCount: number,
): ShortStoryChapterPlan["role"] {
  if (chapterNumber === 1) return "opening";
  if (chapterNumber === chapterCount) return "ending";
  if (chapterNumber >= Math.max(2, chapterCount - 1)) return "climax";
  return "development";
}

function resolveChapterFunction(
  chapterNumber: number,
  chapterCount: number,
): ShortStoryChapterFunction {
  if (chapterNumber === 1) return "hook";
  if (chapterNumber === chapterCount) return "resolution";

  const progress = (chapterNumber - 1) / (chapterCount - 1);
  if (progress < 0.3) return "escalation";
  if (progress < 0.7) return "twist";
  return "climax";
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
