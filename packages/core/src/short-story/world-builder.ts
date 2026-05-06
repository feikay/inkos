import type { ShortStoryBaseWorld, ShortStoryTheme } from "./schema.js";

export interface ShortStoryWorldInput {
  readonly theme: ShortStoryTheme;
  readonly runIndex: number;
  readonly timestamp?: string;
  readonly seed?: string;
}

export function createShortStoryBaseWorld(input: ShortStoryWorldInput): ShortStoryBaseWorld {
  const familySeed = `${input.theme}-${input.timestamp ?? input.seed ?? "default"}`;
  const worldIndex = Math.abs(hashSeed(familySeed)) + input.runIndex - 1;
  return baseWorlds[worldIndex % baseWorlds.length]!;
}

export function listShortStoryBaseWorldNames(): ReadonlyArray<string> {
  return baseWorlds.flatMap((world) => [world.protagonist, ...world.supportingCharacters]);
}

export function createShortStoryForeignNames(
  baseWorld: ShortStoryBaseWorld,
  runIndex: number,
): ReadonlyArray<string> {
  const ownText = [
    baseWorld.protagonist,
    baseWorld.role,
    baseWorld.setting,
    baseWorld.coreConflict,
    baseWorld.hiddenTruth,
    baseWorld.secret,
    ...baseWorld.supportingCharacters,
  ].filter(Boolean).join("\n");
  const names = listShortStoryBaseWorldNames().filter((name) => !ownText.includes(name));
  return [...new Set(names)].slice(runIndex % 2, 24 + (runIndex % 2));
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  return hash;
}

const baseWorlds: ReadonlyArray<ShortStoryBaseWorld> = [
  {
    protagonist: "宋眠",
    role: "独居女租客",
    setting: "老旧出租屋",
    coreConflict: "住处的监控记录和她的真实行动持续互相矛盾",
    supportingCharacters: ["房东蒋赫", "邻居贺舟", "前租客"],
    hiddenTruth: "墙后的夹层里藏着前任住户留下的求救线索",
  },
  {
    protagonist: "叶知夏",
    role: "遗物整理师",
    setting: "旧城区遗物整理工作室",
    coreConflict: "预约系统不断提前写出陌生人的最终行程",
    supportingCharacters: ["馆长韩砚", "记者沈照", "亡姐"],
    secret: "亡姐留下的订单其实是一份指向旧案的索引",
  },
  {
    protagonist: "程雨",
    role: "夜班记录员",
    setting: "市立机构档案楼",
    coreConflict: "七年前的登记记录和现实人员名单全部对不上",
    supportingCharacters: ["主管陆铭", "调查员秦野", "失踪病患妹妹"],
    hiddenTruth: "旧档案把幸存者写成了已经离开的编号",
  },
  {
    protagonist: "林晚",
    role: "公司联合创始人",
    setting: "十周年家宴与顾氏公司",
    coreConflict: "伴侣与旧友联手转移她参与创建的资产",
    supportingCharacters: ["顾沉", "律师叶澈", "苏蔓", "女儿顾念"],
    secret: "亲密关系背后还藏着一份被篡改的亲属证明",
  },
  {
    protagonist: "沈棠",
    role: "单亲母亲候选继承人",
    setting: "女儿生日宴与傅家财务室",
    coreConflict: "家族资金被人绕开她转入陌生账户",
    supportingCharacters: ["傅景川", "财务总监陆知行", "乔安", "女儿"],
    hiddenTruth: "女儿信托被设计成逼她让出股权的锁链",
  },
  {
    protagonist: "姜梨",
    role: "原创品牌主理人",
    setting: "新品发布会与品牌公司",
    coreConflict: "核心作品和公司席位同时被身边人夺走",
    supportingCharacters: ["贺云深", "品牌合伙人周序", "助理白薇"],
    secret: "旧事故并非意外，而是有人为了夺权提前布置",
  },
];
