---
name: Science Fiction
id: sci-fi
language: en
chapterTypes:
  - Exploration
  - Combat
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
eraResearch: true
pacingRule: >-
  Worldbuilding emerges through action, not exposition. Tech reveals tied to
  plot-critical moments. Political/exploration arcs alternate with action every
  2-4 chapters.
satisfactionTypes:
  - Discovery
  - Tech Breakthrough
  - Political Victory
  - First Contact
  - Mystery Solved
  - Survival Against Odds
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

- Tech rules changing to serve plot convenience — once physics/tech is established, it must stay consistent
- Technology solving everything — every tech must have limitations; introduce problems tech cannot fix (corruption, emotion, human greed)
- Info-dumping science/tech explanations outside of plot-critical moments
- Ignoring logical consequences of technology — FTL, AI, biotech all have societal implications
- Hand-waving hard-science concepts in hard sci-fi without clear intent to treat science as soft
- Characters behaving as if from present day when story is set centuries ahead — cultural/linguistic adaptation matters

## Tech Consistency Rules

- Every technology must have defined limitations and side effects
- New technologies create new problems — they don't just solve old ones
- If the story uses FTL, hyperdrives, or teleportation, establish rules and stick to them
- Hard sci-fi: explain the science, make it plausible, build consequences. Readers will check
- Space opera: science can be soft, but internal rules must be consistent across the narrative
- Show technology through character interaction, not textbook entries
- Era research required: reference real science correctly, extrapolate plausibly

## Pacing Guidance

- Hard sci-fi: logical problem-solving drives pacing — each chapter should advance understanding or create new constraints
- Space opera: epic scale requires political/interpersonal arcs between action sequences
- Exploration chapters establish wonder and worldbuilding through character experience
- Political complexity: factions with competing interests, diplomacy alongside combat
- Tech reveals at plot-critical moments only — never dump specs for their own sake
- Action scenes grounded in established physics/tech rules — no surprise capabilities
- Settings spanning star systems need clear spatial orientation for readers

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, planet/station names, tech names, faction names, and discovery events into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the inciting discovery / first contact / tech breakthrough / political crisis that sets the story in motion. Guide: use the book's specific event, location, and the characters involved.
- **protagonist_goal**: Extract from the MC's objective (solve the mystery / prevent war / complete the mission / survive / make contact). Guide: goal must reference the book's specific stellar locations, factions, or tech objectives.
- **pressure_source**: Extract from failing technology / political adversaries / alien threats / environmental hazards / time constraints. Guide: use the book's specific tech-failure modes, faction names, or hazard types.
- **obstacle_dilemma**: Extract from "follow protocol or improvise" / "save the few or the many" / "reveal the truth or maintain stability". Guide: use the book's specific decision-point scenes.
- **solution_possibility**: Extract from tech breakthroughs / alien cooperation / political negotiation / scientific discoveries. Guide: use the book's specific tech names, alien species, or discovered principles.
- **active_attempt**: Extract from the MC's missions / experiments / negotiations / explorations / repairs. Guide: use the book's specific ship names, planet names, and operation names.
- **payoff_reward**: Extract from discovery made / tech breakthrough achieved / political victory / first contact successful / survival against odds. Guide: use the book's specific discovery names and milestone descriptions.
- **ending_pull**: Extract from "What is the nature of the unknown? Can humanity survive? What does first contact truly mean?" Guide: use the book's specific ultimate question or existential stake.
- **antagonist_pressure**: Extract from the book's specific opposing factions / rival polities / alien species / corporate interests / the tech itself. Guide: must use the book's actual faction names, species names, or antagonist identifiers.
- **resource_reward**: Extract from the book's specific resources (tech components / data / fuel / diplomatic leverage / territory). Guide: use the book's resource names and acquisition contexts.
- **world_rule**: Extract from the book's unique tech/physics constraints (FTL limits / AI boundaries / biotech ethics / communication lag / energy sources). Guide: use the book's specific tech-rule descriptions and limitations.
- **forbidden_false_positive**: Do not use generic terms like "discovery", "technology", "space", or "first contact" as signals. Every signal must contain the book's specific tech names, planet/station names, faction names, or discovery descriptions.
