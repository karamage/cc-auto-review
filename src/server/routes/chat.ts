import { join } from "node:path";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { findProfile } from "../../shared/settings.ts";
import {
  type ChatFinding,
  type ChatReference,
  type ChatStreamEvent,
  type ChatTurn,
  SEVERITIES,
  type Severity,
} from "../../shared/types.ts";
import type { AppDeps } from "../app.ts";
import { anchorFindings } from "../diff/anchor.ts";
import { parseUnifiedDiff } from "../diff/parse.ts";
import { AppError } from "../errors.ts";
import { requestLang } from "../lang.ts";
import { buildChatPrompt } from "../reviewer/chat.ts";
import type { Snapshot } from "../snapshot/manager.ts";
import { invalidPR, PR_PATH, parsePRRef } from "./prs.ts";
import { parseHeadSha, parseModel, parseProfileId } from "./review.ts";

const MAX_QUESTION_LENGTH = 4000;
/** プロンプトの肥大を防ぐ。履歴の合計の上限はプロンプト側で決める */
const MAX_TURNS = 100;
const MAX_TURN_LENGTH = 16000;
const MAX_FINDINGS = 200;
const MAX_FINDING_BODY_LENGTH = 2000;
const MAX_FINDING_TITLE_LENGTH = 200;

function parseReference(raw: unknown): ChatReference | null {
  const item = raw as Partial<
    Record<"kind" | "findingId" | "path" | "line" | "side", unknown>
  > | null;
  if (item === null || typeof item !== "object") return null;
  if (item.kind === "finding" && typeof item.findingId === "string") {
    return { kind: "finding", findingId: item.findingId };
  }
  if (
    item.kind === "line" &&
    typeof item.path === "string" &&
    item.path !== "" &&
    typeof item.line === "number" &&
    Number.isInteger(item.line) &&
    item.line > 0 &&
    (item.side === "LEFT" || item.side === "RIGHT")
  ) {
    return { kind: "line", path: item.path, line: item.line, side: item.side };
  }
  return null;
}

function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_TURNS).flatMap((value) => {
    const item = value as { role?: unknown; text?: unknown } | null;
    return (item?.role === "user" || item?.role === "assistant") && typeof item.text === "string"
      ? [{ role: item.role, text: item.text.slice(0, MAX_TURN_LENGTH) }]
      : [];
  });
}

function parseChatFindings(raw: unknown): ChatFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_FINDINGS).flatMap((value) => {
    const item = value as Partial<Record<keyof ChatFinding, unknown>> | null;
    if (
      typeof item?.id !== "string" ||
      typeof item.number !== "number" ||
      typeof item.path !== "string" ||
      typeof item.title !== "string" ||
      typeof item.body !== "string" ||
      !SEVERITIES.includes(item.severity as Severity) ||
      (item.status !== "pending" && item.status !== "accepted" && item.status !== "rejected")
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        number: item.number,
        path: item.path,
        line: typeof item.line === "number" ? item.line : null,
        severity: item.severity as Severity,
        title: item.title.slice(0, MAX_FINDING_TITLE_LENGTH),
        body: item.body.slice(0, MAX_FINDING_BODY_LENGTH),
        status: item.status,
      },
    ];
  });
}

export function registerChatRoutes(app: Hono, deps: AppDeps): void {
  app.post(`${PR_PATH}/chat`, async (c) => {
    const lang = requestLang(c);
    const en = lang === "en";
    const pr = parsePRRef(c.req.param());
    if (pr === null) return c.json({ message: invalidPR(lang), detail: null }, 400);

    const body = (await c.req.json().catch(() => null)) as {
      question?: unknown;
      reference?: unknown;
      history?: unknown;
      findings?: unknown;
    } | null;
    const clientHeadSha = parseHeadSha(body);
    const question =
      typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_LENGTH) : "";
    const requestedModel = parseModel(body);
    if (clientHeadSha === null || question === "" || requestedModel === undefined) {
      return c.json(
        {
          message: en ? "The chat request is invalid" : "チャットのリクエストが不正です",
          detail: null,
        },
        400,
      );
    }
    const settings = await deps.settings.get();
    const profile = findProfile(settings, parseProfileId(body) ?? settings.defaultProfileId);

    return streamSSE(c, async (stream) => {
      const send = async (event: ChatStreamEvent): Promise<void> => {
        await stream.writeSSE({ data: JSON.stringify(event) });
      };
      // AI の回答を待つ間に接続がアイドル切断されないよう、コメント行を送り続ける
      const heartbeat = setInterval(() => {
        void stream.write(": heartbeat\n\n").catch(() => {});
      }, 15_000);

      let snapshot: Snapshot | null = null;
      try {
        const [{ summary, headSha, baseSha, body: description }, patch] = await Promise.all([
          deps.github.fetchPRMeta(pr),
          deps.github.fetchDiff(pr),
        ]);
        if (headSha !== clientHeadSha) {
          throw new AppError({
            ja: "この PR は表示後に更新されています。ページを再読み込みしてから質問してください。",
            en: "This PR has been updated since it was shown. Reload the page and ask again.",
          });
        }

        const files = parseUnifiedDiff(patch);
        snapshot = await deps.snapshots.create(pr, { headSha, baseSha }, files, patch);
        await send({ type: "snapshot_ready" });

        // 出力ファイルは作業ディレクトリの外に置く。Grep の対象に混ざらないように
        const outputPath = join(snapshot.root, "chat.json");
        const prompt = buildChatPrompt({
          prNumber: pr.number,
          title: summary.title,
          baseRef: summary.baseRefName,
          description,
          files,
          outputPath,
          diffPath: snapshot.diffPath,
          remoteReadCommand: deps.remoteReadCommand,
          profile,
          language: lang,
          findings: parseChatFindings(body?.findings),
          reference: parseReference(body?.reference),
          history: parseHistory(body?.history),
          question,
        });
        await send({ type: "answering" });

        const result = await deps.reviewer.ask(
          { workDir: snapshot.workDir, root: snapshot.root, repo: pr.repo, headSha, baseSha },
          prompt,
          outputPath,
          {
            model: requestedModel === "default" ? settings.defaultModel : requestedModel,
            tools: profile.allowedTools,
            timeoutMs: settings.timeoutMinutes * 60_000,
          },
        );
        await send({
          type: "answer",
          answer: result.answer,
          proposals: anchorFindings(result.findings, files, lang),
        });
      } catch (error) {
        await send({
          type: "error",
          message:
            error instanceof AppError
              ? error.localized(lang)
              : en
                ? "The AI could not answer"
                : "AI が回答できませんでした",
          raw: error instanceof AppError ? (error.detail ?? null) : String(error),
        });
      } finally {
        clearInterval(heartbeat);
        if (snapshot !== null) await deps.snapshots.destroy(snapshot.root);
      }
    });
  });
}
