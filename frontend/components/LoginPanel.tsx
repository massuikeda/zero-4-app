"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ROLE_LABEL } from "@/components/AppShell";
import { api } from "@/lib/api";
import { AUTH_MODE, LOGIN_PATH, type Portal, devLogin, entraLogin, getPortal, initAuth, logout } from "@/lib/auth";
import type { UserRow } from "@/lib/types";

const TEXT: Record<Portal, { title: string; lead: string; other: Portal; otherLabel: string }> = {
  bank: {
    title: "銀行担当者のログイン",
    lead: "すべての取引先企業の業務フローを確認・管理できます。",
    other: "company",
    otherLabel: "企業の方はこちら",
  },
  company: {
    title: "企業の方のログイン",
    lead: "自社の業務フロー（AS-IS／TO-BE）とヒアリング内容を確認・編集できます。",
    other: "bank",
    otherLabel: "銀行担当者の方はこちら",
  },
};

/** ログイン後、トップから読み直す（ログインした人の権限で画面を組み立て直すため） */
function goHome() {
  window.location.replace("/");
}

export function LoginPanel({ portal }: { portal: Portal }) {
  const t = TEXT[portal];
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Entra ID から戻ってきたとき（またはログイン済みで開いたとき）は、確認してトップへ
        if (getPortal() === portal && (await initAuth())) {
          await api.me();
          goHome();
          return;
        }
        if (AUTH_MODE === "dev") {
          const list = await api.devUsers(portal === "bank" ? "admin" : "member");
          if (cancelled) return;
          setUsers(list);
          setEmail((cur) => cur || list[0]?.email || "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portal]);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      if (AUTH_MODE === "entra") {
        await entraLogin(portal); // Microsoft のログイン画面へ移動する
        return;
      }
      devLogin(portal, email);
      await api.me(); // 入口と役割が合っているかをバックエンドで確認
      goHome();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className={`login-wrap ${portal}`}>
      <div className="login-card">
        <span className={`login-kind ${portal}`}>{portal === "bank" ? "銀行担当者用" : "企業用"}</span>
        <h1>{t.title}</h1>
        <p className="muted">{t.lead}</p>

        {error && (
          <div className="alert">
            {error}
            {getPortal() && AUTH_MODE === "entra" && (
              <div>
                <button className="btn ghost" onClick={() => logout()}>
                  別のアカウントでログインし直す
                </button>
              </div>
            )}
          </div>
        )}

        {AUTH_MODE === "entra" ? (
          <button className="btn primary login-btn" disabled={busy} onClick={login}>
            {busy ? "Microsoft のログイン画面へ移動しています…" : "Microsoft アカウントでログイン"}
          </button>
        ) : (
          <>
            <label className="login-field">
              <span className="small muted">ログインするユーザーを選んでください（仮のログイン）</span>
              <select value={email} onChange={(e) => setEmail(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.name}（{ROLE_LABEL[u.role] ?? u.role}・{u.email}）
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary login-btn" disabled={busy || !email} onClick={login}>
              ログイン
            </button>
          </>
        )}

        <p className="login-other small">
          <Link href={LOGIN_PATH[t.other]}>{t.otherLabel} →</Link>
        </p>
      </div>
    </div>
  );
}
