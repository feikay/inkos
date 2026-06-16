---
name: Cozy Fantasy
id: cozy
language: en
chapterTypes:
  - Slice-of-Life
  - Community
  - Setup
  - Transition
  - Payoff
fatigueWords:
  - delve
  - tapestry
  - testament
  - intricate
  - pivotal
  - vibrant
  - comprehensive
  - nuanced
  - embark
  - foster
  - underscore
  - bolstered
  - crucial
numericalSystem: false
powerScaling: false
eraResearch: false
pacingRule: >-
  Slow, meditative pacing. Each chapter advances an emotional arc or community
  bond. Seasonal/cyclical structure works well.
satisfactionTypes:
  - Relationship Deepened
  - Community Problem Solved
  - Emotional Breakthrough
  - Craft Mastered
  - Found Family Moment
  - Small Wonder Discovered
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
  - 存折
  - 集资款
  - 店铺钥匙
  - 合同
  - 营业执照
  - 账本
  - 批条
  - 启动资金
  - 本钱
  - 车票
  - 线索
  - 证据
  - 文件
  - 装备
  - 道具
styleGovernance:
  allowedStyleExamples:
    - 元
    - 分
    - 个
    - 月
    - 年
    - 折
  forbiddenProseKeywords:
    - 气血
    - 境界
    - 面板
    - 金手指
    - 升级
structuralSignals:
  defaultPayoffActions:
    - 拿到
    - 保住
    - 夺回
    - 签署
    - 避开
    - 买下
    - 拦下
    - 激活
  lowStatusKeywords:
    - 下岗
    - 贫困
    - 负债
    - 被裁员
    - 新手
---
## Genre Prohibitions

- Genre bait-and-switch — if you promise cozy, never introduce world-ending threats or graphic violence
- Conflict resolution without work — problems must not solve themselves
- Manic pixie dream characters who exist only to change the protagonist
- Nostalgic falseness — romanticizing a "simpler time" without substance
- Cruel humor — humor must be gentle, never at someone's expense
- Existential stakes masquerading as low-stakes — keep threats emotional, not apocalyptic
- Purple prose describing food/nature without advancing character or community arc

## Emotional Arc Rules

- Stakes are high emotionally but not existentially — characters care, the world doesn't end
- Conflict types: personal growth, community problems, relationship tension, small dangers, moral dilemmas
- Community is a character — setting and relationships are as important as the individual protagonist
- Hope must always be present — even sad moments don't end in despair
- Found family bonds drive the emotional core
- Character arcs follow: isolation/grief -> small interactions -> gradual opening -> emotional breakthrough -> integration
- Comforting sensory details matter: tea, baked goods, warm spaces, seasonal textures

## Pacing Guidance

- Chapter length: 2-3k words with space for reflection
- Chapter structure: quiet opening -> small event or interaction -> internal response/growth -> gentle transition -> soft ending (not cliffhanger)
- No cliffhangers — chapters end with peace, hope, or gentle anticipation
- Seasonal/cyclical structure works well (calendar-based chapter rhythm)
- Downtime scenes must still plant hooks, advance relationships, or build contrast
- Slice-of-life texture woven with an emotional throughline — pure plotless chapters risk feeling static
- Every quiet scene must shift something: a realization, a decision, an intimacy, a small loss

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, location names, relationship stages, and specific emotional events into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the MC's starting emotional state (grief / isolation / new beginning / small wonder) and the inciting gentle event. Guide: use the book's specific emotional entry point and the character or place that begins the change.
- **protagonist_goal**: Extract from the MC's emotional goal (find belonging / heal / master a craft / build community / find peace). Guide: goal must reference the book's specific community, craft, or relationship target.
- **pressure_source**: Extract from internal obstacles (grief / fear of connection / self-doubt) and external gentle pressures (community problem / small danger / relationship tension). Guide: use the book's specific obstacle sources tied to named characters or places.
- **obstacle_dilemma**: Extract from "open up or stay guarded" / "intervene or respect boundaries" / "keep the peace or speak the truth". Guide: use the book's specific emotional-dilemma scenes.
- **solution_possibility**: Extract from small acts of courage / community support / craft progress / emotional breakthroughs. Guide: use the book's specific breakthrough moments and who/what enables them.
- **active_attempt**: Extract from the MC's specific actions (reaching out / trying something new / helping someone / accepting help). Guide: use the book's specific relationship-building acts and craft milestones.
- **payoff_reward**: Extract from relationship deepened / community problem solved / emotional breakthrough / craft mastered / found-family moment. Guide: use the book's specific milestone descriptions.
- **ending_pull**: Extract from "Will the MC find their place? Can the community thrive? Will the wound finally heal?" Guide: use the book's specific emotional-resolution question.
- **antagonist_pressure**: Extract from the book's specific sources of tension (a skeptical neighbor / a threatening outside force / the MC's own past). Guide: must use the book's actual character names or specific tension sources — threats are emotional, never apocalyptic.
- **resource_reward**: Extract from the book's specific emotional resources (trust built / friendship deepened / skill learned / wisdom gained / home made). Guide: use the book's relationship names and specific growth descriptions.
- **world_rule**: Extract from the book's unique setting constraints (small-town dynamics / seasonal rhythms / craft traditions / community norms). Guide: use the book's specific setting rules and seasonal/cyclical markers.
- **forbidden_false_positive**: Do not use generic terms like "healing", "community", "belonging", or "friendship" as signals. Every signal must contain the book's specific character names, place names, craft names, or relationship descriptors.
