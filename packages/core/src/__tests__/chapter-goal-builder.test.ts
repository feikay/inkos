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

  it("treats 突破口 as a practical opening, not a power breakthrough, for non-power genres", () => {
    const input = {
      ...baseInput(),
      goal: "林远舟必须在三天内筹到800元，找到截胡VCD货源的突破口。",
      currentState: "当前目标: 筹到800元启动资金\n当前冲突: 学生身份、家庭拮据、没有人脉",
      outlineNode: "看到老周电器维修店，意识到这是合作突破口。",
      genreProfile: {
        styleEmphasis: [],
        mustAvoid: [],
        powerScaling: false,
        concretePayoffObjects: ["启动资金", "本钱", "合同", "车票"],
        defaultPayoffActions: ["拿到", "锁定", "避开"],
      },
    };

    const result = buildChapterGoal(input);

    expect(result.payoffDirective?.payoffType).not.toBe("breakthrough");
    expect(result.endingHookType).not.toBe("breakthrough");
    expect(result.nextChapterPull).not.toMatch(/提升|更高层对手|觉醒|反噬|破境/);
  });

  it("normalizes the generic protagonist role to the locked protagonist name", () => {
    const input = {
      ...baseInput(),
      protagonistName: "林远舟",
      chapterNumber: 1,
      goal: "确认自己重生到1997年并稳住课堂异常。",
      currentState: "当前目标: 主角确认重生事实\n当前冲突: 主角必须掩饰异常表现",
      currentFocus: [
        "# 当前聚焦",
        "",
        "## 当前重点",
        "- 主角目标：确认时间节点，不能暴露重生异常。",
        "- 主角困境：老师和同学都注意到他的反常。",
        "- 章节结尾钩子：林远舟在日记本上写下“我不会再让任何人失望。”",
      ].join("\n"),
      chapterSummaries: "",
    };

    const result = buildChapterGoal(input);

    expect(result.activeCharacters).toEqual(["林远舟"]);
    expect(result.activeCharacters).not.toContain("主角");
  });

  it("extracts first-chapter rebirth crisis payoff from the chapter ending hook", () => {
    const input = {
      ...baseInput(),
      chapterNumber: 1,
      goal: "：重生1997",
      currentState: [
        "| 字段 | 值 |",
        "|------|-----|",
        "| 当前章节 | 0 |",
        "| 当前目标 | 掩饰重生异常，确认时间节点，评估可用的前世记忆 |",
        "| 第一个冲突 | 放学回家得知父亲在失业通知上，主角必须在半个月内找到赚钱的门路，否则家庭经济将陷入困境 |",
      ].join("\n"),
      currentFocus: [
        "# 当前聚焦",
        "",
        "## 当前重点",
        "- 第1章必须完成：- 主钩子类型：极度反差勾（2024年猝死→1997年教室）",
        "- 前500字冲突：2024年出租屋里的死亡瞬间，紧接着切换到1997年教室。",
        "- 主角困境：确认这不是梦，同时掩饰自己的异常。",
        "- 章节结尾钩子：放学回家，看到父亲坐在客厅里抽烟，桌上放着一份机械厂失业通知。父亲的名字在上面。",
        "- 第2章必须完成：- 核心功能：展示金手指——主角梳理前世记忆，找到第一个可操作的商机",
        "- 阻碍如何升级：主角去农贸市场摸底，发现所有摊贩的货都来自周文斌。周文斌的人警告摊贩：敢从别人那里拿货，就别想在这摆摊。",
      ].join("\n"),
      pendingHooksRaw: [
        "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| FATHER_LAYOFF | 1 | 亲情线 | 待埋设 | 0 | 8 | 立即 | 父亲被机械厂辞退失业，主角必须赚钱帮家里渡过难关 |",
      ].join("\n"),
      hookAgenda: {
        pressureMap: [] as any[],
        eligibleResolve: [] as string[],
        mustAdvance: ["FATHER_LAYOFF"],
        staleDebt: [] as string[],
        avoidNewHookFamilies: [] as string[],
      },
      genreProfile: {
        styleEmphasis: [],
        mustAvoid: [],
        powerScaling: false,
        concretePayoffObjects: ["存折", "集资款", "店铺钥匙", "合同", "营业执照"],
        defaultPayoffActions: ["拿到", "保住", "夺回"],
      },
    };

    const result = buildChapterGoal(input);

    expect(result.mainConflict).toContain("父亲在失业通知上");
    expect(result.mainConflict).not.toContain("前500字冲突");
    expect(result.payoffToDeliver).toBe("家庭危机被当场坐实");
    expect(result.payoffDirective?.payoffType).toBe("reveal");
    expect(result.payoffToDeliver).not.toContain("存折");
  });
});
