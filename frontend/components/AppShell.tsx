"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, createContext, useContext, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/api";
import { AUTH_MODE, LOGIN_PATH, REDIRECT_PATH, getPortal, initAuth, isPublicPath, logout } from "@/lib/auth";
import type { Me } from "@/lib/types";

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

/** 役割の表示名 */
export const ROLE_LABEL: Record<string, string> = { admin: "銀行担当者", member: "企業担当者" };

type State =
  | { kind: "loading" }
  | { kind: "ready"; me: Me }
  | { kind: "error"; message: string };

/**
 * 画面の枠（上のバー）とログイン確認。
 * いまの URL（usePathname）を使うので、Next.js の決まりにより Suspense の中に置く。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <header className="topbar">
          <Logo />
        </header>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (isPublic) return;
    let cancelled = false;
    (async () => {
      if (!(await initAuth())) {
        // ログインしていなければ、前に使ったログイン画面へ（初めてなら企業の方のログインへ）
        router.replace(LOGIN_PATH[getPortal() ?? "company"]);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setState({ kind: "ready", me });
      } catch (e) {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPublic, router]);

  // Entra ID からの戻り先ページ（/redirect）は、画面の枠を通さずにそのまま表示する
  if (pathname === REDIRECT_PATH) return <>{children}</>;

  const me = !isPublic && state.kind === "ready" ? state.me : null;

  return (
    <MeContext.Provider value={me}>
      <header className="topbar">
        <Link href={isPublic ? pathname : "/"} className="brand" aria-label="ミエルMAP トップへ">
          <Logo />
        </Link>
        <div className="topbar-right">
          {AUTH_MODE === "dev" && (
            <span className="dev-badge" title="仮のログインです（ユーザーを選ぶだけで、パスワードはありません）。あとで Entra ID のログインに置き換えます">
              仮ログイン
            </span>
          )}
          {me && (
            <>
              <span className="who">
                {me.name}
                <em>{ROLE_LABEL[me.role] ?? me.role}</em>
              </span>
              <button className="btn ghost" onClick={() => logout()}>
                ログアウト
              </button>
            </>
          )}
        </div>
      </header>
      <main className="page">
        {isPublic ? (
          children
        ) : state.kind === "loading" ? (
          <p className="muted">読み込み中…</p>
        ) : state.kind === "error" ? (
          <div className="stack">
            <div className="alert">{state.message}</div>
            <div>
              <button className="btn ghost" onClick={() => logout()}>
                ログイン画面に戻る
              </button>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </MeContext.Provider>
  );
}
