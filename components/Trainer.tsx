"use client";

import { useEffect, useRef, useState } from "react";
import { loadSessions, loadTraits, saveSession, saveTraits, type SavedSession } from "@/lib/storage";
import { INTENT_LABELS, TRAITS, TRAIT_LABELS, type AnalysisResult, type ChatReply, type Message, type Trait } from "@/lib/types";
import { ScorePanel } from "./ScorePanel";

type UiMessage = Message & { hint?: string; routedBy?: ChatReply["routedBy"] };

const SCENARIOS = [
  { label: "遅れを報告する", text: "資料作成の件で報告です。" },
  { label: "休みを連絡する", text: "明日の午前、通院のためお休みをいただきたいです。" },
  { label: "判断を相談する", text: "お客様への返信内容で相談させてください。" },
  { label: "タスクを分解したい", text: "来週の定例資料を作ることになったのですが、何から手を付ければいいか分かりません。" },
];

function toApiMessages(messages: UiMessage[]): Message[] {
  return messages.map(({ role, content, intent, questions }) => ({ role, content, intent, questions }));
}

export function Trainer() {
  const [traits, setTraits] = useState<Trait[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<SavedSession[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTraits(loadTraits());
    setHistory(loadSessions());
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function toggleTrait(t: Trait) {
    const next = traits.includes(t) ? traits.filter((x) => x !== t) : [...traits, t];
    setTraits(next);
    saveTraits(next);
  }

  function record(res: AnalysisResult, msgs: UiMessage[]) {
    setResult(res);
    const session: SavedSession = { id: crypto.randomUUID(), at: new Date().toISOString(), messages: toApiMessages(msgs), result: res };
    saveSession(session);
    setHistory((h) => [session, ...h].slice(0, 30));
  }

  async function post<T>(url: string, msgs: UiMessage[]): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: toApiMessages(msgs), traits }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const withUser: UiMessage[] = [...messages, { role: "user", content }];
    setMessages(withUser);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const r = await post<ChatReply>("/api/chat", withUser);
      const tagged = withUser.map((m, i) => (i === withUser.length - 1 ? { ...m, intent: r.intent, routedBy: r.routedBy } : m));
      const next: UiMessage[] = [...tagged, { role: "assistant", content: r.reply, questions: r.questions, hint: r.hint }];
      setMessages(next);
      if (r.analysis) record(r.analysis, next);
    } catch {
      setError("送信に失敗しました。時間をおいて再度お試しください（無料枠の上限に達した可能性があります）。");
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (busy || !messages.some((m) => m.role === "user")) return;
    setBusy(true);
    setError(null);
    try {
      record(await post<AnalysisResult>("/api/analyze", messages), messages);
    } catch {
      setError("採点に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([]);
    setResult(null);
    setError(null);
  }

  return (
    <div className="layout">
      <main className="chat">
        <details className="traits" open={messages.length === 0}>
          <summary>あなたの特性（採点の重み付けが変わります）</summary>
          <div className="chips">
            {TRAITS.map((t) => (
              <label key={t} className={`chip ${traits.includes(t) ? "on" : ""}`}>
                <input type="checkbox" checked={traits.includes(t)} onChange={() => toggleTrait(t)} />
                {TRAIT_LABELS[t]}
              </label>
            ))}
          </div>
        </details>

        <div className="log" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty">
              <p>AIが上司役です。報告・連絡・相談を送ってみましょう。完璧な文章でなくて大丈夫。</p>
              <p className="small">※ 実在の顧客名や社外秘の情報は入力しないでください（無料枠のAIでは入力がサービス改善に使われる場合があります）。</p>
              <div className="chips">
                {SCENARIOS.map((s) => (
                  <button key={s.label} className="chip" onClick={() => setInput(s.text)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === "user" && m.intent && (
                <span className="badge" title={`振り分け: ${m.routedBy}`}>
                  {INTENT_LABELS[m.intent]}
                </span>
              )}
              <p>{m.content}</p>
              {m.hint && <p className="hint">💡 {m.hint}</p>}
            </div>
          ))}
          {busy && <p className="muted">考え中…</p>}
          <div ref={endRef} />
        </div>

        {error && <p className="error">{error}</p>}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(input);
            }}
            placeholder="例: 資料作成の件で報告です。現時点で7割、明日15時に提出できる見込みです。"
            maxLength={2000}
            rows={3}
          />
          <div className="actions">
            <button type="submit" disabled={busy || !input.trim()}>送信</button>
            <button type="button" className="secondary" onClick={analyze} disabled={busy || messages.length === 0}>採点する</button>
            <button type="button" className="ghost" onClick={reset} disabled={busy}>新しい練習</button>
          </div>
        </form>
      </main>

      <aside className="side">
        {result ? <ScorePanel result={result} /> : <p className="muted panel">会話のあと「採点する」を押すか、「採点して」と送るとスコアが出ます。</p>}
        {history.length > 0 && (
          <section className="panel">
            <h3>これまでのスコア</h3>
            <ol className="history">
              {history.slice(0, 10).map((s) => (
                <li key={s.id}>
                  <span>{new Date(s.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="num">{s.result.overall}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>
    </div>
  );
}
