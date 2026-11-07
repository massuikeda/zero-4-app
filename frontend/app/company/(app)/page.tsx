"use client";

import Link from "next/link";
import { Badge, Card, Empty, ErrorBox, LinkButton, Loading, PageTitle, date, yen } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { projectStatusLabel } from "@/lib/labels";
import { useCompany } from "@/lib/session";

// 企業ホーム：自社の案件と応募状況
export default function CompanyHome() {
  const { user, company } = useCompany();
  const { data: projects, error, loading, reload } = useApi(() => api.company.projects(), []);

  const count = (fn: (p: NonNullable<typeof projects>[number]) => number) => (projects ?? []).reduce((n, p) => n + fn(p), 0);

  return (
    <>
      <PageTitle
        title={`${user.name} さん、こんにちは`}
        sub={`${company.name}（${company.industry ?? "業種未登録"}）　紹介元：${company.branchName}`}
        action={<LinkButton href="/company/projects/new">＋ 課題を入力する</LinkButton>}
      />

      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading || !projects ? (
        <Loading />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat label="公開中の案件" value={count((p) => (p.status === "published" ? 1 : 0))} />
            <Stat label="未確認の応募" value={count((p) => p.newApplicantCount)} highlight={count((p) => p.newApplicantCount) > 0} />
            <Stat label="契約中" value={count((p) => (p.status === "contracted" ? 1 : 0))} />
          </div>

          <Card>
            <h2 className="mb-4 font-bold">案件</h2>
            {projects.length === 0 ? (
              <Empty>
                まだ案件がありません。<br />
                「課題を入力する」から、困っていることを選んでみてください。
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {projects.map((p) => {
                  const st = projectStatusLabel[p.status];
                  return (
                    <li key={p.id}>
                      <Link href={`/company/projects/${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4 hover:opacity-80">
                        <Badge tone={st.tone}>{st.text}</Badge>
                        <span className="flex-1 font-semibold">{p.publicTitle}</span>
                        <span className="text-sm text-muted">
                          応募 {p.applicantCount}件{p.newApplicantCount > 0 && <span className="ml-1 font-semibold text-accent">（新着 {p.newApplicantCount}）</span>}
                        </span>
                        <span className="text-sm text-muted">{yen(p.monthlyFee)}/月</span>
                        <span className="text-sm text-muted">公開 {date(p.publishedAt)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${highlight ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
}
