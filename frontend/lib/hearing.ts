/**
 * ヒアリングメモ → AS-IS のひな形（AIは使わず、決まったルールで読み取る）
 *
 * 書き方（1行＝1作業。上から順に矢印でつなぐ）
 *   取引先：注文書を手書き［手書き］ →FAX
 *   営業部が FAXを見てエクセルに手入力し、倉庫にメールで送る
 *   ※ 時間：1件ずつ手入力している／ミス：読み間違い … 直前の作業のボトルネック
 *   # 月末に集中                        … # で始まる行は読み飛ばす（メモ用）
 *
 * 読み取るもの
 *   担当（列）   「担当：」の形、または行の中のリソース名（部署・担当者・取引先）。なければ前の行と同じ担当
 *   道具（札）   ［ ］の中、またはリソース名・エクセル・手書き・紙・伝票などの言葉
 *   PC作業       ［PC］、またはエクセル・システム・入力・パソコンなど
 *   手入力・転記 ［手入力］、または 入力・転記・打ち込 など
 *   ¥            ［¥］、または 支払・請求・入金・精算・振込 など
 *   受け渡し手段 「→FAX」の形、または FAX・メール・電話・配達・郵送 などの言葉（次の作業への矢印に付く）
 *   所要時間     （15分）の形
 */
import { newStep } from "./flow";
import { MEDIA, type Flow, type Resource, type Step } from "./types";

const BULLET = /^\s*(?:[-・*●○◆■□▶>]|\d+[.)．、）]|[（(]\d+[)）])\s*/;
const EXTERNAL_WORDS = ["取引先", "顧客", "お客様", "お客さん", "仕入先", "得意先"];
const TOOL_WORDS: [RegExp, string][] = [
  [/エクセル|excel|xlsx?/i, "Excel"],
  [/(?<!パス|キー)ワード|\bword\b|\.docx?\b/i, "Word"], // 「パスワード」「キーワード」は除く
  [/手書き/, "手書き"],
  [/紙の伝票|伝票/, "紙の伝票"],
  [/請求書/, "請求書"],
  [/注文書/, "注文書"],
  [/紙/, "紙"],
];
const MEDIA_WORDS: [RegExp, string][] = [
  [/fax|ファックス|ファクス/i, "FAX"],
  [/メール/, "メール"],
  [/電話/, "電話"],
  [/配達|配送|発送/, "配達"],
  [/郵送/, "郵送"],
  [/手渡し/, "手渡し"],
  [/口頭/, "口頭"],
  [/チャット|teams|slack/i, "チャット"],
  [/システム連携|自動連携/, "システム連携"],
];
// 「〜で送る」「〜で連絡」など、次の人へ渡す動き
const SEND = /送|渡|連絡|届|返信|共有|回す|報告|依頼|伝え|知らせ/;

export interface ParsedHearing {
  flow: Flow;
  stepCount: number;
  bottleneckCount: number;
}

export function parseHearing(text: string, resources: Resource[]): ParsedHearing {
  const laneNames = resources
    .filter((r) => r.kind === "部署" || r.kind === "担当者" || r.kind === "取引先")
    .map((r) => r.name)
    .sort((a, b) => b.length - a.length); // 長い名前を優先（「営業部（受注）」を「営業部」より先に）
  const toolNames = resources
    .filter((r) => r.kind === "システム" || r.kind === "帳票")
    .map((r) => r.name)
    .sort((a, b) => b.length - a.length);

  const steps: Step[] = [];
  const lanes: string[] = [];
  let lane = "";
  let bottlenecks = 0;

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    let line = raw.replace(BULLET, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("＃")) continue;

    // ※ で始まる行 → 直前の作業のボトルネック
    const issue = line.match(/^[※＊*]\s*([!！])?\s*(.*)$/);
    if (issue) {
      const prev = steps[steps.length - 1];
      if (prev && issue[2]) {
        // 「時間：…／ミス：…」の形。書き分けがなければ言葉から振り分ける
        if (prev.issue === null) bottlenecks++;
        prev.issue = "ボトルネック";
        for (const part of issue[2].split(/[／/]/).map((x) => x.trim()).filter(Boolean)) {
          const [kind, text] = classifyIssue(part);
          if (kind === "error") prev.issue_error = [prev.issue_error, text].filter(Boolean).join("・");
          else prev.issue_time = [prev.issue_time, text].filter(Boolean).join("・");
        }
      }
      continue;
    }

    // ［ ］の中の印
    const tags = [...line.matchAll(/[［[]([^］\]]+)[］\]]/g)].map((m) => m[1].trim());
    line = line.replace(/[［[][^］\]]+[］\]]/g, " ");

    // →手段（次の作業への受け渡し）
    let media = "";
    const arrow = line.match(/[→⇒]\s*([^\s、。,]+)?\s*$/);
    if (arrow) {
      media = normalizeMedia(arrow[1] ?? "");
      line = line.slice(0, arrow.index).trim();
    }

    // 所要時間（15分）
    let minutes = 0;
    const min = line.match(/[（(]\s*(\d+)\s*分\s*[)）]/);
    if (min) {
      minutes = Number(min[1]);
      line = line.replace(min[0], "").trim();
    }

    // 担当：作業
    const head = line.match(/^([^：:、。]{1,20})[：:]\s*(.+)$/);
    let name = line;
    if (head) {
      lane = matchLane(head[1].trim(), laneNames);
      name = head[2].trim();
    } else {
      const found = findLane(line, laneNames);
      if (found) {
        lane = found.lane;
        name = found.rest || line;
      }
    }
    if (!lane) lane = "担当者";
    if (!lanes.includes(lane)) lanes.push(lane);

    // 道具
    let tool = tags.find((t) => !/^(pc|ＰＣ|パソコン|手入力|転記|¥|￥|お金)$/i.test(t)) ?? "";
    if (!tool) tool = toolNames.find((t) => line.includes(t)) ?? "";
    if (!tool) tool = TOOL_WORDS.find(([re]) => re.test(line))?.[1] ?? "";

    // 受け渡し手段（→で書かれていなければ、送る動きと一緒に出てくる言葉から）
    if (!media && SEND.test(line)) media = lastMedia(line);

    const has = (re: RegExp) => tags.some((t) => re.test(t));
    const pc =
      has(/^(pc|ＰＣ|パソコン)$/i) || /エクセル|excel|(?<!パス|キー)ワード|\bword\b|システム|パソコン|pc|入力|登録/i.test(line) || /Excel|Word|エクセル|システム/.test(tool);
    const manual =
      has(/^(手入力|転記)$/) || /手入力|転記|打ち込|入力|書き写|作り直|加工し直|作成し直|書き直/.test(line);
    const money = has(/^(¥|￥|お金)$/) || /支払|請求|入金|代金|精算|振込|売上/.test(line);

    const id = `S${String(steps.length + 1).padStart(2, "0")}`;
    steps.push({
      ...newStep(id, lane, false),
      name: shorten(cleanName(name)),
      tool,
      pc,
      manual_input: manual,
      money,
      minutes,
      next_media: media ? [media] : [],
    });
  }

  // 上から順に矢印でつなぐ（受け渡し手段は、その行に書かれたもの）
  steps.forEach((s, i) => {
    const next = steps[i + 1];
    if (!next) {
      s.next = [];
      s.next_media = [];
      return;
    }
    s.next = [next.id];
    s.next_media = [s.next_media[0] ?? ""];
  });

  // 社外（取引先など）の列は左端に寄せる
  lanes.sort((a, b) => Number(isExternal(b)) - Number(isExternal(a)));

  return { flow: { lanes, steps }, stepCount: steps.length, bottleneckCount: bottlenecks };
}

/** 「営業部」と書かれていて、リソースに「営業部（受注）」があればそちらに合わせる */
function matchLane(name: string, laneNames: string[]): string {
  if (laneNames.includes(name)) return name;
  const hit = laneNames.find((n) => n.replace(/[（(].*[)）]$/, "") === name || n.startsWith(name));
  if (hit) return hit;
  if (EXTERNAL_WORDS.some((w) => name.includes(w))) return laneNames.find((n) => EXTERNAL_WORDS.some((w) => n.includes(w))) ?? name;
  return name;
}

/**
 * ※ の行の1つ分を「時間がかかる理由」か「ミスの原因」に振り分ける。
 * 「時間：」「ミス：」「原因：」の書き分けがあればそれに従い、なければ言葉で判断する
 */
function classifyIssue(part: string): ["time" | "error", string] {
  const m = part.match(/^(時間|ミス|原因|間違い)\s*[：:]\s*(.*)$/);
  if (m) return [m[1] === "時間" ? "time" : "error", m[2].trim()];
  return [/ミス|間違|誤|漏れ|抜け|紛失|見落と|読み違/.test(part) ? "error" : "time", part];
}

function isExternal(lane: string) {
  return EXTERNAL_WORDS.some((w) => lane.includes(w));
}

function findLane(line: string, laneNames: string[]): { lane: string; rest: string } | null {
  // リソース名（長いもの優先）。「営業部」と書かれていて、リソースが「営業部（受注）」の場合も拾う
  let best: { lane: string; pos: number; len: number } | null = null;
  for (const n of laneNames) {
    const short = n.replace(/[（(].*[)）]$/, "");
    const core = short.replace(/(部|課|チーム|グループ|担当|係)$/, ""); // 「経理部」→「経理」
    for (const key of [n, short, core.length >= 2 ? core : ""]) {
      if (!key) continue;
      const pos = line.indexOf(key);
      // 同じ位置なら長く一致した方（「経理課長」と「経理」なら経理課長）
      if (pos >= 0 && (!best || pos < best.pos || (pos === best.pos && key.length > best.len)))
        best = { lane: n, pos, len: key.length };
    }
  }
  if (!best) {
    for (const w of EXTERNAL_WORDS) {
      const pos = line.indexOf(w);
      if (pos >= 0 && (!best || pos < best.pos)) best = { lane: matchLane(w, laneNames), pos, len: w.length };
    }
  }
  // 行の頭の方（10文字以内）に出てくる担当だけを「誰が」とみなす（「倉庫にメール」の倉庫は担当ではない）
  if (!best || best.pos > 10) return null;
  const after = line.slice(best.pos + best.len);
  const m = after.match(/^(?:さん|部|課|担当)?(?:が|は|で|側で|側が|から)?\s*/);
  const rest = after.slice(m ? m[0].length : 0).trim();
  // 担当名の後ろに「が/は/：」が無く、すぐ別の言葉が続く場合は、担当として使わない（例：「営業資料を作成」）
  if (!m || (m[0] === "" && rest && !/^[、\s]/.test(after))) return null;
  return { lane: best.lane, rest: best.pos === 0 ? rest : `${line.slice(0, best.pos)}${rest}`.trim() };
}

/** 行の中で一番後ろに出てくる手段（「FAXを見て…メールで送る」ならメール） */
function lastMedia(line: string): string {
  let best = { pos: -1, media: "" };
  for (const [re, m] of MEDIA_WORDS) {
    const g = new RegExp(re.source, re.flags.includes("i") ? "gi" : "g");
    for (const hit of line.matchAll(g)) if ((hit.index ?? -1) > best.pos) best = { pos: hit.index ?? -1, media: m };
  }
  return best.media;
}

function normalizeMedia(s: string): string {
  if (!s) return "";
  const hit = MEDIA_WORDS.find(([re]) => re.test(s));
  if (hit) return hit[1];
  return (MEDIA as readonly string[]).includes(s) ? s : s.slice(0, 10);
}

function cleanName(s: string) {
  return s.replace(/\s+/g, " ").replace(/^[、。,\s]+|[、。,\s]+$/g, "").trim();
}

function shorten(s: string) {
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}

/** ヒアリングタブに出す書き方の例 */
export const HEARING_EXAMPLE = `取引先：注文書を手書きして送る →FAX
営業部：FAXを見てエクセルに手入力（15分） →メール
※ 時間：手書きの文字を読み取りながら1件ずつ入力している／ミス：手書き文字の読み間違い
倉庫：ピッキングリストをエクセルで作り直す
※ 時間：同じ注文をエクセルで作り直している（二重入力）／ミス：写し間違い
倉庫：ピッキング →メール
※ 時間：メールの確認待ちで作業が止まる／ミス：メールの見落とし
営業部：支払い（請求）情報をエクセルに入力
倉庫：出荷 →配達
取引先：紙の伝票で受領を確認
# 月末に注文が集中する（#の行はメモとして読み飛ばします）`;
