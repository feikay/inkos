# Resource Schema Stage Plan Gate — Test Coverage Summary

## Overview

This document summarizes test coverage for the 5.8B book-level resource schema and
chapter-stage resource plan gates across run-012, run-013, and run-014.

## Test Coverage Matrix

### 5 Abstract Gaps (run-012)

| Gap | Description | Test File | Coverage |
|-----|-------------|-----------|----------|
| 1 | Schema gate: only book-declared resources enter strong ledger | resource-consistency.test.ts | parseResourceRules schema gate tests |
| 2 | Financial filter: narrative financial context ≠ resource event | resource-consistency.test.ts | isNarrativeFinancialContext tests |
| 3 | Stage modes: 7 plan modes (normal/defer/explore/cash/no_change/bootstrap/reveal) | resource-consistency.test.ts | system_bootstrap + resource_rule_reveal mode tests |
| 4 | Fallback gate: no defer_exchange fallback when plan mode forbids exchange | (runner.ts logic, tested via resource-consistency tests) | isExchangeStrategyAllowed guards |
| 5 | Publish-ready + export gate: BLOCKED_BY_RESOURCE status integration | review-continuity-verdict.test.ts + resource-consistency.test.ts | chapter index status + resource report dual gate |

### 2 Codex Review Blockers (run-013)

| Blocker | Description | Fix | Test |
|---------|-------------|-----|------|
| 1 | system_bootstrap hardcoded 民望值/联邦币 check | Schema-driven: Object.keys(resources).map(...) | resource-consistency.test.ts: schema-driven balance_claim for civic + non-civic |
| 2 | publish-ready only checked resource report, not chapter index | Added readChapterIndexStatus + dual-source gate | run-013 real validation (情绪值系统 ch1 state-degraded) |

### Test Gap Fill (run-014)

| Gap | Description | Test |
|-----|-------------|------|
| blocked-resource-plan | No unit test for publish-ready blocked-resource-plan chapter index status | review-continuity-verdict.test.ts: readChapterIndexStatus suite |
| state-degraded | No unit test for publish-ready state-degraded chapter index status | review-continuity-verdict.test.ts: readChapterIndexStatus suite |

## Test Commands

```bash
# Core tests (resource plan, consistency, schema gate)
pnpm --filter @actalk/inkos-core test

# CLI tests (publish-ready, chapter index status)
pnpm --filter @actalk/inkos test
```

## Final Results (run-014)

- Core: 85 test files, 1084 tests passed
- CLI: 36 test files, 200 tests passed
- Total: 1284 tests, 0 failures

## Key Test Cases

### resource-consistency.test.ts (core)

1. **parseResourceRules schema gate**: Only injects resources declared in book_rules resourceTypes block
2. **Backward compat**: No resourceTypes block → all 17 defaults
3. **isNarrativeFinancialContext**: Filters salary/price/transfer narration from resource events
4. **system_bootstrap civic**: Schema-driven balance_claim for 民望值+联邦币
5. **system_bootstrap non-civic**: Schema-driven balance_claim for 灵石+金币, no 民望值/联邦币 leak
6. **resource_rule_reveal**: Detects rule explanation chapters, forbids exchange/gain/consume

### review-continuity-verdict.test.ts (cli)

1. **readChapterIndexStatus**: Returns draft / blocked-resource-plan / approved / null for missing
2. **readChapterIndexStatus state-degraded**: Returns state-degraded correctly
