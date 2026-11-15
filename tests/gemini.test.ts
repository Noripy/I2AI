import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Gemini ラッパーを、SDK ごと通しで確かめる（通信だけを差し替える）。
 * SDK のメジャー更新で「送る内容」「返答の読み方」が変わったら、ここで気づける。
 */

const schema = z.object({ reply: z.string().max(50) });

/** Gemini REST API の返答を模した fetch を差し込み、キーありの状態でラッパーを読み込み直す */
async function loadWithFetch(text: string, status = 200) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify(status === 200 ? { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] } : { error: { code: status, message: "quota" } }),
      { status, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-test");
  vi.resetModules();
  const mod = await import("@/lib/gemini");
  return { ...mod, fetch };
}

function sent(fetch: Awaited<ReturnType<typeof loadWithFetch>>["fetch"]) {
  const [input, init] = fetch.mock.calls[0];
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return { url, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("generateJson × Gemini SDK", () => {
  it("モデル・system プロンプト・JSON Schema を送り、返答を型つきで返す", async () => {
    const { generateJson, fetch } = await loadWithFetch('{"reply":"了解です"}');
    const res = await generateJson({ system: "あなたは上司です", prompt: "報告です", schema, temperature: 0 });
    expect(res).toEqual({ reply: "了解です" });

    const { url, body, headers } = sent(fetch);
    expect(url).toContain("gemini-test:generateContent");
    expect(url).not.toContain("test-key"); // キーは URL ではなくヘッダーで送る（ログに残さない）
    expect(headers.get("x-goog-api-key")).toBe("test-key");
    expect(body.contents[0].parts[0].text).toBe("報告です");
    const system = body.systemInstruction.parts[0].text;
    expect(system).toContain("あなたは上司です");
    expect(system).toContain("データ"); // インジェクション対策の注意書きが必ず付く
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties.reply.maxLength).toBe(50);
    expect(body.generationConfig.temperature).toBe(0);
  });

  it("スキーマに合わない返答（長すぎる等）は捨てる", async () => {
    const { generateJson } = await loadWithFetch(JSON.stringify({ reply: "あ".repeat(51) }));
    expect(await generateJson({ system: "s", prompt: "p", schema })).toBeNull();
  });

  it("API エラー（429 など）は例外として呼び出し側に伝える", async () => {
    const { generateJson } = await loadWithFetch("", 429);
    await expect(generateJson({ system: "s", prompt: "p", schema })).rejects.toThrow();
  });

  it("キーが無ければ通信せず null", async () => {
    const { fetch } = await loadWithFetch("{}");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.resetModules();
    const { generateJson, isGeminiEnabled } = await import("@/lib/gemini");
    expect(isGeminiEnabled()).toBe(false);
    expect(await generateJson({ system: "s", prompt: "p", schema })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
