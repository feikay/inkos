import { mkdir, rm, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeShortStoryPublishReadiness,
  auditShortStoryBook,
  countCjkDraftWords,
  createShortStoryChapterPlan,
  createShortStoryPublishPackage,
  generateShortStoryTitles,
  generateShortStoryDraftChapters,
  generateShortStoryVideoScript,
  optimizeShortStoryOpening,
  parseShortStoryPlanMarkdown,
  renderShortStoryAnalysisMarkdown,
  renderShortStoryTitlesMarkdown,
  renderShortStoryVideoScript,
  SHORT_STORY_FORBIDDEN_CONTINUATION_PHRASES,
} from "../short-story/index.js";

describe("short story chapter plan", () => {
  it("calculates chapter count from target words and keeps chapter targets legal", () => {
    const plan = createShortStoryChapterPlan({
      theme: "雨夜复仇",
      targetWords: 12_000,
    });

    expect(plan).toHaveLength(8);
    expect(plan.reduce((sum, chapter) => sum + chapter.targetWords, 0)).toBe(12_000);
    expect(plan.every((chapter) => chapter.targetWords >= 800 && chapter.targetWords <= 2_200)).toBe(true);
    expect(plan.at(-1)?.role).toBe("ending");
    expect(plan.at(-1)?.function).toBe("resolution");
    expect(plan.at(-1)?.endingHookRequired).toBe(false);
  });

  it("assigns tomato short-story structure functions across the whole book", () => {
    const plan = createShortStoryChapterPlan({
      theme: "雨夜复仇",
      targetWords: 12_000,
    });

    expect(plan.map((chapter) => chapter.function)).toEqual([
      "hook",
      "escalation",
      "escalation",
      "twist",
      "twist",
      "climax",
      "climax",
      "resolution",
    ]);
    expect(plan[0]?.summary).toContain("林晚");
    expect(plan[0]?.summary).toContain("顾沉");
    expect(plan[0]?.conflict).toContain("抢夺话筒");
    expect(plan[3]?.summary).toContain("顾念");
    expect(plan.at(-1)?.endingHook).toContain("重新开始");
  });

  it("selects thriller strategy for suspense and horror themes", () => {
    const plan = createShortStoryChapterPlan({
      theme: "悬疑惊悚",
      targetWords: 50_000,
    });

    expect(plan.length).toBeGreaterThan(20);
    expect(plan[0]?.summary).toContain("许念");
    expect(plan[0]?.summary).toContain("停尸间");
    expect(plan[0]?.endingHook).toContain("别相信明天来认尸的那个人");
    expect(plan.some((chapter) => chapter.function === "twist")).toBe(true);
    expect(plan.some((chapter) => chapter.function === "climax")).toBe(true);
    expect(plan.at(-1)?.function).toBe("resolution");
  });

  it("creates concrete plot beats for infidelity revenge without abstract placeholders", () => {
    const plan = createShortStoryChapterPlan({
      theme: "出轨复仇",
      targetWords: 12_000,
    });
    const prose = plan.flatMap((chapter) => [
      chapter.summary,
      chapter.conflict,
      chapter.endingHook,
    ]).join("\n");

    expect(plan[0]?.summary).toContain("林晚");
    expect(plan[0]?.summary).toContain("顾沉");
    expect(plan[0]?.summary).toContain("苏蔓");
    expect(plan[0]?.summary).toContain("播放");
    expect(plan[0]?.conflict).toContain("抢夺话筒");
    expect(plan[3]?.conflict).toContain("产房换婴");
    expect(plan[5]?.endingHook).toContain("林晚父亲车祸");
    expect(prose).not.toMatch(/主角|核心矛盾|新的危险|局势进一步失控|关键认知|终局对抗|完整结局/);
  });

  it("always includes twist and climax before the resolution", () => {
    const plan = createShortStoryChapterPlan({
      theme: "错位婚礼",
      targetWords: 8_000,
    });
    const functions = plan.map((chapter) => chapter.function);

    expect(plan.at(-1)?.function).toBe("resolution");
    expect(functions).toContain("twist");
    expect(functions).toContain("climax");
    expect(functions.filter((chapterFunction) => chapterFunction === "twist").length).toBeGreaterThanOrEqual(1);
  });

  it("uses a slightly shorter ending chapter", () => {
    const plan = createShortStoryChapterPlan({
      theme: "错位婚礼",
      targetWords: 10_000,
    });

    expect(plan.at(-1)?.targetWords).toBeLessThan(plan.at(-2)?.targetWords ?? 0);
  });

  it("parses a markdown plan and expands it into publishable markdown chapters", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "出轨复仇",
      targetWords: 12_000,
    });
    const markdown = renderPlanMarkdown("出轨复仇", 12_000, 1_500, sourcePlan);
    const parsed = parseShortStoryPlanMarkdown(markdown);
    const drafts = generateShortStoryDraftChapters(parsed);

    expect(parsed.theme).toBe("出轨复仇");
    expect(parsed.chapters).toHaveLength(8);
    expect(drafts).toHaveLength(8);
    expect(drafts[0]?.content).toContain("# 第1章");
    expect(drafts[0]?.content).toContain("林晚");
    expect(drafts[0]?.content).toContain("顾沉");
    expect(drafts[0]?.content).toContain(sourcePlan[0]?.summary);
    expect(drafts[0]?.wordCount).toBeGreaterThanOrEqual(1_200);
    expect(drafts[0]?.wordCount).toBeLessThanOrEqual(1_800);
    expect(countCjkDraftWords(drafts.at(-1)?.content ?? "")).toBeGreaterThanOrEqual(1_200);
  });

  it("opens the first short-story chapter with conflict, exposure, and an early reversal", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "出轨复仇",
      targetWords: 12_000,
    });
    const markdown = renderPlanMarkdown("出轨复仇", 12_000, 1_500, sourcePlan);
    const [firstDraft] = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(markdown));
    const body = firstDraft?.content.replace(/^# 第1章\s*/, "").replace(/\s+/g, "") ?? "";
    const first50 = body.slice(0, 50);
    const first150 = body.slice(0, 150);
    const first300 = body.slice(0, 300);

    expect(first50).toMatch(/顾沉/);
    expect(first50).toMatch(/苏蔓/);
    expect(first50).toMatch(/视频|播放/);
    expect(first50).not.toMatch(/推开|香槟|灯光|宴会厅大门/);
    expect(first150).toMatch(/全场|大屏|十周年宴|媒体/);
    expect(first300).toMatch(/直播间人数|十万|没黑/);
  });

  it("uses distinct short-story scenes and avoids repeated dialogue lines", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "出轨复仇",
      targetWords: 12_000,
    });
    const markdown = renderPlanMarkdown("出轨复仇", 12_000, 1_500, sourcePlan);
    const drafts = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(markdown));
    const expectedSceneTerms = [
      "宴会厅",
      "律师楼",
      "美容院",
      "档案室",
      "老城区",
      "机场",
      "股东大会",
      "法庭",
    ];

    for (const [index, draft] of drafts.entries()) {
      expect(draft.content).toContain(expectedSceneTerms[index]);
      expect(draft.content).not.toMatch(/新信息|新风险|新代价|新证据|新线索|新威胁/);
      expect(draft.content).toMatch(/证据|监控|协议|录音|硬盘|资金流|医疗记录|交接表/);
      expect(draft.content).toMatch(/风险|顾念|媒体|股东|保安|顾沉|苏蔓/);
      expect(draft.content).toMatch(/代价|体面|冻结|崩溃|质问|作证|妥协|死亡细节|修复/);

      const quotes = [...draft.content.matchAll(/“([^”]+)”/g)].map((match) => match[1]);
      expect(new Set(quotes).size).toBe(quotes.length);
    }
  });

  it("keeps satisfaction beats internal without publishing debug labels", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "出轨复仇",
      targetWords: 12_000,
    });
    const markdown = renderPlanMarkdown("出轨复仇", 12_000, 1_500, sourcePlan);
    const drafts = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(markdown));
    const beatLanguagePattern = /冷笑|炸开|彻底变了|没人再替|不退了|痛快|打回去了|翻篇|崩溃|失控|怒|哭|反击|证据/gu;
    const beatParagraphPattern = /冷笑|炸开|彻底变了|没人再替|不退了|痛快|打回去了|翻篇|崩溃|失控|怒|哭|反击|证据/u;

    for (const draft of drafts) {
      expect(draft.content).not.toContain("爽点");
      expect(draft.content).not.toMatch(/\[爽点\d+\]/);

      const beatLanguage = draft.content.match(beatLanguagePattern) ?? [];
      expect(beatLanguage.length).toBeGreaterThanOrEqual(4);

      const paragraphs = draft.content.split(/\n\n+/).filter(Boolean);
      expect(paragraphs.filter((paragraph) => beatParagraphPattern.test(paragraph)).length).toBeGreaterThanOrEqual(4);
    }
  });

  it("optimizes thriller first chapter hook without changing the chapter shell", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "悬疑惊悚",
      targetWords: 50_000,
    });
    const markdown = renderPlanMarkdown("悬疑惊悚", 50_000, 1_500, sourcePlan);
    const [firstDraft] = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(markdown));
    const result = optimizeShortStoryOpening("悬疑惊悚", firstDraft?.content ?? "");
    const body = result.content.replace(/^# 第1章\s*/, "").replace(/\s+/g, "");
    const first50 = body.slice(0, 50);
    const first150 = body.slice(0, 150);
    const first300 = body.slice(0, 300);

    expect(result.strategyId).toBe("thriller");
    expect(result.content).toContain("# 第1章");
    expect(first50).toMatch(/三号冷柜|许晴|电话/);
    expect(first150).toMatch(/到底在哪|我在你身后|来电记录/);
    expect(first300).toMatch(/睁开眼|十三|监控/);
  });

  it("optimizes betrayal revenge first chapter hook with conflict, exposure, and reversal", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "出轨复仇",
      targetWords: 12_000,
    });
    const markdown = renderPlanMarkdown("出轨复仇", 12_000, 1_500, sourcePlan);
    const [firstDraft] = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(markdown));
    const result = optimizeShortStoryOpening("出轨复仇", firstDraft?.content ?? "");
    const body = result.content.replace(/^# 第1章\s*/, "").replace(/\s+/g, "");
    const first50 = body.slice(0, 50);
    const first150 = body.slice(0, 150);
    const first300 = body.slice(0, 300);

    expect(result.strategyId).toBe("betrayal-revenge");
    expect(first50).toMatch(/顾沉/);
    expect(first50).toMatch(/苏蔓/);
    expect(first50).toMatch(/视频|播放/);
    expect(first150).toMatch(/十周年宴会|酒店房门|曝光|全场/);
    expect(first300).toMatch(/直播间人数|十万|付款截图/);
  });

  it("generates ten publish titles from the plan and first chapter", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "出轨复仇",
      targetWords: 12_000,
    });
    const planMarkdown = renderPlanMarkdown("出轨复仇", 12_000, 1_500, sourcePlan);
    const [firstDraft] = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(planMarkdown));
    const titles = generateShortStoryTitles({
      theme: "出轨复仇",
      planMarkdown,
      firstChapterMarkdown: firstDraft?.content ?? "",
    });
    const rendered = renderShortStoryTitlesMarkdown("出轨复仇", titles);

    expect(titles).toHaveLength(10);
    expect(titles[0]).toContain("妻子");
    expect(titles.join("\n")).toMatch(/丈夫|老公/);
    expect(titles.join("\n")).toContain("闺蜜");
    expect(titles.join("\n")).toMatch(/出轨|背叛|婚外/);
    expect(titles.join("\n")).toMatch(/崩溃|打脸|反转|炸了/);
    expect(rendered).toContain("# Short story titles: 出轨复仇");
  });

  it("formats chapters into a publish package with mobile-friendly paragraphs and book text", () => {
    const titles = renderShortStoryTitlesMarkdown("悬疑惊悚", [
      "《姐姐失踪三年后给我打电话，冷柜里的女尸睁眼了》",
    ]);
    const planMarkdown = [
      "# Short story plan: 悬疑惊悚",
      "",
      "- Target: 12000 words",
      "- Chapter target: 1500 words",
      "- Chapters: 1",
      "",
      "## [1] hook - 开局冲突",
      "",
      "- summary: 深夜十一点，法医助理许念在停尸间接到已故姐姐许晴的来电，冷柜里的无名女尸突然睁眼看向她。",
      "- conflict: 许念想报警却发现手机没有来电记录，主任要求她立刻删除监控。",
      "- endingHook: 三号冷柜再次响起，姐姐的声音让她别回头。",
      "- targetWords: 1500",
      "",
    ].join("\n");
    const longParagraph = "许念站在停尸间，手机屏幕没有来电记录，三号冷柜却自己弹开一寸。她攥紧手电，低声问姐姐到底在哪。电话那头忽然安静，只剩一道贴着耳边的呼吸。冷柜灯猛地闪烁，无名女尸睁开眼。";
    const pkg = createShortStoryPublishPackage({
      theme: "悬疑惊悚",
      planMarkdown,
      titlesMarkdown: titles,
      chapters: [
        {
          chapterNumber: 1,
          fileName: "001.md",
          content: `# 第1章\n\n${longParagraph}\n\n\n\n第二段。\n`,
        },
      ],
    });

    expect(pkg.bookTitle).toBe("《姐姐失踪三年后给我打电话，冷柜里的女尸睁眼了》");
    expect(pkg.chapters).toHaveLength(1);
    expect(pkg.chapters[0]?.fileName).toBe("001_凌晨电话来自死人.md");
    expect(pkg.chapters[0]?.content).toContain("# 第1章 凌晨电话来自死人");
    expect(pkg.chapters[0]?.content).not.toMatch(/\n{3,}/);
    expect(pkg.bookText).toContain(pkg.bookTitle);
    expect(pkg.bookText).toContain("第1章 凌晨电话来自死人");
    expect(pkg.bookText).not.toContain("# 第1章");
  });

  it("generates short-video script lines with regular hooks and reversals", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "悬疑惊悚",
      targetWords: 50_000,
    });
    const planMarkdown = renderPlanMarkdown("悬疑惊悚", 50_000, 1_500, sourcePlan);
    const [firstDraft] = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(planMarkdown));
    const lines = generateShortStoryVideoScript({
      theme: "悬疑惊悚",
      firstChapterMarkdown: firstDraft?.content ?? "",
    });
    const rendered = renderShortStoryVideoScript(lines);

    expect(lines.length).toBeGreaterThanOrEqual(15);
    expect(lines.length).toBeLessThanOrEqual(25);
    expect(lines.every((line) => line.length >= 15 && line.length <= 30)).toBe(true);
    expect(lines[2]).toMatch(/不是我|全场炸|惨白/);
    expect(lines[5]).toMatch(/诡异|反转|破十万/);
    expect(lines[11]).toMatch(/原来|忍了十年|十三楼/);
    expect(lines.at(-1)).toMatch(/冷柜|亲生父亲|别回头/);
    expect(rendered.split("\n").filter(Boolean)).toHaveLength(lines.length);
  });

  it("analyzes publish potential across titles, opening, pace, middle, and endings", () => {
    const sourcePlan = createShortStoryChapterPlan({
      theme: "悬疑惊悚",
      targetWords: 50_000,
    });
    const planMarkdown = renderPlanMarkdown("悬疑惊悚", 50_000, 1_500, sourcePlan);
    const drafts = generateShortStoryDraftChapters(parseShortStoryPlanMarkdown(planMarkdown));
    const titlesMarkdown = renderShortStoryTitlesMarkdown("悬疑惊悚", generateShortStoryTitles({
      theme: "悬疑惊悚",
      planMarkdown,
      firstChapterMarkdown: drafts[0]?.content ?? "",
    }));
    const report = analyzeShortStoryPublishReadiness({
      theme: "悬疑惊悚",
      titlesMarkdown,
      chapters: drafts.map((draft) => ({
        chapterNumber: draft.chapterNumber,
        fileName: `${String(draft.chapterNumber).padStart(3, "0")}.md`,
        content: draft.content,
      })),
    });
    const markdown = renderShortStoryAnalysisMarkdown(report);

    expect(report.overallScore).toBeGreaterThan(50);
    expect(report.scores.titleClickRate.name).toBe("标题点击率评分");
    expect(report.scores.openingAttraction.name).toBe("前300字吸引力");
    expect(report.scores.beatDensity.name).toBe("节奏密度");
    expect(report.scores.middleDrag.name).toBe("中段拖沓检测");
    expect(report.scores.endingHook.name).toBe("结尾钩子强度");
    expect(markdown).toContain("# Short story analysis: 悬疑惊悚");
    expect(markdown).toContain("| 标题点击率评分 |");
    expect(markdown).toContain("## Recommendations");
  });
});

describe("short story auditor", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("reports valid chapter and book length as passing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-short-story-"));
    await writeChapters(tempDir, [
      chapterText(1_500),
      chapterText(1_500),
      chapterText(1_500),
      chapterText(1_500),
      chapterText(1_500),
      chapterText(1_500),
    ]);

    const report = await auditShortStoryBook({
      bookName: "demo",
      bookDir: tempDir,
    });

    expect(report.passed).toBe(true);
    expect(report.totalWords).toBe(9_000);
    expect(report.issues).toEqual([]);
  });

  it("reports empty chapters, illegal length, recommended drift, and forbidden continuation phrases", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "inkos-short-story-"));
    await writeChapters(tempDir, [
      "",
      chapterText(900),
      `${chapterText(2_300)}\n${SHORT_STORY_FORBIDDEN_CONTINUATION_PHRASES[0]}`,
    ]);

    const report = await auditShortStoryBook({
      bookName: "demo",
      bookDir: tempDir,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "book_word_count_out_of_range",
      "empty_chapter",
      "chapter_word_count_outside_recommended_range",
      "chapter_word_count_out_of_range",
      "forbidden_continuation_phrase",
    ]));
  });
});

async function writeChapters(bookDir: string, chapters: ReadonlyArray<string>): Promise<void> {
  const chaptersDir = join(bookDir, "chapters");
  await mkdir(chaptersDir, { recursive: true });
  await Promise.all(
    chapters.map((content, index) => {
      const chapterNumber = String(index + 1).padStart(4, "0");
      return writeFile(join(chaptersDir, `${chapterNumber}_测试.md`), content, "utf-8");
    }),
  );
}

function chapterText(length: number): string {
  return "我".repeat(length);
}

function renderPlanMarkdown(
  theme: string,
  targetWords: number,
  chapterTargetWords: number,
  chapters: ReturnType<typeof createShortStoryChapterPlan>,
): string {
  return [
    `# Short story plan: ${theme}`,
    "",
    `- Target: ${targetWords} words`,
    `- Chapter target: ${chapterTargetWords} words`,
    `- Chapters: ${chapters.length}`,
    "",
    ...chapters.flatMap((chapter) => [
      `## [${chapter.chapterNumber}] ${chapter.function} - 测试`,
      "",
      `- summary: ${chapter.summary}`,
      `- conflict: ${chapter.conflict}`,
      `- endingHook: ${chapter.endingHook}`,
      `- targetWords: ${chapter.targetWords}`,
      "",
    ]),
  ].join("\n");
}
