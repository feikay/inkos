import { Command } from "commander";
import {
  StateManager,
  chapterNumberPrefix,
  chatCompletion,
  createLLMClient,
  formatLengthCount,
  isApiKeyOptionalForEndpoint,
  LLMConfigSchema,
  readGenreProfile,
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
} from "@actalk/inkos-core";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createClient, findProjectRoot, loadConfig, resolveBookId, log, logError, loadReviewPresentation, GLOBAL_ENV_PATH } from "../utils.js";

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
      const minChapterWords = parsePositiveInt(opts.minChapterWords, "--min-chapter-words");
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
  .option("--quality-fix-threshold <number>", "Minimum quality score for targeted fix", "75")
  .option("--quality-pass-threshold <number>", "Ideal quality score threshold", "85")
  .option("--quality-accept-threshold <number>", "Minimum accepted quality score threshold", "75")
  .option("--min-chapter-words <number>", "Minimum effective chapter word count", "1000")
  .option("--accept-manual-continuity", "Allow explicit publish-ready processing for MANUAL_REVIEW continuity")
  .option("--continuity-override-pass", "Trust a PASS final continuity report and skip repeated continuity recheck")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const runtime = await loadContinuityRuntime(true);
      const book = await resolveContinuityBook(root, opts.book);
      const range = resolveContinuityRange(opts);
      const maxFixAttempts = parseNonNegativeInt(opts.maxFixAttempts, "--max-fix-attempts");
      const maxPolishAttempts = parsePositiveInt(opts.maxPolishAttempts, "--max-polish-attempts");
      const maxQualityFixAttempts = parseNonNegativeInt(opts.maxQualityFixAttempts, "--max-quality-fix-attempts");
      const qualityFixThreshold = parsePositiveInt(opts.qualityFixThreshold, "--quality-fix-threshold");
      const qualityPassThreshold = parsePositiveInt(opts.qualityPassThreshold, "--quality-pass-threshold");
      const qualityAcceptThreshold = parsePositiveInt(opts.qualityAcceptThreshold, "--quality-accept-threshold");
      const minChapterWords = parsePositiveInt(opts.minChapterWords, "--min-chapter-words");
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
          client: runtime.client!,
          model: runtime.model!,
          maxFixAttempts,
          maxPolishAttempts,
          maxQualityFixAttempts,
          qualityFixThreshold,
          qualityPassThreshold,
          qualityAcceptThreshold,
          minChapterWords,
          acceptManualContinuity: Boolean(opts.acceptManualContinuity),
          continuityOverridePass: Boolean(opts.continuityOverridePass),
          json: Boolean(opts.json),
        });
        results.push(result);

        if (!opts.json) {
          log("");
          log("result:");
          log(result.publish_status);
          if (result.final_candidate_file) log(`final file: ${result.final_candidate_file}`);
          log(`report: ${result.report_json_path}`);
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

type PublishReadyStatus = "READY_TO_EXPORT" | "READY_WITH_WARNINGS" | "BLOCKED_BY_CONTINUITY" | "BLOCKED_BY_QUALITY" | "QUALITY_MANUAL_REVIEW" | "NEED_REWRITE" | "MANUAL_REVIEW";
export type PublishQualityDecision = "QUALITY_PASS" | "QUALITY_WARN_POLISH_OPTIONAL" | "QUALITY_MANUAL_REVIEW" | "NEED_REWRITE";

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
  readonly report_json_path: string;
  readonly report_markdown_path: string;
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

async function runPublishReadyChapter(params: {
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly maxFixAttempts: number;
  readonly maxPolishAttempts: number;
  readonly maxQualityFixAttempts: number;
  readonly qualityFixThreshold: number;
  readonly qualityPassThreshold: number;
  readonly qualityAcceptThreshold: number;
  readonly minChapterWords: number;
  readonly acceptManualContinuity: boolean;
  readonly continuityOverridePass: boolean;
  readonly json: boolean;
}): Promise<PublishReadyResult> {
  const sourceChain = new Set<string>();
  const original = await findChapterFile(params.bookDir, params.chapter);
  sourceChain.add(relative(params.bookDir, original.file));
  const reviewedFinal = await findReviewedFinalChapterFile(params.bookDir, params.chapter);
  const reviewedFinalExists = Boolean(reviewedFinal);

  let candidateOverride: string | undefined = await resolvePublishReadyStartingCandidate(
    params.bookDir,
    params.chapter,
    original.file,
    params.acceptManualContinuity,
  );
  if (candidateOverride === original.file) candidateOverride = undefined;
  if (params.continuityOverridePass) {
    const overrideResult = await runPublishReadyWithContinuityOverride(params, sourceChain);
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
  const existingReady = await tryWriteAcceptedExistingCandidate(params, candidateOverride ?? original.file, sourceChain);
  if (existingReady) return existingReady;
  let continuity: ContinuityCommandResult | undefined;
  let continuityReport: ContinuityReport | undefined;
  let quality: FanqieQualityCommandResult | undefined;
  let qualityStatus: "QUALITY_PASS" | "QUALITY_WARN_POLISH_OPTIONAL" | "QUALITY_MANUAL_REVIEW" | undefined;
  let manualContinuityAcceptance: PublishReadyManualContinuityAcceptance | undefined;

  for (let loop = 1; loop <= 2; loop += 1) {
    if (!params.json) {
      log("");
      log(loop === 1 ? "step 1 continuity:" : `loop ${loop} continuity:`);
    }
    const continuityResult = await runContinuityPublishPass(params, candidateOverride, sourceChain);
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

    let qualityCandidate = quality.sourceFile;
    const immediateQualityDecision = decidePublishQuality(quality.report.quality_score, params.qualityPassThreshold, params.qualityAcceptThreshold);
    qualityStatus = qualityFinalStatusFromDecision(immediateQualityDecision);
    if (immediateQualityDecision === "QUALITY_PASS" || immediateQualityDecision === "QUALITY_WARN_POLISH_OPTIONAL") {
      const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, continuity.sourceFile);
      sourceChain.add(relative(params.bookDir, finalFile));
      const readyToExport = isReadyToExport(continuityReport, immediateQualityDecision, finalFile, params.minChapterWords, Boolean(manualContinuityAcceptance));
      return writePublishReadyReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: readyToExport ? publishStatusForQualityDecision(immediateQualityDecision) : "MANUAL_REVIEW",
        final_candidate_file: relative(params.bookDir, finalFile),
        source_chain: [...sourceChain],
        continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
        quality: { final_quality_status: qualityStatus, score: quality.report.quality_score },
        quality_decision: immediateQualityDecision,
        quality_score: quality.report.quality_score,
        quality_pass_threshold: params.qualityPassThreshold,
        quality_accept_threshold: params.qualityAcceptThreshold,
        accepted_reason: immediateQualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
        warnings: qualityWarnings(immediateQualityDecision, quality.report.quality_score, params.qualityPassThreshold),
        ...manualContinuityAcceptance,
        source_file: relative(params.bookDir, continuity.sourceFile),
        word_count: continuityReport.word_count,
        min_chapter_words: params.minChapterWords,
        report_json_path: "",
        report_markdown_path: "",
      });
    }
    if (quality.report.quality_score < params.qualityPassThreshold) {
      if (!params.json) {
        log("");
        log(loop === 1 ? "step 3 polish:" : `loop ${loop} polish:`);
      }
      const polished = await polishFanqieQualityChapter({
        bookId: params.bookId,
        bookDir: params.bookDir,
        chapter: params.chapter,
        client: params.client,
        model: params.model,
        maxPolishAttempts: params.maxPolishAttempts,
        json: params.json,
      });
      qualityStatus = polished.finalQualityStatus;
      if (polished.usedPolishedFile) {
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
      if (polished.finalQualityStatus !== "QUALITY_PASS") {
        const blocked = await writePublishReadyReport(params.bookDir, {
          book: params.bookId,
          chapter_index: params.chapter,
          publish_status: "BLOCKED_BY_QUALITY",
          final_candidate_file: "",
          source_chain: [...sourceChain],
          continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
          quality: { final_quality_status: polished.finalQualityStatus, score: polished.finalScore },
          ...manualContinuityAcceptance,
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
        if (params.maxQualityFixAttempts > 0 && isQualityAutoFixEligibleFromReports(blocked, finalQualityReport, params.qualityFixThreshold)) {
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
            maxFixAttempts: params.maxFixAttempts,
            json: params.json,
          });
          if (!params.json) {
            if (fixed.input_file) log(`input: ${fixed.input_file}`);
            if (fixed.output_file) log(`output: ${fixed.output_file}`);
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
    }
    const recheck = await runContinuityPublishPass(params, qualityCandidate, sourceChain);
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
      const qualityScore = quality.report.quality_score;
      const qualityDecision = decidePublishQuality(qualityScore, params.qualityPassThreshold, params.qualityAcceptThreshold);
      qualityStatus = qualityFinalStatusFromDecision(qualityDecision);
      const readyToExport = isReadyToExport(continuityReport, qualityDecision, finalFile, params.minChapterWords, Boolean(manualContinuityAcceptance));
      return writePublishReadyReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: readyToExport
          ? publishStatusForQualityDecision(qualityDecision)
          : qualityDecision === "NEED_REWRITE" ? "NEED_REWRITE" : "MANUAL_REVIEW",
        final_candidate_file: relative(params.bookDir, finalFile),
        source_chain: [...sourceChain],
        continuity: { final_status: continuityReport.final_status, score: continuityReport.score },
        quality: { final_quality_status: qualityStatus, score: qualityScore },
        quality_decision: qualityDecision,
        quality_score: qualityScore,
        quality_pass_threshold: params.qualityPassThreshold,
        quality_accept_threshold: params.qualityAcceptThreshold,
        accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
        warnings: qualityWarnings(qualityDecision, qualityScore, params.qualityPassThreshold),
        ...manualContinuityAcceptance,
        source_file: relative(params.bookDir, continuity.sourceFile),
        word_count: continuityReport.word_count,
        min_chapter_words: params.minChapterWords,
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
  return writePublishReadyReport(params.bookDir, {
    ...common,
    publish_status: readyToExport ? publishStatusForQualityDecision(qualityDecision) : "MANUAL_REVIEW",
    final_candidate_file: relative(params.bookDir, finalFile),
    source_chain: [...sourceChain],
    accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
    warnings: qualityWarnings(qualityDecision, qualityScore, params.qualityPassThreshold),
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

async function writeReviewedFinalChapter(bookDir: string, chapter: number, sourceFile: string): Promise<string> {
  const outDir = join(bookDir, "chapters-reviewed");
  const outFile = join(outDir, `${chapterNumberPrefix(chapter)}_final.md`);
  if (resolve(sourceFile) === resolve(outFile)) return outFile;
  await mkdir(outDir, { recursive: true });
  await copyFile(sourceFile, outFile);
  return outFile;
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

  const qualityFixed = await findLatestQualityFixedFile(bookDir, chapter);
  if (qualityFixed) return qualityFixed;

  const polished = await findLatestPolishedFile(bookDir, chapter);
  if (polished) return polished;

  const finalReport = await readContinuityReportIfExists(bookDir, chapter, "final-report");
  if (typeof finalReport?.used_file === "string") {
    const usedFile = resolveUsedFilePath(bookDir, finalReport.used_file);
    if (usedFile) return usedFile;
  }

  return originalFile;
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

  sourceChain.add(relative(params.bookDir, candidateFile));
  const finalFile = await writeReviewedFinalChapter(params.bookDir, params.chapter, candidateFile);
  sourceChain.add(relative(params.bookDir, finalFile));
  return writePublishReadyReport(params.bookDir, {
    book: params.bookId,
    chapter_index: params.chapter,
    publish_status: publishStatusForQualityDecision(qualityDecision),
    final_candidate_file: relative(params.bookDir, finalFile),
    source_chain: [...sourceChain],
    continuity: { final_status: "PASS", score: publishReport?.continuity?.score ?? continuityReport?.score },
    quality: { final_quality_status: qualityReport?.final_quality_status ?? publishReport?.quality?.final_quality_status ?? qualityFinalStatusFromDecision(qualityDecision), score: qualityScore },
    quality_decision: qualityDecision,
    quality_score: qualityScore,
    quality_pass_threshold: params.qualityPassThreshold,
    quality_accept_threshold: params.qualityAcceptThreshold,
    accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
    warnings: qualityWarnings(qualityDecision, qualityScore, params.qualityPassThreshold),
    source_file: relative(params.bookDir, candidateFile),
    word_count: wordCount,
    min_chapter_words: params.minChapterWords,
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
  const finalReport = {
    ...report,
    final_candidate_file: report.final_candidate_file
      ? `books/${report.book}/${report.final_candidate_file}`
      : "",
    source_file: report.source_file
      ? `books/${report.book}/${report.source_file}`
      : report.source_file,
    report_json_path: jsonPath,
    report_markdown_path: markdownPath,
  };
  await mkdir(reportDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderPublishReadyMarkdown(finalReport), "utf-8");
  return finalReport;
}

function renderPublishReadyMarkdown(report: PublishReadyResult): string {
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
  readonly maxFixAttempts: number;
  readonly json: boolean;
}): Promise<QualityAutoFixResult> {
  const context = await resolveQualityAutoFixContext(params.bookDir, params.chapter, params.minChapterWords, params.qualityFixThreshold);
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

  for (let attempt = 1; attempt <= params.maxQualityFixAttempts; attempt += 1) {
    if (!params.json) log(`attempt ${attempt}/${params.maxQualityFixAttempts} -> fixing...`);
    outputFile = await writeQualityFixedChapter({
      bookDir: params.bookDir,
      chapter: params.chapter,
      attempt,
      client: params.client,
      model: params.model,
      currentText: await readFile(context.inputFile, "utf-8"),
      qualityReport: context.qualityReport!,
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
      const publish = await writePublishReadyReport(params.bookDir, {
        book: params.bookId,
        chapter_index: params.chapter,
        publish_status: readyToExport
          ? publishStatusForQualityDecision(qualityDecision)
          : "MANUAL_REVIEW",
        final_candidate_file: relative(params.bookDir, finalFile),
        source_chain: [...sourceChain],
        continuity: { final_status: continuityAfter.report.final_status, score: continuityAfter.report.score },
        quality: { final_quality_status: finalQualityStatus, score: qualityAfter.report.quality_score },
        quality_decision: qualityDecision,
        quality_score: qualityAfter.report.quality_score,
        quality_pass_threshold: params.qualityPassThreshold,
        quality_accept_threshold: params.qualityAcceptThreshold,
        accepted_reason: qualityDecision === "QUALITY_WARN_POLISH_OPTIONAL" ? "quality score is publishable with optional polish" : undefined,
        warnings: qualityWarnings(qualityDecision, qualityAfter.report.quality_score, params.qualityPassThreshold),
        source_file: relative(params.bookDir, continuityAfter.final.sourceFile),
        word_count: continuityAfter.report.word_count,
        min_chapter_words: params.minChapterWords,
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

async function resolveQualityAutoFixContext(bookDir: string, chapter: number, minChapterWords: number, qualityFixThreshold: number): Promise<{
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

  if (continuityStatus !== "PASS") {
    return { eligible: false, reason: "continuity final_status is not PASS", publishStatus: "BLOCKED_BY_CONTINUITY", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (!Number.isFinite(wordCount) || wordCount < minWords) {
    return { eligible: false, reason: `word_count ${wordCount} < ${minWords}`, publishStatus: "BLOCKED_BY_CONTINUITY", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (qualityScore < qualityFixThreshold) {
    return { eligible: false, reason: `quality_score ${qualityScore} < ${qualityFixThreshold}`, publishStatus: "NEED_REWRITE", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (qualityScore >= 80) {
    return { eligible: false, reason: `quality_score ${qualityScore} already passes`, publishStatus: qualityScore >= 85 ? "READY_TO_EXPORT" : "READY_WITH_WARNINGS", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (publishStatus && publishStatus !== "BLOCKED_BY_QUALITY" && publishStatus !== "QUALITY_MANUAL_REVIEW") {
    return { eligible: false, reason: `publish_status is ${publishStatus}`, publishStatus: publishStatus as PublishReadyStatus, inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (qualityStatus && !["QUALITY_MANUAL_REVIEW", "QUALITY_WARN_POLISH_OPTIONAL", "QUALITY_NEED_POLISH", "QUALITY_FAIL"].includes(String(qualityStatus))) {
    return { eligible: false, reason: `quality status is ${qualityStatus}`, publishStatus: "MANUAL_REVIEW", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
  if (!inputFile || !existsSync(inputFile)) {
    return { eligible: false, reason: "quality source_file / used_polished_file not found", publishStatus: "MANUAL_REVIEW", inputFile, qualityScore, publishReport, qualityReport, sourceChain };
  }
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
): boolean {
  const score = Number(qualityReport?.final_quality_score ?? qualityReport?.quality_score ?? publishReport.quality?.score ?? 0);
  return publishReport.publish_status === "BLOCKED_BY_QUALITY" && score >= qualityFixThreshold && score < 85;
}

async function writeQualityFixedChapter(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly attempt: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly currentText: string;
  readonly qualityReport: Partial<FanqieQualityReport>;
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
    { role: "user", content: buildQualityAutoFixPrompt(params.currentText, params.qualityReport) },
  ], { temperature: 0.28, maxTokens: 8192, stage: "fanqie-quality" });
  const fixed = stripMarkdownCodeFence(response.content).trim();
  if (!fixed) throw new Error("quality-auto-fix returned empty chapter content");
  const outDir = join(params.bookDir, "chapters-quality-fixed");
  const outputPath = join(outDir, `${chapterNumberPrefix(params.chapter)}_quality_fix_attempt${params.attempt}.md`);
  await mkdir(outDir, { recursive: true });
  await writeFile(outputPath, `${fixed.trimEnd()}\n`, "utf-8");
  return outputPath;
}

function buildQualityAutoFixPrompt(currentText: string, report: Partial<FanqieQualityReport>): string {
  const issues = (report.issues ?? []).map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.detail}`).join("\n") || "- 无";
  const risks = (report.reader_drop_risks ?? []).map((item) => `- ${item}`).join("\n") || "- 无";
  const suggestions = (report.polish_suggestions ?? []).map((item) => `- ${item}`).join("\n") || "- 无";
  return `你正在对一章“连续性已通过，但番茄质量分不足”的网文章节做定向增强。

【当前章节】
${currentText}

【质量问题】
${issues}

【留存风险】
${risks}

【优化建议】
${suggestions}

【硬性要求】
1. 不改变剧情主线。
2. 不改变人物关系。
3. 不改变战力层级。
4. 不改变已有伏笔含义。
5. 不重写成新章节。
6. 保留原文 80% 以上。
7. 只针对报告中的问题做局部增强。
8. 输出完整章节正文。

【增强方向】
如果问题包含“爽点密度不足”：
- 增加主角获得收益、反击、压制、突破、信息揭露的细节。
- 每次增加 2~4 段，不要水字数。

如果问题包含“节奏推进不足”：
- 增加目标 → 阻碍 → 应对 → 变化的动作链。
- 补足冲突前的铺垫和冲突后的代价。

如果问题包含“结尾钩子偏弱”：
- 强化最后 3~6 段。
- 增加新危机、新信息、新反转或下一章期待。

如果问题包含“情绪拉扯不足”：
- 增加角色选择、代价、紧张感、压迫感。
- 不写空泛心理独白。

如果问题包含“发布风险”：
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
}): Promise<FanqiePolishCommandResult> {
  let quality = await readFanqieQualityReport(params.bookDir, params.chapter);
  if (quality && !await hasUsableQualitySourceFile(params.bookDir, quality.report)) {
    if (!params.json) {
      log("warning: quality-report source_file missing or not found; rerunning fanqie-quality.");
    }
    quality = null;
  }
  quality ??= await checkFanqieQualityChapter({
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter: params.chapter,
      client: params.client,
      model: params.model,
    });

  const initialScore = quality.report.quality_score;
  const inputFile = quality.sourceFile;
  let attempts = 0;
  let usedPolishedFile = "";
  let finalScore = initialScore;
  let finalStatus: FanqieFinalQualityStatus = initialScore >= 85 ? "QUALITY_PASS" : initialScore >= 80 ? "QUALITY_WARN_POLISH_OPTIONAL" : "QUALITY_MANUAL_REVIEW";

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
    };
  }

  if (initialScore >= 85 || !quality.report.polish_prompt.trim()) {
    const finalReport = markFinalFanqieQualityReport(quality.report, {
      polishAttempt: 0,
      maxPolishAttempts: params.maxPolishAttempts,
      finalQualityScore: initialScore,
      finalQualityStatus: initialScore >= 85 ? "QUALITY_PASS" : initialScore >= 80 ? "QUALITY_WARN_POLISH_OPTIONAL" : "QUALITY_MANUAL_REVIEW",
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
    };
  }

  while (finalScore < 85 && attempts < params.maxPolishAttempts) {
    const nextAttempt = attempts + 1;
    if (!quality.report.polish_prompt.trim()) break;
    if (!params.json) {
      log(`attempt ${nextAttempt}/${params.maxPolishAttempts} -> score: ${finalScore} -> polishing...`);
    }
    const polishedPath = await writeFanqiePolishedChapter({
      bookDir: params.bookDir,
      chapter: params.chapter,
      attempt: nextAttempt,
      client: params.client,
      model: params.model,
      polishPrompt: quality.report.polish_prompt,
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
    if (!params.json && finalScore >= 85) {
      log(`attempt ${nextAttempt}/${params.maxPolishAttempts} -> final score: ${finalScore}`);
    }
  }

  finalStatus = finalScore >= 85 ? "QUALITY_PASS" : finalScore >= 80 ? "QUALITY_WARN_POLISH_OPTIONAL" : "QUALITY_MANUAL_REVIEW";
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

async function writeFanqiePolishedChapter(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly attempt: number;
  readonly client: ReturnType<typeof createClient>;
  readonly model: string;
  readonly polishPrompt: string;
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
        "你是番茄网文章节优化编辑。",
        "只输出优化后的完整章节正文。",
        "不要输出说明、报告、JSON、Markdown 代码块。",
        numericExpressionGuidance,
      ].join("\n"),
    },
    { role: "user", content: params.polishPrompt },
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
  for (const root of roots) {
    const files = await listFiles(root).catch(() => []);
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
