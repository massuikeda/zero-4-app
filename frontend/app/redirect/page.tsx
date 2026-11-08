"use client";

/**
 * Entra ID でログインした後の戻り先（MSAL Browser v5 のリダイレクトブリッジ）。
 * 受け取った結果をアプリ本体に渡し、元の画面へ戻す。ここでは他のMSALの処理を呼ばないこと。
 */
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { useEffect } from "react";

export default function Redirect() {
  useEffect(() => {
    broadcastResponseToMainFrame().catch((error) => {
      console.error("ログイン結果の受け渡しに失敗しました:", error);
    });
  }, []);

  return <p style={{ padding: 24 }}>ログイン処理中…</p>;
}
