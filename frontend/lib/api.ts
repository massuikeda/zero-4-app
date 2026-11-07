// バックエンド（FastAPI）の呼び出しをここに集める
//
// 接続先は環境変数 NEXT_PUBLIC_API_URL（未設定なら http://localhost:8000）
// ※ NEXT_PUBLIC_ の値はビルド時に埋め込まれる。Azure では「ビルド前」に設定すること

import type {
  AiDraft, CompanyMe, CompanyProjectDetail, Master, MyApplication, Project, ProjectInput,
  PublicProject, TalentMe, TalentProfileInput, TalentProjectDetail,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type Role = "company" | "talent";

// ---- ログイントークン（企業・人材で別々に保存） ----

const tokenKey = (role: Role) => `zero4.${role}.token`;

export function getToken(role: Role): string | null {
  try {
    return window.localStorage.getItem(tokenKey(role));
  } catch {
    return null;
  }
}

export function setToken(role: Role, token: string) {
  try {
    window.localStorage.setItem(tokenKey(role), token);
  } catch {
    /* 保存できない環境（プライベートブラウズ等） */
  }
}

export function clearToken(role: Role) {
  try {
    window.localStorage.removeItem(tokenKey(role));
  } catch {
    /* noop */
  }
}

// ---- 共通の呼び出し ----

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(role: Role | null, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (role) {
    const t = getToken(role);
    if (t) headers.Authorization = `Bearer ${t}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, `サーバーにつながりません（${API_URL}）。バックエンドが起動しているか確認してください。`);
  }

  if (!res.ok) {
    if (res.status === 401 && role) clearToken(role);
    let message = `エラーが発生しました（${res.status}）`;
    try {
      const data = await res.json();
      // FastAPI の detail は文字列か、入力チェックのエラー一覧
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) message = `入力内容を確認してください：${data.detail[0].msg}`;
    } catch {
      /* JSON でない */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== 0).map(([k, v]) => [k, String(v)]),
  ).toString();
  return s ? `?${s}` : "";
};

// ---- API 一覧 ----

export const api = {
  master: () => request<Master>(null, "/api/master"),

  company: {
    login: (email: string, password: string) =>
      request<{ token: string }>(null, "/api/company/login", { method: "POST", body: { email, password } }),
    register: (body: { code: string; companyName: string; industry: string; userName: string; email: string; password: string }) =>
      request<{ token: string }>(null, "/api/company/register", { method: "POST", body }),
    me: () => request<CompanyMe>("company", "/api/company/me"),
    projects: () => request<Project[]>("company", "/api/company/projects"),
    aiDraft: (issueOptionIds: number[], freeText: string) =>
      request<AiDraft>("company", "/api/company/projects/ai-draft", { method: "POST", body: { issueOptionIds, freeText } }),
    createProject: (body: ProjectInput) => request<Project>("company", "/api/company/projects", { method: "POST", body }),
    project: (id: string | number) => request<CompanyProjectDetail>("company", `/api/company/projects/${id}`),
    closeProject: (id: number) => request<Project>("company", `/api/company/projects/${id}/close`, { method: "POST" }),
    setApplicationStatus: (id: number, status: "interview" | "selected" | "rejected") =>
      request("company", `/api/company/applications/${id}`, { method: "PATCH", body: { status } }),
  },

  talent: {
    login: (email: string, password: string) =>
      request<{ token: string }>(null, "/api/talent/login", { method: "POST", body: { email, password } }),
    register: (body: { name: string; email: string; password: string }) =>
      request<{ token: string }>(null, "/api/talent/register", { method: "POST", body }),
    me: () => request<TalentMe>("talent", "/api/talent/me"),
    updateMe: (body: TalentProfileInput) => request<TalentMe>("talent", "/api/talent/me", { method: "PUT", body }),
    recommendations: () => request<PublicProject[]>("talent", "/api/talent/recommendations"),
    projects: (p: { q?: string; skillId?: number; sort?: "new" | "match" | "fee" }) =>
      request<PublicProject[]>("talent", `/api/talent/projects${qs({ q: p.q, skill_id: p.skillId, sort: p.sort })}`),
    project: (id: string | number) => request<TalentProjectDetail>("talent", `/api/talent/projects/${id}`),
    apply: (id: number, message: string, agreed: boolean) =>
      request("talent", `/api/talent/projects/${id}/apply`, { method: "POST", body: { message, agreed } }),
    applications: () => request<MyApplication[]>("talent", "/api/talent/applications"),
    withdraw: (applicationId: number) =>
      request("talent", `/api/talent/applications/${applicationId}/withdraw`, { method: "POST" }),
  },
};
