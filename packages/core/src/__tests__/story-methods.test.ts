import { describe, expect, it } from "vitest";
import {
  ANTAGONIST_INTELLIGENCE_CHECKLIST,
  ANTAGONIST_TEMPLATES,
  GOLDEN_OPENING_REVIEW_CHECKLIST,
  HARD_TRANSITION_PATTERNS,
  OPENING_HOOK_METHODS,
  SIX_STEP_PLOT_METHOD,
  TRANSITION_METHODS,
  WORLD_ENGINE_METHOD,
} from "../story-methods/index.js";

describe("story methods", () => {
  it("exports the world engine method with required questions", () => {
    expect(WORLD_ENGINE_METHOD.id).toBe("world-engine");
    expect(WORLD_ENGINE_METHOD.requiredQuestions?.length).toBeGreaterThan(0);
    expect(WORLD_ENGINE_METHOD.reviewChecklist?.length).toBeGreaterThan(0);
  });

  it("exports the six-step plot method with six steps", () => {
    expect(SIX_STEP_PLOT_METHOD.steps).toHaveLength(6);
    expect(SIX_STEP_PLOT_METHOD.chapterIntentFields.length).toBeGreaterThan(0);
  });

  it("exports the three antagonist templates and intelligence checklist", () => {
    const ids = ANTAGONIST_TEMPLATES.map((template) => template.id);

    expect(ids).toEqual(expect.arrayContaining(["moujuzhe", "xundaozhe", "weitazhe"]));
    expect(ANTAGONIST_INTELLIGENCE_CHECKLIST.length).toBeGreaterThan(0);
  });

  it("exports five opening hook methods and the golden opening checklist", () => {
    expect(OPENING_HOOK_METHODS).toHaveLength(5);
    expect(GOLDEN_OPENING_REVIEW_CHECKLIST.length).toBeGreaterThan(0);
  });

  it("exports four transition methods and hard transition patterns", () => {
    expect(TRANSITION_METHODS).toHaveLength(4);
    expect(HARD_TRANSITION_PATTERNS).toEqual(
      expect.arrayContaining(["转眼间", "第二天", "不久之后"]),
    );
  });
});
