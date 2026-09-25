import { NextResponse } from "next/server";
import { handleIntent } from "@/lib/handlers";
import { routeIntent } from "@/lib/router";
import { analyzeConversation } from "@/lib/scoring/analyze";
import { chatRequestSchema, type ChatReply } from "@/lib/types";

/** 何の話か伝わりにくい発言だった時のヒント（Jev の確信度が低い＝聞き手も迷う） */
const AMBIGUOUS_HINT = "最初に「〇〇の報告です」「相談です」と宣言すると、相手が聞く準備をできます。";

/** 1メッセージごとの入口: ルーターで意図を判定 → 対応するハンドラーへ振り分け */
export async function POST(req: Request) {
  const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { messages, traits } = parsed.data;
  const route = await routeIntent(messages);

  if (route.intent === "analyze") {
    const analysis = await analyzeConversation(messages, traits);
    const body: ChatReply = {
      intent: route.intent,
      routedBy: route.routedBy,
      confidence: route.confidence,
      reply: `ここまでの会話を採点しました。総合 ${analysis.overall} 点です。右のパネルを見てください。`,
      hint: analysis.nextAction,
      questions: [],
      analysis,
    };
    return NextResponse.json(body);
  }

  const out = await handleIntent(route.intent, messages, traits);
  const body: ChatReply = {
    intent: route.intent,
    routedBy: route.routedBy,
    confidence: route.confidence,
    ...out,
    hint: route.ambiguous ? AMBIGUOUS_HINT : out.hint,
  };
  return NextResponse.json(body);
}
