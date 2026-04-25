#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const bookName = process.argv[2] || "葬渊魔经";

const sourceDir = path.join(root, "my-novel", "books", bookName, "chapters");
const publishDir = path.join(root, "publish", bookName, "fanqie", "chapters");
const outPath = path.join(root, "docs", "duplicate-paragraph-report.md");

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function isChapterFile(file) {
  return /^0*\d+(?:[_\-.].*)?\.(md|txt)$/i.test(path.basename(file));
}

function chapterNoFromFile(file) {
  const match = path.basename(file).match(/^0*(\d+)(?:[_\-.].*)?\.(md|txt)$/i);
  return match ? Number(match[1]) : null;
}

function normalizeParagraph(text) {
  return (text || "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/[*_~`>#-]/g, "")
    .replace(/[“”"']/g, "")
    .replace(/[，,]/g, "，")
    .replace(/[。.!！?？；;]/g, "。")
    .replace(/[：:]/g, "：")
    .replace(/\s+/g, "")
    .trim();
}

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/g)
    .map((raw, idx) => ({
      index: idx + 1,
      raw: raw.trim(),
      normalized: normalizeParagraph(raw),
    }))
    .filter((item) => item.raw)
    .filter((item) => !/^(?:#+\s*)?第\s*\d+\s*章/.test(item.raw))
    .filter((item) => item.normalized.length >= 15);
}

function tokenize(text) {
  const chars = [...text];
  if (chars.length < 2) return new Set(chars);
  const set = new Set();
  for (let i = 0; i < chars.length - 1; i += 1) {
    set.add(chars.slice(i, i + 2).join(""));
  }
  return set;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = tokenize(a);
  const tb = tokenize(b);
  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) overlap += 1;
  }
  return (2 * overlap) / Math.max(1, ta.size + tb.size);
}

function summarize(text, limit = 48) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function collectFileFindings(file, scopeLabel) {
  const content = fs.readFileSync(file, "utf8");
  const paragraphs = splitParagraphs(content);
  const findings = [];
  const exactMap = new Map();

  for (const paragraph of paragraphs) {
    if (!exactMap.has(paragraph.normalized)) exactMap.set(paragraph.normalized, []);
    exactMap.get(paragraph.normalized).push(paragraph);
  }

  for (const group of exactMap.values()) {
    if (group.length < 2) continue;
    findings.push({
      file,
      chapter: chapterNoFromFile(file),
      scope: scopeLabel,
      type: "完全重复",
      positions: group.map((item) => item.index),
      summary: summarize(group[0].raw),
      source: "源文件重复",
      suggestion: `删除重复段落 ${group.slice(1).map((item) => item.index).join("、")}`,
    });
  }

  for (let i = 0; i < paragraphs.length - 1; i += 1) {
    const current = paragraphs[i];
    const next = paragraphs[i + 1];
    const score = similarity(current.normalized, next.normalized);
    if (score >= 0.85) {
      findings.push({
        file,
        chapter: chapterNoFromFile(file),
        scope: scopeLabel,
        type: score === 1 ? "相邻重复" : "高度重复",
        positions: [current.index, next.index],
        summary: `${summarize(current.raw)} / ${summarize(next.raw)}`,
        source: "源文件重复",
        suggestion: `人工复核相邻段落 ${current.index}、${next.index}`,
        score,
      });
    }
  }

  return { file, chapter: chapterNoFromFile(file), paragraphs, findings };
}

function compareSourceAndPublish(sourceInfo, publishInfo) {
  const findings = [];
  if (!sourceInfo || !publishInfo) return findings;

  const sourceExact = new Set(
    sourceInfo.findings
      .filter((item) => item.type === "完全重复")
      .map((item) => item.summary),
  );

  const exactMap = new Map();
  for (const paragraph of publishInfo.paragraphs) {
    if (!exactMap.has(paragraph.normalized)) exactMap.set(paragraph.normalized, []);
    exactMap.get(paragraph.normalized).push(paragraph);
  }

  for (const group of exactMap.values()) {
    if (group.length < 2) continue;
    const summary = summarize(group[0].raw);
    if (sourceExact.has(summary)) continue;
    findings.push({
      file: publishInfo.file,
      chapter: publishInfo.chapter,
      scope: "publish",
      type: "导出重复",
      positions: group.map((item) => item.index),
      summary,
      source: "导出重复",
      suggestion: "优先检查导出脚本或清洗逻辑",
    });
  }

  for (let i = 0; i < publishInfo.paragraphs.length - 1; i += 1) {
    const current = publishInfo.paragraphs[i];
    const next = publishInfo.paragraphs[i + 1];
    const score = similarity(current.normalized, next.normalized);
    if (score < 0.85) continue;

    const mirrored = sourceInfo.paragraphs.some((src, idx) => {
      const srcNext = sourceInfo.paragraphs[idx + 1];
      if (!srcNext) return false;
      return src.index === current.index
        && srcNext.index === next.index
        && similarity(src.normalized, current.normalized) > 0.98
        && similarity(srcNext.normalized, next.normalized) > 0.98;
    });

    if (!mirrored) {
      findings.push({
        file: publishInfo.file,
        chapter: publishInfo.chapter,
        scope: "publish",
        type: "导出重复",
        positions: [current.index, next.index],
        summary: `${summarize(current.raw)} / ${summarize(next.raw)}`,
        source: "导出重复",
        suggestion: "优先检查 cleanText / 导出拼接逻辑",
        score,
      });
    }
  }

  return findings;
}

function formatFinding(item) {
  return [
    `- 文件：\`${path.relative(root, item.file)}\``,
    `- 重复类型：${item.type}`,
    `- 重复位置：第 ${item.positions.join("、")} 段`,
    `- 重复文本摘要：${item.summary}`,
    `- 判断来源：${item.source}`,
    `- 建议处理方式：${item.suggestion}`,
  ].join("\n");
}

const sourceFiles = walk(sourceDir).filter(isChapterFile).sort();
const publishFiles = walk(publishDir).filter(isChapterFile).sort();

const sourceInfos = new Map(sourceFiles.map((file) => [chapterNoFromFile(file), collectFileFindings(file, "source")]));
const publishInfos = new Map(publishFiles.map((file) => [chapterNoFromFile(file), collectFileFindings(file, "publish")]));

const chapterNos = [...new Set([...sourceInfos.keys(), ...publishInfos.keys()].filter(Boolean))].sort((a, b) => a - b);
const allFindings = [];

for (const chapter of chapterNos) {
  const sourceInfo = sourceInfos.get(chapter);
  const publishInfo = publishInfos.get(chapter);
  if (sourceInfo) allFindings.push(...sourceInfo.findings);
  if (publishInfo) allFindings.push(...compareSourceAndPublish(sourceInfo, publishInfo));
}

const grouped = new Map();
for (const item of allFindings) {
  if (!grouped.has(item.chapter)) grouped.set(item.chapter, []);
  grouped.get(item.chapter).push(item);
}

const lines = [
  "# 重复段落扫描报告",
  "",
  `书籍：${bookName}`,
  "",
  `源章节数：${sourceFiles.length}`,
  `导出章节数：${publishFiles.length}`,
  `重复发现数：${allFindings.length}`,
  "",
];

if (!allFindings.length) {
  lines.push("未发现符合规则的明显重复段落。");
} else {
  for (const chapter of [...grouped.keys()].sort((a, b) => a - b)) {
    lines.push(`## 第${chapter}章`);
    lines.push("");
    for (const item of grouped.get(chapter)) {
      lines.push(formatFinding(item));
      lines.push("");
    }
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"), "utf8");

console.log(`扫描完成：${allFindings.length} 条重复发现`);
console.log(`报告：${path.relative(root, outPath)}`);
