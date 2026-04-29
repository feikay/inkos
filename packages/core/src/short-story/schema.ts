export type ShortStoryGenre = string;
export type ShortStoryTheme = string;
export type ShortStoryChapterFunction = "hook" | "escalation" | "twist" | "climax" | "resolution";

export interface ShortStoryConfig {
  readonly theme: ShortStoryTheme;
  readonly genre?: ShortStoryGenre;
  readonly targetWords: number;
  readonly chapterTargetWords?: number;
}

export interface ShortStoryChapterPlan {
  readonly chapterNumber: number;
  readonly title: string;
  readonly targetWords: number;
  readonly function: ShortStoryChapterFunction;
  readonly summary: string;
  readonly conflict: string;
  readonly endingHook: string;
  readonly role: "opening" | "development" | "climax" | "ending";
  readonly endingHookRequired: boolean;
}

export type ShortStoryAuditSeverity = "error" | "warning";

export interface ShortStoryAuditIssue {
  readonly severity: ShortStoryAuditSeverity;
  readonly code:
    | "book_word_count_out_of_range"
    | "chapter_word_count_out_of_range"
    | "chapter_word_count_outside_recommended_range"
    | "forbidden_continuation_phrase"
    | "empty_chapter";
  readonly message: string;
  readonly chapterNumber?: number;
  readonly actualWords?: number;
  readonly expectedRange?: readonly [number, number];
  readonly phrase?: string;
}

export interface ShortStoryAuditChapter {
  readonly chapterNumber: number;
  readonly title: string;
  readonly path?: string;
  readonly wordCount: number;
  readonly empty: boolean;
}

export interface ShortStoryAuditReport {
  readonly passed: boolean;
  readonly bookName: string;
  readonly totalWords: number;
  readonly chapterCount: number;
  readonly chapters: ReadonlyArray<ShortStoryAuditChapter>;
  readonly issues: ReadonlyArray<ShortStoryAuditIssue>;
}

export interface ShortStoryParsedPlan {
  readonly theme: ShortStoryTheme;
  readonly targetWords: number;
  readonly chapterTargetWords: number;
  readonly chapters: ReadonlyArray<ShortStoryChapterPlan>;
}

export interface ShortStoryDraftChapter {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
}
