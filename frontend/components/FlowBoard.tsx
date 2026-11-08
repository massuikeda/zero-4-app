"use client";

/**
 * 業務フローを「決まった型」で描く。
 *  - 列 = 担当（取引先などの社外は色を変える）
 *  - 人のアイコン＋作業名、画面アイコン（PC作業）、色付きの札（使っている道具）
 *  - 矢印のラベル = 受け渡し手段（FAX・メール・配達…）
 *  - 赤丸の番号 = ボトルネック、¥ = お金の流れ
 *  - 右側 = ボトルネック一覧（TO-BEは改善ポイント）、3つの集計、経営者の認識／現場の実態
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  addLane, addStepAt, connect, disconnect, insertBelow, moveLane, moveStep, removeLane, removeStep,
} from "@/lib/edit";
import {
  TOOL_STYLE, bottleneckNumbers, classifyTool, counters, layout, mediaColor, type Placed,
} from "@/lib/flow";
import { CHANGE_COLORS, type Flow, type Resource, type Step } from "@/lib/types";
import { EdgeInspector, NodeInspector } from "./Inspector";

const CW = 320; // 列の幅
const HEADER = 56;
const PAD = 26;
const RH = 178; // 行の高さ
const ICON_H = 84;
const LABEL_H = 52;

const EXTERNAL = /取引先|顧客|お客|仕入|得意先|外部|委託/;

interface Props {
  flow: Flow;
  resources: Resource[];
  kind: "asis" | "tobe";
  /** TO-BEで集計を「AS-IS → TO-BE」と並べて見せるときのAS-IS */
  base?: Flow;
  execView?: string;
  fieldView?: string;
  exporting?: boolean;
  /** true なら図の上で直接編集できる（追加・移動・矢印・削除） */
  editable?: boolean;
  /** merge=true は文字入力（続けて打った分は「元に戻す」1回にまとめる） */
  onChange?: (f: Flow, merge?: boolean) => void;
}

export type Selection = { type: "node"; id: string } | { type: "edge"; from: string; to: string } | null;

function iconRowWidth(s: Step) {
  return 52 + (s.pc ? 12 + 58 : 0) + (s.tool ? 12 + 104 : 0);
}

function geom(p: Placed) {
  const cx = p.col * CW + CW / 2;
  const y0 = HEADER + PAD + p.row * RH;
  const w = iconRowWidth(p.step);
  return {
    cx,
    y0,
    cy: y0 + ICON_H / 2,
    left: cx - w / 2 - 8,
    right: cx + w / 2 + 8,
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
      const color = media ? mediaColor(media) : "#6b7385";
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
          lx = sx + (tx - sx) * 0.4; // 受け取り側の赤丸と重ならないよう、少し出発側に寄せる
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

function Monitor() {
  return (
    <svg width="58" height="56" viewBox="0 0 58 56" aria-hidden>
      <rect x="2" y="2" width="54" height="38" rx="2" fill="#dde6ef" stroke="#3d4b5c" strokeWidth="3" />
      <rect x="25" y="40" width="8" height="8" fill="#3d4b5c" />
      <rect x="15" y="48" width="28" height="5" rx="1" fill="#3d4b5c" />
    </svg>
  );
}

function ToolTag({ tool, resources }: { tool: string; resources: Resource[] }) {
  const st = TOOL_STYLE[classifyTool(tool, resources)];
  return (
    <div className="fb-tag" style={{ borderColor: st.bar, background: st.bg, color: st.fg }}>
      <div className="fb-tag-bar" style={{ background: st.bar }} />
      <span>{tool}</span>
    </div>
  );
}

// ---------------- 本体 ----------------
const ADD_COL_W = 210; // 「＋列を追加」の幅
const NODE_W = 260;

export const FlowBoard = forwardRef<HTMLDivElement, Props>(function FlowBoard(
  { flow, resources, kind, base, execView, fieldView, exporting, editable: editableProp, onChange },
  ref,
) {
  const editable = !!editableProp && !!onChange && !exporting;
  const isTobe = kind === "tobe";
  const lay = useMemo(() => layout(flow, { includeEmptyLanes: !!editableProp }), [flow, editableProp]);
  const edges = useMemo(() => buildEdges(flow, lay.placed), [flow, lay]);
  const nums = useMemo(() => bottleneckNumbers(flow, lay), [flow, lay]);
  const external = new Set(resources.filter((r) => r.kind === "取引先").map((r) => r.name));
  const isExternal = (lane: string) => external.has(lane) || EXTERNAL.test(lane);

  const [sel, setSel] = useState<Selection>(null);
  const [focusName, setFocusName] = useState(0); // 増えたら作業名の入力欄にカーソルを置く
  const [drag, setDrag] = useState<{ id: string; sx: number; sy: number; dx: number; dy: number; moved: boolean } | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // 選択中のものが消えたら選択を外す
  const selValid =
    sel === null ||
    (sel.type === "node" && flow.steps.some((s) => s.id === sel.id)) ||
    (sel.type === "edge" && flow.steps.some((s) => s.id === sel.from && s.next.includes(sel.to)));
  const selection = selValid ? sel : null;
  const selectedNodeId = selection?.type === "node" ? selection.id : null;

  const rows = Math.max(1, lay.rows) + (editable ? 1 : 0);
  const width = Math.max(1, lay.lanes.length) * CW + (editable ? ADD_COL_W : 0);
  const height = HEADER + PAD + rows * RH;
  let internalIdx = 0;

  const change = (f: Flow, merge = false) => onChange?.(f, merge);

  // ---- 座標 ----
  const point = (e: { clientX: number; clientY: number }) => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
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
      return x >= g.cx - NODE_W / 2 && x <= g.cx + NODE_W / 2 && y >= g.y0 - 10 && y <= g.y0 + ICON_H + LABEL_H + 10;
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

  const addAt = (col: number, row: number) => {
    const { flow: f, id } = addStepAt(flow, lay.lanes[col], row, isTobe, selectedNodeId);
    change(f);
    setSel({ type: "node", id });
    setFocusName((n) => n + 1);
  };

  const occupied = new Set([...lay.placed.values()].map((p) => `${p.col}:${p.row}`));
  const dragTarget = drag?.moved && boardRef.current
    ? (() => {
        const g = lay.placed.get(drag.id);
        if (!g) return null;
        const gg = geom(g);
        return cellAt(gg.cx + drag.dx, gg.y0 + 40 + drag.dy);
      })()
    : null;
  const linkFrom = link ? lay.placed.get(link.from) : null;

  const selectedStep = selectedNodeId ? flow.steps.find((s) => s.id === selectedNodeId) ?? null : null;

  return (
    <div ref={ref} className={`fb-wrap${exporting ? " exporting" : ""}`}>
      <div className="fb-main">
        {editable && (
          <div className="fb-hint">
            <span><b>空いているマス</b>をクリック：作業を追加（選択中の作業から矢印でつながる）</span>
            <span><b>ドラッグ</b>：移動</span>
            <span><b>●</b>をドラッグ：矢印でつなぐ</span>
            <span><b>Delete</b>：削除</span>
            <span><b>Ctrl+Z</b>：元に戻す</span>
          </div>
        )}
        <div className="fb-scroll">
          {!editable && flow.steps.length === 0 ? (
            <div className="fb-empty">まだ作業がありません</div>
          ) : (
            <div
              ref={boardRef}
              className={`fb-board${editable ? " editing" : ""}${link ? " linking" : ""}`}
              style={{ width, height }}
              onPointerDown={(e) => {
                if (editable && e.target === e.currentTarget) setSel(null);
              }}
            >
              {lay.lanes.map((lane, i) => {
                const ext = isExternal(lane);
                const bg = ext ? "#fdf6ea" : internalIdx++ % 2 === 0 ? "#f1f5fa" : "#eff6f1";
                const empty = !flow.steps.some((s) => (s.lane || "（未設定）") === lane);
                return (
                  <div key={lane} className="fb-lane" style={{ left: i * CW, width: CW - 6, height }}>
                    <div className="fb-lane-head">
                      {editable && i > 0 && (
                        <button className="fb-lane-btn" title="左へ" onClick={() => change(moveLane(flow, lane, -1))}>
                          ‹
                        </button>
                      )}
                      <span>{lane}</span>
                      {editable && i < lay.lanes.length - 1 && (
                        <button className="fb-lane-btn" title="右へ" onClick={() => change(moveLane(flow, lane, 1))}>
                          ›
                        </button>
                      )}
                      {editable && empty && (
                        <button className="fb-lane-btn del" title="この列を外す" onClick={() => change(removeLane(flow, lane))}>
                          ×
                        </button>
                      )}
                    </div>
                    <div
                      className="fb-lane-body"
                      style={{ background: bg }}
                      onPointerDown={() => editable && setSel(null)}
                    />
                  </div>
                );
              })}

              {editable && (
                <AddLaneColumn
                  left={lay.lanes.length * CW}
                  height={height}
                  resources={resources}
                  lanes={flow.lanes}
                  onAdd={(name) => change(addLane(flow, name))}
                />
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
                      <path d={e.d} fill="none" stroke={on ? "#0b5cad" : e.color} strokeWidth={on ? 3.5 : 2.2} />
                      <polygon points={arrowHead(e.end, e.angle)} fill={on ? "#0b5cad" : e.color} />
                      {editable && (
                        <path
                          d={e.d}
                          className="fb-edge-hit"
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
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
                    style={{ left: e.lx, top: e.ly, borderColor: e.color, color: e.color }}
                    onPointerDown={(ev) => {
                      if (!editable) return;
                      ev.stopPropagation();
                      setSel({ type: "edge", from: e.from, to: e.to });
                    }}
                  >
                    {e.label}
                  </div>
                ))}

              {[...lay.placed.values()].map((p) => {
                const g = geom(p);
                const s = p.step;
                const num = nums.get(s.id);
                const changeColor = s.change ? CHANGE_COLORS[s.change] : null;
                const dragging = drag?.id === s.id && drag.moved;
                return (
                  <div
                    key={s.id}
                    className={`fb-node${selectedNodeId === s.id ? " selected" : ""}${editable ? " clickable" : ""}${dragging ? " dragging" : ""}`}
                    style={{
                      left: g.cx - NODE_W / 2,
                      top: g.y0,
                      transform: dragging ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined,
                      ...(changeColor ? { borderColor: changeColor, background: `${changeColor}12` } : {}),
                    }}
                    onPointerDown={(e) => {
                      if (!editable || e.button !== 0) return;
                      e.preventDefault();
                      setDrag({ id: s.id, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false });
                    }}
                    onDoubleClick={() => {
                      if (!editable) return;
                      setSel({ type: "node", id: s.id });
                      setFocusName((n) => n + 1);
                    }}
                    title={editable ? undefined : [s.issue && `ボトルネック：${s.issue}`, s.issue_detail, s.note].filter(Boolean).join("\n")}
                  >
                    {s.change && (
                      <span className="fb-change" style={{ background: changeColor! }}>
                        {s.change}
                      </span>
                    )}
                    <div className="fb-icons">
                      <div className="fb-person">
                        <Person />
                        {num !== undefined && <span className="fb-num">{num}</span>}
                        {s.money && <span className="fb-yen">¥</span>}
                      </div>
                      {s.pc && <Monitor />}
                      {s.tool && <ToolTag tool={s.tool} resources={resources} />}
                    </div>
                    <div className="fb-label">
                      {s.name || <span className="muted">（作業名を入力）</span>}
                      <span className="fb-meta">
                        {s.type !== "作業" && <span className="fb-type">{s.type}</span>}
                        {s.minutes > 0 && <span>{s.minutes}分</span>}
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
          )}
        </div>
        <Legend tobe={isTobe} maxWidth={flow.steps.length ? width : undefined} />
      </div>
      {editable && selection?.type === "node" && selectedStep ? (
        <NodeInspector
          key={selectedStep.id}
          step={selectedStep}
          flow={flow}
          resources={resources}
          isTobe={isTobe}
          focusName={focusName}
          onChange={change}
          onClose={() => setSel(null)}
          onInsertBelow={() => {
            const { flow: f, id } = insertBelow(flow, selectedStep.id, isTobe);
            change(f);
            setSel({ type: "node", id });
            setFocusName((n) => n + 1);
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

function AddLaneColumn({
  left, height, resources, lanes, onAdd,
}: { left: number; height: number; resources: Resource[]; lanes: string[]; onAdd: (name: string) => void }) {
  const [text, setText] = useState("");
  const candidates = resources
    .filter((r) => ["部署", "担当者", "取引先"].includes(r.kind) && !lanes.includes(r.name))
    .map((r) => r.name);
  return (
    <div className="fb-addlane" style={{ left, width: ADD_COL_W - 10, height }}>
      <div className="fb-addlane-head">＋ 列（担当）を追加</div>
      <div className="fb-addlane-body">
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
          <IssueList issues={issues} nums={nums} empty="ボトルネックのあるステップに「見出し」を入れると、ここに一覧が出ます" />
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
                  <b className="strike">{s.name}</b>
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
  return (
    <ul className="fb-issues">
      {issues.map((s) => (
        <li key={s.id}>
          <span className="fb-num static">{nums.get(s.id)}</span>
          <div>
            <b>{s.issue}</b>
            {s.issue_detail && <small>{s.issue_detail}</small>}
          </div>
          {s.third_party && <span className="fb-third">第三者の気づき</span>}
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
      <span>画面＝PC作業</span>
      <span>色付きの札＝使っている道具（エクセル・FAX・紙など）</span>
      <span>
        <i className="fb-num mini">1</i>＝ボトルネック
      </span>
      <span>¥＝お金の流れ</span>
      <span>第三者の気づき＝現場が当たり前と思っていた点</span>
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

