import { SEVERITIES, type Severity } from "../../shared/types.ts";
import { t } from "../i18n.ts";

export function SeverityFilter({
  value,
  onChange,
  counts,
}: {
  value: Set<Severity>;
  onChange: (next: Set<Severity>) => void;
  /** 重要度ごとの件数。渡すとラベルに添える */
  counts?: Record<Severity, number>;
}) {
  return (
    <fieldset className="severity-filter">
      <legend>{t().review.severityLegend}</legend>
      {SEVERITIES.map((severity) => (
        <label key={severity} data-severity={severity}>
          <input
            type="checkbox"
            checked={value.has(severity)}
            onChange={() => {
              const next = new Set(value);
              if (next.has(severity)) next.delete(severity);
              else next.add(severity);
              onChange(next);
            }}
          />
          <span>
            {severity}
            {counts === undefined ? null : (
              <span className="severity-count">{counts[severity]}</span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
