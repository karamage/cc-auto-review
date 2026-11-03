import type { RiskScore } from "../../shared/risk-score.ts";
import { t } from "../i18n.ts";

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * PR の変更リスクの点数。AI レビュー前は diff だけから決めた基準点を、
 * AI レビュー後は AI の補正を足した点を出す。点の根拠（要因・パターン・補正の項目）は畳んで見せる
 */
export function RiskScoreCard({ risk, stale }: { risk: RiskScore; stale: boolean }) {
  const text = t().review.riskScore;
  const semantic = risk.semantic;
  const factors = risk.factors.filter((f) => f.points > 0);
  return (
    <section
      className="risk-score"
      data-level={risk.level}
      data-human={risk.needsHuman}
      aria-labelledby="risk-score-heading"
    >
      <h2 id="risk-score-heading">{text.heading}</h2>
      <p className="risk-score-head">
        <strong>{risk.score}</strong>
        <span className="muted">/100</span>
        <span className="risk-score-level">{risk.level}</span>
      </p>
      <div
        className="risk-score-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={risk.score}
        aria-label={text.heading}
      >
        <span style={{ width: `${risk.score}%` }} />
        <i style={{ left: `${risk.threshold}%` }} aria-hidden="true" />
      </div>
      <p className="risk-score-decision">
        {risk.needsHuman ? `👀 ${text.needsHuman}` : `🤖 ${text.aiOk}`}
      </p>
      {semantic === null || semantic.summary === "" ? null : (
        <p className="risk-score-summary">{semantic.summary}</p>
      )}
      {semantic === null ? <p className="risk-score-note">{text.baselineOnly}</p> : null}
      <p className="risk-score-note">{text.decisionNote(risk.threshold)}</p>
      {stale ? <p className="risk-score-note">{text.stale}</p> : null}

      <details className="risk-score-details">
        <summary>{text.breakdown}</summary>
        <dl>
          <dt>{text.baseline}</dt>
          <dd>{risk.baseline}</dd>
          {semantic === null ? null : (
            <>
              <dt>{text.semantic}</dt>
              <dd>{signed(semantic.adjustment)}</dd>
            </>
          )}
        </dl>
        {factors.length === 0 ? null : (
          <ul>
            {factors.map((factor) => (
              <li key={factor.key}>
                <span className="risk-points">
                  +{factor.points}/{factor.max}
                </span>{" "}
                {factor.label}
                <ul>
                  {factor.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {risk.adjustments.length === 0 ? null : (
          <>
            <h3>{text.adjustments}</h3>
            <ul>
              {risk.adjustments.map((adjustment) => (
                <li key={`${adjustment.type}-${adjustment.value}`}>
                  <span className="risk-points">
                    {adjustment.type} {adjustment.value}
                  </span>{" "}
                  {adjustment.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        {semantic === null || semantic.items.length + semantic.notes.length === 0 ? null : (
          <>
            <h3>{text.semantic}</h3>
            <ul>
              {semantic.items.map((item) => (
                <li key={`${item.file}:${item.line}:${item.reason}`}>
                  <span className="risk-points">{signed(item.points)}</span>{" "}
                  <code>
                    {item.file}
                    {item.line === "" ? "" : `:${item.line}`}
                  </code>{" "}
                  {item.reason}
                  {item.escalation ? <strong> ⚠ {text.escalation}</strong> : null}
                </li>
              ))}
              {semantic.notes.map((note) => (
                <li key={note} className="muted">
                  {note}
                </li>
              ))}
            </ul>
          </>
        )}
        {risk.findings.length === 0 ? null : (
          <>
            <h3>{text.patterns}</h3>
            <ul>
              {risk.findings.slice(0, 10).map((finding) => (
                <li key={`${finding.rule}:${finding.file}:${finding.line}`}>
                  <code>
                    {finding.file}:{finding.line}
                  </code>{" "}
                  {finding.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}
