import { describe, expect, it } from "vitest";
import { validateConsistencyGuard } from "../validators/consistency-guard.js";

describe("validateConsistencyGuard", () => {
  it("passes coherent event setup and action flow", () => {
    const result = validateConsistencyGuard(`# 第1章

石壁先传来细微裂响。

楚夜停下脚步，按住发烫的玉牌。裂纹从石门底部爬上来，血腥味顺着缝隙涌出。他后退半步，示意云岚拔剑。`);

    expect(result.pass).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("detects sudden events without setup", () => {
    const result = validateConsistencyGuard(`楚夜坐在石阶旁调息。云岚低声说话。突然一名黑袍人现身在他们面前。`);

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("无铺垫突发事件");
  });

  it("detects abrupt status changes", () => {
    const result = validateConsistencyGuard(`楚夜右臂断臂，失去知觉，只能靠墙喘息。片刻后他完全恢复，行动自如地冲向祭坛。`);

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("伤势突然消失");
  });

  it("detects prop disappearing and being regained without explanation", () => {
    const result = validateConsistencyGuard(`楚夜握住玉牌。玉牌碎裂，化为飞灰。走过石门后，他又捡起玉牌收入怀中。`);

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("玉牌在消失/损毁后再次被取得");
  });

  it("detects too many consecutive short sentences", () => {
    const result = validateConsistencyGuard(`他停下。风冷。水黑。剑响。门开。楚夜后退一步。`);

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("连续短句过多");
  });

  it("detects too many consecutive long sentences", () => {
    const long = "这条甬道里的雾气贴着石壁缓慢翻涌，夹杂着腐朽药香和潮湿铁锈味，像一张被反复浸泡的旧网罩在每个人头顶，让呼吸都变得迟缓而沉重";
    const result = validateConsistencyGuard(`${long}。${long}。${long}。楚夜停下脚步。`);

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("连续长句过多");
  });

  it("detects action-description-action breaks", () => {
    const result = validateConsistencyGuard(`楚夜拔剑。雾气像旧棉絮一样贴着石壁。空气里有潮湿铁锈味。幽暗光芒在复杂纹路间浮动。云岚冲出。`);

    expect(result.pass).toBe(false);
    expect(result.issues.join("\n")).toContain("动作链断裂");
  });
});
