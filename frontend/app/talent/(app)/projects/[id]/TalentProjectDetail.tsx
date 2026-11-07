"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, Field, Loading, PageTitle, ScoreMeter, inputClass, yen } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi, useMaster } from "@/lib/hooks";
import { applicationStatusLabel } from "@/lib/labels";
import { useTalent } from "@/lib/session";

// 案件詳細と応募（会社名は伏せる）
export default function TalentProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const me = useTalent();
  const { skillName } = useMaster();
  const { data: p, error, loading, reload } = useApi(() => api.talent.project(id), [id]);
  const [message, setMessage] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "送信できませんでした。");
    }
    setBusy(false);
  }

  if (error) {
    return (
      <>
        <ErrorBox message={error.message} onRetry={reload} />
        <Link href="/talent/projects" className="mt-4 inline-block text-sm text-accent underline">一覧へ戻る</Link>
      </>
    );
  }
  if (loading || !p) return <Loading />;

  const myApp = p.myApplication;

  return (
    <>
      <Link href="/talent/projects" className="text-sm text-muted hover:text-foreground">← 案件一覧</Link>
      <PageTitle title={p.publicTitle ?? ""} sub={`${p.industry ?? ""}の会社　・　会社名は面談が決まると表示されます`} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <dl className="space-y-5">
            <div>
              <dt className="text-sm font-bold text-muted">やりたいこと</dt>
              <dd className="mt-1">{p.publicDescription}</dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-muted">求める人材</dt>
              <dd className="mt-1">{p.aiRequirements}</dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-muted">スキル</dt>
              <dd className="mt-2 flex flex-wrap gap-1">
                {p.skillIds.map((sid) => {
                  const mine = me.skillIds.includes(sid);
                  return <Badge key={sid} tone={mine ? "accent" : "default"}>{mine ? "✓ " : ""}{skillName(sid)}</Badge>;
                })}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-muted">進め方</dt>
              <dd className="mt-1 text-sm">30分の面談 → 準委任で契約 → 隔週の定例で進行。月1回レポートを提出します。</dd>
            </div>
          </dl>
        </Card>

        <aside className="space-y-4">
          <Card>
            <p className="text-2xl font-bold">{yen(p.monthlyFee)}<span className="text-sm font-normal text-muted"> / 月</span></p>
            <p className="mt-1 text-sm text-muted">月{p.hoursPerMonth}時間（定例・報告を含む）・{p.durationMonths}か月</p>
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-1 text-sm text-muted">あなたとのおすすめ度</p>
              <ScoreMeter score={p.score} />
              {p.keywords.length > 0 && <p className="mt-2 text-xs text-accent">合う点：{p.keywords.join("、")}</p>}
            </div>
          </Card>

          {actionError && <ErrorBox message={actionError} />}

          {myApp ? (
            <Card>
              <p className="text-sm font-bold">応募済み</p>
              <div className="mt-2"><Badge tone={applicationStatusLabel[myApp.status].tone}>{applicationStatusLabel[myApp.status].text}</Badge></div>
              {myApp.status === "applied" && (
                <Button variant="secondary" className="mt-4 w-full" disabled={busy} onClick={() => act(() => api.talent.withdraw(myApp.id))}>
                  応募を取り消す
                </Button>
              )}
            </Card>
          ) : p.status !== "published" ? (
            <Card><p className="text-sm text-muted">この案件の募集は終了しました。</p></Card>
          ) : (
            <Card>
              <form onSubmit={(e) => { e.preventDefault(); act(() => api.talent.apply(p.id, message, agreed)); }} className="space-y-4">
                <Field label="応募メッセージ" hint="経験や、この案件でできそうなことを一言。">
                  <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} className={inputClass} />
                </Field>
                <label className="flex gap-2 text-sm">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
                  <span>本業の勤務先と競合しないこと、守秘義務を守ることを確認しました</span>
                </label>
                <Button type="submit" className="w-full" disabled={!agreed || busy}>{busy ? "送信中…" : "この案件に応募する"}</Button>
              </form>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
