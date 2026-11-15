/**
 * 費用対効果の計算（概算）。金額は単価表（全企業共通）で決まり、AIには決めさせない。
 *
 *   月の削減額 ＝ 1回あたりの削減時間 × 月の件数 × 時給
 *   月の効果   ＝ 月の削減額 − 月額費用
 *   回収期間   ＝ 初期費用 ÷ 月の効果
 */
import type { Business, CostItem } from "./types";

/** 1か月の営業日・週の数（「日30件」「週20件」を月の件数に直すときに使う） */
export const WORKDAYS_PER_MONTH = 20;
export const WEEKS_PER_MONTH = 4;

/** 「日30件」「月200件」「週に20件」「年間1,200件」などの頻度の文字から、月の件数を出す。読み取れなければ null */
export function monthlyCountFromFrequency(frequency: string): number | null {
  const t = (frequency ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，,]/g, "");
  const m = t.match(/(日|週|月|年)[^\d]*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  const perMonth = { 日: n * WORKDAYS_PER_MONTH, 週: n * WEEKS_PER_MONTH, 月: n, 年: n / 12 }[m[1] as "日" | "週" | "月" | "年"];
  return Math.round(perMonth);
}

/** 計算に使う月の件数。数値で入力されていればそれ、なければ頻度の文字から換算 */
export function monthlyCountOf(b: Pick<Business, "monthly_count" | "frequency">): { count: number | null; from: "input" | "frequency" | null } {
  if (b.monthly_count != null) return { count: b.monthly_count, from: "input" };
  const c = monthlyCountFromFrequency(b.frequency);
  return c == null ? { count: null, from: null } : { count: c, from: "frequency" };
}

export interface PlanCost {
  /** 単価表にあったもの */
  priced: CostItem[];
  /** 単価表になかったもの（要見積もり。合計には入れない） */
  unknown: string[];
  initial: number;
  monthly: number;
}

/** 案の「お金のかかる導入物」を単価表と突き合わせて、初期費用と月額を合計する */
export function planCost(names: string[] | undefined, table: CostItem[]): PlanCost {
  const byName = new Map(table.map((c) => [c.name, c]));
  const priced: CostItem[] = [];
  const unknown: string[] = [];
  for (const name of new Set(names ?? [])) {
    const hit = byName.get(name);
    if (hit) priced.push(hit);
    else unknown.push(name);
  }
  return {
    priced,
    unknown,
    initial: priced.reduce((n, c) => n + c.initial_cost, 0),
    monthly: priced.reduce((n, c) => n + c.monthly_cost, 0),
  };
}

export interface PlanEffect {
  /** 月の削減額（円）。時給か月の件数が分からなければ null */
  monthlySaving: number | null;
  /** 月の効果＝月の削減額 − 月額費用。要見積もりを含むときは出さない（null） */
  monthlyNet: number | null;
  /** 回収期間（か月）。0＝初期費用なし。Infinity＝効果が出ず回収できない。出せないときは null */
  paybackMonths: number | null;
}

export function planEffect(
  savedMinutes: number | null,
  monthlyCount: number | null,
  hourlyWage: number | null | undefined,
  cost: PlanCost,
): PlanEffect {
  if (savedMinutes == null || monthlyCount == null || hourlyWage == null) {
    return { monthlySaving: null, monthlyNet: null, paybackMonths: null };
  }
  const monthlySaving = Math.round((savedMinutes / 60) * monthlyCount * hourlyWage);
  // 単価表にないものがあると費用が確定しないので、効果と回収期間は出さない
  if (cost.unknown.length) return { monthlySaving, monthlyNet: null, paybackMonths: null };
  const monthlyNet = monthlySaving - cost.monthly;
  const paybackMonths = cost.initial === 0 ? 0 : monthlyNet > 0 ? cost.initial / monthlyNet : Infinity;
  return { monthlySaving, monthlyNet, paybackMonths };
}

/** 金額の表示（15万円、1,500円、1.5万円、0円） */
export function formatYen(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 10000) {
    const man = a / 10000;
    return `${sign}${(Math.round(man * 10) / 10).toLocaleString("ja-JP")}万円`;
  }
  return `${sign}${a.toLocaleString("ja-JP")}円`;
}

/** 回収期間の表示 */
export function formatPayback(months: number | null): string {
  if (months == null) return "—";
  if (months === Infinity) return "回収できません";
  if (months === 0) return "初期費用なし";
  if (months < 1) return "1か月未満";
  return months >= 24 ? `約${(Math.round((months / 12) * 10) / 10).toLocaleString("ja-JP")}年` : `約${Math.ceil(months)}か月`;
}
