import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const STRUCTURE_SIGNAL_DIMENSIONS = [
  "opening_hook",
  "protagonist_goal",
  "pressure_source",
  "obstacle_dilemma",
  "solution_possibility",
  "active_attempt",
  "payoff_reward",
  "ending_pull",
  "antagonist_pressure",
  "resource_reward",
  "world_rule",
  "forbidden_false_positive",
] as const;

export type StructureSignalDimension = (typeof STRUCTURE_SIGNAL_DIMENSIONS)[number];

export const StructureSignalsSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  signals: z.record(z.enum(STRUCTURE_SIGNAL_DIMENSIONS), z.array(z.string())),
});

export type StructureSignals = z.infer<typeof StructureSignalsSchema>;

export interface StructureSignalMatch {
  readonly dimension: StructureSignalDimension;
  readonly matched: string[];
  readonly missing: string[];
}

export interface StructureSignalReport {
  readonly source: "structure_signals.json" | "none" | "missing" | "corrupt";
  readonly error?: string;
  readonly matches: StructureSignalMatch[];
}

export type StructureSignalsReadResult =
  | { status: "ok"; signals: StructureSignals }
  | { status: "missing"; error: string }
  | { status: "corrupt"; error: string };

export function createEmptyStructureSignals(bookId: string): StructureSignals {
  const now = new Date().toISOString();
  const signals: Record<string, string[]> = {};
  for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
    signals[dim] = [];
  }
  return {
    schemaVersion: 1,
    bookId,
    createdAt: now,
    updatedAt: now,
    signals: signals as StructureSignals["signals"],
  };
}

export function validateStructureSignals(data: unknown): StructureSignals {
  return StructureSignalsSchema.parse(data);
}

export async function readStructureSignals(bookDir: string): Promise<StructureSignalsReadResult> {
  const filePath = join(bookDir, "story", "structure_signals.json");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: "missing", error: `${filePath} not found` };
    }
    return { status: "corrupt", error: `Cannot read ${filePath}: ${(err as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    return { status: "corrupt", error: `Invalid JSON in ${filePath}: ${(err as Error).message}` };
  }

  try {
    const signals = validateStructureSignals(parsed);
    return { status: "ok", signals };
  } catch (err: unknown) {
    return { status: "corrupt", error: `Schema validation failed for ${filePath}: ${(err as Error).message}` };
  }
}

export async function writeStructureSignals(
  bookDir: string,
  signals: StructureSignals,
): Promise<void> {
  const updated = { ...signals, updatedAt: new Date().toISOString() };
  const filePath = join(bookDir, "story", "structure_signals.json");
  await writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
}

export type ParseArchitectStructureSignalsResult =
  | { status: "ok"; signals: StructureSignals }
  | { status: "parse_error"; error: string; signals: StructureSignals };

export const MIN_PHRASES_PER_DIMENSION = 3;
export const MIN_TOTAL_PHRASES = 12;

function extractJsonObjectText(content: string): string {
  const trimmed = content.trim();

  const fenceMatch = trimmed.match(/```\s*(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]?.trim()) {
    return fenceMatch[1].trim();
  }

  const withoutOpeningFence = trimmed.replace(/^```\s*(?:json|JSON)?\s*\n?/i, "").trim();
  const withoutFences = withoutOpeningFence.replace(/\n?```\s*$/i, "").trim();
  if (withoutFences.startsWith("{") && withoutFences.endsWith("}")) {
    return withoutFences;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}

/**
 * Parse structure_signals section from architect LLM output into a StructureSignals object.
 * The LLM should return JSON, but may wrap it in a markdown code block or add short prose.
 * Returns a discriminated union: { status: "ok", signals } on success,
 * or { status: "parse_error", error, signals } on parse failure (with an empty signals fallback).
 */
export function parseArchitectStructureSignals(
  sectionContent: string,
  bookId: string,
): ParseArchitectStructureSignalsResult {
  const raw = extractJsonObjectText(sectionContent);

  // Empty section content: valid edge case (architect produced no structure_signals section).
  // Return an explicit parse_error so callers can distinguish "no output" from "good output".
  if (raw.length === 0) {
    return {
      status: "parse_error",
      error: "structure_signals section is empty — architect produced no output",
      signals: createEmptyStructureSignals(bookId),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    return {
      status: "parse_error",
      error: `Failed to parse structure_signals JSON: ${(err as Error).message}`,
      signals: createEmptyStructureSignals(bookId),
    };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("signals" in parsed) ||
    typeof (parsed as Record<string, unknown>).signals !== "object"
  ) {
    return {
      status: "parse_error",
      error: "structure_signals JSON missing 'signals' object",
      signals: createEmptyStructureSignals(bookId),
    };
  }

  const obj = parsed as Record<string, unknown>;
  const signals = obj.signals as Record<string, unknown>;

  const result = createEmptyStructureSignals(bookId);
  let extractedCount = 0;

  for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
    const val = signals[dim];
    if (Array.isArray(val)) {
      result.signals[dim] = val
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim());
      extractedCount += result.signals[dim].length;
    }
  }

  if (extractedCount === 0) {
    return {
      status: "parse_error",
      error: "structure_signals JSON contained no valid signal phrases across all 12 dimensions",
      signals: result,
    };
  }

  return { status: "ok", signals: result };
}

/**
 * Match content against structure signal phrases for a set of dimensions.
 * Returns the signal match results.
 */
export function matchStructureSignals(
  content: string,
  signals: StructureSignals,
  dimensions: readonly StructureSignalDimension[],
): StructureSignalMatch[] {
  return dimensions.map((dim) => {
    const phrases = signals.signals[dim] ?? [];
    const matched: string[] = [];
    const missing: string[] = [];

    for (const phrase of phrases) {
      if (content.includes(phrase)) {
        matched.push(phrase);
      } else {
        missing.push(phrase);
      }
    }

    return { dimension: dim, matched, missing };
  });
}

/**
 * Build a structure signal summary for use in publish-ready reports.
 * Accepts either a StructureSignalsReadResult (from readStructureSignals),
 * a StructureSignals object, or null/undefined.
 */
export function buildStructureSignalReport(
  content: string,
  signalsInput: StructureSignalsReadResult | StructureSignals | null | undefined,
  dimensions: readonly StructureSignalDimension[],
): StructureSignalReport {
  if (!signalsInput) {
    return { source: "none", matches: [] };
  }

  // Unwrap discriminated union
  if ("status" in signalsInput && signalsInput.status !== "ok") {
    return {
      source: signalsInput.status,
      error: signalsInput.error,
      matches: [],
    };
  }

  const signals: StructureSignals = "status" in signalsInput ? signalsInput.signals : signalsInput;

  return {
    source: "structure_signals.json",
    matches: matchStructureSignals(content, signals, dimensions),
  };
}

// ---- Maintenance utilities (inspect / validate / append) ----

export interface InspectDimensionInfo {
  readonly dimension: StructureSignalDimension;
  readonly phraseCount: number;
  readonly phrases: string[];
}

export interface InspectStructureSignalsResult {
  readonly bookId: string;
  readonly updatedAt: string;
  readonly dimensions: InspectDimensionInfo[];
  readonly emptyDimensions: StructureSignalDimension[];
  /** Duplicate phrases with which dimensions they appear in */
  readonly duplicates: { phrase: string; dimensions: StructureSignalDimension[] }[];
  /** Phrases that are suspiciously short (1 char) or overly generic */
  readonly suspiciousPhrases: { phrase: string; dimension: StructureSignalDimension; reason: string }[];
  readonly totalPhrases: number;
  readonly totalUnique: number;
}

export function inspectStructureSignals(signals: StructureSignals): InspectStructureSignalsResult {
  const dimensions: InspectDimensionInfo[] = [];
  const emptyDimensions: StructureSignalDimension[] = [];
  const phraseToDimensions = new Map<string, StructureSignalDimension[]>();
  const suspiciousPhrases: InspectStructureSignalsResult["suspiciousPhrases"] = [];

  for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
    const phrases = signals.signals[dim] ?? [];
    dimensions.push({ dimension: dim, phraseCount: phrases.length, phrases });

    if (phrases.length === 0) {
      emptyDimensions.push(dim);
    }

    for (const phrase of phrases) {
      // Track duplicates across dimensions
      const existing = phraseToDimensions.get(phrase);
      if (existing) {
        existing.push(dim);
      } else {
        phraseToDimensions.set(phrase, [dim]);
      }

      // Check for suspiciously short phrases
      if (phrase.length <= 1) {
        suspiciousPhrases.push({ phrase, dimension: dim, reason: "单字短语，匹配过于泛化" });
      }
    }
  }

  const duplicates: InspectStructureSignalsResult["duplicates"] = [];
  for (const [phrase, dims] of phraseToDimensions) {
    if (dims.length > 1) {
      duplicates.push({ phrase, dimensions: dims });
    }
  }

  let totalPhrases = 0;
  for (const d of dimensions) {
    totalPhrases += d.phraseCount;
  }

  return {
    bookId: signals.bookId,
    updatedAt: signals.updatedAt,
    dimensions,
    emptyDimensions,
    duplicates,
    suspiciousPhrases,
    totalPhrases,
    totalUnique: phraseToDimensions.size,
  };
}

export interface ValidateIssue {
  readonly severity: "ERROR" | "WARN";
  readonly message: string;
}

export interface ValidateStructureSignalsResult {
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly issues: ValidateIssue[];
}

export function validateStructureSignalsFull(signals: StructureSignals): ValidateStructureSignalsResult {
  const issues: ValidateIssue[] = [];
  let totalPhrases = 0;

  // Check all 12 dimensions present and non-empty
  for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
    if (!(dim in signals.signals)) {
      issues.push({ severity: "ERROR", message: `缺少维度: ${dim}` });
      continue;
    }
    const phrases = signals.signals[dim];
    if (!phrases || phrases.length === 0) {
      issues.push({ severity: "ERROR", message: `维度 ${dim} 为空（至少需要 ${MIN_PHRASES_PER_DIMENSION} 个短语）` });
    } else if (phrases.length < MIN_PHRASES_PER_DIMENSION) {
      issues.push({ severity: "WARN", message: `维度 ${dim} 仅有 ${phrases.length} 个短语（建议至少 ${MIN_PHRASES_PER_DIMENSION} 个）` });
    }
  }

  // Check total phrase count
  for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
    const phrases = signals.signals[dim];
    if (phrases) totalPhrases += phrases.length;
  }

  if (totalPhrases === 0) {
    issues.push({ severity: "ERROR", message: "所有维度均为空，总短语数为 0——structure_signals.json 未正确生成" });
  } else if (totalPhrases < MIN_TOTAL_PHRASES) {
    issues.push({ severity: "WARN", message: `总短语数仅 ${totalPhrases}（建议至少 ${MIN_TOTAL_PHRASES}）` });
  }

  // Check for duplicate phrases and empty strings per dimension
  for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
    const phrases = signals.signals[dim];
    if (!phrases || phrases.length === 0) continue;

    const seen = new Set<string>();
    for (const phrase of phrases) {
      if (phrase.trim().length === 0) {
        issues.push({ severity: "ERROR", message: `维度 ${dim} 包含空字符串短语` });
      } else if (seen.has(phrase)) {
        issues.push({ severity: "WARN", message: `维度 ${dim} 包含重复短语: "${phrase}"` });
      } else {
        seen.add(phrase);
      }

      // Overly short
      if (phrase.trim().length === 1) {
        issues.push({ severity: "WARN", message: `维度 ${dim} 短语过短（1字）: "${phrase}"` });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === "ERROR").length;
  const warnCount = issues.filter((i) => i.severity === "WARN").length;

  let status: "PASS" | "WARN" | "FAIL";
  if (errorCount > 0) {
    status = "FAIL";
  } else if (warnCount > 0) {
    status = "WARN";
  } else {
    status = "PASS";
  }

  return { status, issues };
}

export interface AppendStructureSignalResult {
  readonly updated: StructureSignals;
  readonly alreadyExists: boolean;
}

export function appendStructureSignal(
  signals: StructureSignals,
  dimension: string,
  phrase: string,
): AppendStructureSignalResult {
  const trimmed = phrase.trim();
  if (trimmed.length === 0) {
    throw new Error("phrase 不能为空");
  }

  if (!(STRUCTURE_SIGNAL_DIMENSIONS as readonly string[]).includes(dimension)) {
    throw new Error(`非法维度: ${dimension}。合法维度: ${STRUCTURE_SIGNAL_DIMENSIONS.join(", ")}`);
  }

  const dim = dimension as StructureSignalDimension;
  const currentPhrases = signals.signals[dim] ?? [];

  if (currentPhrases.includes(trimmed)) {
    return { updated: signals, alreadyExists: true };
  }

  const updated = {
    ...signals,
    updatedAt: new Date().toISOString(),
    signals: {
      ...signals.signals,
      [dim]: [...currentPhrases, trimmed],
    },
  };

  return { updated, alreadyExists: false };
}
