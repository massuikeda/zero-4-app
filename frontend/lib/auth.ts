"use client";

/**
 * 認証。ログイン画面は2つある。
 * - 銀行担当者のログイン（/bank/login）… すべての企業を見られる人（role=admin）
 * - 企業の方のログイン（/login）       … 自社だけを見られる人（role=member）
 * どちらから入ったか（portal）を覚えておき、API に X-Login-Portal で送る。役割と合わない入口からのログインは
 * バックエンドが断る。
 *
 * - 開発（NEXT_PUBLIC_AUTH_MODE=dev）: ログイン画面で選んだユーザーのメールを X-User-Email で送る
 * - 本番（NEXT_PUBLIC_AUTH_MODE=entra）: Entra ID でログインし、アクセストークンを送る
 *   （企業の方は Entra ID B2B のゲストとして、自社の Microsoft アカウントでログインする）
 *
 * MSAL Browser v5 では、Entra ID からの戻り先は専用ページ（/redirect、app/redirect/page.tsx）になる。
 * Entra ID のアプリ登録のリダイレクトURIも https://<ドメイン>/redirect に合わせること。
 */
import type { PublicClientApplication } from "@azure/msal-browser";

export const AUTH_MODE = (process.env.NEXT_PUBLIC_AUTH_MODE ?? "dev") as "dev" | "entra";
const SCOPE = process.env.NEXT_PUBLIC_ENTRA_API_SCOPE ?? "";
const DEV_KEY = "devUserEmail";
const PORTAL_KEY = "loginPortal";
/** Entra ID からの戻り先（リダイレクトブリッジ） */
export const REDIRECT_PATH = "/redirect";

export type Portal = "bank" | "company";

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
  if (AUTH_MODE !== "entra") return !!read(DEV_KEY);
  const m = await getMsal();
  return !!m.getActiveAccount();
}

export async function authHeaders(): Promise<Record<string, string>> {
  const portal = getPortal();
  const base: Record<string, string> = portal ? { "X-Login-Portal": portal } : {};
  if (AUTH_MODE !== "entra") {
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
export async function logout() {
  const portal = getPortal() ?? "company";
  write(DEV_KEY, null);
  write(PORTAL_KEY, null);
  const back = `${window.location.origin}${LOGIN_PATH[portal]}`;
  if (AUTH_MODE === "entra") {
    const m = await getMsal();
    await m.logoutRedirect({ postLogoutRedirectUri: back });
    return;
  }
  window.location.replace(back);
}
