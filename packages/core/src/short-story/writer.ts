import type {
  ShortStoryChapterFunction,
  ShortStoryChapterPlan,
  ShortStoryDraftChapter,
  ShortStoryParsedPlan,
} from "./schema.js";
import { resolveShortStoryWriteStrategy, type ShortStoryCast, type ShortStorySceneDraft } from "./strategies/index.js";

const MIN_DRAFT_WORDS = 1_200;
const MAX_DRAFT_WORDS = 1_800;

export function parseShortStoryPlanMarkdown(markdown: string): ShortStoryParsedPlan {
  const theme = matchRequired(markdown, /^# Short story plan:\s*(.+)$/m, "theme").trim();
  const targetWords = parsePlanNumber(matchRequired(markdown, /^- Target:\s*(\d+)\s+words$/m, "target words"), "target words");
  const chapterTargetWords = parsePlanNumber(
    matchRequired(markdown, /^- Chapter target:\s*(\d+)\s+words$/m, "chapter target words"),
    "chapter target words",
  );
  const chapters: ShortStoryChapterPlan[] = [];
  const chapterPattern = /^## \[(\d+)\]\s+([a-z_]+)\s+-\s+(.+)$/gm;
  const matches = [...markdown.matchAll(chapterPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const chapterNumber = parsePlanNumber(match[1]!, "chapter number");
    const chapterFunction = parseChapterFunction(match[2]!);
    const targetWordsForChapter = parsePlanNumber(
      matchRequired(block, /^- targetWords:\s*(\d+)$/m, `chapter ${chapterNumber} targetWords`),
      `chapter ${chapterNumber} targetWords`,
    );

    chapters.push({
      chapterNumber,
      title: `第${chapterNumber}章`,
      targetWords: targetWordsForChapter,
      function: chapterFunction,
      summary: matchRequired(block, /^- summary:\s*(.+)$/m, `chapter ${chapterNumber} summary`).trim(),
      conflict: matchRequired(block, /^- conflict:\s*(.+)$/m, `chapter ${chapterNumber} conflict`).trim(),
      endingHook: matchRequired(block, /^- endingHook:\s*(.+)$/m, `chapter ${chapterNumber} endingHook`).trim(),
      role: chapterFunction === "hook"
        ? "opening"
        : chapterFunction === "resolution"
          ? "ending"
          : chapterFunction === "climax"
            ? "climax"
            : "development",
      endingHookRequired: chapterFunction !== "resolution",
    });
  }

  if (chapters.length === 0) {
    throw new Error("No short-story chapters found in plan");
  }

  return {
    theme,
    targetWords,
    chapterTargetWords,
    chapters,
  };
}

export function generateShortStoryDraftChapters(
  plan: ShortStoryParsedPlan,
): ReadonlyArray<ShortStoryDraftChapter> {
  return plan.chapters.map((chapter, index) => {
    const previous = index > 0 ? plan.chapters[index - 1] : undefined;
    const next = index < plan.chapters.length - 1 ? plan.chapters[index + 1] : undefined;
    const content = generateShortStoryDraftChapter(plan, chapter, previous, next);
    return {
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content,
      wordCount: countCjkDraftWords(content),
    };
  });
}

export function generateShortStoryDraftChapter(
  plan: ShortStoryParsedPlan,
  chapter: ShortStoryChapterPlan,
  previous?: ShortStoryChapterPlan,
  next?: ShortStoryChapterPlan,
): string {
  const target = clamp(chapter.targetWords, MIN_DRAFT_WORDS, MAX_DRAFT_WORDS);
  const strategy = resolveShortStoryWriteStrategy(plan.theme);
  const cast = strategy.resolveCast(plan.theme);
  const title = `# ${chapter.title}`;
  const paragraphs = buildSceneParagraphs(plan, chapter, previous, next, cast);
  const expanded = [...paragraphs];
  let round = 0;

  const minimumTarget = Math.min(MAX_DRAFT_WORDS, target + 80);
  while (countCjkDraftWords(renderDraftContent(title, expanded, chapter.chapterNumber, cast)) < minimumTarget && round < 12) {
    expanded.splice(Math.max(1, expanded.length - 2), 0, ...buildSceneExpansion(strategy, chapter, cast, round));
    round += 1;
  }

  let content = renderDraftContent(title, expanded, chapter.chapterNumber, cast);
  while (countCjkDraftWords(content) > MAX_DRAFT_WORDS && expanded.length > 10) {
    const removeIndex = Math.max(1, expanded.length - 3);
    const candidate = expanded.filter((_, index) => index !== removeIndex);
    const candidateContent = renderDraftContent(title, candidate, chapter.chapterNumber, cast);
    if (countCjkDraftWords(candidateContent) < MIN_DRAFT_WORDS) {
      break;
    }
    expanded.splice(removeIndex, 1);
    content = candidateContent;
  }
  let padIndex = 0;
  while (countCjkDraftWords(content) < MIN_DRAFT_WORDS && padIndex < 6) {
    expanded.splice(Math.max(1, expanded.length - 2), 0, buildMinimumPad(chapter, cast, padIndex));
    content = renderDraftContent(title, expanded, chapter.chapterNumber, cast);
    padIndex += 1;
  }
  return content;
}

export function countCjkDraftWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return cjk + latin;
}

function buildSceneParagraphs(
  plan: ShortStoryParsedPlan,
  chapter: ShortStoryChapterPlan,
  previous: ShortStoryChapterPlan | undefined,
  next: ShortStoryChapterPlan | undefined,
  cast: ShortStoryCast,
): string[] {
  const scene = resolveShortStoryWriteStrategy(plan.theme).createScene(chapter, cast);
  const opening = previous ? scene.continuation(previous.endingHook) : scene.opening;
  const nextPressure = next ? scene.nextBridge(next.summary) : scene.finalBridge;
  return [
    opening,
    scene.establishing,
    chapter.summary,
    scene.evidence,
    scene.risk,
    scene.cost,
    chapter.conflict,
    ...scene.dialogueBeats,
    ...scene.actionBeats,
    nextPressure,
    chapter.endingHook,
  ];
}

function renderDraftContent(
  title: string,
  paragraphs: ReadonlyArray<string>,
  chapterNumber: number,
  cast: ShortStoryCast,
): string {
  return `${title}\n\n${intensifySatisfactionBeats(dedupeParagraphs(paragraphs), chapterNumber, cast).join("\n\n")}\n`;
}

function intensifySatisfactionBeats(
  paragraphs: ReadonlyArray<string>,
  chapterNumber: number,
  cast: ShortStoryCast,
): string[] {
  const result = [...paragraphs];
  const paragraphCount = result.length;
  if (paragraphCount === 0) return result;

  const desiredCount = 4;
  const slots = [
    Math.floor(paragraphCount * 0.18),
    Math.floor(paragraphCount * 0.42),
    Math.floor(paragraphCount * 0.66),
    Math.floor(paragraphCount * 0.86),
  ];
  const used = new Set<number>();

  for (let i = 0; i < desiredCount; i += 1) {
    let slot = clamp(slots[i] ?? i, 0, paragraphCount - 1);
    while (used.has(slot) && slot < paragraphCount - 1) slot += 1;
    while (used.has(slot) && slot > 0) slot -= 1;
    used.add(slot);
    result[slot] = intensifyBeatParagraph(result[slot] ?? "", i, chapterNumber, cast);
  }

  return result;
}

function intensifyBeatParagraph(
  paragraph: string,
  beatIndex: number,
  chapterNumber: number,
  cast: ShortStoryCast,
): string {
  const openers = [
    [`${cast.hero}冷笑。`, "她忽然笑了。", `${cast.hero}抬眼，声音冷得发硬。`],
    ["空气猛地炸开。", "四周一下死寂。", "那句话砸下去，所有人都僵住。"],
    [`${cast.villain}的脸色彻底变了。`, `${cast.villain}终于失控。`, `${cast.villain}指节发白，冷脸裂开一道缝。`],
    ["这一次，没人再替他们说话。", "沉默像一记耳光甩在他们脸上。", "所有退路都在这一秒塌下去。"],
  ];
  const closers = [
    ["她不退了。", "她再也不让。", "这一步，她站得很稳。"],
    ["疼是真的，痛快也是真的。", "她疼得发抖，却没有低头。", "痛意还在，快意已经压过来。"],
    ["这一巴掌，终于打回去了。", "欠她的，终于开始还了。", "那口堵了十年的气，狠狠吐了出去。"],
    ["旧账到这里，彻底翻篇。", "这场账，她亲手收尾。", "门关上的一刻，她没有再回头。"],
  ];
  const variant = Math.max(0, chapterNumber - 1) % 3;
  const opener = openers[beatIndex]?.[variant] ?? openers[0]![variant]!;
  const closer = closers[beatIndex]?.[variant] ?? closers[0]![variant]!;
  return `${opener}${paragraph}${closer}`;
}

function buildSceneExpansion(
  strategy: ReturnType<typeof resolveShortStoryWriteStrategy>,
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
  round: number,
): string[] {
  const scene = strategy.createScene(chapter, cast);
  return [...(scene.expansions[round] ?? buildFallbackExpansion(chapter, cast, scene, round))];
}

function buildFallbackExpansion(
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
  scene: ShortStorySceneDraft,
  round: number,
): string[] {
  const groups: ReadonlyArray<ReadonlyArray<string>> = [
    [
      `${scene.sceneType}里的声音忽然低下去，旁人的目光像一圈细针扎在${cast.hero}身上。她把证据重新核对一遍，确认时间、地点、金额都能和眼前的人对上。`,
      `${scene.sceneType}这一刻，${cast.villain}越是冷脸，越说明他在计算退路。${cast.hero}没有抢话，只等他把下一句谎言说完整。`,
    ],
    [
      `${scene.sceneType}里，${cast.rival}的反应比刚才慢了半拍。她不再急着哭，而是先看${cast.villain}的脸色，这个细节让${cast.hero}抓住了两人的分工。`,
      `${scene.sceneType}里摆出来的东西不只是纸面材料，更是两个人互相推诿时露出的裂缝。${cast.hero}把那道裂缝记住，准备继续撬开。`,
    ],
    [
      `${chapter.function === "resolution" ? "回到现实后，" : `推进到${scene.sceneType}这一步，`}${cast.hero}付出的代价已经不只是愤怒。她失去体面，失去安稳，也失去继续自欺的余地。`,
      `可她在${scene.sceneType}换来的主动权越来越清楚：每多一份证据，${cast.villain}能威胁她的东西就少一件。`,
    ],
    [
      `${scene.sceneType}短暂僵住时，${cast.hero}低头看了一眼手机。备份文件已经同步完成，她紧绷的肩线终于松开半寸。`,
      `她不是不怕。她只是比任何人都清楚，怕不能救${cast.child}，退也不能让${cast.villain}放手。`,
    ],
    [
      `${scene.sceneType}里，${cast.villain}试图把话题带回情分，语气冷淡又施舍。${cast.hero}听着，只觉得荒唐。`,
      `情分早在一次次欺骗里被耗干了。现在${scene.sceneType}剩下的，只有证据、风险和必须付出的代价。`,
    ],
  ];
  return [
    ...(groups[round % groups.length] ?? []),
    `${scene.sceneType}没有给${cast.hero}喘息的空隙。她把情绪压到最低，只留下最狠的一点清醒，继续把局面往前推。`,
  ];
}

function buildMinimumPad(
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
  index: number,
): string {
  const details = [
    `${cast.hero}把呼吸压稳，重新看向眼前的证据。她知道真正痛快的不是喊赢谁，而是让对方每退一步都踩进自己布好的坑。`,
    `${cast.villain}还想维持体面，${cast.rival}却已经先露出慌意。两个人不同的反应，让${cast.hero}确认这条线还能继续深挖。`,
    `${chapter.function === "resolution" ? "结局的平静来得很慢" : "局面继续向前逼近"}，每一份证据都带着代价，也把她从被动的位置往外推了一寸。`,
  ];
  return `${details[index % details.length] ?? details[0]!}她没有再回避这些伤口，而是把它们变成下一步行动的理由。`;
}

function dedupeParagraphs(paragraphs: ReadonlyArray<string>): string[] {
  const seenParagraphs = new Set<string>();
  const seenQuotes = new Set<string>();
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    const normalized = paragraph.trim();
    if (!normalized || seenParagraphs.has(normalized)) continue;
    const quotes = [...normalized.matchAll(/“([^”]+)”/g)].map((match) => match[1]);
    if (quotes.some((quote) => quote && seenQuotes.has(quote))) continue;
    seenParagraphs.add(normalized);
    for (const quote of quotes) {
      if (quote) seenQuotes.add(quote);
    }
    result.push(normalized);
  }
  return result;
}
function matchRequired(text: string, pattern: RegExp, label: string): string {
  const match = text.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Invalid short-story plan: missing ${label}`);
  }
  return match[1];
}

function parsePlanNumber(raw: string, label: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid short-story plan: ${label} must be positive`);
  }
  return value;
}

function parseChapterFunction(raw: string): ShortStoryChapterFunction {
  if (
    raw === "hook" ||
    raw === "escalation" ||
    raw === "twist" ||
    raw === "climax" ||
    raw === "resolution"
  ) {
    return raw;
  }
  throw new Error(`Invalid short-story plan: unknown chapter function ${raw}`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
