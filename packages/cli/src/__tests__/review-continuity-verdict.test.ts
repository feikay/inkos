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
  readChapterIndexStatus,
  applyStoryEffectivenessDecision,
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

  it("maps publish-ready quality scores to pass, warning, and blocked decisions", () => {
    expect(decidePublishQuality(85, 85, 75)).toBe("QUALITY_PASS");
    expect(decidePublishQuality(84, 85, 75)).toBe("QUALITY_WARN_POLISH_OPTIONAL");
    expect(decidePublishQuality(80, 85, 75)).toBe("QUALITY_WARN_POLISH_OPTIONAL");
    expect(decidePublishQuality(79, 85, 75)).toBe("NEED_REWRITE");
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
