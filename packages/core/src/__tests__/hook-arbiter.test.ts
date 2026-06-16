import { describe, expect, it } from "vitest";
import type { HookRecord, RuntimeStateDelta } from "../models/runtime-state.js";
import { arbitrateRuntimeStateDeltaHooks } from "../utils/hook-arbiter.js";

function createHook(overrides: Partial<HookRecord> = {}): HookRecord {
  return {
    hookId: overrides.hookId ?? "H001",
    startChapter: overrides.startChapter ?? 1,
    type: overrides.type ?? "mystery",
    status: overrides.status ?? "open",
    lastAdvancedChapter: overrides.lastAdvancedChapter ?? 1,
    expectedPayoff: overrides.expectedPayoff ?? "Reveal the hidden ledger",
    notes: overrides.notes ?? "Still unresolved",
  };
}

function createDelta(overrides: Partial<RuntimeStateDelta> = {}): RuntimeStateDelta {
  return {
    chapter: overrides.chapter ?? 12,
    hookOps: {
      upsert: overrides.hookOps?.upsert ?? [],
      mention: overrides.hookOps?.mention ?? [],
      resolve: overrides.hookOps?.resolve ?? [],
      defer: overrides.hookOps?.defer ?? [],
    },
    newHookCandidates: overrides.newHookCandidates ?? [],
    subplotOps: [],
    emotionalArcOps: [],
    characterMatrixOps: [],
    notes: [],
  };
}

describe("arbitrateRuntimeStateDeltaHooks", () => {
  it("maps a duplicate-family candidate back onto the matched existing hook", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [
        createHook({
          hookId: "anonymous-source-scope",
          type: "source-risk",
          startChapter: 3,
          lastAdvancedChapter: 8,
          expectedPayoff: "Reveal how much the anonymous source already knew about the route.",
          notes: "The source knowledge question remains unresolved.",
        }),
      ],
      delta: createDelta({
        newHookCandidates: [
          {
            type: "source-risk",
            expectedPayoff: "Reveal how much the anonymous source already knew about the route and address.",
            notes: "This chapter adds the address angle to the anonymous source question.",
          },
        ],
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toEqual([
      expect.objectContaining({
        hookId: "anonymous-source-scope",
        lastAdvancedChapter: 12,
      }),
    ]);
    expect(result.resolvedDelta.newHookCandidates).toEqual([]);
  });

  it("downgrades a pure restatement candidate into a mention instead of opening a new hook", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [
        createHook({
          hookId: "mentor-debt",
          type: "relationship",
          expectedPayoff: "Reveal the real mentor debt.",
          notes: "The mentor debt is still unresolved.",
        }),
      ],
      delta: createDelta({
        newHookCandidates: [
          {
            type: "relationship",
            expectedPayoff: "Reveal the real mentor debt.",
            notes: "The mentor debt is still unresolved.",
          },
        ],
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toEqual([]);
    expect(result.resolvedDelta.hookOps.mention).toContain("mentor-debt");
    expect(result.resolvedDelta.newHookCandidates).toEqual([]);
  });

  it("creates a canonical hook when the candidate is genuinely new", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [
        createHook({
          hookId: "mentor-debt",
          type: "relationship",
          expectedPayoff: "Reveal the real mentor debt.",
        }),
      ],
      delta: createDelta({
        chapter: 15,
        newHookCandidates: [
          {
            type: "artifact",
            expectedPayoff: "Reveal why the seal answers only at midnight.",
            notes: "A fresh unresolved rule around the seal appears in this chapter.",
          },
        ],
      }),
    });

    expect(result.resolvedDelta.hookOps.upsert).toHaveLength(1);
    expect(result.resolvedDelta.hookOps.upsert[0]).toEqual(expect.objectContaining({
      startChapter: 15,
      lastAdvancedChapter: 15,
      type: "artifact",
      status: "open",
    }));
    expect(result.resolvedDelta.hookOps.upsert[0]?.hookId).not.toBe("mentor-debt");
    expect(result.resolvedDelta.newHookCandidates).toEqual([]);
  });

  it("filters out structural lines from runtime state delta and candidates", () => {
    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [
        createHook({ hookId: "normal-hook" }),
        createHook({ hookId: "system-secret-legacy" }), // legacy structural hook
      ],
      delta: createDelta({
        chapter: 5,
        hookOps: {
          upsert: [
            createHook({ hookId: "system-secret" }),
            createHook({ hookId: "another-normal-hook", type: "another-normal-type", expectedPayoff: "Another normal payoff" }),
          ],
          mention: ["core-antagonist-plot", "normal-hook"],
          resolve: ["world-resource-monopoly"],
          defer: ["first-10-stage-enemy"],
        },
        newHookCandidates: [
          {
            type: "supporting-character-goals",
            expectedPayoff: "Should be blocked.",
            notes: "",
          },
          {
            type: "normal-type",
            expectedPayoff: "Should be admitted.",
            notes: "",
          },
        ],
      }),
    });

    // Verify system-secret-legacy is pruned from hooks, and delta operations are filtered
    const upserts = result.resolvedDelta.hookOps.upsert;
    expect(upserts.some(h => h.hookId.includes("system-secret"))).toBe(false);
    expect(result.resolvedDelta.hookOps.mention.includes("core-antagonist-plot")).toBe(false);
    expect(result.resolvedDelta.hookOps.resolve.includes("world-resource-monopoly")).toBe(false);
    expect(result.resolvedDelta.hookOps.defer.includes("first-10-stage-enemy")).toBe(false);

    // Verify normal hooks are preserved or processed
    expect(upserts.some(h => h.hookId === "another-normal-hook")).toBe(true);
    expect(result.resolvedDelta.hookOps.mention.includes("normal-hook")).toBe(true);

    // Verify candidates matching structural patterns are rejected
    expect(result.decisions.some(d => d.candidate.type === "supporting-character-goals" && d.action === "rejected")).toBe(true);
    expect(result.decisions.some(d => d.candidate.type === "normal-type" && d.action === "created")).toBe(true);
  });

  it("enforces new hook cap budget from chapter intent", () => {
    const chapterIntent = [
      "- foreshadowToTouch: foreshadowed-hook",
      "本章不要再新开超过 2 个新伏笔家族。",
    ].join("\n");

    const result = arbitrateRuntimeStateDeltaHooks({
      hooks: [],
      delta: createDelta({
        chapter: 2,
        newHookCandidates: [
          {
            type: "foreshadowed-hook",
            expectedPayoff: "Touch foreshadowed hook",
            notes: "",
            preferredHookId: "foreshadowed-hook",
          } as any,
          {
            type: "extra-1",
            expectedPayoff: "Extra hook 1",
            notes: "",
          },
          {
            type: "extra-2",
            expectedPayoff: "Extra hook 2",
            notes: "",
          },
          {
            type: "extra-3",
            expectedPayoff: "Extra hook 3",
            notes: "",
          },
        ],
      }),
      chapterIntent,
    });

    const decisions = result.decisions;
    const created = decisions.filter(d => d.action === "created").map(d => d.hookId);
    const rejected = decisions.filter(d => d.action === "rejected" && d.reason === "new_hook_budget_exceeded");

    // Foreshadowed hook should be created
    expect(created).toContain("foreshadowed-hook");
    // Exactly 2 other hooks should be created (total of 3 created)
    expect(created).toHaveLength(3);
    // 1 hook should be rejected because of budget cap
    expect(rejected).toHaveLength(1);
  });
});
