import Link from "next/link";
import { Fragment } from "react";

/** パンくずリスト（例：企業一覧 ＞ 株式会社サンプル商事 ＞ 受注〜出荷業務） */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="現在の場所">
      {items.map((it, i) => (
        <Fragment key={`${it.label}-${i}`}>
          {i > 0 && <span className="crumbs-sep">&gt;</span>}
          {it.href ? <Link href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}
