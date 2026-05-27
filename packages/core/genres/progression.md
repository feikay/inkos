---
name: Progression Fantasy
id: progression
language: en
chapterTypes: ["Training", "Breakthrough", "Setup", "Transition", "Payoff"]
fatigueWords: ["delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "comprehensive", "nuanced", "embark", "foster", "underscore", "bolstered", "crucial"]
numericalSystem: false
powerScaling: true
eraResearch: false
pacingRule: "Tier advancement every 2-4 chapters early, every 8-15 mid-story, every 20+ late-story. Each tier must feel fundamentally different."
satisfactionTypes: ["Tier Breakthrough", "Technique Mastery", "Rival Surpassed", "Mentor Transcended", "Power Combination Discovered", "Impossible Challenge Overcome"]
auditDimensions: [1,2,3,4,6,7,8,9,10,13,14,15,16,17,18,19,24,25,26]
---

## Genre Prohibitions

- Power loss without extraordinary justification — progress loss drives readers away faster than anything
- Instant power-ups from found items or bloodline awakenings without buildup
- Training montages only — readers want detailed training scenes showing struggle and epiphany
- Arbitrary advancement blocks that feel like artificial gates rather than organic difficulty
- Tier progression that contradicts established power hierarchy
- Characters at different tiers competing directly without explanation

## Power System Rules

- Progress must be quantifiable — even without explicit numbers, use measurable tiers (Stage 3 cultivator, Master swordsman)
- Clear power tiers with meaningful differences between each (Color, Metal, Letter, or custom)
- Each tier should represent meaningful power difference — not just cosmetic upgrades
- Earned growth only — power gains connect to effort, sacrifice, or problem-solving
- Book-to-book comparison: Book 3 MC decisively defeats Book 1 version
- Mix training montages (covering weeks) with 1-2 detailed breakthrough scenes per tier
- Physical transformations can signal tier transitions: eye color, aura, physical presence

## Pacing Guidance

- Chapter structure: Training/learning -> Application/testing -> Breakthrough trigger -> Advancement or cliffhanger
- Maintain tension as MC grows: introduce enemies/challenges that scale differently or present new threat types
- Internal struggle must escalate with power — new power unlocks pride, responsibility, temptation, enemies
- Strongest threats need not be physical: political, magical, spiritual, temporal
- Early: MC is underdog among peers. Mid: MC formidable but others advance too. Late: MC among strongest but faces tier-transcending threats
- Rivalry with a peer who also progresses keeps tension alive across the full arc

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, tier names, technique names, academy/sect names, and breakthrough events into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the MC's starting tier and the inciting discovery (hidden talent / mentor encounter / first victory against odds). Guide: use the book's specific initial status and the event that sets the progression in motion.
- **protagonist_goal**: Extract from the MC's tier goal (reach the highest rank / surpass the mentor / defeat the unbeatable rival). Guide: goal must reference the book's specific tier names and named rivals.
- **pressure_source**: Extract from scaling enemies / tier walls / resource scarcity / rival progression / institutional barriers. Guide: use the book's specific enemy names, tier bottlenecks, or institution names.
- **obstacle_dilemma**: Extract from "advance through ethical means or shortcuts" / "mentor's path or forge own" / "power or relationships". Guide: use the book's specific path-choice scenes.
- **solution_possibility**: Extract from technique combinations / training epiphanies / mentor guidance / hidden potential unlocked. Guide: use the book's specific technique names and breakthrough triggers.
- **active_attempt**: Extract from the MC's training arcs / sparring matches / tournament battles / dungeon or trial runs. Guide: use the book's specific tournament names, opponent names, and technique names.
- **payoff_reward**: Extract from tier breakthroughs / technique mastery / rival surpassed / mentor transcended. Guide: use the book's specific tier names and victory milestones.
- **ending_pull**: Extract from "What is the true peak? Is there a ceiling? What lies beyond the highest known tier?" Guide: use the book's specific ultimate tier mystery.
- **antagonist_pressure**: Extract from the book's specific rivals / higher-tier antagonists / institution enforcers / progression-blocking forces. Guide: must use the book's actual rival names, tier levels, and affiliations.
- **resource_reward**: Extract from the book's specific training resources (manuals / elixirs / mentorship access / training grounds). Guide: use the book's resource names and acquisition milestones.
- **world_rule**: Extract from the book's unique tier system (tier names / advancement conditions / power differentials between tiers / bottlenecks). Guide: use the book's specific tier mechanics and constraints.
- **forbidden_false_positive**: Do not use generic terms like "breakthrough", "advancement", "power up", or "rank up" as signals. Every signal must contain the book's specific tier names, technique names, or character titles.
