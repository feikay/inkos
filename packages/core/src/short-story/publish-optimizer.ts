import { resolveShortStoryPlanStrategy } from "./strategies/index.js";

export interface ShortStoryHookOptimizationResult {
  readonly theme: string;
  readonly strategyId: string;
  readonly content: string;
  readonly changed: boolean;
}

export interface ShortStoryTitleOptions {
  readonly theme: string;
  readonly planMarkdown: string;
  readonly firstChapterMarkdown: string;
}

export interface ShortStoryPublishChapterInput {
  readonly chapterNumber: number;
  readonly fileName: string;
  readonly content: string;
}

export interface ShortStoryPublishChapter {
  readonly chapterNumber: number;
  readonly fileName: string;
  readonly title: string;
  readonly content: string;
}

export interface ShortStoryPublishPackage {
  readonly theme: string;
  readonly bookTitle: string;
  readonly chapters: ReadonlyArray<ShortStoryPublishChapter>;
  readonly bookText: string;
}

export interface ShortStoryVideoScriptOptions {
  readonly theme: string;
  readonly firstChapterMarkdown: string;
}

export interface ShortStoryAnalysisChapterInput {
  readonly chapterNumber: number;
  readonly fileName: string;
  readonly content: string;
}

export interface ShortStoryAnalysisScore {
  readonly name: string;
  readonly score: number;
  readonly summary: string;
  readonly evidence: ReadonlyArray<string>;
}

export interface ShortStoryAnalysisReport {
  readonly theme: string;
  readonly chapterCount: number;
  readonly titleCount: number;
  readonly overallScore: number;
  readonly scores: {
    readonly titleClickRate: ShortStoryAnalysisScore;
    readonly openingAttraction: ShortStoryAnalysisScore;
    readonly beatDensity: ShortStoryAnalysisScore;
    readonly middleDrag: ShortStoryAnalysisScore;
    readonly endingHook: ShortStoryAnalysisScore;
  };
  readonly recommendations: ReadonlyArray<string>;
}

export function optimizeShortStoryOpening(
  theme: string,
  chapterMarkdown: string,
): ShortStoryHookOptimizationResult {
  const strategy = resolveShortStoryPlanStrategy(theme);
  const optimizedOpening = strategy.id === "thriller"
    ? thrillerOpening()
    : betrayalRevengeOpening();
  const content = replaceOpeningParagraphs(chapterMarkdown, optimizedOpening, 3);

  return {
    theme,
    strategyId: strategy.id,
    content,
    changed: content !== chapterMarkdown,
  };
}

export function generateShortStoryTitles(
  options: ShortStoryTitleOptions,
): ReadonlyArray<string> {
  const strategy = resolveShortStoryPlanStrategy(options.theme);
  if (strategy.id === "thriller") {
    return thrillerTitles();
  }
  return betrayalRevengeTitles();
}

export function renderShortStoryTitlesMarkdown(theme: string, titles: ReadonlyArray<string>): string {
  const lines = [`# Short story titles: ${theme}`, ""];
  for (const title of titles) {
    lines.push(`- ${title}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function createShortStoryPublishPackage(options: {
  readonly theme: string;
  readonly chapters: ReadonlyArray<ShortStoryPublishChapterInput>;
  readonly titlesMarkdown?: string;
}): ShortStoryPublishPackage {
  const bookTitle = parseFirstShortStoryTitle(options.titlesMarkdown) ?? `《${options.theme}》`;
  const chapters = options.chapters
    .slice()
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((chapter) => formatShortStoryPublishChapter(chapter));
  const bookText = [
    bookTitle,
    "",
    ...chapters.flatMap((chapter) => [
      chapter.title,
      "",
      stripMarkdownTitle(chapter.content).trim(),
      "",
    ]),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  return {
    theme: options.theme,
    bookTitle,
    chapters,
    bookText,
  };
}

export function parseFirstShortStoryTitle(markdown: string | undefined): string | undefined {
  if (!markdown) return undefined;
  const match = markdown.match(/^- (《.+?》)\s*$/m);
  return match?.[1];
}

export function formatShortStoryPublishChapter(input: ShortStoryPublishChapterInput): ShortStoryPublishChapter {
  const normalized = input.content.replace(/\r\n/g, "\n").trim();
  const originalTitle = normalized.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = originalTitle && originalTitle.length > 0
    ? originalTitle
    : `第${input.chapterNumber}章`;
  const body = stripMarkdownTitle(normalized);
  const paragraphs = formatMobileFriendlyParagraphs(body);
  const content = `# ${title}\n\n${paragraphs.join("\n\n")}\n`;

  return {
    chapterNumber: input.chapterNumber,
    fileName: input.fileName,
    title,
    content,
  };
}

export function generateShortStoryVideoScript(
  options: ShortStoryVideoScriptOptions,
): ReadonlyArray<string> {
  const strategy = resolveShortStoryPlanStrategy(options.theme);
  const lines = strategy.id === "thriller"
    ? thrillerVideoScript()
    : betrayalRevengeVideoScript();
  return lines.map(normalizeScriptLine);
}

export function renderShortStoryVideoScript(lines: ReadonlyArray<string>): string {
  return `${lines.join("\n").trimEnd()}\n`;
}

export function analyzeShortStoryPublishReadiness(options: {
  readonly theme: string;
  readonly chapters: ReadonlyArray<ShortStoryAnalysisChapterInput>;
  readonly titlesMarkdown: string;
}): ShortStoryAnalysisReport {
  const chapters = options.chapters.slice().sort((a, b) => a.chapterNumber - b.chapterNumber);
  const titles = parseShortStoryTitles(options.titlesMarkdown);
  const titleClickRate = scoreTitleClickRate(titles);
  const openingAttraction = scoreOpeningAttraction(chapters[0]?.content ?? "", options.theme);
  const beatDensity = scoreBeatDensity(chapters);
  const middleDrag = scoreMiddleDrag(chapters);
  const endingHook = scoreEndingHook(chapters);
  const overallScore = clampScore(Math.round(
    titleClickRate.score * 0.2
    + openingAttraction.score * 0.25
    + beatDensity.score * 0.25
    + middleDrag.score * 0.15
    + endingHook.score * 0.15
  ));

  return {
    theme: options.theme,
    chapterCount: chapters.length,
    titleCount: titles.length,
    overallScore,
    scores: {
      titleClickRate,
      openingAttraction,
      beatDensity,
      middleDrag,
      endingHook,
    },
    recommendations: buildAnalysisRecommendations({
      titleClickRate,
      openingAttraction,
      beatDensity,
      middleDrag,
      endingHook,
    }),
  };
}

export function renderShortStoryAnalysisMarkdown(report: ShortStoryAnalysisReport): string {
  const scoreRows = [
    report.scores.titleClickRate,
    report.scores.openingAttraction,
    report.scores.beatDensity,
    report.scores.middleDrag,
    report.scores.endingHook,
  ];
  const lines = [
    `# Short story analysis: ${report.theme}`,
    "",
    `- Overall score: ${report.overallScore}/100`,
    `- Chapters: ${report.chapterCount}`,
    `- Titles: ${report.titleCount}`,
    "",
    "## Scores",
    "",
    "| Dimension | Score | Summary |",
    "| --- | ---: | --- |",
    ...scoreRows.map((score) => `| ${score.name} | ${score.score}/100 | ${score.summary} |`),
    "",
  ];

  for (const score of scoreRows) {
    lines.push(`## ${score.name}`, "", `Score: ${score.score}/100`, "");
    for (const evidence of score.evidence) {
      lines.push(`- ${evidence}`);
    }
    lines.push("");
  }

  lines.push("## Recommendations", "");
  for (const recommendation of report.recommendations) {
    lines.push(`- ${recommendation}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function replaceOpeningParagraphs(
  markdown: string,
  opening: ReadonlyArray<string>,
  dropParagraphCount: number,
): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const titleMatch = normalized.match(/^(# .+?)\n\n/);
  const title = titleMatch?.[1] ?? "# 第1章";
  const body = titleMatch ? normalized.slice(titleMatch[0].length) : normalized;
  const paragraphs = body.split(/\n\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const rest = paragraphs.slice(dropParagraphCount);
  return `${title}\n\n${[...opening, ...rest].join("\n\n")}\n`;
}

function stripMarkdownTitle(markdown: string): string {
  return markdown.replace(/^#\s+.+?(?:\n+|$)/, "").trim();
}

function formatMobileFriendlyParagraphs(markdown: string): string[] {
  const paragraphs = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    result.push(...splitLongParagraph(paragraph));
  }

  return result;
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= 120) {
    return [paragraph];
  }

  const sentences = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [paragraph];
  const groups: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && `${current}${sentence}`.length > 120) {
      groups.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) groups.push(current);

  return groups.flatMap((group) => splitOversizedText(group, 140));
}

function splitOversizedText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function normalizeScriptLine(line: string): string {
  const compact = line.replace(/\s+/g, "");
  if (compact.length <= 30) return compact;
  return compact.slice(0, 29) + "。";
}

function parseShortStoryTitles(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.match(/^- (《.+?》)\s*$/)?.[1]?.trim())
    .filter((title): title is string => Boolean(title));
}

function scoreTitleClickRate(titles: ReadonlyArray<string>): ShortStoryAnalysisScore {
  const text = titles.join("\n");
  const relationshipHits = countMatches(text, /妻子|丈夫|老公|闺蜜|姐姐|妹妹|母亲|父亲|女儿|主任|凶手/g);
  const conflictHits = countMatches(text, /出轨|背叛|曝光|失踪|冷柜|女尸|认尸|死亡|真相|恐怖/g);
  const resultHits = countMatches(text, /打脸|反转|崩溃|炸了|跪了|慌了|睁眼|社死/g);
  const visualHits = countMatches(text, /宴会|酒店|停尸间|监控|电话|录像|鉴定|录音/g);
  const score = clampScore(30 + relationshipHits * 5 + conflictHits * 5 + resultHits * 6 + visualHits * 3);

  return {
    name: "标题点击率评分",
    score,
    summary: titles.length > 0
      ? `标题覆盖人物关系、冲突和结果的强度为 ${score >= 80 ? "强" : score >= 60 ? "中" : "弱"}。`
      : "未发现 titles.md 标题，点击率无法稳定评估。",
    evidence: [
      `标题数量：${titles.length}`,
      `人物关系命中：${relationshipHits}，冲突命中：${conflictHits}，结果命中：${resultHits}`,
      `画面化词命中：${visualHits}`,
    ],
  };
}

function scoreOpeningAttraction(chapterMarkdown: string, theme: string): ShortStoryAnalysisScore {
  const opening = compactBody(chapterMarkdown).slice(0, 300);
  const first50 = opening.slice(0, 50);
  const first150 = opening.slice(0, 150);
  const strategy = resolveShortStoryPlanStrategy(theme);
  const conflictPattern = strategy.id === "thriller"
    ? /冷柜|电话|尸|失踪|血|监控|三号|不是我/
    : /视频|出轨|曝光|顾沉|苏蔓|抢|酒店|直播/;
  const questionPattern = strategy.id === "thriller"
    ? /不是我|在哪|身后|没有来电|睁开眼|十三/
    : /全场|大屏|直播|十万|付款|鉴定|反转/;
  const first50Hit = conflictPattern.test(first50);
  const first150Hit = questionPattern.test(first150);
  const reversalHits = countMatches(opening, /竟|却|原来|反而|没想到|下一秒|不是|反转/g);
  const dialogueHits = countMatches(opening, /“[^”]{2,40}”/g);
  const score = clampScore(35 + (first50Hit ? 20 : 0) + (first150Hit ? 20 : 0) + reversalHits * 7 + dialogueHits * 4);

  return {
    name: "前300字吸引力",
    score,
    summary: `前 300 字${score >= 80 ? "有强冲突和早反转" : score >= 60 ? "有可用钩子但还能更狠" : "开场抓力偏弱"}。`,
    evidence: [
      `前50字直接异常/冲突：${first50Hit ? "是" : "否"}`,
      `前150字制造疑问/曝光：${first150Hit ? "是" : "否"}`,
      `前300字反转词命中：${reversalHits}，对话命中：${dialogueHits}`,
    ],
  };
}

function scoreBeatDensity(chapters: ReadonlyArray<ShortStoryAnalysisChapterInput>): ShortStoryAnalysisScore {
  const text = chapters.map((chapter) => stripMarkdownTitle(chapter.content)).join("\n");
  const length = compactText(text).length;
  const beatCount = countMatches(text, beatPattern());
  const charsPerBeat = beatCount > 0 ? Math.round(length / beatCount) : length;
  const score = beatCount === 0
    ? 20
    : clampScore(100 - Math.abs(charsPerBeat - 360) / 5);

  return {
    name: "节奏密度",
    score,
    summary: beatCount > 0
      ? `平均约 ${charsPerBeat} 字一个爆点/悬念。`
      : "未检测到稳定爆点或悬念词。",
    evidence: [
      `总字数估算：${length}`,
      `爆点/悬念命中：${beatCount}`,
      `推荐区间：约 300–450 字一个情绪或信息刺激点`,
    ],
  };
}

function scoreMiddleDrag(chapters: ReadonlyArray<ShortStoryAnalysisChapterInput>): ShortStoryAnalysisScore {
  const middle = chapters.slice(
    Math.floor(chapters.length * 0.3),
    Math.max(Math.floor(chapters.length * 0.7), Math.floor(chapters.length * 0.3) + 1),
  );
  const dragChapters = middle
    .map((chapter) => ({
      chapter,
      beats: countMatches(chapter.content, beatPattern()),
      dialogues: countMatches(chapter.content, /“[^”]{2,60}”/g),
      longParagraphs: chapter.content.split(/\n\n+/).filter((paragraph) => compactText(paragraph).length > 180).length,
    }))
    .filter((item) => item.beats < 4 || item.dialogues < 3 || item.longParagraphs > 2);
  const score = clampScore(100 - dragChapters.length * 14);

  return {
    name: "中段拖沓检测",
    score,
    summary: dragChapters.length === 0
      ? "中段章节保持了足够事件和对话波动。"
      : `检测到 ${dragChapters.length} 个中段章节可能偏拖。`,
    evidence: dragChapters.length === 0
      ? [`检测章节：${middle.length}，未发现明显低波动章节`]
      : dragChapters.slice(0, 6).map((item) =>
        `第${item.chapter.chapterNumber}章：爆点 ${item.beats}，对话 ${item.dialogues}，长段 ${item.longParagraphs}`
      ),
  };
}

function scoreEndingHook(chapters: ReadonlyArray<ShortStoryAnalysisChapterInput>): ShortStoryAnalysisScore {
  const endings = chapters.map((chapter) => ({
    chapter,
    tail: compactBody(chapter.content).slice(-260),
  }));
  const hookHits = endings.reduce((sum, item) => sum + (endingHookPattern().test(item.tail) ? 1 : 0), 0);
  const lastTail = endings.at(-1)?.tail ?? "";
  const finalResolved = /重新开始|真相|尘埃落定|修复|判决|回家|自由|活下去|天亮/.test(lastTail);
  const score = clampScore(40 + hookHits * 4 + (finalResolved ? 12 : 0));

  return {
    name: "结尾钩子强度",
    score,
    summary: `共有 ${hookHits}/${chapters.length} 章尾段含明确钩子或情绪收束。`,
    evidence: [
      `章节尾段钩子命中：${hookHits}`,
      `最终章完整收束：${finalResolved ? "是" : "否"}`,
      `最终章尾段摘录：${lastTail.slice(-80) || "无"}`,
    ],
  };
}

function buildAnalysisRecommendations(scores: {
  readonly titleClickRate: ShortStoryAnalysisScore;
  readonly openingAttraction: ShortStoryAnalysisScore;
  readonly beatDensity: ShortStoryAnalysisScore;
  readonly middleDrag: ShortStoryAnalysisScore;
  readonly endingHook: ShortStoryAnalysisScore;
}): string[] {
  const recommendations: string[] = [];
  if (scores.titleClickRate.score < 80) {
    recommendations.push("标题继续补足人物关系、冲突结果和画面词，优先让第一眼知道谁背叛谁、谁反杀谁。");
  }
  if (scores.openingAttraction.score < 85) {
    recommendations.push("前300字再提前一次异常/曝光和反转，减少背景解释。");
  }
  if (scores.beatDensity.score < 75) {
    recommendations.push("把低刺激段落压缩，每300–450字补一个证据、威胁、反转或情绪爆发。");
  }
  if (scores.middleDrag.score < 85) {
    recommendations.push("中段增加场景切换和对话交锋，避免连续复述同一组证据。");
  }
  if (scores.endingHook.score < 80) {
    recommendations.push("每章结尾补强未解决问题、下一步行动或新的危险，最终章则保留完整收束。");
  }
  if (recommendations.length === 0) {
    recommendations.push("当前内容具备较强发布潜力，可优先进入标题 A/B 和封面文案测试。");
  }
  return recommendations;
}

function compactBody(markdown: string): string {
  return compactText(stripMarkdownTitle(markdown));
}

function compactText(text: string): string {
  return text.replace(/\s+/g, "");
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function beatPattern(): RegExp {
  return /曝光|证据|监控|录音|截图|鉴定|冷笑|崩溃|失控|怒|哭|反击|反转|真相|威胁|炸|睁眼|冷柜|尸|血|失踪|十三|别回头|凶手|死亡|报警|抓捕|跪|社死|全场/g;
}

function endingHookPattern(): RegExp {
  return /下一秒|门外|身后|电话|冷柜|别回头|原来|竟|却|报告|证据|真相|名单|录音|监控|抓捕|判决|重新开始|天亮/g;
}

function thrillerVideoScript(): ReadonlyArray<string> {
  return [
    "许念半夜守停尸间，手机突然响了",
    "电话那头，竟是失踪三年的姐姐许晴",
    "她发抖说，三号冷柜里的人不是我",
    "许念低头一看，手机根本没来电记录",
    "可三号冷柜，竟自己弹开了一寸缝",
    "更诡异的是，尸体手腕有姐姐旧疤",
    "她刚想报警，监控却拍不到那通电话",
    "所有人都说，她精神已经出了问题",
    "可录音里，姐姐还在一遍遍叫她名字",
    "许念刚靠近冷柜，女尸竟突然睁眼",
    "玻璃上慢慢划出一个血色数字十三",
    "原来姐姐失踪前，最后也在十三楼",
    "主任冲来抢手机，逼她当场删证据",
    "许念却早把那段录音传到了云端备份",
    "下一秒，走廊尽头传来男人的笑声",
    "她回看监控，自己身后明明没有人",
    "可耳机里有人贴着她耳边轻声说话",
    "别回头，三号冷柜又自己响了起来",
  ];
}

function betrayalRevengeVideoScript(): ReadonlyArray<string> {
  return [
    "十周年宴会上，林晚当众直接开麦",
    "她播放丈夫和闺蜜的酒店开房视频",
    "全场瞬间炸了，顾沉脸色惨白发僵",
    "苏蔓还想哭，说自己只是去送文件",
    "林晚冷笑，当场又点开第二段视频",
    "反转来了，直播间人数已经破十万",
    "顾沉冲上台，伸手就想抢走遥控器",
    "安保立刻拦住，镜头全都对准了他",
    "林晚把买房转账截图直接放上大屏",
    "顾家父母想清场，可一切已经晚了",
    "宾客手机全举起，舆论彻底当场炸开",
    "原来她忍了整整十年，只等这一天",
    "顾沉压低声音，威胁她一定会后悔",
    "林晚只回一句，后悔的是我忍太久",
    "苏蔓转身想逃，却被堵在宴会出口",
    "所有人以为，这场报复已经够狠了",
    "可林晚又拿出一份亲子鉴定报告书",
    "她说，顾念的亲生父亲竟另有其人",
  ];
}

function betrayalRevengeOpening(): ReadonlyArray<string> {
  return [
    "“顾沉，你和苏蔓开房的视频，现在全场一起看。”林晚按下播放键。",
    "大屏骤亮。十周年宴会瞬间死静，顾家亲友、合作方和媒体同时看见顾沉凌晨刷开酒店房门。",
    "顾沉脸色一沉，冲上台抢遥控器：“林晚，关掉！”",
    "苏蔓哭着挡在他身前：“晚晚，你误会了，我只是去送文件。”",
    "林晚冷笑，点开第二段。画面没黑，反而跳出直播间人数：十万。",
    "下一秒，付款截图铺满侧屏。顾沉给苏蔓买房、转账、改备注的记录一条不少，全场哗然。",
  ];
}

function thrillerOpening(): ReadonlyArray<string> {
  return [
    "“三号冷柜里的人不是我。”失踪三年的姐姐许晴，在电话里哭着叫许念的名字。",
    "许念站在停尸间，手机屏幕没有来电记录，三号冷柜却自己弹开一寸。",
    "她攥紧手电，低声问：“姐，你到底在哪？”",
    "电话那头忽然安静，只剩一道贴着耳边的呼吸：“我在你身后。”",
    "冷柜灯猛地闪烁。无名女尸睁开眼，手腕旧疤和许晴一模一样，指尖还在玻璃上划出一个数字：十三。",
    "许念刚拍下照片，走廊尽头传来男人的笑声。监控画面里，她身后明明空无一人。",
  ];
}

function betrayalRevengeTitles(): ReadonlyArray<string> {
  return [
    "《妻子在十周年宴会上曝光丈夫和闺蜜出轨，全场炸了》",
    "《我当众播放丈夫出轨录像，闺蜜哭着求我别再放》",
    "《丈夫带闺蜜逼我离婚，我反手曝光证据让他崩溃》",
    "《妻子撕开丈夫和闺蜜的背叛，亲子鉴定一出全家跪了》",
    "《我在宴会上揭穿老公出轨，闺蜜下一秒脸都白了》",
    "《丈夫和闺蜜演深情，我直播曝光后他们全网社死》",
    "《妻子忍了十年背叛，宴会一开屏丈夫彻底崩溃》",
    "《老公出轨闺蜜还想让我净身出户，我让他当场翻车》",
    "《闺蜜抢我丈夫还装无辜，我一份鉴定让她崩溃》",
    "《妻子曝光丈夫婚外情后反转，全场才知她忍了十年》",
  ];
}

function thrillerTitles(): ReadonlyArray<string> {
  return [
    "《姐姐失踪三年后给我打电话，冷柜里的女尸睁眼了》",
    "《我在停尸间接到姐姐来电，认尸的男人当场崩溃》",
    "《女尸手腕有姐姐旧疤，我曝光真相后凶手慌了》",
    "《失踪姐姐说冷柜里不是她，下一秒监控拍到诡异反转》",
    "《丈夫式嫌疑人来认尸，我发现他袖扣藏着失踪真相》",
    "《闺蜜般的同事劝我别查，停尸间录音让所有人崩溃》",
    "《我追查姐姐死亡证明，医院旧档案揭开恐怖反转》",
    "《认尸当天尸体消失，背后黑手被我一段录音打脸》",
    "《姐姐从冷柜给我警告，我反手曝光凶手全网崩溃》",
    "《我以为姐姐死了，直到停尸间电话揭开第十三层秘密》",
  ];
}
