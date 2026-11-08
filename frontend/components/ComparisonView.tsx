"use client";

import { compare, formatMinutes } from "@/lib/flow";
import { CHANGE_COLORS, type Flow, type Resource } from "@/lib/types";
import { FlowBoard } from "./FlowBoard";

interface Props {
  asis: Flow;
  tobe: Flow;
  resources: Resource[];
  frequency: string;
  execView?: string;
  fieldView?: string;
}

export function ComparisonView({ asis, tobe, resources, frequency, execView, fieldView }: Props) {
  const c = compare(asis, tobe, resources);
  const changed = tobe.steps.filter((s) => s.change);
  const tobeIds = new Set(tobe.steps.map((s) => s.id));
  const removed = asis.steps.filter((s) => !tobeIds.has(s.id));
  // TO-BEはAS-ISをコピーして作るので、同じIDの作業が「変更前」にあたる
  const asisById = new Map(asis.steps.map((s) => [s.id, s]));

  // 作業ごとの削減時間（分）＝ 変更前の所要時間 − 変更後の所要時間
  const savedOf = (beforeMin: number, afterMin: number) => beforeMin - afterMin;
  const rows = [
    ...removed.map((s) => ({ key: `r-${s.id}`, saved: savedOf(s.minutes, 0) })),
    ...changed.map((s) => ({ key: `c-${s.id}`, saved: savedOf(asisById.get(s.id)?.minutes ?? 0, s.minutes) })),
  ];
  const tableTotal = rows.reduce((n, r) => n + r.saved, 0);
  const overall = c.asis_minutes - c.tobe_minutes;

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi good">
          <span className="kpi-label">削減時間（1回あたり）</span>
          <span className={`kpi-big${overall < 0 ? " minus" : ""}`}>
            {overall < 0 ? "−" : ""}
            {formatMinutes(Math.abs(overall))}
          </span>
          {frequency && <span className="kpi-sub">頻度：{frequency}</span>}
        </div>
      </div>

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
                <th className="num">削減時間</th>
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
                  <td className="muted">TO-BEでなくなった作業</td>
                  <SavedCell min={savedOf(s.minutes, 0)} />
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
                    <SavedCell min={savedOf(before?.minutes ?? 0, s.minutes)} />
                  </tr>
                );
              })}
              {removed.length + changed.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center">
                    TO-BEで「変更区分」を設定するか、作業を削除すると、ここに表示されます
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="total-row">
                  <td colSpan={5}>合計</td>
                  <SavedCell min={tableTotal} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {rows.length > 0 && tableTotal !== overall && (
          <p className="muted small">
            ※ 変更区分を付けていない作業の時間も変わっているため、業務全体の削減時間（{formatMinutes(Math.abs(overall))}
            {overall >= 0 ? "削減" : "増加"}）とは一致しません。
          </p>
        )}
      </section>

      <h3 className="bar asis">AS-IS（現状）</h3>
      <FlowBoard flow={asis} resources={resources} kind="asis" execView={execView} fieldView={fieldView} />
      <h3 className="bar tobe">TO-BE（改善後）</h3>
      <FlowBoard flow={tobe} resources={resources} kind="tobe" base={asis} />
    </div>
  );
}

/** 削減時間のセル。減った時間は緑、増えた時間は赤のマイナス表示 */
function SavedCell({ min }: { min: number }) {
  if (min === 0) return <td className="num muted">―</td>;
  return (
    <td className={`num saved ${min > 0 ? "down" : "up"}`} title={min > 0 ? undefined : "時間が増えた作業"}>
      {min > 0 ? formatMinutes(min) : `−${formatMinutes(-min)}`}
    </td>
  );
}
