---
name: fanqie-novel-research
description: 番茄小说平台签约过审经验调研技能。当用户询问番茄小说签约审核相关问题（如签约成功率、失败原因、审核标准、题材推荐、避坑经验等），自动执行多渠道搜索和网页抓取，整理并生成结构化分析报告。
agent_created: true
---

# Fanqie Novel Research - 番茄小说平台签约调研技能

## Overview

本技能用于快速生成番茄小说平台签约过审经验报告。通过多渠道（知乎、贴吧、smzdm、百度文库、官方文档、CSDN等）搜集社区真实反馈，整理签约审核的成功与失败原因、审核标准、题材偏好等关键信息。

## When to Use

用户询问以下类型问题时触发：
- 番茄小说签约审核相关问题
- 签约成功率/失败原因
- 审核标准/偏向
- 题材推荐/避坑经验
- 短篇/长篇签约区别
- 平台规则/推荐机制
- 特定题材是否适合番茄

## Workflow

### Step 1: 多渠道并行搜索

使用 `WebSearch` 并行执行多个搜索查询，覆盖不同信息源：

```
# 必搜 - 签约失败/成功原因
"番茄小说签约审核 失败 原因 经验 作者 2025 2026"
"番茄小说签约 成功 技巧 字数 类型 社区讨论"
"番茄小说签约被拒 常见原因 开篇 前三章 毒点 社区反馈"

# 补充 - 审核机制/题材/收益
"番茄小说 签约审核 标准 文笔 剧情 人设 套路 经验"
"番茄小说 编辑审核 看重什么"
""番茄小说" "全勤奖" "2026" 日更 4000 6000 800 稿费"
"番茄小说 2026 新规 AI内容 审核标准 变化"

# 新动态 - 短剧IP/生态
"番茄小说 签约 短篇 短剧改编 2026 新趋势"
"番茄小说 2026年签约 审核标准 毒点 红线和禁区 最新"
```

### Step 2: 关键页面内容抓取

对搜索结果中的高价值链接使用 `WebFetch` 抓取完整内容：

优先抓取目标：
1. smzdm.com - 社区经验整理类文章
2. php.cn / jinshouji / 百度文库 - 规则详解类文章
3. fanqienovel.com 官方文档 - 官方规则、福利政策、活动公告
4. gzdangaopeixun / maliangwriter - 新人收入与实操指南
5. cenr.com.cn / 凤凰财经 - 平台生态与短剧IP产业报道
6. CSDN / 简书 - 经验分享类文章
7. github.com - 平台规则整理（如有）

> ⚠️ 注意：知乎、贴吧、头条多数页面需登录或有反爬机制，WebFetch 会失败，跳过或直接使用搜索摘要中的信息。

### Step 3: 信息提取与整理

从抓取的内容中提取以下关键信息：

1. **审核机制**
   - 两轮审核：安全审核（3-7天）+ 签约评估（5-14天）
   - 三次机会制：2万/5万/8万字各一次
   - 安全审核失败不占次数；签约评估失败需增量更新

2. **失败原因**
   - 开篇节奏慢（前三章没立住人设/没抛核心冲突）
   - 题材踩线（灵异、校园暴力、过度黑化）
   - 文本硬伤（大段无标点、错别字密集）
   - 断更/更新不稳定

3. **成功经验**
   - 黄金三章结构
   - 爽点密度要求
   - 题材偏好方向
   - 更新节奏建议

4. **题材分析**
   - 高成功率题材（都市异能、系统、重生、穿越）
   - 高风险题材（纯灵异、校园暴力、慢热武侠）
   - 2026年五大热门题材

5. **平台动态与收益**
   - 2025-2026年新规（AI声明/封禁、签约门槛提高）
   - 2026年全勤改制（取消阅读量挂钩、纯码字全勤、基础稿费+80%）
   - 2026年发布限制（日/月新建作品数与字数上限）
   - 短篇签约通道与「千字万金」计划
   - **短剧IP改编生态**：20亿加码计划、最高单书300万、百万IP护航
   - 新人真实收入区间与增收建议

### Step 4: 报告生成

按以下结构组织报告输出：

```markdown
## 📋 [报告标题]

### 一、整体签约情况
- 官方数据/社区反馈数据
- 核心规律

### 二、两轮审核机制
- 安全审核 vs 签约评估
- 时限对比
- 关键规则（次数限制、不占次数情况）

### 三、签约失败原因（社区高频踩坑）
- 四大原因+排名
- 具体表现+应对建议

### 四、三次机会制
- 时间节点
- 硬规则说明

### 五、[用户关注的具体主题]
根据用户问题调整重点，如：
- 短篇签约通道
- 题材偏好
- 成功经验
- 避坑指南

### 六、2026年五大热门题材
- 成功率评级
- 各题材特点

### 七、成功经验
- 黄金三章结构
- 签约后运营避坑
- 首秀策略

### 八、平台推荐机制

### 九、2026年收益与全勤规则
- 全勤奖金体系（普通600元/进阶800元）
- 硬门槛（10万字/听读500元）
- 新人真实收入
- 其他福利计划

### 十、AI治理与发布新规
- 发布限制（日/月）
- AI内容封禁政策

### 十一、短剧IP改编与新趋势
- 20亿计划
- 专项奖励
- 已有成果

### 十二、核心结论
- 一句话总结
- 针对性建议
```

### Step 5: 知识库更新与同步

1. 将今日调研核心发现更新到 `~/.workbuddy/skills/fanqie-novel-research/references/knowledge_base.md`（整体覆写）
2. 如发现已有知识库过时，更新对应章节
3. **同步到 InkOS 项目**（每次更新 knowledge_base.md 后必须执行）：
   ```bash
   # 同步 knowledge_base.md
   cp ~/.workbuddy/skills/fanqie-novel-research/references/knowledge_base.md \
      ~/Documents/mycode/node-workspace/inkos/skills/fanqie-novel-research/references/knowledge_base.md
   cp ~/.workbuddy/skills/fanqie-novel-research/references/knowledge_base.md \
      ~/Documents/mycode/node-workspace/inkos/.skills/fanqie-novel-research/references/knowledge_base.md
   # 同步 SKILL.md（如 SKILL.md 也有变更）
   cp ~/.workbuddy/skills/fanqie-novel-research/SKILL.md \
      ~/Documents/mycode/node-workspace/inkos/skills/fanqie-novel-research/SKILL.md
   cp ~/.workbuddy/skills/fanqie-novel-research/SKILL.md \
      ~/Documents/mycode/node-workspace/inkos/.skills/fanqie-novel-research/SKILL.md
   ```
4. 完成后标记任务为完成

## Important Notes

- 知乎/贴吧/头条多数页面需登录或有反爬机制，WebFetch 会失败，直接使用搜索摘要中的信息
- 社区经验来源于非官方渠道，仅供参考
- 番茄平台规则经常变化，优先搜集最新（2025-2026年）信息
- 如用户特别关注某个题材，搜索时加入该题材关键词
- 新增关注方向：全勤改制、AI封禁、短剧IP化、20亿生态计划

## Resources

### references/
- `knowledge_base.md` - 已整理的番茄小说平台签约审核知识库，包含权威来源验证过的规则和经验
