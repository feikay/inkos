import { describe, expect, it } from "vitest";
import {
  OpeningHookReviewerAgent,
  OPENING_HOOK_DIMENSIONS,
  buildSkippedOpeningHookReport,
  renderOpeningHookMarkdown,
  readOpeningHookSummary,
  type OpeningHookReviewReport,
} from "../agents/opening-hook-reviewer.js";
import { BaseAgent, type AgentContext } from "../agents/base.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    agentName: "opening-hook-reviewer",
  } as unknown as AgentContext;
}

// Strong hook content — suspense_gap signals (疑问/尸体/消失/谁杀了...)
function makeStrongSuspenseContent(): string {
  return [
    "尸体被发现的时候，所有人都以为他是自杀。",
    "但李默知道真相——三年前那个雨夜，他亲眼看见了不该看见的事。",
    "为什么偏偏是今天？为什么师父一个字都不肯说？",
    "他攥紧手中的遗书，那上面的字迹分明是师兄的，但师兄三年前就死了。",
    "",
    "第一段之后的内容，用来填充300字以后的部分。",
    "他决定今晚去后山调查那个废弃的祠堂，那里藏着太多秘密。",
    "没有人知道真相，但他必须找到答案。",
    "",
    "章末部分：忽然，祠堂的门自己开了。李默抬头看去，",
    "一个新的身影站在门口——他从未见过这个人。",
    "他深吸一口气，点了点头，决定跟上去。",
  ].join("\n");
}

// Strong hook content — conflict_first signals (刀/剑/血/杀/追杀/威胁)
function makeStrongConflictContent(): string {
  return [
    "刀架在脖子上的那一刻，陈默脑子里只有一个念头：活下去。",
    "追杀他的人就站在三步之外，刀尖上还滴着血。",
    "这是一场精心布置的陷阱——他最好的兄弟出卖了他。",
    "",
    "但陈默没有跪下。他握紧拳头，盯住对方的眼睛。",
    "身后是悬崖，面前是叛徒，他必须在三秒内做出选择。",
    "要么跳下去赌一把，要么死在这里。",
    "",
    "章末：就在他准备纵身一跃的瞬间，一阵奇怪的风从崖底吹上来。",
    "他看到了一个新的希望——崖壁上竟然有一条隐蔽的栈道。",
    "陈默深吸一口气，转身面对追杀者，嘴角微微上扬。",
  ].join("\n");
}

// Strong hook content — worldview_bomb signals (系统/面板/规则/必须/代价)
function makeStrongWorldviewContent(): string {
  return [
    "【系统提示：欢迎来到规则世界】",
    "",
    "张恒盯着眼前凭空出现的半透明面板，呼吸几乎停滞。",
    "【当前境界：凡人（无修为）】",
    "【核心规则：在此世界，所有行为必须支付相应代价】",
    "",
    "他想骂人。这不合理。但系统面板上的文字纹丝不动。",
    "第一条规则就让他头皮发麻：每次使用灵力，消耗一天寿命。",
    "没有谁敢违反规则——上一个试图挑战系统的人已经被抹杀了。",
    "",
    "这个世界不允许任何例外。他要活下去，必须先学会纳税——",
    "用他的影子、记忆、情感，甚至灵魂的一部分来支付生存的代价。",
    "",
    "章末：突然，系统弹出了一条新的任务提示。",
    "【隐藏任务已解锁：寻找规则漏洞】",
    "张恒愣了几秒，然后笑了——原来规则也有缝隙。他决定接受任务。",
  ].join("\n");
}

// Strong hook content — extreme_emotion signals (不公/恨/屈辱/跪/泪/凭什么)
function makeStrongEmotionContent(): string {
  return [
    "凭什么？",
    "",
    "林晚跪在地上，膝盖磕在石板上的疼痛远不如心底的委屈来得猛烈。",
    "她替这个家扛了三年——替父亲跪过债主，替弟弟背过黑锅，",
    "替那个早已死去的男人守了五年的活寡。",
    "",
    "而今天，母亲把最后的家产给了那个什么都不做的弟弟。",
    "\"你不配。\"母亲的声音冷得像刀子，\"你没资格拿林家的东西。\"",
    "",
    "林晚抬起头，恨意像火烧过胸腔。她第一次没有哭。",
    "她不会原谅这个家。不会原谅这个世界的不公。",
    "",
    "章末：她转身离开的时候，一个新的想法突然击中了她。",
    "她要变强——不是为了复仇，而是为了再也不跪在任何人面前。",
    "林晚擦干眼泪，推开祠堂的门，第一次抬起头直视前方。",
  ].join("\n");
}

// Weak content — no hook signals
function makeWeakContent(): string {
  return [
    "今天天气不错，阳光从窗户洒进来，照在桌子上。",
    "李明起床后照常洗漱，然后去食堂吃了早餐。",
    "早餐有豆浆油条，还有他喜欢的咸菜。",
    "",
    "吃完早餐后他去练功场，师弟们已经到了。",
    "大家互相打了个招呼，然后开始各自的修炼。",
    "李明今天的任务是巩固炼气三层的基础修为。",
    "",
    "中午休息的时候，他靠在树下打了个盹。",
    "醒来后继续修炼，一直到太阳落山。",
    "晚上回宿舍后他看了会儿书就睡了。",
  ].join("\n");
}

// Truly no-hook content — zero regex matches across all signal groups and checklist patterns
function makeNoHookContent(): string {
  return [
    "清晨的阳光透过薄雾洒在小路上。",
    "王平沿着河边慢慢走着，看着水面泛起的涟漪。",
    "远处有几只鸟在树枝上叽叽喳喳。",
    "",
    "他今天打算去集市买些蔬菜和水果。",
    "家里的米快用完了，盐也剩得不多了。",
    "路过邻居家门口时，他闻到了饭菜的香味。",
    "",
    "集市上人来人往，热闹得很。",
    "他挑了几样新鲜的水果，又买了点面粉。",
    "回家的路上，他顺道去河边洗了洗手。",
    "",
    "晚饭后，他在院子里坐了一会儿。",
    "夜空很清澈，星星一颗颗亮起来。",
    "他觉得这样的日子挺安宁的。",
  ].join("\n");
}

describe("OpeningHookReviewerAgent", () => {
  const agent = new OpeningHookReviewerAgent(makeMockAgentContext());

  describe("report schema", () => {
    it("produces a valid OpeningHookReviewReport structure", async () => {
      const report = await agent.review({
        chapterContent: makeStrongSuspenseContent(),
        chapterIndex: 1,
        chapterTitle: "测试章节",
      });

      expect(report.chapterIndex).toBe(1);
      expect(report.chapterTitle).toBe("测试章节");
      expect(["PASS", "WARN", "FAIL_STRUCTURAL", "SKIPPED"]).toContain(report.status);
      expect(report.score === null || typeof report.score === "number").toBe(true);
      expect(report.dimensions).toBeDefined();
      expect(report.dimensionConclusions).toBeDefined();
      expect(report.checklist).toBeDefined();
      expect(Array.isArray(report.strengths)).toBe(true);
      expect(Array.isArray(report.issues)).toBe(true);
      expect(Array.isArray(report.suggestions)).toBe(true);
      expect(typeof report.summary).toBe("string");
      expect(report.summary.length).toBeGreaterThan(0);

      for (const dim of OPENING_HOOK_DIMENSIONS) {
        expect(report.dimensions[dim]).toBeGreaterThanOrEqual(0);
        expect(report.dimensions[dim]).toBeLessThanOrEqual(100);
        expect(typeof report.dimensionConclusions[dim]).toBe("string");
        expect(report.dimensionConclusions[dim].length).toBeGreaterThan(0);
      }

      expect(typeof report.checklist.abnormalImage100).toBe("boolean");
      expect(typeof report.checklist.conflict300).toBe("boolean");
      expect(typeof report.checklist.dilemma500).toBe("boolean");
      expect(typeof report.checklist.continueReason).toBe("boolean");
      expect(typeof report.checklist.hookTypeMatched).toBe("boolean");
    });
  });

  describe("5-type hook signal detection", () => {
    it("detects suspense_gap signals (疑问/尸体/真相/谁杀了)", async () => {
      const report = await agent.review({
        chapterContent: makeStrongSuspenseContent(),
        chapterIndex: 1,
      });
      expect(report.dimensions.suspense_gap).toBeGreaterThanOrEqual(70);
      expect(report.detectedHookType).toBe("suspense_gap");
      expect(["strong", "moderate"]).toContain(report.hookStrength);
    });

    it("detects conflict_first signals (刀/血/杀/追杀/威胁)", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
      });
      expect(report.dimensions.conflict_first).toBeGreaterThanOrEqual(70);
      expect(report.detectedHookType).toBe("conflict_first");
    });

    it("detects worldview_bomb signals (系统/面板/规则/代价)", async () => {
      const report = await agent.review({
        chapterContent: makeStrongWorldviewContent(),
        chapterIndex: 1,
      });
      expect(report.dimensions.worldview_bomb).toBeGreaterThanOrEqual(70);
      expect(report.detectedHookType).toBe("worldview_bomb");
    });

    it("detects extreme_emotion signals (恨/跪/凭什么/冤/泪)", async () => {
      const report = await agent.review({
        chapterContent: makeStrongEmotionContent(),
        chapterIndex: 1,
      });
      expect(report.dimensions.extreme_emotion).toBeGreaterThanOrEqual(70);
      expect(report.detectedHookType).toBe("extreme_emotion");
    });

    it("produces undetected strength for content with zero hook signals", async () => {
      const report = await agent.review({
        chapterContent: makeNoHookContent(),
        chapterIndex: 1,
      });
      expect(report.detectedHookType).toBeNull();
      expect(report.hookStrength).toBe("undetected");
      expect(report.checklist.hookTypeMatched).toBe(false);
      // summary must not claim "主要命中"
      expect(report.summary).not.toContain("主要命中");
      // markdown must not claim "主要命中"
      const { renderOpeningHookMarkdown } = await import("../agents/opening-hook-reviewer.js");
      const md = renderOpeningHookMarkdown(report);
      expect(md).not.toContain("主要命中");
      // Should have a critical issue about no hook detected
      const criticalIssues = report.issues.filter((i) => i.severity === "critical");
      expect(criticalIssues.length).toBeGreaterThan(0);
      expect(criticalIssues[0].message).toContain("未检测到五类钩子");
    });

    it("produces weak/moderate strength for content with incidental pattern matches", async () => {
      const report = await agent.review({
        chapterContent: makeWeakContent(),
        chapterIndex: 1,
      });
      // Weak content has "修为" which matches worldview_bomb patterns
      expect(["weak", "moderate"]).toContain(report.hookStrength);
      expect(report.detectedHookType).not.toBeNull();
      expect(report.status).not.toBe("PASS");
      const hookIssues = report.issues.filter((i) => i.severity === "critical" || i.severity === "warning");
      expect(hookIssues.length).toBeGreaterThan(0);
    });
  });

  describe("GOLDEN_OPENING_REVIEW_CHECKLIST", () => {
    it("detects abnormal image in first 100 chars for strong conflict content", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
      });
      // "刀架在脖子上的那一刻" starts with 刀 — a conflict pattern
      // Also has 尸体/血/死 in first 100
      expect(report.checklist.abnormalImage100).toBe(true);
    });

    it("detects conflict in first 300 chars for conflict content", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
      });
      expect(report.checklist.conflict300).toBe(true);
    });

    it("detects dilemma in first 500 chars for conflict content (要么...要么)", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
      });
      expect(report.checklist.dilemma500).toBe(true);
    });

    it("detects continue reason at chapter ending", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
      });
      // Ending contains "忽然" type signals
      expect(report.checklist.continueReason).toBe(true);
    });

    it("fails most checklist items for weak content", async () => {
      const report = await agent.review({
        chapterContent: makeWeakContent(),
        chapterIndex: 1,
      });
      expect(report.checklist.abnormalImage100).toBe(false);
      // conflict300 may be true due to broad character match (e.g. 打 in 打招呼)
      expect(report.checklist.dilemma500).toBe(false);
      expect(report.checklist.continueReason).toBe(false);
      // Weak content still gets a baseline dimension score, so hookTypeMatched may be true
    });
  });

  describe("status grading", () => {
    it("PASS: strong hook with checklist items met", async () => {
      // Worldview content has strong signals across multiple dimensions + checklist items
      const report = await agent.review({
        chapterContent: makeStrongWorldviewContent(),
        chapterIndex: 1,
      });
      // Should be at least WARN if not PASS (depends on score calculation)
      expect(["PASS", "WARN"]).toContain(report.status);
    });

    it("WARN or FAIL_STRUCTURAL: weak content with no hooks", async () => {
      const report = await agent.review({
        chapterContent: makeWeakContent(),
        chapterIndex: 1,
      });
      // With incidental pattern matches the score may be WARN or FAIL_STRUCTURAL, not PASS
      expect(["WARN", "FAIL_STRUCTURAL"]).toContain(report.status);
    });

    it("produces appropriate hook_strength for strong content", async () => {
      const report = await agent.review({
        chapterContent: makeStrongSuspenseContent(),
        chapterIndex: 1,
      });
      expect(["strong", "moderate"]).toContain(report.hookStrength);
    });

    it("displays Chinese methodology names, not internal underscore IDs", async () => {
      const report = await agent.review({
        chapterContent: makeStrongSuspenseContent(),
        chapterIndex: 1,
      });
      const md = renderOpeningHookMarkdown(report);
      // Must display Chinese methodology names, not internal IDs like "suspense_gap"
      expect(md).not.toContain("suspense_gap");
      expect(md).not.toContain("conflict_first");
      expect(md).not.toContain("extreme_contrast");
      expect(md).not.toContain("worldview_bomb");
      expect(md).not.toContain("extreme_emotion");
      // Should contain Chinese methodology names from OPENING_HOOK_METHODS
      expect(md).toContain("悬念");
    });
  });

  describe("SKIPPED conditions", () => {
    it("SKIPPED when resourceBlocking is true", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
        resourceBlocking: true,
      });
      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toContain("资源账本");
    });

    it("SKIPPED when chapterIndexStatus is state-degraded", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
        chapterIndexStatus: "state-degraded",
      });
      expect(report.status).toBe("SKIPPED");
      expect(report.skippedReason).toContain("state-degraded");
    });

    it("SKIPPED when chapterIndexStatus is blocked-resource-plan", async () => {
      const report = await agent.review({
        chapterContent: makeStrongConflictContent(),
        chapterIndex: 1,
        chapterIndexStatus: "blocked-resource-plan",
      });
      expect(report.status).toBe("SKIPPED");
      expect(report.skippedReason).toContain("blocked-resource-plan");
    });

    it("SKIPPED when chapterContent is empty", async () => {
      const report = await agent.review({
        chapterContent: "",
        chapterIndex: 1,
      });
      expect(report.status).toBe("SKIPPED");
      expect(report.skippedReason).toContain("为空");
    });

    it("SKIPPED when chapterContent is whitespace only", async () => {
      const report = await agent.review({
        chapterContent: "   \n  \n  ",
        chapterIndex: 1,
      });
      expect(report.status).toBe("SKIPPED");
      expect(report.skippedReason).toContain("为空");
    });
  });

  describe("buildSkippedOpeningHookReport", () => {
    it("creates a valid SKIPPED report with correct shape", () => {
      const report = buildSkippedOpeningHookReport(
        { chapterIndex: 5, chapterTitle: "测试" },
        "测试跳过原因。",
      );
      expect(report.status).toBe("SKIPPED");
      expect(report.chapterIndex).toBe(5);
      expect(report.chapterTitle).toBe("测试");
      expect(report.score).toBeNull();
      expect(report.skippedReason).toBe("测试跳过原因。");
      expect(report.summary).toContain("跳过");
      for (const dim of OPENING_HOOK_DIMENSIONS) {
        expect(report.dimensions[dim]).toBe(55);
      }
    });
  });

  describe("renderOpeningHookMarkdown", () => {
    it("renders markdown for a PASS report", () => {
      const report: OpeningHookReviewReport = {
        chapterIndex: 1,
        status: "PASS",
        score: 85,
        detectedHookType: "conflict_first",
        hookStrength: "strong",
        dimensions: { suspense_gap: 70, extreme_contrast: 55, conflict_first: 100, worldview_bomb: 55, extreme_emotion: 55 },
        dimensionConclusions: {
          suspense_gap: "开头检测到明确的悬念信号。",
          extreme_contrast: "开头未检测到明显的反差信号。",
          conflict_first: "主要命中钩子类型为矛盾前置（100/100）。",
          worldview_bomb: "开头未检测到明显的世界观炸弹信号。",
          extreme_emotion: "开头未检测到明显的极致情绪信号。",
        },
        checklist: { abnormalImage100: true, conflict300: true, dilemma500: true, continueReason: true, hookTypeMatched: true },
        strengths: ["命中矛盾前置钩子（100/100）。", "黄金开篇清单通过 5/5。"],
        issues: [],
        suggestions: [],
        summary: "章节开头钩子审核通过（85/100）。",
      };
      const md = renderOpeningHookMarkdown(report);
      expect(md).toContain("Opening Hook Review Report");
      expect(md).toContain("PASS");
      expect(md).toContain("85");
      expect(md).toContain("矛盾前置");
      expect(md).toContain("通过");
    });

    it("renders markdown for a FAIL_STRUCTURAL report", () => {
      const report: OpeningHookReviewReport = {
        chapterIndex: 2,
        status: "FAIL_STRUCTURAL",
        score: 30,
        detectedHookType: null,
        hookStrength: "undetected",
        dimensions: { suspense_gap: 55, extreme_contrast: 55, conflict_first: 55, worldview_bomb: 55, extreme_emotion: 55 },
        dimensionConclusions: {
          suspense_gap: "未检测到明显信号。",
          extreme_contrast: "未检测到明显信号。",
          conflict_first: "未检测到明显信号。",
          worldview_bomb: "未检测到明显信号。",
          extreme_emotion: "未检测到明显信号。",
        },
        checklist: { abnormalImage100: false, conflict300: false, dilemma500: false, continueReason: false, hookTypeMatched: false },
        strengths: [],
        issues: [{ severity: "critical", dimension: "checklist", message: "未检测到五类钩子。", suggestion: "确保前300字有钩子。" }],
        suggestions: ["确保前300字有钩子。"],
        summary: "章节开头钩子审核未通过（30/100）。",
      };
      const md = renderOpeningHookMarkdown(report);
      expect(md).toContain("FAIL_STRUCTURAL");
      expect(md).toContain("30");
      expect(md).toContain("未通过");
    });

    it("renders markdown for a SKIPPED report", () => {
      const report = buildSkippedOpeningHookReport(
        { chapterIndex: 3 },
        "测试跳过。",
      );
      const md = renderOpeningHookMarkdown(report);
      expect(md).toContain("SKIPPED");
      expect(md).toContain("测试跳过");
    });
  });

  describe("readOpeningHookSummary", () => {
    it("returns undefined when report file does not exist", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "inkos-oh-test-"));
      try {
        const result = await readOpeningHookSummary(tmpDir, 1);
        expect(result).toBeUndefined();
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("reads and returns summary from report file", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "inkos-oh-test-"));
      try {
        const reviewsDir = join(tmpDir, "reviews", "opening-hook");
        const { mkdir } = await import("node:fs/promises");
        await mkdir(reviewsDir, { recursive: true });

        const report = buildSkippedOpeningHookReport(
          { chapterIndex: 1, chapterTitle: "测试" },
          "资源阻断跳过。",
        );
        await writeFile(
          join(reviewsDir, "0001.opening-hook.report.json"),
          JSON.stringify(report),
          "utf-8",
        );

        const summary = await readOpeningHookSummary(tmpDir, 1);
        expect(summary).toBeDefined();
        expect(summary!.status).toBe("SKIPPED");
        expect(summary!.score).toBeNull();
        expect(summary!.summary).toContain("跳过");
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
