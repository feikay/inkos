import { BaseAgent } from "./base.js";

export class ChapterCompressorAgent extends BaseAgent {
  get name(): string {
    return "chapter-compressor";
  }

  /**
   * pruneScope: 比对正文与意图卡结尾钩子的边界。若发现正文在尾部大幅抢跑了原本计划在下一章才发生的情节，
   * 自动将超前情节物理切除，并利用意图卡原本的钩子重新收尾。
   */
  async pruneScope(content: string, intent: string): Promise<string> {
    this.log?.info("[compressor] Running pruneScope to detect and cut premature scene overruns at the chapter end...");
    const systemPrompt = `你是一位优秀的小说编辑。你的任务是比对章节正文与本章的意图卡（计划），检查正文尾部是否出现“抢跑情节”（即描写了原本计划在下一章才发生的情节，或者超出了本章意图卡规定的剧情终点，例如提前把下一章才该买的物品买好了，或提前开启了下一章的对话）。

如果有抢跑情节：
1. 请物理切除/删掉正文尾部这部分超前的情节。
2. 严格根据本章意图卡原本规定的结尾钩子和悬念重新进行收尾描写，使本章在正确的剧情节点戛然而止。
3. 保持正文前面的所有核心剧情、人物对话、叙事风格完全不变。
4. 输出重构后的完整正文。

如果正文尾部并没有抢跑，且完美符合意图卡的剧情边界，则不做任何改动，原样输出章节正文。

你必须将输出的正文包裹在 \`=== PRUNED_CONTENT ===\` 标签中，格式如下：
=== PRUNED_CONTENT ===
[正文内容]
=== PRUNED_CONTENT ===`;

    const userPrompt = `### 章节意图卡（计划）：
${intent}

### 当前章节正文：
${content}

请检查正文尾部是否超出了意图卡规定的范围。如果有抢跑，将其切除并使用意图卡的悬念重新收尾。将结果包裹在 === PRUNED_CONTENT === 中。`;

    try {
      const response = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.2, maxTokens: 16384 }
      );

      const resContent = response.content;
      const match = resContent.match(/===\s*PRUNED_CONTENT\s*===([\s\S]*?)===\s*PRUNED_CONTENT\s*===/);
      if (match && match[1]) {
        const cleaned = match[1].trim();
        if (cleaned) {
          return cleaned;
        }
      }
      return content;
    } catch (err) {
      this.log?.warn(`[compressor] pruneScope failed: ${err instanceof Error ? err.message : String(err)}`);
      return content;
    }
  }

  /**
   * deWater: 在不伤及核心剧情、人物台词的前提下，专门识别并删除“大段世界观背景科普”、“AI味过浓的排比与心理活动”，给章节脱水。
   */
  async deWater(content: string): Promise<string> {
    this.log?.info("[compressor] Running deWater to strip background dumps and verbose AI expressions (approx 10-20% length reduction)...");
    const systemPrompt = `你是一位极其严苛的小说编辑。你的任务是对小说的章节正文进行“脱水”瘦身，在不伤害核心情节推进、不改动关键人物台词/对话、不改变核心叙事事实的前提下，将字数精简 10% 到 20%。

脱水精简的重点：
1. 识别并缩减/删除大段冗长、说教式的世界观背景科普、作者旁白。
2. 识别并修剪AI特有的、大段泛化的心理活动描写、同义重复的排比修辞。
3. 压缩无意义的场景过渡和流水账式动作交代。
4. 保持文字的原有文风和调性，保留人物性格特色。
5. 输出脱水瘦身后的完整章节正文。

你必须将输出的脱水正文包裹在 \`=== DEWATERED_CONTENT ===\` 标签中，格式如下：
=== DEWATERED_CONTENT ===
[脱水后的正文内容]
=== DEWATERED_CONTENT ===`;

    const userPrompt = `### 待脱水章节正文：
${content}

请对上述正文进行智能脱水，精简10%-20%字数，并保持核心 plot 与台词完整。将结果包裹在 === DEWATERED_CONTENT === 中。`;

    try {
      const response = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.3, maxTokens: 16384 }
      );

      const resContent = response.content;
      const match = resContent.match(/===\s*DEWATERED_CONTENT\s*===([\s\S]*?)===\s*DEWATERED_CONTENT\s*===/);
      if (match && match[1]) {
        const cleaned = match[1].trim();
        if (cleaned) {
          return cleaned;
        }
      }
      return content;
    } catch (err) {
      this.log?.warn(`[compressor] deWater failed: ${err instanceof Error ? err.message : String(err)}`);
      return content;
    }
  }
}
