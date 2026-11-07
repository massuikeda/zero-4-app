"use client";

import { useDeferredValue, useState } from "react";
import { ProjectCard } from "@/components/ProjectCard";
import { Empty, ErrorBox, Loading, PageTitle, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi, useMaster } from "@/lib/hooks";

// 案件一覧（公開中のみ・会社名は伏せる）
export default function TalentProjectsPage() {
  const { skills } = useMaster();
  const [q, setQ] = useState("");
  const [skillId, setSkillId] = useState(0);
  const [sort, setSort] = useState<"new" | "match" | "fee">("new");
  const query = useDeferredValue(q); // 入力のたびに API を呼びすぎないように

  const { data, error, loading, reload } = useApi(
    () => api.talent.projects({ q: query, skillId, sort }),
    [query, skillId, sort],
  );

  return (
    <>
      <PageTitle
        title="案件をさがす"
        sub={`公開中 ${data?.length ?? "—"}件　※会社名は面談が決まるまで表示されません`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-[1fr_180px_160px]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="キーワード（例：kintone、SNS）" className={inputClass} aria-label="キーワード" />
        <select value={skillId} onChange={(e) => setSkillId(Number(e.target.value))} className={inputClass} aria-label="スキル">
          <option value={0}>すべてのスキル</option>
          {skills.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={inputClass} aria-label="並び順">
          <option value="new">新しい順</option>
          <option value="match">おすすめ度順</option>
          <option value="fee">報酬が高い順</option>
        </select>
      </div>

      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <Empty>条件に合う案件がありません。</Empty>
      ) : (
        <div className="space-y-3">
          {data.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}
    </>
  );
}
