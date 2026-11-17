"use client";

import { authHeaders } from "./auth";
import type {
  AsisVersion, Business, Company, Comparison, Diagnosis, DiagnosisIn, Effort, Flow, FlowDoc, FlowKind, Me,
  Resource, ResourceKind, TobePlan, UserRow, VersionRef,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown; text?: boolean }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await authHeaders()),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let msg = `エラー (${res.status})`;
    // 画面側の転送が待ちきれなかったとき（バックエンドの返事が遅い・止まっている）
    if (res.status === 500 && path.startsWith("/api/")) msg = "サーバーの応答がありませんでした。バックエンドが動いているか確認して、もう一度お試しください (500)";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg: string }) => d.msg).join(" / ");
    } catch {
      /* noop */
    }
    throw new ApiError(res.status, msg);
  }
  return (init?.text ? res.text() : res.json()) as Promise<T>;
}

type CompanyIn = { name: string; industry: string; employees: number | null; note?: string; hourly_wage?: number | null };
type BusinessIn = Pick<Business, "name" | "department" | "frequency" | "description"> & { monthly_count?: number | null };
type NotesIn = Partial<Pick<Business, "hearing_raw" | "hearing_notes" | "exec_view" | "field_view">>;

export const api = {
  config: () => call<{ auth_mode: string; ai_enabled: boolean }>("/api/config"),
  devUsers: (role?: "admin" | "member") => call<UserRow[]>(`/api/dev/users${role ? `?role=${role}` : ""}`),
  me: () => call<Me>("/api/me"),

  companies: () => call<Company[]>("/api/companies"),
  company: (id: number) => call<Company>(`/api/companies/${id}`),
  createCompany: (b: CompanyIn) => call<Company>("/api/companies", { body: b }),
  updateCompany: (id: number, b: CompanyIn) =>
    call<Company>(`/api/companies/${id}`, { method: "PUT", body: b }),
  deleteCompany: (id: number) => call(`/api/companies/${id}`, { method: "DELETE" }),

  resources: (cid: number) => call<Resource[]>(`/api/companies/${cid}/resources`),
  createResource: (cid: number, b: { kind: ResourceKind; name: string; note?: string }) =>
    call<Resource>(`/api/companies/${cid}/resources`, { body: b }),
  updateResource: (id: number, b: { kind: ResourceKind; name: string; note: string; sort: number }) =>
    call<Resource>(`/api/resources/${id}`, { method: "PUT", body: b }),
  deleteResource: (id: number) => call(`/api/resources/${id}`, { method: "DELETE" }),

  businesses: (cid: number) => call<Business[]>(`/api/companies/${cid}/businesses`),
  business: (id: number) => call<Business>(`/api/businesses/${id}`),
  createBusiness: (cid: number, b: BusinessIn) => call<Business>(`/api/companies/${cid}/businesses`, { body: b }),
  updateBusiness: (id: number, b: BusinessIn) => call<Business>(`/api/businesses/${id}`, { method: "PUT", body: b }),
  updateNotes: (id: number, notes: NotesIn) =>
    call<Business>(`/api/businesses/${id}/notes`, { method: "PUT", body: notes }),
  /** ヒアリングボックスの記録を Azure OpenAI で決まった形式に整える（保存はしない） */
  formatHearing: (id: number, raw: string) =>
    call<{ text: string }>(`/api/businesses/${id}/hearing/format`, { body: { raw } }),
  /** 保存済みのAS-ISから、Azure OpenAI で TO-BE の改善案を作る（保存はしない） */
  suggestTobe: (id: number) => call<TobePlan>(`/api/businesses/${id}/tobe/suggest`, { body: {} }),
  deleteBusiness: (id: number) => call(`/api/businesses/${id}`, { method: "DELETE" }),
  setAssignees: (id: number, user_ids: number[]) =>
    call<Business>(`/api/businesses/${id}/assignees`, { method: "PUT", body: { user_ids } }),

  flows: (bid: number) =>
    call<{ asis: FlowDoc | null; tobe: FlowDoc | null; comparison: Comparison | null }>(`/api/businesses/${bid}/flows`),
  saveFlow: (bid: number, kind: FlowKind, data: Flow, version: number) =>
    call<FlowDoc>(`/api/businesses/${bid}/flows/${kind}`, { method: "PUT", body: { data, version } }),
  copyAsisToTobe: (bid: number) => call<FlowDoc>(`/api/businesses/${bid}/flows/tobe/copy-from-asis`, { body: {} }),

  /** 診断の記録（新しい順） */
  diagnoses: (cid: number) => call<Diagnosis[]>(`/api/companies/${cid}/diagnoses`),
  /** 診断を記録する（version_ids で、業務ごとに「そのときのAS-ISの版」を選ぶ） */
  createDiagnosis: (cid: number, b: DiagnosisIn) => call<Diagnosis>(`/api/companies/${cid}/diagnoses`, { body: b }),
  updateDiagnosis: (id: number, b: DiagnosisIn) => call<Diagnosis>(`/api/diagnoses/${id}`, { method: "PUT", body: b }),
  deleteDiagnosis: (id: number) => call(`/api/diagnoses/${id}`, { method: "DELETE" }),
  /** この業務のAS-ISの版（古い順。第1版が最初のAS-IS）。AS-ISを保存するたびに1つ増える */
  asisVersions: (bid: number) => call<AsisVersion[]>(`/api/businesses/${bid}/versions`),
  /** 企業の全業務の、AS-ISの版の見出し（診断を記録するときの選択肢） */
  companyVersions: (cid: number) => call<VersionRef[]>(`/api/companies/${cid}/versions`),
  /** 企業の全業務の削減工数（月あたり・時間）と、月ごとの推移 */
  companyEffort: (cid: number) => call<Effort>(`/api/companies/${cid}/effort`),

  drawio: (bid: number, kind: FlowKind) => call<string>(`/api/businesses/${bid}/flows/${kind}/drawio`, { text: true }),
  renderDrawio: (flow: Flow, title: string) => call<string>("/api/render/drawio", { body: { flow, title }, text: true }),

  users: (cid: number) => call<UserRow[]>(`/api/companies/${cid}/users`),
  /** password は初期パスワード（AUTH_MODE=password のときは必須） */
  createUser: (b: { email: string; name: string; role: "member"; company_id: number; password?: string }) =>
    call<UserRow>("/api/users", { body: b }),
  /** 銀行担当者がパスワードを決め直す（ロックも解ける） */
  resetUserPassword: (id: number, password: string) =>
    call<UserRow>(`/api/users/${id}/password`, { method: "PUT", body: { password } }),
  /** 自分のパスワードを変える */
  changePassword: (current_password: string, new_password: string) =>
    call("/api/auth/password", { method: "PUT", body: { current_password, new_password } }),
  deleteUser: (id: number) => call(`/api/users/${id}`, { method: "DELETE" }),
};

export function download(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
