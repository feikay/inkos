import {
  extractResourceEvents,
  parseResourceRules,
  validateResourceMath,
  type ResourceEvent,
  type ResourceRules,
  type ResourceValidationResult,
} from "./resource-consistency.js";

export type ChapterResourcePlanMode = "normal" | "defer_exchange" | "explore_conversion_path" | "cash_exchange_allowed" | "no_resource_change" | "system_bootstrap" | "resource_rule_reveal";
export type ResourcePlanClosureRequirement = "explicit_balance_required" | "inferred_no_change_allowed" | "explicit_event_chain_required";

export interface PlannedResourceEvent {
  readonly order: number;
  readonly kind: "gain" | "spend" | "unlock" | "use_skill" | "discover" | "exchange" | "balance_claim";
  readonly resource: string;
  readonly amount?: number;
  readonly targetResource?: string;
  readonly targetAmount?: number;
  readonly skill?: string;
  readonly reason: string;
  readonly requiredInText: boolean;
}

export interface ChapterResourcePlan {
  readonly chapter: number;
  readonly mode: ChapterResourcePlanMode;
  readonly source: "resource-engine";
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly allowedEvents: ReadonlyArray<PlannedResourceEvent>;
  readonly forbiddenEvents: ReadonlyArray<string>;
  readonly expectedClosingBalances: Readonly<Record<string, number>>;
  readonly unlockedSkills: ReadonlyArray<string>;
  readonly resourceRules: ResourceRules;
  readonly narrativeGuidance: ReadonlyArray<string>;
  readonly closureRequirement?: ResourcePlanClosureRequirement;
  readonly blockingReason?: string;
}

export interface ResourcePlanTextScanResult {
  readonly ok: boolean;
  readonly violations: ReadonlyArray<string>;
}

export interface ChapterResourcePlanFinalValidation {
  readonly passed: boolean;
  readonly violations: ReadonlyArray<string>;
  readonly missingRequiredEvents: ReadonlyArray<string>;
  readonly forbiddenHits: ReadonlyArray<string>;
  readonly expectedClosingBalances: Readonly<Record<string, number>>;
  readonly actualClosingBalances: Readonly<Record<string, number>>;
  readonly closureRequirement?: ResourcePlanClosureRequirement;
  readonly closureSource?: "explicit_balance" | "inferred_no_change" | "event_chain" | "not_applicable";
  readonly noChangeInferred?: boolean;
  readonly balanceMutationEvents?: ReadonlyArray<string>;
  readonly forbiddenMutationHits?: ReadonlyArray<string>;
}

const DEFER_EXCHANGE_FORBIDDEN_EVENTS = [
  "兑换现金",
  "兑换联邦币",
  "现金兑换",
  "到账",
  "入账",
  "银行余额",
  "100联邦币到账",
  "1000联邦币到账",
  "银行到账",
  "手机到账",
  "电子钱包",
  "账户余额增加",
  "一共1200联邦币",
  "一共300联邦币",
  "原来的200加上",
  "刚兑换的一千",
  "刚兑换的一百",
  "扣掉这一千",
  "资金缺口减少",
  "透析费缺口缩小",
  "外婆费用已解决",
  "房租已解决",
  "房租压力暂时缓解",
  "系统转账",
  "匿名入账",
  "路人转钱",
  "路人打赏现金",
  "合法劳务报酬到账",
  "预支权限",
  "透支",
  "待还",
  "负债",
  "当前民望为负",
  "新手临时预支权限",
  "10民望兑换1000联邦币",
  "10民望兑换现金",
  "20民望同时兑换技能和现金",
  "100民望换1000联邦币",
  "1民望=100联邦币",
] as const;

const DEFER_EXCHANGE_VIOLATION_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "正文出现现金兑换", pattern: /兑换(?:了)?(?:\s*\d+\s*)?(?:现金|联邦币)|换成(?:现金|联邦币)|换取(?:现金|联邦币)|\d+\s*(?:点)?民望(?:值)?兑换(?:了)?\s*\d+\s*联邦币/u },
  { label: "正文出现到账/入账", pattern: /到账|入账|银行账户|电子钱包|系统转账|匿名入账|手机(?:里|账户|余额)/u },
  { label: "正文出现1000联邦币或一千现金", pattern: /1000\s*(?:联邦币|现金|元)|一千(?:联邦币|现金|元)?|刚兑换的一千/u },
  { label: "正文出现一共1200或一共300", pattern: /一共\s*(?:1200|300)|总共\s*(?:1200|300)|1200\s*联邦币|300\s*联邦币/u },
  { label: "正文出现资金缺口减少", pattern: /资金缺口(?:减少|缩小|降到|少了)|透析费缺口(?:减少|缩小)|房租压力(?:暂时)?缓解|差额被扣减/u },
  { label: "正文出现预支/透支/负债", pattern: /预支|透支|负债|待还|当前民望(?:值)?\s*[-－]\s*\d+|民望(?:值)?为负/u },
  { label: "正文写错资源规则", pattern: /10\s*(?:点)?民望(?:值)?兑换\s*1000|10\s*(?:点)?民望(?:值)?兑换现金|20\s*(?:点)?民望(?:值)?[^。！？\n]{0,24}(?:技能|现金)[^。！？\n]{0,24}(?:技能|现金)|1\s*民望\s*[=:＝]\s*100\s*联邦币/u },
];

const EXPLORE_CONVERSION_FORBIDDEN_EVENTS = [
  ...DEFER_EXCHANGE_FORBIDDEN_EVENTS,
  "重复兑换初级辩论技能",
  "再次消耗10民望解锁初级辩论技能",
  "重复扶老太太+10",
  "重复第2章路人认可+100",
  "初级格斗技能",
  "消耗100民望",
  "当前民望余额0",
  "民望值：0",
  "联邦币：0",
] as const;

const EXPLORE_CONVERSION_VIOLATION_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  ...DEFER_EXCHANGE_VIOLATION_PATTERNS,
  { label: "重复兑换已解锁技能：初级辩论技能", pattern: /(?:消耗|扣除|花费|用)\s*10\s*(?:点)?民望(?:值)?[^。！？\n]{0,24}(?:兑换|解锁|购买)[^。！？\n]{0,12}初级辩论技能|(?:再次|重新)[^。！？\n]{0,12}(?:兑换|解锁)[^。！？\n]{0,12}初级辩论技能/u },
  { label: "未授权技能解锁：初级格斗技能", pattern: /初级格斗技能/u },
  { label: "未授权消耗100民望", pattern: /(?:消耗|扣除|花费|用)\s*100\s*(?:点)?民望(?:值)?/u },
  { label: "重复第2章民望+10", pattern: /(?:获得|新增|增加)?\s*民望值?\s*[+＋]\s*10|获得\s*10\s*(?:点)?民望/u },
  { label: "重复第2章民望+100", pattern: /(?:获得|新增|增加)?\s*民望值?\s*[+＋]\s*100|获得\s*100\s*(?:点)?民望/u },
  { label: "民望值不得归零", pattern: /当前民望(?:值|余额)?\s*(?:=|＝|：|:|为|是)?\s*0(?:点)?|民望(?:值)?归零/u },
  { label: "联邦币不得为0", pattern: /联邦币\s*(?:=|＝|：|:|为|是|余额)?\s*0(?:\D|$)/u },
];

export function buildChapterResourcePlan(params: {
  readonly chapter: number;
  readonly bookRules: string;
  readonly particleLedger: string;
  readonly currentState: string;
  readonly previousChapterSummary?: string;
  readonly chapterGoal?: string;
  readonly chapterHooks?: string;
  readonly genre?: string;
  readonly systemMode?: string;
}): ChapterResourcePlan {
  const resourceRules = parseResourceRules(params.bookRules, params.particleLedger, params.currentState);
  const resourceNames = Object.keys(resourceRules.resources);
  const openingBalances = {
    ...pickKnownBalances(resourceRules),
    ...extractPlanOpeningBalances([params.particleLedger, params.currentState, params.bookRules].join("\n"), resourceNames),
  };
  const inferenceText = [
    params.chapterGoal,
    params.currentState,
    params.previousChapterSummary,
    params.chapterHooks,
  ].filter(Boolean).join("\n");

  const chapter2CivicPlan = buildChapter2CivicDeferExchangePlanIfMatched({
    ...params,
    resourceRules,
    openingBalances,
    inferenceText,
  });
  if (chapter2CivicPlan) return chapter2CivicPlan;

  const exploreConversionPlan = buildExploreConversionPathPlanIfMatched({
    ...params,
    resourceRules,
    openingBalances,
    inferenceText,
  });
  if (exploreConversionPlan) return exploreConversionPlan;

  // ---- new: system bootstrap / resource rule reveal detection (universal) ----
  const systemBootstrapPlan = buildSystemBootstrapPlanIfMatched({
    ...params,
    resourceRules,
    openingBalances,
    inferenceText,
    hasAnyResources: Object.keys(resourceRules.resources).length > 0,
  });
  if (systemBootstrapPlan) return systemBootstrapPlan;

  const resourceRuleRevealPlan = buildResourceRuleRevealPlanIfMatched({
    ...params,
    resourceRules,
    openingBalances,
    inferenceText,
    hasAnyResources: Object.keys(resourceRules.resources).length > 0,
  });
  if (resourceRuleRevealPlan) return resourceRuleRevealPlan;

  // ---- Step 1-2: if no resources or no ledger activity, bail out early ----
  const hasAnyResources = Object.keys(resourceRules.resources).length > 0;
  const ledgerHasActivity = /[|｜]\s*\d+/u.test(params.particleLedger);
  if (!hasAnyResources || !ledgerHasActivity) {
    return {
      chapter: params.chapter,
      mode: "no_resource_change",
      source: "resource-engine",
      openingBalances,
      allowedEvents: [],
      forbiddenEvents: [],
      expectedClosingBalances: openingBalances,
      unlockedSkills: [],
      resourceRules,
      closureRequirement: "inferred_no_change_allowed",
      narrativeGuidance: [
        "本章未生成显式资源变化计划；如正文需要资源变化，必须仍服从 book_rules 与 particle_ledger。",
      ],
    };
  }

  // ---- Step 3: generic inference from chapterGoal / currentState ----
  const inferredPlan = inferGenericResourcePlan({
    chapter: params.chapter,
    resourceRules,
    openingBalances,
    inferenceText,
    particleLedger: params.particleLedger,
  });

  if (inferredPlan) return inferredPlan;

  // ---- Step 4: fallback to chapter-2 civic system hardcoded logic ----
  return {
    chapter: params.chapter,
    mode: "no_resource_change",
    source: "resource-engine",
    openingBalances,
    allowedEvents: [],
    forbiddenEvents: [],
    expectedClosingBalances: openingBalances,
    unlockedSkills: [],
      resourceRules,
      closureRequirement: "inferred_no_change_allowed",
      narrativeGuidance: [
      "本章未生成显式资源变化计划；如正文需要资源变化，必须仍服从 book_rules 与 particle_ledger。",
    ],
  };
}

function buildChapter2CivicDeferExchangePlanIfMatched(params: {
  readonly chapter: number;
  readonly bookRules: string;
  readonly particleLedger: string;
  readonly currentState: string;
  readonly previousChapterSummary?: string;
  readonly chapterGoal?: string;
  readonly chapterHooks?: string;
  readonly resourceRules: ResourceRules;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly inferenceText: string;
}): ChapterResourcePlan | null {
  const { resourceRules, openingBalances } = params;
  const hasCivicSystem = Object.hasOwn(resourceRules.resources, "民望值") && Object.hasOwn(resourceRules.resources, "联邦币");
  const hasDebateSkillRule = resourceRules.skills.some((rule) => rule.skill.includes("初级辩论") && rule.resource === "民望值" && rule.amount === 10);
  const allText = [
    params.bookRules,
    params.particleLedger,
    params.currentState,
    params.previousChapterSummary,
    params.chapterGoal,
    params.chapterHooks,
  ].filter(Boolean).join("\n");
  const priorStateText = [params.particleLedger, params.currentState].filter(Boolean).join("\n");
  const hasCivicTerms = /民望系统|民望值|联邦币|系统商店|初级辩论技能/u.test(allText);
  const hasChapter2Goal = /扶老太太|反击汤姆|怼汤姆|初级辩论|路人认可|民众认可|不兑换现金/u.test(allText);
  const hasPriorDebateUnlock = /(?:已解锁技能\s*[=：:]\s*初级辩论技能|技能\s*[|｜]\s*初级辩论技能|初级辩论技能\s*[|｜]\s*2|初级辩论技能[^。\n]{0,16}(?:已拥有|已解锁|本章解锁))/u.test(priorStateText);
  const reputationOpening = openingBalances["民望值"] ?? 0;
  const federalOpening = resolveFederalOpening({
    openingBalances,
    resourceRules,
    text: allText,
  });
  const firstTeachingChapter = params.chapter === 2
    || (params.chapter === 1 && /不兑换现金|不兑现现金|延后(?:现金)?兑换|下一章.*(?:兑换|变现|救命钱)/u.test(allText));
  const firstTenSystemChapter = firstTeachingChapter
    && hasCivicSystem
    && reputationOpening === 0
    && federalOpening === 200
    && !hasPriorDebateUnlock
    && (hasDebateSkillRule || hasCivicTerms)
    && hasChapter2Goal;

  if (!firstTenSystemChapter) return null;

  const expectedReputation = reputationOpening + 10 - 10 + 100;
  const expectedClosingBalances = {
    ...openingBalances,
    民望值: expectedReputation,
    联邦币: federalOpening,
  };

  return {
    chapter: params.chapter,
    mode: "defer_exchange",
    source: "resource-engine",
    openingBalances: {
      ...openingBalances,
      民望值: reputationOpening,
      联邦币: federalOpening,
    },
    allowedEvents: [
      { order: 1, kind: "balance_claim", resource: "民望值", amount: reputationOpening, reason: "本章期初民望值", requiredInText: false },
      { order: 2, kind: "balance_claim", resource: "联邦币", amount: federalOpening, reason: "本章期初联邦币", requiredInText: false },
      { order: 3, kind: "gain", resource: "民望值", amount: 10, reason: "林默扶老太太", requiredInText: true },
      { order: 4, kind: "spend", resource: "民望值", amount: 10, reason: "兑换初级辩论技能", requiredInText: true },
      { order: 5, kind: "unlock", resource: "技能", skill: "初级辩论技能", reason: "消耗10民望后解锁", requiredInText: true },
      { order: 6, kind: "gain", resource: "民望值", amount: 100, reason: "围观路人认可", requiredInText: true },
      { order: 7, kind: "balance_claim", resource: "民望值", amount: expectedReputation, reason: "本章结尾面板确认当前民望值", requiredInText: true },
      { order: 8, kind: "balance_claim", resource: "联邦币", amount: federalOpening, reason: "本章结尾确认联邦币未变化", requiredInText: true },
    ],
    forbiddenEvents: [...DEFER_EXCHANGE_FORBIDDEN_EVENTS],
    expectedClosingBalances,
    unlockedSkills: ["初级辩论技能"],
    resourceRules,
    closureRequirement: "explicit_event_chain_required",
    narrativeGuidance: [
      "本章不兑换现金，不兑换联邦币，不减少资金缺口。",
      "外婆透析费仍差2700，房租仍差800，总资金缺口仍是3500。",
      "爽点来自当众怼回汤姆、路人开始相信林默、汤姆第一次吃瘪、系统面板显示民望值增加。",
      "结尾留下下一章可通过民望兑换资源的希望，但不在本章兑现现金。",
    ],
  };
}

function buildExploreConversionPathPlanIfMatched(params: {
  readonly chapter: number;
  readonly bookRules: string;
  readonly particleLedger: string;
  readonly currentState: string;
  readonly previousChapterSummary?: string;
  readonly chapterGoal?: string;
  readonly chapterHooks?: string;
  readonly resourceRules: ResourceRules;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly inferenceText: string;
}): ChapterResourcePlan | null {
  const { resourceRules, openingBalances } = params;
  const allText = [
    params.bookRules,
    params.particleLedger,
    params.currentState,
    params.previousChapterSummary,
    params.chapterGoal,
    params.chapterHooks,
  ].filter(Boolean).join("\n");
  const reputationOpening = openingBalances["民望值"] ?? 0;
  const federalOpening = resolveFederalOpening({
    openingBalances,
    resourceRules,
    text: allText,
  });
  const hasCivicSystem = Object.hasOwn(resourceRules.resources, "民望值") && Object.hasOwn(resourceRules.resources, "联邦币");
  const hasUnlockedDebateSkill = /(?:已解锁技能\s*[=：:]\s*初级辩论技能|技能\s*[|｜]\s*初级辩论技能|初级辩论技能\s*[|｜]\s*2|初级辩论技能[^。\n]{0,16}(?:已拥有|已解锁|本章解锁))/u.test([params.particleLedger, params.currentState].join("\n"));
  const hasExploreGoal = /合法资源变现|变现路径|可兑换所有合法资源|外公遗物|竞选资料|死亡线索|主线任务|参选保证金|100万联邦币|一百万联邦币/u.test(allText);
  const postTeachingStage = params.chapter >= 3
    && hasCivicSystem
    && reputationOpening >= 100
    && federalOpening === 200
    && hasUnlockedDebateSkill
    && hasExploreGoal;

  if (!postTeachingStage) return null;

  return {
    chapter: params.chapter,
    mode: "explore_conversion_path",
    source: "resource-engine",
    openingBalances: {
      ...openingBalances,
      民望值: reputationOpening,
      联邦币: federalOpening,
    },
    allowedEvents: [
      { order: 1, kind: "balance_claim", resource: "民望值", amount: reputationOpening, reason: "本章期初民望值", requiredInText: false },
      { order: 2, kind: "balance_claim", resource: "联邦币", amount: federalOpening, reason: "本章期初联邦币", requiredInText: false },
      { order: 3, kind: "use_skill", resource: "技能", skill: "初级辩论技能", reason: "已解锁技能可用于沟通、辩论、应对盘问", requiredInText: false },
      { order: 4, kind: "discover", resource: "线索", reason: "发现外公遗物、竞选资料或死亡线索", requiredInText: false },
      { order: 5, kind: "discover", resource: "主线任务", reason: "触发长期目标或参选保证金线索", requiredInText: false },
      { order: 6, kind: "discover", resource: "合法资源变现路径", reason: "探索但不兑现现金", requiredInText: false },
      { order: 7, kind: "balance_claim", resource: "民望值", amount: reputationOpening, reason: "本章结尾确认民望值未变化", requiredInText: true },
      { order: 8, kind: "balance_claim", resource: "联邦币", amount: federalOpening, reason: "本章结尾确认联邦币未变化", requiredInText: true },
    ],
    forbiddenEvents: [...EXPLORE_CONVERSION_FORBIDDEN_EVENTS],
    expectedClosingBalances: {
      ...openingBalances,
      民望值: reputationOpening,
      联邦币: federalOpening,
    },
    unlockedSkills: ["初级辩论技能"],
    resourceRules,
    closureRequirement: "inferred_no_change_allowed",
    narrativeGuidance: [
      "这是首次资源教学后的探索章，不重复第2章民望+10/-10/+100闭环。",
      "初级辩论技能已经拥有，只能使用，不能再次兑换或再次解锁。",
      "本章可以发现外公遗物、竞选资料、死亡线索、主线任务或100万联邦币参选保证金目标。",
      "本章只探索合法资源变现路径，不发生现金到账、入账、银行余额增加，不减少外婆透析费和房租缺口。",
      "结尾必须确认民望值保持100、联邦币保持200，资金缺口仍未解决。",
    ],
  };
}

function resolveFederalOpening(params: {
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly resourceRules: ResourceRules;
  readonly text: string;
}): number {
  const explicitOpening = params.openingBalances["联邦币"];
  if (typeof explicitOpening === "number" && explicitOpening !== 0) return explicitOpening;
  const ruleOpening = params.resourceRules.resources["联邦币"]?.initial;
  if (typeof ruleOpening === "number" && ruleOpening !== 0) return ruleOpening;
  if (/联邦币\s*[=:：为是]\s*200|当前联邦币\s*200|身上仅剩\s*200\s*联邦币|仅剩\s*200\s*联邦币|初始(?:资源)?[^。\n]{0,20}联邦币[^。\n]{0,8}200/u.test(params.text)) {
    return 200;
  }
  return explicitOpening ?? ruleOpening ?? 0;
}


// ---- Generic Resource Plan Inference ----

const DEFER_EXCHANGE_KEYWORDS: ReadonlyArray<string> = [
  "兑换现金", "兑换联邦币", "现金兑换", "到账", "入账",
  "银行余额", "电子钱包", "资金缺口减少", "透支", "预支", "负债",
  "一共1200", "一共300", "刚兑换的一千", "刚兑换的一百",
  "路人给钱", "路人打赏", "劳务报酬到账",
];



// ---- system_bootstrap / resource_rule_reveal universal detection ----

function detectSystemBootstrapStage(params: {
  readonly chapter: number;
  readonly bookRules: string;
  readonly particleLedger: string;
  readonly currentState: string;
  readonly inferenceText: string;
  readonly resourceRules: ResourceRules;
}): boolean {
  const allText = [
    params.bookRules,
    params.particleLedger,
    params.currentState,
    params.inferenceText,
  ].filter(Boolean).join("\n");
  const hasSystemIntro = /系统.{0,16}(?:激活|绑定|觉醒|赋予|开启|初始化|唤醒)/u.test(allText);
  const hasFirstResourceReveal = /(?:获得|激活|解锁|开启).{0,8}(?:系统|面板|能力|技能).{0,16}(?:首次|第一次|初始)/u.test(allText);
  const isEarlyChapter = params.chapter <= 3;
  const hasResources = Object.keys(params.resourceRules.resources).length > 0;
  if (!(hasSystemIntro || hasFirstResourceReveal) || !isEarlyChapter || !hasResources) {
    return false;
  }

  // Already-activated guard: if the ledger or current state already contains
  // resource balances that differ from their initial values, the system was
  // activated in a previous chapter. This is not a true first bootstrap, so
  // fall back to resource_rule_reveal / normal instead of generating
  // first-activation balance_claim events.
  if (hasNonInitialBalances(params.resourceRules, params.particleLedger, params.currentState)) {
    return false;
  }

  return true;
}

function hasNonInitialBalances(
  resourceRules: ResourceRules,
  particleLedger: string,
  currentState: string,
): boolean {
  const text = [particleLedger, currentState].filter(Boolean).join("\n");
  if (!text.trim()) return false;

  for (const [resource, rule] of Object.entries(resourceRules.resources)) {
    const escaped = resource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${escaped}\\s*[=＝:：为]\\s*(-?\\d+)`, "u"),
      new RegExp(`当前${escaped}\\s*(-?\\d+)`, "u"),
      new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*(-?\\d+)\\s*\\|`, "u"),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = Number.parseInt(match[1] ?? "", 10);
      if (Number.isFinite(value) && value !== rule.initial) {
        return true;
      }
    }
  }
  return false;
}

function detectResourceRuleRevealStage(params: {
  readonly chapter: number;
  readonly inferenceText: string;
  readonly resourceRules: ResourceRules;
}): boolean {
  const allText = params.inferenceText;
  const hasRuleReveal = /(?:揭示|说明|解释|规则|运作方式|兑换比例|兑换规则|资源规则|如何使用|怎么用).{0,16}(?:资源|系统|面板|能力|技能|兑换)/u.test(allText)
    || /(?:资源|系统|面板|能力|技能|兑换).{0,16}(?:揭示|说明|解释|规则|运作方式|兑换比例|兑换规则)/u.test(allText);
  const notBootstrap = !/系统.{0,16}(?:激活|绑定|觉醒|赋予|开启|初始化|唤醒)/u.test(allText);
  const hasResources = Object.keys(params.resourceRules.resources).length > 0;
  return hasRuleReveal && notBootstrap && hasResources;
}

function buildSystemBootstrapPlanIfMatched(params: {
  readonly chapter: number;
  readonly bookRules: string;
  readonly particleLedger: string;
  readonly currentState: string;
  readonly previousChapterSummary?: string;
  readonly chapterGoal?: string;
  readonly chapterHooks?: string;
  readonly resourceRules: ResourceRules;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly inferenceText: string;
  readonly hasAnyResources: boolean;
}): ChapterResourcePlan | null {
  if (!params.hasAnyResources) return null;
  if (!detectSystemBootstrapStage({
    chapter: params.chapter,
    bookRules: params.bookRules,
    particleLedger: params.particleLedger,
    currentState: params.currentState,
    inferenceText: params.inferenceText,
    resourceRules: params.resourceRules,
  })) return null;

  const allText = [params.bookRules, params.particleLedger, params.currentState, params.chapterGoal, params.chapterHooks].filter(Boolean).join("\n");
  // Schema-driven: only include resources that appear in the book's context,
  // avoiding pollution from global default resources irrelevant to this book.
  const bootstrapResources = Object.entries(params.openingBalances).filter(([resource]) =>
    allText.includes(resource)
  );
  return {
    chapter: params.chapter,
    mode: "system_bootstrap",
    source: "resource-engine",
    openingBalances: params.openingBalances,
    allowedEvents: bootstrapResources.map(([resource, amount], index) => ({
      order: index + 1,
      kind: "balance_claim" as const,
      resource,
      amount,
      reason: "系统首次激活：声明初始资源余额",
      requiredInText: true,
    })),
    forbiddenEvents: [
      "exchange",
      "cash_out",
      "balance_transfer",
      "earn_resource_before_closure",
    ],
    expectedClosingBalances: Object.fromEntries(bootstrapResources),
    unlockedSkills: [],
    resourceRules: params.resourceRules,
    closureRequirement: "explicit_balance_required",
    narrativeGuidance: [
      "本章处于系统/能力首次激活阶段。",
      "允许：系统绑定、规则揭示、初始任务发布、首次余额声明。",
      "禁止：未计划的收益到账、资源兑换、余额转移。",
      "如正文需要资源变化，必须与 Resource Plan 已允许事件一致。",
    ],
  };
}

function buildResourceRuleRevealPlanIfMatched(params: {
  readonly chapter: number;
  readonly bookRules: string;
  readonly particleLedger: string;
  readonly currentState: string;
  readonly previousChapterSummary?: string;
  readonly chapterGoal?: string;
  readonly chapterHooks?: string;
  readonly resourceRules: ResourceRules;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly inferenceText: string;
  readonly hasAnyResources: boolean;
}): ChapterResourcePlan | null {
  if (!params.hasAnyResources) return null;
  if (!detectResourceRuleRevealStage({
    chapter: params.chapter,
    inferenceText: params.inferenceText,
    resourceRules: params.resourceRules,
  })) return null;

  return {
    chapter: params.chapter,
    mode: "resource_rule_reveal",
    source: "resource-engine",
    openingBalances: params.openingBalances,
    allowedEvents: [
      {
        order: 1,
        kind: "discover",
        resource: Object.keys(params.resourceRules.resources)[0] ?? "未知资源",
        reason: "揭示资源运作规则",
        requiredInText: true,
      },
    ],
    forbiddenEvents: [
      "exchange",
      "cash_out",
      "earn_resource_before_closure",
      "gain",
      "consume",
    ],
    expectedClosingBalances: params.openingBalances,
    unlockedSkills: [],
    resourceRules: params.resourceRules,
    closureRequirement: "explicit_balance_required",
    narrativeGuidance: [
      "本章处于资源规则揭示阶段。",
      "允许：解释资源运作方式、兑换比例、使用限制。",
      "禁止：实际收益/消耗/兑换操作。",
      "如正文需要资源变化，必须与 Resource Plan 已允许事件一致。",
    ],
  };
}

interface GenericInferenceInput {
  readonly chapter: number;
  readonly resourceRules: ResourceRules;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly inferenceText: string;
  readonly particleLedger: string;
}


function inferGenericResourcePlan(input: GenericInferenceInput): ChapterResourcePlan | null {
  const { chapter, resourceRules, openingBalances, inferenceText } = input;

  // Detect if chapterGoal explicitly wants defer_exchange treatment
  const needsDeferExchange = DEFER_EXCHANGE_KEYWORDS.some((keyword) => inferenceText.includes(keyword));

  if (needsDeferExchange && chapter <= 2 && (openingBalances["民望值"] ?? 0) === 0) {
    return buildDeferExchangePlan({ chapter, resourceRules, openingBalances, inferenceText });
  }

  // Only infer normal mode when inferenceText explicitly mentions a known skill or resource
  const mentionedSkills = resourceRules.skills.filter((rule) => inferenceText.includes(rule.skill));
  const mentionedResources = Object.keys(resourceRules.resources).filter(
    (r) => inferenceText.includes(r) && /[+＋\-−]\s*\d+\s*(?:点)?/u.test(inferenceText)
  );

  if (mentionedSkills.length > 0 || mentionedResources.length > 0) {
    return buildNormalResourcePlan({ chapter, resourceRules, openingBalances, inferenceText });
  }

  // Cannot confidently determine mode — return null to fall through to chapter-2 logic
  return null;
}


function buildDeferExchangePlan(input: {
  readonly chapter: number;
  readonly resourceRules: ResourceRules;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly inferenceText: string;
}): ChapterResourcePlan {
  const { chapter, resourceRules, openingBalances, inferenceText } = input;
  const allowedEvents: PlannedResourceEvent[] = [];
  let order = 1;

  // Add opening balance claims for all tracked resources
  for (const [resource, amount] of Object.entries(openingBalances)) {
    allowedEvents.push({
      order: order++,
      kind: "balance_claim",
      resource,
      amount,
      reason: `本章期初${resource}`,
      requiredInText: false,
    });
  }

  // Detect skill unlocks from inferenceText matching resourceRules.skills
  const mentionedSkills = resourceRules.skills.filter((rule) => inferenceText.includes(rule.skill));
  const spentResources = new Set<string>();
  for (const skillRule of mentionedSkills) {
    // Only add spend if a numeric amount is involved
    if (skillRule.amount > 0 && !spentResources.has(skillRule.resource)) {
      spentResources.add(skillRule.resource);
    }
    allowedEvents.push({
      order: order++,
      kind: "spend",
      resource: skillRule.resource,
      amount: skillRule.amount,
      reason: `兑换${skillRule.skill}`,
      requiredInText: true,
    });
    allowedEvents.push({
      order: order++,
      kind: "unlock",
      resource: "技能",
      skill: skillRule.skill,
      reason: `消耗${skillRule.amount}${skillRule.resource}后解锁`,
      requiredInText: true,
    });
  }

  // Detect generic resource gains from inferenceText
  const gainPattern = /(?:获得|增加|[+＋])\s*(\d+)\s*(?:点)?\s*([民声灵力修功\u4e00-\u9fff]{2,6}?)(?:值|点)?/gu;
  for (const match of inferenceText.matchAll(gainPattern)) {
    const amount = Number.parseInt(match[1] ?? "", 10);
    const resourceName = match[2]?.trim() ?? "";
    if (!Number.isFinite(amount) || amount <= 0 || !resourceName) continue;
    const canonicalResource = Object.keys(openingBalances).find((r) => r.includes(resourceName) || resourceName.includes(r));
    if (canonicalResource) {
      allowedEvents.push({
        order: order++,
        kind: "gain",
        resource: canonicalResource,
        amount,
        reason: `正文中${resourceName}增加`,
        requiredInText: true,
      });
    }
  }

  // Compute expected closing balances
  const expectedClosingBalances: Record<string, number> = { ...openingBalances };
  for (const event of allowedEvents) {
    if (event.kind === "gain" && event.amount) {
      expectedClosingBalances[event.resource] = (expectedClosingBalances[event.resource] ?? 0) + event.amount;
    } else if (event.kind === "spend" && event.amount) {
      expectedClosingBalances[event.resource] = (expectedClosingBalances[event.resource] ?? 0) - event.amount;
    }
  }

  // Add closing balance claims
  for (const [resource, amount] of Object.entries(expectedClosingBalances)) {
    allowedEvents.push({
      order: order++,
      kind: "balance_claim",
      resource,
      amount,
      reason: `本章结尾确认当前${resource}`,
      requiredInText: true,
    });
  }

  const unlockedSkills = mentionedSkills.map((rule) => rule.skill);

  return {
    chapter,
    mode: "defer_exchange",
    source: "resource-engine",
    openingBalances,
    allowedEvents,
    forbiddenEvents: [...DEFER_EXCHANGE_FORBIDDEN_EVENTS],
    expectedClosingBalances,
    unlockedSkills,
    resourceRules,
    closureRequirement: "explicit_event_chain_required",
    narrativeGuidance: [
      "本章不兑换现金，不兑换联邦币，不减少资金缺口。",
      "爽点来自技能使用、当众反击、路人认可、系统面板显示数值增加。",
      "爽点不是现金到账。",
      "结尾留下下一章可通过资源兑换的希望，但不在本章兑现现金。",
    ],
  };
}

function buildNormalResourcePlan(input: {
  readonly chapter: number;
  readonly resourceRules: ResourceRules;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly inferenceText: string;
}): ChapterResourcePlan {
  const { chapter, resourceRules, openingBalances, inferenceText } = input;
  const allowedEvents: PlannedResourceEvent[] = [];
  let order = 1;

  // Add opening balance claims
  for (const [resource, amount] of Object.entries(openingBalances)) {
    allowedEvents.push({
      order: order++,
      kind: "balance_claim",
      resource,
      amount,
      reason: `本章期初${resource}`,
      requiredInText: false,
    });
  }

  // Detect skill unlocks
  const mentionedSkills = resourceRules.skills.filter((rule) => inferenceText.includes(rule.skill));
  for (const skillRule of mentionedSkills) {
    allowedEvents.push({
      order: order++,
      kind: "spend",
      resource: skillRule.resource,
      amount: skillRule.amount,
      reason: `兑换${skillRule.skill}`,
      requiredInText: true,
    });
    allowedEvents.push({
      order: order++,
      kind: "unlock",
      resource: "技能",
      skill: skillRule.skill,
      reason: `消耗${skillRule.amount}${skillRule.resource}后解锁`,
      requiredInText: true,
    });
  }

  // Compute expected closing balances
  const expectedClosingBalances: Record<string, number> = { ...openingBalances };
  for (const event of allowedEvents) {
    if (event.kind === "gain" && event.amount) {
      expectedClosingBalances[event.resource] = (expectedClosingBalances[event.resource] ?? 0) + event.amount;
    } else if (event.kind === "spend" && event.amount) {
      expectedClosingBalances[event.resource] = (expectedClosingBalances[event.resource] ?? 0) - event.amount;
    }
  }

  // Add closing balance claims
  for (const [resource, amount] of Object.entries(expectedClosingBalances)) {
    allowedEvents.push({
      order: order++,
      kind: "balance_claim",
      resource,
      amount,
      reason: `本章结尾确认当前${resource}`,
      requiredInText: false,
    });
  }

  const unlockedSkills = mentionedSkills.map((rule) => rule.skill);

  return {
    chapter,
    mode: "normal",
    source: "resource-engine",
    openingBalances,
    allowedEvents,
    forbiddenEvents: [],
    expectedClosingBalances,
    unlockedSkills,
    resourceRules,
    closureRequirement: "explicit_balance_required",
    narrativeGuidance: [
      "本章允许资源正常增减，但必须符合 book_rules 规定的兑换比例。",
      "不允许临时修改兑换比例、发明新资源规则、或透支/预支。",
    ],
  };
}

export function renderResourcePlanForPrompt(plan: ChapterResourcePlan, target: "chapter_intent" | "writer" = "chapter_intent"): string {
  if (plan.mode === "no_resource_change") {
    return [
      "【本章资源计划，必须遵守】",
      `mode: ${plan.mode}`,
      "本章没有预设资源变化；不得擅自新增现金、余额、透支或规则改写。",
    ].join("\n");
  }

  const allowed = plan.allowedEvents.map((event) => {
    if (event.kind === "unlock") return `- 解锁 ${event.skill ?? event.resource}：${event.reason}`;
    if (event.kind === "use_skill") return `- 使用已解锁技能 ${event.skill ?? event.resource}：${event.reason}`;
    if (event.kind === "discover") return `- 探索/发现 ${event.resource}：${event.reason}`;
    if (event.kind === "balance_claim") return `- 在正文中明确写出期末余额声明：当前${event.resource}：${event.amount}`;
    if (event.kind === "spend") return `- ${event.resource}-${event.amount}：${event.reason}`;
    return `- ${event.resource}+${event.amount}：${event.reason}`;
  });
  const closing = Object.entries(plan.expectedClosingBalances).map(([resource, amount]) => `${resource}=${amount}`).join("，");
  const unlockedSkillLines = plan.unlockedSkills.length
    ? [
        "【已解锁技能】",
        ...plan.unlockedSkills.map((skill) => `- ${skill}：已拥有，可使用，不可重复兑换。`),
      ]
    : [];
  const exploreHardForbid = plan.mode === "explore_conversion_path"
    ? [
        "- 不得再次兑换初级辩论技能。",
        "- 不得再次消耗10民望购买或解锁初级辩论技能。",
        "- 不得新增初级格斗技能。",
        "- 不得写“消耗100民望解锁初级格斗技能”。",
        "- 不得重复扶老太太+10或重复第2章路人认可+100。",
        "- 不得把民望值写成0，不得把联邦币写成0。",
      ]
    : [];
  const noChangeStrategy = getClosureRequirement(plan) === "inferred_no_change_allowed"
    ? [
        "【本章资源策略】",
        `- 本章不发生实际资源变化。民望值期初${plan.openingBalances["民望值"] ?? 0}，期末仍${plan.expectedClosingBalances["民望值"] ?? plan.openingBalances["民望值"] ?? 0}。`,
        `- 联邦币期初${plan.openingBalances["联邦币"] ?? 0}，期末仍${plan.expectedClosingBalances["联邦币"] ?? plan.openingBalances["联邦币"] ?? 0}。`,
        "- 不强制写系统面板；如果写系统面板，数值必须准确。",
        "- 可以自然表达“资金缺口仍在”“钱没有变多”。",
        "- 若自然表达，不要出现任何余额变化暗示。",
      ]
    : [];
  const hardLine = target === "writer"
    ? "【资源计划是硬约束，不是建议】"
    : "【本章资源计划，必须遵守】";
  const hasRequiredBalanceClaim = plan.allowedEvents.some(
    (event) => event.kind === "balance_claim" && event.requiredInText
  );
  const balanceClaimGuidance = target === "writer" && hasRequiredBalanceClaim
    ? [
        "【期末余额声明要求】",
        "- 必须在正文末尾写出所有带「在正文中明确写出期末余额声明」标记的资源余额。",
        "- 格式：在正文中自然写出「当前资源名：数值」，多个资源可用顿号或逗号分隔。",
        "- 示例格式（资源名仅为示意）：「【当前灵力值：100，气血值：50】」",
        "- 数值必须与 Resource Plan 的期末余额一致。",
        "- 如果期末余额为 0，也必须写出「当前资源名：0」。",
      ]
    : [];
  const writerPayoff = target === "writer"
    ? plan.mode === "explore_conversion_path"
      ? [
        "",
        "如果想体现爽感，爽点来自：主角用已拥有的初级辩论技能稳住局面、发现外公遗物和主线线索、看见合法变现路径的可能。",
        "爽点不是重复教学闭环，不是新技能到账，不是现金到账。",
      ].join("\n")
      : [
        "",
        "如果想体现爽感，爽点来自：当众怼回汤姆、路人开始相信林默、汤姆第一次吃瘪、系统面板显示民望值增加、主角第一次看见翻身的可能。",
        "爽点不是现金到账。",
      ].join("\n")
    : "";

  return [
    hardLine,
    `mode: ${plan.mode}`,
    `closureRequirement: ${getClosureRequirement(plan)}`,
    ...noChangeStrategy,
    ...unlockedSkillLines,
    "本章允许：",
    ...allowed,
    `本章结尾：${closing}${plan.unlockedSkills.length ? `，已解锁${plan.unlockedSkills.join("、")}` : ""}`,
    ...balanceClaimGuidance,
    "本章禁止：",
    "- 任何现金兑换",
    "- 任何联邦币到账",
    "- 任何资金缺口减少",
    "- 任何临时透支/预支/负债",
    "- 任何路人给钱、打赏现金、合法劳务报酬到账",
    "- 任何“刚兑换的一千/一百”“一共1200/300”等现金兑现表述",
    ...exploreHardForbid,
    "本章叙事目标：",
    ...plan.narrativeGuidance.map((line) => `- ${line}`),
    writerPayoff,
  ].filter(Boolean).join("\n");
}

export function validateIntentAgainstResourcePlan(intentText: string, plan: ChapterResourcePlan): ResourcePlanTextScanResult {
  return scanTextAgainstResourcePlan(intentText, plan, "chapter_intent");
}

export function preScanTextAgainstResourcePlan(chapterText: string, plan: ChapterResourcePlan): ResourcePlanTextScanResult {
  return scanTextAgainstResourcePlan(chapterText, plan, "writer");
}

export function sanitizeIntentAgainstResourcePlan(intentText: string, plan: ChapterResourcePlan): string {
  if (plan.mode === "explore_conversion_path") {
    let sanitized = intentText;
    const replacements: ReadonlyArray<[RegExp, string]> = [
      [/(?:获得|新增|增加)[^。\n]*?民望(?:值)?\s*[+＋]?\s*(?:10|100)[^。\n]*?[。\n]/gu, "本章不重复第2章民望获取闭环，民望值保持100。\n"],
      [/(?:消耗|扣除|花费|用)\s*10\s*(?:点)?民望(?:值)?[^。\n]*?初级辩论技能[^。\n]*?[。\n]/gu, "初级辩论技能已拥有，本章只能使用，不可重复兑换。\n"],
      [/(?:消耗|扣除|花费|用)\s*100\s*(?:点)?民望(?:值)?[^。\n]*?(?:技能|初级格斗技能)[^。\n]*?[。\n]/gu, "本章不新增技能，不消耗100民望。\n"],
      [/初级格斗技能/gu, "未授权技能"],
      [/当前民望(?:值|余额)?\s*(?:=|＝|：|:|为|是)?\s*0(?:点)?/gu, "当前民望值100"],
      [/联邦币\s*(?:=|＝|：|:|为|是|余额)?\s*0(?:\D|$)/gu, "联邦币保持200"],
    ];
    for (const [pattern, replacement] of replacements) {
      sanitized = sanitized.replace(pattern, replacement);
    }
    if (!sanitized.includes("## Resource Plan Sanitized")) {
      sanitized = [
        sanitized.trimEnd(),
        "",
        "## Resource Plan Sanitized",
        "- [warning] chapter-intent-resource-plan: 本章已识别为 explore_conversion_path。",
        "- 初级辩论技能已拥有，只能使用，不可重复兑换。",
        "- 本章只探索合法资源变现路径，可发现外公遗物/主线任务/100万参选保证金目标，但不兑现现金。",
        "- 本章结尾必须保持：民望值=100，联邦币=200，资金缺口仍未解决。",
      ].join("\n");
    }
    return sanitized.trimEnd() + "\n";
  }
  if (plan.mode !== "defer_exchange") return intentText;
  let sanitized = intentText;
  const replacements: ReadonlyArray<[RegExp, string]> = [
    [/本章[^。\n]*?(?:获得|到账|入账|兑换)[^。\n]*?(?:1000|一千|现金|联邦币)[^。\n]*?[。\n]/gu, "本章不兑现现金，只留下下一章可兑换现金的希望。\n"],
    [/(?:缓解|减少|缩小)[^。\n]*?(?:透析费|房租|资金缺口)[^。\n]*?[。\n]/gu, "资金缺口仍在，透析费和房租压力不在本章解决。\n"],
    [/10\s*(?:点)?民望(?:值)?兑换\s*1000\s*(?:联邦币|现金)/gu, "10民望兑换初级辩论技能"],
    [/当前联邦币(?:增加|余额增加|变为|达到)[^。\n]*/gu, "联邦币保持200不变"],
  ];
  for (const [pattern, replacement] of replacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  if (!sanitized.includes("## Resource Plan Sanitized")) {
    sanitized = [
      sanitized.trimEnd(),
      "",
      "## Resource Plan Sanitized",
      "- [warning] chapter-intent-resource-plan: intent 已按 Resource Plan 降级为 defer_exchange。",
      "- 本章只允许：民望+10，消耗10民望兑换初级辩论技能，民望+100，期末民望值100，联邦币保持200不变。",
      "- 本章不兑换现金，不产生到账/入账，不减少透析费、房租或总资金缺口；结尾只留下下一章希望。",
    ].join("\n");
  }
  return sanitized.trimEnd() + "\n";
}

export function findResourcePlanViolations(text: string, plan: ChapterResourcePlan): string[] {
  if (plan.mode !== "defer_exchange" && plan.mode !== "explore_conversion_path") return [];
  const scanText = text
    .replace(/(?:没有|不|未)(?:立刻|马上|在本章|本章)?兑换现金/gu, "")
    .replace(/(?:没有|不|未)(?:立刻|马上|在本章|本章)?兑换联邦币/gu, "");
  const patterns = plan.mode === "explore_conversion_path"
    ? EXPLORE_CONVERSION_VIOLATION_PATTERNS
    : DEFER_EXCHANGE_VIOLATION_PATTERNS;
  return patterns
    .filter((entry) => entry.pattern.test(scanText))
    .map((entry) => entry.label);
}

export function validateResourceEngineAgainstPlan(params: {
  readonly text: string;
  readonly validation: ResourceValidationResult;
  readonly plan: ChapterResourcePlan;
}): string[] {
  return [...validateTextAgainstChapterResourcePlanFinal({
    text: params.text,
    plan: params.plan,
    validation: params.validation,
  }).violations];
}

export function validateTextAgainstChapterResourcePlanFinal(params: {
  readonly text: string;
  readonly plan?: ChapterResourcePlan;
  readonly validation?: ResourceValidationResult;
}): ChapterResourcePlanFinalValidation {
  const plan = params.plan;
  if (!plan) {
    return {
      passed: true,
      violations: [],
      missingRequiredEvents: [],
      forbiddenHits: [],
      expectedClosingBalances: {},
      actualClosingBalances: {},
      closureRequirement: "inferred_no_change_allowed",
      closureSource: "not_applicable",
      noChangeInferred: false,
      balanceMutationEvents: [],
      forbiddenMutationHits: [],
    };
  }

  const validation = params.validation ?? buildValidationFromText(params.text, plan);
  const expectedClosingBalances = plan.expectedClosingBalances;
  const explicitBalanceClaims = extractExplicitBalanceClaims(params.text, Object.keys(expectedClosingBalances));
  const closureRequirement = getClosureRequirement(plan);
  const noBalanceChangePlan = isNoBalanceChangePlan(plan);
  const balanceMutationEvents = findBalanceMutationEvents(validation.events);

  // Adaptive closing balance for system_bootstrap / resource_rule_reveal:
  // When the chapter has real resource events with clean validation, compute
  // expected closing balances from events instead of rigidly requiring
  // closing = opening (which blocks legitimate bootstrap resource activity).
  const isBootstrapOrReveal = plan.mode === "system_bootstrap" || plan.mode === "resource_rule_reveal";
  const hasBootstrapActivity = isBootstrapOrReveal && balanceMutationEvents.length > 0;
  const validationClean = !validation.issues.some(i => i.severity === "critical");
  const effectiveClosingBalances: Record<string, number> = (hasBootstrapActivity && validationClean)
    ? computeEventBasedClosingBalances(plan.openingBalances, validation.events)
    : { ...expectedClosingBalances };

  const actualClosingBalances: Record<string, number> = {
    ...plan.openingBalances,
    ...validation.closingBalances,
    ...explicitBalanceClaims,
  };
  const forbiddenHits = findResourcePlanViolations(params.text, plan);
  const duplicateOrUnauthorizedUnlockViolations = findSkillUnlockPlanViolations(validation.events, plan);
  const canInferNoChange = noBalanceChangePlan
    && closureRequirement === "inferred_no_change_allowed"
    && forbiddenHits.length === 0
    && balanceMutationEvents.length === 0
    && duplicateOrUnauthorizedUnlockViolations.length === 0
    && validation.issues.length === 0;
  if (canInferNoChange) {
    return {
      passed: true,
      violations: [],
      missingRequiredEvents: [],
      forbiddenHits: [],
      expectedClosingBalances,
      actualClosingBalances: { ...plan.openingBalances },
      closureRequirement,
      closureSource: "inferred_no_change",
      noChangeInferred: true,
      balanceMutationEvents: [],
      forbiddenMutationHits: [],
    };
  }
  if (plan.mode === "no_resource_change") {
    return {
      passed: true,
      violations: [],
      missingRequiredEvents: [],
      forbiddenHits: [],
      expectedClosingBalances,
      actualClosingBalances,
      closureRequirement,
      closureSource: balanceMutationEvents.length === 0 ? "inferred_no_change" : "explicit_balance",
      noChangeInferred: balanceMutationEvents.length === 0,
      balanceMutationEvents,
      forbiddenMutationHits: [],
    };
  }

  const missingRequiredEvents = closureRequirement === "inferred_no_change_allowed" && noBalanceChangePlan
    ? []
    : findMissingRequiredEvents(params.text, validation.events, plan);
  const violations: string[] = [...forbiddenHits, ...missingRequiredEvents];

  // For bootstrap/reveal modes with real resource activity, adjust
  // balance_claim expectations to match event-computed closing balances.
  if (hasBootstrapActivity && validationClean) {
    for (const event of plan.allowedEvents) {
      if (event.kind === "balance_claim") {
        const oldViolation = `缺少期末 ${event.resource}=${event.amount}`;
        const idx = violations.indexOf(oldViolation);
        if (idx >= 0) {
          violations.splice(idx, 1);
          const computedExpected = effectiveClosingBalances[event.resource] ?? 0;
          if (!hasBalanceClaim(params.text, event.resource, computedExpected)) {
            violations.push(`缺少期末 ${event.resource}=${computedExpected}`);
          }
        }
      }
    }
  }

  for (const [resource, expected] of Object.entries(effectiveClosingBalances)) {
    const actual = actualClosingBalances[resource] ?? plan.openingBalances[resource] ?? 0;
    if (actual !== expected) {
      violations.push(`closingBalances ${resource} expected ${expected}, actual ${actual}`);
    }
  }

  for (const issue of validation.issues) {
    if (issue.code === "balance-mismatch") {
      if (actualClosingBalances[issue.resource] === effectiveClosingBalances[issue.resource]) {
        continue;
      }
      if (issue.actual !== undefined && issue.expected !== undefined) {
        violations.push(`closingBalances ${issue.resource} expected ${issue.expected}, actual ${issue.actual}`);
      }
      violations.push(`${issue.resource} balance claim mismatch: expected ${issue.expected}, actual ${issue.actual}`);
    }
  }

  if (plan.mode === "defer_exchange") {
    if ((actualClosingBalances["民望值"] ?? expectedClosingBalances["民望值"]) === 0 && /(?:当前|现在|此刻)?\s*民望值?\s*[：:=为是]\s*0(?:\D|$)|民望(?:值)?归零|当前民望归零/u.test(params.text)) {
      violations.push("defer_exchange 结尾不得显示当前民望值0");
    }
    if (!/(当前|现在|此刻)?\s*民望值?\s*(?:=|＝|：|:|为|是|剩余|余额)?\s*100(?:点)?/u.test(params.text)) {
      violations.push("defer_exchange 缺少期末当前民望值100");
    }
    if (/联邦币\s*(?:[+＋]|增加|涨到|变成|达到)|(?:到账|入账)[^。！？\n]{0,20}联邦币/u.test(params.text)) {
      violations.push("defer_exchange 联邦币不能增加");
    }
  }
  if (plan.mode === "explore_conversion_path") {
    if (closureRequirement !== "inferred_no_change_allowed" && !hasBalanceClaim(params.text, "民望值", expectedClosingBalances["民望值"] ?? Number.NaN)) {
      violations.push(`缺少期末 民望值=${expectedClosingBalances["民望值"]}`);
    }
    if (closureRequirement !== "inferred_no_change_allowed" && !hasBalanceClaim(params.text, "联邦币", expectedClosingBalances["联邦币"] ?? Number.NaN)) {
      violations.push(`缺少期末 联邦币=${expectedClosingBalances["联邦币"]}`);
    }
    violations.push(...duplicateOrUnauthorizedUnlockViolations);
    if ((actualClosingBalances["民望值"] ?? expectedClosingBalances["民望值"]) !== expectedClosingBalances["民望值"]) {
      violations.push(`closing-balance-mismatch: expected ${expectedClosingBalances["民望值"]} actual ${actualClosingBalances["民望值"] ?? 0}`);
    }
  }

  return {
    passed: violations.length === 0,
    violations: [...new Set(violations)],
    missingRequiredEvents: [...new Set(missingRequiredEvents)],
    forbiddenHits: [...new Set(forbiddenHits)],
    expectedClosingBalances: effectiveClosingBalances,
    actualClosingBalances,
    closureRequirement,
    closureSource: noBalanceChangePlan && balanceMutationEvents.length === 0 ? "inferred_no_change" : closureRequirement === "explicit_event_chain_required" ? "event_chain" : "explicit_balance",
    noChangeInferred: noBalanceChangePlan && balanceMutationEvents.length === 0 && violations.length === 0,
    balanceMutationEvents,
    forbiddenMutationHits: forbiddenHits,
  };
}

function computeEventBasedClosingBalances(
  openingBalances: Readonly<Record<string, number>>,
  events: ReadonlyArray<ResourceEvent>,
): Record<string, number> {
  const balances: Record<string, number> = { ...openingBalances };
  for (const event of events) {
    if (event.kind === "gain") {
      balances[event.resource] = (balances[event.resource] ?? 0) + (event.amount ?? 0);
    } else if (event.kind === "consume") {
      balances[event.resource] = (balances[event.resource] ?? 0) - (event.amount ?? 0);
    }
  }
  return balances;
}

export function isNoBalanceChangePlan(plan: ChapterResourcePlan): boolean {
  const sameBalances = balancesEqual(plan.openingBalances, plan.expectedClosingBalances);
  const hasBalanceChangingAllowedEvent = plan.allowedEvents.some((event) =>
    event.kind === "gain"
    || event.kind === "spend"
    || event.kind === "exchange"
    || event.kind === "unlock"
  );
  return sameBalances
    && !hasBalanceChangingAllowedEvent
    && getClosureRequirement(plan) === "inferred_no_change_allowed"
    && (plan.mode === "explore_conversion_path" || plan.mode === "no_resource_change");
}

function getClosureRequirement(plan: ChapterResourcePlan): ResourcePlanClosureRequirement {
  if (plan.closureRequirement) return plan.closureRequirement;
  if (plan.mode === "defer_exchange") return "explicit_event_chain_required";
  if (plan.mode === "explore_conversion_path" || plan.mode === "no_resource_change") return "inferred_no_change_allowed";
  return "explicit_balance_required";
}

function balancesEqual(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }
  return true;
}

function findBalanceMutationEvents(events: ReadonlyArray<ResourceEvent>): string[] {
  return events
    .filter((event) =>
      event.kind === "gain"
      || event.kind === "consume"
      || event.kind === "balance_jump" && isActualBalanceJumpMutation(event)
      || isActualUnlockMutation(event)
    )
    .map((event) => `${event.kind} ${event.resource}${event.amount !== undefined ? ` ${event.amount}` : ""}${event.label ? ` ${event.label}` : ""}: ${event.evidence}`);
}

function isActualBalanceJumpMutation(event: ResourceEvent): boolean {
  if (event.kind !== "balance_jump") return false;
  return event.evidence.includes(event.resource)
    || /(?:当前|余额|面板|栏|条|显示|跳到|跳成|变成|变为)[^。！？\n]{0,8}-?\d+/u.test(event.evidence);
}

function findSkillUnlockPlanViolations(events: ReadonlyArray<ResourceEvent>, plan: ChapterResourcePlan): string[] {
  if (plan.mode !== "explore_conversion_path") return [];
  const violations: string[] = [];
  const allowedUnlockSkills = new Set(plan.allowedEvents.filter((event) => event.kind === "unlock" && event.skill).map((event) => event.skill));
  const knownUnlockedSkills = new Set(plan.unlockedSkills);
  for (const event of events) {
    if (!isActualUnlockMutation(event) || !event.label) continue;
    const label = event.label.replace(/[】\]）)]$/u, "");
    const evidence = event.evidence;
    if (knownUnlockedSkills.has(label)) {
      violations.push(`duplicate-unlock: ${label}已在前文解锁，本章不可重复兑换。`);
    } else if (!allowedUnlockSkills.has(label)) {
      violations.push(`unauthorized-skill-unlock: ${label}不在 Resource Plan allowedEvents 中。`);
    }
  }
  return violations;
}

function isActualUnlockMutation(event: ResourceEvent): boolean {
  if (event.kind !== "unlock") return false;
  if (/(?:已解锁(?:的)?技能?|已拥有|已有|技能栏里已有)/u.test(event.evidence)) return false;
  return /(?:消耗|扣除|花费|用|兑换|购买|再次|重新|解锁)/u.test(event.evidence);
}

export function applyResourcePlanExpectedBalances(
  validation: ResourceValidationResult,
  plan?: ChapterResourcePlan,
): ResourceValidationResult {
  if (!plan || plan.mode === "no_resource_change") return validation;
  const events = [...validation.events];
  for (const [resource, expected] of Object.entries(plan.expectedClosingBalances)) {
    if (!events.some((event) => event.resource === resource && (event.kind === "gain" || event.kind === "consume" || event.kind === "balance_jump"))) {
      events.push({
        kind: "gain",
        resource,
        amount: 0,
        evidence: `Resource Plan: ${resource} remains ${expected}`,
        index: Number.MAX_SAFE_INTEGER - events.length,
        reason: "resource-plan-no-change",
        confidence: 1,
      });
    }
  }
  return {
    ...validation,
    events,
    openingBalances: { ...plan.openingBalances, ...validation.openingBalances },
    closingBalances: { ...plan.openingBalances, ...validation.closingBalances, ...plan.expectedClosingBalances },
    unlockedSkills: [...new Set([...validation.unlockedSkills, ...plan.unlockedSkills])],
  };
}

function scanTextAgainstResourcePlan(text: string, plan: ChapterResourcePlan, target: "chapter_intent" | "writer"): ResourcePlanTextScanResult {
  if (!text.trim()) {
    return { ok: true, violations: [] };
  }
  const violations = findResourcePlanViolations(text, plan);

  // system_bootstrap / resource_rule_reveal: check required balance_claim events.
  // These modes require explicit closing balance declarations in the text;
  // missing declarations must be caught at pre-scan time so the writer can rewrite.
  if (plan.mode === "system_bootstrap" || plan.mode === "resource_rule_reveal") {
    for (const event of plan.allowedEvents) {
      if (event.kind === "balance_claim" && event.requiredInText) {
        if (!hasBalanceClaim(text, event.resource, event.amount ?? Number.NaN)) {
          violations.push(`缺少期末声明：请在正文中写出"当前${event.resource}：${event.amount}"`);
        }
      }
    }
  }

  // defer_exchange: hardcoded pre-scan checks for the required event chain.
  if (target === "writer" && plan.mode === "defer_exchange") {
    if (!/(民望值?\s*[+＋]\s*10|获得\s*10\s*(?:点)?民望)/u.test(text)) {
      violations.push("正文缺少民望+10");
    }
    if (!/初级辩论技能/u.test(text)) {
      violations.push("正文缺少初级辩论技能");
    }
    if (!/(民望值?\s*[+＋]\s*100|获得\s*100\s*(?:点)?民望)/u.test(text)) {
      violations.push("正文缺少民望+100");
    }
    if (!/(当前)?民望值?\s*(?:=|＝|：|为|是)?\s*100/u.test(text)) {
      violations.push("正文缺少当前民望值100");
    }
  }
  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}

function pickKnownBalances(rules: ResourceRules): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const [resource, rule] of Object.entries(rules.resources)) {
    balances[resource] = rule.initial;
  }
  return balances;
}

function extractPlanOpeningBalances(text: string, resourceNames: ReadonlyArray<string>): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const resource of resourceNames) {
    const escaped = resource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const summaryPatterns = [
      new RegExp(`${escaped}\\s*[=＝:：为]\\s*(-?\\d+)`, "u"),
      new RegExp(`当前${escaped}\\s*(-?\\d+)`, "u"),
      new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*(-?\\d+)\\s*\\|`, "u"),
      new RegExp(`身上仍?只有\\s*(-?\\d+)\\s*${escaped}`, "u"),
      new RegExp(`仅剩\\s*(-?\\d+)\\s*${escaped}`, "u"),
    ];
    for (const pattern of summaryPatterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = Number.parseInt(match[1] ?? "", 10);
      if (Number.isFinite(value)) {
        balances[resource] = value;
        break;
      }
    }
  }
  return balances;
}

function buildValidationFromText(text: string, plan: ChapterResourcePlan): ResourceValidationResult {
  const bookRules = [
    "resourceTypes:",
    ...Object.keys(plan.resourceRules.resources).map((resource) => `  - ${resource}`),
  ].join("\n");
  const currentLedger = Object.entries(plan.openingBalances)
    .map(([resource, amount]) => `| ${resource} | ${amount} |`)
    .join("\n");
  return validateResourceMath({
    events: extractResourceEvents(text, bookRules, currentLedger),
    currentLedger,
    rules: plan.resourceRules,
    chapterText: text,
  });
}

function findMissingRequiredEvents(
  text: string,
  events: ReadonlyArray<ResourceEvent>,
  plan: ChapterResourcePlan,
): string[] {
  const missing: string[] = [];
  for (const event of plan.allowedEvents.filter((candidate) => candidate.requiredInText)) {
    if (event.kind === "gain" && !events.some((candidate) => candidate.kind === "gain" && candidate.resource === event.resource && candidate.amount === event.amount)) {
      missing.push(`缺少 ${event.resource}+${event.amount}: ${event.reason}`);
    } else if (event.kind === "spend" && !events.some((candidate) => candidate.kind === "consume" && candidate.resource === event.resource && candidate.amount === event.amount)) {
      missing.push(`缺少 ${event.resource}-${event.amount}: ${event.reason}`);
    } else if (event.kind === "unlock" && event.skill && !events.some((candidate) => candidate.kind === "unlock" && candidate.label === event.skill) && !text.includes(event.skill)) {
      missing.push(`缺少解锁技能 ${event.skill}`);
    } else if (event.kind === "balance_claim" && !hasBalanceClaim(text, event.resource, event.amount ?? Number.NaN)) {
      missing.push(`缺少期末 ${event.resource}=${event.amount}`);
    }
  }
  return missing;
}

function hasBalanceClaim(text: string, resource: string, amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  const escaped = resource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:当前|现在|此刻)?\\s*${escaped.replace(/值$/u, "值?")}\\s*(?:=|＝|：|:|为|是|剩余|余额)?\\s*${amount}(?:点)?`, "u").test(text);
}

function extractExplicitBalanceClaims(text: string, resources: ReadonlyArray<string>): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const resource of resources) {
    const escaped = resource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/值$/u, "值?");
    const pattern = new RegExp(`(?:当前|现在|此刻|系统面板|面板)?[^。！？\\n]{0,16}${escaped}\\s*(?:=|＝|：|:|为|是|剩余|余额)?\\s*(-?\\d+)(?:点)?`, "gu");
    for (const match of text.matchAll(pattern)) {
      const value = Number.parseInt(match[1] ?? "", 10);
      if (Number.isFinite(value)) {
        balances[resource] = value;
      }
    }
  }
  return balances;
}
