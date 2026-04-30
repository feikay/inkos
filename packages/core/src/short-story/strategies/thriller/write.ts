import type { ShortStoryChapterPlan, ShortStoryTheme, ShortStoryVariant } from "../../schema.js";
import type { ShortStoryCast, ShortStorySceneDraft } from "../index.js";

export function resolveThrillerCast(_theme: ShortStoryTheme, variant?: ShortStoryVariant): ShortStoryCast {
  if (variant) {
    return {
      hero: variant.protagonist,
      villain: variant.antagonist,
      rival: variant.ally,
      child: variant.keyRelation,
    };
  }
  return {
    hero: "许念",
    villain: "周砚",
    rival: "叶澈",
    child: "许晴",
  };
}

export function createThrillerScene(
  chapter: ShortStoryChapterPlan,
  cast: ShortStoryCast,
): ShortStorySceneDraft {
  const base = createBaseScene(chapter, cast);
  return {
    ...base,
    finalBridge: `${cast.hero}把最后一份病历交给调查组。门外天亮了，她第一次觉得黑夜真的会结束。`,
  };
}

function createBaseScene(chapter: ShortStoryChapterPlan, cast: ShortStoryCast): Omit<ShortStorySceneDraft, "finalBridge"> {
  if (chapter.function === "hook") {
    return scene({
      sceneType: "停尸间来电",
      opening: `“许念，三号冷柜里的人不是我。”失踪三年的姐姐许晴，深夜给许念打来电话。`,
      continuation: (hook) => `${hook}${cast.hero}没有报警，她把录音拷进备用手机，重新走向停尸间。`,
      establishing: `停尸间白灯刺眼，值班保安站在门口发抖。三号冷柜缓缓滑出，标签上写着无名女尸。`,
      evidence: `录音波形清楚留下许晴的声音，背景里还有冷柜门合上的金属响声。`,
      risk: `监控回放里没有来电记录，只有许念独自站在冷柜前说话，像是在对尸体道歉。`,
      cost: `许念被主任当场停职。她摘下工牌时手指发僵，却把尸体指甲里的黑色纤维藏进纸巾。`,
      dialogueBeats: [
        `保安声音发颤：“许老师，刚才那具尸体是不是动了一下？”`,
        `许念盯着冷柜：“你没看错，她在提醒我。”`,
        `主任厉声说：“你再胡闹，我马上叫精神科。”`,
      ],
      actionBeats: [
        `冷柜灯忽明忽暗。许念低头看见女尸手腕上有一道旧手术疤，位置和姐姐一模一样。`,
        `她刚拍下照片，走廊尽头的脚步声停住，有人隔着门轻轻笑了一声。`,
      ],
      nextBridge: (next) => `电话不是幻觉，第二天出现的人更让她后背发冷：${next}`,
      expansions: [
        [`许念把录音调到最大，里面除了姐姐的声音，还有一个男人低低念出她的名字。`, `她浑身发冷，却没有关掉。越怕，越说明门后有东西。`],
        [`冷柜里的女尸忽然落下一滴水，砸在地砖上。许念蹲下去，看见水痕竟像一个数字十三。`, `十三楼。姐姐失踪前最后一次定位，也在十三楼。`],
        [`主任抢她手机，许念后退一步，把备份自动上传。进度条跳到百分百时，她终于喘出一口气。`, `死去的人不会说谎，活着的人才会。`],
      ],
    });
  }

  if (chapter.function === "escalation") {
    return scene({
      sceneType: chapter.chapterNumber === 2 ? "认尸风波" : "旧公寓追查",
      opening: chapter.chapterNumber === 2
        ? `第二天上午，周砚带着律师走进殡仪中心。他说要认尸，眼神却一直避开三号冷柜。`
        : `旧公寓十三楼没有住户，门缝里却透出一股消毒水味。许念按下门铃，里面传来姐姐的歌声。`,
      continuation: (hook) => `${hook}${cast.hero}把录音反复听到天亮，终于听见背景里一声旧电梯提示音。`,
      establishing: chapter.chapterNumber === 2
        ? `认尸室隔着一层玻璃，周砚只看了一眼就签字要求火化，像急着毁掉一段麻烦。`
        : `公寓走廊贴满旧封条，住户名单被人撕掉一半，只剩几个死亡日期。`,
      evidence: chapter.chapterNumber === 2
        ? `周砚的袖扣和许晴失踪前照片里的男人一模一样，袖口还沾着停尸间同款黑色纤维。`
        : `墙缝里藏着一张住户名单，名单上的人近三年全部离奇死亡，死亡证明都由同一家医院开出。`,
      risk: chapter.chapterNumber === 2
        ? `周砚要求立刻火化尸体，律师盯着许念的手机，随时准备抢走她仅有的录音。`
        : `公寓管理员锁住楼梯间，电梯停在十三层不动，门外的脚步声越来越近。`,
      cost: chapter.chapterNumber === 2
        ? `许念冒险调换样本，被同事叶澈发现。她失去主任信任，只能把录音交给这个半生不熟的人。`
        : `叶澈为了救她砸开消防门，手臂被玻璃割开。许念欠下他一条命，也欠下一句解释。`,
      dialogueBeats: [
        `周砚淡声说：“一具无名尸，火化后才算干净。”`,
        `许念压住怒意：“你认得她，所以才不敢多看。”`,
        `叶澈低声提醒：“别在这里撕破脸，他们人更多。”`,
      ],
      actionBeats: [
        `许念把样本盒塞进袖口，转身时撞上叶澈的目光。她以为他会喊人，他却替她挡住监控。`,
        `门外有人开始撞门。叶澈捂住她的嘴，把她拖进消防通道，黑暗里只剩两个人急促的呼吸。`,
      ],
      nextBridge: (next) => `她以为自己摸到了尸体的秘密，真相却把姐姐推到更深的地方：${next}`,
      expansions: [
        [`周砚签字时手很稳，稳得不像来认尸，像来验收。许念盯着那支笔，背后慢慢冒冷汗。`, `有人在急着把一个人从世上抹掉。`],
        [`叶澈说自己只是路过。许念看着他包扎好的手，忽然问：“你认识我姐姐，对吗？”`, `他没有回答。沉默本身就是答案。`],
        [`楼道里的声控灯一盏盏灭掉。许念摸到名单背面，还有一句铅笔字：下一个是她妹妹。`, `她攥紧纸条，指尖冰凉。`],
      ],
    });
  }

  if (chapter.function === "twist") {
    return scene({
      sceneType: chapter.chapterNumber <= 5 ? "废弃医院" : "地下档案室",
      opening: `废弃医院负二层比停尸间更冷。许念推开铁门，墙上还挂着她小时候的病历编号。`,
      continuation: (hook) => `${hook}定位把许念带到城南旧医院。叶澈坚持同行，她没有拒绝。`,
      establishing: `走廊尽头的手术灯自己亮起，广播里传来断续电流声，像有人贴着话筒喘息。`,
      evidence: `许晴的视频藏在旧电脑里。她说周砚集团用失踪者伪造死亡证明，真正的实验样本是许念。`,
      risk: `周砚的人封住出口，电梯数字停在负二层，消防门外传来铁链落锁的声音。`,
      cost: `叶澈承认自己接近许念是为了找证据。许念愤怒到发抖，却在他手机里看到姐姐最后的求救短信。`,
      dialogueBeats: [
        `叶澈哑声说：“我骗了你，但我没有害她。”`,
        `许念红着眼：“你们所有人都拿我当钥匙。”`,
        `广播忽然响起许晴的声音：“念念，别回头。”`,
      ],
      actionBeats: [
        `许念还是回了头。玻璃门后，一个和她长得几乎一样的女人睁开眼，掌心贴着病历号。`,
        `周砚带人追来，叶澈扑过去挡住铁棍。许念拖着他躲进档案室，血滴一路落在白砖上。`,
      ],
      nextBridge: (next) => `医院里醒来的不只记忆，还有周砚最想烧掉的证据：${next}`,
      expansions: [
        [`电脑屏幕闪了三次，许晴的脸卡在雪花里。她笑着叫了一声念念，许念眼泪瞬间砸下来。`, `恐惧终于变成了愤怒。`],
        [`手术台上的束缚带还留着血迹。许念摸到边缘刻字，发现那是自己小时候写下的名字。`, `她不是旁观者，她是从这里逃出去的人。`],
        [`叶澈把门抵住，声音越来越轻：“如果我没出去，把这个发给警方。”`, `许念把他拽起来：“你少替我安排结局。”`],
      ],
    });
  }

  if (chapter.function === "climax") {
    return scene({
      sceneType: chapter.chapterNumber <= 6 ? "冷库逃生" : "发布会封楼",
      opening: chapter.chapterNumber <= 6
        ? `火警响起时，地下档案室已经冒烟。许念抱着账本冲向冷库，门却在身后自动锁死。`
        : `周砚的新楼盘发布会灯光雪亮。许念站在人群最后，把许晴的视频投上主屏。`,
      continuation: (hook) => `${hook}她没有时间害怕。周砚比她更急，说明证据就在眼前。`,
      establishing: chapter.chapterNumber <= 6
        ? `冷库温度一路往下掉，女尸躺在金属床上，手心刻着一串保险柜密码。`
        : `发布会现场挤满记者和购房人，周砚正讲安全住宅，背后的屏幕却跳出地下实验账本。`,
      evidence: chapter.chapterNumber <= 6
        ? `保险柜里有周砚倒卖实验数据的合同，还有一张许念签过字的自愿实验同意书。`
        : `许晴视频、死亡证明和资金流水连成完整证据链，警方已经在会场外封锁电梯。`,
      risk: chapter.chapterNumber <= 6
        ? `冷库断电后会自动缺氧，叶澈的伤口还在流血，许念必须在十分钟内打开逃生门。`
        : `周砚当众反咬许念是实验共犯，记者镜头全部转向她，等她崩溃失言。`,
      cost: chapter.chapterNumber <= 6
        ? `许念看见同意书上自己的签名，终于想起当年为了救姐姐，她主动走进实验室。`
        : `许念必须公开自己曾参与实验的过去。那意味着她再也不能把伤口藏起来。`,
      dialogueBeats: [
        `周砚在广播里笑：“许念，你比你姐姐听话多了。”`,
        `许念咬牙：“你错了，我比她更难杀。”`,
        `叶澈喘着气说：“门开了，跑。”`,
      ],
      actionBeats: [
        `许念把同意书拍照上传，手抖得几乎按不准发送键。进度条满格那一秒，冷库门终于弹开。`,
        `发布会大屏同步直播，周砚脸上的笑一点点消失。警察推门而入时，全场鸦雀无声。`,
      ],
      nextBridge: (next) => `周砚被带走只是开始，最后一通电话把许念拉回停尸间：${next}`,
      expansions: [
        [`冷气割得喉咙发疼。许念抱着账本跪在地上，忽然听见冷柜里有人轻轻敲了三下。`, `她知道，那不是求救，是催她活下去。`],
        [`记者问她是不是共犯。许念对着镜头举起病历：“我是受害者，也是证人。”`, `这句话落下，周砚终于慌了。`],
        [`叶澈倒在门边，仍然死死攥着U盘。许念把他拖起来，第一次叫了他的名字。`, `她不能再丢下任何一个活着的人。`],
      ],
    });
  }

  return scene({
    sceneType: "停尸间告别",
    opening: `周砚被捕后的第七天，许念回到停尸间。三号冷柜空了，标签被她亲手撕下。`,
    continuation: (hook) => `${hook}那通电话没有再响。许念却知道，自己还欠姐姐一个答案。`,
    establishing: `调查组封存地下实验案，许晴真正的遗体被找到，安静躺在母亲墓旁。`,
    evidence: `病历、录音、账本和视频全部归档，死亡名单上的名字终于不再只是编号。`,
    risk: `媒体追问许念是否也是实验参与者，镜头像冷柜灯一样照着她的脸。`,
    cost: `许念把自己签过字的病历交出去。她不再假装没有过去，也不再替周砚守秘密。`,
    dialogueBeats: [
      `叶澈问：“你准备好了吗？”`,
      `许念看向停尸间门口：“没有，但我不想再躲。”`,
      `录音笔里传来最后一声轻响，像有人说谢谢。`,
    ],
    actionBeats: [
      `她关掉冷柜电源，白灯一盏盏熄灭。走廊尽头亮起晨光，叶澈站在那里等她。`,
      `许念把姐姐的旧发夹放进证物袋，忽然笑了一下。那笑很轻，却终于不再发抖。`,
    ],
    nextBridge: () => `${cast.hero}把停尸间钥匙交还给主任。`,
    expansions: [
      [`墓园风很大，许念把花放下，掌心贴着墓碑上许晴的名字。`, `她没有哭。姐姐把她从黑暗里推出来，不是为了让她一直哭。`],
      [`叶澈说调查还会很长。许念点头，把录音笔收进口袋。`, `长也没关系，她已经走过最冷的那段路。`],
      [`离开前，停尸间门自己轻轻合上。许念停了一秒，没有回头。`, `这一次，她知道身后不是恐惧，是告别。`],
    ],
  });
}

function scene(input: Omit<ShortStorySceneDraft, "finalBridge">): Omit<ShortStorySceneDraft, "finalBridge"> {
  return input;
}
