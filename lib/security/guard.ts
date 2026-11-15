import { NextResponse } from "next/server";
import type { z } from "zod";
import { RateLimiter } from "./rateLimit";

/**
 * API ルート共通の入口ガード。すべての API はこれを通す（通していないルートは CI のスモークテストで落ちる）。
 *
 *   1. 送信元チェック   他サイトからの呼び出し（API の踏み台利用）を拒否
 *   2. Content-Type     JSON 以外を拒否
 *   3. サイズ上限       巨大ボディによるメモリ枯渇を防ぐ
 *   4. レート制限       IP ごと + 全体。AI の利用枠を守る
 *   5. スキーマ検証     zod。型に合わない入力は中へ入れない
 *   6. 例外の握り込み   内部情報（スタック・キー・プロンプト）を応答に出さない
 */

export const MAX_BODY_BYTES = 64 * 1024;

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const perIp = new RateLimiter(num(process.env.RATE_LIMIT_PER_MIN, 20), 60_000);
const global = new RateLimiter(num(process.env.RATE_LIMIT_GLOBAL_PER_DAY, 1000), 24 * 60 * 60_000, 1);

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function reject(status: number, error: string, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error }, { status, headers: { ...BASE_HEADERS, ...extra } });
}

/** Vercel 等のプロキシが付ける先頭の IP を使う。無ければ全員を同じバケツに入れる（安全側） */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export function isSameOrigin(req: Request): boolean {
  // ブラウザが付ける Fetch Metadata。cross-site と明示されていれば即拒否
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = req.headers.get("origin");
  if (!origin) return true; // curl 等の非ブラウザ。CSRF の対象外なのでレート制限に任せる
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/** Content-Length を信用せず、実際に読んだバイト数で打ち切る */
async function readBody(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function guarded<S extends z.ZodType>(
  req: Request,
  schema: S,
  handler: (data: z.infer<S>) => Promise<unknown>,
): Promise<NextResponse> {
  if (!isSameOrigin(req)) return reject(403, "forbidden");
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reject(415, "unsupported media type");
  }

  const ip = clientIp(req);
  const mine = perIp.check(ip);
  if (!mine.ok) return reject(429, "too many requests", { "Retry-After": String(mine.retryAfterSec) });
  const all = global.check("all");
  if (!all.ok) return reject(429, "service busy", { "Retry-After": String(all.retryAfterSec) });

  const raw = await readBody(req, MAX_BODY_BYTES);
  if (raw === null) return reject(413, "payload too large");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reject(400, "invalid json");
  }
  const parsed = schema.safeParse(json);
  // 検証エラーの詳細は返さない（スキーマの探りを手伝わない）
  if (!parsed.success) return reject(400, "invalid request");

  try {
    return NextResponse.json(await handler(parsed.data), { headers: BASE_HEADERS });
  } catch (e) {
    // 会話本文はログに出さない。種類だけ残す
    console.error("[api] handler failed:", e instanceof Error ? e.name : "unknown");
    return reject(500, "internal error");
  }
}
