import type { NextConfig } from "next";

// /api/* を Python バックエンドへ転送する（ブラウザからは同じドメインに見える）
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  /* config options here */
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
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
