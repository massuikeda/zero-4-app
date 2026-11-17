"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DiagnosisHistory } from "@/components/DiagnosisHistory";
import { formatEmployees } from "@/lib/company";
import { api } from "@/lib/api";
import { formatHours } from "@/lib/diagnosis";
import type { Business, Company, Diagnosis, Effort, Resource, VersionRef } from "@/lib/types";

type Tab = "history" | "businesses";

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const cid = Number(id);
  const me = useMe();
  const isAdmin = me?.role === "admin";
  const [tab, setTab] = useState<Tab>("history");
  /** 開いたときのタブを決めたか（読み直しのたびに変えない） */
  const tabDecided = useRef(false);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  /** 全業務のAS-ISの版の見出し（診断を記録するときに選ぶ） */
  const [versions, setVersions] = useState<VersionRef[]>([]);
  /** 全業務の削減工数（月あたり・時間） */
  const [effort, setEffort] = useState<Effort | null>(null);
  /** 診断を記録する入力欄を開いているか */
  const [formOpen, setFormOpen] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
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
      const [c, b, r, d, v, e] = await Promise.all([
        api.company(cid), api.businesses(cid), api.resources(cid), api.diagnoses(cid), api.companyVersions(cid),
        api.companyEffort(cid),
      ]);
      setVersions(v);
      setEffort(e);
      setCompany(c);
      setBusinesses(b);
      setResources(r);
      setDiagnoses(d);
      // 開いたときのタブ：診断の記録があれば履歴、まだなければ業務フロー（先に業務とAS-ISを作るため）
      if (!tabDecided.current) {
        tabDecided.current = true;
        setTab(d.length ? "history" : "businesses");
      }
    });
  }, [cid]);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  if (!company) return error ? <div className="alert">{error}</div> : <p className="muted">読み込み中…</p>;

  return (
    <div className="stack">
      {isAdmin && (
        <Breadcrumbs items={[{ label: "企業一覧", href: "/" }, { label: company.name }]} />
      )}
      <div className="card company-head">
        <div className="title-row">
          <div>
            <h1 className="company-name">
              {company.name}
              {(company.industry || company.employees != null) && (
                <small>
                  （{[company.industry, company.employees != null ? `従業員 ${formatEmployees(company.employees)}` : ""].filter(Boolean).join("・")}）
                </small>
              )}
              {isAdmin && (
                <Link className="link company-users-link" href={`/companies/${cid}/users`}>
                  ログインユーザー追加
                </Link>
              )}
            </h1>
          </div>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}

      <div className="tabs">
        {(
          [
            ["history", "ヒアリング履歴"],
            ["businesses", "業務フロー"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "history" && (
        <DiagnosisHistory
          cid={cid}
          isAdmin={isAdmin}
          diagnoses={diagnoses}
          businesses={businesses}
          versions={versions}
          effort={effort}
          onChange={load}
          guard={guard}
          formOpen={formOpen}
          setFormOpen={setFormOpen}
        />
      )}

      {tab === "businesses" && (
        <BusinessList
          cid={cid}
          isAdmin={isAdmin}
          businesses={businesses}
          effort={effort}
          resources={resources}
          onChange={load}
          guard={guard}
        />
      )}
    </div>
  );
}

type Guard = (fn: () => Promise<unknown>) => Promise<void>;

function BusinessList({
  cid, isAdmin, businesses, effort, resources, onChange, guard,
}: {
  cid: number; isAdmin: boolean; businesses: Business[]; effort: Effort | null; resources: Resource[];
  onChange: () => void; guard: Guard;
}) {
  const [form, setForm] = useState({ name: "", department: "", frequency: "" });
  const [query, setQuery] = useState("");
  // 業務ごとの、第1版からの削減時間（月あたり・時間）。企業ページの右側の合計と同じ値
  const savedOf = new Map((effort?.businesses ?? []).map((e) => [e.business_id, e.saved_hours]));
  const depts = resources.filter((r) => r.kind === "部署").map((r) => r.name);
  const shown = businesses.filter((b) => `${b.name}${b.department}`.includes(query));

  return (
    <div className="stack">
      {!isAdmin && <p className="muted small">自社の業務が表示されています。</p>}
      {businesses.length > 5 && (
        <input className="search" placeholder="業務名・部署で絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      <div className="table-wrap">
        <table className="plain">
          <thead>
            <tr>
              <th>業務名</th>
              <th>部署</th>
              <th>頻度</th>
              <th className="num">第1版からの削減時間（月あたり）</th>
              <th className="num">AS-ISの版</th>
              <th>更新日</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link className="strong link" href={`/businesses/${b.id}`}>
                    {b.name}
                  </Link>
                </td>
                <td>{b.department}</td>
                <td>{b.frequency}</td>
                <td className="num">
                  {savedOf.get(b.id) == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className={savedOf.get(b.id)! < 0 ? "saved minus" : "saved"}>{formatHours(savedOf.get(b.id))}</span>
                  )}
                </td>
                <td className="num">{b.asis_versions ? `${b.asis_versions}版` : <span className="muted">—</span>}</td>
                <td className="small muted">{new Date(b.updated_at).toLocaleDateString("ja-JP")}</td>
                {isAdmin && (
                  <td>
                    <button
                      className="btn-delete"
                      title="削除"
                      onClick={() =>
                        confirm(`「${b.name}」とそのAS-IS/TO-BEを削除しますか？`) &&
                        guard(() => api.deleteBusiness(b.id).then(onChange))
                      }
                    >
                      削除
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="muted center">
                  {isAdmin ? "業務がまだありません" : "業務はまだ登録されていません。銀行の担当者にお問い合わせください"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="card dashed row gap wrap">
          <strong>業務を追加</strong>
          <input placeholder="業務名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input
            placeholder="部署"
            list="dept-candidates"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
          <datalist id="dept-candidates">
            {depts.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <input placeholder="頻度（例：月200件）" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} />
          <button
            className="btn primary"
            disabled={!form.name.trim()}
            onClick={() =>
              guard(async () => {
                await api.createBusiness(cid, { ...form, description: "" });
                setForm({ name: "", department: "", frequency: "" });
                onChange();
              })
            }
          >
            追加
          </button>
        </div>
      )}
    </div>
  );
}
