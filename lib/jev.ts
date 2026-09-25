import { TypeSafeClient, type EntryType, type Questions, type SystemOneResult, type TypeSafeClientConfig } from "@typesafe-ai/sdk";

/**
 * Jev（TypeSafe AI の System One モデル）の薄いラッパー。
 * 文章は作らず「どれか選ぶ / 何点か / はい・いいえ」を確率つきで返すので、
 * このアプリでは **判定と数値化はすべて Jev、文章づくりは Gemini** と役割を分ける。
 *
 * - TYPESAFE_API_KEY が無ければ null を返す（呼び出し側がルール/Gemini にフォールバック）
 * - サーバー専用。SDK 既定どおりブラウザからは呼ばない（キー漏えい防止）
 */

let client: TypeSafeClient | null | undefined;

function getClient(): TypeSafeClient | null {
  if (client !== undefined) return client;
  client = process.env.TYPESAFE_API_KEY?.trim()
    ? new TypeSafeClient({ timeout: 8000, retry: { maxRetries: 1 } })
    : null;
  return client;
}

/** テストで fetch を差し替えるため。null を渡すと無効化、undefined で環境変数から作り直す */
export function configureJev(config: TypeSafeClientConfig | null | undefined): void {
  client = config === undefined ? undefined : config === null ? null : new TypeSafeClient(config);
}

export function isJevEnabled(): boolean {
  return getClient() !== null;
}

export async function askJev<const Q extends Questions>(state: EntryType, questions: Q): Promise<SystemOneResult<Q> | null> {
  const jev = getClient();
  if (!jev) return null;
  try {
    return await jev.systemOne({ state, questions });
  } catch (e) {
    console.warn("[jev] request failed, falling back", e);
    return null;
  }
}

/** Jev の score（0..n-1 の期待値）を 0〜100 に換算する */
export function toPercent(score: number, levels: number): number {
  return Math.round((score / (levels - 1)) * 100);
}
