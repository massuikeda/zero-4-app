"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { formatEmployees } from "@/lib/company";
import { formatMinutes } from "@/lib/flow";
import { api } from "@/lib/api";
import { PLAN_LABEL, type Business, type Company, type Resource, type UserRow } from "@/lib/types";

type Tab = "businesses" | "users";

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const cid = Number(id);
  const me = useMe();
  const isAdmin = me?.role === "admin";
  const [tab, setTab] = useState<Tab>("businesses");
  const [company, setCompany] = useState<Company | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
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
      const [c, b, r] = await Promise.all([api.company(cid), api.businesses(cid), api.resources(cid)]);
      setCompany(c);
      setBusinesses(b);
      setResources(r);
      if (isAdmin) setUsers(await api.users(cid));
    });
  }, [cid, isAdmin]);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  if (!company) return error ? <div className="alert">{error}</div> : <p className="muted">読み込み中…</p>;

  return (
    <div className="stack">
      {isAdmin && (
        <Breadcrumbs items={[{ label: "企業一覧", href: "/" }, { label: company.name }]} />
      )}
      <div className="title-row">
        <div>
          <h1>{company.name}</h1>
          <p className="muted small">
            {[company.industry, company.employees != null ? `従業員 ${formatEmployees(company.employees)}` : "", company.note]
              .filter(Boolean)
              .join("・")}
          </p>
        </div>
        <WageEditor company={company} isAdmin={isAdmin} onSaved={setCompany} guard={guard} />
      </div>
      {error && <div className="alert">{error}</div>}

      {isAdmin && (
        <div className="tabs">
          {(
            [
              ["businesses", `業務一覧（${businesses.length}）`],
              ["users", `企業ユーザー（${users.length}）`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "businesses" && (
        <BusinessList
          cid={cid}
          isAdmin={isAdmin}
          businesses={businesses}
          resources={resources}
          onChange={load}
          guard={guard}
        />
      )}
      {tab === "users" && isAdmin && <CompanyUserManager cid={cid} users={users} onChange={load} guard={guard} />}
    </div>
  );
}

/** 時給（企業ごとに1つ）。TO-BEの削減時間を金額に直すのに使う。設定は銀行担当者 */
function WageEditor({
  company, isAdmin, onSaved, guard,
}: { company: Company; isAdmin: boolean; onSaved: (c: Company) => void; guard: Guard }) {
  const [value, setValue] = useState(company.hourly_wage == null ? "" : String(company.hourly_wage));
  const t = value.trim().replace(/[,，]/g, "");
  const wage = t === "" ? null : /^\d+$/.test(t) ? Number(t) : undefined; // undefined＝入力ミス
  const changed = wage !== undefined && wage !== company.hourly_wage;
  if (!isAdmin) return null; // 費用対効果は銀行担当者だけが扱う
  return (
    <form
      className="wage-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return;
        guard(async () =>
          onSaved(
            await api.updateCompany(company.id, {
              name: company.name, industry: company.industry, employees: company.employees, note: company.note, hourly_wage: wage,
            }),
          ),
        );
      }}
    >
      <label>
        <span className="small muted">時給（円）</span>
        <input
          inputMode="numeric"
          placeholder="例：2500"
          value={value}
          aria-invalid={wage === undefined}
          title="TO-BEの削減時間を金額（月の削減額）に直すのに使います"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" className="btn ghost" disabled={!changed}>
        保存
      </button>
      {wage === undefined && <span className="small error-text">0以上の整数で入力してください</span>}
    </form>
  );
}

type Guard = (fn: () => Promise<unknown>) => Promise<void>;

function BusinessList({
  cid, isAdmin, businesses, resources, onChange, guard,
}: {
  cid: number; isAdmin: boolean; businesses: Business[]; resources: Resource[];
  onChange: () => void; guard: Guard;
}) {
  const [form, setForm] = useState({ name: "", department: "", frequency: "" });
  const [query, setQuery] = useState("");
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
              <th>状況</th>
              <th className="num">削減時間（1回あたり）</th>
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
                <td>
                  <span className={`status s${["未着手", "AS-IS作成済", "TO-BE作成済"].indexOf(b.status)}`}>{b.status}</span>
                </td>
                <td className="num">
                  {b.saved_minutes == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className={b.saved_minutes < 0 ? "saved minus" : "saved"}>
                      {b.saved_minutes < 0 ? "−" : ""}
                      {formatMinutes(Math.abs(b.saved_minutes))}
                      {b.saved_plan && (
                        <em className="plan-of" title={b.adopted_plan ? "採用する案" : "採用する案が未選択のため、竹の案を表示しています"}>
                          {PLAN_LABEL[b.saved_plan]}
                          {b.adopted_plan ? "・採用" : ""}
                        </em>
                      )}
                    </span>
                  )}
                </td>
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

/** 企業ユーザー（この企業の人のログイン）。銀行担当者が登録する */
function CompanyUserManager({
  cid, users, onChange, guard,
}: { cid: number; users: UserRow[]; onChange: () => void; guard: Guard }) {
  const [form, setForm] = useState({ name: "", email: "" });
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const add = () =>
    guard(async () => {
      await api.createUser({ name: form.name.trim(), email: form.email.trim(), role: "member", company_id: cid });
      setForm({ name: "", email: "" });
      onChange();
    });

  return (
    <div className="stack">
      <p className="muted small">
        ここに登録した人は「企業の方のログイン」からログインし、この企業の業務だけを見られます（ヒアリング・AS-IS・TO-BE の閲覧と編集）。
        本番では、同じメールアドレスの Microsoft アカウントでログインします（Entra ID にゲストとして招待してください）。
      </p>
      <div className="table-wrap">
        <table className="plain">
          <thead>
            <tr>
              <th>名前</th>
              <th>メールアドレス</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="mono">{u.email}</td>
                <td>
                  <button
                    className="btn-delete"
                    title="削除"
                    onClick={() =>
                      confirm(`「${u.name}」を削除しますか？この人はログインできなくなります。`) &&
                      guard(() => api.deleteUser(u.id).then(onChange))
                    }
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={3} className="muted center">
                  まだ登録されていません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <form
        className="card dashed row gap wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim() && emailOk) add();
        }}
      >
        <strong>企業ユーザーを追加</strong>
        <input placeholder="名前" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input
          type="email"
          placeholder="メールアドレス"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <button type="submit" className="btn primary" disabled={!form.name.trim() || !emailOk}>
          追加
        </button>
      </form>
    </div>
  );
}
