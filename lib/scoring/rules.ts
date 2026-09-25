import { clamp, countMatches, firstSentence, keywords, splitSentences } from "../text";
import { routeByRules } from "../router";
import type { Axis, AxisScores, Message, Trait } from "../types";

/**
 * ルールベース採点（決定的・無料・オフラインで動く）
 * Gemini の採点はブレるので、この結果を「アンカー」として必ず併用する。
 */

const CONCLUSION_MARKERS = [
  /結論/,
  /完了|終わりました|できました|済みです/,
  /遅れ|間に合(い|わ)|難しい(です|状況)/,
  /(報告|連絡|相談)(です|があります|させてください)/,
  /問題(が|は)(あり|発生|ない)/,
];
const PREAMBLE = /^(えっと|あの|すみません|申し訳|実は|ちょっと|なんか|一応)/;

const SPECIFIC_MARKERS = [
  /[0-9０-９]/,
  /(今日|明日|明後日|今週|来週|月曜|火曜|水曜|木曜|金曜|午前|午後|[0-9０-９]+時|までに|期限|締め切り|〆)/,
  /(誰|担当|さん|チーム|部署|部長|課長)/,
  /(原因|理由|なぜなら|ため)/,
];

const HOARDING = [/完璧に/, /もう少しで/, /まだ見せられ/, /全部(終わって|できて)から/, /自分で(なんとか|何とか)/, /ずっと(調べ|考え)/];
const EARLY = [/途中/, /現時点/, /一旦/, /進捗/, /[0-9０-９]+ ?[%％割]/, /見ていただ/, /方向性/];

const OWN_PROPOSAL = [/(と|って)考えて(い|お)/, /しようと思/, /(案|方針)(は|として|です)/, /(A|B|１|２|1|2)案/, /どちらが/, /のほうが/];

export type RuleResult = { axes: AxisScores; missed: string[]; hoarding: boolean; notes: string[]; weakest: string | null };

function avg(ns: number[]): number | null {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
}

function scoreConclusionFirst(msg: string): number {
  const first = firstSentence(msg);
  let s = 50;
  if (countMatches(first, CONCLUSION_MARKERS) > 0) s += 35;
  if (first.length <= 60) s += 15;
  if (PREAMBLE.test(first)) s -= 25;
  if (first.length > 100) s -= 20;
  return clamp(s);
}

function scoreSpecificity(msg: string): number {
  return clamp(25 + countMatches(msg, SPECIFIC_MARKERS) * 19);
}

function scoreConciseness(msg: string): number {
  const sentences = splitSentences(msg);
  const avgLen = msg.length / Math.max(1, sentences.length);
  let s = 100;
  if (avgLen > 50) s -= (avgLen - 50) * 1.2;
  if (msg.length > 300) s -= (msg.length - 300) / 5;
  return clamp(s);
}

function scoreEarlySharing(msg: string): number {
  return clamp(70 + countMatches(msg, EARLY) * 10 - countMatches(msg, HOARDING) * 20);
}

function scoreConsult(msg: string): number {
  let s = 35 + countMatches(msg, OWN_PROPOSAL) * 25;
  if (countMatches(msg, SPECIFIC_MARKERS.slice(1, 2)) > 0) s += 15; // いつまでに決めたいか
  return clamp(s);
}

const TIME_ANSWER = /[0-9０-９]|今日|明日|明後日|今週|来週|月曜|火曜|水曜|木曜|金曜|午前|午後|まで/;

/** 質問への回答らしさ: 質問のキーワードを含む / 「いつ」への時期の回答 / キーワードが取れない質問にはある程度の長さで応じている */
function answers(question: string, reply: string): boolean {
  if (/いつ/.test(question) && TIME_ANSWER.test(reply)) return true;
  const kws = keywords(question);
  if (kws.length === 0) return reply.length >= 10;
  return kws.some((k) => reply.includes(k));
}

export type QaPair = { question: string; answer: string };

/** AI の質問と、その直後のユーザー発言の組。まだ答える機会がない質問は含めない */
export function qaPairs(messages: Message[]): QaPair[] {
  const pairs: QaPair[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const next = messages.slice(i + 1).find((n) => n.role === "user");
    if (!next) return;
    const questions = m.questions?.length ? m.questions : splitSentences(m.content).filter((s) => /[？?]$/.test(s));
    for (const q of questions) pairs.push({ question: q, answer: next.content });
  });
  return pairs;
}

/** 「採点して」等のアプリへの指示は報連相ではないので採点対象から外す */
export function userUtterances(messages: Message[]): string[] {
  return messages
    .filter((m) => m.role === "user" && (m.intent ?? routeByRules(m.content)?.intent) !== "analyze")
    .map((m) => m.content);
}

export function isConsult(text: string): boolean {
  return routeByRules(text)?.intent === "consult";
}

/** 決定的に検出できた注意点を、特性に合わせた言葉で返す */
export function buildNotes(missed: string[], hoarding: boolean, traits: Trait[]): string[] {
  const notes: string[] = [];
  if (missed.length) notes.push(`答えていない質問があります: 「${missed[0]}」`);
  if (hoarding) {
    notes.push(
      traits.includes("perfectionist")
        ? "「完璧にしてから」は黄信号。60%の段階で方向性を見てもらうと手戻りが減ります"
        : "抱え込みのサインがあります。途中経過での共有を意識しましょう",
    );
  }
  return notes;
}

export function scoreByRules(messages: Message[], traits: Trait[] = []): RuleResult {
  const userMsgs = userUtterances(messages);
  const substantive = userMsgs.filter((m) => m.length >= 15);
  const consults = userMsgs.filter(isConsult);
  const pairs = qaPairs(messages);
  const missed = pairs.filter((p) => !answers(p.question, p.answer)).map((p) => p.question);
  const hoarding = userMsgs.some((m) => countMatches(m, HOARDING) > 0);

  const axes: AxisScores = {
    conclusionFirst: avg(substantive.map(scoreConclusionFirst)),
    specificity: avg(substantive.map(scoreSpecificity)),
    conciseness: avg(userMsgs.map(scoreConciseness)),
    earlySharing: avg(substantive.map(scoreEarlySharing)),
    listening: pairs.length ? 100 * (1 - missed.length / pairs.length) : null,
    consultQuality: avg(consults.map(scoreConsult)),
  };
  for (const k of Object.keys(axes) as Axis[]) {
    if (axes[k] !== null) axes[k] = clamp(axes[k]!);
  }

  const weakest = substantive.length
    ? substantive.reduce((w, m) => (scoreConclusionFirst(m) + scoreConciseness(m) < scoreConclusionFirst(w) + scoreConciseness(w) ? m : w))
    : null;

  return { axes, missed, hoarding, notes: buildNotes(missed, hoarding, traits), weakest };
}

/** ユーザー設定の悩みに対応する軸を重く見る */
export function axisWeights(traits: Trait[]): Record<Axis, number> {
  const w: Record<Axis, number> = {
    conclusionFirst: 1.2,
    specificity: 1,
    conciseness: 1,
    earlySharing: 1,
    listening: 1,
    consultQuality: 1,
  };
  if (traits.includes("perfectionist")) w.earlySharing += 0.8;
  if (traits.includes("hyperfocus")) w.listening += 0.8;
  if (traits.includes("explaining")) {
    w.conclusionFirst += 0.5;
    w.conciseness += 0.5;
  }
  if (traits.includes("breakdown")) w.specificity += 0.5;
  if (traits.includes("newcomer")) w.consultQuality += 0.3;
  return w;
}

export function overallScore(axes: AxisScores, traits: Trait[]): number {
  const w = axisWeights(traits);
  let sum = 0;
  let total = 0;
  for (const k of Object.keys(axes) as Axis[]) {
    const v = axes[k];
    if (v === null) continue;
    sum += v * w[k];
    total += w[k];
  }
  return total ? clamp(sum / total) : 0;
}
