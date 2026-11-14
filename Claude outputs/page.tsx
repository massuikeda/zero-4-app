"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/components/AppShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ComparisonView } from "@/components/ComparisonView";
import { FlowBoard } from "@/components/FlowBoard";
import { ApiError, api } from "@/lib/api";
import { normalize } from "@/lib/flow";
import { parseHearing } from "@/lib/hearing";
import { emptyFlow, type Business, type Company, type Flow, type FlowDoc, type FlowKind, type Resource } from "@/lib/types";

type Tab = "notes" | "asis" | "tobe" | "compare";
const LABEL: Record<FlowKind, string> = { asis: "AS-IS", tobe: "TO-BE" };

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
  const [business, setBusiness] = useState<Business | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [drafts, setDrafts] = useState<Record<FlowKind, Draft | null>>({ asis: null, tobe: null });
  const [notes, setNotes] = useState({ hearing_raw: "", hearing_notes: "", exec_view: "", field_view: "", dirty: false });
  // Azure OpenAI（ヒアリングボックス → 決まった形式）
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  // 元に戻す（Ctrl+Z）用の履歴。連続入力（文字の打鍵など）はまとめて1回分にする
  const history = useRef<Record<FlowKind, { stack: Flow[]; at: number; merge: boolean }>>({
    asis: { stack: [], at: 0, merge: false },
    tobe: { stack: [], at: 0, merge: false },
  });
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
      setDrafts({ asis: fromDoc(f.asis), tobe: fromDoc(f.tobe) });
      if (!f.asis) setTab("notes"); // AS-ISがまだなければ、ヒアリングから始める
      api.config().then((x) => setAiEnabled(!!x.ai_enabled), () => setAiEnabled(false));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  }, [bid]);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  const anyDirty = notes.dirty || !!drafts.asis?.dirty || !!drafts.tobe?.dirty;
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
    } catch (e) {
      flash("err", e instanceof ApiError && e.status === 409 ? `${e.message}（あなたの変更はまだ画面に残っています）` : String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  /** ヒアリングボックス・経営者の認識・現場の実態を保存する */
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

  const startTobe = async (fromAsis: boolean) => {
    if (fromAsis) {
      if (drafts.asis?.dirty) return flash("err", "先にAS-ISを保存してください");
      try {
        const doc = await api.copyAsisToTobe(bid);
        setDrafts((x) => ({ ...x, tobe: fromDoc(doc) }));
      } catch (e) {
        flash("err", e instanceof Error ? e.message : String(e));
      }
    } else {
      setDrafts((x) => ({
        ...x,
        tobe: { data: { lanes: x.asis?.data.lanes ?? [], steps: [] }, version: 0, dirty: true, doc: null },
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
  const perCase = { asis: total(drafts.asis), tobe: total(drafts.tobe) };

  const tabs: [Tab, string, boolean][] = [
    ["notes", "ヒアリング", notes.dirty],
    ["asis", "AS-IS（現状）", !!drafts.asis?.dirty],
    ["tobe", "TO-BE（改善後）", !!drafts.tobe?.dirty],
    ["compare", "比較", false],
  ];

  const renderFlowTab = (kind: FlowKind) => {
    const d = drafts[kind];
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
          <p>TO-BEはまだありません。</p>
          <div className="row gap center">
            <button className="btn primary" disabled={!drafts.asis?.doc} onClick={() => startTobe(true)}>
              AS-ISをコピーして作成（おすすめ）
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
        <FlowBoard
          ref={boardRef}
          flow={d.data}
          resources={resources}
          kind={kind}
          base={kind === "tobe" ? drafts.asis?.data : undefined}
          execView={business.exec_view}
          fieldView={business.field_view}
          exporting={exporting}
          exportTitle={`${business.name}　${kind === "asis" ? "AS-IS（現状）" : "TO-BE（改善後）"}`}
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
                    <span className="biz-tobe" title="TO-BE（改善後）">
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
            <p className="muted small">AS-ISの図の右下に表示されます。</p>
            <div className="views-grid">
              <label className="exec">
                経営者の認識
                <textarea
                  rows={3}
                  value={notes.exec_view}
                  placeholder="例：受注から出荷まで、問題なく回っている"
                  onChange={(e) => setNotes({ ...notes, exec_view: e.target.value, dirty: true })}
                />
              </label>
              <label className="field">
                現場の実態
                <textarea
                  rows={3}
                  value={notes.field_view}
                  placeholder="例：同じ注文を3回入力し、毎日残業で埋めている"
                  onChange={(e) => setNotes({ ...notes, field_view: e.target.value, dirty: true })}
                />
              </label>
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
                {aiBusy ? "AIがAS-ISを作成しています…" : drafts.asis ? "AIでAS-ISを作り直す" : "AIでAS-ISを作成"}
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
        {tab === "tobe" && renderFlowTab("tobe")}
        {tab === "compare" &&
          (drafts.asis && drafts.tobe ? (
            <ComparisonView
              asis={drafts.asis.data}
              tobe={drafts.tobe.data}
              resources={resources}
              frequency={business.frequency}
              execView={business.exec_view}
              fieldView={business.field_view}
            />
          ) : (
            <div className="empty-state">
              <p>AS-ISとTO-BEの両方を作成すると、比較が表示されます。</p>
            </div>
          ))}
      </section>
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
