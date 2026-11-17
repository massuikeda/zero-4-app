/** 診断の記録の、並べ方と日付の表示 */
import type { Diagnosis } from "./types";

/** 診断の記録を古い順に並べる */
export function chronological(diagnoses: Diagnosis[]): Diagnosis[] {
  return [...diagnoses].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/** 2026-11-10 → 2026/11/10 */
export const formatDate = (d: string) => d.replaceAll("-", "/");
/** 削減工数の表示（月あたり・時間）：300時間、−12.5時間。出せないときは「—」 */
export function formatHours(h: number | null | undefined): string {
  if (h == null) return "—";
  const a = Math.round(Math.abs(h) * 10) / 10;
  return `${h < 0 && a > 0 ? "−" : ""}${a.toLocaleString("ja-JP")}時間`;
}

/** 2026-11-10 → 2026/11（表の見出し用） */
export const formatMonth = (d: string) => d.slice(0, 7).replace("-", "/");
