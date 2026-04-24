import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import { PlannerAgent } from "../agents/planner.js";

describe("PlannerAgent", () => {
  let root: string;
  let bookDir: string;
  let storyDir: string;
  let book: BookConfig;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-planner-test-"));
    bookDir = join(root, "books", "planner-book");
    storyDir = join(bookDir, "story");
    await mkdir(join(storyDir, "runtime"), { recursive: true });

    book = {
      id: "planner-book",
      title: "Planner Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 20,
      chapterWordCount: 3000,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\nKeep the book emotionally centered on the mentor-student bond.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nBring the focus back to the mentor conflict before opening new subplots.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "story_bible.md"),
        "# Story Bible\n\n- The jade seal cannot be destroyed.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 3\nTrack the merchant guild's escape route.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "book_rules.md"),
        "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        "# Current State\n\n- Lin Yue still hides the broken oath token.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "mentor-oath",
            startChapter: 1,
            type: "relationship",
            status: "open",
            lastAdvancedChapter: 2,
            expectedPayoff: "The first concrete clue about why the mentor vanished.",
            notes: "Lin Yue still carries the broken oath token tied to the vanished mentor.",
          },
        ], null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        "# Chapter Summaries\n\n| 2 | Trial fallout | Mentor left without explanation |\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "genre_profile.yaml"),
        [
          "template: xuanhuan",
          "label: 玄幻网文",
          "tone:",
          "  - 热血升级",
          "  - 危机压迫",
          "core_loop:",
          "  - 遭遇压制",
          "  - 获得机缘",
          "  - 小胜立威",
          "forbidden_patterns:",
          "  - 大段设定说明脱离人物行动",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "arc_map.yaml"),
        [
          "template: xuanhuan",
          "volumes:",
          "  - id: vol-01",
          "    title: 山门外的活路",
          "    chapter_range: \"1-30\"",
          "    core_conflict: 主角在边缘地带求生并找到第一条向上爬的路径",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "power_system.yaml"),
        [
          "template: xuanhuan",
          "realm_tree:",
          "  - 炼体",
          "  - 聚气",
          "  - 筑基",
          "base_rules:",
          "  - 境界压制真实存在，越级取胜必须依赖明确外力、信息差或代价",
          "exception_rules:",
          "  - 主角可凭特殊体质短时突破上限，但必须留下代价",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses current focus as the chapter goal when no outline node is available", async () => {
    await writeFile(
      join(storyDir, "volume_outline.md"),
      "# Volume Outline\n",
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("mentor conflict");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("mentor conflict");
  });

  it("auto-fills a minimal goal scaffold from state context when upstream goal sources are missing", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(TODO)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\n（填写当前冲突）\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "arc_map.yaml"),
        "template: xuanhuan\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# 当前状态",
          "",
          "| 字段 | 值 |",
          "| --- | --- |",
          "| 当前章节 | 9 |",
          "| 当前目标 | 恢复伤势并稳定状态，讨论下一步行动 |",
          "| 当前冲突 | 伤势未稳且追兵威胁仍在 |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 8 | 余波 | 楚夜 | 休整后确认补给 | 伤势反复 | H002 stalled | 压抑 | breathing |",
          "| 9 | 短歇 | 楚夜,云岚 | 讨论下一步路线 | 追兵锁定痕迹 | H002 stalled | 冷硬 | breathing |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 10,
    });

    expect(result.intent.goal.trim().length).toBeGreaterThan(0);
    expect(result.intent.goal).toContain("恢复伤势");
    expect(result.intent.chapterGoal?.mainConflict.trim().length).toBeGreaterThan(0);
    expect(result.intent.chapterGoal?.protagonistGoal.trim().length).toBeGreaterThan(0);
  });

  it("keeps an existing explicit goal unchanged", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: "Secure the first concrete clue about the vanished mentor.",
    });

    expect(result.intent.goal).toBe("Secure the first concrete clue about the vanished mentor.");
  });

  it("injects webnovel template summaries into planning without requiring the raw yaml in prompts", async () => {
    await writeFile(
      join(storyDir, "volume_outline.md"),
      "# Volume Outline\n",
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.styleEmphasis.some((item) => item.includes("热血升级"))).toBe(true);
    expect(result.intent.mustAvoid.some((item) => item.includes("设定说明"))).toBe(true);
    expect(result.intent.mustKeep.some((item) => item.includes("境界阶梯"))).toBe(true);
    expect(result.intent.arcDirective).toContain("山门外的活路");
    expect(result.plannerInputs).toContain(join(storyDir, "genre_profile.yaml"));
    expect(result.plannerInputs).toContain(join(storyDir, "arc_map.yaml"));
    expect(result.plannerInputs).toContain(join(storyDir, "power_system.yaml"));
  });

  it("injects a structured mood downshift directive after three confrontation-heavy chapters", async () => {
    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| 19 | 血门前夜 | 楚夜 | 正面强攻 | 紧张 | none | 冷硬 | confrontation |",
        "| 20 | 裂谷交锋 | 楚夜 | 与追兵正面厮杀 | 压迫 | none | 凝重 | confrontation |",
        "| 21 | 碑下血战 | 楚夜 | 继续高压对抗 | 焦灼 | none | 肃杀 | confrontation |",
      ].join("\n"),
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 22,
    });

    expect(result.intent.moodDirective).toEqual(expect.objectContaining({
      targetMode: "breath",
      requiredSceneQuota: 1,
      moodCoverageMin: 0.3,
      forceSceneStructure: true,
      sceneMinShare: 0.3,
      scene1NoThreatEscalation: true,
      forbidDominantMode: "combat-heavy",
      scenePlan: expect.objectContaining({
        scene1: expect.stringContaining("pure"),
        scene2: expect.stringContaining("low-intensity"),
        scene3: expect.stringContaining("short"),
      }),
    }));
    expect(result.intentMarkdown).toContain("targetMode: breath");
    expect(result.intentMarkdown).toContain("requiredSceneQuota: 1");
    expect(result.intentMarkdown).toContain("moodCoverageMin: 0.3");
    expect(result.intentMarkdown).toContain("forbidDominantMode: combat-heavy");
    expect(result.intentMarkdown).toContain("scenePlan:");
    expect(result.intentMarkdown).toContain("scene1:");
    expect(result.intentMarkdown).toContain("scene2:");
    expect(result.intentMarkdown).toContain("scene3:");
    expect(result.intent.sceneDirective ?? "").toContain("Scene Isolation");
    expect(result.intent.sceneDirective ?? "").toContain("scene1 至少占正文 30%");
    expect(result.intent.sceneDirective ?? "").toContain("优先级：scene1 > payoff > hook");
    expect(result.intent.sceneDirective ?? "").toContain("本章也必须至少部分兑现 payoff");
    expect(result.intent.sceneDirective ?? "").toContain("不得阻止 payoff 发生与局势变化");
  });

  it("keeps payoff above unresolved_end and tells the chapter to resolve payoff before opening a new question", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const directives = (planner as unknown as {
      applyPayoffEndingPriority: (input: {
        directives: {
          chapterMode?: "breath" | "escalation" | "combat" | "reveal";
          endingType?: "reveal_end" | "unresolved_end" | "resolution_end" | "twist_end" | "calm_end";
          sceneDirective?: string;
        };
        chapterGoal: {
          payoffToDeliver: string;
        };
        language: "zh" | "en";
      }) => { sceneDirective?: string };
    }).applyPayoffEndingPriority({
      directives: {
        endingType: "unresolved_end",
        sceneDirective: "保留未解悬念。",
      },
      chapterGoal: {
        payoffToDeliver: "完成第一次觉醒",
      },
      language: "zh",
    });

    expect(directives.sceneDirective ?? "").toContain("payoff 优先级高于 endingType");
    expect(directives.sceneDirective ?? "").toContain("不得阻止 payoff 发生与局势变化");
    expect(directives.sceneDirective ?? "").toContain("必须先完成 payoff，再通过新威胁或新问题让局势保持未解");
  });

  it("splits composite payoff into one single chapter payoff and defers the rest", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceSingleChapterPayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
        };
        language: "zh" | "en";
      }) => {
        chapterGoal: {
          payoffToDeliver: string;
          nextChapterPull: string;
          payoffDirective?: { promisedPayoff: string };
        };
        directiveNote?: string;
      };
    }).enforceSingleChapterPayoff({
      chapterGoal: {
        mainConflict: "楚夜必须撑过觉醒余波。",
        protagonistGoal: "完成觉醒。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["awakening-shadow"],
        payoffToDeliver: "觉醒+地底阴影压制",
        endingHookType: "danger",
        nextChapterPull: "觉醒后局势会继续升级。",
        payoffDirective: {
          promisedPayoff: "觉醒+地底阴影压制",
          payoffType: "breakthrough",
          mandatoryByFinalAct: true,
        },
      },
      language: "zh",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("觉醒");
    expect(governed.chapterGoal.payoffDirective?.promisedPayoff).toBe("觉醒");
    expect(governed.chapterGoal.nextChapterPull).toContain("地底阴影压制");
    expect(governed.directiveNote ?? "").toContain("本章 payoff 只保留“觉醒”");
  });

  it("keeps single payoff unchanged when it is already singular and finishable", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceSingleChapterPayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
        };
        language: "zh" | "en";
      }) => {
        chapterGoal: {
          payoffToDeliver: string;
          nextChapterPull: string;
        };
        directiveNote?: string;
      };
    }).enforceSingleChapterPayoff({
      chapterGoal: {
        mainConflict: "楚夜必须撑过觉醒余波。",
        protagonistGoal: "完成觉醒。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["awakening-shadow"],
        payoffToDeliver: "完成第一次觉醒",
        endingHookType: "breakthrough",
        nextChapterPull: "觉醒后新的线索会浮现。",
      },
      language: "zh",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("完成第一次觉醒");
    expect(governed.chapterGoal.nextChapterPull).toBe("觉醒后新的线索会浮现。");
    expect(governed.directiveNote).toBeUndefined();
  });

  it("adds a concrete payoffTrigger for breakthrough payoffs and writes trigger guidance into directives", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applyBreakthroughPayoffTrigger: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
          payoffTrigger?: string;
        };
        language: "zh" | "en";
        currentState: string;
      }) => {
        chapterGoal: {
          payoffTrigger?: string;
        };
        directiveNote?: string;
      };
    }).applyBreakthroughPayoffTrigger({
      chapterGoal: {
        mainConflict: "楚夜在高压战斗中被反噬逼到濒死边缘。",
        protagonistGoal: "完成第一次觉醒。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["awakening-shadow"],
        payoffToDeliver: "觉醒",
        payoffDirective: {
          promisedPayoff: "觉醒",
          payoffType: "breakthrough",
          mandatoryByFinalAct: true,
        },
        endingHookType: "breakthrough",
        nextChapterPull: "觉醒后更深处的黑影会盯上他。",
      },
      language: "zh",
      currentState: "# 当前状态\n- 楚夜气血濒枯，骨火反噬正在失控。\n",
    });

    expect(governed.chapterGoal.payoffTrigger).toBeTruthy();
    expect(governed.chapterGoal.payoffTrigger).toMatch(/濒死|临界点|反噬/u);
    expect(governed.directiveNote ?? "").toContain("Trigger:");
    expect(governed.directiveNote ?? "").toContain("禁止无触发直接觉醒或突破");
  });

  it("does not invent payoffTrigger for non-breakthrough payoffs", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applyBreakthroughPayoffTrigger: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
          payoffTrigger?: string;
        };
        language: "zh" | "en";
        currentState: string;
      }) => {
        chapterGoal: {
          payoffTrigger?: string;
        };
        directiveNote?: string;
      };
    }).applyBreakthroughPayoffTrigger({
      chapterGoal: {
        mainConflict: "楚夜必须拿到黑市腰牌。",
        protagonistGoal: "获得进入黑市的资格。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["black-market-pass"],
        payoffToDeliver: "拿到黑市腰牌",
        payoffDirective: {
          promisedPayoff: "拿到黑市腰牌",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
        endingHookType: "choice",
        nextChapterPull: "拿到腰牌后，真正的交易才会开始。",
      },
      language: "zh",
      currentState: "# 当前状态\n- 黑市入口就在前方。\n",
    });

    expect(governed.chapterGoal.payoffTrigger).toBeUndefined();
    expect(governed.directiveNote).toBeUndefined();
  });

  it("rewrites range or abstract payoff into a concrete writable event and records payoff-non-event", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceConcreteEventPayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
        };
        language: "zh" | "en";
        currentState: string;
      }) => {
        chapterGoal: {
          payoffToDeliver: string;
          payoffDirective?: { promisedPayoff: string };
        };
        directiveNote?: string;
        conflict?: { type: string; detail?: string };
      };
    }).enforceConcreteEventPayoff({
      chapterGoal: {
        mainConflict: "楚夜必须在祭坛前解开玉简秘密。",
        protagonistGoal: "找到玉简真正的开启方式。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["jade-slip"],
        payoffToDeliver: "13-17章",
        payoffDirective: {
          promisedPayoff: "13-17章",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
        endingHookType: "reveal",
        nextChapterPull: "玉简一旦启动，祭坛深处会有反应。",
      },
      language: "zh",
      currentState: "# 当前状态\n- 楚夜手中的玉简与祭坛纹路正在共鸣。\n",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("玉简核心机制被触发");
    expect(governed.chapterGoal.payoffDirective?.promisedPayoff).toBe("玉简核心机制被触发");
    expect(governed.directiveNote ?? "").toContain("payoff-non-event");
    expect(governed.conflict?.type).toBe("payoff-non-event");
    expect(governed.conflict?.detail).toContain("13-17章");
  });

  it("keeps a concrete event payoff unchanged when it is already single and writable", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceConcreteEventPayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
        };
        language: "zh" | "en";
        currentState: string;
      }) => {
        chapterGoal: {
          payoffToDeliver: string;
        };
        directiveNote?: string;
        conflict?: { type: string };
      };
    }).enforceConcreteEventPayoff({
      chapterGoal: {
        mainConflict: "楚夜必须解开残图上的锁孔。",
        protagonistGoal: "打开地图锁孔。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["map-lock"],
        payoffToDeliver: "地图锁孔第一次打开",
        payoffDirective: {
          promisedPayoff: "地图锁孔第一次打开",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
        endingHookType: "choice",
        nextChapterPull: "锁孔打开后，新的路线会显现。",
      },
      language: "zh",
      currentState: "# 当前状态\n- 残图锁孔已经显出轮廓。\n",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("地图锁孔第一次打开");
    expect(governed.directiveNote).toBeUndefined();
    expect(governed.conflict).toBeUndefined();
  });

  it("rewrites repeated reveal payoff into a deeper executable reveal when the information is already known", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceExecutableRevealPayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
        };
        language: "zh" | "en";
        currentState: string;
        chapterSummaries: string;
      }) => {
        chapterGoal: {
          payoffToDeliver: string;
          payoffDirective?: { promisedPayoff: string };
        };
        directiveNote?: string;
        conflict?: { type: string; detail?: string };
      };
    }).enforceExecutableRevealPayoff({
      chapterGoal: {
        mainConflict: "楚夜已经知道隐藏漏洞存在，但还不知道它能不能救下真名。",
        protagonistGoal: "继续利用漏洞自救。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["true-name"],
        payoffToDeliver: "发现隐藏漏洞",
        payoffDirective: {
          promisedPayoff: "发现隐藏漏洞",
          payoffType: "reveal",
          mandatoryByFinalAct: true,
        },
        endingHookType: "reveal",
        nextChapterPull: "这个漏洞会不会带来更大代价，还没有答案。",
      },
      language: "zh",
      currentState: "# 当前状态\n- 楚夜已经发现隐藏漏洞，但真名仍在继续消散。\n",
      chapterSummaries: "# Chapter Summaries\n| 54 | 漏洞显形 | 楚夜 | 发现隐藏漏洞，却没能止住真名消散。 |\n",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("发现漏洞无法阻止真名消散，只能转移代价");
    expect(governed.chapterGoal.payoffDirective?.promisedPayoff).toBe("发现漏洞无法阻止真名消散，只能转移代价");
    expect(governed.directiveNote ?? "").toContain("reveal-gap-check");
    expect(governed.conflict?.type).toBe("reveal-gap-check");
    expect(governed.conflict?.detail).toContain("发现隐藏漏洞");
  });

  it("keeps reveal payoff unchanged when the context still contains an unresolved information gap", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceExecutableRevealPayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
        };
        language: "zh" | "en";
        currentState: string;
        chapterSummaries: string;
      }) => {
        chapterGoal: {
          payoffToDeliver: string;
        };
        directiveNote?: string;
        conflict?: { type: string };
      };
    }).enforceExecutableRevealPayoff({
      chapterGoal: {
        mainConflict: "漏洞已经显形，但它的限制条件仍然未知。",
        protagonistGoal: "查清这个漏洞只在什么条件下有效。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: ["true-name"],
        payoffToDeliver: "发现漏洞的限制条件",
        payoffDirective: {
          promisedPayoff: "发现漏洞的限制条件",
          payoffType: "reveal",
          mandatoryByFinalAct: true,
        },
        endingHookType: "reveal",
        nextChapterPull: "只有弄清条件，下一步才敢押上代价。",
      },
      language: "zh",
      currentState: "# 当前状态\n- 楚夜已经发现漏洞，但漏洞的限制条件尚未弄清。\n",
      chapterSummaries: "# Chapter Summaries\n| 54 | 漏洞显形 | 楚夜 | 发现隐藏漏洞，限制条件仍未明。 |\n",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("发现漏洞的限制条件");
    expect(governed.directiveNote).toBeUndefined();
    expect(governed.conflict).toBeUndefined();
  });

  it("trims multi-task chapter pressure down to one primary hook when payoff already exists", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applySceneBudget: (input: {
        chapterGoal: {
          payoffToDeliver: string;
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        hookEmergence: {
          pressureStates: ReadonlyArray<unknown>;
          mustMaterializeHookNow: boolean;
          targetHook?: { hookId: string };
        };
        directives: {
          sceneDirective?: string;
        };
        language: "zh" | "en";
      }) => {
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        directives: {
          sceneDirective?: string;
        };
        mustAvoid: readonly string[];
      };
    }).applySceneBudget({
      chapterGoal: {
        payoffToDeliver: "完成第一次觉醒",
      },
      hookAgenda: {
        pressureMap: [
          { hookId: "H002" },
          { hookId: "H007" },
        ],
        mustAdvance: ["H002", "H007"],
        eligibleResolve: ["H007"],
        staleDebt: ["H002", "H007"],
        avoidNewHookFamilies: ["mystery"],
      },
      hookEmergence: {
        pressureStates: [],
        mustMaterializeHookNow: true,
        targetHook: { hookId: "H002" },
      },
      directives: {
        sceneDirective: "保留高压推进。",
      },
      language: "zh",
    });

    expect(governed.hookAgenda.mustAdvance).toEqual(["H002"]);
    expect(governed.hookAgenda.eligibleResolve).toEqual([]);
    expect(governed.hookAgenda.staleDebt).toEqual(["H002"]);
    expect(governed.hookAgenda.pressureMap).toEqual([{ hookId: "H002" }]);
    expect(governed.hookAgenda.avoidNewHookFamilies).toEqual(["mystery"]);
    expect(governed.directives.sceneDirective ?? "").toContain("Scene Budget");
    expect(governed.directives.sceneDirective ?? "").toContain("hook 推进只保留 H002");
    expect(governed.mustAvoid).toEqual(expect.arrayContaining([
      "本章不要并行推进多个 hook。",
      "本章不要安排多次场景/地点跳跃。",
      "本章不要堆叠多个高潮。",
    ]));
  });

  it("splits stacked climax beats when breakthrough payoff also tries to carry an identity reversal", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applyIntensityBudget: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          payoffToDeliver: string;
          nextChapterPull: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
          };
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        directives: {
          sceneDirective?: string;
        };
        language: "zh" | "en";
      }) => {
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        directives: {
          sceneDirective?: string;
        };
        conflict?: { type: string; resolution: string; detail?: string };
      };
    }).applyIntensityBudget({
      chapterGoal: {
        mainConflict: "楚夜即将觉醒，同时发现自己的真实身份不是凡人。",
        protagonistGoal: "完成觉醒并揭开身份反转。",
        payoffToDeliver: "觉醒",
        nextChapterPull: "身份反转的代价留到下一章。",
        payoffDirective: {
          promisedPayoff: "觉醒",
          payoffType: "breakthrough",
        },
      },
      hookAgenda: {
        pressureMap: [
          { hookId: "H002" },
          { hookId: "H007" },
        ],
        mustAdvance: ["H002", "H007"],
        eligibleResolve: ["H007"],
        staleDebt: ["H002", "H007"],
        avoidNewHookFamilies: [],
      },
      directives: {
        sceneDirective: "保持主线推进。",
      },
      language: "zh",
    });

    expect(governed.hookAgenda.mustAdvance).toEqual(["H002"]);
    expect(governed.hookAgenda.eligibleResolve).toEqual([]);
    expect(governed.hookAgenda.staleDebt).toEqual(["H002"]);
    expect(governed.hookAgenda.pressureMap).toEqual([{ hookId: "H002" }]);
    expect(governed.directives.sceneDirective ?? "").toContain("Intensity Budget");
    expect(governed.directives.sceneDirective ?? "").toContain("身份反转");
    expect(governed.directives.sceneDirective ?? "").toContain("多高潮已拆分");
    expect(governed.conflict).toEqual(expect.objectContaining({
      type: "intensity_budget_split",
    }));
  });

  it("keeps single payoff intensity budget unchanged when no competing climax is present", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applyIntensityBudget: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          payoffToDeliver: string;
          nextChapterPull: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
          };
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        directives: {
          sceneDirective?: string;
        };
        language: "zh" | "en";
      }) => {
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        directives: {
          sceneDirective?: string;
        };
        conflict?: { type: string };
      };
    }).applyIntensityBudget({
      chapterGoal: {
        mainConflict: "楚夜逼近觉醒临界。",
        protagonistGoal: "完成第一次觉醒。",
        payoffToDeliver: "觉醒",
        nextChapterPull: "觉醒后的代价浮出。",
        payoffDirective: {
          promisedPayoff: "觉醒",
          payoffType: "breakthrough",
        },
      },
      hookAgenda: {
        pressureMap: [{ hookId: "H002" }],
        mustAdvance: ["H002"],
        eligibleResolve: [],
        staleDebt: [],
        avoidNewHookFamilies: [],
      },
      directives: {
        sceneDirective: "保持单线推进。",
      },
      language: "zh",
    });

    expect(governed.hookAgenda.mustAdvance).toEqual(["H002"]);
    expect(governed.hookAgenda.pressureMap).toEqual([{ hookId: "H002" }]);
    expect(governed.directives.sceneDirective).toBe("保持单线推进。");
    expect(governed.conflict).toBeUndefined();
  });

  it("downgrades a must-resolve-now hook to soft-progress when a chapter payoff is present", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applyPayoffHookGovernance: (input: {
        chapterGoal: {
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
          };
        };
        directives: {
          sceneDirective?: string;
          hookExecutionPhase?: "any" | "late";
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string; movement?: string; pressure?: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        hookEmergence: {
          pressureStates: Array<{ hookId: string; state: string; timing: string; type: string; expectedPayoff: string; notes: string }>;
          mustMaterializeHookNow: boolean;
          targetHook?: { hookId: string };
        };
        language: "zh" | "en";
      }) => {
        directives: {
          sceneDirective?: string;
          hookExecutionPhase?: "any" | "late";
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string; movement?: string; pressure?: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        hookEmergence: {
          pressureStates: Array<{ hookId: string; state: string; timing: string; type: string; expectedPayoff: string; notes: string }>;
          mustMaterializeHookNow: boolean;
        };
        conflict?: { type: string };
      };
    }).applyPayoffHookGovernance({
      chapterGoal: {
        payoffToDeliver: "完成第一次觉醒",
        payoffDirective: {
          promisedPayoff: "完成第一次觉醒",
          payoffType: "breakthrough",
        },
      },
      directives: {
        sceneDirective: "保留主线推进。",
        hookExecutionPhase: "any",
      },
      hookAgenda: {
        pressureMap: [{ hookId: "H002", movement: "advance", pressure: "critical" }],
        mustAdvance: ["H002"],
        eligibleResolve: ["H002"],
        staleDebt: ["H002"],
        avoidNewHookFamilies: [],
      },
      hookEmergence: {
        pressureStates: [
          {
            hookId: "H002",
            state: "must-resolve-now",
            timing: "near-term",
            type: "poison-mystery",
            expectedPayoff: "发现压制毒性新方法",
            notes: "噬魂草毒性仍在扩散",
          },
        ],
        mustMaterializeHookNow: true,
        targetHook: { hookId: "H002" },
      },
      language: "zh",
    });

    expect(governed.hookEmergence.mustMaterializeHookNow).toBe(false);
    expect(governed.hookEmergence.pressureStates[0]?.state).toBe("soft-progress");
    expect(governed.hookAgenda.mustAdvance).toEqual([]);
    expect(governed.hookAgenda.eligibleResolve).toEqual([]);
    expect(governed.hookAgenda.staleDebt).toEqual(["H002"]);
    expect(governed.directives.hookExecutionPhase).toBeUndefined();
    expect(governed.directives.sceneDirective ?? "").toContain("payoff-hook-priority");
    expect(governed.directives.sceneDirective ?? "").toContain("不得与 payoff 同章 fully materialize");
    expect(governed.conflict).toEqual(expect.objectContaining({
      type: "payoff_hook_priority",
    }));
  });

  it("keeps must-resolve-now hook behavior unchanged when there is no payoff", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applyPayoffHookGovernance: (input: {
        chapterGoal: {
          payoffToDeliver: string;
        };
        directives: {
          sceneDirective?: string;
          hookExecutionPhase?: "any" | "late";
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string; movement?: string; pressure?: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        hookEmergence: {
          pressureStates: Array<{ hookId: string; state: string; timing: string; type: string; expectedPayoff: string; notes: string }>;
          mustMaterializeHookNow: boolean;
          targetHook?: { hookId: string };
        };
        language: "zh" | "en";
      }) => {
        directives: {
          sceneDirective?: string;
          hookExecutionPhase?: "any" | "late";
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string; movement?: string; pressure?: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        hookEmergence: {
          pressureStates: Array<{ hookId: string; state: string; timing: string; type: string; expectedPayoff: string; notes: string }>;
          mustMaterializeHookNow: boolean;
          targetHook?: { hookId: string };
        };
        conflict?: { type: string };
      };
    }).applyPayoffHookGovernance({
      chapterGoal: {
        payoffToDeliver: "",
      },
      directives: {
        sceneDirective: "保留主线推进。",
        hookExecutionPhase: "any",
      },
      hookAgenda: {
        pressureMap: [{ hookId: "H002", movement: "advance", pressure: "critical" }],
        mustAdvance: ["H002"],
        eligibleResolve: ["H002"],
        staleDebt: ["H002"],
        avoidNewHookFamilies: [],
      },
      hookEmergence: {
        pressureStates: [
          {
            hookId: "H002",
            state: "must-resolve-now",
            timing: "near-term",
            type: "poison-mystery",
            expectedPayoff: "发现压制毒性新方法",
            notes: "噬魂草毒性仍在扩散",
          },
        ],
        mustMaterializeHookNow: true,
        targetHook: { hookId: "H002" },
      },
      language: "zh",
    });

    expect(governed.hookEmergence.mustMaterializeHookNow).toBe(true);
    expect(governed.hookEmergence.pressureStates[0]?.state).toBe("must-resolve-now");
    expect(governed.hookAgenda.mustAdvance).toEqual(["H002"]);
    expect(governed.hookAgenda.eligibleResolve).toEqual(["H002"]);
    expect(governed.directives.hookExecutionPhase).toBe("any");
    expect(governed.directives.sceneDirective).toBe("保留主线推进。");
    expect(governed.conflict).toBeUndefined();
  });

  it("downgrades high-pressure payoffs when breath mode is active", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceBreathCompatiblePayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
        };
        directives: {
          chapterMode?: "breath" | "escalation" | "combat" | "reveal";
          moodDirective?: { targetMode: "breath" };
        };
        language: "zh" | "en";
        currentState: string;
      }) => {
        chapterGoal: {
          payoffToDeliver: string;
          nextChapterPull: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
          };
        };
        directiveNote?: string;
        conflict?: { type: string };
      };
    }).enforceBreathCompatiblePayoff({
      chapterGoal: {
        mainConflict: "地面阵纹亮起，规则压力笼罩全身。",
        protagonistGoal: "在风暴爆发前确认阵纹异常。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: [],
        payoffToDeliver: "地面阵纹亮起，规则压力笼罩全身",
        payoffDirective: {
          promisedPayoff: "地面阵纹亮起，规则压力笼罩全身",
          payoffType: "reversal",
          mandatoryByFinalAct: true,
        },
        endingHookType: "reveal",
        nextChapterPull: "风暴将至。",
      },
      directives: {
        chapterMode: "breath",
        moodDirective: { targetMode: "breath" },
      },
      language: "zh",
      currentState: "阵纹尚未完全激活。",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("阵纹微弱波动，尚未完全激活");
    expect(governed.chapterGoal.payoffDirective?.promisedPayoff).toBe("阵纹微弱波动，尚未完全激活");
    expect(governed.chapterGoal.payoffDirective?.payoffType).toBe("reveal");
    expect(governed.chapterGoal.nextChapterPull).toContain("不在本章完全爆发");
    expect(governed.directiveNote ?? "").toContain("breath-payoff-downgrade");
    expect(governed.directiveNote ?? "").toContain("不得在 scene1 fully materialize");
    expect(governed.conflict?.type).toBe("breath-payoff-downgrade");
  });

  it("keeps recovery payoffs unchanged in breath mode", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      enforceBreathCompatiblePayoff: (input: {
        chapterGoal: {
          mainConflict: string;
          protagonistGoal: string;
          activeCharacters: string[];
          foreshadowToTouch: string[];
          payoffToDeliver: string;
          payoffDirective?: {
            promisedPayoff: string;
            payoffType: "reveal" | "resource" | "breakthrough" | "relationship" | "reversal";
            mandatoryByFinalAct: boolean;
          };
          endingHookType: "danger" | "reveal" | "pursuit" | "choice" | "breakthrough";
          nextChapterPull: string;
        };
        directives: {
          chapterMode?: "breath" | "escalation" | "combat" | "reveal";
          moodDirective?: { targetMode: "breath" };
        };
        language: "zh" | "en";
        currentState: string;
      }) => { chapterGoal: { payoffToDeliver: string }; directiveNote?: string };
    }).enforceBreathCompatiblePayoff({
      chapterGoal: {
        mainConflict: "旧伤反复，必须先稳住气血。",
        protagonistGoal: "恢复伤势并讨论下一步。",
        activeCharacters: ["楚夜"],
        foreshadowToTouch: [],
        payoffToDeliver: "伤势被暂时稳住",
        payoffDirective: {
          promisedPayoff: "伤势被暂时稳住",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
        endingHookType: "reveal",
        nextChapterPull: "确认下一步路线。",
      },
      directives: {
        chapterMode: "breath",
        moodDirective: { targetMode: "breath" },
      },
      language: "zh",
      currentState: "旧伤仍在。",
    });

    expect(governed.chapterGoal.payoffToDeliver).toBe("伤势被暂时稳住");
    expect(governed.directiveNote).toBeUndefined();
  });

  it("keeps single-task chapter budget unchanged when there is no competing hook load", () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const governed = (planner as unknown as {
      applySceneBudget: (input: {
        chapterGoal: {
          payoffToDeliver: string;
        };
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        hookEmergence: {
          pressureStates: ReadonlyArray<unknown>;
          mustMaterializeHookNow: boolean;
          targetHook?: { hookId: string };
        };
        directives: {
          sceneDirective?: string;
        };
        language: "zh" | "en";
      }) => {
        hookAgenda: {
          pressureMap: Array<{ hookId: string }>;
          mustAdvance: string[];
          eligibleResolve: string[];
          staleDebt: string[];
          avoidNewHookFamilies: string[];
        };
        directives: {
          sceneDirective?: string;
        };
      };
    }).applySceneBudget({
      chapterGoal: {
        payoffToDeliver: "",
      },
      hookAgenda: {
        pressureMap: [{ hookId: "H002" }],
        mustAdvance: ["H002"],
        eligibleResolve: [],
        staleDebt: ["H002"],
        avoidNewHookFamilies: [],
      },
      hookEmergence: {
        pressureStates: [],
        mustMaterializeHookNow: true,
        targetHook: { hookId: "H002" },
      },
      directives: {
        sceneDirective: "保留单线推进。",
      },
      language: "zh",
    });

    expect(governed.hookAgenda.mustAdvance).toEqual(["H002"]);
    expect(governed.hookAgenda.staleDebt).toEqual(["H002"]);
    expect(governed.hookAgenda.pressureMap).toEqual([{ hookId: "H002" }]);
    expect(governed.directives.sceneDirective).toBe("保留单线推进。");
  });

  it("builds a structured chapter goal and writes it into the runtime intent", async () => {
    await writeFile(
      join(storyDir, "current_state.md"),
      [
        "# Current State",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Current Chapter | 2 |",
        "| Current Goal | Force one answer out of the vanished mentor's trail. |",
        "| Current Conflict | Lin Yue cannot chase the guild and settle the mentor debt at the same time. |",
        "",
      ].join("\n"),
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.chapterGoal).toEqual(expect.objectContaining({
      mainConflict: expect.stringContaining("mentor debt"),
      protagonistGoal: expect.stringContaining("answer"),
      foreshadowToTouch: expect.arrayContaining(["mentor-oath"]),
      payoffToDeliver: expect.stringContaining("mentor vanished"),
      payoffDirective: expect.objectContaining({
        promisedPayoff: expect.stringContaining("mentor vanished"),
        payoffDepth: "layered",
        payoffScope: "arc",
        mandatoryByFinalAct: false,
      }),
      maxRevealLayersPerChapter: 1,
      nextChapterPull: expect.any(String),
    }));
    expect(result.intentMarkdown).toContain("## Chapter Goal");
    expect(result.intentMarkdown).toContain("endingType");
    expect(result.intentMarkdown).not.toContain("endingHookType");
    expect(result.intentMarkdown).toContain("payoffDirective.promisedPayoff");
    expect(result.intentMarkdown).toContain("payoffDirective.payoffDepth: layered");
    expect(result.intentMarkdown).toContain("payoffDirective.payoffScope: arc");
    expect(result.intentMarkdown).toContain("maxRevealLayersPerChapter: 1");
    expect(result.intent.mustAvoid).toEqual(expect.arrayContaining([
      "本章禁止完全解释该 payoff，只允许 partial reveal（一层）。",
    ]));
  });

  it("keeps deep payoff directives chapter-scoped so full explanation can be allowed", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 2 |",
          "| Current Goal | Give the complete truth behind the vanished mentor case. |",
          "| Current Conflict | Lin Yue has one chance to expose the full chain now. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "mentor-truth",
            startChapter: 1,
            type: "mystery",
            status: "open",
            lastAdvancedChapter: 2,
            expectedPayoff: "Complete reveal: fully explain the mentor's disappearance.",
            notes: "Deliver the whole truth now.",
          },
        ], null, 2),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.chapterGoal?.payoffDirective).toEqual(expect.objectContaining({
      payoffDepth: "deep",
      payoffScope: "chapter",
      mandatoryByFinalAct: true,
    }));
    expect(result.intent.chapterGoal?.maxRevealLayersPerChapter).toBeUndefined();
  });

  it("filters non-character fragments and rejects numeric payoff values in chapter goal output", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "秦枭必须先脱离看守的佣兵追杀，赶到安全地点，再和碑灵确认下一步。",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 2 |",
          "| Current Goal | 秦枭先摆脱追兵，再和碑灵确认黑色古碑的代价。 |",
          "| Current Conflict | 秦枭刚反杀守卫，却还没有真正脱离追杀。 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "black-stele",
            startChapter: 1,
            type: "功法",
            status: "open",
            lastAdvancedChapter: 1,
            expectedPayoff: "15",
            notes: "黑色古碑真正的代价即将暴露。",
          },
        ], null, 2),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.chapterGoal?.activeCharacters).toEqual(expect.arrayContaining(["秦枭", "碑灵"]));
    expect(result.intent.chapterGoal?.activeCharacters).not.toEqual(expect.arrayContaining(["安全地点", "看守的佣"]));
    expect(result.intent.chapterGoal?.activeCharacters.every((item) => !item.includes("的"))).toBe(true);
    expect(result.intent.chapterGoal?.payoffToDeliver).not.toBe("15");
    expect(result.intent.chapterGoal?.nextChapterPull).not.toContain("：15");
    expect(result.intent.chapterGoal?.nextChapterPull).toContain("黑色古碑真正的代价即将暴露");
  });

  it("sanitizes chapter goal text and derives a concrete payoff instead of falling back to genre template phrasing", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "TODO",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "| Current Goal | TODO |",
          "| Current Conflict | 瘴气侵蚀（每刻钟-1气血） \\\\ |",
          "",
          "- 主角必须逃离瘴雾，并拿到黑市腰牌。",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 2",
          "主角必须逃离瘴雾，拿到黑市腰牌，再压住第一次反噬。",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "black-market-key",
            startChapter: 1,
            type: "身份",
            status: "open",
            lastAdvancedChapter: 1,
            expectedPayoff: "给读者一个看得见的即时收益：遭遇压制 -> 获得线索/资源/机缘 -> 冒险试错",
            notes: "Current Focus",
          },
        ], null, 2),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.chapterGoal?.mainConflict).toBe("瘴气侵蚀（每刻钟-1气血）");
    expect(result.intent.chapterGoal?.mainConflict).not.toContain("\\");
    expect(result.intent.chapterGoal?.protagonistGoal).not.toBe("TODO");
    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("给读者一个看得见的即时收益");
    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("遭遇压制 -> 获得线索/资源/机缘 -> 冒险试错");
    expect(result.intent.chapterGoal?.payoffToDeliver).toMatch(/拿到黑市腰牌|逃离瘴雾|压住第一次反噬/u);
    expect(result.intent.chapterGoal?.nextChapterPull).not.toContain("Current Focus");
    expect(result.intent.chapterGoal?.nextChapterPull).not.toContain("描述接下来1-3章");
  });

  it("hard-bans abstract payoff templates and still falls back to a relatively concrete result", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nTODO\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "| Current Goal | 有所推进 |",
          "| Current Conflict | 追兵压上来，洞口快被封死。 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 2",
          "楚夜必须先逃离追捕，再寻找下一条活路。",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "escape-line",
            startChapter: 1,
            type: "route",
            status: "open",
            lastAdvancedChapter: 1,
            expectedPayoff: "本章至少让主角获得一个可见资源、线索、脱身结果或战术优势。",
            notes: "给读者一个看得见的即时收益：遭遇压制 -> 获得线索/资源/机缘 -> 冒险试错。",
          },
        ], null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | 断尾夜奔 | 楚夜 | 楚夜被追兵逼入尸坑边缘。 | 暂无恢复 | none | 紧绷 | 逃亡 |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("给读者一个看得见的即时收益");
    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("本章至少让主角获得一个可见资源、线索、脱身结果或战术优势");
    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("有所推进");
    expect(result.intent.chapterGoal?.payoffToDeliver).toMatch(/逃离追捕|暂时脱离当前压制|拿到一个可持续使用的资源|获得一条明确逃生线索/u);
  });

  it("hard-bans payoff timing metadata and falls back to hook notes instead of timing labels", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nTODO\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "| Current Goal | TBD |",
          "| Current Conflict | 楚夜必须在追兵逼近前读懂卷轴异动。 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 2",
          "楚夜发现骸骨和卷轴，再顺着刻痕找到去路。",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "bone-scroll",
            startChapter: 1,
            type: "mystery",
            status: "open",
            lastAdvancedChapter: 1,
            expectedPayoff: "中期(5-10章)",
            payoffTiming: "short-term",
            notes: "关联蚀骨兽之谜",
          },
        ], null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | 尸坑卷轴 | 楚夜 | 发现骸骨和卷轴，追兵逼近。 | 卷轴异动加剧 | bone-scroll seeded | 紧绷 | 探索 |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("中期");
    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("5-10章");
    expect(result.intent.chapterGoal?.payoffToDeliver).not.toContain("short-term");
    expect(result.intent.chapterGoal?.payoffToDeliver).toMatch(/关联蚀骨兽之谜|发现骸骨和卷轴/u);
    expect(result.intent.chapterGoal?.nextChapterPull).not.toContain("中期");
    expect(result.intent.chapterGoal?.nextChapterPull).not.toContain("5-10章");
  });

  it("does not treat cave/object fragments like 骸骨 or 符文 as active characters", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "进入岩窟找到骸骨，符文浮现，主角必须继续前探。",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 1 |",
          "| Current Goal | 进入岩窟，找到出口。 |",
          "| Current Conflict | 岩窟里的瘴气和异响不断逼近。 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        "# Chapter Summaries\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.chapterGoal?.activeCharacters).not.toEqual(expect.arrayContaining(["到骸骨", "符文"]));
    expect(result.intent.chapterGoal?.activeCharacters).toEqual(["主角"]);
  });

  it("prefers structured chapter summary characters over noisy text slicing", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | 岩窟夜行 | 楚夜, 追兵 | 楚夜甩开追兵，摸进岩窟。 | 压力上升 | black-market-key advanced | 紧绷 | 逃亡 |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "进入岩窟找到骸骨，符文浮现，追兵的脚步正在逼近。",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.chapterGoal?.activeCharacters).toEqual(expect.arrayContaining(["楚夜", "追兵"]));
    expect(result.intent.chapterGoal?.activeCharacters).not.toEqual(expect.arrayContaining(["到骸骨", "符文"]));
  });

  it("prefers a matched outline node over ordinary current focus text", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "Pull the next chapter back toward the mentor fallout instead of the guild route.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 3",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("merchant guild's escape route");
    expect(result.intent.goal).not.toContain("mentor fallout");
    expect(result.intent.conflicts).toEqual([]);
  });

  it("lets explicit local override focus beat the matched outline node", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "Keep pressure on the guild route in the background.",
          "",
          "## Local Override",
          "",
          "Stay inside the mentor debt confrontation first and delay the canal pursuit by one chapter.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 3",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("mentor debt confrontation");
    expect(result.intent.goal).not.toContain("merchant guild's escape route");
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "outline_vs_current_focus",
        resolution: "allow explicit current focus override",
      }),
    ]));
  });

  it("deprioritizes a fallback outline node when recent state anchors the chapter elsewhere", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 3 |",
          "| Current Goal | Reach the black market entrance before the trackers close in. |",
          "| Current Conflict | Lin Yue has no safe retreat left after exposing the guild route. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Prison Cart | Lin Yue | Escapes the prison cart during a beast tide | None | none | desperate | opening |",
          "| 3 | Black Market Gate | Lin Yue | Finds the hidden entrance to the black market under the canal | No safe retreat remains | guild-route advanced | tense | transition |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Volume 1",
          "Escapes the prison cart during a beast tide and loots the first corpse.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.goal).toContain("black market entrance");
    expect(result.intent.goal).not.toContain("prison cart");
    expect(result.intent.outlineNode).toContain("black market");
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "outline_vs_recent_state",
        resolution: "prefer latest state continuity anchor",
      }),
    ]));
  });

  it("replaces a stale matched outline node when it regresses to an opening beat", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# Current State",
          "",
          "| Field | Value |",
          "| --- | --- |",
          "| Current Chapter | 3 |",
          "| Current Goal | Slip through the black market entrance and meet the broker. |",
          "| Current Conflict | Lin Yue exposed the guild route and can no longer return to the canal. |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Prison Cart | Lin Yue | Escapes the prison cart during a beast tide | None | none | desperate | opening |",
          "| 3 | Black Market Gate | Lin Yue | Reaches the hidden black market entrance under the canal | The retreat path is gone | guild-route advanced | tense | transition |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 4",
          "Escapes the prison cart during a beast tide and loots the first corpse.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.goal).toContain("black market entrance");
    expect(result.intent.goal).not.toContain("prison cart");
    expect(result.intent.outlineNode).toContain("black market entrance");
  });

  it("prefers latest runtime state snapshot over stale current_state markdown for next-chapter grounding", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# 当前状态",
          "",
          "| 字段 | 值 |",
          "| --- | --- |",
          "| 当前章节 | 28 |",
          "| 当前位置 | 药铺后院 |",
          "| 当前目标 | 回到药铺躲避追兵 |",
          "| 当前冲突 | 药铺掌柜起疑 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 29 | 暗河入口 | 楚夜 | 楚夜潜入黑石岭暗河入口并锁定黑市线。 | 无法回药铺，追兵封锁回路。 | hook_013 advanced | 紧绷 | transition |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 29,
          facts: [
            {
              subject: "protagonist",
              predicate: "当前位置",
              object: "黑石岭暗河",
              validFromChapter: 29,
              validUntilChapter: null,
              sourceChapter: 29,
            },
            {
              subject: "protagonist",
              predicate: "当前目标",
              object: "潜入黑石岭暗河并找到黑市入口",
              validFromChapter: 29,
              validUntilChapter: null,
              sourceChapter: 29,
            },
            {
              subject: "protagonist",
              predicate: "当前冲突",
              object: "暗河追兵已锁定痕迹，回撤路径被切断",
              validFromChapter: 29,
              validUntilChapter: null,
              sourceChapter: 29,
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 30\n回到药铺处理旧账。\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 30,
    });

    expect(result.intent.goal).toContain("黑石岭暗河");
    expect(result.intent.goal).not.toContain("药铺");
    expect(result.plannerInputs).toContain(join(storyDir, "state", "current_state.json"));
  });

  it("falls back to previous runtime context when snapshot is missing and markdown state is stale", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nTODO\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_state.md"),
        [
          "# 当前状态",
          "",
          "| 字段 | 值 |",
          "| --- | --- |",
          "| 当前章节 | 28 |",
          "| 当前位置 | 药铺后院 |",
          "| 当前目标 | 回到药铺躲避追兵 |",
          "| 当前冲突 | 药铺掌柜起疑 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "runtime", "chapter-0029.context.json"),
        JSON.stringify({
          chapter: 29,
          selectedContext: [
            {
              source: "story/current_state.md#当前位置",
              excerpt: "当前位置 | 黑石岭暗河",
            },
            {
              source: "story/current_state.md#当前目标",
              excerpt: "当前目标 | 潜入黑石岭暗河并找到黑市入口",
            },
            {
              source: "story/current_state.md#当前冲突",
              excerpt: "当前冲突 | 暗河追兵已锁定痕迹，回撤路径被切断",
            },
          ],
          chapterGoal: {
            protagonistGoal: "潜入黑石岭暗河并找到黑市入口",
            mainConflict: "暗河追兵已锁定痕迹，回撤路径被切断",
          },
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        "# Chapter Summaries\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 30\n回到药铺处理旧账。\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 30,
    });

    expect(result.intent.goal).toContain("黑石岭暗河");
    expect(result.intent.goal).not.toContain("药铺");
    expect(result.plannerInputs).toContain(join(storyDir, "runtime", "chapter-0029.context.json"));
  });

  it("triggers continuity goal override when requested goal regresses to opening events", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        "# Current Focus\n\nTODO\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | 押送兽潮 | 楚夜 | 楚夜在押送途中遭遇兽潮并趁乱逃脱。 | 初次逃亡 | none | 绝望 | opening |",
          "| 29 | 暗河入口 | 楚夜 | 楚夜潜入黑石岭暗河入口并锁定黑市线。 | 无法回药铺，追兵封锁回路。 | hook_013 advanced | 紧绷 | transition |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 29,
          facts: [
            {
              subject: "protagonist",
              predicate: "当前目标",
              object: "潜入黑石岭暗河并找到黑市入口",
              validFromChapter: 29,
              validUntilChapter: null,
              sourceChapter: 29,
            },
            {
              subject: "protagonist",
              predicate: "当前冲突",
              object: "暗河追兵已锁定痕迹，回撤路径被切断",
              validFromChapter: 29,
              validUntilChapter: null,
              sourceChapter: 29,
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 30\n回到押送现场重新经历兽潮。\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book: {
        ...book,
        language: "zh",
      },
      bookDir,
      chapterNumber: 30,
      externalContext: "本章回到押送途中遭遇兽潮并趁乱逃脱。",
    });

    expect(result.intent.goal).toContain("黑石岭暗河");
    expect(result.intent.goal).not.toContain("押送");
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "continuity_goal_override",
      }),
    ]));
  });

  it("keeps external context above both outline anchors and current focus", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "Pull the next chapter back toward the mentor fallout instead of the guild route.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 3",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: "Ignore the canal pursuit for now and force the next chapter into the mentor debt confrontation.",
    });

    expect(result.intent.goal).toContain("mentor debt confrontation");
    expect(result.intent.goal).not.toContain("merchant guild's escape route");
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "outline_vs_request",
        resolution: "allow local outline deferral",
      }),
    ]));
  });

  it("emits structured directives when fallback planning, chapter type repetition, and title collapse stack up", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 8",
          "Expose the registry clerk's hidden ledger in the floodgate archive.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Ledger in Rain | Taryn | Taryn checks the first false folio | None | hook advanced | tight | investigation |",
          "| 2 | Ledger at Dusk | Taryn | Taryn questions the dock clerk | None | hook advanced | tight | investigation |",
          "| 3 | Ledger Below | Taryn | Taryn searches the under-archive | None | hook advanced | tight | investigation |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.arcDirective).toContain("fallback");
    expect(result.intent.sceneDirective).toContain("investigation");
    expect(result.intent.titleDirective?.toLowerCase()).toContain("ledger");
    expect(result.intent.moodDirective).toBeUndefined();
  });

  it("emits a mood directive when recent chapters are all high-tension", async () => {
    book = {
      ...book,
      genre: "other",
      language: "zh",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 5\n进入新的地点。\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | 暗巷追踪 | 周谨川 | 追踪目标 | None | none | 紧张、压抑 | 悬念验证章 |",
          "| 2 | 旧楼对峙 | 周谨川 | 对峙 | None | none | 冷硬、逼仄 | 冲突章 |",
          "| 3 | 夜色围堵 | 周谨川 | 围堵 | None | none | 肃杀、凝重 | 追击章 |",
          "| 4 | 地下通道 | 周谨川 | 逃脱 | None | none | 压迫、窒息 | 逃亡章 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
    });

    expect(result.intent.moodDirective).toEqual(expect.objectContaining({
      targetMode: "breath",
      requiredSceneQuota: 1,
      moodCoverageMin: 0.3,
      forbidDominantMode: "combat-heavy",
      note: expect.stringContaining("降调"),
    }));
    expect(result.intent.moodDirective?.note).toContain("纯人物/恢复场景");
  });

  it("downgrades a high-intensity goal when breath mode is active", async () => {
    book = {
      ...book,
      genre: "other",
      language: "zh",
    };

    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 暗巷追踪 | 周谨川 | 追踪目标 | None | none | 紧张、压抑 | 冲突章 |",
        "| 2 | 旧楼对峙 | 周谨川 | 对峙升级 | None | none | 冷硬、逼仄 | 对抗章 |",
        "| 3 | 夜色围堵 | 周谨川 | 围堵压迫 | None | none | 肃杀、凝重 | 追击章 |",
        "| 4 | 地下通道 | 周谨川 | 逃脱冲突 | None | none | 压迫、窒息 | 逃亡章 |",
        "",
      ].join("\n"),
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
      externalContext: "生死抉择：选择谁先死。",
    });

    expect(result.intent.moodDirective?.targetMode).toBe("breath");
    expect(result.intent.goalIntensity).toBe("medium");
    expect(result.intent.goal).toContain("延后最终决断");
    expect(result.intent.mustAvoid).toEqual(expect.arrayContaining([
      "breath 章禁止生死抉择、终局对抗、核心反转、或必须立即行动的危机目标。",
    ]));
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "goal_mood_arbitration" }),
    ]));
  });

  it("keeps low-intensity recovery/planning goals intact in breath mode", async () => {
    book = {
      ...book,
      genre: "other",
      language: "zh",
    };

    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 暗巷追踪 | 周谨川 | 追踪目标 | None | none | 紧张、压抑 | 冲突章 |",
        "| 2 | 旧楼对峙 | 周谨川 | 对峙升级 | None | none | 冷硬、逼仄 | 对抗章 |",
        "| 3 | 夜色围堵 | 周谨川 | 围堵压迫 | None | none | 肃杀、凝重 | 追击章 |",
        "| 4 | 地下通道 | 周谨川 | 逃脱冲突 | None | none | 压迫、窒息 | 逃亡章 |",
        "",
      ].join("\n"),
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
      externalContext: "先休整并讨论是否继续深入。",
    });

    expect(result.intent.moodDirective?.targetMode).toBe("breath");
    expect(result.intent.goalIntensity).toBe("low");
    expect(result.intent.goal).toContain("先休整并讨论是否继续深入");
    expect(result.intent.goal).not.toContain("延后最终决断");
    expect(result.intent.conflicts).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ type: "goal_mood_arbitration" }),
    ]));
  });

  it("forces escalation after two consecutive breathing chapters", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "- Reveal what is hidden behind the archive seal before opening any new subplot.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "## Chapter 10",
          "Move the search toward the floodgate archive.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 5 | Cold Ferry | Taryn | Checks old clues | None | none | calm | investigation |",
          "| 6 | Slow Rain | Taryn | Waits for a contact | None | none | muted | fallout |",
          "| 7 | Quiet Dock | Taryn | Keeps watch by the gate | None | none | subdued | fallout |",
          "| 8 | Lantern Break | Taryn | Takes a quiet meal and regroups | None | none | soft | 日常/喘息、温情 |",
          "| 9 | Warm Ash | Taryn | Rests with the crew and tends bruises | None | none | warm | 日常/喘息、温情 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 10,
    });

    expect(result.intent.chapterMode).toBe("escalation");
    expect(result.intent.moodDirective).toBeUndefined();
    expect(result.intent.sceneDirective).toContain("Force tension escalation this chapter.");
    expect(result.intentMarkdown).toContain("Force tension escalation this chapter.");
    expect(result.intentMarkdown).toContain("Do not produce a third consecutive breathing chapter.");
    expect(result.intent.sceneDirective).toContain("Force chapter type: escalation / confrontation / discovery-under-threat.");
    expect(result.intent.mustAvoid).toEqual(expect.arrayContaining([
      "Do not produce a third consecutive breathing chapter.",
      "Avoid another daily / recovery / bonding-only chapter shell.",
    ]));
    expect(result.intent.chapterGoal?.endingHookType).not.toBe("reveal");
    expect(["danger", "pursuit", "breakthrough"]).toContain(result.intent.chapterGoal?.endingHookType);
  });

  it("removes escalation directives when breath mode is active to keep chapter mode mutually exclusive", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 10\nHold position and recover near the archive gate.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 6 | Cold Drum | Taryn | Holds the outer line | None | none | tense | 日常/喘息、温情 |",
          "| 7 | Narrow Light | Taryn | Tends injuries at a hidden camp | None | none | grim | 日常/喘息、温情 |",
          "| 8 | Ash Bowl | Taryn | Regroups and shares supplies | None | none | oppressive | 日常/喘息、温情 |",
          "| 9 | Quiet Stairs | Taryn | Discusses next move before departure | None | none | tense | 日常/喘息、温情 |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 10,
    });

    expect(result.intent.chapterMode).toBe("breath");
    expect(result.intent.moodDirective?.targetMode).toBe("breath");
    expect(result.intent.sceneDirective ?? "").not.toContain("Force tension escalation this chapter.");
    expect(result.intent.sceneDirective ?? "").not.toContain("Force chapter type: escalation / confrontation / discovery-under-threat.");
    expect(result.intentMarkdown).toContain("chapterMode: breath");
    expect(result.intentMarkdown).not.toContain("Force tension escalation this chapter.");
  });

  it("rotates endingType when the previous chapter used the same unresolved ending shell", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "runtime", "chapter-0009.intent.md"),
        [
          "# Chapter Intent",
          "",
          "## Structured Directives",
          "- chapterMode: escalation",
          "- endingType: unresolved_end",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 8 | Cold Ferry | Taryn | Holds the outer line | None | none | tense | confrontation |",
          "| 9 | Narrow Light | Taryn | Keeps pressure on the gate | None | none | grim | confrontation |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 10,
      externalContext: "Force direct confrontation and keep pressure on the gate.",
    });

    expect(result.intent.endingType).not.toBe("unresolved_end");
    expect(["calm_end", "reveal_end", "resolution_end", "twist_end"]).toContain(result.intent.endingType);
  });

  it("keeps endingType non-repeating across a five-chapter window", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Start | Taryn | Starts the route | None | none | mixed | transition |",
          "| 2 | Bridge | Taryn | Keeps moving | None | none | mixed | transition |",
          "| 3 | Gate | Taryn | Watches the archive gate | None | none | mixed | transition |",
          "| 4 | Anchor | Taryn | Stabilizes supplies | None | none | mixed | transition |",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const endingTypes: string[] = [];
    for (const chapterNumber of [5, 6, 7, 8, 9]) {
      const result = await planner.planChapter({
        book,
        bookDir,
        chapterNumber,
      });
      endingTypes.push(result.intent.endingType ?? "");
    }

    expect(endingTypes.every((item) => item.length > 0)).toBe(true);
    expect(new Set(endingTypes).size).toBe(5);
  });

  it("does not emit a mood directive when recent moods are varied", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n\n## Chapter 5\nMove to the harbor.\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Morning Calm | Taryn | A quiet walk | None | none | warm, gentle | slice-of-life |",
          "| 2 | Sudden Rain | Taryn | Storm arrives | None | none | tense, ominous | tension |",
          "| 3 | Harbor Light | Taryn | Finds shelter | None | none | hopeful, light | transition |",
          "| 4 | The Letter | Taryn | Reads bad news | None | none | melancholy, reflective | introspection |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
    });

    expect(result.intent.moodDirective).toBeUndefined();
  });

  it("ignores the default current_focus placeholder and falls back to author intent when no chapter outline is available", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.goal).toContain("mentor-student bond");
    expect(result.intent.goal).not.toContain("Describe what the next 1-3 chapters should prioritize");
  });

  it("uses bullet-style volume outline chapter nodes as the fallback goal when control docs are placeholders", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "## Volume 1",
          "**Chapter range:** 1-8",
          "",
          "**Key turning points:**",
          "- **Chapter 3:** Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("merchant guild's escape route");
    expect(result.intent.goal).not.toContain("Advance chapter 3 with clear narrative focus.");
  });

  it("uses the next paragraph for bold standalone English chapter labels instead of capturing markdown markers", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "## Volume 1 - The Dead Examiner",
          "**Chapter Range:** 1-12",
          "",
          "**Key Turning Points:**",
          "- Ch1: Renn dies after summoning Taryn to review irregular treaty folios.",
          "",
          "### Golden First Three Chapters Rule",
          "",
          "**Chapter 2:**",
          "Show Taryn's edge through action, not exposition. He uses registry numbering logic to identify which folios are decoys and which conceal a ledger fragment.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.outlineNode).toContain("Show Taryn's edge through action");
    expect(result.intent.outlineNode).not.toBe("**");
    expect(result.intent.goal).toContain("Show Taryn's edge through action");
    expect(result.intent.goal).not.toBe("**");
  });

  it("does not confuse Chapter 1 with Chapter 10 when matching exact English chapter labels", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "### Chapter 10",
          "This late-volume node should not be selected for chapter one.",
          "",
          "### Chapter 1",
          "Open with the dead examiner and the sealed folio dispute.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 1,
    });

    expect(result.intent.outlineNode).toContain("dead examiner");
    expect(result.intent.outlineNode).not.toContain("late-volume");
    expect(result.intent.goal).toContain("dead examiner");
  });

  it("uses inline Chinese exact chapter labels with a title suffix", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "第 7 章：在码头接头并截住逃跑账房。",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 7,
    });

    expect(result.intent.outlineNode).toContain("在码头接头");
    expect(result.intent.goal).toContain("在码头接头");
    expect(result.intent.goal).not.toContain("Describe the long-horizon vision");
  });

  it("uses standalone Chinese chapter-range labels when the chapter falls inside the range", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "第1-6章",
          "Stay with the early city setup and mentor fallout.",
          "",
          "第7-20章",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 7,
    });

    expect(result.intent.outlineNode).toContain("merchant guild's escape route");
    expect(result.intent.goal).toContain("merchant guild's escape route");
    expect(result.intent.goal).not.toContain("Describe the long-horizon vision");
  });

  it("uses standalone English chapter-range labels at the start of the range", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "Chapter 1-3",
          "Keep the opening pressure on the first examiner.",
          "",
          "Chapter 4-6",
          "Recover the sealed ledger before dawn.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.outlineNode).toContain("sealed ledger");
    expect(result.intent.goal).toContain("sealed ledger");
    expect(result.intent.outlineNode).not.toContain("6");
    expect(result.intent.goal).not.toContain("Describe the long-horizon vision");
  });

  it("uses the next paragraph for bold standalone English chapter-range labels instead of bleeding into the next range", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "**Chapter 1-3:**",
          "Keep the opening pressure on the first examiner.",
          "",
          "**Chapter 4-6:**",
          "Recover the sealed ledger before dawn.",
          "",
          "**Chapter 7-9:**",
          "Trigger the registry fire and expose the false witness.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 4,
    });

    expect(result.intent.outlineNode).toContain("sealed ledger");
    expect(result.intent.outlineNode).not.toContain("registry fire");
    expect(result.intent.goal).toContain("sealed ledger");
  });

  it("falls back to the first outline directive when no standalone range matches", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "author_intent.md"),
        "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n",
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "(Describe what the next 1-3 chapters should prioritize.)",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "第1-6章",
          "Stay with the early city setup and mentor fallout.",
          "",
          "第7-20章",
          "Track the merchant guild's escape route through the western canal.",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 25,
    });

    expect(result.intent.outlineNode).toContain("Stay with the early city setup");
    expect(result.intent.goal).toContain("Stay with the early city setup");
    expect(result.intent.outlineNode).not.toBe("第1-6章");
    expect(result.intent.goal).not.toContain("merchant guild's escape route");
  });

  it("preserves hard facts from state and canon in mustKeep", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
    });

    expect(result.intent.mustKeep).toContain("Lin Yue still hides the broken oath token.");
    expect(result.intent.mustKeep).toContain("The jade seal cannot be destroyed.");
  });

  it("records conflicts when the external request diverges from the outline", async () => {
    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 3,
      externalContext: "Ignore the guild chase and bring the focus back to mentor conflict.",
    });

    expect(result.intent.conflicts).toHaveLength(1);
    expect(result.intent.conflicts[0]?.type).toBe("outline_vs_request");
    await expect(readFile(result.runtimePath, "utf-8")).resolves.toContain("outline_vs_request");
  });

  it("writes compact memory snapshots instead of inlining the full history", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| guild-route | 1 | mystery | open | 2 | 6 | Merchant guild trail |",
          "| mentor-oath | 8 | relationship | open | 9 | 11 | Mentor oath debt with Lin Yue |",
          "| old-seal | 3 | artifact | resolved | 3 | 3 | Jade seal already recovered |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 1 | Guild Trail | Merchant guild flees west | Route clues only | None | guild-route seeded | tense | action |",
          "| 2 | City Watch | Patrols sweep the market | Search widens | None | guild-route advanced | urgent | investigation |",
          "| 3 | Seal Vault | Lin Yue finds the seal vault | The jade seal returns | Seal secured | old-seal resolved | solemn | reveal |",
          "| 4 | Empty Road | The group loses the convoy | Doubts grow | Travel fatigue | none | grim | travel |",
          "| 5 | Burned Shrine | Shrine clues point nowhere | Friction rises | Lin Yue distrusts allies | none | bitter | setback |",
          "| 6 | Quiet Ledger | Merchant records stay hidden | No breakthrough | Cash runs thin | none | weary | transition |",
          "| 7 | Broken Letter | A torn letter mentions the mentor | Suspicion returns | Lin Yue reopens the old oath | mentor-oath seeded | uneasy | mystery |",
          "| 8 | River Camp | Lin Yue meets old witnesses | Mentor debt becomes personal | Lin Yue cannot let go | mentor-oath advanced | raw | confrontation |",
          "| 9 | Trial Echo | The trial fallout resurfaces | Mentor left without explanation | Oath token matters again | mentor-oath advanced | aching | fallout |",
          "| 10 | Locked Gate | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | Oath token is still hidden | mentor-oath advanced | focused | decision |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 11,
      externalContext: "Bring the focus back to the mentor oath conflict with Lin Yue.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("mentor-oath");
    expect(intentMarkdown).toContain("| 10 | Locked Gate |");
    expect(intentMarkdown).not.toContain("| 1 | Guild Trail |");
    expect(intentMarkdown).not.toContain("| old-seal | 3 | artifact | resolved |");
  });

  it("renders English memory snapshot headers for English books", async () => {
    book = {
      ...book,
      genre: "other",
      language: "en",
    };
    await Promise.all([
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-oath | 8 | relationship | open | 9 | 11 | Mentor oath debt with Lin Yue |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 10 | Locked Gate | Lin Yue | Lin Yue chooses the mentor line over the guild line | Mentor conflict takes priority | mentor-oath advanced | focused | decision |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 11,
      externalContext: "Bring the focus back to the mentor oath conflict with Lin Yue.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("| hook_id | start_chapter | type | status | last_advanced | expected_payoff | payoff_timing | notes |");
    expect(intentMarkdown).toContain("| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |");
    expect(intentMarkdown).not.toContain("| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |");
    expect(intentMarkdown).not.toContain("| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |");
  });

  it("derives structured current_focus markdown into goal, avoids, and style emphasis", async () => {
    await Promise.all([
      writeFile(
        join(storyDir, "current_focus.md"),
        [
          "# Current Focus",
          "",
          "## Active Focus",
          "",
          "- Bring the focus back to Lin Yue's private confrontation with the mentor debt.",
          "- Keep the chapter centered on a missing record, not a whole-conspiracy overview.",
          "- Surface one concrete evidence trail the next chapter can pursue.",
          "",
          "## Avoid",
          "",
          "- Do not turn this chapter into a citywide survey of every faction.",
          "- Do not use summary-heavy moralizing paragraphs.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "story_bible.md"),
        [
          "# Story Bible",
          "",
          "- --",
          "- The jade seal cannot be destroyed.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "volume_outline.md"),
        "# Volume Outline\n",
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 2,
    });

    expect(result.intent.goal).toContain("private confrontation");
    expect(result.intent.goal).toContain("missing record");
    expect(result.intent.mustAvoid).toEqual(expect.arrayContaining([
      "Do not turn this chapter into a citywide survey of every faction.",
      "Do not use summary-heavy moralizing paragraphs.",
    ]));
    expect(result.intent.mustAvoid).not.toContain(
      "Keep the chapter centered on a missing record, not a whole-conspiracy overview.",
    );
    expect(result.intent.styleEmphasis).toEqual(expect.arrayContaining([
      "Bring the focus back to Lin Yue's private confrontation with the mentor debt.",
      "Surface one concrete evidence trail the next chapter can pursue.",
    ]));
    expect(result.intent.mustKeep).not.toContain("--");
  });

  it("emits hook agenda into chapter intent and runtime markdown", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 4 | Ash Oath | Lin Yue | Lin Yue reopened the old oath line. | Mentor debt pressed harder. | opened new route hook | grim | fallout |",
          "| 5 | Cold Token | Lin Yue | The oath token kept pulling Lin Yue back. | Debt pressure intensified. | seeded another new hook | tense | mainline |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 23,
              type: "route",
              status: "open",
              lastAdvancedChapter: 25,
              expectedPayoff: "Recent route payoff",
              notes: "Recent route remains active.",
            },
            {
              hookId: "ready-payoff",
              startChapter: 12,
              type: "mystery",
              status: "progressing",
              lastAdvancedChapter: 24,
              expectedPayoff: "Reveal the hidden room mastermind",
              notes: "The chapter is close to the reveal point.",
            },
            {
              hookId: "stale-debt",
              startChapter: 3,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Mentor debt payoff",
              notes: "Long-stale but still unresolved.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 26,
      externalContext: "Keep the chapter on the mainline debt conflict.",
    });

    expect(result.intent.hookAgenda.mustAdvance).toEqual([]);
    expect(result.intent.hookAgenda.eligibleResolve).toEqual([]);
    expect(result.intent.hookAgenda.staleDebt).toEqual(["stale-debt"]);
    expect(result.intent.hookAgenda.avoidNewHookFamilies).toContain("relationship");
    expect(result.intent.hookAgenda.pressureMap).toEqual([]);
    expect(result.intent.sceneDirective ?? "").toContain("payoff-hook-priority");

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("## Hook Agenda");
    expect(intentMarkdown).toContain("ready-payoff");
    expect(intentMarkdown).toContain("stale-debt");
  });

  it("builds stale debt agenda from broader active hooks than the retrieval subset", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "recent-route",
              startChapter: 23,
              type: "route",
              status: "open",
              lastAdvancedChapter: 25,
              expectedPayoff: "Recent route payoff",
              notes: "Keep the route central.",
            },
            {
              hookId: "recent-guild",
              startChapter: 22,
              type: "politics",
              status: "progressing",
              lastAdvancedChapter: 24,
              expectedPayoff: "Guild pressure payoff",
              notes: "Guild pressure remains active.",
            },
            {
              hookId: "recent-token",
              startChapter: 21,
              type: "artifact",
              status: "open",
              lastAdvancedChapter: 23,
              expectedPayoff: "Token route payoff",
              notes: "Token route remains active.",
            },
            {
              hookId: "stale-omega",
              startChapter: 3,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 8,
              expectedPayoff: "Old debt payoff",
              notes: "Dormant unresolved line.",
            },
            {
              hookId: "stale-sable",
              startChapter: 4,
              type: "mystery",
              status: "open",
              lastAdvancedChapter: 9,
              expectedPayoff: "Archive payoff",
              notes: "Another dormant unresolved line.",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 26,
      externalContext: "Keep the chapter on the route pressure.",
    });

    expect(result.intent.hookAgenda.mustAdvance).toEqual([]);
    expect(result.intent.hookAgenda.staleDebt).toEqual(["stale-omega"]);
    expect(result.intent.hookAgenda.avoidNewHookFamilies).toEqual(expect.arrayContaining([
      "relationship",
      "mystery",
    ]));
    expect(result.intent.hookAgenda.pressureMap).toEqual([]);
  });

  it("renders hook budget from total active hooks instead of the selected hook snapshot", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    const hooks = Array.from({ length: 12 }, (_, index) => ({
      hookId: `hook-${index + 1}`,
      startChapter: index + 1,
      type: index < 6 ? "route" : "mystery",
      status: "open",
      lastAdvancedChapter: index < 6 ? 25 - index : 12 - index,
      expectedPayoff: index < 6 ? "Route debt payoff" : "Dormant mystery payoff",
      notes: index < 6
        ? `Route pressure thread ${index + 1} stays relevant.`
        : `Dormant thread ${index + 1} should not be selected into the primary context.`,
    }));

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 25,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 25,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({ hooks }, null, 2),
        "utf-8",
      ),
    ]);

    book = {
      ...book,
      genre: "other",
      language: "en",
      targetChapters: 40,
    };

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 26,
      externalContext: "Keep the chapter on the route pressure.",
    });

    const intentMarkdown = await readFile(result.runtimePath, "utf-8");
    expect(intentMarkdown).toContain("12 active hooks");
    expect(intentMarkdown).not.toContain("8 active hooks");
  });

  it("throttles new hook appetite when hook debt is already over cap and keeps an old debt target", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    const hooks = Array.from({ length: 13 }, (_, index) => ({
      hookId: `old-debt-${index + 1}`,
      startChapter: index + 1,
      type: index === 0 ? "relationship" : "mystery",
      status: "open",
      lastAdvancedChapter: index === 0 ? 2 : Math.max(1, 8 - index),
      expectedPayoff: index === 0
        ? "Reveal why the mentor broke the oath."
        : `Unpaid debt payoff ${index + 1}.`,
      notes: index === 0
        ? "Mentor oath debt is pressing again."
        : `Dormant unresolved thread ${index + 1}.`,
    }));

    await Promise.all([
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 5,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 5,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [
            {
              chapter: 4,
              title: "Ash Oath",
              characters: "Lin Yue",
              events: "Lin Yue reopened the old oath line.",
              stateChanges: "Mentor debt pressed harder.",
              hookActivity: "opened new route hook",
              mood: "grim",
              chapterType: "fallout",
            },
            {
              chapter: 5,
              title: "Cold Token",
              characters: "Lin Yue",
              events: "The oath token kept pulling Lin Yue back.",
              stateChanges: "Debt pressure intensified.",
              hookActivity: "seeded another new hook",
              mood: "tense",
              chapterType: "mainline",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({ hooks }, null, 2),
        "utf-8",
      ),
    ]);

    book = {
      ...book,
      genre: "other",
      language: "en",
    };

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 6,
      externalContext: "Keep the chapter on the oldest mentor debt instead of opening side mysteries.",
    });

    expect(result.intent.mustAvoid).toEqual(expect.arrayContaining([
      "Do not open more than 1 new hook family this chapter.",
    ]));
    expect(result.intent.chapterGoal?.foreshadowToTouch?.length ?? 0).toBeGreaterThan(0);
    expect([
      "mentor-oath",
      "old-debt-1",
      "old-debt-2",
    ]).toContain(result.intent.chapterGoal?.foreshadowToTouch?.[0] ?? "");
    expect(result.intent.conflicts).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ type: "hook_debt_throttle" }),
      ]),
    );
  });

  it("downgrades overdue hooks to soft-progress in chapter intent markdown when payoff is present", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "H002",
            startChapter: 2,
            type: "poison-mystery",
            status: "open",
            lastAdvancedChapter: 3,
            expectedPayoff: "发现压制毒性新方法",
            payoffTiming: "near-term",
            notes: "噬魂草毒性仍在扩散",
          },
        ], null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 6 | 毒性未止 | 楚夜 | 噬魂草仍在侵蚀 | 毒性扩散 | H002 stalled | 紧张 | confrontation |",
          "| 7 | 逼近的余毒 | 楚夜 | 噬魂草继续恶化 | 仍无解法 | H002 stalled | 压迫 | confrontation |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "zh",
          lastAppliedChapter: 7,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 7,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [
            {
              chapter: 6,
              title: "毒性未止",
              characters: "楚夜",
              events: "噬魂草仍在侵蚀",
              stateChanges: "毒性扩散",
              hookActivity: "H002 stalled",
              mood: "紧张",
              chapterType: "confrontation",
            },
            {
              chapter: 7,
              title: "逼近的余毒",
              characters: "楚夜",
              events: "噬魂草继续恶化",
              stateChanges: "仍无解法",
              hookActivity: "H002 stalled",
              mood: "压迫",
              chapterType: "confrontation",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "H002",
              startChapter: 2,
              type: "poison-mystery",
              status: "open",
              lastAdvancedChapter: 3,
              expectedPayoff: "发现压制毒性新方法",
              payoffTiming: "near-term",
              notes: "噬魂草毒性仍在扩散",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 8,
    });

    expect(result.intentMarkdown).toContain("### Hook Pressure States");
    expect(result.intentMarkdown).toContain("H002: soft-progress");
    expect(result.intentMarkdown).toContain("mustMaterializeHookNow: false");
    expect(result.intentMarkdown).not.toContain("targetHookId: H002");
    expect(result.intentMarkdown).toContain("payoff-hook-priority");
  });

  it("downgrades must-resolve hooks to soft-progress when breath mood is active", async () => {
    const stateDir = join(storyDir, "state");
    await mkdir(stateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(storyDir, "foreshadow_registry.json"),
        JSON.stringify([
          {
            hookId: "H002",
            startChapter: 2,
            type: "poison-mystery",
            status: "open",
            lastAdvancedChapter: 3,
            expectedPayoff: "发现压制毒性新方法",
            payoffTiming: "near-term",
            notes: "噬魂草毒性仍在扩散",
          },
        ], null, 2),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| 5 | 血线难收 | 楚夜 | 血战继续扩大 | 压力攀升 | H002 stalled | 压迫 | confrontation |",
          "| 6 | 毒性未止 | 楚夜 | 噬魂草仍在侵蚀 | 毒性扩散 | H002 stalled | 紧张 | confrontation |",
          "| 7 | 逼近的余毒 | 楚夜 | 噬魂草继续恶化 | 仍无解法 | H002 stalled | 压迫 | confrontation |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "zh",
          lastAppliedChapter: 7,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "current_state.json"),
        JSON.stringify({
          chapter: 7,
          facts: [],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "chapter_summaries.json"),
        JSON.stringify({
          rows: [
            {
              chapter: 5,
              title: "血线难收",
              characters: "楚夜",
              events: "血战继续扩大",
              stateChanges: "压力攀升",
              hookActivity: "H002 stalled",
              mood: "压迫",
              chapterType: "confrontation",
            },
            {
              chapter: 6,
              title: "毒性未止",
              characters: "楚夜",
              events: "噬魂草仍在侵蚀",
              stateChanges: "毒性扩散",
              hookActivity: "H002 stalled",
              mood: "紧张",
              chapterType: "confrontation",
            },
            {
              chapter: 7,
              title: "逼近的余毒",
              characters: "楚夜",
              events: "噬魂草继续恶化",
              stateChanges: "仍无解法",
              hookActivity: "H002 stalled",
              mood: "压迫",
              chapterType: "confrontation",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
      writeFile(
        join(stateDir, "hooks.json"),
        JSON.stringify({
          hooks: [
            {
              hookId: "H002",
              startChapter: 2,
              type: "poison-mystery",
              status: "open",
              lastAdvancedChapter: 3,
              expectedPayoff: "发现压制毒性新方法",
              payoffTiming: "near-term",
              notes: "噬魂草毒性仍在扩散",
            },
          ],
        }, null, 2),
        "utf-8",
      ),
    ]);

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 8,
    });

    expect(result.intent.moodDirective?.targetMode).toBe("breath");
    expect(result.intent.hookExecutionPhase).toBeUndefined();
    expect(result.intent.directivePriority?.ordered).toEqual([
      "mood-structure",
      "scene-plan",
      "payoff",
      "hook-emergence",
    ]);
    expect(result.intentMarkdown).toContain("H002: soft-progress");
    expect(result.intentMarkdown).toContain("mustMaterializeHookNow: false");
    expect(result.intentMarkdown).not.toContain("hookExecutionPhase: late");
    expect(result.intentMarkdown).not.toContain("targetHookId: H002");
    expect(result.intentMarkdown).toContain("breath-hook-downgrade");
    expect(result.intent.sceneDirective).toContain("minor signal");
    expect(result.intent.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "breath_hook_downgrade" }),
    ]));
    expect(result.intentMarkdown).toContain("directivePriority:");
  });

  it("forces a pure character scene first when breath mode is active", async () => {
    book = {
      ...book,
      genre: "other",
      language: "zh",
    };

    await writeFile(
      join(storyDir, "chapter_summaries.md"),
      [
        "# Chapter Summaries",
        "",
        "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 暗巷追踪 | 周谨川 | 追踪目标 | None | none | 紧张、压抑 | 冲突章 |",
        "| 2 | 旧楼对峙 | 周谨川 | 对峙升级 | None | none | 冷硬、逼仄 | 对抗章 |",
        "| 3 | 夜色围堵 | 周谨川 | 围堵压迫 | None | none | 肃杀、凝重 | 追击章 |",
        "| 4 | 地下通道 | 周谨川 | 逃脱冲突 | None | none | 压迫、窒息 | 逃亡章 |",
        "",
      ].join("\n"),
      "utf-8",
    );

    const planner = new PlannerAgent({
      client: {} as ConstructorParameters<typeof PlannerAgent>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId: book.id,
    });

    const result = await planner.planChapter({
      book,
      bookDir,
      chapterNumber: 5,
    });

    expect(result.intent.moodDirective?.scenePlan?.scene1 ?? "").toContain("纯人物");
    expect(result.intent.sceneDirective ?? "").toContain("禁止 hook 推进、新威胁、规则压力、风暴爆发");
    expect(result.intent.sceneDirective ?? "").toContain("scene2 才允许低强度推进");
  });
});
