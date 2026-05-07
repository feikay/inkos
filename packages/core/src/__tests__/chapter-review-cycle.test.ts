import { describe, expect, it, vi } from "vitest";
import { runChapterReviewCycle } from "../pipeline/chapter-review-cycle.js";
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { LengthSpec } from "../models/length-governance.js";
import { evaluateMoodCadenceCompliance } from "../agents/post-write-validator.js";

const LENGTH_SPEC: LengthSpec = {
  target: 220,
  softMin: 190,
  softMax: 250,
  hardMin: 160,
  hardMax: 280,
  countingMode: "zh_chars",
  normalizeMode: "none",
};

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createAuditResult(overrides?: Partial<AuditResult>): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "clean",
    ...overrides,
  };
}

describe("runChapterReviewCycle", () => {
  it("applies post-write spot-fix before the first audit pass", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "fixed draft",
      wordCount: 10,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: "fixed draft",
        wordCount: 10,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        content: "raw draft",
        wordCount: 9,
        postWriteErrors: [{
          rule: "paragraph-shape",
          description: "too fragmented",
          suggestion: "merge short fragments",
          severity: "error",
        }],
        postWriteWarnings: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "fixed draft",
      1,
      "xuanhuan",
      undefined,
    );
    expect(result.finalContent).toBe("fixed draft");
    expect(result.revised).toBe(true);
  });

  it("rejects a short spot-fix candidate instead of treating it as a whole chapter", async () => {
    const originalDraft = "原稿".repeat(120);
    const partialPatch = "PATCH: 只替换一小段";
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: partialPatch,
      wordCount: partialPatch.length,
      fixedIssues: [],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn(async (content: string) => ({
      content,
      wordCount: content.length,
      applied: false,
      tokenUsage: ZERO_USAGE,
    }));
    const rewriteDecisions: string[] = [];

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        content: originalDraft,
        wordCount: originalDraft.length,
        postWriteErrors: [{
          rule: "payoff-missing",
          description: "missing promised payoff",
          suggestion: "target the payoff beat",
          severity: "error",
        }],
        postWriteWarnings: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
      minWholeChapterWords: 100,
      logRewriteDecision: (message) => {
        rewriteDecisions.push(message.en);
      },
    });

    expect(result.finalContent).toBe(originalDraft);
    expect(result.revised).toBe(false);
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      originalDraft,
      1,
      "xuanhuan",
      undefined,
    );
    expect(rewriteDecisions.join("\n")).toContain("accepted=false");
    expect(rewriteDecisions.join("\n")).toContain("rejectedReason=");
  });

  it("drops auto-revision when it increases AI tells and re-audits the original draft", async () => {
    const failingAudit = createAuditResult({
      passed: false,
      issues: [{
        severity: "critical",
        category: "continuity",
        description: "broken continuity",
        suggestion: "fix it",
      }],
      summary: "bad",
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(failingAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "rewritten draft",
      wordCount: 15,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "rewritten draft",
        wordCount: 15,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const analyzeAITells = vi.fn((content: string) => ({
      issues: content === "rewritten draft"
        ? [{ severity: "warning", category: "ai", description: "more ai", suggestion: "reduce" } satisfies AuditIssue]
        : [],
    }));

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: {
        content: "original draft",
        wordCount: 13,
        postWriteErrors: [],
        postWriteWarnings: [],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells,
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenNthCalledWith(1, "/tmp/book", "original draft", 1, "xuanhuan", undefined);
    expect(auditChapter).toHaveBeenNthCalledWith(2, "/tmp/book", "original draft", 1, "xuanhuan", { temperature: 0 });
    expect(result.finalContent).toBe("original draft");
    expect(result.revised).toBe(false);
  });

  it("routes cadence-directive-violation warnings into the existing pre-audit spot-fix", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "escalated draft",
      wordCount: 14,
      fixedIssues: ["reshaped scene skeleton"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: "escalated draft",
        wordCount: 14,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 10,
      initialOutput: {
        content: "warm breathing draft",
        wordCount: 20,
        postWriteErrors: [],
        postWriteWarnings: [{
          rule: "cadence-directive-violation",
          description: "The chapter ignores the forced cadence directive and still reads like a breathing beat instead of escalation / confrontation / discovery-under-threat.",
          suggestion: "Rewrite the scene skeleton toward escalation, confrontation, or discovery under threat while keeping the chapter facts.",
          severity: "warning",
        }],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(reviseChapter.mock.calls[0]?.[3]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "cadence-directive-violation",
      }),
    ]));
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "escalated draft",
      10,
      "xuanhuan",
      undefined,
    );
    expect(result.finalContent).toBe("escalated draft");
    expect(result.revised).toBe(true);
  });

  it("routes ending-isomorphism warnings into the existing pre-audit spot-fix", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "reframed ending draft",
      wordCount: 16,
      fixedIssues: ["rewrote the closing beat"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: "reframed ending draft",
        wordCount: 16,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 16,
      initialOutput: {
        content: "templated ending draft",
        wordCount: 24,
        postWriteErrors: [],
        postWriteWarnings: [{
          rule: "ending-isomorphism",
          description: "章尾收束方式与最近章节过于同构。",
          suggestion: "只重写结尾段，保留章节事实，并轮换结尾模式。",
          severity: "warning",
        }],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(reviseChapter.mock.calls[0]?.[3]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "ending-isomorphism",
      }),
    ]));
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "reframed ending draft",
      16,
      "xuanhuan",
      undefined,
    );
    expect(result.finalContent).toBe("reframed ending draft");
    expect(result.revised).toBe(true);
  });

  it("routes mood-cadence-violation warnings into the existing pre-audit spot-fix", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "camp-rest draft with healing and road talk",
      wordCount: 21,
      fixedIssues: ["inserted a breathing beat and reduced combat density"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: "camp-rest draft with healing and road talk",
        wordCount: 21,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 22,
      initialOutput: {
        content: "combat-heavy draft",
        wordCount: 20,
        postWriteErrors: [],
        postWriteWarnings: [{
          rule: "mood-cadence-violation",
          description: "本章没有兑现降调 mood directive，整体仍然更像高压对抗/战斗主导。",
          suggestion: "只重写局部场景层，保留章节事实；补入至少 1 段扎营、疗伤、路途交谈、轻松互动或人物关系推进场景，并降低战斗密度，避免让高压对抗继续主导整章。",
          severity: "warning",
        }],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(reviseChapter.mock.calls[0]?.[3]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "mood-cadence-violation",
        suggestion: expect.stringContaining("疗伤"),
      }),
    ]));
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "camp-rest draft with healing and road talk",
      22,
      "xuanhuan",
      undefined,
    );
    expect(result.finalContent).toBe("camp-rest draft with healing and road talk");
    expect(result.revised).toBe(true);
  });

  it("rechecks mood cadence after spot-fix and the inserted breathing scene clears the violation", async () => {
    const chapterIntent = [
      "# Chapter Intent",
      "",
      "## Structured Directives",
      "- mood:",
      "  - targetMode: breath",
      "  - requiredSceneQuota: 1",
      "  - forbidDominantMode: combat-heavy",
      "  - note: 最近连续数章都在高压对抗，本章必须降调——至少安排 1 段日常/喘息/温情/幽默场景。",
    ].join("\n");
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: [
        "[Scene1]",
        "楚夜和云岚退到断壁后，先扎营疗伤，把火生小，慢慢分了热汤和干粮。",
        "",
        "[Scene2]",
        "两人低声把接下来的路途计划重新说透，云岚难得接了一句玩笑，气氛从先前的血腥里缓下来。",
        "",
        "[Scene3]",
        "休整之后，他们才沿着断壁继续前推，只保留一点低强度警惕。",
      ].join("\n"),
      wordCount: 57,
      fixedIssues: ["inserted a breathing beat"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: [
          "[Scene1]",
          "楚夜和云岚退到断壁后，先扎营疗伤，把火生小，慢慢分了热汤和干粮。",
          "",
          "[Scene2]",
          "两人低声把接下来的路途计划重新说透，云岚难得接了一句玩笑，气氛从先前的血腥里缓下来。",
          "",
          "[Scene3]",
          "休整之后，他们才沿着断壁继续前推，只保留一点低强度警惕。",
        ].join("\n"),
        wordCount: 57,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 22,
      initialOutput: {
        content: "楚夜和追兵持续血战，整章都在高压对抗。",
        wordCount: 20,
        postWriteErrors: [],
        postWriteWarnings: [{
          rule: "mood-cadence-violation",
          description: "本章没有兑现降调 mood directive，整体仍然更像高压对抗/战斗主导。",
          suggestion: "只重写局部场景层，保留章节事实；补入至少 1 段扎营、疗伤、路途交谈、轻松互动或人物关系推进场景，并降低战斗密度，避免让高压对抗继续主导整章。",
          severity: "warning",
        }],
      },
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: {
        chapterIntent,
        contextPackage: { chapter: 22, selectedContext: [] },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: { hard: [], soft: [], diagnostic: [] },
          overrideEdges: [],
          activeOverrides: [],
        },
      },
      initialUsage: ZERO_USAGE,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    const moodCheck = evaluateMoodCadenceCompliance(result.finalContent, chapterIntent);
    expect(result.finalContent).toContain("扎营疗伤");
    expect(result.finalContent).toContain("玩笑");
    expect(moodCheck?.matched).toBe(true);
  });
});
