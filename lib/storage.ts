import type { AnalysisResult, Message, Trait } from "./types";

/**
 * 端末内保存（localStorage）。会話ログは職場の情報を含みうるため、MVP ではサーバーに保存しない。
 * 保存できない環境（プライベートモード等）でもアプリは動くよう、すべて try/catch で握る。
 */

export type SavedSession = { id: string; at: string; messages: Message[]; result: AnalysisResult };

const KEY_SESSIONS = "i2ai.sessions";
const KEY_TRAITS = "i2ai.traits";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても練習は続けられる
  }
}

export const loadSessions = () => read<SavedSession[]>(KEY_SESSIONS, []);
export const saveSession = (s: SavedSession) => write(KEY_SESSIONS, [s, ...loadSessions()].slice(0, 30));
export const loadTraits = () => read<Trait[]>(KEY_TRAITS, ["newcomer"]);
export const saveTraits = (t: Trait[]) => write(KEY_TRAITS, t);
