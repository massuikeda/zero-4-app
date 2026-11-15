"use client";

/**
 * 認証。ログイン画面は2つある。
 * - 銀行担当者のログイン（/bank/login）… すべての企業を見られる人（role=admin）
 * - 企業の方のログイン（/login）       … 自社だけを見られる人（role=member）
 * どちらから入ったか（portal）を覚えておき、API に X-Login-Portal で送る。役割と合わない入口からのログインは
 * バックエンドが断る。
 *
 * どの方法でログインするかは、バックエンドのアプリ設定 AUTH_MODE で決まる（画面は /api/config で読む。
 * 画面のビルドし直しはいらない）。
 * - dev      : ログイン画面で選んだユーザーのメールを X-User-Email で送る（仮のログイン）
 * - password : メールアドレスとパスワードでログインする。ログイン状態はバックエンドが HttpOnly Cookie に入れる
 *              （このファイルからは読めない。ログインしているかは /api/me の返事で分かる）
 * - entra    : Entra ID でログインし、アクセストークンを送る
 *   （企業の方は Entra ID B2B のゲストとして、自社の Microsoft アカウントでログインする）
 *
 * MSAL Browser v5 では、Entra ID からの戻り先は専用ページ（/redirect、app/redirect/page.tsx）になる。
 * Entra ID のアプリ登録のリダイレクトURIも https://<ドメイン>/redirect に合わせること。
 */
import type { PublicClientApplication } from "@azure/msal-browser";

export type AuthMode = "dev" | "password" | "entra";
let modeCache: Promise<AuthMode> | null = null;

/** ログインの方法（バックエンドの AUTH_MODE）。1回だけ聞いて覚えておく */
export function getAuthMode(): Promise<AuthMode> {
  modeCache ??= fetch("/api/config", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { auth_mode?: string }) => {
      const m = j.auth_mode;
      return m === "password" || m === "entra" ? m : "dev";
    })
    .catch((e) => {
      modeCache = null; // つながらなかったときは、次にもう一度聞く
      throw e;
    });
  return modeCache;
}
const SCOPE = process.env.NEXT_PUBLIC_ENTRA_API_SCOPE ?? "";
const DEV_KEY = "devUserEmail";
const PORTAL_KEY = "loginPortal";
/** Entra ID からの戻り先（リダイレクトブリッジ） */
export const REDIRECT_PATH = "/redirect";

export type Portal = "bank" | "company";

/** パスワードの最短の長さ（バックエンドの auth.PASSWORD_MIN と同じ） */
export const PASSWORD_MIN = 8;

export const LOGIN_PATH: Record<Portal, string> = { bank: "/bank/login", company: "/login" };
export const PORTAL_LABEL: Record<Portal, string> = { bank: "銀行担当者", company: "企業の方" };

/** ログインしていなくても開ける画面 */
export function isPublicPath(path: string): boolean {
  return path === REDIRECT_PATH || Object.values(LOGIN_PATH).includes(path);
}

let msal: PublicClientApplication | null = null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

/** どちらのログイン画面から入ったか */
export function getPortal(): Portal | null {
  const p = read(PORTAL_KEY);
  return p === "bank" || p === "company" ? p : null;
}

/** 開発モード：選んだユーザーでログインする */
export function devLogin(portal: Portal, email: string) {
  write(PORTAL_KEY, portal);
  write(DEV_KEY, email);
}

/** パスワードでログインする（成功するとバックエンドが Cookie を入れる） */
export async function passwordLogin(portal: Portal, email: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password, portal }),
  });
  if (!res.ok) {
    let msg = `ログインできませんでした (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  write(PORTAL_KEY, portal);
}

/** 本番モード：Entra ID のログイン画面へ移動する */
export async function entraLogin(portal: Portal) {
  write(PORTAL_KEY, portal);
  const m = await getMsal();
  await m.loginRedirect({ scopes: [SCOPE], prompt: "select_account" });
}

async function getMsal(): Promise<PublicClientApplication> {
  if (msal) return msal;
  const { PublicClientApplication } = await import("@azure/msal-browser");
  const m = new PublicClientApplication({
    auth: {
      clientId: process.env.NEXT_PUBLIC_ENTRA_SPA_CLIENT_ID ?? "",
      authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_ENTRA_TENANT_ID}`,
      redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await m.initialize();
  const res = await m.handleRedirectPromise();
  if (res?.account) m.setActiveAccount(res.account);
  const account = m.getActiveAccount() ?? m.getAllAccounts()[0];
  if (account) m.setActiveAccount(account);
  msal = m;
  return m;
}

/** ログイン済みか（どちらかの入口から入っていて、本番なら Entra ID のアカウントがある） */
export async function initAuth(): Promise<boolean> {
  if (!getPortal()) return false;
  const mode = await getAuthMode();
  // password：Cookie は読めないので、入口を覚えていれば「ログイン済みかもしれない」として /api/me で確かめる
  if (mode === "password") return true;
  if (mode === "dev") return !!read(DEV_KEY);
  const m = await getMsal();
  return !!m.getActiveAccount();
}

export async function authHeaders(): Promise<Record<string, string>> {
  const portal = getPortal();
  const base: Record<string, string> = portal ? { "X-Login-Portal": portal } : {};
  const mode = await getAuthMode();
  if (mode === "password") return base; // Cookie はブラウザが自動で送る
  if (mode === "dev") {
    const email = read(DEV_KEY);
    return email ? { ...base, "X-User-Email": email } : base;
  }
  if (!msal) return base;
  const account = msal.getActiveAccount();
  if (!account) return base;
  try {
    const r = await msal.acquireTokenSilent({ scopes: [SCOPE], account });
    return { ...base, Authorization: `Bearer ${r.accessToken}` };
  } catch {
    await msal.acquireTokenRedirect({ scopes: [SCOPE] });
    return base;
  }
}

/** ログアウトして、入ってきたログイン画面へ戻る */
/** ログインの期限切れなど（401）のとき：入口の記録を消して、ログイン画面へ戻す */
export function clearLogin() {
  write(DEV_KEY, null);
  write(PORTAL_KEY, null);
}

export async function logout() {
  const portal = getPortal() ?? "company";
  write(DEV_KEY, null);
  write(PORTAL_KEY, null);
  const back = `${window.location.origin}${LOGIN_PATH[portal]}`;
  const mode = await getAuthMode().catch(() => "dev" as AuthMode);
  if (mode === "password") {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }
  if (mode === "entra") {
    const m = await getMsal();
    await m.logoutRedirect({ postLogoutRedirectUri: back });
    return;
  }
  window.location.replace(back);
}
