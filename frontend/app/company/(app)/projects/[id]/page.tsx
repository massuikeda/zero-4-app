import { Suspense } from "react";
import ProjectDetail from "./ProjectDetail";

// URL の id は画面側（ProjectDetail）で読む。cacheComponents 有効時は Suspense で囲む
export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">読み込み中…</p>}>
      <ProjectDetail />
    </Suspense>
  );
}
