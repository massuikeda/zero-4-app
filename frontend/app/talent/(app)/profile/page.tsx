"use client";

import { useState } from "react";
import { Button, Card, ErrorBox, Field, PageTitle, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useMaster } from "@/lib/hooks";
import { useTalent } from "@/lib/session";

// プロフィール（マッチングに使う文章とスキル）
export default function TalentProfilePage() {
  const me = useTalent();
  const { skills } = useMaster();
  const [form, setForm] = useState({
    displayName: me.displayName ?? me.name,
    mainJob: me.mainJob ?? "",
    bio: me.bio ?? "",
    availableHoursMonth: me.availableHoursMonth,
    skillIds: me.skillIds,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const categories = [...new Set(skills.map((x) => x.category ?? "その他"))];
  const toggleSkill = (id: number) =>
    setForm({ ...form, skillIds: form.skillIds.includes(id) ? form.skillIds.filter((x) => x !== id) : [...form.skillIds, id] });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.talent.updateMe(form);
      me.refresh(); // ヘッダーやおすすめに反映
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした。");
    }
    setSaving(false);
  }

  return (
    <>
      <PageTitle title="プロフィール" sub="ここに書いた内容とスキルで、合う案件を探します（TF-IDF）。" />
      <form onSubmit={submit}>
        <Card>
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="表示名" hint="企業に表示される名前です。">
                <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className={inputClass} />
              </Field>
              <Field label="本業" hint="競合の確認に使います（例：製造業の情報システム部）">
                <input value={form.mainJob} onChange={(e) => setForm({ ...form, mainJob: e.target.value })} className={inputClass} />
              </Field>
            </div>
            <Field label="自己紹介・経験" hint="使ったツールや、やってきたことを具体的に書くと、おすすめの精度が上がります。">
              <textarea rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className={inputClass} />
            </Field>
            <div>
              <p className="mb-2 text-sm font-semibold">スキル</p>
              <div className="space-y-3">
                {categories.map((cat) => (
                  <div key={cat} className="flex flex-wrap items-center gap-2">
                    <span className="w-20 text-xs text-muted">{cat}</span>
                    {skills.filter((x) => (x.category ?? "その他") === cat).map((sk) => {
                      const on = form.skillIds.includes(sk.id);
                      return (
                        <button
                          type="button" key={sk.id} onClick={() => toggleSkill(sk.id)} aria-pressed={on}
                          className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-white" : "border-line hover:border-accent"}`}
                        >
                          {sk.name}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <Field label="稼働できる時間（月）">
              <select
                value={form.availableHoursMonth}
                onChange={(e) => setForm({ ...form, availableHoursMonth: Number(e.target.value) })}
                className={`${inputClass} sm:w-48`}
              >
                {[5, 10, 15, 20].map((h) => <option key={h} value={h}>{h}時間</option>)}
              </select>
            </Field>
            {error && <ErrorBox message={error} />}
            <div className="flex items-center gap-3 border-t border-line pt-5">
              <Button type="submit" disabled={saving}>{saving ? "保存中…" : "保存する"}</Button>
              {saved && <span className="text-sm font-semibold text-accent">保存しました</span>}
            </div>
          </div>
        </Card>
      </form>
    </>
  );
}
