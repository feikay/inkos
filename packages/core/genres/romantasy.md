---
name: Romantasy
id: romantasy
language: en
chapterTypes: ["Romance", "Action", "Setup", "Transition", "Payoff"]
fatigueWords: ["delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "comprehensive", "nuanced", "embark", "foster", "underscore", "bolstered", "crucial"]
numericalSystem: false
powerScaling: false
eraResearch: false
pacingRule: "Romance beats at every act break. Chemistry scenes every 2-3 chapters. Fantasy romance: consummation at 60-75%. Romantic fantasy: romance resolution aligned with plot resolution."
satisfactionTypes: ["Chemistry Moment", "Vulnerability Shared", "Obstacle Overcome Together", "First Kiss", "Relationship Defined", "HEA/HFN Achieved"]
auditDimensions: [1,2,3,6,7,8,9,10,13,14,15,16,17,18,19,24,25,26]
---

## Genre Prohibitions

- Chemistry that isn't earned — readers must understand why characters care for each other
- Love interest who doesn't drive protagonist's transformation
- Easy romance without real conflict — tension is mandatory
- Fantasy romance without HEA/HFN ending — readers feel betrayed
- Mislabeling heat level — communicate clearly in story setup; readers self-select
- World-building that feels like afterthought to romance — setting must complicate or enable the relationship
- Love triangles dragged out without decisive resolution
- "Tell" emotions instead of showing them — inner feelings shown through action, not declaration

## Romance Rules

- Show attraction subtly: physical detail notices, lingering touches, involuntary reactions (heartbeat, breath catching)
- Banter and wit: clever dialogue showing mutual understanding and intellectual challenge
- Vulnerability moments: characters sharing weakness, fear, secrets, past trauma
- Shared goals reveal compatibility: working together toward a goal shows how the partner handles conflict
- Conflict must be real — external barriers (class, species, faction, magic) or internal barriers (fear, trust, past wounds)
- Fantasy setting complicates romance: magic bonds, soul connections, species differences, political marriages
- Action scenes show relationship dynamics — fighting together reveals trust and compatibility
- Heat level must be consistent throughout — don't escalate or pull back without narrative reason

## Pacing Guidance

- Fantasy romance: heavy romance focus early, building to consummation around 60-75%, resolution after romance established
- Romantic fantasy: romance subplot woven through action plot, key romantic moments at act breaks, romance resolution aligned with plot resolution
- Chemistry scenes every 2-3 chapters minimum — readers came for the relationship
- Sexual tension can heighten during/after action (adrenaline, relief, protective instincts)
- Break up long dialogue-heavy romance scenes with physical action or setting detail
- Enemies-to-lovers needs slow burn: opposition -> forced proximity -> grudging respect -> attraction -> surrender
- Second-chance romance: history adds depth and pain; show how characters have changed

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, relationship stages, magical bonds, political factions, and specific intimate/action events into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the first encounter / initial conflict / charged moment between the romantic leads. Guide: use the book's specific meeting scene and the immediate impression each makes on the other.
- **protagonist_goal**: Extract from the protagonist's dual goals (romantic resolution + fantasy plot objective). Guide: both the relationship goal and the plot goal must reference the book's specific characters, factions, or magical stakes.
- **pressure_source**: Extract from external barriers (war / political marriage / species divide / faction conflict) and internal barriers (fear of vulnerability / past betrayal / magical bond complications). Guide: use the book's specific barrier sources tied to named entities.
- **obstacle_dilemma**: Extract from "duty or love" / "trust or self-protect" / "sacrifice one for the other". Guide: use the book's specific romantic-versus-plot fork points.
- **solution_possibility**: Extract from vulnerability shared / fighting together / magical bond deepened / trust earned through action. Guide: use the book's specific relationship-breakthrough scenes.
- **active_attempt**: Extract from the leads' shared battles / intimate conversations / sacrifices for each other / political maneuvers. Guide: use the book's specific battle names, conversation settings, and sacrifice moments.
- **payoff_reward**: Extract from chemistry moments / first kiss / relationship defined / obstacle overcome together / HEA/HFN achieved. Guide: use the book's specific romantic milestones.
- **ending_pull**: Extract from "Will they end up together? Can they overcome the ultimate barrier? What will the relationship cost them?" Guide: use the book's specific ultimate romantic question.
- **antagonist_pressure**: Extract from the book's specific romantic rivals / political opponents / the fantasy antagonist / societal forces. Guide: must use the book's actual character names and faction names.
- **resource_reward**: Extract from the book's specific relationship resources (trust / shared secrets / magical bonds / alliance / protection). Guide: use the book's specific bond types and relationship milestones.
- **world_rule**: Extract from the book's unique setting constraints on romance (political marriage rules / species barriers / magical bond mechanics / social class). Guide: use the book's specific world-rule descriptions that affect the relationship.
- **forbidden_false_positive**: Do not use generic terms like "chemistry", "attraction", "love", or "HEA" as signals. Every signal must contain the book's specific character names, bond types, faction names, or relationship-event descriptions.
