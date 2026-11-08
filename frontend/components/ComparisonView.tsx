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

  const kpis = [
    { label: "手入力・転記", a: `${c.asis_manual}回`, b: `${c.tobe_manual}回` },
    { label: "メール連絡", a: `${c.asis_mail}回`, b: `${c.tobe_mail}回` },
    { label: "紙", a: `${c.asis_paper}か所`, b: `${c.tobe_paper}か所` },
    { label: "1回あたりの時間", a: formatMinutes(c.asis_minutes), b: formatMinutes(c.tobe_minutes) },
    { label: "ボトルネック", a: `${c.asis_issues}件`, b: `${c.tobe_issues}件` },
  ];

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi good">
          <span className="kpi-label">時間の削減率</span>
          <span className="kpi-big">{c.reduction_rate}%</span>
          {frequency && <span className="kpi-sub">頻度：{frequency}</span>}
        </div>
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-val">
              {k.a} <span className="muted">→</span> <strong>{k.b}</strong>
            </span>
          </div>
        ))}
      </div>

      <section>
        <h3>変更点</h3>
        <div className="table-wrap">
          <table className="plain">
            <thead>
              <tr>
                <th>区分</th>
                <th>作業</th>
                <th>担当</th>
                <th>変更内容</th>
              </tr>
            </thead>
            <tbody>
              {removed.map((s) => (
                <tr key={`r-${s.id}`}>
                  <td>
                    <span className="tag" style={{ color: CHANGE_COLORS["排除"], borderColor: CHANGE_COLORS["排除"] }}>
                      排除
                    </span>
                  </td>
                  <td className="strike">{s.name}</td>
                  <td>{s.lane}</td>
                  <td className="muted">TO-BEでなくなった作業</td>
                </tr>
              ))}
              {changed.map((s) => (
                <tr key={`c-${s.id}`}>
                  <td>
                    <span className="tag" style={{ color: CHANGE_COLORS[s.change!], borderColor: CHANGE_COLORS[s.change!] }}>
                      {s.change}
                    </span>
                  </td>
                  <td>{s.name}</td>
                  <td>{s.lane}</td>
                  <td>{s.note}</td>
                </tr>
              ))}
              {removed.length + changed.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted center">
                    TO-BEで「変更区分」を設定するか、作業を削除すると、ここに表示されます
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <h3 className="bar asis">AS-IS（現状）</h3>
      <FlowBoard flow={asis} resources={resources} kind="asis" execView={execView} fieldView={fieldView} />
      <h3 className="bar tobe">TO-BE（あるべき姿）</h3>
      <FlowBoard flow={tobe} resources={resources} kind="tobe" base={asis} />
    </div>
  );
}
