import { describe, expect, it } from "vitest";
import { validateRegressionChapters } from "../validators/regression-validation.js";

describe("validateRegressionChapters", () => {
  it("scores clean chapters near the top of the scale", () => {
    const result = validateRegressionChapters([
      { id: "0014", content: "暗河水面忽然倒流。楚夜按住发烫的玉牌，石壁背面渗出一道新血痕。" },
      { id: "0015", content: "黑袍人的脚步声停在门外。云岚举起法杖，门缝里的血光一寸寸变亮。" },
      { id: "0016", content: "楚夜掌心忽然刺痛。经脉里的葬渊之力逆冲，他不得不把剑尖压进石缝。" },
    ]);

    expect(result.style_score).toBe(10);
    expect(result.consistency_score).toBe(10);
    expect(result.pattern_score).toBe(10);
    expect(result.issues).toEqual([]);
  });

  it("penalizes style, consistency, and repeated patterns", () => {
    const result = validateRegressionChapters([
      { id: "0014", content: "随着探索继续推进，真正的危险才刚刚开始。楚夜拔剑迎战，妖兽倒下。尸体旁散落药材，最后露出一块玉牌。" },
      { id: "0015", content: "暗河水面忽然倒流。云岚出手血战，黑影被击杀。石阶上滚落灵气结晶和一块玉牌。" },
      { id: "0016", content: "楚夜右臂断臂，失去知觉。片刻后他完全恢复，行动自如地冲向祭坛。" },
    ]);

    expect(result.style_score).toBeLessThan(10);
    expect(result.consistency_score).toBeLessThan(10);
    expect(result.pattern_score).toBeLessThan(10);
    expect(result.issues.join("\n")).toContain("[style:0014]");
    expect(result.issues.join("\n")).toContain("[consistency:0016]");
    expect(result.issues.join("\n")).toContain("[pattern]");
  });
});
