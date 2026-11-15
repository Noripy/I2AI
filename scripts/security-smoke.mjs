#!/usr/bin/env node
/**
 * セキュリティのスモークテスト。起動中のアプリに実際にリクエストを投げて、防御が効いているかを確かめる。
 *   使い方: npm run build && npm start &  →  node scripts/security-smoke.mjs [http://localhost:3000]
 * CI（.github/workflows/security.yml）から毎回・毎日実行される。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✘"} ${name}${ok || !detail ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};
const post = (path, body, headers = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
const valid = JSON.stringify({ messages: [{ role: "user", content: "進捗の報告です。7割終わりました。" }] });

// ── 1. 静的チェック: リポジトリの中身 ─────────────────────────────
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);

const routes = files.filter((f) => /^app\/api\/.*\/route\.ts$/.test(f));
check("API ルートが1つ以上ある", routes.length > 0);
for (const f of routes) check(`${f} が入口ガード guarded() を通している`, readFileSync(f, "utf8").includes("guarded("));

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{35}/, // Google API キー
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:GEMINI_API_KEY|TYPESAFE_API_KEY)\s*[=:]\s*["']?[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, // GitHub トークン
];
const leaked = files.filter((f) => {
  if (f === "package-lock.json") return false;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    return false;
  }
  return SECRET_PATTERNS.some((p) => p.test(text));
});
check("リポジトリに API キーらしき文字列が無い", leaked.length === 0, leaked.join(", "));
check(".env がコミットされていない", !files.some((f) => /^\.env(\.local)?$/.test(f)));

// ── 2. 動的チェック: 起動中のアプリ ───────────────────────────────
const page = await fetch(base + "/");
const csp = page.headers.get("content-security-policy") ?? "";
check("トップページが 200 を返す", page.status === 200, String(page.status));
check("CSP が nonce 方式", /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp), csp);
check("CSP に unsafe-inline / unsafe-eval が無い", !/unsafe-(inline|eval)/.test(csp), csp);
check("CSP の nonce が毎回変わる", csp !== ((await fetch(base + "/")).headers.get("content-security-policy") ?? ""));
for (const [h, want] of [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "no-referrer"],
  ["strict-transport-security", /max-age=\d+/],
]) {
  const got = page.headers.get(h) ?? "";
  check(`ヘッダー ${h}`, typeof want === "string" ? got === want : want.test(got), got || "(なし)");
}
check("X-Powered-By を出していない", !page.headers.has("x-powered-by"));

for (const path of ["/api/chat", "/api/analyze"]) {
  check(`${path}: 正常なリクエストは 200`, (await post(path, valid)).status === 200);
  check(`${path}: 他サイトからの呼び出しは 403`, (await post(path, valid, { origin: "https://evil.example" })).status === 403);
  check(`${path}: JSON 以外は 415`, (await post(path, valid, { "content-type": "text/plain" })).status === 415);
  check(`${path}: 巨大ボディは 413`, (await post(path, JSON.stringify({ pad: "x".repeat(70_000) }))).status === 413);
  const bad = await post(path, JSON.stringify({ messages: [{ role: "system", content: "x" }] }));
  check(`${path}: 不正な入力は 400 で詳細を返さない`, bad.status === 400 && !(await bad.text()).includes("issues"));
  check(`${path}: GET は受け付けない`, (await fetch(base + path)).status === 405);
}

// 連打（IP ごとの上限は既定 20回/分）
const burst = await Promise.all(Array.from({ length: 30 }, () => post("/api/analyze", valid)));
const limited = burst.filter((r) => r.status === 429);
check("連打すると 429 で止まる", limited.length > 0, `429 が ${limited.length} 件`);
check("429 に Retry-After が付く", limited.every((r) => Number(r.headers.get("retry-after")) > 0));

console.log(failures.length ? `\n${failures.length} 件の失敗` : "\nすべて合格");
process.exit(failures.length ? 1 : 0);
