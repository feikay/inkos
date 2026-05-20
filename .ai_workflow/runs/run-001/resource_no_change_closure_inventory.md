# Resource Engine No-Change 处理盘点报告

## 元信息

- 任务：5.7B-1：盘点 Resource Engine 当前对 no-change 章节的处理
- 日期：2026-05-19
- 阶段：inkos 2.0：故事性大升级
- Design Anchor：章节生成层（4.5）、审稿增强层（4.6）、发布优化层（4.7）、Resource Engine 与故事性升级的关系（7）、No-Change Resource Closure 的设计目标（8）

---

## 1. 当前 No-Change 处理链路全景

### 1.1 Resource Plan 层（`packages/core/src/agents/resource-plan.ts`）

**`buildChapterResourcePlan()` 产生 `no_resource_change` 模式的路径：**

1. **路径 A（line 177-193）**：`!hasAnyResources || !ledgerHasActivity`
   - 没有定义任何资源类型，或 particle_ledger 中无数值活动
   - 返回 `mode: "no_resource_change"`, `closureRequirement: "inferred_no_change_allowed"`, `allowedEvents: []`

2. **路径 B（line 196-203）**：`inferGenericResourcePlan()` 返回 null
   - chapterGoal 中未提及已知技能或资源变化（`mentionedSkills.length === 0 && mentionedResources.length === 0`）
   - 且不满足 defer_exchange 条件
   - 返回 null → 落入 fallback

3. **路径 C（line 207-221）**：Fallback — 所有专用计划未命中
   - 返回与路径 A 相同的 `no_resource_change` 计划

**`explore_conversion_path` 也是 no-change 语义：**
- `closureRequirement: "inferred_no_change_allowed"`（line 375）
- `isNoBalanceChangePlan()` 对 `explore_conversion_path` 返回 true（条件：期初==期末、无 gain/spend/exchange/unlock 事件、closureRequirement 为 inferred_no_change_allowed）

**关键函数 `validateTextAgainstChapterResourcePlanFinal()`：**

- **无 plan（line 817-831）**：返回 `passed: true`, `closureSource: "not_applicable"`, `noChangeInferred: false`。这是 "跳过检查" 的语义，无法区分"有意不检查"和"忘了检查"。

- **`canInferNoChange` 路径（line 852-866）**：当 `isNoBalanceChangePlan && inferred_no_change_allowed && 无 forbiddenHits && 无 balanceMutationEvents && 无 validation.issues` 时触发。返回 `closureSource: "inferred_no_change"`, `noChangeInferred: true`。

- **`plan.mode === "no_resource_change"` 路径（line 867-881）**：无论 balanceMutationEvents 是否存在，都返回 `passed: true`。这是**潜在风险点**：no_resource_change 计划下，如果正文出现了资源变化事件，系统会记录但不会报违规。

### 1.2 Resource Engine / Resource Consistency 层（`packages/core/src/agents/resource-consistency.ts`）

**`extractResourceEvents()`（line 462-561）：**
- 纯正则匹配，无资源相关内容 → 返回空数组 `[]`
- 零事件是"正文无资源提及"的自然结果，不是异常

**`validateResourceMath()`（line 565-723）：**
- 零事件输入 → 零 issue 输出（循环体不执行）
- 返回 `openingBalances` 和 `closingBalances` 来自 ledger/state 解析

**`classifyResourceConsistency()`（line 749-767）：**
- 零 issue、未修复 → status = `"PASS"`, blocking = false
- 零 issue、已修复 → status = `"FIXED"`, blocking = false
- 这是**正确行为**：无资源变化的章节应该 PASS

### 1.3 Pipeline Runner 层（`packages/core/src/pipeline/runner.ts`）

**`runResourceConsistencyPass()` 的零事件快速路径（line 3198-3224）：**
```
if (validation.events.length === 0) {
  → classifyResourceConsistency → PASS（无issue）
  → 检查 resourcePlanViolations
  → 无violations → status=PASS, blocking=false, shouldPersistLedger=true
  → 有violations → status=FAILED, blocking=true
}
```

**零 issue 快速路径（line 3225-3251）：**
- 有事件但无 issue：同样先分类再检查 plan violations
- 此路径对 no-change 章节同样适用（如果 events > 0 但无 issue）

**报告写入 `writeResourceConsistencyReport()`（line 3752-3939）：**
- `noChangeInferred`（line 3795）：需同时满足 `resourcePlan存在 && isNoBalanceChangePlan && balanceMutationEvents.length === 0 && resourcePlanViolationCount === 0`
- **关键缺口**：如果 `resourcePlan` 为 undefined，`noChangeInferred` 永远为 false，即使章节确实无资源变化
- `closureRequirement` 和 `closureSource` 同样依赖 `resourcePlan` 存在

**章节状态判定（line 2110-2146）：**
- `resourceConsistency.blocking || resourceIndexGuard` → `blocked-resource-plan` 或 `state-degraded`
- 零事件、零 issue、无 plan violation → blocking=false → 不会触发阻断
- 正确行为，但**缺少显式的 "no-change-closure" 标记**

### 1.4 状态持久化层

**`syncCurrentStateResources()`（resource-consistency.ts line 1252-1287）：**
- `events.length === 0 && !hasActiveResourcePlan` → 不更新 currentState（line 1258-1259）
- `hasActiveResourcePlan = resourcePlan存在 && mode !== "no_resource_change"`
- 即 `no_resource_change` 模式被视为无活跃计划，不更新 state — **正确**

**`buildResourceLedgerUpdate()`（resource-consistency.ts line 1201-1250）：**
- Line 1211：`mode !== "no_resource_change"` 时才 merge plan expected balances
- Line 1229：无 overview rows 且无 flow rows → 返回旧 ledger
- 即 no-change 章节不修改 ledger — **正确**

---

## 2. "无资源变化"与"检查缺失"的语义区分现状

| 场景 | `extractResourceEvents` | `validation.issues` | `resourcePlan.mode` | `noChangeInferred` | 最终状态 | 能否区分"无变化"与"未检查" |
|------|------------------------|---------------------|---------------------|-------------------|---------|--------------------------|
| 有plan，无事件，无issue | `[]` | `[]` | `no_resource_change` | `true` | PASS | ✅ 可以（报告中有明确closure） |
| 有plan，无事件，无issue | `[]` | `[]` | `explore_conversion_path` | `true` | PASS | ✅ 可以 |
| 无plan，无事件，无issue | `[]` | `[]` | undefined | `false` | PASS | ❌ 无法区分 |
| 有plan(no_resource_change)，有事件但无issue | `[...]` | `[]` | `no_resource_change` | `false`（有mutationEvents） | PASS | ⚠️ 部分（有事件但plan说no-change） |
| 有plan，有事件且有issue | `[...`] | `[...]` | any | `false` | FAILED/WARN | ✅ 正常异常路径 |
| 无plan，有事件，无issue | `[...]` | `[]` | undefined | `false` | PASS | ⚠️ 无法确认是否故意不设plan |

**核心发现：**
- 当 `resourcePlan` 存在且为 no-change 模式时，系统语义完整
- 当 `resourcePlan` 为 undefined 时（旧书、边缘情况），缺失 no-change closure 标记
- 不存在主动的"检查是否被跳过"的检测机制

---

## 3. 可能误触发 BLOCKED / WARN 的位置

### 3.1 低风险（当前已正确处理）

| 位置 | 场景 | 当前行为 | 风险 |
|------|------|---------|------|
| runner.ts:3198 | 零事件 + 无plan violation | PASS, blocking=false | ✅ 无 |
| runner.ts:3225 | 零issue + 无plan violation | PASS, blocking=false | ✅ 无 |
| runner.ts:3496 | 最终plan violation检测 | FAILED, blocking=true | ✅ 正确阻断 |
| resource-plan.ts:867 | no_resource_change + 有事件 | passed=true | ⚠️ 见3.2 |

### 3.2 中风险（需关注）

**位置：`resource-plan.ts` line 867-881**
- `plan.mode === "no_resource_change"` 分支始终返回 `passed: true`
- 即使 `balanceMutationEvents.length > 0`（正文出现了资源事件）
- 潜在问题：如果 Resource Plan 错误地将一个应有资源变化的章节标记为 `no_resource_change`，系统不会报违规
- **缓解因素**：事件仍然被提取和记录在报告中，report 中 `balanceMutationEvents` 会列出这些事件
- **建议**：在报告中将此情况标记为 `WARN`（而非 FAILED），提示"no-change plan 下检测到资源变化事件"

**位置：`runner.ts` line 3795**
- `noChangeInferred = Boolean(params.resourcePlan && isNoBalanceChangePlan(params.resourcePlan) && ...)`
- 如果 `resourcePlan` 为 undefined → `noChangeInferred` = false
- 这不会误触发 BLOCKED，但会导致报告缺少 closure 语义

### 3.3 低风险但语义不完整

**`resource-plan.ts` line 817-831（无 plan 的 final validation）**
- `closureSource: "not_applicable"` — 但下游无法区分 "不适用" 和 "跳过了"
- 建议增加 `closureSource: "not_checked"` 或类似标记

---

## 4. 最小修改方案

基于盘点结论，提出**三级修改方案**：

### 级别 1：最小补丁（本轮推荐，5.7B-2 执行）

**修改文件：** `packages/core/src/agents/resource-plan.ts`（约 +15 行）

1. 在 `ChapterResourcePlanFinalValidation` 中增加 `checked: boolean` 字段
2. 在无 plan 分支（line 817-831）设置 `checked: false`
3. 在有 plan 分支设置 `checked: true`
4. 在 `no_resource_change` 模式有 balanceMutationEvents 时，增加 info 级别提示（不改 passed 状态）

**修改文件：** `packages/core/src/pipeline/runner.ts`（约 +10 行）

5. 在报告写入时，当 `!params.resourcePlan` 且 `validation.events.length === 0`，设置 `closureSource: "not_checked"`（而非仅 "-"）
6. 增加 `resourceCheckPerformed: boolean` 到报告 JSON/MD

### 级别 2：语义增强（5.7B-3 执行）

**修改文件：** `packages/core/src/agents/resource-consistency.ts`（约 +20 行）

7. 在 `ResourceConsistencyPipelineResult` 增加 `closureStatus: "no_change_closed" | "normal_closed" | "resource_failed" | "not_checked"`
8. 在 `classifyResourceConsistency()` 或调用处计算 closureStatus

**修改文件：** `packages/core/src/pipeline/runner.ts`（约 +15 行）

9. 在 `runResourceConsistencyPass()` 零事件快速路径中计算 closureStatus
10. 在报告写入中使用 closureStatus 替代当前的 ad-hoc 计算

### 级别 3：下游消费（5.7B-4 执行）

**修改文件：** continuity / publish-ready / export 相关消费端

11. 读取 `closureStatus` 字段
12. 区分 "no_change_closed"（放行）vs "not_checked"（需警告）vs "resource_failed"（阻断）

---

## 5. 下一轮建议修改文件

| 优先级 | 文件 | 修改量 | 说明 |
|--------|------|--------|------|
| P0 | `packages/core/src/agents/resource-plan.ts` | ~20行 | 增加 checked 标记；no_resource_change 下的事件提示 |
| P0 | `packages/core/src/pipeline/runner.ts` | ~25行 | 报告增加 closureStatus；零事件路径增加语义标记 |
| P1 | `packages/core/src/agents/resource-consistency.ts` | ~15行 | PipelineResult 增加 closureStatus 字段 |
| P2 | `packages/core/src/models/chapter.ts` | ~5行 | 如需要，扩展 ChapterStatus 类型 |
| P3 | continuity / review 消费端 | ~10行 | 读取 closure 状态 |

**总计预估修改量：< 100 行（级别1+2），不涉及新依赖或架构变更。**

---

## 6. 下一轮建议测试

### 6.1 单元测试（`resource-plan.test.ts`）

```
describe("no-change resource closure", () => {
  it("should mark checked=true when plan is provided")
  it("should mark checked=false when plan is undefined")
  it("should pass no_resource_change with zero events and zero issues")
  it("should record balanceMutationEvents in no_resource_change mode without failing")
  it("should set closureSource='inferred_no_change' for no-change closure")
  it("should set closureSource='not_checked' when plan is absent")
})
```

### 6.2 单元测试（`resource-consistency.test.ts`）

```
describe("closure status classification", () => {
  it("should classify as no_change_closed: zero events, zero issues, no violations")
  it("should classify as normal_closed: has events, zero issues, no violations")
  it("should classify as resource_failed: has blocking issues")
  it("should classify as not_checked: no resource plan AND zero events")
  it("should NOT misclassify missing-check as no_change_closed")
})
```

### 6.3 集成测试（`pipeline-runner.test.ts`）

```
describe("no-change chapter pipeline integration", () => {
  it("should output closureStatus in resource consistency report")
  it("should not block no-change chapter with proper plan")
  it("should not mark no-change chapter as ready-for-review without closure")
  it("should still block real resource failures")
})
```

### 6.4 断言口径

- no-change 章节：`closureStatus === "no_change_closed"`, `blocking === false`, `status === "PASS"`
- 缺失 resource check：`closureStatus === "not_checked"`（下游据此决定是否警告）
- 正常 resource_delta：`closureStatus === "normal_closed"`，按 Resource Engine 计算
- 真实资源异常：`blocking === true` 或 `status === "FAILED"` 或 `status === "WARN"`

---

## 7. 真实业务验证建议

### 7.1 建议验证样本

- 找一个已知无资源变化的章节（如纯对话/日常章节）
- 找一个有资源变化但被 Resource Plan 正确管理的章节
- 找一个资源变化导致 FAILED 的章节（作为对照）

### 7.2 建议验证命令

```bash
# 查看 resource consistency report
cat books/<book-id>/reviews/resource-consistency/<chapter>.report.json | jq '{status, blocking, closureSource, noChangeInferred, events, issues}'

# 查看 chapter index 中的状态
cat books/<book-id>/story/chapter-index.json | jq '.chapters[] | select(.number == <N>) | {status, reviewNote}'

# 对比相邻章节的 resource report
diff <(cat books/<book-id>/reviews/resource-consistency/0002.report.json | jq '.events') \
     <(cat books/<book-id>/reviews/resource-consistency/0003.report.json | jq '.events')
```

### 7.3 观察点

- no-change 章节的 report 中 `closureSource` 是否为 `inferred_no_change`
- `noChangeInferred` 是否为 `true`
- 下游 report（continuity、publish-ready）是否错误地引用了缺失的 resource 数据
- 真实异常章节的 BLOCKED/WARN 是否仍然有效

---

## 8. 风险点需要用户确认

1. **`no_resource_change` 模式下出现资源事件的策略**：当前静默通过。是保持现状（记录但不阻断），还是升级为 WARN？
   - 建议：保持 passed 但增加 INFO 提示，因为 Resource Plan 可能滞后于实际写作

2. **无 Resource Plan 的旧书兼容**：旧书可能没有 Resource Plan。是否需要在没有 plan 时也尝试判断 no-change？
   - 建议：是，基于 `events.length === 0 && issues.length === 0` 即可判断

3. **`closureStatus` 字段是否需要在 chapter-index.json 中暴露**：
   - 建议：先仅在 resource consistency report 中暴露，等稳定后再扩展到 chapter index

4. **是否需要修改 `ready-for-review` 的条件**：
   - 当前：resource blocking → state-degraded（不标记 ready-for-review）
   - 建议：no-change closed 应能正常进入 ready-for-review，但 not_checked 应至少给出 WARN
