###  **write-publish-export skill v2** 的目标不要再是“跑通流程”，而是：

```text
V1：自动写章 → 检查 → 补救 → 导出
V2：自动写章 → 检查 → 补救 → 分级处理 warning → 支持失败续跑 → 生成可运营报告
```

---

# V2 总目标

## 核心目标

把 v1 从“能自动生产”升级成：

```text
可批量运行
可中断恢复
可识别 warning 风险
可自动给出人工修复提示词
可沉淀质量趋势
```

---

# 我建议 V2 做 5 个任务

优先级从高到低：

```text
任务1：批量失败后的 resume 续跑
任务2：warning 自动分级处理
任务3：自动生成人工修复提示词
任务4：numeric A>0 自动修复
任务5：批量质量趋势报告
```

---

# 任务1：批量失败后的 resume 续跑

这是 V2 最重要的。

现在 v1 已经能：

```text
count=3
中途失败就停
```

但停了之后，下一次要怎么继续，目前还不够自动。

V2 应该支持：

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 3 --resume
```

或者：

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume-last
```

它应该自动读取最近一次报告：

```text
my-novel/books/<book>/reviews/write-publish-export/<timestamp>.json
```

判断：

```text
上次处理到哪章
哪章失败
失败原因是什么
是否已有 retry hint
是否可以从失败章继续
```

例如：

```text
上次 count=3：
0098 PASS
0099 STOPPED_BY_WRITE_AUDIT
0100 未处理

resume 后：
先重试 0099
0099 通过后再继续 0100
```

---

## 任务1 的预期行为

```text
如果失败原因是 STOPPED_BY_WRITE_AUDIT：
  优先检查是否存在 retry hint
  有 hint，则重试失败章

如果失败原因是 STOPPED_BY_CONTINUITY：
  优先检查 continuity-auto 是否已有 fixed 文件
  有 fixed，则从 publish-ready recheck 继续
  没有 fixed，则重新跑 continuity-auto

如果失败原因是 STOPPED_BY_NUMERIC：
  先跑 numeric-fix 或输出人工修复提示词

如果失败原因是 BLOCKED_BY_QUALITY：
  先跑 fanqie-polish

如果失败原因未知：
  不自动继续，输出人工修复提示词
```

---

# 任务2：warning 自动分级处理

现在 `READY_WITH_WARNINGS` 可以导出，这是对的。

但 V2 要做的是：**不是所有 warning 都一样。**

建议分三级：

```text
P0：阻断级，不能导出
P1：强烈建议修复，但可人工放行
P2：普通提醒，可导出
```

---

## P0 阻断级

这些必须阻断：

```text
numeric A > 0
DROP
BLOCKED_BY_CONTINUITY
BLOCKED_BY_QUALITY
SIX_PART_FAIL
章节未落盘
final file 不存在
export 文件不存在
```

---

## P1 强警告

这些不一定阻断，但要在报告里醒目标红：

```text
quality 80-84
mood-cadence 多次未满足
章节字数严重超出目标区间
状态卡 missing_state_change
payoff-impact-missing
列表式 AI 结构
连续长句过多
标题被强制大幅改写
```

---

## P2 普通提醒

```text
numeric C 类命中
状态卡 minor warning
轻微标题优化
轻微段落节奏 warning
```

---

## V2 报告里应该显示

```json
{
  "warningSummary": {
    "P0": [],
    "P1": [
      "quality score 82",
      "missing_state_change: 主角双耳失聪状态已恢复但状态卡未记录"
    ],
    "P2": [
      "numeric C=1"
    ]
  },
  "riskLevel": "MEDIUM",
  "publishAdvice": "CAN_PUBLISH_WITH_WARNINGS"
}
```

---

# 任务3：自动生成人工修复提示词

这个非常有用。

现在失败后只是告诉你失败原因。V2 要直接生成：

```text
reviews/manual-fix-prompts/0099.md
```

里面写好可以直接给 Codex 的修复提示词。

---

## 示例

如果第 99 章 continuity 失败，生成：

```md
# Manual Fix Prompt for Chapter 0099

【项目】
inkos 小说生成

【章节】
第0099章

【失败原因】
BLOCKED_BY_CONTINUITY

【检测摘要】
- continuity score: 72
- status: MANUAL_REVIEW
- 与上一章 0098 的衔接不足
- 人物状态变化未承接

【修复目标】
在不改变主线、不重置人物设定、不删除关键伏笔的前提下，修复第0099章连续性。

【硬约束】
1. 必须承接第0098章结尾事件。
2. 必须保留本章核心剧情。
3. 必须修复人物状态卡遗漏。
4. 不允许新增与主线冲突的新设定。

【请执行】
修复第0099章，并输出修复后的章节文件。
```

这样你以后不需要再手写 prompt。

---

# 任务4：numeric A>0 自动修复

V1 只做到：

```text
A=0 才能导出
A>0 停止
```

V2 可以增加：

```bash
node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99
```

或者接入已有 polish：

```bash
node scripts/fanqie/fanqie-polish.mjs 葬渊魔经 --chapter 99 --fix numeric
```

建议优先做一个独立脚本：

```text
scripts/fanqie/fix-numeric-expression.mjs
```

只做一件事：

```text
把非系统流/沉浸模式下突兀的阿拉伯数字表达改成中文自然表达。
```

例如：

```text
10% → 一成
3秒 → 数息之间 / 眨眼间
100米 → 百丈外 / 数十步外，视语境
1级 → 第一重 / 初阶，视设定
```

但要保留你之前说过的这种表达：

```text
两成功力
三分力
七八成把握
```

这些是中文网文自然表达，不应该压制。

---

# 任务5：批量质量趋势报告

现在每次有单次 report。V2 可以加一个总览：

```text
reviews/write-publish-export/quality-trend.md
```

统计最近 N 章：

```text
章节 | continuity | quality | numeric A/B/C | warning 等级 | 是否补救 | 是否导出
0092 | 98 | 84 | 0/0/2 | MEDIUM | continuity-auto | yes
0093 | 88 | 81 | 0/0/2 | MEDIUM | none | yes
0095 | 92 | 82 | 0/0/1 | MEDIUM | none | yes
0096 | 92 | 86 | 0/0/1 | LOW | continuity-auto | yes
0097 | 95 | 82 | 0/0/0 | MEDIUM | none | yes
```

然后输出趋势判断：

```text
最近 5 章质量均分：83
连续性均分：93
主要风险：
1. quality 多次在 80-84 区间
2. 状态卡 missing_state_change 偶发
3. 标题多次被强制改写
建议：
后续优先优化 writer 的标题生成和状态卡同步。
```

这个对后续长期连载很有价值。

---

# V2 我建议分两轮做

不要一次全塞给 Codex。

## V2 第一轮：稳定性增强

先做：

```text
1. resume 续跑
2. warning 分级
3. 人工修复提示词
```

这三个是最重要的。

暂时不做：

```text
numeric 自动修复
质量趋势 dashboard
```

------

## V2 第二轮：自动修复和运营报告

再做：

```text
1. numeric A>0 自动修复
2. quality trend 报告
3. 最近 N 章风险汇总
```

---

# 第一轮

## 给 Codex 的 V2 第一轮提示词

你可以直接发这个：

```text
【项目】
inkos 小说生成（Codex 驱动）

【阶段】
write-publish-export skill v2 第一轮

【背景】
write-publish-export skill v1 已封版，并通过以下真实验证：

1. 第92章：
   - write retry hint
   - continuity-auto
   - numeric final-only
   - export 成功

2. 第93章：
   - 单章 count=1 成功
   - READY_WITH_WARNINGS 可导出

3. 第95-97章：
   - count=3 批量成功
   - 第96章验证 continuity-auto + continuityOverride PASS
   - 最终 READY_TO_PUBLISH
   - export 成功

【V2 第一轮目标】
在不破坏 v1 稳定流程的前提下，增加：

1. 批量失败后的 resume 续跑能力
2. warning 自动分级
3. 自动生成人工修复提示词

【重要约束】

1. 不要修改 write next 主写作流程。
2. 不要影响 short-story 模块。
3. 不要放宽 numeric A=0 导出规则。
4. 不要放宽 DROP / BLOCKED_BY_CONTINUITY / BLOCKED_BY_QUALITY / SIX_PART_FAIL 阻断规则。
5. 不要改变 v1 已经跑通的：
   - retry hint
   - continuity-auto
   - continuityOverride
   - READY_WITH_WARNINGS 可导出
   - export-fanqie --use-reviewed
6. 所有新增能力优先放在：
   scripts/fanqie/write-publish-export.mjs
   或新建 scripts/fanqie/write-publish-export-utils.mjs
7. 尽量减少对 core writer 的改动。

【任务1：resume 续跑】

新增参数：

--resume-last
--resume <reportPath>

示例：

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume-last

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume my-novel/books/葬渊魔经/reviews/write-publish-export/xxxx.json

行为要求：

1. --resume-last：
   - 自动读取 my-novel/books/<book>/reviews/write-publish-export/ 下最新的 json 报告。
   - 判断上次是否存在失败章节。
   - 如果上次已经 READY_TO_PUBLISH，则提示无需 resume。

2. --resume <reportPath>：
   - 读取指定报告。
   - 找到第一个非 READY_TO_PUBLISH 的章节。
   - 从失败章节继续处理。

3. 不同失败状态的处理：

A. STOPPED_BY_WRITE_AUDIT：
   - 检查 reviews/write-retry-hints/<chapter>.md 是否存在。
   - 如果存在，重新执行 write next。
   - 如果不存在，生成 retry hint 和 manual fix prompt，然后停止。

B. STOPPED_BY_CONTINUITY：
   - 如果已有 chapters-fixed/<chapter>_attempt*.md 或 publish-ready report 中有 final file，则优先从 publish-ready recheck 继续。
   - 否则重新执行 continuity-auto。
   - continuity-auto PASS 后继续 quality / numeric / export。

C. STOPPED_BY_QUALITY / BLOCKED_BY_QUALITY：
   - 执行 fanqie-polish。
   - 然后重新 publish-ready。

D. STOPPED_BY_NUMERIC：
   - 现在先不要自动修 numeric。
   - 生成 manual fix prompt，停止。

E. STOPPED_BY_SIX_PART：
   - 执行 repair-fanqie。
   - 然后重新 publish-ready。

F. UNKNOWN_ERROR：
   - 不自动继续。
   - 生成 manual fix prompt。

4. 批量 resume：
   - 如果原报告 requested count=3，处理到第2章失败，则 resume 应该先处理失败章。
   - 失败章通过后，继续补足剩余章节数量。
   - 不允许跳过失败章直接写后续章节。

【任务2：warning 自动分级】

在 write-publish-export 的 JSON/MD 报告中新增 warningSummary：

{
  "P0": [],
  "P1": [],
  "P2": []
}

分级规则：

P0 阻断级：
- numeric A > 0
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
- quality score 80-84
- mood-cadence spot-fix 后仍未满足
- missing_state_change
- payoff-impact-missing
- 列表式 AI 结构
- 连续长句过多
- 字数严重超出目标区间
- 标题被大幅改写

P2 普通提醒：
- numeric C > 0
- minor 状态校验 warning
- 标题轻微优化
- 普通 paragraph warning

报告中新增：

riskLevel:
- BLOCKED：存在 P0
- MEDIUM：存在 P1
- LOW：只有 P2 或无 warning

publishAdvice:
- DO_NOT_PUBLISH：存在 P0
- CAN_PUBLISH_WITH_WARNINGS：存在 P1 但无 P0
- CAN_PUBLISH：无 P0/P1

【任务3：自动生成人工修复提示词】

新增目录：

my-novel/books/<book>/reviews/manual-fix-prompts/

当章节最终失败或 UNKNOWN_ERROR 时，自动生成：

my-novel/books/<book>/reviews/manual-fix-prompts/<chapter>.md

内容包括：

1. 书名
2. 章节号
3. 失败状态
4. 失败步骤
5. 关键日志摘要
6. 已执行过的补救动作
7. 建议下一步
8. 可直接发给 Codex 的修复提示词

不同失败类型要生成不同提示词：

A. WRITE_AUDIT 失败：
   - 强调 promised payoff、ending type、mood directive、scene semantic
   - 要求重试写章，不改主线

B. CONTINUITY 失败：
   - 强调承接上一章、人物状态、伏笔、战力一致性
   - 要求修复章节连续性

C. QUALITY 失败：
   - 强调网文节奏、番茄风格、段落、爽点、钩子
   - 要求不改主线，只润色

D. NUMERIC 失败：
   - 强调非系统流沉浸模式下避免突兀阿拉伯数字
   - 要求保留自然中文表达，例如“两成功力”

E. SIX_PART 失败：
   - 强调 Hook / Pressure / Attempt / Twist / Payoff / Pull
   - 不改主线，只补齐缺失节奏功能

【报告要求】

JSON 报告新增字段：

- resume:
  - enabled
  - sourceReport
  - resumedFromChapter
  - remainingCount

- warningSummary
- riskLevel
- publishAdvice
- manualFixPrompt
  - generated
  - path

Markdown 报告新增：

## Warning Summary

## Risk Level

## Publish Advice

## Resume Info

## Manual Fix Prompt

【验收标准】

1. 原有命令仍可用：

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 1

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 3

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --from 95 --to 97 --no-export

2. 新命令可用：

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume-last

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume <reportPath>

3. 当报告中存在失败章节时：
   - resume 能从失败章节继续
   - 不会跳过失败章
   - 失败章通过后能继续剩余章节

4. 当报告已经 READY_TO_PUBLISH 时：
   - --resume-last 应提示无需 resume

5. warningSummary 能正确识别：
   - READY_WITH_WARNINGS => P1
   - numeric C>0 => P2
   - numeric A>0 => P0
   - BLOCKED_BY_CONTINUITY => P0

6. 失败时能生成：
   reviews/manual-fix-prompts/<chapter>.md

7. build 通过：

pnpm --filter @actalk/inkos-core build
pnpm --filter @actalk/inkos build

8. 相关测试通过。

【完成后请输出】

1. 修改文件列表
2. resume 的使用方式
3. warning 分级规则位置
4. manual fix prompt 的生成路径
5. 验证命令和结果
```

---





## V2 第一轮完成后怎么验证

Codex 做完后，你按这个顺序跑。

### 1. build

```bash
pnpm --filter @actalk/inkos-core build
pnpm --filter @actalk/inkos build
```

### 2. 正常 count=1 不被破坏

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 1 --no-export
```

### 3. 正常 from/to 不被破坏

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --from 95 --to 97 --no-export
```

### 4. resume-last 在已成功报告上的行为

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume-last
```

如果最新报告是成功的，应提示：

```text
Latest report is already READY_TO_PUBLISH. Nothing to resume.
```

### 5. 找一个失败报告测试 resume

比如之前有：

```text
STOPPED_BY_CONTINUITY
STOPPED_BY_WRITE_AUDIT
```

用：

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume my-novel/books/葬渊魔经/reviews/write-publish-export/失败报告.json
```

验证是否从失败章节继续。

### 6. 验证结论

可以封版：

```
write-publish-export skill v2 第一轮：验证通过
```

通过能力包括：

```
1. 正常 count=1
2. 正常 from/to
3. resume-last 成功报告识别
4. resume 指定失败报告
5. continuity resume
6. continuity override
7. warning 分级
8. riskLevel / publishAdvice
9. numeric A>0 P0 阻断
10. manual fix prompt 自动生成
```

```bash
git add .
git commit -m "feat(fanqie): enhance write publish export with resume and risk reporting"
```

# 第二轮

可以，V2 第二轮开始。

我建议第二轮只做三个能力：

```text
1. numeric A>0 自动修复
2. 最近 N 章质量趋势报告
3. warning 自动修复建议，不直接乱改正文
```

其中优先级最高的是：

```text
numeric A>0 自动修复
```

因为现在第 99 章已经被真实阻断了：

```text
numeric final-only A=1 for chapter 0099
```

这个正好可以作为验收样本。

------

## V2 第二轮目标

### 目标一：numeric A>0 自动修复

当前 V2 第一轮是：

```text
numeric A>0
→ STOPPED_BY_NUMERIC
→ 生成 manual fix prompt
→ 不导出
```

第二轮要升级成：

```text
numeric A>0
→ 自动执行 fix-numeric-expression
→ 再次 check-numeric-expression
→ A=0 后继续 export
→ 如果仍 A>0，再停止并生成 manual fix prompt
```

------

### 一、numeric 自动修复设计

#### 新增脚本

建议新增：

```text
scripts/fanqie/fix-numeric-expression.mjs
```

命令：

```bash
node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99
```

支持区间：

```bash
node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --from 95 --to 99
```

支持 final-only：

```bash
node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only
```

------

#### 修复来源文件

优先修：

```text
chapters-reviewed/0099_final.md
```

如果不存在，再考虑：

```text
chapters-fixed/0099_attempt*.md
chapters/0099_*.md
```

但建议第二轮只处理：

```text
chapters-reviewed/<chapter>_final.md
```

因为 numeric 检查现在是 `--final-only`，最终要导出的也是 reviewed/final。

------

#### 输出文件建议

不要直接覆盖原文件，先生成：

```text
chapters-reviewed/0099_final.numeric-fixed.md
```

然后通过验证后再替换或注册为最终导出源。

更稳的路径：

```text
my-novel/books/<book>/chapters-reviewed/0099_final.md
my-novel/books/<book>/chapters-reviewed/0099_final.numeric-backup.md
```

流程：

```text
1. 备份原 final
2. 写入修复后的 final
3. 再跑 numeric scan
4. 如果 A=0，保留
5. 如果 A>0，恢复 backup
```

------

### 二、numeric 修复规则

你之前已经说过一个重要原则：

```text
非系统流里，不要突兀出现阿拉伯数字。
但中文自然表达可以保留，比如“两成功力”。
```

所以规则要分清楚。

------

#### 需要修的 A 类

这些要修：

```text
10%
5%
3秒
100米
20分钟
1级
2阶
30点气血
HP 0
气血值 0
+10
-5
系统面板式数字
```

改成更自然的网文表达。

------

#### 不应该修的中文自然表达

这些不修：

```text
一成
两成
三分力
七八成把握
数息
半盏茶
一炷香
百丈
十余步
三五人
一两句话
```

------

#### 修复示例

```text
气血恢复至5%
→ 气血勉强回暖了一线

只剩0.1%
→ 几乎只剩一口残息

3秒后
→ 数息之后

100米外
→ 百丈之外 / 数十步外，按语境

第1阶段
→ 第一重 / 初阶 / 第一层，按设定

提升10%
→ 力量明显拔高一截

HP归零
→ 气血彻底见底
```

------

### 三、write-publish-export 接入逻辑

在 `write-publish-export.mjs` 里新增参数：

```bash
--max-numeric-fix 1
--disable-numeric-fix
```

默认：

```text
--max-numeric-fix=1
```

也就是最多自动修一次。

------

#### numeric 分支新逻辑

现在是：

```text
numeric A>0
→ STOPPED_BY_NUMERIC
```

第二轮改为：

```text
numeric A>0
→ 如果 maxNumericFix > 0
    → 执行 fix-numeric-expression
    → 重新 check-numeric-expression
    → 如果 A=0
        → 继续 export
    → 如果 A>0
        → STOPPED_BY_NUMERIC
        → 生成 manual fix prompt
  否则
    → STOPPED_BY_NUMERIC
```

报告中新增：

```json
{
  "numericFix": {
    "attempted": true,
    "attempts": 1,
    "before": {
      "A": 1,
      "B": 0,
      "C": 2
    },
    "after": {
      "A": 0,
      "B": 0,
      "C": 2
    },
    "file": "chapters-reviewed/0099_final.md",
    "backup": "chapters-reviewed/0099_final.numeric-backup.md"
  }
}
```

------

### 四、质量趋势报告

新增脚本或集成到总控里都可以。

建议新增：

```text
scripts/fanqie/write-publish-export-trend.mjs
```

命令：

```bash
node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --last 10
```

输出：

```text
my-novel/books/葬渊魔经/reviews/write-publish-export/quality-trend.md
my-novel/books/葬渊魔经/reviews/write-publish-export/quality-trend.json
```

------

#### 趋势报告统计内容

```text
最近 N 章：
- continuity 平均分
- quality 平均分
- READY_TO_EXPORT 数量
- READY_WITH_WARNINGS 数量
- STOPPED 数量
- numeric A/B/C 合计
- continuity-auto 使用次数
- fanqie-polish 使用次数
- repair-fanqie 使用次数
- warning P0/P1/P2 数量
```

------

#### 示例趋势报告

```md
# Write Publish Export Quality Trend

book: 葬渊魔经
range: 0092-0099

## Summary

- chapters: 8
- ready: 7
- blocked: 1
- avg continuity: 92.1
- avg quality: 83.4
- numeric A total: 1
- numeric C total: 7
- continuity-auto used: 2
- riskLevel: MEDIUM

## Main Risks

1. quality 多次处于 80-84 区间
2. numeric C 高频出现
3. 第99章出现 NUMERIC_A 阻断
4. 标题多次被强制改写

## Advice

- 优先修复第99章 NUMERIC_A。
- 后续可加强 writer 对“沉浸式数字表达”的规避。
- quality 目标建议从 80+ 提升到 85+。
```

------

### 五、warning 自动修复建议

这个第二轮先不要自动改正文，只生成建议。

例如报告中新增：

```json
{
  "autoFixSuggestions": [
    {
      "type": "NUMERIC_A",
      "priority": "P0",
      "suggestedCommand": "node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only"
    },
    {
      "type": "QUALITY_WARN_POLISH_OPTIONAL",
      "priority": "P1",
      "suggestedCommand": "node scripts/fanqie/fanqie-polish.mjs 葬渊魔经 --chapter 98"
    },
    {
      "type": "MISSING_STATE_CHANGE",
      "priority": "P1",
      "suggestedAction": "补充状态卡同步或降低状态卡审计强度"
    }
  ]
}
```

------

### 给 Codex 的 V2 第二轮提示词

直接发这个：

```text
【项目】
inkos 小说生成（Codex 驱动）

【阶段】
write-publish-export skill v2 第二轮

【背景】
V2 第一轮已经完成并验证通过：

1. build 通过
2. count=1 --no-export 正常
3. from/to --no-export 正常
4. --resume-last 对成功报告正确提示 Nothing to resume
5. --resume 指定失败报告可以从失败章节恢复
6. warningSummary / riskLevel / publishAdvice 已生效
7. manual-fix-prompts 已生成
8. numeric A>0 仍然严格阻断

当前真实样本：
第99章被 numeric 阻断：

numeric final-only A=1 for chapter 0099. Numeric-fix mode is not available yet; export blocked.

manual fix prompt 已生成：

my-novel/books/葬渊魔经/reviews/manual-fix-prompts/0099.md

【V2 第二轮目标】
在不破坏 V1/V2 第一轮稳定链路的前提下，增加：

1. numeric A>0 自动修复
2. 最近 N 章质量趋势报告
3. warning 自动修复建议

【重要约束】

1. 不要修改 write next 主写作流程。
2. 不要影响 short-story 模块。
3. 不要放宽 numeric A=0 导出规则。
4. 不要放宽 DROP / BLOCKED_BY_CONTINUITY / BLOCKED_BY_QUALITY / SIX_PART_FAIL 阻断规则。
5. numeric A>0 只能在自动修复后重新检查，确认 A=0 才允许 export。
6. numeric 自动修复最多默认 1 次，禁止无限循环。
7. 如果 numeric 修复后仍 A>0，必须停止并生成 manual fix prompt。
8. 不要把中文自然表达误修掉，例如“两成功力”“三分力”“七八成把握”“数息”“一炷香”等。
9. 优先修复 chapters-reviewed/<chapter>_final.md，因为 check-numeric-expression 使用 final-only。
10. 所有修复必须备份原文件。

【任务1：新增 numeric 修复脚本】

新增：

scripts/fanqie/fix-numeric-expression.mjs

支持命令：

node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99

node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --from 95 --to 99

node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only

默认修复 final 文件：

my-novel/books/<book>/chapters-reviewed/<chapter>_final.md

如果 final 文件不存在，再停止并报告，不要乱修原始 chapters。

修复前必须备份：

my-novel/books/<book>/chapters-reviewed/<chapter>_final.numeric-backup.md

修复报告输出：

my-novel/books/<book>/reviews/numeric-expression/<chapter>.numeric-fix-report.md
my-novel/books/<book>/reviews/numeric-expression/<chapter>.numeric-fix-report.json

【numeric 修复规则】

目标：修复非系统流/沉浸模式下突兀的阿拉伯数字表达。

需要处理的常见类型：

- 百分比：5%、10%、0.1%
- 时间：3秒、10分钟
- 距离：100米、30米
- 等级/阶段：1级、2阶、第3阶段
- 面板式数值：HP 0、气血值0、+10、-5
- 数字化战力表达：提升10%、伤害30点

转换原则：
- 不要机械替换，要尽量根据上下文改成中文网文自然表达。
- 可以使用规则替换 + LLM polish 二选一。
- 如果使用 LLM，prompt 必须明确：只改 numeric 表达，不改剧情，不增删角色，不改伏笔，不改主线。
- 必须保留中文自然表达，例如：
  两成功力、三分力、七八成把握、数息、一炷香、百丈、十余步、三五人。

示例：
- 气血恢复至5% -> 气血勉强回暖了一线
- 只剩0.1% -> 几乎只剩一口残息
- 3秒后 -> 数息之后
- 100米外 -> 百丈之外 / 数十步外，按语境
- 提升10% -> 力量明显拔高一截
- HP归零 -> 气血彻底见底

【任务2：接入 write-publish-export】

在 scripts/fanqie/write-publish-export.mjs 中新增：

--max-numeric-fix <n>
默认：1

--disable-numeric-fix
表示完全禁用 numeric 自动修复，保持旧行为。

当 numeric-final-only 出现 A>0 时：

1. 如果 maxNumericFix > 0 且未超过次数：
   - 执行 fix-numeric-expression.mjs <book> --chapter <chapter> --final-only
   - 再次执行 check-numeric-expression.mjs --final-only
   - 如果 A=0，则继续 export
   - 如果 A>0，则 STOPPED_BY_NUMERIC，生成 manual fix prompt

2. 如果禁用 numeric fix：
   - 保持旧行为：STOPPED_BY_NUMERIC

报告新增字段：

numericFix:
  attempted: true/false
  attempts: number
  before:
    A/B/C
  after:
    A/B/C
  fixedFile
  backupFile
  reportFile
  result: PASS / STILL_BLOCKED / SKIPPED

Markdown 报告新增：

## Numeric Fix

【任务3：质量趋势报告】

新增脚本：

scripts/fanqie/write-publish-export-trend.mjs

支持：

node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --last 10

node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --from 92 --to 99

输出：

my-novel/books/<book>/reviews/write-publish-export/quality-trend.md
my-novel/books/<book>/reviews/write-publish-export/quality-trend.json

统计字段：

- chapter count
- ready count
- blocked count
- avg continuity score
- avg quality score
- READY_TO_EXPORT count
- READY_WITH_WARNINGS count
- STOPPED count
- numeric A/B/C total
- continuity-auto count
- fanqie-polish count
- repair-fanqie count
- P0/P1/P2 warning counts
- most common warning types
- riskLevel
- advice

注意：
- 通过读取 write-publish-export 的 json 报告和 publish-ready report 汇总。
- 找不到某项时允许 n/a，不要报错中断。

【任务4：warning 自动修复建议】

在 write-publish-export JSON/MD 报告中新增 autoFixSuggestions。

示例：

autoFixSuggestions:
- type: NUMERIC_A
  priority: P0
  suggestedCommand: node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only

- type: QUALITY_WARN_POLISH_OPTIONAL
  priority: P1
  suggestedCommand: node scripts/fanqie/fanqie-polish.mjs 葬渊魔经 --chapter 98

- type: MISSING_STATE_CHANGE
  priority: P1
  suggestedAction: 补充状态卡同步或降低状态卡审计强度

要求：
- P0 必须给出明确建议。
- P1 尽量给出建议。
- P2 可以只汇总，不一定给命令。
- 只生成建议，不自动执行除 numeric fix 以外的修复。

【验收标准】

1. build 通过：

pnpm --filter @actalk/inkos-core build
pnpm --filter @actalk/inkos build

2. 原有命令不被破坏：

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --count 1 --no-export

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --from 95 --to 97 --no-export

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume-last

3. 第99章 numeric 修复验证：

先执行：

node scripts/fanqie/check-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only

确认 A>0。

再执行：

node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only

再执行：

node scripts/fanqie/check-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only

期望 A=0。

4. write-publish-export 自动 numeric fix 验证：

找一个 numeric A>0 的报告或第99章当前状态，执行：

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume-last

或者：

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume <第99章STOPPED_BY_NUMERIC报告.json>

期望：
- 自动执行 numeric fix
- 再次 numeric check
- A=0 后继续 export
- 报告中 numericFix.attempted=true

5. 禁用 numeric fix 验证：

node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume <第99章STOPPED_BY_NUMERIC报告.json> --disable-numeric-fix

期望保持旧行为：
- STOPPED_BY_NUMERIC
- 不 export

6. 趋势报告验证：

node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --last 10

期望生成：

reviews/write-publish-export/quality-trend.md
reviews/write-publish-export/quality-trend.json

7. short-story 不受影响。

【完成后请输出】

1. 修改文件列表
2. numeric fix 的脚本路径和规则
3. write-publish-export 的 numeric fix 接入逻辑
4. quality trend 报告路径
5. autoFixSuggestions 示例
6. 验证命令和结果
```

------

### 第二轮完成后的验证顺序

Codex 做完后，你让它按这个顺序验。

#### 1. build

```bash
pnpm --filter @actalk/inkos-core build
pnpm --filter @actalk/inkos build
```

#### 2. 先单独验证第 99 章 numeric fix

```bash
node scripts/fanqie/check-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only
```

确认 A>0。

然后：

```bash
node scripts/fanqie/fix-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only
```

再检查：

```bash
node scripts/fanqie/check-numeric-expression.mjs 葬渊魔经 --chapter 99 --final-only
```

必须看到：

```text
A=0
```

------

#### 3. 验证 resume 能自动继续

用第 99 章阻断报告：

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume my-novel/books/葬渊魔经/reviews/write-publish-export/2026-05-12T03-08-36-771Z.json
```

期望：

```text
numericFix.attempted=true
numeric after A=0
finalStatus=READY_TO_PUBLISH
exported=true
```

------

#### 4. 验证禁用 numeric fix

```bash
node scripts/fanqie/write-publish-export.mjs 葬渊魔经 --resume my-novel/books/葬渊魔经/reviews/write-publish-export/2026-05-12T03-08-36-771Z.json --disable-numeric-fix
```

期望：

```text
STOPPED_BY_NUMERIC
exported=false
```

------

#### 5. 生成趋势报告

```bash
node scripts/fanqie/write-publish-export-trend.mjs 葬渊魔经 --last 10
```

看：

```text
reviews/write-publish-export/quality-trend.md
reviews/write-publish-export/quality-trend.json
```

#### 6. 结论

可以封版：

```
write-publish-export skill v2 第二轮：通过
```

已验证能力：

```
✅ numeric A>0 自动修复
✅ numeric 修复备份
✅ resume 续跑
✅ --disable-numeric-fix 强阻断
✅ quality trend 报告
✅ warningSummary P0/P1/P2
✅ riskLevel / publishAdvice
✅ autoFixSuggestions
✅ 原有命令未破坏
```
