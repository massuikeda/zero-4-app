"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { api } from "@/lib/api";
import { formatEmployees, parseEmployees } from "@/lib/company";
import type { Company } from "@/lib/types";

const EMPTY_FORM = { name: "", industry: "", employees: "" };

/** トップ：銀行担当者は企業一覧、企業担当者は自社の業務一覧へ */
export default function Home() {
  const me = useMe();
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
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

  const employees = parseEmployees(form.employees);
  const employeesInvalid = employees === undefined;
  const canCreate = !!form.name.trim() && !employeesInvalid;

  const create = async () => {
    if (!canCreate) return;
    try {
      const c = await api.createCompany({
        name: form.name.trim(),
        industry: form.industry.trim(),
        employees: employees ?? null,
      });
      setCompanies((cs) => [...cs, c]);
      setForm(EMPTY_FORM);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="stack">
      <h1>企業一覧</h1>
      {error && <div className="alert">{error}</div>}

      <div className="table-wrap">
        <table className="plain company-table">
          <thead>
            <tr>
              <th>企業名</th>
              <th>業種</th>
              <th className="num">従業員数</th>
              <th className="num">業務数</th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  企業がまだありません。下のフォームから追加してください。
                </td>
              </tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/companies/${c.id}`} className="company-link">
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.industry || <span className="muted">—</span>}</td>
                  <td className="num">{formatEmployees(c.employees)}</td>
                  <td className="num">{c.business_count}件</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form
        className="card dashed company-add"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <strong>企業を追加</strong>
        <div className="row gap wrap">
          <label className="field">
            <span className="small muted">企業名（必須）</span>
            <input
              placeholder="例：株式会社サンプル商事"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="small muted">業種</span>
            <input
              placeholder="例：卸売業"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            />
          </label>
          <label className="field narrow">
            <span className="small muted">従業員数（名）</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="例：120"
              value={form.employees}
              aria-invalid={employeesInvalid}
              onChange={(e) => setForm({ ...form, employees: e.target.value })}
            />
          </label>
          <button type="submit" className="btn primary" disabled={!canCreate}>
            追加
          </button>
        </div>
        {employeesInvalid && <span className="small error-text">従業員数は0以上の整数で入力してください</span>}
      </form>
    </div>
  );
}
