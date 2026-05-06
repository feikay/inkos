import { resolveShortStoryPlanStrategy } from "./strategies/index.js";
import type { ShortStoryVariant } from "./schema.js";

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
  variant?: ShortStoryVariant,
): ShortStoryHookOptimizationResult {
  const strategy = resolveShortStoryPlanStrategy(theme);
  const optimizedOpening = variant
    ? variantOpening(strategy.id, variant)
    : strategy.id === "thriller"
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

function variantOpening(strategyId: string, variant: ShortStoryVariant): ReadonlyArray<string> {
  const clue = pickVariantOpeningClue(variant);
  const secretTrace = pickVariantOpeningSecretTrace(variant);
  const conflictTrace = pickVariantOpeningConflictTrace(variant);
  const hookOpening = variantHookOpening(variant, clue, secretTrace, conflictTrace);
  if (hookOpening) return hookOpening;
  const modeOpening = variantModeOpening(variant, clue, secretTrace, conflictTrace);
  if (modeOpening) return modeOpening;
  if (strategyId === "thriller") {
    const thrillerOpenings: ReadonlyArray<ReadonlyArray<string>> = [
      [
        `${variant.setting}里忽然多出一段倒放的录音，最后两个字是${variant.protagonist}的名字。`,
        `${variant.protagonist}没有碰播放键，录音却自己跳到凌晨三点。背景里，有人轻轻敲了三下。`,
        `${variant.ally}只发来一句：“别删，先看${clue}。”`,
        `${variant.antagonist}赶到时，没有问发生了什么，只看了一眼桌面，立刻要她关机。`,
        `${variant.protagonist}这才发现，${secretTrace}早被人放在她能看见的位置。`,
        `她以为自己撞见异常，下一秒却明白，异常是在等她。`,
      ],
      [
        `凌晨的自动灯亮了七次。第八次，${variant.protagonist}看见${variant.setting}的门缝下塞进一张空白回执。`,
        `回执遇热才显字，第一行不是地址，是她今天刚删掉的搜索记录。`,
        `${variant.ally}的电话打不通，只回了一张${clue}的照片。照片背面，有人用红笔圈住${secretTrace}。`,
        `${variant.antagonist}随后出现，鞋底还沾着同样的灰，却说自己刚从另一条路过来。`,
        `${variant.protagonist}没有拆穿。她把回执折回去，先记下他袖口那道新划痕。`,
        `真正让她发冷的不是回执，而是它写着明天才会发生的事。`,
      ],
      [
        `${variant.protagonist}刚关灯，${variant.setting}的备用屏幕自己亮了。屏幕上只有一个文件夹：别打开。`,
        `她偏偏点开。里面没有视频，只有三张连续截图，每一张都拍自她身后。`,
        `${clue}夹在截图最后，时间比现在晚十分钟。`,
        `${variant.antagonist}发来语音，语气平稳得反常：“你现在看见的，不该属于你。”`,
        `${variant.protagonist}把语音转存，发现波形里藏着第二句话：${secretTrace}。`,
        `下一秒，身后的门锁响了。不是有人进来，是有人从里面反锁。`,
      ],
    ];
    return thrillerOpenings[variant.runIndex % thrillerOpenings.length]!;
  }
  const revengeOpenings: ReadonlyArray<ReadonlyArray<string>> = [
    [
      `${variant.protagonist}把投屏线插上时，${variant.antagonist}还在笑。三秒后，屏幕亮了，他的笑僵在脸上。`,
      `${variant.keyRelation}先站起来，眼眶红得恰到好处，可手指已经在偷偷按删除键。`,
      `${variant.protagonist}没有骂人，只放大${clue}。每一个时间点，都像钉子钉进桌面。`,
      `${variant.antagonist}冲过来抢设备，她反手切到备份页，第二份记录正好接上${conflictTrace}。`,
      `现场安静得能听见呼吸。${secretTrace}被摆出来后，没人再敢替他们圆场。`,
      `${variant.protagonist}手还在抖，声音却稳了：“别急，今晚只讲证据。”`,
    ],
    [
      `${variant.antagonist}把协议推到桌上时，${variant.protagonist}直接撕掉第一页。`,
      `纸屑落下来，${variant.keyRelation}脸上的笑终于挂不住。`,
      `${variant.protagonist}打开录音，第一句就是${variant.antagonist}亲口提到${clue}。`,
      `他想否认，她又点开第二段。${conflictTrace}一出现，旁边的人全都闭了嘴。`,
      `${secretTrace}不是最后一刀，却足够让他再也装不出体面。`,
      `${variant.protagonist}站起来，只说：“你们欠我的，从现在开始一笔笔还。”`,
    ],
    [
      `掌声还没停，${variant.protagonist}把一只旧文件袋扔到主桌中央。`,
      `${variant.antagonist}低声警告她别闹，她却当众抽出${clue}。`,
      `${variant.keyRelation}想哭，眼泪还没落下，就听见录音里自己的声音。`,
      `${variant.protagonist}没有给他们插话的机会，直接把${conflictTrace}投到大屏。`,
      `最刺眼的不是数字，是${secretTrace}后面那枚熟悉签名。`,
      `她看着全场变脸，终于把那口忍了很久的气吐出来。`,
    ],
  ];
  return revengeOpenings[variant.runIndex % revengeOpenings.length]!;
}

function variantHookOpening(
  variant: ShortStoryVariant,
  clue: string,
  secretTrace: string,
  conflictTrace: string,
): ReadonlyArray<string> | undefined {
  switch (variant.hookMode) {
    case "normal":
      return normalHookOpening(variant, clue, secretTrace);
    case "strong":
      return strongHookOpening(variant, clue, secretTrace, conflictTrace);
    case "viral":
      return viralHookOpening(variant, clue, secretTrace, conflictTrace);
  }
}

function normalHookOpening(
  variant: ShortStoryVariant,
  clue: string,
  secretTrace: string,
): ReadonlyArray<string> {
  if (variant.writingMode === "emotion") {
    return [
      `我第一次注意到异常，是因为${variant.setting}里多了一份没人认领的${clue}。`,
      `它不吓人，只是太安静，像被人提前放在那里等我。`,
      `${variant.ally}让我先别声张，可我看见${secretTrace}时，心里还是沉了一下。`,
      `${variant.antagonist}很快出现，语气正常得过分。`,
      `我忽然不确定，他是在解释，还是在确认我到底看见了多少。`,
    ];
  }
  if (variant.writingMode === "weird") {
    return [
      `${variant.setting}的灯慢了一拍才亮。桌面上多了一份${clue}，边角压着浅浅的水痕。`,
      `没有脚印，也没有开门声。`,
      `${variant.protagonist}伸手前，水痕自己往外扩了一点。`,
      `${variant.ally}说可能是设备故障，声音却比平时轻。`,
      `${secretTrace}藏在最后一行，像一句没说完的话。`,
    ];
  }
  if (variant.writingMode === "logic") {
    return [
      `${variant.protagonist}发现${clue}时，先看时间，再看来源。`,
      `时间正常，来源空白。异常只有一处：文件被打开过两次。`,
      `第一次是她到达前。第二次，显示为一分钟后。`,
      `${variant.ally}提醒她别急着下结论。`,
      `她点开末尾，看到${secretTrace}，才把这件事单独记了一页。`,
    ];
  }
  return [
    `${variant.protagonist}在${variant.setting}发现一份陌生的${clue}。`,
    `它没有立刻指向任何人，只在末尾留下${secretTrace}。`,
    `${variant.ally}劝她先别惊动${variant.antagonist}。`,
    `可${variant.antagonist}偏偏在这时出现，像早就知道她会站在那里。`,
    `${variant.protagonist}把文件合上，没有问，只先记住他的表情。`,
  ];
}

function strongHookOpening(
  variant: ShortStoryVariant,
  clue: string,
  secretTrace: string,
  conflictTrace: string,
): ReadonlyArray<string> {
  if (variant.writingMode === "emotion") {
    return [
      `我刚碰到${clue}，${variant.antagonist}就掐断了灯：“你不该看见这个。”`,
      `黑暗里，我听见自己的名字从另一台设备里响起。那声音比我更冷静。`,
      `${variant.ally}撞门进来，却先拦住我：“别信他，也别信你刚才听见的自己。”`,
      `我手心全是汗，还是把${conflictTrace}投到墙上。`,
      `${secretTrace}出现的那一秒，${variant.antagonist}终于慌了。`,
    ];
  }
  if (variant.writingMode === "conflict") {
    return [
      `“关掉！”${variant.antagonist}冲过来抢${clue}，屏幕却自动跳出${variant.protagonist}的失踪记录。`,
      `“我站在这儿。”${variant.protagonist}反手锁门，“你告诉我，谁给我办的失踪？”`,
      `${variant.ally}挡住出口：“先别动，她的账号刚在另一个地方登录。”`,
      `${variant.antagonist}脸色骤变。${conflictTrace}已经亮在所有人面前。`,
      `${variant.protagonist}把备份推送出去：“现在，轮到你解释。”`,
    ];
  }
  if (variant.writingMode === "weird") {
    return [
      `${variant.setting}的门自己反锁，${clue}在屏幕上慢慢变成${variant.protagonist}的手写字。`,
      `${variant.antagonist}站在门外，声音隔着门缝钻进来：“别念出来。”`,
      `她偏偏念了第一行。灯灭了。`,
      `再亮时，${variant.ally}脸色惨白：“你刚才的声音，不在这个房间里。”`,
      `${secretTrace}躺在桌上，像刚被另一个她放下。`,
    ];
  }
  return [
    `${variant.protagonist}打开${clue}时，系统弹出警告：她本人已在十分钟前确认死亡。`,
    `${variant.antagonist}冲过来按住屏幕：“删掉，马上。”`,
    `${variant.protagonist}没有动。她先看时间，再看${secretTrace}，最后抬头看他。`,
    `${variant.ally}低声说：“这不是错误，是有人提前替你做了决定。”`,
    `${conflictTrace}被同步到第二台设备时，${variant.antagonist}第一次失控。`,
  ];
}

function viralHookOpening(
  variant: ShortStoryVariant,
  clue: string,
  secretTrace: string,
  conflictTrace: string,
): ReadonlyArray<string> {
  if (variant.writingMode === "emotion") {
    return [
      `我收到自己的葬礼邀请时，距离我死亡还有三小时。`,
      `邀请函上写着${variant.setting}，落款是${variant.antagonist}。`,
      `我还没来得及尖叫，手机弹出${clue}：画面里另一个我正替我签字。`,
      `${variant.ally}打来电话，第一句就说：“别承认你是你。”`,
      `可${secretTrace}已经摆在门口，像有人刚从未来回来。`,
    ];
  }
  if (variant.writingMode === "conflict") {
    return [
      `${variant.protagonist}推门进去，看见另一个自己坐在${variant.antagonist}身边。`,
      `“你迟到了。”那个自己抬头，声音一模一样。`,
      `${variant.protagonist}把${clue}砸到桌上：“那我是谁？”`,
      `${variant.antagonist}笑了一下：“这正是你不该问的问题。”`,
      `${conflictTrace}同时弹出两份结果，一份证明她活着，一份证明她早就不存在。`,
    ];
  }
  if (variant.writingMode === "weird") {
    return [
      `${variant.protagonist}在镜子里眨眼，镜子里的她没有眨。`,
      `三秒后，镜中人先开口：“别去${variant.setting}，我已经死在那里。”`,
      `${clue}从镜面内侧滑下来，边角还带着湿冷的指印。`,
      `${variant.antagonist}的电话同时响起：“你旁边是不是还有一个你？”`,
      `${secretTrace}像从墙里长出来，时间却标着明天凌晨。`,
    ];
  }
  return [
    `${variant.protagonist}在监控里看见自己杀了自己。`,
    `时间显示明天凌晨，地点却是此刻的${variant.setting}。`,
    `${clue}自动放大，画面里的人抬头，对镜头说：“别让现在的我活到明天。”`,
    `${variant.ally}发来消息：身份记录被改了，你现在不是你。`,
    `${variant.antagonist}站在门口，手里拿着${secretTrace}，像早就等她发现这一秒。`,
  ];
}

function variantModeOpening(
  variant: ShortStoryVariant,
  clue: string,
  secretTrace: string,
  conflictTrace: string,
): ReadonlyArray<string> | undefined {
  switch (variant.writingMode) {
    case "logic":
      return [
        `${variant.protagonist}先看到时间戳。凌晨三点十七分，${variant.setting}留下了两份互相冲突的记录。`,
        `第一份指向${clue}。第二份指向${secretTrace}。`,
        `她没有立刻联系任何人，只把两份记录各复制一份，分开放进不同设备。`,
        `${variant.antagonist}赶到时，她已经列出三个问题：谁能进入现场，谁改过记录，谁最怕${conflictTrace}。`,
        `${variant.ally}问她怕不怕。她说：“怕没有用，先对时间。”`,
      ];
    case "emotion":
      return [
        `我听见门锁响的时候，手心全是汗。${variant.setting}明明只有我一个人，屏幕上却弹出${clue}。`,
        `我不想点开。真的。可${variant.antagonist}的名字就在旁边，像一根针扎进眼睛里。`,
        `下一秒，${secretTrace}出现了。我的胃猛地往下坠，连呼吸都变得很疼。`,
        `${variant.ally}发来消息：别信任何人。`,
        `我盯着那行字，忽然明白自己不是被卷进去的，我是被选中的。`,
      ];
    case "conflict":
      return [
        `“删掉。”${variant.antagonist}冲进来，第一句话就要${variant.protagonist}关掉${clue}。`,
        `“凭什么？”她反手锁屏，又把备份发出去。`,
        `${variant.ally}拦在门口：“你再往前一步，我报警。”`,
        `${variant.antagonist}冷笑：“你们知道自己碰了什么吗？”`,
        `${variant.protagonist}把${conflictTrace}投到屏幕上：“现在知道了。你怕这个。”`,
      ];
    case "weird":
      return [
        `${variant.setting}的灯没有坏，却一盏接一盏暗下去。最后亮着的那块屏幕，正显示${variant.protagonist}的名字。`,
        `${clue}像自己长出来的，慢慢浮在页面中央。没有发送人，没有时间，只有一行很轻的提示。`,
        `别回头。`,
        `${variant.protagonist}还是回了头。门后没有人，只有${secretTrace}被摆得端端正正。`,
        `她听见有人贴着墙笑了一声。声音很近，也很像她自己。`,
      ];
  }
}

function pickVariantOpeningClue(variant: ShortStoryVariant): string {
  const clues = ["门禁截图", "旧照片", "录音尾声", "转账备注", "被改过的名单", "后台操作记录"];
  return clues[variant.runIndex % clues.length]!;
}

function pickVariantOpeningSecretTrace(variant: ShortStoryVariant): string {
  const traces = [
    `${variant.keyRelation}留下的编号`,
    `${variant.antagonist}避开的时间戳`,
    `${variant.ally}不肯解释的旧照片`,
    `${variant.setting}里被擦掉的签名`,
    "那页缺失的名单",
    "一份提前生成的证明",
  ];
  return traces[variant.runIndex % traces.length]!;
}

function pickVariantOpeningConflictTrace(variant: ShortStoryVariant): string {
  const traces = [
    "两份互相冲突的时间线",
    "同一个账号的异常登录",
    "一笔不该出现的转账",
    "被剪掉的三分钟监控",
    "签名顺序的破绽",
    "现场记录里的空白页",
  ];
  return traces[variant.runIndex % traces.length]!;
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
  readonly planMarkdown?: string;
  readonly titlesMarkdown?: string;
}): ShortStoryPublishPackage {
  const bookTitle = parseFirstShortStoryTitle(options.titlesMarkdown) ?? `《${options.theme}》`;
  const chapterTitles = createChapterTitleMap(options.theme, options.planMarkdown);
  const chapters = options.chapters
    .slice()
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((chapter) => formatShortStoryPublishChapter(chapter, chapterTitles.get(chapter.chapterNumber)));
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

export function formatShortStoryPublishChapter(
  input: ShortStoryPublishChapterInput,
  chapterTitle?: string,
): ShortStoryPublishChapter {
  const normalized = input.content.replace(/\r\n/g, "\n").trim();
  const shortTitle = chapterTitle ?? deriveChapterTitleFromText(normalized, input.chapterNumber);
  const title = `第${input.chapterNumber}章 ${shortTitle}`;
  const body = stripMarkdownTitle(normalized);
  const paragraphs = formatMobileFriendlyParagraphs(body);
  const content = `# ${title}\n\n${paragraphs.join("\n\n")}\n`;

  return {
    chapterNumber: input.chapterNumber,
    fileName: `${String(input.chapterNumber).padStart(3, "0")}_${sanitizePublishFileName(shortTitle)}.md`,
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

interface ShortStoryPlanBeat {
  readonly chapterNumber: number;
  readonly summary: string;
  readonly conflict: string;
  readonly endingHook: string;
}

function createChapterTitleMap(theme: string, planMarkdown: string | undefined): Map<number, string> {
  const titles = new Map<number, string>();
  if (!planMarkdown) return titles;

  const used = new Set<string>();
  for (const beat of parseShortStoryPlanBeats(planMarkdown)) {
    const title = uniquifyChapterTitle(
      normalizeChapterTitle(deriveChapterTitleFromPlanBeat(theme, beat), beat.chapterNumber),
      used,
      beat.chapterNumber,
    );
    titles.set(beat.chapterNumber, title);
  }
  return titles;
}

function parseShortStoryPlanBeats(planMarkdown: string): ShortStoryPlanBeat[] {
  const chapterMatches = [...planMarkdown.matchAll(/^## \[(\d+)\]\s+.+$/gm)];
  return chapterMatches
    .map((match, index): ShortStoryPlanBeat | undefined => {
      const blockStart = match.index ?? 0;
      const nextMatch = chapterMatches[index + 1];
      const blockEnd = nextMatch?.index ?? planMarkdown.length;
      const block = planMarkdown.slice(blockStart, blockEnd);
      const chapterNumber = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isInteger(chapterNumber)) return undefined;

      return {
        chapterNumber,
        summary: extractPlanField(block, "summary"),
        conflict: extractPlanField(block, "conflict"),
        endingHook: extractPlanField(block, "endingHook"),
      };
    })
    .filter((beat): beat is ShortStoryPlanBeat =>
      Boolean(beat && (beat.summary || beat.conflict || beat.endingHook))
    );
}

function extractPlanField(block: string, fieldName: "summary" | "conflict" | "endingHook"): string {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`^- ${escaped}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

function deriveChapterTitleFromPlanBeat(theme: string, beat: ShortStoryPlanBeat): string {
  const strategy = resolveShortStoryPlanStrategy(theme);
  const text = `${beat.summary} ${beat.conflict} ${beat.endingHook}`;
  const primaryText = beat.summary || beat.conflict || beat.endingHook || text;

  if (strategy.id === "thriller") {
    return deriveThrillerChapterTitle(primaryText, beat.chapterNumber);
  }
  if (strategy.id === "betrayal-revenge") {
    return deriveBetrayalRevengeChapterTitle(primaryText, beat.chapterNumber);
  }
  return compactPlotTitle(text, beat.chapterNumber);
}

function deriveChapterTitleFromText(markdown: string, chapterNumber: number): string {
  return normalizeChapterTitle(compactPlotTitle(stripMarkdownTitle(markdown), chapterNumber), chapterNumber);
}

function deriveThrillerChapterTitle(text: string, chapterNumber: number): string {
  const candidates: ReadonlyArray<[RegExp, string]> = [
    [/电话|来电|手机/, "凌晨电话来自死人"],
    [/袖扣/, "认尸男人戴旧袖扣"],
    [/十三楼|第十三|数字：?十三|数字十三/, "十三楼旧秘密浮出"],
    [/录音笔|录音|墙缝/, "墙缝录音藏着哭声"],
    [/疗养院|病历|病例/, "旧病历写着她名"],
    [/地下车库|黑车/, "车库黑车堵出口"],
    [/火化申请单|火化单|火化记录/, "火化单上签着凶名"],
    [/死亡证明/, "死亡证明当场伪造"],
    [/负二层|地下实验|实验室/, "负二层灯又亮了"],
    [/监控/, "监控里多了个人"],
    [/女尸.*睁眼|睁眼/, "女尸突然睁开眼"],
    [/冷柜/, "三号冷柜半夜响起"],
    [/账本|数据/, "黑账本撕开真相"],
    [/抓捕|被捕/, "抓捕现场灯突然灭"],
    [/安葬|母亲墓|天亮/, "天亮后真相落地"],
  ];
  return matchTitleCandidate(text, candidates) ?? compactPlotTitle(text, chapterNumber);
}

function deriveBetrayalRevengeChapterTitle(text: string, chapterNumber: number): string {
  const candidates: ReadonlyArray<[RegExp, string]> = [
    [/十周年|宴会|酒店监控|视频/, "十周年宴上放视频"],
    [/净身|协议|律师/, "净身协议藏杀招"],
    [/闺蜜|苏蔓|录音/, "闺蜜亲口露底"],
    [/亲子鉴定|鉴定报告/, "鉴定报告掀全场"],
    [/换婴|护士长|旧档案/, "旧档案揭开换婴"],
    [/机场|护照|硬盘/, "机场拦下逃亡丈夫"],
    [/股东|董事|罢免/, "股东大会当场反杀"],
    [/判刑|判决|法庭/, "法庭判决终于落锤"],
    [/冻结|银行卡|财产/, "银行卡一夜冻结"],
    [/直播|全网|社死/, "直播曝光全网炸"],
  ];
  return matchTitleCandidate(text, candidates) ?? compactPlotTitle(text, chapterNumber);
}

function matchTitleCandidate(
  text: string,
  candidates: ReadonlyArray<[RegExp, string]>,
): string | undefined {
  return candidates.find(([pattern]) => pattern.test(text))?.[1];
}

function compactPlotTitle(text: string, chapterNumber: number): string {
  const sentence = text
    .replace(/\r?\n/g, "。")
    .split(/[。！？!?；;，,]/)
    .map((part) => part.trim())
    .find((part) => /[\u4e00-\u9fff]/.test(part));
  if (!sentence) return `第${chapterNumber}章真相浮出`;

  return sentence
    .replace(/^(summary|conflict|endingHook)[:：]/i, "")
    .replace(/^(深夜|第二天|三个月后|下一秒|结婚十周年宴会上)/, "")
    .replace(/^(林晚|顾沉|苏蔓|许念|许晴|叶澈|周砚)(带着|发现|查到|追到|继续|赶到|站在|约|把|在)?/, "")
    .replace(/^(当众|突然|连夜|故意|假装|主动|继续)/, "")
    .trim();
}

function normalizeChapterTitle(title: string, chapterNumber: number): string {
  const compact = title
    .replace(/《|》|“|”|‘|’/g, "")
    .replace(/^#?\s*第\s*\d+\s*章\s*/u, "")
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .replace(/[，。！？；、,.!?;：:]+/g, "")
    .trim();
  const base = compact && !/^第\d+章?$/.test(compact) ? compact : `第${chapterNumber}章真相浮出`;
  return fitChapterTitleLength(base);
}

function fitChapterTitleLength(title: string): string {
  if (title.length >= 8 && title.length <= 16) return title;
  if (title.length > 16) return title.slice(0, 16);

  const suffixes = ["真相浮出", "反转炸开", "杀局逼近", "证据现身"];
  for (const suffix of suffixes) {
    const candidate = `${title}${suffix}`;
    if (candidate.length >= 8) {
      return candidate.length > 16 ? candidate.slice(0, 16) : candidate;
    }
  }
  return title.padEnd(8, "局");
}

function uniquifyChapterTitle(title: string, used: Set<string>, chapterNumber: number): string {
  if (!used.has(title)) {
    used.add(title);
    return title;
  }

  const suffixes = ["反转", "真相", "杀局", "落锤"];
  for (const suffix of suffixes) {
    const candidate = fitChapterTitleLength(`${title.slice(0, Math.max(1, 16 - suffix.length))}${suffix}`);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  const fallback = fitChapterTitleLength(`${title.slice(0, 14)}${chapterNumber}`);
  used.add(fallback);
  return fallback;
}

function sanitizePublishFileName(title: string): string {
  return title
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .trim() || "未命名章节";
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
