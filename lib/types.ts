import { z } from "zod";

/** ルーターが振り分ける意図。報連相の3つ + 支援系2つ + その他 */
export const INTENTS = ["report", "contact", "consult", "breakdown", "analyze", "chat"] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<Intent, string> = {
  report: "報告",
  contact: "連絡",
  consult: "相談",
  breakdown: "タスク分解",
  analyze: "採点依頼",
  chat: "その他",
};

/** ユーザー設定（複数選択可）。採点の重み付けとヒントの出し方が変わる */
export const TRAITS = ["newcomer", "breakdown", "perfectionist", "hyperfocus", "explaining"] as const;
export type Trait = (typeof TRAITS)[number];

export const TRAIT_LABELS: Record<Trait, string> = {
  newcomer: "新社会人",
  breakdown: "タスク分解が苦手",
  perfectionist: "完璧主義になりがち",
  hyperfocus: "過集中で人の話をロストしがち",
  explaining: "説明が苦手",
};

export const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
  intent: z.enum(INTENTS).optional(),
  /** assistant が投げた質問。受信力（質問への回答漏れ）の判定に使う */
  questions: z.array(z.string()).optional(),
});
export type Message = z.infer<typeof messageSchema>;

export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  traits: z.array(z.enum(TRAITS)).default([]),
});

export const analyzeRequestSchema = chatRequestSchema;

/** 採点軸。報連相の型 + ユーザー設定の悩みに直結する軸 */
export const AXES = [
  "conclusionFirst",
  "specificity",
  "conciseness",
  "earlySharing",
  "listening",
  "consultQuality",
] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_LABELS: Record<Axis, string> = {
  conclusionFirst: "結論ファースト",
  specificity: "具体性（数字・期限・5W1H）",
  conciseness: "簡潔さ",
  earlySharing: "早めの共有（抱え込まない）",
  listening: "受信力（質問に答えている）",
  consultQuality: "相談の質（自分の案がある）",
};

/** null は「該当する発言がないので採点対象外」 */
export type AxisScores = Record<Axis, number | null>;

export type AnalysisResult = {
  overall: number;
  axes: AxisScores;
  counts: Record<"report" | "contact" | "consult", number>;
  good: string[];
  improve: string[];
  rewrite: { before: string; after: string } | null;
  nextAction: string;
  source: "rules" | "rules+gemini";
};

export type ChatReply = {
  intent: Intent;
  routedBy: "rules" | "gemini" | "fallback";
  reply: string;
  hint: string;
  questions: string[];
  analysis?: AnalysisResult;
};
