"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CompanyUserManager } from "@/components/CompanyUserManager";
import { api } from "@/lib/api";
import type { Company, UserRow } from "@/lib/types";

/** 企業ユーザー（この企業の人のログイン）の登録・削除。銀行担当者だけが開ける。企業ページの「企業ユーザー」から来る */
export default function CompanyUsersPage() {
  const { id } = useParams<{ id: string }>();
  const cid = Number(id);
  const me = useMe();
  const isAdmin = me?.role === "admin";
  const [company, setCompany] = useState<Company | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const load = useCallback(async () => {
    await guard(async () => {
      const [c, u] = await Promise.all([api.company(cid), api.users(cid)]);
      setCompany(c);
      setUsers(u);
    });
  }, [cid]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (me && !isAdmin) return <div className="alert">企業ユーザーの登録は、銀行担当者だけができます。</div>;
  if (!company) return error ? <div className="alert">{error}</div> : <p className="muted">読み込み中…</p>;

  return (
    <div className="stack">
      <Breadcrumbs
        items={[{ label: "企業一覧", href: "/" }, { label: company.name, href: `/companies/${cid}` }, { label: "企業ユーザー" }]}
      />
      <h1>企業ユーザー</h1>
      {error && <div className="alert">{error}</div>}
      <CompanyUserManager cid={cid} users={users} onChange={load} guard={guard} />
    </div>
  );
}
