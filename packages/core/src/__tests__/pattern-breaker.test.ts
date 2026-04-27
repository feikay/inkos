import { describe, expect, it } from "vitest";
import { analyzeChapterPattern, analyzePatternBreaker } from "../validators/pattern-breaker.js";

describe("analyzePatternBreaker", () => {
  it("extracts ordered structure tags from a chapter", () => {
    const analysis = analyzeChapterPattern("石门裂开，楚夜拔剑迎战。妖兽倒下后，尸体旁散落灵气结晶，一块玉牌滚到水边。");

    expect(analysis.tags).toEqual(["异象", "战斗", "掉落", "资源", "玉牌"]);
    expect(analysis.signature).toBe("战斗 → 掉落 → 玉牌");
  });

  it("detects repeated combat-loot-jade patterns in recent chapters", () => {
    const result = analyzePatternBreaker([
      "楚夜拔剑迎战，妖兽倒下。尸体旁散落药材，最后露出一块玉牌。",
      "云岚出手血战，黑影被击杀。石阶上滚落灵气结晶和一块玉牌。",
      "雾气发烫，石壁浮出血字。",
    ]);

    expect(result.repeated).toBe(true);
    expect(result.issues[0]).toContain("最近章节叙事流程重复");
    expect(result.directive).toContain("## 剧情模式打断器");
    expect(result.directive).toContain("再出现战斗开局");
    expect(result.directive).toContain("再掉落玉牌/卷轴");
    expect(result.directive).toContain("必须选择不同推进方式");
  });

  it("does not trigger when the last three chapters use varied drivers", () => {
    const result = analyzePatternBreaker([
      "符文亮起，暗河倒流，石碑背面渗出血痕。",
      "一名黑袍人站在门后，将宗门禁令压在石台上。",
      "楚夜经脉刺痛，玉牌在掌心发烫，他不得不停下调息。",
    ]);

    expect(result.repeated).toBe(false);
    expect(result.directive).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it("can emit an English directive for English books", () => {
    const result = analyzePatternBreaker([
      "楚夜拔剑迎战，妖兽倒下。尸体旁散落药材，最后露出一块玉牌。",
      "云岚出手血战，黑影被击杀。石阶上滚落灵气结晶和一块玉牌。",
    ], "en");

    expect(result.repeated).toBe(true);
    expect(result.directive).toContain("## Pattern Breaker");
    expect(result.directive).toContain("Do not open with combat");
  });
});
