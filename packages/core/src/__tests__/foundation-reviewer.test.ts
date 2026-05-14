import { describe, expect, it, vi } from "vitest";
import {
  countFallbackSections,
  FoundationReviewerAgent,
  hasFallbackContent,
} from "../agents/foundation-reviewer.js";
import type { ArchitectOutput } from "../agents/architect.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createAgent(): FoundationReviewerAgent {
  return new FoundationReviewerAgent({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        maxTokensCap: null,
        extra: {},
      },
    },
    model: "test-model",
    projectRoot: process.cwd(),
  });
}

function createFoundation(overrides: Partial<ArchitectOutput> = {}): ArchitectOutput {
  return {
    storyBible: "# Story Bible\n\n主角被资源制度排斥。",
    volumeOutline: "# Volume Outline\n\n前十章围绕入局和第一次反击。",
    bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules",
    currentState: "# Current State\n\n第0章，主角尚未入局。",
    pendingHooks: "# Pending Hooks\n\n| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |\n|---|---|---|---|---|---|---|---|",
    genreArchitecture: "# 题材架构\n\n## 1. 题材定位\n- 主分类：玄幻\n- 核心爽点：底层破局",
    worldEngine: "# 世界发动机\n\n## 1. 核心稀缺资源\n灵契名额被宗门垄断。\n\n## 6. 自动产出冲突的方式\n- 资源争夺\n- 阶层压迫",
    antagonistMap: "# 反派结构\n\n## 1. 核心反派\n- 反派类型：谋局者\n\n## 2. 核心反派的计划链\n- 计划 A：封锁名额\n- 计划 B：借主角破局清洗旧派\n- 计划 C：重塑秩序",
    motivationMatrix: "# 人物动机矩阵\n\n## 1. 主角动机\n- 表层目标：拿到灵契\n- 深层欲望：证明底层也能改写规则",
    first10ChapterPlan: "# 前10章规划\n\n## 1. 黄金三章目标\n### 第1章\n- 主钩子类型：极致情绪\n\n## 2. 前10章章节表\n| 章数 | 章节功能 | 情绪事件 | 主角目标 | 阻碍困境 | 解决方法 | 爽点/反转 | 结尾钩子 |\n|---|---|---|---|---|---|---|---|\n| 1 | 入局 | 被夺名额 | 夺回资格 | 宗门压制 | 找漏洞 | 小反击 | 名额背后有人 |",
    ...overrides,
  };
}

function reviewResponse(score = 88): string {
  return Array.from({ length: 11 }, (_, index) => [
    `=== DIMENSION: ${index + 1} ===`,
    `分数：${score}`,
    `意见：维度${index + 1}基本成立。`,
  ].join("\n")).join("\n\n")
    + "\n\n=== OVERALL ===\n总分：88\n通过：是\n总评：整体可进入写作。";
}

describe("FoundationReviewerAgent", () => {
  it("includes the new story skeleton sections and review requirements in prompts", async () => {
    const agent = createAgent();
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(), usage: ZERO_USAGE });

    await agent.review({
      foundation: createFoundation(),
      mode: "original",
      language: "zh",
    });

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("题材架构有效性");
    expect(messages[0]?.content).toContain("世界发动机有效性");
    expect(messages[0]?.content).toContain("核心反派有效性");
    expect(messages[0]?.content).toContain("人物动机有效性");
    expect(messages[0]?.content).toContain("前10章追读有效性");
    expect(messages[0]?.content).toContain("续写可用性");
    expect(messages[0]?.content).toContain("反派结构");
    expect(messages[0]?.content).toContain("六步闭环");

    expect(messages[1]?.content).toContain("## 题材架构");
    expect(messages[1]?.content).toContain("底层破局");
    expect(messages[1]?.content).toContain("## 世界发动机");
    expect(messages[1]?.content).toContain("灵契名额");
    expect(messages[1]?.content).toContain("## 反派结构");
    expect(messages[1]?.content).toContain("计划 A");
    expect(messages[1]?.content).toContain("## 人物动机矩阵");
    expect(messages[1]?.content).toContain("## 前10章规划");
  });

  it("preserves the new story dimensions in the review result", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(), usage: ZERO_USAGE });

    const result = await agent.review({
      foundation: createFoundation(),
      mode: "original",
      language: "zh",
    });

    const dimensionNames = result.dimensions.map((dimension) => dimension.name);
    expect(dimensionNames).toEqual(expect.arrayContaining([
      expect.stringContaining("genre_architecture_effectiveness"),
      expect.stringContaining("world_engine_effectiveness"),
      expect.stringContaining("antagonist_effectiveness"),
      expect.stringContaining("motivation_effectiveness"),
      expect.stringContaining("first_10_chapter_pull"),
      expect.stringContaining("continuation_usability"),
    ]));
    expect(result.passed).toBe(true);
  });

  it("detects fallback story skeleton content and lowers the related dimension", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(95), usage: ZERO_USAGE });
    const foundation = createFoundation({
      worldEngine: "# 世界发动机\n\n> 本文件由 inkos 2.0 create 阶段 fallback 生成。\n> 原因：LLM 未返回对应 section。\n\n## 1. 核心稀缺资源",
    });

    expect(hasFallbackContent(foundation.worldEngine)).toBe(true);
    expect(countFallbackSections(foundation)).toBe(1);

    const result = await agent.review({
      foundation,
      mode: "original",
      language: "zh",
    });

    const worldDimension = result.dimensions.find((dimension) => dimension.name.includes("world_engine_effectiveness"));
    expect(worldDimension?.score).toBeLessThanOrEqual(55);
    expect(worldDimension?.feedback).toContain("fallback");
    expect(result.passed).toBe(false);
    expect(result.overallFeedback).toContain("世界发动机");
    expect(result.overallFeedback).toContain("稀缺资源");
  });

  it("does not crash when all new sections are missing and caps the total below 70", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(95), usage: ZERO_USAGE });
    const foundation = createFoundation({
      genreArchitecture: undefined,
      worldEngine: undefined,
      antagonistMap: undefined,
      motivationMatrix: undefined,
      first10ChapterPlan: undefined,
    });

    const result = await agent.review({
      foundation,
      mode: "original",
      language: "zh",
    });

    expect(result.totalScore).toBeLessThan(70);
    expect(result.passed).toBe(false);
    expect(result.overallFeedback).toContain("题材架构");
    expect(result.overallFeedback).toContain("反派计划链");
    expect(result.overallFeedback).toContain("前10章每章结尾钩子");
  });

  it("keeps derivative foundation review compatible with the old five-section shape", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: Array.from({ length: 5 }, (_, index) => [
          `=== DIMENSION: ${index + 1} ===`,
          "分数：86",
          `意见：同人维度${index + 1}成立。`,
        ].join("\n")).join("\n\n") + "\n\n=== OVERALL ===\n总分：86\n通过：是\n总评：通过。",
        usage: ZERO_USAGE,
      });

    const result = await agent.review({
      foundation: createFoundation({
        genreArchitecture: undefined,
        worldEngine: undefined,
        antagonistMap: undefined,
        motivationMatrix: undefined,
        first10ChapterPlan: undefined,
      }),
      mode: "fanfic",
      language: "zh",
    });

    expect(result.dimensions).toHaveLength(5);
    expect(result.totalScore).toBe(86);
    expect(result.passed).toBe(true);
  });
});
