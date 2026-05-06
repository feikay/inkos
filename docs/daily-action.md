以后你的实际 SOP 简化成这套：

```bash
# 0. 进入项目
cd my-novel

# 1. 写新章节
node ../packages/cli/dist/index.js write next 葬渊魔经

# 2. 单章发布闭环检测
node ../packages/cli/dist/index.js review publish-ready \
  --book 葬渊魔经 \
  --chapter 31 \
  --max-fix-attempts 2 \
  --max-polish-attempts 1 \
  --max-quality-fix-attempts 1 \
  --quality-pass-threshold 85 \
  --quality-accept-threshold 75 \
  --quality-fix-threshold 75 \
  --min-chapter-words 1000
```

如果返回：

```text
READY_TO_EXPORT
```

就可以导出：

```bash
cd ..

node scripts/fanqie/export-fanqie.mjs 葬渊魔经 \
  --from 31 \
  --to 31 \
  --use-reviewed \
  --title "气血为0，我却能撬动规则"
```

现在 `publish-ready` 已经会把 75~84 的可接受稿生成到：

```text
my-novel/books/葬渊魔经/chapters-reviewed/0031_final.md
```

`export-fanqie --use-reviewed` 会优先读取 `chapters-reviewed/xxxx_final.md`，你第3章已经验证过：导出源是 `chapters-reviewed/0003_final.md`，标题仍来自原始文件名。

批量跑：

```bash
cd my-novel

node ../packages/cli/dist/index.js review publish-ready \
  --book 葬渊魔经 \
  --from 2 \
  --to 200 \
  --max-fix-attempts 2 \
  --max-polish-attempts 1 \
  --max-quality-fix-attempts 1 \
  --quality-pass-threshold 85 \
  --quality-accept-threshold 75 \
  --quality-fix-threshold 75 \
  --min-chapter-words 1000
```

遇到非 `READY_TO_EXPORT` 就停，先处理当前章，再从下一章继续。

最简记法：

```text
write next
→ review publish-ready
→ export-fanqie --use-reviewed
```

不要再日常手动跑 `continuity-auto / fanqie-quality / fanqie-polish / quality-auto-fix`，它们现在主要是调试用。

有问题，`continuity-auto -> publish-ready -> 

## 最快处理方式



```bash
# 先单章重跑：
node ../packages/cli/dist/index.js review continuity-auto \
  --book 葬渊魔经 \
  --chapter 39 \
  --max-fix-attempts 2 \
  --min-chapter-words 1000
  
 # 然后再跑：
 node ../packages/cli/dist/index.js review publish-ready \
  --book 葬渊魔经 \
  --chapter 39 \
  --max-fix-attempts 2 \
  --max-polish-attempts 1 \
  --max-quality-fix-attempts 1 \
  --quality-pass-threshold 85 \
  --quality-accept-threshold 75 \
  --quality-fix-threshold 75 \
  --min-chapter-words 1000
  
# 如果第39章变成：READY_TO_EXPORT

# 恢复批量：
node ../packages/cli/dist/index.js review publish-ready \
  --book 葬渊魔经 \
  --from 40 \
  --to 200 \
  --max-fix-attempts 2 \
  --max-polish-attempts 1 \
  --max-quality-fix-attempts 1 \
  --quality-pass-threshold 85 \
  --quality-accept-threshold 75 \
  --quality-fix-threshold 75 \
  --min-chapter-words 1000
```