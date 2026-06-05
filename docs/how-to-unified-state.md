为了确保您在今后的写作与修改过程中，故事状态始终保持 100% 准确一致，以下是为您整理的 **Inkos 状态安全协作与开发工作流指南**：

---

### 1. 正常写作循环（正常迭代）
当您正常往下写新章节时，依次执行：
1. **规划意图**：
   ```bash
   node packages/cli/dist/index.js plan chapter 重生1997
   ```
2. **生成正文**：
   ```bash
   node packages/cli/dist/index.js write next 重生1997
   ```
3. **评估与修补**：
   ```bash
   node packages/cli/dist/index.js review publish-ready --book 重生1997 --chapter <章节号>
   ```
4. **签署审批（核心变更点）**：
   ```bash
   node packages/cli/dist/index.js review approve 重生1997 <章节号>
   ```
   * **以前**：审批仅修改元数据，如果期间您手动修改过正文，状态数据库不会实时同步，容易造成时差和状态漂移。
   * **现在**：`approve` 命令在后台**全自动触发一次快速状态对齐与快照同步**。这确保了您最终定稿的正文与数据库状态 100% 保持一致。

---

### 2. 剧情回滚与重写（回滚迭代）
如果您对写出来的某一章（例如第 9 章）不满意，希望退回到前一章（第 8 章）重写：
1. **撤回章节**：
   ```bash
   node packages/cli/dist/index.js review reject 重生1997 <要撤回的章节号>
   ```
   * 该命令会自动把系统状态回滚到前一章，物理删除该章节的文件，并**自动在 `index.json` 中注销该章节**。
2. **重新规划与编写**：
   * 状态回滚后，您可以直接重新运行 `plan chapter`，此时系统会正确规划您撤回的这章（例如重新规划第 9 章），绝不会发生越级跳章的 Bug。

---

### 3. 终极状态对齐（状态纠偏与故障恢复）
如果您在多人协作、手动挪动过目录文件、执行过复杂的 Git 分支切换，或者遇到了 `current_state_ahead_of_manifest` 等警告：
* **一键重建状态**：
  ```bash
  node packages/cli/dist/index.js review rebuild-state 重生1997
  ```
  * **作用**：此命令会清空当前缓存，根据 `index.json` 中记录的最新通过章节列表，**自适应从第 1 章开始逐章重新进行 LLM 深度分析**。
  * **效果**：重新生成完美的 `current_state.md`、伏笔注册表以及用于关联嵌入的向量数据库（`memory.db`），让系统的“记忆”与大纲完美归一。