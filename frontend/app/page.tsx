"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { api } from "@/lib/api";
import type { Company } from "@/lib/types";

/** トップ：管理者は企業一覧、担当者は自社の業務一覧へ */
export default function Home() {
  const me = useMe();
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({ name: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    if (me.role !== "admin" && me.company_id) {
      router.replace(`/companies/${me.company_id}`);
      return;
    }
    api.companies().then(setCompanies).catch((e) => setError(e.message));
  }, [me, router]);

  if (!me || me.role !== "admin") return <p className="muted">読み込み中…</p>;

  const create = async () => {
    try {
      const c = await api.createCompany(form);
      setCompanies((cs) => [...cs, c]);
      setForm({ name: "", note: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="stack">
      <h1>企業一覧</h1>
      {error && <div className="alert">{error}</div>}
      <div className="cards">
        {companies.map((c) => (
          <Link key={c.id} href={`/companies/${c.id}`} className="card link">
            <strong>{c.name}</strong>
            <span className="muted small">{c.note}</span>
            <span className="small">業務 {c.business_count}件</span>
          </Link>
        ))}
        <div className="card dashed">
          <strong>企業を追加</strong>
          <input placeholder="企業名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="メモ（業種・規模など）" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="btn primary" disabled={!form.name.trim()} onClick={create}>
            追加
          </button>
        </div>
      </div>
    </div>
  );
}
