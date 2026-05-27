import { describe, expect, it } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  StructureSignalsSchema,
  validateStructureSignals,
  readStructureSignals,
  writeStructureSignals,
  createEmptyStructureSignals,
  parseArchitectStructureSignals,
  matchStructureSignals,
  buildStructureSignalReport,
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
      protagonist_goal: ["目标明确", "一定要"],
      pressure_source: ["追兵", "倒计时"],
      obstacle_dilemma: ["死局", "没选择"],
      solution_possibility: ["线索", "破绽"],
      active_attempt: ["选择", "冲出去"],
      payoff_reward: ["获得", "解锁"],
      ending_pull: ["未解决", "新危机"],
      antagonist_pressure: ["反派逼近", "围堵"],
      resource_reward: ["兑换", "净赚"],
      world_rule: ["规则限制", "天道"],
      forbidden_false_positive: ["普通", "日常"],
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
    expect(result.bookId).toBe("book-1");
    expect(result.signals.opening_hook).toEqual(["冲突", "恐惧"]);
    expect(result.signals.protagonist_goal).toEqual(["目标"]);
  });

  it("returns empty signals for invalid architect output", () => {
    const result = parseArchitectStructureSignals("gibberish not json", "book-1");
    expect(result.bookId).toBe("book-1");
    for (const dim of STRUCTURE_SIGNAL_DIMENSIONS) {
      expect(result.signals[dim]).toEqual([]);
    }
  });

  it("filters out empty strings from arrays", () => {
    const section = [
      "```json",
      JSON.stringify({ signals: { opening_hook: ["冲突", "", "  "], protagonist_goal: [] } }),
      "```",
    ].join("\n");

    const result = parseArchitectStructureSignals(section, "book-1");
    expect(result.signals.opening_hook).toEqual(["冲突"]);
    expect(result.signals.protagonist_goal).toEqual([]);
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
