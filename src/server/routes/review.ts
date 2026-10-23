import { join } from "node:path";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  ExistingComment,
  PriorFindingCheck,
  ReviewModel,
  ReviewResult,
  ReviewStreamEvent,
} from "../../shared/types.ts";
import { isReviewModel } from "../../shared/types.ts";
import {
  detectTextLang,
  matchRouting,
  mergeRisk,
  reviewedChangedLines,
  ruleRisk,
} from "../../shared/risk.ts";
import { findProfile } from "../../shared/settings.ts";
import type { AppDeps } from "../app.ts";
import { anchorFindings } from "../diff/anchor.ts";
import { diffDigest } from "../diff/digest.ts";
import { parseUnifiedDiff } from "../diff/parse.ts";
import { AppError } from "../errors.ts";
import { requestLang } from "../lang.ts";
import { buildReviewPrompt } from "../reviewer/prompt.ts";
import type { Snapshot } from "../snapshot/manager.ts";
import { invalidPR, PR_PATH, parsePRRef } from "./prs.ts";

/** クライアントが見ている diff の head SHA。これとサーバの現在値がずれていたら拒否する */
function parseHeadSha(value: unknown): string | null {
  const raw = (value as { headSha?: unknown } | null)?.headSha;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** 画面で入力された追加のレビュー指示。長すぎるプロンプトを避けるため上限を設ける */
const MAX_INSTRUCTIONS_LENGTH = 4000;

function parseInstructions(value: unknown): string {
  const raw = (value as { instructions?: unknown } | null)?.instructions;
  return typeof raw === "string" ? raw.trim().slice(0, MAX_INSTRUCTIONS_LENGTH) : "";
}

/**
 * 画面で選んだモデル。"default" なら設定の既定、null なら claude の設定に任せる、知らない値なら undefined。
 * 値は claude の引数になるので、決めた別名だけを通す
 */
function parseModel(value: unknown): ReviewModel | null | "default" | undefined {
  const raw = (value as { model?: unknown } | null)?.model;
  if (raw === undefined || raw === "default") return "default";
  if (raw === null) return null;
  return isReviewModel(raw) ? raw : undefined;
}

/** 画面で選んだプロファイル。無ければ null（設定の既定を使う） */
function parseProfileId(value: unknown): string | null {
  const raw = (value as { profileId?: unknown } | null)?.profileId;
  return typeof raw === "string" && raw !== "" ? raw : null;
}

/** 変更のリスクも判定させるか。完全自動運転のときだけ true が来る */
function parseAssessRisk(value: unknown): boolean {
  return (value as { assessRisk?: unknown } | null)?.assessRisk === true;
}

/**
 * 過去の指摘の判定に、元のコメントを結び付ける。AI が書いた commentId が実在しないものと、
 * 同じコメントへの 2 度目以降の判定は捨てる
 */
export function attachComments(
  checks: ReviewResult["priorChecks"],
  comments: ExistingComment[],
): PriorFindingCheck[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const seen = new Set<number>();
  return checks.flatMap((check) => {
    const comment = byId.get(check.commentId);
    if (comment === undefined || seen.has(check.commentId)) return [];
    seen.add(check.commentId);
    return [{ status: check.status, evidence: check.evidence, comment }];
  });
}

export function registerReviewRoutes(app: Hono, deps: AppDeps): void {
  // 最後に実行した AI レビューから読んだ値。まだ実行していなければ null
  app.get("/api/usage", (c) => c.json({ usage: deps.reviewer.usage.latest() }));

  app.post(`${PR_PATH}/review`, async (c) => {
    // 指摘もこの言語で書かせる。画面の言語と揃える
    const lang = requestLang(c);
    const en = lang === "en";
    const pr = parsePRRef(c.req.param());
    if (pr === null) {
      return c.json({ message: invalidPR(lang), detail: null }, 400);
    }

    const body = (await c.req.json().catch(() => null)) as unknown;
    const clientHeadSha = parseHeadSha(body);
    const instructions = parseInstructions(body);
    const requestedModel = parseModel(body);
    const requestedProfileId = parseProfileId(body);
    const assessRisk = parseAssessRisk(body);
    if (clientHeadSha === null) {
      return c.json(
        { message: en ? "headSha is missing" : "headSha が指定されていません", detail: null },
        400,
      );
    }
    if (requestedModel === undefined) {
      return c.json(
        { message: en ? "Unknown model" : "知らないモデルが指定されました", detail: null },
        400,
      );
    }
    const settings = await deps.settings.get();
    const auto = settings.autopilot;

    return streamSSE(c, async (stream) => {
      const send = async (event: ReviewStreamEvent): Promise<void> => {
        await stream.writeSSE({ data: JSON.stringify(event) });
      };

      // AI レビューの実行中は数分間 SSE に何も書き込まれない。Bun の idleTimeout（最大 255 秒）
      // より確実に短い間隔でコメント行を送り、接続がアイドル切断されるのを防ぐ
      const heartbeat = setInterval(() => {
        void stream.write(": heartbeat\n\n").catch(() => {});
      }, 15_000);

      let snapshot: Snapshot | null = null;
      try {
        const [
          { summary, headSha, baseSha, body: description, labels },
          patch,
          comments,
          reviewBodies,
        ] = await Promise.all([
          deps.github.fetchPRMeta(pr),
          deps.github.fetchDiff(pr),
          deps.github.fetchComments(pr),
          deps.github.fetchReviewBodies(pr),
        ]);

        // 画面に出ている diff と指摘の紐づけ先がずれると、UI 上は指摘が黙って消える。
        // ずれたことを明示して再読み込みさせる
        if (headSha !== clientHeadSha) {
          throw new AppError({
            ja: "この PR は表示後に更新されています。ページを再読み込みしてからレビューしてください。",
            en: "This PR has been updated since it was shown. Reload the page and review it again.",
          });
        }

        const files = parseUnifiedDiff(patch);
        // 次の回で、レビューし直す意味のある変更があったかを見るための要約
        const digest = diffDigest(files, auto.ignoredPaths);
        const descriptionLang = detectTextLang(description ?? "") ?? detectTextLang(summary.title);

        // AI にレビューさせないと決められた PR。完全自動運転の回では、AI を呼ばずに見送ったと返す。
        // 人が画面から走らせたときは、人の判断を優先してレビューする
        // 完全自動運転の回は、自動運転の設定のプロファイルを使う。ルーティングの規則に当たれば、そちらを使う
        const routed = assessRisk
          ? matchRouting(auto.routing, labels, [
              description ?? "",
              ...[...comments, ...reviewBodies].map((comment) => comment.body),
            ])
          : null;
        const profile = findProfile(
          settings,
          routed?.profileId ??
            (assessRisk ? auto.profileId : (requestedProfileId ?? settings.defaultProfileId)),
        );

        if (assessRisk && labels.includes(auto.skipLabel)) {
          await send({
            type: "findings",
            findings: [],
            priorChecks: [],
            risk: null,
            descriptionLang,
            autoJudge: false,
            skipped: true,
            profileId: profile.id,
          });
          return;
        }

        // 人が自動判断を許した PR。リスクは判定して見せるが、人には回さない
        const autoJudge = assessRisk && labels.includes(auto.autoJudgeLabel);

        // パスと規模だけで人に回すと決まる変更は、AI を呼ばずに返す。トークンを使わずに済む。
        // 自動判断を許した PR は人に回さないので、AI レビューまで進める
        const rules = assessRisk
          ? ruleRisk(
              files.flatMap((f) => (f.oldPath === null ? [f.path] : [f.path, f.oldPath])),
              reviewedChangedLines(files, auto.ignoredPaths),
              auto,
              lang,
            )
          : null;
        if (rules?.level === "high" && !autoJudge) {
          await send({
            type: "findings",
            findings: [],
            priorChecks: [],
            risk: rules,
            descriptionLang,
            autoJudge,
            profileId: profile.id,
            digest,
          });
          return;
        }

        snapshot = await deps.snapshots.create(pr, { headSha, baseSha }, files, patch);
        await send({ type: "snapshot_ready" });

        // 出力ファイルは作業ディレクトリの外に置く。Grep の対象に混ざらないように
        const outputPath = join(snapshot.root, "findings.json");
        const prompt = buildReviewPrompt({
          prNumber: pr.number,
          title: summary.title,
          baseRef: summary.baseRefName,
          description,
          files,
          outputPath,
          diffPath: snapshot.diffPath,
          remoteReadCommand: deps.remoteReadCommand,
          profile,
          instructions,
          // 総評にだけ書かれた指摘や判断もあるので、行コメントと合わせて時系列で渡す
          comments: [...comments, ...reviewBodies],
          author: summary.author,
          language: lang,
          assessRisk,
        });

        await send({
          type: "reviewing",
          message: en
            ? `Reviewing changes in ${files.length} file(s) with "${profile.name}"…`
            : `「${profile.name}」で ${files.length} ファイルの変更をレビューしています…`,
        });

        const result = await deps.reviewer.review(
          { workDir: snapshot.workDir, repo: pr.repo, headSha, baseSha },
          prompt,
          outputPath,
          {
            model: assessRisk
              ? auto.model
              : requestedModel === "default"
                ? settings.defaultModel
                : requestedModel,
            tools: profile.allowedTools,
            timeoutMs: settings.timeoutMinutes * 60_000,
          },
        );
        await send({
          type: "findings",
          findings: anchorFindings(result.findings, files, lang),
          priorChecks: attachComments(result.priorChecks, [...comments, ...reviewBodies]),
          // 判定を頼んだのに AI が書かなかったときは、安全側に倒して人に回す
          risk: assessRisk
            ? mergeRisk(
                rules,
                result.risk ?? {
                  level: "high",
                  reasons: [
                    en ? "The AI did not return a risk assessment" : "AI がリスクを判定しなかった",
                  ],
                },
              )
            : null,
          descriptionLang,
          autoJudge,
          profileId: profile.id,
          digest,
        });
      } catch (error) {
        await send({
          type: "error",
          message:
            error instanceof AppError
              ? error.localized(lang)
              : en
                ? "The AI review failed"
                : "AI レビューに失敗しました",
          raw: error instanceof AppError ? (error.detail ?? null) : String(error),
        });
      } finally {
        clearInterval(heartbeat);
        if (snapshot !== null) await deps.snapshots.destroy(snapshot.root);
      }
    });
  });
}
