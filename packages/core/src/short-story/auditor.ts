import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  SHORT_STORY_MAX_CHAPTER_WORDS,
  SHORT_STORY_MAX_WORDS,
  SHORT_STORY_MIN_CHAPTER_WORDS,
  SHORT_STORY_MIN_WORDS,
  SHORT_STORY_RECOMMENDED_MAX_CHAPTER_WORDS,
  SHORT_STORY_RECOMMENDED_MIN_CHAPTER_WORDS,
} from "./chapter-plan.js";
import type {
  ShortStoryAuditChapter,
  ShortStoryAuditIssue,
  ShortStoryAuditReport,
} from "./schema.js";
import { countChapterLength } from "../utils/length-metrics.js";

export const SHORT_STORY_FORBIDDEN_CONTINUATION_PHRASES = [
  "未完待续",
  "第二卷",
  "下部再见",
  "敬请期待",
];

export interface AuditShortStoryBookInput {
  readonly bookName: string;
  readonly bookDir: string;
  readonly countingMode?: "zh_chars" | "en_words";
}

export async function auditShortStoryBook(
  input: AuditShortStoryBookInput,
): Promise<ShortStoryAuditReport> {
  const chapters = await loadShortStoryChapters(input.bookDir, input.countingMode ?? "zh_chars");
  const issues: ShortStoryAuditIssue[] = [];
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  if (totalWords < SHORT_STORY_MIN_WORDS || totalWords > SHORT_STORY_MAX_WORDS) {
    issues.push({
      severity: "error",
      code: "book_word_count_out_of_range",
      message: `全书字数 ${totalWords} 不在短故事范围 ${SHORT_STORY_MIN_WORDS}-${SHORT_STORY_MAX_WORDS} 内。`,
      actualWords: totalWords,
      expectedRange: [SHORT_STORY_MIN_WORDS, SHORT_STORY_MAX_WORDS],
    });
  }

  for (const chapter of chapters) {
    if (chapter.empty) {
      issues.push({
        severity: "error",
        code: "empty_chapter",
        message: `第 ${chapter.chapterNumber} 章为空章节。`,
        chapterNumber: chapter.chapterNumber,
        actualWords: chapter.wordCount,
      });
      continue;
    }

    if (
      chapter.wordCount < SHORT_STORY_MIN_CHAPTER_WORDS ||
      chapter.wordCount > SHORT_STORY_MAX_CHAPTER_WORDS
    ) {
      issues.push({
        severity: "error",
        code: "chapter_word_count_out_of_range",
        message: `第 ${chapter.chapterNumber} 章字数 ${chapter.wordCount} 超出合法范围 ${SHORT_STORY_MIN_CHAPTER_WORDS}-${SHORT_STORY_MAX_CHAPTER_WORDS}。`,
        chapterNumber: chapter.chapterNumber,
        actualWords: chapter.wordCount,
        expectedRange: [SHORT_STORY_MIN_CHAPTER_WORDS, SHORT_STORY_MAX_CHAPTER_WORDS],
      });
    } else if (
      chapter.wordCount < SHORT_STORY_RECOMMENDED_MIN_CHAPTER_WORDS ||
      chapter.wordCount > SHORT_STORY_RECOMMENDED_MAX_CHAPTER_WORDS
    ) {
      issues.push({
        severity: "warning",
        code: "chapter_word_count_outside_recommended_range",
        message: `第 ${chapter.chapterNumber} 章字数 ${chapter.wordCount} 偏离推荐范围 ${SHORT_STORY_RECOMMENDED_MIN_CHAPTER_WORDS}-${SHORT_STORY_RECOMMENDED_MAX_CHAPTER_WORDS}。`,
        chapterNumber: chapter.chapterNumber,
        actualWords: chapter.wordCount,
        expectedRange: [
          SHORT_STORY_RECOMMENDED_MIN_CHAPTER_WORDS,
          SHORT_STORY_RECOMMENDED_MAX_CHAPTER_WORDS,
        ],
      });
    }
  }

  const forbiddenIssues = await findForbiddenContinuationPhrases(input.bookDir);
  issues.push(...forbiddenIssues);

  return {
    passed: issues.every((issue) => issue.severity !== "error"),
    bookName: input.bookName,
    totalWords,
    chapterCount: chapters.length,
    chapters,
    issues,
  };
}

async function loadShortStoryChapters(
  bookDir: string,
  countingMode: "zh_chars" | "en_words",
): Promise<ReadonlyArray<ShortStoryAuditChapter>> {
  const chaptersDir = join(bookDir, "chapters");
  const files = await readdir(chaptersDir).catch(() => []);
  const chapterFiles = files
    .filter((file) => /^\d+_.*\.md$/.test(file))
    .sort((a, b) => a.localeCompare(b, "en"));

  const chapters: ShortStoryAuditChapter[] = [];
  for (const file of chapterFiles) {
    const chapterNumber = Number.parseInt(file.match(/^(\d+)_/)?.[1] ?? "0", 10);
    const path = join(chaptersDir, file);
    const content = await readFile(path, "utf-8");
    const wordCount = countChapterLength(content, countingMode);
    chapters.push({
      chapterNumber,
      title: titleFromChapterFile(file),
      path,
      wordCount,
      empty: wordCount === 0,
    });
  }

  return chapters;
}

async function findForbiddenContinuationPhrases(
  bookDir: string,
): Promise<ReadonlyArray<ShortStoryAuditIssue>> {
  const chaptersDir = join(bookDir, "chapters");
  const files = await readdir(chaptersDir).catch(() => []);
  const issues: ShortStoryAuditIssue[] = [];

  for (const file of files.filter((entry) => /^\d+_.*\.md$/.test(entry)).sort()) {
    const chapterNumber = Number.parseInt(file.match(/^(\d+)_/)?.[1] ?? "0", 10);
    const path = join(chaptersDir, file);
    if (!(await isFile(path))) continue;
    const content = await readFile(path, "utf-8");
    for (const phrase of SHORT_STORY_FORBIDDEN_CONTINUATION_PHRASES) {
      if (!content.includes(phrase)) continue;
      issues.push({
        severity: "error",
        code: "forbidden_continuation_phrase",
        message: `第 ${chapterNumber} 章出现不适合完结短故事的词：${phrase}`,
        chapterNumber,
        phrase,
      });
    }
  }

  return issues;
}

function titleFromChapterFile(file: string): string {
  return basename(file, ".md").replace(/^\d+_/, "").replace(/_/g, " ");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

