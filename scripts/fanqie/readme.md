```
# 1. 增量导出新章节 + 自动生成 report.md
node scripts/fanqie/export-fanqie.mjs 葬渊魔经 --incremental --title "气血为0，我却能撬动规则"

# 2. 根据 report.md 自动修复低于 4/6 的章节，并覆盖发布目录里的章节
node scripts/fanqie/repair-fanqie.mjs 葬渊魔经 --apply

# 3. 再跑一次检查，确认修复后是否达标 自定义from n to n
node scripts/fanqie/export-fanqie.mjs 葬渊魔经 --from 9 --to 9 --title "气血为0，我却能撬动规则"

# --incremental 会更新 .last_export。所以修复后复查不要再用 --incremental，否则它会认为没有新章节可导出。
```
