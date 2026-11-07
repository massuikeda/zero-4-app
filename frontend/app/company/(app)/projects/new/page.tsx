"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorBox, Field, PageTitle, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useMaster } from "@/lib/hooks";
import type { AiDraft } from "@/lib/types";

// 課題入力 → AIが要件案を作成 → 確認・修正して公開
export default function NewProjectPage() {
  const router = useRouter();
  const { issueOptions, skills } = useMaster();

  const [issueIds, setIssueIds] = useState<number[]>([]);
  const [freeText, setFreeText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [fee, setFee] = useState(50000);
  const [months, setMonths] = useState(3);

  const categories = [...new Set(issueOptions.map((o) => o.category))];
  const toggle = (id: number, list: number[], setList: (v: number[]) => void) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function runAi() {
    setLoading(true);
    setError("");
    try {
      setDraft(await api.company.aiDraft(issueIds, freeText));
    } catch (e) {
      setError(e instanceof Error ? e.message : "要件案を作れませんでした。");
    }
    setLoading(false);
  }

  async function save(status: "generated" | "published") {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const p = await api.company.createProject({
        status, issueOptionIds: issueIds, issueFreeText: freeText,
        aiSummary: draft.summary, aiRequirements: draft.requirements,
        publicTitle: draft.title, publicDescription: draft.description, skillIds: draft.skillIds,
        durationMonths: months, monthlyFee: fee,
      });
      router.push(`/company/projects/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした。");
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle title="課題を入力する" sub="当てはまるものを選び、気になっていることを書いてください。AIが人材の要件にまとめます。" />

      {error && <div className="mb-6"><ErrorBox message={error} /></div>}

      <ol className="mb-6 flex flex-wrap gap-2 text-xs font-semibold">
        <Step n={1} label="課題を選ぶ・書く" active={!draft} />
        <Step n={2} label="AIの要件案を確認" active={!!draft} />
        <Step n={3} label="公開" active={false} />
      </ol>

      {/* STEP 1 */}
      <Card className={draft ? "opacity-60" : ""}>
        <div className="space-y-6">
          {categories.map((cat) => (
            <fieldset key={cat}>
              <legend className="mb-2 text-sm font-bold">{cat}</legend>
              <div className="flex flex-wrap gap-2">
                {issueOptions.filter((o) => o.category === cat).map((o) => {
                  const on = issueIds.includes(o.id);
                  return (
                    <button
                      type="button" key={o.id} disabled={!!draft}
                      onClick={() => toggle(o.id, issueIds, setIssueIds)}
                      className={`rounded-full border px-4 py-2 text-sm transition ${
                        on ? "border-accent bg-accent text-white" : "border-line bg-surface hover:border-accent"
                      }`}
                      aria-pressed={on}
                    >
                      {on ? "✓ " : ""}{o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <Field label="気になっていること（自由記述）" hint="うまく書けなくても大丈夫です。箇条書きでも構いません。">
            <textarea
              rows={4} value={freeText} disabled={!!draft} onChange={(e) => setFreeText(e.target.value)}
              placeholder="例）受注をFAXで受けて、手でExcelに打ち直している。月末の集計に丸2日かかる。"
              className={inputClass}
            />
          </Field>
          {!draft && (
            <Button onClick={runAi} disabled={loading || (issueIds.length === 0 && !freeText.trim())}>
              {loading ? "AIが要件をまとめています…" : "AIで要件をまとめる"}
            </Button>
          )}
        </div>
      </Card>

      {/* STEP 2 */}
      {draft && (
        <Card className="mt-6 border-accent">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold">AIの要件案</h2>
            <Button variant="ghost" onClick={() => setDraft(null)}>← 入力に戻る</Button>
          </div>
          <div className="space-y-5">
            <div className="rounded-lg bg-accent-soft p-4 text-sm">
              <p className="mb-1 font-bold text-accent">課題の要約（社内向け・公開されません）</p>
              <p>{draft.summary}</p>
            </div>
            <Field label="案件タイトル（公開）" hint="会社名は人材に表示されません。">
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputClass} />
            </Field>
            <Field label="やりたいこと（公開）">
              <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} />
            </Field>
            <Field label="求める人材（公開）">
              <textarea rows={3} value={draft.requirements} onChange={(e) => setDraft({ ...draft, requirements: e.target.value })} className={inputClass} />
            </Field>
            <div>
              <p className="mb-2 text-sm font-semibold">求めるスキル</p>
              <div className="flex flex-wrap gap-2">
                {skills.map((sk) => {
                  const on = draft.skillIds.includes(sk.id);
                  return (
                    <button
                      type="button" key={sk.id}
                      onClick={() => toggle(sk.id, draft.skillIds, (v) => setDraft({ ...draft, skillIds: v }))}
                      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted"}`}
                    >
                      {sk.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="委託料（月額・円）">
                <input type="number" min={0} step={5000} value={fee} onChange={(e) => setFee(Number(e.target.value))} className={inputClass} />
              </Field>
              <Field label="期間">
                <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className={inputClass}>
                  {[1, 2, 3].map((m) => <option key={m} value={m}>{m}か月</option>)}
                </select>
              </Field>
              <Field label="稼働時間">
                <input value="月10時間" disabled className={`${inputClass} bg-background`} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-line pt-5">
              <Button onClick={() => save("published")} disabled={saving || !draft.title.trim()}>
                {saving ? "保存中…" : "人材に公開する"}
              </Button>
              <Button variant="secondary" onClick={() => save("generated")} disabled={saving}>下書き保存</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function Step({ n, label, active }: { n: number; label: string; active: boolean }) {
  return (
    <li className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${active ? "bg-accent text-white" : "bg-surface text-muted border border-line"}`}>
      <span>{n}</span>
      <span>{label}</span>
    </li>
  );
}
