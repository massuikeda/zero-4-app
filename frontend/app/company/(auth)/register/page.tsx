"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AppShell";
import { Button, Field, inputClass } from "@/components/ui";
import { api, setToken } from "@/lib/api";

const INDUSTRIES = ["食品製造", "製造", "建設", "小売", "卸売", "宿泊", "飲食", "医療・福祉", "サービス", "その他"];

export default function CompanyRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ code: "", companyName: "", industry: INDUSTRIES[0], userName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const { token } = await api.company.register(form);
      setToken("company", token);
      router.push("/company");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録できませんでした。");
      setSending(false);
    }
  }

  return (
    <AuthShell
      theme="company"
      appName="Zero-4 企業"
      title="企業コードで登録"
      footer={<>登録済みの方は <Link href="/company/login" className="font-semibold text-accent underline">ログイン</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="企業コード" hint="銀行の担当者から受け取ったコードです（お試し用：DEMO01）">
          <input required value={form.code} onChange={set("code")} className={`${inputClass} font-mono uppercase tracking-widest`} />
        </Field>
        <Field label="会社名">
          <input required value={form.companyName} onChange={set("companyName")} className={inputClass} />
        </Field>
        <Field label="業種">
          <select value={form.industry} onChange={set("industry")} className={inputClass}>
            {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="ご担当者名">
          <input required value={form.userName} onChange={set("userName")} className={inputClass} />
        </Field>
        <Field label="メールアドレス">
          <input type="email" required value={form.email} onChange={set("email")} className={inputClass} autoComplete="email" />
        </Field>
        <Field label="パスワード" hint="8文字以上">
          <input type="password" required minLength={8} value={form.password} onChange={set("password")} className={inputClass} autoComplete="new-password" />
        </Field>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={sending}>{sending ? "登録中…" : "登録してマイページを作成"}</Button>
      </form>
    </AuthShell>
  );
}
