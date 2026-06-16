import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BookConfig, NumericExpressionMode } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";

export interface NumericExpressionResolution {
  readonly mode: NumericExpressionMode;
  readonly source: "book" | "inferred" | "default";
}

type BookNumericExpressionInput = Partial<Pick<BookConfig,
  "id" | "title" | "genre" | "webnovelTemplate" | "writingRules"
>>;

const SYSTEM_HINT = /(?:system|litrpg|game|panel|系统|游戏|面板|属性面板|数值流|升级流)/iu;
const IMMERSIVE_HINT = /(?:xuanhuan|xianxia|cultivation|urban|romance|suspense|revenge|玄幻|仙侠|修炼|黑暗|都市|言情|悬疑|复仇|短故事)/iu;

export function resolveNumericExpressionMode(
  book: BookNumericExpressionInput,
  genreProfile?: Pick<GenreProfile, "id" | "name" | "numericalSystem"> | null,
): NumericExpressionResolution {
  const explicit = book.writingRules?.numericExpressionMode;
  if (explicit) {
    return { mode: explicit, source: "book" };
  }

  const corpus = [
    book.id,
    book.title,
    book.genre,
    book.webnovelTemplate,
    genreProfile?.id,
    genreProfile?.name,
  ].filter(Boolean).join(" ");

  if (SYSTEM_HINT.test(corpus) || genreProfile?.numericalSystem) {
    return { mode: "system", source: "inferred" };
  }
  if (IMMERSIVE_HINT.test(corpus)) {
    return { mode: "immersive", source: "inferred" };
  }

  return { mode: "immersive", source: "default" };
}

export async function readBookNumericExpressionMode(
  bookDir: string,
  genreProfile?: Pick<GenreProfile, "id" | "name" | "numericalSystem"> | null,
): Promise<NumericExpressionResolution> {
  try {
    const raw = await readFile(join(bookDir, "book.json"), "utf-8");
    const book = JSON.parse(raw) as BookNumericExpressionInput;
    return resolveNumericExpressionMode(book, genreProfile);
  } catch {
    return { mode: "immersive", source: "default" };
  }
}

export function buildNumericExpressionGuidanceForBook(
  book: BookNumericExpressionInput,
  genreProfile: GenreProfile | null | undefined,
  language: "zh" | "en",
  audience: "writer" | "reviser" | "polish" = "writer",
): string {
  return buildNumericExpressionGuidance(
    resolveNumericExpressionMode(book, genreProfile),
    language,
    audience,
    genreProfile,
  );
}

export function buildNumericExpressionGuidance(
  resolution: NumericExpressionResolution,
  language: "zh" | "en",
  audience: "writer" | "reviser" | "polish" = "writer",
  genreProfile?: GenreProfile | null,
): string {
  if (language === "en") {
    return buildEnglishGuidance(resolution, audience, genreProfile);
  }
  return buildChineseGuidance(resolution, audience, genreProfile);
}

function buildChineseGuidance(
  resolution: NumericExpressionResolution,
  audience: "writer" | "reviser" | "polish",
  genreProfile?: GenreProfile | null,
): string {
  const prefix = audience === "writer"
    ? "写作"
    : audience === "reviser"
      ? "修稿"
      : "润色";

  const allowedExamples = genreProfile?.styleGovernance?.allowedStyleExamples ?? [
    "三息", "一炷香", "七副玉棺", "千年", "半尺", "聚气九层", "化灵门槛", "第七容器"
  ];
  const forbiddenKeywords = genreProfile?.styleGovernance?.forbiddenProseKeywords ?? [
    "气血xx%", "气血值xx%", "+7%", "气血条", "0.x滴精血", "收益", "基础值", "性价比", "打八折"
  ];
  const allowedExamplesStr = allowedExamples.join("、");
  const forbiddenKeywordsStr = forbiddenKeywords.join("、");

  if (resolution.mode === "system") {
    return `## 数值化表达治理（numericExpressionMode=system，source=${resolution.source}）

- 本书按系统流/游戏流/面板流处理，正文允许出现面板、百分比、经验、属性、技能、收益等数值表达。
- 不应用 immersive 模式的面板化禁令；但数值仍必须前后一致，不能与状态、账本或战力规则冲突。`;
  }

  if (resolution.mode === "light_numeric") {
    return `## 数值化表达治理（numericExpressionMode=light_numeric，source=${resolution.source}）

- 正文允许少量自然数值表达，但禁止密集状态面板式结算。
- 可以保留自然数字：${allowedExamplesStr}。
- 避免把人物状态写成资源条、百分比、倍率、收益账本；需要表达变化时，转为动作、痛感、气息、经脉、代价和环境反馈。`;
  }

  return `## 数值化表达治理（numericExpressionMode=immersive，source=${resolution.source}）

- 本书不是系统流/游戏面板流。${prefix}正文时，内部 state/facts/ledger/review report 可以保留精确数字，但正文必须转为沉浸式${genreProfile?.name ?? "题材"}感官表达。
- 禁止阿拉伯数字状态面板和账本口吻：${forbiddenKeywordsStr}、以及状态条式资源结算。
- 允许中文${genreProfile?.name ?? "题材"}语感表达：几成、几分、大半、小半、半数、一线、半滴、${allowedExamplesStr}等可以保留。
- 中文成数不要一刀切禁用；只有和收益、基础值、数值提升、战力打折等账本/结算词绑在一起时，才需要改成更沉浸的代价表达。
- 示例：“气血涨到76%” → “枯竭的气血重新漫过四肢”。
- 示例：“0.3滴精血” → “一线本命精血”。
- 示例：“性价比极低” → “付出的代价远比能换回的气血更多”。`;
}

function buildEnglishGuidance(
  resolution: NumericExpressionResolution,
  audience: "writer" | "reviser" | "polish",
  genreProfile?: GenreProfile | null,
): string {
  const action = audience === "writer" ? "drafting" : audience === "reviser" ? "revising" : "polishing";
  if (resolution.mode === "system") {
    return `## Numeric Expression Governance (numericExpressionMode=system, source=${resolution.source})

- This book is treated as system/game/panel fiction. Prose may use panels, percentages, experience, attributes, skills, rewards, and other numeric resource expressions.
- Do not apply immersive-mode numeric bans; keep all numbers consistent with state and ledger facts.`;
  }
  if (resolution.mode === "light_numeric") {
    return `## Numeric Expression Governance (numericExpressionMode=light_numeric, source=${resolution.source})

- Natural numeric details are allowed, but avoid dense status-panel settlement in prose.
- Express state changes through action, sensation, cost, breath, wounds, and scene feedback rather than resource bars.`;
  }
  return `## Numeric Expression Governance (numericExpressionMode=immersive, source=${resolution.source})

- This book is not system/game/panel fiction. While ${action}, keep exact numbers in internal state or reports only; prose must use immersive sensory expression.
- Forbidden in chapter prose: Arabic-number status panels, blood/health percentages, health bars, fractional decimal drops of essence blood, reward/efficiency/base-value language, discount multipliers, and status-bar settlement.
- Do not ban natural or idiomatic fractions globally; Chinese-style proportions such as several-tenths, a few degrees, most of it, a thread, or half a drop may remain when they read as immersive ${genreProfile?.name ?? "martial/xuanhuan"} prose.
- Rewrite panel-like expressions as bodily sensation, cost, breath, meridians, pain, recovery, or visible consequence.`;
}
