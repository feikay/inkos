import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ReviseOutput } from "../agents/reviser.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";

export interface ChapterReviewCycleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterReviewCycleControlInput {
  readonly chapterIntent: string;
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
}

export interface ChapterReviewCycleResult {
  readonly finalContent: string;
  readonly finalWordCount: number;
  readonly preAuditNormalizedWordCount: number;
  readonly revised: boolean;
  readonly auditResult: AuditResult;
  readonly totalUsage: ChapterReviewCycleUsage;
  readonly postReviseCount: number;
  readonly normalizeApplied: boolean;
}

export interface RewriteCandidateDecision {
  readonly beforeWords: number;
  readonly afterWords: number;
  readonly accepted: boolean;
  readonly rejectedReason?: string;
}

export function evaluateRewriteCandidate(params: {
  readonly beforeContent: string;
  readonly afterContent: string;
  readonly beforeWords: number;
  readonly afterWords: number;
  readonly minWholeChapterWords?: number;
  readonly minRetainRatio?: number;
}): RewriteCandidateDecision {
  const minRetainRatio = params.minRetainRatio ?? 0.8;
  if (params.afterContent.trim().length === 0) {
    return {
      beforeWords: params.beforeWords,
      afterWords: params.afterWords,
      accepted: false,
      rejectedReason: "empty-candidate",
    };
  }
  if (params.afterContent === params.beforeContent) {
    return {
      beforeWords: params.beforeWords,
      afterWords: params.afterWords,
      accepted: false,
      rejectedReason: "unchanged-candidate",
    };
  }
  const enforceWholeChapterGuard = typeof params.minWholeChapterWords === "number"
    && params.minWholeChapterWords > 1
    && params.beforeWords >= params.minWholeChapterWords;
  if (enforceWholeChapterGuard && params.afterWords < Math.ceil(params.beforeWords * minRetainRatio)) {
    return {
      beforeWords: params.beforeWords,
      afterWords: params.afterWords,
      accepted: false,
      rejectedReason: `below-${Math.round(minRetainRatio * 100)}%-of-original`,
    };
  }
  if (
    typeof params.minWholeChapterWords === "number"
    && params.minWholeChapterWords > 1
    && params.beforeWords >= params.minWholeChapterWords
    && params.afterWords < params.minWholeChapterWords
  ) {
    return {
      beforeWords: params.beforeWords,
      afterWords: params.afterWords,
      accepted: false,
      rejectedReason: `below-minimum-length-${params.minWholeChapterWords}`,
    };
  }
  return {
    beforeWords: params.beforeWords,
    afterWords: params.afterWords,
    accepted: true,
  };
}

export async function runChapterReviewCycle(params: {
  readonly book: Pick<{ genre: string }, "genre">;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly initialOutput: Pick<WriteChapterOutput, "content" | "wordCount" | "postWriteErrors" | "postWriteWarnings">;
  readonly reducedControlInput?: ChapterReviewCycleControlInput;
  readonly lengthSpec: LengthSpec;
  readonly initialUsage: ChapterReviewCycleUsage;
  readonly createReviser: () => {
    reviseChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      issues: ReadonlyArray<AuditIssue>,
      mode: "spot-fix",
      genre?: string,
      options?: {
        chapterIntent?: string;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
        lengthSpec?: LengthSpec;
      },
    ) => Promise<ReviseOutput>;
  };
  readonly auditor: {
    auditChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      genre?: string,
      options?: {
        temperature?: number;
        chapterIntent?: string;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
      },
    ) => Promise<AuditResult>;
  };
  readonly normalizeDraftLengthIfNeeded: (chapterContent: string) => Promise<{
    content: string;
    wordCount: number;
    applied: boolean;
    tokenUsage?: ChapterReviewCycleUsage;
  }>;
  readonly assertChapterContentNotEmpty: (content: string, stage: string) => void;
  readonly addUsage: (
    left: ChapterReviewCycleUsage,
    right?: ChapterReviewCycleUsage,
  ) => ChapterReviewCycleUsage;
  readonly restoreLostAuditIssues: (previous: AuditResult, next: AuditResult) => AuditResult;
  readonly analyzeAITells: (content: string) => { issues: ReadonlyArray<AuditIssue> };
  readonly analyzeSensitiveWords: (content: string) => {
    found: ReadonlyArray<{ severity: string }>;
    issues: ReadonlyArray<AuditIssue>;
  };
  readonly logWarn: (message: { zh: string; en: string }) => void;
  readonly logStage: (message: { zh: string; en: string }) => void;
  readonly minWholeChapterWords?: number;
  readonly logRewriteDecision?: (message: {
    zh: string;
    en: string;
    decision: RewriteCandidateDecision;
  }) => void;
}): Promise<ChapterReviewCycleResult> {
  let totalUsage = params.initialUsage;
  let postReviseCount = 0;
  let normalizeApplied = false;
  let finalContent = params.initialOutput.content;
  let finalWordCount = params.initialOutput.wordCount;
  let revised = false;

  const logRewriteDecision = (
    stage: string,
    decision: RewriteCandidateDecision,
  ) => {
    params.logRewriteDecision?.({
      zh: `rewrite decision [${stage}]: beforeWords=${decision.beforeWords}, afterWords=${decision.afterWords}, accepted=${decision.accepted}, rejectedReason=${decision.rejectedReason ?? "none"}`,
      en: `rewrite decision [${stage}]: beforeWords=${decision.beforeWords}, afterWords=${decision.afterWords}, accepted=${decision.accepted}, rejectedReason=${decision.rejectedReason ?? "none"}`,
      decision,
    });
  };

  const cadenceSpotFixWarnings = params.initialOutput.postWriteWarnings
    .filter((warning) =>
      warning.rule === "cadence-directive-violation"
      || warning.rule === "ending-isomorphism"
      || warning.rule === "mood-cadence-violation");
  const preAuditSpotFixIssues = [
    ...params.initialOutput.postWriteErrors.map((violation) => ({
      severity: "critical" as const,
      category: violation.rule,
      description: violation.description,
      suggestion: violation.suggestion,
    })),
    ...cadenceSpotFixWarnings.map((warning) => ({
      severity: "critical" as const,
      category: warning.rule,
      description: warning.description,
      suggestion: warning.suggestion,
    })),
  ];

  if (preAuditSpotFixIssues.length > 0) {
    params.logWarn({
      zh: `检测到 ${preAuditSpotFixIssues.length} 条后写修补信号，审计前触发 spot-fix 修补`,
      en: `${preAuditSpotFixIssues.length} post-write repair signals detected, triggering spot-fix before audit`,
    });
    const reviser = params.createReviser();
    const fixResult = await reviser.reviseChapter(
      params.bookDir,
      finalContent,
      params.chapterNumber,
      preAuditSpotFixIssues,
      "spot-fix",
      params.book.genre,
      {
        ...params.reducedControlInput,
        lengthSpec: params.lengthSpec,
      },
    );
    totalUsage = params.addUsage(totalUsage, fixResult.tokenUsage);
    const decision = evaluateRewriteCandidate({
      beforeContent: finalContent,
      afterContent: fixResult.revisedContent,
      beforeWords: finalWordCount,
      afterWords: fixResult.wordCount,
      minWholeChapterWords: params.minWholeChapterWords,
    });
    logRewriteDecision("pre-audit-spot-fix", decision);
    if (decision.accepted) {
      finalContent = fixResult.revisedContent;
      finalWordCount = fixResult.wordCount;
      revised = true;
      if (
        params.reducedControlInput?.chapterIntent
        && preAuditSpotFixIssues.some((issue) => issue.category === "mood-cadence-violation")
      ) {
        const { evaluateMoodCadenceCompliance } = await import("../agents/post-write-validator.js");
        const moodCheck = evaluateMoodCadenceCompliance(
          finalContent,
          params.reducedControlInput.chapterIntent,
        );
        if (!moodCheck?.matched) {
          params.logWarn({
            zh: "mood-cadence spot-fix 后仍未满足降调要求",
            en: "Mood-cadence spot-fix still does not satisfy the downshift requirement",
          });
        }
      }
    }
  }

  const normalizedBeforeAudit = await params.normalizeDraftLengthIfNeeded(finalContent);
  totalUsage = params.addUsage(totalUsage, normalizedBeforeAudit.tokenUsage);
  finalContent = normalizedBeforeAudit.content;
  finalWordCount = normalizedBeforeAudit.wordCount;
  normalizeApplied = normalizeApplied || normalizedBeforeAudit.applied;
  params.assertChapterContentNotEmpty(finalContent, "draft generation");

  params.logStage({ zh: "审计草稿", en: "auditing draft" });
  const llmAudit = await params.auditor.auditChapter(
    params.bookDir,
    finalContent,
    params.chapterNumber,
    params.book.genre,
    params.reducedControlInput,
  );
  totalUsage = params.addUsage(totalUsage, llmAudit.tokenUsage);
  const aiTellsResult = params.analyzeAITells(finalContent);
  const sensitiveWriteResult = params.analyzeSensitiveWords(finalContent);
  const hasBlockedWriteWords = sensitiveWriteResult.found.some((item) => item.severity === "block");
  let auditResult: AuditResult = {
    passed: hasBlockedWriteWords ? false : llmAudit.passed,
    issues: [...llmAudit.issues, ...aiTellsResult.issues, ...sensitiveWriteResult.issues],
    summary: llmAudit.summary,
  };

  if (!auditResult.passed) {
    const criticalIssues = auditResult.issues.filter((issue) => issue.severity === "critical");
    if (criticalIssues.length > 0) {
      const reviser = params.createReviser();
      params.logStage({ zh: "自动修复关键问题", en: "auto-revising critical issues" });
      const reviseOutput = await reviser.reviseChapter(
        params.bookDir,
        finalContent,
        params.chapterNumber,
        auditResult.issues,
        "spot-fix",
        params.book.genre,
        {
          ...params.reducedControlInput,
          lengthSpec: params.lengthSpec,
        },
      );
      totalUsage = params.addUsage(totalUsage, reviseOutput.tokenUsage);

      const reviseWordCount = reviseOutput.wordCount;
      const reviseDecision = evaluateRewriteCandidate({
        beforeContent: finalContent,
        afterContent: reviseOutput.revisedContent,
        beforeWords: finalWordCount,
        afterWords: reviseWordCount,
        minWholeChapterWords: params.minWholeChapterWords,
      });
      logRewriteDecision("critical-spot-fix", reviseDecision);
      if (reviseDecision.accepted) {
        const normalizedRevision = await params.normalizeDraftLengthIfNeeded(reviseOutput.revisedContent);
        totalUsage = params.addUsage(totalUsage, normalizedRevision.tokenUsage);
        postReviseCount = normalizedRevision.wordCount;
        normalizeApplied = normalizeApplied || normalizedRevision.applied;

        const preMarkers = params.analyzeAITells(finalContent);
        const postMarkers = params.analyzeAITells(normalizedRevision.content);
        if (postMarkers.issues.length <= preMarkers.issues.length) {
          finalContent = normalizedRevision.content;
          finalWordCount = normalizedRevision.wordCount;
          revised = true;
          params.assertChapterContentNotEmpty(finalContent, "revision");
        }

        const reAudit = await params.auditor.auditChapter(
          params.bookDir,
          finalContent,
          params.chapterNumber,
          params.book.genre,
          params.reducedControlInput
            ? { ...params.reducedControlInput, temperature: 0 }
            : { temperature: 0 },
        );
        totalUsage = params.addUsage(totalUsage, reAudit.tokenUsage);
        const reAITells = params.analyzeAITells(finalContent);
        const reSensitive = params.analyzeSensitiveWords(finalContent);
        const reHasBlocked = reSensitive.found.some((item) => item.severity === "block");
        auditResult = params.restoreLostAuditIssues(auditResult, {
          passed: reHasBlocked ? false : reAudit.passed,
          issues: [...reAudit.issues, ...reAITells.issues, ...reSensitive.issues],
          summary: reAudit.summary,
        });
      }
    }
  }

  return {
    finalContent,
    finalWordCount,
    preAuditNormalizedWordCount: normalizedBeforeAudit.wordCount,
    revised,
    auditResult,
    totalUsage,
    postReviseCount,
    normalizeApplied,
  };
}
