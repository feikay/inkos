# Resource Schema / Stage Plan / Fallback / Publish-Ready 资源门禁盘点报告

**运行编号**: run-011 | **时间**: 2026-05-20 | **执行者**: Claude Code

## 执行摘要

本轮对 Resource Engine 的资源 schema 来源、章节阶段 Resource Plan mode、fallback recovery 分派逻辑、publish-ready 资源门禁进行了完整的只读盘点。发现了5个抽象缺陷，需要在不写成书名/资源名特例的前提下修复。

---

## 1. 资源白名单 / Alias / 默认资源从哪里来

**结论：三个硬编码常量，全部位于 `resource-consistency.ts`。**

| 常量 | 位置 | 内容 |
|---|---|---|
| `DEFAULT_RESOURCE_TYPES` | L169-187 | 17个硬编码资源类型：民望值、联邦币、现金、竞选资金、固定支持者数、技能、技能点、系统积分、灵石、金币、银两、经验值、气血、灵力、修为、功德、好感度 |
| `RESOURCE_ALIASES` | L189-214 | 24个别名映射：民望→民望值、现金→联邦币、钱→联邦币、积分→系统积分、系统资源→系统积分等 |
| `CANONICAL_RESOURCE_WHITELIST` | L216-218 | `Set(DEFAULT_RESOURCE_TYPES.map(r => RESOURCE_ALIASES[r] ?? r))` |

**资源规则注入流程**（`parseResourceRules()`, L394-456）：

```
Step 1: 注入全部17个 DEFAULT_RESOURCE_TYPES（L394-396）
Step 2: 注入全部 RESOURCE_ALIASES 的 canonical + alias 映射（L397-399）
Step 3: 从 book_rules.md 的 resourceTypes 块提取额外资源类型（L401-407）
Step 4: 从 book_rules.md 的 resources 块解析 initial/min/max/type/aliases（L414-440）
Step 5: 从 book_rules.md 解析 exchangeRates / skills（L442-446）
Step 6: 从 particle_ledger / current_state 提取 opening balances（L448-454）
```

**`isAllowedResource()` 门禁**（L1679）：
```typescript
CANONICAL_RESOURCE_WHITELIST.has(resource)
```
只允许白名单资源通过，但白名单本身是全局通用的。

---

## 2. 是否存在全局默认资源污染

**结论：存在。17个 DEFAULT_RESOURCE_TYPES 覆盖玄幻/修仙/都市/系统流等多种题材，全部注入到每本书的资源规则中，无论题材是否相关。**

**具体影响**：

1. **`parseResourceRules()` 无条件注入**（L394-396）：一本都市重生小说会获得 `灵石`、`金币`、`银两`、`气血`、`灵力`、`修为`、`功德` 作为合法资源类型
2. **`buildResourcePattern()` 构建全量正则**（L1467-1472）：所有资源类型都进入 `resourcePattern`，正则可能跨题材误匹配
3. **别名映射跨题材生效**：`积分→系统积分`、`钱→联邦币` 在所有书中生效，即使该书没有系统积分或联邦币概念

**污染程度**：
- **轻度污染**：资源类型注入但未触发实际匹配（章节中没有该词汇）
- **中度污染**：`inferResourceForNumericContext()` 把普通叙事词汇映射为资源名（如"手机余额"→联邦币）
- **重度污染**：`collectBalanceJumpEvents()` 以低置信度（0.75）记录"余额跳转"事件，即使不是资源面板

**抽象层面**：`parseResourceRules` 缺少"按 book_rules.md 声明的 resourceTypes 限定生效范围"的步骤。`DEFAULT_RESOURCE_TYPES` 是题材无关的通用池，但在注入时应以 `book_rules.md` 的显式声明为 gate。

---

## 3. 普通数字/价格/金额如何被判入资源账本

**结论：三组检测函数只靠词汇上下文推断，没有"此数字是否属于资源账本"的判定层。**

### 路径 A：`collectBalanceJumpEvents()` (L1981-2033)

检测"从X跳到Y"、"停在/定格在/显示为N"模式。核心 pattern（L2014）：

```
/(民望值?|面板上的民望|当前民望|银行余额|手机余额|账户余额|现金余额|余额|数字|数值|当前值|面板)
 [^。！？!?；;\n]{0,32}?
 (?:停在|定格在|跳到|跳至|涨到|显示为|显示|变成|变成了|来到)
 [^\d一二两三四五六七八九十百千万]{0,8}?
 (NUMBER)/iu
```

**风险**：`"银行余额显示为5000元"` → 普通银行账户被识别为联邦币余额跳转。

### 路径 B：`detectBalanceJumpResource()` (L2035-2043)

触发关键词包含 `银行|手机|账户|入账|到账|现金`。排除词（L2039）：
`第110街|110号公路|110栋|110号|三号仓库|第N章|电话|房号|日期|时间`

**遗漏的排除模式**：缺少 `价格|单价|总价|订单金额|消费金额|花费.*元|花了.*元|付了.*元|转账|汇款` 等普通金融词汇的排除。

### 路径 C：`inferResourceForNumericContext()` (L2045-2071)

优先级链中，第二步 `手机|银行|账户|银行卡|入账|到账|现金|钱 → 联邦币` 过于激进。
一本非系统流小说中"手机收到银行短信，入账5000元"会被识别为联邦币 gain 事件。

### 路径 D：`extractResourceEvents()` 正则 (L474-508)

`"赔偿N元(联邦币|现金)"` — "赔偿司机200元现金" 会被提取为联邦币 consume。

### 根本原因

**缺少"叙事数字 vs 资源账本数字"的区分机制**。所有数字检测都直接对接资源类型，没有中间层判断：这个数字是在描述系统面板/资源余额，还是在描述普通剧情中的金钱/价格/金额。

---

## 4. 当前 Resource Plan Mode 有哪些，是否缺少通用 mode

**结论：当前5个 mode，缺少 `system_bootstrap` 和 `resource_rule_reveal` 两个通用 mode。**

### 现有 mode（`resource-plan.ts` L10）

| Mode | 语义 | 触发条件 |
|---|---|---|
| `normal` | 正常资源变化 | generic inference 命中 |
| `defer_exchange` | 延后现金兑换 | `buildChapter2CivicDeferExchangePlanIfMatched()` 命中 |
| `explore_conversion_path` | 探索兑换路径 | `buildExploreConversionPathPlanIfMatched()` 命中 |
| `cash_exchange_allowed` | 允许现金兑换 | 未在当前代码中实现触发 |
| `no_resource_change` | 无资源变化 | 无资源或无 ledger 活动；generic inference 未命中；fallback |

### 缺失的 mode

| 缺失 Mode | 语义 | 为什么需要 |
|---|---|---|
| `system_bootstrap` | 系统首次激活/绑定/规则揭示 | 允许 unlock、discover、balance_claim，但禁止未计划收益到账。系统首次出现的章节（如第1章激活系统）没有专用 mode，当前只能回退到 `no_resource_change` 或 `normal` |
| `resource_rule_reveal` | 章节揭示某项资源的运作规则 | 允许 discover、explain，但禁止 earn/spend。当章节主题是"解释XX资源怎么用"时，不应允许资源变动 |

### 选择逻辑的硬编码问题（`buildChapterResourcePlan`, L150-221）

```
Step 1: buildChapter2CivicDeferExchangePlanIfMatched()
  → 硬编码检测 "chapter 2 + civic system + 民望值 + 联邦币 + 初级辩论技能"
Step 2: buildExploreConversionPathPlanIfMatched()
  → 硬编码检测 explore/conversion 阶段关键词
Step 3: 无资源/无ledger活动 → no_resource_change
Step 4: inferGenericResourcePlan() → 通用推理
Step 5: fallback → no_resource_change
```

**问题**：Step 1-2 是题材/章节号特异的硬编码（"chapter 2"、"民望值"、"联邦币"、"初级辩论技能"、"扶老太太"、"反击汤姆"）。这些应该抽象为"当前章节是否处于系统引导期"的通用判断。

---

## 5. Fallback Recovery 是否按 Resource Schema 和 Plan Mode 分派

**结论：否。`buildFallbackRecoveryPlan()` 无条件选择 `defer_exchange`，不做 schema/mode gating。**

### 证据（runner.ts L4838-4848）

```typescript
function buildFallbackRecoveryPlan(params) {
  if (params.failedPlan.strategy !== "add_earned_resource_before_spend") return undefined;
  return buildResourceRecoveryPlans({...})
    .find((plan) => plan.strategy === "defer_exchange");
}
```

### 缺少的分派逻辑

| 应检查条件 | 当前状态 |
|---|---|
| book_rules 是否定义了 exchangeRates | 未检查 |
| 当前 Resource Plan mode 是否允许 exchange | 未检查 |
| 当前章节是否有现金/兑换类资源 | 未检查 |
| `defer_exchange` 是否适用于当前资源类型组合 | 未检查 |
| Resource Plan 的 `forbiddenEvents` 是否包含 exchange | 未检查 |

### 后果

- 没有兑换规则的修仙小说被 fallback 到 `defer_exchange` → 模板补丁可能建议"将民望兑换为联邦币"，但该小说根本没有联邦币
- `no_resource_change` mode 章节被 fallback 到 `defer_exchange` → 与 Resource Plan 声明的 mode 矛盾
- 日志"resource-engine: falling back to defer_exchange"（L3404）硬编码，不反映实际选择

---

## 6. Publish-Ready / Write-Publish-Export 是否把资源闭合失败作为硬阻断

**结论：否。三个相关模块都没有资源门禁。**

### 6.1 `review publish-ready` CLI（review.ts L1082-1201）

`runPublishReadyChapter()` 的阻断条件：
- `BLOCKED_BY_CONTINUITY` — 33维连续性审计（已实现）
- **无资源阻断** — 不读取 resource consistency report
- `closureStatus=resource_failed` 不触发任何阻断
- `blocked-resource-plan` chapter 可以正常通过 publish-ready

### 6.2 `fanqie-quality.ts`（L1-100）

- `FanqieQualityReport` 只有 `publish_blocked_by_continuity: boolean`
- 没有 `publish_blocked_by_resource: boolean`
- 没有 `closureStatus` 字段
- 不接收 resource consistency report 作为输入

### 6.3 `export-artifact.ts`（L58-151）

- `buildExportArtifact()` 唯一过滤条件：`chapter.status === "approved"`（L71）
- 不检查 `blocked-resource-plan` 或 `state-degraded`
- 不检查 resource consistency report 的 `closureStatus` 或 `blocking`

### 6.4 `write-publish-export.mjs`（1531行）

- 零引用 `closureStatus`、`resource_failed`、`blocked-resource-plan`、`state-degraded`
- 脚本可以正常导出 resource_failed 的章节

### 唯一阻断点

`assertNoPendingStateRepair()`（runner.ts L2953-2963）在 `writeNextChapter` 管线入口检查最新章是否为 `blocked-resource-plan` 或 `state-degraded`，阻止续写。但**不阻止发布/导出**。

---

## 7. 下一轮最小抽象实现方案

### 原则

- 不允许写成书名/资源名/章节号特例
- 所有修复是数据结构、程序规则、prompt约束或流程门禁
- 改动范围：resource-consistency.ts、resource-plan.ts、runner.ts、fanqie-quality.ts、export-artifact.ts、review.ts

### 7.1 Book-level Resource Schema（修复 Gap 1）

**改动**：`parseResourceRules()` 增加 gate 步骤

```
当前: DEFAULT_RESOURCE_TYPES → 全部注入 → book_rules 补充
修改: DEFAULT_RESOURCE_TYPES → 只注入 book_rules.md resourceTypes 块显式声明的类型 → book_rules 补充
      如果 book_rules.md 没有 resourceTypes 块 → 回退到 DEFAULT_RESOURCE_TYPES（向后兼容）
```

**新增数据结构**：无需新增。修改 `parseResourceRules` 内部的注入过滤逻辑。

### 7.2 叙事数字过滤层（修复 Gap 2）

**改动**：`extractResourceEvents()` 调用前增加 pre-filter

```typescript
const NON_RESOURCE_FINANCIAL_PATTERNS = [
  /价格|单价|总价|订单金额|消费金额|打车费|外卖费|快递费|运费|房租|水电费|物业费/,
  /花了.*元|付了.*元|转账|汇款|工资|薪水|奖金.*元|报销/,
];

function isNarrativeFinancialContext(textWindow: string): boolean {
  return NON_RESOURCE_FINANCIAL_PATTERNS.some(p => p.test(textWindow))
    && !/(系统面板|系统商店|兑换|资源余额|民望值|灵石|金币|银两|气血|灵力|修为)/u.test(textWindow);
}
```

**改动位置**：`collectBalanceJumpEvents()` L1987 处，在 `contextResource` 判定后，先用 `isNarrativeFinancialContext()` 过滤。

### 7.3 System Bootstrap Mode（修复 Gap 3）

**新增** `ChapterResourcePlanMode` 枚举值：`"system_bootstrap"` | `"resource_rule_reveal"`

**新增函数**：`buildSystemBootstrapPlanIfMatched()` — 通用检测逻辑：

```typescript
function detectSystemBootstrapStage(params: {
  chapter: number;
  bookRules: string;
  particleLedger: string;
  currentState: string;
  chapterGoal?: string;
  resourceRules: ResourceRules;
}): boolean {
  const inferenceText = [params.chapterGoal, params.currentState,
    params.bookRules, params.particleLedger].filter(Boolean).join("\n");
  const hasSystemIntro = /系统.{0,16}(?:激活|绑定|觉醒|赋予|开启|初始化)/u.test(inferenceText);
  const hasFirstResourceReveal = /(?:获得|激活|解锁|开启).{0,8}(?:系统|面板|能力|技能).{0,16}(?:首次|第一次|初始)/u.test(inferenceText);
  const isEarlyChapter = params.chapter <= 3;
  const hasResourceTypes = Object.keys(params.resourceRules.resources).length > 0;
  return (hasSystemIntro || hasFirstResourceReveal) && isEarlyChapter && hasResourceTypes;
}
```

**系统引导期禁止事件**（抽象规则）：
- `forbiddenEvents`: `["exchange", "cash_out", "balance_transfer"]`
- `allowedEvents`: 只允许 `unlock`, `discover`, `balance_claim`（首次余额声明）
- `closureRequirement`: `"explicit_balance_required"` — 必须声明初始余额
- 禁止 `gain`/`consume` 事件（除非 Resource Plan 显式允许）

### 7.4 Fallback Recovery Schema/Mode Gate（修复 Gap 4）

**改动**：`buildFallbackRecoveryPlan()` 增加 gate

```typescript
function buildFallbackRecoveryPlan(params: {
  validation: ResourceValidationResult;
  chapterIntent: string;
  failedPlan: ReturnType<typeof selectResourceRecoveryPlan>;
  resourceRules: ResourceRules;       // 新增
  planMode: ChapterResourcePlanMode;  // 新增
}): ReturnType<typeof selectResourceRecoveryPlan> | undefined {
  const hasExchangeRates = params.resourceRules.exchangeRates.length > 0;
  const exchangeAllowed = !["no_resource_change", "system_bootstrap",
    "resource_rule_reveal"].includes(params.planMode);

  if (!hasExchangeRates || !exchangeAllowed) {
    return buildNoResourceChangePatch({...});
  }

  // ... 只有当 schema 支持兑换且 mode 允许时才选 defer_exchange
}
```

### 7.5 Publish-Ready Resource Hard Gate（修复 Gap 5）

**改动 A**：`runPublishReadyChapter()` 增加资源门禁

在 continuity 检查之前读取 resource consistency report；若 `blocking===true` 或 `closureStatus==="resource_failed"`，返回新状态 `"BLOCKED_BY_RESOURCE"`。

**改动 B**：`FanqieQualityReport` 增加 `publish_blocked_by_resource: boolean`

**改动 C**：`buildExportArtifact()` 增加资源状态过滤

```typescript
const chapters = index.filter(ch =>
  ch.status !== "blocked-resource-plan" && ch.status !== "state-degraded");
```

### 改动文件清单

| 文件 | 改动性质 |
|---|---|
| `resource-consistency.ts` | 注入 gate + 叙事数字过滤 |
| `resource-plan.ts` | 新增 system_bootstrap / resource_rule_reveal mode + 通用检测 |
| `runner.ts` | fallback recovery schema/mode gate |
| `fanqie-quality.ts` | 新增 publish_blocked_by_resource 字段 |
| `export-artifact.ts` | 资源状态过滤 |
| `review.ts`（CLI） | publish-ready 资源门禁 |

---

## 8. 下一轮测试计划与真实业务验证计划

### 8.1 单元测试

| 测试 | 覆盖点 |
|---|---|
| `parseResourceRules` 只注入 book_rules 声明的资源类型 | Gap 1 |
| `parseResourceRules` 在无 resourceTypes 块时回退到 DEFAULT | Gap 1 兼容 |
| `extractResourceEvents` 不提取 "打车费30元" 为资源事件 | Gap 2 |
| `collectBalanceJumpEvents` 不把 "银行余额5000元" 当联邦币跳转 | Gap 2 |
| `isNarrativeFinancialContext` 正确区分叙事金融 vs 资源面板 | Gap 2 |
| `buildSystemBootstrapPlanIfMatched` 通用检测系统激活章节 | Gap 3 |
| system_bootstrap mode 禁止 gain/consume/exchange | Gap 3 |
| `buildFallbackRecoveryPlan` 在无兑换规则时回退到 no_resource_change | Gap 4 |
| `buildFallbackRecoveryPlan` 在 no_resource_change mode 时不选 defer_exchange | Gap 4 |
| `buildExportArtifact` 排除 blocked-resource-plan 章节 | Gap 5 |
| `runPublishReadyChapter` 在 resource_failed 时返回 BLOCKED_BY_RESOURCE | Gap 5 |

### 8.2 `classifyClosureStatus` 补充测试

当前已有12个测试覆盖所有5个状态。本轮不要求新增，但实现后需验证：
- system_bootstrap mode + 正常余额声明 → `normal_closed`
- resource_rule_reveal mode + 无资源事件 → `no_change_closed`

### 8.3 真实业务验证计划

1. **选书**：使用 `我使用系统当上美国总统3`（当前4章，Ch4 blocked-resource-plan）
2. **验证1**：修复后 `publish-ready` 对 Ch4 返回 `BLOCKED_BY_RESOURCE`
3. **验证2**：修复后 `export` 不导出 Ch4
4. **验证3**：创建新书验证 system_bootstrap mode 正确定义初始资源绑定
5. **验证4**：叙事金融文本不被误提取为资源事件（使用包含"打车/外卖/银行转账"的测试章节）
6. **执行规则**：按 `docs/write-book.md` 后台命令规则，记录 PID/log/exit

---

## 9. 如何避免写成书名/题材/资源名特例补丁

### 9.1 抽象规则

| 禁止 | 替代 |
|---|---|
| `if (bookName === "我使用系统当上美国总统3")` | 检测 `book_rules.md` 的 `resourceTypes` 是否包含某资源类型 |
| `if (resourceName === "民望值")` | 检测 resource rule 的 `type` 字段，用数据结构驱动 |
| `if (chapter === 2 && hasCivicKeywords)` | 检测章节是否处于"系统激活/首次资源揭示"阶段 |
| `if (text.includes("联邦币"))` | 用 `buildResourcePattern(resourceTypes)` 动态匹配 |
| `if (genre === "civic")` | 检测 `book_rules.md` 声明的资源类型组合特征 |

### 9.2 具体措施

1. **所有资源名**必须从 `book_rules.md` 的 `resourceTypes` 块派生，不允许在代码中硬编码判断
2. **章节阶段判断**用通用关键词组合（`系统.{0,16}(?:激活|绑定)`），不限定具体系统名
3. **题材特征**用资源类型组合推断（如有 `灵石+灵力+修为`→修仙），但只影响 plan mode 选择，不影响规则本身
4. **现有硬编码清理**：`buildChapter2CivicDeferExchangePlanIfMatched()` 中的 `"扶老太太"`、`"反击汤姆"`、`"初级辩论技能"` 等应重构为通用检测
5. **验证样本**只作为 evidence，不进入代码。禁止把任何书名或资源名写入分支条件

---

## 附录：关键代码位置索引

| 内容 | 文件 | 行号 |
|---|---|---|
| DEFAULT_RESOURCE_TYPES | resource-consistency.ts | 169-187 |
| RESOURCE_ALIASES | resource-consistency.ts | 189-214 |
| CANONICAL_RESOURCE_WHITELIST | resource-consistency.ts | 216-218 |
| CORE_RESOURCE_SET | resource-consistency.ts | 220-232 |
| parseResourceRules | resource-consistency.ts | 394-461 |
| extractResourceEvents | resource-consistency.ts | 464-508 |
| buildResourcePattern | resource-consistency.ts | 1467-1472 |
| collectBalanceJumpEvents | resource-consistency.ts | 1981-2033 |
| detectBalanceJumpResource | resource-consistency.ts | 2035-2043 |
| inferResourceForNumericContext | resource-consistency.ts | 2045-2071 |
| collectSentenceBalanceEvents | resource-consistency.ts | 2073-2100 |
| classifyClosureStatus | resource-consistency.ts | 771-792 |
| isAllowedResource | resource-consistency.ts | 1679 |
| ChapterResourcePlanMode | resource-plan.ts | 10 |
| buildChapterResourcePlan | resource-plan.ts | 140-221 |
| buildChapter2CivicDeferExchangePlanIfMatched | resource-plan.ts | 224-279 |
| buildFallbackRecoveryPlan | runner.ts | 4838-4848 |
| assertNoPendingStateRepair | runner.ts | 2953-2963 |
| runPublishReadyChapter | review.ts (CLI) | 1082-1201 |
| buildExportArtifact | export-artifact.ts | 58-131 |
| runFanqieQualityCheck | fanqie-quality.ts | 74-91 |
