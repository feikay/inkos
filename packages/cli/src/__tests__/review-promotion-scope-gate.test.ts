import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateCandidateAndMaybePromoteReviewedFinal } from "../commands/review.js";

describe("scope FAIL does not overwrite reviewed final", () => {
  let tmpDir: string;
  let bookDir: string;
  let candidateFile: string;
  let originalFile: string;
  let finalPath: string;

  beforeAll(async () => {
    // Create temp book directory
    tmpDir = join(tmpdir(), `inkos-test-${Date.now()}`);
    bookDir = join(tmpDir, "my-novel", "books", "test-book");
    await mkdir(bookDir, { recursive: true });

    // Create story/runtime/chapter-intents/0001.md with an unresolved problem
    const intentDir = join(bookDir, "story", "runtime", "chapter-intents");
    await mkdir(intentDir, { recursive: true });
    await writeFile(
      join(intentDir, "0001.md"),
      [
        "## 9. 下一章钩子",
        "- 未解决问题：",
        "  1. 父亲会不会把钱给主角？",
        "",
      ].join("\n"),
      "utf-8",
    );

    // Create empty pending_hooks.md
    const hooksDir = join(bookDir, "story", "runtime");
    await mkdir(hooksDir, { recursive: true });
    await writeFile(join(bookDir, "story", "pending_hooks.md"), "", "utf-8");

    // Create chapters-reviewed/0001_final.md with OLD FINAL
    const reviewedDir = join(bookDir, "chapters-reviewed");
    await mkdir(reviewedDir, { recursive: true });
    finalPath = join(reviewedDir, "0001_final.md");
    await writeFile(finalPath, "OLD FINAL", "utf-8");

    // Create candidate with scope-violating content
    candidateFile = join(tmpDir, "candidate.md");
    await writeFile(
      candidateFile,
      '父亲说："钱给你了，三天后还我。"',
      "utf-8",
    );

    // Create original (short baseline)
    originalFile = join(tmpDir, "original.md");
    await writeFile(originalFile, "父亲站在客厅里。", "utf-8");
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("scope FAIL does not overwrite chapters-reviewed/0001_final.md", async () => {
    const result = await evaluateCandidateAndMaybePromoteReviewedFinal({
      bookDir,
      chapter: 1,
      candidateFile,
      originalFile,
      language: "zh",
    });

    // Promotion should be blocked
    expect(result.promoted).toBe(false);
    expect(result.finalCandidateFile).toBe("");
    expect(result.scopeGate.status).toBe("FAIL");
    // finalFile should be the candidate file (not reviewed final)
    expect(result.finalFile).toBe(candidateFile);

    // OLD FINAL must still be in place
    const content = await readFile(finalPath, "utf-8");
    expect(content).toBe("OLD FINAL");
  });

  it("scope PASS allows promotion to reviewed final", async () => {
    // Create a clean candidate that should pass scope
    const passCandidate = join(tmpDir, "candidate-pass.md");
    await writeFile(
      passCandidate,
      "宋言站在门口，看着父亲手里的存折。他没有说话。",
      "utf-8",
    );

    const result = await evaluateCandidateAndMaybePromoteReviewedFinal({
      bookDir,
      chapter: 1,
      candidateFile: passCandidate,
      originalFile,
      language: "zh",
    });

    expect(result.promoted).toBe(true);
    expect(result.finalCandidateFile).toContain("chapters-reviewed");
    expect(result.scopeGate.status).not.toBe("FAIL");
  });
});
