---
name: LitRPG
id: litrpg
language: en
chapterTypes:
  - Progression
  - Setup
  - Transition
  - Payoff
  - Combat
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
numericalSystem: true
powerScaling: true
eraResearch: false
pacingRule: >-
  Every 1-3 chapters early: level-up or stat gain. Mid-story every 5-10
  chapters. Late story: tier transitions spaced far apart.
satisfactionTypes:
  - Level Up
  - Skill Unlock
  - Loot Drop
  - Boss Kill
  - Tier Breakthrough
  - System Secret Revealed
auditDimensions:
  - 1
  - 2
  - 3
  - 4
  - 5
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
  - 地图锁孔
  - 玉简
  - 地图
  - 残图
  - 锁孔
  - 机关
  - 阵纹
  - 禁纹
  - 法阵
  - 腰牌
  - 令牌
  - 钥匙
  - 卷轴
  - 古卷
  - 残卷
  - 残页
  - 石碑
  - 古碑
  - 碑纹
  - 入口
  - 门
  - 祭坛
styleGovernance:
  allowedStyleExamples:
    - 三息
    - 一炷香
    - 千年
    - 聚气九层
  forbiddenProseKeywords:
    - 性价比
    - 打折
    - 收益
    - 基础值
structuralSignals:
  defaultPayoffActions:
    - 触发
    - 打开
    - 拿到
    - 夺下
    - 获得
    - 压住
    - 突破
    - 开启
  lowStatusKeywords:
    - 扫地
    - 杂役
    - 废材
    - 废物
---
## Genre Prohibitions

- System rules changing arbitrarily after being established — readers track every number
- Unexplained power jumps — growth must follow established system logic
- "Blue Box Madness" — stat dumps every chapter or pages-long stat sheets
- Instant mastery — acquiring a skill and immediately excelling at it
- Overpowered MC from the start — removes all tension
- System message overload interrupting action scenes
- Female characters reduced to "perfect girlfriend" or "sickly daughter" tropes

## System Design Rules

- Once stats, skills, and system rules are established, they cannot be contradicted
- Stat blocks punctuate achievement moments, not routine actions
- Derivative stats (HP, Mana) must depend logically on primary stats
- Skill unlocks must feel earned — tied to risk, sacrifice, or problem-solving
- Same-type resource absorption must show diminishing returns, not flat gains
- System UI (blue boxes) appears after action/revelation, never mid-combat
- Give the system a consistent voice/personality — formal, archaic, playful, or clinical

## Pacing Guidance

- Chapter length sweet spot: 2.8k-3.5k words depending on stat density
- Chapter structure: Hook/recap -> Action/exploration -> System interaction/stat gain -> Cliffhanger
- Early chapters: frequent level-ups to hook readers (every 1-3 chapters)
- Mid-story: harder gains, every 5-10 chapters; narrative tension rises
- Late story: tier/rank transitions are rare and climactic
- Test pacing: Book 3 MC decisively defeats Book 1 version, but challenges never feel trivial
- Describe stats in narration first (audiobook-friendly), then include stat sheet for detail readers

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, skill names, system terms, specific locations, and quest names into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the system activation / first stat window / tutorial quest / first kill. Guide: use the book's specific trigger event and the unique way the MC experiences the system for the first time.
- **protagonist_goal**: Extract from the MC's ultimate goal within the system (rank #1 / escape the game / save someone inside / break the system). Guide: the goal must reference the book's specific leaderboard, realm, or quest objective.
- **pressure_source**: Extract from time-limited quests / PK threats / resource starvation / rival progression. Guide: use the book's specific quest names, rival character IDs, or countdown mechanics.
- **obstacle_dilemma**: Extract from mutually exclusive quest choices / build path forks / party vs. solo tradeoffs. Guide: use the book's specific fork-point decisions the MC faces.
- **solution_possibility**: Extract from hidden mechanics / cross-class combos / system loopholes the MC discovers. Guide: use the book's specific mechanical discoveries and strategy names.
- **active_attempt**: Extract from the MC's key dungeon runs / boss fights / skill experiments / PvP encounters. Guide: use the book's specific dungeon names, boss names, and skill combinations.
- **payoff_reward**: Extract from level-ups / loot drops / skill unlocks / tier breakthroughs / hidden achievements. Guide: use the book's specific level thresholds, item names, and achievement titles.
- **ending_pull**: Extract from "Who created the system? Why? What happens at level cap?" Guide: use the book's specific system mystery and endgame hook.
- **antagonist_pressure**: Extract from the book's specific rival players / PK guilds / system enforcers. Guide: must use the book's actual character IDs, guild names, or enforcer types.
- **resource_reward**: Extract from the book's specific currency / crafting materials / rare drops / stat points. Guide: use the book's economy-specific item names and acquisition events.
- **world_rule**: Extract from the book's unique system mechanics (diminishing returns formulas / cooldown rules / class restrictions / death penalties). Guide: use the book's specific numerical constraints and rule text.
- **forbidden_false_positive**: Do not use generic terms like "level up", "stat gain", "skill unlock", or "power spike" as signals. Every signal must contain the book's specific proper nouns and numerical conditions.
