# .ai_workflow 本地协作 SOP

`.ai_workflow` 是本地多 AI 协作的承载层，不是业务主线。真正的业务主线是 inkos 2.0：故事性大升级。

## 文件职责分层

- `01_design.md`：inkos 2.0：故事性大升级总体规划，是最高设计依据。
- `02_todo.md`：围绕 `01_design.md` 展开的任务路线图。
- `03_prompt.txt`：当前任务执行提示词。
- `00_state.json`：当前协作状态、权限边界和下一步动作。
- `templates/preflight_review_template.md`：Claude Code 执行前目标审查模板。
- `templates/review_prompt_template.md`：Codex 执行后结果审查模板。
- `reports/`：当前轮报告。
- `runs/`：按轮次归档 prompt、preflight、执行报告、review 和 diff summary。

## 01_design.md 受控变更原则

`01_design.md` 是 inkos 2.0 的总体规划文件，是 `02_todo.md`、`03_prompt.txt`、preflight、review 的最高依据。

常规研发循环中不得修改 `01_design.md`。Codex 常规 review 后只能更新 `02_todo.md`、`03_prompt.txt`、`00_state.json`、`reports`、`runs`。

如果需要修改 `01_design.md`，必须由用户单独发起“设计变更任务”。设计变更必须先提出 proposal，说明现有 design 为什么不足、拟修改章节、对 todo、prompt、测试、真实验证的影响，并等待用户确认后才能正式修改。

如果任务未授权要求修改 `01_design.md`，Claude preflight 必须 `REJECT_NEEDS_REWRITE`。如果执行结果未授权修改 `01_design.md`，Codex review 必须 `FAIL`。

## Design Anchor 规则

`02_todo.md` 中每个任务必须包含 Design Anchor，指向 `01_design.md` 中的设计层级或设计目标。

`03_prompt.txt` 必须包含：

- Design Anchor；
- 当前任务对应 `02_todo.md` 的哪个任务；
- 当前任务为什么没有脱离 `01_design.md`。

Claude preflight 必须检查 Design Anchor 是否存在。没有 Design Anchor，至少判定 `MANUAL_CONFIRM_REQUIRED`；Design Anchor 明显不对应 `01_design.md`，判定 `REJECT_NEEDS_REWRITE`。

## 三方分工

- 用户：确认业务目标、批准 Claude Code 从 preflight 进入执行、最终确认是否 commit。
- Codex：维护设计、TODO、prompt、review，审查是否偏离 inkos 2.0 主线。
- Claude Code：按 `03_prompt.txt` 执行具体盘点、实现、测试和报告，但必须先通过 preflight 并等待用户批准。

## Claude preflight 流程

Claude Code 执行前必须使用 `templates/preflight_review_template.md`，只审查，不执行。

必须读取 `00_state.json`、`01_design.md`、`02_todo.md`、`03_prompt.txt`，并检查 `git status --short`、`git diff --stat`。

preflight 输出到：

- `.ai_workflow/reports/03_preflight_review.txt`
- `.ai_workflow/runs/{{RUN_ID}}/preflight_review.txt`

结论只能是 `APPROVE_TO_EXECUTE`、`REJECT_NEEDS_REWRITE`、`MANUAL_CONFIRM_REQUIRED`。即使 `APPROVE_TO_EXECUTE`，也必须等待用户批准后才执行。

## 用户批准执行流程

用户读取 preflight 结论后决定是否批准 Claude Code 执行。

若 preflight 为 `REJECT_NEEDS_REWRITE`，应先由 Codex 修正 `03_prompt.txt` 或相关协作文件。若为 `MANUAL_CONFIRM_REQUIRED`，必须由用户明确确认风险。

## Claude 执行流程

Claude Code 只能在用户批准后执行 `03_prompt.txt`。

执行时必须遵守允许修改范围、禁止修改范围、验证样本不可直接修复原则和不自动 commit 原则。

## Codex review 流程

Claude 执行后，Codex 使用 `templates/review_prompt_template.md` 先审查，不先修改。

Codex 必须检查 preflight、用户批准、git diff、是否未授权修改 `01_design.md`、是否直接修改业务验证输出、是否完成当前任务目标、下一轮 `03_prompt.txt` 是否仍包含 Design Anchor。

成功时，常规 review 只允许更新 `02_todo.md`、`03_prompt.txt`、`00_state.json`、`reports`、`runs`。

## 用户最终确认 / commit 流程

Codex review 完成后，用户决定是否继续下一轮、要求返工或手动 commit。

默认不自动 commit。任何 commit 都必须等待用户明确要求。

## 验证样本不可直接修复原则

业务验证输出只作为系统验收依据，不是本轮开发的修复对象。除非用户明确要求修复某个具体章节或具体输出文件，否则不得直接编辑生成章节、chapters-fixed、publish 导出、continuity report、publish-ready report、analysis json/md、short-story 结果或其他真实业务验证输出。

如果验证输出有问题，必须先判断它是单次内容波动还是系统性缺陷，并追溯到程序逻辑、Prompt、规则阈值、数据读取、状态传递、模型调用、LLM 输出解析或测试样例设计。

真实业务验证必须实际运行程序产生新输出，不能只翻旧文件得出结论。程序自然生成的新章节、新 report、新 analysis 可以作为验证产物；禁止手工编辑这些产物来伪造通过。

真实业务验证中的长跑命令必须后台运行并记录 PID、日志和退出码；不要把 `write next`、publish-ready 闭环、continuity-auto 等命令直接放在 console 前台跑。推荐格式：

```bash
nohup sh -c '<REAL_COMMAND>; echo $? > .ai_workflow/runs/<RUN_ID>/logs/<name>.exit' > .ai_workflow/runs/<RUN_ID>/logs/<name>.log 2>&1 & echo $! > .ai_workflow/runs/<RUN_ID>/logs/<name>.pid
```

review 时必须读取对应 log、pid、exit 文件，并把真实业务验证输出路径写入 biz filespath。

## 不自动 commit 原则

Codex 和 Claude Code 都不得自动 commit。提交必须由用户最终确认。
