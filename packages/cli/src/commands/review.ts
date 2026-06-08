import { Command } from "commander";
import {
  StateManager,
  chapterNumberPrefix,
  chatCompletion,
  buildLengthSpec,
  createLLMClient,
  countChapterLength,
  formatLengthCount,
  isApiKeyOptionalForEndpoint,
  LLMConfigSchema,
  readGenreProfile,
  readStructureSignals,
  writeStructureSignals,
  matchStructureSignals,
  STRUCTURE_SIGNAL_DIMENSIONS,
  inspectStructureSignals,
  validateStructureSignalsFull,
  appendStructureSignal,
  parseChapterScopeBoundaries,
  evaluateChapterScopeGate,
  buildChapterScopeConstraintBlock,
  buildStructureSignalsScopeConstraint,
  buildChapterRepairBoundaryBlock,
  type StructureSignals,
  type StructureSignalsReadResult,
  type InspectStructureSignalsResult,
  type ChapterScopeGateResult,
  renderContinuityMarkdown,
  renderFanqieQualityMarkdown,
  buildNumericExpressionGuidance,
  runFanqieQualityCheck,
  resolveLengthCountingMode,
  readBookNumericExpressionMode,
  runLocalFanqieQualityCheck,
  runLocalChapterContinuityCheck,
  runChapterContinuityCheck,
  runChapterContinuityFix,
  type ContinuityReport,
  type FanqieFinalQualityStatus,
  type FanqieQualityReport,
  type StoryEffectivenessReport,
  StoryEffectivenessAgent,
  writeStoryEffectivenessReportFiles,
  type Golden3ChapterReport,
  readOpeningHookSummary,
  OpeningHookReviewerAgent,
  writeOpeningHookReportFiles,
  readAntagonistIntelligenceSummary,
  AntagonistIntelligenceReviewerAgent,
  writeAntagonistIntelligenceReportFiles,
  readTransitionQualitySummary,
  TransitionQualityReviewerAgent,
  writeTransitionQualityReportFiles,
  readSixStepPlotSummary,
  SixStepPlotReviewerAgent,
  writeSixStepPlotReportFiles,
  type AgentContext,
  PipelineRunner,
} from "@actalk/inkos-core";
import { existsSync, readdirSync, type Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createClient, findProjectRoot, loadConfig, resolveBookId, log, logError, loadReviewPresentation, GLOBAL_ENV_PATH, buildPipelineConfig } from "../utils.js";

const DUMMY_CTX = {} as unknown as AgentContext;
const DEFAULT_STRUCTURE_PASS_THRESHOLD = 85;
const DEFAULT_STRUCTURE_ACCEPT_THRESHOLD = 70;

export const reviewCommand = new Command("review")
  .description("Review and approve chapters");

reviewCommand
  .command("fanqie-quality")
  .description("Check Fanqie-style chapter quality before publishing")
  .requiredOption("--book <book-id>", "Book ID")
  .option("--chapter <number>", "Single chapter number")
  .option("--from <number>", "First chapter number in range")
  .option("--to <number>", "Last chapter number in range")
  .option("--next-outline <text>", "Optional next chapter outline")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(false);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const results: FanqieQualityCommandResult[] = [];

      for (let chapter = range.from; chapter <= range.to; chapter += 1) {
        const result = await checkFanqieQualityChapter({
          bookId: book.id,
          bookDir: book.dir,
          chapter,
          client: runtime?.client,
          model: runtime?.model,
          nextOutline: opts.nextOutline,
        });
        results.push(result);

        if (!opts.json) {
          log("[fanqie-quality]");
          log(`chapter: ${chapterNumberPrefix(chapter)}`);
          log(`body: ${relative(book.dir, result.sourceFile)}`);
          log(`body_source: ${result.bodySource}`);
          log(`continuity: ${result.report.continuity_final_status ?? "unknown"}`);
          if (result.report.publish_blocked_by_continuity) {
            log("warning: Blocked by continuity; quality report is informational only.");
            log("publish_blocked_by_continuity: true");
          }
          log(`score: ${result.report.quality_score}`);
          log(`status: ${result.report.status}`);
          if (result.report.issues.length) {
            log("main issues:");
            for (const issue of result.report.issues.slice(0, 3)) {
              log(`- ${issue.detail || issue.type}`);
            }
          }
          log(`report: ${result.reportJsonPath}`);
        }
      }

      if (range.to > range.from) {
        const summaryPath = await writeFanqieQualitySummary(book.dir, results);
        if (!opts.json) log(`summary: ${summaryPath}`);
      }

      if (opts.json) log(JSON.stringify({ bookId: book.id, results }, null, 2));
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Fanqie quality check failed: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("fanqie-polish")
  .description("Polish chapters below Fanqie quality score 85 and re-check quality")
  .requiredOption("--book <book-id>", "Book ID")
  .option("--chapter <number>", "Single chapter number")
  .option("--from <number>", "First chapter number in range")
  .option("--to <number>", "Last chapter number in range")
  .option("--max-polish-attempts <number>", "Maximum polish attempts", "2")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(true);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxPolishAttempts = parsePositiveInt(opts.maxPolishAttempts, "--max-polish-attempts");
      const results: FanqiePolishCommandResult[] = [];

      for (let chapter = range.from; chapter <= range.to; chapter += 1) {
        if (!opts.json) {
          log("[fanqie-polish]");
          log(`chapter: ${chapterNumberPrefix(chapter)}`);
        }
        const result = await polishFanqieQualityChapter({
          bookId: book.id,
          bookDir: book.dir,
          chapter,
          client: runtime.client!,
          model: runtime.model!,
          maxPolishAttempts,
          json: Boolean(opts.json),
        });
        results.push(result);
        if (!opts.json) {
          if (result.blockedByContinuity) {
            if (result.inputFile) log(`input body: ${relative(book.dir, result.inputFile)}`);
            log("Blocked by continuity. Run continuity-auto first.");
          } else if (result.initialScore >= 85) {
            if (result.inputFile) log(`input body: ${relative(book.dir, result.inputFile)}`);
            log(`score: ${result.initialScore}`);
            log("result: already QUALITY_PASS");
          } else {
            if (result.inputFile) log(`input body: ${relative(book.dir, result.inputFile)}`);
            log(`result: ${result.finalQualityStatus}`);
          }
          log(`report: ${result.finalReportJsonPath}`);
        }
      }

      if (range.to > range.from) {
        const summaryPath = await writeFanqiePolishSummary(book.dir, results);
        if (!opts.json) log(`summary: ${summaryPath}`);
      }

      if (opts.json) log(JSON.stringify({ bookId: book.id, results }, null, 2));
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Fanqie polish failed: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("quality-auto-fix")
  .description("Target-fix chapters blocked by Fanqie quality after polish")
  .requiredOption("--book <book-id>", "Book ID")
  .option("--chapter <number>", "Single chapter number")
  .option("--from <number>", "First chapter number in range")
  .option("--to <number>", "Last chapter number in range")
  .option("--max-quality-fix-attempts <number>", "Maximum targeted quality fix attempts", "1")
  .option("--quality-fix-threshold <number>", "Minimum quality score for targeted fix", "75")
  .option("--quality-pass-threshold <number>", "Ideal quality score threshold", "85")
  .option("--quality-accept-threshold <number>", "Minimum accepted quality score threshold", "75")
  .option("--structure-pass-threshold <number>", "Ideal publish-ready structure score threshold", String(DEFAULT_STRUCTURE_PASS_THRESHOLD))
  .option("--structure-accept-threshold <number>", "Minimum accepted publish-ready structure score threshold", String(DEFAULT_STRUCTURE_ACCEPT_THRESHOLD))
  .option("--min-chapter-words <number>", "Minimum effective chapter word count", "1000")
  .option("--max-fix-attempts <number>", "Maximum continuity fix attempts after targeted fix", "1")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(true);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxQualityFixAttempts = parsePositiveInt(opts.maxQualityFixAttempts, "--max-quality-fix-attempts");
      const qualityFixThreshold = parsePositiveInt(opts.qualityFixThreshold, "--quality-fix-threshold");
      const qualityPassThreshold = parsePositiveInt(opts.qualityPassThreshold, "--quality-pass-threshold");
      const qualityAcceptThreshold = parsePositiveInt(opts.qualityAcceptThreshold, "--quality-accept-threshold");
      const structurePassThreshold = parsePositiveInt(opts.structurePassThreshold, "--structure-pass-threshold");
      const structureAcceptThreshold = parsePositiveInt(opts.structureAcceptThreshold, "--structure-accept-threshold");
      const minChapterWords = parsePositiveInt(opts.minChapterWords, "--min-chapter-words");
      if (structureAcceptThreshold > structurePassThreshold) {
        throw new Error("--structure-accept-threshold must be <= --structure-pass-threshold");
      }
      const maxFixAttempts = parseNonNegativeInt(opts.maxFixAttempts, "--max-fix-attempts");
      const results: QualityAutoFixResult[] = [];

      for (let chapter = range.from; chapter <= range.to; chapter += 1) {
        if (!opts.json) {
          log("[quality-auto-fix]");
          log(`chapter: ${chapterNumberPrefix(chapter)}`);
        }
        const result = await runQualityAutoFixChapter({
          root,
          bookId: book.id,
          bookDir: book.dir,
          chapter,
          client: runtime.client!,
          model: runtime.model!,
          maxQualityFixAttempts,
          qualityFixThreshold,
          qualityPassThreshold,
          qualityAcceptThreshold,
          minChapterWords,
          targetChapterWords: book.chapterWordCount ?? 3000,
          language: book.language ?? "zh",
          maxFixAttempts,
          json: Boolean(opts.json),
        });
        results.push(result);
        if (!opts.json) {
          if (result.input_file) log(`input: ${result.input_file}`);
          if (result.output_file) log(`output: ${result.output_file}`);
          log(`result: ${result.publish_status}`);
          if (!isExportablePublishStatus(result.publish_status)) {
            log(`Chapter ${chapterNumberPrefix(chapter)} still blocked by quality after targeted fix.`);
          }
        }
      }

      if (opts.json) log(JSON.stringify({ bookId: book.id, results }, null, 2));
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Quality auto-fix failed: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("plot-auto-fix")
  .description("Target-fix chapters blocked by publish-ready six-step plot structure")
  .requiredOption("--book <book-id>", "Book ID")
  .option("--chapter <number>", "Single chapter number")
  .option("--from <number>", "First chapter number in range")
  .option("--to <number>", "Last chapter number in range")
  .option("--max-plot-fix-attempts <number>", "Maximum targeted plot fix attempts", "1")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(true);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxPlotFixAttempts = parsePositiveInt(opts.maxPlotFixAttempts, "--max-plot-fix-attempts");
      const results: PlotAutoFixResult[] = [];

      for (let chapter = range.from; chapter <= range.to; chapter += 1) {
        if (!opts.json) {
          log("[plot-auto-fix]");
          log(`chapter: ${chapterNumberPrefix(chapter)}`);
        }
        const result = await runPlotAutoFixChapter({
          bookId: book.id,
          bookDir: book.dir,
          chapter,
          client: runtime.client!,
          model: runtime.model!,
          maxPlotFixAttempts,
          json: Boolean(opts.json),
        });
        results.push(result);
        if (!opts.json) {
          if (result.input_file) log(`input: ${result.input_file}`);
          if (result.output_file) log(`output: ${result.output_file}`);
          if (result.final_candidate_file) log(`final: ${result.final_candidate_file}`);
          log(`result: ${result.status}`);
          if (result.skipped_reason) log(`reason: ${result.skipped_reason}`);
          log("");
          log("next:");
          log(`node packages/cli/dist/index.js review publish-ready --book ${book.id} --chapter ${chapter}`);
        }
      }

      if (opts.json) log(JSON.stringify({ bookId: book.id, results }, null, 2));
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Plot auto-fix failed: ${e}`);
      process.exit(1);
    }
  });

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
      const maxFixAttempts = parseNonNegativeInt(opts.maxFixAttempts, "--max-fix-attempts");
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
  .option("--min-chapter-words <number>", "Minimum effective chapter word count", "1000")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(false);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxFixAttempts = parseNonNegativeInt(opts.maxFixAttempts, "--max-fix-attempts");
      const minChapterWords = parsePositiveInt(opts.minChapterWords, "--min-chapter-words");
      const results: ContinuityAutoResult[] = [];
      const isBatchMode = Boolean(!opts.chapter && opts.from && opts.to);
      let batchStopped: ContinuityBatchStop | undefined;

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
        let salvage: ContinuitySalvageResult | undefined;
        let currentChapterOverride: string | undefined;
        const reportDir = join(book.dir, "reviews", "continuity");
        const prefix = chapterNumberPrefix(chapter);
        if (!opts.json) {
          const currentPreview = await resolveReviewedChapterForContinuity(book.dir, chapter);
          const prevPreview = await resolveReviewedChapterForContinuity(book.dir, chapter - 1);
          log(`current body: ${relative(book.dir, currentPreview.file)}`);
          log(`prev body: ${relative(book.dir, prevPreview.file)}`);
          for (const warning of [...(prevPreview.warnings ?? []), ...(currentPreview.warnings ?? [])]) {
            log(`warning: ${warning}`);
          }
        }

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
            minChapterWords,
          });
          initial ??= current;
          score = current.report.score;
          if (!opts.json) {
            log(`score: ${current.report.score}`);
            log(`word_count: ${current.report.word_count}/${current.report.min_chapter_words}`);
            log(`length_status: ${current.report.length_status}`);
          }

          if (isContinuityPublishPass(current.report)) {
            if (!opts.json && attempt > 0) {
              log(`attempt ${attempt}/${maxFixAttempts} -> score: ${score}, word_count: ${current.report.word_count}`);
            } else if (!opts.json && attempt === 0 && current.fromExistingPass) {
              log("existing reviewed PASS version confirmed");
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
            const action = current.report.length_status === "TOO_SHORT" ? "expanding" : "fixing";
            log(`result: NEED_FIX${current.report.length_status === "TOO_SHORT" ? " (too short)" : ""}`);
            log(`attempt ${nextAttempt}/${maxFixAttempts} -> ${action}...`);
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

        const initialPassed = isContinuityPublishPass(initial.report) || initial.report.rewrite_mode === "none" && initial.report.length_status === "PASS";
        let finalStatus = isContinuityPublishPass(current.report) ? "PASS" : "MANUAL_REVIEW";
        let finalReport = current.report;
        if (finalStatus === "PASS") {
          const decisionSource = current.fromExistingPass && attempt === 0
            ? "reviewed_existing"
            : initialPassed && attempt === 0
              ? "initial_check"
              : "fix_attempt";
          finalReport = makeContinuityDecisionReport(current.report, {
            finalStatus: "PASS",
            decisionSource,
            usedFile: relative(book.dir, current.sourceFile),
            bodySource: current.bodySource,
            fixAttempt: attempt,
            maxFixAttempts,
            staleReportsIgnored: initialPassed && attempt === 0
              ? await staleContinuityReportsForInitialPass(reportDir, prefix)
              : [],
          });
          await writeContinuityReportFiles(
            finalReport,
            join(reportDir, `${prefix}.final-report.json`),
            join(reportDir, `${prefix}.final-report.md`),
            chapter,
            current.chapterTitle,
          );
          if (!opts.json) {
            log(`initial check: ${initialPassed ? "PASS" : "NEED_FIX"}`);
          }
        } else {
          finalReport = markManualReview(finalReport, "", {
            decisionSource: "fix_attempt_limit",
            usedFile: relative(book.dir, current.sourceFile),
            bodySource: current.bodySource,
            fixAttempt: attempt,
            maxFixAttempts,
          });
          const formalCurrentFinalReport = markManualReview(initial.report, "", {
            decisionSource: "current_body_check",
            usedFile: relative(book.dir, initial.sourceFile),
            bodySource: initial.bodySource,
            fixAttempt: initial.report.fix_attempt ?? 0,
            maxFixAttempts,
          });
          await writeContinuityReportFiles(
            finalReport,
            join(reportDir, `${prefix}.final-report.json`),
            join(reportDir, `${prefix}.final-report.md`),
            chapter,
            current.chapterTitle,
          );
          if (!opts.json) {
            log(`initial check: ${initialPassed ? "PASS" : "NEED_FIX"}`);
            log("warning: Chapter failed to reach PASS after max attempts. Manual review required.");
          }

          if (runtime?.client && runtime.model) {
            if (!opts.json) {
              log("");
              log("[auto-salvage]");
            }
            salvage = await runContinuitySalvage({
              bookDir: book.dir,
              chapter,
              client: runtime.client,
              model: runtime.model,
              issues: finalReport.issues,
              maxFixAttempts,
              minChapterWords,
            });

            const salvageScore = salvage.report?.report.score ?? 0;
            if (!opts.json) {
              log(`rewrite -> score: ${salvageScore}`);
            }

            if (salvage.report && isContinuityPublishPass(salvage.report.report)) {
              finalStatus = "PASS";
              finalReport = makeContinuityDecisionReport({
                ...salvage.report.report,
                rewrite_strategy: "salvage_rewrite",
                summary: `${salvage.report.report.summary}\n\nsalvage_rewrite accepted as final chapter candidate.`,
              }, {
                finalStatus: "PASS",
                decisionSource: "salvage",
                usedFile: relative(book.dir, salvage.salvageChapterPath),
                bodySource: "salvaged",
                fixAttempt: salvage.report.report.fix_attempt,
                maxFixAttempts,
              });
              await writeContinuityReportFiles(
                finalReport,
                join(reportDir, `${prefix}.final-report.json`),
                join(reportDir, `${prefix}.final-report.md`),
                chapter,
                salvage.report.chapterTitle,
              );
              if (!opts.json) log("final result: PASS (salvaged)");
            } else if (salvage.report && salvageScore >= 70) {
              const lightFixed = await runSalvageLightFix({
                bookDir: book.dir,
                chapter,
                client: runtime.client,
                model: runtime.model,
                reportJsonPath: salvage.report.reportJsonPath,
                maxFixAttempts,
              });
              salvage = { ...salvage, lightFixChapterPath: lightFixed.fixedChapterPath };
              const afterLightFix = await checkContinuityChapter({
                root,
                bookId: book.id,
                bookDir: book.dir,
                chapter,
                client: runtime.client,
                model: runtime.model,
                final: true,
                reportKind: "final-report",
                currentOverridePath: lightFixed.fixedChapterPath,
                fixAttempt: maxFixAttempts,
                maxFixAttempts,
                minChapterWords,
              });
              salvage = { ...salvage, finalReport: afterLightFix };
              if (isContinuityPublishPass(afterLightFix.report)) {
                finalStatus = "PASS";
                finalReport = makeContinuityDecisionReport({ ...afterLightFix.report, rewrite_strategy: "salvage_rewrite" }, {
                  finalStatus: "PASS",
                  decisionSource: "salvage",
                  usedFile: relative(book.dir, lightFixed.fixedChapterPath),
                  bodySource: "salvaged",
                  fixAttempt: afterLightFix.report.fix_attempt,
                  maxFixAttempts,
                });
                await writeContinuityReportFiles(finalReport, afterLightFix.reportJsonPath, afterLightFix.reportMarkdownPath, chapter, afterLightFix.chapterTitle);
                if (!opts.json) log("final result: PASS (salvaged)");
              } else {
                finalStatus = "MANUAL_REVIEW";
                finalReport = retainNonSalvageFinalAfterSalvageFailure(
                  formalCurrentFinalReport,
                  "auto-salvage plus light_fix did not produce a PASS candidate; retained the formal current-body continuity diagnosis.",
                );
                await writeContinuityReportFiles(
                  finalReport,
                  join(reportDir, `${prefix}.final-report.json`),
                  join(reportDir, `${prefix}.final-report.md`),
                  chapter,
                  initial.chapterTitle,
                );
                if (!opts.json) log("final result: MANUAL_REVIEW (salvage rejected)");
              }
            } else {
              finalStatus = "MANUAL_REVIEW";
              finalReport = retainNonSalvageFinalAfterSalvageFailure(
                formalCurrentFinalReport,
                "auto-salvage failed below usable score; retained the formal current-body continuity diagnosis.",
              );
              await writeContinuityReportFiles(
                finalReport,
                join(reportDir, `${prefix}.final-report.json`),
                join(reportDir, `${prefix}.final-report.md`),
                chapter,
                initial.chapterTitle,
              );
              if (!opts.json) log("final result: MANUAL_REVIEW (salvage rejected)");
            }
          } else if (!opts.json) {
            log("warning: auto-salvage skipped because LLM config is unavailable.");
          }
        }

        if (!opts.json) {
          log(`result: ${finalReport.final_status}`);
        }

        results.push({
          chapter,
          initial,
          fixed,
          salvage,
          final: { ...current, report: finalReport },
          finalStatus,
        });

        if (isBatchMode && finalReport.final_status === "DROP") {
          batchStopped = {
            chapter,
            message: `Chapter ${chapterNumberPrefix(chapter)} is DROP. Batch stopped to avoid continuity pollution.`,
            instruction: `Run continuity-fix --mode rewrite or manually rewrite chapter ${chapterNumberPrefix(chapter)}, then resume from chapter ${chapter + 1}.`,
          };
          if (!opts.json) {
            log(batchStopped.message);
            log(batchStopped.instruction);
          }
          break;
        }
      }

      if (opts.json) log(JSON.stringify({ bookId: book.id, results, batchStopped }, null, 2));
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
  .command("publish-ready")
  .description("Run a closed publish-readiness loop for chapters")
  .requiredOption("--book <book-id>", "Book ID")
  .option("--chapter <number>", "Single chapter number")
  .option("--from <number>", "First chapter number in range")
  .option("--to <number>", "Last chapter number in range")
  .option("--max-fix-attempts <number>", "Maximum continuity fix attempts", "2")
  .option("--max-polish-attempts <number>", "Maximum polish attempts", "2")
  .option("--max-quality-fix-attempts <number>", "Maximum targeted quality fix attempts", "1")
  .option("--max-plot-fix-attempts <number>", "Maximum targeted publish-ready plot fix attempts", "0")
  .option("--quality-fix-threshold <number>", "Minimum quality score for targeted fix", "75")
  .option("--quality-pass-threshold <number>", "Ideal quality score threshold", "85")
  .option("--quality-accept-threshold <number>", "Minimum accepted quality score threshold", "75")
  .option("--structure-pass-threshold <number>", "Ideal publish-ready structure score threshold", String(DEFAULT_STRUCTURE_PASS_THRESHOLD))
  .option("--structure-accept-threshold <number>", "Minimum accepted publish-ready structure score threshold", String(DEFAULT_STRUCTURE_ACCEPT_THRESHOLD))
  .option("--min-chapter-words <number>", "Minimum effective chapter word count", "1000")
  .option("--accept-manual-continuity", "Allow explicit publish-ready processing for MANUAL_REVIEW continuity")
  .option("--continuity-override-pass", "Trust a PASS final continuity report and skip repeated continuity recheck")
  .option("--json", "Output JSON")
  .option("--reset", "Reset chapter review progress, delete existing reports and force re-evaluation")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(false);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxFixAttempts = parseNonNegativeInt(opts.maxFixAttempts, "--max-fix-attempts");
      const maxPolishAttempts = parsePositiveInt(opts.maxPolishAttempts, "--max-polish-attempts");
      const maxQualityFixAttempts = parseNonNegativeInt(opts.maxQualityFixAttempts, "--max-quality-fix-attempts");
      const maxPlotFixAttempts = parseNonNegativeInt(opts.maxPlotFixAttempts, "--max-plot-fix-attempts");
      const qualityFixThreshold = parsePositiveInt(opts.qualityFixThreshold, "--quality-fix-threshold");
      const qualityPassThreshold = parsePositiveInt(opts.qualityPassThreshold, "--quality-pass-threshold");
      const qualityAcceptThreshold = parsePositiveInt(opts.qualityAcceptThreshold, "--quality-accept-threshold");
      const structurePassThreshold = parsePositiveInt(opts.structurePassThreshold, "--structure-pass-threshold");
      const structureAcceptThreshold = parsePositiveInt(opts.structureAcceptThreshold, "--structure-accept-threshold");
      const minChapterWords = parsePositiveInt(opts.minChapterWords, "--min-chapter-words");
      const reset = Boolean(opts.reset);
      if (structureAcceptThreshold > structurePassThreshold) {
        throw new Error("--structure-accept-threshold must be <= --structure-pass-threshold");
      }
      const results: PublishReadyResult[] = [];
      const isBatchMode = Boolean(!opts.chapter && opts.from && opts.to);

      for (let chapter = range.from; chapter <= range.to; chapter += 1) {
        if (!opts.json) {
          log("[publish-ready]");
          log(`chapter: ${chapterNumberPrefix(chapter)}`);
        }
        const result = await runPublishReadyChapter({
          root,
          bookId: book.id,
          bookDir: book.dir,
          chapter,
          client: runtime.client,
          model: runtime.model,
          maxFixAttempts,
          maxPolishAttempts,
          maxQualityFixAttempts,
          maxPlotFixAttempts,
          qualityFixThreshold,
          qualityPassThreshold,
          qualityAcceptThreshold,
          structurePassThreshold,
          structureAcceptThreshold,
          minChapterWords,
          targetChapterWords: book.chapterWordCount ?? 3000,
          language: book.language ?? "zh",
          acceptManualContinuity: Boolean(opts.acceptManualContinuity),
          continuityOverridePass: Boolean(opts.continuityOverridePass),
          json: Boolean(opts.json),
          reset,
        });
        results.push(result);

        if (!opts.json) {
          log("");
          log("result:");
          log(result.publish_status);
          if (result.final_candidate_file) log(`final file: ${result.final_candidate_file}`);
          const structureLines = renderPublishReadyStructureConsole(result);
          if (structureLines.length) {
            log("");
            log("structure:");
            for (const line of structureLines) log(line);
          }
          log(`report: ${result.report_json_path}`);
          log("");
          if (isExportablePublishStatus(result.publish_status)) {
            const chapterStatus = await readChapterIndexStatus(book.dir, chapter);
            log("next:");
            log(`node scripts/fanqie/export-fanqie.mjs ${book.id} --from ${chapter} --to ${chapter} --use-reviewed --dry-run`);
            if (chapterStatus !== "approved") {
              log(`如果 dry-run 通过：node packages/cli/dist/index.js review approve ${book.id} ${chapter}`);
            }
            log(`正式导出：node scripts/fanqie/export-fanqie.mjs ${book.id} --from ${chapter} --to ${chapter} --use-reviewed`);
            if (result.publish_status === "READY_WITH_WARNINGS") {
              log(`可选诊断：node packages/cli/dist/index.js review diagnose --book ${book.id} --chapter ${chapter}`);
            }
          } else {
            if (result.publish_status === "MANUAL_REVIEW" && hasPublishReadyStructureBlocker(result) && maxPlotFixAttempts === 0) {
              const reasons = publishReadyStructureBlockerSummaries(result);
              log(`blocked: publish-ready structural review`);
              if (reasons.length) log(`reason: ${reasons[0]}`);
              log("");
              log("next:");
              log(`node packages/cli/dist/index.js review publish-ready --book ${book.id} --chapter ${chapter} --max-plot-fix-attempts 1`);
              log("");
            }
            log("diagnose:");
            log(`node packages/cli/dist/index.js review diagnose --book ${book.id} --chapter ${chapter}`);
          }
        }

        if (isBatchMode && !isExportablePublishStatus(result.publish_status)) {
          const message = `Chapter ${chapterNumberPrefix(chapter)} is ${result.publish_status}. Batch stopped to avoid downstream pollution.`;
          const instruction = `Fix chapter ${chapterNumberPrefix(chapter)}, then resume from chapter ${chapter + 1}.`;
          if (!opts.json) {
            log(message);
            log(instruction);
          }
          break;
        }
      }

      if (opts.json) log(JSON.stringify({ bookId: book.id, results }, null, 2));
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Publish-ready failed: ${e}`);
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
  readonly chapterWordCount?: number;
  readonly language?: "zh" | "en";
}

interface ContinuityChapterFile {
  readonly file: string;
  readonly title: string;
  readonly bodySource?: ContinuityBodySource;
  readonly decisionSource?: string;
  readonly fromExistingPass?: boolean;
  readonly warnings?: ReadonlyArray<string>;
}

interface ContinuityCommandResult {
  readonly chapter: number;
  readonly chapterTitle: string;
  readonly sourceFile: string;
  readonly prevSourceFile: string;
  readonly bodySource: ContinuityBodySource;
  readonly fromExistingPass: boolean;
  readonly reportedWarnings: ReadonlyArray<string>;
  readonly report: ContinuityReport;
  readonly reportJsonPath: string;
  readonly reportMarkdownPath: string;
}

interface FanqieQualityCommandResult {
  readonly chapter: number;
  readonly chapterTitle: string;
  readonly sourceFile: string;
  readonly bodySource: ContinuityBodySource;
  readonly sourceDecision: string;
  readonly continuityFinalStatus?: "PASS" | "MANUAL_REVIEW" | "DROP";
  readonly report: FanqieQualityReport;
  readonly reportJsonPath: string;
  readonly reportMarkdownPath: string;
}

interface FanqiePolishCommandResult {
  readonly chapter: number;
  readonly initialScore: number;
  readonly finalScore: number;
  readonly finalQualityStatus: FanqieFinalQualityStatus;
  readonly attempts: number;
  readonly inputFile: string;
  readonly usedPolishedFile: string;
  readonly finalReportJsonPath: string;
  readonly finalReportMarkdownPath: string;
  readonly blockedByContinuity: boolean;
  readonly blockedByLength?: boolean;
}

interface ContinuityFixResult {
  readonly chapter: number;
  readonly fixedChapterPath: string;
  readonly attempt?: number;
  readonly skippedReason?: string;
}

interface ContinuitySalvageResult {
  readonly chapter: number;
  readonly salvageChapterPath: string;
  readonly lightFixChapterPath?: string;
  readonly report?: ContinuityCommandResult;
  readonly finalReport?: ContinuityCommandResult;
}

interface ContinuityAutoResult {
  readonly chapter: number;
  readonly initial: ContinuityCommandResult;
  readonly fixed?: ContinuityFixResult;
  readonly salvage?: ContinuitySalvageResult;
  readonly final?: ContinuityCommandResult;
  readonly finalStatus: string;
}

interface ContinuityBatchStop {
  readonly chapter: number;
  readonly message: string;
  readonly instruction: string;
}

type ContinuityBodySource = "fixed" | "salvaged" | "polished" | "original";

type PublishReadyStatus = "READY_TO_EXPORT" | "READY_WITH_WARNINGS" | "BLOCKED_BY_CONTINUITY" | "BLOCKED_BY_QUALITY" | "BLOCKED_BY_LENGTH" | "BLOCKED_BY_SCOPE" | "BLOCKED_BY_RESOURCE" | "QUALITY_MANUAL_REVIEW" | "NEED_REWRITE" | "MANUAL_REVIEW" | "BLOCKED_BY_AUDIT" | "BLOCKED_BY_STATE" | "BLOCKED_BY_PLANNING";
export type PublishQualityDecision = "QUALITY_PASS" | "QUALITY_WARN_POLISH_OPTIONAL" | "QUALITY_MANUAL_REVIEW" | "NEED_REWRITE";

type PublishReadyLengthStatus = "PASS" | "WARN" | "FAIL";

interface PublishReadyLengthGate {
  readonly status: PublishReadyLengthStatus;
  readonly count: number;
  readonly target: number;
  readonly soft_min: number;
  readonly soft_max: number;
  readonly hard_min: number;
  readonly hard_max: number;
  readonly counting_mode: string;
  readonly summary: string;
}

interface ReviewedChapterSource {
  readonly path: string;
  readonly title: string;
  readonly body_source: ContinuityBodySource;
  readonly decision_source: string;
  readonly continuity_final_status?: "PASS" | "MANUAL_REVIEW" | "DROP";
  readonly quality_final_status?: FanqieFinalQualityStatus;
  readonly publish_blocked_by_continuity: boolean;
  readonly warnings?: ReadonlyArray<string>;
}

interface PublishReadyResult {
  readonly book: string;
  readonly chapter_index: number;
  readonly publish_status: PublishReadyStatus;
  readonly final_candidate_file: string;
  readonly source_chain: ReadonlyArray<string>;
  readonly continuity: {
    readonly final_status?: string;
    readonly score?: number;
  };
  readonly quality: {
    readonly final_quality_status?: string;
    readonly score?: number;
  };
  readonly quality_decision?: PublishQualityDecision;
  readonly quality_score?: number;
  readonly quality_pass_threshold?: number;
  readonly quality_accept_threshold?: number;
  readonly structure_pass_threshold?: number;
  readonly structure_accept_threshold?: number;
  readonly accepted_reason?: string;
  readonly warnings?: ReadonlyArray<string>;
  readonly manualContinuityAccepted?: boolean;
  readonly manualContinuityAcceptedReason?: string;
  readonly continuityStatusBeforeManualAccept?: string;
  readonly continuityScoreBeforeManualAccept?: number;
  readonly acceptedContinuityFile?: string;
  readonly continuityOverride?: "PASS";
  readonly continuityOverrideReason?: string;
  readonly reviewedFinalExists?: boolean;
  readonly source_file?: string;
  readonly word_count?: number;
  readonly min_chapter_words: number;
  readonly target_chapter_words?: number;
  readonly max_chapter_words?: number;
  readonly length_gate?: PublishReadyLengthGate;
  readonly scope_gate?: ChapterScopeGateResult;
  readonly report_json_path: string;
  readonly report_markdown_path: string;
  readonly story_effectiveness?: {
    readonly status: string;
    readonly score: number | null;
    readonly summary: string;
  };
  readonly golden_3_chapter?: {
    readonly status: string;
    readonly score: number | null;
    readonly summary: string;
  };
  readonly opening_hook?: {
    readonly status: string;
    readonly score: number | null;
    readonly summary: string;
  };
  readonly antagonist_intelligence?: {
    readonly status: string;
    readonly score: number | null;
    readonly summary: string;
  };
  readonly transition_quality?: {
    readonly status: string;
    readonly score: number | null;
    readonly summary: string;
  };
  readonly six_step_plot?: {
    readonly status: string;
    readonly score: number | null;
    readonly summary: string;
  };
  readonly structure_signals_source?: string;
  readonly structure_signals_error?: string;
  readonly structure_signals_matched?: number;
  readonly structure_signals_missing?: number;
  readonly structure_signals_dimensions?: number;
  readonly structure_signals_dimension_details?: readonly { dimension: string; matched: number; missing: number }[];
}

interface PublishReadyManualContinuityAcceptance {
  readonly manualContinuityAccepted: true;
  readonly manualContinuityAcceptedReason: string;
  readonly continuityStatusBeforeManualAccept: string;
  readonly continuityScoreBeforeManualAccept?: number;
  readonly acceptedContinuityFile: string;
  readonly reviewedFinalExists: boolean;
}

interface QualityAutoFixResult {
  readonly book: string;
  readonly chapter_index: number;
  readonly publish_status: PublishReadyStatus;
  readonly input_file: string;
  readonly output_file: string;
  readonly quality_score_before?: number;
  readonly quality_score_after?: number;
  readonly continuity_score_after?: number;
  readonly final_candidate_file: string;
  readonly report_json_path: string;
  readonly report_markdown_path: string;
  readonly skipped_reason?: string;
}

interface PlotAutoFixResult {
  readonly book: string;
  readonly chapter_index: number;
  readonly status: "FIXED" | "SKIPPED";
  readonly input_file: string;
  readonly output_file: string;
  readonly final_candidate_file: string;
  readonly six_step_status_before?: string;
  readonly six_step_score_before?: number | null;
  readonly report_json_path: string;
  readonly report_markdown_path: string;
  readonly skipped_reason?: string;
}

async function runPublishReadyChapter(params: {
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client?: ReturnType<typeof createClient>;
  readonly model?: string;
  readonly maxFixAttempts: number;
  readonly maxPolishAttempts: number;
  readonly maxQualityFixAttempts: number;
  readonly maxPlotFixAttempts: number;
  readonly qualityFixThreshold: number;
  readonly qualityPassThreshold: number;
  readonly qualityAcceptThreshold: number;
  readonly structurePassThreshold: number;
  readonly structureAcceptThreshold: number;
  readonly minChapterWords: number;
  readonly targetChapterWords: number;
  readonly language: "zh" | "en";
  readonly acceptManualContinuity: boolean;
  readonly continuityOverridePass: boolean;
  readonly json: boolean;
  readonly reset?: boolean;
}): Promise<PublishReadyResult> {
  if (params.reset) {
    const prefix = chapterNumberPrefix(params.chapter);
    const deleteFilesWithPrefix = async (dir: string, filePrefix: string) => {
      if (!existsSync(dir)) return;
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (file.startsWith(filePrefix)) {
            const p = join(dir, file);
            if (existsSync(p)) {
              await unlink(p);
            }
          }
        }
      } catch (e) {
        // Ignore errors
      }
    };

    if (!params.json) {
      log(`[reset] clearing cached files for chapter ${prefix}...`);
    }

    // Delete intermediate chapter files
    await deleteFilesWithPrefix(join(params.bookDir, "chapters-reviewed"), `${prefix}_`);
    await deleteFilesWithPrefix(join(params.bookDir, "chapters-reviewed"), `${prefix}.`);
    await deleteFilesWithPrefix(join(params.bookDir, "chapters-fixed"), `${prefix}_`);
    await deleteFilesWithPrefix(join(params.bookDir, "chapters-polished"), `${prefix}_`);
    await deleteFilesWithPrefix(join(params.bookDir, "chapters-quality-fixed"), `${prefix}_`);
    await deleteFilesWithPrefix(join(params.bookDir, "chapters-plot-fixed"), `${prefix}_`);
    await deleteFilesWithPrefix(join(params.bookDir, "chapters-salvaged"), `${prefix}_`);

    // Delete review reports
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "publish-ready"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "continuity"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "fanqie-quality"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "six-step-plot"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "plot-auto-fix"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "antagonist-intelligence"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "clean-narrative"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "opening-hook"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "transition-quality"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "intent-alignment"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "story-effectiveness"), prefix);
    await deleteFilesWithPrefix(join(params.bookDir, "reviews", "resource-consistency"), prefix);
  }

  const first = await runPublishReadyChapterOnce(params);
  if (!shouldRunPublishReadyPlotAutoFix(first, params.maxPlotFixAttempts)) return first;

  if (!params.client || !params.model) {
    throw new Error("INKOS_LLM_API_KEY not set. Run 'inkos config set-global' or add it to project .env file.");
  }

  if (!params.json) {
    log("");
    log("structure precheck:");
    for (const line of renderPublishReadyStructureConsole(first)) log(line);
    log("source: existing publish-ready/final candidate precheck");
    log("");
    log("[plot-auto-fix]");
    const reasons = publishReadyStructureBlockerSummaries(first);
    log(`reason: ${reasons[0] ?? `publish_status=${first.publish_status}`}`);
  }

  // Backup the reviewed-final file before plot-auto-fix overwrites it.
  // plot-auto-fix calls writeReviewedFinalChapter which overwrites the polished
  // version with the plot-fixed version. If the recheck is worse, we need to
  // restore the original polished content.
  const reviewedFinalPath = join(params.bookDir, "chapters-reviewed", `${chapterNumberPrefix(params.chapter)}_final.md`);
  let reviewedFinalBackup: string | undefined;
  try {
    reviewedFinalBackup = await readFile(reviewedFinalPath, "utf-8");
  } catch {
    // File may not exist; that's fine.
  }

  const fixed = await runPlotAutoFixChapter({
    bookId: params.bookId,
    bookDir: params.bookDir,
    chapter: params.chapter,
    client: params.client,
    model: params.model,
    maxPlotFixAttempts: params.maxPlotFixAttempts,
    json: params.json,
    targetChapterWords: params.targetChapterWords,
    language: params.language,
  });
  if (!params.json) {
    if (fixed.input_file) log(`input: ${fixed.input_file}`);
    if (fixed.output_file) log(`output: ${fixed.output_file}`);
    if (fixed.final_candidate_file) log(`final: ${fixed.final_candidate_file}`);
    log(`status: ${fixed.status}`);
  }
  if (fixed.status !== "FIXED") return first;

  if (!params.json) {
    log("");
    log("plot recheck publish-ready:");
  }
  const recheck = await runPublishReadyChapterOnce(params, {
    preferReviewedFinal: true,
    skipAcceptedExistingCandidate: true,
  });

  // Compare recheck vs first round. If plot-fix caused continuity or quality
  // regression, roll back to the first round result and restore the reviewed-final file.
  const firstContinuityScore = first.continuity?.score ?? 0;
  const recheckContinuityScore = recheck.continuity?.score ?? 0;
  const firstQualityScore = first.quality?.score ?? 0;
  const recheckQualityScore = recheck.quality?.score ?? 0;
  const continuityRegressed = first.continuity?.final_status === "PASS" && recheck.continuity?.final_status !== "PASS";
  const scoreRegressed = recheckContinuityScore < firstContinuityScore && recheckQualityScore <= firstQualityScore;

  if (continuityRegressed || scoreRegressed) {
    if (!params.json) {
      log("");
      log("[plot-auto-fix rollback]");
      log(`reason: plot-fix caused regression (continuity ${firstContinuityScore}→${recheckContinuityScore}, quality ${firstQualityScore}→${recheckQualityScore})`);
      log("restoring pre-plot-fix result");
    }
    // Restore the backed-up reviewed-final file so the polished version is preserved.
    if (reviewedFinalBackup !== undefined) {
      await mkdir(join(params.bookDir, "chapters-reviewed"), { recursive: true });
      await writeFile(reviewedFinalPath, reviewedFinalBackup, "utf-8");
    }
    // Re-write the publish-ready report with the first-round result so the
    // on-disk report matches the returned value.
    await writePublishReadyReport(params.bookDir, first);
    return first;
  }

  return recheck;
}

function shouldRunPublishReadyPlotAutoFix(report: PublishReadyResult, maxPlotFixAttempts: number): boolean {
  return maxPlotFixAttempts > 0
    && report.publish_status === "MANUAL_REVIEW"
    && hasPublishReadyStructureBlocker(report)
    && Boolean(report.final_candidate_file);
}

function hasPublishReadyStructuralFailure(report: Partial<PublishReadyResult> | null): boolean {
  if (!report) return false;
  return report.story_effectiveness?.status === "FAIL_STRUCTURAL"
    || report.golden_3_chapter?.status === "FAIL_STRUCTURAL"
    || report.opening_hook?.status === "FAIL_STRUCTURAL"
    || report.antagonist_intelligence?.status === "FAIL_REPORT_ONLY"
    || report.transition_quality?.status === "FAIL_STRUCTURAL"
    || report.six_step_plot?.status === "FAIL_STRUCTURAL";
}

function hasPublishReadyStructureBlocker(report: Partial<PublishReadyResult> | null): boolean {
  return publishReadyStructureBlockerSummaries(report).length > 0;
}

function publishReadyStructureBlockerSummaries(report: Partial<PublishReadyResult> | null): string[] {
  if (!report) return [];
  const acceptThreshold = report.structure_accept_threshold ?? DEFAULT_STRUCTURE_ACCEPT_THRESHOLD;
  const items: Array<[string, { readonly status: string; readonly score: number | null; readonly summary: string } | undefined]> = [
    ["story_effectiveness", report.story_effectiveness],
    ["golden_3_chapter", report.golden_3_chapter],
    ["opening_hook", report.opening_hook],
    ["antagonist_intelligence", report.antagonist_intelligence],
    ["transition_quality", report.transition_quality],
    ["six_step_plot", report.six_step_plot],
  ];
  return items
    .filter(([, item]) =>
      item?.status === "FAIL_STRUCTURAL"
      || item?.status === "FAIL_REPORT_ONLY"
      || typeof item?.score === "number" && item.score < acceptThreshold,
    )
    .map(([name, item]) => {
      const score = item!.score ?? "n/a";
      const threshold = typeof item!.score === "number" ? ` accepted=${acceptThreshold}` : "";
      return `${name}=${item!.status} score=${score}${threshold}: ${item!.summary}`;
    });
}

function publishReadyStructuralFailureSummaries(report: Partial<PublishReadyResult> | null): string[] {
  if (!report) return [];
  const items: Array<[string, { readonly status: string; readonly score: number | null; readonly summary: string } | undefined]> = [
    ["story_effectiveness", report.story_effectiveness],
    ["golden_3_chapter", report.golden_3_chapter],
    ["opening_hook", report.opening_hook],
    ["antagonist_intelligence", report.antagonist_intelligence],
    ["transition_quality", report.transition_quality],
    ["six_step_plot", report.six_step_plot],
  ];
  return items
    .filter(([, item]) => item?.status === "FAIL_STRUCTURAL" || item?.status === "FAIL_REPORT_ONLY")
    .map(([name, item]) => `${name}=${item!.status} score=${item!.score ?? "n/a"}: ${item!.summary}`);
}

function renderPublishReadyStructureConsole(report: Partial<PublishReadyResult>): string[] {
  const items: Array<[string, { readonly status: string; readonly score: number | null; readonly summary: string } | undefined]> = [
    ["story_effectiveness", report.story_effectiveness],
    ["golden_3_chapter", report.golden_3_chapter],
    ["opening_hook", report.opening_hook],
    ["antagonist_intelligence", report.antagonist_intelligence],
    ["transition_quality", report.transition_quality],
    ["six_step_plot", report.six_step_plot],
  ];
  return items
    .filter(([, item]) => Boolean(item))
    .map(([name, item]) => {
      const score = item!.score ?? "n/a";
      return `${name}: ${item!.status} score=${score}`;
    });
}

async function runPublishReadyChapterOnce(params: {
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client?: ReturnType<typeof createClient>;
  readonly model?: string;
  readonly maxFixAttempts: number;
  readonly maxPolishAttempts: number;
  readonly maxQualityFixAttempts: number;
  readonly maxPlotFixAttempts: number;
  readonly qualityFixThreshold: number;
  readonly qualityPassThreshold: number;
  readonly qualityAcceptThreshold: number;
  readonly structurePassThreshold: number;
  readonly structureAcceptThreshold: number;
  readonly minChapterWords: number;
  readonly targetChapterWords: number;
  readonly language: "zh" | "en";
  readonly acceptManualContinuity: boolean;
  readonly continuityOverridePass: boolean;
  readonly json: boolean;
}, options: {
  readonly preferReviewedFinal?: boolean;
  readonly skipAcceptedExistingCandidate?: boolean;
} = {}): Promise<PublishReadyResult> {
  const sourceChain = new Set<string>();
  const original = await findChapterFile(params.bookDir, params.chapter);
  sourceChain.add(relative(params.bookDir, original.file));
  const reviewedFinal = await findReviewedFinalChapterFile(params.bookDir, params.chapter);
  const reviewedFinalExists = Boolean(reviewedFinal);
  const prefix = chapterNumberPrefix(params.chapter);
  const hasFreshPlotFix = await isFileNewerThan(
    join(params.bookDir, "reviews", "plot-auto-fix", `${prefix}.plot-fix-report.json`),
    join(params.bookDir, "reviews", "publish-ready", `${prefix}.publish-report.json`),
  );
  const preferReviewedFinal = Boolean(options.preferReviewedFinal || hasFreshPlotFix);
  const skipAcceptedExistingCandidate = Boolean(options.skipAcceptedExistingCandidate || hasFreshPlotFix);

  // Resource hard gate: check resource consistency report before continuity/quality.
  // If the chapter index has already advanced to ready/approved, old resource
  // reports can be stale leftovers from a repaired write/sync run.
  const chapterStatus = await readChapterIndexStatus(params.bookDir, params.chapter);
  const resourceReport = await readResourceConsistencyReportIfExists(params.bookDir, params.chapter);
  const ignoreStaleResourceReport = chapterStatus === "ready-for-review" || chapterStatus === "approved";
  const resourceBlocked = !ignoreStaleResourceReport && (resourceReport?.blocking === true || resourceReport?.closureStatus === "resource_failed");
  const chapterBlocked = !ignoreStaleResourceReport && resourceReport?.status && ["BLOCKED_BY_RESOURCE_PLAN", "BLOCKED"].includes(String(resourceReport.status));

  let publishBlockedStatus: "BLOCKED_BY_AUDIT" | "BLOCKED_BY_STATE" | "BLOCKED_BY_PLANNING" | "BLOCKED_BY_RESOURCE" | null = null;
  const warnings: string[] = [];

  if (chapterStatus === "audit-failed") {
    publishBlockedStatus = "BLOCKED_BY_AUDIT";
    warnings.push(`Chapter ${params.chapter} is audit-failed. Fix audit issues before publishing.`);
  } else if (chapterStatus === "state-degraded") {
    publishBlockedStatus = "BLOCKED_BY_STATE";
    warnings.push(`Chapter ${params.chapter} is state-degraded. Revert or repair state before publishing.`);
  } else if (chapterStatus === "planning-degraded") {
    publishBlockedStatus = "BLOCKED_BY_PLANNING";
    warnings.push(`Chapter ${params.chapter} is planning-degraded. Align plan before publishing.`);
  } else if (resourceBlocked || chapterBlocked || chapterStatus === "blocked-resource-plan") {
    publishBlockedStatus = "BLOCKED_BY_RESOURCE";
    if (resourceBlocked || chapterBlocked) {
      warnings.push(
        `Resource consistency check: blocking=${resourceReport?.blocking ?? false}, closureStatus=${resourceReport?.closureStatus ?? "unknown"}. Fix resource issues before publishing.`,
      );
    }
    if (chapterStatus === "blocked-resource-plan") {
      warnings.push(
        `Chapter index status is "${chapterStatus}". Chapter must be repaired before publishing.`,
      );
    }
  }

  if (publishBlockedStatus) {
    return writePublishReadyReport(params.bookDir, {
      book: params.bookId,
      chapter_index: params.chapter,
      publish_status: publishBlockedStatus,
      final_candidate_file: "",
      source_chain: [...sourceChain],
      continuity: { final_status: "UNKNOWN" },
      quality: {},
      warnings,
      word_count: resourceReport?.wordCount ?? 0,
      min_chapter_words: params.minChapterWords,
      report_json_path: "",
      report_markdown_path: "",
    });
  }

  if (!params.client || !params.model) {
    throw new Error("INKOS_LLM_API_KEY not set. Run 'inkos config set-global' or add it to project .env file.");
  }

  let candidateOverride: string | undefined = await resolvePublishReadyStartingCandidate(
    params.bookDir,
    params.chapter,
    original.file,
    params.acceptManualContinuity || preferReviewedFinal,
  );
  if (candidateOverride === original.file) candidateOverride = undefined;
  if (params.continuityOverridePass) {
    const overrideResult = await runPublishReadyWithContinuityOverride(params as any, sourceChain);
    if (overrideResult) return overrideResult;
    return writePublishReadyReport(params.bookDir, {
      book: params.bookId,
      chapter_index: params.chapter,
      publish_status: "BLOCKED_BY_CONTINUITY",
      final_candidate_file: "",
      source_chain: [...sourceChain],
      continuity: { final_status: "UNKNOWN" },
      quality: {},
      warnings: ["continuity override was requested, but no PASS final continuity report with an existing used_file was found."],
      word_count: 0,
      min_chapter_words: params.minChapterWords,
      report_json_path: "",
      report_markdown_path: "",
    });
  }
  if (!skipAcceptedExistingCandidate) {
    const existingReady = await tryWriteAcceptedExistingCandidate(params as any, candidateOverride ?? original.file, sourceChain);
    if (existingReady) return existingReady;
  }
  let continuity: ContinuityCommandResult | undefined;
  let continuityReport: ContinuityReport | undefined;
  let quality: FanqieQualityCommandResult | undefined;
  let qualityStatus: "QUALITY_PASS" | "QUALITY_WARN_POLISH_OPTIONAL" | "QUALITY_MANUAL_REVIEW" | undefined;
  let qualityCandidate: string | undefined;
  let manualContinuityAcceptance: PublishReadyManualContinuityAcceptance | undefined;
 
  for (let loop = 1; loop <= 2; loop += 1) {
    if (!params.json) {
      log("");
      log(loop === 1 ? "step 1 continuity:" : `loop ${loop} continuity:`);
    }
    const continuityResult = await runContinuityPublishPass(params as any, candidateOverride, sourceChain);
    continuity = continuityResult.final;
    continuityReport = continuityResult.report;
    sourceChain.add(relative(params.bookDir, continuity.sourceFile));
    if (!params.json) {
      log(`score: ${continuityReport.score}`);
      log(`status: ${continuityReport.final_status}`);
      log(`file: ${relative(params.bookDir, continuity.sourceFile)}`);
    }

    if (continuityReport.final_status !== "PASS") {
      manualContinuityAcceptance = makeManualContinuityAcceptance({
        acceptManualContinuity: params.acceptManualContinuity,
        report: continuityReport,
        sourceFile: continuity.sourceFile,
        bookDir: params.bookDir,
        reviewedFinalExists,
      });
      if (manualContinuityAcceptance) {
        sourceChain.add(manualContinuityAcceptance.acceptedContinuityFile);
      } else {
        return writePublishReadyReport(params.bookDir, {
          book: params.bookId,
          chapter_index: params.chapter,
          publish_status: "BLOCKED_BY_CONTINUITY",
          final_candidate_file: "",
          source_chain: [...sourceChain],
          continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
          quality: {},
          word_count: continuityReport.word_count,
          min_chapter_words: params.minChapterWords,
          report_json_path: "",
          report_markdown_path: "",
        });
      }
    }

    if (!params.json) {
      log("");
      log(loop === 1 ? "step 2 quality:" : `loop ${loop} quality:`);
      log(`input: ${relative(params.bookDir, continuity.sourceFile)}`);
    }
    quality = await checkFanqieQualityChapter({
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter: params.chapter,
      client: params.client,
      model: params.model,
      currentOverridePath: continuity.sourceFile,
    });
    sourceChain.add(relative(params.bookDir, quality.sourceFile));
    if (!params.json) {
      log(`score: ${quality.report.quality_score}`);
      log(`status: ${quality.report.status}`);
    }

    qualityCandidate = quality.sourceFile;
    const immediateQualityDecision = decidePublishQuality(quality.report.quality_score, params.qualityPassThreshold, params.qualityAcceptThreshold);
    qualityStatus = qualityFinalStatusFromDecision(immediateQualityDecision);

    // Step 2.5: Structure Precheck
    let structurePlotFixed = false;
    let plotFixedFile = "";

    if (loop === 1) {
      if (!params.json) {
        log("");
        log("step 2.5 structure precheck:");
      }

      // Load book-level structure signals and chapter intent for structure review
      const signalsResult = await readStructureSignals(params.bookDir);
      let activeSignals: StructureSignals | undefined =
        signalsResult.status === "ok" ? signalsResult.signals : undefined;

      const intentPrefix = chapterNumberPrefix(params.chapter);
      let chapterIntentContent = "";
      try {
        const intentPath = join(params.bookDir, "story", "runtime", "chapter-intents", `${intentPrefix}.md`);
        chapterIntentContent = await readFile(intentPath, "utf-8").catch(() => "");
      } catch {
        // ignore
      }
      if (activeSignals && chapterIntentContent) {
        const merged = mergeIntentSignals(activeSignals, chapterIntentContent);
        if (merged) activeSignals = merged;
      }

      if (!params.json) {
        log(`input: ${relative(params.bookDir, quality.sourceFile)}`);
      }
      const currentText = await readFile(quality.sourceFile, "utf-8");
      
      // Run static scans to generate/update story-effectiveness and six-step-plot reports on disk
      await generateStoryEffectivenessReport(
        params.bookDir,
        params.chapter,
        currentText,
        activeSignals
      );
      await generateSixStepPlotReport(
        params.bookDir,
        params.chapter,
        currentText,
        undefined,
        activeSignals
      );

      // Read reports to get the score
      const seReport = await readStoryEffectivenessReportIfExists(params.bookDir, params.chapter);
      const sixStepReport = await readSixStepPlotReportIfExists(params.bookDir, params.chapter);

      const seScore = seReport?.score ?? 100;
      const ssScore = typeof sixStepReport?.score === "number" ? sixStepReport.score : 100;
      const structureMinScore = Math.min(seScore, ssScore);
      if (!params.json) {
        log(`story_effectiveness score: ${seScore} (status: ${seReport?.status ?? "PASS"})`);
        log(`six_step_plot score: ${sixStepReport?.score ?? "n/a"} (status: ${sixStepReport?.status ?? "PASS"})`);
        log(`structure min score: ${structureMinScore}`);
      }

      // If the lower of story_effectiveness / six_step_plot < structureAcceptThreshold, execute inner plot-fix
      if (structureMinScore < params.structureAcceptThreshold) {
        const failedDims: string[] = [];
        if (seScore < params.structureAcceptThreshold) failedDims.push(`story_effectiveness=${seScore}`);
        if (ssScore < params.structureAcceptThreshold) failedDims.push(`six_step_plot=${ssScore}`);
        if (!params.json) {
          log(`structure precheck: ${failedDims.join(", ")} < accept threshold ${params.structureAcceptThreshold}. Running inner plot-fix...`);
        }

        const plotFixedPath = await writePlotFixedChapter({
          bookDir: params.bookDir,
          chapter: params.chapter,
          attempt: 1,
          client: params.client,
          model: params.model,
          currentText,
          publishReport: {
            publish_status: "FAIL_STRUCTURAL",
            six_step_plot: {
              status: sixStepReport?.status || "FAIL_STRUCTURAL",
              score: sixStepReport?.score ?? null
            }
          } as any,
          sixStepReport: sixStepReport as any,
          storyEffectivenessReport: seReport as any,
          lengthConstraint: buildRepairLengthConstraint({
            chapterText: currentText,
            targetChapterWords: params.targetChapterWords,
            language: params.language,
          }),
          scopeConstraint: buildRepairScopeConstraint(chapterIntentContent),
        });

        plotFixedFile = plotFixedPath;
        structurePlotFixed = true;
        
        if (!params.json) {
          log(`inner plot-fix input: ${relative(params.bookDir, quality.sourceFile)}`);
          log(`inner plot-fix output: ${relative(params.bookDir, plotFixedPath)}`);
        }

        // Set qualityCandidate and continuity to the fixed path
        qualityCandidate = plotFixedPath;
        if (continuity) {
          continuity = {
            ...continuity,
            sourceFile: plotFixedPath,
          };
        }
        sourceChain.add(relative(params.bookDir, plotFixedPath));

        // Update final continuity report on disk to point to the plot-fixed file
        if (continuityReport) {
          const reportDir = join(params.bookDir, "reviews", "continuity");
          const prefix = chapterNumberPrefix(params.chapter);
          const reportJsonPath = join(reportDir, `${prefix}.final-report.json`);
          const reportMarkdownPath = join(reportDir, `${prefix}.final-report.md`);
          
          const updatedReport = {
            ...continuityReport,
            used_file: relative(params.bookDir, plotFixedPath),
            body_source: "plot_fixed",
          };
          await writeContinuityReportFiles(
            updatedReport,
            reportJsonPath,
            reportMarkdownPath,
            params.chapter,
            continuity.chapterTitle
          );
          continuityReport = updatedReport;
        }

        // Delete the stale quality reports and structure reports so they get regenerated
        const qaReportDir = join(params.bookDir, "reviews", "fanqie-quality");
        const qaPrefix = chapterNumberPrefix(params.chapter);
        const qaFiles = [
          join(qaReportDir, `${qaPrefix}.quality-report.json`),
          join(qaReportDir, `${qaPrefix}.quality-report.md`),
          join(qaReportDir, `${qaPrefix}.final-quality-report.json`),
          join(qaReportDir, `${qaPrefix}.final-quality-report.md`),
        ];
        await Promise.all(qaFiles.map((file) =>
          unlink(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          })
        ));
        await deletePublishReadyStructureReportsIfExists(params.bookDir, params.chapter);
      } else {
        if (!params.json) {
          log("story_effectiveness score satisfies threshold. Skipping plot-fix.");
        }
      }
    }

    const goldenReport = await readGolden3ChapterReportIfExists(params.bookDir);
    const goldenScore = goldenReport?.score ?? 100;
    const goldenNeedsFix = goldenScore < 85 && (params.chapter >= 1 && params.chapter <= 3);
    const bypassEarlyReturn = Boolean(loop === 1 && (goldenNeedsFix || structurePlotFixed));

    if (!bypassEarlyReturn && (immediateQualityDecision === "QUALITY_PASS" || immediateQualityDecision === "QUALITY_WARN_POLISH_OPTIONAL")) {
      const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, continuity.sourceFile);
      sourceChain.add(relative(params.bookDir, finalFile));
      const readyToExport = isReadyToExport(continuityReport, immediateQualityDecision, finalFile, params.minChapterWords, Boolean(manualContinuityAcceptance));
      const lengthGate = await checkPublishReadyFinalLength({
        file: finalFile,
        targetChapterWords: params.targetChapterWords,
        language: params.language,
      });
      const lengthDecision = applyPublishReadyLengthGate(
        readyToExport ? publishStatusForQualityDecision(immediateQualityDecision) : "MANUAL_REVIEW",
        qualityWarnings(immediateQualityDecision, quality.report.quality_score, params.qualityPassThreshold),
        lengthGate,
      );
      const finalText = await readFile(finalFile, "utf-8");
      const scopeGate = await evaluatePublishReadyScopeGate({
        bookDir: params.bookDir,
        chapter: params.chapter,
        finalText,
        originalText: await readFile(original.file, "utf-8").catch(() => undefined),
        language: params.language,
      });
      const scopeDecision = applyPublishReadyScopeGate(
        lengthDecision.publishStatus,
        lengthDecision.warnings,
        scopeGate,
      );
      return writePublishReadyReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: scopeDecision.publishStatus,
        final_candidate_file: relative(params.bookDir, finalFile),
        source_chain: [...sourceChain],
        continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
        quality: { final_quality_status: qualityStatus, score: quality.report.quality_score },
        quality_decision: immediateQualityDecision,
        quality_score: quality.report.quality_score,
        quality_pass_threshold: params.qualityPassThreshold,
        quality_accept_threshold: params.qualityAcceptThreshold,
        structure_pass_threshold: params.structurePassThreshold,
        structure_accept_threshold: params.structureAcceptThreshold,
        accepted_reason: immediateQualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
        warnings: scopeDecision.warnings,
        ...manualContinuityAcceptance,
        source_file: relative(params.bookDir, continuity.sourceFile),
        word_count: lengthGate.count,
        min_chapter_words: params.minChapterWords,
        target_chapter_words: params.targetChapterWords,
        max_chapter_words: lengthGate.hard_max,
        length_gate: lengthGate,
        scope_gate: scopeGate,
        report_json_path: "",
        report_markdown_path: "",
      });
    }
    if (quality.report.quality_score < params.qualityPassThreshold || (loop === 1 && (goldenNeedsFix || structurePlotFixed))) {
      if (!params.json) {
        log("");
        log(loop === 1 ? "step 3 polish:" : `loop ${loop} polish:`);
        log(`input: ${relative(params.bookDir, qualityCandidate)}`);
      }
      const polished = await polishFanqieQualityChapter({
        bookId: params.bookId,
        bookDir: params.bookDir,
        chapter: params.chapter,
        client: params.client,
        model: params.model,
        maxPolishAttempts: params.maxPolishAttempts,
        json: params.json,
        currentOverridePath: qualityCandidate,
        qualityPassThreshold: params.qualityPassThreshold,
        qualityAcceptThreshold: params.qualityAcceptThreshold,
        targetChapterWords: params.targetChapterWords,
        language: params.language,
      });
      qualityStatus = polished.finalQualityStatus;
      if (polished.blockedByLength) {
        if (!params.json) log("polish blocked by length gate. Using pre-polish candidate.");
        // Do NOT upgrade qualityCandidate to the length-exceeding polished file
      } else if (polished.usedPolishedFile) {
        const polishedPath = resolveUsedFilePath(params.bookDir, polished.usedPolishedFile);
        if (polishedPath) {
          qualityCandidate = polishedPath;
          sourceChain.add(relative(params.bookDir, polishedPath));
        }
      }
      if (!params.json) {
        log(`status: ${polished.finalQualityStatus}`);
        if (polished.usedPolishedFile) log(`file: ${polished.usedPolishedFile}`);
      }
      if (polished.finalQualityStatus !== "QUALITY_PASS" && polished.finalQualityStatus !== "QUALITY_WARN_POLISH_OPTIONAL") {
        const blocked = await writePublishReadyReport(params.bookDir, {
          book: params.bookId,
          chapter_index: params.chapter,
          publish_status: "BLOCKED_BY_QUALITY",
          final_candidate_file: "",
          source_chain: [...sourceChain],
          continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
          quality: { final_quality_status: polished.finalQualityStatus, score: polished.finalScore },
          ...manualContinuityAcceptance,
          source_file: relative(params.bookDir, qualityCandidate),
          word_count: continuityReport.word_count,
          min_chapter_words: params.minChapterWords,
          report_json_path: "",
          report_markdown_path: "",
        });
        const finalQualityReport = await readQualityReportIfExists(params.bookDir, params.chapter, "final-quality-report");
        const finalQualityScore = Number(finalQualityReport?.final_quality_score ?? finalQualityReport?.quality_score ?? polished.finalScore);
        if (finalQualityScore < params.qualityFixThreshold) {
          if (!params.json) {
            log(`quality after polish: ${finalQualityScore}`);
            log("status: too low for targeted fix");
            log("Quality score too low for targeted fix. Rewrite required.");
          }
          return writePublishReadyReport(params.bookDir, {
            ...blocked,
            publish_status: "NEED_REWRITE",
            quality: { final_quality_status: polished.finalQualityStatus, score: finalQualityScore },
            quality_decision: "NEED_REWRITE",
            quality_score: finalQualityScore,
            quality_pass_threshold: params.qualityPassThreshold,
            quality_accept_threshold: params.qualityAcceptThreshold,
            ...manualContinuityAcceptance,
            report_json_path: "",
            report_markdown_path: "",
          });
        }
        if (params.maxQualityFixAttempts > 0 && isQualityAutoFixEligibleFromReports(
          blocked,
          finalQualityReport,
          params.qualityFixThreshold,
          params.qualityAcceptThreshold,
        )) {
          if (!params.json) {
            log(`quality after polish: ${finalQualityScore}`);
            log("status: near pass, running quality-auto-fix");
            log("");
            log("[quality-auto-fix]");
          }
          const fixed = await runQualityAutoFixChapter({
            root: params.root,
            bookId: params.bookId,
            bookDir: params.bookDir,
            chapter: params.chapter,
            client: params.client,
            model: params.model,
            maxQualityFixAttempts: params.maxQualityFixAttempts,
            qualityFixThreshold: params.qualityFixThreshold,
            qualityPassThreshold: params.qualityPassThreshold,
            qualityAcceptThreshold: params.qualityAcceptThreshold,
            minChapterWords: params.minChapterWords,
            targetChapterWords: params.targetChapterWords,
            language: params.language,
            maxFixAttempts: params.maxFixAttempts,
            json: params.json,
          });
          if (!params.json) {
            if (fixed.input_file) log(`input: ${fixed.input_file}`);
            if (fixed.output_file) log(`output: ${fixed.output_file}`);
            if (fixed.skipped_reason) log(`skipped: ${fixed.skipped_reason}`);
            log(`quality recheck: ${fixed.quality_score_after ?? "n/a"}`);
            log(`continuity recheck: ${fixed.continuity_score_after ?? "n/a"}`);
          }
          return readPublishReadyReportIfExists(params.bookDir, params.chapter) as Promise<PublishReadyResult>;
        }
        return blocked;
      }
    }

    if (!params.json) {
      log("");
      log("step 4 continuity recheck:");
      log(`input: ${relative(params.bookDir, qualityCandidate)}`);
    }
    const recheck = await runContinuityPublishPass(params as any, qualityCandidate, sourceChain);
    continuity = recheck.final;
    continuityReport = recheck.report;
    sourceChain.add(relative(params.bookDir, continuity.sourceFile));
    if (!params.json) {
      log(`score: ${continuityReport.score}`);
      log(`status: ${continuityReport.final_status}`);
      log(`file: ${relative(params.bookDir, continuity.sourceFile)}`);
    }

    if (continuityReport.final_status !== "PASS") {
      manualContinuityAcceptance = makeManualContinuityAcceptance({
        acceptManualContinuity: params.acceptManualContinuity,
        report: continuityReport,
        sourceFile: continuity.sourceFile,
        bookDir: params.bookDir,
        reviewedFinalExists,
      });
      if (manualContinuityAcceptance) {
        sourceChain.add(manualContinuityAcceptance.acceptedContinuityFile);
      } else {
        return writePublishReadyReport(params.bookDir, {
          book: params.bookId,
          chapter_index: params.chapter,
          publish_status: "BLOCKED_BY_CONTINUITY",
          final_candidate_file: "",
          source_chain: [...sourceChain],
          continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
          quality: { final_quality_status: qualityStatus, score: quality.report.quality_score },
          source_file: relative(params.bookDir, continuity.sourceFile),
          word_count: continuityReport.word_count,
          min_chapter_words: params.minChapterWords,
          report_json_path: "",
          report_markdown_path: "",
        });
      }
    }

    if (continuity.sourceFile === qualityCandidate) {
      const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, continuity.sourceFile);
      sourceChain.add(relative(params.bookDir, finalFile));
      const finalQualityReport = await readQualityReportIfExists(params.bookDir, params.chapter, "final-quality-report");
      const qualityScore = Number(finalQualityReport?.final_quality_score ?? finalQualityReport?.quality_score ?? quality.report.quality_score);
      const qualityDecision = decidePublishQuality(qualityScore, params.qualityPassThreshold, params.qualityAcceptThreshold);
      qualityStatus = qualityFinalStatusFromDecision(qualityDecision);
      const readyToExport = isReadyToExport(continuityReport, qualityDecision, finalFile, params.minChapterWords, Boolean(manualContinuityAcceptance));
      const lengthGate = await checkPublishReadyFinalLength({
        file: finalFile,
        targetChapterWords: params.targetChapterWords,
        language: params.language,
      });
      const basePublishStatus: PublishReadyStatus = readyToExport
        ? publishStatusForQualityDecision(qualityDecision)
        : qualityDecision === "NEED_REWRITE" ? "NEED_REWRITE" : "MANUAL_REVIEW";
      const lengthDecision = applyPublishReadyLengthGate(
        basePublishStatus,
        qualityWarnings(qualityDecision, qualityScore, params.qualityPassThreshold),
        lengthGate,
      );
      const loopFinalText = await readFile(finalFile, "utf-8");
      const scopeGate = await evaluatePublishReadyScopeGate({
        bookDir: params.bookDir,
        chapter: params.chapter,
        finalText: loopFinalText,
        originalText: await readFile(original.file, "utf-8").catch(() => undefined),
        language: params.language,
      });
      const scopeDecision = applyPublishReadyScopeGate(
        lengthDecision.publishStatus,
        lengthDecision.warnings,
        scopeGate,
      );
      return writePublishReadyReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: scopeDecision.publishStatus,
        final_candidate_file: relative(params.bookDir, finalFile),
        source_chain: [...sourceChain],
        continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
        quality: { final_quality_status: qualityStatus, score: qualityScore },
        quality_decision: qualityDecision,
        quality_score: qualityScore,
        quality_pass_threshold: params.qualityPassThreshold,
        quality_accept_threshold: params.qualityAcceptThreshold,
        structure_pass_threshold: params.structurePassThreshold,
        structure_accept_threshold: params.structureAcceptThreshold,
        accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
        warnings: scopeDecision.warnings,
        ...manualContinuityAcceptance,
        source_file: relative(params.bookDir, continuity.sourceFile),
        word_count: lengthGate.count,
        min_chapter_words: params.minChapterWords,
        target_chapter_words: params.targetChapterWords,
        max_chapter_words: lengthGate.hard_max,
        length_gate: lengthGate,
        scope_gate: scopeGate,
        report_json_path: "",
        report_markdown_path: "",
      });
    }

    candidateOverride = continuity.sourceFile;
  }

  return writePublishReadyReport(params.bookDir, {
    book: params.bookId,
    chapter_index: params.chapter,
    publish_status: "MANUAL_REVIEW",
    final_candidate_file: "",
    source_chain: [...sourceChain],
    continuity: { final_status: continuityReport?.final_status, score: continuityReport?.score },
    quality: { final_quality_status: qualityStatus, score: quality?.report.quality_score },
    ...manualContinuityAcceptance,
    source_file: relative(params.bookDir, continuity?.sourceFile ?? qualityCandidate ?? original.file),
    word_count: continuityReport?.word_count,
    min_chapter_words: params.minChapterWords,
    report_json_path: "",
    report_markdown_path: "",
  });
}

interface ContinuityOverridePassCandidate {
  readonly report: ContinuityReport;
  readonly sourceFile: string;
  readonly sourceRef: string;
}

export async function resolveContinuityOverridePassCandidate(
  bookDir: string,
  chapter: number,
): Promise<ContinuityOverridePassCandidate | null> {
  const finalReport = await readContinuityReportIfExists(bookDir, chapter, "final-report");
  if (!isContinuityPassReport(finalReport)) return null;
  const usedFile = typeof finalReport?.used_file === "string" ? finalReport.used_file : "";
  if (!usedFile) return null;
  const sourceFile = resolveUsedFilePath(bookDir, usedFile);
  if (!sourceFile || !existsSync(sourceFile)) return null;
  return {
    report: finalReport as ContinuityReport,
    sourceFile,
    sourceRef: relative(bookDir, sourceFile),
  };
}

async function runPublishReadyWithContinuityOverride(
  params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly chapter: number;
    readonly client: ReturnType<typeof createClient>;
    readonly model: string;
    readonly qualityPassThreshold: number;
    readonly qualityAcceptThreshold: number;
    readonly minChapterWords: number;
    readonly targetChapterWords: number;
    readonly language: "zh" | "en";
    readonly json: boolean;
  },
  sourceChain: Set<string>,
): Promise<PublishReadyResult | null> {
  const override = await resolveContinuityOverridePassCandidate(params.bookDir, params.chapter);
  if (!override) return null;

  sourceChain.add(override.sourceRef);
  const candidateSource = await resolvePublishReadyStartingCandidate(params.bookDir, params.chapter, override.sourceFile, false);
  const candidateRef = relative(params.bookDir, candidateSource);
  sourceChain.add(candidateRef);
  if (!params.json) {
    log("");
    log("step 1 continuity:");
    log(`status: PASS`);
    log(`file: ${override.sourceRef}`);
    log("source: continuity-auto override");
    log("");
    log("step 2 quality:");
  }

  const quality = await checkFanqieQualityChapter({
    bookId: params.bookId,
    bookDir: params.bookDir,
    chapter: params.chapter,
    client: params.client,
    model: params.model,
    currentOverridePath: candidateSource,
  });
  sourceChain.add(relative(params.bookDir, quality.sourceFile));

  const qualityScore = quality.report.quality_score;
  const qualityDecision = decidePublishQuality(qualityScore, params.qualityPassThreshold, params.qualityAcceptThreshold);
  const qualityStatus = qualityFinalStatusFromDecision(qualityDecision);
  if (!params.json) {
    log(`score: ${qualityScore}`);
    log(`status: ${quality.report.status}`);
  }

  const common = {
    book: params.bookId,
    chapter_index: params.chapter,
    source_chain: [...sourceChain],
    continuity: { final_status: "PASS", score: override.report.score },
    quality: { final_quality_status: qualityStatus, score: qualityScore },
    quality_decision: qualityDecision,
    quality_score: qualityScore,
    quality_pass_threshold: params.qualityPassThreshold,
    quality_accept_threshold: params.qualityAcceptThreshold,
    continuityOverride: "PASS" as const,
    continuityOverrideReason: "continuity-auto returned PASS",
    source_file: candidateRef,
    word_count: override.report.word_count,
    min_chapter_words: params.minChapterWords,
    report_json_path: "",
    report_markdown_path: "",
  };

  if (qualityDecision !== "QUALITY_PASS" && qualityDecision !== "QUALITY_WARN_POLISH_OPTIONAL") {
    return writePublishReadyReport(params.bookDir, {
      ...common,
      publish_status: "BLOCKED_BY_QUALITY",
      final_candidate_file: "",
    });
  }

  const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, candidateSource);
  sourceChain.add(relative(params.bookDir, finalFile));
  const readyToExport = isReadyToExport(override.report, qualityDecision, finalFile, params.minChapterWords);
  const lengthGate = await checkPublishReadyFinalLength({
    file: finalFile,
    targetChapterWords: params.targetChapterWords,
    language: params.language,
  });
  const lengthDecision = applyPublishReadyLengthGate(
    readyToExport ? publishStatusForQualityDecision(qualityDecision) : "MANUAL_REVIEW",
    qualityWarnings(qualityDecision, qualityScore, params.qualityPassThreshold),
    lengthGate,
  );
  return writePublishReadyReport(params.bookDir, {
    ...common,
    publish_status: lengthDecision.publishStatus,
    final_candidate_file: relative(params.bookDir, finalFile),
    source_chain: [...sourceChain],
    accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
    warnings: lengthDecision.warnings,
    word_count: lengthGate.count,
    target_chapter_words: params.targetChapterWords,
    max_chapter_words: lengthGate.hard_max,
    length_gate: lengthGate,
  });
}

async function runContinuityPublishPass(
  params: {
    readonly root: string;
    readonly bookId: string;
    readonly bookDir: string;
    readonly chapter: number;
    readonly client: ReturnType<typeof createClient>;
    readonly model: string;
    readonly maxFixAttempts: number;
    readonly minChapterWords: number;
    readonly acceptManualContinuity?: boolean;
  },
  currentOverridePath: string | undefined,
  sourceChain: Set<string>,
): Promise<{ readonly final: ContinuityCommandResult; readonly report: ContinuityReport }> {
  if (params.chapter <= 1) {
    return createOpeningChapterContinuityPass(params, currentOverridePath, sourceChain);
  }

  let attempt = 0;
  let currentOverride = currentOverridePath;
  let current: ContinuityCommandResult | undefined;
  do {
    current = await checkContinuityChapter({
      root: params.root,
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter: params.chapter,
      client: params.client,
      model: params.model,
      final: attempt > 0 || Boolean(currentOverridePath),
      currentOverridePath: currentOverride,
      fixAttempt: attempt,
      maxFixAttempts: params.maxFixAttempts,
      minChapterWords: params.minChapterWords,
    });
    sourceChain.add(relative(params.bookDir, current.sourceFile));
    if (isContinuityPublishPass(current.report)) break;
    const currentFinalStatus = (current.report as { final_status?: string }).final_status;
    if (currentFinalStatus === "DROP") break;
    if (params.acceptManualContinuity && currentFinalStatus !== "DROP") break;
    if (attempt >= params.maxFixAttempts || current.report.rewrite_mode === "none") break;
    const nextAttempt = attempt + 1;
    const fixed = await fixContinuityChapter({
      root: params.root,
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter: params.chapter,
      client: params.client,
      model: params.model,
      reportJsonPath: current.reportJsonPath,
      attempt: nextAttempt,
      maxFixAttempts: params.maxFixAttempts,
    });
    currentOverride = fixed.fixedChapterPath;
    sourceChain.add(relative(params.bookDir, fixed.fixedChapterPath));
    attempt = nextAttempt;
  } while (true);

  if (!current) throw new Error(`Publish-ready continuity step failed for chapter ${params.chapter}`);
  const reportDir = join(params.bookDir, "reviews", "continuity");
  const prefix = chapterNumberPrefix(params.chapter);
  const finalStatus = isContinuityPublishPass(current.report)
    ? "PASS"
    : (current.report as { final_status?: string }).final_status === "DROP" ? "DROP" : "MANUAL_REVIEW";
  const report = finalStatus === "PASS"
    ? makeContinuityDecisionReport(current.report, {
        finalStatus: "PASS",
        decisionSource: currentOverridePath ? "publish_ready_recheck" : current.fromExistingPass ? "reviewed_existing" : attempt > 0 ? "fix_attempt" : "initial_check",
        usedFile: relative(params.bookDir, current.sourceFile),
        bodySource: current.bodySource,
        fixAttempt: attempt,
        maxFixAttempts: params.maxFixAttempts,
      })
    : finalStatus === "DROP"
      ? markDrop(current.report, "publish-ready continuity source is DROP.", {
          decisionSource: currentOverridePath ? "publish_ready_recheck_failed" : "publish_ready_initial_failed",
          usedFile: relative(params.bookDir, current.sourceFile),
          bodySource: current.bodySource,
          fixAttempt: attempt,
          maxFixAttempts: params.maxFixAttempts,
        })
    : markManualReview(current.report, "publish-ready continuity loop did not reach PASS.", {
        decisionSource: currentOverridePath ? "publish_ready_recheck_failed" : "publish_ready_initial_failed",
        usedFile: relative(params.bookDir, current.sourceFile),
        bodySource: current.bodySource,
        fixAttempt: attempt,
        maxFixAttempts: params.maxFixAttempts,
      });
  await writeContinuityReportFiles(
    report,
    join(reportDir, `${prefix}.final-report.json`),
    join(reportDir, `${prefix}.final-report.md`),
    params.chapter,
    current.chapterTitle,
  );
  return { final: { ...current, report }, report };
}

async function createOpeningChapterContinuityPass(
  params: {
    readonly bookDir: string;
    readonly chapter: number;
    readonly maxFixAttempts: number;
    readonly minChapterWords: number;
  },
  currentOverridePath: string | undefined,
  sourceChain: Set<string>,
): Promise<{ readonly final: ContinuityCommandResult; readonly report: ContinuityReport }> {
  const original = await findChapterFile(params.bookDir, params.chapter);
  const sourceFile = currentOverridePath ?? original.file;
  const body = await readFile(sourceFile, "utf-8");
  const wordCount = countChapterLength(body, "zh_chars");
  const tooShort = wordCount < params.minChapterWords;
  const reportDir = join(params.bookDir, "reviews", "continuity");
  const prefix = chapterNumberPrefix(params.chapter);
  const reportJsonPath = join(reportDir, `${prefix}.final-report.json`);
  const reportMarkdownPath = join(reportDir, `${prefix}.final-report.md`);
  const report: ContinuityReport = {
    score: 100,
    level: "优秀",
    status: "PASS",
    summary: tooShort
      ? "第一章没有上一章可供连续性比对；作为开篇章节基准通过连续性门禁。正文长度低于发布要求，仍需在 publish-ready 最终门禁处理。"
      : "第一章没有上一章可供连续性比对；作为开篇章节基准通过 publish-ready 连续性门禁。",
    strengths: tooShort ? [] : ["开篇章节无需承接上一章，作为后续连续性基准。"],
    issues: tooShort
      ? [{
          type: "章节字数不足",
          severity: "高",
          detail: `正文有效字数 ${wordCount}，低于最低要求 ${params.minChapterWords}，需扩写到至少 ${params.minChapterWords} 字。`,
        }]
      : [],
    opening_check: { result: "SKIPPED", reason: "opening chapter has no previous chapter" },
    repeated_info_check: { severity: "低", repeated_paragraphs: [], detail: "第一章基准报告不执行跨章重复信息检查。" },
    current_goal: "开篇章节基准",
    goal_clear: "YES",
    foreshadowing_continuity: { 已承接元素: [], 被忽略元素: [] },
    crisis_progress: "建立",
    fix_suggestions: tooShort ? [`扩写正文到至少 ${params.minChapterWords} 字。`] : [],
    rewrite_mode: tooShort ? "light_fix" : "none",
    rewrite_prompt: tooShort ? `扩写第一章正文到至少 ${params.minChapterWords} 字，保留现有开篇设定、人物关系和情节方向。` : "",
    manual_fix_prompt: tooShort ? `第一章正文有效字数 ${wordCount}，低于最低要求 ${params.minChapterWords}。请扩写后重新运行 publish-ready。` : "",
    used_file: relative(params.bookDir, sourceFile),
    decision_source: "opening_chapter_baseline",
    body_source: bodySourceFromPath(sourceFile),
    stale_reports_ignored: [],
    word_count: wordCount,
    min_chapter_words: params.minChapterWords,
    length_status: tooShort ? "TOO_SHORT" : "PASS",
    publish_readiness: tooShort ? "BLOCKED" : "PASS",
    publish_blockers: tooShort
      ? [{ type: "TOO_SHORT", detail: `正文有效字数 ${wordCount}，低于最低要求 ${params.minChapterWords}` }]
      : [],
    fix_attempt: 0,
    max_fix_attempts: params.maxFixAttempts,
    final_status: "PASS",
  };
  await writeContinuityReportFiles(report, reportJsonPath, reportMarkdownPath, params.chapter, original.title);
  sourceChain.add(relative(params.bookDir, sourceFile));
  return {
    final: {
      chapter: params.chapter,
      chapterTitle: original.title,
      sourceFile,
      prevSourceFile: "",
      bodySource: bodySourceFromPath(sourceFile),
      fromExistingPass: false,
      reportedWarnings: [],
      report,
      reportJsonPath,
      reportMarkdownPath,
    },
    report,
  };
}

function extractFinalChapterBody(raw: string): string {
  const source = String(raw || "").replace(/\r\n/g, "\n");
  const chapterContentMatch = source.match(/^\s*(?:#{1,6}\s*)?(?:===\s*)?CHAPTER_CONTENT(?:\s*===)?\s*$/imu);
  if (chapterContentMatch?.index !== undefined) {
    const start = chapterContentMatch.index + chapterContentMatch[0].length;
    const rest = source.slice(start);
    const endMatch = rest.match(/^\s*(?:#{1,6}\s*)?(?:===\s*)?(?:PRE_WRITE_CHECK|CHAPTER_TITLE|ORIGINAL_PRE_WRITE_CHECK|REVIEW|AUDIT)(?:\s*===)?\s*$/imu);
    return rest.slice(0, endMatch?.index ?? rest.length);
  }
  return source;
}

function sanitizeReviewedFinalChapter(raw: string, chapter: number): string {
  const body = extractFinalChapterBody(raw)
    .replace(/^\s*---\s*\n[\s\S]*?\n---\s*/u, "")
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const value = line.trim();
      if (!value) return true;
      if (value === "---") return false;
      if (/^\|.*\|$/u.test(value)) return false;
      if (/^\|?\s*[-:]{3,}\s*(?:\|\s*[-:]{3,}\s*)+\|?$/u.test(value)) return false;
      if (/^(?:#{1,6}\s*)?(?:CHAPTER_CONTENT|PRE_WRITE_CHECK|CHAPTER_TITLE|ORIGINAL_PRE_WRITE_CHECK)(?:\s*===)?$/iu.test(value)) return false;
      if (/^(?:#{1,6}\s*)?第\s*0*\d+\s*章(?:\s+.*)?$/u.test(value)) return false;
      if (/^#{1,6}\s+/u.test(value)) return false;
      if (/^(?:检查项|检查结果|备注)\s*$/u.test(value)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!body) {
    throw new Error(`chapter ${chapterNumberPrefix(chapter)} final candidate is empty after CHAPTER_CONTENT extraction`);
  }
  return `${body}\n`;
}

async function writeReviewedFinalChapter(bookDir: string, chapter: number, sourceFile: string): Promise<string> {
  const outDir = join(bookDir, "chapters-reviewed");
  const outFile = join(outDir, `${chapterNumberPrefix(chapter)}_final.md`);
  await mkdir(outDir, { recursive: true });
  const raw = await readFile(sourceFile, "utf-8");
  const sanitized = sanitizeReviewedFinalChapter(raw, chapter);
  if (resolve(sourceFile) === resolve(outFile) && raw === sanitized) return outFile;
  await writeFile(outFile, sanitized, "utf-8");
  return outFile;
}

export function evaluatePublishReadyLengthGate(params: {
  readonly text: string;
  readonly targetChapterWords: number;
  readonly language: "zh" | "en";
}): PublishReadyLengthGate {
  const spec = buildLengthSpec(params.targetChapterWords, params.language);
  const count = countChapterLength(params.text, spec.countingMode);
  const countText = formatLengthCount(count, spec.countingMode);
  const targetText = formatLengthCount(spec.target, spec.countingMode);
  const hardMinText = formatLengthCount(spec.hardMin, spec.countingMode);
  const hardMaxText = formatLengthCount(spec.hardMax, spec.countingMode);
  const softMinText = formatLengthCount(spec.softMin, spec.countingMode);
  const softMaxText = formatLengthCount(spec.softMax, spec.countingMode);

  if (count < spec.hardMin || count > spec.hardMax) {
    return {
      status: "FAIL",
      count,
      target: spec.target,
      soft_min: spec.softMin,
      soft_max: spec.softMax,
      hard_min: spec.hardMin,
      hard_max: spec.hardMax,
      counting_mode: spec.countingMode,
      summary: `final length ${countText} is outside hard range ${hardMinText}-${hardMaxText} (target ${targetText}).`,
    };
  }

  if (count < spec.softMin || count > spec.softMax) {
    return {
      status: "WARN",
      count,
      target: spec.target,
      soft_min: spec.softMin,
      soft_max: spec.softMax,
      hard_min: spec.hardMin,
      hard_max: spec.hardMax,
      counting_mode: spec.countingMode,
      summary: `final length ${countText} is outside soft range ${softMinText}-${softMaxText} (target ${targetText}).`,
    };
  }

  return {
    status: "PASS",
    count,
    target: spec.target,
    soft_min: spec.softMin,
    soft_max: spec.softMax,
    hard_min: spec.hardMin,
    hard_max: spec.hardMax,
    counting_mode: spec.countingMode,
    summary: `final length ${countText} is within target range.`,
  };
}

/**
 * Build a length constraint block for inclusion in repair prompts.
 */
function buildRepairLengthConstraint(params: {
  readonly chapterText: string;
  readonly targetChapterWords: number;
  readonly language: "zh" | "en";
}): string {
  const spec = buildLengthSpec(params.targetChapterWords, params.language);
  const currentCount = countChapterLength(params.chapterText, spec.countingMode);
  const currentText = formatLengthCount(currentCount, spec.countingMode);
  const targetText = formatLengthCount(spec.target, spec.countingMode);
  const softMinText = formatLengthCount(spec.softMin, spec.countingMode);
  const softMaxText = formatLengthCount(spec.softMax, spec.countingMode);
  const hardMaxText = formatLengthCount(spec.hardMax, spec.countingMode);
  const overSoft = currentCount > spec.softMax;

  return `【字数约束】
- 目标字数：${targetText}
- 当前候选字数：${currentText}
- 最低字数要求：${softMinText}（不得低于此值）
${overSoft ? `- 诊断提示：当前已超过软上限 ${softMaxText}，如字数异常增长，应优先检查是否写入后续章节内容，而非简单压缩。\n` : ""}- 字数超出软上限不是错误，但不允许为了凑字数新增后续章节事件、未来人物或支线。
- 如果字数不足软下限，只能用当前章已有场景的动作、对话、心理、细节来扩展。`;
}

/**
 * Load chapter intent content for scope constraint building.
 */
async function loadChapterIntentContent(bookDir: string, chapter: number): Promise<string> {
  const intentPath = join(bookDir, "story", "runtime", "chapter-intents", `${chapterNumberPrefix(chapter)}.md`);
  try {
    return await readFile(intentPath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Build a scope constraint block for inclusion in repair prompts.
 */
function buildRepairScopeConstraint(intentContent: string): string {
  if (!intentContent.trim()) return "";
  return buildChapterRepairBoundaryBlock(intentContent);
}

/**
 * Build a structure signals scope constraint block.
 */
function buildRepairSignalsScopeConstraint(intentContent: string): string {
  if (!intentContent.trim()) return "";
  const base = buildStructureSignalsScopeConstraint(intentContent);
  return `${base}
【重要】以上信号词是审核器使用的维度指标，不是要求你把它们全部写入正文。
未在当前章 intent §12 中出现的书级信号，不得新增进当前章正文。
如果你不确定某个信号是否可用于当前章，宁可不用。`;
}

async function checkPublishReadyFinalLength(params: {
  readonly file: string;
  readonly targetChapterWords: number;
  readonly language: "zh" | "en";
}): Promise<PublishReadyLengthGate> {
  return evaluatePublishReadyLengthGate({
    text: await readFile(params.file, "utf-8"),
    targetChapterWords: params.targetChapterWords,
    language: params.language,
  });
}

export function applyPublishReadyLengthGate(
  publishStatus: PublishReadyStatus,
  existingWarnings: ReadonlyArray<string> | undefined,
  gate: PublishReadyLengthGate,
): { readonly publishStatus: PublishReadyStatus; readonly warnings: ReadonlyArray<string> | undefined } {
  const warnings = [...(existingWarnings ?? [])];
  if (gate.status === "FAIL") {
    // Length over hardMax is a diagnostic warning, not a hard block.
    // The root cause is input boundary violations, not length itself.
    warnings.push(`length_diagnostic: ${gate.summary}`);
    warnings.push("length_diagnostic: 字数超上限可能是输入越界的症状，请检查 scope_gate 和修稿输入边界。");
    // Downgrade READY_TO_EXPORT to READY_WITH_WARNINGS if needed
    if (publishStatus === "READY_TO_EXPORT") {
      return { publishStatus: "READY_WITH_WARNINGS", warnings: [...new Set(warnings)] };
    }
    return { publishStatus, warnings: [...new Set(warnings)] };
  }
  if (gate.status === "WARN") {
    warnings.push(`length_gate: ${gate.summary}`);
    const nextStatus = publishStatus === "READY_TO_EXPORT" ? "READY_WITH_WARNINGS" : publishStatus;
    return { publishStatus: nextStatus, warnings: [...new Set(warnings)] };
  }
  return { publishStatus, warnings: warnings.length ? [...new Set(warnings)] : existingWarnings };
}

export function applyPublishReadyScopeGate(
  publishStatus: PublishReadyStatus,
  existingWarnings: ReadonlyArray<string> | undefined,
  gate: ChapterScopeGateResult | undefined,
): { readonly publishStatus: PublishReadyStatus; readonly warnings: ReadonlyArray<string> | undefined } {
  if (!gate || gate.status === "PASS") {
    return { publishStatus, warnings: existingWarnings };
  }
  const warnings = [...(existingWarnings ?? [])];
  warnings.push(`scope_gate: ${gate.summary}`);
  if (gate.status === "FAIL") {
    const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
      || publishStatus === "BLOCKED_BY_CONTINUITY"
      || publishStatus === "BLOCKED_BY_QUALITY"
      || publishStatus === "BLOCKED_BY_LENGTH"
      || publishStatus === "NEED_REWRITE";
    return {
      publishStatus: hardBlocked ? publishStatus : "BLOCKED_BY_SCOPE",
      warnings: [...new Set(warnings)],
    };
  }
  if (gate.status === "WARN") {
    const nextStatus = publishStatus === "READY_TO_EXPORT" ? "READY_WITH_WARNINGS" : publishStatus;
    return { publishStatus: nextStatus, warnings: [...new Set(warnings)] };
  }
  return { publishStatus, warnings: warnings.length ? [...new Set(warnings)] : existingWarnings };
}

/**
 * Evaluate chapter scope gate against a final candidate.
 * Loads intent, pending hooks, and compares final text against original.
 */
async function evaluatePublishReadyScopeGate(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly finalText: string;
  readonly originalText?: string;
  readonly language: "zh" | "en";
}): Promise<ChapterScopeGateResult> {
  const intentContent = await loadChapterIntentContent(params.bookDir, params.chapter);
  if (!intentContent.trim()) {
    return { status: "PASS", issues: [], summary: "no chapter intent found; scope gate skipped." };
  }

  let pendingHooksContent = "";
  try {
    pendingHooksContent = await readFile(join(params.bookDir, "story", "pending_hooks.md"), "utf-8");
  } catch {
    // no pending hooks file
  }

  return evaluateChapterScopeGate({
    intentContent,
    chapterText: params.finalText,
    pendingHooksContent,
    chapterNumber: params.chapter,
    previousChapterText: params.originalText,
  });
}

async function getFileMtime(file: string): Promise<number> {
  try {
    const s = await stat(file);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

export async function resolvePublishReadyStartingCandidate(
  bookDir: string,
  chapter: number,
  originalFile: string,
  preferReviewedFinal = false,
): Promise<string> {
  if (preferReviewedFinal) {
    const reviewedFinal = await findReviewedFinalChapterFile(bookDir, chapter);
    if (reviewedFinal) return reviewedFinal;
  }

  const publishReady = await readPublishReadyReportIfExists(bookDir, chapter);
  if (publishReady && isExportablePublishStatus(String(publishReady.publish_status ?? "")) && typeof publishReady.final_candidate_file === "string") {
    const reviewed = resolveUsedFilePath(bookDir, publishReady.final_candidate_file);
    if (reviewed) return reviewed;
  }

  const candidates: string[] = [];

  const qualityFixed = await findLatestQualityFixedFile(bookDir, chapter);
  if (qualityFixed) candidates.push(qualityFixed);

  const polished = await findLatestPolishedFile(bookDir, chapter);
  if (polished) candidates.push(polished);

  const finalReport = await readContinuityReportIfExists(bookDir, chapter, "final-report");
  if (typeof finalReport?.used_file === "string") {
    const usedFile = resolveUsedFilePath(bookDir, finalReport.used_file);
    if (usedFile) candidates.push(usedFile);
  }

  candidates.push(originalFile);

  let bestFile = originalFile;
  let maxTime = 0;
  for (const file of candidates) {
    const time = await getFileMtime(file);
    if (time > maxTime) {
      maxTime = time;
      bestFile = file;
    }
  }

  return bestFile;
}


export async function findReviewedFinalChapterFile(bookDir: string, chapter: number): Promise<string | null> {
  const reviewedFinal = join(bookDir, "chapters-reviewed", `${chapterNumberPrefix(chapter)}_final.md`);
  return await fileExists(reviewedFinal) ? reviewedFinal : null;
}

export function canAcceptManualContinuity(
  status: string | undefined,
  acceptManualContinuity: boolean,
): boolean {
  return acceptManualContinuity && status === "MANUAL_REVIEW";
}

export function makeManualContinuityAcceptance(params: {
  readonly acceptManualContinuity: boolean;
  readonly report: ContinuityReport;
  readonly sourceFile: string;
  readonly bookDir: string;
  readonly reviewedFinalExists: boolean;
}): PublishReadyManualContinuityAcceptance | undefined {
  if (!canAcceptManualContinuity(params.report.final_status, params.acceptManualContinuity)) {
    return undefined;
  }
  return {
    manualContinuityAccepted: true,
    manualContinuityAcceptedReason: "MANUAL_REVIEW accepted by explicit CLI flag",
    continuityStatusBeforeManualAccept: "MANUAL_REVIEW",
    continuityScoreBeforeManualAccept: params.report.score,
    acceptedContinuityFile: relative(params.bookDir, params.sourceFile),
    reviewedFinalExists: params.reviewedFinalExists,
  };
}

async function tryWriteAcceptedExistingCandidate(
  params: {
    readonly bookId: string;
    readonly bookDir: string;
    readonly chapter: number;
  readonly qualityPassThreshold: number;
  readonly qualityAcceptThreshold: number;
  readonly minChapterWords: number;
  readonly targetChapterWords: number;
  readonly language: "zh" | "en";
  },
  candidateFile: string,
  sourceChain: Set<string>,
): Promise<PublishReadyResult | null> {
  const publishReport = await readPublishReadyReportIfExists(params.bookDir, params.chapter);
  const qualityReport = await readQualityReportIfExists(params.bookDir, params.chapter, "final-quality-report")
    ?? await readQualityReportIfExists(params.bookDir, params.chapter, "quality-report");
  const continuityReport = await readContinuityReportIfExists(params.bookDir, params.chapter, "final-report");
  const continuityStatus = publishReport?.continuity?.final_status ?? continuityReport?.final_status ?? continuityReport?.status;
  const wordCount = Number(publishReport?.word_count ?? continuityReport?.word_count ?? 0);
  const qualityScore = Number(qualityReport?.final_quality_score ?? qualityReport?.quality_score ?? publishReport?.quality?.score ?? 0);
  const qualityDecision = decidePublishQuality(qualityScore, params.qualityPassThreshold, params.qualityAcceptThreshold);

  if (continuityStatus !== "PASS") return null;
  if (!Number.isFinite(wordCount) || wordCount < params.minChapterWords) return null;
  if (qualityDecision !== "QUALITY_PASS" && qualityDecision !== "QUALITY_WARN_POLISH_OPTIONAL") return null;
  if (!existsSync(candidateFile)) return null;
  // Do not short-circuit if the previous publish report was not exportable (e.g. MANUAL_REVIEW
  // due to structure scores below threshold). Re-running without changes must not bypass gates.
  if (publishReport?.publish_status && !isExportablePublishStatus(String(publishReport.publish_status))) return null;

  sourceChain.add(relative(params.bookDir, candidateFile));
  const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, candidateFile);
  sourceChain.add(relative(params.bookDir, finalFile));
  const lengthGate = await checkPublishReadyFinalLength({
    file: finalFile,
    targetChapterWords: params.targetChapterWords,
    language: params.language,
  });
  const lengthDecision = applyPublishReadyLengthGate(
    publishStatusForQualityDecision(qualityDecision),
    qualityWarnings(qualityDecision, qualityScore, params.qualityPassThreshold),
    lengthGate,
  );
  return writePublishReadyReport(params.bookDir, {
    book: params.bookId,
    chapter_index: params.chapter,
    publish_status: lengthDecision.publishStatus,
    final_candidate_file: relative(params.bookDir, finalFile),
    source_chain: [...sourceChain],
    continuity: { final_status: "PASS", score: publishReport?.continuity?.score ?? continuityReport?.score },
    quality: { final_quality_status: qualityReport?.final_quality_status ?? publishReport?.quality?.final_quality_status ?? qualityFinalStatusFromDecision(qualityDecision), score: qualityScore },
    quality_decision: qualityDecision,
    quality_score: qualityScore,
    quality_pass_threshold: params.qualityPassThreshold,
    quality_accept_threshold: params.qualityAcceptThreshold,
    accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
    warnings: lengthDecision.warnings,
    source_file: relative(params.bookDir, candidateFile),
    word_count: lengthGate.count,
    min_chapter_words: params.minChapterWords,
    target_chapter_words: params.targetChapterWords,
    max_chapter_words: lengthGate.hard_max,
    length_gate: lengthGate,
    report_json_path: "",
    report_markdown_path: "",
  });
}

function isReadyToExport(
  continuity: ContinuityReport,
  qualityDecision: string | undefined,
  finalFile: string,
  minChapterWords: number,
  manualContinuityAccepted = false,
): boolean {
  return (continuity.final_status === "PASS" || manualContinuityAccepted && continuity.final_status === "MANUAL_REVIEW")
    && (qualityDecision === "QUALITY_PASS" || qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL")
    && (continuity.word_count ?? 0) >= minChapterWords
    && existsSync(finalFile);
}

export function decidePublishQuality(score: number, passThreshold: number, acceptThreshold: number): PublishQualityDecision {
  if (score >= passThreshold) return "QUALITY_PASS";
  if (score >= Math.max(80, acceptThreshold)) return "QUALITY_WARN_POLISH_OPTIONAL";
  // Scores above 75 (hard floor) but below acceptThreshold are review-able, not rewrite-worthy
  if (score >= 75) return "QUALITY_MANUAL_REVIEW";
  return "NEED_REWRITE";
}

function qualityFinalStatusFromDecision(decision: PublishQualityDecision): FanqieFinalQualityStatus {
  if (decision === "QUALITY_PASS") return "QUALITY_PASS";
  if (decision === "QUALITY_WARN_POLISH_OPTIONAL") return "QUALITY_WARN_POLISH_OPTIONAL";
  return "QUALITY_MANUAL_REVIEW";
}

function publishStatusForQualityDecision(decision: PublishQualityDecision): "READY_TO_EXPORT" | "READY_WITH_WARNINGS" {
  return decision === "QUALITY_WARN_POLISH_OPTIONAL" ? "READY_WITH_WARNINGS" : "READY_TO_EXPORT";
}

function isExportablePublishStatus(status: PublishReadyStatus | string): boolean {
  return status === "READY_TO_EXPORT" || status === "READY_WITH_WARNINGS";
}

export function applyStoryEffectivenessDecision(
  publishStatus: string,
  existingWarnings: ReadonlyArray<string> | undefined,
  seSummary: { status: string; score: number | null; summary: string } | undefined,
): { publishStatus: string; warnings: ReadonlyArray<string> | undefined } {
  if (!seSummary || seSummary.status === "PASS" || seSummary.status === "SKIPPED") {
    return { publishStatus, warnings: existingWarnings };
  }

  const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
    || publishStatus === "BLOCKED_BY_CONTINUITY"
    || publishStatus === "BLOCKED_BY_QUALITY"
    || publishStatus === "BLOCKED_BY_LENGTH"
    || publishStatus === "NEED_REWRITE";

  // Never override existing hard blocks
  if (hardBlocked) {
    return { publishStatus, warnings: existingWarnings };
  }

  const seWarning = `story-effectiveness: ${seSummary.summary} (score: ${seSummary.score ?? "n/a"})`;
  const warnings = existingWarnings ? [...existingWarnings, seWarning] : [seWarning];

  if (seSummary.status === "WARN") {
    // Append warnings, don't change publish_status
    return { publishStatus, warnings };
  }

  if (seSummary.status === "FAIL_STRUCTURAL") {
    // Turn exportable into MANUAL_REVIEW; already-MANUAL_REVIEW stays
    if (publishStatus === "READY_TO_EXPORT" || publishStatus === "READY_WITH_WARNINGS") {
      return { publishStatus: "MANUAL_REVIEW", warnings };
    }
    return { publishStatus, warnings };
  }

  return { publishStatus, warnings: existingWarnings };
}

export function applyGolden3ChapterDecision(
  publishStatus: string,
  existingWarnings: ReadonlyArray<string> | undefined,
  gcSummary: { status: string; score: number | null; summary: string } | undefined,
): { publishStatus: string; warnings: ReadonlyArray<string> | undefined } {
  if (!gcSummary || gcSummary.status === "PASS" || gcSummary.status === "SKIPPED") {
    return { publishStatus, warnings: existingWarnings };
  }

  const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
    || publishStatus === "BLOCKED_BY_CONTINUITY"
    || publishStatus === "BLOCKED_BY_QUALITY"
    || publishStatus === "BLOCKED_BY_LENGTH"
    || publishStatus === "NEED_REWRITE";

  // Never override existing hard blocks
  if (hardBlocked) {
    return { publishStatus, warnings: existingWarnings };
  }

  const gcWarning = `golden-3-chapter: ${gcSummary.summary} (score: ${gcSummary.score ?? "n/a"})`;
  const warnings = existingWarnings ? [...existingWarnings, gcWarning] : [gcWarning];

  if (gcSummary.status === "WARN") {
    // Append warnings, don't change publish_status
    return { publishStatus, warnings };
  }

  if (gcSummary.status === "FAIL_STRUCTURAL") {
    // Turn exportable into MANUAL_REVIEW; already-MANUAL_REVIEW stays
    if (publishStatus === "READY_TO_EXPORT" || publishStatus === "READY_WITH_WARNINGS") {
      return { publishStatus: "MANUAL_REVIEW", warnings };
    }
    return { publishStatus, warnings };
  }

  return { publishStatus, warnings: existingWarnings };
}

export function applyOpeningHookDecision(
  publishStatus: string,
  existingWarnings: ReadonlyArray<string> | undefined,
  ohSummary: { status: string; score: number | null; summary: string } | undefined,
): { publishStatus: string; warnings: ReadonlyArray<string> | undefined } {
  if (!ohSummary || ohSummary.status === "PASS" || ohSummary.status === "SKIPPED") {
    return { publishStatus, warnings: existingWarnings };
  }

  const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
    || publishStatus === "BLOCKED_BY_CONTINUITY"
    || publishStatus === "BLOCKED_BY_QUALITY"
    || publishStatus === "NEED_REWRITE";

  // Never override existing hard blocks
  if (hardBlocked) {
    return { publishStatus, warnings: existingWarnings };
  }

  const ohWarning = `opening-hook: ${ohSummary.summary} (score: ${ohSummary.score ?? "n/a"})`;
  const warnings = existingWarnings ? [...existingWarnings, ohWarning] : [ohWarning];

  if (ohSummary.status === "WARN") {
    return { publishStatus, warnings };
  }

  if (ohSummary.status === "FAIL_STRUCTURAL") {
    if (publishStatus === "READY_TO_EXPORT" || publishStatus === "READY_WITH_WARNINGS") {
      return { publishStatus: "MANUAL_REVIEW", warnings };
    }
    return { publishStatus, warnings };
  }

  return { publishStatus, warnings: existingWarnings };
}

export function applyAntagonistIntelligenceDecision(
  publishStatus: string,
  existingWarnings: ReadonlyArray<string> | undefined,
  aiSummary: { status: string; score: number | null; summary: string } | undefined,
): { publishStatus: string; warnings: ReadonlyArray<string> | undefined } {
  if (!aiSummary || aiSummary.status === "PASS" || aiSummary.status === "SKIPPED") {
    return { publishStatus, warnings: existingWarnings };
  }

  const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
    || publishStatus === "BLOCKED_BY_CONTINUITY"
    || publishStatus === "BLOCKED_BY_QUALITY"
    || publishStatus === "NEED_REWRITE";

  // Never override existing hard blocks
  if (hardBlocked) {
    return { publishStatus, warnings: existingWarnings };
  }

  const aiWarning = `antagonist-intelligence: ${aiSummary.summary} (score: ${aiSummary.score ?? "n/a"})`;
  const warnings = existingWarnings ? [...existingWarnings, aiWarning] : [aiWarning];

  if (aiSummary.status === "WARN") {
    return { publishStatus, warnings };
  }

  if (aiSummary.status === "FAIL_REPORT_ONLY") {
    if (publishStatus === "READY_TO_EXPORT" || publishStatus === "READY_WITH_WARNINGS") {
      return { publishStatus: "MANUAL_REVIEW", warnings };
    }
    return { publishStatus, warnings };
  }

  return { publishStatus, warnings: existingWarnings };
}

export function applyTransitionQualityDecision(
  publishStatus: string,
  existingWarnings: ReadonlyArray<string> | undefined,
  tqSummary: { status: string; score: number | null; summary: string } | undefined,
): { publishStatus: string; warnings: ReadonlyArray<string> | undefined } {
  if (!tqSummary || tqSummary.status === "PASS" || tqSummary.status === "SKIPPED") {
    return { publishStatus, warnings: existingWarnings };
  }

  const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
    || publishStatus === "BLOCKED_BY_CONTINUITY"
    || publishStatus === "BLOCKED_BY_QUALITY"
    || publishStatus === "NEED_REWRITE";

  // Never override existing hard blocks
  if (hardBlocked) {
    return { publishStatus, warnings: existingWarnings };
  }

  const tqWarning = `transition-quality: ${tqSummary.summary} (score: ${tqSummary.score ?? "n/a"})`;
  const warnings = existingWarnings ? [...existingWarnings, tqWarning] : [tqWarning];

  if (tqSummary.status === "WARN") {
    return { publishStatus, warnings };
  }

  if (tqSummary.status === "FAIL_STRUCTURAL") {
    if (publishStatus === "READY_TO_EXPORT" || publishStatus === "READY_WITH_WARNINGS") {
      return { publishStatus: "MANUAL_REVIEW", warnings };
    }
    return { publishStatus, warnings };
  }

  return { publishStatus, warnings: existingWarnings };
}

export function applySixStepPlotDecision(
  publishStatus: string,
  existingWarnings: ReadonlyArray<string> | undefined,
  ssSummary: { status: string; score: number | null; summary: string } | undefined,
): { publishStatus: string; warnings: ReadonlyArray<string> | undefined } {
  if (!ssSummary || ssSummary.status === "PASS" || ssSummary.status === "SKIPPED") {
    return { publishStatus, warnings: existingWarnings };
  }

  const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
    || publishStatus === "BLOCKED_BY_CONTINUITY"
    || publishStatus === "BLOCKED_BY_QUALITY"
    || publishStatus === "NEED_REWRITE";

  // Never override existing hard blocks
  if (hardBlocked) {
    return { publishStatus, warnings: existingWarnings };
  }

  const ssWarning = `six-step-plot: ${ssSummary.summary} (score: ${ssSummary.score ?? "n/a"})`;
  const warnings = existingWarnings ? [...existingWarnings, ssWarning] : [ssWarning];

  if (ssSummary.status === "WARN") {
    return { publishStatus, warnings };
  }

  if (ssSummary.status === "FAIL_STRUCTURAL") {
    if (publishStatus === "READY_TO_EXPORT" || publishStatus === "READY_WITH_WARNINGS") {
      return { publishStatus: "MANUAL_REVIEW", warnings };
    }
    return { publishStatus, warnings };
  }

  return { publishStatus, warnings: existingWarnings };
}

function applyStructureScoreGate(
  publishStatus: string,
  existingWarnings: ReadonlyArray<string> | undefined,
  summaries: ReadonlyArray<{
    readonly name: string;
    readonly summary?: { readonly status: string; readonly score: number | null; readonly summary: string };
  }>,
  passThreshold: number,
  acceptThreshold: number,
): { publishStatus: string; warnings: ReadonlyArray<string> | undefined } {
  const hardBlocked = publishStatus === "BLOCKED_BY_RESOURCE"
    || publishStatus === "BLOCKED_BY_CONTINUITY"
    || publishStatus === "BLOCKED_BY_QUALITY"
    || publishStatus === "NEED_REWRITE";
  if (hardBlocked) return { publishStatus, warnings: existingWarnings };

  let nextStatus = publishStatus;
  const warnings = [...(existingWarnings ?? [])];

  for (const item of summaries) {
    const summary = item.summary;
    if (!summary || summary.status === "SKIPPED" || summary.score === null) continue;
    if (summary.score < acceptThreshold) {
      warnings.push(`${item.name}: score ${summary.score} is below accepted ${acceptThreshold}; structure fix is required before export.`);
      if (nextStatus === "READY_TO_EXPORT" || nextStatus === "READY_WITH_WARNINGS") {
        nextStatus = "MANUAL_REVIEW";
      }
    } else if (summary.score < passThreshold) {
      warnings.push(`${item.name}: score ${summary.score} is below ideal ${passThreshold}; export is allowed with warning.`);
      if (nextStatus === "READY_TO_EXPORT") nextStatus = "READY_WITH_WARNINGS";
    }
  }

  return {
    publishStatus: nextStatus,
    warnings: warnings.length ? [...new Set(warnings)] : existingWarnings,
  };
}

function qualityWarnings(decision: PublishQualityDecision, score: number, passThreshold: number): ReadonlyArray<string> | undefined {
  return decision === "QUALITY_WARN_POLISH_OPTIONAL"
    ? [`quality_score ${score} is below ideal ${passThreshold}; polish is optional before export.`]
    : undefined;
}

async function writePublishReadyReport(bookDir: string, report: PublishReadyResult): Promise<PublishReadyResult> {
  const reportDir = join(bookDir, "reviews", "publish-ready");
  const prefix = chapterNumberPrefix(report.chapter_index);
  const jsonPath = join(reportDir, `${prefix}.publish-report.json`);
  const markdownPath = join(reportDir, `${prefix}.publish-report.md`);

  // Load book-level structure signals (not genre profile) for structure review
  const signalsResult = await readStructureSignals(bookDir);
  let signalSource: string;
  let signalError: string | undefined;
  let signalMatchedTotal = 0;
  let signalMissingTotal = 0;
  let signalDimensionsCount = 0;
  const signalDimensionDetails: { dimension: string; matched: number; missing: number }[] = [];

  if (signalsResult.status === "ok") {
    signalSource = "structure_signals.json";
    const dims = Object.entries(signalsResult.signals.signals) as [string, string[]][];
    signalDimensionsCount = dims.filter(([, phrases]) => phrases.length > 0).length;

    // Resolve chapter content to compute actual matched/missing
    try {
      const resolved = await resolveContentForTransitionQuality(
        bookDir,
        report.chapter_index,
        report.final_candidate_file || undefined,
        report.source_file || undefined,
      );
      if (resolved) {
        const matches = matchStructureSignals(resolved.content, signalsResult.signals, STRUCTURE_SIGNAL_DIMENSIONS);
        signalMatchedTotal = matches.reduce((sum, m) => sum + m.matched.length, 0);
        signalMissingTotal = matches.reduce((sum, m) => sum + m.missing.length, 0);
        for (const m of matches) {
          if (m.matched.length > 0 || m.missing.length > 0) {
            signalDimensionDetails.push({ dimension: m.dimension, matched: m.matched.length, missing: m.missing.length });
          }
        }
      }
    } catch {
      // If content resolution fails, leave totals at 0
    }
  } else {
    signalSource = signalsResult.status;
    signalError = signalsResult.error;
  }

  // Extract signals for passing to generate functions
  let activeSignals: StructureSignals | undefined =
    signalsResult.status === "ok" ? signalsResult.signals : undefined;

  // Merge chapter-intent signal keywords (§12) into activeSignals if available
  if (activeSignals) {
    const intentPrefix = chapterNumberPrefix(report.chapter_index);
    try {
      const intentPath = join(bookDir, "story", "runtime", "chapter-intents", `${intentPrefix}.md`);
      const intentContent = await readFile(intentPath, "utf-8").catch(() => "");
      if (intentContent) {
        const merged = mergeIntentSignals(activeSignals, intentContent);
        if (merged) activeSignals = merged;
      }
    } catch {
      // chapter-intent not available; proceed with book-level signals only
    }
  }

  // Merge story-effectiveness summary if not already provided
  let seSummary = report.story_effectiveness ?? await readStoryEffectivenessSummary(bookDir, report.chapter_index);

  // If no existing story-effectiveness report and not resource-blocked, generate one from chapter content
  if (!seSummary && report.publish_status !== "BLOCKED_BY_RESOURCE") {
    try {
      const resolved = await resolveContentForTransitionQuality(
        bookDir,
        report.chapter_index,
        report.final_candidate_file || undefined,
        report.source_file || undefined,
      );
      if (resolved) {
        seSummary = await generateStoryEffectivenessReport(bookDir, report.chapter_index, resolved.content, activeSignals);
      }
    } catch {
      // If we can't find any chapter content, skip generation
    }
  }

  // Apply story-effectiveness decision semantics (see applyStoryEffectivenessDecision for details)
  const seDecision = applyStoryEffectivenessDecision(report.publish_status, report.warnings, seSummary);

  // Merge golden-3-chapter summary (only for ch1-3)
  const gcSummary = report.chapter_index >= 1 && report.chapter_index <= 3
    ? (report.golden_3_chapter ?? await readGolden3ChapterSummary(bookDir))
    : undefined;

  // Apply golden-3-chapter decision semantics (same pattern: WARN→warning, FAIL_STRUCTURAL→MANUAL_REVIEW, no hard block override)
  // Important: use the result of story-effectiveness decision as input, so both can contribute
  const gcDecision = applyGolden3ChapterDecision(seDecision.publishStatus, seDecision.warnings, gcSummary);

  // Merge opening-hook summary (all chapters)
  let ohSummary = report.opening_hook ?? await readOpeningHookSummaryLocal(bookDir, report.chapter_index);

  // If no existing opening-hook report and not resource-blocked, generate one from chapter content
  if (!ohSummary && report.publish_status !== "BLOCKED_BY_RESOURCE") {
    try {
      const resolved = await resolveContentForTransitionQuality(
        bookDir,
        report.chapter_index,
        report.final_candidate_file || undefined,
        report.source_file || undefined,
      );
      if (resolved) {
        ohSummary = await generateOpeningHookReport(bookDir, report.chapter_index, resolved.content, undefined, activeSignals);
      }
    } catch {
      // If we can't find any chapter content, skip generation
    }
  }

  // Apply opening-hook decision semantics (same pattern, chain after SE and golden_3)
  const ohDecision = applyOpeningHookDecision(gcDecision.publishStatus, gcDecision.warnings, ohSummary);

  // Merge antagonist-intelligence summary (all chapters)
  let aiSummary = report.antagonist_intelligence ?? await readAntagonistIntelligenceSummaryLocal(bookDir, report.chapter_index);

  // If no existing antagonist-intelligence report and not resource-blocked, generate one from chapter content
  if (!aiSummary && report.publish_status !== "BLOCKED_BY_RESOURCE") {
    try {
      const resolved = await resolveContentForTransitionQuality(
        bookDir,
        report.chapter_index,
        report.final_candidate_file || undefined,
        report.source_file || undefined,
      );
      if (resolved) {
        aiSummary = await generateAntagonistIntelligenceReport(bookDir, report.chapter_index, resolved.content);
      }
    } catch {
      // If we can't find any chapter content, skip generation
    }
  }

  // Apply antagonist-intelligence decision semantics (chain after opening-hook)
  const aiDecision = applyAntagonistIntelligenceDecision(ohDecision.publishStatus, ohDecision.warnings, aiSummary);

  // Merge transition-quality summary (all chapters)
  let tqSummary = report.transition_quality ?? await readTransitionQualitySummaryLocal(bookDir, report.chapter_index);

  // If no existing transition-quality report and not resource-blocked, generate one from chapter content
  if (!tqSummary && report.publish_status !== "BLOCKED_BY_RESOURCE") {
    try {
      const resolved = await resolveContentForTransitionQuality(
        bookDir,
        report.chapter_index,
        report.final_candidate_file || undefined,
        report.source_file || undefined,
      );
      if (resolved) {
        tqSummary = await generateTransitionQualityReport(bookDir, report.chapter_index, resolved.content);
      }
    } catch {
      // If we can't find any chapter content, skip generation
    }
  }

  // Apply transition-quality decision semantics (chain after antagonist-intelligence)
  const tqDecision = applyTransitionQualityDecision(aiDecision.publishStatus, aiDecision.warnings, tqSummary);

  // Merge six-step-plot summary (all chapters)
  let ssSummary = report.six_step_plot ?? await readSixStepPlotSummaryLocal(bookDir, report.chapter_index);

  // If no existing six-step-plot report and not resource-blocked, generate one from chapter content
  if (!ssSummary && report.publish_status !== "BLOCKED_BY_RESOURCE") {
    try {
      const resolved = await resolveContentForTransitionQuality(
        bookDir,
        report.chapter_index,
        report.final_candidate_file || undefined,
        report.source_file || undefined,
      );
      if (resolved) {
        ssSummary = await generateSixStepPlotReport(bookDir, report.chapter_index, resolved.content, undefined, activeSignals);
      }
    } catch {
      // If we can't find any chapter content, skip generation
    }
  }

  // Apply six-step-plot decision semantics (chain after transition-quality)
  const ssDecision = applySixStepPlotDecision(tqDecision.publishStatus, tqDecision.warnings, ssSummary);
  const structurePassThreshold = report.structure_pass_threshold ?? DEFAULT_STRUCTURE_PASS_THRESHOLD;
  const structureAcceptThreshold = report.structure_accept_threshold ?? DEFAULT_STRUCTURE_ACCEPT_THRESHOLD;
  const structureDecision = applyStructureScoreGate(
    ssDecision.publishStatus,
    ssDecision.warnings,
    [
      { name: "story-effectiveness", summary: seSummary },
      { name: "golden-3-chapter", summary: gcSummary },
      { name: "opening-hook", summary: ohSummary },
      { name: "antagonist-intelligence", summary: aiSummary },
      { name: "transition-quality", summary: tqSummary },
      { name: "six-step-plot", summary: ssSummary },
    ],
    structurePassThreshold,
    structureAcceptThreshold,
  );

  const finalReport = {
    ...report,
    story_effectiveness: seSummary,
    golden_3_chapter: gcSummary,
    opening_hook: ohSummary,
    antagonist_intelligence: aiSummary,
    transition_quality: tqSummary,
    six_step_plot: ssSummary,
    publish_status: structureDecision.publishStatus as PublishReadyResult["publish_status"],
    warnings: signalError
      ? [...(structureDecision.warnings ?? []), `structure_signals: ${signalError}`]
      : structureDecision.warnings,
    structure_pass_threshold: structurePassThreshold,
    structure_accept_threshold: structureAcceptThreshold,
    final_candidate_file: report.final_candidate_file
      ? `books/${report.book}/${report.final_candidate_file}`
      : "",
    source_file: report.source_file
      ? `books/${report.book}/${report.source_file}`
      : report.source_file,
    report_json_path: jsonPath,
    report_markdown_path: markdownPath,
    structure_signals_source: signalSource,
    structure_signals_error: signalError,
    structure_signals_matched: signalMatchedTotal,
    structure_signals_missing: signalMissingTotal,
    structure_signals_dimensions: signalDimensionsCount,
    structure_signals_dimension_details: signalDimensionDetails.length ? signalDimensionDetails : undefined,
  };
  await mkdir(reportDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderPublishReadyMarkdown(finalReport), "utf-8");
  return finalReport;
}

export function renderPublishReadyMarkdown(report: PublishReadyResult): string {
  const chain = report.source_chain.length ? report.source_chain.map((item) => `- ${item}`).join("\n") : "- 无";
  return `# Publish Ready Report

- book: ${report.book}
- chapter: ${chapterNumberPrefix(report.chapter_index)}
- publish_status: ${report.publish_status}
- final_candidate_file: ${report.final_candidate_file || "无"}
- continuity: ${report.continuity.final_status ?? "UNKNOWN"} (${report.continuity.score ?? "n/a"})
- quality: ${report.quality.final_quality_status ?? "UNKNOWN"} (${report.quality.score ?? "n/a"})
- quality_decision: ${report.quality_decision ?? "UNKNOWN"}
- quality_score: ${report.quality_score ?? "n/a"}
- quality_pass_threshold: ${report.quality_pass_threshold ?? "n/a"}
- quality_accept_threshold: ${report.quality_accept_threshold ?? "n/a"}
${report.accepted_reason ? `- accepted_reason: ${report.accepted_reason}\n` : ""}${report.manualContinuityAccepted ? `- manualContinuityAccepted: true
- manualContinuityAcceptedReason: ${report.manualContinuityAcceptedReason}
- continuityStatusBeforeManualAccept: ${report.continuityStatusBeforeManualAccept}
- continuityScoreBeforeManualAccept: ${report.continuityScoreBeforeManualAccept ?? "n/a"}
- acceptedContinuityFile: ${report.acceptedContinuityFile}
- reviewedFinalExists: ${report.reviewedFinalExists ? "true" : "false"}
` : ""}${report.continuityOverride ? `- continuityOverride: ${report.continuityOverride}
- continuityOverrideReason: ${report.continuityOverrideReason ?? "n/a"}
` : ""}${report.warnings?.length ? `- warnings:\n${report.warnings.map((warning) => `  - ${warning}`).join("\n")}\n` : ""}${report.source_file ? `- source_file: ${report.source_file}\n` : ""}- word_count: ${report.word_count ?? "n/a"}/${report.min_chapter_words}
- target_chapter_words: ${report.target_chapter_words ?? "n/a"}
- max_chapter_words: ${report.max_chapter_words ?? "n/a"}${report.length_gate ? `
- length_gate: ${report.length_gate.status} (${report.length_gate.summary})` : ""}${report.story_effectiveness ? `
- story_effectiveness: ${report.story_effectiveness.status} (${report.story_effectiveness.score ?? "n/a"})
  ${report.story_effectiveness.summary}` : ""}${report.golden_3_chapter ? `
- golden_3_chapter: ${report.golden_3_chapter.status} (${report.golden_3_chapter.score ?? "n/a"})
  ${report.golden_3_chapter.summary}` : ""}${report.opening_hook ? `
- opening_hook: ${report.opening_hook.status} (${report.opening_hook.score ?? "n/a"})
  ${report.opening_hook.summary}` : ""}${report.antagonist_intelligence ? `
- antagonist_intelligence: ${report.antagonist_intelligence.status} (${report.antagonist_intelligence.score ?? "n/a"})
  ${report.antagonist_intelligence.summary}` : ""}${report.transition_quality ? `
- transition_quality: ${report.transition_quality.status} (${report.transition_quality.score ?? "n/a"})
  ${report.transition_quality.summary}` : ""}${report.six_step_plot ? `
- six_step_plot: ${report.six_step_plot.status} (${report.six_step_plot.score ?? "n/a"})
  ${report.six_step_plot.summary}` : ""}
- structure_signals_source: ${report.structure_signals_source ?? "none"}${report.structure_signals_error ? `
- structure_signals_error: ${report.structure_signals_error}` : ""}${report.structure_signals_dimensions != null ? `
- structure_signals_dimensions: ${report.structure_signals_dimensions}
- structure_signals_matched: ${report.structure_signals_matched ?? 0}
- structure_signals_missing: ${report.structure_signals_missing ?? 0}${report.structure_signals_dimension_details ? `
- structure_signals_dimension_details:
${report.structure_signals_dimension_details.map((d) => `  - ${d.dimension}: matched=${d.matched} missing=${d.missing}`).join("\n")}` : ""}` : ""}

## Source Chain

${chain}
`;
}

async function runQualityAutoFixChapter(params: {
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly maxQualityFixAttempts: number;
  readonly qualityFixThreshold: number;
  readonly qualityPassThreshold: number;
  readonly qualityAcceptThreshold: number;
  readonly minChapterWords: number;
  readonly targetChapterWords: number;
  readonly language: "zh" | "en";
  readonly maxFixAttempts: number;
  readonly json: boolean;
}): Promise<QualityAutoFixResult> {
  const context = await resolveQualityAutoFixContext(
    params.bookDir,
    params.chapter,
    params.minChapterWords,
    params.qualityFixThreshold,
    params.qualityAcceptThreshold,
  );
  if (!context.eligible) {
      const result = await writeQualityFixReport(params.bookDir, {
      book: params.bookId,
      chapter_index: params.chapter,
      publish_status: context.publishStatus,
      input_file: context.inputFile ? relative(params.bookDir, context.inputFile) : "",
      output_file: "",
      quality_score_before: context.qualityScore,
      final_candidate_file: "",
      report_json_path: "",
      report_markdown_path: "",
      skipped_reason: context.reason,
    });
    if (context.publishStatus === "NEED_REWRITE") {
      await writePublishReadyReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: "NEED_REWRITE",
        final_candidate_file: "",
        source_chain: context.sourceChain,
        continuity: context.publishReport?.continuity ?? {},
        quality: { final_quality_status: context.qualityReport?.final_quality_status, score: context.qualityScore },
        quality_decision: "NEED_REWRITE",
        quality_score: context.qualityScore,
        quality_pass_threshold: params.qualityPassThreshold,
        quality_accept_threshold: params.qualityAcceptThreshold,
        source_file: context.inputFile ? relative(params.bookDir, context.inputFile) : "",
        word_count: context.publishReport?.word_count,
        min_chapter_words: params.minChapterWords,
        report_json_path: "",
        report_markdown_path: "",
      });
    }
    return result;
  }

  let outputFile = "";
  let qualityAfter: FanqieQualityCommandResult | undefined;
  let continuityAfter: { readonly final: ContinuityCommandResult; readonly report: ContinuityReport } | undefined;
  const sourceChain = new Set(context.sourceChain);
  sourceChain.add(relative(params.bookDir, context.inputFile));

  // Compute length/scope constraints for quality-auto-fix
  const qaCurrentText = await readFile(context.inputFile, "utf-8");
  const qaLengthConstraint = buildRepairLengthConstraint({
    chapterText: qaCurrentText,
    targetChapterWords: params.targetChapterWords,
    language: params.language as "zh" | "en",
  });
  const qaScopeContent = await loadChapterIntentContent(params.bookDir, params.chapter);
  const qaScopeConstraint = buildRepairScopeConstraint(qaScopeContent);
  const qaSignalsScopeConstraint = buildRepairSignalsScopeConstraint(qaScopeContent);

  for (let attempt = 1; attempt <= params.maxQualityFixAttempts; attempt += 1) {
    if (!params.json) log(`attempt ${attempt}/${params.maxQualityFixAttempts} -> fixing...`);
    outputFile = await writeQualityFixedChapter({
      bookDir: params.bookDir,
      chapter: params.chapter,
      attempt,
      client: params.client,
      model: params.model,
      currentText: qaCurrentText,
      qualityReport: context.qualityReport!,
      lengthConstraint: `${qaLengthConstraint}\n\n${qaSignalsScopeConstraint}`,
      scopeConstraint: qaScopeConstraint,
    });
    sourceChain.add(relative(params.bookDir, outputFile));

    qualityAfter = await checkFanqieQualityChapter({
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter: params.chapter,
      client: params.client,
      model: params.model,
      currentOverridePath: outputFile,
      reportKind: "final-quality-report",
      finalQualityStatus: undefined,
      usedPolishedFile: relative(params.bookDir, outputFile),
    });
    const qualityDecision = decidePublishQuality(qualityAfter.report.quality_score, params.qualityPassThreshold, params.qualityAcceptThreshold);
    const finalQualityStatus = qualityFinalStatusFromDecision(qualityDecision);
    const finalQualityReport = markFinalFanqieQualityReport(qualityAfter.report, {
      polishAttempt: 0,
      maxPolishAttempts: 0,
      finalQualityScore: qualityAfter.report.quality_score,
      finalQualityStatus,
      usedPolishedFile: relative(params.bookDir, outputFile),
    });
    await writeFanqieQualityReportFiles(
      finalQualityReport,
      fanqieFinalReportPaths(params.bookDir, params.chapter).jsonPath,
      fanqieFinalReportPaths(params.bookDir, params.chapter).markdownPath,
    );

    continuityAfter = await runContinuityPublishPass(params, outputFile, sourceChain);
    sourceChain.add(relative(params.bookDir, continuityAfter.final.sourceFile));

    if ((qualityDecision === "QUALITY_PASS" || qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL") && continuityAfter.report.final_status === "PASS") {
      const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, continuityAfter.final.sourceFile);
      sourceChain.add(relative(params.bookDir, finalFile));
      const readyToExport = isReadyToExport(continuityAfter.report, qualityDecision, finalFile, params.minChapterWords);
      const lengthGate = await checkPublishReadyFinalLength({
        file: finalFile,
        targetChapterWords: params.targetChapterWords,
        language: params.language,
      });
      const lengthDecision = applyPublishReadyLengthGate(
        readyToExport
          ? publishStatusForQualityDecision(qualityDecision)
          : "MANUAL_REVIEW",
        qualityWarnings(qualityDecision, qualityAfter.report.quality_score, params.qualityPassThreshold),
        lengthGate,
      );
      const publish = await writePublishReadyReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: lengthDecision.publishStatus,
        final_candidate_file: relative(params.bookDir, finalFile),
        source_chain: [...sourceChain],
        continuity: { final_status: continuityAfter.report.final_status, score: continuityAfter.report.score },
        quality: { final_quality_status: finalQualityStatus, score: qualityAfter.report.quality_score },
        quality_decision: qualityDecision,
        quality_score: qualityAfter.report.quality_score,
        quality_pass_threshold: params.qualityPassThreshold,
        quality_accept_threshold: params.qualityAcceptThreshold,
        accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
        warnings: lengthDecision.warnings,
        source_file: relative(params.bookDir, continuityAfter.final.sourceFile),
        word_count: lengthGate.count,
        min_chapter_words: params.minChapterWords,
        target_chapter_words: params.targetChapterWords,
        max_chapter_words: lengthGate.hard_max,
        length_gate: lengthGate,
        report_json_path: "",
        report_markdown_path: "",
      });
      return writeQualityFixReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: publish.publish_status,
        input_file: relative(params.bookDir, context.inputFile),
        output_file: relative(params.bookDir, outputFile),
        quality_score_before: context.qualityScore,
        quality_score_after: qualityAfter.report.quality_score,
        continuity_score_after: continuityAfter.report.score,
        final_candidate_file: publish.final_candidate_file,
        report_json_path: "",
        report_markdown_path: "",
      });
    }
  }

  const publishStatus: PublishReadyStatus = (qualityAfter?.report.quality_score ?? 0) < params.qualityFixThreshold
    ? "NEED_REWRITE"
    : "QUALITY_MANUAL_REVIEW";
  await writePublishReadyReport(params.bookDir, {
    book: params.bookId,
    chapter_index: params.chapter,
    publish_status: publishStatus,
    final_candidate_file: "",
    source_chain: [...sourceChain],
    continuity: { final_status: continuityAfter?.report.final_status, score: continuityAfter?.report.score },
    quality: { final_quality_status: "QUALITY_MANUAL_REVIEW", score: qualityAfter?.report.quality_score },
    source_file: relative(params.bookDir, continuityAfter?.final.sourceFile ?? context.inputFile),
    word_count: continuityAfter?.report.word_count ?? context.publishReport?.word_count,
    min_chapter_words: params.minChapterWords,
    report_json_path: "",
    report_markdown_path: "",
  });
  return writeQualityFixReport(params.bookDir, {
    book: params.bookId,
    chapter_index: params.chapter,
    publish_status: publishStatus,
    input_file: relative(params.bookDir, context.inputFile),
    output_file: outputFile ? relative(params.bookDir, outputFile) : "",
    quality_score_before: context.qualityScore,
    quality_score_after: qualityAfter?.report.quality_score,
    continuity_score_after: continuityAfter?.report.score,
    final_candidate_file: "",
    report_json_path: "",
    report_markdown_path: "",
  });
}

async function resolveQualityAutoFixContext(
  bookDir: string,
  chapter: number,
  minChapterWords: number,
  qualityFixThreshold: number,
  qualityAcceptThreshold: number,
): Promise<{
  readonly eligible: boolean;
  readonly reason: string;
  readonly publishStatus: PublishReadyStatus;
  readonly inputFile: string;
  readonly qualityScore?: number;
  readonly publishReport: Partial<PublishReadyResult> | null;
  readonly qualityReport: Partial<FanqieQualityReport> | null;
  readonly sourceChain: string[];
}> {
  const publishReport = await readPublishReadyReportIfExists(bookDir, chapter);
  const qualityReport = await readQualityReportIfExists(bookDir, chapter, "final-quality-report")
    ?? await readQualityReportIfExists(bookDir, chapter, "quality-report");
  const continuityReport = await readContinuityReportIfExists(bookDir, chapter, "final-report");
  const qualityScore = Number(qualityReport?.final_quality_score ?? qualityReport?.quality_score ?? publishReport?.quality?.score ?? 0);
  const continuityStatus = publishReport?.continuity?.final_status ?? continuityReport?.final_status ?? continuityReport?.status;
  const wordCount = Number(publishReport?.word_count ?? continuityReport?.word_count ?? 0);
  const minWords = Number(publishReport?.min_chapter_words ?? continuityReport?.min_chapter_words ?? minChapterWords);
  const qualityStatus = qualityReport?.final_quality_status ?? qualityReport?.status ?? publishReport?.quality?.final_quality_status;
  const publishStatus = publishReport?.publish_status;
  const sourceChain = Array.isArray(publishReport?.source_chain) ? [...publishReport.source_chain] : [];
  const inputRef = typeof qualityReport?.used_polished_file === "string" && qualityReport.used_polished_file
    ? qualityReport.used_polished_file
    : typeof qualityReport?.source_file === "string" && qualityReport.source_file
      ? qualityReport.source_file
      : findLastSourceChainCandidate(sourceChain);
  const inputFile = inputRef ? resolveUsedFilePath(bookDir, inputRef) ?? "" : "";

  log(`[debug] resolveQualityAutoFixContext: qualityScore=${qualityScore}, continuityStatus=${continuityStatus}, qualityStatus=${qualityStatus}, publishStatus=${publishStatus}, wordCount=${wordCount}, minWords=${minWords}, inputFile=${inputFile ? relative(bookDir, inputFile) : "(none)"}, inputRef=${inputRef}`);

  if (continuityStatus !== "PASS") {
    return { eligible: false, reason: `continuity final_status is not PASS (got: ${continuityStatus})`, publishStatus: "BLOCKED_BY_CONTINUITY", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (!Number.isFinite(wordCount) || wordCount < minWords) {
    return { eligible: false, reason: `word_count ${wordCount} < ${minWords}`, publishStatus: "BLOCKED_BY_CONTINUITY", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (qualityScore < qualityFixThreshold) {
    return { eligible: false, reason: `quality_score ${qualityScore} < qualityFixThreshold ${qualityFixThreshold}`, publishStatus: "NEED_REWRITE", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (qualityScore >= qualityAcceptThreshold) {
    return { eligible: false, reason: `quality_score ${qualityScore} already passes (>= acceptThreshold ${qualityAcceptThreshold})`, publishStatus: qualityScore >= 85 ? "READY_TO_EXPORT" : "READY_WITH_WARNINGS", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (publishStatus && publishStatus !== "BLOCKED_BY_QUALITY" && publishStatus !== "QUALITY_MANUAL_REVIEW") {
    return { eligible: false, reason: `publish_status is ${publishStatus} (not BLOCKED_BY_QUALITY or QUALITY_MANUAL_REVIEW)`, publishStatus: publishStatus as PublishReadyStatus, inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (qualityStatus && !["QUALITY_MANUAL_REVIEW", "QUALITY_WARN_POLISH_OPTIONAL", "QUALITY_NEED_POLISH", "QUALITY_FAIL"].includes(String(qualityStatus))) {
    return { eligible: false, reason: `quality status is ${qualityStatus} (not in eligible list)`, publishStatus: "MANUAL_REVIEW", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (!inputFile || !existsSync(inputFile)) {
    return { eligible: false, reason: `quality source_file / used_polished_file not found: inputRef=${inputRef}, resolved=${inputFile}`, publishStatus: "MANUAL_REVIEW", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  log(`[debug] resolveQualityAutoFixContext: eligible=true`);
  return { eligible: true, reason: "", publishStatus: "BLOCKED_BY_QUALITY", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
}

function findLastSourceChainCandidate(sourceChain: ReadonlyArray<string>): string {
  for (let i = sourceChain.length - 1; i >= 0; i -= 1) {
    const item = sourceChain[i] ?? "";
    if (/chapters-(?:polished|quality-fixed|fixed|salvaged)\//.test(item)) return item;
  }
  return "";
}

function isQualityAutoFixEligibleFromReports(
  publishReport: Partial<PublishReadyResult>,
  qualityReport: Partial<FanqieQualityReport> | null,
  qualityFixThreshold: number,
  qualityAcceptThreshold: number,
): boolean {
  const score = Number(qualityReport?.final_quality_score ?? qualityReport?.quality_score ?? publishReport.quality?.score ?? 0);
  return publishReport.publish_status === "BLOCKED_BY_QUALITY" && score >= qualityFixThreshold && score < qualityAcceptThreshold;
}

async function writeQualityFixedChapter(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly attempt: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly currentText: string;
  readonly qualityReport: Partial<FanqieQualityReport>;
  readonly lengthConstraint?: string;
  readonly scopeConstraint?: string;
}): Promise<string> {
  const numericExpressionGuidance = buildNumericExpressionGuidance(
    await readBookNumericExpressionMode(params.bookDir),
    "zh",
    "polish",
  );
  const response = await chatCompletion(params.client, params.model, [
    {
      role: "system",
      content: [
        "你是番茄网文章节定向增强编辑。",
        "只输出修复后的完整章节正文。",
        "不要输出说明、报告、JSON、Markdown 代码块。",
        numericExpressionGuidance,
      ].join("\n"),
    },
    { role: "user", content: buildQualityAutoFixPrompt(params.currentText, params.qualityReport, params.lengthConstraint, params.scopeConstraint) },
  ], { temperature: 0.28, maxTokens: 8192, stage: "fanqie-quality" });
  const fixed = stripMarkdownCodeFence(response.content).trim();
  if (!fixed) throw new Error("quality-auto-fix returned empty chapter content");
  const outDir = join(params.bookDir, "chapters-quality-fixed");
  const outputPath = join(outDir, `${chapterNumberPrefix(params.chapter)}_quality_fix_attempt${params.attempt}.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(outputPath, `${fixed.trimEnd()}\n`, "utf-8");
  return outputPath;
}

export function buildQualityAutoFixPrompt(currentText: string, report: Partial<FanqieQualityReport>, lengthConstraint?: string, scopeConstraint?: string): string {
  const issues = (report.issues ?? []).map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n") || "- 无";
  const risks = (report.reader_drop_risks ?? []).map((item) => `- ${item}`).join("\n") || "- 无";
  const suggestions = (report.polish_suggestions ?? []).map((item) => `- ${item}`).join("\n") || "- 无";
  const lengthBlock = lengthConstraint ? `\n${lengthConstraint}\n` : "";
  const scopeBlock = scopeConstraint ? `\n${scopeConstraint}\n` : "";
  return `你正在对一章"连续性已通过，但番茄质量分不足"的网文章节做定向增强。

【当前章节】
${currentText}

【质量问题】
${issues}

【留存风险】
${risks}

【优化建议】
${suggestions}
${lengthBlock}${scopeBlock}
【硬性要求】
1. 不改变剧情主线。
2. 不改变人物关系。
3. 不改变战力层级。
4. 不改变已有伏笔含义。
5. 不重写成新章节。
6. 保留原文 80% 以上。
7. 只针对报告中的问题做局部增强。
8. 输出完整章节正文。
${lengthConstraint ? "9. 不得低于最低字数要求。字数异常增长请检查输入边界，勿为凑字数新增未来事件。\n" : ""}${scopeConstraint ? "10. 严格遵守章节作用域约束，不提前完成下一章目标，不引入未来人物/支线。\n" : ""}
【增强方向】
如果问题包含"爽点密度不足"：
- 增加主角获得收益、反击、压制、突破、信息揭露的细节。
- 每次增加 2~4 段，不要水字数。

如果问题包含"节奏推进不足"：
- 增加目标 → 阻碍 → 应对 → 变化的动作链。
- 补足冲突前的铺垫和冲突后的代价。

如果问题包含"结尾钩子偏弱"：
- 强化最后 3~6 段。
- 增加新危机、新信息、新反转或下一章期待。

如果问题包含"情绪拉扯不足"：
- 增加角色选择、代价、紧张感、压迫感。
- 不写空泛心理独白。

如果问题包含"发布风险"：
- 删除或压缩说明文。
- 增加动作、对白、冲突。

【禁止】
- 禁止大段解释设定
- 禁止重复上一章信息
- 禁止为了加字数而水文
- 禁止改主线
- 禁止输出说明`;
}

async function writeQualityFixReport(bookDir: string, report: QualityAutoFixResult): Promise<QualityAutoFixResult> {
  const reportDir = join(bookDir, "reviews", "fanqie-quality");
  const prefix = chapterNumberPrefix(report.chapter_index);
  const jsonPath = join(reportDir, `${prefix}.quality-fix-report.json`);
  const markdownPath = join(reportDir, `${prefix}.quality-fix-report.md`);
  const finalReport = { ...report, report_json_path: jsonPath, report_markdown_path: markdownPath };
  await mkdir(reportDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderQualityFixMarkdown(finalReport), "utf-8");
  return finalReport;
}

function renderQualityFixMarkdown(report: QualityAutoFixResult): string {
  return `# Quality Auto Fix Report

- book: ${report.book}
- chapter: ${chapterNumberPrefix(report.chapter_index)}
- publish_status: ${report.publish_status}
- input_file: ${report.input_file || "无"}
- output_file: ${report.output_file || "无"}
- quality_score_before: ${report.quality_score_before ?? "n/a"}
- quality_score_after: ${report.quality_score_after ?? "n/a"}
- continuity_score_after: ${report.continuity_score_after ?? "n/a"}
- final_candidate_file: ${report.final_candidate_file || "无"}
${report.skipped_reason ? `- skipped_reason: ${report.skipped_reason}\n` : ""}`;
}

async function runPlotAutoFixChapter(params: {
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly maxPlotFixAttempts: number;
  readonly json: boolean;
  readonly targetChapterWords?: number;
  readonly language?: "zh" | "en";
}): Promise<PlotAutoFixResult> {
  const context = await resolvePlotAutoFixContext(params.bookDir, params.chapter);
  if (!context.eligible) {
    return writePlotFixReport(params.bookDir, {
      book: params.bookId,
      chapter_index: params.chapter,
      status: "SKIPPED",
      input_file: context.inputFile ? relative(params.bookDir, context.inputFile) : "",
      output_file: "",
      final_candidate_file: context.finalCandidateFile ? relative(params.bookDir, context.finalCandidateFile) : "",
      six_step_status_before: context.sixStepStatus,
      six_step_score_before: context.sixStepScore,
      report_json_path: "",
      report_markdown_path: "",
      skipped_reason: context.reason,
    });
  }

  const targetWords = params.targetChapterWords ?? 3000;
  const lang = params.language ?? "zh";
  const plotScopeContent = await loadChapterIntentContent(params.bookDir, params.chapter);

  let inputFile = context.inputFile;
  let outputFile = "";
  for (let attempt = 1; attempt <= params.maxPlotFixAttempts; attempt += 1) {
    if (!params.json) log(`attempt ${attempt}/${params.maxPlotFixAttempts} -> fixing publish-ready structure...`);
    const plotCurrentText = await readFile(inputFile, "utf-8");
    outputFile = await writePlotFixedChapter({
      bookDir: params.bookDir,
      chapter: params.chapter,
      attempt,
      client: params.client,
      model: params.model,
      currentText: plotCurrentText,
      publishReport: context.publishReport,
      sixStepReport: context.sixStepReport,
      storyEffectivenessReport: context.storyEffectivenessReport,
      lengthConstraint: buildRepairLengthConstraint({
        chapterText: plotCurrentText,
        targetChapterWords: targetWords,
        language: lang as "zh" | "en",
      }),
      scopeConstraint: buildRepairScopeConstraint(plotScopeContent),
    });
    inputFile = outputFile;
  }

  const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, outputFile);
  await deletePublishReadyStructureReportsIfExists(params.bookDir, params.chapter);
  return writePlotFixReport(params.bookDir, {
    book: params.bookId,
    chapter_index: params.chapter,
    status: "FIXED",
    input_file: relative(params.bookDir, context.inputFile),
    output_file: relative(params.bookDir, outputFile),
    final_candidate_file: relative(params.bookDir, finalFile),
    six_step_status_before: context.sixStepStatus,
    six_step_score_before: context.sixStepScore,
    report_json_path: "",
    report_markdown_path: "",
  });
}

async function resolvePlotAutoFixContext(
  bookDir: string,
  chapter: number,
): Promise<{
  readonly eligible: boolean;
  readonly reason: string;
  readonly inputFile: string;
  readonly finalCandidateFile: string;
  readonly publishReport: Partial<PublishReadyResult> | null;
  readonly sixStepReport: Record<string, unknown> | null;
  readonly storyEffectivenessReport: Record<string, unknown> | null;
  readonly sixStepStatus?: string;
  readonly sixStepScore?: number | null;
}> {
  const publishReport = await readPublishReadyReportIfExists(bookDir, chapter);
  const sixStepReport = await readSixStepPlotReportIfExists(bookDir, chapter);
  const storyEffectivenessReport = await readStoryEffectivenessReportIfExists(bookDir, chapter);
  const sixStepStatus = String(publishReport?.six_step_plot?.status ?? sixStepReport?.status ?? "");
  const rawScore = publishReport?.six_step_plot?.score ?? sixStepReport?.score;
  const sixStepScore = typeof rawScore === "number" ? rawScore : rawScore === null ? null : undefined;
  const finalCandidateFile = await findReviewedFinalChapterFile(bookDir, chapter) ?? "";
  const inputFile = finalCandidateFile
    || (publishReport?.final_candidate_file ? resolveUsedFilePath(bookDir, publishReport.final_candidate_file) ?? "" : "");

  if (!hasPublishReadyStructureBlocker(publishReport)) {
    return {
      eligible: false,
      reason: `no publish-ready structural failure found; six_step_plot status is ${sixStepStatus || "missing"}`,
      inputFile,
      finalCandidateFile,
      publishReport,
      sixStepReport,
      storyEffectivenessReport,
      sixStepStatus: sixStepStatus || undefined,
      sixStepScore,
    };
  }
  if (!inputFile || !existsSync(inputFile)) {
    return {
      eligible: false,
      reason: "final candidate file not found; run publish-ready first so there is a chapters-reviewed final candidate",
      inputFile,
      finalCandidateFile,
      publishReport,
      sixStepReport,
      storyEffectivenessReport,
      sixStepStatus,
      sixStepScore,
    };
  }
  return {
    eligible: true,
    reason: "",
    inputFile,
    finalCandidateFile,
    publishReport,
    sixStepReport,
    storyEffectivenessReport,
    sixStepStatus,
    sixStepScore,
  };
}

async function writePlotFixedChapter(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly attempt: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly currentText: string;
  readonly publishReport: Partial<PublishReadyResult> | null;
  readonly sixStepReport: Record<string, unknown> | null;
  readonly storyEffectivenessReport: Record<string, unknown> | null;
  readonly lengthConstraint?: string;
  readonly scopeConstraint?: string;
}): Promise<string> {
  const numericExpressionGuidance = buildNumericExpressionGuidance(
    await readBookNumericExpressionMode(params.bookDir),
    "zh",
    "polish",
  );
  const response = await chatCompletion(params.client, params.model, [
    {
      role: "system",
      content: [
        "你是网文章节追读结构定向修复编辑。",
        "只输出修复后的完整章节正文。",
        "不要输出说明、报告、JSON、Markdown 代码块。",
        numericExpressionGuidance,
      ].join("\n"),
    },
    { role: "user", content: buildPlotAutoFixPrompt(params.currentText, params.publishReport, params.sixStepReport, params.storyEffectivenessReport, params.lengthConstraint, params.scopeConstraint) },
  ], { temperature: 0.3, maxTokens: 8192, stage: "six-step-plot-fix" });
  const fixed = stripMarkdownCodeFence(response.content).trim();
  if (!fixed) throw new Error("plot-auto-fix returned empty chapter content");
  const outDir = join(params.bookDir, "chapters-plot-fixed");
  const outputPath = join(outDir, `${chapterNumberPrefix(params.chapter)}_plot_fix_attempt${params.attempt}.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(outputPath, `${fixed.trimEnd()}\n`, "utf-8");
  return outputPath;
}

export function buildPlotAutoFixPrompt(
  currentText: string,
  publishReport: Partial<PublishReadyResult> | null,
  sixStepReport: Record<string, unknown> | null,
  storyEffectivenessReport: Record<string, unknown> | null,
  lengthConstraint?: string,
  scopeConstraint?: string,
): string {
  const lengthBlock = lengthConstraint ? `\n${lengthConstraint}\n` : "";
  const scopeBlock = scopeConstraint ? `\n${scopeConstraint}\n` : "";
  return `你正在修复一章 publish-ready 的 six_step_plot=FAIL_STRUCTURAL 问题。

【当前章节】
${currentText}

【publish-ready 摘要】
${JSON.stringify({
    publish_status: publishReport?.publish_status,
    final_candidate_file: publishReport?.final_candidate_file,
    six_step_plot: publishReport?.six_step_plot,
    warnings: publishReport?.warnings,
  }, null, 2)}

【six-step-plot 报告】
${formatPlotReportForPrompt(sixStepReport)}

【story-effectiveness 报告】
${formatStoryEffectivenessReportForPrompt(storyEffectivenessReport)}
${lengthBlock}${scopeBlock}
【修复目标】
1. 让章节具备清晰的 Hook / Pressure / Attempt / Twist / Payoff / Pull。
2. 开头 1-3 段补出明确情绪事件或即时危机，不要空泛铺陈。
3. 中段明确主角目标、压力升级、主动尝试和阶段反馈。
4. 中后段补一个预期偏差或信息反转，不要只平推动作。
5. 结尾保留下一章拉力：新危机、新信息、新选择或未解决问题。

【如果报告提到 emotion_event / 情绪事件】
1. 必须改写或补强前 300 字。
2. 开头必须出现一个可被读者立刻感知的外部事件，例如：有人当众压价/羞辱、关键物品被夺走、交易条件突然变卦、敌人逼近、门被封死、倒计时压迫。
3. 这个事件必须迫使主角立刻做选择，不能只是环境描写、设定说明或心理独白。
4. 第一屏必须同时有"目标 + 阻碍 + 情绪压力"。

【如果报告提到 story_effectiveness / 主角目标 / 结尾钩子】
1. 必须在前 500 字明确主角本章目标，目标要能被读者复述，例如"用[本书核心道具]换取[资源]，保住[重要据点]"。
2. 必须让目标遇到具体阻碍，例如盟友不信任、资源不足、敌对势力逼近、权限威胁。
3. 结尾必须留下一个未解决问题或下一章选择，不能只列状态数值。
4. 章末钩子要和本章目标直接相连，例如更高代价、权限掠夺、是否接受支线任务、防御即将失守。

【硬性要求】
1. 保留原剧情主线、人物关系、资源数值、物品、地点和章尾方向。
2. 不改变已经通过连续性/资源检查的事实。
3. 不整章重写，保留原文 70% 以上，只做 3-10 处定点补强。
4. 不新增无来源 of 系统规则、战力设定、隐藏道具或重大角色关系。
5. 输出完整章节正文。
${lengthConstraint ? "6. 不得低于最低字数要求。字数异常增长请检查输入边界，勿为凑字数新增未来事件。\n" : ""}${scopeConstraint ? "7. 严格遵守章节作用域约束，不提前完成下一章目标，不引入未来人物/支线。\n" : ""}`;
}

function formatPlotReportForPrompt(report: Record<string, unknown> | null): string {
  if (!report) return "未找到 six-step-plot 详细报告；请按 publish-ready 摘要修复结构。";
  const compact = {
    status: report.status,
    score: report.score,
    summary: report.summary,
    issues: report.issues,
    checklist: report.checklist,
    dimensions: report.dimensions,
    suggestions: report.suggestions,
  };
  return JSON.stringify(compact, null, 2).slice(0, 9000);
}

function formatStoryEffectivenessReportForPrompt(report: Record<string, unknown> | null): string {
  if (!report) return "未找到 story-effectiveness 详细报告；请按 publish-ready 摘要修复结构。";
  const compact = {
    status: report.status,
    score: report.score,
    dimensions: report.dimensions,
    dimensionConclusions: report.dimensionConclusions,
    strengths: report.strengths,
    issues: report.issues,
    suggestions: report.suggestions,
  };
  return JSON.stringify(compact, null, 2).slice(0, 9000);
}

async function writePlotFixReport(bookDir: string, report: PlotAutoFixResult): Promise<PlotAutoFixResult> {
  const reportDir = join(bookDir, "reviews", "plot-auto-fix");
  const prefix = chapterNumberPrefix(report.chapter_index);
  const jsonPath = join(reportDir, `${prefix}.plot-fix-report.json`);
  const markdownPath = join(reportDir, `${prefix}.plot-fix-report.md`);
  const finalReport = { ...report, report_json_path: jsonPath, report_markdown_path: markdownPath };
  await mkdir(reportDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderPlotFixMarkdown(finalReport), "utf-8");
  return finalReport;
}

function renderPlotFixMarkdown(report: PlotAutoFixResult): string {
  return `# Plot Auto Fix Report

- book: ${report.book}
- chapter: ${chapterNumberPrefix(report.chapter_index)}
- status: ${report.status}
- input_file: ${report.input_file || "无"}
- output_file: ${report.output_file || "无"}
- final_candidate_file: ${report.final_candidate_file || "无"}
- six_step_status_before: ${report.six_step_status_before ?? "n/a"}
- six_step_score_before: ${report.six_step_score_before ?? "n/a"}
${report.skipped_reason ? `- skipped_reason: ${report.skipped_reason}\n` : ""}`;
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
        const bookJsonPath = join(dir, "book.json");
        await stat(bookJsonPath);
        let chapterWordCount: number | undefined;
        let language: "zh" | "en" | undefined;
        try {
          const parsed = JSON.parse(await readFile(bookJsonPath, "utf-8")) as {
            readonly chapterWordCount?: unknown;
            readonly language?: unknown;
          };
          if (Number.isInteger(parsed.chapterWordCount) && Number(parsed.chapterWordCount) > 0) {
            chapterWordCount = Number(parsed.chapterWordCount);
          }
          if (parsed.language === "zh" || parsed.language === "en") {
            language = parsed.language;
          }
        } catch {
          // Keep the book discoverable; publish-ready will fall back to defaults.
        }
        books.push({ id: entry, dir, chapterWordCount, language });
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

function parseNonNegativeInt(value: string, name: string): number {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
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
  readonly reportKind?: "report" | "final-report" | "salvage-report";
  readonly currentOverridePath?: string;
  readonly fixAttempt?: number;
  readonly maxFixAttempts?: number;
  readonly minChapterWords?: number;
}): Promise<ContinuityCommandResult> {
  if (params.chapter <= 1) {
    throw new Error("Continuity check requires chapter >= 2 because it needs a previous chapter.");
  }

  const prev = await resolveReviewedChapterForContinuity(params.bookDir, params.chapter - 1);
  const originalCurrent = await findChapterFile(params.bookDir, params.chapter);
  const current = params.currentOverridePath
    ? {
        file: params.currentOverridePath,
        title: originalCurrent.title,
        bodySource: bodySourceFromPath(params.currentOverridePath),
        fromExistingPass: false,
        warnings: [],
      }
    : await resolveReviewedChapterForContinuity(params.bookDir, params.chapter);

  const [prevChapter, currentChapter] = await Promise.all([
    readFile(prev.file, "utf-8"),
    readFile(current.file, "utf-8"),
  ]);

  const reportDir = join(params.bookDir, "reviews", "continuity");
  const prefix = chapterNumberPrefix(params.chapter);
  const reportKind = params.reportKind ?? (params.final ? "final-report" : "report");
  const reportJsonPath = join(reportDir, `${prefix}.${reportKind}.json`);
  const reportMarkdownPath = join(reportDir, `${prefix}.${reportKind}.md`);

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
        minChapterWords: params.minChapterWords ?? 1000,
        bookDir: params.bookDir,
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
        minChapterWords: params.minChapterWords ?? 1000,
        bookDir: params.bookDir,
      });

  return {
    chapter: params.chapter,
    chapterTitle: current.title,
    sourceFile: current.file,
    prevSourceFile: prev.file,
    bodySource: current.bodySource ?? bodySourceFromPath(current.file),
    fromExistingPass: Boolean(current.fromExistingPass),
    reportedWarnings: [...(prev.warnings ?? []), ...(current.warnings ?? [])],
    report,
    reportJsonPath,
    reportMarkdownPath,
  };
}

async function checkFanqieQualityChapter(params: {
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client?: ReturnType<typeof createClient>;
  readonly model?: string;
  readonly nextOutline?: string;
  readonly currentOverridePath?: string;
  readonly reportKind?: "quality-report" | "final-quality-report";
  readonly polishAttempt?: number;
  readonly maxPolishAttempts?: number;
  readonly finalQualityScore?: number;
  readonly finalQualityStatus?: FanqieFinalQualityStatus;
  readonly usedPolishedFile?: string;
}): Promise<FanqieQualityCommandResult> {
  const originalCurrent = await findChapterFile(params.bookDir, params.chapter);
  const current = params.currentOverridePath
    ? await resolveOverrideChapterSource(params.bookDir, params.chapter, params.currentOverridePath)
    : await resolveReviewedChapterSource(params.bookDir, params.chapter);
  const prev = params.chapter > 1 ? await resolveReviewedChapterSource(params.bookDir, params.chapter - 1).catch(() => null) : null;
  const [chapterText, prevChapter] = await Promise.all([
    readFile(current.path, "utf-8"),
    prev ? readFile(prev.path, "utf-8") : Promise.resolve(""),
  ]);
  const reportDir = join(params.bookDir, "reviews", "fanqie-quality");
  const prefix = chapterNumberPrefix(params.chapter);
  const reportKind = params.reportKind ?? "quality-report";
  const reportJsonPath = join(reportDir, `${prefix}.${reportKind}.json`);
  const reportMarkdownPath = join(reportDir, `${prefix}.${reportKind}.md`);
  const input = {
    chapterText,
    prevChapter,
    nextOutline: params.nextOutline,
    bookName: params.bookId,
    chapterIndex: params.chapter,
    chapterTitle: originalCurrent.title,
    sourceFile: relative(params.bookDir, current.path),
    bodySource: current.body_source,
    sourceDecision: current.decision_source,
    continuityFinalStatus: current.continuity_final_status,
    qualityFinalStatus: current.quality_final_status,
    publishBlockedByContinuity: current.publish_blocked_by_continuity,
    polishAttempt: params.polishAttempt,
    maxPolishAttempts: params.maxPolishAttempts,
    finalQualityScore: params.finalQualityScore,
    finalQualityStatus: params.finalQualityStatus,
    usedPolishedFile: params.usedPolishedFile,
    reportJsonPath,
    reportMarkdownPath,
  };
  const report = params.client && params.model
    ? await runFanqieQualityCheck({
        client: params.client,
        model: params.model,
        ...input,
      })
    : await runLocalFanqieQualityCheck(input);

  return {
    chapter: params.chapter,
    chapterTitle: originalCurrent.title,
    sourceFile: current.path,
    bodySource: current.body_source,
    sourceDecision: current.decision_source,
    continuityFinalStatus: current.continuity_final_status,
    report,
    reportJsonPath,
    reportMarkdownPath,
  };
}

async function isPublishBlockedByContinuity(bookDir: string, chapter: number): Promise<boolean> {
  const reportDir = join(bookDir, "reviews", "continuity");
  const prefix = chapterNumberPrefix(chapter);
  const candidates = [
    join(reportDir, `${prefix}.final-report.json`),
    join(reportDir, `${prefix}.report.json`),
  ];
  for (const candidate of candidates) {
    try {
      const report = JSON.parse(await readFile(candidate, "utf-8")) as Partial<ContinuityReport>;
      const finalStatus = report.final_status ?? report.status;
      return finalStatus !== "PASS";
    } catch {
      continue;
    }
  }
  return false;
}

async function writeFanqieQualitySummary(
  bookDir: string,
  results: ReadonlyArray<FanqieQualityCommandResult>,
): Promise<string> {
  const summaryPath = join(bookDir, "reviews", "fanqie-quality", "summary.md");
  const rows = results.map((result) => {
    const mainIssue = result.report.issues[0]?.type || result.report.reader_drop_risks[0] || "";
    return `| ${chapterNumberPrefix(result.chapter)} | ${result.report.quality_score} | ${result.report.status} | ${mainIssue.replace(/\|/g, "/")} |`;
  }).join("\n");
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `# 番茄质量检测汇总

| chapter | score | status | main_issue |
|---|---:|---|---|
${rows}
`, "utf-8");
  return summaryPath;
}

async function polishFanqieQualityChapter(params: {
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly maxPolishAttempts: number;
  readonly json: boolean;
  readonly currentOverridePath?: string;
  readonly qualityPassThreshold?: number;
  readonly qualityAcceptThreshold?: number;
  readonly targetChapterWords?: number;
  readonly language?: "zh" | "en";
}): Promise<FanqiePolishCommandResult> {
  const passThreshold = params.qualityPassThreshold ?? 85;
  const acceptThreshold = params.qualityAcceptThreshold ?? 80;

  let quality = await readFanqieQualityReport(params.bookDir, params.chapter);
  if (quality && !await hasUsableQualitySourceFile(params.bookDir, quality.report)) {
    if (!params.json) {
      log("warning: quality-report source_file missing or not found; rerunning fanqie-quality.");
    }
    quality = null;
  }
  // If a currentOverridePath was provided (e.g. from plot-fix), always re-check quality on that file
  if (params.currentOverridePath && quality) {
    const overrideResolved = resolveUsedFilePath(params.bookDir, params.currentOverridePath) ?? params.currentOverridePath;
    const qualitySource = quality.sourceFile ? resolveUsedFilePath(params.bookDir, quality.sourceFile) ?? quality.sourceFile : "";
    if (overrideResolved !== qualitySource) {
      if (!params.json) {
        log(`[debug] polish: override path differs from quality source, rerunning quality check`);
        log(`[debug]   override: ${relative(params.bookDir, overrideResolved)}`);
        log(`[debug]   quality:  ${qualitySource ? relative(params.bookDir, qualitySource) : "(none)"}`);
      }
      quality = null;
    }
  }
  quality ??= await checkFanqieQualityChapter({
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter: params.chapter,
      client: params.client,
      model: params.model,
      currentOverridePath: params.currentOverridePath,
    });

  const initialScore = quality.report.quality_score;
  const inputFile = quality.sourceFile;
  let attempts = 0;
  let usedPolishedFile = "";
  let finalScore = initialScore;
  let finalStatus: FanqieFinalQualityStatus = initialScore >= passThreshold ? "QUALITY_PASS" : initialScore >= Math.max(80, acceptThreshold) ? "QUALITY_WARN_POLISH_OPTIONAL" : "QUALITY_MANUAL_REVIEW";

  if (!params.json) {
    log(`[debug] polish input file: ${relative(params.bookDir, inputFile)}`);
  }

  if (quality.report.publish_blocked_by_continuity) {
    const finalReport = markFinalFanqieQualityReport(quality.report, {
      polishAttempt: 0,
      maxPolishAttempts: params.maxPolishAttempts,
      finalQualityScore: initialScore,
      finalQualityStatus: "QUALITY_MANUAL_REVIEW",
      usedPolishedFile: "",
    });
    const paths = fanqieFinalReportPaths(params.bookDir, params.chapter);
    await writeFanqieQualityReportFiles(finalReport, paths.jsonPath, paths.markdownPath);
    return {
      chapter: params.chapter,
      initialScore,
      finalScore: initialScore,
      finalQualityStatus: "QUALITY_MANUAL_REVIEW",
      attempts: 0,
      inputFile,
      usedPolishedFile: "",
      finalReportJsonPath: paths.jsonPath,
      finalReportMarkdownPath: paths.markdownPath,
      blockedByContinuity: true,
      blockedByLength: false,
    };
  }

  const goldenInstructions = await getGolden3ChapterInstructions(params.bookDir, params.chapter);
  const hasGoldenInstructions = goldenInstructions.length > 0;
  const goldenReport = await readGolden3ChapterReportIfExists(params.bookDir);
  const goldenScore = goldenReport?.score ?? 100;
  const goldenNeedsFix = goldenScore < 85 && hasGoldenInstructions;

  log(`[debug] polishFanqieQualityChapter Ch ${params.chapter}: initialScore=${initialScore}, goldenScore=${goldenScore}, hasGoldenInstructions=${hasGoldenInstructions}, goldenNeedsFix=${goldenNeedsFix}`);

  // Compute length/scope constraints for polish prompt
  const targetWords = params.targetChapterWords ?? 3000;
  const lang = params.language ?? "zh";
  const scopeContent = await loadChapterIntentContent(params.bookDir, params.chapter);
  const lengthConstraint = buildRepairLengthConstraint({
    chapterText: await readFile(inputFile, "utf-8"),
    targetChapterWords: targetWords,
    language: lang as "zh" | "en",
  });
  const scopeConstraint = buildRepairScopeConstraint(scopeContent);
  const signalsScopeConstraint = buildRepairSignalsScopeConstraint(scopeContent);

  // QUALITY_WARN_POLISH_OPTIONAL: limit to 1 attempt with compress-only constraint
  const isWarnOptional = initialScore >= Math.max(80, acceptThreshold) && initialScore < passThreshold;
  const effectiveMaxAttempts = isWarnOptional ? 1 : params.maxPolishAttempts;

  if ((initialScore >= passThreshold && !goldenNeedsFix) || (!quality.report.polish_prompt.trim() && !hasGoldenInstructions)) {
    const finalReport = markFinalFanqieQualityReport(quality.report, {
      polishAttempt: 0,
      maxPolishAttempts: params.maxPolishAttempts,
      finalQualityScore: initialScore,
      finalQualityStatus: initialScore >= passThreshold ? "QUALITY_PASS" : initialScore >= Math.max(80, acceptThreshold) ? "QUALITY_WARN_POLISH_OPTIONAL" : "QUALITY_MANUAL_REVIEW",
      usedPolishedFile: "",
    });
    const paths = fanqieFinalReportPaths(params.bookDir, params.chapter);
    await writeFanqieQualityReportFiles(finalReport, paths.jsonPath, paths.markdownPath);
    return {
      chapter: params.chapter,
      initialScore,
      finalScore: initialScore,
      finalQualityStatus: finalReport.final_quality_status ?? "QUALITY_MANUAL_REVIEW",
      attempts: 0,
      inputFile,
      usedPolishedFile: "",
      finalReportJsonPath: paths.jsonPath,
      finalReportMarkdownPath: paths.markdownPath,
      blockedByContinuity: false,
      blockedByLength: false,
    };
  }

  while ((finalScore < passThreshold || (goldenNeedsFix && attempts === 0)) && attempts < effectiveMaxAttempts) {
    const nextAttempt = attempts + 1;
    if (!quality.report.polish_prompt.trim() && !hasGoldenInstructions) break;
    if (!params.json) {
      log(`attempt ${nextAttempt}/${effectiveMaxAttempts} -> score: ${finalScore} -> polishing...`);
    }
    const polishedPath = await writeFanqiePolishedChapter({
      bookDir: params.bookDir,
      chapter: params.chapter,
      attempt: nextAttempt,
      client: params.client,
      model: params.model,
      polishPrompt: quality.report.polish_prompt,
      inputFile: quality.sourceFile,
      lengthConstraint: `${lengthConstraint}\n\n${signalsScopeConstraint}`,
      scopeConstraint,
    });
    usedPolishedFile = relative(params.bookDir, polishedPath);
    attempts = nextAttempt;

    quality = await checkFanqieQualityChapter({
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter: params.chapter,
      client: params.client,
      model: params.model,
      currentOverridePath: polishedPath,
      reportKind: "final-quality-report",
      polishAttempt: attempts,
      maxPolishAttempts: params.maxPolishAttempts,
      usedPolishedFile,
    });
    finalScore = quality.report.quality_score;
    if (!params.json && finalScore >= passThreshold) {
      log(`attempt ${nextAttempt}/${params.maxPolishAttempts} -> final score: ${finalScore}`);
    }
  }

  finalStatus = finalScore >= passThreshold ? "QUALITY_PASS" : finalScore >= Math.max(80, acceptThreshold) ? "QUALITY_WARN_POLISH_OPTIONAL" : "QUALITY_MANUAL_REVIEW";
  const finalReport = markFinalFanqieQualityReport(quality.report, {
    polishAttempt: attempts,
    maxPolishAttempts: params.maxPolishAttempts,
    finalQualityScore: finalScore,
    finalQualityStatus: finalStatus,
    usedPolishedFile,
  });
  const paths = fanqieFinalReportPaths(params.bookDir, params.chapter);
  await writeFanqieQualityReportFiles(finalReport, paths.jsonPath, paths.markdownPath);

  return {
    chapter: params.chapter,
    initialScore,
    finalScore,
    finalQualityStatus: finalStatus,
    attempts,
    inputFile,
    usedPolishedFile,
    finalReportJsonPath: paths.jsonPath,
    finalReportMarkdownPath: paths.markdownPath,
    blockedByContinuity: false,
    blockedByLength: false,
  };
}

async function readFanqieQualityReport(bookDir: string, chapter: number): Promise<FanqieQualityCommandResult | null> {
  const reportDir = join(bookDir, "reviews", "fanqie-quality");
  const prefix = chapterNumberPrefix(chapter);
  const reportJsonPath = join(reportDir, `${prefix}.quality-report.json`);
  const reportMarkdownPath = join(reportDir, `${prefix}.quality-report.md`);
  try {
    const report = JSON.parse(await readFile(reportJsonPath, "utf-8")) as FanqieQualityReport;
    const sourceFile = typeof report.source_file === "string" && report.source_file
      ? resolveUsedFilePath(bookDir, report.source_file) ?? ""
      : "";
    return {
      chapter,
      chapterTitle: report.chapter_title,
      sourceFile,
      bodySource: normalizeBodySourceValue(report.body_source) ?? (sourceFile ? bodySourceFromPath(sourceFile) : "original"),
      sourceDecision: report.source_decision ?? "quality_report",
      continuityFinalStatus: report.continuity_final_status,
      report,
      reportJsonPath,
      reportMarkdownPath,
    };
  } catch {
    return null;
  }
}

async function hasUsableQualitySourceFile(bookDir: string, report: FanqieQualityReport): Promise<boolean> {
  if (!report.source_file) return false;
  const sourceFile = resolveUsedFilePath(bookDir, report.source_file);
  return Boolean(sourceFile && await fileExists(sourceFile));
}

async function getGolden3ChapterInstructions(bookDir: string, chapter: number): Promise<string[]> {
  if (chapter < 1 || chapter > 3) return [];
  try {
    const report = await readGolden3ChapterReportIfExists(bookDir);
    log(`[debug] readGolden3ChapterReportIfExists: found=${Boolean(report)}, issues=${report?.issues?.length}`);
    if (!report || !Array.isArray(report.issues)) return [];
    
    const instructions: string[] = [];
    for (const issue of report.issues) {
      if (!issue || typeof issue !== "object") continue;
      const dim = String(issue.dimension || "");
      const msg = String(issue.message || "");
      const sug = String(issue.suggestion || "");
      
      let matched = false;
      
      // Global dimensions apply to all Ch 1-3
      if (["setup_ratio_safe", "three_chapter_arc"].includes(dim)) {
        matched = true;
      }
      
      // Chapter 1 specific
      if (chapter === 1 && (dim === "opening_hook_delivery" || msg.includes("第1章") || msg.includes("第一章"))) {
        matched = true;
      }
      
      // Chapter 2 specific
      if (chapter === 2 && (dim === "core_differentiator_visible" || msg.includes("第2章") || msg.includes("第二章"))) {
        matched = true;
      }
      
      // Chapter 3 specific
      if (chapter === 3 && (dim === "long_term_goal_established" || msg.includes("第3章") || msg.includes("第三章"))) {
        matched = true;
      }
      
      if (matched && sug) {
        instructions.push(`【前三章黄金开篇优化要求 (${dim})】：${sug} （原诊断问题：${msg}）`);
      }
    }
    log(`[debug] getGolden3ChapterInstructions for Ch ${chapter}: returning ${instructions.length} instructions`);
    return instructions;
  } catch (e) {
    logError(`[debug] getGolden3ChapterInstructions error: ${e}`);
    return [];
  }
}

async function writeFanqiePolishedChapter(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly attempt: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly polishPrompt: string;
  readonly inputFile: string;
  readonly lengthConstraint?: string;
  readonly scopeConstraint?: string;
}): Promise<string> {
  const numericExpressionGuidance = buildNumericExpressionGuidance(
    await readBookNumericExpressionMode(params.bookDir),
    "zh",
    "polish",
  );

  const goldenInstructions = await getGolden3ChapterInstructions(params.bookDir, params.chapter);
  let finalPrompt = params.polishPrompt.trim();

  // Inject length and scope constraints
  const constraintBlocks: string[] = [];
  if (params.lengthConstraint) constraintBlocks.push(params.lengthConstraint);
  if (params.scopeConstraint) constraintBlocks.push(params.scopeConstraint);
  const constraintText = constraintBlocks.join("\n\n");

  if (goldenInstructions.length > 0) {
    if (!finalPrompt) {
      const chapterText = await readFile(params.inputFile, "utf-8");
      finalPrompt = `你正在优化一章需要针对黄金前三章开篇进行专门优化和润色得番茄网文章节。

【当前章节全文】
${chapterText}

【优化要求】
1. 针对前三章黄金开篇的特殊质量要求，你必须在润色中严格落实以下优化改进，以提升开篇的节奏与吸引力：
${goldenInstructions.map(line => `- ${line}`).join("\n")}
2. 不改变剧情主线，不改变人物关系，不改变战力层级。
3. 保留原文大部分核心事件，增强开篇冲突与中段节奏。
4. 输出完整优化后的章节正文，禁止输出解释说明。`;
    } else {
      finalPrompt = `${finalPrompt}\n\n同时，针对前三章黄金开篇的特殊质量要求，你必须在润色中严格落实以下优化改进，以提升开篇的节奏与吸引力：\n${goldenInstructions.map(line => `- ${line}`).join("\n")}`;
    }
  }

  // Append length/scope constraints to the prompt
  if (constraintText && finalPrompt) {
    finalPrompt = `${finalPrompt}\n\n${constraintText}`;
  }

  const response = await chatCompletion(params.client, params.model, [
    {
      role: "system",
      content: [
        "你是番茄网文章节优化编辑。",
        "只输出优化后的完整章节正文。",
        "不要输出说明、报告、JSON、Markdown 代码块。",
        numericExpressionGuidance,
      ].join("\n"),
    },
    { role: "user", content: finalPrompt },
  ], { temperature: 0.35, maxTokens: 8192, stage: "fanqie-polish" });
  const polished = stripMarkdownCodeFence(response.content).trim();
  if (!polished) throw new Error("fanqie-polish returned empty chapter content");
  const outDir = join(params.bookDir, "chapters-polished");
  const outputPath = join(outDir, `${chapterNumberPrefix(params.chapter)}_polished_attempt${params.attempt}.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(outputPath, `${polished.trimEnd()}\n`, "utf-8");
  return outputPath;
}

function markFinalFanqieQualityReport(report: FanqieQualityReport, params: {
  readonly polishAttempt: number;
  readonly maxPolishAttempts: number;
  readonly finalQualityScore: number;
  readonly finalQualityStatus: FanqieFinalQualityStatus;
  readonly usedPolishedFile: string;
}): FanqieQualityReport {
  return {
    ...report,
    polish_attempt: params.polishAttempt,
    max_polish_attempts: params.maxPolishAttempts,
    final_quality_score: params.finalQualityScore,
    final_quality_status: params.finalQualityStatus,
    used_polished_file: params.usedPolishedFile,
  };
}

async function writeFanqieQualityReportFiles(
  report: FanqieQualityReport,
  jsonPath: string,
  markdownPath: string,
): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderFanqieQualityMarkdown(report), "utf-8");
}

function fanqieFinalReportPaths(bookDir: string, chapter: number): {
  readonly jsonPath: string;
  readonly markdownPath: string;
} {
  const reportDir = join(bookDir, "reviews", "fanqie-quality");
  const prefix = chapterNumberPrefix(chapter);
  return {
    jsonPath: join(reportDir, `${prefix}.final-quality-report.json`),
    markdownPath: join(reportDir, `${prefix}.final-quality-report.md`),
  };
}

async function writeFanqiePolishSummary(
  bookDir: string,
  results: ReadonlyArray<FanqiePolishCommandResult>,
): Promise<string> {
  const summaryPath = join(bookDir, "reviews", "fanqie-quality", "polish-summary.md");
  const rows = results.map((result) =>
    `| ${chapterNumberPrefix(result.chapter)} | ${result.initialScore} | ${result.finalScore} | ${result.finalQualityStatus} | ${result.attempts} | ${result.usedPolishedFile} |`
  ).join("\n");
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `# 番茄质量优化汇总

| chapter | initial_score | final_score | final_quality_status | attempts | file |
|---|---:|---:|---|---:|---|
${rows}
`, "utf-8");
  return summaryPath;
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
  readonly outputPath?: string;
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
  const outputPath = params.outputPath ?? join(outDir, `${chapterNumberPrefix(params.chapter)}_attempt${params.attempt}.md`);
  await runChapterContinuityFix({
    client: params.client,
    model: params.model,
    reportJsonPath: params.reportJsonPath,
    outputPath,
  });
  return { chapter: params.chapter, fixedChapterPath: outputPath, attempt: params.attempt };
}

async function runContinuitySalvage(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly issues: ContinuityReport["issues"];
  readonly maxFixAttempts: number;
  readonly minChapterWords: number;
}): Promise<ContinuitySalvageResult> {
  const prev = await resolveReviewedChapterForContinuity(params.bookDir, params.chapter - 1);
  const current = await resolveReviewedChapterForContinuity(params.bookDir, params.chapter);
  const [prevChapter, currentChapter] = await Promise.all([
    readFile(prev.file, "utf-8"),
    readFile(current.file, "utf-8"),
  ]);
  const prompt = buildSalvageRewritePrompt({
    prevChapter,
    currentChapterSummary: summarizeChapterForSalvage(currentChapter),
    issues: params.issues,
    minChapterWords: params.minChapterWords,
  });

  const response = await chatCompletion(params.client, params.model, [
    {
      role: "system",
      content: [
        "你是网文连载章节失败稿抢救编辑。",
        "只输出重写后的完整章节正文。",
        "不要输出说明、报告、JSON、Markdown 代码块。",
      ].join("\n"),
    },
    { role: "user", content: prompt },
  ], { temperature: 0.45, maxTokens: 8192, stage: "continuity" });

  const rewritten = stripMarkdownCodeFence(response.content).trim();
  if (!rewritten) throw new Error("auto-salvage returned empty chapter content");

  const outDir = join(params.bookDir, "chapters-salvaged");
  const outputPath = join(outDir, `${chapterNumberPrefix(params.chapter)}_salvage.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(outputPath, `${rewritten.trimEnd()}\n`, "utf-8");

  const report = await checkContinuityChapter({
    root: "",
    bookId: "",
    bookDir: params.bookDir,
    chapter: params.chapter,
    client: params.client,
    model: params.model,
    final: false,
    reportKind: "salvage-report",
    currentOverridePath: outputPath,
    fixAttempt: params.maxFixAttempts,
    maxFixAttempts: params.maxFixAttempts,
    minChapterWords: params.minChapterWords,
  });
  const salvageReport = {
    ...report.report,
    rewrite_strategy: "salvage_rewrite" as const,
  };
  await writeContinuityReportFiles(
    salvageReport,
    report.reportJsonPath,
    report.reportMarkdownPath,
    params.chapter,
    report.chapterTitle,
  );

  return {
    chapter: params.chapter,
    salvageChapterPath: outputPath,
    report: { ...report, report: salvageReport },
  };
}

async function runSalvageLightFix(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly reportJsonPath: string;
  readonly maxFixAttempts: number;
}): Promise<ContinuityFixResult> {
  const outputPath = join(params.bookDir, "chapters-salvaged", `${chapterNumberPrefix(params.chapter)}_salvage_lightfix.md`);
  await runChapterContinuityFix({
    client: params.client,
    model: params.model,
    reportJsonPath: params.reportJsonPath,
    outputPath,
  });
  return { chapter: params.chapter, fixedChapterPath: outputPath, attempt: params.maxFixAttempts };
}

function buildSalvageRewritePrompt(params: {
  readonly prevChapter: string;
  readonly currentChapterSummary: string;
  readonly issues: ContinuityReport["issues"];
  readonly minChapterWords: number;
}): string {
  const issues = params.issues.length
    ? params.issues.map((issue) => `[${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n")
    : "未识别到结构化问题，但章节已在自动修复后仍未通过连续性检测。";
  return `【上一章全文】
${params.prevChapter}

【当前章节原文（仅提取剧情要点）】
${params.currentChapterSummary}

【已知问题】
${issues}

【重写任务】

你正在重写一章失败的网文连载章节。

要求：

1. 本章必须直接承接上一章结尾画面、声音或危机。
2. 严禁复用当前章节的原始结构（允许参考事件，不允许照抄表达）。
3. 必须明确主角行动目标，并贯穿全章。
4. 必须推进至少一个关键伏笔。
5. 必须让危机升级（不能停滞）。
6. 结尾必须形成新的钩子。
7. 保持番茄风格：短句、快节奏、强冲突。
8. 正文有效字数不得低于 ${params.minChapterWords} 字，建议目标 1500~2200 字。

【允许】
- 重写结构
- 重写对白
- 重写动作链

【禁止】
- 新增主线剧情
- 改变人物关系
- 改变战力体系
- 改变既有伏笔含义
- 低于最低字数要求

输出：完整章节正文`;
}

function summarizeChapterForSalvage(chapter: string): string {
  const normalized = chapter.replace(/\s+/g, "\n").trim();
  if (normalized.length <= 2600) return normalized;
  const head = normalized.slice(0, 1300);
  const tail = normalized.slice(-1300);
  return `${head}\n\n……中段省略，仅保留剧情意图参考，禁止照抄原始结构……\n\n${tail}`;
}

function stripMarkdownCodeFence(raw: string): string {
  return raw
    .replace(/^```(?:markdown|md|text|txt)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
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

interface ContinuityDecisionMetadata {
  readonly decisionSource: string;
  readonly usedFile: string;
  readonly bodySource: ContinuityBodySource;
  readonly fixAttempt: number;
  readonly maxFixAttempts: number;
  readonly staleReportsIgnored?: ReadonlyArray<string>;
}

function makeContinuityDecisionReport(
  report: ContinuityReport,
  metadata: ContinuityDecisionMetadata & { readonly finalStatus: "PASS" | "MANUAL_REVIEW" | "DROP" },
): ContinuityReport {
  return {
    ...report,
    status: metadata.finalStatus === "PASS" ? "PASS" : report.status,
    rewrite_mode: metadata.finalStatus === "PASS" ? "none" : report.rewrite_mode,
    rewrite_prompt: metadata.finalStatus === "PASS" ? "" : report.rewrite_prompt,
    manual_fix_prompt: metadata.finalStatus === "PASS" ? "" : report.manual_fix_prompt,
    fix_attempt: metadata.fixAttempt,
    max_fix_attempts: metadata.maxFixAttempts,
    final_status: metadata.finalStatus,
    decision_source: metadata.decisionSource,
    used_file: metadata.usedFile,
    body_source: metadata.bodySource,
    stale_reports_ignored: metadata.staleReportsIgnored ?? [],
  } as ContinuityReport;
}

async function staleContinuityReportsForInitialPass(reportDir: string, prefix: string): Promise<string[]> {
  const candidates = [`${prefix}.salvage-report.json`];
  const existing: string[] = [];
  for (const name of candidates) {
    try {
      await stat(join(reportDir, name));
      existing.push(name);
    } catch {
      // Missing stale reports are fine; only existing files are recorded.
    }
  }
  return existing;
}

function markManualReview(
  report: ContinuityReport,
  reason = "",
  metadata?: ContinuityDecisionMetadata,
): ContinuityReport {
  const warning = "Chapter failed to reach PASS after max attempts. Manual review required.";
  const suffix = reason ? `${warning} ${reason}` : warning;
  return {
    ...report,
    status: "MANUAL_REVIEW",
    fix_attempt: metadata?.fixAttempt ?? report.fix_attempt,
    max_fix_attempts: metadata?.maxFixAttempts ?? report.max_fix_attempts,
    final_status: "MANUAL_REVIEW",
    decision_source: metadata?.decisionSource ?? report.decision_source,
    used_file: metadata?.usedFile ?? report.used_file,
    body_source: metadata?.bodySource ?? (report as ContinuityReport & { body_source?: ContinuityBodySource }).body_source,
    stale_reports_ignored: metadata?.staleReportsIgnored ?? report.stale_reports_ignored,
    summary: `${report.summary}\n\n${suffix}`,
  } as ContinuityReport;
}

function markDrop(
  report: ContinuityReport,
  reason = "",
  metadata?: ContinuityDecisionMetadata,
): ContinuityReport {
  const warning = "Chapter failed salvage_rewrite and cannot enter the publish pool.";
  const suffix = reason ? `${warning} ${reason}` : warning;
  return {
    ...report,
    fix_attempt: metadata?.fixAttempt ?? report.fix_attempt,
    max_fix_attempts: metadata?.maxFixAttempts ?? report.max_fix_attempts,
    final_status: "DROP",
    decision_source: metadata?.decisionSource ?? report.decision_source,
    used_file: metadata?.usedFile ?? report.used_file,
    body_source: metadata?.bodySource ?? (report as ContinuityReport & { body_source?: ContinuityBodySource }).body_source,
    stale_reports_ignored: metadata?.staleReportsIgnored ?? report.stale_reports_ignored,
    summary: `${report.summary}\n\n${suffix}`,
  } as ContinuityReport;
}

export function retainNonSalvageFinalAfterSalvageFailure(
  report: ContinuityReport,
  reason: string,
): ContinuityReport {
  const normalized = removeStaleRepeatedInfoBlockers(report);
  const note = reason.trim();
  const summary = note && !normalized.summary.includes(note)
    ? `${normalized.summary}\n\n${note}`
    : normalized.summary;
  return {
    ...normalized,
    summary,
    final_status: normalized.final_status === "PASS" ? "PASS" : "MANUAL_REVIEW",
  } as ContinuityReport;
}

export function removeStaleRepeatedInfoBlockers(report: ContinuityReport): ContinuityReport {
  const repeated = (report.repeated_info_check as { repeated_paragraphs?: unknown[] } | undefined)?.repeated_paragraphs;
  if (!Array.isArray(repeated) || repeated.length > 0) return report;

  const staleRepeated = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const text = JSON.stringify(value);
    return text.includes("重复解释")
      || text.includes("真名剥离")
      || text.includes("葬渊反噬");
  };
  const staleRepeatedText = (value: unknown): boolean => {
    if (typeof value !== "string") return false;
    return value.includes("重复解释")
      || value.includes("真名剥离")
      || value.includes("葬渊反噬");
  };
  const summary = report.summary
    .replace(/开头仍有少量重复解释，?/g, "")
    .replace(/当前章节.*?重复解释.*?。/g, "")
    .trim();

  return {
    ...report,
    summary: summary || report.summary,
    issues: report.issues.filter((issue) => !staleRepeated(issue)),
    fix_suggestions: report.fix_suggestions.filter((suggestion) => !staleRepeatedText(suggestion)),
    publish_blockers: report.publish_blockers.filter((blocker) => !staleRepeated(blocker)),
    rewrite_prompt: "",
    manual_fix_prompt: "",
  } as ContinuityReport;
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

async function resolveReviewedChapterForContinuity(bookDir: string, chapter: number): Promise<ContinuityChapterFile> {
  const original = await findChapterFile(bookDir, chapter);
  const warnings: string[] = [];
  const publishReady = await readPublishReadyReportIfExists(bookDir, chapter);
  if (publishReady && isExportablePublishStatus(String(publishReady.publish_status ?? "")) && typeof publishReady.final_candidate_file === "string") {
    const reviewedPath = resolveUsedFilePath(bookDir, publishReady.final_candidate_file);
    if (reviewedPath) {
      return {
        ...original,
        file: reviewedPath,
        bodySource: bodySourceFromPath(reviewedPath),
        decisionSource: "publish_ready",
        fromExistingPass: true,
        warnings,
      };
    }
    warnings.push(`${publishReady.publish_status} publish-ready final_candidate_file is missing: ${publishReady.final_candidate_file}; falling back to continuity candidates.`);
  }
  const finalReport = await readContinuityReportIfExists(bookDir, chapter, "final-report");

  if (isContinuityPassReport(finalReport)) {
    const usedFile = typeof finalReport?.used_file === "string" ? finalReport.used_file : "";
    if (usedFile) {
      const usedPath = resolveUsedFilePath(bookDir, usedFile);
      if (usedPath) {
        return {
          ...original,
          file: usedPath,
          bodySource: bodySourceFromPath(usedPath),
          decisionSource: "reviewed_existing",
          fromExistingPass: true,
          warnings,
        };
      }
      warnings.push(`PASS final-report used_file is missing: ${usedFile}; falling back to reviewed candidates/original.`);
    }
  }

  const polished = await findLatestPolishedPassFile(bookDir, chapter);
  if (polished) {
    return { ...original, file: polished, bodySource: "polished", fromExistingPass: false, warnings };
  }

  const salvageLightfix = join(bookDir, "chapters-salvaged", `${chapterNumberPrefix(chapter)}_salvage_lightfix.md`);
  if (await fileExists(salvageLightfix) && await hasPassContinuityReport(bookDir, chapter, ["salvage-report", "final-report"])) {
    return { ...original, file: salvageLightfix, bodySource: "salvaged", fromExistingPass: false, warnings };
  }

  const salvage = join(bookDir, "chapters-salvaged", `${chapterNumberPrefix(chapter)}_salvage.md`);
  if (await fileExists(salvage) && await hasPassContinuityReport(bookDir, chapter, ["salvage-report", "final-report"])) {
    return { ...original, file: salvage, bodySource: "salvaged", fromExistingPass: false, warnings };
  }

  const fixed = await findLatestFixedPassFile(bookDir, chapter);
  if (fixed) {
    return { ...original, file: fixed, bodySource: "fixed", fromExistingPass: false, warnings };
  }

  return { ...original, bodySource: "original", fromExistingPass: false, warnings };
}

async function resolveOverrideChapterSource(bookDir: string, chapter: number, overridePath: string): Promise<ReviewedChapterSource> {
  const original = await findChapterFile(bookDir, chapter);
  const continuityFinal = await readContinuityReportIfExists(bookDir, chapter, "final-report");
  const continuityFinalStatus = normalizeContinuityFinalStatus(continuityFinal?.final_status ?? continuityFinal?.status);
  const qualityFinal = await readQualityReportIfExists(bookDir, chapter, "final-quality-report");
  return {
    path: overridePath,
    title: original.title,
    body_source: bodySourceFromPath(overridePath),
    decision_source: "override",
    continuity_final_status: continuityFinalStatus,
    quality_final_status: normalizeQualityFinalStatus(qualityFinal?.final_quality_status ?? qualityFinal?.quality_final_status),
    publish_blocked_by_continuity: Boolean(continuityFinalStatus && continuityFinalStatus !== "PASS"),
    warnings: [],
  };
}

async function resolveReviewedChapterSource(
  bookDir: string,
  chapter: number,
  options?: { readonly allowQualityFinal?: boolean },
): Promise<ReviewedChapterSource> {
  const original = await findChapterFile(bookDir, chapter);
  const warnings: string[] = [];
  const publishReady = await readPublishReadyReportIfExists(bookDir, chapter);
  if (publishReady && isExportablePublishStatus(String(publishReady.publish_status ?? "")) && typeof publishReady.final_candidate_file === "string") {
    const reviewedPath = resolveUsedFilePath(bookDir, publishReady.final_candidate_file);
    if (reviewedPath) {
      const qualityFinalStatus = normalizeQualityFinalStatus(publishReady.quality?.final_quality_status);
      return {
        path: reviewedPath,
        title: original.title,
        body_source: bodySourceFromPath(reviewedPath),
        decision_source: "publish_ready",
        continuity_final_status: normalizeContinuityFinalStatus(publishReady.continuity?.final_status),
        quality_final_status: qualityFinalStatus,
        publish_blocked_by_continuity: false,
        warnings,
      };
    }
    warnings.push(`${publishReady.publish_status} publish-ready final_candidate_file is missing: ${publishReady.final_candidate_file}; falling back to continuity/original.`);
  }
  const finalReport = await readContinuityReportIfExists(bookDir, chapter, "final-report");
  const continuityFinalStatus = normalizeContinuityFinalStatus(finalReport?.final_status ?? finalReport?.status);
  const qualityReport = await readQualityReportIfExists(bookDir, chapter, "final-quality-report");
  const qualityFinalStatus = normalizeQualityFinalStatus(qualityReport?.final_quality_status ?? qualityReport?.quality_final_status);

  if (options?.allowQualityFinal && qualityFinalStatus === "QUALITY_PASS" && typeof qualityReport?.used_polished_file === "string") {
    const polishedPath = resolveUsedFilePath(bookDir, qualityReport.used_polished_file);
    if (polishedPath) {
      return {
        path: polishedPath,
        title: original.title,
        body_source: "polished",
        decision_source: "quality_final_report",
        continuity_final_status: continuityFinalStatus,
        quality_final_status: qualityFinalStatus,
        publish_blocked_by_continuity: Boolean(continuityFinalStatus && continuityFinalStatus !== "PASS"),
        warnings,
      };
    }
    warnings.push(`QUALITY_PASS final-quality-report used_polished_file is missing: ${qualityReport.used_polished_file}; falling back to continuity/original.`);
  }

  if (continuityFinalStatus === "PASS") {
    const usedFile = typeof finalReport?.used_file === "string" ? finalReport.used_file : "";
    if (usedFile) {
      const usedPath = resolveUsedFilePath(bookDir, usedFile);
      if (usedPath) {
        return {
          path: usedPath,
          title: original.title,
          body_source: bodySourceFromPath(usedPath),
          decision_source: "continuity_final_report",
          continuity_final_status: continuityFinalStatus,
          quality_final_status: qualityFinalStatus,
          publish_blocked_by_continuity: false,
          warnings,
        };
      }
      warnings.push(`PASS final-report used_file is missing: ${usedFile}; falling back to reviewed candidates/original.`);
    }
  }

  if (continuityFinalStatus && continuityFinalStatus !== "PASS") {
    const usedFile = typeof finalReport?.used_file === "string" ? finalReport.used_file : "";
    const usedPath = usedFile ? resolveUsedFilePath(bookDir, usedFile) : null;
    return {
      path: usedPath ?? original.file,
      title: original.title,
      body_source: usedPath ? bodySourceFromPath(usedPath) : "original",
      decision_source: usedPath ? "continuity_final_report_blocked" : "fallback_original",
      continuity_final_status: continuityFinalStatus,
      quality_final_status: qualityFinalStatus,
      publish_blocked_by_continuity: true,
      warnings,
    };
  }

  return {
    path: original.file,
    title: original.title,
    body_source: "original",
    decision_source: "fallback_original",
    continuity_final_status: continuityFinalStatus,
    quality_final_status: qualityFinalStatus,
    publish_blocked_by_continuity: false,
    warnings,
  };
}

async function findChapterFile(bookDir: string, chapter: number): Promise<ContinuityChapterFile> {
  const roots = [join(bookDir, "chapters"), bookDir];
  const systemDirs = [
    "reviews",
    "story",
    "chapters-reviewed",
    "chapters-fixed",
    "chapters-polished",
    "chapters-quality-fixed",
    "chapters-plot-fixed",
    "chapters-salvaged",
  ];
  for (const root of roots) {
    const isBookDir = root === bookDir;
    const files = await listFiles(root, isBookDir ? systemDirs : []).catch(() => []);
    const found = files
      .filter((file) => /\.(md|txt)$/i.test(file))
      .filter((file) => !isContinuityBackupChapterFile(file))
      .filter((file) => getChapterNumberFromFile(file) === chapter)
      .sort()[0];
    if (found) {
      return { file: found, title: getChapterTitleFromFile(found) };
    }
  }
  throw new Error(`Chapter ${chapter} not found under ${bookDir}/chapters`);
}

export function isContinuityBackupChapterFile(file: string): boolean {
  return /\.before-continuity-fix\.(md|txt)$/i.test(file);
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

async function findLatestFixedPassFile(bookDir: string, chapter: number): Promise<string | null> {
  const finalReport = await readContinuityReportIfExists(bookDir, chapter, "final-report");
  if (!isContinuityPassReport(finalReport)) return null;
  const fixedDir = join(bookDir, "chapters-fixed");
  const files = await listFiles(fixedDir).catch(() => []);
  return files
    .filter((file) => /\.(md|txt)$/i.test(file))
    .filter((file) => getChapterNumberFromFile(file) === chapter)
    .sort((a, b) => (getAttemptFromFilename(b) ?? 0) - (getAttemptFromFilename(a) ?? 0))[0] ?? null;
}

async function findLatestPolishedPassFile(bookDir: string, chapter: number): Promise<string | null> {
  const qualityReport = await readQualityReportIfExists(bookDir, chapter, "final-quality-report");
  if (qualityReport?.final_quality_status !== "QUALITY_PASS") return null;
  const polishedDir = join(bookDir, "chapters-polished");
  const files = await listFiles(polishedDir).catch(() => []);
  return files
    .filter((file) => /\.(md|txt)$/i.test(file))
    .filter((file) => getChapterNumberFromFile(file) === chapter)
    .sort((a, b) => (getPolishAttemptFromFilename(b) ?? 0) - (getPolishAttemptFromFilename(a) ?? 0))[0] ?? null;
}

async function findLatestPolishedFile(bookDir: string, chapter: number): Promise<string | null> {
  const polishedDir = join(bookDir, "chapters-polished");
  const files = await listFiles(polishedDir).catch(() => []);
  return files
    .filter((file) => /\.(md|txt)$/i.test(file))
    .filter((file) => getChapterNumberFromFile(file) === chapter)
    .sort((a, b) => (getPolishAttemptFromFilename(b) ?? 0) - (getPolishAttemptFromFilename(a) ?? 0))[0] ?? null;
}

async function findLatestQualityFixedFile(bookDir: string, chapter: number): Promise<string | null> {
  const qualityFixedDir = join(bookDir, "chapters-quality-fixed");
  const files = await listFiles(qualityFixedDir).catch(() => []);
  return files
    .filter((file) => /\.(md|txt)$/i.test(file))
    .filter((file) => getChapterNumberFromFile(file) === chapter)
    .sort((a, b) => (getQualityFixAttemptFromFilename(b) ?? 0) - (getQualityFixAttemptFromFilename(a) ?? 0))[0] ?? null;
}

async function hasPassContinuityReport(
  bookDir: string,
  chapter: number,
  kinds: ReadonlyArray<"report" | "final-report" | "salvage-report">,
): Promise<boolean> {
  for (const kind of kinds) {
    const report = await readContinuityReportIfExists(bookDir, chapter, kind);
    if (isContinuityPassReport(report)) return true;
  }
  return false;
}

async function readContinuityReportIfExists(
  bookDir: string,
  chapter: number,
  kind: "report" | "final-report" | "salvage-report",
): Promise<Partial<ContinuityReport> | null> {
  const file = join(bookDir, "reviews", "continuity", `${chapterNumberPrefix(chapter)}.${kind}.json`);
  return readJsonIfExists<Partial<ContinuityReport>>(file);
}

async function readQualityReportIfExists(
  bookDir: string,
  chapter: number,
  kind: "quality-report" | "final-quality-report",
): Promise<Partial<FanqieQualityReport> | null> {
  const file = join(bookDir, "reviews", "fanqie-quality", `${chapterNumberPrefix(chapter)}.${kind}.json`);
  return readJsonIfExists<Partial<FanqieQualityReport>>(file);
}

async function readPublishReadyReportIfExists(
  bookDir: string,
  chapter: number,
): Promise<Partial<PublishReadyResult> | null> {
  const file = join(bookDir, "reviews", "publish-ready", `${chapterNumberPrefix(chapter)}.publish-report.json`);
  return readJsonIfExists<Partial<PublishReadyResult>>(file);
}

async function readPlotFixReportIfExists(
  bookDir: string,
  chapter: number,
): Promise<Partial<PlotAutoFixResult> | null> {
  const file = join(bookDir, "reviews", "plot-auto-fix", `${chapterNumberPrefix(chapter)}.plot-fix-report.json`);
  return readJsonIfExists<Partial<PlotAutoFixResult>>(file);
}

async function isFileNewerThan(file: string, baseline: string): Promise<boolean> {
  try {
    const [fileStat, baselineStat] = await Promise.all([stat(file), stat(baseline)]);
    return fileStat.mtimeMs > baselineStat.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readStoryEffectivenessReportIfExists(
  bookDir: string,
  chapter: number,
): Promise<Partial<StoryEffectivenessReport> | null> {
  const file = join(bookDir, "reviews", "story-effectiveness", `${chapterNumberPrefix(chapter)}.report.json`);
  return readJsonIfExists<Partial<StoryEffectivenessReport>>(file);
}

async function readStoryEffectivenessSummary(
  bookDir: string,
  chapter: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const report = await readStoryEffectivenessReportIfExists(bookDir, chapter);
  if (!report) return undefined;
  const score = report.score ?? null;
  const status = report.status ?? "UNKNOWN";
  let summary: string;
  if (status === "SKIPPED") {
    summary = report.skippedReason ?? "未执行审核。";
  } else if (status === "PASS") {
    summary = report.strengths?.length
      ? `六步心法审核通过，亮点：${report.strengths.slice(0, 3).join("；")}`
      : "六步心法审核通过。";
  } else if (status === "WARN") {
    summary = report.issues?.length
      ? `存在结构弱点：${report.issues.filter((i) => i.severity !== "info").slice(0, 2).map((i) => i.message).join("；")}`
      : "存在结构弱点，建议人工关注。";
  } else if (status === "FAIL_STRUCTURAL") {
    summary = report.issues?.length
      ? `结构缺陷：${report.issues.filter((i) => i.severity === "critical").slice(0, 2).map((i) => i.message).join("；")}`
      : "存在严重结构缺陷，建议人工审查。";
  } else {
    summary = "";
  }
  return { status, score, summary };
}

export async function generateStoryEffectivenessReport(
  bookDir: string,
  chapterIndex: number,
  chapterContent: string,
  structureSignals?: StructureSignals | null,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const reviewer = new StoryEffectivenessAgent(DUMMY_CTX);
  const report = await reviewer.review({
    chapter: chapterIndex,
    chapterContent,
    structureSignals,
  });
  const prefix = chapterNumberPrefix(chapterIndex);
  const reportDir = join(bookDir, "reviews", "story-effectiveness");
  await writeStoryEffectivenessReportFiles({
    report,
    jsonPath: join(reportDir, `${prefix}.report.json`),
    markdownPath: join(reportDir, `${prefix}.report.md`),
  });
  return readStoryEffectivenessSummary(bookDir, chapterIndex);
}

async function readGolden3ChapterReportIfExists(
  bookDir: string,
): Promise<Partial<Golden3ChapterReport> | null> {
  const file = join(bookDir, "reviews", "golden-3-chapter", "golden-3-chapter.report.json");
  return readJsonIfExists<Partial<Golden3ChapterReport>>(file);
}

async function readGolden3ChapterSummary(
  bookDir: string,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const report = await readGolden3ChapterReportIfExists(bookDir);
  if (!report) return undefined;
  const score = report.score ?? null;
  const status = report.status ?? "UNKNOWN";
  const summary = report.summary ?? "";
  return { status, score, summary };
}

async function readOpeningHookSummaryLocal(
  bookDir: string,
  chapter: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  return readOpeningHookSummary(bookDir, chapter);
}

/**
 * Parse chapter intent §12 (本章结构信号关键词) and merge extracted keywords
 * into the book-level StructureSignals. Returns a new StructureSignals with
 * intent keywords unioned into the relevant dimensions, or null if no keywords found.
 */
function mergeIntentSignals(
  baseSignals: StructureSignals,
  intentContent: string,
): StructureSignals | null {
  // Extract §12 section content
  const sectionMatch = intentContent.match(
    /##\s*12[.\s]*本章结构信号关键词([\s\S]*?)(?=\n##\s|\n---|\n\*\*\*|$)/u,
  );
  if (!sectionMatch?.[1]?.trim()) return null;

  const section = sectionMatch[1];
  const dimensionMap: Record<string, keyof StructureSignals["signals"]> = {
    opening_hook: "opening_hook",
    pressure_source: "pressure_source",
    obstacle_dilemma: "obstacle_dilemma",
    ending_pull: "ending_pull",
  };

  let anyMerged = false;
  const mergedSignals = { ...baseSignals.signals };

  for (const [key, dim] of Object.entries(dimensionMap)) {
    // Match lines like "- opening_hook（...）：扣分、死局、抹杀"
    const lineMatch = section.match(
      new RegExp(`-\\s*${key}[^：:]*[：:]\\s*(.+)`, "u"),
    );
    if (!lineMatch?.[1]?.trim()) continue;

    // Split by Chinese/English comma, 、, or whitespace
    const keywords = lineMatch[1]
      .split(/[,，、\s]+/u)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && w.length <= 8);

    if (keywords.length === 0) continue;

    const existing = new Set(mergedSignals[dim] ?? []);
    for (const kw of keywords) {
      if (!existing.has(kw)) {
        existing.add(kw);
        anyMerged = true;
      }
    }
    mergedSignals[dim] = [...existing];
  }

  if (!anyMerged) return null;

  return {
    ...baseSignals,
    signals: mergedSignals as StructureSignals["signals"],
  };
}

export async function generateOpeningHookReport(
  bookDir: string,
  chapterIndex: number,
  chapterContent: string,
  chapterTitle?: string,
  structureSignals?: StructureSignals | null,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const reviewer = new OpeningHookReviewerAgent(DUMMY_CTX);
  const report = await reviewer.review({
    chapterContent,
    chapterIndex,
    chapterTitle,
    structureSignals,
  });
  const prefix = chapterNumberPrefix(chapterIndex);
  const reportDir = join(bookDir, "reviews", "opening-hook");
  await writeOpeningHookReportFiles({
    report,
    jsonPath: join(reportDir, `${prefix}.opening-hook.report.json`),
    markdownPath: join(reportDir, `${prefix}.opening-hook.report.md`),
  });
  return {
    status: report.status,
    score: report.score,
    summary: report.summary,
  };
}

async function readAntagonistIntelligenceSummaryLocal(
  bookDir: string,
  chapter: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  return readAntagonistIntelligenceSummary(bookDir, chapter);
}

export async function generateAntagonistIntelligenceReport(
  bookDir: string,
  chapterIndex: number,
  chapterContent: string,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const reviewer = new AntagonistIntelligenceReviewerAgent(DUMMY_CTX);
  const report = await reviewer.review({
    chapter: chapterIndex,
    chapterContent,
  });
  const prefix = chapterNumberPrefix(chapterIndex);
  const reportDir = join(bookDir, "reviews", "antagonist-intelligence");
  await writeAntagonistIntelligenceReportFiles({
    report,
    jsonPath: join(reportDir, `${prefix}.report.json`),
    markdownPath: join(reportDir, `${prefix}.report.md`),
  });
  return {
    status: report.status,
    score: report.score,
    summary: report.summary,
  };
}

async function readTransitionQualitySummaryLocal(
  bookDir: string,
  chapter: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  return readTransitionQualitySummary(bookDir, chapter);
}

async function readSixStepPlotSummaryLocal(
  bookDir: string,
  chapter: number,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  return readSixStepPlotSummary(bookDir, chapter);
}

async function readSixStepPlotReportIfExists(
  bookDir: string,
  chapter: number,
): Promise<Record<string, unknown> | null> {
  const file = join(bookDir, "reviews", "six-step-plot", `${chapterNumberPrefix(chapter)}.six-step-plot.report.json`);
  return readJsonIfExists<Record<string, unknown>>(file);
}

async function deletePublishReadyStructureReportsIfExists(bookDir: string, chapter: number): Promise<void> {
  const prefix = chapterNumberPrefix(chapter);
  const files = [
    join(bookDir, "reviews", "story-effectiveness", `${prefix}.report.json`),
    join(bookDir, "reviews", "story-effectiveness", `${prefix}.report.md`),
    join(bookDir, "reviews", "opening-hook", `${prefix}.opening-hook.report.json`),
    join(bookDir, "reviews", "opening-hook", `${prefix}.opening-hook.report.md`),
    join(bookDir, "reviews", "antagonist-intelligence", `${prefix}.report.json`),
    join(bookDir, "reviews", "antagonist-intelligence", `${prefix}.report.md`),
    join(bookDir, "reviews", "transition-quality", `${prefix}.transition-quality.report.json`),
    join(bookDir, "reviews", "transition-quality", `${prefix}.transition-quality.report.md`),
    join(bookDir, "reviews", "six-step-plot", `${prefix}.six-step-plot.report.json`),
    join(bookDir, "reviews", "six-step-plot", `${prefix}.six-step-plot.report.md`),
  ];
  await Promise.all(files.map((file) =>
    unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    }),
  ));
}

export async function generateSixStepPlotReport(
  bookDir: string,
  chapterIndex: number,
  chapterContent: string,
  chapterTitle?: string,
  structureSignals?: StructureSignals | null,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  // Optionally read chapterIntent for intentFidelity; failure must not block generation
  const prefix = String(chapterIndex).padStart(4, "0");
  let chapterIntent: string | undefined;
  try {
    const intentPath = join(bookDir, "story", "runtime", "chapter-intents", `${prefix}.md`);
    chapterIntent = await readFile(intentPath, "utf-8").catch(() => undefined);
  } catch {
    // chapter-intent not available; proceed without it
  }

  const reviewer = new SixStepPlotReviewerAgent(DUMMY_CTX);
  const report = await reviewer.review({
    chapterContent,
    chapterIndex,
    chapterTitle,
    chapterIntent,
    structureSignals,
  });
  const reportDir = join(bookDir, "reviews", "six-step-plot");
  await writeSixStepPlotReportFiles({
    report,
    jsonPath: join(reportDir, `${prefix}.six-step-plot.report.json`),
    markdownPath: join(reportDir, `${prefix}.six-step-plot.report.md`),
  });
  return {
    status: report.status,
    score: report.score,
    summary: report.summary,
  };
}

export async function generateTransitionQualityReport(
  bookDir: string,
  chapterIndex: number,
  chapterContent: string,
  chapterTitle?: string,
): Promise<{ status: string; score: number | null; summary: string } | undefined> {
  const reviewer = new TransitionQualityReviewerAgent(DUMMY_CTX);
  const report = await reviewer.review({
    chapterContent,
    chapterIndex,
    chapterTitle,
  });
  const prefix = String(chapterIndex).padStart(4, "0");
  const reportDir = join(bookDir, "reviews", "transition-quality");
  await writeTransitionQualityReportFiles({
    report,
    jsonPath: join(reportDir, `${prefix}.transition-quality.report.json`),
    markdownPath: join(reportDir, `${prefix}.transition-quality.report.md`),
  });
  return {
    status: report.status,
    score: report.score,
    summary: report.summary,
  };
}

export async function resolveContentForTransitionQuality(
  bookDir: string,
  chapterIndex: number,
  finalCandidateFile: string | undefined,
  sourceFile: string | undefined,
): Promise<{ content: string; path: string } | null> {
  // Priority 1: final_candidate_file
  if (finalCandidateFile) {
    const resolved = resolveUsedFilePath(bookDir, finalCandidateFile);
    if (resolved) {
      return { content: await readFile(resolved, "utf-8"), path: resolved };
    }
  }

  // Priority 2: source_file
  if (sourceFile) {
    const resolved = resolveUsedFilePath(bookDir, sourceFile);
    if (resolved) {
      return { content: await readFile(resolved, "utf-8"), path: resolved };
    }
  }

  // Priority 3: original chapter file
  try {
    const chapterFile = await findChapterFile(bookDir, chapterIndex);
    if (chapterFile?.file) {
      return { content: await readFile(chapterFile.file, "utf-8"), path: chapterFile.file };
    }
  } catch {
    // Chapter not found; fall through to return null
  }

  return null;
}

async function readResourceConsistencyReportIfExists(
  bookDir: string,
  chapter: number,
): Promise<Partial<{
  blocking: boolean;
  closureStatus: string;
  status: string;
  wordCount: number;
  closureRequirement: string;
}> | null> {
  const file = join(bookDir, "reviews", "resource-consistency", `${chapterNumberPrefix(chapter)}.report.json`);
  return readJsonIfExists(file);
}

interface ChapterIndexEntry {
  readonly number: number;
  readonly status: string;
  readonly wordCount?: number;
}

export async function readChapterIndexStatus(
  bookDir: string,
  chapter: number,
): Promise<string | null> {
  const indexFile = join(bookDir, "chapters", "index.json");
  const index = await readJsonIfExists<ChapterIndexEntry[]>(indexFile);
  if (!index) return null;
  const entry = index.find((c) => c.number === chapter);
  return entry?.status ?? null;
}

async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isContinuityPassReport(report: Partial<ContinuityReport> | null): boolean {
  if (!report) return false;
  return (report.final_status ?? report.status) === "PASS";
}

function normalizeContinuityFinalStatus(value: unknown): "PASS" | "MANUAL_REVIEW" | "DROP" | undefined {
  return value === "PASS" || value === "MANUAL_REVIEW" || value === "DROP" ? value : undefined;
}

function normalizeQualityFinalStatus(value: unknown): FanqieFinalQualityStatus | undefined {
  return value === "QUALITY_PASS" || value === "QUALITY_WARN_POLISH_OPTIONAL" || value === "QUALITY_MANUAL_REVIEW" ? value : undefined;
}

function normalizeBodySourceValue(value: unknown): ContinuityBodySource | undefined {
  return value === "fixed" || value === "salvaged" || value === "polished" || value === "original" ? value : undefined;
}

function resolveUsedFilePath(bookDir: string, usedFile: string): string | null {
  const candidates = [
    isAbsolute(usedFile) ? usedFile : "",
    join(bookDir, usedFile),
    join(dirname(dirname(bookDir)), usedFile),
    join(dirname(dirname(dirname(bookDir))), usedFile),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

function bodySourceFromPath(file: string): ContinuityBodySource {
  if (file.includes("chapters-reviewed")) return "polished";
  if (file.includes("chapters-polished")) return "polished";
  if (file.includes("chapters-salvaged")) return "salvaged";
  if (file.includes("chapters-fixed")) return "fixed";
  return "original";
}

function isContinuityPublishPass(report: ContinuityReport): boolean {
  return report.score >= 85
    && report.length_status === "PASS"
    && report.publish_readiness === "PASS"
    && report.final_status !== "DROP";
}

async function listFiles(dir: string, excludeDirs: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) {
        continue;
      }
      const file = join(dir, entry.name);
      files.push(...await listFiles(file, excludeDirs));
    } else {
      files.push(join(dir, entry.name));
    }
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

function getPolishAttemptFromFilename(file: string): number | null {
  const match = basename(file).match(/_polished_attempt(\d+)\.(?:md|txt)$/i);
  if (!match) return null;
  const attempt = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(attempt) && attempt > 0 ? attempt : null;
}

function getQualityFixAttemptFromFilename(file: string): number | null {
  const match = basename(file).match(/_quality_fix_attempt(\d+)\.(?:md|txt)$/i);
  if (!match) return null;
  const attempt = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(attempt) && attempt > 0 ? attempt : null;
}

type DiagnoseSeverity = "blocker" | "warning" | "info";
type DiagnoseKind = "write" | "state" | "resource" | "continuity" | "quality" | "plot" | "export" | "review" | "approval" | "unknown";

interface DiagnoseRepairPlan {
  readonly id: string;
  readonly severity: DiagnoseSeverity;
  readonly kind: DiagnoseKind;
  readonly title: string;
  readonly evidence: ReadonlyArray<string>;
  readonly inspectFiles: ReadonlyArray<string>;
  readonly editFiles: ReadonlyArray<string>;
  readonly search: ReadonlyArray<string>;
  readonly change: ReadonlyArray<string>;
  readonly nextCommands: ReadonlyArray<string>;
}

interface DiagnoseChapterResult {
  readonly book: string;
  readonly chapter: string;
  readonly chapterStatus: string | null;
  readonly publishStatus: string | null;
  readonly finalCandidateFile: string | null;
  readonly continuityScore?: number | null;
  readonly continuityStatus?: string | null;
  readonly qualityScore?: number | null;
  readonly qualityStatus?: string | null;
  readonly reports: Record<string, string>;
  readonly plans: ReadonlyArray<DiagnoseRepairPlan>;
}

async function diagnoseChapterRepair(params: {
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
}): Promise<DiagnoseChapterResult> {
  const prefix = chapterNumberPrefix(params.chapter);
  const chapterStatus = await readChapterIndexStatus(params.bookDir, params.chapter);
  const publishReport = await readPublishReadyReportIfExists(params.bookDir, params.chapter);
  const publishReportPath = join(params.bookDir, "reviews", "publish-ready", `${prefix}.publish-report.json`);
  const plotFixReportPath = join(params.bookDir, "reviews", "plot-auto-fix", `${prefix}.plot-fix-report.json`);
  const plotFixReport = await readPlotFixReportIfExists(params.bookDir, params.chapter);
  const plotFixNewerThanPublishReady = await isFileNewerThan(plotFixReportPath, publishReportPath);
  const continuityReport = await readContinuityReportIfExists(params.bookDir, params.chapter, "final-report");
  const qualityReport = await readQualityReportIfExists(params.bookDir, params.chapter, "final-quality-report")
    ?? await readQualityReportIfExists(params.bookDir, params.chapter, "quality-report");
  const resourceReport = await readResourceConsistencyReportIfExists(params.bookDir, params.chapter);
  const exportReportPath = join(params.root, "publish", params.bookId, "fanqie", "report.md");
  const exportReportText = await readTextIfExists(exportReportPath);
  const chapterEntry = await readChapterIndexEntry(params.bookDir, params.chapter);
  const auditIssues = extractAuditIssues(chapterEntry);
  const finalCandidateFile = resolveDiagnoseFinalCandidate(params.bookDir, publishReport?.final_candidate_file, params.chapter);
  const originalChapterFile = findOriginalChapterFileSync(params.bookDir, params.chapter);
  const plans: DiagnoseRepairPlan[] = [];

  const baseReports = {
    chapter_index: relative(params.root, join(params.bookDir, "chapters", "index.json")),
    publish_ready: relative(params.root, join(params.bookDir, "reviews", "publish-ready", `${prefix}.publish-report.json`)),
    plot_auto_fix: relative(params.root, plotFixReportPath),
    continuity: relative(params.root, join(params.bookDir, "reviews", "continuity", `${prefix}.final-report.json`)),
    fanqie_quality: relative(params.root, join(params.bookDir, "reviews", "fanqie-quality", `${prefix}.final-quality-report.json`)),
    resource_consistency: relative(params.root, join(params.bookDir, "reviews", "resource-consistency", `${prefix}.report.json`)),
    export_report: relative(params.root, exportReportPath),
  };

  if (!chapterEntry && !originalChapterFile) {
    plans.push({
      id: "chapter-missing",
      severity: "blocker",
      kind: "write",
      title: "没有找到该章节正文或章节索引记录；这章还不能 publish-ready。",
      evidence: [
        "chapters/index.json 中没有该章节记录",
        `chapters/ 下没有 ${prefix} 开头的正文文件`,
        resourceReport ? "发现孤立的 resource report；它可能来自失败或旧运行，不能代表章节已存在" : "",
      ].filter(Boolean),
      inspectFiles: existingFiles(params.root, [
        baseReports.chapter_index,
        baseReports.resource_consistency,
      ]),
      editFiles: [],
      search: [],
      change: [
        "如果你要继续写这一章，先执行 write next 生成正文和 index 记录。",
        "如果你确认这章已经写过，检查正文文件是否放在 chapters/ 下，且文件名是否以对应章节号开头。",
        "不要直接对不存在的章节跑 publish-ready。",
      ],
      nextCommands: [
        `node packages/cli/dist/index.js write next ${params.bookId}`,
      ],
    });
  }

  if (chapterStatus === "state-degraded") {
    plans.push(makeStateRepairPlan(params, auditIssues));
  }

  if (isCurrentResourceBlocked(chapterStatus, resourceReport, auditIssues, publishReport?.publish_status)) {
    plans.push(makeResourceRepairPlan(params, resourceReport, auditIssues, finalCandidateFile));
  }

  const continuityStatus = publishReport?.continuity?.final_status ?? continuityReport?.final_status ?? continuityReport?.status;
  const hasActionableContinuityStatus = Boolean(continuityStatus && continuityStatus !== "UNKNOWN" && continuityStatus !== "SKIPPED");
  if (publishReport?.publish_status === "BLOCKED_BY_CONTINUITY" || hasActionableContinuityStatus && continuityStatus !== "PASS") {
    plans.push(makeContinuityRepairPlan(params, continuityReport, publishReport));
  }

  const qualityStatus = publishReport?.quality?.final_quality_status ?? qualityReport?.final_quality_status ?? qualityReport?.status;
  if (
    publishReport?.publish_status === "BLOCKED_BY_QUALITY"
    || publishReport?.publish_status === "QUALITY_MANUAL_REVIEW"
    || qualityStatus === "QUALITY_MANUAL_REVIEW"
    || publishReport?.publish_status === "NEED_REWRITE"
  ) {
    plans.push(makeQualityRepairPlan(params, publishReport, qualityReport, finalCandidateFile));
  }

  const plotPlan = makePlotRepairPlanIfNeeded(params, publishReport, exportReportText, finalCandidateFile, plotFixReport, plotFixNewerThanPublishReady);
  if (plotPlan) plans.push(plotPlan);

  const exportPlan = makeExportRepairPlanIfNeeded(params, exportReportText, finalCandidateFile);
  if (exportPlan) plans.push(exportPlan);

  if (!plans.some((plan) => plan.severity === "blocker") && isExportablePublishStatus(String(publishReport?.publish_status ?? ""))) {
    plans.push({
      id: "ready",
      severity: publishReport?.publish_status === "READY_WITH_WARNINGS" ? "warning" : "info",
      kind: "approval",
      title: chapterStatus === "approved"
        ? "章节已 approved；正式导出前做一次 export dry-run。"
        : publishReport?.publish_status === "READY_WITH_WARNINGS"
          ? "章节已可导出，但仍有 warning；approve 前建议做一次 export dry-run。"
          : "章节已可导出；approve 前建议做一次 export dry-run。",
      evidence: [
        `publish_status=${publishReport?.publish_status}`,
        finalCandidateFile ? `final_candidate=${relative(params.root, finalCandidateFile)}` : "final_candidate=n/a",
      ],
      inspectFiles: existingFiles(params.root, [baseReports.publish_ready, baseReports.export_report]),
      editFiles: finalCandidateFile ? [relative(params.root, finalCandidateFile)] : [],
      search: [],
      change: chapterStatus === "approved"
        ? [
            "这章已经 approved，不需要重复 approve。",
            "如果 dry-run 出现 6段检查低于 4/6 或非正文标记残留，先按对应诊断项修。",
          ]
        : [
            "如果 dry-run 没有阻断项，可以 approve。",
            "如果 dry-run 出现 6段检查低于 4/6 或非正文标记残留，先按对应诊断项修。",
          ],
      nextCommands: chapterStatus === "approved"
        ? [
            `node scripts/fanqie/export-fanqie.mjs ${params.bookId} --from ${params.chapter} --to ${params.chapter} --use-reviewed --dry-run`,
          ]
        : [
            `node scripts/fanqie/export-fanqie.mjs ${params.bookId} --from ${params.chapter} --to ${params.chapter} --use-reviewed --dry-run`,
            `node packages/cli/dist/index.js review approve ${params.bookId} ${params.chapter}`,
          ],
    });
  }

  if (
    !plans.some((plan) => plan.severity === "blocker")
    && chapterStatus === "ready-for-review"
    && (!publishReport || publishReport.publish_status === "BLOCKED_BY_RESOURCE")
  ) {
    const staleResourcePublishBlock = publishReport?.publish_status === "BLOCKED_BY_RESOURCE";
    plans.push({
      id: "ready-for-publish-ready",
      severity: plans.length ? "warning" : "info",
      kind: "review",
      title: staleResourcePublishBlock
        ? "章节已 ready-for-review；上次 publish-ready 是旧资源阻断，重跑 publish-ready。"
        : plans.length
        ? "章节已 ready-for-review；可先处理 warning，也可以直接跑 publish-ready。"
        : "章节已 ready-for-review；下一步是跑 publish-ready。",
      evidence: [
        "chapter_status=ready-for-review",
        `publish_status=${publishReport?.publish_status ?? "missing"}`,
        resourceReport ? `stale resource report ignored: status=${resourceReport.status ?? "unknown"} closureStatus=${resourceReport.closureStatus ?? "unknown"}` : "",
      ].filter(Boolean),
      inspectFiles: existingFiles(params.root, [
        baseReports.chapter_index,
        baseReports.resource_consistency,
      ]),
      editFiles: [],
      search: [],
      change: [
        "不需要为了这条诊断再跑 write sync。",
        "只有在你跑 diagnose 后又手动改了正文，或 current_state/hooks 明显和正文不一致时，才需要 write sync 或 repair-state。",
      ],
      nextCommands: [
        `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
      ],
    });
  }

  if (!plans.length) {
    plans.push({
      id: "unknown",
      severity: "info",
      kind: "unknown",
      title: "没有找到明确阻断项；请查看报告摘要决定是否继续。",
      evidence: [
        `chapter_status=${chapterStatus ?? "unknown"}`,
        `publish_status=${publishReport?.publish_status ?? "missing"}`,
      ],
      inspectFiles: existingFiles(params.root, Object.values(baseReports)),
      editFiles: [],
      search: [],
      change: ["先阅读 inspect files 中最新报告；只有在正文或状态文件确实刚被手动改过且报告未同步时，才执行 write sync 或 repair-state。"],
      nextCommands: [
        `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
      ],
    });
  }

  const continuityScore = typeof publishReport?.continuity?.score === "number"
    ? publishReport.continuity.score
    : typeof continuityReport?.score === "number"
      ? continuityReport.score
      : null;
  const qualityScore = typeof publishReport?.quality_score === "number"
    ? publishReport.quality_score
    : typeof publishReport?.quality?.score === "number"
      ? publishReport.quality.score
      : typeof qualityReport?.final_quality_score === "number"
        ? qualityReport.final_quality_score
        : typeof qualityReport?.quality_score === "number"
          ? qualityReport.quality_score
          : null;

  return {
    book: params.bookId,
    chapter: prefix,
    chapterStatus,
    publishStatus: publishReport?.publish_status ?? null,
    finalCandidateFile: finalCandidateFile ? relative(params.root, finalCandidateFile) : null,
    continuityScore,
    continuityStatus: continuityStatus ?? null,
    qualityScore,
    qualityStatus: qualityStatus ?? null,
    reports: Object.fromEntries(
      Object.entries(baseReports).filter(([, file]) => existsSync(join(params.root, file))),
    ),
    plans,
  };
}

function renderDiagnoseChapterRepair(result: DiagnoseChapterResult): string[] {
  const blocker = result.plans.find((plan) => plan.severity === "blocker");
  const approvalPlan = result.chapterStatus === "approved"
    ? result.plans.find((plan) => plan.kind === "approval")
    : undefined;
  const primaryPlan = blocker ?? approvalPlan ?? result.plans[0];
  const lines = [
    "[diagnose]",
    `book: ${result.book}`,
    `chapter: ${result.chapter}`,
    `chapter_status: ${result.chapterStatus ?? "unknown"}`,
    `publish_status: ${result.publishStatus ?? "missing"}`,
  ];
  if (result.continuityScore !== undefined && result.continuityScore !== null) {
    lines.push(`continuity: ${result.continuityStatus ?? "unknown"} (${result.continuityScore})`);
  }
  if (result.qualityScore !== undefined && result.qualityScore !== null) {
    lines.push(`quality: ${result.qualityStatus ?? "unknown"} (${result.qualityScore})`);
  }
  lines.push(result.finalCandidateFile ? `final_candidate: ${result.finalCandidateFile}` : "final_candidate: n/a");
  lines.push("");

  if (primaryPlan) {
    lines.push("next:");
    lines.push(`- ${primaryPlan.title}`);
    for (const command of primaryPlan.nextCommands.slice(0, 2)) lines.push(`- ${command}`);
    lines.push("");
  }

  for (const [index, plan] of result.plans.entries()) {
    lines.push(`plan ${index + 1}: ${plan.title}`);
    lines.push(`- severity: ${plan.severity}`);
    lines.push(`- kind: ${plan.kind}`);
    if (plan.evidence.length) {
      lines.push("- why:");
      for (const item of plan.evidence.slice(0, 4)) lines.push(`  - ${item}`);
    }
    if (plan.editFiles.length) {
      lines.push("- edit:");
      lines.push(`  - ${plan.editFiles[0]}`);
      if (plan.editFiles.length > 1) lines.push(`  - references: ${plan.editFiles.slice(1, 3).join(", ")}`);
    }
    if (plan.inspectFiles.length) {
      lines.push("- inspect:");
      for (const file of plan.inspectFiles.slice(0, 2)) lines.push(`  - ${file}`);
    }
    if (plan.search.length) {
      lines.push("- locate:");
      const target = plan.editFiles[0] ?? ".";
      lines.push(`  - grep -nE "${plan.search.slice(0, 4).join("|")}" ${target}`);
    }
    if (plan.change.length) {
      lines.push("- change:");
      for (const item of plan.change) lines.push(`- ${item}`);
    }
    if (plan.nextCommands.length) {
      lines.push("- commands:");
      for (const command of plan.nextCommands) lines.push(`- ${command}`);
    }
    lines.push("");
  }

  return lines;
}

function makeStateRepairPlan(
  params: { readonly root: string; readonly bookId: string; readonly bookDir: string; readonly chapter: number },
  auditIssues: ReadonlyArray<string>,
): DiagnoseRepairPlan {
  const editFiles = [
    join(params.bookDir, "story", "current_state.md"),
    join(params.bookDir, "story", "state", "current_state.json"),
    join(params.bookDir, "story", "pending_hooks.md"),
    join(params.bookDir, "story", "state", "hooks.json"),
  ].filter(existsSync).map((file) => relative(params.root, file));

  return {
    id: "state-degraded",
    severity: "blocker",
    kind: "state",
    title: "章节状态为 state-degraded；先修状态/真相文件，不要继续写下一章。",
    evidence: auditIssues.filter((issue) => /state-validation|状态|current_state|伏笔|hook|当前位置|敌我/u.test(issue)).slice(0, 8),
    inspectFiles: existingFiles(params.root, [
      relative(params.root, join(params.bookDir, "chapters", "index.json")),
      relative(params.root, join(params.bookDir, "story", "audit_drift.md")),
    ]),
    editFiles,
    search: buildSearchHints(auditIssues, ["current_state", "当前位置", "当前目标", "当前冲突", "敌我", "伏笔"]),
    change: [
      "先判断正文是否正确：如果正文正确而 state 过期，更新 state/current_state 与 hooks；如果正文本身写错，先改正文。",
      "删除已经在正文中结束的当前限制；补上正文结尾仍存在的人物位置、敌我关系、资源和伏笔状态。",
      "不要只改 chapters/index.json 的 status；status 应由 repair-state/sync 后自然恢复。",
    ],
    nextCommands: [
      `node packages/cli/dist/index.js write repair-state ${params.bookId} ${params.chapter}`,
      `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
    ],
  };
}

function makeResourceRepairPlan(
  params: { readonly root: string; readonly bookId: string; readonly bookDir: string; readonly chapter: number },
  resourceReport: Partial<{ status: string; closureStatus: string; closureRequirement: string }> | null,
  auditIssues: ReadonlyArray<string>,
  finalCandidateFile: string | null,
): DiagnoseRepairPlan {
  const chapterFile = findOriginalChapterFileSync(params.bookDir, params.chapter);
  const editFiles = [
    finalCandidateFile,
    chapterFile,
    join(params.bookDir, "story", "particle_ledger.md"),
    join(params.bookDir, "story", "current_state.md"),
    join(params.bookDir, "story", "state", "current_state.json"),
  ]
    .filter((file): file is string => typeof file === "string" && file.length > 0)
    .filter((file) => existsSync(file))
    .map((file) => relative(params.root, file));

  return {
    id: "resource-blocked",
    severity: "blocker",
    kind: "resource",
    title: "资源/账本闭合失败；先修正文中的资源变化和 state 资源余额。",
    evidence: [
      resourceReport?.status ? `resource status=${resourceReport.status}` : "",
      resourceReport?.closureStatus ? `closureStatus=${resourceReport.closureStatus}` : "",
      resourceReport?.closureRequirement ? `closureRequirement=${resourceReport.closureRequirement}` : "",
      ...auditIssues.filter((issue) => /resource|资源|积分|余额|账本|closingBalances|RESOURCE_PLAN|RESOURCE_CONSISTENCY/u.test(issue)).slice(0, 8),
    ].filter(Boolean),
    inspectFiles: existingFiles(params.root, [
      relative(params.root, join(params.bookDir, "reviews", "resource-consistency", `${chapterNumberPrefix(params.chapter)}.report.json`)),
      relative(params.root, join(params.bookDir, "reviews", "resource-consistency", `${chapterNumberPrefix(params.chapter)}.report.md`)),
      relative(params.root, join(params.bookDir, "reviews", "resource-plan", `${chapterNumberPrefix(params.chapter)}.report.json`)),
      relative(params.root, join(params.bookDir, "chapters", "index.json")),
    ]),
    editFiles,
    search: buildSearchHints(auditIssues, ["积分", "余额", "系统积分", "获得", "消耗", "兑换", "closingBalances"]),
    change: [
      "把正文中资源获得、消耗、期末余额写成一条能闭合的链；不要让正文数值和程序账本互相矛盾。",
      "如果正文已经改对，同步 current_state/state JSON 中的资源余额。",
      "如果资源计划要求本章期末余额为某值，正文结尾和状态卡都要体现同一个值。",
    ],
    nextCommands: [
      `node packages/cli/dist/index.js write sync ${params.bookId} ${params.chapter}`,
      `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
    ],
  };
}

function makeContinuityRepairPlan(
  params: { readonly root: string; readonly bookId: string; readonly bookDir: string; readonly chapter: number },
  continuityReport: Partial<ContinuityReport> | null,
  publishReport: Partial<PublishReadyResult> | null,
): DiagnoseRepairPlan {
  return {
    id: "continuity-blocked",
    severity: "blocker",
    kind: "continuity",
    title: "连续性未通过；先修承接、人物状态、伏笔或战力/伤势矛盾。",
    evidence: [
      `continuity=${publishReport?.continuity?.final_status ?? continuityReport?.final_status ?? continuityReport?.status ?? "unknown"}`,
      typeof continuityReport?.score === "number" ? `score=${continuityReport.score}` : "",
      ...(continuityReport?.issues ?? []).slice(0, 5).map((issue) => typeof issue === "string" ? issue : JSON.stringify(issue)),
    ].filter(Boolean),
    inspectFiles: existingFiles(params.root, [
      relative(params.root, join(params.bookDir, "reviews", "continuity", `${chapterNumberPrefix(params.chapter)}.final-report.json`)),
      relative(params.root, join(params.bookDir, "reviews", "continuity", `${chapterNumberPrefix(params.chapter)}.final-report.md`)),
      relative(params.root, join(params.bookDir, "story", "runtime", `chapter-${chapterNumberPrefix(params.chapter)}.intent.md`)),
    ]),
    editFiles: existingFiles(params.root, [
      relative(params.root, finalCandidatePath(params.bookDir, params.chapter)),
      relative(params.root, findOriginalChapterFileSync(params.bookDir, params.chapter) ?? ""),
      relative(params.root, join(params.bookDir, "story", "pending_hooks.md")),
      relative(params.root, join(params.bookDir, "story", "current_state.md")),
    ]),
    search: buildSearchHints([
      ...readStringArrayField(continuityReport, "warnings"),
      ...(continuityReport?.issues ?? []).map(String),
    ], ["上一章", "伏笔", "伤势", "位置", "敌人"]),
    change: [
      "优先小改本章正文，补足上一章结尾到本章开头的承接。",
      "如果问题是伏笔遗漏，补一两句推进或明确延后，不要大改主线。",
      "如果问题是 state 过期而正文正确，改 state 后执行 write repair-state。",
    ],
    nextCommands: [
      `node packages/cli/dist/index.js review continuity-auto --book ${params.bookId} --chapter ${params.chapter} --max-fix-attempts 1`,
      `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
    ],
  };
}

function makeQualityRepairPlan(
  params: { readonly root: string; readonly bookId: string; readonly bookDir: string; readonly chapter: number },
  publishReport: Partial<PublishReadyResult> | null,
  qualityReport: Partial<FanqieQualityReport> | null,
  finalCandidateFile: string | null,
): DiagnoseRepairPlan {
  const qualityScore = publishReport?.quality?.score ?? qualityReport?.quality_score;
  const status = publishReport?.publish_status ?? qualityReport?.status ?? qualityReport?.final_quality_status ?? "unknown";
  return {
    id: "quality-blocked",
    severity: publishReport?.publish_status === "NEED_REWRITE" ? "blocker" : "warning",
    kind: "quality",
    title: publishReport?.publish_status === "NEED_REWRITE"
      ? "质量判断建议重写；小修可能不够。"
      : publishReport?.publish_status === "READY_WITH_WARNINGS"
        ? "可选优化：质量有 warning，但不阻断导出。"
        : "质量未达标；先做番茄风格润色或定点修复。",
    evidence: [
      `status=${status}`,
      typeof qualityScore === "number" ? `score=${qualityScore}` : "",
      ...(qualityReport?.issues ?? []).slice(0, 5).map((issue) => typeof issue === "string" ? issue : `${issue.type ?? "issue"}: ${issue.detail ?? ""}`),
    ].filter(Boolean),
    inspectFiles: existingFiles(params.root, [
      relative(params.root, join(params.bookDir, "reviews", "fanqie-quality", `${chapterNumberPrefix(params.chapter)}.final-quality-report.json`)),
      relative(params.root, join(params.bookDir, "reviews", "fanqie-quality", `${chapterNumberPrefix(params.chapter)}.final-quality-report.md`)),
      relative(params.root, join(params.bookDir, "reviews", "publish-ready", `${chapterNumberPrefix(params.chapter)}.publish-report.json`)),
    ]),
    editFiles: existingFiles(params.root, [
      finalCandidateFile ? relative(params.root, finalCandidateFile) : "",
      relative(params.root, findOriginalChapterFileSync(params.bookDir, params.chapter) ?? ""),
      relative(params.root, join(params.bookDir, "chapters-polished", `${chapterNumberPrefix(params.chapter)}_polished_attempt1.md`)),
    ]),
    search: qualityLocateHints(qualityReport),
    change: [
      "只改表达、节奏、段落和章尾钩子；不要改主线事实和资源数值。",
      "如果分数接近通过，优先 quality-auto-fix；如果连续多次不升，人工改 final 后重跑 publish-ready。",
    ],
    nextCommands: publishReport?.publish_status === "NEED_REWRITE"
      ? [
          `node packages/cli/dist/index.js review reject ${params.bookId} ${params.chapter}`,
          `node packages/cli/dist/index.js write next ${params.bookId}`,
        ]
      : [
          `node packages/cli/dist/index.js review fanqie-polish --book ${params.bookId} --chapter ${params.chapter} --max-polish-attempts 2`,
          `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
        ],
  };
}

function makePlotRepairPlanIfNeeded(
  params: { readonly root: string; readonly bookId: string; readonly bookDir: string; readonly chapter: number },
  publishReport: Partial<PublishReadyResult> | null,
  exportReportText: string,
  finalCandidateFile: string | null,
  plotFixReport: Partial<PlotAutoFixResult> | null,
  plotFixNewerThanPublishReady: boolean,
): DiagnoseRepairPlan | null {
  const weakExportScore = findExportSixPartScore(exportReportText, params.chapter);
  const sixStepStatus = publishReport?.six_step_plot?.status;
  const hasStructureBlocker = hasPublishReadyStructureBlocker(publishReport);
  if ((weakExportScore === null || weakExportScore >= 4) && !hasStructureBlocker) return null;
  const isExportLocalWeak = weakExportScore !== null && weakExportScore < 4;
  const isPublishReadyStructural = !isExportLocalWeak && hasStructureBlocker;
  const structuralReasons = publishReadyStructureBlockerSummaries(publishReport);
  const hasFreshPlotFix = isPublishReadyStructural && plotFixReport?.status === "FIXED" && plotFixNewerThanPublishReady;
  const hasFailedAfterPlotFix = isPublishReadyStructural && plotFixReport?.status === "FIXED" && !plotFixNewerThanPublishReady;

  return {
    id: "plot-six-part",
    severity: "warning",
    kind: "plot",
    title: hasFreshPlotFix
      ? "plot-auto-fix 已执行；当前 publish-ready 报告是旧结论，下一步重跑 publish-ready 验收。"
      : hasFailedAfterPlotFix
        ? "上次 plot-auto-fix 后复检仍未通过；可再自动修一次，或按新报告人工补强结构缺口。"
      : isPublishReadyStructural
      ? "publish-ready 结构审核未通过；可让 publish-ready 自动跑一次 plot-auto-fix 后复检。"
      : "export-fanqie 6段检查偏弱；可用 repair-fanqie 修 Hook / Pressure / Attempt / Twist / Payoff / Pull。",
    evidence: [
      weakExportScore !== null ? `export-fanqie 6段检查=${weakExportScore}/6` : "",
      ...structuralReasons,
      sixStepStatus ? `six_step_plot=${sixStepStatus} score=${publishReport?.six_step_plot?.score ?? "n/a"}` : "",
      plotFixReport?.status === "FIXED" ? `plot_auto_fix=${plotFixReport.status} output=${plotFixReport.output_file ?? "n/a"}` : "",
      publishReport?.six_step_plot?.summary ?? "",
    ].filter(Boolean),
    inspectFiles: existingFiles(params.root, [
      relative(params.root, join(params.root, "publish", params.bookId, "fanqie", "report.md")),
      relative(params.root, join(params.bookDir, "reviews", "plot-auto-fix", `${chapterNumberPrefix(params.chapter)}.plot-fix-report.json`)),
      relative(params.root, join(params.bookDir, "reviews", "six-step-plot", `${chapterNumberPrefix(params.chapter)}.six-step-plot.report.json`)),
      relative(params.root, join(params.bookDir, "reviews", "publish-ready", `${chapterNumberPrefix(params.chapter)}.publish-report.json`)),
    ]),
    editFiles: existingFiles(params.root, [
      finalCandidateFile ? relative(params.root, finalCandidateFile) : "",
      relative(params.root, join(params.root, "publish", params.bookId, "fanqie", "chapters", `${chapterNumberPrefix(params.chapter)}.txt`)),
    ]),
    search: ["开头", "倒计时|压力|濒死|危险", "却|反而|不对|没想到", "那一刻|门，被|发现", "下一|还有|真正|门后"],
    change: hasFreshPlotFix
      ? [
          "不要重复跑 plot-auto-fix；先重跑 publish-ready 生成新的 six_step_plot 和 publish-ready 报告。",
          "如果复检仍然 FAIL_STRUCTURAL，再看新报告决定是否第二次 plot-auto-fix 或人工修 final。",
        ]
      : hasFailedAfterPlotFix
        ? [
            "上一次 plot-auto-fix 已经被 publish-ready 复检过，但新的结构审核仍是 MANUAL_REVIEW。",
            "优先补强报告中的结构缺口：主角目标、开头冲突、阻碍升级、章末钩子。",
            "可以再跑一次带 --max-plot-fix-attempts 1 的 publish-ready；如果仍失败，就人工改 final 候选开头后再验收。",
          ]
      : [
          isPublishReadyStructural
            ? "这是 publish-ready 的结构审核，不是 export-fanqie 本地 6段检查；可用 --max-plot-fix-attempts 让 publish-ready 调 LLM 定点修。"
            : "这是 export-fanqie 本地 6段检查低于 4/6，repair-fanqie 可以读取导出报告并定点修。",
          "优先修改 final 候选里的开头情绪事件、主角目标、主动尝试、阶段反馈和章尾拉力。",
          "不要整章重写，优先做 3-6 处定点补强。",
        ],
    nextCommands: hasFreshPlotFix
      ? [
          `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
          `node packages/cli/dist/index.js review diagnose --book ${params.bookId} --chapter ${params.chapter}`,
        ]
      : hasFailedAfterPlotFix
        ? [
            `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter} --max-plot-fix-attempts 1`,
            `node packages/cli/dist/index.js review diagnose --book ${params.bookId} --chapter ${params.chapter}`,
          ]
      : isExportLocalWeak
      ? [
          `node scripts/fanqie/repair-fanqie.mjs ${params.bookId} --chapter ${params.chapter} --apply`,
          `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter}`,
        ]
      : [
          `node packages/cli/dist/index.js review publish-ready --book ${params.bookId} --chapter ${params.chapter} --max-plot-fix-attempts 1`,
          `node packages/cli/dist/index.js review diagnose --book ${params.bookId} --chapter ${params.chapter}`,
        ],
  };
}

function makeExportRepairPlanIfNeeded(
  params: { readonly root: string; readonly bookId: string; readonly bookDir: string; readonly chapter: number },
  exportReportText: string,
  finalCandidateFile: string | null,
): DiagnoseRepairPlan | null {
  if (!/EXPORT_FAILED|非正文标记|残留：\d+ ❌|Missing exported chapter file/u.test(exportReportText)) return null;
  return {
    id: "export-format",
    severity: "blocker",
    kind: "export",
    title: "番茄导出格式检查失败；先清理非正文标记或缺失导出文件。",
    evidence: exportReportText.split(/\r?\n/).filter((line) => /EXPORT_FAILED|非正文标记|残留|Missing exported/u.test(line)).slice(0, 8),
    inspectFiles: existingFiles(params.root, [
      relative(params.root, join(params.root, "publish", params.bookId, "fanqie", "report.md")),
      relative(params.root, join(params.root, "publish", params.bookId, "fanqie", "chapters", `${chapterNumberPrefix(params.chapter)}.txt`)),
    ]),
    editFiles: existingFiles(params.root, [
      finalCandidateFile ? relative(params.root, finalCandidateFile) : "",
    ]),
    search: ["```|---|CHAPTER_CONTENT|PRE_WRITE_CHECK|创作说明|审核|检查|修复建议|六段检查"],
    change: [
      "删除正文里的过程标记、报告段落、Markdown 表格/标题和非正文批注。",
      "final 候选文件必须只保留小说正文。",
    ],
    nextCommands: [
      `node scripts/fanqie/export-fanqie.mjs ${params.bookId} --from ${params.chapter} --to ${params.chapter} --use-reviewed --dry-run`,
    ],
  };
}

function existingFiles(root: string, files: ReadonlyArray<string>): string[] {
  return files
    .filter(Boolean)
    .filter((file) => existsSync(isAbsolute(file) ? file : join(root, file)))
    .map((file) => isAbsolute(file) ? relative(root, file) : file);
}

async function readTextIfExists(file: string): Promise<string> {
  try {
    return await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function readChapterIndexEntry(bookDir: string, chapter: number): Promise<Record<string, unknown> | null> {
  const index = await readJsonIfExists<Record<string, unknown>[]>(join(bookDir, "chapters", "index.json"));
  return index?.find((entry) => entry.number === chapter) ?? null;
}

function extractAuditIssues(chapterEntry: Record<string, unknown> | null): string[] {
  return Array.isArray(chapterEntry?.auditIssues)
    ? chapterEntry.auditIssues.filter((issue): issue is string => typeof issue === "string")
    : [];
}

function readStringArrayField(source: unknown, field: string): string[] {
  if (!source || typeof source !== "object") return [];
  const value = (source as Record<string, unknown>)[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isCurrentResourceBlocked(
  chapterStatus: string | null,
  resourceReport: Partial<{ blocking: boolean; closureStatus: string; status: string }> | null,
  auditIssues: ReadonlyArray<string>,
  publishStatus?: string,
): boolean {
  if (chapterStatus === "ready-for-review" || chapterStatus === "approved") {
    return false;
  }
  if (chapterStatus === "blocked-resource-plan" || publishStatus === "BLOCKED_BY_RESOURCE") return true;
  const auditBlocked = hasResourceBlockingAuditIssue(auditIssues);
  if (auditBlocked) return true;
  if (resourceReport) {
    return resourceReport.blocking === true
      || resourceReport.closureStatus === "resource_failed"
      || resourceReport.status === "BLOCKED_BY_RESOURCE_PLAN"
      || resourceReport.status === "BLOCKED";
  }
  return false;
}

function hasResourceBlockingAuditIssue(auditIssues: ReadonlyArray<string>): boolean {
  return auditIssues.some((issue) => /RESOURCE_PLAN_NOT_CLOSED|RESOURCE_CONSISTENCY_NOT_CLOSED|resource-plan/u.test(issue));
}

function resolveDiagnoseFinalCandidate(bookDir: string, reportedFile: string | undefined, chapter: number): string | null {
  const candidates = [
    finalCandidatePath(bookDir, chapter),
    reportedFile ? resolveUsedFilePath(bookDir, reportedFile) : null,
  ].filter((file): file is string => Boolean(file));
  return candidates.find((file) => existsSync(file)) ?? null;
}

function finalCandidatePath(bookDir: string, chapter: number): string {
  return join(bookDir, "chapters-reviewed", `${chapterNumberPrefix(chapter)}_final.md`);
}

function findOriginalChapterFileSync(bookDir: string, chapter: number): string | null {
  const chaptersDir = join(bookDir, "chapters");
  if (!existsSync(chaptersDir)) return null;
  const stack = [chaptersDir];
  const matches: string[] = [];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (getChapterNumberFromFile(file) === chapter) matches.push(file);
    }
  }
  return matches.sort((a, b) => basename(a).localeCompare(basename(b)))[0] ?? null;
}

function buildSearchHints(issues: ReadonlyArray<string>, fallbacks: ReadonlyArray<string>): string[] {
  const quoted = issues.flatMap((issue) => [...issue.matchAll(/[""']([^"""'\n]{2,24})[""']/gu)].map((match) => match[1] ?? ""));
  const chineseTerms = issues.flatMap((issue) => [...issue.matchAll(/[\p{Script=Han}A-Za-z0-9_-]{2,16}/gu)].map((match) => match[0] ?? ""))
    .filter((term) => !/warning|critical|info|state|resource|consistency|validation|chapter/u.test(term))
    .slice(0, 8);
  return [...new Set([...quoted, ...chineseTerms, ...fallbacks].filter(Boolean))].slice(0, 8);
}

function qualityLocateHints(qualityReport: Partial<FanqieQualityReport> | null): string[] {
  const issueText = (qualityReport?.issues ?? [])
    .map((issue) => typeof issue === "string" ? issue : `${issue.type ?? ""} ${issue.detail ?? ""}`)
    .join("\n");
  const hints: string[] = [];
  if (/积分|资源|收益|爽点/u.test(issueText)) hints.push("积分|奖励|收益|口粮|兑换");
  if (/倒计时|系统|提示|弹出/u.test(issueText)) hints.push("倒计时|系统|提示");
  if (/钩子|结尾|悬念/u.test(issueText)) hints.push("结尾|下一|还有|真正");
  if (/段落|密度|节奏/u.test(issueText)) hints.push("。$|！$|？$");
  if (/忽然|猛地|突然/u.test(issueText)) hints.push("忽然|猛地|突然");
  return hints.length ? hints : ["积分|系统|结尾|忽然|猛地|突然"];
}

function findExportSixPartScore(reportText: string, chapter: number): number | null {
  const match = reportText.match(new RegExp(`第\\s*${chapter}\\s*章：6段检查\\s+(\\d+)\\/6`, "u"));
  return match ? Number(match[1]) : null;
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
  .command("diagnose")
  .description("Explain what to fix next for a chapter across write/review/export reports")
  .requiredOption("--book <book-id>", "Book ID")
  .requiredOption("--chapter <number>", "Chapter number")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(opts.book, root);
      const state = new StateManager(root);
      const bookDir = state.bookDir(bookId);
      const chapter = Number.parseInt(opts.chapter, 10);
      if (!Number.isInteger(chapter) || chapter < 1) {
        throw new Error("--chapter must be a positive integer");
      }

      const result = await diagnoseChapterRepair({ root, bookId, bookDir, chapter });
      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of renderDiagnoseChapterRepair(result)) log(line);
      }
    } catch (e) {
      if (opts.json) log(JSON.stringify({ error: String(e) }));
      else logError(`Failed to diagnose: ${e}`);
      process.exit(1);
    }
  });

reviewCommand
  .command("approve")
  .description("Approve a chapter and commit its state: approve [book-id] <chapter>")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--json", "Output JSON")
  .option("--skip-sync", "Skip syncing state and snapshot via LLM re-analysis")
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

      const chapter = index[idx]!;
      const blockedStatuses = ["audit-failed", "state-degraded", "blocked-resource-plan", "planning-degraded"];
      if (blockedStatuses.includes(chapter.status)) {
        throw new Error(`Chapter ${chapterNum} has status "${chapter.status}". Approval is blocked due to validation errors or degradation.`);
      }

      index[idx] = {
        ...index[idx]!,
        status: "approved",
        updatedAt: new Date().toISOString(),
      };
      await state.saveChapterIndex(bookId, index);

      // Re-analyze and sync chapter state upon approval to guarantee
      // that the final text is settled and snapshotted correctly.
      if (!opts.skipSync) {
        if (!opts.json) {
          log(`Syncing state and snapshot for approved chapter ${chapterNum}...`);
        }
        const config = await loadConfig({ requireApiKey: false });
        const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
        await pipeline.resyncChapterArtifacts(bookId, chapterNum);
      }

      if (opts.json) {
        log(JSON.stringify({ bookId, chapter: chapterNum, status: "approved" }));
      } else {
        log(`Chapter ${chapterNum} approved (state committed and synced).`);
        log("");
        log("next:");
        log(`node scripts/fanqie/export-fanqie.mjs ${bookId} --from ${chapterNum} --to ${chapterNum} --use-reviewed --dry-run`);
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
      const blockedStatuses = ["audit-failed", "state-degraded", "blocked-resource-plan", "planning-degraded"];

      const updated = index.map((ch) => {
        if (ch.status === "ready-for-review") {
          count++;
          return { ...ch, status: "approved" as const, updatedAt: now };
        }
        if (blockedStatuses.includes(ch.status)) {
          if (!opts.json) {
            log(`Warning: Skipped chapter ${ch.number} from approve-all due to blocked status "${ch.status}".`);
          }
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

async function cleanupChapterFiles(bookDir: string, chapterNum: number): Promise<void> {
  const prefix = chapterNumberPrefix(chapterNum);

  // 1. Delete intent file: story/runtime/chapter-intents/XXXX.md
  const intentPath = join(bookDir, "story", "runtime", "chapter-intents", `${prefix}.md`);
  await unlink(intentPath).catch(() => {});

  // 2. Delete files starting with prefix in chapter stages directories
  const stageDirs = [
    "chapters",
    "chapters-reviewed",
    "chapters-polished",
    "chapters-plot-fixed",
    "chapters-quality-fixed",
    "chapters-fixed",
    "chapters-salvaged",
  ];
  for (const dirName of stageDirs) {
    const dirPath = join(bookDir, dirName);
    if (!existsSync(dirPath)) continue;
    try {
      const files = await readdir(dirPath);
      for (const file of files) {
        if (file.startsWith(prefix)) {
          await unlink(join(dirPath, file)).catch(() => {});
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // 3. Delete files starting with prefix in reviews subdirectories
  const reviewsDir = join(bookDir, "reviews");
  if (existsSync(reviewsDir)) {
    try {
      const subdirs = await readdir(reviewsDir);
      for (const subdir of subdirs) {
        const subPath = join(reviewsDir, subdir);
        const st = await stat(subPath).catch(() => null);
        if (st && st.isDirectory()) {
          const files = await readdir(subPath);
          for (const file of files) {
            if (file.startsWith(prefix)) {
              await unlink(join(subPath, file)).catch(() => {});
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // 4. Delete golden-3-chapter reports if chapter 1, 2 or 3 is rejected
  if (chapterNum >= 1 && chapterNum <= 3) {
    const goldenDir = join(bookDir, "reviews", "golden-3-chapter");
    await unlink(join(goldenDir, "golden-3-chapter.report.json")).catch(() => {});
    await unlink(join(goldenDir, "golden-3-chapter.report.md")).catch(() => {});
  }
}

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

      // Clean up physical files for all discarded chapters
      const bookDir = state.bookDir(bookId);
      for (const chNum of discarded) {
        await cleanupChapterFiles(bookDir, chNum);
      }

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

reviewCommand
  .command("rebuild-state")
  .description("Rebuild the entire story state and snapshots from the approved chapters: rebuild-state [book-id]")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const config = await loadConfig({ requireApiKey: false });
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) {
        log(`Rebuilding state for book "${bookId}"...`);
      }

      await pipeline.rebuildStoryState(bookId);

      if (opts.json) {
        log(JSON.stringify({ bookId, status: "success" }));
      } else {
        log(`Successfully rebuilt all state files and snapshots for book "${bookId}".`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to rebuild state: ${e}`);
      }
      process.exit(1);
    }
  });

// ---- structure-signals maintenance commands ----

const structureSignalsCmd = reviewCommand
  .command("structure-signals")
  .description("Manage book-level structure signals (no LLM, no genre profile)");

structureSignalsCmd
  .command("inspect")
  .description("Display structure signal dimensions, counts, and diagnostics")
  .requiredOption("--book <book>", "Book ID")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const book = await resolveContinuityBook(root, opts.book);
      const signalsResult = await readStructureSignals(book.dir);

      if (signalsResult.status !== "ok") {
        const msg = `structure_signals.json ${signalsResult.status === "missing" ? "缺失" : "损坏"}: ${signalsResult.error}`;
        if (opts.json) {
          log(JSON.stringify({ error: msg, status: signalsResult.status }));
        } else {
          logError(msg);
          log("请重新创建书籍骨架或手动补齐 story/structure_signals.json");
        }
        process.exit(1);
      }

      const info = inspectStructureSignals(signalsResult.signals);

      if (opts.json) {
        log(JSON.stringify(info, null, 2));
        return;
      }

      log(`book: ${info.bookId}`);
      log(`updated: ${info.updatedAt}`);
      log(`dimensions: ${info.dimensions.length}`);
      log(`total phrases: ${info.totalPhrases} (unique: ${info.totalUnique})`);
      log("");

      for (const d of info.dimensions) {
        const marker = d.phraseCount === 0 ? " [空]" : "";
        log(`  ${d.dimension}: ${d.phraseCount} phrases${marker}`);
        if (d.phrases.length > 0) {
          for (const p of d.phrases) {
            log(`    - ${p}`);
          }
        }
      }

      if (info.emptyDimensions.length > 0) {
        log(`\n空维度 (${info.emptyDimensions.length}):`);
        for (const dim of info.emptyDimensions) {
          log(`  - ${dim}`);
        }
      }

      if (info.duplicates.length > 0) {
        log(`\n跨维度重复 (${info.duplicates.length}):`);
        for (const dup of info.duplicates) {
          log(`  - "${dup.phrase}" 出现在: ${dup.dimensions.join(", ")}`);
        }
      }

      if (info.suspiciousPhrases.length > 0) {
        log(`\n疑似过泛化短语 (${info.suspiciousPhrases.length}):`);
        for (const sus of info.suspiciousPhrases) {
          log(`  - [${sus.dimension}] "${sus.phrase}" — ${sus.reason}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`inspect 失败: ${e}`);
      }
      process.exit(1);
    }
  });

structureSignalsCmd
  .command("validate")
  .description("Validate structure_signals.json schema and content quality")
  .requiredOption("--book <book>", "Book ID")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const book = await resolveContinuityBook(root, opts.book);
      const signalsResult = await readStructureSignals(book.dir);

      if (signalsResult.status !== "ok") {
        const msg = `structure_signals.json ${signalsResult.status === "missing" ? "缺失" : "损坏"}: ${signalsResult.error}`;
        if (opts.json) {
          log(JSON.stringify({ error: msg, status: signalsResult.status }));
        } else {
          logError(msg);
          log("请重新创建书籍骨架或手动补齐 story/structure_signals.json");
        }
        process.exit(1);
      }

      const result = validateStructureSignalsFull(signalsResult.signals);
      const inspection = inspectStructureSignals(signalsResult.signals);

      if (opts.json) {
        log(JSON.stringify({ ...result, ...inspection }, null, 2));
        return;
      }

      log(`book: ${signalsResult.signals.bookId}`);
      log(`status: ${result.status}`);
      log(`totalPhrases: ${inspection.totalPhrases} (unique: ${inspection.totalUnique})`);
      if (inspection.emptyDimensions.length > 0) {
        log(`emptyDimensions: ${inspection.emptyDimensions.join(", ")}`);
      }
      for (const dim of inspection.dimensions) {
        log(`  ${dim.dimension}: ${dim.phraseCount} phrases`);
      }
      if (result.issues.length > 0) {
        log(`issues: ${result.issues.length}`);
        for (const issue of result.issues) {
          log(`  [${issue.severity}] ${issue.message}`);
        }
      }
      if (result.status === "FAIL") {
        log("");
        log("注意：结构信号校验失败，问题可能出在建书生成链路（create_book / architect）。");
        log("请检查题材 profile 指导是否已更新，或重新建书以重新生成 structure_signals.json。");
        log("不要手工编辑 structure_signals.json 来伪造通过。");
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`validate 失败: ${e}`);
      }
      process.exit(1);
    }
  });

structureSignalsCmd
  .command("append")
  .description("Append a phrase to a structure signal dimension")
  .requiredOption("--book <book>", "Book ID")
  .requiredOption("--dimension <dim>", "Target dimension (e.g. opening_hook)")
  .requiredOption("--phrase <phrase>", "Phrase to append")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const book = await resolveContinuityBook(root, opts.book);
      const signalsResult = await readStructureSignals(book.dir);

      if (signalsResult.status !== "ok") {
        const msg = `structure_signals.json ${signalsResult.status === "missing" ? "缺失" : "损坏"}: ${signalsResult.error}`;
        if (opts.json) {
          log(JSON.stringify({ error: msg, status: signalsResult.status }));
        } else {
          logError(msg);
          log("请重新创建书籍骨架或手动补齐 story/structure_signals.json");
        }
        process.exit(1);
      }

      const { updated, alreadyExists } = appendStructureSignal(
        signalsResult.signals,
        opts.dimension,
        opts.phrase,
      );

      if (alreadyExists) {
        if (opts.json) {
          log(JSON.stringify({ status: "already_exists", dimension: opts.dimension, phrase: opts.phrase }));
        } else {
          log(`already_exists: "${opts.phrase}" 已存在于维度 ${opts.dimension} 中，未重复写入`);
        }
        return;
      }

      await writeStructureSignals(book.dir, updated);

      if (opts.json) {
        log(JSON.stringify({ status: "appended", dimension: opts.dimension, phrase: opts.phrase }));
      } else {
        log(`已追加 "${opts.phrase}" → ${opts.dimension}`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`append 失败: ${e}`);
      }
      process.exit(1);
    }
  });
