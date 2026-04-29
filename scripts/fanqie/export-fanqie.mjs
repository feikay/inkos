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
  const lines = source
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s*(?:创作说明|本章问题|六段检查|审核|检查|改写建议|修复建议|正文开始|正文结束)\s*\n[\s\S]*?(?=\n\s*\n|$)/gm, "")
    .replace(/INFO\s+\[.*?\].*/g, "")
    .replace(/WARN\s+\[.*?\].*/g, "")
    .replace(/ERROR\s+\[.*?\].*/g, "")
    .replace(/DEBUG\s+\[.*?\].*/g, "")
    .replace(/^\s*(?:INFO|WARN|WARNING|ERROR|DEBUG|TRACE)\b.*$/gim, "")
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
    .split(/\n+/);

  return stripYamlFrontmatterLines(lines)
    .map((s) => cleanNonNovelMarkerLine(s))
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !isMetaContentLine(s))
    .map((s) => s.replace(/([，,。；;：:！？!?])\1+/g, "$1"))
    .join("\n\n")
    .trim();
}

const STRUCTURAL_MARKER_PATTERN = /\b(?:Hook|Pressure|Attempt|Twist|Payoff|Pull|Beat|Outline|Summary|Review|TODO|Fix|Draft|Prompt)\b/i;
const CHINESE_META_MARKER_PATTERN = /(?:节奏|结构|审核|检查|改写建议|创作说明|正文开始|正文结束|本章问题|修复建议|六段检查)/;
const PROMPT_REPORT_PATTERN = /(?:请根据|请输出|请改写|请续写|生成|作为.*作者|任务[:：]|目标[:：]|要求[:：]|提示词|报告|评分|问题[:：]|建议[:：]|检查结果|以下是|上文|下文)/i;

function stripYamlFrontmatterLines(lines) {
  const result = [];
  let inFrontmatter = false;
  let seenContent = false;

  for (const line of lines) {
    const value = line.trim();
    if (!seenContent && value === "---") {
      inFrontmatter = true;
      seenContent = true;
      continue;
    }
    if (inFrontmatter) {
      if (value === "---") inFrontmatter = false;
      continue;
    }
    if (value) seenContent = true;
    result.push(line);
  }

  return result;
}

function isNormalChapterTitleLine(text) {
  const value = (text || "").trim();
  return /^(?:#{1,2}\s*)?第\s*\d+\s*章(?:\s+.*)?$/u.test(value);
}

function isMarkdownTableLine(text) {
  const value = (text || "").trim();
  return /^\|.*\|$/.test(value) || /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(value);
}

function isLogResidualLine(text) {
  const value = (text || "").trim();
  return /^(?:\[[^\]]*(?:error|warn|info|debug|trace)[^\]]*\]|(?:INFO|WARN|WARNING|ERROR|DEBUG|TRACE)\b)/i.test(value);
}

function isPureNonNovelMarker(text) {
  const value = stripTitlePrefix((text || "").trim())
    .replace(/^[:：\-—\s]+|[:：\-—\s]+$/g, "")
    .trim();
  if (!value) return false;
  if (STRUCTURAL_MARKER_PATTERN.test(value) && value.length <= 40) return true;
  if (CHINESE_META_MARKER_PATTERN.test(value) && value.length <= 40) return true;
  return false;
}

function isNovelSentenceAfterHeading(text) {
  const value = (text || "").trim();
  if (!/[\u3400-\u9fff]/.test(value)) return false;
  if (STRUCTURAL_MARKER_PATTERN.test(value) || CHINESE_META_MARKER_PATTERN.test(value)) return false;
  if (/Prompt|TODO|审核|检查|修复|建议/i.test(value)) return false;
  if (PROMPT_REPORT_PATTERN.test(value) && !/[“”"']/.test(value)) return false;
  return /(?:楚夜|云岚|他|她|水|风|雾|血|石|剑|刀|暗河|祭坛|洞穴|妖兽|怨气|灵气|符文|黑暗|忽然|突然|猛地|低声|抬|停|走|冲|看|闻|听|疼|亮|裂|倒流|咆哮|说道|问道|。|！|？|“)/.test(value);
}

function isShortChineseSectionMarker(text) {
  const value = (text || "").trim();
  if (!/[\u3400-\u9fff]/.test(value)) return false;
  if (/[。！？；，、,.!?;：“”"']/u.test(value)) return false;
  return countChineseChars(value) <= 10;
}

function cleanNonNovelMarkerLine(line) {
  const value = (line || "").trim();
  if (!value) return "";
  if (isNormalChapterTitleLine(value)) return value;
  if (isMarkdownTableLine(value)) return "";
  if (isLogResidualLine(value)) return "";
  if (/^\s*```/.test(value)) return "";
  if (value === "---") return "";

  const heading = value.match(/^#{1,6}\s*(.*?)\s*$/);
  if (heading) {
    const body = heading[1].trim();
    if (!body) return "";
    if (isNormalChapterTitleLine(body)) return body;
    if (isPureNonNovelMarker(body)) return "";
    if (isShortChineseSectionMarker(body)) return "";
    if (isNovelSentenceAfterHeading(body)) return body;
    return value;
  }

  if (isPureNonNovelMarker(value)) return "";
  if (PROMPT_REPORT_PATTERN.test(value) && !isNovelSentenceAfterHeading(value)) return "";
  return value;
}

function detectNonNovelMarkers(text, file = "") {
  const source = normalizeTextValue(text);
  const issues = [];
  const lines = source.split(/\r?\n/);
  let inCodeBlock = false;
  let inFrontmatter = false;
  let seenContent = false;

  const addIssue = (lineNo, raw, type, action) => {
    issues.push({ lineNo, raw, type, action, file });
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const raw = line;
    const value = raw.trim();
    if (!value) return;

    if (!seenContent && value === "---") {
      inFrontmatter = true;
      seenContent = true;
      addIssue(lineNo, raw, "yaml frontmatter", "delete");
      return;
    }
    if (inFrontmatter) {
      addIssue(lineNo, raw, "yaml frontmatter", "delete");
      if (value === "---") inFrontmatter = false;
      return;
    }
    seenContent = true;

    if (/^\s*```/.test(value)) {
      inCodeBlock = !inCodeBlock;
      addIssue(lineNo, raw, "代码块", "delete");
      return;
    }
    if (inCodeBlock) {
      addIssue(lineNo, raw, "代码块", "delete");
      return;
    }

    if (isMarkdownTableLine(value)) {
      addIssue(lineNo, raw, "Markdown 表格", "delete");
      return;
    }
    if (isLogResidualLine(value)) {
      addIssue(lineNo, raw, "日志残留", "delete");
      return;
    }

    const heading = value.match(/^#{1,6}\s*(.*?)\s*$/);
    if (heading) {
      if (isNormalChapterTitleLine(value)) return;
      const body = heading[1].trim();
      if (isPureNonNovelMarker(body)) {
        addIssue(lineNo, raw, "结构标记", "delete");
      } else if (isNovelSentenceAfterHeading(body)) {
        addIssue(lineNo, raw, "Markdown 标记正文句", "strip-marker");
      } else {
        addIssue(lineNo, raw, "Markdown 标题残留", "delete");
      }
      return;
    }

    if (isPureNonNovelMarker(value)) {
      addIssue(lineNo, raw, "结构标记", "delete");
      return;
    }
    if (PROMPT_REPORT_PATTERN.test(value) && !isNovelSentenceAfterHeading(value)) {
      addIssue(lineNo, raw, "提示词/报告残留", "delete");
    }
  });

  return { issues };
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
    .replace(/\s+/g, "")
    .trim();
}

function countChineseChars(text) {
  return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function isNarrativeTitleFragment(text) {
  const value = (text || "").trim();
  if (!value) return false;
  if (/^(?:楚夜|云岚|他|她|它|他们|此刻|这时|随后|突然|当|如果|因为|为了|然后|刚|正|便|就|又)/.test(value)) {
    return true;
  }
  if (/(?:试图|伸手|开口|看向|盯着|发现|感到|站在|坐在|走到|走向|传来|浮现|变得|彻底|靠在|落在|按住|闭上|深吸|喘息)/.test(value)) {
    return true;
  }
  return false;
}

function hasPollutedTitleShape(text) {
  const raw = stripTitlePrefix(text)
    .replace(/^["'“”‘’【】\[\]()（）]+|["'“”‘’【】\[\]()（）]+$/g, "")
    .trim();
  if (!raw) return false;
  if (/\n/.test(raw)) return true;
  const colonMatch = raw.match(/^[^：:]{1,18}[：:](.+)$/u);
  if (!colonMatch) return false;
  const suffix = colonMatch[1].trim();
  if (!suffix) return true;
  if (/[，。！？；,.!?;]/.test(suffix)) return true;
  if (isNarrativeTitleFragment(suffix)) return true;
  if (countChineseChars(suffix) >= 5) return true;
  return false;
}

function isStructuralTitle(text) {
  return /PRE_WRITE_CHECK|Chapter\s*Content|Scene\s*\d+|Hook|Pressure|Attempt|Twist|Payoff|Pull|Act\s*\d+|MOMENT/i.test(text);
}

function isValidTitleCandidate(text) {
  const value = normalizeTitleCandidate(text);
  if (!value) return false;
  if (hasPollutedTitleShape(text)) return false;
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

function splitIntoSentences(paragraph) {
  const text = (paragraph || "").replace(/\s+/g, "").trim();
  if (!text) return [];

  const sentences = [];
  let current = "";
  const chars = [...text];
  const endPunctuation = new Set(["。", "！", "？", "!", "?", "；", ";"]);
  const closingQuotes = new Set(["”", "\"", "」", "』"]);

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const next = chars[i + 1] || "";
    current += ch;

    if (ch === "…" && next === "…") {
      current += next;
      i += 1;
      while (closingQuotes.has(chars[i + 1] || "")) {
        current += chars[i + 1];
        i += 1;
      }
      sentences.push(current.trim());
      current = "";
      continue;
    }

    if (endPunctuation.has(ch)) {
      while (closingQuotes.has(chars[i + 1] || "")) {
        current += chars[i + 1];
        i += 1;
      }
      sentences.push(current.trim());
      current = "";
      continue;
    }

    if (closingQuotes.has(ch) && endPunctuation.has(chars[i - 1] || "")) {
      sentences.push(current.trim());
      current = "";
    }
  }

  if (current.trim()) sentences.push(current.trim());
  return sentences.filter(Boolean);
}

function formatParagraphForWebNovel(paragraph) {
  const raw = (paragraph || "").trim();
  if (!raw) return [];
  if (/^#{1,6}\s+/.test(raw)) {
    return [raw];
  }
  if (countChars(raw) <= 120) {
    return [raw];
  }

  const sentences = splitIntoSentences(raw);
  if (!sentences.length) return [raw];

  const paragraphs = [];
  let current = "";

  const flush = () => {
    const value = current.trim();
    if (value) paragraphs.push(value);
    current = "";
  };

  for (const sentence of sentences) {
    const value = sentence.trim();
    if (!value) continue;
    const sentenceLen = countChars(value);

    if (!current) {
      current = value;
      if (sentenceLen >= 120 || /^[“"].+[”"]$/.test(value)) {
        flush();
      }
      continue;
    }

    const next = `${current}${value}`;
    const nextLen = countChars(next);
    const currentLen = countChars(current);
    const isDialogue = /^[“"].+[”"]$/.test(value);

    if (
      isDialogue
      || nextLen > 120
      || (currentLen >= 40 && sentenceLen >= 40)
      || (currentLen >= 70 && sentenceLen >= 20)
    ) {
      flush();
      current = value;
      if (sentenceLen >= 120 || isDialogue) {
        flush();
      }
      continue;
    }

    current = next;

    if (countChars(current) >= 90) {
      flush();
    }
  }

  flush();
  return paragraphs;
}

function normalizeSoftLineBreaks(text) {
  const lines = (text || "").split("\n");
  const paragraphs = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    paragraphs.push(current.join("").trim());
    current = [];
  };

  for (const line of lines) {
    const value = line.trim();
    if (!value) {
      flush();
      continue;
    }

    if (/^#{1,6}\s+/.test(value)) {
      flush();
      paragraphs.push(value);
      continue;
    }

    current.push(value);
  }

  flush();
  return paragraphs.join("\n\n").trim();
}

function validateParagraphBreaks(text) {
  const warnings = [];
  const value = (text || "").trim();
  if (!value) return warnings;

  if (/[\u4e00-\u9fa5]\n(?!\n)[\u4e00-\u9fa5]/u.test(value)) {
    warnings.push("检测到中文词句被单换行截断。");
  }
  if (/(?:^|\n\n)[，。！？；：、”」』]/u.test(value)) {
    warnings.push("检测到段首出现异常标点。");
  }
  if (/(?:迅|肌|未|腥涩|深)\n(?!\n)(?:速|肉|知|。|渊)/u.test(value)) {
    warnings.push("检测到常见双字词或短语被错误断行。");
  }
  return warnings;
}

function rewriteToWebNovelStyle(text) {
  const source = normalizeSoftLineBreaks(text);
  if (!source) return "";

  const rawParagraphs = source
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const formatted = rawParagraphs.flatMap((paragraph) => formatParagraphForWebNovel(paragraph));
  return formatted.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
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
  warnings.push(...validateParagraphBreaks(text));

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
const nonNovelMarkerChecks = [];
const nonNovelMarkerFailures = [];

for (const { file, no } of chapterFiles) {
  const raw = extractText(file);
  const rawIssues = detectNonNovelMarkers(raw, file);

  let text = cleanText(raw);
  text = removeExistingTitle(text);
  const cleanedIssues = detectNonNovelMarkers(text, file);

  const sourceTitle = getChapterTitleFromFilename(file);
  const title = isValidTitleCandidate(sourceTitle) ? `第${no}章 ${sourceTitle}` : makeTitle(no, text, file);
  nonNovelMarkerChecks.push({
    no,
    title,
    file,
    rawIssues,
    cleanedIssues,
  });

  if (cleanedIssues.issues.length) {
    nonNovelMarkerFailures.push({ no, title, file, rawIssues, cleanedIssues });
    continue;
  }

  if (!text) continue;

  const rewrittenText = rewriteToWebNovelStyle(text);
  const finalText = `${title}\n\n${rewrittenText}\n`;

  const check = sixPartCheck(finalText);
  const warnings = qualityWarnings(finalText);

  const outFile = path.join(chapterOutDir, `${String(no).padStart(4, "0")}.txt`);

  exported.push({ no, title, chars: countChars(finalText), file, outFile, finalText, check, warnings });

  report.push(`## ${title}

- 原文件：\`${path.relative(root, file)}\`
- 导出字数：${countChars(finalText)}
- 6段检查：${check.score}/6 ${check.strong ? "🔥 强" : check.pass ? "✅ 可发" : "⚠️ 需改"}

${check.checks.map(([name, ok]) => `  - ${ok ? "✅" : "❌"} ${name}`).join("\n")}

${warnings.length ? `### 警告\n${warnings.map((w) => `- ${w}`).join("\n")}` : "### 警告\n- 无明显问题"}

`);
}

function formatMarkerReport(checks) {
  if (!checks.length) return "# 非正文标记检查\n\n本次没有需要检查的章节。\n";
  return `# 非正文标记检查

${checks.map(({ title, file, rawIssues, cleanedIssues }) => {
  const found = rawIssues.issues.length;
  const residual = cleanedIssues.issues.length;
  const cleaned = Math.max(found - residual, 0);
  const status = residual ? "❌" : "✅";
  const lines = [
    `## ${title}`,
    `- 原文件：\`${path.relative(root, file)}\``,
    `- 非正文标记：${found ? `发现 ${found} 处，已自动清理 ${cleaned} 处 ${status}` : `未发现 0 处 ${status}`}`,
    `- 残留：${residual} ${status}`,
  ];
  if (residual) {
    for (const issue of cleanedIssues.issues) {
      lines.push(`- 行号：${issue.lineNo}`);
      lines.push(`- 原文：${issue.raw}`);
      lines.push(`- 类型：${issue.type}`);
    }
  }
  return lines.join("\n");
}).join("\n\n")}
`;
}

function makeReportContent() {
  return `# 番茄发布检查报告

书名：${publishTitle}

导出时间：${new Date().toLocaleString("zh-CN")}

导出章节数：${exported.length}

${formatMarkerReport(nonNovelMarkerChecks)}

${report.join("\n")}
`;
}

if (nonNovelMarkerFailures.length) {
  if (!dryRun) {
    fs.writeFileSync(path.join(outDir, "report.md"), makeReportContent(), "utf8");
  }
  console.error("❌ 发现非正文标记残留，已阻止番茄导出。");
  console.error(`请查看 ${path.relative(root, path.join(outDir, "report.md"))}`);
  process.exit(1);
}

writeBookInfo(chapterFiles);

if (!dryRun) {
  for (const item of exported) {
    fs.writeFileSync(item.outFile, item.finalText, "utf8");
  }

  fs.writeFileSync(path.join(outDir, "full.txt"), exported.map((x) => x.finalText).join("\n\n"), "utf8");

  fs.writeFileSync(path.join(outDir, "report.md"), makeReportContent(), "utf8");

  if (exported.length) {
    fs.writeFileSync(markerFile, String(Math.max(...exported.map((x) => x.no))), "utf8");
  }
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
