import { Suspense } from "react";
import TalentProjectDetail from "./TalentProjectDetail";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">読み込み中…</p>}>
      <TalentProjectDetail />
    </Suspense>
  );
}
