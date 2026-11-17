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
import { type AuthMode, PASSWORD_MIN, getAuthMode } from "@/lib/auth";
import type { Business, Company, Diagnosis, Effort, Resource, UserRow, VersionRef } from "@/lib/types";

type Tab = "history" | "businesses" | "users";

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
      <div className="card company-head">
        <div className="title-row">
          <div>
            <h1>{company.name}</h1>
            <p className="company-facts">
              {[company.industry, company.employees != null ? `従業員 ${formatEmployees(company.employees)}` : ""].filter(Boolean).join("　")}
            </p>
          </div>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}

      <div className="tabs">
        {(
          [
            ["history", "診断・ヒアリングの履歴"],
            ["businesses", `業務フロー（${businesses.length}）`],
            ...(isAdmin ? ([["users", `企業ユーザー（${users.length}）`]] as const) : []),
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
      {tab === "users" && isAdmin && <CompanyUserManager cid={cid} users={users} onChange={load} guard={guard} />}
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
              <th>状況</th>
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
                <td>
                  <span className={`status s${["未着手", "AS-IS作成済", "TO-BE作成済"].indexOf(b.status)}`}>{b.status}</span>
                </td>
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
                <td colSpan={8} className="muted center">
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
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [mode, setMode] = useState<AuthMode | null>(null);
  /** パスワードを決め直している人と、入力中のパスワード */
  const [reset, setReset] = useState<{ id: number; password: string } | null>(null);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const usePassword = mode === "password";
  const pwOk = !usePassword || form.password.length >= PASSWORD_MIN;

  useEffect(() => {
    getAuthMode().then(setMode, () => undefined);
  }, []);

  const add = () =>
    guard(async () => {
      await api.createUser({
        name: form.name.trim(), email: form.email.trim(), role: "member", company_id: cid,
        ...(usePassword ? { password: form.password } : {}),
      });
      setForm({ name: "", email: "", password: "" });
      onChange();
    });

  const saveReset = () =>
    reset &&
    guard(async () => {
      await api.resetUserPassword(reset.id, reset.password);
      setReset(null);
      onChange();
    });

  return (
    <div className="stack">
      <p className="muted small">
        ここに登録した人は「企業の方のログイン」からログインし、この企業の業務だけを見られます（ヒアリング・AS-IS・TO-BE の閲覧と編集）。
        {usePassword &&
          ` 初期パスワード（${PASSWORD_MIN}文字以上）はここで決めて、本人に伝えてください。本人はログイン後に「パスワード変更」から変えられます。`}
      </p>
      <div className="table-wrap">
        <table className="plain">
          <thead>
            <tr>
              <th>名前</th>
              <th>メールアドレス</th>
              {usePassword && <th>パスワード</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="mono">{u.email}</td>
                {usePassword && (
                  <td>
                    {reset?.id === u.id ? (
                      <form
                        className="row gap"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (reset.password.length >= PASSWORD_MIN) saveReset();
                        }}
                      >
                        <input
                          type="password"
                          autoComplete="new-password"
                          placeholder={`新しいパスワード（${PASSWORD_MIN}文字以上）`}
                          value={reset.password}
                          onChange={(e) => setReset({ id: u.id, password: e.target.value })}
                          autoFocus
                        />
                        <button type="submit" className="btn primary" disabled={reset.password.length < PASSWORD_MIN}>
                          保存
                        </button>
                        <button type="button" className="btn ghost" onClick={() => setReset(null)}>
                          キャンセル
                        </button>
                      </form>
                    ) : (
                      <span className="row gap">
                        {u.locked ? (
                          <span className="small" style={{ color: "var(--danger)" }}>ロック中</span>
                        ) : u.has_password ? (
                          <span className="small muted">設定済み</span>
                        ) : (
                          <span className="small" style={{ color: "var(--danger)" }}>未設定（ログインできません）</span>
                        )}
                        <button
                          className="btn ghost"
                          title="忘れたとき・ロックされたときに、パスワードを決め直します（ロックも解けます）"
                          onClick={() => setReset({ id: u.id, password: "" })}
                        >
                          再設定
                        </button>
                      </span>
                    )}
                  </td>
                )}
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
                <td colSpan={usePassword ? 4 : 3} className="muted center">
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
          if (form.name.trim() && emailOk && pwOk) add();
        }}
      >
        <strong>企業ユーザーを追加</strong>
        <input placeholder="名前" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input
          type="email"
          placeholder="メールアドレス"
          autoComplete="off"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        {usePassword && (
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`初期パスワード（${PASSWORD_MIN}文字以上）`}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        )}
        <button type="submit" className="btn primary" disabled={!form.name.trim() || !emailOk || !pwOk}>
          追加
        </button>
      </form>
    </div>
  );
}
