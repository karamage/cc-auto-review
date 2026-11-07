/**
 * txiki.js には process.platform が無いので、navigator.platform から求める。
 * 値は MacIntel（Apple Silicon でも同じ）、Linux x86_64、Win32 のような形
 */
export function platformFromNavigator(navigatorPlatform: string): NodeJS.Platform {
  if (navigatorPlatform.startsWith("Mac")) return "darwin";
  if (navigatorPlatform.startsWith("Win")) return "win32";
  return "linux";
}
