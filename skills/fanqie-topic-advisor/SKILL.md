---
name: fanqie-topic-advisor
description: 番茄小说选题建议技能。当用户询问选题、题材推荐、新建书籍建议时，自动结合平台热点和系统支持题材，生成个性化选题建议。
agent_created: true
depends: [fanqie-novel-research]
---

# Fanqie Topic Advisor - 番茄小说选题建议技能

## Overview

本技能用于在新书创作前，结合番茄平台最新热点和 InkOS 系统支持的题材，生成个性化选题建议。

**核心思路**：选题建议 = 平台热点 ∩ 系统支持题材（只推荐系统能写的题材）

**与原 skill 的关系**：
- `fanqie-novel-research`：独立调研平台规则、签约经验（可单独使用）
- `fanqie-topic-advisor`：基于前者数据 + 系统能力，给出选题建议（依赖前者）

---

## When to Use

用户询问以下类型问题时触发：

- "帮我确定一下最近选题倾向"
- "我想写新书，给我一些建议"
- "最近番茄什么题材好签？"
- "我想创建一个新项目，应该怎么选题材？"
- "帮我分析一下当前热门题材"
- "结合我的系统能力，推荐几个题材"
- "新建书籍，选什么题材容易过签？"

---

## Workflow

### Step 1: 检查知识库是否需要更新

读取 `skills/fanqie-novel-research/references/knowledge_base.md` 的最后更新时间（文件顶部有"最后更新：YYYY-MM-DD"）：

- **距离今天 > 7天** → 执行 Step 1.5 更新知识库
- **距离今天 ≤ 7天** → 直接进入 Step 2

#### Step 1.5: 更新知识库（如需要）

按照 `fanqie-novel-research` skill 的 Workflow 执行一次完整调研：

1. 多渠道并行搜索（WebSearch）
2. 关键页面内容抓取（WebFetch）
3. 信息提取与整理
4. 更新 `knowledge_base.md`

> 如果 WebSearch/WebFetch 工具不可用，直接使用现有知识库并注明"知识库可能过期"

---

### Step 2: 读取系统支持的中文题材

扫描 `packages/core/genres/*.md`，**通过读取文件内容判断是否是中文题材**。

**判断标准**：读取每个文件的 frontmatter 中的 `name` 字段：
- 如果 `name` 包含中文字符 → 中文题材 ✅ 读取
- 如果 `name` 全是英文 → 英文题材 ❌ 忽略

```bash
# 伪代码：读取所有 genre 文件，过滤中文题材
for file in packages/core/genres/*.md:
    read frontmatter:
        name → 题材名称
    
    # 判断 name 是否包含中文
    if containsChinese(name):
        read all frontmatter:
            id          → 题材ID（文件名去掉.md）
            name        → 题材中文名
            chapterTypes    → 支持的章节类型
            pacingRule  → 节奏规则
            satisfactionTypes → 爽点类型
            fatigueWords    → 疲劳词列表
            auditDimensions  → 审计维度
        save to supportedGenres[]
```

**示例判断结果**：

| 文件名 | name 字段 | 是否中文 | 处理 |
|-------|----------|---------|------|
| `xuanhuan.md` | "玄幻" | ✅ 中文 | 读取 |
| `system.md` | "系统流" | ✅ 中文 | 读取 |
| `rebirth.md` | "重生流" | ✅ 中文 | 读取 |
| `urban.md` | "都市" | ✅ 中文 | 读取 |
| `xianxia.md` | "仙侠" | ✅ 中文 | 读取 |
| `isekai-zh.md` | "穿越/穿书" | ✅ 中文 | 读取 |
| `cultivation.md` | "English Cultivation" | ❌ 英文 | 忽略 |
| `litrpg.md` | "LitRPG" | ❌ 英文 | 忽略 |
| `horror.md` | "Horror" | ❌ 英文 | 忽略 |

将结果存入内存中的 `supportedGenres` 列表，格式：

```json
[
  {
    "id": "xuanhuan",
    "name": "玄幻",
    "chapterTypes": ["战斗章", "布局章", "过渡章", "回收章"],
    "pacingRule": "三章内必有明确反馈",
    "satisfactionTypes": ["打脸", "升级突破", "收益兑现"],
    "auditDimensions": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 24, 25, 26]
  },
  {
    "id": "system",
    "name": "系统流",
    "chapterTypes": ["任务章", "升级章", "布局章", "过渡章", "回收章"],
    "pacingRule": "每1-3章一次系统反馈",
    "satisfactionTypes": ["升级突破", "技能解锁", "任务完成"],
    "auditDimensions": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 24, 25, 26]
  },
  ...
]
```

---

### Step 3: 读取平台热点（来自知识库）

从 `skills/fanqie-novel-research/references/knowledge_base.md` 中提取：

1. **第六节"2026年五大热门题材"**（或最新日期的对应章节）
   - 题材名称
   - 代表类型
   - 特点
   - 成功率评级

2. **签约失败原因**（第三节）
   - 高风险题材列表
   - 2025年新增风险

3. **短篇签约通道**（第五节，如适用）
   - 题材偏好
   - 避坑建议

存入 `platformHotTopics` 列表。

---

### Step 4: 题材匹配

将 `platformHotTopics` 与 `supportedGenres` 做匹配。

#### 匹配规则

**精确匹配**：题材ID 或 题材中文名 完全一致

**关键词映射**（平台热点词 → 系统题材ID）：

| 平台热点词 | 系统题材ID | 备注 |
|-----------|-----------|------|
| 都市异能 | urban | 都市背景 |
| 系统 | system | 精确匹配 |
| 重生复仇 | rebirth | 精确匹配 |
| 重生 | rebirth | 精确匹配 |
| 穿越 | isekai-zh | 中文穿越 |
| 穿书 | isekai-zh | 归入穿越类 |
| 无限流 | tower-zh | 塔/副本类 |
| 轻喜 | urban | 都市轻喜剧 |
| 职场 | urban | 都市职场 |
| 玄幻 | xuanhuan | 精确匹配 |
| 修仙 | xianxia | 精确匹配 |
| 修真 | cultivation | 精确匹配 |
| 末世 | apocalypse | 精确匹配 |
| 游戏 | gaming | 精确匹配 |
| 悬疑 | mystery | 精确匹配 |
| 恐怖 | horror | 精确匹配 |
| 科幻 | sci-fi | 精确匹配 |
| 历史 | historical | 精确匹配 |
| 言情 | romance-zh | 精确匹配 |

**匹配结果分类**：

```
匹配结果
  ├─ ✅ 系统支持 + 平台热点 → recommendedList（优先推荐）
  ├─ ✅ 系统支持 + 平台非热点 → alternativeList（次选）
  └─ ❌ 系统不支持 + 平台热点 → unsupportedList（提示无法生成）
```

---

### Step 5: 生成选题建议报告

按"输出格式"部分的结构生成报告。

**排序规则**：
1. 匹配度（系统支持 + 平台热点 > 仅系统支持）
2. 平台签约成功率（高 > 低）
3. 系统支持完整度（有完整 genre 画像 > 只有基础配置）

---

### Step 6:（可选）记录建议历史

将本次建议记录到 `references/topic_history.md`：

```markdown
## YYYY-MM-DD

**知识库版本**：skills/fanqie-novel-research/references/knowledge_base.md (最后更新：YYYY-MM-DD)

**推荐题材**：
1. [题材ID] - [理由]
2. [题材ID] - [理由]

**用户反馈**：（待填写）
```

---

## 输出格式

```markdown
## 📊 选题建议报告 (YYYY-MM-DD)

> 知识库版本：skills/fanqie-novel-research/references/knowledge_base.md
> 最后更新：YYYY-MM-DD（如超过7天，已自动更新）

---

### 一、推荐选题（✅ 系统支持 + 平台热点）

#### 🎯 最推荐：[题材中文名] ([题材ID])

- **平台表现**：签约率 XX%，算法友好度 ⭐⭐⭐⭐⭐
- **系统支持**：✅ 完整 genre 画像
- **写作要点**（来自 genre 文件）：
  - 节奏规则：[pacingRule]
  - 核心爽点：[satisfactionTypes]
  - 章节类型：[chapterTypes]
- **题材禁忌**（来自 genre 文件）：
  - ❌ [禁忌1]
  - ❌ [禁忌2]
  - ❌ [禁忌3]
- **平台避坑**（来自知识库）：
  - ⚠️ [平台特定避坑1]
  - ⚠️ [平台特定避坑2]

#### 🔄 次推荐：[题材2中文名] ([题材ID])

[同上结构]

---

### 二、系统支持但平台非热点（⚠️ 谨慎选择）

| 题材 | 平台表现 | 说明 |
|-----|---------|------|
| [题材中文名] ([题材ID]) | 签约率下降/竞争激烈 | [原因，来自知识库] |

> 这些题材系统可以写，但当前平台表现一般，签约难度可能较大。

---

### 三、平台热点但系统不支持（❌ 暂无法生成）

以下题材平台热门，但系统暂无 genre 画像：

| 平台热点题材 | 建议 |
|-----------|------|
| [题材名称] | 系统暂不支持，可手动创作或使用 `other` genre |
| [题材名称] | 需要新增 genre 支持 |

> 如果你仍想写这些题材，可以：
> 1. 使用通用 genre (`other.md`) 手动创作
> 2. 联系开发者新增对应 genre 支持

---

### 四、下一步

你想选哪个题材？选好后我可以帮你：

1. **生成世界观设定（variant）** - 基于 genre 画像生成
2. **创建 book.json** - 自动填充 genre 配置
3. **生成前3章大纲** - 符合该题材的 `pacingRule`

请告诉我你的选择，或直接说"就选 [题材ID]"。
```

---

## Important Notes

1. **知识库过期处理**：
   - 知识库超过7天未更新时，优先尝试更新
   - 如果 WebSearch/WebFetch 不可用，直接使用现有知识库并注明"知识库可能过期，建议手动更新"

2. **题材匹配容错**：
   - 如果平台热点词在映射表中找不到，尝试模糊匹配（包含关键词）
   - 如果仍然找不到，归入 `unsupportedList` 并提示

3. **输出简洁性**：
   - 每个推荐题材的"写作要点"和"题材禁忌"直接从 genre 文件提取，不要改写
   - 保持输出结构清晰，便于用户快速扫描

4. **不与用户争论**：
   - 如果用户选择的题材在 `unsupportedList` 中，告知风险后尊重用户选择
   - 提供替代方案（如使用 `other` genre）

5. **依赖检查**：
   - 确保 `skills/fanqie-novel-research/` 存在
   - 如果不存在，提示用户先安装 `fanqie-novel-research` skill

---

## Resources

### references/

- `topic_history.md` - 历史选题建议记录（可选，自动创建）

### 依赖

- `skills/fanqie-novel-research/SKILL.md` - 平台调研技能
- `skills/fanqie-novel-research/references/knowledge_base.md` - 平台知识库
- `packages/core/genres/*.md` - 系统支持的题材画像

---

*创建时间：2026-05-12*
*版本：1.0*
