/**
 * /api/* を Python バックエンドへ転送する（ブラウザからは同じドメインに見える）。
 *
 * 転送先は環境変数 BACKEND_URL（動いているときに読む）。
 * - ローカル：未設定なら http://localhost:8000
 * - Azure：フロントエンドの App Service のアプリ設定に BACKEND_URL を入れる（入れ直したら再起動だけでよい。ビルドし直さなくてよい）
 */
import type { NextRequest } from "next/server";

// AIでAS-ISを作るときは1分以上かかることがあるので、3分まで待つ
const TIMEOUT_MS = 180_000;
// 転送のときに付け替える（そのまま渡すと壊れる）ヘッダー
const DROP_REQUEST = ["host", "connection", "content-length", "accept-encoding"];
const DROP_RESPONSE = ["connection", "content-encoding", "content-length", "transfer-encoding"];

async function forward(req: NextRequest): Promise<Response> {
  const base = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const res = await fetch(`${base}${req.nextUrl.pathname}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const out = new Headers(res.headers);
    for (const h of DROP_RESPONSE) out.delete(h);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return Response.json(
      {
        detail: timedOut
          ? "サーバーの応答が時間内にありませんでした。もう一度お試しください"
          : "サーバーに接続できませんでした。バックエンドが動いているか確認して、もう一度お試しください",
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
