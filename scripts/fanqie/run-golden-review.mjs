import { loadConfig, createClient, findProjectRoot } from "../../packages/cli/dist/utils.js";
import { Golden3ChapterAgent, writeGolden3ChapterReportFiles } from "../../packages/core/dist/agents/golden-3-chapter.js";
import fs from "node:fs/promises";
import path from "node:path";

async function run() {
  const root = findProjectRoot();
  const config = await loadConfig({ requireApiKey: true, projectRoot: root });
  const client = createClient(config);
  const model = config.llm.model;
  
  const argv = process.argv.slice(2);
  const bookId = argv[0] || "我在cbd当保安-偷听商业机密那些年";
  const bookDir = root.endsWith("my-novel")
    ? path.join(root, "books", bookId)
    : path.join(root, "my-novel", "books", bookId);
  const chaptersDir = path.join(bookDir, "chapters");
  
  // Read chapter contents (prefer chapters-reviewed final candidates, fallback to chapters raw)
  const readChapterContent = async (chNum) => {
    const padded = String(chNum).padStart(4, "0");
    const reviewedFile = path.join(bookDir, "chapters-reviewed", `${padded}_final.md`);
    try {
      const raw = await fs.readFile(reviewedFile, "utf-8");
      const headingEnd = raw.indexOf("\n\n");
      return headingEnd >= 0 ? raw.slice(headingEnd + 2).trim() : raw.trim();
    } catch {
      const files = await fs.readdir(chaptersDir);
      const file = files.find((f) => f.startsWith(padded) && f.endsWith(".md"));
      if (!file) return "";
      const raw = await fs.readFile(path.join(chaptersDir, file), "utf-8");
      const headingEnd = raw.indexOf("\n\n");
      return headingEnd >= 0 ? raw.slice(headingEnd + 2).trim() : raw.trim();
    }
  };

  const ch1Content = await readChapterContent(1);
  const ch2Content = await readChapterContent(2);
  const ch3Content = await readChapterContent(3);
  
  let first10Plan;
  try {
    const planPath = path.join(bookDir, "story", "first_10_chapter_plan.md");
    first10Plan = await fs.readFile(planPath, "utf-8");
  } catch {}

  console.log(`Ch1 chars: ${ch1Content.length}, Ch2 chars: ${ch2Content.length}, Ch3 chars: ${ch3Content.length}`);

  const reviewer = new Golden3ChapterAgent({
    client,
    model,
    projectRoot: root,
    bookId,
  });

  console.log("Calling Golden 3-chapter Agent for complete audit...");

  const report = await reviewer.review({
    chapter1Content: ch1Content,
    chapter2Content: ch2Content,
    chapter3Content: ch3Content,
    first10ChapterPlan: first10Plan,
  });

  console.log(`Golden 3-chapter status: ${report.status}, score: ${report.score}`);
  console.log(`Summary: ${report.summary}`);

  const reportDir = path.join(bookDir, "reviews", "golden-3-chapter");
  const jsonPath = path.join(reportDir, "golden-3-chapter.report.json");
  const markdownPath = path.join(reportDir, "golden-3-chapter.report.md");

  await writeGolden3ChapterReportFiles({ report, jsonPath, markdownPath });
  console.log("Successfully wrote Golden 3-chapter reports to reviews/golden-3-chapter/!");
}

run().catch(console.error);
