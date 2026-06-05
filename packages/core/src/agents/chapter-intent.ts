import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { SIX_STEP_PLOT_METHOD } from "../story-methods/six-step-plot.js";
import {
  renderResourcePlanForPrompt,
  sanitizeIntentAgainstResourcePlan,
  validateIntentAgainstResourcePlan,
  type ChapterResourcePlan,
} from "./resource-plan.js";

export interface ChapterIntentInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly plannerIntent?: string;
  readonly resourcePlan?: ChapterResourcePlan;
}

export interface ChapterIntentResult {
  readonly chapterNumber: number;
  readonly content: string;
  readonly runtimePath: string;
  readonly isFallback?: boolean;
}

interface ChapterIntentContext {
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly genreArchitecture: string;
  readonly worldEngine: string;
  readonly antagonistMap: string;
  readonly motivationMatrix: string;
  readonly first10ChapterPlan: string;
  readonly currentFocus: string;
  readonly characterMatrix: string;
  readonly emotionalArcs: string;
  readonly subplotBoard: string;
  readonly recentChapters: string;
  readonly first10PlanLine: string;
}

export class ChapterIntentAgent extends BaseAgent {
  get name(): string {
    return "chapter-intent";
  }

  async generate(input: ChapterIntentInput): Promise<ChapterIntentResult> {
    const runtimeDir = join(input.bookDir, "story", "runtime", "chapter-intents");
    await mkdir(runtimeDir, { recursive: true });
    const runtimePath = join(runtimeDir, `${String(input.chapterNumber).padStart(4, "0")}.md`);
    const context = await this.loadContext(input.bookDir, input.chapterNumber);

    try {
      let content = "";
      let violations: ReadonlyArray<string> = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await this.chat(
          [
            { role: "system", content: this.buildSystemPrompt(input.book.language ?? "zh") },
            {
              role: "user",
              content: this.buildUserPrompt({
                book: input.book,
                chapterNumber: input.chapterNumber,
                plannerIntent: input.plannerIntent,
                context,
                resourcePlan: input.resourcePlan,
                previousResourcePlanViolations: violations,
              }),
            },
          ],
          { temperature: attempt === 0 ? 0.35 : 0.2, maxTokens: 4096 },
        );
        content = this.normalizeMarkdown(response.content);
        const validation = input.resourcePlan
          ? validateIntentAgainstResourcePlan(content, input.resourcePlan)
          : { ok: true, violations: [] };
        if (validation.ok) break;
        violations = validation.violations;
      }
      if (input.resourcePlan) {
        const validation = validateIntentAgainstResourcePlan(content, input.resourcePlan);
        if (!validation.ok) {
          content = sanitizeIntentAgainstResourcePlan(content, input.resourcePlan);
        }
      }
      if (!content.trim()) {
        throw new Error("empty chapter intent response");
      }
      await writeFile(runtimePath, content, "utf-8");
      return { chapterNumber: input.chapterNumber, content, runtimePath };
    } catch (error) {
      const content = this.buildFallbackIntent({
        chapterNumber: input.chapterNumber,
        plannerIntent: input.plannerIntent,
        context,
        resourcePlan: input.resourcePlan,
        error,
      });
      await writeFile(runtimePath, content, "utf-8");
      return { chapterNumber: input.chapterNumber, content, runtimePath, isFallback: true };
    }
  }

  private async loadContext(bookDir: string, chapterNumber: number): Promise<ChapterIntentContext> {
    const storyDir = join(bookDir, "story");
    const [
      storyBible,
      volumeOutline,
      bookRules,
      currentState,
      pendingHooks,
      genreArchitecture,
      worldEngine,
      antagonistMap,
      motivationMatrix,
      first10ChapterPlan,
      currentFocus,
      characterMatrix,
      emotionalArcs,
      subplotBoard,
      recentChapters,
    ] = await Promise.all([
      this.readStoryFile(storyDir, "story_bible.md", 9000),
      this.readStoryFile(storyDir, "volume_outline.md", 7000),
      this.readStoryFile(storyDir, "book_rules.md", 7000),
      this.readStoryFile(storyDir, "current_state.md", 7000),
      this.readStoryFile(storyDir, "pending_hooks.md", 7000),
      this.readStoryFile(storyDir, "genre_architecture.md", 9000),
      this.readStoryFile(storyDir, "world_engine.md", 9000),
      this.readStoryFile(storyDir, "antagonist_map.md", 9000),
      this.readStoryFile(storyDir, "motivation_matrix.md", 9000),
      this.readStoryFile(storyDir, "first_10_chapter_plan.md", 9000),
      this.readStoryFile(storyDir, "current_focus.md", 7000),
      this.readStoryFile(storyDir, "character_matrix.md", 7000),
      this.readStoryFile(storyDir, "emotional_arcs.md", 7000),
      this.readStoryFile(storyDir, "subplot_board.md", 7000),
      this.loadRecentChapters(bookDir, chapterNumber),
    ]);

    return {
      storyBible,
      volumeOutline,
      bookRules,
      currentState,
      pendingHooks,
      genreArchitecture,
      worldEngine,
      antagonistMap,
      motivationMatrix,
      first10ChapterPlan,
      currentFocus,
      characterMatrix,
      emotionalArcs,
      subplotBoard,
      recentChapters,
      first10PlanLine: this.extractFirst10PlanLine(first10ChapterPlan, chapterNumber),
    };
  }

  private async readStoryFile(storyDir: string, filename: string, limit: number): Promise<string> {
    const content = await readFile(join(storyDir, filename), "utf-8").catch(() => "(文件尚未创建)");
    return this.truncateMiddle(content, limit);
  }

  private async loadRecentChapters(bookDir: string, chapterNumber: number): Promise<string> {
    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir).catch(() => []);
    const selected = files
      .map((file) => {
        const match = file.match(/^(\d+)_.*\.md$/);
        return match ? { file, number: Number.parseInt(match[1]!, 10) } : undefined;
      })
      .filter((entry): entry is { file: string; number: number } => Boolean(entry))
      .filter((entry) => entry.number < chapterNumber)
      .sort((left, right) => left.number - right.number)
      .slice(-3);

    const chapters = await Promise.all(selected.map(async (entry) => {
      const content = await readFile(join(chaptersDir, entry.file), "utf-8").catch(() => "");
      return `### ${entry.file}\n${this.truncateMiddle(content, 5000)}`;
    }));

    return chapters.join("\n\n---\n\n") || "(暂无最近章节正文)";
  }

  private buildSystemPrompt(language: "zh" | "en"): string {
    if (language === "en") {
      return [
        "You generate a pre-writing chapter intent card for a serialized novel.",
        "Return Markdown only. Do not write prose draft.",
        "The card must turn story skeleton files into a concrete chapter goal, pressure, method, payoff, and next hook.",
      ].join("\n");
    }

    return [
      "你是网文续写前的章节意图卡规划员。",
      "只输出 Markdown，不写正文。",
      "你的任务是把故事骨架文件转成可执行的本章目标、压力、解法、爽点与下一章钩子。",
    ].join("\n");
  }

  private buildUserPrompt(params: {
    readonly book: BookConfig;
    readonly chapterNumber: number;
    readonly plannerIntent?: string;
    readonly context: ChapterIntentContext;
    readonly resourcePlan?: ChapterResourcePlan;
    readonly previousResourcePlanViolations?: ReadonlyArray<string>;
  }): string {
    const sixStepBrief = SIX_STEP_PLOT_METHOD.steps
      .map((step, index) => `${index + 1}. ${step.name}：${step.purpose}`)
      .join("\n");
    const first10Rule = params.chapterNumber <= 10
      ? [
          "## 前10章强约束",
          `- 当前章节 <= 10，必须优先对齐 first_10_chapter_plan.md。`,
          `- 本章对应 first_10_chapter_plan 的哪一行：${params.context.first10PlanLine || "(未找到，fallback 到 current_focus / 黄金三章目标)"}`,
          "- 如果 current_state 没有明确改变，不允许偏离该规划。",
          params.chapterNumber <= 3
            ? "- 当前属于黄金三章，必须强化开篇钩子、主角困境、爽点兑现和追读理由。"
            : "",
        ].filter(Boolean).join("\n")
      : [
          "## 第11章以后规则",
          "- 优先读取 volume_outline 当前卷目标、current_state 当前冲突、pending_hooks 近期伏笔和 subplot_board 活跃支线。",
          "- 从 world_engine 选择 1 个冲突来源，从 antagonist_map 选择 1 个反派压力来源，并用 motivation_matrix 约束人物行为。",
        ].join("\n");

    return [
      `# 生成第${params.chapterNumber}章 Chapter Intent`,
      "",
      "必须生成一张续写前意图卡，供 Writer 正文生成严格遵守。",
      params.resourcePlan ? [
        "",
        renderResourcePlanForPrompt(params.resourcePlan, "chapter_intent"),
        "",
        "chapter_intent 不得覆盖 book_rules / particle_ledger / Resource Plan。",
        params.previousResourcePlanViolations?.length
          ? `上一次输出违反 Resource Plan：${params.previousResourcePlanViolations.join("；")}。本次必须删除这些目标。`
          : "",
      ].filter(Boolean).join("\n") : "",
      "",
      "## 六步剧情闭环要求",
      sixStepBrief,
      "",
      first10Rule,
      "",
      "## 输出结构",
      this.outputTemplate(params.chapterNumber),
      "",
      "## 旧版 planner intent（可作为治理约束来源，不得机械照抄）",
      params.plannerIntent?.trim() || "(无)",
      "",
      "## story_bible.md",
      params.context.storyBible,
      "",
      "## volume_outline.md",
      params.context.volumeOutline,
      "",
      "## book_rules.md",
      params.context.bookRules,
      "",
      "## current_state.md",
      params.context.currentState,
      "",
      "## pending_hooks.md",
      params.context.pendingHooks,
      "",
      "## genre_architecture.md",
      params.context.genreArchitecture,
      "",
      "## world_engine.md",
      params.context.worldEngine,
      "",
      "## antagonist_map.md",
      params.context.antagonistMap,
      "",
      "## motivation_matrix.md",
      params.context.motivationMatrix,
      "",
      "## first_10_chapter_plan.md",
      params.context.first10ChapterPlan,
      "",
      "## current_focus.md",
      params.context.currentFocus,
      "",
      "## character_matrix.md",
      params.context.characterMatrix,
      "",
      "## emotional_arcs.md",
      params.context.emotionalArcs,
      "",
      "## subplot_board.md",
      params.context.subplotBoard,
      "",
      "## 最近章节正文或摘要",
      params.context.recentChapters,
    ].join("\n");
  }

  private outputTemplate(chapterNumber: number): string {
    return `# 第${chapterNumber}章 Chapter Intent

## 1. 本章承接
- 上一章结尾钩子：
- 本章必须回应：
- 本章不能跳过的连续性信息：

## 2. 本章情绪事件
- 开场情绪：
- 具体画面：
- 读者应该产生的情绪：
- 禁止写法：

## 3. 本章主角目标
- 表层目标：
- 深层目标：
- 本章目标与当前卷目标的关系：
- 本章目标与长期主线的关系：

## 4. 本章阻碍困境
- 阻碍来源：
  - 世界规则 / 资源稀缺 / 反派计划 / 配角动机 / 主角弱点 / 外部环境
- 具体阻碍：
- 阻碍强度：
- 如果主角失败，会失去什么？

## 5. 本章反派压力
- 本章出场或间接施压的反派：
- 反派本章目标：
- 反派使用的方法：
- 是否符合 antagonist_map：
- 反派不降智约束：

## 6. 本章解决方法
- 主角凭什么还有戏：
- 使用的能力/资源/信息差：
- 是否需要付出代价：
- 是否来自前文伏笔：
- 禁止临时开挂：

## 7. 本章行动高潮
- 高潮场景：
- 冲突升级方式：
- 爽点/反转：
- 主角胜利或阶段性收益：
- 主角是否付出代价：

## 8. 本章结局反馈
- 主角获得：
- 主角失去：
- 人物关系变化：
- 世界/局势变化：
- 新增伏笔：
- 回收伏笔：

## 9. 下一章钩子
- 结尾画面：
- 未解决问题：
- 下一章自然推进方向：

## 10. 人物行为约束
- 主角本章不能违背：
- 配角本章不能工具人化：
- 反派本章不能降智：
- 系统/金手指规则不能违背：

## 11. 写作执行提醒
- 本章节奏：
- 本章转场策略：
- 本章语言风格：
- 平台/题材安全提醒：
- 禁止事项：

## 12. 本章结构信号关键词
从 story/structure_signals.json 中选择本章应命中的关键词，或补充本章新增的信号词（2-4字为佳）。
- opening_hook（本章开头应命中）：
- pressure_source（本章压力来源词）：
- obstacle_dilemma（本章困境词）：
- ending_pull（本章结尾追读词）：
- 本章新增长期信号词（如有）：`;
  }

  private buildFallbackIntent(params: {
    readonly chapterNumber: number;
    readonly plannerIntent?: string;
    readonly context: ChapterIntentContext;
    readonly resourcePlan?: ChapterResourcePlan;
    readonly error: unknown;
  }): string {
    const detail = params.error instanceof Error ? params.error.message : String(params.error);
    return [
      `# 第${params.chapterNumber}章 Chapter Intent`,
      "",
      "> 本文件为 fallback 生成：chapter_intent LLM 生成失败，但 write next 将继续执行。",
      `> 失败原因：${detail}`,
      params.resourcePlan ? [
        "",
        renderResourcePlanForPrompt(params.resourcePlan, "chapter_intent"),
        "",
        "> fallback intent 仍必须遵守 Resource Plan。",
      ].join("\n") : "",
      "",
      "## first_10_chapter_plan 对齐",
      `- 本章对应 first_10_chapter_plan 的哪一行：${params.context.first10PlanLine || "(未找到，fallback 到 current_focus / current_state)"}`,
      "",
      "## current_state 当前目标",
      params.context.currentState,
      "",
      "## current_focus 当前重点",
      params.context.currentFocus,
      "",
      "## 简单六步结构",
      "- 情绪事件：承接上一章或 current_state 中最紧迫的冲突，用具体画面开场。",
      "- 欲望目标：主角本章只追一个清晰、可行动的目标。",
      "- 阻碍困境：从 world_engine、antagonist_map 或 pending_hooks 中选择压力来源。",
      "- 解决方法：使用前文已有能力、资源、信息差或人物选择，不临时开挂。",
      "- 行动解决：让主角主动推进高潮，并获得阶段性收益或反转。",
      "- 结局反馈：交代得失变化，并留下下一章具体钩子。",
      "",
      "## 故事骨架摘要",
      "### world_engine.md",
      params.context.worldEngine,
      "",
      "### antagonist_map.md",
      params.context.antagonistMap,
      "",
      "### motivation_matrix.md",
      params.context.motivationMatrix,
      "",
      "## 旧版 planner intent",
      params.plannerIntent?.trim() || "(无)",
    ].join("\n");
  }

  private extractFirst10PlanLine(plan: string, chapterNumber: number): string {
    if (chapterNumber > 10) return "";
    const escaped = String(chapterNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`第\\s*${escaped}\\s*章`, "u"),
      new RegExp(`Chapter\\s*${escaped}\\b`, "iu"),
      new RegExp(`^\\s*\\|?\\s*${escaped}\\s*\\|`, "u"),
      new RegExp(`^\\s*[-*]\\s*${escaped}[.、)]`, "u"),
    ];
    return plan
      .split("\n")
      .map((line) => line.trim())
      .find((line) => patterns.some((pattern) => pattern.test(line))) ?? "";
  }

  private normalizeMarkdown(content: string): string {
    return content
      .trim()
      .replace(/^```(?:markdown|md)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trimEnd() + "\n";
  }

  private truncateMiddle(content: string, limit: number): string {
    if (content.length <= limit) return content;
    const head = Math.floor(limit * 0.65);
    const tail = limit - head;
    return `${content.slice(0, head)}\n\n...[中间内容已截断]...\n\n${content.slice(-tail)}`;
  }
}
