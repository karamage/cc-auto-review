import { expect, test } from "bun:test";
import { platformFromNavigator } from "./tjs-platform.ts";

test("txiki.js の navigator.platform を Node の process.platform の値に直す", () => {
  expect(platformFromNavigator("MacIntel")).toBe("darwin");
  expect(platformFromNavigator("Linux x86_64")).toBe("linux");
  expect(platformFromNavigator("Linux aarch64")).toBe("linux");
  expect(platformFromNavigator("Win32")).toBe("win32");
});
