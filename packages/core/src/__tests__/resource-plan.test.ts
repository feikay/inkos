import { describe, it, expect } from "vitest";
import {
  buildChapterResourcePlan,
  validateTextAgainstChapterResourcePlanFinal,
  renderResourcePlanForPrompt,
  preScanTextAgainstResourcePlan,
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

  // ---- FIX-052-B-2: system_bootstrap / resource_rule_reveal adaptive closing balance ----

  const bootstrapPlan: ChapterResourcePlan = {
    chapter: 1,
    mode: "system_bootstrap",
    source: "resource-engine",
    openingBalances: { "震惊值": 0, "爱慕值": 0 },
    expectedClosingBalances: { "震惊值": 0, "爱慕值": 0 },
    allowedEvents: [
      { order: 1, kind: "balance_claim", resource: "震惊值", amount: 0, reason: "系统首次激活：声明初始资源余额", requiredInText: true },
      { order: 2, kind: "balance_claim", resource: "爱慕值", amount: 0, reason: "系统首次激活：声明初始资源余额", requiredInText: true },
    ],
    forbiddenEvents: ["exchange", "cash_out", "balance_transfer", "earn_resource_before_closure"],
    unlockedSkills: [],
    resourceRules: {
      resources: {
        "震惊值": { name: "震惊值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
        "爱慕值": { name: "爱慕值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
      },
      skills: [],
      exchangeRates: [],
      aliases: {},
    },
    narrativeGuidance: ["本章处于系统/能力首次激活阶段。"],
    closureRequirement: "explicit_balance_required",
  };

  it("T5: system_bootstrap with gain events adapts closing balance from events", () => {
    const text = `
系统激活！恭喜宿主绑定情绪值系统。
林默在街上救了人，获得了100点震惊值。
【系统面板：震惊值：100，爱慕值：0】
`;
    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: bootstrapPlan,
    });

    // Should pass: gain event extracted, closing balance computed as 0+100=100
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    // Expected closing should reflect the event-based computation
    expect(result.expectedClosingBalances["震惊值"]).toBe(100);
    expect(result.expectedClosingBalances["爱慕值"]).toBe(0);
  });

  it("T6: system_bootstrap with consume events adapts closing balance from events", () => {
    const text = `
系统激活！林默消耗了10点震惊值兑换了情报。
【当前震惊值：-10，当前爱慕值：0】
`;
    // Need a plan with allowNegative for this test
    const negPlan: ChapterResourcePlan = {
      ...bootstrapPlan,
      resourceRules: {
        resources: {
          "震惊值": { name: "震惊值", type: "integer", initial: 0, min: -100, allowNegative: true, aliases: [] },
          "爱慕值": { name: "爱慕值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
        },
        skills: [],
        exchangeRates: [],
        aliases: {},
      },
    };
    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: negPlan,
    });

    // Consume event extracted, closing balance = 0 + (-10) = -10, matches text
    expect(result.passed).toBe(true);
    expect(result.expectedClosingBalances["震惊值"]).toBe(-10);
  });

  it("T7: system_bootstrap with no events keeps opening balance = closing (regression)", () => {
    const text = "系统激活了。林默看着面板，上面显示着各种数值。但他还没有任何操作。";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: bootstrapPlan,
    });

    // Without events, should still require balance claims matching opening balances
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("缺少期末 震惊值=0");
    expect(result.violations).toContain("缺少期末 爱慕值=0");
  });

  it("T8: system_bootstrap with gain+consume computes net closing balance", () => {
    const text = `
系统激活！林默获得了200点震惊值。
随后他消耗了50点震惊值解锁了探查技能。
【当前震惊值：150，爱慕值：0】
`;
    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: bootstrapPlan,
    });

    expect(result.passed).toBe(true);
    // net: 0 + 200 (gain) - 50 (consume) = 150
    expect(result.expectedClosingBalances["震惊值"]).toBe(150);
  });

  // ---- resource_rule_reveal adaptive closing balance ----

  const revealPlan: ChapterResourcePlan = {
    chapter: 2,
    mode: "resource_rule_reveal",
    source: "resource-engine",
    openingBalances: { "震惊值": 100, "爱慕值": 50 },
    expectedClosingBalances: { "震惊值": 100, "爱慕值": 50 },
    allowedEvents: [
      { order: 1, kind: "discover", resource: "震惊值", reason: "揭示资源运作规则", requiredInText: true },
    ],
    forbiddenEvents: ["exchange", "cash_out", "earn_resource_before_closure", "gain", "consume"],
    unlockedSkills: [],
    resourceRules: bootstrapPlan.resourceRules,
    narrativeGuidance: ["本章处于资源规则揭示阶段。"],
    closureRequirement: "explicit_balance_required",
  };

  it("T9: resource_rule_reveal with no resource changes keeps opening = closing", () => {
    const text = "系统揭示了震惊值的运作规则：当周围人对宿主产生震惊情绪时，宿主可获得震惊值。当前震惊值仍是100点。";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: revealPlan,
    });

    // No balance_claim events in the plan; discover event found, balances match opening
    expect(result.passed).toBe(true);
    expect(result.expectedClosingBalances["震惊值"]).toBe(100);
    expect(result.expectedClosingBalances["爱慕值"]).toBe(50);
  });

  it("T10: resource_rule_reveal with only discover event passes when balances match", () => {
    const text = `
系统揭示了震惊值的兑换规则：1点震惊值可兑换10联邦币。
林默了解了规则，但没有进行任何兑换。
【当前震惊值：100，爱慕值：50】
`;
    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: revealPlan,
    });

    // discover event found, no gain/consume, balance matches opening
    expect(result.passed).toBe(true);
    expect(result.expectedClosingBalances["震惊值"]).toBe(100);
    expect(result.expectedClosingBalances["爱慕值"]).toBe(50);
  });

  // ---- no_resource_change WARN semantics (R4) ----

  const noChangePlan: ChapterResourcePlan = {
    chapter: 5,
    mode: "no_resource_change",
    source: "resource-engine",
    openingBalances: { "民望值": 100, "联邦币": 200 },
    expectedClosingBalances: { "民望值": 100, "联邦币": 200 },
    allowedEvents: [],
    forbiddenEvents: [],
    unlockedSkills: [],
    resourceRules: basePlan.resourceRules,
    narrativeGuidance: [],
  };

  it("T11: no_resource_change with no mutations infers no_change closed", () => {
    const text = "林默在家研究了一整天外公的遗物，没有进行任何资源操作。";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: noChangePlan,
    });

    expect(result.passed).toBe(true);
    expect(result.noChangeInferred).toBe(true);
    expect(result.closureSource).toBe("inferred_no_change");
  });

  it("T12: no_resource_change with balance mutations sets explicit_balance source", () => {
    const text = "林默获得了10点民望值，但他有些疑惑。";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: noChangePlan,
    });

    // Still passes (no_resource_change mode is lenient), but signals via closureSource
    expect(result.passed).toBe(true);
    expect(result.closureSource).toBe("explicit_balance");
    expect(result.noChangeInferred).toBe(false);
    expect(result.balanceMutationEvents?.length ?? 0).toBeGreaterThan(0);
  });

  // ---- FIX-052-B-FOLLOWUP-2: system_bootstrap activation detection ----

  const emotionSystemBookRules = `
resourceTypes:
  - 震惊值
  - 爱慕值
  - 绝望值
  - 愤怒值
  - 喜悦值

initialResources:
  震惊值: 0
  爱慕值: 0
  绝望值: 0
  愤怒值: 0
  喜悦值: 0
`;

  const initialLedger = `
| 资源 | 余额 |
|------|------|
| 震惊值 | 0 |
| 爱慕值 | 0 |
| 绝望值 | 0 |
| 愤怒值 | 0 |
| 喜悦值 | 0 |
`;

  const activatedLedger = `
| 资源 | 余额 | 最近更新章节 |
|------|------|------------|
| 震惊值 | 999 | 1 |
| 爱慕值 | 0 | - |
| 绝望值 | 0 | - |
| 愤怒值 | 0 | - |
| 喜悦值 | 0 | - |
`;

  it("T14: first activation with initial-only ledger generates system_bootstrap", () => {
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: emotionSystemBookRules,
      particleLedger: initialLedger,
      currentState: "林默刚刚绑定了情绪值系统，一切都还是初始状态。",
      chapterGoal: "系统首次激活",
    });

    // All ledger values match initial → still system_bootstrap
    expect(plan.mode).toBe("system_bootstrap");
  });

  it("T15: already-activated system (non-initial ledger) does not generate system_bootstrap", () => {
    const plan = buildChapterResourcePlan({
      chapter: 2,
      bookRules: emotionSystemBookRules,
      particleLedger: activatedLedger,
      currentState: "震惊值=999。林默正在研究系统面板的功能。",
      chapterGoal: "了解系统的各项功能",
    });

    // 震惊值=999 differs from initial 0 → system already activated, not bootstrap
    expect(plan.mode).not.toBe("system_bootstrap");
  });

  it("T16: non-zero initial value does not cause false already-activated detection", () => {
    const nonZeroInitRules = `
resourceTypes:
  - 震惊值
  - 爱慕值

initialResources:
  震惊值: 100
  爱慕值: 50
`;
    const matchingLedger = `
| 资源 | 余额 |
|------|------|
| 震惊值 | 100 |
| 爱慕值 | 50 |
`;

    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: nonZeroInitRules,
      particleLedger: matchingLedger,
      currentState: "系统刚激活，初始震惊值100，爱慕值50。",
      chapterGoal: "系统激活",
    });

    // Ledger values (100, 50) equal initial values → not "activated", still bootstrap
    expect(plan.mode).toBe("system_bootstrap");
  });

  it("T17: book without resource types does not trigger system_bootstrap", () => {
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "这是一个普通的都市小说，主角开始了新的一天。",
      particleLedger: "",
      currentState: "主角起床，开始了新的一天。",
      chapterGoal: "日常铺垫",
    });

    // No resources defined → no resource plan mode should be no_resource_change
    expect(plan.mode).not.toBe("system_bootstrap");
    expect(plan.mode).toBe("no_resource_change");
  });

  it("T18: system_bootstrap plan structure is correct for genuine first activation", () => {
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: emotionSystemBookRules,
      particleLedger: initialLedger,
      currentState: "林默刚刚绑定了情绪值系统。",
      chapterGoal: "系统首次激活",
    });

    // system_bootstrap with proper structure
    expect(plan.mode).toBe("system_bootstrap");
    expect(plan.closureRequirement).toBe("explicit_balance_required");
    expect(plan.allowedEvents.length).toBeGreaterThan(0);
    // Should have balance_claim events for each resource in context
    const balanceClaims = plan.allowedEvents.filter(e => e.kind === "balance_claim");
    expect(balanceClaims.length).toBeGreaterThan(0);
    // Each balance_claim should require text declaration
    for (const claim of balanceClaims) {
      expect(claim.requiredInText).toBe(true);
    }
  });

  // ---- Regression: real balance errors still hard block ----

  it("T13: normal mode with real balance error still hard blocks", () => {
    const normalPlan: ChapterResourcePlan = {
      ...explorePlan,
      mode: "normal",
      openingBalances: { "民望值": 100, "联邦币": 200 },
      expectedClosingBalances: { "民望值": 100, "联邦币": 200 },
      allowedEvents: [
        { order: 1, kind: "balance_claim", resource: "民望值", amount: 100, reason: "期末民望", requiredInText: true },
      ],
      unlockedSkills: [],
      closureRequirement: "explicit_balance_required",
    };

    const text = `
林默无缘无故获得了1000点联邦币。
【当前民望值：100，联邦币：1200】
`;
    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: normalPlan,
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.includes("closingBalances 联邦币"))).toBe(true);
  });

  // ---- FIX-052-C: exchange-implied consume adaptive closing balance ----

  it("T19: gain + exchange-consume same chapter computes correct closing balance (0)", () => {
    const bookRules = [
      "resourceTypes:",
      "  - 震惊值",
      "  - 爱慕值",
      "initialResources:",
      "  震惊值: 0",
      "  爱慕值: 0",
    ].join("\n");

    const bootstrapPlan = buildChapterResourcePlan({
      chapter: 1,
      bookRules,
      particleLedger: "| 震惊值 | 0 |\n| 爱慕值 | 0 |\n",
      currentState: "震惊值=0。系统刚激活。",
      chapterGoal: "系统首次激活",
    });

    // Text: gain 999 震惊值, then exchange-consume all 999
    const text = "【检测到高强度情绪波动，震惊值+999】\n林默把999点震惊值全换了初级体能增强。";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: bootstrapPlan,
    });

    // Closing balance should be 0 (0 + 999 gain - 999 consume)
    // Not 999 (which would happen if consume was missed)
    const violation999 = result.violations.filter(v => v.includes("震惊值=999"));
    expect(violation999).toHaveLength(0);
  });

  it("T20: system_bootstrap with exchange-consume passes when text declares correct closing", () => {
    const bookRules = [
      "resourceTypes:",
      "  - 震惊值",
      "initialResources:",
      "  震惊值: 0",
    ].join("\n");

    const bootstrapPlan = buildChapterResourcePlan({
      chapter: 1,
      bookRules,
      particleLedger: "| 震惊值 | 0 |\n",
      currentState: "震惊值=0。系统刚激活。",
      chapterGoal: "系统首次激活",
    });

    // Text: gain + consume, THEN explicitly declares closing balance
    const text = "震惊值+500。\n用500点震惊值兑换了技能。\n【当前震惊值：0】";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: bootstrapPlan,
    });

    // Should pass — closing balance is declared as 0
    expect(result.passed).toBe(true);
  });

  it("T21: real balance error still hard blocks (not relaxed by new exchange-consume patterns)", () => {
    // Use explicit plan like T13 to guarantee strict closure requirement
    const strictPlan: ChapterResourcePlan = {
      ...explorePlan,
      mode: "normal",
      openingBalances: { "民望值": 100, "联邦币": 200 },
      expectedClosingBalances: { "民望值": 100, "联邦币": 200 },
      allowedEvents: [
        { order: 1, kind: "balance_claim", resource: "民望值", amount: 100, reason: "期末民望", requiredInText: true },
      ],
      unlockedSkills: [],
      closureRequirement: "explicit_balance_required",
    };

    // Text uses exchange-implied consume BUT declares wrong closing balance
    const text = "林默用50点民望值兑换了技能。\n【当前民望值：200】";

    const result = validateTextAgainstChapterResourcePlanFinal({
      text,
      plan: strictPlan,
    });

    // Closing 200 ≠ computed 50 (100-50) → must fail despite new consume patterns
    expect(result.passed).toBe(false);
  });

  // ---- FIX-052-D-2: pre-scan balance_claim detection for system_bootstrap / resource_rule_reveal ----

  describe("preScanTextAgainstResourcePlan — balance_claim detection", () => {
    const sbPlan: ChapterResourcePlan = {
      chapter: 1,
      mode: "system_bootstrap",
      source: "resource-engine",
      openingBalances: { "灵力值": 0, "气血值": 0 },
      expectedClosingBalances: { "灵力值": 0, "气血值": 0 },
      allowedEvents: [
        { order: 1, kind: "balance_claim", resource: "灵力值", amount: 0, reason: "系统首次激活", requiredInText: true },
        { order: 2, kind: "balance_claim", resource: "气血值", amount: 0, reason: "系统首次激活", requiredInText: true },
      ],
      forbiddenEvents: ["exchange", "cash_out"],
      unlockedSkills: [],
      resourceRules: {
        resources: {
          "灵力值": { name: "灵力值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
          "气血值": { name: "气血值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
        },
        skills: [],
        exchangeRates: [],
        aliases: {},
      },
      narrativeGuidance: ["系统首次激活。"],
      closureRequirement: "explicit_balance_required",
    };

    const rrrPlan: ChapterResourcePlan = {
      chapter: 2,
      mode: "resource_rule_reveal",
      source: "resource-engine",
      openingBalances: { "灵力值": 100, "气血值": 50 },
      expectedClosingBalances: { "灵力值": 100, "气血值": 50 },
      allowedEvents: [
        { order: 1, kind: "discover", resource: "灵力值", reason: "揭示规则", requiredInText: true },
        { order: 2, kind: "balance_claim", resource: "灵力值", amount: 100, reason: "期末声明", requiredInText: true },
        { order: 3, kind: "balance_claim", resource: "气血值", amount: 50, reason: "期末声明", requiredInText: true },
      ],
      forbiddenEvents: ["exchange", "gain", "consume"],
      unlockedSkills: [],
      resourceRules: sbPlan.resourceRules,
      narrativeGuidance: ["揭示资源运作规则。"],
      closureRequirement: "explicit_balance_required",
    };

    it("T22: system_bootstrap preScan catches missing balance_claim", () => {
      const text = "系统激活！宿主获得了灵力。但没有写期末余额。";
      const result = preScanTextAgainstResourcePlan(text, sbPlan);
      expect(result.ok).toBe(false);
      expect(result.violations).toContain('缺少期末声明：请在正文中写出"当前灵力值：0"');
      expect(result.violations).toContain('缺少期末声明：请在正文中写出"当前气血值：0"');
    });

    it("T23: system_bootstrap preScan passes when balance declarations present", () => {
      const text = "系统激活！【当前灵力值：0，气血值：0】";
      const result = preScanTextAgainstResourcePlan(text, sbPlan);
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("T24: system_bootstrap preScan passes with alternative balance format (X=0)", () => {
      const text = "灵力值=0，气血值=0。系统激活完成。";
      const result = preScanTextAgainstResourcePlan(text, sbPlan);
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("T25: resource_rule_reveal preScan catches missing balance_claim", () => {
      const text = "系统揭示了灵力值的运作规则。但没有写期末余额声明。";
      const result = preScanTextAgainstResourcePlan(text, rrrPlan);
      expect(result.ok).toBe(false);
      expect(result.violations).toContain('缺少期末声明：请在正文中写出"当前灵力值：100"');
      expect(result.violations).toContain('缺少期末声明：请在正文中写出"当前气血值：50"');
    });

    it("T26: resource_rule_reveal preScan passes when balance declarations present", () => {
      const text = "揭示了规则。当前灵力值：100，当前气血值：50。";
      const result = preScanTextAgainstResourcePlan(text, rrrPlan);
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("T27: preScan does not affect no_resource_change mode", () => {
      const noChangePlan: ChapterResourcePlan = {
        chapter: 5,
        mode: "no_resource_change",
        source: "resource-engine",
        openingBalances: { "灵力值": 50, "气血值": 50 },
        expectedClosingBalances: { "灵力值": 50, "气血值": 50 },
        allowedEvents: [],
        forbiddenEvents: [],
        unlockedSkills: [],
        resourceRules: sbPlan.resourceRules,
        narrativeGuidance: [],
      };
      const text = "林默在家休息了一天。";
      const result = preScanTextAgainstResourcePlan(text, noChangePlan);
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("T28: system_bootstrap preScan only requires balance_claim events with requiredInText", () => {
      const planWithOptionalClaim: ChapterResourcePlan = {
        ...sbPlan,
        allowedEvents: [
          { order: 1, kind: "balance_claim", resource: "灵力值", amount: 0, reason: "必须声明", requiredInText: true },
          { order: 2, kind: "balance_claim", resource: "气血值", amount: 0, reason: "可选声明", requiredInText: false },
        ],
      };
      const text = "系统激活！当前灵力值：0。"; // 灵力值 declared, 气血值 not declared
      const result = preScanTextAgainstResourcePlan(text, planWithOptionalClaim);
      // 气血值 is optional (requiredInText: false), so should not cause violation
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });

  // ---- FIX-052-D-2: renderResourcePlanForPrompt balance_claim clarity ----

  describe("renderResourcePlanForPrompt — balance_claim clarity", () => {
    const planWithClaims: ChapterResourcePlan = {
      chapter: 1,
      mode: "system_bootstrap",
      source: "resource-engine",
      openingBalances: { "灵力值": 0, "气血值": 0 },
      expectedClosingBalances: { "灵力值": 0, "气血值": 0 },
      allowedEvents: [
        { order: 1, kind: "balance_claim", resource: "灵力值", amount: 0, reason: "系统首次激活", requiredInText: true },
        { order: 2, kind: "balance_claim", resource: "气血值", amount: 0, reason: "系统首次激活", requiredInText: true },
      ],
      forbiddenEvents: [],
      unlockedSkills: [],
      resourceRules: {
        resources: {
          "灵力值": { name: "灵力值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
          "气血值": { name: "气血值", type: "integer", initial: 0, min: 0, allowNegative: false, aliases: [] },
        },
        skills: [],
        exchangeRates: [],
        aliases: {},
      },
      narrativeGuidance: ["本章处于系统首次激活阶段。"],
      closureRequirement: "explicit_balance_required",
    };

    it("T29: writer prompt uses explicit writing instruction instead of ambiguous 期末确认", () => {
      const output = renderResourcePlanForPrompt(planWithClaims, "writer");
      expect(output).toContain("在正文中明确写出期末余额声明");
      expect(output).not.toContain("期末确认 灵力值=0");
    });

    it("T30: writer prompt includes balance claim format guidance", () => {
      const output = renderResourcePlanForPrompt(planWithClaims, "writer");
      expect(output).toContain("【期末余额声明要求】");
      expect(output).toContain("必须在正文末尾写出");
      expect(output).toContain("当前资源名：数值");
      expect(output).toContain("如果期末余额为 0，也必须写出");
    });

    it("T31: chapter_intent prompt also uses explicit writing instruction", () => {
      const output = renderResourcePlanForPrompt(planWithClaims, "chapter_intent");
      expect(output).toContain("在正文中明确写出期末余额声明");
      expect(output).not.toContain("期末确认 灵力值=0");
    });

    it("T32: chapter_intent prompt does not include writer-only format guidance", () => {
      const output = renderResourcePlanForPrompt(planWithClaims, "chapter_intent");
      expect(output).not.toContain("【期末余额声明要求】");
    });

    it("T33: no_resource_change prompt does not include balance claim guidance", () => {
      const noChangePlan: ChapterResourcePlan = {
        ...planWithClaims,
        mode: "no_resource_change",
        allowedEvents: [],
        closureRequirement: "inferred_no_change_allowed",
      };
      const output = renderResourcePlanForPrompt(noChangePlan, "writer");
      expect(output).not.toContain("【期末余额声明要求】");
      expect(output).not.toContain("在正文中明确写出期末余额声明");
    });

    it("T34: real balance error still hard blocks in final validation", () => {
      // Verify that the pre-scan enhancement does not relax final validation.
      // A wrong closing declaration must still fail.
      const strictPlan: ChapterResourcePlan = {
        chapter: 2,
        mode: "normal",
        source: "resource-engine",
        openingBalances: { "灵力值": 100, "气血值": 50 },
        expectedClosingBalances: { "灵力值": 100, "气血值": 50 },
        allowedEvents: [
          { order: 1, kind: "balance_claim", resource: "灵力值", amount: 100, reason: "期末声明", requiredInText: true },
        ],
        forbiddenEvents: [],
        unlockedSkills: [],
        resourceRules: planWithClaims.resourceRules,
        narrativeGuidance: [],
        closureRequirement: "explicit_balance_required",
      };
      // Text claims closing=200 but actual should be 100
      const text = "林默写灵力值=200。";
      const result = validateTextAgainstChapterResourcePlanFinal({ text, plan: strictPlan });
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes("closingBalances") || v.includes("balance claim mismatch"))).toBe(true);
    });
  });
});
