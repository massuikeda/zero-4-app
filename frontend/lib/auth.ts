"use client";

/**
 * 認証。
 * - 開発（NEXT_PUBLIC_AUTH_MODE=dev）: 画面右上で選んだユーザーのメールを X-User-Email で送る
 * - 本番（NEXT_PUBLIC_AUTH_MODE=entra）: Entra ID でログインし、アクセストークンを送る
 *
 * MSAL Browser v5 では、Entra ID からの戻り先は専用ページ（/redirect、app/redirect/page.tsx）になる。
 * Entra ID のアプリ登録のリダイレクトURIも https://<ドメイン>/redirect に合わせること。
 */
import type { PublicClientApplication } from "@azure/msal-browser";

export const AUTH_MODE = (process.env.NEXT_PUBLIC_AUTH_MODE ?? "dev") as "dev" | "entra";
const SCOPE = process.env.NEXT_PUBLIC_ENTRA_API_SCOPE ?? "";
const DEV_KEY = "devUserEmail";
/** Entra ID からの戻り先（リダイレクトブリッジ） */
export const REDIRECT_PATH = "/redirect";

let msal: PublicClientApplication | null = null;

export function getDevUser(): string | null {
  try {
    return localStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

export function setDevUser(email: string) {
  try {
    localStorage.setItem(DEV_KEY, email);
  } catch {
    /* noop */
  }
}

/** 本番モードではログイン済みでなければログイン画面へ。戻り値: ログイン済みか */
export async function initAuth(): Promise<boolean> {
  if (AUTH_MODE !== "entra") return true;
  const { PublicClientApplication } = await import("@azure/msal-browser");
  msal = new PublicClientApplication({
    auth: {
      clientId: process.env.NEXT_PUBLIC_ENTRA_SPA_CLIENT_ID ?? "",
      authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_ENTRA_TENANT_ID}`,
      redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await msal.initialize();
  const res = await msal.handleRedirectPromise();
  if (res?.account) msal.setActiveAccount(res.account);
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) {
    await msal.loginRedirect({ scopes: [SCOPE] });
    return false;
  }
  msal.setActiveAccount(account);
  return true;
}

export async function authHeaders(): Promise<Record<string, string>> {
  if (AUTH_MODE !== "entra") {
    const email = getDevUser();
    return email ? { "X-User-Email": email } : {};
  }
  if (!msal) return {};
  const account = msal.getActiveAccount();
  if (!account) return {};
  try {
    const r = await msal.acquireTokenSilent({ scopes: [SCOPE], account });
    return { Authorization: `Bearer ${r.accessToken}` };
  } catch {
    await msal.acquireTokenRedirect({ scopes: [SCOPE] });
    return {};
  }
}

export function logout() {
  msal?.logoutRedirect();
}
