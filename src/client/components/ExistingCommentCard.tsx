import { useId, useState } from "react";
import type { ExistingComment, PriorFindingCheck } from "../../shared/types.ts";
import { isLongComment } from "../format.ts";
import { t } from "../i18n.ts";
import { priorStatusLabel } from "../state/prior.ts";

export function ExistingCommentCard({
  comment,
  check,
}: {
  comment: ExistingComment;
  /** このコメントが過去の指摘なら、今のコードで直っているかの AI の判定 */
  check?: PriorFindingCheck;
}) {
  const long = isLongComment(comment.body);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return (
    <div className="existing-comment">
      <strong>{comment.author}</strong>
      {comment.side === "LEFT" ? (
        <span className="badge">{t().review.deletedLineComment}</span>
      ) : null}
      {check === undefined ? null : (
        <span className="prior-status" data-status={check.status} title={check.evidence}>
          {t().aiVerdict(priorStatusLabel(check.status))}
        </span>
      )}
      <p id={bodyId} data-collapsed={long && !expanded ? "true" : undefined}>
        {comment.body}
      </p>
      <div className="existing-comment-foot">
        {long ? (
          <button
            type="button"
            data-variant="text"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t().review.collapse : t().review.readMore}
          </button>
        ) : null}
        <a href={comment.url} target="_blank" rel="noreferrer" className="muted">
          {t().openOnGitHub}
        </a>
      </div>
    </div>
  );
}
