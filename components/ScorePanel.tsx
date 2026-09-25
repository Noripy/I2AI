import { AXES, AXIS_LABELS, type AnalysisResult } from "@/lib/types";

function band(score: number): string {
  if (score >= 80) return "good";
  if (score >= 60) return "ok";
  return "low";
}

export function ScorePanel({ result }: { result: AnalysisResult }) {
  return (
    <section className="panel" aria-label="採点結果">
      <div className="overall">
        <span className={`overall-num ${band(result.overall)}`}>{result.overall}</span>
        <span className="overall-unit">/ 100</span>
      </div>
      <p className="muted small">
        報告 {result.counts.report} ・ 連絡 {result.counts.contact} ・ 相談 {result.counts.consult} ／ 採点: {result.source === "rules" ? "ルールのみ" : "ルール + Gemini"}
      </p>

      <ul className="axes">
        {AXES.map((a) => {
          const v = result.axes[a];
          return (
            <li key={a}>
              <div className="axis-row">
                <span>{AXIS_LABELS[a]}</span>
                <span className="num">{v ?? "—"}</span>
              </div>
              <div className="bar" aria-hidden>
                {v !== null && <div className={`fill ${band(v)}`} style={{ width: `${v}%` }} />}
              </div>
            </li>
          );
        })}
      </ul>

      {result.good.length > 0 && (
        <>
          <h3>できていること</h3>
          <ul className="bullets">{result.good.map((g) => <li key={g}>{g}</li>)}</ul>
        </>
      )}
      {result.improve.length > 0 && (
        <>
          <h3>次に伸ばすこと</h3>
          <ul className="bullets">{result.improve.map((g) => <li key={g}>{g}</li>)}</ul>
        </>
      )}
      {result.rewrite && (
        <>
          <h3>言い換え例</h3>
          <p className="before">{result.rewrite.before}</p>
          <p className="after">{result.rewrite.after}</p>
        </>
      )}
      <h3>明日からの一歩</h3>
      <p className="next">{result.nextAction}</p>
    </section>
  );
}
