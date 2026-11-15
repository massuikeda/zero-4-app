/**
 * AIの改善案（どの作業を、どう変えるか）を AS-IS に当てはめて、TO-BE の図にする。
 *
 * AIが出すのは変更の一覧だけ。図は、ここにある決まったルールで作る：
 * - AS-ISをコピーする（作業IDはそのまま。比較タブで「変更前」と結び付けるため）
 * - 排除 … 作業を消し、前後の矢印をつなぎ直す
 * - それ以外 … 変更区分の札を付け、作業名・時間・道具・渡し方を書き換える
 */
import { removeStep, updateStep } from "./edit";
import { classifyTool, normalize } from "./flow";
import type { Flow, Resource, Step, TobeChange } from "./types";

export interface TobeResult {
  flow: Flow;
  /** 当てはめた変更の数（区分ごと） */
  counts: Record<string, number>;
  applied: number;
}

export function applyTobeChanges(
  asis: Flow,
  changes: TobeChange[],
  resources: Resource[] = [],
  /** この案の説明（図と一緒に保存する） */
  info: { summary?: string; needs?: string[]; cost_items?: string[] } = {},
): TobeResult {
  // AS-ISをコピー（「AS-ISをコピーして作成」と同じく、変更区分と補足は空から始める）
  let flow: Flow = normalize({
    summary: info.summary ?? "",
    needs: info.needs ?? [],
    cost_items: info.cost_items ?? [],
    lanes: [...asis.lanes],
    steps: asis.steps.map((s) => ({ ...s, change: null, note: "", next: [...s.next], next_media: [...s.next_media] })),
  });
  const counts: Record<string, number> = {};
  let applied = 0;

  for (const c of changes) {
    const cur = flow.steps.find((s) => s.id === c.id);
    if (!cur) continue; // すでに消した作業・AS-ISにない作業
    if (c.action === "排除") {
      flow = removeStep(flow, c.id);
      // 図から消える作業なので、なくす理由は案のほうに残す（比較タブに出す）
      if (c.note) flow = { ...flow, removed_notes: { ...flow.removed_notes, [c.id]: c.note } };
    } else {
      const patch: Partial<Step> = { change: c.action, note: c.note ?? "" };
      if (c.name) patch.name = c.name;
      if (typeof c.minutes === "number") patch.minutes = c.minutes;
      if (c.tool) {
        patch.tool = c.tool;
        // 道具がシステムやExcelなどに変わったら、PC作業の印を付ける（紙・手書きなら外す）
        const kind = classifyTool(c.tool, resources);
        patch.pc = kind === "paper" || kind === "handwritten" ? false : kind !== "other" || cur.pc;
      }
      if (c.media) patch.next_media = cur.next.map(() => c.media as string);
      if (c.issue_resolved) {
        patch.issue = null;
        patch.issue_time = "";
        patch.issue_error = "";
        patch.issue_detail = "";
      }
      flow = updateStep(flow, c.id, patch);
    }
    counts[c.action] = (counts[c.action] ?? 0) + 1;
    applied += 1;
  }
  return { flow, counts, applied };
}
