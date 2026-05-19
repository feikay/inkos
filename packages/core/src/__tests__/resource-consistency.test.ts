import { describe, it, expect } from "vitest";
import {
  syncCurrentStateResources,
  buildResourceLedgerUpdate,
  classifyClosureStatus,
  classifyResourceConsistency,
  parseResourceRules,
  validateResourceMath,
} from "../agents/resource-consistency.js";
import type { ChapterResourcePlan } from "../agents/resource-plan.js";

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
});
