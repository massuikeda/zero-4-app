export const STEP_TYPES = ["作業", "判断", "システム処理", "帳票", "待ち"] as const;
export const CHANGE_ACTIONS = ["排除", "統合", "入替", "簡素化", "自動化", "新規"] as const;
export const RESOURCE_KINDS = ["部署", "担当者", "取引先", "システム", "帳票"] as const;
/** 受け渡し手段の候補（矢印のラベル） */
export const MEDIA = ["FAX", "メール", "電話", "配達", "郵送", "手渡し", "口頭", "システム連携"] as const;

export type StepType = (typeof STEP_TYPES)[number];
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type FlowKind = "asis" | "tobe";

export const CHANGE_COLORS: Record<ChangeAction, string> = {
  排除: "#9E9E9E",
  統合: "#7B1FA2",
  入替: "#F57C00",
  簡素化: "#0288D1",
  自動化: "#2E7D32",
  新規: "#C2185B",
};

export interface Step {
  id: string;
  lane: string;
  /** 図の行（上から0,1,2…）。null なら自動で配置 */
  row: number | null;
  type: StepType;
  name: string;
  tool: string;
  minutes: number;
  pc: boolean;
  manual_input: boolean;
  money: boolean;
  issue: string | null;
  issue_detail: string;
  third_party: boolean;
  change: ChangeAction | null;
  note: string;
  next: string[];
  next_media: string[];
  condition_labels: string[];
}

export interface Flow {
  lanes: string[];
  steps: Step[];
}

export interface FlowDoc {
  kind: FlowKind;
  data: Flow;
  version: number;
  updated_at: string | null;
  updated_by: string;
}

export interface Comparison {
  asis_steps: number;
  tobe_steps: number;
  asis_minutes: number;
  tobe_minutes: number;
  asis_handoffs: number;
  tobe_handoffs: number;
  asis_issues: number;
  tobe_issues: number;
  reduction_rate: number;
  asis_manual: number;
  tobe_manual: number;
  asis_mail: number;
  tobe_mail: number;
  asis_paper: number;
  tobe_paper: number;
}

export interface Me {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  company_id: number | null;
}

export interface UserRow extends Me {
  business_ids: number[];
}

export interface Company {
  id: number;
  name: string;
  note: string;
  business_count: number;
}

export interface Resource {
  id: number;
  company_id: number;
  kind: ResourceKind;
  name: string;
  note: string;
  sort: number;
}

export interface Business {
  id: number;
  company_id: number;
  name: string;
  department: string;
  frequency: string;
  description: string;
  hearing_notes: string;
  exec_view: string;
  field_view: string;
  updated_at: string;
  status: "未着手" | "AS-IS作成済" | "TO-BE作成済";
  assignee_ids: number[];
}

export const emptyFlow = (): Flow => ({ lanes: [], steps: [] });
