import type {
  ShortStoryBaseWorld,
  ShortStoryChapterFunction,
  ShortStoryChapterPlan,
  ShortStoryDerivedWorld,
  ShortStoryDraftChapter,
  ShortStoryHookMode,
  ShortStoryParsedPlan,
  ShortStoryVariant,
  ShortStoryWritingMode,
} from "./schema.js";
import { resolveShortStoryWriteStrategy, type ShortStoryCast, type ShortStorySceneDraft } from "./strategies/index.js";
import { createVariant } from "./variant.js";

const MIN_DRAFT_WORDS = 1_200;
const MAX_DRAFT_WORDS = 1_800;

export function parseShortStoryPlanMarkdown(markdown: string): ShortStoryParsedPlan {
  const theme = matchRequired(markdown, /^# Short story plan:\s*(.+)$/m, "theme").trim();
  const targetWords = parsePlanNumber(matchRequired(markdown, /^- Target:\s*(\d+)\s+words$/m, "target words"), "target words");
  const chapterTargetWords = parsePlanNumber(
    matchRequired(markdown, /^- Chapter target:\s*(\d+)\s+words$/m, "chapter target words"),
    "chapter target words",
  );
  const variant = parsePlanVariant(markdown);
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
    variant,
    chapters,
  };
}

export function generateShortStoryDraftChapters(
  plan: ShortStoryParsedPlan,
): ReadonlyArray<ShortStoryDraftChapter> {
  let drafts = plan.chapters.map((chapter, index) => {
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
  if (plan.variant) {
    drafts = diversifyDraftRepeatedPatterns(drafts, plan.variant);
  }
  const report = checkShortStoryWriterOutput({
    chapters: drafts.map((draft) => draft.content),
    variant: plan.variant,
  });
  const errors = report.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Short-story writer check failed: ${errors.map((issue) => issue.message).join("; ")}`);
  }
  return drafts;
}

function diversifyDraftRepeatedPatterns(
  drafts: ReadonlyArray<ShortStoryDraftChapter>,
  variant: ShortStoryVariant,
): ShortStoryDraftChapter[] {
  let current = [...drafts];
  for (let pass = 0; pass < 8; pass += 1) {
    const report = checkShortStoryWriterOutput({
      chapters: current.map((draft) => draft.content),
      variant,
    });
    const patterns = report.issues
      .filter((issue) => issue.code === "repeated_sentence_pattern" && issue.pattern)
      .map((issue) => issue.pattern!);
    if (patterns.length === 0) break;
    current = rewriteRepeatedSentencePatterns(current, variant, patterns);
  }
  return current;
}

function rewriteRepeatedSentencePatterns(
  drafts: ReadonlyArray<ShortStoryDraftChapter>,
  variant: ShortStoryVariant,
  patterns: ReadonlyArray<string>,
): ShortStoryDraftChapter[] {
  const seen = new Map<string, number>();
  return drafts.map((draft, draftIndex) => {
    const content = draft.content
      .split("\n")
      .map((line) => {
        if (line.startsWith("#") || line.trim().length === 0) return line;
        return line.replace(/[^。！？!?]+[。！？!?]?/gu, (sentence) => {
          const normalized = normalizeSentencePattern(sentence.trim());
          const matched = patterns.find((pattern) => normalized.startsWith(pattern));
          if (!matched) return sentence;
          const count = seen.get(matched) ?? 0;
          seen.set(matched, count + 1);
          if (count < 2) return sentence;
          return `${sentenceVariationLead(variant, draftIndex, count)}${sentence.trim()}`;
        });
      })
      .join("\n");
    return {
      ...draft,
      content,
      wordCount: countCjkDraftWords(content),
    };
  });
}

function sentenceVariationLead(variant: ShortStoryVariant, chapterIndex: number, count: number): string {
  const leads = [
    "她换了个角度看，",
    "隔了几秒，",
    "屏幕暗下去前，",
    "对方刚移开视线，",
    "她把这句话压低，",
    "门外脚步声一顿，",
    "那阵寒意还没散，",
    "她忽然停笔，",
    `${variant.setting}深处传来轻响，`,
    `${variant.protagonist}把呼吸放慢，`,
  ];
  return leads[(variantSeed(variant, chapterIndex + count + 31) + count) % leads.length]!;
}

export function generateShortStoryDraftChapter(
  plan: ShortStoryParsedPlan,
  chapter: ShortStoryChapterPlan,
  previous?: ShortStoryChapterPlan,
  next?: ShortStoryChapterPlan,
): string {
  const target = clamp(chapter.targetWords, MIN_DRAFT_WORDS, MAX_DRAFT_WORDS);
  const strategy = resolveShortStoryWriteStrategy(plan.theme);
  const cast = strategy.resolveCast(plan.theme, plan.variant);
  const title = `# ${chapter.title}`;
  const paragraphs = buildSceneParagraphs(plan, chapter, previous, next, cast);
  const expanded = [...paragraphs];
  let round = 0;

  const minimumTarget = Math.min(MAX_DRAFT_WORDS, Math.max(MIN_DRAFT_WORDS, target - 150));
  while (
    countCjkDraftWords(renderDraftEstimate(title, expanded)) < minimumTarget
    && round < 12
  ) {
    const expansion = plan.variant
      ? buildVariantSceneExpansion(chapter, cast, plan.variant, round)
      : buildSceneExpansion(strategy, chapter, cast, round);
    expanded.splice(Math.max(1, expanded.length - 2), 0, ...expansion);
    round += 1;
  }

  let content = renderDraftContent(title, expanded, chapter.chapterNumber, cast, plan.variant);
  while (countCjkDraftWords(content) > MAX_DRAFT_WORDS && expanded.length > 10) {
    const removeIndex = Math.max(1, expanded.length - 3);
    const candidate = expanded.filter((_, index) => index !== removeIndex);
    const candidateContent = renderDraftContent(title, candidate, chapter.chapterNumber, cast, plan.variant);
    if (countCjkDraftWords(candidateContent) < MIN_DRAFT_WORDS) {
      break;
    }
    expanded.splice(removeIndex, 1);
    content = candidateContent;
  }
  let padIndex = 0;
  while (countCjkDraftWords(content) < MIN_DRAFT_WORDS && padIndex < 6) {
    expanded.splice(
      Math.max(1, expanded.length - 2),
      0,
      plan.variant
        ? buildVariantMinimumPad(chapter, cast, plan.variant, padIndex)
        : buildMinimumPad(chapter, cast, padIndex),
    );
    content = renderDraftContent(title, expanded, chapter.chapterNumber, cast, plan.variant);
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
  if (plan.variant) {
    return buildVariantSceneParagraphs(plan.variant, chapter, previous, next, cast);
  }
  const scene = resolveShortStoryWriteStrategy(plan.theme).createScene(chapter, cast);
  const opening = previous ? scene.continuation(previous.endingHook) : chapter.summary;
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

function buildVariantSceneParagraphs(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  previous: ShortStoryChapterPlan | undefined,
  next: ShortStoryChapterPlan | undefined,
  cast: ShortStoryCast,
): string[] {
  const blueprint = createVariantChapterBlueprint(variant, chapter, previous, next, cast);
  return applyWritingModeToParagraphs(variant, chapter, cast, [
    blueprint.opening,
    blueprint.sceneAnchor,
    ...blueprint.actionBeats,
    blueprint.reversal,
    blueprint.cost,
    blueprint.close,
  ]);
}

function applyWritingModeToParagraphs(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
  paragraphs: ReadonlyArray<string>,
): string[] {
  switch (variant.writingMode) {
    case "logic":
      return applyLogicMode(variant, chapter, paragraphs);
    case "emotion":
      return applyEmotionMode(variant, chapter, paragraphs);
    case "conflict":
      return applyConflictMode(variant, chapter, cast, paragraphs);
    case "weird":
      return applyWeirdMode(variant, chapter, paragraphs);
  }
}

function applyLogicMode(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  paragraphs: ReadonlyArray<string>,
): string[] {
  const result = paragraphs.map((paragraph) => paragraph
    .replace(/疼是真的，痛快也是真的。?/gu, "")
    .replace(/她差点失控，可下一秒，/gu, "")
    .replace(/胸口像被人攥住。/gu, "")
    .replace(/短促地笑了一声。/gu, "")
  );
  result.splice(1, 0, `${variant.protagonist}先列三项：时间、入口、受益人。情绪暂时不算证据。`);
  if (chapter.function !== "resolution") {
    result.splice(Math.max(2, result.length - 2), 0, `她把${rewriteCoreConflict(variant, chapter.chapterNumber)}单独圈出。能互相验证的，才进入下一步。`);
  }
  return result.map((paragraph) => splitLogicParagraph(paragraph)).filter(Boolean);
}

function splitLogicParagraph(paragraph: string): string {
  const sentences = paragraph.split(/(?<=[。！？!?])/u).map((item) => item.trim()).filter(Boolean);
  if (sentences.length <= 2) return paragraph.trim();
  return sentences.slice(0, 3).join("\n");
}

function applyEmotionMode(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  paragraphs: ReadonlyArray<string>,
): string[] {
  const result = [...paragraphs];
  result.splice(1, 0, `我以为自己早就不会疼了。可${variant.antagonist}的每一次沉默，都像把旧伤重新按开。`);
  result.splice(Math.max(2, result.length - 2), 0, `我不想再替任何人找理由。害怕是真的，愤怒也是真的，可我更怕自己这一次又心软。`);
  if (chapter.function === "climax" || chapter.function === "twist") {
    result.splice(Math.max(3, Math.floor(result.length / 2)), 0, `那一秒，我甚至想过停下。下一秒，我听见自己说：不行，已经走到这里了。`);
  }
  return result.map((paragraph) => paragraph.replace(/她/gu, (match, offset) => offset === 0 ? "我" : match));
}

function applyConflictMode(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
  paragraphs: ReadonlyArray<string>,
): string[] {
  const result = [...paragraphs];
  result.splice(1, 0, `“把东西交出来。”${variant.antagonist}挡住路。\n\n“你先解释${rewriteCoreConflict(variant, chapter.chapterNumber)}。”${variant.protagonist}一步没退。`);
  result.splice(Math.max(3, Math.floor(result.length / 2)), 0, `“你信他，还是信证据？”${cast.rival}声音发紧。\n\n${variant.protagonist}抬眼：“我信会害怕的人。现在害怕的是他。”`);
  if (chapter.function !== "resolution") {
    result.splice(Math.max(4, result.length - 1), 0, `“最后一次机会。”${variant.antagonist}压低声音。\n\n“错。”${variant.protagonist}切开备份页，“是你最后一次撒谎。”`);
  }
  return result;
}

function applyWeirdMode(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  paragraphs: ReadonlyArray<string>,
): string[] {
  const result = paragraphs.map((paragraph) => paragraph
    .replace(/终于明白/gu, "隐约觉得")
    .replace(/证据/gu, "痕迹")
    .replace(/答案/gu, "回声")
  );
  result.splice(1, 0, `${variant.setting}的声音低了一层。不是安静，是所有东西都像隔着水。`);
  result.splice(Math.max(2, Math.floor(result.length / 2)), 0, `墙面没有动，影子却慢慢偏过去。${variant.protagonist}看着那道偏移，忽然不确定刚才听见的是不是自己的呼吸。`);
  if (chapter.function !== "resolution") {
    result.splice(Math.max(3, result.length - 2), 0, `没有人解释${rewriteWorldSecret(variant, chapter.chapterNumber)}。它只是停在那里，像一只睁着的眼。`);
  }
  return result;
}

interface VariantChapterBlueprint {
  readonly opening: string;
  readonly sceneAnchor: string;
  readonly actionBeats: ReadonlyArray<string>;
  readonly reversal: string;
  readonly cost: string;
  readonly close: string;
}

type VariantAction =
  | "潜入"
  | "对话套话"
  | "被监视"
  | "错误判断"
  | "误导线索"
  | "角色冲突"
  | "情绪崩溃"
  | "反向利用敌人"
  | "信息反转";

function createVariantChapterBlueprint(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  previous: ShortStoryChapterPlan | undefined,
  next: ShortStoryChapterPlan | undefined,
  cast: ShortStoryCast,
): VariantChapterBlueprint {
  const seed = variantSeed(variant, chapter.chapterNumber);
  const scene = resolveVariantSceneType(chapter, variant);
  const clue = resolveVariantClue(chapter, variant);
  const secretTrace = rewriteWorldSecret(variant, chapter.chapterNumber);
  const conflictTrace = rewriteCoreConflict(variant, chapter.chapterNumber);
  const actions = pickVariantActions(variant, chapter);
  const opening = buildVariantOpening({
    variant,
    chapter,
    previous,
    scene,
    clue,
    secretTrace,
    seed,
  });
  const sceneAnchor = buildSceneAnchor(variant, chapter, scene, clue, seed);
  const actionBeats = actions.map((action, index) =>
    renderVariantAction(action, {
      variant,
      chapter,
      cast,
      scene,
      clue,
      secretTrace,
      conflictTrace,
      index,
      seed,
    })
  );
  const reversal = renderVariantReversal(variant, chapter, scene, secretTrace, seed);
  const cost = renderVariantCost(variant, chapter, conflictTrace, seed);
  const close = renderVariantClose(variant, chapter, next, clue, secretTrace, seed);

  return {
    opening,
    sceneAnchor,
    actionBeats,
    reversal,
    cost,
    close,
  };
}

function buildVariantOpening(input: {
  readonly variant: ShortStoryVariant;
  readonly chapter: ShortStoryChapterPlan;
  readonly previous?: ShortStoryChapterPlan;
  readonly scene: string;
  readonly clue: string;
  readonly secretTrace: string;
  readonly seed: number;
}): string {
  const { variant, chapter, previous, scene, clue, secretTrace, seed } = input;
  if (previous) {
    const continuations = [
      `${previous.endingHook.replace(/[。！？!?]$/u, "")}之后，${variant.protagonist}没有回到原路。她换掉手机卡，先去${scene}确认${clue}是真是假。`,
      `${variant.protagonist}把上一章留下的疑点写在便利贴背面，第三条被她重重圈住：${clue}。天亮前，她已经站在${scene}外。`,
      `上一晚的警告还在耳边，${variant.protagonist}却故意反着走。她让${variant.ally}留在明处，自己绕进${scene}的侧门。`,
      `${variant.antagonist}以为她会先解释，${variant.protagonist}偏不。她把所有通话静音，只带走一份备份和一个最坏的猜测。`,
    ];
    return continuations[seed % continuations.length]!;
  }

  const openings = [
    `门锁响第三下时，${variant.protagonist}已经把摄像头转向走廊。屏幕里多出来的不是陌生人，而是一段提前写好的${clue}。`,
    `“别开门。”${variant.ally}的消息刚弹出，${variant.setting}里就传来第二个人的呼吸声。${variant.protagonist}握紧手机，没回头。`,
    `${variant.protagonist}原本只是想确认一件小事。可${variant.setting}的灯突然全灭，亮起时，桌上多了${secretTrace}。`,
    `第一声异响来自${variant.setting}深处。${variant.protagonist}俯身去看，地面灰尘被划开一道新痕，正好停在她脚边。`,
    `手机没有响，录音软件却自己开始计时。${variant.protagonist}听见自己的名字从空白音轨里冒出来，尾音贴着${variant.setting}的回声。`,
  ];
  if (chapter.function === "hook") {
    return openings[seed % openings.length]!;
  }
  return `${variant.protagonist}重新进入${scene}时，没有再碰门把手。她先确认出口，再把${clue}压进袖口。`;
}

function buildSceneAnchor(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  scene: string,
  clue: string,
  seed: number,
): string {
  const rhythms = [
    `${scene}不是上一次的样子。${variant.antagonist}留下的人撤得太干净，干净到像在等她自己钻进去。`,
    `${variant.protagonist}没有急着找人。她先数摄像头，再看地面痕迹，最后才把视线落到${clue}上。`,
    `${scene}里最异常的不是声音，而是安静。${variant.keyRelation}有关的那块区域，被人擦得没有一点生活痕迹。`,
    `${variant.ally}站在明处吸引视线，${variant.protagonist}从反光里观察${variant.antagonist}的反应。那张脸太稳，稳得反常。`,
  ];
  if (chapter.function === "resolution") {
    return `${scene}终于安静下来。${variant.protagonist}把所有备份按时间排好，没有急着庆祝，只先删掉别人替她写好的结局。`;
  }
  return rhythms[seed % rhythms.length]!;
}

function renderVariantAction(action: VariantAction, input: {
  readonly variant: ShortStoryVariant;
  readonly chapter: ShortStoryChapterPlan;
  readonly cast: ShortStoryCast;
  readonly scene: string;
  readonly clue: string;
  readonly secretTrace: string;
  readonly conflictTrace: string;
  readonly index: number;
  readonly seed: number;
}): string {
  const { variant, chapter, scene, clue, secretTrace, conflictTrace, index, seed } = input;
  const style = (seed + index + chapter.chapterNumber) % 3;
  switch (action) {
    case "潜入":
      return addVariantActionLead([
        `${variant.protagonist}没有从正门进。她借${variant.ally}制造的空档绕到侧边，把${clue}拍下来，又把原位恢复成没人碰过的样子。`,
        `${scene}的正门太安静，安静得像陷阱。${variant.protagonist}转去后门，只取走一张照片和一串编号。`,
        `${variant.ally}在外面拖住人时，${variant.protagonist}已经贴着墙根摸进去。她没碰原件，只让备份先离开现场。`,
      ][style]!, input);
    case "对话套话":
      return addVariantActionLead([
        `${variant.protagonist}故意把判断说错半句。${variant.antagonist}急着纠正，脱口而出的那个时间点，正好和${conflictTrace}对上。`,
        `${variant.protagonist}避开证据不谈，转而问起那天谁最后离开。${variant.antagonist}停顿太短，短到像提前背过答案。`,
        `${variant.protagonist}把话题绕到${variant.keyRelation}身上。${variant.antagonist}下意识否认，反而暴露他知道${conflictTrace}。`,
      ][style]!, input);
    case "被监视":
      return addVariantActionLead([
        `墙角的红点闪了一下。${variant.protagonist}立刻改口，把真正的问题藏进一句闲话里，让监听的人只听见她已经被带偏。`,
        `${variant.protagonist}看见玻璃里的反光动了动。她没有拆穿，只把手机扣在桌面上，换成另一套说法。`,
        `门缝外有人停了半秒。${variant.protagonist}把声音放轻，故意留下一个错误地点，等对方替她验证。`,
      ][style]!, input);
    case "错误判断":
      return addVariantActionLead([
        `${variant.protagonist}一开始以为${variant.keyRelation}是突破口，直到${variant.ally}拦住她。那份沉默太急，反倒证明她差点抓错了人。`,
        `${variant.keyRelation}的反应太像心虚，${variant.protagonist}差点顺着查下去。可${variant.ally}只问了一句：“谁最希望你这么想？”`,
        `${variant.protagonist}把怀疑压到${variant.keyRelation}身上时，${clue}忽然对不上。她停住，意识到自己正踩进别人铺好的路。`,
      ][style]!, input);
    case "误导线索":
      return addVariantActionLead([
        `${clue}看起来像答案，细看却是陷阱。编号故意露出一位错数，像有人催她把怀疑推到${variant.ally}身上。`,
        `${clue}太完整了，完整得不自然。${variant.protagonist}先查装订痕，再查页码，缺口偏偏藏在中间。`,
        `那条线索故意亮在最显眼的地方。${variant.protagonist}没有碰它，先去查谁有资格把它放在那里。`,
      ][style]!, input);
    case "角色冲突":
      return addVariantActionLead([
        `${variant.ally}压低声音劝她停半步，${variant.protagonist}却把证据推回去：“你要我冷静，可以。先告诉我你漏掉了哪一段。”`,
        `${variant.ally}伸手拦她，${variant.protagonist}直接甩开：“别替我选安全路。你瞒过我的，今晚一次说完。”`,
        `${variant.protagonist}第一次对${variant.ally}发火。不是因为不信他，而是他每一次沉默，都让${variant.antagonist}多赢一秒。`,
      ][style]!, input);
    case "情绪崩溃":
      return addVariantActionLead([
        `${secretTrace}被摊开的那一刻，${variant.protagonist}指尖发麻。她差点失控，可下一秒，她把眼泪咽回去，先按下录音保存。`,
        `${variant.protagonist}盯着${secretTrace}，胸口像被人攥住。她没有哭出声，只把证据拍得更清楚。`,
        `${secretTrace}让她短暂站不稳。${variant.antagonist}以为她要崩，她却先把文件名改成了当天日期。`,
      ][style]!, input);
    case "反向利用敌人":
      return addVariantActionLead([
        `${variant.protagonist}把一份假备份故意留给${variant.antagonist}。对方急着销毁时，真正的上传进度已经悄悄跳到最后一格。`,
        `${variant.protagonist}看着${variant.antagonist}拿走那张存储卡，连眼神都没变。卡里只有诱饵，原件早被她拆成三份发出。`,
        `${variant.antagonist}终于动手，她反而松了口气。诱饵被咬住，下一步就能顺着操作记录查到源头。`,
      ][style]!, input);
    case "信息反转":
      return addVariantActionLead([
        `${chapter.function === "resolution" ? "最后" : "就在她准备收手时"}，${variant.protagonist}发现${clue}根本不是物证，而是一把钥匙。钥匙背后连着的，是被刻意拆散的几段交易。`,
        `${variant.protagonist}重新看${clue}时，顺序彻底变了。所谓结果其实是入口，真正的证据还在下一层。`,
        `${clue}没有解释过去，反而推翻了她刚得到的答案。${variant.protagonist}终于明白，这章最危险的不是秘密，是有人在教她误判。`,
      ][style]!, input);
  }
}

function addVariantActionLead(
  sentence: string,
  input: {
    readonly variant: ShortStoryVariant;
    readonly chapter: ShortStoryChapterPlan;
    readonly scene: string;
    readonly clue: string;
    readonly secretTrace: string;
    readonly conflictTrace: string;
    readonly index: number;
    readonly seed: number;
  },
): string {
  const { variant, chapter, scene, clue, secretTrace, conflictTrace, index, seed } = input;
  const leads = [
    `${scene}的灯影压下来，`,
    `${clue}边缘发凉，`,
    `${variant.protagonist}听见远处有人关门，`,
    `${variant.keyRelation}的名字还停在屏幕上，`,
    `${conflictTrace}像一根刺，`,
    `${secretTrace}卡在眼前，`,
    `通话记录跳出新提醒，`,
    `走廊尽头传来短促杂音，`,
    `${variant.ally}的消息停在未读栏，`,
    `${variant.antagonist}留下的空白太干净，`,
    `她把手机反扣前，`,
    `${chapter.function === "climax" ? "公开前" : "那一秒"}，`,
  ];
  return `${leads[(seed + index * 5 + chapter.chapterNumber + variant.runIndex) % leads.length]!}${sentence}`;
}

function renderVariantReversal(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  scene: string,
  secretTrace: string,
  seed: number,
): string {
  const reversals = [
    `${variant.antagonist}越镇定，${variant.protagonist}越确定自己找错了表面答案。真正的破口不是威胁，而是他刻意避开的${secretTrace}。`,
    `证据没有立刻指向${variant.antagonist}。它先绕了一圈，落到${variant.keyRelation}身上。${variant.protagonist}这才明白，有人早把她的愤怒算进局里。`,
    `${scene}的时间线突然倒过来。先发生的事被放到最后，最后出现的人却最早留下痕迹。${variant.protagonist}背后慢慢发冷。`,
    `${variant.ally}终于承认自己隐瞒过一段。${variant.protagonist}没有原谅，也没有翻脸，只让他说完，因为那段隐瞒刚好能咬住${variant.antagonist}。`,
  ];
  if (chapter.function === "climax") {
    return `${variant.protagonist}把证据公开前，先删掉了最煽情的那段。她不需要哭给任何人看，只要让${variant.antagonist}亲口认出${secretTrace}。`;
  }
  return reversals[seed % reversals.length]!;
}

function renderVariantCost(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  conflictTrace: string,
  seed: number,
): string {
  const costs = [
    `${variant.protagonist}付出的不是一场争吵，而是继续相信任何人的能力。她听见自己声音发抖，却还是把${conflictTrace}念完。`,
    `${variant.keyRelation}被卷进来后，事情再也不是单纯查证。${variant.protagonist}必须承认，她每往前一步，都会有人被迫站队。`,
    `${variant.antagonist}开始动用人情和规则压她。${variant.protagonist}第一次清楚地意识到，自己要赢，先得失去那点侥幸。`,
    `最难受的不是害怕，而是她曾经差点相信那个错误解释。${variant.protagonist}低头笑了一下，笑得很短，也很冷。`,
  ];
  if (chapter.function === "resolution") {
    return `${variant.protagonist}没有把所有伤口拿出来展示。她只留下能定责的部分，把剩下的沉默还给自己。`;
  }
  return costs[seed % costs.length]!;
}

function renderVariantClose(
  variant: ShortStoryVariant,
  chapter: ShortStoryChapterPlan,
  next: ShortStoryChapterPlan | undefined,
  clue: string,
  secretTrace: string,
  seed: number,
): string {
  if (!next || chapter.function === "resolution") {
    const endings = [
      `${variant.protagonist}把最后一份材料封好。门外天色发亮，她没有回头，只把${secretTrace}留给该负责的人。`,
      `${variant.ending}之后，${variant.protagonist}第一次关掉所有提醒。安静落下来，她才知道自己真的走出来了。`,
      `${variant.protagonist}离开${variant.setting}时，把钥匙放在桌上。那不是逃，是她终于不再被困在别人设计的故事里。`,
    ];
    return endings[seed % endings.length]!;
  }
  const hooks = [
    `${variant.protagonist}刚把${clue}收好，屏幕上弹出新的地址。那地方不在计划里，却和下一章要查的人完全重合。`,
    `她以为这一轮已经结束，直到${variant.ally}发来一张模糊照片。照片角落里，${secretTrace}被人提前圈了出来。`,
    `${variant.antagonist}没有再威胁她，只发来一句话：你查到的，正是我想让你看见的。`,
    `${variant.protagonist}关灯前看见备份文件多出一份副本，创建时间竟然早于她发现${clue}之前。`,
  ];
  return hooks[seed % hooks.length]!;
}

function pickVariantActions(variant: ShortStoryVariant, chapter: ShortStoryChapterPlan): ReadonlyArray<VariantAction> {
  const pool: ReadonlyArray<VariantAction> = [
    "潜入",
    "对话套话",
    "被监视",
    "错误判断",
    "误导线索",
    "角色冲突",
    "情绪崩溃",
    "反向利用敌人",
    "信息反转",
  ];
  const start = variantSeed(variant, chapter.chapterNumber) % pool.length;
  const count = chapter.function === "hook" ? 4 : chapter.function === "resolution" ? 3 : 5;
  const actions: VariantAction[] = [];
  for (let offset = 0; actions.length < count; offset += 2) {
    const action = pool[(start + offset + chapter.chapterNumber) % pool.length]!;
    if (!actions.includes(action)) actions.push(action);
  }
  if (chapter.function === "twist" && !actions.includes("信息反转")) {
    actions[actions.length - 1] = "信息反转";
  }
  if (chapter.function === "escalation" && !actions.includes("误导线索")) {
    actions[actions.length - 1] = "误导线索";
  }
  if (chapter.function === "climax" && !actions.includes("反向利用敌人")) {
    actions[actions.length - 1] = "反向利用敌人";
  }
  return actions;
}

function rewriteWorldSecret(variant: ShortStoryVariant, chapterNumber: number): string {
  const tokens = [
    `${variant.keyRelation}留下的编号`,
    `${variant.setting}里被擦掉的签名`,
    `${variant.ally}迟迟不肯解释的那张旧照片`,
    `${variant.antagonist}避开不看的时间戳`,
    `夹在旧资料里的半页名单`,
    `被改过三次的收件记录`,
  ];
  return tokens[(variantSeed(variant, chapterNumber) + chapterNumber) % tokens.length]!;
}

function rewriteCoreConflict(variant: ShortStoryVariant, chapterNumber: number): string {
  const traces = [
    "两份时间线互相咬死",
    "同一个账号在两个地点同时出现",
    "签名顺序和现场痕迹完全相反",
    "被删除的三分钟刚好接上关键证词",
    "看似无关的两笔记录落在同一天",
    "所有人都避开的那个空白页",
  ];
  return traces[(variantSeed(variant, chapterNumber) + variant.runIndex) % traces.length]!;
}

function variantSeed(variant: ShortStoryVariant, chapterNumber: number): number {
  return Math.abs(hashText(`${variant.seed}:${variant.theme}:${variant.runIndex}:${chapterNumber}:${variant.baseWorld.protagonist}`));
}

function parsePlanVariant(markdown: string): ShortStoryVariant | undefined {
  const blockMatch = markdown.match(/(?:^|\n)## Variant\n\n([\s\S]*?)(?=\n## \[|$)/);
  const block = blockMatch?.[1];
  if (!block) return undefined;

  if (block.includes("baseWorld.")) {
    const baseWorld: ShortStoryBaseWorld = {
      protagonist: matchRequired(block, /^- baseWorld\.protagonist:[ \t]*(.+)$/m, "variant baseWorld.protagonist").trim(),
      role: matchRequired(block, /^- baseWorld\.role:[ \t]*(.+)$/m, "variant baseWorld.role").trim(),
      setting: matchRequired(block, /^- baseWorld\.setting:[ \t]*(.+)$/m, "variant baseWorld.setting").trim(),
      coreConflict: matchRequired(
        block,
        /^- baseWorld\.coreConflict:[ \t]*(.+)$/m,
        "variant baseWorld.coreConflict",
      ).trim(),
      supportingCharacters: splitPlanList(matchRequired(
        block,
        /^- baseWorld\.supportingCharacters:[ \t]*(.+)$/m,
        "variant baseWorld.supportingCharacters",
      )),
      hiddenTruth: matchOptional(block, /^- baseWorld\.hiddenTruth:[ \t]*(.*)$/m)?.trim() || undefined,
      secret: matchOptional(block, /^- baseWorld\.secret:[ \t]*(.*)$/m)?.trim() || undefined,
    };
    const derived: ShortStoryDerivedWorld = {
      mainThreat: matchRequired(block, /^- derived\.mainThreat:[ \t]*(.+)$/m, "variant derived.mainThreat").trim(),
      twistDirection: matchRequired(
        block,
        /^- derived\.twistDirection:[ \t]*(.+)$/m,
        "variant derived.twistDirection",
      ).trim(),
      premise: matchRequired(block, /^- derived\.premise:[ \t]*(.+)$/m, "variant derived.premise").trim(),
      antagonist: matchRequired(block, /^- derived\.antagonist:[ \t]*(.+)$/m, "variant derived.antagonist").trim(),
      ally: matchRequired(block, /^- derived\.ally:[ \t]*(.+)$/m, "variant derived.ally").trim(),
      keyRelation: matchRequired(block, /^- derived\.keyRelation:[ \t]*(.+)$/m, "variant derived.keyRelation").trim(),
      openingIncident: matchRequired(
        block,
        /^- derived\.openingIncident:[ \t]*(.+)$/m,
        "variant derived.openingIncident",
      ).trim(),
      coreSecret: matchRequired(block, /^- derived\.coreSecret:[ \t]*(.+)$/m, "variant derived.coreSecret").trim(),
      ending: matchRequired(block, /^- derived\.ending:[ \t]*(.+)$/m, "variant derived.ending").trim(),
      forbiddenElements: splitPlanList(matchRequired(
        block,
        /^- derived\.forbiddenElements:[ \t]*(.+)$/m,
        "variant derived.forbiddenElements",
      )),
    };
    return createVariant({
      theme: matchRequired(block, /^- theme:[ \t]*(.+)$/m, "variant theme").trim(),
      runIndex: parsePlanNumber(matchRequired(block, /^- runIndex:[ \t]*(\d+)$/m, "variant runIndex"), "variant runIndex"),
      seed: matchRequired(block, /^- seed:[ \t]*(.+)$/m, "variant seed").trim(),
      writingMode: parseWritingMode(matchOptional(block, /^- writingMode:[ \t]*(.+)$/m)?.trim()),
      hookMode: parseHookMode(matchOptional(block, /^- hookMode:[ \t]*(.+)$/m)?.trim()),
      baseWorld,
      derived,
    });
  }

  const protagonist = matchRequired(block, /^- protagonist:\s*(.+)$/m, "variant protagonist").trim();
  const setting = matchRequired(block, /^- setting:\s*(.+)$/m, "variant setting").trim();
  const coreConflict = matchRequired(block, /^- coreConflict:\s*(.+)$/m, "variant coreConflict").trim();
  return createVariant({
    theme: matchOptional(block, /^- theme:\s*(.+)$/m)?.trim() ?? "short-story",
    runIndex: parsePlanNumber(matchRequired(block, /^- runIndex:\s*(\d+)$/m, "variant runIndex"), "variant runIndex"),
    seed: matchRequired(block, /^- seed:\s*(.+)$/m, "variant seed").trim(),
    writingMode: parseWritingMode(matchOptional(block, /^- writingMode:\s*(.+)$/m)?.trim()),
    hookMode: parseHookMode(matchOptional(block, /^- hookMode:\s*(.+)$/m)?.trim()),
    baseWorld: {
      protagonist,
      role: "主角",
      setting,
      coreConflict,
      supportingCharacters: splitPlanList(matchRequired(
        block,
        /^- supportingCharacters:\s*(.+)$/m,
        "variant supportingCharacters",
      )),
      hiddenTruth: matchRequired(block, /^- coreMystery:\s*(.+)$/m, "variant coreMystery").trim(),
      secret: matchRequired(block, /^- coreSecret:\s*(.+)$/m, "variant coreSecret").trim(),
    },
    derived: {
      mainThreat: matchRequired(block, /^- coreSecret:\s*(.+)$/m, "variant coreSecret").trim(),
      twistDirection: matchRequired(block, /^- twist:\s*(.+)$/m, "variant twist").trim(),
      premise: matchRequired(block, /^- premise:\s*(.+)$/m, "variant premise").trim(),
      antagonist: matchRequired(block, /^- antagonist:\s*(.+)$/m, "variant antagonist").trim(),
      ally: matchRequired(block, /^- ally:\s*(.+)$/m, "variant ally").trim(),
      keyRelation: matchRequired(block, /^- keyRelation:\s*(.+)$/m, "variant keyRelation").trim(),
      openingIncident: matchRequired(block, /^- openingIncident:\s*(.+)$/m, "variant openingIncident").trim(),
      coreSecret: matchRequired(block, /^- coreSecret:\s*(.+)$/m, "variant coreSecret").trim(),
      ending: matchRequired(block, /^- ending:\s*(.+)$/m, "variant ending").trim(),
      forbiddenElements: splitPlanList(matchRequired(
        block,
        /^- forbiddenElements:\s*(.+)$/m,
        "variant forbiddenElements",
      )),
    },
  });
}

function parseWritingMode(raw: string | undefined): ShortStoryWritingMode | undefined {
  if (!raw) return undefined;
  if (raw === "logic" || raw === "emotion" || raw === "conflict" || raw === "weird") return raw;
  throw new Error(`Invalid short-story plan: unknown writingMode ${raw}`);
}

function parseHookMode(raw: string | undefined): ShortStoryHookMode | undefined {
  if (!raw) return undefined;
  if (raw === "normal" || raw === "strong" || raw === "viral") return raw;
  throw new Error(`Invalid short-story plan: unknown hookMode ${raw}`);
}

function splitPlanList(raw: string): ReadonlyArray<string> {
  return raw.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
}

function renderDraftContent(
  title: string,
  paragraphs: ReadonlyArray<string>,
  chapterNumber: number,
  cast: ShortStoryCast,
  variant?: ShortStoryVariant,
): string {
  const paragraphsWithBeats = intensifySatisfactionBeats(dedupeParagraphs(paragraphs), chapterNumber, cast);
  const safeParagraphs = variant
    ? paragraphsWithBeats.map((paragraph) => sanitizeVariantParagraph(paragraph, variant))
    : paragraphsWithBeats;
  const content = `${title}\n\n${safeParagraphs.join("\n\n")}\n`;
  if (variant) {
    assertVariantContent(content, variant);
  }
  return content;
}

function renderDraftEstimate(title: string, paragraphs: ReadonlyArray<string>): string {
  return `${title}\n\n${dedupeParagraphs(paragraphs).join("\n\n")}\n`;
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
    [`${cast.hero}短促地笑了一声。`, "她把声音压低。", `${cast.hero}抬眼，尾音发冷。`],
    ["四周骤然安静。", "所有视线同时停住。", "那句话落下后，没人立刻接话。"],
    [`${cast.villain}的脸色彻底变了。`, `${cast.villain}终于失控。`, `${cast.villain}指节发白，冷脸裂开一道缝。`],
    ["这一次，没人再替他们说话。", "沉默像一记耳光甩在他们脸上。", "所有退路都在这一秒塌下去。"],
  ];
  const closers = [
    ["她把证据往前推了一寸。", "她再也不把主动权交出去。", "这一步，她站得很稳。"],
    ["疼是真的，痛快也是真的。", "她疼得发抖，却没有低头。", "痛意还在，快意已经压过来。"],
    ["这一巴掌，终于打回去了。", "欠她的，终于开始还了。", "那口堵了十年的气，狠狠吐了出去。"],
    ["旧账到这里，彻底翻篇。", "这场账，她亲手收尾。", "门关上的一刻，她没有再回头。"],
  ];
  const variant = Math.max(0, chapterNumber - 1) % 3;
  const opener = openers[beatIndex]?.[variant] ?? openers[0]![variant]!;
  const closer = closers[beatIndex]?.[variant] ?? closers[0]![variant]!;
  return `${opener}${paragraph}${closer}`;
}

const LEGACY_CHARACTER_NAMES = [
  "许念",
  "许晴",
  "周砚",
  "叶澈",
  "林晚",
  "顾沉",
  "苏蔓",
  "顾念",
  "程雨",
  "陆铭",
  "秦野",
  "宋眠",
  "蒋赫",
  "贺舟",
  "叶知夏",
  "韩砚",
  "沈照",
  "沈棠",
  "傅景川",
  "乔安",
  "陆知行",
  "姜梨",
  "贺云深",
  "白薇",
  "周序",
];

function sanitizeVariantParagraph(paragraph: string, variant: ShortStoryVariant): string {
  const allowed = createAllowedVariantText(variant);
  let result = paragraph;

  for (const name of LEGACY_CHARACTER_NAMES) {
    if (!allowed.includes(name)) {
      result = replaceAllLiteral(result, name, replacementForLegacyName(name, variant));
    }
  }

  for (const element of variant.forbiddenElements) {
    if (!element || allowed.includes(element)) continue;
    result = replaceAllLiteral(result, element, replacementForForbiddenElement(element, variant));
  }

  return result;
}

function assertVariantContent(content: string, variant: ShortStoryVariant): void {
  const allowed = createAllowedVariantText(variant);
  const leakedNames = LEGACY_CHARACTER_NAMES.filter((name) => !allowed.includes(name) && content.includes(name));
  const leakedElements = variant.forbiddenElements.filter((element) =>
    element.length > 0 && !allowed.includes(element) && content.includes(element)
  );
  const leakedStateKeys = ["baseWorld", "derived", "coreMystery", "coreSecret", "coreConflict"].filter((key) =>
    content.includes(key)
  );
  const leaks = [...new Set([...leakedNames, ...leakedElements, ...leakedStateKeys])];
  if (leaks.length > 0) {
    const firstLeak = leaks[0] ?? "";
    const leakIndex = firstLeak ? content.indexOf(firstLeak) : -1;
    const snippet = leakIndex >= 0 ? content.slice(Math.max(0, leakIndex - 30), leakIndex + firstLeak.length + 30) : "";
    throw new Error(`Short-story variant violation: leaked ${leaks.join(", ")} in run ${variant.seed}${snippet ? ` near "${snippet}"` : ""}`);
  }
}

function createAllowedVariantText(variant: ShortStoryVariant): string {
  return [
    variant.protagonist,
    variant.antagonist,
    variant.ally,
    variant.keyRelation,
    variant.setting,
    variant.coreMystery,
    variant.coreConflict,
    variant.openingIncident,
    variant.coreSecret,
    variant.twist,
    variant.ending,
    ...variant.supportingCharacters,
  ].join("\n");
}

function replacementForLegacyName(name: string, variant: ShortStoryVariant): string {
  if (["顾沉", "周砚", "陆铭", "蒋赫", "韩砚", "傅景川", "贺云深"].includes(name)) {
    return variant.antagonist;
  }
  if (["苏蔓", "顾念", "许晴", "乔安", "白薇"].includes(name)) {
    return variant.keyRelation;
  }
  if (["叶澈", "秦野", "贺舟", "沈照", "陆知行", "周序"].includes(name)) {
    return variant.ally;
  }
  return variant.protagonist;
}

function replacementForForbiddenElement(element: string, variant: ShortStoryVariant): string {
  if (LEGACY_CHARACTER_NAMES.includes(element)) {
    return replacementForLegacyName(element, variant);
  }
  if (/医院|停尸间|太平间|冷柜|冷库|殡仪馆|出租屋|墙内|楼|会所|机场|法庭|股东|宴会/u.test(element)) {
    return variant.setting;
  }
  if (/尸体|病历|火化|主任|死亡证明|冷藏/u.test(element)) {
    return `${variant.coreMystery}的证据`;
  }
  return variant.coreMystery;
}

function replaceAllLiteral(text: string, search: string, replacement: string): string {
  return text.split(search).join(replacement);
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

function buildVariantSceneExpansion(
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
  variant: ShortStoryVariant,
  round: number,
): string[] {
  const sceneType = resolveVariantSceneType(chapter, variant);
  const clue = resolveVariantClue(chapter, variant);
  const secretTrace = rewriteWorldSecret(variant, chapter.chapterNumber + round);
  const conflictTrace = rewriteCoreConflict(variant, chapter.chapterNumber + round);
  const actions = pickVariantActions(variant, chapter);
  const action = actions[round % actions.length] ?? "信息反转";
  const seed = variantSeed(variant, chapter.chapterNumber + round);
  return [
    renderVariantAction(action, {
      variant,
      chapter,
      cast,
      scene: sceneType,
      clue,
      secretTrace,
      conflictTrace,
      index: round,
      seed,
    }),
    buildVariantConsequenceBeat({
      variant,
      chapter,
      cast,
      scene: sceneType,
      clue,
      secretTrace,
      conflictTrace,
      round,
      seed,
    }),
  ];
}

function buildVariantConsequenceBeat(input: {
  readonly variant: ShortStoryVariant;
  readonly chapter: ShortStoryChapterPlan;
  readonly cast: ShortStoryCast;
  readonly scene: string;
  readonly clue: string;
  readonly secretTrace: string;
  readonly conflictTrace: string;
  readonly round: number;
  readonly seed: number;
}): string {
  const { variant, chapter, cast, scene, clue, secretTrace, conflictTrace, round, seed } = input;
  const beats = [
    `${cast.villain}把声音压得很低，像在替她考虑退路。${cast.hero}却听见了另一层意思：他已经知道${clue}被动过。`,
    `${secretTrace}沾在一段不起眼的边角上。${cast.hero}没拿最显眼的证据，只把那点边角折进掌心。`,
    `${cast.rival}话到嘴边突然刹住。${cast.hero}没催，只记住那一瞬的迟疑，等它和${conflictTrace}对齐。`,
    `${scene}外传来脚步声。${cast.hero}先关掉录音界面，再把屏幕切到无关页面，像是真的被吓退了。`,
    `${cast.villain}丢出一个解释，漂亮、完整、没有破绽。${cast.hero}反而松了口气，太完整的故事通常不是现场长出来的。`,
    `${cast.hero}把怒火压到一句话里：“你急着让我信这个，是因为还有别的东西不能见光。”`,
    `${cast.rival}递来的消息只有八个字。${cast.hero}看完后没有回复，她先删掉定位，再把${clue}换了保存名。`,
    `${conflictTrace}让所有人的站位变得清楚。谁往后退，谁就知道真正的入口在哪里。`,
    `${secretTrace}不是答案，只是一道门缝。${cast.hero}顺着缝隙往里看，最先跳出来的名字让她喉咙发紧。`,
    `${chapter.function === "climax" ? "公开前一秒" : "转身前"}，${cast.hero}故意留下一处破绽。她要看${cast.villain}会先补哪一块。`,
    `${scene}里的灯闪了一下。${cast.hero}盯着桌面没动，备份却已经从另一台设备悄悄发出。`,
    `${cast.hero}终于明白，对方不是要藏住全部真相，而是要她只相信其中一半。`,
  ];
  return beats[(seed + round * 3 + variant.runIndex) % beats.length]!;
}

function resolveVariantSceneType(chapter: ShortStoryChapterPlan, variant: ShortStoryVariant): string {
  if (chapter.function === "hook") return variant.setting;
  if (chapter.function === "resolution") return `${variant.setting}的收尾现场`;
  if (chapter.function === "climax") return `${variant.antagonist}公开露面的现场`;
  if (chapter.function === "twist") return `${variant.coreMystery}的关键现场`;
  return `${variant.setting}的取证现场`;
}

function resolveVariantClue(chapter: ShortStoryChapterPlan, variant: ShortStoryVariant): string {
  const clues = [
    "监控片段",
    "匿名录音",
    "门禁记录",
    "旧照片",
    `${variant.coreMystery}的证据`,
    `${variant.keyRelation}留下的线索`,
  ];
  return clues[(chapter.chapterNumber + variant.runIndex) % clues.length]!;
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

function buildVariantMinimumPad(
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
  variant: ShortStoryVariant,
  index: number,
): string {
  const clue = resolveVariantClue(chapter, variant);
  const secretTrace = rewriteWorldSecret(variant, chapter.chapterNumber + index + 17);
  const details = [
    `${cast.hero}重新检查${clue}，把情绪拆成三件事：谁撒谎，谁受益，谁急着让她停下。`,
    `${cast.villain}越想把局面拖成解释，${cast.hero}越不接话。她只问事实，不给对方表演委屈的余地。`,
    `${secretTrace}压在眼前，像一根细针。${cast.hero}疼得清醒，也终于知道下一步该刺向哪里。`,
    `${cast.rival}的迟疑让她看见缺口。那不是宽恕的理由，是继续追下去的路线。`,
    `${chapter.function === "resolution" ? "尘埃落定前" : "下一轮逼近前"}，${cast.hero}先把自己从旧判断里拽出来。她不能再替任何人圆谎。`,
    `${variant.setting}安静得过分。${cast.hero}听着自己的心跳，忽然意识到害怕也可以变成判断力。`,
  ];
  return details[(variantSeed(variant, chapter.chapterNumber + index) + index) % details.length]!;
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

export interface ShortStoryWriterCheckIssue {
  readonly severity: "warning" | "error";
  readonly code:
    | "run_similarity_too_high"
    | "repeated_sentence_pattern"
    | "state_variable_leak";
  readonly message: string;
  readonly similarity?: number;
  readonly pattern?: string;
}

export interface ShortStoryWriterCheckReport {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<ShortStoryWriterCheckIssue>;
}

export function checkShortStoryWriterOutput(input: {
  readonly chapters: ReadonlyArray<string>;
  readonly variant?: ShortStoryVariant;
  readonly previousFirstChapter?: string;
}): ShortStoryWriterCheckReport {
  const issues: ShortStoryWriterCheckIssue[] = [];
  const fullText = input.chapters.join("\n");
  const leakedStateKeys = ["baseWorld", "derived", "baseWorld.", "derived."].filter((key) => fullText.includes(key));
  for (const key of leakedStateKeys) {
    issues.push({
      severity: "error",
      code: "state_variable_leak",
      message: `正文泄漏内部变量名：${key}`,
      pattern: key,
    });
  }

  const repeatedPatterns = findRepeatedSentencePatterns(fullText);
  for (const pattern of repeatedPatterns) {
    issues.push({
      severity: "warning",
      code: "repeated_sentence_pattern",
      message: `重复句型超过阈值：${pattern}`,
      pattern,
    });
  }

  if (input.previousFirstChapter && input.chapters[0]) {
    const similarity = estimateTextSimilarity(input.previousFirstChapter, input.chapters[0]);
    if (similarity > 0.4) {
      issues.push({
        severity: "warning",
        code: "run_similarity_too_high",
        message: `相邻 run 第一章相似度过高：${similarity.toFixed(2)}`,
        similarity,
      });
    }
  }

  return {
    passed: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

function findRepeatedSentencePatterns(text: string): string[] {
  const counts = new Map<string, number>();
  const sentences = text
    .replace(/^#.+$/gm, "")
    .split(/[。！？!?]\s*/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);

  for (const sentence of sentences) {
    const pattern = normalizeSentencePattern(sentence);
    if (pattern.length < 6) continue;
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 3)
    .map(([pattern]) => pattern)
    .slice(0, 20);
}

function normalizeSentencePattern(sentence: string): string {
  return sentence
    .replace(/[“”"']/g, "")
    .replace(/[A-Za-z0-9]+/g, "N")
    .replace(/[\u4e00-\u9fff]{2,4}/g, (word) =>
      /宋眠|叶知夏|程雨|林晚|沈棠|姜梨|顾沉|苏蔓|许念|周砚|叶澈|房东|邻居|律师|记者|主管|调查员|女儿/u.test(word)
        ? "X"
        : word
    )
    .replace(/第[一二三四五六七八九十\d]+/g, "第N")
    .replace(/\s+/g, "")
    .slice(0, 28);
}

function estimateTextSimilarity(left: string, right: string): number {
  const leftSet = createNgramSet(left);
  const rightSet = createNgramSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) intersection += 1;
  }
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function createNgramSet(text: string): Set<string> {
  const normalized = text.replace(/^#.+$/gm, "").replace(/\s+/g, "");
  const set = new Set<string>();
  for (let index = 0; index <= normalized.length - 6; index += 3) {
    set.add(normalized.slice(index, index + 6));
  }
  return set;
}

function hashText(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash;
}

function matchRequired(text: string, pattern: RegExp, label: string): string {
  const match = text.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Invalid short-story plan: missing ${label}`);
  }
  return match[1];
}

function matchOptional(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
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
