"use client";

import { AppShell } from "@/components/AppShell";
import { TalentSessionProvider } from "@/lib/session";

export default function TalentAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TalentSessionProvider>
      {(s) => (
        <AppShell
          theme="talent"
          appName="Zero-4 人材"
          nav={[
            { href: "/talent", label: "おすすめ" },
            { href: "/talent/projects", label: "案件をさがす" },
            { href: "/talent/applications", label: "応募状況" },
            { href: "/talent/profile", label: "プロフィール" },
          ]}
          userLabel={s.me ? `${s.me.name} さん` : ""}
          ready={!!s.me}
          error={s.error}
          onRetry={s.refresh}
          onLogout={s.logout}
        >
          {children}
        </AppShell>
      )}
    </TalentSessionProvider>
  );
}
