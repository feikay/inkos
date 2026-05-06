# 续写

```bash
cd my-novel

# 写新章
node ../packages/cli/dist/index.js write next 葬渊魔经

-----------------------------
# 连续性自动检测+自动修复
node ../packages/cli/dist/index.js review continuity-auto --book 葬渊魔经 --chapter 84 --max-fix-attempts 2

# 番茄质量检测：爽点 / 节奏 / 钩子
node ../packages/cli/dist/index.js review fanqie-quality --book 葬渊魔经 --chapter 84

# 优化爽点/节奏（单章） 
node ../packages/cli/dist/index.js review fanqie-polish --book 葬渊魔经 --chapter 84 --max-polish-attempts 2
# 批量优化（可选）
node ../packages/cli/dist/index.js review fanqie-polish --book 葬渊魔经 --from 2 --to 200
--------------------------------
# 综合输出（单章） 包含 continuity-auto -> fanqie-quality -> fanqie-polish -> continuity-auto
node ../packages/cli/dist/index.js review publish-ready --book 葬渊魔经 --chapter 84
# 综合输出（批量） 包含 continuity-auto -> fanqie-quality -> fanqie-polish -> continuity-auto
node ../packages/cli/dist/index.js review publish-ready --book 葬渊魔经 --from 2 --to 200

cd ..

# 导出番茄
node scripts/fanqie/export-fanqie.mjs 葬渊魔经 --incremental --title "气血为0，我却能撬动规则"

# 6段节奏修复（6段检查Hook / Pressure / Attempt / Twist / Payoff / Pull）
node scripts/fanqie/repair-fanqie.mjs 葬渊魔经 --apply

cd my-novel

# 6段修复后再查连续性 --max-fix-attempts不带时默认2 
# --max-fix-attempts 0 时强制自动重写salvage
node ../packages/cli/dist/index.js review continuity-auto --book 葬渊魔经 --from 2 --to 200 --max-fix-attempts 2

cd ..

# 全量重新导出
node scripts/fanqie/export-fanqie.mjs 葬渊魔经 --from 1 --to 999 --use-reviewed --title "气血为0，我却能撬动规则"
```

```bash
# 手动重写策略
#####################
正常章节：
write
→ continuity-auto
→ PASS → export

一般问题：
auto 自动修

严重问题：
auto 修 2 次
→ MANUAL_REVIEW

极端问题：
你才用 continuity-fix 手动处理
#####################

# 修复连贯性问题（轻微断链 70 ≤ score < 85 修复指定章节）
node ../packages/cli/dist/index.js review continuity-fix --book 葬渊魔经 --chapter 84
# 修复连贯性问题（严重断链 score < 70 章节重写）
cp my-novel/books/葬渊魔经/chapters-salvaged/0019_salvage.md my-novel/books/葬渊魔经/chapters/0019_xxx.md
node ../packages/cli/dist/index.js review continuity-auto --book 葬渊魔经 --chapter 19

```

```bash
# 番茄推荐机制优化（爽点+节奏+钩子检测）
#单章检测：
node ../packages/cli/dist/index.js review fanqie-quality --book 葬渊魔经 --chapter 84

#批量检测：
node ../packages/cli/dist/index.js review fanqie-quality --book 葬渊魔经 --from 2 --to 200

# fanqie-quality: score >= 85 不用
# fanqie-quality: score in 70~84
node ../packages/cli/dist/index.js review fanqie-polish --book 葬渊魔经 --chapter 84
# fanqie-quality: score < 70 两次 走 salvage
node ../packages/cli/dist/index.js review continuity-auto --book 葬渊魔经 --from 2 --to 200 --max-fix-attempts 0

```

# 重写
```bash
cd my-novel

rm books/葬渊魔经/reviews/continuity/0019.final-report.json
rm books/葬渊魔经/reviews/continuity/0019.salvage-report.json

node ../packages/cli/dist/index.js review continuity-auto --book 葬渊魔经 --chapter 19 --max-fix-attempts 0
```
👉 这样：
```
旧状态清空
→ 用原稿
→ 直接 salvage 重写
```
什么时候你应该“强制重写”
看到这些信号，就不要再修了：
1. score < 70 且多次修复无明显提升
2. salvage 之后仍 < 80
3. issues 出现：
   - 开头断链
   - 没有目标
   - 没有推进
4. 读起来像“说明文”

👉 结论：
❗ 这是结构问题 → 必须重写

```bash
npm run dev -- review continuity --book 葬渊魔经 --chapter 83

npm run dev -- review continuity --book 葬渊魔经 --from 2 --to 100

npm run dev -- review continuity-fix --book 葬渊魔经 --chapter 83

npm run dev -- review continuity-auto --book 葬渊魔经 --from 2 --to 100

其中：
continuity：
只检测，不修复。

continuity-fix：
只修复指定章节。

continuity-auto：
检测 → score < 85 自动修复 → 复检 → 输出最终报告。

# 正确的SOP
if score >= 85:
  → PASS

if 70 <= score < 85:
  → continuity-fix（轻修）
  → final-check

if score < 70:
  → continuity-fix（重写）
  → final-check

if final_score < 85:
  → MANUAL_REVIEW（人工处理）

# 建议
if score < 70:
  最多重写 2 次

if 仍 < 85:
  → 丢人工（不要死循环）
```



# 新开书

# ✅ 一、结论（先说清楚）

> ✔ **90%情况：新书直接复用这两个脚本**
> ❗ 只要满足“目录结构一致”

------

# 🧱 二、必须满足的前提（最关键）

------

## 📁 你的新书结构必须是：

```bash
my-novel/books/新书名/
```

里面是：

```bash
chapter-001.md
chapter-002.md
...
```

或：

```bash
001.txt
第1章.md
```

------

👉 满足这个：

# 👉 两个脚本可以直接用

------

------

# 🔁 三、你以后写新书的标准流程（建议固定）



------

## 📌 开新书

```bash
cd my-novel
node ../packages/cli/dist/index.js book create \
  --title "新" \
  --genre xuanhuan \
  --platform tomato \
  --webnovel-template xuanhuan
```

## 📌 写新书

```bash
node ../packages/cli/dist/index.js write next 新书名
```

------

## 📌 导出发布版（番茄）

```bash
node scripts/fanqie/export-fanqie.mjs 新书名 --incremental --title "你的新书标题"
```

------

## 📌 自动修复

```bash
node scripts/fanqie/repair-fanqie.mjs 新书名 --apply
```

------

## 📌 再检查

```bash
node scripts/fanqie/export-fanqie.mjs 新书名 --from 1 --to 999 --title "你的新书标题"
```

------

👉 这套流程：

# 🔥 可以复用所有书

------

------

# ⚠️ 四、什么时候需要“微调脚本”

------

## 🟡 情况1：题材变化很大

比如你从：

- 玄幻（现在）
  👉 切到
- 都市 / 言情

------

👉 影响的是：

```js
pickImpactLine()
sixPartCheck()
```

------

👉 例如：

现在关键词：

```text
门 / 契约 / 血 / 规则
```

------

👉 都市应该改成：

```text
钱 /公司 /合同 /女人 /背叛
```

------

👉 否则：

# ❗ 检测会不准

------

------

## 🟡 情况2：你换平台

比如：

- 番茄小说
  👉 换
- 起点中文网

------

👉 影响：

- 字数要求
- 标题风格
- 节奏密度

------

------

## 🟡 情况3：你写多本书（矩阵）

👉 建议加一个功能：

```bash
--all
```

一键导出所有书（后面可以帮你加）

------

------

# 🧠 五、一个你现在必须理解的关键点

------

> ❗脚本是“结构工具”，不是“内容工具”

------

👉 它做的是：

- ✔ 清洗
- ✔ 检查
- ✔ 修结构

------

👉 它不做：

- ❌ 创意
- ❌ 人设
- ❌ 爆点设计

------

------

# 🎯 六、你未来最佳状态（给你一个目标）

------

你后面应该达到：

```text
写一章 → 跑脚本 → 自动修 → 发布
```

------

👉 不再：

```text
写一章 → 改半天 → 犹豫 → 不发
```

------

------

# 🚀 七、如果你想再升级（下一步）

你可以把这套系统升级成：

------

## 🔥 多书引擎

```bash
books/
├── A书
├── B书
├── C书
```

------

👉 每本书：

```bash
每天自动：
生成 → 检查 → 修复 → 发布
```

------

👉 这就是：

# 💰 网文工作室模式

------

------

# 🎯 最后一行（非常关键）

> ❗这两个脚本的价值不在“能不能用”，
> 而在——**你能不能每天用它产出内容**

------

------

如果你下一步想更狠一点：

👉 我可以帮你做：

# 🔥 “多书自动调度系统（每天自动生成+修复+提醒发布）”

让你直接进入**批量产书模式**