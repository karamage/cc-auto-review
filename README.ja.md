# CC Auto Review

GitHub の Pull Request を、**ローカルにインストールした Claude Code**（`claude -p`）でレビューする macOS のデスクトップアプリです。
diff と AI の指摘を 1 画面で見て、指摘を採用・却下・編集し、GitHub にレビューを投稿します。完全自動運転をオンにすると、レビュー依頼を自動で処理し、リスクのある変更だけを人に回します。

[English README](README.md)

- **手元の Claude Code を使う。** API キーの設定は不要です。Claude Code のサブスクリプションや設定のまま動きます。
- **clone しない。** 変更ファイルだけを GitHub から一時ディレクトリに取り寄せます。それ以外のファイル（呼び出し元、型、テスト）は、PR のリポジトリとコミットに固定した GET 専用のコマンドで Claude が必要な分だけ読みます。
- **レビューのやり方を変えられる。** 「レビュープロファイル」で、見る観点、指摘しないこと、チームの指示、指摘の数の上限、追加で許すツール（Skill や MCP）を決められます。既定のプロファイルのままでも、確かめられた問題に絞って指摘します。
- **完全自動運転（任意）。** レビュー依頼を定期的に確かめ、承認かコメントをして作成者の対応を待ち、再レビューします。CI・マイグレーション・認証・秘密情報・巨大な変更などは人に回します。

## 必要なもの

- macOS 11 以降
- [GitHub CLI](https://cli.github.com)（`gh`）。`gh auth login` 済みであること
- [Claude Code](https://claude.com/claude-code)（`claude`）

`gh` と `claude` はログインシェルの `PATH` から探すので、Finder や Dock から起動しても動きます。

## インストール

ソースからビルドし（[開発](#開発)を参照）、できた `CC Auto Review.app` を `/Applications` に入れてください。`bun run app:build` はビルドしたマシンの CPU 向けのアプリを `src-tauri/target/release/bundle/macos/` に作ります。Apple Silicon の Mac から Intel 版を作るときは `bun run app:build:x64` を使います。`bun run app:build:universal` なら両方で動く 1 つのアプリになります。大きさは CPU ごとの版が約 12 MB、universal 版が約 23 MB です。

> 手元でビルドしたアプリは署名されていません。開けないときは「システム設定 → プライバシーとセキュリティ → このまま開く」で許可してください。`bun run release:mac` で作った DMG は署名・公証済みなので、そのまま開けます。

## 使い方

1. ダッシュボードに、レビューを依頼されている PR が出ます（github.com/pulls/review-requested と同じ条件）。URL を貼れば任意の PR も開けます。
2. PR を開き、**レビュープロファイル**と**モデル**を選び、必要なら重点的に見てほしいことを書いて **AI レビューを実行** を押します。
3. 指摘ごとに採用・却下・編集します。diff の外を指す指摘はレビュー本文にまとめます。
4. 「コメント / 承認 / 修正を求める」を選んで投稿します。指摘を書いた言語と違う言語で投稿するときは、投稿の直前に Claude が訳します。
5. 必要なら **見守りを始める** を押します。作成者が push か返信をしたら AI レビューをやり直します（再投稿は人が確かめてから）。

### 指摘の重大度

| 重大度 | 意味 |
| --- | --- |
| blocker | マージ前に必ず直す、確かめられた不具合 |
| should | 直すべきだが、後回しにしても安全なもの |
| question | 意図が分からず結論を出せないもの。何が分かれば判断できるかを書く |
| nit | 好みの範囲の改善案（既定では非表示） |

blocker と should には、起きる条件（trigger）と影響（impact）を必ず書かせ、書けなければ question に下げます。PR に過去のレビューコメントがあれば、指摘ごとに今のコードで直っているかを判定します（修正済み / 未修正 / 確認できず）。作成者の「直しました」や解決済みのスレッドは根拠にしません。

### 変更のリスクの点数

レビュー画面の左側に、PR の変更リスクを 0〜100 の点数で出します（採点モデルは [pr-risk-score](https://github.com/karamage/pr-risk-score) を移植したもの）。

- **基準点**: PR を開いた時点で、diff だけから機械的に決めます。変更の規模と広がり、影響の大きい領域（認証・決済・マイグレーション・CI など）、追加行の危ないパターン（秘密情報、eval、XSS、破壊的な SQL など）、テストの不足、変更の形、PR の経緯の 7 つの要因を足します。秘密情報の混入（90 点）、破壊的なマイグレーション（75 点）、AI を操ろうとする文（60 点）などには下限があります。
- **AI の補正**: AI レビューを実行すると、Claude が diff の意味を読み、`file:line` を引用した項目で ±20 点まで補正します。認可の迂回や取り返しのつかないデータ消失のような重大な仕組みを確かめた場合は「エスカレーション」として 60 点以上にし、人に回します。点の計算はサーバが行い、AI には上限・下限を動かさせません。

| 点数 | 段階 |
| --- | --- |
| 0–24 | LOW |
| 25–50 | MEDIUM |
| 51–75 | HIGH |
| 76–100 | CRITICAL |

完全自動運転は、点数が閾値（既定 50）を**超えた** PR とエスカレーションのある PR を、投稿せずに人へ回します。

## レビューのカスタマイズ

ダッシュボード右上の **設定** を開きます。

### レビュープロファイル

プロファイルは「どうレビューするか」の一式です。*Standard*、*Security focused*、*Quick (blockers only)* を同梱しています。書き換えても、新しく作っても構いません。

| 項目 | 内容 |
| --- | --- |
| レビューの観点 | レビュアーが見るのはこれだけです。オン・オフ、並べ替え、書き換え、追加（「アクセシビリティ」「自社の API バージョニング規約」など）ができます。どの言語で書いても構いません |
| チームのレビュー指示 | 自由記述。規約、重視すること、口調、「修正案は suggestion ブロックで」など |
| 指摘しないこと | 1 行に 1 つ。ノイズになる指摘を止めます |
| 指摘の数の上限 | 重いものから N 件だけ残させます |
| 追加で許すツール | `Skill`、`WebFetch`、`mcp__docs` など。既定では読み取りのツールしか許しません。**書き込みのできるツールは許さないでください**（PR の本文に紛れた指示で呼ばれうるため） |

**プロンプトを確認** で、Claude に渡るプロンプトをそのまま見られます。

リポジトリの `CLAUDE.md`・`AGENTS.md`・`REVIEW.md` も読ませます。どれも **base ブランチの内容**を使うので、PR が自分をレビューする規約を書き換えることはできません。`.claude/`・`.mcp.json`・`CLAUDE.local.md` は作業ディレクトリに置きません。

### 完全自動運転

| 設定 | 既定値 |
| --- | --- |
| モデル / プロファイル | Haiku / Standard |
| 巡回の間隔 | 10 分 |
| 人に回すまでのコメント回数 | 3 |
| 指摘が無ければ承認する | オン（オフにすると、指摘が無い旨をコメントするだけで承認は人に任せる） |
| 承認に LGTM 画像を添える | オフ |
| 自動判断に任せるラベル | `auto-judge` |
| AI レビューを見送るラベル | `skip-ai-review` |
| プロファイルの振り分け | リポジトリ、ラベル、メンション（`@org/security` など）に当たった PR を別のプロファイルでレビュー |
| 人に任せる基準 | AI がリスクを判定するときに読む、自然言語の基準（認証・課金、マイグレーション、CI・インフラ、API の互換性など）。追加・編集のほか、「ドキュメントだけの変更は人に回さなくてよい」のように緩めることもできる |
| AI を呼ばずに人へ回すパス | CI、DB マイグレーション、インフラ、秘密情報、認証・課金・暗号、レビュー規約（正規表現で編集可） |
| 人に回す変更行数 | 1000（ロックファイルと `dist/` は数えない） |
| 人に回すリスクの点数 | 50（これを超えたら人に回す） |

完全自動運転はアプリを開いている間だけ動きます。投稿は**あなたの** GitHub アカウントから行われ、本文に自動レビューであることを書きます。

### 保存先

設定とアプリの状態は `~/.config/cc-auto-review/` に保存します（環境変数 `CC_AUTO_REVIEW_HOME` で変えられます）。

## 仕組み

```
CC Auto Review.app
├── Tauri の殻（Rust）          サーバを起動し、ウィンドウで開く
├── cc-auto-review-server       txiki.js（約 6 MB の JS ランタイム）。server.js を動かす
└── Resources/server.js         Hono のサーバを 1 つの JS にまとめたもの
    ├── 127.0.0.1 で画面と API を配る（ポートは毎回空いているもの、起動ごとの合言葉付き）
    ├── gh  → PR 一覧、diff、コメント、レビューの投稿
    └── claude -p  → レビュー。変更ファイルだけを置いた一時ディレクトリで動く
            └── remote-read（cat / cat-base / ls / find / grep / issue）→ GitHub。GET のみ
```

- API は起動時に作った合言葉を持つリクエストしか受け付けないので、ほかのアプリやブラウザのページからは操作できません。
- 投稿の直前に PR の head を確かめ直し、レビュー後に更新されていれば投稿しません。
- AI レビューは 10 分でタイムアウトします（設定で変更可）。

## 開発

必要なもの: [Bun](https://bun.sh)、Rust（`rust-toolchain.toml` で `stable` を指定）、Xcode Command Line Tools

```bash
bun install
bun run check        # 型検査 + lint + format の確認 + テスト
bun run app:build    # 画面・サーバの実行ファイル・CC Auto Review.app をビルド
bun run app:dmg      # .dmg も作る（Finder の自動操作の許可が要ることがある）
bun run app:build:x64         # Intel Mac 向けの .app（Apple Silicon の Mac からも作れる）
bun run app:dmg:x64           # 同じものを .dmg で
bun run app:build:universal   # Apple Silicon と Intel の両方で動く 1 つの .app
bun run app:dmg:universal     # 同じものを .dmg で
```

ブラウザだけで開発する場合（Tauri なし）:

```bash
bun run dev:server   # API（localhost:4711）
bun run dev:client   # Vite（localhost:5173。/api は 4711 にプロキシ）
```

テストは実際の `gh` / `claude` / `git` を起動せず、`CommandRunner` の偽実装を使います。

### 署名・公証した DMG を作る

最初に一度だけ準備します（Apple Developer Program への加入が必要です）。

1. 「Developer ID Application」の証明書を作る: Xcode → Settings → Accounts → Manage Certificates → `+`
2. 公証の認証情報をキーチェーンに保存する（パスワードには [App 用パスワード](https://support.apple.com/ja-jp/102654)を使う）

   ```bash
   xcrun notarytool store-credentials cc-auto-review --apple-id <Apple ID> --team-id <Team ID>
   ```

あとは次のコマンドで作れます。

```bash
bun run release:mac             # → release/CC-Auto-Review_<version>_arm64.dmg と _x64.dmg
bun run release:mac arm64       # Apple Silicon 版だけ
bun run release:mac universal   # 両方で動く 1 つの DMG
```

既定では Apple Silicon 版と Intel 版を別々に作ります。CPU ごとにアプリをビルドし、Hardened Runtime 付きで署名します。続けてアプリを公証してチケットを貼り、DMG にまとめ、DMG も公証してチケットを貼ります。証明書を選ぶときは `APPLE_SIGNING_IDENTITY`、別のプロファイルを使うときは `NOTARY_PROFILE` を指定します。

## ライセンス

MIT
