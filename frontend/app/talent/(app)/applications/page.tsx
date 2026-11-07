"use client";

import Link from "next/link";
import { Badge, Card, Empty, ErrorBox, Loading, PageTitle, date, yen } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { applicationStatusLabel } from "@/lib/labels";

// 応募状況
export default function TalentApplicationsPage() {
  const { data, error, loading, reload } = useApi(() => api.talent.applications(), []);

  return (
    <>
      <PageTitle title="応募状況" sub="企業が面談を申し込むと「面談予定」になります。" />
      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>まだ応募していません。<Link href="/talent" className="text-accent underline">おすすめ案件を見る</Link></Empty>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {data.map((a) => {
              const st = applicationStatusLabel[a.status];
              return (
                <li key={a.id}>
                  <Link href={`/talent/projects/${a.projectId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-background">
                    <Badge tone={st.tone}>{st.text}</Badge>
                    <span className="flex-1 font-semibold">{a.publicTitle}</span>
                    <span className="text-sm text-muted">{yen(a.monthlyFee)}/月</span>
                    <span className="text-sm text-muted">応募 {date(a.appliedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
