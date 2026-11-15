"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ComparisonView } from "@/components/ComparisonView";
import { FlowBoard } from "@/components/FlowBoard";
import { ApiError, api } from "@/lib/api";
import { WORKDAYS_PER_MONTH, formatPayback, formatYen, monthlyCountOf, planCost, planEffect } from "@/lib/cost";
import { normalize } from "@/lib/flow";
import { parseHearing } from "@/lib/hearing";
import { applyTobeChanges } from "@/lib/tobe";
import {
  FLOW_KINDS, PLANS, PLAN_DESC, PLAN_LABEL, emptyFlow, planKind,
  type Business, type Company, type CostItem, type Flow, type FlowDoc, type FlowKind, type Plan, type Resource, type TobeKind,
} from "@/lib/types";

type Tab = "notes" | "asis" | "tobe" | "compare";
const LABEL: Record<FlowKind, string> = {
  asis: "AS-IS", tobe_ume: "TO-BE（梅）", tobe_take: "TO-BE（竹）", tobe_matsu: "TO-BE（松）",
};
/** 4つの図（AS-IS と、TO-BEの梅・竹・松）それぞれに同じ初期値を持たせる */
const forEachKind = <T,>(make: () => T) => Object.fromEntries(FLOW_KINDS.map((k) => [k, make()])) as Record<FlowKind, T>;

interface Draft {
  data: Flow;
  version: number; // 0 = 未保存の新規
  dirty: boolean;
  doc: FlowDoc | null;
}

const fromDoc = (doc: FlowDoc | null): Draft | null =>
  doc ? { data: normalize(doc.data), version: doc.version, dirty: false, doc } : null;

/** 分を「1時間55分」のように表す */
function fmtMin(m: number) {
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}時間${m % 60}分` : `${h}時間`;
}

export default function BusinessPage() {
  const { id } = useParams<{ id: string }>();
  const bid = Number(id);
  const me = useMe();
  const isAdmin = me?.role === "admin";

  const [tab, setTab] = useState<Tab>("asis");
  /** タブを最初に決めた業務のID（同じ業務を読み直したときはタブを変えない） */
  const openedBid = useRef<number | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  // 単価表（全企業共通）。TO-BEの案の費用（概算）に使う
  const [costItems, setCostItems] = useState<CostItem[]>([]);
  const [drafts, setDrafts] = useState<Record<FlowKind, Draft | null>>(() => forEachKind(() => null));
  // TO-BEタブ・比較タブで見ている案（梅・竹・松）
  const [plan, setPlan] = useState<Plan>("take");
  const tobeKind = planKind(plan);
  const [notes, setNotes] = useState({ hearing_raw: "", hearing_notes: "", exec_view: "", field_view: "", dirty: false });
  // Azure OpenAI（ヒアリングボックス → 決まった形式）
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  // 元に戻す（Ctrl+Z）用の履歴。連続入力（文字の打鍵など）はまとめて1回分にする
  const history = useRef<Record<FlowKind, { stack: Flow[]; at: number; merge: boolean }>>(
    forEachKind(() => ({ stack: [] as Flow[], at: 0, merge: false })),
  );
  const [, setHistoryTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [regenOffer, setRegenOffer] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    if (type === "ok") setTimeout(() => setMsg(null), 2500);
  };

  const load = useCallback(async () => {
    try {
      const b = await api.business(bid);
      const [c, r, f] = await Promise.all([api.company(b.company_id), api.resources(b.company_id), api.flows(bid)]);
      setBusiness(b);
      setCompany(c);
      setResources(r);
      setNotes({ hearing_raw: b.hearing_raw, hearing_notes: b.hearing_notes, exec_view: b.exec_view, field_view: b.field_view, dirty: false });
      // デプロイの途中など、バックエンドがまだ古い（3案に対応する前の）ときは plans が返ってこない。
      // その間も画面が止まらないよう、案は「まだない」ものとして扱う
      const plans = f.plans ?? {};
      setDrafts({
        asis: fromDoc(f.asis),
        tobe_ume: fromDoc(plans.ume ?? null),
        tobe_take: fromDoc(plans.take ?? null),
        tobe_matsu: fromDoc(plans.matsu ?? null),
      });
      // 開いたときのタブ：AS-ISがまだなければヒアリング、あればAS-IS。
      // 前に開いていた別の業務のタブが残らないよう、どちらの場合も決める（保存後の読み直しでは変えない）
      if (openedBid.current !== bid) {
        openedBid.current = bid;
        setTab(f.asis ? "asis" : "notes");
        // 最初に見せる案：採用する案 → 作成済みの案（竹を優先）→ 竹
        const made = (["take", "ume", "matsu"] as const).filter((p) => plans[p]);
        setPlan(b.adopted_plan && plans[b.adopted_plan] ? b.adopted_plan : made[0] ?? "take");
      }
      api.config().then((x) => setAiEnabled(!!x.ai_enabled), () => setAiEnabled(false));
      // 単価表と費用対効果は、銀行担当者だけが扱う（企業の方には見せない）
      if (isAdmin) api.costItems().then(setCostItems, () => setCostItems([]));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  }, [bid, isAdmin]);

  useEffect(() => {
    if (me) load();
    // 画面を離れたら、次に開いたときにタブを決め直す
    return () => {
      openedBid.current = null;
    };
  }, [me, load]);

  const anyDirty = notes.dirty || FLOW_KINDS.some((k) => drafts[k]?.dirty);
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [anyDirty]);

  /** merge=true は文字入力など。続けて打った分は1回の「元に戻す」にまとめる */
  const edit = (kind: FlowKind, data: Flow, merge = false) => {
    const prev = drafts[kind]?.data;
    const h = history.current[kind];
    const now = Date.now();
    if (prev && !(merge && h.merge && now - h.at < 1500)) {
      h.stack.push(prev);
      if (h.stack.length > 100) h.stack.shift();
      setHistoryTick((n) => n + 1);
    }
    h.at = now;
    h.merge = merge;
    setDrafts((d) => ({ ...d, [kind]: { ...(d[kind] ?? { version: 0, doc: null }), data, dirty: true } }));
  };

  const undo = (kind: FlowKind) => {
    const h = history.current[kind];
    const prev = h.stack.pop();
    if (!prev) return;
    h.at = 0;
    setHistoryTick((n) => n + 1);
    setDrafts((d) => ({ ...d, [kind]: { ...(d[kind] ?? { version: 0, doc: null }), data: prev, dirty: true } }));
  };

  // Ctrl+Z（Mac は ⌘+Z）で図の操作を元に戻す。入力欄の中では文字の取り消しを優先
  useEffect(() => {
    if (tab !== "asis" && tab !== "tobe") return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo(tab === "asis" ? "asis" : tobeKind);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const save = async (kind: FlowKind) => {
    const d = drafts[kind];
    if (!d) return;
    setBusy(true);
    try {
      const doc = await api.saveFlow(bid, kind, d.data, d.version);
      setDrafts((x) => ({ ...x, [kind]: fromDoc(doc) }));
      flash("ok", `${LABEL[kind]}を保存しました`);
    } catch (e) {
      flash("err", e instanceof ApiError && e.status === 409 ? `${e.message}（あなたの変更はまだ画面に残っています）` : String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  /** ヒアリングボックスを保存する */
  const saveNotes = async () => {
    setBusy(true);
    try {
      const { dirty: _d, ...body } = notes;
      const b = await api.updateNotes(bid, body);
      setBusiness(b);
      setNotes({ hearing_raw: b.hearing_raw, hearing_notes: b.hearing_notes, exec_view: b.exec_view, field_view: b.field_view, dirty: false });
      flash("ok", "ヒアリング内容を保存しました");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * AIでAS-ISを作る：ヒアリングボックス → Azure OpenAI で決まった形式のテキスト → 決まったルールで図にする。
   * AS-ISがまだなければそのまま保存、すでにあれば作り直し（保存前の下書き。「元に戻す」で戻せる）
   */
  const createAsisWithAi = async () => {
    if (!notes.hearing_raw.trim()) return flash("err", "ヒアリングボックスに記録を書いてください");
    setRegenOffer(false);
    setAiBusy(true);
    try {
      const { text } = await api.formatHearing(bid, notes.hearing_raw);
      const parsed = parseHearing(text, resources);
      if (parsed.stepCount === 0) throw new Error("AIの結果から作業を読み取れませんでした。ヒアリングボックスの内容を見直してください");
      // 記録と、AIが整えたテキスト（図の元）も保存しておく
      const { dirty: _d, ...body } = notes;
      const b = await api.updateNotes(bid, { ...body, hearing_notes: text });
      setBusiness(b);
      setNotes({ hearing_raw: b.hearing_raw, hearing_notes: b.hearing_notes, exec_view: b.exec_view, field_view: b.field_view, dirty: false });
      const counts = `作業${parsed.stepCount}件・ボトルネック${parsed.bottleneckCount}件`;
      if (!drafts.asis) {
        const doc = await api.saveFlow(bid, "asis", parsed.flow, 0);
        setDrafts((x) => ({ ...x, asis: fromDoc(doc) }));
        flash("ok", `AIでAS-ISを作成しました（${counts}）。図の上でそのまま直せます`);
      } else {
        edit("asis", parsed.flow);
        flash("ok", `AIでAS-ISを作り直しました（${counts}）。確認して「保存」すると確定します（「元に戻す」で前の状態に戻せます）`);
      }
      setTab("asis");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  /** 未保存の案（梅・竹・松）をまとめて保存する */
  const saveAllPlans = async () => {
    setBusy(true);
    try {
      const done: string[] = [];
      for (const p of PLANS) {
        const k = planKind(p);
        const d = drafts[k];
        if (!d?.dirty) continue;
        const doc = await api.saveFlow(bid, k, d.data, d.version);
        setDrafts((x) => ({ ...x, [k]: fromDoc(doc) }));
        done.push(PLAN_LABEL[p]);
      }
      if (done.length) flash("ok", `TO-BE（${done.join("・")}）を保存しました`);
      setBusiness(await api.business(bid)); // 状況・削減時間を読み直す
    } catch (e) {
      flash("err", e instanceof ApiError && e.status === 409 ? `${e.message}（あなたの変更はまだ画面に残っています）` : String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  /** 採用する案を選ぶ（業務一覧の削減時間に使う）。同じ案をもう一度選ぶと未選択に戻す */
  const adopt = async (p: Plan) => {
    if (!business) return;
    try {
      setBusiness(await api.setAdopted(bid, business.adopted_plan === p ? null : p));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * AIでTO-BEを作る：保存済みのAS-IS → Azure OpenAI が梅・竹・松それぞれの「どの作業をどう変えるか」を出す
   * → 決まったルールでAS-ISに当てはめて、3つの図にする。
   * できた図は保存前の下書き。確認・手直ししてから保存で確定する（すでにある案は「元に戻す」で戻せる）
   */
  const createTobeWithAi = async () => {
    const asis = drafts.asis;
    if (!asis?.doc) return flash("err", "先にAS-ISを作成して保存してください");
    if (asis.dirty) return flash("err", "AS-ISに未保存の変更があります。先にAS-ISを保存してください");
    const existing = PLANS.filter((p) => drafts[planKind(p)]);
    if (
      existing.length &&
      !confirm(`いまのTO-BE（${existing.map((p) => PLAN_LABEL[p]).join("・")}）を、AIの改善案で作り直しますか？（保存するまでは「元に戻す」で戻せます）`)
    ) {
      return;
    }
    setAiBusy(true);
    try {
      const s = await api.suggestTobe(bid);
      const made: { plan: Plan; kind: TobeKind; flow: Flow }[] = [];
      for (const p of PLANS) {
        const sp = s.plans[p];
        if (!sp) continue;
        const r = applyTobeChanges(asis.doc.data, sp.changes, resources, { summary: sp.summary, needs: sp.needs, cost_items: sp.cost_items });
        if (r.applied > 0) made.push({ plan: p, kind: planKind(p), flow: r.flow });
      }
      if (made.length === 0) throw new Error("AIの改善案をAS-ISに当てはめられませんでした。もう一度お試しください");
      // すでにある案は、「元に戻す」で戻せるように履歴へ入れる
      for (const m of made) {
        const prev = drafts[m.kind]?.data;
        const h = history.current[m.kind];
        if (prev) h.stack.push(prev);
        h.at = 0;
        h.merge = false;
      }
      setHistoryTick((n) => n + 1);
      setDrafts((d) => {
        const out = { ...d };
        for (const m of made) out[m.kind] = { ...(d[m.kind] ?? { version: 0, doc: null }), data: m.flow, dirty: true };
        return out;
      });
      if (!made.some((m) => m.plan === plan)) setPlan(made[0].plan);
      setTab("tobe");
      const names = made.map((m) => PLAN_LABEL[m.plan]).join("・");
      const missing = PLANS.filter((p) => !made.some((m) => m.plan === p)).map((p) => PLAN_LABEL[p]);
      flash("ok", `AIが${names}の案を作成しました。内容を確認して保存してください${missing.length ? `（${missing.join("・")}は作成できませんでした）` : ""}`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  /** いま見ている案（梅・竹・松）を、AS-ISのコピーか白紙から作る */
  const startTobe = async (fromAsis: boolean) => {
    const kind = tobeKind;
    if (fromAsis) {
      if (drafts.asis?.dirty) return flash("err", "先にAS-ISを保存してください");
      try {
        const doc = await api.copyAsisToTobe(bid, kind);
        setDrafts((x) => ({ ...x, [kind]: fromDoc(doc) }));
        setBusiness(await api.business(bid));
      } catch (e) {
        flash("err", e instanceof Error ? e.message : String(e));
      }
    } else {
      setDrafts((x) => ({
        ...x,
        [kind]: { data: { lanes: x.asis?.data.lanes ?? [], steps: [] }, version: 0, dirty: true, doc: null },
      }));
    }
  };

  /** 図（右側の一覧・集計を含む）を、見出し付きの画像にする */
  const capture = async (kind: FlowKind) => {
    if (!boardRef.current) throw new Error("図がありません");
    setExporting(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const { toPng } = await import("html-to-image");
      const node = boardRef.current;
      const url = await toPng(node, { pixelRatio: 2, backgroundColor: "#ffffff" });
      return { url, w: node.offsetWidth, h: node.offsetHeight };
    } finally {
      setExporting(false);
    }
  };

  const fileBase = (kind: FlowKind) => `${business!.name}_${LABEL[kind]}`;

  /** PDFで保存（A4。図の形に合わせて横向き／縦向きを選び、1ページに収める） */
  const exportPdf = async (kind: FlowKind) => {
    if (!business) return;
    try {
      const { url, w, h } = await capture(kind);
      const { jsPDF } = await import("jspdf");
      const landscape = w >= h;
      const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const ratio = Math.min((pw - margin * 2) / w, (ph - margin * 2) / h);
      const iw = w * ratio;
      const ih = h * ratio;
      pdf.addImage(url, "PNG", (pw - iw) / 2, margin, iw, ih, undefined, "FAST");
      pdf.setProperties({ title: `${business.name} ${LABEL[kind]}`, creator: "ミエルMAP" });
      pdf.save(`${fileBase(kind)}.pdf`);
    } catch (e) {
      flash("err", `PDFを作れませんでした：${e instanceof Error ? e.message : e}`);
    }
  };

  if (!business || !company) {
    return msg ? <div className="alert">{msg.text}</div> : <p className="muted">読み込み中…</p>;
  }

  /** 1件あたりの時間＝各作業の所要時間の合計（作業が無ければ null） */
  const total = (d: Draft | null) =>
    d && d.data.steps.length ? d.data.steps.reduce((n, st) => n + (st.minutes || 0), 0) : null;
  // TO-BE側は、採用する案（未選択なら、いま見ている案）の時間を出す
  const shownPlan: Plan = business.adopted_plan || plan;
  const perCase = { asis: total(drafts.asis), tobe: total(drafts[planKind(shownPlan)]) };
  const dirtyPlans = PLANS.filter((p) => drafts[planKind(p)]?.dirty);

  /** 案の切り替え（梅・竹・松）。案ごとの状態（未作成・削減時間・未保存・採用）も出す */
  const planPicker = (
    <div className="plan-tabs" role="tablist" aria-label="TO-BEの案">
      {PLANS.map((p) => {
        const d = drafts[planKind(p)];
        const t = total(d);
        const saved = perCase.asis !== null && t !== null ? perCase.asis - t : null;
        return (
          <button key={p} role="tab" aria-selected={plan === p} className={`plan-tab ${p}${plan === p ? " on" : ""}`} onClick={() => setPlan(p)}>
            <span className="plan-name">
              {PLAN_LABEL[p]}
              {business.adopted_plan === p && <em className="plan-adopted">採用</em>}
              {d?.dirty && <span className="dot" title="未保存" />}
            </span>
            <span className="plan-desc">{PLAN_DESC[p]}</span>
            <span className={d ? "plan-state" : "plan-state none"}>
              {!d ? "未作成" : saved === null ? "作成済" : `削減 ${saved < 0 ? "−" : ""}${fmtMin(Math.abs(saved))}／回`}
            </span>
          </button>
        );
      })}
    </div>
  );

  const tabs: [Tab, string, boolean][] = [
    ["notes", "ヒアリング", notes.dirty],
    ["asis", "AS-IS（現状）", !!drafts.asis?.dirty],
    ["tobe", "TO-BE（改善後）", dirtyPlans.length > 0],
    ["compare", "比較", false],
  ];

  const renderFlowTab = (kind: FlowKind) => {
    const d = drafts[kind];
    const isTobe = kind !== "asis";
    if (!d) {
      if (kind === "asis") {
        return (
          <div className="empty-state">
            <p>AS-ISはまだありません。ヒアリング内容をもとに、ステップを入力していきます。</p>
            <button className="btn primary" onClick={() => edit("asis", emptyFlow())}>
              AS-ISを作成する
            </button>
          </div>
        );
      }
      return (
        <div className="empty-state">
          <p>
            TO-BE（{PLAN_LABEL[plan]}：{PLAN_DESC[plan]}）はまだありません。
          </p>
          {aiEnabled && (
            <>
              <button className="btn primary" disabled={!drafts.asis?.doc || aiBusy} onClick={createTobeWithAi}>
                {aiBusy ? "AIが梅・竹・松の3案を作成しています…（1〜2分かかることがあります）" : "AIで梅・竹・松の3案を作成"}
              </button>
              <p className="muted small">
                AS-ISの作業・時間・ボトルネックをもとに、AIが改善案を3つ（梅・竹・松）まとめて作ります。できた図は、確認・手直ししてから保存できます。
              </p>
            </>
          )}
          <div className="row gap center">
            <button className={aiEnabled ? "btn ghost" : "btn primary"} disabled={!drafts.asis?.doc} onClick={() => startTobe(true)}>
              {aiEnabled ? `AS-ISをコピーして${PLAN_LABEL[plan]}を作成` : `AS-ISをコピーして${PLAN_LABEL[plan]}を作成（おすすめ）`}
            </button>
            <button className="btn ghost" onClick={() => startTobe(false)}>
              白紙から作成
            </button>
          </div>
          {!drafts.asis?.doc && <p className="muted small">AS-ISを保存すると、コピーして作成できます。</p>}
        </div>
      );
    }
    return (
      <div className="stack">
        <div className="toolbar">
          <span className="muted small">
            {d.doc?.updated_at
              ? `最終更新：${new Date(d.doc.updated_at).toLocaleString("ja-JP")}（${d.doc.updated_by}）`
              : "未保存"}
            {d.dirty && <b className="dirty">　● 未保存の変更があります</b>}
          </span>
          <div className="row gap">
            <button
              className="btn ghost"
              onClick={() => undo(kind)}
              disabled={history.current[kind].stack.length === 0}
              title="元に戻す（Ctrl+Z）"
            >
              ↶ 元に戻す
            </button>
            {isTobe && aiEnabled && (
              <button className="btn ghost" onClick={createTobeWithAi} disabled={aiBusy || !drafts.asis?.doc}>
                {aiBusy ? "AIが3案を作成しています…" : "AIで3案を作り直す"}
              </button>
            )}
            <button className="btn ghost" onClick={() => exportPdf(kind)} disabled={d.data.steps.length === 0}>
              PDFで保存
            </button>
            {d.dirty && d.doc && (
              <button
                className="btn ghost"
                onClick={() => {
                  history.current[kind] = { stack: [], at: 0, merge: false };
                  setDrafts((x) => ({ ...x, [kind]: fromDoc(d.doc) }));
                }}
              >
                保存前に戻す
              </button>
            )}
            <button className="btn primary" disabled={!d.dirty || busy} onClick={() => save(kind)}>
              {isTobe ? `${PLAN_LABEL[plan]}を保存` : "保存"}
            </button>
            {isTobe && dirtyPlans.length > 1 && (
              <button className="btn primary" disabled={busy} onClick={saveAllPlans}>
                未保存の{dirtyPlans.length}案をすべて保存
              </button>
            )}
          </div>
        </div>
        {isTobe && (
          <div className="ai-note">
            <div>
              <strong>
                {PLAN_LABEL[plan]}の案{d.data.summary ? `：${d.data.summary}` : `（${PLAN_DESC[plan]}）`}
              </strong>
              {!!d.data.needs?.length && <span>導入・準備が必要なもの：{d.data.needs.join("、")}</span>}
              {isAdmin && (
                <CostItemsEditor
                  names={d.data.cost_items ?? []}
                  table={costItems}
                  onChange={(names) => edit(kind, { ...d.data, cost_items: names })}
                />
              )}
              <span className="muted small">
                作業をクリックすると手直しできます。時間はAIの目安なので、確認してから保存してください。
                {isAdmin && "費用対効果は「比較」タブに出ます。"}
              </span>
            </div>
            <button
              className={business.adopted_plan === plan ? "btn primary" : "btn ghost"}
              disabled={!d.doc}
              title={d.doc ? "業務一覧の削減時間に、この案を使います" : "保存すると採用できます"}
              onClick={() => adopt(plan)}
            >
              {business.adopted_plan === plan ? "✓ 採用中（外す）" : "この案を採用"}
            </button>
          </div>
        )}
        <FlowBoard
          ref={boardRef}
          flow={d.data}
          resources={resources}
          kind={isTobe ? "tobe" : "asis"}
          base={isTobe ? drafts.asis?.data : undefined}
          exporting={exporting}
          exportTitle={`${business.name}　${isTobe ? `TO-BE（改善後・${PLAN_LABEL[plan]}）` : "AS-IS（現状）"}`}
          exportSub={`${company.name}　｜　${new Date().toLocaleDateString("ja-JP")} 出力`}
          editable
          onChange={(f, merge) => edit(kind, f, merge)}
        />
      </div>
    );
  };

  return (
    <div className="stack">
      <Breadcrumbs
        items={[
          ...(isAdmin ? [{ label: "企業一覧", href: "/" }] : []),
          { label: company.name, href: `/companies/${company.id}` },
          { label: business.name },
        ]}
      />
      <div className="title-row">
        <div>
          <h1>{business.name}</h1>
          <dl className="biz-info">
            <div>
              <dt>担当部署</dt>
              <dd className={business.department ? "" : "empty"}>{business.department || "未入力"}</dd>
            </div>
            <div>
              <dt>頻度</dt>
              <dd className={business.frequency ? "" : "empty"}>{business.frequency || "未入力"}</dd>
            </div>
            <div>
              <dt>1件あたりの時間</dt>
              {perCase.asis === null ? (
                <dd className="empty">AS-IS作成後に表示</dd>
              ) : (
                <dd>
                  {fmtMin(perCase.asis)}
                  {perCase.tobe !== null && perCase.tobe !== perCase.asis && (
                    <span className="biz-tobe" title={`TO-BE（改善後・${PLAN_LABEL[shownPlan]}）`}>
                      {" → "}
                      {fmtMin(perCase.tobe)}
                    </span>
                  )}
                </dd>
              )}
            </div>
            <div className="wide">
              <dt>何の業務か</dt>
              <dd className={business.description ? "" : "empty"}>{business.description || "未入力"}</dd>
            </div>
          </dl>
        </div>
        {isAdmin && <BusinessInfoEditor business={business} onSaved={setBusiness} />}
      </div>

      {msg && <div className={msg.type === "ok" ? "toast" : "alert"}>{msg.text}</div>}

      <div className="tabs">
        {tabs.map(([k, label, dirty]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
            {dirty && <span className="dot" title="未保存" />}
          </button>
        ))}
      </div>

      <section className="panel">
        {tab === "notes" && (
          <div className="stack">
            <div className="hearing-box">
              <div className="hearing-head">
                <div>
                  <h3>ヒアリングボックス</h3>
                  <p>現場で聞いた内容を、そのまま書く・貼り付けます（話し言葉・箇条書きのままでOK）。「AIでAS-ISを作成」を押すと、AS-ISの図ができあがります。</p>
                </div>
              </div>
              <textarea
                className="notes"
                rows={14}
                value={notes.hearing_raw}
                placeholder={"例：取引先は注文書を手書きしてFAXで送ってくる。営業はFAXを見ながらエクセルに入力していて1件15分くらい。字が読みにくくて読み間違えることがある。終わったらメールで倉庫に伝える…"}
                onChange={(e) => {
                  setNotes({ ...notes, hearing_raw: e.target.value, dirty: true });
                  setRegenOffer(false);
                }}
              />
            </div>
            {regenOffer && (
              <div className="regen">
                <span>AS-ISはすでにあります。ヒアリングボックスの内容で、AIでAS-ISを作り直しますか？（保存するまでは「元に戻す」で戻せます）</span>
                <div className="row gap">
                  <button className="btn ghost" onClick={() => setRegenOffer(false)}>
                    今のAS-ISのままにする
                  </button>
                  <button className="btn primary" onClick={createAsisWithAi}>
                    AIで作り直す
                  </button>
                </div>
              </div>
            )}
            <div className="row end gap hearing-actions">
              {!aiEnabled && (
                <span className="muted small">
                  Azure OpenAI が未設定です（backend/.env の AZURE_OPENAI_…を設定すると使えます）
                </span>
              )}
              <button className="btn ghost" disabled={!notes.dirty || busy || aiBusy} onClick={saveNotes}>
                保存
              </button>
              <button
                className="btn primary"
                disabled={!aiEnabled || aiBusy || busy || !notes.hearing_raw.trim()}
                onClick={() => (drafts.asis ? setRegenOffer(true) : createAsisWithAi())}
              >
                {aiBusy ? "AIがAS-ISを作成しています…（1分ほどかかることがあります）" : drafts.asis ? "AIでAS-ISを作り直す" : "AIでAS-ISを作成"}
              </button>
            </div>
          </div>
        )}
        {tab === "asis" && (
          <div className="split">
            {renderFlowTab("asis")}
            {(business.hearing_raw || business.hearing_notes) && drafts.asis && (
              <details className="side-notes">
                <summary>ヒアリングを見ながら入力</summary>
                <pre>{business.hearing_raw || business.hearing_notes}</pre>
              </details>
            )}
          </div>
        )}
        {tab === "tobe" && (
          <div className="stack">
            {planPicker}
            {renderFlowTab(tobeKind)}
          </div>
        )}
        {tab === "compare" &&
          (drafts.asis && PLANS.some((p) => drafts[planKind(p)]) ? (
            <div className="stack">
              <PlanSummary
                asisMinutes={perCase.asis ?? 0}
                plans={PLANS.map((p) => ({ plan: p, flow: drafts[planKind(p)]?.data ?? null, saved: !!drafts[planKind(p)]?.doc }))}
                adopted={business.adopted_plan}
                onAdopt={adopt}
                costItems={costItems}
                hourlyWage={company.hourly_wage}
                business={business}
                companyId={company.id}
                isAdmin={isAdmin}
              />
              {planPicker}
              {drafts[tobeKind] ? (
                <ComparisonView
                  asis={drafts.asis.data}
                  tobe={drafts[tobeKind].data}
                  resources={resources}
                  frequency={business.frequency}
                />
              ) : (
                <div className="empty-state">
                  <p>{PLAN_LABEL[plan]}の案はまだありません。TO-BEタブで作成できます。</p>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <p>AS-ISとTO-BE（梅・竹・松のどれか）を作成すると、比較が表示されます。</p>
            </div>
          ))}
      </section>
    </div>
  );
}

/** 案の「お金のかかる導入物」を、単価表から選んで足す・外す（費用の計算に使う） */
function CostItemsEditor({
  names, table, onChange,
}: { names: string[]; table: CostItem[]; onChange: (names: string[]) => void }) {
  const [other, setOther] = useState("");
  const known = new Set(table.map((c) => c.name));
  const rest = table.filter((c) => !names.includes(c.name));
  const add = (name: string) => {
    const n = name.trim();
    if (n && !names.includes(n)) onChange([...names, n]);
  };
  return (
    <div className="cost-edit">
      <span className="cost-edit-label">お金のかかる導入物：</span>
      {names.length === 0 && <span className="muted">なし（費用0円）</span>}
      {names.map((n) => (
        <span key={n} className={known.has(n) ? "chip" : "chip unknown"} title={known.has(n) ? undefined : "単価表にないので、費用は「要見積もり」になります"}>
          {n}
          {!known.has(n) && <em>要見積もり</em>}
          <button type="button" aria-label={`${n}を外す`} onClick={() => onChange(names.filter((x) => x !== n))}>
            ×
          </button>
        </span>
      ))}
      {rest.length > 0 && (
        <select
          value=""
          aria-label="単価表から足す"
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">＋ 単価表から足す</option>
          {rest.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}（初期 {formatYen(c.initial_cost)}・月額 {formatYen(c.monthly_cost)}）
            </option>
          ))}
        </select>
      )}
      <input
        className="cost-other"
        placeholder="単価表にないもの"
        value={other}
        aria-label="単価表にないものを足す"
        onChange={(e) => setOther(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          add(other);
          setOther("");
        }}
      />
    </div>
  );
}

/**
 * 梅・竹・松の3案を横に並べて見比べる表（比較タブの一番上）。
 * 削減時間は全員に、単価表による費用対効果（概算）は銀行担当者（isAdmin）にだけ出す。
 */
function PlanSummary({
  asisMinutes, plans, adopted, onAdopt, costItems, hourlyWage, business, companyId, isAdmin,
}: {
  asisMinutes: number;
  plans: { plan: Plan; flow: Flow | null; saved: boolean }[];
  adopted: Plan | "";
  onAdopt: (p: Plan) => void;
  costItems: CostItem[];
  hourlyWage: number | null;
  business: Business;
  companyId: number;
  isAdmin: boolean;
}) {
  const { count, from } = monthlyCountOf(business);
  const dash = <span className="muted">—</span>;
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="plain plan-summary">
          <thead>
            <tr>
              <th>案</th>
              <th>内容</th>
              {isAdmin && <th>お金のかかる導入物</th>}
              <th className="num">削減時間（1回）</th>
              {isAdmin && (
                <>
                  <th className="num">初期費用</th>
                  <th className="num">月額費用</th>
                  <th className="num">月の削減額</th>
                  <th className="num">月の効果</th>
                  <th className="num">回収期間</th>
                </>
              )}
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map(({ plan, flow, saved }) => {
              const minutes = flow ? flow.steps.reduce((n, st) => n + (st.minutes || 0), 0) : null;
              const cut = minutes === null ? null : asisMinutes - minutes;
              const cost = planCost(flow?.cost_items, costItems);
              const eff = planEffect(cut, count, hourlyWage, cost);
              const estimate = cost.unknown.length > 0;
              return (
                <tr key={plan} className={adopted === plan ? "adopted" : ""}>
                  <td>
                    <strong className={`plan-badge ${plan}`}>{PLAN_LABEL[plan]}</strong>
                  </td>
                  <td>
                    {flow ? flow.summary || PLAN_DESC[plan] : <span className="muted">未作成（{PLAN_DESC[plan]}）</span>}
                    {!!flow?.needs?.length && <div className="small muted">準備：{flow.needs.join("、")}</div>}
                  </td>
                  {isAdmin && (
                    <td className="small">
                      {!flow ? dash : cost.priced.length + cost.unknown.length === 0 ? (
                        <span className="muted">なし</span>
                      ) : (
                        <>
                          {cost.priced.map((c) => c.name).join("、")}
                          {estimate && (
                            <div className="estimate" title="単価表にないので、費用の合計には入っていません">
                              要見積もり：{cost.unknown.join("、")}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  )}
                  <td className="num">
                    {cut === null ? dash : (
                      <span className={cut < 0 ? "saved minus" : "saved"}>
                        {cut < 0 ? "−" : ""}
                        {fmtMin(Math.abs(cut))}
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <>
                      <td className="num">{!flow ? dash : `${formatYen(cost.initial)}${estimate ? "＋要見積もり" : ""}`}</td>
                      <td className="num">{!flow ? dash : `${formatYen(cost.monthly)}${estimate ? "＋要見積もり" : ""}`}</td>
                      <td className="num">{eff.monthlySaving === null ? dash : formatYen(eff.monthlySaving)}</td>
                      <td className="num">
                        {eff.monthlyNet === null ? (
                          estimate && eff.monthlySaving !== null ? <span className="estimate">要見積もり</span> : dash
                        ) : (
                          <span className={eff.monthlyNet < 0 ? "saved minus" : "saved"}>{formatYen(eff.monthlyNet)}</span>
                        )}
                      </td>
                      <td className="num">
                        {eff.paybackMonths === null ? (
                          estimate && eff.monthlySaving !== null ? <span className="estimate">要見積もり</span> : dash
                        ) : (
                          formatPayback(eff.paybackMonths)
                        )}
                      </td>
                    </>
                  )}
                  <td>
                    {flow && (
                      <button
                        className={adopted === plan ? "btn primary" : "btn ghost"}
                        disabled={!saved}
                        title={saved ? "業務一覧の削減時間に、この案を使います" : "保存すると採用できます"}
                        onClick={() => onAdopt(plan)}
                      >
                        {adopted === plan ? "✓ 採用中" : "採用"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <p className="muted small cost-basis">
          <strong>費用対効果は概算です。</strong>
          月の削減額＝削減時間 × 月の件数 × 時給、月の効果＝月の削減額 − 月額費用、回収期間＝初期費用 ÷ 月の効果。 前提：月の件数{" "}
          {count === null ? (
            <b className="error-text">未設定（「業務情報を編集」で入力してください）</b>
          ) : (
            <b>
              {count.toLocaleString("ja-JP")}件
              {from === "frequency" && `（頻度「${business.frequency}」から換算。1か月${WORKDAYS_PER_MONTH}営業日）`}
            </b>
          )}
          、時給{" "}
          {hourlyWage == null ? (
            <b className="error-text">
              未設定（<Link href={`/companies/${companyId}`}>企業ページ</Link>で設定します）
            </b>
          ) : (
            <b>{hourlyWage.toLocaleString("ja-JP")}円</b>
          )}
          、費用は<Link href="/settings/costs">単価表</Link>の金額の合計（単価表にないものは「要見積もり」で、合計に入りません）。
        </p>
      )}
    </div>
  );
}

function BusinessInfoEditor({ business, onSaved }: { business: Business; onSaved: (b: Business) => void }) {
  const [f, setF] = useState(business);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="info-edit">
      <summary className="btn ghost">業務情報を編集</summary>
      <div className="card info-form">
        {err && <div className="alert">{err}</div>}
        <label>
          業務名
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          担当部署
          <input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
        </label>
        <label>
          頻度
          <input value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} />
        </label>
        <label>
          月の件数（費用対効果の計算用）
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="空なら、頻度から換算します"
            value={f.monthly_count ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              setF({ ...f, monthly_count: /^\d+$/.test(v) ? Number(v) : null });
            }}
          />
        </label>
        <label>
          何の業務か
          <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <button
          className="btn primary"
          onClick={async () => {
            try {
              onSaved(await api.updateBusiness(business.id, f));
              setErr(null);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          保存
        </button>
      </div>
    </details>
  );
}
