import fs from "node:fs";
import path from "node:path";

export const WARNING_LEVELS = ["P0", "P1", "P2"];

export function chapterPrefix(chapter) {
  return String(chapter).padStart(4, "0");
}

export function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { parse_error: String(error) };
  }
}

export function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const file = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(file) : [file];
  });
}

export function findLatestJsonReport(reportDir) {
  const reports = walk(reportDir)
    .filter((file) => path.extname(file).toLowerCase() === ".json")
    .filter((file) => {
      const json = readJsonIfExists(file);
      return Boolean(json?.book && json?.request && json?.finalStatus && Array.isArray(json?.chapters));
    })
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
  return reports[0]?.file || null;
}

export function isReadyChapter(chapter) {
  return String(chapter?.finalStatus || "").toUpperCase() === "READY_TO_PUBLISH";
}

export function findFirstFailedChapter(report) {
  return (report?.chapters || []).find((chapter) => !isReadyChapter(chapter)) || null;
}

export function inferFailureKind(chapter) {
  const finalStatus = String(chapter?.finalStatus || "").toUpperCase();
  const publishStatus = String(chapter?.publishReadyFinalStatus || "").toUpperCase();
  const corpus = JSON.stringify(chapter || {}).toUpperCase();

  if (finalStatus.includes("WRITE_AUDIT")) return "writeAudit";
  if (finalStatus.includes("NUMERIC")) return "numeric";
  if (finalStatus.includes("SIX_PART") || publishStatus.includes("SIX_PART") || corpus.includes("SIX_PART_FAIL")) return "sixPart";
  if (finalStatus.includes("CONTINUITY") || publishStatus.includes("CONTINUITY") || corpus.includes("BLOCKED_BY_CONTINUITY")) return "continuity";
  if (finalStatus.includes("QUALITY") || publishStatus.includes("QUALITY") || corpus.includes("BLOCKED_BY_QUALITY")) return "quality";
  if (finalStatus.includes("DROP") || publishStatus.includes("DROP") || corpus.includes("DROP")) return "drop";
  return "unknown";
}

export function makeResumePlan({ sourceReportPath, sourceReport, bookDir }) {
  const failed = findFirstFailedChapter(sourceReport);
  if (!failed) {
    return {
      enabled: true,
      sourceReport: sourceReportPath,
      resumedFromChapter: null,
      remainingCount: 0,
      noResumeNeeded: true,
      reason: "source report is already READY_TO_PUBLISH",
      queue: [],
      remainingNewCount: 0,
    };
  }

  const chapters = sourceReport?.chapters || [];
  const failedIndex = chapters.indexOf(failed);
  const requestedCount = Number.isInteger(sourceReport?.request?.count) ? sourceReport.request.count : null;
  const requestedFrom = Number.isInteger(sourceReport?.request?.from) ? sourceReport.request.from : null;
  const requestedTo = Number.isInteger(sourceReport?.request?.to) ? sourceReport.request.to : null;
  const failedChapter = Number(failed.chapter);
  const queue = [];
  let remainingNewCount = 0;

  if (requestedCount !== null) {
    queue.push({ chapter: failedChapter, resumeKind: inferFailureKind(failed), sourceChapter: failed });
    remainingNewCount = Math.max(0, requestedCount - failedIndex - 1);
  } else if (requestedFrom !== null && requestedTo !== null) {
    for (let chapter = failedChapter; chapter <= requestedTo; chapter += 1) {
      const sourceChapter = chapters.find((item) => Number(item.chapter) === chapter);
      queue.push({
        chapter,
        resumeKind: chapter === failedChapter && sourceChapter ? inferFailureKind(sourceChapter) : "normal",
        sourceChapter,
      });
    }
  } else {
    queue.push({ chapter: failedChapter, resumeKind: inferFailureKind(failed), sourceChapter: failed });
  }

  return {
    enabled: true,
    sourceReport: sourceReportPath,
    resumedFromChapter: chapterPrefix(failedChapter),
    remainingCount: queue.length + remainingNewCount,
    noResumeNeeded: false,
    queue,
    remainingNewCount,
    failedChapter: failed,
    bookDir,
  };
}

export function hasWriteRetryHint(bookDir, chapter) {
  return fs.existsSync(path.join(bookDir, "reviews", "write-retry-hints", `${chapterPrefix(chapter)}.md`));
}

export function hasContinuityResumeArtifact(bookDir, chapter) {
  const fixedDir = path.join(bookDir, "chapters-fixed");
  const prefix = chapterPrefix(chapter);
  const fixed = walk(fixedDir).some((file) => new RegExp(`^${prefix}_attempt\\d+\\.md$`, "iu").test(path.basename(file)));
  if (fixed) return true;
  const publishReport = readJsonIfExists(path.join(bookDir, "reviews", "publish-ready", `${prefix}.publish-report.json`));
  const finalFile = publishReport?.final_file || publishReport?.finalFile || publishReport?.inputFile || publishReport?.input_file;
  return Boolean(finalFile);
}

function addWarning(summary, level, code, message, details = {}) {
  const bucket = summary[level];
  if (!bucket.some((item) => item.code === code && item.chapter === details.chapter)) {
    bucket.push({ code, message, ...details });
  }
}

function chapterCorpus(chapter) {
  return [
    JSON.stringify(chapter || {}),
    ...(chapter?.steps || []).map((step) => `${step.name}\n${step.summary || ""}\n${step.stdout || ""}\n${step.stderr || ""}`),
  ].join("\n");
}

function findQualityScore(chapter) {
  const text = chapterCorpus(chapter);
  const match = text.match(/quality[_\s-]*(?:score)?["':：\s]+(\d{1,3})/iu)
    || text.match(/质量(?:分|评分)["':：\s]+(\d{1,3})/u)
    || text.match(/score["':：\s]+(\d{1,3})/iu);
  return match ? Number(match[1]) : null;
}

export function buildWarningSummary(report, { bookDir } = {}) {
  const summary = { P0: [], P1: [], P2: [] };

  for (const chapter of report.chapters || []) {
    const chapterId = chapterPrefix(chapter.chapter);
    const finalStatus = String(chapter.finalStatus || "").toUpperCase();
    const publishStatus = String(chapter.publishReadyFinalStatus || "").toUpperCase();
    const text = chapterCorpus(chapter);

    if ((chapter.numeric?.A ?? 0) > 0) addWarning(summary, "P0", "NUMERIC_A", `numeric A=${chapter.numeric.A}`, { chapter: chapterId });
    if (/DROP/u.test(`${finalStatus}\n${publishStatus}\n${text}`)) addWarning(summary, "P0", "DROP", "DROP blocks publish", { chapter: chapterId });
    if (/BLOCKED_BY_CONTINUITY|STOPPED_BY_CONTINUITY/u.test(`${finalStatus}\n${publishStatus}\n${text}`)) addWarning(summary, "P0", "BLOCKED_BY_CONTINUITY", "continuity blocks publish", { chapter: chapterId });
    if (/BLOCKED_BY_QUALITY|STOPPED_BY_QUALITY/u.test(`${finalStatus}\n${publishStatus}\n${text}`)) addWarning(summary, "P0", "BLOCKED_BY_QUALITY", "quality blocks publish", { chapter: chapterId });
    if (/SIX_PART_FAIL|STOPPED_BY_SIX_PART/u.test(`${finalStatus}\n${publishStatus}\n${text}`)) addWarning(summary, "P0", "SIX_PART_FAIL", "six-part structure blocks publish", { chapter: chapterId });
    if (finalStatus === "STOPPED_BY_WRITE_AUDIT" || /did not create chapter file|没有落盘|No chapter file was created/iu.test(text)) {
      addWarning(summary, "P0", "WRITE_NEXT_NO_FILE", "write next did not land a chapter file", { chapter: chapterId });
    }
    if (finalStatus === "READY_TO_PUBLISH" && bookDir && !report.request?.dryRun) {
      const finalFile = path.join(bookDir, "chapters-reviewed", `${chapterId}_final.md`);
      if (!fs.existsSync(finalFile)) addWarning(summary, "P0", "FINAL_FILE_MISSING", "final file does not exist", { chapter: chapterId, path: finalFile });
    }

    if (publishStatus === "READY_WITH_WARNINGS" || /READY_WITH_WARNINGS/u.test(text)) {
      addWarning(summary, "P1", "READY_WITH_WARNINGS", "publish-ready returned READY_WITH_WARNINGS", { chapter: chapterId });
    }
    if (/QUALITY_WARN_POLISH_OPTIONAL/u.test(text)) addWarning(summary, "P1", "QUALITY_WARN_POLISH_OPTIONAL", "quality polish is optional but recommended", { chapter: chapterId });
    const score = findQualityScore(chapter);
    if (score !== null && score >= 80 && score <= 84) addWarning(summary, "P1", "QUALITY_SCORE_80_84", `quality score ${score}`, { chapter: chapterId, score });
    if (/mood-cadence.*(?:still|仍未|未满足|fail|failed)/iu.test(text)) addWarning(summary, "P1", "MOOD_CADENCE_STILL_UNMET", "mood-cadence still unmet after spot-fix", { chapter: chapterId });
    if (/missing_state_change/u.test(text)) addWarning(summary, "P1", "MISSING_STATE_CHANGE", "missing_state_change", { chapter: chapterId });
    if (/payoff-impact-missing/u.test(text)) addWarning(summary, "P1", "PAYOFF_IMPACT_MISSING", "payoff-impact-missing", { chapter: chapterId });
    if (/列表式\s*AI\s*结构|AI\s*结构|list-like AI/iu.test(text)) addWarning(summary, "P1", "LIST_LIKE_AI_STRUCTURE", "list-like AI structure", { chapter: chapterId });
    if (/连续长句过多|too many long sentences/iu.test(text)) addWarning(summary, "P1", "TOO_MANY_LONG_SENTENCES", "too many consecutive long sentences", { chapter: chapterId });
    if (/字数严重超出|word_count.*(?:too high|too low|严重|outside)/iu.test(text)) addWarning(summary, "P1", "WORD_COUNT_SERIOUS_OUT_OF_RANGE", "word count seriously outside target range", { chapter: chapterId });
    if (/标题.*(?:大幅改写|major rewrite)|title.*major/iu.test(text)) addWarning(summary, "P1", "TITLE_MAJOR_REWRITE", "title was significantly rewritten", { chapter: chapterId });

    if ((chapter.numeric?.C ?? 0) > 0) addWarning(summary, "P2", "NUMERIC_C", `numeric C=${chapter.numeric.C}`, { chapter: chapterId });
    if (/minor.*state.*warning|状态校验.*(?:轻微|普通|warning)/iu.test(text)) addWarning(summary, "P2", "MINOR_STATE_WARNING", "minor state validation warning", { chapter: chapterId });
    if (/标题.*(?:轻微优化|优化)|title.*minor/iu.test(text)) addWarning(summary, "P2", "TITLE_MINOR_OPTIMIZATION", "title minor optimization", { chapter: chapterId });
    if (/paragraph warning|段落.*warning|普通 paragraph warning/iu.test(text)) addWarning(summary, "P2", "PARAGRAPH_WARNING", "paragraph warning", { chapter: chapterId });
  }

  if (report.exportStep && report.exportStep.exitCode !== 0) {
    addWarning(summary, "P0", "EXPORT_FAILED", "export failed", {});
  }

  return summary;
}

export function riskLevelForWarningSummary(summary) {
  if (summary.P0.length > 0) return "BLOCKED";
  if (summary.P1.length > 0) return "MEDIUM";
  return "LOW";
}

export function publishAdviceForWarningSummary(summary) {
  if (summary.P0.length > 0) return "DO_NOT_PUBLISH";
  if (summary.P1.length > 0) return "CAN_PUBLISH_WITH_WARNINGS";
  return "CAN_PUBLISH";
}

export function buildAutoFixSuggestions(report, bookName) {
  const suggestions = [];
  const seen = new Set();
  for (const level of WARNING_LEVELS) {
    for (const warning of report.warningSummary?.[level] || []) {
      const key = `${level}:${warning.code}:${warning.chapter || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const chapter = warning.chapter ? String(Number(warning.chapter)) : "";
      if (warning.code === "NUMERIC_A") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedCommand: `node scripts/fanqie/fix-numeric-expression.mjs ${bookName} --chapter ${chapter} --final-only`,
        });
      } else if (warning.code === "BLOCKED_BY_CONTINUITY") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedCommand: `node ../packages/cli/dist/index.js review continuity-auto --book ${bookName} --chapter ${chapter} --max-fix-attempts 1`,
        });
      } else if (warning.code === "BLOCKED_BY_QUALITY") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedCommand: `node ../packages/cli/dist/index.js review fanqie-polish --book ${bookName} --chapter ${chapter}`,
        });
      } else if (warning.code === "SIX_PART_FAIL") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedCommand: `node scripts/fanqie/repair-fanqie.mjs ${bookName} --chapter ${chapter} --apply`,
        });
      } else if (warning.code === "DROP" || warning.code === "WRITE_NEXT_NO_FILE" || warning.code === "FINAL_FILE_MISSING" || warning.code === "EXPORT_FAILED") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedAction: "Stop and repair manually before publishing.",
        });
      } else if (warning.code === "QUALITY_WARN_POLISH_OPTIONAL" || warning.code === "QUALITY_SCORE_80_84" || warning.code === "READY_WITH_WARNINGS") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedCommand: `node ../packages/cli/dist/index.js review fanqie-polish --book ${bookName} --chapter ${chapter}`,
        });
      } else if (warning.code === "MISSING_STATE_CHANGE" || warning.code === "MINOR_STATE_WARNING") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedAction: "补充状态卡同步，或检查状态卡审计是否需要降低强度。",
        });
      } else if (level === "P1") {
        suggestions.push({
          type: warning.code,
          priority: level,
          chapter: warning.chapter,
          suggestedAction: "按 warning 类型做人工定点润色；不要改主线。",
        });
      }
    }
  }
  return suggestions;
}

export function latestFailedChapter(report) {
  const failed = (report.chapters || []).filter((chapter) => !isReadyChapter(chapter));
  return failed[failed.length - 1] || null;
}

function promptByKind(kind, { bookName, chapterId }) {
  if (kind === "writeAudit") {
    return `请修复《${bookName}》第${chapterId}章的 write audit 失败。重点检查 promised payoff、ending type、mood directive、scene semantic。请重试写章，不改主线、不跳过既定承接，只补足本章应兑现的情绪与事件闭环。`;
  }
  if (kind === "continuity") {
    return `请修复《${bookName}》第${chapterId}章连续性问题。重点核对上一章承接、人物状态、伏笔、战力与伤势一致性。只修复章节连续性，不改主线走向。`;
  }
  if (kind === "quality") {
    return `请润色《${bookName}》第${chapterId}章质量问题。重点加强网文节奏、番茄风格、段落密度、爽点兑现与章尾钩子。不改主线，只做发布向润色。`;
  }
  if (kind === "numeric") {
    return `请修复《${bookName}》第${chapterId}章 numeric final-only A 类问题。非系统流沉浸模式下避免突兀阿拉伯数字，保留自然中文表达，例如“两成功力”。不改剧情，只替换破坏沉浸的数字表达。`;
  }
  if (kind === "sixPart") {
    return `请修复《${bookName}》第${chapterId}章六段节奏问题。重点补齐 Hook / Pressure / Attempt / Twist / Payoff / Pull 的缺失功能。不改主线，只补齐节奏功能与追读牵引。`;
  }
  return `请定位并修复《${bookName}》第${chapterId}章 write-publish-export 失败。先阅读报告中的失败步骤和日志摘要，再给出最小修改方案；不要改动主线或无关章节。`;
}

export function generateManualFixPrompt({ root, bookDir, bookName, chapterRun, report }) {
  if (!chapterRun) return { generated: false, path: "" };
  const chapterId = chapterPrefix(chapterRun.chapter);
  const kind = inferFailureKind(chapterRun);
  const dir = path.join(bookDir, "reviews", "manual-fix-prompts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chapterId}.md`);
  const failedStep = [...(chapterRun.steps || [])].reverse().find((step) => step.exitCode !== 0) || [...(chapterRun.steps || [])].reverse()[0] || null;
  const remedies = [];
  if (chapterRun.writeAuditFailure?.retryHintPath) remedies.push(`retry hint: ${chapterRun.writeAuditFailure.retryHintPath}`);
  if (chapterRun.didContinuityAuto) remedies.push("continuity-auto");
  if (chapterRun.didFanqiePolish) remedies.push("fanqie-polish");
  if (chapterRun.didRepairFanqie) remedies.push("repair-fanqie");
  if (!remedies.length) remedies.push("none");
  const prompt = promptByKind(kind, { bookName, chapterId });
  const relPath = (target) => path.relative(root, target) || ".";

  const content = `# Manual Fix Prompt ${chapterId}

1. 书名：${bookName}
2. 章节号：${chapterId}
3. 失败状态：${chapterRun.finalStatus || "UNKNOWN_ERROR"}
4. 失败步骤：${failedStep?.name || "UNKNOWN"}
5. 关键日志摘要：

${failedStep?.summary || report.stopReason || "n/a"}

6. 已执行过的补救动作：${remedies.join(", ")}
7. 建议下一步：${prompt}
8. 可直接发给 Codex 的修复提示词：

\`\`\`text
${prompt}
\`\`\`
`;

  fs.writeFileSync(file, content, "utf8");
  return { generated: true, path: relPath(file) };
}
