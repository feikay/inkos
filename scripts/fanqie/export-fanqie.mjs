#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const argv = process.argv.slice(2);
const bookName = argv[0] || "葬渊魔经";

function getArg(name, fallback = undefined) {
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

const from = Number(getArg("from", 1));
const to = Number(getArg("to", 99999));
const publishTitle = getArg("title", "气血为0，我却能撬动规则");

const incremental = hasFlag("incremental");
const reset = hasFlag("reset");
const dryRun = hasFlag("dry-run");

const bookDir = path.join(root, "my-novel", "books", bookName);
const chaptersDirSource = path.join(bookDir, "chapters");
const outDir = path.join(root, "publish", bookName, "fanqie");
const chapterOutDir = path.join(outDir, "chapters");
const markerFile = path.join(outDir, ".last_export");

if (!fs.existsSync(bookDir)) {
  console.error(`找不到书籍目录：${bookDir}`);
  process.exit(1);
}

if (!dryRun) fs.mkdirSync(chapterOutDir, { recursive: true });
if (reset && fs.existsSync(markerFile)) fs.rmSync(markerFile);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const p = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(p) : [p];
  });
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function isChapterSourceFile(file) {
  const name = path.basename(file);
  return /^0*(\d+)(?:[_\-.].*)?\.(md|txt)$/i.test(name);
}

function getChapterNo(file) {
  const name = path.basename(file);
  const match = name.match(/^0*(\d+)(?:[_\-.].*)?\.(md|txt)$/i);
  return match ? Number(match[1]) : null;
}

function getChapterTitleFromFilename(file) {
  const name = path.basename(file);
  const match = name.match(/^0*\d+(?:[_\-.](.+?))?\.(md|txt)$/i);
  if (!match?.[1]) return "";
  return normalizeTitleCandidate(
    match[1]
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  );
}

function extractText(file) {
  const raw = fs.readFileSync(file, "utf8");
  return raw;
}

function normalizeTextValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTextValue(item))
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object") {
    return normalizeTextValue(
      value.content
      ?? value.text
      ?? value.body
      ?? value.chapter
      ?? value.markdown
      ?? value.draft
      ?? value.finalText
      ?? ""
    );
  }
  return "";
}

function cleanText(text) {
  const source = normalizeTextValue(text);
  return source
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/INFO\s+\[.*?\].*/g, "")
    .replace(/WARN\s+\[.*?\].*/g, "")
    .replace(/ERROR\s+\[.*?\].*/g, "")
    .replace(/\[error\].*/gi, "")
    .replace(/\[warning\].*/gi, "")
    .replace(/payoffToDeliver[:：].*/gi, "")
    .replace(/endingType[:：].*/gi, "")
    .replace(/chapterMode[:：].*/gi, "")
    .replace(/Hook\s+[A-Z_0-9]+.*/g, "")
    .replace(/H_NEW_\d+.*/g, "")
    .replace(/【下章预告】[\s\S]*?(?=\n\n|$)/g, "")
    .replace(/不是(.{0,20})而是/g, "并非$1，而是")
    .replace(/([，,。；;：:！？!?])\s*([，,。；;：:！？!?])+/g, "$1")
    .replace(/并非([^，。\n]{0,20})，，而是/g, "并非$1，而是")
    .replace(/并非([^，。\n]{0,20}),,而是/g, "并非$1，而是")
    .replace(/他意识到/g, "他看着")
    .replace(/他明白了/g, "他停了一息")
    .replace(/显然/g, "")
    .replace(/这意味着/g, "也就是说")
    .replace(/——/g, "。")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !isMetaContentLine(s))
    .map((s) => s.replace(/([，,。；;：:！？!?])\1+/g, "$1"))
    .join("\n\n")
    .trim();
}

function stripTitlePrefix(text) {
  return (text || "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^第\s*\d+\s*章(?:\s*[:：\-]\s*|\s+)?/, "")
    .trim();
}

function normalizeTitleCandidate(text) {
  return stripTitlePrefix(text)
    .replace(/^["'“”‘’【】\[\]()（）]+|["'“”‘’【】\[\]()（）]+$/g, "")
    .replace(/[：:]\s*.+$/u, "")
    .replace(/\s+/g, "")
    .trim();
}

function countChineseChars(text) {
  return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function isStructuralTitle(text) {
  return /PRE_WRITE_CHECK|Chapter\s*Content|Scene\s*\d+|Hook|Pressure|Attempt|Twist|Payoff|Pull|Act\s*\d+|MOMENT/i.test(text);
}

function isValidTitleCandidate(text) {
  const value = normalizeTitleCandidate(text);
  if (!value) return false;
  if (/\n/.test(value)) return false;
  if (isStructuralTitle(value)) return false;
  if (/[。！？；.!?;]/.test(value)) return false;
  if (/[：:]/.test(value)) return false;
  if (/[*|/\\]/.test(value)) return false;
  if ((value.match(/[，、]/g) || []).length > 1) return false;
  if (/(?:说明|设定|机制|正文|修正|新增|摘要|大纲|预计增量|当前资源)/.test(value)) return false;
  if (/^(?:他|她|它|他们|云岚|楚夜|此刻|随后|这时|就在|突然|当|如果|因为|为了|然后)/.test(value) && value.length >= 6) return false;
  if (/(?:说道|问道|开口|看向|盯着|发现|感到|站在|坐在|走进|突然|已经|继续|并未|开始|传来|浮现|变得|彻底)/.test(value)) return false;
  if (value.length > 24) return false;
  if (countChineseChars(value) > 18) return false;
  return true;
}

function isLikelyMetaLine(text) {
  const value = (text || "").trim();
  if (!value) return true;
  if (/^\|.*\|$/.test(value)) return true;
  if (/^[-|]{3,}$/.test(value)) return true;
  if (/^(?:#{1,6}\s*)?第\s*\d+\s*章(?:[:：].*)?$/u.test(value)) return true;
  if (/^(?:#{1,6}\s*)?(?:PRE_WRITE_CHECK|Chapter\s*Content|扩写修正后的正文)$/i.test(value)) return true;
  if (/^(?:#{1,6}\s*)?(?:CHAPTER_TITLE|CHAPTER_CONTENT)$/i.test(value)) return true;
  if (/^(?:#{1,6}\s*)?\[?\s*Scene\s*\d+.*\]?$/i.test(value)) return true;
  if (/^(?:#{1,6}\s*)?\[?\s*Act\s*\d+.*\]?$/i.test(value)) return true;
  if (/^[（(【].*(?:Act|Scene).*[】)]$/i.test(value)) return true;
  if (/^MOMENT(?:[:：].*)?$/i.test(value)) return true;
  const plain = stripTitlePrefix(value);
  return /^[#【\[(（]/.test(value) && plain.length <= 20 && !/[，。！？；、,.!?;]/.test(plain);
}

function isMetaContentLine(text) {
  const value = (text || "").trim();
  if (!value) return false;
  if (isLikelyMetaLine(value)) return true;
  if (/^(?:CHAPTER_TITLE|CHAPTER_CONTENT)$/i.test(value)) return true;
  if (/^(?:PRE_WRITE_CHECK|Chapter\s*Content)$/i.test(value)) return true;
  if (/^(?:Hook|Pressure|Attempt|Twist|Payoff|Pull)(?:[:：].*)?$/i.test(value)) return true;
  if (/^MOMENT(?:[:：].*)?$/i.test(value)) return true;
  if (/^MOMENT[（(].*[）)][:：]?$/i.test(value)) return true;
  return false;
}

function stripLeadingMeta(text) {
  const lines = (text || "").split("\n");
  while (lines.length) {
    if (!lines[0].trim()) {
      lines.shift();
      continue;
    }
    if (!isLikelyMetaLine(lines[0])) break;
    lines.shift();
    while (lines.length && (/^\|.*\|$/.test(lines[0].trim()) || /^[-|]{3,}$/.test(lines[0].trim()) || !lines[0].trim())) {
      lines.shift();
    }
  }
  return lines.join("\n").trim();
}

function removeExistingTitle(text) {
  const lines = text.split("\n");
  const isTitleLine = (line) =>
    /^(?:#+\s*)?第\s*\d+\s*章(?:\s+.*)?$/.test((line || "").trim());

  while (lines.length && !lines[0].trim()) lines.shift();

  while (lines.length && isTitleLine(lines[0])) {
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }

  return stripLeadingMeta(lines.join("\n"));
}

function countChars(text) {
  return [...text.replace(/\s/g, "")].length;
}

function pickImpactLine(text) {
  const fragments = text
    .split(/\n+/)
    .flatMap((line) => line.split(/[。！？!?]/))
    .map((s) => normalizeTitleCandidate(s))
    .filter(Boolean);
  const candidates = fragments.filter((line) =>
    /打开|裂开|觉醒|崩解|契约|真名|血|死|规则|吞噬|反噬|漏洞|门|阵纹|葬渊|苏醒|祭坛|玉简|暗河|禁制/.test(line) &&
    isValidTitleCandidate(line)
  );
  return candidates[0] || "";
}

function getFirstMarkdownHeading(text) {
  for (const line of text.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (!match) continue;
    const candidate = normalizeTitleCandidate(match[1]);
    if (isValidTitleCandidate(candidate)) return candidate;
  }
  return "";
}

function makeTitle(no, text, sourceFile = "") {
  const filenameTitle = getChapterTitleFromFilename(sourceFile);
  if (isValidTitleCandidate(filenameTitle)) {
    return `第${no}章 ${filenameTitle}`;
  }
  const markdownTitle = getFirstMarkdownHeading(text);
  if (isValidTitleCandidate(markdownTitle)) {
    return `第${no}章 ${markdownTitle}`;
  }
  const impact = pickImpactLine(text);
  if (isValidTitleCandidate(impact)) {
    return `第${no}章 ${impact}`;
  }
  return `第${no}章 风波再起`;
}

function sixPartCheck(text) {
  const first = text.slice(0, 120);
  const tail = text.slice(-220);

  const checks = [
    ["Hook", /死|血|契约|规则|异常|裂|黑暗|阵纹|真名|吞噬|反噬|门|葬渊/.test(first)],
    ["Pressure", /压|痛|死|气血|倒计时|规则|反噬|濒死|耗尽|崩解|封死|失控/.test(text)],
    ["Attempt", /伸手|催动|咬牙|站起|冲|抓住|压下|尝试|握住|抬手|撕开|推开|吞下|运转/.test(text)],
    ["Twist", /却|反而|下一瞬|忽然|骤然|突然|没想到|不对|并非|不是/.test(text)],
    ["Payoff", /门，被强行打开|石门，轰然裂开|那一刻，他看懂|所有线索，在这一刻拼合|契约的全部内容|真名.*崩解|漏洞.*代价|发现.*漏洞|看懂.*契约/.test(text)],
    ["Pull", /更深|下一|远处|黑暗|裂开|苏醒|逼近|还有|真正|门后|深处|声音|棺椁|真名|葬渊/.test(tail)],
  ];

  const score = checks.filter(([, ok]) => ok).length;
  return { score, checks, pass: score >= 4, strong: score >= 5 };
}

function qualityWarnings(text) {
  const warnings = [];
  const chars = countChars(text);

  if (chars < 1200) warnings.push(`字数偏短：${chars}字，建议至少 1500 字左右。`);
  if (chars > 3200) warnings.push(`字数偏长：${chars}字，可考虑拆章。`);

  const suddenCount = (text.match(/突然|骤然|猛地/g) || []).length;
  if (suddenCount >= 5) warnings.push(`“突然/骤然/猛地”使用偏多：${suddenCount} 次。`);

  if (/他意识到|他明白了|显然|这意味着/.test(text)) warnings.push("仍存在说明式内心表达。");
  if (/——/.test(text)) warnings.push("仍存在破折号，建议替换。");

  return warnings;
}

function parseSimpleYaml(text) {
  const data = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_\-]+):\s*(.+?)\s*$/);
    if (!match) continue;
    data[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return data;
}

function parseCharacterMatrix(text) {
  return [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim()).filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function pickTopTags(rules, corpus, limit = 3) {
  const tags = [];
  for (const [tag, pattern] of rules) {
    if (pattern.test(corpus)) tags.push(tag);
    if (tags.length >= limit) break;
  }
  return tags;
}

function inferReader(genreLabel, corpus) {
  if (/女频|言情|宫斗|宅斗|女尊|甜宠|古言|现言/.test(`${genreLabel}\n${corpus}`)) return "女频";
  return "男频";
}

function inferMainCategory(genreLabel, corpus) {
  const source = `${genreLabel}\n${corpus}`;
  if (/仙侠|修仙|修真|道尊/.test(source)) return "东方仙侠";
  if (/玄幻|葬渊|契约|守门|星图|异族|血脉/.test(source)) return "传统玄幻";
  if (/悬疑|诡|守墓|棺|暗河|规则/.test(source)) return "悬疑灵异";
  return "传统玄幻";
}

function inferFemaleLead(characterNames, corpus, maleLead) {
  const preferred = characterNames.find((name) => name !== maleLead && /云岚|苏|宁|月|雪|瑶|灵|璃|瑾|柔|薇|岚/.test(name));
  if (preferred) return preferred;
  return characterNames.find((name) => name !== maleLead) || "未定";
}

function inferBookMetadata(chapterFiles) {
  const genreProfile = parseSimpleYaml(readIfExists(path.join(bookDir, "story", "genre_profile.yaml")));
  const characterMatrixText = readIfExists(path.join(bookDir, "story", "character_matrix.md"));
  const currentStateText = readIfExists(path.join(bookDir, "story", "current_state.md"));
  const chapterSummaryText = readIfExists(path.join(bookDir, "story", "chapter_summaries.md"));
  const characterNames = parseCharacterMatrix(characterMatrixText);
  const sampleTexts = chapterFiles
    .slice(0, 8)
    .map(({ file }) => removeExistingTitle(cleanText(extractText(file))))
    .join("\n");
  const corpus = [
    genreProfile.label || "",
    characterMatrixText,
    currentStateText,
    chapterSummaryText,
    sampleTexts,
    publishTitle,
  ].join("\n");

  const maleLead = characterNames[0] || "未定";
  const femaleLead = inferFemaleLead(characterNames, corpus, maleLead);
  const reader = inferReader(genreProfile.label || genreProfile.template || "", corpus);
  const mainCategory = inferMainCategory(genreProfile.label || genreProfile.template || "", corpus);

  const themeRules = [
    ["规则怪谈", /规则|契约|守门|真名|细则/],
    ["高武世界", /高武|修炼|境界|灵气|结晶|神府/],
    ["东方玄幻", /玄幻|葬渊|异族|血脉|封印|星图/],
    ["悬疑", /线索|疑云|守墓|棺椁|暗河|残卷|谜/],
    ["异世大陆", /异世|异族|古殿|遗迹/],
    ["灵气复苏", /灵气|复苏/],
  ];

  const roleRules = [
    ["单女主", femaleLead !== "未定" ? /./ : /$^/],
    ["腹黑", /冷静|筹码|算计|试探|藏着|不动声色/],
    ["反派", /大祭司|守门人|反派|叛逃者/],
    ["大佬", /主角|契约共生者|规则化身/],
  ];

  const plotRules = [
    ["求生", /求生|活路|死局|濒死|撤退|逃|活下来/],
    ["升级流", /升级|突破|变强|进阶|境界|小胜立威/],
    ["封神", /封印|星图|传承|祭坛|守门/],
    ["1v1", /单女主|楚夜.*云岚|云岚.*楚夜/s],
  ];

  return {
    reader,
    maleLead,
    femaleLead,
    mainCategory,
    themes: unique(pickTopTags(themeRules, corpus, 3)),
    roles: unique(pickTopTags(roleRules, corpus, 3)),
    plots: unique(pickTopTags(plotRules, corpus, 3)),
  };
}

function writeBookInfo(chapterFiles) {
  const metadata = inferBookMetadata(chapterFiles);
  const intro = `书名：${publishTitle}

目标读者：${metadata.reader}

主角名：
- 男主：${metadata.maleLead}
- 女主：${metadata.femaleLead}

作品标签：
- 主分类：${metadata.mainCategory}
- 主题：${metadata.themes.join("、") || "待补充"}
- 角色：${metadata.roles.join("、") || "待补充"}
- 情节：${metadata.plots.join("、") || "待补充"}

简介：
楚夜醒来时，气血为0。

按理说，他已经是个死人。

但他没死。

因为他签了一份契约。

一份会吞噬他的契约。

气血越少，它吞得越快。
契约越强，他死得越快。

可同时，他也能撬动规则。

当所有人都在规则下挣扎时，他开始用命，去改规则。

既然活不了，那就玩大一点。

这是一个用寿命换力量，用死亡撬动世界的故事。
`;

  if (!dryRun) fs.writeFileSync(path.join(outDir, "book-info.txt"), intro, "utf8");
}

let lastExport = 0;
if (incremental && fs.existsSync(markerFile)) {
  lastExport = Number(fs.readFileSync(markerFile, "utf8")) || 0;
}

const chapterScanRoot = fs.existsSync(chaptersDirSource) ? chaptersDirSource : bookDir;

const chapterFiles = walk(chapterScanRoot)
  .filter((f) => /\.(md|txt)$/i.test(f))
  .filter((f) => isChapterSourceFile(f))
  .map((file) => ({ file, no: getChapterNo(file) }))
  .filter((x) => x.no)
  .filter((x) => x.no >= from && x.no <= to)
  .filter((x) => !incremental || x.no > lastExport)
  .sort((a, b) => a.no - b.no);

if (!chapterFiles.length) {
  console.log("没有找到需要导出的章节。");
  if (incremental) console.log(`当前为增量模式，上次导出到第 ${lastExport} 章。`);
  process.exit(0);
}

const exported = [];
const report = [];

for (const { file, no } of chapterFiles) {
  let text = cleanText(extractText(file));
  text = removeExistingTitle(text);
  if (!text) continue;

  const sourceTitle = getChapterTitleFromFilename(file);
  const title = isValidTitleCandidate(sourceTitle) ? `第${no}章 ${sourceTitle}` : makeTitle(no, text, file);
  const finalText = `${title}\n\n${text}\n`;

  const check = sixPartCheck(finalText);
  const warnings = qualityWarnings(finalText);

  const outFile = path.join(chapterOutDir, `${String(no).padStart(4, "0")}.txt`);

  if (!dryRun) fs.writeFileSync(outFile, finalText, "utf8");

  exported.push({ no, title, chars: countChars(finalText), file, outFile, check, warnings });

  report.push(`## ${title}

- 原文件：\`${path.relative(root, file)}\`
- 导出字数：${countChars(finalText)}
- 6段检查：${check.score}/6 ${check.strong ? "🔥 强" : check.pass ? "✅ 可发" : "⚠️ 需改"}

${check.checks.map(([name, ok]) => `  - ${ok ? "✅" : "❌"} ${name}`).join("\n")}

${warnings.length ? `### 警告\n${warnings.map((w) => `- ${w}`).join("\n")}` : "### 警告\n- 无明显问题"}

`);
}

writeBookInfo(chapterFiles);

if (!dryRun) {
  fs.writeFileSync(path.join(outDir, "full.txt"), exported.map((x) => fs.readFileSync(x.outFile, "utf8")).join("\n\n"), "utf8");

  fs.writeFileSync(
    path.join(outDir, "report.md"),
    `# 番茄发布检查报告

书名：${publishTitle}

导出时间：${new Date().toLocaleString("zh-CN")}

导出章节数：${exported.length}

${report.join("\n")}
`,
    "utf8"
  );

  fs.writeFileSync(markerFile, String(Math.max(...exported.map((x) => x.no))), "utf8");
}

console.log("番茄发布导出完成");
console.log(`书名：${publishTitle}`);
console.log(`导出章节数：${exported.length}`);
console.log(`输出目录：${path.relative(root, outDir)}`);

const weak = exported.filter((x) => !x.check.pass);
if (weak.length) {
  console.log("\n以下章节建议发布前人工看一眼：");
  for (const x of weak) console.log(`- 第${x.no}章：6段检查 ${x.check.score}/6`);
}

if (dryRun) console.log("\n当前为 dry-run，没有写入文件。");
