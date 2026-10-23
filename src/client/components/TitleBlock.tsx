import type { PRSummary } from "../../shared/types.ts";
import { t } from "../i18n.ts";

/**
 * 図面の表題欄に倣った PR の見出し。
 * 番号・題名・リポジトリ・作成者・ブランチ・変更規模を、罫線で区切った欄に固定の位置で置く
 */
export function TitleBlock({ pr }: { pr: PRSummary }) {
  const text = t().review;
  return (
    <header className="title-block">
      <div className="title-block-number">
        <span className="title-block-label">PR</span>
        <span className="title-block-digits">{pr.number}</span>
      </div>
      <h1 className="title-block-title">{pr.title}</h1>
      <dl className="title-block-fields">
        <div>
          <dt>{text.repository}</dt>
          <dd>
            <a href={pr.url} target="_blank" rel="noreferrer">
              {pr.repo}
            </a>
          </dd>
        </div>
        <div>
          <dt>{text.author}</dt>
          <dd>{pr.author}</dd>
        </div>
        <div>
          <dt>{text.branch}</dt>
          <dd className="title-block-branch">
            <span>{pr.headRefName}</span>
            <span className="muted">{text.branchInto}</span>
            <span>{pr.baseRefName}</span>
          </dd>
        </div>
        <div>
          <dt>{text.changes}</dt>
          <dd>
            <span className="count-add">+{pr.additions}</span>{" "}
            <span className="count-del">−{pr.deletions}</span>{" "}
            <span className="muted">{pr.changedFiles} files</span>
          </dd>
        </div>
      </dl>
    </header>
  );
}
