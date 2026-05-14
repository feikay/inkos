import type { ArchitectOutput } from "./architect.js";

export type PublishSafetyRiskType =
  | "real_political_figure"
  | "real_political_party"
  | "real_event_mapping"
  | "identity_insult"
  | "book_rule_violation"
  | "rule_precision_warning";

export type PublishSafetyRiskSeverity = "low" | "medium" | "high" | "critical";

export interface PublishSafetyRisk {
  readonly type: PublishSafetyRiskType;
  readonly severity: PublishSafetyRiskSeverity;
  readonly section: string;
  readonly message: string;
  readonly suggestion: string;
}

export interface BookRuleSafetyIntent {
  readonly political: boolean;
  readonly identity: boolean;
}

export interface FoundationSafetyReport {
  readonly risks: ReadonlyArray<PublishSafetyRisk>;
  readonly intent: BookRuleSafetyIntent;
  readonly maxPublishSafetyScore: number;
  readonly maxTotalScore?: number;
}

const REAL_POLITICAL_FIGURE_PATTERNS = [
  /约瑟夫[·・]?拜登/,
  /拜登/,
  /唐纳德[·・]?特朗普/,
  /特朗普/,
  /希拉里|希拉蕊/,
  /奥巴马/,
  /克林顿/,
  /普京/,
  /泽连斯基/,
  /习近平/,
  /马克龙/,
  /梅洛尼/,
  /莫迪/,
  /金正恩/,
  /岸田/,
  /石破/,
  /尹锡悦/,
  /文在寅/,
  /默克尔/,
  /苏纳克/,
  /约翰逊/,
  /\bBiden\b/i,
  /\bTrump\b/i,
  /\bObama\b/i,
  /\bPutin\b/i,
  /\bZelensky\b/i,
  /\bXi Jinping\b/i,
] as const;

const REAL_POLITICAL_PARTY_PATTERNS = [
  /驴党/,
  /象党/,
  /民主党/,
  /共和党/,
  /保守党/,
  /工党/,
  /自民党/,
  /共产党/,
  /纳粹党/,
] as const;

const FICTIONAL_POLITICAL_PARTY_NAMES = [
  "蓝鹰党",
  "赤象党",
  "联邦革新党",
  "自由秩序党",
] as const;

const REAL_EVENT_PATTERNS = [
  /2020\s*大选/,
  /2024\s*大选/,
  /国会山/,
  /俄乌战争/,
  /新冠疫情/,
  /现实政变/,
  /现实暗杀事件/,
  /现实恐袭事件/,
] as const;

const IDENTITY_INSULT_PATTERNS = [
  /黄皮猪/,
  /黄种猪/,
  /黄皮猴子/,
  /黄种猴子/,
  /黑鬼/,
  /白皮猪/,
  /支那/,
  /鬼子/,
  /棒子/,
  /三哥/,
  /绿教/,
  /洋鬼子/,
  /红脖子/,
  /尼哥/,
  /娘炮/,
  /\bnigger\b/i,
  /\bchink\b/i,
  /\bgook\b/i,
  /\bjap\b/i,
  /\bkike\b/i,
  /\bspic\b/i,
  /\bwetback\b/i,
  /\btowelhead\b/i,
] as const;

const POLITICAL_CONTEXT_PATTERN = /总统|竞选|大选|白宫|国会|政党|候选人|美国|美利加|联邦|政治|议员|内阁|选民/;

const POLITICAL_INTENT_PATTERN = /政治敏感|现实政治|政治人物|政治事件|现实映射|现实政党|禁止映射|平行世界虚构|公序良俗/;
const IDENTITY_INTENT_PATTERN = /种族歧视|性别歧视|地域攻击|国籍攻击|宗教攻击|身份羞辱|身份侮辱|公序良俗/;
const OVERBROAD_COUNTRY_RULE_PATTERN = /禁止(?:任何|所有)?现实国家[、,，和及\s]*(?:政党|政治人物|人物|事件).*映射|禁止.*现实国家.*映射/;

type FoundationSafetySection = {
  readonly name: string;
  readonly content: string;
};

export function detectBookRuleSafetyIntent(bookRules: string | undefined): BookRuleSafetyIntent {
  const text = bookRules ?? "";
  return {
    political: POLITICAL_INTENT_PATTERN.test(text),
    identity: IDENTITY_INTENT_PATTERN.test(text),
  };
}

export function detectRealPoliticalFigureMentions(text: string): boolean {
  return REAL_POLITICAL_FIGURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectRealPoliticalPartyMentions(text: string): boolean {
  const sanitized = FICTIONAL_POLITICAL_PARTY_NAMES.reduce(
    (value, name) => value.replaceAll(name, ""),
    text,
  );
  return REAL_POLITICAL_PARTY_PATTERNS.some((pattern) => pattern.test(sanitized));
}

export function detectRealEventMappings(text: string): boolean {
  return REAL_EVENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectHateOrIdentityInsult(text: string): boolean {
  return IDENTITY_INSULT_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildFoundationSafetyContext(foundation: ArchitectOutput): ReadonlyArray<FoundationSafetySection> {
  return [
    { name: "story_bible", content: foundation.storyBible },
    { name: "volume_outline", content: foundation.volumeOutline },
    { name: "book_rules", content: foundation.bookRules },
    { name: "current_state", content: foundation.currentState },
    { name: "pending_hooks", content: foundation.pendingHooks },
    { name: "genre_architecture", content: foundation.genreArchitecture ?? "" },
    { name: "world_engine", content: foundation.worldEngine ?? "" },
    { name: "antagonist_map", content: foundation.antagonistMap ?? "" },
    { name: "motivation_matrix", content: foundation.motivationMatrix ?? "" },
    { name: "first_10_chapter_plan", content: foundation.first10ChapterPlan ?? "" },
  ];
}

export function detectPublishSafetyRisks(foundation: ArchitectOutput): FoundationSafetyReport {
  const intent = detectBookRuleSafetyIntent(foundation.bookRules);
  const sections = buildFoundationSafetyContext(foundation);
  const combinedText = sections.map((section) => section.content).join("\n");
  const hasPoliticalContext = intent.political || POLITICAL_CONTEXT_PATTERN.test(combinedText);
  const risks: PublishSafetyRisk[] = [];

  if (OVERBROAD_COUNTRY_RULE_PATTERN.test(foundation.bookRules)) {
    risks.push({
      type: "rule_precision_warning",
      severity: "low",
      section: "book_rules",
      message: "book_rules 的现实国家禁忌过宽，容易和角色真实国籍/族裔身份设定冲突。",
      suggestion: "建议改为：允许真实国籍/族裔身份作为角色背景，但禁止现实政治人物、现实政党、现实政治事件映射，外国政权/政党/总统/财团必须虚构化。",
    });
  }

  for (const section of sections) {
    if (!section.content.trim()) continue;

    if (hasPoliticalContext && detectRealPoliticalFigureMentions(section.content)) {
      risks.push({
        type: "real_political_figure",
        severity: intent.political ? "critical" : "high",
        section: section.name,
        message: "出现现实政治人物映射风险。",
        suggestion: "请替换为完全虚构人物，例如虚构总统、虚构候选人或虚构门阀代表。",
      });
    }

    if (hasPoliticalContext && detectRealPoliticalPartyMentions(section.content)) {
      risks.push({
        type: "real_political_party",
        severity: intent.political ? "high" : "medium",
        section: section.name,
        message: "出现现实政党或强现实政党映射风险。",
        suggestion: "请改为虚构政党/势力，例如蓝鹰党、赤象党、联邦革新党或自由秩序党。",
      });
    }

    if (hasPoliticalContext && detectRealEventMappings(section.content)) {
      risks.push({
        type: "real_event_mapping",
        severity: intent.political ? "high" : "medium",
        section: section.name,
        message: "出现现实政治事件映射风险。",
        suggestion: "请改为平行世界事件，例如虚构联邦选举、虚构边境战争或虚构政治危机。",
      });
    }

    if (detectHateOrIdentityInsult(section.content)) {
      risks.push({
        type: "identity_insult",
        severity: "critical",
        section: section.name,
        message: "出现针对群体身份的直接羞辱表达。",
        suggestion: "请改为概括性描述，例如“极具歧视性的恶毒话语”，不要直接生成身份羞辱词。",
      });
    }
  }

  const hasPoliticalViolation = risks.some((risk) => (
    risk.type === "real_political_figure"
    || risk.type === "real_political_party"
    || risk.type === "real_event_mapping"
  ));
  const hasIdentityViolation = risks.some((risk) => risk.type === "identity_insult");

  if (intent.political && hasPoliticalViolation) {
    risks.push({
      type: "book_rule_violation",
      severity: "critical",
      section: "book_rules",
      message: "book_rules 已要求现实政治虚构化，但其他骨架违反该禁忌。",
      suggestion: "下一轮必须保留竞选爽点方向，但把政治人物、政党、机构、事件全部虚构化。",
    });
  }

  if (intent.identity && hasIdentityViolation) {
    risks.push({
      type: "book_rule_violation",
      severity: "critical",
      section: "book_rules",
      message: "book_rules 已禁止身份歧视/羞辱表达，但其他骨架违反该禁忌。",
      suggestion: "删除直接身份羞辱表达，改用概括性歧视描写或反派恶意表达的摘要。",
    });
  }

  const hasFigureRisk = risks.some((risk) => risk.type === "real_political_figure");
  const hasInsultRisk = risks.some((risk) => risk.type === "identity_insult");
  const hasPartyOrEventRisk = risks.some((risk) => (
    risk.type === "real_political_party"
    || risk.type === "real_event_mapping"
  ));

  let maxPublishSafetyScore = 100;
  let maxTotalScore: number | undefined;

  if (hasFigureRisk && hasInsultRisk) {
    maxPublishSafetyScore = 45;
    maxTotalScore = 69;
  } else if (hasInsultRisk) {
    maxPublishSafetyScore = 55;
    maxTotalScore = 75;
  } else if (hasFigureRisk) {
    maxPublishSafetyScore = 60;
    maxTotalScore = 79;
  } else if (hasPartyOrEventRisk) {
    maxPublishSafetyScore = 70;
    maxTotalScore = 79;
  }

  if (risks.some((risk) => risk.type === "book_rule_violation")) {
    maxPublishSafetyScore = Math.min(maxPublishSafetyScore, 65);
    maxTotalScore = Math.min(maxTotalScore ?? 79, 79);
  }

  return {
    risks,
    intent,
    maxPublishSafetyScore,
    maxTotalScore,
  };
}
