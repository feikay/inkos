# Claude Code Preflight Review Template

本模板用于 Claude Code 执行前目标审查。只审查，不执行；不得修改业务代码，不得修改业务输出，不得进入任务实现。

## 必读文件

- `.ai_workflow/00_state.json`
- `.ai_workflow/01_design.md`
- `.ai_workflow/02_todo.md`
- `.ai_workflow/03_prompt.txt`

## 必查命令

- `git status --short`
- `git diff --stat`

## 审查项

1. 检查 `03_prompt.txt` 是否包含 Design Anchor。
2. 检查 Design Anchor 是否能对应 `01_design.md` 的设计层级或设计目标。
3. 检查 `03_prompt.txt` 是否对应 `02_todo.md` 当前任务和当前子任务。
4. 检查 `03_prompt.txt` 是否要求未授权修改 `01_design.md`。
5. 如果未授权要求修改 `01_design.md`，必须输出 `REJECT_NEEDS_REWRITE`。
6. 检查任务是否脱离 inkos 2.0：故事性大升级主线。
7. 检查任务是否把 `.ai_workflow` 初始化或 AI 协作系统建设当作业务主线。
8. 检查任务是否诱导直接修改业务验证输出。
9. 检查允许修改范围和禁止修改范围是否清晰。
10. 检查是否遵守验证样本不可直接修复原则。
11. 如果 `03_prompt.txt` 包含真实业务验证命令，检查是否要求后台运行，并记录 PID、日志和退出码；`write next`、publish-ready 闭环、continuity-auto 等长跑命令不得要求前台直接运行。
12. 检查是否遵守不自动 commit 原则。

## 判定规则

- `APPROVE_TO_EXECUTE`：prompt 与 `01_design.md`、`02_todo.md` 对齐，Design Anchor 明确，不要求未授权修改 `01_design.md`，不诱导直接修改业务验证输出。
- `REJECT_NEEDS_REWRITE`：prompt 明显偏离 `01_design.md`，Design Anchor 错误，要求未授权修改 `01_design.md`，或诱导直接修改业务验证输出。
- `MANUAL_CONFIRM_REQUIRED`：Design Anchor 缺失、范围存在歧义、真实业务验证长跑命令未说明后台运行方式、需要用户确认风险，或存在无法由 Claude Code 自行判断的边界问题。

即使输出 `APPROVE_TO_EXECUTE`，也必须等待用户批准后才执行。

## 输出文件

- `.ai_workflow/reports/03_preflight_review.txt`
- `.ai_workflow/runs/{{RUN_ID}}/preflight_review.txt`

## 输出格式

结论：APPROVE_TO_EXECUTE / REJECT_NEEDS_REWRITE / MANUAL_CONFIRM_REQUIRED

审查摘要：
- Design Anchor：
- 与 01_design.md 对齐情况：
- 与 02_todo.md 当前任务对齐情况：
- 是否要求未授权修改 01_design.md：
- 是否诱导直接修改业务验证输出：
- 真实业务验证命令是否后台运行并记录 PID/log/exit：
- git status 摘要：
- git diff --stat 摘要：

风险与建议：
- 

用户下一步：
- 若结论为 APPROVE_TO_EXECUTE：请用户明确批准后再执行。
- 若结论为 REJECT_NEEDS_REWRITE：请 Codex 先重写 prompt。
- 若结论为 MANUAL_CONFIRM_REQUIRED：请用户确认风险后再决定。
