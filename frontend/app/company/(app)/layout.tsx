"use client";

import { AppShell } from "@/components/AppShell";
import { CompanySessionProvider } from "@/lib/session";

export default function CompanyAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanySessionProvider>
      {(s) => (
        <AppShell
          theme="company"
          appName="Zero-4 企業"
          nav={[
            { href: "/company", label: "ホーム" },
            { href: "/company/projects/new", label: "課題を入力" },
          ]}
          userLabel={s.me ? `${s.me.company.name}　${s.me.user.name}` : ""}
          ready={!!s.me}
          error={s.error}
          onRetry={s.refresh}
          onLogout={s.logout}
        >
          {children}
        </AppShell>
      )}
    </CompanySessionProvider>
  );
}
