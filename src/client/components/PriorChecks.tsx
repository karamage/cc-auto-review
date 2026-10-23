import type { PriorFindingCheck } from "../../shared/types.ts";
import { describePriorChecks, excerpt, priorStatusLabel, sortPriorChecks } from "../state/prior.ts";
import { t } from "../i18n.ts";
import { renderInlineCode } from "./FindingCard.tsx";

/**
 * 過去の指摘が今のコードで直っているかの、AI の判定。
 * 作成者の「直しました」や解決済みのスレッドではなく、コードを読んだ結果として出す
 */
export function PriorChecks({ checks }: { checks: readonly PriorFindingCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <section className="prior-checks">
      <header>
        <h2>{t().priorChecksHeading}</h2>
        <p>{t().review.priorChecksIntro(describePriorChecks(checks))}</p>
      </header>
      <ul>
        {sortPriorChecks(checks).map((check) => {
          const { comment } = check;
          const where =
            comment.path === null
              ? t().wholePR
              : `${comment.path}${comment.line === null ? "" : `:${comment.line}`}`;
          return (
            <li key={comment.id} className="prior-check" data-status={check.status}>
              <p className="prior-check-head">
                <span className="prior-status">{priorStatusLabel(check.status)}</span>
                <strong>{comment.author}</strong>
                <code>{where}</code>
                <a href={comment.url} target="_blank" rel="noreferrer">
                  {t().openOnGitHub}
                </a>
              </p>
              <p className="prior-check-quote">{excerpt(comment.body)}</p>
              {check.evidence === "" ? null : (
                <p className="prior-check-evidence">{renderInlineCode(check.evidence)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
