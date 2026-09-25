import { z } from "zod";
import { generateJson } from "../gemini";
import { routeByRules } from "../router";
import { clamp } from "../text";
import { AXES, AXIS_LABELS, TRAIT_LABELS, type AnalysisResult, type Axis, type AxisScores, type Message, type Trait } from "../types";
import { overallScore, scoreByRules } from "./rules";

/** ルール : Gemini の配合比。LLM は文脈を読めるが揺れるので、ルールを4割残す */
const RULE_WEIGHT = 0.4;

const nullableScore = z.number().min(0).max(100).nullable();
const geminiSchema = z.object({
  axes: z.object(Object.fromEntries(AXES.map((a) => [a, nullableScore])) as Record<Axis, typeof nullableScore>),
  good: z.array(z.string()).max(3),
  improve: z.array(z.string()).max(3),
  rewrite: z.object({ before: z.string(), after: z.string() }).nullable(),
  nextAction: z.string(),
});

const SYSTEM = `あなたは新社会人の「報連相」を育てるメンターです。
ユーザー（部下役）の発言だけを評価し、AI（上司役）の発言は評価しません。

採点軸（0〜100、該当発言が無い軸は null）:
${AXES.map((a) => `- ${a}: ${AXIS_LABELS[a]}`).join("\n")}

ルール:
- good / improve はそれぞれ最大3つ。具体的な発言を引用して書く
- 人格ではなく行動を指摘する。「できていない」ではなく「次はこうする」で書く
- rewrite は一番伸びしろのある発言を、結論→理由→詳細→次のアクション（PREP）で書き直す
- nextAction は明日から試せる小さな習慣を1つ、30字以内
- ルールベースの参考スコアと大きく違う場合は、会話の文脈を優先してよい`;

function blend(rule: number | null, llm: number | null): number | null {
  if (rule === null) return llm;
  if (llm === null) return rule;
  return clamp(rule * RULE_WEIGHT + llm * (1 - RULE_WEIGHT));
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

  let llm: z.infer<typeof geminiSchema> | null = null;
  try {
    const transcript = messages.map((m) => `${m.role === "user" ? "ユーザー" : "AI"}: ${m.content}`).join("\n");
    llm = await generateJson({
      system: SYSTEM,
      prompt: [
        `ユーザーの特性: ${traits.map((t) => TRAIT_LABELS[t]).join("、") || "指定なし"}`,
        `ルールベースの参考スコア: ${JSON.stringify(rules.axes)}`,
        `ルールが検出した注意点: ${rules.notes.join(" / ") || "なし"}`,
        `会話:\n${transcript}`,
      ].join("\n\n"),
      schema: geminiSchema,
      temperature: 0.2,
    });
  } catch (e) {
    console.warn("[analyze] gemini failed, rules only", e);
  }

  if (!llm) {
    return {
      overall: overallScore(rules.axes, traits),
      axes: rules.axes,
      counts,
      ...templateFeedback(rules.axes, rules.notes, rules.weakest),
      source: "rules",
    };
  }

  const axes = Object.fromEntries(AXES.map((a) => [a, blend(rules.axes[a], llm.axes[a])])) as AxisScores;
  return {
    overall: overallScore(axes, traits),
    axes,
    counts,
    good: llm.good,
    // ルールの検出（質問の答え漏れ等）は決定的なので必ず残す
    improve: [...rules.notes, ...llm.improve].slice(0, 3),
    rewrite: llm.rewrite,
    nextAction: llm.nextAction,
    source: "rules+gemini",
  };
}
