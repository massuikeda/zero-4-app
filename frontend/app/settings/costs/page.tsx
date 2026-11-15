"use client";

import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { api } from "@/lib/api";
import { formatYen } from "@/lib/cost";
import type { CostItem } from "@/lib/types";

/** 金額の入力欄の文字を数値に直す。空は0。0以上の整数でなければ null（入力ミス） */
function parseYen(v: string): number | null {
  const t = v.trim().replace(/[,，]/g, "");
  if (!t) return 0;
  return /^\d+$/.test(t) ? Number(t) : null;
}

const EMPTY = { name: "", initial: "", monthly: "", note: "" };

/**
 * 単価表（全企業共通）。TO-BEの案で導入するもの（RPA・OCR など）の、初期費用と月額の目安。
 * 見るのも編集するのも銀行担当者だけ（企業の方には見せない）。
 */
export default function CostItemsPage() {
  const me = useMe();
  const isAdmin = me?.role === "admin";
  const [items, setItems] = useState<CostItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const load = useCallback(
    () =>
      api.costItems().then(
        (x) => {
          setItems(x);
          setLoaded(true);
        },
        (e) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [],
  );

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!me) return <p className="muted">読み込み中…</p>;
  if (!isAdmin) return <div className="alert">単価表は、銀行担当者だけが見られます。</div>;

  const initial = parseYen(form.initial);
  const monthly = parseYen(form.monthly);
  const canAdd = !!form.name.trim() && initial !== null && monthly !== null;

  const add = () =>
    guard(async () => {
      if (!canAdd) return;
      await api.createCostItem({
        name: form.name.trim(), initial_cost: initial ?? 0, monthly_cost: monthly ?? 0, note: form.note.trim(),
        sort: items.reduce((n, x) => Math.max(n, x.sort), 0) + 1,
      });
      setForm(EMPTY);
      await load();
    });

  /** 1か所を書き換えて保存する（値が変わっていなければ何もしない） */
  const patch = (item: CostItem, change: Partial<CostItem>) => {
    const next = { ...item, ...change };
    if ((Object.keys(change) as (keyof CostItem)[]).every((k) => next[k] === item[k])) return;
    return guard(async () => {
      await api.updateCostItem(item.id, next);
      await load();
    });
  };

  return (
    <div className="stack">
      <Breadcrumbs items={[{ label: "企業一覧", href: "/" }, { label: "単価表" }]} />
      <h1>単価表</h1>
      <p className="muted small">
        TO-BEの案で導入するもの（RPA・OCR など）の、初期費用と月額の目安です。すべての企業で共通で、銀行担当者だけが見られます。
        比較タブの「初期費用」「月額費用」「回収期間」は、この表の金額を合計した概算です。
        AIは「どれを使うか」をこの表の名前から選ぶだけで、金額は決めません。単価表にないものは「要見積もり」と表示されます。
      </p>
      {error && <div className="alert">{error}</div>}

      <div className="table-wrap">
        <table className="plain cost-table">
          <thead>
            <tr>
              <th>名前</th>
              <th className="num">初期費用（円）</th>
              <th className="num">月額（円）</th>
              <th>メモ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              // key に値も入れておき、保存し直したら入力欄を作り直す（入力ミスを元の値に戻すため）
              <tr key={`${x.id}:${x.name}:${x.initial_cost}:${x.monthly_cost}:${x.note}`}>
                <td>
                  <input
                    defaultValue={x.name}
                    aria-label="名前"
                    onBlur={(e) => (e.target.value.trim() ? patch(x, { name: e.target.value.trim() }) : (e.target.value = x.name))}
                  />
                </td>
                {(["initial_cost", "monthly_cost"] as const).map((k) => (
                  <td className="num" key={k}>
                    <input
                      className="yen"
                      inputMode="numeric"
                      defaultValue={x[k]}
                      aria-label={k === "initial_cost" ? "初期費用（円）" : "月額（円）"}
                      title={formatYen(x[k])}
                      onBlur={(e) => {
                        const n = parseYen(e.target.value);
                        if (n === null) {
                          e.target.value = String(x[k]);
                          setError("金額は0以上の整数（円）で入力してください");
                        } else patch(x, { [k]: n });
                      }}
                    />
                  </td>
                ))}
                <td>
                  <input defaultValue={x.note} aria-label="メモ" onBlur={(e) => patch(x, { note: e.target.value.trim() })} />
                </td>
                <td>
                  <button
                    className="btn-delete"
                    title="削除"
                    onClick={() =>
                      confirm(`「${x.name}」を単価表から削除しますか？\nこの名前を使っている案では「要見積もり」と表示されるようになります。`) &&
                      guard(() => api.deleteCostItem(x.id).then(load))
                    }
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {loaded && items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center">
                  単価表は空です
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        className="card dashed cost-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <strong>単価表に追加</strong>
        <div className="row gap wrap">
          <label className="field">
            <span className="small muted">名前（必須）</span>
            <input placeholder="例：RPA" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field narrow">
            <span className="small muted">初期費用（円）</span>
            <input inputMode="numeric" placeholder="例：300000" value={form.initial} aria-invalid={initial === null}
              onChange={(e) => setForm({ ...form, initial: e.target.value })} />
          </label>
          <label className="field narrow">
            <span className="small muted">月額（円）</span>
            <input inputMode="numeric" placeholder="例：150000" value={form.monthly} aria-invalid={monthly === null}
              onChange={(e) => setForm({ ...form, monthly: e.target.value })} />
          </label>
          <label className="field">
            <span className="small muted">メモ</span>
            <input placeholder="例：画面操作・転記の自動実行" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button type="submit" className="btn primary" disabled={!canAdd}>
            追加
          </button>
        </div>
        {(initial === null || monthly === null) && <span className="small error-text">金額は0以上の整数（円）で入力してください</span>}
      </form>
      <p className="muted small">
        ※ 名前・金額・メモは、入力欄の外をクリックすると保存されます。名前を変えると、前の名前を使っている案では「要見積もり」になります。
      </p>
    </div>
  );
}
