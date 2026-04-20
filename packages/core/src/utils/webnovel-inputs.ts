import yaml from "js-yaml";

interface GenreProfileDocument {
  readonly template?: string;
  readonly label?: string;
  readonly tone?: ReadonlyArray<string>;
  readonly style?: {
    readonly pov?: string;
    readonly sentence_rhythm?: string;
    readonly exposition_rule?: string;
  };
  readonly core_loop?: ReadonlyArray<string>;
  readonly forbidden_patterns?: ReadonlyArray<string>;
}

interface ArcVolumeDocument {
  readonly id?: string;
  readonly title?: string;
  readonly chapter_range?: string;
  readonly core_conflict?: string;
}

interface ArcMapDocument {
  readonly template?: string;
  readonly volumes?: ReadonlyArray<ArcVolumeDocument>;
}

interface PowerSystemDocument {
  readonly template?: string;
  readonly realm_tree?: ReadonlyArray<string>;
  readonly base_rules?: ReadonlyArray<string>;
  readonly exception_rules?: ReadonlyArray<string>;
}

export interface GenreProfileSummary {
  readonly styleEmphasis: ReadonlyArray<string>;
  readonly mustAvoid: ReadonlyArray<string>;
  readonly excerpt?: string;
}

export interface ArcMapSummary {
  readonly goalHint?: string;
  readonly arcDirective?: string;
  readonly excerpt?: string;
}

export interface PowerSystemSummary {
  readonly mustKeep: ReadonlyArray<string>;
  readonly mustAvoid: ReadonlyArray<string>;
  readonly excerpt?: string;
}

export function summarizeGenreProfile(
  raw: string,
  language: "zh" | "en",
): GenreProfileSummary {
  const parsed = safeYamlLoad<GenreProfileDocument>(raw);
  if (!parsed) {
    return { styleEmphasis: [], mustAvoid: [] };
  }

  const tone = takeStrings(parsed.tone, 2);
  const coreLoop = takeStrings(parsed.core_loop, 3);
  const forbidden = takeStrings(parsed.forbidden_patterns, 3);
  const style = parsed.style ?? {};
  const styleEmphasis = [
    parsed.label
      ? (language === "en" ? `Genre lane: ${parsed.label}` : `题材赛道：${parsed.label}`)
      : undefined,
    tone.length > 0
      ? (language === "en" ? `Tone: ${tone.join(" / ")}` : `语气：${tone.join(" / ")}`)
      : undefined,
    coreLoop.length > 0
      ? (language === "en" ? `Core loop: ${coreLoop.join(" -> ")}` : `核心循环：${coreLoop.join(" -> ")}`)
      : undefined,
    style.pov
      ? (language === "en" ? `POV discipline: ${style.pov}` : `视角约束：${style.pov}`)
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    styleEmphasis,
    mustAvoid: forbidden.map((item) =>
      language === "en" ? `Avoid: ${item}` : `避免：${item}`),
    excerpt: [
      parsed.label ?? parsed.template,
      tone.length > 0 ? tone.join("/") : undefined,
      coreLoop.length > 0 ? coreLoop.join(" -> ") : undefined,
      forbidden[0],
    ].filter(Boolean).join(" | "),
  };
}

export function summarizeArcMap(
  raw: string,
  chapterNumber: number,
  language: "zh" | "en",
): ArcMapSummary {
  const parsed = safeYamlLoad<ArcMapDocument>(raw);
  const currentVolume = parsed?.volumes?.find((volume) => {
    const range = parseChapterRange(volume.chapter_range);
    return range ? chapterNumber >= range.start && chapterNumber <= range.end : false;
  });
  if (!currentVolume) {
    return {};
  }

  const rangeText = currentVolume.chapter_range ?? "";
  return {
    goalHint: currentVolume.core_conflict,
    arcDirective: language === "en"
      ? `Current volume ${currentVolume.title ?? currentVolume.id ?? "(untitled)"} (${rangeText}) centers on: ${currentVolume.core_conflict ?? "(unspecified conflict)"}.`
      : `当前卷 ${currentVolume.title ?? currentVolume.id ?? "（未命名）"}（${rangeText}）核心冲突：${currentVolume.core_conflict ?? "（未写明）"}。`,
    excerpt: [
      currentVolume.title ?? currentVolume.id,
      rangeText,
      currentVolume.core_conflict,
    ].filter(Boolean).join(" | "),
  };
}

export function summarizePowerSystem(
  raw: string,
  language: "zh" | "en",
): PowerSystemSummary {
  const parsed = safeYamlLoad<PowerSystemDocument>(raw);
  if (!parsed) {
    return { mustKeep: [], mustAvoid: [] };
  }

  const realms = takeStrings(parsed.realm_tree, 5);
  const baseRules = takeStrings(parsed.base_rules, 2);
  const exceptionRules = takeStrings(parsed.exception_rules, 1);

  return {
    mustKeep: [
      realms.length > 0
        ? (language === "en" ? `Realm ladder: ${realms.join(" -> ")}` : `境界阶梯：${realms.join(" -> ")}`)
        : undefined,
      baseRules[0]
        ? (language === "en" ? `Power rule: ${baseRules[0]}` : `战力规则：${baseRules[0]}`)
        : undefined,
    ].filter((item): item is string => Boolean(item)),
    mustAvoid: [
      baseRules[1]
        ? (language === "en" ? `Do not break: ${baseRules[1]}` : `不要违背：${baseRules[1]}`)
        : undefined,
      exceptionRules[0]
        ? (language === "en" ? `Exception guardrail: ${exceptionRules[0]}` : `例外边界：${exceptionRules[0]}`)
        : undefined,
    ].filter((item): item is string => Boolean(item)),
    excerpt: [
      realms.length > 0 ? realms.join(" -> ") : undefined,
      baseRules[0],
      exceptionRules[0],
    ].filter(Boolean).join(" | "),
  };
}

function safeYamlLoad<T>(raw: string): T | null {
  try {
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === "object" ? parsed as T : null;
  } catch {
    return null;
  }
}

function takeStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function parseChapterRange(range: string | undefined): { start: number; end: number } | null {
  if (!range) return null;
  const match = range.match(/(\d+)\s*(?:-|–|—|~|～|至)\s*(\d+)/u);
  if (!match) return null;
  return {
    start: Number.parseInt(match[1] ?? "", 10),
    end: Number.parseInt(match[2] ?? "", 10),
  };
}
