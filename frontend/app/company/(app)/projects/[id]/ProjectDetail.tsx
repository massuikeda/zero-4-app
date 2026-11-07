"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageTitle, ScoreMeter, yen } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi, useMaster } from "@/lib/hooks";
import { applicationStatusLabel, projectStatusLabel } from "@/lib/labels";
import type { TalentCard } from "@/lib/types";

// 案件詳細：応募者一覧（おすすめ度つき）と、おすすめ人材（TF-IDF）
export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { skillName, issueOptions } = useMaster();
  const { data, error, loading, reload } = useApi(() => api.company.project(id), [id]);
  const [tab, setTab] = useState<"applicants" | "recommend">("applicants");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "更新できませんでした。");
    }
    setBusy(false);
  }

  if (error) {
    return (
      <>
        <ErrorBox message={error.message} onRetry={reload} />
        <Link href="/company" className="mt-4 inline-block text-sm text-accent underline">ホームへ戻る</Link>
      </>
    );
  }
  if (loading || !data) return <Loading />;

  const { project, applicants, recommended } = data;
  const st = projectStatusLabel[project.status];
  const skillBadges = (ids: number[], tone: "default" | "accent" = "default") =>
    ids.map((i) => <Badge key={i} tone={tone}>{skillName(i)}</Badge>);

  return (
    <>
      <Link href="/company" className="text-sm text-muted hover:text-foreground">← ホーム</Link>
      <PageTitle
        title={project.publicTitle ?? "（タイトル未設定）"}
        sub={`${yen(project.monthlyFee)}/月　・　月${project.hoursPerMonth}時間　・　${project.durationMonths}か月`}
        action={<Badge tone={st.tone}>{st.text}</Badge>}
      />
      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="mb-4 flex gap-1 border-b border-line">
            <TabButton on={tab === "applicants"} onClick={() => setTab("applicants")}>応募者（{applicants.length}）</TabButton>
            <TabButton on={tab === "recommend"} onClick={() => setTab("recommend")}>おすすめ人材（{recommended.length}）</TabButton>
          </div>

          {tab === "applicants" && (
            applicants.length === 0 ? (
              <Empty>まだ応募はありません。公開後、人材からの応募がここに表示されます。</Empty>
            ) : (
              <ul className="space-y-3">
                {applicants.map((a) => {
                  const as = applicationStatusLabel[a.status];
                  return (
                    <li key={a.applicationId}>
                      <Card>
                        <TalentHeader t={a.talent} score={a.score} badge={<Badge tone={as.tone}>{as.text}</Badge>} skills={skillBadges(a.talent.skillIds)} />
                        {a.keywords.length > 0 && <p className="mt-3 text-xs text-muted">マッチ理由：{a.keywords.join("、")}</p>}
                        <p className="mt-3 rounded-lg bg-background p-3 text-sm">{a.message || "（メッセージなし）"}</p>
                        {a.status === "applied" && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button disabled={busy} onClick={() => act(() => api.company.setApplicationStatus(a.applicationId, "interview"))}>30分面談を申し込む</Button>
                            <Button variant="secondary" disabled={busy} onClick={() => act(() => api.company.setApplicationStatus(a.applicationId, "rejected"))}>見送る</Button>
                          </div>
                        )}
                        {a.status === "interview" && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button disabled={busy} onClick={() => act(() => api.company.setApplicationStatus(a.applicationId, "selected"))}>この方に決める</Button>
                            <Button variant="secondary" disabled={busy} onClick={() => act(() => api.company.setApplicationStatus(a.applicationId, "rejected"))}>見送る</Button>
                          </div>
                        )}
                        {a.status === "selected" && (
                          <p className="mt-4 text-sm font-semibold text-accent">選定済み — 次は契約（準委任）の手続きです。</p>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )
          )}

          {tab === "recommend" && (
            recommended.length === 0 ? (
              <Empty>条件に合う人材がまだいません。求めるスキルを見直すと見つかることがあります。</Empty>
            ) : (
              <ul className="space-y-3">
                {recommended.map((r) => (
                  <li key={r.talent.id}>
                    <Card>
                      <TalentHeader t={r.talent} score={r.score} skills={skillBadges(r.talent.skillIds)} />
                      {r.talent.bio && <p className="mt-2 text-sm text-muted">{r.talent.bio}</p>}
                      <p className="mt-3 text-xs text-muted">マッチ理由：{r.keywords.join("、") || "—"}</p>
                    </Card>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-bold">人材に公開している内容</h2>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-muted">やりたいこと</dt><dd>{project.publicDescription}</dd></div>
              <div><dt className="text-muted">求める人材</dt><dd>{project.aiRequirements}</dd></div>
              <div>
                <dt className="text-muted">スキル</dt>
                <dd className="mt-1 flex flex-wrap gap-1">{skillBadges(project.skillIds, "accent")}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 text-sm font-bold">社内メモ（非公開）</h2>
            <p className="text-sm">{project.aiSummary}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {project.issueOptionIds.map((i) => (
                <Badge key={i} tone="muted">{issueOptions.find((o) => o.id === i)?.label}</Badge>
              ))}
            </div>
          </Card>
          {project.status === "published" && (
            <Button variant="secondary" className="w-full" disabled={busy} onClick={() => act(() => api.company.closeProject(project.id))}>
              募集を終了する
            </Button>
          )}
        </aside>
      </div>
    </>
  );
}

function TalentHeader({ t, score, badge, skills }: { t: TalentCard; score: number; badge?: React.ReactNode; skills: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-bold">{t.displayName} <span className="text-sm font-normal text-muted">／ {t.mainJob || "本業未登録"}</span></p>
        <div className="mt-1 flex flex-wrap gap-1">{skills}</div>
      </div>
      <div className="flex items-center gap-3">
        <ScoreMeter score={score} />
        {badge}
      </div>
    </div>
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm ${on ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}
