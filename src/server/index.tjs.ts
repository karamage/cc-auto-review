// 配布するアプリの入口。scripts/build-server.ts が 1 つの JS にまとめ、同梱の tjs で `tjs run` する。
// process をほかのモジュールより先に用意するため、最初に import する
import "./runtime/tjs-process.ts";
import { start } from "./main.ts";
import { tjsRuntime } from "./runtime/tjs.ts";

await start(tjsRuntime());
