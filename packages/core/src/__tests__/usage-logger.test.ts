import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  logLlmError,
  logLlmStart,
  logLlmSuccess,
  normalizeProviderUsage,
  withLlmUsageLogging,
} from "../llm/usageLogger.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "inkos-usage-"));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function readRecords(root = tempRoot): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(root, "logs", "llm-usage.jsonl"), "utf-8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("LLM usage logger", () => {
  it("normalizes OpenAI usage fields", async () => {
    const handle = logLlmStart({ command: "write next", stage: "writer", provider: "openai", model: "gpt-test", projectRoot: tempRoot });
    await logLlmSuccess(handle, normalizeProviderUsage({
      prompt_tokens: 12,
      completion_tokens: 7,
      total_tokens: 19,
    }));

    const [record] = await readRecords();
    expect(record).toMatchObject({
      command: "write next",
      stage: "writer",
      provider: "openai",
      model: "gpt-test",
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
      status: "success",
    });
  });

  it("normalizes Anthropic usage fields and derives total", async () => {
    const handle = logLlmStart({ stage: "continuity", provider: "anthropic", model: "claude-test", projectRoot: tempRoot });
    await logLlmSuccess(handle, normalizeProviderUsage({
      input_tokens: 8,
      output_tokens: 5,
    }));

    const [record] = await readRecords();
    expect(record).toMatchObject({
      stage: "continuity",
      provider: "anthropic",
      inputTokens: 8,
      outputTokens: 5,
      totalTokens: 13,
      status: "success",
    });
  });

  it("writes unknown tokens when provider usage is absent", async () => {
    const handle = logLlmStart({ stage: "unknown", provider: "openai", model: "custom-model", projectRoot: tempRoot });
    await logLlmSuccess(handle, normalizeProviderUsage(undefined));

    const [record] = await readRecords();
    expect(record).toMatchObject({
      inputTokens: "unknown",
      outputTokens: "unknown",
      totalTokens: "unknown",
      status: "success",
    });
  });

  it("records errors and rethrows the original failure", async () => {
    const original = new Error("Rate limit exceeded");

    await expect(withLlmUsageLogging(
      { stage: "writer", provider: "openai", model: "gpt-test", projectRoot: tempRoot },
      async () => {
        throw original;
      },
      () => undefined,
    )).rejects.toBe(original);

    const [record] = await readRecords();
    expect(record).toMatchObject({
      stage: "writer",
      status: "error",
      errorMessage: "Rate limit exceeded",
      inputTokens: "unknown",
    });
  });

  it("warns but does not fail when JSONL write fails", async () => {
    const fileRoot = join(tempRoot, "not-a-directory");
    await writeFile(fileRoot, "block logs dir", "utf-8");
    const handle = logLlmStart({ stage: "writer", provider: "openai", model: "gpt-test", projectRoot: fileRoot });

    await expect(logLlmSuccess(handle, { inputTokens: 1, outputTokens: 2, totalTokens: 3 })).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("usage log write failed"));
  });

  it("logLlmError writes an error record", async () => {
    const handle = logLlmStart({ stage: "publish-ready", provider: "openai", model: "gpt-test", projectRoot: tempRoot });
    await logLlmError(handle, new Error("boom"));

    const [record] = await readRecords();
    expect(record).toMatchObject({
      stage: "publish-ready",
      status: "error",
      errorMessage: "boom",
    });
  });
});
