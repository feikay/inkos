#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const argv = process.argv.slice(2);
const bookName = argv[0];

function usage() {
  console.error(`Usage:
  node scripts/fanqie/write-publish-export-trend.mjs <book> --last <n>
  node scripts/fanqie/write-publish-export-trend.mjs <book> --from <n> --to <n>`);
}

function getArg(name, fallback = undefined) {
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) return argv[idx + 1];
  return fallback;
}

function chapterPrefix(chapter) {
  return String(chapter).padStart(4, "0");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const file = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(file) : [file];
  });
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  return nums.length ? Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(2)) : null;
}

function collectReports(reportDir) {
  return walk(reportDir)
    .filter((file) => path.extname(file).toLowerCase() === ".json" && path.basename(file) !== "quality-trend.json")
    .map((file) => ({ file, report: readJson(file), mtimeMs: fs.statSync(file).mtimeMs }))
    .filter((item) => item.report)
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
}

function selectChapters({ reports, bookDir, last, from, to }) {
  const rows = [];
  for (const item of reports) {
    for (const chapter of item.report.chapters || []) {
      const chapterNo = Number(chapter.chapter);
      if (!Number.isInteger(chapterNo)) continue;
      if (from !== null && chapterNo < from) continue;
      if (to !== null && chapterNo > to) continue;
      const publish = readJson(path.join(bookDir, "reviews", "publish-ready", `${chapterPrefix(chapterNo)}.publish-report.json`));
      rows.push({ sourceReport: path.relative(root, item.file), chapterNo, chapter, publish, mtimeMs: item.mtimeMs });
    }
  }
  rows.sort((a, b) => a.mtimeMs - b.mtimeMs || a.chapterNo - b.chapterNo);
  if (last !== null) return rows.slice(-last);
  return rows;
}

function riskAndAdvice(p0, p1) {
  if (p0 > 0) return { riskLevel: "BLOCKED", advice: "DO_NOT_PUBLISH: fix P0 blockers first." };
  if (p1 > 0) return { riskLevel: "MEDIUM", advice: "CAN_PUBLISH_WITH_WARNINGS: polish high-frequency P1 warnings." };
  return { riskLevel: "LOW", advice: "CAN_PUBLISH." };
}

function buildTrend({ bookName, rows, from, to, last }) {
  const warningTypes = new Map();
  const warningCounts = { P0: 0, P1: 0, P2: 0 };
  let readyCount = 0;
  let blockedCount = 0;
  let readyToExportCount = 0;
  let readyWithWarningsCount = 0;
  let stoppedCount = 0;
  let continuityAutoCount = 0;
  let fanqiePolishCount = 0;
  let repairFanqieCount = 0;
  const numericTotals = { A: 0, B: 0, C: 0 };
  const continuityScores = [];
  const qualityScores = [];

  for (const row of rows) {
    const status = String(row.chapter.finalStatus || "");
    if (status === "READY_TO_PUBLISH") readyCount += 1;
    if (status !== "READY_TO_PUBLISH") blockedCount += 1;
    if (status.startsWith("STOPPED") || status === "UNKNOWN_ERROR") stoppedCount += 1;
    if (row.chapter.publishReadyFinalStatus === "READY_TO_EXPORT") readyToExportCount += 1;
    if (row.chapter.publishReadyFinalStatus === "READY_WITH_WARNINGS") readyWithWarningsCount += 1;
    if (row.chapter.didContinuityAuto) continuityAutoCount += 1;
    if (row.chapter.didFanqiePolish) fanqiePolishCount += 1;
    if (row.chapter.didRepairFanqie) repairFanqieCount += 1;
    numericTotals.A += row.chapter.numeric?.A ?? 0;
    numericTotals.B += row.chapter.numeric?.B ?? 0;
    numericTotals.C += row.chapter.numeric?.C ?? 0;

    const continuityScore = numberOrNull(row.publish?.continuity?.score);
    const qualityScore = numberOrNull(row.publish?.quality_score ?? row.publish?.quality?.score);
    if (continuityScore !== null) continuityScores.push(continuityScore);
    if (qualityScore !== null) qualityScores.push(qualityScore);

    for (const level of ["P0", "P1", "P2"]) {
      for (const warning of row.chapter.warningSummary?.[level] || []) {
        warningCounts[level] += 1;
        warningTypes.set(warning.code, (warningTypes.get(warning.code) || 0) + 1);
      }
    }
  }

  // Older per-chapter objects do not carry warningSummary; aggregate from report-level rows by matching chapter.
  for (const row of rows) {
    const report = readJson(path.join(root, row.sourceReport));
    for (const level of ["P0", "P1", "P2"]) {
      for (const warning of report?.warningSummary?.[level] || []) {
        if (String(Number(warning.chapter)) !== String(row.chapterNo)) continue;
        warningCounts[level] += 1;
        warningTypes.set(warning.code, (warningTypes.get(warning.code) || 0) + 1);
      }
    }
  }

  const risk = riskAndAdvice(warningCounts.P0, warningCounts.P1);
  return {
    book: bookName,
    generatedAt: new Date().toISOString(),
    scope: { last, from, to },
    chapterCount: rows.length,
    readyCount,
    blockedCount,
    avgContinuityScore: average(continuityScores),
    avgQualityScore: average(qualityScores),
    readyToExportCount,
    readyWithWarningsCount,
    stoppedCount,
    numericTotals,
    continuityAutoCount,
    fanqiePolishCount,
    repairFanqieCount,
    warningCounts,
    mostCommonWarningTypes: Array.from(warningTypes.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([type, count]) => ({ type, count })),
    riskLevel: risk.riskLevel,
    advice: risk.advice,
    chapters: rows.map((row) => ({
      chapter: chapterPrefix(row.chapterNo),
      finalStatus: row.chapter.finalStatus,
      publishReadyFinalStatus: row.chapter.publishReadyFinalStatus,
      numeric: row.chapter.numeric,
      continuityScore: numberOrNull(row.publish?.continuity?.score),
      qualityScore: numberOrNull(row.publish?.quality_score ?? row.publish?.quality?.score),
      sourceReport: row.sourceReport,
    })),
  };
}

function renderMarkdown(trend) {
  const lines = [
    "# Write Publish Export Quality Trend",
    "",
    `- book: ${trend.book}`,
    `- generatedAt: ${trend.generatedAt}`,
    `- chapter count: ${trend.chapterCount}`,
    `- ready count: ${trend.readyCount}`,
    `- blocked count: ${trend.blockedCount}`,
    `- avg continuity score: ${trend.avgContinuityScore ?? "n/a"}`,
    `- avg quality score: ${trend.avgQualityScore ?? "n/a"}`,
    `- READY_TO_EXPORT count: ${trend.readyToExportCount}`,
    `- READY_WITH_WARNINGS count: ${trend.readyWithWarningsCount}`,
    `- STOPPED count: ${trend.stoppedCount}`,
    `- numeric total: A=${trend.numericTotals.A} B=${trend.numericTotals.B} C=${trend.numericTotals.C}`,
    `- continuity-auto count: ${trend.continuityAutoCount}`,
    `- fanqie-polish count: ${trend.fanqiePolishCount}`,
    `- repair-fanqie count: ${trend.repairFanqieCount}`,
    `- warnings: P0=${trend.warningCounts.P0} P1=${trend.warningCounts.P1} P2=${trend.warningCounts.P2}`,
    `- riskLevel: ${trend.riskLevel}`,
    `- advice: ${trend.advice}`,
    "",
    "## Most Common Warning Types",
    "",
  ];
  if (!trend.mostCommonWarningTypes.length) lines.push("- none");
  for (const item of trend.mostCommonWarningTypes) lines.push(`- ${item.type}: ${item.count}`);
  lines.push("", "## Chapters", "");
  lines.push("| Chapter | Final | Publish | Continuity | Quality | Numeric | Source |");
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- |");
  for (const chapter of trend.chapters) {
    const numeric = chapter.numeric ? `A=${chapter.numeric.A ?? "n/a"} B=${chapter.numeric.B ?? "n/a"} C=${chapter.numeric.C ?? "n/a"}` : "n/a";
    lines.push(`| ${chapter.chapter} | ${chapter.finalStatus || "n/a"} | ${chapter.publishReadyFinalStatus || "n/a"} | ${chapter.continuityScore ?? "n/a"} | ${chapter.qualityScore ?? "n/a"} | ${numeric} | ${chapter.sourceReport} |`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  if (!bookName || argv.includes("--help") || argv.includes("-h")) {
    usage();
    process.exit(bookName ? 0 : 1);
  }
  const lastRaw = getArg("last");
  const fromRaw = getArg("from");
  const toRaw = getArg("to");
  const last = lastRaw === undefined ? null : Number(lastRaw);
  const from = fromRaw === undefined ? null : Number(fromRaw);
  const to = toRaw === undefined ? null : Number(toRaw);
  if (last !== null && (!Number.isInteger(last) || last < 1)) throw new Error("--last must be a positive integer");
  if (last !== null && (from !== null || to !== null)) throw new Error("--last cannot be combined with --from/--to");
  if (last === null && (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from)) {
    throw new Error("Use --last <n> or --from <n> --to <n>");
  }

  const bookDir = path.join(root, "my-novel", "books", bookName);
  const reportDir = path.join(bookDir, "reviews", "write-publish-export");
  if (!fs.existsSync(reportDir)) throw new Error(`Cannot find report directory: ${path.relative(root, reportDir)}`);
  const reports = collectReports(reportDir);
  const rows = selectChapters({ reports, bookDir, last, from, to });
  const trend = buildTrend({ bookName, rows, from, to, last });
  const jsonPath = path.join(reportDir, "quality-trend.json");
  const mdPath = path.join(reportDir, "quality-trend.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(trend, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(trend), "utf8");
  console.log("[write-publish-export-trend]");
  console.log(`chapters: ${trend.chapterCount}`);
  console.log(`riskLevel: ${trend.riskLevel}`);
  console.log(`report: ${path.relative(root, jsonPath)}`);
  console.log(`report: ${path.relative(root, mdPath)}`);
}

main();
