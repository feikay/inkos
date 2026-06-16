export type NonNarrativeArtifactType =
  | "author-note"
  | "prompt-leak"
  | "calculation-scratchpad"
  | "self-correction"
  | "meta-instruction"
  | "llm-process-leak";

export interface NonNarrativeArtifact {
  readonly type: NonNarrativeArtifactType;
  readonly severity: "warning" | "critical";
  readonly text: string;
  readonly start?: number;
  readonly end?: number;
  readonly reason: string;
}

export interface CleanNarrativeResult {
  readonly cleanedText: string;
  readonly artifacts: ReadonlyArray<NonNarrativeArtifact>;
  readonly removedSnippets: ReadonlyArray<string>;
  readonly changed: boolean;
  readonly blocking: boolean;
}

const PROMPT_LEAK_PATTERN = /本章(?:要求|意图|目标)|按(?:任务提示词|提示词要求)|根据\s*prompt|prompt|本章要写/u;
const META_INSTRUCTION_PATTERN = /【这里(?:应该|补|删)】|^这里需要(?:写|补)|^[（(]这里(?:应该|补|删|需要写)[）)]|^这段(?:应该|要调整)|调整一下(?:剧情|大纲|设定|结构)|修正为|改成|要写成|不能写|应该写/u;
const PROCESS_LEAK_PATTERN = /Resource Engine|resource-consistency|template patch|defer_exchange|add_earned_resource_before_spend|LLM|token|stage|rewrite|validation|accepted=false|rejectedReason|reviewer|report|json|markdown/u;
const AUTHOR_NOTE_PATTERN = /【作者注】|作者注[：:]|【备注】|备注[：:]|^TODO|^FIXME|【草稿】|【临时】|临时草稿|临时标注|【待改】|^待补充|^[【（(]?(?:这一段|上一段|下一段)(?:需要|应该|补|删|改|调整)/ui;
const SELF_CORRECTION_PATTERN = /(?:不对|哦对|哦不对|等等|我调整一下|刚才(?:顺序)?错了|写错了|重新算|重新整理|算错了|前面错了|修一下|对了没错)/u;
const RESOURCE_SCRATCH_PATTERN = /(?:扶人\s*\d+\s*\+\s*路人\s*\d+|总获得|花\d+换技能|剩\d+|换钱不对|兑换\d+.*哦对|按公式|资源链|民望公式|余额计算|当前账本|程序账本|\d+\s*\+\s*\d+\s*=|\d+\s*-\s*\d+\s*=)/u;
const RESOURCE_WORD_PATTERN = /民望|联邦币|现金|技能|余额|兑换|到账|资源/u;
const NUMBER_PATTERN = /\d+|[一二两三四五六七八九十百千万]+/gu;

export function detectNonNarrativeArtifacts(text: string): NonNarrativeArtifact[] {
  const artifacts: NonNarrativeArtifact[] = [];
  for (const unit of splitNarrativeUnits(text)) {
    const artifact = classifyNonNarrativeUnit(unit.text);
    if (!artifact) continue;
    artifacts.push({
      ...artifact,
      text: unit.text.trim(),
      start: unit.start,
      end: unit.end,
    });
  }
  return artifacts;
}

export function cleanNonNarrativeArtifacts(text: string): CleanNarrativeResult {
  const units = splitNarrativeUnits(text);
  const removed: string[] = [];
  const kept: string[] = [];
  const artifacts: NonNarrativeArtifact[] = [];

  for (const unit of units) {
    const artifact = classifyNonNarrativeUnit(unit.text);
    if (!artifact) {
      kept.push(unit.text.trim());
      continue;
    }
    artifacts.push({
      ...artifact,
      text: unit.text.trim(),
      start: unit.start,
      end: unit.end,
    });
    removed.push(unit.text.trim());
    const bridge = buildBridgeForRemovedArtifact(unit.text);
    if (bridge) kept.push(bridge);
  }

  if (removed.length === 0) {
    return {
      cleanedText: text,
      artifacts: [],
      removedSnippets: [],
      changed: false,
      blocking: false,
    };
  }

  const cleanedText = kept.join(text.includes("\n\n") ? "\n\n" : "").replace(/\n{3,}/gu, "\n\n").trim();
  const residual = detectNonNarrativeArtifacts(cleanedText);
  const tooShort = text.trim().length >= 200 && cleanedText.length < Math.ceil(text.trim().length * 0.2);
  return {
    cleanedText,
    artifacts,
    removedSnippets: removed,
    changed: removed.length > 0,
    blocking: tooShort || residual.some((artifact) => artifact.severity === "critical"),
  };
}

function classifyNonNarrativeUnit(raw: string): Omit<NonNarrativeArtifact, "text" | "start" | "end"> | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (AUTHOR_NOTE_PATTERN.test(text)) {
    return { type: "author-note", severity: "critical", reason: "作者批注或草稿标记混入正文。" };
  }
  if (PROCESS_LEAK_PATTERN.test(text)) {
    return { type: "llm-process-leak", severity: "critical", reason: "LLM/流程/报告字段混入正文。" };
  }
  if (PROMPT_LEAK_PATTERN.test(text)) {
    return { type: "prompt-leak", severity: "critical", reason: "提示词、本章意图或任务说明混入正文。" };
  }
  if (META_INSTRUCTION_PATTERN.test(text) && (RESOURCE_WORD_PATTERN.test(text) || SELF_CORRECTION_PATTERN.test(text))) {
    return { type: "meta-instruction", severity: "critical", reason: "修正文案指令混入正文。" };
  }
  const numberCount = [...text.matchAll(NUMBER_PATTERN)].length;
  if (RESOURCE_SCRATCH_PATTERN.test(text) && (RESOURCE_WORD_PATTERN.test(text) || numberCount >= 2)) {
    return { type: "calculation-scratchpad", severity: "critical", reason: "资源计算草稿混入正文。" };
  }
  if (
    SELF_CORRECTION_PATTERN.test(text)
    && (PROMPT_LEAK_PATTERN.test(text) || RESOURCE_SCRATCH_PATTERN.test(text) || (RESOURCE_WORD_PATTERN.test(text) && numberCount >= 2))
  ) {
    return { type: "self-correction", severity: "critical", reason: "LLM 自我纠错/重算过程混入正文。" };
  }
  return undefined;
}

function splitNarrativeUnits(text: string): Array<{ readonly text: string; readonly start: number; readonly end: number }> {
  if (/\n\s*\n/u.test(text)) {
    const units: Array<{ text: string; start: number; end: number }> = [];
    const regex = /([^\n](?:[\s\S]*?))(?:\n\s*\n|$)/gu;
    for (const match of text.matchAll(regex)) {
      const unit = match[1] ?? "";
      if (!unit.trim()) continue;
      const start = match.index ?? 0;
      units.push({ text: unit, start, end: start + unit.length });
    }
    return units;
  }
  const units: Array<{ text: string; start: number; end: number }> = [];
  const sentenceRegex = /[^。！？!?]+[。！？!?]?/gu;
  for (const match of text.matchAll(sentenceRegex)) {
    const sentence = match[0] ?? "";
    if (!sentence.trim()) continue;
    const start = match.index ?? 0;
    units.push({ text: sentence, start, end: start + sentence.length });
  }
  return units.length ? units : [{ text, start: 0, end: text.length }];
}

function buildBridgeForRemovedArtifact(text: string): string {
  if (!RESOURCE_WORD_PATTERN.test(text)) return "";
  if (!/(兑换|民望|联邦币|现金|余额)/u.test(text)) return "";
  return "林默盯着面板上的兑换按钮，最终没有立刻按下去。";
}
