/** 日本語テキストの軽量ユーティリティ（形態素解析器なしで動く範囲に留める） */

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。．！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? "";
}

/**
 * 2文字以上の「キーワード」を取り出す（いずれかが一致すればよい用途なので広めに拾う）
 * - 漢字の連続（作業、資料）
 * - 送り仮名1文字を挟む漢字語（締め切 ← 締め切り）
 * - カタカナ語・英数字
 */
export function keywords(text: string): string[] {
  const patterns = [
    /\p{Script=Han}{2,}/gu,
    /\p{Script=Han}+(?:\p{Script=Hiragana}\p{Script=Han}+)+/gu,
    /[\p{Script=Katakana}ー]{2,}/gu,
    /[A-Za-z0-9]{2,}/gu,
  ];
  return [...new Set(patterns.flatMap((p) => text.match(p) ?? []))];
}

export function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
