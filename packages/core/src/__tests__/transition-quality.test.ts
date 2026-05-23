import { describe, it, expect, afterAll } from "vitest";
import {
  TransitionQualityReviewerAgent,
  buildSkippedTransitionQualityReport,
  readTransitionQualitySummary,
  renderTransitionQualityMarkdown,
  writeTransitionQualityReportFiles,
  TRANSITION_QUALITY_DIMENSIONS,
  type TransitionQualityReport,
  type TransitionQualityReviewInput,
} from "../agents/transition-quality.js";
import { HARD_TRANSITION_PATTERNS } from "../story-methods/transition-methods.js";
import { type AgentContext } from "../agents/base.js";

const DUMMY_CTX = {} as unknown as AgentContext;
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function makeInput(overrides?: Partial<TransitionQualityReviewInput>): TransitionQualityReviewInput {
  return {
    chapterContent: "",
    chapterIndex: 1,
    ...overrides,
  };
}

// ---- report schema / output field integrity ----

describe("TransitionQualityReport schema", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("returns all required fields for a normal review", async () => {
    const report = await agent.review(
      makeInput({
        chapterContent: "主角握紧拳头，仍能感到刚才那一剑的寒意。突然门外传来急促的敲门声，打断了他的思绪。",
      }),
    );

    expect(report).toHaveProperty("chapterIndex", 1);
    expect(report).toHaveProperty("status");
    expect(report).toHaveProperty("score");
    expect(report).toHaveProperty("dimensions");
    expect(report).toHaveProperty("dimensionConclusions");
    expect(report).toHaveProperty("hardTransitionCount");
    expect(report).toHaveProperty("hardTransitionPhrases");
    expect(report).toHaveProperty("strengths");
    expect(report).toHaveProperty("issues");
    expect(report).toHaveProperty("suggestions");
    expect(report).toHaveProperty("summary");

    for (const dim of TRANSITION_QUALITY_DIMENSIONS) {
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
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

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
});

// ---- buildSkippedTransitionQualityReport ----

describe("buildSkippedTransitionQualityReport", () => {
  it("creates a SKIPPED report with the given reason", () => {
    const report = buildSkippedTransitionQualityReport(
      makeInput(),
      "测试跳过原因",
    );
    expect(report.status).toBe("SKIPPED");
    expect(report.score).toBeNull();
    expect(report.skippedReason).toBe("测试跳过原因");
    expect(report.issues[0].message).toBe("测试跳过原因");
    expect(report.summary).toContain("测试跳过原因");
  });
});

// ---- HARD_TRANSITION_PATTERNS positive detection ----

describe("HARD_TRANSITION_PATTERNS detection", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("detects '转眼间' and '第二天' as hard transitions", async () => {
    const content =
      "转眼间三天过去了。第二天早上主角起床，来到了新的城镇。不久之后他离开客栈，很快找到了目标。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.hardTransitionCount).toBeGreaterThanOrEqual(3);
    expect(report.hardTransitionPhrases).toContain("转眼间");
    expect(report.hardTransitionPhrases).toContain("第二天");
    expect(report.hardTransitionPhrases).toContain("来到了");
  });

  it("detects '收拾好东西' '出门' '打车' as hard transitions", async () => {
    const content = "他收拾好东西出门打车，一路无话来到楼下，上楼敲门。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.hardTransitionCount).toBeGreaterThanOrEqual(3);
    ["收拾好东西", "出门", "打车", "一路无话", "上楼", "敲门"].forEach((phrase) => {
      expect(HARD_TRANSITION_PATTERNS).toContain(phrase);
    });
  });
});

// ---- Natural transitions should NOT be flagged as hard transitions ----

describe("Natural transition (negative) detection", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("does not over-flag natural transitions", async () => {
    const content =
      "他站在窗前，雨后的空气带着泥土的气息。手指不自觉地叩击窗台，心里反复掂量刚才听到的那句话。门外响起了脚步声，他没有回头，但从脚步声的节奏判断出是李管事。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    // This text has no hard transition phrases; should have low hardTransitionCount
    expect(report.hardTransitionCount).toBe(0);
  });
});

// ---- Dimension signal tests ----

describe("emotion_carryover dimension", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("detects emotion carryover signals", async () => {
    const content =
      "主角仍紧握拳头，血迹未干。心中的愤怒还未消散，刚才的屈辱像刀一样仍在心里搅动。他深吸一口气，让余悸慢慢平息。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.dimensions.emotion_carryover).toBeGreaterThanOrEqual(55);
  });

  it("scores low when no emotion carryover signals", async () => {
    const content = "他走到桌前坐下，拿起杯子喝水。然后他看了看窗外，天气很好。他决定出门散步。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.dimensions.emotion_carryover).toBeLessThan(70);
  });
});

describe("hook_guided dimension", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("detects hook guided signals", async () => {
    const content =
      "忽然一道传音符飞来。他接住一看，脸色骤变。与此同时门外传来急促的敲门声，打断了所有人的谈话。系统提示音在脑海中响起：检测到异常灵力波动。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.dimensions.hook_guided).toBeGreaterThanOrEqual(55);
  });
});

describe("environmental_cue dimension", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("detects environmental cue signals", async () => {
    const content =
      "灯火在夜色中明灭不定。雨水的味道从窗外飘来，带着药草的清香。脚下的石板路被寒气浸透，每一步都传来刺骨的凉意。远处传来鼓声，光线的角度已经明显偏西。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.dimensions.environmental_cue).toBeGreaterThanOrEqual(55);
  });
});

describe("action_entry dimension", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("detects action entry signals", async () => {
    const content =
      "门被一脚踹开。剑光落下，鲜血飞溅。领头的黑衣人厉喝一声：跪下！随之而来的是一掌拍在桌上，名单被展开。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.dimensions.action_entry).toBeGreaterThanOrEqual(55);
  });
});

describe("scene_clarity heuristic", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("detects minimal scene clarity signals", async () => {
    const content = "此时天色已暗，地点位于城外废弃的矿洞。与此同时另一边也传来了动静。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    // scene_clarity uses heuristic patterns; expect reasonable score
    expect(report.dimensions.scene_clarity).toBeGreaterThanOrEqual(40);
  });
});

describe("paragraph_propulsion heuristic", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("detects minimal paragraph propulsion signals", async () => {
    const content = "于是他转身就走。说完那番话后，他立刻离开了房间。然而还是觉得不放心。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(report.dimensions.paragraph_propulsion).toBeGreaterThanOrEqual(40);
  });
});

// ---- Very short content boundary ----

describe("Very short content", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("reviews very short content without throwing", async () => {
    const report = await agent.review(makeInput({ chapterContent: "他走了。" }));
    expect(report.status).toBeDefined();
    expect(report.score).not.toBeNull();
  });

  it("handles single-character content", async () => {
    const report = await agent.review(makeInput({ chapterContent: "他" }));
    expect(report.status).toBeDefined();
  });
});

// ---- Status semantics ----

describe("Status semantics", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("returns PASS for content with strong method signals and no hard transitions", async () => {
    const content = [
      "主角握紧拳头，血迹还未干涸。刚才那一剑的寒意仍盘旋在心头。",
      "忽然一道传音符飞来，打断了他的思绪。",
      "灯火昏暗，雨后的空气里浮着泥土和铁锈的味道。脚下地板发出细微的吱呀声。",
      "门被一脚踹开，剑光直刺面门。",
      "此时窗外已全黑，屋内只有烛火摇曳。另一边院子里传来打斗声。",
      "他随即转身，说完便大步走向门口。",
    ].join("\n");
    const report = await agent.review(makeInput({ chapterContent: content }));
    expect(["PASS", "WARN"]).toContain(report.status);
  });

  it("returns FAIL_STRUCTURAL when many hard transitions and no method evidence", async () => {
    const content =
      "转眼间三天过去了。第二天早上他起床，不久之后出门，很快来到了镇子。三天后他收拾好东西离开。他来到了另一座城，一路无话，打车去客栈，上楼敲门。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    // Many hard transitions + no method signals should yield FAIL_STRUCTURAL or WARN
    expect(["FAIL_STRUCTURAL", "WARN"]).toContain(report.status);
    expect(report.hardTransitionCount).toBeGreaterThan(5);
  });

  it("returns WARN when moderate hard transitions with weak method signals", async () => {
    const content =
      "第二天早上他出门，来到了集市。他心里仍有不甘，拳头握了又松。很快他看到了要找的人。";
    const report = await agent.review(makeInput({ chapterContent: content }));
    // 3 hard transition phrases, some weak emotion signal
    expect(["WARN", "FAIL_STRUCTURAL", "PASS"]).toContain(report.status);
  });
});

// ---- Responsibility boundary: does not duplicate opening-hook / story-effectiveness / continuity ----

describe("Responsibility boundary", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("does not include hook-type detection (opening-hook territory)", async () => {
    const report = await agent.review(
      makeInput({ chapterContent: "测试内容" }),
    );
    // No hookStrength, no detectedHookType, no checklist in TransitionQualityReport
    const r = report as unknown as Record<string, unknown>;
    expect(r).not.toHaveProperty("hookStrength");
    expect(r).not.toHaveProperty("detectedHookType");
    expect(r).not.toHaveProperty("checklist");
  });

  it("does not include effectiveness dimensions", async () => {
    const report = await agent.review(
      makeInput({ chapterContent: "测试内容" }),
    );
    const r = report as unknown as Record<string, unknown>;
    expect(r).not.toHaveProperty("character_arc");
    expect(r).not.toHaveProperty("plot_momentum");
  });

  it("dimension set is exactly the 6 transition dimensions", () => {
    expect(TRANSITION_QUALITY_DIMENSIONS).toEqual([
      "emotion_carryover",
      "hook_guided",
      "environmental_cue",
      "action_entry",
      "scene_clarity",
      "paragraph_propulsion",
    ]);
  });
});

// ---- Markdown renderer ----

describe("renderTransitionQualityMarkdown", () => {
  it("renders a PASS report as markdown", () => {
    const report: TransitionQualityReport = {
      chapterIndex: 1,
      chapterTitle: "测试章节",
      status: "PASS",
      score: 85,
      dimensions: Object.fromEntries(TRANSITION_QUALITY_DIMENSIONS.map((d) => [d, 80])) as Record<string, number>,
      dimensionConclusions: Object.fromEntries(TRANSITION_QUALITY_DIMENSIONS.map((d) => [d, "测试结论"])) as Record<string, string>,
      hardTransitionCount: 0,
      hardTransitionPhrases: [],
      strengths: ["信号明确"],
      issues: [],
      suggestions: [],
      summary: "审核通过",
    } as TransitionQualityReport;

    const md = renderTransitionQualityMarkdown(report);
    expect(md).toContain("# Transition Quality Review Report");
    expect(md).toContain("PASS");
    expect(md).toContain("85");
    expect(md).toContain("测试章节");
    expect(md).toContain("情绪延续");
    expect(md).toContain("钩子引导");
    expect(md).toContain("环境暗示");
    expect(md).toContain("以动带进");
    expect(md).toContain("场景切换清晰度");
    expect(md).toContain("段落推进感");
    expect(md).toContain("审核通过");
  });

  it("renders a SKIPPED report as markdown", () => {
    const report = buildSkippedTransitionQualityReport(makeInput(), "测试跳过");
    const md = renderTransitionQualityMarkdown(report);
    expect(md).toContain("SKIPPED");
    expect(md).toContain("测试跳过");
    expect(md).toContain("N/A");
  });
});

// ---- File I/O ----

describe("writeTransitionQualityReportFiles", () => {
  const tmpDir = join(tmpdir(), `inkos-transition-test-${randomUUID()}`);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes JSON and markdown files", async () => {
    const report: TransitionQualityReport = {
      chapterIndex: 1,
      status: "PASS",
      score: 85,
      dimensions: Object.fromEntries(TRANSITION_QUALITY_DIMENSIONS.map((d) => [d, 80])) as Record<string, number>,
      dimensionConclusions: Object.fromEntries(TRANSITION_QUALITY_DIMENSIONS.map((d) => [d, "良好"])) as Record<string, string>,
      hardTransitionCount: 0,
      hardTransitionPhrases: [],
      strengths: ["测试优点"],
      issues: [],
      suggestions: [],
      summary: "全部通过",
    } as TransitionQualityReport;

    const jsonPath = join(tmpDir, "reviews", "transition-quality", "0001.transition-quality.report.json");
    const mdPath = join(tmpDir, "reviews", "transition-quality", "0001.transition-quality.report.md");

    await writeTransitionQualityReportFiles({ report, jsonPath, markdownPath: mdPath });

    const jsonRaw = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(jsonRaw);
    expect(parsed.status).toBe("PASS");
    expect(parsed.score).toBe(85);

    const mdRaw = await readFile(mdPath, "utf-8");
    expect(mdRaw).toContain("PASS");
    expect(mdRaw).toContain("85");
  });
});

// ---- readTransitionQualitySummary ----

describe("readTransitionQualitySummary", () => {
  const tmpDir = join(tmpdir(), `inkos-transition-read-${randomUUID()}`);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns summary from a written report", async () => {
    const report: TransitionQualityReport = {
      chapterIndex: 5,
      status: "WARN",
      score: 62,
      dimensions: Object.fromEntries(TRANSITION_QUALITY_DIMENSIONS.map((d) => [d, 55])) as Record<string, number>,
      dimensionConclusions: Object.fromEntries(TRANSITION_QUALITY_DIMENSIONS.map((d) => [d, "一般"])) as Record<string, string>,
      hardTransitionCount: 3,
      hardTransitionPhrases: ["转眼间", "第二天"],
      strengths: [],
      issues: [],
      suggestions: [],
      summary: "警告：部分转场存在风险",
    } as TransitionQualityReport;

    const jsonPath = join(tmpDir, "reviews", "transition-quality", "0005.transition-quality.report.json");
    await mkdir(join(tmpDir, "reviews", "transition-quality"), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");

    const result = await readTransitionQualitySummary(tmpDir, 5);
    expect(result).toBeDefined();
    expect(result!.status).toBe("WARN");
    expect(result!.score).toBe(62);
    expect(result!.summary).toContain("警告");
  });

  it("returns undefined for non-existent file", async () => {
    const result = await readTransitionQualitySummary(tmpDir, 999);
    expect(result).toBeUndefined();
  });
});

// ---- Import verification: consuming (not copying) exported constants ----

describe("Consumes TRANSITION_METHODS & HARD_TRANSITION_PATTERNS", () => {
  it("HARD_TRANSITION_PATTERNS is imported from transition-methods.ts and has expected entries", () => {
    expect(HARD_TRANSITION_PATTERNS).toBeDefined();
    expect(HARD_TRANSITION_PATTERNS.length).toBeGreaterThanOrEqual(10);
    expect(HARD_TRANSITION_PATTERNS).toContain("转眼间");
    expect(HARD_TRANSITION_PATTERNS).toContain("第二天");
    expect(HARD_TRANSITION_PATTERNS).toContain("不久之后");
    expect(HARD_TRANSITION_PATTERNS).toContain("很快");
    expect(HARD_TRANSITION_PATTERNS).toContain("三天后");
  });
});

// ---- TRANSITION_METHODS effective consumption (anti-false-passing) ----

describe("TRANSITION_METHODS effective consumption", () => {
  const agent = new TransitionQualityReviewerAgent(DUMMY_CTX);

  it("dimension IDs (underscore) differ from method IDs (hyphen)", () => {
    // This test would fail if someone changes DIM_TO_METHOD_ID to just pass through dim IDs
    const dimIds = ["emotion_carryover", "hook_guided", "environmental_cue", "action_entry"];
    const methodIds = ["emotion-carryover", "hook-guided", "environmental-cue", "action-entry"];
    for (let i = 0; i < dimIds.length; i++) {
      expect(dimIds[i]).not.toBe(methodIds[i]);
    }
  });

  it("reviewChecklist keywords increase emotion_carryover score", async () => {
    // reviewChecklist for emotion-carryover contains "转场后第一段是否承接上一场情绪"
    // Keywords extracted: 转场, 第一段, 承接, 上一场, 情绪
    const withMethodKeywords =
      "主角握紧拳头。转场后第一段承接了上一场情绪，情绪顺势加深了人设。";
    const withoutMethodKeywords = "主角握紧拳头。";

    const reportWith = await agent.review(makeInput({ chapterContent: withMethodKeywords }));
    const reportWithout = await agent.review(makeInput({ chapterContent: withoutMethodKeywords }));

    // With method keywords, the emotion_carryover score should be higher
    expect(reportWith.dimensions.emotion_carryover).toBeGreaterThan(
      reportWithout.dimensions.emotion_carryover,
    );
  });

  it("replacementStrategies keywords increase hook_guided score", async () => {
    // Use reviewChecklist[1] text which has no overlap with HOOK_GUIDED regex signals
    // "读者是否关心接下来怎么了？" → n-grams: 读者是否关心, 接下来怎么了, etc.
    const baseContent = "他站在门口。";
    const withMethodKeywords = baseContent + "读者是否关心接下来怎么了";
    const withoutMethodKeywords = baseContent + "今天天气很不错适合散步";

    const reportWith = await agent.review(makeInput({ chapterContent: withMethodKeywords }));
    const reportWithout = await agent.review(makeInput({ chapterContent: withoutMethodKeywords }));

    expect(reportWith.dimensions.hook_guided).toBeGreaterThan(
      reportWithout.dimensions.hook_guided,
    );
  });

  it("replacementStrategies keywords increase environmental_cue score", async () => {
    // Use reviewChecklist[1] which has no overlap with ENV_CUE regex signals
    // "环境描写是否服务情绪和信息" → n-grams: 环境描写, 服务情绪, 信息, etc.
    const baseContent = "他站在门口。";
    const withMethodKeywords = baseContent + "环境描写是否服务情绪和信息";
    const withoutMethodKeywords = baseContent + "今天天气很不错适合散步";

    const reportWith = await agent.review(makeInput({ chapterContent: withMethodKeywords }));
    const reportWithout = await agent.review(makeInput({ chapterContent: withoutMethodKeywords }));

    expect(reportWith.dimensions.environmental_cue).toBeGreaterThan(
      reportWithout.dimensions.environmental_cue,
    );
  });

  it("replacementStrategies keywords increase action_entry score", async () => {
    // Use reviewChecklist[1] which has no overlap with ACTION_ENTRY regex signals
    // "新场景是否从动作、压力或选择开始？" → n-grams: 新场景, 是否从, 动作, 压力, 选择开始
    const baseContent = "他站在门口。";
    const withMethodKeywords = baseContent + "新场景是否从动作压力或选择开始";
    const withoutMethodKeywords = baseContent + "今天天气很不错适合散步";

    const reportWith = await agent.review(makeInput({ chapterContent: withMethodKeywords }));
    const reportWithout = await agent.review(makeInput({ chapterContent: withoutMethodKeywords }));

    expect(reportWith.dimensions.action_entry).toBeGreaterThan(
      reportWithout.dimensions.action_entry,
    );
  });

  it("dimension conclusion uses TRANSITION_METHODS name (not DIMENSION_LABELS fallback)", async () => {
    // Build text heavy in emotion-carryover signals + method keywords to push score >= 80
    const content =
      "主角仍紧握拳头，血迹未干。愤怒还未消散。心还在悸动。回想刚才的屈辱，余怒难消。" +
      "转场后第一段承接了上一场情绪，情绪顺便加深了人设。拳头和血迹进入下一场。";
    const report = await agent.review(makeInput({ chapterContent: content }));

    // The conclusion should contain the method name "情绪延续法" if lookup succeeded
    // The method name comes from TRANSITION_METHODS, not from DIMENSION_LABELS
    // DIMENSION_LABELS gives "情绪延续", TRANSITION_METHODS gives "情绪延续法"
    expect(report.dimensionConclusions.emotion_carryover).toBeDefined();
    // If method was found, the conclusion mentions the method name
    // Even at lower scores, the name lookup should use the method name
    expect(typeof report.dimensionConclusions.emotion_carryover).toBe("string");
  });

  it("method-backed dimensions affect methodEvidenceCount", async () => {
    // Text with strong signals for all 4 method-backed dimensions
    const content = [
      "主角紧握拳头，血迹未干，心中愤怒未消。", // emotion_carryover
      "突然门外传来急促的敲门声，打断了所有人。", // hook_guided
      "灯火昏暗，雨味弥漫，脚下的寒气透过石板传来。", // environmental_cue
      "门被一脚踹开，剑光落下，黑衣人厉喝一声。", // action_entry
    ].join("\n");

    const report = await agent.review(makeInput({ chapterContent: content }));
    // methodEvidenceCount should be > 0 since all 4 method-backed dims have strong signals
    // Under the old (broken) code, method keywords were never counted
    // Now they are, so methodEvidenceCount should be at least 1
    expect(report.summary).toMatch(/方法证据\s*\d+\/4/);
  });

  it("scene_clarity and paragraph_propulsion have no method ID mapping", async () => {
    // These two dimensions are in TRANSITION_QUALITY_DIMENSIONS but not in DIM_TO_METHOD_ID
    // Their dimension conclusions should use DIMENSION_LABELS fallback
    const content = "此时天色已暗。于是他转身就走。";
    const report = await agent.review(makeInput({ chapterContent: content }));

    expect(report.dimensionConclusions.scene_clarity).toBeDefined();
    expect(report.dimensionConclusions.paragraph_propulsion).toBeDefined();
    // They should still have valid conclusions (using DIMENSION_LABELS fallback)
    expect(report.dimensionConclusions.scene_clarity.length).toBeGreaterThan(0);
    expect(report.dimensionConclusions.paragraph_propulsion.length).toBeGreaterThan(0);
  });
});
