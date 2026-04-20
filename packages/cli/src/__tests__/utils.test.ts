import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLegacyMigrationHint, usesLegacyBookFormat } from "../utils.js";

describe("legacy migration hints", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-cli-utils-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("does not flag current-format books that have schemaVersion=2 but no story/state directory yet", async () => {
    const bookDir = join(root, "books", "current-book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({
      schemaVersion: 2,
      id: "current-book",
      title: "Current Book",
      platform: "other",
      genre: "other",
      status: "outlining",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      webnovelTemplate: "xuanhuan",
    }, null, 2), "utf-8");
    await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");

    await expect(usesLegacyBookFormat(bookDir)).resolves.toBe(false);
    await expect(getLegacyMigrationHint(root, "current-book")).resolves.toBeNull();
  });

  it("still flags old books without schemaVersion when structured state is missing", async () => {
    const bookDir = join(root, "books", "legacy-book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({
      id: "legacy-book",
      title: "Legacy Book",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    }, null, 2), "utf-8");
    await writeFile(join(bookDir, "chapters", "index.json"), "[]", "utf-8");

    await expect(usesLegacyBookFormat(bookDir)).resolves.toBe(true);
    await expect(getLegacyMigrationHint(root, "legacy-book")).resolves.toContain("legacy format");
  });
});
