import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectAgent } from "../agents/architect.js";
import type { BookConfig } from "../models/book.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function validStructureSignalsSection(): string {
  return [
    "# Structure Signals",
    "```json",
    JSON.stringify({
      signals: {
        opening_hook: ["冲突", "恐惧", "威胁"],
        protagonist_goal: ["目标明确", "一定要", "必须完成"],
        pressure_source: ["追兵", "倒计时", "限期将至"],
        obstacle_dilemma: ["死局", "没选择", "进退两难"],
        solution_possibility: ["线索", "破绽", "一线生机"],
        active_attempt: ["选择", "冲出去", "奋力一搏"],
        payoff_reward: ["获得", "解锁", "突破瓶颈"],
        ending_pull: ["未解决", "新危机", "更大威胁"],
        antagonist_pressure: ["反派逼近", "围堵", "暗中窥视"],
        resource_reward: ["兑换", "净赚", "资源到手"],
        world_rule: ["规则限制", "天道", "法则约束"],
        forbidden_false_positive: ["普通", "日常", "无关"],
      },
    }),
    "```",
  ].join("\n");
}

describe("ArchitectAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses English prompts when generating foundation from imported English chapters", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# Story Bible",
          "",
          "=== SECTION: volume_outline ===",
          "# Volume Outline",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "# Book Rules",
          "",
          "=== SECTION: current_state ===",
          "# Current State",
          "",
          "=== SECTION: pending_hooks ===",
          "# Pending Hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(
      book,
      "Chapter 1: Prelude\n\nA cold wind crossed the harbor.",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("MUST be written in English");
    expect(messages[1]?.content).toContain("Generate the complete foundation");
    expect(messages[1]?.content).not.toContain("请从中反向推导");
  });

  it("does not embed Chinese section headings in imported English foundation prompts", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "english-book",
      title: "English Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "en",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# Story Bible",
          "",
          "=== SECTION: volume_outline ===",
          "# Volume Outline",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "# Book Rules",
          "",
          "=== SECTION: current_state ===",
          "# Current State",
          "",
          "=== SECTION: pending_hooks ===",
          "# Pending Hooks",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(
      book,
      "Chapter 1: Prelude\n\nA cold wind crossed the harbor.",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("## 01_Worldview");
    expect(messages[0]?.content).toContain("## Narrative Perspective");
    expect(messages[0]?.content).not.toContain("## 01_世界观");
    expect(messages[0]?.content).not.toContain("## 叙事视角");
  });

  it("embeds reviewer feedback into original foundation regeneration prompts", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "review-feedback-book",
      title: "雾港回灯",
      platform: "tomato",
      genre: "urban",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "# 待回收伏笔",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundation(
      book,
      undefined,
      "请把核心冲突收紧，并明确新空间不是旧案重演。",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("上一轮审核反馈");
    expect(messages[0]?.content).toContain("请把核心冲突收紧");
    expect(messages[0]?.content).toContain("明确新空间不是旧案重演");
  });

  it("embeds reviewer feedback into fanfic foundation regeneration prompts", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "fanfic-review-feedback-book",
      title: "三体：回声舱",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 60,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };

    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "# 待回收伏笔",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFanficFoundation(
      book,
      "# 原作正典\n- 罗辑在面壁计划中留下了一处空档。",
      "canon",
      "请明确分岔点，并用原创冲突替代原作重走。",
    );

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("上一轮审核反馈");
    expect(messages[0]?.content).toContain("请明确分岔点");
    expect(messages[0]?.content).toContain("原创冲突替代原作重走");
  });

  it("strips assistant-style trailing coda from the final pending hooks section", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "zh-book",
      title: "雾港回灯",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 50,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | 主线 | 未开启 | 无 | 10章 | 主线核心钩子 |",
          "",
          "如果你愿意，我下一步可以继续为这本《雾港回灯》输出：",
          "1. 前10章逐章细纲",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.pendingHooks).toContain("| H01 | 1 | 主线 | 未开启 | 0 | 10章 | 中程 | 主线核心钩子 |");
    expect(result.pendingHooks).not.toContain("如果你愿意");
    expect(result.pendingHooks).not.toContain("前10章逐章细纲");
  });

  it("normalizes architect pending hooks into runtime-compatible numeric progress columns", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "zh-book",
      title: "凌晨三点的证词",
      platform: "tomato",
      genre: "urban",
      status: "active",
      targetChapters: 80,
      chapterWordCount: 2000,
      language: "zh",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H13 | 22 | 舆情操盘 | 待推进 | 一家自媒体公司在多个旧案节点同步接单 | 51-60章 | 庄蔓出场后逐步揭露 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.pendingHooks).toContain("| H13 | 22 | 舆情操盘 | 待推进 | 0 | 51-60章 | 中程 | 庄蔓出场后逐步揭露（初始线索：一家自媒体公司在多个旧案节点同步接单） |");
  });

  it("accepts section labels with spacing and punctuation drift from non-strict models", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "format-drift-book",
      title: "格式漂移测试",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== Section：Story Bible ===",
          "# 故事圣经",
          "",
          "=== section: Volume Outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book-rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION : current state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    expect(result.storyBible).toBe("# 故事圣经");
    expect(result.volumeOutline).toBe("# 卷纲");
    expect(result.bookRules).toContain("version: \"1.0\"");
    expect(result.currentState).toBe("# 当前状态");
    expect(result.pendingHooks).toContain("| H01 | 1 | mystery | open | 0 | 10章 | 中程 | 初始钩子 |");
  });

  it("throws when a required foundation section is missing", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "broken-book",
      title: "Broken Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "# 伏笔池",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await expect(agent.generateFoundation(book)).rejects.toThrow(/book_rules/i);
  });

  it("passes maxTokens 16384 when generating foundation", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "max-tokens-book",
      title: "Max Tokens Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundation(book);

    expect(chatSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ temperature: 0.8, maxTokens: 16384 }),
    );
  });

  it("passes maxTokens 16384 when generating foundation from import", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "import-max-tokens-book",
      title: "Import Max Tokens Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFoundationFromImport(book, "第一章正文");

    expect(chatSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ temperature: 0.5, maxTokens: 16384 }),
    );
  });

  it("passes maxTokens 16384 when generating fanfic foundation", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const book: BookConfig = {
      id: "fanfic-max-tokens-book",
      title: "Fanfic Max Tokens Book",
      platform: "other",
      genre: "fanfic",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 2200,
      language: "zh",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    };

    const chatSpy = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# 故事圣经",
          "",
          "=== SECTION: volume_outline ===",
          "# 卷纲",
          "",
          "=== SECTION: book_rules ===",
          "---",
          "version: \"1.0\"",
          "---",
          "",
          "=== SECTION: current_state ===",
          "# 当前状态",
          "",
          "=== SECTION: pending_hooks ===",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| H01 | 1 | mystery | open | 0 | 10章 | 初始钩子 |",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    await agent.generateFanficFoundation(book, "正典文本", "canon");

    expect(chatSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ temperature: 0.7, maxTokens: 16384 }),
    );
  });

  it("writes webnovel template skeleton files when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-architect-template-"));
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    try {
      await agent.writeFoundationFiles(
        root,
        {
          storyBible: "# Story Bible",
          volumeOutline: "# Volume Outline",
          bookRules: "# Book Rules",
          currentState: "# Current State",
          pendingHooks: "# Pending Hooks",
          structureSignals: validStructureSignalsSection(),
        },
        true,
        "zh",
        "xuanhuan",
      );

      await expect(readFile(join(root, "story", "genre_profile.yaml"), "utf-8"))
        .resolves.toContain("template: xuanhuan");
      await expect(readFile(join(root, "story", "arc_map.yaml"), "utf-8"))
        .resolves.toContain("vol-01");
      await expect(readFile(join(root, "story", "power_system.yaml"), "utf-8"))
        .resolves.toContain("realm_tree:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parses story skeleton sections and includes story methods in create prompt", async () => {
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });
    const book: BookConfig = {
      id: "story-skeleton-book",
      title: "故事骨架测试",
      platform: "tomato",
      genre: "other",
      status: "active",
      targetChapters: 100,
      chapterWordCount: 2200,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    const chat = vi.spyOn(agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValue({
        content: [
          "=== SECTION: story_bible ===",
          "# Story Bible",
          "",
          "=== SECTION: volume_outline ===",
          "# Volume Outline",
          "",
          "=== SECTION: book_rules ===",
          "# Book Rules",
          "",
          "=== SECTION: current_state ===",
          "# Current State",
          "",
          "=== SECTION: pending_hooks ===",
          "# Pending Hooks",
          "",
          "=== SECTION: genre_architecture ===",
          "# 题材架构\n\n## 1. 题材定位",
          "",
          "=== SECTION: world_engine ===",
          "# 世界发动机\n\n## 1. 核心稀缺资源",
          "",
          "=== SECTION: antagonist_map ===",
          "# 反派结构\n\n## 1. 核心反派",
          "",
          "=== SECTION: motivation_matrix ===",
          "# 人物动机矩阵\n\n## 1. 主角动机",
          "",
          "=== SECTION: first_10_chapter_plan ===",
          "# 前10章规划\n\n## 1. 黄金三章目标",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const result = await agent.generateFoundation(book);

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("世界发动机");
    expect(messages[0]?.content).toContain("六步剧情闭环");
    expect(messages[0]?.content).toContain("谋局者");
    expect(messages[0]?.content).toContain("=== SECTION: first_10_chapter_plan ===");
    expect(result.genreArchitecture).toContain("# 题材架构");
    expect(result.worldEngine).toContain("# 世界发动机");
    expect(result.antagonistMap).toContain("# 反派结构");
    expect(result.motivationMatrix).toContain("# 人物动机矩阵");
    expect(result.first10ChapterPlan).toContain("# 前10章规划");
  });

  it("writes story skeleton files and falls back when sections are missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-architect-story-skeleton-"));
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    try {
      await agent.writeFoundationFiles(
        root,
        {
          storyBible: "# Story Bible",
          volumeOutline: "# Volume Outline",
          bookRules: "# Book Rules",
          currentState: "# Current State",
          pendingHooks: "# Pending Hooks",
          genreArchitecture: "# 题材架构\n\n自定义题材骨架",
          structureSignals: validStructureSignalsSection(),
        },
        false,
        "zh",
      );

      await expect(readFile(join(root, "story", "story_bible.md"), "utf-8"))
        .resolves.toContain("# Story Bible");
      await expect(readFile(join(root, "story", "volume_outline.md"), "utf-8"))
        .resolves.toContain("# Volume Outline");
      await expect(readFile(join(root, "story", "book_rules.md"), "utf-8"))
        .resolves.toContain("# Book Rules");
      await expect(readFile(join(root, "story", "current_state.md"), "utf-8"))
        .resolves.toContain("# Current State");
      await expect(readFile(join(root, "story", "pending_hooks.md"), "utf-8"))
        .resolves.toContain("# Pending Hooks");
      await expect(readFile(join(root, "story", "genre_architecture.md"), "utf-8"))
        .resolves.toContain("自定义题材骨架");

      const worldEngine = await readFile(join(root, "story", "world_engine.md"), "utf-8");
      const antagonistMap = await readFile(join(root, "story", "antagonist_map.md"), "utf-8");
      const motivationMatrix = await readFile(join(root, "story", "motivation_matrix.md"), "utf-8");
      const first10 = await readFile(join(root, "story", "first_10_chapter_plan.md"), "utf-8");

      expect(worldEngine).toContain("fallback 生成");
      expect(worldEngine).toContain("## 1. 核心稀缺资源");
      expect(antagonistMap).toContain("## 1. 核心反派");
      expect(motivationMatrix).toContain("## 1. 主角动机");
      expect(first10).toContain("## 2. 前10章章节表");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("backfills legacy control documents from story skeletons during foundation writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-architect-control-docs-"));
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    try {
      await agent.writeFoundationFiles(
        root,
        {
          storyBible: [
            "# Story Bible",
            "## 02_主角",
            "林烬，系统底层任务的唯一异常执行者。",
          ].join("\n"),
          volumeOutline: "# Volume Outline\n\n第1卷：系统惩罚与反杀。",
          bookRules: [
            "# Book Rules",
            "- name: 林烬",
            "- personalityLock: 冷静、嘴欠、护短",
            "- behavioralConstraints: 不主动伤害无辜",
          ].join("\n"),
          currentState: [
            "# Current State",
            "- 当前目标：活过第一次找死任务",
            "- 当前限制：系统惩罚随时触发",
            "- 当前冲突：宗门认为他是灾星",
          ].join("\n"),
          pendingHooks: "# Pending Hooks\n\n| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |\n|---|---|---|---|---|---|---|---|\n| sys-secret | 1 | 系统 | open | 0 | 系统真相 | 中程 | 找死任务来源不明 |",
          genreArchitecture: [
            "# 题材架构",
            "## 1. 题材定位",
            "- 目标读者：番茄玄幻爽文读者",
            "- 核心卖点：找死任务反向成神",
            "- 核心情绪：荒诞压迫后的反杀爽感",
            "## 2. 读者承诺",
            "- 这本书承诺给读者什么爽感？每次找死都变成打脸。",
            "## 4. 章节节奏模板",
            "- 每2章一个小爽点",
            "- 每5章一次反转",
          ].join("\n"),
          worldEngine: [
            "# 世界发动机",
            "## 5. 主角异常性",
            "- 主角为什么是世界规则里的异常？系统奖励与世界惩罚方向相反。",
            "## 6. 自动产出冲突的方式",
            "- 资源争夺",
            "- 规则惩罚",
            "- 群体误解",
          ].join("\n"),
          antagonistMap: [
            "# 反派结构",
            "## 1. 核心反派",
            "- 姓名/代号：司命院主",
            "- 表层身份：宗门戒律掌控者",
            "- 反派类型：谋局者",
            "## 4. 反派压力递进",
            "- 初期如何压迫主角？用戒律审判逼他认罪。",
          ].join("\n"),
          motivationMatrix: [
            "# 人物动机矩阵",
            "## 1. 主角动机",
            "- 表层目标：活过第一次找死任务",
            "- 深层欲望：证明命运不能被系统和宗门定义",
            "- 最大恐惧：重要的人替他付代价",
            "- 底线：不牺牲无辜者",
            "## 2. 核心反派动机",
            "- 深层欲望：维持司命院权威",
            "- 最大恐惧：秩序被一个底层弟子证明无效",
            "## 3. 重要配角动机表",
            "| 角色 | 表层目标 | 深层欲望 | 恐惧 | 底线 | 会背叛什么 | 绝不背叛什么 | 与主角利益关系 |",
            "|---|---|---|---|---|---|---|---|",
            "| 沈青禾 | 查清系统异常 | 摆脱家族棋子命运 | 被家族召回 | 不害平民 | 家族命令 | 自我判断 | 暂时同盟 |",
            "| 韩照 | 升入内门 | 被所有人看见 | 再次失败 | 不背刺兄弟 | 面子 | 林烬 | 同伴 |",
          ].join("\n"),
          first10ChapterPlan: [
            "# 前10章规划",
            "## 1. 黄金三章目标",
            "### 第1章",
            "- 主钩子类型：极度反差",
            "- 前500字冲突：系统要求林烬当众找死。",
            "### 第2章",
            "- 核心功能：展示越找死越变强。",
            "### 第3章",
            "- 核心功能：司命院主的阶段爪牙出现。",
            "## 2. 前10章章节表",
            "| 章数 | 章节功能 | 情绪事件 | 主角目标 | 阻碍困境 | 解决方法 | 爽点/反转 | 结尾钩子 |",
            "|---|---|---|---|---|---|---|---|",
            "| 1 | 入局 | 当众受审 | 活下来 | 戒律压迫 | 反用任务规则 | 反杀 | 司命院盯上他 |",
            "| 2 | 展示差异 | 惩罚降临 | 弄懂系统 | 众人围观 | 试探规则 | 小爽 | 奖励异常 |",
            "| 3 | 树敌 | 爪牙出手 | 查清任务来源 | 阶段敌人 | 借力破局 | 反转 | 核心反派露影 |",
          ].join("\n"),
          structureSignals: validStructureSignalsSection(),
        },
        false,
        "zh",
        undefined,
        { title: "我的系统只发布找死任务", genre: "system", platform: "tomato" },
      );

      const storyDir = join(root, "story");
      await expect(readFile(join(storyDir, "author_intent.md"), "utf-8"))
        .resolves.toContain("找死任务反向成神");
      await expect(readFile(join(storyDir, "current_focus.md"), "utf-8"))
        .resolves.toContain("第1章必须完成");

      const characterMatrix = await readFile(join(storyDir, "character_matrix.md"), "utf-8");
      expect(characterMatrix).toContain("## 主角：");
      expect(characterMatrix).toContain("司命院主");
      expect(characterMatrix).toContain("## 重要配角：沈青禾");

      const emotionalArcs = await readFile(join(storyDir, "emotional_arcs.md"), "utf-8");
      expect(emotionalArcs).toContain("## 1. 主角前10章情绪弧线");
      expect(emotionalArcs).toContain("| 1 | 当众受审 | 戒律压迫 |");

      const subplotBoard = await readFile(join(storyDir, "subplot_board.md"), "utf-8");
      expect(subplotBoard).toContain("system-secret");
      expect(subplotBoard).toContain("core-antagonist-plot");
      expect(subplotBoard).toContain("world-resource-monopoly");
      expect(subplotBoard.split("\n").filter((line) => line.startsWith("|") && !line.includes("---")).length)
        .toBeGreaterThanOrEqual(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes backfilled control documents into compact readable indexes", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-architect-control-docs-normalized-"));
    const agent = new ArchitectAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: process.cwd(),
    });

    try {
      await agent.writeFoundationFiles(
        root,
        {
          storyBible: [
            "# Story Bible",
            "## 02_主角",
            "- 姓名：林墨",
            "- 身份：江南市底层打工人，靠奶奶留下的吊坠激活系统。",
          ].join("\n"),
          volumeOutline: "# Volume Outline",
          bookRules: [
            "---",
            "version: \"1.0\"",
            "protagonist:",
            "  name: 林墨",
            "  personalityLock: [抠门, 嘴硬, 心软, 守序]",
            "  behavioralConstraints: [绝不伤害普通人, 朋友出事必帮]",
            "---",
          ].join("\n"),
          currentState: "# Current State",
          pendingHooks: [
            "# Pending Hooks",
            "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |",
            "|---|---|---|---|---|---|---|---|",
            "| system-garbled | 1 | 世界观 | open | 0 | 系统乱码其实是奶奶留言 | 180 | 每次升级都会弹出乱码字符 |",
            "| su-abnormal | 1 | 人物 | open | 0 | 苏晚晴见过规则类能力 | 35 | 她看到技能时眼神异常 |",
          ].join("\n"),
          genreArchitecture: "# 题材架构\n\n- 核心卖点：系统打脸爽文",
          worldEngine: [
            "# 世界发动机",
            "## 5. 主角异常性",
            "- 主角为什么是世界规则里的异常：不依赖灵气也能变强，威胁灵气垄断秩序。",
          ].join("\n"),
          antagonistMap: [
            "# 反派结构",
            "## 1. 核心反派",
            "- 姓名/代号：无面",
            "- 表层身份：江南市首富，知名慈善家。",
            "- 真实身份：旧时代存活的SS级邪修，黑曜会首领。",
            "- 反派类型：谋局者+殉道者混合型。",
            "- 公开目标：推动灵气复苏。",
            "- 隐藏目标：收集规则碎片，成神改写生死规则。",
            "- 维护的秩序：弱肉强食，强者有权支配弱者生命。",
            "- 为什么不能容忍主角：主角系统是完整规则神器，会打断成神计划。",
            "- 与主角的价值观冲突：主角保护普通人，无面愿为目标牺牲普通人。",
            "- 他的胜利会导致什么？全城普通人成为复苏祭品。",
            "- 他的失败会导致什么？黑曜会转入地下。",
            "## 2. 核心反派的计划链",
            "- 计划 A：伪装慈善家收集规则碎片。",
            "- 计划 B：利用主角暴露系统位置。",
            "- 计划 C：献祭城市重启旧时代阵法。",
            "## 4. 反派压力递进",
            "- 初期如何压迫主角？用舆论和金钱封锁主角。",
          ].join("\n"),
          motivationMatrix: [
            "# 人物动机矩阵",
            "## 1. 主角动机",
            "- 表层目标：凑房租活下去，后续赚大钱并保护身边的人。",
            "- 深层欲望：不再被人看不起，有能力保护自己在乎的人。",
            "- 最大恐惧：身边的人因自己出事，奶奶的吊坠被毁。",
            "- 底线：绝不伤害普通人，绝不牺牲无辜者。",
            "## 2. 核心反派动机",
            "- 深层欲望：复活死在旧时代的家人。",
            "- 最大恐惧：计划失败，家人永远无法复活。",
          ].join("\n"),
          first10ChapterPlan: [
            "# 前10章规划",
            "## 1. 黄金三章目标",
            "### 第1章",
            "- 主钩子类型：极度反差",
            "- 前500字冲突：林墨为了省钱参加慈善晚宴，却被系统要求当众拆穿首富。",
            "- 主角困境：拆穿会被保安拖走，不拆穿就会触发系统惩罚。",
            "- 章节结尾钩子：无面第一次注意到林墨。",
            "### 第2章",
            "- 核心功能：展示系统反向奖励。",
            "- 金手指/核心差异如何展示：林墨越像找死，越能拿到反制技能。",
            "- 阻碍如何升级：全网开始骂他碰瓷。",
            "- 章节结尾钩子：系统乱码出现奶奶声音。",
            "### 第3章",
            "- 核心功能：明确长期目标。",
            "- 长期目标如何明确：林墨决定查清吊坠和系统来源。",
            "- 第一个阶段敌人如何出现：无面的秘书开始监控他。",
            "- 章节结尾钩子：苏晚晴认出规则类能力。",
            "## 2. 前10章章节表",
            "| 章数 | 章节功能 | 情绪事件 | 主角目标 | 阻碍困境 | 解决方法 | 爽点/反转 | 结尾钩子 |",
            "|---|---|---|---|---|---|---|---|",
            "| 4 | 线索追踪 | 苏晚晴试探 | 找到乱码来源 | 黑曜会盯梢 | 假装无知 | 信息差 | 秘书现身 |",
            "| 5 | 小爽点 | 林墨反坑秘书 | 逼出幕后线索 | 舆论压迫 | 系统技能反制 | 打脸 | 无面加码 |",
          ].join("\n"),
          structureSignals: validStructureSignalsSection(),
        },
        false,
        "zh",
      );

      const storyDir = join(root, "story");
      const emotionalArcs = await readFile(join(storyDir, "emotional_arcs.md"), "utf-8");
      expect(emotionalArcs).toContain("| 1 | 林墨为了省钱参加慈善晚宴");
      expect(emotionalArcs).toContain("| 2 | 林墨越像找死");
      expect(emotionalArcs).toContain("| 3 | 林墨决定查清吊坠和系统来源");
      expect(emotionalArcs).toContain("| 4 | 苏晚晴试探 | 黑曜会盯梢 |");

      const characterMatrix = await readFile(join(storyDir, "character_matrix.md"), "utf-8");
      expect(characterMatrix).toContain("## 主角：林墨");
      expect(characterMatrix).toContain("## 核心反派：无面");
      expect(characterMatrix).not.toContain("## 主角：主角");
      expect(characterMatrix).not.toContain("## 2. 核心反派的计划链");
      expect(characterMatrix).toContain("- 表层身份：江南市首富");
      const protagonistConflictLine = characterMatrix
        .split("\n")
        .find((line) => line.startsWith("- 与核心反派的冲突："));
      expect(protagonistConflictLine?.length ?? 0).toBeLessThan(220);

      const subplotBoard = await readFile(join(storyDir, "subplot_board.md"), "utf-8");
      expect(subplotBoard).toContain("| hook-system-garbled | 世界观伏笔：system-garbled |");
      expect(subplotBoard).toContain("| hook-su-abnormal | 人物伏笔：su-abnormal |");
      expect(subplotBoard).not.toContain("/ hook_id / 起始章节 / 类型 /");
      expect(subplotBoard).not.toContain("| initial-hooks |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  describe("structure_signals write gate", () => {
    it("throws when structureSignals section is missing", async () => {
      const root = await mkdtemp(join(tmpdir(), "inkos-architect-sig-gate-"));
      const agent = new ArchitectAgent({
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0, maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      });

      try {
        await expect(
          agent.writeFoundationFiles(
            root,
            {
              storyBible: "# Story Bible",
              volumeOutline: "# Volume Outline",
              bookRules: "# Book Rules",
              currentState: "# Current State",
              pendingHooks: "# Pending Hooks",
              // structureSignals intentionally omitted
            },
            false,
            "zh",
          ),
        ).rejects.toThrow(/缺少 structure_signals section/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("throws on parse_error and does not write empty file", async () => {
      const root = await mkdtemp(join(tmpdir(), "inkos-architect-sig-gate-"));
      const agent = new ArchitectAgent({
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0, maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      });

      try {
        await expect(
          agent.writeFoundationFiles(
            root,
            {
              storyBible: "# Story Bible",
              volumeOutline: "# Volume Outline",
              bookRules: "# Book Rules",
              currentState: "# Current State",
              pendingHooks: "# Pending Hooks",
              structureSignals: "gibberish that cannot be parsed as JSON",
            },
            false,
            "zh",
          ),
        ).rejects.toThrow(/解析失败/);

        // Verify structure_signals.json was NOT written
        await expect(
          readFile(join(root, "story", "structure_signals.json"), "utf-8"),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("throws on validate FAIL and does not write invalid file", async () => {
      const root = await mkdtemp(join(tmpdir(), "inkos-architect-sig-gate-"));
      const agent = new ArchitectAgent({
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0, maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      });

      try {
        // 11 dims have 1 phrase, 1 dim is empty → parse ok, validate FAIL (empty dimension ERROR)
        const failSection = [
          "# Structure Signals",
          "```json",
          JSON.stringify({
            signals: {
              opening_hook: [],
              protagonist_goal: ["目标"],
              pressure_source: ["追兵"],
              obstacle_dilemma: ["死局"],
              solution_possibility: ["线索"],
              active_attempt: ["选择"],
              payoff_reward: ["获得"],
              ending_pull: ["未解决"],
              antagonist_pressure: ["反派"],
              resource_reward: ["兑换"],
              world_rule: ["规则"],
              forbidden_false_positive: ["普通"],
            },
          }),
          "```",
        ].join("\n");

        await expect(
          agent.writeFoundationFiles(
            root,
            {
              storyBible: "# Story Bible",
              volumeOutline: "# Volume Outline",
              bookRules: "# Book Rules",
              currentState: "# Current State",
              pendingHooks: "# Pending Hooks",
              structureSignals: failSection,
            },
            false,
            "zh",
          ),
        ).rejects.toThrow(/校验失败/);

        // Verify structure_signals.json was NOT written
        await expect(
          readFile(join(root, "story", "structure_signals.json"), "utf-8"),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("writes structure_signals.json for valid signals", async () => {
      const root = await mkdtemp(join(tmpdir(), "inkos-architect-sig-gate-"));
      const agent = new ArchitectAgent({
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0, maxTokensCap: null,
            extra: {},
          },
        },
        model: "test-model",
        projectRoot: process.cwd(),
      });

      try {
        const validSignalsContent = JSON.stringify({
          signals: {
            opening_hook: ["冲突", "恐惧", "威胁"],
            protagonist_goal: ["目标明确", "一定要", "必须完成"],
            pressure_source: ["追兵", "倒计时", "限期将至"],
            obstacle_dilemma: ["死局", "没选择", "进退两难"],
            solution_possibility: ["线索", "破绽", "一线生机"],
            active_attempt: ["选择", "冲出去", "奋力一搏"],
            payoff_reward: ["获得", "解锁", "突破瓶颈"],
            ending_pull: ["未解决", "新危机", "更大威胁"],
            antagonist_pressure: ["反派逼近", "围堵", "暗中窥视"],
            resource_reward: ["兑换", "净赚", "资源到手"],
            world_rule: ["规则限制", "天道", "法则约束"],
            forbidden_false_positive: ["普通", "日常", "无关"],
          },
        });

        const section = [
          "# Structure Signals",
          "```json",
          validSignalsContent,
          "```",
        ].join("\n");

        await agent.writeFoundationFiles(
          root,
          {
            storyBible: "# Story Bible",
            volumeOutline: "# Volume Outline",
            bookRules: "# Book Rules",
            currentState: "# Current State",
            pendingHooks: "# Pending Hooks",
            structureSignals: section,
          },
          false,
          "zh",
        );

        const written = await readFile(
          join(root, "story", "structure_signals.json"),
          "utf-8",
        );
        const parsed = JSON.parse(written);
        expect(parsed.bookId).toBeDefined();
        expect(parsed.signals.opening_hook).toEqual(["冲突", "恐惧", "威胁"]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
