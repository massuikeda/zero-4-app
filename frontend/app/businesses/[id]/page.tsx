"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/components/AppShell";
import { ComparisonView } from "@/components/ComparisonView";
import { FlowBoard } from "@/components/FlowBoard";
import { FlowEditor } from "@/components/FlowEditor";
import { ApiError, api, download } from "@/lib/api";
import { normalize } from "@/lib/flow";
import { HEARING_EXAMPLE, parseHearing } from "@/lib/hearing";
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
  const [notes, setNotes] = useState({ hearing_notes: "", exec_view: "", field_view: "", dirty: false });
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
      setNotes({ hearing_notes: b.hearing_notes, exec_view: b.exec_view, field_view: b.field_view, dirty: false });
      setDrafts({ asis: fromDoc(f.asis), tobe: fromDoc(f.tobe) });
      if (!f.asis) setTab("notes"); // AS-ISがまだなければ、ヒアリングから始める
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

  /** ヒアリングを保存し、AS-ISがまだなければヒアリングからAS-ISを自動で作る */
  const saveNotes = async () => {
    setBusy(true);
    try {
      let b = business!;
      if (notes.dirty) {
        const { dirty: _d, ...body } = notes;
        b = await api.updateNotes(bid, body);
        setBusiness(b);
        setNotes({ hearing_notes: b.hearing_notes, exec_view: b.exec_view, field_view: b.field_view, dirty: false });
      }
      const parsed = parseHearing(b.hearing_notes, resources);
      if (parsed.stepCount === 0) {
        flash("ok", "ヒアリング内容を保存しました");
      } else if (!drafts.asis) {
        const doc = await api.saveFlow(bid, "asis", parsed.flow, 0);
        setDrafts((x) => ({ ...x, asis: fromDoc(doc) }));
        setTab("asis");
        flash("ok", `ヒアリングからAS-ISを作成しました（作業${parsed.stepCount}件）。図の上でそのまま直せます`);
      } else {
        setRegenOffer(true);
        flash("ok", "ヒアリング内容を保存しました");
      }
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const regenerateAsis = () => {
    const parsed = parseHearing(notes.hearing_notes, resources);
    edit("asis", parsed.flow);
    setRegenOffer(false);
    setTab("asis");
    flash("ok", "ヒアリングからAS-ISを作り直しました。確認して「保存」すると確定します（「元に戻す」で前の状態に戻せます）");
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

  const exportDrawio = async (kind: FlowKind) => {
    const d = drafts[kind];
    if (!d || !business) return;
    try {
      const xml = await api.renderDrawio(d.data, `${business.name} ${LABEL[kind]}`);
      download(`${business.name}_${LABEL[kind]}.drawio`, xml, "application/xml");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  };

  const exportPng = async (kind: FlowKind) => {
    if (!boardRef.current || !business) return;
    setExporting(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const { toPng } = await import("html-to-image");
      const url = await toPng(boardRef.current, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${business.name}_${LABEL[kind]}.png`;
      a.click();
    } catch (e) {
      flash("err", `画像を作れませんでした：${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
    }
  };

  if (!business || !company) {
    return msg ? <div className="alert">{msg.text}</div> : <p className="muted">読み込み中…</p>;
  }

  const tabs: [Tab, string, boolean][] = [
    ["notes", "ヒアリング", notes.dirty],
    ["asis", "AS-IS（現状）", !!drafts.asis?.dirty],
    ["tobe", "TO-BE（あるべき姿）", !!drafts.tobe?.dirty],
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
            <button className="btn ghost" onClick={() => exportPng(kind)} disabled={d.data.steps.length === 0}>
              画像で保存
            </button>
            <button className="btn ghost" onClick={() => exportDrawio(kind)}>
              draw.io出力
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
          editable
          onChange={(f, merge) => edit(kind, f, merge)}
        />
        <details className="table-toggle">
          <summary>表でまとめて編集する（上級者向け）</summary>
          <FlowEditor flow={d.data} onChange={(f) => edit(kind, f, true)} resources={resources} isTobe={kind === "tobe"} />
        </details>
      </div>
    );
  };

  return (
    <div className="stack">
      <nav className="crumbs">
        {isAdmin && <Link href="/">企業一覧</Link>}
        {isAdmin && " › "}
        <Link href={`/companies/${company.id}`}>{company.name}</Link> › {business.name}
      </nav>
      <div className="title-row">
        <div>
          <h1>{business.name}</h1>
          <p className="muted small">
            {[business.department, business.frequency && `頻度：${business.frequency}`, business.description]
              .filter(Boolean)
              .join("　｜　")}
          </p>
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
            <p className="muted small">
              現場でのヒアリング内容を、<b>1行に1つの作業</b>で書きます。保存すると、AS-ISの図が自動でできあがります。
            </p>
            <details className="hearing-guide">
              <summary>書き方のコツと例</summary>
              <ul>
                <li>
                  <b>担当：作業</b> の形で書くと確実です（例：<code>営業部：FAXを見てエクセルに手入力</code>）。「営業部がFAXを見て…」のような普通の文でも読み取ります
                </li>
                <li>
                  次の人への渡し方は <code>→メール</code> のように最後に書きます（「メールで送る」などの文でも読み取ります）
                </li>
                <li>
                  困りごとは次の行に <code>※ 見出し／説明</code>。現場が当たり前と思っていた点は <code>※！</code>
                </li>
                <li>
                  時間は <code>（15分）</code>、道具や印は <code>［エクセル］［手入力］［¥］</code> でも書けます。<code>#</code> で始まる行はメモとして読み飛ばします
                </li>
              </ul>
              <pre>{HEARING_EXAMPLE}</pre>
              {!notes.hearing_notes.trim() && (
                <button
                  className="btn ghost"
                  onClick={() => setNotes({ ...notes, hearing_notes: HEARING_EXAMPLE, dirty: true })}
                >
                  この例を入れてみる
                </button>
              )}
            </details>
            <textarea
              className="notes"
              rows={12}
              value={notes.hearing_notes}
              placeholder={"取引先：注文書を手書きして送る →FAX\n営業部：FAXを見てエクセルに手入力 →メール\n※ 手書きのFAXを見て手入力／読み間違い・入力の手間\n倉庫：ピッキング"}
              onChange={(e) => {
                setNotes({ ...notes, hearing_notes: e.target.value, dirty: true });
                setRegenOffer(false);
              }}
            />
            <HearingPreview text={notes.hearing_notes} resources={resources} />
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
                <span>AS-ISはすでにあります。このヒアリング内容でAS-ISを作り直しますか？</span>
                <div className="row gap">
                  <button className="btn ghost" onClick={() => setRegenOffer(false)}>
                    今のAS-ISのままにする
                  </button>
                  <button className="btn primary" onClick={regenerateAsis}>
                    AS-ISを作り直す
                  </button>
                </div>
              </div>
            )}
            <div className="row end">
              {drafts.asis ? (
                <button className="btn primary" disabled={!notes.dirty || busy} onClick={saveNotes}>
                  保存
                </button>
              ) : (
                <button
                  className="btn primary"
                  disabled={busy || (!notes.dirty && !notes.hearing_notes.trim())}
                  onClick={saveNotes}
                >
                  保存してAS-ISを作成
                </button>
              )}
            </div>
          </div>
        )}
        {tab === "asis" && (
          <div className="split">
            {renderFlowTab("asis")}
            {business.hearing_notes && drafts.asis && (
              <details className="side-notes">
                <summary>ヒアリングメモを見ながら入力</summary>
                <pre>{business.hearing_notes}</pre>
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
          部署
          <input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
        </label>
        <label>
          頻度
          <input value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} />
        </label>
        <label>
          概要
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

/** ヒアリングメモから何を読み取れるかを、その場で見せる */
function HearingPreview({ text, resources }: { text: string; resources: Resource[] }) {
  if (!text.trim()) return null;
  const p = parseHearing(text, resources);
  if (p.stepCount === 0) return <p className="muted small">作業として読み取れる行がまだありません。</p>;
  return (
    <p className="hearing-preview">
      このメモから <b>作業{p.stepCount}件</b>・<b>列{p.flow.lanes.length}つ</b>（{p.flow.lanes.join("、")}）
      {p.bottleneckCount > 0 && (
        <>
          ・<b>ボトルネック{p.bottleneckCount}件</b>
        </>
      )}
      を読み取れます
    </p>
  );
}
