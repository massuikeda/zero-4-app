"use client";

import { ProjectCard } from "@/components/ProjectCard";
import { Empty, ErrorBox, LinkButton, Loading, PageTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useTalent } from "@/lib/session";

// 人材ホーム：おすすめ案件（TF-IDF のスコア順）
export default function TalentHome() {
  const me = useTalent();
  const { data, error, loading, reload } = useApi(() => api.talent.recommendations(), []);
  const profileEmpty = me.skillIds.length === 0 || !me.bio;

  return (
    <>
      <PageTitle title="あなたへのおすすめ案件" sub="プロフィールとスキルに近い順に並んでいます。" />

      {profileEmpty && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent bg-accent-soft p-4">
          <p className="text-sm">
            <span className="font-bold text-accent">プロフィールを書くと、おすすめが出るようになります。</span>
            <br />スキルと自己紹介を登録してください。
          </p>
          <LinkButton href="/talent/profile">プロフィールを書く</LinkButton>
        </div>
      )}

      {error ? (
        <ErrorBox message={error.message} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>
          おすすめできる案件がまだありません。<br />
          「案件をさがす」からすべての案件を見られます。
        </Empty>
      ) : (
        <div className="space-y-3">
          {data.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}
    </>
  );
}
