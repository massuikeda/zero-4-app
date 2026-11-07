"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AppShell";
import { Button, Field, inputClass } from "@/components/ui";
import { api, setToken } from "@/lib/api";

export default function TalentLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const { token } = await api.talent.login(email, password);
      setToken("talent", token);
      router.push("/talent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインできませんでした。");
      setSending(false);
    }
  }

  return (
    <AuthShell
      theme="talent"
      appName="Zero-4 人材"
      title="IT人材ログイン"
      footer={<>はじめての方は <Link href="/talent/register" className="font-semibold text-accent underline">新規登録</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="メールアドレス">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" />
        </Field>
        <Field label="パスワード">
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="current-password" />
        </Field>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={sending}>{sending ? "ログイン中…" : "ログイン"}</Button>
        <p className="rounded-lg bg-background px-3 py-2 text-xs text-muted">
          お試し用：<code>t1@example.com</code> / <code>t2@example.com</code> / <code>t3@example.com</code>、パスワード <code>password123</code>
        </p>
      </form>
    </AuthShell>
  );
}
