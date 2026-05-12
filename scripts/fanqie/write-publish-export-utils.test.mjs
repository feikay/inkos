import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWarningSummary,
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
  assert.equal(plan.queue.length, 1);
  assert.equal(plan.queue[0].chapter, 96);
  assert.equal(plan.queue[0].resumeKind, "continuity");
  assert.equal(plan.remainingNewCount, 1);
  assert.equal(plan.remainingCount, 2);
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
    [97, "normal"],
  ]);
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
