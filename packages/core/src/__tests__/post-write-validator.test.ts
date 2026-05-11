import { describe, it, expect } from "vitest";
import {
  detectDuplicateTitle,
  detectParagraphLengthDrift,
  detectParagraphShapeWarnings,
  evaluateChapterGoalDiscipline,
  evaluateEndingTypeCompliance,
  evaluateHookEmergenceCompliance,
  evaluateMoodCadenceCompliance,
  evaluatePayoffImpact,
  evaluateEndingIsomorphism,
  evaluateHookDebtThrottle,
  evaluateResourceLedgerDiscipline,
  resolveDuplicateTitle,
  toDisciplineWarnings,
  toEndingTypeWarnings,
  toMoodCadenceWarnings,
  toPayoffImpactWarnings,
  toEndingIsomorphismWarnings,
  toHookEmergenceWarnings,
  toHookDebtWarnings,
  toResourceLedgerWarnings,
  validatePostWrite,
  type PostWriteViolation,
} from "../agents/post-write-validator.js";
import type { GenreProfile } from "../models/genre-profile.js";
import {
  detectCollapsedTitleAnchor,
  enforceFinalTitleAnchorGuard,
  extractTitleCoreAnchor,
  hasInvalidTitleIntegrity,
  normalizeRepeatedTitleShell,
} from "../utils/chapter-title-engine.js";

const baseProfile: GenreProfile = {
  id: "test",
  name: "测试",
  language: "zh",
  chapterTypes: [],
  fatigueWords: [],
  pacingRule: "",
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  auditDimensions: [],
  satisfactionTypes: [],
};

function findRule(violations: ReadonlyArray<PostWriteViolation>, rule: string): PostWriteViolation | undefined {
  return violations.find(v => v.rule === rule);
}

describe("validatePostWrite", () => {
  it("returns no violations for clean content", () => {
    const content = "他走过去，端起杯子，灌了一口。外面的雨越下越大。\n\n她站在窗前，看着街上的行人匆匆走过。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(result).toHaveLength(0);
  });

  it("detects '不是…而是…' pattern", () => {
    const content = "这不是勇气，而是愚蠢。他知道这一点。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "禁止句式")).toBeDefined();
    expect(findRule(result, "禁止句式")!.severity).toBe("error");
  });

  it("detects dash '——'", () => {
    const content = "他走了过去——然后停下来。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "禁止破折号")).toBeDefined();
    expect(findRule(result, "禁止破折号")!.severity).toBe("error");
  });

  it("skips Chinese-only rules when the book language override is English", () => {
    const content = "He stepped forward——then stopped at the door.";
    const validateWithLanguage = validatePostWrite as (
      content: string,
      genreProfile: GenreProfile,
      bookRules: null,
      languageOverride?: "zh" | "en",
    ) => ReadonlyArray<PostWriteViolation>;

    const result = validateWithLanguage(content, baseProfile, null, "en");

    expect(findRule(result, "禁止破折号")).toBeUndefined();
  });

  it("detects surprise marker density exceeding threshold", () => {
    // ~100 chars total, threshold = max(1, floor(100/3000)) = 1, but we put 3 markers
    const content = "他忽然站起来。仿佛听到了什么声音。竟然是那个人回来了。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "转折词密度")).toBeDefined();
  });

  it("allows markers within threshold", () => {
    // 3000+ chars with only 1 marker
    const filler = "这是一段很长的正文内容，描述了角色的行动和场景的变化。".repeat(60);
    const content = `${filler}他忽然站起来。${filler}`;
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "转折词密度")).toBeUndefined();
  });

  it("detects fatigue words from genre profile", () => {
    const profile = { ...baseProfile, fatigueWords: ["一道目光"] };
    const content = "一道目光扫过来，又一道目光从侧面射来，第三道目光也来了。";
    const result = validatePostWrite(content, profile, null);
    expect(findRule(result, "高疲劳词")).toBeDefined();
  });

  it("detects meta-narration patterns", () => {
    const content = "故事发展到了这里，主角终于做出了选择。他站起来走向门口。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "元叙事")).toBeDefined();
  });

  it("detects report-style terms in prose", () => {
    const content = "他的核心动机其实很简单，就是想活下去。信息边界在此刻变得模糊。";
    const result = validatePostWrite(content, baseProfile, null);
    const v = findRule(result, "报告术语");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(v!.description).toContain("核心动机");
    expect(v!.description).toContain("信息边界");
  });

  it("detects sermon words", () => {
    const content = "显然，对方低估了他的实力。毋庸置疑，这将是一场硬仗。";
    const result = validatePostWrite(content, baseProfile, null);
    const v = findRule(result, "作者说教");
    expect(v).toBeDefined();
    expect(v!.description).toContain("显然");
    expect(v!.description).toContain("毋庸置疑");
  });

  it("detects collective shock patterns", () => {
    const content = "众人齐齐震惊，没有人想到他居然能赢。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "集体反应")).toBeDefined();
  });

  it("detects character exposition phrasing", () => {
    const content = "他意识到再退一步就会彻底失去机会。这意味着今晚必须赌命。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "character-exposition")).toBeDefined();
    expect(findRule(result, "character-exposition")?.severity).toBe("error");
  });

  it("detects direct emotion telling", () => {
    const content = "他很愤怒，也很紧张，却还是往前走去。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "emotion-telling")).toBeDefined();
    expect(findRule(result, "emotion-telling")?.severity).toBe("error");
  });

  it("detects perfect decision language", () => {
    const content = "他毫不犹豫地做出最正确的选择，立刻找到了唯一最优解。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "perfect-decision")).toBeDefined();
  });

  it("detects world-exposition as a hard fail", () => {
    const content = "按照这个世界的战力规则，三转之后才能压过二转，这意味着他现在绝无胜算。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "world-exposition")).toBeDefined();
    expect(findRule(result, "world-exposition")?.severity).toBe("error");
  });

  it("does not flag pure behavior expression as character exposition", () => {
    const content = "他停下脚步，没有回头。手指却已经扣紧了袖口，呼吸也压得更低。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "character-exposition")).toBeUndefined();
    expect(findRule(result, "emotion-telling")).toBeUndefined();
  });

  it("detects cognitive-jump when direct realization appears without perception and reaction process", () => {
    const content = "他意识到自己被盯上了。这说明对方已经摸到了他的路线。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "cognitive-jump")).toBeDefined();
    expect(findRule(result, "cognitive-jump")?.severity).toBe("error");
  });

  it("does not flag cognitive-jump when realization is unfolded through perception and reaction", () => {
    const content = "背后的脚步声忽然停了。他脚下一顿，没有回头，手指却先扣紧了袖口。下一息，他把身形偏向墙根。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "cognitive-jump")).toBeUndefined();
  });

  it("detects action-density-low when a realization chain carries only one sensory cue and one thin action", () => {
    const content = "背后的脚步声忽然停了。他停下脚步。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "action-density-low")).toBeDefined();
  });

  it("does not flag action-density-low when the realization chain has multiple sensory cues and a physical reaction", () => {
    const content = "背后的脚步声忽然停了，石壁上的回音也跟着断了一截，冷意顺着后颈慢慢爬上来。他脚下一顿，没有回头，手指却已经扣紧了袖口。";
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "action-density-low")).toBeUndefined();
  });

  it("detects consecutive '了' sentences", () => {
    const content = "他走了过去。他拿了杯子。他喝了一口。他放了下来。他转了身。他叹了口气。他摇了摇头。";
    const result = validatePostWrite(content, baseProfile, null);
    const v = findRule(result, "连续了字");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  it("detects overly long paragraphs", () => {
    const longPara = "这是一段非常长的段落。".repeat(30); // ~300+ chars
    const content = `${longPara}\n\n${longPara}\n\n短段落。`;
    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "段落过长")).toBeDefined();
  });

  it("detects fragmented short paragraphs in Chinese prose", () => {
    const content = [
      "门开了。",
      "他没进去。",
      "先听了一下。",
      "里面没有声响。",
      "他才把手按上去。",
      "冷意顺着门缝钻出来。",
    ].join("\n\n");

    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "段落过碎")).toBeDefined();
    expect(findRule(result, "段落过碎")?.severity).toBe("warning");
  });

  it("detects runs of consecutive short paragraphs", () => {
    const content = [
      "他绕过柜台，把灯挪到门边，先看了一眼地上的水印，确认脚印是新的。",
      "门虚掩着。",
      "风从外面钻进来。",
      "他没有立刻追出去。",
      "他先低头，看见门槛上沾了一点灰黑色的泥。",
    ].join("\n\n");

    const result = validatePostWrite(content, baseProfile, null);
    expect(findRule(result, "连续短段")).toBeDefined();
    expect(findRule(result, "连续短段")?.severity).toBe("warning");
  });

  it("detects book-level prohibitions", () => {
    const bookRules = {
      version: "1",
      protagonist: { name: "张三", personalityLock: [], behavioralConstraints: [] },
      prohibitions: ["跪舔"],
      genreLock: { primary: "xuanhuan" as const, forbidden: [] },
      chapterTypesOverride: [],
      fatigueWordsOverride: [],
      additionalAuditDimensions: [],
      enableFullCastTracking: false,
      allowedDeviations: [],
    };
    const content = "他一脸跪舔的样子让人恶心。";
    const result = validatePostWrite(content, baseProfile, bookRules);
    expect(findRule(result, "本书禁忌")).toBeDefined();
  });

  it("does not flag allowed content", () => {
    // Content that is clean across all rules
    const content = `他站起来，环顾四周。窗外的月光洒在地板上，像一层薄薄的霜。\n\n\u201c走吧。\u201d她转身推开门。冷风从缝隙里钻进来，她裹紧了衣服。`;
    const result = validatePostWrite(content, baseProfile, null);
    expect(result).toHaveLength(0);
  });

  it("warns when an English multi-character scene has almost no direct exchange", () => {
    const content = [
      "Mara cornered Taryn in the archive and kept the ledger between them.",
      "Mara demanded a clear answer about the missing page while Taryn refused to meet her eyes.",
      "Taryn stepped back toward the window and Mara followed without letting the pressure break.",
    ].join(" ");

    const result = validatePostWrite(content, baseProfile, null, "en");
    expect(findRule(result, "Dialogue pressure")).toBeDefined();
    expect(findRule(result, "Dialogue pressure")?.severity).toBe("warning");
  });

  it("detects paragraph density drift against recent chapters", () => {
    const recent = [
      "他把伞挂在门边，又低头看了一眼鞋底带进来的泥。柜台后的热水壶正轻轻作响，白气沿着玻璃慢慢爬上去。林越没有急着开口，只先把屋里的灯都扫了一遍，确认少了一盏。",
      "",
      "姜敏把账本推过来时，手指还压在封皮边上，没有立刻松开。她先问他是不是又去找过旧港的人，然后才把下午听到的消息一点点拆开说，连谁在门口停过脚都没漏掉。",
      "",
      "---",
      "",
      "他靠着墙站了半分钟，才把那张折过三次的纸重新摊开。纸上的字不多，但每一行都像故意留了半截，逼着他把前后几天听到的话重新拼回去。",
      "",
      "外面的雨势已经压下来，棚顶被打得一阵紧一阵。林越没有马上下楼，而是先把窗推开一条缝，让冷风吹进来，把刚才在屋里积住的闷气慢慢散掉。",
    ].join("\n\n");
    const current = [
      "他停下。",
      "先看门。",
      "又看窗。",
      "没人说话。",
      "他这才进去。",
      "屋里很冷。",
    ].join("\n\n");

    const result = detectParagraphLengthDrift(current, recent, "zh");
    expect(findRule(result, "段落密度漂移")).toBeDefined();
    expect(findRule(result, "段落密度漂移")?.severity).toBe("warning");
  });

  it("exposes paragraph shape warnings for final-stage reuse", () => {
    const current = [
      "他停下。",
      "先看门。",
      "又看窗。",
      "没人说话。",
      "他这才进去。",
      "屋里很冷。",
    ].join("\n\n");

    const result = detectParagraphShapeWarnings(current, "zh");
    expect(findRule(result, "段落过碎")).toBeDefined();
    expect(findRule(result, "连续短段")).toBeDefined();
  });

  it("detects duplicate chapter titles", () => {
    const result = detectDuplicateTitle("回声", ["旧路", "回声"]);
    expect(findRule(result, "duplicate-title")).toBeDefined();
  });

  it("detects near-duplicate chapter titles", () => {
    const result = detectDuplicateTitle("Echo-2", ["Echo 2"]);
    expect(findRule(result, "near-duplicate-title")).toBeDefined();
  });

  it("prefers regenerating a duplicate title from chapter content before numeric suffix fallback", () => {
    const result = resolveDuplicateTitle(
      "回声",
      ["旧路", "回声"],
      "zh",
      {
        content: "塔楼里的铜铃只响了一声，风从缺口灌进来，守夜人没有回头。",
      },
    );

    expect(result.title).toContain("塔楼");
    expect(result.title).not.toBe("回声（2）");
  });

  it("regenerates a title when it continues a collapsed recent title shell", () => {
    const result = resolveDuplicateTitle(
      "名单未落",
      ["名单之前", "名单之后", "名单还在"],
      "zh",
      {
        content: "塔楼里的铜铃只响了一声，守夜人没有回头，风从缺口灌进来。",
      },
    );

    expect(result.issues.some((issue) => issue.rule === "title-collapse-warning")).toBe(true);
    expect(result.title).not.toContain("名单");
    expect(result.title).toContain("塔楼");
  });

  it("keeps the current strong title when collapsed-title regeneration only finds a weak name replacement", () => {
    const result = resolveDuplicateTitle(
      "暗河尽头前的死局",
      ["死局将至", "死局再近", "死局未解"],
      "zh",
      {
        content: "云岚站在暗河边，没有回头。",
      },
    );

    expect(result.issues.some((issue) => issue.rule === "title-collapse-warning")).toBe(true);
    expect(result.title).toBe("暗河尽头前的死局");
  });

  it("rejects corrupted fragment replacements and falls back to the original title", () => {
    const result = resolveDuplicateTitle(
      "暗河尽头前的死局",
      ["死局将至", "死局再近", "死局未解"],
      "zh",
      {
        content: "索并未因暗河尽头前的杀机消散，众人只是更安静地握紧兵器。",
      },
    );

    expect(result.title).toBe("暗河尽头前的死局");
    expect(result.title).not.toBe("索并未因");
  });

  it("extracts the shared core anchor from collapsed recent titles", () => {
    expect(extractTitleCoreAnchor("暗河尽头前的死局", "zh")).toBe("暗河尽头");
    expect(extractTitleCoreAnchor("暗河尽头的秘密", "zh")).toBe("暗河尽头");
    expect(detectCollapsedTitleAnchor(
      "暗河尽头前的死局",
      ["暗河尽头的秘密", "暗河尽头前的死局：探索并未", "暗河尽头前的死局：楚夜云岚击败"],
      "zh",
    )).toBe("暗河尽头");
  });

  it("rejects a collapsed anchor title and regenerates around a new anchor", () => {
    const result = resolveDuplicateTitle(
      "暗河尽头前的死局",
      [
        "暗河尽头的秘密",
        "暗河尽头前的死局：探索并未",
        "暗河尽头前的死局：楚夜云岚击败",
        "暗河尽头前的死局：楚夜云岚站暗",
      ],
      "zh",
      {
        content: "黑袍人掀开兜帽，露出第二张脸。蚀骨碑后的活祭者也从石缝里走了出来。",
      },
    );

    expect(result.issues.some((issue) => issue.rule === "title-collapse-warning")).toBe(true);
    expect(result.title).not.toContain("暗河尽头");
    expect(["黑袍人的第二张脸", "蚀骨碑后的活祭者"]).toContain(result.title);
  });

  it("treats fragment replacements like 楚夜云岚站暗 and 探索并未 as invalid", () => {
    expect(hasInvalidTitleIntegrity("楚夜云岚站暗", "zh")).toBe(true);
    expect(hasInvalidTitleIntegrity("探索并未", "zh")).toBe(true);
  });

  it("keeps the previous strong candidate when the final adjusted title still hits a collapsed anchor", () => {
    const finalTitle = enforceFinalTitleAnchorGuard({
      language: "zh",
      finalTitle: "暗河尽头的古老祭坛",
      fallbackTitle: "未知强敌威胁逼近之时",
      recentTitles: [
        "暗河尽头的秘密",
        "暗河尽头前的死局：探索并未",
        "暗河尽头前的死局：楚夜云岚击败",
        "暗河尽头前的死局：楚夜云岚站暗",
      ],
    });

    expect(finalTitle).toBe("未知强敌威胁逼近之时");
  });

  it("compresses repeated title shells without damaging normal colon titles", () => {
    expect(normalizeRepeatedTitleShell("线索背后的代价：线索背后的代价")).toBe("线索背后的代价");
    expect(normalizeRepeatedTitleShell("线索背后的代价:线索背后的代价")).toBe("线索背后的代价");
    expect(normalizeRepeatedTitleShell("  线索背后的代价 - 线索背后的代价  ")).toBe("线索背后的代价");
    expect(normalizeRepeatedTitleShell("线索背后的代价｜线索背后的代价")).toBe("线索背后的代价");
    expect(normalizeRepeatedTitleShell("线索背后的代价 | 线索背后的代价")).toBe("线索背后的代价");
    expect(normalizeRepeatedTitleShell("血债：旧案重启")).toBe("血债：旧案重启");
  });

  it("allows a replacement when the current title is weak and the regenerated title is more usable", () => {
    const result = resolveDuplicateTitle(
      "暗河尽头的灵气结晶和花草果实",
      ["果实之前", "果实之后", "果实还在"],
      "zh",
      {
        content: "塔楼钟影压了下来，追兵踩碎了最后一层浮苔。",
      },
    );

    expect(result.title).toContain("塔楼");
    expect(result.title).not.toBe("暗河尽头的灵气结晶和花草果实");
  });

  it("matches ending hook signals against the ending region", () => {
    const checks = evaluateChapterGoalDiscipline(
      [
        "他整章都在追查石碑来历，却始终没有说破。",
        "",
        "直到最后，碑灵低声道出一句话：那块石碑原本属于秦家的禁地。",
      ].join("\n\n"),
      {
        mainConflict: "石碑来历压在身世之谜上。",
        protagonistGoal: "逼出石碑真正的来历。",
        activeCharacters: ["秦枭", "碑灵"],
        foreshadowToTouch: ["black-stele"],
        payoffToDeliver: "道出石碑真正的来历",
        endingHookType: "reveal",
        nextChapterPull: "这条来历会把禁地线彻底扯出来。",
      },
    );

    expect(checks.endingHookCheck.matched).toBe(true);
    expect(checks.endingHookCheck.evidence).toContain("道出一句话");
  });

  it("treats pursuit-start signals in the ending region as a valid pursuit hook", () => {
    const checks = evaluateChapterGoalDiscipline(
      [
        "楚夜一路清理痕迹，想趁夜翻出岩窟。",
        "",
        "章尾时，追兵发现岩壁徽记，开始追踪。",
      ].join("\n\n"),
      {
        mainConflict: "楚夜还没真正摆脱追捕。",
        protagonistGoal: "先逃出岩窟。",
        activeCharacters: ["楚夜", "追兵"],
        foreshadowToTouch: [],
        payoffToDeliver: "逃离追捕",
        endingHookType: "pursuit",
        nextChapterPull: "追踪已经启动，下章会更危险。",
      },
    );

    expect(checks.endingHookCheck.matched).toBe(true);
    expect(checks.endingHookCheck.evidence).toContain("开始追踪");
  });

  it("turns a completely missing payoff into a hard fail", () => {
    const checks = evaluateChapterGoalDiscipline(
      "他一路逃命，只是暂时甩开了追兵，却没有拿到任何地图或补给。",
      {
        mainConflict: "逃生压力不断升级。",
        protagonistGoal: "先逃出矿坑。",
        activeCharacters: ["秦枭"],
        foreshadowToTouch: [],
        payoffToDeliver: "获得地图和补给",
        payoffDirective: {
          promisedPayoff: "获得地图和补给",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
        endingHookType: "danger",
        nextChapterPull: "下一章追兵会再次逼近。",
      },
    );

    const warnings = toDisciplineWarnings(checks, "zh");
    expect(checks.payoffCheck.matched).toBe(false);
    expect(checks.payoffCheck.matchLevel).toBe("none");
    expect(warnings.some((warning) => warning.rule === "payoff-missing")).toBe(true);
    expect(warnings.some((warning) => warning.severity === "error")).toBe(true);
  });

  it("fails vague mystery language and only passes when the promised reveal is concretely materialized", () => {
    const chapterGoal = {
      mainConflict: "古卷来历关系到葬渊一脉的真相。",
      protagonistGoal: "揭开古卷来源。",
      activeCharacters: ["楚夜"],
      foreshadowToTouch: ["ancient-scroll"],
      payoffToDeliver: "揭开古卷来源",
      payoffDirective: {
        promisedPayoff: "揭开古卷来源",
        payoffType: "reveal" as const,
        mandatoryByFinalAct: true,
      },
      endingHookType: "reveal" as const,
      nextChapterPull: "这条来历会把祭司一脉拖出来。",
    };

    const failedChecks = evaluateChapterGoalDiscipline(
      "楚夜只觉得古卷很神秘，隐约察觉它和旧日传说有关，却没人真正说破。",
      chapterGoal,
    );
    const passedChecks = evaluateChapterGoalDiscipline(
      "碑灵终于说破：古卷并非散修遗物，而是来自葬渊祭司一脉，缺失的三页正是用来封存祭火印记。",
      chapterGoal,
    );

    expect(failedChecks.payoffCheck.matched).toBe(false);
    expect(passedChecks.payoffCheck.matched).toBe(true);
    expect(passedChecks.payoffCheck.evidence).toContain("来自葬渊祭司一脉");
  });

  it("flags layered reveal overrelease when one chapter fully explains identity, whereabouts, and cause without leaving unknowns", () => {
    const chapterGoal = {
      mainConflict: "父母线索终于被逼到台前。",
      protagonistGoal: "揭开父母身份和下落。",
      activeCharacters: ["楚夜"],
      foreshadowToTouch: ["parents-hook"],
      payoffToDeliver: "揭开父母身份/下落",
      payoffDirective: {
        promisedPayoff: "揭开父母身份/下落",
        payoffType: "reveal" as const,
        payoffDepth: "layered" as const,
        mandatoryByFinalAct: true,
      },
      endingHookType: "reveal" as const,
      nextChapterPull: "真相还会继续扩展。",
    };

    const checks = evaluateChapterGoalDiscipline(
      "碑灵一口气说清：楚夜父母是旧祭司血脉，下落在葬渊北阵眼，之所以被困是当年替代封阵，而解救方法是以三枚祭火印重开阵门，全部真相都解释清楚。",
      chapterGoal,
    );
    const warnings = toDisciplineWarnings(checks, "zh");

    expect(checks.payoffCheck.matched).toBe(true);
    expect(checks.payoffCheck.overReleased).toBe(true);
    expect(warnings.some((warning) => warning.rule === "payoff-overrelease")).toBe(true);
  });

  it("passes layered reveal when only one layer is revealed and a deeper unknown remains", () => {
    const chapterGoal = {
      mainConflict: "父母线索终于被逼到台前。",
      protagonistGoal: "揭开父母身份和下落。",
      activeCharacters: ["楚夜"],
      foreshadowToTouch: ["parents-hook"],
      payoffToDeliver: "揭开父母身份/下落",
      payoffDirective: {
        promisedPayoff: "揭开父母身份/下落",
        payoffType: "reveal" as const,
        payoffDepth: "layered" as const,
        mandatoryByFinalAct: true,
      },
      endingHookType: "reveal" as const,
      nextChapterPull: "下一章会继续追下去。",
    };

    const checks = evaluateChapterGoalDiscipline(
      "碑灵先揭开一层：楚夜父母确是旧祭司血脉。但他们如今具体被困何处仍不清楚，只留下北境阵纹的残线索。",
      chapterGoal,
    );
    const warnings = toDisciplineWarnings(checks, "zh");

    expect(checks.payoffCheck.matched).toBe(true);
    expect(checks.payoffCheck.overReleased).toBe(false);
    expect(warnings.some((warning) => warning.rule === "payoff-overrelease")).toBe(false);
  });

  it("treats escape progress as a partial payoff without raising a warning", () => {
    const checks = evaluateChapterGoalDiscipline(
      "楚夜暂时甩开追兵，赢得喘息，但还没真正离开矿区。",
      {
        mainConflict: "追兵紧追不舍。",
        protagonistGoal: "先逃离追捕。",
        activeCharacters: ["楚夜", "追兵"],
        foreshadowToTouch: [],
        payoffToDeliver: "逃离追捕",
        endingHookType: "pursuit",
        nextChapterPull: "下一章追兵还会咬上来。",
      },
    );

    const warnings = toDisciplineWarnings(checks, "zh");
    expect(checks.payoffCheck.matchLevel).toBe("partial");
    expect(checks.payoffCheck.matched).toBe(true);
    expect(warnings.some((warning) => warning.rule === "payoff-missing")).toBe(false);
  });

  it("flags payoff-impact-missing when payoff has only result without sensory/cost layers", () => {
    const check = evaluatePayoffImpact(
      "楚夜拿到了黑市腰牌，局势暂时稳住。",
      {
        payoffToDeliver: "拿到黑市腰牌",
        payoffDirective: {
          promisedPayoff: "拿到黑市腰牌",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.impactMatched).toBe(true);
    expect(check?.sensoryMatched).toBe(false);
    expect(check?.costMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "payoff-resource-flat")).toBe(true);
  });

  it("flags payoff-impact-missing when payoff has result + sensory but still lacks cost", () => {
    const check = evaluatePayoffImpact(
      "楚夜掌心一阵灼痛，终于拿到黑市腰牌，局势立刻逆转。",
      {
        payoffToDeliver: "拿到黑市腰牌",
        payoffDirective: {
          promisedPayoff: "拿到黑市腰牌",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.impactMatched).toBe(true);
    expect(check?.sensoryMatched).toBe(true);
    expect(check?.costMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "payoff-impact-missing.cost")).toBe(true);
  });

  it("flags payoff-impact-missing.sensory when payoff has result + cost but no sensory layer", () => {
    const check = evaluatePayoffImpact(
      "楚夜强行催动煞气付出寿元折损的代价，终于拿到黑市腰牌，封锁当场松动。",
      {
        payoffToDeliver: "拿到黑市腰牌",
        payoffDirective: {
          promisedPayoff: "拿到黑市腰牌",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.impactMatched).toBe(true);
    expect(check?.costMatched).toBe(true);
    expect(check?.sensoryMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "payoff-impact-missing.sensory")).toBe(true);
  });

  it("flags payoff-impact-missing.moment when payoff has sensory/cost/result but no sharp turning instant", () => {
    const check = evaluatePayoffImpact(
      "楚夜喉间泛起血腥味，强行催动煞气付出寿元折损的代价，终于拿到黑市腰牌，封锁当场松动。",
      {
        payoffToDeliver: "拿到黑市腰牌",
        payoffDirective: {
          promisedPayoff: "拿到黑市腰牌",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.sensoryMatched).toBe(true);
    expect(check?.costMatched).toBe(true);
    expect(check?.impactMatched).toBe(true);
    expect(check?.momentMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "payoff-impact-missing.moment")).toBe(true);
  });

  it("flags payoff-ending-overlap when MOMENT lands at the tail without post-moment resolution", () => {
    const check = evaluatePayoffImpact(
      "楚夜喉间泛起血腥味，强行催动煞气付出经脉刺痛的代价，终于拿到黑市腰牌。就在这一刻，封锁突然崩裂。",
      {
        payoffToDeliver: "拿到黑市腰牌",
        payoffDirective: {
          promisedPayoff: "拿到黑市腰牌",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.momentMatched).toBe(true);
    expect(check?.momentAtEnding).toBe(true);
    expect(check?.postMomentResolutionMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "payoff-ending-overlap")).toBe(true);
  });

  it("passes payoff impact when sensory/cost/impact are all present", () => {
    const check = evaluatePayoffImpact(
      "楚夜喉间泛起血腥味，强行催动煞气付出经脉刺痛的代价。就在这一刻，黑市腰牌在他掌心骤然发烫，追兵封锁当场松动。楚夜立刻压住翻涌气息，局势暂时稳住。",
      {
        payoffToDeliver: "拿到黑市腰牌",
        payoffDirective: {
          promisedPayoff: "拿到黑市腰牌",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.sensoryMatched).toBe(true);
    expect(check?.momentMatched).toBe(true);
    expect(check?.postMomentResolutionMatched).toBe(true);
    expect(check?.momentAtEnding).toBe(false);
    expect(check?.costMatched).toBe(true);
    expect(check?.impactMatched).toBe(true);
    expect(check?.matched).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("flags payoff-resource-flat when a resource payoff is written as a smooth result instead of an acquisition event", () => {
    const check = evaluatePayoffImpact(
      "楚夜掌心发麻，寿元被硬生生削去一截。就在这一刻，地图信息出现在脑海里。楚夜勉强稳住气息。",
      {
        payoffToDeliver: "获得地图信息",
        payoffDirective: {
          promisedPayoff: "获得地图信息",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.payoffType).toBe("resource");
    expect(check?.resourceFlatMatched).toBe(true);
    expect(check?.resourceTriggerMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "payoff-resource-flat")).toBe(true);
  });

  it("passes resource payoff when acquisition is written as a sharp triggered event", () => {
    const check = evaluatePayoffImpact(
      "楚夜掌心刺痛，强行灌入煞气付出经脉撕裂的代价。就在这一刻，他猛地扯开残图封蜡，地图信息随着燃亮的纹路骤然炸开，整条逃生路线被逼了出来。楚夜立刻压住翻涌气息，局势暂时稳住。",
      {
        payoffToDeliver: "获得地图信息",
        payoffDirective: {
          promisedPayoff: "获得地图信息",
          payoffType: "resource",
          mandatoryByFinalAct: true,
        },
      },
    );
    const warnings = toPayoffImpactWarnings(check, "zh");

    expect(check?.resourceTriggerMatched).toBe(true);
    expect(check?.resourceFlatMatched).toBe(false);
    expect(check?.matched).toBe(true);
    expect(warnings.some((warning) => warning.rule === "payoff-resource-flat")).toBe(false);
  });

  it("warns when consumption and backlash appear in prose but state and ledger stay unchanged", () => {
    const check = evaluateResourceLedgerDiscipline({
      content: "秦枭强行催动煞气，气血骤降，反噬之下经脉刺痛，五脏六腑都像被火灼过。",
      currentState: "# 当前状态\n\n- 秦枭仍在逃亡。\n",
      updatedState: "# 当前状态\n\n- 秦枭仍在逃亡。\n",
      originalLedger: "# 资源账本\n\n- 煞气：稳定\n",
      updatedLedger: "# 资源账本\n\n- 煞气：稳定\n",
      language: "zh",
    });

    const warnings = toResourceLedgerWarnings(check, "zh");
    expect(check.matched).toBe(false);
    expect(check.warnings).toContain("resource-ledger-missing-consumption");
    expect(check.warnings).toContain("resource-ledger-missing-injury-update");
    expect(warnings.some((warning) => warning.rule === "resource-ledger-missing-consumption")).toBe(true);
  });

  it("flags numeric mismatch when prose gives a concrete resource amount that ledger does not carry forward", () => {
    const check = evaluateResourceLedgerDiscipline({
      content: "他一口气吞下十五缕煞气，伤口止血，体力也回升了几分。",
      currentState: "# 当前状态\n",
      updatedState: "# 当前状态\n\n- 伤口止血，体力回升。\n",
      originalLedger: "# 资源账本\n\n- 煞气：十缕\n",
      updatedLedger: "# 资源账本\n\n- 煞气：十缕\n",
      language: "zh",
    });

    expect(check.warnings).toContain("resource-ledger-value-mismatch");
  });

  it("warns when high hook debt still opens multiple new hooks without advancing old debt", () => {
    const check = evaluateHookDebtThrottle({
      snapshot: {
        manifest: {
          schemaVersion: 2,
          language: "zh",
          lastAppliedChapter: 12,
          projectionVersion: 1,
          migrationWarnings: [],
        },
        currentState: {
          chapter: 12,
          facts: [],
        },
        hooks: {
          hooks: [
            { hookId: "old-1", startChapter: 1, type: "mystery", status: "open", lastAdvancedChapter: 5, expectedPayoff: "A", notes: "" },
            { hookId: "old-2", startChapter: 2, type: "route", status: "open", lastAdvancedChapter: 6, expectedPayoff: "B", notes: "" },
            { hookId: "old-3", startChapter: 3, type: "artifact", status: "open", lastAdvancedChapter: 7, expectedPayoff: "C", notes: "" },
            { hookId: "old-4", startChapter: 4, type: "power", status: "open", lastAdvancedChapter: 7, expectedPayoff: "D", notes: "" },
            { hookId: "old-5", startChapter: 5, type: "faction", status: "open", lastAdvancedChapter: 8, expectedPayoff: "E", notes: "" },
            { hookId: "old-6", startChapter: 6, type: "enemy", status: "open", lastAdvancedChapter: 8, expectedPayoff: "F", notes: "" },
            { hookId: "old-7", startChapter: 7, type: "lineage", status: "open", lastAdvancedChapter: 9, expectedPayoff: "G", notes: "" },
            { hookId: "old-8", startChapter: 8, type: "debt", status: "open", lastAdvancedChapter: 9, expectedPayoff: "H", notes: "" },
            { hookId: "old-9", startChapter: 9, type: "oath", status: "open", lastAdvancedChapter: 10, expectedPayoff: "I", notes: "" },
            { hookId: "old-10", startChapter: 10, type: "betrayal", status: "open", lastAdvancedChapter: 10, expectedPayoff: "J", notes: "" },
            { hookId: "old-11", startChapter: 11, type: "beast", status: "open", lastAdvancedChapter: 11, expectedPayoff: "K", notes: "" },
            { hookId: "new-a", startChapter: 13, type: "market", status: "open", lastAdvancedChapter: 13, expectedPayoff: "L", notes: "" },
            { hookId: "new-b", startChapter: 13, type: "killer", status: "open", lastAdvancedChapter: 13, expectedPayoff: "M", notes: "" },
          ],
        },
        chapterSummaries: {
          rows: [],
        },
      },
      delta: {
        chapter: 13,
        currentStatePatch: {},
        hookOps: {
          upsert: [
            { hookId: "new-a", startChapter: 13, type: "market", status: "open", lastAdvancedChapter: 13, expectedPayoff: "L", notes: "" },
            { hookId: "new-b", startChapter: 13, type: "killer", status: "open", lastAdvancedChapter: 13, expectedPayoff: "M", notes: "" },
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
        newHookCandidates: [],
        subplotOps: [],
        emotionalArcOps: [],
        characterMatrixOps: [],
        notes: [],
      },
      existingHookIds: Array.from({ length: 11 }, (_, index) => `old-${index + 1}`),
    });

    const warnings = toHookDebtWarnings(check, "zh");
    expect(check).toEqual(expect.objectContaining({
      activeCount: 13,
      newHooksOpened: 2,
      oldHooksAdvanced: 0,
      matched: false,
    }));
    expect(check?.warnings).toEqual(expect.arrayContaining([
      "hook-debt-over-cap",
      "hook-debt-too-many-new-hooks",
      "hook-debt-no-old-hook-advance",
      "hook-debt-throttle-violation",
    ]));
    expect(warnings.some((warning) => warning.rule === "hook-debt-throttle-violation")).toBe(true);
  });
});

describe("evaluateEndingIsomorphism", () => {
  it("warns when the current ending repeats recent blacklisted ending shells", () => {
    const recentChapters = [
      "众人穿过裂谷，脚步声终于沉进黑暗。随着他们的身影消失在黑暗中，所有人都明白，这一切只是冰山一角，真正的秘密还在前方，等待着他们去揭开。",
      "风声贴着石壁刮过去。随着他们的身影消失在黑暗中，楚夜忽然意识到，今日见到的不过只是冰山一角，更大的秘密还在前方，等待着他们去揭开。",
      "队伍越走越深，火光也被吞没。随着他们的身影消失在黑暗中，他们谁都没再开口，因为真正的秘密还在前方，等待着他们去揭开。",
    ].join("\n\n---\n\n");
    const current = [
      "楚夜收起火折子，带着众人没入暗河后的甬道。",
      "",
      "随着他们的身影消失在黑暗中，他知道眼前的一切也许仍只是冰山一角，更大的秘密还在前方，等待着他们去揭开。",
    ].join("\n");

    const check = evaluateEndingIsomorphism(current, recentChapters);
    const warnings = toEndingIsomorphismWarnings(check, "zh");

    expect(check?.matched).toBe(false);
    expect(check?.repeatedPhrases).toEqual(expect.arrayContaining([
      "随着他们的身影消失在黑暗中",
      "只是冰山一角",
      "等待着他们去揭开",
    ]));
    expect(warnings[0]?.rule).toBe("ending-isomorphism");
  });

  it("drops the warning when the ending rotates to a different closing mode", () => {
    const recentChapters = [
      "随着他们的身影消失在黑暗中，众人都意识到这不过只是冰山一角，真正的秘密仍在前方。",
      "火光熄下去时，他们谁都没有说话，因为更大的秘密还在前方，等待着他们去揭开。",
      "甬道把人吞进去，所有答案仿佛都在前方，真正的秘密仍未揭晓。",
    ].join("\n\n---\n\n");
    const revisedCurrent = [
      "楚夜把断刃压低。",
      "",
      "石门后忽然传来第一声爪痕，下一瞬，整面岩壁都开始往里塌，他只来得及喝出一句撤开。",
    ].join("\n");

    const check = evaluateEndingIsomorphism(revisedCurrent, recentChapters);
    const warnings = toEndingIsomorphismWarnings(check, "zh");

    expect(check?.matched).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe("evaluateEndingTypeCompliance", () => {
  it("fails reveal_end when the ending only raises danger without a concrete reveal", () => {
    const chapterIntent = [
      "# Chapter Intent",
      "",
      "## Structured Directives",
      "- endingType: reveal_end",
    ].join("\n");
    const content = [
      "楚夜压住气息，准备从裂隙撤离。",
      "",
      "章尾时杀机骤然逼近，追兵已经锁定了他的行踪。",
    ].join("\n\n");

    const check = evaluateEndingTypeCompliance(content, chapterIntent);
    const warnings = toEndingTypeWarnings(check, "zh");

    expect(check?.expectedType).toBe("reveal_end");
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "ending-type-mismatch")).toBe(true);
    expect(warnings[0]?.severity).toBe("error");
  });

  it("passes unresolved_end when the ending keeps an explicit unresolved question", () => {
    const chapterIntent = [
      "# Chapter Intent",
      "",
      "## Structured Directives",
      "- endingType: unresolved_end",
    ].join("\n");
    const content = [
      "楚夜把残卷压进怀里，没有再回头。",
      "",
      "可那道刻痕到底是谁留下的，他仍未查明。",
    ].join("\n\n");

    const check = evaluateEndingTypeCompliance(content, chapterIntent);
    const warnings = toEndingTypeWarnings(check, "zh");

    expect(check?.expectedType).toBe("unresolved_end");
    expect(check?.matched).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("fails calm_end when the ending introduces fresh escalation", () => {
    const chapterIntent = [
      "# Chapter Intent",
      "",
      "## Structured Directives",
      "- endingType: calm_end",
    ].join("\n");
    const content = [
      "众人刚在河滩上停下，准备扎营。",
      "",
      "下一瞬追兵从山脊扑下，杀机贴着后背压了上来，危机直接升级。",
    ].join("\n\n");

    const check = evaluateEndingTypeCompliance(content, chapterIntent);
    const warnings = toEndingTypeWarnings(check, "zh");

    expect(check?.expectedType).toBe("calm_end");
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "ending-type-mismatch")).toBe(true);
    expect(warnings[0]?.severity).toBe("error");
  });
});

describe("evaluateMoodCadenceCompliance", () => {
  const breathDirective = [
    "# Chapter Intent",
    "",
    "## Structured Directives",
    "- mood:",
    "  - targetMode: breath",
    "  - requiredSceneQuota: 1",
    "  - moodCoverageMin: 0.25",
    "  - forbidDominantMode: combat-heavy",
    "  - note: 本章必须降调。",
  ].join("\n");

  it("fails when breathing coverage is only a small slice of a combat-heavy chapter", () => {
    const content = [
      "楚夜草草包扎伤口，喝了口冷水。",
      "",
      "追兵再次扑来，刀光与杀机在甬道里来回轰击，楚夜提刀硬撞进封锁圈，和黑袍人狠狠干了一场。敌手一步不退，封锁线被震得四处爆开，他只能顶着反扑继续往前压。",
      "",
      "第二波围杀紧跟着压上来，厮杀、对轰、爆开的碎石几乎填满了整段甬道，长刀一次次撞上石壁，血战和封锁把去路彻底塞满。楚夜刚逼退左侧敌人，右侧杀机又顺着裂口压了回来。",
      "",
      "他刚退开半步，又被另一名敌手逼回去，血战一直拖到洞口塌陷为止。追兵借着碎石烟尘再度围杀，逼得他只能继续交锋，连喘口气的余地都没有。",
    ].join("\n\n");

    const check = evaluateMoodCadenceCompliance(content, breathDirective);

    expect(check?.matched).toBe(false);
    expect(check?.dominantMode).toBe("combat-heavy");
    expect(check?.coverageRatio).toBeLessThan(0.25);
  });

  it("passes when breathing and relationship material covers roughly a third of the chapter", () => {
    const content = [
      "楚夜和云岚在乱石后扎营疗伤，先替彼此包扎伤口，又分配药材和热汤，顺着路途交谈把接下来的打算重新理顺。",
      "",
      "一阵短暂的轻松调侃过后，两人的信任明显松开了一层，连原本紧绷的呼吸也慢了下来。",
      "",
      "休整结束后，他们才重新上路，在甬道尽头追查那道新出现的刻痕，顺势把主线推进到石门前。",
      "",
      "石门后的杀机还在逼近，但这一次他们没有再被仓促卷进血战，而是先带着准备好的方案往前压了一步。",
    ].join("\n\n");

    const check = evaluateMoodCadenceCompliance(content, breathDirective);

    expect(check?.matched).toBe(true);
    expect(check?.coverageRatio).toBeGreaterThanOrEqual(0.25);
  });

  it("fails with mood-structure-failure when the front half stays combat-heavy even if later sections add breathing", () => {
    const content = [
      "追兵先一步堵死通道，楚夜被迫连战三轮，刀光与杀机在甬道里连续爆开，他只能硬顶封锁。",
      "",
      "第二轮围杀接上，交锋和对轰几乎占满了整段通路，楚夜边战边退，直到岩壁崩裂才勉强拉开缝隙。",
      "",
      "后半段他才和云岚扎营疗伤，分配药材，交换接下来的路线情报。",
      "",
      "两人短暂恢复后，带着低强度侦察计划继续前推。",
    ].join("\n\n");

    const check = evaluateMoodCadenceCompliance(content, breathDirective);
    const warnings = toMoodCadenceWarnings(check, "zh");

    expect(check?.coverageRatio).toBeGreaterThanOrEqual(0.25);
    expect(check?.structureMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(warnings.some((warning) => warning.rule === "mood-structure-failure")).toBe(true);
  });

  it("passes structure order when the front half is recovery/dialogue before low-intensity forward motion", () => {
    const content = [
      "楚夜和云岚先在碎岩后扎营，处理伤口，分配药材与食水，把呼吸和节奏慢慢稳下来。",
      "",
      "两人沿路交换情报，讨论下一步绕行方案，关系也在这段对话里明显推进。",
      "",
      "完成休整后，他们才低强度前推到石门边，确认新的刻痕与入口方向。",
      "",
      "章尾留下一道柔性威胁：门后并不安全，但他们先带着准备好的计划继续探路。",
    ].join("\n\n");

    const check = evaluateMoodCadenceCompliance(content, breathDirective);
    const warnings = toMoodCadenceWarnings(check, "zh");

    expect(check?.structureMatched).toBe(true);
    expect(check?.matched).toBe(true);
    expect(warnings.some((warning) => warning.rule === "mood-structure-failure")).toBe(false);
  });

  it("fails with scene-semantic-failure when Scene1 contains active combat/escalation", () => {
    const content = [
      "[Scene1]",
      "楚夜刚落脚就拔刀冲杀，刀光爆发，追兵封锁升级，冲突瞬间拉满。",
      "",
      "[Scene2]",
      "两人只匆匆说了两句便继续动作推进。",
      "",
      "[Scene3]",
      "他们往前探查入口。",
    ].join("\n\n");

    const check = evaluateMoodCadenceCompliance(content, breathDirective);
    const warnings = toMoodCadenceWarnings(check, "zh");

    expect(check?.semanticMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(check?.semanticFailures).toEqual(expect.arrayContaining(["scene1-combat-or-escalation"]));
    expect(warnings.some((warning) => warning.rule === "scene-semantic-failure")).toBe(true);
  });

  it("emits scene1-violation as an error when the first 30% opens with pressure instead of recovery or character interaction", () => {
    const content = [
      "追兵的脚步声先压到洞口，规则压力顺着岩壁笼罩下来，风暴低鸣跟着逼近，楚夜刚抬手就被迫继续冲突升级。",
      "",
      "他后来才和云岚停下包扎伤口，交换路线情报，试图把呼吸慢慢稳住。",
      "",
      "最后两人低强度前推到石门边。",
    ].join("\n\n");

    const check = evaluateMoodCadenceCompliance(content, breathDirective);
    const warnings = toMoodCadenceWarnings(check, "zh");
    const violation = warnings.find((warning) => warning.rule === "scene1-violation");

    expect(check?.scene1IsolationMatched).toBe(false);
    expect(check?.matched).toBe(false);
    expect(violation?.severity).toBe("error");
  });

  it("passes scene semantics when Scene1 is recovery and Scene2 is interaction-focused", () => {
    const content = [
      "[Scene1]",
      "楚夜先扎营疗伤，包扎伤口，观察夜色与周围环境，慢慢把余波压住。",
      "",
      "[Scene2]",
      "他与云岚交换情报，讨论计划与路线，关系在这段对话里明显推进，情绪也得到释放。",
      "",
      "[Scene3]",
      "完成休整后，他们才低强度前推并留下软钩子。",
    ].join("\n\n");

    const check = evaluateMoodCadenceCompliance(content, breathDirective);
    const warnings = toMoodCadenceWarnings(check, "zh");

    expect(check?.semanticMatched).toBe(true);
    expect(check?.scene1IsolationMatched).toBe(true);
    expect(check?.semanticFailures).toEqual([]);
    expect(warnings.some((warning) => warning.rule === "scene-semantic-failure")).toBe(false);
    expect(warnings.some((warning) => warning.rule === "scene1-violation")).toBe(false);
  });
});

describe("evaluateHookEmergenceCompliance", () => {
  const hookIntent = [
    "# Chapter Intent",
    "",
    "## Hook Agenda",
    "### Emergence Directive",
    "- mustMaterializeHookNow: true",
    "- targetHookId: H002",
    "- targetHookState: overdue",
    "- targetHookExpectedPayoff: 发现压制毒性新方法",
    "- targetHookNotes: 噬魂草毒性仍在扩散",
  ].join("\n");

  it("fails when an overdue hook is only mentioned again without a state change", () => {
    const content = "楚夜盯着噬魂草，只知道它仍危险，毒性依旧存在，却没有任何新进展。";

    const check = evaluateHookEmergenceCompliance(content, hookIntent);
    const warnings = toHookEmergenceWarnings(check, "zh");

    expect(check?.matched).toBe(false);
    expect(check?.targetHookId).toBe("H002");
    expect(warnings.some((warning) => warning.rule === "hook-emergence-failure")).toBe(true);
  });

  it("passes when the chapter advances an overdue hook with a real new method", () => {
    const content = "楚夜借着碑纹反推药性，终于发现一套压制噬魂草毒性的新方法，至少能先稳住扩散速度。";

    const check = evaluateHookEmergenceCompliance(content, hookIntent);

    expect(check?.matched).toBe(true);
    expect(check?.movement).toBe("advance");
    expect(check?.evidence).toContain("发现一套压制噬魂草毒性的新方法");
  });

  it("passes when the chapter fully resolves the overdue hook", () => {
    const content = "楚夜顺着祭火残灰彻底解决了噬魂草，余毒被一并清除，这条旧患当场结束。";

    const check = evaluateHookEmergenceCompliance(content, hookIntent);

    expect(check?.matched).toBe(true);
    expect(check?.movement).toBe("resolve");
    expect(check?.evidence).toContain("彻底解决了噬魂草");
  });
});
