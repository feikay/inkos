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

/**
 * Parse structure_signals section from architect LLM output into a StructureSignals object.
 * The LLM returns JSON wrapped in a markdown code block.
 */
export function parseArchitectStructureSignals(
  sectionContent: string,
  bookId: string,
): StructureSignals {
  const jsonMatch = sectionContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const raw = jsonMatch ? jsonMatch[1]!.trim() : sectionContent.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // If LLM didn't return valid JSON, create empty signals
    return createEmptyStructureSignals(bookId);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("signals" in parsed) ||
    typeof (parsed as Record<string, unknown>).signals !== "object"
  ) {
    return createEmptyStructureSignals(bookId);
  }

  const obj = parsed as Record<string, unknown>;
  const signals = obj.signals as Record<string, unknown>;

  const result = createEmptyStructureSignals(bookId);

  for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
    const val = signals[dim];
    if (Array.isArray(val)) {
      result.signals[dim] = val
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim());
    }
  }

  return result;
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
