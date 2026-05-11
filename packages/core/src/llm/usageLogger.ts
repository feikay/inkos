import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface LlmTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface LlmUsageLoggingContext {
  readonly command?: string;
  readonly stage?: string;
  readonly provider: string;
  readonly model: string;
  readonly projectRoot?: string;
}

export interface LlmUsageLoggingHandle extends Required<Omit<LlmUsageLoggingContext, "projectRoot">> {
  readonly projectRoot?: string;
  readonly startTime: string;
  readonly startedAtMs: number;
}

export interface LlmUsageRecord {
  readonly time: string;
  readonly command: string;
  readonly stage: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number | "unknown";
  readonly outputTokens: number | "unknown";
  readonly totalTokens: number | "unknown";
  readonly durationMs: number;
  readonly status: "success" | "error";
  readonly errorMessage?: string;
}

export function logLlmStart(context: LlmUsageLoggingContext): LlmUsageLoggingHandle {
  const handle: LlmUsageLoggingHandle = {
    command: normalizeText(context.command) ?? inferCommand(),
    stage: normalizeText(context.stage) ?? "unknown",
    provider: normalizeText(context.provider) ?? "unknown",
    model: normalizeText(context.model) ?? "unknown",
    ...(context.projectRoot ? { projectRoot: context.projectRoot } : {}),
    startTime: new Date().toISOString(),
    startedAtMs: Date.now(),
  };
  console.info(`INFO [llm] start stage=${handle.stage} provider=${handle.provider} model=${handle.model}`);
  return handle;
}

export async function logLlmSuccess(
  handle: LlmUsageLoggingHandle,
  usage: LlmTokenUsage | undefined,
): Promise<void> {
  const durationMs = Date.now() - handle.startedAtMs;
  const record = buildRecord(handle, durationMs, "success", usage);
  console.info(
    `INFO [llm] done stage=${record.stage} provider=${record.provider} model=${record.model}`
      + ` input=${formatToken(record.inputTokens)} output=${formatToken(record.outputTokens)}`
      + ` total=${formatToken(record.totalTokens)} duration=${formatDuration(durationMs)}`,
  );
  await appendUsageRecord(handle.projectRoot, record);
}

export async function logLlmError(
  handle: LlmUsageLoggingHandle,
  error: unknown,
  usage?: LlmTokenUsage,
): Promise<void> {
  const durationMs = Date.now() - handle.startedAtMs;
  const message = error instanceof Error ? error.message : String(error);
  const record = buildRecord(handle, durationMs, "error", usage, message);
  console.error(
    `ERROR [llm] failed stage=${record.stage} provider=${record.provider} model=${record.model}`
      + ` duration=${formatDuration(durationMs)} error=${JSON.stringify(message)}`,
  );
  await appendUsageRecord(handle.projectRoot, record);
}

export async function withLlmUsageLogging<T>(
  context: LlmUsageLoggingContext,
  run: () => Promise<T>,
  extractUsage: (result: T) => LlmTokenUsage | undefined,
): Promise<T> {
  const handle = logLlmStart(context);
  try {
    const result = await run();
    await logLlmSuccess(handle, extractUsage(result));
    return result;
  } catch (error) {
    await logLlmError(handle, error);
    throw error;
  }
}

export function normalizeProviderUsage(raw: unknown): LlmTokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const inputTokens = firstNumber(usage.promptTokens, usage.prompt_tokens, usage.inputTokens, usage.input_tokens, usage.input);
  const outputTokens = firstNumber(
    usage.completionTokens,
    usage.completion_tokens,
    usage.outputTokens,
    usage.output_tokens,
    usage.output,
  );
  const totalTokens = firstNumber(usage.totalTokens, usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : inputTokens !== undefined && outputTokens !== undefined ? { totalTokens: inputTokens + outputTokens } : {}),
  };
}

function buildRecord(
  handle: LlmUsageLoggingHandle,
  durationMs: number,
  status: LlmUsageRecord["status"],
  usage: LlmTokenUsage | undefined,
  errorMessage?: string,
): LlmUsageRecord {
  return {
    time: new Date().toISOString(),
    command: handle.command,
    stage: handle.stage,
    provider: handle.provider,
    model: handle.model,
    inputTokens: usage?.inputTokens ?? "unknown",
    outputTokens: usage?.outputTokens ?? "unknown",
    totalTokens: usage?.totalTokens ?? "unknown",
    durationMs,
    status,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

async function appendUsageRecord(projectRoot: string | undefined, record: LlmUsageRecord): Promise<void> {
  const logPath = join(projectRoot ?? process.cwd(), "logs", "llm-usage.jsonl");
  try {
    await mkdir(join(projectRoot ?? process.cwd(), "logs"), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`WARN [llm] usage log write failed path=${logPath} error=${JSON.stringify(message)}`);
  }
}

function firstNumber(...values: ReadonlyArray<unknown>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function inferCommand(): string {
  return process.argv.slice(2).join(" ").trim() || "unknown";
}

function formatToken(value: number | "unknown"): string {
  return value === "unknown" ? "unknown" : String(value);
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}
