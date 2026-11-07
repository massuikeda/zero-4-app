"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AppShell";
import { Button, Field, inputClass } from "@/components/ui";
import { api, setToken } from "@/lib/api";

export default function TalentRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const { token } = await api.talent.register(form);
      setToken("talent", token);
      router.push("/talent/profile"); // 登録後はまずプロフィールを書いてもらう
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録できませんでした。");
      setSending(false);
    }
  }

  return (
    <AuthShell
      theme="talent"
      appName="Zero-4 人材"
      title="IT人材の新規登録"
      footer={<>登録済みの方は <Link href="/talent/login" className="font-semibold text-accent underline">ログイン</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="お名前">
          <input required value={form.name} onChange={set("name")} className={inputClass} autoComplete="name" />
        </Field>
        <Field label="メールアドレス">
          <input type="email" required value={form.email} onChange={set("email")} className={inputClass} autoComplete="email" />
        </Field>
        <Field label="パスワード" hint="8文字以上">
          <input type="password" required minLength={8} value={form.password} onChange={set("password")} className={inputClass} autoComplete="new-password" />
        </Field>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={sending}>{sending ? "登録中…" : "登録してプロフィールへ"}</Button>
      </form>
    </AuthShell>
  );
}
