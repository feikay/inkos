# inkos 2.0：故事性大升级 TODO

## 1. 总体路线

inkos 2.0：故事性大升级的路线，是把网文方法论转成七层系统架构中的可执行约束：题材架构层、世界发动机层、人物发动机层、连载规划层、章节生成层、审稿增强层、发布优化层。

所有任务必须能追溯到 `.ai_workflow/01_design.md` 的设计目标。`01_design.md` 是最高设计依据，常规研发循环不得修改。

## 2. 已完成任务

1. inkos 2.0 任务一——沉淀 story-methods 方法论知识库  
   Design Anchor：六份方法论如何转成系统约束；七层系统架构全局支撑。
2. inkos 2.0 任务二——增强 create 阶段故事骨架  
   Design Anchor：题材架构层、世界发动机层、人物发动机层、连载规划层。
3. inkos 2.0 任务三——增强 FoundationReviewerAgent 审核故事发动机质量  
   Design Anchor：审稿增强层。
4. inkos 2.0 任务二点五——create 阶段反哺旧控制文档  
   Design Anchor：当前 inkos 骨架与七层架构衔接。
5. inkos 2.0 任务二点六——优化 create 反哺文档的结构化  
   Design Anchor：连载规划层、章节生成层输入稳定性。
6. inkos 2.0 任务三点五——create 阶段题材安全与发布风险  
   Design Anchor：题材架构层、发布优化层。
7. inkos 2.0 任务三点五点一——补强 identity_insult 检测与真实国家规则一致性  
   Design Anchor：题材架构层、发布优化层。
8. inkos 2.0 任务四——chapter_intent 续写前意图卡  
   Design Anchor：章节生成层。
9. inkos 2.0 任务四点一——强化 chapter_intent 优先级，避免旧 payoff 机制覆盖意图卡  
   Design Anchor：章节生成层。
10. inkos 2.0 任务四点二——清理旧 planner payoffDirective，防止覆盖 chapter_intent  
   Design Anchor：章节生成层。
11. inkos 2.0 任务五 V1——chapter_intent 与正文一致性审核报告  
   Design Anchor：章节生成层、审稿增强层。
12. inkos 2.0 任务五点一——强化资源账本/数值一致性修复  
   Design Anchor：Resource Engine 与故事性升级的关系。
13. inkos 2.0 任务五点二——程序化 Resource Engine，接管系统流数值计算  
   Design Anchor：Resource Engine 是系统流小说的确定性数值底座。
14. inkos 2.0 任务五点三——Resource Engine 失败时阻断后续污染  
   Design Anchor：审稿增强层、发布优化层。
15. inkos 2.0 任务五点四——Resource Engine blocking 后的自动重写策略  
   Design Anchor：章节生成层、审稿增强层。
16. inkos 2.0 任务五点四点一——增强 Resource Engine 余额跳转识别与技能名抽取  
   Design Anchor：Resource Engine 与故事性升级的关系。
17. inkos 2.0 任务五点四点二——Resource Recovery 失败后降级方案 A，避免 LLM 反复发明透支  
   Design Anchor：Resource Engine 与故事性升级的关系。
18. inkos 2.0 任务五点四点三——修复 balance_jump 资源归属，防止把联邦币余额误判为民望值  
   Design Anchor：Resource Engine 与故事性升级的关系。
19. inkos 2.0 任务五点四点四——统一资源规则来源，方案 A 禁止所有现金兑换，并修复技能账本  
   Design Anchor：Resource Engine 与故事性升级的关系。
20. inkos 2.0 任务五点四点五——方案 A fallback 使用程序模板 patch，硬删违规现金兑换段落  
   Design Anchor：审稿增强层。
21. inkos 2.0 任务五点四点六——Resource Engine WARN/失败语义统一，资源未闭合不得 ready-for-review  
   Design Anchor：审稿增强层、发布优化层。
22. inkos 2.0 任务五点四点七——template patch 后同步修正余额声明，并过滤伪技能名  
   Design Anchor：Resource Engine 与故事性升级的关系。
23. inkos 2.0 任务五点四点八——正文非正文内容清理器，Resource patch 后强制 clean-narrative  
   Design Anchor：章节生成层、审稿增强层。
24. inkos 2.0 任务五点四点九——defer_exchange 下扩展现金流语义检测，删除间接现金兑现表达  
   Design Anchor：Resource Engine 与故事性升级的关系。
25. inkos 2.0 任务五点五——Resource Plan 前置注入 chapter_intent / writer，避免先写错再后修  
   Design Anchor：章节生成层。
26. inkos 2.0 任务五点七——Resource Plan 通用化与章节阶段识别  
   Design Anchor：章节生成层、Resource Engine 与故事性升级的关系。
27. inkos 2.0 任务五点七 B——No-Change Resource Closure 无资源变化章节的资源闭合机制  
   Design Anchor：章节生成层、审稿增强层、发布优化层、No-Change Resource Closure 的设计目标。

## 3. 当前任务

任务五点八：Book-level Resource Schema 与章节阶段化 Resource Plan。

Design Anchor：`.ai_workflow/01_design.md` 中“章节生成层”“审稿增强层”“发布优化层”“Resource Engine 与故事性升级的关系”“No-Change Resource Closure 的设计目标”。

目标：把真实新书验证暴露的问题抽象为系统规则，而不是修某本书输出。建立“每本书的资源域契约”思路，盘点当前 Resource Engine 是否存在全局默认资源污染、Resource Plan 是否缺少章节阶段 mode、fallback recovery 是否未按 schema/mode 分派、publish-ready 是否没有把资源闭合失败作为硬阻断。

当前子任务：5.8 收束：Book-level Resource Schema 与章节阶段化 Resource Plan 已完成，等待用户确认提交后进入任务六。

进入原因：真实新书验证显示，问题不应以某本书、某个资源名、某个章节输出为修复目标，而应抽象为通用规则：只有 book-level `resource_schema` 内资源进入强账本；系统/能力首次出现章节需要通用 `system_bootstrap` 或等价阶段 mode；fallback recovery 必须按 schema 与 plan mode 分派；publish-ready / write-publish-export 必须把资源闭合失败作为发布硬阻断。

## 4. 当前任务拆解

### 5.8A：盘点 Resource Schema / Resource Plan mode / fallback / publish-ready 资源门禁

状态：已完成。

Design Anchor：章节生成层；审稿增强层；发布优化层；Resource Engine 与故事性升级的关系；No-Change Resource Closure 的设计目标。

目标：只做抽象盘点与最小修复方案，不直接实现源码。必须避免写成“某书不要识别某资源”的特例补丁，而要定位通用规则缺口：资源 schema 来源、普通数字进入强账本的原因、章节阶段 mode 缺口、fallback 分派条件、publish-ready 资源硬阻断缺口。

修改范围：`.ai_workflow/reports/**`、`.ai_workflow/runs/run-011/**`。允许只读检查 Resource Engine、Resource Plan、pipeline、publish-ready、write-publish-export、相关测试与真实验证报告。

禁止修改范围：`.ai_workflow/01_design.md`、业务源码、生成章节、reviews 业务报告、publish 输出、analysis json/md、任何真实业务验证输出、任务六新功能。

代码级测试：本轮不要求新增测试；必须列出下一轮应补的单元测试和真实业务验证用例。

真实业务验证：本轮可只读引用最新真实验证输出作为 evidence，但不得编辑业务输出。真实样本只用于暴露抽象系统缺陷，不作为书名特化修复依据。

通过标准：输出 `.ai_workflow/reports/resource_schema_stage_plan_inventory.md` 和 run-011 对应报告，明确回答：资源 schema 现在从哪里来；是否存在默认资源污染；Resource Plan mode 是否缺少 bootstrap/reveal 类模式；fallback recovery 是否 schema/mode gated；publish-ready 是否读取 resource report/chapter status 并硬阻断；下一轮最小抽象实现方案和测试计划是什么。

run-011 review 结论：`PASS`。本轮只读盘点完成，未修改业务源码、业务输出或 `.ai_workflow/01_design.md`。确认五个抽象缺口：全局默认资源污染、叙事金融数字误入强账本、缺少 `system_bootstrap` / `resource_rule_reveal` mode、fallback 未按 schema/mode 分派、publish-ready/export 缺少资源硬门禁。下一轮进入 5.8B 最小抽象实现。

### 5.8B：实现 Book-level Resource Schema、章节阶段化 Resource Plan、fallback gate 与 publish-ready 资源门禁的最小抽象修复

状态：执行后 review 失败，需修复。

Design Anchor：章节生成层；审稿增强层；发布优化层；Resource Engine 与故事性升级的关系；No-Change Resource Closure 的设计目标。

目标：根据 5.8A 盘点结论做一轮最小抽象实现。修复必须是 book-level resource schema、叙事数字过滤、通用章节阶段 mode、schema/mode gated fallback、publish-ready/export 资源硬门禁，禁止写成书名、题材名、资源名或章节号特例。

修改范围：`packages/core/src/agents/resource-consistency.ts`、`packages/core/src/agents/resource-plan.ts`、`packages/core/src/pipeline/runner.ts`、`packages/core/src/agents/fanqie-quality.ts`、`packages/core/src/interaction/export-artifact.ts`、`packages/cli/src/commands/review.ts`、相关单元测试、`.ai_workflow/reports/**`、`.ai_workflow/runs/run-012/**`。

禁止修改范围：`.ai_workflow/01_design.md`、生成章节、reviews 业务报告、chapters-fixed、publish 输出、analysis json/md、任何真实业务验证输出、无关格式化或清理、特定书名/特定资源名/特定章节号硬编码补丁。

代码级测试：必须补充或更新测试，覆盖 book-level schema gate、叙事金融数字不进入强账本、`system_bootstrap` / `resource_rule_reveal` mode、fallback 不在 schema/mode 不允许时选择 `defer_exchange`、publish-ready 对 resource failure 返回阻断、export 排除资源失败章节。

真实业务验证：实现后按 `docs/write-book.md` 后台命令规则执行最小真实验证，记录 PID/log/exit。不得手工编辑业务输出。至少验证 publish-ready 对现有 `resource_failed` 样本返回资源阻断；如执行 write next / write-publish-export，必须后台运行。

通过标准：相关测试通过；无 `01_design.md` 修改；无业务输出手工修改；报告证明修复是抽象规则而非样本特化；publish-ready/export 不再放行 `blocking=true`、`closureStatus=resource_failed`、`state-degraded` 或 `blocked-resource-plan` 的章节。

run-012 review 结论：`FAIL`。本轮方向正确且测试/最小业务验证有价值，但未满足“抽象规则、不能写成资源名特例”的核心约束：`system_bootstrap` 新增代码仍直接判断 `民望值` / `联邦币`，会使其他资源 schema 的开篇系统绑定章节无法获得正确 `balance_claim` 计划；publish-ready 硬门禁只读 resource consistency report，未读取 chapter index 的 `state-degraded` / `blocked-resource-plan` 状态，因此无法覆盖“资源报告缺失或未标 blocking、但章节状态已降级/阻断”的发布风险。

### 5.8B-FIX：修复 run-012 抽象边界缺口，移除资源名特判并补齐 publish-ready chapter status 硬门禁

状态：执行后 review 失败，需补齐测试。

Design Anchor：章节生成层；审稿增强层；发布优化层；Resource Engine 与故事性升级的关系；No-Change Resource Closure 的设计目标。

目标：只修复 run-012 review 指出的阻断问题，不扩大战线。必须把 `system_bootstrap` 的 allowedEvents / balance_claim 判断改成 schema-driven，不得判断具体资源名；publish-ready 必须读取 chapter index 并对 `state-degraded` / `blocked-resource-plan` 硬阻断，即使 resource report 缺失或未标 blocking。

修改范围：`packages/core/src/agents/resource-plan.ts`、`packages/cli/src/commands/review.ts`、相关测试文件、`.ai_workflow/reports/**`、`.ai_workflow/runs/run-013/**`。如测试编译需要，可小范围调整 run-012 已改过的同组文件，但不得新增无关功能。

禁止修改范围：`.ai_workflow/01_design.md`、生成章节、reviews 业务报告、chapters-fixed、publish 输出、analysis json/md、任何真实业务验证输出、任务六或 story-effectiveness 新功能、书名/题材名/资源名/章节号特例补丁。

代码级测试：必须新增或修正测试，至少覆盖：非 `民望值/联邦币` 的资源 schema 在 `system_bootstrap` 下产生正确 `balance_claim`；publish-ready 在 chapter index 状态为 `state-degraded` 时返回 `BLOCKED_BY_RESOURCE`；publish-ready 在 chapter index 状态为 `blocked-resource-plan` 时返回 `BLOCKED_BY_RESOURCE`；已有 run-012 测试继续通过。

真实业务验证：本轮可继续使用最小 publish-ready 验证，但必须后台运行并记录 PID/log/exit。不得直接编辑业务输出。若无法构造真实 chapter index 状态样本，必须在报告中说明并用单元测试覆盖。

通过标准：`resource-plan.ts` 新增/修改逻辑不再包含 `params.openingBalances["民望值"]`、`params.openingBalances["联邦币"]` 这类新增资源名特判；publish-ready 对 resource report 和 chapter index 双来源均可阻断资源失败；测试通过；无业务输出手工修改；无 `01_design.md` 修改。

run-013 review 结论：`FAIL`。两个实现阻断点已修复：`system_bootstrap` 已改为 schema-driven balance_claim，publish-ready 已读取 chapter index 并在真实样本中对 `state-degraded` 输出 `BLOCKED_BY_RESOURCE`。但本轮 prompt 明确要求 publish-ready 在 `state-degraded` 和 `blocked-resource-plan` 两种 chapter index 状态下都有测试或验证；run-013 未提供 `blocked-resource-plan` 的单元测试或真实验证覆盖，因此不能 PASS。

### 5.8B-FIX-TEST：补齐 publish-ready blocked-resource-plan 门禁测试并复核 5.8B 修复闭环

状态：已完成。

Design Anchor：章节生成层；审稿增强层；发布优化层；Resource Engine 与故事性升级的关系。

目标：不改业务逻辑，优先只补齐缺失测试和报告。必须证明 publish-ready 在 chapter index 状态为 `blocked-resource-plan` 时返回 `BLOCKED_BY_RESOURCE`，且 run-013 已修复的 `state-degraded`、schema-driven `system_bootstrap` 测试继续通过。

修改范围：优先相关测试文件、`.ai_workflow/reports/**`、`.ai_workflow/runs/run-014/**`。只有测试需要暴露 helper 或修复明显测试接入问题时，才允许小范围修改 `packages/cli/src/commands/review.ts`，不得改核心业务逻辑。

禁止修改范围：`.ai_workflow/01_design.md`、生成章节、reviews 业务报告、chapters-fixed、publish 输出、analysis json/md、任何真实业务验证输出、任务六或 story-effectiveness 新功能、书名/题材名/资源名/章节号特例补丁。

代码级测试：必须新增或修正测试覆盖 publish-ready 读取 chapter index 状态为 `blocked-resource-plan` 时返回 `BLOCKED_BY_RESOURCE`。同时重跑相关 CLI/core 测试，记录命令与结果。

真实业务验证：本轮可不再跑新的真实业务验证；如运行 publish-ready，必须后台运行并记录 PID/log/exit。不得直接编辑业务输出。

通过标准：缺失的 `blocked-resource-plan` 覆盖已补齐；相关测试通过；无业务输出手工修改；无 `01_design.md` 修改；run-014 报告明确说明 5.8B 的两个 blocker 与测试缺口均已闭合。

run-014 review 结论：`PASS`。本轮补齐 `blocked-resource-plan` chapter index 状态读取测试；目标测试 `review-continuity-verdict.test.ts` 通过，core `resource-consistency` 相关测试通过。5.8B 的两个实现 blocker 与测试缺口均已闭合。注意：Codex 复跑整包 CLI 测试时遇到无关 TUI dashboard 超时；随后按目标测试文件复跑通过，不作为本任务阻断。

### 5.8 收束：Book-level Resource Schema 与章节阶段化 Resource Plan

状态：已完成，等待用户确认提交。

Design Anchor：章节生成层；审稿增强层；发布优化层；Resource Engine 与故事性升级的关系；No-Change Resource Closure 的设计目标。

收束结论：`TASK5_RESOURCE_SCHEMA_STAGE_PASS_READY_TO_COMMIT`。

完成内容：
- Book-level Resource Schema gate：显式 `resourceTypes` 存在时只让声明资源进入强账本，无声明时保持旧书兼容。
- 叙事金融数字过滤：普通价格、费用、工资、转账等不进入资源账本，系统面板/资源余额上下文仍可检测。
- 章节阶段 Resource Plan：新增 `system_bootstrap` 与 `resource_rule_reveal`，系统开篇 balance claim 已改为 schema-driven。
- fallback recovery gate：`defer_exchange` 仅在 schema 支持兑换且 plan mode 允许时使用。
- publish-ready / export 资源硬门禁：`resource_failed`、`state-degraded`、`blocked-resource-plan` 不再被发布或导出流程放行。

残余风险：
- publish-ready 的 `blocked-resource-plan` 覆盖为 helper/unit 级测试，后续如有重构可补完整 CLI 集成测试。
- `system_bootstrap` 仍使用前 3 章启发式，后续可在任务六或 story-effectiveness 阶段结合 chapter_intent 再做更精细识别。

### 任务五收束：Resource Engine / Resource Plan / No-Change Closure 资源一致性阶段关闭

状态：已执行，需用户确认。

Design Anchor：章节生成层；审稿增强层；发布优化层；Resource Engine 与故事性升级的关系；No-Change Resource Closure 的设计目标。

目标：以一个收束任务判断任务五是否完成，不再把 5.7B 拆成更多碎片任务。必须回答：Resource Engine 是否已经成为系统流小说的确定性数值底座；Resource Plan 是否已能前置约束 chapter_intent / writer；资源失败是否能阻断污染；no-change 章节是否能明确闭合并不误触发 BLOCKED / WARN；任务五是否可以关闭并顺延到后续故事性审稿任务。

修改范围：优先新增本轮报告 `.ai_workflow/reports/task5_resource_stage_closure_report.md` 与 `.ai_workflow/runs/run-009/task5_resource_stage_closure_report.md`；可更新 run-009 的 code/biz/biz_filespath/diff_summary 报告。只有在发现极小且确定的资源闭合程序缺口时，才允许提出下一轮修复建议；本轮默认不修改源码。

禁止修改范围：`.ai_workflow/01_design.md`、生成章节、chapters-fixed、publish 输出、旧 reviews 报告、analysis json/md、任何业务验证输出、与资源一致性阶段关闭无关的业务代码、任务六或发布优化层新功能。

代码级测试：复核并必要时重跑 Resource Engine / Resource Plan / No-Change Closure 相关测试；记录命令、结果和是否产生日志噪声。若测试会写入日志文件，必须在报告中标出，不得把无关日志变更混入验收结论。

真实业务验证：优先使用现有 CLI 或最小可控流程生成一个 post-5.7B 的真实 no-change 验证样本，检查新 report 是否包含 `closureStatus: "no_change_closed"`，并检查 chapter index / downstream 状态不进入 `state-degraded` / `blocked-resource-plan`。不得直接编辑章节、报告、导出文本或任何业务输出以制造通过。

通过标准：输出明确结论 `TASK5_PASS_READY_TO_CLOSE` / `TASK5_PASS_WITH_RECORDED_GAP` / `TASK5_FAIL_NEEDS_FIX`。只有当 post-5.7B no-change 样本能证明资源闭合语义端到端成立，且未发现会污染后续 story-effectiveness / publish-ready 的资源层问题时，才能判定 `TASK5_PASS_READY_TO_CLOSE`。

run-009 review 结论：`MANUAL_CONFIRM_REQUIRED`。本轮实际后台运行 write-next 并生成 post-5.7B resource consistency report，确认 `closureStatus` 字段已进入真实报告输出；但新增样本包含资源事件，`closureStatus` 为 `resource_failed`，仍未验证到真实 `no_change_closed`。同时本轮留下 tracked `packages/core/logs/llm-usage.jsonl` 日志 diff，需要用户确认是否先清理并接受 `TASK5_PASS_WITH_RECORDED_GAP`，或继续跑一次真实 no-change 验证。

run-010 计划：用户选择继续做一次真实 no-change 验证。`packages/core/logs/` 已由用户加入 `.gitignore`，视为 LLM 调用过程日志输出，不作为 Claude 执行失败点；但 Claude 仍必须在报告中记录真实业务验证命令、后台 PID/log/exit 和新生成业务输出路径。

### 任务五收束补验：真实 no-change 验证

状态：已执行，需用户确认。

Design Anchor：章节生成层；审稿增强层；发布优化层；Resource Engine 与故事性升级的关系；No-Change Resource Closure 的设计目标。

目标：再执行一次真实业务流程，尽量生成一个没有收益、消耗、兑换、技能变化、余额声明的章节，并验证 post-5.7B 新 resource consistency report 是否出现 `closureStatus: "no_change_closed"`。本轮只补验 no-change，不新增任务六功能，不修改资源闭合代码。

修改范围：`.ai_workflow/reports/**`、`.ai_workflow/runs/run-010/**`；程序自然生成的新章节、新 runtime 文件、新 resource consistency report 可作为业务验证产物，但不得手工编辑。

禁止修改范围：`.ai_workflow/01_design.md`、业务源码、手工修改生成章节、手工修改 reviews 报告、chapters-fixed、publish 输出、analysis json/md、任务六或 publish-ready 新功能。

代码级测试：仅在需要确认构建状态时运行 build/typecheck；本轮重点是业务验证。若测试或 CLI 产生日志到 `packages/core/logs/`，按已忽略 LLM 日志处理，不作为失败点。

真实业务验证：必须实际后台运行 `write next` 或等价真实业务流程，产生 post-5.7B 新输出；不得只读旧文件。命令必须后台运行并记录 PID、log、exit。首选在正式系统流 book 上继续验证；如选择其他 book，必须说明理由。

通过标准：新 report 中出现 `closureStatus: "no_change_closed"`，`blocking=false`，无 resource plan violation，章节 index 不进入 `blocked-resource-plan` / `state-degraded`。如果再次生成资源事件，则如实记录为“本次样本仍非 no-change”，不得手工修正文制造通过。

run-010 review 结论：`MANUAL_CONFIRM_REQUIRED`。本轮实际后台运行 `write next`，但因所选书最新 Ch4 已是 `blocked-resource-plan`，命令在管线入口处失败，未生成新章节或新 resource consistency report，因此仍未观察到 `closureStatus: "no_change_closed"`。该结果再次证明 Resource Engine 阻断机制有效，但不能替代 no-change closure 真实验证。下一步需要用户选择：修复/重写 Ch4、换书验证、创建受控临时真实验证 book/fixture，或接受 recorded gap 关闭任务五。

### 5.7B-1：盘点 Resource Engine 当前对 no-change 章节的处理

状态：已完成。

Design Anchor：章节生成层；审稿增强层；No-Change Resource Closure 的设计目标。

目标：只做盘点，定位 Resource Engine / Resource Plan / publish-ready / review 对 no-change 的当前语义和缺口，提出最小修改方案。

修改范围：优先只新增 `.ai_workflow/reports/resource_no_change_closure_inventory.md` 和 run-001 对应报告；必要时仅阅读源码。

禁止修改范围：业务核心代码、生成章节、chapters-fixed、publish 输出、旧 reviews 报告、业务验证输出、`.ai_workflow/01_design.md`。

代码级测试：本轮只列出建议测试位置、测试样例和预期断言，不要求实现。

真实业务验证：可列出建议样本路径和验证命令，但不得直接修复验证输出。

通过标准：报告能说明 no-change 当前流转路径、误判点、最小改动文件、测试建议和下一轮执行建议。

### 5.7B-2：定义 no-change resource closure 判定语义

状态：已完成。

Design Anchor：No-Change Resource Closure 的设计目标；Resource Engine 与故事性升级的关系。

目标：定义“无资源变化但已闭合”与“资源检查缺失”的程序语义边界。

修改范围：Resource Engine 类型、分析结果语义、报告结构。

禁止修改范围：生成章节、publish 输出、业务验证输出、未授权的 `01_design.md`。

代码级测试：覆盖 no-change、missing-check、normal-delta、blocked-delta 四类样例。

真实业务验证：使用真实章节样本验证报告状态，不直接编辑章节。

通过标准：no-change 章节有明确 closure 状态，不被标记为缺失检查。

### 5.7B-2R：处理 5.7B-2 review 的手动确认与范围修正

状态：已完成。

Design Anchor：01_design.md 受控变更原则；No-Change Resource Closure 的设计目标；审稿增强层。

目标：在不修改 `01_design.md`、不直接修改业务输出的前提下，处理 run-002 的两个 review 阻塞点：用户批准记录缺失、`packages/core/src/index.ts` 超出允许修改范围。

修改范围：`.ai_workflow/reports/**`、`.ai_workflow/runs/**`、`.ai_workflow/00_state.json`、`.ai_workflow/02_todo.md`、`.ai_workflow/03_prompt.txt`；如用户明确确认可接受 `index.ts` 导出，则只记录确认，不改源码；如用户要求回收范围，则下一轮再移除 `index.ts` 导出并调整测试导入。

禁止修改范围：`.ai_workflow/01_design.md`、生成章节、chapters-fixed、publish 输出、旧业务报告、业务验证输出。

代码级测试：若不改源码，不需要新增测试；若回收 `index.ts` 导出，需要重新跑 core test 与 typecheck。

真实业务验证：不运行真实业务验证。

通过标准：用户明确确认 run-002 是否视为已批准执行，并确认 `index.ts` 导出是接受还是需要回收；之后再进入 5.7B-3。

### 5.7B-2R-FIX：修复 run-003 review 发现的流程越界

状态：取消。用户说明 `.gitignore` 修改是手工修改，不属于 Claude Code run-003 输出；run-003 已按输出重新审查为 PASS。

Design Anchor：01_design.md 受控变更原则；验证样本不可直接修复原则；No-Change Resource Closure 的设计目标。

目标：修复 run-003 的流程越界：`.gitignore` 未授权修改、用户确认记录缺失或不可追溯。先恢复协作流程可信度，再决定是否继续 5.7B-3。

修改范围：优先仅 `.ai_workflow/reports/**`、`.ai_workflow/runs/**`、`.ai_workflow/00_state.json`、`.ai_workflow/02_todo.md`、`.ai_workflow/03_prompt.txt`。只有用户明确授权时，才允许移除 `.gitignore` 中新增的 `.ai_workflow/` 忽略规则。

禁止修改范围：`.ai_workflow/01_design.md`、业务源码、生成章节、chapters-fixed、publish 输出、旧业务报告、业务验证输出。

代码级测试：默认不运行测试；若用户授权回滚 `.gitignore`，无需跑代码测试，只需检查 `git diff -- .gitignore`。

真实业务验证：不运行真实业务验证。

通过标准：`.gitignore` 越界修改得到用户明确处置；run-002 的批准和 `index.ts` 导出接受状态得到用户明确确认，或相应改为待确认状态；之后才能继续 5.7B-3。

### 5.7B-3：补齐 no-change closure report 输出

状态：已完成。

Design Anchor：审稿增强层；发布优化层。

目标：让 no-change 章节输出明确 closure report，供 publish-ready、continuity、review、export 读取。

修改范围：resource report 生成、analysis md/json、相关汇总报告。

禁止修改范围：正文业务输出、旧报告回填、未授权 `01_design.md`。

代码级测试：断言 no-change report 包含 closure 结论、原因、状态和非 BLOCKED/WARN 语义。

真实业务验证：检查真实样本生成的新报告，不直接修旧报告。

通过标准：报告消费者可以区分 no-change closure 和缺失报告。

### 5.7B-4：确保 no-change 章节不会触发错误 BLOCKED / WARN 污染

状态：已完成。

Design Anchor：审稿增强层；发布优化层；No-Change Resource Closure 的设计目标。

目标：避免 no-change 被错误升级为 BLOCKED / WARN，污染 ready-for-review、continuity、publish-ready 或 export。

修改范围：状态聚合、WARN/BLOCKED 判定、publish-ready 汇总读取。

禁止修改范围：直接放宽真实资源失败、绕过 Resource Engine、修改业务输出。

代码级测试：断言 no-change 不触发 BLOCKED/WARN，真实异常仍保持 BLOCKED/WARN。

真实业务验证：跑真实章节样本并检查 downstream report 状态。

通过标准：no-change 成功闭合，真实资源异常不被误放行。

### 5.7B-5：补充单元测试

状态：已完成。

Design Anchor：Resource Engine 是系统流小说的确定性数值底座。

目标：用单元测试锁住 no-change closure 语义。

修改范围：Resource Engine / Resource Plan / report consumer 的测试文件。

禁止修改范围：业务输出文件、旧验证报告、未授权 `01_design.md`。

代码级测试：新增或更新测试，并确保相关测试通过。

真实业务验证：记录真实验证命令和输出路径。

通过标准：测试覆盖 no-change 与异常资源场景，且不会用测试快照掩盖逻辑问题。

### 5.7B-6：用真实章节样本验证，不直接修章节输出

状态：已完成。

Design Anchor：验证样本不可直接修复原则；发布优化层。

目标：用真实样本证明 no-change closure 在业务链路中可用。

修改范围：仅新增本轮验证报告和 run 记录。

禁止修改范围：生成章节、chapters-fixed、publish 输出、analysis json/md、旧 reviews 报告，除非用户明确指定修某个输出。

代码级测试：先通过单元测试，再跑真实验证。

真实业务验证：记录命令、样本、输出路径、结论和残余风险。

通过标准：真实样本作为验收依据，而不是被直接编辑成通过状态。

### 5.7B-7：Codex 后置复核是否满足任务目标

状态：已完成。

Design Anchor：01_design.md 受控变更原则；No-Change Resource Closure 的设计目标。

目标：Codex 审查 Claude 执行结果是否符合设计主线、任务目标和禁止事项。

修改范围：`02_todo.md`、`03_prompt.txt`、`00_state.json`、reports、runs。

禁止修改范围：常规 review 不修改 `01_design.md`，不自动 commit，不直接修业务验证输出。

代码级测试：复核测试结果是否可信。

真实业务验证：复核真实验证是否只作为系统验收依据。

通过标准：输出 PASS/FAIL/MANUAL_CONFIRM_REQUIRED，并给出下一轮 prompt。

## 5. 后续任务池

- 任务五收束验收通过后，进入 story-effectiveness review 与 Resource Engine / chapter_intent 的衔接复核。
- story-effectiveness review 与 Resource Engine / chapter_intent 的衔接复核。
- publish-ready 接入故事性风险摘要。
- golden_3_chapter_review 第一章/前三章发布转化检查。
- opening-hook-reviewer 增强。
- antagonist-intelligence-reviewer 增强。
- transition-quality-reviewer 增强。
- six-step-plot-reviewer 增强。
- 短故事 LLM 化复用故事发动机。
- book-info 发布信息优化。

## 6. 协作规则

- `.ai_workflow/01_design.md` 是最高设计依据，常规研发循环不得修改。
- 每个任务和当前 prompt 必须包含 Design Anchor。
- Claude Code 执行前必须先做 preflight review，只审查不执行。
- 用户批准后 Claude Code 才能执行。
- Codex 执行后 review 必须检查是否偏离 `01_design.md`、是否未授权修改 `01_design.md`、是否直接修改业务验证输出。
- 验证样本不可直接修复。
- 真实业务验证必须实际运行程序产生新输出，不能只翻旧文件得出结论。
- 真实业务验证中的长跑命令必须后台运行，并记录 PID、日志和退出码；`write next`、publish-ready 闭环、continuity-auto 等命令不得在 console 前台直接运行。
- 不自动 commit。
