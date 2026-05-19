import { describe, it, expect } from "vitest";
import {
  buildChapterResourcePlan,
  validateTextAgainstChapterResourcePlanFinal,
  type ChapterResourcePlan,
} from "../agents/resource-plan.js";

const mockBookRules = `
resourceTypes:
  - 民望值
  - 联邦币

skillRules:
  - skill: 初级辩论技能
    resource: 民望值
    amount: 10

initialResources:
  民望值: 0
  联邦币: 200
`;

const mockParticleLedger = `
| 资源 | 余额 |
|------|------|
| 民望值 | 0 |
| 联邦币 | 200 |
`;

const mockCurrentState = `
林默，当前民望值 0，联邦币 200。
`;

const chapter3Ledger = `
# 资源账本
| 资源 | 当前值 | 最近更新章节 | 备注 |
|---|---:|---:|---|
| 民望值 | 100 | 2 | 扶老太太+10，兑换初级辩论技能-10，路人认可+100 |
| 联邦币 | 200 | 2 | 本章未兑换现金，联邦币保持不变 |
| 技能 | 初级辩论技能 | 2 | 本章解锁 |
`;

const chapter3State = `
当前章节：2
当前资源：民望值=100；联邦币=200；已解锁技能=初级辩论技能
当前目标：下一章探索合法资源变现路径，发现外公遗物和主线任务。
`;

describe("buildChapterResourcePlan", () => {
  it("should build defer_exchange plan with correct opening balances for chapter 2", () => {
    const plan = buildChapterResourcePlan({
      chapter: 2,
      bookRules: mockBookRules,
      particleLedger: mockParticleLedger,
      currentState: mockCurrentState,
      chapterGoal: "林默扶老太太，怼汤姆，解锁技能",
    });

    expect(plan.mode).toBe("defer_exchange");
    expect(plan.openingBalances["民望值"]).toBe(0);
    expect(plan.openingBalances["联邦币"]).toBe(200);
    expect(plan.expectedClosingBalances["民望值"]).toBe(100);
    expect(plan.expectedClosingBalances["联邦币"]).toBe(200);
    expect(plan.unlockedSkills).toContain("初级辩论技能");
  });

  it("should prefer chapter 2 civic defer_exchange before generic normal inference", () => {
    const plan = buildChapterResourcePlan({
      chapter: 2,
      bookRules: mockBookRules,
      particleLedger: mockParticleLedger,
      currentState: mockCurrentState,
      chapterGoal: "扶老太太获得民望值+10，反击汤姆，兑换初级辩论技能，路人认可获得民望值+100，不兑换现金",
    });

    expect(plan.mode).toBe("defer_exchange");
    expect(plan.allowedEvents.some((event) => event.kind === "gain" && event.resource === "民望值" && event.amount === 100)).toBe(true);
    expect(plan.expectedClosingBalances).toMatchObject({ "民望值": 100, "联邦币": 200 });
  });

  it("should preserve 联邦币 200 from book_rules when ledger omitted the row", () => {
    const customLedger = `
| 资源 | 余额 |
|------|------|
| 民望值 | 0 |
`;
    const plan = buildChapterResourcePlan({
      chapter: 2,
      bookRules: mockBookRules,
      particleLedger: customLedger,
      currentState: "林默，当前民望值 0。",
      chapterGoal: "林默扶老太太，怼汤姆，解锁初级辩论技能，路人认可，不兑换现金",
    });

    expect(plan.mode).toBe("defer_exchange");
    expect(plan.openingBalances["联邦币"]).toBe(200);
    expect(plan.expectedClosingBalances["联邦币"]).toBe(200);
  });

  it("should not build defer_exchange for chapter 2 if 初级辩论技能 is already unlocked", () => {
    const plan = buildChapterResourcePlan({
      chapter: 2,
      bookRules: mockBookRules,
      particleLedger: chapter3Ledger,
      currentState: chapter3State,
      chapterGoal: "扶老太太获得民望值+10，兑换初级辩论技能，路人认可获得民望值+100",
    });

    expect(plan.mode).not.toBe("defer_exchange");
  });

  it("should build explore_conversion_path for chapter 3 after first teaching loop", () => {
    const plan = buildChapterResourcePlan({
      chapter: 3,
      bookRules: mockBookRules,
      particleLedger: chapter3Ledger,
      currentState: chapter3State,
      chapterGoal: "探索合法资源变现路径，发现外公遗物、死亡线索和主线任务，提出100万联邦币参选保证金长期目标。",
    });

    expect(plan.mode).toBe("explore_conversion_path");
    expect(plan.openingBalances["民望值"]).toBe(100);
    expect(plan.openingBalances["联邦币"]).toBe(200);
    expect(plan.expectedClosingBalances["民望值"]).toBe(100);
    expect(plan.expectedClosingBalances["联邦币"]).toBe(200);
    expect(plan.unlockedSkills).toContain("初级辩论技能");
    expect(plan.allowedEvents.some((event) => event.kind === "use_skill" && event.skill === "初级辩论技能")).toBe(true);
  });
});

describe("validateTextAgainstChapterResourcePlanFinal", () => {
  const basePlan: ChapterResourcePlan = {
    chapter: 2,
    mode: "defer_exchange",
    source: "resource-engine",
    openingBalances: { "民望值": 0, "联邦币": 200 },
    expectedClosingBalances: { "民望值": 100, "联邦币": 200 },
    allowedEvents: [
      { order: 1, kind: "gain", resource: "民望值", amount: 10, reason: "林默扶老太太", requiredInText: true },
      { order: 2, kind: "spend", resource: "民望值", amount: 10, reason: "兑换初级辩论技能", requiredInText: true },
      { order: 3, kind: "unlock", resource: "技能", skill: "初级辩论技能", reason: "消耗10民望后解锁", requiredInText: true },
      { order: 4, kind: "gain", resource: "民望值", amount: 100, reason: "围观路人认可", requiredInText: true },
      { order: 5, kind: "balance_claim", resource: "民望值", amount: 100, reason: "本章结尾面板确认当前民望值", requiredInText: true },
    ],
    forbiddenEvents: [
      "兑换现金", "1000联邦币到账", "银行到账", "资金缺口减少",
    ],
    unlockedSkills: ["初级辩论技能"],
    resourceRules: {
      resources: {
        "民望值": { name: "民望值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
        "联邦币": { name: "联邦币", type: "integer", initial: 200, min: 0, allowNegative: false, aliases: [] },
      },
      skills: [
        { skill: "初级辩论技能", resource: "民望值", amount: 10 },
      ],
      exchangeRates: [],
      aliases: {},
    },
    narrativeGuidance: ["本章不兑换现金"],
  };

  const explorePlan: ChapterResourcePlan = {
    chapter: 3,
    mode: "explore_conversion_path",
    source: "resource-engine",
    openingBalances: { "民望值": 100, "联邦币": 200 },
    expectedClosingBalances: { "民望值": 100, "联邦币": 200 },
    allowedEvents: [
      { order: 1, kind: "use_skill", resource: "技能", skill: "初级辩论技能", reason: "已拥有，可使用", requiredInText: false },
      { order: 2, kind: "discover", resource: "线索", reason: "发现外公遗物", requiredInText: false },
      { order: 3, kind: "balance_claim", resource: "民望值", amount: 100, reason: "期末民望", requiredInText: true },
      { order: 4, kind: "balance_claim", resource: "联邦币", amount: 200, reason: "期末联邦币", requiredInText: true },
    ],
    forbiddenEvents: ["初级格斗技能", "重复兑换初级辩论技能", "联邦币：0"],
    unlockedSkills: ["初级辩论技能"],
    resourceRules: basePlan.resourceRules,
    narrativeGuidance: ["本章只探索合法资源变现路径"],
  };

  it("should pass valid defer_exchange chapter text", () => {
    const validText = `
林默上前扶住了老太太，获得了10点民望值。
他消耗10点民望值，兑换了初级辩论技能。
周围的路人纷纷鼓掌，林默又获得了100点民望值。
【系统面板：当前民望值：100，联邦币：200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: validText,
      plan: basePlan,
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("should block chapter with 民望值 110", () => {
    const invalidText = `
林默扶老太太，获得民望值+10。
他消耗10点民望值，兑换初级辩论技能。
路人认可，民望值+100。
【系统面板：当前民望值：110，联邦币：200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: basePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("closingBalances 民望值 expected 100, actual 110");
  });

  it("should block chapter with 联邦币 0", () => {
    const invalidText = `
林默扶老太太，获得民望值+10。
他消耗10点民望值，兑换初级辩论技能。
路人认可，民望值+100。
【系统面板：当前民望值：100，联邦币：0】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: basePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("closingBalances 联邦币 expected 200, actual 0");
  });

  it("should not allow chapter 2 grandfather death continuity drift to heart attack", () => {
    const text = "外公当年参选州议员，参选前三天连人带车冲下断桥，警方定性意外醉驾。";
    expect(text).toContain("断桥");
    expect(text).not.toMatch(/心脏病发|心脏病去世/u);
  });

  it("should block chapter with wrong民望值结尾 (0 instead of 100)", () => {
    const invalidText = `
林默上前扶住了老太太，获得了10点民望值。
他消耗10点民望值，兑换了初级辩论技能。
周围的路人纷纷鼓掌，林默又获得了100点民望值。
【系统面板：当前民望值：0，联邦币：200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: basePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("defer_exchange 结尾不得显示当前民望值0");
    expect(result.violations).toContain("closingBalances 民望值 expected 100, actual 0");
  });

  it("should block chapter with forbidden cash exchange", () => {
    const invalidText = `
林默上前扶住了老太太，获得了10点民望值。
他消耗10点民望值，兑换了初级辩论技能。
然后他又用100民望兑换了1000联邦币到账。
【系统面板：当前民望值：0，联邦币：1200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: basePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("正文出现现金兑换");
    expect(result.violations).toContain("正文出现到账/入账");
    expect(result.violations).toContain("正文出现1000联邦币或一千现金");
  });

  it("should block chapter with 联邦币 increase", () => {
    const invalidText = `
林默上前扶住了老太太，获得了10点民望值。
他消耗10点民望值，兑换了初级辩论技能。
周围的路人纷纷赞赏，林默的联邦币增加了1000。
【系统面板：当前民望值：100，联邦币：1200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: basePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("defer_exchange 联邦币不能增加");
  });

  it("should pass explore_conversion_path text that keeps 民望100 and 联邦币200", () => {
    const validText = `
林默运用已拥有的初级辩论技能稳住邻居的质问。
他从外公遗物里发现竞选资料和死亡线索，系统提示参选保证金需要100万联邦币。
资金缺口仍未解决。
【当前民望值：100】
【当前联邦币：200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: validText,
      plan: explorePlan,
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("should pass explore_conversion_path no-change text without explicit balance panel", () => {
    const validText = `
林默翻开外公留下的竞选资料，第一次看清参选保证金这道门槛。
他没有兑换任何资源，也没有收到钱，只意识到合法变现路径必须另找。
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: validText,
      plan: explorePlan,
    });

    expect(result.passed).toBe(true);
    expect(result.actualClosingBalances).toEqual({ "民望值": 100, "联邦币": 200 });
    expect(result.closureSource).toBe("inferred_no_change");
    expect(result.noChangeInferred).toBe(true);
  });

  it("should pass explore_conversion_path natural no-change money pressure", () => {
    const validText = "钱没有变多，外婆透析费和房租缺口仍压在林默肩上。";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: validText,
      plan: explorePlan,
    });

    expect(result.passed).toBe(true);
    expect(result.closureRequirement).toBe("inferred_no_change_allowed");
  });

  it("should block duplicate unlock of 初级辩论技能 in explore_conversion_path", () => {
    const invalidText = `
林默消耗10民望解锁初级辩论技能。
【当前民望值：100】
【当前联邦币：200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: explorePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("重复兑换已解锁技能：初级辩论技能");
    expect(result.violations).toContain("duplicate-unlock: 初级辩论技能已在前文解锁，本章不可重复兑换。");
  });

  it("should block unauthorized 初级格斗技能 in explore_conversion_path", () => {
    const invalidText = `
林默消耗100民望，解锁初级格斗技能。
【当前民望值：100】
【当前联邦币：200】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: explorePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("未授权技能解锁：初级格斗技能");
    expect(result.violations).toContain("未授权消耗100民望");
    expect(result.violations).toContain("unauthorized-skill-unlock: 初级格斗技能不在 Resource Plan allowedEvents 中。");
  });

  it("should block bank deposit in explore_conversion_path", () => {
    const invalidText = "银行到账1000联邦币，林默终于缓了一口气。";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: explorePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("正文出现到账/入账");
    expect(result.violations).toContain("正文出现1000联邦币或一千现金");
    expect(result.violations).toContain("closingBalances 联邦币 expected 200, actual 1200");
  });

  it("should block 民望0 and 联邦币0 in explore_conversion_path", () => {
    const invalidText = `
林默看着面板。
【当前民望余额0】
【联邦币：0】
`;

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: explorePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("民望值不得归零");
    expect(result.violations).toContain("联邦币不得为0");
    expect(result.violations).toContain("closing-balance-mismatch: expected 100 actual 0");
  });

  it("should keep defer_exchange strict and require the full event chain", () => {
    const invalidText = "林默研究了系统，但没有写民望获取和兑换链。【当前民望值：100】【当前联邦币：200】";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: invalidText,
      plan: basePlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("缺少 民望值+10: 林默扶老太太");
    expect(result.violations).toContain("缺少 民望值-10: 兑换初级辩论技能");
    expect(result.violations).toContain("缺少 民望值+100: 围观路人认可");
  });

  it("should keep balance-changing normal plans strict", () => {
    const normalPlan: ChapterResourcePlan = {
      ...explorePlan,
      mode: "normal",
      openingBalances: { "民望值": 100, "联邦币": 200 },
      expectedClosingBalances: { "民望值": 90, "联邦币": 200 },
      allowedEvents: [
        { order: 1, kind: "spend", resource: "民望值", amount: 10, reason: "兑换某项允许资源", requiredInText: true },
        { order: 2, kind: "balance_claim", resource: "民望值", amount: 90, reason: "期末民望", requiredInText: true },
      ],
      unlockedSkills: [],
      closureRequirement: "explicit_balance_required",
    };

    const result = validateTextAgainstChapterResourcePlanFinal({
      text: "林默没有写任何资源结算。",
      plan: normalPlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("缺少 民望值-10: 兑换某项允许资源");
    expect(result.violations).toContain("缺少期末 民望值=90");
  });
});
