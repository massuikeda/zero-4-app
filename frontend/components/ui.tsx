// 共通の小さな部品

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const btnVariants = {
  primary: "bg-accent text-white hover:opacity-90",
  secondary: "border border-line bg-surface text-foreground hover:bg-background",
  ghost: "text-accent hover:bg-accent-soft",
};

export function Button({
  variant = "primary", className = "", ...props
}: ComponentProps<"button"> & { variant?: keyof typeof btnVariants }) {
  return <button className={`${btnBase} ${btnVariants[variant]} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "primary", className = "", ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof btnVariants }) {
  return <Link className={`${btnBase} ${btnVariants[variant]} ${className}`} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "good" | "warn" | "muted" }) {
  const tones = {
    default: "bg-background text-foreground border-line",
    accent: "bg-accent-soft text-accent border-transparent",
    good: "bg-emerald-50 text-emerald-800 border-emerald-200",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    muted: "bg-background text-muted border-line",
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

/** おすすめ度（0〜1） */
export function ScoreMeter({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2" title={`おすすめ度 ${pct}%`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <span className="w-10 text-sm font-semibold tabular-nums text-accent">{pct}%</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

/** API エラーの表示 */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-semibold underline">
          もう一度読み込む
        </button>
      )}
    </div>
  );
}

export function Loading() {
  return <p className="text-sm text-muted">読み込み中…</p>;
}

export const yen = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("ja-JP")}円`);
export const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—";
