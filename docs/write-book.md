# 续写

```bash
cd my-novel
node ../packages/cli/dist/index.js write next 葬渊魔经

node scripts/fanqie/export-fanqie.mjs 葬渊魔经 --incremental --title "气血为0，我却能撬动规则"

node scripts/fanqie/repair-fanqie.mjs 葬渊魔经 --apply

node scripts/fanqie/export-fanqie.mjs 葬渊魔经 --from 1 --to 999 --title "气血为0，我却能撬动规则"
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