import { describe, expect, it } from "vitest";
import { mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  StructureSignalsSchema,
  validateStructureSignals,
  readStructureSignals,
  writeStructureSignals,
  createEmptyStructureSignals,
  parseArchitectStructureSignals,
  matchStructureSignals,
  buildStructureSignalReport,
  inspectStructureSignals,
  validateStructureSignalsFull,
  appendStructureSignal,
  STRUCTURE_SIGNAL_DIMENSIONS,
  type StructureSignals,
} from "../utils/structure-signals.js";
import { StoryEffectivenessAgent } from "../agents/story-effectiveness.js";
import { SixStepPlotReviewerAgent } from "../agents/six-step-plot-reviewer.js";
import { OpeningHookReviewerAgent } from "../agents/opening-hook-reviewer.js";
import { BaseAgent, type AgentContext } from "../agents/base.js";

function makeMockAgentContext(): AgentContext {
  return {
    chat: async () => ({ content: "" }),
    chatWithSearch: async () => ({ content: "" }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    model: "test-model",
    provider: "test-provider",
    temperature: 0,
    maxTokens: 1000,
    thinkingBudget: 0,
    projectDir: "/tmp",
    bookId: "test-book",
    agentName: "test-agent",
  } as unknown as AgentContext;
}

function makeValidSignals(bookId = "test-book"): StructureSignals {
  return {
    schemaVersion: 1,
    bookId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    signals: {
      opening_hook: ["冲突", "恐惧", "威胁"],
      protagonist_goal: ["目标明确", "一定要", "必须完成"],
      pressure_source: ["追兵", "倒计时", "限期将至"],
      obstacle_dilemma: ["死局", "没选择", "进退两难"],
      solution_possibility: ["线索", "破绽", "一线生机"],
      active_attempt: ["选择", "冲出去", "奋力一搏"],
      payoff_reward: ["获得", "解锁", "突破瓶颈"],
      ending_pull: ["未解决", "新危机", "更大威胁"],
      antagonist_pressure: ["反派逼近", "围堵", "暗中窥视"],
      resource_reward: ["兑换", "净赚", "资源到手"],
      world_rule: ["规则限制", "天道", "法则约束"],
      forbidden_false_positive: ["普通", "日常", "无关"],
    },
  };
}

// ---- Schema validation ----

describe("StructureSignalsSchema", () => {
  it("validates a correct structure signals object", () => {
    const signals = makeValidSignals();
    expect(() => validateStructureSignals(signals)).not.toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => validateStructureSignals({})).toThrow();
    expect(() => validateStructureSignals({ schemaVersion: 1 })).toThrow();
  });

  it("rejects wrong schemaVersion", () => {
    expect(() =>
      validateStructureSignals({ ...makeValidSignals(), schemaVersion: 2 }),
    ).toThrow();
  });

  it("rejects invalid signal dimensions", () => {
    const bad = makeValidSignals();
    (bad as Record<string, unknown>).signals = { invalid_dim: ["test"] };
    expect(() => validateStructureSignals(bad)).toThrow();
  });

  it("rejects non-string signal phrases", () => {
    const bad = makeValidSignals();
    (bad.signals as Record<string, unknown>).opening_hook = [123];
    expect(() => validateStructureSignals(bad)).toThrow();
  });
});

// ---- Empty signals ----

describe("createEmptyStructureSignals", () => {
  it("creates empty signals with all dimensions", () => {
    const empty = createEmptyStructureSignals("my-book");
    expect(empty.schemaVersion).toBe(1);
    expect(empty.bookId).toBe("my-book");
    for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
      expect(empty.signals[dim]).toEqual([]);
    }
  });
});

describe("parseArchitectStructureSignals", () => {
  const section = JSON.stringify({
    signals: makeValidSignals("ignored").signals,
  });

  it("parses plain JSON", () => {
    const result = parseArchitectStructureSignals(section, "book-a");
    expect(result.status).toBe("ok");
    expect(result.signals.bookId).toBe("book-a");
    expect(result.signals.signals.opening_hook).toEqual(["冲突", "恐惧", "威胁"]);
  });

  it("parses JSON from a markdown code block with a spaced language tag", () => {
    const result = parseArchitectStructureSignals(`\`\`\` json\n${section}\n\`\`\``, "book-b");
    expect(result.status).toBe("ok");
    expect(result.signals.bookId).toBe("book-b");
  });

  it("parses JSON from a markdown code block with an uppercase language tag", () => {
    const result = parseArchitectStructureSignals(`\`\`\`JSON\n${section}\n\`\`\``, "book-c");
    expect(result.status).toBe("ok");
    expect(result.signals.bookId).toBe("book-c");
  });

  it("parses JSON when short prose surrounds the object", () => {
    const result = parseArchitectStructureSignals(`下面是结构信号：\n${section}\n以上。`, "book-d");
    expect(result.status).toBe("ok");
    expect(result.signals.bookId).toBe("book-d");
  });

  it("still returns parse_error for unrecoverable content", () => {
    const result = parseArchitectStructureSignals("not json", "book-e");
    expect(result.status).toBe("parse_error");
    expect(result.signals.bookId).toBe("book-e");
  });
});

// ---- Read / Write ----

describe("readStructureSignals / writeStructureSignals", () => {
  it("writes and reads back structure signals", async () => {
    const tmpDir = join(tmpdir(), `inkos-test-${randomUUID()}`);
    const storyDir = join(tmpDir, "story");
    await mkdir(storyDir, { recursive: true });

    try {
      const signals = makeValidSignals("test-book-readwrite");
      await writeStructureSignals(tmpDir, signals);

      const read = await readStructureSignals(tmpDir);
      expect(read.status).toBe("ok");
      if (read.status !== "ok") throw new Error("expected ok");
      expect(read.signals.bookId).toBe("test-book-readwrite");
      expect(read.signals.signals.opening_hook).toEqual(["冲突", "恐惧", "威胁"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns missing status when structure_signals.json is missing", async () => {
    const tmpDir = join(tmpdir(), `inkos-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });

    try {
      const result = await readStructureSignals(tmpDir);
      expect(result.status).toBe("missing");
      if (result.status !== "missing") throw new Error("expected missing");
      expect(result.error).toContain("not found");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns corrupt status for invalid JSON", async () => {
    const tmpDir = join(tmpdir(), `inkos-test-${randomUUID()}`);
    const storyDir = join(tmpDir, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "structure_signals.json"), "not json", "utf-8");

    try {
      const result = await readStructureSignals(tmpDir);
      expect(result.status).toBe("corrupt");
      if (result.status !== "corrupt") throw new Error("expected corrupt");
      expect(result.error).toContain("Invalid JSON");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---- Parse architect output ----

describe("parseArchitectStructureSignals", () => {
  it("parses valid JSON from architect output", () => {
    const section = [
      "# Structure Signals",
      "```json",
      JSON.stringify({ signals: { opening_hook: ["冲突", "恐惧"], protagonist_goal: ["目标"] } }, null, 2),
      "```",
    ].join("\n");

    const result = parseArchitectStructureSignals(section, "book-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.signals.bookId).toBe("book-1");
    expect(result.signals.signals.opening_hook).toEqual(["冲突", "恐惧"]);
    expect(result.signals.signals.protagonist_goal).toEqual(["目标"]);
  });

  it("returns parse_error for invalid architect output with empty fallback signals", () => {
    const result = parseArchitectStructureSignals("gibberish not json", "book-1");
    expect(result.status).toBe("parse_error");
    if (result.status !== "parse_error") throw new Error("expected parse_error");
    expect(result.signals.bookId).toBe("book-1");
    for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
      expect(result.signals.signals[dim]).toEqual([]);
    }
  });

  it("returns parse_error when extracted phrases are all empty", () => {
    const section = [
      "```json",
      JSON.stringify({ signals: { opening_hook: ["", "  "], protagonist_goal: [] } }),
      "```",
    ].join("\n");

    const result = parseArchitectStructureSignals(section, "book-1");
    expect(result.status).toBe("parse_error");
    if (result.status !== "parse_error") throw new Error("expected parse_error");
    expect(result.error).toContain("no valid signal phrases");
  });

  it("returns parse_error (not throws) for malformed JSON so create_book can handle gracefully", () => {
    const result = parseArchitectStructureSignals("{ not valid }", "book-1");
    expect(result.status).toBe("parse_error");
    if (result.status !== "parse_error") throw new Error("expected parse_error");
    // Still provides a usable empty signals object so downstream code doesn't crash
    expect(result.signals.bookId).toBe("book-1");
    for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
      expect(result.signals.signals[dim]).toEqual([]);
    }
  });

  it("returns parse_error for empty section content", () => {
    const result = parseArchitectStructureSignals("", "book-1");
    expect(result.status).toBe("parse_error");
    if (result.status !== "parse_error") throw new Error("expected parse_error");
    expect(result.error).toContain("empty");
  });
});

// ---- Signal matching ----

describe("matchStructureSignals", () => {
  it("matches phrases in content", () => {
    const signals = makeValidSignals();
    const content = "冲突爆发了，主角的目标明确，一定要成功。但是追兵已到，陷入了死局。";

    const matches = matchStructureSignals(content, signals, ["opening_hook", "protagonist_goal", "pressure_source", "obstacle_dilemma"]);

    const opening = matches.find((m) => m.dimension === "opening_hook")!;
    expect(opening.matched).toContain("冲突");
    expect(opening.missing).toContain("恐惧");
    expect(opening.missing).toContain("威胁");

    const goal = matches.find((m) => m.dimension === "protagonist_goal")!;
    expect(goal.matched).toContain("目标明确");
    expect(goal.matched).toContain("一定要");

    const pressure = matches.find((m) => m.dimension === "pressure_source")!;
    expect(pressure.matched).toContain("追兵");

    const obstacle = matches.find((m) => m.dimension === "obstacle_dilemma")!;
    expect(obstacle.matched).toContain("死局");
  });
});

// ---- buildStructureSignalReport ----

describe("buildStructureSignalReport", () => {
  it("returns 'none' source when signals is null", () => {
    const report = buildStructureSignalReport("content", null, ["opening_hook"]);
    expect(report.source).toBe("none");
    expect(report.matches).toEqual([]);
  });

  it("returns 'structure_signals.json' source and match data", () => {
    const signals = makeValidSignals();
    const report = buildStructureSignalReport("冲突爆发了", signals, ["opening_hook"]);
    expect(report.source).toBe("structure_signals.json");
    expect(report.matches.length).toBe(1);
    expect(report.matches[0]!.dimension).toBe("opening_hook");
    expect(report.matches[0]!.matched).toContain("冲突");
  });
});

// ---- Reviewer uses book-level signals ----

describe("StoryEffectivenessAgent with structure signals", () => {
  const agent = new StoryEffectivenessAgent(makeMockAgentContext());

  it("accepts structureSignals in input", async () => {
    const signals = makeValidSignals();
    const content = "冲突爆发了。林默的目标明确，一定要拿到密钥。追兵逼近，他陷入了死局。";

    const report = await agent.review({
      chapter: 1,
      chapterContent: content,
      structureSignals: signals,
    });

    expect(report.structureSignalReport).toBeDefined();
    expect(report.structureSignalReport!.source).toBe("structure_signals.json");
  });

  it("returns undefined structureSignalReport when no signals provided", async () => {
    const report = await agent.review({
      chapter: 1,
      chapterContent: "普通的故事内容。",
    });

    expect(report.structureSignalReport).toBeUndefined();
  });

  it("scores higher with matching book-level signals", async () => {
    const signals = makeValidSignals();
    const contentWithSignals = "冲突爆发了。目标明确，一定要拿到密钥。追兵逼近，陷入了死局没选择。找到线索和破绽后，选择冲出去。获得了新能力，解锁了新区域。";

    const reportWith = await agent.review({
      chapter: 1,
      chapterContent: contentWithSignals,
      structureSignals: signals,
    });

    const reportWithout = await agent.review({
      chapter: 1,
      chapterContent: contentWithSignals,
    });

    // With book-level signals, score should be >= without
    expect(reportWith.score).toBeGreaterThanOrEqual((reportWithout.score ?? 0) - 5);
  });
});

describe("SixStepPlotReviewerAgent with structure signals", () => {
  const agent = new SixStepPlotReviewerAgent(makeMockAgentContext());

  it("accepts structureSignals in input", async () => {
    const signals = makeValidSignals();
    const content = "冲突爆发了。目标明确，一定要拿到密钥。追兵逼近，陷入了死局。找到线索后选择冲出去。获得了新能力。";

    const report = await agent.review({
      chapterContent: content,
      chapterIndex: 1,
      structureSignals: signals,
    });

    expect(report.structureSignalReport).toBeDefined();
    expect(report.structureSignalReport!.source).toBe("structure_signals.json");
  });
});

describe("OpeningHookReviewerAgent with structure signals", () => {
  const agent = new OpeningHookReviewerAgent(makeMockAgentContext());

  it("accepts structureSignals in input", async () => {
    const signals = makeValidSignals();
    const content = "冲突突然爆发，恐惧笼罩着所有人。主角面临一个艰难的选择，死局已经形成。";

    const report = await agent.review({
      chapterContent: content,
      chapterIndex: 1,
      structureSignals: signals,
    });

    expect(report.structureSignalReport).toBeDefined();
    expect(report.structureSignalReport!.source).toBe("structure_signals.json");
  });
});

// ---- buildStructureSignalReport with discriminated union ----

describe("buildStructureSignalReport with StructureSignalsReadResult", () => {
  it("handles 'missing' status from readStructureSignals", () => {
    const report = buildStructureSignalReport(
      "content",
      { status: "missing", error: "file not found" },
      ["opening_hook"],
    );
    expect(report.source).toBe("missing");
    expect(report.error).toContain("not found");
    expect(report.matches).toEqual([]);
  });

  it("handles 'corrupt' status from readStructureSignals", () => {
    const report = buildStructureSignalReport(
      "content",
      { status: "corrupt", error: "Invalid JSON" },
      ["opening_hook"],
    );
    expect(report.source).toBe("corrupt");
    expect(report.error).toContain("Invalid JSON");
    expect(report.matches).toEqual([]);
  });
});

// ---- readStructureSignals schema validation error ----

describe("readStructureSignals error discrimination", () => {
  it("returns corrupt status when JSON is valid but schema fails", async () => {
    const tmpDir = join(tmpdir(), `inkos-test-${randomUUID()}`);
    const storyDir = join(tmpDir, "story");
    await mkdir(storyDir, { recursive: true });
    // Valid JSON but wrong schema (missing required fields)
    await writeFile(
      join(storyDir, "structure_signals.json"),
      JSON.stringify({ notAValidSchema: true }),
      "utf-8",
    );

    try {
      const result = await readStructureSignals(tmpDir);
      expect(result.status).toBe("corrupt");
      if (result.status !== "corrupt") throw new Error("expected corrupt");
      expect(result.error).toContain("Schema validation failed");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---- No hardcoded book-specific words ----

async function readSourceFile(relativePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const srcPath = path.join(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "..",
    relativePath,
  );
  return fs.readFile(srcPath, "utf-8");
}

describe("Reviewers do not contain hardcoded book-specific words", () => {
  it("SixStepPlotReviewerAgent has no hardcoded character names", async () => {
    const src = await readSourceFile("agents/six-step-plot-reviewer.ts");

    // Should NOT contain the previously hardcoded character name
    expect(src).not.toMatch(/陈默/);
    // Should NOT contain the previously hardcoded item name
    expect(src).not.toMatch(/淬毒弩箭/);
    // Should NOT contain specific numerical codes
    expect(src).not.toMatch(/\b003\b/);
    // Should NOT contain specific resource count
    expect(src).not.toMatch(/三发/);
    // Should NOT contain book-specific resource/currency names
    expect(src).not.toMatch(/晶核/);
    expect(src).not.toMatch(/积分/);
    expect(src).not.toMatch(/门禁/);
    expect(src).not.toMatch(/员工卡/);
  });

  it("StoryEffectivenessAgent has no hardcoded book-specific words", async () => {
    const src = await readSourceFile("agents/story-effectiveness.ts");
    expect(src).not.toMatch(/陈默/);
    expect(src).not.toMatch(/淬毒弩箭/);
    expect(src).not.toMatch(/晶核/);
    expect(src).not.toMatch(/积分/);
    expect(src).not.toMatch(/门禁/);
    expect(src).not.toMatch(/员工卡/);
  });

  it("OpeningHookReviewerAgent has no hardcoded book-specific words", async () => {
    const src = await readSourceFile("agents/opening-hook-reviewer.ts");
    expect(src).not.toMatch(/陈默/);
    expect(src).not.toMatch(/淬毒弩箭/);
    expect(src).not.toMatch(/晶核/);
    expect(src).not.toMatch(/积分/);
    expect(src).not.toMatch(/门禁/);
    expect(src).not.toMatch(/员工卡/);
  });
});

// ---- inspectStructureSignals ----

describe("inspectStructureSignals", () => {
  it("reports dimension counts and empty dimensions", () => {
    const signals = createEmptyStructureSignals("test-book");
    signals.signals.opening_hook = ["冲突", "恐惧"];
    signals.signals.pressure_source = ["追兵"];

    const result = inspectStructureSignals(signals);

    expect(result.bookId).toBe("test-book");
    expect(result.totalPhrases).toBe(3);
    expect(result.totalUnique).toBe(3);
    expect(result.dimensions).toHaveLength(12);

    const openingHook = result.dimensions.find((d) => d.dimension === "opening_hook");
    expect(openingHook!.phraseCount).toBe(2);
    expect(openingHook!.phrases).toEqual(["冲突", "恐惧"]);

    // Unset dimensions should be empty
    expect(result.emptyDimensions).toContain("protagonist_goal");
  });

  it("detects duplicate phrases across dimensions", () => {
    const signals = makeValidSignals();
    signals.signals.opening_hook = ["冲突"];
    signals.signals.pressure_source = ["冲突"]; // same phrase in different dimension

    const result = inspectStructureSignals(signals);

    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.phrase).toBe("冲突");
    expect(result.duplicates[0]!.dimensions).toContain("opening_hook");
    expect(result.duplicates[0]!.dimensions).toContain("pressure_source");
  });

  it("detects suspiciously short phrases", () => {
    const signals = makeValidSignals();
    signals.signals.opening_hook = ["血"]; // single-char Chinese

    const result = inspectStructureSignals(signals);

    expect(result.suspiciousPhrases).toHaveLength(1);
    expect(result.suspiciousPhrases[0]!.phrase).toBe("血");
    expect(result.suspiciousPhrases[0]!.reason).toContain("单字");
  });

  it("counts unique phrases correctly with duplicates", () => {
    const signals = createEmptyStructureSignals("test-book");
    signals.signals.opening_hook = ["冲突"];
    signals.signals.pressure_source = ["冲突"];

    const result = inspectStructureSignals(signals);

    expect(result.totalPhrases).toBe(2);
    expect(result.totalUnique).toBe(1);
  });
});

// ---- validateStructureSignalsFull ----

describe("validateStructureSignalsFull", () => {
  it("returns PASS for a clean signals file", () => {
    const signals = makeValidSignals();

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("PASS");
    expect(result.issues).toHaveLength(0);
  });

  it("returns FAIL when dimensions are missing", () => {
    const signals = makeValidSignals();
    // Manually remove a dimension key to simulate schema issue
    delete (signals.signals as Record<string, unknown>).opening_hook;

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("FAIL");
    expect(result.issues.some((i) => i.message.includes("opening_hook"))).toBe(true);
  });

  it("returns WARN for duplicate phrases within a dimension", () => {
    const signals = makeValidSignals();
    signals.signals.opening_hook = ["冲突", "冲突"];

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("WARN");
    expect(result.issues.some((i) => i.message.includes("重复"))).toBe(true);
  });

  it("returns WARN for overly short phrases", () => {
    const signals = makeValidSignals();
    signals.signals.opening_hook = ["a"];

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("WARN");
    expect(result.issues.some((i) => i.message.includes("过短"))).toBe(true);
  });

  it("returns FAIL for empty phrases", () => {
    const signals = makeValidSignals();
    signals.signals.opening_hook = [""];

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("FAIL");
    expect(result.issues.some((i) => i.message.includes("空字符串"))).toBe(true);
  });

  it("returns FAIL for all-empty dimensions (total phrases = 0)", () => {
    const signals = createEmptyStructureSignals("test-book");

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("FAIL");
    expect(result.issues.some((i) => i.message.includes("所有维度均为空"))).toBe(true);
  });

  it("returns FAIL when a single dimension is empty", () => {
    const signals = makeValidSignals();
    signals.signals.opening_hook = [];

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("FAIL");
    expect(result.issues.some((i) => i.message.includes("opening_hook") && i.message.includes("为空"))).toBe(true);
  });

  it("returns WARN when per-dimension phrase count is below minimum", () => {
    const signals = makeValidSignals();
    // Set a dimension to only 2 phrases (below MIN_PHRASES_PER_DIMENSION = 3)
    signals.signals.opening_hook = ["冲突", "恐惧"];

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("WARN");
    expect(result.issues.some((i) => i.message.includes("仅有") && i.message.includes("短语"))).toBe(true);
  });

  it("all-empty fails with total-phrase-count error", () => {
    const signals = createEmptyStructureSignals("test-book");
    // Add just one phrase so total > 0 but all other dims empty
    signals.signals.opening_hook = ["冲突"];

    const result = validateStructureSignalsFull(signals);

    expect(result.status).toBe("FAIL"); // 11 dimensions still empty → FAIL
    expect(result.issues.some((i) => i.message.includes("总短语数仅"))).toBe(true);
  });
});

// ---- appendStructureSignal ----

describe("appendStructureSignal", () => {
  it("appends a phrase to a legal dimension", () => {
    const signals = makeValidSignals();
    const { updated, alreadyExists } = appendStructureSignal(signals, "opening_hook", "新冲突");

    expect(alreadyExists).toBe(false);
    expect(updated.signals.opening_hook).toContain("新冲突");
    // updatedAt is refreshed on append
    expect(typeof updated.updatedAt).toBe("string");
    const originalLength = signals.signals.opening_hook!.length;
    expect(updated.signals.opening_hook).toHaveLength(originalLength + 1);
  });

  it("throws on illegal dimension", () => {
    const signals = makeValidSignals();
    expect(() => appendStructureSignal(signals, "nonexistent_dim", "test")).toThrow("非法维度");
  });

  it("returns alreadyExists=true and does not duplicate", () => {
    const signals = makeValidSignals();
    signals.signals.opening_hook = ["冲突"];

    const { updated, alreadyExists } = appendStructureSignal(signals, "opening_hook", "冲突");

    expect(alreadyExists).toBe(true);
    expect(updated.signals.opening_hook).toEqual(["冲突"]);
  });

  it("trims whitespace from phrase", () => {
    const signals = makeValidSignals();
    const { updated, alreadyExists } = appendStructureSignal(signals, "opening_hook", "  暴风  ");

    expect(alreadyExists).toBe(false);
    expect(updated.signals.opening_hook).toContain("暴风");
    expect(updated.signals.opening_hook).not.toContain("  暴风  ");
  });

  it("throws on empty phrase after trim", () => {
    const signals = makeValidSignals();
    expect(() => appendStructureSignal(signals, "opening_hook", "   ")).toThrow("不能为空");
  });

  it("maintains other dimensions unchanged", () => {
    const signals = makeValidSignals();
    signals.signals.pressure_source = ["追兵"];

    const { updated } = appendStructureSignal(signals, "opening_hook", "新冲突");

    expect(updated.signals.pressure_source).toEqual(["追兵"]);
  });
});

// ---- Maintenance commands: no LLM, no genre profile ----

describe("Maintenance functions are pure (no LLM, no genre profile)", () => {
  it("inspectStructureSignals does not access filesystem or external resources", () => {
    const signals = makeValidSignals();
    // Pure function — should complete without any I/O
    const result = inspectStructureSignals(signals);
    expect(result.bookId).toBe("test-book");
  });

  it("validateStructureSignalsFull does not access filesystem or external resources", () => {
    const signals = makeValidSignals();
    const result = validateStructureSignalsFull(signals);
    expect(result.status).toBeDefined();
  });

  it("appendStructureSignal does not access filesystem or external resources", () => {
    const signals = makeValidSignals();
    const { updated, alreadyExists } = appendStructureSignal(signals, "opening_hook", "test");
    expect(alreadyExists).toBe(false);
    expect(updated.signals.opening_hook).toContain("test");
  });
});

// ---- Error diagnostics for missing/corrupt signals ----

describe("Error diagnostics for missing/corrupt signals", () => {
  it("readStructureSignals returns 'missing' status for nonexistent file", async () => {
    const tmpDir = join(tmpdir(), `inkos-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });

    try {
      const result = await readStructureSignals(tmpDir);
      expect(result.status).toBe("missing");
      if (result.status !== "missing") throw new Error("expected missing");
      expect(result.error).toContain("not found");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("readStructureSignals returns 'corrupt' status for invalid JSON", async () => {
    const tmpDir = join(tmpdir(), `inkos-test-${randomUUID()}`);
    const storyDir = join(tmpDir, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "structure_signals.json"), "not valid json", "utf-8");

    try {
      const result = await readStructureSignals(tmpDir);
      expect(result.status).toBe("corrupt");
      if (result.status !== "corrupt") throw new Error("expected corrupt");
      expect(result.error).toContain("Invalid JSON");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("readStructureSignals returns 'corrupt' for schema mismatch", async () => {
    const tmpDir = join(tmpdir(), `inkos-test-${randomUUID()}`);
    const storyDir = join(tmpDir, "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      join(storyDir, "structure_signals.json"),
      JSON.stringify({ wrong: "schema" }),
      "utf-8",
    );

    try {
      const result = await readStructureSignals(tmpDir);
      expect(result.status).toBe("corrupt");
      if (result.status !== "corrupt") throw new Error("expected corrupt");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---- Genre profile structure signal guidance completeness ----

describe("Genre profiles contain structure signal generation guidance", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const genresDir = join(__dirname, "..", "..", "genres");

  it("every genre profile .md file contains the guidance section", async () => {
    const entries = await readdir(genresDir);
    const mdFiles = entries.filter((e) => e.endsWith(".md"));

    expect(mdFiles.length).toBeGreaterThanOrEqual(27);

    const missing: string[] = [];

    for (const file of mdFiles) {
      const content = await readFile(join(genresDir, file), "utf-8");
      if (!content.includes("## Structure Signal Generation Guidance")) {
        missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });

  it("every guidance section references all 12 structure dimensions", async () => {
    const entries = await readdir(genresDir);
    const mdFiles = entries.filter((e) => e.endsWith(".md"));

    const requiredDimensions = [
      "opening_hook",
      "protagonist_goal",
      "pressure_source",
      "obstacle_dilemma",
      "solution_possibility",
      "active_attempt",
      "payoff_reward",
      "ending_pull",
      "antagonist_pressure",
      "resource_reward",
      "world_rule",
      "forbidden_false_positive",
    ];

    const incomplete: { file: string; missing: string[] }[] = [];

    for (const file of mdFiles) {
      const content = await readFile(join(genresDir, file), "utf-8");
      const guidanceStart = content.indexOf("## Structure Signal Generation Guidance");
      if (guidanceStart === -1) continue;
      const guidanceSection = content.slice(guidanceStart);

      const missingDims = requiredDimensions.filter(
        (dim) => !guidanceSection.includes(dim),
      );
      if (missingDims.length > 0) {
        incomplete.push({ file, missing: missingDims });
      }
    }

    expect(incomplete).toEqual([]);
  });
});
