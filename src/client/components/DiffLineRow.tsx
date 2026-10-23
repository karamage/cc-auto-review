import type { DiffLine, Severity } from "../../shared/types.ts";

const MARKER: Record<DiffLine["type"], string> = { add: "+", del: "−", context: "" };

export function DiffLineRow({ line, marked }: { line: DiffLine; marked?: Severity }) {
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
}
