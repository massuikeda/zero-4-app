"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { type AuthMode, PASSWORD_MIN, getAuthMode } from "@/lib/auth";
import type { UserRow } from "@/lib/types";

type Guard = (fn: () => Promise<unknown>) => Promise<void>;

/** 企業ユーザー（この企業の人のログイン）。銀行担当者が登録する */
export function CompanyUserManager({
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
      {usePassword && (
        <p className="muted small">
          初期パスワード（{PASSWORD_MIN}文字以上）はここで決めて、本人に伝えてください。本人はログイン後に「パスワード変更」から変えられます。
        </p>
      )}
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
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim() && emailOk && pwOk) add();
        }}
      >
        <strong>企業ユーザーを追加</strong>
        <div className="row gap wrap">
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
        </div>
      </form>
    </div>
  );
}
