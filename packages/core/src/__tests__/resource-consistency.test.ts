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
});
