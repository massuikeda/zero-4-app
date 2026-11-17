"use client";

import { CHANGE_COLORS, type Flow, type Resource } from "@/lib/types";
import { FlowBoard } from "./FlowBoard";

interface Props {
  asis: Flow;
  tobe: Flow;
  resources: Resource[];
}

/** 比較タブ：AS-ISからTO-BEで、どの作業がどう変わるか（変更点の表と、2つの図） */
export function ComparisonView({ asis, tobe, resources }: Props) {
  const changed = tobe.steps.filter((s) => s.change);
  const tobeIds = new Set(tobe.steps.map((s) => s.id));
  const removed = asis.steps.filter((s) => !tobeIds.has(s.id));
  // TO-BEはAS-ISをコピーして作るので、同じIDの作業が「変更前」にあたる
  const asisById = new Map(asis.steps.map((s) => [s.id, s]));

  return (
    <div className="stack">
      <section>
        <h3>変更点</h3>
        <div className="table-wrap">
          <table className="plain changes-table">
            <thead>
              <tr>
                <th>区分</th>
                <th>担当</th>
                <th>変更前（AS-IS）</th>
                <th>変更後（TO-BE）</th>
                <th>変更内容</th>
              </tr>
            </thead>
            <tbody>
              {removed.map((s) => (
                <tr key={`r-${s.id}`}>
                  <td className="chg-kind" style={{ color: CHANGE_COLORS["排除"] }}>
                    排除
                  </td>
                  <td>{s.lane}</td>
                  <td>{s.name || "（名前なし）"}</td>
                  <td className="muted">―（なくなる）</td>
                  <td className={tobe.removed_notes?.[s.id] ? "" : "muted"}>
                    {tobe.removed_notes?.[s.id] || "TO-BEでなくなった作業"}
                  </td>
                </tr>
              ))}
              {changed.map((s) => {
                const before = asisById.get(s.id);
                return (
                  <tr key={`c-${s.id}`}>
                    <td className="chg-kind" style={{ color: CHANGE_COLORS[s.change!] }}>
                      {s.change}
                    </td>
                    <td>{s.lane}</td>
                    <td>{before ? before.name : <span className="muted">―（新しく追加）</span>}</td>
                    <td>{s.name || "（名前なし）"}</td>
                    <td>{s.note}</td>
                  </tr>
                );
              })}
              {removed.length + changed.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">
                    TO-BEで「変更区分」を設定するか、作業を削除すると、ここに表示されます
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <h3 className="bar asis">AS-IS（現状）</h3>
      <FlowBoard flow={asis} resources={resources} kind="asis" />
      <h3 className="bar tobe">TO-BE（改善後）</h3>
      <FlowBoard flow={tobe} resources={resources} kind="tobe" base={asis} />
    </div>
  );
}
