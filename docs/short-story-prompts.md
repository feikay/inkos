## 写书

```bash
# 生成原文
npm run dev -- short-story generate --theme 悬疑惊悚 --target-words 50000

# 导出发布 my-novel/short-stories/<theme>/publish/
npm run dev -- short-story export --theme 悬疑惊悚

# 生成抖音推文 my-novel/short-stories/<theme>/scripts/script.txt
npm run dev -- short-story script --theme 悬疑惊悚

# 评分系统
npm run dev -- short-story analyze --theme 悬疑惊悚

# 批量生成
npm run dev -- short-story batch \
  --themes 悬疑惊悚,出轨复仇 \
  --count 3 \
  --target-words 50000
  
# 数据采集（非爬虫，手工输入）
npm run dev -- short-story collect --theme 悬疑惊悚 --run run-20260429-092059-01
### 输入
{
  "theme": "悬疑惊悚",
  "run": "run-20260429-092059-01",
  "collectedAt": "...",
  "views": 1000,
  "clicks": 120,
  "CTR": 0.12,
  "completion": 0.68,
  "likes": 88,
  "follows": 12
}
### 输出 run-001/metrics.json

# 分析 + 选优
npm run dev -- short-story rank --theme 悬疑惊悚
# 输出
Top Runs:
1. run-002  CTR: 9.2%  完读: 71%  ⭐ 推荐放大
2. run-001  CTR: 6.1%  完读: 62%
3. run-003  CTR: 3.8%  ❌ 淘汰
```

```
# 评分输出
Story Analysis Report

[标题评分]：8.5 / 10
- 优点：冲突明确
- 问题：略长

[开头评分]：9.2 / 10
- 50字内有异常 ✔
- 150字内有悬念 ✔

[节奏评分]：7.8 / 10
- 中段稍慢 ⚠

[爽点/悬念密度]：
- 平均 320字/爆点 ✔

[预测完读率]：
- 中高（60%~75%）

建议：
- 第3章压缩
- 第1章再强化结尾钩子
```

```
# 批量生成输出结构
my-novel/short-stories/
  ├── 悬疑惊悚/
  │   ├── run-001/
  │   ├── run-002/
  │   └── run-003/
  └── 出轨复仇/
```



## 标题生成器

```
【任务】为短故事生成番茄爆款标题

【输入】
主题：出轨复仇
剧情：林晚宴会曝光丈夫出轨

【输出】
生成10个标题，要求：

1. 必须包含：
   - 人物关系（妻子 / 丈夫 / 闺蜜）
   - 冲突（出轨 / 背叛 / 曝光）
   - 结果（打脸 / 反转 / 崩溃）

2. 风格：
   - 强情绪
   - 口语化
   - 有画面感

3. 示例格式：
   - 《她在十周年宴会上播放丈夫出轨录像，全场炸了》
   - 《我在婚礼上曝光老公和闺蜜的聊天记录，他跪了》

【目标】
提升点击率
```

## Hook强化器

```
【任务】强化 short-story 第一章的前300字

【目标】
提升点击率 + 留存率

【要求】

1. 前50字必须：
   - 直接冲突
   - 不铺垫背景

2. 前150字：
   - 出现反常识事件（例如：当众曝光）

3. 前300字：
   - 必须出现第一次反转

4. 删除：
   - 心理铺垫
   - 环境描写
   - 无效过渡

5. 风格：
   - 短句
   - 对话驱动
   - 强情绪

【目标效果】
让读者3秒内被抓住
```

## 制作推文

```
【任务】生成抖音推文版本（短视频脚本）

【输入】
第1章 + 标题

【输出】

1. 拆成 15～25 条短句
2. 每句 15~30 字
3. 每句一个情绪点

格式：

1. 结婚十周年那天，我当众放了一段视频
2. 大屏亮起，全场瞬间安静
3. 视频里，是我老公和我闺蜜
...

【要求】

- 每3句一个小爆点
- 每6句一个反转
- 最后一句必须留悬念

【目标】
用于抖音小说推文
```

