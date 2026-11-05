import { memo } from "react";
import type { DiffLine, Severity } from "../../shared/types.ts";
import { t } from "../i18n.ts";

const MARKER: Record<DiffLine["type"], string> = { add: "+", del: "−", context: "" };

/**
 * 差分の 1 行。下書きを書き換えるたびにレビュー画面ごと描き直すので、行は中身が変わったときだけ描き直す。
 * line は読み込んだ PR の詳細のものをそのまま渡すので、同じ行なら同じオブジェクトになる。
 * onAsk も描画のたびに変わらない関数を渡す
 */
export const DiffLineRow = memo(function DiffLineRow({
  path,
  line,
  marked,
  onAsk,
}: {
  path: string;
  line: DiffLine;
  marked?: Severity;
  onAsk?: (path: string, line: number, side: "LEFT" | "RIGHT") => void;
}) {
  const number = line.newLine ?? line.oldLine;
  const side = line.newLine === null ? "LEFT" : "RIGHT";
  return (
    <tr className={`diff-line-${line.type}`} data-marked={marked}>
      <td className="lineno">{line.oldLine ?? ""}</td>
      <td className="lineno">{line.newLine ?? ""}</td>
      <td className="diff-marker" aria-hidden="true">
        {MARKER[line.type]}
      </td>
      <td className="diff-code">
        {line.content}
        {onAsk === undefined || number === null ? null : (
          <button
            type="button"
            className="diff-ask"
            aria-label={t().chat.askLine(path, number)}
            title={t().chat.askLine(path, number)}
            onClick={() => onAsk(path, number, side)}
          >
            ?
          </button>
        )}
      </td>
    </tr>
  );
});
