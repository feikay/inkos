# 把六份笔记合并成一个“网文生产操作系统”

现在你手上其实已经有六个核心方法论：

```
1. 世界观运转：稀缺、链式反应、文明共识
2. 六招心法：情绪事件、欲望目标、阻碍、解法、高潮、反馈
3. 高智商反派：谋局者、殉道者、伪态者
4. 开头钩子：悬念、反差、矛盾前置、世界观炸弹、极致情绪
5. 万能转场：情绪延续、勾子引导、环境暗示、以动带进
6. 当前 inkos 骨架：story_bible、volume_outline、book_rules、current_state、pending_hooks
```

当前 inkos 已经在 create 阶段一次 LLM 生成五个 SECTION，并通过 FoundationReviewerAgent 做核心冲突、开篇节奏、世界一致性、角色区分度、节奏可行性五项审核。

但现在的问题是：**审核的是“有没有”，不是“能不能持续产出好看的网文”。**

所以我建议把系统升级成下面这个结构。

# 一、升级后的完整链路

## 阶段一：题材立项，不只是选 genre，而是生成“题材架构”

新增文件：

```text
story/genre_architecture.md
```

内容包括：

```md
# 题材架构

## 1. 题材定位
- 主分类：
- 子题材：
- 番茄读者预期：
- 核心爽点：
- 核心情绪：
- 禁忌写法：

## 2. 读者承诺
这本书承诺给读者什么？
- 爽点承诺：
- 情绪承诺：
- 反转承诺：
- 成长承诺：

## 3. 开局打法
五类开头钩子中，本书主用哪一种？
- 悬念留白
- 极度反差
- 矛盾前置
- 世界观炸弹
- 极致情绪

## 4. 章节节奏模板
本题材适合：
- 每章强冲突？
- 每2章一小爽？
- 每5章一反转？
- 每10章一阶段收益？

## 5. 发布卖点
- 书名方向：
- 简介方向：
- 标签方向：
- 封面关键词：
```

这样后续不管写玄幻、都市、系统、悬疑、复仇，都可以先生成一个“题材玩法说明书”。

------

## 阶段二：create 建书阶段，生成“故事发动机”

这一阶段不要只生成 `story_bible`，而是补充四个硬文件：

```text
world_engine.md
antagonist_map.md
motivation_matrix.md
first_10_chapter_plan.md
```

其中：

```text
world_engine.md
解决：世界为什么会不断制造冲突

antagonist_map.md
解决：反派为什么持续压迫主角

motivation_matrix.md
解决：主角、反派、配角为什么必须行动

first_10_chapter_plan.md
解决：前10章怎么钩人、怎么留存、怎么建立主线
```

`antagonist_map.md` 里要强制使用三种反派模板。比如：

```md
# 反派结构

## 核心反派
- 类型：谋局者 / 殉道者 / 伪态者 / 混合型
- 表层身份：
- 真实身份：
- 公开目标：
- 隐藏目标：
- 维护的秩序：
- 不能容忍主角的原因：
- 计划A：
- 计划B：
- 计划C：
- 主角第一次以为自己赢了，但实际上推动了什么？

## 阶段反派
| 卷 | 阶段反派 | 类型 | 背后秩序 | 与核心反派关系 | 失败后的后果 |
```

这个设计可以避免“每卷换一个无关反派”。

------

## 阶段三：write next 续写阶段，先生成 Chapter Intent

每次写下一章之前，不应该直接写正文，应该先生成一个“章节意图卡”。

```md
# Chapter Intent

## 1. 本章承接
上一章最后的钩子是什么？
本章必须回应什么？

## 2. 本章情绪事件
本章用什么具体画面调动读者情绪？

## 3. 本章欲望目标
主角这一章明确想要什么？

## 4. 本章阻碍困境
阻碍来自哪里？
- 反派计划
- 世界规则
- 资源稀缺
- 配角动机
- 主角弱点

## 5. 本章解决方法
主角凭什么还有戏？
不能靠反派降智。

## 6. 本章反派压力
本章反派是否使用了：
- 信息差
- 价值观压迫
- 伪装欺骗
- 制度压迫
- 资源封锁

## 7. 本章转场策略
本章场景切换使用：
- 情绪延续
- 勾子引导
- 环境暗示
- 以动带进

## 8. 本章结尾反馈
主角获得了什么？
失去了什么？
下一章钩子是什么？
```

六招心法里明确把故事推进拆成情绪事件、欲望目标、阻碍困境、解决方法、行动解决、结局反馈六步。 这个刚好可以变成 `write next` 的中间产物。

------

## 阶段四：review 审核阶段，从“错别字/连续性”升级成“网文有效性审核”

当前你的审核已经有 continuity、publish-ready、numeric scan、fanqie-polish 等，但还可以再加一层：

```text
story_effectiveness_review
```

建议审核维度：

```text
1. Hook：本章开头是否有吸引力？
2. Goal：主角目标是否明确？
3. Pressure：阻碍是否足够强？
4. Method：主角破局是否合理？
5. Antagonist：反派是否高智商，是否降智？
6. Transition：转场是否自然？
7. Payoff：本章是否有反馈？
8. Pull：结尾是否拉下一章？
```

其中 `Antagonist` 很重要。反派笔记里明确强调，不要为了衬托主角而强行弱化反派，正确做法应该是让主角在被压制时靠微小变数或惨重代价取胜。

所以审核时可以直接检测：

```text
反派是否突然犯低级错误？
反派是否明明能杀却不杀？
反派是否把关键信息主动说给主角？
主角胜利是否有代价？
主角是否利用了前文伏笔，而不是临时开挂？
```

------

## 阶段五：publish-ready 阶段，重点检查“发布转化”

发布前不只是检查能不能发，还要检查“有没有点击和追读潜力”。

建议 `publish-ready` 最终报告增加：

```json
{
  "hook_score": 86,
  "opening_strength": "强",
  "antagonist_pressure": 82,
  "transition_quality": 78,
  "payoff_score": 85,
  "next_chapter_pull": 90,
  "fanqie_publish_risk": ["开头慢", "转场硬", "反派压力不足"],
  "recommended_action": "POLISH_BEFORE_EXPORT"
}
```

尤其是第一章/前三章，要单独加一个：

```text
golden_3_chapter_review
```

检查：

```text
第1章：是否足够钩人？
第2章：是否展示核心金手指/核心差异？
第3章：是否明确长期目标？
前三章是否形成一个完整追读闭环？
```

开头笔记里提到，五类开头分别钩住好奇心、认知冲突、紧迫感、猎奇心、共情愤怒。 这正好可以用于前三章审稿。

------

# 二、我建议你下一步让 Codex 做的不是“大重构”，而是分四个任务

## 任务一：新增创作方法论知识库

先不要立刻改写作逻辑。先把这些方法论沉淀成机器可读文件。

建议目录：

```text
packages/core/src/story-methods/
  world-engine.ts
  six-step-plot.ts
  antagonist-templates.ts
  opening-hooks.ts
  transition-methods.ts
```

或者配置化：

```text
packages/core/src/story-methods/data/
  world-engine.yaml
  six-step-plot.yaml
  antagonist-templates.yaml
  opening-hooks.yaml
  transition-methods.yaml
```

这样以后不管长篇还是短故事，都能复用。

------

## 任务二：增强 create 阶段

让 `ArchitectAgent.generateFoundation()` 输出更多 SECTION：

```text
=== SECTION: genre_architecture ===
=== SECTION: world_engine ===
=== SECTION: antagonist_map ===
=== SECTION: motivation_matrix ===
=== SECTION: first_10_chapter_plan ===
```

这一步主要解决：

```text
题材架构弱
世界背景弱
核心反派弱
人物动机弱
前10章牵引弱
```

------

## 任务三：增强 write next 阶段

在正文生成前增加：

```text
generateChapterIntent()
```

流程变成：

```text
读取骨架文件
读取上一章状态
生成 Chapter Intent
用 Chapter Intent 写正文
写完后更新 current_state / pending_hooks / character_matrix
```

这一步主要解决：

```text
章节之间关系弱
续写漂移
主角目标断
反派压力断
转场硬
```

------

## 任务四：增强审核与发布

新增三个 reviewer：

```text
opening-hook-reviewer
antagonist-intelligence-reviewer
transition-quality-reviewer
```

并把它们接入：

```text
publish-ready
fanqie-polish
export-fanqie 前置检查
```

这一步主要解决：

```text
开头不吸引人
反派降智
章节转场像流水账
发布前才发现问题
```

------

# 三、最终建议的系统架构

可以理解成这样：

```text
【题材架构层】
genre_architecture.md
决定这本书卖什么、爽什么、钩什么读者。

【世界发动机层】
world_engine.md
决定冲突为什么源源不断地产生。

【人物发动机层】
motivation_matrix.md + antagonist_map.md
决定主角、反派、配角为什么必须行动。

【连载规划层】
volume_outline.md + first_10_chapter_plan.md
决定前期留存和中期升级路线。

【章节生成层】
chapter_intent → chapter_draft
决定每章是否有情绪、目标、阻碍、解法、高潮、反馈。

【审稿层】
continuity + hook + antagonist + transition + fanqie-style
决定章节是否真的适合发布。

【发布层】
book-info + title + blurb + export-fanqie
决定最终呈现是否适合番茄。
```

------

# 四、这次改造的核心目标

不是让 AI “知道更多写作技巧”，而是让这些技巧变成流程约束。

也就是说：

```text
开头五招 → 变成 first_chapter_hook_check
高智商反派 → 变成 antagonist_intelligence_check
万能转场 → 变成 transition_quality_check
六招心法 → 变成 chapter_intent_schema
世界观三逻辑 → 变成 world_engine_schema
```

# GO，启动

这次改造我们就正式命名为：

```text
inkos 2.0：故事性的大升级
```

核心方向我会按这个框架持续跟进：

```text
题材架构层
→ genre_architecture.md

世界发动机层
→ world_engine.md

人物发动机层
→ antagonist_map.md
→ motivation_matrix.md

连载规划层
→ first_10_chapter_plan.md
→ volume_outline.md

章节生成层
→ chapter_intent
→ chapter_draft

审稿增强层
→ opening-hook-reviewer
→ antagonist-intelligence-reviewer
→ transition-quality-reviewer
→ six-step-plot-reviewer

发布优化层
→ publish-ready
→ fanqie-polish
→ export-fanqie
→ book-info 发布信息优化
```



# 任务列表

1. ~~inkos 2.0 任务一——沉淀 story-methods 方法论知识库~~
2. ~~inkos 2.0 任务二——增强 create 阶段故事骨架~~
3. ~~inkos 2.0 任务三——增强 FoundationReviewerAgent 审核故事发动机质量~~
4. ~~inkos 2.0 任务二点五——create 阶段反哺旧控制文档~~
5. ~~inkos 2.0 任务二点六——优化 create 反哺文档的结构化~~
6. ~~inkos 2.0 任务三点五——create 阶段题材安全与发布风险~~
7. ~~inkos 2.0 任务三点五点一——补强 identity_insult 检测与真实国家规则一致性~~
8. ~~inkos 2.0 任务四——chapter_intent 续写前意图卡~~
9. ~~inkos 2.0 任务四点一——强化 chapter_intent 优先级，避免旧 payoff 机制覆盖意图卡~~
10. ~~inkos 2.0 任务四点二——清理旧 planner payoffDirective，防止覆盖 chapter_intent~~
11. ~~inkos 2.0 任务五 V1——chapter_intent 与正文一致性审核报告~~
12. ~~inkos 2.0 任务五点一——强化资源账本/数值一致性修复~~
13. ~~inkos 2.0 任务五点二——程序化 Resource Engine，接管系统流数值计算~~
14. ~~inkos 2.0 任务五点三——Resource Engine 失败时阻断后续污染~~
15. ~~inkos 2.0 任务五点四——Resource Engine blocking 后的自动重写策略~~
16. ~~inkos 2.0 任务五点四点一——增强 Resource Engine 余额跳转识别与技能名抽取~~
17. ~~inkos 2.0 任务五点四点二——Resource Recovery 失败后降级方案 A，避免 LLM 反复发明透支~~
18. ~~inkos 2.0 任务五点四点三——修复 balance_jump 资源归属，防止把联邦币余额误判为民望值~~
19. ~~inkos 2.0 任务五点四点四——统一资源规则来源，方案 A 禁止所有现金兑换，并修复技能账本~~
20. ~~inkos 2.0 任务五点四点五——方案 A fallback 使用程序模板 patch，硬删违规现金兑换段落~~
21. ~~inkos 2.0 任务五点四点六——Resource Engine WARN/失败语义统一，资源未闭合不得 ready-for-review~~
22. ~~inkos 2.0 任务五点四点七——template patch 后同步修正余额声明，并过滤伪技能名~~
23. ~~inkos 2.0 任务五点四点八——正文非正文内容清理器，Resource patch 后强制 clean-narrative~~
24. ~~inkos 2.0 任务五点四点九——defer_exchange 下扩展现金流语义检测，删除间接现金兑现表达~~
25. ~~inkos 2.0 任务五点五——Resource Plan 前置注入 chapter_intent / writer，避免先写错再后修~~
26. ~~inkos 2.0 任务五点七：Resource Plan 通用化与章节阶段识别~~
27. 任务五点七 B： No-Change Resource Closure 无资源变化章节的资源闭合机制

