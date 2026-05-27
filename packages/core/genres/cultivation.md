---
name: English Cultivation
id: cultivation
language: en
chapterTypes: ["Training", "Breakthrough", "Combat", "Setup", "Transition", "Payoff"]
fatigueWords: ["delve", "tapestry", "testament", "intricate", "pivotal", "vibrant", "comprehensive", "nuanced", "embark", "foster", "underscore", "bolstered", "crucial"]
numericalSystem: false
powerScaling: true
eraResearch: false
pacingRule: "Training/meditation alternates with application/combat. Breakthrough every 5-10 chapters early, every 15-25 late. Each stage must feel earned through discipline."
satisfactionTypes: ["Stage Breakthrough", "Technique Mastery", "Tribulation Survived", "Martial Victory", "Philosophical Insight", "Core Formation"]
auditDimensions: [1,2,3,4,6,7,8,9,10,13,14,15,16,17,18,19,24,25,26]
---

## Genre Prohibitions

- Cultivation that feels instant or effortless — it must read like genuine labor
- Breakthrough scenes treated as throwaway moments — each tier transition deserves a full dramatic scene
- Ignoring philosophical/spiritual depth — meditation and inner balance matter as much as combat power
- Adopting full Chinese cultural trappings without adaptation — this is Western cultivation, use accessible naming (Copper/Iron/Jade/Gold, not Qi Condensation/Core Formation unless earned)
- Power gains disconnected from training, sacrifice, or problem-solving
- Cultivation stages with no meaningful difference in capability between them

## Cultivation Rules

- Typical Western cultivation stages: Qi Foundation / Energy Gathering -> Core Formation -> Immortal Ascension -> Tribulation / Transcendence (or custom equivalents)
- Each stage represents meaningful power transformation — characters at different stages should not compete directly without explanation
- Cultivation must feel like work: meditation scenes with five-sense description, not abstract philosophy lectures
- Breakthrough scenes show struggle, transformation, and cost — not instant "ding" level-ups
- Martial integration: cultivation combines with physical combat training, not just sitting and meditating
- Philosophical elements add depth but must emerge through experience, not exposition
- Spiritual attribute development: sensitivity to energy, intuition, capacity increases are valid non-numerical progression markers

## Pacing Guidance

- Mix detailed training scenes (showing struggle, failure, epiphanies) with montages covering longer periods
- 1-2 detailed breakthrough scenes per cultivation stage — these are the genre's peak moments
- Combat tests what was learned in training — progression and action feed each other
- Internal struggle escalates with power: pride, responsibility, temptation, and enemies grow alongside cultivation
- Sect/academy politics and mentorship relationships provide non-combat tension
- Early: frequent small gains. Mid: longer plateaus with harder breakthroughs. Late: rare, climactic stage transitions
- The journey of cultivation is the story — readers came for the grind, not just the destination

## Structure Signal Generation Guidance

This guidance is used during `create_book` for the architect to generate book-specific `story/structure_signals.json`. **Do not copy these descriptions directly as signals** — combine them with the book's character names, stage names, technique names, sect names, and breakthrough events into phrases that can be precisely matched in the prose.

- **opening_hook**: Extract from the MC's starting condition (mortal / crippled core / exiled disciple / hidden talent revealed). Guide: use the book's specific initial status event and the character/force involved.
- **protagonist_goal**: Extract from the MC's cultivation goal (reach the peak / avenge master / transcend mortality / protect the sect). Guide: goal must reference the book's specific realm names and personal vendettas.
- **pressure_source**: Extract from rival sects / tribulation threats / resource competition / inner demons / cultivation bottlenecks. Guide: use the book's specific rival sect names, tribulation types, or resource names.
- **obstacle_dilemma**: Extract from "kill or spare" / "break through at a cost or wait" / "loyalty to sect vs. personal path". Guide: use the book's specific fork-point decisions tied to named characters or sects.
- **solution_possibility**: Extract from enlightenment breakthroughs / hidden technique comprehension / alchemy pill mastery / formation cracking. Guide: use the book's specific technique names and insight triggers.
- **active_attempt**: Extract from the MC's key duels / tribulation survival / secret realm exploration / alchemy crafting. Guide: use the book's specific opponent names, realm names, and technique names.
- **payoff_reward**: Extract from stage breakthroughs / technique mastery / tribulation survived / core formation. Guide: use the book's specific stage names and breakthrough events.
- **ending_pull**: Extract from "Can the MC transcend mortality? What is the true Dao? What is the cost of immortality?" Guide: use the book's specific ultimate cultivation question.
- **antagonist_pressure**: Extract from the book's specific rival cultivators / demonic cultivators / scheming sect elders / heavenly tribulations. Guide: must use the book's actual antagonist names, titles, and sect affiliations.
- **resource_reward**: Extract from the book's specific cultivation resources (spirit stones / rare herbs / cultivation manuals / pill formulas). Guide: use the book's resource names and acquisition events.
- **world_rule**: Extract from the book's unique cultivation system (stage names / breakthrough conditions / tribulation mechanics / Dao laws). Guide: use the book's specific stage names and rule descriptions.
- **forbidden_false_positive**: Do not use generic terms like "breakthrough", "cultivation", "enlightenment", or "transcendence" as signals. Every signal must contain the book's specific stage names, technique names, or character titles.
