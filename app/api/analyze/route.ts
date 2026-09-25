import { NextResponse } from "next/server";
import { analyzeConversation } from "@/lib/scoring/analyze";
import { analyzeRequestSchema } from "@/lib/types";

/** 「採点する」ボタン用。ルーターを通さず直接採点する */
export async function POST(req: Request) {
  const parsed = analyzeRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  return NextResponse.json(await analyzeConversation(parsed.data.messages, parsed.data.traits));
}
