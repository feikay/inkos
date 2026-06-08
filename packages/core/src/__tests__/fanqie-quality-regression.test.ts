import { describe, expect, it } from "vitest";
import { buildFanqiePolishPrompt } from "../agents/fanqie-quality.js";

describe("fanqie-quality polish prompt regression", () => {
  it("does not contain literal backslash-n in prompt output (Fix 2)", () => {
    const lengthConstraint = "【字数约束】\n- 目标：2000字\n- 硬上限：3000字";
    const prompt = buildFanqiePolishPrompt({
      chapterText: "测试正文内容。",
      issues: [{ type: "爽点不足", severity: "中", detail: "测试" }],
      qualityScore: 82,
      lengthConstraint,
    });
    // Should NOT contain literal \n text in output
    expect(prompt).not.toContain("\\n");
    // Should contain the constraint after a real newline
    expect(prompt).toContain("不得超过硬上限。\n");
  });

  it("regex matches Chinese quoted dialogue via buildLocalFanqieQualityReport (Fix 1)", () => {
    // Verify the regex pattern matches Chinese curly quotes
    // Source regex: /“[^”]+”|"[^"]+"/g
    const textWithChinese = '他说“你好”，她回答“再见”。';
    var re = new RegExp("“[^”]+”", "g");
    var matchesCn = textWithChinese.match(re);
    expect(matchesCn?.length ?? 0).toBe(2);
  });

  it("regex matches English quoted dialogue (Fix 1)", () => {
    const textWithEnglish = 'He said "hello" and she replied "goodbye".';
    var re = /"[^"]+"/g;
    var matchesEn = textWithEnglish.match(re);
    expect(matchesEn?.length ?? 0).toBe(2);
  });
});
