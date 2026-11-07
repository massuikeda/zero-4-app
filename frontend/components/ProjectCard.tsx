"use client";

// 人材向けの案件カード（会社名は出さない。業種まで）

import Link from "next/link";
import { Badge, ScoreMeter, yen } from "@/components/ui";
import { useMaster } from "@/lib/hooks";
import type { PublicProject } from "@/lib/types";

export function ProjectCard({ p }: { p: PublicProject }) {
  const { skillName } = useMaster();
  return (
    <Link href={`/talent/projects/${p.id}`} className="block rounded-xl border border-line bg-surface p-5 transition hover:border-accent">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">{p.industry ?? "業種非公開"}</Badge>
            {p.applied && <Badge tone="accent">応募済み</Badge>}
          </div>
          <p className="mt-2 text-lg font-bold">{p.publicTitle}</p>
        </div>
        <ScoreMeter score={p.score} />
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-muted">{p.publicDescription}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-semibold">{yen(p.monthlyFee)}/月</span>
        <span className="text-muted">月{p.hoursPerMonth}時間・{p.durationMonths}か月</span>
        <span className="flex flex-wrap gap-1">
          {p.skillIds.map((id) => <Badge key={id}>{skillName(id)}</Badge>)}
        </span>
      </div>
      {p.keywords.length > 0 && <p className="mt-3 text-xs text-accent">あなたと合う点：{p.keywords.join("、")}</p>}
    </Link>
  );
}
