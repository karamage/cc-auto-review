import type { I18nComparison } from "../../shared/types.ts";
import { t } from "../i18n.ts";

/**
 * i18n の観点で見た回に、元の日本語と locale の日本語を並べる。
 * 指摘が無くても、何を比べて一致したのかを人が確かめられるように出す
 */
export function I18nComparisons({
  comparisons,
}: {
  comparisons: readonly I18nComparison[] | null;
}) {
  if (comparisons === null) return null;
  const text = t().review;
  const matched = comparisons.filter((c) => c.match).length;
  return (
    <section className="i18n-comparisons">
      <header>
        <h2>{text.i18nHeading}</h2>
        <p>
          {comparisons.length === 0 ? text.i18nNone : text.i18nIntro(matched, comparisons.length)}
        </p>
      </header>
      {comparisons.length === 0 ? null : (
        <ol>
          {comparisons.map((c, index) => (
            <li
              // 同じキーが並ぶこともあるので、順番も合わせて key にする
              key={`${index}-${c.key}`}
              className="i18n-comparison"
              data-match={c.match}
            >
              <p className="i18n-comparison-head">
                <strong>{c.original === "" ? c.locale : c.original}</strong>
                {c.key === "" ? null : <code>{c.key}</code>}
              </p>
              <dl>
                <dt>{text.i18nOriginal}</dt>
                <dd>{c.original}</dd>
                <dt>{text.i18nLocale}</dt>
                <dd>
                  {c.locale}{" "}
                  <span className="i18n-verdict">
                    {c.match ? `✅ ${text.i18nMatch}` : `❌ ${text.i18nMismatch}`}
                  </span>
                </dd>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
