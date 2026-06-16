import {
  RuntimeStateDeltaSchema,
  type HookRecord,
  type NewHookCandidate,
  type RuntimeStateDelta,
} from "../models/runtime-state.js";
import { evaluateHookAdmission } from "./hook-governance.js";
import { resolveHookPayoffTiming } from "./hook-lifecycle.js";

export interface HookArbiterDecision {
  readonly action: "created" | "mapped" | "mentioned" | "rejected";
  readonly reason: string;
  readonly hookId?: string;
  readonly candidate: NewHookCandidate & { readonly preferredHookId?: string };
}

interface PendingHookCandidate extends NewHookCandidate {
  readonly preferredHookId?: string;
}

const FORBIDDEN_STRUCTURAL_PATTERNS = [
  "system-secret",
  "core-antagonist-plot",
  "world-resource-monopoly",
  "first-10-stage-enemy",
  "supporting-character-goals",
];

export function isStructuralHookId(hookId: string): boolean {
  const normalized = hookId.toLowerCase();
  return FORBIDDEN_STRUCTURAL_PATTERNS.some((pat) => normalized.includes(pat));
}

function isStructuralCandidate(candidate: NewHookCandidate & { readonly preferredHookId?: string }): boolean {
  if (candidate.preferredHookId && isStructuralHookId(candidate.preferredHookId)) {
    return true;
  }
  const desc = `${candidate.type} ${candidate.expectedPayoff} ${candidate.notes}`.toLowerCase();
  return FORBIDDEN_STRUCTURAL_PATTERNS.some((pat) => desc.includes(pat));
}

export function cleanHooksMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const filtered = lines.filter((line) => {
    const isStructural = FORBIDDEN_STRUCTURAL_PATTERNS.some((pat) => line.toLowerCase().includes(pat));
    return !isStructural;
  });
  return filtered.join("\n");
}

export function arbitrateRuntimeStateDeltaHooks(params: {
  readonly hooks: ReadonlyArray<HookRecord>;
  readonly delta: RuntimeStateDelta;
  readonly chapterIntent?: string;
}): {
  readonly resolvedDelta: RuntimeStateDelta;
  readonly decisions: ReadonlyArray<HookArbiterDecision>;
} {
  const delta = RuntimeStateDeltaSchema.parse(params.delta);
  const workingHooks = [...params.hooks];

  const upsertsById = new Map<string, HookRecord>();

  // Filter structural hooks out of the lists
  const filteredResolve = delta.hookOps.resolve.filter((id) => !isStructuralHookId(id));
  const filteredMention = delta.hookOps.mention.filter((id) => !isStructuralHookId(id));
  const filteredDefer = delta.hookOps.defer.filter((id) => !isStructuralHookId(id));

  const mentions = new Set(filteredMention);
  const resolves = uniqueStrings(filteredResolve);
  const defers = uniqueStrings(filteredDefer);
  const fallbackCandidates: PendingHookCandidate[] = [];
  const decisions: HookArbiterDecision[] = [];

  for (const hook of delta.hookOps.upsert) {
    if (isStructuralHookId(hook.hookId)) {
      decisions.push({
        action: "rejected",
        reason: "structural_hook_forbidden",
        candidate: {
          type: hook.type,
          expectedPayoff: hook.expectedPayoff,
          notes: hook.notes,
          preferredHookId: hook.hookId,
        },
      });
      continue;
    }

    const existing = workingHooks.find((h) => h.hookId === hook.hookId);
    if (existing) {
      const merged = mergeCandidateIntoExistingHook(existing, hook, delta.chapter);
      upsertsById.set(merged.hookId, merged);
      replaceWorkingHook(workingHooks, merged);
      continue;
    }

    fallbackCandidates.push({
      type: hook.type,
      expectedPayoff: hook.expectedPayoff,
      notes: hook.notes,
      preferredHookId: hook.hookId,
    });
  }

  // Parse foreshadowed IDs and new hook cap budget from chapter intent
  let newHookCap = Infinity;
  const foreshadowedIds = new Set<string>();

  if (params.chapterIntent) {
    const capMatch = params.chapterIntent.match(/(?:本章不要再新开超过|do not open more than)\s*(\d+)\s*(?:个新伏笔家族|new hook families)/i);
    if (capMatch) {
      newHookCap = parseInt(capMatch[1], 10);
    }
    const touchMatches = params.chapterIntent.matchAll(/(?:foshadowToTouch|触碰伏笔|foreshadowToTouch):\s*([a-zA-Z0-9\-_, ]+)/gi);
    for (const match of touchMatches) {
      const ids = match[1].split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        foreshadowedIds.add(id);
      }
    }
    const agendaMatch = params.chapterIntent.match(/### Must Advance\s*([\s\S]*?)(?:###|$)/i);
    if (agendaMatch) {
      const listMatches = agendaMatch[1].matchAll(/-\s*([a-zA-Z0-9\-_]+)/gi);
      for (const m of listMatches) {
        foreshadowedIds.add(m[1].trim());
      }
    }
  }

  let createdNewHooksCount = 0;

  const allCandidates: PendingHookCandidate[] = [
    ...fallbackCandidates,
    ...(delta.newHookCandidates as PendingHookCandidate[]),
  ];

  for (const candidate of allCandidates) {
    if (isStructuralCandidate(candidate)) {
      decisions.push({
        action: "rejected",
        reason: "structural_hook_forbidden",
        candidate,
      });
      continue;
    }

    const activeHooks = workingHooks.filter((hook) => hook.status !== "resolved");
    const admission = evaluateHookAdmission({
      candidate,
      activeHooks,
    });

    if (!admission.admit) {
      if (admission.reason === "duplicate_family" && admission.matchedHookId) {
        const matched = workingHooks.find((hook) => hook.hookId === admission.matchedHookId);
        if (!matched) {
          decisions.push({
            action: "rejected",
            reason: "duplicate_family_without_match",
            candidate,
          });
          continue;
        }

        if (isPureRestatement(candidate, matched)) {
          if (!upsertsById.has(matched.hookId) && !resolves.includes(matched.hookId) && !defers.includes(matched.hookId)) {
            mentions.add(matched.hookId);
          }
          decisions.push({
            action: "mentioned",
            reason: "restated_existing_family",
            hookId: matched.hookId,
            candidate,
          });
          continue;
        }

        const base = upsertsById.get(matched.hookId) ?? matched;
        const mapped = mergeCandidateIntoExistingHook(base, candidate, delta.chapter);
        upsertsById.set(mapped.hookId, mapped);
        mentions.delete(mapped.hookId);
        replaceWorkingHook(workingHooks, mapped);
        decisions.push({
          action: "mapped",
          reason: "duplicate_family_with_novelty",
          hookId: matched.hookId,
          candidate,
        });
        continue;
      }

      decisions.push({
        action: "rejected",
        reason: admission.reason,
        candidate,
      });
      continue;
    }

    const proposedHookId = buildCanonicalHookId(candidate, new Set([
      ...workingHooks.map((hook) => hook.hookId),
      ...upsertsById.keys(),
    ]));

    // Check if the proposed hook ID matches any foreshadowed IDs via substring matching
    const isForeshadowed = [...foreshadowedIds].some((fid) =>
      proposedHookId.includes(fid) || fid.includes(proposedHookId) || (candidate.preferredHookId && candidate.preferredHookId.includes(fid))
    );

    if (!isForeshadowed && createdNewHooksCount >= newHookCap) {
      decisions.push({
        action: "rejected",
        reason: "new_hook_budget_exceeded",
        candidate,
      });
      continue;
    }

    const created = createCanonicalHook({
      candidate,
      chapter: delta.chapter,
      existingIds: new Set([
        ...workingHooks.map((hook) => hook.hookId),
        ...upsertsById.keys(),
      ]),
    });
    upsertsById.set(created.hookId, created);
    workingHooks.push(created);
    decisions.push({
      action: "created",
      reason: "admit",
      hookId: created.hookId,
      candidate,
    });

    if (!isForeshadowed) {
      createdNewHooksCount += 1;
    }
  }

  const resolvedDelta = RuntimeStateDeltaSchema.parse({
    ...delta,
    hookOps: {
      upsert: [...upsertsById.values()].sort(sortHooks),
      mention: [...mentions]
        .filter((hookId) => !upsertsById.has(hookId))
        .filter((hookId) => !resolves.includes(hookId))
        .filter((hookId) => !defers.includes(hookId))
        .sort(),
      resolve: resolves,
      defer: defers,
    },
    newHookCandidates: [],
  });

  return {
    resolvedDelta,
    decisions,
  };
}

function mergeCandidateIntoExistingHook(
  existing: HookRecord,
  candidate: NewHookCandidate,
  chapter: number,
): HookRecord {
  return {
    ...existing,
    type: preferRicherText(existing.type, candidate.type),
    status: existing.status === "resolved" ? "resolved" : "progressing",
    lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, chapter),
    expectedPayoff: preferRicherText(existing.expectedPayoff, candidate.expectedPayoff),
    payoffTiming: resolveHookPayoffTiming({
      payoffTiming: candidate.payoffTiming ?? existing.payoffTiming,
      expectedPayoff: preferRicherText(existing.expectedPayoff, candidate.expectedPayoff),
      notes: preferRicherText(existing.notes, candidate.notes),
    }),
    notes: preferRicherText(existing.notes, candidate.notes),
  };
}

function createCanonicalHook(params: {
  readonly candidate: PendingHookCandidate;
  readonly chapter: number;
  readonly existingIds: ReadonlySet<string>;
}): HookRecord {
  return {
    hookId: buildCanonicalHookId(params.candidate, params.existingIds),
    startChapter: params.chapter,
    type: params.candidate.type.trim(),
    status: "open",
    lastAdvancedChapter: params.chapter,
    expectedPayoff: params.candidate.expectedPayoff.trim(),
    payoffTiming: resolveHookPayoffTiming(params.candidate),
    notes: params.candidate.notes.trim(),
  };
}

function buildCanonicalHookId(
  candidate: PendingHookCandidate,
  existingIds: ReadonlySet<string>,
): string {
  const preferred = candidate.preferredHookId?.trim();
  if (preferred && !existingIds.has(preferred)) {
    return preferred;
  }

  const base = slugifyHookStem([
    candidate.type,
    candidate.expectedPayoff,
    candidate.notes,
  ].join(" "));
  let next = base;
  let suffix = 2;

  while (existingIds.has(next)) {
    next = `${base}-${suffix}`;
    suffix += 1;
  }

  return next;
}

function slugifyHookStem(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const englishTerms = (normalized.match(/[a-z0-9]{3,}/g) ?? [])
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 5);
  const chineseTerms = (normalized.match(/[\u4e00-\u9fff]{2,6}/g) ?? []).slice(0, 3);
  const stem = [...englishTerms, ...chineseTerms].join("-").slice(0, 64).replace(/-+$/g, "");
  return stem || "hook";
}

function isPureRestatement(candidate: NewHookCandidate, existing: HookRecord): boolean {
  const candidateText = normalizeText([
    candidate.type,
    candidate.expectedPayoff,
    candidate.notes,
  ].join(" "));
  const existingText = normalizeText([
    existing.type,
    existing.expectedPayoff,
    existing.notes,
  ].join(" "));

  if (!candidateText) return true;
  if (candidateText === existingText) return true;

  const candidateTerms = extractTerms(candidateText);
  const existingTerms = extractTerms(existingText);
  const novelTerms = [...candidateTerms].filter((term) => !existingTerms.has(term));

  const candidateChinese = extractChineseBigrams(candidateText);
  const existingChinese = extractChineseBigrams(existingText);
  const novelChinese = [...candidateChinese].filter((term) => !existingChinese.has(term));

  return novelTerms.length === 0 && novelChinese.length < 2;
}

function replaceWorkingHook(workingHooks: HookRecord[], hook: HookRecord): void {
  const index = workingHooks.findIndex((candidate) => candidate.hookId === hook.hookId);
  if (index >= 0) {
    workingHooks[index] = hook;
    return;
  }

  workingHooks.push(hook);
}

function sortHooks(left: HookRecord, right: HookRecord): number {
  return left.startChapter - right.startChapter
    || left.lastAdvancedChapter - right.lastAdvancedChapter
    || left.hookId.localeCompare(right.hookId);
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function preferRicherText(primary: string, fallback: string): string {
  const left = primary.trim();
  const right = fallback.trim();

  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  return right.length > left.length ? right : left;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTerms(value: string): Set<string> {
  const english = value
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 4)
    .filter((term) => !STOP_WORDS.has(term));
  const chinese = value.match(/[\u4e00-\u9fff]{2,6}/g) ?? [];
  return new Set([...english, ...chinese]);
}

function extractChineseBigrams(value: string): Set<string> {
  const segments = value.match(/[\u4e00-\u9fff]+/g) ?? [];
  const terms = new Set<string>();

  for (const segment of segments) {
    if (segment.length < 2) {
      continue;
    }

    for (let index = 0; index <= segment.length - 2; index += 1) {
      terms.add(segment.slice(index, index + 2));
    }
  }

  return terms;
}

const STOP_WORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "into",
  "still",
  "just",
  "have",
  "will",
  "reveal",
  "about",
  "already",
  "question",
  "chapter",
]);
