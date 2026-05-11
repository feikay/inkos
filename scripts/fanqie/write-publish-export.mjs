#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

Options:
  --count <n>
  --from <n> --to <n>
  --no-export
  --stop-on-fail / --no-stop-on-fail
  --use-reviewed / --no-use-reviewed
  --max-polish <n>
  --max-repair <n>
  --max-continuity-fix <n>
  --max-numeric-fix <n>
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
  const count = countRaw === undefined ? undefined : Number(countRaw);
  const from = fromRaw === undefined ? undefined : Number(fromRaw);
  const to = toRaw === undefined ? undefined : Number(toRaw);

  if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
    throw new Error("--count must be a positive integer");
  }
  if (from !== undefined && (!Number.isInteger(from) || from < 1)) {
    throw new Error("--from must be a positive integer");
  }
  if (to !== undefined && (!Number.isInteger(to) || to < 1)) {
    throw new Error("--to must be a positive integer");
  }
  if (count === undefined && (from === undefined || to === undefined)) {
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
    noExport: hasFlag("no-export"),
    stopOnFail: boolOpt("stop-on-fail", DEFAULTS.stopOnFail),
    useReviewed: boolOpt("use-reviewed", DEFAULTS.useReviewed),
    maxPolish: intOpt("max-polish", DEFAULTS.maxPolish),
    maxRepair: intOpt("max-repair", DEFAULTS.maxRepair),
    maxContinuityFix: intOpt("max-continuity-fix", DEFAULTS.maxContinuityFix),
    maxNumericFix: intOpt("max-numeric-fix", DEFAULTS.maxNumericFix),
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
    didFanqiePolish: false,
    didRepairFanqie: false,
    writeAuditFailure: null,
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
  };

  const cli = path.join("..", "packages", "cli", "dist", "index.js");
  const chapterQueue = [];
  if (opts.from !== undefined && opts.to !== undefined) {
    for (let chapter = opts.from; chapter <= opts.to; chapter += 1) chapterQueue.push(chapter);
  }

  let hardStop = false;
  const targetIterations = opts.count ?? chapterQueue.length;

  for (let i = 0; i < targetIterations; i += 1) {
    let chapter = chapterQueue[i];
    let chapterRun = makeChapterRun(chapter ?? 0);

    if (opts.count !== undefined) {
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

    let publishStep = await runStep(chapterRun, "publish-ready", "node", [
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
    ], { cwd: myNovelDir, dryRun: opts.dryRun });

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

      publishStep = await runStep(chapterRun, "publish-ready-recheck", "node", [
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
      ], { cwd: myNovelDir, dryRun: opts.dryRun });
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
      chapterRun.finalStatus = FINAL_STATUS.numeric;
      report.stopReason = `numeric final-only A=${numeric.A} for chapter ${chapterPrefix(chapter)}. Numeric-fix mode is not available yet; export blocked.`;
      hardStop = true;
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
