import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWarningSummary,
  buildResolvedWarnings,
  findLatestJsonReport,
  generateManualFixPrompt,
  makeResumePlan,
  publishAdviceForWarningSummary,
  riskLevelForWarningSummary,
} from "./write-publish-export-utils.mjs";

test("latest report ignores trend json files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkos-wpe-latest-"));
  const real = path.join(dir, "2026-01-01T00-00-00-000Z.json");
  const trend = path.join(dir, "quality-trend.json");
  fs.writeFileSync(real, JSON.stringify({ book: "Book", request: {}, finalStatus: "READY_TO_PUBLISH", chapters: [] }), "utf8");
  fs.writeFileSync(trend, JSON.stringify({ book: "Book", chapterCount: 1, chapters: [{ finalStatus: "STOPPED_BY_NUMERIC" }] }), "utf8");
  const now = Date.now() / 1000;
  fs.utimesSync(real, now - 10, now - 10);
  fs.utimesSync(trend, now, now);
  assert.equal(findLatestJsonReport(dir), real);
});

test("resume plan starts at failed chapter and preserves remaining count", () => {
  const report = {
    request: { count: 3 },
    chapters: [
      { chapter: 95, finalStatus: "READY_TO_PUBLISH" },
      { chapter: 96, finalStatus: "STOPPED_BY_CONTINUITY" },
    ],
  };

  const plan = makeResumePlan({
    sourceReportPath: "my-novel/books/book/reviews/write-publish-export/report.json",
    sourceReport: report,
    bookDir: "/tmp/book",
  });

  assert.equal(plan.resumedFromChapter, "0096");
  assert.equal(plan.queue.length, 2);
  assert.equal(plan.queue[0].chapter, 96);
  assert.equal(plan.queue[0].resumeKind, "continuity");
  assert.equal(plan.queue[1].chapter, 97);
  assert.equal(plan.remainingNewCount, 0);
  assert.equal(plan.remainingCount, 2);
  assert.equal(plan.targetStartChapter, 95);
  assert.equal(plan.targetEndChapter, 97);
});

test("range resume only applies failure strategy to the first failed chapter", () => {
  const report = {
    request: { from: 95, to: 97 },
    chapters: [
      { chapter: 95, finalStatus: "READY_TO_PUBLISH" },
      { chapter: 96, finalStatus: "STOPPED_BY_QUALITY" },
      { chapter: 97, finalStatus: "READY_TO_PUBLISH" },
    ],
  };

  const plan = makeResumePlan({
    sourceReportPath: "report.json",
    sourceReport: report,
    bookDir: "/tmp/book",
  });

  assert.deepEqual(plan.queue.map((item) => [item.chapter, item.resumeKind]), [
    [96, "quality"],
  ]);
});

test("count resume preserves explicit target range and does not add extra chapters", () => {
  const report = {
    request: { count: 4 },
    targetStartChapter: "0100",
    targetEndChapter: "0103",
    chapters: [
      { chapter: 100, finalStatus: "READY_TO_PUBLISH" },
      { chapter: 101, finalStatus: "STOPPED_BY_WRITE_LOCK" },
    ],
  };

  const plan = makeResumePlan({
    sourceReportPath: "report.json",
    sourceReport: report,
    bookDir: "/tmp/book",
  });

  assert.deepEqual(plan.queue.map((item) => item.chapter), [101, 102, 103]);
  assert.equal(plan.queue[0].resumeKind, "writeLock");
  assert.equal(plan.targetEndChapter, 103);
  assert.equal(plan.remainingCount, 3);
});

test("resume rechecks all target chapters when report final status is not ready but chapters are ready", () => {
  const report = {
    request: { count: 4 },
    finalStatus: "UNKNOWN_ERROR",
    targetStartChapter: "0100",
    targetEndChapter: "0103",
    completedChapters: ["0100", "0101", "0102", "0103"],
    chapters: [
      { chapter: 100, finalStatus: "READY_TO_PUBLISH" },
      { chapter: 101, finalStatus: "READY_TO_PUBLISH" },
      { chapter: 102, finalStatus: "READY_TO_PUBLISH" },
      { chapter: 103, finalStatus: "READY_TO_PUBLISH" },
    ],
  };

  const plan = makeResumePlan({
    sourceReportPath: "report.json",
    sourceReport: report,
    bookDir: "/tmp/book",
  });

  assert.equal(plan.noResumeNeeded, false);
  assert.deepEqual(plan.queue.map((item) => item.chapter), [100, 101, 102, 103]);
  assert.equal(plan.targetStartChapter, 100);
  assert.equal(plan.targetEndChapter, 103);
});

test("warning summary classifies P0, P1, and P2 signals", () => {
  const report = {
    request: { dryRun: true },
    chapters: [
      {
        chapter: 1,
        finalStatus: "READY_TO_PUBLISH",
        publishReadyFinalStatus: "READY_WITH_WARNINGS",
        numeric: { A: 0, B: 0, C: 1 },
        steps: [],
      },
      {
        chapter: 2,
        finalStatus: "STOPPED_BY_NUMERIC",
        publishReadyFinalStatus: "READY_TO_EXPORT",
        numeric: { A: 1, B: 0, C: 0 },
        steps: [],
      },
      {
        chapter: 3,
        finalStatus: "STOPPED_BY_CONTINUITY",
        publishReadyFinalStatus: "BLOCKED_BY_CONTINUITY",
        numeric: null,
        steps: [],
      },
    ],
  };

  const summary = buildWarningSummary(report);

  assert(summary.P1.some((item) => item.code === "READY_WITH_WARNINGS"));
  assert(summary.P2.some((item) => item.code === "NUMERIC_C"));
  assert(summary.P0.some((item) => item.code === "NUMERIC_A"));
  assert(summary.P0.some((item) => item.code === "BLOCKED_BY_CONTINUITY"));
  assert.equal(riskLevelForWarningSummary(summary), "BLOCKED");
  assert.equal(publishAdviceForWarningSummary(summary), "DO_NOT_PUBLISH");
});

test("warning summary ignores resolved historical continuity blockers for ready chapters", () => {
  const report = {
    request: { dryRun: true },
    chapters: [
      {
        chapter: 103,
        finalStatus: "READY_TO_PUBLISH",
        publishReadyFinalStatus: "READY_WITH_WARNINGS",
        numeric: { A: 0, B: 0, C: 0 },
        didContinuityAuto: true,
        steps: [
          { name: "publish-ready", summary: "result: BLOCKED_BY_CONTINUITY" },
          { name: "continuity-auto", summary: "result: PASS" },
          { name: "publish-ready-recheck", summary: "result: READY_WITH_WARNINGS" },
        ],
      },
    ],
  };

  const summary = buildWarningSummary(report);
  const resolved = buildResolvedWarnings(report);
  assert(!summary.P0.some((item) => item.code === "BLOCKED_BY_CONTINUITY"));
  assert.deepEqual(resolved, [
    { type: "BLOCKED_BY_CONTINUITY", resolvedBy: "continuity-auto", chapter: "0103" },
  ]);
  assert.equal(riskLevelForWarningSummary(summary), "MEDIUM");
});

test("manual fix prompt is generated under reviews/manual-fix-prompts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkos-wpe-"));
  const bookDir = path.join(root, "my-novel", "books", "Book");
  fs.mkdirSync(bookDir, { recursive: true });

  const result = generateManualFixPrompt({
    root,
    bookDir,
    bookName: "Book",
    chapterRun: {
      chapter: 7,
      finalStatus: "STOPPED_BY_NUMERIC",
      steps: [{ name: "numeric-final-only", exitCode: 1, summary: "hits: A=1 B=0 C=0" }],
    },
    report: { stopReason: "numeric A=1" },
  });

  assert.equal(result.generated, true);
  assert.equal(result.path, path.join("my-novel", "books", "Book", "reviews", "manual-fix-prompts", "0007.md"));
  assert.match(fs.readFileSync(path.join(root, result.path), "utf8"), /非系统流沉浸模式/u);
});
