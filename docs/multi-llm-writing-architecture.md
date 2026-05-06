# Multi-LLM Writing Architecture

本文档记录当前 InkOS 写书流水线的实际 agent/task、已具备的模型路由能力，以及升级到多模型协作写书流水线的最小改造边界。

## 当前写书流水线

长篇主流水线由 `PipelineRunner` 组织，核心 agent/task 如下：

| agent/task | 当前用途 | 适合的模型类型 |
|---|---|---|
| `architect` | 创建书籍、世界观、人设、规则、基础设定 | 强逻辑、强结构化模型 |
| `foundation-reviewer` | 审查 foundation 文件完整性与一致性 | 低温稳定审稿模型 |
| `planner` | 生成章节意图、目标、信息增量、伏笔计划 | 强推理、强规划模型 |
| `composer` | 将章节计划整理成正文可用的 governed context | 强推理、结构整理模型 |
| `writer` | 生成正文草稿、补写、续写 | 网文味强、表达鲜活的正文模型 |
| `auditor` | 连续性审查、质量审查、风险检查 | 低温稳定审稿模型 |
| `reviser` | 按审稿意见修复、改写、润色 | 平衡型改稿模型 |
| `chapter-analyzer` | 分析既有章节、提取状态与事实 | 低温抽取、稳定分析模型 |
| `state-validator` | 验证章节后状态更新是否可信 | 低温稳定校验模型 |
| `length-normalizer` | 按长度治理补短、截长、归一化 | 稳定改稿模型 |
| `radar` | 趋势雷达、题材观察 | 搜索/总结能力强的模型 |
| `fanfic-canon-importer` | 同人正典导入 | 长上下文抽取模型 |

Review 相关命令中还存在这些 task：

| task | 当前用途 | 适合的模型类型 |
|---|---|---|
| `fanqie-quality` | 番茄风格发布前质量检测 | 低温审稿模型 |
| `fanqie-polish` | 对低分章节做番茄向轻/重润色 | 平衡型改稿模型 |
| `publish-ready` | 发布前连续性、质量、候选稿选择 | 低温稳定审稿模型 |
| `continuity-auto` | 连续性检测与自动修复循环 | 审稿模型 + 改稿模型 |

短故事当前主要是确定性工具函数，不是 `BaseAgent` 子类，也没有独立 LLM client 路由。实际存在的模块/task 包括：

| short-story task | 当前用途 |
|---|---|
| `world-builder` | 生成短故事基础世界与名字变体 |
| `chapter-plan` | 创建章节字数与节拍计划 |
| `writer` | 从计划生成短故事草稿章节 |
| `publish-optimizer` / `title` | 优化开头、生成标题、导出发布包 |
| `publish-optimizer` / `script` | 生成短视频推广脚本 |
| `auditor` | 审计短故事章节数、总字数、结构约束 |
| `variant` | 生成 batch/run 变体 |

## 当前代码已支持什么

- `inkos.json` 已有 `modelOverrides`。
- 旧写法兼容：`"writer": "xxx-model"`。
- object 写法已支持 `provider`、`model`、`baseUrl`、`apiKeyEnv`、`stream`。
- `PipelineRunner` 通过 `agentCtxFor(agentName)` 在长篇 agent 层解析 override。
- CLI `buildPipelineConfig` 会把 `config.modelOverrides` 传给 `PipelineRunner`。
- 不配置 `modelOverrides` 时，所有 agent 使用项目默认 `llm.model` 和默认 client。

## 当前缺什么

- CLI 原先只暴露少数 agent，缺少 `planner`、`composer`、`state-validator`、`foundation-reviewer`、`length-normalizer` 等实际 pipeline agent。
- object override 原先不能保存 `temperature`、`maxTokens`。
- 只有换 `baseUrl` 时才会创建独立 client，因此仅配置 `temperature`、`maxTokens`、`stream` 时不会影响该 agent 的默认生成参数。
- review 命令的 `fanqie-quality`、`fanqie-polish`、`publish-ready` 当前仍主要使用 review runtime 的默认 client/model，不是统一 `PipelineRunner` agent routing。
- 短故事当前是确定性流水线，尚未进入 LLM agent routing。

## 最小改造方案

本轮只做配置基础能力，不改正文生成逻辑、不改导出逻辑、不改 Studio。

- 扩展 `AgentLLMOverride` 类型：

```ts
{
  provider?: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}
```

- 保留旧 string 写法，`"writer": "xxx-model"` 仍解析为“只换 model，复用默认 client”。
- object 写法如果只写 `{ "model": "xxx-model" }`，行为等价于只换 model。
- object 写法如果包含 `provider`、`baseUrl`、`apiKeyEnv`、`stream`、`temperature`、`maxTokens` 任一字段，则创建该 agent 的派生 client。
- `temperature/maxTokens` 进入 client defaults。底层单次调用如果显式传了 temperature/maxTokens，仍以单次调用为准。
- CLI `inkos config set-model <agent> <model>` 改为通用 agent/task 名称，已知 agent 只作为提示，不再作为过窄白名单。
- CLI 增加 `--temperature`、`--max-tokens`，并保留 `--provider`、`--base-url`、`--api-key-env`、`--stream/--no-stream`。

## 示例配置

```json
{
  "modelOverrides": {
    "architect": {
      "provider": "openai",
      "model": "strong-logic-model",
      "temperature": 0.2
    },
    "planner": {
      "provider": "openai",
      "model": "strong-logic-model",
      "temperature": 0.25
    },
    "writer": {
      "provider": "custom",
      "model": "webnovel-style-model",
      "temperature": 0.65
    },
    "auditor": {
      "provider": "deepseek",
      "model": "stable-review-model",
      "temperature": 0.1
    },
    "reviser": {
      "provider": "custom",
      "model": "balanced-rewrite-model",
      "temperature": 0.35
    }
  }
}
```

## 后续 Task-Level Model Routing

下一阶段建议把 agent-level routing 扩展为 task-level routing，但保持兼容优先级：

1. `taskOverrides["writer.draft"]`
2. `taskOverrides["writer.rewrite-opening"]`
3. `modelOverrides["writer"]`
4. 默认 `llm.model`

建议新增配置形态：

```json
{
  "taskOverrides": {
    "planner.chapter-plan": {
      "model": "strong-reasoning-model",
      "temperature": 0.2
    },
    "writer.chapter-draft": {
      "model": "webnovel-style-model",
      "temperature": 0.75
    },
    "auditor.continuity": {
      "model": "stable-review-model",
      "temperature": 0.1
    },
    "reviser.fanqie-polish": {
      "model": "balanced-rewrite-model",
      "temperature": 0.35
    },
    "marketing.title": {
      "model": "marketing-title-model",
      "temperature": 0.8
    },
    "marketing.script": {
      "model": "short-video-script-model",
      "temperature": 0.7
    }
  }
}
```

实现上可新增 `resolveModelRoute({ agent, task })`，先只供新调用点使用。旧 `agentCtxFor(agent)` 保持为 agent-level 兼容入口。

## 不允许破坏的现有能力

- 番茄长篇写作命令。
- 短故事 `plan/write/hook/titles/export/script/batch/collect/rank/analyze/audit` 命令。
- `publish-ready`。
- `continuity-auto`。
- `fanqie-quality`。
- `fanqie-polish`。
- 旧 `modelOverrides` string 配置。
- 未配置 override 时的默认模型、默认 temperature、默认 maxTokens、默认 stream 行为。
- 正文生成逻辑与导出逻辑。
- Studio UI 与 Studio 现有配置接口。
