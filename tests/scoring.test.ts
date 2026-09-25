import { describe, expect, it } from "vitest";
import { analyzeConversation } from "@/lib/scoring/analyze";
import { overallScore, scoreByRules } from "@/lib/scoring/rules";
import type { Message } from "@/lib/types";

const good: Message[] = [
  { role: "user", content: "資料作成の件で報告です。現時点で7割完了し、明日15時までに提出できる見込みです。" },
  { role: "assistant", content: "ありがとう。残りの作業は何？", questions: ["残りの作業は何？"] },
  { role: "user", content: "残りの作業はグラフの作成です。途中ですが一旦方向性を見ていただけますか。" },
];

const bad: Message[] = [
  {
    role: "user",
    content:
      "えっと、すみません、実はずっと調べていたのですが、いろいろあってまだ見せられる状態ではなくて、もう少しで完璧にできると思うので、全部終わってから見せようと思っていて、自分でなんとかしようと思っているのですが",
  },
  { role: "assistant", content: "わかった。締め切りはいつだっけ？", questions: ["締め切りはいつだっけ？"] },
  { role: "user", content: "がんばります" },
];

describe("scoreByRules", () => {
  it("結論ファーストで具体的な報告は高く、抱え込み型は低い", () => {
    const g = scoreByRules(good);
    const b = scoreByRules(bad);
    expect(g.axes.conclusionFirst!).toBeGreaterThan(b.axes.conclusionFirst!);
    expect(g.axes.specificity!).toBeGreaterThan(b.axes.specificity!);
    expect(g.axes.earlySharing!).toBeGreaterThan(b.axes.earlySharing!);
    expect(g.axes.conciseness!).toBeGreaterThan(b.axes.conciseness!);
  });

  it("質問に答えていないと受信力が下がり、注意が出る", () => {
    const b = scoreByRules(bad);
    expect(b.axes.listening).toBe(0);
    expect(b.notes.some((n) => n.includes("締め切り"))).toBe(true);
    expect(scoreByRules(good).axes.listening).toBe(100);
  });

  it("相談が無ければ相談の質は採点対象外(null)", () => {
    expect(scoreByRules(good).axes.consultQuality).toBeNull();
  });

  it("完璧主義の特性があると専用の声かけになる", () => {
    const b = scoreByRules(bad, ["perfectionist"]);
    expect(b.notes.some((n) => n.includes("60%"))).toBe(true);
  });
});

describe("overallScore", () => {
  it("特性に応じて重みが変わる", () => {
    const axes = { conclusionFirst: 90, specificity: 90, conciseness: 90, earlySharing: 90, listening: 10, consultQuality: null };
    expect(overallScore(axes, ["hyperfocus"])).toBeLessThan(overallScore(axes, []));
  });
});

describe("analyzeConversation（APIキーなし）", () => {
  it("ルールのみでテンプレートのフィードバックを返す", async () => {
    const r = await analyzeConversation(bad, ["perfectionist"]);
    expect(r.source).toBe("rules");
    expect(r.overall).toBeGreaterThanOrEqual(0);
    expect(r.improve.length).toBeGreaterThan(0);
    expect(r.rewrite?.before).toBe(bad[0].content);
    expect(r.counts.report).toBe(0);
  });
});

describe("採点対象の除外", () => {
  it("「採点して」はユーザーの報連相として数えない", () => {
    const withCommand: Message[] = [...good, { role: "user", content: "採点して" }];
    expect(scoreByRules(withCommand).axes).toEqual(scoreByRules(good).axes);
  });
});
