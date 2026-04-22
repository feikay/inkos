import { renderHooksProjection } from "./state-projections.js";
import { parsePendingHooksMarkdown } from "../utils/story-markdown.js";
import type { StoredHook } from "./memory-db.js";
import { normalizeHookPayoffTiming } from "../utils/hook-lifecycle.js";

export interface SettlementReconciliationResult {
  readonly updatedState: string;
  readonly updatedHooks: string;
  readonly updatedLedger: string;
  readonly settlementConfidence: number;
  readonly repaired: boolean;
  readonly findings: ReadonlyArray<{
    readonly kind: "location" | "injury" | "hook" | "resource";
    readonly detail: string;
    readonly repaired: boolean;
  }>;
}

export function reconcileSettlementDiff(params: {
  readonly content: string;
  readonly chapterNumber: number;
  readonly language: "zh" | "en";
  readonly oldState: string;
  readonly oldHooks: string;
  readonly oldLedger: string;
  readonly updatedState: string;
  readonly updatedHooks: string;
  readonly updatedLedger: string;
}): SettlementReconciliationResult {
  let updatedState = params.updatedState;
  let updatedHooks = params.updatedHooks;
  let updatedLedger = params.updatedLedger;
  let repaired = false;

  const findings: Array<{
    kind: "location" | "injury" | "hook" | "resource";
    detail: string;
    repaired: boolean;
  }> = [];

  const location = extractLocationChange(params.content);
  if (location) {
    const matched = includesLoose(updatedState, location);
    if (!matched) {
      updatedState = appendStateNote(updatedState, params.language === "en"
        ? `Current Location: ${location}`
        : `当前位置: ${location}`);
      repaired = true;
    }
    findings.push({ kind: "location", detail: location, repaired: !matched });
  }

  const injury = extractInjuryChange(params.content);
  if (injury) {
    const matched = includesLoose(updatedState, injury);
    if (!matched) {
      updatedState = appendStateNote(updatedState, params.language === "en"
        ? `Protagonist State: ${injury}`
        : `主角状态: ${injury}`);
      repaired = true;
    }
    findings.push({ kind: "injury", detail: injury, repaired: !matched });
  }

  const hookChange = extractHookChange(params.content);
  if (hookChange) {
    const hooks = parsePendingHooksMarkdown(updatedHooks);
    const existing = hooks.find((hook) => hook.hookId === hookChange.hookId);
    const matched = Boolean(
      existing
      && ((hookChange.movement === "resolve" && existing.status === "resolved")
        || (hookChange.movement !== "resolve" && /progressing|resolved/i.test(existing.status)))
      && includesLoose(existing.notes, hookChange.detail),
    );

    if (!matched) {
      const nextHooks = upsertHookChange(hooks, hookChange, params.chapterNumber);
      updatedHooks = renderHooksProjection({ hooks: toProjectionHooks(nextHooks) }, params.language);
      repaired = true;
    }
    findings.push({ kind: "hook", detail: `${hookChange.hookId}:${hookChange.detail}`, repaired: !matched });
  }

  const resource = extractResourceChange(params.content);
  if (resource) {
    const matched = includesLoose(updatedLedger, resource.item) && /消耗|已耗|扣减|used|spent/i.test(updatedLedger);
    if (!matched) {
      updatedLedger = appendLedgerNote(updatedLedger, params.language === "en"
        ? `${resource.item}: spent in chapter ${params.chapterNumber}`
        : `${resource.item}：本章已消耗`);
      repaired = true;
    }
    findings.push({ kind: "resource", detail: resource.item, repaired: !matched });
  }

  const total = findings.length;
  const synchronized = findings.filter((finding) => {
    switch (finding.kind) {
      case "location":
      case "injury":
        return includesLoose(updatedState, finding.detail);
      case "hook":
        return includesLoose(updatedHooks, finding.detail.split(":")[0] ?? "");
      case "resource":
        return includesLoose(updatedLedger, finding.detail);
      default:
        return true;
    }
  }).length;

  return {
    updatedState,
    updatedHooks,
    updatedLedger,
    settlementConfidence: total === 0 ? 1 : synchronized / total,
    repaired,
    findings,
  };
}

function extractLocationChange(content: string): string | undefined {
  const match = content.match(/(?:进入|走进|踏入|钻进)([^，。！？\n]{2,12})/u);
  return match?.[1]?.trim();
}

function extractInjuryChange(content: string): string | undefined {
  const match = content.match(/(旧伤裂开|伤势恶化|伤口恶化|伤口崩裂|经脉刺痛|反噬加重)/u);
  return match?.[1];
}

function extractHookChange(content: string): { hookId: string; movement: "advance" | "resolve"; detail: string } | undefined {
  const hookId = content.match(/\b([A-Z]\d{3,})\b/u)?.[1];
  if (!hookId) {
    return undefined;
  }
  const resolveMatch = content.match(new RegExp(`([^。！？\\n]{0,20}${hookId}[^。！？\\n]{0,20}(?:解决|回收|resolve)|(?:解决|回收|resolve)[^。！？\\n]{0,20}${hookId}[^。！？\\n]{0,20})`, "iu"));
  if (resolveMatch?.[1]) {
    return { hookId, movement: "resolve", detail: resolveMatch[1].trim() };
  }
  const advanceMatch = content.match(new RegExp(`([^。！？\\n]{0,24}${hookId}[^。！？\\n]{0,24}(?:推进|advance|发现|找到|揭开|掌握)|(?:发现|找到|揭开|掌握)[^。！？\\n]{0,24}${hookId}[^。！？\\n]{0,24})`, "iu"));
  if (advanceMatch?.[1]) {
    return { hookId, movement: "advance", detail: advanceMatch[1].trim() };
  }
  return undefined;
}

function extractResourceChange(content: string): { item: string } | undefined {
  const match = content.match(/(?:消耗|用掉|耗去)([^，。！？\n]{1,10})/u);
  const item = match?.[1]?.trim();
  return item ? { item } : undefined;
}

function upsertHookChange(
  hooks: ReadonlyArray<StoredHook>,
  change: { hookId: string; movement: "advance" | "resolve"; detail: string },
  chapterNumber: number,
): StoredHook[] {
  const next = [...hooks];
  const index = next.findIndex((hook) => hook.hookId === change.hookId);
  const base: StoredHook = index >= 0
    ? next[index]!
    : {
      hookId: change.hookId,
      startChapter: chapterNumber,
      type: "unspecified",
      status: "open",
      lastAdvancedChapter: chapterNumber,
      expectedPayoff: "",
      payoffTiming: undefined,
      notes: "",
    };

  const updated: StoredHook = {
    ...base,
    status: change.movement === "resolve" ? "resolved" : "progressing",
    lastAdvancedChapter: chapterNumber,
    notes: mergeText(base.notes, change.detail),
  };

  if (index >= 0) {
    next[index] = updated;
  } else {
    next.push(updated);
  }
  return next;
}

function toProjectionHooks(hooks: ReadonlyArray<StoredHook>): Array<{
  hookId: string;
  startChapter: number;
  type: string;
  status: "open" | "progressing" | "deferred" | "resolved";
  lastAdvancedChapter: number;
  expectedPayoff: string;
  payoffTiming?: "immediate" | "near-term" | "mid-arc" | "slow-burn" | "endgame";
  notes: string;
}> {
  return hooks.map((hook) => ({
    hookId: hook.hookId,
    startChapter: hook.startChapter,
    type: hook.type || "unspecified",
    status: normalizeHookStatus(hook.status),
    lastAdvancedChapter: hook.lastAdvancedChapter,
    expectedPayoff: hook.expectedPayoff,
    payoffTiming: normalizeHookPayoffTiming(hook.payoffTiming),
    notes: hook.notes,
  }));
}

function normalizeHookStatus(status: string): "open" | "progressing" | "deferred" | "resolved" {
  const normalized = status.trim().toLowerCase();
  if (normalized === "progressing") return "progressing";
  if (normalized === "deferred") return "deferred";
  if (normalized === "resolved") return "resolved";
  return "open";
}

function appendStateNote(markdown: string, note: string): string {
  const base = normalizeMarkdown(markdown, "# 当前状态");
  return `${base}\n- ${note}\n`;
}

function appendLedgerNote(markdown: string, note: string): string {
  const base = normalizeMarkdown(markdown, "# 资源账本");
  return `${base}\n- ${note}\n`;
}

function normalizeMarkdown(markdown: string, fallbackTitle: string): string {
  const trimmed = markdown.trim();
  if (!trimmed || /未更新/.test(trimmed)) {
    return `${fallbackTitle}\n`;
  }
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

function mergeText(left: string, right: string): string {
  if (!left.trim()) return right.trim();
  if (includesLoose(left, right)) return left.trim();
  return `${left.trim()}；${right.trim()}`;
}

function includesLoose(haystack: string, needle: string): boolean {
  const left = haystack.replace(/\s+/g, "");
  const right = needle.replace(/\s+/g, "");
  return Boolean(right) && left.includes(right);
}
