import type { NextConfig } from "next";

// /api/* を Python バックエンドへ転送する処理は app/api/[...path]/route.ts にある
// （転送先 BACKEND_URL を、ビルドのときではなく動いているときに読むため）

const nextConfig: NextConfig = {
  // Azure App Service 用：動かすのに必要なファイルだけを .next/standalone にまとめる（node server.js で起動）
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // 画面はブラウザ側でデータを読み込む作りなので、「即時表示」の自動チェック（開発時の警告）は
  // 明示的に指定したページだけにする
  experimental: {
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
