import { describe, expect, it, vi } from "vitest";
import {
  countFallbackSections,
  FoundationReviewerAgent,
  hasFallbackContent,
} from "../agents/foundation-reviewer.js";
import { detectPublishSafetyRisks } from "../agents/foundation-safety.js";
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
  return Array.from({ length: 12 }, (_, index) => [
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
    expect(messages[0]?.content).toContain("发布安全与题材风险");
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
      expect.stringContaining("publish_safety_risk"),
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

  it("caps publish safety when book rules forbid political mapping but a real political figure appears", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(95), usage: ZERO_USAGE });

    const result = await agent.review({
      foundation: createFoundation({
        bookRules: "---\nprohibitions:\n  - 禁止映射现实政治人物与事件，所有内容均为平行世界虚构\nadditionalAuditDimensions: [政治敏感内容排查]\n---",
        antagonistMap: "# 反派结构\n\n## 1. 核心反派\n- 姓名/代号：特朗普\n- 表层身份：现任美国总统\n- 真实身份：资本寡头代理人",
      }),
      mode: "original",
      language: "zh",
    });

    const safetyDimension = result.dimensions.find((dimension) => dimension.name.includes("publish_safety_risk"));
    expect(safetyDimension?.score).toBeLessThanOrEqual(60);
    expect(result.totalScore).toBeLessThanOrEqual(79);
    expect(result.passed).toBe(false);
    expect(result.overallFeedback).toContain("完全虚构");
    expect(result.overallFeedback).toContain("现实政治");
  });

  it("caps publish safety for direct identity insults without repeating the insult in feedback", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(95), usage: ZERO_USAGE });

    const result = await agent.review({
      foundation: createFoundation({
        bookRules: "---\nprohibitions:\n  - 禁止出现种族歧视、违反公序良俗的政治操作\nadditionalAuditDimensions: [政治敏感内容排查]\n---",
        genreArchitecture: "# 题材架构\n\n## 3. 开局打法\n第一章让反派用黄种猪羞辱主角。",
      }),
      mode: "original",
      language: "zh",
    });

    const safetyDimension = result.dimensions.find((dimension) => dimension.name.includes("publish_safety_risk"));
    expect(safetyDimension?.score).toBeLessThanOrEqual(55);
    expect(result.totalScore).toBeLessThanOrEqual(75);
    expect(result.passed).toBe(false);
    expect(result.overallFeedback).toContain("身份羞辱");
    expect(result.overallFeedback).toContain("概括性描述");
    expect(result.overallFeedback).not.toContain("黄种猪");
  });

  it("detects expanded Chinese and English identity insults across foundation sections", () => {
    const genreReport = detectPublishSafetyRisks(createFoundation({
      genreArchitecture: "# 题材架构\n\n第一章混混用黄皮猪羞辱主角。",
    }));
    expect(genreReport.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "identity_insult", section: "genre_architecture" }),
    ]));

    const first10Report = detectPublishSafetyRisks(createFoundation({
      first10ChapterPlan: "# 前10章规划\n\n第1章反派阵营用 ChInK 攻击主角。",
    }));
    expect(first10Report.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "identity_insult", section: "first_10_chapter_plan" }),
    ]));

    const antagonistReport = detectPublishSafetyRisks(createFoundation({
      antagonistMap: "# 反派结构\n\n阶段反派用 nigger 辱骂主角盟友。",
    }));
    expect(antagonistReport.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "identity_insult", section: "antagonist_map" }),
    ]));
  });

  it("does not repeat expanded identity insults in reviewer feedback", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(95), usage: ZERO_USAGE });

    const result = await agent.review({
      foundation: createFoundation({
        bookRules: "---\nprohibitions:\n  - 禁止出现种族歧视、违反公序良俗的政治操作\nadditionalAuditDimensions: [政治敏感内容排查]\n---",
        first10ChapterPlan: "# 前10章规划\n\n第1章反派用黄皮猪和 ChInK 刺激主角。",
      }),
      mode: "original",
      language: "zh",
    });

    const safetyDimension = result.dimensions.find((dimension) => dimension.name.includes("publish_safety_risk"));
    expect(safetyDimension?.score).toBeLessThanOrEqual(55);
    expect(result.totalScore).toBeLessThanOrEqual(75);
    expect(result.passed).toBe(false);
    expect(result.overallFeedback).toContain("概括性描述");
    expect(result.overallFeedback).not.toContain("黄皮猪");
    expect(result.overallFeedback.toLowerCase()).not.toContain("chink");
  });

  it("caps the total at 69 when real political mapping and identity insults appear together", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(95), usage: ZERO_USAGE });

    const result = await agent.review({
      foundation: createFoundation({
        bookRules: "---\nprohibitions:\n  - 禁止映射现实政治人物与事件，所有内容均为平行世界虚构\n  - 禁止出现种族歧视、违反公序良俗的政治操作\nadditionalAuditDimensions: [政治敏感内容排查]\n---",
        antagonistMap: "# 反派结构\n\n- 姓名/代号：拜登\n- 表层身份：现任美国总统",
        first10ChapterPlan: "# 前10章规划\n\n## 1. 黄金三章目标\n### 第1章\n- 前500字冲突：反派阵营用黑鬼攻击主角盟友。",
      }),
      mode: "original",
      language: "zh",
    });

    expect(result.totalScore).toBeLessThanOrEqual(69);
    expect(result.passed).toBe(false);
  });

  it("does not fail fictionalized political elements by local safety gate", async () => {
    const report = detectPublishSafetyRisks(createFoundation({
      bookRules: "---\nprohibitions:\n  - 禁止映射现实政治人物与事件，所有内容均为平行世界虚构\nadditionalAuditDimensions: [政治敏感内容排查]\n---",
      genreArchitecture: "# 题材架构\n\n平行世界总统竞选，虚构总统与蓝鹰党、赤象党争夺民意系统。",
      antagonistMap: "# 反派结构\n\n- 姓名/代号：霍兰\n- 表层身份：虚构联邦现任总统\n- 反派类型：谋局者",
    }));

    expect(report.risks).toHaveLength(0);
  });

  it("does not treat real nationality or ancestry as severe political mapping", () => {
    const report = detectPublishSafetyRisks(createFoundation({
      bookRules: "---\nprohibitions:\n  - 禁止任何现实国家、政党、人物、事件映射\nadditionalAuditDimensions: [政治敏感内容排查]\n---",
      storyBible: "# Story Bible\n\n主角是中国籍华裔青年，想给祖国争光；故事发生在平行世界联邦。",
      genreArchitecture: "# 题材架构\n\n保留身份不公和跨国竞选爽点，但外国政权和总统全部虚构化。",
    }));

    expect(report.risks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "real_political_figure" }),
      expect.objectContaining({ type: "real_political_party" }),
      expect.objectContaining({ type: "real_event_mapping" }),
      expect.objectContaining({ type: "identity_insult" }),
    ]));
    expect(report.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "rule_precision_warning", severity: "low" }),
    ]));
    expect(report.maxTotalScore).toBeUndefined();
  });

  it("still blocks real political figures, parties, and events after country-rule precision handling", () => {
    const report = detectPublishSafetyRisks(createFoundation({
      bookRules: "---\nprohibitions:\n  - 禁止任何现实国家、政党、人物、事件映射\nadditionalAuditDimensions: [政治敏感内容排查]\n---",
      antagonistMap: "# 反派结构\n\n- 姓名/代号：奥巴马\n- 背后势力：民主党",
      first10ChapterPlan: "# 前10章规划\n\n第5章卷入2024大选余波。",
    }));

    expect(report.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "real_political_figure" }),
      expect.objectContaining({ type: "real_political_party" }),
      expect.objectContaining({ type: "real_event_mapping" }),
      expect.objectContaining({ type: "book_rule_violation" }),
    ]));
    expect(report.maxTotalScore).toBeLessThanOrEqual(79);
  });

  it("does not affect ordinary non-political system foundations", async () => {
    const agent = createAgent();
    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({ content: reviewResponse(88), usage: ZERO_USAGE });

    const result = await agent.review({
      foundation: createFoundation({
        storyBible: "# Story Bible\n\n主角拿到没用系统，在修仙宗门中从杂役逆袭。",
        bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n禁止系统规则前后矛盾。",
      }),
      mode: "original",
      language: "zh",
    });

    const safetyDimension = result.dimensions.find((dimension) => dimension.name.includes("publish_safety_risk"));
    expect(safetyDimension?.score).toBe(88);
    expect(result.passed).toBe(true);
  });
});
