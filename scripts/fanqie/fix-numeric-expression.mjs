#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const argv = process.argv.slice(2);
const bookName = argv[0];

function usage() {
  console.error(`Usage:
  node scripts/fanqie/fix-numeric-expression.mjs <book> --chapter <n> [--final-only]
  node scripts/fanqie/fix-numeric-expression.mjs <book> --from <n> --to <n> [--final-only]`);
}

function getArg(name, fallback = undefined) {
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) return argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

function chapterPrefix(chapter) {
  return String(chapter).padStart(4, "0");
}

function rel(file) {
  return path.relative(root, file) || ".";
}

function parsePositiveInt(name, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function replacePercentContext(text) {
  const changes = [];
  const patterns = [
    {
      re: /不足\s*\d+(?:\.\d+)?\s*%\s*的\s*气血/giu,
      replacement: "几乎见底的气血",
      reason: "percentage-state",
    },
    {
      re: /仅剩\s*\d+(?:\.\d+)?\s*%\s*的\s*气血/giu,
      replacement: "只剩一口残息般的气血",
      reason: "percentage-state",
    },
    {
      re: /气血\s*恢复至\s*\d+(?:\.\d+)?\s*%/giu,
      replacement: "气血勉强回暖了一线",
      reason: "percentage-state",
    },
    {
      re: /只剩\s*\d+(?:\.\d+)?\s*%/giu,
      replacement: "几乎只剩一口残息",
      reason: "percentage-state",
    },
    {
      re: /(?:提升|上涨|增强)\s*\d+(?:\.\d+)?\s*%/giu,
      replacement: "明显拔高了一截",
      reason: "numeric-gain-cost",
    },
    {
      re: /(?:降低|下降|削弱)\s*\d+(?:\.\d+)?\s*%/giu,
      replacement: "明显跌落了一截",
      reason: "numeric-gain-cost",
    },
  ];

  let next = text;
  for (const pattern of patterns) {
    next = next.replace(pattern.re, (match) => {
      changes.push({ from: match, to: pattern.replacement, reason: pattern.reason });
      return pattern.replacement;
    });
  }
  return { text: next, changes };
}

function replaceTimeDistanceAndPanel(text) {
  const changes = [];
  const patterns = [
    { re: /\b3\s*秒后\b/giu, replacement: "数息之后", reason: "time" },
    { re: /\b10\s*分钟\b/giu, replacement: "一小段工夫", reason: "time" },
    { re: /\b100\s*米外\b/giu, replacement: "百丈之外", reason: "distance" },
    { re: /\b30\s*米外\b/giu, replacement: "数十步外", reason: "distance" },
    { re: /HP\s*(?:归零|0)\b/giu, replacement: "气血彻底见底", reason: "panel-keyword" },
    { re: /气血值\s*0\b/giu, replacement: "气血彻底见底", reason: "panel-keyword" },
    { re: /伤害\s*\d+\s*点/giu, replacement: "伤势猛地加重", reason: "numeric-gain-cost" },
  ];
  let next = text;
  for (const pattern of patterns) {
    next = next.replace(pattern.re, (match) => {
      changes.push({ from: match, to: pattern.replacement, reason: pattern.reason });
      return pattern.replacement;
    });
  }
  return { text: next, changes };
}

function fixText(text) {
  const first = replacePercentContext(text);
  const second = replaceTimeDistanceAndPanel(first.text);
  return { text: second.text, changes: [...first.changes, ...second.changes] };
}

function finalFileFor(bookDir, chapter) {
  return path.join(bookDir, "chapters-reviewed", `${chapterPrefix(chapter)}_final.md`);
}

function renderMarkdown({ bookName, finalOnly, results }) {
  const lines = [
    "# Numeric Expression Fix Report",
    "",
    `- book: ${bookName}`,
    `- final-only: ${finalOnly ? "true" : "false"}`,
    `- generatedAt: ${new Date().toISOString()}`,
    "",
    "## Results",
    "",
    "| Chapter | Status | Fixed File | Backup File | Changes |",
    "| --- | --- | --- | --- | ---: |",
  ];
  for (const result of results) {
    lines.push(`| ${result.chapter} | ${result.status} | ${result.fixedFile || "n/a"} | ${result.backupFile || "n/a"} | ${result.changes.length} |`);
  }
  lines.push("");
  for (const result of results) {
    lines.push(`## ${result.chapter}`, "");
    if (result.error) lines.push(`- error: ${result.error}`, "");
    if (!result.changes.length) {
      lines.push("- changes: none", "");
      continue;
    }
    lines.push("| From | To | Reason |");
    lines.push("| --- | --- | --- |");
    for (const change of result.changes) {
      lines.push(`| ${change.from.replaceAll("|", "\\|")} | ${change.to.replaceAll("|", "\\|")} | ${change.reason} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  if (!bookName || hasFlag("help") || hasFlag("h")) {
    usage();
    process.exit(bookName ? 0 : 1);
  }

  const chapterRaw = getArg("chapter");
  const fromRaw = getArg("from");
  const toRaw = getArg("to");
  const finalOnly = hasFlag("final-only");
  const dryRun = hasFlag("dry-run");
  if (!finalOnly) {
    // Kept for CLI compatibility, but the v2 safety rule is to repair final files only.
  }
  if (chapterRaw && (fromRaw || toRaw)) throw new Error("--chapter cannot be combined with --from/--to");
  if (!chapterRaw && (!fromRaw || !toRaw)) throw new Error("Use either --chapter <n> or --from <n> --to <n>");

  const from = chapterRaw ? parsePositiveInt("chapter", chapterRaw) : parsePositiveInt("from", fromRaw);
  const to = chapterRaw ? from : parsePositiveInt("to", toRaw);
  if (to < from) throw new Error("--to must be greater than or equal to --from");

  const bookDir = path.join(root, "my-novel", "books", bookName);
  if (!fs.existsSync(bookDir)) throw new Error(`Cannot find book directory: ${rel(bookDir)}`);
  const reportDir = path.join(bookDir, "reviews", "numeric-expression");
  fs.mkdirSync(reportDir, { recursive: true });

  const results = [];
  for (let chapter = from; chapter <= to; chapter += 1) {
    const chapterId = chapterPrefix(chapter);
    const file = finalFileFor(bookDir, chapter);
    const backupFile = path.join(path.dirname(file), `${chapterId}_final.numeric-backup.md`);
    const result = {
      chapter: chapterId,
      status: "SKIPPED",
      fixedFile: rel(file),
      backupFile: rel(backupFile),
      changes: [],
    };

    if (!fs.existsSync(file)) {
      result.status = "MISSING_FINAL_FILE";
      result.error = `Final file does not exist: ${rel(file)}`;
      results.push(result);
      continue;
    }

    const original = fs.readFileSync(file, "utf8");
    const fixed = fixText(original);
    result.changes = fixed.changes;
    if (!fixed.changes.length || fixed.text === original) {
      result.status = "NO_CHANGES";
      results.push(result);
      continue;
    }

    result.status = "FIXED";
    if (!dryRun) {
      if (!fs.existsSync(backupFile)) fs.writeFileSync(backupFile, original, "utf8");
      fs.writeFileSync(file, fixed.text, "utf8");
    }
    results.push(result);
  }

  const reportBase = from === to
    ? `${chapterPrefix(from)}.numeric-fix-report`
    : `batch-${chapterPrefix(from)}-${chapterPrefix(to)}.numeric-fix-report`;
  const jsonPath = path.join(reportDir, `${reportBase}.json`);
  const mdPath = path.join(reportDir, `${reportBase}.md`);
  const payload = {
    book: bookName,
    finalOnly,
    dryRun,
    from,
    to,
    generatedAt: new Date().toISOString(),
    results,
  };
  if (!dryRun) {
    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(mdPath, renderMarkdown({ bookName, finalOnly, results }), "utf8");
  }

  console.log("[numeric-fix]");
  console.log(`book: ${bookName}`);
  console.log(`final-only: ${finalOnly ? "true" : "false"}`);
  console.log(`range: ${from}-${to}`);
  for (const result of results) {
    console.log(`${result.chapter}: ${result.status} changes=${result.changes.length}`);
    if (result.error) console.log(`error: ${result.error}`);
  }
  console.log(dryRun ? "report: dry-run" : `report: ${rel(jsonPath)}`);
  console.log(dryRun ? "report: dry-run" : `report: ${rel(mdPath)}`);

  const failed = results.some((result) => result.status === "MISSING_FINAL_FILE");
  process.exit(failed ? 1 : 0);
}

main();
