"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ComparisonView } from "@/components/ComparisonView";
import { FlowBoard } from "@/components/FlowBoard";
import { ApiError, api } from "@/lib/api";
import { counters, normalize } from "@/lib/flow";
import { parseHearing } from "@/lib/hearing";
import { applyTobeChanges } from "@/lib/tobe";
import {
  FLOW_KINDS, emptyFlow,
  type AsisVersion, type Business, type Company, type Flow, type FlowDoc, type FlowKind, type Resource,
} from "@/lib/types";

type Tab = "notes" | "asis" | "tobe" | "compare";
const LABEL: Record<FlowKind, string> = { asis: "AS-IS", tobe: "TO-BE" };
/** 2つの図（AS-IS と TO-BE）それぞれに同じ初期値を持たせる */
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
  const [drafts, setDrafts] = useState<Record<FlowKind, Draft | null>>(() => forEachKind(() => null));
  // AS-ISの版（保存するたびに1つ残る。古い順）と、いま見ている版のID（null＝いまのAS-IS）
  const [versions, setVersions] = useState<AsisVersion[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
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
      // デプロイの途中など、バックエンドがまだ古いときは tobe が返ってこない。
      // その間も画面が止まらないよう、TO-BEは「まだない」ものとして扱う
      setDrafts({ asis: fromDoc(f.asis), tobe: fromDoc(f.tobe ?? null) });
      api.asisVersions(bid).then(setVersions, () => setVersions([]));
      // 開いたときのタブ：AS-ISがまだなければヒアリング、あればAS-IS。
      // 前に開いていた別の業務のタブが残らないよう、どちらの場合も決める（保存後の読み直しでは変えない）
      if (openedBid.current !== bid) {
        openedBid.current = bid;
        // ヒアリング履歴の「業務名（第2版）」から来たときは、アドレスの ?version=（版のID）で、その版を開く
        const asked = Number(new URLSearchParams(window.location.search).get("version"));
        const version = Number.isInteger(asked) && asked > 0 ? asked : null;
        setTab(f.asis || version ? "asis" : "notes");
        setViewing(version);
      }
      api.config().then((x) => setAiEnabled(!!x.ai_enabled), () => setAiEnabled(false));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  }, [bid]);

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
        if (tab === "asis" && viewing !== null) return; // 過去の版を見ているときは、何もしない
        undo(tab);
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
      api.business(bid).then(setBusiness, () => undefined); // 状況・削減時間を読み直す
      if (kind === "asis") api.asisVersions(bid).then(setVersions, () => undefined); // 保存のたびに版が増える
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
        api.asisVersions(bid).then(setVersions, () => undefined);
        flash("ok", `AIでAS-ISを作成しました（${counts}）。図の上でそのまま直せます`);
      } else {
        edit("asis", parsed.flow);
        flash("ok", `AIでAS-ISを作り直しました（${counts}）。確認して「保存」すると確定します（「元に戻す」で前の状態に戻せます）`);
      }
      setViewing(null);
      setTab("asis");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * AIでTO-BEを作る：保存済みのAS-IS → Azure OpenAI が「どの作業をどう変えるか」を出す
   * → 決まったルールでAS-ISに当てはめて、図にする。
   * できた図は保存前の下書き。確認・手直ししてから保存で確定する（すでにあるTO-BEは「元に戻す」で戻せる）
   */
  const createTobeWithAi = async () => {
    const asis = drafts.asis;
    if (!asis?.doc) return flash("err", "先にAS-ISを作成して保存してください");
    if (asis.dirty) return flash("err", "AS-ISに未保存の変更があります。先にAS-ISを保存してください");
    if (drafts.tobe && !confirm("いまのTO-BEを、AIの改善案で作り直しますか？（保存するまでは「元に戻す」で戻せます）")) return;
    setAiBusy(true);
    try {
      const s = await api.suggestTobe(bid);
      const r = applyTobeChanges(asis.doc.data, s.changes, resources, { summary: s.summary, needs: s.needs });
      if (r.applied === 0) throw new Error("AIの改善案をAS-ISに当てはめられませんでした。もう一度お試しください");
      // すでにあるTO-BEは「元に戻す」で戻せるように、履歴へ入れる（edit がやる）
      edit("tobe", r.flow);
      setTab("tobe");
      flash("ok", `AIがTO-BEを作成しました（変更${r.applied}件）。内容を確認して保存してください`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  /** TO-BEを、AS-ISのコピーか白紙から作る */
  const startTobe = async (fromAsis: boolean) => {
    if (fromAsis) {
      if (drafts.asis?.dirty) return flash("err", "先にAS-ISを保存してください");
      try {
        const doc = await api.copyAsisToTobe(bid);
        setDrafts((x) => ({ ...x, tobe: fromDoc(doc) }));
        setBusiness(await api.business(bid));
      } catch (e) {
        flash("err", e instanceof Error ? e.message : String(e));
      }
    } else {
      setDrafts((x) => ({ ...x, tobe: { data: { lanes: x.asis?.data.lanes ?? [], steps: [] }, version: 0, dirty: true, doc: null } }));
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
      pdf.setProperties({ title: `${business.name} ${LABEL[kind]}`, creator: "AWASERU" });
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
  const perCase = { asis: total(drafts.asis) };
  const viewed = viewing === null ? null : versions.find((v) => v.id === viewing) ?? null;

  const tabs: [Tab, string, boolean][] = [
    ["notes", "ヒアリング", notes.dirty],
    ["asis", "AS-IS（現状）", !!drafts.asis?.dirty],
    ["tobe", "TO-BE（改善後）", !!drafts.tobe?.dirty],
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
          <p>TO-BE（改善後の目指す姿）はまだありません。</p>
          {aiEnabled && (
            <>
              <button className="btn primary" disabled={!drafts.asis?.doc || aiBusy} onClick={createTobeWithAi}>
                {aiBusy ? "AIがTO-BEを作成しています…（1〜2分かかることがあります）" : "AIでTO-BEを作成"}
              </button>
              <p className="muted small">
                AS-ISの作業・時間・ボトルネックをもとに、AIが改善案（RPA・システム連携などで自動化した姿）を作ります。できた図は、確認・手直ししてから保存できます。
              </p>
            </>
          )}
          <div className="row gap center">
            <button className={aiEnabled ? "btn ghost" : "btn primary"} disabled={!drafts.asis?.doc} onClick={() => startTobe(true)}>
              {aiEnabled ? "AS-ISをコピーして作成" : "AS-ISをコピーして作成（おすすめ）"}
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
                {aiBusy ? "AIがTO-BEを作成しています…" : "AIで作り直す"}
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
              保存
            </button>
          </div>
        </div>
        {isTobe && (
          <div className="ai-note">
            <div>
              <strong>{d.data.summary ? `改善案：${d.data.summary}` : "改善後の目指す姿"}</strong>
              {!!d.data.needs?.length && <span>導入・準備が必要なもの：{d.data.needs.join("、")}</span>}
              <span className="muted small">
                作業をクリックすると手直しできます。確認してから保存してください。
              </span>
            </div>
          </div>
        )}
        <FlowBoard
          ref={boardRef}
          flow={d.data}
          resources={resources}
          kind={isTobe ? "tobe" : "asis"}
          base={isTobe ? drafts.asis?.data : undefined}
          exporting={exporting}
          exportTitle={`${business.name}　${isTobe ? "TO-BE（改善後）" : "AS-IS（現状）"}`}
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
                </dd>
              )}
            </div>
            <div className="wide">
              <dt>何の業務か</dt>
              <dd className={business.description ? "" : "empty"}>{business.description || "未入力"}</dd>
            </div>
          </dl>
        </div>
        {isAdmin && (
          <BusinessInfoEditor
            business={business}
            onSaved={(b) => {
              setBusiness(b);
              flash("ok", "業務情報を保存しました");
            }}
          />
        )}
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
          <div className="stack">
            {versions.length > 0 && (
              <div className="version-bar">
                <label>
                  <span className="version-label">AS-ISの版</span>
                  <select value={viewing ?? ""} onChange={(e) => setViewing(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">いまのAS-IS{drafts.asis?.dirty ? "（未保存の変更あり）" : `（第${versions[versions.length - 1].number}版）`}</option>
                    {[...versions].reverse().map((v) => (
                      <option key={v.id} value={v.id}>
                        {versionLabel(v)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {viewed ? (
              <VersionView
                version={viewed}
                current={drafts.asis?.data ?? null}
                resources={resources}
                onBack={() => setViewing(null)}
                onRestore={() => {
                  // いまのAS-ISを、この版の中身に置き換える（保存するまでは下書き。「元に戻す」で戻せる）
                  edit("asis", normalize(viewed.data));
                  setViewing(null);
                  flash("ok", `第${viewed.number}版の中身を、いまのAS-ISに入れました。「保存」すると確定します（新しい版として残ります）`);
                }}
              />
            ) : (
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
          </div>
        )}
        {tab === "tobe" && renderFlowTab("tobe")}
        {tab === "compare" &&
          (drafts.asis && drafts.tobe ? (
            <div className="stack">
              <ComparisonView asis={drafts.asis.data} tobe={drafts.tobe.data} resources={resources} />
            </div>
          ) : (
            <div className="empty-state">
              <p>AS-ISとTO-BEを作成すると、比較が表示されます。</p>
            </div>
          ))}
      </section>
    </div>
  );
}

/** 版の日時（2026/11/17 14:05） */
function fmtSavedAt(v: AsisVersion): string {
  if (!v.saved_at) return "";
  const d = new Date(v.saved_at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 版の選択肢の表示：第3版　2026/11/17 14:05（田中）★診断の記録 2026/11/10 */
function versionLabel(v: AsisVersion): string {
  const used = v.diagnoses.map((d) => `診断の記録 ${d.date.replaceAll("-", "/")}`).join("・");
  return `第${v.number}版　${fmtSavedAt(v)}${v.saved_by ? `（${v.saved_by}）` : ""}${used ? `　★${used}` : ""}`;
}

/** 過去のAS-ISの版（保存した時点の中身）を見る。書き換えはできない。いまのAS-ISとの違いも出す */
function VersionView({
  version, current, resources, onBack, onRestore,
}: { version: AsisVersion; current: Flow | null; resources: Resource[]; onBack: () => void; onRestore: () => void }) {
  const flow = normalize(version.data);
  const stat = (f: Flow) => ({
    minutes: f.steps.reduce((n, s) => n + (s.minutes || 0), 0),
    issues: f.steps.filter((s) => s.issue).length,
    ...counters(f, resources),
  });
  const then = stat(flow);
  const now = current ? stat(current) : null;
  const rows: [string, number, number | null, (n: number) => string][] = [
    ["1件あたりの時間", then.minutes, now?.minutes ?? null, fmtMin],
    ["詰まり（ボトルネック）", then.issues, now?.issues ?? null, (n) => `${n}件`],
    ["手入力・転記", then.manual, now?.manual ?? null, (n) => `${n}回`],
    ["メール連絡", then.mail, now?.mail ?? null, (n) => `${n}回`],
    ["紙", then.paper, now?.paper ?? null, (n) => `${n}か所`],
  ];
  return (
    <div className="stack">
      <div className="version-note">
        <div>
          <strong>
            第{version.number}版：{fmtSavedAt(version)} に保存したAS-IS{version.saved_by ? `（${version.saved_by}）` : ""}
          </strong>
          <span className="muted small">
            過去の版です。書き換えはできません。
            {version.diagnoses.length > 0 &&
              `　この版を選んでいる診断の記録：${version.diagnoses.map((d) => d.date.replaceAll("-", "/")).join("、")}`}
          </span>
        </div>
        <div className="row gap">
          <button
            className="btn ghost"
            title="いまのAS-ISを、この版の中身に置き換えます（保存するまでは下書きです）"
            onClick={() => confirm(`いまのAS-ISを、第${version.number}版の中身に置き換えますか？（保存するまでは「元に戻す」で戻せます）`) && onRestore()}
          >
            この版の中身に戻す
          </button>
          <button className="btn primary" onClick={onBack}>
            いまのAS-ISを見る
          </button>
        </div>
      </div>
      <div className="version-diff">
        {rows.map(([label, a, b, fmt]) => (
          <div key={label}>
            <span className="kpi-label">{label}</span>
            <span className="version-val">
              {fmt(a)}
              {b !== null && (
                <em className={b < a ? "better" : b > a ? "worse" : ""}>
                  {" → いま "}
                  {fmt(b)}
                </em>
              )}
            </span>
          </div>
        ))}
      </div>
      <FlowBoard flow={flow} resources={resources} kind="asis" />
    </div>
  );
}

function BusinessInfoEditor({ business, onSaved }: { business: Business; onSaved: (b: Business) => void }) {
  const [f, setF] = useState(business);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDetailsElement>(null);
  return (
    <details className="info-edit" ref={box}>
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
          月の件数（削減時間の計算用）
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
          type="button"
          className="btn primary"
          disabled={saving || !f.name.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              const saved = await api.updateBusiness(business.id, {
                name: f.name.trim(), department: f.department, frequency: f.frequency, description: f.description,
                monthly_count: f.monthly_count,
              });
              setErr(null);
              if (box.current) box.current.open = false; // 保存できたら、入力欄を閉じる
              onSaved(saved);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "保存しています…" : "保存"}
        </button>
      </div>
    </details>
  );
}
