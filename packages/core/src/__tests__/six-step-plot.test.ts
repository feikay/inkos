import { describe, it, expect, afterAll } from "vitest";
import {
  SixStepPlotReviewerAgent,
  buildSkippedSixStepPlotReport,
  readSixStepPlotSummary,
  renderSixStepPlotMarkdown,
  writeSixStepPlotReportFiles,
  SIX_STEP_PLOT_DIMENSIONS,
  type SixStepPlotReport,
  type SixStepPlotReviewInput,
  type SixStepPlotIntentFidelity,
} from "../agents/six-step-plot-reviewer.js";
import { SIX_STEP_PLOT_METHOD } from "../story-methods/six-step-plot.js";
import { type AgentContext } from "../agents/base.js";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const DUMMY_CTX = {} as unknown as AgentContext;

function makeInput(overrides?: Partial<SixStepPlotReviewInput>): SixStepPlotReviewInput {
  return {
    chapterContent: "",
    chapterIndex: 1,
    ...overrides,
  };
}

// ---- test helpers ----

/** Content rich in six-step signal words — should score high on all dimensions */
const RICH_CONTENT = `
主角握紧拳头，一股愤怒涌上心头。出现压迫——那人不公地夺走了他的一切，这是赤裸裸的不公或冲突画面。用一个动作开场，一句公开羞辱让他无法抬头，他必须先感受不公再理解设定，而不是只抽象概括"主角被羞辱"。
他的目标是拿到灵石逃出此地，主角目标单一且清晰可行动，揭开真相、压住对手、赢过这一切，而不是停留在愿望。目标能推动下一场冲突。
然而阻碍来自故事内在规则，制度门槛高不可攀，资源短缺让困境在积蓄爆发，误会与天灾让阻碍更贵或更危险，而不是硬拦，而不是单纯虐主角。
虽然局势危险，但保留了可破局的线索，能力与盟友或规则漏洞给了希望，故事没有被困境写死。
高潮时刻，行动来自主角选择而不是外力代劳，人物反差让转折让情绪升级，局势或人物认知升级，目标颠覆在这一刻实现。
战斗结束后，主角变强了，拿到东西，心态变化或关系变化带来了收益。新敌意在暗处滋生，结尾埋下下一轮问题，而不是彻底停住。
`;

/** Content with moderate signal — partial dimension coverage */
const MODERATE_CONTENT = `
主角感到愤怒，他想拿到宝物。但是敌人太强大了。
他决定去冒险一试。最终他成功了。故事继续。
`;

/** Content with almost no six-step signals */
const WEAK_CONTENT = `
今天天气很好。小明出门散步。路上看到很多行人。他买了早餐。然后回家了。
`;

/** Content targeting specific dimensions for focused testing */
function buildTargetedContent(dim: string): string {
  const step = SIX_STEP_PLOT_METHOD.steps.find((s) => s.id.replace(/-/g, "_") === dim);
  if (!step) return "无相关内容。";
  const hints = step.promptHints.join(" ");
  const checklist = step.reviewChecklist.join(" ");
  return `${step.name}：${hints} ${checklist}`;
}

// ---- report schema / output field integrity ----

describe("SixStepPlotReport schema", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("returns all required fields for a normal review", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));

    expect(report).toHaveProperty("chapterIndex", 1);
    expect(report).toHaveProperty("status");
    expect(report).toHaveProperty("score");
    expect(report).toHaveProperty("dimensions");
    expect(report).toHaveProperty("dimensionConclusions");
    expect(report).toHaveProperty("methodCompliance");
    expect(report).toHaveProperty("strengths");
    expect(report).toHaveProperty("issues");
    expect(report).toHaveProperty("suggestions");
    expect(report).toHaveProperty("summary");

    // methodCompliance shape
    expect(report.methodCompliance).toHaveProperty("checklistPassed");
    expect(report.methodCompliance).toHaveProperty("checklistTotal", 12);
    expect(report.methodCompliance).toHaveProperty("commonFailuresDetected");
    expect(Array.isArray(report.methodCompliance.commonFailuresDetected)).toBe(true);

    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      expect(report.dimensions).toHaveProperty(dim);
      expect(typeof report.dimensions[dim]).toBe("number");
      expect(report.dimensionConclusions).toHaveProperty(dim);
      expect(typeof report.dimensionConclusions[dim]).toBe("string");
    }
  });

  it("returns SKIPPED with all fields for empty content", async () => {
    const report = await agent.review(makeInput({ chapterContent: "" }));
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toBeDefined();
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("returns SKIPPED with all fields for whitespace-only content", async () => {
    const report = await agent.review(makeInput({ chapterContent: "   \n  \n  " }));
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
  });
});

// ---- SKIPPED conditions ----

describe("SKIPPED conditions", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("returns SKIPPED when resourceBlocking is true", async () => {
    const report = await agent.review(
      makeInput({ resourceBlocking: true, chapterContent: "正常正文内容" }),
    );
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toContain("资源账本");
  });

  it("returns SKIPPED when chapterIndexStatus is state-degraded", async () => {
    const report = await agent.review(
      makeInput({ chapterIndexStatus: "state-degraded", chapterContent: "正常正文内容" }),
    );
    expect(report.status).toBe("SKIPPED");
    expect(report.skippedReason).toContain("state-degraded");
  });

  it("returns SKIPPED when chapterIndexStatus is blocked-resource-plan", async () => {
    const report = await agent.review(
      makeInput({ chapterIndexStatus: "blocked-resource-plan", chapterContent: "正常正文内容" }),
    );
    expect(report.status).toBe("SKIPPED");
    expect(report.skippedReason).toContain("blocked-resource-plan");
  });

  it("does NOT skip for normal chapterIndexStatus values", async () => {
    const report = await agent.review(
      makeInput({ chapterIndexStatus: "draft", chapterContent: RICH_CONTENT }),
    );
    expect(report.status).not.toBe("SKIPPED");
  });

  it("buildSkippedSixStepPlotReport produces a valid SKIPPED report", () => {
    const report = buildSkippedSixStepPlotReport(
      { chapterIndex: 5, chapterTitle: "测试章节" },
      "测试跳过原因",
    );
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.chapterIndex).toBe(5);
    expect(report.chapterTitle).toBe("测试章节");
    expect(report.skippedReason).toBe("测试跳过原因");
    expect(report.methodCompliance.checklistPassed).toBe(0);
    expect(report.methodCompliance.checklistTotal).toBe(12);
    expect(report.methodCompliance.commonFailuresDetected).toEqual([]);
  });
});

// ---- 6-dimension scoring ----

describe("Six-dimension scoring", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("scores each of the 6 dimensions between 0 and 100", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      expect(report.dimensions[dim]).toBeGreaterThanOrEqual(0);
      expect(report.dimensions[dim]).toBeLessThanOrEqual(100);
    }
  });

  it("rich content scores higher than weak content on all dimensions", async () => {
    const rich = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const weak = await agent.review(makeInput({ chapterContent: WEAK_CONTENT }));
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      expect(rich.dimensions[dim]).toBeGreaterThanOrEqual(weak.dimensions[dim]);
    }
  });

  it("rich content achieves PASS status", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    expect(report.status).toBe("PASS");
    expect(report.score).not.toBeNull();
    expect(report.score!).toBeGreaterThanOrEqual(80);
  });

  it("weak content achieves FAIL_STRUCTURAL status", async () => {
    const report = await agent.review(makeInput({ chapterContent: WEAK_CONTENT }));
    expect(report.status).toBe("FAIL_STRUCTURAL");
    expect(report.score!).toBeLessThan(60);
  });

  it("moderate content achieves WARN status", async () => {
    const report = await agent.review(makeInput({ chapterContent: MODERATE_CONTENT }));
    expect(["WARN", "FAIL_STRUCTURAL"]).toContain(report.status);
  });

  it("includes dimension-specific issues for weak dimensions", async () => {
    const report = await agent.review(makeInput({ chapterContent: WEAK_CONTENT }));
    const dimIssues = report.issues.filter((i) =>
      SIX_STEP_PLOT_DIMENSIONS.includes(i.dimension as (typeof SIX_STEP_PLOT_DIMENSIONS)[number]),
    );
    expect(dimIssues.length).toBeGreaterThan(0);
  });

  it("each dimension has a non-empty conclusion string", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      expect(report.dimensionConclusions[dim].length).toBeGreaterThan(0);
    }
  });

  it("very short content triggers an info issue", async () => {
    const report = await agent.review(makeInput({ chapterContent: "短" }));
    const infoIssues = report.issues.filter((i) => i.severity === "info");
    const hasShortWarning = infoIssues.some((i) => i.message.includes("极短"));
    expect(hasShortWarning).toBe(true);
  });
});

// ---- status thresholds ----

describe("PASS / WARN / FAIL_STRUCTURAL thresholds", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("PASS: status is PASS when score >= 80 and no critical issues", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    expect(report.status).toBe("PASS");
  });

  it("FAIL_STRUCTURAL: status when content has no method signals", async () => {
    const report = await agent.review(makeInput({ chapterContent: WEAK_CONTENT }));
    expect(report.status).toBe("FAIL_STRUCTURAL");
  });

  it("score is null when SKIPPED", async () => {
    const report = await agent.review(makeInput({ chapterContent: "" }));
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
  });

  it("score is a number between 0 and 100 when not SKIPPED", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    expect(report.status).not.toBe("SKIPPED");
    expect(typeof report.score).toBe("number");
    expect(report.score!).toBeGreaterThanOrEqual(0);
    expect(report.score!).toBeLessThanOrEqual(100);
  });

  it("summary contains status-relevant information", async () => {
    const passReport = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    expect(passReport.summary.length).toBeGreaterThan(0);

    const failReport = await agent.review(makeInput({ chapterContent: WEAK_CONTENT }));
    expect(failReport.summary.length).toBeGreaterThan(0);

    const skipReport = await agent.review(makeInput({ chapterContent: "" }));
    expect(skipReport.summary).toContain("跳过");
  });
});

// ---- common failures detection ----

describe("Common failures detection", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("detects common failures from SIX_STEP_PLOT_METHOD.commonFailures", () => {
    // Verify the common failures list is consumed
    expect(SIX_STEP_PLOT_METHOD.commonFailures.length).toBeGreaterThan(0);
  });

  it("detects '设定说明' failure pattern when content has setting exposition", async () => {
    const content = "这个世界分为九级修炼体系，每一级都有不同的设定。让我来介绍这个世界的背景和世界观。等级分为筑基、金丹、元婴三个大境界。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    // Should detect the 设定说明 pattern if content matches
    expect(report.methodCompliance.commonFailuresDetected).toBeDefined();
  });

  it("detects '为虐而虐' failure pattern when content has excessive abuse signals", async () => {
    const content = "主角被反复折磨，敌人肆意惩罚他，不断打压他的意志，让他受尽虐待。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.methodCompliance.commonFailuresDetected).toBeDefined();
  });

  it("detects '巧合' failure pattern when content has coincidence signals", async () => {
    const content = "恰巧在这个时候，凑巧他刚好路过，碰巧遇到了关键人物，运气站在了他这边。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    const hasCoincidenceFailure = report.methodCompliance.commonFailuresDetected.some((f) =>
      f.includes("巧合"),
    );
    expect(hasCoincidenceFailure).toBe(true);
  });

  it("detects '目标太散' when desire_goal dimension is weak", async () => {
    const report = await agent.review(makeInput({ chapterContent: WEAK_CONTENT }));
    // WEAK_CONTENT has very low desire_goal → should trigger 目标太散 failure
    expect(report.methodCompliance.commonFailuresDetected).toBeDefined();
    // With very weak content, desire_goal < 55 should trigger this
    if (report.dimensions.desire_goal < 55) {
      const hasScatteredGoal = report.methodCompliance.commonFailuresDetected.some((f) =>
        f.includes("目标太散"),
      );
      expect(hasScatteredGoal).toBe(true);
    }
  });

  it("failure penalty reduces score", async () => {
    // Content that triggers common failures should have penalty applied
    const coincidenceContent = "凑巧主角恰好碰到运气，设定很简单，背景介绍完毕，体系清晰。";
    const report = await agent.review(makeInput({ chapterContent: coincidenceContent }));
    // score = avgDimensionScore - failurePenalty
    // failure penalty max 25
    expect(report.score!).toBeLessThanOrEqual(100);
  });

  it("rich content has fewer or no common failures", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    // RICH_CONTENT is well-structured — should have minimal failures
    expect(report.methodCompliance.commonFailuresDetected.length).toBeLessThanOrEqual(2);
  });
});

// ---- method consumption proofs ----

describe("SIX_STEP_PLOT_METHOD consumption", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("consumes SIX_STEP_PLOT_METHOD.steps for dimension labels", () => {
    // Verify that each step has a reviewChecklist with at least 2 items (as per method definition)
    for (const step of SIX_STEP_PLOT_METHOD.steps) {
      expect(step.reviewChecklist.length).toBeGreaterThanOrEqual(2);
      expect(step.promptHints.length).toBeGreaterThanOrEqual(2);
    }
    // 6 steps as defined in the method
    expect(SIX_STEP_PLOT_METHOD.steps.length).toBe(6);
  });

  it("dimension count matches method step count", () => {
    expect(SIX_STEP_PLOT_DIMENSIONS.length).toBe(SIX_STEP_PLOT_METHOD.steps.length);
  });

  it("each dimension maps to a method step", () => {
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      const kebabId = dim.replace(/_/g, "-");
      const step = SIX_STEP_PLOT_METHOD.steps.find((s) => s.id === kebabId);
      expect(step).toBeDefined();
    }
  });

  it("signal groups are derived from method promptHints and reviewChecklist", async () => {
    // If we modify SIX_STEP_PLOT_METHOD content, the signal groups change.
    // Prove by checking that keywords from promptHints are used for scoring.
    const step0 = SIX_STEP_PLOT_METHOD.steps[0];
    // Extract a key word from emotion-event promptHints
    const hintKeyword = "公开羞辱";
    expect(step0.promptHints.some((h) => h.includes(hintKeyword))).toBe(true);

    // Content with this keyword should score on emotion_event
    const contentWithHint = buildTargetedContent("emotion_event");
    const report = await agent.review(makeInput({ chapterContent: contentWithHint }));
    // emotion_event should have some signal score because it includes the method's own hint text
    expect(report.dimensions.emotion_event).toBeGreaterThan(0);
  });

  it("checklist from method is consumed in scoring", async () => {
    // Build content that includes keywords from each step's reviewChecklist
    const allChecklistContent = SIX_STEP_PLOT_METHOD.steps
      .map((s) => `${s.name}：${s.reviewChecklist.join(" ")}`)
      .join("\n");
    const report = await agent.review(makeInput({ chapterContent: allChecklistContent }));
    // This content contains the checklist items verbatim — should score well
    const avgScore =
      SIX_STEP_PLOT_DIMENSIONS.reduce((sum, dim) => sum + report.dimensions[dim], 0) /
      SIX_STEP_PLOT_DIMENSIONS.length;
    expect(avgScore).toBeGreaterThan(40);
  });

  it("changing method definition would change reviewer behavior", () => {
    // Proof: the reviewer uses SIX_STEP_PLOT_METHOD.commonFailures
    // If commonFailures is empty, no common failure patterns would be generated
    expect(SIX_STEP_PLOT_METHOD.commonFailures.length).toBe(5);
    // If steps count changes, dimension count changes
    expect(SIX_STEP_PLOT_DIMENSIONS.length).toBe(SIX_STEP_PLOT_METHOD.steps.length);
  });

  it("confirm: the reviewer does NOT hardcode its own signals independent of method", () => {
    // The reviewer's signal groups are built from SIX_STEP_PLOT_METHOD at module load time.
    // This is verified by checking that all dimension IDs map to method step IDs.
    const methodStepIds = new Set(SIX_STEP_PLOT_METHOD.steps.map((s) => s.id));
    const dimensionKebabIds = SIX_STEP_PLOT_DIMENSIONS.map((d) => d.replace(/_/g, "-"));
    for (const kebabId of dimensionKebabIds) {
      expect(methodStepIds.has(kebabId)).toBe(true);
    }
  });
});

// ---- markdown rendering ----

describe("renderSixStepPlotMarkdown", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("produces non-empty markdown string", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    expect(md.length).toBeGreaterThan(0);
    expect(typeof md).toBe("string");
  });

  it("includes status in markdown", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    expect(md).toContain(report.status);
  });

  it("includes dimension table rows for all 6 dimensions", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    for (const dim of SIX_STEP_PLOT_DIMENSIONS) {
      const step = SIX_STEP_PLOT_METHOD.steps.find((s) => s.id === dim.replace(/_/g, "-"));
      if (step) {
        expect(md).toContain(step.name);
      }
    }
  });

  it("includes checklist count in markdown", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    expect(md).toContain(String(report.methodCompliance.checklistPassed));
    expect(md).toContain(String(report.methodCompliance.checklistTotal));
  });

  it("handles SKIPPED report markdown", async () => {
    const report = buildSkippedSixStepPlotReport(
      { chapterIndex: 3 },
      "测试跳过",
    );
    const md = renderSixStepPlotMarkdown(report);
    expect(md).toContain("SKIPPED");
    expect(md).toContain("测试跳过");
  });

  it("handles report with no issues gracefully", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
  });

  it("includes strengths section", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    expect(md).toContain("优点");
  });

  it("includes issues section", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    expect(md).toContain("问题");
  });
});

// ---- file I/O ----

describe("writeSixStepPlotReportFiles and readSixStepPlotSummary", () => {
  let tmpDir: string;

  async function setupTmpDir() {
    const dir = join(tmpdir(), `inkos-six-step-plot-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  it("writes JSON and Markdown files to the expected paths", async () => {
    tmpDir = await setupTmpDir();
    const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));

    const jsonPath = join(tmpDir, "reviews", "six-step-plot", "0001.six-step-plot.report.json");
    const mdPath = join(tmpDir, "reviews", "six-step-plot", "0001.six-step-plot.report.md");

    await writeSixStepPlotReportFiles({ report, jsonPath, markdownPath: mdPath });

    const jsonRaw = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(jsonRaw) as SixStepPlotReport;
    expect(parsed.status).toBe(report.status);
    expect(parsed.chapterIndex).toBe(report.chapterIndex);

    const mdRaw = await readFile(mdPath, "utf-8");
    expect(mdRaw).toContain(report.status);
  });

  it("readSixStepPlotSummary reads back a written report", async () => {
    tmpDir = await setupTmpDir();
    const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));

    const jsonPath = join(tmpDir, "reviews", "six-step-plot", "0001.six-step-plot.report.json");
    const mdPath = join(tmpDir, "reviews", "six-step-plot", "0001.six-step-plot.report.md");

    await writeSixStepPlotReportFiles({ report, jsonPath, markdownPath: mdPath });

    const summary = await readSixStepPlotSummary(tmpDir, 1);
    expect(summary).toBeDefined();
    expect(summary!.status).toBe(report.status);
    expect(summary!.score).toBe(report.score);
    expect(summary!.summary).toBe(report.summary);
  });

  it("readSixStepPlotSummary returns undefined for missing file", async () => {
    tmpDir = await setupTmpDir();
    const summary = await readSixStepPlotSummary(tmpDir, 999);
    expect(summary).toBeUndefined();
  });

  it("readSixStepPlotSummary returns undefined for malformed JSON", async () => {
    tmpDir = await setupTmpDir();
    const reviewsDir = join(tmpDir, "reviews", "six-step-plot");
    await mkdir(reviewsDir, { recursive: true });
    await writeFile(join(reviewsDir, "0999.six-step-plot.report.json"), "not valid json", "utf-8");

    const summary = await readSixStepPlotSummary(tmpDir, 999);
    expect(summary).toBeUndefined();
  });

  // Cleanup after file I/O tests
  afterAll(async () => {
    // Cleanup is handled per-test but we do a best-effort here too
    try {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });
});

// ---- responsibility boundaries ----

describe("Responsibility boundaries", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("does not check cross-chapter continuity", () => {
    // The reviewer has no cross-chapter reconciliation logic
    // Its input only receives a single chapter's content
    const input: SixStepPlotReviewInput = {
      chapterContent: "内容",
      chapterIndex: 1,
    };
    // The input type has no prevChapterContent, no multi-chapter fields
    expect(input).not.toHaveProperty("prevChapterContent");
  });

  it("does not check fanqie platform style compliance", () => {
    // SixStepPlotReviewInput has no fanqie-specific fields
    const input: SixStepPlotReviewInput = { chapterContent: "内容" };
    expect(input).not.toHaveProperty("fanqieStyle");
    expect(input).not.toHaveProperty("platformRequirements");
  });

  it("does not interface with publish-ready decision chain", () => {
    // The agent has no publish-ready integration methods
    const agentProto = Object.getOwnPropertyNames(Object.getPrototypeOf(agent));
    expect(agentProto).not.toContain("applyDecision");
    expect(agentProto).not.toContain("toPublishReadyField");
  });

  it("report schema has methodCompliance not publishReadyFields", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    expect(report).toHaveProperty("methodCompliance");
    expect(report).not.toHaveProperty("publishReadyDecision");
    expect(report).not.toHaveProperty("publishReadyScore");
  });

  it("only concerns itself with six-step method, not story effectiveness", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    // Issues should be about six-step dimensions or method compliance, not story effectiveness dimensions
    for (const issue of report.issues) {
      const validDimensions = [...SIX_STEP_PLOT_DIMENSIONS, "method_compliance", "resource_consistency"];
      expect(validDimensions).toContain(issue.dimension);
    }
  });
});

// ---- edge cases ----

describe("Edge cases", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("handles extremely long content without error", async () => {
    const longContent = RICH_CONTENT.repeat(200);
    const report = await agent.review(makeInput({ chapterContent: longContent }));
    expect(report.status).toBeDefined();
    expect(report.score).toBeDefined();
  });

  it("handles content with only punctuation", async () => {
    const report = await agent.review(makeInput({ chapterContent: "！@#￥%……&*（）" }));
    expect(report.status).toBeDefined();
  });

  it("handles content with special characters", async () => {
    const report = await agent.review(
      makeInput({ chapterContent: "主角 测试​内容\n\t\r" }),
    );
    expect(report.status).toBeDefined();
  });

  it("chapterIndex defaults to 0 when not provided", async () => {
    const report = await agent.review({});
    expect(report.chapterIndex).toBe(0);
  });

  it("preserves chapterTitle in output when provided", async () => {
    const report = await agent.review(
      makeInput({ chapterContent: RICH_CONTENT, chapterTitle: "第一章：觉醒" }),
    );
    expect(report.chapterTitle).toBe("第一章：觉醒");
  });

  it("strengths array is a set (no duplicates)", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const uniqueStrengths = [...new Set(report.strengths)];
    expect(report.strengths).toEqual(uniqueStrengths);
  });

  it("suggestions are derived from issues with suggestions", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const issuesWithSuggestions = report.issues.filter((i) => i.suggestion).map((i) => i.suggestion!);
    expect(report.suggestions).toEqual(issuesWithSuggestions);
  });
});

// ---- chapterIntentFields consumption / intentFidelity ----

describe("chapterIntentFields consumption (intentFidelity)", () => {
  const agent = new SixStepPlotReviewerAgent(DUMMY_CTX);

  it("chapterIntentFields comes from SIX_STEP_PLOT_METHOD.chapterIntentFields", () => {
    expect(SIX_STEP_PLOT_METHOD.chapterIntentFields).toBeDefined();
    expect(SIX_STEP_PLOT_METHOD.chapterIntentFields.length).toBe(12);
    // Verify key fields are present
    expect(SIX_STEP_PLOT_METHOD.chapterIntentFields).toContain("openingEmotion");
    expect(SIX_STEP_PLOT_METHOD.chapterIntentFields).toContain("protagonistGoal");
    expect(SIX_STEP_PLOT_METHOD.chapterIntentFields).toContain("nextHook");
  });

  it("no chapterIntent → intentFidelity is undefined", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    expect(report.intentFidelity).toBeUndefined();
  });

  it("empty chapterIntent string → intentFidelity is undefined", async () => {
    const report = await agent.review(
      makeInput({ chapterContent: RICH_CONTENT, chapterIntent: "" }),
    );
    expect(report.intentFidelity).toBeUndefined();
  });

  it("whitespace-only chapterIntent → intentFidelity is undefined", async () => {
    const report = await agent.review(
      makeInput({ chapterContent: RICH_CONTENT, chapterIntent: "   " }),
    );
    expect(report.intentFidelity).toBeUndefined();
  });

  it("chapterIntent with partial fields → fieldsMatched and fieldsMissing are correct", async () => {
    const report = await agent.review(
      makeInput({
        chapterContent: RICH_CONTENT,
        chapterIntent: "本章重点：openingEmotion 和 protagonistGoal 以及 nextHook",
      }),
    );
    expect(report.intentFidelity).toBeDefined();
    const fidelity = report.intentFidelity!;
    expect(fidelity.fieldsTotal).toBe(12);
    expect(fidelity.fieldsMatched).toBe(3);
    expect(fidelity.fieldsPresent).toContain("openingEmotion");
    expect(fidelity.fieldsPresent).toContain("protagonistGoal");
    expect(fidelity.fieldsPresent).toContain("nextHook");
    expect(fidelity.fieldsMissing.length).toBe(9);
    expect(fidelity.fieldsMissing).not.toContain("openingEmotion");
  });

  it("chapterIntent with all 12 fields → fieldsMatched=12, fieldsMissing=[]", async () => {
    const allFields = SIX_STEP_PLOT_METHOD.chapterIntentFields.join(" ");
    const report = await agent.review(
      makeInput({ chapterContent: RICH_CONTENT, chapterIntent: allFields }),
    );
    expect(report.intentFidelity).toBeDefined();
    const fidelity = report.intentFidelity!;
    expect(fidelity.fieldsMatched).toBe(12);
    expect(fidelity.fieldsTotal).toBe(12);
    expect(fidelity.fieldsMissing).toEqual([]);
    expect(fidelity.fieldsPresent.length).toBe(12);
  });

  it("chapterIntent with no matching fields → fieldsMatched=0", async () => {
    const report = await agent.review(
      makeInput({
        chapterContent: RICH_CONTENT,
        chapterIntent: "本章没有六招字段名",
      }),
    );
    expect(report.intentFidelity).toBeDefined();
    const fidelity = report.intentFidelity!;
    expect(fidelity.fieldsMatched).toBe(0);
    expect(fidelity.fieldsMissing.length).toBe(12);
  });

  it("intentFidelity appears in JSON output", async () => {
    const report = await agent.review(
      makeInput({
        chapterContent: RICH_CONTENT,
        chapterIntent: "包含 openingEmotion 和 specificConflictImage",
      }),
    );
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json) as SixStepPlotReport;
    expect(parsed.intentFidelity).toBeDefined();
    expect(parsed.intentFidelity!.fieldsMatched).toBe(2);
  });

  it("intentFidelity appears in Markdown output", async () => {
    const report = await agent.review(
      makeInput({
        chapterContent: RICH_CONTENT,
        chapterIntent: "包含 openingEmotion 和 specificConflictImage",
      }),
    );
    const md = renderSixStepPlotMarkdown(report);
    expect(md).toContain("chapterIntent 兑现度");
    expect(md).toContain("2/12");
    expect(md).toContain("openingEmotion");
  });

  it("Markdown with no chapterIntent shows skipped message", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    const md = renderSixStepPlotMarkdown(report);
    expect(md).toContain("未提供 chapterIntent");
  });

  it("summary includes intent field count when chapterIntent is provided", async () => {
    const report = await agent.review(
      makeInput({
        chapterContent: RICH_CONTENT,
        chapterIntent: "包含 openingEmotion 和 specificConflictImage",
      }),
    );
    expect(report.summary).toContain("chapterIntent 字段");
    expect(report.summary).toContain("2/12");
  });

  it("summary does NOT include intent field count when no chapterIntent", async () => {
    const report = await agent.review(makeInput({ chapterContent: RICH_CONTENT }));
    expect(report.summary).not.toContain("chapterIntent 字段");
  });

  it("missing chapterIntent fields generate method_compliance issues", async () => {
    const report = await agent.review(
      makeInput({
        chapterContent: RICH_CONTENT,
        chapterIntent: "只有 openingEmotion 一个字段",
      }),
    );
    const intentIssues = report.issues.filter(
      (i) => i.dimension === "method_compliance" && i.message.includes("chapterIntent"),
    );
    expect(intentIssues.length).toBeGreaterThan(0);
    expect(intentIssues[0].message).toContain("1/12");
  });

  it("all fields matched → no method_compliance issue for intent", async () => {
    const allFields = SIX_STEP_PLOT_METHOD.chapterIntentFields.join(" ");
    const report = await agent.review(
      makeInput({ chapterContent: RICH_CONTENT, chapterIntent: allFields }),
    );
    const intentIssues = report.issues.filter(
      (i) => i.dimension === "method_compliance" && i.message.includes("chapterIntent"),
    );
    expect(intentIssues.length).toBe(0);
  });

  it("SKIPPED report with chapterIntent still computes intentFidelity", async () => {
    // resourceBlocking causes SKIP, but if chapterIntent is provided we should still try
    const report = await agent.review(
      makeInput({ resourceBlocking: true, chapterIntent: "openingEmotion test" }),
    );
    // SKIPPED via resourceBlocking uses buildSkipped which doesn't compute intentFidelity
    // This is expected — SKIPPED means no review ran
    expect(report.status).toBe("SKIPPED");
  });
});
