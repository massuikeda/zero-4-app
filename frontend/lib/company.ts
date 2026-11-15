/** 企業の表示・入力まわりの小さな関数 */

/** 従業員数の入力欄の文字を数値に直す。空なら null、0以上の整数でなければ undefined（入力ミス） */
export function parseEmployees(v: string): number | null | undefined {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  return Number(t);
}

/** 従業員数の表示（例：1,200名）。未入力は「—」 */
export function formatEmployees(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toLocaleString("ja-JP")}名`;
}
