import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { installRemoteRead, loginShellPath, mergePath, shellQuote } from "./env.ts";
import { FakeCommandRunner } from "./exec.ts";

test("PATH は前にあるものを優先し、重複と空を除いてつなぐ", () => {
  expect(mergePath("/a:/b", "/b:/c", "", "/a:/d")).toBe("/a:/b:/c:/d");
});

test("ログインシェルの PATH を先頭に、いまの PATH とよく使われる場所を後ろに足す", async () => {
  const runner = new FakeCommandRunner({
    "/bin/zsh -ilc printf '__CC_AUTO_REVIEW_PATH__%s__CC_AUTO_REVIEW_PATH__' \"$PATH\"": {
      stdout: "motd\n__CC_AUTO_REVIEW_PATH__/opt/homebrew/bin:/login/bin__CC_AUTO_REVIEW_PATH__",
    },
  });
  const path = await loginShellPath(runner, { SHELL: "/bin/zsh", PATH: "/usr/bin" });
  expect(path.startsWith("/opt/homebrew/bin:/login/bin:/usr/bin")).toBe(true);
  expect(path).toContain("/usr/local/bin");
});

test("ログインシェルに聞けなくても、よく使われる場所を足す", async () => {
  const runner = new FakeCommandRunner({
    "/bin/sh -ilc printf '__CC_AUTO_REVIEW_PATH__%s__CC_AUTO_REVIEW_PATH__' \"$PATH\"": {
      exitCode: 1,
    },
  });
  const path = await loginShellPath(runner, { SHELL: "/bin/sh", PATH: "/usr/bin" });
  expect(path.split(":")[0]).toBe("/usr/bin");
  expect(path).toContain("/opt/homebrew/bin");
});

test("シェルの 1 語として、空白や引用符を含むパスも崩さない", () => {
  expect(shellQuote("/Applications/CC Auto Review.app/x")).toBe(
    "'/Applications/CC Auto Review.app/x'",
  );
  expect(shellQuote("it's")).toBe("'it'\\''s'");
});

test("remote-read を、自分自身を呼び直す実行可能なスクリプトとして置く", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ccar-env-"));
  try {
    const path = await installRemoteRead(dir, ["/Applications/CC Auto Review.app/bin", "--x"]);
    expect(await readFile(path, "utf8")).toBe(
      "#!/bin/sh\nexec '/Applications/CC Auto Review.app/bin' '--x' remote-read \"$@\"\n",
    );
    expect((await stat(path)).mode & 0o111).not.toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SHELL が無いときの既定は、macOS で zsh、それ以外で sh", async () => {
  const printf = "-ilc printf '__CC_AUTO_REVIEW_PATH__%s__CC_AUTO_REVIEW_PATH__' \"$PATH\"";
  const linux = new FakeCommandRunner({ [`/bin/sh ${printf}`]: {} });
  await loginShellPath(linux, { PATH: "/usr/bin" }, "linux");
  expect(linux.calls[0]?.[0]).toBe("/bin/sh");
  const mac = new FakeCommandRunner({ [`/bin/zsh ${printf}`]: {} });
  await loginShellPath(mac, { PATH: "/usr/bin" }, "darwin");
  expect(mac.calls[0]?.[0]).toBe("/bin/zsh");
});
