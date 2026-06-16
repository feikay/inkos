import { describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { LengthSpecSchema } from "../models/length-governance.js";
import { buildWriterSystemPrompt } from "../agents/writer-prompts.js";

const BOOK: BookConfig = {
  id: "prompt-book",
  title: "Prompt Book",
  platform: "tomato",
  genre: "other",
  status: "active",
  targetChapters: 20,
  chapterWordCount: 3000,
  createdAt: "2026-03-22T00:00:00.000Z",
  updatedAt: "2026-03-22T00:00:00.000Z",
};

const GENRE: GenreProfile = {
  id: "other",
  name: "综合",
  language: "zh",
  chapterTypes: ["setup", "conflict"],
  fatigueWords: [],
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

describe("buildWriterSystemPrompt", () => {
  it("demotes always-on methodology blocks in governed mode", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("## 输入治理契约");
    expect(prompt).toContain("卷纲是默认规划");
    expect(prompt).not.toContain("## 六步走人物心理分析");
    expect(prompt).not.toContain("## 读者心理学框架");
    expect(prompt).not.toContain("## 黄金三章规则");
  });

  it("uses target-range wording when a length spec is provided", () => {
    const lengthSpec = LengthSpecSchema.parse({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "zh_chars",
      normalizeMode: "none",
    });

    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
      lengthSpec,
    );

    expect(prompt).toContain("目标字数：2200");
    expect(prompt).toContain("允许区间：1900-2500");
    expect(prompt).not.toContain("正文不少于2200字");
  });

  it("keeps hard guardrails and book/style constraints in governed mode", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules\n\n- Do not reveal the mastermind.",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("## 核心规则");
    expect(prompt).toContain("## 硬性禁令");
    expect(prompt).toContain("Do not reveal the mastermind");
    expect(prompt).toContain("Keep the prose restrained");
  });

  it("renders structured content safety profile entries instead of object placeholders", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
      undefined,
      {
        prohibitions: [
          {
            id: "firearms",
            text: "不得出现枪战、爆破、特工等元素",
            severity: "error",
          },
        ],
        terms: [
          {
            id: "weapon",
            term: "手枪",
            exceptions: ["玩具手枪"],
            severity: "error",
          },
        ],
      },
    );

    expect(prompt).toContain("firearms [error]: 不得出现枪战、爆破、特工等元素");
    expect(prompt).toContain("weapon: 禁用词：\"手枪\" [error]");
    expect(prompt).toContain("玩具手枪");
    expect(prompt).not.toContain("[object Object]");
  });

  it("injects anti-template structure rules into governed Chinese prompts", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide",
      undefined,
      8,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("## 反模板章节结构规则");
    expect(prompt).toContain("开头：必须是“事件触发”");
    expect(prompt).toContain("中段：推进必须由“具体线索或压力”驱动");
    expect(prompt).toContain("结尾：必须是“具体悬念”");
    expect(prompt).toContain("战斗 → 击败 → 掉落 → 玉牌/卷轴");
    expect(prompt).toContain("真正的危险才刚刚开始");
    expect(prompt).toContain("他们继续深入 / 继续前行");
    expect(prompt).toContain("隐藏着更多秘密");
    expect(prompt).toContain("只是冰山一角");
    expect(prompt).toContain("真正的真相");
  });

  it("tells governed English prompts to obey variance briefs and include resistance-bearing exchanges", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        language: "en",
      },
      {
        ...GENRE,
        language: "en",
        name: "General",
      },
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "en",
      "governed",
    );

    expect(prompt).toContain("English Variance Brief");
    expect(prompt).toContain("resistance-bearing exchange");
  });

  it("injects anti-template structure rules into English prompts", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        language: "en",
      },
      {
        ...GENRE,
        language: "en",
        name: "General",
      },
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide",
      undefined,
      8,
      "creative",
      undefined,
      "en",
      "legacy",
    );

    expect(prompt).toContain("## Anti-Template Chapter Structure");
    expect(prompt).toContain("Opening: start with an event trigger");
    expect(prompt).toContain("Middle: every scene movement must be driven by a specific clue or pressure");
    expect(prompt).toContain("Ending: end on a concrete hook");
    expect(prompt).toContain("fight -> defeat -> loot drop -> jade token/scroll");
    expect(prompt).toContain("the real danger had only just begun");
    expect(prompt).toContain("they continued deeper");
    expect(prompt).toContain("this was only the tip of the iceberg");
  });

  it("injects immersive numeric-expression constraints when configured", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        writingRules: { numericExpressionMode: "immersive" },
      },
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide",
      undefined,
      86,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("numericExpressionMode=immersive");
    expect(prompt).toContain("禁止阿拉伯数字状态面板");
    expect(prompt).toContain("0.x滴精血");
    expect(prompt).toContain("性价比");
    expect(prompt).toContain("允许中文综合语感表达：几成、几分、大半");
    expect(prompt).toContain("枯竭的气血重新漫过四肢");
    expect(prompt).toContain("三息、一炷香、七副玉棺、千年、半尺、聚气九层、化灵门槛、第七容器");
  });

  it("does not inject the immersive ban for system numeric mode", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        writingRules: { numericExpressionMode: "system" },
      },
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide",
      undefined,
      1,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("numericExpressionMode=system");
    expect(prompt).toContain("正文允许出现面板、百分比、经验、属性、技能、收益");
    expect(prompt).not.toContain("禁止阿拉伯数字状态面板");
    expect(prompt).not.toContain("0.x滴精血");
  });

  it("falls back to an inferred/default numeric-expression mode for unconfigured books", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        genre: "xuanhuan",
      },
      {
        ...GENRE,
        id: "xuanhuan",
        name: "玄幻",
      },
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide",
      undefined,
      1,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("numericExpressionMode=immersive");
    expect(prompt).toContain("source=inferred");
  });
});
