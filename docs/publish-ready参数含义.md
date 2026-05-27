下面是当前 `review publish-ready` 参数，按用途分组。

**目标范围**
```bash
--book <book-id>        必填，书名/书籍 ID
--chapter <number>      单章
--from <number>         批量起始章
--to <number>           批量结束章
```

用法二选一：

```bash
--chapter 6
```

或：

```bash
--from 1 --to 10
```

**连续性修复**
```bash
--max-fix-attempts <number>
```

默认：

```text
2
```

含义：continuity 不过时，最多自动修几次。

**质量润色/修复**
```bash
--max-polish-attempts <number>
--max-quality-fix-attempts <number>
--quality-fix-threshold <number>
--quality-pass-threshold <number>
--quality-accept-threshold <number>
```

默认：

```text
--max-polish-attempts 2
--max-quality-fix-attempts 1
--quality-fix-threshold 75
--quality-pass-threshold 85
--quality-accept-threshold 75
```

含义：

```text
quality >= pass-threshold        理想通过
quality >= accept-threshold      可带 warning 通过
quality < fix-threshold          不建议小修，倾向重写
```

你现在常用的是：

```bash
--quality-pass-threshold 85
--quality-accept-threshold 80
--quality-fix-threshold 75
```

**结构审核/剧情结构**
```bash
--max-plot-fix-attempts <number>
--structure-pass-threshold <number>
--structure-accept-threshold <number>
```

默认：

```text
--max-plot-fix-attempts 0
--structure-pass-threshold 85
--structure-accept-threshold 70
```

含义：

```text
structure >= 85       理想通过
structure >= 70       可带 warning 通过
structure < 70        MANUAL_REVIEW，需要继续修
```

结构项包括：

```text
story_effectiveness
opening_hook
antagonist_intelligence
transition_quality
six_step_plot
golden_3_chapter，前 3 章才有
```

`--max-plot-fix-attempts 1` 会让 publish-ready 遇到结构不达标时调用 LLM 修 final 候选。

**字数门槛**
```bash
--min-chapter-words <number>
```

默认：

```text
1000
```

低于这个会阻断发布准备。

**连续性特殊放行**
```bash
--accept-manual-continuity
--continuity-override-pass
```

含义：

```text
--accept-manual-continuity
允许 MANUAL_REVIEW 的连续性结果继续进入后续流程，慎用。

--continuity-override-pass
信任已有 PASS 的 final continuity report，跳过重复连续性复检，慎用。
```

**输出格式**
```bash
--json
```

输出 JSON，适合脚本调用。