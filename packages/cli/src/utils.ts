import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createLLMClient, StateManager, createLogger, createStderrSink, createJsonLineSink, loadProjectConfig, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH, type ChapterGoal, type ProjectConfig, type PipelineConfig, type LogSink } from "@actalk/inkos-core";
import { formatSqliteMemorySupportWarning } from "./runtime-requirements.js";

export { GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH };

let sqliteMemorySupportWarned = false;

export async function resolveContext(opts: {
  readonly context?: string;
  readonly contextFile?: string;
}): Promise<string | undefined> {
  if (opts.context) return opts.context;
  if (opts.contextFile) {
    return readFile(resolve(opts.contextFile), "utf-8");
  }
  // Read from stdin if piped (non-TTY)
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

export function findProjectRoot(): string {
  return process.cwd();
}

export async function loadConfig(options?: { readonly requireApiKey?: boolean; readonly projectRoot?: string }): Promise<ProjectConfig> {
  return loadProjectConfig(options?.projectRoot ?? findProjectRoot(), options);
}

export function createClient(config: ProjectConfig) {
  return createLLMClient(config.llm);
}

export function buildPipelineConfig(
  config: ProjectConfig,
  root: string,
  extra?: Partial<Pick<PipelineConfig, "notifyChannels" | "radarSources" | "externalContext" | "inputGovernanceMode">> & {
    readonly quiet?: boolean;
    readonly logFile?: NodeJS.WritableStream;
  },
): PipelineConfig {
  if (!extra?.quiet && !sqliteMemorySupportWarned) {
    const warning = formatSqliteMemorySupportWarning();
    if (warning) {
      sqliteMemorySupportWarned = true;
      process.stderr.write(`[WARN] ${warning}\n`);
    }
  }

  const sinks: LogSink[] = [];
  if (!extra?.quiet) {
    sinks.push(createStderrSink({ minLevel: "info" }));
  }
  if (extra?.logFile) {
    sinks.push(createJsonLineSink(extra.logFile));
  }

  const hasLogging = sinks.length > 0;
  const logger = hasLogging ? createLogger({ tag: "inkos", sinks }) : undefined;

  const onStreamProgress = hasLogging
    ? (progress: { readonly elapsedMs: number; readonly totalChars: number; readonly chineseChars: number; readonly status: string }) => {
        if (progress.status === "streaming") {
          logger?.info(
            `streaming ${Math.round(progress.elapsedMs / 1000)}s, ${progress.totalChars} chars (${progress.chineseChars} CJK)`,
          );
        }
      }
    : undefined;

  return {
    client: createLLMClient(config.llm),
    model: config.llm.model,
    projectRoot: root,
    defaultLLMConfig: config.llm,
    modelOverrides: config.modelOverrides,
    inputGovernanceMode: extra?.inputGovernanceMode ?? config.inputGovernanceMode,
    notifyChannels: extra?.notifyChannels ?? config.notify,
    radarSources: extra?.radarSources,
    externalContext: extra?.externalContext,
    logger,
    onStreamProgress,
  };
}

export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function logError(message: string): void {
  process.stderr.write(`[ERROR] ${message}\n`);
}

/**
 * Resolve book-id: if provided use it, otherwise auto-detect when exactly one book exists.
 * Validates that the book actually exists.
 */
export async function resolveBookId(
  bookIdArg: string | undefined,
  root: string,
): Promise<string> {
  const state = new StateManager(root);
  const books = await state.listBooks();

  if (bookIdArg) {
    if (!books.includes(bookIdArg)) {
      const available = books.length > 0 ? books.join(", ") : "(none)";
      throw new Error(
        `Book "${bookIdArg}" not found. Available books: ${available}`,
      );
    }
    return bookIdArg;
  }

  if (books.length === 0) {
    throw new Error(
      "No books found. Create one first:\n  inkos book create --title '...' --genre xuanhuan",
    );
  }
  if (books.length === 1) {
    return books[0]!;
  }
  throw new Error(
    `Multiple books found: ${books.join(", ")}\nPlease specify a book-id.`,
  );
}

export async function getLegacyMigrationHint(
  root: string,
  bookId: string,
): Promise<string | null> {
  const state = new StateManager(root);
  const bookDir = state.bookDir(bookId);
  const bookConfig = await readBookMetadata(bookDir);
  if (bookConfig?.schemaVersion === 2) {
    return null;
  }
  const stateDir = join(state.bookDir(bookId), "story", "state");
  try {
    const info = await stat(stateDir);
    if (info.isDirectory()) {
      return null;
    }
  } catch {
    return `Book "${bookId}" uses legacy format (pre-v0.6). The next write will auto-migrate its state files.`;
  }
  return `Book "${bookId}" uses legacy format (pre-v0.6). The next write will auto-migrate its state files.`;
}

export async function usesLegacyBookFormat(
  bookDir: string,
): Promise<boolean> {
  const bookConfig = await readBookMetadata(bookDir);
  if (bookConfig?.schemaVersion === 2) {
    return false;
  }

  try {
    const info = await stat(join(bookDir, "story", "state"));
    return !info.isDirectory();
  } catch {
    return true;
  }
}

async function readBookMetadata(
  bookDir: string,
): Promise<{ readonly schemaVersion?: number } | null> {
  try {
    const raw = await readFile(join(bookDir, "book.json"), "utf-8");
    return JSON.parse(raw) as { readonly schemaVersion?: number };
  } catch {
    return null;
  }
}

export interface ReviewPresentation {
  readonly chapterGoal?: ChapterGoal;
  readonly continuityNotes: ReadonlyArray<string>;
  readonly disciplineChecks: ReadonlyArray<string>;
  readonly traditionalWarnings: ReadonlyArray<string>;
}

export async function loadReviewPresentation(
  bookDir: string,
  chapterNumber: number,
  auditIssues: ReadonlyArray<string>,
): Promise<ReviewPresentation> {
  const sections = await readRuntimeIntentSections(bookDir, chapterNumber);
  const chapterGoal = sections ? readReviewChapterGoal(sections) : undefined;
  const continuityNotes = sections
    ? readIntentList(sections, "Conflicts")
        .filter((entry) => isContinuityOrPlanningNote(entry))
    : [];

  const disciplineChecks: string[] = [];
  const traditionalWarnings: string[] = [];
  for (const issue of auditIssues) {
    const normalized = normalizeReviewIssue(issue);
    if (isDisciplineIssue(normalized)) {
      disciplineChecks.push(normalized);
      continue;
    }
    if (isContinuityOrPlanningNote(normalized)) {
      continuityNotes.push(normalized);
      continue;
    }
    traditionalWarnings.push(normalized);
  }

  return {
    chapterGoal,
    continuityNotes: uniqueStrings(continuityNotes),
    disciplineChecks: uniqueStrings(disciplineChecks),
    traditionalWarnings: uniqueStrings(traditionalWarnings),
  };
}

async function readRuntimeIntentSections(
  bookDir: string,
  chapterNumber: number,
): Promise<Map<string, string[]> | null> {
  const runtimePath = join(
    bookDir,
    "story",
    "runtime",
    `chapter-${String(chapterNumber).padStart(4, "0")}.intent.md`,
  );

  try {
    const markdown = await readFile(runtimePath, "utf-8");
    return parseIntentSections(markdown);
  } catch {
    return null;
  }
}

function parseIntentSections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      current = line.slice(3).trim();
      sections.set(current, []);
      continue;
    }

    if (!current) continue;
    sections.get(current)?.push(line);
  }

  return sections;
}

function readIntentList(sections: Map<string, string[]>, name: string): string[] {
  return (sections.get(name) ?? [])
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") && line !== "- none")
    .map((line) => line.replace(/^-\s*/, ""));
}

function readReviewChapterGoal(sections: Map<string, string[]>): ChapterGoal | undefined {
  const entries = new Map<string, string>();

  for (const line of readIntentList(sections, "Chapter Goal")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || !value || value === "none") continue;
    entries.set(key, value);
  }

  const mainConflict = entries.get("mainConflict");
  const protagonistGoal = entries.get("protagonistGoal");
  const payoffToDeliver = entries.get("payoffToDeliver");
  const endingHookType = entries.get("endingHookType");
  const nextChapterPull = entries.get("nextChapterPull");
  if (!mainConflict || !protagonistGoal || !payoffToDeliver || !endingHookType || !nextChapterPull) {
    return undefined;
  }

  return {
    mainConflict,
    protagonistGoal,
    activeCharacters: splitInlineList(entries.get("activeCharacters")),
    foreshadowToTouch: splitInlineList(entries.get("foreshadowToTouch")).slice(0, 2),
    payoffToDeliver,
    endingHookType: endingHookType as ChapterGoal["endingHookType"],
    nextChapterPull,
  };
}

function splitInlineList(value: string | undefined): string[] {
  if (!value || value === "none") {
    return [];
  }

  return value
    .split(/,|，|、/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeReviewIssue(issue: string): string {
  return issue.replace(/^\[(?:warning|critical|info)\]\s*/i, "").trim();
}

function isDisciplineIssue(issue: string): boolean {
  const normalized = issue.toLowerCase();
  return (
    normalized.includes("ending-hook-check")
    || normalized.includes("payoff-check")
    || normalized.includes("resource-ledger-")
    || normalized.includes("hook-debt-")
    || normalized.includes("ending does not clearly cash out")
    || normalized.includes("expected immediate payoff")
    || normalized.includes("resource/state drift")
    || normalized.includes("active hooks exceed")
    || issue.includes("章尾没有明显兑现")
    || issue.includes("本章没有明显兑现预期即时回报")
    || issue.includes("资源/状态可能漏记")
    || issue.includes("当前活跃伏笔")
  );
}

function isContinuityOrPlanningNote(issue: string): boolean {
  const normalized = issue.toLowerCase();
  return (
    normalized.includes("outline_vs_recent_state")
    || normalized.includes("stale")
    || normalized.includes("continuity")
    || normalized.includes("timeline")
    || normalized.includes("anchor")
    || normalized.includes("outline")
    || normalized.includes("planner")
    || normalized.includes("hook_debt_throttle")
    || issue.includes("连续性")
    || issue.includes("时间线")
    || issue.includes("大纲")
    || issue.includes("锚定")
  );
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
