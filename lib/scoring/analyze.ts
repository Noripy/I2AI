import { z } from "zod";
import { generateJson } from "../gemini";
import { routeByRules } from "../router";
import { clamp } from "../text";
import { AXES, AXIS_LABELS, TRAIT_LABELS, type AnalysisResult, type Axis, type AxisScores, type Message, type Trait } from "../types";
import { scoreByJev } from "./jev";
import { buildNotes, overallScore, scoreByRules } from "./rules";

/**
 * 採点の役割分担
 *   ルール : 決定的でブレない保険。API が全部止まっても動く
 *   Jev    : 数値化の主役。確率で校正されたスコアと「答えたか」の判定
 *   Gemini : 文章づくり（できていること・言い換え例など）。Jev が無い時だけ数値も出す
 */

/** ルールの配合比。Jev は校正済みなのでルールは3割、揺れる Gemini の時は4割残す */
const RULE_WEIGHT = { jev: 0.3, gemini: 0.4 } as const;

const feedbackSchema = z.object({
  good: z.array(z.string()).max(3),
  improve: z.array(z.string()).max(3),
  rewrite: z.object({ before: z.string(), after: z.string() }).nullable(),
  nextAction: z.string(),
});
const nullableScore = z.number().min(0).max(100).nullable();
const scoredFeedbackSchema = feedbackSchema.extend({
  axes: z.object(Object.fromEntries(AXES.map((a) => [a, nullableScore])) as Record<Axis, typeof nullableScore>),
});

const FEEDBACK_RULES = `ルール:
- good / improve はそれぞれ最大3つ。具体的な発言を引用して書く
- 人格ではなく行動を指摘する。「できていない」ではなく「次はこうする」で書く
- rewrite は一番伸びしろのある発言を、結論→理由→詳細→次のアクション（PREP）で書き直す
- nextAction は明日から試せる小さな習慣を1つ、30字以内`;

const SYSTEM_HEAD = `あなたは新社会人の「報連相」を育てるメンターです。
ユーザー（部下役）の発言だけを評価し、AI（上司役）の発言は評価しません。`;

const SYSTEM_FEEDBACK_ONLY = `${SYSTEM_HEAD}
スコアは確定済みです。点数は付け直さず、スコアの低い軸を中心にフィードバックを書いてください。

${FEEDBACK_RULES}`;

const SYSTEM_WITH_SCORES = `${SYSTEM_HEAD}

採点軸（0〜100、該当発言が無い軸は null）:
${AXES.map((a) => `- ${a}: ${AXIS_LABELS[a]}`).join("\n")}

${FEEDBACK_RULES}
- ルールベースの参考スコアと大きく違う場合は、会話の文脈を優先してよい`;

function blendAxes(rule: AxisScores, other: AxisScores, ruleWeight: number): AxisScores {
  return Object.fromEntries(
    AXES.map((a) => {
      const r = rule[a];
      const o = other[a];
      return [a, r === null ? o : o === null ? r : clamp(r * ruleWeight + o * (1 - ruleWeight))];
    }),
  ) as AxisScores;
}

function countIntents(messages: Message[]): AnalysisResult["counts"] {
  const counts = { report: 0, contact: 0, consult: 0 };
  for (const m of messages) {
    if (m.role !== "user") continue;
    const intent = m.intent ?? routeByRules(m.content)?.intent;
    if (intent === "report" || intent === "contact" || intent === "consult") counts[intent]++;
  }
  return counts;
}

function templateFeedback(axes: AxisScores, notes: string[], weakest: string | null): Pick<AnalysisResult, "good" | "improve" | "rewrite" | "nextAction"> {
  const scored = AXES.filter((a) => axes[a] !== null).sort((a, b) => axes[b]! - axes[a]!);
  const best = scored.slice(0, 2).filter((a) => axes[a]! >= 70);
  const worst = scored.slice(-2).reverse().filter((a) => axes[a]! < 70);
  const tips: Record<Axis, string> = {
    conclusionFirst: "1文目に「結論（終わった／遅れる／相談したい）」を置きましょう",
    specificity: "「いつまでに」「何％」「誰が」を1つ入れると伝わり方が変わります",
    conciseness: "1文を50字以内に。「、」で繋がず「。」で切りましょう",
    earlySharing: "完成前でも「現時点で○割、方向性だけ確認させてください」と出しましょう",
    listening: "送る前に、相手の質問に全部答えたか見直しましょう",
    consultQuality: "相談は「自分はA案が良いと思う、理由は〜」まで持っていきましょう",
  };
  return {
    good: best.length
      ? best.map((a) => `${AXIS_LABELS[a]}ができています（${axes[a]}点）`)
      : ["まず送ってみたこと自体が一番大事な一歩です"],
    improve: [...notes, ...worst.map((a) => tips[a])].slice(0, 3),
    rewrite: weakest
      ? { before: weakest, after: "【結論】〇〇です。【理由】〜のためです。【詳細】〜。【次のアクション】〜します／ご判断いただけますか。" }
      : null,
    nextAction: worst[0] ? tips[worst[0]].slice(0, 30) : "今日の報告を1つ、結論から書いてみる",
  };
}

export async function analyzeConversation(messages: Message[], traits: Trait[]): Promise<AnalysisResult> {
  const rules = scoreByRules(messages, traits);
  const counts = countIntents(messages);
  const jev = await scoreByJev(messages);

  // 答え漏れ・抱え込みは、Jev があれば文脈で判定した Jev を信じる（キーワード一致は言い換えに弱い）
  const notes = jev ? buildNotes(jev.missed, jev.hoarding, traits) : rules.notes;
  let axes = jev ? blendAxes(rules.axes, jev.axes, RULE_WEIGHT.jev) : rules.axes;

  const transcript = messages.map((m) => `${m.role === "user" ? "ユーザー" : "AI"}: ${m.content}`).join("\n");
  const prompt = [
    `ユーザーの特性: ${traits.map((t) => TRAIT_LABELS[t]).join("、") || "指定なし"}`,
    `${jev ? "確定スコア" : "ルールベースの参考スコア"}: ${JSON.stringify(axes)}`,
    `検出済みの注意点: ${notes.join(" / ") || "なし"}`,
    `会話:\n${transcript}`,
  ].join("\n\n");

  let feedback: z.infer<typeof feedbackSchema> | null = null;
  try {
    if (jev) {
      feedback = await generateJson({ system: SYSTEM_FEEDBACK_ONLY, prompt, schema: feedbackSchema, temperature: 0.3 });
    } else {
      const scored = await generateJson({ system: SYSTEM_WITH_SCORES, prompt, schema: scoredFeedbackSchema, temperature: 0.2 });
      if (scored) {
        axes = blendAxes(rules.axes, scored.axes, RULE_WEIGHT.gemini);
        feedback = scored;
      }
    }
  } catch (e) {
    console.warn("[analyze] gemini failed, template feedback", e);
  }

  const source: AnalysisResult["source"] = `rules${jev ? "+jev" : ""}${feedback ? "+gemini" : ""}` as AnalysisResult["source"];
  const base = { overall: overallScore(axes, traits), axes, counts, source };

  if (!feedback) return { ...base, ...templateFeedback(axes, notes, rules.weakest) };
  return {
    ...base,
    good: feedback.good,
    // 検出済みの注意点（質問の答え漏れ等）は必ず残す
    improve: [...notes, ...feedback.improve].slice(0, 3),
    rewrite: feedback.rewrite,
    nextAction: feedback.nextAction,
  };
}
