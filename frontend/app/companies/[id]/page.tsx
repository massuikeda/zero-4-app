"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { formatEmployees } from "@/lib/company";
import { formatMinutes } from "@/lib/flow";
import { api } from "@/lib/api";
import { RESOURCE_KINDS, type Business, type Company, type Resource, type ResourceKind, type UserRow } from "@/lib/types";

type Tab = "businesses" | "resources" | "users";

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
      </div>
      {error && <div className="alert">{error}</div>}

      {isAdmin && (
        <div className="tabs">
          {(
            [
              ["businesses", `業務一覧（${businesses.length}）`],
              ["resources", `図の候補（部署・道具）（${resources.length}）`],
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
      {tab === "resources" && isAdmin && <ResourceManager cid={cid} resources={resources} onChange={load} guard={guard} />}
      {tab === "users" && isAdmin && <CompanyUserManager cid={cid} users={users} onChange={load} guard={guard} />}
    </div>
  );
}

/** 画面に出す種類名（データ上の値は変えない。「担当者」はログインユーザーと紛らわしいので「役割」と表示） */
const KIND_LABEL: Record<ResourceKind, string> = {
  部署: "部署",
  担当者: "役割",
  取引先: "取引先",
  システム: "システム",
  帳票: "帳票",
};

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

function ResourceManager({
  cid, resources, onChange, guard,
}: { cid: number; resources: Resource[]; onChange: () => void; guard: Guard }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const hint: Record<ResourceKind, string> = {
    部署: "スイムレーンに使えます",
    担当者: "部署の中の役割（例：経理担当）。スイムレーンに使えます",
    取引先: "社外の列（取引先など）",
    システム: "作業の「道具（札）」で選べます",
    帳票: "作業の「道具（札）」で選べます。紙として集計されます",
  };
  return (
    <div className="res-grid">
      {RESOURCE_KINDS.map((kind) => (
        <div className="card" key={kind}>
          <h3>{KIND_LABEL[kind]}</h3>
          <p className="muted small">{hint[kind]}</p>
          <ul className="res-list">
            {resources
              .filter((r) => r.kind === kind)
              .map((r) => (
                <li key={r.id}>
                  <input
                    defaultValue={r.name}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== r.name &&
                      guard(() => api.updateResource(r.id, { ...r, name: e.target.value.trim() }).then(onChange))
                    }
                  />
                  <button
                    className="btn-delete"
                    title="削除"
                    onClick={() =>
                      confirm(`「${r.name}」を削除しますか？`) && guard(() => api.deleteResource(r.id).then(onChange))
                    }
                  >
                    削除
                  </button>
                </li>
              ))}
          </ul>
          <div className="row gap">
            <input
              placeholder={`${KIND_LABEL[kind]}を追加`}
              value={inputs[kind] ?? ""}
              onChange={(e) => setInputs({ ...inputs, [kind]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !(inputs[kind] ?? "").trim()) return;
                guard(async () => {
                  await api.createResource(cid, { kind, name: inputs[kind].trim() });
                  setInputs({ ...inputs, [kind]: "" });
                  onChange();
                });
              }}
            />
          </div>
        </div>
      ))}
      <p className="muted small full">※ 名前を変えても、作成済みのフローの表記は変わりません。</p>
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
