import { describe, expect, it } from "vitest";
import { routeByRules, routeIntent } from "@/lib/router";

describe("routeByRules", () => {
  it.each([
    ["資料作成の件、完了しました。", "report"],
    ["明日は通院のため休みをいただきます。", "contact"],
    ["返信内容で迷っていて、相談させてください。", "consult"],
    ["何から手を付ければいいか分かりません。", "breakdown"],
    ["ここまでの会話を採点して", "analyze"],
  ])("%s → %s", (text, intent) => {
    expect(routeByRules(text)?.intent).toBe(intent);
  });

  it("キーワードが無ければ null", () => {
    expect(routeByRules("こんにちは")).toBeNull();
  });
});

describe("routeIntent（APIキーなし）", () => {
  it("ルールで確定できる時は rules", async () => {
    const r = await routeIntent([{ role: "user", content: "進捗の報告です。7割終わりました。" }]);
    expect(r).toMatchObject({ intent: "report", routedBy: "rules" });
  });

  it("判定できなければ chat にフォールバック", async () => {
    const r = await routeIntent([{ role: "user", content: "こんにちは" }]);
    expect(r).toMatchObject({ intent: "chat", routedBy: "fallback" });
  });
});
