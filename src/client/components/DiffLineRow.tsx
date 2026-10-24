import { memo } from "react";
import type { DiffLine, Severity } from "../../shared/types.ts";

const MARKER: Record<DiffLine["type"], string> = { add: "+", del: "−", context: "" };

/**
 * 差分の 1 行。下書きを書き換えるたびにレビュー画面ごと描き直すので、行は中身が変わったときだけ描き直す。
 * line は読み込んだ PR の詳細のものをそのまま渡すので、同じ行なら同じオブジェクトになる
 */
export const DiffLineRow = memo(function DiffLineRow({
  line,
  marked,
}: {
  line: DiffLine;
  marked?: Severity;
}) {
  return (
    <tr className={`diff-line-${line.type}`} data-marked={marked}>
      <td className="lineno">{line.oldLine ?? ""}</td>
      <td className="lineno">{line.newLine ?? ""}</td>
      <td className="diff-marker" aria-hidden="true">
        {MARKER[line.type]}
      </td>
      <td className="diff-code">{line.content}</td>
    </tr>
  );
});
