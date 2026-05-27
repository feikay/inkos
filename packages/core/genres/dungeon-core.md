---
name: Dungeon Core
id: dungeon-core
language: en
chapterTypes: ["Strategy", "Adventurer POV", "Setup", "Transition", "Payoff"]
fatigueWords: ["delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "comprehensive", "nuanced", "embark", "foster", "underscore", "bolstered", "crucial"]
numericalSystem: true
powerScaling: false
eraResearch: false
pacingRule: "Alternate dungeon POV (planning/building) with adventurer POV (exploration/combat) every 1-2 chapters. Expansion milestone every 5-8 chapters."
satisfactionTypes: ["Trap Success", "Floor Expansion", "Minion Evolution", "Adventurer Defeated", "Resource Milestone", "Core Upgrade"]
auditDimensions: [1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,24,25,26]
---

## Genre Prohibitions

- Dungeon leaving its location — immobility is the core constraint, not a bug
- No consequence for poor trap design or weak minions — adventurers must punish strategic failure
- Overemphasis on adventurer POV (>70%) — this is dungeon core, not dungeon crawl
- Lone-wolf dungeon with zero NPC dialogue or relationships
- Resource management without scarcity — dungeon must make meaningful choices between defense, expansion, and treasure
- Dungeon core invulnerable or never at risk — core vulnerability is the central tension

## Non-Human POV Rules

- Establish dungeon's sensory and cognitive limitations clearly — it "feels" through mana flows, vibrations, minion senses
- Split POV works best: dungeon core chapters (strategic, omniscient within dungeon) alternating with adventurer/NPC chapters (ground-level human perspective)
- Dungeon may think differently: slower consciousness, different time perception, alien emotional range
- Dungeon learns about the outside world through adventurers, scouts, or other filtered means
- Show the dungeon learning and adapting: "Adventurers bypassed arrow trap by..." leads to next iteration improvements

## Pacing Guidance

- Early: Simple dungeon (3-4 rooms, basic traps, weak monsters). Dungeon learns the system
- Mid: Expanding territory, specialized rooms, sophisticated trap combinations, creature breeding
- Late: Sprawling complex, hundreds of minions, political relationships with other dungeons/factions, regional economic impact
- Dungeon POV chapters (2-3k words): internal monologue, planning, resource management, strategy
- Adventurer POV chapters (2-3k words): exploration, discovery, combat, adaptation
- End dungeon chapters on suspense (adventurers approaching); end adventurer chapters revealing dungeon's plan
- Each room/trap/creature must feel purposeful — readers enjoy creative dungeon design with clear strategic reasoning

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's dungeon name, core type, floor names, trap names, minion types, and specific adventurer factions into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the dungeon core's awakening / first construction / first adventurer encounter. Guide: use the book's specific core type and the initial environment the dungeon finds itself in.
- **protagonist_goal**: Extract from the dungeon's ultimate objective (expand infinitely / become a forbidden zone / establish surface influence / understand its own origin). Guide: goal must reference the book's specific expansion direction or core mystery.
- **pressure_source**: Extract from adventurer incursions / resource scarcity / rival dungeons / surface faction crusades. Guide: use the book's specific adventurer guild names, rival dungeon names, or faction names.
- **obstacle_dilemma**: Extract from "defend or expand" / "treasure or traps" / "consume adventurers or negotiate". Guide: use the book's specific resource-allocation dilemmas.
- **solution_possibility**: Extract from new trap combinations / minion evolutions / floor redesigns / trading with adventurers. Guide: use the book's specific trap names, minion types, and strategy names.
- **active_attempt**: Extract from the dungeon's specific trap deployments / floor expansions / minion commands / adventurer manipulations. Guide: use the book's specific trap names, floor names, and minion types.
- **payoff_reward**: Extract from adventurer party wiped / resources harvested / floor expanded / core upgraded. Guide: use the book's specific expansion milestones and upgrade effects.
- **ending_pull**: Extract from "What is the dungeon's origin? What happens to the surface world? Can the dungeon transcend its immobility?" Guide: use the book's specific ultimate dungeon mystery.
- **antagonist_pressure**: Extract from the book's specific threats (adventurer guild / kingdom army / rival dungeon cores / dragon-slayer types). Guide: must use the book's actual faction names and key antagonist identifiers.
- **resource_reward**: Extract from the book's specific dungeon resources (mana / build points / minion essence / adventurer gear). Guide: use the book's resource names and quantity thresholds.
- **world_rule**: Extract from the book's unique dungeon mechanics (build restrictions / mana flow / floor mechanics / adventurer level matching). Guide: use the book's specific dungeon-rule descriptions and constraints.
- **forbidden_false_positive**: Do not use generic terms like "expansion", "traps", "floors", or "adventurers" as signals. Every signal must contain the book's specific dungeon proper nouns and numerical thresholds.
