import { analyzeConversation } from "@/lib/scoring/analyze";
import { guarded } from "@/lib/security/guard";
import { analyzeRequestSchema } from "@/lib/types";

/** 「採点する」ボタン用。ルーターを通さず直接採点する */
export function POST(req: Request) {
  return guarded(req, analyzeRequestSchema, ({ messages, traits }) => analyzeConversation(messages, traits));
}
