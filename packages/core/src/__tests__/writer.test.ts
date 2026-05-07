import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WriterAgent } from "../agents/writer.js";
import type { ChapterGoal } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import { buildLengthSpec } from "../utils/length-metrics.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function defaultSettlementResponse(chapter = 1, title = "测试章") {
  return {
    content: [
      "=== POST_SETTLEMENT ===",
      "- settled",
      "",
      "=== UPDATED_STATE ===",
      "# 当前状态",
      "",
      "=== UPDATED_HOOKS ===",
      "# 伏笔池",
      "",
      "=== CHAPTER_SUMMARY ===",
      `| ${chapter} | ${title} | 楚夜 | 章节完成 | 状态更新 | none | 平稳 | mainline |`,
      "",
      "=== UPDATED_SUBPLOTS ===",
      "# 支线进度板",
      "",
      "=== UPDATED_EMOTIONAL_ARCS ===",
      "# 情感弧线",
      "",
      "=== UPDATED_CHARACTER_MATRIX ===",
      "# 角色交互矩阵",
    ].join("\n"),
    usage: ZERO_USAGE,
  };
}

function defaultCreativeResponse(title = "测试章", content = "楚夜完成本章目标，局势暂时稳定下来。") {
  return {
    content: [
      "=== CHAPTER_TITLE ===",
      title,
      "",
      "=== CHAPTER_CONTENT ===",
      content,
      "",
      "=== PRE_WRITE_CHECK ===",
      "- ok",
    ].join("\n"),
    usage: ZERO_USAGE,
  };
}

async function fallbackChatResponse(messages?: ReadonlyArray<{ readonly content?: string }>) {
  const joined = messages?.map((message) => message.content ?? "").join("\n") ?? "";
  if (joined.includes("POST_SETTLEMENT") || joined.includes("真相文件") || joined.includes("truth files")) {
    return defaultSettlementResponse();
  }
  if (joined.includes("提取") || joined.includes("OBSERVATIONS") || joined.includes("Observer")) {
    return { content: "=== OBSERVATIONS ===\n- observed", usage: ZERO_USAGE };
  }
  return defaultCreativeResponse();
}

function findUserPromptContaining(
  calls: ReadonlyArray<ReadonlyArray<unknown>>,
  needle: string,
): string {
  for (const call of calls) {
    const messages = call[0] as ReadonlyArray<{ readonly content?: string }> | undefined;
    const userContent = messages?.[1]?.content ?? "";
    if (userContent.includes(needle)) return userContent;
  }
  return "";
}

function findSystemPromptContaining(
  calls: ReadonlyArray<ReadonlyArray<unknown>>,
  needle: string,
): string {
  for (const call of calls) {
    const messages = call[0] as ReadonlyArray<{ readonly content?: string }> | undefined;
    const systemContent = messages?.[0]?.content ?? "";
    if (systemContent.includes(needle)) return systemContent;
  }
  return "";
}

function createCaptureLogger() {
  const infos: string[] = [];
  const warnings: string[] = [];

  const logger = {
    debug() {},
    info(message: string) {
      infos.push(message);
    },
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
    child() {
      return logger;
    },
  };

  return { logger, infos, warnings };
}

describe("WriterAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses compact summary context plus selected long-range evidence during governed settlement", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 100\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "# Pending Hooks",
        "",
        "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
        "| old-seal | 3 | artifact | open | 12 | 40 | Old seal detour |",
        "| stale-ledger | 14 | mystery | open | 70 | 120 | Old ledger debt is dormant but unresolved |",
        "| mentor-oath | 8 | relationship | open | 99 | 101 | Mentor oath debt with Lin Yue |",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "# Chapter Summaries",
        "",
        "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
        "| 97 | Shrine Ash | Lin Yue | The old shrine proves empty | Frustration rises | none | bitter | setback |",
        "| 98 | Trial Echo | Lin Yue | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
        "| 99 | Locked Gate | Lin Yue | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | mentor-oath advanced | focused | decision |",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), [
        "# 支线进度板",
        "",
        "| 支线ID | 支线名 | 相关角色 | 起始章 | 最近活跃章 | 距今章数 | 状态 | 进度概述 | 回收ETA |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| SP-mentor | 师债线 | Lin Yue | 8 | 99 | 1 | active | 师债继续推进 | 101 |",
        "| SP-seal | 旧印支线 | Guildmaster Ren | 3 | 12 | 88 | closed | 旧印已回收 | 12 |",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), [
        "# 情感弧线",
        "",
        "| 角色 | 章节 | 情绪状态 | 触发事件 | 强度(1-10) | 弧线方向 |",
        "| --- | --- | --- | --- | --- | --- |",
        "| Lin Yue | 40 | 麻木 | 旧印支线拖延 | 4 | 停滞 |",
        "| Lin Yue | 99 | 紧绷 | 师债重新压上来 | 8 | 收紧 |",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), [
        "# 角色交互矩阵",
        "",
        "### 角色档案",
        "| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| Lin Yue | oath | restraint | clipped | stubborn | self | repay debt | find mentor |",
        "| Guildmaster Ren | guild | swagger | loud | opportunistic | rival | stall Mara | seize seal |",
      ].join("\n"), "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "A Decision",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue turned away from the guild trail and chose the mentor debt.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "| 伏笔变动 | mentor-oath 推进 | 同步更新伏笔池 |",
          "",
          "=== UPDATED_STATE ===",
          "状态卡",
          "",
          "=== UPDATED_HOOKS ===",
          "伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 100 | A Decision | Lin Yue | Chooses the mentor debt | Focus narrowed | mentor-oath advanced | tense | decision |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "支线板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "角色矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火堆后的短歇 | 楚夜 | 休整后前推 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火堆后的短歇 | 楚夜 | 休整后前推 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 120,
          chapterWordCount: 2200,
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 100,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Goal",
          "Bring the focus back to the mentor oath conflict.",
          "",
          "## Hook Agenda",
          "### Must Advance",
          "- mentor-oath",
          "",
          "### Eligible Resolve",
          "- none",
          "",
          "### Stale Debt",
          "- stale-ledger",
          "",
          "### Avoid New Hook Families",
          "- none",
        ].join("\n"),
        contextPackage: {
          chapter: 100,
          selectedContext: [
            {
              source: "story/volume_outline.md",
              reason: "Anchor the current beat.",
              excerpt: "Bring the focus back to the mentor oath conflict.",
            },
            {
              source: "story/chapter_summaries.md#99",
              reason: "Relevant episodic memory.",
              excerpt: "Locked Gate | Lin Yue chooses the mentor line over the guild line | mentor-oath advanced",
            },
            {
              source: "story/pending_hooks.md#mentor-oath",
              reason: "Carry forward unresolved hook.",
              excerpt: "relationship | open | 101 | Mentor oath debt with Lin Yue",
            },
            {
              source: "runtime/hook_debt#mentor-oath",
              reason: "Explicit hook debt brief for the agenda target.",
              excerpt: "mentor-oath | cadence: slow-burn | seed: ch8 River Camp - Mentor debt becomes personal | latest: ch99 Locked Gate - Lin Yue chooses the mentor line over the guild line | unpaid: reveal why the mentor broke the oath",
            },
          ],
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: {
            hard: ["current_state"],
            soft: ["current_focus"],
            diagnostic: ["continuity_audit"],
          },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      const settlePrompt = findUserPromptContaining(chatSpy.mock.calls, "## 本章控制输入");
      expect(settlePrompt).toContain("## 本章控制输入");
      expect(settlePrompt).toContain("story/chapter_summaries.md#99");
      expect(settlePrompt).toContain("| 99 | Locked Gate |");
      expect(settlePrompt).toContain("## Hook Debt Briefs");
      expect(settlePrompt).toContain("mentor-oath | cadence: slow-burn");
      expect(settlePrompt).toContain("| stale-ledger | 14 | mystery | open | 70 | 120 | 中程 | Old ledger debt is dormant but unresolved |");
      expect(settlePrompt).not.toContain("| 1 | Guild Trail |");
      expect(settlePrompt).not.toContain("old-seal");
      expect(settlePrompt).not.toContain("Guildmaster Ren");
      expect(settlePrompt).not.toContain("| Lin Yue | 40 | 麻木 |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds structured runtime-state artifacts when settler returns a delta", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-runtime-state-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(storyDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(join(chaptersDir, "index.json"), JSON.stringify([
        { number: 1, title: "Ch1", status: "approved" },
        { number: 2, title: "Ch2", status: "approved" },
      ]), "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 3\nTrace the debt through the river-port ledger.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 2 |",
        "| Current Goal | Find the vanished mentor |",
        "| Current Conflict | Guild pressure keeps colliding with the debt trail |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| mentor-debt | 1 | relationship | open | 2 | 6 | Still unresolved |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 2 | Old Ledger | Lin Yue | Lin Yue finds the old ledger | Debt sharpens | mentor-debt advanced | tense | mainline |",
        "",
      ].join("\n"), "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "River Ledger",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue follows the debt into the river-port ledger.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- mentor-debt advanced",
          "",
          "=== RUNTIME_STATE_DELTA ===",
          "```json",
          JSON.stringify({
            chapter: 3,
            currentStatePatch: {
              currentGoal: "Trace the debt through the river-port ledger.",
              currentConflict: "Guild pressure keeps colliding with the debt trail.",
            },
            hookOps: {
              upsert: [
                {
                  hookId: "mentor-debt",
                  startChapter: 1,
                  type: "relationship",
                  status: "progressing",
                  lastAdvancedChapter: 3,
                  expectedPayoff: "Reveal the debt.",
                  notes: "The ledger clue sharpens the line.",
                },
              ],
              resolve: [],
              defer: [],
            },
            chapterSummary: {
              chapter: 3,
              title: "River Ledger",
              characters: "Lin Yue",
              events: "Lin Yue follows the debt into the river-port ledger.",
              stateChanges: "The debt line sharpens.",
              hookActivity: "mentor-debt advanced",
              mood: "tense",
              chapterType: "investigation",
            },
            notes: [],
          }, null, 2),
          "```",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | 先休整后推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | 先休整后推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-25T00:00:00.000Z",
          updatedAt: "2026-03-25T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 3,
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      expect(output.runtimeStateDelta?.chapter).toBe(3);
      expect(output.runtimeStateSnapshot?.manifest.lastAppliedChapter).toBe(3);
      expect(output.updatedState).toContain("Trace the debt through the river-port ledger.");
      expect(output.updatedHooks).toContain("mentor-debt");
      expect(output.updatedChapterSummaries).toContain("River Ledger");
      expect(output.chapterSummary).toContain("| 3 | River Ledger |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("overrides hallucinated chapter numbers across both delta and summary row", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-runtime-state-hallucinated-chapter-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(storyDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(join(chaptersDir, "index.json"), JSON.stringify([
        { number: 1, title: "Ch1", status: "approved" },
        { number: 2, title: "Ch2", status: "approved" },
      ]), "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The city still remembers 1988.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 3\nTrace the debt through the river-port ledger.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 2 |",
        "| Current Goal | Find the vanished mentor |",
        "| Current Conflict | Guild pressure keeps colliding with the debt trail |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| mentor-debt | 1 | relationship | open | 2 | 6 | Still unresolved |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 2 | Old Ledger | Lin Yue | Lin Yue finds the old ledger | Debt sharpens | mentor-debt advanced | tense | mainline |",
        "",
      ].join("\n"), "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "River Ledger",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue follows the debt into the river-port ledger. The old wall still carries the year 1988.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- mentor-debt advanced",
          "",
          "=== RUNTIME_STATE_DELTA ===",
          "```json",
          JSON.stringify({
            chapter: 1988,
            currentStatePatch: {
              currentGoal: "Trace the debt through the river-port ledger.",
              currentConflict: "Guild pressure keeps colliding with the debt trail.",
            },
            hookOps: {
              upsert: [
                {
                  hookId: "mentor-debt",
                  startChapter: 1,
                  type: "relationship",
                  status: "progressing",
                  lastAdvancedChapter: 1988,
                  expectedPayoff: "Reveal the debt.",
                  notes: "The ledger clue sharpens the line.",
                },
              ],
              resolve: [],
              defer: [],
            },
            chapterSummary: {
              chapter: 1988,
              title: "River Ledger",
              characters: "Lin Yue",
              events: "Lin Yue follows the debt into the river-port ledger.",
              stateChanges: "The debt line sharpens.",
              hookActivity: "mentor-debt advanced",
              mood: "tense",
              chapterType: "investigation",
            },
            notes: [],
          }, null, 2),
          "```",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | Scene3推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | Scene3推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-25T00:00:00.000Z",
          updatedAt: "2026-03-25T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 3,
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      expect(output.runtimeStateDelta?.chapter).toBe(3);
      expect(output.runtimeStateDelta?.chapterSummary?.chapter).toBe(3);
      expect(output.runtimeStateSnapshot?.manifest.lastAppliedChapter).toBe(3);
      expect(output.runtimeStateSnapshot?.hooks.hooks[0]?.lastAdvancedChapter).toBe(3);
      expect(output.updatedHooks).toContain("| mentor-debt | 1 | relationship | progressing | 3 |");
      expect(output.updatedChapterSummaries).toContain("| 3 | River Ledger |");
      expect(output.chapterSummary).toContain("| 3 | River Ledger |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns the arbiter-resolved delta instead of raw new-hook candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-arbiter-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(storyDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(join(chaptersDir, "index.json"), JSON.stringify([
        { number: 1, title: "Ch1", status: "approved" },
        { number: 2, title: "Ch2", status: "approved" },
      ]), "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- Anonymous messages keep steering the debt trail.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 3\nThe anonymous source widens from route to address.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 2 |",
        "| Current Goal | Find who fed the route to the anonymous source |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| anonymous-source-scope | 1 | source-risk | open | 2 | Reveal how much the anonymous source already knew about the route. | The source knowledge question remains unresolved. |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 2 | Route Leak | Lin Yue | An anonymous source already knew the route | Suspicion sharpens | anonymous-source-scope advanced | tense | mainline |",
        "",
      ].join("\n"), "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "Address Leak",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue realizes the anonymous source knew the address, not just the route.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- source scope widens",
          "",
          "=== RUNTIME_STATE_DELTA ===",
          "```json",
          JSON.stringify({
            chapter: 3,
            hookOps: {
              upsert: [],
              mention: [],
              resolve: [],
              defer: [],
            },
            newHookCandidates: [
              {
                type: "source-risk",
                expectedPayoff: "Reveal how much the anonymous source already knew about the route and address.",
                notes: "This chapter adds the address angle to the anonymous source question.",
              },
            ],
            chapterSummary: {
              chapter: 3,
              title: "Address Leak",
              characters: "Lin Yue",
              events: "Lin Yue realizes the anonymous source knew the address.",
              stateChanges: "The source knowledge question widens.",
              hookActivity: "anonymous-source-scope advanced",
              mood: "tight",
              chapterType: "investigation",
            },
            notes: [],
          }, null, 2),
          "```",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | 低强度推进 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-27T00:00:00.000Z",
          updatedAt: "2026-03-27T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 3,
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      expect(output.runtimeStateDelta?.hookOps.upsert).toEqual([
        expect.objectContaining({
          hookId: "anonymous-source-scope",
          lastAdvancedChapter: 3,
        }),
      ]);
      expect(output.runtimeStateDelta?.newHookCandidates).toEqual([]);
      expect(output.updatedHooks).toContain("anonymous-source-scope");
      expect(output.updatedHooks).toContain("| anonymous-source-scope | 1 | source-risk | progressing | 3 |");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs localized phase messages for Chinese books", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const { logger, infos } = createCaptureLogger();
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# 章节摘要\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
      logger,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "试炼前夜",
          "",
          "=== CHAPTER_CONTENT ===",
          "林越在破庙外停住脚步，想起师门旧债。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "| 伏笔变动 | mentor-oath 推进 | 同步更新伏笔池 |",
          "",
          "=== UPDATED_STATE ===",
          "状态卡",
          "",
          "=== UPDATED_HOOKS ===",
          "伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 1 | 试炼前夜 | 林越 | 林越记起师门旧债 | 决心加深 | mentor-oath advanced | tense | setup |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "支线板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "角色矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => defaultSettlementResponse(1, "试炼前夜"));
    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 120,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 1,
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(infos).toEqual(expect.arrayContaining([
        "阶段 1：创作正文（第1章）",
        "阶段 2：状态结算（第1章，27字）",
        "阶段 2a：提取第1章事实",
        "阶段 2b：把观察结果回写到真相文件",
      ]));
    } finally {
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("injects an English variance brief into governed creative prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-variance-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(storyDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The registry seals matter.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\nForce Mara back toward the ledger trail.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose lean.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Mara still hides the ledger fragment.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| ledger-fragment | 1 | mystery | open | 3 | 8 | Mara still hides the ledger fragment |",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | Ledger | Mara | Mara hides the ledger | pressure tightens | none | tense | investigation |",
        "| 2 | Ash | Mara,Taryn | Ash falls over the archive | pressure tightens | none | tense | investigation |",
        "| 3 | Harbor | Mara,Taryn | The gate stays under watch | pressure tightens | none | tense | investigation |",
      ].join("\n"), "utf-8"),
      writeFile(join(chaptersDir, "0001_Ledger.md"), "# Chapter 1 Ledger\n\nMara kept the ledger close to her chest. The corridor stayed quiet after the bell. There it was again.\n", "utf-8"),
      writeFile(join(chaptersDir, "0002_Ash.md"), "# Chapter 2 Ash\n\nMara kept the ledger close to her chest while the ash fell. The corridor stayed quiet until Taryn stopped. There it was again.\n", "utf-8"),
      writeFile(join(chaptersDir, "0003_Harbor.md"), "# Chapter 3 Harbor\n\nMara kept the ledger close to her chest near the harbor gate. The corridor stayed quiet while the guards changed. There it was again.\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "Pressure Ledger",
          "",
          "=== CHAPTER_CONTENT ===",
          "Mara forced Taryn to answer beside the archive window.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- ledger-fragment advanced",
          "",
          "=== UPDATED_STATE ===",
          "state",
          "",
          "=== UPDATED_HOOKS ===",
          "hooks",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 4 | Pressure Ledger | Mara,Taryn | Pressure rises | Trail narrows | ledger-fragment advanced | tense | confrontation |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "subplots",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "arcs",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "matrix",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));

    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 4,
        chapterIntent: "# Chapter Intent\n\n## Goal\nForce Mara back toward the ledger trail.\n",
        contextPackage: {
          chapter: 4,
          selectedContext: [
            {
              source: "story/chapter_summaries.md#3",
              reason: "Carry recent pressure into the next chapter.",
              excerpt: "The gate stays under watch.",
            },
          ],
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: {
            hard: ["current_state"],
            soft: ["current_focus"],
            diagnostic: ["continuity_audit"],
          },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      const creativePrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
      expect(creativePrompt).toContain("## English Variance Brief");
      expect(creativePrompt).toContain("High-frequency phrases");
      expect(creativePrompt).toContain("Scene obligation");
    } finally {
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders explicit title history, mood trail, and canon blocks in governed creative prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-governed-evidence-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- Registry seals still matter.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\nPush Mara back toward the archive ledger.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose lean.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Mara still hides the ledger fragment.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- ledger-fragment\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "Archive Pressure",
          "",
          "=== CHAPTER_CONTENT ===",
          "Mara corners Taryn beside the archive ledger.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- ledger-fragment advanced",
          "",
          "=== UPDATED_STATE ===",
          "state",
          "",
          "=== UPDATED_HOOKS ===",
          "hooks",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 4 | Archive Pressure | Mara,Taryn | Pressure rises | Trail narrows | ledger-fragment advanced | tense | confrontation |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "subplots",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "arcs",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "matrix",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 4,
        chapterIntent: "# Chapter Intent\n\n## Goal\nPush Mara back toward the archive ledger.\n",
        contextPackage: {
          chapter: 4,
          selectedContext: [
            {
              source: "story/chapter_summaries.md#recent_titles",
              reason: "Avoid repeated ledger titles.",
              excerpt: "1: Ledger in Rain | 2: Ledger at Dusk | 3: Harbor Ledger",
            },
            {
              source: "story/chapter_summaries.md#recent_mood_type_trail",
              reason: "Track recent emotional and chapter-type cadence.",
              excerpt: "1: tight / investigation | 2: tight / investigation | 3: tight / investigation",
            },
            {
              source: "story/parent_canon.md",
              reason: "Preserve parent canon constraints.",
              excerpt: "The mentor does not learn about the archive fire until volume two.",
            },
            {
              source: "story/fanfic_canon.md",
              reason: "Preserve extracted fanfic canon constraints.",
              excerpt: "Mara may diverge from the archive route, but the oath debt logic must stay intact.",
            },
          ],
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: {
            hard: ["current_state"],
            soft: ["current_focus"],
            diagnostic: ["continuity_audit"],
          },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      const creativePrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
      expect(creativePrompt).toContain("## Recent Title History");
      expect(creativePrompt).toContain("Ledger in Rain");
      expect(creativePrompt).toContain("## Recent Mood / Chapter Type Trail");
      expect(creativePrompt).toContain("tight / investigation");
      expect(creativePrompt).toContain("## Canon Evidence");
      expect(creativePrompt).toContain("archive fire until volume two");
      expect(creativePrompt).toContain("oath debt logic must stay intact");
    } finally {
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders an explicit hook agenda block and removes placeholder hook ids from the governed write contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-hook-agenda-test-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- Registry seals still matter.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\nPush Mara back toward the archive ledger.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose lean.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Mara still hides the ledger fragment.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- ledger-fragment\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "Archive Pressure",
          "",
          "=== CHAPTER_CONTENT ===",
          "Mara corners Taryn beside the archive ledger.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- ledger-fragment advanced",
          "",
          "=== UPDATED_STATE ===",
          "state",
          "",
          "=== UPDATED_HOOKS ===",
          "hooks",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 4 | Archive Pressure | Mara,Taryn | Pressure rises | Trail narrows | ledger-fragment advanced | tense | confrontation |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "subplots",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "arcs",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "matrix",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-26T00:00:00.000Z",
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 4,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Goal",
          "Push Mara back toward the archive ledger.",
          "",
          "## Hook Agenda",
          "### Must Advance",
          "- mentor-oath",
          "",
          "### Eligible Resolve",
          "- ledger-fragment",
          "",
          "### Stale Debt",
          "- stale-ledger",
          "",
          "### Avoid New Hook Families",
          "- relationship",
        ].join("\n"),
        contextPackage: {
          chapter: 4,
          selectedContext: [
            {
              source: "story/pending_hooks.md#mentor-oath",
              reason: "Carry the unresolved oath line.",
              excerpt: "relationship | open | old oath debt",
            },
          ],
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: {
            hard: ["current_state"],
            soft: ["current_focus"],
            diagnostic: ["continuity_audit"],
          },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      const systemPrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[0]?.content ?? "";
      const creativePrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";

      expect(systemPrompt).not.toContain("Hook-A / Hook-B");
      expect(systemPrompt).toContain("真实 hook_id");
      expect(creativePrompt).toContain("## Explicit Hook Agenda");
      expect(creativePrompt).toContain("mentor-oath");
      expect(creativePrompt).toContain("ledger-fragment");
      expect(creativePrompt).toContain("stale-ledger");
      expect(creativePrompt).toContain("relationship");
    } finally {
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("syncs foreshadow_registry.json from pending_hooks.md when saving a chapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-registry-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    try {
      await agent.saveChapter(bookDir, {
        chapterNumber: 1,
        title: "活埋与觉醒",
        content: "正文",
        wordCount: 2,
        preWriteCheck: "",
        postSettlement: "",
        updatedState: "# 当前状态\n",
        updatedLedger: "# 资源账本\n",
        updatedHooks: [
          "# 伏笔池",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| buried-bloodline | 1 | 身世 | open | 1 | 第一次觉醒真相 | 中程 | 活埋异象暴露血脉线索 |",
        ].join("\n"),
        chapterSummary: "",
        updatedSubplots: "",
        updatedEmotionalArcs: "",
        updatedCharacterMatrix: "",
        postWriteErrors: [],
        postWriteWarnings: [],
      }, true, "zh");

      const raw = await readFile(join(storyDir, "foreshadow_registry.json"), "utf-8");
      const registry = JSON.parse(raw) as Array<{ hookId: string; type: string; lastAdvancedChapter: number }>;
      expect(registry).toEqual([
        expect.objectContaining({
          hookId: "buried-bloodline",
          type: "身世",
          lastAdvancedChapter: 1,
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds chapter-goal discipline warnings without blocking the write flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-discipline-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- 黑色古碑会吞噬煞气。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 2\n先逃出追兵视野。\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- 秦枭仍在逃亡。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- 黑色古碑的代价尚未揭开。\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "逃出生天",
          "",
          "=== CHAPTER_CONTENT ===",
          "秦枭一路冲出矿道，暂时甩开了追兵，却还没摸清黑色古碑的代价。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "逃出生天",
          "",
          "=== CHAPTER_CONTENT ===",
          "秦枭暂时躲开了追兵，但结尾仍只有杀机压近，没有揭示古碑代价。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "逃出生天",
          "",
          "=== CHAPTER_CONTENT ===",
          "秦枭暂时躲开了追兵，危机依旧逼近，黑色古碑代价仍没有被揭开。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "逃出生天",
          "",
          "=== CHAPTER_CONTENT ===",
          "秦枭硬闯矿道，仍只看到追兵逼近，黑色古碑代价没有兑现。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "逃出生天",
          "",
          "=== CHAPTER_CONTENT ===",
          "秦枭勉强脱身，古碑代价依旧未揭开，章尾只剩追兵压上来的危机。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- 黑色古碑代价仍未揭开",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 2 | 逃出生天 | 秦枭 | 甩开追兵 | 仍在逃亡 | 古碑代价未解 | 紧张 | 逃亡 |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 3 | 火堆旁的腰牌 | 楚夜 | 拿到腰牌并收束 | 缓和 | none | 平静 | calm |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 2,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- endingType: reveal_end",
          "",
          "## Chapter Goal",
          "- mainConflict: 秦枭还没真正脱离追杀。",
          "- protagonistGoal: 先摆脱追兵，再弄清黑色古碑的代价。",
          "- activeCharacters: 秦枭, 碑灵",
          "- foreshadowToTouch: black-stele",
          "- payoffToDeliver: 揭开黑色古碑的代价",
          "- endingHookType: reveal",
          "- nextChapterPull: 代价真相会把局势再往前推一步。",
        ].join("\n"),
        contextPackage: {
          chapter: 2,
          selectedContext: [],
          chapterGoal: {
            mainConflict: "秦枭还没真正脱离追杀。",
            protagonistGoal: "先摆脱追兵，再弄清黑色古碑的代价。",
            activeCharacters: ["秦枭", "碑灵"],
            foreshadowToTouch: ["black-stele"],
            payoffToDeliver: "揭开黑色古碑的代价",
            endingHookType: "reveal",
            nextChapterPull: "代价真相会把局势再往前推一步。",
          },
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: { hard: [], soft: [], diagnostic: [] },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(220, "zh"),
      });
      const creativePrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";

      expect(output.payoffCheck).toEqual(expect.objectContaining({
        expectedPayoff: "揭开黑色古碑的代价",
        matched: false,
      }));
      expect(creativePrompt).toContain("EndingType: reveal_end");
      expect(creativePrompt).toContain("The promised payoff MUST happen in this chapter at least partially.");
      expect(creativePrompt).not.toContain("endingHookType:");
      expect(output.postWriteErrors.some((warning) => warning.rule === "payoff-missing")).toBe(true);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "ending-hook-check")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("forces ending-type rewrite when EndingType is reveal_end but the draft ending has no reveal", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-ending-type-rewrite-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 2\n推进古卷线。\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜正在追查古卷。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "暗河余烬",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜摸黑穿过裂缝。章尾只有杀机逼近，没有人说破古卷来历。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "暗河余烬",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜摸黑穿过裂缝。章尾时碑灵终于揭开古卷来源真相：它出自葬渊祭司一脉。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "暗河余烬",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜摸黑穿过裂缝。章尾时碑灵再次揭开真相：古卷出自葬渊祭司一脉。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "暗河余烬",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜摸黑穿过裂缝。章尾时碑灵再次揭开真相：古卷出自葬渊祭司一脉。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "暗河余烬",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜摸黑穿过裂缝。章尾时碑灵再次揭开真相：古卷出自葬渊祭司一脉。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- reveal still present after final guard",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 2 | 暗河余烬 | 楚夜 | 古卷来源被揭示 | 线索推进 | none | 紧张 | reveal |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));
    const settleSpy = vi.spyOn(WriterAgent.prototype as never, "settle" as never)
      .mockResolvedValue({
        settlement: {
          postSettlement: ["settled"],
          updatedState: "# 当前状态\n",
          updatedHooks: "# 伏笔池\n",
          updatedLedger: "",
          chapterSummary: "| 2 | 暗河余烬 | 楚夜 | 古卷来源被揭示 | 线索推进 | none | 紧张 | reveal |",
          updatedSubplots: "# 支线进度板\n",
          updatedEmotionalArcs: "# 情感弧线\n",
          updatedCharacterMatrix: "# 角色交互矩阵\n",
        },
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 2,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- endingType: reveal_end",
          "",
          "## Chapter Goal",
          "- mainConflict: 古卷来源悬而未决。",
          "- protagonistGoal: 逼出古卷来源。",
          "- activeCharacters: 楚夜, 碑灵",
          "- foreshadowToTouch: ancient-scroll",
          "- payoffToDeliver: 揭开古卷来源",
          "- nextChapterPull: 祭司一脉会被牵出来。",
        ].join("\n"),
        contextPackage: {
          chapter: 2,
          selectedContext: [],
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: { hard: [], soft: [], diagnostic: [] },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
      const rewriteSystemPrompt = (chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)?.[0]?.content ?? "";
      expect(
        rewriteSystemPrompt.includes("PAYOFF REALIZATION MODE")
        || rewriteSystemPrompt.includes("ENDING TYPE ENFORCEMENT MODE"),
      ).toBe(true);
      expect(output.content).toContain("古卷出自葬渊祭司一脉");
    } finally {
      settleSpy.mockRestore();
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps payoff mandatory in prompt even when endingType is calm_end", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-calm-payoff-priority-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 3\n低强度收束并兑现当章收益。\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜需要拿到黑市通行腰牌。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆旁的腰牌",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜在火堆旁慢慢调匀呼吸，以随身玉佩换到了黑市通行腰牌。夜色沉下来后，他与同伴低声确认了明日路线，局势暂时安稳。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆旁的腰牌",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜在火堆旁慢慢调匀呼吸，以随身玉佩换到了黑市通行腰牌。夜色沉下来后，他与同伴低声确认了明日路线，局势暂时安稳。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 3 | 火堆旁的腰牌 | 楚夜 | 拿到腰牌并收束 | 缓和 | none | 平静 | calm |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));
    const settleSpy = vi.spyOn(WriterAgent.prototype as never, "settle" as never)
      .mockResolvedValue({
        settlement: {
          postSettlement: ["settled"],
          updatedState: "# 当前状态\n",
          updatedHooks: "# 伏笔池\n",
          updatedLedger: "",
          chapterSummary: "| 3 | 火堆旁的腰牌 | 楚夜 | 拿到腰牌并收束 | 缓和 | none | 平静 | calm |",
          updatedSubplots: "# 支线进度板\n",
          updatedEmotionalArcs: "# 情感弧线\n",
          updatedCharacterMatrix: "# 角色交互矩阵\n",
        },
        usage: ZERO_USAGE,
      });
    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 3,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- endingType: calm_end",
          "",
          "## Chapter Goal",
          "- mainConflict: 楚夜必须拿到黑市腰牌。",
          "- protagonistGoal: 在不激化冲突的前提下拿到腰牌。",
          "- activeCharacters: 楚夜",
          "- foreshadowToTouch: black-market-pass",
          "- payoffToDeliver: 拿到黑市通行腰牌",
          "- nextChapterPull: 有了腰牌才能继续潜入。",
        ].join("\n"),
        contextPackage: {
          chapter: 3,
          selectedContext: [],
          chapterGoal: {
            mainConflict: "楚夜必须拿到黑市腰牌。",
            protagonistGoal: "在不激化冲突的前提下拿到腰牌。",
            activeCharacters: ["楚夜"],
            foreshadowToTouch: ["black-market-pass"],
            payoffToDeliver: "拿到黑市通行腰牌",
            endingHookType: "choice",
            nextChapterPull: "有了腰牌才能继续潜入。",
          },
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: { hard: [], soft: [], diagnostic: [] },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      const creativePrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
      expect(creativePrompt).toContain("payoff 优先级高于 EndingType");
      expect(creativePrompt).toContain("EndingType 只控制收束方式，不得阻止 payoff 发生与局势变化。");
      expect(creativePrompt).toContain("The promised payoff MUST happen in this chapter at least partially.");
    } finally {
      settleSpy.mockRestore();
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps payoff mandatory in prompt even when endingType is unresolved_end", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-unresolved-payoff-priority-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 6\n完成觉醒，但引出更大的威胁。\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜即将觉醒。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "焚骨初醒",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜喉间泛起血腥味，硬扛骨火反噬，经脉像被火刃刮过一般刺痛。就在这一刻，他终于完成第一次觉醒，可抬头时却看见更深处的黑影已经盯上了他，新的问题随之压了下来。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "焚骨初醒",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜喉间泛起血腥味，硬扛骨火反噬，经脉像被火刃刮过一般刺痛。就在这一刻，他终于完成第一次觉醒，骨火顺着脊背缓缓退潮。可当他抬头时，却看见更深处的黑影已经盯上了他，新的问题随之压了下来。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewritten",
        ].join("\n"),
        usage: ZERO_USAGE,
      });
    const settleSpy = vi.spyOn(WriterAgent.prototype as never, "settle" as never)
      .mockResolvedValue({
        settlement: {
          postSettlement: ["settled"],
          updatedState: "# 当前状态\n",
          updatedHooks: "# 伏笔池\n",
          updatedLedger: "",
          chapterSummary: "| 6 | 焚骨初醒 | 楚夜 | 完成觉醒并引出黑影威胁 | 紧张 | none | tense | reveal |",
          updatedSubplots: "# 支线进度板\n",
          updatedEmotionalArcs: "# 情感弧线\n",
          updatedCharacterMatrix: "# 角色交互矩阵\n",
        },
        usage: ZERO_USAGE,
      });
    const payoffRewriteSpy = vi
      .spyOn(WriterAgent.prototype as never, "rewriteForPayoffDirectiveIfNeeded" as never)
      .mockImplementation(async (...args: unknown[]) => {
        const [params] = args as [{
          creative: {
            title: string;
            content: string;
            wordCount: number;
            preWriteCheck: string;
          };
        }];
        return params.creative;
      });
    const endingRewriteSpy = vi
      .spyOn(WriterAgent.prototype as never, "rewriteForEndingTypeIfNeeded" as never)
      .mockImplementation(async (...args: unknown[]) => {
        const [params] = args as [{
          creative: {
            title: string;
            content: string;
            wordCount: number;
            preWriteCheck: string;
          };
        }];
        return params.creative;
      });

    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 6,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- endingType: unresolved_end",
          "",
          "## Chapter Goal",
          "- mainConflict: 楚夜必须撑过骨火觉醒。",
          "- protagonistGoal: 完成第一次觉醒。",
          "- activeCharacters: 楚夜",
          "- foreshadowToTouch: awakening-shadow",
          "- payoffToDeliver: 完成第一次觉醒",
          "- nextChapterPull: 觉醒后出现的新威胁会逼近。",
        ].join("\n"),
        contextPackage: {
          chapter: 6,
          selectedContext: [],
          chapterGoal: {
            mainConflict: "楚夜必须撑过骨火觉醒。",
            protagonistGoal: "完成第一次觉醒。",
            activeCharacters: ["楚夜"],
            foreshadowToTouch: ["awakening-shadow"],
            payoffToDeliver: "完成第一次觉醒",
            endingHookType: "danger",
            nextChapterPull: "觉醒后出现的新威胁会逼近。",
          },
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: { hard: [], soft: [], diagnostic: [] },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      const creativePrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
      expect(creativePrompt).toContain("payoff 优先级高于 EndingType");
      expect(creativePrompt).toContain("EndingType 只控制收束方式，不得阻止 payoff 发生与局势变化。");
      expect(creativePrompt).toContain("You MUST complete the payoff, then leave the situation unresolved by introducing a new threat or question.");
    } finally {
      endingRewriteSpy.mockRestore();
      payoffRewriteSpy.mockRestore();
      settleSpy.mockRestore();
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds resource ledger discipline warnings when正文资源变化没有同步到账本或状态", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-resource-ledger-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- 煞气会反噬经脉。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 2\n先逃出矿道。\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 秦枭仍在逃亡。\n", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "# 资源账本\n\n- 煞气：十缕\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "血路",
          "",
          "=== CHAPTER_CONTENT ===",
          "秦枭强行催动煞气，一口气吞下十五缕煞气，气血骤降，反噬震得经脉刺痛。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "- 秦枭仍在逃亡。",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 2 | 血路 | 秦枭 | 强催煞气逃亡 | 仍在逃亡 | none | 紧张 | 逃亡 |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | 先休整后推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 2,
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(output.resourceLedgerCheck).toBeDefined();
      expect(output.resourceLedgerCheck?.matched).toBe(true);
      expect(output.resourceLedgerCheck?.warnings).toEqual([]);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "resource-ledger-missing-consumption")).toBe(false);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "resource-ledger-missing-injury-update")).toBe(false);
      expect(output.postWriteErrors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds hook debt throttle warnings when high debt chapters still open multiple new hooks without advancing old debt", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-hook-debt-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const stateDir = join(storyDir, "state");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(stateDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    const pendingHookRows = Array.from({ length: 13 }, (_, index) =>
      `| old-debt-${index + 1} | ${index + 1} | mystery | open | ${Math.max(1, 8 - index)} | Old payoff ${index + 1} | Dormant unresolved line ${index + 1} |`,
    );
    const runtimeHooks = Array.from({ length: 13 }, (_, index) => ({
      hookId: `old-debt-${index + 1}`,
      startChapter: index + 1,
      type: "mystery",
      status: "open",
      lastAdvancedChapter: Math.max(1, 8 - index),
      expectedPayoff: `Old payoff ${index + 1}`,
      notes: `Dormant unresolved line ${index + 1}.`,
    }));

    await Promise.all([
      writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          { number: 1, title: "Ch1", status: "approved" },
          { number: 2, title: "Ch2", status: "approved" },
        ]),
        "utf-8",
      ),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- Old debts are piling up.\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 3\nDo not spray new hook debt.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- Keep the prose restrained.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue is already carrying too many open debts.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), [
        "# Pending Hooks",
        "",
        "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...pendingHookRows,
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 2,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 2,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: runtimeHooks,
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [
          {
            chapter: 2,
            title: "Debt Heat",
            characters: "Lin Yue",
            events: "Old debts remained unresolved.",
            stateChanges: "Pressure rose.",
            hookActivity: "opened new route hook",
            mood: "tight",
            chapterType: "mainline",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "Parallel Pits",
          "",
          "=== CHAPTER_CONTENT ===",
          "Lin Yue glimpsed two fresh mysteries but did not settle any of the old debts.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- opened more debt without advancing the old lines",
          "",
          "=== RUNTIME_STATE_DELTA ===",
          "```json",
          JSON.stringify({
            chapter: 3,
            hookOps: {
              upsert: [
                {
                  hookId: "new-pit-1",
                  startChapter: 3,
                  type: "mystery",
                  status: "open",
                  lastAdvancedChapter: 3,
                  expectedPayoff: "New pit payoff 1",
                  notes: "A fresh parallel debt line.",
                },
                {
                  hookId: "new-pit-2",
                  startChapter: 3,
                  type: "route",
                  status: "open",
                  lastAdvancedChapter: 3,
                  expectedPayoff: "New pit payoff 2",
                  notes: "Another fresh parallel debt line.",
                },
              ],
              mention: [],
              resolve: [],
              defer: [],
            },
            chapterSummary: {
              chapter: 3,
              title: "Parallel Pits",
              characters: "Lin Yue",
              events: "Lin Yue brushes against two new mysteries.",
              stateChanges: "Old debt remains untouched.",
              hookActivity: "opened two new hooks",
              mood: "tight",
              chapterType: "mainline",
            },
            notes: [],
          }, null, 2),
          "```",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 3,
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      expect(output.hookDebtCheck).toBeDefined();
      expect(output.hookDebtCheck?.matched).toBe(false);
      expect(output.hookDebtCheck).toEqual(expect.objectContaining({
        activeCount: 14,
        cap: 12,
        newHooksOpened: 1,
        oldHooksAdvanced: 0,
      }));
      expect(output.hookDebtCheck?.warnings).toEqual(expect.arrayContaining([
        "hook-debt-over-cap",
        "hook-debt-no-old-hook-advance",
        "hook-debt-throttle-violation",
      ]));
      expect(output.postWriteWarnings.some((warning) => warning.rule === "hook-debt-over-cap")).toBe(true);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "hook-debt-no-old-hook-advance")).toBe(true);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "hook-debt-throttle-violation")).toBe(true);
      expect(output.postWriteErrors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("injects structured title candidates into governed prompts and replaces weak one-word titles", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-title-engine-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(storyDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_腐骨夜雨.md"), "# 第1章 腐骨夜雨\n\n前文一。\n", "utf-8"),
      writeFile(join(chaptersDir, "0002_裂谷回声.md"), "# 第2章 裂谷回声\n\n前文二。\n", "utf-8"),
      writeFile(join(chaptersDir, "0003_黑市门前.md"), "# 第3章 黑市门前\n\n前文三。\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- 暗河尽头藏着血色果实。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\n楚夜在暗河尽头拿到血色果实。\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n\n- 保持强钩子章节标题。\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜已逼近暗河尽头。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n\n- 果实代价尚未揭开。\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "水流",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜冲到暗河尽头，拿到了血色果实。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 4 | 暗河尽头的血色果实 | 楚夜 | 拿到果实 | 压力升级 | 果实代价未解 | 紧张 | mainline |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | Scene3推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 4,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Chapter Goal",
          "- mainConflict: 追兵已经摸到暗河尽头。",
          "- protagonistGoal: 冲出暗河尽头，拿到血色果实。",
          "- activeCharacters: 楚夜",
          "- foreshadowToTouch: blood-fruit",
          "- payoffToDeliver: 拿到血色果实",
          "- endingHookType: reveal",
          "- nextChapterPull: 吞下果实后，寿元开始燃烧。",
        ].join("\n"),
        contextPackage: {
          chapter: 4,
          selectedContext: [
            {
              source: "story/chapter_summaries.md#recent_titles",
              reason: "Avoid repeating the recent shell.",
              excerpt: "1: 腐骨夜雨 | 2: 裂谷回声 | 3: 黑市门前",
            },
            {
              source: "story/volume_outline.md#4",
              reason: "Anchor the chapter payoff.",
              excerpt: "暗河尽头藏着血色果实，楚夜必须先拿到它。",
            },
          ],
          chapterGoal: {
            mainConflict: "追兵已经摸到暗河尽头。",
            protagonistGoal: "冲出暗河尽头，拿到血色果实。",
            activeCharacters: ["楚夜"],
            foreshadowToTouch: ["blood-fruit"],
            payoffToDeliver: "拿到血色果实",
            endingHookType: "reveal",
            nextChapterPull: "吞下果实后，寿元开始燃烧。",
          },
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: { hard: [], soft: [], diagnostic: [] },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      const creativePrompt = (chatSpy.mock.calls[0]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
      expect(creativePrompt).toContain("## 标题候选");
      expect(creativePrompt).toContain("暗河尽头的血色果实");
      expect(["暗河尽头的血色果实", "暗河尽头前的死局"]).toContain(output.title);
      expect(output.title).not.toBe("水流");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits cadence-directive-violation when force escalation is present but the draft stays breathing", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-cadence-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 10\nForce the archive pressure to break open.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Taryn is still near the archive gate.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "Warm Ash",
          "",
          "=== CHAPTER_CONTENT ===",
          "Taryn sat by the stove, shared broth with the crew, and quietly bandaged a scrape while the night softened.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# Current State",
          "",
          "=== UPDATED_HOOKS ===",
          "# Pending Hooks",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 10 | Warm Ash | Taryn | Rests with the crew | Breathes | none | warm | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      });
    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 10,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- scene: Force tension escalation this chapter. Do not produce a third consecutive breathing chapter. Force chapter type: escalation / confrontation / discovery-under-threat.",
        ].join("\n"),
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      expect(output.postWriteWarnings.some((warning) => warning.rule === "cadence-directive-violation")).toBe(true);
      expect(output.postWriteErrors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still emits cadence-directive-violation when a breathing draft only sprinkles danger keywords", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-cadence-danger-sprinkle-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 10\nForce the archive pressure to break open.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Taryn is still near the archive gate.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "Low Fire",
          "",
          "=== CHAPTER_CONTENT ===",
          "Taryn sat by the stove, shared broth with the crew, and quietly bandaged a scrape. Someone mentioned the threat outside, but no one moved, and the night softened while they caught a breath.",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# Current State",
          "",
          "=== UPDATED_HOOKS ===",
          "# Pending Hooks",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 10 | Low Fire | Taryn | Shares broth and rests | Breathes | none | warm | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 10,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- scene: Force tension escalation this chapter. Do not produce a third consecutive breathing chapter. Force chapter type: escalation / confrontation / discovery-under-threat.",
        ].join("\n"),
        lengthSpec: buildLengthSpec(2200, "en"),
      });

      expect(output.postWriteWarnings.some((warning) => warning.rule === "cadence-directive-violation")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still emits cadence-directive-violation for a Chinese breathing shell with a few danger keywords", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-cadence-zh-shell-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 15\nForce the ruin pressure to break open.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 众人刚进入遗迹外圈。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "暂栖火边",
          "",
          "=== CHAPTER_CONTENT ===",
          "众人暂时安全，先在石壁旁包扎伤口，分配药材，讨论计划，又交换情报，慢慢推进到下一处岔路。有人提到外面仍有追兵和杀机逼近，可谁也没有立刻动身，气氛反而平静下来，信任也在合作里慢慢加深。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 15 | 暂栖火边 | 楚夜,陆焚 | 包扎休整并交换情报 | 暂时安全 | none | 平静 | 日常/喘息、温情 |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 15,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- scene: Force tension escalation this chapter. Do not produce a third consecutive breathing chapter. Force chapter type: escalation / confrontation / discovery-under-threat.",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(output.postWriteWarnings.some((warning) => warning.rule === "cadence-directive-violation")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits ending-isomorphism when the chapter closes with the same templated shell as the recent endings", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-ending-iso-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(storyDir, { recursive: true });
    await mkdir(chaptersDir, { recursive: true });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_旧影.md"), "火光熄下去。随着他们的身影消失在黑暗中，众人都意识到这不过只是冰山一角，真正的秘密还在前方，等待着他们去揭开。", "utf-8"),
      writeFile(join(chaptersDir, "0002_暗缝.md"), "风声贴着石壁掠过。随着他们的身影消失在黑暗中，他们知道更大的秘密还在前方，等待着他们去揭开。", "utf-8"),
      writeFile(join(chaptersDir, "0003_潜流.md"), "队伍越走越深。随着他们的身影消失在黑暗中，他们终于明白今日所见也只是冰山一角。", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 4\nPush deeper into the cavern.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚带人踏入暗河深处。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "暗河深处",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜收起火折子，带着众人没入更深的甬道。\n\n随着他们的身影消失在黑暗中，他知道眼前的一切也许仍只是冰山一角，更大的秘密还在前方，等待着他们去揭开。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 4 | 暗河深处 | 楚夜 | 深入甬道 | 发现更大秘密 | none | 紧绷 | discovery |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 4,
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(output.postWriteWarnings.some((warning) => warning.rule === "ending-isomorphism")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rewrites once when a breath directive is present but the first draft stays combat-heavy", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-mood-downshift-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nDownshift after the bloodbath.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: "[Scene1]\n楚夜先在碎石背后扎营疗伤，替云岚包扎伤口，又分了干粮和热汤，先把身体余波压住。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "碑下血战",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜提刀正面撞进敌阵，刀光爆开，追兵又一次围杀上来。两人当场交锋，轰击和血战几乎贯穿整章，没有片刻休整。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先在碎石背后扎营疗伤，替云岚包扎伤口，又分了干粮和热汤，先把血战余波压住。",
          "",
          "[Scene2]\n两人借着路途交谈重新梳理黑袍人的去向，几句调侃之后，原本绷紧的气氛终于缓下来，关系也更稳了一层。",
          "",
          "[Scene3]\n休整完毕，他们才继续提防追兵，往更深处摸去，以低强度推进接住下一步风险。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- revised after local mood self-check",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先在碎石背后扎营疗伤，替云岚包扎伤口，又分了干粮和热汤，先把血战余波压住。",
          "",
          "[Scene2]\n两人借着路途交谈重新梳理黑袍人的去向，几句调侃之后，原本绷紧的气氛终于缓下来，关系也更稳了一层。",
          "",
          "[Scene3]\n休整完毕，他们才继续提防追兵，往更深处摸去，以低强度推进接住下一步风险。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- revised after local mood semantic check",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先在碎石背后扎营疗伤，替云岚包扎伤口，又分了干粮和热汤，先把血战余波压住。",
          "",
          "[Scene2]\n两人借着路途交谈重新梳理黑袍人的去向，几句调侃之后，原本绷紧的气氛终于缓下来，关系也更稳了一层。",
          "",
          "[Scene3]\n休整完毕，他们才继续提防追兵，往更深处摸去，以低强度推进接住下一步风险。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- revised after semantic stabilization",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 碑下血战 | 楚夜 | 血战继续 | 焦灼 | none | 冷硬 | confrontation |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火堆后的短歇 | 楚夜 | 休整后前推 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
          "  - scenePlan:",
          "    - scene1: settle / regroup",
          "    - scene2: relationship / recovery / practical talk",
          "    - scene3: low-intensity forward move",
          "  - note: 最近连续数章都在高压对抗，本章必须降调——至少安排 1 段日常/喘息/温情/幽默场景。",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("THIS CHAPTER IS A BREATH CHAPTER.");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("首段硬约束：必须以恢复/环境/对话开场。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("firstPassModeLock: true");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("forbidCrisisFallback: true");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("mood directive > scene plan > payoff > hook");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("The first 30% of the chapter MUST be a pure recovery/character scene");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Breath 章骨架：Act1=余波/ regroup，Act2=完整喘息场景，Act3=小步前推 + 低强度尾钩。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("scenePlan:");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("scene1: settle / regroup");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("本章前 60% 不得以战斗为主导");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Do NOT introduce new threats or escalate conflict");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("正文前 30% / [Scene1] 禁止出现威胁、规则压力、追杀压力、风暴信号或冲突升级");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Focus on interaction, not action");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Only here you may move plot forward");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("CHAPTER_CONTENT 必须按三段 Scene 输出");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("[Scene1]");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("writingMode: breath");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("使用慢节奏句式");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("触觉/身体感受");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("禁止持续压迫语气");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("锁定开头 Scene1");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("LOCKED_SCENE1");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("REWRITE MODE");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("FRESH GENERATION MODE");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("WRITING_MODE=breath");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("PRIMARY STRUCTURAL REQUIREMENT");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("整章重生规则");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("首段禁止：直接冲突触发、立即危机、敌人行动。");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("目标 coverage>=30%");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("强制三段结构重建");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("本轮强制写作模式：WRITING_MODE=breath");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("连续多行堆叠危机词");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("必须替换部分主导性的战斗推进");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("重排要求：前 60% 必须先完成喘息/恢复/对话");
      expect(output.moodCadenceCheck).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps rewriting until breath coverage crosses the target instead of stopping at a near-miss", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-mood-rewrite-loop-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nDownshift after the bloodbath.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const { logger, warnings } = createCaptureLogger();
    const agent = new WriterAgent({
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
      projectRoot: root,
      logger,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: "[Scene1]\n楚夜先在碎石背后扎营疗伤，替云岚包扎伤口，又分了干粮和热汤，先把余波压住。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "碑下血战",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜提刀正面撞进敌阵，刀光爆开，追兵围杀上来。两人当场交锋，轰击和血战贯穿整章，只有极短的一瞬停顿。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "碑下鏖战",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜继续和黑袍人交锋，刀光、杀机、围杀和轰击一波接一波压上来，甬道里没有真正的喘息余地。只有一句带过的包扎和一句催促继续赶路，马上又重新跌回血战与封锁。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite 1 still near zero",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "乱石后的喘息",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜先在碎石背后简单包扎，和云岚低声交换了两句情报，分了几口干粮，气氛略微缓下来。\n\n但他们很快又被追兵逼得提刀迎上，甬道里再次被轰击、杀机和围杀塞满。后半章依旧以高压追逐和交锋推进，没有真正把篇幅让给休整与关系推进。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite 2 reaches 24% but still under target",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火光后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "楚夜先在碎石背后扎营疗伤，替云岚包扎伤口，又分了干粮和热汤，先把余波压住。",
          "",
          "[Scene2]",
          "两人借着路途交谈重新梳理黑袍人的去向，顺手把药材、符纸和接下来的路线整理了一遍，关系也稳下来。",
          "",
          "[Scene3]",
          "完成休整后他们才继续提防追兵，往更深处摸去。前方仍有威胁，但主段已经从纯战斗切到低强度前推。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite 3 finally crosses 30%",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火光后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "楚夜先在碎石背后扎营疗伤，替云岚包扎伤口，又分了干粮和热汤，先把余波压住。",
          "",
          "[Scene2]",
          "两人借着路途交谈重新梳理黑袍人的去向，顺手把药材、符纸和接下来的路线整理了一遍，关系也稳下来。",
          "",
          "[Scene3]",
          "完成休整后他们才继续提防追兵，往更深处摸去。前方仍有威胁，但主段已经从纯战斗切到低强度前推。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite 4 still valid after final guard",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火光后的短歇 | 楚夜,云岚 | 疗伤休整后继续深入 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
          "  - note: 最近连续数章都在高压对抗，本章必须降调。",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ role: string; content: string }>)[0]?.content ?? "").toContain("锁定开头 Scene1");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ role: string; content: string }>)[1]?.content ?? "").toContain("LOCKED_SCENE1");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ role: string; content: string }>)[0]?.content ?? "").toContain("REWRITE MODE");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ role: string; content: string }>)[1]?.content ?? "").toContain("当前 coverage=");
      expect((chatSpy.mock.calls[3]?.[0] as Array<{ role: string; content: string }>)[1]?.content ?? "").toContain("rewrite attempt 2");
      expect((chatSpy.mock.calls[3]?.[0] as Array<{ role: string; content: string }>)[1]?.content ?? "").toContain("目标 coverage>=30%");
      expect((chatSpy.mock.calls[4]?.[0] as Array<{ role: string; content: string }>)[1]?.content ?? "").toContain("rewrite attempt 3");
      expect((chatSpy.mock.calls[4]?.[0] as Array<{ role: string; content: string }>)[1]?.content ?? "").toContain("如果只是追加一小段喘息而主体仍是 combat-heavy，这次 rewrite 仍算失败。");
      expect((chatSpy.mock.calls[4]?.[0] as Array<{ role: string; content: string }>)[1]?.content ?? "").toContain("强制三段结构重建");
      expect(warnings.some((message) => message.includes("rewrite attempt 1"))).toBe(true);
      expect(warnings.some((message) => message.includes("rewrite attempt 2"))).toBe(true);
      expect(warnings.some((message) => message.includes("rewrite attempt 3"))).toBe(true);
      expect(output.content).toContain("扎营疗伤");
      expect(output.content).toContain("整理了一遍");
      expect(output.content).toContain("[Scene1]");
      expect(output.content).toContain("[Scene2]");
      expect(output.content).toContain("[Scene3]");
      expect(output.moodCadenceCheck?.matched).toBe(true);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "mood-cadence-violation")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes mood cadence when the draft includes a breathing beat and relationship progression", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-mood-pass-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nDownshift after the bloodbath.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: "[Scene1]\n楚夜和云岚在乱石后扎营疗伤，先包扎伤口，又分了干粮和热汤。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "楚夜和云岚在乱石后扎营疗伤，先包扎伤口，又分了干粮和热汤。",
          "",
          "[Scene2]",
          "两人借着路途交谈把前路重新捋顺，几句调侃之后，原先绷紧的信任也松开了一点。",
          "",
          "[Scene3]",
          "确认补给后，他们低强度前推到下一个岔口，留下一个轻量钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "楚夜和云岚在乱石后扎营疗伤。",
          "",
          "火堆压得很小，热汤分成两碗，干粮也慢慢掰开。",
          "",
          "云岚递来水时顺口调侃了一句，他接住后笑了笑，呼吸终于稳下来。",
          "",
          "[Scene2]",
          "两人整理药材，低声讨论路线。云岚把药瓶推到他手边，他点了点头，把剩下的干粮分成两份。她又问起伤口的疼法，他照实说了几句，两人的语气都慢下来。热汤还温着，云岚顺口开了个玩笑，楚夜也终于笑了一下。",
          "",
          "[Scene3]",
          "他们又休息了一会儿，确认伤口不再渗血，才低强度前推到岔口，只确认下一段路线，没有立刻触发新的冲突。他们把石壁上的旧刻痕记下来，决定等休息够了再继续往前。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- mood rewrite after fallback",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "两人整理药材，低声讨论路线。云岚把药瓶推到他手边，他点了点头，把剩下的干粮分成两份。她又问起伤口的疼法，他照实说了几句，两人的语气都慢下来。",
          "",
          "[Scene3]",
          "他们低强度前推到岔口，只确认下一段路线，没有立刻触发新的冲突。他们把石壁上的旧刻痕记下来，决定等休息够了再继续往前。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- mood rewrite after fallback",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "两人整理药材，低声讨论路线。云岚把药瓶推到他手边，他点了点头，把剩下的干粮分成两份。她又问起伤口的疼法，他照实说了几句，两人的语气都慢下来。",
          "",
          "[Scene3]",
          "他们低强度前推到岔口，只确认下一段路线，没有立刻触发新的冲突。他们把石壁上的旧刻痕记下来，决定等休息够了再继续往前。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- mood rewrite after fallback second pass",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火堆边的短歇 | 楚夜,云岚 | 扎营疗伤并推进关系 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
          "  - note: 最近连续数章都在高压对抗，本章必须降调——至少安排 1 段日常/喘息/温情/幽默场景。",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(output.postWriteWarnings.some((warning) => warning.rule === "mood-cadence-violation")).toBe(false);
      expect(output.moodCadenceCheck?.matched).toBe(true);
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("锁定开头 Scene1");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("THIS CHAPTER IS A BREATH CHAPTER.");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("首段硬约束：必须以恢复/环境/对话开场。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("LOCKED_SCENE1");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("writingMode: breath");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("环境锚定");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("人物互动细节");
      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rewrites Phase1 before Phase2 when Scene1 contains implicit pressure semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-phase1-purity-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nDownshift after the bloodbath.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: "[Scene1]\n楚夜坐在火堆边包扎伤口，洞口却透着不安，像有什么异常正在靠近。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "[Scene1]\n楚夜坐在火堆边包扎伤口，掌心的疼痛慢慢退下去。云岚递来热水，两人低声说了几句，火光只照着静止的石壁。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "楚夜坐在火堆边包扎伤口，掌心的疼痛慢慢退下去。云岚递来热水，两人低声说了几句，火光只照着静止的石壁。",
          "",
          "[Scene2]",
          "两人交换路线情报，整理药材，关系在对话里稳下来。",
          "",
          "[Scene3]",
          "他们低强度前推到岔口，留下轻量钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "两人把药草一株株分开，云岚低声问他还能不能走。楚夜点头，把裂开的布条重新压紧。火光落在水面上，声音很轻。",
          "",
          "[Scene3]",
          "休整之后，他们沿着缓坡继续前行，只在岔口停下，记住石壁上一道浅浅的刻痕。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把剩下的布条摊在膝上，替他重新包扎。楚夜没有逞强，只把水囊递回去，问她下一段路要不要换他探路。",
          "",
          "[Scene3]",
          "等火堆熄成暗红，他们才收起东西，沿着没有水声的一侧慢慢走下去。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "他们把能用的药粉重新分成两包。云岚说话很慢，楚夜也没有急着回答，只把掌心的血迹擦干净。",
          "",
          "[Scene3]",
          "片刻后，两人顺着石壁继续移动，先记路线，再决定下一处落脚点。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把火拨小，声音也压低。她问他疼不疼，楚夜停了一下，只说还能忍。两人把剩下的水分好。",
          "",
          "[Scene3]",
          "火星灭下去后，他们才离开原地，沿着更平缓的石阶往下探了一小段。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把药草分开放好，低声问他伤口还疼不疼。楚夜点头，把水囊递回去，两人把下一段路慢慢说清楚。",
          "",
          "[Scene3]",
          "休整之后，他们沿着缓坡前行，只在岔口停下，记住石壁上一道浅浅的刻痕。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "他们把能用的药粉重新分成两包。云岚说话很慢，楚夜也没有急着回答，只把掌心的血迹擦干净。",
          "",
          "[Scene3]",
          "片刻后，两人顺着石壁继续移动，先记路线，再决定下一处落脚点。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把火拨小，声音也压低。她问他疼不疼，楚夜停了一下，只说还能忍。两人把剩下的水分好。",
          "",
          "[Scene3]",
          "火星灭下去后，他们才离开原地，沿着更平缓的石阶往下探了一小段。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把火拨小，声音也压低。她问他疼不疼，楚夜停了一下，只说还能忍。两人把剩下的水分好。",
          "",
          "[Scene3]",
          "火星灭下去后，他们才离开原地，沿着更平缓的石阶往下探了一小段。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火堆边的短歇 | 楚夜,云岚 | 扎营疗伤并推进关系 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Scene1 must feel safe, slow, and temporarily stable");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("不安");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("上一次 Scene1 未通过 Phase1 语义纯净自检");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("LOCKED_SCENE1");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("火光只照着静止的石壁");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").not.toContain("像有什么异常正在靠近");
      expect(output.content).toContain("火光只照着静止的石壁");
      expect(output.content).not.toContain("像有什么异常正在靠近");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to a safe template when Phase1 keeps producing implicit pressure semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-phase1-fallback-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nDownshift after the bloodbath.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: "[Scene1]\n火堆旁很安静，像是有什么异常藏在石壁后。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "[Scene1]\n他包扎伤口，仿佛远处的预兆还没散去。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "[Scene1]\n云岚递来水，沉默过长，空气冷得异常。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "两人整理药材，低声讨论路线。",
          "",
          "[Scene3]",
          "他们低强度前推到岔口。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把药草分开放好，低声问他伤口还疼不疼。楚夜点头，把水囊递回去，两人把下一段路慢慢说清楚。",
          "",
          "[Scene3]",
          "休整之后，他们沿着缓坡前行，只在岔口停下，记住石壁上一道浅浅的刻痕。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "他们把能用的药粉重新分成两包。云岚说话很慢，楚夜也没有急着回答，只把掌心的血迹擦干净。",
          "",
          "[Scene3]",
          "片刻后，两人顺着石壁继续移动，先记路线，再决定下一处落脚点。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把火拨小，声音也压低。她问他疼不疼，楚夜停了一下，只说还能忍。两人把剩下的水分好。",
          "",
          "[Scene3]",
          "火星灭下去后，他们才离开原地，沿着更平缓的石阶往下探了一小段。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "他靠坐下来。",
          "",
          "呼吸慢慢稳住。",
          "",
          "伤口还在疼，但没有继续恶化。",
          "",
          "云岚把水递过来。",
          "",
          "他接住，喝了一口。",
          "",
          "没有人说话。",
          "",
          "只是安静。",
          "",
          "[Scene2]",
          "云岚把火拨小，声音也压低。她问他疼不疼，楚夜停了一下，只说还能忍。两人把剩下的水分好。",
          "",
          "[Scene3]",
          "火星灭下去后，他们才离开原地，沿着更平缓的石阶往下探了一小段。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火堆边的短歇 | 楚夜,云岚 | 安静恢复后前推 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("像是有什么异常");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("仿佛远处的预兆");
      expect((chatSpy.mock.calls[3]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("LOCKED_SCENE1");
      expect((chatSpy.mock.calls[3]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("他靠坐下来");
      expect((chatSpy.mock.calls[3]?.[0] as Array<{ content: string }>)[1]?.content ?? "").not.toContain("空气冷得异常");
      expect(output.content).toContain("他靠坐下来");
      expect(output.content).not.toContain("空气冷得异常");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("triggers structural rewrite when Scene1 is missing in breath mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-breath-missing-scene1-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nDownshift after the bloodbath.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: "[Scene1]\n楚夜先扎营疗伤，把伤势与余波稳住。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene2]",
          "楚夜和云岚低声交谈，讨论后续路线。",
          "",
          "[Scene3]",
          "两人随后低强度前推到岔口。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火堆边的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]",
          "楚夜先扎营疗伤，把伤势与余波稳住。",
          "",
          "[Scene2]",
          "他与云岚讨论路线、整理资源，关系进一步稳固。",
          "",
          "[Scene3]",
          "两人低强度前推到岔口，留下轻量钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite with full scene structure",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火堆边的短歇 | 楚夜,云岚 | 休整后低强度推进 | 缓和 | none | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("锁定开头 Scene1");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("LOCKED_SCENE1");
      expect(output.content).toContain("[Scene1]");
      expect(output.content).toContain("[Scene2]");
      expect(output.content).toContain("[Scene3]");
      expect(output.postWriteWarnings.some((warning) => warning.rule === "mood-cadence-violation")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails and rewrites when overdue hook advancement appears in Scene1 under hookExecutionPhase=late", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-hook-phase-early-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nBreath chapter with overdue hook.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火线后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜原本要先平静休整和包扎恢复，但他刚扎营就直接推进 H002，立刻找到了压制毒性的新方法，战线马上被拉高。",
          "",
          "[Scene2]\n两人只做了极短的讨论计划，喘息尚未完成，就被迫继续往前推进。",
          "",
          "[Scene3]\n他们准备继续深入，却没留下足够的恢复缓冲。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火线后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先在碎石后扎营疗伤，平静地包扎旧伤，慢慢把血战后的余波压住，并给云岚分了热汤与药材，让两人都先恢复体力。",
          "",
          "[Scene2]\n他与云岚并肩而行前先坐下交换情报，讨论计划与路线，重新整理资源和补给，确认暂时安全后再决定下一步，关系也在这段对话里明显加深。",
          "",
          "[Scene3]\n临出发前，楚夜才真正推进 H002，找到压制毒性的新方法，并把这条新方法作为低强度前推进入下一章钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite with hook phase moved to Scene3",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火线后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先在碎石后扎营疗伤，平静地包扎旧伤，慢慢把血战后的余波压住，并给云岚分了热汤与药材，让两人都先恢复体力。",
          "",
          "[Scene2]\n他与云岚并肩而行前先坐下交换情报，讨论计划与路线，重新整理资源和补给，确认暂时安全后再决定下一步，关系也在这段对话里明显加深。",
          "",
          "[Scene3]\n临出发前，楚夜才真正推进 H002，找到压制毒性的新方法，并把这条新方法作为低强度前推进入下一章钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite after semantic guard",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火线后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先在碎石后扎营疗伤，平静地包扎旧伤，慢慢把血战后的余波压住，并给云岚分了热汤与药材，让两人都先恢复体力。",
          "",
          "[Scene2]\n他与云岚并肩而行前先坐下交换情报，讨论计划与路线，重新整理资源和补给，确认暂时安全后再决定下一步，关系也在这段对话里明显加深。",
          "",
          "[Scene3]\n临出发前，楚夜才真正推进 H002，找到压制毒性的新方法，并把这条新方法作为低强度前推进入下一章钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite after semantic stabilization",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | 先休整后推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | 先休整后推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
          "  - scenePlan:",
          "    - scene1: settle / regroup",
          "    - scene2: relationship / recovery / practical talk",
          "    - scene3: low-intensity forward move",
          "",
          "## Hook Agenda",
          "### Emergence Directive",
          "- mustMaterializeHookNow: true",
          "- hookExecutionPhase: late",
          "- targetHookId: H002",
          "- targetHookExpectedPayoff: 发现压制毒性新方法",
          "- targetHookNotes: 噬魂草毒性仍在扩散",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Hook 推进只能发生在 [Scene3]");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("LOCKED_SCENE1");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("hookExecutionPhase=late");
      expect((chatSpy.mock.calls[2]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("hookPhaseViolatedScenes=Scene1");
      expect(output.moodCadenceCheck).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes without rewrite when overdue hook advancement is postponed to Scene3 under hookExecutionPhase=late", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-hook-phase-late-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 22\nBreath chapter with overdue hook.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜刚结束一场血战。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const agent = new WriterAgent({
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
      projectRoot: root,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火线后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先扎营疗伤，包扎伤口并恢复体力，让血战余波先落下，整段都保持平静与休整节奏。",
          "",
          "[Scene2]\n他与云岚持续对话，交换情报、讨论计划、整理药材和补给，确认暂时安全后才准备继续深入。",
          "",
          "[Scene3]\n临出发前，楚夜推进 H002，找到压制毒性的新方法，把关键突破后置到 Scene3 作为低强度推进与软钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火线后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先扎营疗伤，包扎伤口并恢复体力，让血战余波先落下，整段都保持平静与休整节奏。",
          "",
          "[Scene2]\n他与云岚持续对话，交换情报、讨论计划、整理药材和补给，确认暂时安全后才准备继续深入。",
          "",
          "[Scene3]\n临出发前，楚夜推进 H002，找到压制毒性的新方法，把关键突破后置到 Scene3 作为低强度推进与软钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- semantic-safe draft",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "火线后的短歇",
          "",
          "=== CHAPTER_CONTENT ===",
          "[Scene1]\n楚夜先扎营疗伤，包扎伤口并恢复体力，让血战余波先落下，整段都保持平静与休整节奏。",
          "",
          "[Scene2]\n他与云岚持续对话，交换情报、讨论计划、整理药材和补给，确认暂时安全后才准备继续深入。",
          "",
          "[Scene3]\n临出发前，楚夜推进 H002，找到压制毒性的新方法，把关键突破后置到 Scene3 作为低强度推进与软钩子。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- semantic-safe stabilized",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | Scene3推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async () => ({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 22 | 火线后的短歇 | 楚夜,云岚 | Scene3推进H002 | 缓和 | H002 advanced | 温暖 | breathing |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      }));

    try {
      await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 30,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 22,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- mood:",
          "  - targetMode: breath",
          "  - requiredSceneQuota: 1",
          "  - moodCoverageMin: 0.3",
          "  - forbidDominantMode: combat-heavy",
          "",
          "## Hook Agenda",
          "### Emergence Directive",
          "- mustMaterializeHookNow: true",
          "- hookExecutionPhase: late",
          "- targetHookId: H002",
          "- targetHookExpectedPayoff: 发现压制毒性新方法",
          "- targetHookNotes: 噬魂草毒性仍在扩散",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses Payoff Realization Mode to turn a vague promised reveal into an actual reveal scene", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-payoff-realization-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 12\nReveal the origin of the ancient scroll.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 楚夜已经拿到古卷，但还不知道来源。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const { logger, warnings } = createCaptureLogger();
    const agent = new WriterAgent({
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
      projectRoot: root,
      logger,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "古卷前的疑云",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜反复端详古卷，只觉得它愈发神秘，似乎和深处的旧传说有关，却没人真正说破来历。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "祭司一脉的古卷",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜逼问碑灵时，指节被古卷边缘割出细小血痕，掌心一阵灼痛。就在这一刻，对方突然吐出真相：这卷古卷并非无主之物，而是来自葬渊祭司一脉，缺失的三页原本就是用来封存祭火印记的钥匙。\n\n为了换到这条真相，楚夜硬扛住反噬，经脉刺痛一路蔓延。真相落下后，黑市封锁的逻辑被当场改写，他终于拿到进入祭司旧案的第一把门钥匙。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- payoff realized in final act",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 12 | 祭司一脉的古卷 | 楚夜, 碑灵 | 揭示古卷来源 | 紧张 | ancient-scroll advanced | 冷硬 | reveal |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));
    const settleSpy = vi.spyOn(WriterAgent.prototype as never, "settle" as never)
      .mockResolvedValue({
        settlement: {
          postSettlement: ["settled"],
          updatedState: "# 当前状态\n",
          updatedHooks: "# 伏笔池\n",
          updatedLedger: "",
          chapterSummary: "| 12 | 祭司一脉的古卷 | 楚夜, 碑灵 | 揭示古卷来源 | 紧张 | ancient-scroll advanced | 冷硬 | reveal |",
          updatedSubplots: "# 支线进度板\n",
          updatedEmotionalArcs: "# 情感弧线\n",
          updatedCharacterMatrix: "# 角色交互矩阵\n",
        },
        usage: ZERO_USAGE,
      });

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 12,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Chapter Goal",
          "- mainConflict: 古卷来源关系到葬渊旧案。",
          "- protagonistGoal: 揭开古卷来源。",
          "- activeCharacters: 楚夜, 碑灵",
          "- foreshadowToTouch: ancient-scroll",
          "- payoffToDeliver: 揭开古卷来源",
          "- payoffDirective.promisedPayoff: 揭开古卷来源",
          "- payoffDirective.payoffType: reveal",
          "- payoffDirective.payoffDepth: layered",
          "- payoffDirective.mandatoryByFinalAct: true",
          "- endingHookType: reveal",
          "- nextChapterPull: 古卷来源会把祭司旧案拖出来。",
        ].join("\n"),
        contextPackage: {
          chapter: 12,
          selectedContext: [],
          chapterGoal: {
            mainConflict: "古卷来源关系到葬渊旧案。",
            protagonistGoal: "揭开古卷来源。",
            activeCharacters: ["楚夜", "碑灵"],
            foreshadowToTouch: ["ancient-scroll"],
            payoffToDeliver: "揭开古卷来源",
            payoffDirective: {
              promisedPayoff: "揭开古卷来源",
              payoffType: "reveal",
              payoffDepth: "layered",
              mandatoryByFinalAct: true,
            },
            endingHookType: "reveal",
            nextChapterPull: "古卷来源会把祭司旧案拖出来。",
          },
        },
        ruleStack: {
          layers: [{ id: "L4", name: "current_task", precedence: 70, scope: "local" }],
          sections: { hard: [], soft: [], diagnostic: [] },
          overrideEdges: [],
          activeOverrides: [],
        },
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Payoff Realization Directive");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("payoffDepth: layered");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("只允许本章兑现一层");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("payoff > cost > endingType");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("If payoff is not realized, the chapter is invalid regardless of cost or ending type.");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("禁止为了满足 cost、calm_end、unresolved_end 或任何 endingType 而跳过 payoff。");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Every payoff must include: sensory detail, cost paid, visible change in situation.");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Every payoff must include vivid sensory detail showing the exact moment of change.");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Every payoff must include a clear moment of change (a single, sharp turning instant).");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("MOMENT 句格式：必须单独成句");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("buildup（过程）-> trigger（触发）-> MOMENT（必须单独一句）-> result（结果）-> cost（代价）");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("逐渐打开 / 开始打开 / 正在打开 / 缓缓开启 / 似乎打开 / 似乎裂开");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("正在打开 / 缓缓开启");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("似乎裂开");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("After the MOMENT, you MUST include a resolution phase that stabilizes the situation.");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("Every payoff MUST include a clear cost that hurts the protagonist.");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("moment -> result -> cost");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("气血/精血/资源消耗");
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("他的右臂随之彻底失去知觉");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("PAYOFF REALIZATION MODE");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("硬优先级：payoff > cost > endingType。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("如果 payoff 没有兑现");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("MOMENT 必须是单独一句");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("正确 MOMENT 示例：石门猛地裂开。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("代价必须落在 moment/result 之后");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("身体损伤加重、气血/精血/资源消耗");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("必须在 Act3 插入或替换一个具体的 payoff scene");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("优先级锁死：payoff > cost > endingType。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("禁止为了满足 cost、calm_end、unresolved_end 或任何 endingType 而跳过 payoff。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("感知层必须具体并绑定变化瞬间");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("MOMENT（单一清晰的瞬间爆发点）");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("MOMENT 必须单独成句");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("禁止 MOMENT 写成“逐渐打开 / 开始打开 / 正在打开 / 缓缓开启 / 似乎打开 / 似乎裂开”。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("MOMENT 后必须有收束阶段，稳定局势。");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("代价必须落在 moment/result 之后");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("后遗症/状态恶化");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("不能只补一句；要重写 payoff 段为完整冲击段");
      expect(warnings.some((message) => message.includes("PAYOFF MODE"))).toBe(true);
    } finally {
      settleSpy.mockRestore();
      chatSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds sharp event constraints for resource payoffs in the writer prompt block", () => {
    const agent = new WriterAgent({
      client: {} as ConstructorParameters<typeof WriterAgent>[0]["client"],
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const block = (agent as unknown as {
      buildPayoffDirectiveBlock: (
        chapterGoal: {
          payoffToDeliver: string;
          payoffDirective: {
            promisedPayoff: string;
            payoffType: "resource";
            mandatoryByFinalAct: boolean;
          };
        },
        language: "zh" | "en",
      ) => string;
    }).buildPayoffDirectiveBlock({
      payoffToDeliver: "获得地图信息",
      payoffDirective: {
        promisedPayoff: "获得地图信息",
        payoffType: "resource",
        mandatoryByFinalAct: true,
      },
    }, "zh");

    expect(block).toContain("For resource payoff, you MUST turn the acquisition into a sharp event with a clear trigger and impact.");
    expect(block).toContain("payoff > cost > endingType");
    expect(block).toContain("If payoff is not realized");
    expect(block).toContain("资源型 payoff 必须写成带触发与冲击的获取事件");
    expect(block).toContain("trigger -> MOMENT -> cost -> stabilization");
    expect(block).toContain("buildup（过程）-> trigger（触发）-> MOMENT（必须单独一句）-> result（结果）-> cost（代价）");
    expect(block).toContain("MOMENT 句格式：必须单独成句");
    expect(block).toContain("石门猛地裂开。");
    expect(block).toContain("moment -> result -> cost");
    expect(block).toContain("禁止无代价成功");
    expect(block).toContain("禁止直接写“他获得了……”或“信息出现在脑海”。");
  });

  it("stops full payoff rewrites after two failed attempts", async () => {
    const agent = new WriterAgent({
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

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "古卷前的疑云",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜指尖渗血，古卷边缘微微发烫，碑灵仍不肯松口，只反复说这卷东西牵扯旧案。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite 1",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "古卷前的疑云",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜把血滴在卷面上，卷纹开始打开，旧案名字若隐若现，可碑灵还是没有把真相说死。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite 2",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "古卷前的疑云",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜再一次逼近临界，血线沿着卷面蔓延，碑灵的声音终于发颤，古卷背后的旧名呼之欲出。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- rewrite 3",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    try {
      const rewritten = await (agent as unknown as {
        rewriteForPayoffDirectiveIfNeeded: (params: {
          creative: { title: string; content: string; wordCount: number; preWriteCheck: string };
          chapterGoal: ChapterGoal;
          language: "zh" | "en";
          chapterNumber: number;
          maxTokens: number;
          titleCandidates: ReadonlyArray<{ title: string }>;
          countingMode: LengthSpec["countingMode"];
          onUsage: (usage: typeof ZERO_USAGE) => void;
        }) => Promise<{ title: string; content: string; wordCount: number; preWriteCheck: string }>;
      }).rewriteForPayoffDirectiveIfNeeded({
        creative: {
          title: "古卷前的疑云",
          content: "楚夜盯着古卷，只觉得一切都快说破了，却始终没有真正落下来的那一刻。",
          wordCount: 34,
          preWriteCheck: "- initial draft",
        },
        chapterGoal: {
          mainConflict: "古卷来源关系到葬渊旧案。",
          protagonistGoal: "揭开古卷来源。",
          activeCharacters: ["楚夜", "碑灵"],
          foreshadowToTouch: ["ancient-scroll"],
          payoffToDeliver: "揭开古卷来源",
          payoffDirective: {
            promisedPayoff: "揭开古卷来源",
            payoffType: "reveal",
            payoffDepth: "layered",
            mandatoryByFinalAct: true,
          },
          endingHookType: "reveal",
          nextChapterPull: "古卷来源会把祭司旧案拖出来。",
        },
        language: "zh",
        chapterNumber: 12,
        maxTokens: 1200,
        titleCandidates: [],
        countingMode: "zh_chars",
        onUsage: () => {},
      });

      expect(chatSpy).toHaveBeenCalledTimes(2);
      expect(rewritten.preWriteCheck).toContain("rewrite 2");
      expect(rewritten.content).not.toContain("那一刻，他看懂了这份契约。");
    } finally {
      chatSpy.mockRestore();
    }
  });

  it("uses a resource-cognition forced moment anchor for resource payoffs", () => {
    const agent = new WriterAgent({
      client: {} as ConstructorParameters<typeof WriterAgent>[0]["client"],
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const rewritten = (agent as unknown as {
      applyForcedMomentAnchor: (
        creative: { title: string; content: string; wordCount: number; preWriteCheck: string },
        chapterGoal: ChapterGoal,
        language: "zh" | "en",
        countingMode: LengthSpec["countingMode"],
      ) => { title: string; content: string; wordCount: number; preWriteCheck: string };
    }).applyForcedMomentAnchor(
      {
        title: "契约回响",
        content: "楚夜指尖按住契约纹路，只觉得识海发胀，旧字却始终没有真正落成可用的信息。",
        wordCount: 35,
        preWriteCheck: "- rewrite 3",
      },
      {
        mainConflict: "契约内容还没有被真正读懂。",
        protagonistGoal: "看懂契约。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["contract"],
        payoffToDeliver: "看懂契约内容",
        payoffDirective: {
          promisedPayoff: "看懂契约内容",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
        endingHookType: "reveal",
        nextChapterPull: "契约内容会改变后续选择。",
      },
      "zh",
      "zh_chars",
    );

    expect(rewritten.content).toContain("契约的全部内容，涌入他的意识。");
    expect(rewritten.content).toContain("新的信息，在这一句之后终于落成了可用的认知。");
    expect(rewritten.content).toContain("代价随即压进识海");
  });

  it("uses a state-change forced moment anchor for breakthrough or reversal payoffs", () => {
    const agent = new WriterAgent({
      client: {} as ConstructorParameters<typeof WriterAgent>[0]["client"],
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const rewritten = (agent as unknown as {
      applyForcedMomentAnchor: (
        creative: { title: string; content: string; wordCount: number; preWriteCheck: string },
        chapterGoal: ChapterGoal,
        language: "zh" | "en",
        countingMode: LengthSpec["countingMode"],
      ) => { title: string; content: string; wordCount: number; preWriteCheck: string };
    }).applyForcedMomentAnchor(
      {
        title: "真名裂口",
        content: "他被逼到极限，真名边缘不断震颤，可真正的断点始终没有落下。",
        wordCount: 29,
        preWriteCheck: "- rewrite 3",
      },
      {
        mainConflict: "真名即将失稳。",
        protagonistGoal: "撑过这次崩解。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["true-name"],
        payoffToDeliver: "真名崩解",
        payoffDirective: {
          promisedPayoff: "真名崩解",
          payoffType: "breakthrough",
          mandatoryByFinalAct: true,
        },
        endingHookType: "breakthrough",
        nextChapterPull: "崩解后会引出新的身份代价。",
      },
      "zh",
      "zh_chars",
    );

    expect(rewritten.content).toContain("他的真名，开始崩解。");
    expect(rewritten.content).toContain("他的状态，被这一句硬生生推到了新的阶段。");
    expect(rewritten.content).toContain("代价立刻反咬回来");
  });

  it("adds character authenticity constraints to the writer prompt block", () => {
    const agent = new WriterAgent({
      client: {} as ConstructorParameters<typeof WriterAgent>[0]["client"],
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const block = (agent as unknown as {
      buildCharacterAuthenticityBlock: (language: "zh" | "en") => string;
    }).buildCharacterAuthenticityBlock("zh");

    expect(block).toContain("关键节点里，角色至少要出现一次非最优选择");
    expect(block).toContain("禁止说明式内心");
    expect(block).toContain("Any explanatory inner monologue is forbidden and will invalidate the chapter.");
    expect(block).toContain("Any realization must be expressed as a sequence of perception -> reaction -> implication, never as direct explanation.");
    expect(block).toContain("Every perception must be reinforced by multiple sensory signals and at least one physical reaction.");
    expect(block).toContain("每个认知链至少要有 2 个感知信号 + 1 个行为反应");
    expect(block).toContain("内心必须通过行动、停顿、感知、行为变化来表现");
    expect(block).toContain("禁止直接写“他很愤怒/紧张/疲惫”");
    expect(block).toContain("情绪必须外化为身体反应");
    expect(block).toContain("错误：他明白自己被盯上了。正确：他停下脚步，没有回头。");
    expect(block).toContain("禁止停下来给读者解释战力规则、世界观设定或修炼体系");
  });

  it("uses Hook Emergence Mode to force an overdue hook into real advancement instead of repeating the old danger", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-writer-hook-emergence-"));
    const bookDir = join(root, "book");
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 9\nForce the poison debt to move.\n", "utf-8"),
      writeFile(join(storyDir, "style_guide.md"), "# Style Guide\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 噬魂草毒性仍在扩散。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# 支线进度板\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# 情感弧线\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# 角色交互矩阵\n", "utf-8"),
    ]);

    const { logger, warnings } = createCaptureLogger();
    const agent = new WriterAgent({
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
      projectRoot: root,
      logger,
    });

    const chatSpy = vi.spyOn(WriterAgent.prototype as never, "chat" as never)
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "毒潮未散",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜盯着噬魂草，只知道它仍危险，毒性依旧存在，却还是没有任何新进展。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- ok",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "逆毒之法",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜借着碑纹反推药性，终于发现一套压制噬魂草毒性的新方法，至少先稳住了扩散速度。虽然旧患还没彻底根除，但这条线第一次真正往前迈了一步。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- hook emergence realized",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== CHAPTER_TITLE ===",
          "逆毒之法",
          "",
          "=== CHAPTER_CONTENT ===",
          "楚夜借着碑纹反推药性，终于发现一套压制噬魂草毒性的新方法，至少先稳住了扩散速度。虽然旧患还没彻底根除，但这条线第一次真正往前迈了一步。",
          "",
          "=== PRE_WRITE_CHECK ===",
          "- hook emergence still realized after final guard",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "=== OBSERVATIONS ===\n- observed",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== POST_SETTLEMENT ===",
          "- settled",
          "",
          "=== UPDATED_STATE ===",
          "# 当前状态",
          "",
          "- 楚夜暂时稳住了噬魂草扩散。",
          "",
          "=== UPDATED_HOOKS ===",
          "# 伏笔池",
          "",
          "=== CHAPTER_SUMMARY ===",
          "| 9 | 逆毒之法 | 楚夜 | 找到压制噬魂草毒性的新方法 | 毒性暂稳 | H002 advanced | 紧张 | discovery |",
          "",
          "=== UPDATED_SUBPLOTS ===",
          "# 支线进度板",
          "",
          "=== UPDATED_EMOTIONAL_ARCS ===",
          "# 情感弧线",
          "",
          "=== UPDATED_CHARACTER_MATRIX ===",
          "# 角色交互矩阵",
        ].join("\n"),
        usage: ZERO_USAGE,
      })
      .mockImplementation(async (messages) => fallbackChatResponse(messages as ReadonlyArray<{ readonly content?: string }>));

    try {
      const output = await agent.writeChapter({
        book: {
          id: "writer-book",
          title: "Writer Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
        bookDir,
        chapterNumber: 9,
        chapterIntent: [
          "# Chapter Intent",
          "",
          "## Hook Agenda",
          "### Emergence Directive",
          "- mustMaterializeHookNow: true",
          "- targetHookId: H002",
          "- targetHookState: overdue",
          "- targetHookExpectedPayoff: 发现压制毒性新方法",
          "- targetHookNotes: 噬魂草毒性仍在扩散",
        ].join("\n"),
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(chatSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect((chatSpy.mock.calls[0]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("## Hook Emergence Directive");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[0]?.content ?? "").toContain("HOOK EMERGENCE MODE");
      expect((chatSpy.mock.calls[1]?.[0] as Array<{ content: string }>)[1]?.content ?? "").toContain("合格结果：推进 / 部分兑现 / 完全回收。");
      expect(warnings.some((message) => message.includes("HOOK EMERGENCE MODE"))).toBe(true);
      expect(output.content).toContain("发现一套压制噬魂草毒性的新方法");
      expect(output.postWriteWarnings.some((warning) => warning.rule === "hook-emergence-failure")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
