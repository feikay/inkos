import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPolishPrompt,
  cleanLLMText,
  loadBaseBookInfo,
  parseArgs,
  resolveOutputFile,
  validatePolishedText,
  writePolishedBookInfo,
} from "./book-info-polisher.mjs";

test("parseArgs defaults to general and validates type", () => {
  assert.deepEqual(parseArgs(["葬渊魔经"]), {
    book: "葬渊魔经",
    type: "general",
    backup: false,
    model: "",
    apiFormat: "",
  });
  assert.deepEqual(parseArgs(["葬渊魔经", "--type", "fanqie", "--backup", "--model", "gpt-test", "--api-format", "chat"]), {
    book: "葬渊魔经",
    type: "fanqie",
    backup: true,
    model: "gpt-test",
    apiFormat: "chat",
  });
  assert.throws(() => parseArgs(["葬渊魔经", "--type", "bad"]), /只支持/u);
});

test("resolveOutputFile maps each type to the expected file", () => {
  const root = "/repo";
  assert.equal(resolveOutputFile(root, "Book", "general"), path.join(root, "publish", "Book", "book-info-polished.txt"));
  assert.equal(resolveOutputFile(root, "Book", "fanqie"), path.join(root, "publish", "Book", "book-info-fanqie.txt"));
  assert.equal(resolveOutputFile(root, "Book", "promo"), path.join(root, "publish", "Book", "book-info-promo.txt"));
  assert.equal(resolveOutputFile(root, "Book", "shortvideo"), path.join(root, "publish", "Book", "book-info-shortvideo.txt"));
});

test("loadBaseBookInfo reads publish book-info and explains missing input", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkos-polish-"));
  const dir = path.join(root, "publish", "Book");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "book-info.txt"), "资料卡", "utf8");

  assert.equal(loadBaseBookInfo({ root, book: "Book" }).text, "资料卡");
  assert.throws(() => loadBaseBookInfo({ root, book: "Missing" }), /请先执行/u);
});

test("buildPolishPrompt includes type-specific constraints", () => {
  const fanqie = buildPolishPrompt("事实源", "fanqie");
  assert.match(fanqie, /番茄发布/u);
  assert.match(fanqie, /不能编造/u);
  assert.match(fanqie, /事实源/u);

  const promo = buildPolishPrompt("事实源", "promo");
  assert.match(promo, /推广标题/u);

  const shortvideo = buildPolishPrompt("事实源", "shortvideo");
  assert.match(shortvideo, /短视频口播脚本/u);
});

test("clean and validate reject unsafe LLM output", () => {
  assert.equal(cleanLLMText("```txt\n内容\n```"), "内容");
  assert.throws(() => validatePolishedText("含有 undefined"), /取消写入/u);
  assert.throws(() => validatePolishedText("作为一个 AI，我认为"), /AI 自述/u);
  assert.throws(() => validatePolishedText("| A | B |"), /Markdown 表格/u);
  assert.throws(() => validatePolishedText("第三卷：新卷", "第一卷：旧卷"), /第三卷/u);
  assert.throws(() => validatePolishedText("重生系统文", "玄幻"), /高风险词/u);
});

test("writePolishedBookInfo overwrites atomically and can backup old file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkos-polish-write-"));
  const file = path.join(root, "publish", "Book", "book-info-polished.txt");
  writePolishedBookInfo(file, "旧内容");
  const written = writePolishedBookInfo(file, "新内容", { backup: true });

  assert.equal(fs.readFileSync(file, "utf8"), "新内容\n");
  assert.ok(written.backupFile);
  assert.equal(fs.readFileSync(written.backupFile, "utf8"), "旧内容\n");
});
