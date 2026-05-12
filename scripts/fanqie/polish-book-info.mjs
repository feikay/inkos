#!/usr/bin/env node
import {
  buildPolishPrompt,
  callLLM,
  cleanLLMText,
  loadBaseBookInfo,
  parseArgs,
  relativePath,
  resolveOutputFile,
  validatePolishedText,
  writePolishedBookInfo,
} from "./lib/book-info-polisher.mjs";

const root = process.cwd();

async function main() {
  const options = parseArgs();
  const outputFile = resolveOutputFile(root, options.book, options.type);

  console.log(`Book info polish started: ${options.book}`);
  console.log(`Type: ${options.type}`);

  const base = loadBaseBookInfo({ root, book: options.book });
  console.log(`Loaded: ${relativePath(root, base.file)}`);

  const prompt = buildPolishPrompt(base.text, options.type);
  console.log("Calling LLM...");

  const raw = await callLLM(prompt, {
    root,
    type: options.type,
    model: options.model,
    apiFormat: options.apiFormat,
  });
  const polished = cleanLLMText(raw);
  validatePolishedText(polished, base.text);

  const written = writePolishedBookInfo(outputFile, polished, { backup: options.backup });
  if (written.backupFile) {
    console.log(`Backup: ${relativePath(root, written.backupFile)}`);
  }
  console.log(`${written.backupFile ? "Updated" : "Generated"}: ${relativePath(root, written.file)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
