import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StateManager } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(testDir, "..", "..");
const cliEntry = resolve(cliDir, "dist", "index.js");

let projectDir: string;

function buildTestEnv(overrides?: Record<string, string>) {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith("INKOS_")
      && !key.startsWith("OPENAI_")
      && !key.startsWith("ANTHROPIC_")
      && key !== "TAVILY_API_KEY",
    ),
  );

  return {
    ...baseEnv,
    // Prevent global config from leaking into tests
    HOME: projectDir,
    ...overrides,
  };
}

function run(args: string[], options?: { env?: Record<string, string>; input?: string }): string {
  return execFileSync("node", [cliEntry, ...args], {
    cwd: projectDir,
    encoding: "utf-8",
    env: buildTestEnv(options?.env),
    input: options?.input,
    timeout: 10_000,
  });
}

function runStderr(args: string[], options?: { env?: Record<string, string> }): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [cliEntry, ...args], {
      cwd: projectDir,
      encoding: "utf-8",
      env: buildTestEnv(options?.env),
      timeout: 10_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout: string; stderr: string; status: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

const failingLlmEnv = {
  INKOS_LLM_PROVIDER: "openai",
  INKOS_LLM_BASE_URL: "http://127.0.0.1:9/v1",
  INKOS_LLM_MODEL: "test-model",
  INKOS_LLM_API_KEY: "test-key",
};

describe("CLI integration", () => {
  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-test-"));
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("inkos --version", () => {
    it("prints version number", () => {
      const output = run(["--version"]);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("inkos --help", () => {
    it("prints help with command list", () => {
      const output = run(["--help"]);
      expect(output).toContain("inkos");
      expect(output).toContain("init");
      expect(output).toContain("book");
      expect(output).toContain("write");
    });
  });

  describe("inkos init", () => {
    it("initializes project in current directory", () => {
      const output = run(["init"]);
      expect(output).toContain("Project initialized");
    });

    it("creates inkos.json with correct structure", async () => {
      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.llm).toBeDefined();
      expect(config.llm.provider).toBeDefined();
      expect(config.llm.model).toBeDefined();
      expect(config.daemon).toBeDefined();
      expect(config.notify).toEqual([]);
    });

    it("creates .env file", async () => {
      const envContent = await readFile(join(projectDir, ".env"), "utf-8");
      expect(envContent).toContain("INKOS_LLM_API_KEY");
    });

    it("creates .gitignore", async () => {
      const gitignore = await readFile(join(projectDir, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".env");
    });

    it("creates Node version hints for sqlite-backed memory features", async () => {
      await expect(readFile(join(projectDir, ".nvmrc"), "utf-8")).resolves.toContain("22");
      await expect(readFile(join(projectDir, ".node-version"), "utf-8")).resolves.toContain("22");
    });

    it("creates books/ and radar/ directories", async () => {
      const booksStat = await stat(join(projectDir, "books"));
      expect(booksStat.isDirectory()).toBe(true);
      const radarStat = await stat(join(projectDir, "radar"));
      expect(radarStat.isDirectory()).toBe(true);
    });
  });

  describe("inkos init <name>", () => {
    it("creates project in subdirectory", () => {
      const output = run(["init", "subproject"]);
      expect(output).toContain("Project initialized");
    });

    it("creates inkos.json in subdirectory", async () => {
      const raw = await readFile(join(projectDir, "subproject", "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.name).toBe("subproject");
    });

    it("supports absolute project paths instead of nesting them under cwd", async () => {
      const absoluteDir = await mkdtemp(join(tmpdir(), "inkos-cli-abs-init-"));

      try {
        const output = run(["init", absoluteDir]);
        expect(output).toContain(`Project initialized at ${absoluteDir}`);

        const raw = await readFile(join(absoluteDir, "inkos.json"), "utf-8");
        const config = JSON.parse(raw);
        expect(config.name).toBe(basename(absoluteDir));
      } finally {
        await rm(absoluteDir, { recursive: true, force: true });
      }
    });

    it("prints English next steps when initialized with --lang en", async () => {
      const englishDir = await mkdtemp(join(tmpdir(), "inkos-cli-en-init-"));

      try {
        const output = run(["init", englishDir, "--lang", "en"]);
        expect(output).toContain("Project initialized");
        expect(output).toContain("inkos book create --title 'My Novel'");
        expect(output).not.toContain("我的小说");
      } finally {
        await rm(englishDir, { recursive: true, force: true });
      }
    });
  });

  describe("inkos config set", () => {
    it("sets a known config value", () => {
      const output = run(["config", "set", "llm.provider", "anthropic"]);
      expect(output).toContain("Set llm.provider = anthropic");
    });

    it("sets a nested config value", async () => {
      run(["config", "set", "llm.model", "gpt-5"]);
      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.llm.model).toBe("gpt-5");
    });

    it("rejects unknown config keys", () => {
      expect(() => {
        run(["config", "set", "custom.nested.key", "value"]);
      }).toThrow();
    });

    it("sets input governance mode", async () => {
      const output = run(["config", "set", "inputGovernanceMode", "v2"]);
      expect(output).toContain("Set inputGovernanceMode = v2");

      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.inputGovernanceMode).toBe("v2");
    });
  });

  describe("inkos config show", () => {
    it("shows current config as JSON", () => {
      const output = run(["config", "show"]);
      const config = JSON.parse(output);
      expect(config.llm.model).toBe("gpt-5");
    });
  });

  describe("inkos short-story", () => {
    it("prints a short-story chapter plan", () => {
      const output = run(["short-story", "plan", "--theme", "雨夜复仇", "--target-words", "12000", "--json"]);
      const plan = JSON.parse(output);

      expect(plan.type).toBe("short_story");
      expect(plan.chapterCount).toBe(8);
      expect(plan.chapters.reduce((sum: number, chapter: { targetWords: number }) => sum + chapter.targetWords, 0)).toBe(12_000);
      expect(plan.chapters[0].function).toBe("hook");
      expect(plan.chapters.at(-1).function).toBe("resolution");
      expect(plan.chapters.some((chapter: { function: string }) => chapter.function === "twist")).toBe(true);
      expect(plan.chapters.some((chapter: { function: string }) => chapter.function === "climax")).toBe(true);
    });

    it("prints short-story structure functions in the text plan", () => {
      const output = run(["short-story", "plan", "--theme", "雨夜复仇", "--target-words", "12000"]);

      expect(output).toContain("[1] hook - 开局冲突");
      expect(output).toContain("twist - 第一次反转");
      expect(output).toContain("[8] resolution - 完整结局");
      expect(output).toContain("林晚");
      expect(output).toContain("顾沉");
      expect(output).toContain("conflict: 顾沉冲上台抢夺话筒");
      expect(output).toContain("endingHook: 林晚从手包里拿出亲子鉴定报告");
    });

    it("plans and writes thriller short stories without changing the command shape", async () => {
      const storyDir = join(projectDir, "my-novel", "short-stories", "悬疑惊悚");
      const planPath = join(storyDir, "plan.md");
      const planOutput = run([
        "short-story",
        "plan",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
        "--out",
        planPath,
      ]);
      const markdown = await readFile(planPath, "utf-8");

      expect(planOutput).toContain("# Short story plan: 悬疑惊悚");
      expect(markdown).toContain("许念");
      expect(markdown).toContain("停尸间");
      expect(markdown).toContain("## [1] hook - 开局冲突");

      const writeOutput = run([
        "short-story",
        "write",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
        "--json",
      ]);
      const result = JSON.parse(writeOutput);
      const firstChapter = await readFile(join(storyDir, "chapters", "001.md"), "utf-8");

      expect(result.type).toBe("short_story");
      expect(result.chapters.length).toBeGreaterThan(20);
      expect(firstChapter).toContain("许念");
      expect(firstChapter).toContain("停尸间");
      expect(firstChapter).toContain("三号冷柜");
    });

    it("optimizes a thriller hook and writes publish titles", async () => {
      const storyDir = join(projectDir, "my-novel", "short-stories", "悬疑惊悚");
      const planPath = join(storyDir, "plan.md");
      run([
        "short-story",
        "plan",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
        "--out",
        planPath,
      ]);
      run([
        "short-story",
        "write",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
      ]);

      const hookOutput = run(["short-story", "hook", "--theme", "悬疑惊悚"]);
      const firstChapter = await readFile(join(storyDir, "chapters", "001.md"), "utf-8");
      const compactOpening = firstChapter.replace(/^# 第1章\s*/, "").replace(/\s+/g, "").slice(0, 300);

      expect(hookOutput).toContain("Short story hook optimized: 悬疑惊悚");
      expect(compactOpening.slice(0, 50)).toMatch(/三号冷柜|许晴|电话/);
      expect(compactOpening.slice(0, 150)).toMatch(/到底在哪|我在你身后|来电记录/);
      expect(compactOpening).toMatch(/睁开眼|十三|监控/);

      const titlesOutput = run(["short-story", "titles", "--theme", "悬疑惊悚"]);
      const titles = await readFile(join(storyDir, "titles.md"), "utf-8");

      expect(titlesOutput).toContain("# Short story titles: 悬疑惊悚");
      expect(titles).toContain("姐姐");
      expect(titles).toContain("停尸间");
      expect(titles.split("\n").filter((line) => line.startsWith("- 《"))).toHaveLength(10);
    });

    it("exports short-story chapters into publish-ready files and book text", async () => {
      const storyDir = join(projectDir, "my-novel", "short-stories", "悬疑惊悚");
      const planPath = join(storyDir, "plan.md");
      run([
        "short-story",
        "plan",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
        "--out",
        planPath,
      ]);
      run([
        "short-story",
        "write",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
      ]);
      run(["short-story", "titles", "--theme", "悬疑惊悚"]);

      const output = run(["short-story", "export", "--theme", "悬疑惊悚"]);
      const publishFiles = await readdir(join(storyDir, "publish"));
      const firstChapterFile = publishFiles.find((fileName) => fileName.startsWith("001_") && fileName.endsWith(".md"));
      expect(firstChapterFile).toBeDefined();
      expect(publishFiles).not.toContain("001.md");
      expect(firstChapterFile).not.toMatch(/[\/\\:*?"<>|]/);
      const publishChapter = await readFile(join(storyDir, "publish", firstChapterFile ?? ""), "utf-8");
      const bookText = await readFile(join(storyDir, "publish", "book.txt"), "utf-8");
      const firstTitle = publishChapter.match(/^# (第1章 .+)$/m)?.[1];

      expect(output).toContain("Short story exported: 悬疑惊悚");
      expect(output).toContain("Chapters:");
      expect(publishChapter).toMatch(/^# 第1章 .{8,16}$/m);
      expect(publishChapter).not.toMatch(/\n{3,}/);
      expect(bookText).toContain("《姐姐失踪三年后给我打电话，冷柜里的女尸睁眼了》");
      expect(firstTitle).toBeDefined();
      expect(bookText).toContain(firstTitle ?? "");
      expect(bookText).toContain("第33章");
      expect(bookText).not.toContain("# 第1章");
    });

    it("generates a short-video promotion script from the first chapter", async () => {
      const storyDir = join(projectDir, "my-novel", "short-stories", "悬疑惊悚");
      const planPath = join(storyDir, "plan.md");
      run([
        "short-story",
        "plan",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
        "--out",
        planPath,
      ]);
      run([
        "short-story",
        "write",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
      ]);

      const output = run(["short-story", "script", "--theme", "悬疑惊悚"]);
      const script = await readFile(join(storyDir, "scripts", "script.txt"), "utf-8");
      const lines = script.split("\n").filter(Boolean);

      expect(output).toContain("Short-video script written:");
      expect(lines.length).toBeGreaterThanOrEqual(15);
      expect(lines.length).toBeLessThanOrEqual(25);
      expect(lines.every((line) => line.length >= 15 && line.length <= 30)).toBe(true);
      expect(lines[2]).toContain("三号冷柜");
      expect(lines[5]).toContain("诡异");
      expect(lines.at(-1)).toContain("冷柜");
    });

    it("analyzes short-story publish potential into a markdown report", async () => {
      const storyDir = join(projectDir, "my-novel", "short-stories", "悬疑惊悚");
      const planPath = join(storyDir, "plan.md");
      run([
        "short-story",
        "plan",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
        "--out",
        planPath,
      ]);
      run([
        "short-story",
        "write",
        "--theme",
        "悬疑惊悚",
        "--target-words",
        "50000",
      ]);
      run(["short-story", "titles", "--theme", "悬疑惊悚"]);

      const output = run(["short-story", "analyze", "--theme", "悬疑惊悚"]);
      const analysis = await readFile(join(storyDir, "analysis.md"), "utf-8");

      expect(output).toContain("# Short story analysis: 悬疑惊悚");
      expect(output).toContain("Analysis written:");
      expect(analysis).toContain("标题点击率评分");
      expect(analysis).toContain("前300字吸引力");
      expect(analysis).toContain("节奏密度");
      expect(analysis).toContain("中段拖沓检测");
      expect(analysis).toContain("结尾钩子强度");
      expect(analysis).toContain("## Recommendations");
    });

    it("runs short-story batch into isolated run directories", async () => {
      const output = run([
        "short-story",
        "batch",
        "--themes",
        "出轨复仇,悬疑惊悚",
        "--count",
        "2",
        "--target-words",
        "12000",
      ]);
      const betrayalDir = join(projectDir, "my-novel", "short-stories", "出轨复仇");
      const thrillerDir = join(projectDir, "my-novel", "short-stories", "悬疑惊悚");
      const betrayalRuns = (await readdir(betrayalDir)).filter((name) => name.startsWith("run-")).sort();
      const thrillerRuns = (await readdir(thrillerDir)).filter((name) => name.startsWith("run-")).sort();
      const [betrayalRun, betrayalRun2] = betrayalRuns;
      const [thrillerRun, thrillerRun2] = thrillerRuns;

      expect(output).toContain("Short story batch completed");
      expect(output).toContain("出轨复仇 #1");
      expect(output).toContain("悬疑惊悚 #1");
      expect(output).toContain("出轨复仇 #2");
      expect(output).toContain("悬疑惊悚 #2");
      expect(betrayalRun).toBeTruthy();
      expect(thrillerRun).toBeTruthy();
      expect(betrayalRun2).toBeTruthy();
      expect(thrillerRun2).toBeTruthy();

      const betrayalRunDir = join(betrayalDir, betrayalRun ?? "");
      const thrillerRunDir = join(thrillerDir, thrillerRun ?? "");
      const betrayalRunDir2 = join(betrayalDir, betrayalRun2 ?? "");
      const thrillerRunDir2 = join(thrillerDir, thrillerRun2 ?? "");
      const betrayalPlan = await readFile(join(betrayalRunDir, "plan.md"), "utf-8");
      const thrillerPlan = await readFile(join(thrillerRunDir, "plan.md"), "utf-8");
      const betrayalPlan2 = await readFile(join(betrayalRunDir2, "plan.md"), "utf-8");
      const thrillerPlan2 = await readFile(join(thrillerRunDir2, "plan.md"), "utf-8");
      const betrayalOpening = await readFile(join(betrayalRunDir, "chapters", "001.md"), "utf-8");
      const betrayalOpening2 = await readFile(join(betrayalRunDir2, "chapters", "001.md"), "utf-8");
      const thrillerOpening = await readFile(join(thrillerRunDir, "chapters", "001.md"), "utf-8");
      const thrillerOpening2 = await readFile(join(thrillerRunDir2, "chapters", "001.md"), "utf-8");
      const betrayalVariant = JSON.parse(await readFile(join(betrayalRunDir, "variant.json"), "utf-8"));
      const thrillerVariant = JSON.parse(await readFile(join(thrillerRunDir, "variant.json"), "utf-8"));
      const betrayalVariant2 = JSON.parse(await readFile(join(betrayalRunDir2, "variant.json"), "utf-8"));
      const thrillerVariant2 = JSON.parse(await readFile(join(thrillerRunDir2, "variant.json"), "utf-8"));
      const betrayalScript = await readFile(join(betrayalRunDir, "scripts", "script.txt"), "utf-8");
      const thrillerBook = await readFile(join(thrillerRunDir, "publish", "book.txt"), "utf-8");

      expect(betrayalPlan).toContain("# Short story plan: 出轨复仇");
      expect(thrillerPlan).toContain("# Short story plan: 悬疑惊悚");
      expect(betrayalPlan).not.toBe(betrayalPlan2);
      expect(thrillerPlan).not.toBe(thrillerPlan2);
      expect(betrayalOpening.slice(0, 300)).not.toBe(betrayalOpening2.slice(0, 300));
      expect(thrillerOpening.slice(0, 300)).not.toBe(thrillerOpening2.slice(0, 300));
      expect(betrayalVariant.baseWorld.protagonist).toBeTruthy();
      expect(betrayalVariant.derived.mainThreat).toBeTruthy();
      expect(betrayalVariant.writingMode).toMatch(/^(logic|emotion|conflict|weird)$/);
      expect(new Set([betrayalVariant.writingMode, betrayalVariant2.writingMode]).size).toBeGreaterThanOrEqual(2);
      expect([betrayalVariant.hookMode, betrayalVariant2.hookMode]).toEqual(["normal", "strong"]);
      expect(thrillerVariant.baseWorld.protagonist).toBeTruthy();
      expect(thrillerVariant.derived.premise).toBeTruthy();
      expect(thrillerVariant.writingMode).toMatch(/^(logic|emotion|conflict|weird)$/);
      expect(new Set([thrillerVariant.writingMode, thrillerVariant2.writingMode]).size).toBeGreaterThanOrEqual(2);
      expect([thrillerVariant.hookMode, thrillerVariant2.hookMode]).toEqual(["normal", "strong"]);
      expect(betrayalVariant.protagonist).toBeUndefined();
      expect(thrillerVariant.premise).toBeUndefined();
      expect(betrayalScript.length).toBeGreaterThan(0);
      expect(thrillerBook).toContain("第1章");
      expect(await readdir(join(betrayalRunDir, "chapters"))).toHaveLength(8);
      expect(await readdir(join(thrillerRunDir, "chapters"))).toHaveLength(8);
    });

    it("collects manual metrics for a short-story run", async () => {
      run([
        "short-story",
        "batch",
        "--themes",
        "数据测试",
        "--count",
        "1",
        "--target-words",
        "12000",
      ]);
      const themeDir = join(projectDir, "my-novel", "short-stories", "数据测试");
      const runName = (await readdir(themeDir)).find((name) => name.startsWith("run-"));

      expect(runName).toBeTruthy();

      const output = run([
        "short-story",
        "collect",
        "--theme",
        "数据测试",
        "--run",
        runName ?? "",
      ], {
        input: "1000\n120\n0.68\n88\n12\n",
      });
      const metrics = JSON.parse(await readFile(join(themeDir, runName ?? "", "metrics.json"), "utf-8"));

      expect(output).toContain("Short story metrics collected: 数据测试");
      expect(metrics.views).toBe(1000);
      expect(metrics.clicks).toBe(120);
      expect(metrics.CTR).toBe(0.12);
      expect(metrics.completion).toBe(0.68);
      expect(metrics.likes).toBe(88);
      expect(metrics.follows).toBe(12);
    });

    it("ranks short-story runs by CTR, completion, and like rate", async () => {
      const themeDir = join(projectDir, "my-novel", "short-stories", "排名测试");
      const firstRun = join(themeDir, "run-20260101-000001-01");
      const secondRun = join(themeDir, "run-20260101-000001-02");
      await mkdir(firstRun, { recursive: true });
      await mkdir(secondRun, { recursive: true });
      await writeFile(join(firstRun, "metrics.json"), JSON.stringify({
        views: 1000,
        clicks: 100,
        CTR: 0.1,
        completion: 0.7,
        likes: 50,
        follows: 8,
      }), "utf-8");
      await writeFile(join(secondRun, "metrics.json"), JSON.stringify({
        views: 1000,
        clicks: 180,
        CTR: 0.18,
        completion: 0.8,
        likes: 90,
        follows: 13,
      }), "utf-8");

      const output = run(["short-story", "rank", "--theme", "排名测试", "--json"]);
      const ranked = JSON.parse(output);

      expect(ranked.runs).toHaveLength(2);
      expect(ranked.runs[0].run).toBe("run-20260101-000001-02");
      expect(ranked.runs[0].like_rate).toBe(0.09);
      expect(ranked.runs[0].score).toBe(0.348);
      expect(ranked.runs[1].run).toBe("run-20260101-000001-01");
    });

    it("writes the short-story plan to a markdown file and keeps console output", async () => {
      const outPath = join(projectDir, "my-novel", "short-stories", "出轨复仇", "plan.md");
      const output = run([
        "short-story",
        "plan",
        "--theme",
        "出轨复仇",
        "--target-words",
        "12000",
        "--out",
        outPath,
      ]);
      const markdown = await readFile(outPath, "utf-8");

      expect(output).toContain("# Short story plan: 出轨复仇");
      expect(output).toContain("[1] hook - 开局冲突");
      expect(markdown).toContain("# Short story plan: 出轨复仇");
      expect(markdown).toContain("## [1] hook - 开局冲突");
      expect(markdown).toContain("林晚");
      expect(markdown).toContain("顾沉");
      expect(markdown).toContain("- conflict: 顾沉冲上台抢夺话筒");
      expect(markdown).toContain("- endingHook: 林晚从手包里拿出亲子鉴定报告");
    });

    it("writes short-story markdown chapters from an existing plan", async () => {
      const storyDir = join(projectDir, "my-novel", "short-stories", "出轨复仇");
      const planPath = join(storyDir, "plan.md");
      run([
        "short-story",
        "plan",
        "--theme",
        "出轨复仇",
        "--target-words",
        "12000",
        "--out",
        planPath,
      ]);
      const before = await readFile(planPath, "utf-8");
      const output = run([
        "short-story",
        "write",
        "--theme",
        "出轨复仇",
        "--target-words",
        "12000",
        "--json",
      ]);
      const result = JSON.parse(output);
      const after = await readFile(planPath, "utf-8");
      const firstChapter = await readFile(join(storyDir, "chapters", "001.md"), "utf-8");

      expect(result.type).toBe("short_story");
      expect(result.chapters).toHaveLength(8);
      expect(result.chapters[0].wordCount).toBeGreaterThanOrEqual(1_200);
      expect(result.chapters[0].wordCount).toBeLessThanOrEqual(1_800);
      expect(after).toBe(before);
      expect(firstChapter).toContain("# 第1章");
      expect(firstChapter).toContain("林晚");
      expect(firstChapter).toContain("顾沉");
      expect(firstChapter).toContain("林晚从手包里拿出亲子鉴定报告");
    });

    it("audits an existing book directory", async () => {
      const bookDir = join(projectDir, "books", "shorty");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      const now = new Date().toISOString();
      await writeFile(join(bookDir, "book.json"), JSON.stringify({
        schemaVersion: 2,
        type: "short_story",
        id: "shorty",
        title: "Shorty",
        platform: "tomato",
        genre: "urban",
        status: "completed",
        targetChapters: 6,
        chapterWordCount: 1500,
        language: "zh",
        createdAt: now,
        updatedAt: now,
      }), "utf-8");
      for (let i = 1; i <= 6; i += 1) {
        await writeFile(
          join(bookDir, "chapters", `${String(i).padStart(4, "0")}_测试.md`),
          "我".repeat(1_500),
          "utf-8",
        );
      }

      const output = run(["short-story", "audit", "shorty", "--json"]);
      const report = JSON.parse(output);

      expect(report.passed).toBe(true);
      expect(report.totalWords).toBe(9_000);
      expect(report.chapterCount).toBe(6);
      await rm(bookDir, { recursive: true, force: true });
    });
  });

  describe("inkos interact", () => {
    it("returns structured JSON for shared interaction mode switches", async () => {
      const initialized = await stat(join(projectDir, "inkos.json")).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);
      const envPath = join(projectDir, ".env");
      const originalEnv = await readFile(envPath, "utf-8");
      try {
        await writeFile(
          envPath,
          Object.entries(failingLlmEnv).map(([key, value]) => `${key}=${value}`).join("\n"),
          "utf-8",
        );
        const output = run(["interact", "--json", "--message", "切换到全自动"]);
        const data = JSON.parse(output);

        expect(data.request.intent).toBe("switch_mode");
        expect(data.request.mode).toBe("auto");
        expect(data.session.automationMode).toBe("auto");
      } finally {
        await writeFile(envPath, originalEnv, "utf-8");
      }
    });

    it("binds the requested book when interact is called with --book", async () => {
      const initialized = await stat(join(projectDir, "inkos.json")).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);
      const envPath = join(projectDir, ".env");
      const originalEnv = await readFile(envPath, "utf-8");
      try {
        await writeFile(
          envPath,
          Object.entries(failingLlmEnv).map(([key, value]) => `${key}=${value}`).join("\n"),
          "utf-8",
        );
        const state = new StateManager(projectDir);
        await state.saveBookConfig("harbor", {
          id: "harbor",
          title: "Harbor",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 3000,
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z",
        });

        const output = run(["interact", "--json", "--book", "harbor", "--message", "/books"]);
        const data = JSON.parse(output);

        expect(data.session.activeBookId).toBe("harbor");
      } finally {
        await writeFile(envPath, originalEnv, "utf-8");
        await rm(join(projectDir, "books", "harbor"), { recursive: true, force: true });
        await rm(join(projectDir, ".inkos-session.json"), { force: true }).catch(() => {});
      }
    });
  });

  describe("inkos config set-model", () => {
    it("rejects raw API keys passed to --api-key-env", async () => {
      const { exitCode, stderr } = runStderr([
        "config",
        "set-model",
        "writer",
        "gpt-4-turbo",
        "--provider",
        "custom",
        "--base-url",
        "https://poloai.top/v1",
        "--api-key-env",
        "sk-test-direct-key",
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--api-key-env expects an environment variable name");

      const raw = await readFile(join(projectDir, "inkos.json"), "utf-8");
      const config = JSON.parse(raw);
      expect(config.modelOverrides).toBeUndefined();
    });
  });

  describe("inkos book list", () => {
    it("shows no books in empty project", () => {
      const output = run(["book", "list"]);
      expect(output).toContain("No books found");
    });

    it("returns empty array in JSON mode", () => {
      const output = run(["book", "list", "--json"]);
      const data = JSON.parse(output);
      expect(data.books).toEqual([]);
    });
  });

  describe("inkos book create", () => {
    it("removes stale incomplete book directories before retrying create", async () => {
      try {
        await stat(join(projectDir, "inkos.json"));
      } catch {
        run(["init"]);
      }
      const bookId = "stale-book";
      const staleDir = join(projectDir, "books", bookId);
      await mkdir(join(staleDir, "story"), { recursive: true });
      await writeFile(join(staleDir, "book.json"), JSON.stringify({
        id: bookId,
        title: "Stale Book",
      }, null, 2));
      await writeFile(join(staleDir, "story", "current_state.md"), "# stale\n", "utf-8");

      const { exitCode, stderr } = runStderr([
        "book",
        "create",
        "--title",
        "stale book",
      ], {
        env: failingLlmEnv,
      });

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Failed to create book");
      await expect(stat(staleDir)).rejects.toThrow();
    });
  });

  describe("inkos status", () => {
    it("shows project status with zero books", () => {
      const output = run(["status"]);
      expect(output).toContain("Books: 0");
    });

    it("returns JSON with --json flag", () => {
      const output = run(["status", "--json"]);
      const data = JSON.parse(output);
      expect(data.project).toBeDefined();
      expect(data.books).toEqual([]);
    });

    it("errors for nonexistent book", () => {
      const { exitCode, stderr } = runStderr(["status", "nonexistent"]);
      expect(exitCode).not.toBe(0);
    });

    it("shows English chapter counts in words for chapter rows", async () => {
      const bookDir = join(projectDir, "books", "english-status");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "english-status",
          title: "English Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          language: "en",
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "A Quiet Sky",
            status: "ready-for-review",
            wordCount: 7,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );

      const output = run(["status", "english-status", "--chapters"]);
      expect(output).toContain('Ch.1 "A Quiet Sky" | 7 words | ready-for-review');
      expect(output).not.toContain("7字");
    });

    it("shows degraded chapter counts and issues explicitly", async () => {
      const bookDir = join(projectDir, "books", "degraded-status");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "degraded-status",
          title: "Degraded Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Broken State",
            status: "state-degraded",
            wordCount: 1800,
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
            auditIssues: ["[warning] state validation still failed after retry"],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );

      const output = run(["status", "degraded-status", "--chapters"]);
      expect(output).toContain("Degraded: 1");
      expect(output).toContain('Ch.1 "Broken State" | 1800字 | state-degraded');
      expect(output).toContain("[warning] state validation still failed after retry");

      const json = JSON.parse(run(["status", "degraded-status", "--json"]));
      expect(json.books[0]?.degraded).toBe(1);
    }, 15_000);

    it("shows a migration hint for legacy pre-v0.6 books", async () => {
      const bookDir = join(projectDir, "books", "legacy-status-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-status-hint",
          title: "Legacy Status Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const output = run(["status", "legacy-status-hint"]);
      expect(output).toContain("legacy format");
    });

    it("reports persisted chapter file count instead of runtime progress when state runs ahead", async () => {
      const bookId = "ahead-status";
      const bookDir = join(projectDir, "books", bookId);
      const chaptersDir = join(bookDir, "chapters");
      const stateDir = join(bookDir, "story", "state");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Ahead Status Book",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(chaptersDir, "0001_First.md"), "# 第1章 First\n\nOnly persisted chapter.", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "First",
            status: "ready-for-review",
            wordCount: 42,
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:00:00.000Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );
      await Promise.all([
        writeFile(
          join(stateDir, "manifest.json"),
          JSON.stringify({
            schemaVersion: 2,
            language: "zh",
            lastAppliedChapter: 4,
            projectionVersion: 1,
            migrationWarnings: [],
          }, null, 2),
          "utf-8",
        ),
        writeFile(
          join(stateDir, "current_state.json"),
          JSON.stringify({
            chapter: 4,
            facts: [],
          }, null, 2),
          "utf-8",
        ),
        writeFile(join(stateDir, "hooks.json"), JSON.stringify({ hooks: [] }, null, 2), "utf-8"),
        writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({ rows: [] }, null, 2), "utf-8"),
      ]);

      const output = run(["status", bookId]);
      expect(output).toContain("Chapters: 1 / 10");
      expect(output).not.toContain("Chapters: 4 / 10");

      const json = JSON.parse(run(["status", bookId, "--json"]));
      expect(json.books[0]?.chapters).toBe(1);
    });
  });

  describe("inkos doctor", () => {
    it("checks environment health", () => {
      const { stdout } = runStderr(["doctor"]);
      expect(stdout).toContain("InkOS Doctor");
      expect(stdout).toContain("Node.js >= 20");
      expect(stdout).toContain("SQLite memory index");
      expect(stdout).toContain("inkos.json");
    });

    it("repairs missing node runtime pin files for old projects", async () => {
      await stat(join(projectDir, "inkos.json")).catch(() => {
        run(["init"]);
      });

      await rm(join(projectDir, ".nvmrc"), { force: true });
      await rm(join(projectDir, ".node-version"), { force: true });

      const before = runStderr(["doctor"]);
      expect(before.stdout).toContain("Node runtime pin files");
      expect(before.stdout).toContain(".nvmrc");
      expect(before.stdout).toContain(".node-version");

      const repaired = runStderr(["doctor", "--repair-node-runtime"]);
      expect(repaired.stdout).toContain("Node runtime pin files repaired");
      expect(repaired.stdout).toContain(".nvmrc");
      expect(repaired.stdout).toContain(".node-version");

      await expect(readFile(join(projectDir, ".nvmrc"), "utf-8")).resolves.toBe("22\n");
      await expect(readFile(join(projectDir, ".node-version"), "utf-8")).resolves.toBe("22\n");
    });

    it("treats localhost OpenAI-compatible endpoints as API-key optional", async () => {
      await stat(join(projectDir, "inkos.json")).catch(() => {
        run(["init"]);
      });
      const configPath = join(projectDir, "inkos.json");
      const envPath = join(projectDir, ".env");
      const originalConfig = await readFile(configPath, "utf-8");
      const originalEnv = await readFile(envPath, "utf-8");

      try {
        const config = JSON.parse(originalConfig);
        config.llm.provider = "openai";
        config.llm.baseUrl = "http://127.0.0.1:11434/v1";
        config.llm.model = "gpt-oss:20b";
        await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
        await writeFile(envPath, [
          "INKOS_LLM_PROVIDER=openai",
          "INKOS_LLM_BASE_URL=http://127.0.0.1:11434/v1",
          "INKOS_LLM_MODEL=gpt-oss:20b",
          "",
        ].join("\n"), "utf-8");

        const { stdout } = runStderr(["doctor"], {
          env: { INKOS_LLM_API_KEY: "" },
        });
        expect(stdout).toContain("LLM API Key");
        expect(stdout).toContain("Optional for local/self-hosted endpoint");
        expect(stdout).toContain("LLM Config");
        expect(stdout).not.toContain("No LLM config available");
      } finally {
        await writeFile(configPath, originalConfig, "utf-8");
        await writeFile(envPath, originalEnv, "utf-8");
      }
    });

    it("reports legacy books in the version migration check", async () => {
      const bookDir = join(projectDir, "books", "legacy-doctor-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-doctor-hint",
          title: "Legacy Doctor Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const { stdout } = runStderr(["doctor"]);
      expect(stdout).toContain("Version Migration");
      expect(stdout).toContain("legacy format");
    });
  });

  describe("inkos write", () => {
    it("warns before writing when the target book still uses legacy format", async () => {
      const bookDir = join(projectDir, "books", "legacy-write-hint");
      const storyDir = join(bookDir, "story");
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "legacy-write-hint",
          title: "Legacy Write Hint",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      await writeFile(join(storyDir, "current_state.md"), "# Current State\n\nLegacy state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n", "utf-8");

      const { stdout, stderr } = runStderr(["write", "next", "legacy-write-hint"], {
        env: failingLlmEnv,
      });
      expect(`${stdout}\n${stderr}`).toContain("legacy format");
    });

    it("fails rewrite before deleting chapters when the rollback snapshot is missing", async () => {
      const bookId = "rewrite-missing-snapshot";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Rewrite Missing Snapshot",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await writeFile(join(chaptersDir, "0001_ch1.md"), "# Chapter 1\n\nContent 1", "utf-8");
      await writeFile(join(chaptersDir, "0002_ch2.md"), "# Chapter 2\n\nContent 2", "utf-8");
      await writeFile(join(chaptersDir, "index.json"), JSON.stringify([
        { number: 1, title: "Ch1", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
        { number: 2, title: "Ch2", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
      ], null, 2), "utf-8");

      const { exitCode, stdout, stderr } = runStderr(["write", "rewrite", bookId, "2", "--force"], {
        env: failingLlmEnv,
      });
      expect(exitCode).not.toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("missing snapshot for chapter 1");
      await expect(readFile(join(chaptersDir, "0002_ch2.md"), "utf-8")).resolves.toContain("Content 2");
    });

    it("keeps next chapter at 2 after rewrite 2 trims later chapters, even if regeneration fails", async () => {
      const state = new StateManager(projectDir);
      const bookId = "rewrite-cli";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");
      const stateDir = join(storyDir, "state");

      await mkdir(chaptersDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Rewrite CLI",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await writeFile(join(chaptersDir, "0001_ch1.md"), "# Chapter 1\n\nContent 1", "utf-8");
      await writeFile(join(chaptersDir, "0002_ch2.md"), "# Chapter 2\n\nContent 2", "utf-8");
      await writeFile(join(chaptersDir, "0003_ch3.md"), "# Chapter 3\n\nContent 3", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          { number: 1, title: "Ch1", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
          { number: 2, title: "Ch2", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
          { number: 3, title: "Ch3", status: "approved", wordCount: 100, createdAt: "", updatedAt: "", auditIssues: [], lengthWarnings: [] },
        ], null, 2),
        "utf-8",
      );

      await state.snapshotState(bookId, 1);

      await writeFile(join(storyDir, "current_state.md"), "State at ch3", "utf-8");
      await writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 4,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8");
      await writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 3,
        facts: [],
      }, null, 2), "utf-8");

      const { exitCode, stdout, stderr } = runStderr(["write", "rewrite", bookId, "2", "--force"], {
        env: failingLlmEnv,
      });
      expect(exitCode).not.toBe(0);
      expect(`${stdout}\n${stderr}`).toContain("Regenerating chapter 2");
      expect(`${stdout}\n${stderr}`).not.toContain("resolved to 3");

      const next = await state.getNextChapterNumber(bookId);
      expect(next).toBe(2);
      await expect(readFile(join(storyDir, "current_state.md"), "utf-8")).resolves.toBe("State at ch1");
    });
  });

  describe("inkos analytics", () => {
    it("errors when no book exists", () => {
      const { exitCode } = runStderr(["analytics"]);
      expect(exitCode).not.toBe(0);
    });
  });

  describe("inkos review", () => {
    it("groups chapter goal, discipline checks, continuity notes, and traditional warnings in review list", async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const bookId = "review-grouped-cli";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const runtimeDir = join(storyDir, "runtime");
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(runtimeDir, { recursive: true });
      await mkdir(chaptersDir, { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Review Grouped CLI",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          language: "zh",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          {
            number: 4,
            title: "黑市门缝",
            status: "audit-failed",
            wordCount: 1888,
            createdAt: "2026-04-20T00:00:00.000Z",
            updatedAt: "2026-04-20T00:00:00.000Z",
            auditIssues: [
              "[warning] 章尾没有明显兑现预期的收尾钩子类型：reveal。",
              "[warning] 检测到资源/状态可能漏记：需要在当前状态中同步伤势、反噬或经脉受损。",
              "[warning] 连续性：角色位置矛盾",
              "[warning] 转折/惊讶标记词共3次（上限1次/1200字）",
            ],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );
      await writeFile(
        join(runtimeDir, "chapter-0004.intent.md"),
        [
          "# Chapter Intent",
          "",
          "## Goal",
          "继续黑市入口线。",
          "",
          "## Chapter Goal",
          "- mainConflict: 秦枭必须在暴露前挤进黑市入口。",
          "- protagonistGoal: 先骗过守门人，再找到黑市接头点。",
          "- activeCharacters: 秦枭, 守门人",
          "- foreshadowToTouch: black-market-key",
          "- payoffToDeliver: 拿到进入黑市的钥匙情报",
          "- endingHookType: reveal",
          "- nextChapterPull: 黑市入口背后的人会立刻盯上他。",
          "",
          "## Conflicts",
          "- outline_vs_recent_state: prefer latest state continuity anchor",
          "- hook_debt_throttle: advance an existing hook before opening parallel debt",
          "",
        ].join("\n"),
        "utf-8",
      );

      const output = run(["review", "list", bookId]);

      expect(output).toContain('Ch.4 "黑市门缝" | 1888字 | audit-failed');
      expect(output).toContain("Chapter Goal:");
      expect(output).toContain("mainConflict: 秦枭必须在暴露前挤进黑市入口。");
      expect(output).toContain("endingHookType: reveal");
      expect(output).toContain("Discipline Checks:");
      expect(output).toContain("章尾没有明显兑现预期的收尾钩子类型：reveal。");
      expect(output).toContain("检测到资源/状态可能漏记");
      expect(output).toContain("Continuity / Planning Notes:");
      expect(output).toContain("outline_vs_recent_state: prefer latest state continuity anchor");
      expect(output).toContain("连续性：角色位置矛盾");
      expect(output).toContain("Traditional Warnings:");
      expect(output).toContain("转折/惊讶标记词共3次");
    });

    it("preserves the original chapter snapshot when approving review", async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const state = new StateManager(projectDir);
      const bookId = "review-approve-cli";
      const bookDir = join(projectDir, "books", bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(chaptersDir, { recursive: true });
      await mkdir(storyDir, { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: bookId,
          title: "Review Approve CLI",
          platform: "other",
          genre: "other",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2200,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await writeFile(join(chaptersDir, "0001_ch1.md"), "# Chapter 1\n\nContent 1", "utf-8");
      await writeFile(
        join(chaptersDir, "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Ch1",
            status: "ready-for-review",
            wordCount: 100,
            createdAt: "",
            updatedAt: "",
            auditIssues: [],
            lengthWarnings: [],
          },
        ], null, 2),
        "utf-8",
      );

      await state.snapshotState(bookId, 1);

      await writeFile(join(storyDir, "current_state.md"), "State at ch3", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch3", "utf-8");

      const output = run(["review", "approve", bookId, "1"]);
      expect(output).toContain("Chapter 1 approved");

      await expect(
        readFile(join(storyDir, "snapshots", "1", "current_state.md"), "utf-8"),
      ).resolves.toBe("State at ch1");
      await expect(
        readFile(join(storyDir, "snapshots", "1", "pending_hooks.md"), "utf-8"),
      ).resolves.toBe("Hooks at ch1");

      const index = await state.loadChapterIndex(bookId);
      expect(index[0]?.status).toBe("approved");
    });
  });

  describe("inkos plan/compose", () => {
    beforeAll(async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const bookDir = join(projectDir, "books", "cli-book");
      const storyDir = join(bookDir, "story");
      await mkdir(join(storyDir, "runtime"), { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "cli-book",
          title: "CLI Book",
          platform: "tomato",
          genre: "other",
          status: "active",
          targetChapters: 20,
          chapterWordCount: 3000,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8").catch(async () => {
        await mkdir(join(bookDir, "chapters"), { recursive: true });
        await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");
      });

      await Promise.all([
        writeFile(join(storyDir, "author_intent.md"), "# Author Intent\n\nKeep the story centered on the mentor conflict.\n", "utf-8"),
        writeFile(join(storyDir, "current_focus.md"), "# Current Focus\n\nBring focus back to the mentor conflict.\n", "utf-8"),
        writeFile(join(storyDir, "story_bible.md"), "# Story Bible\n\n- The jade seal cannot be destroyed.\n", "utf-8"),
        writeFile(join(storyDir, "volume_outline.md"), "# Volume Outline\n\n## Chapter 1\nTrack the merchant guild trail.\n", "utf-8"),
        writeFile(join(storyDir, "book_rules.md"), "---\nprohibitions:\n  - Do not reveal the mastermind\n---\n\n# Book Rules\n", "utf-8"),
        writeFile(join(storyDir, "current_state.md"), "# Current State\n\n- Lin Yue still hides the broken oath token.\n", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n\n- Why the mentor vanished after the trial.\n", "utf-8"),
      ]);
    });

    it("runs plan chapter and returns the generated intent path in JSON mode", async () => {
      const output = run(["plan", "chapter", "cli-book", "--json", "--context", "Ignore the guild chase and focus on the mentor conflict."]);
      const data = JSON.parse(output);

      expect(data.bookId).toBe("cli-book");
      expect(data.chapterNumber).toBe(1);
      expect(data.intentPath).toContain("story/runtime/chapter-0001.intent.md");
      await expect(stat(join(projectDir, "books", "cli-book", data.intentPath))).resolves.toBeTruthy();
    });

    it("runs compose chapter and returns runtime artifact paths in JSON mode", async () => {
      const output = run(["compose", "chapter", "cli-book", "--json"]);
      const data = JSON.parse(output);

      expect(data.bookId).toBe("cli-book");
      expect(data.chapterNumber).toBe(1);
      expect(data.contextPath).toContain("story/runtime/chapter-0001.context.json");
      expect(data.ruleStackPath).toContain("story/runtime/chapter-0001.rule-stack.yaml");
      expect(data.tracePath).toContain("story/runtime/chapter-0001.trace.json");

      await expect(stat(join(projectDir, "books", "cli-book", data.contextPath))).resolves.toBeTruthy();
      await expect(stat(join(projectDir, "books", "cli-book", data.ruleStackPath))).resolves.toBeTruthy();
      await expect(stat(join(projectDir, "books", "cli-book", data.tracePath))).resolves.toBeTruthy();
    });

    it("reuses the planned intent when compose runs without a new context", async () => {
      const plannedGoal = "Ignore the guild chase and focus on the mentor conflict.";
      run(["plan", "chapter", "cli-book", "--context", plannedGoal]);

      const output = run(["compose", "chapter", "cli-book", "--json"]);
      const data = JSON.parse(output);
      const intentMarkdown = await readFile(join(projectDir, "books", "cli-book", data.intentPath), "utf-8");

      expect(data.goal).toBe(plannedGoal);
      expect(intentMarkdown).toContain(plannedGoal);
    });
  });

  describe("inkos export", () => {
    beforeAll(async () => {
      const configPath = join(projectDir, "inkos.json");
      const initialized = await stat(configPath).then(() => true).catch(() => false);
      if (!initialized) run(["init"]);

      const bookDir = join(projectDir, "books", "export-book");
      await mkdir(join(bookDir, "chapters"), { recursive: true });

      await writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "export-book",
          title: "Export Book",
          platform: "tomato",
          genre: "xuanhuan",
          status: "active",
          targetChapters: 10,
          chapterWordCount: 2000,
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "index.json"),
        JSON.stringify([
          {
            number: 1,
            title: "Dawn Ledger",
            status: "ready-for-review",
            wordCount: 1200,
            createdAt: "2026-03-23T00:00:00.000Z",
            updatedAt: "2026-03-23T00:00:00.000Z",
            auditIssues: [],
          },
        ], null, 2),
        "utf-8",
      );
      await writeFile(
        join(bookDir, "chapters", "0001_Dawn_Ledger.md"),
        "# 第1章 Dawn Ledger\n\n正文。\n",
        "utf-8",
      );
    });

    it("creates missing parent directories for custom output paths", async () => {
      const outputPath = join(projectDir, "exports", "nested", "book.md");
      const output = run(["export", "export-book", "--format", "md", "--output", outputPath, "--json"]);
      const data = JSON.parse(output);

      expect(data.outputPath).toBe(outputPath);
      await expect(stat(outputPath)).resolves.toBeTruthy();
      await expect(readFile(outputPath, "utf-8")).resolves.toContain("# Export Book");
    });
  });
});
