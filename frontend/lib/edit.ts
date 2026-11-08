/** 図の上での編集操作（追加・移動・接続・削除）。どれも新しい Flow を返す（元は変えない）。 */
import { layout, newStep, nextStepId } from "./flow";
import type { Flow, Step } from "./types";

/** まだ位置（row）が決まっていない作業に、今の見た目どおりの位置を確定させる */
export function freezeRows(flow: Flow): Flow {
  if (flow.steps.every((s) => s.row != null)) return flow;
  const lay = layout(flow, { includeEmptyLanes: true });
  return { ...flow, steps: flow.steps.map((s) => ({ ...s, row: lay.placed.get(s.id)?.row ?? 0 })) };
}

const at = (flow: Flow, lane: string, row: number) => flow.steps.find((s) => s.lane === lane && s.row === row);

/** 見た目の順（上から、同じ高さは列の左から）に並べ替える。IDの振り直しや番号付けを自然にするため */
function sortVisual(flow: Flow): Flow {
  const col = new Map(flow.lanes.map((l, i) => [l, i]));
  const steps = [...flow.steps].sort(
    (a, b) => (a.row ?? 0) - (b.row ?? 0) || (col.get(a.lane) ?? 99) - (col.get(b.lane) ?? 99),
  );
  return { ...flow, steps };
}

/** 指定のマスに作業を追加する。from があれば from → 新しい作業 を矢印でつなぐ */
export function addStepAt(
  flow0: Flow, lane: string, row: number, isTobe: boolean, from?: string | null,
): { flow: Flow; id: string } {
  const flow = freezeRows(flow0);
  const id = nextStepId(flow);
  const step: Step = { ...newStep(id, lane, isTobe), row };
  let steps = [...flow.steps, step];
  if (from && steps.some((s) => s.id === from)) {
    steps = steps.map((s) =>
      s.id === from ? { ...s, next: [...s.next, id], next_media: padTo(s.next_media, s.next.length).concat("") } : s,
    );
  }
  const lanes = flow.lanes.includes(lane) ? flow.lanes : [...flow.lanes, lane];
  return { flow: sortVisual({ lanes, steps }), id };
}

/** 選んだ作業のすぐ下に行を空けて作業を追加し、流れの間に差し込む */
export function insertBelow(flow0: Flow, id: string, isTobe: boolean): { flow: Flow; id: string } {
  const flow = freezeRows(flow0);
  const cur = flow.steps.find((s) => s.id === id);
  if (!cur) return { flow, id };
  const row = (cur.row ?? 0) + 1;
  const newId = nextStepId(flow);
  const step: Step = {
    ...newStep(newId, cur.lane, isTobe), row,
    next: cur.type === "判断" ? [] : cur.next,
    next_media: cur.type === "判断" ? [] : cur.next_media,
  };
  const steps = flow.steps.map((s) => {
    const shifted = (s.row ?? 0) >= row ? { ...s, row: (s.row ?? 0) + 1 } : s; // 下の行を1つずつ下げる
    if (s.id !== id) return shifted;
    return cur.type === "判断"
      ? { ...shifted, next: [...s.next, newId], next_media: padTo(s.next_media, s.next.length).concat("") }
      : { ...shifted, next: [newId], next_media: [""], condition_labels: [] };
  });
  return { flow: sortVisual({ ...flow, steps: [...steps, step] }), id: newId };
}

/** 作業を別のマスへ移動。移動先に作業があれば入れ替える */
export function moveStep(flow0: Flow, id: string, lane: string, row: number): Flow {
  const flow = freezeRows(flow0);
  const cur = flow.steps.find((s) => s.id === id);
  if (!cur) return flow;
  const other = at(flow, lane, row);
  const steps = flow.steps.map((s) => {
    if (s.id === id) return { ...s, lane, row };
    if (other && s.id === other.id) return { ...s, lane: cur.lane, row: cur.row };
    return s;
  });
  const lanes = flow.lanes.includes(lane) ? flow.lanes : [...flow.lanes, lane];
  return sortVisual({ lanes, steps });
}

/** 矢印を追加（すでにあれば何もしない） */
export function connect(flow: Flow, from: string, to: string): Flow {
  if (from === to) return flow;
  return {
    ...flow,
    steps: flow.steps.map((s) =>
      s.id !== from || s.next.includes(to)
        ? s
        : {
            ...s,
            next: [...s.next, to],
            next_media: padTo(s.next_media, s.next.length).concat(""),
            condition_labels: s.condition_labels.length ? padTo(s.condition_labels, s.next.length).concat("") : [],
          },
    ),
  };
}

/** 矢印を削除 */
export function disconnect(flow: Flow, from: string, to: string): Flow {
  return {
    ...flow,
    steps: flow.steps.map((s) => {
      if (s.id !== from) return s;
      const k = s.next.indexOf(to);
      if (k < 0) return s;
      const drop = <T,>(a: T[]) => a.filter((_, i) => i !== k);
      return { ...s, next: drop(s.next), next_media: drop(s.next_media), condition_labels: drop(s.condition_labels) };
    }),
  };
}

/** 矢印の受け渡し手段・分岐ラベルを変える */
export function updateEdge(flow: Flow, from: string, to: string, patch: { media?: string; label?: string }): Flow {
  return {
    ...flow,
    steps: flow.steps.map((s) => {
      if (s.id !== from) return s;
      const k = s.next.indexOf(to);
      if (k < 0) return s;
      const media = padTo(s.next_media, s.next.length);
      const labels = padTo(s.condition_labels, s.next.length);
      if (patch.media !== undefined) media[k] = patch.media;
      if (patch.label !== undefined) labels[k] = patch.label;
      return { ...s, next_media: media, condition_labels: labels.some(Boolean) ? labels : [] };
    }),
  };
}

/** 作業を削除。その作業を通っていた流れは、前後をつなぎ直す */
export function removeStep(flow: Flow, id: string): Flow {
  const gone = flow.steps.find((s) => s.id === id);
  if (!gone) return flow;
  const steps = flow.steps
    .filter((s) => s.id !== id)
    .map((s) => {
      const k = s.next.indexOf(id);
      if (k < 0) return s;
      const next: string[] = [];
      const media: string[] = [];
      const labels: string[] = [];
      s.next.forEach((n, i) => {
        if (n === id) {
          gone.next.forEach((g, gi) => {
            if (g !== s.id && !next.includes(g)) {
              next.push(g);
              media.push(gone.next_media[gi] ?? s.next_media[i] ?? "");
              labels.push(s.condition_labels[i] ?? "");
            }
          });
        } else {
          next.push(n);
          media.push(s.next_media[i] ?? "");
          labels.push(s.condition_labels[i] ?? "");
        }
      });
      return { ...s, next, next_media: media, condition_labels: labels.some(Boolean) ? labels : [] };
    });
  return { ...flow, steps };
}

export function updateStep(flow: Flow, id: string, patch: Partial<Step>): Flow {
  return { ...flow, steps: flow.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** 列（担当）を追加・削除・並べ替え */
export function addLane(flow: Flow, name: string): Flow {
  const n = name.trim();
  return n && !flow.lanes.includes(n) ? { ...flow, lanes: [...flow.lanes, n] } : flow;
}
export function removeLane(flow: Flow, name: string): Flow {
  return { ...flow, lanes: flow.lanes.filter((l) => l !== name) };
}
export function moveLane(flow: Flow, name: string, d: -1 | 1): Flow {
  const lanes = [...flow.lanes];
  const i = lanes.indexOf(name);
  const j = i + d;
  if (i < 0 || j < 0 || j >= lanes.length) return flow;
  [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  return { ...flow, lanes };
}

function padTo(a: string[], n: number): string[] {
  const r = a.slice(0, n);
  while (r.length < n) r.push("");
  return r;
}
