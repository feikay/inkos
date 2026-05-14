import fs from "node:fs";
import path from "node:path";

const FALLBACK = "待补充";
const KNOWN_JSON_FILES = [
  "book.json",
  "metadata.json",
  "outline.json",
  "plan.json",
  "characters.json",
  "world.json",
  "state.json",
  "story.json",
  "config.json",
  path.join("story", "state", "current_state.json"),
  path.join("story", "state", "hooks.json"),
  path.join("story", "foreshadow_registry.json"),
];

const KNOWN_TEXT_FILES = [
  path.join("story", "author_intent.md"),
  path.join("story", "book_rules.md"),
  path.join("story", "story_bible.md"),
  path.join("story", "character_matrix.md"),
  path.join("story", "volume_outline.md"),
  path.join("story", "current_state.md"),
  path.join("story", "chapter_summaries.md"),
  path.join("story", "pending_hooks.md"),
  path.join("story", "particle_ledger.md"),
  path.join("story", "emotional_arcs.md"),
  path.join("story", "current_focus.md"),
  path.join("story", "audit_drift.md"),
  path.join("story", "genre_profile.yaml"),
];

const KEY_LABELS = {
  title: ["title", "bookTitle", "name", "书名"],
  genre: ["genre", "category", "type", "题材", "类型"],
  platform: ["platform", "publishPlatform", "平台"],
  targetAudience: ["targetAudience", "reader", "audience", "目标读者", "读者"],
  targetWords: ["targetWords", "targetWordCount", "targetChapters", "目标字数", "目标章节"],
  mainCategory: ["mainCategory", "category", "primaryCategory", "主分类"],
  themeKeywords: ["themeKeywords", "themes", "theme", "主题关键词", "主题"],
  roleKeywords: ["roleKeywords", "characterKeywords", "roles", "角色关键词", "角色"],
  plotKeywords: ["plotKeywords", "plots", "plotTags", "情节关键词", "情节"],
  tags: ["tags", "labels", "keywords", "作品标签", "标签"],
  sellingPoint: ["sellingPoint", "logline", "hook", "一句话卖点", "卖点"],
  description: ["description", "intro", "summary", "synopsis", "简介"],
  protagonist: ["protagonist", "mainCharacter", "hero", "主角"],
  characters: ["characters", "characterList", "cast", "人物", "角色"],
  world: ["world", "worldbuilding", "worldSetting", "世界观", "世界设定"],
  powerSystem: ["powerSystem", "cultivation", "battleSystem", "levels", "战力体系", "境界体系"],
  cheat: ["cheat", "goldenFinger", "system", "ability", "金手指"],
  backgroundEvents: ["backgroundEvents", "backstory", "history", "背景事件"],
  conflicts: ["conflicts", "mainConflict", "矛盾冲突", "冲突"],
  outline: ["outline", "plotOutline", "storyOutline", "剧情大纲", "大纲"],
  volumes: ["volumes", "volumePlan", "卷纲", "分卷计划"],
  inspiration: ["inspiration", "ideas", "promo", "故事灵感", "灵感"],
};

function warn(warnings, message) {
  if (warnings) warnings.push(message);
}

export function safeReadJson(file, warnings = []) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    warn(warnings, `无法解析 JSON：${file}：${error.message}`);
    return null;
  }
}

function readTextIfExists(file, warnings = []) {
  if (!fs.existsSync(file)) return "";
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    warn(warnings, `无法读取文件：${file}：${error.message}`);
    return "";
  }
}

function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function pickFirst(...values) {
  return values.find((value) => !isBlank(value));
}

function compactText(value) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringifyObject(value, indent = "") {
  return Object.entries(value)
    .filter(([, item]) => !isBlank(item))
    .map(([key, item]) => {
      const text = normalizeTextValue(item, "");
      if (!text) return "";
      return `${indent}${key}：${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function normalizeTextValue(value, fallback = FALLBACK) {
  if (isBlank(value)) return fallback;
  if (typeof value === "string") return compactText(value) || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return formatList(value, fallback);
  if (typeof value === "object") return stringifyObject(value) || fallback;
  return compactText(value) || fallback;
}

export function formatList(value, fallback = FALLBACK) {
  if (isBlank(value)) return fallback;
  const list = Array.isArray(value) ? value : [value];
  const normalized = list
    .map((item) => normalizeTextValue(item, ""))
    .filter(Boolean);
  if (!normalized.length) return fallback;
  const primitiveOnly = list.every((item) => item === null || typeof item !== "object" || Array.isArray(item));
  return primitiveOnly ? normalized.join("、") : normalized.map((item) => `- ${item}`).join("\n");
}

function getByLabels(source, labels) {
  if (!source || typeof source !== "object") return undefined;
  for (const label of labels) {
    if (source[label] !== undefined) return source[label];
  }
  for (const [key, value] of Object.entries(source)) {
    if (labels.some((label) => key.toLowerCase() === String(label).toLowerCase())) return value;
  }
  return undefined;
}

function pickFromSources(sources, labels) {
  for (const source of sources) {
    const direct = getByLabels(source, labels);
    if (!isBlank(direct)) return direct;
  }
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const value of Object.values(source)) {
      const nested = getByLabels(value, labels);
      if (!isBlank(nested)) return nested;
    }
  }
  return undefined;
}

function parseSimpleYaml(text) {
  const data = {};
  let currentKey = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const listItem = line.match(/^-\s+(.+)$/u);
    if (listItem && currentKey) {
      data[currentKey] = Array.isArray(data[currentKey]) ? data[currentKey] : [];
      data[currentKey].push(listItem[1].trim());
      continue;
    }
    const match = line.match(/^([^:：]+)[:：]\s*(.*?)\s*$/u);
    if (match) {
      currentKey = match[1].trim();
      data[currentKey] = match[2].trim();
    }
  }
  return data;
}

function parseMdSections(text) {
  const sections = {};
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^#{1,3}\s+(.+?)\s*$/u);
    if (heading) {
      current = heading[1].replace(/^(\d+[_、.]\s*)/u, "").trim();
      sections[current] = sections[current] || [];
      continue;
    }
    if (current) sections[current].push(raw);
  }
  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, compactText(lines.join("\n"))])
  );
}

function stripCodeFence(text) {
  return String(text || "").trim().replace(/^```[\w-]*\s*/u, "").replace(/\s*```$/u, "").trim();
}

function sectionByPattern(parsed, pattern) {
  const entry = Object.entries(parsed.sections || {}).find(([key]) => pattern.test(key));
  return entry?.[1];
}

function parseInlineYamlValue(value) {
  const trimmed = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (/^\[.*\]$/u.test(trimmed)) {
    return trimmed
      .slice(1, -1)
      .split(/[,，]/u)
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed;
}

function extractFrontmatter(text) {
  const cleaned = String(text || "").trim().replace(/^```[\w-]*\s*/u, "").replace(/\s*```$/u, "").trim();
  const match = cleaned.match(/^---\s*\n([\s\S]*?)\n---/u);
  return match ? match[1] : "";
}

function parseSimpleFrontmatter(text) {
  const data = {};
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) return data;
  let currentObject = null;
  let currentList = null;
  for (const raw of frontmatter.split(/\r?\n/u)) {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const rootMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*?)\s*$/u);
    if (rootMatch) {
      const [, key, value] = rootMatch;
      currentObject = key;
      currentList = null;
      data[key] = value ? parseInlineYamlValue(value) : {};
      continue;
    }
    const nestedMatch = line.match(/^\s{2}([A-Za-z0-9_]+):\s*(.*?)\s*$/u);
    if (nestedMatch && currentObject) {
      const [, key, value] = nestedMatch;
      if (!data[currentObject] || typeof data[currentObject] !== "object" || Array.isArray(data[currentObject])) {
        data[currentObject] = {};
      }
      data[currentObject][key] = value ? parseInlineYamlValue(value) : [];
      currentList = key;
      continue;
    }
    const listMatch = line.match(/^\s{2}-\s*(.*?)\s*$/u);
    if (listMatch && currentObject) {
      if (currentList && data[currentObject] && typeof data[currentObject] === "object" && !Array.isArray(data[currentObject])) {
        data[currentObject][currentList] = Array.isArray(data[currentObject][currentList]) ? data[currentObject][currentList] : [];
        data[currentObject][currentList].push(listMatch[1].trim());
      } else {
        data[currentObject] = Array.isArray(data[currentObject]) ? data[currentObject] : [];
        data[currentObject].push(listMatch[1].trim());
      }
    }
  }
  return data;
}

function parseMarkdownTable(text) {
  const lines = String(text || "").split(/\r?\n/u).filter((line) => /^\s*\|.*\|\s*$/u.test(line));
  if (lines.length < 2) return [];
  const headers = lines[0].split("|").slice(1, -1).map((item) => item.trim());
  return lines.slice(2)
    .map((line) => line.split("|").slice(1, -1).map((item) => item.trim()))
    .filter((cells) => cells.length === headers.length)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
}

function parseCurrentStateMarkdown(text) {
  const row = {};
  for (const item of parseMarkdownTable(text)) {
    if (item["字段"]) row[item["字段"]] = item["值"];
  }
  return row;
}

function formatHookTable(text) {
  return parseMarkdownTable(text)
    .map((row) => `${row["hook_id"] || row["伏笔"] || ""}：${row["备注"] || row["内容"] || ""}（状态：${row["状态"] || "待补充"}，预期回收：${row["预期回收"] || "待补充"}）`)
    .filter((item) => item.replace(/[：()，状态预期回收待补充]/gu, "").trim())
    .join("\n");
}

function formatParticleLedger(text) {
  const rows = parseMarkdownTable(text);
  if (!rows.length) return "";
  const latest = rows[rows.length - 1];
  return `当前系统资源记录至第${latest["章节"] || "待补充"}章；期末值：${latest["期末值"] || "待补充"}；依据：${latest["依据"] || "待补充"}`;
}

function shortenSummary(text, maxLength = 72) {
  const cleaned = normalizeTextValue(text, "")
    .replace(/\s+/gu, "")
    .replace(/^\d+[.、]/u, "")
    .split(/[；;]/u)[0];
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function summarizeChapterRows(rows, limit = 5) {
  return rows.slice(-limit)
    .map((row) => `- 第${row["章节"]}章：${shortenSummary(row["关键事件"] || row["状态变化"] || row["标题"] || "待补充")}`)
    .join("\n");
}

function formatForeshadows(rows, pendingText = "") {
  const fromJson = rows
    .map((item) => `- ${item.hookId || "伏笔"}：${item.notes || "待补充"}（状态：${item.status || "待补充"}，预期回收：${item.expectedPayoff || "待补充"}）`)
    .join("\n");
  return fromJson || pendingText;
}

function compactListText(value, fallback = FALLBACK) {
  if (isBlank(value)) return fallback;
  const text = normalizeTextValue(value, "");
  return text
    .split(/\n+/u)
    .map((line) => line.replace(/^\s*[-*]\s*/u, "").trim())
    .filter(Boolean)
    .join("、") || fallback;
}

function parseAuthorVolumes(text) {
  const match = String(text || "").match(/##\s+主线剧情\s*\n([\s\S]*?)(?=\n##\s+|\s*$)/u);
  const source = match?.[1] || "";
  return [...source.matchAll(/^\s*\d+[.、]\s*([^（(：:]+)[（(]([^）)]+)[）)]\s*[：:]\s*(.+?)\s*$/gmu)]
    .map((item) => ({
      name: item[1].trim(),
      range: item[2].trim(),
      goal: item[3].trim(),
      enemy: "",
      highlights: item[3].trim(),
      hook: "",
    }));
}

function parseKeyValueLines(text) {
  const data = {};
  for (const raw of text.split(/\r?\n/)) {
    const cleaned = raw
      .replace(/^\s*[-*]\s*/u, "")
      .replace(/\*\*/gu, "")
      .trim();
    const match = cleaned.match(/^([^:：]+)[:：]\s*(.*?)\s*$/u);
    if (match && match[2]) data[match[1].trim()] = match[2].trim();
  }
  return data;
}

function parseCharacterMatrix(text) {
  const characters = [];
  const blocks = text.split(/^##\s+/m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const name = compactText(lines.shift() || "");
    if (!name) continue;
    characters.push({ name, ...parseKeyValueLines(lines.join("\n")) });
  }
  return characters;
}

function parseStoryBible(text) {
  const sections = parseMdSections(text);
  const keyValues = parseKeyValueLines(text);
  return { sections, keyValues };
}

function parseVolumeOutline(text) {
  const volumes = [];
  const blocks = text.split(/(?=^\*\*卷\d+[:：].+?\*\*)/m).filter((block) => block.trim());
  for (const block of blocks) {
    const title = block.match(/^\*\*(卷\d+)[:：]\s*(.+?)\*\*/u);
    if (!title) continue;
    const values = parseKeyValueLines(block);
    volumes.push({
      volumeNo: title[1],
      name: title[2].replace(/（.*?）/gu, "").trim(),
      goal: values["核心冲突"] || values["核心目标"],
      enemy: values["主要敌人"],
      highlights: values["关键爽点"] || values["收益目标"] || values["关键转折"],
      hook: values["结尾钩子"] || values["关键转折"],
    });
  }
  return volumes;
}

function collectData(bookDir, warnings = []) {
  const json = {};
  for (const relative of KNOWN_JSON_FILES) {
    const file = path.join(bookDir, relative);
    const data = safeReadJson(file, warnings);
    if (data) json[relative] = data;
  }

  if (fs.existsSync(bookDir)) {
    for (const name of fs.readdirSync(bookDir)) {
      if (!/\.json$/iu.test(name) || json[name]) continue;
      const data = safeReadJson(path.join(bookDir, name), warnings);
      if (data) json[name] = data;
    }
  }

  const text = {};
  for (const relative of KNOWN_TEXT_FILES) {
    const content = readTextIfExists(path.join(bookDir, relative), warnings);
    if (content) text[relative] = content;
  }

  return { json, text };
}

function extractCurrentStateFacts(currentState) {
  if (!Array.isArray(currentState?.facts)) return {};
  const data = {};
  for (const fact of currentState.facts) {
    if (fact?.subject !== "protagonist") continue;
    data[fact.predicate] = fact.object;
  }
  return data;
}

function normalizeCharacter(raw) {
  if (!raw || typeof raw !== "object") return { name: normalizeTextValue(raw, "") };
  return {
    name: pickFirst(raw.name, raw["姓名"], raw.characterName, raw.title),
    role: pickFirst(raw.role, raw.type, raw["定位"], raw["角色"]),
    identity: pickFirst(raw.identity, raw.background, raw["身份"], raw["身份背景"], raw["定位"]),
    personality: pickFirst(raw.personality, raw.traits, raw["性格"], raw["性格特征"]),
    appearance: pickFirst(raw.appearance, raw.look, raw["形象"], raw["形象特征"], raw["标签"]),
    relationship: pickFirst(raw.relationship, raw.relation, raw["与主角关系"], raw["关系"]),
    function: pickFirst(raw.function, raw.storyFunction, raw["剧情功能"], raw["动机"]),
    desire: pickFirst(raw.desire, raw.goal, raw.motivation, raw["核心欲望"], raw["动机"]),
    weakness: pickFirst(raw.weakness, raw.flaw, raw["核心弱点"], raw["当前限制"]),
    growth: pickFirst(raw.growth, raw.arc, raw["成长方向"]),
  };
}

function isProtagonist(character) {
  const text = normalizeTextValue([character.name, character.role, character.identity], "");
  return /protagonist|main|hero|主角|男主|女主/u.test(text);
}

function collectCharacters(sources, characterMatrixText) {
  const fromData = pickFromSources(sources, KEY_LABELS.characters);
  const rawCharacters = Array.isArray(fromData)
    ? fromData
    : fromData && typeof fromData === "object"
      ? Object.entries(fromData).map(([name, value]) => ({ name, ...(typeof value === "object" ? value : { description: value }) }))
      : [];
  const mdCharacters = parseCharacterMatrix(characterMatrixText || "");
  return [...rawCharacters, ...mdCharacters].map(normalizeCharacter).filter((item) => !isBlank(item.name));
}

function formatCharacter(character, index = null) {
  const prefix = index === null ? "" : `${index}. `;
  return `${prefix}配角姓名：${normalizeTextValue(character.name)}
   身份：${normalizeTextValue(character.identity || character.role)}
   性格特征：${normalizeTextValue(character.personality)}
   形象特征：${normalizeTextValue(character.appearance)}
   与主角关系：${normalizeTextValue(character.relationship)}
   剧情功能：${normalizeTextValue(character.function)}`;
}

function formatProtagonist(character, stateFacts) {
  return {
    name: pickFirst(character?.name, "待补充"),
    identity: pickFirst(character?.identity, character?.role),
    personality: character?.personality,
    appearance: character?.appearance,
    desire: pickFirst(character?.desire, stateFacts["当前目标"]),
    weakness: pickFirst(character?.weakness, stateFacts["当前限制"], stateFacts["主角状态"]),
    growth: character?.growth,
  };
}

function normalizePlatform(platform) {
  if (platform === "tomato" || platform === "fanqie") return "番茄";
  return platform;
}

function normalizeGenre(genre) {
  const labels = {
    xuanhuan: "玄幻",
    xiuxian: "仙侠",
    fantasy: "奇幻",
    urban: "都市",
    romance: "言情",
  };
  return labels[genre] || genre;
}

function inferReader(genre, category) {
  const text = normalizeTextValue([genre, category], "");
  if (/女频|言情|甜宠|古言|现言|宫斗|宅斗/u.test(text)) return "女频";
  if (/玄幻|仙侠|修仙|都市|悬疑|高武|系统|男频/u.test(text)) return "男频";
  return undefined;
}

function inferMainCategory(genre, profileLabel) {
  const text = normalizeTextValue([genre, profileLabel], "");
  if (/仙侠|修仙|修真/u.test(text)) return "东方仙侠";
  if (/玄幻|xuanhuan|葬渊|魔经/u.test(text)) return "传统玄幻";
  if (/悬疑|诡|灵异/u.test(text)) return "悬疑灵异";
  return undefined;
}

function countExportWords(exportMeta, chapters) {
  if (!isBlank(exportMeta?.wordCount)) return exportMeta.wordCount;
  const total = (chapters || []).reduce((sum, chapter) => sum + Number(chapter.chars || chapter.wordCount || 0), 0);
  return total || undefined;
}

function formatExportRange(exportMeta, chapters) {
  if (!chapters?.length) return pickFirst(exportMeta?.chapterRange, exportMeta?.range);
  const sorted = chapters.map((chapter) => Number(chapter.no || chapter.chapter)).filter(Boolean).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  return sorted.length === 1 ? `第${sorted[0]}章` : `第${sorted[0]}-${sorted[sorted.length - 1]}章（共${sorted.length}章）`;
}

function formatLocalTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
}

function formatTargetWords(sources) {
  const book = sources.find((source) => source && typeof source === "object" && source.targetChapters);
  if (book?.targetChapters && book?.chapterWordCount) {
    return `${book.targetChapters}章 × 每章约${book.chapterWordCount}字`;
  }
  return pickFromSources(sources, KEY_LABELS.targetWords);
}

function joinParts(...values) {
  return values
    .flat()
    .map((value) => normalizeTextValue(value, ""))
    .filter(Boolean)
    .join("\n");
}

function firstBullet(text) {
  const match = String(text || "").match(/^\s*[-*]\s*(.+)$/mu);
  return match?.[1]?.trim() || "";
}

function inferTagsFromText(text) {
  const rules = [
    ["系统流", /系统流|找死系统|系统/u],
    ["找死系统", /找死系统|找死任务/u],
    ["求生", /求生|活下去|死里逃生|极限生还/u],
    ["异能", /异能/u],
    ["校园", /校园|江城一中|高二/u],
    ["暗域", /暗域/u],
    ["反套路", /反套路/u],
    ["文明试炼场", /文明试炼场|高维文明/u],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function formatVolumePlans(volumes) {
  const labels = ["第一卷", "第二卷", "第三卷", "第四卷", "第五卷", "第六卷"];
  const list = volumes.length ? volumes : [{}, {}];
  return list.map((volume, index) => `${labels[index] || `第${index + 1}卷`}：
- 卷名：${normalizeTextValue(volume.name)}
- 核心目标：${normalizeTextValue(volume.goal)}
- 主要敌人：${normalizeTextValue(volume.enemy)}
- 关键爽点：${normalizeTextValue(volume.highlights)}
- 结尾钩子：${normalizeTextValue(volume.hook)}`).join("\n\n");
}

function buildVolumeText(volumes, index) {
  const volume = volumes[index] || {};
  const label = index === 0 ? "第一卷" : "第二卷";
  return `${label}：
- 卷名：${normalizeTextValue(volume.name)}
- 核心目标：${normalizeTextValue(volume.goal)}
- 主要敌人：${normalizeTextValue(volume.enemy)}
- 关键爽点：${normalizeTextValue(volume.highlights)}
- 结尾钩子：${normalizeTextValue(volume.hook)}`;
}

function findStoryBibleSection(storyBible, pattern) {
  const entry = Object.entries(storyBible.sections || {}).find(([key]) => pattern.test(key));
  return entry?.[1];
}

function line(label, value) {
  return `${label}：${normalizeTextValue(value)}`;
}

export function buildBookInfoText(context) {
  const warnings = context.warnings || [];
  const bookDir = context.bookDir;
  const { json, text } = collectData(bookDir, warnings);
  const jsonSources = Object.values(json);
  const authorIntentText = text[path.join("story", "author_intent.md")] || "";
  const authorIntent = parseStoryBible(authorIntentText);
  const bookRulesText = text[path.join("story", "book_rules.md")] || "";
  const bookRules = parseSimpleFrontmatter(bookRulesText);
  const bookRuleSections = parseStoryBible(stripCodeFence(bookRulesText));
  const storyBible = parseStoryBible(text[path.join("story", "story_bible.md")] || "");
  const genreProfile = parseSimpleYaml(text[path.join("story", "genre_profile.yaml")] || "");
  const currentStateMd = parseCurrentStateMarkdown(text[path.join("story", "current_state.md")] || "");
  const stateFacts = {
    ...extractCurrentStateFacts(json[path.join("story", "state", "current_state.json")]),
    ...currentStateMd,
  };
  const chapterSummaryRows = parseMarkdownTable(text[path.join("story", "chapter_summaries.md")] || "");
  const chapterProgressText = summarizeChapterRows(chapterSummaryRows);
  const foreshadowRows = Array.isArray(json[path.join("story", "foreshadow_registry.json")])
    ? json[path.join("story", "foreshadow_registry.json")]
    : [];
  const foreshadowText = foreshadowRows
    .map((item) => `${item.hookId || ""}：${item.notes || ""}（预期回收：${item.expectedPayoff || "待补充"}）`)
    .filter(Boolean)
    .join("\n");
  const pendingHooksText = formatHookTable(text[path.join("story", "pending_hooks.md")] || "");
  const currentForeshadowText = formatForeshadows(foreshadowRows, pendingHooksText);
  const particleLedgerText = formatParticleLedger(text[path.join("story", "particle_ledger.md")] || "");
  const characters = collectCharacters(jsonSources, text[path.join("story", "character_matrix.md")]);
  const protagonist = normalizeCharacter(
    pickFirst(bookRules.protagonist, pickFromSources(jsonSources, KEY_LABELS.protagonist), characters.find(isProtagonist), characters[0])
  );
  const protagonistInfo = formatProtagonist(protagonist, stateFacts);
  const supporting = characters
    .filter((character) => character.name !== protagonist.name)
    .slice(0, 8);
  const authorVolumes = parseAuthorVolumes(authorIntentText);
  const volumes = [
    ...authorVolumes,
    ...(
      Array.isArray(pickFromSources(jsonSources, KEY_LABELS.volumes))
        ? pickFromSources(jsonSources, KEY_LABELS.volumes).map((item) => ({
          name: pickFirst(item.name, item.title, item["卷名"]),
          goal: pickFirst(item.goal, item.coreGoal, item["核心目标"], item["核心冲突"]),
          enemy: pickFirst(item.enemy, item.mainEnemy, item["主要敌人"]),
          highlights: pickFirst(item.highlights, item.sellingPoints, item["关键爽点"]),
          hook: pickFirst(item.hook, item.endingHook, item["结尾钩子"]),
        }))
        : []
    ),
    ...parseVolumeOutline(text[path.join("story", "volume_outline.md")] || ""),
  ];

  const worldData = pickFromSources(jsonSources, KEY_LABELS.world);
  const powerData = pickFromSources(jsonSources, KEY_LABELS.powerSystem);
  const cheatData = pickFromSources(jsonSources, KEY_LABELS.cheat);
  const outlineData = pickFromSources(jsonSources, KEY_LABELS.outline);
  const conflictsData = pickFromSources(jsonSources, KEY_LABELS.conflicts);
  const backgroundData = pickFromSources(jsonSources, KEY_LABELS.backgroundEvents);
  const inspirationData = pickFromSources(jsonSources, KEY_LABELS.inspiration);

  const worldSection = findStoryBibleSection(storyBible, /世界观|地理|环境/u);
  const powerSection = findStoryBibleSection(storyBible, /力量体系|世界层级|战力/u);
  const protagonistSection = findStoryBibleSection(storyBible, /主角/u);
  const forceSection = findStoryBibleSection(storyBible, /势力|人物/u);
  const introSection = findStoryBibleSection(storyBible, /书名|简介/u);
  const currentConflict = pickFirst(stateFacts["当前冲突"], stateFacts["当前敌我"]);

  const title = pickFirst(context.exportMeta?.title, pickFromSources(jsonSources, KEY_LABELS.title), context.book, context.bookName);
  const exportWords = countExportWords(context.exportMeta, context.chapters);
  const authorCore = sectionByPattern(authorIntent, /^核心设定/u);
  const authorProtagonist = sectionByPattern(authorIntent, /^主角设定/u);
  const authorPlot = sectionByPattern(authorIntent, /^主线剧情/u);
  const authorHighlights = sectionByPattern(authorIntent, /^特色亮点/u);
  const authorWriting = sectionByPattern(authorIntent, /^写作要求/u);
  const authorGenreRules = sectionByPattern(authorIntent, /^题材规则/u);
  const conflictDriver = sectionByPattern(bookRuleSections, /^核心冲突驱动/u);
  const narrativeView = sectionByPattern(bookRuleSections, /^叙事视角/u);
  const genre = pickFirst(sectionByPattern(authorIntent, /^题材/u), bookRules.genreLock?.primary, pickFromSources(jsonSources, KEY_LABELS.genre), genreProfile.label, genreProfile.template);
  const mainCategory = pickFirst(
    pickFromSources(jsonSources, KEY_LABELS.mainCategory),
    bookRules.genreLock?.primary === "system" ? "系统流" : undefined,
    sectionByPattern(authorIntent, /^题材/u),
    inferMainCategory(genre, genreProfile.label)
  );
  const sourceCorpus = joinParts(authorCore, authorProtagonist, authorPlot, authorHighlights, conflictDriver, chapterProgressText, foreshadowText);
  const storyConflict = "表层：惜命主角 vs 找死系统；中层：林默 vs 暗域 / 暗裔组织；深层：人类文明 vs 高维文明试炼场。";
  const tags = pickFirst(pickFromSources(jsonSources, KEY_LABELS.tags), inferTagsFromText(sourceCorpus));
  const sellingPoint = pickFirst(
    pickFromSources(jsonSources, KEY_LABELS.sellingPoint),
    authorCore && authorHighlights
      ? `找死系统逼迫极致惜命的主角完成送死任务，死里逃生后获得奖励，并逐步揭开文明试炼场与救世主真相。`
      : undefined,
  );
  const description = pickFirst(
    pickFromSources(jsonSources, KEY_LABELS.description),
    authorCore && authorProtagonist
      ? `${authorCore}\n${authorProtagonist}\n当前开局危机：${normalizeTextValue(currentConflict)}`
      : undefined,
    storyBible.keyValues["简介"],
    introSection,
  );
  const protagonistPersonality = pickFirst(
    bookRules.protagonist?.personalityLock,
    protagonistInfo.personality,
    authorProtagonist,
    storyBible.keyValues["性格"],
  );
  const protagonistWeakness = pickFirst(
    protagonistInfo.weakness,
    stateFacts["当前限制"],
    "极度惜命，风险偏好极低；当前实力弱、缺少装备和补给，面对系统抹杀时被迫冒险。",
  );
  const worldOverview = joinParts(
    authorCore,
    storyConflict,
    "江城一中F级暗域泄漏点、十年前失踪案、异管局线索、高维文明试炼场与人类文明被试炼的深层设定，是当前世界观的核心信息。",
  );
  const powerOverview = joinParts(
    bookRules.numericalSystemOverrides?.hardCap,
    bookRules.numericalSystemOverrides?.resourceTypes,
    "战力分级包含F/E/D/C/B/A/S/SS/SSS，SSS级上限100000。",
    particleLedgerText,
  );
  const cheatOverview = joinParts(
    authorCore,
    "找死系统发布找死任务，完不成会抹杀；死里逃生后获得奖励。系统本质关联文明试炼场，主角是被培养的救世主。",
    "系统表现为冷漠机械音，偶尔透露一丝人性。",
  );
  const backgroundOverview = joinParts(
    "十年前江城一中失踪案、H001号失踪者学生证、江城一中楼顶F级暗域泄漏点、苏建国工作牌、苏清焰父亲线索，是当前已出现背景事件。",
  );
  const conflictOverview = joinParts(storyConflict, currentConflict);
  const themeKeywords = "反套路系统、极限求生、绝境反转、文明试炼、高维阴谋";
  const roleKeywords = "极致惜命、谨慎求生、理智抠门、被迫作死、草根逆袭";
  const plotKeywords = "找死任务、死里逃生、暗域探索、失踪案、异能觉醒";

  return `《${normalizeTextValue(title)}》作品资料卡

一、基础信息
${line("书名", title)}
${line("题材", normalizeGenre(genre))}
${line("平台", normalizePlatform(pickFromSources(jsonSources, KEY_LABELS.platform)))}
${line("目标读者", pickFirst(pickFromSources(jsonSources, KEY_LABELS.targetAudience), inferReader(genre, mainCategory)))}
${line("目标字数", formatTargetWords(jsonSources))}
${line("当前导出章节", formatExportRange(context.exportMeta, context.chapters))}
${line("当前导出字数", exportWords)}
${line("生成时间", context.exportMeta?.generatedAt || formatLocalTime())}

二、作品定位
${line("主分类", mainCategory)}
${line("主题关键词", pickFirst(pickFromSources(jsonSources, KEY_LABELS.themeKeywords), themeKeywords, storyBible.keyValues["主题"], genreProfile.tone))}
${line("角色关键词", pickFirst(pickFromSources(jsonSources, KEY_LABELS.roleKeywords), roleKeywords))}
${line("情节关键词", pickFirst(pickFromSources(jsonSources, KEY_LABELS.plotKeywords), plotKeywords, genreProfile.core_loop))}
${line("作品标签", tags)}
${line("一句话卖点", sellingPoint)}
${line("简介", description)}

三、主角设定
${line("主角姓名", protagonistInfo.name)}
${line("身份背景", pickFirst(protagonistInfo.identity, authorProtagonist, storyBible.keyValues["身份"], protagonistSection))}
${line("性格特征", protagonistPersonality)}
${line("形象特征", protagonistInfo.appearance)}
${line("核心欲望", pickFirst(protagonistInfo.desire, "活下去，规避系统抹杀与暗域危险，并逐步揭开系统与暗域真相。"))}
${line("核心弱点", protagonistWeakness)}
${line("成长方向", pickFirst(protagonistInfo.growth, "从极致惜命的谨慎求生者，被迫成长为能在找死任务中死里逃生、承担文明试炼真相的关键人物。"))}

四、主要配角设定
${supporting.length ? supporting.map((character, index) => formatCharacter(character, index + 1)).join("\n\n") : "1. 配角姓名：待补充\n   身份：待补充\n   性格特征：待补充\n   形象特征：待补充\n   与主角关系：待补充\n   剧情功能：待补充"}

五、世界观设定
${line("世界背景", pickFirst(worldData?.background, worldData?.["世界背景"], worldOverview, worldSection))}
${line("核心规则", pickFirst(worldData?.rules, worldData?.coreRules, worldData?.["核心规则"], "暗域存在分级与时间流速规则；找死系统以任务和抹杀机制推动主角进入高危场景。", storyBible.keyValues["核心规则"] || worldSection))}
${line("地域/势力结构", pickFirst(worldData?.regions, worldData?.factions, worldData?.["地域/势力结构"], "江城一中F级暗域泄漏点是当前开局核心地点；异管局、暗域、暗裔组织与高维文明试炼场构成后续势力/规则网络。", forceSection))}
${line("资源体系", pickFirst(worldData?.resources, worldData?.["资源体系"], bookRules.numericalSystemOverrides?.resourceTypes, storyBible.keyValues["环境规则"]))}
${line("社会秩序", pickFirst(worldData?.society, worldData?.order, worldData?.["社会秩序"], "表层是普通校园生活，暗线存在暗域泄漏、异管局清理队与高维文明试炼。"))}
${line("禁忌/传说/历史遗留问题", pickFirst(worldData?.taboo, worldData?.history, worldData?.["禁忌/传说/历史遗留问题"], backgroundOverview, backgroundData))}

六、世界层级 / 战力体系
${line("境界层级", pickFirst(powerData?.levels, powerData?.realms, powerData?.["境界层级"], "F/E/D/C/B/A/S/SS/SSS"))}
${line("力量来源", pickFirst(powerData?.source, powerData?.["力量来源"], bookRules.numericalSystemOverrides?.resourceTypes, powerSection))}
${line("晋升逻辑", pickFirst(powerData?.promotion, powerData?.["晋升逻辑"], "生存点数、属性点、异能碎片、规则结晶等资源推动成长。"))}
${line("战力限制", pickFirst(powerData?.limits, powerData?.["战力限制"], powerOverview))}
${line("关键门槛", pickFirst(powerData?.thresholds, powerData?.["关键门槛"], bookRules.numericalSystemOverrides?.hardCap))}
${line("高阶存在", pickFirst(powerData?.highLevelBeings, powerData?.["高阶存在"]))}

七、金手指设定
${line("金手指名称", pickFirst(cheatData?.name, cheatData?.title, cheatData?.["金手指名称"], "找死系统", storyBible.keyValues["金手指"]))}
${line("获得方式", pickFirst(cheatData?.obtain, cheatData?.source, cheatData?.["获得方式"], "开局绑定找死系统，被迫接受抹杀型找死任务。", storyBible.keyValues["触发"]))}
${line("核心能力", pickFirst(cheatData?.ability, cheatData?.coreAbility, cheatData?.["核心能力"], cheatOverview, storyBible.keyValues["能力上限"]))}
${line("使用代价", pickFirst(cheatData?.cost, cheatData?.price, cheatData?.["使用代价"], "完不成任务会被抹杀；任务本身要求主角进入高风险场景。", storyBible.keyValues["代价"]))}
${line("成长路径", pickFirst(cheatData?.growth, cheatData?.["成长路径"], "死里逃生后获得奖励，并随着任务升级逐步接触暗域、地下世界与高维文明真相。", storyBible.keyValues["成长"]))}
${line("限制条件", pickFirst(cheatData?.limits, cheatData?.conditions, cheatData?.["限制条件"], "任务失败会触发抹杀；任务场景通常具有真实死亡风险。", storyBible.keyValues["魔经容量"]))}
${line("与主线矛盾的关系", pickFirst(cheatData?.conflict, cheatData?.["与主线矛盾的关系"], "表面上系统逼主角找死，深层上系统关联文明试炼场与救世主培养。"))}

八、背景事件
${line("开局前重大事件", pickFirst(backgroundData?.openingBefore, backgroundData?.["开局前重大事件"], backgroundOverview, storyBible.keyValues["核心冲突"]))}
${line("主角过去经历", pickFirst(backgroundData?.protagonistPast, backgroundData?.["主角过去经历"], protagonistInfo.identity))}
${line("世界当前危机", pickFirst(backgroundData?.currentCrisis, backgroundData?.["世界当前危机"], currentConflict))}
${line("隐藏真相", pickFirst(backgroundData?.hiddenTruth, backgroundData?.["隐藏真相"], "系统与高维文明试炼场相关，主角是被培养的救世主；苏建国与苏清焰父亲线索牵出更深暗域真相。", authorCore, stateFacts["当前敌我"]))}
${line("推动主线的历史因果", pickFirst(backgroundData?.causality, backgroundData?.["推动主线的历史因果"], "十年前江城一中失踪案、H001号失踪者学生证、苏建国工作牌与苏清焰父亲线索共同推动暗域与系统真相。"))}

九、主要矛盾冲突
${line("外部矛盾", pickFirst(conflictsData?.external, conflictsData?.["外部矛盾"], storyConflict))}
${line("内部矛盾", pickFirst(conflictsData?.internal, conflictsData?.["内部矛盾"], protagonistWeakness))}
${line("阵营矛盾", pickFirst(conflictsData?.faction, conflictsData?.["阵营矛盾"], conflictOverview, stateFacts["当前敌我"]))}
${line("资源矛盾", pickFirst(conflictsData?.resource, conflictsData?.["资源矛盾"]))}
${line("情感/关系矛盾", pickFirst(conflictsData?.relationship, conflictsData?.["情感/关系矛盾"]))}
${line("终极矛盾", pickFirst(conflictsData?.ultimate, conflictsData?.["终极矛盾"], "人类文明被高维文明试炼，主角最终要在继续当棋子与反杀高维文明之间做出抉择。"))}

十、剧情大纲
${line("开局阶段", pickFirst(outlineData?.opening, outlineData?.["开局阶段"], volumes[0]?.goal, storyBible.keyValues["黄金三章"]))}
${line("前期目标", pickFirst(outlineData?.earlyGoal, outlineData?.["前期目标"], volumes[1]?.goal))}
${line("中期转折", pickFirst(outlineData?.midTurn, outlineData?.["中期转折"], volumes[2]?.goal))}
${line("后期升级", pickFirst(outlineData?.lateUpgrade, outlineData?.["后期升级"], volumes[3]?.goal))}
${line("最终方向", pickFirst(outlineData?.finalDirection, outlineData?.["最终方向"], authorPlot))}

十一、分卷计划
${formatVolumePlans(volumes)}

十二、故事灵感
${line("核心灵感来源", pickFirst(inspirationData?.source, inspirationData?.["核心灵感来源"], authorHighlights))}
${line("差异化卖点", pickFirst(inspirationData?.difference, inspirationData?.["差异化卖点"], "反套路系统文：系统不是发布打脸任务，而是逼主角去死。"))}
${line("适合宣传的爆点", pickFirst(inspirationData?.promo, inspirationData?.["适合宣传的爆点"], authorHighlights, introSection))}
${line("可用于短视频/推文的钩子", pickFirst(inspirationData?.shortVideoHooks, inspirationData?.["可用于短视频/推文的钩子"], "极致惜命的林默被找死系统逼到绝境，每次靠智商与运气极限拉扯，死里逃生。", pickFromSources(jsonSources, KEY_LABELS.sellingPoint)))}

十三、当前进度摘要
${line("当前章节", stateFacts["当前章节"])}
${line("当前位置", stateFacts["当前位置"])}
${line("当前危机", currentConflict)}
${line("已发生关键事件", chapterProgressText)}
${line("当前伏笔摘要", currentForeshadowText)}
`;
}

export function buildBookWritingRulesText(context) {
  const warnings = context.warnings || [];
  const bookDir = context.bookDir;
  const { json, text } = collectData(bookDir, warnings);
  const jsonSources = Object.values(json);
  const authorIntent = parseStoryBible(text[path.join("story", "author_intent.md")] || "");
  const bookRulesText = text[path.join("story", "book_rules.md")] || "";
  const bookRules = parseSimpleFrontmatter(bookRulesText);
  const bookRuleSections = parseStoryBible(stripCodeFence(bookRulesText));
  const currentState = parseCurrentStateMarkdown(text[path.join("story", "current_state.md")] || "");
  const auditDrift = parseStoryBible(text[path.join("story", "audit_drift.md")] || "");
  const currentFocus = parseStoryBible(text[path.join("story", "current_focus.md")] || "");

  const title = pickFirst(context.exportMeta?.title, pickFromSources(jsonSources, KEY_LABELS.title), context.book, context.bookName);
  const genre = pickFirst(sectionByPattern(authorIntent, /^题材/u), bookRules.genreLock?.primary, pickFromSources(jsonSources, KEY_LABELS.genre));
  const authorWriting = sectionByPattern(authorIntent, /^写作要求/u);
  const authorGenreRules = sectionByPattern(authorIntent, /^题材规则/u);
  const narrativeView = sectionByPattern(bookRuleSections, /^叙事视角/u);
  const conflictDriver = sectionByPattern(bookRuleSections, /^核心冲突驱动/u);
  const auditText = sectionByPattern(auditDrift, /审计纠偏/u);
  const focusText = sectionByPattern(currentFocus, /当前重点|重点/u);

  return `《${normalizeTextValue(title)}》写作规则卡

一、题材锁
${line("主分类", normalizeGenre(genre))}
${line("禁止偏移", bookRules.genreLock?.forbidden)}
${line("题材规则", authorGenreRules)}

二、人设锁
${line("主角姓名", bookRules.protagonist?.name)}
${line("主角性格锁", bookRules.protagonist?.personalityLock)}
${line("主角行为约束", bookRules.protagonist?.behavioralConstraints)}
${line("配角处理规则", pickFirst("女性角色不能沦为恋爱脑工具人；不能沦为完美女友或病弱女儿模板。", authorGenreRules))}

三、叙事视角与文风
${line("叙事视角", narrativeView)}
${line("文风要求", authorWriting)}
${line("写作要求", authorWriting)}
${line("节奏要求", conflictDriver)}

四、系统与金手指规则
${line("系统人格", "冷漠、机械音，但偶尔透露一丝人性。")}
${line("任务设计规则", "每次找死任务要有创意，不能重复；任务难度要循序渐进。")}
${line("面板使用规则", "避免蓝屏狂暴；系统面板不在战斗中频繁弹出。")}
${line("奖励节奏", "前期每1-3章一次奖励，中期每5-10章，后期阶层跨越大幅拉长。")}

五、战力与资源规则
${line("战力上限", bookRules.numericalSystemOverrides?.hardCap)}
${line("资源类型", bookRules.numericalSystemOverrides?.resourceTypes)}
${line("升级规则", "属性、技能必须有代价，并与风险、牺牲或问题解决绑定。")}
${line("数值限制", "战力体系要清晰，禁止无理由战力跳级。")}
${line("边际递减规则", "同类资源吸收必须体现边际递减。")}

六、禁写项
${normalizeTextValue(bookRules.prohibitions)}

七、审稿纠偏
${normalizeTextValue(auditText)}

八、下一章写作重点
${line("当前章节", currentState["当前章节"])}
${line("当前位置", currentState["当前位置"])}
${line("当前危机", currentState["当前冲突"])}
${line("当前重点", focusText)}
`;
}

export function writeBookWritingRulesFile(context) {
  const warnings = context.warnings || [];
  try {
    const content = buildBookWritingRulesText({ ...context, warnings });
    const targets = [path.join(context.publishDir, "book-writing-rules.txt")];
    if (context.alternatePublishDir) targets.push(path.join(context.alternatePublishDir, "book-writing-rules.txt"));
    for (const target of [...new Set(targets)]) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    return { ok: true, warnings, content };
  } catch (error) {
    warn(warnings, `生成 book-writing-rules.txt 失败：${error.message}`);
    return { ok: false, warnings };
  }
}

export function writeBookInfoFile(context) {
  const warnings = context.warnings || [];
  try {
    const content = buildBookInfoText({ ...context, warnings });
    const targets = [path.join(context.publishDir, "book-info.txt")];
    if (context.alternatePublishDir) targets.push(path.join(context.alternatePublishDir, "book-info.txt"));
    for (const target of [...new Set(targets)]) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    writeBookWritingRulesFile({ ...context, warnings });
    return { ok: true, warnings, content };
  } catch (error) {
    warn(warnings, `生成 book-info.txt 失败：${error.message}`);
    return { ok: false, warnings };
  }
}
