import { z } from "zod";
import { generateJson } from "./gemini";
import { TRAIT_LABELS, type Intent, type Message, type Trait } from "./types";

/**
 * 意図ごとの処理。ルーターがここに振り分ける。
 * AI は「優しいけど現実的な上司」を演じ、実際の職場で聞かれそうな質問を返す。
 * → ユーザーはその質問に答える練習になり、答え漏れは受信力スコアに反映される。
 */

const replySchema = z.object({
  reply: z.string(),
  hint: z.string(),
  questions: z.array(z.string()).max(3),
});
export type HandlerOutput = z.infer<typeof replySchema>;

const BASE = `あなたは新社会人の部下を持つ、穏やかで現実的な上司です。
- 返答は200字以内。敬語は崩しすぎない
- 実際の上司が聞き返しそうな確認質問を0〜2個、reply の中に含め、同じ文を questions にも入れる
- hint は部下へのコーチングを1文（50字以内）。人格ではなく行動について書く
- 部下を責めない。遅れ・ミスの報告には、まず報告してくれたこと自体を肯定する`;

const BY_INTENT: Record<Exclude<Intent, "analyze">, string> = {
  report: `部下から「報告」を受けています。結論（完了/未完了/遅れ）・現状・見込み・次の行動が揃っているかを確認し、足りないものを質問してください。`,
  contact: `部下から「連絡」を受けています。5W1H（いつ・誰が・何を・どこで・なぜ・どうする）のうち抜けている情報を確認してください。`,
  consult: `部下から「相談」を受けています。すぐに答えを渡さず、まず「あなたはどうしたいと思う？」「期限はいつ？」を引き出してから助言してください。`,
  breakdown: `部下がタスクの進め方に困っています。タスクを15〜30分で終わる単位の3〜6ステップに分解し、番号付きで reply に書いてください。
途中で上司に見せるべきチェックポイント（例: 全体の2割の段階で方向性確認）を1つ必ず含めてください。`,
  chat: `雑談や報連相以外の話題です。短く応じたうえで、報連相の練習に戻れるよう「今日やることや困っていることはある？」のように自然に誘導してください。`,
};

const MOCK: Record<Exclude<Intent, "analyze">, HandlerOutput> = {
  report: {
    reply: "報告ありがとう。それで、今の状況は予定どおり？遅れているなら、いつ終わりそうかな？",
    hint: "報告は「結論→現状→見込み→次の行動」の順で。",
    questions: ["今の状況は予定どおり？", "遅れているなら、いつ終わりそうかな？"],
  },
  contact: {
    reply: "連絡ありがとう。それはいつからの話？関係する人には共有済み？",
    hint: "連絡は5W1Hのうち「いつ」「誰に」を必ず入れましょう。",
    questions: ["それはいつからの話？", "関係する人には共有済み？"],
  },
  consult: {
    reply: "相談してくれてありがとう。あなた自身はどうするのが良いと思う？いつまでに決めたい？",
    hint: "相談は「自分の案」と「期限」をセットにすると一気に通りやすくなります。",
    questions: ["あなた自身はどうするのが良いと思う？", "いつまでに決めたい？"],
  },
  breakdown: {
    reply:
      "こう分けてみよう。\n1. ゴールと締め切りを1行で書く（10分）\n2. 必要な材料を洗い出す（15分）\n3. 骨組みだけ作る（30分）\n4. ★ここで一度見せて方向性を確認\n5. 中身を埋める（30分×n）\n6. 見直して提出（15分）\n締め切りはいつ？",
    hint: "全体の2割でいったん見せるのが、手戻りを減らす一番の近道です。",
    questions: ["締め切りはいつ？"],
  },
  chat: {
    reply: "なるほど。ところで、今日やることや困っていることはある？",
    hint: "「報告」「連絡」「相談」のどれかを試してみましょう。",
    questions: ["今日やることや困っていることはある？"],
  },
};

export async function handleIntent(intent: Exclude<Intent, "analyze">, messages: Message[], traits: Trait[]): Promise<HandlerOutput> {
  const traitNote = traits.length ? `部下の特性: ${traits.map((t) => TRAIT_LABELS[t]).join("、")}。これを踏まえて hint を出す。` : "";
  const transcript = messages
    .slice(-10)
    .map((m) => `${m.role === "user" ? "部下" : "上司(あなた)"}: ${m.content}`)
    .join("\n");

  try {
    const res = await generateJson({
      system: `${BASE}\n${traitNote}\n\n${BY_INTENT[intent]}`,
      prompt: `会話:\n${transcript}\n\n上司として次の返答を作ってください。`,
      schema: replySchema,
      temperature: 0.6,
    });
    if (res) return res;
  } catch (e) {
    console.warn(`[handler:${intent}] gemini failed, using mock`, e);
  }
  return MOCK[intent];
}
