我的理解是：**inkos 2.0 大升级后，这些工具不应该再是一串“修文流水线”，而应该变成一套分层闸门系统。**

核心原则是：

> **write next 负责生产；review reject 负责否决；continuity-auto / publish-ready 负责判定；fanqie-polish / repair-fanqie 负责有限修复；export-fanqie 负责最终封装发布。**
> 不能让每个工具都既写、又审、又改、又导出，否则系统会失控。

---

# 一、整体分工图

我建议把这几个工具分成 5 层：

```text
创作层
  write next

人工否决层
  review reject

质量检测层
  continuity-auto
  publish-ready

有限修复层
  fanqie-polish
  repair-fanqie

发布封装层
  export-fanqie
```

对应职责应该是：

| 工具              | 核心职责          |           是否能改正文 |   是否能阻断流程 |
| --------------- | ------------- | ---------------: | --------: |
| write next      | 生成下一章，并写入状态   |           是，生成新章 |         是 |
| review reject   | 人工否决某章/某版本    |             不改正文 |         是 |
| continuity-auto | 连续性、资源、剧情状态检查 |  原则上不直接改；可生成修复候选 |         是 |
| publish-ready   | 发布前总闸门        |      不直接创作；可调用修复 |         是 |
| fanqie-polish   | 番茄风格润色        |        是，但只能轻改表达 | 是，超过边界应退回 |
| repair-fanqie   | 针对番茄发布问题修复    |        是，但只能定向修复 |         是 |
| export-fanqie   | 导出番茄发布文件      | 不改剧情；只做格式封装/硬性清洗 |         是 |

---

# 二、write next：创作入口，不是质量兜底器

## 它的职责

`write next` 应该负责：

1. 读取当前书籍状态；
2. 读取 inkos 2.0 的故事骨架；
3. 读取上一章结果；
4. 读取当前章意图；
5. 生成下一章正文；
6. 更新章节状态、事实、资源事件、角色状态、伏笔状态；
7. 输出基础 report。

inkos 2.0 后，`write next` 不应该只是“接着写一章”，而应该是：

> **按照故事生产系统下发的 chapter intent 写一章。**

它应该读取的东西包括：

```text
book bible
world engine
character state
antagonist map
motivation matrix
resource plan
plot thread
chapter intent
previous chapter state
particle ledger
```

## 它应该守的门限

`write next` 的门限不应该太重，但必须守住“生成合法性”。

建议门限：

| 项目                    | 门限                                                           |
| --------------------- | ------------------------------------------------------------ |
| 是否能读取上一章状态            | 必须                                                           |
| 上一章是否 state-degraded  | 不允许继续写，除非显式 override                                         |
| 当前章是否有 chapter intent | 必须有；没有就先生成 intent                                            |
| 主角状态是否可用              | 必须                                                           |
| 世界观/战力/资源账本是否可读       | 必须                                                           |
| 字数                    | 长篇番茄建议 2000～3500；短故事按规划                                      |
| 章节结构                  | 至少具备 hook / pressure / attempt / twist / payoff / pull 的基本形态 |
| 输出文件                  | 必须生成正文 + report + state 更新                                   |

## 它不该做什么

`write next` 不应该承担：

1. 最终番茄发布检查；
2. 批量导出；
3. 过度润色；
4. 修复历史章节；
5. 自动忽略上一章的问题继续往下写。

也就是说：

> `write next` 可以产出“不够好但可审”的章节，但不能产出“状态污染”的章节后继续往下写。

---

# 三、review reject：人工否决开关，不是修复工具

## 它的职责

`review reject` 的本质是：

> **我作为项目负责人判断这一章不能进入后续链路。**

它应该做的是标记状态，而不是改正文。

典型场景：

```text
这一章方向错了
这一章主角行为崩了
这一章和设计目标不符
这一章虽然检测通过，但读起来不对
这一章不适合继续作为上下文
```

## 它应该守的门限

| 项目                         | 门限              |
| -------------------------- | --------------- |
| reject 后是否允许 write next 继续 | 不允许             |
| reject 后是否允许 export        | 不允许             |
| reject 后是否允许 publish-ready | 可以，但应直接失败或提示需重写 |
| 是否保留原文                     | 必须保留            |
| 是否生成 rejection reason      | 强烈建议必须          |

建议状态：

```text
accepted
manual_review
rejected
rewritten
archived
```

`review reject` 最关键的是防止：

> 被你人工否决过的章节，又被系统当成正常上下文继续污染后续章节。

---

# 四、continuity-auto：连续性与状态闸门，不是文风工具

## 它的职责

`continuity-auto` 是 inkos 2.0 里面非常关键的工具。

它不应该检查“这章好不好看”这种泛泛质量，而应该检查：

```text
剧情是否接得上
角色动机是否接得上
战力是否接得上
资源变化是否接得上
伏笔是否延续
上一章结尾是否被承接
本章新增事实是否被记录
是否出现未解释的新人物/新设定
是否污染世界观
是否错误消费资源
```

它的核心身份是：

> **故事状态一致性检查器。**

## 它应该守的门限

建议分成 4 类门限：

### 1. 硬阻断

这些出现就不能继续：

| 问题                      | 处理    |
| ----------------------- | ----- |
| 上一章核心事件未承接              | BLOCK |
| 主角位置/状态矛盾               | BLOCK |
| 重要角色死而复生/消失无解释          | BLOCK |
| 战力跃迁无铺垫                 | BLOCK |
| 资源凭空出现/凭空消失             | BLOCK |
| 章节与 chapter intent 完全不符 | BLOCK |
| 使用了 rejected 章节作为上下文    | BLOCK |

### 2. 强警告

可以进入人工判断，但不应自动通过：

| 问题        | 处理            |
| --------- | ------------- |
| 新人物出现但未入账 | MANUAL_REVIEW |
| 伏笔被遗忘     | MANUAL_REVIEW |
| 动机薄弱      | MANUAL_REVIEW |
| 反派行为降智    | MANUAL_REVIEW |
| 上章钩子承接弱   | MANUAL_REVIEW |

### 3. 可自动修复

这些可以生成候选修复：

| 问题        | 处理                 |
| --------- | ------------------ |
| 称谓轻微不一致   | AUTO_FIX_CANDIDATE |
| 时间表达不清    | AUTO_FIX_CANDIDATE |
| 上章钩子补一句承接 | AUTO_FIX_CANDIDATE |
| 资源账本缺少记录  | AUTO_FIX_CANDIDATE |
| 新事实未提取    | AUTO_FIX_CANDIDATE |

### 4. 信息提示

不阻断：

| 问题                 | 处理   |
| ------------------ | ---- |
| Resource Plan 轻微滞后 | INFO |
| 角色心理变化略快但可解释       | INFO |
| 支线暂未推进             | INFO |

## 建议状态

```text
PASS
WARN
MANUAL_REVIEW
BLOCKED
DROP
```

我的建议是：

| 分数/状态     | 结果                    |
| --------- | --------------------- |
| 90+ 且无硬伤  | PASS                  |
| 80～89 无硬伤 | WARN，可进 publish-ready |
| 70～79     | MANUAL_REVIEW         |
| <70       | BLOCKED               |
| 严重污染状态    | DROP                  |

`DROP` 的含义要非常严肃：

> 这一章不能修修补补，应该重写。

---

# 五、publish-ready：发布前总闸门，不是单一检测器

## 它的职责

`publish-ready` 应该是总控，不应该自己变成一个巨大的修复器。

它负责汇总：

```text
continuity-auto
fanqie quality
numeric scan
title check
paragraph style check
non-body marker check
chapter rhythm check
word count check
export source check
```

也就是：

> **判断这一章是否可以进入发布候选。**

## 它应该守的门限

publish-ready 应该分为几个关卡：

### 1. 状态门

| 检查                         | 门限         |
| -------------------------- | ---------- |
| chapter 是否 rejected        | 必须阻断       |
| chapter 是否 state-degraded  | 必须阻断       |
| 是否存在 continuity BLOCK/DROP | 必须阻断       |
| 是否有最新 fixed/reviewed 候选    | 必须明确使用哪个版本 |

### 2. 连续性门

| 检查              | 门限            |
| --------------- | ------------- |
| continuity-auto | PASS 或 WARN   |
| MANUAL_REVIEW   | 默认阻断，除非用户手动放行 |
| BLOCKED/DROP    | 阻断            |

### 3. 番茄发布门

| 检查    | 门限                    |
| ----- | --------------------- |
| 字数    | 长篇至少 1000，建议 2000+    |
| 非正文标记 | 不允许 `###`、分析说明、模型提示   |
| 标题    | 不能是“未命名章节”、纯编号、无吸引力标题 |
| 段落    | 不能出现大段论文式文本           |
| 节奏    | 6段结构至少 4/6，核心章节建议 5/6 |
| 开头    | 不能连续多章高度相似            |
| 结尾    | 必须有 pull 或情绪余波        |
| 数字表达  | 非系统流避免突兀阿拉伯数字         |

### 4. 修复门

publish-ready 可以调用修复，但要有边界：

```text
轻微问题 → 调 fanqie-polish / repair-fanqie
结构问题 → 退回 rewrite
连续性问题 → 退回 continuity fix 或 rewrite
方向问题 → review reject
```

## publish-ready 最终状态

我建议最终只输出这几种：

```text
READY
READY_WITH_WARNINGS
NEEDS_POLISH
NEEDS_REPAIR
MANUAL_REVIEW
BLOCKED_BY_CONTINUITY
BLOCKED_BY_STATE
DROP_REWRITE_REQUIRED
```

其中：

| 状态                    | 后续              |
| --------------------- | --------------- |
| READY                 | 可 export        |
| READY_WITH_WARNINGS   | 可人工决定 export    |
| NEEDS_POLISH          | 调 fanqie-polish |
| NEEDS_REPAIR          | 调 repair-fanqie |
| MANUAL_REVIEW         | 人工看             |
| BLOCKED_BY_CONTINUITY | 回 continuity    |
| BLOCKED_BY_STATE      | 修状态             |
| DROP_REWRITE_REQUIRED | 重写              |

---

# 六、fanqie-polish：轻润色，不许改剧情

## 它的职责

`fanqie-polish` 是“番茄读感优化器”。

它可以做：

```text
拆分过长段落
增强开头吸引力
增强结尾钩子
优化标题
减少说明腔
增加短句
调整对白节奏
压缩冗余描写
提升爽点表达
清理不适合番茄的表达
```

它不应该做：

```text
新增核心剧情
改变角色决定
改变战斗结果
新增关键道具
改变资源消耗
改变章节结局
改变伏笔方向
```

## 它应该守的门限

| 项目    | 门限                 |
| ----- | ------------------ |
| 剧情改动率 | 必须低                |
| 新增事实  | 不允许，除非只是表达层补足      |
| 角色关系  | 不允许改变              |
| 战力/资源 | 不允许改变              |
| 字数变化  | 建议 ±15% 内          |
| 风格目标  | 更番茄、更短句、更有钩子       |
| 输出    | 必须保留 polish report |

关键原则：

> fanqie-polish 只能让“同一章更好读”，不能让“这一章变成另一章”。

如果它发现原文结构太差，应该返回：

```text
NEEDS_REWRITE
```

而不是硬改。

---

# 七、repair-fanqie：定向修复，不是二次创作

## 它的职责

`repair-fanqie` 应该比 `fanqie-polish` 更窄。

它处理的是 publish-ready 或 export-fanqie 发现的具体问题，例如：

```text
标题不合格
段落过长
存在 ###
存在非正文说明
6段节奏缺 Hook/Pull
开头重复
结尾没钩子
字数低于番茄要求
数字表达不合适
```

它的输入应该是明确问题，不是泛泛一句“帮我优化”。

## 它应该守的门限

| 问题类型   | repair-fanqie 能否处理 |
| ------ | ------------------ |
| 非正文标记  | 可以                 |
| 标题问题   | 可以                 |
| 段落问题   | 可以                 |
| 开头重复   | 可以                 |
| 轻微节奏问题 | 可以                 |
| 结尾钩子弱  | 可以                 |
| 字数差一点  | 可以                 |
| 主线不连续  | 不可以                |
| 角色崩坏   | 不可以                |
| 战力矛盾   | 不可以                |
| 章节方向错  | 不可以                |

也就是说：

> repair-fanqie 是“补丁工具”，不是“救烂章工具”。

如果 6 段节奏只有 2/6 或 3/6，且缺的是核心结构，例如 Hook、Attempt、Payoff 全缺，就不应该 repair，而应该退回重写。

建议规则：

| 6段结果 | 处理              |
| ---- | --------------- |
| 6/6  | PASS            |
| 5/6  | 可发布             |
| 4/6  | 可 repair        |
| 3/6  | 人工判断，通常 rewrite |
| ≤2/6 | rewrite         |

---

# 八、export-fanqie：最终导出器，不是创作器

## 它的职责

`export-fanqie` 应该做最终发布封装：

```text
选择正确版本
校验 publish-ready 状态
清理格式
生成番茄 txt
生成 book-info.txt
生成发布目录
批量导出时遇阻断立即停止
```

它可以做的“清理”应该很轻：

```text
去除 BOM
统一换行
去除空白
清理明显非正文标记
格式化标题
检查字数
检查 final_status
检查是否使用 reviewed/fixed 版本
```

它不应该做：

```text
重写正文
润色正文
补剧情
修连续性
改变章节标题之外的大内容
自动跳过坏章节继续导出
```

## 它应该守的门限

| 检查                         | 门限                                    |
| -------------------------- | ------------------------------------- |
| publish-ready 状态           | 必须 READY / READY_WITH_WARNINGS / 手动放行 |
| final_status=DROP          | 必须停止                                  |
| final_status=MANUAL_REVIEW | 默认停止                                  |
| 字数 < 1000                  | 停止或强警告，番茄长篇应阻断                        |
| 非正文标记                      | 阻断或自动清理后重新检查                          |
| 缺章节标题                      | 阻断或用修复标题                              |
| 批量导出                       | 任意一章阻断，全批次停止                          |

它最重要的原则是：

> export-fanqie 不能悄悄把有问题的章节导出去。

批量导出尤其应该遵守：

```text
from 2 to 30
如果第 19 章 DROP
立即停止
不要继续导 20～30
```

否则会造成“发布污染”。

---

# 九、这些工具之间的推荐流程

## 正常流程

```text
write next
  ↓
continuity-auto
  ↓
publish-ready
  ↓
如果 NEEDS_POLISH
    fanqie-polish
    ↓
    publish-ready again
  ↓
如果 NEEDS_REPAIR
    repair-fanqie
    ↓
    publish-ready again
  ↓
export-fanqie
```

## 如果人工发现问题

```text
review reject
  ↓
阻断 write next / publish-ready / export
  ↓
重新 write next 或 rewrite
```

## 如果 continuity-auto 出问题

```text
continuity-auto = WARN
  → 可进入 publish-ready

continuity-auto = MANUAL_REVIEW
  → 人工判断

continuity-auto = BLOCKED
  → continuity fix / rewrite

continuity-auto = DROP
  → 直接重写
```

## 如果 publish-ready 出问题

```text
NEEDS_POLISH
  → fanqie-polish

NEEDS_REPAIR
  → repair-fanqie

BLOCKED_BY_CONTINUITY
  → continuity-auto / rewrite

DROP_REWRITE_REQUIRED
  → rewrite

MANUAL_REVIEW
  → 人工判断
```

---

# 十、inkos 2.0 后最重要的职责边界

我认为最关键的是这 7 条：

## 1. write next 只负责生成当前章，不负责兜底发布质量

它可以做基础自检，但不能替代 publish-ready。

## 2. continuity-auto 只负责故事状态，不负责番茄文风

不要让它去判断“爽不爽”“标题吸不吸引”。

## 3. fanqie-polish 只能轻润色，不得改剧情事实

否则会污染 ledger 和 current_state。

## 4. repair-fanqie 只能按明确问题修，不做泛优化

它应该接收具体 report，而不是自由发挥。

## 5. publish-ready 是总闸门，不是总修复器

它可以调度修复，但最终职责是判定。

## 6. export-fanqie 是发布封装器，不是最后的万能修文器

它可以做格式硬清理，但不能在导出时偷偷改故事。

## 7. review reject 的优先级最高

人工 reject 后，任何自动工具都不能绕过去。

---

# 十一、我建议的最终门限表

可以整理成一个工程规则：

| 层级   | 工具              | 通过条件                        | 失败后                          |
| ---- | --------------- | --------------------------- | ---------------------------- |
| 创作   | write next      | 有 chapter intent、状态正常、生成完整章 | 不写下一章                        |
| 人工   | review reject   | 无                           | 标记 rejected，阻断后续             |
| 连续性  | continuity-auto | PASS / WARN                 | MANUAL_REVIEW / BLOCK / DROP |
| 发布总审 | publish-ready   | READY / READY_WITH_WARNINGS | polish / repair / rewrite    |
| 润色   | fanqie-polish   | 不改剧情，提升读感                   | 超边界则退回 rewrite               |
| 修复   | repair-fanqie   | 修具体番茄问题                     | 修不了则 rewrite                 |
| 导出   | export-fanqie   | publish-ready 通过，状态干净       | 停止导出                         |

---

# 十二、我的最终判断

inkos 2.0 后，这些工具的定位应该是：

```text
write next：
  章节生产器

review reject：
  人工否决器

continuity-auto：
  故事状态一致性闸门

publish-ready：
  发布资格总闸门

fanqie-polish：
  番茄读感轻润色器

repair-fanqie：
  番茄发布问题定向修复器

export-fanqie：
  最终发布封装与硬校验器
```

最重要的一句话是：

> **不要让修复工具承担创作职责，不要让导出工具承担审稿职责，不要让连续性工具承担文风职责，不要让 write next 绕过状态闸门继续写。**

如果这条边界守住，inkos 2.0 就会变成一个稳定的“小说生产系统”。
如果守不住，它就会退化成一堆互相补锅的脚本。
