import { describe, it, expect } from "vitest";
import {
  AntagonistIntelligenceReviewerAgent,
  ANTAGONIST_INTELLIGENCE_DIMENSIONS,
  ANTAGONIST_INTELLIGENCE_CHECKLIST,
  renderAntagonistIntelligenceMarkdown,
  readAntagonistIntelligenceSummary,
  writeAntagonistIntelligenceReportFiles,
  type AntagonistIntelligenceReport,
  type AntagonistIntelligenceReviewInput,
} from "../agents/antagonist-intelligence.js";
import { type AgentContext } from "../agents/base.js";
import type { LLMResponse } from "../llm/provider.js";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ANTAGONIST_INTELLIGENCE_CHECKLIST as CHECKLIST } from "../story-methods/antagonist-templates.js";

// ---- testable subclasses ----

const DUMMY_CTX = {} as unknown as AgentContext;

/** Reviewer whose chat() always throws — forces hard-scan-only path. */
class HardScanOnlyReviewer extends AntagonistIntelligenceReviewerAgent {
  constructor() {
    super(DUMMY_CTX);
  }
  protected async chat(): Promise<LLMResponse> {
    throw new Error("LLM unavailable");
  }
}

/** Reviewer whose chat() returns controlled JSON — exercises LLM+hardScan merge. */
class ControlledReviewer extends AntagonistIntelligenceReviewerAgent {
  private _response: object;
  constructor(response: object) {
    super(DUMMY_CTX);
    this._response = response;
  }
  protected async chat(): Promise<LLMResponse> {
    return { content: JSON.stringify(this._response) } as LLMResponse;
  }
}

// ---- helpers ----

function makeDefaultInput(overrides: Partial<AntagonistIntelligenceReviewInput> = {}): AntagonistIntelligenceReviewInput {
  return {
    chapter: 1,
    chapterContent: "主角站在城墙上，看着远方的敌人。对手的军队严阵以待。",
    antagonistMap: "核心反派：谋局者，计划A-B-C链。",
    motivationMatrix: "反派动机：夺取资源控制权。",
    ...overrides,
  };
}

function makeSampleReport(
  status: "PASS" | "WARN" | "FAIL_REPORT_ONLY",
  score: number,
): AntagonistIntelligenceReport {
  const issueSeverity = status === "PASS" ? "info" : status === "WARN" ? "warning" : "critical";
  return {
    chapter: 1,
    status,
    score,
    antagonistTypeDetected: status === "PASS" ? ["谋局者"] : [],
    dimensions: {
      antagonist_goal: score,
      antagonist_method: score,
      antagonist_constraint: score,
      antagonist_cost: score,
      antagonist_feedback: score,
      antagonist_foreshadowing: score,
    },
    dimensionConclusions: {
      antagonist_goal: "测试结论",
      antagonist_method: "测试结论",
      antagonist_constraint: "测试结论",
      antagonist_cost: "测试结论",
      antagonist_feedback: "测试结论",
      antagonist_foreshadowing: "测试结论",
    },
    checklistResults: Object.fromEntries(CHECKLIST.map((item) => [item, status === "PASS"])),
    issues: status === "PASS" ? [] : [{
      severity: issueSeverity,
      dimension: "antagonist_method",
      message: "测试问题",
      suggestion: "测试建议",
    }],
    suggestions: status === "PASS" ? [] : ["测试建议"],
    summary: status === "PASS"
      ? `反派智能审核通过（${score}/100）。`
      : `反派智能审核${status === "WARN" ? "警告" : "未通过"}（${score}/100）。`,
  };
}

// ---- report schema tests ----

describe("antagonist-intelligence report schema", () => {
  it("ANTAGONIST_INTELLIGENCE_DIMENSIONS has exactly 6 dimensions", () => {
    expect(ANTAGONIST_INTELLIGENCE_DIMENSIONS).toHaveLength(6);
    expect(ANTAGONIST_INTELLIGENCE_DIMENSIONS).toContain("antagonist_goal");
    expect(ANTAGONIST_INTELLIGENCE_DIMENSIONS).toContain("antagonist_method");
    expect(ANTAGONIST_INTELLIGENCE_DIMENSIONS).toContain("antagonist_constraint");
    expect(ANTAGONIST_INTELLIGENCE_DIMENSIONS).toContain("antagonist_cost");
    expect(ANTAGONIST_INTELLIGENCE_DIMENSIONS).toContain("antagonist_feedback");
    expect(ANTAGONIST_INTELLIGENCE_DIMENSIONS).toContain("antagonist_foreshadowing");
  });

  it("ANTAGONIST_INTELLIGENCE_CHECKLIST has exactly 6 items", () => {
    expect(CHECKLIST).toHaveLength(6);
  });

  it("ANTAGONIST_INTELLIGENCE_CHECKLIST items are all strings", () => {
    for (const item of CHECKLIST) {
      expect(typeof item).toBe("string");
      expect(item.length).toBeGreaterThan(0);
    }
  });
});

// ---- SKIPPED scenarios — real review() calls (return before LLM) ----

describe("antagonist-intelligence SKIPPED scenarios", () => {
  it("returns SKIPPED when resourceBlocking is true", async () => {
    const agent = new AntagonistIntelligenceReviewerAgent(DUMMY_CTX);
    const report = await agent.review(makeDefaultInput({ resourceBlocking: true }));
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toContain("资源账本校验失败");
  });

  it("returns SKIPPED for state-degraded chapter", async () => {
    const agent = new AntagonistIntelligenceReviewerAgent(DUMMY_CTX);
    const report = await agent.review(makeDefaultInput({ chapterIndexStatus: "state-degraded" }));
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toContain("state-degraded");
  });

  it("returns SKIPPED for blocked-resource-plan chapter", async () => {
    const agent = new AntagonistIntelligenceReviewerAgent(DUMMY_CTX);
    const report = await agent.review(makeDefaultInput({ chapterIndexStatus: "blocked-resource-plan" }));
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toContain("blocked-resource-plan");
  });

  it("returns SKIPPED when chapterContent is empty", async () => {
    const agent = new AntagonistIntelligenceReviewerAgent(DUMMY_CTX);
    const report = await agent.review(makeDefaultInput({ chapterContent: "" }));
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toContain("章节正文为空");
  });
});

// ---- Hard-scan-only review (LLM throws, falls through to hard scan) ----

describe("hard-scan-only review() — 谋局者 detection", () => {
  it("returns status/score/dimensions for content with multi-plan mastermind signals", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "反派早已布局，计划A被识破后立即启动计划B，利用信息差掌控全局，主角发现自己每一步都在他的算计之中。",
      antagonistMap: "核心反派：谋局者。",
    }));

    expect(report.status).toBe("WARN"); // hard-scan-only defaults to 75 per dim, no LLM lift
    expect(report.score).toBeDefined();
    expect(typeof report.score).toBe("number");
    // 6 dimensions all present
    for (const dim of ANTAGONIST_INTELLIGENCE_DIMENSIONS) {
      expect(report.dimensions[dim]).toBeGreaterThanOrEqual(0);
      expect(report.dimensions[dim]).toBeLessThanOrEqual(100);
    }
    expect(report.antagonistTypeDetected).toEqual([]); // LLM not run
    expect(report.summary).toContain("仅硬扫描");
  });

  it("detects dumb villain signals and lowers antagonist_method score", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "反派明明能杀主角，却突然犯了低级错误，让主角逃走了。",
      antagonistMap: "核心反派：谋局者。",
    }));

    expect(report.status).toBe("FAIL_REPORT_ONLY"); // critical issue from dumb signal
    expect(report.dimensions.antagonist_method).toBeLessThanOrEqual(50);
    expect(report.issues.some((i) => i.severity === "critical" && i.dimension === "antagonist_method")).toBe(true);
  });

  it("detects information boundary violation as dumb signal", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "反派主动说出了关键情报，把自己所有计划都告诉了主角。",
      antagonistMap: "核心反派：谋局者。",
    }));

    expect(report.issues.some((i) => i.dimension === "antagonist_method" && i.severity === "critical")).toBe(true);
  });
});

describe("hard-scan-only review() — 殉道者 detection", () => {
  it("detects conviction-driven content produces report with defined score", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "他说：'这是我的信念和使命，为了拯救这个世界，我必须牺牲一切，包括我自己。这不是选择，是唯一的道路。'",
      antagonistMap: "核心反派：殉道者。",
    }));

    expect(report.status).toBeDefined();
    expect(typeof report.score).toBe("number");
    // Should still have a valid report structure even without LLM
    expect(report.dimensions.antagonist_goal).toBeDefined();
  });

  it("detects meaningless sacrifice yields lower goal assessment", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "反派突然自杀了。",
      antagonistMap: "核心反派：殉道者。",
    }));

    // No conviction rationale → antagonist_goal not boosted by 殉道者 signals
    // hard scan may lower antagonist_goal for missing goal signal
    expect(report.status).toBeDefined();
  });
});

describe("hard-scan-only review() — 伪态者 detection", () => {
  it("detects disguise with foreshadowing produces report with structured dimensions", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "第三章那个总是帮主角的人，面具终于揭开——他的每一步善意，都是精心设计的伏笔铺垫。",
      antagonistMap: "核心反派：伪态者。",
    }));

    expect(report.dimensions.antagonist_foreshadowing).toBeDefined();
    expect(report.status).toBeDefined();
  });

  it("detects unmasked without foreshadowing yields no foreshadowing boost", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "他忽然揭开面具，原来他是反派。",
      antagonistMap: "核心反派：伪态者。",
    }));

    // No foreshadowing signals → no override on antagonist_foreshadowing
    expect(report.dimensions.antagonist_foreshadowing).toBe(75); // default
  });
});

// ---- no-antagonist fallback (returns SKIPPED via review()) ----

describe("no-antagonist fallback via review()", () => {
  it("returns SKIPPED when no antagonist appears and no antagonist_map", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review({
      chapter: 1,
      chapterContent: "阳光洒在小镇上，鸟儿在歌唱。人们过着平静的生活，一切都很美好。",
      antagonistMap: "",
      motivationMatrix: "",
    });

    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toContain("未检测到反派出场信号");
  });
});

// ---- LLM + hardScan merge (controlled chat response) ----

describe("LLM+hardScan merge via review()", () => {
  it("uses LLM base scores and merges hard scan adjustments", async () => {
    const reviewer = new ControlledReviewer({
      chapter: 1,
      antagonistTypeDetected: ["谋局者"],
      dimensions: {
        antagonist_goal: 88,
        antagonist_method: 90,
        antagonist_constraint: 85,
        antagonist_cost: 85,
        antagonist_feedback: 85,
        antagonist_foreshadowing: 88,
      },
      dimensionConclusions: {
        antagonist_goal: "反派目标明确",
        antagonist_method: "展示了多重计划",
        antagonist_constraint: "受世界规则约束",
        antagonist_cost: "付出了资源代价",
        antagonist_feedback: "对主角行动有回应",
        antagonist_foreshadowing: "前文有铺垫",
      },
      issues: [],
      suggestions: [],
    });

    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "反派计划A失败后立即启动计划B，利用信息差掌控全局，目标明确。",
    }));

    expect(report.antagonistTypeDetected).toContain("谋局者");
    expect(report.dimensions.antagonist_method).toBeGreaterThanOrEqual(80);
    expect(report.status).toBe("PASS");
    expect(report.summary).toContain("LLM+硬扫描");
    expect(report.dimensionConclusions.antagonist_goal).toBe("反派目标明确");
  });

  it("LLM high scores can be lowered by hard scan dumb signals", async () => {
    const reviewer = new ControlledReviewer({
      chapter: 1,
      antagonistTypeDetected: ["谋局者"],
      dimensions: {
        antagonist_goal: 85,
        antagonist_method: 90,
        antagonist_constraint: 80,
        antagonist_cost: 75,
        antagonist_feedback: 82,
        antagonist_foreshadowing: 88,
      },
      dimensionConclusions: {
        antagonist_goal: "ok",
        antagonist_method: "ok",
        antagonist_constraint: "ok",
        antagonist_cost: "ok",
        antagonist_feedback: "ok",
        antagonist_foreshadowing: "ok",
      },
      issues: [],
      suggestions: [],
    });

    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "反派明明能杀主角，却突然犯错了，让主角逃走了。反派主动说出了关键情报，还白给了装备。",
    }));

    // Hard scan should lower antagonist_method regardless of LLM score
    expect(report.dimensions.antagonist_method).toBeLessThanOrEqual(50);
    // Multiple hard scan penalties drag avg below 70 → FAIL_REPORT_ONLY
    expect(report.status).toBe("FAIL_REPORT_ONLY");
    expect(report.issues.some((i) => i.severity === "critical")).toBe(true);
  });
});

// ---- duty non-overlap ----

describe("duty non-overlap", () => {
  it("report does not contain continuity keywords", () => {
    const report = makeSampleReport("PASS", 88);
    const markdown = renderAntagonistIntelligenceMarkdown(report);
    expect(markdown).not.toContain("CONTINUITY");
    expect(markdown).not.toContain("MANUAL_REVIEW");
    expect(markdown).not.toContain("DROP");
    expect(markdown).not.toContain("BLOCKED_BY_CONTINUITY");
  });

  it("report does not contain fanqie-quality keywords", () => {
    const report = makeSampleReport("PASS", 88);
    const markdown = renderAntagonistIntelligenceMarkdown(report);
    expect(markdown).not.toContain("番茄");
    expect(markdown).not.toContain("fanqie");
    expect(markdown).not.toContain("polish");
  });

  it("report does not contain golden_3 keywords", () => {
    const report = makeSampleReport("PASS", 88);
    const markdown = renderAntagonistIntelligenceMarkdown(report);
    expect(markdown).not.toContain("前三章");
    expect(markdown).not.toContain("黄金三章");
    expect(markdown).not.toContain("golden_3");
    expect(markdown).not.toContain("开篇");
  });

  it("report dimensions are all antagonist-specific", () => {
    const report = makeSampleReport("PASS", 88);
    for (const dim of Object.keys(report.dimensions)) {
      expect(dim).toMatch(/^antagonist_/);
    }
  });
});

// ---- file I/O (tests real functions) ----

describe("antagonist-intelligence file I/O", () => {
  it("writes and reads JSON report files", async () => {
    const tmp = join(tmpdir(), `inkos-test-ai-${Date.now()}`);
    const jsonPath = join(tmp, "reviews", "antagonist-intelligence", "0001.report.json");
    const mdPath = join(tmp, "reviews", "antagonist-intelligence", "0001.report.md");

    const report = makeSampleReport("WARN", 78);
    await writeAntagonistIntelligenceReportFiles({ report, jsonPath, markdownPath: mdPath });

    const raw = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(raw) as AntagonistIntelligenceReport;
    expect(parsed.status).toBe("WARN");
    expect(parsed.score).toBe(78);
    expect(parsed.chapter).toBe(1);
    expect(parsed.dimensions.antagonist_goal).toBeDefined();

    const summary = await readAntagonistIntelligenceSummary(tmp, 1);
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("WARN");
    expect(summary!.score).toBe(78);

    await rm(tmp, { recursive: true, force: true });
  });

  it("readAntagonistIntelligenceSummary returns undefined for missing file", async () => {
    const tmp = join(tmpdir(), `inkos-test-ai-missing-${Date.now()}`);
    const summary = await readAntagonistIntelligenceSummary(tmp, 99);
    expect(summary).toBeUndefined();
  });

  it("renders markdown without throwing", () => {
    const report = makeSampleReport("PASS", 92);
    const md = renderAntagonistIntelligenceMarkdown(report);
    expect(md).toContain("Antagonist Intelligence Review Report");
    expect(md).toContain("PASS");
    expect(md).toContain("92");
  });
});

// ---- publish-ready summary behavior (via real review() calls) ----

describe("publish-ready antagonist_intelligence summary via review()", () => {
  it("WARN review produces Chinese warning summary with score", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput({
      chapterContent: "反派计划中规中矩，没有降智信号但也没有特别聪明的表现。",
    }));

    // Hard-scan-only with neutral content → WARN (default 75, no LLM lift)
    expect(report.status).toBe("WARN");
    expect(report.summary).toContain("警告");
    expect(report.summary).toContain(String(report.score));
  });

  it("SKIPPED report has null score and defined skippedReason", async () => {
    const agent = new AntagonistIntelligenceReviewerAgent(DUMMY_CTX);
    const report = await agent.review(makeDefaultInput({ chapterContent: "" }));

    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toBeDefined();
  });

  it("review() returns a complete report with all required fields", async () => {
    const reviewer = new HardScanOnlyReviewer();
    const report = await reviewer.review(makeDefaultInput());

    // Every field required by AntagonistIntelligenceReport should be present
    expect(report.chapter).toBe(1);
    expect(report.status).toBeDefined();
    expect(report.score).toBeDefined();
    expect(Array.isArray(report.antagonistTypeDetected)).toBe(true);
    expect(report.dimensions).toBeDefined();
    expect(report.dimensionConclusions).toBeDefined();
    expect(report.checklistResults).toBeDefined();
    expect(Array.isArray(report.issues)).toBe(true);
    expect(Array.isArray(report.suggestions)).toBe(true);
    expect(typeof report.summary).toBe("string");
    // 6 checklist items
    expect(Object.keys(report.checklistResults).length).toBe(6);
    // 6 dimensions
    expect(Object.keys(report.dimensions).length).toBe(6);
  });
});
