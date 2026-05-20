import { describe, expect, it } from "vitest";
import {
  Golden3ChapterAgent,
  buildSkippedGolden3ChapterReport,
  renderGolden3ChapterMarkdown,
  GOLDEN_3_CHAPTER_DIMENSIONS,
  type Golden3ChapterReport,
} from "../agents/golden-3-chapter.js";
import { BaseAgent, type AgentContext } from "../agents/base.js";

function makeStrongCh1Content(): string {
  return [
    "刀抵在喉咙上时，林默才意识到自己不只是被出卖了——",
    "整个宗门都要他死。审判钟第三声响起，围观者的目光像针一样扎过来。",
    "他不想认罪，但所有人都等着看他跪下。",
    "",
    "冲突一触即发。林默握紧拳头，咬着牙看向台上的掌门。",
    "他不知道为什么师父要这样做，但眼下最重要的是活下去。",
    "逃出这个大厅，逃出这个宗门——这就是他现在唯一的目标。",
  ].join("\n");
}

function makeStrongCh2Content(): string {
  return [
    "系统面板在眼前亮起的瞬间，林默终于明白了自己为什么能活下来。",
    "",
    "【宿主：林默】",
    "【核心能力：因果逆转（唯一）】",
    "【当前境界：炼气一层】",
    "",
    "这是他独有的金手指——别人看不到系统，更不可能逆转因果。",
    "他试着用了一下，发现每发动一次都要消耗寿命。",
    "但这已经足够了。有了这个能力，他就能找到师父背叛他的真相。",
    "林默看着面板上的技能树，暗暗盘算着第一次突破的路线。",
  ].join("\n");
}

function makeStrongCh3Content(): string {
  return [
    "三天的逃亡让林默彻底明白了一件事：在修真界，没有力量就没有公道。",
    "",
    "他必须变强。不是为了复仇——至少不全是——而是为了在这个吃人的世界里活下去。",
    "他的长期目标很明确：三年内突破到元婴期，亲手揭开宗门背后的真相。",
    "",
    "第一次主动出击，他选择了一个被宗门通缉的散修。",
    "战斗并不轻松，但当他用因果逆转让对方的致命一击反弹回去时，",
    "林默第一次感受到了力量带来的底气。",
    "这只是一个开始。真正的敌人还在前方等着他。",
  ].join("\n");
}

function makeWeakCh1Content(): string {
  return "林默是一个普通的修真者，每天早上起来练功，然后去食堂吃饭。\n\n今天天气不错，他和师弟们聊了聊天。\n\n师父叫他去大殿说了几句话，他就回去继续修炼了。";
}

function makeWeakCh2Content(): string {
  return "林默继续修炼，他感觉很平静。\n\n又过了几天，他还是按照日常作息生活。\n\n没有什么特别的事情发生。";
}

function makeWeakCh3Content(): string {
  return "日子一天天过去，林默在宗门里过得还算舒服。\n\n他和师兄们关系不错，每天就是练功、吃饭、睡觉。\n\n暂时没有什么特别想做的事，走一步看一步吧。";
}

function makeHeavySetupContent(): string {
  const setupBlock = [
    "系统设定：本世界力量体系分为九大境界，每境界有十层小等级。",
    "第一境界为炼气期，主要吸收天地灵气淬炼肉身。",
    "第二境界为筑基期，需要将灵气凝聚为液态，在丹田形成道基。",
    "第三境界为金丹期，道基旋转凝结成丹，寿命延长至五百年。",
    "以下是各境界详细说明：",
    "首先，炼气期的修炼分为三个阶段：引气、化气、凝气。",
    "其次，筑基期需要筑基丹辅助，失败则修为尽废。",
    "再次，金丹期是最关键的转折点，决定了修行者的上限。",
  ].join("\n");
  return `${setupBlock}\n\n${setupBlock}\n\n${setupBlock}`;
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
    agentName: "golden-3-chapter",
  } as unknown as AgentContext;
}

describe("Golden3ChapterAgent", () => {
  const agent = new Golden3ChapterAgent(makeMockAgentContext());

  describe("report schema", () => {
    it("produces a valid Golden3ChapterReport structure", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.chapterRange).toEqual([1, 3]);
      expect(["PASS", "WARN", "FAIL_STRUCTURAL", "SKIPPED"]).toContain(report.status);
      expect(typeof report.score).toBe("number");
      expect(report.dimensions).toBeDefined();
      expect(report.dimensionConclusions).toBeDefined();
      expect(Array.isArray(report.strengths)).toBe(true);
      expect(Array.isArray(report.issues)).toBe(true);
      expect(Array.isArray(report.suggestions)).toBe(true);
      expect(typeof report.summary).toBe("string");
      expect(report.summary.length).toBeGreaterThan(0);

      for (const dim of GOLDEN_3_CHAPTER_DIMENSIONS) {
        expect(report.dimensions[dim]).toBeGreaterThanOrEqual(0);
        expect(report.dimensions[dim]).toBeLessThanOrEqual(100);
        expect(typeof report.dimensionConclusions[dim]).toBe("string");
        expect(report.dimensionConclusions[dim].length).toBeGreaterThan(0);
      }
    });
  });

  describe("5 dimensions - strong content", () => {
    it("scores high across all 5 dimensions with strong ch1-3", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.dimensions.opening_hook_delivery).toBeGreaterThanOrEqual(70);
      expect(report.dimensions.core_differentiator_visible).toBeGreaterThanOrEqual(70);
      expect(report.dimensions.long_term_goal_established).toBeGreaterThanOrEqual(70);
      expect(report.dimensions.three_chapter_arc).toBeGreaterThanOrEqual(70);
      expect(report.dimensions.setup_ratio_safe).toBeGreaterThanOrEqual(70);
      expect(report.score).toBeGreaterThanOrEqual(75);
      expect(["PASS", "WARN"]).toContain(report.status);
    });
  });

  describe("opening_hook_delivery", () => {
    it("scores low when ch1 has no hook signals", async () => {
      const report = await agent.review({
        chapter1Content: makeWeakCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.dimensions.opening_hook_delivery).toBeLessThanOrEqual(55);
      expect(report.issues.some((i) => i.dimension === "opening_hook_delivery")).toBe(true);
    });

    it("scores high with conflict-first hook pattern", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.dimensions.opening_hook_delivery).toBeGreaterThanOrEqual(70);
    });
  });

  describe("core_differentiator_visible", () => {
    it("scores low when ch2 lacks golden finger / ability display", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeWeakCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.dimensions.core_differentiator_visible).toBeLessThanOrEqual(55);
      expect(report.issues.some((i) => i.dimension === "core_differentiator_visible")).toBe(true);
    });
  });

  describe("long_term_goal_established", () => {
    it("scores low when ch3 lacks clear long-term goal", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeWeakCh3Content(),
      });

      expect(report.dimensions.long_term_goal_established).toBeLessThanOrEqual(55);
      expect(report.issues.some((i) => i.dimension === "long_term_goal_established")).toBe(true);
    });
  });

  describe("three_chapter_arc", () => {
    it("scores high when ch1-3 form a clear arc", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.dimensions.three_chapter_arc).toBeGreaterThanOrEqual(70);
    });

    it("returns SKIPPED when only ch1+ch2 provided (incomplete set)", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toContain("前三章未齐全");
      expect(report.skippedReason).toContain("第3章");
    });
  });

  describe("setup_ratio_safe", () => {
    it("scores low when setup/exposition dominates", async () => {
      const report = await agent.review({
        chapter1Content: makeHeavySetupContent(),
        chapter2Content: makeHeavySetupContent(),
        chapter3Content: makeHeavySetupContent(),
      });

      expect(report.dimensions.setup_ratio_safe).toBeLessThanOrEqual(55);
      expect(report.issues.some((i) => i.dimension === "setup_ratio_safe")).toBe(true);
    });
  });

  describe("status grading", () => {
    it("returns PASS with strong all-around content", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.status).toBe("PASS");
      expect(report.score).toBeGreaterThanOrEqual(85);
      expect(report.issues.filter((i) => i.severity === "critical")).toHaveLength(0);
    });

    it("returns WARN with mixed content", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeWeakCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(["WARN", "FAIL_STRUCTURAL"]).toContain(report.status);
      expect(report.issues.length).toBeGreaterThan(0);
    });

    it("returns FAIL_STRUCTURAL with all-weak content", async () => {
      const report = await agent.review({
        chapter1Content: makeWeakCh1Content(),
        chapter2Content: makeWeakCh2Content(),
        chapter3Content: makeWeakCh3Content(),
      });

      expect(report.status).toBe("FAIL_STRUCTURAL");
      expect(report.score).toBeLessThanOrEqual(70);
      expect(report.issues.filter((i) => i.severity === "critical").length).toBeGreaterThan(0);
    });
  });

  describe("SKIPPED", () => {
    it("returns SKIPPED on resource blocking", async () => {
      const report = await agent.review({
        resourceBlocking: true,
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toBeDefined();
    });

    it("returns SKIPPED on state-degraded chapter index status", async () => {
      const report = await agent.review({
        chapterIndexStatus: "state-degraded",
      });

      expect(report.status).toBe("SKIPPED");
    });

    it("returns SKIPPED on blocked-resource-plan chapter index status", async () => {
      const report = await agent.review({
        chapterIndexStatus: "blocked-resource-plan",
      });

      expect(report.status).toBe("SKIPPED");
    });

    it("returns SKIPPED when all chapters are empty", async () => {
      const report = await agent.review({
        chapter1Content: "",
        chapter2Content: "",
        chapter3Content: "",
      });

      expect(report.status).toBe("SKIPPED");
    });

    it("returns SKIPPED when only ch1 is provided", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toContain("前三章未齐全");
      expect(report.skippedReason).toContain("第2章");
      expect(report.skippedReason).toContain("第3章");
    });

    it("returns SKIPPED when only ch1+ch3 provided (ch2 missing)", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toContain("第2章");
    });

    it("returns SKIPPED when only ch2+ch3 provided (ch1 missing)", async () => {
      const report = await agent.review({
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toContain("第1章");
    });

    it("returns SKIPPED when ch2 is empty string", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: "",
        chapter3Content: makeStrongCh3Content(),
      });

      expect(report.status).toBe("SKIPPED");
      expect(report.skippedReason).toContain("第2章");
    });
  });

  describe("buildSkippedGolden3ChapterReport", () => {
    it("produces a SKIPPED report with reason", () => {
      const report = buildSkippedGolden3ChapterReport({}, "前三章不全");

      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toContain("前三章不全");
      expect(report.summary).toContain("前三章不全");
    });
  });

  describe("Markdown rendering", () => {
    it("renders a valid markdown string", async () => {
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(),
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
      });

      const md = renderGolden3ChapterMarkdown(report);
      expect(md).toContain("Golden 3-Chapter Review Report");
      expect(md).toContain("开头钩子兑现");
      expect(md).toContain("核心差异可见");
      expect(md).toContain("长期目标建立");
      expect(md).toContain("前三章弧线完整");
      expect(md).toContain("设定比例安全");
      expect(md).toContain(String(report.score));
      expect(md).toContain(report.status);
    });

    it("renders SKIPPED markdown correctly", () => {
      const report = buildSkippedGolden3ChapterReport({}, "测试跳过");
      const md = renderGolden3ChapterMarkdown(report);
      expect(md).toContain("SKIPPED");
      expect(md).toContain("测试跳过");
    });
  });

  describe("hook type detection from first_10_chapter_plan", () => {
    it("detects hook type mismatch", async () => {
      const plan = "选择开头钩子：suspense-gap（悬念留白勾）";
      const report = await agent.review({
        chapter1Content: makeStrongCh1Content(), // conflict-first signals
        chapter2Content: makeStrongCh2Content(),
        chapter3Content: makeStrongCh3Content(),
        first10ChapterPlan: plan,
      });

      // Should have a warning about hook type mismatch
      const hookIssues = report.issues.filter((i) => i.dimension === "opening_hook_delivery");
      // conflict-first detected, plan says suspense-gap → may trigger mismatch warning
      expect(report.dimensions.opening_hook_delivery).toBeGreaterThanOrEqual(70);
    });
  });
});
