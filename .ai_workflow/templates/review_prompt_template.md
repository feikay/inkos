# Codex Output Review Template

本模板用于 Codex 对 Claude Code 执行结果进行后置审查。先审查，不先修改；不得默认修复执行结果，不得自动 commit。

## 必读文件

- `.ai_workflow/00_state.json`
- `.ai_workflow/01_design.md`
- `.ai_workflow/02_todo.md`
- `.ai_workflow/03_prompt.txt`
- `.ai_workflow/reports/03_preflight_review.txt`
- `.ai_workflow/reports/04_output_code_report.txt`
- `.ai_workflow/reports/05_output_biz_report.txt`
- `.ai_workflow/reports/06_output_biz_filspath.txt`
- `.ai_workflow/runs/{{RUN_ID}}/diff_summary.txt`

## 必查命令

- `git status --short`
- `git diff --stat`
- `git diff`

## 审查项

1. 检查是否经过 preflight。
2. 检查是否经过用户批准执行。
3. 检查是否未授权修改 `01_design.md`。
4. 如果未授权修改 `01_design.md`，必须判定 `FAIL`。
5. 检查执行结果是否符合 `01_design.md` 的 Design Anchor。
6. 检查执行结果是否推进 `02_todo.md` 当前任务。
7. 检查执行结果是否完成 `03_prompt.txt` 指定目标。
8. 检查是否直接修改业务验证输出。
9. 检查是否修改了禁止范围内文件。
10. 检查代码级测试或测试建议是否符合当前轮要求。
11. 检查真实业务验证是否实际运行程序产生新输出，且只作为系统验收依据。
12. 如果执行涉及 `write next`、publish-ready 闭环、continuity-auto 等长跑命令，检查是否后台运行并记录 PID、日志和退出码。
13. 检查下一轮 `03_prompt.txt` 是否仍然包含 Design Anchor。
14. 检查是否遵守不自动 commit 原则。

## 常规 review 可修改范围

成功时只允许更新：

- `.ai_workflow/02_todo.md`
- `.ai_workflow/03_prompt.txt`
- `.ai_workflow/00_state.json`
- `.ai_workflow/reports/**`
- `.ai_workflow/runs/**`

常规 review 不允许修改 `.ai_workflow/01_design.md`。

## 判定规则

- `PASS`：执行结果符合 Design Anchor、完成当前目标、未越权修改、未直接修业务验证输出。
- `FAIL`：未授权修改 `01_design.md`、修改禁止范围、直接修业务验证输出伪造通过、或结果明显偏离当前任务。
- `MANUAL_CONFIRM_REQUIRED`：结果存在边界风险、需要用户确认是否接受，或下一轮范围需要用户重新授权。

## 输出文件

- `.ai_workflow/reports/07_review_report.txt`
- `.ai_workflow/runs/{{RUN_ID}}/review_report.txt`

## 输出格式

结论：PASS / FAIL / MANUAL_CONFIRM_REQUIRED

审查摘要：
- preflight 状态：
- 用户批准状态：
- Design Anchor 对齐：
- 当前任务推进情况：
- 03_prompt.txt 完成情况：
- 01_design.md 是否被未授权修改：
- 是否直接修改业务验证输出：
- 真实业务验证是否实际运行新输出：
- 后台命令记录：
  - PID 文件：
  - log 文件：
  - exit 文件：
- git status 摘要：
- git diff --stat 摘要：

问题清单：
- 

下一轮建议：
- 

提交状态：
- 不自动 commit。
