import { z } from "zod";
import { generateJson } from "./gemini";
import { INTENTS, type Intent, type Message } from "./types";

/**
 * 意図ルーター（2段構え）
 *   1. ルール: キーワードで判定。明確なら Gemini を呼ばない（無料枠のリクエスト数を節約）
 *   2. Gemini: ルールで決めきれない時だけ分類を依頼（JSON Schema で enum に縛る）
 *   3. どちらも使えなければ "chat" にフォールバック
 */

const RULES: Record<Exclude<Intent, "chat">, RegExp[]> = {
  analyze: [/採点|スコア|フィードバック|評価して|振り返り/],
  breakdown: [/分解|何から(手を付け|やれば|始め)|手順|段取り|進め方が(わから|分から)|タスクが(大き|多)/],
  consult: [/相談|どうすれば|どうしたら|迷って|判断(を|が)|ご意見|アドバイス|悩んで|いいでしょうか/],
  report: [/報告|完了しました|終わりました|できました|進捗|遅れ(て|が)|間に合(い|わ)|現時点|[0-9０-９]+ ?[%％]/],
  contact: [/連絡|共有です|お知らせ|休み|休暇|欠勤|遅刻|在宅|変更になりました|予定(が|を)|会議(室|の時間)/],
};

export type RouteResult = { intent: Intent; routedBy: "rules" | "gemini" | "fallback"; reason: string };

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

  try {
    const context = messages
      .slice(-4)
      .map((m) => `${m.role === "user" ? "ユーザー" : "AI"}: ${m.content}`)
      .join("\n");
    const res = await generateJson({
      system: ROUTER_SYSTEM,
      prompt: `直近の会話:\n${context}\n\n最新のユーザー発言を分類してください。`,
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
