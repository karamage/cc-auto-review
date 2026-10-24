import { splitPath } from "../format.ts";
import { t } from "../i18n.ts";
import type { DraftItem } from "../state/draft.ts";

export function findingAnchorId(findingId: string): string {
  return `finding-${encodeURIComponent(findingId)}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** 指摘カードを画面の中ほどへ寄せ、どれに飛んだか分かるよう一瞬だけ光らせる */
function jumpTo(findingId: string): void {
  const card = document.getElementById(findingAnchorId(findingId));
  if (card === null) return;
  // ファイル見出しが sticky なので、上端に寄せると見出しの下に隠れる
  card.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  card.focus({ preventScroll: true });
  card.removeAttribute("data-flash");
  // 同じ指摘を続けて押してもアニメーションをやり直せるよう、一度レイアウトを確定させる
  void card.offsetWidth;
  card.setAttribute("data-flash", "true");
  card.addEventListener("animationend", () => card.removeAttribute("data-flash"), { once: true });
}

/** 指摘の一覧。diff の中を探し回らずに、押した指摘の場所へ直接飛べるようにする */
export function FindingIndex({
  items,
  numberOf,
}: {
  /** 重要度で絞り込んだ後の指摘。隠れている指摘には飛べないので並べない */
  items: DraftItem[];
  numberOf: (findingId: string) => number | undefined;
}) {
  const text = t().review;
  return (
    <nav className="finding-index" aria-labelledby="finding-index-heading">
      <h2 id="finding-index-heading">
        {text.findingIndex} <span className="muted">{items.length}</span>
      </h2>
      <ol>
        {items.map((item) => {
          const { finding, anchor } = item.anchored;
          const number = numberOf(finding.id);
          const where =
            anchor === "line"
              ? `${splitPath(finding.path).name}:${finding.line}`
              : finding.path === ""
                ? t().wholePR
                : splitPath(finding.path).name;
          return (
            <li key={finding.id}>
              <button
                type="button"
                data-severity={finding.severity}
                data-status={item.status}
                title={`${finding.title}\n${finding.path}`}
                onClick={() => jumpTo(finding.id)}
              >
                <span className="finding-index-number">{number}</span>
                <span className="finding-index-text">
                  <span className="finding-index-title">{finding.title}</span>
                  <span className="finding-index-where">{where}</span>
                </span>
                {item.status === "pending" ? null : (
                  <span className="finding-index-status">
                    {item.status === "accepted" ? text.accepted : text.rejectedMark}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
