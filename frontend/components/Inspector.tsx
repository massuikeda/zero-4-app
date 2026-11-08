"use client";

/** 図で選んだ作業・矢印の設定パネル（パワポの「書式設定」のような右側の欄） */
import { useEffect, useRef } from "react";
import { disconnect, removeStep, updateEdge, updateStep } from "@/lib/edit";
import { mediaColor, toolLabel } from "@/lib/flow";
import { CHANGE_ACTIONS, CHANGE_COLORS, MEDIA, STEP_TYPES, type Flow, type Resource, type Step, type StepType } from "@/lib/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="insp-sec">
      <div className="insp-title">{title}</div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`insp-toggle${on ? " on" : ""}`} onClick={onClick}>
      {on ? "✓ " : ""}
      {children}
    </button>
  );
}

export function NodeInspector({
  step, flow, resources, isTobe, focusName, onFocused, onChange, onClose, onInsertBelow, onSelectEdge,
}: {
  step: Step;
  flow: Flow;
  resources: Resource[];
  isTobe: boolean;
  /** true のときだけ作業名の欄にカーソルを置く（図で作業をダブルクリックしたとき） */
  focusName: boolean;
  onFocused: () => void;
  onChange: (f: Flow, merge?: boolean) => void;
  onClose: () => void;
  onInsertBelow: () => void;
  onSelectEdge: (to: string) => void;
}) {
  const nameRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
    onFocused();
  }, [focusName, onFocused]);

  const set = (patch: Partial<Step>) => onChange(updateStep(flow, step.id, patch));
  /** 文字入力用（続けて打った分は「元に戻す」1回にまとめる） */
  const type = (patch: Partial<Step>) => onChange(updateStep(flow, step.id, patch), true);
  const tools = resources.filter((r) => r.kind === "システム" || r.kind === "帳票").map((r) => r.name);
  const lanes = [...new Set([...flow.lanes, step.lane].filter(Boolean))];
  const name = (id: string) => flow.steps.find((s) => s.id === id)?.name || "（名前なし）";
  const isBottleneck = step.issue !== null;

  return (
    <aside className="fb-side insp">
      <div className="insp-head">
        <span>作業の設定</span>
        <button className="icon" title="閉じる（Esc）" onClick={onClose}>
          ×
        </button>
      </div>

      <Section title="作業名">
        <textarea
          ref={nameRef}
          rows={2}
          value={step.name}
          placeholder="例：FAXを見て手入力"
          onChange={(e) => type({ name: e.target.value })}
        />
      </Section>

      <Section title="担当（列）">
        <select value={step.lane} onChange={(e) => set({ lane: e.target.value })}>
          {lanes.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </Section>

      <Section title="使っている道具（色付きの札）">
        <div className="insp-chips">
          <Toggle on={!step.tool} onClick={() => set({ tool: "" })}>
            なし
          </Toggle>
          {tools.map((t) => (
            <Toggle key={t} on={step.tool === t} onClick={() => set({ tool: step.tool === t ? "" : t })}>
              {toolLabel(t)}
            </Toggle>
          ))}
        </div>
        <input
          placeholder="その他（自由入力）"
          value={tools.includes(step.tool) ? "" : step.tool}
          onChange={(e) => type({ tool: e.target.value })}
        />
      </Section>

      <Section title="印">
        <div className="insp-chips">
          <Toggle on={step.pc} onClick={() => set({ pc: !step.pc })}>
            画面（PC作業）
          </Toggle>
          <Toggle on={step.money} onClick={() => set({ money: !step.money })}>
            ¥ お金の流れ
          </Toggle>
        </div>
      </Section>

      <div className="insp-row">
        <Section title="所要時間（分）">
          <input
            type="number"
            min={0}
            value={step.minutes}
            onChange={(e) => type({ minutes: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Section>
        <Section title="種別">
          <select value={step.type} onChange={(e) => set({ type: e.target.value as StepType })}>
            {STEP_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Section>
      </div>

      <Section title="ボトルネック（作業名が赤くなる）">
        <Toggle
          on={isBottleneck}
          onClick={() =>
            set(
              isBottleneck
                ? { issue: null, issue_time: "", issue_error: "", issue_detail: "", third_party: false }
                : { issue: "ボトルネック" },
            )
          }
        >
          ボトルネックにする
        </Toggle>
        {isBottleneck && (
          <>
            <label className="insp-sub">
              業務の時間がかかっている理由
              <textarea
                rows={2}
                placeholder="例：手書きの文字を読み取りながら1件ずつ入力している"
                value={step.issue_time}
                onChange={(e) => type({ issue_time: e.target.value })}
              />
            </label>
            <label className="insp-sub">
              ミスの原因
              <textarea
                rows={2}
                placeholder="例：手書き文字の読み間違い"
                value={step.issue_error}
                onChange={(e) => type({ issue_error: e.target.value })}
              />
            </label>
            {(step.issue_detail || (step.issue && step.issue !== "ボトルネック")) && !step.issue_time && !step.issue_error && (
              <p className="insp-note">
                以前の入力：{[step.issue !== "ボトルネック" ? step.issue : "", step.issue_detail].filter(Boolean).join("／")}
              </p>
            )}
          </>
        )}
      </Section>

      {isTobe && (
        <Section title="変更区分（TO-BE）">
          <div className="insp-chips">
            <Toggle on={!step.change} onClick={() => set({ change: null })}>
              変更なし
            </Toggle>
            {CHANGE_ACTIONS.filter((a) => a !== "排除").map((a) => (
              <button
                key={a}
                type="button"
                className={`insp-toggle${step.change === a ? " on" : ""}`}
                style={step.change === a ? { background: CHANGE_COLORS[a], borderColor: CHANGE_COLORS[a] } : {}}
                onClick={() => set({ change: a })}
              >
                {a}
              </button>
            ))}
          </div>
          <p className="insp-note">なくす作業は「この作業を削除」で消すと、「排除」として比較に出ます。</p>
        </Section>
      )}

      <Section title={isTobe ? "変更内容" : "補足"}>
        <textarea rows={2} value={step.note} onChange={(e) => type({ note: e.target.value })} />
      </Section>

      <Section title="次の作業への矢印">
        {step.next.length === 0 && <p className="insp-note">作業の右にある「→」をドラッグして、つなぎたい作業の上で離します。</p>}
        <ul className="insp-edges">
          {step.next.map((n, i) => (
            <li key={n}>
              <button className="insp-link" onClick={() => onSelectEdge(n)}>
                → {name(n)}
                {step.next_media[i] && (
                  <span className="insp-media" style={{ color: mediaColor(step.next_media[i]) }}>
                    （{step.next_media[i]}）
                  </span>
                )}
              </button>
              <button className="icon danger" title="矢印を削除" onClick={() => onChange(disconnect(flow, step.id, n))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <div className="insp-actions">
        <button className="btn ghost" onClick={onInsertBelow}>
          ＋ 下に作業を追加
        </button>
        <button className="btn ghost danger-btn" onClick={() => onChange(removeStep(flow, step.id))}>
          この作業を削除
        </button>
      </div>
    </aside>
  );
}

export function EdgeInspector({
  flow, from, to, onChange, onClose, onSelectNode,
}: {
  flow: Flow;
  from: string;
  to: string;
  onChange: (f: Flow, merge?: boolean) => void;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const src = flow.steps.find((s) => s.id === from)!;
  const k = src.next.indexOf(to);
  const media = src.next_media[k] ?? "";
  const label = src.condition_labels[k] ?? "";
  const name = (id: string) => flow.steps.find((s) => s.id === id)?.name || "（名前なし）";
  const set = (patch: { media?: string; label?: string }) => onChange(updateEdge(flow, from, to, patch));
  const type = (patch: { media?: string; label?: string }) => onChange(updateEdge(flow, from, to, patch), true);

  return (
    <aside className="fb-side insp">
      <div className="insp-head">
        <span>矢印の設定</span>
        <button className="icon" title="閉じる（Esc）" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="insp-flow">
        <button className="insp-link" onClick={() => onSelectNode(from)}>
          {name(from)}
        </button>
        <span> → </span>
        <button className="insp-link" onClick={() => onSelectNode(to)}>
          {name(to)}
        </button>
      </p>

      <Section title="受け渡し手段（矢印の上のラベル）">
        <div className="insp-chips">
          <Toggle on={!media} onClick={() => set({ media: "" })}>
            なし
          </Toggle>
          {MEDIA.map((m) => (
            <button
              key={m}
              type="button"
              className={`insp-toggle${media === m ? " on" : ""}`}
              style={media === m ? { background: mediaColor(m), borderColor: mediaColor(m) } : { color: mediaColor(m) }}
              onClick={() => set({ media: m })}
            >
              {m}
            </button>
          ))}
        </div>
        <input
          placeholder="その他（自由入力）"
          value={(MEDIA as readonly string[]).includes(media) ? "" : media}
          onChange={(e) => type({ media: e.target.value })}
        />
      </Section>

      <Section title="分岐ラベル（判断のとき）">
        <input placeholder="例：OK、差戻し" value={label} onChange={(e) => type({ label: e.target.value })} />
      </Section>

      <div className="insp-actions">
        <button className="btn ghost danger-btn" onClick={() => onChange(disconnect(flow, from, to))}>
          この矢印を削除
        </button>
      </div>
    </aside>
  );
}
