#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { writeBookInfoFile } from "./lib/book-info.mjs";

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
const useReviewed = hasFlag("use-reviewed");

const bookDir = path.join(root, "my-novel", "books", bookName);
const chaptersDirSource = path.join(bookDir, "chapters");
const chaptersPolishedDir = path.join(bookDir, "chapters-polished");
const chaptersReviewedDir = path.join(bookDir, "chapters-reviewed");
const chaptersSalvagedDir = path.join(bookDir, "chapters-salvaged");
const chaptersFixedDir = path.join(bookDir, "chapters-fixed");
const continuityReviewDir = path.join(bookDir, "reviews", "continuity");
const fanqieQualityReviewDir = path.join(bookDir, "reviews", "fanqie-quality");
const publishReadyReviewDir = path.join(bookDir, "reviews", "publish-ready");
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

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`无法解析 JSON：${path.relative(root, file)}\n${error.message}`);
  }
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

function formatChapterIndex(no) {
  return String(no).padStart(4, "0");
}

function getChapterTitleFromFilename(file) {
  return extractTitleFromOriginalFilename(file, getChapterNo(file));
}

function findOriginalChapterPath(bookDir, chapterIndex) {
  const chaptersDir = path.join(bookDir, "chapters");
  if (!fs.existsSync(chaptersDir)) return null;

  const candidates = fs.readdirSync(chaptersDir)
    .filter((name) => /\.(md|txt)$/i.test(name))
    .map((name) => {
      const file = path.join(chaptersDir, name);
      const base = path.basename(name, path.extname(name));
      const numbered = base.match(/^0*(\d+)(?:[_\-\s]+(.+))?$/u);
      const titled = base.match(/^第\s*0*(\d+)\s*章\s*(.*)$/u);
      const matchedNo = numbered ? Number(numbered[1]) : titled ? Number(titled[1]) : null;
      const title = extractTitleFromOriginalFilename(file, chapterIndex);
      const stat = fs.statSync(file);
      return { name, file, base, matchedNo, title, stat };
    })
    .filter((candidate) => candidate.matchedNo === chapterIndex)
    .sort((a, b) => {
      const aUnderscore = a.base.includes("_") ? 0 : 1;
      const bUnderscore = b.base.includes("_") ? 0 : 1;
      if (aUnderscore !== bUnderscore) return aUnderscore - bUnderscore;

      const aHasTitle = a.title ? 0 : 1;
      const bHasTitle = b.title ? 0 : 1;
      if (aHasTitle !== bHasTitle) return aHasTitle - bHasTitle;

      const mtimeDiff = b.stat.mtimeMs - a.stat.mtimeMs;
      if (mtimeDiff) return mtimeDiff;

      return a.name.length - b.name.length || a.name.localeCompare(b.name);
    });

  return candidates[0]?.file || null;
}

function getOriginalChapterDebugInfo(bookDir, chapterIndex) {
  const chaptersDir = path.join(bookDir, "chapters");
  const mdFiles = fs.existsSync(chaptersDir)
    ? fs.readdirSync(chaptersDir).filter((name) => /\.md$/i.test(name)).sort((a, b) => a.localeCompare(b))
    : [];
  const matchedCandidates = mdFiles.filter((name) => {
    const base = path.basename(name, path.extname(name));
    const numbered = base.match(/^0*(\d+)(?:[_\-\s]+(.+))?$/u);
    const titled = base.match(/^第\s*0*(\d+)\s*章\s*(.*)$/u);
    const matchedNo = numbered ? Number(numbered[1]) : titled ? Number(titled[1]) : null;
    return matchedNo === chapterIndex;
  });
  const nearbyNumbers = new Set([chapterIndex - 1, chapterIndex, chapterIndex + 1].map(String));
  const nearbyFiles = mdFiles
    .map((name, index) => ({ name, index }))
    .filter(({ name, index }) => {
      const base = path.basename(name, path.extname(name));
      const numbered = base.match(/^0*(\d+)/u);
      const titled = base.match(/^第\s*0*(\d+)\s*章/u);
      const matchedNo = numbered ? Number(numbered[1]) : titled ? Number(titled[1]) : null;
      if (matchedNo && nearbyNumbers.has(String(matchedNo))) return true;
      const insertion = mdFiles.findIndex((item) => item.localeCompare(`${formatChapterIndex(chapterIndex)}_`) >= 0);
      return insertion >= 0 && Math.abs(index - insertion) <= 2;
    })
    .map(({ name }) => name);

  return {
    chaptersDir,
    candidateMdCount: mdFiles.length,
    matchedCandidates,
    nearbyFiles,
  };
}

function normalizeOriginalMetadataTitle(text) {
  const value = normalizeTitleCandidate(text);
  if (!value) return "";
  return value
    .split(/[，。！？；：,!?;:]/u)[0]
    .replace(/\s+/g, "")
    .trim();
}

function extractTitleFromOriginalFilename(filePath, chapterIndex) {
  if (!filePath) return "";
  const name = path.basename(filePath);
  const numbered = name.match(/^0*(\d+)(?:[_\-\s]+(.+?))?\.(?:md|txt)$/iu);
  if (numbered && (!chapterIndex || Number(numbered[1]) === chapterIndex)) {
    return normalizeOriginalMetadataTitle(numbered[2] || "");
  }
  const titled = name.match(/^第\s*0*(\d+)\s*章\s*(.+?)\.(?:md|txt)$/iu);
  if (titled && (!chapterIndex || Number(titled[1]) === chapterIndex)) {
    return normalizeOriginalMetadataTitle(titled[2] || "");
  }
  return "";
}

function getFirstNonEmptyLine(text) {
  return (text || "").split(/\r?\n/).find((line) => line.trim()) || "";
}

function extractTitleFromMarkdownFirstLine(text, chapterIndex) {
  const line = getFirstNonEmptyLine(text);
  const value = (line || "").trim();
  if (!value) return "";
  const match = value.match(/^(?:#{1,6}\s*)?第\s*0*(\d+)\s*章(?:\s*[:：\-]\s*|\s+)(.+?)\s*$/u);
  if (!match || Number(match[1]) !== chapterIndex) return "";
  return normalizeTitleCandidate(match[2]);
}

function getChapterTitleFromFirstLine(text) {
  const value = getFirstNonEmptyLine(text).trim();
  const match = value.match(/^(?:#{1,6}\s*)?第\s*0*(\d+)\s*章(?:\s*[:：\-]\s*|\s+)(.+?)\s*$/u);
  return match?.[2] ? normalizeTitleCandidate(match[2]) : "";
}

function listFilesIfDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => path.join(dir, name)) : [];
}

function pickHighestAttempt(dir, pattern) {
  const candidates = listFilesIfDir(dir)
    .map((file) => {
      const match = path.basename(file).match(pattern);
      return match ? { file, attempt: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.attempt - a.attempt);
  return candidates[0]?.file || null;
}

function reportPaths(no) {
  const idx = formatChapterIndex(no);
  return {
    finalReport: path.join(continuityReviewDir, `${idx}.final-report.json`),
    report: path.join(continuityReviewDir, `${idx}.report.json`),
    salvageReport: path.join(continuityReviewDir, `${idx}.salvage-report.json`),
    qualityReport: path.join(fanqieQualityReviewDir, `${idx}.final-quality-report.json`),
    publishReadyReport: path.join(publishReadyReviewDir, `${idx}.publish-report.json`),
  };
}

function getReviewReports(no) {
  const paths = reportPaths(no);
  return {
    finalReport: readJsonIfExists(paths.finalReport),
    report: readJsonIfExists(paths.report),
    salvageReport: readJsonIfExists(paths.salvageReport),
    qualityReport: readJsonIfExists(paths.qualityReport),
    publishReadyReport: readJsonIfExists(paths.publishReadyReport),
  };
}

function statusOf(report, field) {
  return typeof report?.[field] === "string" ? report[field] : "";
}

function isPassStatus(report) {
  return statusOf(report, "final_status") === "PASS";
}

function isExportablePublishStatus(status) {
  return status === "READY_TO_EXPORT" || status === "READY_WITH_WARNINGS";
}

function hasBlockingReviewedStatus(no, reports) {
  const continuityDecisionReport = reports.finalReport || reports.report;
  const status = statusOf(continuityDecisionReport, "final_status");
  if (status && status !== "PASS") {
    return `Chapter ${formatChapterIndex(no)} blocked: final_status=${status}. Please fix before export.`;
  }
  if (status === "DROP" || status === "MANUAL_REVIEW") {
    return `Chapter ${formatChapterIndex(no)} blocked: final_status=${status}. Please fix before export.`;
  }
  const wordCount = Number(continuityDecisionReport?.word_count);
  const minChapterWords = Number(continuityDecisionReport?.min_chapter_words);
  if (
    status === "PASS"
    && Number.isFinite(wordCount)
    && Number.isFinite(minChapterWords)
    && minChapterWords > 0
    && wordCount < minChapterWords
  ) {
    return `Chapter ${formatChapterIndex(no)} blocked: word_count=${wordCount} < ${minChapterWords}.`;
  }

  const qualityStatus = statusOf(reports.qualityReport, "final_quality_status");
  if (qualityStatus === "QUALITY_MANUAL_REVIEW") {
    return `Chapter ${formatChapterIndex(no)} blocked: final_quality_status=${qualityStatus}. Please fix before export.`;
  }

  return "";
}

function selectReviewedChapterFile(no, originalFile) {
  const idx = formatChapterIndex(no);
  const reports = getReviewReports(no);
  if (isExportablePublishStatus(reports.publishReadyReport?.publish_status)) {
    const reportedFile = typeof reports.publishReadyReport.final_candidate_file === "string"
      ? reports.publishReadyReport.final_candidate_file
      : "";
    const candidates = [
      path.join(chaptersReviewedDir, `${idx}_final.md`),
      path.isAbsolute(reportedFile) ? reportedFile : "",
      reportedFile ? path.join(bookDir, reportedFile) : "",
      reportedFile ? path.join(path.dirname(path.dirname(bookDir)), reportedFile) : "",
    ].filter(Boolean);
    const finalFile = candidates.find((file) => fs.existsSync(file));
    if (finalFile) return { file: finalFile };
  }
  const blocked = hasBlockingReviewedStatus(no, reports);
  if (blocked) return { blocked };
  const continuityDecisionReport = reports.finalReport || reports.report;
  const finalStatusPass = isPassStatus(continuityDecisionReport);
  const decisionSource = statusOf(reports.finalReport, "decision_source");
  const salvageStatusPass = reports.finalReport
    ? finalStatusPass && decisionSource === "salvage"
    : (isPassStatus(reports.salvageReport) || finalStatusPass);

  const polishedFile = pickHighestAttempt(
    chaptersPolishedDir,
    new RegExp(`^${idx}_polished_attempt(\\d+)\\.md$`, "i")
  );
  if (polishedFile && statusOf(reports.qualityReport, "final_quality_status") === "QUALITY_PASS") {
    return { file: polishedFile };
  }

  if (reports.finalReport && finalStatusPass && typeof reports.finalReport.used_file === "string") {
    const usedFile = path.isAbsolute(reports.finalReport.used_file)
      ? reports.finalReport.used_file
      : path.join(bookDir, reports.finalReport.used_file);
    if (fs.existsSync(usedFile)) return { file: usedFile };
  }

  const salvageLightfixFile = path.join(chaptersSalvagedDir, `${idx}_salvage_lightfix.md`);
  if (fs.existsSync(salvageLightfixFile) && salvageStatusPass) {
    return { file: salvageLightfixFile };
  }

  const salvageFile = path.join(chaptersSalvagedDir, `${idx}_salvage.md`);
  if (fs.existsSync(salvageFile) && salvageStatusPass) {
    return { file: salvageFile };
  }

  const fixedFile = pickHighestAttempt(
    chaptersFixedDir,
    new RegExp(`^${idx}_attempt(\\d+)\\.md$`, "i")
  );
  if (fixedFile && finalStatusPass) {
    return { file: fixedFile };
  }

  return { file: originalFile };
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

function isInvalidGeneratedTitle(title) {
  const value = normalizeTitleCandidate(title);
  if (!value) return true;
  if (value === "未命名章节") return true;
  if (countChineseChars(value) > 14 || [...value].length > 18) return true;
  if (/[，。！？；：]/u.test(value)) return true;
  if (/^(?:是|像是|这是|那是|这里|那里|不能|他|她|它|他们|楚夜|云岚|我|你|此刻|这时|随后|突然|当|如果|因为|为了|然后|刚|正|便|就|又)/u.test(value)) {
    return true;
  }
  if (/^[“”"']|[“”"']$/u.test(value)) return true;
  if (/(?:声音|传来|响起|看着|走进|抬头|低声|说道|问道|像是|正在|开口|看向|盯着|发现|感到|站在|坐在|走到|走向|浮现|变得|彻底|靠在|落在|按住|闭上|深吸|喘息|转动|打开什么)/u.test(value)) {
    return true;
  }
  if (/^(?:.+的声音|.+的气息|.+的感觉|.+的味道)/u.test(value)) return true;
  return false;
}

function isValidOriginalTitleCandidate(text) {
  const value = normalizeOriginalMetadataTitle(text);
  if (!value) return false;
  if (value === "未命名章节") return false;
  if (/\n/.test(value)) return false;
  if (isStructuralTitle(value)) return false;
  if (/[。！？；.!?;]/.test(value)) return false;
  if (/[：:]/.test(value)) return false;
  if (/[*|/\\]/.test(value)) return false;
  if (/(?:说明|设定|机制|正文|修正|新增|摘要|大纲|预计增量|当前资源)/.test(value)) return false;
  if (countChineseChars(value) > 14 || [...value].length > 18) return false;
  return true;
}

function isValidTitleCandidate(text) {
  const value = normalizeTitleCandidate(text);
  if (isInvalidGeneratedTitle(value)) return false;
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
  if (value.length > 14) return false;
  if (countChineseChars(value) > 14) return false;
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
  return `第${no}章 未命名章节`;
}

function findTitleValueInObject(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["chapter_title", "chapterTitle", "title"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return normalizeTitleCandidate(value[key]);
    }
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === "object") {
      const found = findTitleValueInObject(item);
      if (found) return found;
    }
  }
  return "";
}

function getReportTitleCandidate(chapterIndex) {
  const paths = reportPaths(chapterIndex);
  for (const report of [readJsonIfExists(paths.finalReport), readJsonIfExists(paths.report)]) {
    const title = findTitleValueInObject(report);
    if (isValidOriginalTitleCandidate(title)) return title;
  }
  return "";
}

function resolveChapterTitle({
  bookDir,
  chapterIndex,
  originalPath,
  reviewedChapterPath,
  reviewedText,
  originalText,
}) {
  const originalChapterPath = originalPath || findOriginalChapterPath(bookDir, chapterIndex);
  const loadedOriginalText = typeof originalText === "string"
    ? originalText
    : readIfExists(originalChapterPath || "");
  const reviewedFirstLineTitle = extractTitleFromMarkdownFirstLine(reviewedText, chapterIndex);
  const reviewedIsSeparate = originalChapterPath
    && reviewedChapterPath
    && path.resolve(reviewedChapterPath) !== path.resolve(originalChapterPath);
  const reviewedFirstLineRaw = normalizeTitleCandidate(getFirstNonEmptyLine(reviewedText));
  const ignoredReviewedTitle = reviewedIsSeparate
    && reviewedFirstLineRaw
    && !isValidTitleCandidate(reviewedFirstLineTitle || reviewedFirstLineRaw)
    ? reviewedFirstLineRaw
    : "";

  const candidates = [
    ["original_filename", extractTitleFromOriginalFilename(originalChapterPath, chapterIndex)],
    ["original_heading", normalizeOriginalMetadataTitle(extractTitleFromMarkdownFirstLine(loadedOriginalText, chapterIndex))],
  ];

  if (reviewedIsSeparate) {
    candidates.push(["reviewed_heading", reviewedFirstLineTitle]);
  }

  candidates.push(
    ["continuity_report", getReportTitleCandidate(chapterIndex)],
    ["body_heading", reviewedFirstLineTitle]
  );

  for (const [source, candidate] of candidates) {
    const isOriginal = source.startsWith("original_");
    const isMetadata = isOriginal || source === "continuity_report";
    const isValid = isMetadata
      ? isValidOriginalTitleCandidate(candidate)
      : isValidTitleCandidate(candidate);
    if (isValid) {
      const titleText = isMetadata ? normalizeOriginalMetadataTitle(candidate) : normalizeTitleCandidate(candidate);
      return {
        titleText,
        title: `第${chapterIndex}章 ${titleText}`,
        source,
        originalPathFound: Boolean(originalChapterPath),
        originalTitleFound: isOriginal,
        ignoredReviewedTitle,
      };
    }
  }

  return {
    titleText: "未命名章节",
    title: `第${chapterIndex}章 未命名章节`,
    source: "fallback",
    originalPathFound: Boolean(originalChapterPath),
    originalTitleFound: false,
    ignoredReviewedTitle,
  };
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

let lastExport = 0;
if (incremental && fs.existsSync(markerFile)) {
  lastExport = Number(fs.readFileSync(markerFile, "utf8")) || 0;
}

const chapterScanRoot = fs.existsSync(chaptersDirSource) ? chaptersDirSource : bookDir;

const originalChapterFiles = walk(chapterScanRoot)
  .filter((f) => /\.(md|txt)$/i.test(f))
  .filter((f) => isChapterSourceFile(f))
  .map((file) => ({ file, no: getChapterNo(file) }))
  .filter((x) => x.no)
  .filter((x) => x.no >= from && x.no <= to)
  .filter((x) => !incremental || x.no > lastExport)
  .sort((a, b) => a.no - b.no);

const blockedReviewedChapters = [];
const chapterFiles = originalChapterFiles.map(({ file, no }) => {
  const originalFile = findOriginalChapterPath(bookDir, no) || file;
  if (!useReviewed) return { file, originalFile, no };
  const selected = selectReviewedChapterFile(no, file);
  if (selected.blocked) {
    blockedReviewedChapters.push(selected.blocked);
    return { file, originalFile, no, blocked: selected.blocked };
  }
  return { file: selected.file, originalFile, no };
}).filter((x) => !x.blocked);

if (blockedReviewedChapters.length) {
  for (const message of blockedReviewedChapters) console.error(message);
  process.exit(1);
}

if (!chapterFiles.length) {
  console.log("没有找到需要导出的章节。");
  if (incremental) console.log(`当前为增量模式，上次导出到第 ${lastExport} 章。`);
  process.exit(0);
}

console.log("[export-fanqie]");
for (const { file, no } of chapterFiles) {
  console.log(`${formatChapterIndex(no)} -> body: ${path.relative(bookDir, file)}`);
}

const exported = [];
const report = [];
const nonNovelMarkerChecks = [];
const nonNovelMarkerFailures = [];

for (const { file, originalFile, no } of chapterFiles) {
  const raw = extractText(file);
  const originalRaw = path.resolve(file) === path.resolve(originalFile) ? raw : extractText(originalFile);
  const rawIssues = detectNonNovelMarkers(raw, file);

  let text = cleanText(raw);
  text = removeExistingTitle(text);
  const cleanedIssues = detectNonNovelMarkers(text, file);

  const titleInfo = resolveChapterTitle({
    bookDir,
    chapterIndex: no,
    originalPath: originalFile,
    reviewedChapterPath: file,
    reviewedText: raw,
    originalText: originalRaw,
  });
  const title = titleInfo.title;
  if (!titleInfo.originalPathFound) {
    console.log(`${formatChapterIndex(no)} original title not found`);
    const debug = getOriginalChapterDebugInfo(bookDir, no);
    console.log("[export-fanqie:title-debug]");
    console.log(`chapter: ${formatChapterIndex(no)}`);
    console.log(`chaptersDir: ${debug.chaptersDir}`);
    console.log(`candidate md count: ${debug.candidateMdCount}`);
    console.log(`matched candidates: ${JSON.stringify(debug.matchedCandidates)}`);
    console.log("nearby files:");
    for (const name of debug.nearbyFiles) console.log(`- ${name}`);
  }
  if (titleInfo.ignoredReviewedTitle) {
    console.log(`${formatChapterIndex(no)} reviewed title invalid: ${titleInfo.ignoredReviewedTitle}`);
  }
  console.log(`${formatChapterIndex(no)} -> title: ${titleInfo.titleText} (source: ${titleInfo.source})`);
  nonNovelMarkerChecks.push({
    no,
    title,
    file,
    originalFile,
    rawIssues,
    cleanedIssues,
  });

  if (cleanedIssues.issues.length) {
    nonNovelMarkerFailures.push({ no, title, file, originalFile, rawIssues, cleanedIssues });
    continue;
  }

  if (!text) continue;

  const rewrittenText = rewriteToWebNovelStyle(text);
  const finalText = `${title}\n\n${rewrittenText}\n`;

  const check = sixPartCheck(finalText);
  const warnings = qualityWarnings(finalText);

  const outFile = path.join(chapterOutDir, `${String(no).padStart(4, "0")}.txt`);

  exported.push({ no, title, chars: countChars(finalText), file, originalFile, outFile, finalText, check, warnings });

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

if (!dryRun) {
  const bookInfoResult = writeBookInfoFile({
    book: bookName,
    bookDir,
    publishDir: outDir,
    alternatePublishDir: path.join(root, "publish", bookName),
    exportMeta: {
      title: publishTitle,
      from,
      to,
      wordCount: exported.reduce((sum, item) => sum + item.chars, 0),
    },
    chapters: exported,
    options: { useReviewed, incremental, reset },
  });
  for (const warning of bookInfoResult.warnings || []) {
    console.warn(`[book-info] warning: ${warning}`);
  }
}

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
