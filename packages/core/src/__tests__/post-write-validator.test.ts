import { describe, it, expect } from "vitest";
import {
  detectDuplicateTitle,
  detectParagraphLengthDrift,
  detectParagraphShapeWarnings,
  evaluateChapterGoalDiscipline,
  evaluateHookEmergenceCompliance,
  evaluateMoodCadenceCompliance,
  evaluateEndingIsomorphism,
  evaluateHookDebtThrottle,
  evaluateResourceLedgerDiscipline,
  resolveDuplicateTitle,
  toDisciplineWarnings,
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

  it("turns an undelivered payoff into a warning", () => {
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
    expect(warnings.some((warning) => warning.rule === "payoff-materialization-failure")).toBe(true);
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
    expect(warnings.some((warning) => warning.rule === "payoff-check")).toBe(false);
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
