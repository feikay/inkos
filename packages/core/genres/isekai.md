---
name: Isekai / Portal Fantasy
id: isekai
language: en
chapterTypes:
  - Exploration
  - Adaptation
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
numericalSystem: false
powerScaling: true
eraResearch: false
pacingRule: >-
  Establish new world rules by chapter 3. Cultural adaptation and
  fish-out-of-water moments every 2-3 chapters early. Skip tutorial-town
  syndrome — no 50 pages hitting rats.
satisfactionTypes:
  - World Rule Discovered
  - Cultural Clash Resolved
  - Real-World Skill Applied
  - New Ability Gained
  - Relationship Formed
  - Identity Established in New World
auditDimensions:
  - 1
  - 2
  - 3
  - 4
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

- "Tutorial town" syndrome — 50+ pages of killing rats or low-stakes grinding before the real story starts
- New world that feels identical to Earth with a fantasy skin
- MC treating new world's culture as quaint or inferior without narrative consequence
- No real consequences for cultural misunderstandings — fish-out-of-water must have stakes
- Pacing too slow in the "culture learning" phase — drip-feed rules through action, not lectures
- MC's origin world becoming irrelevant after chapter 3 — the contrast is the genre's engine
- Isekai truck or summoning ritual with zero personality — make the transportation event matter

## World Transition Rules

- Transportation event (summoning, reincarnation, portal) must be distinct and memorable
- Brief real-world grounding: who was MC before? What skills, knowledge, relationships do they carry?
- Arrival scene: disorientation is real — sensory overload, language barriers, physical discomfort
- First guide/NPC explains world basics through interaction, not monologue
- By chapter 3, readers must understand the new world's basic operating system
- MC's real-world knowledge creates both advantages and dangerous blind spots
- New world must feel real: consistent geography, politics, cultures, economics — not a game lobby

## Pacing Guidance

- Opening: transportation event -> brief real-world grounding -> arrival and disorientation -> first guide -> first concrete goal
- Early chapters: cultural fish-out-of-water drives comedy and drama (every 2-3 chapters)
- MC bringing real-world skills that apply in surprising ways is a core satisfaction — seed these early
- Learning the new world's magic/power system should feel like genuine discovery, not tutorial text
- Relationship building with new world characters grounds the MC emotionally
- Clash between home culture and new world values creates natural conflict without needing a villain
- Mid-to-late story: MC's identity shifts from "outsider" to "participant" — track this arc explicitly

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, world location names, race names, skill names, and cultural concepts into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the transportation event (summoning / reincarnation / portal / accident) and the MC's arrival disorientation. Guide: use the book's specific transportation method and the MC's pre-isekai identity anchor.
- **protagonist_goal**: Extract from the MC's goal in the new world (return home / conquer / change fate / protect someone / understand why they were brought). Guide: goal must reference the book's specific factions or characters in the new world.
- **pressure_source**: Extract from cultural misunderstandings / language barriers / real-world knowledge backfiring / new-world threats / discrimination against outsiders. Guide: use the book's specific culture-clash events and threat types.
- **obstacle_dilemma**: Extract from "adapt or reshape" / "integrate or stay independent" / "return or stay". Guide: use the book's specific cultural-dilemma scenes tied to named characters or factions.
- **solution_possibility**: Extract from real-world knowledge applied creatively / new-world rule discoveries / alliance formation / hidden heritage revealed. Guide: use the book's specific cross-world skills and discovered mechanics.
- **active_attempt**: Extract from the MC's rule exploration / cultural adaptation attempts / faction building / adventure actions. Guide: use the book's specific exploration locations and action objectives.
- **payoff_reward**: Extract from new ability gained / relationship formed / identity established / world rule mastered. Guide: use the book's specific ability names, relationship names, and identity titles.
- **ending_pull**: Extract from "Can the MC return home? What connects the two worlds? What was the true reason for the transportation?" Guide: use the book's specific isekai mystery.
- **antagonist_pressure**: Extract from the book's specific antagonists (royal court / church / demon lord / other transported individuals / the summoner). Guide: must use the book's actual antagonist names and faction affiliations.
- **resource_reward**: Extract from the book's specific new-world resources (mana / skill points / rare materials / unique knowledge). Guide: use the book's resource names and acquisition methods.
- **world_rule**: Extract from the book's unique world mechanics (magic system / racial hierarchies / class system / language barriers). Guide: use the book's specific world-rule descriptions and constraints.
- **forbidden_false_positive**: Do not use generic terms like "isekai", "culture clash", "adaptation", or "new world" as signals. Every signal must contain the book's specific location names, race names, skill names, or event references.
