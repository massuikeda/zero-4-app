"use client";

/**
 * 業務フローを「決まった型」で描く。
 *  - 列 = 担当（取引先などの社外は色を変える）
 *  - 人のアイコン＋作業名、画面アイコン（PC作業）、色付きの札（使っている道具）
 *  - 矢印のラベル = 受け渡し手段（FAX・メール・配達…）
 *  - 作業名が赤 = ボトルネック、¥ = お金の流れ
 *  - 右側 = ボトルネック一覧（TO-BEは改善ポイント）、3つの集計、経営者の認識／現場の実態
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  addLane, addStepAt, connect, disconnect, insertBelow, moveLaneTo, moveStep, removeLane, removeStep, renameLane,
} from "@/lib/edit";
import {
  TOOL_STYLE, bottleneckNumbers, classifyTool, counters, layout, mediaColor, toolLabel, type Placed,
} from "@/lib/flow";
import { CHANGE_COLORS, type Flow, type Resource, type Step } from "@/lib/types";
import { EdgeInspector, NodeInspector } from "./Inspector";

const CW = 320; // 列の幅
const HEADER = 56;
const PAD = 26;
const RH = 178; // 行の高さ
const ICON_H = 84;
const LABEL_H = 52;

const LANE_BG = "#f2f3f5"; // 列の背景（グレー）
const LINE = "#9aa3ae"; // 矢印の線（グレーに統一）

interface Props {
  flow: Flow;
  resources: Resource[];
  kind: "asis" | "tobe";
  /** TO-BEで集計を「AS-IS → TO-BE」と並べて見せるときのAS-IS */
  base?: Flow;
  execView?: string;
  fieldView?: string;
  exporting?: boolean;
  /** 画像・PDFに出力するときだけ上に出す見出し */
  exportTitle?: string;
  exportSub?: string;
  /** true なら図の上で直接編集できる（追加・移動・矢印・削除） */
  editable?: boolean;
  /** merge=true は文字入力（続けて打った分は「元に戻す」1回にまとめる） */
  onChange?: (f: Flow, merge?: boolean) => void;
}

export type Selection = { type: "node"; id: string } | { type: "edge"; from: string; to: string } | null;

function iconRowWidth(s: Step) {
  // 人 ＋ 札（PC作業は札の中の画面マーク）。札がなくPC作業だけなら小さな画面
  return 52 + (s.tool ? 12 + 104 : s.pc ? 12 + 44 : 0);
}

/** 作業の枠の幅：中身（人＋札、作業名）に合わせる。枠いっぱいの固定幅にしないことで、矢印やラベルと重ならない */
function nodeWidth(s: Step) {
  const label = Math.min(236, [...(s.name || "（作業名を入力）")].length * 14);
  return Math.max(iconRowWidth(s), label) + 24;
}

function geom(p: Placed) {
  const cx = p.col * CW + CW / 2;
  const y0 = HEADER + PAD + p.row * RH;
  const w = nodeWidth(p.step);
  return {
    cx,
    y0,
    w,
    cy: y0 + ICON_H / 2,
    // 矢印は枠の外側から出入りする
    left: cx - w / 2 - 4,
    right: cx + w / 2 + 4,
    top: y0 - 6,
    bottom: y0 + ICON_H + LABEL_H,
  };
}

interface Edge {
  key: string;
  d: string;
  end: [number, number];
  angle: number;
  color: string;
  label: string;
  media: string;
  lx: number;
  ly: number;
  horizontal: boolean; // 横向きの線（ラベルは線の上に置く）
  from: string;
  to: string;
}

function buildEdges(flow: Flow, placed: Map<string, Placed>): Edge[] {
  const edges: Edge[] = [];
  flow.steps.forEach((s) => {
    const a = placed.get(s.id);
    if (!a) return;
    s.next.forEach((n, i) => {
      const b = placed.get(n);
      if (!b) return;
      const ga = geom(a);
      const gb = geom(b);
      const media = s.next_media[i] ?? "";
      const label = [s.condition_labels[i] ?? "", media].filter(Boolean).join(" / ");
      const color = media ? mediaColor(media) : "#6b7385"; // ラベルの文字色（線はグレーに統一）
      let d: string;
      let end: [number, number];
      let angle: number;
      let lx: number;
      let ly: number;
      let horizontal = false;
      if (a.col === b.col && b.row > a.row) {
        // 同じ担当の続き：下向き
        d = `M${ga.cx},${ga.bottom} L${gb.cx},${gb.top}`;
        end = [gb.cx, gb.top];
        angle = Math.PI / 2;
        lx = ga.cx + 6;
        ly = (ga.bottom + gb.top) / 2;
      } else if (a.col === b.col) {
        // 同じ担当で戻る（差戻しなど）：左側を回る
        const x1 = ga.left;
        const x2 = gb.left;
        const off = Math.min(x1, x2) - 46;
        d = `M${x1},${ga.cy} C${off},${ga.cy} ${off},${gb.cy} ${x2},${gb.cy}`;
        end = [x2, gb.cy];
        angle = 0;
        lx = off + 10;
        ly = (ga.cy + gb.cy) / 2;
      } else {
        // 別の担当へ。同じ行なら横向き、行が違えば列の間の通り道で曲げる
        const toRight = b.col > a.col;
        const sx = toRight ? ga.right : ga.left;
        const tx = toRight ? gb.left : gb.right;
        const sy = ga.cy;
        const ty = gb.cy;
        end = [tx, ty];
        angle = toRight ? 0 : Math.PI;
        if (a.row === b.row) {
          d = `M${sx},${sy} L${tx},${ty}`;
          lx = sx + (tx - sx) * 0.4; // 受け取り側の人と重ならないよう、少し出発側に寄せる
          ly = sy;
          horizontal = true;
        } else {
          // 出発する列の、相手側の境目（列と列のすき間）を通る。
          // 同じ辺から出る横向きの矢印と重ならないよう、上下に少しずらす
          const chx = toRight ? (a.col + 1) * CW - 3 : a.col * CW - 3;
          const sy2 = sy + 12;
          const ty2 = ty - 12;
          d = `M${sx},${sy2} L${chx},${sy2} L${chx},${ty2} L${tx},${ty2}`;
          end = [tx, ty2];
          lx = (chx + tx) / 2;
          ly = ty2;
          horizontal = true;
        }
      }
      edges.push({ key: `${s.id}-${n}-${i}`, d, end, angle, color, label, media, lx, ly, horizontal, from: s.id, to: n });
    });
  });
  return edges;
}

function arrowHead([x, y]: [number, number], angle: number) {
  const L = 11;
  const W = 6;
  const bx = x - L * Math.cos(angle);
  const by = y - L * Math.sin(angle);
  const px = Math.sin(angle) * W;
  const py = -Math.cos(angle) * W;
  return `${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`;
}

// ---------------- アイコン ----------------
function Person() {
  return (
    <svg width="52" height="76" viewBox="0 0 52 76" aria-hidden>
      <circle cx="26" cy="17" r="15" fill="#5f6f86" />
      <path d="M2 76 V52 Q2 36 18 36 H34 Q50 36 50 52 V76 Z" fill="#5f6f86" />
    </svg>
  );
}

function Monitor({ small }: { small?: boolean }) {
  return (
    <svg width={small ? 44 : 58} height={small ? 42 : 56} viewBox="0 0 58 56" aria-hidden>
      <rect x="2" y="2" width="54" height="38" rx="2" fill="#dde6ef" stroke="#3d4b5c" strokeWidth="3" />
      <rect x="25" y="40" width="8" height="8" fill="#3d4b5c" />
      <rect x="15" y="48" width="28" height="5" rx="1" fill="#3d4b5c" />
    </svg>
  );
}

function ToolTag({ tool, resources, pc }: { tool: string; resources: Resource[]; pc: boolean }) {
  const st = TOOL_STYLE[classifyTool(tool, resources)];
  return (
    <div className="fb-tag" style={{ borderColor: st.bar, background: st.bg, color: st.fg }}>
      <div className="fb-tag-bar" style={{ background: st.bar }}>
        {pc && <ScreenMark />}
      </div>
      <span>{toolLabel(tool)}</span>
    </div>
  );
}

/** 札の上の帯に入れる、小さな画面マーク（PC作業） */
function ScreenMark() {
  return (
    <svg className="fb-screen-mark" width="16" height="12" viewBox="0 0 16 12" aria-label="PC作業">
      <rect x="1" y="1" width="14" height="8" rx="1" fill="none" stroke="#fff" strokeWidth="1.6" />
      <rect x="5" y="10" width="6" height="1.6" fill="#fff" />
    </svg>
  );
}

/** ボトルネックの作業にマウスを乗せたときの説明 */
function issueTip(s: Step) {
  return [
    "ボトルネック",
    s.issue_time && `時間がかかる理由：${s.issue_time}`,
    s.issue_error && `ミスの原因：${s.issue_error}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 「？ 操作方法」に出す一覧 */
const HELP: [string, string][] = [
  ["作業を追加", "空いているマスをクリック（作業を選んだ状態なら、その作業から矢印でつながる）"],
  ["作業を設定", "作業をクリック → 右のパネルで道具・印・ボトルネックなどを選ぶ"],
  ["作業名を変える", "作業をダブルクリック（または右のパネルの「作業名」の欄をクリック）"],
  ["作業を移動", "作業をドラッグして、置きたいマスで離す"],
  ["矢印でつなぐ", "作業を選ぶと右に出る → を、つなぎたい作業までドラッグ"],
  ["受け渡し手段", "矢印かラベルをクリック → 右のパネルでメール・FAXなどを選ぶ"],
  ["削除", "作業か矢印を選んで Delete キー（右のパネルの削除ボタンでも可）"],
  ["元に戻す", "Ctrl + Z（Mac は ⌘ + Z）、または上の「元に戻す」"],
  ["列（担当）を追加", "図の右上の ＋"],
  ["列の名前を変える", "列の見出しをダブルクリック"],
  ["列の順番を変える", "列の見出しをつかんで、左右にドラッグ"],
  ["列を削除", "列の見出しの ×（その列の作業も一緒に削除。「元に戻す」で戻せる）"],
  ["全体を見る", "「全体を表示」。細かく作業するときは「100%」"],
];

// ---------------- 本体 ----------------

export const FlowBoard = forwardRef<HTMLDivElement, Props>(function FlowBoard(
  { flow, resources, kind, base, execView, fieldView, exporting, exportTitle, exportSub, editable: editableProp, onChange },
  ref,
) {
  const editable = !!editableProp && !!onChange && !exporting;
  const isTobe = kind === "tobe";
  const lay = useMemo(() => layout(flow, { includeEmptyLanes: !!editableProp }), [flow, editableProp]);
  const edges = useMemo(() => buildEdges(flow, lay.placed), [flow, lay]);
  const nums = useMemo(() => bottleneckNumbers(flow, lay), [flow, lay]);

  const [sel, setSel] = useState<Selection>(null);
  // 作業をダブルクリックしたときだけ、その作業の名前欄にカーソルを置く（選択・追加では置かない）
  const [focusFor, setFocusFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; sx: number; sy: number; dx: number; dy: number; moved: boolean } | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  // 「＋列を追加」のメニュー（開いている位置。画面上の座標）
  const [laneMenu, setLaneMenu] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null); // 名前を変えている列
  const [helpOpen, setHelpOpen] = useState(false); // 「？ 操作方法」
  // 列の見出しをドラッグして並べ替え中
  const [laneDrag, setLaneDrag] = useState<{ lane: string; sx: number; dx: number; moved: boolean } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 列を追加したら、右端までスクロールして見せる */
  /** 列を追加したら、手動で大きさを変えていても「全部の列が見える大きさ」に戻す */
  const addLaneAndShow = (name: string) => {
    change(addLane(flow, name));
    setZoom("fit");
    setTimeout(() => {
      scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
      scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  };

  // 選択中のものが消えたら選択を外す
  const selValid =
    sel === null ||
    (sel.type === "node" && flow.steps.some((s) => s.id === sel.id)) ||
    (sel.type === "edge" && flow.steps.some((s) => s.id === sel.from && s.next.includes(sel.to)));
  const selection = selValid ? sel : null;
  const selectedNodeId = selection?.type === "node" ? selection.id : null;

  const rows = Math.max(1, lay.rows) + (editable ? 1 : 0);
  const ADD_BTN_W = editable ? 72 : 0; // 右端の「＋」（列を追加）ボタンの幅
  const width = Math.max(1, lay.lanes.length) * CW + ADD_BTN_W;
  const height = HEADER + PAD + rows * RH;

  // ---- 表示の大きさ（ズーム）。"fit" は横幅に合わせて自動で縮める（列が増えても全部見える） ----
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 狭くなったときは必ず合わせ直す（はみ出さないように）。
    // 広くなったときは、数px程度（スクロールバーの出入りなど）なら計算し直さない。
    // 「縮む→スクロールバーが消える→広がる→また大きくなる」の繰り返しで画面が揺れるのを防ぐ
    const ro = new ResizeObserver(() =>
      setBoxW((prev) => {
        const w = el.clientWidth;
        return w < prev || w - prev >= 24 ? w : prev;
      }),
    );
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const fitScale = boxW ? Math.min(1, boxW / width) : 1;
  const scale = exporting ? 1 : zoom === "fit" ? Math.max(0.35, fitScale) : zoom;
  /** 縦も含めて、図の全体が画面に収まる大きさにする */
  const fitAll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const h = Math.max(200, window.innerHeight - Math.max(top, 0) - 24);
    setZoom(Math.max(0.3, Math.min(1, el.clientWidth / width, h / height)));
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const zoomBy = (d: number) => setZoom(Math.round(Math.min(1.5, Math.max(0.3, scale + d)) * 10) / 10);

  const change = (f: Flow, merge = false) => onChange?.(f, merge);
  /** 図をクリックしたら、設定パネルの入力欄からカーソルを外す（そのまま Delete で削除できるように） */
  const releaseFocus = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) el.blur();
  };

  // ---- 座標 ----
  const point = (e: { clientX: number; clientY: number }) => {
    const r = boardRef.current!.getBoundingClientRect();
    // 縮小表示中は、画面上の位置を図の座標に戻す
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const cellAt = (x: number, y: number) => {
    const col = Math.floor(x / CW);
    const row = Math.floor((y - HEADER - PAD + 30) / RH);
    if (col < 0 || col >= lay.lanes.length || row < 0) return null;
    return { col, row: Math.min(row, rows - 1) };
  };
  const nodeAt = (x: number, y: number) =>
    [...lay.placed.values()].find((p) => {
      const g = geom(p);
      return x >= g.cx - g.w / 2 && x <= g.cx + g.w / 2 && y >= g.y0 - 10 && y <= g.y0 + ICON_H + LABEL_H + 10;
    });

  // ---- ドラッグ（移動）と、つまみからの矢印 ----
  useEffect(() => {
    if (!drag && !link) return;
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        setDrag({ ...drag, dx, dy, moved: drag.moved || Math.abs(dx) + Math.abs(dy) > 6 });
      } else if (link) {
        const p = point(e);
        setLink({ ...link, x: p.x, y: p.y });
      }
    };
    const up = (e: PointerEvent) => {
      const p = point(e);
      if (drag) {
        if (drag.moved) {
          const c = cellAt(p.x, p.y);
          const cur = lay.placed.get(drag.id);
          if (c && cur && (c.col !== cur.col || c.row !== cur.row)) {
            change(moveStep(flow, drag.id, lay.lanes[c.col], c.row));
          }
        }
        setSel({ type: "node", id: drag.id });
        setDrag(null);
      } else if (link) {
        const target = nodeAt(p.x, p.y);
        if (target && target.step.id !== link.from) {
          change(connect(flow, link.from, target.step.id));
          setSel({ type: "edge", from: link.from, to: target.step.id });
        }
        setLink(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  // ---- キーボード（Delete で削除、Esc で選択解除） ----
  useEffect(() => {
    if (!editable) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") setSel(null);
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        if (selection.type === "node") change(removeStep(flow, selection.id));
        else change(disconnect(flow, selection.from, selection.to));
        setSel(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ---- 列の見出しのドラッグ（並べ替え） ----
  const laneSlot = (clientX: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = (clientX - r.left) / scale;
    return Math.max(0, Math.min(lay.lanes.length, Math.round(x / CW)));
  };
  const [laneDropSlot, setLaneDropSlot] = useState<number | null>(null);
  useEffect(() => {
    if (!laneDrag) return;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - laneDrag.sx;
      const moved = laneDrag.moved || Math.abs(dx) > 6;
      setLaneDrag({ ...laneDrag, dx, moved });
      setLaneDropSlot(moved ? laneSlot(e.clientX) : null);
    };
    const up = (e: PointerEvent) => {
      if (laneDrag.moved) {
        const slot = laneSlot(e.clientX);
        if (slot !== null) change(moveLaneTo(flow, lay.lanes, laneDrag.lane, slot));
      }
      setLaneDrag(null);
      setLaneDropSlot(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const addAt = (col: number, row: number) => {
    const { flow: f, id } = addStepAt(flow, lay.lanes[col], row, isTobe, selectedNodeId);
    change(f);
    setSel({ type: "node", id });
  };

  const occupied = new Set([...lay.placed.values()].map((p) => `${p.col}:${p.row}`));
  const dragTarget = drag?.moved && boardRef.current
    ? (() => {
        const g = lay.placed.get(drag.id);
        if (!g) return null;
        const gg = geom(g);
        return cellAt(gg.cx + drag.dx / scale, gg.y0 + 40 + drag.dy / scale);
      })()
    : null;
  const linkFrom = link ? lay.placed.get(link.from) : null;

  const selectedStep = selectedNodeId ? flow.steps.find((s) => s.id === selectedNodeId) ?? null : null;

  // 今の状態に合わせて「次の操作」を1行だけ案内する
  const guideText = laneDrag?.moved
    ? "青い線の位置で離すと、列（中の作業ごと）がそこへ移動します"
    : link
    ? "つなぎたい作業の上で離すと、矢印ができます"
    : drag?.moved
      ? "置きたいマスで離すと、そこへ移動します"
      : lay.lanes.length === 0
        ? "図の右上の ＋ を押して、列（担当）を追加しましょう"
        : flow.steps.length === 0
          ? "空いているマスをクリックすると、作業を追加できます"
          : selection?.type === "node" && !selectedStep?.name
            ? "作業名を入れるには、作業をダブルクリックするか、右の「作業名」の欄をクリックします"
          : selection?.type === "node"
            ? "右の → をドラッグして矢印でつなぐ ／ 作業をドラッグして移動 ／ Delete で削除"
            : selection?.type === "edge"
              ? "右のパネルで受け渡し手段（メール・FAXなど）を選べます ／ Delete で削除"
              : "作業をクリックすると設定が開きます ／ 空いているマスをクリックで作業を追加";

  return (
    <div ref={ref} className={`fb-wrap${exporting ? " exporting" : ""}`}>
      {exporting && exportTitle && (
        <div className="fb-export-title">
          <b>{exportTitle}</b>
          {exportSub && <span>{exportSub}</span>}
        </div>
      )}
      <div className="fb-main">
        {editable && (
          <div className="fb-guide">
            <span className="fb-guide-tag">次の操作</span>
            <span className="fb-guide-text">{guideText}</span>
            <span className="fb-help-wrap">
              <button className="btn ghost small-btn" onClick={() => setHelpOpen((v) => !v)}>
                ？ 操作方法
              </button>
              {helpOpen && (
                <>
                  <div className="fb-pop-backdrop" onPointerDown={() => setHelpOpen(false)} />
                  <div className="fb-help">
                    <div className="fb-help-head">
                      <b>図の操作方法</b>
                      <button className="icon" title="閉じる" onClick={() => setHelpOpen(false)}>
                        ×
                      </button>
                    </div>
                    <table>
                      <tbody>
                        {HELP.map(([what, how]) => (
                          <tr key={what}>
                            <th>{what}</th>
                            <td>{how}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </span>
          </div>
        )}
        {!exporting && (flow.steps.length > 0 || editable) && (
          <div className="fb-zoom">
            <span className="muted small">表示の大きさ</span>
            <button className="btn ghost small-btn" title="縮小" onClick={() => zoomBy(-0.1)}>
              －
            </button>
            <span className="fb-zoom-val">{Math.round(scale * 100)}%</span>
            <button className="btn ghost small-btn" title="拡大" onClick={() => zoomBy(0.1)}>
              ＋
            </button>
            <button className={`btn ghost small-btn${zoom === "fit" ? " on" : ""}`} onClick={() => setZoom("fit")}>
              横幅に合わせる
            </button>
            <button className="btn ghost small-btn" onClick={fitAll}>
              全体を表示
            </button>
            <button className="btn ghost small-btn" onClick={() => setZoom(1)}>
              100%
            </button>
          </div>
        )}
        <div className="fb-scroll" ref={scrollRef}>
          {!editable && flow.steps.length === 0 ? (
            <div className="fb-empty">まだ作業がありません</div>
          ) : (
            <div className="fb-sizer" style={{ width: width * scale, height: height * scale }}>
            <div
              ref={boardRef}
              className={`fb-board${editable ? " editing" : ""}${link ? " linking" : ""}`}
              style={{
                width,
                height,
                transform: scale !== 1 ? `scale(${scale})` : undefined,
                transformOrigin: "0 0",
              }}
              onPointerDown={(e) => {
                if (editable && e.target === e.currentTarget) {
                  releaseFocus();
                  setSel(null);
                }
              }}
            >
              {lay.lanes.map((lane, i) => {
                const bg = LANE_BG; // 列の背景はすべてグレー
                return (
                  <div key={lane} className="fb-lane" style={{ left: i * CW, width: CW - 6, height }}>
                    <div
                      className={`fb-lane-head${editable ? " draggable" : ""}${laneDrag?.lane === lane && laneDrag.moved ? " dragging" : ""}`}
                      style={
                        laneDrag?.lane === lane && laneDrag.moved
                          ? { transform: `translateX(${laneDrag.dx / scale}px)` }
                          : undefined
                      }
                      title={editable ? "ドラッグで列を移動／ダブルクリックで名前を変更" : undefined}
                      onPointerDown={(e) => {
                        if (!editable || renaming === lane || e.button !== 0) return;
                        if ((e.target as HTMLElement).closest("button, input")) return;
                        e.preventDefault();
                        releaseFocus();
                        setLaneDrag({ lane, sx: e.clientX, dx: 0, moved: false });
                      }}
                    >
                      {renaming === lane ? (
                        <input
                          className="fb-lane-rename"
                          autoFocus
                          defaultValue={lane}
                          onBlur={(e) => {
                            change(renameLane(flow, lane, e.target.value));
                            setRenaming(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                      ) : (
                        <span onDoubleClick={() => editable && setRenaming(lane)}>
                          {lane}
                        </span>
                      )}
                      {editable && (
                        <button
                          className="fb-lane-btn del"
                          title="この列を削除"
                          aria-label={`「${lane}」の列を削除`}
                          onClick={() => {
                            const n = flow.steps.filter((s) => (s.lane || "（未設定）") === lane).length;
                            if (n > 0 && !confirm(`「${lane}」の列を削除すると、この列の作業${n}件も一緒に削除されます。よろしいですか？\n（「元に戻す」で戻せます）`)) return;
                            change(removeLane(flow, lane));
                            setSel(null);
                            setZoom("fit");
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div
                      className="fb-lane-body"
                      style={{ background: bg }}
                      onPointerDown={() => {
                        if (!editable) return;
                        releaseFocus();
                        setSel(null);
                      }}
                    />
                  </div>
                );
              })}

              {laneDrag?.moved && laneDropSlot !== null && (
                <div className="fb-lane-drop" style={{ left: laneDropSlot * CW - 5, height }} />
              )}

              {editable && (
                <button
                  className="fb-addlane-btn"
                  style={{ left: lay.lanes.length * CW, width: ADD_BTN_W - 10 }}
                  title="列（担当）を追加"
                  aria-label="列（担当）を追加"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    if (laneMenu) return setLaneMenu(null);
                    const r = e.currentTarget.getBoundingClientRect();
                    setLaneMenu({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 290)) });
                  }}
                >
                  ＋
                </button>
              )}


              {/* 空いているマス（クリックで追加） */}
              {editable &&
                lay.lanes.map((_, col) =>
                  Array.from({ length: rows }, (_, row) =>
                    occupied.has(`${col}:${row}`) ? null : (
                      <button
                        key={`cell-${col}-${row}`}
                        className={`fb-cell${dragTarget && dragTarget.col === col && dragTarget.row === row ? " drop" : ""}`}
                        style={{ left: col * CW + 10, top: HEADER + PAD + row * RH - 14, width: CW - 26, height: RH - 22 }}
                        onClick={() => addAt(col, row)}
                        title="ここに作業を追加"
                      >
                        <span>＋ 作業を追加</span>
                      </button>
                    ),
                  ),
                )}

              <svg className="fb-edges" width={width} height={height}>
                {edges.map((e) => {
                  const on = selection?.type === "edge" && selection.from === e.from && selection.to === e.to;
                  return (
                    <g key={e.key}>
                      <path d={e.d} fill="none" stroke={on ? "#0b5cad" : LINE} strokeWidth={on ? 3.5 : 2} />
                      <polygon points={arrowHead(e.end, e.angle)} fill={on ? "#0b5cad" : LINE} />
                      {editable && (
                        <path
                          d={e.d}
                          className="fb-edge-hit"
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
                            releaseFocus();
                            setSel({ type: "edge", from: e.from, to: e.to });
                          }}
                        />
                      )}
                    </g>
                  );
                })}
                {link && linkFrom && (
                  <line
                    x1={geom(linkFrom).right}
                    y1={geom(linkFrom).cy}
                    x2={link.x}
                    y2={link.y}
                    stroke="#0b5cad"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                  />
                )}
              </svg>

              {edges
                .filter((e) => e.label)
                .map((e) => (
                  <div
                    key={`l-${e.key}`}
                    className={`fb-pill${e.media ? "" : " cond"}${e.horizontal ? " above" : ""}${editable ? " clickable" : ""}`}
                    style={{ left: e.lx, top: e.ly, color: e.color }}
                    onPointerDown={(ev) => {
                      if (!editable) return;
                      ev.stopPropagation();
                      releaseFocus();
                      setSel({ type: "edge", from: e.from, to: e.to });
                    }}
                  >
                    {e.label}
                  </div>
                ))}

              {[...lay.placed.values()].map((p) => {
                const g = geom(p);
                const s = p.step;
                const changeColor = s.change ? CHANGE_COLORS[s.change] : null;
                const dragging = drag?.id === s.id && drag.moved;
                return (
                  <div
                    key={s.id}
                    className={`fb-node${selectedNodeId === s.id ? " selected" : ""}${editable ? " clickable" : ""}${dragging ? " dragging" : ""}${s.name ? "" : " unnamed"}${changeColor ? " has-change" : ""}`}
                    style={{
                      left: g.cx - g.w / 2,
                      width: g.w,
                      top: g.y0,
                      transform: dragging ? `translate(${drag!.dx / scale}px, ${drag!.dy / scale}px)` : undefined,
                      ...(changeColor ? { borderColor: changeColor, background: `${changeColor}12`, ["--chg" as string]: changeColor } : {}),
                    }}
                    onPointerDown={(e) => {
                      if (!editable || e.button !== 0) return;
                      e.preventDefault();
                      releaseFocus();
                      setDrag({ id: s.id, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false });
                    }}
                    onDoubleClick={() => {
                      if (!editable) return;
                      setSel({ type: "node", id: s.id });
                      setFocusFor(s.id);
                    }}
                    title={editable ? undefined : [s.issue && issueTip(s), s.note].filter(Boolean).join("\n")}
                  >
                    {s.change && (
                      <span className="fb-change" style={{ background: changeColor! }}>
                        {s.change}
                      </span>
                    )}
                    <div className="fb-icons">
                      <div className="fb-person">
                        <Person />
                        {s.money && <span className="fb-yen">¥</span>}
                      </div>
                      {s.tool ? (
                        <ToolTag tool={s.tool} resources={resources} pc={s.pc} />
                      ) : (
                        s.pc && <Monitor small />
                      )}
                    </div>
                    <div className={`fb-label${s.issue ? " issue" : ""}`} title={s.issue ? issueTip(s) : undefined}>
                      {s.name || <span className="muted">（作業名を入力）</span>}
                      <span className="fb-meta">
                        {s.type !== "作業" && <span className="fb-type">{s.type}</span>}
                      </span>
                    </div>
                    {editable && selectedNodeId === s.id && (
                      <span
                        className="fb-handle"
                        title="ドラッグして、つなぎたい作業の上で離す"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const pt = point(e);
                          setLink({ from: s.id, x: pt.x, y: pt.y });
                        }}
                      >
                        →
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          )}
        </div>
        {editable && laneMenu && (
          <>
            <div className="fb-pop-backdrop" onPointerDown={() => setLaneMenu(null)} />
            <div className="fb-addlane-pop" style={{ top: laneMenu.top, left: laneMenu.left }}>
              <AddLaneForm
                resources={resources}
                lanes={flow.lanes}
                onAdd={(name) => {
                  addLaneAndShow(name);
                  setLaneMenu(null);
                }}
              />
              <button className="icon" title="閉じる" onClick={() => setLaneMenu(null)}>
                ×
              </button>
            </div>
          </>
        )}
        <Legend tobe={isTobe} maxWidth={flow.steps.length ? width - ADD_BTN_W : undefined} />
      </div>
      {editable && selection?.type === "node" && selectedStep ? (
        <NodeInspector
          key={selectedStep.id}
          step={selectedStep}
          flow={flow}
          resources={resources}
          isTobe={isTobe}
          focusName={focusFor === selectedStep.id}
          onFocused={() => setFocusFor(null)}
          onChange={change}
          onClose={() => setSel(null)}
          onInsertBelow={() => {
            const { flow: f, id } = insertBelow(flow, selectedStep.id, isTobe);
            change(f);
            setSel({ type: "node", id });
          }}
          onSelectEdge={(to) => setSel({ type: "edge", from: selectedStep.id, to })}
        />
      ) : editable && selection?.type === "edge" ? (
        <EdgeInspector
          key={`${selection.from}-${selection.to}`}
          flow={flow}
          from={selection.from}
          to={selection.to}
          onChange={change}
          onClose={() => setSel(null)}
          onSelectNode={(id) => setSel({ type: "node", id })}
        />
      ) : (
        <SidePanel
          flow={flow}
          kind={kind}
          base={base}
          resources={resources}
          nums={nums}
          execView={execView}
          fieldView={fieldView}
        />
      )}
    </div>
  );
});

/** リソースから選ぶか、名前を入れて列を追加するフォーム */
function AddLaneForm({
  resources, lanes, onAdd,
}: { resources: Resource[]; lanes: string[]; onAdd: (name: string) => void }) {
  const [text, setText] = useState("");
  const candidates = resources
    .filter((r) => ["部署", "担当者", "取引先"].includes(r.kind) && !lanes.includes(r.name))
    .map((r) => r.name);
  return (
    <div className="fb-addlane-form">
        {candidates.length === 0 && <p className="insp-note">リソースの候補はすべて追加済みです。名前を入れて追加できます。</p>}
        {candidates.map((n) => (
          <button key={n} className="chip-btn" onClick={() => onAdd(n)}>
            ＋ {n}
          </button>
        ))}
        <input
          placeholder="その他の名前"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              onAdd(text);
              setText("");
            }
          }}
        />
        <button
          className="btn ghost small-btn"
          disabled={!text.trim()}
          onClick={() => {
            onAdd(text);
            setText("");
          }}
        >
          追加
        </button>
    </div>
  );
}

function SidePanel({
  flow, kind, base, resources, nums, execView, fieldView,
}: {
  flow: Flow; kind: "asis" | "tobe"; base?: Flow; resources: Resource[]; nums: Map<string, number>;
  execView?: string; fieldView?: string;
}) {
  const c = counters(flow, resources);
  const b = base ? counters(base, resources) : null;
  const issues = flow.steps.filter((s) => s.issue);
  const changed = flow.steps.filter((s) => s.change);
  const ids = new Set(flow.steps.map((s) => s.id));
  const removed = base ? base.steps.filter((s) => !ids.has(s.id)) : [];

  return (
    <aside className="fb-side">
      {kind === "asis" ? (
        <>
          <div className="fb-side-head red">ボトルネック</div>
          <IssueList issues={issues} nums={nums} empty="作業をクリックして「ボトルネックにする」を押すと、ここに一覧が出ます" />
        </>
      ) : (
        <>
          <div className="fb-side-head green">改善ポイント</div>
          <ul className="fb-issues">
            {removed.map((s) => (
              <li key={`r-${s.id}`}>
                <span className="fb-chg" style={{ background: CHANGE_COLORS["排除"] }}>
                  排除
                </span>
                <div>
                  <b className="strike">{s.name || "（名前なし）"}</b>
                  <small>TO-BEではなくなった作業</small>
                </div>
              </li>
            ))}
            {changed.map((s) => (
              <li key={s.id}>
                <span className="fb-chg" style={{ background: CHANGE_COLORS[s.change!] }}>
                  {s.change}
                </span>
                <div>
                  <b>{s.name}</b>
                  {s.note && <small>{s.note}</small>}
                </div>
              </li>
            ))}
            {removed.length + changed.length === 0 && (
              <li className="muted small">「変更区分」を設定するか、作業を削除すると、ここに出ます</li>
            )}
          </ul>
          {issues.length > 0 && (
            <>
              <div className="fb-sub-head">残る課題</div>
              <IssueList issues={issues} nums={nums} />
            </>
          )}
        </>
      )}

      <div className="fb-counters">
        <CounterBox v={c.manual} b={b?.manual} unit="回" label="手入力・転記" tobe={kind === "tobe"} />
        <CounterBox v={c.mail} b={b?.mail} unit="回" label="メール連絡" tobe={kind === "tobe"} />
        <CounterBox v={c.paper} b={b?.paper} unit="か所" label="紙" tobe={kind === "tobe"} />
      </div>

      {kind === "asis" && (execView || fieldView) && (
        <div className="fb-views">
          {execView && (
            <>
              <div className="fb-view-label exec">経営者の認識</div>
              <p>「{execView}」</p>
            </>
          )}
          {fieldView && (
            <>
              <div className="fb-view-label field">現場の実態</div>
              <p>「{fieldView}」</p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function IssueList({ issues, nums, empty }: { issues: Step[]; nums: Map<string, number>; empty?: string }) {
  // 図の上から順（同じ高さは左から）に並べる
  const sorted = [...issues].sort((a, b) => (nums.get(a.id) ?? 0) - (nums.get(b.id) ?? 0));
  return (
    <ul className="fb-issues">
      {sorted.map((s) => (
        <li key={s.id} className="fb-issue">
          <div className="fb-issue-head">
            <b className="fb-issue-task">{s.name || "（名前なし）"}</b>
          </div>
          <dl className="fb-issue-body">
            {s.issue_time && (
              <>
                <dt className="time">時間がかかる理由</dt>
                <dd>{s.issue_time}</dd>
              </>
            )}
            {s.issue_error && (
              <>
                <dt className="error">ミスの原因</dt>
                <dd>{s.issue_error}</dd>
              </>
            )}
            {!s.issue_time && !s.issue_error && (
              // 以前の形（見出し・説明）で入力されたもの
              <>
                <dt>内容</dt>
                <dd>
                  {[s.issue !== "ボトルネック" ? s.issue : "", s.issue_detail].filter(Boolean).join("／") || (
                    <span className="muted">理由・原因が未入力です（作業をクリックして入力）</span>
                  )}
                </dd>
              </>
            )}
          </dl>
        </li>
      ))}
      {issues.length === 0 && empty && <li className="muted small">{empty}</li>}
    </ul>
  );
}

function CounterBox({ v, b, unit, label, tobe }: { v: number; b?: number; unit: string; label: string; tobe: boolean }) {
  return (
    <div className={`fb-counter${tobe ? " tobe" : ""}`}>
      <div className="fb-counter-num">
        {b !== undefined && b !== v && (
          <span className="fb-counter-before">
            {b}
            {unit}→
          </span>
        )}
        {v}
        <small>{unit}</small>
      </div>
      <div className="fb-counter-label">{label}</div>
    </div>
  );
}

function Legend({ tobe, maxWidth }: { tobe: boolean; maxWidth?: number }) {
  return (
    <div className="fb-legend" style={{ maxWidth }}>
      <span>凡例：</span>
      <span>人＝担当者</span>
      <span>札の画面マーク＝PC作業</span>
      <span>色付きの札＝使っている道具（Excel・Word・システム・紙など）</span>
      <span>
        <b className="fb-legend-issue">赤い作業名</b>＝ボトルネック
      </span>
      <span>¥＝お金の流れ</span>
      {tobe &&
        Object.entries(CHANGE_COLORS)
          .filter(([k]) => k !== "排除")
          .map(([k, v]) => (
            <span key={k}>
              <i className="fb-sw" style={{ borderColor: v, background: `${v}22` }} />
              {k}
            </span>
          ))}
    </div>
  );
}

