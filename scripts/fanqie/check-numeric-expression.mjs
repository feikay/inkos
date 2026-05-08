#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const argv = process.argv.slice(2);
const bookName = argv[0] || "葬渊魔经";

const VALID_MODES = new Set(["immersive", "system", "light_numeric"]);
const SCAN_DIRS = [
  "chapters",
  "chapters-reviewed",
  "chapters-fixed",
  "chapters-salvaged",
];

function getArg(name, fallback = undefined) {
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const chapterArg = getArg("chapter");
const from = chapterArg ? toNumber(chapterArg, 1) : toNumber(getArg("from"), 1);
const to = chapterArg ? toNumber(chapterArg, 1) : toNumber(getArg("to"), 99999);
const modeOverride = getArg("mode");
const dryRun = hasFlag("dry-run");
const finalOnly = hasFlag("final-only");

if (modeOverride && !VALID_MODES.has(modeOverride)) {
  console.error(`--mode 仅支持：${Array.from(VALID_MODES).join(", ")}`);
  process.exit(1);
}

const bookDir = path.join(root, "my-novel", "books", bookName);
if (!fs.existsSync(bookDir)) {
  console.error(`找不到书籍目录：${path.relative(root, bookDir)}`);
  process.exit(1);
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`无法解析 JSON：${path.relative(root, file)}\n${error.message}`);
  }
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.+?)\s*$/);
    if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return data;
}

function inferMode(bookConfig, bookRules, genreProfile) {
  const explicit = bookConfig?.writingRules?.numericExpressionMode
    || bookConfig?.styleProfile?.numericExpressionMode
    || bookConfig?.numericExpressionMode;
  if (VALID_MODES.has(explicit)) return { mode: explicit, source: "book.json" };

  const corpus = [
    bookConfig?.genre,
    bookConfig?.webnovelTemplate,
    bookConfig?.title,
    bookConfig?.id,
    bookRules?.genreLock,
    genreProfile?.template,
    genreProfile?.label,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/(system|litrpg|game|panel|系统|游戏|面板)/iu.test(corpus)) {
    return { mode: "system", source: "inferred: system/game/panel keywords" };
  }

  if (/(xuanhuan|xianxia|cultivation|urban|romance|suspense|revenge|玄幻|仙侠|修炼|都市|言情|悬疑|复仇|黑暗)/iu.test(corpus)) {
    return { mode: "immersive", source: "inferred: immersive genre keywords" };
  }

  return { mode: "immersive", source: "default: unknown genre" };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const file = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(file) : [file];
  });
}

function getChapterNo(file) {
  const name = path.basename(file);
  const match = name.match(/^0*(\d+)(?:[_\-.].*)?\.(md|txt)$/i);
  return match ? Number(match[1]) : null;
}

function chapterPrefix(no) {
  return String(no).padStart(4, "0");
}

function collectChapterFiles() {
  if (finalOnly) return collectFinalChapterFiles();

  return SCAN_DIRS.flatMap((dirName) => {
    const dir = path.join(bookDir, dirName);
    return walk(dir)
      .filter((file) => /\.(md|txt)$/i.test(file))
      .map((file) => ({ dirName, file, chapter: getChapterNo(file) }))
      .filter((item) => item.chapter && item.chapter >= from && item.chapter <= to);
  }).sort((a, b) => a.chapter - b.chapter
    || a.dirName.localeCompare(b.dirName)
    || a.file.localeCompare(b.file));
}

function collectFinalChapterFiles() {
  const files = [];
  for (let chapter = from; chapter <= to; chapter += 1) {
    const candidate = findFinalChapterFile(chapter);
    if (candidate) files.push(candidate);
  }
  return files;
}

function findFinalChapterFile(chapter) {
  const reviewedFinal = path.join(bookDir, "chapters-reviewed", `${chapterPrefix(chapter)}_final.md`);
  if (fs.existsSync(reviewedFinal)) {
    return { dirName: "chapters-reviewed", file: reviewedFinal, chapter, finalSource: "reviewed-final" };
  }

  const publishReadyCandidate = findPublishReadyFinalCandidate(chapter);
  if (publishReadyCandidate) return publishReadyCandidate;

  return findOriginalChapterFile(chapter);
}

function findPublishReadyFinalCandidate(chapter) {
  const reportFile = path.join(bookDir, "reviews", "publish-ready", `${chapterPrefix(chapter)}.publish-report.json`);
  const report = readJsonIfExists(reportFile);
  const raw = report?.final_candidate_file;
  if (!raw) return null;

  const file = resolveBookRelativePath(raw);
  if (!file || !fs.existsSync(file)) return null;

  return {
    dirName: path.relative(bookDir, path.dirname(file)) || ".",
    file,
    chapter,
    finalSource: "publish-ready-final-candidate",
  };
}

function resolveBookRelativePath(raw) {
  if (path.isAbsolute(raw)) return raw;
  const normalized = raw.replaceAll("\\", "/");
  const bookPrefix = `books/${bookName}/`;
  const myNovelPrefix = `my-novel/books/${bookName}/`;

  if (normalized.startsWith(bookPrefix)) {
    return path.join(bookDir, normalized.slice(bookPrefix.length));
  }
  if (normalized.startsWith(myNovelPrefix)) {
    return path.join(root, normalized);
  }
  return path.join(bookDir, raw);
}

function findOriginalChapterFile(chapter) {
  const dir = path.join(bookDir, "chapters");
  const candidates = walk(dir)
    .filter((file) => /\.(md|txt)$/i.test(file))
    .map((file) => ({ file, chapter: getChapterNo(file) }))
    .filter((item) => item.chapter === chapter)
    .sort((a, b) => {
      const aBase = path.basename(a.file);
      const bBase = path.basename(b.file);
      return aBase.length - bBase.length || aBase.localeCompare(bBase);
    });

  const file = candidates[0]?.file;
  return file
    ? { dirName: "chapters", file, chapter, finalSource: "chapters-fallback" }
    : null;
}

const RULES = [
  {
    type: "A",
    id: "percentage-state",
    re: /(?:气血|血量|血条|状态|恢复|战力|精血|消耗|收益|本源|视力|右臂|左眼)[^。！？\n]{0,18}\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%[^。！？\n]{0,12}(?:气血|血量|血条|状态|恢复|战力|精血|收益|消耗)/giu,
    reason: "百分比把身体状态写成面板读数，容易把沉浸式玄幻拉向系统流界面。",
    suggestion: "改成伤势、血色、呼吸、视野、肢体生长等感官化描写，把精确数值留在 state/facts。",
    autoFix: "yes-later",
  },
  {
    type: "A",
    id: "decimal-blood-drop",
    re: /\d+\.\d+\s*滴\s*精血/giu,
    reason: "小数滴精血属于资源账本口径，正文里显得像消耗栏。",
    suggestion: "改成“逼出一线精血”“挤出薄薄一缕本命血”等非精确体感表达。",
    autoFix: "yes-later",
  },
  {
    type: "A",
    id: "panel-keyword",
    re: /气血条|血条|状态条|面板|属性值|基础值|经验值?|等级条|数值(?:收益|消耗|倍率|提升)|收益|性价比|打[一二三四五六七八九十半\d.]+折|倍率|满额/giu,
    reason: "词汇来自面板、商业计算或战力换算，会削弱黑暗修炼的身体代价感。",
    suggestion: "改成主角的取舍、痛感、后患、气机衰败或肉身反馈。",
    autoFix: "yes-later",
  },
  {
    type: "A",
    id: "numeric-gain-cost",
    re: /(?:涨到|回升到|降至|跌到|提升到|下降到|最多涨|只剩|消耗值从|恢复到)\s*\d+(?:\.\d+)?(?:\s*%|滴|点|份|成)?/giu,
    reason: "涨跌到精确数值是典型状态结算语气。",
    suggestion: "改成“气息稍稳/血色回暖/反噬压低/余力见底”等叙事化结果。",
    autoFix: "yes-later",
  },
  {
    type: "B",
    id: "fractional-settlement-context",
    re: /(?:收益|基础值|性价比|战力|数值|结算|提升|消耗|倍率)[^。！？\n]{0,18}(?:[一二三四五六七八九十半]+成|大半|小半|半数|几分|一线|半滴|[一二三四五六七八九十半\d.]+折)|(?:[一二三四五六七八九十半]+成|大半|小半|半数|几分|一线|半滴|[一二三四五六七八九十半\d.]+折)[^。！？\n]{0,18}(?:收益|基础值|性价比|战力|数值|结算|提升|消耗|倍率)/giu,
    reason: "中文成数本身可用于玄幻语境；只有与收益、基础值、战力、结算等账本词共现时，才需要人工判断是否偏面板化。",
    suggestion: "人工判断：保留自然成数，重点检查是否应删除账本词，改成代价、痛感、气机衰败或肉身反馈。",
    autoFix: "no",
  },
  {
    type: "C",
    id: "natural-number",
    re: /(?:三息|一炷香|三炷香|七副玉棺|千年|半尺|三步外|六个少女|聚气九层|化灵门槛|第七容器|七容器|一息之内|第二副玉棺|第三副|第四副|第六副|第一副)/giu,
    reason: "这是时间、空间、器物数量、境界层级或剧情身份，属于自然叙事数字。",
    suggestion: "通常保留；只有在同段堆叠成结算口吻时再人工调整。",
    autoFix: "no",
  },
];

function shouldIncludeType(type, mode) {
  if (mode === "system") return type === "C";
  if (mode === "light_numeric") return type !== "C";
  return true;
}

function findHits(text, mode) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const rule of RULES) {
      if (!shouldIncludeType(rule.type, mode)) continue;
      rule.re.lastIndex = 0;
      for (const match of line.matchAll(rule.re)) {
        const raw = match[0].trim();
        if (!raw) continue;
        hits.push({
          line: lineIndex + 1,
          type: rule.type,
          rule: rule.id,
          match: raw,
          excerpt: line.trim(),
          reason: rule.reason,
          suggestion: rule.suggestion,
          autoFix: rule.autoFix,
        });
      }
    }
  }
  return dedupeHits(hits);
}

function dedupeHits(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    const key = `${hit.line}\0${hit.type}\0${hit.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeMd(text) {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function summarizeCounts(allHits) {
  const counts = { A: 0, B: 0, C: 0 };
  for (const item of allHits) {
    for (const hit of item.hits) counts[hit.type] += 1;
  }
  return counts;
}

function summarizeChapterCounts(files, allHits) {
  const chapters = new Map();
  for (const file of files) {
    if (!chapters.has(file.chapter)) {
      chapters.set(file.chapter, { chapter: file.chapter, files: 0, A: 0, B: 0, C: 0 });
    }
    chapters.get(file.chapter).files += 1;
  }

  for (const item of allHits) {
    const summary = chapters.get(item.chapter)
      || { chapter: item.chapter, files: 0, A: 0, B: 0, C: 0 };
    for (const hit of item.hits) summary[hit.type] += 1;
    chapters.set(item.chapter, summary);
  }

  return Array.from(chapters.values()).sort((a, b) => a.chapter - b.chapter);
}

function buildReport({ mode, modeSource, files, allHits }) {
  const counts = summarizeCounts(allHits);
  const chapterCounts = summarizeChapterCounts(files, allHits);
  const title = from === to
    ? `# ${chapterPrefix(from)} 数值化表达扫描报告`
    : "# 批量数值化表达扫描报告";
  const generatedAt = new Date().toISOString();
  const lines = [
    title,
    "",
    `- 书籍：${bookName}`,
    `- 模式：${mode}${modeOverride ? "（命令行覆盖）" : `（${modeSource}）`}`,
    `- final-only：${finalOnly ? "true" : "false"}`,
    `- 范围：第 ${from} 章至第 ${to} 章`,
    `- 扫描目录：${finalOnly ? "final candidates only" : SCAN_DIRS.join("、")}`,
    `- 扫描文件数：${files.length}`,
    `- 命中统计：A=${counts.A}，B=${counts.B}，C=${counts.C}`,
    `- 生成时间：${generatedAt}`,
    "",
    "## 分类说明",
    "",
    "- A：强面板化表达。immersive 模式下建议改写；system 模式下可保留。",
    "- B：可疑数值表达。中文成数默认允许，仅在与账本/结算词共现时提示人工判断。",
    "- C：允许的自然数字。用于时间、数量、距离、境界、身份序号等，通常不改。",
    "",
    "## 每章统计",
    "",
    "| 章节 | 扫描文件数 | A类强违规 | B类可疑 | C类自然数字 |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const item of chapterCounts) {
    lines.push(`| ${chapterPrefix(item.chapter)} | ${item.files} | ${item.A} | ${item.B} | ${item.C} |`);
  }
  lines.push("");

  if (!allHits.length) {
    lines.push("## 命中明细", "", "未发现需要报告的数值化表达。", "");
  } else {
    lines.push("## 命中明细", "");
    for (const item of allHits) {
      const relativeFile = path.relative(bookDir, item.file);
      const finalLabel = item.finalSource ? ` · ${item.finalSource}` : "";
      lines.push(`### 第 ${item.chapter} 章 · ${relativeFile}${finalLabel}`, "");
      lines.push("| 行 | 类型 | 命中原文 | 为什么可能出戏 | 建议改写方向 | 建议自动修复 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const hit of item.hits) {
        lines.push(`| ${hit.line} | ${hit.type} | ${escapeMd(hit.match)} | ${escapeMd(hit.reason)} | ${escapeMd(hit.suggestion)} | ${hit.autoFix === "yes-later" ? "后续 --fix 可支持" : "否"} |`);
      }
      lines.push("", "<details>");
      lines.push("<summary>命中行原文</summary>");
      lines.push("");
      const excerptByLine = new Map();
      for (const hit of item.hits) {
        if (!excerptByLine.has(hit.line)) excerptByLine.set(hit.line, hit.excerpt);
      }
      for (const [line, excerpt] of excerptByLine) {
        lines.push(`- L${line}：${excerpt}`);
      }
      lines.push("");
      lines.push("</details>", "");
    }
  }

  lines.push(
    "## 后续 auto-fix 设计",
    "",
    "- `--fix`：仅自动改写 A 类强违规表达，B 类仍保留人工判断。",
    "- `--mode immersive/system/light_numeric`：允许命令行覆盖书籍配置，系统流正文不被误杀。",
    "- `--dry-run`：预览改写候选和目标文件，不落盘。",
    "- `--write-reviewed`：写入 `chapters-reviewed/` 或 `chapters-fixed/`，不覆盖原文。",
    "",
    "## 本轮约束",
    "",
    finalOnly
      ? "- `--final-only` 仅扫描每章最终候选：`chapters-reviewed/*_final.md`，否则使用 publish-ready `final_candidate_file`，再否则回退 `chapters/`。"
      : "- 本脚本只扫描 `chapters/`、`chapters-reviewed/`、`chapters-fixed/`、`chapters-salvaged/`。",
    "- 不扫描 state、facts、review report，内部状态仍允许保留精确数字。",
    "- 本轮不自动修改正文。",
    "",
  );

  return lines.join("\n");
}

const bookConfig = readJsonIfExists(path.join(bookDir, "book.json")) || {};
const bookRules = parseFrontmatter(readTextIfExists(path.join(bookDir, "story", "book_rules.md")));
const genreProfile = parseFrontmatter(readTextIfExists(path.join(bookDir, "story", "genre_profile.yaml")));
const inferred = inferMode(bookConfig, bookRules, genreProfile);
const mode = modeOverride || inferred.mode;

const files = collectChapterFiles();
const allHits = files.map((item) => ({
  ...item,
  hits: findHits(fs.readFileSync(item.file, "utf8"), mode),
})).filter((item) => item.hits.length > 0);

const report = buildReport({
  mode,
  modeSource: inferred.source,
  files,
  allHits,
});

const reportDir = path.join(bookDir, "reviews", "numeric-expression");
const reportName = from === to
  ? `${chapterPrefix(from)}${finalOnly ? ".final-only" : ""}.numeric-report.md`
  : `batch-${chapterPrefix(from)}-${chapterPrefix(to)}${finalOnly ? ".final-only" : ""}.numeric-report.md`;
const reportPath = path.join(reportDir, reportName);

if (!dryRun) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, report, "utf8");
}

const counts = summarizeCounts(allHits);
console.log("[numeric-expression]");
console.log(`book: ${bookName}`);
console.log(`mode: ${mode}${modeOverride ? " (override)" : ` (${inferred.source})`}`);
console.log(`final-only: ${finalOnly ? "true" : "false"}`);
console.log(`range: ${from}-${to}`);
console.log(`files: ${files.length}`);
console.log(`hits: A=${counts.A} B=${counts.B} C=${counts.C}`);
console.log(dryRun ? "report: dry-run" : `report: ${path.relative(root, reportPath)}`);
