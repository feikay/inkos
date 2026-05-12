#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAutoFixSuggestions,
  buildWarningSummary,
  findLatestJsonReport,
  generateManualFixPrompt,
  hasContinuityResumeArtifact,
  hasWriteRetryHint,
  latestFailedChapter,
  makeResumePlan,
  publishAdviceForWarningSummary,
  riskLevelForWarningSummary,
} from "./write-publish-export-utils.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptFile), "..", "..");
const argv = process.argv.slice(2);
const bookName = argv[0];

const DEFAULTS = {
  stopOnFail: true,
  useReviewed: true,
  maxPolish: 2,
  maxRepair: 2,
  maxContinuityFix: 1,
  maxNumericFix: 1,
};

const FINAL_STATUS = {
  ready: "READY_TO_PUBLISH",
  writeAudit: "STOPPED_BY_WRITE_AUDIT",
  continuity: "STOPPED_BY_CONTINUITY",
  quality: "STOPPED_BY_QUALITY",
  numeric: "STOPPED_BY_NUMERIC",
  sixPart: "STOPPED_BY_SIX_PART",
  drop: "STOPPED_BY_DROP",
  unknown: "UNKNOWN_ERROR",
};

function usage() {
  console.error(`Usage:
  node scripts/fanqie/write-publish-export.mjs <book> --count <n>
  node scripts/fanqie/write-publish-export.mjs <book> --from <chapter> --to <chapter>
  node scripts/fanqie/write-publish-export.mjs <book> --resume-last
  node scripts/fanqie/write-publish-export.mjs <book> --resume <reportPath>

Options:
  --count <n>
  --from <n> --to <n>
  --resume-last
  --resume <reportPath>
  --no-export
  --stop-on-fail / --no-stop-on-fail
  --use-reviewed / --no-use-reviewed
  --max-polish <n>
  --max-repair <n>
  --max-continuity-fix <n>
  --max-numeric-fix <n>
  --disable-numeric-fix
  --dry-run
  --mock-run`);
}

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

function boolOpt(name, fallback) {
  if (hasFlag(name)) return true;
  if (hasFlag(`no-${name}`)) return false;
  return fallback;
}

function intOpt(name, fallback) {
  const raw = getArg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

function chapterPrefix(chapter) {
  return String(chapter).padStart(4, "0");
}

function rel(file) {
  return path.relative(root, file) || ".";
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const file = path.join(dir, ent.name);
    return ent.isDirectory() ? walk(file) : [file];
  });
}

function chapterNoFromFile(file) {
  const match = path.basename(file).match(/^0*(\d+)(?:[_\-. ].*)?\.(md|txt)$/i);
  return match ? Number(match[1]) : null;
}

function latestChapter(bookDir) {
  const chaptersDir = path.join(bookDir, "chapters");
  const chapters = walk(chaptersDir)
    .map(chapterNoFromFile)
    .filter((n) => Number.isInteger(n));
  return chapters.length ? Math.max(...chapters) : 0;
}

function findChapterFile(bookDir, chapter) {
  const chaptersDir = path.join(bookDir, "chapters");
  return walk(chaptersDir)
    .filter((file) => chapterNoFromFile(file) === chapter)
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))[0] || null;
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { parse_error: String(error) };
  }
}

function stdoutSummary(text, limit = 1600) {
  const compact = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-24)
    .join("\n");
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

const WRITE_AUDIT_SIGNALS = [
  "audit-failed",
  "payoff-missing",
  "ending-type-mismatch",
  "mood-cadence-violation",
  "scene-semantic-failure",
  "State update skipped",
  "did not create a chapter file",
];

const WRITE_AUDIT_REASON_CODES = [
  "payoff-missing",
  "ending-type-mismatch",
  "mood-cadence-violation",
  "scene-semantic-failure",
];

function hasWriteAuditFailureSignal(text) {
  return WRITE_AUDIT_SIGNALS.some((signal) => text.includes(signal));
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractWriteAuditFailure(chapter, text) {
  const reasons = uniq(WRITE_AUDIT_REASON_CODES.filter((reason) => text.includes(reason)));
  const promisedPayoff = text.match(/payoff-missing:[^\n]*?[:：]\s*([^。\n]+)(?:。|\n|$)/u)?.[1]?.trim() || "";
  const expectedEndingType = text.match(/endingType[:：]\s*([A-Za-z0-9_-]+)/u)?.[1]?.trim() || "";

  return {
    chapter: chapterPrefix(chapter),
    reasons,
    promisedPayoff,
    expectedEndingType,
    suggestedAction: "Add chapter retry hint and rerun write next.",
  };
}

function renderRetryHint(failure) {
  const payoff = failure.promisedPayoff || "promised payoff";
  const endingType = failure.expectedEndingType || "resolution_end";
  return `# Chapter ${failure.chapter} Retry Hint

本章必须是 breath / ${endingType} 章节，不是高压战斗章。

必须兑现 promised payoff：
“${payoff}”。

正文中必须明确出现：

1. 伤势为什么危险；
2. 谁出手或什么方法暂时压住伤势；
3. 暂时稳住后的具体表现；
4. 稳住之后留下的隐患或代价；
5. 主角或关键人物对这次暂稳的反应；
6. 章尾必须阶段性收束，不能再爆发新危机。

禁止：

1. 继续升级战斗；
2. 引入新敌人强压；
3. 只写“撑住了”但没有疗伤过程；
4. 章尾写成 cliffhanger；
5. 忽略“${payoff}”这个 payoff。
`;
}

function writeRetryHint(bookDir, failure) {
  const dir = path.join(bookDir, "reviews", "write-retry-hints");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${failure.chapter}.md`);
  fs.writeFileSync(file, renderRetryHint(failure), "utf8");
  return file;
}

function commandToString(command, args) {
  return [command, ...args.map((arg) => /\s/u.test(arg) ? JSON.stringify(arg) : arg)].join(" ");
}

async function runStep(chapterRun, name, command, args, options = {}) {
  const commandText = commandToString(command, args);
  const step = {
    name,
    command: commandText,
    cwd: rel(options.cwd || root),
    startedAt: new Date().toISOString(),
  };

  if (options.dryRun) {
    step.exitCode = 0;
    step.stdout = `[dry-run] ${commandText}`;
    step.stderr = "";
    step.summary = step.stdout;
    step.finishedAt = new Date().toISOString();
    chapterRun.steps.push(step);
    console.log(`[dry-run] ${commandText}`);
    return step;
  }

  console.log(`[${name}] ${commandText}`);
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      process.stderr.write(`${error.message}\n`);
    });
    child.on("close", (code) => {
      resolve({ status: typeof code === "number" ? code : 1, stdout, stderr });
    });
  });

  step.exitCode = typeof result.status === "number" ? result.status : 1;
  step.stdout = result.stdout || "";
  step.stderr = result.stderr || "";
  step.summary = stdoutSummary(`${step.stdout}\n${step.stderr}`);
  step.finishedAt = new Date().toISOString();
  chapterRun.steps.push(step);
  return step;
}

function publishReportPath(bookDir, chapter) {
  return path.join(bookDir, "reviews", "publish-ready", `${chapterPrefix(chapter)}.publish-report.json`);
}

function readPublishReady(bookDir, chapter, step) {
  const file = publishReportPath(bookDir, chapter);
  const json = readJsonIfExists(file);
  if (json && !json.parse_error) return { source: rel(file), report: json };

  const stdout = `${step?.stdout || ""}\n${step?.stderr || ""}`;
  const statusMatch = stdout.match(/(?:result:|publish_status["':\s]+)\s*([A-Z_]+)/u);
  if (statusMatch) {
    return {
      source: "stdout",
      report: {
        publish_status: statusMatch[1],
        stdout_status: statusMatch[1],
      },
    };
  }

  return {
    source: json?.parse_error ? rel(file) : "none",
    report: json?.parse_error ? { publish_status: "UNKNOWN", parse_error: json.parse_error } : { publish_status: "UNKNOWN" },
  };
}

function reportCorpus(report, step) {
  return `${JSON.stringify(report || {})}\n${step?.stdout || ""}\n${step?.stderr || ""}`;
}

function stepText(step) {
  return `${step?.stdout || ""}\n${step?.stderr || ""}`;
}

function continuityAutoPassed(step) {
  const text = stepText(step);
  return /(?:^|\n)\s*result:\s*PASS\b/iu.test(text)
    || /(?:^|\n)\s*Ch\.\d+:\s*final=PASS\b/iu.test(text)
    || /(?:final_status|finalStatus)["':\s]+PASS\b/iu.test(text);
}

function publishReadyArgs(cli, bookName, chapter, opts, continuityOverridePass = false) {
  const args = [
    cli,
    "review",
    "publish-ready",
    "--book",
    bookName,
    "--chapter",
    String(chapter),
    "--max-fix-attempts",
    "0",
    "--max-polish-attempts",
    String(Math.max(1, opts.maxPolish)),
    "--max-quality-fix-attempts",
    "0",
  ];
  if (continuityOverridePass) args.push("--continuity-override-pass");
  return args;
}

function classifyPublishReady(report, step) {
  const status = String(report?.publish_status || report?.status || report?.stdout_status || "UNKNOWN").toUpperCase();
  const corpus = reportCorpus(report, step);
  const lower = corpus.toLowerCase();

  if (status === "READY_TO_EXPORT" || status === "READY_WITH_WARNINGS" || status === "PASS") return { kind: "pass", status };
  if (/DROP/u.test(corpus) || status.includes("DROP")) return { kind: "drop", status };

  if (/SIX_PART_FAIL|六段|6段|hook|payoff|pull|钩子|回收|追读|承压|反转/iu.test(corpus)) {
    return { kind: "sixPart", status };
  }

  const continuityStatus = String(report?.continuity?.final_status || report?.continuity?.status || "").toUpperCase();
  if (
    status.includes("CONTINUITY")
    || continuityStatus && continuityStatus !== "PASS"
    || /blocked_by_continuity|manual_review|continuity|连贯|连续性|断链/iu.test(lower)
  ) {
    return { kind: "continuity", status };
  }

  const qualityDecision = String(report?.quality_decision || "").toUpperCase();
  const qualityStatus = String(report?.quality?.final_quality_status || "").toUpperCase();
  if (
    qualityDecision === "NEED_REWRITE"
    || qualityStatus.includes("MANUAL")
    || status.includes("QUALITY")
    || /style|fanqie|title|paragraph|quality|番茄|标题|段落|网文|爽点|节奏/iu.test(corpus)
  ) {
    return { kind: "quality", status };
  }

  return { kind: "unknown", status };
}

function parseNumeric(step) {
  const text = `${step?.stdout || ""}\n${step?.stderr || ""}`;
  const match = text.match(/hits:\s*A=(\d+)\s+B=(\d+)\s+C=(\d+)/iu)
    || text.match(/命中统计：A=(\d+)，B=(\d+)，C=(\d+)/u);
  if (!match) return { A: null, B: null, C: null };
  return { A: Number(match[1]), B: Number(match[2]), C: Number(match[3]) };
}

function parseNumericFix(step) {
  const text = `${step?.stdout || ""}\n${step?.stderr || ""}`;
  const fixedFile = text.match(/\d{4}:\s+\w+\s+changes=\d+/u) ? "" : "";
  const reportFile = text.match(/report:\s+(.+?\.numeric-fix-report\.json)/u)?.[1]?.trim() || "";
  return { fixedFile, reportFile };
}

function findExportFiles(bookName, from, to, startedAtMs) {
  const outDir = path.join(root, "publish", bookName, "fanqie");
  return walk(outDir)
    .filter((file) => {
      if (!fs.existsSync(file)) return false;
      const stat = fs.statSync(file);
      if (stat.mtimeMs + 1000 < startedAtMs) return false;
      const base = path.basename(file);
      if (/\.(md|txt)$/i.test(base)) return true;
      return base.includes(chapterPrefix(from)) || base.includes(chapterPrefix(to));
    })
    .map(rel)
    .sort();
}

function renderMarkdown(report) {
  const lines = [
    "# Write Publish Export Report",
    "",
    `- book: ${report.book}`,
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt}`,
    `- requested count: ${report.request.count ?? "n/a"}`,
    `- requested from/to: ${report.request.from ?? "n/a"}-${report.request.to ?? "n/a"}`,
    `- processed chapters: ${report.processedChapters.length ? report.processedChapters.map(chapterPrefix).join(", ") : "none"}`,
    `- finalStatus: ${report.finalStatus}`,
    `- exported: ${report.exported ? "true" : "false"}`,
    "",
  ];

  lines.push("## Warning Summary");
  lines.push("");
  for (const level of ["P0", "P1", "P2"]) {
    const warnings = report.warningSummary?.[level] || [];
    lines.push(`### ${level}`);
    lines.push("");
    if (!warnings.length) {
      lines.push("- none");
    } else {
      for (const warning of warnings) {
        lines.push(`- ${warning.chapter ? `${warning.chapter}: ` : ""}${warning.code} - ${warning.message}`);
      }
    }
    lines.push("");
  }

  lines.push("## Risk Level");
  lines.push("");
  lines.push(report.riskLevel || "LOW");
  lines.push("");

  lines.push("## Publish Advice");
  lines.push("");
  lines.push(report.publishAdvice || "CAN_PUBLISH");
  lines.push("");

  lines.push("## Resume Info");
  lines.push("");
  lines.push(`- enabled: ${report.resume?.enabled ? "true" : "false"}`);
  lines.push(`- sourceReport: ${report.resume?.sourceReport || "n/a"}`);
  lines.push(`- resumedFromChapter: ${report.resume?.resumedFromChapter || "n/a"}`);
  lines.push(`- remainingCount: ${report.resume?.remainingCount ?? 0}`);
  lines.push("");

  lines.push("## Manual Fix Prompt");
  lines.push("");
  lines.push(`- generated: ${report.manualFixPrompt?.generated ? "true" : "false"}`);
  lines.push(`- path: ${report.manualFixPrompt?.path || "n/a"}`);
  lines.push("");

  if (report.writeAuditFailure) {
    lines.push("## Write Audit Failure");
    lines.push("");
    lines.push(`- chapter: ${report.writeAuditFailure.chapter}`);
    lines.push(`- reasons: ${report.writeAuditFailure.reasons.length ? report.writeAuditFailure.reasons.join(", ") : "n/a"}`);
    lines.push(`- promisedPayoff: ${report.writeAuditFailure.promisedPayoff || "n/a"}`);
    lines.push(`- expectedEndingType: ${report.writeAuditFailure.expectedEndingType || "n/a"}`);
    lines.push(`- suggestedAction: ${report.writeAuditFailure.suggestedAction}`);
    lines.push(`- retryHint: ${report.writeAuditFailure.retryHintPath || "n/a"}`);
    lines.push("");
  }

  lines.push("## Chapters");
  lines.push("");

  for (const chapter of report.chapters) {
    lines.push(`### ${chapterPrefix(chapter.chapter)}`);
    lines.push("");
    lines.push(`- finalStatus: ${chapter.finalStatus}`);
    lines.push(`- publish-ready final: ${chapter.publishReadyFinalStatus || "UNKNOWN"}`);
    lines.push(`- numeric: A=${chapter.numeric?.A ?? "n/a"} B=${chapter.numeric?.B ?? "n/a"} C=${chapter.numeric?.C ?? "n/a"}`);
    lines.push(`- continuity-auto: ${chapter.didContinuityAuto ? "true" : "false"}`);
    if (chapter.continuityOverride) lines.push(`- continuityOverride: ${chapter.continuityOverride}`);
    if (chapter.continuityOverrideReason) lines.push(`- continuityOverrideReason: ${chapter.continuityOverrideReason}`);
    lines.push(`- fanqie-polish: ${chapter.didFanqiePolish ? "true" : "false"}`);
    lines.push(`- repair-fanqie: ${chapter.didRepairFanqie ? "true" : "false"}`);
    if (chapter.writeAuditFailure) {
      lines.push(`- writeAuditFailure reasons: ${chapter.writeAuditFailure.reasons.length ? chapter.writeAuditFailure.reasons.join(", ") : "n/a"}`);
      lines.push(`- promisedPayoff: ${chapter.writeAuditFailure.promisedPayoff || "n/a"}`);
      lines.push(`- expectedEndingType: ${chapter.writeAuditFailure.expectedEndingType || "n/a"}`);
      lines.push(`- retryHint: ${chapter.writeAuditFailure.retryHintPath || "n/a"}`);
    }
    lines.push("");
    lines.push("| Step | Exit | Command | Summary |");
    lines.push("| --- | ---: | --- | --- |");
    for (const step of chapter.steps) {
      lines.push(`| ${step.name} | ${step.exitCode} | \`${step.command.replaceAll("|", "\\|")}\` | ${String(step.summary || "").replaceAll("\n", "<br>").replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }

  if (report.exportStep) {
    lines.push("## Export");
    lines.push("");
    lines.push(`- exitCode: ${report.exportStep.exitCode}`);
    lines.push(`- command: \`${report.exportStep.command}\``);
    lines.push(`- files: ${report.exportFiles.length ? report.exportFiles.join(", ") : "n/a"}`);
    lines.push("");
  }

  lines.push("## Numeric Fix");
  lines.push("");
  const numericFixes = report.chapters.flatMap((chapter) => chapter.numericFix ? [{ chapter: chapter.chapter, ...chapter.numericFix }] : []);
  if (!numericFixes.length) {
    lines.push("- none");
  } else {
    lines.push("| Chapter | Attempted | Attempts | Before | After | Result | Fixed File | Backup File | Report |");
    lines.push("| --- | --- | ---: | --- | --- | --- | --- | --- | --- |");
    for (const fix of numericFixes) {
      const before = fix.before ? `A=${fix.before.A ?? "n/a"} B=${fix.before.B ?? "n/a"} C=${fix.before.C ?? "n/a"}` : "n/a";
      const after = fix.after ? `A=${fix.after.A ?? "n/a"} B=${fix.after.B ?? "n/a"} C=${fix.after.C ?? "n/a"}` : "n/a";
      lines.push(`| ${chapterPrefix(fix.chapter)} | ${fix.attempted ? "true" : "false"} | ${fix.attempts ?? 0} | ${before} | ${after} | ${fix.result || "SKIPPED"} | ${fix.fixedFile || "n/a"} | ${fix.backupFile || "n/a"} | ${fix.reportFile || "n/a"} |`);
    }
  }
  lines.push("");

  lines.push("## Auto Fix Suggestions");
  lines.push("");
  if (!report.autoFixSuggestions?.length) {
    lines.push("- none");
  } else {
    for (const item of report.autoFixSuggestions) {
      lines.push(`- ${item.priority} ${item.type}${item.chapter ? ` ${item.chapter}` : ""}: ${item.suggestedCommand || item.suggestedAction || "n/a"}`);
    }
  }
  lines.push("");

  if (report.stopReason) {
    lines.push("## Stop Reason");
    lines.push("");
    lines.push(report.stopReason);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function parseOptions() {
  if (!bookName || hasFlag("help") || hasFlag("h")) {
    usage();
    process.exit(bookName ? 0 : 1);
  }

  const countRaw = getArg("count");
  const fromRaw = getArg("from");
  const toRaw = getArg("to");
  const resumeLast = hasFlag("resume-last");
  const resumePath = getArg("resume");
  const count = countRaw === undefined ? undefined : Number(countRaw);
  const from = fromRaw === undefined ? undefined : Number(fromRaw);
  const to = toRaw === undefined ? undefined : Number(toRaw);
  const resumeEnabled = resumeLast || resumePath !== undefined;

  if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
    throw new Error("--count must be a positive integer");
  }
  if (from !== undefined && (!Number.isInteger(from) || from < 1)) {
    throw new Error("--from must be a positive integer");
  }
  if (to !== undefined && (!Number.isInteger(to) || to < 1)) {
    throw new Error("--to must be a positive integer");
  }
  if (resumeLast && resumePath !== undefined) {
    throw new Error("--resume-last cannot be combined with --resume");
  }
  if (resumeEnabled && (count !== undefined || from !== undefined || to !== undefined)) {
    throw new Error("--resume/--resume-last cannot be combined with --count or --from/--to");
  }
  if (!resumeEnabled && count === undefined && (from === undefined || to === undefined)) {
    throw new Error("Use either --count <n> or --from <n> --to <n>");
  }
  if (count !== undefined && (from !== undefined || to !== undefined)) {
    throw new Error("--count cannot be combined with --from/--to");
  }
  if (from !== undefined && to !== undefined && to < from) {
    throw new Error("--to must be greater than or equal to --from");
  }

  return {
    count,
    from,
    to,
    resumeLast,
    resumePath,
    noExport: hasFlag("no-export"),
    stopOnFail: boolOpt("stop-on-fail", DEFAULTS.stopOnFail),
    useReviewed: boolOpt("use-reviewed", DEFAULTS.useReviewed),
    maxPolish: intOpt("max-polish", DEFAULTS.maxPolish),
    maxRepair: intOpt("max-repair", DEFAULTS.maxRepair),
    maxContinuityFix: intOpt("max-continuity-fix", DEFAULTS.maxContinuityFix),
    maxNumericFix: intOpt("max-numeric-fix", DEFAULTS.maxNumericFix),
    disableNumericFix: hasFlag("disable-numeric-fix"),
    dryRun: hasFlag("dry-run") || hasFlag("mock-run"),
    mockRun: hasFlag("mock-run"),
  };
}

function ensureBookDir(bookDir, dryRun) {
  if (!fs.existsSync(bookDir)) {
    if (dryRun) fs.mkdirSync(path.join(bookDir, "reviews", "write-publish-export"), { recursive: true });
    else throw new Error(`Cannot find book directory: ${rel(bookDir)}`);
  }
}

function makeChapterRun(chapter) {
  return {
    chapter,
    steps: [],
    publishReadyFinalStatus: "UNKNOWN",
    numeric: null,
    didContinuityAuto: false,
    continuityOverride: null,
    continuityOverrideReason: "",
    didFanqiePolish: false,
    didRepairFanqie: false,
    writeAuditFailure: null,
    numericFix: {
      attempted: false,
      attempts: 0,
      before: null,
      after: null,
      fixedFile: "",
      backupFile: "",
      reportFile: "",
      result: "SKIPPED",
    },
    exported: false,
    finalStatus: "UNKNOWN_ERROR",
  };
}

async function main() {
  const opts = parseOptions();
  const myNovelDir = path.join(root, "my-novel");
  const bookDir = path.join(myNovelDir, "books", bookName);
  const reportDir = path.join(bookDir, "reviews", "write-publish-export");
  ensureBookDir(bookDir, opts.dryRun);
  fs.mkdirSync(reportDir, { recursive: true });

  let resumePlan = {
    enabled: false,
    sourceReport: "",
    resumedFromChapter: null,
    remainingCount: 0,
    queue: [],
    remainingNewCount: 0,
  };
  if (opts.resumeLast || opts.resumePath) {
    const sourceReportPath = opts.resumeLast
      ? findLatestJsonReport(reportDir)
      : path.resolve(root, opts.resumePath);
    if (!sourceReportPath) throw new Error(`No write-publish-export JSON report found under ${rel(reportDir)}`);
    const sourceReport = readJsonIfExists(sourceReportPath);
    if (!sourceReport || sourceReport.parse_error) {
      throw new Error(`Cannot read resume report: ${rel(sourceReportPath)}`);
    }
    resumePlan = makeResumePlan({ sourceReportPath: rel(sourceReportPath), sourceReport, bookDir });
    if (resumePlan.noResumeNeeded) {
      console.log("[write-publish-export]");
      console.log(`resume source: ${resumePlan.sourceReport}`);
      console.log("Latest report is already READY_TO_PUBLISH. Nothing to resume.");
      process.exit(0);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const startedAtMs = Date.now();
  const report = {
    book: bookName,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: "",
    request: {
      count: opts.count,
      from: opts.from,
      to: opts.to,
      noExport: opts.noExport,
      stopOnFail: opts.stopOnFail,
      useReviewed: opts.useReviewed,
      maxPolish: opts.maxPolish,
      maxRepair: opts.maxRepair,
      maxContinuityFix: opts.maxContinuityFix,
      maxNumericFix: opts.maxNumericFix,
      disableNumericFix: opts.disableNumericFix,
      dryRun: opts.dryRun,
    },
    processedChapters: [],
    chapters: [],
    exported: false,
    exportFiles: [],
    exportStep: null,
    finalStatus: FINAL_STATUS.unknown,
    stopReason: "",
    writeAuditFailure: null,
    resume: {
      enabled: resumePlan.enabled,
      sourceReport: resumePlan.sourceReport || "",
      resumedFromChapter: resumePlan.resumedFromChapter,
      remainingCount: resumePlan.remainingCount,
    },
    warningSummary: { P0: [], P1: [], P2: [] },
    riskLevel: "LOW",
    publishAdvice: "CAN_PUBLISH",
    manualFixPrompt: {
      generated: false,
      path: "",
    },
    autoFixSuggestions: [],
  };

  const cli = path.join("..", "packages", "cli", "dist", "index.js");
  const chapterQueue = [];
  if (resumePlan.enabled) {
    chapterQueue.push(...resumePlan.queue);
  } else if (opts.from !== undefined && opts.to !== undefined) {
    for (let chapter = opts.from; chapter <= opts.to; chapter += 1) chapterQueue.push(chapter);
  }

  let hardStop = false;
  const targetIterations = resumePlan.enabled
    ? chapterQueue.length + resumePlan.remainingNewCount
    : opts.count ?? chapterQueue.length;

  for (let i = 0; i < targetIterations; i += 1) {
    const queued = chapterQueue[i];
    let chapter = typeof queued === "object" ? queued.chapter : queued;
    const resumeKind = typeof queued === "object" ? queued.resumeKind : "normal";
    const sourceChapter = typeof queued === "object" ? queued.sourceChapter : null;
    let chapterRun = makeChapterRun(chapter ?? 0);

    if (resumeKind === "unknown" || resumeKind === "drop") {
      chapterRun.finalStatus = resumeKind === "numeric"
        ? FINAL_STATUS.numeric
        : resumeKind === "drop"
          ? FINAL_STATUS.drop
          : FINAL_STATUS.unknown;
      report.stopReason = `Resume cannot automatically continue chapter ${chapterPrefix(chapter)} from ${sourceChapter?.finalStatus || "UNKNOWN_ERROR"}. Manual repair is required.`;
      report.chapters.push(chapterRun);
      hardStop = true;
      break;
    }

    if (resumeKind === "writeAudit") {
      const requestedChapter = chapter;
      if (!hasWriteRetryHint(bookDir, chapter)) {
        const failure = sourceChapter?.writeAuditFailure || report.writeAuditFailure || {
          chapter: chapterPrefix(chapter),
          reasons: [],
          promisedPayoff: "",
          expectedEndingType: "",
          suggestedAction: "Add chapter retry hint and rerun write next.",
        };
        const retryHintFile = writeRetryHint(bookDir, failure);
        failure.retryHintPath = rel(retryHintFile);
        chapterRun.writeAuditFailure = failure;
        report.writeAuditFailure = failure;
        chapterRun.finalStatus = FINAL_STATUS.writeAudit;
        report.stopReason = `write retry hint was missing for chapter ${chapterPrefix(chapter)}. Generated retry hint and manual fix prompt before stopping.`;
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }

      const before = latestChapter(bookDir);
      const writeStep = await runStep(chapterRun, "write-next-resume", "node", [cli, "write", "next", bookName], {
        cwd: myNovelDir,
        dryRun: opts.dryRun,
      });
      if (writeStep.exitCode !== 0) {
        chapterRun.finalStatus = FINAL_STATUS.unknown;
        report.stopReason = `resume write next failed for chapter ${chapterPrefix(chapter)}`;
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }
      const after = opts.dryRun ? Math.max(before + 1, chapter) : latestChapter(bookDir);
      chapterRun.chapter = requestedChapter;
      if (!opts.dryRun && (after !== requestedChapter || !findChapterFile(bookDir, requestedChapter))) {
        chapterRun.finalStatus = FINAL_STATUS.writeAudit;
        report.stopReason = `resume write next did not create chapter file ${chapterPrefix(requestedChapter)}.`;
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }
      chapter = requestedChapter;
    } else if (opts.count !== undefined || (resumePlan.enabled && i >= chapterQueue.length)) {
      const before = latestChapter(bookDir);
      const writeStep = await runStep(chapterRun, "write-next", "node", [cli, "write", "next", bookName], {
        cwd: myNovelDir,
        dryRun: opts.dryRun,
      });
      if (writeStep.exitCode !== 0) {
        chapterRun.chapter = before + 1;
        chapterRun.finalStatus = FINAL_STATUS.unknown;
        report.stopReason = `write next failed before chapter ${before + 1}`;
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }
      const after = opts.dryRun ? before + 1 : latestChapter(bookDir);
      chapter = after > before ? after : before + 1;
      chapterRun.chapter = chapter;

      if (!opts.dryRun && !findChapterFile(bookDir, chapter)) {
        const writeOutput = `${writeStep.stdout}\n${writeStep.stderr}`;
        if (after <= before && hasWriteAuditFailureSignal(writeOutput)) {
          const failure = extractWriteAuditFailure(chapter, writeOutput);
          const retryHintFile = writeRetryHint(bookDir, failure);
          failure.retryHintPath = rel(retryHintFile);
          chapterRun.writeAuditFailure = failure;
          report.writeAuditFailure = failure;
          chapterRun.finalStatus = FINAL_STATUS.writeAudit;
          report.stopReason = `write next produced write-audit failure for chapter ${chapterPrefix(chapter)}. No chapter file was created. Retry hint generated at ${failure.retryHintPath}.`;
        } else {
          chapterRun.finalStatus = FINAL_STATUS.unknown;
          report.stopReason = `write next did not create chapter file ${chapterPrefix(chapter)}.`;
        }
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }
    }

    report.processedChapters.push(chapter);
    console.log(`\n[chapter ${chapterPrefix(chapter)}] start`);

    let continuityOverridePass = false;
    if (resumeKind === "continuity" && !hasContinuityResumeArtifact(bookDir, chapter)) {
      chapterRun.didContinuityAuto = true;
      const fixStep = await runStep(chapterRun, "continuity-auto-resume", "node", [
        cli,
        "review",
        "continuity-auto",
        "--book",
        bookName,
        "--chapter",
        String(chapter),
        "--max-fix-attempts",
        String(opts.maxContinuityFix),
      ], { cwd: myNovelDir, dryRun: opts.dryRun });
      if (fixStep.exitCode !== 0 || (!opts.dryRun && !continuityAutoPassed(fixStep))) {
        chapterRun.finalStatus = FINAL_STATUS.continuity;
        report.stopReason = `resume continuity-auto failed for chapter ${chapterPrefix(chapter)}`;
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }
      continuityOverridePass = true;
      chapterRun.continuityOverride = "PASS";
      chapterRun.continuityOverrideReason = "continuity-auto returned PASS";
    } else if (resumeKind === "quality") {
      chapterRun.didFanqiePolish = true;
      const polishStep = await runStep(chapterRun, "fanqie-polish-resume", "node", [
        cli,
        "review",
        "fanqie-polish",
        "--book",
        bookName,
        "--chapter",
        String(chapter),
        "--max-polish-attempts",
        String(opts.maxPolish),
      ], { cwd: myNovelDir, dryRun: opts.dryRun });
      if (polishStep.exitCode !== 0) {
        chapterRun.finalStatus = FINAL_STATUS.quality;
        report.stopReason = `resume fanqie-polish failed for chapter ${chapterPrefix(chapter)}`;
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }
    } else if (resumeKind === "sixPart") {
      chapterRun.didRepairFanqie = true;
      const repairStep = await runStep(chapterRun, "repair-fanqie-resume", "node", [
        path.join("scripts", "fanqie", "repair-fanqie.mjs"),
        bookName,
        "--chapter",
        String(chapter),
        "--apply",
      ], { cwd: root, dryRun: opts.dryRun });
      if (repairStep.exitCode !== 0) {
        chapterRun.finalStatus = FINAL_STATUS.sixPart;
        report.stopReason = `resume repair-fanqie failed for chapter ${chapterPrefix(chapter)}`;
        report.chapters.push(chapterRun);
        hardStop = true;
        break;
      }
    }

    let publishStep = await runStep(
      chapterRun,
      "publish-ready",
      "node",
      publishReadyArgs(cli, bookName, chapter, opts, continuityOverridePass),
      { cwd: myNovelDir, dryRun: opts.dryRun },
    );

    let publish = opts.dryRun
      ? { source: "dry-run", report: { publish_status: "READY_TO_EXPORT" } }
      : readPublishReady(bookDir, chapter, publishStep);
    let classification = classifyPublishReady(publish.report, publishStep);
    let continuityFixes = 0;
    let polishFixes = 0;
    let repairs = 0;

    while (classification.kind !== "pass") {
      if (classification.kind === "drop") {
        chapterRun.publishReadyFinalStatus = classification.status;
        chapterRun.finalStatus = FINAL_STATUS.drop;
        report.stopReason = `Chapter ${chapterPrefix(chapter)} is DROP. Manual repair is required before continuing.`;
        hardStop = true;
        break;
      }

      if (classification.kind === "continuity" && continuityFixes < opts.maxContinuityFix) {
        continuityFixes += 1;
        chapterRun.didContinuityAuto = true;
        const fixStep = await runStep(chapterRun, "continuity-auto", "node", [
          cli,
          "review",
          "continuity-auto",
          "--book",
          bookName,
          "--chapter",
          String(chapter),
          "--max-fix-attempts",
          String(opts.maxContinuityFix),
        ], { cwd: myNovelDir, dryRun: opts.dryRun });
        if (fixStep.exitCode !== 0) {
          chapterRun.finalStatus = FINAL_STATUS.continuity;
          report.stopReason = `continuity-auto failed for chapter ${chapterPrefix(chapter)}`;
          hardStop = true;
          break;
        }
        if (!opts.dryRun && !continuityAutoPassed(fixStep)) {
          chapterRun.finalStatus = FINAL_STATUS.continuity;
          report.stopReason = `continuity-auto did not return PASS for chapter ${chapterPrefix(chapter)}.`;
          hardStop = true;
          break;
        }
        continuityOverridePass = true;
        chapterRun.continuityOverride = "PASS";
        chapterRun.continuityOverrideReason = "continuity-auto returned PASS";
      } else if (classification.kind === "sixPart" && repairs < opts.maxRepair) {
        repairs += 1;
        chapterRun.didRepairFanqie = true;
        const repairStep = await runStep(chapterRun, "repair-fanqie", "node", [
          path.join("scripts", "fanqie", "repair-fanqie.mjs"),
          bookName,
          "--chapter",
          String(chapter),
          "--apply",
        ], { cwd: root, dryRun: opts.dryRun });
        if (repairStep.exitCode !== 0) {
          chapterRun.finalStatus = FINAL_STATUS.sixPart;
          report.stopReason = `repair-fanqie failed for chapter ${chapterPrefix(chapter)}`;
          hardStop = true;
          break;
        }
      } else if (classification.kind === "quality" && polishFixes < opts.maxPolish) {
        polishFixes += 1;
        chapterRun.didFanqiePolish = true;
        const polishStep = await runStep(chapterRun, "fanqie-polish", "node", [
          cli,
          "review",
          "fanqie-polish",
          "--book",
          bookName,
          "--chapter",
          String(chapter),
          "--max-polish-attempts",
          String(opts.maxPolish),
        ], { cwd: myNovelDir, dryRun: opts.dryRun });
        if (polishStep.exitCode !== 0) {
          chapterRun.finalStatus = FINAL_STATUS.quality;
          report.stopReason = `fanqie-polish failed for chapter ${chapterPrefix(chapter)}`;
          hardStop = true;
          break;
        }
      } else {
        chapterRun.publishReadyFinalStatus = classification.status;
        chapterRun.finalStatus = classification.kind === "continuity"
          ? FINAL_STATUS.continuity
          : classification.kind === "sixPart"
            ? FINAL_STATUS.sixPart
            : classification.kind === "quality"
              ? FINAL_STATUS.quality
              : FINAL_STATUS.unknown;
        report.stopReason = `Chapter ${chapterPrefix(chapter)} stopped at publish-ready status ${classification.status}.`;
        hardStop = true;
        break;
      }

      publishStep = await runStep(
        chapterRun,
        "publish-ready-recheck",
        "node",
        publishReadyArgs(cli, bookName, chapter, opts, continuityOverridePass),
        { cwd: myNovelDir, dryRun: opts.dryRun },
      );
      publish = opts.dryRun
        ? { source: "dry-run", report: { publish_status: "READY_TO_EXPORT" } }
        : readPublishReady(bookDir, chapter, publishStep);
      classification = classifyPublishReady(publish.report, publishStep);
      chapterRun.publishReadyFinalStatus = classification.status;
    }

    if (hardStop) {
      report.chapters.push(chapterRun);
      if (opts.stopOnFail) break;
      continue;
    }

    chapterRun.publishReadyFinalStatus = classification.status;
    const numericStep = await runStep(chapterRun, "numeric-final-only", "node", [
      path.join("scripts", "fanqie", "check-numeric-expression.mjs"),
      bookName,
      "--chapter",
      String(chapter),
      "--final-only",
    ], { cwd: root, dryRun: opts.dryRun });
    const numeric = opts.dryRun ? { A: 0, B: 0, C: 0 } : parseNumeric(numericStep);
    chapterRun.numeric = numeric;

    if (numericStep.exitCode !== 0 || numeric.A === null) {
      chapterRun.finalStatus = FINAL_STATUS.numeric;
      report.stopReason = `numeric final-only status is unknown for chapter ${chapterPrefix(chapter)}`;
      hardStop = true;
    } else if (numeric.A > 0) {
      chapterRun.numericFix.before = numeric;
      const maxNumericFix = opts.disableNumericFix ? 0 : opts.maxNumericFix;
      if (maxNumericFix > 0) {
        for (let attempt = 1; attempt <= maxNumericFix; attempt += 1) {
          chapterRun.numericFix.attempted = true;
          chapterRun.numericFix.attempts = attempt;
          const fixStep = await runStep(chapterRun, "fix-numeric-expression", "node", [
            path.join("scripts", "fanqie", "fix-numeric-expression.mjs"),
            bookName,
            "--chapter",
            String(chapter),
            "--final-only",
          ], { cwd: root, dryRun: opts.dryRun });
          chapterRun.numericFix.fixedFile = rel(path.join(bookDir, "chapters-reviewed", `${chapterPrefix(chapter)}_final.md`));
          chapterRun.numericFix.backupFile = rel(path.join(bookDir, "chapters-reviewed", `${chapterPrefix(chapter)}_final.numeric-backup.md`));
          chapterRun.numericFix.reportFile = parseNumericFix(fixStep).reportFile;
          if (fixStep.exitCode !== 0) break;

          const recheckStep = await runStep(chapterRun, "numeric-final-only-recheck", "node", [
            path.join("scripts", "fanqie", "check-numeric-expression.mjs"),
            bookName,
            "--chapter",
            String(chapter),
            "--final-only",
          ], { cwd: root, dryRun: opts.dryRun });
          const recheckNumeric = opts.dryRun ? { A: 0, B: 0, C: 0 } : parseNumeric(recheckStep);
          chapterRun.numeric = recheckNumeric;
          chapterRun.numericFix.after = recheckNumeric;
          if (recheckStep.exitCode === 0 && recheckNumeric.A === 0) {
            chapterRun.numericFix.result = "PASS";
            chapterRun.finalStatus = FINAL_STATUS.ready;
            hardStop = false;
            break;
          }
        }
      }

      if (chapterRun.finalStatus !== FINAL_STATUS.ready) {
        chapterRun.numericFix.result = chapterRun.numericFix.attempted ? "STILL_BLOCKED" : "SKIPPED";
        chapterRun.finalStatus = FINAL_STATUS.numeric;
        report.stopReason = `numeric final-only A=${chapterRun.numeric?.A ?? numeric.A} for chapter ${chapterPrefix(chapter)}. Export blocked.`;
        hardStop = true;
      }
    } else {
      chapterRun.finalStatus = FINAL_STATUS.ready;
    }

    report.chapters.push(chapterRun);
    if (hardStop && opts.stopOnFail) break;
  }

  const allReady = report.chapters.length > 0
    && report.chapters.every((chapter) => chapter.finalStatus === FINAL_STATUS.ready);
  report.finalStatus = hardStop
    ? (report.chapters.find((chapter) => chapter.finalStatus !== FINAL_STATUS.ready)?.finalStatus || FINAL_STATUS.unknown)
    : allReady
      ? FINAL_STATUS.ready
      : FINAL_STATUS.unknown;

  if (allReady && !opts.noExport) {
    const from = Math.min(...report.processedChapters);
    const to = Math.max(...report.processedChapters);
    const exportArgs = [
      path.join("scripts", "fanqie", "export-fanqie.mjs"),
      bookName,
      "--from",
      String(from),
      "--to",
      String(to),
    ];
    if (opts.useReviewed) exportArgs.push("--use-reviewed");

    const exportHolder = { steps: [] };
    const exportStep = await runStep(exportHolder, "export-fanqie", "node", exportArgs, {
      cwd: root,
      dryRun: opts.dryRun,
    });
    report.exportStep = exportStep;
    report.exported = exportStep.exitCode === 0;
    report.exportFiles = opts.dryRun ? [] : findExportFiles(bookName, from, to, startedAtMs);
    for (const chapter of report.chapters) chapter.exported = report.exported;
    if (exportStep.exitCode !== 0) {
      report.finalStatus = FINAL_STATUS.unknown;
      report.stopReason = `export-fanqie failed for ${chapterPrefix(from)}-${chapterPrefix(to)}`;
    }
  }

  const failedChapter = latestFailedChapter(report);
  if (failedChapter) {
    report.manualFixPrompt = generateManualFixPrompt({
      root,
      bookDir,
      bookName,
      chapterRun: failedChapter,
      report,
    });
  }

  report.warningSummary = buildWarningSummary(report, { bookDir });
  report.riskLevel = riskLevelForWarningSummary(report.warningSummary);
  report.publishAdvice = publishAdviceForWarningSummary(report.warningSummary);
  report.autoFixSuggestions = buildAutoFixSuggestions(report, bookName);
  if (report.finalStatus === FINAL_STATUS.ready && report.warningSummary.P0.length > 0) {
    report.finalStatus = FINAL_STATUS.unknown;
    report.stopReason = report.stopReason || "P0 warning blocks publish.";
  }

  report.finishedAt = new Date().toISOString();
  const jsonPath = path.join(reportDir, `${timestamp}.json`);
  const mdPath = path.join(reportDir, `${timestamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(report), "utf8");

  console.log("");
  console.log("[write-publish-export]");
  console.log(`finalStatus: ${report.finalStatus}`);
  console.log(`report: ${rel(jsonPath)}`);
  console.log(`report: ${rel(mdPath)}`);
  if (report.stopReason) console.log(`stopReason: ${report.stopReason}`);

  process.exit(report.finalStatus === FINAL_STATUS.ready ? 0 : 1);
}

main().catch((error) => {
  console.error(`[write-publish-export] ${error.message}`);
  process.exit(1);
});
