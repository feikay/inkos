# Resource Schema Stage Plan Gate — Test Coverage (run-014)

## Summary

Run-014 adds unit test coverage for `readChapterIndexStatus()`, the helper
function that reads chapter index status for the publish-ready resource gate.

## New Tests

### File: `packages/cli/src/__tests__/review-continuity-verdict.test.ts`

#### Test: "returns the chapter status from the index"

Creates a temporary `chapters/index.json` with:
```json
[
  { "number": 1, "status": "draft", "wordCount": 1000 },
  { "number": 2, "status": "blocked-resource-plan", "wordCount": 1200 },
  { "number": 3, "status": "approved", "wordCount": 1500 }
]
```

Asserts:
- `readChapterIndexStatus(bookDir, 1)` → `"draft"`
- `readChapterIndexStatus(bookDir, 2)` → `"blocked-resource-plan"`
- `readChapterIndexStatus(bookDir, 3)` → `"approved"`
- `readChapterIndexStatus(bookDir, 99)` → `null` (missing chapter)
- `readChapterIndexStatus(otherDir, 1)` → `null` (missing index)

#### Test: "returns state-degraded status correctly"

Creates a temporary `chapters/index.json` with:
```json
[{ "number": 1, "status": "state-degraded", "wordCount": 500 }]
```

Asserts:
- `readChapterIndexStatus(bookDir, 1)` → `"state-degraded"`

## Integration with publish-ready gate

These tests verify the data-reading layer. The publish-ready gate logic
(in `runPublishReadyChapter`, review.ts L1106-1141) checks:

```
chapterStatus === "state-degraded" || chapterStatus === "blocked-resource-plan"
```

When either condition is true, publish-ready returns `BLOCKED_BY_RESOURCE`.

## Coverage gap filled

| Status | run-013 | run-014 |
|--------|---------|---------|
| `state-degraded` | Real validation (情绪值系统 ch1) | Unit test added |
| `blocked-resource-plan` | Missing | Unit test added |
| `draft` | — | Unit test added |
| `approved` | — | Unit test added |
| Missing chapter | — | Unit test added (null) |
| Missing index | — | Unit test added (null) |
