import { noul, score, type Questions } from "@typesafe-ai/sdk";
import { askJev, toPercent } from "../jev";
import type { Axis, AxisScores, Message } from "../types";
import { isConsult, qaPairs, userUtterances } from "./rules";

/**
 * Jev による採点。1回のリクエストで全軸をまとめて聞く（リクエスト数 = コストを最小に）。
 * - 各軸: score（5段階ルーブリック → 期待値を 0〜100 に換算）
 * - 質問への答え漏れ: noul（Q&A の組ごとに「答えているか」の確率）
 * - 抱え込みのサイン: noul
 */

/** これを超えたら「はい」とみなす */
const YES = 0.5;

const RUBRICS: Record<Exclude<Axis, "listening">, { question: string; levels: readonly [string, string, ...string[]] }> = {
  conclusionFirst: {
    question: "部下の発言は、最初の1文で結論（終わった/遅れる/相談したい等）を言っているか",
    levels: [
      "前置きや経緯ばかりで結論が見当たらない",
      "結論はあるが最後の方に埋もれている",
      "結論は中盤に出てくる",
      "ほぼ冒頭で結論を言っている",
      "1文目で結論を言い、何の話かが即座に分かる",
    ],
  },
  specificity: {
    question: "部下の発言は、数字・期限・担当者・理由などが具体的か",
    levels: [
      "抽象的で、何がいつどうなるか分からない",
      "具体的な情報が1つだけある",
      "いくつかあるが、期限か見込みが欠けている",
      "期限・状況・見込みがほぼそろっている",
      "数字・期限・担当・理由がそろい、聞き返す必要がない",
    ],
  },
  conciseness: {
    question: "部下の発言は、短く区切られて読みやすいか",
    levels: ["1文が極端に長く、要点がつかめない", "冗長な部分が多い", "普通", "おおむね簡潔", "短い文で要点だけが伝わる"],
  },
  earlySharing: {
    question: "部下は完成を待たずに、途中経過や問題を早めに共有しているか",
    levels: [
      "完璧になるまで見せない・自分で抱え込もうとしている",
      "共有を先延ばしにする気配がある",
      "どちらとも言えない",
      "途中経過を共有しようとしている",
      "早い段階で進捗や問題を出し、方向性の確認を求めている",
    ],
  },
  consultQuality: {
    question: "部下の相談には、自分の案・選択肢・いつまでに決めたいかが含まれているか",
    levels: [
      "丸投げで、何を決めてほしいのかも分からない",
      "困っていることは分かるが、自分の考えがない",
      "論点は明確だが、自分の案がない",
      "自分の案があるが、期限か根拠が欠けている",
      "自分の案・根拠・期限がそろっていて、上司はすぐ判断できる",
    ],
  },
};

export type JevScoring = { axes: AxisScores; missed: string[]; hoarding: boolean };

export async function scoreByJev(messages: Message[]): Promise<JevScoring | null> {
  const utterances = userUtterances(messages);
  if (utterances.length === 0) return null;
  const pairs = qaPairs(messages);
  const hasConsult = utterances.some(isConsult);

  const questions: Questions = {
    hoarding: noul("部下は完璧主義で、完成するまで見せない・一人で抱え込むサインを出しているか"),
  };
  for (const [axis, r] of Object.entries(RUBRICS)) {
    if (axis === "consultQuality" && !hasConsult) continue;
    questions[axis] = score(r.question, r.levels);
  }
  pairs.forEach((p, i) => {
    questions[`answered_${i}`] = noul(
      { 問い: "部下の返答は、上司の質問に答えているか", 上司の質問: p.question, 部下の返答: p.answer },
      { true: "質問に答えている（言葉が違っても内容が答えになっていればよい）", false: "質問を無視している・別の話をしている" },
    );
  });

  const res = await askJev({ 部下の発言: utterances }, questions);
  if (!res) return null;

  const axes = { listening: null, consultQuality: null } as AxisScores;
  for (const [axis, r] of Object.entries(RUBRICS) as [Exclude<Axis, "listening">, (typeof RUBRICS)[keyof typeof RUBRICS]][]) {
    const a = res.answers[axis];
    axes[axis] = a?.type === "score" ? toPercent(a.score, r.levels.length) : null;
  }

  const missed: string[] = [];
  let answered = 0;
  let judged = 0;
  pairs.forEach((p, i) => {
    const a = res.answers[`answered_${i}`];
    if (a?.type !== "noul") return;
    judged++;
    answered += a.noul;
    if (a.noul <= YES) missed.push(p.question);
  });
  // 「答えた確率」の平均をそのまま受信力にする（0/1 で丸めるより実態に近い）
  axes.listening = judged ? Math.round((answered / judged) * 100) : null;

  const h = res.answers.hoarding;
  return { axes, missed, hoarding: h?.type === "noul" && h.noul > YES };
}
