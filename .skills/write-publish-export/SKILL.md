---
name: write-publish-export
description: >
  长篇连载小说的写章、检查、导出全流程串联。当用户用自然语言要求"写《某书》新一章""连写 N 章""把第 X 到 Y 章检查并导出""写完导出番茄版"时触发。
  也适用于 publish-ready、continuity 检查、numeric 表达式检查、numeric-fix、quality trend、fanqie-polish、repair-fanqie 等环节的自动化串联。
  仅适用于 my-novel/books/ 下的长篇小说项目。
---

<!-- Generated mirror. Edit `skills/write-publish-export/SKILL.md` instead. -->


# write-publish-export

Current version: v2.2

- v1: write -> publish-ready -> repair -> numeric -> export
- v2.1: resume / warningSummary / manual-fix-prompt
- v2.2: numeric-fix / quality-trend / autoFixSuggestions

## 适用场景

当用户要求"写某本书新一章""写某本书新 N 章""把第 X 到 Y 章检查并导出"时，使用本 skill 串联长篇连载生产流程。

本 skill 只适用于 `my-novel/books/<book>` 下的长篇小说项目，不用于 short-story 模块。

## 示例命令

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 1
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 3
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --from 90 --to 95
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 3 --no-export
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume-last
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume <reportPath>
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume <reportPath> --disable-numeric-fix
node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only
node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --last 10
```

## 执行 SOP

1. 解析书名和范围。
2. `--count` 模式先执行 `write next`，每写一章后自动识别最新章节号。
3. 对每章执行 `publish-ready`。
4. 根据 publish-ready 状态分流补救：continuity-auto、fanqie-polish、repair-fanqie。
5. publish-ready 最终通过后执行 `check-numeric-expression.mjs --final-only`。
6. numeric A>0 时默认执行一次 numeric fix，再重新检查。
7. 全部章节通过后，若没有 `--no-export`，执行 `export-fanqie.mjs --use-reviewed`。
8. 写入 JSON 和 Markdown 运行报告。

## 分支判断规则

- `READY_TO_EXPORT` / `READY_WITH_WARNINGS` / `PASS`：进入 numeric check；`READY_WITH_WARNINGS` 允许继续但记 P1。
- `DROP`：立即停止，不继续写下一章，不导出。
- 连续性相关：`BLOCKED_BY_CONTINUITY`、`continuity.final_status != PASS`、`MANUAL_REVIEW`、stdout 中出现 continuity/manual review，执行 `continuity-auto`，最多 `--max-continuity-fix` 次。
- 番茄风格、标题、段落、质量相关：`quality_decision=NEED_REWRITE`、quality 分数不足，或 stdout 中出现 style/fanqie/title/paragraph/quality，执行 `fanqie-polish`，最多 `--max-polish` 次。
- 6 段检查相关：stdout/report 中出现 `SIX_PART_FAIL`、`6段`、`Hook`、`Payoff`、`Pull`、`钩子`、`回收`、`追读` 等，执行 `repair-fanqie`，最多 `--max-repair` 次。
- numeric final-only：解析 `hits: A=<n> B=<n> C=<n>`，A 必须为 0。

## Numeric 规则

旧规则是 numeric A>0 直接停止。v2.2 后的新规则：

- numeric A>0 默认最多自动修复 1 次。
- 修复脚本：`scripts/fanqie/fix-numeric-expression.mjs`。
- 默认只修 `my-novel/books/<book>/chapters-reviewed/<chapter>_final.md`。
- 修复前备份：`my-novel/books/<book>/chapters-reviewed/<chapter>_final.numeric-backup.md`。
- 修复后重新执行 `check-numeric-expression.mjs --final-only`。
- 只有 A=0 才允许 export。
- 如果修复后仍 A>0，则 `STOPPED_BY_NUMERIC` 并生成 manual fix prompt。
- 如果使用 `--disable-numeric-fix`，A>0 直接 `STOPPED_BY_NUMERIC`，不自动修复。
- 不要误修中文自然表达，例如"两成功力""三分力""七八成把握""数息""一炷香""百丈""十余步""三五人"。

## Resume 续跑

- `--resume-last` 读取最新 write-publish-export JSON 报告。
- `--resume <reportPath>` 读取指定报告。
- 如果报告已 `READY_TO_PUBLISH`，输出 `Latest report is already READY_TO_PUBLISH. Nothing to resume.`。
- 如果报告存在失败章节，从第一个失败章节继续。
- 不允许跳过失败章节直接写后续章节。
- 失败章节通过后继续补足原 `count` 剩余章节。
- `STOPPED_BY_NUMERIC` 会按当前 numeric fix 设置处理；`--disable-numeric-fix` 可保留旧阻断行为。

## Warning 分级

`warningSummary` 固定为：

```json
{ "P0": [], "P1": [], "P2": [] }
```

P0 阻断级：

- numeric A>0
- DROP
- BLOCKED_BY_CONTINUITY
- BLOCKED_BY_QUALITY
- SIX_PART_FAIL
- write next 没有落盘
- final file 不存在
- export 失败

P1 强警告：

- READY_WITH_WARNINGS
- QUALITY_WARN_POLISH_OPTIONAL
- quality 80-84
- mood-cadence 未满足
- missing_state_change
- payoff-impact-missing
- 列表式 AI 结构
- 连续长句过多
- 字数严重超出目标区间
- 标题被大幅改写

P2 普通提醒：

- numeric C>0
- minor 状态校验 warning
- 标题轻微优化
- 普通 paragraph warning

`riskLevel`：

- `BLOCKED`：存在 P0
- `MEDIUM`：存在 P1
- `LOW`：只有 P2 或无 warning

`publishAdvice`：

- `DO_NOT_PUBLISH`：存在 P0
- `CAN_PUBLISH_WITH_WARNINGS`：存在 P1 但无 P0
- `CAN_PUBLISH`：无 P0/P1

## Manual Fix Prompt

失败或 `UNKNOWN_ERROR` 时生成：

```text
my-novel/books/<book>/reviews/manual-fix-prompts/<chapter>.md
```

不同失败类型会生成可直接发给 Codex 的修复提示词：

- WRITE_AUDIT：promised payoff、ending type、mood directive、scene semantic。
- CONTINUITY：承接上一章、人物状态、伏笔、战力一致性。
- QUALITY：网文节奏、番茄风格、段落、爽点、钩子。
- NUMERIC：沉浸模式下移除突兀阿拉伯数字，保留自然中文表达。
- SIX_PART：Hook / Pressure / Attempt / Twist / Payoff / Pull。

## Quality Trend

命令：

```bash
node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --last 10
node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --from 92 --to 99
```

输出：

```text
my-novel/books/<book>/reviews/write-publish-export/quality-trend.md
my-novel/books/<book>/reviews/write-publish-export/quality-trend.json
```

统计：

- chapter count
- ready / blocked
- avg continuity
- avg quality
- READY_TO_EXPORT / READY_WITH_WARNINGS
- numeric A/B/C
- continuity-auto / fanqie-polish / repair-fanqie 次数
- P0/P1/P2 warning counts
- common warning types
- advice

## autoFixSuggestions

报告新增 `autoFixSuggestions`：

- P0 必须给建议。
- P1 尽量给建议。
- P2 可以只汇总。
- 除 numeric fix 外，不自动执行正文修复。

示例：

```json
[
  {
    "type": "NUMERIC_A",
    "priority": "P0",
    "chapter": "0099",
    "suggestedCommand": "node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only"
  },
  {
    "type": "QUALITY_WARN_POLISH_OPTIONAL",
    "priority": "P1",
    "chapter": "0098",
    "suggestedCommand": "node ../packages/cli/dist/index.js review fanqie-polish --book 葬渊魔经 --chapter 98"
  }
]
```

## 报告字段

每次运行生成：

- `my-novel/books/<book>/reviews/write-publish-export/<timestamp>.json`
- `my-novel/books/<book>/reviews/write-publish-export/<timestamp>.md`

重点字段：

- `resume`
- `warningSummary`
- `riskLevel`
- `publishAdvice`
- `manualFixPrompt`
- `numericFix`
- `autoFixSuggestions`
- `finalStatus`

`numericFix` 包含：

- `attempted`
- `attempts`
- `before`
- `after`
- `fixedFile`
- `backupFile`
- `reportFile`
- `result`: `PASS` / `STILL_BLOCKED` / `SKIPPED`

## Current Boundaries

- numeric A 自动修复最多默认 1 次。
- quality warning 不自动改正文。
- quality trend 当前可能统计历史报告，后续可优化为每章最新状态。
- 本 skill 不适用于 short-story。
- 不修改 write next 主流程。
- 不放宽 numeric A=0 导出规则。
- 不放宽 continuity / quality / six-part / drop 阻断规则。
- 自动修复次数必须有限，禁止无限循环。
