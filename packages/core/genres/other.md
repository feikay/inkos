---
name: 通用
id: other
chapterTypes:
  - 推进章
  - 布局章
  - 过渡章
  - 回收章
fatigueWords:
  - 震惊
  - 不可思议
  - 难以置信
  - 深吸一口气
  - 仿佛
  - 不禁
  - 宛如
  - 竟然
numericalSystem: false
powerScaling: false
eraResearch: false
pacingRule: 每2-3章有一个明确的进展或反馈
satisfactionTypes:
  - 目标达成
  - 困难克服
  - 真相揭示
  - 关系转变
auditDimensions:
  - 1
  - 2
  - 3
  - 6
  - 7
  - 8
  - 9
  - 10
  - 13
  - 14
  - 15
  - 16
  - 17
  - 18
  - 19
  - 24
  - 25
  - 26
concretePayoffObjects:
  - 线索
  - 证据
  - 钥匙
  - 文件
  - 道具
  - 信物
  - 地图
  - 承诺
  - 入口
styleGovernance:
  allowedStyleExamples:
    - 个
    - 月
    - 年
    - 次
structuralSignals:
  defaultPayoffActions:
    - 拿到
    - 发现
    - 揭开
    - 打开
    - 找到
    - 确认
    - 获得
    - 解开
  lowStatusKeywords:
    - 困境
    - 弱势
    - 被动
    - 新手
---
## 题材禁忌

- 无逻辑的巧合推进剧情
- 配角降智配合主角
- 无铺垫的高潮

## 叙事指导

根据具体题材调整叙事重心。
保持因果逻辑链完整。
人物行为由动机驱动，不由剧情需要驱动。

## Structure Signal Generation Guidance

本指导用于 `create_book` 阶段 architect 生成本书专属 `story/structure_signals.json`。本题材为通用/未分类题材，没有特定的题材结构压力。**应结合本书具体的故事大纲、世界观设定、主角目标和独特概念**，为每个维度生成能在正文中精确匹配的专属短语。

- **opening_hook**：从本书开篇的独特事件、主角初始处境、或故事世界的首次呈现中提炼。必须包含本书具体的人物名/地点名/事件关键词。
- **protagonist_goal**：从本书主角的核心追求中提炼。目标是本书独有的，不是"变强""成功"等泛化词。
- **pressure_source**：从本书推动剧情的外部/内部压力中提炼。压力来源必须是本书具体的威胁/困境/时间限制。
- **obstacle_dilemma**：从本书主角面临的具体障碍和两难选择中提炼。每个障碍都应包含本书的专有名词。
- **solution_possibility**：从本书暗示的解决路径/转机/希望中提炼。用本书具体的机制、人物或发现来描述。
- **active_attempt**：从本书主角的关键行动中提炼。行动描述必须包含本书具体的地点/对象/手段。
- **payoff_reward**：从本书阶段性成果/胜利/收获中提炼。用本书具体的事件名称或获取物描述。
- **ending_pull**：从本书的终极谜题/最终目标/最大悬念中提炼。描述必须绑定本书的具体设定。
- **antagonist_pressure**：从本书具体对抗力量（人物/组织/环境/规则）中提炼。必须出现本书反派的名称或特征。
- **resource_reward**：从本书核心资源（物质/信息/人脉/能力）中提炼。用本书具体资源名和获取场景。
- **world_rule**：从本书世界的独特运行规则中提炼。描述必须包含本书设定的具体约束条件。
- **forbidden_false_positive**：禁止使用泛化词作为信号。所有信号必须包含本书专有名词（人物名/地名/物品名/事件名/设定术语）。
