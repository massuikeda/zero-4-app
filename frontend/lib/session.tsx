"use client";

// ログイン中のユーザー（企業・人材）を画面全体で使えるようにする
// トークンがない・期限切れ（401）ならログイン画面へ戻す

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, clearToken, getToken, type Role } from "./api";
import type { CompanyMe, TalentMe } from "./types";

type Session<T> = { me: T | null; error: string | null; refresh: () => void; logout: () => void };

function useSessionLoader<T>(role: Role, load: () => Promise<T>): Session<T> {
  const router = useRouter();
  const loginPath = `/${role}/login`;
  const [me, setMe] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!getToken(role)) {
      router.replace(loginPath);
      return;
    }
    let alive = true;
    load().then(
      (m) => alive && (setMe(m), setError(null)),
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) router.replace(loginPath);
        else setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      },
    );
    return () => {
      alive = false;
    };
    // load は役割ごとに固定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, loginPath, router, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const logout = useCallback(() => {
    clearToken(role);
    router.replace(loginPath);
  }, [role, loginPath, router]);

  return { me, error, refresh, logout };
}

const CompanyCtx = createContext<Session<CompanyMe> | null>(null);
const TalentCtx = createContext<Session<TalentMe> | null>(null);

export function CompanySessionProvider({ children }: { children: (s: Session<CompanyMe>) => ReactNode }) {
  const s = useSessionLoader("company", api.company.me);
  return <CompanyCtx.Provider value={s}>{children(s)}</CompanyCtx.Provider>;
}

export function TalentSessionProvider({ children }: { children: (s: Session<TalentMe>) => ReactNode }) {
  const s = useSessionLoader("talent", api.talent.me);
  return <TalentCtx.Provider value={s}>{children(s)}</TalentCtx.Provider>;
}

/** 企業アプリの画面で使う（AppShell が読み込み済みのときだけ子画面を描くので me は必ずある） */
export function useCompany() {
  const s = useContext(CompanyCtx);
  if (!s?.me) throw new Error("useCompany は /company のログイン後の画面で使ってください");
  return { ...s.me, refresh: s.refresh };
}

export function useTalent() {
  const s = useContext(TalentCtx);
  if (!s?.me) throw new Error("useTalent は /talent のログイン後の画面で使ってください");
  return { ...s.me, refresh: s.refresh };
}
