import { Command } from "commander";
import {
  StateManager,
  chapterNumberPrefix,
  createLLMClient,
  formatLengthCount,
  isApiKeyOptionalForEndpoint,
  LLMConfigSchema,
  readGenreProfile,
  renderContinuityMarkdown,
  resolveLengthCountingMode,
  runLocalChapterContinuityCheck,
  runChapterContinuityCheck,
  runChapterContinuityFix,
  type ContinuityReport,
} from "@actalk/inkos-core";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createClient, findProjectRoot, loadConfig, resolveBookId, log, logError, loadReviewPresentation, GLOBAL_ENV_PATH } from "../utils.js";

export const reviewCommand = new Command("review")
  .description("Review and approve chapters");

reviewCommand
  .command("continuity")
  .description("Check chapter-to-chapter narrative continuity")
  .option("--book <book-id>", "Book ID")
  .option("--chapter <number>", "Single chapter number")
  .option("--from <number>", "First chapter number in range")
  .option("--to <number>", "Last chapter number in range")
  .option("--max-fix-attempts <number>", "Maximum continuity fix attempts recorded in reports", "2")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(false);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxFixAttempts = parsePositiveInt(opts.maxFixAttempts, "--max-fix-attempts");
      const results: ContinuityCommandResult[] = [];

      for (let chapter = range.from; chapter <= range.to; chapter += 1) {
        results.push(await checkContinuityChapter({
          root,
          bookId: book.id,
          bookDir: book.dir,
          chapter,
          client: runtime?.client,
          model: runtime?.model,
          final: false,
          fixAttempt: 0,
          maxFixAttempts,
        }));
      }

      if (opts.json) {
        log(JSON.stringify({ bookId: book.id, results }, null, 2));
      } else {
        for (const result of results) {
          log(`Ch.${result.chapter}: ${result.report.status} score=${result.report.score} (${result.report.level})`);
          log(`  report: ${result.reportJsonPath}`);
        }
      }
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Continuity check failed: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("continuity-fix")
  .description("Fix one chapter using its continuity rewrite_prompt; writes to chapters-fixed")
  .requiredOption("--book <book-id>", "Book ID")
  .requiredOption("--chapter <number>", "Chapter number")
  .option("--max-fix-attempts <number>", "Maximum continuity fix attempts", "2")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const book = await resolveContinuityBook(root, opts.book);
      const chapter = parsePositiveInt(opts.chapter, "--chapter");
      const maxFixAttempts = parsePositiveInt(opts.maxFixAttempts, "--max-fix-attempts");
      const state = await readContinuityFixState(book.dir, chapter, maxFixAttempts);
      const skip = getContinuityFixSkipReason(state.report, maxFixAttempts)
        || (state.nextAttempt > maxFixAttempts
          ? "Chapter failed to reach PASS after max attempts. Manual review required."
          : null);
      if (skip) {
        const skipped = { bookId: book.id, chapter, fixedChapterPath: "", skippedReason: skip };
        if (opts.json) log(JSON.stringify(skipped, null, 2));
        else {
          log(`Ch.${chapter} fix skipped.`);
          log(`  reason: ${skip}`);
        }
        return;
      }

      const runtime = await loadContinuityRuntime(true);
      const fixed = await fixContinuityChapter({
        root,
        bookId: book.id,
        bookDir: book.dir,
        chapter,
        client: runtime!.client!,
        model: runtime!.model!,
        reportJsonPath: state.reportJsonPath,
        attempt: state.nextAttempt,
        maxFixAttempts,
      });

      if (opts.json) log(JSON.stringify({ bookId: book.id, ...fixed }, null, 2));
      else if (fixed.skippedReason) {
        log(`Ch.${chapter} fix skipped.`);
        log(`  reason: ${fixed.skippedReason}`);
      }
      else {
        log(`Ch.${chapter} fixed draft written.`);
        log(`  output: ${fixed.fixedChapterPath}`);
      }
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Continuity fix failed: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("continuity-auto")
  .description("Check, auto-fix chapters below 85, then run a final continuity check")
  .requiredOption("--book <book-id>", "Book ID")
  .option("--chapter <number>", "Single chapter number")
  .option("--from <number>", "First chapter number in range")
  .option("--to <number>", "Last chapter number in range")
  .option("--max-fix-attempts <number>", "Maximum continuity fix attempts", "2")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(false);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxFixAttempts = parsePositiveInt(opts.maxFixAttempts, "--max-fix-attempts");
      const results: ContinuityAutoResult[] = [];

      for (let chapter = range.from; chapter <= range.to; chapter += 1) {
        if (!opts.json) {
          log("[continuity-auto]");
          log(`chapter: ${chapterNumberPrefix(chapter)}`);
        }

        let attempt = 0;
        let score = 0;
        let current: ContinuityCommandResult | undefined;
        let initial: ContinuityCommandResult | undefined;
        let fixed: ContinuityFixResult | undefined;
        let currentChapterOverride: string | undefined;

        do {
          current = await checkContinuityChapter({
            root,
            bookId: book.id,
            bookDir: book.dir,
            chapter,
            client: runtime?.client,
            model: runtime?.model,
            final: attempt > 0,
            currentOverridePath: currentChapterOverride,
            fixAttempt: attempt,
            maxFixAttempts,
          });
          initial ??= current;
          score = current.report.score;

          if (score >= 85) {
            if (!opts.json && attempt > 0) {
              log(`attempt ${attempt}/${maxFixAttempts} -> score: ${score}`);
            }
            break;
          }

          if (attempt >= maxFixAttempts) break;
          if (current.report.rewrite_mode === "none") break;
          if (!runtime?.client || !runtime.model) {
            throw new Error("continuity-auto needs inkos.json / LLM config to fix chapters below 85.");
          }

          const nextAttempt = attempt + 1;
          if (!opts.json) {
            log(`attempt ${nextAttempt}/${maxFixAttempts} -> score: ${score} -> fixing...`);
          }
          fixed = await fixContinuityChapter({
            root,
            bookId: book.id,
            bookDir: book.dir,
            chapter,
            client: runtime.client,
            model: runtime.model,
            reportJsonPath: current.reportJsonPath,
            attempt: nextAttempt,
            maxFixAttempts,
          });
          currentChapterOverride = fixed.fixedChapterPath;
          attempt = nextAttempt;
        } while (true);

        if (!current || !initial) {
          throw new Error(`Continuity auto failed to produce a report for chapter ${chapter}`);
        }

        const finalStatus = score >= 85 ? "PASS" : "MANUAL_REVIEW";
        let finalReport = current.report;
        if (finalStatus === "MANUAL_REVIEW") {
          finalReport = markManualReview(finalReport);
          const reportDir = join(book.dir, "reviews", "continuity");
          const prefix = chapterNumberPrefix(chapter);
          await writeContinuityReportFiles(
            finalReport,
            join(reportDir, `${prefix}.final-report.json`),
            join(reportDir, `${prefix}.final-report.md`),
            chapter,
            current.chapterTitle,
          );
          if (!opts.json) {
            log("warning: Chapter failed to reach PASS after max attempts. Manual review required.");
          }
        }

        if (!opts.json) {
          log(`result: ${finalReport.final_status}`);
        }

        results.push({
          chapter,
          initial,
          fixed,
          final: { ...current, report: finalReport },
          finalStatus,
        });
      }

      if (opts.json) log(JSON.stringify({ bookId: book.id, results }, null, 2));
      else {
        for (const result of results) {
          log(`Ch.${result.chapter}: final=${result.finalStatus}`);
          if (result.fixed) log(`  fixed: ${result.fixed.fixedChapterPath}`);
        }
      }
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Continuity auto failed: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("continuity-final")
  .description("Run final continuity check against chapters-fixed output")
  .requiredOption("--book <book-id>", "Book ID")
  .requiredOption("--chapter <number>", "Chapter number")
  .option("--max-fix-attempts <number>", "Maximum continuity fix attempts recorded in final report", "2")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(false);
      const book = await resolveContinuityBook(root, opts.book);
      const chapter = parsePositiveInt(opts.chapter, "--chapter");
      const maxFixAttempts = parsePositiveInt(opts.maxFixAttempts, "--max-fix-attempts");
      const fixedChapterPath = await findFixedChapterFile(book.dir, chapter);
      const attempt = getAttemptFromFilename(fixedChapterPath) ?? maxFixAttempts;
      const final = await checkContinuityChapter({
        root,
        bookId: book.id,
        bookDir: book.dir,
        chapter,
        client: runtime?.client,
        model: runtime?.model,
        final: true,
        currentOverridePath: fixedChapterPath,
        fixAttempt: attempt,
        maxFixAttempts,
      });
      let report = final.report;
      if (report.score < 85) {
        report = markManualReview(report);
        await writeContinuityReportFiles(report, final.reportJsonPath, final.reportMarkdownPath, chapter, final.chapterTitle);
      }

      const result = { bookId: book.id, fixedChapterPath, final: { ...final, report }, finalStatus: report.final_status };
      if (opts.json) log(JSON.stringify(result, null, 2));
      else {
        log(`Ch.${chapter}: final=${report.status} score=${report.score}`);
        log(`  report: ${final.reportJsonPath}`);
      }
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Continuity final check failed: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("list")
  .description("List chapters pending review")
  .argument("[book-id]", "Book ID (optional, lists all books if omitted)")
  .option("--json", "Output JSON")
  .action(async (bookId: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);

      const bookIds = bookId ? [bookId] : await state.listBooks();
      const allPending: Array<{
        readonly bookId: string;
        readonly title: string;
        readonly chapter: number;
        readonly chapterTitle: string;
        readonly wordCount: number;
        readonly status: string;
        readonly issues: ReadonlyArray<string>;
        readonly reviewGroups?: {
          readonly chapterGoal?: {
            readonly mainConflict: string;
            readonly protagonistGoal: string;
            readonly endingHookType: string;
            readonly payoffToDeliver: string;
            readonly foreshadowToTouch: ReadonlyArray<string>;
          };
          readonly disciplineChecks: ReadonlyArray<string>;
          readonly continuityNotes: ReadonlyArray<string>;
          readonly traditionalWarnings: ReadonlyArray<string>;
        };
      }> = [];

      for (const id of bookIds) {
        const index = await state.loadChapterIndex(id);
        const pending = index.filter(
          (ch) =>
            ch.status === "ready-for-review" || ch.status === "audit-failed",
        );

        if (pending.length === 0) continue;

        const book = await state.loadBookConfig(id);
        const { profile: genreProfile } = await readGenreProfile(root, book.genre);
        const countingMode = resolveLengthCountingMode(book.language ?? genreProfile.language);

        if (!opts.json) {
          log(`\n${book.title} (${id}):`);
        }
        for (const ch of pending) {
          const presentation = await loadReviewPresentation(state.bookDir(id), ch.number, ch.auditIssues);
          allPending.push({
            bookId: id,
            title: book.title,
            chapter: ch.number,
            chapterTitle: ch.title,
            wordCount: ch.wordCount,
            status: ch.status,
            issues: ch.auditIssues,
            reviewGroups: {
              chapterGoal: presentation.chapterGoal
                ? {
                  mainConflict: presentation.chapterGoal.mainConflict,
                  protagonistGoal: presentation.chapterGoal.protagonistGoal,
                  endingHookType: presentation.chapterGoal.endingHookType,
                  payoffToDeliver: presentation.chapterGoal.payoffToDeliver,
                  foreshadowToTouch: presentation.chapterGoal.foreshadowToTouch,
                }
                : undefined,
              disciplineChecks: presentation.disciplineChecks,
              continuityNotes: presentation.continuityNotes,
              traditionalWarnings: presentation.traditionalWarnings,
            },
          });
          if (!opts.json) {
            log(
              `  Ch.${ch.number} "${ch.title}" | ${formatLengthCount(ch.wordCount, countingMode)} | ${ch.status}`,
            );
            renderReviewGroups(presentation, ch.auditIssues);
          }
        }
      }

      if (opts.json) {
        log(JSON.stringify({ pending: allPending }, null, 2));
      } else if (allPending.length === 0) {
        log("No chapters pending review.");
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to list reviews: ${e}`);
      }
      process.exit(1);
    }
  });

function renderReviewGroups(
  presentation: Awaited<ReturnType<typeof loadReviewPresentation>>,
  rawIssues: ReadonlyArray<string>,
): void {
  const chapterGoalLines = presentation.chapterGoal
    ? [
      `mainConflict: ${presentation.chapterGoal.mainConflict}`,
      `protagonistGoal: ${presentation.chapterGoal.protagonistGoal}`,
      `endingHookType: ${presentation.chapterGoal.endingHookType}`,
      `payoffToDeliver: ${presentation.chapterGoal.payoffToDeliver}`,
      presentation.chapterGoal.foreshadowToTouch.length > 0
        ? `foreshadowToTouch: ${presentation.chapterGoal.foreshadowToTouch.join(", ")}`
        : undefined,
    ].filter((line): line is string => Boolean(line))
    : [];

  const groups = [
    { name: "Chapter Goal", items: chapterGoalLines },
    { name: "Discipline Checks", items: presentation.disciplineChecks },
    { name: "Continuity / Planning Notes", items: presentation.continuityNotes },
    { name: "Traditional Warnings", items: presentation.traditionalWarnings },
  ].filter((group) => group.items.length > 0);

  if (groups.length === 0 && rawIssues.length > 0) {
    for (const issue of rawIssues) {
      log(`    - ${issue}`);
    }
    return;
  }

  if (groups.length === 1 && groups[0]?.name === "Traditional Warnings") {
    for (const issue of groups[0].items) {
      log(`    - ${issue}`);
    }
    return;
  }

  for (const group of groups) {
    log(`    ${group.name}:`);
    for (const item of group.items) {
      log(`      - ${item}`);
    }
  }
}

interface ContinuityBookRef {
  readonly id: string;
  readonly dir: string;
}

interface ContinuityChapterFile {
  readonly file: string;
  readonly title: string;
}

interface ContinuityCommandResult {
  readonly chapter: number;
  readonly chapterTitle: string;
  readonly report: ContinuityReport;
  readonly reportJsonPath: string;
  readonly reportMarkdownPath: string;
}

interface ContinuityFixResult {
  readonly chapter: number;
  readonly fixedChapterPath: string;
  readonly attempt?: number;
  readonly skippedReason?: string;
}

interface ContinuityAutoResult {
  readonly chapter: number;
  readonly initial: ContinuityCommandResult;
  readonly fixed?: ContinuityFixResult;
  readonly final?: ContinuityCommandResult;
  readonly finalStatus: string;
}

async function loadContinuityRuntime(requireLlm: boolean): Promise<{
  readonly client?: ReturnType<typeof createClient>;
  readonly model?: string;
}> {
  try {
    const config = await loadConfig();
    return { client: createClient(config), model: config.llm.model };
  } catch (error) {
    const fallback = await loadContinuityRuntimeFromGlobalEnv();
    if (fallback) return fallback;
    if (requireLlm) throw error;
    return {};
  }
}

async function loadContinuityRuntimeFromGlobalEnv(): Promise<{
  readonly client: ReturnType<typeof createLLMClient>;
  readonly model: string;
} | null> {
  const { config: loadDotenv } = await import("dotenv");
  loadDotenv({ path: GLOBAL_ENV_PATH });

  const env = process.env;
  const provider = env.INKOS_LLM_PROVIDER ?? "custom";
  const baseUrl = env.INKOS_LLM_BASE_URL;
  const model = env.INKOS_LLM_MODEL;
  const apiKey = env.INKOS_LLM_API_KEY ?? "";
  const apiKeyOptional = isApiKeyOptionalForEndpoint({ provider, baseUrl });

  if (!baseUrl || !model || (!apiKey && !apiKeyOptional)) {
    return null;
  }

  const llm = LLMConfigSchema.parse({
    provider,
    baseUrl,
    apiKey,
    model,
    ...(env.INKOS_LLM_TEMPERATURE ? { temperature: Number.parseFloat(env.INKOS_LLM_TEMPERATURE) } : {}),
    ...(env.INKOS_LLM_MAX_TOKENS ? { maxTokens: Number.parseInt(env.INKOS_LLM_MAX_TOKENS, 10) } : {}),
    ...(env.INKOS_LLM_THINKING_BUDGET ? { thinkingBudget: Number.parseInt(env.INKOS_LLM_THINKING_BUDGET, 10) } : {}),
    ...(env.INKOS_LLM_API_FORMAT === "chat" || env.INKOS_LLM_API_FORMAT === "responses" ? { apiFormat: env.INKOS_LLM_API_FORMAT } : {}),
    ...(env.INKOS_LLM_STREAM ? { stream: env.INKOS_LLM_STREAM !== "false" } : {}),
  });

  return {
    client: createLLMClient(llm),
    model: llm.model,
  };
}

async function resolveContinuityBook(root: string, bookIdArg: string | undefined): Promise<ContinuityBookRef> {
  const candidatesRoot = [
    join(root, "books"),
    join(root, "my-novel", "books"),
  ];

  const books: ContinuityBookRef[] = [];
  for (const booksRoot of candidatesRoot) {
    let entries: string[] = [];
    try {
      entries = await readdir(booksRoot);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(booksRoot, entry);
      try {
        await stat(join(dir, "book.json"));
        books.push({ id: entry, dir });
      } catch {
        // skip non-book directories
      }
    }
  }

  if (bookIdArg) {
    const found = books.find((book) => book.id === bookIdArg);
    if (!found) {
      throw new Error(`Book "${bookIdArg}" not found in books/ or my-novel/books/`);
    }
    return found;
  }

  if (books.length === 1) return books[0]!;
  if (!books.length) throw new Error("No books found in books/ or my-novel/books/");
  throw new Error(`Multiple books found: ${books.map((book) => book.id).join(", ")}. Use --book.`);
}

function resolveContinuityRange(opts: {
  readonly chapter?: string;
  readonly from?: string;
  readonly to?: string;
}): { readonly from: number; readonly to: number } {
  if (opts.chapter) {
    const chapter = parsePositiveInt(opts.chapter, "--chapter");
    return { from: chapter, to: chapter };
  }
  if (!opts.from || !opts.to) {
    throw new Error("Use --chapter <n> or --from <n> --to <n>.");
  }
  const from = parsePositiveInt(opts.from, "--from");
  const to = parsePositiveInt(opts.to, "--to");
  if (to < from) throw new Error("--to must be >= --from");
  return { from, to };
}

function parsePositiveInt(value: string, name: string): number {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

async function checkContinuityChapter(params: {
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client?: ReturnType<typeof createClient>;
  readonly model?: string;
  readonly final: boolean;
  readonly currentOverridePath?: string;
  readonly fixAttempt?: number;
  readonly maxFixAttempts?: number;
}): Promise<ContinuityCommandResult> {
  if (params.chapter <= 1) {
    throw new Error("Continuity check requires chapter >= 2 because it needs a previous chapter.");
  }

  const prev = await findChapterFile(params.bookDir, params.chapter - 1);
  const current = params.currentOverridePath
    ? { file: params.currentOverridePath, title: (await findChapterFile(params.bookDir, params.chapter)).title }
    : await findChapterFile(params.bookDir, params.chapter);

  const [prevChapter, currentChapter] = await Promise.all([
    readFile(prev.file, "utf-8"),
    readFile(current.file, "utf-8"),
  ]);

  const reportDir = join(params.bookDir, "reviews", "continuity");
  const prefix = chapterNumberPrefix(params.chapter);
  const reportJsonPath = join(reportDir, `${prefix}.${params.final ? "final-report" : "report"}.json`);
  const reportMarkdownPath = join(reportDir, `${prefix}.${params.final ? "final-report" : "report"}.md`);

  const report = params.client && params.model
    ? await runChapterContinuityCheck({
        client: params.client,
        model: params.model,
        prevChapter,
        currentChapter,
        chapterIndex: params.chapter,
        chapterTitle: current.title,
        reportJsonPath,
        reportMarkdownPath,
        fixAttempt: params.fixAttempt ?? 0,
        maxFixAttempts: params.maxFixAttempts ?? 2,
      })
    : await runLocalChapterContinuityCheck({
        prevChapter,
        currentChapter,
        chapterIndex: params.chapter,
        chapterTitle: current.title,
        reportJsonPath,
        reportMarkdownPath,
        fixAttempt: params.fixAttempt ?? 0,
        maxFixAttempts: params.maxFixAttempts ?? 2,
      });

  return {
    chapter: params.chapter,
    chapterTitle: current.title,
    report,
    reportJsonPath,
    reportMarkdownPath,
  };
}

async function fixContinuityChapter(params: {
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly reportJsonPath: string;
  readonly attempt: number;
  readonly maxFixAttempts: number;
}): Promise<ContinuityFixResult> {
  const report = JSON.parse(await readFile(params.reportJsonPath, "utf-8")) as ContinuityReport;
  const skip = getContinuityFixSkipReason(report, params.maxFixAttempts);
  if (skip) {
    return {
      chapter: params.chapter,
      fixedChapterPath: "",
      skippedReason: skip,
    };
  }

  const outDir = join(params.bookDir, "chapters-fixed");
  const outputPath = join(outDir, `${chapterNumberPrefix(params.chapter)}_attempt${params.attempt}.md`);
  await runChapterContinuityFix({
    client: params.client,
    model: params.model,
    reportJsonPath: params.reportJsonPath,
    outputPath,
  });
  return { chapter: params.chapter, fixedChapterPath: outputPath, attempt: params.attempt };
}

async function readContinuityFixState(bookDir: string, chapter: number, maxFixAttempts: number): Promise<{
  readonly reportJsonPath: string;
  readonly report: ContinuityReport;
  readonly nextAttempt: number;
}> {
  const reportJsonPath = await findLatestContinuityReportPath(bookDir, chapter);
  const report = JSON.parse(await readFile(reportJsonPath, "utf-8")) as ContinuityReport;
  const existingAttempts = await listFixedAttempts(bookDir, chapter);
  const nextAttempt = Math.max(report.fix_attempt ?? 0, ...existingAttempts, 0) + 1;
  return {
    reportJsonPath,
    report: {
      ...report,
      max_fix_attempts: maxFixAttempts,
    },
    nextAttempt,
  };
}

async function findLatestContinuityReportPath(bookDir: string, chapter: number): Promise<string> {
  const reportDir = join(bookDir, "reviews", "continuity");
  const prefix = chapterNumberPrefix(chapter);
  const finalPath = join(reportDir, `${prefix}.final-report.json`);
  try {
    await stat(finalPath);
    return finalPath;
  } catch {
    return join(reportDir, `${prefix}.report.json`);
  }
}

function getContinuityFixSkipReason(report: ContinuityReport, maxFixAttempts: number): string | null {
  if (report.rewrite_mode === "none" || report.status === "PASS") {
    return "rewrite_mode is none; chapter already passed continuity check.";
  }
  if ((report.fix_attempt ?? 0) >= maxFixAttempts || report.final_status === "MANUAL_REVIEW" && (report.fix_attempt ?? 0) >= maxFixAttempts) {
    return "Chapter failed to reach PASS after max attempts. Manual review required.";
  }
  return null;
}

async function listFixedAttempts(bookDir: string, chapter: number): Promise<number[]> {
  const fixedDir = join(bookDir, "chapters-fixed");
  const files = await listFiles(fixedDir).catch(() => []);
  return files
    .filter((file) => getChapterNumberFromFile(file) === chapter)
    .map((file) => getAttemptFromFilename(file))
    .filter((attempt): attempt is number => attempt !== null);
}

function markManualReview(report: ContinuityReport, reason = ""): ContinuityReport {
  const warning = "Chapter failed to reach PASS after max attempts. Manual review required.";
  const suffix = reason ? `${warning} ${reason}` : warning;
  return {
    ...report,
    status: "MANUAL_REVIEW",
    final_status: "MANUAL_REVIEW",
    summary: `${report.summary}\n\n${suffix}`,
  };
}

async function writeContinuityReportFiles(
  report: ContinuityReport,
  jsonPath: string,
  markdownPath: string,
  chapter: number,
  chapterTitle: string,
): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderContinuityMarkdown(report, chapter, chapterTitle), "utf-8");
}

async function findChapterFile(bookDir: string, chapter: number): Promise<ContinuityChapterFile> {
  const roots = [join(bookDir, "chapters"), bookDir];
  for (const root of roots) {
    const files = await listFiles(root).catch(() => []);
    const found = files
      .filter((file) => /\.(md|txt)$/i.test(file))
      .filter((file) => getChapterNumberFromFile(file) === chapter)
      .sort()[0];
    if (found) {
      return { file: found, title: getChapterTitleFromFile(found) };
    }
  }
  throw new Error(`Chapter ${chapter} not found under ${bookDir}/chapters`);
}

async function findFixedChapterFile(bookDir: string, chapter: number): Promise<string> {
  const fixedDir = join(bookDir, "chapters-fixed");
  const files = await listFiles(fixedDir).catch(() => []);
  const found = files
    .filter((file) => /\.(md|txt)$/i.test(file))
    .filter((file) => getChapterNumberFromFile(file) === chapter)
    .sort((a, b) => (getAttemptFromFilename(b) ?? 0) - (getAttemptFromFilename(a) ?? 0))[0];
  if (!found) {
    throw new Error(`Fixed chapter ${chapter} not found under ${fixedDir}`);
  }
  return found;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(file));
    else files.push(file);
  }
  return files;
}

function getChapterNumberFromFile(file: string): number | null {
  const match = basename(file).match(/^0*(\d+)(?:[_\-.].*)?\.(?:md|txt)$/i);
  return match ? Number(match[1]) : null;
}

function getChapterTitleFromFile(file: string): string {
  const match = basename(file).match(/^0*\d+(?:[_\-.](.+?))?\.(?:md|txt)$/i);
  return (match?.[1] ?? "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttemptFromFilename(file: string): number | null {
  const match = basename(file).match(/_attempt(\d+)\.(?:md|txt)$/i);
  if (!match) return null;
  const attempt = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(attempt) && attempt > 0 ? attempt : null;
}

/**
 * Parse "[book-id] <chapter>" style arguments from variadic args.
 * Supports: "3" (auto-detect book) or "my-book 3"
 */
function parseBookAndChapter(
  args: ReadonlyArray<string>,
): { readonly bookIdArg: string | undefined; readonly chapterNum: number } {
  if (args.length === 1) {
    const num = parseInt(args[0]!, 10);
    if (isNaN(num)) {
      throw new Error(`Expected chapter number, got "${args[0]}"`);
    }
    return { bookIdArg: undefined, chapterNum: num };
  }
  if (args.length === 2) {
    const num = parseInt(args[1]!, 10);
    if (isNaN(num)) {
      throw new Error(`Expected chapter number as second argument, got "${args[1]}"`);
    }
    return { bookIdArg: args[0], chapterNum: num };
  }
  throw new Error("Usage: inkos review approve [book-id] <chapter>");
}

reviewCommand
  .command("approve")
  .description("Approve a chapter and commit its state: approve [book-id] <chapter>")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();
      const { bookIdArg, chapterNum } = parseBookAndChapter(args);
      const bookId = await resolveBookId(bookIdArg, root);

      const state = new StateManager(root);
      const index = [...(await state.loadChapterIndex(bookId))];
      const idx = index.findIndex((ch) => ch.number === chapterNum);
      if (idx === -1) {
        throw new Error(`Chapter ${chapterNum} not found in "${bookId}"`);
      }

      index[idx] = {
        ...index[idx]!,
        status: "approved",
        updatedAt: new Date().toISOString(),
      };
      await state.saveChapterIndex(bookId, index);

      if (opts.json) {
        log(JSON.stringify({ bookId, chapter: chapterNum, status: "approved" }));
      } else {
        log(`Chapter ${chapterNum} approved (state committed).`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to approve: ${e}`);
      }
      process.exit(1);
    }
  });

reviewCommand
  .command("approve-all")
  .description("Approve all pending chapters for a book")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);

      const index = [...(await state.loadChapterIndex(bookId))];
      let count = 0;
      const now = new Date().toISOString();

      const updated = index.map((ch) => {
        if (ch.status === "ready-for-review" || ch.status === "audit-failed") {
          count++;
          return { ...ch, status: "approved" as const, updatedAt: now };
        }
        return ch;
      });

      await state.saveChapterIndex(bookId, updated);

      if (opts.json) {
        log(JSON.stringify({ bookId, approvedCount: count }));
      } else {
        log(`${count} chapter(s) approved.`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to approve: ${e}`);
      }
      process.exit(1);
    }
  });

reviewCommand
  .command("reject")
  .description("Reject a chapter and roll back state: reject [book-id] <chapter>")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--reason <reason>", "Rejection reason")
  .option("--keep-subsequent", "Only reject this chapter, do not discard subsequent chapters")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();
      const { bookIdArg, chapterNum } = parseBookAndChapter(args);
      const bookId = await resolveBookId(bookIdArg, root);

      const state = new StateManager(root);
      const index = await state.loadChapterIndex(bookId);
      const idx = index.findIndex((ch) => ch.number === chapterNum);
      if (idx === -1) {
        throw new Error(`Chapter ${chapterNum} not found in "${bookId}"`);
      }

      if (opts.keepSubsequent) {
        // Legacy behavior: only mark as rejected, no state rollback
        const updated = [...index];
        updated[idx] = {
          ...updated[idx]!,
          status: "rejected",
          reviewNote: opts.reason ?? "Rejected without reason",
          updatedAt: new Date().toISOString(),
        };
        await state.saveChapterIndex(bookId, updated);

        if (opts.json) {
          log(JSON.stringify({ bookId, chapter: chapterNum, status: "rejected", discarded: [] }));
        } else {
          log(`Chapter ${chapterNum} rejected (state not rolled back).`);
        }
        return;
      }

      // Default: roll back state to before the rejected chapter and discard
      // it along with all subsequent chapters that depend on its state.
      const rollbackTarget = chapterNum - 1;
      const discarded = await state.rollbackToChapter(bookId, rollbackTarget);

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          chapter: chapterNum,
          status: "rejected",
          rolledBackTo: rollbackTarget,
          discarded,
        }));
      } else {
        log(`Chapter ${chapterNum} rejected. State rolled back to chapter ${rollbackTarget}.`);
        if (discarded.length > 1) {
          log(`  Also discarded ${discarded.length - 1} subsequent chapter(s): ${discarded.filter((n) => n !== chapterNum).join(", ")}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to reject: ${e}`);
      }
      process.exit(1);
    }
  });
