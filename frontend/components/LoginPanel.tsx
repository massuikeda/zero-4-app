"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ROLE_LABEL } from "@/components/AppShell";
import { ApiError, api } from "@/lib/api";
import {
  type AuthMode, LOGIN_PATH, type Portal, clearLogin, devLogin, entraLogin, getAuthMode, getPortal, initAuth, logout,
  passwordLogin,
} from "@/lib/auth";
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
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await getAuthMode();
        if (cancelled) return;
        setMode(m);
        // Entra ID から戻ってきたとき（またはログイン済みで開いたとき）は、確認してトップへ
        if (getPortal() === portal && (await initAuth())) {
          try {
            await api.me();
            goHome();
            return;
          } catch (e) {
            // ログインの期限切れなど。ログイン画面のまま入力してもらう
            if (!(m === "password" && e instanceof ApiError && e.status === 401)) throw e;
            clearLogin();
          }
        }
        if (m === "dev") {
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
      if (mode === "entra") {
        await entraLogin(portal); // Microsoft のログイン画面へ移動する
        return;
      }
      if (mode === "password") {
        await passwordLogin(portal, email, password); // 入口と役割の確認もここでされる
        goHome();
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
            {getPortal() && mode === "entra" && (
              <div>
                <button className="btn ghost" onClick={() => logout()}>
                  別のアカウントでログインし直す
                </button>
              </div>
            )}
          </div>
        )}

        {mode === null ? (
          !error && <p className="muted">読み込み中…</p>
        ) : mode === "password" ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim() && password) login();
            }}
          >
            <label className="login-field">
              <span className="small muted">メールアドレス</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <label className="login-field">
              <span className="small muted">パスワード</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary login-btn" disabled={busy || !email.trim() || !password}>
              {busy ? "確認しています…" : "ログイン"}
            </button>
            <p className="small muted">
              パスワードを忘れたときや、ロックされたときは、
              {portal === "company" ? "銀行の担当者" : "管理者"}に再設定を依頼してください。
            </p>
          </form>
        ) : mode === "entra" ? (
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
