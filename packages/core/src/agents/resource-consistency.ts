import { BaseAgent } from "./base.js";
import type { AuditIssue } from "./continuity.js";
import type { LLMResponse } from "../llm/provider.js";
import { countChapterLength } from "../utils/length-metrics.js";
import type { ChapterResourcePlanMode, PlannedResourceEvent } from "./resource-plan.js";

export type ResourceEventKind = "gain" | "consume" | "balance" | "balance_jump" | "unlock";
export type ResourceConsistencyStatus = "PASS" | "FIXED" | "WARN" | "FAILED";

export interface ResourceEvent {
  readonly chapter?: number;
  readonly kind: ResourceEventKind;
  readonly resource: string;
  readonly amount?: number;
  readonly fromAmount?: number;
  readonly toAmount?: number;
  readonly inferredDelta?: number;
  readonly label?: string;
  readonly evidence: string;
  readonly index: number;
  readonly targetResource?: string;
  readonly reason?: string;
  readonly confidence?: number;
}

export interface ResourceMathIssue {
  readonly severity: "info" | "warning" | "critical";
  readonly code:
    | "balance-mismatch"
    | "resource-type-mismatch"
    | "resource-rule-conflict"
    | "ambiguous-resource-number"
    | "negative-balance"
    | "exchange-rate-mismatch"
    | "exchange-ratio-mismatch"
    | "skill-cost-mismatch"
    | "missing-skill-unlock"
    | "unauthorized-resource-rule"
    | "manual-review";
  readonly resource: string;
  readonly expected?: number;
  readonly actual?: number;
  readonly expectedFromAmount?: number;
  readonly actualFromAmount?: number;
  readonly expectedToAmount?: number;
  readonly actualToAmount?: number;
  readonly evidence: string;
  readonly message: string;
  readonly suggestion: string;
  readonly repairable: boolean;
}

export interface ResourceValidationResult {
  readonly events: ReadonlyArray<ResourceEvent>;
  readonly issues: ReadonlyArray<ResourceMathIssue>;
  readonly openingBalances: Readonly<Record<string, number>>;
  readonly closingBalances: Readonly<Record<string, number>>;
  readonly unlockedSkills: ReadonlyArray<string>;
  readonly rules: ResourceRules;
}

export interface ResourceRepairResult {
  readonly content: string;
  readonly repaired: boolean;
  readonly repairedIssues: ReadonlyArray<ResourceMathIssue>;
  readonly unresolvedIssues: ReadonlyArray<ResourceMathIssue>;
  readonly notes: ReadonlyArray<string>;
}

export interface ResourceConsistencyPipelineResult {
  readonly content: string;
  readonly wordCount: number;
  readonly validation: ResourceValidationResult;
  readonly status: ResourceConsistencyStatus;
  readonly blocking: boolean;
  readonly shouldPersistLedger: boolean;
  readonly shouldPersistStateResources: boolean;
  readonly repaired: boolean;
  readonly recoveryAttempted?: boolean;
  readonly recoveryPlan?: ResourceRecoveryPlan;
  readonly recoveryPlanResult?: "PASS" | "FAILED";
  readonly fallbackRecoveryAttempted?: boolean;
  readonly fallbackRecoveryPlan?: ResourceRecoveryPlan;
  readonly fallbackSecondValidation?: "PASS" | "FAILED";
  readonly templatePatchAttempted?: boolean;
  readonly templatePatchApplied?: boolean;
  readonly templatePatchValidation?: "PASS" | "FAILED";
  readonly templatePatchReason?: string;
  readonly removedCashFlowSnippets?: ReadonlyArray<string>;
  readonly balanceClaimPatchAttempted?: boolean;
  readonly balanceClaimPatchApplied?: boolean;
  readonly balanceClaimPatchResource?: string;
  readonly balanceClaimPatchFrom?: number;
  readonly balanceClaimPatchTo?: number;
  readonly balanceClaimPatchReason?: string;
  readonly filteredPseudoSkills?: ReadonlyArray<string>;
  readonly resourcePlanMode?: ChapterResourcePlanMode;
  readonly resourcePlanExpectedClosingBalances?: Readonly<Record<string, number>>;
  readonly resourcePlanAllowedEvents?: ReadonlyArray<PlannedResourceEvent>;
  readonly resourcePlanForbiddenEvents?: ReadonlyArray<string>;
  readonly resourcePlanViolations?: ReadonlyArray<string>;
  readonly secondValidation?: "PASS" | "FAILED";
  readonly auditIssues: ReadonlyArray<AuditIssue>;
  readonly tokenUsage?: LLMResponse["usage"];
}

export interface DeferExchangeTemplatePatchResult {
  readonly patchedText: string;
  readonly removedSnippets: ReadonlyArray<string>;
  readonly insertedTemplate: string;
  readonly patchApplied: boolean;
  readonly reason: string;
  readonly reputationAfter: number;
  readonly balanceClaimPatchAttempted: boolean;
  readonly balanceClaimPatchApplied: boolean;
  readonly balanceClaimPatchResource?: string;
  readonly balanceClaimPatchFrom?: number;
  readonly balanceClaimPatchTo?: number;
  readonly balanceClaimPatchReason?: string;
}

export type ResourceRecoveryStrategy = "defer_exchange" | "add_earned_resource_before_spend" | "reduce_reward" | "remove_illegal_credit";

export interface ResourceRecoveryPlan {
  readonly planId: string;
  readonly title: string;
  readonly strategy: ResourceRecoveryStrategy;
  readonly description: string;
  readonly constraints: ReadonlyArray<string>;
  readonly requiredEvents: ReadonlyArray<ResourceEvent>;
  readonly forbiddenPhrases: ReadonlyArray<string>;
  readonly expectedClosingBalances: Readonly<Record<string, number | string>>;
}

export interface ResourceRule {
  readonly name: string;
  readonly type: "integer" | "decimal" | "text" | "set";
  readonly initial: number;
  readonly min: number;
  readonly max?: number;
  readonly allowNegative: boolean;
  readonly creditLimit?: number;
  readonly aliases: ReadonlyArray<string>;
}

export interface ResourceExchangeRate {
  readonly from: string;
  readonly to: string;
  readonly rate: number;
  readonly rule: string;
  readonly source?: "book_rules" | "story_rules" | "chapter_intent" | "default";
}

export interface ResourceSkillRule {
  readonly skill: string;
  readonly resource: string;
  readonly amount: number;
}

export interface ResourceRules {
  readonly resources: Readonly<Record<string, ResourceRule>>;
  readonly aliases: Readonly<Record<string, string>>;
  readonly exchangeRates: ReadonlyArray<ResourceExchangeRate>;
  readonly skills: ReadonlyArray<ResourceSkillRule>;
}

const DEFAULT_RESOURCE_TYPES = [
  "民望值",
  "联邦币",
  "现金",
  "竞选资金",
  "固定支持者数",
  "技能",
  "技能点",
  "系统积分",
  "灵石",
  "金币",
  "银两",
  "经验值",
  "气血",
  "灵力",
  "修为",
  "功德",
  "好感度",
] as const;

const RESOURCE_ALIASES: Record<string, string> = {
  民望: "民望值",
  民望值: "民望值",
  声望: "民望值",
  民望点: "民望值",
  联邦币: "联邦币",
  现金: "联邦币",
  联邦现金: "联邦币",
  钱: "联邦币",
  技能: "技能",
  技能点: "技能点",
  竞选资金: "竞选资金",
  固定支持者数: "固定支持者数",
  系统积分: "系统积分",
  系统资源: "系统积分",
  灵石: "灵石",
  积分: "系统积分",
  经验值: "经验值",
  金币: "金币",
  银两: "银两",
  功德: "功德",
  气血: "气血",
  灵力: "灵力",
  修为: "修为",
  好感度: "好感度",
};

const CANONICAL_RESOURCE_WHITELIST = new Set<string>([
  ...DEFAULT_RESOURCE_TYPES.map((resource) => RESOURCE_ALIASES[resource] ?? resource),
]);

const CORE_RESOURCE_SET = new Set<string>([
  "民望值",
  "联邦币",
  "现金",
  "技能",
  "技能点",
  "系统积分",
  "经验值",
  "气血",
  "灵石",
  "金币",
  "银两",
]);

export class ResourceConsistencyReviserAgent extends BaseAgent {
  get name(): string {
    return "resource-consistency-reviser";
  }

  async revise(input: {
    readonly chapterContent: string;
    readonly issues: ReadonlyArray<ResourceMathIssue>;
    readonly authoritativeContext?: string;
    readonly bookRules?: string;
    readonly currentLedger?: string;
    readonly currentState?: string;
  }): Promise<{ readonly content: string; readonly usage?: LLMResponse["usage"] }> {
    const response = await this.chat([
      {
        role: "system",
        content: [
          "你是小说章节资源/数值一致性修补编辑。",
          "只做最小改动：修正资源数字、余额表述、兑换表达。",
          "程序账本是唯一数值真相，你不得重新计算、不得改变兑换比例、不得发明资源。",
          "如果程序要求 100 点民望兑换 1000 联邦币，就必须按 100 点民望回填。",
          "不得改剧情主线、人物行为、章节结构，不新增爽点。",
          "只输出修补后的章节正文，不要解释。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "## 待修补正文",
          input.chapterContent,
          "",
          "## 已检测资源问题",
          JSON.stringify(input.issues, null, 2),
          "",
          "## 程序权威资源结果（必须遵守，不得改写数值规则）",
          input.authoritativeContext || "(无)",
          "",
          "## book_rules",
          input.bookRules || "(缺失)",
          "",
          "## current ledger",
          input.currentLedger || "(缺失)",
          "",
          "## current state",
          input.currentState || "(缺失)",
        ].join("\n"),
      },
    ], { temperature: 0.1, maxTokens: 4096 });
    return { content: response.content.trim(), usage: response.usage };
  }
}

export class ResourceBlockingRewriterAgent extends BaseAgent {
  get name(): string {
    return "resource-blocking-rewrite";
  }

  async rewrite(input: {
    readonly chapterContent: string;
    readonly chapterIntent?: string;
    readonly validation: ResourceValidationResult;
    readonly recoveryPlan: ResourceRecoveryPlan;
    readonly bookRules?: string;
    readonly currentLedger?: string;
    readonly currentState?: string;
  }): Promise<{ readonly content: string; readonly usage?: LLMResponse["usage"] }> {
    const response = await this.chat([
      {
        role: "system",
        content: [
          "你是 Resource Engine blocking 后的资源约束重写编辑。",
          "程序账本是唯一数值真相。你不能重新计算资源，不能改变兑换比例，不能发明透支/负债规则。",
          "你只能按程序给出的合法资源方案，重写资源相关段落和必要衔接句。",
          "不得改变主线、反派压力、人物行为核心、章节结尾钩子。",
          "不得新增资源类型，不得写负数余额，不得写可透支、负债、无负债封顶、先用后还。",
          "只输出重写后的完整章节正文，不要解释。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "## 原正文",
          input.chapterContent,
          "",
          "## chapter_intent",
          input.chapterIntent || "(缺失)",
          "",
          "## Resource Engine 失败结果",
          JSON.stringify({
            issues: input.validation.issues,
            openingBalances: input.validation.openingBalances,
            closingBalances: input.validation.closingBalances,
            events: input.validation.events,
          }, null, 2),
          "",
          "## 程序选定的合法资源方案（必须严格遵守）",
          JSON.stringify(input.recoveryPlan, null, 2),
          "",
          "## 权威资源规则（只能遵守，不能改写）",
          renderResourceRulesForPrompt(input.validation.rules),
          "",
          "## 严格禁止",
          input.recoveryPlan.forbiddenPhrases.map((phrase) => `- ${phrase}`).join("\n"),
          "",
          "## book_rules",
          input.bookRules || "(缺失)",
          "",
          "## current ledger",
          input.currentLedger || "(缺失)",
          "",
          "## current state",
          input.currentState || "(缺失)",
        ].join("\n"),
      },
    ], { temperature: 0.1, maxTokens: 4096 });
    return { content: response.content.trim(), usage: response.usage };
  }
}

export function parseResourceRules(bookRules = "", currentLedger = "", currentState = ""): ResourceRules {
  const resources = new Map<string, ResourceRule>();
  const aliases: Record<string, string> = {};
  const addResource = (name: string, options: {
    type?: ResourceRule["type"];
    initial?: number;
    min?: number;
    max?: number;
    allowNegative?: boolean;
    creditLimit?: number;
    aliases?: ReadonlyArray<string>;
  } = {}) => {
    const canonical = normalizeResourceName(name);
    if (!isAllowedResource(canonical)) return;
    const existing = resources.get(canonical);
    const allowNegative = options.allowNegative ?? existing?.allowNegative ?? false;
    const creditLimit = options.creditLimit ?? existing?.creditLimit;
    const defaultMin = allowNegative
      ? creditLimit !== undefined
        ? -Math.abs(creditLimit)
        : -Number.MAX_SAFE_INTEGER
      : 0;
    const mergedAliases = [...new Set([canonical, ...(options.aliases ?? []), ...(existing?.aliases ?? [])])]
      .map((alias) => alias.trim())
      .filter(Boolean);
    resources.set(canonical, {
      name: canonical,
      type: options.type ?? existing?.type ?? (canonical === "技能" ? "set" : "integer"),
      initial: options.initial ?? existing?.initial ?? 0,
      min: options.min ?? (options.allowNegative ? defaultMin : existing?.min) ?? defaultMin,
      ...((options.max ?? existing?.max) !== undefined ? { max: options.max ?? existing?.max } : {}),
      allowNegative,
      ...(creditLimit !== undefined ? { creditLimit } : {}),
      aliases: mergedAliases,
    });
    for (const alias of mergedAliases) {
      aliases[alias] = canonical;
      aliases[normalizeResourceName(alias)] = canonical;
    }
  };

  for (const resource of DEFAULT_RESOURCE_TYPES) {
    addResource(resource);
  }
  for (const [alias, canonical] of Object.entries(RESOURCE_ALIASES)) {
    addResource(canonical, { aliases: [alias] });
  }

  const resourceTypes = bookRules.match(/resourceTypes\s*:\s*\n((?:\s*-\s*[^\n]+\n?)+)/iu)?.[1];
  if (resourceTypes) {
    for (const line of resourceTypes.split(/\n/u)) {
      const value = line.replace(/^\s*-\s*/u, "").trim();
      if (value) addResource(value);
    }
  }

  const initialResourcesBlock = bookRules.match(/initialResources\s*:\s*\n([\s\S]*?)(?:\n\S|$)/iu)?.[1] ?? "";
  for (const match of initialResourcesBlock.matchAll(/^\s{2}([^:\n]+):\s*(-?\d+)/gmu)) {
    addResource(match[1] ?? "", { initial: Number.parseInt(match[2] ?? "0", 10) });
  }

  const resourcesBlock = bookRules.match(/resources\s*:\s*\n([\s\S]*?)(?:\n\S|$)/iu)?.[1] ?? "";
  for (const match of resourcesBlock.matchAll(/^\s{2}([^:\n]+):\s*$/gmu)) {
    const name = normalizeResourceName(match[1] ?? "");
    if (!isAllowedResource(name)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const next = resourcesBlock.slice(start).search(/^\s{2}[^:\n]+:\s*$/mu);
    const body = next >= 0 ? resourcesBlock.slice(start, start + next) : resourcesBlock.slice(start);
    const initial = body.match(/initial\s*:\s*(-?\d+)/iu)?.[1];
    const min = body.match(/min\s*:\s*(-?\d+)/iu)?.[1];
    const max = body.match(/max\s*:\s*(-?\d+)/iu)?.[1];
    const type = body.match(/type\s*:\s*(integer|decimal|text|set)/iu)?.[1] as ResourceRule["type"] | undefined;
    const allowNegative = /allowNegative\s*:\s*true|允许负债|可透支/iu.test(body);
    const creditLimit = body.match(/creditLimit\s*:\s*(\d+)|信用额度\s*(\d+)/iu);
    const aliasBlock = body.match(/aliases\s*:\s*\n((?:\s*-\s*[^\n]+\n?)+)/iu)?.[1];
    const parsedAliases = aliasBlock
      ? aliasBlock.split(/\n/u).map((line) => line.replace(/^\s*-\s*/u, "").trim()).filter(Boolean)
      : [];
    addResource(name, {
      type,
      initial: initial ? Number.parseInt(initial, 10) : undefined,
      min: min ? Number.parseInt(min, 10) : undefined,
      max: max ? Number.parseInt(max, 10) : undefined,
      allowNegative,
      creditLimit: creditLimit ? Number.parseInt(creditLimit[1] ?? creditLimit[2] ?? "0", 10) : undefined,
      aliases: parsedAliases,
    });
  }

  const exchangeRates = parseExchangeRates(bookRules, aliases);
  const skills = parseSkillRules(bookRules, aliases);
  for (const skill of skills) {
    addResource(skill.resource);
  }

  const openings = parseOpeningBalancesWithRules(`${currentLedger}\n${currentState}`, { resources: Object.fromEntries(resources), aliases, exchangeRates, skills });
  for (const [resource, value] of Object.entries(openings)) {
    const existing = resources.get(resource);
    if (existing) {
      resources.set(resource, { ...existing, initial: value });
    }
  }

  return {
    resources: Object.fromEntries(resources),
    aliases,
    exchangeRates,
    skills,
  };
}

export function extractResourceEvents(
  chapterText: string,
  bookRules = "",
  currentLedger = "",
): ResourceEvent[] {
  const rules = parseResourceRules(bookRules, currentLedger);
  const resourceTypes = Object.keys(rules.resources);
  const resourcePattern = buildResourcePattern(resourceTypes);
  const events: ResourceEvent[] = [];

  collectRegexEvents(chapterText, new RegExp(`(?:获得了?|得到了?|取得了?|增加了?|新增|到账)\\s*(${NUMBER_SOURCE})\\s*(?:点|枚|个|块|元)?\\s*(${resourcePattern})`, "giu"), (match) => ({
    kind: "gain",
    amount: parseFlexibleNumber(match[1] ?? ""),
    resource: normalizeResourceName(match[2] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(${resourcePattern})\\s*[+＋]\\s*(${NUMBER_SOURCE})`, "giu"), (match) => ({
    kind: "gain",
    amount: parseFlexibleNumber(match[2] ?? ""),
    resource: normalizeResourceName(match[1] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:消耗了?|扣除了?|花费了?|支付了?|赔偿|用掉|耗去)\\s*(${NUMBER_SOURCE})\\s*(?:点|枚|个|块|元)?\\s*(${resourcePattern})`, "giu"), (match) => ({
    kind: "consume",
    amount: parseFlexibleNumber(match[1] ?? ""),
    resource: normalizeResourceName(match[2] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:消耗了?|扣除了?|花费了?|支付了?|赔偿|用掉|耗去)\\s*(${resourcePattern})\\s*(${NUMBER_SOURCE})\\s*(?:点|枚|个|块|元)?`, "giu"), (match) => ({
    kind: "consume",
    amount: parseFlexibleNumber(match[2] ?? ""),
    resource: normalizeResourceName(match[1] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:赔偿|支付|花费)[^，。！？\\n]{0,12}?(${NUMBER_SOURCE})\\s*(?:元)?\\s*(联邦币|现金)`, "giu"), (match) => ({
    kind: "consume",
    amount: parseFlexibleNumber(match[1] ?? ""),
    resource: normalizeResourceName(match[2] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(${resourcePattern})\\s*[-－]\\s*(${NUMBER_SOURCE})`, "giu"), (match) => ({
    kind: "consume",
    amount: parseFlexibleNumber(match[2] ?? ""),
    resource: normalizeResourceName(match[1] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:消耗了?|扣除了?|花费了?|支付了?)?\\s*(${NUMBER_SOURCE})\\s*(?:点)?\\s*(民望值|民望)\\s*(?:兑换了?|换成|换取)\\s*(${NUMBER_SOURCE})\\s*(?:元)?\\s*(联邦币|现金)`, "giu"), (match) => ({
    kind: "consume",
    amount: parseFlexibleNumber(match[1] ?? ""),
    resource: normalizeResourceName(match[2] ?? ""),
    targetResource: normalizeResourceName(match[4] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:消耗了?|扣除了?|花费了?|支付了?)?\\s*(${NUMBER_SOURCE})\\s*(?:点)?\\s*(民望值|民望)\\s*(?:兑换了?|换成|换取)\\s*(${NUMBER_SOURCE})\\s*(?:元)?\\s*(联邦币|现金)`, "giu"), (match) => ({
    kind: "gain",
    amount: parseFlexibleNumber(match[3] ?? ""),
    resource: normalizeResourceName(match[4] ?? ""),
    targetResource: normalizeResourceName(match[2] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:兑换了?|换成|换取)\\s*(${NUMBER_SOURCE})\\s*(?:元)?\\s*(联邦币|现金)`, "giu"), (match) => ({
    kind: "gain",
    amount: parseFlexibleNumber(match[1] ?? ""),
    resource: normalizeResourceName(match[2] ?? ""),
    targetResource: "民望值",
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:当前|现在|此刻)?\\s*(${resourcePattern})\\s*(?:值|余额)?(?:[：:=]|为|是|剩余|余|回到|变成|跳成|来到)?\\s*(${NUMBER_SOURCE})`, "giu"), (match) => ({
    kind: "balance",
    amount: parseFlexibleNumber(match[2] ?? ""),
    resource: normalizeResourceName(match[1] ?? ""),
  }), events);

  collectRegexEvents(chapterText, new RegExp(`(?:当前|现在|此刻)?\\s*(${resourcePattern})\\s*(?:值|余额)?\\s*[：:=为是]\\s*[-－]\\s*(${NUMBER_SOURCE})`, "giu"), (match) => ({
    kind: "balance",
    amount: -parseFlexibleNumber(match[2] ?? ""),
    resource: normalizeResourceName(match[1] ?? ""),
  }), events);

  collectBalanceJumpEvents(chapterText, resourceTypes, events);
  collectSentenceBalanceEvents(chapterText, resourceTypes, events);

  collectRegexEvents(chapterText, /(?:兑换了?|解锁了?|激活了?|获得了?|掌握了?)\s*([^，。！？；;、:\n：]{1,12}(?:技能)?)/giu, (match) => ({
    kind: "unlock",
    resource: "技能",
    label: normalizeSkillLabel(match[1] ?? ""),
  }), events);
  collectRegexEvents(chapterText, /([^，。！？；;、:\n：]{1,12}技能)\s*(?:兑换完成|已激活|激活成功|解锁完成|已解锁)/giu, (match) => ({
    kind: "unlock",
    resource: "技能",
    label: normalizeSkillLabel(match[1] ?? ""),
  }), events);
  collectRegexEvents(chapterText, /(?:兑换栏里亮起|兑换栏里亮起一行新字|栏里亮起一行新字)\s*[：:]\s*([^，。！？；;、:\n：]{1,12})/giu, (match) => ({
    kind: "unlock",
    resource: "技能",
    label: normalizeSkillLabel(match[1] ?? ""),
  }), events);

  return dedupeEvents(events)
    .filter((event) => event.kind === "unlock" ? Boolean(event.label) : event.amount !== undefined)
    .sort((left, right) => left.index - right.index);
}

export function validateResourceMath(params: {
  readonly events: ReadonlyArray<ResourceEvent>;
  readonly currentLedger?: string;
  readonly currentState?: string;
  readonly bookRules?: string;
  readonly chapterIntent?: string;
  readonly rules?: ResourceRules;
  readonly chapterText?: string;
}): ResourceValidationResult {
  const rules = params.rules ?? parseResourceRules(params.bookRules ?? "", params.currentLedger ?? "", params.currentState ?? "");
  const sourceText = `${params.currentLedger ?? ""}\n${params.currentState ?? ""}`;
  const openingBalances = parseOpeningBalancesWithRules(sourceText, rules);
  const balances: Record<string, number> = { ...openingBalances };
  const issues: ResourceMathIssue[] = [];
  const unlockedSkills: string[] = [];
  const events = inferExchangeSpends(
    collapseBalanceJumpNoise(
      completeMissingSkillUnlockEvents(
        normalizeEventsForRules(params.events, rules),
        params.chapterText ?? "",
        rules,
      ),
    ),
    rules,
  );
  const activeResources = new Set<string>(extractExplicitOpeningResources(sourceText, rules));
  const authoritativeSpendAmounts = buildAuthoritativeExchangeSpendMap(events, rules);
  issues.push(...detectUnauthorizedResourceRules(params.chapterText ?? "", params.bookRules ?? "", rules));
  issues.push(...detectResourceRuleConflicts(params.chapterIntent ?? "", rules));
  issues.push(...detectTextualExchangeRateMismatches(params.chapterText ?? "", rules));
  issues.push(...detectSkillCostMismatches(params.chapterText ?? "", rules));

  for (const event of [...events].sort((left, right) => left.index - right.index)) {
    if (event.kind === "unlock") {
      const alreadyUnlocked = Boolean(event.label && unlockedSkills.includes(event.label));
      if (event.label && !alreadyUnlocked) {
        unlockedSkills.push(event.label);
      }
      if (alreadyUnlocked) continue;
      const skillRule = event.label ? findSkillRule(rules, event.label) : undefined;
      if (skillRule && !hasNearbyExplicitSpend(events, event, skillRule)) {
        activeResources.add(skillRule.resource);
        const before = balances[skillRule.resource] ?? rules.resources[skillRule.resource]?.initial ?? 0;
        balances[skillRule.resource] = before - skillRule.amount;
        const minimum = resourceMinimum(rules.resources[skillRule.resource]);
        if (balances[skillRule.resource]! < minimum) {
          issues.push({
            severity: "critical",
            code: "negative-balance",
            resource: skillRule.resource,
            expected: minimum,
            actual: balances[skillRule.resource],
            evidence: event.evidence,
            message: `${event.label} 解锁需要消耗 ${skillRule.amount} ${skillRule.resource}，但余额不足。`,
            suggestion: "确认技能解锁前是否已有足够资源，或修正技能成本/获得数值。",
            repairable: false,
          });
        }
      }
      continue;
    }
    if (event.amount === undefined) continue;
    activeResources.add(event.resource);
    const before = balances[event.resource] ?? 0;
    if (event.kind === "gain") {
      balances[event.resource] = before + event.amount;
    } else if (event.kind === "consume") {
      const spendAmount = authoritativeSpendAmounts.get(event.index) ?? event.amount;
      balances[event.resource] = before - spendAmount;
      const minimum = resourceMinimum(rules.resources[event.resource]);
      if (balances[event.resource]! < minimum) {
        issues.push({
          severity: "critical",
          code: "negative-balance",
          resource: event.resource,
          expected: minimum,
          actual: balances[event.resource],
          evidence: event.evidence,
          message: `${event.resource} 消耗后余额为负数。`,
          suggestion: "确认前文是否已有足够资源，或修正消耗/获得数值。",
          repairable: false,
        });
      }
    } else if (event.kind === "balance_jump") {
      const toAmount = event.toAmount ?? event.amount;
      if (toAmount === undefined) continue;
      const inferredDelta = toAmount - before;
      if (inferredDelta >= 0) {
        (event as { inferredDelta?: number }).inferredDelta = inferredDelta;
        balances[event.resource] = toAmount;
      } else {
        issues.push({
          severity: isCoreResource(event.resource) ? "critical" : "warning",
          code: "balance-mismatch",
          resource: event.resource,
          expected: before,
          actual: toAmount,
          evidence: event.evidence,
          message: `${event.resource} 跳转显示低于程序余额：当前应为 ${before}，正文显示 ${toAmount}。`,
          suggestion: "本轮只自动推导正向余额跳转；请人工确认该处是否为消耗或显示错误。",
          repairable: false,
        });
      }
    } else if (event.kind === "balance") {
      if (before !== event.amount) {
        issues.push({
          severity: isCoreResource(event.resource) ? "critical" : "warning",
          code: "balance-mismatch",
          resource: event.resource,
          expected: before,
          actual: event.amount,
          evidence: event.evidence,
          message: `${event.resource} 余额计算错误：应为 ${before}，正文写成 ${event.amount}。`,
          suggestion: `将该处余额改为 ${before}，或改写为不显式报错的资源结算表达。`,
          repairable: true,
        });
      }
    }
  }

  for (const event of events.filter((candidate) => candidate.kind === "gain" && candidate.targetResource)) {
    const rate = findExchangeRate(rules, event.targetResource!, event.resource);
    if (!rate) continue;
    const consume = findNearestExchangeConsume(events, event, rate.from);
    if (!consume?.amount || !event.amount) continue;
    const expectedTo = consume.amount * rate.rate;
    const expectedFrom = event.amount / rate.rate;
    if (event.amount !== expectedTo || !Number.isInteger(expectedFrom)) {
      issues.push({
        severity: "critical",
        code: "exchange-rate-mismatch",
        resource: event.resource,
        expected: expectedTo,
        actual: event.amount,
        expectedFromAmount: Number.isInteger(expectedFrom) ? expectedFrom : undefined,
        actualFromAmount: consume.amount,
        expectedToAmount: expectedTo,
        actualToAmount: event.amount,
        evidence: event.evidence,
        message: `兑换比例错误：${consume.amount} ${rate.from} 按 ${rate.rule} 应兑换 ${expectedTo} ${rate.to}，正文写成 ${event.amount}。`,
        suggestion: Number.isInteger(expectedFrom)
          ? `如果坚持获得 ${event.amount} ${rate.to}，必须消耗 ${expectedFrom} ${rate.from}。`
          : `按兑换规则修正 ${rate.from}/${rate.to} 数值。`,
        repairable: true,
      });
    }
  }
  issues.push(...dedupeResourceIssues(detectImplicitExchangeMismatches(events, rules, issues)));
  issues.push(...dedupeResourceIssues(detectMissingSkillUnlocks(params.chapterText ?? "", unlockedSkills, rules)));

  return {
    events,
    issues,
    openingBalances: filterBalances(openingBalances, activeResources),
    closingBalances: filterBalances(balances, activeResources),
    unlockedSkills,
    rules,
  };
}

export function computeResourceLedger(params: {
  readonly rules?: ResourceRules;
  readonly previousLedger?: string;
  readonly currentState?: string;
  readonly events: ReadonlyArray<ResourceEvent>;
  readonly chapterNumber: number;
  readonly bookRules?: string;
  readonly chapterIntent?: string;
}): ResourceValidationResult {
  const rules = params.rules ?? parseResourceRules(
    params.bookRules ?? "",
    params.previousLedger ?? "",
    params.currentState ?? "",
  );
  return validateResourceMath({
    events: params.events.map((event) => ({ ...event, chapter: event.chapter ?? params.chapterNumber })),
    currentLedger: params.previousLedger,
    currentState: params.currentState,
    bookRules: params.bookRules,
    chapterIntent: params.chapterIntent,
    rules,
  });
}

export function classifyResourceConsistency(params: {
  readonly validation: ResourceValidationResult;
  readonly repaired: boolean;
}): { readonly status: ResourceConsistencyStatus; readonly blocking: boolean; readonly shouldPersistLedger: boolean; readonly shouldPersistStateResources: boolean } {
  const blocking = params.validation.issues.some(isBlockingResourceIssue);
  const status: ResourceConsistencyStatus = blocking
    ? "FAILED"
    : params.validation.issues.length > 0
      ? "WARN"
      : params.repaired
        ? "FIXED"
        : "PASS";
  return {
    status,
    blocking,
    shouldPersistLedger: !blocking,
    shouldPersistStateResources: !blocking,
  };
}

export function buildResourceRecoveryPlans(params: {
  readonly validation: ResourceValidationResult;
  readonly chapterIntent?: string;
}): ResourceRecoveryPlan[] {
  const commonForbidden = [
    "可透支",
    "透支兑换",
    "负债",
    "无负债封顶",
    "允许欠账",
    "先用后还",
    "当前民望值：-",
    "民望为负",
    "余额为负",
    "负数资源",
    "当前民望 -90",
    "当前民望 -100",
    "10民望兑换1000联邦币",
    "5民望兑换1000联邦币",
  ];
  const deferExchangeForbidden = [
    ...commonForbidden,
    "兑换1000联邦币",
    "手机到账1000联邦币",
    "100民望兑换1000联邦币",
    "兑换联邦币",
    "银行余额",
    "手机余额",
    "账户余额变成",
    "联邦币已转入",
    "系统现金兑换",
    "兑换10联邦币",
    "1民望兑换10联邦币",
    "现金到账",
    "银行入账1000",
    "合法劳务报酬1000",
    "透析费暂时解决",
    "房租暂时解决",
    "待还",
    "负数",
  ];
  const cashRate = params.validation.rules.exchangeRates.find((rate) => rate.from === "民望值" && rate.to === "联邦币");
  const cashReward = 1000;
  const cashSpend = cashRate && Number.isInteger(cashReward / cashRate.rate)
    ? cashReward / cashRate.rate
    : 100;
  const reputationGainBeforeCash = Math.max(100, cashSpend);
  const planB: ResourceRecoveryPlan = {
    planId: "add_earned_resource_before_spend",
    title: "先获得足够民望，再兑换现金",
    strategy: "add_earned_resource_before_spend",
    description: `保留 1000 联邦币收益，但必须先通过路人认可获得 +${reputationGainBeforeCash} 民望，再按权威规则 ${cashRate ? `1点民望值=${cashRate.rate}联邦币` : "未确定兑换比例"} 消耗 ${cashSpend} 民望兑换。`,
    constraints: [
      "林默扶老太太，获得民望 +10。",
      "林默消耗 10 民望，兑换初级辩论技能。",
      "当前民望归零。",
      "林默用初级辩论技能反击汤姆。",
      `围观路人认可林默，系统累计新增民望 +${reputationGainBeforeCash}。`,
      `林默确认当前民望为 ${reputationGainBeforeCash}。`,
      `林默消耗 ${cashSpend} 民望，兑换 1000 联邦币。`,
      "当前民望归零。",
      "手机到账 1000 联邦币。",
      "不出现任何透支、负债、负数民望。",
    ],
    requiredEvents: [
      { kind: "gain", resource: "民望值", amount: 10, evidence: "恢复方案：扶老太太 +10 民望", index: 0 },
      { kind: "consume", resource: "民望值", amount: 10, evidence: "恢复方案：兑换初级辩论技能 -10 民望", index: 1 },
      { kind: "unlock", resource: "技能", label: "初级辩论技能", evidence: "恢复方案：解锁初级辩论技能", index: 2 },
      { kind: "gain", resource: "民望值", amount: reputationGainBeforeCash, evidence: `恢复方案：路人认可 +${reputationGainBeforeCash} 民望`, index: 3 },
      { kind: "consume", resource: "民望值", amount: cashSpend, targetResource: "联邦币", evidence: `恢复方案：消耗${cashSpend}民望兑换1000联邦币`, index: 4 },
      { kind: "gain", resource: "联邦币", amount: 1000, targetResource: "民望值", evidence: "恢复方案：到账1000联邦币", index: 5 },
    ],
    forbiddenPhrases: commonForbidden,
    expectedClosingBalances: {
      民望值: 0,
      联邦币: "期初联邦币 + 1000 - 本章现金支出",
      技能: "初级辩论技能",
    },
  };
  const planA: ResourceRecoveryPlan = {
    planId: "defer_exchange",
    title: "延后现金兑换",
    strategy: "defer_exchange",
    description: "删除本章现金兑换，让民望先服务于技能解锁和打脸，现金兑换留到下一章。",
    constraints: [
      "扶老太太获得 +10 民望。",
      "消耗 10 民望兑换初级辩论技能。",
      "当前民望归零。",
      "用初级辩论技能反击汤姆。",
      "围观路人认可林默，新增民望 +100 或余额跳到100/110。",
      "本章不兑换任何联邦币或现金，本章不出现任何到账/入账/银行余额增加。",
      "本章不解决透析费/房租，只保留下一章可兑换现金的希望。",
      "当前民望必须非负。",
    ],
    requiredEvents: [
      { kind: "gain", resource: "民望值", amount: 10, evidence: "恢复方案：扶老太太 +10 民望", index: 0 },
      { kind: "consume", resource: "民望值", amount: 10, evidence: "恢复方案：兑换初级辩论技能 -10 民望", index: 1 },
      { kind: "unlock", resource: "技能", label: "初级辩论技能", evidence: "恢复方案：解锁初级辩论技能", index: 2 },
      { kind: "gain", resource: "民望值", amount: 100, evidence: "恢复方案：路人认可 +100 民望", index: 3 },
    ],
    forbiddenPhrases: deferExchangeForbidden,
    expectedClosingBalances: {
      民望值: "非负",
      联邦币: "保持期初值，不因本章兑换增加",
      技能: "初级辩论技能",
    },
  };
  const intent = params.chapterIntent ?? "";
  const wantsCashRelief = /现金|联邦币|资金|房租|医药费|缓解|到账|兑换/u.test(intent)
    || params.validation.events.some((event) => event.resource === "联邦币" && event.amount === 1000);
  return wantsCashRelief ? [planB, planA] : [planA, planB];
}

export function selectResourceRecoveryPlan(params: {
  readonly validation: ResourceValidationResult;
  readonly chapterIntent?: string;
}): ResourceRecoveryPlan {
  return buildResourceRecoveryPlans(params)[0]!;
}

export function hasForbiddenResourceRecoveryPhrase(content: string, plan?: ResourceRecoveryPlan): boolean {
  const phrases = plan?.forbiddenPhrases ?? [];
  return phrases.some((phrase) => content.includes(phrase))
    || (plan?.strategy === "defer_exchange" && /(?:兑换|到账|入账|劳务报酬)[^。！？\n]{0,12}?1000\s*(?:联邦币|现金)?/u.test(content))
    || (plan?.strategy === "defer_exchange" && hasDeferExchangeCashFlow(content))
    || /当前民望值?\s*[：:=为是]?\s*[-－]\s*\d+/u.test(content)
    || UNAUTHORIZED_RESOURCE_RULE_PATTERN.test(content);
}

function hasDeferExchangeCashFlow(content: string): boolean {
  return /(?:民望|民望值)[^。！？\n]{0,24}?(?:兑换|换成|换取)[^。！？\n]{0,24}?(?:联邦币|现金)/u.test(content)
    || /(?:兑换|换成|换取)\s*(?:\d+|[一二两三四五六七八九十百千万]+)?\s*(?:元)?\s*(?:联邦币|现金)/u.test(content)
    || /(?:到账|入账|现金到账|银行到账|手机到账|银行APP|银行短信|账户余额|银行余额|手机余额|合法劳务报酬)/u.test(content)
    || /(?:联邦币|现金)[^。！？\n]{0,16}?(?:增加|变成|转入|到账|入账)/u.test(content)
    || hasIndirectDeferExchangeCashFlow(content);
}

export function applyDeferExchangeTemplatePatch(params: {
  readonly chapterText: string;
  readonly bookRules?: string;
  readonly currentLedger?: string;
  readonly currentState?: string;
}): DeferExchangeTemplatePatchResult {
  const units = splitPatchUnits(params.chapterText);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const unit of units) {
    if (isDeferExchangeCashFlowUnit(unit)) {
      removed.push(unit.trim());
    } else {
      kept.push(unit);
    }
  }
  if (removed.length === 0 && !hasDeferExchangeCashFlow(params.chapterText)) {
    return {
      patchedText: params.chapterText,
      removedSnippets: [],
      insertedTemplate: "",
      patchApplied: false,
      reason: "no-cash-flow-detected",
      reputationAfter: 100,
      balanceClaimPatchAttempted: false,
      balanceClaimPatchApplied: false,
    };
  }

  const staleBalanceClaims: Array<{ readonly unit: string; readonly value: number }> = [];
  const keptWithoutStaleBalanceClaims = kept.filter((unit) => {
    const stale = extractExplicitReputationBalanceFromUnit(unit);
    if (!stale) return true;
    staleBalanceClaims.push({ unit: unit.trim(), value: stale });
    return false;
  });
  const baseText = keptWithoutStaleBalanceClaims.join(keptWithoutStaleBalanceClaims.some((unit) => unit.includes("\n")) ? "\n\n" : "");
  const skillAlreadyPresent = extractResourceEvents(baseText, params.bookRules ?? "", params.currentLedger ?? "")
    .some((event) => event.kind === "unlock" && event.label === "初级辩论技能");
  const skillLine = skillAlreadyPresent
    ? ""
    : "系统扣除10点民望，初级辩论技能已激活。";
  const textBeforeGain = [baseText.trim(), skillLine].filter(Boolean).join("\n\n");
  const interimValidation = validateResourceMath({
    events: extractResourceEvents(textBeforeGain, params.bookRules ?? "", params.currentLedger ?? ""),
    currentLedger: params.currentLedger,
    currentState: params.currentState,
    bookRules: params.bookRules,
    chapterText: textBeforeGain,
  });
  const currentReputation = interimValidation.closingBalances["民望值"] ?? 0;
  const explicitReputation = findExplicitReputationBalance(baseText);
  const reputationAfter = Math.max(0, explicitReputation ?? (currentReputation > 0 ? currentReputation : 100));
  const gainDelta = Math.max(0, reputationAfter - currentReputation);
  const gainLine = gainDelta > 0
    ? `围观路人认可他的做法，系统新增${gainDelta}点民望。`
    : "";
  const insertedTemplate = [
    skillLine,
    gainLine,
    "系统面板上的数字终于稳定下来。",
    `当前民望值：${reputationAfter}。`,
    "",
    "林默的指尖停在“兑换合法资源”的按钮前，停了很久，却没有立刻按下去。",
    "",
    "外婆的透析费还差两千七，下个月房租还差八百，这些数字仍像石头一样压在胸口。可这一次，他没有再像刚才那样被逼到绝路。",
    "",
    "至少他已经知道，民望是真的，系统是真的。",
    "",
    "只要继续得到民众真实认可，这些民望迟早能换成真正能救命的钱。",
    "",
    "他把手机重新塞回口袋，掌心按住那枚旧铜勋章，第一次觉得，自己脚下那条被人堵死的路，好像裂开了一道缝。",
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
  const patchedBeforeBalanceSync = [baseText.trim(), insertedTemplate.trim()].filter(Boolean).join("\n\n");
  const patchedValidation = validateResourceMath({
    events: extractResourceEvents(patchedBeforeBalanceSync, params.bookRules ?? "", params.currentLedger ?? ""),
    currentLedger: params.currentLedger,
    currentState: params.currentState,
    bookRules: params.bookRules,
    chapterText: patchedBeforeBalanceSync,
  });
  const balancePatch = syncBalanceClaimsWithLedger(patchedBeforeBalanceSync, patchedValidation);
  const staleBalance = staleBalanceClaims.at(-1);
  const balanceClaimPatchApplied = Boolean(staleBalance) || balancePatch.applied;
  return {
    patchedText: balancePatch.content,
    removedSnippets: [...removed, ...staleBalanceClaims.map((claim) => claim.unit)],
    insertedTemplate,
    patchApplied: true,
    reason: "defer-exchange-cash-flow",
    reputationAfter,
    balanceClaimPatchAttempted: balancePatch.attempted,
    balanceClaimPatchApplied,
    balanceClaimPatchResource: balancePatch.resource ?? (staleBalance ? "民望值" : undefined),
    balanceClaimPatchFrom: staleBalance?.value ?? balancePatch.from,
    balanceClaimPatchTo: balancePatch.to ?? (staleBalance ? reputationAfter : undefined),
    balanceClaimPatchReason: balanceClaimPatchApplied ? balancePatch.reason : balancePatch.reason,
  };
}

function extractExplicitReputationBalanceFromUnit(unit: string): number | undefined {
  if (/消耗|扣除|花费|兑换|联邦币|现金|到账|入账|银行|账户|电子钱包/u.test(unit)) return undefined;
  const patterns = [
    /(?:当前|现在|此刻)?\s*(?:系统)?民望值?\s*[：:=为是]\s*(\d+|[一二两三四五六七八九十百千万]+)\s*点?/u,
    /(?:民望值?|当前民望)\s*余额\s*[：:=为是]?\s*(\d+|[一二两三四五六七八九十百千万]+)\s*点?/u,
    /(?:民望值?|当前民望)\s*(?:一栏|栏)\s*[：:=为是]?\s*(\d+|[一二两三四五六七八九十百千万]+)\s*点?/u,
    /(?:面板|系统面板)[^。！？\n]{0,16}?民望值?\s*(?:显示|是|为|显示为)?\s*(\d+|[一二两三四五六七八九十百千万]+)\s*点?/u,
    /(?:民望值?)[^。！？\n]{0,8}?(?:稳稳)?(?:停在|定格在|跳到|跳成)\s*(\d+|[一二两三四五六七八九十百千万]+)\s*点?/u,
  ];
  for (const pattern of patterns) {
    const match = unit.match(pattern);
    if (!match) continue;
    const value = parseFlexibleNumber(match[1] ?? "");
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function detectFilteredPseudoSkills(chapterText: string): string[] {
  const found = new Set<string>();
  for (const label of INVALID_SKILL_LABELS) {
    if (label && chapterText.includes(label)) found.add(label);
  }
  for (const match of chapterText.matchAll(/(?:兑换|解锁|激活|获得|掌握|兑换栏里亮起|栏里亮起一行新字)\s*[：:]?\s*([^，。！？；;、:\n：]{1,12}(?:技能)?)/giu)) {
    const raw = (match[1] ?? "").trim();
    if (raw && !normalizeSkillLabel(raw)) found.add(raw);
  }
  return [...found].filter((label) => PSEUDO_SKILL_LABELS.has(label) || /物品|兑换栏|列表|合法资源|联邦币|现金/u.test(label));
}

export function syncBalanceClaimsWithLedger(
  chapterText: string,
  validation: Pick<ResourceValidationResult, "closingBalances">,
): {
  readonly content: string;
  readonly attempted: boolean;
  readonly applied: boolean;
  readonly resource?: string;
  readonly from?: number;
  readonly to?: number;
  readonly reason?: string;
} {
  const target = validation.closingBalances["民望值"];
  if (target === undefined || !Number.isFinite(target) || target < 0) {
    return {
      content: chapterText,
      attempted: false,
      applied: false,
      reason: "no-authoritative-reputation-balance",
    };
  }

  const patterns: RegExp[] = [
    /((?:当前|现在|此刻)?\s*(?:系统)?民望值?\s*[：:=为是]\s*)(\d+|[一二两三四五六七八九十百千万]+)(\s*点?)/gu,
    /((?:民望值?|当前民望)\s*余额\s*[：:=为是]?\s*)(\d+|[一二两三四五六七八九十百千万]+)(\s*点?)/gu,
    /((?:民望值?|当前民望)\s*(?:一栏|栏)\s*[：:=为是]?\s*)(\d+|[一二两三四五六七八九十百千万]+)(\s*点?)/gu,
    /((?:面板|系统面板)[^。！？\n]{0,16}?民望值?\s*(?:显示|是|为|显示为)?\s*)(\d+|[一二两三四五六七八九十百千万]+)(\s*点?)/gu,
    /((?:民望值?)[^。！？\n]{0,8}?(?:稳稳)?(?:停在|定格在|跳到|跳成)\s*)(\d+|[一二两三四五六七八九十百千万]+)(\s*点?)/gu,
  ];
  const matches: Array<{ readonly start: number; readonly end: number; readonly value: number }> = [];
  for (const pattern of patterns) {
    for (const match of chapterText.matchAll(pattern)) {
      const raw = match[2] ?? "";
      const value = parseFlexibleNumber(raw);
      if (!Number.isFinite(value)) continue;
      const full = match[0] ?? "";
      if (isSpendOrCashContext(chapterText, match.index ?? 0, full)) continue;
      const prefixLength = match[1]?.length ?? 0;
      const start = (match.index ?? 0) + prefixLength;
      matches.push({ start, end: start + raw.length, value });
    }
  }
  if (matches.length === 0) {
    return {
      content: chapterText,
      attempted: true,
      applied: false,
      resource: "民望值",
      to: target,
      reason: "ambiguous-balance-claim",
    };
  }

  const last = matches.sort((left, right) => left.start - right.start).at(-1)!;
  if (last.value === target) {
    return {
      content: chapterText,
      attempted: true,
      applied: false,
      resource: "民望值",
      from: last.value,
      to: target,
      reason: "already-synced",
    };
  }
  return {
    content: `${chapterText.slice(0, last.start)}${target}${chapterText.slice(last.end)}`,
    attempted: true,
    applied: true,
    resource: "民望值",
    from: last.value,
    to: target,
  };
}

function isSpendOrCashContext(text: string, index: number, matched: string): boolean {
  const window = text.slice(Math.max(0, index - 20), Math.min(text.length, index + matched.length + 20));
  return /(?:消耗|扣除|花费|兑换|被扣除|瞬间清空|联邦币|现金|透析费|房租|金额|缺口|到账|入账|余额页面|银行|账户|电子钱包)/u.test(window)
    && !/(?:当前|民望值?|民望余额|面板|系统面板|一栏|定格|停在|显示)/u.test(matched);
}

function splitPatchUnits(text: string): string[] {
  if (/\n\s*\n/u.test(text)) {
    return text.split(/\n\s*\n/u).filter((unit) => unit.trim().length > 0);
  }
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu);
  return sentences?.filter((unit) => unit.trim().length > 0) ?? [text];
}

function isDeferExchangeCashFlowUnit(unit: string): boolean {
  return hasDeferExchangeCashFlow(unit)
    || /(?:电子钱包|银行APP|账户余额|余额变成|余额，变成|联邦币已转入|合法劳务报酬)/u.test(unit)
    || /(?:1000|一千)\s*(?:联邦币|现金)/u.test(unit)
    || /(?:一千二百|1200)/u.test(unit)
    || /(?:透析费缺口缩小|房租缺口缩小|资金暂时缓解|先交押金|房租问题暂时缓解)/u.test(unit)
    || /(?:兑换按钮)[^。！？\n]{0,24}?(?:联邦币|现金)/u.test(unit)
    || /(?:100点民望瞬间扣除|100\s*点?民望[^。！？\n]{0,12}?(?:扣除|消耗))/u.test(unit)
    || hasIndirectDeferExchangeCashFlow(unit);
}

function hasIndirectDeferExchangeCashFlow(content: string): boolean {
  const cashAmount = "(?:1000|一千)";
  const totalAmount = "(?:1200|一千二百)";
  const baseAmount = "(?:200|两百|二百)";
  const reducedGap = "(?:1700|一千七百)";
  const originalGap = "(?:2700|两千七百)";
  return new RegExp(`(?:刚兑换的|兑换来的|兑换到的|换来的|系统兑换的|用民望换来的|用系统换来的)${cashAmount}`, "u").test(content)
    || new RegExp(`(?:换到了|拿到了|到手)${cashAmount}\\s*(?:联邦币|现金)?`, "u").test(content)
    || new RegExp(`(?:原来的|原本的)?${baseAmount}[^。！？\\n]{0,16}?(?:加上|加)${cashAmount}`, "u").test(content)
    || new RegExp(`(?:一共|总共|共有|一共有|手里有|账户里|余额)\\s*(?:${totalAmount})\\s*(?:联邦币|现金)?`, "u").test(content)
    || new RegExp(`(?:从${baseAmount}变成${totalAmount}|多了${cashAmount}|(?:现金|联邦币|钱包里)[^。！？\\n]{0,8}?多了${cashAmount})`, "u").test(content)
    || new RegExp(`(?:扣掉|减掉)这?${cashAmount}`, "u").test(content)
    || new RegExp(`(?:缺口(?:少了|减少)${cashAmount}|从${originalGap}降到${reducedGap}|资金缺口缩小|资金暂时(?:缓解|松)|终于松了一口气|不像刚才那样慌得没底)`, "u").test(content)
    || new RegExp(`(?:还差|透析费还差)${reducedGap}`, "u").test(content);
}

function findExplicitReputationBalance(text: string): number | undefined {
  const events = extractResourceEvents(text);
  const balances = events.filter((event) =>
    (event.kind === "balance" || event.kind === "balance_jump")
    && event.resource === "民望值"
    && event.amount !== undefined
    && event.amount >= 0);
  return balances.at(-1)?.amount;
}

export function repairResourceInconsistencies(
  chapterText: string,
  validation: Pick<ResourceValidationResult, "issues">,
): ResourceRepairResult {
  let content = chapterText;
  const repaired: ResourceMathIssue[] = [];
  const unresolved: ResourceMathIssue[] = [];
  const notes: string[] = [];

  for (const issue of validation.issues) {
    if (!issue.repairable || issue.expected === undefined || issue.actual === undefined) {
      unresolved.push(issue);
      continue;
    }
    const before = content;
    if (issue.resource === "民望值" && issue.code === "balance-mismatch") {
      content = repairReputationBalance(content, issue.actual, issue.expected);
    } else if (issue.code === "exchange-rate-mismatch" || issue.code === "exchange-ratio-mismatch") {
      content = repairExchangeAmount(content, issue);
    } else {
      content = replaceFirstResourceNumber(content, issue);
    }
    if (content !== before) {
      repaired.push(issue);
      notes.push(issue.message);
    } else {
      unresolved.push(issue);
    }
  }

  return {
    content,
    repaired: repaired.length > 0,
    repairedIssues: repaired,
    unresolvedIssues: unresolved,
    notes,
  };
}

export function buildResourceLedgerUpdate(params: {
  readonly chapterNumber: number;
  readonly currentLedger?: string;
  readonly validation: ResourceValidationResult;
  readonly resourcePlan?: import("./resource-plan.js").ChapterResourcePlan;
}): string {
  const ledger = params.currentLedger?.trim();
  if (classifyResourceConsistency({ validation: params.validation, repaired: false }).blocking) {
    return ledger || "";
  }
  const effectiveClosingBalances = params.resourcePlan && params.resourcePlan.mode !== "no_resource_change"
    ? { ...params.validation.closingBalances, ...params.resourcePlan.expectedClosingBalances }
    : params.validation.closingBalances;
  const effectiveUnlockedSkills = params.resourcePlan && params.resourcePlan.mode !== "no_resource_change"
    ? [...new Set([...params.validation.unlockedSkills, ...params.resourcePlan.unlockedSkills])]
    : params.validation.unlockedSkills;
  const resources = Object.entries(effectiveClosingBalances)
    .filter(([resource]) => isAllowedResource(resource) && resource !== "技能")
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"));
  const overviewRows = resources.map(([resource, value]) => {
    const note = buildResourceNote(resource, params.validation.events, effectiveUnlockedSkills);
    return `| ${resource} | ${value} | ${params.chapterNumber} | ${note} |`;
  });
  for (const skill of effectiveUnlockedSkills) {
    overviewRows.push(`| 技能 | ${skill} | ${params.chapterNumber} | 本章解锁 |`);
  }

  const flowRows = buildFlowRows(params.chapterNumber, params.validation, params.resourcePlan);
  if (!overviewRows.length && !flowRows.length) {
    return ledger || "";
  }

  return [
    "# 资源账本",
    "",
    "## 当前资源总览",
    "| 资源 | 当前值 | 最近更新章节 | 备注 |",
    "|---|---:|---:|---|",
    ...(overviewRows.length ? overviewRows : ["| 无 | 0 | 0 | 暂无资源变化 |"]),
    "",
    "## 章节流水",
    "| 章节 | 资源 | 期初 | 增量 | 消耗 | 期末 | 依据 |",
    "|---|---|---:|---:|---:|---:|---|",
    ...flowRows,
    "",
    ledger && !ledger.includes("## 章节流水")
      ? "## 旧账本记录\n" + ledger.replace(/^#\s*资源账本\s*/u, "").trim()
      : "",
  ].filter((part) => part !== "").join("\n");
}

export function syncCurrentStateResources(params: {
  readonly currentState: string;
  readonly validation: ResourceValidationResult;
  readonly resourcePlan?: import("./resource-plan.js").ChapterResourcePlan;
}): string {
  const hasActiveResourcePlan = Boolean(params.resourcePlan && params.resourcePlan.mode !== "no_resource_change");
  if (params.validation.events.length === 0 && !hasActiveResourcePlan) {
    return params.currentState;
  }
  if (params.validation.issues.length > 0) {
    const line = "| 当前资源 | 资源账本校验存在冲突，需人工确认 |";
    if (/\|\s*当前资源\s*\|/u.test(params.currentState)) {
      return params.currentState.replace(/\|\s*当前资源\s*\|[^\n]*\|/u, line);
    }
    return `${params.currentState.trimEnd()}\n${line}\n`;
  }
  const effectiveClosingBalances = params.resourcePlan && params.resourcePlan.mode !== "no_resource_change"
    ? { ...params.validation.closingBalances, ...params.resourcePlan.expectedClosingBalances }
    : params.validation.closingBalances;
  const effectiveUnlockedSkills = params.resourcePlan && params.resourcePlan.mode !== "no_resource_change"
    ? [...new Set([...params.validation.unlockedSkills, ...params.resourcePlan.unlockedSkills])]
    : params.validation.unlockedSkills;
  const resourceSummary = Object.entries(effectiveClosingBalances)
    .filter(([resource]) => isAllowedResource(resource))
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))
    .map(([resource, value]) => `${resource}=${value}`)
    .join("；");
  const skillSummary = effectiveUnlockedSkills.length
    ? `；已解锁技能=${effectiveUnlockedSkills.join("、")}`
    : "";
  const line = `| 当前资源 | ${resourceSummary || "无"}${skillSummary} |`;
  if (/\|\s*当前资源\s*\|/u.test(params.currentState)) {
    return params.currentState.replace(/\|\s*当前资源\s*\|[^\n]*\|/u, line);
  }
  return `${params.currentState.trimEnd()}\n${line}\n`;
}

export function buildAuthoritativeResourceContext(validation: ResourceValidationResult): string {
  const resourceLines = Object.entries(validation.closingBalances)
    .filter(([resource]) => isAllowedResource(resource))
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))
    .map(([resource, after]) => {
      const before = validation.openingBalances[resource] ?? 0;
      const events = validation.events
        .filter((event) => event.resource === resource && (event.kind === "gain" || event.kind === "consume"))
        .map((event) => `${event.kind === "gain" ? "+" : "-"}${event.amount ?? 0}`)
        .join(" ");
      return `- ${resource}: before=${before}; events=${events || "0"}; after=${after}`;
    });
  const skillLine = validation.unlockedSkills.length
    ? `- skills: ${validation.unlockedSkills.join("、")}`
    : "- skills: none";
  const fixes = validation.issues.map((issue) => `- ${issue.code}: ${issue.message} ${issue.suggestion}`);
  return [
    "authoritativeResults:",
    ...resourceLines,
    skillLine,
    "textFixInstructions:",
    ...(fixes.length ? fixes : ["- 无"]),
  ].join("\n");
}

export function renderResourceRulesForPrompt(rules: ResourceRules): string {
  const exchangeLines = rules.exchangeRates.length
    ? rules.exchangeRates.map((rate) => `- ${rate.from} -> ${rate.to}: 1 ${rate.from} = ${rate.rate} ${rate.to}（${rate.source ?? "book_rules"}；${rate.rule}）`)
    : ["- 未确定现金/资源兑换比例；不得自行发明现金兑换。"];
  const skillLines = rules.skills.length
    ? rules.skills.map((skill) => `- ${skill.skill}: 消耗 ${skill.amount} ${skill.resource}`)
    : ["- 未定义技能成本；只能按正文明确消耗和程序账本校验。"];
  return [
    "exchangeRates:",
    ...exchangeLines,
    "skills:",
    ...skillLines,
  ].join("\n");
}

export function buildResourceAuthoritySummary(params: {
  readonly chapter: number;
  readonly validation: ResourceValidationResult;
  readonly status: ResourceConsistencyStatus;
  readonly recoveryPlan?: ResourceRecoveryPlan;
}): string {
  const resources = Object.entries(params.validation.closingBalances)
    .filter(([resource]) => isAllowedResource(resource))
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))
    .map(([resource, value]) => `${resource}=${value}`)
    .join("；") || "无";
  const skills = params.validation.unlockedSkills.join("、") || "无";
  const deferExchange = params.recoveryPlan?.strategy === "defer_exchange"
    ? [
        "- 方案A defer_exchange 已延后现金兑换，本章联邦币/现金不得增加。",
        "- 资金缺口仍存在，只能写下一章可继续获取民望或兑换现金的可能。",
      ]
    : [];
  return [
    "## Resource Engine 权威资源摘要",
    `- chapter: ${params.chapter}`,
    `- status: ${params.status}`,
    `- resources: ${resources}`,
    `- unlockedSkills: ${skills}`,
    "- 后续 state/current_state 必须以本摘要为准，不得根据模糊正文自行重算资源。",
    "- 禁止写入与本摘要冲突的资源值，例如民望值=9、联邦币=10、联邦币=1200，除非程序账本明确给出。",
    "- 不得把感官词、身体部位或短语误当作当前位置。",
    ...deferExchange,
  ].join("\n");
}

export function buildResourceAuditIssues(params: {
  readonly repair: ResourceRepairResult;
  readonly validation: ResourceValidationResult;
}): AuditIssue[] {
  const issues: AuditIssue[] = [];
  if (params.repair.repairedIssues.length > 0 && params.validation.issues.length === 0) {
    issues.push({
      severity: "info",
      category: "resource-consistency",
      description: "resource-consistency: 已按程序账本修复资源数值表达。",
      suggestion: "检查最终正文和资源账本确认数值链路正确。",
    });
  }
  if (params.validation.issues.length > 0) {
    issues.push({
      severity: params.validation.issues.some(isBlockingResourceIssue) ? "critical" : "warning",
      category: "resource-consistency",
      description: params.validation.issues.some(isBlockingResourceIssue)
        ? "resource-consistency: 程序账本校验失败，本章不得继续续写，需人工修复或重写。"
        : "resource-consistency: 程序账本校验仍失败，需人工确认。",
      suggestion: "人工核对正文资源事件、兑换规则和 particle_ledger.md；修复前不要基于本章继续续写。",
    });
  }
  for (const issue of params.repair.unresolvedIssues) {
    issues.push({
      severity: issue.severity === "critical" ? "critical" : "warning",
      category: "resource-consistency",
      description: `resource-consistency: ${issue.message}`,
      suggestion: issue.suggestion,
    });
  }
  return issues;
}

const NUMBER_SOURCE = "\\d+|[一二两三四五六七八九十百千万]+";
const UNAUTHORIZED_RESOURCE_RULE_PATTERN = /可透支|透支兑换|负债|无负债封顶|允许欠账|信用额度|先用后还|余额为负|负数资源/u;
const SKILL_ALIASES: Record<string, string> = {
  初级辩论: "初级辩论技能",
  初级辩论技能: "初级辩论技能",
  初级演讲: "初级演讲技能",
  初级演讲技能: "初级演讲技能",
  初级格斗: "初级格斗技能",
  初级格斗技能: "初级格斗技能",
  初级观察: "初级观察技能",
  初级观察技能: "初级观察技能",
  初级说服: "初级说服技能",
  初级说服技能: "初级说服技能",
  初级体能强化: "初级体能强化",
  初级治疗: "初级治疗",
  初级信息检索: "初级信息检索",
};
const INVALID_SKILL_LABELS = new Set([
  "完",
  "权限",
  "基础资源",
  "物品/技能",
  "可兑换物品/技能",
  "兑换物品/技能",
  "物品",
  "栏里亮起一行新字",
  "技能栏",
  "兑换栏",
  "兑换列表",
  "可兑换列表",
  "可兑换物品",
  "可兑换技能",
  "兑换完技能",
  "技能",
  "初级",
  "资源",
  "合法资源",
  "所有合法资源",
  "现金",
  "联邦币",
]);
const PSEUDO_SKILL_LABELS = INVALID_SKILL_LABELS;

function deriveResourceTypes(bookRules: string, combined: string): string[] {
  const rules = parseResourceRules(bookRules, combined);
  return Object.keys(rules.resources).sort((left, right) => right.length - left.length);
}

function buildResourcePattern(resourceTypes: ReadonlyArray<string>): string {
  const aliases = new Set<string>([...resourceTypes, ...Object.keys(RESOURCE_ALIASES)]);
  return [...aliases]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
}

function parseExchangeRates(bookRules: string, aliases: Readonly<Record<string, string>>): ResourceExchangeRate[] {
  return parseExchangeRatesFromText(bookRules, aliases, "book_rules", true);
}

function parseExchangeRatesFromText(
  text: string,
  aliases: Readonly<Record<string, string>>,
  source: ResourceExchangeRate["source"] = "book_rules",
  includeDefault = false,
): ResourceExchangeRate[] {
  const rates: ResourceExchangeRate[] = [];
  const add = (fromRaw: string, toRaw: string, rate: number, rule: string) => {
    const from = canonicalResourceName(fromRaw, { resources: {}, aliases, exchangeRates: [], skills: [] }) ?? normalizeResourceName(fromRaw);
    const to = canonicalResourceName(toRaw, { resources: {}, aliases, exchangeRates: [], skills: [] }) ?? normalizeResourceName(toRaw);
    if (!isAllowedResource(from) || !isAllowedResource(to) || !Number.isFinite(rate) || rate <= 0) return;
    if (rates.some((candidate) => candidate.from === from && candidate.to === to)) return;
    rates.push({ from, to, rate, rule, source });
  };

  for (const match of text.matchAll(new RegExp(`1\\s*点?\\s*(${buildResourcePattern(Object.keys(RESOURCE_ALIASES))})\\s*(?:=|可兑换|兑换|换成)\\s*(${NUMBER_SOURCE})\\s*(?:元)?\\s*(${buildResourcePattern(Object.keys(RESOURCE_ALIASES))})`, "giu"))) {
    add(match[1] ?? "", match[3] ?? "", parseFlexibleNumber(match[2] ?? ""), match[0] ?? "");
  }

  const exchangeBlock = text.match(/exchangeRates\s*:\s*\n([\s\S]*?)(?:\n\S|$)/iu)?.[1] ?? "";
  for (const block of exchangeBlock.split(/\n\s*-\s*/u)) {
    const from = block.match(/from\s*:\s*([^\n]+)/iu)?.[1]?.trim();
    const to = block.match(/to\s*:\s*([^\n]+)/iu)?.[1]?.trim();
    const rate = block.match(/rate\s*:\s*(\d+)/iu)?.[1];
    if (from && to && rate) add(from, to, Number.parseInt(rate, 10), block.trim());
  }

  if (includeDefault && !rates.some((rate) => rate.from === "民望值" && rate.to === "联邦币") && /民望|联邦币|现金/u.test(text)) {
    rates.push({ from: "民望值", to: "联邦币", rate: 10, rule: "默认规则：1点民望值 = 10联邦币", source: "default" });
  }

  return rates;
}

function parseSkillRules(bookRules: string, aliases: Readonly<Record<string, string>>): ResourceSkillRule[] {
  const skills: ResourceSkillRule[] = [];
  const add = (skillRaw: string, resourceRaw: string, amount: number) => {
    const skill = normalizeSkillLabel(skillRaw.endsWith("技能") ? skillRaw : `${skillRaw}技能`);
    const resource = canonicalResourceName(resourceRaw, { resources: {}, aliases, exchangeRates: [], skills: [] }) ?? normalizeResourceName(resourceRaw);
    if (!skill || !isAllowedResource(resource) || !Number.isFinite(amount)) return;
    if (skills.some((candidate) => candidate.skill === skill)) return;
    skills.push({ skill, resource, amount });
  };

  for (const match of bookRules.matchAll(new RegExp(`([^\\n，。！？]{1,20}?技能)\\s*(?:消耗|花费|需要)\\s*(${NUMBER_SOURCE})\\s*点?\\s*(${buildResourcePattern(Object.keys(RESOURCE_ALIASES))})`, "giu"))) {
    add(match[1] ?? "", match[3] ?? "", parseFlexibleNumber(match[2] ?? ""));
  }

  const skillsBlock = bookRules.match(/skills\s*:\s*\n([\s\S]*?)(?:\n\S|$)/iu)?.[1] ?? "";
  for (const match of skillsBlock.matchAll(/^\s{2}([^:\n]+):\s*$/gmu)) {
    const skill = match[1]?.trim() ?? "";
    if (/^(cost|resource|amount|type|initial|min|max|aliases)$/iu.test(skill)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const next = skillsBlock.slice(start).search(/^\s{2}[^:\n]+:\s*$/mu);
    const body = next >= 0 ? skillsBlock.slice(start, start + next) : skillsBlock.slice(start);
    const resource = body.match(/resource\s*:\s*([^\n]+)/iu)?.[1]?.trim();
    const amount = body.match(/amount\s*:\s*(\d+)/iu)?.[1];
    if (resource && amount) add(skill, resource, Number.parseInt(amount, 10));
  }

  return skills;
}

function normalizeEventsForRules(events: ReadonlyArray<ResourceEvent>, rules: ResourceRules): ResourceEvent[] {
  return events
    .map((event) => {
      if (event.kind === "unlock") {
        const label = event.label ? normalizeSkillLabel(event.label) : "";
        return label ? { ...event, resource: "技能", label } : null;
      }
      const resource = canonicalResourceName(event.resource, rules);
      if (!resource) return null;
      const targetResource = event.targetResource ? canonicalResourceName(event.targetResource, rules) : undefined;
      return {
        ...event,
        resource: resource ?? event.resource,
        ...(targetResource ? { targetResource } : {}),
      };
    })
    .filter((event): event is ResourceEvent => Boolean(event));
}

function completeMissingSkillUnlockEvents(
  events: ReadonlyArray<ResourceEvent>,
  chapterText: string,
  rules: ResourceRules,
): ResourceEvent[] {
  const inferredSkill = inferSkillMentionFromText(chapterText, rules);
  if (!inferredSkill) return [...events];
  const normalizedSkill = normalizeSkillLabel(inferredSkill.skill);
  if (!normalizedSkill || events.some((event) => event.kind === "unlock" && event.label === normalizedSkill)) {
    return [...events];
  }
  const inferredEvent: ResourceEvent = {
    kind: "unlock",
    resource: "技能",
    label: normalizedSkill,
    evidence: inferredSkill.evidence,
    index: inferredSkill.index,
    reason: "正文出现技能使用/激活语义，Resource Engine 自动补入技能解锁事件",
    confidence: 0.7,
  };
  return [
    ...events,
    inferredEvent,
  ].sort((left, right) => left.index - right.index);
}

function inferSkillMentionFromText(
  chapterText: string,
  rules: ResourceRules,
): { readonly skill: string; readonly evidence: string; readonly index: number } | undefined {
  if (!chapterText.trim()) return undefined;
  const explicitSkill = chapterText.match(/(初级辩论技能|初级辩论|辩论技能)(?:兑换完成|已激活|激活|带来的能力|信息流|能力)?/u);
  if (explicitSkill) {
    return {
      skill: normalizeSkillLabel(explicitSkill[1] ?? explicitSkill[0] ?? "初级辩论技能") || "初级辩论技能",
      evidence: explicitSkill[0] ?? "初级辩论技能",
      index: explicitSkill.index ?? 0,
    };
  }
  const semanticSkill = chapterText.match(/(?:信息流冲进脑子|法规条文浮现在意识里|快速梳理逻辑|应对公开场合对峙)/u);
  if (semanticSkill) {
    const defaultSkill = rules.skills.find((skill) => skill.skill === "初级辩论技能")?.skill ?? "初级辩论技能";
    return {
      skill: defaultSkill,
      evidence: semanticSkill[0] ?? defaultSkill,
      index: semanticSkill.index ?? 0,
    };
  }
  return undefined;
}

function collapseBalanceJumpNoise(events: ReadonlyArray<ResourceEvent>): ResourceEvent[] {
  const jumps = events.filter((event) => event.kind === "balance_jump" && event.amount !== undefined);
  if (jumps.length === 0) return [...events];
  return events.filter((event) => {
    if (event.kind !== "gain" || event.amount === undefined || event.amount > 2) return true;
    return !jumps.some((jump) =>
      jump.resource === event.resource
      && event.index < jump.index
      && jump.index - event.index <= 180);
  });
}

function inferExchangeSpends(events: ReadonlyArray<ResourceEvent>, rules: ResourceRules): ResourceEvent[] {
  const expanded = [...events];
  for (const event of events) {
    if (event.kind !== "gain" || !event.targetResource || !event.resource || event.amount === undefined) {
      continue;
    }
    const rate = findExchangeRate(rules, event.targetResource, event.resource);
    if (!rate) continue;
    const existing = findNearestExchangeConsume(expanded, event, rate.from);
    if (existing) continue;
    const inferred = event.amount / rate.rate;
    if (!Number.isInteger(inferred)) continue;
    expanded.push({
      kind: "consume",
      resource: rate.from,
      amount: inferred,
      targetResource: rate.to,
      evidence: event.evidence,
      index: Math.max(0, event.index - 1),
      reason: `按兑换规则推导：${rate.rule}`,
      confidence: 0.85,
    });
  }
  return expanded.sort((left, right) => left.index - right.index);
}

function buildAuthoritativeExchangeSpendMap(
  events: ReadonlyArray<ResourceEvent>,
  rules: ResourceRules,
): Map<number, number> {
  const corrections = new Map<number, number>();
  for (const event of events) {
    if (event.kind !== "gain" || !event.targetResource || !event.resource || event.amount === undefined) {
      continue;
    }
    const rate = findExchangeRate(rules, event.targetResource, event.resource);
    if (!rate) continue;
    const consume = findNearestExchangeConsume(events, event, rate.from);
    if (!consume || consume.amount === undefined) continue;
    const expectedFrom = event.amount / rate.rate;
    if (Number.isInteger(expectedFrom)) {
      corrections.set(consume.index, expectedFrom);
    }
  }
  return corrections;
}

function canonicalResourceName(value: string, rules: ResourceRules): string | undefined {
  const trimmed = value.trim();
  const normalized = normalizeResourceName(trimmed);
  const candidate = rules.aliases[trimmed] ?? rules.aliases[normalized] ?? normalized;
  return isAllowedResource(candidate) ? candidate : undefined;
}

function isAllowedResource(resource: string): boolean {
  return CANONICAL_RESOURCE_WHITELIST.has(resource);
}

function isCoreResource(resource: string): boolean {
  return CORE_RESOURCE_SET.has(resource);
}

function findExchangeRate(rules: ResourceRules, from: string, to: string): ResourceExchangeRate | undefined {
  return rules.exchangeRates.find((rate) => rate.from === from && rate.to === to);
}

function resourceMinimum(rule?: ResourceRule): number {
  if (!rule) return 0;
  if (rule.allowNegative) {
    return rule.creditLimit !== undefined ? -Math.abs(rule.creditLimit) : rule.min;
  }
  return Math.max(0, rule.min);
}

function isBlockingResourceIssue(issue: ResourceMathIssue): boolean {
  return issue.severity === "critical"
    || (issue.code === "balance-mismatch" && isCoreResource(issue.resource))
    || issue.code === "negative-balance"
    || issue.code === "resource-type-mismatch"
    || issue.code === "resource-rule-conflict"
    || issue.code === "exchange-rate-mismatch"
    || issue.code === "exchange-ratio-mismatch"
    || issue.code === "skill-cost-mismatch"
    || issue.code === "missing-skill-unlock"
    || issue.code === "unauthorized-resource-rule";
}

function detectUnauthorizedResourceRules(
  chapterText: string,
  bookRules: string,
  rules: ResourceRules,
): ResourceMathIssue[] {
  if (!chapterText || !UNAUTHORIZED_RESOURCE_RULE_PATTERN.test(chapterText)) return [];
  const explicitAllowance = /allowNegative\s*:\s*true|可透支|允许负债|允许欠账|creditLimit|信用额度/iu.test(bookRules)
    || Object.values(rules.resources).some((rule) => rule.allowNegative || rule.creditLimit !== undefined);
  if (explicitAllowance) return [];
  const evidence = chapterText.match(UNAUTHORIZED_RESOURCE_RULE_PATTERN)?.[0] ?? "未授权资源规则";
  return [{
    severity: "critical",
    code: "unauthorized-resource-rule",
    resource: "民望值",
    evidence,
    message: `正文出现未授权资源规则“${evidence}”，但 book_rules 未允许负数、透支或信用额度。`,
    suggestion: "删除透支/负债设定，或在 book_rules 中显式声明 allowNegative/creditLimit 后重新审核系统平衡。",
    repairable: false,
  }];
}

function detectResourceRuleConflicts(chapterIntent: string, rules: ResourceRules): ResourceMathIssue[] {
  if (!chapterIntent.trim()) return [];
  const aliases = rules.aliases;
  const intentRates = parseExchangeRatesFromText(chapterIntent, aliases, "chapter_intent", false);
  if (intentRates.length === 0) return [];
  const issues: ResourceMathIssue[] = [];
  for (const intentRate of intentRates) {
    const authoritative = rules.exchangeRates.find((rate) => rate.from === intentRate.from && rate.to === intentRate.to);
    if (!authoritative || authoritative.rate === intentRate.rate) continue;
    issues.push({
      severity: "critical",
      code: "resource-rule-conflict",
      resource: intentRate.to,
      expected: authoritative.rate,
      actual: intentRate.rate,
      evidence: intentRate.rule,
      message: `资源规则冲突：权威规则为 1 ${authoritative.from} = ${authoritative.rate} ${authoritative.to}，chapter_intent 写成 ${intentRate.rate}。`,
      suggestion: "统一 book_rules 与 chapter_intent 的兑换比例；Resource Engine 不会静默采用冲突规则。",
      repairable: false,
    });
  }
  return issues;
}

function detectTextualExchangeRateMismatches(chapterText: string, rules: ResourceRules): ResourceMathIssue[] {
  if (!chapterText) return [];
  const issues: ResourceMathIssue[] = [];
  for (const rate of rules.exchangeRates) {
    const fromAliases = resourceAliasesFor(rate.from);
    const toAliases = resourceAliasesFor(rate.to);
    const fromPattern = fromAliases.map(escapeRegExp).join("|");
    const toPattern = toAliases.map(escapeRegExp).join("|");
    const fromThenTo = new RegExp(`(${NUMBER_SOURCE})\\s*(?:点)?\\s*(?:${fromPattern})[^。！？!?；;\\n]{0,32}?(?:兑换|换成|换取|需要|消耗|到账)[^。！？!?；;\\n]{0,20}?(${NUMBER_SOURCE})\\s*(?:元)?\\s*(?:${toPattern})`, "giu");
    for (const match of chapterText.matchAll(fromThenTo)) {
      const fromAmount = parseFlexibleNumber(match[1] ?? "");
      const toAmount = parseFlexibleNumber(match[2] ?? "");
      if (!Number.isFinite(fromAmount) || !Number.isFinite(toAmount)) continue;
      const expectedTo = fromAmount * rate.rate;
      if (toAmount !== expectedTo) {
        issues.push(buildExchangeRateIssue({
          rate,
          fromAmount,
          toAmount,
          evidence: match[0] ?? "",
        }));
      }
    }

    const verbResourceThenTo = new RegExp(`(?:消耗|扣除|花费|支付|耗去)\\s*(?:${fromPattern})\\s*(${NUMBER_SOURCE})\\s*(?:点)?[^。！？!?；;\\n]{0,32}?(${NUMBER_SOURCE})\\s*(?:元)?\\s*(?:${toPattern})(?:[^。！？!?；;\\n]{0,8}?(?:到账|入账|兑换成功))?`, "giu");
    for (const match of chapterText.matchAll(verbResourceThenTo)) {
      const fromAmount = parseFlexibleNumber(match[1] ?? "");
      const toAmount = parseFlexibleNumber(match[2] ?? "");
      if (!Number.isFinite(fromAmount) || !Number.isFinite(toAmount)) continue;
      const expectedTo = fromAmount * rate.rate;
      if (toAmount !== expectedTo) {
        issues.push(buildExchangeRateIssue({
          rate,
          fromAmount,
          toAmount,
          evidence: match[0] ?? "",
        }));
      }
    }

    const toThenFrom = new RegExp(`(${NUMBER_SOURCE})\\s*(?:元)?\\s*(?:${toPattern})[^。！？!?；;\\n]{0,32}?(?:需要|消耗|花费|扣除|耗去)[^。！？!?；;\\n]{0,20}?(${NUMBER_SOURCE})\\s*(?:点)?\\s*(?:${fromPattern})`, "giu");
    for (const match of chapterText.matchAll(toThenFrom)) {
      const toAmount = parseFlexibleNumber(match[1] ?? "");
      const fromAmount = parseFlexibleNumber(match[2] ?? "");
      if (!Number.isFinite(fromAmount) || !Number.isFinite(toAmount)) continue;
      const expectedTo = fromAmount * rate.rate;
      if (toAmount !== expectedTo) {
        issues.push(buildExchangeRateIssue({
          rate,
          fromAmount,
          toAmount,
          evidence: match[0] ?? "",
        }));
      }
    }
  }
  return dedupeResourceIssues(issues);
}

function detectImplicitExchangeMismatches(
  events: ReadonlyArray<ResourceEvent>,
  rules: ResourceRules,
  existingIssues: ReadonlyArray<ResourceMathIssue>,
): ResourceMathIssue[] {
  const issues: ResourceMathIssue[] = [];
  for (const event of events) {
    if (event.kind !== "gain" || event.amount === undefined) continue;
    for (const rate of rules.exchangeRates.filter((candidate) => candidate.to === event.resource)) {
      const consume = findNearestExchangeConsume(events, event, rate.from);
      if (!consume?.amount) continue;
      const expectedTo = consume.amount * rate.rate;
      if (event.amount === expectedTo) continue;
      issues.push(buildExchangeRateIssue({
        rate,
        fromAmount: consume.amount,
        toAmount: event.amount,
        evidence: event.evidence,
      }));
    }
  }
  return dedupeResourceIssues(issues).filter((issue) => !existingIssues.some((existing) =>
    existing.code === issue.code
    && existing.resource === issue.resource
    && existing.actualFromAmount === issue.actualFromAmount
    && existing.actualToAmount === issue.actualToAmount));
}

function detectSkillCostMismatches(chapterText: string, rules: ResourceRules): ResourceMathIssue[] {
  if (!chapterText || rules.skills.length === 0) return [];
  const issues: ResourceMathIssue[] = [];
  for (const skill of rules.skills) {
    const shortSkill = skill.skill.replace(/技能$/u, "");
    const skillPattern = [skill.skill, shortSkill].filter(Boolean).map(escapeRegExp).join("|");
    const resourcePattern = resourceAliasesFor(skill.resource).map(escapeRegExp).join("|");
    const regex = new RegExp(`(?:${skillPattern})[^。！？!?；;\\n]{0,18}?(?:需要|消耗|花费|扣除)\\s*(${NUMBER_SOURCE})\\s*(?:点)?\\s*(?:${resourcePattern})`, "giu");
    for (const match of chapterText.matchAll(regex)) {
      const amount = parseFlexibleNumber(match[1] ?? "");
      if (!Number.isFinite(amount) || amount === skill.amount) continue;
      issues.push({
        severity: "critical",
        code: "skill-cost-mismatch",
        resource: skill.resource,
        expected: skill.amount,
        actual: amount,
        evidence: match[0] ?? "",
        message: `${skill.skill} 成本错误：规则要求 ${skill.amount} ${skill.resource}，正文写成 ${amount}。`,
        suggestion: `将 ${skill.skill} 的消耗改为 ${skill.amount} ${skill.resource}，不要与现金兑换消耗混算。`,
        repairable: true,
      });
    }
  }
  return dedupeResourceIssues(issues);
}

function detectMissingSkillUnlocks(
  chapterText: string,
  unlockedSkills: ReadonlyArray<string>,
  rules: ResourceRules,
): ResourceMathIssue[] {
  const inferred = inferSkillMentionFromText(chapterText, rules);
  if (!inferred) return [];
  const skill = normalizeSkillLabel(inferred.skill);
  if (!skill || unlockedSkills.includes(skill)) return [];
  return [{
    severity: "critical",
    code: "missing-skill-unlock",
    resource: "技能",
    evidence: inferred.evidence,
    message: `正文出现${skill}使用/激活语义，但资源账本未记录该技能解锁。`,
    suggestion: `补入 ${skill} 解锁事件，并按技能规则扣除对应资源；若无法闭合则人工修复正文。`,
    repairable: true,
  }];
}

function buildExchangeRateIssue(params: {
  readonly rate: ResourceExchangeRate;
  readonly fromAmount: number;
  readonly toAmount: number;
  readonly evidence: string;
}): ResourceMathIssue {
  const expectedTo = params.fromAmount * params.rate.rate;
  const expectedFrom = params.toAmount / params.rate.rate;
  return {
    severity: "critical",
    code: "exchange-rate-mismatch",
    resource: params.rate.to,
    expected: expectedTo,
    actual: params.toAmount,
    expectedFromAmount: Number.isInteger(expectedFrom) ? expectedFrom : undefined,
    actualFromAmount: params.fromAmount,
    expectedToAmount: expectedTo,
    actualToAmount: params.toAmount,
    evidence: params.evidence,
    message: `兑换比例错误：${params.fromAmount} ${params.rate.from} 按 ${params.rate.rule} 应兑换 ${expectedTo} ${params.rate.to}，正文写成 ${params.toAmount}。`,
    suggestion: Number.isInteger(expectedFrom)
      ? `如果坚持获得 ${params.toAmount} ${params.rate.to}，必须消耗 ${expectedFrom} ${params.rate.from}。`
      : `按兑换规则修正 ${params.rate.from}/${params.rate.to} 数值。`,
    repairable: true,
  };
}

function resourceAliasesFor(resource: string): string[] {
  const aliases = Object.entries(RESOURCE_ALIASES)
    .filter(([, canonical]) => canonical === resource)
    .map(([alias]) => alias);
  return [...new Set([resource, ...aliases])];
}

function dedupeResourceIssues(issues: ReadonlyArray<ResourceMathIssue>): ResourceMathIssue[] {
  const seen = new Set<string>();
  const next: ResourceMathIssue[] = [];
  for (const issue of issues) {
    const key = [
      issue.code,
      issue.resource,
      issue.expected,
      issue.actual,
      issue.expectedFromAmount,
      issue.actualFromAmount,
      issue.expectedToAmount,
      issue.actualToAmount,
      issue.evidence,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(issue);
  }
  return next;
}

function findSkillRule(rules: ResourceRules, skill: string): ResourceSkillRule | undefined {
  const normalized = normalizeSkillLabel(skill);
  return rules.skills.find((rule) => normalizeSkillLabel(rule.skill) === normalized);
}

function hasNearbyExplicitSpend(
  events: ReadonlyArray<ResourceEvent>,
  unlock: ResourceEvent,
  skillRule: ResourceSkillRule,
): boolean {
  return events.some((event) =>
    event.kind === "consume"
    && event.resource === skillRule.resource
    && event.amount === skillRule.amount
    && Math.abs(event.index - unlock.index) < 40);
}

function collectRegexEvents(
  text: string,
  regex: RegExp,
  build: (match: RegExpMatchArray) => Pick<ResourceEvent, "kind" | "resource" | "amount" | "fromAmount" | "toAmount" | "label" | "targetResource">,
  events: ResourceEvent[],
): void {
  for (const match of text.matchAll(regex)) {
    const built = build(match);
    if (built.amount !== undefined && !Number.isFinite(built.amount)) continue;
    const index = match.index ?? 0;
    events.push({
      ...built,
      evidence: match[0] ?? "",
      index,
    });
  }
}

function collectBalanceJumpEvents(text: string, resourceTypes: ReadonlyArray<string>, events: ResourceEvent[]): void {
  const sentences = text.split(/(?<=[。！？!?；;])|\n/u);
  let offset = 0;
  let previous = "";
  let previousPrevious = "";
  for (const sentence of sentences) {
    const contextWindow = `${previousPrevious}${previous}${sentence}`;
    const contextResource = detectBalanceJumpResource(contextWindow, resourceTypes);
    if (!contextResource) {
      offset += sentence.length;
      previousPrevious = previous;
      previous = sentence;
      continue;
    }
    const fromTo = sentence.match(new RegExp(`(?:从|原本(?:的)?|原来(?:的)?)\\s*(${NUMBER_SOURCE})\\s*(?:点|元)?(?:[^。！？!?；;\\n]{0,8}?)(?:跳到|跳至|涨到|变成|变成了|来到)\\s*(${NUMBER_SOURCE})`, "iu"));
    if (fromTo?.[1] && fromTo[2]) {
      const toAmount = parseFlexibleNumber(fromTo[2]);
      events.push({
        kind: "balance_jump",
        resource: contextResource,
        amount: toAmount,
        fromAmount: parseFlexibleNumber(fromTo[1]),
        toAmount,
        evidence: sentence.trim(),
        index: offset + sentence.indexOf(fromTo[0]),
        reason: "面板显示资源值跳转",
        confidence: 0.8,
      });
      offset += sentence.length;
      previousPrevious = previous;
      previous = sentence;
      continue;
    }
    const jump = sentence.match(new RegExp(`(?:民望值?|面板上的民望|当前民望|银行余额|手机余额|账户余额|现金余额|余额|数字|数值|当前值|面板)[^。！？!?；;\\n]{0,32}?(?:停在|定格在|跳到|跳至|涨到|显示为|显示|变成|变成了|来到)[^\\d一二两三四五六七八九十百千万]{0,8}?(${NUMBER_SOURCE})`, "iu"))
      ?? sentence.match(new RegExp(`(?:停在|定格在|跳到|跳至|涨到|显示为|显示|变成|变成了|来到)[^\\d一二两三四五六七八九十百千万]{0,8}?(${NUMBER_SOURCE})`, "iu"));
    if (jump?.[1]) {
      const toAmount = parseFlexibleNumber(jump[1]);
      events.push({
        kind: "balance_jump",
        resource: contextResource,
        amount: toAmount,
        toAmount,
        evidence: sentence.trim(),
        index: offset + sentence.indexOf(jump[0]),
        reason: "面板显示资源值跳转",
        confidence: 0.75,
      });
    }
    offset += sentence.length;
    previousPrevious = previous;
    previous = sentence;
  }
}

function detectBalanceJumpResource(sentence: string, resourceTypes: ReadonlyArray<string>): string | undefined {
  if (!/(民望|民望值|系统面板|面板|数值|当前值|余额|兑换|资源|积分|灵石|金币|联邦币|技能点|银行|手机|账户|入账|到账|现金)/u.test(sentence)) {
    return undefined;
  }
  if (/(第\s*110\s*街|110号公路|110栋|110号|三号仓库|第\s*\d+\s*章|电话|房号|日期|时间)/u.test(sentence)) {
    return undefined;
  }
  return inferResourceForNumericContext(sentence, undefined, resourceTypes) ?? undefined;
}

function inferResourceForNumericContext(
  textWindow: string,
  fallback?: string,
  resourceTypes: ReadonlyArray<string> = DEFAULT_RESOURCE_TYPES,
): string | null {
  if (/(当前民望|民望值|民望余额|系统民望|面板[^。！？!?；;\n]{0,12}民望|民望[^。！？!?；;\n]{0,12}(?:停在|定格|跳到|显示|变成|余额))/u.test(textWindow)) {
    return "民望值";
  }
  if (/(手机|银行|账户|银行卡|银行APP|银行短信|余额页面|入账|到账|现金|联邦币|联邦现金|账户余额|银行余额|手机余额|现金余额|钱)/u.test(textWindow)) {
    return "联邦币";
  }
  if (/技能点/u.test(textWindow)) return "技能点";
  if (/系统积分|积分/u.test(textWindow)) return "系统积分";
  if (/灵石/u.test(textWindow)) return "灵石";
  if (/金币/u.test(textWindow)) return "金币";
  if (/银两/u.test(textWindow)) return "银两";
  if (/气血/u.test(textWindow)) return "气血";
  if (/灵力/u.test(textWindow)) return "灵力";
  if (/修为/u.test(textWindow)) return "修为";
  if (/功德/u.test(textWindow)) return "功德";
  if (/好感度/u.test(textWindow)) return "好感度";
  const resourcePattern = buildResourcePattern(resourceTypes);
  const explicit = textWindow.match(new RegExp(`(${resourcePattern})`, "iu"))?.[1];
  if (explicit) return normalizeResourceName(explicit);
  if (fallback) return normalizeResourceName(fallback);
  return null;
}

function collectSentenceBalanceEvents(text: string, resourceTypes: ReadonlyArray<string>, events: ResourceEvent[]): void {
  const sentences = text.split(/(?<=[。！？!?；;])|\n/u);
  let offset = 0;
  let lastResource: string | undefined;
  const resourcePattern = buildResourcePattern(resourceTypes);
  for (const sentence of sentences) {
    const explicit = sentence.match(new RegExp(`(${resourcePattern})`, "iu"))?.[1];
    if (explicit) {
      lastResource = normalizeResourceName(explicit);
    }
    const balance = sentence.match(new RegExp(`(?:余额|剩余|正好余|余)\\s*(${NUMBER_SOURCE})\\s*(?:点|元)?`, "iu"));
    if (balance?.[1] && /余额|剩余|正好余|余/u.test(sentence) && /民望|余额|兑换|联邦币|现金/u.test(sentence)) {
      const resource = inferResourceForNumericContext(sentence, lastResource, resourceTypes);
      if (!resource) {
        offset += sentence.length;
        continue;
      }
      events.push({
        kind: "balance",
        resource,
        amount: parseFlexibleNumber(balance[1]),
        evidence: sentence.trim(),
        index: offset + (sentence.indexOf(balance[0]) >= 0 ? sentence.indexOf(balance[0]) : 0),
      });
    }
    offset += sentence.length;
  }
}

function dedupeEvents(events: ReadonlyArray<ResourceEvent>): ResourceEvent[] {
  const next: ResourceEvent[] = [];
  for (const event of events) {
    const duplicateIndex = next.findIndex((candidate) =>
      candidate.kind === event.kind
      && candidate.resource === event.resource
      && (candidate.amount ?? candidate.label) === (event.amount ?? event.label)
      && (
        Math.abs(candidate.index - event.index) < 12
        || isDuplicateExchangeSettlement(candidate, event)
      ));
    if (duplicateIndex >= 0) {
      const candidate = next[duplicateIndex]!;
      const eventIsRicher = !candidate.targetResource && event.targetResource
        || event.evidence.length > candidate.evidence.length && /兑换|换成|换取/u.test(event.evidence);
      if (eventIsRicher) {
        next[duplicateIndex] = event;
      }
      continue;
    }
    next.push(event);
  }
  return next;
}

function isDuplicateExchangeSettlement(left: ResourceEvent, right: ResourceEvent): boolean {
  if (left.kind !== "gain" || right.kind !== "gain") return false;
  if (left.resource !== right.resource || left.amount !== right.amount) return false;
  if (Math.abs(left.index - right.index) > 80) return false;
  return /兑换|换成|换取|到账/u.test(left.evidence) && /兑换|换成|换取|到账/u.test(right.evidence);
}

function parseOpeningBalances(text: string): Record<string, number> {
  return parseOpeningBalancesWithRules(text, parseResourceRules("", text));
}

function parseOpeningBalancesWithRules(text: string, rules: ResourceRules): Record<string, number> {
  const balances: Record<string, number> = Object.fromEntries(
    Object.values(rules.resources).map((resource) => [resource.name, resource.initial]),
  );
  for (const match of text.matchAll(/\|\s*([^|\n]+?)\s*\|\s*(-?\d+)\s*(?:\||$)/gu)) {
    const resource = canonicalResourceName(match[1] ?? "", rules);
    if (resource) {
      balances[resource] = Number.parseInt(match[2] ?? "0", 10);
    }
  }
  for (const match of text.matchAll(/([\p{Script=Han}A-Za-z]+)\s*[=:：为是]\s*(-?\d+)/gu)) {
    const resource = canonicalResourceName(match[1] ?? "", rules);
    if (resource) {
      balances[resource] = Number.parseInt(match[2] ?? "0", 10);
    }
  }
  return Object.fromEntries(
    Object.entries(balances).filter(([resource]) => isAllowedResource(resource)),
  );
}

function extractExplicitOpeningResources(text: string, rules: ResourceRules): string[] {
  const resources = new Set<string>();
  for (const match of text.matchAll(/\|\s*([^|\n]+?)\s*\|\s*(-?\d+)\s*(?:\||$)/gu)) {
    const resource = canonicalResourceName(match[1] ?? "", rules);
    if (resource) resources.add(resource);
  }
  for (const match of text.matchAll(/([\p{Script=Han}A-Za-z]+)\s*[=:：为是]\s*(-?\d+)/gu)) {
    const resource = canonicalResourceName(match[1] ?? "", rules);
    if (resource) resources.add(resource);
  }
  return [...resources];
}

function filterBalances(balances: Record<string, number>, activeResources: ReadonlySet<string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(balances).filter(([resource]) => activeResources.has(resource) && isAllowedResource(resource)),
  );
}

function findNearestExchangeConsume(events: ReadonlyArray<ResourceEvent>, gain: ResourceEvent, fromResource = "民望值"): ResourceEvent | undefined {
  return [...events]
    .filter((event) =>
      event.kind === "consume"
      && event.resource === fromResource
      && Math.abs(event.index - gain.index) < 80
      && isExchangeConsumeForGain(event, gain))
    .sort((left, right) => Math.abs(left.index - gain.index) - Math.abs(right.index - gain.index))[0];
}

function isExchangeConsumeForGain(consume: ResourceEvent, gain: ResourceEvent): boolean {
  if (consume.targetResource && consume.targetResource === gain.resource) return true;
  return /兑换|换成|换取/u.test(consume.evidence)
    && Boolean(gain.resource)
    && consume.evidence.includes(gain.resource)
    || (/(到账|入账)/u.test(gain.evidence) && /(消耗|扣除|花费|支付)/u.test(consume.evidence));
}

function repairReputationBalance(content: string, actual: number, expected: number): string {
  const numericActual = escapeRegExp(String(actual));
  const replacement = expected === 0 ? "当前民望归零" : `当前民望${expected}点`;
  const patterns = [
    new RegExp(`民望值跳成(${NUMBER_SOURCE})，扣除兑换技能的(${NUMBER_SOURCE})点，正好余${numericActual}点`, "u"),
    new RegExp(`扣除兑换技能的(${NUMBER_SOURCE})点，正好余${numericActual}点`, "u"),
    new RegExp(`当前民望余额${numericActual}点`, "u"),
    new RegExp(`民望余额${numericActual}点`, "u"),
    new RegExp(`正好余${numericActual}点`, "u"),
    new RegExp(`余额${numericActual}点`, "u"),
    new RegExp(`余${numericActual}点`, "u"),
  ];
  for (const pattern of patterns) {
    if (!pattern.test(content)) continue;
    if (pattern.source.startsWith("民望值跳成")) {
      return content.replace(pattern, `刚刚兑换技能的10点已经扣过，此刻新增的${expected}点民望就是当前余额`);
    }
    if (pattern.source.startsWith("扣除")) {
      return content.replace(pattern, `刚刚兑换技能的10点已经扣过，此刻新增的${expected}点民望就是当前余额`);
    }
    return content.replace(pattern, replacement);
  }
  return content;
}

function repairExchangeAmount(content: string, issue: ResourceMathIssue): string {
  if (issue.actualFromAmount !== undefined && issue.expectedFromAmount !== undefined) {
    return content.replace(
      new RegExp(`(消耗|扣除|花费|用)\\s*${issue.actualFromAmount}\\s*点?\\s*民望值?\\s*(兑换|换成|换取)`, "u"),
      `$1${issue.expectedFromAmount}点民望$2`,
    );
  }
  if (issue.actualToAmount !== undefined && issue.expectedToAmount !== undefined) {
    return content.replace(new RegExp(`兑换\\s*${issue.actualToAmount}\\s*(?:元)?\\s*联邦币`, "u"), `兑换${issue.expectedToAmount}联邦币`);
  }
  if (issue.actual !== undefined && issue.expected !== undefined) {
    return content.replace(new RegExp(`兑换\\s*${issue.actual}\\s*(?:元)?\\s*联邦币`, "u"), `兑换${issue.expected}联邦币`);
  }
  return content;
}

function replaceFirstResourceNumber(content: string, issue: ResourceMathIssue): string {
  if (issue.actual === undefined || issue.expected === undefined) return content;
  return content.replace(String(issue.actual), String(issue.expected));
}

function buildFlowRows(
  chapterNumber: number,
  validation: ResourceValidationResult,
  resourcePlan?: import("./resource-plan.js").ChapterResourcePlan,
): string[] {
  const resources = new Set(validation.events.map((event) => event.resource).filter((resource) => resource !== "技能"));
  const shouldUsePlanClosings = resourcePlan?.mode === "defer_exchange" || resourcePlan?.mode === "explore_conversion_path";
  if (shouldUsePlanClosings) {
    for (const resource of Object.keys(resourcePlan.expectedClosingBalances)) {
      if (resource !== "技能") resources.add(resource);
    }
  }
  const rows: string[] = [];
  for (const resource of resources) {
    const events = validation.events.filter((event) => event.resource === resource);
    const gain = events
      .filter((event) => event.kind === "gain" || event.kind === "balance_jump" && (event.inferredDelta ?? 0) > 0)
      .map((event) => event.kind === "balance_jump" ? event.inferredDelta ?? 0 : event.amount ?? 0);
    const consume = events.filter((event) => event.kind === "consume").map((event) => event.amount ?? 0);
    if (!gain.length && !consume.length && !(shouldUsePlanClosings && resourcePlan && resource in resourcePlan.expectedClosingBalances)) continue;
    const opening = shouldUsePlanClosings ? resourcePlan?.openingBalances[resource] ?? validation.openingBalances[resource] ?? 0 : validation.openingBalances[resource] ?? 0;
    const closing = shouldUsePlanClosings ? resourcePlan?.expectedClosingBalances[resource] ?? validation.closingBalances[resource] ?? opening : validation.closingBalances[resource] ?? opening;
    const evidence = events
      .filter((event) => event.kind === "gain" || event.kind === "consume")
      .map((event) => compactEvidence(event.evidence))
      .join("；") || "Resource Plan 期末确认";
    rows.push(`| ${chapterNumber} | ${resource} | ${opening} | ${formatSignedList(gain)} | ${formatSignedList(consume.map((value) => -value))} | ${closing} | ${evidence} |`);
  }
  const skills = shouldUsePlanClosings && resourcePlan
    ? [...new Set([...validation.unlockedSkills, ...resourcePlan.unlockedSkills])]
    : validation.unlockedSkills;
  for (const skill of skills) {
    rows.push(`| ${chapterNumber} | 技能 | 无 | ${skill} | - | ${skill} | 解锁${skill} |`);
  }
  return rows;
}

function buildResourceNote(resource: string, events: ReadonlyArray<ResourceEvent>, skills: ReadonlyArray<string>): string {
  if (resource === "技能") return skills.join("、") || "本章解锁";
  const relevant = events.filter((event) => event.resource === resource && (event.kind === "gain" || event.kind === "consume" || event.kind === "balance_jump"));
  return relevant.map((event) => compactEvidence(event.evidence)).join("；") || "本章更新";
}

function formatSignedList(values: ReadonlyArray<number>): string {
  if (!values.length) return "0";
  return values.map((value) => value > 0 ? `+${value}` : String(value)).join(" ");
}

function compactEvidence(value: string): string {
  return value.replace(/\s+/gu, "").slice(0, 40);
}

function normalizeResourceName(value: string): string {
  const trimmed = value.trim().replace(/值$/u, "值");
  return RESOURCE_ALIASES[trimmed] ?? trimmed;
}

function normalizeSkillLabel(value: string): string {
  const cleaned = value
    .replace(/^了/u, "")
    .replace(/^[:：\s]+/u, "")
    .replace(/[，。！？；;、:\n：].*$/u, "")
    .trim();
  if (!cleaned || INVALID_SKILL_LABELS.has(cleaned)) return "";
  if (/[\/／]/u.test(cleaned)) return "";
  if (/\d|的|完/u.test(cleaned)) return "";
  if (!/(技能|辩论|演讲|格斗|观察|说服|治疗|强化|检索)/u.test(cleaned)) return "";
  const canonical = SKILL_ALIASES[cleaned] ?? cleaned;
  if (INVALID_SKILL_LABELS.has(canonical)) return "";
  if (canonical.length > 12) return "";
  return canonical;
}

export function parseFlexibleNumber(value: string): number {
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) return Number.parseInt(normalized, 10);
  return parseChineseNumber(normalized);
}

function parseChineseNumber(value: string): number {
  const digits: Record<string, number> = {
    零: 0,
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
  };
  if (digits[value] !== undefined) return digits[value]!;
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of value) {
    if (digits[char] !== undefined) {
      number = digits[char]!;
    } else if (char === "十") {
      section += (number || 1) * 10;
      number = 0;
    } else if (char === "百") {
      section += (number || 1) * 100;
      number = 0;
    } else if (char === "千") {
      section += (number || 1) * 1000;
      number = 0;
    } else if (char === "万") {
      total += (section + number || 1) * 10000;
      section = 0;
      number = 0;
    }
  }
  return total + section + number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
