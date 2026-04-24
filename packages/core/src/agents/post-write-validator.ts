/**
 * Post-write rule-based validator.
 *
 * Deterministic, zero-LLM-cost checks that run after every chapter generation.
 * Catches violations that prompt-only rules cannot guarantee.
 */

import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import {
  detectCollapsedTitleAnchor,
  findCollapsedTitleAnchors,
  hasInvalidTitleIntegrity,
  isInvalidTitleReplacement,
} from "../utils/chapter-title-engine.js";
import type { BookRules } from "../models/book-rules.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { ChapterGoal, EndingHookType, EndingType, MoodDirective, PayoffDirective } from "../models/input-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";

export interface PostWriteViolation {
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly description: string;
  readonly suggestion: string;
}

export interface EndingHookCheck {
  readonly expectedType: EndingHookType;
  readonly matched: boolean;
  readonly evidence?: string;
}

export interface PayoffCheck {
  readonly expectedPayoff: string;
  readonly matched: boolean;
  readonly matchLevel: "none" | "partial" | "full";
  readonly payoffType?: PayoffDirective["payoffType"];
  readonly payoffDepth?: PayoffDirective["payoffDepth"];
  readonly overReleased?: boolean;
  readonly evidence?: string;
}

export interface PayoffImpactCheck {
  readonly expectedPayoff: string;
  readonly matched: boolean;
  readonly payoffType?: PayoffDirective["payoffType"];
  readonly sensoryMatched: boolean;
  readonly resourceTriggerMatched: boolean;
  readonly resourceFlatMatched: boolean;
  readonly momentMatched: boolean;
  readonly postMomentResolutionMatched: boolean;
  readonly momentAtEnding: boolean;
  readonly costMatched: boolean;
  readonly impactMatched: boolean;
  readonly evidence?: string;
}

export interface PostWriteDisciplineChecks {
  readonly endingHookCheck: EndingHookCheck;
  readonly payoffCheck: PayoffCheck;
}

export interface CadenceDirectiveCheck {
  readonly expectedTypes: ReadonlyArray<"escalation" | "confrontation" | "discovery-under-threat">;
  readonly matched: boolean;
  readonly evidence?: string;
}

export interface MoodCadenceCheck {
  readonly expectedMode: MoodDirective["targetMode"];
  readonly matched: boolean;
  readonly evidence?: string;
  readonly coverageRatio?: number;
  readonly dominantMode?: "combat-heavy" | "mixed";
  readonly structureMatched?: boolean;
  readonly frontHalfCombatDominant?: boolean;
  readonly frontHalfCalmCoverageRatio?: number;
  readonly structureEvidence?: string;
  readonly semanticMatched?: boolean;
  readonly semanticFailures?: ReadonlyArray<"scene1-combat-or-escalation" | "scene1-missing-recovery" | "scene2-missing-interaction" | "scene2-combat-dominant">;
  readonly semanticEvidence?: string;
  readonly scene1IsolationMatched?: boolean;
  readonly scene1IsolationEvidence?: string;
}

export interface EndingIsomorphismCheck {
  readonly matched: boolean;
  readonly evidence?: string;
  readonly repeatedPhrases: ReadonlyArray<string>;
  readonly repeatedModes: ReadonlyArray<string>;
}

export interface EndingTypeCheck {
  readonly expectedType: EndingType;
  readonly matched: boolean;
  readonly evidence?: string;
}

export interface ResourceLedgerFinding {
  readonly kind: "consumption" | "recovery" | "growth" | "injury";
  readonly signal: string;
  readonly matched: boolean;
  readonly evidence: string;
  readonly expectedUpdate: string;
  readonly stateEvidence?: string;
}

export interface ResourceLedgerCheck {
  readonly matched: boolean;
  readonly findings: ReadonlyArray<ResourceLedgerFinding>;
  readonly warnings: ReadonlyArray<string>;
}

export interface HookDebtCheck {
  readonly activeCount: number;
  readonly cap: number;
  readonly newHooksOpened: number;
  readonly oldHooksAdvanced: number;
  readonly matched: boolean;
  readonly warnings: ReadonlyArray<string>;
}

export interface HookEmergenceCheck {
  readonly matched: boolean;
  readonly targetHookId?: string;
  readonly targetHookState?: string;
  readonly movement?: "advance" | "partial-resolve" | "resolve";
  readonly evidence?: string;
}

interface ParagraphShape {
  readonly paragraphs: ReadonlyArray<string>;
  readonly shortThreshold: number;
  readonly shortParagraphs: ReadonlyArray<string>;
  readonly shortRatio: number;
  readonly averageLength: number;
  readonly maxConsecutiveShort: number;
}

const ENDING_HOOK_PATTERNS: Record<EndingHookType, ReadonlyArray<RegExp>> = {
  danger: [
    /危险|威胁|杀机|死路|压来|逼近|袭来|追上来|活不下去|撑不住/u,
    /danger|threat|closing in|bearing down|survival pressure|no way out/i,
  ],
  reveal: [
    /真相|秘密|身份|揭开|揭晓|原来|线索|发现|看清|道出|说破/u,
    /reveal|truth|secret|identity|clue|discovered|turned out/i,
  ],
  pursuit: [
    /追兵|追来|追上|追踪|追逃|封锁|咬上来|尾随|追兵发现|被发现|被盯上|行踪暴露|痕迹暴露|开始追踪|锁定踪迹|尾随逼近|反扑逼近|威胁逼近|杀机逼近/u,
    /pursuit|chase|tracked|tracking|closing the gap|hunters|discovered|marked|pursuit begins|threat closes in/i,
  ],
  choice: [
    /选择|抉择|取舍|两难|必须决定|只能选|要么|不得不决定/u,
    /choice|decision|must choose|either .* or|forced to decide|dilemma/i,
  ],
  breakthrough: [
    /突破|破境|晋阶|觉醒|掌握|领悟|蜕变|提升|新能力/u,
    /breakthrough|ascend|advanced|awakened|mastered|new ability|leveled up/i,
  ],
};

const MOOD_CALM_PATTERNS = [
  /疗伤|包扎|扎营|吃东西|吃肉|喝汤|休整|歇息|路途交谈|交换情报|谈笑|调侃|玩笑|信任加深|并肩而行|关系缓和|平静|喘息|合作|恢复|资源整理|分配药材|讨论计划|结伴深入|慢慢推进|暂时安全|探索环境/u,
  /healed|bandaged|made camp|shared food|ate|rested|travel talk|traded information|teased|joked|trust deepened|calm|breathing room|recovery|lighter banter|relationship beat/i,
] as const;

const MOOD_COMBAT_PATTERNS = [
  /交锋|厮杀|搏杀|刀光|剑光|轰击|爆开|追兵扑来|封锁|围杀|杀机|血战|对轰/u,
  /clash|combat|battle|lunged|struck|ambush|sealed|fight|trading blows|blood fight/i,
] as const;

const SCENE1_ESCALATION_PATTERNS = [
  /杀|斩|砍|轰|爆发|突袭|冲杀|厮杀|交锋|血战|对轰|追兵扑来|封锁升级|危机升级|冲突升级/u,
  /kill|slash|strike|detonate|ambush|charge|battle|clash|fight|escalat(?:e|ed|ing)|new threat/i,
] as const;

const SCENE1_RECOVERY_PATTERNS = [
  /恢复|疗伤|包扎|止血|扎营|伤口|呼吸|稳下来|余波|缓过气|喘息|平静|环境|夜色|火堆|体力回升|伤势/u,
  /recover|healing|bandage|stanch|aftershock|catch(?:ing)? breath|calm|surroundings|campfire|fatigue|wound/i,
] as const;

const SCENE2_INTERACTION_PATTERNS = [
  /对话|交谈|讨论|计划|交换情报|关系|信任|情绪|释放|安抚|调侃|玩笑|并肩/u,
  /dialogue|talked|conversation|discuss(?:ed)?|plan(?:ning)?|exchange(?:d)? information|relationship|trust|emotion|banter|joke|comfort/i,
] as const;

const SCENE1_FORBIDDEN_PRESSURE_PATTERNS = [
  /威胁|规则压力|规则压制|追杀|追兵|围杀|风暴|杀机|危机升级|冲突升级|爆发|崩裂|濒死|封锁升级/u,
  /threat|rule pressure|pursuit|chase|storm|kill intent|danger|conflict escalat(?:e|ed|ion)|explod(?:e|ed|ing)|collapse|dying/i,
] as const;

const ENDING_ISOMORPHISM_PHRASES: ReadonlyArray<{
  readonly label: string;
  readonly patterns: ReadonlyArray<RegExp>;
}> = [
  {
    label: "随着他们的身影消失在黑暗中",
    patterns: [/随着[^。！？\n]{0,16}身影消失在黑暗中/u, /figures?\s+(faded|disappeared)\s+into\s+the\s+dark/i],
  },
  {
    label: "只是冰山一角",
    patterns: [/只是冰山一角/u, /only the tip of the iceberg/i],
  },
  {
    label: "真正的秘密",
    patterns: [/真正的秘密/u, /the real secret/i],
  },
  {
    label: "等待着他们去揭开",
    patterns: [/等待着?他们?去揭开/u, /waiting for them to uncover/i],
  },
  {
    label: "向着未知的未来迈进",
    patterns: [/向着未知的未来迈进/u, /step(?:ped)? toward the unknown future/i],
  },
  {
    label: "一切答案都在前方",
    patterns: [/一切答案都在前方/u, /all the answers (?:lay|wait) ahead/i],
  },
  {
    label: "更大的秘密还在前方",
    patterns: [/更大的秘密还在前方/u, /greater secrets? still lay ahead/i],
  },
  {
    label: "心中充满了希望/信心/勇气",
    patterns: [/心中充满了?(希望|信心|勇气)/u, /(hearts?|minds?)\s+(?:full of|filled with)\s+(hope|confidence|courage)/i],
  },
];

const ENDING_MODE_PATTERNS: ReadonlyArray<{
  readonly mode: string;
  readonly patterns: ReadonlyArray<RegExp>;
}> = [
  {
    mode: "far-horizon-secret",
    patterns: [
      /冰山一角|真正的秘密|等待着?.{0,8}(揭开|揭晓)|一切答案都在前方|更大的秘密还在前方/u,
      /tip of the iceberg|real secret|waiting .* uncover|answers .* ahead|greater secret.* ahead/i,
    ],
  },
  {
    mode: "shadow-fade-exit",
    patterns: [
      /身影消失在黑暗中|走向前方|迈向前方|消失在夜色里/u,
      /figures?.*(disappeared|faded).*(dark|night)|walked toward what lay ahead/i,
    ],
  },
  {
    mode: "hopeful-future-lift",
    patterns: [
      /未知的未来|心中充满了?(希望|信心|勇气)|未来仍在前方/u,
      /unknown future|filled with (hope|confidence|courage)|future still lay ahead/i,
    ],
  },
];

const ENDING_TYPE_PATTERNS: Record<EndingType, ReadonlyArray<RegExp>> = {
  reveal_end: [
    /真相|揭开|揭晓|原来|身份|线索|发现/u,
    /reveal|truth|identity|clue|discovered|turned out/i,
  ],
  unresolved_end: [
    /未解|尚未|仍未|还没|疑问|谜团|待查|未知|去向未明|下落未明/u,
    /still unresolved|remains unknown|question remains|not yet clear|whereabouts unknown/i,
  ],
  resolution_end: [
    /解决|稳住|收束|了结|告一段落|阶段闭环|尘埃落定/u,
    /resolved|stabilized|closed the loop|settled for now|wrapped this stage/i,
  ],
  twist_end: [
    /却|然而|反而|没想到|反转|出乎意料|转折/u,
    /however|yet|but|unexpectedly|twist|turned against/i,
  ],
  calm_end: [
    /平静|缓和|喘息|休整|安顿|短歇|暂时安全/u,
    /calm|breathing room|regroup|rest|temporary safety|quiet beat/i,
  ],
};

const PAYOFF_RESOURCE_TRIGGER_PATTERNS = [
  /触发|引动|引爆|震开|扯开|撕开|按下|碰触|触碰|注入|灌入|激活|催动|翻开|揭开|夺下|抢下|嵌入|共鸣/u,
  /trigger(?:ed)?|ignite(?:d)?|burst|tore open|ripped open|pressed|activated|resonated|seized|snatched|unsealed|unlocked/i,
] as const;

const PAYOFF_RESOURCE_FLAT_PATTERNS = [
  /(?:他|她|楚夜|主角).{0,8}(获得了|拿到了|得到了).{0,16}(地图|情报|线索|腰牌|钥匙|令牌|卷轴|残图|信息)/u,
  /(?:地图|情报|线索|记忆|信息).{0,12}(出现在脑海|涌入脑海|浮现在脑海|映入脑海)/u,
  /(?:he|she|the protagonist).{0,12}(got|gained|received|obtained).{0,24}(map|intel|clue|token|key|scroll|information)/i,
  /(?:information|memory|map details?).{0,24}(appeared in (?:his|her|the protagonist's) mind|flooded into (?:his|her|the protagonist's) mind)/i,
] as const;

const CALM_END_CONFLICT_PATTERNS: ReadonlyArray<RegExp> = [
  /危险|杀机|追兵|爆发|崩裂|濒死|封锁|危机升级/u,
  /danger|kill intent|pursuers?|explosion|collapse|dying|sealed|escalat(?:e|ed|ing)/i,
];

const PAYOFF_IMPACT_SENSORY_PATTERNS: ReadonlyArray<RegExp> = [
  /冷|热|痛|刺痛|灼|麻|酸|胀|震|嗡鸣|耳鸣|低语|眩|汗|血腥|腥气|腥味|气味|光线|火光|光芒|裂纹|碎裂|裂响|轰鸣|触感|呼吸|心跳|失控|视线/u,
  /cold|hot|pain|sting|burn|numb|ache|throb|vibration|ringing|whisper|dizzy|sweat|blood scent|smell|light|glow|crack|shatter|roar|touch|breath|heartbeat|out of control|vision/i,
];

const PAYOFF_IMPACT_COST_PATTERNS: ReadonlyArray<RegExp> = [
  /代价|反噬|消耗|耗尽|折损|亏空|受损|伤口|旧伤|经脉|寿元|牺牲|付出|崩裂|失血|吐血|断裂|失控|精血|灵力.{0,4}骤降|结晶化|残缺|污染|暴露身份|牺牲他人/u,
  /cost|backlash|consume|deplete|drain|price paid|injur(?:y|ed)|wound|meridian|lifespan|sacrifice|spent|vomit(?:ed)? blood|fracture|lost control|blood essence|spirit power drop|crystalliz(?:e|ed)|maimed|corrupt(?:ed|ion)|identity exposed/i,
];

const PAYOFF_IMPACT_RESULT_PATTERNS: ReadonlyArray<RegExp> = [
  /获得|拿到|揭开|揭示|发现|查明|压住|稳住|摆脱|脱离|突破|掌握|逆转|改写|封锁.{0,4}松动|局势.{0,4}(变化|改写)|身份坐实|来源坐实/u,
  /obtained|gained|revealed|discovered|confirmed|stabilized|suppressed|escaped|broke through|mastered|reversed|situation changed/i,
];

const PAYOFF_IMPACT_MOMENT_PATTERNS: ReadonlyArray<RegExp> = [
  /那一瞬间|这一瞬间|就在这一刻|就在此刻|突然|骤然|忽然|猛地|刹那|瞬息|转瞬/u,
  /in that instant|at that moment|right then|suddenly|all at once|in one sharp turn/i,
  /——|--|…|……/u,
  /(?:却|但|然而|可就在)[^。！？\n]{0,24}(?:突然|骤然|崩裂|逆转|翻转|松动|改写)/u,
];

const PAYOFF_POST_MOMENT_RESOLUTION_PATTERNS: ReadonlyArray<RegExp> = [
  /稳住|收束|缓和|平复|止住|安定|告一段落|暂时安全|局势.{0,6}(稳住|缓和|改写|松动)|封锁.{0,4}松动/u,
  /stabilized|settled|cooled down|contained|regrouped|temporary safety|situation (?:stabilized|shifted)|lockdown (?:loosened|eased)/i,
];

const HOOK_EMERGENCE_ADVANCE_PATTERNS = [
  /发现|找到|查明|试出|摸清|掌握|压制|缓解|稳住|新方法|线索|转机|破解|定位|拆出/u,
  /discover|found|figured out|worked out|stabilized|suppressed|new method|clue|breakthrough|identified/i,
] as const;

const HOOK_EMERGENCE_PARTIAL_RESOLVE_PATTERNS = [
  /暂时压住|暂时解除|部分解除|初步解决|先稳住|先控制住|partial(?:ly)? resolve|partly neutralized|temporarily contained/i,
  /暂时压制|暂时化解|压住毒性|止住扩散|堵住缺口/u,
] as const;

const HOOK_EMERGENCE_RESOLVE_PATTERNS = [
  /彻底解决|根除|清除|结束|解掉|拔除|回收|兑现|真相大白|彻底压住|完全化解/u,
  /resolved|fully resolved|ended|cured|removed|eliminated|fully neutralized|truth laid bare/i,
] as const;

const HOOK_EMERGENCE_STALL_PATTERNS = [
  /仍危险|依旧危险|还是危险|仍存在|依旧存在|依然存在|还没解决|尚未解决|没有进展|依旧神秘|只是更神秘/u,
  /still dangerous|still there|still unresolved|no progress|remains a threat|still mysterious/i,
] as const;

const PAYOFF_OVERRELEASE_UNKNOWN_PATTERNS = [
  /尚不清楚|仍不清楚|还不清楚|仍未知|去向未明|下落未明|还不知道|仍待查明|谜团仍在|疑问仍在|尚待揭晓|仍待揭开/u,
  /still unknown|remains unknown|not yet clear|still unresolved|question remains|yet to be revealed|whereabouts unknown/i,
] as const;

const PAYOFF_OVERRELEASE_CLOSURE_PATTERNS = [
  /全部真相|彻底说清|前因后果都|来龙去脉都|一次说清|全都交代|全都解释清楚/u,
  /fully explained|everything was revealed|all was explained|complete truth|whole picture/i,
] as const;

const RESOURCE_SIGNAL_RULES: ReadonlyArray<{
  readonly kind: ResourceLedgerFinding["kind"];
  readonly signal: string;
  readonly patterns: ReadonlyArray<RegExp>;
  readonly statePatterns: ReadonlyArray<RegExp>;
  readonly warningRule: string;
  readonly expectedUpdate: {
    readonly zh: string;
    readonly en: string;
  };
}> = [
  {
    kind: "consumption",
    signal: "qi-blood-consumption",
    patterns: [/气血.{0,8}(下降|减少|亏空|亏损|耗尽|消耗|骤降|暴跌)/u, /blood.*(drain|loss|spent|depleted|drop|plunge)/i],
    statePatterns: [/气血|血气|亏空|耗损|不足/u, /blood|vitality|drain|depleted/i],
    warningRule: "resource-ledger-missing-consumption",
    expectedUpdate: {
      zh: "需要在当前状态或资源账本中记录气血消耗/亏空。",
      en: "Record qi-blood loss or depletion in current state or resource ledger.",
    },
  },
  {
    kind: "consumption",
    signal: "shaqi-consumption",
    patterns: [/煞气.{0,8}(消耗|耗尽|减少|抽空|亏空)|强行催动.{0,8}煞气/u, /sha qi.*(spent|drain|depleted|reduced)|force.*sha qi/i],
    statePatterns: [/煞气|消耗|抽空|亏空/u, /sha qi|depleted|spent|drain/i],
    warningRule: "resource-ledger-missing-consumption",
    expectedUpdate: {
      zh: "需要在资源账本或状态中记录煞气消耗。",
      en: "Record sha-qi expenditure in the ledger or current state.",
    },
  },
  {
    kind: "injury",
    signal: "backlash-or-injury",
    patterns: [/强行催动|反噬|噬心之痛|五脏六腑受损|经脉.{0,6}(刺痛|震伤)|伤口.{0,6}(恶化|崩裂|加重)/u, /backlash|heart-rending pain|organs? damaged|meridians?.*(hurt|shaken)|wound.*(worsen|split|reopen)/i],
    statePatterns: [/伤势|伤口|经脉|反噬|受损|刺痛|震伤/u, /injury|wound|meridian|backlash|damaged|pain/i],
    warningRule: "resource-ledger-missing-injury-update",
    expectedUpdate: {
      zh: "需要在当前状态中同步伤势、反噬或经脉受损。",
      en: "Reflect injury, backlash, or meridian damage in current state.",
    },
  },
  {
    kind: "recovery",
    signal: "recovery",
    patterns: [/气血.{0,8}(恢复|回升)|煞气.{0,8}(补充|恢复|回升)|伤口.{0,8}(止血|愈合)|修复伤势|经脉.{0,8}恢复|体力.{0,8}回升/u, /blood.*recover|sha qi.*recover|wound.*(closed|stopped bleeding|healed)|recover(ed)? strength|meridians?.*recover/i],
    statePatterns: [/恢复|回升|止血|愈合|修复/u, /recover|restored|healed|stopped bleeding/i],
    warningRule: "resource-ledger-missing-recovery",
    expectedUpdate: {
      zh: "需要在当前状态或账本中体现恢复/修复结果。",
      en: "Reflect recovery or repair in current state or ledger.",
    },
  },
  {
    kind: "growth",
    signal: "growth",
    patterns: [/煞气.{0,8}(增加|暴涨|更盛)|境界.{0,8}(提升|突破)|掌握.{0,8}(新手段|新能力)|临时突破/u, /sha qi.*(increase|surge)|realm.*(advance|breakthrough)|mastered.*(ability|method)|temporary breakthrough/i],
    statePatterns: [/提升|突破|掌握|增加|更盛/u, /advance|breakthrough|mastered|increase|surge/i],
    warningRule: "resource-ledger-missing-growth-update",
    expectedUpdate: {
      zh: "需要在状态或账本中同步能力/资源增长。",
      en: "Reflect growth in ability or resources in state or ledger.",
    },
  },
];

// --- Marker word lists ---

/** AI转折/惊讶标记词 */
const SURPRISE_MARKERS = ["仿佛", "忽然", "竟然", "猛地", "猛然", "不禁", "宛如"];

/** 元叙事/编剧旁白模式 */
const META_NARRATION_PATTERNS = [
  /到这里[，,]?算是/,
  /接下来[，,]?(?:就是|将会|即将)/,
  /(?:后面|之后)[，,]?(?:会|将|还会)/,
  /(?:故事|剧情)(?:发展)?到了/,
  /读者[，,]?(?:可能|应该|也许)/,
  /我们[，,]?(?:可以|不妨|来看)/,
];

/** 分析报告式术语（禁止出现在正文中） */
const REPORT_TERMS = [
  "核心动机", "信息边界", "信息落差", "核心风险", "利益最大化",
  "当前处境", "行为约束", "性格过滤", "情绪外化", "锚定效应",
  "沉没成本", "认知共鸣",
];

/** 作者说教词 */
const SERMON_WORDS = ["显然", "毋庸置疑", "不言而喻", "众所周知", "不难看出"];

/** 全场震惊类集体反应 */
const COLLECTIVE_SHOCK_PATTERNS = [
  /(?:全场|众人|所有人|在场的人)[，,]?(?:都|全|齐齐|纷纷)?(?:震惊|惊呆|倒吸凉气|目瞪口呆|哗然|惊呼)/,
  /(?:全场|一片)[，,]?(?:寂静|哗然|沸腾|震动)/,
];

const CHARACTER_EXPOSITION_PATTERNS = [
  /他意识到|她意识到|楚夜意识到|他明白|她明白|楚夜明白|这意味着|显然/u,
  /he realized|she realized|he understood|she understood|this meant|obviously/i,
] as const;

const EMOTION_TELLING_PATTERNS = [
  /他很(?:愤怒|紧张|疲惫|害怕|悲伤|恼火|焦虑)|她很(?:愤怒|紧张|疲惫|害怕|悲伤|恼火|焦虑)|楚夜很(?:愤怒|紧张|疲惫|害怕|悲伤|恼火|焦虑)/u,
  /he was (?:angry|nervous|tense|afraid|sad|furious|exhausted)|she was (?:angry|nervous|tense|afraid|sad|furious|exhausted)/i,
] as const;

const PERFECT_DECISION_PATTERNS = [
  /毫不犹豫地做出最正确的选择|立刻做出了最优选择|没有半点迟疑地选中了唯一正确答案|冷静地做出最优解/u,
  /immediately made the optimal choice|without hesitation chose the correct answer|coolly picked the best solution|made the perfect decision at once/i,
] as const;

const WORLD_EXPOSITION_PATTERNS = [
  /按照(?:这个世界|此界|本界)?(?:的)?(?:战力规则|修炼规则|境界规则)|所谓(?:战力|修炼|境界)规则|这个世界的(?:修炼体系|战力体系|规则是)|在这个世界里(?:修炼|力量|境界)/u,
  /这意味着.{0,16}(战力|境界|规则|体系)|(?:世界观|设定|修炼体系|战力体系)(?:说明|解释)/u,
  /according to (?:the world's )?(?:power rules|cultivation rules)|the world(?:building)? explains|in this world, (?:cultivation|power) works|battle power rules/i,
] as const;

const COGNITIVE_JUMP_PATTERNS = [
  /他意识到|她意识到|楚夜意识到|他明白|她明白|楚夜明白|这说明/u,
  /he realized|she realized|he understood|she understood|this showed|this meant/i,
] as const;

const COGNITIVE_PERCEPTION_PATTERNS = [
  /看见|听见|察觉|闻到|摸到|触到|瞥见|余光|脚步声|回音|呼吸|心跳|刺痛|发麻|发冷|冷意|一震|异样|波动|裂纹|光|声音/u,
  /saw|heard|noticed|smelled|felt|glimpsed|footsteps|echo|breath|heartbeat|sting|numb|cold|shiver|odd|shift|crack|light|sound/i,
] as const;

const COGNITIVE_REACTION_PATTERNS = [
  /停下|顿住|一顿|僵住|抬头|回头|后退|收手|握紧|屏住呼吸|咬紧|沉默|没有回头|脚步一缓|指节发白/u,
  /stopped|froze|paused|looked up|turned|stepped back|withdrew|tightened|held his breath|went silent|did not turn around/i,
] as const;

// --- Validator ---

export function validatePostWrite(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  languageOverride?: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];

  // Skip Chinese-specific rules for English content
  const isEnglish = (languageOverride ?? genreProfile.language) === "en";
  if (isEnglish) {
    // For English, only run book-specific prohibitions and paragraph length check
    return validatePostWriteEnglish(content, genreProfile, bookRules);
  }

  // 1. 硬性禁令: "不是…而是…" 句式
  if (/不是[^，。！？\n]{0,30}[，,]?\s*而是/.test(content)) {
    violations.push({
      rule: "禁止句式",
      severity: "error",
      description: "出现了「不是……而是……」句式",
      suggestion: "改用直述句",
    });
  }

  // 2. 硬性禁令: 破折号
  if (content.includes("——")) {
    violations.push({
      rule: "禁止破折号",
      severity: "error",
      description: "出现了破折号「——」",
      suggestion: "用逗号或句号断句",
    });
  }

  // 3. 转折/惊讶标记词密度 ≤ 1次/3000字
  const markerCounts: Record<string, number> = {};
  let totalMarkerCount = 0;
  for (const word of SURPRISE_MARKERS) {
    const matches = content.match(new RegExp(word, "g"));
    const count = matches?.length ?? 0;
    if (count > 0) {
      markerCounts[word] = count;
      totalMarkerCount += count;
    }
  }
  const markerLimit = Math.max(1, Math.floor(content.length / 3000));
  if (totalMarkerCount > markerLimit) {
    const detail = Object.entries(markerCounts)
      .map(([w, c]) => `"${w}"×${c}`)
      .join("、");
    violations.push({
      rule: "转折词密度",
      severity: "warning",
      description: `转折/惊讶标记词共${totalMarkerCount}次（上限${markerLimit}次/${content.length}字），明细：${detail}`,
      suggestion: "改用具体动作或感官描写传递突然性",
    });
  }

  // 4. 高疲劳词检查（从 genreProfile 读取，单章每词 ≤ 1次）
  const fatigueWords = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = content.match(new RegExp(escaped, "g"));
    const count = matches?.length ?? 0;
    if (count > 1) {
      violations.push({
        rule: "高疲劳词",
        severity: "warning",
        description: `高疲劳词"${word}"出现${count}次（上限1次/章）`,
        suggestion: `替换多余的"${word}"为同义但不同形式的表达`,
      });
    }
  }

  // 5. 元叙事检查（编剧旁白）
  for (const pattern of META_NARRATION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        rule: "元叙事",
        severity: "warning",
        description: `出现编剧旁白式表述："${match[0]}"`,
        suggestion: "删除元叙事，让剧情自然展开",
      });
      break; // 报一次即可
    }
  }

  // 6. 分析报告式术语
  const foundTerms: string[] = [];
  for (const term of REPORT_TERMS) {
    if (content.includes(term)) {
      foundTerms.push(term);
    }
  }
  if (foundTerms.length > 0) {
    violations.push({
      rule: "报告术语",
      severity: "error",
      description: `正文中出现分析报告术语：${foundTerms.map(t => `"${t}"`).join("、")}`,
      suggestion: "这些术语只能用于 PRE_WRITE_CHECK 内部推理，正文中用口语化表达替代",
    });
  }

  // 7. 正文中的章节号指称（如"第33章"、"chapter 33"）
  const chapterRefPattern = /(?:第\s*\d+\s*章|[Cc]hapter\s+\d+)/g;
  const chapterRefs = content.match(chapterRefPattern);
  if (chapterRefs && chapterRefs.length > 0) {
    const unique = [...new Set(chapterRefs)];
    violations.push({
      rule: isEnglish ? "chapter-number-reference" : "章节号指称",
      severity: "error",
      description: isEnglish
        ? `Chapter text contains explicit chapter number references: ${unique.map(r => `"${r}"`).join(", ")}. Characters do not know they are in a numbered chapter.`
        : `正文中出现了章节号指称：${unique.map(r => `"${r}"`).join("、")}。角色不知道自己在第几章。`,
      suggestion: isEnglish
        ? "Replace with natural references: 'that night', 'when the warehouse burned', 'the incident at the dock'"
        : '改成自然表达："那天晚上"、"仓库出事那次"、"码头上的事"',
    });
  }

  // 8. 作者说教词
  const foundSermons: string[] = [];
  for (const word of SERMON_WORDS) {
    if (content.includes(word)) {
      foundSermons.push(word);
    }
  }
  if (foundSermons.length > 0) {
    violations.push({
      rule: "作者说教",
      severity: "warning",
      description: `出现说教词：${foundSermons.map(w => `"${w}"`).join("、")}`,
      suggestion: "删除说教词，让读者自己从情节中判断",
    });
  }

  // 8.5. 角色说明感 / 情绪直说 / 完美决策
  const characterExpositionMatch = findRegexEvidence(content, CHARACTER_EXPOSITION_PATTERNS);
  if (characterExpositionMatch) {
    violations.push({
      rule: "character-exposition",
      severity: "error",
      description: `出现说明式内心/解释性判断："${characterExpositionMatch}"`,
      suggestion: "重写该段：删掉解释句，改用动作、停顿、感知或行为变化来体现人物判断。",
    });
  }

  const emotionTellingMatch = findRegexEvidence(content, EMOTION_TELLING_PATTERNS);
  if (emotionTellingMatch) {
    violations.push({
      rule: "emotion-telling",
      severity: "error",
      description: `出现直接情绪结论："${emotionTellingMatch}"`,
      suggestion: "不要直接给情绪下定义；改写成呼吸、手势、目光、步伐、停顿等外化反应。",
    });
  }

  const worldExpositionMatch = findRegexEvidence(content, WORLD_EXPOSITION_PATTERNS);
  if (worldExpositionMatch) {
    violations.push({
      rule: "world-exposition",
      severity: "error",
      description: `出现战力规则/世界观解释式旁白："${worldExpositionMatch}"`,
      suggestion: "删掉解释段，把设定信息折进人物当下的后果、风险、动作和压迫里。",
    });
  }

  const cognitiveJumpEvidence = detectCognitiveJump(content);
  if (cognitiveJumpEvidence) {
    violations.push({
      rule: "cognitive-jump",
      severity: "error",
      description: `出现直接认知跳跃，缺少“感知 -> 反应 -> 推断”过程："${cognitiveJumpEvidence}"`,
      suggestion: "重写该段为三步链：先写异常/变化，再写停顿或反应，最后把判断隐含在动作与后续选择里。",
    });
  }

  const actionDensityLowEvidence = detectActionDensityLow(content);
  if (actionDensityLowEvidence) {
    violations.push({
      rule: "action-density-low",
      severity: "warning",
      description: `认知链的行为/感知密度过低："${actionDensityLowEvidence}"`,
      suggestion: "重写该段，至少补到 2 个感知信号 + 1 个行为反应，不要只靠单一感知或单句动作撑起认知。",
    });
  }

  const perfectDecisionMatch = findRegexEvidence(content, PERFECT_DECISION_PATTERNS);
  if (perfectDecisionMatch) {
    violations.push({
      rule: "perfect-decision",
      severity: "warning",
      description: `角色做出过于完美、无摩擦的决策："${perfectDecisionMatch}"`,
      suggestion: "让角色在关键节点出现一次非最优或情绪驱动选择，保留犹豫、偏差、代价或判断失真。",
    });
  }

  // 9. 全场震惊类集体反应
  for (const pattern of COLLECTIVE_SHOCK_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        rule: "集体反应",
        severity: "warning",
        description: `出现集体反应套话："${match[0]}"`,
        suggestion: "改写成1-2个具体角色的身体反应",
      });
      break;
    }
  }

  // 10. 连续"了"字检查（3句以上连续含"了"）
  const sentences = content
    .split(/[。！？]/)
    .map(s => s.trim())
    .filter(s => s.length > 2);

  let consecutiveLe = 0;
  let maxConsecutiveLe = 0;
  for (const sentence of sentences) {
    if (sentence.includes("了")) {
      consecutiveLe++;
      maxConsecutiveLe = Math.max(maxConsecutiveLe, consecutiveLe);
    } else {
      consecutiveLe = 0;
    }
  }
  if (maxConsecutiveLe >= 6) {
    violations.push({
      rule: "连续了字",
      severity: "warning",
      description: `检测到${maxConsecutiveLe}句连续包含"了"字，节奏拖沓`,
      suggestion: "保留最有力的一个「了」，其余改为无「了」句式",
    });
  }

  // 11. 段落长度检查（手机阅读适配：50-250字/段为宜）
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const longParagraphs = paragraphs.filter(p => p.length > 300);
  if (longParagraphs.length >= 2) {
    violations.push({
      rule: "段落过长",
      severity: "warning",
      description: `${longParagraphs.length}个段落超过300字，不适合手机阅读`,
      suggestion: "长段落拆分为3-5行的短段落，在动作切换或情绪节点处断开",
    });
  }

  violations.push(...detectParagraphShapeWarnings(content, "zh"));

  // 12. Book-level prohibitions
  // Short prohibitions (2-30 chars): exact substring match
  // Long prohibitions (>30 chars): skip — these are conceptual rules for prompt-level enforcement only
  if (bookRules?.prohibitions) {
    for (const prohibition of bookRules.prohibitions) {
      if (prohibition.length >= 2 && prohibition.length <= 30 && content.includes(prohibition)) {
        violations.push({
          rule: "本书禁忌",
          severity: "error",
          description: `出现了本书禁忌内容："${prohibition}"`,
          suggestion: "删除或改写该内容",
        });
      }
    }
  }

  return violations;
}

/**
 * Cross-chapter repetition check.
 * Detects phrases from the current chapter that also appeared in recent chapters.
 */
export function detectCrossChapterRepetition(
  currentContent: string,
  recentChaptersContent: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  if (!recentChaptersContent || recentChaptersContent.length < 100) return [];

  const violations: PostWriteViolation[] = [];
  const isEnglish = language === "en";

  if (isEnglish) {
    // Extract 3-word phrases from current chapter
    const words = currentContent.toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).filter(w => w.length > 2);
    const phraseCounts = new Map<string, number>();
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
    // Check which repeated phrases (2+ in current) also appear in recent chapters
    const recentLower = recentChaptersContent.toLowerCase();
    const crossRepeats: string[] = [];
    for (const [phrase, count] of phraseCounts) {
      if (count >= 2 && recentLower.includes(phrase)) {
        crossRepeats.push(`"${phrase}" (×${count})`);
      }
    }
    if (crossRepeats.length >= 3) {
      violations.push({
        rule: "Cross-chapter repetition",
        severity: "warning",
        description: `${crossRepeats.length} repeated phrases also found in recent chapters: ${crossRepeats.slice(0, 5).join(", ")}`,
        suggestion: "Vary action verbs and descriptive phrases to avoid cross-chapter repetition",
      });
    }
  } else {
    // Chinese: 6-char ngrams
    const chars = currentContent.replace(/[\s\n\r]/g, "");
    const phraseCounts = new Map<string, number>();
    for (let i = 0; i < chars.length - 5; i++) {
      const phrase = chars.slice(i, i + 6);
      if (/^[\u4e00-\u9fff]{6}$/.test(phrase)) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      }
    }
    const recentClean = recentChaptersContent.replace(/[\s\n\r]/g, "");
    const crossRepeats: string[] = [];
    for (const [phrase, count] of phraseCounts) {
      if (count >= 2 && recentClean.includes(phrase)) {
        crossRepeats.push(`"${phrase}"(×${count})`);
      }
    }
    if (crossRepeats.length >= 3) {
      violations.push({
        rule: "跨章重复",
        severity: "warning",
        description: `${crossRepeats.length}个重复短语在近期章节中也出现过：${crossRepeats.slice(0, 5).join("、")}`,
        suggestion: "变换动作描写和场景用语，避免跨章节机械重复",
      });
    }
  }

  return violations;
}

export function detectParagraphLengthDrift(
  currentContent: string,
  recentChaptersContent: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  if (!recentChaptersContent || recentChaptersContent.trim().length === 0) return [];

  const current = analyzeParagraphShape(currentContent, language);
  const recent = analyzeParagraphShape(recentChaptersContent, language);

  if (current.paragraphs.length < 4 || recent.paragraphs.length < 4) return [];
  if (recent.averageLength <= 0 || current.averageLength <= 0) return [];

  const shrinkRatio = current.averageLength / recent.averageLength;
  const shortRatioDelta = current.shortRatio - recent.shortRatio;

  if (shrinkRatio >= 0.6 || current.shortRatio < 0.5 || shortRatioDelta < 0.25) {
    return [];
  }

  const dropPercent = Math.round((1 - shrinkRatio) * 100);

  return [
    language === "en"
      ? {
          rule: "Paragraph density drift",
          severity: "warning",
          description: `Average paragraph length dropped from ${Math.round(recent.averageLength)} to ${Math.round(current.averageLength)} characters (${dropPercent}% shorter) compared with recent chapters.`,
          suggestion: "Let action, observation, and reaction share paragraphs more often instead of cutting every beat into a single short line.",
        }
      : {
          rule: "段落密度漂移",
          severity: "warning",
          description: `当前章平均段长从近期章节的${Math.round(recent.averageLength)}字降到${Math.round(current.averageLength)}字，缩短了${dropPercent}%。`,
          suggestion: "不要把每个动作都切成单独短句；适当把动作、观察和反应并入同一段，恢复段落层次。",
        },
  ];
}

/** English-specific post-write validation rules. */
function validatePostWriteEnglish(
  content: string,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];

  // 1. AI-tell word density (from en-prompt-sections IRON LAW 3)
  const aiTellWords = ["delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "embark", "comprehensive", "nuanced"];
  for (const word of aiTellWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = content.match(regex);
    if (matches && matches.length > Math.ceil(content.length / 3000)) {
      violations.push({
        rule: "AI-tell word density",
        severity: "warning",
        description: `"${word}" appears ${matches.length} times (limit: 1 per 3000 chars)`,
        suggestion: `Replace with a more specific word`,
      });
    }
  }

  // 2. Paragraph overflow (same rule applies to English)
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const longParagraphs = paragraphs.filter((p) => p.length > 500);
  if (longParagraphs.length >= 2) {
    violations.push({
      rule: "Paragraph length",
      severity: "warning",
      description: `${longParagraphs.length} paragraphs exceed 500 characters`,
      suggestion: "Break into shorter paragraphs for readability",
    });
  }

  violations.push(...detectParagraphShapeWarnings(content, "en"));

  // 2.5. Multi-character scene with almost no direct exchange
  const quotedLines = content.match(/"[^"]+"/g) ?? [];
  const englishNames = [...new Set(
    (content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])
      .filter((name) => !ENGLISH_NAME_STOP_WORDS.has(name)),
  )];
  if (englishNames.length >= 2 && quotedLines.length < 2 && content.length >= 120) {
    violations.push({
      rule: "Dialogue pressure",
      severity: "warning",
      description: `Multi-character scene appears to rely on narration with almost no direct exchange (${englishNames.slice(0, 3).join(", ")}).`,
      suggestion: "Add at least one resistance-bearing exchange so characters push back, withhold, or pressure each other directly.",
    });
  }

  // 3. Book-specific prohibitions
  if (bookRules?.prohibitions) {
    for (const prohibition of bookRules.prohibitions) {
      if (prohibition.length >= 2 && prohibition.length <= 50 && content.toLowerCase().includes(prohibition.toLowerCase())) {
        violations.push({
          rule: "Book prohibition",
          severity: "error",
          description: `Found banned content: "${prohibition}"`,
          suggestion: "Remove or rewrite this content",
        });
      }
    }
  }

  // 4. Genre fatigue words
  const fatigueWords = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : genreProfile.fatigueWords;
  for (const word of fatigueWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = content.match(regex);
    if (matches && matches.length > 1) {
      violations.push({
        rule: "Fatigue word",
        severity: "warning",
        description: `"${word}" appears ${matches.length} times (max 1 per chapter)`,
        suggestion: "Vary the vocabulary",
      });
    }
  }

  const characterExpositionMatch = findRegexEvidence(content, CHARACTER_EXPOSITION_PATTERNS);
  if (characterExpositionMatch) {
    violations.push({
      rule: "character-exposition",
      severity: "error",
      description: `Explanation-heavy internal narration detected: "${characterExpositionMatch}"`,
      suggestion: "Rewrite the line through action, pause, sensory detail, or behavior shift instead of explanatory inner summary.",
    });
  }

  const emotionTellingMatch = findRegexEvidence(content, EMOTION_TELLING_PATTERNS);
  if (emotionTellingMatch) {
    violations.push({
      rule: "emotion-telling",
      severity: "error",
      description: `Direct emotion labeling detected: "${emotionTellingMatch}"`,
      suggestion: "Show the emotion through body reaction, dialogue pressure, posture, breath, or changed behavior instead of naming it directly.",
    });
  }

  const worldExpositionMatch = findRegexEvidence(content, WORLD_EXPOSITION_PATTERNS);
  if (worldExpositionMatch) {
    violations.push({
      rule: "world-exposition",
      severity: "error",
      description: `Explanatory worldbuilding / combat-rule narration detected: "${worldExpositionMatch}"`,
      suggestion: "Cut the explanation and fold the rule into consequence, pressure, and concrete action on the page.",
    });
  }

  const cognitiveJumpEvidence = detectCognitiveJump(content);
  if (cognitiveJumpEvidence) {
    violations.push({
      rule: "cognitive-jump",
      severity: "error",
      description: `Direct realization leap detected without perception/reaction process: "${cognitiveJumpEvidence}"`,
      suggestion: "Rewrite the line into perception -> reaction -> implication, instead of jumping straight to the conclusion.",
    });
  }

  const actionDensityLowEvidence = detectActionDensityLow(content);
  if (actionDensityLowEvidence) {
    violations.push({
      rule: "action-density-low",
      severity: "warning",
      description: `Perception/action density is too thin for the realization chain: "${actionDensityLowEvidence}"`,
      suggestion: "Rewrite the chain with at least 2 sensory signals and 1 physical reaction instead of a single cue plus a thin action beat.",
    });
  }

  const perfectDecisionMatch = findRegexEvidence(content, PERFECT_DECISION_PATTERNS);
  if (perfectDecisionMatch) {
    violations.push({
      rule: "perfect-decision",
      severity: "warning",
      description: `Character decision reads too optimal and frictionless: "${perfectDecisionMatch}"`,
      suggestion: "Let the character hesitate, misread, overreact, or make one emotion-driven/non-optimal choice at a key turn.",
    });
  }

  return violations;
}

function detectCognitiveJump(content: string): string | undefined {
  const sentences = content
    .split(/(?<=[。！？!?])\s*|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    if (!COGNITIVE_JUMP_PATTERNS.some((pattern) => pattern.test(sentence))) {
      continue;
    }

    const localWindow = [
      sentences[index - 1],
      sentence,
      sentences[index + 1],
    ].filter((value): value is string => Boolean(value)).join(" ");

    const hasPerception = COGNITIVE_PERCEPTION_PATTERNS.some((pattern) => pattern.test(localWindow));
    const hasReaction = COGNITIVE_REACTION_PATTERNS.some((pattern) => pattern.test(localWindow));

    if (!hasPerception || !hasReaction) {
      return sentence;
    }
  }

  return undefined;
}

function detectActionDensityLow(content: string): string | undefined {
  const sentences = content
    .split(/(?<=[。！？!?])\s*|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (let index = 0; index < sentences.length; index += 1) {
    const localWindow = [
      sentences[index - 1],
      sentences[index],
      sentences[index + 1],
    ].filter((value): value is string => Boolean(value)).join(" ");

    const perceptionMatches = COGNITIVE_PERCEPTION_PATTERNS.flatMap((pattern) =>
      Array.from(localWindow.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)))
        .map((match) => match[0]),
    );
    const uniquePerceptions = [...new Set(perceptionMatches.map((item) => item.trim()))];
    const reactionMatches = COGNITIVE_REACTION_PATTERNS.flatMap((pattern) =>
      Array.from(localWindow.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)))
        .map((match) => match[0]),
    );
    const uniqueReactions = [...new Set(reactionMatches.map((item) => item.trim()))];

    const hasCognitiveIntent = COGNITIVE_JUMP_PATTERNS.some((pattern) => pattern.test(localWindow))
      || (uniquePerceptions.length > 0 && uniqueReactions.length > 0);

    if (!hasCognitiveIntent) {
      continue;
    }

    if (uniquePerceptions.length < 2 || uniqueReactions.length < 1) {
      return sentences[index] ?? localWindow;
    }
  }

  return undefined;
}

function appendParagraphShapeWarnings(
  violations: PostWriteViolation[],
  content: string,
  language: "zh" | "en",
): void {
  const shape = analyzeParagraphShape(content, language);
  if (shape.paragraphs.length < 4) return;

  if (shape.shortParagraphs.length >= 4 && shape.shortRatio >= 0.6) {
    violations.push(
      language === "en"
        ? {
            rule: "Paragraph fragmentation",
            severity: "warning",
            description: `${shape.shortParagraphs.length} of ${shape.paragraphs.length} paragraphs are shorter than ${shape.shortThreshold} characters.`,
            suggestion: "Merge adjacent action, observation, and reaction beats so the chapter does not collapse into one-line paragraphs.",
          }
        : {
            rule: "段落过碎",
            severity: "warning",
            description: `${shape.paragraphs.length}个段落里有${shape.shortParagraphs.length}个不足${shape.shortThreshold}字，段落被切得过碎。`,
            suggestion: "把相邻的动作、观察、反应适当并段，不要每句话都单独起段。",
          },
    );
  }

  if (shape.maxConsecutiveShort >= 3) {
    violations.push(
      language === "en"
        ? {
            rule: "Consecutive short paragraphs",
            severity: "warning",
            description: `${shape.maxConsecutiveShort} short paragraphs appear back to back.`,
            suggestion: "Break the one-beat-per-paragraph rhythm by folding connected beats into fuller paragraphs.",
          }
        : {
            rule: "连续短段",
            severity: "warning",
            description: `连续出现${shape.maxConsecutiveShort}个不足${shape.shortThreshold}字的短段，容易形成短句堆砌。`,
            suggestion: "把连续的碎动作重新编组，至少让一个段落承载完整的动作链或情绪推进。",
          },
    );
  }
}

export function detectParagraphShapeWarnings(
  content: string,
  language: "zh" | "en" = "zh",
): ReadonlyArray<PostWriteViolation> {
  const violations: PostWriteViolation[] = [];
  appendParagraphShapeWarnings(violations, content, language);
  return violations;
}

function isDialogueParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return /^[""「『'《]/.test(trimmed) || /^[""]/.test(trimmed) || /^——/.test(trimmed);
}

function analyzeParagraphShape(content: string, language: "zh" | "en"): ParagraphShape {
  const paragraphs = extractParagraphs(content);
  // Exclude dialogue lines from short paragraph counting — dialogue is naturally short
  const narrativeParagraphs = paragraphs.filter((p) => !isDialogueParagraph(p));
  const shortThreshold = language === "en" ? 120 : 35;
  const shortParagraphs = narrativeParagraphs.filter((paragraph) => paragraph.length < shortThreshold);
  const averageLength = paragraphs.length > 0
    ? paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) / paragraphs.length
    : 0;

  let maxConsecutiveShort = 0;
  let currentConsecutive = 0;
  for (const paragraph of narrativeParagraphs) {
    if (paragraph.length < shortThreshold) {
      currentConsecutive++;
      maxConsecutiveShort = Math.max(maxConsecutiveShort, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }

  return {
    paragraphs,
    shortThreshold,
    shortParagraphs,
    shortRatio: narrativeParagraphs.length > 0 ? shortParagraphs.length / narrativeParagraphs.length : 0,
    averageLength,
    maxConsecutiveShort,
  };
}

function extractParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => paragraph !== "---")
    .filter((paragraph) => !paragraph.startsWith("#"));
}

function extractEndingRegion(content: string): string {
  const paragraphs = extractParagraphs(content);
  if (paragraphs.length === 0) {
    return content.trim();
  }
  return paragraphs.slice(-3).join("\n\n");
}

function detectResourceMatches(
  content: string,
  rule: (typeof RESOURCE_SIGNAL_RULES)[number],
): ResourceLedgerFinding[] {
  const findings: ResourceLedgerFinding[] = [];
  for (const pattern of rule.patterns) {
    for (const match of content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      const evidence = snippetAround(content, match.index ?? 0, (match[0] ?? "").length);
      if (isNegatedSnippet(evidence)) {
        continue;
      }
      findings.push({
        kind: rule.kind,
        signal: rule.signal,
        matched: false,
        evidence,
        expectedUpdate: rule.expectedUpdate.zh,
      });
    }
  }
  return findings;
}

function evaluateResourceFinding(
  finding: ResourceLedgerFinding,
  params: {
    readonly currentState: string;
    readonly updatedState: string;
    readonly originalLedger: string;
    readonly updatedLedger: string;
    readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
    readonly language: "zh" | "en";
  },
): ResourceLedgerFinding {
  const rule = RESOURCE_SIGNAL_RULES.find((candidate) => candidate.signal === finding.signal);
  if (!rule) {
    return finding;
  }

  const updatedCombined = buildResourceComparisonText(
    params.updatedState,
    params.updatedLedger,
    params.runtimeStateSnapshot,
  );
  const originalCombined = buildResourceComparisonText(
    params.currentState,
    params.originalLedger,
    undefined,
  );
  const stateEvidence = findRegexEvidence(updatedCombined, rule.statePatterns);
  const originalEvidence = findRegexEvidence(originalCombined, rule.statePatterns);
  const numericSignal = extractResourceNumericSignal(finding.evidence);
  const numericMatched = numericSignal
    ? containsNumericSignal(updatedCombined, numericSignal)
    : true;
  const changed = normalizeLooseText(stateEvidence ?? "") !== normalizeLooseText(originalEvidence ?? "");
  const matched = Boolean(stateEvidence) && numericMatched && (changed || !originalEvidence);

  return {
    ...finding,
    matched,
    expectedUpdate: params.language === "en" ? rule.expectedUpdate.en : rule.expectedUpdate.zh,
    ...(stateEvidence ? { stateEvidence } : {}),
  };
}

function buildResourceComparisonText(
  stateMarkdown: string,
  ledgerMarkdown: string,
  runtimeStateSnapshot: RuntimeStateSnapshot | undefined,
): string {
  const snapshotText = runtimeStateSnapshot
    ? JSON.stringify({
      manifest: runtimeStateSnapshot.manifest,
      currentState: runtimeStateSnapshot.currentState,
    }, null, 2)
    : "";
  return [stateMarkdown, ledgerMarkdown, snapshotText]
    .filter((value) => hasMeaningfulLedgerSource(value))
    .join("\n");
}

function hasMeaningfulLedgerSource(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "(文件尚未创建)");
}

function extractResourceNumericSignal(evidence: string): { value: string; unit?: string } | undefined {
  const arabicMatch = evidence.match(/(\d+)\s*(缕|点|成|层|分|丝|滴)?/u);
  if (arabicMatch?.[1]) {
    return {
      value: arabicMatch[1],
      ...(arabicMatch[2] ? { unit: arabicMatch[2] } : {}),
    };
  }

  const chineseMatch = evidence.match(/([一二三四五六七八九十百两]+)\s*(缕|点|成|层|分|丝|滴)?/u);
  if (!chineseMatch?.[1]) {
    return undefined;
  }

  return {
    value: normalizeChineseNumber(chineseMatch[1]),
    ...(chineseMatch[2] ? { unit: chineseMatch[2] } : {}),
  };
}

function containsNumericSignal(content: string, signal: { value: string; unit?: string }): boolean {
  const normalized = normalizeLooseText(content);
  if (!normalized.includes(signal.value)) {
    return false;
  }
  if (!signal.unit) {
    return true;
  }
  return content.includes(signal.unit);
}

function normalizeChineseNumber(value: string): string {
  const mapping: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    百: 100,
  };

  if (value === "十") return "10";
  if (value.length === 2 && value.startsWith("十")) {
    return String(10 + (mapping[value[1]!] ?? 0));
  }
  if (value.length === 2 && value.endsWith("十")) {
    return String((mapping[value[0]!] ?? 0) * 10);
  }
  if (value.length === 3 && value[1] === "十") {
    return String((mapping[value[0]!] ?? 0) * 10 + (mapping[value[2]!] ?? 0));
  }
  return String(mapping[value] ?? 0);
}

function determineBaseResourceWarningRule(
  finding: ResourceLedgerFinding,
): string {
  switch (finding.kind) {
    case "consumption":
      return "resource-ledger-missing-consumption";
    case "recovery":
      return "resource-ledger-missing-recovery";
    case "injury":
      return "resource-ledger-missing-injury-update";
    case "growth":
      return "resource-ledger-missing-growth-update";
    default:
      return "resource-ledger-value-mismatch";
  }
}

function hasNumericResourceMismatch(
  finding: ResourceLedgerFinding,
  updatedState: string,
  updatedLedger: string,
): boolean {
  const numericSignal = extractResourceNumericSignal(finding.evidence);
  if (!numericSignal) {
    return false;
  }
  return !containsNumericSignal([updatedState, updatedLedger].join("\n"), numericSignal);
}

function localizeHookDebtWarning(
  rule: string,
  check: HookDebtCheck,
  language: "zh" | "en",
): string {
  if (language === "en") {
    switch (rule) {
      case "hook-debt-over-cap":
        return `Active hooks ${check.activeCount} exceed the recommended cap of ${check.cap}.`;
      case "hook-debt-too-many-new-hooks":
        return `This chapter opened ${check.newHooksOpened} new hooks under the current debt throttle.`;
      case "hook-debt-no-old-hook-advance":
        return "This chapter did not advance or resolve any older hook debt.";
      case "hook-debt-throttle-violation":
        return "The chapter kept opening new hooks while high debt remained untouched.";
      default:
        return "Hook debt throttle warning.";
    }
  }

  switch (rule) {
    case "hook-debt-over-cap":
      return `当前活跃伏笔数 ${check.activeCount} 已超过建议上限 ${check.cap}。`;
    case "hook-debt-too-many-new-hooks":
      return `本章在高债务状态下仍新开了 ${check.newHooksOpened} 条伏笔。`;
    case "hook-debt-no-old-hook-advance":
      return "本章没有推进或回收任何旧伏笔。";
    case "hook-debt-throttle-violation":
      return "高债务状态下，本章仍主要在开新坑而没有处理旧债。";
    default:
      return "伏笔节流警告。";
  }
}

function findRegexEvidence(content: string, patterns: ReadonlyArray<RegExp>): string | undefined {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.index !== undefined) {
      return snippetAround(content, match.index, match[0].length);
    }
  }
  return undefined;
}

function findPayoffEvidence(
  content: string,
  expectedPayoff: string,
  payoffDirective?: Pick<PayoffDirective, "payoffType" | "promisedPayoff">,
): { evidence?: string; matchLevel: "none" | "partial" | "full" } {
  const materializedEvidence = payoffDirective
    ? findMaterializedPayoffEvidence(content, payoffDirective)
    : undefined;
  if (materializedEvidence) {
    return { evidence: materializedEvidence, matchLevel: "full" };
  }

  const normalizedExpected = normalizeLooseText(expectedPayoff);
  const normalizedContent = normalizeLooseText(content);
  if (normalizedExpected && normalizedContent.includes(normalizedExpected)) {
    const index = normalizedContent.indexOf(normalizedExpected);
    const snippet = snippetAround(content, mapLooseIndexToRaw(content, index), expectedPayoff.length);
    if (!isNegatedSnippet(snippet)) {
      return { evidence: snippet, matchLevel: "full" };
    }
  }

  const keywords = extractPayoffKeywords(expectedPayoff);
  if (keywords.length === 0) {
    return findPartialEscapeProgressEvidence(content, expectedPayoff);
  }

  const matched = keywords.filter((keyword) => {
    const rawIndex = content.indexOf(keyword);
    if (rawIndex < 0) return false;
    return !isNegatedSnippet(snippetAround(content, rawIndex, keyword.length));
  });
  const threshold = keywords.length >= 3 ? 2 : 1;
  if (matched.length < threshold) {
    return findPartialEscapeProgressEvidence(content, expectedPayoff);
  }

  const lead = matched[0]!;
  const rawIndex = content.indexOf(lead);
  return {
    evidence: rawIndex >= 0 ? snippetAround(content, rawIndex, lead.length) : matched.join(" / "),
    matchLevel: "full",
  };
}

function findMaterializedPayoffEvidence(
  content: string,
  payoffDirective: Pick<PayoffDirective, "payoffType" | "promisedPayoff">,
): string | undefined {
  const snippets = content.split(/[\n。！？!?]/u).map((line) => line.trim()).filter(Boolean);
  const promiseKeywords = extractPayoffKeywords(payoffDirective.promisedPayoff);
  const materializationPatterns = getPayoffMaterializationPatterns(payoffDirective.payoffType);

  return snippets.find((snippet) => {
    if (isNegatedSnippet(snippet)) {
      return false;
    }
    const hasMaterialization = materializationPatterns.some((pattern) => pattern.test(snippet));
    if (!hasMaterialization) {
      return false;
    }
    return promiseKeywords.length === 0 || promiseKeywords.some((keyword) => snippet.includes(keyword));
  });
}

export function evaluatePayoffImpact(
  content: string,
  chapterGoal: Pick<ChapterGoal, "payoffToDeliver" | "payoffDirective">,
): PayoffImpactCheck | undefined {
  const payoffDirective = chapterGoal.payoffDirective ?? {
    promisedPayoff: chapterGoal.payoffToDeliver,
    payoffType: inferPayoffTypeFromPromise(chapterGoal.payoffToDeliver),
  };
  const payoffMatch = findPayoffEvidence(content, chapterGoal.payoffToDeliver, payoffDirective);
  if (payoffMatch.matchLevel === "none") {
    return undefined;
  }

  const segment = extractPayoffImpactSegment(content, payoffMatch.evidence);
  const sensoryEvidence = findRegexEvidence(segment, PAYOFF_IMPACT_SENSORY_PATTERNS);
  const resourceTriggerEvidence = payoffDirective.payoffType === "resource"
    ? findRegexEvidence(segment, PAYOFF_RESOURCE_TRIGGER_PATTERNS)
    : undefined;
  const resourceFlatEvidence = payoffDirective.payoffType === "resource"
    ? findRegexEvidence(segment, PAYOFF_RESOURCE_FLAT_PATTERNS)
    : undefined;
  const momentEvidence = findRegexEvidence(segment, PAYOFF_IMPACT_MOMENT_PATTERNS);
  const costEvidence = findRegexEvidence(segment, PAYOFF_IMPACT_COST_PATTERNS);
  const impactEvidence = findRegexEvidence(segment, PAYOFF_IMPACT_RESULT_PATTERNS);
  const payoffSentences = segment
    .split(/(?<=[。！？!?])\s*|\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const momentSentenceIndex = payoffSentences.findIndex((sentence) =>
    PAYOFF_IMPACT_MOMENT_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
  const momentAtEnding = momentSentenceIndex >= 0 && momentSentenceIndex === payoffSentences.length - 1;
  const postMomentText = momentSentenceIndex >= 0
    ? payoffSentences.slice(momentSentenceIndex + 1).join(" ")
    : "";
  const postMomentResolutionEvidence = postMomentText
    ? findRegexEvidence(postMomentText, PAYOFF_POST_MOMENT_RESOLUTION_PATTERNS)
    : undefined;
  const postMomentResolutionMatched = Boolean(postMomentResolutionEvidence);
  const evidence = postMomentResolutionEvidence ?? momentEvidence ?? sensoryEvidence ?? costEvidence ?? impactEvidence ?? payoffMatch.evidence;

  return {
    expectedPayoff: payoffDirective.promisedPayoff,
    payoffType: payoffDirective.payoffType,
    matched: Boolean(
      sensoryEvidence
      && (payoffDirective.payoffType !== "resource" || resourceTriggerEvidence)
      && momentEvidence
      && costEvidence
      && impactEvidence
      && !momentAtEnding
      && postMomentResolutionMatched,
    ),
    sensoryMatched: Boolean(sensoryEvidence),
    resourceTriggerMatched: Boolean(resourceTriggerEvidence),
    resourceFlatMatched: Boolean(resourceFlatEvidence && !resourceTriggerEvidence),
    momentMatched: Boolean(momentEvidence),
    postMomentResolutionMatched,
    momentAtEnding,
    costMatched: Boolean(costEvidence),
    impactMatched: Boolean(impactEvidence),
    ...(evidence ? { evidence } : {}),
  };
}

export function toPayoffImpactWarnings(
  check: PayoffImpactCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check || check.matched) {
    return [];
  }

  if (check.payoffType === "resource" && check.resourceFlatMatched) {
    return [{
      rule: "payoff-resource-flat",
      severity: "warning",
      description: language === "en"
        ? "The resource payoff is written as a smooth state/result instead of a sharp acquisition event."
        : "资源型 payoff 被写成平滑结果，而不是带触发与爆点的获取事件。",
      suggestion: language === "en"
        ? "Rewrite the whole payoff beat as an acquisition event with trigger -> MOMENT -> cost -> stabilization, instead of 'he got it' or 'the information appeared in his mind'."
        : "重写整个资源 payoff 段，改成 trigger -> MOMENT -> 代价 -> 收束 的获取事件，不要直接写“他获得了”或“信息出现在脑海”。",
    }];
  }

  if (!check.costMatched && check.sensoryMatched && check.impactMatched) {
    return [{
      rule: "payoff-impact-missing.cost",
      severity: "warning",
      description: language === "en"
        ? "Payoff succeeded but lacks a clear protagonist cost; this reads as painless success."
        : "payoff 已成功但缺少清晰代价层，呈现为“无痛成功”。",
      suggestion: language === "en"
        ? "Rewrite the payoff paragraph to show an explicit cost that hurts the protagonist (injury, resource drain, irreversible change, or relationship cost)."
        : "重写 payoff 段，明确主角付出的代价（受伤、资源骤降、不可逆变化或关系代价）。",
    }];
  }

  if (!check.sensoryMatched && check.costMatched && check.impactMatched) {
    return [{
      rule: "payoff-impact-missing.sensory",
      severity: "warning",
      description: language === "en"
        ? "Payoff happened with cost and result, but lacks vivid sensory detail at the moment of change."
        : "payoff 已有代价层与结果层，但缺少变化瞬间的感知描写。",
      suggestion: language === "en"
        ? "Rewrite the payoff paragraph with concrete visual/tactile/auditory/physiological cues instead of abstract phrasing."
        : "重写 payoff 段，补上视觉/触觉/听觉/生理中的具体感知细节，避免抽象描述。",
    }];
  }

  if (!check.momentMatched && check.sensoryMatched && check.costMatched && check.impactMatched) {
    return [{
      rule: "payoff-impact-missing.moment",
      severity: "warning",
      description: language === "en"
        ? "Payoff has sensory/cost/result but misses a sharp turning instant."
        : "payoff 已有感知/代价/结果，但缺少“瞬间爆发点”。",
      suggestion: language === "en"
        ? "Rewrite the payoff paragraph with a single sharp turning instant (e.g., 'in that instant', sudden break, or explicit pivot)."
        : "重写 payoff 段，加入明确瞬间断点（如“那一瞬间/突然/就在这一刻”或清晰转折断裂）。",
    }];
  }

  if (check.momentMatched && check.momentAtEnding) {
    return [{
      rule: "payoff-ending-overlap",
      severity: "warning",
      description: language === "en"
        ? "The payoff MOMENT is placed at the chapter tail with no post-moment stabilization."
        : "payoff 的 MOMENT 落在章节尾部，缺少爆点后的收束阶段。",
      suggestion: language === "en"
        ? "Rewrite the payoff paragraph to follow buildup -> MOMENT -> post-moment resolution, and avoid ending on the MOMENT sentence."
        : "重写 payoff 段为 buildup -> MOMENT -> post-moment resolution，并避免用 MOMENT 句直接收章。",
    }];
  }

  if (check.momentMatched && !check.postMomentResolutionMatched && check.sensoryMatched && check.costMatched && check.impactMatched) {
    return [{
      rule: "payoff-ending-overlap",
      severity: "warning",
      description: language === "en"
        ? "Payoff has a turning MOMENT but lacks a clear stabilization phase after it."
        : "payoff 有爆点 MOMENT，但 MOMENT 之后没有明确收束。",
      suggestion: language === "en"
        ? "Add a post-moment resolution beat that stabilizes the situation after the turning instant."
        : "在 MOMENT 后补写清晰收束段，让局势稳定下来。",
    }];
  }

  const missingParts = [
    check.sensoryMatched ? undefined : (language === "en" ? "sensory detail" : "感知层"),
    check.momentMatched ? undefined : (language === "en" ? "turning instant" : "瞬间爆发点"),
    check.postMomentResolutionMatched ? undefined : (language === "en" ? "post-moment resolution" : "爆点后收束"),
    check.costMatched ? undefined : (language === "en" ? "cost paid" : "代价层"),
    check.impactMatched ? undefined : (language === "en" ? "visible situation change" : "结果层"),
  ].filter(Boolean).join(language === "en" ? ", " : "、");

  return [{
    rule: "payoff-impact-missing",
    severity: "warning",
    description: language === "en"
      ? `Payoff happened but lacks impact layers (${missingParts}).`
      : `payoff 已发生但缺少关键冲击层（${missingParts}）。`,
    suggestion: language === "en"
      ? "Rewrite the payoff paragraph as a full impact beat: add sensory detail, explicit cost paid, and a visible shift in the situation."
      : "重写 payoff 段为完整冲击段：补齐感知细节、明确代价、以及可见局势变化。",
  }];
}

function extractPayoffImpactSegment(content: string, evidence: string | undefined): string {
  const paragraphs = extractParagraphs(content);
  if (paragraphs.length === 0) {
    return content;
  }
  if (!evidence) {
    return extractEndingRegion(content);
  }

  const index = paragraphs.findIndex((paragraph) => paragraph.includes(evidence));
  if (index < 0) {
    return extractEndingRegion(content);
  }
  const start = Math.max(0, index - 1);
  const end = Math.min(paragraphs.length, index + 2);
  return paragraphs.slice(start, end).join("\n\n");
}

function evaluatePayoffOverrelease(input: {
  readonly content: string;
  readonly payoffDirective: Pick<PayoffDirective, "payoffType" | "payoffDepth" | "promisedPayoff">;
  readonly payoffCheck: { readonly matchLevel: "none" | "partial" | "full" };
}): { matched: boolean; evidence?: string } {
  const payoffDepth = input.payoffDirective.payoffDepth ?? "layered";
  if (input.payoffDirective.payoffType !== "reveal" || payoffDepth !== "layered") {
    return { matched: false };
  }
  if (input.payoffCheck.matchLevel !== "full") {
    return { matched: false };
  }

  const snippets = input.content
    .split(/[\n。！？!?]/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const revealSnippets = snippets.filter((snippet) =>
    /身份|是谁|来源|来历|下落|去向|真相|原因|为何|为什么|如何|origin|identity|whereabouts|truth|reason|why|how/i.test(snippet),
  );
  const unresolvedEvidence = snippets.find((snippet) =>
    PAYOFF_OVERRELEASE_UNKNOWN_PATTERNS.some((pattern) => pattern.test(snippet)),
  );
  const closureEvidence = revealSnippets.find((snippet) =>
    PAYOFF_OVERRELEASE_CLOSURE_PATTERNS.some((pattern) => pattern.test(snippet)),
  );
  const layeredSignals = [
    /身份|是谁|血脉|父母|identity|who|lineage|parent/i.test(input.content),
    /下落|去向|在哪|whereabouts|where/i.test(input.content),
    /为什么|为何|原因|如何|why|reason|how/i.test(input.content),
  ].filter(Boolean).length;
  const overReleasedByDensity = layeredSignals >= 3 && revealSnippets.length >= 1;
  const overReleasedByClosure = Boolean(closureEvidence);

  if ((overReleasedByDensity || overReleasedByClosure) && !unresolvedEvidence) {
    return {
      matched: true,
      evidence: closureEvidence ?? revealSnippets[0],
    };
  }

  return { matched: false };
}

function getPayoffMaterializationPatterns(
  payoffType: PayoffDirective["payoffType"],
): ReadonlyArray<RegExp> {
  switch (payoffType) {
    case "reveal":
      return [/来自|源于|原来是|真正来源|真实来源|缺失三页|revealed|came from|origin|source|truth|identity/i];
    case "resource":
      return [/拿到|获得|夺得|到手|交给|搜出|got|gained|obtained|secured|claimed/i];
    case "breakthrough":
      return [/突破|晋阶|掌握|学会|压住|稳住|觉醒|broke through|mastered|awakened|stabilized/i];
    case "relationship":
      return [/信任|和解|结盟|坦白|承认|trust|reconcile|alliance|confessed|bond/i];
    case "reversal":
    default:
      return [/反杀|逆转|调头|反转|逼退|turned the tables|reversal|countered|drove back/i];
  }
}

function extractPayoffKeywords(text: string): string[] {
  const english = (text.match(/\b[a-z]{4,}\b/gi) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !ENGLISH_PAYOFF_STOPWORDS.has(word));
  const chinese = (text.match(/[\u4e00-\u9fff]{2,12}/gu) ?? [])
    .flatMap((phrase) => buildChinesePayoffFragments(phrase));
  return [...new Set([...english, ...chinese])];
}

function buildChinesePayoffFragments(phrase: string): string[] {
  const cleaned = phrase.trim();
  if (cleaned.length < 2) return [];
  if (CHINESE_PAYOFF_STOPWORDS.has(cleaned)) return [];

  const fragments = new Set<string>();
  if (cleaned.length <= 4) {
    fragments.add(cleaned);
  } else {
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= cleaned.length - size; index += 1) {
        const fragment = cleaned.slice(index, index + size);
        if (!CHINESE_PAYOFF_STOPWORDS.has(fragment)) {
          fragments.add(fragment);
        }
      }
    }
  }

  return [...fragments];
}

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, "");
}

function mapLooseIndexToRaw(raw: string, normalizedIndex: number): number {
  if (normalizedIndex <= 0) return 0;

  let count = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (/[\p{L}\p{N}\u4e00-\u9fff]/u.test(char)) {
      if (count === normalizedIndex) {
        return index;
      }
      count += 1;
    }
  }

  return Math.max(0, raw.length - 1);
}

function snippetAround(content: string, start: number, length: number): string {
  const safeStart = Math.max(0, start - 24);
  const safeEnd = Math.min(content.length, start + length + 24);
  return content.slice(safeStart, safeEnd).replace(/\s+/g, " ").trim();
}

function isNegatedSnippet(value: string): boolean {
  return /没有|未能|未曾|未|还没|没能|并未|尚未|不能|无力|not\b|did not|didn't|without\b|failed to/i.test(value);
}

const ENGLISH_NAME_STOP_WORDS = new Set([
  "The",
  "And",
  "But",
  "When",
  "While",
  "After",
  "Before",
  "Even",
  "Then",
  "They",
]);

const ENGLISH_PAYOFF_STOPWORDS = new Set([
  "first",
  "deliver",
  "reader",
  "chapter",
  "concrete",
  "immediate",
  "before",
  "after",
]);

const CHINESE_PAYOFF_STOPWORDS = new Set([
  "第一次",
  "本章",
  "读者",
  "回报",
  "即时",
  "获得",
  "拿到",
  "一个",
  "关键",
  "线索",
  "资源",
  "小胜",
]);

const CHINESE_TITLE_STOP_WORDS = new Set([
  "这次",
  "正文",
  "标题",
  "重复",
  "不同",
  "完全",
  "只是",
  "碰巧",
  "没有",
  "回头",
]);

const CHINESE_TITLE_STOP_CHARS = new Set(["的", "了", "着", "一", "只", "从", "在", "和", "与", "把", "被", "有", "没", "里", "又", "才"]);

/**
 * Detect duplicate or near-duplicate chapter titles.
 * Compares the new title against existing chapter titles from index.
 */
export function detectDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
): ReadonlyArray<PostWriteViolation> {
  if (!newTitle.trim()) return [];

  const normalized = newTitle.trim().toLowerCase();
  const violations: PostWriteViolation[] = [];

  for (const existing of existingTitles) {
    const existingNorm = existing.trim().toLowerCase();
    if (!existingNorm) continue;

    // Exact match
    if (normalized === existingNorm) {
      violations.push({
        rule: "duplicate-title",
        severity: "warning",
        description: `章节标题"${newTitle}"与已有章节标题完全相同`,
        suggestion: "更换一个不同的章节标题",
      });
      break;
    }

    // Near-duplicate: one is substring of the other, or only differs by punctuation/numbers
    const stripPunct = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
    if (stripPunct(normalized) === stripPunct(existingNorm)) {
      violations.push({
        rule: "near-duplicate-title",
        severity: "warning",
        description: `章节标题"${newTitle}"与已有标题"${existing}"高度相似`,
        suggestion: "避免使用相似的章节标题",
      });
      break;
    }
  }

  return violations;
}

export function resolveDuplicateTitle(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en" = "zh",
  options?: {
    readonly content?: string;
    readonly chapterGoal?: ChapterGoal;
  },
): {
  readonly title: string;
  readonly issues: ReadonlyArray<PostWriteViolation>;
} {
  const trimmed = newTitle.trim();
  if (!trimmed) {
    return { title: newTitle, issues: [] };
  }

  const finalizeResolvedTitle = (
    candidateTitle: string,
    issues: ReadonlyArray<PostWriteViolation>,
  ): {
    readonly title: string;
    readonly issues: ReadonlyArray<PostWriteViolation>;
  } => {
    const collapsedAnchor = detectCollapsedTitleAnchor(candidateTitle, existingTitles, language);
    if (!collapsedAnchor) {
      return { title: candidateTitle, issues };
    }

    const fallbackAnchor = detectCollapsedTitleAnchor(trimmed, existingTitles, language);
    if (!fallbackAnchor) {
      const mergedIssues = issues.some((issue) => issue.rule === "title-collapse-warning")
        ? issues
        : [
            ...issues,
            language === "en"
              ? {
                  rule: "title-collapse-warning",
                  severity: "warning" as const,
                  description: `Chapter title "${candidateTitle}" still leans on the collapsed "${collapsedAnchor}" anchor shell.`,
                  suggestion: "Keep the strongest non-collapsed candidate instead of reusing the banned anchor.",
                }
              : {
                  rule: "title-collapse-warning",
                  severity: "warning" as const,
                  description: `章节标题"${candidateTitle}"仍踩中已坍缩的“${collapsedAnchor}”命名锚。`,
                  suggestion: "保留上一个未命中禁锚的强标题，不要回退到这个锚。",
                },
          ];
      return { title: trimmed, issues: mergedIssues };
    }

    return { title: candidateTitle, issues };
  };

  const duplicateIssues = detectDuplicateTitle(trimmed, existingTitles);
  if (duplicateIssues.length > 0) {
    const regenerated = regenerateDuplicateTitle(trimmed, existingTitles, language, options?.content);
    if (
      regenerated
      && !isInvalidTitleReplacement({
        language,
        currentTitle: trimmed,
        replacementTitle: regenerated,
        chapterGoal: options?.chapterGoal,
        recentTitles: existingTitles,
      })
      && detectDuplicateTitle(regenerated, existingTitles).length === 0
    ) {
      return finalizeResolvedTitle(regenerated, duplicateIssues);
    }

    let counter = 2;
    while (counter < 100) {
      const candidate = language === "en"
        ? `${trimmed} (${counter})`
        : `${trimmed}（${counter}）`;
      if (detectDuplicateTitle(candidate, existingTitles).length === 0) {
        return finalizeResolvedTitle(candidate, duplicateIssues);
      }
      counter++;
    }

    return finalizeResolvedTitle(trimmed, duplicateIssues);
  }

  const collapseIssues = detectTitleCollapse(trimmed, existingTitles, language);
  if (collapseIssues.length === 0) {
    return finalizeResolvedTitle(trimmed, []);
  }

  const regenerated = regenerateCollapsedTitle(trimmed, existingTitles, language, options?.content);
  if (
    regenerated
    && !isInvalidTitleReplacement({
      language,
      currentTitle: trimmed,
      replacementTitle: regenerated,
      chapterGoal: options?.chapterGoal,
        recentTitles: existingTitles,
      })
      && detectDuplicateTitle(regenerated, existingTitles).length === 0
      && detectTitleCollapse(regenerated, existingTitles, language).length === 0
  ) {
    return finalizeResolvedTitle(regenerated, collapseIssues);
  }

  return finalizeResolvedTitle(trimmed, collapseIssues);
}

export function evaluateChapterGoalDiscipline(
  content: string,
  chapterGoal: ChapterGoal,
): PostWriteDisciplineChecks {
  const endingRegion = extractEndingRegion(content);
  const endingEvidence = findRegexEvidence(endingRegion, ENDING_HOOK_PATTERNS[chapterGoal.endingHookType]);
  const payoffDirective = chapterGoal.payoffDirective ?? {
    promisedPayoff: chapterGoal.payoffToDeliver,
    payoffType: inferPayoffTypeFromPromise(chapterGoal.payoffToDeliver),
    payoffDepth: "shallow" as const,
    mandatoryByFinalAct: false,
  };
  const payoffMatch = findPayoffEvidence(content, chapterGoal.payoffToDeliver, payoffDirective);
  const payoffOverrelease = evaluatePayoffOverrelease({
    content,
    payoffDirective,
    payoffCheck: payoffMatch,
  });

  return {
    endingHookCheck: {
      expectedType: chapterGoal.endingHookType,
      matched: Boolean(endingEvidence),
      ...(endingEvidence ? { evidence: endingEvidence } : {}),
    },
    payoffCheck: {
      expectedPayoff: payoffDirective.promisedPayoff,
      matched: payoffMatch.matchLevel !== "none",
      matchLevel: payoffMatch.matchLevel,
      payoffType: payoffDirective.payoffType,
      payoffDepth: payoffDirective.payoffDepth,
      overReleased: payoffOverrelease.matched,
      ...(payoffMatch.evidence ? { evidence: payoffMatch.evidence } : {}),
    },
  };
}

export function toDisciplineWarnings(
  checks: PostWriteDisciplineChecks,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const warnings: PostWriteViolation[] = [];

  // Legacy ending-hook-check is intentionally disabled.
  // Ending compliance is governed exclusively by endingType.

  if (!checks.payoffCheck.matched) {
    warnings.push({
      rule: "payoff-missing",
      severity: "error",
      description: language === "en"
        ? `The promised payoff did not happen in this chapter: ${checks.payoffCheck.expectedPayoff}.`
        : `本章 promised payoff 完全未发生：${checks.payoffCheck.expectedPayoff}。`,
      suggestion: language === "en"
        ? "Force a payoff scene now. At minimum, deliver a partial realization in this chapter."
        : "必须立刻补一个 payoff 场景，本章至少要出现部分兑现。",
    });
  }

  if (checks.payoffCheck.overReleased) {
    warnings.push({
      rule: "payoff-overrelease",
      severity: "warning",
      description: language === "en"
        ? "Layered reveal payoff appears over-released in one chapter with no unresolved unknown left."
        : "layered reveal 的 payoff 在一章内释放过量，且没有保留新的未知。",
      suggestion: language === "en"
        ? "Materialize only one reveal layer in this chapter and leave a deeper unknown for the next chapter."
        : "本章只兑现一层揭示，并保留一个更深未知到下一章。",
    });
  }

  return warnings;
}

export function evaluateCadenceDirectiveCompliance(
  content: string,
  chapterIntent: string | undefined,
): CadenceDirectiveCheck | undefined {
  const sceneDirective = extractSceneDirective(chapterIntent);
  if (!sceneDirective || !/Force tension escalation this chapter\./i.test(sceneDirective)) {
    return undefined;
  }

  const expectedTypes = parseForcedCadenceTypes(sceneDirective);
  if (expectedTypes.length === 0) {
    return undefined;
  }

  for (const type of expectedTypes) {
    const evidence = findCadenceEvidence(content, type);
    if (evidence) {
      if (looksLikeBreathingChapter(content)) {
        return { expectedTypes, matched: false, evidence };
      }
      return { expectedTypes, matched: true, evidence };
    }
  }

  return { expectedTypes, matched: false };
}

export function toCadenceDirectiveWarnings(
  check: CadenceDirectiveCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check || check.matched) {
    return [];
  }

  const expected = check.expectedTypes.join(" / ");
  return [{
    rule: "cadence-directive-violation",
    severity: "warning",
    description: language === "en"
      ? `The chapter ignores the forced cadence directive and still reads like a breathing beat instead of ${expected}.`
      : `本章没有兑现强制节奏指令，仍然更像喘息段，而不是 ${expected}。`,
    suggestion: language === "en"
      ? "Rewrite the scene skeleton toward escalation, confrontation, or discovery under threat while keeping the chapter facts."
      : "优先重写场景骨架，把本章拉回升压、对抗或带威胁的信息发现，但保留既有事实。",
  }];
}

export function evaluateMoodCadenceCompliance(
  content: string,
  chapterIntent: string | undefined,
): MoodCadenceCheck | undefined {
  const moodDirective = extractMoodDirective(chapterIntent);
  if (!moodDirective) {
    return undefined;
  }

  const warmthEvidence = findRegexEvidence(content, MOOD_CALM_PATTERNS);
  const combatHits = countPatternHits(content, MOOD_COMBAT_PATTERNS);
  const calmHits = countPatternHits(content, MOOD_CALM_PATTERNS);
  const coverageRatio = measureMoodCoverage(content, MOOD_CALM_PATTERNS);
  const structureOrder = moodDirective.targetMode === "breath"
    ? evaluateMoodStructureOrder(content)
    : {
      frontHalfCombatDominant: false,
      frontHalfCalmCoverageRatio: coverageRatio,
      structureEvidence: undefined as string | undefined,
    };
  const semanticCheck = moodDirective.targetMode === "breath"
    ? evaluateBreathSceneSemantics(content)
    : {
      matched: true,
      failures: [] as Array<"scene1-combat-or-escalation" | "scene1-missing-recovery" | "scene2-missing-interaction" | "scene2-combat-dominant">,
      evidence: undefined as string | undefined,
    };
  const scene1Isolation = moodDirective.targetMode === "breath"
    ? evaluateScene1Isolation(content)
    : {
      matched: true,
      evidence: undefined as string | undefined,
    };

  const dominantMode = combatHits >= Math.max(3, calmHits + 2) ? "combat-heavy" : "mixed";
  const structureMatched = !structureOrder.frontHalfCombatDominant;
  const semanticMatched = semanticCheck.matched;
  const matched = Boolean(warmthEvidence)
    && coverageRatio >= moodDirective.moodCoverageMin
    && dominantMode !== moodDirective.forbidDominantMode
    && structureMatched
    && semanticMatched
    && scene1Isolation.matched;

  return {
    expectedMode: moodDirective.targetMode,
    matched,
    ...(warmthEvidence ? { evidence: warmthEvidence } : {}),
    coverageRatio,
    dominantMode,
    structureMatched,
    frontHalfCombatDominant: structureOrder.frontHalfCombatDominant,
    frontHalfCalmCoverageRatio: structureOrder.frontHalfCalmCoverageRatio,
    ...(structureOrder.structureEvidence ? { structureEvidence: structureOrder.structureEvidence } : {}),
    semanticMatched,
    semanticFailures: semanticCheck.failures,
    ...(semanticCheck.evidence ? { semanticEvidence: semanticCheck.evidence } : {}),
    scene1IsolationMatched: scene1Isolation.matched,
    ...(scene1Isolation.evidence ? { scene1IsolationEvidence: scene1Isolation.evidence } : {}),
  };
}

export function toMoodCadenceWarnings(
  check: MoodCadenceCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check) {
    return [];
  }

  if (check.matched) {
    return [];
  }

  const warnings: PostWriteViolation[] = [{
    rule: "mood-cadence-violation",
    severity: "warning",
    description: language === "en"
      ? `The chapter ignores the required mood downshift and still reads as ${check.dominantMode ?? "combat-heavy"} with only ${Math.round((check.coverageRatio ?? 0) * 100)}% mood coverage.`
      : `本章没有兑现降调 mood directive，整体仍然更像${check.dominantMode === "combat-heavy" ? "高压对抗/战斗主导" : "高压章"}，降调内容占比仅约 ${Math.round((check.coverageRatio ?? 0) * 100)}%。`,
    suggestion: language === "en"
      ? "Only rewrite the local scene layer, keep chapter facts intact, expand or insert breathing material so it covers roughly 25%-35% of the chapter, and reduce combat density so combat-heavy action no longer dominates."
      : "只重写局部场景层，保留章节事实；把扎营、疗伤、路途交谈、轻松互动或人物关系推进内容扩到约 25%-35% 篇幅，并降低战斗密度，避免让高压对抗继续主导整章。",
  }];

  if (check.structureMatched === false) {
    warnings.push({
      rule: "mood-structure-failure",
      severity: "warning",
      description: language === "en"
        ? `The front half remains combat-heavy (${Math.round(((check.frontHalfCalmCoverageRatio ?? 0)) * 100)}% calm coverage), which violates the breath chapter structure order.`
        : `本章前半段仍是战斗主导（降调覆盖约 ${Math.round(((check.frontHalfCalmCoverageRatio ?? 0)) * 100)}%），不符合 breath 章节结构顺序。`,
      suggestion: language === "en"
        ? "Reorder the chapter: complete recovery/dialogue/relationship scenes first, then move to low-intensity forward motion; do not patch by adding rest lines after heavy combat."
        : "请重排章节结构：先写恢复/对话/关系场景，再进入低强度前推；不要用“先战斗后补休整”补丁结构。",
    });
  }

  if (check.scene1IsolationMatched === false) {
    warnings.push({
      rule: "scene1-violation",
      severity: "error",
      description: language === "en"
        ? `The first 30% does not function as a pure recovery/character scene${check.scene1IsolationEvidence ? ` (${check.scene1IsolationEvidence})` : ""}.`
        : `正文前 30% 没有成立为纯恢复/人物场景${check.scene1IsolationEvidence ? `（${check.scene1IsolationEvidence}）` : ""}。`,
      suggestion: language === "en"
        ? "Rewrite the opening 30% only: start with recovery or character interaction, and remove threat, rule pressure, pursuit pressure, storm signals, or conflict escalation from that section."
        : "只重写开头 30%：先写恢复或人物互动，并移除威胁、规则压力、追杀压力、风暴信号或冲突升级。",
    });
  }

  if (check.semanticMatched === false) {
    warnings.push({
      rule: "scene-semantic-failure",
      severity: "warning",
      description: language === "en"
        ? `Scene semantics failed for breath mode (${(check.semanticFailures ?? []).join(", ") || "unknown semantic failure"}).`
        : `breath 模式下 Scene 语义不合格（${(check.semanticFailures ?? []).join("、") || "未知语义失败"}）。`,
      suggestion: language === "en"
        ? "Rewrite Scene1/Scene2 semantically: Scene1 must be recovery/aftershock/environmental grounding without active combat escalation; Scene2 must center interaction/planning/emotional release instead of action."
        : "请按语义重写 Scene1/Scene2：Scene1 必须是恢复/余波/环境与身体状态，不得主动战斗或冲突升级；Scene2 必须是对话/关系/计划/情绪释放，不得战斗主导。",
    });
  }

  return warnings;
}

function evaluateMoodStructureOrder(content: string): {
  readonly frontHalfCombatDominant: boolean;
  readonly frontHalfCalmCoverageRatio: number;
  readonly structureEvidence?: string;
} {
  const normalized = content.trim();
  if (!normalized) {
    return {
      frontHalfCombatDominant: false,
      frontHalfCalmCoverageRatio: 0,
    };
  }
  const frontLength = Math.max(1, Math.floor(normalized.length * 0.6));
  const frontSegment = normalized.slice(0, frontLength);
  const frontCombatHits = countPatternHits(frontSegment, MOOD_COMBAT_PATTERNS);
  const frontCalmHits = countPatternHits(frontSegment, MOOD_CALM_PATTERNS);
  const frontHalfCalmCoverageRatio = measureMoodCoverage(frontSegment, MOOD_CALM_PATTERNS);
  const frontHalfCombatDominant = frontCombatHits >= Math.max(2, frontCalmHits + 1)
    && frontHalfCalmCoverageRatio < 0.2;

  return {
    frontHalfCombatDominant,
    frontHalfCalmCoverageRatio,
    ...(frontHalfCombatDominant
      ? { structureEvidence: snippetAround(frontSegment, 0, Math.min(90, frontSegment.length)) }
      : {}),
  };
}

function evaluateScene1Isolation(content: string): {
  readonly matched: boolean;
  readonly evidence?: string;
} {
  const normalized = content.trim();
  if (!normalized) {
    return {
      matched: false,
      evidence: "empty content",
    };
  }

  const frontLength = Math.max(1, Math.floor(normalized.length * 0.3));
  const firstScene = normalized.slice(0, frontLength);
  const recoveryHits = countPatternHits(firstScene, SCENE1_RECOVERY_PATTERNS);
  const interactionHits = countPatternHits(firstScene, SCENE2_INTERACTION_PATTERNS);
  const pressureEvidence = findRegexEvidence(firstScene, SCENE1_FORBIDDEN_PRESSURE_PATTERNS);
  const hasScene1Purpose = recoveryHits > 0 || interactionHits > 0;

  if (!hasScene1Purpose || pressureEvidence) {
    const reasons = [
      !hasScene1Purpose ? "missing recovery/character interaction" : undefined,
      pressureEvidence ? `forbidden pressure: ${pressureEvidence}` : undefined,
    ].filter((value): value is string => Boolean(value));
    return {
      matched: false,
      evidence: reasons.join("; "),
    };
  }

  return {
    matched: true,
  };
}

function evaluateBreathSceneSemantics(content: string): {
  readonly matched: boolean;
  readonly failures: ReadonlyArray<"scene1-combat-or-escalation" | "scene1-missing-recovery" | "scene2-missing-interaction" | "scene2-combat-dominant">;
  readonly evidence?: string;
} {
  const sceneMap = extractSceneSemanticMap(content);
  const failures: Array<"scene1-combat-or-escalation" | "scene1-missing-recovery" | "scene2-missing-interaction" | "scene2-combat-dominant"> = [];
  const evidence: string[] = [];

  const scene1 = sceneMap.Scene1;
  if (scene1) {
    const scene1Escalation = countPatternHits(scene1, SCENE1_ESCALATION_PATTERNS);
    const scene1Recovery = countPatternHits(scene1, SCENE1_RECOVERY_PATTERNS);
    if (scene1Escalation > 0) {
      failures.push("scene1-combat-or-escalation");
      const snippet = findRegexEvidence(scene1, SCENE1_ESCALATION_PATTERNS);
      if (snippet) evidence.push(`Scene1:${snippet}`);
    }
    if (scene1Recovery === 0) {
      failures.push("scene1-missing-recovery");
      evidence.push("Scene1:missing recovery/aftershock/environment signal");
    }
  }

  const scene2 = sceneMap.Scene2;
  if (scene2) {
    const interactionHits = countPatternHits(scene2, SCENE2_INTERACTION_PATTERNS);
    const combatHits = countPatternHits(scene2, MOOD_COMBAT_PATTERNS);
    if (interactionHits === 0) {
      failures.push("scene2-missing-interaction");
      evidence.push("Scene2:missing dialogue/relationship/planning/emotion signal");
    }
    if (combatHits >= Math.max(2, interactionHits + 1)) {
      failures.push("scene2-combat-dominant");
      const snippet = findRegexEvidence(scene2, MOOD_COMBAT_PATTERNS);
      if (snippet) evidence.push(`Scene2:${snippet}`);
    }
  }

  return {
    matched: failures.length === 0,
    failures,
    ...(evidence.length > 0 ? { evidence: evidence.join(" | ") } : {}),
  };
}

function extractSceneSemanticMap(content: string): Record<"Scene1" | "Scene2" | "Scene3", string> {
  const normalized = content.replace(/\r\n/g, "\n");
  const markers = [
    { scene: "Scene1" as const, regex: /\[(Scene\s*1)\]/i },
    { scene: "Scene2" as const, regex: /\[(Scene\s*2)\]/i },
    { scene: "Scene3" as const, regex: /\[(Scene\s*3)\]/i },
  ];
  const indexes = markers
    .map(({ scene, regex }) => ({ scene, index: normalized.search(regex) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);

  const segments: Record<"Scene1" | "Scene2" | "Scene3", string> = {
    Scene1: "",
    Scene2: "",
    Scene3: "",
  };
  for (let idx = 0; idx < indexes.length; idx += 1) {
    const current = indexes[idx]!;
    const nextStart = idx + 1 < indexes.length ? indexes[idx + 1]!.index : normalized.length;
    segments[current.scene] = normalized.slice(current.index, nextStart);
  }
  return segments;
}

export function evaluateHookEmergenceCompliance(
  content: string,
  chapterIntent: string | undefined,
): HookEmergenceCheck | undefined {
  const directive = extractHookEmergenceDirective(chapterIntent);
  if (!directive?.mustMaterializeHookNow || !directive.targetHookId) {
    return undefined;
  }

  const globalResolveEvidence = findRegexEvidence(content, HOOK_EMERGENCE_RESOLVE_PATTERNS);
  if (globalResolveEvidence) {
    return {
      matched: true,
      targetHookId: directive.targetHookId,
      targetHookState: directive.targetHookState,
      movement: "resolve",
      evidence: globalResolveEvidence,
    };
  }

  const focusKeywords = buildHookEmergenceFocusKeywords(directive);
  const lines = content
    .split(/[\n。！？!?]/u)
    .map((line) => line.trim())
    .filter(Boolean);

  let sawFocusOnlyMention = false;
  for (const line of lines) {
    if (!focusKeywords.some((keyword) => keyword && line.includes(keyword))) {
      continue;
    }

    sawFocusOnlyMention = true;
    if (matchesAny(line, HOOK_EMERGENCE_RESOLVE_PATTERNS)) {
      return {
        matched: true,
        targetHookId: directive.targetHookId,
        targetHookState: directive.targetHookState,
        movement: "resolve",
        evidence: line,
      };
    }
    if (matchesAny(line, HOOK_EMERGENCE_ADVANCE_PATTERNS) && !matchesAny(line, HOOK_EMERGENCE_STALL_PATTERNS)) {
      return {
        matched: true,
        targetHookId: directive.targetHookId,
        targetHookState: directive.targetHookState,
        movement: "advance",
        evidence: line,
      };
    }
    if (matchesAny(line, HOOK_EMERGENCE_PARTIAL_RESOLVE_PATTERNS)) {
      return {
        matched: true,
        targetHookId: directive.targetHookId,
        targetHookState: directive.targetHookState,
        movement: "partial-resolve",
        evidence: line,
      };
    }
  }

  if (focusKeywords.some((keyword) => keyword && content.includes(keyword))) {
    const resolveEvidence = findRegexEvidence(content, HOOK_EMERGENCE_RESOLVE_PATTERNS);
    if (resolveEvidence) {
      return {
        matched: true,
        targetHookId: directive.targetHookId,
        targetHookState: directive.targetHookState,
        movement: "resolve",
        evidence: resolveEvidence,
      };
    }
    const advanceEvidence = findRegexEvidence(content, HOOK_EMERGENCE_ADVANCE_PATTERNS);
    if (advanceEvidence && !matchesAny(advanceEvidence, HOOK_EMERGENCE_STALL_PATTERNS)) {
      return {
        matched: true,
        targetHookId: directive.targetHookId,
        targetHookState: directive.targetHookState,
        movement: matchesAny(advanceEvidence, HOOK_EMERGENCE_PARTIAL_RESOLVE_PATTERNS)
          ? "partial-resolve"
          : "advance",
        evidence: advanceEvidence,
      };
    }
  }

  const fallbackSnippet = sawFocusOnlyMention
    ? findFirstFocusSnippet(content, focusKeywords)
    : undefined;

  return {
    matched: false,
    targetHookId: directive.targetHookId,
    targetHookState: directive.targetHookState,
    ...(fallbackSnippet ? { evidence: fallbackSnippet } : {}),
  };
}

export function toHookEmergenceWarnings(
  check: HookEmergenceCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check || check.matched) {
    return [];
  }

  return [{
    rule: "hook-emergence-failure",
    severity: "warning",
    description: language === "en"
      ? `Overdue hook ${check.targetHookId ?? "unknown"} still has no real state change this chapter.`
      : `逾期 hook ${check.targetHookId ?? "unknown"} 本章仍然没有发生真正的状态变化。`,
    suggestion: language === "en"
      ? "Advance it with a new clue, method, state shift, partial payoff, or full resolution instead of repeating the same danger."
      : "不要只重复旧危险；请给它一个新线索、新方法、新状态变化、部分兑现或直接回收。",
  }];
}

export function evaluateEndingIsomorphism(
  content: string,
  recentChapters: string,
): EndingIsomorphismCheck | undefined {
  const recentEndingRegions = extractRecentEndingRegions(recentChapters);
  if (recentEndingRegions.length === 0) {
    return undefined;
  }

  const currentEnding = extractEndingRegion(content);
  if (!currentEnding.trim()) {
    return undefined;
  }

  const repeatedPhrases = ENDING_ISOMORPHISM_PHRASES
    .filter((candidate) => {
      const currentMatched = candidate.patterns.some((pattern) => pattern.test(currentEnding));
      if (!currentMatched) {
        return false;
      }
      const priorHits = recentEndingRegions.filter((ending) =>
        candidate.patterns.some((pattern) => pattern.test(ending))
      ).length;
      return priorHits >= 2;
    })
    .map((candidate) => candidate.label);

  const currentModes = detectEndingModes(currentEnding);
  const repeatedModes = [...new Set(currentModes.filter((mode) => {
    const priorHits = recentEndingRegions.filter((ending) => detectEndingModes(ending).includes(mode)).length;
    return priorHits >= 2;
  }))];

  const matched = repeatedPhrases.length > 0 || repeatedModes.length > 0;
  const evidence = matched
    ? snippetAround(currentEnding, 0, Math.min(currentEnding.length, 80))
    : undefined;

  return {
    matched: !matched,
    repeatedPhrases,
    repeatedModes,
    ...(evidence ? { evidence } : {}),
  };
}

export function toEndingIsomorphismWarnings(
  check: EndingIsomorphismCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check || check.matched) {
    return [];
  }

  const repeatedSignals = [
    ...check.repeatedPhrases,
    ...check.repeatedModes.map((mode) => `mode:${mode}`),
  ].slice(0, 3).join(" / ");
  return [{
    rule: "ending-isomorphism",
    severity: "warning",
    description: language === "en"
      ? `The closing beat is too close to the recent ending shell${repeatedSignals ? ` (${repeatedSignals})` : ""}.`
      : `章尾收束方式与最近章节过于同构${repeatedSignals ? `（${repeatedSignals}）` : ""}。`,
    suggestion: language === "en"
      ? "Rewrite only the closing paragraphs and rotate the ending mode toward danger cliff, reveal sting, emotional beat, hard decision, short aftermath twist, or unfinished action beat while keeping chapter facts."
      : "只重写结尾段，保留章节事实，并优先轮换到 danger cliff、reveal sting、emotional beat、hard decision、short aftermath twist 或 unfinished action beat 这类不同收束模式。",
  }];
}

export function evaluateEndingTypeCompliance(
  content: string,
  chapterIntent: string | undefined,
): EndingTypeCheck | undefined {
  const expectedType = extractEndingType(chapterIntent);
  if (!expectedType) {
    return undefined;
  }

  const endingRegion = extractEndingRegion(content);
  if (!endingRegion.trim()) {
    return {
      expectedType,
      matched: false,
    };
  }

  if (expectedType === "calm_end") {
    const conflictEvidence = findRegexEvidence(endingRegion, CALM_END_CONFLICT_PATTERNS);
    if (conflictEvidence) {
      return {
        expectedType,
        matched: false,
        evidence: conflictEvidence,
      };
    }
    const calmEvidence = findRegexEvidence(endingRegion, ENDING_TYPE_PATTERNS.calm_end);
    return {
      expectedType,
      matched: Boolean(calmEvidence),
      ...(calmEvidence ? { evidence: calmEvidence } : {}),
    };
  }

  if (expectedType === "unresolved_end") {
    const unresolvedEvidence = findRegexEvidence(endingRegion, ENDING_TYPE_PATTERNS.unresolved_end);
    const questionHint = endingRegion.includes("？") || endingRegion.includes("?");
    return {
      expectedType,
      matched: Boolean(unresolvedEvidence || questionHint),
      ...((unresolvedEvidence ?? (questionHint ? "?" : undefined))
        ? { evidence: unresolvedEvidence ?? "?" }
        : {}),
    };
  }

  const evidence = findRegexEvidence(endingRegion, ENDING_TYPE_PATTERNS[expectedType]);
  return {
    expectedType,
    matched: Boolean(evidence),
    ...(evidence ? { evidence } : {}),
  };
}

export function toEndingTypeWarnings(
  check: EndingTypeCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check || check.matched) {
    return [];
  }

  return [{
    rule: "ending-type-mismatch",
    severity: "error",
    description: language === "en"
      ? `Ending does not satisfy expected endingType: ${check.expectedType}.`
      : `章尾没有兑现预期 endingType：${check.expectedType}。`,
    suggestion: language === "en"
      ? "Rewrite only the final 2-3 paragraphs to match the assigned ending type while preserving chapter facts."
      : "只重写最后 2-3 段，使其符合分配的 endingType，同时保持章节事实不变。",
  }];
}

function findPartialEscapeProgressEvidence(
  content: string,
  expectedPayoff: string,
): { evidence?: string; matchLevel: "none" | "partial" | "full" } {
  if (!isEscapePayoff(expectedPayoff)) {
    return { matchLevel: "none" };
  }

  const partialPatterns = [
    /暂时甩开追兵|拉开距离|脱离包围|摆脱追踪|冲出封锁|逃出缺口|赢得喘息|暂时安全/u,
    /shook off pursuers|opened a gap|broke free|escaped the cordon|won a brief respite|temporarily safe/i,
  ];
  const evidence = findRegexEvidence(content, partialPatterns);
  if (!evidence || isNegatedEscapeProgressSnippet(evidence)) {
    return { matchLevel: "none" };
  }

  return {
    evidence,
    matchLevel: "partial",
  };
}

function inferPayoffTypeFromPromise(payoff: string): PayoffDirective["payoffType"] {
  if (/真相|来历|来源|身份|揭开|揭示|发现|查明|线索|秘密|origin|source|truth|reveal|identity|clue/i.test(payoff)) {
    return "reveal";
  }
  if (/获得|拿到|夺得|资源|地图|腰牌|卷轴|残卷|药材|灵石|resource|obtain|gain|map|token|scroll/i.test(payoff)) {
    return "resource";
  }
  if (/突破|晋阶|掌握|觉醒|学会|压住|稳住|新能力|breakthrough|master|awaken|stabilize|new ability/i.test(payoff)) {
    return "breakthrough";
  }
  if (/信任|和解|关系|告白|结盟|relationship|trust|bond|reconcile|alliance/i.test(payoff)) {
    return "relationship";
  }
  return "reversal";
}

function extractSceneDirective(chapterIntent: string | undefined): string | undefined {
  if (!chapterIntent) return undefined;
  const match = chapterIntent.match(/## Structured Directives[\s\S]*?- scene:\s*(.+)/i);
  return match?.[1]?.trim();
}

function extractEndingType(chapterIntent: string | undefined): EndingType | undefined {
  if (!chapterIntent) return undefined;
  const match = chapterIntent.match(/## Structured Directives[\s\S]*?- endingType:\s*(reveal_end|unresolved_end|resolution_end|twist_end|calm_end)/i);
  const value = match?.[1]?.trim();
  if (
    value === "reveal_end"
    || value === "unresolved_end"
    || value === "resolution_end"
    || value === "twist_end"
    || value === "calm_end"
  ) {
    return value;
  }
  return undefined;
}

function extractMoodDirective(chapterIntent: string | undefined): MoodDirective | undefined {
  if (!chapterIntent) return undefined;
  const section = chapterIntent.match(/## Structured Directives[\s\S]*?- mood:\s*[\r\n]+((?:\s+- .+\r?\n?)+)/i)?.[1];
  if (!section) {
    return undefined;
  }

  const targetMode = section.match(/targetMode:\s*(calm|breath|warmth|humor)/i)?.[1]?.toLowerCase();
  const quotaRaw = section.match(/requiredSceneQuota:\s*(\d+)/i)?.[1];
  const coverageRaw = section.match(/moodCoverageMin:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i)?.[1];
  const forbidDominantMode = section.match(/forbidDominantMode:\s*(combat-heavy)/i)?.[1];
  const note = section.match(/note:\s*(.+)/i)?.[1]?.trim();
  if (!targetMode || !forbidDominantMode) {
    return undefined;
  }

  return {
    targetMode: targetMode as MoodDirective["targetMode"],
    requiredSceneQuota: quotaRaw ? Number.parseInt(quotaRaw, 10) : 1,
    moodCoverageMin: coverageRaw ? Number.parseFloat(coverageRaw) : 0.3,
    forbidDominantMode: forbidDominantMode as MoodDirective["forbidDominantMode"],
    ...(note ? { note } : {}),
  };
}

function extractHookEmergenceDirective(chapterIntent: string | undefined): {
  readonly mustMaterializeHookNow: boolean;
  readonly targetHookId?: string;
  readonly targetHookState?: string;
  readonly targetHookExpectedPayoff?: string;
  readonly targetHookNotes?: string;
} | undefined {
  if (!chapterIntent) {
    return undefined;
  }
  const section = chapterIntent.match(/## Hook Agenda([\s\S]*?)(?:\n## |\n# |$)/i)?.[1];
  if (!section || !/mustMaterializeHookNow:\s*true/i.test(section)) {
    return undefined;
  }

  const capture = (label: string): string | undefined =>
    section.match(new RegExp(`${label}:\\s*(.+)`, "i"))?.[1]?.trim();

  return {
    mustMaterializeHookNow: true,
    ...(capture("targetHookId") ? { targetHookId: capture("targetHookId") } : {}),
    ...(capture("targetHookState") ? { targetHookState: capture("targetHookState") } : {}),
    ...(capture("targetHookExpectedPayoff") ? { targetHookExpectedPayoff: capture("targetHookExpectedPayoff") } : {}),
    ...(capture("targetHookNotes") ? { targetHookNotes: capture("targetHookNotes") } : {}),
  };
}

function buildHookEmergenceFocusKeywords(directive: NonNullable<ReturnType<typeof extractHookEmergenceDirective>>): string[] {
  const rawCandidates = [
    directive.targetHookId,
    directive.targetHookExpectedPayoff,
    directive.targetHookNotes,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const candidates = rawCandidates.flatMap((value) => {
    const splitTokens = value
      .split(/[\s,，、:：()（）\[\]【】"“”'‘’\-]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const chineseChunks = (value.match(/[\u4e00-\u9fff]{2,}/gu) ?? []).flatMap((chunk) => {
      const pieces = new Set<string>();
      for (let length = 2; length <= Math.min(4, chunk.length); length += 1) {
        for (let index = 0; index <= chunk.length - length; index += 1) {
          pieces.add(chunk.slice(index, index + length));
        }
      }
      return [...pieces];
    });
    const englishWords = value.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [];
    return [...splitTokens, ...chineseChunks, ...englishWords];
  })
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .filter((value) => !/^(hook|target|overdue|must|true|none|chapter|this|advance|resolve)$/i.test(value));

  return [...new Set(candidates)].slice(0, 16);
}

function findFirstFocusSnippet(content: string, keywords: ReadonlyArray<string>): string | undefined {
  if (keywords.length === 0) {
    return undefined;
  }
  const snippets = content.split(/[\n。！？!?]/u).map((line) => line.trim()).filter(Boolean);
  return snippets.find((snippet) => keywords.some((keyword) => keyword && snippet.includes(keyword)));
}

function matchesAny(content: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

function measureMoodCoverage(content: string, patterns: ReadonlyArray<RegExp>): number {
  const paragraphs = extractParagraphs(content);
  if (paragraphs.length === 0) {
    return 0;
  }

  const totalChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (totalChars === 0) {
    return 0;
  }

  const moodChars = paragraphs.reduce((sum, paragraph) => (
    patterns.some((pattern) => pattern.test(paragraph))
      ? sum + paragraph.length
      : sum
  ), 0);

  return moodChars / totalChars;
}

function parseForcedCadenceTypes(
  sceneDirective: string,
): ReadonlyArray<"escalation" | "confrontation" | "discovery-under-threat"> {
  const allowed: Array<"escalation" | "confrontation" | "discovery-under-threat"> = [];
  if (/escalation/i.test(sceneDirective)) allowed.push("escalation");
  if (/confrontation/i.test(sceneDirective)) allowed.push("confrontation");
  if (/discovery-under-threat/i.test(sceneDirective)) allowed.push("discovery-under-threat");
  return allowed;
}

function findCadenceEvidence(
  content: string,
  type: "escalation" | "confrontation" | "discovery-under-threat",
): string | undefined {
  switch (type) {
    case "escalation":
      return findRegexEvidence(content, [
        /逼近|杀机|威胁|封锁|反扑|追兵|危机|爆开|骤然收紧|pressure|threat|closing in|sealed|ambush/i,
      ]);
    case "confrontation":
      return findRegexEvidence(content, [
        /对峙|交锋|厮杀|动手|逼问|喝问|争执| confront|face[- ]off|clash|accuse|lunged/i,
      ]);
    case "discovery-under-threat":
      return findThreatenedDiscoveryEvidence(content);
  }
}

function findThreatenedDiscoveryEvidence(content: string): string | undefined {
  const snippets = content.split(/[\n。！？!?]/u).map((line) => line.trim()).filter(Boolean);
  return snippets.find((snippet) =>
    /(发现|看见|揭开|线索|痕迹|认出|clue|found|discovered|noticed|revealed)/i.test(snippet)
    && /(威胁|追兵|杀机|封锁|危险|逼近|threat|danger|tracked|chase|closing in)/i.test(snippet),
  );
}

function looksLikeBreathingChapter(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;

  const breathingHits = countPatternHits(normalized, [
    /坐在/u,
    /坐下/u,
    /靠着/u,
    /倚着/u,
    /喝汤/u,
    /喝粥/u,
    /分汤/u,
    /包扎/u,
    /疗伤/u,
    /歇着/u,
    /休息/u,
    /喘口气/u,
    /缓了缓/u,
    /静下来/u,
    /火堆/u,
    /炉火/u,
    /夜色软下来/u,
    /平静/u,
    /喘息/u,
    /合作/u,
    /休整/u,
    /恢复/u,
    /资源整理/u,
    /分配药材/u,
    /讨论计划/u,
    /并肩而行/u,
    /结伴深入/u,
    /慢慢推进/u,
    /暂时安全/u,
    /信任加深/u,
    /探索环境/u,
    /交换情报/u,
    /sat by/i,
    /shared broth/i,
    /bandaged/i,
    /rested/i,
    /quietly/i,
    /softened/i,
    /caught a breath/i,
    /by the stove/i,
    /tended wounds/i,
  ]);
  const escalationHits = countPatternHits(normalized, [
    /追兵/u,
    /封锁/u,
    /逼近/u,
    /杀机/u,
    /对峙/u,
    /交锋/u,
    /厮杀/u,
    /喝问/u,
    /爆开/u,
    /闯入/u,
    /扑来/u,
    /围堵/u,
    /危机/u,
    /threat/i,
    /closing in/i,
    /sealed/i,
    /ambush/i,
    /face[- ]off/i,
    /clash/i,
    /lunged/i,
    /stormed in/i,
    /tracked/i,
  ]);
  const dialoguePressureHits = countPatternHits(normalized, [
    /“[^”]{0,20}(站住|交出来|别动|杀|追|滚开|说清楚)[^”]{0,20}”/u,
    /"[^"]{0,30}(stop|hand it over|don't move|speak|drop it)[^"]{0,30}"/i,
  ]);

  const breathingScore = breathingHits;
  const pressureScore = escalationHits + dialoguePressureHits;

  if (breathingScore >= 4) {
    return true;
  }

  return breathingScore >= 3 && pressureScore <= 2;
}

function countPatternHits(content: string, patterns: ReadonlyArray<RegExp>): number {
  return patterns.reduce((total, pattern) => total + countRegexMatches(content, pattern), 0);
}

function countRegexMatches(content: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...content.matchAll(new RegExp(pattern.source, flags))].length;
}

function extractRecentEndingRegions(recentChapters: string): ReadonlyArray<string> {
  if (!recentChapters.trim()) {
    return [];
  }

  return recentChapters
    .split(/\n\s*---\s*\n/u)
    .map((chapter) => extractEndingRegion(chapter))
    .map((ending) => ending.trim())
    .filter(Boolean)
    .slice(-3);
}

function detectEndingModes(endingRegion: string): ReadonlyArray<string> {
  return ENDING_MODE_PATTERNS
    .filter((candidate) => candidate.patterns.some((pattern) => pattern.test(endingRegion)))
    .map((candidate) => candidate.mode);
}

function isEscapePayoff(expectedPayoff: string): boolean {
  return /逃离追捕|逃出追捕|摆脱追捕|甩开追兵|脱离追杀|escape|evade|lose the pursuers|shake off/i.test(expectedPayoff);
}

function isNegatedEscapeProgressSnippet(value: string): boolean {
  return /没有甩开|未能甩开|没能甩开|没有摆脱|未能摆脱|没能摆脱|没有冲出|未能冲出|没能冲出|did not shake off|failed to shake off|failed to break free/i.test(value);
}

export function evaluateResourceLedgerDiscipline(params: {
  readonly content: string;
  readonly currentState: string;
  readonly updatedState: string;
  readonly originalLedger: string;
  readonly updatedLedger: string;
  readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
  readonly language: "zh" | "en";
}): ResourceLedgerCheck {
  const sourcesAvailable = [
    params.currentState,
    params.updatedState,
    params.originalLedger,
    params.updatedLedger,
    params.runtimeStateSnapshot ? JSON.stringify(params.runtimeStateSnapshot.currentState) : "",
  ].some((value) => hasMeaningfulLedgerSource(value));
  if (!sourcesAvailable) {
    return {
      matched: true,
      findings: [],
      warnings: [],
    };
  }

  const findings = RESOURCE_SIGNAL_RULES
    .flatMap((rule) => detectResourceMatches(params.content, rule))
    .filter((finding, index, list) =>
      list.findIndex((candidate) => candidate.kind === finding.kind && candidate.signal === finding.signal) === index,
    )
    .map((finding) => evaluateResourceFinding(finding, params));

  const warnings = [...new Set(findings
    .filter((finding) => !finding.matched)
    .flatMap((finding) => {
      const rules = [determineBaseResourceWarningRule(finding)];
      if (hasNumericResourceMismatch(finding, params.updatedState, params.updatedLedger)) {
        rules.push("resource-ledger-value-mismatch");
      }
      return rules;
    }))];

  return {
    matched: warnings.length === 0,
    findings,
    warnings,
  };
}

export function toResourceLedgerWarnings(
  check: ResourceLedgerCheck,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const warnings: PostWriteViolation[] = [];
  const seen = new Set<string>();

  for (const finding of check.findings.filter((candidate) => !candidate.matched)) {
    const rules = [determineBaseResourceWarningRule(finding)];
    if (check.warnings.includes("resource-ledger-value-mismatch") && hasNumericResourceMismatch(finding, finding.stateEvidence ?? "", "")) {
      rules.push("resource-ledger-value-mismatch");
    }

    for (const rule of rules) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      warnings.push({
        rule,
        severity: "warning" as const,
        description: language === "en"
          ? `Resource/state drift detected for ${finding.signal}: ${finding.expectedUpdate}`
          : `检测到资源/状态可能漏记：${finding.expectedUpdate}`,
        suggestion: language === "en"
          ? `Update the ledger/state to reflect: ${finding.evidence}`
          : `请在状态或账本中补记：${finding.evidence}`,
      });
    }
  }

  return warnings;
}

export function evaluateHookDebtThrottle(params: {
  readonly snapshot?: RuntimeStateSnapshot;
  readonly delta?: RuntimeStateDelta;
  readonly existingHookIds?: ReadonlyArray<string>;
  readonly cap?: number;
}): HookDebtCheck | undefined {
  if (!params.snapshot || !params.delta) {
    return undefined;
  }

  const cap = params.cap ?? 12;
  const activeHooks = params.snapshot.hooks.hooks.filter((hook) => hook.status !== "resolved");
  const activeCount = activeHooks.length;
  const existingIds = new Set(params.existingHookIds ?? []);
  const newHookIds = [...new Set(
    params.delta.hookOps.upsert
      .map((hook) => hook.hookId)
      .filter((hookId) => !existingIds.has(hookId)),
  )];
  const oldHooksAdvanced = new Set([
    ...params.delta.hookOps.resolve,
    ...params.delta.hookOps.defer,
    ...params.delta.hookOps.upsert
      .filter((hook) => existingIds.has(hook.hookId) && hook.lastAdvancedChapter === params.delta!.chapter)
      .map((hook) => hook.hookId),
  ]);

  const newHookCap = activeCount > cap || existingIds.size > cap ? 1 : 2;
  const warnings: string[] = [];
  if (activeCount > cap) {
    warnings.push("hook-debt-over-cap");
  }
  if (newHookIds.length > newHookCap) {
    warnings.push("hook-debt-too-many-new-hooks");
  }
  if ((activeCount >= cap || existingIds.size >= cap) && oldHooksAdvanced.size === 0) {
    warnings.push("hook-debt-no-old-hook-advance");
  }
  if ((activeCount >= cap || existingIds.size >= cap) && newHookIds.length > 0 && oldHooksAdvanced.size === 0) {
    warnings.push("hook-debt-throttle-violation");
  }

  return {
    activeCount,
    cap,
    newHooksOpened: newHookIds.length,
    oldHooksAdvanced: oldHooksAdvanced.size,
    matched: warnings.length === 0,
    warnings,
  };
}

export function toHookDebtWarnings(
  check: HookDebtCheck | undefined,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  if (!check) {
    return [];
  }

  return check.warnings.map((rule) => ({
    rule,
    severity: "warning" as const,
    description: localizeHookDebtWarning(rule, check, language),
    suggestion: language === "en"
      ? "Favor advancing or resolving existing hooks before opening parallel debt."
      : "优先推进或回收旧伏笔，再考虑开新坑。",
  }));
}

function detectTitleCollapse(
  newTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en",
): ReadonlyArray<PostWriteViolation> {
  const collapsedAnchor = detectCollapsedTitleAnchor(newTitle, existingTitles, language);
  if (collapsedAnchor) {
    const anchorPressure = findCollapsedTitleAnchors(existingTitles, language)
      .find((entry) => entry.anchor === collapsedAnchor);

    return [
      language === "en"
        ? {
            rule: "title-collapse-warning",
            severity: "warning",
            description: `Chapter title "${newTitle}" keeps leaning on the recent "${collapsedAnchor}" anchor shell${anchorPressure ? ` (${anchorPressure.count} in a row)` : ""}.`,
            suggestion: "Rename the chapter around a new threat, artifact, enemy, action, cost, or revelation anchor.",
          }
        : {
            rule: "title-collapse-warning",
            severity: "warning",
            description: `章节标题"${newTitle}"仍在沿用近期围绕“${collapsedAnchor}”的命名锚${anchorPressure ? `（已连续 ${anchorPressure.count} 章）` : ""}。`,
            suggestion: "换一个新的 threat、artifact、enemy、action、cost 或 revelation 锚来命名。",
          },
    ];
  }

  const recentTitles = existingTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(-3);
  if (recentTitles.length < 3) {
    return [];
  }

  const cadence = analyzeChapterCadence({
    language,
    rows: [...recentTitles, newTitle].map((title, index) => ({
      chapter: index + 1,
      title,
      mood: "",
      chapterType: "",
    })),
  });
  const titlePressure = cadence.titlePressure;
  if (!titlePressure || titlePressure.pressure !== "high") {
    return [];
  }
  if (!newTitle.includes(titlePressure.repeatedToken)) {
    return [];
  }

  return [
    language === "en"
      ? {
          rule: "title-collapse-warning",
          severity: "warning",
          description: `Chapter title "${newTitle}" keeps leaning on the recent "${titlePressure.repeatedToken}" title shell.`,
          suggestion: "Rename the chapter around a new threat, artifact, enemy, action, cost, or revelation anchor.",
        }
      : {
          rule: "title-collapse-warning",
          severity: "warning",
          description: `章节标题"${newTitle}"仍在沿用近期围绕“${titlePressure.repeatedToken}”的命名壳。`,
          suggestion: "换一个新的 threat、artifact、enemy、action、cost 或 revelation 锚来命名。",
        },
  ];
}

function regenerateDuplicateTitle(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en",
  content?: string,
): string | undefined {
  if (!content || !content.trim()) {
    return undefined;
  }

  const qualifier = language === "en"
    ? extractEnglishTitleQualifier(baseTitle, existingTitles, content)
    : extractChineseTitleQualifier(baseTitle, existingTitles, content);
  if (!qualifier) {
    return undefined;
  }

  return language === "en"
    ? `${baseTitle}: ${qualifier}`
    : `${baseTitle}：${qualifier}`;
}

function regenerateCollapsedTitle(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  language: "zh" | "en",
  content?: string,
): string | undefined {
  if (!content || !content.trim()) {
    return undefined;
  }

  const fresh = language === "en"
    ? extractEnglishTitleQualifier(baseTitle, existingTitles, content)
    : extractChineseTitleQualifier(baseTitle, existingTitles, content);
  if (!fresh) {
    return undefined;
  }

  return fresh === baseTitle ? undefined : fresh;
}

function extractEnglishTitleQualifier(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  content: string,
): string | undefined {
  const blocked = new Set(extractEnglishTitleTerms([baseTitle, ...existingTitles].join(" ")));
  const words = (content.match(/[A-Za-z]{4,}/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !ENGLISH_NAME_STOP_WORDS.has(capitalize(word)))
    .filter((word) => !blocked.has(word));
  const first = words[0];
  if (!first) {
    return undefined;
  }

  const second = words.find((word) => word !== first && !blocked.has(word));
  return second
    ? `${capitalize(first)} ${capitalize(second)}`
    : capitalize(first);
}

function extractChineseTitleQualifier(
  baseTitle: string,
  existingTitles: ReadonlyArray<string>,
  content: string,
): string | undefined {
  const blocked = new Set(extractChineseTitleTerms([baseTitle, ...existingTitles].join("")));
  const strongPatterns = [
    /([\u4e00-\u9fff]{2,8}人的第二张脸)/u,
    /([\u4e00-\u9fff]{2,8}裂开的代价)/u,
    /([\u4e00-\u9fff]{2,8}开始失控)/u,
    /([\u4e00-\u9fff]{2,8}背后的代价)/u,
    /([\u4e00-\u9fff]{2,8}后的活祭者)/u,
    /([\u4e00-\u9fff]{2,8}逼近之时)/u,
  ];

  for (const pattern of strongPatterns) {
    const candidate = content.match(pattern)?.[1]?.trim();
    if (!candidate) continue;
    if (CHINESE_TITLE_STOP_WORDS.has(candidate)) continue;
    if (blocked.has(candidate)) continue;
    if (hasInvalidTitleIntegrity(candidate, "zh")) continue;
    return candidate;
  }

  const segments = content.match(/[\u4e00-\u9fff]+/g) ?? [];

  for (const segment of segments) {
    const condensed = segment.replace(/[的了着一只从在和与把被有没里又才并因而会]/gu, "");
    for (const source of [condensed, segment]) {
      for (let start = 0; start < source.length; start += 1) {
        for (let size = 6; size >= 4; size -= 1) {
          const candidate = source.slice(start, start + size).trim();
          if (candidate.length < 4) continue;
          if (CHINESE_TITLE_STOP_WORDS.has(candidate)) continue;
          if (blocked.has(candidate)) continue;
          if (hasInvalidTitleIntegrity(candidate, "zh")) continue;
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function extractEnglishTitleTerms(text: string): string[] {
  return [...new Set((text.match(/[A-Za-z]{4,}/g) ?? []).map((word) => word.toLowerCase()))];
}

function extractChineseTitleTerms(text: string): string[] {
  const terms = new Set<string>();
  const segments = text.match(/[\u4e00-\u9fff]+/g) ?? [];

  for (const segment of segments) {
    for (let start = 0; start < segment.length; start += 1) {
      for (let size = 2; size <= 4; size += 1) {
        const candidate = segment.slice(start, start + size).trim();
        if (candidate.length < 2) continue;
        if ([...candidate].some((char) => CHINESE_TITLE_STOP_CHARS.has(char))) continue;
        terms.add(candidate);
      }
    }
  }

  return [...terms];
}

function capitalize(word: string): string {
  return word.length === 0 ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`;
}
