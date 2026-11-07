import Link from "next/link";

// 入口：企業か人材かを選ぶ
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 py-16">
      <p className="text-sm font-semibold text-muted">Zero-4 マッチング</p>
      <h1 className="mt-2 text-3xl font-bold leading-snug sm:text-4xl">
        地域の会社の「困った」と、
        <br className="hidden sm:block" />
        月10時間のIT人材をつなぐ。
      </h1>
      <p className="mt-4 max-w-2xl text-muted">
        課題を選んで書くだけで、AIが求める人材の要件にまとめます。副業のIT人材が応募し、30分の面談のあと準委任で契約します。
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <EntryCard
          theme="company"
          href="/company/login"
          label="企業の方"
          title="課題を相談する"
          text="銀行の担当者から受け取った企業コードで登録できます。"
        />
        <EntryCard
          theme="talent"
          href="/talent/login"
          label="IT人材の方"
          title="案件を探す"
          text="スキルと稼働時間を登録すると、合う案件をおすすめします。"
        />
      </div>
    </main>
  );
}

function EntryCard({
  theme, href, label, title, text,
}: { theme: "company" | "talent"; href: string; label: string; title: string; text: string }) {
  return (
    <Link
      href={href}
      className={`theme-${theme} group rounded-xl border border-line bg-surface p-6 transition hover:border-accent`}
    >
      <span className="inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">{label}</span>
      <p className="mt-4 text-xl font-bold">{title}</p>
      <p className="mt-2 text-sm text-muted">{text}</p>
      <p className="mt-6 text-sm font-semibold text-accent">
        ログイン / 新規登録 <span className="inline-block transition group-hover:translate-x-1">→</span>
      </p>
    </Link>
  );
}
