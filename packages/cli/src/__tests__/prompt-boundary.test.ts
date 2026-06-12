import { describe, expect, it } from "vitest";
import { buildChapterRepairBoundaryBlock } from "@actalk/inkos-core";
import { buildQualityAutoFixPrompt, buildPlotAutoFixPrompt } from "../commands/review.js";

describe("PUB-001-FIX-C-1 prompt boundary tests (Fix A+B)", () => {
  const intent = "## 3. 本章主角目标\n- 表层目标：保住存折\n## 9. 下一章钩子\n- 下一章自然推进方向：立军令状、去市场\n- 未解决问题：父亲追问预知能力\n## 11. 写作执行提醒\n- 禁止事项：禁止引入赵启明";

  it("buildQualityAutoFixPrompt contains boundary block, no hard cap", () => {
    const scope = buildChapterRepairBoundaryBlock(intent);
    const prompt = buildQualityAutoFixPrompt(
      "测试正文。",
      { issues: [{ type: "爽点不足", severity: "中", detail: "测试" }] },
      undefined,
      scope,
    );

    // Must contain boundary language
    expect(prompt).toContain("修稿输入边界");
    expect(prompt).toContain("禁止从后续章节计划中提取任何新剧情");

    // Must NOT contain old hard cap
    expect(prompt).not.toContain("不得超过硬上限");
    expect(prompt).not.toContain("严格遵守字数约束");
    expect(prompt).not.toContain("优先压缩式修复");
  });

  it("buildPlotAutoFixPrompt contains boundary block, no hard cap", () => {
    const scope = buildChapterRepairBoundaryBlock(intent);
    const prompt = buildPlotAutoFixPrompt(
      "测试正文。",
      null,
      null,
      null,
      undefined,
      scope,
    );

    // Must contain boundary language
    expect(prompt).toContain("修稿输入边界");
    expect(prompt).toContain("报告中出现的未来 hook / future signal");

    // Must NOT contain old hard cap
    expect(prompt).not.toContain("不得超过硬上限");
    expect(prompt).not.toContain("严格遵守字数约束");
  });

  it("accident abstraction: future items in reports are marked as forbidden, not material", () => {
    const futureReport = {
      publish_status: "MANUAL_REVIEW" as const,
      six_step_plot: { status: "FAIL_STRUCTURAL", score: 60, summary: "缺资产清算会/VCD调价单" },
    };
    const prompt = buildPlotAutoFixPrompt(
      "当前章正文。",
      futureReport,
      { dimensions: { ending_pull: "补陈兰名片线索" } },
      null,
      undefined,
      buildChapterRepairBoundaryBlock(intent),
    );

    // The prompt must contain the future items only as forbidden context
    expect(prompt).toContain("禁止从后续章节计划中提取任何新剧情");
    expect(prompt).toContain("不是要求你把所有关键词写进正文");
  });

  it("buildQualityAutoFixPrompt length constraint is min-focused", () => {
    const prompt = buildQualityAutoFixPrompt(
      "测试。",
      { issues: [] },
      "【字数约束】\n- 最低字数要求：1000字\n- 字数超出软上限不是错误",
      "",
    );
    expect(prompt).toContain("不得低于最低字数要求");
    expect(prompt).not.toContain("不得超过硬上限");
  });
});

describe("Goal 1: boundary block contains concrete intent fields (Fix H)", () => {
  const intent = "## 3. 本章主角目标\n- 表层目标：阻止父亲交集资款\n\n## 9. 下一章钩子\n- 结尾画面：窗外传来邻居哭骂声\n- 未解决问题：父亲会不会把钱交给主角\n- 下一章自然推进方向：前往市场寻找商机";

  it("contains concrete boundary fields from intent", () => {
    const block = buildChapterRepairBoundaryBlock(intent);
    // surfaceGoal as 本章目标
    // New boundary block uses generic text, not verbatim future info
    expect(block).toContain("本章目标");
    expect(block).toContain("阻止父亲交集资款");
    expect(block).toContain("本章结尾画面是当前章可写内容终点");
    expect(block).toContain("不得使用其具体事件");
    expect(block).toContain("未解决问题必须保持未解决");
    expect(block).toContain("章节结束边界");
  });
});
