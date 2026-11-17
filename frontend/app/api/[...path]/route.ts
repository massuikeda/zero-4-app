/**
 * /api/* を Python バックエンドへ転送する（ブラウザからは同じドメインに見える）。
 *
 * 転送先は環境変数 BACKEND_URL（動いているときに読む）。
 * - ローカル：未設定なら http://localhost:8000
 * - Azure：フロントエンドの App Service のアプリ設定に BACKEND_URL を入れる（入れ直したら再起動だけでよい。ビルドし直さなくてよい）。
 */
import type { NextRequest } from "next/server";

// AIでAS-ISを作るときは1分以上かかることがあるので、3分まで待つ
const TIMEOUT_MS = 180_000;
// 転送のときに付け替える（そのまま渡すと壊れる）ヘッダー
const DROP_REQUEST = [
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  // 1区間だけで使うヘッダー（そのまま次へ渡すと、送る側が断ることがある）
  "keep-alive",
  "upgrade",
  "expect",
  "te",
  "trailer",
  "transfer-encoding",
  "proxy-authorization",
  "proxy-connection",
];
const DROP_RESPONSE = [
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
];

/** つながらなかった理由を、直すところが分かる言葉にする（宛先のURLそのものは画面に出さない） */
function explain(e: unknown): { status: number; detail: string } {
  const err = e instanceof Error ? e : new Error(String(e));
  const cause = (err.cause ?? {}) as { code?: string; message?: string };
  const code = cause.code ?? (err as { code?: string }).code ?? err.name;
  // 未設定のときは http://localhost:8000 へつなぐ（ローカルの開発用）
  const set = process.env.BACKEND_URL
    ? ""
    : "（ローカルではバックエンドを起動してください。Azure ではアプリ設定 BACKEND_URL を入れてください）";
  if (err.name === "TimeoutError") {
    return {
      status: 504,
      detail:
        "サーバーの応答が時間内にありませんでした。もう一度お試しください",
    };
  }
  let why = "バックエンドが動いているか確認して、もう一度お試しください";
  if (
    code === "ERR_INVALID_URL" ||
    /parse URL|Invalid URL/i.test(err.message)
  ) {
    why =
      "BACKEND_URL の形が正しくありません（https:// から始まるURLにしてください）";
  } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    why =
      "BACKEND_URL のサーバー名が見つかりません（バックエンドの「既定のドメイン」と同じか確認してください）";
  } else if (code === "ECONNREFUSED") {
    why = `バックエンドに接続を断られました${set || "（BACKEND_URL の宛先が違うか、バックエンドが止まっています）"}`;
  }
  return {
    status: 502,
    detail: `サーバーに接続できませんでした。${why}［${code}］`,
  };
}

async function forward(req: NextRequest): Promise<Response> {
  const raw = (process.env.BACKEND_URL || "http://localhost:8000")
    .trim()
    .replace(/^["']|["']$/g, "");
  const base = raw.replace(/\/+$/, "");
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const res = await fetch(
      `${base}${req.nextUrl.pathname}${req.nextUrl.search}`,
      {
        method: req.method,
        headers,
        body: hasBody ? await req.arrayBuffer() : undefined,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const out = new Headers(res.headers);
    for (const h of DROP_RESPONSE) out.delete(h);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    // 理由はサーバーのログ（App Service の「ログ ストリーム」）にも残す
    console.error("[api proxy] バックエンドへの転送に失敗:", e);
    const { status, detail } = explain(e);
    return Response.json({ detail }, { status });
  }
}

export {
  forward as GET,
  forward as POST,
  forward as PUT,
  forward as PATCH,
  forward as DELETE,
};
