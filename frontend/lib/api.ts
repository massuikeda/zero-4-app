"use client";

import { authHeaders } from "./auth";
import type {
  Business, Company, Comparison, Flow, FlowDoc, FlowKind, Me, Resource, ResourceKind, UserRow,
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

type BusinessIn = Pick<Business, "name" | "department" | "frequency" | "description">;
type NotesIn = Partial<Pick<Business, "hearing_notes" | "exec_view" | "field_view">>;

export const api = {
  devUsers: () => call<UserRow[]>("/api/dev/users"),
  me: () => call<Me>("/api/me"),

  companies: () => call<Company[]>("/api/companies"),
  company: (id: number) => call<Company>(`/api/companies/${id}`),
  createCompany: (b: { name: string; note: string }) => call<Company>("/api/companies", { body: b }),
  updateCompany: (id: number, b: { name: string; note: string }) =>
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
  deleteBusiness: (id: number) => call(`/api/businesses/${id}`, { method: "DELETE" }),
  setAssignees: (id: number, user_ids: number[]) =>
    call<Business>(`/api/businesses/${id}/assignees`, { method: "PUT", body: { user_ids } }),

  flows: (bid: number) =>
    call<{ asis: FlowDoc | null; tobe: FlowDoc | null; comparison: Comparison | null }>(`/api/businesses/${bid}/flows`),
  saveFlow: (bid: number, kind: FlowKind, data: Flow, version: number) =>
    call<FlowDoc>(`/api/businesses/${bid}/flows/${kind}`, { method: "PUT", body: { data, version } }),
  copyAsisToTobe: (bid: number) => call<FlowDoc>(`/api/businesses/${bid}/flows/tobe/copy-from-asis`, { body: {} }),
  drawio: (bid: number, kind: FlowKind) => call<string>(`/api/businesses/${bid}/flows/${kind}/drawio`, { text: true }),
  renderDrawio: (flow: Flow, title: string) => call<string>("/api/render/drawio", { body: { flow, title }, text: true }),

  users: (cid: number) => call<UserRow[]>(`/api/companies/${cid}/users`),
  createUser: (b: { email: string; name: string; role: "member"; company_id: number }) =>
    call<UserRow>("/api/users", { body: b }),
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
