import type { ShortStoryChapterFunction, ShortStoryChapterPlan, ShortStoryTheme } from "../../schema.js";
import type { ShortStoryPlanStrategy } from "../index.js";

export const thrillerPlanStrategy: ShortStoryPlanStrategy = {
  id: "thriller",
  matches: isThrillerTheme,
  describeChapter: (_theme, chapterFunction, chapterNumber, chapterCount) =>
    describeThrillerChapter(chapterFunction, chapterNumber, chapterCount),
};

function describeThrillerChapter(
  chapterFunction: ShortStoryChapterFunction,
  chapterNumber: number,
  chapterCount: number,
): Pick<ShortStoryChapterPlan, "summary" | "conflict" | "endingHook"> {
  const twistIndex = chapterFunction === "twist" ? countFunctionsBefore(chapterNumber, chapterCount, "twist") + 1 : 0;
  const climaxIndex = chapterFunction === "climax" ? countFunctionsBefore(chapterNumber, chapterCount, "climax") + 1 : 0;

  switch (chapterFunction) {
    case "hook":
      return {
        summary: "深夜十一点，法医助理许念在停尸间接到已故姐姐许晴的来电，冷柜里的无名女尸突然睁眼看向她。",
        conflict: "值班保安否认听见电话，监控却拍到许念独自对着空冷柜说话，所有人都怀疑她精神失常。",
        endingHook: "许念回放录音时，电话里传来姐姐的低语：别相信明天来认尸的那个人。",
      };
    case "escalation":
      return describeEscalation(countFunctionsBefore(chapterNumber, chapterCount, "escalation"));
    case "twist":
      if (twistIndex === 1) {
        return {
          summary: "许念查到三年前火化记录被篡改，所谓女尸其实是周砚集团地下实验的失败者，姐姐许晴曾是举报人。",
          conflict: "叶澈承认自己接近许念是为了调查许晴留下的证据，许念愤怒甩开他，却在他手机里看到姐姐最后一条求救短信。",
          endingHook: "短信定位指向废弃医院负二层，而那里正是许念小时候接受治疗的地方。",
        };
      }
      return describeTwist(twistIndex);
    case "climax":
      if (climaxIndex === 1) {
        return {
          summary: "许念和叶澈逃进地下档案室，找到周砚用失踪者伪造死亡证明、倒卖实验数据的完整账本。",
          conflict: "周砚放火灭证，许念被浓烟逼回冷库，发现第一章那具女尸手心里刻着姐姐留下的保险柜密码。",
          endingHook: "保险柜打开后，里面不是证据原件，而是一张许念签过字的自愿实验同意书。",
        };
      }
      return describeClimax(climaxIndex);
    case "resolution":
      return {
        summary: "周砚被捕后，地下实验案公开，许念找到姐姐真正的遗体，将她安葬在母亲墓旁。",
        conflict: "叶澈问许念是否要公开自己曾参与实验的过去，许念沉默良久，决定把所有病历交给调查组。",
        endingHook: "停尸间最后一次关灯时，许念听见冷柜里传来轻轻一声谢谢，这一次她没有回头。",
      };
  }
}

function describeEscalation(
  index: number,
): Pick<ShortStoryChapterPlan, "summary" | "conflict" | "endingHook"> {
  if (index === 0) {
    return {
      summary: "第二天，地产商周砚带着律师来认领女尸，许念发现他的袖扣和姐姐失踪前照片里一模一样。",
      conflict: "周砚强行要求火化尸体，许念冒险调换样本，被同事叶澈发现后不得不把录音给他听。",
      endingHook: "DNA结果弹出时，许念看见女尸不是姐姐，而是三年前已经火化的另一个女人。",
    };
  }

  const locations = ["旧公寓十三楼", "废弃地铁站", "城南精神疗养院", "雨夜地下车库", "周砚集团档案库", "老殡仪馆后楼", "封闭样板间", "临江旧码头"];
  const clues = ["住户名单", "碎裂的录音笔", "病历复印件", "黑色纤维样本", "火化申请单", "监控硬盘", "带血门禁卡", "许晴留下的银色发夹"];
  const threats = ["管理员锁住楼梯间", "陌生人切断电源", "护士长突然翻脸", "黑车堵住出口", "保安抢走手机", "冷柜报警声自己响起", "样板间墙面渗出消毒水", "码头仓库门从外面落锁"];
  const next = ["合照里许晴正站在周砚身边微笑", "录音里出现许念小时候的哭声", "病历末尾写着许念的名字", "纤维来自停尸间三号冷柜", "火化单签名竟是叶澈", "硬盘里有姐姐失踪当天的视频", "门禁卡刷开的是负二层手术室", "发夹里藏着一枚微型存储卡"];
  const slot = (index - 1) % locations.length;

  return {
    summary: `许念追到${locations[slot]}，在墙缝里找到${clues[slot]}，线索指向周砚集团三年前掩埋的失踪案。`,
    conflict: `${threats[slot]}，许念被迫和叶澈合作脱身，却发现他隐瞒了自己认识许晴的事实。`,
    endingHook: `她把${clues[slot]}带回去检查，结果发现${next[slot]}。`,
  };
}

function describeTwist(
  twistIndex: number,
): Pick<ShortStoryChapterPlan, "summary" | "conflict" | "endingHook"> {
  const reveals = [
    "视频里许晴说真正的实验样本不是死者，而是许念本人",
    "叶澈的父亲曾替周砚伪造第一份死亡证明",
    "无名女尸手腕上的疤痕和许念童年手术记录完全吻合",
    "所谓闹鬼来电其实来自地下实验室的备用通讯线路",
    "许晴没有第一时间逃走，是因为她一直在保护被遗忘的实验者",
    "周砚的新楼盘地基下埋着旧医院封存的病案室",
    "许念每次失忆前都会听到同一段停尸间铃声",
    "失踪名单上的最后一个编号正是许念的出生编号",
  ];
  const costs = [
    "周砚带人封锁医院，叶澈为救她受伤",
    "叶澈跪在雨里求她相信自己，许念却把录音扔到他脸上",
    "主任当众宣布许念停职，逼她交出所有样本",
    "备用通讯线路突然反向定位，暴露了许念的位置",
    "许念发现姐姐曾经签过放弃救援的文件，整个人几乎崩溃",
    "病案室自动落锁，墙内传来指甲刮擦声",
    "她恢复一段记忆，却看见自己亲手推开许晴",
    "周砚用出生编号威胁她，暗示她从来不是普通受害者",
  ];
  const hooks = [
    "手术灯突然亮起，广播里响起许晴的声音：念念，醒过来的人不止你一个",
    "叶澈手机里弹出一条定时短信：如果我死了，把许念带去负二层",
    "女尸的指甲里掉出一枚保险柜钥匙",
    "通讯线路尽头传来许晴的喘息声，她还活着的可能第一次出现",
    "文件背面写着一句话：真正的出口在冷库里",
    "地基扫描图上，三号冷柜的位置被红笔圈了出来",
    "铃声停止后，许念发现自己站在手术台旁，手里握着刀",
    "出生编号解开一只旧硬盘，里面第一个文件名是自愿实验同意书",
  ];
  const slot = (twistIndex - 2) % reveals.length;

  return {
    summary: `许念继续追查废弃医院旧案，新的反转浮出水面：${reveals[slot]}。`,
    conflict: `${costs[slot]}，她不得不在恐惧和愤怒里重新判断叶澈到底能不能信。`,
    endingHook: hooks[slot]!,
  };
}

function describeClimax(
  climaxIndex: number,
): Pick<ShortStoryChapterPlan, "summary" | "conflict" | "endingHook"> {
  const stages = [
    "新楼盘发布会",
    "地下冷库",
    "周砚集团董事会",
    "暴雨中的旧医院天台",
    "警方封锁的样板间",
    "凌晨三点的停尸间",
    "跨江大桥检修通道",
  ];
  const evidence = [
    "许晴视频和地下实验账本",
    "女尸手心刻下的保险柜密码",
    "周砚亲笔签过的死亡名单",
    "叶澈父亲留下的原始录音",
    "地基下病案室的扫描图",
    "三号冷柜里的备用通讯器",
    "周砚准备转移出境的加密硬盘",
  ];
  const reversals = [
    "周砚反咬许念是实验共犯",
    "冷库断氧倒计时突然启动",
    "董事会成员集体装作不认识许晴",
    "叶澈承认父亲也参与过旧案",
    "样板间墙体裂开，露出被封死的病案柜",
    "许念接到姐姐最后一通电话",
    "硬盘自动播放许念童年实验录像",
  ];
  const hooks = [
    "警方控制周砚后，许念的手机再次响起，来电显示仍是许晴",
    "保险柜打开后，里面不是原件，而是一张许念签过字的同意书",
    "死亡名单最后一页写着：许念，未完成",
    "录音末尾，许晴说叶澈知道真正出口",
    "病案柜最底层，压着一具没有编号的小孩遗骸",
    "冷柜门自己弹开，里面放着许晴的旧发夹",
    "录像里的小许念抬头，对镜头说我自愿",
  ];
  const slot = (climaxIndex - 2) % stages.length;

  return {
    summary: `许念带着${evidence[slot]}闯入${stages[slot]}，把周砚藏了三年的实验真相推到所有人面前。`,
    conflict: `${reversals[slot]}，许念被逼到崩溃边缘，却仍然按下公开键。`,
    endingHook: hooks[slot]!,
  };
}

function isThrillerTheme(theme: ShortStoryTheme): boolean {
  return theme.includes("悬疑") || theme.includes("惊悚") || theme.includes("诡异") || theme.includes("恐怖");
}

function countFunctionsBefore(
  chapterNumber: number,
  chapterCount: number,
  chapterFunction: ShortStoryChapterFunction,
): number {
  let count = 0;
  for (let current = 1; current < chapterNumber; current += 1) {
    if (resolveChapterFunction(current, chapterCount) === chapterFunction) {
      count += 1;
    }
  }
  return count;
}

function resolveChapterFunction(
  chapterNumber: number,
  chapterCount: number,
): ShortStoryChapterFunction {
  if (chapterNumber === 1) return "hook";
  if (chapterNumber === chapterCount) return "resolution";

  const progress = (chapterNumber - 1) / (chapterCount - 1);
  if (progress < 0.3) return "escalation";
  if (progress < 0.7) return "twist";
  return "climax";
}
