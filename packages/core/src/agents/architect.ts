import { BaseAgent } from "./base.js";
import type { BookConfig, FanficMode } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { readGenreProfile } from "./rules-reader.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { renderHookSnapshot } from "../utils/memory-retrieval.js";
import {
  ANTAGONIST_TEMPLATES,
  OPENING_HOOK_METHODS,
  SIX_STEP_PLOT_METHOD,
  TRANSITION_METHODS,
  WORLD_ENGINE_METHOD,
} from "../story-methods/index.js";
import {
  buildAuthorIntentContent,
  buildCharacterMatrixContent,
  buildCurrentFocusContent,
  buildEmotionalArcsContent,
  buildSubplotBoardContent,
  type FoundationDocumentMeta,
} from "./foundation-documents.js";
import { parseArchitectStructureSignals, writeStructureSignals, validateStructureSignalsFull } from "../utils/structure-signals.js";

export interface ArchitectOutput {
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRules: string;
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly genreArchitecture?: string;
  readonly worldEngine?: string;
  readonly antagonistMap?: string;
  readonly motivationMatrix?: string;
  readonly first10ChapterPlan?: string;
  readonly structureSignals?: string;
}

interface WebnovelTemplateFiles {
  readonly genreProfile: string;
  readonly arcMap: string;
  readonly powerSystem: string;
}

type StorySkeletonSection =
  | "genre_architecture"
  | "world_engine"
  | "antagonist_map"
  | "motivation_matrix"
  | "first_10_chapter_plan";

const STORY_SKELETON_TITLES: Record<StorySkeletonSection, Record<"zh" | "en", string>> = {
  genre_architecture: { zh: "题材架构", en: "Genre Architecture" },
  world_engine: { zh: "世界发动机", en: "World Engine" },
  antagonist_map: { zh: "反派结构", en: "Antagonist Structure" },
  motivation_matrix: { zh: "人物动机矩阵", en: "Motivation Matrix" },
  first_10_chapter_plan: { zh: "前10章规划", en: "First 10 Chapter Plan" },
};

const STORY_SKELETON_FALLBACK_TEMPLATES: Record<StorySkeletonSection, Record<"zh" | "en", string>> = {
  genre_architecture: {
    zh: `## 1. 题材定位
- 主分类：
- 子题材：
- 目标平台：
- 目标读者：
- 核心卖点：
- 核心情绪：
- 核心爽点：

## 2. 读者承诺
- 这本书承诺给读者什么爽感？
- 这本书承诺给读者什么情绪？
- 这本书承诺给读者什么反转？
- 这本书承诺给读者什么成长？

## 3. 开局打法
- 主钩子类型：悬念留白 / 极度反差 / 矛盾前置 / 颠覆世界观先行 / 极致情绪
- 为什么适合本书？
- 第一章前500字应该如何体现？
- 黄金三章分别承担什么功能？

## 4. 章节节奏模板
- 每章核心冲突密度：
- 每几章一个小爽点：
- 每几章一次反转：
- 每几章一次阶段收益：
- 每卷结尾应该形成什么变化：

## 5. 发布卖点
- 书名方向：
- 简介方向：
- 标签方向：
- 封面关键词：
- 番茄发布注意点：`,
    en: `## 1. Genre Positioning
- Primary category:
- Subgenre:
- Target platform:
- Target readers:
- Core selling point:
- Core emotion:
- Core gratification:

## 2. Reader Promise
- What gratification does this book promise?
- What emotion does this book promise?
- What reversal does this book promise?
- What growth does this book promise?

## 3. Opening Strategy
- Main hook type: suspense gap / extreme contrast / conflict first / worldview bomb / extreme emotion
- Why does it fit this book?
- How should the first 500 words show it?
- What does each golden first-three chapter do?

## 4. Chapter Rhythm Template
- Core conflict density per chapter:
- Small gratification every how many chapters:
- Reversal every how many chapters:
- Stage reward every how many chapters:
- What change should each volume ending create?

## 5. Publishing Selling Points
- Title direction:
- Blurb direction:
- Tag direction:
- Cover keywords:
- Tomato/Fanqie publishing notes:`,
  },
  world_engine: {
    zh: `## 1. 核心稀缺资源
- 这个世界所有人最想要什么？
- 它为什么稀缺？
- 谁垄断它？
- 普通人获取它要付出什么代价？

## 2. 资源分配与权力循环
- 资源如何转化为权力？
- 权力如何继续垄断资源？
- 哪些阶层因此受益？
- 哪些阶层因此被压迫？

## 3. 链式反应
- 生产力：
- 经济结构：
- 战争/暴力模式：
- 宗门/家族/朝廷/组织结构：
- 职业地位：
- 普通人日常生活：

## 4. 文明共识
- 这个世界默认尊敬什么？
- 默认鄙视什么？
- 什么行为被视为合理？
- 什么行为会被全世界惩罚？
- 主角为什么会冒犯这套共识？

## 5. 主角异常性
- 主角为什么是世界规则里的异常？
- 主角的存在威胁了谁？
- 世界会如何自动排斥/修正主角？

## 6. 自动产出冲突的方式
- 资源争夺
- 阶层压迫
- 制度审判
- 价值观冲突
- 身份暴露
- 规则惩罚
- 反派围剿
- 群体误解`,
    en: `## 1. Core Scarce Resource
- What does everyone in this world want most?
- Why is it scarce?
- Who monopolizes it?
- What price do ordinary people pay to obtain it?

## 2. Resource Distribution And Power Cycle
- How does resource become power?
- How does power keep monopolizing resource?
- Which classes benefit?
- Which classes are oppressed?

## 3. Chain Reactions
- Productivity:
- Economy:
- War/violence mode:
- Sect/family/court/organization structure:
- Occupational status:
- Ordinary daily life:

## 4. Civilization Consensus
- What does this world respect by default?
- What does it despise by default?
- What behavior is considered reasonable?
- What behavior will the whole world punish?
- Why does the protagonist offend this consensus?

## 5. Protagonist Anomaly
- Why is the protagonist an anomaly under world rules?
- Whom does the protagonist threaten?
- How will the world automatically reject or correct the protagonist?

## 6. Reusable Conflict Sources
- Resource struggle
- Class oppression
- Institutional judgment
- Value conflict
- Identity exposure
- Rule punishment
- Antagonist siege
- Group misunderstanding`,
  },
  antagonist_map: {
    zh: `## 1. 核心反派
- 姓名/代号：
- 表层身份：
- 真实身份：
- 反派类型：谋局者 / 殉道者 / 伪态者 / 混合型
- 公开目标：
- 隐藏目标：
- 掌握的资源：
- 维护的秩序：
- 为什么不能容忍主角：
- 与主角的价值观冲突：
- 他的胜利会导致什么？
- 他的失败会导致什么？

## 2. 核心反派的计划链
- 计划 A：
- 计划 B：
- 计划 C：
- 如果计划 A 被主角破坏，如何转入计划 B？
- 主角第一次以为自己赢了，实际上推动了什么更深计划？

## 3. 阶段反派
| 阶段/卷 | 阶段反派 | 类型 | 表层冲突 | 背后秩序 | 与核心反派关系 | 失败后的后果 |
|---|---|---|---|---|---|---|

## 4. 反派压力递进
- 初期如何压迫主角？
- 中期如何围剿主角？
- 后期如何在制度/世界规则层面压制主角？

## 5. 反派不降智规则
- 不能无理由送经验
- 不能突然犯低级错误
- 不能明明能杀却不杀还解释一堆
- 主角胜利必须靠伏笔、智慧、代价或微小变量`,
    en: `## 1. Core Antagonist
- Name/code:
- Surface identity:
- Real identity:
- Antagonist type: strategist / martyr / masquerader / hybrid
- Public goal:
- Hidden goal:
- Resources controlled:
- Order defended:
- Why they cannot tolerate the protagonist:
- Value conflict with protagonist:
- What happens if they win?
- What happens if they fail?

## 2. Core Antagonist Plan Chain
- Plan A:
- Plan B:
- Plan C:
- If Plan A is broken, how does it trigger Plan B?
- When the protagonist first thinks they have won, what deeper plan did they advance?

## 3. Stage Antagonists
| Stage/Volume | Stage Antagonist | Type | Surface Conflict | Backing Order | Link To Core Antagonist | Consequence After Defeat |
|---|---|---|---|---|---|---|

## 4. Antagonist Pressure Escalation
- Early pressure:
- Mid-story siege:
- Late-stage institutional/world-rule suppression:

## 5. No-Dumbing-Down Rules
- No free experience without reason
- No sudden low-level mistakes
- No sparing the protagonist while explaining everything
- Protagonist victories must come from foreshadowing, intelligence, cost, or tiny variables`,
  },
  motivation_matrix: {
    zh: `## 1. 主角动机
- 表层目标：
- 深层欲望：
- 最大恐惧：
- 当前最缺的东西：
- 不能失去的东西：
- 底线：
- 会为了目标牺牲什么：
- 绝不会牺牲什么：
- 每卷目标如何升级：

## 2. 核心反派动机
- 表层目标：
- 深层欲望：
- 最大恐惧：
- 他认为自己正确的理由：
- 他不能退让的原因：
- 他最害怕主角证明什么：

## 3. 重要配角动机表
| 角色 | 表层目标 | 深层欲望 | 恐惧 | 底线 | 会背叛什么 | 绝不背叛什么 | 与主角利益关系 |
|---|---|---|---|---|---|---|---|

## 4. 人物关系张力
- 主角与核心反派的张力
- 主角与重要同伴的张力
- 主角与潜在背叛者的张力
- 主角与世界共识的张力

## 5. 后续续写约束
- 人物行动必须由表层目标、深层欲望、恐惧或底线驱动。
- 配角不能只为给主角送信息而出现。
- 背叛、牺牲、结盟必须符合本矩阵中的利益关系。`,
    en: `## 1. Protagonist Motivation
- Surface goal:
- Deep desire:
- Greatest fear:
- Current lack:
- Cannot lose:
- Bottom line:
- Will sacrifice:
- Will never sacrifice:
- How each volume goal upgrades:

## 2. Core Antagonist Motivation
- Surface goal:
- Deep desire:
- Greatest fear:
- Why they believe they are right:
- Why they cannot retreat:
- What proof from the protagonist scares them most:

## 3. Important Supporting Character Motivation Table
| Character | Surface Goal | Deep Desire | Fear | Bottom Line | Will Betray | Will Never Betray | Interest Relation With Protagonist |
|---|---|---|---|---|---|---|---|

## 4. Relationship Tension
- Protagonist vs core antagonist:
- Protagonist vs important ally:
- Protagonist vs potential betrayer:
- Protagonist vs world consensus:

## 5. Future Writing Constraints
- Character action must be driven by surface goal, deep desire, fear, or bottom line.
- Supporting characters cannot appear only to deliver information.
- Betrayal, sacrifice, and alliance must match the interest relationships above.`,
  },
  first_10_chapter_plan: {
    zh: `## 1. 黄金三章目标
### 第1章
- 主钩子类型：
- 前500字冲突：
- 主角困境：
- 章节结尾钩子：

### 第2章
- 核心功能：
- 金手指/核心差异如何展示：
- 阻碍如何升级：
- 章节结尾钩子：

### 第3章
- 核心功能：
- 长期目标如何明确：
- 第一个阶段敌人如何出现：
- 章节结尾钩子：

## 2. 前10章章节表
| 章数 | 章节功能 | 情绪事件 | 主角目标 | 阻碍困境 | 解决方法 | 爽点/反转 | 结尾钩子 |
|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |

## 3. 前10章反派压力安排
- 核心反派或阶段反派的压力如何逐步显现：
- 如何避免反派无脑送经验：

## 4. 前10章伏笔安排
| 伏笔 | 埋设章节 | 表层表现 | 真实含义 | 预计回收章节 |
|---|---|---|---|---|

## 5. 前10章追读风险
- 风险：
- 规避策略：`,
    en: `## 1. Golden First Three Chapters
### Chapter 1
- Main hook type:
- First 500-word conflict:
- Protagonist dilemma:
- Ending hook:

### Chapter 2
- Core function:
- How core edge/difference appears:
- How obstacle escalates:
- Ending hook:

### Chapter 3
- Core function:
- How long-term goal becomes clear:
- How first stage enemy appears:
- Ending hook:

## 2. First 10 Chapter Table
| Chapter | Chapter Function | Emotion Event | Protagonist Goal | Obstacle/Dilemma | Solution | Gratification/Reversal | Ending Hook |
|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |

## 3. First 10 Chapter Antagonist Pressure
- How core or stage antagonist pressure gradually appears:
- How to avoid free experience delivery:

## 4. First 10 Chapter Foreshadowing
| Foreshadowing | Setup Chapter | Surface Appearance | Real Meaning | Expected Payoff Chapter |
|---|---|---|---|---|

## 5. First 10 Chapter Retention Risks
- Risk:
- Avoidance strategy:`,
  },
};

export class ArchitectAgent extends BaseAgent {
  get name(): string {
    return "architect";
  }

  async generateFoundation(
    book: BookConfig,
    externalContext?: string,
    reviewFeedback?: string,
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = book.language ?? gp.language;

    const contextBlock = externalContext
      ? `\n\n## 外部指令\n以下是来自外部系统的创作指令，请将其融入设定中：\n\n${externalContext}\n`
      : "";
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);

    const numericalBlock = gp.numericalSystem
      ? `- 有明确的数值/资源体系可追踪
- 在 book_rules 中定义 numericalSystemOverrides（hardCap、resourceTypes）`
      : "- 本题材无数值系统，不需要资源账本";

    const powerBlock = gp.powerScaling
      ? "- 有明确的战力等级体系"
      : "";

    const eraBlock = gp.eraResearch
      ? "- 需要年代考据支撑（在 book_rules 中设置 eraConstraints）"
      : "";

    const storyBiblePrompt = resolvedLanguage === "en"
      ? `Use structured second-level headings:
## 01_Worldview
World setting, historical-social frame, and core rules

## 02_Protagonist
Protagonist setup (identity / advantage / personality core / behavioral boundaries)

## 03_Factions_and_Characters
Major factions and important supporting characters (for each: name, identity, motivation, relationship to protagonist, independent goal)

## 04_Geography_and_Environment
Map / scene design and environmental traits

## 05_Title_and_Blurb
Title method:
- Keep the title clear, direct, and easy to understand
- Use a format that immediately signals genre and core appeal
- Avoid overly literary or misleading titles

Blurb method (within 300 words, choose one):
1. Open with conflict, then reveal the hook, then leave suspense
2. Summarize only the main line and keep a clear suspense gap
3. Use a miniature scene that captures the book's strongest pull

Core blurb principle:
- The blurb is product copy that must make readers want to click`
      : `用结构化二级标题组织：
## 01_世界观
世界观设定、核心规则体系

## 02_主角
主角设定（身份/金手指/性格底色/行为边界）

## 03_势力与人物
势力分布、重要配角（每人：名字、身份、动机、与主角关系、独立目标）

## 04_地理与环境
地图/场景设定、环境特色

## 05_书名与简介
书名方法论：
- 书名必须简单扼要、通俗易懂，读者看到书名就能知道题材和主题
- 采用"题材+核心爽点+主角行为"的长书名格式，避免文艺化
- 融入平台当下热点词汇，吸引精准流量
- 禁止题材错位（都市文取玄幻书名会导致读者流失）
- 参考热榜书名风格：俏皮、通俗、有记忆点

简介方法论（300字内，三种写法任选其一）：
1. 冲突开篇法：第一句抛困境/冲突，第二句亮金手指/核心能力，第三句留悬念
2. 高度概括法：只挑主线概括（不是全篇概括），必须留悬念
3. 小剧场法：提炼故事中最经典的桥段，作为引子

简介核心原则：
- 简介 = 产品宣传语，必须让读者产生"我要点开看"的冲动
- 可以从剧情设定、人设、或某个精彩片段切入
- 必须有噱头（如"凡是被写在笔记本上的名字，最后都得死"）`;

    const volumeOutlinePrompt = resolvedLanguage === "en"
      ? `Volume plan. For each volume include: title, chapter range, core conflict, key turning points, and payoff goal

### Golden First Three Chapters Rule
- Chapter 1: throw the core conflict immediately; no large background dump
- Chapter 2: show the core edge / ability / leverage that answers Chapter 1's pressure
- Chapter 3: establish the first concrete short-term goal that gives readers a reason to continue`
      : `卷纲规划，每卷包含：卷名、章节范围、核心冲突、关键转折、收益目标

### 黄金三章法则（前三章必须遵循）
- 第1章：抛出核心冲突（主角立即面临困境/危机/选择），禁止大段背景灌输
- 第2章：展示金手指/核心能力（主角如何应对第1章的困境），让读者看到爽点预期
- 第3章：明确短期目标（主角确立第一个具体可达成的目标），给读者追读理由`;

    const bookRulesPrompt = resolvedLanguage === "en"
      ? `Generate book_rules.md as YAML frontmatter plus narrative guidance:
\`\`\`
---
version: "1.0"
protagonist:
  name: (protagonist name)
  personalityLock: [(3-5 personality keywords)]
  behavioralConstraints: [(3-5 behavioral constraints)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3 forbidden style intrusions)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (decide from the setting)
  resourceTypes: [(core resource types)]` : ""}
prohibitions:
  - (3-5 book-specific prohibitions)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## Narrative Perspective
(Describe the narrative perspective and style)

## Core Conflict Driver
(Describe the book's core conflict and propulsion)
\`\`\``
      : `生成 book_rules.md 格式的 YAML frontmatter + 叙事指导，包含：
\`\`\`
---
version: "1.0"
protagonist:
  name: (主角名)
  personalityLock: [(3-5个性格关键词)]
  behavioralConstraints: [(3-5条行为约束)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3种禁止混入的文风)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (根据设定确定)
  resourceTypes: [(核心资源类型列表)]` : ""}
prohibitions:
  - (3-5条本书禁忌)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## 叙事视角
(描述本书叙事视角和风格)

## 核心冲突驱动
(描述本书的核心矛盾和驱动力)
\`\`\``;

    const politicalSafetyRulesPrompt = resolvedLanguage === "en"
      ? `\nPolitical/international/election safety rule: if the premise involves presidents, elections, parties, international conflict, or real-world ethnic/national identity, do not write an overbroad prohibition like "ban any real country mapping". Use a precise rule instead: real nationality/ethnic identity may be used as character background, but real political figures, real political parties, real political events, and direct identity slurs are forbidden; foreign governments, parties, presidents, and capital groups must be fully fictionalized.`
      : `\n政治/国际/竞选题材安全规则：如果题材涉及总统、竞选、政党、国际冲突或真实国籍/族裔身份，不要写“禁止任何现实国家映射”这种过宽禁忌。应写成更精确规则：允许真实国籍/族裔身份作为角色背景，但禁止现实政治人物、现实政党、现实政治事件映射，禁止直接身份羞辱词；外国政权、政党、总统、财团必须完全虚构化。`;

    const currentStatePrompt = resolvedLanguage === "en"
      ? `Initial state card (Chapter 0), include:
| Field | Value |
| --- | --- |
| Current Chapter | 0 |
| Current Location | (starting location) |
| Protagonist State | (initial condition) |
| Current Goal | (first goal) |
| Current Constraint | (initial constraint) |
| Current Alliances | (initial relationships) |
| Current Conflict | (first conflict) |`
      : `初始状态卡（第0章），包含：
| 字段 | 值 |
|------|-----|
| 当前章节 | 0 |
| 当前位置 | (起始地点) |
| 主角状态 | (初始状态) |
| 当前目标 | (第一个目标) |
| 当前限制 | (初始限制) |
| 当前敌我 | (初始关系) |
| 当前冲突 | (第一个冲突) |`;

    const pendingHooksPrompt = resolvedLanguage === "en"
      ? `Initial hook pool (Markdown table):
| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | notes |

Rules for the hook table:
- Column 5 must be a pure chapter number, never natural-language description
- During book creation, all planned hooks are still unapplied, so last_advanced_chapter = 0
- Column 7 must be one of: immediate / near-term / mid-arc / slow-burn / endgame
- If you want to describe the initial clue/signal, put it in notes instead of column 5`
      : `初始伏笔池（Markdown表格）：
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |

伏笔表规则：
- 第5列必须是纯数字章节号，不能写自然语言描述
- 建书阶段所有伏笔都还没正式推进，所以第5列统一填 0
- 第7列必须填写：立即 / 近期 / 中程 / 慢烧 / 终局 之一
- 如果要说明“初始线索/最初信号”，写进备注，不要写进第5列`;

    const storyMethodPrompt = this.buildStoryMethodPrompt(resolvedLanguage);
    const storySkeletonPrompt = this.buildStorySkeletonPrompt(resolvedLanguage);

    const finalRequirementsPrompt = resolvedLanguage === "en"
      ? `Generated content must:
1. Fit the ${book.platform} platform taste
2. Fit the ${gp.name} genre traits
${numericalBlock}
${powerBlock}
${eraBlock}
3. Give the protagonist a clear personality and behavioral boundaries
4. Keep hooks and payoffs coherent
5. Make supporting characters independently motivated rather than pure tools`
      : `生成内容必须：
1. 符合${book.platform}平台口味
2. 符合${gp.name}题材特征
${numericalBlock}
${powerBlock}
${eraBlock}
3. 主角人设鲜明，有明确行为边界
4. 伏笔前后呼应，不留悬空线
5. 配角有独立动机，不是工具人`;

    const systemPrompt = `你是一个专业的网络小说架构师。你的任务是为一本新的${gp.name}小说生成完整的基础设定。${contextBlock}${reviewFeedbackBlock}

要求：
- 平台：${book.platform}
- 题材：${gp.name}（${book.genre}）
- 目标章数：${book.targetChapters}章
- 每章字数：${book.chapterWordCount}字

## 题材特征

${genreBody}

## inkos 2.0 故事方法论

${storyMethodPrompt}

## 生成要求

你需要生成以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}
${politicalSafetyRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${storySkeletonPrompt}

=== SECTION: structure_signals ===
${this.buildStructureSignalsPrompt(resolvedLanguage)}

${finalRequirementsPrompt}`;

    const langPrefix = resolvedLanguage === "en"
      ? `【LANGUAGE OVERRIDE】ALL output (story_bible, volume_outline, book_rules, current_state, pending_hooks, genre_architecture, world_engine, antagonist_map, motivation_matrix, first_10_chapter_plan, structure_signals) MUST be written in English. Character names, place names, and all prose must be in English. The === SECTION: === tags remain unchanged.\n\n`
      : "";
    const userMessage = resolvedLanguage === "en"
      ? `Generate the complete foundation for a ${gp.name} novel titled "${book.title}". Write everything in English.`
      : `请为标题为"${book.title}"的${gp.name}小说生成完整基础设定。`;

    const response = await this.chat([
      { role: "system", content: langPrefix + systemPrompt },
      { role: "user", content: userMessage },
    ], { temperature: 0.8, maxTokens: 16384 });

    return this.parseSections(response.content);
  }

  async writeFoundationFiles(
    bookDir: string,
    output: ArchitectOutput,
    numericalSystem: boolean = true,
    language: "zh" | "en" = "zh",
    webnovelTemplate?: "xuanhuan",
    documentMeta: FoundationDocumentMeta = {},
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });

    const writes: Array<Promise<void>> = [
      writeFile(join(storyDir, "story_bible.md"), output.storyBible, "utf-8"),
      writeFile(join(storyDir, "volume_outline.md"), output.volumeOutline, "utf-8"),
      writeFile(join(storyDir, "book_rules.md"), output.bookRules, "utf-8"),
      writeFile(join(storyDir, "current_state.md"), output.currentState, "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), output.pendingHooks, "utf-8"),
      writeFile(
        join(storyDir, "genre_architecture.md"),
        this.contentOrFallback(output.genreArchitecture, "genre_architecture", language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "world_engine.md"),
        this.contentOrFallback(output.worldEngine, "world_engine", language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "antagonist_map.md"),
        this.contentOrFallback(output.antagonistMap, "antagonist_map", language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "motivation_matrix.md"),
        this.contentOrFallback(output.motivationMatrix, "motivation_matrix", language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "first_10_chapter_plan.md"),
        this.contentOrFallback(output.first10ChapterPlan, "first_10_chapter_plan", language),
        "utf-8",
      ),
    ];

    if (numericalSystem) {
      writes.push(
        writeFile(
          join(storyDir, "particle_ledger.md"),
          language === "en"
            ? "# Resource Ledger\n\n| Chapter | Opening Value | Source | Integrity | Delta | Closing Value | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n| 0 | 0 | Initialization | - | 0 | 0 | Initial book state |\n"
            : "# 资源账本\n\n| 章节 | 期初值 | 来源 | 完整度 | 增量 | 期末值 | 依据 |\n|------|--------|------|--------|------|--------|------|\n| 0 | 0 | 初始化 | - | 0 | 0 | 开书初始 |\n",
          "utf-8",
        ),
      );
    }

    // Initialize new truth files
    writes.push(
      writeFile(
        join(storyDir, "author_intent.md"),
        buildAuthorIntentContent(output, documentMeta, language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "current_focus.md"),
        buildCurrentFocusContent(output, documentMeta, language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "subplot_board.md"),
        buildSubplotBoardContent(output, documentMeta, language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "emotional_arcs.md"),
        buildEmotionalArcsContent(output, documentMeta, language),
        "utf-8",
      ),
      writeFile(
        join(storyDir, "character_matrix.md"),
        buildCharacterMatrixContent(output, documentMeta, language),
        "utf-8",
      ),
    );

    // Write structure_signals.json from architect output
    if (!output.structureSignals) {
      throw new Error(
        "[architect] structure_signals 生成失败：LLM 输出中缺少 structure_signals section。" +
        "请检查题材 profile 指导是否已更新，或重新建书以重新生成 structure_signals.json。" +
        "不要手工编辑 structure_signals.json 来伪造通过。",
      );
    }

    const parseResult = parseArchitectStructureSignals(output.structureSignals, documentMeta.id ?? basename(bookDir));
    if (parseResult.status === "parse_error") {
      throw new Error(
        `[architect] structure_signals 解析失败：${parseResult.error}。` +
        "可能原因：architect LLM 输出的 structure_signals JSON 格式不正确。" +
        "请重新建书以重新生成 structure_signals.json。不要手工编辑来伪造通过。",
      );
    }

    const validation = validateStructureSignalsFull(parseResult.signals);
    if (validation.status === "FAIL") {
      const errors = validation.issues
        .filter((i) => i.severity === "ERROR")
        .map((i) => i.message)
        .join("; ");
      throw new Error(
        `[architect] structure_signals 校验失败：${errors}。` +
        "可能原因：architect 生成的信号不满足最低质量要求。" +
        "请重新建书以重新生成 structure_signals.json。不要手工编辑来伪造通过。",
      );
    }

    if (validation.status === "WARN") {
      const warnings = validation.issues
        .filter((i) => i.severity === "WARN")
        .map((i) => i.message)
        .join("; ");
      console.warn(`[architect] structure_signals validation warnings: ${warnings}`);
    }

    await writeStructureSignals(bookDir, parseResult.signals);

    const templateFiles = this.buildWebnovelTemplateFiles(webnovelTemplate);
    if (templateFiles) {
      writes.push(
        writeFile(join(storyDir, "genre_profile.yaml"), templateFiles.genreProfile, "utf-8"),
        writeFile(join(storyDir, "arc_map.yaml"), templateFiles.arcMap, "utf-8"),
        writeFile(join(storyDir, "power_system.yaml"), templateFiles.powerSystem, "utf-8"),
      );
    }

    await Promise.all(writes);
  }

  private buildWebnovelTemplateFiles(
    template?: "xuanhuan",
  ): WebnovelTemplateFiles | null {
    if (template !== "xuanhuan") {
      return null;
    }

    return {
      genreProfile: [
        "template: xuanhuan",
        "label: 玄幻网文",
        "language: zh",
        "tone:",
        "  - 热血升级",
        "  - 危机压迫",
        "  - 爽点密集",
        "style:",
        "  pov: 第三人称近距离",
        "  sentence_rhythm: 短中句为主，关键节点拉长",
        "  exposition_rule: 设定服务冲突，不做大段空讲",
        "core_loop:",
        "  - 遭遇压制",
        "  - 获得线索/资源/机缘",
        "  - 冒险试错",
        "  - 小胜立威",
        "  - 引出更高层威胁",
        "forbidden_patterns:",
        "  - 主角连续被动挨打且无反制筹码",
        "  - 大段设定说明脱离人物行动",
        "  - 冲突刚抬起立刻泄气",
        "  - 配角只做工具人发言",
        "",
      ].join("\n"),
      arcMap: [
        "template: xuanhuan",
        "volumes:",
        "  - id: vol-01",
        "    title: 山门外的活路",
        "    chapter_range: \"1-30\"",
        "    core_conflict: 主角在边缘地带求生并找到第一条向上爬的路径",
        "    expected_payoffs:",
        "      - 拿到第一份真正改变命运的机缘",
        "      - 在宗门/家族外围立住名字",
        "    escalation:",
        "      opening: 生存压力与身份低位",
        "      midpoint: 资源争夺与第一次公开对抗",
        "      climax: 越级破局，代价换名声",
        "  - id: vol-02",
        "    title: 内门风暴",
        "    chapter_range: \"31-80\"",
        "    core_conflict: 主角进入更高层规则场，旧敌升级，新盟友出现",
        "    expected_payoffs:",
        "      - 建立稳定成长路线",
        "      - 触碰更高层世界真相",
        "    escalation:",
        "      opening: 新秩序与新压制",
        "      midpoint: 阵营站队与秘密暴露",
        "      climax: 以局破局，撬动更大棋盘",
        "",
      ].join("\n"),
      powerSystem: [
        "template: xuanhuan",
        "realm_tree:",
        "  - 炼体",
        "  - 聚气",
        "  - 筑基",
        "  - 化灵",
        "  - 神府",
        "  - 归真",
        "base_rules:",
        "  - 境界压制真实存在，越级取胜必须依赖明确外力、信息差或代价",
        "  - 资源获取与境界提升绑定，不能无因暴涨",
        "  - 每次大突破都应带来战斗方式或生存方式的变化",
        "exception_rules:",
        "  - 主角可凭特殊体质或异宝短时突破上限，但必须留下后遗症或债务",
        "  - 极端环境、古遗迹、禁术可暂时改写常规规则，但要写清触发条件",
        "  - 反杀高阶敌人时，必须让读者看见筹备链条，而非纯运气翻盘",
        "",
      ].join("\n"),
    };
  }

  private buildStoryMethodPrompt(language: "zh" | "en"): string {
    const worldQuestions = WORLD_ENGINE_METHOD.requiredQuestions?.slice(0, 6).join("\n- ") ?? "";
    const hookNames = OPENING_HOOK_METHODS.map((hook) => hook.name).join(" / ");
    const antagonistNames = ANTAGONIST_TEMPLATES.map((template) => template.name).join(" / ");
    const transitionNames = TRANSITION_METHODS.map((method) => method.name).join(" / ");
    const plotSteps = SIX_STEP_PLOT_METHOD.steps.map((step) => step.name).join(" -> ");

    if (language === "en") {
      return `Use these reusable story methods when designing the new skeleton files:
- World engine: define scarcity, monopoly, chain reactions, shared civilization values, protagonist anomaly, and reusable conflict sources. Key questions: ${worldQuestions}
- Six-step plot loop: ${plotSteps}. Use it to design the first 10 chapters and chapter-level pursuit.
- Antagonist templates: ${antagonistNames}. Choose one core antagonist type or a deliberate hybrid.
- Opening hooks: ${hookNames}. Pick at least one main hook for Chapter 1.
- Transition methods: ${transitionNames}. Use them only as rhythm guidance for the first-10 plan; do not change write-next behavior.`;
    }

    return `请把这些可复用故事方法论用于新增故事骨架文件：
- 世界发动机：围绕稀缺、垄断、链式反应、文明共识、主角异常性、可复用冲突源建模。关键问题：${worldQuestions}
- 六步剧情闭环：${plotSteps}。用于规划前10章的章节追读和每章目标/阻碍/反馈。
- 高智商反派模板：${antagonistNames}。选择一种核心反派类型，或设计有意图的混合型。
- 开头钩子：${hookNames}。第1章必须至少选择一种主钩子。
- 万能转场：${transitionNames}。仅作为前10章节奏规划参考，不改变后续 write next 行为。`;
  }

  private buildStorySkeletonPrompt(language: "zh" | "en"): string {
    if (language === "en") {
      return `=== SECTION: genre_architecture ===
# Genre Architecture

## 1. Genre Positioning
- Primary category:
- Subgenre:
- Target platform:
- Target readers:
- Core selling point:
- Core emotion:
- Core gratification:

## 2. Reader Promise
- What gratification does this book promise?
- What emotion does this book promise?
- What reversal does this book promise?
- What growth does this book promise?

## 3. Opening Strategy
Choose at least one main opening hook from: suspense gap / extreme contrast / conflict first / worldview bomb / extreme emotion.
- Why does it fit this book?
- How should the first 500 words show it?
- What does each golden first-three chapter do?

## 4. Chapter Rhythm Template
- Core conflict density per chapter:
- Small gratification every how many chapters:
- Reversal every how many chapters:
- Stage reward every how many chapters:
- What change should each volume ending create?

## 5. Publishing Selling Points
- Title direction:
- Blurb direction:
- Tag direction:
- Cover keywords:
- Tomato/Fanqie publishing notes:

=== SECTION: world_engine ===
# World Engine

## 1. Core Scarce Resource
- What does everyone in this world want most?
- Why is it scarce?
- Who monopolizes it?
- What price do ordinary people pay to obtain it?

## 2. Resource Distribution And Power Cycle
- How does resource become power?
- How does power keep monopolizing resource?
- Which classes benefit?
- Which classes are oppressed?

## 3. Chain Reactions
Infer impact on:
- Productivity
- Economy
- War/violence mode
- Sect/family/court/organization structure
- Occupational status
- Ordinary daily life

## 4. Civilization Consensus
- What does this world respect by default?
- What does it despise by default?
- What behavior is considered reasonable?
- What behavior will the whole world punish?
- Why does the protagonist offend this consensus?

## 5. Protagonist Anomaly
- Why is the protagonist an anomaly under world rules?
- Whom does the protagonist threaten?
- How will the world automatically reject or correct the protagonist?

## 6. Reusable Conflict Sources
List at least 8 reusable conflict sources.

=== SECTION: antagonist_map ===
# Antagonist Structure

## 1. Core Antagonist
- Name/code:
- Surface identity:
- Real identity:
- Antagonist type: strategist / martyr / masquerader / hybrid
- Public goal:
- Hidden goal:
- Resources controlled:
- Order defended:
- Why they cannot tolerate the protagonist:
- Value conflict with protagonist:
- What happens if they win?
- What happens if they fail?

## 2. Core Antagonist Plan Chain
- Plan A:
- Plan B:
- Plan C:
- If Plan A is broken, how does it trigger Plan B?
- When the protagonist first thinks they have won, what deeper plan did they advance?

## 3. Stage Antagonists
| Stage/Volume | Stage Antagonist | Type | Surface Conflict | Backing Order | Link To Core Antagonist | Consequence After Defeat |
|---|---|---|---|---|---|---|

## 4. Antagonist Pressure Escalation
- Early pressure:
- Mid-story siege:
- Late-stage institutional/world-rule suppression:

## 5. No-Dumbing-Down Rules
- No free experience without reason
- No sudden low-level mistakes
- No sparing the protagonist while explaining everything
- Protagonist victories must come from foreshadowing, intelligence, cost, or tiny variables

=== SECTION: motivation_matrix ===
# Motivation Matrix

## 1. Protagonist Motivation
- Surface goal:
- Deep desire:
- Greatest fear:
- Current lack:
- Cannot lose:
- Bottom line:
- Will sacrifice:
- Will never sacrifice:
- How each volume goal upgrades:

## 2. Core Antagonist Motivation
- Surface goal:
- Deep desire:
- Greatest fear:
- Why they believe they are right:
- Why they cannot retreat:
- What proof from the protagonist scares them most:

## 3. Important Supporting Character Motivation Table
| Character | Surface Goal | Deep Desire | Fear | Bottom Line | Will Betray | Will Never Betray | Interest Relation With Protagonist |
|---|---|---|---|---|---|---|---|

## 4. Relationship Tension
- Protagonist vs core antagonist:
- Protagonist vs important ally:
- Protagonist vs potential betrayer:
- Protagonist vs world consensus:

## 5. Future Writing Constraints
List character behavior constraints that write-next must obey later.

=== SECTION: first_10_chapter_plan ===
# First 10 Chapter Plan

## 1. Golden First Three Chapters
### Chapter 1
- Main hook type:
- First 500-word conflict:
- Protagonist dilemma:
- Ending hook:

### Chapter 2
- Core function:
- How core edge/difference appears:
- How obstacle escalates:
- Ending hook:

### Chapter 3
- Core function:
- How long-term goal becomes clear:
- How first stage enemy appears:
- Ending hook:

## 2. First 10 Chapter Table
| Chapter | Chapter Function | Emotion Event | Protagonist Goal | Obstacle/Dilemma | Solution | Gratification/Reversal | Ending Hook |
|---|---|---|---|---|---|---|---|

Requirements: every chapter has a goal, obstacle, and ending hook; at least 3 small gratification beats; at least 2 reversals; Chapter 10 creates a stage situation change.

## 3. First 10 Chapter Antagonist Pressure
Explain how core or stage antagonist pressure gradually appears without free experience delivery.

## 4. First 10 Chapter Foreshadowing
| Foreshadowing | Setup Chapter | Surface Appearance | Real Meaning | Expected Payoff Chapter |
|---|---|---|---|---|

## 5. First 10 Chapter Retention Risks
List possible reader drop-off risks and avoidance strategies.`;
    }

    return `=== SECTION: genre_architecture ===
# 题材架构

## 1. 题材定位
- 主分类：
- 子题材：
- 目标平台：
- 目标读者：
- 核心卖点：
- 核心情绪：
- 核心爽点：

## 2. 读者承诺
- 这本书承诺给读者什么爽感？
- 这本书承诺给读者什么情绪？
- 这本书承诺给读者什么反转？
- 这本书承诺给读者什么成长？

## 3. 开局打法
必须从 opening hooks 中选择至少一种主钩子：悬念留白 / 极度反差 / 矛盾前置 / 颠覆世界观先行 / 极致情绪。
- 为什么适合本书？
- 第一章前500字应该如何体现？
- 黄金三章分别承担什么功能？

## 4. 章节节奏模板
- 每章核心冲突密度：
- 每几章一个小爽点：
- 每几章一次反转：
- 每几章一次阶段收益：
- 每卷结尾应该形成什么变化：

## 5. 发布卖点
- 书名方向：
- 简介方向：
- 标签方向：
- 封面关键词：
- 番茄发布注意点：

=== SECTION: world_engine ===
# 世界发动机

## 1. 核心稀缺资源
- 这个世界所有人最想要什么？
- 它为什么稀缺？
- 谁垄断它？
- 普通人获取它要付出什么代价？

## 2. 资源分配与权力循环
- 资源如何转化为权力？
- 权力如何继续垄断资源？
- 哪些阶层因此受益？
- 哪些阶层因此被压迫？

## 3. 链式反应
必须推演核心设定对以下方面的影响：
- 生产力
- 经济结构
- 战争/暴力模式
- 宗门/家族/朝廷/组织结构
- 职业地位
- 普通人日常生活

## 4. 文明共识
- 这个世界默认尊敬什么？
- 默认鄙视什么？
- 什么行为被视为合理？
- 什么行为会被全世界惩罚？
- 主角为什么会冒犯这套共识？

## 5. 主角异常性
- 主角为什么是世界规则里的异常？
- 主角的存在威胁了谁？
- 世界会如何自动排斥/修正主角？

## 6. 自动产出冲突的方式
列出至少 8 种可复用冲突来源，例如资源争夺、阶层压迫、制度审判、价值观冲突、身份暴露、规则惩罚、反派围剿、群体误解。

=== SECTION: antagonist_map ===
# 反派结构

## 1. 核心反派
- 姓名/代号：
- 表层身份：
- 真实身份：
- 反派类型：谋局者 / 殉道者 / 伪态者 / 混合型
- 公开目标：
- 隐藏目标：
- 掌握的资源：
- 维护的秩序：
- 为什么不能容忍主角：
- 与主角的价值观冲突：
- 他的胜利会导致什么？
- 他的失败会导致什么？

## 2. 核心反派的计划链
- 计划 A：
- 计划 B：
- 计划 C：
- 如果计划 A 被主角破坏，如何转入计划 B？
- 主角第一次以为自己赢了，实际上推动了什么更深计划？

## 3. 阶段反派
| 阶段/卷 | 阶段反派 | 类型 | 表层冲突 | 背后秩序 | 与核心反派关系 | 失败后的后果 |
|---|---|---|---|---|---|---|

## 4. 反派压力递进
- 初期如何压迫主角？
- 中期如何围剿主角？
- 后期如何在制度/世界规则层面压制主角？

## 5. 反派不降智规则
- 不能无理由送经验
- 不能突然犯低级错误
- 不能明明能杀却不杀还解释一堆
- 主角胜利必须靠伏笔、智慧、代价或微小变量

=== SECTION: motivation_matrix ===
# 人物动机矩阵

## 1. 主角动机
- 表层目标：
- 深层欲望：
- 最大恐惧：
- 当前最缺的东西：
- 不能失去的东西：
- 底线：
- 会为了目标牺牲什么：
- 绝不会牺牲什么：
- 每卷目标如何升级：

## 2. 核心反派动机
- 表层目标：
- 深层欲望：
- 最大恐惧：
- 他认为自己正确的理由：
- 他不能退让的原因：
- 他最害怕主角证明什么：

## 3. 重要配角动机表
| 角色 | 表层目标 | 深层欲望 | 恐惧 | 底线 | 会背叛什么 | 绝不背叛什么 | 与主角利益关系 |
|---|---|---|---|---|---|---|---|

## 4. 人物关系张力
- 主角与核心反派的张力
- 主角与重要同伴的张力
- 主角与潜在背叛者的张力
- 主角与世界共识的张力

## 5. 后续续写约束
列出 write next 阶段必须遵守的人物行为约束。

=== SECTION: first_10_chapter_plan ===
# 前10章规划

## 1. 黄金三章目标
### 第1章
- 主钩子类型：
- 前500字冲突：
- 主角困境：
- 章节结尾钩子：

### 第2章
- 核心功能：
- 金手指/核心差异如何展示：
- 阻碍如何升级：
- 章节结尾钩子：

### 第3章
- 核心功能：
- 长期目标如何明确：
- 第一个阶段敌人如何出现：
- 章节结尾钩子：

## 2. 前10章章节表
| 章数 | 章节功能 | 情绪事件 | 主角目标 | 阻碍困境 | 解决方法 | 爽点/反转 | 结尾钩子 |
|---|---|---|---|---|---|---|---|

要求：每章都有明确目标、阻碍和结尾钩子；至少 3 章有小爽点；至少 2 章有反转；第10章必须形成阶段性局势变化。

## 3. 前10章反派压力安排
说明核心反派或阶段反派的压力如何逐步显现，不能让反派直接无脑送经验。

## 4. 前10章伏笔安排
| 伏笔 | 埋设章节 | 表层表现 | 真实含义 | 预计回收章节 |
|---|---|---|---|---|

## 5. 前10章追读风险
列出可能导致读者流失的风险，并给出规避策略。`;
  }

  private buildStructureSignalsPrompt(language: "zh" | "en"): string {
    if (language === "en") {
      return `# Structure Signals

Generate a JSON object containing book-specific structure signal phrases for each dimension below.
These phrases will be used by automated reviewers to check whether chapters meet structural requirements.
Each phrase should be a concrete word or short phrase (2-8 characters in Chinese, 1-3 words in English)
that can be literally matched in chapter text.

IMPORTANT: Read the "题材特征" (Genre Profile) section above — especially the "Structure Signal Generation Guidance" — to understand genre-specific structural pressures.
Then synthesize with this book's story outline, world-building, protagonist goals, resource system, and chapter plans
to produce phrases UNIQUE to THIS book. DO NOT copy generic genre-level descriptions as final signals.
Every phrase must contain this book's specific character names, location names, system terms, or unique concepts.

Output ONLY valid JSON. Do NOT wrap it in markdown code fences. Do NOT add explanations before or after it:

{
  "signals": {
    "opening_hook": ["phrase1", "phrase2", ...],
    "protagonist_goal": ["phrase1", "phrase2", ...],
    "pressure_source": ["phrase1", "phrase2", ...],
    "obstacle_dilemma": ["phrase1", "phrase2", ...],
    "solution_possibility": ["phrase1", "phrase2", ...],
    "active_attempt": ["phrase1", "phrase2", ...],
    "payoff_reward": ["phrase1", "phrase2", ...],
    "ending_pull": ["phrase1", "phrase2", ...],
    "antagonist_pressure": ["phrase1", "phrase2", ...],
    "resource_reward": ["phrase1", "phrase2", ...],
    "world_rule": ["phrase1", "phrase2", ...],
    "forbidden_false_positive": ["phrase1", "phrase2", ...]
  }
}

Rules:
- Each array MUST contain 3-8 concrete phrases specific to THIS book's world, characters, and conflict.
- "opening_hook": phrases that signal strong chapter openings (conflict, suspense, emotion, contrast).
- "protagonist_goal": phrases that signal the protagonist has a clear objective.
- "pressure_source": phrases that signal external pressure or threat sources.
- "obstacle_dilemma": phrases that signal a dilemma or hard choice.
- "solution_possibility": phrases that signal a potential solution, clue, or method.
- "active_attempt": phrases that signal the protagonist taking action.
- "payoff_reward": phrases that signal a reward, gain, or progress.
- "ending_pull": phrases that signal a cliffhanger or reason to continue reading.
- "antagonist_pressure": phrases that signal antagonist activity or threat.
- "resource_reward": phrases that signal resource gain, exchange, or consumption.
- "world_rule": phrases that signal world rules being invoked or explained.
- "forbidden_false_positive": phrases that should NOT count as structure signals (common words that might falsely trigger reviewers).
- Do NOT use generic words. Use phrases specific to this book's setting, power system, character names, and unique concepts.
- Phrases should be matchable in chapter text.`;
    }

    return `# 书级结构信号

生成一个 JSON 对象，为以下每个维度提供本书专属的结构信号短语。
这些短语将用于自动化审稿程序，检查章节是否满足结构要求。
每个短语应为可在章节正文中直接匹配的具体词语或短语（2-8字）。

重要：请先阅读上方"题材特征"部分——特别是其中的"Structure Signal Generation Guidance"——以了解该题材的常见结构压力。
然后将这些题材级指导与本书的故事大纲、世界观、主角目标、资源系统和章节规划结合，
生成只属于"本书"的专属短语。禁止直接复制题材 profile 中的泛化描述作为最终信号。
每个短语必须包含本书具体的人物名、地名、系统术语或独特概念。

只输出合法 JSON。不要使用 markdown 代码块，不要在 JSON 前后添加解释文字：

{
  "signals": {
    "opening_hook": ["短语1", "短语2", ...],
    "protagonist_goal": ["短语1", "短语2", ...],
    "pressure_source": ["短语1", "短语2", ...],
    "obstacle_dilemma": ["短语1", "短语2", ...],
    "solution_possibility": ["短语1", "短语2", ...],
    "active_attempt": ["短语1", "短语2", ...],
    "payoff_reward": ["短语1", "短语2", ...],
    "ending_pull": ["短语1", "短语2", ...],
    "antagonist_pressure": ["短语1", "短语2", ...],
    "resource_reward": ["短语1", "短语2", ...],
    "world_rule": ["短语1", "短语2", ...],
    "forbidden_false_positive": ["短语1", "短语2", ...]
  }
}

规则：
- 每个数组必须包含 3-8 个具体短语，专属于本书的世界观、角色和冲突。
- "opening_hook"：标志强烈章节开头的短语（冲突、悬念、情绪、反差）。
- "protagonist_goal"：标志主角有明确目标的短语。
- "pressure_source"：标志外部压力或威胁来源的短语。
- "obstacle_dilemma"：标志两难困境或艰难选择的短语。
- "solution_possibility"：标志潜在解决方案、线索或方法的短语。
- "active_attempt"：标志主角采取行动的短语。
- "payoff_reward"：标志奖励、收获或进展的短语。
- "ending_pull"：标志悬念或继续阅读动力的短语。
- "antagonist_pressure"：标志反派活动或威胁的短语。
- "resource_reward"：标志资源获取、交换或消耗的短语。
- "world_rule"：标志世界规则被调用或解释的短语。
- "forbidden_false_positive"：不应被计为结构信号的短语（可能误触发审稿的常见词）。
- 禁止使用泛化词汇。必须使用本书独有设定、战力体系、角色名和特色概念。
- 每个短语必须能在正文中直接匹配到。`;
  }

  private contentOrFallback(
    content: string | undefined,
    section: StorySkeletonSection,
    language: "zh" | "en",
  ): string {
    const trimmed = content?.trim();
    if (trimmed) return trimmed;
    return this.buildStorySkeletonFallback(section, language);
  }

  private buildStorySkeletonFallback(
    section: StorySkeletonSection,
    language: "zh" | "en",
  ): string {
    const title = STORY_SKELETON_TITLES[section][language];
    const template = STORY_SKELETON_FALLBACK_TEMPLATES[section][language];
    if (language === "en") {
      return `# ${title}

> Generated by inkos 2.0 create-stage fallback.
> Reason: the LLM did not return the corresponding section.
> You can regenerate the foundation or complete this file manually later.

${template}`;
    }

    return `# ${title}

> 本文件由 inkos 2.0 create 阶段 fallback 生成。
> 原因：LLM 未返回对应 section。
> 后续可通过重新生成骨架或人工补全。

${template}`;
  }

  /**
   * Reverse-engineer foundation from existing chapters.
   * Reads all chapters as a single text block and asks LLM to extract story_bible,
   * volume_outline, book_rules, current_state, and pending_hooks.
   */
  async generateFoundationFromImport(
    book: BookConfig,
    chaptersText: string,
    externalContext?: string,
    reviewFeedback?: string,
    options?: { readonly importMode?: "continuation" | "series" },
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const resolvedLanguage = book.language ?? gp.language;
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, resolvedLanguage);

    const contextBlock = externalContext
      ? (resolvedLanguage === "en"
          ? `\n\n## External Instructions\n${externalContext}\n`
          : `\n\n## 外部指令\n${externalContext}\n`)
      : "";

    const numericalBlock = gp.numericalSystem
      ? (resolvedLanguage === "en"
          ? `- The story uses a trackable numerical/resource system
- Define numericalSystemOverrides in book_rules (hardCap, resourceTypes)`
          : `- 有明确的数值/资源体系可追踪
- 在 book_rules 中定义 numericalSystemOverrides（hardCap、resourceTypes）`)
      : (resolvedLanguage === "en"
          ? "- This genre has no explicit numerical system and does not need a resource ledger"
          : "- 本题材无数值系统，不需要资源账本");

    const powerBlock = gp.powerScaling
      ? (resolvedLanguage === "en" ? "- The story has an explicit power-scaling ladder" : "- 有明确的战力等级体系")
      : "";

    const eraBlock = gp.eraResearch
      ? (resolvedLanguage === "en"
          ? "- The story needs era/historical grounding (set eraConstraints in book_rules)"
          : "- 需要年代考据支撑（在 book_rules 中设置 eraConstraints）")
      : "";

    const storyBiblePrompt = resolvedLanguage === "en"
      ? `Extract from the source text and organize with structured second-level headings:
## 01_Worldview
Extracted world setting, core rules, and frame

## 02_Protagonist
Inferred protagonist setup (identity / advantage / personality core / behavioral boundaries)

## 03_Factions_and_Characters
Factions and important supporting characters that appear in the source text

## 04_Geography_and_Environment
Locations, environments, and scene traits drawn from the source text

## 05_Title_and_Blurb
Keep the original title "${book.title}" and generate a matching blurb from the source text`
      : `从正文中提取，用结构化二级标题组织：
## 01_世界观
从正文中提取的世界观设定、核心规则体系

## 02_主角
从正文中推断的主角设定（身份/金手指/性格底色/行为边界）

## 03_势力与人物
从正文中出现的势力分布、重要配角（每人：名字、身份、动机、与主角关系、独立目标）

## 04_地理与环境
从正文中出现的地图/场景设定、环境特色

## 05_书名与简介
保留原书名"${book.title}"，根据正文内容生成简介`;

    const volumeOutlinePrompt = resolvedLanguage === "en"
      ? `Infer the volume plan from existing text:
- Existing chapters: review the actual structure already present
- Future projection: predict later directions from active hooks and plot momentum
For each volume include: title, chapter range, core conflict, and key turning points`
      : `基于已有正文反推卷纲：
- 已有章节部分：根据实际内容回顾每卷的结构
- 后续预测部分：基于已有伏笔和剧情走向预测未来方向
每卷包含：卷名、章节范围、核心冲突、关键转折`;

    const bookRulesPrompt = resolvedLanguage === "en"
      ? `Infer book_rules.md as YAML frontmatter plus narrative guidance from character behavior in the source text:
\`\`\`
---
version: "1.0"
protagonist:
  name: (extract protagonist name from the text)
  personalityLock: [(infer 3-5 personality keywords from behavior)]
  behavioralConstraints: [(infer 3-5 behavioral constraints from behavior)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3 forbidden style intrusions)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (infer from the text)
  resourceTypes: [(extract core resource types from the text)]` : ""}
prohibitions:
  - (infer 3-5 book-specific prohibitions from the text)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## Narrative Perspective
(Infer the narrative perspective and style from the text)

## Core Conflict Driver
(Infer the book's core conflict and propulsion from the text)
\`\`\``
      : `从正文中角色行为反推 book_rules.md 格式的 YAML frontmatter + 叙事指导：
\`\`\`
---
version: "1.0"
protagonist:
  name: (从正文提取主角名)
  personalityLock: [(从行为推断3-5个性格关键词)]
  behavioralConstraints: [(从行为推断3-5条行为约束)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3种禁止混入的文风)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (从正文推断)
  resourceTypes: [(从正文提取核心资源类型)]` : ""}
prohibitions:
  - (从正文推断3-5条本书禁忌)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---

## 叙事视角
(从正文推断本书叙事视角和风格)

## 核心冲突驱动
(从正文推断本书的核心矛盾和驱动力)
\`\`\``;

    const currentStatePrompt = resolvedLanguage === "en"
      ? `Reflect the state at the end of the latest chapter:
| Field | Value |
| --- | --- |
| Current Chapter | (latest chapter number) |
| Current Location | (location at the end of the latest chapter) |
| Protagonist State | (state at the end of the latest chapter) |
| Current Goal | (current goal) |
| Current Constraint | (current constraint) |
| Current Alliances | (current alliances / opposition) |
| Current Conflict | (current conflict) |`
      : `反映最后一章结束时的状态卡：
| 字段 | 值 |
|------|-----|
| 当前章节 | (最后一章章节号) |
| 当前位置 | (最后一章结束时的位置) |
| 主角状态 | (最后一章结束时的状态) |
| 当前目标 | (当前目标) |
| 当前限制 | (当前限制) |
| 当前敌我 | (当前敌我关系) |
| 当前冲突 | (当前冲突) |`;

    const pendingHooksPrompt = resolvedLanguage === "en"
      ? `Identify all active hooks from the source text (Markdown table):
| hook_id | start_chapter | type | status | latest_progress | expected_payoff | payoff_timing | notes |`
      : `从正文中识别的所有伏笔（Markdown表格）：
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 备注 |`;

    const keyPrinciplesPrompt = resolvedLanguage === "en"
      ? `## Key Principles

1. Derive everything from the source text; do not invent unsupported settings
2. Hook extraction must be complete: unresolved clues, hints, and foreshadowing all count
3. Character inference must come from dialogue and behavior, not assumption
4. Accuracy first; detailed is better than missing crucial information
${numericalBlock}
${powerBlock}
${eraBlock}`
      : `## 关键原则

1. 一切从正文出发，不要臆造正文中没有的设定
2. 伏笔识别要完整：悬而未决的线索、暗示、预告都算
3. 角色推断要准确：从对话和行为推断性格，不要想当然
4. 准确性优先，宁可详细也不要遗漏
${numericalBlock}
${powerBlock}
${eraBlock}`;

    const isSeries = options?.importMode === "series";
    const continuationDirectiveEn = isSeries
      ? `## Continuation Direction Requirements (Critical)
The continuation portion (chapters in volume_outline that have not happened yet) must open up **new narrative space**:
1. **New conflict dimension**: Do not merely stretch the imported conflict longer. Introduce at least one new conflict vector not yet covered by the source text (new character, new faction, new location, or new time horizon)
2. **Ignite within 5 chapters**: The first continuation volume must establish a fresh suspense engine within 5 chapters. Do not spend 3 chapters recapping known information
3. **Scene freshness**: At least 50% of key continuation scenes must happen in locations or situations not already used in the imported chapters
4. **No repeated meeting rooms**: If the imported chapters end on a meeting/discussion beat, the continuation must restart from action instead of opening another meeting`
      : `## Continuation Direction
The volume_outline should naturally extend the existing narrative arc. Continue from where the imported chapters left off — advance existing conflicts, pay off planted hooks, and introduce new complications that arise organically from the current situation. Do not recap known information.`;
    const continuationDirectiveZh = isSeries
      ? `## 续写方向要求（关键）
续写部分（volume_outline 中尚未发生的章节）必须设计**新的叙事空间**：
1. **新冲突维度**：续写不能只是把导入章节的冲突继续拉长。必须引入至少一个原文未涉及的新冲突方向（新角色、新势力、新地点、新时间跨度）
2. **5章内引爆**：续写的第一卷必须在前5章内建立新悬念，不允许用3章回顾已知信息
3. **场景新鲜度**：续写部分至少50%的关键场景发生在导入章节未出现的地点或情境中
4. **不重复会议**：如果导入章节以会议/讨论结束，续写必须从行动开始，不能再开一轮会`
      : `## 续写方向
卷纲应自然延续已有叙事弧线。从导入章节的结尾处接续——推进现有冲突、兑现已埋伏笔、引入从当前局势中有机产生的新变数。不要回顾已知信息。`;

    const workingModeEn = isSeries
      ? `## Working Mode

This is not a zero-to-one foundation pass. You must extract durable story truth from the imported chapters **and design a continuation path**. You need to:
1. Extract worldbuilding, factions, characters, and systems from the source text -> generate story_bible
2. Infer narrative structure and future arc direction -> generate volume_outline (review existing chapters + design a **new continuation direction**)
3. Infer protagonist lock, prohibitions, and narrative constraints from character behavior -> generate book_rules
4. Reflect the latest chapter state -> generate current_state
5. Extract all active hooks already planted in the text -> generate pending_hooks`
      : `## Working Mode

This is not a zero-to-one foundation pass. You must extract durable story truth from the imported chapters **and preserve a clean continuation path**. You need to:
1. Extract worldbuilding, factions, characters, and systems from the source text -> generate story_bible
2. Infer narrative structure and near-future arc direction -> generate volume_outline (review existing chapters + continue naturally from where the imported chapters stop)
3. Infer protagonist lock, prohibitions, and narrative constraints from character behavior -> generate book_rules
4. Reflect the latest chapter state -> generate current_state
5. Extract all active hooks already planted in the text -> generate pending_hooks`;
    const workingModeZh = isSeries
      ? `## 工作模式

这不是从零创建，而是从已有正文中提取和推导，**并设计续写方向**。你需要：
1. 从正文中提取世界观、势力、角色、力量体系 → 生成 story_bible
2. 从叙事结构推断卷纲 → 生成 volume_outline（已有章节的回顾 + **续写部分的新方向设计**）
3. 从角色行为推断主角锁定和禁忌 → 生成 book_rules
4. 从最新章节状态推断 current_state（反映最后一章结束时的状态）
5. 从正文中识别已埋伏笔 → 生成 pending_hooks`
      : `## 工作模式

这不是从零创建，而是从已有正文中提取和推导，**并为自然续写保留清晰延续路径**。你需要：
1. 从正文中提取世界观、势力、角色、力量体系 → 生成 story_bible
2. 从叙事结构推断卷纲 → 生成 volume_outline（回顾已有章节，并从导入章节结束处自然接续）
3. 从角色行为推断主角锁定和禁忌 → 生成 book_rules
4. 从最新章节状态推断 current_state（反映最后一章结束时的状态）
5. 从正文中识别已埋伏笔 → 生成 pending_hooks`;

    const systemPrompt = resolvedLanguage === "en"
      ? `You are a professional web-fiction architect. Your task is to reverse-engineer a complete foundation from existing chapters.${contextBlock}

${workingModeEn}

All output sections — story_bible, volume_outline, book_rules, current_state, and pending_hooks — MUST be written in English. Keep the === SECTION: === tags unchanged.

${continuationDirectiveEn}
${reviewFeedbackBlock}
## Book Metadata

- Title: ${book.title}
- Platform: ${book.platform}
- Genre: ${gp.name} (${book.genre})
- Target Chapters: ${book.targetChapters}
- Chapter Target Length: ${book.chapterWordCount}

## Genre Profile

${genreBody}

## Output Contract

Generate the following sections. Separate every section with === SECTION: <name> ===:

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${keyPrinciplesPrompt}`
      : `你是一个专业的网络小说架构师。你的任务是从已有的小说正文中反向推导完整的基础设定。${contextBlock}

${workingModeZh}

${continuationDirectiveZh}
${reviewFeedbackBlock}
## 书籍信息

- 标题：${book.title}
- 平台：${book.platform}
- 题材：${gp.name}（${book.genre}）
- 目标章数：${book.targetChapters}章
- 每章字数：${book.chapterWordCount}字

## 题材特征

${genreBody}

## 生成要求

你需要生成以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: story_bible ===
${storyBiblePrompt}

=== SECTION: volume_outline ===
${volumeOutlinePrompt}

=== SECTION: book_rules ===
${bookRulesPrompt}

=== SECTION: current_state ===
${currentStatePrompt}

=== SECTION: pending_hooks ===
${pendingHooksPrompt}

${keyPrinciplesPrompt}`;
    const userMessage = resolvedLanguage === "en"
      ? `Generate the complete foundation for an imported ${gp.name} novel titled "${book.title}". Write everything in English.\n\n${chaptersText}`
      : `以下是《${book.title}》的全部已有正文，请从中反向推导完整基础设定：\n\n${chaptersText}`;

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userMessage,
      },
    ], { temperature: 0.5, maxTokens: 16384 });

    return this.parseSections(response.content);
  }

  async generateFanficFoundation(
    book: BookConfig,
    fanficCanon: string,
    fanficMode: FanficMode,
    reviewFeedback?: string,
  ): Promise<ArchitectOutput> {
    const { profile: gp, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const reviewFeedbackBlock = this.buildReviewFeedbackBlock(reviewFeedback, book.language ?? "zh");

    const MODE_INSTRUCTIONS: Record<FanficMode, string> = {
      canon: "剧情发生在原作空白期或未详述的角度。不可改变原作已确立的事实。",
      au: "标注AU设定与原作的关键分歧点，分歧后的世界线自由发展。保留角色核心性格。",
      ooc: "标注角色性格偏离的起点和驱动事件。偏离必须有逻辑驱动。",
      cp: "以配对角色的关系线为主线规划卷纲。每卷必须有关系推进节点。",
    };

    const systemPrompt = `你是一个专业的同人小说架构师。你的任务是基于原作正典为同人小说生成基础设定。

## 同人模式：${fanficMode}
${MODE_INSTRUCTIONS[fanficMode]}

## 新时空要求（关键）
你必须为这本同人设计一个**原创的叙事空间**，而不是复述原作剧情。具体要求：
1. **明确分岔点**：story_bible 必须标注"本作从原作的哪个节点分岔"，或"本作发生在原作未涉及的什么时空"
2. **独立核心冲突**：volume_outline 的核心冲突必须是原创的，不是原作情节的翻版。原作角色可以出现，但他们面对的是新问题
3. **5章内引爆**：volume_outline 的第1卷必须在前5章内建立核心悬念，不允许用3章做铺垫才到引爆点
4. **场景新鲜度**：至少50%的关键场景发生在原作未出现的地点或情境中

${reviewFeedbackBlock}

## 原作正典
${fanficCanon}

## 题材特征
${genreBody}

## 关键原则
1. **不发明主要角色** — 主要角色必须来自原作正典的角色档案
2. 可以添加原创配角，但必须在 story_bible 中标注为"原创角色"
3. story_bible 保留原作世界观，标注同人的改动/扩展部分，并明确写出**分岔点**和**新时空设定**
4. volume_outline 不得复述原作剧情节拍。每卷的核心事件必须是原创的，标注"原创"
5. book_rules 的 fanficMode 必须设为 "${fanficMode}"
6. 主角设定来自原作角色档案中的第一个角色（或用户在标题中暗示的角色）

你需要生成以下内容，每个部分用 === SECTION: <name> === 分隔：

=== SECTION: story_bible ===
世界观（基于原作正典）+ 角色列表（原作角色标注来源，原创角色标注"原创"）

=== SECTION: volume_outline ===
卷纲规划。每卷标注：卷名、章节范围、核心事件（标注原作/原创）、关系发展节点

=== SECTION: book_rules ===
\`\`\`
---
version: "1.0"
protagonist:
  name: (从原作角色中选择)
  personalityLock: [(从正典角色档案提取)]
  behavioralConstraints: [(基于原作行为模式)]
genreLock:
  primary: ${book.genre}
  forbidden: []
fanficMode: "${fanficMode}"
allowedDeviations: []
prohibitions:
  - (3-5条同人特有禁忌)
---
(叙事视角和风格指导)
\`\`\`

=== SECTION: current_state ===
初始状态卡（基于正典起始点）

=== SECTION: pending_hooks ===
初始伏笔池（从正典关键事件和关系中提取）`;

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `请为标题为"${book.title}"的${fanficMode}模式同人小说生成基础设定。目标${book.targetChapters}章，每章${book.chapterWordCount}字。`,
      },
    ], { temperature: 0.7, maxTokens: 16384 });

    return this.parseSections(response.content);
  }

  private buildReviewFeedbackBlock(
    reviewFeedback: string | undefined,
    language: "zh" | "en",
  ): string {
    const trimmed = reviewFeedback?.trim();
    if (!trimmed) return "";

    if (language === "en") {
      return `\n\n## Previous Review Feedback
The previous foundation draft was rejected. You must explicitly fix the following issues in this regeneration instead of paraphrasing the same design:

${trimmed}\n`;
    }

    return `\n\n## 上一轮审核反馈
上一轮基础设定未通过审核。你必须在这次重生中明确修复以下问题，不能只换措辞重写同一套方案：

${trimmed}\n`;
  }

  private parseSections(content: string): ArchitectOutput {
    const parsedSections = new Map<string, string>();
    const sectionPattern = /^\s*===\s*SECTION\s*[：:]\s*([^\n=]+?)\s*===\s*$/gim;
    const matches = [...content.matchAll(sectionPattern)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const rawName = match[1] ?? "";
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[i + 1]?.index ?? content.length;
      const normalizedName = this.normalizeSectionName(rawName);
      parsedSections.set(normalizedName, content.slice(start, end).trim());
    }

    const extract = (name: string): string => {
      const section = parsedSections.get(this.normalizeSectionName(name));
      if (!section) {
        throw new Error(`Architect output missing required section: ${name}`);
      }
      if (name !== "pending_hooks") {
        return section;
      }
      return this.normalizePendingHooksSection(this.stripTrailingAssistantCoda(section));
    };

    return {
      storyBible: extract("story_bible"),
      volumeOutline: extract("volume_outline"),
      bookRules: extract("book_rules"),
      currentState: extract("current_state"),
      pendingHooks: extract("pending_hooks"),
      genreArchitecture: parsedSections.get(this.normalizeSectionName("genre_architecture")),
      worldEngine: parsedSections.get(this.normalizeSectionName("world_engine")),
      antagonistMap: parsedSections.get(this.normalizeSectionName("antagonist_map")),
      motivationMatrix: parsedSections.get(this.normalizeSectionName("motivation_matrix")),
      first10ChapterPlan: parsedSections.get(this.normalizeSectionName("first_10_chapter_plan")),
      structureSignals: parsedSections.get(this.normalizeSectionName("structure_signals")),
    };
  }

  private normalizeSectionName(name: string): string {
    return name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[`"'*_]/g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private stripTrailingAssistantCoda(section: string): string {
    const lines = section.split("\n");
    const cutoff = lines.findIndex((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return /^(如果(?:你愿意|需要|想要|希望)|If (?:you(?:'d)? like|you want|needed)|I can (?:continue|next))/i.test(trimmed);
    });

    if (cutoff < 0) {
      return section;
    }

    return lines.slice(0, cutoff).join("\n").trimEnd();
  }

  private normalizePendingHooksSection(section: string): string {
    const rows = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"))
      .filter((line) => !line.includes("---"))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
      .filter((cells) => cells.some(Boolean));

    if (rows.length === 0) {
      return section;
    }

    const dataRows = rows.filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");
    if (dataRows.length === 0) {
      return section;
    }

    const language: "zh" | "en" = /[\u4e00-\u9fff]/.test(section) ? "zh" : "en";
    const normalizedHooks = dataRows.map((row, index) => {
      const rawProgress = row[4] ?? "";
      const normalizedProgress = this.parseHookChapterNumber(rawProgress);
      const seedNote = normalizedProgress === 0 && this.hasNarrativeProgress(rawProgress)
        ? (language === "zh" ? `初始线索：${rawProgress}` : `initial signal: ${rawProgress}`)
        : "";
      const notes = this.mergeHookNotes(row[6] ?? "", seedNote, language);

      return {
        hookId: row[0] || `hook-${index + 1}`,
        startChapter: this.parseHookChapterNumber(row[1]),
        type: row[2] ?? "",
        status: row[3] ?? "open",
        lastAdvancedChapter: normalizedProgress,
        expectedPayoff: row[5] ?? "",
        payoffTiming: row.length >= 8 ? row[6] ?? "" : "",
        notes: row.length >= 8 ? this.mergeHookNotes(row[7] ?? "", seedNote, language) : notes,
      };
    });

    return renderHookSnapshot(normalizedHooks, language);
  }

  private parseHookChapterNumber(value: string | undefined): number {
    if (!value) return 0;
    const match = value.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  private hasNarrativeProgress(value: string | undefined): boolean {
    const normalized = (value ?? "").trim().toLowerCase();
    if (!normalized) return false;
    return !["0", "none", "n/a", "na", "-", "无", "未推进"].includes(normalized);
  }

  private mergeHookNotes(notes: string, seedNote: string, language: "zh" | "en"): string {
    const trimmedNotes = notes.trim();
    const trimmedSeed = seedNote.trim();
    if (!trimmedSeed) {
      return trimmedNotes;
    }
    if (!trimmedNotes) {
      return trimmedSeed;
    }
    return language === "zh"
      ? `${trimmedNotes}（${trimmedSeed}）`
      : `${trimmedNotes} (${trimmedSeed})`;
  }
}
