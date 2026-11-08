/** 決まったフォーマットのフローから、図の配置・道具の分類・集計を作る */
import type { Comparison, Flow, Resource, Step } from "./types";

// ---------------- 道具（色付きの札）の分類 ----------------
export type ToolKind = "excel" | "handwritten" | "paper" | "fax" | "system" | "other";

export const TOOL_STYLE: Record<ToolKind, { bar: string; bg: string; fg: string }> = {
  excel: { bar: "#1f6f43", bg: "#e8f3ec", fg: "#1f6f43" },
  handwritten: { bar: "#b7791f", bg: "#fdf6e9", fg: "#b7791f" },
  paper: { bar: "#7a5230", bg: "#f6efe8", fg: "#6b4526" },
  fax: { bar: "#455a64", bg: "#eceff1", fg: "#37474f" },
  system: { bar: "#1565c0", bg: "#e7f0fa", fg: "#1565c0" },
  other: { bar: "#78909c", bg: "#f2f4f5", fg: "#455a64" },
};

export function classifyTool(tool: string, resources: Resource[] = []): ToolKind {
  if (!tool) return "other";
  if (/excel|エクセル|xls/i.test(tool)) return "excel";
  if (/手書き/.test(tool)) return "handwritten";
  if (/fax/i.test(tool)) return "fax";
  if (/紙|伝票|帳票|印刷|書類|注文書/.test(tool)) return "paper";
  const r = resources.find((x) => x.name === tool);
  if (r?.kind === "帳票") return "paper";
  if (r?.kind === "システム" || /システム|kintone|sap|クラウド/i.test(tool)) return "system";
  return "other";
}

export const isPaper = (tool: string, resources: Resource[] = []) => {
  const k = classifyTool(tool, resources);
  return k === "paper" || k === "handwritten";
};

// ---------------- 受け渡し手段（矢印のラベル）の色 ----------------
export function mediaColor(media: string): string {
  if (/メール/.test(media)) return "#1e63e9";
  if (/fax/i.test(media)) return "#37474f";
  if (/配達|郵送|手渡し/.test(media)) return "#8a5a2b";
  if (/電話|口頭/.test(media)) return "#2e7d32";
  if (/システム|連携|自動/.test(media)) return "#00838f";
  return "#6b7385";
}

// ---------------- 決まった3つの集計 ----------------
export interface Counters {
  manual: number; // 手入力・転記の回数
  mail: number; // メール連絡の回数
  paper: number; // 紙を使う箇所
}

export function counters(flow: Flow, resources: Resource[] = []): Counters {
  return {
    manual: flow.steps.filter((s) => s.manual_input).length,
    mail: flow.steps.reduce(
      (n, s) => n + s.next.filter((_, i) => /メール/.test(s.next_media[i] ?? "")).length,
      0,
    ),
    paper: flow.steps.filter((s) => isPaper(s.tool, resources)).length,
  };
}

/** ボトルネック（課題）のあるステップに、図の上から順（同じ高さなら左から）に番号を振る */
export function bottleneckNumbers(flow: Flow, lay: Layout = layout(flow)): Map<string, number> {
  const m = new Map<string, number>();
  [...lay.placed.values()]
    .filter((p) => p.step.issue)
    .sort((a, b) => a.row - b.row || a.col - b.col || a.index - b.index)
    .forEach((p) => m.set(p.step.id, m.size + 1));
  return m;
}

// ---------------- 自動レイアウト ----------------
// 列 = 担当（スイムレーン）、行 = 上から順。
// 別の列への受け渡しはなるべく同じ行（横向きの矢印）に置き、同じ列の続きは1行下に置く。
export interface Placed {
  step: Step;
  index: number;
  col: number;
  row: number;
}
export interface Layout {
  lanes: string[];
  placed: Map<string, Placed>;
  rows: number;
}

export const laneOf = (s: Step) => s.lane || "（未設定）";

export function layout(flow: Flow, opts: { includeEmptyLanes?: boolean } = {}): Layout {
  const used = new Set(flow.steps.map(laneOf));
  const lanes = [...new Set([...flow.lanes, ...flow.steps.map(laneOf)])].filter(
    (l) => opts.includeEmptyLanes || used.has(l),
  );
  const colOf = new Map(lanes.map((l, i) => [l, i]));
  const indexOf = new Map(flow.steps.map((s, i) => [s.id, i]));
  const preds = new Map<string, string[]>();
  flow.steps.forEach((s) =>
    s.next.forEach((n) => {
      if (!preds.has(n)) preds.set(n, []);
      preds.get(n)!.push(s.id);
    }),
  );

  const placed = new Map<string, Placed>();
  const node = new Set<string>(); // "col:row" にステップがある
  const through = new Set<string>(); // 横向きの矢印が通るマス
  const lastRow = lanes.map(() => -1);
  const key = (c: number, r: number) => `${c}:${r}`;

  // 1) 位置が決まっている作業（図の上で動かしたもの）を先に置く
  flow.steps.forEach((s, i) => {
    if (s.row == null) return;
    const c = colOf.get(laneOf(s))!;
    let r = s.row;
    while (node.has(key(c, r))) r++; // 万一重なっていたら下にずらす
    placed.set(s.id, { step: s, index: i, col: c, row: r });
    node.add(key(c, r));
  });

  // 2) 位置が未設定の作業を、流れに沿って自動で置く
  flow.steps.forEach((s, i) => {
    if (placed.has(s.id)) return;
    const c = colOf.get(laneOf(s))!;
    // 前のステップ（並び順で先にあるもの）
    const ps = (preds.get(s.id) ?? [])
      .filter((p) => (indexOf.get(p) ?? Infinity) < i && placed.has(p))
      .map((p) => placed.get(p)!);
    let r = lastRow[c] + 1;
    ps.forEach((p) => (r = Math.max(r, p.col === c ? p.row + 1 : p.row)));

    const blocked = (row: number) => {
      if (node.has(key(c, row)) || through.has(key(c, row))) return true;
      // 別の担当から来る矢印は、この行を横に通る。途中の列に他のステップがあれば下げる
      return ps.some((p) => {
        if (p.col === c) return false;
        const [a, b] = p.col < c ? [p.col, c] : [c, p.col];
        for (let x = a + 1; x < b; x++) if (node.has(key(x, row))) return true;
        return false;
      });
    };
    while (blocked(r)) r++;

    placed.set(s.id, { step: s, index: i, col: c, row: r });
    node.add(key(c, r));
    lastRow[c] = r;
    ps.forEach((p) => {
      if (p.col === c) return;
      const [a, b] = p.col < c ? [p.col, c] : [c, p.col];
      for (let x = a + 1; x < b; x++) through.add(key(x, r));
    });
  });

  const rows = Math.max(0, ...[...placed.values()].map((p) => p.row + 1));
  return { lanes, placed, rows };
}

// ---------------- 比較 ----------------
function handoffs(flow: Flow): number {
  const lane = new Map(flow.steps.map((s) => [s.id, s.lane]));
  return flow.steps.reduce(
    (n, s) => n + s.next.filter((x) => lane.has(x) && lane.get(x) !== s.lane).length,
    0,
  );
}

export function compare(asis: Flow, tobe: Flow, resources: Resource[] = []): Comparison {
  const sum = (f: Flow) => f.steps.reduce((n, s) => n + (s.minutes || 0), 0);
  const am = sum(asis);
  const tm = sum(tobe);
  const a = counters(asis, resources);
  const t = counters(tobe, resources);
  return {
    asis_steps: asis.steps.length,
    tobe_steps: tobe.steps.length,
    asis_minutes: am,
    tobe_minutes: tm,
    asis_handoffs: handoffs(asis),
    tobe_handoffs: handoffs(tobe),
    asis_issues: asis.steps.filter((s) => s.issue).length,
    tobe_issues: tobe.steps.filter((s) => s.issue).length,
    reduction_rate: am ? Math.round(((am - tm) / am) * 1000) / 10 : 0,
    asis_manual: a.manual,
    tobe_manual: t.manual,
    asis_mail: a.mail,
    tobe_mail: t.mail,
    asis_paper: a.paper,
    tobe_paper: t.paper,
  };
}

// ---------------- 編集の補助 ----------------
export function newStep(id: string, lane: string, isTobe: boolean): Step {
  return {
    id, lane, row: null, type: "作業", name: "", tool: "", minutes: 0,
    pc: false, manual_input: false, money: false,
    issue: null, issue_detail: "", third_party: false,
    change: isTobe ? "新規" : null, note: "",
    next: [], next_media: [], condition_labels: [],
  };
}

/** 古いデータ（項目が足りない）を補う */
export function normalize(flow: Flow): Flow {
  return {
    lanes: flow.lanes ?? [],
    steps: (flow.steps ?? []).map((s) => ({ ...newStep(s.id, s.lane, false), ...s })),
  };
}

/** 次のステップIDを採番（S01, S02, ...） */
export function nextStepId(flow: Flow): string {
  const nums = flow.steps.map((s) => parseInt(s.id.replace(/\D/g, ""), 10) || 0);
  return `S${String(Math.max(0, ...nums) + 1).padStart(2, "0")}`;
}

/** 並び順どおりに S01〜 を振り直し、遷移先も付け替える */
export function renumber(flow: Flow): Flow {
  const map = new Map(flow.steps.map((s, i) => [s.id, `S${String(i + 1).padStart(2, "0")}`]));
  return {
    ...flow,
    steps: flow.steps.map((s) => ({ ...s, id: map.get(s.id)!, next: s.next.map((n) => map.get(n) ?? n) })),
  };
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}時間${m % 60}分` : `${h}時間`;
}
