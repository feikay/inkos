我来帮你梳理新建一本书时的骨架构建逻辑。让我先探索相关代码。
已经全面梳理完毕。以下是新建一本书时的骨架构建详细逻辑：

---

## 新建书籍的骨架构建流程

### 一、入口（3种方式）

1. **CLI**: `inkos book create --title "小说名" --genre xuanhuan --platform tomato`
2. **Studio Web UI**: `packages/studio/src/pages/BookCreate.tsx` 对话式创建
3. **自然语言交互**: `/new 我想写一个港风商战悬疑` → `/create` 创建

---

### 二、核心流程：`PipelineRunner.initBook()`

文件：`packages/core/src/pipeline/runner.ts`

```
initBook() 做了 8 件事：
1. 创建 ArchitectAgent
2. 创建临时目录 .tmp-book-create-xxx（防中途失败污染正式目录）
3. 调用 generateAndReviewFoundation() 生成+审核基础设定
4. 保存 book.json 到临时目录
5. 调用 architect.writeFoundationFiles() 写入骨架文件
6. 调用 ensureControlDocumentsAt() 初始化控制文档
7. 创建空章节索引 + 初始快照(snapshot 0)
8. 原子性 rename 临时目录 → 正式目录
```

---

### 三、骨架生成核心：`ArchitectAgent.generateFoundation()`

文件：`packages/core/src/agents/architect.ts`

调用一次 LLM，生成 **5 个 SECTION**，用 `=== SECTION: <name> ===` 分隔：

| SECTION          | 文件                      | 内容                                                         |
| ---------------- | ------------------------- | ------------------------------------------------------------ |
| `story_bible`    | `story/story_bible.md`    | 世界观规则体系、主角(身份+金手指+限制)、势力与人物表格、地理环境、书名与简介方法 |
| `volume_outline` | `story/volume_outline.md` | 每卷的核心冲突/关键转折/收益目标 + 黄金三章(第1章抛冲突、第2章展金手指、第3章明目标) |
| `book_rules`     | `story/book_rules.md`     | YAML frontmatter(主角性格锁、文风锁、数值系统、禁忌) + 叙事视角/冲突驱动规则 |
| `current_state`  | `story/current_state.md`  | 第0章初始状态卡(位置/状态/目标/限制/敌我/冲突)               |
| `pending_hooks`  | `story/pending_hooks.md`  | 初始伏笔池(空的表格结构)                                     |

**生成时的输入上下文**：
- `GenreProfile`（题材画像）：从 `packages/core/src/models/genre-profile.ts` 加载，包含章节类型、疲劳词、数值系统标记、审计维度等
- 用户提供的 `externalContext`（如有）
- `webnovelTemplate`（如选了 xuanhuan 模板，会注入额外的玄幻专属提示）

---

### 四、审核机制：`FoundationReviewerAgent`

文件：`packages/core/src/agents/foundation-reviewer.ts`

生成后不是直接写入，而是经过 **5 维度审核**：

1. **核心冲突** — 是否有足够张力支撑 40 章？
2. **开篇节奏** — 前 5 章能否形成翻页驱动力？
3. **世界一致性** — 世界观是否内洽且具体？
4. **角色区分度** — 主要角色的声音和动机是否各不相同？
5. **节奏可行性** — 卷纲是否有足够变化？

评分规则：
- **80+** 通过，可以开始写作
- **60-79** 有明显问题，将审核反馈传回 ArchitectAgent 重新生成
- **<60** 方向性错误，重新设计

最多重试 **2 次**，仍不通过则接受最后一次结果（避免无限循环）。

---

### 五、骨架写入：`writeFoundationFiles()`

除了上面 5 个核心文件外，还会额外初始化：

| 文件                             | 条件          | 说明                           |
| -------------------------------- | ------------- | ------------------------------ |
| `story/particle_ledger.md`       | 有数值系统时  | 资源账本(期初值/变动/期末值)   |
| `story/subplot_board.md`         | 始终          | 支线进度板                     |
| `story/emotional_arcs.md`        | 始终          | 情感弧线                       |
| `story/character_matrix.md`      | 始终          | 角色矩阵(每个角色一个 `##` 块) |
| `story/genre_profile.yaml`       | xuanhuan 模板 | 题材画像                       |
| `story/arc_map.yaml`             | xuanhuan 模板 | 弧线图                         |
| `story/power_system.yaml`        | xuanhuan 模板 | 力量体系                       |
| `story/foreshadow_registry.json` | xuanhuan 模板 | 伏笔注册表                     |

---

### 六、控制文档初始化：`ensureControlDocumentsAt()`

文件：`packages/core/src/state/manager.ts`

| 文件                     | 说明                                             |
| ------------------------ | ------------------------------------------------ |
| `story/author_intent.md` | 作者长期意图（如用户提供了就用用户的，否则占位） |
| `story/current_focus.md` | 当前聚焦（接下来1-3章重点）                      |
| `story/runtime/`         | 运行时产物目录                                   |
| `story/snapshots/`       | 快照目录                                         |
| `story/state/`           | 真相文件目录（7 个 JSON）                        |
| `chapters-fixed/`        | 章节定稿目录                                     |

---

### 七、Studio 对话式创建的额外流程

文件：`packages/core/src/interaction/session.ts`

Studio 支持渐进式打磨，用 `BookCreationDraft` 模型：

```
concept → title → genre → platform → blurb → worldPremise → 
protagonist → supportingCast → conflictCore → volumeOutline → constraints
```

每轮对话 LLM 会分析当前草案的 `missingFields`，逐步追问补全，直到 `readyToCreate = true` 才触发正式创建。

---

### 八、完整流程图

```
用户输入书名/题材
      │
      ▼
PipelineRunner.initBook()
      │
      ├─ 1. 加载 GenreProfile（题材特征）
      │
      ├─ 2. ArchitectAgent.generateFoundation()
      │     │  一次 LLM 调用，生成 5 个 SECTION
      │     │  ┌─ story_bible（世界观+主角+势力+地理+简介）
      │     │  ├─ volume_outline（卷纲+黄金三章）
      │     │  ├─ book_rules（性格锁+文风锁+禁忌+叙事规则）
      │     │  ├─ current_state（第0章状态卡）
      │     │  └─ pending_hooks（伏笔池结构）
      │
      ├─ 3. FoundationReviewerAgent.review()
      │     5维度评分 → <80分则反馈回Architect重做（最多2次）
      │
      ├─ 4. writeFoundationFiles()
      │     写入核心5文件 + 补充文件(character_matrix等)
      │
      ├─ 5. ensureControlDocumentsAt()
      │     写入 author_intent / current_focus / runtime/
      │
      ├─ 6. snapshot(0) + 空章节索引
      │
      └─ 7. rename 临时目录 → 正式目录（原子性）
```

---

### 关键代码文件速查

| 功能                 | 文件                                              |
| -------------------- | ------------------------------------------------- |
| CLI 创建命令         | `packages/cli/src/commands/book.ts`               |
| 管线核心             | `packages/core/src/pipeline/runner.ts`            |
| 建筑师代理(生成骨架) | `packages/core/src/agents/architect.ts`           |
| 基础审核代理         | `packages/core/src/agents/foundation-reviewer.ts` |
| 状态管理(控制文档)   | `packages/core/src/state/manager.ts`              |
| 自然语言路由         | `packages/core/src/interaction/nl-router.ts`      |
| 对话式创建会话       | `packages/core/src/interaction/session.ts`        |
| 书籍配置模型         | `packages/core/src/models/book.ts`                |
| 题材画像模型         | `packages/core/src/models/genre-profile.ts`       |

总结：整个骨架构建的精髓在于 **一次 LLM 调用生成 5 个核心设定 + 审核循环确保质量 + 原子性写入保证一致性**。世界观、大纲、人设不是分开生成的，而是在 ArchitectAgent 的系统提示词中被统一规划，确保各部分自洽。



## 支持的题材