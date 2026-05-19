import { describe, expect, it } from "vitest";
import { cleanNonNarrativeArtifacts, detectNonNarrativeArtifacts } from "../agents/clean-narrative.js";

describe("clean narrative artifacts", () => {
  it("detects and removes LLM self-correction and resource scratchpad prose", () => {
    const text = [
      "林默盯着面板，指尖微微发抖。",
      "",
      "不对，哦，刚才换技能花了10，本章意图写的是先获得民望。总获得110，就是扶人10+路人100=110，扣10换钱不对，按公式应该调整一下。",
      "",
      "他最终没有立刻按下兑换按钮。",
    ].join("\n");
    const result = cleanNonNarrativeArtifacts(text);

    expect(result.changed).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "prompt-leak", severity: "critical" }),
    ]));
    expect(result.cleanedText).toContain("林默盯着面板");
    expect(result.cleanedText).toContain("他最终没有立刻按下兑换按钮");
    expect(result.cleanedText).not.toContain("本章意图");
    expect(result.cleanedText).not.toContain("扶人10+路人100");
  });

  it("keeps normal dialogue and ordinary physical adjustment prose", () => {
    const text = [
      "“不对，你刚才不是这么说的。”林默盯着汤姆。",
      "他调整呼吸，压住怒火，把衣领重新整理好。",
    ].join("\n");
    const result = cleanNonNarrativeArtifacts(text);

    expect(detectNonNarrativeArtifacts(text)).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.cleanedText).toBe(text);
  });

  it("detects process leaks and explicit author notes", () => {
    const text = [
      "作者注：这里补一段 Resource Engine validation accepted=false 的说明。",
      "林默站在原地。",
    ].join("\n");
    const artifacts = detectNonNarrativeArtifacts(text);

    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "author-note", severity: "critical" }),
    ]));
  });
});
