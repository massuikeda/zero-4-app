"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/api";
import { AUTH_MODE, REDIRECT_PATH, getDevUser, initAuth, logout, setDevUser } from "@/lib/auth";
import type { Me, UserRow } from "@/lib/types";

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  // Entra ID からの戻り先ページ（/redirect）は、ログイン処理や画面の枠を通さずにそのまま表示する
  const [bridge, setBridge] = useState(false);
  const [devUsers, setDevUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      setMe(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (window.location.pathname === REDIRECT_PATH) {
      setBridge(true);
      return;
    }
    (async () => {
      if (!(await initAuth())) return; // ログイン画面へ移動中
      if (AUTH_MODE === "dev") {
        try {
          const users = await api.devUsers();
          setDevUsers(users);
          if (!getDevUser() && users[0]) setDevUser(users[0].email);
        } catch (e) {
          setError(`バックエンドに接続できません（${e instanceof Error ? e.message : e}）`);
          setReady(true);
          return;
        }
      }
      await loadMe();
    })();
  }, [loadMe]);

  const switchUser = (email: string) => {
    setDevUser(email);
    window.location.href = "/"; // 権限が変わるのでトップから読み直す
  };

  if (bridge) return <>{children}</>;

  return (
    <MeContext.Provider value={me}>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="ミエルMAP トップへ">
          <Logo />
        </Link>
        <div className="topbar-right">
          {AUTH_MODE === "dev" && devUsers.length > 0 && (
            <label className="dev-switch" title="開発用：ユーザーを切り替えて権限を確認できます">
              <span>開発用ユーザー</span>
              <select value={me?.email ?? ""} onChange={(e) => switchUser(e.target.value)}>
                {devUsers.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.role === "admin" ? "【管理者】" : "【担当者】"}
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {me && (
            <span className="who">
              {me.name}
              <em>{me.role === "admin" ? "管理者" : "担当者"}</em>
            </span>
          )}
          {AUTH_MODE === "entra" && (
            <button className="btn ghost light" onClick={logout}>
              ログアウト
            </button>
          )}
        </div>
      </header>
      <main className="page">
        {!ready ? (
          <p className="muted">読み込み中…</p>
        ) : error && !me ? (
          <div className="alert">{error}</div>
        ) : (
          children
        )}
      </main>
    </MeContext.Provider>
  );
}
