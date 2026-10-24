#!/usr/bin/env bun
// 開発時の入口。配布するアプリでは txiki.js 向けの index.tjs.ts から起動する
import { start } from "./main.ts";
import { bunRuntime } from "./runtime/bun.ts";

await start(bunRuntime());
