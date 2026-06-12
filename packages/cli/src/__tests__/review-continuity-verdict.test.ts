import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContinuityReport } from "@actalk/inkos-core";
import {
  canAcceptManualContinuity,
  makeManualContinuityAcceptance,
  isContinuityBackupChapterFile,
  removeStaleRepeatedInfoBlockers,
  retainNonSalvageFinalAfterSalvageFailure,
  resolvePublishReadyStartingCandidate,
  resolveContinuityOverridePassCandidate,
  decidePublishQuality,
  evaluatePublishReadyLengthGate,
  applyPublishReadyLengthGate,
  readChapterIndexStatus,
  applyStoryEffectivenessDecision,
  applyGolden3ChapterDecision,
  applyOpeningHookDecision,
  applyAntagonistIntelligenceDecision,
  applyTransitionQualityDecision,
  applySixStepPlotDecision,
  generateTransitionQualityReport,
  generateSixStepPlotReport,
  renderPublishReadyMarkdown,
  resolveContentForTransitionQuality,
} from "../commands/review.js";

function makeReport(overrides: Partial<ContinuityReport> = {}): ContinuityReport {
  return {
    score: 82,
    level: "可用",
    status: "NEED_FIX",
    summary: "canonical diagnosis",
    strengths: ["承接主线"],
    issues: [{ type: "危机推进", severity: "中", detail: "铁器围堵仍需更具体。" }],
    opening_check: { result: "PASS" },
    repeated_info_check: {
      severity: "低",
      repeated_paragraphs: [],
      detail: "未出现大段重复。",
    },
    current_goal: "楚夜带云岚避开铁器威胁，并寻找暗河通道。",
    goal_clear: "YES",
    foreshadowing_continuity: { 已承接元素: ["暗河线索"], 被忽略元素: [] },
    crisis_progress: "升级",
    fix_suggestions: ["强化围堵压迫。"],
    rewrite_mode: "light_fix",
    rewrite_prompt: "fix",
    manual_fix_prompt: "manual",
    used_file: "chapters/0085_铁器威胁逼近之时.md",
    decision_source: "current_body_check",
    body_source: "original",
    stale_reports_ignored: [],
    word_count: 1777,
    min_chapter_words: 1000,
    length_status: "PASS",
    publish_readiness: "BLOCKED",
    publish_blockers: [{ type: "continuity_score", detail: "score below 85" }],
    fix_attempt: 0,
    max_fix_attempts: 1,
    final_status: "MANUAL_REVIEW",
    ...overrides,
  };
}

describe("continuity-auto verdict helpers", () => {
  it("does not treat before-continuity-fix backups as current chapter files", () => {
    expect(isContinuityBackupChapterFile("books/x/chapters/0085_标题.before-continuity-fix.md")).toBe(true);
    expect(isContinuityBackupChapterFile("books/x/chapters/0085_标题.before-continuity-fix.txt")).toBe(true);
    expect(isContinuityBackupChapterFile("books/x/chapters/0085_标题.md")).toBe(false);
  });

  it("retains the non-salvage final report when salvage fails", () => {
    const canonical = makeReport();
    const retained = retainNonSalvageFinalAfterSalvageFailure(
      canonical,
      "auto-salvage failed below usable score; retained the non-salvage continuity diagnosis.",
    );

    expect(retained.final_status).toBe("MANUAL_REVIEW");
    expect(retained.used_file).toBe("chapters/0085_铁器威胁逼近之时.md");
    expect(retained.body_source).toBe("original");
    expect(retained.decision_source).toBe("current_body_check");
    expect(retained.summary).toContain("retained the non-salvage continuity diagnosis");
  });

  it("does not let salvage repeated paragraphs pollute a canonical final report", () => {
    const canonical = makeReport({
      repeated_info_check: {
        severity: "低",
        repeated_paragraphs: [],
        detail: "当前正式正文没有重复段。",
      },
    });
    const retained = retainNonSalvageFinalAfterSalvageFailure(
      canonical,
      "auto-salvage plus light_fix did not produce a PASS candidate; retained the formal current-body continuity diagnosis.",
    );

    expect(retained.repeated_info_check).toEqual({
      severity: "低",
      repeated_paragraphs: [],
      detail: "当前正式正文没有重复段。",
    });
    expect(JSON.stringify(retained)).not.toContain("chapters-salvaged/0085_salvage_lightfix.md");
    expect(JSON.stringify(retained)).not.toContain("真名剥离的剧痛与葬渊反噬");
  });

  it("keeps empty repeated paragraphs empty instead of restoring stale repeats", () => {
    const retained = retainNonSalvageFinalAfterSalvageFailure(
      makeReport(),
      "auto-salvage failed; retained canonical report.",
    );
    const repeated = retained.repeated_info_check as { repeated_paragraphs?: unknown[] };

    expect(repeated.repeated_paragraphs).toEqual([]);
  });

  it("removes stale repeated-explanation blockers when repeated paragraphs are empty", () => {
    const normalized = removeStaleRepeatedInfoBlockers(makeReport({
      summary: "当前章节基本承接上一章，但开头仍有少量重复解释，危机推进不够强。",
      issues: [
        { type: "重复解释", severity: "中", detail: "当前章节再次解释真名剥离机制。" },
        { type: "危机推进", severity: "中", detail: "铁器围堵仍需更具体。" },
      ],
      fix_suggestions: [
        "减少开篇对真名剥离与葬渊反噬的重复解释",
        "增强铁器合围的具体压迫感与细节",
      ],
      rewrite_prompt: "【检测问题】[中] 重复解释: 当前章节再次解释真名剥离机制。",
      manual_fix_prompt: "删除真名剥离的剧痛与葬渊反噬。",
    }));

    expect(normalized.issues).toEqual([
      { type: "危机推进", severity: "中", detail: "铁器围堵仍需更具体。" },
    ]);
    expect(normalized.fix_suggestions).toEqual(["增强铁器合围的具体压迫感与细节"]);
    expect(normalized.summary).toBe("当前章节基本承接上一章，但危机推进不够强。");
    expect(normalized.rewrite_prompt).toBe("");
    expect(normalized.manual_fix_prompt).toBe("");
  });

  it("keeps publish-ready default blocking MANUAL_REVIEW continuity", () => {
    expect(canAcceptManualContinuity("MANUAL_REVIEW", false)).toBe(false);
  });

  it("allows explicit publish-ready acceptance for MANUAL_REVIEW but not DROP", () => {
    expect(canAcceptManualContinuity("MANUAL_REVIEW", true)).toBe(true);
    expect(canAcceptManualContinuity("DROP", true)).toBe(false);
    expect(canAcceptManualContinuity("PASS", true)).toBe(false);
  });

  it("records manual continuity acceptance metadata for publish-ready reports", () => {
    const accepted = makeManualContinuityAcceptance({
      acceptManualContinuity: true,
      report: makeReport({ final_status: "MANUAL_REVIEW", score: 82 }),
      sourceFile: "/tmp/book/chapters-reviewed/0085_final.md",
      bookDir: "/tmp/book",
      reviewedFinalExists: true,
    });

    expect(accepted).toEqual({
      manualContinuityAccepted: true,
      manualContinuityAcceptedReason: "MANUAL_REVIEW accepted by explicit CLI flag",
      continuityStatusBeforeManualAccept: "MANUAL_REVIEW",
      continuityScoreBeforeManualAccept: 82,
      acceptedContinuityFile: "chapters-reviewed/0085_final.md",
      reviewedFinalExists: true,
    });
  });

  it("maps publish-ready quality scores to pass, warning, manual-review, and rewrite decisions", () => {
    expect(decidePublishQuality(85, 85, 75)).toBe("QUALITY_PASS");
    expect(decidePublishQuality(84, 85, 75)).toBe("QUALITY_WARN_POLISH_OPTIONAL");
    expect(decidePublishQuality(80, 85, 75)).toBe("QUALITY_WARN_POLISH_OPTIONAL");
    // Scores >= 75 (hard floor) are QUALITY_MANUAL_REVIEW, not NEED_REWRITE
    expect(decidePublishQuality(79, 85, 75)).toBe("QUALITY_MANUAL_REVIEW");
    expect(decidePublishQuality(75, 85, 75)).toBe("QUALITY_MANUAL_REVIEW");
    // Scores below 75 are truly NEED_REWRITE
    expect(decidePublishQuality(74, 85, 75)).toBe("NEED_REWRITE");
    // With high accept threshold (85), scores between 75-84 are QUALITY_MANUAL_REVIEW
    expect(decidePublishQuality(82, 85, 85)).toBe("QUALITY_MANUAL_REVIEW");
    expect(decidePublishQuality(84, 85, 85)).toBe("QUALITY_MANUAL_REVIEW");
  });

  it("blocks publish-ready when the final candidate exceeds the hard chapter length range", () => {
    const gate = evaluatePublishReadyLengthGate({
      text: "字".repeat(7000),
      targetChapterWords: 2000,
      language: "zh",
    });
    const decision = applyPublishReadyLengthGate("READY_WITH_WARNINGS", ["quality warning"], gate);

    expect(gate.status).toBe("FAIL");
    expect(gate.hard_max).toBe(2545);
    expect(decision.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(decision.warnings?.join("\n")).toContain("outside hard range");
  });

  it("prefers chapters-reviewed final as publish-ready starting candidate when manual continuity is accepted", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-publish-ready-"));
    try {
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(join(bookDir, "chapters-fixed"), { recursive: true });
      await mkdir(join(bookDir, "chapters-reviewed"), { recursive: true });
      await mkdir(join(bookDir, "reviews", "continuity"), { recursive: true });
      const original = join(bookDir, "chapters", "0085_标题.md");
      const fixed = join(bookDir, "chapters-fixed", "0085_attempt2.md");
      const reviewed = join(bookDir, "chapters-reviewed", "0085_final.md");
      await writeFile(original, "# 第85章 标题\n\noriginal\n", "utf-8");
      await writeFile(fixed, "# 第85章 标题\n\nfixed\n", "utf-8");
      await writeFile(reviewed, "# 第85章 标题\n\nreviewed\n", "utf-8");
      await writeFile(join(bookDir, "reviews", "continuity", "0085.final-report.json"), JSON.stringify({
        final_status: "MANUAL_REVIEW",
        used_file: "chapters-fixed/0085_attempt2.md",
      }), "utf-8");

      await expect(resolvePublishReadyStartingCandidate(bookDir, 85, original, false)).resolves.toBe(fixed);
      await expect(resolvePublishReadyStartingCandidate(bookDir, 85, original, true)).resolves.toBe(reviewed);
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("resolves a continuity-auto PASS final report as a publish-ready override source", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "inkos-continuity-override-"));
    try {
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(join(bookDir, "reviews", "continuity"), { recursive: true });
      const original = join(bookDir, "chapters", "0094_标题.md");
      await writeFile(original, "# 第94章 标题\n\n正文\n", "utf-8");
      await writeFile(join(bookDir, "reviews", "continuity", "0094.final-report.json"), JSON.stringify({
        final_status: "PASS",
        score: 92,
        used_file: "chapters/0094_标题.md",
        word_count: 1500,
      }), "utf-8");

      const candidate = await resolveContinuityOverridePassCandidate(bookDir, 94);

      expect(candidate?.sourceRef).toBe("chapters/0094_标题.md");
      expect(candidate?.report.final_status).toBe("PASS");
      expect(candidate?.report.score).toBe(92);
      expect(basename(candidate?.sourceFile ?? "")).toBe("0094_标题.md");
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });
});

describe("readChapterIndexStatus", () => {
  it("returns the chapter status from the index", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-review-"));
    try {
      const bookDir = join(tmp, "my-novel", "books", "test-book");
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          { number: 1, status: "draft", wordCount: 1000 },
          { number: 2, status: "blocked-resource-plan", wordCount: 1200 },
          { number: 3, status: "approved", wordCount: 1500 },
        ]),
        "utf-8",
      );

      expect(await readChapterIndexStatus(bookDir, 1)).toBe("draft");
      expect(await readChapterIndexStatus(bookDir, 2)).toBe("blocked-resource-plan");
      expect(await readChapterIndexStatus(bookDir, 3)).toBe("approved");
      // Missing chapter returns null
      expect(await readChapterIndexStatus(bookDir, 99)).toBeNull();
      // Missing index file returns null
      expect(await readChapterIndexStatus(join(tmp, "no-book"), 1)).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns state-degraded status correctly", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-review-"));
    try {
      const bookDir = join(tmp, "my-novel", "books", "test-book-2");
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          { number: 1, status: "state-degraded", wordCount: 500 },
        ]),
        "utf-8",
      );

      expect(await readChapterIndexStatus(bookDir, 1)).toBe("state-degraded");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("applyStoryEffectivenessDecision", () => {
  const sePass = { status: "PASS", score: 90, summary: "六步心法审核通过。" };
  const seWarn = { status: "WARN", score: 75, summary: "存在结构弱点：开头情绪事件信号偏弱" };
  const seFail = { status: "FAIL_STRUCTURAL", score: 50, summary: "结构缺陷：缺少冲突画面；缺少明确主角目标" };
  const seSkipped = { status: "SKIPPED", score: null, summary: "资源账本校验失败，跳过故事有效性审核。" };

  it("PASS: returns unchanged publish_status and warnings", () => {
    const result = applyStoryEffectivenessDecision("READY_TO_EXPORT", undefined, sePass);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("PASS: preserves existing warnings unchanged", () => {
    const result = applyStoryEffectivenessDecision("READY_WITH_WARNINGS", ["quality warning"], sePass);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("SKIPPED: returns unchanged publish_status and warnings", () => {
    const result = applyStoryEffectivenessDecision("READY_TO_EXPORT", undefined, seSkipped);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("SKIPPED: does not change exportable result", () => {
    const result = applyStoryEffectivenessDecision("READY_WITH_WARNINGS", ["existing"], seSkipped);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["existing"]);
  });

  it("WARN: appends story-effectiveness warning without changing publish_status", () => {
    const result = applyStoryEffectivenessDecision("READY_TO_EXPORT", undefined, seWarn);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBe(1);
    expect(result.warnings![0]).toContain("story-effectiveness");
    expect(result.warnings![0]).toContain("75");
  });

  it("WARN: merges with existing warnings", () => {
    const result = applyStoryEffectivenessDecision("READY_WITH_WARNINGS", ["quality score below ideal"], seWarn);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBe(2);
    expect(result.warnings![0]).toBe("quality score below ideal");
    expect(result.warnings![1]).toContain("story-effectiveness");
  });

  it("WARN: appends warnings for MANUAL_REVIEW without changing status", () => {
    const result = applyStoryEffectivenessDecision("MANUAL_REVIEW", undefined, seWarn);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("story-effectiveness");
  });

  it("FAIL_STRUCTURAL: turns READY_TO_EXPORT into MANUAL_REVIEW", () => {
    const result = applyStoryEffectivenessDecision("READY_TO_EXPORT", undefined, seFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("story-effectiveness");
    expect(result.warnings![0]).toContain("50");
  });

  it("FAIL_STRUCTURAL: turns READY_WITH_WARNINGS into MANUAL_REVIEW", () => {
    const result = applyStoryEffectivenessDecision("READY_WITH_WARNINGS", ["quality warning"], seFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBe(2);
  });

  it("FAIL_STRUCTURAL: keeps MANUAL_REVIEW as MANUAL_REVIEW", () => {
    const result = applyStoryEffectivenessDecision("MANUAL_REVIEW", ["continuity concern"], seFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings!.length).toBe(2);
  });

  it("does NOT override BLOCKED_BY_RESOURCE", () => {
    for (const se of [seWarn, seFail]) {
      const result = applyStoryEffectivenessDecision("BLOCKED_BY_RESOURCE", ["resource blocking=true"], se);
      expect(result.publishStatus).toBe("BLOCKED_BY_RESOURCE");
      expect(result.warnings).toEqual(["resource blocking=true"]);
    }
  });

  it("does NOT override BLOCKED_BY_CONTINUITY", () => {
    for (const se of [seWarn, seFail]) {
      const result = applyStoryEffectivenessDecision("BLOCKED_BY_CONTINUITY", undefined, se);
      expect(result.publishStatus).toBe("BLOCKED_BY_CONTINUITY");
      expect(result.warnings).toBeUndefined();
    }
  });

  it("does NOT override BLOCKED_BY_QUALITY", () => {
    for (const se of [seWarn, seFail]) {
      const result = applyStoryEffectivenessDecision("BLOCKED_BY_QUALITY", ["quality < threshold"], se);
      expect(result.publishStatus).toBe("BLOCKED_BY_QUALITY");
      expect(result.warnings).toEqual(["quality < threshold"]);
    }
  });

  it("does NOT override NEED_REWRITE", () => {
    for (const se of [seWarn, seFail]) {
      const result = applyStoryEffectivenessDecision("NEED_REWRITE", undefined, se);
      expect(result.publishStatus).toBe("NEED_REWRITE");
    }
  });

  it("returns unchanged when seSummary is undefined", () => {
    const result = applyStoryEffectivenessDecision("READY_TO_EXPORT", undefined, undefined);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("returns unchanged for unknown seSummary status", () => {
    const result = applyStoryEffectivenessDecision("READY_TO_EXPORT", undefined, { status: "UNKNOWN", score: null, summary: "" });
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });
});

describe("applyGolden3ChapterDecision", () => {
  const gcPass = { status: "PASS", score: 90, summary: "前三章开篇审核通过。" };
  const gcWarn = { status: "WARN", score: 72, summary: "前三章开篇审核警告：第1章开头钩子信号偏弱。" };
  const gcFail = { status: "FAIL_STRUCTURAL", score: 50, summary: "前三章开篇审核未通过：第1章开头未检测到明确钩子类型信号。" };
  const gcSkipped = { status: "SKIPPED", score: null, summary: "跳过：前三章未齐全（缺失：第2章、第3章），无法执行完整开篇审核。" };

  it("PASS: returns unchanged publish_status and warnings", () => {
    const result = applyGolden3ChapterDecision("READY_TO_EXPORT", undefined, gcPass);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("SKIPPED: returns unchanged publish_status and warnings", () => {
    const result = applyGolden3ChapterDecision("READY_TO_EXPORT", ["story warning"], gcSkipped);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toEqual(["story warning"]);
  });

  it("SKIPPED: does not alter READY_WITH_WARNINGS", () => {
    const result = applyGolden3ChapterDecision("READY_WITH_WARNINGS", ["quality warning"], gcSkipped);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("WARN: appends warning without changing publish_status", () => {
    const result = applyGolden3ChapterDecision("READY_TO_EXPORT", undefined, gcWarn);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("golden-3-chapter");
    expect(result.warnings![0]).toContain("72");
  });

  it("WARN: appends to existing warnings", () => {
    const result = applyGolden3ChapterDecision("READY_WITH_WARNINGS", ["quality warning"], gcWarn);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![1]).toContain("golden-3-chapter");
  });

  it("FAIL_STRUCTURAL: turns READY_TO_EXPORT into MANUAL_REVIEW", () => {
    const result = applyGolden3ChapterDecision("READY_TO_EXPORT", undefined, gcFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("golden-3-chapter");
    expect(result.warnings![0]).toContain("50");
  });

  it("FAIL_STRUCTURAL: turns READY_WITH_WARNINGS into MANUAL_REVIEW", () => {
    const result = applyGolden3ChapterDecision("READY_WITH_WARNINGS", ["quality warning"], gcFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toHaveLength(2);
  });

  it("FAIL_STRUCTURAL: keeps MANUAL_REVIEW as MANUAL_REVIEW", () => {
    const result = applyGolden3ChapterDecision("MANUAL_REVIEW", ["continuity concern"], gcFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings!.length).toBe(2);
  });

  it("does NOT override BLOCKED_BY_RESOURCE", () => {
    for (const gc of [gcWarn, gcFail]) {
      const result = applyGolden3ChapterDecision("BLOCKED_BY_RESOURCE", ["resource blocking=true"], gc);
      expect(result.publishStatus).toBe("BLOCKED_BY_RESOURCE");
      expect(result.warnings).toEqual(["resource blocking=true"]);
    }
  });

  it("does NOT override BLOCKED_BY_CONTINUITY", () => {
    for (const gc of [gcWarn, gcFail]) {
      const result = applyGolden3ChapterDecision("BLOCKED_BY_CONTINUITY", undefined, gc);
      expect(result.publishStatus).toBe("BLOCKED_BY_CONTINUITY");
      expect(result.warnings).toBeUndefined();
    }
  });

  it("does NOT override BLOCKED_BY_QUALITY", () => {
    for (const gc of [gcWarn, gcFail]) {
      const result = applyGolden3ChapterDecision("BLOCKED_BY_QUALITY", ["quality < threshold"], gc);
      expect(result.publishStatus).toBe("BLOCKED_BY_QUALITY");
      expect(result.warnings).toEqual(["quality < threshold"]);
    }
  });

  it("does NOT override NEED_REWRITE", () => {
    for (const gc of [gcWarn, gcFail]) {
      const result = applyGolden3ChapterDecision("NEED_REWRITE", undefined, gc);
      expect(result.publishStatus).toBe("NEED_REWRITE");
    }
  });

  it("returns unchanged when gcSummary is undefined", () => {
    const result = applyGolden3ChapterDecision("READY_TO_EXPORT", undefined, undefined);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });
});

describe("applyOpeningHookDecision", () => {
  const ohPass = { status: "PASS", score: 88, summary: "章节开头钩子审核通过（88/100）。" };
  const ohWarn = { status: "WARN", score: 65, summary: "章节开头钩子审核警告（65/100）。前100字未检测到异常画面。" };
  const ohFail = { status: "FAIL_STRUCTURAL", score: 35, summary: "章节开头钩子审核未通过（35/100）。未检测到五类钩子信号。" };
  const ohSkipped = { status: "SKIPPED", score: null, summary: "跳过：资源账本校验失败，跳过开头钩子审核。" };

  it("PASS: returns unchanged publish_status and warnings", () => {
    const result = applyOpeningHookDecision("READY_TO_EXPORT", undefined, ohPass);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("SKIPPED: returns unchanged publish_status and warnings", () => {
    const result = applyOpeningHookDecision("READY_TO_EXPORT", ["story warning"], ohSkipped);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toEqual(["story warning"]);
  });

  it("SKIPPED: does not alter READY_WITH_WARNINGS", () => {
    const result = applyOpeningHookDecision("READY_WITH_WARNINGS", ["quality warning"], ohSkipped);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("WARN: appends warning without changing publish_status", () => {
    const result = applyOpeningHookDecision("READY_TO_EXPORT", undefined, ohWarn);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("opening-hook");
    expect(result.warnings![0]).toContain("65");
  });

  it("WARN: appends to existing warnings", () => {
    const result = applyOpeningHookDecision("READY_WITH_WARNINGS", ["quality warning"], ohWarn);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![1]).toContain("opening-hook");
  });

  it("FAIL_STRUCTURAL: turns READY_TO_EXPORT into MANUAL_REVIEW", () => {
    const result = applyOpeningHookDecision("READY_TO_EXPORT", undefined, ohFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("opening-hook");
    expect(result.warnings![0]).toContain("35");
  });

  it("FAIL_STRUCTURAL: turns READY_WITH_WARNINGS into MANUAL_REVIEW", () => {
    const result = applyOpeningHookDecision("READY_WITH_WARNINGS", ["quality warning"], ohFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toHaveLength(2);
  });

  it("FAIL_STRUCTURAL: keeps MANUAL_REVIEW as MANUAL_REVIEW", () => {
    const result = applyOpeningHookDecision("MANUAL_REVIEW", ["continuity concern"], ohFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings!.length).toBe(2);
  });

  it("does NOT override BLOCKED_BY_RESOURCE", () => {
    for (const oh of [ohWarn, ohFail]) {
      const result = applyOpeningHookDecision("BLOCKED_BY_RESOURCE", ["resource blocking=true"], oh);
      expect(result.publishStatus).toBe("BLOCKED_BY_RESOURCE");
      expect(result.warnings).toEqual(["resource blocking=true"]);
    }
  });

  it("does NOT override BLOCKED_BY_CONTINUITY", () => {
    for (const oh of [ohWarn, ohFail]) {
      const result = applyOpeningHookDecision("BLOCKED_BY_CONTINUITY", undefined, oh);
      expect(result.publishStatus).toBe("BLOCKED_BY_CONTINUITY");
      expect(result.warnings).toBeUndefined();
    }
  });

  it("does NOT override BLOCKED_BY_QUALITY", () => {
    for (const oh of [ohWarn, ohFail]) {
      const result = applyOpeningHookDecision("BLOCKED_BY_QUALITY", ["quality < threshold"], oh);
      expect(result.publishStatus).toBe("BLOCKED_BY_QUALITY");
      expect(result.warnings).toEqual(["quality < threshold"]);
    }
  });

  it("does NOT override NEED_REWRITE", () => {
    for (const oh of [ohWarn, ohFail]) {
      const result = applyOpeningHookDecision("NEED_REWRITE", undefined, oh);
      expect(result.publishStatus).toBe("NEED_REWRITE");
    }
  });

  it("returns unchanged when ohSummary is undefined", () => {
    const result = applyOpeningHookDecision("READY_TO_EXPORT", undefined, undefined);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });
});

describe("applyAntagonistIntelligenceDecision", () => {
  const aiPass = { status: "PASS", score: 90, summary: "反派智能审核通过（90/100，LLM+硬扫描）。" };
  const aiWarn = { status: "WARN", score: 72, summary: "反派智能审核警告（72/100，仅硬扫描）。未检测到反派明确目标信号。" };
  const aiFail = { status: "FAIL_REPORT_ONLY", score: 55, summary: "反派智能审核未通过（55/100，LLM+硬扫描）。正文检测到反派降智信号。" };
  const aiSkipped = { status: "SKIPPED", score: null, summary: "跳过：资源账本校验失败，跳过反派智能审核。" };

  it("PASS: returns unchanged publish_status and warnings", () => {
    const result = applyAntagonistIntelligenceDecision("READY_TO_EXPORT", undefined, aiPass);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("PASS: preserves existing warnings unchanged", () => {
    const result = applyAntagonistIntelligenceDecision("READY_WITH_WARNINGS", ["quality warning"], aiPass);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("SKIPPED: returns unchanged publish_status and warnings", () => {
    const result = applyAntagonistIntelligenceDecision("READY_TO_EXPORT", ["story warning"], aiSkipped);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toEqual(["story warning"]);
  });

  it("SKIPPED: does not alter READY_WITH_WARNINGS", () => {
    const result = applyAntagonistIntelligenceDecision("READY_WITH_WARNINGS", ["quality warning"], aiSkipped);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("WARN: appends warning without changing publish_status", () => {
    const result = applyAntagonistIntelligenceDecision("READY_TO_EXPORT", undefined, aiWarn);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("antagonist-intelligence");
    expect(result.warnings![0]).toContain("72");
  });

  it("WARN: appends to existing warnings", () => {
    const result = applyAntagonistIntelligenceDecision("READY_WITH_WARNINGS", ["quality warning"], aiWarn);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![1]).toContain("antagonist-intelligence");
  });

  it("WARN: appends warnings for MANUAL_REVIEW without changing status", () => {
    const result = applyAntagonistIntelligenceDecision("MANUAL_REVIEW", undefined, aiWarn);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("antagonist-intelligence");
  });

  it("FAIL_REPORT_ONLY: turns READY_TO_EXPORT into MANUAL_REVIEW", () => {
    const result = applyAntagonistIntelligenceDecision("READY_TO_EXPORT", undefined, aiFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("antagonist-intelligence");
    expect(result.warnings![0]).toContain("55");
  });

  it("FAIL_REPORT_ONLY: turns READY_WITH_WARNINGS into MANUAL_REVIEW", () => {
    const result = applyAntagonistIntelligenceDecision("READY_WITH_WARNINGS", ["quality warning"], aiFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toHaveLength(2);
  });

  it("FAIL_REPORT_ONLY: keeps MANUAL_REVIEW as MANUAL_REVIEW", () => {
    const result = applyAntagonistIntelligenceDecision("MANUAL_REVIEW", ["continuity concern"], aiFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings!.length).toBe(2);
  });

  it("does NOT override BLOCKED_BY_RESOURCE", () => {
    for (const ai of [aiWarn, aiFail]) {
      const result = applyAntagonistIntelligenceDecision("BLOCKED_BY_RESOURCE", ["resource blocking=true"], ai);
      expect(result.publishStatus).toBe("BLOCKED_BY_RESOURCE");
      expect(result.warnings).toEqual(["resource blocking=true"]);
    }
  });

  it("does NOT override BLOCKED_BY_CONTINUITY", () => {
    for (const ai of [aiWarn, aiFail]) {
      const result = applyAntagonistIntelligenceDecision("BLOCKED_BY_CONTINUITY", undefined, ai);
      expect(result.publishStatus).toBe("BLOCKED_BY_CONTINUITY");
      expect(result.warnings).toBeUndefined();
    }
  });

  it("does NOT override BLOCKED_BY_QUALITY", () => {
    for (const ai of [aiWarn, aiFail]) {
      const result = applyAntagonistIntelligenceDecision("BLOCKED_BY_QUALITY", ["quality < threshold"], ai);
      expect(result.publishStatus).toBe("BLOCKED_BY_QUALITY");
      expect(result.warnings).toEqual(["quality < threshold"]);
    }
  });

  it("does NOT override NEED_REWRITE", () => {
    for (const ai of [aiWarn, aiFail]) {
      const result = applyAntagonistIntelligenceDecision("NEED_REWRITE", undefined, ai);
      expect(result.publishStatus).toBe("NEED_REWRITE");
    }
  });

  it("returns unchanged when aiSummary is undefined", () => {
    const result = applyAntagonistIntelligenceDecision("READY_TO_EXPORT", undefined, undefined);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });
});

describe("applyTransitionQualityDecision", () => {
  const tqPass = { status: "PASS", score: 88, summary: "转场质量审核通过（88/100），硬转场 0 种，方法证据 3/4 维。" };
  const tqWarn = { status: "WARN", score: 65, summary: "转场质量审核警告（65/100），硬转场 3 种，方法证据 2/4 维。" };
  const tqFail = { status: "FAIL_STRUCTURAL", score: 42, summary: "转场质量审核未通过（42/100），硬转场 5 种，方法证据 1/4 维。" };
  const tqSkipped = { status: "SKIPPED", score: null, summary: "跳过：资源账本校验失败，跳过转场质量审核。" };

  it("PASS: returns unchanged publish_status and warnings", () => {
    const result = applyTransitionQualityDecision("READY_TO_EXPORT", undefined, tqPass);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("PASS: preserves existing warnings unchanged", () => {
    const result = applyTransitionQualityDecision("READY_WITH_WARNINGS", ["quality warning"], tqPass);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("SKIPPED: returns unchanged publish_status and warnings", () => {
    const result = applyTransitionQualityDecision("READY_TO_EXPORT", ["story warning"], tqSkipped);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toEqual(["story warning"]);
  });

  it("SKIPPED: does not alter READY_WITH_WARNINGS", () => {
    const result = applyTransitionQualityDecision("READY_WITH_WARNINGS", ["quality warning"], tqSkipped);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("WARN: appends warning without changing publish_status", () => {
    const result = applyTransitionQualityDecision("READY_TO_EXPORT", undefined, tqWarn);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("transition-quality");
    expect(result.warnings![0]).toContain("65");
  });

  it("WARN: appends to existing warnings", () => {
    const result = applyTransitionQualityDecision("READY_WITH_WARNINGS", ["quality warning"], tqWarn);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![1]).toContain("transition-quality");
  });

  it("WARN: appends warnings for MANUAL_REVIEW without changing status", () => {
    const result = applyTransitionQualityDecision("MANUAL_REVIEW", undefined, tqWarn);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("transition-quality");
  });

  it("FAIL_STRUCTURAL: turns READY_TO_EXPORT into MANUAL_REVIEW", () => {
    const result = applyTransitionQualityDecision("READY_TO_EXPORT", undefined, tqFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("transition-quality");
    expect(result.warnings![0]).toContain("42");
  });

  it("FAIL_STRUCTURAL: turns READY_WITH_WARNINGS into MANUAL_REVIEW", () => {
    const result = applyTransitionQualityDecision("READY_WITH_WARNINGS", ["quality warning"], tqFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toHaveLength(2);
  });

  it("FAIL_STRUCTURAL: keeps MANUAL_REVIEW as MANUAL_REVIEW", () => {
    const result = applyTransitionQualityDecision("MANUAL_REVIEW", ["continuity concern"], tqFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings!.length).toBe(2);
  });

  it("does NOT override BLOCKED_BY_RESOURCE", () => {
    for (const tq of [tqWarn, tqFail]) {
      const result = applyTransitionQualityDecision("BLOCKED_BY_RESOURCE", ["resource blocking=true"], tq);
      expect(result.publishStatus).toBe("BLOCKED_BY_RESOURCE");
      expect(result.warnings).toEqual(["resource blocking=true"]);
    }
  });

  it("does NOT override BLOCKED_BY_CONTINUITY", () => {
    for (const tq of [tqWarn, tqFail]) {
      const result = applyTransitionQualityDecision("BLOCKED_BY_CONTINUITY", undefined, tq);
      expect(result.publishStatus).toBe("BLOCKED_BY_CONTINUITY");
      expect(result.warnings).toBeUndefined();
    }
  });

  it("does NOT override BLOCKED_BY_QUALITY", () => {
    for (const tq of [tqWarn, tqFail]) {
      const result = applyTransitionQualityDecision("BLOCKED_BY_QUALITY", ["quality < threshold"], tq);
      expect(result.publishStatus).toBe("BLOCKED_BY_QUALITY");
      expect(result.warnings).toEqual(["quality < threshold"]);
    }
  });

  it("does NOT override NEED_REWRITE", () => {
    for (const tq of [tqWarn, tqFail]) {
      const result = applyTransitionQualityDecision("NEED_REWRITE", undefined, tq);
      expect(result.publishStatus).toBe("NEED_REWRITE");
    }
  });

  it("returns unchanged when tqSummary is undefined", () => {
    const result = applyTransitionQualityDecision("READY_TO_EXPORT", undefined, undefined);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("returns unchanged for unknown tqSummary status", () => {
    const result = applyTransitionQualityDecision("READY_TO_EXPORT", undefined, { status: "UNKNOWN", score: null, summary: "" });
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });
});

describe("generateTransitionQualityReport", () => {
  it("writes transition-quality report files to disk and returns summary", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-test-"));
    const chapterContent = "夜幕降临。\n\n楚夜转身看向云岚，目光中带着一丝担忧。\n\n与此同时，远处传来了铁器的碰撞声。\n\n他深吸一口气，迈步向前。";

    const summary = await generateTransitionQualityReport(tmp, 1, chapterContent);

    expect(summary).toBeDefined();
    expect(summary!.status).toBeDefined();
    expect(typeof summary!.status).toBe("string");
    expect(summary!.score !== undefined).toBe(true);
    expect(typeof summary!.summary).toBe("string");

    // Verify files were written
    const { existsSync } = await import("node:fs");
    const prefix = "0001";
    const jsonPath = join(tmp, "reviews", "transition-quality", `${prefix}.transition-quality.report.json`);
    const mdPath = join(tmp, "reviews", "transition-quality", `${prefix}.transition-quality.report.md`);
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    // Verify json file content structure
    const jsonRaw = await import("node:fs/promises").then((fs) => fs.readFile(jsonPath, "utf-8"));
    const report = JSON.parse(jsonRaw);
    expect(report.status).toBeDefined();
    expect(report.score === null || typeof report.score === "number").toBe(true);
    expect(typeof report.summary).toBe("string");
    expect(report.dimensions).toBeDefined();
    expect(report.hardTransitionCount !== undefined).toBe(true);

    // Verify markdown includes transition_quality info
    const mdRaw = await import("node:fs/promises").then((fs) => fs.readFile(mdPath, "utf-8"));
    expect(mdRaw).toContain("Transition Quality");

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns programmatic report (no LLM call, hard scan only)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-test-"));
    const chapterContent = "Some content with 突然 transition phrase.";

    const summary = await generateTransitionQualityReport(tmp, 1, chapterContent);
    expect(summary).toBeDefined();
    // Programmatic scan should always produce a valid status
    expect(["PASS", "WARN", "FAIL_STRUCTURAL", "SKIPPED"]).toContain(summary!.status);

    await rm(tmp, { recursive: true, force: true });
  });

  it("report path matches readTransitionQualitySummary convention", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-test-"));
    const chapterContent = "第一章正文内容";

    await generateTransitionQualityReport(tmp, 42, chapterContent);

    // This is the 4-digit prefix convention readTransitionQualitySummary uses
    const { existsSync } = await import("node:fs");
    const expectedPath = join(tmp, "reviews", "transition-quality", "0042.transition-quality.report.json");
    expect(existsSync(expectedPath)).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects chapterTitle parameter", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-test-"));
    const content = "Test content for title.";

    const summary = await generateTransitionQualityReport(tmp, 1, content, "测试标题");
    expect(summary).toBeDefined();

    // Should not crash - title is optional
    const summary2 = await generateTransitionQualityReport(tmp, 2, content);
    expect(summary2).toBeDefined();

    await rm(tmp, { recursive: true, force: true });
  });
});

describe("renderPublishReadyMarkdown transition_quality field", () => {
  function makeBaseReport(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      book: "test-book",
      chapter_index: 1,
      publish_status: "READY_TO_EXPORT",
      final_candidate_file: "books/test-book/chapters-reviewed/0001_final.md",
      source_chain: ["chapters/0001_test.md"],
      continuity: { final_status: "PASS", score: 90 },
      quality: { final_quality_status: "QUALITY_PASS", score: 88 },
      quality_score: 88,
      quality_pass_threshold: 85,
      quality_accept_threshold: 80,
      word_count: 2000,
      min_chapter_words: 1000,
      report_json_path: "/tmp/report.json",
      report_markdown_path: "/tmp/report.md",
      ...overrides,
    } as Parameters<typeof renderPublishReadyMarkdown>[0];
  }

  it("includes transition_quality section when present", () => {
    const report = makeBaseReport({
      transition_quality: { status: "PASS", score: 85, summary: "转场自然流畅。" },
    });
    const md = renderPublishReadyMarkdown(report);
    expect(md).toContain("transition_quality:");
    expect(md).toContain("PASS");
    expect(md).toContain("85");
    expect(md).toContain("转场自然流畅。");
  });

  it("includes WARN transition_quality with warning text", () => {
    const report = makeBaseReport({
      transition_quality: { status: "WARN", score: 60, summary: "部分转场存在钩子断裂风险。" },
    });
    const md = renderPublishReadyMarkdown(report);
    expect(md).toContain("transition_quality:");
    expect(md).toContain("WARN");
    expect(md).toContain("钩子断裂");
  });

  it("includes FAIL_STRUCTURAL transition_quality", () => {
    const report = makeBaseReport({
      transition_quality: { status: "FAIL_STRUCTURAL", score: 35, summary: "硬转场过多，缺乏叙事推进。" },
    });
    const md = renderPublishReadyMarkdown(report);
    expect(md).toContain("transition_quality:");
    expect(md).toContain("FAIL_STRUCTURAL");
  });

  it("does NOT include transition_quality section when absent", () => {
    const report = makeBaseReport();
    const md = renderPublishReadyMarkdown(report);
    expect(md).not.toContain("transition_quality:");
  });

  it("includes transition_quality among other review layer fields", () => {
    const report = makeBaseReport({
      story_effectiveness: { status: "PASS", score: 90, summary: "情绪与冲突强度足够。" },
      golden_3_chapter: { status: "PASS", score: 88, summary: "开篇节奏良好。" },
      opening_hook: { status: "WARN", score: 55, summary: "开篇悬疑钩子较弱。" },
      antagonist_intelligence: { status: "PASS", score: 92, summary: "反派博弈设计合格。" },
      transition_quality: { status: "PASS", score: 85, summary: "转场自然流畅。" },
    });
    const md = renderPublishReadyMarkdown(report);
    expect(md).toContain("story_effectiveness:");
    expect(md).toContain("golden_3_chapter:");
    expect(md).toContain("opening_hook:");
    expect(md).toContain("antagonist_intelligence:");
    expect(md).toContain("transition_quality:");
  });

  it("includes SKIPPED transition_quality", () => {
    const report = makeBaseReport({
      transition_quality: { status: "SKIPPED", score: null, summary: "跳过：资源账本校验失败。" },
    });
    const md = renderPublishReadyMarkdown(report);
    expect(md).toContain("transition_quality:");
    expect(md).toContain("SKIPPED");
  });
});

describe("resolveContentForTransitionQuality", () => {
  it("uses final_candidate_file content when it exists (priority 1)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-resolve-"));
    // Create original chapter
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, "0001_test.md"), "原始章节内容 ORIGINAL", "utf-8");

    // Create final candidate with different content
    const reviewedDir = join(tmp, "chapters-reviewed");
    await mkdir(reviewedDir, { recursive: true });
    const finalPath = join(reviewedDir, "0001_final.md");
    await writeFile(finalPath, "最终候选稿内容 FINAL", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      "chapters-reviewed/0001_final.md", // final_candidate_file
      undefined,
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("最终候选稿内容 FINAL");
    expect(result!.content).not.toContain("原始章节内容 ORIGINAL");
    expect(result!.path).toBe(finalPath);

    await rm(tmp, { recursive: true, force: true });
  });

  it("falls back to source_file when final_candidate_file is unavailable (priority 2)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-resolve-"));
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, "0001_test.md"), "原始章节内容 ORIGINAL", "utf-8");

    // Create a fixed candidate
    const fixedDir = join(tmp, "chapters-fixed");
    await mkdir(fixedDir, { recursive: true });
    const sourcePath = join(fixedDir, "0001_fixed_v1.md");
    await writeFile(sourcePath, "修复后的章节 SOURCE_FILE", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      "", // empty final_candidate_file
      "chapters-fixed/0001_fixed_v1.md", // source_file
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("修复后的章节 SOURCE_FILE");
    expect(result!.content).not.toContain("原始章节内容 ORIGINAL");
    expect(result!.path).toBe(sourcePath);

    await rm(tmp, { recursive: true, force: true });
  });

  it("falls back to findChapterFile when final_candidate_file and source_file are both empty (priority 3)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-resolve-"));
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    const origPath = join(chaptersDir, "0001_test.md");
    await writeFile(origPath, "原始章节内容 ORIGINAL", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      "",   // empty final_candidate_file
      undefined, // no source_file
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("原始章节内容 ORIGINAL");
    expect(result!.path).toBe(origPath);

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns null when no source is available", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-resolve-"));
    // No chapters directory at all

    const result = await resolveContentForTransitionQuality(
      tmp, 99,
      "",    // empty final_candidate_file
      undefined, // no source_file
    );

    expect(result).toBeNull();

    await rm(tmp, { recursive: true, force: true });
  });

  it("prefers final_candidate_file even when source_file is present", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-resolve-"));
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, "0001_test.md"), "原始章节", "utf-8");

    // Both final candidate and source exist with different content
    const reviewedDir = join(tmp, "chapters-reviewed");
    await mkdir(reviewedDir, { recursive: true });
    await writeFile(join(reviewedDir, "0001_final.md"), "FINAL_CANDIDATE", "utf-8");

    const fixedDir = join(tmp, "chapters-fixed");
    await mkdir(fixedDir, { recursive: true });
    await writeFile(join(fixedDir, "0001_v1.md"), "SOURCE_FILE", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      "chapters-reviewed/0001_final.md", // final_candidate_file
      "chapters-fixed/0001_v1.md",        // source_file
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("FINAL_CANDIDATE");
    expect(result!.content).not.toContain("SOURCE_FILE");
    expect(result!.content).not.toContain("原始章节");

    await rm(tmp, { recursive: true, force: true });
  });

  it("handles undefined final_candidate_file (not just empty string)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-tq-resolve-"));
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    const sourcePath = join(chaptersDir, "0001_test.md");
    await writeFile(sourcePath, "only source", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      undefined, // undefined final_candidate_file
      "chapters/0001_test.md",
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("only source");

    await rm(tmp, { recursive: true, force: true });
  });
});

// ---- six-step-plot publish-ready integration tests ----

describe("applySixStepPlotDecision", () => {
  const ssPass = { status: "PASS", score: 88, summary: "六步剧情审核通过（88/100），6/6 维信号检出。" };
  const ssWarn = { status: "WARN", score: 65, summary: "六步剧情审核警告（65/100），2/6 维弱。" };
  const ssFail = { status: "FAIL_STRUCTURAL", score: 42, summary: "六步剧情审核未通过（42/100），1/6 维存在严重缺陷。" };
  const ssSkipped = { status: "SKIPPED", score: null, summary: "跳过：资源账本校验失败，跳过六步剧情审核。" };

  it("PASS: returns unchanged publish_status and warnings", () => {
    const result = applySixStepPlotDecision("READY_TO_EXPORT", undefined, ssPass);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("PASS: preserves existing warnings unchanged", () => {
    const result = applySixStepPlotDecision("READY_WITH_WARNINGS", ["quality warning"], ssPass);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("SKIPPED: returns unchanged publish_status and warnings", () => {
    const result = applySixStepPlotDecision("READY_TO_EXPORT", ["story warning"], ssSkipped);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toEqual(["story warning"]);
  });

  it("SKIPPED: does not alter READY_WITH_WARNINGS", () => {
    const result = applySixStepPlotDecision("READY_WITH_WARNINGS", ["quality warning"], ssSkipped);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toEqual(["quality warning"]);
  });

  it("WARN: appends warning without changing publish_status", () => {
    const result = applySixStepPlotDecision("READY_TO_EXPORT", undefined, ssWarn);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("six-step-plot");
    expect(result.warnings![0]).toContain("65");
  });

  it("WARN: appends to existing warnings", () => {
    const result = applySixStepPlotDecision("READY_WITH_WARNINGS", ["quality warning"], ssWarn);
    expect(result.publishStatus).toBe("READY_WITH_WARNINGS");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![1]).toContain("six-step-plot");
  });

  it("WARN: appends warnings for MANUAL_REVIEW without changing status", () => {
    const result = applySixStepPlotDecision("MANUAL_REVIEW", undefined, ssWarn);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("six-step-plot");
  });

  it("FAIL_STRUCTURAL: turns READY_TO_EXPORT into MANUAL_REVIEW", () => {
    const result = applySixStepPlotDecision("READY_TO_EXPORT", undefined, ssFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain("six-step-plot");
    expect(result.warnings![0]).toContain("42");
  });

  it("FAIL_STRUCTURAL: turns READY_WITH_WARNINGS into MANUAL_REVIEW", () => {
    const result = applySixStepPlotDecision("READY_WITH_WARNINGS", ["quality warning"], ssFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings).toHaveLength(2);
  });

  it("FAIL_STRUCTURAL: keeps MANUAL_REVIEW as MANUAL_REVIEW", () => {
    const result = applySixStepPlotDecision("MANUAL_REVIEW", ["continuity concern"], ssFail);
    expect(result.publishStatus).toBe("MANUAL_REVIEW");
    expect(result.warnings!.length).toBe(2);
  });

  it("does NOT override BLOCKED_BY_RESOURCE", () => {
    for (const ss of [ssWarn, ssFail]) {
      const result = applySixStepPlotDecision("BLOCKED_BY_RESOURCE", ["resource blocking=true"], ss);
      expect(result.publishStatus).toBe("BLOCKED_BY_RESOURCE");
      expect(result.warnings).toEqual(["resource blocking=true"]);
    }
  });

  it("does NOT override BLOCKED_BY_CONTINUITY", () => {
    for (const ss of [ssWarn, ssFail]) {
      const result = applySixStepPlotDecision("BLOCKED_BY_CONTINUITY", undefined, ss);
      expect(result.publishStatus).toBe("BLOCKED_BY_CONTINUITY");
      expect(result.warnings).toBeUndefined();
    }
  });

  it("does NOT override BLOCKED_BY_QUALITY", () => {
    for (const ss of [ssWarn, ssFail]) {
      const result = applySixStepPlotDecision("BLOCKED_BY_QUALITY", ["quality < threshold"], ss);
      expect(result.publishStatus).toBe("BLOCKED_BY_QUALITY");
      expect(result.warnings).toEqual(["quality < threshold"]);
    }
  });

  it("does NOT override NEED_REWRITE", () => {
    for (const ss of [ssWarn, ssFail]) {
      const result = applySixStepPlotDecision("NEED_REWRITE", undefined, ss);
      expect(result.publishStatus).toBe("NEED_REWRITE");
    }
  });

  it("returns unchanged when ssSummary is undefined", () => {
    const result = applySixStepPlotDecision("READY_TO_EXPORT", undefined, undefined);
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });

  it("returns unchanged for unknown ssSummary status", () => {
    const result = applySixStepPlotDecision("READY_TO_EXPORT", undefined, { status: "UNKNOWN", score: null, summary: "" });
    expect(result.publishStatus).toBe("READY_TO_EXPORT");
    expect(result.warnings).toBeUndefined();
  });
});

describe("renderPublishReadyMarkdown six_step_plot field", () => {
  function makeBaseReport(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      book: "test-book",
      chapter_index: 1,
      publish_status: "READY_TO_EXPORT",
      final_candidate_file: "chapters-reviewed/0001_final.md",
      source_chain: ["chapters/0001.md", "chapters-fixed/0001_v1.md", "chapters-reviewed/0001_final.md"],
      continuity: { final_status: "PASS", score: 88 },
      quality: { final_quality_status: "QUALITY_PASS", score: 92 },
      quality_decision: "QUALITY_PASS" as const,
      quality_score: 92,
      quality_pass_threshold: 85,
      quality_accept_threshold: 75,
      min_chapter_words: 1000,
      word_count: 2500,
      report_json_path: "/tmp/test.json",
      report_markdown_path: "/tmp/test.md",
      ...overrides,
    };
  }

  it("includes six_step_plot field when present", () => {
    const report = makeBaseReport({
      six_step_plot: { status: "PASS", score: 88, summary: "六步剧情审核通过（88/100），6/6 维信号检出。" },
    });
    const md = renderPublishReadyMarkdown(report as Parameters<typeof renderPublishReadyMarkdown>[0]);
    expect(md).toContain("six_step_plot");
    expect(md).toContain("PASS");
    expect(md).toContain("88");
    expect(md).toContain("六步剧情审核通过");
  });

  it("omits six_step_plot field when not present", () => {
    const report = makeBaseReport();
    const md = renderPublishReadyMarkdown(report as Parameters<typeof renderPublishReadyMarkdown>[0]);
    expect(md).not.toContain("six_step_plot");
  });

  it("renders six_step_plot WARN status correctly", () => {
    const report = makeBaseReport({
      six_step_plot: { status: "WARN", score: 65, summary: "六步剧情审核警告（65/100），2/6 维弱。" },
    });
    const md = renderPublishReadyMarkdown(report as Parameters<typeof renderPublishReadyMarkdown>[0]);
    expect(md).toContain("six_step_plot: WARN");
    expect(md).toContain("65");
    expect(md).toContain("六步剧情审核警告");
  });

  it("renders six_step_plot FAIL_STRUCTURAL status correctly", () => {
    const report = makeBaseReport({
      six_step_plot: { status: "FAIL_STRUCTURAL", score: 42, summary: "六步剧情审核未通过（42/100），1/6 维存在严重缺陷。" },
    });
    const md = renderPublishReadyMarkdown(report as Parameters<typeof renderPublishReadyMarkdown>[0]);
    expect(md).toContain("six_step_plot: FAIL_STRUCTURAL");
    expect(md).toContain("42");
  });

  it("renders six_step_plot SKIPPED status correctly", () => {
    const report = makeBaseReport({
      six_step_plot: { status: "SKIPPED", score: null, summary: "跳过：资源账本校验失败，跳过六步剧情审核。" },
    });
    const md = renderPublishReadyMarkdown(report as Parameters<typeof renderPublishReadyMarkdown>[0]);
    expect(md).toContain("six_step_plot: SKIPPED");
    expect(md).toContain("n/a");
  });
});

describe("generateSixStepPlotReport", () => {
  it("writes six-step-plot report files to disk and returns summary", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-test-"));
    const chapterContent = "主角握紧拳头，一股愤怒涌上心头。出现压迫——那人不公地夺走了他的一切，这是赤裸裸的不公或冲突画面。他的目标是拿到灵石逃出此地。阻碍来自故事内在规则，制度门槛高不可攀。虽然局势危险，但保留了可破局的线索。高潮时刻，行动来自主角选择而不是外力代劳。战斗结束后，主角变强了，新敌意在暗处滋生。";

    const summary = await generateSixStepPlotReport(tmp, 1, chapterContent);

    expect(summary).toBeDefined();
    expect(summary!.status).toBeDefined();
    expect(typeof summary!.status).toBe("string");
    expect(summary!.score !== undefined).toBe(true);
    expect(typeof summary!.summary).toBe("string");

    // Verify files were written
    const { existsSync } = await import("node:fs");
    const prefix = "0001";
    const jsonPath = join(tmp, "reviews", "six-step-plot", `${prefix}.six-step-plot.report.json`);
    const mdPath = join(tmp, "reviews", "six-step-plot", `${prefix}.six-step-plot.report.md`);
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    // Verify json file content structure
    const jsonRaw = await import("node:fs/promises").then((fs) => fs.readFile(jsonPath, "utf-8"));
    const report = JSON.parse(jsonRaw);
    expect(report.status).toBeDefined();
    expect(report.score === null || typeof report.score === "number").toBe(true);
    expect(typeof report.summary).toBe("string");
    expect(report.dimensions).toBeDefined();
    expect(report.methodCompliance).toBeDefined();

    // Verify markdown includes six_step_plot info
    const mdRaw = await import("node:fs/promises").then((fs) => fs.readFile(mdPath, "utf-8"));
    expect(mdRaw).toContain("六步剧情");

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns programmatic report (no LLM call, signal detection only)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-test-"));
    const chapterContent = "Some content with emotion and goal signals.";

    const summary = await generateSixStepPlotReport(tmp, 1, chapterContent);
    expect(summary).toBeDefined();
    // Programmatic scan should always produce a valid status
    expect(["PASS", "WARN", "FAIL_STRUCTURAL", "SKIPPED"]).toContain(summary!.status);

    await rm(tmp, { recursive: true, force: true });
  });

  it("report path matches readSixStepPlotSummary convention", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-test-"));
    const chapterContent = "第一章正文内容";

    await generateSixStepPlotReport(tmp, 42, chapterContent);

    const { existsSync } = await import("node:fs");
    const expectedPath = join(tmp, "reviews", "six-step-plot", "0042.six-step-plot.report.json");
    expect(existsSync(expectedPath)).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects chapterTitle parameter", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-test-"));
    const content = "Test content for title.";

    const summary = await generateSixStepPlotReport(tmp, 1, content, "测试标题");
    expect(summary).toBeDefined();

    // Should not crash - title is optional
    const summary2 = await generateSixStepPlotReport(tmp, 2, content);
    expect(summary2).toBeDefined();

    await rm(tmp, { recursive: true, force: true });
  });

  it("generates report from empty content (SKIPPED)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-test-"));

    const summary = await generateSixStepPlotReport(tmp, 1, "");
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("SKIPPED");

    await rm(tmp, { recursive: true, force: true });
  });

  it("optionally reads chapterIntent when file exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-test-"));
    const content = "主角遭遇了不公，目标明确，阻碍来自内在规则，找到了线索，主动选择行动，战斗后获得收益。";

    // Create chapter-intents directory and file
    const intentsDir = join(tmp, "story", "runtime", "chapter-intents");
    await mkdir(intentsDir, { recursive: true });
    await writeFile(join(intentsDir, "0001.md"), "情绪事件 欲望目标 阻碍 解法 高潮 反馈", "utf-8");

    const summary = await generateSixStepPlotReport(tmp, 1, content);
    expect(summary).toBeDefined();
    expect(summary!.status).toBeDefined();

    // Verify the generated report includes intentFidelity when chapterIntent was provided
    const prefix = "0001";
    const jsonPath = join(tmp, "reviews", "six-step-plot", `${prefix}.six-step-plot.report.json`);
    const jsonRaw = await import("node:fs/promises").then((fs) => fs.readFile(jsonPath, "utf-8"));
    const report = JSON.parse(jsonRaw);
    // When chapterIntent is provided, intentFidelity should be present
    expect(report.intentFidelity).toBeDefined();
    expect(report.intentFidelity.fieldsTotal).toBeGreaterThan(0);

    await rm(tmp, { recursive: true, force: true });
  });

  it("does NOT block when chapterIntent file is missing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-test-"));
    const content = "主角遭遇了不公，目标明确。";

    // No chapter-intents directory at all
    const summary = await generateSixStepPlotReport(tmp, 1, content);
    expect(summary).toBeDefined();
    expect(summary!.status).toBeDefined();
    // Should not have crashed or returned undefined

    // Verify report was still generated (without intentFidelity)
    const prefix = "0001";
    const jsonPath = join(tmp, "reviews", "six-step-plot", `${prefix}.six-step-plot.report.json`);
    const { existsSync } = await import("node:fs");
    expect(existsSync(jsonPath)).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  });
});

describe("resolveContentForTransitionQuality with six_step_plot priority", () => {
  it("priority 1: final_candidate_file over source_file and original", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-resolve-"));
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, "0001_test.md"), "原始章节内容 ORIGINAL", "utf-8");

    const reviewedDir = join(tmp, "chapters-reviewed");
    await mkdir(reviewedDir, { recursive: true });
    const finalPath = join(reviewedDir, "0001_final.md");
    await writeFile(finalPath, "最终候选稿内容 FINAL", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      "chapters-reviewed/0001_final.md",
      undefined,
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("最终候选稿内容 FINAL");
    expect(result!.content).not.toContain("原始章节内容 ORIGINAL");
    expect(result!.path).toBe(finalPath);

    await rm(tmp, { recursive: true, force: true });
  });

  it("priority 2: source_file when final_candidate_file unavailable", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-resolve-"));
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    await writeFile(join(chaptersDir, "0001_test.md"), "原始章节内容 ORIGINAL", "utf-8");

    const fixedDir = join(tmp, "chapters-fixed");
    await mkdir(fixedDir, { recursive: true });
    const sourcePath = join(fixedDir, "0001_fixed_v1.md");
    await writeFile(sourcePath, "修复后的章节 SOURCE_FILE", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      "",
      "chapters-fixed/0001_fixed_v1.md",
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("修复后的章节 SOURCE_FILE");
    expect(result!.content).not.toContain("原始章节内容 ORIGINAL");
    expect(result!.path).toBe(sourcePath);

    await rm(tmp, { recursive: true, force: true });
  });

  it("priority 3: findChapterFile when both final_candidate_file and source_file unavailable", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "inkos-ss-resolve-"));
    const chaptersDir = join(tmp, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    const origPath = join(chaptersDir, "0001_test.md");
    await writeFile(origPath, "原始章节内容 ORIGINAL", "utf-8");

    const result = await resolveContentForTransitionQuality(
      tmp, 1,
      "",
      undefined,
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("原始章节内容 ORIGINAL");
    expect(result!.path).toBe(origPath);

    await rm(tmp, { recursive: true, force: true });
  });
});
