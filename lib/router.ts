import { z } from "zod";
import { choice } from "@typesafe-ai/sdk";
import { generateJson } from "./gemini";
import { askJev } from "./jev";
import { INTENTS, type Intent, type Message } from "./types";

/**
 * 意図ルーター（3段構え）
 *   1. ルール: キーワードで判定。明確なら API を呼ばない
 *   2. Jev: 意図を確率分布で判定（choice）。確信度が低い＝「何の話か伝わりにくい発言」として ambiguous を立てる
 *   3. Gemini: Jev が使えない時の代替（JSON Schema で enum に縛る）
 *   4. どれも使えなければ "chat" にフォールバック
 */

const RULES: Record<Exclude<Intent, "chat">, RegExp[]> = {
  analyze: [/採点|スコア|フィードバック|評価して|振り返り/],
  breakdown: [/分解|何から(手を付け|やれば|始め)|手順|段取り|進め方が(わから|分から)|タスクが(大き|多)/],
  consult: [/相談|どうすれば|どうしたら|迷って|判断(を|が)|ご意見|アドバイス|悩んで|いいでしょうか/],
  report: [/報告|完了しました|終わりました|できました|進捗|遅れ(て|が)|間に合(い|わ)|現時点|[0-9０-９]+ ?[%％]/],
  contact: [/連絡|共有です|お知らせ|休み|休暇|欠勤|遅刻|在宅|変更になりました|予定(が|を)|会議(室|の時間)/],
};

export type RouteResult = {
  intent: Intent;
  routedBy: "rules" | "jev" | "gemini" | "fallback";
  reason: string;
  /** Jev の確信度（0〜1）。Jev で判定した時だけ入る */
  confidence?: number;
  /** 確信度が低い＝聞き手が「何の話？」と迷う発言 */
  ambiguous?: boolean;
};

/** これ未満の確信度なら「何の話か伝わりにくい」とみなす */
export const JEV_MIN_CONFIDENCE = 0.6;

const INTENT_CRITERIA = {
  report: "報告: 作業の結果・進捗・遅れ・トラブルを上司に伝えている",
  contact: "連絡: 予定・変更・休み・事実を共有している",
  consult: "相談: 判断や助言を求めている、困っている",
  breakdown: "タスクの進め方・分解の手伝いを求めている",
  analyze: "自分の報連相の採点・フィードバックを求めている",
  chat: "上記のどれでもない雑談・あいさつ",
} as const satisfies Record<Intent, string>;

export function routeByRules(text: string): { intent: Intent; score: number; runnerUp: number } | null {
  const scored = (Object.keys(RULES) as (keyof typeof RULES)[])
    .map((intent) => ({ intent, score: RULES[intent].filter((p) => p.test(text)).length }))
    .sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  if (!top || top.score === 0) return null;
  return { intent: top.intent, score: top.score, runnerUp: second?.score ?? 0 };
}

const routeSchema = z.object({
  intent: z.enum(INTENTS),
  reason: z.string(),
});

const ROUTER_SYSTEM = `あなたは職場コミュニケーション練習アプリの振り分け係です。
ユーザーの最新の発言が次のどれに当たるか1つ選んでください。
- report: 報告（作業の結果・進捗・遅れ・トラブルを上司に伝える）
- contact: 連絡（予定・変更・休み・事実の共有）
- consult: 相談（判断や助言を求める、困っている）
- breakdown: タスク分解の手伝いを求めている
- analyze: 自分の報連相の採点・フィードバックを求めている
- chat: 上記以外
reason は日本語で20字以内。`;

export async function routeIntent(messages: Message[]): Promise<RouteResult> {
  const latest = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const byRules = routeByRules(latest);
  // 1位が2位より明確に強いときだけルールで確定
  if (byRules && byRules.score > byRules.runnerUp) {
    return { intent: byRules.intent, routedBy: "rules", reason: "キーワード一致" };
  }

  const context = messages
    .slice(-4)
    .map((m) => ({ 話者: m.role === "user" ? "部下" : "上司", 発言: m.content }));

  const jev = await askJev(
    { 直近の会話: context, 判定対象: latest },
    { intent: choice("職場で部下が上司に送った「判定対象」の発言は、次のどれに当たるか", INTENT_CRITERIA) },
  );
  if (jev) {
    const { choice: intent, confidence } = jev.answers.intent;
    return {
      intent,
      routedBy: "jev",
      reason: `確信度 ${Math.round(confidence * 100)}%`,
      confidence,
      ambiguous: confidence < JEV_MIN_CONFIDENCE,
    };
  }

  try {
    const text = context.map((c) => `${c.話者}: ${c.発言}`).join("\n");
    const res = await generateJson({
      system: ROUTER_SYSTEM,
      prompt: `直近の会話:\n${text}\n\n最新のユーザー発言を分類してください。`,
      schema: routeSchema,
      temperature: 0,
    });
    if (res) return { intent: res.intent, routedBy: "gemini", reason: res.reason };
  } catch (e) {
    console.warn("[router] gemini failed, falling back", e);
  }

  return {
    intent: byRules?.intent ?? "chat",
    routedBy: "fallback",
    reason: byRules ? "キーワード一致（同点）" : "該当なし",
  };
}
