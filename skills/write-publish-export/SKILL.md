---
name: write-publish-export
description: >
  长篇连载小说的写章、检查、导出全流程串联。当用户用自然语言要求"写《某书》新一章""连写 N 章""把第 X 到 Y 章检查并导出""写完导出番茄版"时触发。
  也适用于 publish-ready、continuity 检查、numeric 表达式检查、fanqie-polish、repair-fanqie 等环节的自动化串联。
  仅适用于 my-novel/books/ 下的长篇小说项目。
---

# write-publish-export

## 适用场景

当用户用一句自然语言要求"写某本书新一章""写某本书新 N 章""把第 X 到 Y 章检查并导出"时，使用本 skill 串联长篇连载生产流程。

本 skill 只适用于 `my-novel/books/<book>` 下的长篇小说项目，不用于 short-story 模块。

## 自然语言触发方式

可触发的用户说法包括：

- "写《葬渊魔经》新一章并导出番茄版"
- "给葬渊魔经连写 3 章，检查通过后导出"
- "把葬渊魔经 90 到 95 章跑发布前检查和番茄导出"
- "写新章，publish-ready 过了再 export"

## 示例命令

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 1
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 3
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --from 90 --to 95
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 3 --no-export
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 3 --stop-on-fail
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --from 90 --to 90 --dry-run
```

## 执行 SOP

1. 解析书名和范围。
2. `--count` 模式先执行 `write next`，每写一章后自动识别最新章节号。
3. 对每章执行 `publish-ready`。
4. 读取 `books/<book>/reviews/publish-ready/<chapter>.publish-report.json`。仓库中实际路径通常为 `my-novel/books/<book>/reviews/publish-ready/<chapter>.publish-report.json`。
5. 如果 JSON 不存在，则尝试从 stdout 解析状态；仍无法识别时标记 `UNKNOWN` 并停止。
6. 根据 publish-ready 状态分流补救。
7. publish-ready 最终通过后执行 `check-numeric-expression.mjs --final-only`，要求 A=0。
8. 全部章节通过后，若没有 `--no-export`，执行 `export-fanqie.mjs --use-reviewed`。
9. 写入 JSON 和 Markdown 运行报告。

## 分支判断规则

- `READY_TO_EXPORT` / `PASS`：进入 numeric check。
- `DROP`：立即停止，不继续写下一章，不导出。
- 连续性相关：`BLOCKED_BY_CONTINUITY`、`continuity.final_status != PASS`、`MANUAL_REVIEW`、stdout 中出现 continuity/manual review，执行 `continuity-auto`，最多 `--max-continuity-fix` 次。
- 番茄风格、标题、段落、质量相关：`quality_decision=NEED_REWRITE`、quality 分数不足，或 stdout 中出现 style/fanqie/title/paragraph/quality，执行 `fanqie-polish`，最多 `--max-polish` 次。
- 6 段检查相关：stdout/report 中出现 `SIX_PART_FAIL`、`6段`、`Hook`、`Payoff`、`Pull`、`钩子`、`回收`、`追读` 等，执行 `repair-fanqie`，最多 `--max-repair` 次。
- numeric final-only：解析 `hits: A=<n> B=<n> C=<n>`，A 必须为 0。A>0 时停止并标记需要 numeric-fix，不导出。

## 失败停止规则

- `--stop-on-fail=true` 为默认行为。
- 任一章节连续性未通过，不继续生成后续章节。
- 任一章节 publish-ready 未通过，不允许 export。
- 任一章节 numeric final-only A>0，不允许 export。
- 任一章节 6 段检查未达标且 repair 后仍失败，不允许 export。
- 自动修复次数必须有限，禁止无限循环。

## 禁止行为

- 禁止修改现有 `write next` 主流程。
- 禁止修改 short-story 模块。
- 禁止 publish-ready 未通过就 export。
- 禁止 continuity 未通过继续写下一章。
- 禁止 numeric final-only A>0 时 export。
- 禁止覆盖原始章节文件；自动修复必须依赖现有 fixed/reviewed/polished/salvaged 机制。
- 禁止无限重试。

## 默认参数

- `--stop-on-fail=true`
- `--use-reviewed=true`
- `--max-polish=2`
- `--max-repair=2`
- `--max-continuity-fix=1`
- `--max-numeric-fix=1`

## 最终报告格式

每次运行生成：

- `my-novel/books/<book>/reviews/write-publish-export/<timestamp>.json`
- `my-novel/books/<book>/reviews/write-publish-export/<timestamp>.md`

报告包含：

- book
- requested count / from / to
- 实际处理章节
- 每章执行过的步骤
- 每步命令
- 每步 stdout 摘要
- 每步 exit code
- publish-ready 最终状态
- numeric A/B/C 统计
- 是否执行 continuity-auto
- 是否执行 fanqie-polish
- 是否执行 repair-fanqie
- 是否 export
- export 文件路径
- finalStatus：`READY_TO_PUBLISH`、`STOPPED_BY_CONTINUITY`、`STOPPED_BY_QUALITY`、`STOPPED_BY_NUMERIC`、`STOPPED_BY_SIX_PART`、`STOPPED_BY_DROP`、`UNKNOWN_ERROR`
