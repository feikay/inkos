import { describe, expect, it } from "vitest";
import { validateStyleGuard } from "../validators/style-guard.js";

describe("validateStyleGuard", () => {
  it("passes a chapter with event-trigger opening and concrete hook", () => {
    const result = validateStyleGuard(`# 第1章

暗河水面忽然倒流。

楚夜握住卷轴，顺着水底浮出的血痕往前走。石门背面的符文亮起一半，另一半被新鲜爪痕刮断。`);

    expect(result.pass).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.severity).toBe("low");
  });

  it("detects forbidden template expressions with fuzzy matching", () => {
    const result = validateStyleGuard(`# 第2章

石壁忽然裂开。

楚夜知道，真正的挑战才刚刚开始。他们继续向前探索，这里还隐藏着不为人知的秘密。这一切只是冰山一角，真正的真相终将被揭开。`);

    expect(result.pass).toBe(false);
    expect(result.severity).toBe("high");
    expect(result.issues.join("\n")).toContain("危险/考验/挑战 + 刚刚开始");
    expect(result.issues.join("\n")).toContain("继续 + 深入/前行/探索");
    expect(result.issues.join("\n")).toContain("隐藏 + 秘密");
    expect(result.issues.join("\n")).toContain("冰山一角");
    expect(result.issues.join("\n")).toContain("真相 + 揭开");
  });

  it("rejects summary-style chapter openings", () => {
    const result = validateStyleGuard(`# 第3章

随着他们在暗河尽头的探索继续推进，前方道路变得更加危险。

楚夜握紧短剑。`);

    expect(result.pass).toBe(false);
    expect(result.severity).toBe("high");
    expect(result.issues[0]).toContain("首句像总结/过渡句");
  });

  it("warns when opening lacks action, anomaly, or event trigger", () => {
    const result = validateStyleGuard(`# 第4章

暗河尽头的夜色很深。

楚夜握紧短剑。`);

    expect(result.pass).toBe(false);
    expect(result.severity).toBe("low");
    expect(result.issues[0]).toContain("缺少明确动作、异象或事件触发");
  });

  it("passes chapters that do not trigger universal tag repetition", () => {
    const previous = `石门忽然亮起。楚夜拔剑迎战，经过一番战斗将妖兽击败。尸体旁散落灵气结晶和药材，最后滚出一块玉牌。`;
    const current = `水声忽然停住。云岚与楚夜再次交锋厮杀，妖兽倒下后，地上散落资源和药材，爪下压着一枚玉牌。`;

    const result = validateStyleGuard(current, { previousChapters: [previous] });

    // Genre-specific structure patterns (combat-loot-jade) are no longer hardcoded.
    // Universal tag system only detects conflict, gain, reveal, cost patterns.
    // These two chapters both have conflict tags but the universal system
    // may still detect repetition based on its own rules.
    expect(result.pass).toBe(true);
  });

  it("passes chapters with only universal tag patterns when genre-specific structure not triggered", () => {
    const previous = `风铃忽然碎裂。两人踏入石廊继续探索，楚夜感知到前方气息波动，随即拔剑迎战。`;
    const current = `玉牌忽然发烫。楚夜进入洞穴往前走，察觉到石壁后有灵力波动，下一刻双方爆发战斗。`;

    const result = validateStyleGuard(current, { previousChapters: [previous] });

    // Genre-specific structure patterns (explore-sense-combat) are no longer hardcoded.
    // Universal tag system only detects conflict, gain, reveal, cost patterns.
    expect(result.pass).toBe(true);
  });
});
