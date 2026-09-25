import { afterEach, describe, expect, it, vi } from "vitest";
import type { Question, Questions } from "@typesafe-ai/sdk";
import { configureJev } from "@/lib/jev";
import { routeIntent } from "@/lib/router";
import { analyzeConversation } from "@/lib/scoring/analyze";
import type { Message } from "@/lib/types";

/** 質問ごとの答えを決める関数から、Jev API を模した fetch を作る */
function mockJev(answer: (name: string, q: Question) => unknown) {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const { questions } = JSON.parse(String(init?.body)) as { questions: Questions };
    const answers = Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, answer(name, q)]));
    return new Response(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 1, output_tokens: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  configureJev({ apiKey: "test", fetch, retry: { maxRetries: 0 } });
  return fetch;
}

afterEach(() => configureJev(null));

describe("router × Jev", () => {
  it("キーワードで決まる発言では Jev を呼ばない", async () => {
    const fetch = mockJev(() => ({}));
    const r = await routeIntent([{ role: "user", content: "進捗の報告です。7割終わりました。" }]);
    expect(r.routedBy).toBe("rules");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("あいまいな発言は Jev の choice で振り分ける", async () => {
    mockJev(() => ({ type: "choice", choice: "consult", confidence: 0.9, probabilities: { consult: 0.9, chat: 0.1 } }));
    const r = await routeIntent([{ role: "user", content: "お客様の件、ちょっといいですか" }]);
    expect(r).toMatchObject({ intent: "consult", routedBy: "jev", confidence: 0.9, ambiguous: false });
  });

  it("確信度が低いと ambiguous（何の話か伝わりにくい）", async () => {
    mockJev(() => ({ type: "choice", choice: "report", confidence: 0.4, probabilities: { report: 0.4, contact: 0.35 } }));
    const r = await routeIntent([{ role: "user", content: "あの件なんですけど" }]);
    expect(r.ambiguous).toBe(true);
  });

  it("Jev が落ちたらフォールバックする", async () => {
    configureJev({ apiKey: "test", fetch: async () => new Response("{}", { status: 500 }), retry: { maxRetries: 0 } });
    const r = await routeIntent([{ role: "user", content: "こんにちは" }]);
    expect(r.routedBy).toBe("fallback");
  });
});

describe("analyze × Jev", () => {
  // 「がんばります」は締め切りの質問に答えていない
  const messages: Message[] = [
    { role: "user", content: "資料作成の件で報告です。現時点で7割、明日15時に提出できる見込みです。" },
    { role: "assistant", content: "締め切りは変わっていない？", questions: ["締め切りは変わっていない？"] },
    { role: "user", content: "がんばります" },
  ];

  it("score を 0〜100 に換算してルールと 3:7 でブレンドし、答え漏れは noul で判定する", async () => {
    const fetch = mockJev((name, q) => {
      if (q.type === "score") return { type: "score", score: 4, confidence: 0.9, legend: {}, probabilities: {} };
      if (name.startsWith("answered_")) return { type: "noul", noul: 0.1 };
      return { type: "noul", noul: 0.2 }; // hoarding
    });
    const r = await analyzeConversation(messages, []);

    expect(fetch).toHaveBeenCalledTimes(1); // 全軸を1リクエストで聞く
    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body)).questions;
    expect(sent).not.toHaveProperty("consultQuality"); // 相談が無いので聞かない

    expect(r.source).toBe("rules+jev");
    expect(r.axes.listening).toBe(Math.round(0.3 * 0 + 0.7 * 10));
    expect(r.axes.consultQuality).toBeNull();
    expect(r.improve[0]).toContain("締め切りは変わっていない？");
    expect(r.improve.some((n) => n.includes("抱え込み"))).toBe(false);
  });

  it("言い換えで答えていても Jev が「答えた」と判定すれば答え漏れにしない", async () => {
    mockJev((name, q) =>
      q.type === "score"
        ? { type: "score", score: 2, confidence: 0.8, legend: {}, probabilities: {} }
        : { type: "noul", noul: name.startsWith("answered_") ? 0.9 : 0.1 },
    );
    const r = await analyzeConversation(messages, []);
    expect(r.improve.some((n) => n.startsWith("答えていない質問"))).toBe(false);
  });

  it("Jev が使えなければルールだけで採点する", async () => {
    const r = await analyzeConversation(messages, []);
    expect(r.source).toBe("rules");
  });
});
