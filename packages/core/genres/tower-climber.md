---
name: Tower Climbing
id: tower-climber
language: en
chapterTypes:
  - Floor Challenge
  - Progression
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
powerScaling: true
eraResearch: false
pacingRule: >-
  Each floor arc spans 3-8 chapters: introduction, exploration, confrontation,
  advancement. Difficulty must escalate visibly between floors.
satisfactionTypes:
  - Floor Cleared
  - Boss Defeated
  - New Ability Gained
  - Floor Secret Discovered
  - Rival Surpassed
  - Summit Progress
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

- Floors that are cosmetic reskins of each other — each floor must present materially different challenges
- Floor difficulty that doesn't escalate predictably — readers must understand power requirements
- No clear summit goal — readers need to know what success at the top looks like
- Horizontal progression (going sideways) instead of vertical climbing
- Skipping floors without earned justification
- Boss fights that are won through deus ex machina instead of preparation and growth

## Floor Design Rules

- Each floor must introduce a distinct biome, challenge type, or rule set
- Floor transitions are natural progression checkpoints — use them for stat gains, ability unlocks, or narrative reveals
- Environmental detail matters: readers experience each floor as a new world
- Floor bosses or trials must test something the climber learned on that floor
- Difficulty tiers should be transparent to readers — they should anticipate what the next floor demands
- Allow brief rest/preparation between floors for character moments and strategic planning

## Pacing Guidance

- Floor introduction: establish new environment, threats, and rules (1-2 chapters)
- Exploration and problem-solving: MC adapts to floor's unique challenges (1-3 chapters)
- Confrontation: floor boss, puzzle, or trial that tests everything learned (1-2 chapters)
- Advancement: reward, brief respite, foreshadowing of next floor (0.5-1 chapter)
- Early floors move fast (2-3 chapters each) to hook readers with progression
- Later floors slow down (5-8 chapters) as complexity and stakes increase
- The summit should feel like a destination worth the climb — seed hints about what awaits throughout

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, tower name, floor names, boss names, ability names, and rival climber names into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the MC's first floor entry / tower selection / initial trial / first floor-clear moment. Guide: use the book's specific tower entrance scene and the MC's reason for climbing.
- **protagonist_goal**: Extract from the MC's climbing goal (reach the summit / find someone inside / break the tower / claim its power). Guide: goal must reference the book's specific floor targets and summit legend.
- **pressure_source**: Extract from escalating floor difficulty / rival climber competition / time limits / floor failure penalties. Guide: use the book's specific floor mechanics and rival names.
- **obstacle_dilemma**: Extract from "climb alone or form a party" / "help a fallen ally or push forward" / "take a floor shortcut or play safe". Guide: use the book's specific floor-based decision points.
- **solution_possibility**: Extract from floor rule discoveries / ability combinations / hidden paths / environmental exploitation. Guide: use the book's specific floor gimmicks and discovered strategies.
- **active_attempt**: Extract from the MC's specific floor challenges / boss fights / rule puzzles / party coordination. Guide: use the book's specific floor names, boss names, and tactic descriptions.
- **payoff_reward**: Extract from floor cleared / boss defeated / new ability gained / floor secret discovered / rival surpassed. Guide: use the book's specific ability names and floor-clear milestones.
- **ending_pull**: Extract from "What awaits at the summit? Who built the tower? What happens when someone reaches the top?" Guide: use the book's specific summit mystery.
- **antagonist_pressure**: Extract from the book's specific rival climbers / floor guardians / tower administrators / the tower itself. Guide: must use the book's actual rival names, floor positions, and guardian types.
- **resource_reward**: Extract from the book's specific floor rewards (ability fragments / equipment / information / floor passes). Guide: use the book's reward item names and floor-specific acquisitions.
- **world_rule**: Extract from the book's unique tower mechanics (floor rules / ability rank system / party mechanics / death/respawn conditions). Guide: use the book's specific floor-rule descriptions and mechanical constraints.
- **forbidden_false_positive**: Do not use generic terms like "climb", "clear floor", "boss fight", or "summit" as signals. Every signal must contain the book's specific tower/floor names, ability names, or character identifiers.
