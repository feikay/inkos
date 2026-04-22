import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import { hasRepairableStateWarnings, type ValidationResult, type StateValidatorAgent } from "../agents/state-validator.js";
import type { WriteChapterOutput, WriterAgent } from "../agents/writer.js";
import type { BookConfig } from "../models/book.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { Logger } from "../utils/logger.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import { reconcileSettlementDiff } from "../state/settlement-reconciliation.js";
import {
  buildStateDegradedPersistenceOutput,
  retrySettlementAfterValidationFailure,
} from "./chapter-state-recovery.js";

export async function validateChapterTruthPersistence(params: {
  readonly writer: Pick<WriterAgent, "settleChapterState">;
  readonly validator: Pick<StateValidatorAgent, "validate">;
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly persistenceOutput: WriteChapterOutput;
  readonly auditResult: AuditResult;
  readonly previousTruth: {
    readonly oldState: string;
    readonly oldHooks: string;
    readonly oldLedger: string;
  };
  readonly reducedControlInput?: {
    chapterIntent: string;
    contextPackage: ContextPackage;
    ruleStack: RuleStack;
  };
  readonly language: LengthLanguage;
  readonly logWarn: (message: { zh: string; en: string }) => void;
  readonly logger?: Pick<Logger, "warn">;
}): Promise<{
  readonly validation: ValidationResult;
  readonly chapterStatus: "state-degraded" | null;
  readonly degradedIssues: ReadonlyArray<AuditIssue>;
  readonly persistenceOutput: WriteChapterOutput;
  readonly auditResult: AuditResult;
}> {
  let validation: ValidationResult;
  let chapterStatus: "state-degraded" | null = null;
  let degradedIssues: ReadonlyArray<AuditIssue> = [];
  let persistenceOutput = params.persistenceOutput;
  let auditResult = params.auditResult;

  try {
    validation = await params.validator.validate(
      params.content,
      params.chapterNumber,
      params.previousTruth.oldState,
      persistenceOutput.updatedState,
      params.previousTruth.oldHooks,
      persistenceOutput.updatedHooks,
      params.language,
    );
  } catch (error) {
    params.logger?.warn(`State validation error for chapter ${params.chapterNumber}: ${String(error)}`);
    const errorDescription = params.language === "en"
      ? `State validation unavailable: ${String(error)}`
      : `状态校验不可用：${String(error)}`;
    const errorIssue: AuditIssue = {
      severity: "warning",
      category: "state-validation",
      description: errorDescription,
      suggestion: params.language === "en"
        ? "Repair chapter state from the persisted body before continuing."
        : "请先基于已保存正文修复本章 state，再继续后续章节。",
    };
    return {
      validation: { passed: true, warnings: [] },
      chapterStatus: "state-degraded",
      degradedIssues: [errorIssue],
      persistenceOutput: buildStateDegradedPersistenceOutput({
        output: persistenceOutput,
        oldState: params.previousTruth.oldState,
        oldHooks: params.previousTruth.oldHooks,
        oldLedger: params.previousTruth.oldLedger,
      }),
      auditResult: {
        ...params.auditResult,
        issues: [...params.auditResult.issues, errorIssue],
      },
    };
  }

  if (validation.warnings.length > 0) {
    params.logWarn({
      zh: `状态校验：第${params.chapterNumber}章发现 ${validation.warnings.length} 条警告`,
      en: `State validation: ${validation.warnings.length} warning(s) for chapter ${params.chapterNumber}`,
    });
    for (const warning of validation.warnings) {
      params.logger?.warn(`  [${warning.category}] ${warning.description}`);
    }
  }

  if (!validation.passed) {
    const canAttemptLocalRepair = hasRepairableStateWarnings(validation.warnings);
    if (canAttemptLocalRepair) {
      const repaired = reconcileSettlementDiff({
        content: params.content,
        chapterNumber: params.chapterNumber,
        language: params.language,
        oldState: params.previousTruth.oldState,
        oldHooks: params.previousTruth.oldHooks,
        oldLedger: params.previousTruth.oldLedger,
        updatedState: persistenceOutput.updatedState,
        updatedHooks: persistenceOutput.updatedHooks,
        updatedLedger: persistenceOutput.updatedLedger,
      });

      if (repaired.repaired) {
        const locallyRepairedOutput: WriteChapterOutput = {
          ...persistenceOutput,
          updatedState: repaired.updatedState,
          updatedHooks: repaired.updatedHooks,
          updatedLedger: repaired.updatedLedger,
          settlementConfidence: repaired.settlementConfidence,
        };

        let localValidation: ValidationResult | null = null;
        try {
          localValidation = await params.validator.validate(
            params.content,
            params.chapterNumber,
            params.previousTruth.oldState,
            locallyRepairedOutput.updatedState,
            params.previousTruth.oldHooks,
            locallyRepairedOutput.updatedHooks,
            params.language,
          );
        } catch (error) {
          params.logger?.warn(`Local settlement reconciliation validation failed for chapter ${params.chapterNumber}: ${String(error)}`);
        }

        if (localValidation?.passed) {
          params.logWarn({
            zh: `状态校验：第${params.chapterNumber}章通过本地 reconciliation 自动修复`,
            en: `State validation: chapter ${params.chapterNumber} auto-repaired by local reconciliation`,
          });
          validation = localValidation;
          persistenceOutput = locallyRepairedOutput;
        } else {
          persistenceOutput = locallyRepairedOutput;
        }
      }
    }
  }

  if (!validation.passed) {
    const recovery = await retrySettlementAfterValidationFailure({
      writer: params.writer,
      validator: params.validator,
      book: params.book,
      bookDir: params.bookDir,
      chapterNumber: params.chapterNumber,
      title: params.title,
      content: params.content,
      reducedControlInput: params.reducedControlInput,
      oldState: params.previousTruth.oldState,
      oldHooks: params.previousTruth.oldHooks,
      originalValidation: validation,
      language: params.language,
      logWarn: params.logWarn,
      logger: params.logger,
    });

    if (recovery.kind === "recovered") {
      persistenceOutput = recovery.output;
      validation = recovery.validation;
    } else {
      chapterStatus = "state-degraded";
      degradedIssues = recovery.issues;
      persistenceOutput = buildStateDegradedPersistenceOutput({
        output: persistenceOutput,
        oldState: params.previousTruth.oldState,
        oldHooks: params.previousTruth.oldHooks,
        oldLedger: params.previousTruth.oldLedger,
      });
      auditResult = {
        ...auditResult,
        issues: [...auditResult.issues, ...recovery.issues],
      };
    }
  }

  if ((persistenceOutput.settlementConfidence ?? 1) < 0.8) {
    const confidenceIssue: AuditIssue = {
      severity: "warning",
      category: "settlement-confidence",
      description: params.language === "en"
        ? `Settlement confidence is low (${Math.round((persistenceOutput.settlementConfidence ?? 0) * 100)}%). Some narrative facts may still be unsynchronized.`
        : `Settlement confidence 偏低（${Math.round((persistenceOutput.settlementConfidence ?? 0) * 100)}%），部分正文事实可能仍未同步。`,
      suggestion: params.language === "en"
        ? "Check current_state, pending_hooks, and ledger before writing the next chapter."
        : "继续写下一章前，请先人工核对 current_state / pending_hooks / ledger。",
    };
    auditResult = {
      ...auditResult,
      issues: [...auditResult.issues, confidenceIssue],
    };
  }

  return {
    validation,
    chapterStatus,
    degradedIssues,
    persistenceOutput,
    auditResult,
  };
}
