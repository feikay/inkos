export interface ConsistencyGuardResult {
  readonly pass: boolean;
  readonly issues: ReadonlyArray<string>;
}

const UNPREPARED_EVENT_PATTERNS = [
  /突然[^。！？\n]{0,24}(出现|冲出|袭来|爆发|裂开|倒塌|苏醒|现身)/u,
  /毫无征兆[^。！？\n]{0,24}(出现|冲出|袭来|爆发|裂开|倒塌|苏醒|现身)/u,
  /没有任何预兆[^。！？\n]{0,24}(出现|冲出|袭来|爆发|裂开|倒塌|苏醒|现身)/u,
] as const;

const SETUP_PATTERNS = [
  /脚步声|低吼|裂纹|震动|气息|波动|血迹|符文|冷意|腥味|影子|风声|水声|药香|玉牌|卷轴/u,
] as const;

const STATUS_CHANGE_PATTERNS = [
  {
    label: "伤势突然消失",
    pattern: /(重伤|断臂|失去知觉|昏迷|力竭|濒死)[\s\S]{0,120}(毫发无损|完全恢复|行动自如|若无其事)/u,
  },
  {
    label: "位置突然跳转",
    pattern: /(洞穴|暗河|石室|祭坛|山门|甬道)[\s\S]{0,80}(转眼|下一刻|眨眼间)[\s\S]{0,80}(城中|宗门深处|山顶|大殿中央)/u,
  },
] as const;

const PROP_WORDS = ["玉牌", "卷轴", "短剑", "长剑", "法杖", "药材", "灵气结晶", "石碑"] as const;

const PROP_GAIN_PATTERN = /(捡起|拿起|收好|收入怀中|装入|握住|接过)/u;
const PROP_LOSS_PATTERN = /(丢失|消失|碎裂|化为飞灰|烧成灰|不见|脱手飞出)/u;

const ACTION_PATTERN = /(握|拔|砍|斩|冲|退|踩|推|按|抓|收|抬|转身|停下|刺|挡|扑|跃|拖|扶|跪|咬)/u;
const DESCRIPTION_PATTERN = /(仿佛|似乎|像|空气|雾气|石壁|光芒|气息|古老|复杂|幽暗|浓郁|神秘|危险|压抑)/u;

export function validateConsistencyGuard(content: string): ConsistencyGuardResult {
  const normalized = normalizeContent(content);
  const issues = [
    ...detectUnpreparedEvents(normalized),
    ...detectStatusChanges(normalized),
    ...detectPropInconsistency(normalized),
    ...detectRhythmAnomalies(normalized),
    ...detectActionDescriptionBreaks(normalized),
  ];

  return {
    pass: issues.length === 0,
    issues,
  };
}

function detectUnpreparedEvents(content: string): string[] {
  const issues: string[] = [];
  for (const pattern of UNPREPARED_EVENT_PATTERNS) {
    const match = pattern.exec(content);
    if (!match) continue;
    const before = content.slice(Math.max(0, match.index - 120), match.index);
    if (SETUP_PATTERNS.some((setup) => setup.test(before))) continue;
    issues.push(`上下文衔接：出现无铺垫突发事件“${trimEvidence(match[0])}”。`);
  }
  return issues;
}

function detectStatusChanges(content: string): string[] {
  const issues: string[] = [];
  for (const rule of STATUS_CHANGE_PATTERNS) {
    const match = rule.pattern.exec(content);
    if (match) {
      issues.push(`信息一致性：${rule.label}，命中“${trimEvidence(match[0])}”。`);
    }
  }
  return issues;
}

function detectPropInconsistency(content: string): string[] {
  const issues: string[] = [];
  for (const prop of PROP_WORDS) {
    const propPattern = new RegExp(prop, "gu");
    const mentions = [...content.matchAll(propPattern)];
    if (mentions.length < 2) continue;

    const lossIndex = findContextIndex(content, prop, PROP_LOSS_PATTERN);
    if (lossIndex < 0) continue;
    const regainIndex = findContextIndex(content.slice(lossIndex + prop.length), prop, PROP_GAIN_PATTERN);
    if (regainIndex >= 0) {
      issues.push(`信息一致性：${prop}在消失/损毁后再次被取得，缺少交代。`);
    }
  }
  return issues;
}

function detectRhythmAnomalies(content: string): string[] {
  const sentences = splitSentences(content);
  if (sentences.length < 3) return [];

  const issues: string[] = [];
  const lengths = sentences.map((sentence) => sentence.length);
  if (sentences.length >= 5 && hasConsecutive(lengths, (length) => length <= 8, 5)) {
    issues.push("节奏异常：连续短句过多，读感像提纲或断裂镜头。");
  }
  if (hasConsecutive(lengths, (length) => length >= 45, 3)) {
    issues.push("节奏异常：连续长句过多，信息挤压导致节奏失衡。");
  }
  return issues;
}

function detectActionDescriptionBreaks(content: string): string[] {
  const sentences = splitSentences(content);
  if (sentences.length < 5) return [];

  for (let index = 0; index <= sentences.length - 5; index += 1) {
    const window = sentences.slice(index, index + 5);
    const pattern = window.map(classifySentence);
    if (pattern.join("") === "ADDD A".replace(/\s/g, "")) {
      return ["节奏异常：动作后插入过长描述，再突然回到动作，动作链断裂。"];
    }
  }
  return [];
}

function classifySentence(sentence: string): "A" | "D" | "O" {
  if (ACTION_PATTERN.test(sentence)) return "A";
  if (DESCRIPTION_PATTERN.test(sentence)) return "D";
  return "O";
}

function findContextIndex(content: string, prop: string, contextPattern: RegExp): number {
  let offset = 0;
  while (offset < content.length) {
    const index = content.indexOf(prop, offset);
    if (index < 0) return -1;
    const context = content.slice(Math.max(0, index - 16), Math.min(content.length, index + prop.length + 24));
    if (contextPattern.test(context)) return index;
    offset = index + prop.length;
  }
  return -1;
}

function hasConsecutive<T>(items: ReadonlyArray<T>, predicate: (item: T) => boolean, threshold: number): boolean {
  let count = 0;
  for (const item of items) {
    count = predicate(item) ? count + 1 : 0;
    if (count >= threshold) return true;
  }
  return false;
}

function splitSentences(content: string): string[] {
  return content
    .split(/[。！？!?]\s*/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .trim();
}

function trimEvidence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}
