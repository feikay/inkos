import { describe, it, expect } from "vitest";
import { buildChapterGoal } from "../utils/chapter-goal-builder.js";

function baseInput() {
  return {
    language: "zh" as const,
    chapterNumber: 6,
    goal: "本章主角需要从追杀中脱身并获取关键信息。",
    currentFocus: "逃离追捕",
    currentState: "当前目标: 逃出封锁区\n当前冲突: 追兵紧追不舍",
    chapterSummaries: "",
    pendingHooksRaw: "",
    foreshadowRegistryRaw: "",
    hookAgenda: {
      pressureMap: [] as any[],
      eligibleResolve: [] as string[],
      mustAdvance: [] as string[],
      staleDebt: [] as string[],
      avoidNewHookFamilies: [] as string[],
    },
    selectedHooks: [],
    arcMap: {
      arcDirective: "",
      goalHint: "",
    },
    genreProfile: {
      styleEmphasis: [],
      mustAvoid: [],
    },
    powerSystem: {
      mustKeep: [],
      mustAvoid: [],
    },
  };
}

describe("buildChapterGoal — payoff complexity cap", () => {
  it("compacts arc-level reversal payoff to atomic for standard word budget", () => {
    const input = {
      ...baseInput(),
      // The hook's expectedPayoff is an ambitious situational reversal
      foreshadowRegistryRaw: JSON.stringify([
        {
          hookId: "hook-1",
          type: "conflict",
          status: "open",
          startChapter: 3,
          lastAdvancedChapter: 5,
          expectedPayoff: "局势第一次发生明确反转，主角从被动转为主动",
          notes: "",
        },
      ]),
      hookAgenda: {
        pressureMap: [] as any[],
        eligibleResolve: [] as string[],
        mustAdvance: ["hook-1"],
        staleDebt: ["hook-1"],
        avoidNewHookFamilies: [] as string[],
      },
    };

    const result = buildChapterGoal(input);
    const directive = result.payoffDirective!;

    // The payoff should NOT contain the original arc-level "反转" language
    expect(directive.promisedPayoff).not.toMatch(/反转|逆转|翻盘/);
    // Should be compacted to atomic tactical advantage, depth preserved
    expect(directive.payoffDepth).toBe("layered");
    expect(directive.payoffScope).toBe("chapter");
    expect(directive.mandatoryByFinalAct).toBe(true);
  });

  it("compacts over-ambitious reveal payoff for standard word budget", () => {
    const input = {
      ...baseInput(),
      foreshadowRegistryRaw: JSON.stringify([
        {
          hookId: "hook-2",
          type: "mystery",
          status: "open",
          startChapter: 2,
          lastAdvancedChapter: 4,
          expectedPayoff: "一条关键线索被当场揭开，真相水落石出",
          notes: "",
        },
      ]),
      hookAgenda: {
        pressureMap: [] as any[],
        eligibleResolve: [] as string[],
        mustAdvance: ["hook-2"],
        staleDebt: ["hook-2"],
        avoidNewHookFamilies: [] as string[],
      },
    };

    const result = buildChapterGoal(input);
    const directive = result.payoffDirective!;

    // Should NOT contain "真相" or "水落石出" — those are over-ambitious
    expect(directive.promisedPayoff).not.toMatch(/真相|水落石出|完整揭示/);
    expect(directive.payoffDepth).toBe("layered");
    expect(directive.payoffScope).toBe("chapter");
  });

  it("compacts breakthrough payoff to incremental progress", () => {
    const input = {
      ...baseInput(),
      foreshadowRegistryRaw: JSON.stringify([
        {
          hookId: "hook-3",
          type: "power",
          status: "open",
          startChapter: 4,
          lastAdvancedChapter: 5,
          expectedPayoff: "主角突破境界，觉醒新能力",
          notes: "",
        },
      ]),
      hookAgenda: {
        pressureMap: [] as any[],
        eligibleResolve: [] as string[],
        mustAdvance: ["hook-3"],
        staleDebt: ["hook-3"],
        avoidNewHookFamilies: [] as string[],
      },
    };

    const result = buildChapterGoal(input);
    const directive = result.payoffDirective!;

    expect(directive.promisedPayoff).not.toMatch(/突破境界|觉醒/);
    expect(directive.payoffDepth).toBe("layered");
  });

  it("does NOT compact payoffs that are already atomic", () => {
    const input = {
      ...baseInput(),
      foreshadowRegistryRaw: JSON.stringify([
        {
          hookId: "hook-4",
          type: "resource",
          status: "open",
          startChapter: 3,
          lastAdvancedChapter: 5,
          expectedPayoff: "获得一枚可用的腰牌",
          notes: "",
        },
      ]),
      hookAgenda: {
        pressureMap: [] as any[],
        eligibleResolve: [] as string[],
        mustAdvance: ["hook-4"],
        staleDebt: ["hook-4"],
        avoidNewHookFamilies: [] as string[],
      },
    };

    const result = buildChapterGoal(input);
    const directive = result.payoffDirective!;

    // Atomic resource payoff should pass through unchanged or close to it
    expect(directive.promisedPayoff).toMatch(/腰牌/);
    expect(directive.payoffDepth).toBe("layered");
  });

  it("produces a valid chapter goal with all required fields after compaction", () => {
    const input = {
      ...baseInput(),
      foreshadowRegistryRaw: JSON.stringify([
        {
          hookId: "hook-5",
          type: "conflict",
          status: "open",
          startChapter: 3,
          lastAdvancedChapter: 5,
          expectedPayoff: "战局逆转，主角一举翻盘",
          notes: "",
        },
      ]),
      hookAgenda: {
        pressureMap: [] as any[],
        eligibleResolve: [] as string[],
        mustAdvance: ["hook-5"],
        staleDebt: ["hook-5"],
        avoidNewHookFamilies: [] as string[],
      },
    };

    const result = buildChapterGoal(input);

    // All required fields must exist
    expect(result.mainConflict).toBeTruthy();
    expect(result.protagonistGoal).toBeTruthy();
    expect(result.payoffToDeliver).toBeTruthy();
    expect(result.payoffDirective).toBeTruthy();
    expect(result.endingHookType).toBeTruthy();
    expect(result.nextChapterPull).toBeTruthy();

    // Payoff directive must have all required fields
    const d = result.payoffDirective!;
    expect(d.promisedPayoff).toBeTruthy();
    expect(d.payoffType).toBeTruthy();
    expect(d.payoffDepth).toBeTruthy();
    expect(d.payoffScope).toBeTruthy();
    expect(typeof d.mandatoryByFinalAct).toBe("boolean");
  });

  it("keeps atomic resource payoff intact", () => {
    const input = {
      ...baseInput(),
      goal: "本章找到疗伤药材",
      currentState: "当前目标: 寻找疗伤药材\n当前冲突: 伤势恶化",
    };

    const result = buildChapterGoal(input);

    // The default concrete payoff should be reasonable
    expect(result.payoffToDeliver).toBeTruthy();
    expect(result.payoffDirective!.promisedPayoff).toBeTruthy();
    // Should not be over-ambitious
    expect(result.payoffDirective!.promisedPayoff).not.toMatch(/反转|逆转|翻盘|真相|全部揭开|突破境界/);
  });

  it("escape payoff triggers atomic compaction when word budget is low", () => {
    const input = {
      ...baseInput(),
      goal: "逃离追捕",
      currentState: "当前目标: 逃出封锁区\n当前冲突: 追兵封锁所有出口",
      outlineNode: "主角需要在追兵合围前找到突破口",
    };

    const result = buildChapterGoal(input);
    const directive = result.payoffDirective!;

    // Escape-related payoffs should remain actionable
    expect(directive.promisedPayoff).toBeTruthy();
    expect(directive.payoffDepth).toBe("layered");
  });
});
