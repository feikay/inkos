import { validateConsistencyGuard } from "./consistency-guard.js";
import { analyzePatternBreaker } from "./pattern-breaker.js";
import { validateStyleGuard } from "./style-guard.js";

export interface RegressionChapter {
  readonly id: string;
  readonly content: string;
}

export interface RegressionValidationScore {
  readonly style_score: number;
  readonly consistency_score: number;
  readonly pattern_score: number;
  readonly issues: readonly string[];
}

export function validateRegressionChapters(
  chapters: ReadonlyArray<RegressionChapter>,
  language: "zh" | "en" = "zh",
): RegressionValidationScore {
  const issues: string[] = [];
  let stylePenalty = 0;
  let consistencyPenalty = 0;

  chapters.forEach((chapter, index) => {
    const previousChapters = chapters
      .slice(Math.max(0, index - 3), index)
      .map((entry) => entry.content);
    const style = language === "zh"
      ? validateStyleGuard(chapter.content, { previousChapters })
      : { pass: true, issues: [] as string[], severity: "low" as const };

    for (const issue of style.issues) {
      const high = issue.startsWith("[high]") || style.severity === "high";
      stylePenalty += high ? 2 : 1;
      issues.push(`[style:${chapter.id}] ${issue}`);
    }

    const consistency = validateConsistencyGuard(chapter.content);
    for (const issue of consistency.issues) {
      consistencyPenalty += 2;
      issues.push(`[consistency:${chapter.id}] ${issue}`);
    }
  });

  const pattern = analyzePatternBreaker(chapters.map((chapter) => chapter.content), language);
  const patternPenalty = pattern.repeated ? 4 : 0;
  for (const issue of pattern.issues) {
    issues.push(`[pattern] ${issue}`);
  }

  return {
    style_score: clampScore(10 - stylePenalty),
    consistency_score: clampScore(10 - consistencyPenalty),
    pattern_score: clampScore(10 - patternPenalty),
    issues,
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(10, score));
}
