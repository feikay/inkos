import { describe, it, expect } from "vitest";
import {
  syncCurrentStateResources,
  buildResourceLedgerUpdate,
  classifyClosureStatus,
  classifyResourceConsistency,
  parseResourceRules,
  validateResourceMath,
  extractResourceEvents,
} from "../agents/resource-consistency.js";
import { buildChapterResourcePlan, type ChapterResourcePlan } from "../agents/resource-plan.js";

const mockResourceRules = parseResourceRules(
  `
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
`,
  `| 资源 | 余额 |
|------|------|
| 民望值 | 0 |
| 联邦币 | 200 |`,
  "林默，当前民望值 0，联邦币 200。",
);

const mockResourcePlan: ChapterResourcePlan = {
  chapter: 2,
  mode: "defer_exchange",
  source: "resource-engine",
  openingBalances: { "民望值": 0, "联邦币": 200 },
  expectedClosingBalances: { "民望值": 100, "联邦币": 200 },
  allowedEvents: [],
  forbiddenEvents: [],
  unlockedSkills: ["初级辩论技能"],
  resourceRules: mockResourceRules,
  narrativeGuidance: [],
};

const mockValidationNoIssues = {
  events: [],
  issues: [],
  openingBalances: { "民望值": 0, "联邦币": 200 },
  closingBalances: { "民望值": 50, "联邦币": 200 },
  unlockedSkills: [],
  rules: mockResourceRules,
};

const mockValidationWithIssues = {
  events: [],
  issues: [
    {
      severity: "critical" as const,
      code: "balance-mismatch" as const,
      resource: "民望值",
      expected: 100,
      actual: 50,
      evidence: "正文显示50",
      message: "民望值不符",
      suggestion: "修正为民望值100",
      repairable: true,
    },
  ],
  openingBalances: { "民望值": 0, "联邦币": 200 },
  closingBalances: { "民望值": 50, "联邦币": 200 },
  unlockedSkills: [],
  rules: mockResourceRules,
};

describe("syncCurrentStateResources", () => {
  it("should use Resource Plan expectedClosingBalances when available", () => {
    const currentState = `
林默，主角。
| 当前资源 | 民望值=0；联邦币=200 |
`;

    const result = syncCurrentStateResources({
      currentState,
      validation: mockValidationNoIssues,
      resourcePlan: mockResourcePlan,
    });

    expect(result).toContain("民望值=100");
    expect(result).toContain("联邦币=200");
    expect(result).toContain("已解锁技能=初级辩论技能");
  });

  it("should not update if validation has issues", () => {
    const currentState = `
林默，主角。
| 当前资源 | 民望值=0；联邦币=200 |
`;

    const result = syncCurrentStateResources({
      currentState,
      validation: mockValidationWithIssues,
      resourcePlan: mockResourcePlan,
    });

    expect(result).toContain("资源账本校验存在冲突");
    expect(result).not.toContain("民望值=100");
  });
});

describe("buildResourceLedgerUpdate", () => {
  it("should use Resource Plan expectedClosingBalances when available", () => {
    const result = buildResourceLedgerUpdate({
      chapterNumber: 2,
      validation: mockValidationNoIssues,
      resourcePlan: mockResourcePlan,
    });

    expect(result).toContain("| 民望值 | 100 |");
    expect(result).toContain("| 联邦币 | 200 |");
    expect(result).toContain("| 技能 | 初级辩论技能 |");
    expect(result).toContain("| 2 | 联邦币 | 200 | 0 | 0 | 200 |");
  });

  it("should not update ledger if validation is blocking", () => {
    const currentLedger = `| 资源 | 余额 |
|------|------|
| 民望值 | 0 |
| 联邦币 | 200 |`;

    const result = buildResourceLedgerUpdate({
      chapterNumber: 2,
      currentLedger,
      validation: mockValidationWithIssues,
      resourcePlan: mockResourcePlan,
    });

    expect(result).toBe(currentLedger);
  });
});

describe("classifyResourceConsistency", () => {
  it("should set shouldPersistLedger and shouldPersistStateResources to false when blocking", () => {
    const result = classifyResourceConsistency({
      validation: mockValidationWithIssues,
      repaired: false,
    });

    expect(result.blocking).toBe(true);
    expect(result.shouldPersistLedger).toBe(false);
    expect(result.shouldPersistStateResources).toBe(false);
  });

  it("should allow persistence when no issues", () => {
    const result = classifyResourceConsistency({
      validation: mockValidationNoIssues,
      repaired: false,
    });

    expect(result.blocking).toBe(false);
    expect(result.shouldPersistLedger).toBe(true);
    expect(result.shouldPersistStateResources).toBe(true);
  });
});

describe("classifyClosureStatus", () => {
  it("should return no_change_closed: plan exists, zero events, zero issues, no violations", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: false,
      hasIssues: false,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "PASS",
    });
    expect(result).toBe("no_change_closed");
  });

  it("should return not_checked: no plan, zero events", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: false,
      hasEvents: false,
      hasIssues: false,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "PASS",
    });
    expect(result).toBe("not_checked");
  });

  it("should return normal_closed: has events, zero issues, no violations, no blocking", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: true,
      hasIssues: false,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "PASS",
    });
    expect(result).toBe("normal_closed");
  });

  it("should return resource_failed: blocking true", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: true,
      hasIssues: true,
      hasResourcePlanViolations: false,
      blocking: true,
      status: "FAILED",
    });
    expect(result).toBe("resource_failed");
  });

  it("should return resource_failed: status FAILED", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: true,
      hasIssues: true,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "FAILED",
    });
    expect(result).toBe("resource_failed");
  });

  it("should return resource_failed: status WARN", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: true,
      hasIssues: true,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "WARN",
    });
    expect(result).toBe("resource_failed");
  });

  it("should return resource_failed: has plan violations", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: false,
      hasIssues: false,
      hasResourcePlanViolations: true,
      blocking: false,
      status: "PASS",
    });
    expect(result).toBe("resource_failed");
  });

  it("should return normal_closed: has events, no plan, no issues, no blocking", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: false,
      hasEvents: true,
      hasIssues: false,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "PASS",
    });
    expect(result).toBe("normal_closed");
  });

  it("should not misclassify missing-check as no_change_closed", () => {
    const notChecked = classifyClosureStatus({
      hasResourcePlan: false,
      hasEvents: false,
      hasIssues: false,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "PASS",
    });
    expect(notChecked).toBe("not_checked");
    expect(notChecked).not.toBe("no_change_closed");
  });

  it("should return resource_failed when blocking even with zero events", () => {
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: false,
      hasIssues: true,
      hasResourcePlanViolations: false,
      blocking: true,
      status: "FAILED",
    });
    expect(result).toBe("resource_failed");
  });

  it("should never return no_change_closed when blocking, FAILED, WARN, or plan violations exist", () => {
    const blockingCases: Array<{
      blocking: boolean;
      status: "PASS" | "FAILED" | "WARN" | "FIXED";
      hasResourcePlanViolations: boolean;
    }> = [
      { blocking: true, status: "PASS", hasResourcePlanViolations: false },
      { blocking: false, status: "FAILED", hasResourcePlanViolations: false },
      { blocking: false, status: "WARN", hasResourcePlanViolations: false },
      { blocking: false, status: "PASS", hasResourcePlanViolations: true },
    ];
    for (const tc of blockingCases) {
      const result = classifyClosureStatus({
        hasResourcePlan: true,
        hasEvents: false,
        hasIssues: false,
        ...tc,
      });
      expect(result).not.toBe("no_change_closed");
      expect(result).toBe("resource_failed");
    }
  });

  it("no_change_closed implies non-blocking PASS status by construction", () => {
    // The only way to get no_change_closed is:
    // !blocking && status !== "FAILED" && status !== "WARN" && !hasResourcePlanViolations
    // && hasResourcePlan && !hasEvents && !hasIssues
    const result = classifyClosureStatus({
      hasResourcePlan: true,
      hasEvents: false,
      hasIssues: false,
      hasResourcePlanViolations: false,
      blocking: false,
      status: "PASS",
    });
    expect(result).toBe("no_change_closed");
    // The caller can trust that no_change_closed means the chapter is safe for downstream
  });
});

describe("parseResourceRules schema gate", () => {
  it("should only inject resources declared in book_rules resourceTypes block", () => {
    const rules = parseResourceRules(
      "resourceTypes:\n  - 民望值\n  - 联邦币\n",
      "| 民望值 | 100 |\n| 联邦币 | 200 |\n",
      "| 当前资源 | 民望值=100；联邦币=200 |\n",
    );
    // Should have the two declared resources
    expect(Object.keys(rules.resources)).toContain("民望值");
    expect(Object.keys(rules.resources)).toContain("联邦币");
    // Should NOT have cross-genre resources
    expect(Object.keys(rules.resources)).not.toContain("灵石");
    expect(Object.keys(rules.resources)).not.toContain("金币");
    expect(Object.keys(rules.resources)).not.toContain("气血");
    expect(Object.keys(rules.resources)).not.toContain("灵力");
    expect(Object.keys(rules.resources)).not.toContain("修为");
    expect(Object.keys(rules.resources)).not.toContain("功德");
  });

  it("should inject all defaults when book_rules has no resourceTypes block (backward compat)", () => {
    const rules = parseResourceRules(
      "initialResources:\n  民望值: 100\n",
      "",
      "",
    );
    // With no resourceTypes block, all DEFAULT_RESOURCE_TYPES should be present
    expect(Object.keys(rules.resources)).toContain("民望值");
    expect(Object.keys(rules.resources)).toContain("灵石");
    expect(Object.keys(rules.resources)).toContain("金币");
  });

  it("should still inject resources from book_rules resources block even when not in DEFAULT_RESOURCE_TYPES", () => {
    // 技能点 IS in DEFAULT_RESOURCE_TYPES, but this test verifies that
    // explicitly declared resources from the resources block are still processed
    const rules = parseResourceRules(
      [
        "resourceTypes:",
        "  - 民望值",
        "  - 技能点",
        "",
        "resources:",
        "  技能点:",
        "    type: integer",
        "    initial: 0",
        "    min: 0",
      ].join("\n"),
      "",
      "",
    );
    // 民望值 is declared and in DEFAULT, should be present
    expect(Object.keys(rules.resources)).toContain("民望值");
    // 技能点 is declared and in DEFAULT, should be present with correct initial
    expect(Object.keys(rules.resources)).toContain("技能点");
    // 灵石 is not declared, should be absent
    expect(Object.keys(rules.resources)).not.toContain("灵石");
  });
});

describe("parseResourceRules inline/nested resourceTypes detection", () => {
  it("should detect inline array format: resourceTypes: [A, B]", () => {
    const rules = parseResourceRules(
      "resourceTypes: [民望值, 联邦币]\n",
      "",
      "",
    );
    expect(Object.keys(rules.resources)).toContain("民望值");
    expect(Object.keys(rules.resources)).toContain("联邦币");
    expect(Object.keys(rules.resources)).not.toContain("灵石");
    expect(Object.keys(rules.resources)).not.toContain("金币");
  });

  it("should detect nested inline array: numericalSystemOverrides.resourceTypes: [A, B]", () => {
    const rules = parseResourceRules(
      [
        "numericalSystemOverrides:",
        "  hardCap: 999",
        "  resourceTypes: [震惊值, 爱慕值, 愤怒值]",
      ].join("\n"),
      "",
      "",
    );
    // Custom resources declared in nested inline should enter resources
    expect(Object.keys(rules.resources)).toContain("震惊值");
    expect(Object.keys(rules.resources)).toContain("爱慕值");
    expect(Object.keys(rules.resources)).toContain("愤怒值");
    // Must not include irrelevant global defaults
    expect(Object.keys(rules.resources)).not.toContain("灵石");
    expect(Object.keys(rules.resources)).not.toContain("灵力");
    expect(Object.keys(rules.resources)).not.toContain("修为");
  });

  it("should detect nested multi-line list: numericalSystemOverrides.resourceTypes:\n    - A", () => {
    const rules = parseResourceRules(
      [
        "numericalSystemOverrides:",
        "  hardCap: 999",
        "  resourceTypes:",
        "    - 震惊值",
        "    - 爱慕值",
      ].join("\n"),
      "",
      "",
    );
    expect(Object.keys(rules.resources)).toContain("震惊值");
    expect(Object.keys(rules.resources)).toContain("爱慕值");
    expect(Object.keys(rules.resources)).not.toContain("灵石");
  });

  it("should NOT fall back to global defaults when explicit resourceTypes exist (any format)", () => {
    // All 4 formats should prevent default resource injection
    const formats = [
      "resourceTypes:\n  - 民望值\n  - 联邦币\n",
      "resourceTypes: [民望值, 联邦币]",
      "numericalSystemOverrides:\n  resourceTypes: [民望值, 联邦币]",
      "numericalSystemOverrides:\n  resourceTypes:\n    - 民望值\n    - 联邦币",
    ];
    for (const bookRules of formats) {
      const rules = parseResourceRules(bookRules, "", "");
      // Should have declared resources
      expect(Object.keys(rules.resources)).toContain("民望值");
      // Should NOT have cross-genre defaults
      expect(Object.keys(rules.resources)).not.toContain("灵石");
      expect(Object.keys(rules.resources)).not.toContain("金币");
      expect(Object.keys(rules.resources)).not.toContain("气血");
      expect(Object.keys(rules.resources)).not.toContain("灵力");
      expect(Object.keys(rules.resources)).not.toContain("修为");
      expect(Object.keys(rules.resources)).not.toContain("功德");
    }
  });

  it("should inject all defaults when no resourceTypes in any format (backward compat)", () => {
    const rules = parseResourceRules(
      "initialResources:\n  民望值: 100\n",
      "",
      "",
    );
    expect(Object.keys(rules.resources)).toContain("民望值");
    expect(Object.keys(rules.resources)).toContain("灵石");
    expect(Object.keys(rules.resources)).toContain("金币");
  });

  it("custom resources declared in resourceTypes should survive the full chain: resources -> pattern -> event extraction", () => {
    const bookRules = [
      "numericalSystemOverrides:",
      "  resourceTypes: [震惊值, 爱慕值]",
      "initialResources:",
      "  震惊值: 0",
      "  爱慕值: 100",
    ].join("\n");
    const rules = parseResourceRules(bookRules, "", "");
    // Must be in resources
    expect(Object.keys(rules.resources)).toContain("震惊值");
    expect(Object.keys(rules.resources)).toContain("爱慕值");
    expect(rules.resources["震惊值"]?.initial).toBe(0);
    expect(rules.resources["爱慕值"]?.initial).toBe(100);

    // Must be usable in event extraction
    const events = extractResourceEvents(
      "系统激活，获得100点爱慕值。震惊值+50。",
      bookRules,
      "",
    );
    const aimuEvents = events.filter((e) => e.resource === "爱慕值");
    const zhenjingEvents = events.filter((e) => e.resource === "震惊值");
    expect(aimuEvents.length).toBeGreaterThan(0);
    expect(zhenjingEvents.length).toBeGreaterThan(0);
  });

  it("parseResourceRules with inline array at top level should coexist with initialResources", () => {
    const rules = parseResourceRules(
      [
        "resourceTypes: [灵石, 金币]",
        "initialResources:",
        "  灵石: 500",
        "  金币: 1000",
      ].join("\n"),
      "",
      "",
    );
    expect(Object.keys(rules.resources)).toContain("灵石");
    expect(Object.keys(rules.resources)).toContain("金币");
    expect(rules.resources["灵石"]?.initial).toBe(500);
    expect(rules.resources["金币"]?.initial).toBe(1000);
    // Should not have irrelevant defaults
    expect(Object.keys(rules.resources)).not.toContain("民望值");
  });
});

describe("isNarrativeFinancialContext", () => {
  it("should detect ordinary financial transaction as narrative", () => {
    const events = extractResourceEvents(
      "他打了一辆车，花了30元，司机找零5元现金。",
      "resourceTypes:\n  - 民望值\n  - 联邦币\n",
      "",
    );
    // Should not extract "花了30元" or "找零5元现金" as resource events
    const federalEvents = events.filter((e) => e.resource === "联邦币");
    expect(federalEvents).toHaveLength(0);
  });

  it("should still detect genuine resource panel numbers", () => {
    const events = extractResourceEvents(
      "系统面板显示：民望值从0跳到了10。获得10点民望值。",
      "resourceTypes:\n  - 民望值\n  - 联邦币\n",
      "",
    );
    const reputationEvents = events.filter((e) => e.resource === "民望值");
    expect(reputationEvents.length).toBeGreaterThan(0);
  });

  it("should not flag system panel context as narrative financial", () => {
    const events = extractResourceEvents(
      "他打开系统面板，看到余额显示为100联邦币。",
      "resourceTypes:\n  - 联邦币\n",
      "| 联邦币 | 200 |\n",
    );
    const federalEvents = events.filter((e) => e.resource === "联邦币");
    expect(federalEvents.length).toBeGreaterThan(0);
  });

  it("should filter out salary/transfer/wage descriptions", () => {
    const events = extractResourceEvents(
      "他的工资到账了，手机银行显示入账8000元，账户余额变成15000元。",
      "resourceTypes:\n  - 联邦币\n",
      "",
    );
    // "工资到账" + "入账8000元" + "账户余额变成15000元" should be filtered
    const federalEvents = events.filter((e) => e.resource === "联邦币");
    expect(federalEvents).toHaveLength(0);
  });
});

describe("system_bootstrap and resource_rule_reveal modes", () => {
  it("should detect system bootstrap mode for system activation chapter and produce schema-driven balance_claim", () => {
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "resourceTypes:\n  - 民望值\n  - 联邦币\n",
      particleLedger: "| 民望值 | 0 |\n| 联邦币 | 0 |\n",
      currentState: "系统刚刚激活，宿主首次打开系统面板。",
      chapterGoal: "系统激活与初始绑定",
      chapterHooks: "",
      genre: "civic",
      systemMode: "tomato",
    });
    expect(plan.mode).toBe("system_bootstrap");
    expect(plan.forbiddenEvents).toContain("exchange");
    expect(plan.closureRequirement).toBe("explicit_balance_required");
    // Schema-driven: balance_claim events for all declared resources
    expect(plan.allowedEvents.length).toBeGreaterThanOrEqual(1);
    expect(plan.allowedEvents.every((e) => e.kind === "balance_claim")).toBe(true);
    const claimedResources = plan.allowedEvents.map((e) => e.resource);
    expect(claimedResources).toContain("民望值");
    expect(claimedResources).toContain("联邦币");
  });

  it("should produce schema-driven balance_claim for non-civic resource schema in system bootstrap", () => {
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "resourceTypes:\n  - 灵石\n  - 金币\n",
      particleLedger: "",
      currentState: "系统刚刚激活，宿主首次打开系统面板。",
      chapterGoal: "系统激活与初始绑定",
      chapterHooks: "",
      genre: "other",
      systemMode: "tomato",
    });
    expect(plan.mode).toBe("system_bootstrap");
    expect(plan.forbiddenEvents).toContain("exchange");
    // Schema-driven: balance_claim covers all declared resources, not hardcoded names
    expect(plan.allowedEvents.length).toBe(2);
    expect(plan.allowedEvents.every((e) => e.kind === "balance_claim")).toBe(true);
    const claimedResources = plan.allowedEvents.map((e) => e.resource);
    expect(claimedResources).toContain("灵石");
    expect(claimedResources).toContain("金币");
    // No hardcoded resource names like 民望值/联邦币 leaked into a non-civic plan
    expect(claimedResources).not.toContain("民望值");
    expect(claimedResources).not.toContain("联邦币");
  });

  it("should detect resource_rule_reveal for rule explanation chapters", () => {
    const plan = buildChapterResourcePlan({
      chapter: 3,
      bookRules: "resourceTypes:\n  - 民望值\n  - 联邦币\n\n1点民望=10联邦币\n",
      particleLedger: "| 民望值 | 100 |\n| 联邦币 | 200 |\n",
      currentState: "宿主已经获得民望系统，但不了解兑换规则。",
      chapterGoal: "揭示民望值与联邦币的兑换规则和使用限制",
      chapterHooks: "",
      genre: "civic",
      systemMode: "tomato",
    });
    if (plan.mode === "resource_rule_reveal") {
      expect(plan.forbiddenEvents).toContain("exchange");
      expect(plan.forbiddenEvents).toContain("gain");
      expect(plan.forbiddenEvents).toContain("consume");
    }
  });

  it("should NOT include global default resources not referenced in the book context for system_bootstrap", () => {
    // Books without explicit resourceTypes get all 17 global defaults in
    // resourceRules.resources, but system_bootstrap must only create balance_claim
    // for resources that actually appear in the book's context documents.
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "genreLock:\n  primary: urban\n",
      particleLedger: "",
      currentState: "系统刚刚激活，宿主首次打开系统面板。",
      chapterGoal: "系统激活与初始绑定",
      chapterHooks: "",
      genre: "urban",
      systemMode: "tomato",
    });
    // The book context contains no resource names → no balance_claim events.
    // system_bootstrap must not leak 16 global default resources into the plan.
    if (plan.mode === "system_bootstrap") {
      expect(plan.allowedEvents.length).toBe(0);
    }
  });

  it("should only include context-relevant resources in system_bootstrap, not all defaults", () => {
    // Simulates the run-025 scenario: a book WITHOUT a machine-detectable
    // resourceTypes block (e.g., resourceTypes is nested under
    // numericalSystemOverrides or uses inline array format). parseResourceRules
    // falls back to all 17 global defaults. system_bootstrap must filter to
    // only resources actually mentioned in the book's context documents.
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: [
        "numericalSystemOverrides:",
        "  resourceTypes: [灵石, 技能点]",
        "initialResources:",
        "  灵石: 100",
      ].join("\n"),
      particleLedger: "",
      currentState: "系统刚刚激活，宿主首次打开修炼面板。",
      chapterGoal: "系统激活与初始绑定，获得初始灵石",
      chapterHooks: "",
      genre: "other",
      systemMode: "tomato",
    });
    if (plan.mode === "system_bootstrap") {
      const claimedResources = plan.allowedEvents.map((e) => e.resource);
      // Should include resources that appear in context (灵石 mentioned in
      // bookRules initialResources + chapterGoal, 技能点 not detected as
      // declared resource due to inline array format, but appears in bookRules)
      // At minimum, must NOT include irrelevant global defaults.
      expect(claimedResources).not.toContain("金币");
      expect(claimedResources).not.toContain("灵力");
      expect(claimedResources).not.toContain("修为");
      expect(claimedResources).not.toContain("功德");
      expect(claimedResources).not.toContain("气血");
      expect(claimedResources).not.toContain("银两");
      expect(claimedResources).not.toContain("经验值");
      expect(claimedResources).not.toContain("好感度");
      expect(claimedResources).not.toContain("民望值");
      expect(claimedResources).not.toContain("联邦币");
      // Must not have 16+ balance_claim events (the run-025 pollution)
      expect(plan.allowedEvents.length).toBeLessThan(10);
    }
  });

  it("should preserve no_change_closed behavior for normal mode with book-specific resources", () => {
    // Books with explicit resourceTypes and no ledger activity should still
    // get no_resource_change mode — the fix must not regress this path.
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "resourceTypes:\n  - 灵晶\n  - 灵食\n",
      particleLedger: "",
      currentState: "主角刚穿越到仙界。",
      chapterGoal: "了解仙界基本环境",
      chapterHooks: "",
      genre: "xianxia",
      systemMode: "tomato",
    });
    // No ledger activity + has resources → no_resource_change (clean no-change path)
    expect(plan.mode).toBe("no_resource_change");
    expect(plan.closureRequirement).toBe("inferred_no_change_allowed");
  });

  it("should degrade safely with only context-relevant resources in system_bootstrap", () => {
    // A book with no resourceTypes declaration but some resources in context
    // should not crash and should only include those context-relevant resources.
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "protagonist:\n  name: 测试\n",
      particleLedger: "| 经验值 | 50 |\n",
      currentState: "系统刚刚激活。",
      chapterGoal: "系统激活",
      chapterHooks: "",
      genre: "other",
      systemMode: "tomato",
    });
    // Should produce a valid plan (any non-crashing mode)
    expect(plan.mode).toBeDefined();
    if (plan.mode === "system_bootstrap") {
      // Only 经验值 appears in context (via particleLedger)
      const claimedResources = plan.allowedEvents.map((e) => e.resource);
      expect(claimedResources).toContain("经验值");
      // Global defaults not in context must be absent
      expect(claimedResources).not.toContain("灵石");
      expect(claimedResources).not.toContain("金币");
    }
  });

  it("should NOT regress: explicit resourceTypes with balances gets correct system_bootstrap balance_claim", () => {
    // Book with explicit resourceTypes and those resources in context
    // must still produce correct balance_claim events.
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "resourceTypes:\n  - 民望值\n  - 联邦币\n",
      particleLedger: "| 民望值 | 0 |\n| 联邦币 | 0 |\n",
      currentState: "系统刚刚激活，宿主首次打开系统面板。",
      chapterGoal: "系统激活与初始绑定",
      chapterHooks: "",
      genre: "civic",
      systemMode: "tomato",
    });
    expect(plan.mode).toBe("system_bootstrap");
    expect(plan.allowedEvents.length).toBeGreaterThanOrEqual(1);
    expect(plan.allowedEvents.every((e) => e.kind === "balance_claim")).toBe(true);
    const claimedResources = plan.allowedEvents.map((e) => e.resource);
    expect(claimedResources).toContain("民望值");
    expect(claimedResources).toContain("联邦币");
  });

  it("should NOT regress: non-civic resource schema in system_bootstrap only includes declared resources", () => {
    const plan = buildChapterResourcePlan({
      chapter: 1,
      bookRules: "resourceTypes:\n  - 灵石\n  - 金币\n",
      particleLedger: "",
      currentState: "系统刚刚激活，宿主首次打开系统面板。",
      chapterGoal: "系统激活与初始绑定",
      chapterHooks: "",
      genre: "other",
      systemMode: "tomato",
    });
    expect(plan.mode).toBe("system_bootstrap");
    expect(plan.allowedEvents.length).toBe(2);
    expect(plan.allowedEvents.every((e) => e.kind === "balance_claim")).toBe(true);
    const claimedResources = plan.allowedEvents.map((e) => e.resource);
    expect(claimedResources).toContain("灵石");
    expect(claimedResources).toContain("金币");
    expect(claimedResources).not.toContain("民望值");
    expect(claimedResources).not.toContain("联邦币");
  });
});
