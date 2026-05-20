# inkos 2.0：故事性大升级总体规划

## 1. 大升级背景

inkos 2.0：故事性大升级，是把六份网文方法论合并成一个“网文生产操作系统”。本次升级不以堆叠写作知识为目标，而是把网文生产中可复用、可审查、可执行的故事性经验沉淀为流程约束、结构化数据、审核报告和发布前质量门。

当前 inkos 已经在 create 阶段一次 LLM 生成多个 SECTION，并通过 FoundationReviewerAgent 对核心冲突、开篇节奏、世界一致性、角色区分度、节奏可行性进行审核。这个基础已经能判断故事骨架“有没有关键部件”，但还不足以保证连载过程中持续产出好看的网文。

## 2. 核心问题

当前核心问题是：审核的是“有没有”，不是“能不能持续产出好看的网文”。

因此 inkos 2.0 的设计目标，是让故事技巧从提示词里的知识，变成系统流程中的约束：

- 生成前有明确目标；
- 生成中有稳定结构；
- 生成后有可追踪审核；
- 审核失败能定位到程序逻辑、Prompt、数据结构、状态传递或模型输出解析；
- 发布前能判断章节是否真的适合番茄连载。

## 3. 六份方法论如何转成系统约束

六份方法论不是独立文档堆叠，而是映射为 inkos 的流程约束：

- 开头钩子：转成 `first_chapter_hook_check`，检查悬念、反差、矛盾前置、世界观炸弹、极致情绪是否形成前期留存。
- 高智商反派：转成 `antagonist_intelligence_check`，检查谋局者、殉道者、伪态者是否具有主动目标、策略能力和压力制造能力。
- 万能转场：转成 `transition_quality_check`，检查情绪延续、钩子引导、环境暗示、以动带进是否支撑章节衔接。
- 六招心法：转成 `chapter_intent_schema`，确保每章具备情绪事件、欲望目标、阻碍、解法、高潮、反馈。
- 世界观三逻辑：转成 `world_engine_schema`，确保稀缺、链式反应、文明共识持续制造冲突。
- 当前 inkos 骨架：承接为 `story_bible`、`volume_outline`、`book_rules`、`current_state`、`pending_hooks` 等控制文档。

## 4. 七层系统架构

### 4.1 题材架构层

目标：决定这本书卖什么、爽什么、钩什么读者。

输入：用户设定、题材方向、平台风险约束、番茄读者偏好。

输出：`genre_architecture.md`、题材卖点、爽点曲线、风险标签、目标读者承诺。

约束：题材承诺必须能被前十章兑现；不能依赖抽象概念替代可见冲突；必须规避平台发布风险。

典型文件：`genre_architecture.md`、`book_rules`、发布风险检查结果。

### 4.2 世界发动机层

目标：决定冲突为什么源源不断地产生。

输入：世界观设定、资源稀缺、势力结构、文明共识、主角初始处境。

输出：`world_engine.md`、稀缺机制、链式反应规则、文明共识压力源。

约束：冲突不能只靠作者临时安排；资源、制度、身份、势力必须能自然产生持续压力。

典型文件：`world_engine.md`、`story_bible`、`current_state`。

### 4.3 人物发动机层

目标：决定主角、反派、配角为什么必须行动。

输入：人物身份、核心欲望、利益关系、敌我结构、阶段压力。

输出：`antagonist_map.md`、`motivation_matrix.md`、主角目标链、反派策略链。

约束：人物行动必须源自欲望、压力、误判、利益或信念；反派不能只做剧情工具人。

典型文件：`antagonist_map.md`、`motivation_matrix.md`、角色区分度审核报告。

### 4.4 连载规划层

目标：决定前期留存和中期升级路线。

输入：题材架构、世界发动机、人物发动机、卷目标、平台节奏。

输出：`volume_outline.md`、`first_10_chapter_plan.md`、阶段钩子、升级路线。

约束：前期必须有明确留存钩子，中期必须有可持续升级路径，章节之间不能只靠事件列表串联。

典型文件：`volume_outline.md`、`first_10_chapter_plan.md`、`pending_hooks`。

### 4.5 章节生成层

目标：决定每章是否有情绪、目标、阻碍、解法、高潮、反馈。

输入：`chapter_intent`、Resource Plan、上一章状态、pending hooks、当前卷计划。

输出：`chapter_draft`、章节正文、章节意图卡、资源计划执行结果。

约束：正文必须服务 chapter_intent；资源变化必须由 Resource Engine 或明确 closure 语义支撑；LLM 不得临时发明收益、消耗或余额。

典型文件：`chapter_intent`、`chapter_draft`、Resource Plan、Resource Engine 分析结果。

### 4.6 审稿增强层

目标：决定章节是否真的适合发布。

输入：章节正文、chapter_intent、current_state、resource ledger、故事控制文档。

输出：continuity、hook、antagonist、transition、fanqie-style、resource consistency、chapter intent consistency 等审核报告。

约束：审核必须识别故事性风险和系统一致性风险；资源未闭合不得 ready-for-review；no-change 章节必须区分“无变化已闭合”和“检查缺失”。

典型文件：continuity report、publish-ready report、resource consistency report、chapter intent consistency report。

### 4.7 发布优化层

目标：决定最终呈现是否适合番茄。

输入：审稿增强层结果、章节正文、发布信息、导出配置、平台风格要求。

输出：publish-ready、fanqie-polish、export-fanqie、book-info 发布信息优化结果。

约束：发布前必须汇总故事性风险、资源闭合状态、平台风险和番茄风格适配；不得用导出或润色掩盖系统性缺陷。

典型文件：publish-ready report、fanqie-polish 输出、export-fanqie txt、book-info 优化结果。

## 5. 已完成任务如何落到七层架构中

- 任务一沉淀 story-methods 方法论知识库：支撑七层架构的理论来源。
- 任务二增强 create 阶段故事骨架：主要落在题材架构层、世界发动机层、人物发动机层、连载规划层。
- 任务三增强 FoundationReviewerAgent：主要落在审稿增强层，提升故事发动机质量审核。
- 任务二点五、二点六 create 反哺旧控制文档与结构化：打通 create 输出到当前 inkos 骨架。
- 任务三点五、三点五点一题材安全与发布风险：支撑题材架构层和发布优化层。
- 任务四、四点一、四点二 chapter_intent：建立章节生成层的意图卡优先级。
- 任务五 V1 chapter_intent 与正文一致性审核：打通章节生成层和审稿增强层。
- 任务五点一到五点四点九：建立 Resource Engine、Resource Recovery、fallback patch、clean-narrative、现金流语义检测等资源一致性机制。
- 任务五点五：将 Resource Plan 前置注入 chapter_intent / writer，避免先写错再后修。
- 任务五点七：将 Resource Plan 通用化并识别章节阶段。

## 6. 当前任务五点七 B 的位置

任务五点七 B：No-Change Resource Closure 无资源变化章节的资源闭合机制，位于章节生成层、审稿增强层和发布优化层的交界处。

它不是新的写作技巧任务，而是 Resource Engine 机制的闭环补强：当章节没有资源变化时，系统必须明确判断为“无资源变化但资源闭合”，而不是误判为资源检查缺失、BLOCKED、WARN，或诱导 LLM 临时补写收益、消耗、余额声明。

## 7. Resource Engine 与故事性升级的关系

Resource Engine 是系统流小说的确定性数值底座。它防止数值污染、资源闭合失败、LLM 乱编收益/消耗，并让系统流爽点建立在可信账本上。

Resource Engine 服务于：

- 章节生成层：让 chapter_intent / writer 在写作前知道资源边界。
- 审稿增强层：让 resource consistency 能判断资源是否闭合。
- 发布优化层：让 publish-ready 和 export 前不会携带数值污染。

系统流小说的爽感依赖“获得、消耗、升级、限制、反转”的可信度。资源账本不可信，故事性会直接坍塌。

## 8. No-Change Resource Closure 的设计目标

No-Change Resource Closure 的目标是：

- 区分“没有资源变化”与“资源检查缺失”；
- 对无资源变化章节输出明确 closure 结论；
- 不让 no-change 章节误触发 BLOCKED / WARN；
- 不允许 LLM 临时补写收益、消耗或余额声明；
- 不直接修改业务输出章节；
- 通过程序逻辑和报告语义解决问题；
- 确保后续 publish-ready、continuity、review、export 不被 no-change 缺失报告污染。

## 9. 后续方向

后续升级方向包括：

- publish-ready 接入故事性风险摘要；
- story-effectiveness review 与 Resource Engine / chapter_intent 的衔接复核；
- golden_3_chapter_review 第一章/前三章发布转化检查；
- opening-hook-reviewer、antagonist-intelligence-reviewer、transition-quality-reviewer、six-step-plot-reviewer 增强；
- 短故事 LLM 化复用故事发动机；
- book-info 发布信息优化。

## 10. 01_design.md 受控变更原则

`.ai_workflow/01_design.md` 是 inkos 2.0：故事性大升级的总体规划文件，是 `02_todo.md`、`03_prompt.txt`、preflight、review 的最高依据。

常规研发循环中不得修改 `01_design.md`。Codex 常规 review 后只能更新 `02_todo.md`、`03_prompt.txt`、`00_state.json`、`reports`、`runs`。

只有用户明确发起“设计变更任务”时，Codex 才允许修改 `01_design.md`。设计变更必须单独走流程：

1. 提出 design change proposal；
2. 说明为什么现有 design 不足；
3. 列出拟修改章节；
4. 说明对 todo、prompt、测试、真实验证的影响；
5. 等用户确认后才允许正式修改 `01_design.md`。

如果任何任务在未授权情况下要求修改 `01_design.md`，Claude preflight 必须 `REJECT_NEEDS_REWRITE`。如果执行结果中未授权修改了 `01_design.md`，Codex review 必须判定 `FAIL`。

## 11. 本地多 AI 协作机制定位

`.ai_workflow` 只是本地多 AI 协作的承载层，不是业务主线。本项目真正的业务主线始终是 inkos 2.0：故事性大升级。

README、模板、reports、runs 用于承载 Codex / Claude Code / 用户的协作流程；它们必须服务于本设计，而不能把“建设 AI 协作系统”变成本轮研发目标。
