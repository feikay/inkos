import type { SixStepPlotMethod } from "./types.js";

export const SIX_STEP_PLOT_METHOD: SixStepPlotMethod = {
  id: "six-step-plot",
  name: "六步剧情闭环",
  purpose: "用情绪、目标、阻碍、破局、行动、反馈组成可连续滚动的网文章节闭环。",
  steps: [
    {
      id: "emotion-event",
      name: "情绪事件",
      purpose: "用具体冲突画面调动读者情绪。",
      requiredInChapterIntent: ["openingEmotion", "specificConflictImage"],
      reviewChecklist: [
        "是否出现具体压迫、具体不公或具体冲突画面？",
        "是否避免只抽象概括“主角被羞辱”？",
      ],
      promptHints: [
        "用一个动作、一句公开羞辱、一个被夺走的东西开场。",
        "让读者先看见不公，再理解设定。",
      ],
    },
    {
      id: "desire-goal",
      name: "欲望目标",
      purpose: "明确主角这一阶段想要什么，并让目标牵引节奏。",
      requiredInChapterIntent: ["protagonistGoal", "goalStakes"],
      reviewChecklist: [
        "主角目标是否单一、清晰、可行动？",
        "目标是否能推动下一场冲突，而不是停留在愿望？",
      ],
      promptHints: [
        "把目标写成可验证结果：拿到、逃出、揭开、压住、赢过。",
        "不要同时塞入多个互相争夺篇幅的目标。",
      ],
    },
    {
      id: "obstacle-dilemma",
      name: "阻碍困境",
      purpose: "用人物、规则、资源、制度或意外制造递进压力。",
      requiredInChapterIntent: ["mainObstacle", "dilemmaPressure"],
      reviewChecklist: [
        "阻碍是否来自故事内在规则，而不是作者硬拦？",
        "困境是否在积蓄爆发，而不是单纯虐主角？",
      ],
      promptHints: [
        "阻碍可以来自强敌、制度门槛、资源短缺、误会、天灾。",
        "每个阻碍都要让目标更难、更贵或更危险。",
      ],
    },
    {
      id: "solution-possibility",
      name: "解决方法",
      purpose: "给读者虽然很难但主角还有戏的希望感。",
      requiredInChapterIntent: ["possibleSolution", "solutionCost"],
      reviewChecklist: [
        "是否保留了可破局的线索、能力、盟友或规则漏洞？",
        "故事是否没有被困境写死？",
      ],
      promptHints: [
        "先让破局方案看似不够，再用代价或变量补足。",
        "把希望藏在前文伏笔、性格选择或微小信息差里。",
      ],
    },
    {
      id: "action-resolution",
      name: "行动解决",
      purpose: "让高潮成为前面积累后的质变，并把情绪抬高一阶。",
      requiredInChapterIntent: ["climaxAction", "turningPoint"],
      reviewChecklist: [
        "行动是否来自主角选择，而不是外力代劳？",
        "转折是否让情绪、局势或人物认知升级？",
      ],
      promptHints: [
        "高潮可以包含阻碍递进、目标颠覆、人物反差。",
        "让主角付出可见代价换来阶段性胜利。",
      ],
    },
    {
      id: "ending-feedback",
      name: "结局反馈",
      purpose: "交代收益、变化与下一轮伏笔，推动连载继续滚动。",
      requiredInChapterIntent: ["chapterPayoff", "nextHook"],
      reviewChecklist: [
        "主角是否变强、拿到东西、心态变化或关系变化？",
        "结尾是否埋下下一轮问题，而不是彻底停住？",
      ],
      promptHints: [
        "反馈要让读者知道这一章没有白读。",
        "结尾留下新代价、新敌意、新发现或更大的规则裂缝。",
      ],
    },
  ],
  chapterIntentFields: [
    "openingEmotion",
    "specificConflictImage",
    "protagonistGoal",
    "goalStakes",
    "mainObstacle",
    "dilemmaPressure",
    "possibleSolution",
    "solutionCost",
    "climaxAction",
    "turningPoint",
    "chapterPayoff",
    "nextHook",
  ],
  reviewChecklist: [
    "章节是否先给情绪事件，再解释背景？",
    "主角目标是否明确且贯穿本章？",
    "阻碍是否递进并服务高潮？",
    "破局是否有伏笔、有代价、有主角主动性？",
    "结局是否提供反馈并牵出下一轮问题？",
  ],
  commonFailures: [
    "只写设定说明，没有具体冲突画面。",
    "目标太散，导致章节没有牵引力。",
    "阻碍只为虐而虐，没有破局希望。",
    "高潮靠巧合或反派降智完成。",
    "结尾没有收益、变化或下一章理由。",
  ],
  promptHints: [
    "每章都先填 chapterIntentFields，再写正文。",
    "用“情绪事件 -> 目标 -> 阻碍 -> 破局可能 -> 行动 -> 反馈”检查章节骨架。",
    "让每一轮闭环都产生新的未完成欲望。",
  ],
};
