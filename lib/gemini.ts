import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

/**
 * Gemini 呼び出しの薄いラッパー。
 * - GEMINI_API_KEY が無ければ null を返す（呼び出し側がモック/ルールにフォールバック）
 * - 出力は必ず JSON Schema で縛り、zod で検証する（LLM の自由文をそのまま信じない）
 */

let client: GoogleGenAI | null | undefined;

function getClient(): GoogleGenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  return client;
}

export function isGeminiEnabled(): boolean {
  return getClient() !== null;
}

export function modelName(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export async function generateJson<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  temperature?: number;
}): Promise<z.infer<T> | null> {
  const ai = getClient();
  if (!ai) return null;

  const res = await ai.models.generateContent({
    model: modelName(),
    contents: opts.prompt,
    config: {
      systemInstruction: opts.system,
      temperature: opts.temperature ?? 0.4,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(opts.schema),
    },
  });

  const parsed = opts.schema.safeParse(JSON.parse(res.text ?? "null"));
  if (!parsed.success) {
    console.warn("[gemini] schema mismatch", parsed.error.issues);
    return null;
  }
  return parsed.data;
}
