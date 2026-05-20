# Resource Schema / Stage Plan Fix — Run-013 修复报告

**运行编号**: run-013 | **时间**: 2026-05-20 | **执行者**: Claude Code

## 执行摘要

本轮修复了 run-012 Codex review 指出的两个阻断问题。修改2个源码文件 + 1个测试文件，新增1个测试 + 强化1个已有测试（1282/1282 全部通过），真实业务验证确认 publish-ready 双源阻断生效。

---

## 1. Fix 1：移除 system_bootstrap 中的资源名特判

**文件**: `packages/core/src/agents/resource-plan.ts`
**位置**: `buildSystemBootstrapPlanIfMatched()` (原 L496, 现 L496-502)

### 问题

run-012 新增代码直接判断具体资源名：

```typescript
allowedEvents: params.openingBalances["民望值"] === 0 && params.openingBalances["联邦币"] === 0
  ? [{ order: 1, kind: "balance_claim", resource: Object.keys(...)[0] ?? "未知资源", ... }]
  : [],
```

违反"不能写成资源名特例"的核心约束，且只生成1个 balance_claim（仅第一个资源），其他 book-level schema 的开篇章节无法稳定获得正确的 balance_claim。

### 修复

改为 schema-driven，遍历所有声明的资源类型：

```typescript
allowedEvents: Object.keys(params.resourceRules.resources).map((resource, index) => ({
  order: index + 1,
  kind: "balance_claim" as const,
  resource,
  reason: "系统首次激活：声明初始资源余额",
  requiredInText: true,
})),
```

### 抽象保证

- 不再包含任何具体资源名判断
- 适用于任何 book-level resource schema（民望值/联邦币、灵石/金币、或任何自定义资源组合）
- balance_claim 事件数量 = 声明的资源类型数量

---

## 2. Fix 2：补齐 publish-ready chapter index 硬门禁

**文件**: `packages/cli/src/commands/review.ts`
**位置**: `runPublishReadyChapter()` (L1106-1141)

### 问题

run-012 的资源硬门禁只读取 resource consistency report JSON，不读取 chapter index 的章节状态。当 resource report 缺失或未标 blocking，但章节 index 已是 `state-degraded` 或 `blocked-resource-plan` 时，章节仍可能被 publish-ready 放行。

### 修复

1. **新增** `readChapterIndexStatus()` 函数：读取 `chapters/index.json`，返回指定章节的 `status` 字段
2. **新增** `ChapterIndexEntry` 接口
3. **更新** `runPublishReadyChapter()` 的资源硬门禁：
   - 同时检查 resource report 和 chapter index
   - chapter index 状态为 `state-degraded` 或 `blocked-resource-plan` → `BLOCKED_BY_RESOURCE`
   - 两种阻断源生成各自独立的 warning 信息

### 验证

真实业务验证（情绪值系统 ch1，`state-degraded` 在 chapter index 中）：

```json
{
  "publish_status": "BLOCKED_BY_RESOURCE",
  "warnings": [
    "Resource consistency check: blocking=true, closureStatus=resource_failed. Fix resource issues before publishing.",
    "Chapter index status is \"state-degraded\". Chapter must be repaired before publishing."
  ]
}
```

两个 warning 同时出现，证明双源阻断生效。

---

## 3. 测试变更

### 强化已有测试

| 测试 | 变化 |
|------|------|
| system_bootstrap mode for system activation chapter | 从弱断言 `toContain(plan.mode)` 改为强断言 `toBe("system_bootstrap")`；新增验证 balance_claim 覆盖所有声明的资源 |

### 新增测试

| # | 测试 | 验证点 |
|---|------|--------|
| 1 | Non-civic resource schema (灵石/金币) in system_bootstrap | balance_claim 覆盖灵石和金币，不含民望值/联邦币 |

**测试命令**: `pnpm test`
**测试结果**: 1282/1282 passed（1084 core + 198 CLI），0 failures, 0 regressions

---

## 4. 如何证明没有写成书名/题材/资源名/章节号特例

| 检查项 | 结果 | 证据 |
|--------|------|------|
| `buildSystemBootstrapPlanIfMatched` 不再含 `["民望值"]` `["联邦币"]` | PASS | grep 确认 L468-522 无资源名硬编码 |
| balance_claim 生成完全由 `Object.keys(params.resourceRules.resources)` 驱动 | PASS | 源码 L496 |
| publish-ready 阻断基于通用 status 值 (`state-degraded`, `blocked-resource-plan`) | PASS | 源码 L1113 |
| 不判断具体书名或题材 | PASS | grep 无匹配 |
| 不修改业务验证输出 | PASS | publish-ready 输出由系统生成，未手工编辑 |
| 不修改 01_design.md | PASS | git diff -- .ai_workflow/01_design.md 为空 |

---

## 5. 建议提交命令

```bash
git add packages/core/src/agents/resource-plan.ts \
        packages/cli/src/commands/review.ts \
        packages/core/src/__tests__/resource-consistency.test.ts
git commit -m "fix(core): make system_bootstrap balance_claim schema-driven, add chapter index status gate to publish-ready"
```
