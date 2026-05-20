# Resource Schema / Stage Plan / Fallback / Publish-Ready 资源门禁实现报告

**运行编号**: run-012 | **时间**: 2026-05-20 | **执行者**: Claude Code

## 执行摘要

本轮对 run-011 盘点出的5个抽象缺口进行了最小抽象实现。修改6个源码文件 + 1个测试文件，新增9个测试（1083/1083 全部通过），真实业务验证确认 publish-ready 对 resource_failed 章节返回 BLOCKED_BY_RESOURCE。

---

## 1. Gap 1：Book-level Resource Schema Gate

**文件**: `packages/core/src/agents/resource-consistency.ts` — `parseResourceRules()`

**修改**: 在注入 DEFAULT_RESOURCE_TYPES 之前，先解析 book_rules.md 的 `resourceTypes:` 块。如果存在显式声明，只注入声明的资源类型；如果不存在，回退到全部默认注入（向后兼容）。

**抽象保证**: `declaredTypes` 是 YAML 解析结果，不包含任何硬编码书名、资源名或章节号。

---

## 2. Gap 2：叙事金融数字过滤

**文件**: `packages/core/src/agents/resource-consistency.ts` — 新增 `isNarrativeFinancialContext()`

**修改**: 新增 `NARRATIVE_FINANCIAL_PATTERNS`（5组正则，覆盖价格/费用/工资/转账/购买等普通金融词汇）和 `isNarrativeFinancialContext()` 判定函数。在 `detectBalanceJumpResource()`、`collectSentenceBalanceEvents()` 和 `inferResourceForNumericContext()` 的联邦币路径中，先检查是否为叙事金融上下文。

**判定逻辑**: 文本包含金融词汇（价格、打车费、工资等）且不包含系统上下文（系统面板、兑换、资源余额等）→ 叙事金融上下文，不提取为资源事件。

---

## 3. Gap 3：System Bootstrap & Resource Rule Reveal Modes

**文件**: `packages/core/src/agents/resource-plan.ts`

**修改**:
- `ChapterResourcePlanMode` 类型从5个扩展到7个：新增 `"system_bootstrap"` 和 `"resource_rule_reveal"`
- 新增 `detectSystemBootstrapStage()`：通用正则 `/系统.{0,16}(?:激活|绑定|觉醒|赋予|开启|初始化|唤醒)/u`
- 新增 `detectResourceRuleRevealStage()`：揭示/规则解释相关模式
- 两者已接入 `buildChapterResourcePlan()` 的选择链，优先于硬编码回退逻辑

**约束语义**:

| Mode | forbiddenEvents | closureRequirement |
|------|----------------|-------------------|
| system_bootstrap | exchange | explicit_balance_required |
| resource_rule_reveal | exchange, gain, consume | explicit_balance_required |

---

## 4. Gap 4：Fallback Recovery Schema/Mode Gate

**文件**: `packages/core/src/pipeline/runner.ts`

**修改**: 新增 `isExchangeStrategyAllowed()` 函数，两重门禁：
1. `resourceRules.exchangeRates.length > 0` — schema 必须定义了兑换规则
2. `planMode` 不在 `["system_bootstrap", "resource_rule_reveal"]` 中 — mode 必须允许兑换

调用处：只有当 `isExchangeStrategyAllowed()` 返回 true 时，才选择 `defer_exchange` fallback。

---

## 5. Gap 5：Publish-Ready / Export 资源硬门禁

### 5A: FanqieQualityReport (`fanqie-quality.ts`)

新增 `publish_blocked_by_resource: boolean` 字段。

### 5B: Publish-Ready CLI (`review.ts`)

新增 `BLOCKED_BY_RESOURCE` 状态 + `readResourceConsistencyReportIfExists()` + 资源硬门禁（blocking===true, closureStatus===resource_failed → BLOCKED）。

### 5C: Export (`export-artifact.ts`)

默认导出过滤排除 `"blocked-resource-plan"` 和 `"state-degraded"` 章节。

---

## 6. 测试结果

**命令**: `pnpm --filter @actalk/inkos-core test`
**结果**: 85 test files passed, **1083 tests passed**, 0 failures

新增9个测试覆盖 Gap 1-3。1074个既有测试零回归。

---

## 7. 真实业务验证

**验证项**: Publish-ready 对 resource_failed 样本返回资源阻断
**结果**: `{"publish_status": "BLOCKED_BY_RESOURCE"}` — 确认生效
**日志**: `.ai_workflow/runs/run-012/logs/publish-ready-resource-failed.log`

---

## 8. 抽象合规证明

| 禁止模式 | 是否出现 | 证据 |
|---------|---------|------|
| `if (bookName === "...")` | 否 | grep 无匹配 |
| `if (resourceName === "民望值")` | 否 | 资源名从 YAML 解析 |
| `if (chapter === 2)` | 否 | 通用正则检测 |
| `if (genre === "civic")` | 否 | 无题材特判 |
| 直接编辑业务验证输出 | 否 | 系统生成，未修改 |

---

## 9. 建议提交命令

```bash
git add packages/core/src/agents/resource-consistency.ts \
        packages/core/src/agents/resource-plan.ts \
        packages/core/src/pipeline/runner.ts \
        packages/core/src/agents/fanqie-quality.ts \
        packages/cli/src/commands/review.ts \
        packages/core/src/interaction/export-artifact.ts \
        packages/core/src/__tests__/resource-consistency.test.ts
git commit -m "feat(core): add book-level resource schema gate, narrative financial filter, stage-based resource plan modes, fallback gating, and publish-ready/export resource hard gates"
```
