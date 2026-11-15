"use client";

import { useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { api } from "@/lib/api";
import { PASSWORD_MIN } from "@/lib/auth";

const MIN = PASSWORD_MIN;

/** 自分のパスワードを変える（AUTH_MODE=password のとき）。変えると、ほかの端末のログインは切れる */
export default function PasswordPage() {
  const me = useMe();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!me) return <p className="muted">読み込み中…</p>;

  const problem =
    form.next.length > 0 && form.next.length < MIN
      ? `${MIN}文字以上にしてください`
      : form.again && form.next !== form.again
        ? "確認用のパスワードが一致しません"
        : null;
  const canSave = !!form.current && form.next.length >= MIN && form.next === form.again && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.changePassword(form.current, form.next);
      setForm({ current: "", next: "", again: "" });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "トップ", href: "/" }, { label: "パスワード変更" }]} />
      <h1>パスワード変更</h1>
      <p className="muted small">
        {MIN}文字以上にしてください。変更すると、ほかのパソコンやブラウザでのログインは切れます（この画面はそのまま使えます）。
      </p>
      {error && <div className="alert">{error}</div>}
      {done && <div className="notice">パスワードを変更しました。</div>}
      <form
        className="card stack"
        style={{ maxWidth: 420 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
      >
        {/* パスワード管理ツールが、どのアカウントのパスワードか分かるように */}
        <input type="email" autoComplete="username" value={me.email} readOnly hidden />
        <label className="login-field">
          <span className="small muted">いまのパスワード</span>
          <input
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
        </label>
        <label className="login-field">
          <span className="small muted">新しいパスワード</span>
          <input
            type="password"
            autoComplete="new-password"
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
          />
        </label>
        <label className="login-field">
          <span className="small muted">新しいパスワード（確認）</span>
          <input
            type="password"
            autoComplete="new-password"
            value={form.again}
            onChange={(e) => setForm({ ...form, again: e.target.value })}
          />
        </label>
        {problem && <p className="error">{problem}</p>}
        <div>
          <button type="submit" className="btn primary" disabled={!canSave}>
            {busy ? "変更しています…" : "変更する"}
          </button>
        </div>
      </form>
    </div>
  );
}
