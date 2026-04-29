import type { ShortStoryChapterFunction, ShortStoryChapterPlan, ShortStoryTheme } from "../../schema.js";
import type { ShortStoryPlanStrategy } from "../index.js";

export const betrayalRevengePlanStrategy: ShortStoryPlanStrategy = {
  id: "betrayal-revenge",
  matches: isBetrayalRevengeTheme,
  describeChapter: (_theme, chapterFunction, chapterNumber, chapterCount) =>
    describeBetrayalRevengeChapter(chapterFunction, chapterNumber, chapterCount),
};

function describeBetrayalRevengeChapter(
  chapterFunction: ShortStoryChapterFunction,
  chapterNumber: number,
  chapterCount: number,
): Pick<ShortStoryChapterPlan, "summary" | "conflict" | "endingHook"> {
  const twistIndex = chapterFunction === "twist" ? countFunctionsBefore(chapterNumber, chapterCount, "twist") + 1 : 0;
  const climaxIndex = chapterFunction === "climax" ? countFunctionsBefore(chapterNumber, chapterCount, "climax") + 1 : 0;

  switch (chapterFunction) {
    case "hook":
      return {
        summary: "结婚十周年宴会上，林晚当众播放丈夫顾沉与闺蜜苏蔓的酒店监控录像，宾客哗然，顾家父母脸色铁青。",
        conflict: "顾沉冲上台抢夺话筒，苏蔓哭着指责林晚疯了，林晚压着发抖的手示意安保拦住两人。",
        endingHook: "林晚从手包里拿出亲子鉴定报告，冷声宣布女儿顾念的血缘真相今晚一起说清。",
      };
    case "escalation":
      if (countFunctionsBefore(chapterNumber, chapterCount, "escalation") === 0) {
        return {
          summary: "顾沉连夜冻结林晚的银行卡，还让律师逼她签净身出户协议，林晚愤怒到失眠却把录音笔藏进袖口赴约。",
          conflict: "顾沉用顾念的抚养权威胁林晚闭嘴，林晚发现协议里还藏着转移夫妻公司股权的条款。",
          endingHook: "林晚走出律师楼后收到匿名短信：苏蔓手里有顾沉更怕曝光的账本。",
        };
      }
      return {
        summary: "林晚约苏蔓在美容院见面，故意装出崩溃求饶的样子，套出顾沉把公司公款打进苏蔓母亲账户的线索。",
        conflict: "苏蔓得意地承认自己怀孕，逼林晚带着顾念离开顾家，林晚心口发冷却按下录音保存键。",
        endingHook: "林晚回家后发现顾念的房间被翻乱，书桌上只剩一张写着别查了的纸条。",
      };
    case "twist":
      if (twistIndex === 1) {
        return {
          summary: "林晚追查纸条来源时发现，亲子鉴定不是顾沉伪造，顾念确实不是顾沉的孩子，而顾沉早就知道却隐瞒七年。",
          conflict: "林晚痛苦地质问母亲唐慧，唐慧哭着承认当年产房换婴，顾念的生母正是苏蔓去世的姐姐苏晴。",
          endingHook: "林晚刚抱住顾念安慰，医院护士长发来旧档案照片，照片里顾沉站在产房门口递出一只红包。",
        };
      }
      return {
        summary: "林晚带着旧档案找到护士长，得知顾沉当年主动参与换婴，只为用顾念牵制苏家股份继承权。",
        conflict: "顾沉赶到医院威胁护士长撤回证词，林晚由震惊转为冷静，当场把偷拍视频上传给调查记者。",
        endingHook: "记者回传资料时提醒林晚，顾沉今晚要带苏蔓出境，随身硬盘里装着公司洗钱证据。",
      };
    case "climax":
      if (climaxIndex === 1) {
        return {
          summary: "林晚赶到机场贵宾厅，假装同意离婚换顾念安全，趁顾沉松懈时让经侦人员扣下他的硬盘和护照。",
          conflict: "顾沉暴怒着指责林晚毁掉顾家，苏蔓躲在他身后哭求离开，林晚第一次不再发抖，逐条念出转账记录。",
          endingHook: "硬盘解密后弹出一个加密文件夹，文件名竟是林晚父亲车祸。",
        };
      }
      return {
        summary: "林晚查出父亲当年的车祸与顾沉挪用公司资金有关，她把证据带到顾氏股东大会，逼顾家公开表决罢免顾沉。",
        conflict: "顾沉母亲跪地求林晚放过儿子，顾沉却当众骂林晚靠顾家才活到今天，林晚含泪签下报警确认书。",
        endingHook: "警车灯光照进会议厅时，苏蔓突然站出来说自己还有一份能让顾沉翻不了身的录音。",
      };
    case "resolution":
      return {
        summary: "三个月后，顾沉因挪用资金和伪造医疗记录被判刑，苏蔓交出录音换取从轻处理，林晚拿回公司控制权。",
        conflict: "顾念害怕自己被抛弃，林晚蹲在校门口告诉她血缘不会决定爱，母女俩抱在一起放声大哭。",
        endingHook: "林晚把十周年宴会的视频永久封存，只在新公司开业那天写下四个字：重新开始。",
      };
  }
}

function isBetrayalRevengeTheme(theme: ShortStoryTheme): boolean {
  return theme.includes("出轨") || theme.includes("复仇") || theme.includes("背叛") || theme.includes("婚外");
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
