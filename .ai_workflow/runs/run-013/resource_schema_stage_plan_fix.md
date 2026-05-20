# Resource Schema / Stage Plan Fix — Run-013 修复报告

**运行编号**: run-013 | **时间**: 2026-05-20 | **执行者**: Claude Code

## 执行摘要

修复 run-012 Codex review 的两个阻断问题：移除 system_bootstrap 中的资源名特判（改为 schema-driven），补齐 publish-ready 的 chapter index 硬门禁。修改2个源码文件 + 1个测试文件。1282/1282 测试通过。真实业务验证确认双源阻断生效。

---

## 1. Fix 1：移除 system_bootstrap 资源名特判

**文件**: `packages/core/src/agents/resource-plan.ts`

Run-012 代码：
```typescript
allowedEvents: params.openingBalances["民望值"] === 0 && params.openingBalances["联邦币"] === 0
  ? [{ order: 1, kind: "balance_claim", resource: Object.keys(...)[0] ?? "未知资源", ... }]
  : [],
```

Run-013 修复：
```typescript
allowedEvents: Object.keys(params.resourceRules.resources).map((resource, index) => ({
  order: index + 1,
  kind: "balance_claim" as const,
  resource,
  reason: "系统首次激活：声明初始资源余额",
  requiredInText: true,
})),
```

验证：grep 确认 buildSystemBootstrapPlanIfMatched (L468-522) 不再包含 "民望值" 或 "联邦币" 字面量。

---

## 2. Fix 2：补齐 chapter index 硬门禁

**文件**: `packages/cli/src/commands/review.ts`

新增 `readChapterIndexStatus()` → 读取 `chapters/index.json` → 查找章节状态。

publish-ready 现在双源检查：
- Resource consistency report（blocking/closureStatus/resource_failed）
- Chapter index status（state-degraded/blocked-resource-plan）

任一阻断 → `BLOCKED_BY_RESOURCE`

---

## 3. 测试

**强化**: system_bootstrap 测试改为强断言 `toBe("system_bootstrap")` + 验证 balance_claim 覆盖所有声明资源
**新增**: 灵石/金币 schema → balance_claim 覆盖灵石和金币，不含民望值/联邦币

**结果**: Core 1084/1084, CLI 198/198, Total 1282/1282 (0 failures)

---

## 4. 真实业务验证

情绪值系统 ch1（state-degraded in index.json）→ publish-ready:
```json
{
  "publish_status": "BLOCKED_BY_RESOURCE",
  "warnings": [
    "Resource consistency check: blocking=true, closureStatus=resource_failed...",
    "Chapter index status is \"state-degraded\". Chapter must be repaired..."
  ]
}
```

Exit: 0. 双源阻断确认。

---

## 5. 建议提交

```bash
git add packages/core/src/agents/resource-plan.ts \
        packages/cli/src/commands/review.ts \
        packages/core/src/__tests__/resource-consistency.test.ts
git commit -m "fix(core): make system_bootstrap balance_claim schema-driven, add chapter index status gate to publish-ready"
```
