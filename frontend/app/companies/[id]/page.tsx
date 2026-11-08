"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
          <p className="muted small">{company.note}</p>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}

      {isAdmin && (
        <div className="tabs">
          {(
            [
              ["businesses", `業務一覧（${businesses.length}）`],
              ["resources", `リソース（${resources.length}）`],
              ["users", `担当者（${users.length}）`],
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
          users={users}
          resources={resources}
          onChange={load}
          guard={guard}
        />
      )}
      {tab === "resources" && isAdmin && <ResourceManager cid={cid} resources={resources} onChange={load} guard={guard} />}
      {tab === "users" && isAdmin && (
        <UserManager cid={cid} users={users} businesses={businesses} onChange={load} guard={guard} />
      )}
    </div>
  );
}

type Guard = (fn: () => Promise<unknown>) => Promise<void>;

function BusinessList({
  cid, isAdmin, businesses, users, resources, onChange, guard,
}: {
  cid: number; isAdmin: boolean; businesses: Business[]; users: UserRow[]; resources: Resource[];
  onChange: () => void; guard: Guard;
}) {
  const [form, setForm] = useState({ name: "", department: "", frequency: "" });
  const [query, setQuery] = useState("");
  const depts = resources.filter((r) => r.kind === "部署").map((r) => r.name);
  const shown = businesses.filter((b) => `${b.name}${b.department}`.includes(query));

  return (
    <div className="stack">
      {!isAdmin && <p className="muted small">あなたに割り当てられた業務が表示されています。</p>}
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
              {isAdmin && <th>見られる担当者</th>}
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
                {isAdmin && (
                  <td>
                    <AssigneePicker
                      users={users}
                      value={b.assignee_ids}
                      onSave={(ids) => guard(() => api.setAssignees(b.id, ids).then(onChange))}
                    />
                  </td>
                )}
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
                  {isAdmin ? "業務がまだありません" : "割り当てられた業務はありません。管理者に連絡してください"}
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

function AssigneePicker({ users, value, onSave }: { users: UserRow[]; value: number[]; onSave: (ids: number[]) => void }) {
  const names = users.filter((u) => value.includes(u.id)).map((u) => u.name);
  return (
    <details className="picker">
      <summary>{names.length ? names.join("、") : <span className="muted">未割り当て</span>}</summary>
      <div className="picker-body">
        {users.length === 0 && <p className="muted small">「担当者」タブで登録してください</p>}
        {users.map((u) => (
          <label key={u.id} className="check">
            <input
              type="checkbox"
              checked={value.includes(u.id)}
              onChange={(e) => onSave(e.target.checked ? [...value, u.id] : value.filter((x) => x !== u.id))}
            />
            {u.name}
          </label>
        ))}
      </div>
    </details>
  );
}

function ResourceManager({
  cid, resources, onChange, guard,
}: { cid: number; resources: Resource[]; onChange: () => void; guard: Guard }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const hint: Record<ResourceKind, string> = {
    部署: "スイムレーンに使えます",
    担当者: "役割名（例：経理担当）。スイムレーンに使えます",
    取引先: "社外の列（取引先など）",
    システム: "作業の「道具（札）」で選べます",
    帳票: "作業の「道具（札）」で選べます。紙として集計されます",
  };
  return (
    <div className="res-grid">
      {RESOURCE_KINDS.map((kind) => (
        <div className="card" key={kind}>
          <h3>{kind}</h3>
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
              placeholder={`${kind}を追加`}
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

function UserManager({
  cid, users, businesses, onChange, guard,
}: { cid: number; users: UserRow[]; businesses: Business[]; onChange: () => void; guard: Guard }) {
  const [form, setForm] = useState({ email: "", name: "" });
  const bname = (id: number) => businesses.find((b) => b.id === id)?.name ?? "";
  return (
    <div className="stack">
      <p className="muted small">
        担当者は、割り当てられた業務だけを見て、編集できます。割り当ては「業務一覧」タブで行います。
        本番ではこのメールアドレスでEntra IDにログインします。
      </p>
      <div className="table-wrap">
        <table className="plain">
          <thead>
            <tr>
              <th>名前</th>
              <th>メールアドレス</th>
              <th>割り当て業務</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="mono">{u.email}</td>
                <td>{u.business_ids.map(bname).join("、") || <span className="muted">なし</span>}</td>
                <td>
                  <button
                    className="btn-delete"
                    title="削除"
                    onClick={() => confirm(`${u.name} を削除しますか？`) && guard(() => api.deleteUser(u.id).then(onChange))}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card dashed row gap wrap">
        <strong>担当者を追加</strong>
        <input placeholder="名前" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="メールアドレス" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <button
          className="btn primary"
          disabled={!form.name.trim() || !form.email.includes("@")}
          onClick={() =>
            guard(async () => {
              await api.createUser({ ...form, role: "member", company_id: cid });
              setForm({ email: "", name: "" });
              onChange();
            })
          }
        >
          追加
        </button>
      </div>
    </div>
  );
}
