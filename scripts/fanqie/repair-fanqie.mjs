#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const i = trimmed.indexOf("=");
    if (i === -1) continue;

    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.join(os.homedir(), ".inkos", ".env"));
loadEnvFile(path.join(process.cwd(), ".env"));

const root = process.cwd();
const argv = process.argv.slice(2);

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

function flag(name) {
  return argv.includes(`--${name}`);
}

const bookName = argv[0] || "葬渊魔经";
const provider = (
  arg("provider") ||
  process.env.INKOS_LLM_PROVIDER ||
  "openai"
).toLowerCase();
const apiFormat =
  arg("api-format") ||
  process.env.INKOS_LLM_API_FORMAT ||
  "responses";
const model =
  arg("model") ||
  process.env.REPAIR_MODEL ||
  process.env.INKOS_MODEL ||
  process.env.INKOS_LLM_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-5.4";

const apiKey =
  process.env.INKOS_LLM_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.INKOS_API_KEY;

const baseUrl =
  process.env.INKOS_LLM_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  process.env.INKOS_BASE_URL ||
  (provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1");

const minScore = Number(arg("min", 4));
const apply = flag("apply");
const dryRun = flag("dry-run");

const outDir = path.join(root, "publish", bookName, "fanqie");
const chaptersDir = path.join(outDir, "chapters");
const reportFile = path.join(outDir, "report.md");
const repairedDir = path.join(outDir, "repaired");

if (!apiKey) {
  console.error("未找到 API KEY。请在 ~/.inkos/.env 中配置 INKOS_LLM_API_KEY，或按 provider 配置 OPENAI_API_KEY / ANTHROPIC_API_KEY。");
  process.exit(1);
}

if (!fs.existsSync(reportFile)) {
  console.error(`找不到 report.md：${reportFile}`);
  console.error("请先运行 export-fanqie.mjs。");
  process.exit(1);
}

if (!fs.existsSync(chaptersDir)) {
  console.error(`找不到章节目录：${chaptersDir}`);
  process.exit(1);
}

fs.mkdirSync(repairedDir, { recursive: true });

function parseWeakChapters(report) {
  const blocks = report.split(/^## /m).slice(1);
  const weak = [];

  for (const block of blocks) {
    const title = block.split("\n")[0].trim();
    const m = title.match(/^第(\d+)章/);
    if (!m) continue;

    const no = Number(m[1]);
    const scoreMatch = block.match(/6段检查：(\d+)\/6/);
    const score = scoreMatch ? Number(scoreMatch[1]) : 6;

    if (score >= minScore) continue;

    const missing = [];
    for (const item of ["Hook", "Pressure", "Attempt", "Twist", "Payoff", "Pull"]) {
      if (new RegExp(`❌\\s+${item}`).test(block)) missing.push(item);
    }

    weak.push({ no, title, score, missing });
  }

  return weak;
}

function chapterPath(no) {
  return path.join(chaptersDir, `${String(no).padStart(4, "0")}.txt`);
}

function buildPrompt({ chapter, missing }) {
  return `
你是中文网文编辑，任务是修复番茄小说发布版章节。

当前章节 6段检查未达标，缺失项：
${missing.join(" / ")}

请只修复缺失结构，不要整章重写。

要求：
1. 保留原剧情、人物、世界观、状态。
2. 不新增大设定，不改变后续走向。
3. 补齐缺失的 Hook / Pressure / Attempt / Twist / Payoff / Pull。
4. Payoff 必须有单句 moment。
5. 禁止模糊爆点：开始、似乎、逐渐、隐约。
6. 结尾必须有下一章拉力。
7. 字数控制在 1500-2500 字。
8. 输出完整修复后的章节正文，不要解释。

六段定义：
- Hook：开头3-5行有异常/危机/变化。
- Pressure：有持续威胁，时间/身体/规则至少一种。
- Attempt：主角必须主动做事。
- Twist：预期被打破，不只是压力加重。
- Payoff：必须有明确瞬间句。
- Pull：结尾留下新问题或更大危机。

可用 moment 示例：
- 门，被强行打开。
- 那一刻，他看懂了这份契约。
- 所有线索，在这一刻拼合。
- 他的真名，崩解了。

原章节如下：

${chapter}
`;
}

async function readErrorResponse(res) {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    if (typeof json.error === "string" && json.error) return `${res.status} ${json.error}`;
    if (json.error && typeof json.error === "object" && typeof json.error.message === "string") {
      return `${res.status} ${json.error.message}`;
    }
    if (typeof json.message === "string" && json.message) return `${res.status} ${json.message}`;
    if (typeof json.detail === "string" && json.detail) return `${res.status} ${json.detail}`;
  } catch {
    // fall through
  }
  return `${res.status} ${text || res.statusText}`.trim();
}

function wrapLLMError(error) {
  const msg = String(error);
  const ctxLine = `\n  (baseUrl: ${baseUrl}, model: ${model})`;

  if (msg.includes("400")) {
    return new Error(
      "API 返回 400 (请求参数错误)。可能原因：\n" +
      "  1. 模型名称不正确（检查 INKOS_LLM_MODEL）\n" +
      "  2. 提供方不支持某些参数（如 max_tokens、stream）\n" +
      "  3. 消息格式不兼容（部分提供方不支持 system role）\n" +
      `  建议：检查提供方文档，确认该接口要求流式开启、流式关闭，还是根本不支持 stream${ctxLine}`,
    );
  }
  if (msg.includes("403")) {
    return new Error(
      "API 返回 403 (请求被拒绝)。可能原因：\n" +
      "  1. API Key 无效或过期\n" +
      "  2. API 提供方的内容审查拦截了请求（公益/免费 API 常见）\n" +
      "  3. 账户余额不足\n" +
      `  建议：检查账号权限、余额，或更换 API 提供方${ctxLine}`,
    );
  }
  if (msg.includes("401")) {
    return new Error(
      `API 返回 401 (未授权)。请检查 ~/.inkos/.env 中的 INKOS_LLM_API_KEY 是否正确。${ctxLine}`,
    );
  }
  if (msg.includes("429")) {
    return new Error(
      `API 返回 429 (请求过多)。请稍后重试，或检查 API 配额。${ctxLine}`,
    );
  }
  if (msg.includes("Connection error") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
    return new Error(
      "无法连接到 API 服务。可能原因：\n" +
      `  1. baseUrl 地址不正确（当前：${baseUrl}）\n` +
      "  2. 网络不通或被防火墙拦截\n" +
      "  3. API 服务暂时不可用\n" +
      "  建议：检查 INKOS_LLM_BASE_URL 是否包含完整路径（如 /v1）",
    );
  }
  return error instanceof Error ? error : new Error(msg);
}

async function callAnthropic(prompt) {
  const url = `${baseUrl.replace(/\/$/, "")}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: Number(process.env.INKOS_LLM_MAX_TOKENS || 4096),
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw wrapLLMError(new Error(await readErrorResponse(res)));
  }

  const data = await res.json();
  const text = (data.content || [])
    .map((item) => item?.type === "text" ? item.text || "" : "")
    .join("")
    .trim();
  return text;
}

async function callOpenAICompatible(prompt) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (apiFormat === "chat") {
    const res = await fetch(`${normalizedBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      throw wrapLLMError(new Error(await readErrorResponse(res)));
    }

    const data = await res.json();
    return (data.choices?.[0]?.message?.content || "").trim();
  }

  const res = await fetch(`${normalizedBaseUrl}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: prompt,
      stream: false,
      store: false,
    }),
  });

  if (!res.ok) {
    throw wrapLLMError(new Error(await readErrorResponse(res)));
  }

  const data = await res.json();
  const text =
    data.output_text ||
    data.output?.flatMap((o) => o.content || [])
      ?.map((c) => c.text || "")
      ?.join("") ||
    "";

  return text.trim();
}

async function callLLM(prompt) {
  if (provider === "anthropic") {
    return callAnthropic(prompt);
  }
  return callOpenAICompatible(prompt);
}

function basicClean(text) {
  return text
    .replace(/^```[\w-]*\n?/g, "")
    .replace(/```$/g, "")
    .replace(/^\s*修复后章节[:：]?\s*/g, "")
    .trim();
}

function countChars(text) {
  return [...String(text || "").replace(/\s/g, "")].length;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

async function callLLMWithProgress({ prompt, chapterNo, missing }) {
  const startedAt = Date.now();
  console.log(
    `开始调用大模型：第 ${chapterNo} 章 | provider=${provider} | model=${model} | 缺失=${missing.join("/")} | prompt字数≈${countChars(prompt)}`,
  );

  const timer = setInterval(() => {
    console.log(`第 ${chapterNo} 章仍在等待大模型返回，已耗时 ${formatElapsed(Date.now() - startedAt)}...`);
  }, 10000);

  try {
    const result = await callLLM(prompt);
    console.log(
      `第 ${chapterNo} 章大模型返回完成，耗时 ${formatElapsed(Date.now() - startedAt)}，返回字数≈${countChars(result)}`,
    );
    return result;
  } finally {
    clearInterval(timer);
  }
}

const report = fs.readFileSync(reportFile, "utf8");
const weak = parseWeakChapters(report);

if (!weak.length) {
  console.log(`没有低于 ${minScore}/6 的章节。`);
  process.exit(0);
}

console.log(`发现 ${weak.length} 章需要修复。`);
console.log(`模型：${model}`);
console.log(`Provider：${provider}`);
console.log(`API：${baseUrl}`);
console.log(`API Format：${provider === "anthropic" ? "messages" : apiFormat}`);
console.log(apply ? "模式：修复后覆盖 chapters/" : "模式：只写入 repaired/，不覆盖");

try {
  for (const item of weak) {
    const file = chapterPath(item.no);

    if (!fs.existsSync(file)) {
      console.warn(`跳过：找不到章节文件 ${file}`);
      continue;
    }

    const chapter = fs.readFileSync(file, "utf8");
    const prompt = buildPrompt({ chapter, missing: item.missing });

    console.log(`\n修复第 ${item.no} 章：${item.missing.join("/")}`);

    if (dryRun) {
      console.log("dry-run：跳过 API 调用");
      continue;
    }

    const repaired = basicClean(await callLLMWithProgress({
      prompt,
      chapterNo: item.no,
      missing: item.missing,
    }));

    if (!repaired) {
      console.warn(`第 ${item.no} 章修复结果为空，跳过。`);
      continue;
    }

    const target = path.join(repairedDir, `${String(item.no).padStart(4, "0")}.txt`);
    fs.writeFileSync(target, repaired + "\n", "utf8");

    if (apply) {
      fs.writeFileSync(file, repaired + "\n", "utf8");
    }

    console.log(`完成：${path.relative(root, target)}${apply ? "，已覆盖发布章节" : ""}`);
  }
} catch (error) {
  const wrapped = wrapLLMError(error);
  console.error(wrapped.message);
  process.exit(1);
}

console.log("\n自动修复完成。");
console.log("建议重新运行 export-fanqie.mjs 做二次检查。");
