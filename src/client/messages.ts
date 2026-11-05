import type { Lang } from "../shared/i18n.ts";
import type {
  FileStatus,
  MyReviewState,
  PriorFindingStatus,
  ReviewEventKind,
  ReviewModel,
} from "../shared/types.ts";

/** モデルの別名の表示名。製品名なので言語で変えない */
const MODEL_NAMES: Record<ReviewModel, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

/**
 * 画面に出す文言。ブラウザ版と TUI の両方で使う。
 * ja を正とし、en は同じ形を必ず満たす（足りない文言は型検査で落ちる）
 */
const ja = {
  confirm: { cancel: "やめる" },
  // ---------- 共通 ----------
  relative: {
    justNow: "たった今",
    minutes: (n: number) => `${n} 分前`,
    hours: (n: number) => `${n} 時間前`,
    days: (n: number) => `${n} 日前`,
    locale: "ja-JP",
  },
  /** 一覧で更新の新しさを示す。「3 時間前に更新」 */
  updated: (relative: string) => `${relative}に更新`,
  modelName: (model: ReviewModel | null | "default") =>
    model === "default"
      ? "設定の既定"
      : model === null
        ? "Claude Code の設定に任せる"
        : MODEL_NAMES[model],
  /** 言語を切り替える操作に添える名前。どちらの言語でも、その言語自身の表記で出す */
  languageSwitch: "表示言語",
  languageName: { ja: "日本語", en: "English" } as Record<Lang, string>,
  openOnGitHub: "GitHub で開く",
  wholePR: "PR 全体",
  details: "詳細",
  fileStatus: {
    added: "新規",
    modified: "変更",
    deleted: "削除",
    renamed: "移動",
  } as Record<FileStatus, string>,
  oldPath: (path: string) => `（旧: ${path}）`,
  binaryFile: "バイナリファイルのため差分を表示できません。",
  noDescription: "説明文は書かれていません。",
  prDescription: "PR の説明",
  prComments: "PR へのコメント",
  unanchoredHeading: "行に紐づけられなかった指摘",
  unanchoredNote: "採用すると、レビュー本文の末尾にまとめて投稿されます。",
  priorChecksHeading: "過去の指摘の確認",
  aiVerdict: (label: string) => `AI 判定: ${label}`,
  changedFiles: "変更ファイル",
  noFindings: "指摘はありませんでした",

  // ---------- API ----------
  api: {
    requestFailed: "リクエストに失敗しました",
    submitFailed: "レビューの投稿に失敗しました",
    reviewStartFailed: "AI レビューを開始できませんでした",
  },

  // ---------- 下書き ----------
  draft: {
    trigger: "起きる条件",
    impact: "影響",
    doneNone: "AI レビューが完了しました。指摘はありませんでした。",
    whereLines: "diff の該当行に表示しています。",
    whereAllUnanchored: "すべて行に紐づけられなかったため、下の別枠に表示しています。",
    whereSome: (n: number) =>
      `diff の該当行と、行に紐づけられなかった ${n} 件は下の別枠に表示しています。`,
    hidden: (n: number) => `（うち ${n} 件はフィルタで非表示）`,
    done: (total: number, breakdown: string, filtered: string, where: string) =>
      `AI レビューが完了しました。指摘は ${total} 件（${breakdown}）${filtered}です。${where}`,
  },

  // ---------- 過去の指摘の判定 ----------
  priorStatus: {
    fixed: "修正済み",
    unfixed: "未修正",
    unverified: "確認できず",
  } as Record<PriorFindingStatus, string>,

  // ---------- AI レビュー後のチャット ----------
  chat: {
    open: "AI に質問する",
    heading: "レビューについて質問",
    close: "閉じる",
    empty: "レビュー結果への質問、コードの説明、気になる箇所の相談ができます。",
    unavailable: "表示中のコミットのレビューがありません。再レビューすると質問できます。",
    placeholder: "質問を入力（⌘ + Enter で送信）",
    send: "送信",
    sending: "回答を待っています…",
    fetching: "変更ファイルを GitHub から取得しています…",
    reading: "コードを読み込んでいます…",
    answering: "AI が確認しています…",
    you: "あなた",
    ai: "AI",
    ask: "質問",
    askLine: (path: string, line: number) => `${path} の ${line} 行目について質問`,
    referenceFinding: (number: number, title: string) => `指摘 ${number}: ${title}`,
    removeReference: "引用を外す",
    retry: "再送",
    addFinding: "指摘に追加",
    added: "追加済み",
    interrupted: "回答を受け取る前に中断されました。再送してください。",
    disconnected: "回答を受け取る前に接続が切れました。再送してください。",
    failed: "質問に失敗しました",
  },

  // ---------- AI レビューの実行 ----------
  session: {
    interrupted: "前回の AI レビューは完了する前に中断されました。もう一度実行してください。",
    queued: "ほかの PR の AI レビューが終わるのを待っています…",
    fetching: "変更ファイルを GitHub から取得しています…",
    reading: "コードを読み込んでいます…",
    disconnected: "AI レビューの結果を受け取る前に接続が切れました。もう一度実行してください。",
    failed: "AI レビューに失敗しました",
    notifyDone: (pr: string) => `AI レビューが完了しました: ${pr}`,
    notifyFailed: (pr: string) => `AI レビューに失敗しました: ${pr}`,
    notifyFindings: (n: number) => (n === 0 ? "指摘はありませんでした" : `指摘が ${n} 件あります`),
  },

  // ---------- 投稿後の見守り ----------
  watch: {
    merged: "PR がマージされました。",
    closed: "PR がクローズされました。",
    approvedBy: (names: string[]) => `${names.join("、")} が承認しました。`,
    newCommit: (sha: string) => `新しいコミット（${sha}）が push されました`,
    authorCommented: (n: number) => `作成者が ${n} 件コメントしました`,
    reasons: (reasons: string[]) => `${reasons.join("。")}。`,
    approved: "承認済み",
    posted: "投稿済み",
    waiting: (head: string) => `${head}・返信待ち`,
    rereviewed: "反応あり・再レビュー済み",
    ended: (head: string) => `${head}・PR 終了`,
    othersApproved: (head: string) => `${head}・他の人が承認`,
  },
  /** 完全自動運転。投稿する本文（commentHeadline 以降）は PR に載る */
  autopilot: {
    toggle: "完全自動運転",
    description: (minutes: number, model: string, approve: boolean) =>
      `${minutes} 分ごとにレビュー依頼を確認し、${model} で AI レビューして、指摘が無ければ${approve ? "承認" : "その旨をコメント"}、あればコメントして返信を待ちます。リスクの高い変更は投稿せずに人へ回します。`,
    console: {
      readoutOff: "停止",
      readoutBusy: "巡回中",
      captionOff: "つまみを入に",
      captionBusy: "レビューしています",
      captionUntil: "次の巡回まで",
      statusOff: (minutes: number) =>
        `止まっています。入にすると、レビュー依頼を ${minutes} 分ごとに巡回します。`,
      statusBusy: "依頼を取り直して、まだ見ていない PR をレビューしています。",
      statusOn: (time: string) =>
        `次の巡回は ${time}。人の判断が要る PR だけを、あなたに回します。`,
      dialLabel: (readout: string, n: number) => `巡回の計器。${readout}。扱った PR ${n} 件`,
      band: {
        human: "要判断",
        reviewing: "レビュー中",
        commented: "返信待ち",
        approved: "承認",
      } as Record<"human" | "reviewing" | "commented" | "approved", string>,
      open: (pr: string, band: string) => `${pr}（${band}）を開く`,
      logLabel: "自動運転の記録",
      logEmpty: "まだ扱った PR はありません。巡回すると、ここに記録が残ります。",
      log: {
        approved: "承認した",
        commented: (rounds: number) => `指摘をコメントした（${rounds} 回目）`,
        held: "同じ指摘なので投稿せずに待っている",
        reviewing: "レビューしている",
        human: "あなたに回した",
      },
      knobOff: "切",
      knobOn: "入",
      scale: "尺度",
      scaleValue: (minutes: number) => `1 周 = ${minutes} 分`,
      drafter: "作図",
      lastSweep: "前回の巡回",
    },
    pollFailed: (message: string) => `依頼の一覧を取得できませんでした: ${message}`,
    notifyHint: "人の判断が要る PR はデスクトップに通知します",
    stamp: {
      reviewing: "自動運転・レビュー中",
      paused: "自動運転・停止中",
      approved: "自動運転・承認",
      commented: (rounds: number) => `自動運転・コメント ${rounds} 回目`,
      held: "自動運転・修正待ち",
      human: "要人間判断",
      skipped: "自動運転・対象外",
      released: "自動運転・人が対応",
    },
    humanHeading: "人の判断が要る",
    humanNote:
      "完全自動運転が、リスクがある・確かめきれないと判断して投稿しなかった PR です。開いて確かめ、手で投稿してください。確かめて問題が無ければ「自動判断に任せる」で、以降はこの PR を人の判断なしで進めます。ほかの人がレビューしてくれたなら「自動運転から外す」で、以降は自動運転でレビューしません。",
    autoJudge: {
      action: "自動判断に任せる",
      busy: "ラベルを付けています…",
      hint: (label: string) =>
        `PR に ${label} ラベルを付けて AI レビューをやり直し、以降はリスクがあっても人に回さずに承認・コメントします`,
      failed: (message: string) => `ラベルを付けられませんでした: ${message}`,
    },
    release: {
      action: "自動運転から外す",
      hint: "ほかの人がレビューしてくれたなど、人が引き取った PR を外します。以降は新しいコミットが来ても自動運転ではレビューしません",
    },
    failed: (message: string) => `AI レビューに失敗した${message === "" ? "" : `（${message}）`}`,
    noRisk: "変更のリスクを判定できなかった",
    highRisk: "AI がリスクの高い変更と判定した",
    highRiskScore: (score: number, threshold: number) =>
      score > threshold
        ? `リスクの点数が ${score}/100 で、閾値の ${threshold} を超えた`
        : `AI が人の判断の要る重大な仕組みを見つけた（リスクの点数 ${score}/100）`,
    tooManyRounds: (n: number) =>
      `${n} 回コメントしても指摘が残っている。進め方を人と話した方がよい`,
    submitFailed: (message: string) => `GitHub への投稿に失敗した（${message}）`,
    approvedNote: "指摘が無かったので承認した",
    cleanNote: "指摘が無かったので、その旨をコメントした（承認は人に任せる）",
    heldNote: (n: number) =>
      `既存の指摘 ${n} 件が、直っていないか直ったか確かめられない。同じ内容は投稿せず、承認もしないで待っている`,
    withheldNote: (n: number, rounds: number) =>
      `直ったか確かめられない過去の指摘 ${n} 件を理由に、承認を保留するとコメントした（${rounds} 回目）。作成者の反応を待っている`,
    skippedNote: (label: string) => `${label} ラベルが付いているので、レビューも投稿もしなかった`,
    releasedNote: "人が引き取ったので、自動運転の対象から外した",
    commentedNote: (n: number, rounds: number) =>
      `指摘 ${n} 件をコメントした（${rounds} 回目）。作成者の反応を待っている`,
    notifyTitle: (pr: string) => `人の判断が要ります: ${pr}`,
    commentHeadline: (n: number) =>
      n === 0
        ? "🤖 自動レビュー（Claude）で、確認していただきたい点があります。"
        : `🤖 自動レビュー（Claude）で、確認していただきたい点が ${n} 件あります。見当違いの指摘があれば、理由を返信していただけると助かります。`,
    unfixedHeading: (n: number) => `以前いただいた指摘のうち ${n} 件が、まだ直っていないようです。`,
    withholdHeadline:
      "🤖 自動レビュー（Claude）で新しい指摘はありませんでしたが、承認はいったん保留しています。",
    unverifiedHeading: (n: number) =>
      `以前いただいた指摘のうち ${n} 件は、直ったかをコードから確かめられませんでした。直した箇所か、対応しない理由を返信していただけると助かります。`,
    approveBody: (model: ReviewModel | null) =>
      `🤖 自動レビュー（Claude${model === null ? "" : ` ${MODEL_NAMES[model]}`}）で指摘はありませんでした。ありがとうございます！`,
    cleanCommentBody: (model: ReviewModel | null) =>
      `🤖 自動レビュー（Claude${model === null ? "" : ` ${MODEL_NAMES[model]}`}）で指摘はありませんでした。承認は人のレビュアーに任せます。`,
  },
  myReview: {
    APPROVED: "承認済み",
    CHANGES_REQUESTED: "変更要求済み",
    COMMENTED: "コメント済み",
    DISMISSED: "レビュー取り下げ",
  } as Record<MyReviewState, string>,

  // ---------- 投稿 ----------
  event: {
    COMMENT: "コメントのみ",
    APPROVE: "承認する",
    REQUEST_CHANGES: "修正を求める",
  } as Record<ReviewEventKind, string>,
  /** 投稿する言語の名前。画面の言語で書く */
  commentLanguage: { ja: "日本語", en: "英語" } as Record<Lang, string>,
  lgtmRandom: "自動で選ぶ",
  lgtmNone: "付けない",

  // ---------- 一覧（ブラウザ） ----------
  list: {
    title: "レビュー依頼",
    loading: "GitHub から取得しています",
    none: "いま返すべきレビューはありません",
    waiting: (n: number) => `${n} 件の PR があなたのレビューを待っています`,
    allReviewed: "すべて AI レビュー済み",
    runPending: (n: number) => `未レビューの ${n} 件を AI レビュー`,
    fetchFailed: "PR 一覧を取得できませんでした",
    empty:
      "github.com/pulls/review-requested と同じ条件で探しました。新しい依頼が来たら、このページを再読み込みしてください。",
    queued: "AI レビュー待ち",
    running: "AI レビュー中",
    saved: "AI レビュー済み",
    savedNone: "指摘なし",
    notReviewed: "AI レビュー前",
    stale: "その後 PR が更新された",
    accepted: (accepted: number, findings: number) => `採用 ${accepted}/${findings}`,
    severityMark: (severity: string, n: number) => `${severity} ${n} 件`,
    files: (n: number) => `${n} ファイル`,
    lines: "行",
    legendSize: "変更行数（対数）",
    tallyRequests: "依頼",
    tallyReviewed: "AI レビュー済み",
    tallyBlockers: "blocker",
    tallyPosted: "投稿済み",
    keysMove: "移動",
    keysOpen: "開く",
    postedHeading: "投稿済み",
    postedNote:
      "レビューを投稿すると依頼が外れて上の一覧から消えるため、ここに残しています。見守っている PR は、作成者の修正か返信があれば AI レビューをやり直します。不要になったら PR を開いて「結果を消去」で外せます。",
    openByUrl: "URL で開く",
    openByUrlLabel: "レビューを依頼されていない PR も、URL を貼って開けます",
    openByUrlPlaceholder: "https://github.com/owner/repo/pull/123 または owner/repo#123",
    openByUrlButton: "開く",
    openByUrlInvalid:
      "PR の URL として読めませんでした。github.com/owner/repo/pull/番号 の形で貼ってください",
  },

  // ---------- ダッシュボード（ブラウザ） ----------
  dashboard: {
    tagline: "Claude Code で PR を自動レビュー",
    navLabel: "画面内の移動",
    nav: {
      dashboard: "ダッシュボード",
      requests: "レビュー依頼",
      autopilot: "自動運転",
      insights: "分析",
      posted: "投稿済み",
      openByUrl: "URL で開く",
    },
    source: "GitHub に接続中",
    kpi: {
      lines: "レビュー待ちの変更行数",
      linesUnit: "行",
      requests: "レビュー依頼",
      repos: (n: number) => `${n} リポジトリ`,
      reviewed: "AI レビュー済み",
      coverage: (percent: number) => `カバー率 ${percent}%`,
      blockers: "blocker 指摘",
      should: (n: number) => `should ${n} 件`,
      autopilot: "完全自動運転",
      on: "稼働中",
      off: "停止中",
      busy: "巡回しています",
      next: (time: string) => `次の巡回まで ${time}`,
      paused: "つまみで開始",
      human: "人の判断待ち",
      posted: (n: number, rereviewed: number) =>
        rereviewed === 0 ? `投稿済み ${n} 件` : `投稿済み ${n} 件・再レビュー ${rereviewed}`,
    },
    trend: {
      title: "レビュー待ちの変更量 推移",
      unit: "累積変更行数（更新の古い順）",
      total: "合計",
      empty: "レビュー依頼が無いので、推移はまだ描けません",
      label: (n: number, total: number) =>
        `${n} 件の PR の変更行数を積み上げた推移。合計 ${total} 行`,
    },
    severity: {
      title: "指摘の重大度",
      total: "指摘",
      empty: "まだ AI レビューの指摘はありません",
    },
    repos: { title: "リポジトリ別 依頼", total: "依頼", rest: "その他" },
    heatmap: {
      title: "時間帯別アクティビティ",
      note: "直近 7 日の PR 更新・AI レビュー・自動運転",
      today: "今日",
      cell: (day: string, hour: number, n: number) => `${day} ${hour} 時台: ${n} 件`,
    },
    authors: {
      title: "作成者別 変更行数",
      empty: "レビュー依頼が無いので、まだ数えられません",
      prs: (n: number) => `${n} PR`,
    },
  },

  // ---------- レビュー画面（ブラウザ） ----------
  review: {
    riskScore: {
      heading: "変更のリスク",
      needsHuman: "人の判断が必要",
      aiOk: "AI レビューで十分",
      decisionNote: (threshold: number) =>
        `完全自動運転は ${threshold} 点を超えた PR を人に回します`,
      baselineOnly:
        "diff から機械的に決めた点数です。AI レビューを実行すると、変更の意味を読んで ±20 点まで補正します",
      stale: "表示中のコミットとは違うコミットの結果です",
      breakdown: "内訳",
      baseline: "基準点",
      semantic: "AI の補正",
      escalation: "エスカレーション",
      patterns: "当たったパターン",
      adjustments: "上限・下限",
    },
    back: "レビュー依頼の一覧",
    loadFailed: "PR を取得できませんでした",
    loading: "PR を GitHub から読み込んでいます",
    aiReview: "AI レビュー",
    focus: "重点的に見てほしいこと（任意）",
    focusPlaceholder: "例: 権限チェックの漏れがないか / 既存の挙動が変わっていないか",
    model: "モデル",
    profile: "レビューのやり方",
    editProfiles: "設定で編集",
    usage: "Claude Code の使用量",
    usageStatus: (status: string) =>
      ({ allowed: "利用可", allowed_warning: "上限に近い", rejected: "上限に達した" })[status] ??
      status,
    usageResets: (time: string) => `（${time} にリセット）`,
    usageLastRun: (cost: string, input: string, output: string) =>
      `前回 $${cost}・入力 ${input} / 出力 ${output} tokens`,
    usageRecorded: (relative: string) => `${relative}のレビュー時点`,
    usageNone: "AI レビューを実行すると表示します",
    running: "レビューしています",
    run: "AI レビューを実行",
    rerun: "もう一度実行",
    rerunWithOptions: "条件を変えてもう一度実行",
    mayTakeMinutes: "数分かかることがあります。ほかの PR を見ていても止まりません。",
    findingsUnit: (_n: number) => " 件の指摘",
    unanchoredCount: (n: number) => `行に紐づかない ${n} 件は、diff の上にまとめています。`,
    savedAt: (relative: string) => `${relative}の結果を保存しています。`,
    savedKept: "一覧に戻っても消えません。",
    savedStale: (sha: string) =>
      `その後 PR が更新されたため、${sha} 時点の結果です。もう一度実行すると最新のコミットで見直せます。`,
    confirmClear: "保存した AI レビューの結果と下書きを消去しますか？",
    confirmClearPosted:
      "保存した AI レビューの結果と下書き、投稿の記録を消去しますか？投稿後の見守りも止まります。",
    clear: "結果を消去",
    clearConfirm: "消去する",
    collapseDescription: "説明を折りたたむ",
    expandDescription: "説明をすべて表示",
    priorChecksIntro: (summary: string) =>
      `AI が今のコードを読んで判定しました（${summary}）。作成者の返信や解決済みの印は根拠にしていません。`,
    i18nHeading: "元の日本語 vs locales日本語の比較",
    i18nIntro: (matched: number, total: number) =>
      `${total} 件中 ${matched} 件が完全一致（前後の空白を除いて文字列を比べています）`,
    i18nNone: "比べる日本語はありませんでした。",
    i18nOriginal: "元",
    i18nLocale: "locales",
    i18nMatch: "完全一致",
    i18nMismatch: "不一致",
    deletedLineComment: "削除された行へのコメント",
    collapse: "折りたたむ",
    readMore: "続きを読む",
    severityLegend: "表示する重要度",
    severityCount: (severity: string) => ` 件の ${severity}`,
    findingNumber: (n: number) => `指摘 ${n}`,
    findingIndex: "指摘一覧",
    rejectedMark: "却下",
    commentBody: "投稿するコメント本文",
    accepted: "採用済み",
    accept: "採用する",
    unreject: "却下を戻す",
    reject: "却下する",
    editHint: "本文を書き換えてから投稿できます",
    repository: "リポジトリ",
    author: "作成者",
    branch: "ブランチ",
    /** head から base へ。「feature から main」 */
    branchInto: " から ",
    changes: "変更",
  },

  // ---------- 投稿パネル（ブラウザ） ----------
  submit: {
    heading: "GitHub に投稿",
    acceptedUnit: " 件を採用",
    tally: (line: number, summary: number) => `（行コメント ${line}、本文にまとめる ${summary}）`,
    eventLegend: "レビューの種類",
    suggested: "採用内容から推奨",
    summary: "レビュー本文（任意）",
    summaryPlaceholder: "全体への所感や、マージ前に確認してほしいこと",
    languageLegend: "投稿する言語",
    translatingAndPosting: (language: string) => `${language}に訳して投稿しています`,
    posting: "投稿しています",
    postAgain: "もう一度投稿",
    post: "GitHub に投稿",
    hint: "指摘を採用するか本文を書くと投稿できます。承認だけなら種類を「承認する」にしてください。",
    confirmHeading: "この内容で投稿します",
    kind: "種類",
    lineComments: "行コメント",
    summaryFindings: "本文にまとめる指摘",
    count: (n: number) => `${n} 件`,
    language: "言語",
    lgtmImage: "LGTM 画像",
    chosenLgtm: "選んだ LGTM 画像",
    willTranslate: (language: string) =>
      `投稿の直前に AI が${language}に訳します。1 分ほどかかることがあります。`,
    alreadyPosted:
      "このコミットにはすでに投稿しています。同じ指摘を採用したままだと GitHub 上で重複します。",
    public: "投稿すると PR の参加者全員に公開されます。取り消しは GitHub 上で行います。",
    back: "戻って直す",
    confirm: "投稿する",
  },

  // ---------- LGTM 画像（ブラウザ） ----------
  lgtm: {
    heading: "LGTM 画像",
    attach: "本文に添える",
    chosenAlt: (id: number) => `選んだ LGTM 画像 #${id}`,
    drawing: "引いています",
    noImage: "画像なしで承認します",
    seal: "承認",
    sheetNo: "図番",
    sheet: "枚",
    shuffle: "シャッフル",
    pick: "画像を選ぶ",
    imageAlt: (id: number) => `LGTM 画像 #${id}`,
  },

  // ---------- 投稿済みの記録（ブラウザ） ----------
  posted: {
    heading: "投稿済み",
    summary: (relative: string, event: string, comments: number) =>
      `${relative}、「${event}」で投稿${comments === 0 ? "" : `（指摘 ${comments} 件）`}`,
    view: "GitHub で見る",
    stale: (sha: string) => `投稿したのは ${sha} 時点です。その後 PR が更新されています。`,
    waiting: (minutes: number, checked: string | null) =>
      `作成者の修正か返信を待っています。${minutes} 分ごとに確認し、あれば AI レビューをやり直します${checked === null ? "。" : `（最後の確認: ${checked}）。`}`,
    waitingNote: "一覧に戻っても続きます。アプリを終了すると止まり、次に起動したときに再開します。",
    rereviewed: "AI レビューをやり直しました。指摘を確かめて、必要ならもう一度投稿してください。",
    closed: "見守りを終えました。",
    approved:
      "人の判断を優先して、自動の再レビューを止めました。それでも追い続けるなら、もう一度見守りを始めてください。",
    off: (minutes: number) =>
      `見守りを始めると、${minutes} 分ごとに作成者の修正か返信を確認し、あれば AI レビューをやり直します。`,
    start: "見守りを始める",
    stop: "見守りをやめる",
  },

  // ---------- 設定 ----------
  settings: {
    open: "設定",
    title: "設定",
    back: "一覧へ戻る",
    loading: "設定を読み込んでいます",
    save: "保存",
    saving: "保存しています",
    saved: "保存しました",
    saveFailed: (message: string) => `保存できませんでした: ${message}`,
    discard: "変更を破棄",
    unsaved: "未保存の変更があります",
    discardAndBack: "破棄して戻る",
    resetDefaults: "すべて既定に戻す",
    confirmReset: "すべての設定を既定に戻しますか？保存するまでは反映されません。",
    storedAt: "設定は ~/.config/cc-auto-review/settings.json に保存されます。",
    tabs: { profiles: "レビューのやり方", autopilot: "完全自動運転", general: "全般" },
    profiles: {
      intro:
        "プロファイルは「何を見て、何を見ないか、どう書くか」の一式です。レビュー画面で PR ごとに選べます。既定のプロファイルのままでも、確かめられた問題に絞って指摘します。",
      add: "プロファイルを追加",
      newName: "新しいプロファイル",
      duplicate: "複製",
      copyName: (name: string) => `${name} のコピー`,
      remove: "削除",
      confirmRemove: (name: string) => `プロファイル「${name}」を削除しますか？`,
      isDefault: "既定",
      makeDefault: "既定にする",
      name: "名前",
      perspectives: "レビューの観点",
      perspectivesIntro:
        "オンの観点だけをプロンプトに並べ、それ以外は指摘させません。説明はどの言語で書いても構いません。",
      addPerspective: "観点を追加",
      perspectiveTitle: "見出し",
      perspectiveDescription: "何を見るか。具体的に書くほど指摘の精度が上がります",
      removePerspective: "観点を削除",
      moveUp: "上へ",
      moveDown: "下へ",
      exclusions: "指摘しないこと",
      exclusionsHint: "1 行に 1 項目。ノイズになる指摘を止めます",
      instructions: "チームのレビュー指示",
      instructionsHint:
        "チームの規約、重視すること、指摘の口調など。リポジトリの CLAUDE.md / AGENTS.md / REVIEW.md は別に読み込みます",
      instructionsPlaceholder:
        "例: エラーは Result 型で返す規約です。throw している箇所は指摘してください。\n例: 指摘は丁寧語で、修正案を suggestion ブロックで添えてください。",
      tools: "追加で許すツール",
      toolsHint:
        "1 行に 1 つ。Skill、WebFetch、mcp__server、mcp__server__tool など。PR の本文に紛れた指示で呼ばれうるので、書き込みのできるツールは許さないでください",
      maxFindings: "指摘の数の上限",
      maxFindingsHint: "0 で上限なし。超えたら重いものから残させます",
      preview: "プロンプトを確認",
      previewHeading: (name: string) => `「${name}」のプロンプト（例の PR）`,
      close: "閉じる",
    },
    general: {
      defaultModel: "手動の AI レビューの既定のモデル",
      timeout: "AI レビュー 1 回の制限時間（分）",
      lgtmImageIds: "LGTM 画像の ID",
      lgtmImageIdsHint:
        "1 行に 1 つ、LGTMoon の画像の ID を書きます（image.lgtmoon.dev/ の後ろの数字）。数字以外の行は保存時に捨て、空にすると既定の一覧に戻ります。",
    },
    autopilot: {
      intro:
        "完全自動運転は、レビュー依頼を定期的に確かめ、リスクで段階を分けて、人が見るべき変更だけを人に回します。",
      model: "モデル",
      profile: "既定のプロファイル",
      interval: "巡回の間隔（分）",
      maxRounds: "コメントの回数の上限",
      maxRoundsHint: "これだけコメントしても指摘が残れば人に回します",
      approve: "指摘が無ければ承認する",
      approveHint: "オフにすると、指摘が無い旨をコメントするだけで、承認は人に任せます",
      lgtmImage: "承認の本文に LGTM 画像を添える",
      animations: "操作盤のアニメーション",
      animationsHint: "オフにすると、計器の回転や点滅を止めて静止した図で表示します",
      autoJudgeLabel: "自動判断に任せるラベル",
      autoJudgeLabelHint: "このラベルが付いた PR は、リスクを理由に人へ回しません",
      skipLabel: "AI レビューを見送るラベル",
      skipLabelHint: "このラベルが付いた PR は、自動運転がレビューも投稿もしません",
      routing: "プロファイルの振り分け",
      routingIntro:
        "リポジトリ、ラベル、PR の説明・コメントのメンション（@org/team など）で、PR を別のプロファイルでレビューします。リポジトリ（owner/repo）を書いた規則はそのリポジトリの PR にだけ当たり、ラベルもメンションも空ならそのリポジトリの PR すべてに当たります。上の規則から順に見ます。",
      routingRepo: "リポジトリ",
      routingLabel: "ラベル",
      routingMention: "メンション",
      routingProfile: "プロファイル",
      addRule: "規則を追加",
      removeRule: "削除",
      handoff: "人に任せる基準",
      handoffIntro:
        "AI がリスクを判定するときに読む、チームの基準です。当てはまる変更は人に回します。「ドキュメントだけの変更は人に回さなくてよい」のように緩める書き方もできます。どの言語で書いても構いません。",
      handoffRules: "基準",
      handoffHint:
        "1 行に 1 つ。空にすると AI の一般的な判断に任せます。下のパスと行数の規則は、これとは別に AI を呼ばずに当てます",
      sensitive: "AI を呼ばずに人へ回すパス",
      sensitiveIntro:
        "パスの正規表現（JavaScript の書き方。先頭の (?i) で大文字小文字を区別しない）と、人に回す理由です。",
      pattern: "正規表現",
      reason: "理由",
      invalidPattern: "正規表現として読めません",
      maxLines: "人に回す変更行数",
      maxLinesHint: "追加と削除の合計がこれを超えたら人に回します。0 で規模では回しません",
      riskThreshold: "人に回すリスクの点数",
      riskThresholdHint:
        "変更のリスクの点数（0〜100）がこれを超えたら人に回します。AI が重大な問題を引用付きで見つけたときは、点数に関わらず人に回します",
      ignored: "変更行数に数えないパス",
      ignoredHint: "1 行に 1 つの正規表現。ロックファイルやビルドの成果物",
    },
  },
};

export type Messages = typeof ja;

const en: Messages = {
  confirm: { cancel: "Cancel" },
  relative: {
    justNow: "just now",
    minutes: (n) => `${n} min ago`,
    hours: (n) => `${n} ${n === 1 ? "hour" : "hours"} ago`,
    days: (n) => `${n} ${n === 1 ? "day" : "days"} ago`,
    locale: "en-US",
  },
  updated: (relative) => `updated ${relative}`,
  modelName: (model) =>
    model === "default"
      ? "Settings default"
      : model === null
        ? "Claude Code settings"
        : MODEL_NAMES[model],
  languageSwitch: "Language",
  languageName: { ja: "日本語", en: "English" },
  openOnGitHub: "Open on GitHub",
  wholePR: "Whole PR",
  details: "Details",
  fileStatus: {
    added: "Added",
    modified: "Modified",
    deleted: "Deleted",
    renamed: "Renamed",
  },
  oldPath: (path) => ` (was ${path})`,
  binaryFile: "This is a binary file, so the diff cannot be shown.",
  noDescription: "No description provided.",
  prDescription: "PR description",
  prComments: "Comments on the PR",
  unanchoredHeading: "Findings not tied to a line",
  unanchoredNote: "Accepted ones are posted together at the end of the review body.",
  priorChecksHeading: "Earlier findings",
  aiVerdict: (label) => `AI: ${label}`,
  changedFiles: "Changed files",
  noFindings: "No findings",

  api: {
    requestFailed: "The request failed",
    submitFailed: "Failed to post the review",
    reviewStartFailed: "Could not start the AI review",
  },

  draft: {
    trigger: "When it happens",
    impact: "Impact",
    doneNone: "The AI review is done. There were no findings.",
    whereLines: "They are shown on the matching lines of the diff.",
    whereAllUnanchored:
      "None could be tied to a line, so they are shown in the separate section below.",
    whereSome: (n) =>
      `They are shown on the matching lines of the diff, and the ${n} not tied to a line are in the separate section below.`,
    hidden: (n) => ` (${n} hidden by the filter)`,
    done: (total, breakdown, filtered, where) =>
      `The AI review is done. ${total} ${total === 1 ? "finding" : "findings"} (${breakdown})${filtered}. ${where}`,
  },

  priorStatus: {
    fixed: "Fixed",
    unfixed: "Not fixed",
    unverified: "Unverified",
  },

  chat: {
    open: "Ask the AI",
    heading: "Ask about this review",
    close: "Close",
    empty: "Ask about the findings, have code explained, or discuss anything that looks off.",
    unavailable: "There is no review for the shown commit. Review it again to ask questions.",
    placeholder: "Ask a question (⌘ + Enter to send)",
    send: "Send",
    sending: "Waiting for the answer…",
    fetching: "Fetching the changed files from GitHub…",
    reading: "Reading the code…",
    answering: "The AI is checking…",
    you: "You",
    ai: "AI",
    ask: "Ask",
    askLine: (path, line) => `Ask about line ${line} of ${path}`,
    referenceFinding: (number, title) => `Finding ${number}: ${title}`,
    removeReference: "Remove the reference",
    retry: "Send again",
    addFinding: "Add as a finding",
    added: "Added",
    interrupted: "This was interrupted before the answer arrived. Send it again.",
    disconnected: "The connection closed before the answer arrived. Send it again.",
    failed: "The question failed",
  },

  session: {
    interrupted: "The previous AI review was interrupted before it finished. Run it again.",
    queued: "Waiting for the AI reviews of other PRs to finish…",
    fetching: "Fetching the changed files from GitHub…",
    reading: "Reading the code…",
    disconnected: "The connection closed before the AI review result arrived. Run it again.",
    failed: "The AI review failed",
    notifyDone: (pr) => `AI review finished: ${pr}`,
    notifyFailed: (pr) => `AI review failed: ${pr}`,
    notifyFindings: (n) => (n === 0 ? "No findings" : `${n} ${n === 1 ? "finding" : "findings"}`),
  },

  watch: {
    merged: "The PR was merged. ",
    closed: "The PR was closed. ",
    approvedBy: (names) => `${names.join(", ")} approved it. `,
    newCommit: (sha) => `A new commit (${sha}) was pushed`,
    authorCommented: (n) => `The author left ${n} ${n === 1 ? "comment" : "comments"}`,
    reasons: (reasons) => `${reasons.join(". ")}. `,
    approved: "Approved",
    posted: "Posted",
    waiting: (head) => `${head} · awaiting reply`,
    rereviewed: "Activity · re-reviewed",
    ended: (head) => `${head} · PR ended`,
    othersApproved: (head) => `${head} · approved by others`,
  },
  autopilot: {
    toggle: "Full autopilot",
    description: (minutes, model, approve) =>
      `Checks review requests every ${minutes} minutes and runs an AI review with ${model}. ${approve ? "Approves" : "Leaves a comment"} when nothing is found; otherwise comments and waits for a reply. Risky changes are handed to you without posting.`,
    console: {
      readoutOff: "Off",
      readoutBusy: "Sweeping",
      captionOff: "Turn the knob on",
      captionBusy: "Reviewing PRs",
      captionUntil: "until next sweep",
      statusOff: (minutes) =>
        `Stopped. Turn it on to sweep your review requests every ${minutes} minutes.`,
      statusBusy: "Fetching requests again and reviewing PRs it hasn't seen yet.",
      statusOn: (time) => `Next sweep at ${time}. Only PRs that need a human come back to you.`,
      dialLabel: (readout, n) => `Sweep gauge. ${readout}. ${n} ${n === 1 ? "PR" : "PRs"} handled`,
      band: {
        human: "Needs you",
        reviewing: "Reviewing",
        commented: "Awaiting reply",
        approved: "Approved",
      },
      open: (pr, band) => `Open ${pr} (${band})`,
      logLabel: "Autopilot log",
      logEmpty: "No PRs handled yet. Each sweep leaves a record here.",
      log: {
        approved: "approved",
        commented: (rounds) => `commented findings (round ${rounds})`,
        held: "waiting without reposting the same findings",
        reviewing: "reviewing",
        human: "handed to you",
      },
      knobOff: "Off",
      knobOn: "On",
      scale: "Scale",
      scaleValue: (minutes) => `1 turn = ${minutes} min`,
      drafter: "Drawn by",
      lastSweep: "Last sweep",
    },
    pollFailed: (message) => `Could not fetch review requests: ${message}`,
    notifyHint: "You get a desktop notification when a PR needs a human",
    stamp: {
      reviewing: "Autopilot · reviewing",
      paused: "Autopilot · paused",
      approved: "Autopilot · approved",
      commented: (rounds) => `Autopilot · comment round ${rounds}`,
      held: "Autopilot · awaiting fixes",
      human: "Needs a human",
      skipped: "Autopilot · skipped",
      released: "Autopilot · taken by a human",
    },
    humanHeading: "Needs a human",
    humanNote:
      'The autopilot did not post on these PRs because they look risky or could not be verified. Open them, check, and post by hand. If they look fine, choose "Let autopilot decide" to handle the PR without a human from then on. If someone else has already reviewed it, choose "Remove from autopilot" so the autopilot no longer reviews it.',
    autoJudge: {
      action: "Let autopilot decide",
      busy: "Adding the label…",
      hint: (label) =>
        `Adds the ${label} label to the PR and reruns the AI review. From then on the autopilot approves or comments without handing it to you, even when it looks risky`,
      failed: (message) => `Could not add the label: ${message}`,
    },
    release: {
      action: "Remove from autopilot",
      hint: "For PRs a person has taken over, such as when someone else already reviewed them. The autopilot will not review this PR again, even after new commits",
    },
    failed: (message) => `The AI review failed${message === "" ? "" : ` (${message})`}`,
    noRisk: "The change's risk could not be assessed",
    highRisk: "The AI rated the change as high risk",
    highRiskScore: (score: number, threshold: number) =>
      score > threshold
        ? `The risk score is ${score}/100, above the threshold of ${threshold}`
        : `The AI found a serious mechanism that needs a human decision (risk score ${score}/100)`,
    tooManyRounds: (n) =>
      `Findings remain after ${n} comment rounds; the approach is worth discussing with a person`,
    submitFailed: (message) => `Posting to GitHub failed (${message})`,
    approvedNote: "No findings, so it was approved",
    cleanNote: "No findings; left a comment saying so (approval is left to a human)",
    heldNote: (n) =>
      `${n} existing ${n === 1 ? "finding is" : "findings are"} unaddressed or could not be verified. Waiting without reposting or approving`,
    withheldNote: (n, rounds) =>
      `Commented that approval is on hold because ${n} earlier ${n === 1 ? "finding" : "findings"} could not be verified (round ${rounds}); waiting for the author`,
    skippedNote: (label) => `Has the ${label} label, so it was neither reviewed nor posted`,
    releasedNote: "Taken over by a human, so it was removed from the autopilot",
    commentedNote: (n, rounds) =>
      `Commented ${n} ${n === 1 ? "finding" : "findings"} (round ${rounds}); waiting for the author`,
    notifyTitle: (pr) => `Needs a human: ${pr}`,
    commentHeadline: (n) =>
      n === 0
        ? "🤖 The automated review (Claude) found a few things worth a look."
        : `🤖 The automated review (Claude) found ${n} ${n === 1 ? "point" : "points"} worth a look. If any of them is off the mark, a quick reply with the reason would be much appreciated.`,
    unfixedHeading: (n) =>
      `${n} earlier ${n === 1 ? "comment does" : "comments do"} not seem to be addressed yet.`,
    withholdHeadline:
      "🤖 The automated review (Claude) found nothing new, but approval is on hold for now.",
    unverifiedHeading: (n) =>
      `For ${n} earlier ${n === 1 ? "comment" : "comments"}, the review could not confirm from the code that ${n === 1 ? "it was" : "they were"} addressed. A quick reply pointing to the fix, or explaining why it won't be changed, would be much appreciated.`,
    approveBody: (model) =>
      `🤖 The automated review (Claude${model === null ? "" : ` ${MODEL_NAMES[model]}`}) found no issues. Thank you!`,
    cleanCommentBody: (model) =>
      `🤖 The automated review (Claude${model === null ? "" : ` ${MODEL_NAMES[model]}`}) found no issues. Approval is left to a human reviewer.`,
  },
  myReview: {
    APPROVED: "Approved",
    CHANGES_REQUESTED: "Changes requested",
    COMMENTED: "Commented",
    DISMISSED: "Review dismissed",
  },

  event: {
    COMMENT: "Comment only",
    APPROVE: "Approve",
    REQUEST_CHANGES: "Request changes",
  },
  commentLanguage: { ja: "Japanese", en: "English" },
  lgtmRandom: "Pick automatically",
  lgtmNone: "None",

  list: {
    title: "Review requests",
    loading: "Fetching from GitHub",
    none: "No reviews waiting on you right now",
    waiting: (n) => `${n} ${n === 1 ? "PR is" : "PRs are"} waiting for your review`,
    allReviewed: "All AI-reviewed",
    runPending: (n) => `AI-review ${n} unreviewed ${n === 1 ? "PR" : "PRs"}`,
    fetchFailed: "Could not fetch the PR list",
    empty:
      "Searched with the same conditions as github.com/pulls/review-requested. Reload this page when new requests come in.",
    queued: "AI review queued",
    running: "AI reviewing",
    saved: "AI-reviewed",
    savedNone: "No findings",
    notReviewed: "Not AI-reviewed",
    stale: "PR updated since",
    accepted: (accepted, findings) => `${accepted}/${findings} accepted`,
    severityMark: (severity, n) => `${n} ${severity}`,
    files: (n) => `${n} ${n === 1 ? "file" : "files"}`,
    lines: "lines",
    legendSize: "Lines changed (log)",
    tallyRequests: "Requests",
    tallyReviewed: "AI-reviewed",
    tallyBlockers: "Blockers",
    tallyPosted: "Posted",
    keysMove: "move",
    keysOpen: "open",
    postedHeading: "Posted",
    postedNote:
      "Posting a review removes the request, so the PR drops off the list above and is kept here instead. Watched PRs get a new AI review when the author pushes a fix or replies. Open a PR and choose “Clear result” to remove it.",
    openByUrl: "Open by URL",
    openByUrlLabel: "Paste a URL to open any PR, including ones you were not asked to review",
    openByUrlPlaceholder: "https://github.com/owner/repo/pull/123 or owner/repo#123",
    openByUrlButton: "Open",
    openByUrlInvalid:
      "That doesn’t look like a PR URL. Paste one in the form github.com/owner/repo/pull/NUMBER",
  },

  dashboard: {
    tagline: "Automated PR review with Claude Code",
    navLabel: "Jump to",
    nav: {
      dashboard: "Dashboard",
      requests: "Requests",
      autopilot: "Autopilot",
      insights: "Insights",
      posted: "Posted",
      openByUrl: "Open URL",
    },
    source: "Connected to GitHub",
    kpi: {
      lines: "Lines awaiting review",
      linesUnit: "lines",
      requests: "Review requests",
      repos: (n) => `${n} ${n === 1 ? "repository" : "repositories"}`,
      reviewed: "AI-reviewed",
      coverage: (percent) => `${percent}% covered`,
      blockers: "Blocker findings",
      should: (n) => `${n} should`,
      autopilot: "Full autopilot",
      on: "Running",
      off: "Stopped",
      busy: "Sweeping now",
      next: (time) => `Next sweep in ${time}`,
      paused: "Turn the knob to start",
      human: "Needs a human",
      posted: (n, rereviewed) =>
        rereviewed === 0 ? `${n} posted` : `${n} posted · ${rereviewed} re-reviewed`,
    },
    trend: {
      title: "Review backlog over time",
      unit: "Cumulative lines changed (oldest update first)",
      total: "Total",
      empty: "No review requests yet, so there is nothing to plot",
      label: (n, total) => `Lines changed, stacked over ${n} PRs. ${total} lines in total`,
    },
    severity: {
      title: "Findings by severity",
      total: "Findings",
      empty: "No AI review findings yet",
    },
    repos: { title: "Requests by repository", total: "Requests", rest: "Others" },
    heatmap: {
      title: "Activity by hour",
      note: "PR updates, AI reviews and autopilot moves over the last 7 days",
      today: "Today",
      cell: (day, hour, n) => `${day} ${hour}:00: ${n}`,
    },
    authors: {
      title: "Lines changed by author",
      empty: "No review requests to count yet",
      prs: (n) => `${n} ${n === 1 ? "PR" : "PRs"}`,
    },
  },

  review: {
    riskScore: {
      heading: "Change risk",
      needsHuman: "Human review required",
      aiOk: "AI review is sufficient",
      decisionNote: (threshold: number) =>
        `Autopilot hands PRs scoring above ${threshold} to a human`,
      baselineOnly:
        "Computed from the diff alone. Running the AI review reads what the change means and adjusts the score by up to ±20",
      stale: "This result is for a different commit than the one shown",
      breakdown: "Breakdown",
      baseline: "Baseline",
      semantic: "AI adjustment",
      escalation: "escalation",
      patterns: "Matched patterns",
      adjustments: "Caps and floors",
    },
    back: "Review requests",
    loadFailed: "Could not fetch the PR",
    loading: "Loading the PR from GitHub",
    aiReview: "AI review",
    focus: "What to look at closely (optional)",
    focusPlaceholder: "e.g. missing permission checks / changes to existing behavior",
    model: "Model",
    profile: "Review profile",
    editProfiles: "Edit in settings",
    usage: "Claude Code usage",
    usageStatus: (status) =>
      ({ allowed: "Available", allowed_warning: "Near the limit", rejected: "Limit reached" })[
        status
      ] ?? status,
    usageResets: (time) => ` (resets ${time})`,
    usageLastRun: (cost, input, output) => `last run $${cost} · ${input} in / ${output} out tokens`,
    usageRecorded: (relative) => `as of the review ${relative}`,
    usageNone: "Shown after you run an AI review",
    running: "Reviewing",
    run: "Run AI review",
    rerun: "Run again",
    rerunWithOptions: "Run again with different instructions",
    mayTakeMinutes: "This can take a few minutes. It keeps running while you look at other PRs.",
    findingsUnit: (n) => (n === 1 ? " finding" : " findings"),
    unanchoredCount: (n) =>
      `${n} ${n === 1 ? "finding is" : "findings are"} not tied to a line and shown above the diff.`,
    savedAt: (relative) => `Result from ${relative} is saved. `,
    savedKept: "It stays when you go back to the list.",
    savedStale: (sha) =>
      `The PR has been updated since, so this result is for ${sha}. Run it again to review the latest commit.`,
    confirmClear: "Clear the saved AI review result and draft?",
    confirmClearPosted:
      "Clear the saved AI review result, draft, and posting record? Watching after posting will also stop.",
    clear: "Clear result",
    clearConfirm: "Clear",
    collapseDescription: "Collapse description",
    expandDescription: "Show full description",
    priorChecksIntro: (summary) =>
      `The AI read the current code to judge these (${summary}). Author replies and resolved threads are not taken as evidence.`,
    i18nHeading: "Original Japanese vs. locale Japanese",
    i18nIntro: (matched, total) =>
      `${matched} of ${total} match exactly (compared as strings, ignoring leading and trailing spaces)`,
    i18nNone: "There was no Japanese to compare.",
    i18nOriginal: "Original",
    i18nLocale: "Locale",
    i18nMatch: "Exact match",
    i18nMismatch: "Mismatch",
    deletedLineComment: "Comment on a deleted line",
    collapse: "Collapse",
    readMore: "Read more",
    severityLegend: "Severities to show",
    severityCount: (severity) => ` ${severity}`,
    findingNumber: (n) => `Finding ${n}`,
    findingIndex: "Findings",
    rejectedMark: "Rejected",
    commentBody: "Comment body to post",
    accepted: "Accepted",
    accept: "Accept",
    unreject: "Undo reject",
    reject: "Reject",
    editHint: "You can edit the body before posting",
    repository: "Repository",
    author: "Author",
    branch: "Branch",
    branchInto: " into ",
    changes: "Changes",
  },

  submit: {
    heading: "Post to GitHub",
    acceptedUnit: " accepted",
    tally: (line, summary) => ` (${line} line comments, ${summary} in the body)`,
    eventLegend: "Review type",
    suggested: "Suggested",
    summary: "Review body (optional)",
    summaryPlaceholder: "Overall impressions, or things to check before merging",
    languageLegend: "Posting language",
    translatingAndPosting: (language) => `Translating into ${language} and posting`,
    posting: "Posting",
    postAgain: "Post again",
    post: "Post to GitHub",
    hint: "Accept a finding or write a body to post. To just approve, set the type to “Approve”.",
    confirmHeading: "Post this review",
    kind: "Type",
    lineComments: "Line comments",
    summaryFindings: "Findings in the body",
    count: (n) => `${n}`,
    language: "Language",
    lgtmImage: "LGTM image",
    chosenLgtm: "Chosen LGTM image",
    willTranslate: (language) =>
      `The AI translates it into ${language} right before posting. This can take about a minute.`,
    alreadyPosted:
      "You have already posted on this commit. Keeping the same findings accepted will duplicate them on GitHub.",
    public: "Once posted, everyone on the PR can see it. To retract it, use GitHub.",
    back: "Go back and edit",
    confirm: "Post",
  },

  lgtm: {
    heading: "LGTM image",
    attach: "Add to the body",
    chosenAlt: (id) => `Chosen LGTM image #${id}`,
    drawing: "Drawing",
    noImage: "Approve without an image",
    seal: "OK",
    sheetNo: "Dwg No.",
    sheet: "Sheet",
    shuffle: "Shuffle",
    pick: "Choose an image",
    imageAlt: (id) => `LGTM image #${id}`,
  },

  posted: {
    heading: "Posted",
    summary: (relative, event, comments) =>
      `Posted as “${event}” ${relative}${comments === 0 ? "" : ` (${comments} ${comments === 1 ? "finding" : "findings"})`}`,
    view: "View on GitHub",
    stale: (sha) => `Posted on ${sha}. The PR has been updated since.`,
    waiting: (minutes, checked) =>
      `Waiting for the author to push a fix or reply. Checking every ${minutes} minutes and re-running the AI review if there is any${checked === null ? "." : ` (last checked ${checked}).`} `,
    waitingNote:
      "It keeps going when you go back to the list. It stops when you quit the app and resumes the next time you open it.",
    rereviewed: "The AI review was run again. Check the findings and post again if needed.",
    closed: "Stopped watching.",
    approved:
      "Automatic re-reviews were stopped in favor of the human decision. Start watching again if you still want to follow it.",
    off: (minutes) =>
      `Start watching to check every ${minutes} minutes for a fix or reply from the author, and re-run the AI review if there is one.`,
    start: "Start watching",
    stop: "Stop watching",
  },
  settings: {
    open: "Settings",
    title: "Settings",
    back: "Back to the list",
    loading: "Loading settings",
    save: "Save",
    saving: "Saving",
    saved: "Saved",
    saveFailed: (message) => `Could not save: ${message}`,
    discard: "Discard changes",
    unsaved: "You have unsaved changes",
    discardAndBack: "Discard and go back",
    resetDefaults: "Reset everything to defaults",
    confirmReset: "Reset all settings to their defaults? Nothing changes until you save.",
    storedAt: "Settings are stored in ~/.config/cc-auto-review/settings.json.",
    tabs: { profiles: "Review profiles", autopilot: "Autopilot", general: "General" },
    profiles: {
      intro:
        "A profile is a set of what to look at, what to ignore, and how to write findings. You can pick one per PR on the review screen. Even the default profile sticks to verified problems.",
      add: "Add a profile",
      newName: "New profile",
      duplicate: "Duplicate",
      copyName: (name) => `Copy of ${name}`,
      remove: "Delete",
      confirmRemove: (name) => `Delete the profile "${name}"?`,
      isDefault: "Default",
      makeDefault: "Make default",
      name: "Name",
      perspectives: "Review perspectives",
      perspectivesIntro:
        "Only the perspectives that are on are listed in the prompt; nothing else is reported. Write the descriptions in any language.",
      addPerspective: "Add a perspective",
      perspectiveTitle: "Title",
      perspectiveDescription: "What to look for. The more specific, the more precise the findings",
      removePerspective: "Remove the perspective",
      moveUp: "Move up",
      moveDown: "Move down",
      exclusions: "Do not report",
      exclusionsHint: "One item per line. Stops findings that would be noise",
      instructions: "Team review guidelines",
      instructionsHint:
        "Your team's conventions, priorities, and tone. The repository's CLAUDE.md / AGENTS.md / REVIEW.md are read separately",
      instructionsPlaceholder:
        "e.g. We return errors as Result values; flag code that throws.\ne.g. Be polite and include a suggestion block with the fix.",
      tools: "Extra allowed tools",
      toolsHint:
        "One per line: Skill, WebFetch, mcp__server, mcp__server__tool, ... Instructions hidden in a PR description can trigger them, so never allow tools that can write",
      maxFindings: "Maximum number of findings",
      maxFindingsHint: "0 means no limit. Over the limit, the most severe ones are kept",
      preview: "Preview the prompt",
      previewHeading: (name) => `Prompt for "${name}" (example PR)`,
      close: "Close",
    },
    general: {
      defaultModel: "Default model for manual AI reviews",
      timeout: "Time limit for one AI review (minutes)",
      lgtmImageIds: "LGTM image IDs",
      lgtmImageIdsHint:
        "One LGTMoon image ID per line (the number after image.lgtmoon.dev/). Lines that aren't numbers are dropped on save, and an empty list restores the defaults.",
    },
    autopilot: {
      intro:
        "Autopilot checks your review requests periodically, sorts changes by risk, and hands only the ones that need a human back to you.",
      model: "Model",
      profile: "Default profile",
      interval: "Sweep interval (minutes)",
      maxRounds: "Maximum comment rounds",
      maxRoundsHint: "If findings remain after this many comments, the PR goes to a human",
      approve: "Approve when there are no findings",
      approveHint:
        "When off, it only comments that nothing was found and leaves approval to a human",
      lgtmImage: "Attach an LGTM image to approvals",
      animations: "Console animations",
      animationsHint: "When off, the console's dial stops spinning and blinking and stays still",
      autoJudgeLabel: "Label to trust autopilot",
      autoJudgeLabelHint: "PRs with this label are not handed to a human because of risk",
      skipLabel: "Label to skip AI review",
      skipLabelHint: "Autopilot neither reviews nor posts on PRs with this label",
      routing: "Profile routing",
      routingIntro:
        "Review PRs with a different profile by repository, label, or a mention (e.g. @org/team) in the description or comments. A rule with a repository (owner/repo) only applies to that repository's PRs, and with no label or mention it applies to all of them. Rules are checked from the top.",
      routingRepo: "Repository",
      routingLabel: "Label",
      routingMention: "Mention",
      routingProfile: "Profile",
      addRule: "Add a rule",
      removeRule: "Delete",
      handoff: "When to hand a PR to a human",
      handoffIntro:
        'Your team\'s criteria, read by the AI when it judges risk. Changes that match go to a human. You can also relax them, e.g. "Documentation-only changes do not need a human". Write them in any language.',
      handoffRules: "Criteria",
      handoffHint:
        "One per line. Leave empty to rely on the AI's general judgment. The path and line-count rules below still apply separately, without calling the AI",
      sensitive: "Paths handed to a human without calling the AI",
      sensitiveIntro:
        "A path regular expression (JavaScript syntax; a leading (?i) makes it case-insensitive) and the reason shown to you.",
      pattern: "Regular expression",
      reason: "Reason",
      invalidPattern: "Not a valid regular expression",
      maxLines: "Changed lines handed to a human",
      maxLinesHint: "Over this many added + deleted lines, the PR goes to a human. 0 disables it",
      riskThreshold: "Risk score handed to a human",
      riskThresholdHint:
        "When the change's risk score (0–100) is above this, the PR goes to a human. A serious problem the AI cites always goes to a human, whatever the score",
      ignored: "Paths not counted as changed lines",
      ignoredHint: "One regular expression per line. Lock files and build output",
    },
  },
};

export const MESSAGES: Record<Lang, Messages> = { ja, en };
