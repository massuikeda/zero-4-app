export const STEP_TYPES = ["作業", "判断", "システム処理", "帳票", "待ち"] as const;
export const CHANGE_ACTIONS = ["排除", "統合", "入替", "簡素化", "自動化", "新規"] as const;
export const RESOURCE_KINDS = ["部署", "担当者", "取引先", "システム", "帳票"] as const;
/** 受け渡し手段の候補（矢印のラベル） */
export const MEDIA = ["FAX", "メール", "電話", "配達", "郵送", "手渡し", "口頭", "システム連携"] as const;

export type StepType = (typeof STEP_TYPES)[number];
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
/** TO-BE は松竹梅の3案（梅＝やり方の見直しだけ／竹＝手ごろなツールの導入／松＝RPA・システム連携で自動化） */
export const PLANS = ["ume", "take", "matsu"] as const;
export type Plan = (typeof PLANS)[number];
export const PLAN_LABEL: Record<Plan, string> = { ume: "梅", take: "竹", matsu: "松" };
export const PLAN_DESC: Record<Plan, string> = {
  ume: "お金をかけず、やり方だけを見直す",
  take: "手ごろなツールやクラウドサービスを入れる",
  matsu: "RPAやシステム連携で自動化する",
};
export type TobeKind = `tobe_${Plan}`;
export type FlowKind = "asis" | TobeKind;
export const planKind = (plan: Plan): TobeKind => `tobe_${plan}`;
export const FLOW_KINDS: FlowKind[] = ["asis", ...PLANS.map(planKind)];

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
  /** ボトルネックの印（null でなければボトルネック）。旧データでは見出し */
  issue: string | null;
  /** 業務の時間がかかっている理由 */
  issue_time: string;
  /** ミスの原因 */
  issue_error: string;
  /** 旧データの説明（新しい入力では使わない） */
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
  /** TO-BEの案の要約（AS-ISでは使わない） */
  summary?: string;
  /** TO-BEの案で、導入・準備が必要なもの */
  needs?: string[];
  /** TO-BEの案で、お金のかかる導入物（単価表の名前。単価表にない名前は「要見積もり」になる） */
  cost_items?: string[];
  /** TO-BEの案で、なくした作業（排除）の理由。作業ID → 理由 */
  removed_notes?: Record<string, string>;
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
  /** 業種 */
  industry: string;
  /** 従業員数（人）。未入力は null */
  employees: number | null;
  /** 時給（円）。削減時間を金額に直すのに使う。未設定は null */
  hourly_wage: number | null;
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
  /** ヒアリングボックス（聞いたままの記録） */
  hearing_raw: string;
  /** 決まった形式（ここからAS-ISを作る） */
  hearing_notes: string;
  exec_view: string;
  field_view: string;
  updated_at: string;
  /** 月の件数（費用対効果の計算に使う）。空なら頻度の文字から換算する */
  monthly_count: number | null;
  status: "未着手" | "AS-IS作成済" | "TO-BE作成済";
  /** 採用する案（未選択は空） */
  adopted_plan: Plan | "";
  /** 案ごとの削減時間（1回あたり・分）。作成済みの案だけ入る */
  saved_by_plan: Partial<Record<Plan, number>>;
  /** 一覧に出す削減時間：採用する案のもの。未選択なら竹。その案がまだなければ null */
  saved_plan: Plan | null;
  saved_minutes: number | null;
  assignee_ids: number[];
}

export const emptyFlow = (): Flow => ({ lanes: [], steps: [] });

/** AIによるTO-BEの改善案：AS-ISのどの作業を、どう変えるか */
export interface TobeChange {
  id: string;
  action: Exclude<ChangeAction, "新規">;
  name?: string | null;
  minutes?: number | null;
  tool?: string | null;
  media?: string | null;
  note: string;
  issue_resolved?: boolean;
}

export interface TobePlan {
  summary: string;
  needs: string[];
  /** お金のかかる導入物（単価表の名前。ないものは要見積もり） */
  cost_items: string[];
  changes: TobeChange[];
}

/** AIが出したTO-BEの改善案（出せた案だけ入る） */
export interface TobeSuggestion {
  plans: Partial<Record<Plan, TobePlan>>;
}

/** 単価表（全企業共通）の1件。TO-BEの案で導入するものの、初期費用と月額の目安 */
export interface CostItem {
  id: number;
  name: string;
  /** 初期費用（円） */
  initial_cost: number;
  /** 月額（円） */
  monthly_cost: number;
  note: string;
  sort: number;
}
