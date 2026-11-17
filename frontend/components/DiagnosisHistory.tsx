"use client";

import Link from "next/link";
import { useState } from "react";
import { EffortChart } from "@/components/EffortChart";
import { api } from "@/lib/api";
import { formatDate, formatHours } from "@/lib/diagnosis";
import { formatMinutes } from "@/lib/flow";
import {
  DIAGNOSIS_KINDS, DIAGNOSIS_LABEL,
  type Business, type Diagnosis, type DiagnosisIn, type Effort, type VersionRef,
} from "@/lib/types";

type Guard = (fn: () => Promise<unknown>) => Promise<void>;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** 版の保存日時（2026/11/17 14:05） */
function savedAt(v: VersionRef): string {
  if (!v.saved_at) return "";
  const d = new Date(v.saved_at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 診断・ヒアリングの履歴（企業ページの最初のタブ）。
 * 診断を記録するときに、業務ごとに「そのときのAS-ISの版」を選ぶ。
 * 右側には、全業務の削減工数（月あたり。AS-ISの第1版とくらべて）を大きく出す。
 */
export function DiagnosisHistory({
  cid, isAdmin, diagnoses, businesses, versions, effort, onChange, guard, formOpen, setFormOpen,
}: {
  cid: number;
  isAdmin: boolean;
  /** 新しい順 */
  diagnoses: Diagnosis[];
  businesses: Business[];
  /** 全業務のAS-ISの版の見出し（業務ごとに、古い順） */
  versions: VersionRef[];
  /** 全業務の削減工数（読み込み中は null） */
  effort: Effort | null;
  onChange: () => void;
  guard: Guard;
  /** 記録の入力欄を開いているか（企業ページの上のボタンからも開く） */
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
}) {
  /** 直している記録（null＝新しく記録） */
  const [editing, setEditing] = useState<Diagnosis | null>(null);

  const close = () => {
    setEditing(null);
    setFormOpen(false);
  };

  return (
    <div className="history-grid">
      <div className="stack">
        {isAdmin && !formOpen && !editing && diagnoses.length > 0 && (
          <div>
            <button className="btn primary" onClick={() => setFormOpen(true)}>
              ＋ 診断を記録
            </button>
          </div>
        )}
        {(formOpen || editing) && isAdmin && (
          <DiagnosisForm
            key={editing?.id ?? "new"}
            initial={editing}
            businesses={businesses}
            versions={versions}
            onCancel={close}
            onSave={(body) =>
              guard(async () => {
                if (editing) await api.updateDiagnosis(editing.id, body);
                else await api.createDiagnosis(cid, body);
                close();
                onChange();
              })
            }
          />
        )}

        {diagnoses.length === 0 && !formOpen && (
          <div className="empty-state card">
            <p>
              診断の記録はまだありません。
              <br />
              <span className="muted small">
                診断を記録するときに、業務ごとに「そのときのAS-ISの版」を選びます。どの時点の業務フローをもとに話したかが、あとから分かります。
              </span>
            </p>
            {isAdmin && (
              <button className="btn primary" onClick={() => setFormOpen(true)}>
                最初の診断を記録
              </button>
            )}
          </div>
        )}

        {diagnoses.map((d, i) => (
          <article key={d.id} className={`diag-card${i === 0 ? " latest" : ""}`}>
            <header>
              <div className="diag-title">
                <time>{formatDate(d.date)}</time>
                <span className={`diag-badge ${d.kind}`}>
                  {DIAGNOSIS_LABEL[d.kind]}
                </span>
              </div>
              <span className="muted small">{d.staff || d.created_by}</span>
            </header>
            {d.participants && <p className="diag-line">参加：{d.participants}</p>}
            {d.note && <p className="diag-note">{d.note}</p>}
            {d.versions.length > 0 && (
              <ul className="diag-flows">
                {d.versions.map((v) => (
                  <li key={v.business_id}>
                    <Link className="link" href={`/businesses/${v.business_id}`} title="業務ページのAS-ISタブで、この版を見られます">
                      {v.business_name}
                      <span>第{v.number}版</span>
                    </Link>
                    <span className={`diag-saved${v.saved_hours != null && v.saved_hours < 0 ? " minus" : ""}`}>
                      {v.saved_hours == null ? "—" : `削減 ${formatHours(v.saved_hours)}／月`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="diag-chips">
              {d.versions.length === 0 && <span className="tag muted">AS-ISの選択なし</span>}
              {isAdmin && (
                <span className="diag-actions">
                  <button
                    className="btn ghost small-btn"
                    onClick={() => {
                      setFormOpen(false);
                      setEditing(d);
                    }}
                  >
                    詳細
                  </button>
                  <button
                    className="btn-delete"
                    onClick={() =>
                      confirm(`${formatDate(d.date)} の記録を削除しますか？（AS-ISの版そのものは消えません）`) &&
                      guard(() => api.deleteDiagnosis(d.id).then(onChange))
                    }
                  >
                    削除
                  </button>
                </span>
              )}
            </div>
          </article>
        ))}
      </div>

      <aside className="stack">
        <EffortPanel effort={effort} />
      </aside>
    </div>
  );
}

/**
 * 全業務の削減工数（月あたり・時間）。経営者にひと目で伝わるように、合計を大きく出す。
 * 業務ごとに、AS-ISの第1版といちばん新しい版をくらべた値（版ごとに入力した値があれば、その値）。
 */
function EffortPanel({ effort }: { effort: Effort | null }) {
  const rows = effort?.businesses ?? [];
  // いちばん長い棒（第1版のときの作業時間がいちばん多い業務）を、横幅いっぱいにする
  const longest = Math.max(1, ...rows.map((r) => Math.max(0, r.current_hours ?? 0) + Math.max(0, r.saved_hours ?? 0)));
  const unknown = rows.filter((r) => r.saved_hours == null || r.current_hours == null);
  const total = effort?.total_hours ?? null;
  return (
    <section>
      <h3>削減工数（全業務・月あたり）</h3>
      <div className="card effort-panel">
        {!effort ? (
          <p className="muted small">読み込み中…</p>
        ) : rows.length === 0 ? (
          <p className="muted small">AS-ISを保存すると、最初の版（第1版）とくらべて減った作業時間が、ここに出ます。</p>
        ) : (
          <>
            <div className="effort-hero">
              <span className="effort-cap">減った作業時間</span>
              <span className={`effort-big${total != null && total < 0 ? " minus" : ""}`}>
                {total == null ? "—" : formatHours(total).replace("時間", "")}
                <small>時間／月</small>
              </span>
              <span className="muted small">AS-ISの第1版とくらべて（{rows.length}業務の合計）</span>
            </div>
            <div className="effort-hero now">
              <span className="effort-cap">いまの作業時間</span>
              <span className="effort-big">
                {effort.current_hours == null ? "—" : formatHours(effort.current_hours).replace("時間", "")}
                <small>時間／月</small>
              </span>
              <span className="muted small">いちばん新しいAS-ISの作業時間 × 月の件数（全業務の合計）</span>
            </div>
            {/* 業務ごとの横棒：棒ぜんたい＝第1版のときの作業時間。青＝いまの作業時間、緑＝減った時間 */}
            <div className="effort-chart">
              <div className="effort-legend" aria-hidden>
                <span><i className="now" />いまの作業時間</span>
                <span><i className="saved" />減った時間</span>
              </div>
              <ul>
                {rows.map((r) => {
                  const now = Math.max(0, r.current_hours ?? 0);
                  const saved = Math.max(0, r.saved_hours ?? 0);
                  const grew = r.saved_hours != null && r.saved_hours < 0;
                  return (
                    <li
                      key={r.business_id}
                      title={`${r.name}：いま ${formatHours(r.current_hours)}／月、減った時間 ${formatHours(r.saved_hours)}／月（1件あたり ${formatMinutes(r.first_minutes)} → ${formatMinutes(r.latest_minutes)}・第${r.versions}版）`}
                    >
                      <Link className="link" href={`/businesses/${r.business_id}`}>
                        {r.name}
                      </Link>
                      <span className="effort-bar" style={{ width: `${Math.max(2, ((now + saved) / longest) * 100)}%` }} aria-hidden>
                        {now > 0 && <span className="now" style={{ flexGrow: now }} />}
                        {saved > 0 && <span className="saved" style={{ flexGrow: saved }} />}
                      </span>
                      <span className="effort-nums">
                        <span>
                          いま <b>{formatHours(r.current_hours)}</b>
                        </span>
                        <span>
                          {grew ? "増えた時間 " : "減った時間 "}
                          <b className={grew ? "minus" : "saved"}>{r.saved_hours == null ? "—" : formatHours(Math.abs(r.saved_hours))}</b>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            {unknown.length > 0 && (
              <p className="muted small">
                「—」の業務は、月の件数が分からないため出せません。業務ページの「業務情報を編集」で月の件数を入れるか、版ごとに削減工数を入力してください。
              </p>
            )}
            {effort.months.length > 1 && (
              <>
                <span className="form-label">月ごとの推移</span>
                <EffortChart
                  ariaLabel="全業務の削減工数の、月ごとの推移"
                  points={effort.months.map((m) => ({
                    key: m.month,
                    label: m.month.slice(2).replace("-", "/"),
                    value: m.hours,
                    title: `${m.month.replace("-", "/")}：${formatHours(m.hours)}／月`,
                  }))}
                />
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** 診断を記録する・直す入力欄 */
function DiagnosisForm({
  initial, businesses, versions, onSave, onCancel,
}: {
  initial: Diagnosis | null;
  businesses: Business[];
  versions: VersionRef[];
  onSave: (body: DiagnosisIn) => void;
  onCancel: () => void;
}) {
  // 業務ごとの版（新しい順）。版のある業務だけが選べる
  const byBusiness = new Map<number, VersionRef[]>();
  for (const v of versions) byBusiness.set(v.business_id, [v, ...(byBusiness.get(v.business_id) ?? [])]);
  const selectable = businesses.filter((b) => byBusiness.has(b.id));

  const [f, setF] = useState(() =>
    initial
      ? { date: initial.date, kind: initial.kind, participants: initial.participants, staff: initial.staff, note: initial.note, gaps: initial.gaps }
      : { date: today(), kind: "annual" as DiagnosisIn["kind"], participants: "", staff: "", note: "", gaps: [] as Diagnosis["gaps"] },
  );
  /** 業務ID → 選んだ版のID（選ばない業務は入れない）。新しく記録するときは、各業務のいちばん新しい版 */
  const [picked, setPicked] = useState<Record<number, number>>(() =>
    initial
      ? Object.fromEntries(initial.versions.map((v) => [v.business_id, v.version_id]))
      : Object.fromEntries(selectable.map((b) => [b.id, byBusiness.get(b.id)![0].id])),
  );

  return (
    <form
      className="card diag-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (f.date) onSave({ ...f, version_ids: Object.values(picked) });
      }}
    >
      <strong>{initial ? "記録の詳細" : "診断を記録"}</strong>
      <div className="form-row">
        <label>
          実施日
          <input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label>
          種類
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DiagnosisIn["kind"] })}>
            {DIAGNOSIS_KINDS.map((k) => (
              <option key={k} value={k}>
                {DIAGNOSIS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          参加者
          <input placeholder="例：経営者、受注課、倉庫" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} />
        </label>
        <label className="grow">
          銀行側の担当
          <input placeholder="例：DX支援部門 田中／営業店 佐藤" value={f.staff} onChange={(e) => setF({ ...f, staff: e.target.value })} />
        </label>
      </div>
      <label>
        内容（話したこと・提案したこと・決まったこと）
        <textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>

      <div className="stack">
        <span className="form-label">このときのAS-IS（チェックした業務について、どの版かを選びます）</span>
        {selectable.length === 0 ? (
          <p className="small error-text">AS-ISのある業務がまだありません。先に「業務フロー」タブでAS-ISを作って保存してください。</p>
        ) : (
          <ul className="version-list">
            {selectable.map((b) => {
              const list = byBusiness.get(b.id)!;
              const on = picked[b.id] != null;
              const { [b.id]: _removed, ...rest } = picked;
              return (
                <li key={b.id} className={on ? "" : "off"}>
                  <label className="version-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setPicked(e.target.checked ? { ...rest, [b.id]: list[0].id } : rest)}
                    />
                    <span>{b.name}</span>
                  </label>
                  {on ? (
                    <select
                      aria-label={`${b.name}の版`}
                      value={picked[b.id]}
                      onChange={(e) => setPicked({ ...rest, [b.id]: Number(e.target.value) })}
                    >
                      {list.map((v, i) => (
                        <option key={v.id} value={v.id}>
                          第{v.number}版（{savedAt(v)}）{i === 0 ? "　最新" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted small">この記録には含めません</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="row end gap">
        <button type="button" className="btn ghost" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit" className="btn primary" disabled={!f.date}>
          {initial ? "保存" : "記録する"}
        </button>
      </div>
    </form>
  );
}
