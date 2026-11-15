/**
 * 固定ウィンドウのレート制限（メモリ内）。
 * 目的は「Gemini / Jev の枠を自動化ツールに食い潰されない」こと。
 *
 * 注意: サーバーレスではインスタンスごとに別カウントになるため、厳密な上限ではなく「歯止め」。
 * 厳密にしたくなったら同じインターフェースのまま Upstash Redis 等に差し替える。
 */

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** キーを増やし続けてメモリを枯渇させる攻撃への上限 */
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    const retryAfterSec = Math.ceil((b.resetAt - now) / 1000);
    return { ok: b.count <= this.limit, remaining: Math.max(0, this.limit - b.count), retryAfterSec };
  }

  private sweep(now: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    // 期限切れを消しても溢れているなら、古い順に半分捨てる（新規の正当な利用者を締め出さない）
    if (this.buckets.size >= this.maxKeys) {
      let drop = Math.floor(this.maxKeys / 2);
      for (const k of this.buckets.keys()) {
        if (drop-- <= 0) break;
        this.buckets.delete(k);
      }
    }
  }
}
