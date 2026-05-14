export interface StoryMethod {
  id: string;
  name: string;
  purpose: string;
  principles?: string[];
  requiredQuestions?: string[];
  outputSections?: string[];
  reviewChecklist?: string[];
  promptHints?: string[];
}

export interface PlotStep {
  id: string;
  name: string;
  purpose: string;
  requiredInChapterIntent: string[];
  reviewChecklist: string[];
  promptHints: string[];
}

export interface SixStepPlotMethod {
  id: string;
  name: string;
  purpose: string;
  steps: PlotStep[];
  chapterIntentFields: string[];
  reviewChecklist: string[];
  commonFailures: string[];
  promptHints: string[];
}

export interface AntagonistTemplate {
  id: string;
  name: string;
  coreWeapon: string;
  threatToProtagonist: string;
  readerEmotion: string;
  bestUseCases: string[];
  designQuestions: string[];
  failureModes: string[];
  comebackPattern: string;
  promptHints: string[];
}

export interface OpeningHookMethod {
  id: string;
  name: string;
  hookEmotion: string;
  coreMechanism: string;
  suitableGenres: string[];
  firstLinePatterns: string[];
  designQuestions: string[];
  reviewChecklist: string[];
  failureModes: string[];
  promptHints: string[];
}

export interface TransitionMethod {
  id: string;
  name: string;
  purpose: string;
  bestUseCases: string[];
  badPatterns: string[];
  replacementStrategies: string[];
  reviewChecklist: string[];
  promptHints: string[];
}

export interface ReviewChecklistItem {
  id: string;
  question: string;
  severity: "info" | "warning" | "error";
}
