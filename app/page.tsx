import { Trainer } from "@/components/Trainer";
import { isGeminiEnabled } from "@/lib/gemini";
import { isJevEnabled } from "@/lib/jev";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <header className="header">
        <h1>I2AI 報連相トレーナー</h1>
        {!isGeminiEnabled() && <span className="badge warn">モックモード（GEMINI_API_KEY 未設定）</span>}
        {!isJevEnabled() && <span className="badge warn">Jev 未接続（TYPESAFE_API_KEY 未設定）</span>}
      </header>
      <Trainer />
    </>
  );
}
