import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    // 開発時のみのプロキシ。API サーバが 4711 以外で起動した場合は
    // CC_AUTO_REVIEW_PORT を指定する（本番ビルドは同一オリジンなので影響しない）
    proxy: { "/api": `http://localhost:${process.env.CC_AUTO_REVIEW_PORT ?? 4711}` },
  },
});
