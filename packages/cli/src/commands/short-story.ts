import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  StateManager,
  auditShortStoryBook,
  analyzeShortStoryPublishReadiness,
  createShortStoryChapterPlan,
  createShortStoryPublishPackage,
  createShortStoryVariant,
  checkShortStoryWriterOutput,
  formatLengthCount,
  generateShortStoryDraftChapters,
  generateShortStoryTitles,
  generateShortStoryVideoScript,
  optimizeShortStoryOpening,
  parseShortStoryPlanMarkdown,
  renderShortStoryAnalysisMarkdown,
  renderShortStoryTitlesMarkdown,
  renderShortStoryVideoScript,
  resolveLengthCountingMode,
  type ShortStoryChapterPlan,
  type ShortStoryAuditIssue,
  type ShortStoryVariant,
} from "@actalk/inkos-core";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

export const shortStoryCommand = new Command("short-story")
  .description("Plan and audit complete short-story books");

shortStoryCommand
  .command("plan")
  .description("Create a chapter word-count plan for a complete short story")
  .requiredOption("--theme <theme>", "Short story theme")
  .requiredOption("--target-words <number>", "Target total word count")
  .option("--chapter-words <number>", "Target words per chapter", "1500")
  .option("--genre <genre>", "Genre")
  .option("--out <filePath>", "Write the markdown plan to a file")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const targetWords = parsePositiveInteger(opts.targetWords, "target-words");
      const chapterTargetWords = parsePositiveInteger(opts.chapterWords, "chapter-words");
      const chapters = createShortStoryChapterPlan({
        theme: opts.theme,
        genre: opts.genre,
        targetWords,
        chapterTargetWords,
      });

      const result = {
        type: "short_story",
        theme: opts.theme,
        genre: opts.genre,
        targetWords,
        chapterTargetWords,
        chapterCount: chapters.length,
        chapters,
      };
      const markdown = renderShortStoryPlanMarkdown({
        theme: opts.theme,
        genre: opts.genre,
        targetWords,
        chapterTargetWords,
        chapters,
      });

      if (opts.out) {
        const outPath = resolve(process.cwd(), opts.out);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, markdown, "utf-8");
      }

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
        return;
      }

      log(markdown.trimEnd());
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to plan short story: ${e}`);
      }
      process.exit(1);
    }
  });

shortStoryCommand
  .command("write")
  .description("Write markdown chapters from an existing short-story plan")
  .requiredOption("--theme <theme>", "Short story theme")
  .requiredOption("--target-words <number>", "Target total word count")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const targetWords = parsePositiveInteger(opts.targetWords, "target-words");
      const storyDir = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const planPath = join(storyDir, "plan.md");
      const chaptersDir = join(storyDir, "chapters");
      const markdown = await readFile(planPath, "utf-8");
      const plan = parseShortStoryPlanMarkdown(markdown);

      if (plan.theme !== opts.theme) {
        throw new Error(`plan theme "${plan.theme}" does not match --theme "${opts.theme}"`);
      }
      if (plan.targetWords !== targetWords) {
        throw new Error(`plan target ${plan.targetWords} does not match --target-words ${targetWords}`);
      }

      const chapters = generateShortStoryDraftChapters(plan);
      await mkdir(chaptersDir, { recursive: true });
      const written: Array<{ chapterNumber: number; path: string; wordCount: number }> = [];

      for (const chapter of chapters) {
        const fileName = `${String(chapter.chapterNumber).padStart(3, "0")}.md`;
        const filePath = join(chaptersDir, fileName);
        await writeFile(filePath, chapter.content, "utf-8");
        written.push({
          chapterNumber: chapter.chapterNumber,
          path: filePath,
          wordCount: chapter.wordCount,
        });
      }

      if (opts.json) {
        log(JSON.stringify({
          type: "short_story",
          theme: opts.theme,
          targetWords,
          planPath,
          chaptersDir,
          chapters: written,
        }, null, 2));
        return;
      }

      log(`Short story written: ${opts.theme}`);
      log(`  Plan: ${planPath}`);
      log(`  Chapters: ${chaptersDir}`);
      for (const chapter of written) {
        log(`  [${chapter.chapterNumber}] ${chapter.path} (${chapter.wordCount} words)`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to write short story: ${e}`);
      }
      process.exit(1);
    }
  });

shortStoryCommand
  .command("hook")
  .description("Optimize the first 300 characters of the first short-story chapter")
  .requiredOption("--theme <theme>", "Short story theme")
  .action(async (opts) => {
    try {
      const storyDir = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const firstChapterPath = join(storyDir, "chapters", "001.md");
      const before = await readFile(firstChapterPath, "utf-8");
      const result = optimizeShortStoryOpening(opts.theme, before);
      await writeFile(firstChapterPath, result.content, "utf-8");

      log(`Short story hook optimized: ${opts.theme}`);
      log(`  Strategy: ${result.strategyId}`);
      log(`  Chapter: ${firstChapterPath}`);
    } catch (e) {
      logError(`Failed to optimize short story hook: ${e}`);
      process.exit(1);
    }
  });

shortStoryCommand
  .command("titles")
  .description("Generate publish-ready short-story titles from the plan and first chapter")
  .requiredOption("--theme <theme>", "Short story theme")
  .action(async (opts) => {
    try {
      const storyDir = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const planPath = join(storyDir, "plan.md");
      const firstChapterPath = join(storyDir, "chapters", "001.md");
      const titlesPath = join(storyDir, "titles.md");
      const [planMarkdown, firstChapterMarkdown] = await Promise.all([
        readFile(planPath, "utf-8"),
        readFile(firstChapterPath, "utf-8"),
      ]);
      const titles = generateShortStoryTitles({
        theme: opts.theme,
        planMarkdown,
        firstChapterMarkdown,
      });
      const markdown = renderShortStoryTitlesMarkdown(opts.theme, titles);
      await writeFile(titlesPath, markdown, "utf-8");

      log(markdown.trimEnd());
      log(`\nTitles written: ${titlesPath}`);
    } catch (e) {
      logError(`Failed to generate short story titles: ${e}`);
      process.exit(1);
    }
  });

shortStoryCommand
  .command("export")
  .description("Export a short story into publish-ready chapter files and a full book.txt")
  .requiredOption("--theme <theme>", "Short story theme")
  .action(async (opts) => {
    try {
      const storyRoot = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const storyDir = await resolveShortStoryExportDir(storyRoot);
      const chaptersDir = join(storyDir, "chapters");
      const publishDir = join(storyDir, "publish");
      const planPath = join(storyDir, "plan.md");
      const titlesPath = join(storyDir, "titles.md");
      const chapterFiles = (await readdir(chaptersDir))
        .filter((fileName) => fileName.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

      if (chapterFiles.length === 0) {
        throw new Error(`No markdown chapters found in ${chaptersDir}`);
      }

      const chapters = await Promise.all(chapterFiles.map(async (fileName, index) => ({
        chapterNumber: parseChapterNumberFromFile(fileName) ?? index + 1,
        fileName,
        content: await readFile(join(chaptersDir, fileName), "utf-8"),
      })));
      const titlesMarkdown = await readOptionalFile(titlesPath)
        ?? await createTitlesMarkdownFromExistingStory(opts.theme, storyDir, chapters[0]?.content ?? "");
      const planMarkdown = await readOptionalFile(planPath);
      const publishPackage = createShortStoryPublishPackage({
        theme: opts.theme,
        chapters,
        planMarkdown,
        titlesMarkdown,
      });

      await cleanShortStoryPublishDir(publishDir);
      for (const chapter of publishPackage.chapters) {
        await writeFile(join(publishDir, chapter.fileName), chapter.content, "utf-8");
      }
      const bookPath = join(publishDir, "book.txt");
      await writeFile(bookPath, publishPackage.bookText, "utf-8");

      log(`Short story exported: ${opts.theme}`);
      log(`  Title: ${publishPackage.bookTitle}`);
      log(`  Chapters: ${publishPackage.chapters.length}`);
      log(`  Publish: ${publishDir}`);
      log(`  Book: ${bookPath}`);
    } catch (e) {
      logError(`Failed to export short story: ${e}`);
      process.exit(1);
    }
  });

shortStoryCommand
  .command("script")
  .description("Generate a short-video promotion script from the first short-story chapter")
  .requiredOption("--theme <theme>", "Short story theme")
  .action(async (opts) => {
    try {
      const storyDir = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const firstChapterPath = join(storyDir, "chapters", "001.md");
      const scriptsDir = join(storyDir, "scripts");
      const scriptPath = join(scriptsDir, "script.txt");
      const firstChapterMarkdown = await readFile(firstChapterPath, "utf-8");
      const lines = generateShortStoryVideoScript({
        theme: opts.theme,
        firstChapterMarkdown,
      });
      const script = renderShortStoryVideoScript(lines);

      await mkdir(scriptsDir, { recursive: true });
      await writeFile(scriptPath, script, "utf-8");

      log(script.trimEnd());
      log(`\nShort-video script written: ${scriptPath}`);
    } catch (e) {
      logError(`Failed to generate short story video script: ${e}`);
      process.exit(1);
    }
  });

shortStoryCommand
  .command("batch")
  .description("Generate multiple short-story runs for testing")
  .requiredOption("--themes <themes>", "Comma-separated short story themes")
  .requiredOption("--count <number>", "Runs to generate for each theme")
  .option("--target-words <number>", "Target total word count", "12000")
  .option("--chapter-words <number>", "Target words per chapter", "1500")
  .action(async (opts) => {
    try {
      const themes = parseThemeList(opts.themes);
      const count = parsePositiveInteger(opts.count, "count");
      const targetWords = parsePositiveInteger(opts.targetWords, "target-words");
      const chapterTargetWords = parsePositiveInteger(opts.chapterWords, "chapter-words");
      const baseDir = resolve(process.cwd(), "my-novel", "short-stories");
      const timestamp = formatBatchTimestamp(new Date());
      const previousFirstChapters = new Map<string, string>();
      const runs: Array<{ theme: string; index: number; dir: string; chapters: number; warnings: ReadonlyArray<string> }> = [];

      for (const theme of themes) {
        for (let index = 1; index <= count; index += 1) {
          const runDir = join(baseDir, theme, `run-${timestamp}-${String(index).padStart(2, "0")}`);
          const result = await runShortStoryBatchPipeline({
            theme,
            targetWords,
            chapterTargetWords,
            storyDir: runDir,
            runIndex: index,
            timestamp,
            previousFirstChapter: previousFirstChapters.get(theme),
          });
          previousFirstChapters.set(theme, result.firstChapter);
          runs.push({
            theme,
            index,
            dir: runDir,
            chapters: result.chapterCount,
            warnings: result.warnings,
          });
        }
      }

      log("Short story batch completed");
      for (const run of runs) {
        log(`  [${run.theme} #${run.index}] ${run.dir} (${run.chapters} chapters)`);
        for (const warning of run.warnings) {
          log(`    writer-check warning: ${warning}`);
        }
      }
    } catch (e) {
      logError(`Failed to run short story batch: ${e}`);
      process.exit(1);
    }
  });

shortStoryCommand
  .command("collect")
  .description("Collect manual performance metrics for a short-story run")
  .requiredOption("--theme <theme>", "Short story theme")
  .option("--run <runName>", "Run directory name, defaults to the latest run-*")
  .action(async (opts) => {
    try {
      const themeDir = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const runName = opts.run ?? await resolveLatestShortStoryRun(themeDir);
      const runDir = join(themeDir, runName);
      const metricsPath = join(runDir, "metrics.json");
      const metrics = await promptShortStoryMetrics(opts.theme, runName);

      await writeFile(metricsPath, JSON.stringify(metrics, null, 2) + "\n", "utf-8");

      log(`Short story metrics collected: ${opts.theme}`);
      log(`  Run: ${runName}`);
      log(`  Metrics: ${metricsPath}`);
      log(`  CTR: ${(metrics.CTR * 100).toFixed(2)}%`);
    } catch (e) {
      logError(`Failed to collect short story metrics: ${e}`);
      process.exit(1);
    }
  });

shortStoryCommand
  .command("rank")
  .description("Rank short-story runs by collected performance metrics")
  .requiredOption("--theme <theme>", "Short story theme")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const themeDir = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const ranked = await rankShortStoryRuns(themeDir);

      if (opts.json) {
        log(JSON.stringify({
          theme: opts.theme,
          runs: ranked,
        }, null, 2));
        return;
      }

      log(`Short story run ranking: ${opts.theme}`);
      if (ranked.length === 0) {
        log("  No metrics.json files found.");
        return;
      }
      for (const [index, run] of ranked.entries()) {
        log(
          `  [${index + 1}] ${run.run} score=${run.score.toFixed(4)} `
          + `CTR=${formatRate(run.CTR)} completion=${formatRate(run.completion)} `
          + `like_rate=${formatRate(run.like_rate)}`,
        );
      }
      log(`  Best: ${ranked[0]?.run}`);
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to rank short story runs: ${e}`);
      }
      process.exit(1);
    }
  });

shortStoryCommand
  .command("analyze")
  .description("Analyze short-story publish potential from chapters and titles")
  .requiredOption("--theme <theme>", "Short story theme")
  .action(async (opts) => {
    try {
      const storyDir = resolve(process.cwd(), "my-novel", "short-stories", opts.theme);
      const chaptersDir = join(storyDir, "chapters");
      const titlesPath = join(storyDir, "titles.md");
      const analysisPath = join(storyDir, "analysis.md");
      const chapterFiles = (await readdir(chaptersDir))
        .filter((fileName) => fileName.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

      if (chapterFiles.length === 0) {
        throw new Error(`No markdown chapters found in ${chaptersDir}`);
      }

      const [titlesMarkdown, chapters] = await Promise.all([
        readFile(titlesPath, "utf-8"),
        Promise.all(chapterFiles.map(async (fileName, index) => ({
          chapterNumber: parseChapterNumberFromFile(fileName) ?? index + 1,
          fileName,
          content: await readFile(join(chaptersDir, fileName), "utf-8"),
        }))),
      ]);
      const report = analyzeShortStoryPublishReadiness({
        theme: opts.theme,
        chapters,
        titlesMarkdown,
      });
      const markdown = renderShortStoryAnalysisMarkdown(report);

      await writeFile(analysisPath, markdown, "utf-8");

      log(markdown.trimEnd());
      log(`\nAnalysis written: ${analysisPath}`);
    } catch (e) {
      logError(`Failed to analyze short story: ${e}`);
      process.exit(1);
    }
  });

shortStoryCommand
  .command("audit")
  .description("Audit an existing book directory against short-story constraints")
  .argument("[bookName]", "Book ID/name (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookName: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);
      const bookId = await resolveBookId(bookName, root);
      const book = await state.loadBookConfig(bookId);
      const countingMode = resolveLengthCountingMode(book.language ?? "zh");
      const report = await auditShortStoryBook({
        bookName: bookId,
        bookDir: state.bookDir(bookId),
        countingMode,
      });

      if (opts.json) {
        log(JSON.stringify(report, null, 2));
        return;
      }

      log(`Short story audit: ${book.title} (${bookId})`);
      log(`  Result: ${report.passed ? "PASSED" : "FAILED"}`);
      log(`  Chapters: ${report.chapterCount}`);
      log(`  Total: ${formatLengthCount(report.totalWords, countingMode)}`);
      if (report.issues.length > 0) {
        log("  Issues:");
        for (const issue of report.issues) {
          log(`    [${issue.severity}] ${formatIssue(issue)}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Short story audit failed: ${e}`);
      }
      process.exit(1);
    }
  });

function parsePositiveInteger(raw: string, name: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || String(value) !== raw.trim()) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseThemeList(raw: string): string[] {
  const themes = raw.split(",").map((theme) => theme.trim()).filter(Boolean);
  if (themes.length === 0) {
    throw new Error("themes must include at least one theme");
  }
  return themes;
}

function formatBatchTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function resolveLatestShortStoryRun(themeDir: string): Promise<string> {
  const entries = await readdir(themeDir);
  const runs = entries.filter((entry) => entry.startsWith("run-")).sort((a, b) => b.localeCompare(a));
  const latest = runs[0];
  if (!latest) {
    throw new Error(`No run-* directories found in ${themeDir}`);
  }
  return latest;
}

async function promptShortStoryMetrics(theme: string, runName: string): Promise<{
  readonly theme: string;
  readonly run: string;
  readonly collectedAt: string;
  readonly views: number;
  readonly clicks: number;
  readonly CTR: number;
  readonly completion: number;
  readonly likes: number;
  readonly follows: number;
}> {
  if (!input.isTTY) {
    const [views, clicks, completion, likes, follows] = parsePipedMetricValues(await readStdinText());
    return createShortStoryMetrics({
      theme,
      runName,
      views,
      clicks,
      completion,
      likes,
      follows,
    });
  }

  const rl = createInterface({ input, output });
  try {
    log(`Collecting metrics for ${theme}/${runName}`);
    const views = await promptNonNegativeNumber(rl, "views");
    const clicks = await promptNonNegativeNumber(rl, "clicks");
    const completion = await promptNonNegativeNumber(rl, "completion");
    const likes = await promptNonNegativeNumber(rl, "likes");
    const follows = await promptNonNegativeNumber(rl, "follows");
    return createShortStoryMetrics({
      theme,
      runName,
      views,
      clicks,
      completion,
      likes,
      follows,
    });
  } finally {
    rl.close();
  }
}

async function readStdinText(): Promise<string> {
  input.setEncoding("utf-8");
  let text = "";
  for await (const chunk of input) {
    text += chunk;
  }
  return text;
}

function parsePipedMetricValues(raw: string): [number, number, number, number, number] {
  const values = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const names = ["views", "clicks", "completion", "likes", "follows"] as const;
  if (values.length < names.length) {
    throw new Error("collect expects five input lines: views, clicks, completion, likes, follows");
  }
  return names.map((name, index) => parseNonNegativeNumber(values[index] ?? "", name)) as [
    number,
    number,
    number,
    number,
    number,
  ];
}

function createShortStoryMetrics(options: {
  readonly theme: string;
  readonly runName: string;
  readonly views: number;
  readonly clicks: number;
  readonly completion: number;
  readonly likes: number;
  readonly follows: number;
}): {
  readonly theme: string;
  readonly run: string;
  readonly collectedAt: string;
  readonly views: number;
  readonly clicks: number;
  readonly CTR: number;
  readonly completion: number;
  readonly likes: number;
  readonly follows: number;
} {
  return {
    theme: options.theme,
    run: options.runName,
    collectedAt: new Date().toISOString(),
    views: options.views,
    clicks: options.clicks,
    CTR: options.views > 0 ? roundMetric(options.clicks / options.views) : 0,
    completion: options.completion,
    likes: options.likes,
    follows: options.follows,
  };
}

async function promptNonNegativeNumber(
  rl: ReturnType<typeof createInterface>,
  name: string,
): Promise<number> {
  for (;;) {
    const answer = (await rl.question(`${name}: `)).trim();
    try {
      return parseNonNegativeNumber(answer, name);
    } catch {
      log(`${name} must be a non-negative number.`);
    }
  }
}

function parseNonNegativeNumber(raw: string, name: string): number {
  const value = Number(raw);
  if (raw.length > 0 && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw new Error(`${name} must be a non-negative number`);
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function rankShortStoryRuns(themeDir: string): Promise<Array<{
  readonly run: string;
  readonly metricsPath: string;
  readonly views: number;
  readonly clicks: number;
  readonly CTR: number;
  readonly completion: number;
  readonly likes: number;
  readonly follows: number;
  readonly like_rate: number;
  readonly score: number;
}>> {
  const entries = await readdir(themeDir);
  const runNames = entries.filter((entry) => entry.startsWith("run-")).sort((a, b) => a.localeCompare(b));
  const ranked = [];

  for (const runName of runNames) {
    const metricsPath = join(themeDir, runName, "metrics.json");
    const raw = await readOptionalFile(metricsPath);
    if (!raw) continue;
    const metrics = parseShortStoryMetrics(raw, metricsPath);
    const views = metrics.views;
    const CTR = Number.isFinite(metrics.CTR) ? metrics.CTR : views > 0 ? metrics.clicks / views : 0;
    const likeRate = views > 0 ? metrics.likes / views : 0;
    ranked.push({
      run: runName,
      metricsPath,
      views,
      clicks: metrics.clicks,
      CTR: roundMetric(CTR),
      completion: metrics.completion,
      likes: metrics.likes,
      follows: metrics.follows,
      like_rate: roundMetric(likeRate),
      score: roundMetric(CTR * 0.5 + metrics.completion * 0.3 + likeRate * 0.2),
    });
  }

  return ranked.sort((a, b) => b.score - a.score || b.CTR - a.CTR || b.completion - a.completion);
}

function parseShortStoryMetrics(raw: string, source: string): {
  readonly views: number;
  readonly clicks: number;
  readonly CTR: number;
  readonly completion: number;
  readonly likes: number;
  readonly follows: number;
} {
  const parsed = JSON.parse(raw) as Partial<{
    views: number;
    clicks: number;
    CTR: number;
    completion: number;
    likes: number;
    follows: number;
  }>;
  const required = ["views", "clicks", "completion", "likes", "follows"] as const;
  for (const key of required) {
    if (typeof parsed[key] !== "number" || !Number.isFinite(parsed[key]) || parsed[key] < 0) {
      throw new Error(`${source} has invalid ${key}`);
    }
  }
  const views = parsed.views;
  const clicks = parsed.clicks;
  const completion = parsed.completion;
  const likes = parsed.likes;
  const follows = parsed.follows;
  if (
    typeof views !== "number"
    || typeof clicks !== "number"
    || typeof completion !== "number"
    || typeof likes !== "number"
    || typeof follows !== "number"
  ) {
    throw new Error(`${source} has incomplete metrics`);
  }
  return {
    views,
    clicks,
    CTR: typeof parsed.CTR === "number" && Number.isFinite(parsed.CTR) && parsed.CTR >= 0
      ? parsed.CTR
      : views > 0 ? clicks / views : 0,
    completion,
    likes,
    follows,
  };
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function parseChapterNumberFromFile(fileName: string): number | undefined {
  const match = fileName.match(/^(\d+)/);
  if (!match?.[1]) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

async function createTitlesMarkdownFromExistingStory(
  theme: string,
  storyDir: string,
  firstChapterMarkdown: string,
): Promise<string> {
  const planMarkdown = await readOptionalFile(join(storyDir, "plan.md")) ?? "";
  const titles = generateShortStoryTitles({
    theme,
    planMarkdown,
    firstChapterMarkdown,
  });
  return renderShortStoryTitlesMarkdown(theme, titles);
}

function formatIssue(issue: ShortStoryAuditIssue): string {
  const chapter = issue.chapterNumber ? `chapter ${issue.chapterNumber}: ` : "";
  return `${chapter}${issue.message}`;
}

function renderShortStoryPlanMarkdown(options: {
  readonly theme: string;
  readonly genre?: string;
  readonly targetWords: number;
  readonly chapterTargetWords: number;
  readonly variant?: ShortStoryVariant;
  readonly chapters: ReadonlyArray<ShortStoryChapterPlan>;
}): string {
  const lines = [
    `# Short story plan: ${options.theme}`,
    "",
    `- Target: ${options.targetWords} words`,
    `- Chapter target: ${options.chapterTargetWords} words`,
    `- Chapters: ${options.chapters.length}`,
  ];

  if (options.genre) {
    lines.push(`- Genre: ${options.genre}`);
  }

  lines.push("");
  if (options.variant) {
    lines.push(
      "## Variant",
      "",
      `- runIndex: ${options.variant.runIndex}`,
      `- seed: ${options.variant.seed}`,
      `- writingMode: ${options.variant.writingMode}`,
      `- hookMode: ${options.variant.hookMode}`,
      `- theme: ${options.variant.theme}`,
      `- baseWorld.protagonist: ${options.variant.baseWorld.protagonist}`,
      `- baseWorld.role: ${options.variant.baseWorld.role}`,
      `- baseWorld.setting: ${options.variant.baseWorld.setting}`,
      `- baseWorld.coreConflict: ${options.variant.baseWorld.coreConflict}`,
      `- baseWorld.supportingCharacters: ${options.variant.baseWorld.supportingCharacters.join("、")}`,
      `- baseWorld.hiddenTruth: ${options.variant.baseWorld.hiddenTruth ?? ""}`,
      `- baseWorld.secret: ${options.variant.baseWorld.secret ?? ""}`,
      `- derived.mainThreat: ${options.variant.derived.mainThreat}`,
      `- derived.twistDirection: ${options.variant.derived.twistDirection}`,
      `- derived.premise: ${options.variant.derived.premise}`,
      `- derived.antagonist: ${options.variant.derived.antagonist}`,
      `- derived.ally: ${options.variant.derived.ally}`,
      `- derived.keyRelation: ${options.variant.derived.keyRelation}`,
      `- derived.openingIncident: ${options.variant.derived.openingIncident}`,
      `- derived.coreSecret: ${options.variant.derived.coreSecret}`,
      `- derived.ending: ${options.variant.derived.ending}`,
      `- derived.forbiddenElements: ${options.variant.derived.forbiddenElements.join("、")}`,
      "",
    );
  }

  for (const chapter of options.chapters) {
    lines.push(
      `## [${chapter.chapterNumber}] ${chapter.function} - ${formatShortStoryFunctionLabel(chapter, options.chapters)}`,
      "",
      `- summary: ${chapter.summary}`,
      `- conflict: ${chapter.conflict}`,
      `- endingHook: ${chapter.endingHook}`,
      `- targetWords: ${chapter.targetWords}`,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatShortStoryFunctionLabel(
  chapter: ShortStoryChapterPlan,
  chapters: ReadonlyArray<ShortStoryChapterPlan>,
): string {
  switch (chapter.function) {
    case "hook":
      return "开局冲突";
    case "escalation":
      return "矛盾升级";
    case "twist":
      return formatOrdinalLabel(countPreviousFunctions(chapter, chapters, "twist") + 1, "反转");
    case "climax":
      return "终局对抗";
    case "resolution":
      return "完整结局";
  }
}

function countPreviousFunctions(
  chapter: ShortStoryChapterPlan,
  chapters: ReadonlyArray<ShortStoryChapterPlan>,
  chapterFunction: ShortStoryChapterPlan["function"],
): number {
  return chapters.filter((candidate) =>
    candidate.chapterNumber < chapter.chapterNumber && candidate.function === chapterFunction
  ).length;
}

function formatOrdinalLabel(index: number, suffix: string): string {
  if (index === 1) return `第一次${suffix}`;
  return `第${index}次${suffix}`;
}

async function runShortStoryBatchPipeline(options: {
  readonly theme: string;
  readonly targetWords: number;
  readonly chapterTargetWords: number;
  readonly storyDir: string;
  readonly runIndex: number;
  readonly timestamp: string;
  readonly previousFirstChapter?: string;
}): Promise<{ chapterCount: number; firstChapter: string; warnings: ReadonlyArray<string> }> {
  const planPath = join(options.storyDir, "plan.md");
  const chaptersDir = join(options.storyDir, "chapters");
  const publishDir = join(options.storyDir, "publish");
  const scriptsDir = join(options.storyDir, "scripts");
  const titlesPath = join(options.storyDir, "titles.md");
  const scriptPath = join(scriptsDir, "script.txt");
  const variantPath = join(options.storyDir, "variant.json");
  const variant = createShortStoryVariant({
    theme: options.theme,
    runIndex: options.runIndex,
    timestamp: options.timestamp,
  });

  const chapters = createShortStoryChapterPlan({
    theme: options.theme,
    targetWords: options.targetWords,
    chapterTargetWords: options.chapterTargetWords,
    variant,
  });
  const planMarkdown = renderShortStoryPlanMarkdown({
    theme: options.theme,
    targetWords: options.targetWords,
    chapterTargetWords: options.chapterTargetWords,
    variant,
    chapters,
  });

  await mkdir(chaptersDir, { recursive: true });
  await writeFile(variantPath, `${JSON.stringify(variant, null, 2)}\n`, "utf-8");
  await writeFile(planPath, planMarkdown, "utf-8");

  const parsedPlan = parseShortStoryPlanMarkdown(planMarkdown);
  const drafts = generateShortStoryDraftChapters(parsedPlan);
  const writerCheck = checkShortStoryWriterOutput({
    chapters: drafts.map((draft) => draft.content),
    variant,
    previousFirstChapter: options.previousFirstChapter,
  });
  const writerErrors = writerCheck.issues.filter((issue) => issue.severity === "error");
  if (writerErrors.length > 0) {
    throw new Error(`Short-story writer check failed: ${writerErrors.map((issue) => issue.message).join("; ")}`);
  }
  for (const draft of drafts) {
    const filePath = join(chaptersDir, `${String(draft.chapterNumber).padStart(3, "0")}.md`);
    await writeFile(filePath, draft.content, "utf-8");
  }

  const firstChapterPath = join(chaptersDir, "001.md");
  const firstChapterBeforeHook = await readFile(firstChapterPath, "utf-8");
  const hookResult = optimizeShortStoryOpening(options.theme, firstChapterBeforeHook, variant);
  await writeFile(firstChapterPath, hookResult.content, "utf-8");

  const titles = generateShortStoryTitles({
    theme: options.theme,
    planMarkdown,
    firstChapterMarkdown: hookResult.content,
  });
  const titlesMarkdown = renderShortStoryTitlesMarkdown(options.theme, titles);
  await writeFile(titlesPath, titlesMarkdown, "utf-8");

  const publishPackage = createShortStoryPublishPackage({
    theme: options.theme,
    planMarkdown,
    titlesMarkdown,
    chapters: await Promise.all(drafts.map(async (draft) => {
      const fileName = `${String(draft.chapterNumber).padStart(3, "0")}.md`;
      return {
        chapterNumber: draft.chapterNumber,
        fileName,
        content: await readFile(join(chaptersDir, fileName), "utf-8"),
      };
    })),
  });
  await cleanShortStoryPublishDir(publishDir);
  for (const chapter of publishPackage.chapters) {
    await writeFile(join(publishDir, chapter.fileName), chapter.content, "utf-8");
  }
  await writeFile(join(publishDir, "book.txt"), publishPackage.bookText, "utf-8");

  const script = renderShortStoryVideoScript(generateShortStoryVideoScript({
    theme: options.theme,
    firstChapterMarkdown: hookResult.content,
  }));
  await mkdir(scriptsDir, { recursive: true });
  await writeFile(scriptPath, script, "utf-8");

  return {
    chapterCount: drafts.length,
    firstChapter: drafts[0]?.content ?? "",
    warnings: writerCheck.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message),
  };
}

async function cleanShortStoryPublishDir(publishDir: string): Promise<void> {
  await mkdir(publishDir, { recursive: true });
  const existingFiles = await readdir(publishDir);
  await Promise.all(existingFiles
    .filter((fileName) => fileName.endsWith(".md") || fileName === "book.txt")
    .map((fileName) => rm(join(publishDir, fileName), { force: true })));
}

async function resolveShortStoryExportDir(storyRoot: string): Promise<string> {
  if (await hasShortStoryMarkdownChapters(join(storyRoot, "chapters"))) {
    return storyRoot;
  }

  const entries = await readdir(storyRoot, { withFileTypes: true }).catch(() => []);
  const runDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
    .map((entry) => join(storyRoot, entry.name))
    .sort((a, b) => b.localeCompare(a, "zh-Hans-CN"));

  for (const runDir of runDirs) {
    if (await hasShortStoryMarkdownChapters(join(runDir, "chapters"))) {
      return runDir;
    }
  }

  return storyRoot;
}

async function hasShortStoryMarkdownChapters(chaptersDir: string): Promise<boolean> {
  const files = await readdir(chaptersDir).catch(() => []);
  return files.some((fileName) => fileName.endsWith(".md"));
}
