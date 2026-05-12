import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VALID_TYPES = new Set(["general", "fanqie", "promo", "shortvideo"]);

export function parseArgs(argv = process.argv.slice(2)) {
  const positional = [];
  const options = {
    type: "general",
    backup: false,
    model: "",
    apiFormat: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--backup") {
      options.backup = true;
      continue;
    }
    if (item === "--type" || item === "--model" || item === "--api-format") {
      const value = argv[i + 1];
      if (!value) throw new Error(`${item} 缺少参数值。`);
      const key = item === "--api-format" ? "apiFormat" : item.slice(2);
      options[key] = value;
      i += 1;
      continue;
    }
    if (item.startsWith("--")) throw new Error(`未知参数：${item}`);
    positional.push(item);
  }

  const book = positional[0];
  if (!book) throw new Error("请提供书名：node scripts/fanqie/polish-book-info.mjs <book>");
  if (!VALID_TYPES.has(options.type)) {
    throw new Error(`--type 只支持：${[...VALID_TYPES].join(" / ")}`);
  }

  return { book, ...options };
}

export function resolvePublishDir(root, book) {
  return path.join(root, "publish", book);
}

export function resolveInputFile(root, book) {
  return path.join(resolvePublishDir(root, book), "book-info.txt");
}

export function resolveOutputFile(root, book, type) {
  const names = {
    general: "book-info-polished.txt",
    fanqie: "book-info-fanqie.txt",
    promo: "book-info-promo.txt",
    shortvideo: "book-info-shortvideo.txt",
  };
  return path.join(resolvePublishDir(root, book), names[type]);
}

export function relativePath(root, file) {
  return path.relative(root, file) || ".";
}

export function loadBaseBookInfo({ root, book }) {
  const file = resolveInputFile(root, book);
  if (!fs.existsSync(file)) {
    throw new Error(
      [
        `找不到 book-info.txt：${relativePath(root, file)}`,
        "请先执行：",
        `node scripts/fanqie/export-fanqie.mjs ${book} --from <n> --to <m> --use-reviewed`,
      ].join("\n"),
    );
  }
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) throw new Error(`book-info.txt 为空：${relativePath(root, file)}`);
  return { file, text };
}

function commonSystemPrompt() {
  return `你是中文网文发布资料润色助手。
你的任务是基于用户提供的 book-info.txt 进行润色和包装。
book-info.txt 是事实源。
你不能编造与事实源冲突的新设定。
你不能新增事实源没有明确出现的人名、势力、卷名、章节计划、境界、结局、敌人或道具。
你不能把事实源中“待补充”的字段扩写成具体设定。
你不能补写事实源没有列出的第三卷、第四卷、后续卷或结局规划。
除非事实源明确出现，不要写“穿越、重生、系统、末世、修仙、连载中、订阅、新书、吞噬诸天”等类型或运营判断。
你不能改变主角、配角、世界观、金手指、主要矛盾。
你不能把“待补充”强行写成确定事实。
你可以将表达变得更顺、更有网文商业感。
你可以提炼卖点、标签、简介、宣传钩子。
如果信息不足，请保留“暂未明确”或“根据现有资料暂不展开”。
不要输出解释。
只输出最终润色后的中文纯文本。
输出中文纯文本，不输出 JSON，不输出 Markdown 表格，不输出代码块。
不要使用 Markdown 表格，不要使用竖线表格。
不要出现 undefined、null、[object Object]。
不要出现“作为一个 AI”等表达。`;
}

function typeInstruction(type) {
  if (type === "fanqie") {
    return `润色目标：生成适合番茄发布使用的作品资料版本。
要求：
- 作品简介更有网文吸引力。
- 标签更贴合番茄风格。
- 一句话卖点更抓人。
- 突出主角困境、金手指、逆袭、爽点、矛盾。
- 不剧透最终结局。
- 不虚构正文没有的信息。
- 不新增事实源没有的卷名、卷数、章节范围、敌人或后续剧情。
- 不写成传统文学简介。
- 不写成 AI 总结腔。`;
  }
  if (type === "promo") {
    return `润色目标：生成适合推文、图文号、公众号、引流文案使用的版本。
要求：
- 提炼爆点。
- 提炼卖点。
- 输出适合宣传的文案段落。
- 输出 5-10 个推广标题。
- 输出 3-5 个短简介。
- 输出 3-5 个开头钩子。
- 保持与 book-info.txt 事实一致。`;
  }
  if (type === "shortvideo") {
    return `润色目标：生成适合短视频口播、混剪、推书号使用的版本。
要求：
- 输出短视频口播脚本。
- 输出 5-10 个短视频标题。
- 输出 3 个不同风格的开头 3 秒钩子。
- 输出适合视频字幕的简介。
- 输出主角人设钩子。
- 输出核心冲突钩子。
- 不新增正文不存在的剧情。`;
  }
  return `润色目标：将 book-info.txt 润色成更清晰、更适合人工阅读的作品资料卡。
要求：
- 保留十二大模块结构。
- 语言更顺。
- 表达更完整。
- 不做强营销。
- 不夸张。
- 不改变事实。`;
}

export function buildPolishPrompt(baseText, type) {
  return `${commonSystemPrompt()}

${typeInstruction(type)}

下面是事实源 book-info.txt：

${baseText}
`;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function loadEnvFallback(root) {
  loadEnvFile(path.join(os.homedir(), ".inkos", ".env"));
  loadEnvFile(path.join(root, ".env"));
}

async function resolveLLMConfig({ root, model, apiFormat, loadProjectConfig }) {
  try {
    const config = await loadProjectConfig(root, { requireApiKey: true });
    return {
      ...config.llm,
      ...(model ? { model } : {}),
      ...(apiFormat ? { apiFormat } : {}),
      stream: false,
    };
  } catch (error) {
    if (!String(error?.message || error).includes("inkos.json not found")) throw error;
  }

  loadEnvFallback(root);
  const provider = (process.env.INKOS_LLM_PROVIDER || "openai").toLowerCase();
  const apiKey =
    process.env.INKOS_LLM_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.INKOS_API_KEY;
  const resolvedModel =
    model ||
    process.env.INKOS_LLM_MODEL ||
    process.env.INKOS_MODEL ||
    process.env.OPENAI_MODEL;
  const baseUrl =
    process.env.INKOS_LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.INKOS_BASE_URL ||
    (provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1");

  if (!apiKey) {
    throw new Error("未找到 API KEY。请在 ~/.inkos/.env 中配置 INKOS_LLM_API_KEY，或按 provider 配置 OPENAI_API_KEY / ANTHROPIC_API_KEY。");
  }
  if (!resolvedModel) {
    throw new Error("未找到模型配置。请设置 INKOS_LLM_MODEL，或传入 --model <model>。");
  }

  return {
    provider,
    baseUrl,
    apiKey,
    model: resolvedModel,
    apiFormat: apiFormat || process.env.INKOS_LLM_API_FORMAT || "chat",
    temperature: Number(process.env.INKOS_LLM_TEMPERATURE || 0.4),
    maxTokens: Number(process.env.INKOS_LLM_MAX_TOKENS || 8192),
    thinkingBudget: Number(process.env.INKOS_LLM_THINKING_BUDGET || 0),
    stream: false,
  };
}

export async function callLLM(prompt, options) {
  const core = await import(pathToFileURL(path.join(options.root, "packages", "core", "dist", "index.js")).href);
  const { chatCompletion, createLLMClient, loadProjectConfig } = core;
  const llmConfig = await resolveLLMConfig({
    root: options.root,
    model: options.model,
    apiFormat: options.apiFormat,
    loadProjectConfig,
  });
  const client = createLLMClient(llmConfig);
  const response = await chatCompletion(
    client,
    llmConfig.model,
    [{ role: "user", content: prompt }],
    {
      temperature: 0.4,
      maxTokens: Number(process.env.INKOS_BOOK_INFO_MAX_TOKENS || process.env.INKOS_LLM_MAX_TOKENS || 8192),
      command: "polish-book-info",
      stage: options.type,
      projectRoot: options.root,
    },
  );
  return response.content;
}

export function cleanLLMText(text) {
  return String(text || "")
    .replace(/^```[\w-]*\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim();
}

export function validatePolishedText(text, sourceText = "") {
  if (!text.trim()) throw new Error("LLM 返回内容为空。");
  if (/\[object Object\]|undefined|null/u.test(text)) {
    throw new Error("LLM 返回内容包含 undefined/null/[object Object]，已取消写入。");
  }
  if (/作为一个\s*AI|作为AI/u.test(text)) {
    throw new Error("LLM 返回内容包含 AI 自述，已取消写入。");
  }
  if (/^\s*\|.+\|\s*$/mu.test(text)) {
    throw new Error("LLM 返回内容包含 Markdown 表格，已取消写入。");
  }
  for (const volume of ["第三卷", "第四卷", "第五卷", "第六卷", "终卷"]) {
    if (text.includes(volume) && !sourceText.includes(volume)) {
      throw new Error(`LLM 返回内容新增了事实源未包含的“${volume}”，已取消写入。`);
    }
  }
  const highRiskTerms = [
    "重生",
    "系统",
    "穿越",
    "末世",
    "修仙",
    "三界",
    "阎王",
    "屠尽",
    "吃干净",
    "正在连载",
    "番茄连载",
    "订阅",
    "新书",
    "吞噬诸天",
    "吞噬苍生",
    "囚魔阵破",
    "半魔苏醒",
    "全属性",
    "身无分文",
    "只用了10章",
    "仇人名字",
  ];
  for (const term of highRiskTerms) {
    if (text.includes(term) && !sourceText.includes(term)) {
      throw new Error(`LLM 返回内容新增了事实源未包含的高风险词“${term}”，已取消写入。`);
    }
  }
}

export function backupIfNeeded(file) {
  if (!fs.existsSync(file)) return "";
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
  const backupFile = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, backupFile);
  return backupFile;
}

export function writePolishedBookInfo(file, text, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backupFile = options.backup ? backupIfNeeded(file) : "";
  const tmpFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, `${text.trim()}\n`, "utf8");
  fs.renameSync(tmpFile, file);
  return { file, backupFile };
}

export async function polishBookInfo({ root, book, type = "general", backup = false, model = "", apiFormat = "" }) {
  const base = loadBaseBookInfo({ root, book });
  const outputFile = resolveOutputFile(root, book, type);
  const prompt = buildPolishPrompt(base.text, type);
  const raw = await callLLM(prompt, { root, type, model, apiFormat });
  const text = cleanLLMText(raw);
  validatePolishedText(text, base.text);
  const written = writePolishedBookInfo(outputFile, text, { backup });
  return {
    inputFile: base.file,
    outputFile: written.file,
    backupFile: written.backupFile,
  };
}
