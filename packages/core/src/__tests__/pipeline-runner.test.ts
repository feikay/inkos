import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRunner } from "../pipeline/runner.js";
import * as llmProvider from "../llm/provider.js";
import { StateManager } from "../state/manager.js";
import { ArchitectAgent, type ArchitectOutput } from "../agents/architect.js";
import { PlannerAgent } from "../agents/planner.js";
import { ChapterIntentAgent } from "../agents/chapter-intent.js";
import {
  applyIntentAlignmentHardScan,
  INTENT_ALIGNMENT_DIMENSIONS,
  IntentAlignmentReviewerAgent,
  type IntentAlignmentReport,
  type IntentAlignmentReviewInput,
} from "../agents/intent-alignment-reviewer.js";
import { ResourceBlockingRewriterAgent, ResourceConsistencyReviserAgent } from "../agents/resource-consistency.js";
import { ComposerAgent } from "../agents/composer.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { ContinuityAuditor, type AuditIssue, type AuditResult } from "../agents/continuity.js";
import { ReviserAgent, type ReviseOutput } from "../agents/reviser.js";
import { ChapterAnalyzerAgent } from "../agents/chapter-analyzer.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import { MemoryDB } from "../state/memory-db.js";
import * as memoryDbModule from "../state/memory-db.js";
import { countChapterLength } from "../utils/length-metrics.js";
import { AntagonistIntelligenceReviewerAgent, type AntagonistIntelligenceReport } from "../agents/antagonist-intelligence.js";

const originalChapterIntentGenerate = ChapterIntentAgent.prototype.generate;

const require = createRequire(import.meta.url);
const hasNodeSqlite = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

const sqliteIt = hasNodeSqlite ? it : it.skip;

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

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function completeFoundationOutput(overrides: Partial<ArchitectOutput> = {}): ArchitectOutput {
  const first10Rows = Array.from({ length: 10 }, (_, index) => {
    const chapter = index + 1;
    return `| ${chapter} | 功能${chapter} | 情绪${chapter} | 目标${chapter} | 阻碍${chapter} | 解决${chapter} | 爽点${chapter} | 钩子${chapter} |`;
  }).join("\n");

  return {
    storyBible: "# Story Bible\n## 02_主角\n- 姓名：林远舟\n- 身份：青石县高中生。\n",
    volumeOutline: "# Volume Outline\n",
    bookRules: "---\nversion: \"1.0\"\nprotagonist:\n  name: 林远舟\n  personalityLock: [冷静, 护短]\n  behavioralConstraints: [不主动伤害无辜]\n---\n\n# Book Rules\n",
    currentState: createStateCard({
      chapter: 0,
      location: "青石县",
      protagonistState: "林远舟刚进入主线。",
      goal: "找到第一桶金机会。",
      conflict: "本金不足且竞争者逼近。",
    }),
    pendingHooks: "# Pending Hooks\n",
    genreArchitecture: "# 题材架构\n\n## 1. 题材定位\n- 核心卖点：信息差破局",
    worldEngine: "# 世界发动机\n\n## 5. 主角异常性\n- 主角为什么是世界规则里的异常：掌握未来信息。\n\n## 6. 自动产出冲突的方式\n- 资源争夺",
    antagonistMap: [
      "# 反派结构",
      "## 1. 核心反派",
      "- 姓名/代号：赵明远",
      "- 表层身份：本地商人",
      "- 真实身份：关系网垄断者",
      "- 反派类型：谋局者",
      "- 公开目标：扩大商业地盘",
      "- 隐藏目标：垄断关键资源",
      "- 维护的秩序：关系优先的旧秩序",
      "- 为什么不能容忍主角：主角用效率和信息差打破垄断。",
    ].join("\n"),
    motivationMatrix: [
      "# 人物动机矩阵",
      "## 1. 主角动机",
      "- 表层目标：赚钱改善家庭。",
      "- 深层欲望：证明自己可以改变命运。",
      "- 最大恐惧：重蹈前世覆辙。",
      "- 底线：不伤害无辜，不背叛亲友。",
      "## 2. 核心反派动机",
      "- 表层目标：扩大商业地盘。",
      "- 深层欲望：证明旧关系秩序不可替代。",
      "- 最大恐惧：被后来者取代。",
      "## 3. 重要配角动机表",
      "| 角色 | 表层目标 | 深层欲望 | 恐惧 | 底线 | 会背叛什么 | 绝不背叛什么 | 与主角利益关系 |",
      "|---|---|---|---|---|---|---|---|",
      "| 陈小波 | 赚钱 | 被看见 | 受穷 | 不害人 | 小利益 | 友情 | 合伙人 |",
      "| 苏婉清 | 上大学 | 走出去 | 被困住 | 良心 | 舒适圈 | 理想 | 价值观碰撞 |",
      "| 林建国 | 保工作 | 家庭稳定 | 下岗 | 不违法 | 面子 | 家庭 | 父子冲突 |",
      "| 周秀兰 | 转正 | 家庭和睦 | 儿子走歪 | 安全 | 暂时理解 | 儿子 | 母子情感 |",
    ].join("\n"),
    first10ChapterPlan: [
      "# 前10章规划",
      "## 1. 黄金三章目标",
      "### 第1章",
      "- 主钩子类型：极度反差",
      "- 前500字冲突：主角回到关键一天。",
      "- 主角困境：确认重生且缺钱。",
      "- 章节结尾钩子：第一桶金机会出现。",
      "### 第2章",
      "- 核心功能：展示信息差。",
      "- 金手指/核心差异如何展示：判断市场机会。",
      "- 阻碍如何升级：本金不足。",
      "- 章节结尾钩子：竞争者出现。",
      "### 第3章",
      "- 核心功能：明确长期目标。",
      "- 长期目标如何明确：三个月改变家庭处境。",
      "- 第一个阶段敌人如何出现：本地商人施压。",
      "- 章节结尾钩子：审批风险出现。",
      "## 2. 前10章章节表",
      "| 章数 | 章节功能 | 情绪事件 | 主角目标 | 阻碍困境 | 解决方法 | 爽点/反转 | 结尾钩子 |",
      "|---|---|---|---|---|---|---|---|",
      first10Rows,
    ].join("\n"),
    structureSignals: validStructureSignalsSection(),
    ...overrides,
  };
}

function completeEnglishFoundationOutput(overrides: Partial<ArchitectOutput> = {}): ArchitectOutput {
  const first10Rows = Array.from({ length: 10 }, (_, index) => {
    const chapter = index + 1;
    return `| ${chapter} | Function ${chapter} | Emotion ${chapter} | Goal ${chapter} | Obstacle ${chapter} | Solution ${chapter} | Payoff ${chapter} | Hook ${chapter} |`;
  }).join("\n");

  return completeFoundationOutput({
    storyBible: "# Story Bible\n## 02_Protagonist\n- Name: Mara\n- Identity: Courier at the harbor gate.\n",
    bookRules: "---\nversion: \"1.0\"\nprotagonist:\n  name: Mara\n---\n\n# Book Rules\n",
    currentState: createStateCard({
      chapter: 0,
      location: "Harbor gate",
      protagonistState: "Mara arrives with a sealed letter.",
      goal: "Find the missing captain before sunrise.",
      conflict: "The harbor watch is searching every ship.",
    }),
    genreArchitecture: "# Genre Architecture\n\n## 1. Genre Positioning\n- Core selling point: grounded harbor mystery",
    worldEngine: "# World Engine\n\n## 5. Protagonist Anomaly\n- Why is the protagonist an anomaly under world rules: Mara carries the only uncensored letter.\n\n## 6. Reusable Conflict Sources\n- Institutional pressure",
    antagonistMap: [
      "# Antagonist Structure",
      "## 1. Core Antagonist",
      "- Name/code: Watch Captain",
      "- Surface identity: Harbor watch commander",
      "- Real identity: Keeper of the smuggling route",
      "- Antagonist type: Strategist",
      "- Public goal: Keep the harbor calm",
      "- Hidden goal: Hide the missing captain's route",
      "- Order defended: Port authority control",
      "- Why they cannot tolerate the protagonist: Mara's letter can expose the route.",
    ].join("\n"),
    motivationMatrix: [
      "# Motivation Matrix",
      "## 1. Protagonist Motivation",
      "- Surface goal: Deliver the sealed letter.",
      "- Deep desire: Prove she is more than a disposable courier.",
      "- Greatest fear: The captain dies because she hesitates.",
      "- Bottom line: Never betray an innocent passenger.",
      "## 2. Core Antagonist Motivation",
      "- Surface goal: Keep the harbor sealed.",
      "- Deep desire: Preserve his hidden authority.",
      "- Greatest fear: Losing control of the route.",
      "## 3. Important Supporting Character Motivation Table",
      "| Character | Surface goal | Deep desire | Fear | Bottom line | Will betray | Never betray | Relation to protagonist |",
      "|---|---|---|---|---|---|---|---|",
      "| Tomas | Find work | Be trusted | Exile | No murder | Comfort | Mara | Ally |",
      "| Elen | Keep records | Tell truth | Censorship | No forged logs | Position | Facts | Informant |",
      "| Captain Roe | Survive | Clear name | Public execution | Crew safety | Pride | Crew | Hidden target |",
      "| Mira | Sell passage | Buy freedom | Debt prison | Children | Profit | Children | Unstable helper |",
    ].join("\n"),
    first10ChapterPlan: [
      "# First 10 Chapter Plan",
      "## 1. Golden Three Chapter Goals",
      "### Chapter 1",
      "- Main hook type: immediate conflict",
      "- First 500-word conflict: Mara reaches the locked harbor gate.",
      "- Protagonist dilemma: enter openly or hide the letter.",
      "- Ending hook: the watch recognizes the seal.",
      "### Chapter 2",
      "- Core function: show Mara's edge.",
      "- How core edge/difference appears: she reads patrol habits.",
      "- How obstacle escalates: the gate closes.",
      "- Ending hook: Tomas offers a risky route.",
      "### Chapter 3",
      "- Core function: clarify goal.",
      "- How long-term goal becomes clear: find the missing captain.",
      "- How first stage enemy appears: the watch commander names her.",
      "- Ending hook: the letter warms in her coat.",
      "## 2. First 10 Chapter Table",
      "| Chapter | Chapter Function | Emotional Event | Protagonist Goal | Obstacle/Dilemma | Solution | Payoff/Reversal | Ending Hook |",
      "|---|---|---|---|---|---|---|---|",
      first10Rows,
    ].join("\n"),
    ...overrides,
  });
}

const CRITICAL_ISSUE: AuditIssue = {
  severity: "critical",
  category: "continuity",
  description: "Fix the chapter state",
  suggestion: "Repair the contradiction",
};

function createAuditResult(overrides: Partial<AuditResult>): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "ok",
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function createWriterOutput(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return {
    chapterNumber: 1,
    title: "Test Chapter",
    content: "Original chapter body.",
    wordCount: "Original chapter body.".length,
    preWriteCheck: "check",
    postSettlement: "settled",
    updatedState: "writer state",
    updatedLedger: "writer ledger",
    updatedHooks: "writer hooks",
    chapterSummary: "| 1 | Original summary |",
    updatedSubplots: "writer subplots",
    updatedEmotionalArcs: "writer emotions",
    updatedCharacterMatrix: "writer matrix",
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function createReviseOutput(overrides: Partial<ReviseOutput> = {}): ReviseOutput {
  return {
    revisedContent: "Revised chapter body.",
    wordCount: "Revised chapter body.".length,
    fixedIssues: ["fixed"],
    updatedState: "revised state",
    updatedLedger: "revised ledger",
    updatedHooks: "revised hooks",
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

function createAnalyzedOutput(overrides: Partial<WriteChapterOutput> = {}): WriteChapterOutput {
  return createWriterOutput({
    content: "Analyzed final chapter body.",
    wordCount: "Analyzed final chapter body.".length,
    updatedState: "analyzed state",
    updatedLedger: "analyzed ledger",
    updatedHooks: "analyzed hooks",
    chapterSummary: "| 1 | Revised summary |",
    updatedSubplots: "analyzed subplots",
    updatedEmotionalArcs: "analyzed emotions",
    updatedCharacterMatrix: "analyzed matrix",
    ...overrides,
  });
}

function createIntentAlignmentReport(
  input: IntentAlignmentReviewInput,
  overrides: Partial<IntentAlignmentReport> = {},
): IntentAlignmentReport {
  const dimensions = Object.fromEntries(INTENT_ALIGNMENT_DIMENSIONS.map((dimension) => [dimension, 90])) as IntentAlignmentReport["dimensions"];
  const dimensionConclusions = Object.fromEntries(
    INTENT_ALIGNMENT_DIMENSIONS.map((dimension) => [dimension, "符合 chapter_intent。"]),
  ) as IntentAlignmentReport["dimensionConclusions"];
  const {
    dimensions: overrideDimensions,
    dimensionConclusions: overrideConclusions,
    ...restOverrides
  } = overrides;
  return {
    chapter: input.chapter,
    status: "PASS",
    score: 90,
    issues: [],
    suggestions: [],
    intentPath: input.intentPath,
    chapterPath: input.chapterPath,
    ...restOverrides,
    dimensions: { ...dimensions, ...overrideDimensions },
    dimensionConclusions: { ...dimensionConclusions, ...overrideConclusions },
  };
}

function createStateCard(params: {
  readonly chapter: number;
  readonly location: string;
  readonly protagonistState: string;
  readonly goal: string;
  readonly conflict: string;
}): string {
  return [
    "# Current State",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Current Chapter | ${params.chapter} |`,
    `| Current Location | ${params.location} |`,
    `| Protagonist State | ${params.protagonistState} |`,
    `| Current Goal | ${params.goal} |`,
    "| Current Constraint | The city gates are watched. |",
    "| Current Alliances | Mentor allies are scattered. |",
    `| Current Conflict | ${params.conflict} |`,
    "",
  ].join("\n");
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

async function createRunnerFixture(
  configOverrides: Partial<ConstructorParameters<typeof PipelineRunner>[0]> = {},
): Promise<{
  root: string;
  runner: PipelineRunner;
  state: StateManager;
  bookId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "inkos-runner-test-"));
  const state = new StateManager(root);
  const bookId = "test-book";
  const now = "2026-03-19T00:00:00.000Z";
  const book: BookConfig = {
    id: bookId,
    title: "Test Book",
    platform: "tomato",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: now,
    updatedAt: now,
  };

  await state.saveBookConfig(bookId, book);
  await mkdir(join(state.bookDir(bookId), "story"), { recursive: true });
  await mkdir(join(state.bookDir(bookId), "chapters"), { recursive: true });

  const runner = new PipelineRunner({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0, maxTokensCap: null,
      },
    } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
    model: "test-model",
    projectRoot: root,
    ...configOverrides,
  });

  return { root, runner, state, bookId };
}

describe("PipelineRunner", () => {
  beforeEach(() => {
    vi.spyOn(FoundationReviewerAgent.prototype, "review").mockResolvedValue({
      passed: true,
      totalScore: 85,
      dimensions: [],
      overallFeedback: "auto-pass for test",
    });
    vi.spyOn(LengthNormalizerAgent.prototype, "normalizeChapter").mockImplementation(
      async ({ chapterContent, lengthSpec }) => ({
        normalizedContent: chapterContent,
        finalCount: countChapterLength(chapterContent, lengthSpec.countingMode),
        applied: false,
        mode: "none",
        tokenUsage: ZERO_USAGE,
      }),
    );
    vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
      warnings: [],
      passed: true,
    });
    vi.spyOn(ChapterIntentAgent.prototype, "generate").mockImplementation(async (input) => {
      const runtimeDir = join(input.bookDir, "story", "runtime", "chapter-intents");
      await mkdir(runtimeDir, { recursive: true });
      const runtimePath = join(runtimeDir, `${String(input.chapterNumber).padStart(4, "0")}.md`);
      const content = [
        `# 第${input.chapterNumber}章 Chapter Intent`,
        "",
        "## 旧版 planner intent",
        input.plannerIntent ?? "(无)",
        "",
      ].join("\n");
      await writeFile(runtimePath, content, "utf-8");
      return { chapterNumber: input.chapterNumber, content, runtimePath };
    });
    vi.spyOn(IntentAlignmentReviewerAgent.prototype, "review").mockImplementation(async (input) => {
      if (!input.intentMarkdown?.trim()) {
        return createIntentAlignmentReport(input, {
          status: "MISSING_INTENT",
          score: null,
          issues: [{
            severity: "warning",
            dimension: "missing_intent",
            message: "chapter_intent 缺失，无法判断最终正文是否符合预写意图。",
          }],
        });
      }
      if (!input.chapterContent?.trim()) {
        return createIntentAlignmentReport(input, {
          status: "MISSING_CHAPTER",
          score: null,
          issues: [{
            severity: "critical",
            dimension: "missing_chapter",
            message: "最终正文缺失，无法执行 intent alignment 审核。",
          }],
        });
      }
      return createIntentAlignmentReport(input);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reuse override clients when credential sources differ", () => {
    const previousKeyA = process.env.TEST_KEY_A;
    const previousKeyB = process.env.TEST_KEY_B;
    process.env.TEST_KEY_A = "key-a";
    process.env.TEST_KEY_B = "key-b";

    try {
      const runner = new PipelineRunner({
        client: {
          provider: "openai",
          apiFormat: "chat",
          stream: false,
          defaults: {
            temperature: 0.7,
            maxTokens: 4096,
            thinkingBudget: 0, maxTokensCap: null,
          },
        } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
        model: "base-model",
        projectRoot: process.cwd(),
        defaultLLMConfig: {
          provider: "custom",
          service: "custom",
          configSource: "env",
          baseUrl: "https://base.example/v1",
          apiKey: "base-key",
          model: "base-model",
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          apiFormat: "chat",
          stream: false,
        },
        modelOverrides: {
          writer: {
            model: "writer-model",
            provider: "custom",
            baseUrl: "https://shared.example/v1",
            apiKeyEnv: "TEST_KEY_A",
          },
          auditor: {
            model: "auditor-model",
            provider: "custom",
            baseUrl: "https://shared.example/v1",
            apiKeyEnv: "TEST_KEY_B",
          },
        },
      });

      const resolveOverride = (
        runner as unknown as {
          resolveOverride: (agent: string) => { model: string; client: unknown };
        }
      ).resolveOverride.bind(runner);

      const writerOverride = resolveOverride("writer");
      const auditorOverride = resolveOverride("auditor");

      expect(writerOverride.client).not.toBe(auditorOverride.client);
    } finally {
      if (previousKeyA === undefined) delete process.env.TEST_KEY_A;
      else process.env.TEST_KEY_A = previousKeyA;

      if (previousKeyB === undefined) delete process.env.TEST_KEY_B;
      else process.env.TEST_KEY_B = previousKeyB;
    }
  });

  it("keeps the base client when no model override is configured", () => {
    const baseClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: true,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        maxTokensCap: null,
      },
    } as ConstructorParameters<typeof PipelineRunner>[0]["client"];
    const runner = new PipelineRunner({
      client: baseClient,
      model: "base-model",
      projectRoot: process.cwd(),
    });

    const resolveOverride = (
      runner as unknown as {
        resolveOverride: (agent: string) => { model: string; client: unknown };
      }
    ).resolveOverride.bind(runner);

    expect(resolveOverride("planner")).toEqual({ model: "base-model", client: baseClient });
  });

  it("resolves legacy string overrides for pipeline agents", () => {
    const baseClient = {
      provider: "openai",
      apiFormat: "chat",
      stream: true,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        maxTokensCap: null,
      },
    } as ConstructorParameters<typeof PipelineRunner>[0]["client"];
    const runner = new PipelineRunner({
      client: baseClient,
      model: "base-model",
      projectRoot: process.cwd(),
      modelOverrides: {
        planner: "planner-model",
        composer: "composer-model",
        "state-validator": "validator-model",
      },
    });

    const resolveOverride = (
      runner as unknown as {
        resolveOverride: (agent: string) => { model: string; client: unknown };
      }
    ).resolveOverride.bind(runner);

    expect(resolveOverride("planner")).toEqual({ model: "planner-model", client: baseClient });
    expect(resolveOverride("composer")).toEqual({ model: "composer-model", client: baseClient });
    expect(resolveOverride("state-validator")).toEqual({ model: "validator-model", client: baseClient });
  });

  it("resolves object overrides with temperature and maxTokens for pipeline agents", () => {
    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: true,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "base-model",
      projectRoot: process.cwd(),
      defaultLLMConfig: {
        provider: "custom",
        service: "custom",
        configSource: "env",
        baseUrl: "https://base.example/v1",
        apiKey: "base-key",
        model: "base-model",
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        apiFormat: "chat",
        stream: true,
      },
      modelOverrides: {
        planner: { model: "planner-model", temperature: 0.25, maxTokens: 12000 },
        composer: { model: "composer-model", temperature: 0.3 },
        "state-validator": { model: "validator-model", temperature: 0.1, stream: false },
      },
    });

    const resolveOverride = (
      runner as unknown as {
        resolveOverride: (agent: string) => { model: string; client: ConstructorParameters<typeof PipelineRunner>[0]["client"] };
      }
    ).resolveOverride.bind(runner);

    const planner = resolveOverride("planner");
    const composer = resolveOverride("composer");
    const validator = resolveOverride("state-validator");

    expect(planner.model).toBe("planner-model");
    expect(planner.client.providerLabel).toBe("custom");
    expect(planner.client.defaults.temperature).toBe(0.25);
    expect(planner.client.defaults.maxTokens).toBe(12000);
    expect(composer.model).toBe("composer-model");
    expect(composer.client.providerLabel).toBe("custom");
    expect(composer.client.defaults.temperature).toBe(0.3);
    expect(validator.model).toBe("validator-model");
    expect(validator.client.providerLabel).toBe("custom");
    expect(validator.client.defaults.temperature).toBe(0.1);
    expect(validator.client.stream).toBe(false);
  });

  it("initializes control documents during book creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-test-"));
    const bookId = "bootstrap-book";
    const brief = "# Author Intent\n\nKeep the narrative centered on mentor conflict.\n";
    const now = "2026-03-22T00:00:00.000Z";
    const book: BookConfig = {
      id: bookId,
      title: "Bootstrap Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 10,
      chapterWordCount: 3000,
      createdAt: now,
      updatedAt: now,
    };

    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
      externalContext: brief,
    });

    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: "# Current State\n",
      pendingHooks: "# Pending Hooks\n",
      structureSignals: validStructureSignalsSection(),
    }));

    try {
      await runner.initBook(book);

      const storyDir = join(root, "books", bookId, "story");
      const authorIntent = await readFile(join(storyDir, "author_intent.md"), "utf-8");
      const currentFocus = await readFile(join(storyDir, "current_focus.md"), "utf-8");
      const runtimeDir = await stat(join(storyDir, "runtime"));

      expect(authorIntent).toContain("mentor conflict");
      expect(currentFocus).toContain("当前聚焦");
      expect(runtimeDir.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies creation-draft overrides while initializing a book", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-overrides-"));
    const bookId = "override-book";
    const book: BookConfig = {
      id: bookId,
      title: "Override Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 20,
      chapterWordCount: 2800,
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
    };

    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
    });

    const generateFoundationSpy = vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: "# Current State\n",
      pendingHooks: "# Pending Hooks\n",
      structureSignals: validStructureSignalsSection(),
    }));

    try {
      await runner.initBook(book, {
        externalContext: "世界观重点：近未来港口城，账本与旧案牵出多方势力。",
        authorIntent: "# 作者意图\n\n写成冷硬、克制、利益驱动的商战悬疑。\n",
        currentFocus: "# 当前聚焦\n\n先把旧账线和港口势力网立住。\n",
      });

      expect(generateFoundationSpy).toHaveBeenCalledWith(
        book,
        expect.stringContaining("近未来港口城"),
        undefined,
      );

      const storyDir = join(root, "books", bookId, "story");
      await expect(readFile(join(storyDir, "author_intent.md"), "utf-8"))
        .resolves.toContain("冷硬、克制、利益驱动");
      await expect(readFile(join(storyDir, "current_focus.md"), "utf-8"))
        .resolves.toContain("旧账线和港口势力网");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("regenerates foundation when local structural validation fails even if reviewer passes", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-local-foundation-gate-"));
    const bookId = "local-foundation-gate";
    const book: BookConfig = {
      id: bookId,
      title: "Local Foundation Gate",
      platform: "tomato",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 20,
      chapterWordCount: 2800,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    };
    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
    });
    const invalidRows = Array.from({ length: 10 }, (_, index) => {
      const chapter = index + 1;
      const goal = chapter === 1 ? "" : `目标${chapter}`;
      return `| ${chapter} | 功能${chapter} | 情绪${chapter} | ${goal} | 阻碍${chapter} | 解决${chapter} | 爽点${chapter} | 钩子${chapter} |`;
    }).join("\n");
    const invalidPlan = [
      "# 前10章规划",
      "## 1. 黄金三章目标",
      "### 第1章",
      "- 主钩子类型：",
      "- 前500字冲突：",
      "- 主角困境：",
      "- 章节结尾钩子：",
      "## 2. 前10章章节表",
      "| 章数 | 章节功能 | 情绪事件 | 主角目标 | 阻碍困境 | 解决方法 | 爽点/反转 | 结尾钩子 |",
      "|---|---|---|---|---|---|---|---|",
      invalidRows,
    ].join("\n");
    const generateFoundation = vi.spyOn(ArchitectAgent.prototype, "generateFoundation")
      .mockResolvedValueOnce(completeFoundationOutput({ first10ChapterPlan: invalidPlan }))
      .mockResolvedValueOnce(completeFoundationOutput());
    vi.spyOn(ArchitectAgent.prototype, "completeStorySkeletonSections")
      .mockImplementation(async (_book, foundation) => foundation);

    try {
      await runner.initBook(book);

      expect(generateFoundation).toHaveBeenCalledTimes(2);
      expect(generateFoundation.mock.calls[1]?.[2]).toContain("first_10_chapter_plan incomplete");
      await expect(readFile(join(root, "books", bookId, "story", "first_10_chapter_plan.md"), "utf-8"))
        .resolves.toContain("目标1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("repairs missing story skeleton sections before foundation review", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-story-skeleton-repair-"));
    const bookId = "story-skeleton-repair";
    const book: BookConfig = {
      id: bookId,
      title: "Story Skeleton Repair",
      platform: "tomato",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 20,
      chapterWordCount: 2800,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    };
    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
    });
    const partialFoundation = completeFoundationOutput({
      genreArchitecture: undefined,
      worldEngine: undefined,
      antagonistMap: undefined,
      motivationMatrix: undefined,
      first10ChapterPlan: undefined,
    });
    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(partialFoundation);
    const repair = vi.spyOn(ArchitectAgent.prototype, "completeStorySkeletonSections")
      .mockResolvedValue(completeFoundationOutput());

    try {
      await runner.initBook(book);

      expect(repair).toHaveBeenCalled();
      await expect(readFile(join(root, "books", bookId, "story", "first_10_chapter_plan.md"), "utf-8"))
        .resolves.toContain("目标1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("regenerates foundation when architect output misses a required section", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-book-missing-section-retry-"));
    const bookId = "missing-section-retry";
    const book: BookConfig = {
      id: bookId,
      title: "Missing Section Retry",
      platform: "tomato",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 20,
      chapterWordCount: 2800,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    };
    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
    });
    const generateFoundation = vi.spyOn(ArchitectAgent.prototype, "generateFoundation")
      .mockRejectedValueOnce(new Error("Architect output missing required section: volume_outline"))
      .mockResolvedValueOnce(completeFoundationOutput());

    try {
      await runner.initBook(book);

      expect(generateFoundation).toHaveBeenCalledTimes(2);
      expect(generateFoundation.mock.calls[1]?.[2]).toContain("volume_outline");
      await expect(readFile(join(root, "books", bookId, "story", "volume_outline.md"), "utf-8"))
        .resolves.toContain("# Volume Outline");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("feeds foundation review feedback into the regeneration call after a rejection", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    const reviewer = new FoundationReviewerAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
      bookId,
    });
    const foundation = completeFoundationOutput();
    const generate = vi.fn(async (_reviewFeedback?: string) => foundation);
    const reviewMock = vi.mocked(FoundationReviewerAgent.prototype.review);

    reviewMock.mockReset();
    reviewMock
      .mockResolvedValueOnce({
        passed: false,
        totalScore: 68,
        dimensions: [
          {
            name: "核心冲突",
            score: 58,
            feedback: "核心冲突不够集中，主线悬念没有站稳。",
          },
          {
            name: "开篇节奏",
            score: 76,
            feedback: "前五章起势偏慢，爆点不够前置。",
          },
        ],
        overallFeedback: "请把冲突收紧，并在更早的位置建立爆点。",
      })
      .mockResolvedValueOnce({
        passed: true,
        totalScore: 88,
        dimensions: [],
        overallFeedback: "通过",
      });

    try {
      const result = await (runner as unknown as {
        generateAndReviewFoundation: (params: {
          readonly generate: (reviewFeedback?: string) => Promise<typeof foundation>;
          readonly reviewer: FoundationReviewerAgent;
          readonly mode: "original";
          readonly language: "zh";
          readonly stageLanguage: "zh";
          readonly maxRetries: number;
        }) => Promise<typeof foundation>;
      }).generateAndReviewFoundation({
        generate,
        reviewer,
        mode: "original",
        language: "zh",
        stageLanguage: "zh",
        maxRetries: 2,
      });

      expect(result).toEqual(foundation);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls[0]?.[0]).toBeUndefined();
      expect(generate.mock.calls[1]?.[0]).toContain("请把冲突收紧，并在更早的位置建立爆点。");
      expect(generate.mock.calls[1]?.[0]).toContain("核心冲突");
      expect(generate.mock.calls[1]?.[0]).toContain("核心冲突不够集中");
      expect(generate.mock.calls[1]?.[0]).toContain("开篇节奏");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bootstraps missing control documents for legacy books before writing", async () => {
    const { root, runner, bookId } = await createRunnerFixture();

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Legacy chapter body.",
        wordCount: "Legacy chapter body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      const storyDir = join(root, "books", bookId, "story");
      const authorIntent = await readFile(join(storyDir, "author_intent.md"), "utf-8");
      const currentFocus = await readFile(join(storyDir, "current_focus.md"), "utf-8");
      const runtimeDir = await stat(join(storyDir, "runtime"));

      expect(authorIntent).toContain("Author Intent");
      expect(currentFocus).toContain("Current Focus");
      expect(runtimeDir.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans staged files when initBook fails before foundation is complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-init-rollback-"));
    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0, maxTokensCap: null,
        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
    });

    const now = "2026-03-29T00:00:00.000Z";
    const book: BookConfig = {
      id: "atomic-book",
      title: "Atomic Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "outlining",
      targetChapters: 12,
      chapterWordCount: 2200,
      createdAt: now,
      updatedAt: now,
    };

    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockRejectedValue(
      new Error("missing book_rules section"),
    );

    try {
      await expect(runner.initBook(book)).rejects.toThrow("missing book_rules section");
      await expect(stat(join(root, "books", "atomic-book"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes writeDraft through planner and composer in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const composeChapter = vi.spyOn(ComposerAgent.prototype, "composeChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed draft body.",
        wordCount: "Governed draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId, "Ignore the guild chase and bring focus back to mentor conflict.");

      expect(planChapter).toHaveBeenCalledTimes(1);
      expect(composeChapter).toHaveBeenCalledTimes(1);

      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.externalContext).toBeUndefined();
      expect(writeInput?.chapterIntent).toContain("# Chapter Intent");
      expect(writeInput?.contextPackage?.selectedContext.length).toBeGreaterThan(0);
      expect(writeInput?.ruleStack?.activeOverrides).toHaveLength(2);
      // v2 mode: each activeOverride maps L4→L3 with a planner-provided resolution reason.
      for (const ov of writeInput?.ruleStack?.activeOverrides ?? []) {
        expect(ov).toMatchObject({
          from: "L4",
          to: "L3",
          target: expect.any(String),
          reason: expect.any(String),
        });
        expect(ov.reason.length).toBeGreaterThan(0);
      }

      const runtimeDir = join(state.bookDir(bookId), "story", "runtime");
      await expect(stat(join(runtimeDir, "chapter-0001.intent.md"))).resolves.toBeTruthy();
      await expect(stat(join(runtimeDir, "chapter-0001.context.json"))).resolves.toBeTruthy();
      await expect(stat(join(runtimeDir, "chapter-0001.rule-stack.yaml"))).resolves.toBeTruthy();
      await expect(stat(join(runtimeDir, "chapter-0001.trace.json"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses an existing planned intent for draft when no new context is provided in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      mkdir(join(state.bookDir(bookId), "story", "runtime"), { recursive: true }),
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "runtime", "chapter-0001.intent.md"),
        [
          "# Chapter Intent",
          "",
          "## Goal",
          "Bring the focus back to the mentor conflict.",
          "",
          "## Outline Node",
          "Track the merchant guild trail.",
          "",
          "## Must Keep",
          "- Lin Yue still hides the broken oath token.",
          "",
          "## Must Avoid",
          "- Do not reveal the mastermind",
          "",
          "## Style Emphasis",
          "- Keep the narrative emotionally close to the mentor conflict.",
          "",
          "## Conflicts",
          "- outline_vs_request: allow local outline deferral",
          "",
          "## Pending Hooks Snapshot",
          "- none",
          "",
          "## Chapter Summaries Snapshot",
          "- none",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed draft body.",
        wordCount: "Governed draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      expect(planChapter).not.toHaveBeenCalled();
      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.chapterIntent).toContain("Bring the focus back to the mentor conflict.");
      expect(writeInput?.ruleStack?.activeOverrides).toHaveLength(1);
      expect(writeInput?.ruleStack?.activeOverrides[0]).toMatchObject({
        from: "L4",
        to: "L3",
        target: expect.any(String),
        reason: expect.any(String),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("syncs current-state facts into memory.db after drafting a chapter", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const chapterOneState = createStateCard({
      chapter: 1,
      location: "Ashen ferry crossing",
      protagonistState: "Lin Yue hides the broken oath token.",
      goal: "Find the vanished mentor before dawn.",
      conflict: "Mentor debt blocks every choice.",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);
    await state.snapshotState(bookId, 0);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
        updatedState: chapterOneState,
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 1 | 6 | The mentor debt remains unresolved |",
          "",
        ].join("\n"),
        chapterSummary: [
          "| 1 | Ferry Debt | Lin Yue | Lin Yue crosses the ferry and recommits to the mentor trail | The debt hardens into the core conflict | mentor-debt advanced | tense | mainline |",
        ].join("\n"),
      }),
    );

    try {
      await runner.writeDraft(bookId);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getCurrentFacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "Mentor debt blocks every choice.",
              validFromChapter: 1,
              sourceChapter: 1,
            }),
          ]),
        );
        expect(memoryDb.getChapterCount()).toBe(1);
        expect(memoryDb.getActiveHooks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hookId: "mentor-debt",
              status: "open",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("syncs narrative memory from structured runtime state instead of stale markdown projections", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const stateDir = join(storyDir, "state");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(chaptersDir, "index.json"),
      JSON.stringify([
        { number: 1, title: "Ch1", status: "approved" },
        { number: 2, title: "Ch2", status: "approved" },
        { number: 3, title: "Ch3", status: "approved" },
      ]),
      "utf-8",
    );

    await Promise.all([
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 1 | Markdown Summary | Lin Yue | Old markdown event | Old markdown state | markdown-hook advanced | tense | fallback |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "pending_hooks.md"),
        [
          "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| markdown-hook | 1 | mystery | open | 1 | 4 | Old markdown hook |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 3,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 3,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "hooks.json"), JSON.stringify({
        hooks: [
          {
            hookId: "structured-hook",
            startChapter: 2,
            type: "relationship",
            status: "progressing",
            lastAdvancedChapter: 3,
            expectedPayoff: "Reveal the mentor ledger.",
            notes: "Structured hook should win.",
          },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
        rows: [
          {
            chapter: 3,
            title: "Structured Summary",
            characters: "Lin Yue",
            events: "Structured runtime state event.",
            stateChanges: "Structured runtime state shift.",
            hookActivity: "structured-hook advanced",
            mood: "grim",
            chapterType: "mainline",
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    try {
      await (runner as unknown as {
        syncNarrativeMemoryIndex: (targetBookId: string) => Promise<void>;
      }).syncNarrativeMemoryIndex(bookId);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getSummaries(1, 10)).toEqual([
          expect.objectContaining({
            chapter: 3,
            title: "Structured Summary",
            events: "Structured runtime state event.",
          }),
        ]);
        expect(memoryDb.getActiveHooks()).toEqual([
          expect.objectContaining({
            hookId: "structured-hook",
            status: "progressing",
          }),
        ]);
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a friendly fallback warning when sqlite memory indexing is unavailable", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation(() => {
      const error = new Error("No such built-in module: node:sqlite");
      (error as Error & { code?: string }).code = "ERR_UNKNOWN_BUILTIN_MODULE";
      throw error;
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      console.log("DEBUG warnings:", JSON.stringify(warnings, null, 2));
      expect(warnings).toContain(
        "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
      );
      expect(warnings.join("\n")).not.toContain("node:sqlite");
      expect(warnings.join("\n")).not.toContain("ERR_UNKNOWN_BUILTIN_MODULE");
      expect(warnings.join("\n")).not.toContain("状态事实同步已跳过：");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not misclassify generic runtime errors as sqlite-unavailable fallback", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation(() => {
      throw new Error("sync failed while handling cached node:sqlite telemetry text");
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      expect(warnings.join("\n")).toContain("叙事记忆同步已跳过：");
      expect(warnings.join("\n")).not.toContain("当前 Node 运行时不支持 SQLite 记忆索引");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("recovers when sqlite-unavailable signature is transient and probe succeeds", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
      inputGovernanceMode: "legacy",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    const RealMemoryDB = memoryDbModule.MemoryDB;
    let constructorCalls = 0;
    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation((...args: ConstructorParameters<typeof memoryDbModule.MemoryDB>) => {
      if (constructorCalls === 0) {
        constructorCalls += 1;
        const error = new Error("No such built-in module: node:sqlite");
        (error as Error & { code?: string }).code = "ERR_UNKNOWN_BUILTIN_MODULE";
        throw error;
      }
      constructorCalls += 1;
      return new RealMemoryDB(...args);
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
        chapterSummary: "| 1 | Draft summary | Lin Yue | Draft event | Draft shift | hook advanced | tense | transition |",
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 1 | 3 | Draft hook |",
        ].join("\n"),
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      expect(warnings.join("\n")).not.toContain("当前 Node 运行时不支持 SQLite 记忆索引");
      expect(warnings.join("\n")).not.toContain("叙事记忆同步已跳过");

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getChapterCount()).toBe(1);
        expect(memoryDb.getActiveHooks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hookId: "mentor-debt",
              status: "open",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("retries transient sqlite busy errors during narrative memory sync", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      logger,
      inputGovernanceMode: "legacy",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(state.bookDir(bookId), "story", "current_state.md"),
        createStateCard({
          chapter: 0,
          location: "Shrine outskirts",
          protagonistState: "Lin Yue begins with the oath token hidden.",
          goal: "Reach the trial city.",
          conflict: "The trial deadline is closing in.",
        }),
        "utf-8",
      ),
    ]);

    const RealMemoryDB = memoryDbModule.MemoryDB;
    let constructorCalls = 0;
    vi.spyOn(memoryDbModule, "MemoryDB").mockImplementation((...args: ConstructorParameters<typeof memoryDbModule.MemoryDB>) => {
      if (constructorCalls === 0) {
        constructorCalls += 1;
        const error = new Error("database is locked");
        (error as Error & { code?: string }).code = "SQLITE_BUSY";
        throw error;
      }
      constructorCalls += 1;
      return new RealMemoryDB(...args);
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
        chapterSummary: "| 1 | Draft summary | Lin Yue | Draft event | Draft shift | hook advanced | tense | transition |",
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| mentor-debt | 1 | relationship | open | 1 | 3 | Draft hook |",
        ].join("\n"),
      }),
    );

    try {
      const result = await runner.writeDraft(bookId);

      expect(result.chapterNumber).toBe(1);
      expect(warnings.join("\n")).not.toContain("当前 Node 运行时不支持 SQLite 记忆索引");
      expect(warnings.join("\n")).not.toContain("叙事记忆同步已跳过");

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getChapterCount()).toBe(1);
        expect(memoryDb.getActiveHooks()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hookId: "mentor-debt",
              status: "open",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs explicit stage messages during book initialization", async () => {
    const { logger, infos, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({ logger });
    const book = await state.loadBookConfig(bookId);

    vi.spyOn(ArchitectAgent.prototype, "generateFoundation").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }),
      pendingHooks: "# Pending Hooks\n",
      structureSignals: validStructureSignalsSection(),
    }));

    try {
      await runner.initBook(book);

      expect(infos).toEqual(expect.arrayContaining([
        "阶段：保存书籍配置",
        "阶段：生成基础设定",
        "阶段：写入基础设定文件",
        "阶段：初始化控制文档",
        "阶段：创建初始快照",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks an outlining book as active after drafting the first chapter", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const book = await state.loadBookConfig(bookId);
    await state.saveBookConfig(bookId, { ...book, status: "outlining" });

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Draft body.",
        wordCount: "Draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      const book = await state.loadBookConfig(bookId);
      expect(book.status).toBe("active");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips state settlement when the writer returns a chapter below the whole-chapter minimum", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({ logger });
    const shortDraft = "短稿".repeat(200);
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: shortDraft,
        wordCount: shortDraft.length,
        postWriteErrors: [{
          rule: "payoff-missing",
          description: "本章 promised payoff 完全未发生：门被强行打开。",
          suggestion: "补足 payoff",
          severity: "error",
        }],
      }),
    );
    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({ passed: true }),
    );

    try {
      const result = await runner.writeNextChapter(bookId);

      expect(result.status).toBe("audit-failed");
      expect(result.auditResult.issues[0]?.category).toBe("failed-write-under-min-length");
      expect(auditChapter).not.toHaveBeenCalled();
      await expect(state.loadChapterIndex(bookId)).resolves.toEqual([]);
      expect(warnings.join("\n")).toContain("Chapter 0001 is under minimum length after rewrite. State update skipped.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips state settlement when a promised payoff is still missing after review", async () => {
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({ logger });
    const longDraft = "完整章节内容".repeat(260);
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: longDraft,
        wordCount: longDraft.length,
        postWriteErrors: [{
          rule: "payoff-missing",
          description: "本章 promised payoff 完全未发生：门被强行打开。",
          suggestion: "补足 payoff",
          severity: "error",
        }],
      }),
    );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: longDraft,
        wordCount: longDraft.length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({ passed: true }),
    );

    try {
      const result = await runner.writeNextChapter(bookId);

      expect(result.status).toBe("audit-failed");
      expect(result.auditResult.issues[0]?.category).toBe("failed-write-payoff-missing");
      await expect(state.loadChapterIndex(bookId)).resolves.toEqual([]);
      expect(warnings.join("\n")).toContain("payoff still missing");
      expect(warnings.join("\n")).toContain("rejectedReason=unchanged-candidate");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps normal full-length chapters on the existing state settlement path", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const longDraft = "完整章节内容".repeat(260);
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: longDraft,
        wordCount: longDraft.length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({ passed: true }),
    );

    try {
      const result = await runner.writeNextChapter(bookId);

      expect(result.status).toBe("ready-for-review");
      const index = await state.loadChapterIndex(bookId);
      expect(index).toHaveLength(1);
      expect(index[0]?.number).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes writeNextChapter through planner and composer in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const composeChapter = vi.spyOn(ComposerAgent.prototype, "composeChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(planChapter).toHaveBeenCalledTimes(1);
      expect(composeChapter).toHaveBeenCalledTimes(1);
      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.chapterIntent).toContain("# Chapter Intent");
      expect(writeInput?.contextPackage?.selectedContext.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates and persists a chapter_intent card before writeNextChapter writes prose", async () => {
    vi.mocked(ChapterIntentAgent.prototype.generate).mockRestore();
    const { logger, infos, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      logger,
    });
    const storyDir = join(state.bookDir(bookId), "story");

    await Promise.all([
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n主角不能违背师债。", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\n追查商会账册。", "utf-8"),
      writeFile(join(storyDir, "book_rules.md"), "# Book Rules\n\n系统不能免费开挂。", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- 当前目标：拿到账册。", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- 上一章玉牌发热。", "utf-8"),
      writeFile(join(storyDir, "genre_architecture.md"), "# Genre Architecture\n\n升级爽点来自制度压迫反打。", "utf-8"),
      writeFile(join(storyDir, "world_engine.md"), "# world_engine\n\n资源稀缺会逼迫主角付出代价。", "utf-8"),
      writeFile(join(storyDir, "antagonist_map.md"), "# antagonist_map\n\n商会执事用账册设局。", "utf-8"),
      writeFile(join(storyDir, "motivation_matrix.md"), "# motivation_matrix\n\n主角救人前必须先判断师债收益。", "utf-8"),
      writeFile(join(storyDir, "first_10_chapter_plan.md"), "| 章节 | 规划 |\n| 1 | 第一章公开羞辱后拿到账册线索 |\n", "utf-8"),
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\n第一章要压住追读钩子。", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# Character Matrix\n\n林越：谨慎但记仇。", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# Emotional Arcs\n\n羞辱 -> 忍耐 -> 反打。", "utf-8"),
      writeFile(join(storyDir, "subplot_board.md"), "# Subplot Board\n\n商会支线活跃。", "utf-8"),
    ]);

    const generatedIntent = [
      "# 第1章 Chapter Intent",
      "",
      "## 1. 本章承接",
      "- 上一章结尾钩子：玉牌发热",
      "",
      "## 2. 本章情绪事件",
      "- 开场情绪：压迫",
      "",
      "## 3. 本章主角目标",
      "- 表层目标：拿到账册线索",
      "",
      "## 4. 本章阻碍困境",
      "- 具体阻碍：商会执事设局",
      "",
      "## 5. 本章反派压力",
      "- 本章出场或间接施压的反派：商会执事",
      "",
      "## 7. 本章行动高潮",
      "- 高潮场景：当众反打",
      "",
      "## 8. 本章结局反馈",
      "- 系统初始民望值为0，仅触发绑定，不直接发放任何福利。",
      "",
      "## 9. 下一章钩子",
      "- 结尾画面：账册缺了一页",
      "",
      "## 10. 人物行为约束",
      "- 主角本章不能违背：师债收益逻辑",
      "",
    ].join("\n");
    const chatCompletion = vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: generatedIntent,
      usage: ZERO_USAGE,
    });
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      const userPrompt = chatCompletion.mock.calls[0]?.[2]?.find((message) => message.role === "user")?.content ?? "";
      expect(chatCompletion.mock.calls[0]?.[3]?.stage).toBe("chapter-intent");
      expect(userPrompt).toContain("world_engine.md");
      expect(userPrompt).toContain("antagonist_map.md");
      expect(userPrompt).toContain("motivation_matrix.md");
      expect(userPrompt).toContain("first_10_chapter_plan.md");
      expect(userPrompt).toContain("current_focus.md");
      expect(userPrompt).toContain("情绪事件");
      expect(userPrompt).toContain("欲望目标");
      expect(userPrompt).toContain("第一章公开羞辱后拿到账册线索");
      expect(userPrompt).toContain("黄金三章");

      const intentPath = join(storyDir, "runtime", "chapter-intents", "0001.md");
      await expect(stat(intentPath)).resolves.toBeTruthy();
      await expect(readFile(intentPath, "utf-8")).resolves.toContain("账册缺了一页");

      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.chapterIntent).toContain("账册缺了一页");
      expect(writeInput?.chapterIntent).toContain("人物行为约束");
      expect(writeInput?.contextPackage?.chapterGoal?.payoffToDeliver).toContain("chapter_intent 已抑制旧 payoff");
      expect(writeInput?.contextPackage?.chapterGoal?.payoffDirective).toBeUndefined();
      expect(infos).toEqual(expect.arrayContaining([
        "阶段 0：生成章节意图卡（第1章）",
        "章节意图卡已写入：story/runtime/chapter-intents/0001.md",
      ]));
      expect(warnings).toEqual(expect.arrayContaining([
        expect.stringContaining("chapter_intent suppresses planner payoff; payoffDirective sanitized"),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a fallback chapter_intent when intent generation fails and continues writeNextChapter", async () => {
    vi.mocked(ChapterIntentAgent.prototype.generate).mockRestore();
    const { logger, warnings } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      logger,
    });
    const storyDir = join(state.bookDir(bookId), "story");

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\n商会路线优先。", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Current Goal: find the ledger.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished.\n", "utf-8"),
      writeFile(join(storyDir, "first_10_chapter_plan.md"), "| 1 | 第一章查商会账册 |\n", "utf-8"),
      writeFile(join(storyDir, "world_engine.md"), "# world_engine\n\n资源稀缺。", "utf-8"),
      writeFile(join(storyDir, "antagonist_map.md"), "# antagonist_map\n\n商会执事施压。", "utf-8"),
      writeFile(join(storyDir, "motivation_matrix.md"), "# motivation_matrix\n\n林越不能无故救人。", "utf-8"),
    ]);

    vi.spyOn(llmProvider, "chatCompletion").mockRejectedValue(new Error("intent llm unavailable"));
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      const intentPath = join(storyDir, "runtime", "chapter-intents", "0001.md");
      const fallback = await readFile(intentPath, "utf-8");
      expect(fallback).toContain("本文件为 fallback 生成");
      expect(fallback).toContain("第一章查商会账册");
      expect(fallback).toContain("简单六步结构");
      expect(writeChapter).toHaveBeenCalledTimes(1);
      expect(writeChapter.mock.calls[0]?.[0].chapterIntent).toContain("本文件为 fallback 生成");
      expect(warnings).toEqual(expect.arrayContaining([
        "章节意图卡生成失败，使用 fallback intent",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs intent alignment after final prose and writes markdown/json reports without blocking ready-for-review", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    const review = vi.mocked(IntentAlignmentReviewerAgent.prototype.review);
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "林越拿到账册线索，商会执事施压，结尾账册缺了一页。",
        wordCount: 30,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);

      expect(writeChapter).toHaveBeenCalledTimes(1);
      expect(review).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("ready-for-review");
      const reportDir = join(state.bookDir(bookId), "reviews", "intent-alignment");
      const json = JSON.parse(await readFile(join(reportDir, "0001.report.json"), "utf-8")) as IntentAlignmentReport;
      const markdown = await readFile(join(reportDir, "0001.report.md"), "utf-8");
      expect(json.status).toBe("PASS");
      expect(Object.keys(json.dimensions).sort()).toEqual([...INTENT_ALIGNMENT_DIMENSIONS].sort());
      expect(markdown).toContain("# 第1章 Intent Alignment Report");
      expect(markdown).toContain("goal_alignment");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds WARN intent alignment issues to chapter auditIssues without blocking persistence", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    vi.mocked(IntentAlignmentReviewerAgent.prototype.review).mockImplementation(async (input) => createIntentAlignmentReport(input, {
      status: "WARN",
      score: 78,
      dimensions: { ending_hook_alignment: 70 } as Partial<IntentAlignmentReport["dimensions"]> as IntentAlignmentReport["dimensions"],
      issues: [{
        severity: "warning",
        dimension: "ending_hook_alignment",
        message: "正文结尾钩子略弱。",
        suggestion: "加强下一章拉力。",
      }],
    }));
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({ chapterNumber: 1, content: "正文。", wordCount: 3 }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const index = await state.loadChapterIndex(bookId);

      expect(result.status).toBe("ready-for-review");
      expect(index[0]?.auditIssues).toEqual(expect.arrayContaining([
        "[warning] 正文结尾钩子略弱。",
      ]));
      const report = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "intent-alignment", "0001.report.json"), "utf-8")) as IntentAlignmentReport;
      expect(report.status).toBe("WARN");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps FAIL_REPORT_ONLY intent alignment non-blocking", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    vi.mocked(IntentAlignmentReviewerAgent.prototype.review).mockImplementation(async (input) => createIntentAlignmentReport(input, {
      status: "FAIL_REPORT_ONLY",
      score: 55,
      dimensions: { climax_payoff_alignment: 40 } as Partial<IntentAlignmentReport["dimensions"]> as IntentAlignmentReport["dimensions"],
      issues: [{
        severity: "critical",
        dimension: "climax_payoff_alignment",
        message: "正文提前兑现了下一章 payoff。",
      }],
    }));
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({ chapterNumber: 1, content: "正文。", wordCount: 3 }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const index = await state.loadChapterIndex(bookId);

      expect(result.status).toBe("ready-for-review");
      expect(index[0]?.auditIssues).toEqual(expect.arrayContaining([
        "[critical] 正文提前兑现了下一章 payoff。",
      ]));
      await expect(stat(join(state.bookDir(bookId), "chapters"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes a SKIPPED intent alignment report when reviewer fails and still saves the chapter", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    vi.mocked(IntentAlignmentReviewerAgent.prototype.review).mockRejectedValue(new Error("reviewer unavailable"));
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({ chapterNumber: 1, content: "正文。", wordCount: 3 }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const report = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "intent-alignment", "0001.report.json"), "utf-8")) as IntentAlignmentReport;

      expect(result.status).toBe("ready-for-review");
      expect(report.status).toBe("SKIPPED");
      expect(report.score).toBeNull();
      expect(report.issues[0]?.dimension).toBe("reviewer_failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes a MISSING_INTENT report when the chapter_intent file is absent", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    vi.mocked(ChapterIntentAgent.prototype.generate).mockResolvedValue({
      chapterNumber: 1,
      content: "# 第1章 Chapter Intent\n\n未落盘。",
      runtimePath: join(state.bookDir(bookId), "story", "runtime", "chapter-intents", "0001.md"),
    });
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({ chapterNumber: 1, content: "正文。", wordCount: 3 }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      await runner.writeNextChapter(bookId, 220);
      const report = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "intent-alignment", "0001.report.json"), "utf-8")) as IntentAlignmentReport;

      expect(report.status).toBe("MISSING_INTENT");
      expect(report.score).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes an antagonist-intelligence report and does not block chapter persistence", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    vi.spyOn(AntagonistIntelligenceReviewerAgent.prototype, "review").mockResolvedValue({
      chapter: 1,
      status: "WARN",
      score: 78,
      antagonistTypeDetected: ["谋局者"],
      dimensions: {
        antagonist_goal: 78, antagonist_method: 78, antagonist_constraint: 78,
        antagonist_cost: 78, antagonist_feedback: 78, antagonist_foreshadowing: 78,
      },
      dimensionConclusions: {
        antagonist_goal: "ok", antagonist_method: "ok", antagonist_constraint: "ok",
        antagonist_cost: "ok", antagonist_feedback: "ok", antagonist_foreshadowing: "ok",
      },
      checklistResults: Object.fromEntries(
        ["反派是否有自洽目标", "信息是否来自世界规则", "失败是否因主角伏笔", "是否避免送经验", "是否留下下一层威胁", "是否有合理痕迹"].map((k) => [k, true]),
      ),
      issues: [{
        severity: "warning",
        dimension: "antagonist_goal",
        message: "反派目标信号偏弱。",
        suggestion: "强化反派目标的可见性。",
      }],
      suggestions: ["强化反派目标。"],
      summary: "反派智能审核警告（78/100）。",
    } as AntagonistIntelligenceReport);
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({ chapterNumber: 1, content: "正文。", wordCount: 3 }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const reportPath = join(state.bookDir(bookId), "reviews", "antagonist-intelligence", "0001.report.json");
      const report = JSON.parse(await readFile(reportPath, "utf-8")) as AntagonistIntelligenceReport;

      expect(result.status).toBe("ready-for-review");
      expect(report.status).toBe("WARN");
      expect(report.score).toBe(78);
      expect(report.chapter).toBe(1);
      expect(report.antagonistTypeDetected).toContain("谋局者");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds a MISSING_CHAPTER intent alignment report when final prose is absent", async () => {
    const input: IntentAlignmentReviewInput = {
      chapter: 1,
      intentMarkdown: "# 第1章 Chapter Intent\n\n本章停在系统绑定。",
      chapterContent: "",
      intentPath: "story/runtime/chapter-intents/0001.md",
      chapterPath: "chapters/0001_Test.md",
    };
    const report = await new IntentAlignmentReviewerAgent({
      client: {} as ConstructorParameters<typeof IntentAlignmentReviewerAgent>[0]["client"],
      model: "test-model",
      projectRoot: process.cwd(),
    }).review(input);

    expect(report.status).toBe("MISSING_CHAPTER");
    expect(report.score).toBeNull();
    expect(Object.keys(report.dimensions).sort()).toEqual([...INTENT_ALIGNMENT_DIMENSIONS].sort());
    expect(report.issues[0]?.dimension).toBe("missing_chapter");
  });

  it("hard scan flags PRE_WRITE_CHECK residue in intent alignment reports", () => {
    const input: IntentAlignmentReviewInput = {
      chapter: 1,
      intentMarkdown: "# intent",
      chapterContent: "正文\n\nPRE_WRITE_CHECK\n检查项表格",
      intentPath: "story/runtime/chapter-intents/0001.md",
      chapterPath: "chapters/0001_Test.md",
    };
    const report = applyIntentAlignmentHardScan(createIntentAlignmentReport(input), input);

    expect(report.status).toBe("FAIL_REPORT_ONLY");
    expect(report.dimensions.behavior_safety_alignment).toBeLessThanOrEqual(50);
    expect(report.issues.some((issue) => issue.message.includes("非正文检查块"))).toBe(true);
  });

  it("hard scan caps climax payoff score when suppressed intent gets early payoff keywords", () => {
    const input: IntentAlignmentReviewInput = {
      chapter: 1,
      intentMarkdown: "# intent\n\nsuppress=true\n本章不得完整兑现 payoff。",
      chapterContent: "系统完整解锁，主角获得现金，还拿到明确逃生线索。",
      intentPath: "story/runtime/chapter-intents/0001.md",
      chapterPath: "chapters/0001_Test.md",
    };
    const report = applyIntentAlignmentHardScan(createIntentAlignmentReport(input), input);

    expect(report.status).toBe("WARN");
    expect(report.dimensions.climax_payoff_alignment).toBeLessThanOrEqual(60);
    expect(report.issues.some((issue) => issue.dimension === "climax_payoff_alignment")).toBe(true);
  });

  it("hard scan allows Resource Plan skill unlock but still flags forbidden cash payoff", () => {
    const resourcePlan = {
      chapter: 2,
      mode: "defer_exchange" as const,
      source: "resource-engine" as const,
      openingBalances: { 民望值: 0, 联邦币: 200 },
      expectedClosingBalances: { 民望值: 100, 联邦币: 200 },
      allowedEvents: [
        { order: 1, kind: "unlock" as const, resource: "技能", skill: "初级辩论技能", reason: "plan allowed", requiredInText: true },
        { order: 2, kind: "gain" as const, resource: "民望值", amount: 100, reason: "plan allowed", requiredInText: true },
      ],
      forbiddenEvents: ["本章禁止银行到账", "本章禁止现金兑换", "1000联邦币到账"],
      unlockedSkills: ["初级辩论技能"],
      resourceRules: { resources: {}, aliases: {}, exchangeRates: [], skills: [] },
      narrativeGuidance: [],
    };
    const allowedInput: IntentAlignmentReviewInput = {
      chapter: 2,
      intentMarkdown: "# intent\n\nsuppress=true\n本章不得提前兑现 payoff。",
      chapterContent: "系统提示：初级辩论技能兑换成功。围观路人认可，民望值+100。",
      intentPath: "story/runtime/chapter-intents/0002.md",
      chapterPath: "chapters/0002_Test.md",
      resourcePlan,
    };
    const allowedReport = applyIntentAlignmentHardScan(createIntentAlignmentReport(allowedInput), allowedInput);
    expect(allowedReport.issues.some((issue) => issue.dimension === "climax_payoff_alignment")).toBe(false);

    const forbiddenInput: IntentAlignmentReviewInput = {
      ...allowedInput,
      chapterContent: "系统提示：银行到账1000联邦币。",
    };
    const forbiddenReport = applyIntentAlignmentHardScan(createIntentAlignmentReport(forbiddenInput), forbiddenInput);
    expect(forbiddenReport.issues.some((issue) => issue.dimension === "climax_payoff_alignment")).toBe(true);
  });

  it("auto-repairs resource math before final chapter persistence and updates the ledger/state", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    const storyDir = join(state.bookDir(bookId), "story");
    await Promise.all([
      writeFile(join(storyDir, "book_rules.md"), "resourceTypes:\n  - 民望值\n  - 联邦币\n\n1点民望=10联邦币\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n| 字段 | 值 |\n|---|---|\n| 当前资源 | 民望值=0；联邦币=200 |\n", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "# 资源账本\n\n| 资源 | 当前值 | 最近更新章节 | 备注 |\n|---|---:|---:|---|\n| 民望值 | 0 | 0 | 初始 |\n| 联邦币 | 200 | 0 | 初始现金 |\n", "utf-8"),
    ]);
    const badChapter = [
      "扶起老太太后，系统提示：获得10点民望。",
      "他消耗10点民望兑换初级辩论技能。",
      "赔偿外卖78联邦币后，路人的掌声让他获得100点民望。",
      "民望值跳成100，扣除兑换技能的10点，正好余90点。",
      "他消耗100点民望兑换1000联邦币。",
    ].join("\n");
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({
      chapterNumber: 1,
      content: badChapter,
      wordCount: badChapter.length,
      updatedState: "# 当前状态\n\n| 字段 | 值 |\n|---|---|\n| 当前章节 | 1 |\n",
      updatedLedger: "writer ledger",
    }));
    const analyze = vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
        updatedState: "# 当前状态\n\n| 字段 | 值 |\n|---|---|\n| 当前章节 | 1 |\n",
        updatedLedger: "analyzed ledger",
      }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const files = await readdir(join(state.bookDir(bookId), "chapters"));
      const chapterFile = files.find((file) => /^0001_.*\.md$/u.test(file));
      expect(chapterFile).toBeTruthy();
      const finalChapter = await readFile(join(state.bookDir(bookId), "chapters", chapterFile!), "utf-8");
      const ledger = await readFile(join(storyDir, "particle_ledger.md"), "utf-8");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
      const index = await state.loadChapterIndex(bookId);

      expect(result.status).toBe("ready-for-review");
      expect(finalChapter).not.toContain("扣除兑换技能的10点，正好余90点");
      expect(finalChapter).toContain("新增的100点民望就是当前余额");
      expect(ledger).toContain("## 章节流水");
      expect(ledger).toContain("| 1 | 民望值 | 0 | +10 +100 | -10 -100 | 0 |");
      expect(ledger).toContain("| 1 | 联邦币 | 200 | +1000 | -78 | 1122 |");
      expect(currentState).toContain("当前资源");
      expect(currentState).toContain("民望值=0");
      expect(currentState).toContain("联邦币=1122");
      expect(index[0]?.auditIssues).toEqual(expect.arrayContaining([
        expect.stringContaining("[info] resource-consistency: 已按程序账本修复资源数值表达。"),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks ready-for-review and avoids ledger/state pollution when resource repair fails", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    const storyDir = join(state.bookDir(bookId), "story");
    await Promise.all([
      writeFile(join(storyDir, "book_rules.md"), "resourceTypes:\n  - 民望值\n  - 联邦币\n\n1点民望=10联邦币\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "| 当前资源 | 民望值=0；联邦币=0 |\n", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "| 民望值 | 0 |\n| 联邦币 | 0 |\n", "utf-8"),
    ]);
    const badChapter = "系统提示可透支兑换，无负债封顶。他消耗90点民望兑换1000联邦币，当前民望值：-90。";
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({
      chapterNumber: 1,
      content: badChapter,
      wordCount: badChapter.length,
    }));
    vi.spyOn(ResourceConsistencyReviserAgent.prototype, "revise").mockRejectedValue(new Error("resource reviser down"));
    vi.spyOn(ResourceBlockingRewriterAgent.prototype, "rewrite").mockResolvedValue({
      content: "系统提示可透支兑换，无负债封顶。他消耗90点民望兑换1000联邦币，当前民望值：-90。",
      usage: ZERO_USAGE,
    });
    const analyze = vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
      }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const index = await state.loadChapterIndex(bookId);
      const ledger = await readFile(join(storyDir, "particle_ledger.md"), "utf-8");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
      const resourceReport = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "resource-consistency", "0001.report.json"), "utf-8")) as {
        status: string;
        blocking: boolean;
        closureStatus: string;
        issues: ReadonlyArray<{ code: string }>;
      };
      const intentReport = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "intent-alignment", "0001.report.json"), "utf-8")) as IntentAlignmentReport;

      expect(result.status).toBe("state-degraded");
      expect(index[0]?.status).toBe("state-degraded");
      expect(ledger).toBe("| 民望值 | 0 |\n| 联邦币 | 0 |\n");
      expect(currentState.trim()).toBe("| 当前资源 | 民望值=0；联邦币=0 |");
      expect(resourceReport.status).toBe("FAILED");
      expect(resourceReport.blocking).toBe(true);
      expect(resourceReport.closureStatus).toBe("resource_failed");
      const resourceMd = await readFile(join(state.bookDir(bookId), "reviews", "resource-consistency", "0001.report.md"), "utf-8");
      expect(resourceMd).toContain("Closure Status：resource_failed");
      expect(resourceReport.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "unauthorized-resource-rule" }),
        expect.objectContaining({ code: "negative-balance" }),
      ]));
      expect(intentReport.status).toBe("SKIPPED_DUE_RESOURCE_FAILURE");
      expect(index[0]?.auditIssues).toEqual(expect.arrayContaining([
        expect.stringContaining("[critical] resource-consistency: 程序账本校验失败，本章不得继续续写"),
      ]));
      expect(index[0]?.auditIssues.some((issue) => issue.includes("已按程序账本修复"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a blocking resource failure with program-constrained rewrite and resumes normal persistence", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    const storyDir = join(state.bookDir(bookId), "story");
    await Promise.all([
      writeFile(join(storyDir, "book_rules.md"), "resourceTypes:\n  - 民望值\n  - 联邦币\n\n1点民望=10联邦币\n初级辩论技能消耗10点民望\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "| 当前资源 | 民望值=0；联邦币=200 |\n", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "| 民望值 | 0 |\n| 联邦币 | 200 |\n", "utf-8"),
    ]);
    const badChapter = "他扶老太太获得10点民望，系统提示可透支兑换。他消耗10点民望兑换1000联邦币，当前民望值：-90。";
    const fixedChapter = [
      "他扶起老太太，系统提示获得10点民望。",
      "他消耗10点民望兑换初级辩论技能，当前民望归零。",
      "他用初级辩论技能反击汤姆，围观路人认可他的做法，系统累计新增100点民望。",
      "他确认当前民望为100点，随后消耗100点民望兑换1000联邦币。",
      "当前民望归零，手机到账1000联邦币。",
    ].join("\n");
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({
      chapterNumber: 1,
      content: badChapter,
      wordCount: badChapter.length,
    }));
    vi.spyOn(ResourceConsistencyReviserAgent.prototype, "revise").mockRejectedValue(new Error("resource reviser down"));
    const rewrite = vi.spyOn(ResourceBlockingRewriterAgent.prototype, "rewrite").mockResolvedValue({
      content: fixedChapter,
      usage: ZERO_USAGE,
    });
    const analyze = vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
        updatedState: "| 当前资源 | 民望值=0；联邦币=200 |",
        updatedLedger: "analyzed ledger",
      }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const ledger = await readFile(join(storyDir, "particle_ledger.md"), "utf-8");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
      const resourceReport = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "resource-consistency", "0001.report.json"), "utf-8")) as {
        status: string;
        blocking: boolean;
        closureStatus: string;
        recoveryAttempted: boolean;
        recoveryPlan: string;
        secondValidation: string;
      };
      const index = await state.loadChapterIndex(bookId);

      expect(rewrite).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("ready-for-review");
      expect(index[0]?.status).toBe("ready-for-review");
      expect(ledger).toContain("| 1 | 民望值 | 0 | +10 +100 | -10 -100 | 0 |");
      expect(ledger).toContain("| 1 | 联邦币 | 200 | +1000 | 0 | 1200 |");
      expect(currentState).toContain("民望值=0");
      expect(currentState).toContain("联邦币=1200");
      expect(resourceReport.status).toBe("FIXED");
      expect(resourceReport.blocking).toBe(false);
      expect(resourceReport.closureStatus).toBe("normal_closed");
      expect(resourceReport.recoveryAttempted).toBe(true);
      expect(resourceReport.recoveryPlan).toBe("add_earned_resource_before_spend");
      expect(resourceReport.secondValidation).toBe("PASS");
      expect(index[0]?.auditIssues).toEqual(expect.arrayContaining([
        expect.stringContaining("[info] resource-consistency: Resource Engine blocking 已通过程序约束重写修复。"),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to defer_exchange when the cash recovery rewrite still invents credit", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    const storyDir = join(state.bookDir(bookId), "story");
    await Promise.all([
      writeFile(join(storyDir, "book_rules.md"), "resourceTypes:\n  - 民望值\n  - 联邦币\n\n1点民望=10联邦币\n初级辩论技能消耗10点民望\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "| 当前资源 | 民望值=0；联邦币=200 |\n", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "| 民望值 | 0 |\n| 联邦币 | 200 |\n", "utf-8"),
    ]);
    const badChapter = "他扶老太太获得10点民望，系统提示可透支兑换。他消耗10点民望兑换1000联邦币，当前民望值：-90。";
    const failedCashRewrite = [
      "他扶起老太太，系统提示获得10点民望。",
      "他消耗10点民望兑换初级辩论技能，当前民望归零。",
      "系统提示支持临时透支兑换，剩余90点民望缺口记为待还。",
      "当前民望值为-90点，手机到账1000联邦币。",
    ].join("\n");
    const deferExchangeRewrite = [
      "他扶起老太太，系统提示获得10点民望。",
      "他消耗10点民望兑换初级辩论技能，当前民望归零。",
      "他用初级辩论技能反击汤姆，围观路人认可他的做法，系统新增100点民望。",
      "当前民望为100点。外婆的透析费和房租仍压在胸口，他没有立刻换钱，只看见下一章把民望换成救命钱的可能。",
    ].join("\n");
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({
      chapterNumber: 1,
      content: badChapter,
      wordCount: badChapter.length,
    }));
    vi.spyOn(ResourceConsistencyReviserAgent.prototype, "revise").mockRejectedValue(new Error("resource reviser down"));
    const rewrite = vi.spyOn(ResourceBlockingRewriterAgent.prototype, "rewrite")
      .mockResolvedValueOnce({
        content: failedCashRewrite,
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: deferExchangeRewrite,
        usage: ZERO_USAGE,
      });
    const analyze = vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
        updatedState: "| 当前资源 | 民望值=100；联邦币=200 |",
        updatedLedger: "analyzed ledger",
      }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const ledger = await readFile(join(storyDir, "particle_ledger.md"), "utf-8");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
      const resourceReport = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "resource-consistency", "0001.report.json"), "utf-8")) as {
        status: string;
        blocking: boolean;
        closureStatus: string;
        recoveryAttempted: boolean;
        recoveryPlan: string;
        recoveryPlanResult: string;
        fallbackRecoveryAttempted: boolean;
        fallbackRecoveryPlan: string;
        fallbackSecondValidation: string;
        secondValidation: string;
      };
      const index = await state.loadChapterIndex(bookId);

      expect(rewrite).toHaveBeenCalledTimes(2);
      expect(analyze.mock.calls[0]?.[0].resourceAuthoritySummary).toContain("民望值=100");
      expect(analyze.mock.calls[0]?.[0].resourceAuthoritySummary).toContain("联邦币=200");
      expect(analyze.mock.calls[0]?.[0].resourceAuthoritySummary).toContain("已延后现金兑换");
      expect(rewrite.mock.calls[0]?.[0].recoveryPlan.planId).toBe("add_earned_resource_before_spend");
      expect(rewrite.mock.calls[1]?.[0].recoveryPlan.planId).toBe("defer_exchange");
      expect(result.status).toBe("ready-for-review");
      expect(index[0]?.status).toBe("ready-for-review");
      expect(ledger).toContain("| 民望值 | 100 | 1 |");
      expect(ledger).toContain("| 联邦币 | 200 | 1 |");
      expect(ledger).toContain("| 1 | 民望值 | 0 | +10 +100 | -10 | 100 |");
      expect(ledger).not.toContain("+1000");
      expect(currentState).toContain("民望值=100");
      expect(currentState).toContain("联邦币=200");
      expect(resourceReport.status).toBe("FIXED");
      expect(resourceReport.blocking).toBe(false);
      expect(resourceReport.closureStatus).toBe("normal_closed");
      expect(resourceReport.recoveryAttempted).toBe(true);
      expect(resourceReport.recoveryPlan).toBe("add_earned_resource_before_spend");
      expect(resourceReport.recoveryPlanResult).toBe("FAILED");
      expect(resourceReport.fallbackRecoveryAttempted).toBe(true);
      expect(resourceReport.fallbackRecoveryPlan).toBe("defer_exchange");
      expect(resourceReport.fallbackSecondValidation).toBe("PASS");
      expect(resourceReport.secondValidation).toBe("PASS");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies a defer_exchange template patch when fallback rewrite still cashes out", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    const storyDir = join(state.bookDir(bookId), "story");
    await Promise.all([
      writeFile(join(storyDir, "book_rules.md"), "resourceTypes:\n  - 民望值\n  - 联邦币\n\n1点民望=10联邦币\n初级辩论技能消耗10点民望\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "| 当前资源 | 民望值=0；联邦币=200 |\n", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "| 民望值 | 0 |\n| 联邦币 | 200 |\n", "utf-8"),
    ]);
    const badChapter = "他扶老太太获得10点民望，系统提示可透支兑换。他消耗10点民望兑换1000联邦币，当前民望值：-90。";
    const failedCashRewrite = [
      "他扶起老太太，系统提示获得10点民望。",
      "他消耗10点民望兑换初级辩论技能，当前民望归零。",
      "系统提示支持临时透支兑换，剩余90点民望缺口记为待还。",
      "当前民望值为-90点，手机到账1000联邦币。",
    ].join("\n");
    const failedDeferRewrite = [
      "他扶起老太太，系统提示获得10点民望。",
      "他消耗10点民望兑换初级辩论技能，当前民望归零。",
      "他用初级辩论技能反击汤姆，围观路人认可他的做法，系统新增100点民望。",
      "100点民望瞬间扣除，1000联邦币到账。",
      "电子钱包余额变成1200，透析费缺口缩小。",
    ].join("\n");
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({
      chapterNumber: 1,
      content: badChapter,
      wordCount: badChapter.length,
    }));
    vi.spyOn(ResourceConsistencyReviserAgent.prototype, "revise").mockRejectedValue(new Error("resource reviser down"));
    vi.spyOn(ResourceBlockingRewriterAgent.prototype, "rewrite")
      .mockResolvedValueOnce({ content: failedCashRewrite, usage: ZERO_USAGE })
      .mockResolvedValueOnce({ content: failedDeferRewrite, usage: ZERO_USAGE });
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
        updatedState: "| 当前资源 | 民望值=100；联邦币=200 |",
        updatedLedger: "analyzed ledger",
      }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const files = await readdir(join(state.bookDir(bookId), "chapters"));
      const chapterFile = files.find((file) => /^0001_.*\.md$/u.test(file));
      const finalChapter = await readFile(join(state.bookDir(bookId), "chapters", chapterFile!), "utf-8");
      const ledger = await readFile(join(storyDir, "particle_ledger.md"), "utf-8");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
      const resourceReport = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "resource-consistency", "0001.report.json"), "utf-8")) as {
        status: string;
        blocking: boolean;
        closureStatus: string;
        fallbackSecondValidation: string;
        templatePatchAttempted: boolean;
        templatePatchApplied: boolean;
        templatePatchValidation: string;
        balanceClaimPatchAttempted: boolean;
        balanceClaimPatchApplied: boolean;
        balanceClaimPatchResource: string;
        balanceClaimPatchFrom: number;
        balanceClaimPatchTo: number;
        removedCashFlowSnippets: string[];
        unlockedSkills: string[];
        closingBalances: Record<string, number>;
      };

      expect(result.status).toBe("ready-for-review");
      expect(finalChapter).not.toContain("1000联邦币到账");
      expect(finalChapter).not.toContain("电子钱包余额变成1200");
      expect(finalChapter).toMatch(/没有急于进行下一步的大额兑换|并未急着将/u);
      expect(finalChapter).toMatch(/当前民望值：100|当前灵石数量：100/u);
      expect(ledger).toContain("| 民望值 | 100 | 1 |");
      expect(ledger).toContain("| 联邦币 | 200 | 1 |");
      expect(ledger).toContain("| 技能 | 初级辩论技能 | 1 | 本章解锁 |");
      expect(currentState).toContain("民望值=100");
      expect(currentState).toContain("联邦币=200");
      expect(currentState).toContain("已解锁技能=初级辩论技能");
      expect(resourceReport.status).toBe("FIXED");
      expect(resourceReport.blocking).toBe(false);
      expect(resourceReport.closureStatus).toBe("normal_closed");
      expect(resourceReport.fallbackSecondValidation).toBe("FAILED");
      expect(resourceReport.templatePatchAttempted).toBe(true);
      expect(resourceReport.templatePatchApplied).toBe(true);
      expect(resourceReport.templatePatchValidation).toBe("PASS");
      expect(resourceReport.balanceClaimPatchAttempted).toBe(true);
      expect(resourceReport.balanceClaimPatchApplied).toBe(false);
      expect(resourceReport.balanceClaimPatchResource).toBe("民望值");
      expect(resourceReport.balanceClaimPatchTo).toBe(100);
      expect(resourceReport.removedCashFlowSnippets.length).toBeGreaterThan(0);
      expect(resourceReport.unlockedSkills).toContain("初级辩论技能");
      expect(resourceReport.closingBalances["民望值"]).toBe(100);
      expect(resourceReport.closingBalances["联邦币"]).toBe(200);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans non-narrative scratchpad prose before resource validation and writes a report", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({ inputGovernanceMode: "legacy" });
    const storyDir = join(state.bookDir(bookId), "story");
    await Promise.all([
      writeFile(join(storyDir, "book_rules.md"), "resourceTypes:\n  - 民望值\n  - 联邦币\n\n1点民望=10联邦币\n初级辩论技能消耗10点民望\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "| 当前资源 | 民望值=0；联邦币=200 |\n", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "| 民望值 | 0 |\n| 联邦币 | 200 |\n", "utf-8"),
    ]);
    const chapter = [
      "林默站在楼道口，盯着汤姆的背影，没有立刻开口。",
      "",
      "不对，哦，本章意图写的是压迫反击，这段应该调整一下，按提示词不能这么写。",
      "",
      "他把那句反驳压回喉咙里，等汤姆把话说完，才平静地抬起眼。",
    ].join("\n");
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(createWriterOutput({
      chapterNumber: 1,
      content: chapter,
      wordCount: chapter.length,
    }));
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
        updatedState: "| 当前资源 | 民望值=100；联邦币=200；已解锁技能=初级辩论技能 |",
        updatedLedger: "analyzed ledger",
      }));
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(createAuditResult({ passed: true, issues: [] }));

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const files = await readdir(join(state.bookDir(bookId), "chapters"));
      const chapterFile = files.find((file) => /^0001_.*\.md$/u.test(file));
      const finalChapter = await readFile(join(state.bookDir(bookId), "chapters", chapterFile!), "utf-8");
      const cleanReport = JSON.parse(await readFile(join(state.bookDir(bookId), "reviews", "clean-narrative", "0001.report.json"), "utf-8")) as {
        status: string;
        changed: boolean;
        removedSnippets: string[];
      };

      expect(result.status).toBe("ready-for-review");
      expect(finalChapter).not.toContain("本章意图");
      expect(finalChapter).not.toContain("按提示词");
      expect(finalChapter).toContain("才平静地抬起眼");
      expect(cleanReport.status).toBe("CLEANED");
      expect(cleanReport.changed).toBe(true);
      expect(cleanReport.removedSnippets.join("\n")).toContain("本章意图");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-plans instead of reusing a persisted invalid intent artifact in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(
        join(storyDir, "volume_outline.md"),
        [
          "# Volume Outline",
          "",
          "### Golden First Three Chapters Rule",
          "",
          "**Chapter 1:**",
          "Track the merchant guild trail.",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      writeFile(
        join(runtimeDir, "chapter-0001.intent.md"),
        [
          "# Chapter Intent",
          "",
          "## Goal",
          "**",
          "",
          "## Outline Node",
          "**",
          "",
          "## Must Keep",
          "- none",
          "",
          "## Must Avoid",
          "- none",
          "",
          "## Style Emphasis",
          "- none",
          "",
          "## Conflicts",
          "- none",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(planChapter).toHaveBeenCalledTimes(1);
      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.chapterIntent).toContain("Track the merchant guild trail.");
      expect(writeInput?.chapterIntent).not.toContain("\n**\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs explicit stage messages during writeNextChapter", async () => {
    const { logger, infos } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      logger,
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: "Governed pipeline draft.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(infos).toEqual(expect.arrayContaining([
        "阶段：准备章节输入",
        "阶段：撰写章节草稿",
        "阶段：审计草稿",
        "阶段：落盘最终章节",
        "阶段：生成最终真相文件",
        "阶段：校验真相文件变更",
        "阶段：同步记忆索引",
        "阶段：更新章节索引与快照",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs English stage messages during writeNextChapter for English books", async () => {
    const { logger, infos } = createCaptureLogger();
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      logger,
    });
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 220,
    };

    await state.saveBookConfig(bookId, englishBook);
    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Governed pipeline draft.",
        wordCount: countChapterLength("Governed pipeline draft.", "en_words"),
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(infos).toEqual(expect.arrayContaining([
        "Stage: preparing chapter inputs",
        "Stage: writing chapter draft",
        "Stage: auditing draft",
        "Stage: persisting final chapter",
        "Stage: rebuilding final truth files",
        "Stage: validating truth file updates",
        "Stage: syncing memory indexes",
        "Stage: updating chapter index and snapshots",
      ]));
      expect(infos.join("\n")).not.toContain("阶段：");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes English audit drift guidance into a dedicated file without polluting current_state", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 220,
    };

    await state.saveBookConfig(bookId, englishBook);
    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nKeep the pressure on the harbor debt.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), createStateCard({
        chapter: 0,
        location: "Harbor gate",
        protagonistState: "Lin Yue is tracking the vanished mentor.",
        goal: "Reach the sealed berth.",
        conflict: "The harbor debt keeps pulling him sideways.",
      }), "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The harbor seal cannot be forged.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- The vanished mentor still owes a debt.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Lin Yue reached the sealed berth before dawn.",
        wordCount: countChapterLength("Lin Yue reached the sealed berth before dawn.", "en_words"),
        updatedState: createStateCard({
          chapter: 1,
          location: "Sealed berth",
          protagonistState: "Lin Yue is winded but focused.",
          goal: "Inspect the berth before the guild arrives.",
          conflict: "The harbor debt is still active.",
        }),
        updatedHooks: "# Pending Hooks\n\n- The vanished mentor still owes a debt.\n",
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [{
          severity: "warning",
          category: "continuity",
          description: "Keep the berth timing precise in the next chapter.",
          suggestion: "Avoid skipping the dawn transition.",
        }],
        summary: "warning only",
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      const driftFile = await readFile(join(state.bookDir(bookId), "story", "audit_drift.md"), "utf-8");
      const currentState = await readFile(join(state.bookDir(bookId), "story", "current_state.md"), "utf-8");
      expect(driftFile).toContain("## Audit Drift Correction");
      expect(driftFile).toContain("> Chapter 1 audit found the following issues");
      expect(driftFile).not.toContain("## 审计纠偏");
      expect(driftFile).not.toContain("下一章写作前参照");
      expect(currentState).not.toContain("Audit Drift Correction");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes reduced control inputs into auditor and reviser in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Needs governed revision.",
        wordCount: "Needs governed revision.".length,
      }),
    );
    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: false,
        issues: [CRITICAL_ISSUE],
        summary: "needs revision",
      }),
    );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Governed revised content.",
        wordCount: "Governed revised content.".length,
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "Governed revised content.",
        wordCount: "Governed revised content.".length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(auditChapter.mock.calls[0]?.[4]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
      });
      expect(reviseChapter.mock.calls[0]?.[6]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
        lengthSpec: expect.objectContaining({
          target: 220,
          softMin: 190,
          softMax: 250,
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes governed control inputs into final truth rebuild in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });

    await Promise.all([
      writeFile(join(state.bookDir(bookId), "story", "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
      writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Original draft body.",
        wordCount: "Original draft body.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Governed revised body.",
        wordCount: "Governed revised body.".length,
      }),
    );
    const analyzeChapter = vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "Governed revised body.",
        wordCount: "Governed revised body.".length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(analyzeChapter.mock.calls[0]?.[0]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes revised output once before re-audit when it leaves the target band", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    const writerDraft = "中段正文。".repeat(40);
    const overlongRevision = "修订后正文。".repeat(60);
    const normalizedRevision = "归一正文。".repeat(40);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: writerDraft,
        wordCount: writerDraft.length,
      }),
    );
    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: overlongRevision,
        wordCount: overlongRevision.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: normalizedRevision,
      finalCount: normalizedRevision.length,
      applied: true,
      mode: "compress",
      tokenUsage: ZERO_USAGE,
    });
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: normalizedRevision,
        wordCount: normalizedRevision.length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(reviseChapter.mock.calls[0]?.[6]).toMatchObject({
        lengthSpec: expect.objectContaining({
          target: 220,
          softMin: 190,
          softMax: 250,
        }),
      });
      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect(normalizeChapter.mock.calls[0]?.[0]).toMatchObject({
        chapterContent: overlongRevision,
        lengthSpec: expect.objectContaining({
          target: 220,
        }),
      });
      expect(auditChapter.mock.calls[1]?.[1]).toBe(normalizedRevision);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes overlong writer output once before audit", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    const overlongDraft = "冗余句子。".repeat(60);
    const normalizedDraft = "压缩后的正文。".repeat(12);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: overlongDraft,
        wordCount: overlongDraft.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: normalizedDraft,
      finalCount: normalizedDraft.length,
      applied: true,
      mode: "compress",
      tokenUsage: ZERO_USAGE,
    });
    const auditChapter = vi.spyOn(
      ContinuityAuditor.prototype,
      "auditChapter",
    ).mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: normalizedDraft,
        wordCount: normalizedDraft.length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect(auditChapter.mock.calls[0]?.[1]).toBe(normalizedDraft);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes short writer output once before audit", async () => {
    const { root, runner, bookId } = await createRunnerFixture();
    const shortDraft = "短句。".repeat(20);
    const normalizedDraft = "补足后的正文。".repeat(15);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: shortDraft,
        wordCount: shortDraft.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: normalizedDraft,
      finalCount: normalizedDraft.length,
      applied: true,
      mode: "expand",
      tokenUsage: ZERO_USAGE,
    });
    const auditChapter = vi.spyOn(
      ContinuityAuditor.prototype,
      "auditChapter",
    ).mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: normalizedDraft,
        wordCount: normalizedDraft.length,
      }),
    );

    try {
      await runner.writeNextChapter(bookId, 220);

      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect(normalizeChapter.mock.calls[0]?.[0]).toMatchObject({
        chapterContent: shortDraft,
        lengthSpec: expect.objectContaining({
          target: 220,
          softMin: 190,
          softMax: 250,
        }),
      });
      expect(auditChapter.mock.calls[0]?.[1]).toBe(normalizedDraft);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a length warning when a single normalize pass still misses the hard range", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const overlongDraft = "冗余句子。".repeat(60);
    const stillOverHard = "仍然过长。".repeat(70);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: overlongDraft,
        wordCount: overlongDraft.length,
      }),
    );
    const normalizeChapter = vi.mocked(
      LengthNormalizerAgent.prototype.normalizeChapter,
    ).mockResolvedValue({
      normalizedContent: stillOverHard,
      finalCount: stillOverHard.length,
      applied: true,
      mode: "compress",
      tokenUsage: ZERO_USAGE,
    });
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: stillOverHard,
        wordCount: stillOverHard.length,
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const chapterIndex = await state.loadChapterIndex(bookId);
      const chapterMeta = chapterIndex.find((entry) => entry.number === 1);

      expect(normalizeChapter).toHaveBeenCalledTimes(1);
      expect((result as { lengthWarnings?: ReadonlyArray<string> }).lengthWarnings?.[0]).toContain(
        "超出硬区间",
      );
      expect((result as { lengthTelemetry?: { finalCount: number } }).lengthTelemetry?.finalCount).toBe(
        stillOverHard.length,
      );
      expect(chapterMeta?.lengthWarnings?.[0]).toContain("超出硬区间");
      expect(chapterMeta?.lengthTelemetry?.lengthWarning).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the last actionable audit issues when re-audit returns failed with no issues", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    const draftBody = "甲".repeat(210);
    const revisedBody = "乙".repeat(215);

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: draftBody,
        wordCount: draftBody.length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [],
          summary: "",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: revisedBody.length,
        fixedIssues: ["- tightened continuity."],
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: revisedBody,
        wordCount: revisedBody.length,
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 220);
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(result.status).toBe("audit-failed");
      expect(result.auditResult.summary).toBe("needs revision");
      expect(result.auditResult.issues).toEqual([CRITICAL_ISSUE]);
      expect(savedIndex[0]?.auditIssues).toEqual([
        `[critical] ${CRITICAL_ISSUE.description}`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves the legacy fallback when input governance mode is legacy", async () => {
    const { root, runner, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
      externalContext: "Legacy focus only.",
    });

    const planChapter = vi.spyOn(PlannerAgent.prototype, "planChapter");
    const composeChapter = vi.spyOn(ComposerAgent.prototype, "composeChapter");
    const writeChapter = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        content: "Legacy draft body.",
        wordCount: "Legacy draft body.".length,
      }),
    );

    try {
      await runner.writeDraft(bookId);

      expect(planChapter).not.toHaveBeenCalled();
      expect(composeChapter).not.toHaveBeenCalled();

      const writeInput = writeChapter.mock.calls[0]?.[0];
      expect(writeInput?.externalContext).toBe("Legacy focus only.");
      expect(writeInput?.chapterIntent).toBeUndefined();
      expect(writeInput?.contextPackage).toBeUndefined();
      expect(writeInput?.ruleStack).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the latest revised content as the input for follow-up spot-fix revisions", async () => {
    const { root, runner, bookId } = await createRunnerFixture();

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Original draft body.",
        wordCount: "Original draft body.".length,
        postWriteErrors: [
          {
            severity: "error",
            rule: "post-write",
            description: "Needs a deterministic fix",
            suggestion: "Repair the line",
          },
        ],
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(createAuditResult({
        passed: false,
        issues: [CRITICAL_ISSUE],
        summary: "needs another revision",
      }))
      .mockResolvedValueOnce(createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }));
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter")
      .mockResolvedValueOnce(createReviseOutput({
        revisedContent: "After first fix.",
        wordCount: "After first fix.".length,
      }))
      .mockResolvedValueOnce(createReviseOutput({
        revisedContent: "After second fix.",
        wordCount: "After second fix.".length,
      }));
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "After second fix.",
        wordCount: "After second fix.".length,
      }),
    );

    await runner.writeNextChapter(bookId);

    expect(reviseChapter).toHaveBeenCalledTimes(2);
    expect(reviseChapter.mock.calls[1]?.[1]).toBe("After first fix.");

    await rm(root, { recursive: true, force: true });
  });

  it("persists truth files derived from the final revised chapter", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Original draft body.",
        wordCount: "Original draft body.".length,
        updatedState: "original state",
        updatedLedger: "original ledger",
        updatedHooks: "original hooks",
        chapterSummary: "| 1 | Original summary |",
        updatedSubplots: "original subplots",
        updatedEmotionalArcs: "original emotions",
        updatedCharacterMatrix: "original matrix",
        postWriteErrors: [
          {
            severity: "error",
            rule: "post-write",
            description: "Needs a deterministic fix",
            suggestion: "Repair the line",
          },
        ],
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Final revised body.",
        wordCount: "Final revised body.".length,
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "Final revised body.",
        wordCount: "Final revised body.".length,
        updatedState: "final analyzed state",
        updatedLedger: "final analyzed ledger",
        updatedHooks: "final analyzed hooks",
        chapterSummary: "| 1 | Final analyzed summary |",
        updatedSubplots: "final analyzed subplots",
        updatedEmotionalArcs: "final analyzed emotions",
        updatedCharacterMatrix: "final analyzed matrix",
      }),
    );

    await runner.writeNextChapter(bookId);

    const storyDir = join(state.bookDir(bookId), "story");
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8"))
      .resolves.toContain("final analyzed state");
    await expect(readFile(join(storyDir, "pending_hooks.md"), "utf-8"))
      .resolves.toContain("final analyzed hooks");
    await expect(readFile(join(storyDir, "particle_ledger.md"), "utf-8"))
      .resolves.toContain("final analyzed ledger");
    await expect(readFile(join(storyDir, "chapter_summaries.md"), "utf-8"))
      .resolves.toContain("Final analyzed summary");
    await expect(readFile(join(storyDir, "subplot_board.md"), "utf-8"))
      .resolves.toContain("final analyzed subplots");
    await expect(readFile(join(storyDir, "emotional_arcs.md"), "utf-8"))
      .resolves.toContain("final analyzed emotions");
    await expect(readFile(join(storyDir, "character_matrix.md"), "utf-8"))
      .resolves.toContain("final analyzed matrix");

    await rm(root, { recursive: true, force: true });
  });

  it("persists structured runtime state and rendered projections from writer delta output", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Lin Yue follows the debt into the river-port ledger.",
        wordCount: countChapterLength("Lin Yue follows the debt into the river-port ledger.", "en_words"),
        postWriteErrors: [],
        postWriteWarnings: [],
        runtimeStateDelta: {
          chapter: 1,
          currentStatePatch: {
            currentGoal: "Follow the debt through the river-port ledger.",
            currentConflict: "Guild pressure keeps pulling against the debt trail.",
          },
          hookOps: {
            upsert: [
              {
                hookId: "mentor-debt",
                startChapter: 1,
                type: "relationship",
                status: "open",
                lastAdvancedChapter: 1,
                expectedPayoff: "Reveal why the mentor vanished.",
                notes: "The river-port ledger sharpens the debt line.",
              },
            ],
            mention: [],
            resolve: [],
            defer: [],
          },
          newHookCandidates: [],
          chapterSummary: {
            chapter: 1,
            title: "River Ledger",
            characters: "Lin Yue",
            events: "Lin Yue follows the debt into the river-port ledger.",
            stateChanges: "The debt line sharpens.",
            hookActivity: "mentor-debt advanced",
            mood: "tense",
            chapterType: "investigation",
          },
          subplotOps: [],
          emotionalArcOps: [],
          characterMatrixOps: [],
          notes: [],
        },
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    await runner.writeNextChapter(bookId);

    const storyDir = join(state.bookDir(bookId), "story");
    const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
    const hooks = await readFile(join(storyDir, "pending_hooks.md"), "utf-8");
    const summaries = await readFile(join(storyDir, "chapter_summaries.md"), "utf-8");
    const manifest = JSON.parse(await readFile(join(storyDir, "state", "manifest.json"), "utf-8"));
    const stateCurrent = JSON.parse(await readFile(join(storyDir, "state", "current_state.json"), "utf-8"));
    const stateHooks = JSON.parse(await readFile(join(storyDir, "state", "hooks.json"), "utf-8"));
    const stateSummaries = JSON.parse(await readFile(join(storyDir, "state", "chapter_summaries.json"), "utf-8"));

    expect(currentState).toContain("Follow the debt through the river-port ledger.");
    expect(hooks).toContain("mentor-debt");
    expect(summaries).toContain("River Ledger");
    expect(manifest.lastAppliedChapter).toBe(1);
    expect(stateCurrent.chapter).toBe(1);
    expect(stateHooks.hooks[0]?.hookId).toBe("mentor-debt");
    expect(stateSummaries.rows[0]?.title).toBe("River Ledger");

    await rm(root, { recursive: true, force: true });
  });

  it("repairs chapter-number drift in writer delta before persisting runtime state", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    await mkdir(join(storyDir, "state"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "state", "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 0,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "current_state.json"), JSON.stringify({
        chapter: 0,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "hooks.json"), JSON.stringify({
        hooks: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Broken chapter body.",
        wordCount: countChapterLength("Broken chapter body.", "en_words"),
        postWriteErrors: [],
        postWriteWarnings: [],
        runtimeStateDelta: {
          chapter: 0,
          hookOps: {
            upsert: [],
            resolve: [],
            defer: [],
          },
          notes: [],
        } as unknown as NonNullable<ReturnType<typeof createWriterOutput>["runtimeStateDelta"]>,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    const result = await runner.writeNextChapter(bookId);

    expect(result.status).toBe("ready-for-review");
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8"))
      .resolves.toMatch(/\|\s*(Current Chapter|当前章节)\s*\|\s*1\s*\|/);
    await expect(readFile(join(storyDir, "state", "manifest.json"), "utf-8"))
      .resolves.toContain("\"lastAppliedChapter\": 1");

    await rm(root, { recursive: true, force: true });
  });

  it("rolls back persisted runtime state when writer delta contains natural-language numeric drift", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    await mkdir(join(storyDir, "state"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(storyDir, "state", "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 0,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "current_state.json"), JSON.stringify({
        chapter: 0,
        facts: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "hooks.json"), JSON.stringify({
        hooks: [],
      }, null, 2), "utf-8"),
      writeFile(join(storyDir, "state", "chapter_summaries.json"), JSON.stringify({
        rows: [],
      }, null, 2), "utf-8"),
    ]);

    const beforeState = await readFile(join(storyDir, "current_state.md"), "utf-8");
    const beforeManifest = await readFile(join(storyDir, "state", "manifest.json"), "utf-8");

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Broken chapter body.",
        wordCount: countChapterLength("Broken chapter body.", "en_words"),
        postWriteErrors: [],
        postWriteWarnings: [],
        runtimeStateDelta: {
          chapter: 1,
          hookOps: {
            upsert: [
              {
                hookId: "mentor-debt",
                startChapter: 1,
                type: "relationship",
                status: "open",
                lastAdvancedChapter: "chapter one",
                expectedPayoff: "Reveal the debt.",
                notes: "Bad numeric drift.",
              },
            ],
            resolve: [],
            defer: [],
          },
          notes: [],
        } as unknown as NonNullable<ReturnType<typeof createWriterOutput>["runtimeStateDelta"]>,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow();

    await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe(beforeState);
    await expect(readFile(join(storyDir, "state", "manifest.json"), "utf-8")).resolves.toBe(beforeManifest);

    await rm(root, { recursive: true, force: true });
  });

  it("degrades to state-degraded when state validation errors instead of aborting", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Healthy chapter body.",
        wordCount: "Healthy chapter body.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(StateValidatorAgent.prototype, "validate").mockRejectedValue(
      new Error("LLM returned empty response"),
    );

    const result = await runner.writeNextChapter(bookId);
    expect(result.status).toBe("state-degraded");

    // Chapter should be saved (content is fine, only truth files are degraded)
    const index = await state.loadChapterIndex(bookId);
    expect(index).toHaveLength(1);
    expect(index[0]!.status).toBe("state-degraded");

    await rm(root, { recursive: true, force: true });
  });

  it("retries settlement after state contradictions without rewriting the chapter body", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const storyDir = join(state.bookDir(bookId), "story");

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "stable state", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "stable hooks", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "stable ledger", "utf-8"),
    ]);

    const writeSpy = vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Healthy chapter body with the copper token in his coat.",
        wordCount: "Healthy chapter body with the copper token in his coat.".length,
        updatedState: "broken state",
        updatedHooks: "broken hooks",
        updatedLedger: "broken ledger",
      }),
    );
    const settleSpy = vi.spyOn(
      WriterAgent.prototype as unknown as {
        settleChapterState: (input: Record<string, unknown>) => Promise<WriteChapterOutput>;
      },
      "settleChapterState",
    ).mockResolvedValue(
      createWriterOutput({
        content: "Healthy chapter body with the copper token in his coat.",
        wordCount: "Healthy chapter body with the copper token in his coat.".length,
        updatedState: "fixed state",
        updatedHooks: "fixed hooks",
        updatedLedger: "fixed ledger",
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
        updatedState: "fixed state",
        updatedHooks: "fixed hooks",
        updatedLedger: "fixed ledger",
      }));
    vi.spyOn(StateValidatorAgent.prototype, "validate")
      .mockResolvedValueOnce({
        passed: false,
        warnings: [{
          category: "unsupported_change",
          description: "状态写成铜牌未带在身上，但正文明确写了怀里的铜牌。",
        }],
      })
      .mockResolvedValueOnce({
        passed: true,
        warnings: [],
      });

    const result = await runner.writeNextChapter(bookId);

    expect(result.status).toBe("ready-for-review");
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(settleSpy).toHaveBeenCalledWith(expect.objectContaining({
      chapterNumber: 1,
      title: "Test Chapter",
      validationFeedback: expect.stringContaining("怀里的铜牌"),
    }));
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("fixed state");
    await expect(readFile(join(storyDir, "pending_hooks.md"), "utf-8")).resolves.toBe("fixed hooks");

    await rm(root, { recursive: true, force: true });
  });

  it("persists a state-degraded chapter without advancing truth files when settlement retry still contradicts the body", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "stable state", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "stable hooks", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "stable ledger", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Healthy chapter body with the copper token in his coat.",
        wordCount: "Healthy chapter body with the copper token in his coat.".length,
        updatedState: "broken state",
        updatedHooks: "broken hooks",
        updatedLedger: "broken ledger",
      }),
    );
    vi.spyOn(
      WriterAgent.prototype as unknown as {
        settleChapterState: (input: Record<string, unknown>) => Promise<WriteChapterOutput>;
      },
      "settleChapterState",
    ).mockResolvedValue(
      createWriterOutput({
        content: "Healthy chapter body with the copper token in his coat.",
        wordCount: "Healthy chapter body with the copper token in his coat.".length,
        updatedState: "still broken state",
        updatedHooks: "still broken hooks",
        updatedLedger: "still broken ledger",
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
        updatedState: "still broken state",
        updatedHooks: "still broken hooks",
        updatedLedger: "still broken ledger",
      }));
    vi.spyOn(StateValidatorAgent.prototype, "validate")
      .mockResolvedValueOnce({
        passed: false,
        warnings: [{
          category: "unsupported_change",
          description: "settler 把铜牌写没了，但正文仍然明确带在身上。",
        }],
      })
      .mockResolvedValueOnce({
        passed: false,
        warnings: [{
          category: "unsupported_change",
          description: "重试后仍然把铜牌写没了。",
        }],
      });

    const result = await runner.writeNextChapter(bookId);
    const savedIndex = await state.loadChapterIndex(bookId);

    expect(result.status).toBe("state-degraded");
    expect(savedIndex[0]?.status).toBe("state-degraded");
    expect(savedIndex[0]?.auditIssues).toContain("[warning] 重试后仍然把铜牌写没了。");
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("stable state");
    await expect(readFile(join(storyDir, "pending_hooks.md"), "utf-8")).resolves.toBe("stable hooks");
    await expect(readFile(join(storyDir, "particle_ledger.md"), "utf-8")).resolves.toBe("stable ledger");
    await expect(readdir(chaptersDir)).resolves.toContain("0001_Test_Chapter.md");
    await expect(stat(join(storyDir, "snapshots", "1"))).rejects.toThrow();

    await rm(root, { recursive: true, force: true });
  });

  it("throws when a post-freeze recovery path mutates FINAL_TITLE into a collapsed anchor title", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    const now = "2026-04-21T00:00:00.000Z";

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "stable state", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "stable hooks", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "stable ledger", "utf-8"),
      writeFile(join(chaptersDir, "0001_暗河尽头的秘密.md"), "# 第1章 暗河尽头的秘密\n\n旧章节。", "utf-8"),
      writeFile(join(chaptersDir, "0002_暗河尽头前的死局_探索并未.md"), "# 第2章 暗河尽头前的死局：探索并未\n\n旧章节。", "utf-8"),
      writeFile(join(chaptersDir, "0003_暗河尽头前的死局_楚夜云岚击败.md"), "# 第3章 暗河尽头前的死局：楚夜云岚击败\n\n旧章节。", "utf-8"),
      writeFile(join(chaptersDir, "0004_暗河尽头前的死局_楚夜云岚站暗.md"), "# 第4章 暗河尽头前的死局：楚夜云岚站暗\n\n旧章节。", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [
      { number: 1, title: "暗河尽头的秘密", status: "ready-for-review", wordCount: 12, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [] },
      { number: 2, title: "暗河尽头前的死局：探索并未", status: "ready-for-review", wordCount: 12, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [] },
      { number: 3, title: "暗河尽头前的死局：楚夜云岚击败", status: "ready-for-review", wordCount: 12, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [] },
      { number: 4, title: "暗河尽头前的死局：楚夜云岚站暗", status: "ready-for-review", wordCount: 12, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [] },
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 5,
        title: "未知强敌威胁逼近之时",
        content: "Healthy chapter body with a clear threat beat.",
        wordCount: "Healthy chapter body with a clear threat beat.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(StateValidatorAgent.prototype, "validate")
      .mockResolvedValueOnce({
        passed: false,
        warnings: [{
          category: "unsupported_change",
          description: "state retry needed",
        }],
      })
      .mockResolvedValueOnce({
        passed: true,
        warnings: [],
      });
    vi.spyOn(
      WriterAgent.prototype as unknown as {
        settleChapterState: (input: Record<string, unknown>) => Promise<WriteChapterOutput>;
      },
      "settleChapterState",
    ).mockResolvedValue(
      createWriterOutput({
        chapterNumber: 5,
        title: "暗河尽头的古老祭坛",
        content: "Healthy chapter body with a clear threat beat.",
        wordCount: "Healthy chapter body with a clear threat beat.".length,
        updatedState: "fixed state",
        updatedHooks: "fixed hooks",
        updatedLedger: "fixed ledger",
      }),
    );

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/FINAL_TITLE/);

    await rm(root, { recursive: true, force: true });
  });

  it("blocks writing a new chapter when the latest persisted chapter is state-degraded", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const now = "2026-03-19T00:00:00.000Z";
    const storyDir = join(state.bookDir(bookId), "story");

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "stable state", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "stable hooks", "utf-8"),
      state.saveChapterIndex(bookId, [{
        number: 1,
        title: "Broken Persistence",
        status: "state-degraded" as ChapterMeta["status"],
        wordCount: 1234,
        createdAt: now,
        updatedAt: now,
        auditIssues: ["[warning] state validation degraded"],
        lengthWarnings: [],
      }]),
      writeFile(join(state.bookDir(bookId), "chapters", "0001_Broken_Persistence.md"), "# 第1章 Broken Persistence\n\nbody", "utf-8"),
    ]);

    await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/state-degraded/i);

    await rm(root, { recursive: true, force: true });
  });

  it("repairs the latest state-degraded chapter from persisted body without rewriting it", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const now = "2026-03-19T00:00:00.000Z";
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), "stable state", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "stable hooks", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "stable ledger", "utf-8"),
      writeFile(
        join(bookDir, "chapters", "0001_Broken_Persistence.md"),
        "# 第1章 Broken Persistence\n\nHealthy chapter body with the copper token in his coat.",
        "utf-8",
      ),
      state.saveChapterIndex(bookId, [{
        number: 1,
        title: "Broken Persistence",
        status: "state-degraded" as ChapterMeta["status"],
        wordCount: 55,
        createdAt: now,
        updatedAt: now,
        auditIssues: ["[warning] 重试后仍然把铜牌写没了。"],
        lengthWarnings: [],
        reviewNote: JSON.stringify({
          kind: "state-degraded",
          baseStatus: "ready-for-review",
          injectedIssues: ["[warning] 重试后仍然把铜牌写没了。"],
        }),
      }]),
    ]);

    const settleSpy = vi.spyOn(
      WriterAgent.prototype as unknown as {
        settleChapterState: (input: Record<string, unknown>) => Promise<WriteChapterOutput>;
      },
      "settleChapterState",
    ).mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        title: "Broken Persistence",
        content: "Healthy chapter body with the copper token in his coat.",
        wordCount: "Healthy chapter body with the copper token in his coat.".length,
        updatedState: "fixed state",
        updatedHooks: "fixed hooks",
        updatedLedger: "fixed ledger",
      }),
    );
    vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
      passed: true,
      warnings: [],
    });

    const result = await (
      runner as unknown as {
        repairChapterState: (bookId: string, chapterNumber?: number) => Promise<{
          status: string;
          chapterNumber: number;
        }>;
      }
    ).repairChapterState(bookId, 1);
    const savedIndex = await state.loadChapterIndex(bookId);

    expect(result.status).toBe("ready-for-review");
    expect(result.chapterNumber).toBe(1);
    expect(settleSpy).toHaveBeenCalledWith(expect.objectContaining({
      allowReapply: true,
    }));
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("fixed state");
    await expect(readFile(join(storyDir, "pending_hooks.md"), "utf-8")).resolves.toBe("fixed hooks");
    expect(savedIndex[0]?.status).toBe("ready-for-review");
    expect(savedIndex[0]?.auditIssues).toEqual([]);
    expect(savedIndex[0]?.reviewNote).toBeUndefined();

    await rm(root, { recursive: true, force: true });
  });

  it("syncs the latest edited chapter body back into truth files without requiring state-degraded status", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      externalContext: "把注意力收回师债主线。",
    });
    const now = "2026-03-19T00:00:00.000Z";
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n## 当前重点\n\n商会路线优先。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# 卷纲\n\n## 第1章\n先处理商会路线噪音。\n", "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# 世界观设定\n\n- 誓令碎片不可伪造。\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "stable state", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "stable hooks", "utf-8"),
      writeFile(join(storyDir, "particle_ledger.md"), "stable ledger", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 夜灯 | 林越 | 林越继续追查师债 | 追查意图更强 | 师债推进 | 压抑 | 主线推进 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(
        join(bookDir, "chapters", "0001_夜灯.md"),
        "# 第1章 夜灯\n\n林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。",
        "utf-8",
      ),
      state.saveChapterIndex(bookId, [{
        number: 1,
        title: "夜灯",
        status: "approved" as ChapterMeta["status"],
        wordCount: 55,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      }]),
    ]);

    const settleSpy = vi.spyOn(
      WriterAgent.prototype as unknown as {
        settleChapterState: (input: Record<string, unknown>) => Promise<WriteChapterOutput>;
      },
      "settleChapterState",
    ).mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        title: "夜灯",
        content: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。",
        wordCount: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。".length,
        updatedState: "synced state",
        updatedHooks: "synced hooks",
        updatedLedger: "synced ledger",
      }),
    );
    vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
      passed: true,
      warnings: [],
    });

    const result = await (
      runner as unknown as {
        resyncChapterArtifacts: (bookId: string, chapterNumber?: number) => Promise<{
          status: string;
          chapterNumber: number;
        }>;
      }
    ).resyncChapterArtifacts(bookId, 1);
    const savedIndex = await state.loadChapterIndex(bookId);

    expect(result.status).toBe("approved");
    expect(result.chapterNumber).toBe(1);
    expect(settleSpy).toHaveBeenCalledWith(expect.objectContaining({
      allowReapply: true,
      chapterIntent: expect.stringContaining("把注意力收回师债主线"),
    }));
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("synced state");
    await expect(readFile(join(storyDir, "pending_hooks.md"), "utf-8")).resolves.toBe("synced hooks");
    expect(savedIndex[0]?.status).toBe("approved");

    await rm(root, { recursive: true, force: true });
  });

  it("still persists the chapter when the state validator appends markdown after a valid JSON verdict", async () => {
    vi.restoreAllMocks();
    vi.spyOn(LengthNormalizerAgent.prototype, "normalizeChapter").mockImplementation(
      async ({ chapterContent, lengthSpec }) => ({
        normalizedContent: chapterContent,
        finalCount: countChapterLength(chapterContent, lengthSpec.countingMode),
        applied: false,
        mode: "none",
        tokenUsage: ZERO_USAGE,
      }),
    );

    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const finalBody = "Validated chapter body that should still persist.";

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: finalBody,
        wordCount: finalBody.length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: finalBody,
        wordCount: finalBody.length,
      }),
    );
    vi.spyOn(
      StateValidatorAgent.prototype as unknown as {
        chat: (...args: unknown[]) => Promise<{ content: string; usage: typeof ZERO_USAGE }>;
      },
      "chat",
    ).mockResolvedValue({
      content: [
        "{\"warnings\":[],\"passed\":true}",
        "",
        "## Notes",
        "Trailing markdown can include } braces and should not abort persistence.",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    const result = await runner.writeNextChapter(bookId);

    expect(result.chapterNumber).toBe(1);
    await expect(readFile(join(chaptersDir, "0001_Test_Chapter.md"), "utf-8"))
      .resolves.toContain(finalBody);
    await expect(state.loadChapterIndex(bookId)).resolves.toEqual([
      expect.objectContaining({
        number: 1,
        title: "Test Chapter",
      }),
    ]);

    await rm(root, { recursive: true, force: true });
  });

  it("preserves the revised chapter content when final truth rebuild omits CHAPTER_CONTENT", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "legacy",
    });
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const revisedBody = "Final revised body that should never be replaced by an empty chapter.";

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        content: "Original draft body.",
        wordCount: "Original draft body.".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: revisedBody.length,
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        content: "",
        wordCount: 0,
      }),
    );

    const result = await runner.writeNextChapter(bookId);
    const savedChapter = await readFile(join(chaptersDir, "0001_Test_Chapter.md"), "utf-8");
    const savedIndex = await state.loadChapterIndex(bookId);
    const expectedCount = countChapterLength(revisedBody, "zh_chars");

    expect(result.wordCount).toBe(expectedCount);
    expect(savedChapter).toContain(revisedBody);
    expect(savedIndex[0]?.wordCount).toBe(expectedCount);
    expect(savedIndex[0]?.status).toBe("ready-for-review");

    await rm(root, { recursive: true, force: true });
  });

  it("reports only resumed chapters in import results", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const now = "2026-03-19T00:00:00.000Z";
    const existingIndex: ChapterMeta[] = [
      {
        number: 1,
        title: "One",
        status: "imported",
        wordCount: 10,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Two",
        status: "imported",
        wordCount: 20,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
    ];
    await state.saveChapterIndex(bookId, existingIndex);

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle ?? `Chapter ${input.chapterNumber}`,
        content: input.chapterContent,
        wordCount: input.chapterContent.length,
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);

    const result = await runner.importChapters({
      bookId,
      resumeFrom: 3,
      chapters: [
        { title: "One", content: "1111111111" },
        { title: "Two", content: "22222222222222222222" },
        { title: "Three", content: "333333333333333" },
        { title: "Four", content: "4444444444444444444444444" },
      ],
    });

    expect(result.importedCount).toBe(2);
    expect(result.totalWords).toBe("333333333333333".length + "4444444444444444444444444".length);
    expect(result.nextChapter).toBe(5);

    await rm(root, { recursive: true, force: true });
  });

  it("keeps fanfic initialization running when style guide extraction fails", async () => {
    const { root, runner, state } = await createRunnerFixture();
    const bookId = "fanfic-style-fallback";
    const now = "2026-03-19T00:00:00.000Z";
    const book: BookConfig = {
      id: bookId,
      title: "Fanfic Fallback",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 3000,
      createdAt: now,
      updatedAt: now,
    };

    vi.spyOn(runner, "importFanficCanon").mockImplementation(async (targetBookId) => {
      const storyDir = join(state.bookDir(targetBookId), "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "fanfic_canon.md"), "# Fanfic Canon\n", "utf-8");
      return "# Fanfic Canon\n";
    });
    vi.spyOn(ArchitectAgent.prototype, "generateFanficFoundation").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Lantern quay",
        protagonistState: "Lin Yue enters the fanfic timeline with a hidden debt.",
        goal: "Find the canon fissure.",
        conflict: "The old faction watches every move.",
      }),
      pendingHooks: "# Pending Hooks\n",
      structureSignals: validStructureSignalsSection(),
    }));
    vi.spyOn(runner, "generateStyleGuide").mockRejectedValue(new Error("style failed"));

    try {
      await expect(runner.initFanficBook(book, "A".repeat(600), "canon.txt", "canon")).resolves.toBeUndefined();

      expect(await state.loadChapterIndex(bookId)).toEqual([]);
      await expect(readFile(join(state.bookDir(bookId), "story", "fanfic_canon.md"), "utf-8")).resolves.toContain("Fanfic Canon");
      await expect(stat(join(state.bookDir(bookId), "story", "snapshots", "0"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps canon import running when style guide extraction fails", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const parentBookId = "parent-book";
    const now = "2026-03-19T00:00:00.000Z";
    const parentBook: BookConfig = {
      id: parentBookId,
      title: "Parent Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 3000,
      createdAt: now,
      updatedAt: now,
    };
    const parentStoryDir = join(state.bookDir(parentBookId), "story");
    const parentChaptersDir = join(state.bookDir(parentBookId), "chapters");

    await state.saveBookConfig(parentBookId, parentBook);
    await mkdir(parentStoryDir, { recursive: true });
    await mkdir(parentChaptersDir, { recursive: true });
    await Promise.all([
      writeFile(join(parentStoryDir, "story_bible.md"), "# Story Bible\n", "utf-8"),
      writeFile(join(parentStoryDir, "current_state.md"), createStateCard({
        chapter: 3,
        location: "North watchtower",
        protagonistState: "The mentor debt is no longer secret.",
        goal: "Protect the watchtower archive.",
        conflict: "Guild spies are already inside the archive.",
      }), "utf-8"),
      writeFile(join(parentStoryDir, "particle_ledger.md"), "# Ledger\n", "utf-8"),
      writeFile(join(parentStoryDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(parentStoryDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
      writeFile(join(parentChaptersDir, "0001_Parent.md"), `# Chapter 1\n\n${"Parent text. ".repeat(60)}`, "utf-8"),
    ]);

    vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: "# Parent Canon\n\nImported canon body.",
    } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);
    vi.spyOn(runner, "generateStyleGuide").mockRejectedValue(new Error("style failed"));

    try {
      const canon = await runner.importCanon(bookId, parentBookId);

      expect(canon).toContain("# Parent Canon");
      await expect(readFile(join(state.bookDir(bookId), "story", "parent_canon.md"), "utf-8")).resolves.toContain("Imported canon body.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps chapter import running when style guide extraction fails", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const chapterContent = "章节正文。".repeat(120);

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }),
      pendingHooks: "# Pending Hooks\n",
      structureSignals: validStructureSignalsSection(),
    }));
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: chapterContent,
        wordCount: chapterContent.length,
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);
    vi.spyOn(runner, "generateStyleGuide").mockRejectedValue(new Error("style failed"));

    try {
      const result = await runner.importChapters({
        bookId,
        chapters: [
          { title: "Prelude", content: chapterContent },
        ],
      });

      expect(result.importedCount).toBe(1);
      expect((await state.loadChapterIndex(bookId))[0]?.status).toBe("imported");
      await expect(readFile(join(state.bookDir(bookId), "story", "story_bible.md"), "utf-8")).resolves.toContain("# Story Bible");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("rebuilds fact history from imported chapter snapshots", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Shrine outskirts",
        protagonistState: "Lin Yue begins with the oath token hidden.",
        goal: "Reach the trial city.",
        conflict: "The trial deadline is closing in.",
      }),
      pendingHooks: "# Pending Hooks\n",
      structureSignals: validStructureSignalsSection(),
    }));

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter")
      .mockResolvedValueOnce(createAnalyzedOutput({
        chapterNumber: 1,
        title: "One",
        content: "One body.",
        wordCount: "One body.".length,
        updatedState: createStateCard({
          chapter: 1,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The mentor debt is still personal.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }))
      .mockResolvedValueOnce(createAnalyzedOutput({
        chapterNumber: 2,
        title: "Two",
        content: "Two body.",
        wordCount: "Two body.".length,
        updatedState: createStateCard({
          chapter: 2,
          location: "North watchtower",
          protagonistState: "Lin Yue finally shows the oath token.",
          goal: "Reach the watchtower before the guild.",
          conflict: "The merchant guild now contests the mentor trail.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }));

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "One", content: "One body." },
          { title: "Two", content: "Two body." },
        ],
      });

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        const chapterOneFacts = memoryDb.getFactsAt("protagonist", 1);
        const currentFacts = memoryDb.getCurrentFacts();

        expect(chapterOneFacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "The mentor debt is still personal.",
            }),
          ]),
        );
        expect(currentFacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "The merchant guild now contests the mentor trail.",
              validFromChapter: 2,
              sourceChapter: 2,
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("rebuilds fact history from structured snapshot state instead of stale markdown snapshots", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const snapshotOneDir = join(storyDir, "snapshots", "1");
    const snapshotOneStateDir = join(snapshotOneDir, "state");
    await mkdir(snapshotOneStateDir, { recursive: true });

    await Promise.all([
      writeFile(
        join(snapshotOneDir, "current_state.md"),
        createStateCard({
          chapter: 1,
          location: "Old markdown ferry crossing",
          protagonistState: "Markdown state still hides the oath token.",
          goal: "Follow the markdown trail.",
          conflict: "Old markdown conflict.",
        }),
        "utf-8",
      ),
      writeFile(join(snapshotOneStateDir, "current_state.json"), JSON.stringify({
        chapter: 1,
        facts: [
          {
            subject: "current",
            predicate: "Current Location",
            object: "Structured watchtower",
            validFromChapter: 1,
            validUntilChapter: null,
            sourceChapter: 1,
          },
          {
            subject: "protagonist",
            predicate: "Current Conflict",
            object: "Structured conflict replaces markdown drift.",
            validFromChapter: 1,
            validUntilChapter: null,
            sourceChapter: 1,
          },
        ],
      }, null, 2), "utf-8"),
    ]);

    try {
      await (runner as unknown as {
        syncCurrentStateFactHistory: (targetBookId: string, uptoChapter: number) => Promise<void>;
      }).syncCurrentStateFactHistory(bookId, 1);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getCurrentFacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Location",
              object: "Structured watchtower",
              validFromChapter: 1,
            }),
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "Structured conflict replaces markdown drift.",
              validFromChapter: 1,
            }),
          ]),
        );
        expect(memoryDb.getCurrentFacts()).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              object: "Old markdown ferry crossing",
            }),
            expect.objectContaining({
              object: "Old markdown conflict.",
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tracks imported English chapters using word counts instead of characters", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
    };
    const now = "2026-03-19T00:00:00.000Z";

    await state.saveBookConfig(bookId, englishBook);
    await state.saveChapterIndex(bookId, [
      {
        number: 1,
        title: "Prelude",
        status: "imported",
        wordCount: 3,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Crossroads",
        status: "imported",
        wordCount: 2,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementation(async (input) =>
      createAnalyzedOutput({
        chapterNumber: input.chapterNumber,
        title: input.chapterTitle ?? `Chapter ${input.chapterNumber}`,
        content: input.chapterContent,
        wordCount: countChapterLength(input.chapterContent, "en_words"),
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);

    const result = await runner.importChapters({
      bookId,
      resumeFrom: 3,
      chapters: [
        { title: "Prelude", content: "One two three" },
        { title: "Crossroads", content: "Four five" },
        { title: "The Watchtower", content: "The storm kept rolling west" },
        { title: "Aftermath", content: "Lanterns dimmed before dawn broke" },
      ],
    });

    const chapterIndex = await state.loadChapterIndex(bookId);
    const chapterThree = chapterIndex.find((entry) => entry.number === 3);
    const chapterFour = chapterIndex.find((entry) => entry.number === 4);

    expect(result.importedCount).toBe(2);
    expect(result.totalWords).toBe(10);
    expect(chapterThree?.wordCount).toBe(5);
    expect(chapterFour?.wordCount).toBe(5);

    await rm(root, { recursive: true, force: true });
  });

  it("imports English chapters with English foundation seeds and persistence files", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 2200,
    };

    await state.saveBookConfig(bookId, englishBook);

    const foundation = vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue(completeEnglishFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Harbor gate",
        protagonistState: "Mara arrives with a sealed letter.",
        goal: "Find the missing captain before sunrise.",
        conflict: "The harbor watch is searching every ship.",
      }),
      pendingHooks: "# Pending Hooks\n\n| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |\n| --- | --- | --- | --- | --- | --- | --- |\n",
      structureSignals: validStructureSignalsSection(),
    }));
    const saveChapter = vi.spyOn(WriterAgent.prototype, "saveChapter");

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: "A cold wind crossed the harbor.",
        wordCount: countChapterLength("A cold wind crossed the harbor.", "en_words"),
        updatedState: createStateCard({
          chapter: 1,
          location: "Harbor gate",
          protagonistState: "Mara hides the sealed letter under her coat.",
          goal: "Slip past the harbor watch.",
          conflict: "The watch now searches for the missing captain's courier.",
        }),
        updatedHooks: "# Pending Hooks\n\n| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |\n| --- | --- | --- | --- | --- | --- | --- |\n| captain-letter | 1 | mystery | open | 1 | The captain's disappearance is explained. | The sealed letter points to the vanished captain. |\n",
        chapterSummary: "| 1 | Prelude | Mara | Mara reaches the harbor with a sealed letter. | Mara hides the letter and studies the watch patrol. | The captain-letter mystery opens. | tense | setup |",
        updatedSubplots: [
          "# Subplot Board",
          "",
          "| Subplot | Status | Note |",
          "| --- | --- | --- |",
          "| Harbor search | Active | Mara begins the search for the missing captain. |",
          "",
        ].join("\n"),
        updatedEmotionalArcs: "",
        updatedCharacterMatrix: "",
      }),
    );

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "Prelude", content: "A cold wind crossed the harbor." },
        ],
      });

      const storyDir = join(state.bookDir(bookId), "story");
      const chapterPath = join(state.bookDir(bookId), "chapters", "0001_Prelude.md");
      const chapterFile = await readFile(chapterPath, "utf-8");
      const chapterSummaries = await readFile(join(storyDir, "chapter_summaries.md"), "utf-8");
      const subplotBoard = await readFile(join(storyDir, "subplot_board.md"), "utf-8");

      expect(foundation.mock.calls[0]?.[1]).toContain("Chapter 1: Prelude");
      expect(foundation.mock.calls[0]?.[1]).not.toContain("第1章");
      expect(saveChapter.mock.calls[0]?.[3]).toBe("en");
      expect(chapterFile).toContain("# Chapter 1: Prelude");
      expect(chapterSummaries).toContain("# Chapter Summaries");
      expect(chapterSummaries).not.toContain("# 章节摘要");
      expect(subplotBoard).toContain("# Subplot Board");
      expect(subplotBoard).not.toContain("# 支线进度板");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs localized replay progress during chapter import", async () => {
    const { logger, infos } = createCaptureLogger();
    const { root, runner, bookId } = await createRunnerFixture({ logger });

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }),
      pendingHooks: "# Pending Hooks\n",
      structureSignals: validStructureSignalsSection(),
    }));
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: "章节正文。",
        wordCount: "章节正文。".length,
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "第一章", content: "章节正文。" },
        ],
      });

      expect(infos).toEqual(expect.arrayContaining([
        "步骤 1：从 1 章生成基础设定...",
        "基础设定已生成。",
        "步骤 2：从第 1 章开始顺序回放...",
        "分析章节 1/1：第一章...",
        "完成。已导入 1 章，共 5字。下一章：2",
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes governed control inputs into import replay analyzer in v2 mode", async () => {
    const { root, runner, bookId } = await createRunnerFixture();

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue(completeFoundationOutput({
      storyBible: "# Story Bible\n\n- Keep the harbor search grounded in the missing captain thread.\n",
      volumeOutline: "# Volume Outline\n\n## Volume 1\n- Chapter 1: Mara arrives at the harbor with the sealed letter.\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n\n- Stay close to Mara's viewpoint.\n",
      currentState: createStateCard({
        chapter: 0,
        location: "Harbor gate",
        protagonistState: "Mara arrives carrying a sealed letter.",
        goal: "Enter the harbor unnoticed.",
        conflict: "The harbor watch is hunting the captain's courier.",
      }),
      pendingHooks: [
        "# Pending Hooks",
        "",
        "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| captain-letter | 1 | mystery | open | 0 | The captain's disappearance is explained. | The sealed letter points to the missing captain. |",
        "",
      ].join("\n"),
      structureSignals: validStructureSignalsSection(),
    }));

    const analyzeChapter = vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: "A cold wind crossed the harbor.",
        wordCount: countChapterLength("A cold wind crossed the harbor.", "en_words"),
      }),
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockResolvedValue(undefined);
    vi.spyOn(WriterAgent.prototype, "saveNewTruthFiles").mockResolvedValue(undefined);

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "Prelude", content: "A cold wind crossed the harbor." },
        ],
      });

      expect(analyzeChapter.mock.calls[0]?.[0]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leak imported future state into early replay chapters", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const englishBook = {
      ...(await state.loadBookConfig(bookId)),
      genre: "other",
      language: "en" as const,
      chapterWordCount: 2200,
    };

    await state.saveBookConfig(bookId, englishBook);
    await mkdir(join(storyDir, "snapshots", "0"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "subplot_board.md"), "# Subplot Board\n\nFUTURE LEAK subplot\n", "utf-8"),
      writeFile(join(storyDir, "emotional_arcs.md"), "# Emotional Arcs\n\nFUTURE LEAK emotion\n", "utf-8"),
      writeFile(join(storyDir, "character_matrix.md"), "# Character Matrix\n\nFUTURE LEAK matrix\n", "utf-8"),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# Chapter Summaries",
          "",
          "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| 99 | Future | Future Cast | FUTURE LEAK event | FUTURE LEAK state | FUTURE LEAK hook | grim | finale |",
          "",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "snapshots", "0", "current_state.md"),
        createStateCard({
          chapter: 60,
          location: "Chengdu court",
          protagonistState: "FUTURE LEAK snapshot",
          goal: "Secure the western kingdom.",
          conflict: "Late-book imperial rivalry is now fully active.",
        }),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "snapshots", "0", "pending_hooks.md"),
        [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| future-hook | 60 | mystery | open | 60 | Future payoff | FUTURE LEAK |",
          "",
        ].join("\n"),
        "utf-8",
      ),
    ]);

    vi.spyOn(ArchitectAgent.prototype, "generateFoundationFromImport").mockResolvedValue(completeEnglishFoundationOutput({
      storyBible: "# Story Bible\n",
      volumeOutline: "# Volume Outline\n",
      bookRules: "---\nversion: \"1.0\"\n---\n\n# Book Rules\n",
      currentState: createStateCard({
        chapter: 60,
        location: "Chengdu court",
        protagonistState: "FUTURE LEAK: Liu Bei already holds Yizhou.",
        goal: "Secure the western kingdom.",
        conflict: "Late-book imperial rivalry is now fully active.",
      }),
      pendingHooks: [
        "# Pending Hooks",
        "",
        "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| future-hook | 60 | mystery | open | 60 | Future payoff | FUTURE LEAK |",
        "",
      ].join("\n"),
      structureSignals: validStructureSignalsSection(),
    }));

    let stateSeenByFirstReplay = "";
    let hooksSeenByFirstReplay = "";
    let subplotSeenByFirstReplay = "";
    let emotionalSeenByFirstReplay = "";
    let matrixSeenByFirstReplay = "";
    let summariesSeenByFirstReplay = "";

    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockImplementationOnce(async (input) => {
      stateSeenByFirstReplay = await readFile(join(input.bookDir, "story", "current_state.md"), "utf-8");
      hooksSeenByFirstReplay = await readFile(join(input.bookDir, "story", "pending_hooks.md"), "utf-8");
      subplotSeenByFirstReplay = await readFile(join(input.bookDir, "story", "subplot_board.md"), "utf-8").catch(() => "");
      emotionalSeenByFirstReplay = await readFile(join(input.bookDir, "story", "emotional_arcs.md"), "utf-8").catch(() => "");
      matrixSeenByFirstReplay = await readFile(join(input.bookDir, "story", "character_matrix.md"), "utf-8").catch(() => "");
      summariesSeenByFirstReplay = await readFile(join(input.bookDir, "story", "chapter_summaries.md"), "utf-8").catch(() => "");

      return createAnalyzedOutput({
        chapterNumber: 1,
        title: "Prelude",
        content: "A cold wind crossed the harbor.",
        wordCount: countChapterLength("A cold wind crossed the harbor.", "en_words"),
        updatedState: createStateCard({
          chapter: 1,
          location: "Harbor gate",
          protagonistState: "Mara hides the sealed letter under her coat.",
          goal: "Slip past the harbor watch.",
          conflict: "The watch now searches for the missing captain's courier.",
        }),
        updatedHooks: [
          "# Pending Hooks",
          "",
          "| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | notes |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          "| captain-letter | 1 | mystery | open | 1 | The captain's disappearance is explained. | The sealed letter points to the vanished captain. |",
          "",
        ].join("\n"),
      });
    });

    try {
      await runner.importChapters({
        bookId,
        chapters: [
          { title: "Prelude", content: "A cold wind crossed the harbor." },
        ],
      });

      expect(stateSeenByFirstReplay).toContain("| Current Chapter | 0 |");
      expect(stateSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(hooksSeenByFirstReplay).toContain("# Pending Hooks");
      expect(hooksSeenByFirstReplay).not.toContain("future-hook");
      expect(hooksSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(subplotSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(emotionalSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(matrixSeenByFirstReplay).not.toContain("FUTURE LEAK");
      expect(summariesSeenByFirstReplay).not.toContain("FUTURE LEAK");

      const snapshotZeroState = await readFile(join(storyDir, "snapshots", "0", "current_state.md"), "utf-8");
      const snapshotZeroHooks = await readFile(join(storyDir, "snapshots", "0", "pending_hooks.md"), "utf-8");
      expect(snapshotZeroState).toContain("| Current Chapter | 0 |");
      expect(snapshotZeroState).not.toContain("FUTURE LEAK");
      expect(snapshotZeroHooks).toContain("# Pending Hooks");
      expect(snapshotZeroHooks).not.toContain("future-hook");
      expect(snapshotZeroHooks).not.toContain("FUTURE LEAK");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  sqliteIt("rebuilds current facts from the revised chapter snapshot", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const oldState = createStateCard({
      chapter: 1,
      location: "Ashen ferry crossing",
      protagonistState: "Lin Yue still hides the oath token.",
      goal: "Find the vanished mentor.",
      conflict: "The mentor debt is still personal.",
    });
    const revisedState = createStateCard({
      chapter: 1,
      location: "Ashen ferry crossing",
      protagonistState: "Lin Yue no longer hides the oath token.",
      goal: "Confront the vanished mentor.",
      conflict: "The oath token is public now, forcing the confrontation.",
    });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), "# 第1章 Test Chapter\n\nOriginal body.", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), oldState, "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: "Original body.".length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);
    await state.snapshotState(bookId, 1);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Revised body.",
        wordCount: "Revised body.".length,
        updatedState: revisedState,
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1);

      const memoryDb = new MemoryDB(state.bookDir(bookId));
      try {
        expect(memoryDb.getCurrentFacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              predicate: "Current Conflict",
              object: "The oath token is public now, forcing the confrontation.",
              validFromChapter: 1,
              sourceChapter: 1,
            }),
          ]),
        );
      } finally {
        memoryDb.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("feeds long-span fatigue warnings back into pipeline audit and dedicated drift guidance", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const now = "2026-03-19T00:00:00.000Z";

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 2,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The debt trail keeps narrowing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(
        join(storyDir, "chapter_summaries.md"),
        [
          "# 章节摘要",
          "",
          "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
          "|------|------|----------|----------|----------|----------|----------|----------|",
          "| 1 | 旧路 | 林越 | 进城 | 潜伏开始 | 债印未解 | 克制 | 布局 |",
          "| 2 | 暗巷 | 林越 | 试探 | 目标未变 | 债印未解 | 克制 | 布局 |",
        ].join("\n"),
        "utf-8",
      ),
      writeFile(join(state.bookDir(bookId), "chapters", "0001_旧路.md"), "# 第1章 旧路\n\n城门在晨雾里半开。林越顺着石阶慢慢往里走。巷口那盏灯一直没有灭。", "utf-8"),
      writeFile(join(state.bookDir(bookId), "chapters", "0002_暗巷.md"), "# 第2章 暗巷\n\n午后的风掠过墙头。林越没有回头，只是沿着阴影继续向前。墙后的铃声很轻。", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [
      {
        number: 1,
        title: "旧路",
        status: "ready-for-review",
        wordCount: 36,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "暗巷",
        status: "ready-for-review",
        wordCount: 36,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 3,
        title: "回声",
        content: "夜色慢慢压低了屋檐。林越先停在门外，随后才抬手去碰那道旧债印。风从更深的巷子里吹了出来。",
        wordCount: "夜色慢慢压低了屋檐。林越先停在门外，随后才抬手去碰那道旧债印。风从更深的巷子里吹了出来。".length,
        updatedState: createStateCard({
          chapter: 3,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The debt trail keeps narrowing.",
        }),
        updatedLedger: "",
        updatedHooks: "# Pending Hooks\n",
        chapterSummary: "| 3 | 回声 | 林越 | 继续潜伏 | 目标未变 | 债印未解 | 克制 | 布局 |",
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "ok",
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId);
      const driftFile = await readFile(join(storyDir, "audit_drift.md"), "utf-8");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");

      expect(result.auditResult.issues.some((issue) => issue.category === "节奏单调")).toBe(true);
      expect(driftFile).toContain("节奏单调");
      expect(currentState).not.toContain("节奏单调");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("feeds hook health warnings back into pipeline audit and dedicated drift guidance", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 2,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The debt trail keeps narrowing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 3,
        title: "回声",
        content: "夜色慢慢压低了屋檐。林越先停在门外，随后才抬手去碰那道旧债印。",
        wordCount: "夜色慢慢压低了屋檐。林越先停在门外，随后才抬手去碰那道旧债印。".length,
        updatedState: createStateCard({
          chapter: 3,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The debt trail keeps narrowing.",
        }),
        updatedLedger: "",
        updatedHooks: "# Pending Hooks\n",
        chapterSummary: "| 3 | 回声 | 林越 | 继续潜伏 | 目标未变 | 债印未解 | 克制 | 布局 |",
        hookHealthIssues: [{
          severity: "warning",
          category: "伏笔债务",
          description: "活跃伏笔过多，且本章没有处理陈旧债务。",
          suggestion: "下一章优先推进或延后至少一个僵死伏笔。",
        }],
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "ok",
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId);
      const driftFile = await readFile(join(storyDir, "audit_drift.md"), "utf-8");
      const currentState = await readFile(join(storyDir, "current_state.md"), "utf-8");
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(result.auditResult.issues.some((issue) => issue.category === "伏笔债务")).toBe(true);
      expect(driftFile).toContain("伏笔债务");
      expect(currentState).not.toContain("伏笔债务");
      expect(savedIndex[0]?.auditIssues).toEqual(
        expect.arrayContaining([
          expect.stringContaining("活跃伏笔过多"),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds final paragraph fragmentation warnings from revised content before persist", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const draftBody = "林越先把门推开一条缝，再侧耳去听墙后的动静。屋里的灯没有亮，但桌角还有没散的热气，说明人刚离开不久。";
    const revisedBody = [
      "门开了。",
      "他没进去。",
      "先听了一下。",
      "里面没有声响。",
      "他这才抬脚。",
      "屋里很冷。",
    ].join("\n\n");

    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The debt trail keeps narrowing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 1,
        title: "雾线",
        content: draftBody,
        wordCount: draftBody.length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: revisedBody.length,
        updatedState: createStateCard({
          chapter: 1,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "He steps into the empty room.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );
    vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(
      createAnalyzedOutput({
        title: "雾线",
        content: revisedBody,
        wordCount: revisedBody.length,
        chapterSummary: "| 1 | 雾线 | 林越 | 进入空屋 | 状态推进 | 无 | 紧绷 | 过渡 |",
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 120);

      expect(result.auditResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "paragraph-shape",
            description: expect.stringContaining("段落被切得过碎"),
          }),
          expect.objectContaining({
            category: "paragraph-shape",
            description: expect.stringContaining("连续出现"),
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves duplicate chapter titles before persist", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const now = "2026-03-19T00:00:00.000Z";

    await Promise.all([
      writeFile(join(chaptersDir, "0001_回声.md"), "# 第1章 回声\n\n旧章节。", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The debt trail keeps narrowing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "回声",
      status: "ready-for-review",
      wordCount: 12,
      createdAt: now,
      updatedAt: now,
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 2,
        title: "回声",
        content: "啊。",
        wordCount: "啊。".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 120);
      const index = await state.loadChapterIndex(bookId);

      expect(result.title).toBe("回声（2）");
      expect(index.at(-1)?.title).toBe("回声（2）");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("regenerates duplicate chapter titles before falling back to numeric suffixes", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const now = "2026-03-19T00:00:00.000Z";

    await Promise.all([
      writeFile(join(chaptersDir, "0001_回声.md"), "# 第1章 回声\n\n旧章节。", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The debt trail keeps narrowing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "回声",
      status: "ready-for-review",
      wordCount: 12,
      createdAt: now,
      updatedAt: now,
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 2,
        title: "回声",
        content: "塔楼里的铜铃只响了一声，风从缺口灌进来，守夜人没有回头。",
        wordCount: "塔楼里的铜铃只响了一声，风从缺口灌进来，守夜人没有回头。".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 120);
      const index = await state.loadChapterIndex(bookId);

      expect(result.title).toContain("塔楼");
      expect(result.title).not.toBe("回声（2）");
      expect(index.at(-1)?.title).toBe(result.title);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let title finalization overwrite a strong writer title with a weaker regenerated name", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const now = "2026-03-19T00:00:00.000Z";

    await Promise.all([
      writeFile(join(chaptersDir, "0001_死局将至.md"), "# 第1章 死局将至\n\n旧章节。", "utf-8"),
      writeFile(join(chaptersDir, "0002_死局再近.md"), "# 第2章 死局再近\n\n旧章节。", "utf-8"),
      writeFile(join(chaptersDir, "0003_死局未解.md"), "# 第3章 死局未解\n\n旧章节。", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 3,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Break through the river choke point.",
        conflict: "The deadlock at the dark-river mouth keeps tightening.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [
      {
        number: 1,
        title: "死局将至",
        status: "ready-for-review",
        wordCount: 12,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "死局再近",
        status: "ready-for-review",
        wordCount: 12,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 3,
        title: "死局未解",
        status: "ready-for-review",
        wordCount: 12,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 4,
        title: "暗河尽头前的死局",
        content: "云岚站在暗河边，没有回头。",
        wordCount: "云岚站在暗河边，没有回头。".length,
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: true,
        issues: [],
        summary: "clean",
      }),
    );

    try {
      const result = await runner.writeNextChapter(bookId, 120);
      const index = await state.loadChapterIndex(bookId);

      expect(result.title).toBe("暗河尽头前的死局");
      expect(index.at(-1)?.title).toBe("暗河尽头前的死局");
      expect(result.title).not.toBe("云岚");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults manual reviseDraft to spot-fix when mode is omitted", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), "# 第1章 Test Chapter\n\nOriginal body.", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: "Original body.".length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue(
      createAuditResult({
        passed: false,
        issues: [CRITICAL_ISSUE],
        summary: "needs revision",
      }),
    );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "Spot-fixed body.",
        wordCount: "Spot-fixed body.".length,
        updatedState: createStateCard({
          chapter: 1,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The mentor debt is repaired.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1);

      expect(reviseChapter).toHaveBeenCalledTimes(1);
      expect(reviseChapter.mock.calls[0]?.[4]).toBe("spot-fix");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes governed control inputs into manual revise in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "林越推门进去，先看见柜台后那盏没关的灯。";

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n## 当前重点\n\n把注意力收回师债主线。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# 卷纲\n\n## 第1章\n先处理商会路线噪音。\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "旧港便利店",
        protagonistState: "林越仍在追查师债。",
        goal: "把注意力拉回师债线索。",
        conflict: "商会路线仍在分散注意力。",
      }), "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# 世界观设定\n\n- 誓令碎片不可伪造。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n\n- 师债线索仍未回收。\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 夜灯 | 林越 | 林越继续追查师债 | 追查意图更强 | 师债推进 | 压抑 | 主线推进 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(chaptersDir, "0001_夜灯.md"), `# 第1章 夜灯\n\n${originalBody}`, "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "夜灯",
      status: "audit-failed",
      wordCount: originalBody.length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。",
        wordCount: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。".length,
        fixedIssues: ["- 收紧了主线焦点。"],
        updatedState: createStateCard({
          chapter: 1,
          location: "旧港便利店",
          protagonistState: "林越把注意力重新拉回师债。",
          goal: "继续追查师债。",
          conflict: "商会路线暂时退居背景。",
        }),
        updatedHooks: "# 伏笔池\n\n- 师债线索仍未回收。\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1);

      expect(auditChapter.mock.calls[0]?.[4]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
      });
      expect(reviseChapter.mock.calls[0]?.[6]).toMatchObject({
        chapterIntent: expect.stringContaining("# Chapter Intent"),
        contextPackage: expect.objectContaining({
          selectedContext: expect.any(Array),
        }),
        ruleStack: expect.objectContaining({
          activeOverrides: expect.any(Array),
        }),
        lengthSpec: expect.objectContaining({
          target: 3000,
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes one-off external brief into manual revise in v2 mode", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture({
      inputGovernanceMode: "v2",
      externalContext: "把注意力收回师债主线，并强调柜台后的异常灯光。",
    });
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "林越推门进去，先看见柜台后那盏没关的灯。";

    await Promise.all([
      writeFile(join(storyDir, "current_focus.md"), "# 当前聚焦\n\n## 当前重点\n\n商会路线优先。\n", "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), "# 卷纲\n\n## 第1章\n先处理商会路线噪音。\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "旧港便利店",
        protagonistState: "林越仍在追查师债。",
        goal: "把注意力拉回师债线索。",
        conflict: "商会路线仍在分散注意力。",
      }), "utf-8"),
      writeFile(join(storyDir, "story_bible.md"), "# 世界观设定\n\n- 誓令碎片不可伪造。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 伏笔池\n\n- 师债线索仍未回收。\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 夜灯 | 林越 | 林越继续追查师债 | 追查意图更强 | 师债推进 | 压抑 | 主线推进 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(chaptersDir, "0001_夜灯.md"), `# 第1章 夜灯\n\n${originalBody}`, "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "夜灯",
      status: "audit-failed",
      wordCount: originalBody.length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。",
        wordCount: "林越推门进去，先停在门槛外听了一息，再去看柜台后那盏没关的灯。".length,
        fixedIssues: ["- 收紧了主线焦点。"],
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1);

      expect(reviseChapter.mock.calls[0]?.[6]).toMatchObject({
        chapterIntent: expect.stringContaining("把注意力收回师债主线"),
      });
      expect(reviseChapter.mock.calls[0]?.[6]).not.toMatchObject({
        chapterIntent: expect.stringContaining("商会路线优先"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes merged AI-tell issues into manual revise and rejects no-improvement revisions", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "林越抬手。林越停步。林越转身。林越侧耳。";

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), `# 第1章 Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: originalBody.length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "节奏",
            description: "结尾解释略多。",
            suggestion: "压缩一行解释。",
          }],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "节奏",
            description: "结尾解释略多。",
            suggestion: "压缩一行解释。",
          }],
          summary: "still weak",
        }),
      );
    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: `${originalBody}\n\n修订后收束更利落。`,
        wordCount: `${originalBody}\n\n修订后收束更利落。`.length,
        fixedIssues: ["- 压缩了结尾解释。"],
      }),
    );

    try {
      const result = await runner.reviseDraft(bookId, 1);
      const savedChapter = await readFile(join(chaptersDir, "0001_Test_Chapter.md"), "utf-8");
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(reviseChapter).toHaveBeenCalledTimes(1);
      expect(reviseChapter.mock.calls[0]?.[3]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "节奏" }),
          expect.objectContaining({ category: "列表式结构" }),
        ]),
      );
      expect(result.applied).toBe(false);
      expect(result.status).toBe("unchanged");
      expect(result.skippedReason).toContain("did not improve");
      expect(savedChapter).toContain(originalBody);
      expect(savedChapter).not.toContain("修订后收束更利落");
      expect(savedIndex[0]?.status).toBe("audit-failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists manual revisions only when merged audit improves", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "林越抬手。林越停步。林越转身。林越侧耳。";
    const revisedBody = "门被风顶开，林越先停在门槛前。\n\n他侧过身，听见墙后那道更轻的呼吸。";

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), `# 第1章 Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Ashen ferry crossing",
        protagonistState: "Lin Yue still hides the oath token.",
        goal: "Find the vanished mentor.",
        conflict: "The mentor debt is still personal.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: originalBody.length,
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "节奏",
            description: "结尾解释略多。",
            suggestion: "压缩一行解释。",
          }],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );
    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: revisedBody.length,
        fixedIssues: ["- 收紧了结尾节奏。"],
        updatedState: createStateCard({
          chapter: 1,
          location: "Ashen ferry crossing",
          protagonistState: "Lin Yue still hides the oath token.",
          goal: "Find the vanished mentor.",
          conflict: "The mentor debt sharpens into a direct threat.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      const result = await runner.reviseDraft(bookId, 1);
      const savedChapter = await readFile(join(chaptersDir, "0001_Test_Chapter.md"), "utf-8");
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(result.applied).toBe(true);
      expect(result.status).toBe("ready-for-review");
      expect(result.fixedIssues).toEqual(["- 收紧了结尾节奏。"]);
      expect(savedChapter).toContain(revisedBody);
      expect(savedIndex[0]?.status).toBe("ready-for-review");
      expect(savedIndex[0]?.auditIssues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-audits revisions against updated state overrides instead of stale on-disk truth files", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "Taryn kept one hand on the annexe key and listened at the door.";
    const revisedBody = `${originalBody}\n\nHe checked the seal again before he moved.`;

    await state.saveBookConfig(bookId, {
      ...(await state.loadBookConfig(bookId)),
      platform: "other",
      genre: "progression",
      language: "en",
      chapterWordCount: 1800,
    });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_First.md"), `# Chapter 1: First\n\nOpening chapter.`, "utf-8"),
      writeFile(join(chaptersDir, "0002_Test_Chapter.md"), `# Chapter 2: Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Orsden archive lower hall",
        protagonistState: "Taryn is still moving under Renn's first warning.",
        goal: "Reach the annexe.",
        conflict: "The archive is already compromised.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [
      {
        number: 1,
        title: "First",
        status: "ready-for-review",
        wordCount: countChapterLength("Opening chapter.", "en_words"),
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Test Chapter",
        status: "audit-failed",
        wordCount: countChapterLength(originalBody, "en_words"),
        createdAt: "2026-03-19T00:00:00.000Z",
        updatedAt: "2026-03-19T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      },
    ]);

    const auditChapter = vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [{
            severity: "warning",
            category: "Pacing Check",
            description: "The beat needs a firmer end stop.",
            suggestion: "Tighten the closing move.",
          }],
          summary: "needs revision",
        }),
      )
      .mockImplementationOnce(async (_bookDir, _chapterContent, chapterNumber, _genre, options) => {
        const overrideState = (options as { truthFileOverrides?: { currentState?: string } } | undefined)
          ?.truthFileOverrides?.currentState;
        if (chapterNumber === 2 && overrideState?.includes("| Current Chapter | 2 |")) {
          return createAuditResult({
            passed: true,
            issues: [],
            summary: "clean",
          });
        }

        return createAuditResult({
          passed: false,
          issues: [{
            severity: "critical",
            category: "Chronicle Drift Check",
            description: "The chapter is presented as 'chapter 2', but the supplied Current State Card still lists 'Current Chapter | 1'.",
            suggestion: "Sync the state card before re-audit.",
          }],
          summary: "stale state card",
        });
      });

    vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: countChapterLength(revisedBody, "en_words"),
        fixedIssues: ["- Synced the annexe beat and tightened the ending."],
        updatedState: createStateCard({
          chapter: 2,
          location: "East annexe corridor",
          protagonistState: "Taryn is pressed against the annexe door with the true key in hand.",
          goal: "Open the annexe before the cart clears the court.",
          conflict: "A forged key and rival searchers have turned lawful access into a trap.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      const result = await runner.reviseDraft(bookId, 2);
      const savedIndex = await state.loadChapterIndex(bookId);

      expect(auditChapter).toHaveBeenCalledTimes(2);
      expect(result.applied).toBe(true);
      expect(result.status).toBe("ready-for-review");
      expect(savedIndex[1]?.status).toBe("ready-for-review");
      expect(savedIndex[1]?.auditIssues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("excludes pure sequence-level fatigue from revision blocker counts", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    const book = await state.loadBookConfig(bookId);

    await writeFile(join(storyDir, "chapter_summaries.md"), [
      "# 章节摘要",
      "",
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | 旧门 | 林越 | 进入旧门 | 压力升高 | none | 冷峻 | 调查 |",
      "| 2 | 灰灯 | 林越 | 检查灰灯 | 压力升高 | none | 冷峻 | 调查 |",
      "| 3 | 纸页 | 林越 | 对照纸页 | 压力升高 | none | 冷峻 | 调查 |",
      "",
    ].join("\n"), "utf-8");

    const result = await (
      runner as unknown as {
        evaluateMergedAudit: (params: {
          auditor: Pick<ContinuityAuditor, "auditChapter">;
          book: BookConfig;
          bookDir: string;
          chapterContent: string;
          chapterNumber: number;
          language: "zh" | "en";
        }) => Promise<{
          auditResult: AuditResult;
          aiTellCount: number;
          blockingCount: number;
          criticalCount: number;
        }>;
      }
    ).evaluateMergedAudit({
      auditor: {
        auditChapter: vi.fn().mockResolvedValue(
          createAuditResult({
            passed: true,
            issues: [],
            summary: "clean",
          }),
        ),
      },
      book,
      bookDir,
      chapterContent: "林越把纸页摊平，先看角上的水痕，再看最末那道被抹掉的签名。",
      chapterNumber: 3,
      language: "zh",
    });

    expect(result.auditResult.issues.some((issue) => issue.category === "节奏单调")).toBe(true);
    expect(result.blockingCount).toBe(0);
    expect(result.criticalCount).toBe(0);

    await rm(root, { recursive: true, force: true });
  });

  it("keeps chapter-level blockers even when sequence-level fatigue shares the same category label", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    const book = await state.loadBookConfig(bookId);

    await writeFile(join(storyDir, "chapter_summaries.md"), [
      "# 章节摘要",
      "",
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | 旧门 | 林越 | 进入旧门 | 压力升高 | none | 冷峻 | 调查 |",
      "| 2 | 灰灯 | 林越 | 检查灰灯 | 压力升高 | none | 冷峻 | 调查 |",
      "| 3 | 纸页 | 林越 | 对照纸页 | 压力升高 | none | 冷峻 | 调查 |",
      "",
    ].join("\n"), "utf-8");

    const result = await (
      runner as unknown as {
        evaluateMergedAudit: (params: {
          auditor: Pick<ContinuityAuditor, "auditChapter">;
          book: BookConfig;
          bookDir: string;
          chapterContent: string;
          chapterNumber: number;
          language: "zh" | "en";
        }) => Promise<{
          auditResult: AuditResult;
          aiTellCount: number;
          blockingCount: number;
          criticalCount: number;
        }>;
      }
    ).evaluateMergedAudit({
      auditor: {
        auditChapter: vi.fn().mockResolvedValue(
          createAuditResult({
            passed: false,
            issues: [{
              severity: "warning",
              category: "节奏单调",
              description: "这一章的推进依然原地打转，没有完成当前场景应有的落点。",
              suggestion: "让当前章把既定动作落下，不要继续停在同一观察节拍。",
            }],
            summary: "needs revision",
          }),
        ),
      },
      book,
      bookDir,
      chapterContent: "林越把纸页摊平，先看角上的水痕，再看最末那道被抹掉的签名。",
      chapterNumber: 3,
      language: "zh",
    });

    expect(result.auditResult.issues.filter((issue) => issue.category === "节奏单调")).toHaveLength(2);
    expect(result.blockingCount).toBe(1);
    expect(result.criticalCount).toBe(0);

    await rm(root, { recursive: true, force: true });
  });

  it("uses chapter length telemetry target for manual revise when available", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const storyDir = join(state.bookDir(bookId), "story");
    const chaptersDir = join(state.bookDir(bookId), "chapters");
    const originalBody = "Tarin waited by the crooked berth marker and counted the missing lines twice.";
    const revisedBody = `${originalBody}\n\nHe did not move until the second bell rang across the water.`;

    await state.saveBookConfig(bookId, {
      ...(await state.loadBookConfig(bookId)),
      platform: "other",
      genre: "progression",
      language: "en",
      chapterWordCount: 1800,
    });

    await Promise.all([
      writeFile(join(chaptersDir, "0001_Test_Chapter.md"), `# Chapter 1: Test Chapter\n\n${originalBody}`, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 1,
        location: "Dock Nine",
        protagonistState: "Tarin still carries the sealed packet.",
        goal: "Find Captain Voss.",
        conflict: "The berth is wrong and the crew is missing.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
    ]);
    await state.saveChapterIndex(bookId, [{
      number: 1,
      title: "Test Chapter",
      status: "audit-failed",
      wordCount: countChapterLength(originalBody, "en_words"),
      createdAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
      lengthTelemetry: {
        target: 900,
        softMin: 778,
        softMax: 1022,
        hardMin: 655,
        hardMax: 1145,
        countingMode: "en_words",
        writerCount: countChapterLength(originalBody, "en_words"),
        postWriterNormalizeCount: countChapterLength(originalBody, "en_words"),
        postReviseCount: 0,
        finalCount: countChapterLength(originalBody, "en_words"),
        normalizeApplied: false,
        lengthWarning: false,
      },
    }]);

    vi.spyOn(ContinuityAuditor.prototype, "auditChapter")
      .mockResolvedValueOnce(
        createAuditResult({
          passed: false,
          issues: [CRITICAL_ISSUE],
          summary: "needs revision",
        }),
      )
      .mockResolvedValueOnce(
        createAuditResult({
          passed: true,
          issues: [],
          summary: "clean",
        }),
      );

    const reviseChapter = vi.spyOn(ReviserAgent.prototype, "reviseChapter").mockResolvedValue(
      createReviseOutput({
        revisedContent: revisedBody,
        wordCount: countChapterLength(revisedBody, "en_words"),
        fixedIssues: ["- Tightened the berth discovery beat."],
        updatedState: createStateCard({
          chapter: 1,
          location: "Dock Nine",
          protagonistState: "Tarin still carries the sealed packet.",
          goal: "Find Captain Voss.",
          conflict: "The berth is wrong and the crew is missing.",
        }),
        updatedHooks: "# Pending Hooks\n",
      }),
    );

    try {
      await runner.reviseDraft(bookId, 1, "polish");

      expect(reviseChapter).toHaveBeenCalledTimes(1);
      expect(reviseChapter.mock.calls[0]?.[6]?.lengthSpec).toMatchObject({
        target: 900,
        countingMode: "en_words",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  describe("skipPlanningValidation and skipStateDegradationCheck controls", () => {
    it("runs planning integrity check and marks chapter status when skipPlanningValidation is false", async () => {
      const { root, runner, state, bookId } = await createRunnerFixture({
        skipPlanningValidation: false,
      });
      const storyDir = join(state.bookDir(bookId), "story");

      await Promise.all([
        writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nOutline line.", "utf-8"),
        writeFile(join(storyDir, "first_10_chapter_plan.md"), "invalid format without table structure", "utf-8"),
        writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- 当前目标：拿到账册。\n\n- facts:\n  - test fact", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      ]);

      await expect(runner.planChapter(bookId)).rejects.toThrow();
      
      const index = await state.loadChapterIndex(bookId);
      const ch1 = index.find(e => e.number === 1);
      expect(ch1?.status).toBe("planning-degraded");

      await rm(root, { recursive: true, force: true });
    });

    it("runs intent alignment check in ChapterIntentAgent and blocks when skipPlanningValidation is false", async () => {
      const { root, runner, state, bookId } = await createRunnerFixture({
        skipPlanningValidation: false,
      });
      const storyDir = join(state.bookDir(bookId), "story");

      // Mock ChapterIntentAgent.prototype.generate to call the original implementation!
      vi.spyOn(ChapterIntentAgent.prototype, "generate").mockImplementation(function (this: any, input) {
        return originalChapterIntentGenerate.call(this, input);
      });

      const validFirst10Plan = [
        "| 章节 | 核心功能 | 情绪事件 | 主角目标 | 阻碍冲突 | 解决破局 | 阶段反馈 | 结尾钩子 |",
        "|---|---|---|---|---|---|---|---|",
        "| 01 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 02 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 03 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 04 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 05 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 06 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 07 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 08 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 09 | function | emotion | target | conflict | solution | payoff | hook |",
        "| 10 | function | emotion | target | conflict | solution | payoff | hook |",
      ].join("\n");

      await Promise.all([
        writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nOutline line.", "utf-8"),
        writeFile(join(storyDir, "first_10_chapter_plan.md"), validFirst10Plan, "utf-8"),
        writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- 当前目标：无\n\n- facts:\n", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      ]);
      await mkdir(join(storyDir, "state"), { recursive: true });
      await writeFile(
        join(storyDir, "state", "current_state.json"),
        JSON.stringify({ chapter: 0, facts: [] }, null, 2),
        "utf-8",
      );

      await expect(runner.writeNextChapter(bookId)).rejects.toThrow(/Alignment failure/);

      await rm(root, { recursive: true, force: true });
    });

    it("runs state degradation check and throws when skipStateDegradationCheck is false", async () => {
      const { root, runner, state, bookId } = await createRunnerFixture({
        skipStateDegradationCheck: false,
      });
      const storyDir = join(state.bookDir(bookId), "story");
      const stateDir = join(storyDir, "state");
      await mkdir(stateDir, { recursive: true });

      const validFact = {
        subject: "林越",
        predicate: "持有",
        object: "账册",
        validFromChapter: 1,
        validUntilChapter: null,
        sourceChapter: 1,
      };

      const validHook = {
        hookId: "hook-1",
        startChapter: 1,
        type: "danger",
        status: "open",
        lastAdvancedChapter: 1,
        expectedPayoff: "payoff",
        notes: "",
      };

      await Promise.all([
        writeFile(join(stateDir, "current_state.json"), JSON.stringify({ chapter: 1, facts: [validFact] }), "utf-8"),
        writeFile(join(stateDir, "hooks.json"), JSON.stringify({ hooks: [validHook] }), "utf-8"),
        writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({ rows: [] }), "utf-8"),
        writeFile(join(stateDir, "manifest.json"), JSON.stringify({ schemaVersion: 2, language: "zh", lastAppliedChapter: 1, projectionVersion: 1 }), "utf-8"),
      ]);

      await Promise.all([
        writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- 当前目标：无\n\n- facts:\n", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      ]);

      const { rewriteStructuredStateFromMarkdown } = await import("../state/state-bootstrap.js");
      await expect(rewriteStructuredStateFromMarkdown({
        bookDir: state.bookDir(bookId),
        fallbackChapter: 1,
        skipDegradationCheck: false,
      })).rejects.toThrow(/State sync abort/);

      await rm(root, { recursive: true, force: true });
    });
  });
});
