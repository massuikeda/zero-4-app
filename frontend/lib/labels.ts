import type { ApplicationStatus, ProjectStatus } from "./types";

export const projectStatusLabel: Record<ProjectStatus, { text: string; tone: "accent" | "good" | "warn" | "muted" }> = {
  draft: { text: "下書き", tone: "muted" },
  generated: { text: "AI要件の確認中", tone: "warn" },
  published: { text: "公開中", tone: "good" },
  closed: { text: "募集終了", tone: "muted" },
  contracted: { text: "契約済み", tone: "accent" },
};

export const applicationStatusLabel: Record<ApplicationStatus, { text: string; tone: "accent" | "good" | "warn" | "muted" }> = {
  applied: { text: "応募あり", tone: "warn" },
  interview: { text: "面談予定", tone: "accent" },
  selected: { text: "選定", tone: "good" },
  rejected: { text: "見送り", tone: "muted" },
  withdrawn: { text: "辞退", tone: "muted" },
};
