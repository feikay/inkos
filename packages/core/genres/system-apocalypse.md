---
name: System Apocalypse
id: system-apocalypse
language: en
chapterTypes:
  - Survival
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
numericalSystem: true
powerScaling: true
eraResearch: false
pacingRule: >-
  Early (ch 1-15): survival pressure every chapter. Mid (ch 15-50): power-up +
  faction politics every 3-5 chapters. Late: expansion and existential threats.
satisfactionTypes:
  - Survival Against Odds
  - Level Up
  - Territory Claimed
  - Faction Victory
  - System Secret Revealed
  - Societal Rebuild Milestone
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
  - 11
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

- Day Zero that doesn't permanently change the world — no reverting to normal
- Early chapters without genuine survival danger — readers demand real stakes from page one
- System arrival with no in-world explanation (even a vague one)
- Ignoring real-world geography and consequences when set on Earth
- Factions that are binary good/evil — competing interests, not cartoon villainy
- MC becoming unstoppable too fast — power fantasy must be earned through survival
- Tech usage without addressing fuel, ammo, and infrastructure collapse

## World Rules

- Day Zero must establish in chapters 1-3: how a normal person reacts, first death or near-death, and that old rules are gone
- Infrastructure failure is real: food, water, electricity, medicine stop working
- Resource scarcity drives conflict: water, ammunition, medical supplies, safe shelter
- Factions form quickly: government remnants, criminal networks, cults, survival communities, warlords
- Real-world grounding: name real locations, acknowledge real infrastructure, maintain daylight cycles and weather
- System mechanics integrate logically — show why old-world tech fails or doesn't in a magical world

## Pacing Guidance

- Early (ch 1-15): Survival, confusion, learning system. MC is weak, struggles with low-tier threats. Shorter chapters (2-3k words)
- Mid (ch 15-50): Growing stronger, claiming territory, faction politics. Power fantasy increases; survival becomes strategic
- Late: Expansion, faction wars, world-scale threats. MC powerful but not unstoppable; challenges are existential/political
- Introduce new threat types as MC grows — defeating zombies leads to intelligent predators, rival factions, interdimensional invasions
- Balance survival pressure with power progression — desperation early, strategy mid, leadership late

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, location names, faction names, system terms, and threat types into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from Day Zero event / system arrival / first death or near-death / first status screen. Guide: use the book's specific apocalypse trigger and the MC's unique first encounter with the changed world.
- **protagonist_goal**: Extract from the MC's survival strategy (fortify / wander / find cure / rebuild civilization / seize system power). Guide: goal must reference the book's specific safe-zone locations or faction objectives.
- **pressure_source**: Extract from specific monster types / resource depletion rate / rival faction aggression / system-imposed challenges. Guide: use the book's specific threat names, faction names, and scarcity descriptions.
- **obstacle_dilemma**: Extract from "save strangers or protect own group" / "trust or purge" / "hold ground or migrate". Guide: use the book's specific moral-decision scenes.
- **solution_possibility**: Extract from new resource caches / faction alliances / defensive fortifications / system exploits discovered. Guide: use the book's specific resource locations and alliance names.
- **active_attempt**: Extract from the MC's supply runs / territory defense / faction negotiations / system challenges. Guide: use the book's specific mission locations and operation names.
- **payoff_reward**: Extract from territory claimed / boss monster killed / faction victory / system milestone. Guide: use the book's specific territory names, boss names, and achievement milestones.
- **ending_pull**: Extract from "Can civilization be rebuilt? What caused the apocalypse? Can it be reversed?" Guide: use the book's specific ultimate mystery or endgame goal.
- **antagonist_pressure**: Extract from the book's specific faction leaders / warlords / intelligent monster types / rival system users. Guide: must use the book's actual faction names and antagonist identifiers.
- **resource_reward**: Extract from the book's specific scarce resources (water sources / ammunition caches / medicine stockpiles / safe shelters / system credits). Guide: use the book's resource names and specific acquisition locations.
- **world_rule**: Extract from the book's unique apocalypse mechanics (infection vectors / system limitations / power progression rules / safe-zone conditions). Guide: use the book's specific world-rule descriptions and constraints.
- **forbidden_false_positive**: Do not use generic terms like "survival", "danger", "resources", or "safe zone" as signals. Every signal must contain the book's specific location names, threat names, faction names, or resource types.
