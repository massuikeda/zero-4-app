/** 月の件数（月の削減時間・削減工数の計算に使う）。backend/app/effort.py と同じルール */
import type { Business } from "./types";

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
