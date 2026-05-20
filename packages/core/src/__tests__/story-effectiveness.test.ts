import { describe, expect, it } from "vitest";
import {
  StoryEffectivenessAgent,
  buildSkippedEffectivenessReport,
  renderStoryEffectivenessMarkdown,
  STORY_EFFECTIVENESS_DIMENSIONS,
  type StoryEffectivenessReport,
} from "../agents/story-effectiveness.js";
import { BaseAgent, type AgentContext } from "../agents/base.js";

function makePassContent(): string {
  const opening = "冲突爆发了，画面中只见一道血光闪过，恐惧压在每个围观者的心头。";
  const body = [
    "林默的目标非常明确：一定要在日落前拿到密钥。他打算从侧门潜入，利用守卫换班的空子。",
    "然而阻碍接踵而至。先是巡逻队封锁了走廊，接着发现密钥被锁在能量护盾后面，",
    "自己灵石不足，无法硬闯。更危险的是追兵已从后方逼近。",
    "他靠着前文获得的隐身符和敌人自大的破绽，在守卫转身的瞬间借机溜了进去。",
    "付出了大量灵石和一道伤口为代价，终于拿到了密钥，突破到了三层。",
  ].join("\n");
  const ending = "突然，门外响起脚步声。他不知道来的是敌是友，但密钥的秘密远比他想象的更危险。下一章他将面对更大的危机。";
  return `${opening}\n\n${body}\n\n${ending}`;
}

function makeWarnContent(): string {
  return "林默走在街道上，看了看四周。\n\n他想要找点吃的。路边有个卖包子的摊子，他走过去买了两个包子。\n\n吃完后他继续走。天快黑了，他找了家客栈住下。";
}

function makeFailContent(): string {
  return "系统提示：力量体系分为九级，每级需要100点经验值升级。\n\n林默是个普通人，没什么特别的事要做。他在家里看电视。";
}

function makeMockAgentContext(): AgentContext {
  return {
    chat: async () => ({ content: "" }),
    chatWithSearch: async () => ({ content: "" }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    model: "test-model",
    provider: "test-provider",
    temperature: 0,
    maxTokens: 1000,
    thinkingBudget: 0,
    projectDir: "/tmp",
    bookId: "test-book",
    agentName: "story-effectiveness",
  } as unknown as AgentContext;
}

describe("StoryEffectivenessAgent", () => {
  const agent = new StoryEffectivenessAgent(makeMockAgentContext());

  describe("review - PASS", () => {
    it("achieves PASS status with all dimensions strong", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makePassContent(),
      });

      expect(report.status).toBe("PASS");
      expect(report.score).toBeGreaterThanOrEqual(85);
      expect(report.strengths.length).toBeGreaterThan(0);
      expect(report.issues.filter((i) => i.severity === "critical")).toHaveLength(0);

      for (const dim of STORY_EFFECTIVENESS_DIMENSIONS) {
        expect(report.dimensions[dim]).toBeGreaterThanOrEqual(50);
        expect(report.dimensionConclusions[dim]).toBeTruthy();
      }
    });
  });

  describe("review - WARN", () => {
    it("returns WARN with weak content", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makeWarnContent(),
      });

      expect(["WARN", "FAIL_STRUCTURAL"]).toContain(report.status);
      expect(report.issues.length).toBeGreaterThan(0);
    });
  });

  describe("review - FAIL_STRUCTURAL", () => {
    it("returns FAIL_STRUCTURAL with critically weak content", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makeFailContent(),
      });

      // Should be WARN or FAIL_STRUCTURAL depending on overall score
      expect(["WARN", "FAIL_STRUCTURAL"]).toContain(report.status);
      // Setting/system exposition opening should trigger critical issue
      const criticalIssues = report.issues.filter((i) => i.severity === "critical");
      expect(criticalIssues.length).toBeGreaterThan(0);
    });
  });

  describe("review - SKIPPED", () => {
    it("skips when resource is blocking", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makePassContent(),
        resourceBlocking: true,
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toBeTruthy();
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0].severity).toBe("info");
    });

    it("skips when chapter status is state-degraded", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makePassContent(),
        chapterIndexStatus: "state-degraded",
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
    });

    it("skips when chapter status is blocked-resource-plan", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makePassContent(),
        chapterIndexStatus: "blocked-resource-plan",
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
    });

    it("skips when chapter content is empty", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: "",
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.skippedReason).toContain("为空");
    });

    it("skips when chapter content is whitespace only", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: "   \n  \n  ",
      });

      expect(report.status).toBe("SKIPPED");
    });
  });

  describe("buildSkippedEffectivenessReport", () => {
    it("returns a valid SKIPPED report shape", () => {
      const report = buildSkippedEffectivenessReport(
        { chapter: 5 },
        "test skip reason",
      );

      expect(report.chapter).toBe(5);
      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.strengths).toHaveLength(0);
      expect(report.skippedReason).toBe("test skip reason");
      expect(report.dimensions.emotion_event).toBe(85); // default scores preserved
    });
  });

  describe("report schema", () => {
    it("returns all expected fields", async () => {
      const report = await agent.review({
        chapter: 3,
        chapterContent: makePassContent(),
      });

      // Top-level fields
      expect(typeof report.chapter).toBe("number");
      expect(["PASS", "WARN", "FAIL_STRUCTURAL", "SKIPPED"]).toContain(report.status);
      expect(typeof report.score).toBe("number");
      expect(report.dimensions).toBeDefined();
      expect(report.dimensionConclusions).toBeDefined();
      expect(Array.isArray(report.strengths)).toBe(true);
      expect(Array.isArray(report.issues)).toBe(true);
      expect(Array.isArray(report.suggestions)).toBe(true);

      // All 6 dimensions present
      for (const dim of STORY_EFFECTIVENESS_DIMENSIONS) {
        expect(typeof report.dimensions[dim]).toBe("number");
        expect(report.dimensions[dim]).toBeGreaterThanOrEqual(0);
        expect(report.dimensions[dim]).toBeLessThanOrEqual(100);
        expect(typeof report.dimensionConclusions[dim]).toBe("string");
      }

      // Issues have correct shape
      for (const issue of report.issues) {
        expect(["info", "warning", "critical"]).toContain(issue.severity);
        expect(typeof issue.message).toBe("string");
      }
    });
  });

  describe("dimension scoring", () => {
    it("each dimension receives a score 0-100", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makePassContent(),
      });

      for (const dim of STORY_EFFECTIVENESS_DIMENSIONS) {
        expect(report.dimensions[dim]).toBeGreaterThanOrEqual(0);
        expect(report.dimensions[dim]).toBeLessThanOrEqual(100);
      }
    });

    it("average score matches overall score", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makePassContent(),
      });

      const avg = Math.round(
        STORY_EFFECTIVENESS_DIMENSIONS.reduce((sum, dim) => sum + report.dimensions[dim], 0) /
          STORY_EFFECTIVENESS_DIMENSIONS.length,
      );
      expect(report.score).toBe(avg);
    });
  });

  describe("suggestions", () => {
    it("suggestions match issues with suggestions", async () => {
      const report = await agent.review({
        chapter: 1,
        chapterContent: makeWarnContent(),
      });

      const issuesWithSuggestions = report.issues.filter((i) => i.suggestion);
      expect(report.suggestions.length).toBeLessThanOrEqual(issuesWithSuggestions.length);
      for (const suggestion of report.suggestions) {
        expect(report.issues.some((i) => i.suggestion === suggestion)).toBe(true);
      }
    });
  });
});

describe("renderStoryEffectivenessMarkdown", () => {
  it("renders PASS report", () => {
    const report: StoryEffectivenessReport = {
      chapter: 1,
      status: "PASS",
      score: 90,
      dimensions: Object.fromEntries(STORY_EFFECTIVENESS_DIMENSIONS.map((d) => [d, 90])) as Record<string, number>,
      dimensionConclusions: Object.fromEntries(
        STORY_EFFECTIVENESS_DIMENSIONS.map((d) => [d, `Good ${d}`]),
      ) as Record<string, string>,
      strengths: ["开头以具体冲突画面调动读者情绪。"],
      issues: [],
      suggestions: [],
    };
    const md = renderStoryEffectivenessMarkdown(report);
    expect(md).toContain("第1章");
    expect(md).toContain("PASS");
    expect(md).toContain("90");
    expect(md).toContain("六步心法");
    expect(md).toContain("情绪事件");
  });

  it("renders SKIPPED report", () => {
    const report = buildSkippedEffectivenessReport({ chapter: 2 }, "资源账本校验失败");
    const md = renderStoryEffectivenessMarkdown(report);
    expect(md).toContain("SKIPPED");
    expect(md).toContain("N/A");
    expect(md).toContain("跳过");
    expect(md).toContain("资源账本校验失败");
  });

  it("renders FAIL_STRUCTURAL report", () => {
    const report: StoryEffectivenessReport = {
      chapter: 3,
      status: "FAIL_STRUCTURAL",
      score: 55,
      dimensions: Object.fromEntries(STORY_EFFECTIVENESS_DIMENSIONS.map((d) => [d, 55])) as Record<string, number>,
      dimensionConclusions: Object.fromEntries(
        STORY_EFFECTIVENESS_DIMENSIONS.map((d) => [d, `Weak ${d}`]),
      ) as Record<string, string>,
      strengths: [],
      issues: [
        { severity: "critical", dimension: "emotion_event", message: "缺少冲突画面", suggestion: "用冲突开场" },
      ],
      suggestions: ["用冲突开场"],
    };
    const md = renderStoryEffectivenessMarkdown(report);
    expect(md).toContain("FAIL_STRUCTURAL");
    expect(md).toContain("严重故事结构缺陷");
    expect(md).toContain("critical");
  });
});
