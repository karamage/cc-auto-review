import type { Lang } from "./i18n.ts";
import type { LgtmChoice } from "./lgtm.ts";
import type { RiskAssessment } from "./risk.ts";

/**
 * question は、意図が分からず結論を出せないときの確認。推測を blocker / should にしないための逃げ道。
 * nit は好みの範囲で、既定では表示しない
 */
export type Severity = "blocker" | "should" | "question" | "nit";

/** 重い順。1 行に複数の指摘があるときの印の色や、件数の並びに使う */
export const SEVERITIES: readonly Severity[] = ["blocker", "should", "question", "nit"];

/** 最初に表示する重大度。nit は好みの範囲なので、見たいときだけ出す */
export const DEFAULT_VISIBLE_SEVERITIES: readonly Severity[] = ["blocker", "should", "question"];

/** どのリポジトリのどの PR か。ローカルの clone に依存せず、常にこの 2 つで PR を特定する */
export interface PRRef {
  /** owner/repo */
  repo: string;
  number: number;
}

/** GitHub の owner / repo に使える文字 */
const NAME = "[A-Za-z0-9_.-]+";
const PR_URL = new RegExp(
  `^(?:https?://)?(?:www\\.)?github\\.com/(${NAME})/(${NAME})/pull/(\\d+)(?:[/?#].*)?$`,
);
const PR_SHORT = new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`);

/**
 * 画面で貼られた PR の指定を PRRef にする。読めなければ null。
 * https://github.com/owner/repo/pull/123（/files などが続いてもよい）と owner/repo#123 を受け付ける
 */
export function parsePRInput(input: string): PRRef | null {
  const text = input.trim();
  const match = PR_URL.exec(text) ?? PR_SHORT.exec(text);
  if (match === null) return null;
  const [, owner = "", repo = "", number = ""] = match;
  if ([owner, repo].some((name) => name === "." || name === "..") || Number(number) === 0) {
    return null;
  }
  return { repo: `${owner}/${repo}`, number: Number(number) };
}

export interface PRSummary {
  /** owner/repo */
  repo: string;
  number: number;
  title: string;
  author: string;
  headRefName: string;
  baseRefName: string;
  /** 一覧から直接 AI レビューを走らせるときに、どのコミットを見るかの指定に使う */
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  updatedAt: string;
  url: string;
}

/** GitHub 上で自分が最後に出したレビューの種類。PENDING（下書き）は含めない */
export type MyReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";

/** 自分がレビュー済みで、もう依頼は来ていない open な PR */
export interface ReviewedPR extends PRSummary {
  myReview: { state: MyReviewState; submittedAt: string };
}

export interface PRListResponse {
  /** 全リポジトリを横断した、自分にレビューが依頼されている open な PR */
  prs: PRSummary[];
  /**
   * 自分がレビュー済みの open な PR。投稿すると依頼が外れて prs から消えるので、別に取る。
   * このアプリの外（GitHub の画面やブラウザ版）で投稿したものも含む
   */
  reviewed: ReviewedPR[];
}

export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  /** 先頭の +/-/空白 を除いた本文 */
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  /** 変更後のパス。削除の場合は削除前のパス */
  path: string;
  /** rename のときだけ変更前のパスが入る */
  oldPath: string | null;
  status: FileStatus;
  hunks: DiffHunk[];
  isBinary: boolean;
}

export interface ExistingComment {
  id: number;
  author: string;
  body: string;
  /** null は PR 全体へのコメント */
  path: string | null;
  /** line は side が指す側の行番号。RIGHT なら変更後、LEFT なら変更前 */
  line: number | null;
  /**
   * 削除された行に付いたコメントは LEFT で、line は変更前ファイルの行番号になる。
   * 変更後の行番号と突き合わせると無関係な行に表示されるので区別する。
   */
  side: "LEFT" | "RIGHT" | null;
  createdAt: string;
  url: string;
}

export interface Finding {
  id: string;
  path: string;
  /** 変更後ファイル側の行番号。指定なしは null */
  line: number | null;
  severity: Severity;
  title: string;
  body: string;
  /** どういう入力・状態・手順で問題が起きるか。question と nit では空のこともある */
  trigger: string;
  /** 起きたときに何がどうなるか。question と nit では空のこともある */
  impact: string;
}

/** 過去の指摘が今のコードで直っているか。AI がコードを読んで判定する */
export type PriorFindingStatus = "fixed" | "unfixed" | "unverified";

/** 過去の指摘 1 件の判定。元のコメントの要点を添えて、どの指摘の話かを画面で示せるようにする */
export interface PriorFindingCheck {
  status: PriorFindingStatus;
  /** 判定の根拠。どのファイルのどこを読んでそう判断したか */
  evidence: string;
  comment: ExistingComment;
}

/**
 * i18n の観点で、元の日本語と locale ファイルの日本語を並べたもの 1 件。
 * 一致しているかは AI に決めさせず、文字列を比べて決める
 */
export interface I18nComparison {
  /** locale のキー。分からなければ空 */
  key: string;
  /** 変更前のコードなどにあった、元の日本語 */
  original: string;
  /** locale ファイルに書かれた日本語 */
  locale: string;
  /** 前後の空白を除いて完全に一致するか */
  match: boolean;
}

/** AI レビュー 1 回分の結果 */
export interface ReviewResult {
  findings: Finding[];
  /** 過去の指摘の判定。過去のコメントが無ければ空 */
  priorChecks: { commentId: number; status: PriorFindingStatus; evidence: string }[];
  /** AI が判定した変更のリスク。リスクの判定を頼んでいなければ null */
  risk: RiskAssessment | null;
  /** 元の日本語と locale の日本語の比較。i18n の観点が無効なら null */
  i18nComparisons: I18nComparison[] | null;
}

/**
 * 行コメント → 本文サマリ の降格段階。
 * GitHub の一括レビュー API（POST /pulls/{n}/reviews）の comments[] は
 * subject_type を受け付けないため、ファイル単位コメントという中間段は存在しない。
 */
export type AnchorKind = "line" | "summary";

export interface AnchoredFinding {
  finding: Finding;
  anchor: AnchorKind;
  /** anchor が "summary" のときは降格理由が必ず入る */
  reason: string | null;
}

export type ReviewEventKind = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface DraftComment {
  findingId: string;
  path: string;
  line: number | null;
  body: string;
  anchor: AnchorKind;
}

/** GitHub に投稿する言語。指摘を書いた言語（sourceLanguage）と違えば、サーバが訳してから投稿する */
export type CommentLanguage = Lang;

export interface SubmitRequest {
  event: ReviewEventKind;
  body: string;
  comments: DraftComment[];
  language: CommentLanguage;
  /**
   * 指摘と本文を書いた言語。AI レビューを実行したときの画面の言語。
   * 指定が無ければ、言語を選べなかった頃と同じく日本語とみなす
   */
  sourceLanguage?: CommentLanguage;
  /** APPROVE のときに本文へ添える LGTM 画像。ほかの種類では使わない */
  lgtm: LgtmChoice;
  /** レビュー対象として確定させるコミット。取得時の head SHA を渡す */
  commitId: string;
  /**
   * 完全自動運転の投稿か。true なら、投稿の直前に AI レビューを見送るラベルを確かめ、
   * 付いていれば投稿しない。人が画面から投稿するときは人の判断を優先するので確かめない
   */
  autopilot?: boolean;
}

/** 見送りのラベルが付いていて投稿しなかったことを、サーバが画面に伝える印 */
export const SKIP_REVIEW_CODE = "skip-review";

export interface PRDetail {
  pr: PRSummary;
  /**
   * PR の説明文を GitHub が Markdown から描画・無害化した HTML。
   * 説明文が無ければ空文字
   */
  bodyHtml: string;
  headSha: string;
  files: DiffFile[];
  comments: ExistingComment[];
}

/**
 * AI レビューで claude に渡す --model。claude が受け付ける別名なので、新しい版が出ても書き換えずに済む。
 * null は指定しない（claude の設定に任せる）
 */
export const REVIEW_MODELS = ["opus", "sonnet", "haiku"] as const;
export type ReviewModel = (typeof REVIEW_MODELS)[number];

export function isReviewModel(value: unknown): value is ReviewModel {
  return (REVIEW_MODELS as readonly unknown[]).includes(value);
}

/** null → opus → sonnet → haiku → null の順に切り替える。TUI のキー操作に使う */
export function nextReviewModel(model: ReviewModel | null): ReviewModel | null {
  const index = model === null ? -1 : REVIEW_MODELS.indexOf(model);
  return REVIEW_MODELS[index + 1] ?? null;
}

/** 最後に実行した claude -p から読んだ、Claude Code の利用枠の状態と使用量 */
export interface ClaudeUsage {
  /**
   * 利用枠の状態。status は allowed / allowed_warning / rejected。
   * resetsAt は ISO 8601、type は five_hour や overage など。分からなければ null
   */
  limit: { status: string; resetsAt: string | null; type: string | null } | null;
  /** その回のコストとトークン数。分からなければ null */
  run: { costUsd: number; inputTokens: number; outputTokens: number } | null;
  /** 記録した時刻（ISO 8601） */
  recordedAt: string;
}

export type ReviewStreamEvent =
  | { type: "snapshot_ready" }
  | { type: "reviewing"; message: string }
  | {
      type: "findings";
      findings: AnchoredFinding[];
      priorChecks: PriorFindingCheck[];
      /** 変更のリスク。パスと規模の規則と AI の判定を合わせたもの。判定を頼んでいなければ無い */
      risk?: RiskAssessment | null;
      /** 元の日本語と locale の日本語の比較。i18n の観点で AI レビューした回だけある */
      i18nComparisons?: I18nComparison[] | null;
      /** PR の説明文（無ければタイトル）の言語。読み取れなければ無い */
      descriptionLang?: Lang | null;
      /** 完全自動運転の回で、PR に自動判断のラベルが付いていたか。判定を頼んでいなければ無い */
      autoJudge?: boolean;
      /**
       * 完全自動運転の回で、PR に AI レビューを見送るラベルが付いていたので AI レビューしなかったか。
       * 判定を頼んでいなければ無い
       */
      skipped?: boolean;
      /**
       * レビューした変更の中身の要約。次の回で、レビューし直す意味のある変更があったかを見るのに使う。
       * diff を読む前に終わった回には無い
       */
      digest?: string;
      /**
       * 実際に使ったレビューのプロファイル。完全自動運転では、ルーティングの規則に当たると
       * 頼んだプロファイルから変えることがある。無ければ頼んだとおり
       */
      profileId?: string;
    }
  | { type: "error"; message: string; raw: string | null };

/** GitHub に投稿できたレビュー。投稿 API の応答から作る */
export interface PostedReview {
  /** 応答に無ければ null */
  url: string | null;
  /** GitHub が記録した投稿時刻（ISO 8601） */
  submittedAt: string;
}

export interface SubmitResponse {
  review: PostedReview;
}

export type PRState = "OPEN" | "CLOSED" | "MERGED";

/** 投稿したレビューのあとに、PR で何が起きたか。見守り（再レビューの判定）に使う */
/** PR のいまの head と、変更の中身の要約 */
export interface PRDigest {
  headSha: string;
  digest: string;
}

export interface PRActivity {
  state: PRState;
  headSha: string;
  /** since より後に PR の作成者が書いたコメント */
  replies: ExistingComment[];
  /**
   * since より後に、自分と PR の作成者以外の人が出して、いまも有効な承認（Approve）。
   * bot の承認は含まない。人が承認したら自動の再レビューは止める
   */
  approvals: Approval[];
}

/** PR に付いた承認。見守りを止めた理由として画面に出す */
export interface Approval {
  author: string;
  submittedAt: string;
  url: string;
}
