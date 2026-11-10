import { expect, test } from "bun:test";
import { rememberDraft } from "./FindingCard.tsx";

test("却下した指摘の path とタイトルから学びの下書きを作る", () => {
  expect(rememberDraft("src/a.ts", "null を返す")).toBe(
    "src/a.ts: 「null を返す」のような指摘は、この repo では不要。理由: ",
  );
});
