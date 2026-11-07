"use client";

// 企業アプリ・人材アプリ共通の枠（ヘッダー・ナビ）
// ログイン確認は lib/session.tsx が行い、確認できるまでは「読み込み中」を出す

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ErrorBox, Loading } from "@/components/ui";

type NavItem = { href: string; label: string };

export function AppShell({
  theme, appName, nav, userLabel, ready, error, onRetry, onLogout, children,
}: {
  theme: "company" | "talent";
  appName: string;
  nav: NavItem[];
  userLabel: string;
  ready: boolean; // ログインユーザーを読み込めたか
  error: string | null;
  onRetry: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const home = nav[0]?.href ?? "/";

  return (
    <div className={`theme-${theme} flex min-h-full flex-1 flex-col`}>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href={home} className="flex items-center gap-2 font-bold">
            <span className="inline-block h-6 w-6 rounded-md bg-accent" aria-hidden />
            <span>{appName}</span>
          </Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {/* usePathname は Suspense の内側で使う（cacheComponents の決まり） */}
            <Suspense fallback={<NavLinks nav={nav} pathname="" />}>
              <CurrentNavLinks nav={nav} />
            </Suspense>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {ready && <span className="hidden text-muted sm:inline">{userLabel}</span>}
            <button
              onClick={onLogout}
              className="rounded-md px-2 py-1 text-muted hover:bg-background hover:text-foreground"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {error ? <ErrorBox message={error} onRetry={onRetry} /> : ready ? children : <Loading />}
      </main>
    </div>
  );
}

function CurrentNavLinks({ nav }: { nav: NavItem[] }) {
  return <NavLinks nav={nav} pathname={usePathname()} />;
}

function NavLinks({ nav, pathname }: { nav: NavItem[]; pathname: string }) {
  const home = nav[0]?.href ?? "/";
  // ホームは完全一致、それ以外は配下も含めて強調（より長いパスが一致するものを優先）
  const match = nav
    .filter((n) => (n.href === home ? pathname === home : pathname.startsWith(n.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <>
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${
            n.href === match ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          {n.label}
        </Link>
      ))}
    </>
  );
}

/** ログイン・新規登録画面の枠 */
export function AuthShell({
  theme, appName, title, children, footer,
}: {
  theme: "company" | "talent";
  appName: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={`theme-${theme} flex min-h-full flex-1 items-center justify-center px-4 py-12`}>
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 font-bold">
          <span className="inline-block h-6 w-6 rounded-md bg-accent" aria-hidden />
          {appName}
        </Link>
        <div className="rounded-xl border border-line bg-surface p-6 sm:p-8">
          <h1 className="mb-6 text-xl font-bold">{title}</h1>
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}
