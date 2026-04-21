import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WriterAgent } from "../agents/writer.js";
import { buildLengthSpec } from "../utils/length-metrics.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

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
      });

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

      const settlePrompt = (chatSpy.mock.calls[2]?.[0] as ReadonlyArray<{ content: string }> | undefined)?.[1]?.content ?? "";
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

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
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

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
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

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
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

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
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
      });

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
        "阶段 2：状态结算（第1章，18字）",
        "阶段 2a：提取第1章事实",
        "阶段 2b：把观察结果回写到真相文件",
      ]));
    } finally {
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

    vi.spyOn(WriterAgent.prototype as never, "chat" as never)
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

      expect(output.endingHookCheck).toEqual(expect.objectContaining({
        expectedType: "reveal",
        matched: false,
      }));
      expect(output.payoffCheck).toEqual(expect.objectContaining({
        expectedPayoff: "揭开黑色古碑的代价",
        matched: false,
      }));
      expect(output.postWriteWarnings.some((warning) => warning.rule === "ending-hook-check")).toBe(true);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "payoff-check")).toBe(true);
      expect(output.postWriteErrors).toEqual([]);
    } finally {
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
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(output.resourceLedgerCheck).toBeDefined();
      expect(output.resourceLedgerCheck?.matched).toBe(false);
      expect(output.resourceLedgerCheck?.warnings).toEqual(expect.arrayContaining([
        "resource-ledger-missing-consumption",
        "resource-ledger-missing-injury-update",
        "resource-ledger-value-mismatch",
      ]));
      expect(output.postWriteWarnings.some((warning) => warning.rule === "resource-ledger-missing-consumption")).toBe(true);
      expect(output.postWriteWarnings.some((warning) => warning.rule === "resource-ledger-missing-injury-update")).toBe(true);
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
        chapterNumber: 4,
        lengthSpec: buildLengthSpec(220, "zh"),
      });

      expect(output.postWriteWarnings.some((warning) => warning.rule === "ending-isomorphism")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
