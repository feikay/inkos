import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBookInfoText, writeBookInfoFile } from "./book-info.mjs";

function makeBookDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inkos-book-info-"));
}

test("missing setting files still generate a complete book-info card", () => {
  const bookDir = makeBookDir();
  fs.writeFileSync(path.join(bookDir, "book.json"), JSON.stringify({ title: "测试书", platform: "tomato" }), "utf8");

  const text = buildBookInfoText({
    book: "测试书",
    bookDir,
    exportMeta: { title: "发布名", generatedAt: "2026-05-12 12:00:00" },
    chapters: [{ no: 2, chars: 1000 }],
  });

  assert.match(text, /《发布名》作品资料卡/u);
  assert.match(text, /一、基础信息/u);
  assert.match(text, /十二、故事灵感/u);
  assert.match(text, /当前导出章节：第2章/u);
  assert.match(text, /待补充/u);
});

test("characters, world and outline data are written when present", () => {
  const bookDir = makeBookDir();
  fs.writeFileSync(path.join(bookDir, "book.json"), JSON.stringify({
    title: "测试书",
    genre: "玄幻",
    platform: "tomato",
    tags: ["修仙", "求生"],
    description: "主角以规则破局。",
  }), "utf8");
  fs.writeFileSync(path.join(bookDir, "characters.json"), JSON.stringify({
    characters: [
      { name: "陆沉", role: "protagonist", identity: "流放少年", personality: ["冷静", "谨慎"] },
      { name: "沈青", role: "ally", identity: "药师", relationship: "盟友", function: "提供线索" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(bookDir, "world.json"), JSON.stringify({
    world: { background: "九州裂土", rules: ["灵气有毒", "契约反噬"] },
    powerSystem: { levels: ["淬体", "燃血"], source: "灵气与气血" },
  }), "utf8");
  fs.writeFileSync(path.join(bookDir, "outline.json"), JSON.stringify({
    outline: { opening: "尸坑求生", earlyGoal: "查明灭门真相" },
    volumes: [{ name: "黑谷卷", goal: "活着离开", enemy: "赵虎", highlights: ["反杀", "破局"], hook: "残卷发烫" }],
  }), "utf8");

  const text = buildBookInfoText({
    book: "测试书",
    bookDir,
    exportMeta: { generatedAt: "2026-05-12 12:00:00" },
    chapters: [{ no: 1, chars: 1200 }, { no: 2, chars: 1300 }],
  });

  assert.match(text, /主角姓名：陆沉/u);
  assert.match(text, /配角姓名：沈青/u);
  assert.match(text, /世界背景：九州裂土/u);
  assert.match(text, /境界层级：淬体、燃血/u);
  assert.match(text, /开局阶段：尸坑求生/u);
  assert.match(text, /卷名：黑谷卷/u);
});

test("undefined null object and array values never render as object Object", () => {
  const bookDir = makeBookDir();
  fs.writeFileSync(path.join(bookDir, "book.json"), JSON.stringify({
    title: "测试书",
    description: { premise: "规则吃人", hook: null },
    tags: [{ name: "求生", rank: 1 }],
  }), "utf8");

  const text = buildBookInfoText({
    book: "测试书",
    bookDir,
    exportMeta: { generatedAt: "2026-05-12 12:00:00" },
    chapters: [],
  });

  assert.doesNotMatch(text, /\[object Object\]/u);
  assert.match(text, /premise：规则吃人/u);
  assert.match(text, /name：求生/u);
});

test("writeBookInfoFile writes primary and alternate targets without throwing", () => {
  const bookDir = makeBookDir();
  const publishDir = path.join(bookDir, "publish", "fanqie");
  const alternatePublishDir = path.join(bookDir, "publish");
  fs.writeFileSync(path.join(bookDir, "book.json"), JSON.stringify({ title: "测试书" }), "utf8");

  const result = writeBookInfoFile({
    book: "测试书",
    bookDir,
    publishDir,
    alternatePublishDir,
    exportMeta: { generatedAt: "2026-05-12 12:00:00" },
    chapters: [],
  });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(publishDir, "book-info.txt")), true);
  assert.equal(fs.existsSync(path.join(alternatePublishDir, "book-info.txt")), true);
});
