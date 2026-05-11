#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptFile), "..");
const sourceRoot = path.join(root, "skills");
const mirrorRoot = path.join(root, ".skills");
const checkOnly = process.argv.includes("--check");

const GENERATED_NOTE = "<!-- Generated mirror. Edit `skills/<name>/SKILL.md` instead. -->";

function skillNameFromPath(file) {
  return path.basename(path.dirname(file));
}

function rel(file) {
  return path.relative(root, file) || ".";
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function stripGeneratedNote(text) {
  return text
    .replace(/<!-- Generated mirror\. Edit `skills\/[^`]+\/SKILL\.md` instead\. -->\n\n?/u, "")
    .replace(/<!-- Generated mirror\. Edit `skills\/<name>\/SKILL\.md` instead\. -->\n\n?/u, "");
}

function insertGeneratedNote(text, skillName) {
  const clean = ensureTrailingNewline(stripGeneratedNote(text));
  const note = GENERATED_NOTE.replace("<name>", skillName);
  if (!clean.startsWith("---\n")) return `${note}\n\n${clean}`;

  const end = clean.indexOf("\n---\n", 4);
  if (end === -1) return `${note}\n\n${clean}`;

  const frontmatterEnd = end + "\n---\n".length;
  return `${clean.slice(0, frontmatterEnd)}\n${note}\n\n${clean.slice(frontmatterEnd)}`;
}

function listSkillFiles() {
  if (!fs.existsSync(sourceRoot)) return [];
  return fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((ent) => ent.isDirectory())
    .map((ent) => path.join(sourceRoot, ent.name, "SKILL.md"))
    .filter((file) => fs.existsSync(file));
}

function syncSkill(sourceFile) {
  const skillName = skillNameFromPath(sourceFile);
  const mirrorFile = path.join(mirrorRoot, skillName, "SKILL.md");
  const expected = insertGeneratedNote(readText(sourceFile), skillName);
  const actual = fs.existsSync(mirrorFile) ? readText(mirrorFile) : null;

  if (actual === expected) {
    return { status: "ok", sourceFile, mirrorFile };
  }

  if (checkOnly) {
    return { status: "out-of-sync", sourceFile, mirrorFile };
  }

  fs.mkdirSync(path.dirname(mirrorFile), { recursive: true });
  fs.writeFileSync(mirrorFile, expected, "utf8");
  return { status: actual === null ? "created" : "updated", sourceFile, mirrorFile };
}

const results = listSkillFiles().map(syncSkill);
const outOfSync = results.filter((item) => item.status === "out-of-sync");

for (const item of results) {
  const arrow = `${rel(item.sourceFile)} -> ${rel(item.mirrorFile)}`;
  if (item.status === "ok") console.log(`ok: ${arrow}`);
  else if (item.status === "out-of-sync") console.log(`out-of-sync: ${arrow}`);
  else console.log(`${item.status}: ${arrow}`);
}

if (!results.length) {
  console.log("No skill directories found under skills/*/SKILL.md");
}

if (outOfSync.length) {
  console.error(`\n${outOfSync.length} skill mirror(s) are out of sync. Run: npm run skills:sync`);
  process.exit(1);
}
