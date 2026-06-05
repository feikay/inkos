import type { ChapterGoal } from "../models/input-governance.js";

export interface ChapterTitleCandidate {
  readonly style: "crisis" | "payoff" | "suspense";
  readonly title: string;
}

export interface ChapterTitleEngineInput {
  readonly language: "zh" | "en";
  readonly chapterGoal?: ChapterGoal;
  readonly keyEvents?: ReadonlyArray<string>;
  readonly recentTitles?: ReadonlyArray<string>;
  readonly rawTitle?: string;
}

export interface TitleReplacementDecisionInput {
  readonly language: "zh" | "en";
  readonly currentTitle: string;
  readonly replacementTitle: string;
  readonly chapterGoal?: ChapterGoal;
  readonly recentTitles?: ReadonlyArray<string>;
}

export interface TitleAnchorPressure {
  readonly anchor: string;
  readonly count: number;
}

const ZH_STOP_WORDS = /^(先|再|还没|尚未|必须|需要|试图|开始|继续|赶在|暂时|仍在|正在|主角|他|她|他们|她们)/u;
const ZH_PLACEHOLDER = /(current focus|todo|tbd|placeholder|none|null|待补充|未定义|状态未同步|推进主线|推进剧情)/iu;
const ZH_TITLE_PATTERN_RULES: ReadonlyArray<{
  readonly id: string;
  readonly style: ChapterTitleCandidate["style"];
  readonly build: (ctx: ZhTitleContext) => string | undefined;
}> = [
  {
    id: "place-object",
    style: "suspense",
    build: (ctx) => ctx.placeSeed && ctx.payoffObject
      ? `${ctx.placeSeed}的${ctx.payoffObject}`
      : undefined,
  },
  {
    id: "crisis-close",
    style: "crisis",
    build: (ctx) => ctx.conflictFocus
      ? `${ctx.conflictFocus}逼近之时`
      : undefined,
  },
  {
    id: "direct-payoff",
    style: "payoff",
    build: (ctx) => ctx.payoffPhrase,
  },
  {
    id: "price",
    style: "suspense",
    build: (ctx) => ctx.payoffObject
      ? `${ctx.payoffObject}背后的代价`
      : undefined,
  },
  {
    id: "after-payoff",
    style: "payoff",
    build: (ctx) => ctx.payoffAction
      ? `${ctx.payoffAction}之后`
      : undefined,
  },
  {
    id: "crisis-deadlock",
    style: "crisis",
    build: (ctx) => ctx.placeSeed
      ? `${ctx.placeSeed}前的死局`
      : undefined,
  },
];

interface ZhTitleContext {
  readonly payoffPhrase?: string;
  readonly payoffObject?: string;
  readonly payoffAction?: string;
  readonly conflictFocus?: string;
  readonly placeSeed?: string;
}

export function buildChapterTitleCandidates(input: ChapterTitleEngineInput): ReadonlyArray<ChapterTitleCandidate> {
  return input.language === "en"
    ? buildEnglishTitleCandidates(input)
    : buildChineseTitleCandidates(input);
}

export function resolveChapterTitle(input: ChapterTitleEngineInput): string | undefined {
  const candidates = buildChapterTitleCandidates(input);
  const raw = sanitizeCandidateTitle(input.rawTitle, input.language);
  const recentTitles = input.recentTitles ?? [];
  const rankedCandidates = rankChapterTitleCandidates(candidates, input);
  const bestCandidate = rankedCandidates[0]?.title;

  if (raw && !isWeakTitle(raw, input.language, input.chapterGoal, recentTitles)) {
    if (!bestCandidate) {
      return raw;
    }
    return scoreTitle(raw, inferCandidateStyle(raw, input), input)
      >= scoreTitle(bestCandidate, inferCandidateStyle(bestCandidate, input), input)
      ? raw
      : bestCandidate;
  }
  return bestCandidate ?? raw;
}

export function scoreResolvedTitle(
  title: string,
  input: Omit<ChapterTitleEngineInput, "rawTitle">,
): number {
  const cleaned = sanitizeCandidateTitle(title, input.language);
  if (!cleaned) return Number.NEGATIVE_INFINITY;
  return scoreTitle(cleaned, inferCandidateStyle(cleaned, input), input);
}

export function hasInvalidTitleIntegrity(
  title: string,
  language: "zh" | "en",
): boolean {
  const cleaned = sanitizeCandidateTitle(title, language);
  if (!cleaned) return true;

  if (language === "en") {
    return cleaned.split(/\s+/u).filter(Boolean).length <= 1;
  }

  if (cleaned.length < 4) {
    return true;
  }

  if (/^[的并因而了会]/u.test(cleaned) || /[的并因而了]$/u.test(cleaned)) {
    return true;
  }

  if (/(并未因|的秘密会|索并未因|河尽头前)$/u.test(cleaned)) {
    return true;
  }

  if (cleaned.length <= 8 && /(并未|站暗|击败|探索并未|楚夜云岚站暗|楚夜云岚击败)$/u.test(cleaned)) {
    return true;
  }

  if (/^[\u4e00-\u9fff]{4,8}(并未|击败|站暗|探索)$/u.test(cleaned)) {
    return true;
  }

  if (isLikelyChineseTitleFragment(cleaned)) {
    return true;
  }

  return false;
}

export function isInvalidTitleReplacement(input: TitleReplacementDecisionInput): boolean {
  const current = sanitizeCandidateTitle(input.currentTitle, input.language);
  const replacement = sanitizeCandidateTitle(input.replacementTitle, input.language);
  if (!replacement) return true;
  if (!current) return false;
  if (isHardBannedWeakTitle(replacement, input.language, input.chapterGoal)) {
    return true;
  }

  const bannedAnchor = detectCollapsedTitleAnchor(replacement, input.recentTitles ?? [], input.language);
  if (bannedAnchor) {
    return true;
  }

  if (isWeakTitle(current, input.language, input.chapterGoal, input.recentTitles ?? [])) {
    return false;
  }

  const scoringInput = {
    language: input.language,
    chapterGoal: input.chapterGoal,
    recentTitles: input.recentTitles,
  };
  return scoreResolvedTitle(replacement, scoringInput) < scoreResolvedTitle(current, scoringInput);
}

function buildChineseTitleCandidates(input: ChapterTitleEngineInput): ReadonlyArray<ChapterTitleCandidate> {
  const recentTitles = normalizeRecentTitles(input.recentTitles);
  const seenPatterns = new Set(recentTitles.map((title) => detectTitlePattern(title, "zh")).filter(Boolean));
  const bannedAnchors = new Set(findCollapsedTitleAnchors(recentTitles, "zh").map((entry) => entry.anchor));
  const ctx = buildZhTitleContext(input.chapterGoal, input.keyEvents);
  const styleOrder = getZhStyleOrder(input.chapterGoal?.endingHookType);
  const rules = [...ZH_TITLE_PATTERN_RULES].sort((left, right) =>
    styleOrder.indexOf(left.style) - styleOrder.indexOf(right.style),
  );
  const candidates: ChapterTitleCandidate[] = [];
  const seenTitles = new Set<string>();

  for (const rule of rules) {
    if (seenPatterns.has(rule.id)) continue;
    const built = sanitizeCandidateTitle(rule.build(ctx), "zh");
    if (!built) continue;
    if (isWeakTitle(built, "zh", input.chapterGoal, recentTitles)) continue;
    if (hasBannedTitleAnchor(built, bannedAnchors, "zh")) continue;
    if (seenTitles.has(built)) continue;
    candidates.push({ style: rule.style, title: built });
    seenTitles.add(built);
    if (candidates.length >= 3) break;
  }

  if (candidates.length < 3) {
    for (const fallback of buildZhFallbackTitles(ctx, bannedAnchors)) {
      const built = sanitizeCandidateTitle(fallback, "zh");
      if (!built) continue;
      if (isWeakTitle(built, "zh", input.chapterGoal, recentTitles)) continue;
      if (hasBannedTitleAnchor(built, bannedAnchors, "zh")) continue;
      if (seenTitles.has(built)) continue;
      candidates.push({ style: "suspense", title: built });
      seenTitles.add(built);
      if (candidates.length >= 3) break;
    }
  }

  return rankChapterTitleCandidates(candidates, input);
}

function buildEnglishTitleCandidates(input: ChapterTitleEngineInput): ReadonlyArray<ChapterTitleCandidate> {
  const candidates: ChapterTitleCandidate[] = [];
  const recentTitles = normalizeRecentTitles(input.recentTitles);
  const rawSeeds = [
    input.chapterGoal?.payoffToDeliver,
    input.chapterGoal?.mainConflict,
    input.chapterGoal?.protagonistGoal,
    ...(input.keyEvents ?? []),
  ]
    .map((seed) => sanitizeCandidateTitle(seed, "en"))
    .filter((seed): seed is string => Boolean(seed));

  for (const seed of rawSeeds) {
    const normalized = seed
      .replace(/^[A-Z]/, (match) => match.toUpperCase())
      .replace(/[.?!]+$/g, "");
    if (isWeakTitle(normalized, "en", input.chapterGoal, recentTitles)) continue;
    candidates.push({ style: "suspense", title: normalized });
    if (candidates.length >= 3) break;
  }

  const fallbackTitles = [
    "The Price at the River Mouth",
    "A Narrow Escape with Teeth",
    "What the Marked Trail Reveals",
  ];
  for (const fallback of fallbackTitles) {
    if (candidates.some((candidate) => candidate.title === fallback)) continue;
    if (isWeakTitle(fallback, "en", input.chapterGoal, recentTitles)) continue;
    candidates.push({ style: "suspense", title: fallback });
    if (candidates.length >= 3) break;
  }

  return candidates;
}

function buildZhTitleContext(
  chapterGoal: ChapterGoal | undefined,
  keyEvents: ReadonlyArray<string> | undefined,
): ZhTitleContext {
  const payoffPhrase = buildZhPayoffPhrase(chapterGoal?.payoffToDeliver);
  const payoffObject = extractZhObjectPhrase(chapterGoal?.payoffToDeliver)
    ?? extractZhObjectPhrase(keyEvents?.[0]);
  const conflictFocus = extractZhConflictFocus(chapterGoal?.mainConflict)
    ?? extractZhConflictFocus(chapterGoal?.protagonistGoal);
  const placeSeed = extractZhPlaceSeed(keyEvents)
    ?? extractZhPlaceSeed([chapterGoal?.mainConflict, chapterGoal?.protagonistGoal].filter(Boolean) as string[]);
  const payoffAction = buildZhActionPhrase(chapterGoal?.payoffToDeliver);

  return {
    payoffPhrase,
    payoffObject,
    payoffAction,
    conflictFocus,
    placeSeed,
  };
}

function buildZhPayoffPhrase(text: string | undefined): string | undefined {
  const cleaned = sanitizeCandidateTitle(text, "zh");
  if (!cleaned) return undefined;
  if (cleaned.length >= 6 && cleaned.length <= 18) {
    return sanitizeCandidateTitle(compactZhTitlePhrase(cleaned), "zh");
  }

  const object = extractZhObjectPhrase(cleaned);
  if (object) {
    const withVerb = cleaned.match(/^(拿到|获得|找到|发现|揭开|掌握|压住|摆脱|逃离|冲出)(.{2,10})$/u);
    if (withVerb) {
      return sanitizeCandidateTitle(compactZhTitlePhrase(`${withVerb[1]}${withVerb[2]}`), "zh");
    }
    return sanitizeCandidateTitle(`拿到${object}`, "zh") ?? undefined;
  }

  return undefined;
}

function buildZhActionPhrase(text: string | undefined): string | undefined {
  const cleaned = sanitizeCandidateTitle(text, "zh");
  if (!cleaned) return undefined;
  const direct = cleaned.match(/^(拿到|获得|找到|发现|揭开|掌握|压住|摆脱|逃离|冲出)(.{2,10})$/u);
  if (direct) {
    return `${direct[1]}${direct[2]}`;
  }
  return undefined;
}

function buildZhFallbackTitles(
  ctx: ZhTitleContext,
  bannedAnchors: ReadonlySet<string>,
): ReadonlyArray<string> {
  const object = ctx.payoffObject ?? "转机";
  const conflict = ctx.conflictFocus ?? "危机";
  const place = ctx.placeSeed ?? "开局";
  const pool = [
    `${place}的${object}`,
    `${object}背后的代价`,
    `${conflict}下的${object}`,
    `${object}之后的反扑`,
    `${conflict}逼近之时`,
  ];
  return pool.filter((title) => !hasBannedTitleAnchor(title, bannedAnchors, "zh"));
}

function extractZhObjectPhrase(text: string | undefined): string | undefined {
  const cleaned = sanitizeCandidateTitle(text, "zh");
  if (!cleaned) return undefined;

  const verbMatch = cleaned.match(/(?:拿到|获得|找到|发现|揭开|掌握|压住|摆脱|逃离|冲出|破解)(.{2,10})$/u);
  if (verbMatch) {
    return compactZhObjectFragment(trimZhFragment(verbMatch[1]));
  }

  const phraseMatch = cleaned.match(/([\u4e00-\u9fff]{2,8}(?:果实|腰牌|残卷|卷轴|刻痕|古碑|真相|入口|线索|追兵|追杀|反噬|封锁|学费|货源|资金|合约|危机|契机|转机|秘密))/u);
  return phraseMatch ? compactZhObjectFragment(trimZhFragment(phraseMatch[1])) : undefined;
}

function extractZhConflictFocus(text: string | undefined): string | undefined {
  const cleaned = sanitizeCandidateTitle(text, "zh");
  if (!cleaned) return undefined;

  const focusPatterns = [
    /([\u4e00-\u9fff]{2,8}(?:追兵|追杀|杀机|威胁|反噬|封锁|兽潮|蚀骨兽))/u,
    /([\u4e00-\u9fff]{2,8}(?:代价|死局|围杀|包围))/u,
  ];
  for (const pattern of focusPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      return trimZhFragment(match[1]);
    }
  }

  const fragment = trimZhFragment(cleaned);
  return fragment.length >= 4 && fragment.length <= 8 ? fragment : undefined;
}

function extractZhPlaceSeed(events: ReadonlyArray<string | undefined> | undefined): string | undefined {
  if (!events) return undefined;
  const patterns = [
    /(暗河尽头|黑市入口|山门外|岩窟深处|裂谷尽头|山洞深处|洞口|营地|尸坑)/gu,
    /([\u4e00-\u9fff]{2,6}(?:尽头|入口|洞口|深处|教室|课堂|学校|市场|老街|街头|现场|商场|厂房|办公室))/gu,
  ];
  for (const event of events) {
    const cleaned = sanitizeCandidateTitle(event, "zh");
    if (!cleaned) continue;
    for (const pattern of patterns) {
      const matches = [...cleaned.matchAll(pattern)];
      const match = matches.at(-1);
      if (match?.[1] ?? match?.[0]) {
        return trimZhFragment((match[1] ?? match[0]) as string);
      }
    }
  }
  return undefined;
}

function sanitizeCandidateTitle(title: string | undefined, language: "zh" | "en"): string | undefined {
  if (!title) return undefined;
  const cleaned = title
    .replace(/^[-*#\s]+/u, "")
    .replace(/[|\\]+/gu, " ")
    .replace(/[。！？!?.]+$/u, "")
    .replace(/\s+/gu, language === "en" ? " " : "")
    .trim();

  if (!cleaned) return undefined;
  if (ZH_PLACEHOLDER.test(cleaned)) return undefined;
  return cleaned;
}

function rankChapterTitleCandidates(
  candidates: ReadonlyArray<ChapterTitleCandidate>,
  input: ChapterTitleEngineInput,
): ReadonlyArray<ChapterTitleCandidate> {
  return [...candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreTitle(candidate.title, candidate.style, input),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.candidate);
}

function scoreTitle(
  title: string,
  style: ChapterTitleCandidate["style"],
  input: ChapterTitleEngineInput,
): number {
  if (input.language === "en") {
    return scoreEnglishTitle(title, style);
  }
  return scoreChineseTitle(title, style, input.chapterGoal);
}

function scoreChineseTitle(
  title: string,
  style: ChapterTitleCandidate["style"],
  chapterGoal: ChapterGoal | undefined,
): number {
  let score = 0;

  if (style === "suspense" || /(代价|尽头|背后|真相|之后|谁|何处|为何)/u.test(title)) {
    score += 2;
  }
  if (style === "crisis" || /(逼近|死局|追兵|杀机|威胁|封锁|围杀|反噬)/u.test(title)) {
    score += 2;
  }
  if (style === "payoff" || /(拿到|掌握|突破|觉醒|反杀|吞下|得到|揭开|冲出)/u.test(title)) {
    score += 2;
  }
  if (title.length >= 6 && title.length <= 12) {
    score += 2;
  }
  if (/[和与]|以及/u.test(title)) {
    score -= 2;
  }
  if (looksLikeSummaryTitle(title, chapterGoal)) {
    score -= 2;
  }

  return score;
}

function scoreEnglishTitle(title: string, style: ChapterTitleCandidate["style"]): number {
  let score = 0;
  if (style === "suspense" || /\b(price|truth|what|behind|after)\b/i.test(title)) score += 2;
  if (style === "crisis" || /\b(deadlock|threat|chase|closing in)\b/i.test(title)) score += 2;
  if (style === "payoff" || /\b(seized|claimed|mastered|escape)\b/i.test(title)) score += 2;
  const words = title.split(/\s+/u).filter(Boolean).length;
  if (words >= 2 && words <= 4) score += 2;
  if (/\b(and|with|as well as)\b/i.test(title)) score -= 2;
  return score;
}

function looksLikeSummaryTitle(title: string, chapterGoal: ChapterGoal | undefined): boolean {
  if (title.length >= 13) {
    return true;
  }
  if (/[，。！？!?：:]/u.test(title)) {
    return true;
  }
  if (/(和|与|以及).{2,}/u.test(title)) {
    return true;
  }
  if (chapterGoal?.protagonistGoal && title === compactZhTitlePhrase(chapterGoal.protagonistGoal)) {
    return true;
  }
  return false;
}

function inferCandidateStyle(
  title: string,
  input: ChapterTitleEngineInput,
): ChapterTitleCandidate["style"] {
  if (input.language === "zh") {
    if (/(逼近|死局|追兵|杀机|威胁|封锁|围杀|反噬)/u.test(title)) return "crisis";
    if (/(拿到|掌握|突破|觉醒|反杀|吞下|得到|揭开|冲出)/u.test(title)) return "payoff";
    return "suspense";
  }

  if (/\b(deadlock|threat|chase)\b/i.test(title)) return "crisis";
  if (/\b(seized|claimed|mastered|escape)\b/i.test(title)) return "payoff";
  return "suspense";
}

function compactZhTitlePhrase(text: string): string {
  return compactZhObjectFragment(
    text.replace(/^[\u4e00-\u9fff]{0,4}(?:必须|试图|需要|赶在|暂时|继续)/u, "").trim(),
  );
}

function compactZhObjectFragment(text: string): string {
  const primary = text
    .split(/以及|和|与|、/u)
    .map((part) => part.trim())
    .filter(Boolean)[0] ?? text;

  return primary
    .replace(/^(一枚|一块|一卷|一颗|一个|一条)/u, "")
    .trim();
}

function isWeakTitle(
  title: string,
  language: "zh" | "en",
  chapterGoal: ChapterGoal | undefined,
  recentTitles: ReadonlyArray<string>,
): boolean {
  const normalized = title.trim();
  if (!normalized) return true;
  if (recentTitles.includes(normalized)) return true;
  if (detectCollapsedTitleAnchor(normalized, recentTitles, language)) return true;

  if (language === "en") {
    const words = normalized.split(/\s+/u).filter(Boolean);
    if (words.length <= 1) return true;
    if (words.length > 8) return true;
    return false;
  }

  if (normalized.length < 6 || normalized.length > 18) return true;
  if (/^[\u4e00-\u9fff]{1,4}$/u.test(normalized)) return true;
  if (chapterGoal?.activeCharacters.some((name) => normalized === name.trim())) return true;
  if (/[，,。！？!?]/u.test(normalized)) return false;
  if (!/[\u4e00-\u9fff]/u.test(normalized)) return true;
  return false;
}

function isHardBannedWeakTitle(
  title: string,
  language: "zh" | "en",
  chapterGoal: ChapterGoal | undefined,
): boolean {
  if (hasInvalidTitleIntegrity(title, language)) {
    return true;
  }

  if (language === "en") {
    const words = title.split(/\s+/u).filter(Boolean);
    return words.length <= 1;
  }

  if (chapterGoal?.activeCharacters.some((name) => title === name.trim())) {
    return true;
  }

  if (/^(云岚|楚夜|秦枭)$/u.test(title)) {
    return true;
  }

  if (/^(水流|山洞|暗河|洞口)$/u.test(title)) {
    return true;
  }
  return false;
}

function isLikelyChineseTitleFragment(title: string): boolean {
  if (/^(?:索|并|因|而|的)[\u4e00-\u9fff]{2,}$/u.test(title)) {
    return true;
  }

  const completeNounPhrase = /^[\u4e00-\u9fff]{1,8}的[\u4e00-\u9fff]{1,8}$/u.test(title);
  const completeActionPhrase = /^(?:拿到|获得|找到|发现|揭开|掌握|压住|摆脱|逃离|冲出|逼退|踏入|斩开|守住|踏破)[\u4e00-\u9fff]{2,10}$/u.test(title);
  const completeCrisisPhrase = /[\u4e00-\u9fff]{1,8}(?:死局|代价|追兵|杀机|威胁|封锁|围杀|反噬|真相|铜铃|火种|药材|情报|暗河|黑市|裂谷|入口|尽头)$/u.test(title);
  if (completeNounPhrase || completeActionPhrase || completeCrisisPhrase) {
    return false;
  }

  return title.length <= 5;
}

function detectTitlePattern(title: string, language: "zh" | "en"): string | undefined {
  if (language === "en") {
    if (/\bafter\b/i.test(title)) return "after-payoff";
    if (/\bprice\b/i.test(title)) return "price";
    return undefined;
  }

  if (/背后的/u.test(title)) return "price";
  if (/逼近之时/u.test(title)) return "crisis-close";
  if (/之后/u.test(title)) return "after-payoff";
  if (/前的死局/u.test(title)) return "crisis-deadlock";
  if (/的/u.test(title) && /(尽头|入口|洞口|深处|暗河|黑市|营地)/u.test(title)) return "place-object";
  return undefined;
}

function normalizeRecentTitles(titles: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
  return (titles ?? [])
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(-5);
}

export function extractTitleCoreAnchor(
  title: string,
  language: "zh" | "en",
): string | undefined {
  const cleaned = sanitizeCandidateTitle(title, language);
  if (!cleaned) return undefined;

  if (language === "en") {
    const anchor = cleaned.split(/[:,-]/u)[0]?.trim();
    return anchor && anchor.split(/\s+/u).length >= 2 ? anchor : undefined;
  }

  const base = cleaned.split(/[：:]/u)[0]?.trim() ?? cleaned;
  const explicit = base.match(/([\u4e00-\u9fff]{2,8}(?:尽头|入口|深处|古碑碎片|古碑|碎片))/u);
  if (explicit?.[1]) {
    return explicit[1];
  }

  const seeded = extractZhPlaceSeed([base]);
  if (seeded) {
    return seeded;
  }

  const nounAnchor = base.match(/^([\u4e00-\u9fff]{2,8})(?:的秘密|前的死局|背后的代价|逼近之时|之后)$/u);
  if (nounAnchor?.[1]) {
    return nounAnchor[1];
  }

  return undefined;
}

export function findCollapsedTitleAnchors(
  recentTitles: ReadonlyArray<string>,
  language: "zh" | "en",
): ReadonlyArray<TitleAnchorPressure> {
  const recent = recentTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(-5);
  if (recent.length < 3) {
    return [];
  }

  const sequence: string[] = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const anchor = extractTitleCoreAnchor(recent[index]!, language);
    if (!anchor) {
      break;
    }
    if (sequence.length === 0 || sequence[0] === anchor) {
      sequence.unshift(anchor);
      continue;
    }
    break;
  }

  const anchor = sequence[0];
  return anchor && sequence.length >= 3
    ? [{ anchor, count: sequence.length }]
    : [];
}

export function detectCollapsedTitleAnchor(
  title: string,
  recentTitles: ReadonlyArray<string>,
  language: "zh" | "en",
): string | undefined {
  const anchor = extractTitleCoreAnchor(title, language);
  if (!anchor) {
    return undefined;
  }

  return findCollapsedTitleAnchors(recentTitles, language)
    .find((entry) => entry.anchor === anchor)?.anchor;
}

export function enforceFinalTitleAnchorGuard(params: {
  readonly language: "zh" | "en";
  readonly finalTitle: string;
  readonly fallbackTitle?: string;
  readonly recentTitles: ReadonlyArray<string>;
}): string {
  const normalizedFinalTitle = normalizeRepeatedTitleShell(params.finalTitle);
  const finalCollapsedAnchor = detectCollapsedTitleAnchor(
    normalizedFinalTitle,
    params.recentTitles,
    params.language,
  );
  if (!finalCollapsedAnchor) {
    return normalizedFinalTitle;
  }

  const fallback = params.fallbackTitle?.trim();
  if (!fallback) {
    return params.finalTitle;
  }

  const fallbackCollapsedAnchor = detectCollapsedTitleAnchor(
    fallback,
    params.recentTitles,
    params.language,
  );
  return fallbackCollapsedAnchor ? normalizedFinalTitle : normalizeRepeatedTitleShell(fallback);
}

export function normalizeRepeatedTitleShell(title: string): string {
  const trimmed = title.trim();
  const match = trimmed.match(/^(.+?)\s*(：|:|｜|\||-)\s*(.+)$/u);
  if (!match) return trimmed;

  const left = match[1]?.trim() ?? "";
  const right = match[3]?.trim() ?? "";
  if (!left || !right) return trimmed;

  const normalizeSide = (value: string) => value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  return normalizeSide(left) === normalizeSide(right) ? left : trimmed;
}

export function assertFinalTitleAllowed(params: {
  readonly language: "zh" | "en";
  readonly finalTitle: string;
  readonly recentTitles: ReadonlyArray<string>;
}): void {
  const collapsedAnchor = detectCollapsedTitleAnchor(
    params.finalTitle,
    params.recentTitles,
    params.language,
  );
  if (!collapsedAnchor) {
    return;
  }

  throw new Error(
    params.language === "en"
      ? `FINAL_TITLE still uses collapsed anchor "${collapsedAnchor}": ${params.finalTitle}`
      : `FINAL_TITLE 仍命中已坍缩锚“${collapsedAnchor}”：${params.finalTitle}`,
  );
}

function hasBannedTitleAnchor(
  title: string,
  bannedAnchors: ReadonlySet<string>,
  language: "zh" | "en",
): boolean {
  const anchor = extractTitleCoreAnchor(title, language);
  return Boolean(anchor && bannedAnchors.has(anchor));
}

function getZhStyleOrder(
  endingHookType: ChapterGoal["endingHookType"] | undefined,
): ReadonlyArray<ChapterTitleCandidate["style"]> {
  switch (endingHookType) {
    case "danger":
    case "pursuit":
      return ["crisis", "suspense", "payoff"];
    case "breakthrough":
      return ["payoff", "crisis", "suspense"];
    case "reveal":
    case "choice":
    default:
      return ["suspense", "crisis", "payoff"];
  }
}

function trimZhFragment(fragment: string): string {
  return fragment
    .replace(ZH_STOP_WORDS, "")
    .replace(/[的了着过]/gu, "")
    .replace(/^[到去进从]/u, "")
    .trim();
}
