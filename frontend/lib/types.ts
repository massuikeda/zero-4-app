// API（backend/app/schemas.py）と同じ形。キーは camelCase

export type Skill = { id: number; name: string; category: string | null };
export type IssueOption = { id: number; category: string; label: string };
export type Master = { skills: Skill[]; issueOptions: IssueOption[] };

export type ProjectStatus = "draft" | "generated" | "published" | "closed" | "contracted";
export type ApplicationStatus = "applied" | "interview" | "selected" | "rejected" | "withdrawn";

// ---- 企業 ----

export type CompanyMe = {
  user: { id: number; name: string; email: string };
  company: { id: number; name: string; industry: string | null; branchName: string };
};

export type Project = {
  id: number;
  status: ProjectStatus;
  issueOptionIds: number[];
  issueFreeText: string | null;
  aiSummary: string | null;
  aiRequirements: string | null;
  publicTitle: string | null;
  publicDescription: string | null;
  skillIds: number[];
  hoursPerMonth: number;
  durationMonths: number;
  monthlyFee: number | null;
  publishedAt: string | null;
  createdAt: string;
  applicantCount: number;
  newApplicantCount: number;
};

export type ProjectInput = {
  status: "generated" | "published";
  issueOptionIds: number[];
  issueFreeText: string;
  aiSummary: string;
  aiRequirements: string;
  publicTitle: string;
  publicDescription: string;
  skillIds: number[];
  durationMonths: number;
  monthlyFee: number;
};

export type AiDraft = {
  summary: string;
  requirements: string;
  title: string;
  description: string;
  skillIds: number[];
};

export type TalentCard = {
  id: number;
  displayName: string | null;
  mainJob: string | null;
  bio: string | null;
  skillIds: number[];
};

export type Applicant = {
  applicationId: number;
  status: ApplicationStatus;
  message: string | null;
  appliedAt: string;
  talent: TalentCard;
  score: number;
  keywords: string[];
};

export type CompanyProjectDetail = {
  project: Project;
  applicants: Applicant[];
  recommended: { talent: TalentCard; score: number; keywords: string[] }[];
};

// ---- 人材 ----

export type TalentMe = {
  id: number;
  email: string;
  name: string;
  displayName: string | null;
  bio: string | null;
  mainJob: string | null;
  availableHoursMonth: number;
  skillIds: number[];
};

export type TalentProfileInput = {
  displayName: string;
  bio: string;
  mainJob: string;
  availableHoursMonth: number;
  skillIds: number[];
};

/** 人材に見せる案件（会社名は含まない） */
export type PublicProject = {
  id: number;
  status: ProjectStatus;
  industry: string | null;
  publicTitle: string | null;
  publicDescription: string | null;
  aiRequirements: string | null;
  skillIds: number[];
  hoursPerMonth: number;
  durationMonths: number;
  monthlyFee: number | null;
  publishedAt: string | null;
  score: number;
  keywords: string[];
  applied: boolean;
};

export type TalentProjectDetail = PublicProject & {
  myApplication: { id: number; status: ApplicationStatus } | null;
};

export type MyApplication = {
  id: number;
  status: ApplicationStatus;
  appliedAt: string;
  projectId: number;
  publicTitle: string | null;
  monthlyFee: number | null;
};
