## 长篇连载推荐流水线

针对《葬渊魔经》这种番茄长篇，推荐这样跑：

```
architect
  ↓
planner
  ↓
composer
  ↓
writer
  ↓
state-validator
  ↓
auditor
  ↓
reviser
  ↓
fanqie-quality
  ↓
fanqie-polish
  ↓
continuity-auto
  ↓
publish-ready
  ↓
export-fanqie
```

对应模型分工：

| 阶段            | 主要目标                       | 模型类型         |
| --------------- | ------------------------------ | ---------------- |
| architect       | 世界观、人设、金手指、长线矛盾 | 强逻辑模型       |
| planner         | 章节目标、伏笔、爽点、章末钩子 | 强推理模型       |
| composer        | 上下文组装、信息压缩           | 长上下文稳定模型 |
| writer          | 正文生成                       | 网文味模型       |
| state-validator | 状态一致性                     | 低温结构化模型   |
| auditor         | 审稿评分                       | 严格质检模型     |
| reviser         | 自动修复                       | 平衡改稿模型     |
| title-generator | 标题/钩子                      | 营销模型         |
| publish-ready   | 最终放行                       | 严格质检模型     |

------

## 短故事推荐流水线

短故事和长篇不一样。
 短故事更重：

```
开局钩子
情绪密度
反转
完读率
标题点击率
发布版本包装
```

所以推荐短故事模型分工：

```
theme/world-builder：强逻辑模型
story-planner：强结构模型
writer：情绪强、短故事节奏好的模型
hook-polisher：爆点模型
title-generator：营销模型
auditor：完读率/反转/重复度检查模型
```

短故事流程：

```
short-story plan
  ↓
world-builder
  ↓
character-lock
  ↓
story-difference-score
  ↓
short-story write
  ↓
hook polish
  ↓
title generate
  ↓
script generate
  ↓
rank / collect
```