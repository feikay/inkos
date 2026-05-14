# 给 export-fanqie.mjs 增加“发布候选章节选择逻辑”
```bash
【选择优先级】

对每个章节 index，按以下优先级选择正文文件：

1. chapters-polished/{index}_polished_attempt{N}.md
   - 选择 attempt 最大的
   - 仅当 final-quality-report.json 中 final_quality_status = QUALITY_PASS

2. chapters-salvaged/{index}_salvage_lightfix.md
   - 仅当 salvage-report 或 final-report 中 final_status = PASS

3. chapters-salvaged/{index}_salvage.md
   - 仅当 salvage-report 或 final-report 中 final_status = PASS

4. chapters-fixed/{index}_attempt{N}.md
   - 选择 attempt 最大的
   - 仅当 final-report 中 final_status = PASS

5. chapters/{index}_*.md
   - 原始章节兜底

--use-reviewed

开启后：
- 优先使用 reviewed/polished/fixed/salvaged 版本
- 如果存在 final_status = DROP / MANUAL_REVIEW，禁止导出该章
- 如果存在 final_quality_status = QUALITY_MANUAL_REVIEW，禁止导出该章
- 输出明确错误

示例：

node scripts/fanqie/export-fanqie.mjs 葬渊魔经 --from 1 --to 999 --use-reviewed --title "气血为0，我却能撬动规则"

---

【非严格模式】

不带 --use-reviewed 时：
- 保持旧逻辑
- 继续读取 chapters/ 原始章节
- 不影响现有流程

---

【CLI 输出】

导出时打印每章使用来源：

[export-fanqie]
0019 -> chapters-fixed/0019_attempt2.md
0020 -> chapters-polished/0020_polished_attempt1.md
0021 -> chapters/0021_xxx.md

如果阻止导出：

Chapter 0019 blocked: final_status=DROP. Please fix before export.

```

# continuity-auto执行后，怎么看输出的三个日志
```bash
# reviews/continuity/下有0019.final-report.md、0019.report.md、0019.salvage-report.md
👉 report.md = 原因
👉 salvage-report.md = 系统努力后的结果
👉 final-report.md = 是否能用

# 1. 看最终报告
open reviews/continuity/0019.final-report.md

# 2. 看 salvage
open chapters-salvaged/0019_salvage.md

# 3. 决策
👉 好 → 直接替换
👉 一般 → 手改
👉 烂 → 重写

# 4. 再检测
node packages/cli/dist/index.js review continuity-auto --chapter 19
```

# --accept-manual-continuity流程风险
```bash
你要注意：--accept-manual-continuity 不能常态化使用。

这次可以接受，是因为报告里没有实质性连续性错误，只是“防虚高”拦了一下。
但以后如果报告指出：

-------------------
开头断裂
上一章危机被跳过
关键伏笔忽略
人物状态不一致
行动目标模糊
危机停滞
--------------------

那就不要用 --accept-manual-continuity 放行。

你可以把它当成这个规则：

只有当 MANUAL_REVIEW 的原因是“低风险审慎拦截”，且报告无实质剧情错误时，才允许人工接受。
```
