"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { newStep, nextStepId, renumber } from "@/lib/flow";
import {
  CHANGE_ACTIONS, MEDIA, STEP_TYPES, type ChangeAction, type Flow, type Resource, type Step, type StepType,
} from "@/lib/types";

interface Props {
  flow: Flow;
  onChange: (f: Flow) => void;
  resources: Resource[];
  isTobe: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

const split = (s: string) => s.split(/[,、]+/).map((x) => x.trim());
const splitIds = (s: string) => split(s).filter(Boolean);

export function FlowEditor({ flow, onChange, resources, isTobe, selectedId, onSelect }: Props) {
  const [laneInput, setLaneInput] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const laneCandidates = resources
    .filter((r) => ["部署", "担当者", "取引先"].includes(r.kind) && !flow.lanes.includes(r.name))
    .map((r) => r.name);
  const toolCandidates = resources.filter((r) => r.kind === "システム" || r.kind === "帳票").map((r) => r.name);

  // 図でステップをクリックしたら、その行を開いて表示する
  useEffect(() => {
    if (!selectedId) return;
    setOpen((o) => new Set(o).add(selectedId));
    rowRefs.current.get(selectedId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

  const setSteps = (steps: Step[]) => onChange({ ...flow, steps });
  const update = (i: number, patch: Partial<Step>) =>
    setSteps(flow.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addLane = (name: string) => {
    const n = name.trim();
    if (n && !flow.lanes.includes(n)) onChange({ ...flow, lanes: [...flow.lanes, n] });
    setLaneInput("");
  };
  const removeLane = (name: string) => {
    if (flow.steps.some((s) => s.lane === name) && !confirm(`「${name}」を使っているステップがあります。外しますか？`)) return;
    onChange({ ...flow, lanes: flow.lanes.filter((l) => l !== name) });
  };
  const moveLane = (i: number, d: number) => {
    const lanes = [...flow.lanes];
    const j = i + d;
    if (j < 0 || j >= lanes.length) return;
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    onChange({ ...flow, lanes });
  };

  /** i番目の後ろに挿入し、流れをつなぎ替える（i=-1 なら末尾） */
  const insertAfter = (i: number) => {
    const id = nextStepId(flow);
    const at = i < 0 ? flow.steps.length - 1 : i;
    const prev = flow.steps[at];
    const step = newStep(id, prev?.lane ?? flow.lanes[0] ?? "", isTobe);
    if (prev && prev.type !== "判断") {
      step.next = prev.next;
      step.next_media = prev.next_media;
    }
    const steps = flow.steps.map((s, j) =>
      j === at && s.type !== "判断" ? { ...s, next: [id], next_media: [""], condition_labels: [] } : s,
    );
    steps.splice(at + 1, 0, step);
    setSteps(steps);
    onSelect?.(id);
  };

  const remove = (i: number) => {
    const gone = flow.steps[i];
    // 削除するステップを経由していた流れは、その先につなぎ直す
    const steps = flow.steps
      .filter((_, j) => j !== i)
      .map((s) => {
        if (!s.next.includes(gone.id)) return s;
        const next: string[] = [];
        const media: string[] = [];
        const labels: string[] = [];
        s.next.forEach((n, k) => {
          if (n === gone.id) {
            gone.next.forEach((g, gi) => {
              if (!next.includes(g) && g !== s.id) {
                next.push(g);
                media.push(gone.next_media[gi] ?? "");
                labels.push(s.condition_labels[k] ?? "");
              }
            });
          } else {
            next.push(n);
            media.push(s.next_media[k] ?? "");
            labels.push(s.condition_labels[k] ?? "");
          }
        });
        return { ...s, next, next_media: media, condition_labels: s.condition_labels.length ? labels : [] };
      });
    setSteps(steps);
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= flow.steps.length) return;
    const steps = [...flow.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setSteps(steps);
  };

  const cols = isTobe ? 14 : 13;

  return (
    <div className="editor">
      <div className="lanes">
        <span className="label">列（担当）</span>
        {flow.lanes.map((l, i) => (
          <span className="chip" key={l}>
            {i > 0 && (
              <button title="左へ" onClick={() => moveLane(i, -1)}>
                ‹
              </button>
            )}
            {l}
            <button title="外す" onClick={() => removeLane(l)}>
              ×
            </button>
          </span>
        ))}
        <span className="lane-add">
          <select value="" onChange={(e) => addLane(e.target.value)}>
            <option value="">＋ リソースから追加</option>
            {laneCandidates.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <input
            placeholder="その他（入力してEnter）"
            value={laneInput}
            onChange={(e) => setLaneInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLane(laneInput)}
          />
        </span>
      </div>

      <datalist id="tool-candidates">
        {toolCandidates.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="media-candidates">
        {MEDIA.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="table-wrap">
        <table className="steps">
          <thead>
            <tr>
              <th />
              <th>ID</th>
              <th>担当</th>
              <th>作業</th>
              <th>道具（札）</th>
              <th title="画面アイコン">PC</th>
              <th title="手入力・転記の集計に入る">手入力</th>
              <th title="お金の流れ">¥</th>
              <th>分</th>
              <th title="次に進むステップのID。複数はカンマ区切り">次へ</th>
              <th title="受け渡し手段（矢印のラベル）。「次へ」と同じ順">受け渡し</th>
              {isTobe && <th>変更区分</th>}
              <th>ボトルネック</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {flow.steps.map((s, i) => {
              const isOpen = open.has(s.id);
              return (
                <Fragment key={`${s.id}-${i}`}>
                  <tr
                    ref={(el) => {
                      if (el) rowRefs.current.set(s.id, el);
                      else rowRefs.current.delete(s.id);
                    }}
                    className={`${s.issue ? "has-issue" : ""}${selectedId === s.id ? " selected" : ""}`}
                    onFocus={() => onSelect?.(s.id)}
                  >
                    <td className="nowrap">
                      <button className="icon" title="上へ" onClick={() => move(i, -1)}>
                        ▲
                      </button>
                      <button className="icon" title="下へ" onClick={() => move(i, 1)}>
                        ▼
                      </button>
                    </td>
                    <td className="mono">{s.id}</td>
                    <td>
                      <select value={s.lane} onChange={(e) => update(i, { lane: e.target.value })}>
                        <option value="">（未設定）</option>
                        {[...new Set([...flow.lanes, s.lane].filter(Boolean))].map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="w-name"
                        value={s.name}
                        placeholder="例：FAXを見て手入力"
                        onChange={(e) => update(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="w-tool"
                        list="tool-candidates"
                        value={s.tool}
                        placeholder="エクセル等"
                        onChange={(e) => update(i, { tool: e.target.value })}
                      />
                    </td>
                    <td className="center">
                      <input type="checkbox" checked={s.pc} onChange={(e) => update(i, { pc: e.target.checked })} />
                    </td>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={s.manual_input}
                        onChange={(e) => update(i, { manual_input: e.target.checked })}
                      />
                    </td>
                    <td className="center">
                      <input type="checkbox" checked={s.money} onChange={(e) => update(i, { money: e.target.checked })} />
                    </td>
                    <td>
                      <input
                        className="w-num"
                        type="number"
                        min={0}
                        value={s.minutes}
                        onChange={(e) => update(i, { minutes: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td>
                      <input
                        className="w-ids"
                        value={s.next.join(",")}
                        onChange={(e) => update(i, { next: splitIds(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        className="w-media"
                        list="media-candidates"
                        value={s.next_media.slice(0, Math.max(1, s.next.length)).join(",")}
                        placeholder={s.next.length ? "メール等" : ""}
                        disabled={s.next.length === 0}
                        onChange={(e) => update(i, { next_media: split(e.target.value) })}
                      />
                    </td>
                    {isTobe && (
                      <td>
                        <select
                          value={s.change ?? ""}
                          onChange={(e) => update(i, { change: (e.target.value || null) as ChangeAction | null })}
                        >
                          <option value="">変更なし</option>
                          {CHANGE_ACTIONS.filter((a) => a !== "排除").map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td>
                      <input
                        className="w-issue"
                        value={s.issue ?? ""}
                        placeholder="なし"
                        onChange={(e) => update(i, { issue: e.target.value || null })}
                      />
                    </td>
                    <td className="nowrap">
                      <button className={`icon${isOpen ? " on" : ""}`} title="詳細" onClick={() => toggle(s.id)}>
                        {isOpen ? "▴詳細" : "▾詳細"}
                      </button>
                      <button className="icon" title="この下に追加" onClick={() => insertAfter(i)}>
                        ＋
                      </button>
                      <button className="icon danger" title="削除" onClick={() => remove(i)}>
                        ×
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row">
                      <td />
                      <td colSpan={cols - 1}>
                        <div className="detail-grid">
                          <label>
                            種別
                            <select value={s.type} onChange={(e) => update(i, { type: e.target.value as StepType })}>
                              {STEP_TYPES.map((t) => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            分岐ラベル（判断のとき。「次へ」と同じ順）
                            <input
                              value={s.condition_labels.join(",")}
                              placeholder="OK,差戻し"
                              onChange={(e) => update(i, { condition_labels: split(e.target.value) })}
                            />
                          </label>
                          <label className="wide">
                            ボトルネックの説明
                            <input
                              value={s.issue_detail}
                              placeholder="例：読み間違い・入力の手間"
                              disabled={!s.issue}
                              onChange={(e) => update(i, { issue_detail: e.target.value })}
                            />
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={s.third_party}
                              disabled={!s.issue}
                              onChange={(e) => update(i, { third_party: e.target.checked })}
                            />
                            第三者の気づき（現場が当たり前と思っていた点）
                          </label>
                          <label className="wide">
                            {isTobe ? "変更内容" : "補足"}
                            <input
                              value={s.note}
                              placeholder={isTobe ? "例：受注データからピッキングリストを自動出力" : ""}
                              onChange={(e) => update(i, { note: e.target.value })}
                            />
                          </label>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {flow.steps.length === 0 && (
              <tr>
                <td colSpan={cols} className="muted center">
                  まだステップがありません。先に「列（担当）」を追加し、「＋ ステップを追加」から始めてください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row gap">
        <button className="btn ghost" onClick={() => insertAfter(-1)}>
          ＋ ステップを追加
        </button>
        {/* TO-BEはAS-ISとIDで対応づけて比較するため、振り直しはAS-ISのみ */}
        {!isTobe && (
          <button className="btn ghost" onClick={() => onChange(renumber(flow))} disabled={flow.steps.length === 0}>
            番号を振り直す
          </button>
        )}
      </div>
    </div>
  );
}
