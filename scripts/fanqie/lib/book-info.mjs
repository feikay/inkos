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
];

const KNOWN_TEXT_FILES = [
  path.join("story", "story_bible.md"),
  path.join("story", "character_matrix.md"),
  path.join("story", "volume_outline.md"),
  path.join("story", "current_state.md"),
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
  if (/玄幻|仙侠|修仙|都市|悬疑|高武|男频/u.test(text)) return "男频";
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
  const storyBible = parseStoryBible(text[path.join("story", "story_bible.md")] || "");
  const genreProfile = parseSimpleYaml(text[path.join("story", "genre_profile.yaml")] || "");
  const stateFacts = extractCurrentStateFacts(json[path.join("story", "state", "current_state.json")]);
  const characters = collectCharacters(jsonSources, text[path.join("story", "character_matrix.md")]);
  const protagonist = normalizeCharacter(
    pickFirst(pickFromSources(jsonSources, KEY_LABELS.protagonist), characters.find(isProtagonist), characters[0])
  );
  const protagonistInfo = formatProtagonist(protagonist, stateFacts);
  const supporting = characters
    .filter((character) => character.name !== protagonist.name)
    .slice(0, 8);
  const volumes = [
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
  const genre = pickFirst(pickFromSources(jsonSources, KEY_LABELS.genre), genreProfile.label, genreProfile.template);
  const mainCategory = pickFirst(
    pickFromSources(jsonSources, KEY_LABELS.mainCategory),
    inferMainCategory(genre, genreProfile.label)
  );

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
${line("主题关键词", pickFirst(pickFromSources(jsonSources, KEY_LABELS.themeKeywords), storyBible.keyValues["主题"], genreProfile.tone))}
${line("角色关键词", pickFromSources(jsonSources, KEY_LABELS.roleKeywords))}
${line("情节关键词", pickFirst(pickFromSources(jsonSources, KEY_LABELS.plotKeywords), genreProfile.core_loop))}
${line("作品标签", pickFromSources(jsonSources, KEY_LABELS.tags))}
${line("一句话卖点", pickFromSources(jsonSources, KEY_LABELS.sellingPoint))}
${line("简介", pickFirst(pickFromSources(jsonSources, KEY_LABELS.description), storyBible.keyValues["简介"], introSection))}

三、主角设定
${line("主角姓名", protagonistInfo.name)}
${line("身份背景", pickFirst(protagonistInfo.identity, storyBible.keyValues["身份"], protagonistSection))}
${line("性格特征", pickFirst(protagonistInfo.personality, storyBible.keyValues["性格"]))}
${line("形象特征", protagonistInfo.appearance)}
${line("核心欲望", protagonistInfo.desire)}
${line("核心弱点", protagonistInfo.weakness)}
${line("成长方向", protagonistInfo.growth)}

四、主要配角设定
${supporting.length ? supporting.map((character, index) => formatCharacter(character, index + 1)).join("\n\n") : "1. 配角姓名：待补充\n   身份：待补充\n   性格特征：待补充\n   形象特征：待补充\n   与主角关系：待补充\n   剧情功能：待补充"}

五、世界观设定
${line("世界背景", pickFirst(worldData?.background, worldData?.["世界背景"], worldSection))}
${line("核心规则", pickFirst(worldData?.rules, worldData?.coreRules, worldData?.["核心规则"], storyBible.keyValues["核心规则"] || worldSection))}
${line("地域/势力结构", pickFirst(worldData?.regions, worldData?.factions, worldData?.["地域/势力结构"], forceSection))}
${line("资源体系", pickFirst(worldData?.resources, worldData?.["资源体系"], storyBible.keyValues["环境规则"]))}
${line("社会秩序", pickFirst(worldData?.society, worldData?.order, worldData?.["社会秩序"]))}
${line("禁忌/传说/历史遗留问题", pickFirst(worldData?.taboo, worldData?.history, worldData?.["禁忌/传说/历史遗留问题"], backgroundData))}

六、世界层级 / 战力体系
${line("境界层级", pickFirst(powerData?.levels, powerData?.realms, powerData?.["境界层级"], storyBible.keyValues["世界层级"]))}
${line("力量来源", pickFirst(powerData?.source, powerData?.["力量来源"], powerSection))}
${line("晋升逻辑", pickFirst(powerData?.promotion, powerData?.["晋升逻辑"]))}
${line("战力限制", pickFirst(powerData?.limits, powerData?.["战力限制"]))}
${line("关键门槛", pickFirst(powerData?.thresholds, powerData?.["关键门槛"]))}
${line("高阶存在", pickFirst(powerData?.highLevelBeings, powerData?.["高阶存在"]))}

七、金手指设定
${line("金手指名称", pickFirst(cheatData?.name, cheatData?.title, cheatData?.["金手指名称"], storyBible.keyValues["金手指"]))}
${line("获得方式", pickFirst(cheatData?.obtain, cheatData?.source, cheatData?.["获得方式"], storyBible.keyValues["触发"]))}
${line("核心能力", pickFirst(cheatData?.ability, cheatData?.coreAbility, cheatData?.["核心能力"], storyBible.keyValues["能力上限"]))}
${line("使用代价", pickFirst(cheatData?.cost, cheatData?.price, cheatData?.["使用代价"], storyBible.keyValues["代价"]))}
${line("成长路径", pickFirst(cheatData?.growth, cheatData?.["成长路径"], storyBible.keyValues["成长"]))}
${line("限制条件", pickFirst(cheatData?.limits, cheatData?.conditions, cheatData?.["限制条件"], storyBible.keyValues["魔经容量"]))}
${line("与主线矛盾的关系", pickFirst(cheatData?.conflict, cheatData?.["与主线矛盾的关系"]))}

八、背景事件
${line("开局前重大事件", pickFirst(backgroundData?.openingBefore, backgroundData?.["开局前重大事件"], storyBible.keyValues["核心冲突"]))}
${line("主角过去经历", pickFirst(backgroundData?.protagonistPast, backgroundData?.["主角过去经历"], protagonistInfo.identity))}
${line("世界当前危机", pickFirst(backgroundData?.currentCrisis, backgroundData?.["世界当前危机"], currentConflict))}
${line("隐藏真相", pickFirst(backgroundData?.hiddenTruth, backgroundData?.["隐藏真相"], stateFacts["当前敌我"]))}
${line("推动主线的历史因果", pickFirst(backgroundData?.causality, backgroundData?.["推动主线的历史因果"]))}

九、主要矛盾冲突
${line("外部矛盾", pickFirst(conflictsData?.external, conflictsData?.["外部矛盾"], currentConflict))}
${line("内部矛盾", pickFirst(conflictsData?.internal, conflictsData?.["内部矛盾"], protagonistInfo.weakness))}
${line("阵营矛盾", pickFirst(conflictsData?.faction, conflictsData?.["阵营矛盾"], stateFacts["当前敌我"]))}
${line("资源矛盾", pickFirst(conflictsData?.resource, conflictsData?.["资源矛盾"]))}
${line("情感/关系矛盾", pickFirst(conflictsData?.relationship, conflictsData?.["情感/关系矛盾"]))}
${line("终极矛盾", pickFirst(conflictsData?.ultimate, conflictsData?.["终极矛盾"]))}

十、剧情大纲
${line("开局阶段", pickFirst(outlineData?.opening, outlineData?.["开局阶段"], storyBible.keyValues["黄金三章"]))}
${line("前期目标", pickFirst(outlineData?.earlyGoal, outlineData?.["前期目标"], volumes[0]?.goal))}
${line("中期转折", pickFirst(outlineData?.midTurn, outlineData?.["中期转折"], volumes[1]?.hook))}
${line("后期升级", pickFirst(outlineData?.lateUpgrade, outlineData?.["后期升级"], volumes[2]?.goal))}
${line("最终方向", pickFirst(outlineData?.finalDirection, outlineData?.["最终方向"]))}

十一、分卷计划
${buildVolumeText(volumes, 0)}

${buildVolumeText(volumes, 1)}

十二、故事灵感
${line("核心灵感来源", pickFirst(inspirationData?.source, inspirationData?.["核心灵感来源"]))}
${line("差异化卖点", pickFirst(inspirationData?.difference, inspirationData?.["差异化卖点"], pickFromSources(jsonSources, KEY_LABELS.sellingPoint)))}
${line("适合宣传的爆点", pickFirst(inspirationData?.promo, inspirationData?.["适合宣传的爆点"], introSection))}
${line("可用于短视频/推文的钩子", pickFirst(inspirationData?.shortVideoHooks, inspirationData?.["可用于短视频/推文的钩子"], pickFromSources(jsonSources, KEY_LABELS.sellingPoint)))}
`;
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
    return { ok: true, warnings, content };
  } catch (error) {
    warn(warnings, `生成 book-info.txt 失败：${error.message}`);
    return { ok: false, warnings };
  }
}
