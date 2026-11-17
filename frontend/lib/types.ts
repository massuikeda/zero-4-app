export const STEP_TYPES = ["作業", "判断", "システム処理", "帳票", "待ち"] as const;
export const CHANGE_ACTIONS = ["排除", "統合", "入替", "簡素化", "自動化", "新規"] as const;
export const RESOURCE_KINDS = ["部署", "担当者", "取引先", "システム", "帳票"] as const;
/** 受け渡し手段の候補（矢印のラベル） */
export const MEDIA = ["FAX", "メール", "電話", "配達", "郵送", "手渡し", "口頭", "システム連携"] as const;

export type StepType = (typeof STEP_TYPES)[number];
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
/** 図は AS-IS（現状）と TO-BE（改善後）の2つ。TO-BE は1つだけ（RPA・システム連携まで含めた改善後の姿） */
export type FlowKind = "asis" | "tobe";
export const FLOW_KINDS: FlowKind[] = ["asis", "tobe"];

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
  /** パスワードが設定済みか */
  has_password?: boolean;
  /** 続けて間違えたためロック中か */
  locked?: boolean;
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
  /** 月の件数（月の削減時間・削減工数の計算に使う）。空なら頻度の文字から換算する */
  monthly_count: number | null;
  status: "未着手" | "AS-IS作成済" | "TO-BE作成済";
  /** 削減時間（1回あたり・分）＝AS-ISの合計時間 − TO-BEの合計時間。TO-BEがまだなければ null */
  saved_minutes: number | null;
  /** 残してあるAS-ISの版の数（保存した回数） */
  asis_versions: number;
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
  changes: TobeChange[];
}

// ---------------- AS-ISの版と、診断の記録（履歴） ----------------
/** 記録の種類。いまは「DX診断」だけ（以前あった「改善提案」の記録も、DX診断として表示する） */
export type DiagnosisKind = "annual" | "proposal";
export const DIAGNOSIS_LABEL: Record<DiagnosisKind, string> = { annual: "DX診断", proposal: "DX診断" };

/** 経営者の見立てと現場の実態のずれ（1件） */
export interface Gap {
  /** 経営者の見立て */
  exec: string;
  /** 現場の実態 */
  field: string;
}

/** AS-ISから数えたもの（診断の記録では、選んだ版の合計） */
export interface Metrics {
  businesses: number;
  steps: number;
  minutes: number;
  /** 詰まり（ボトルネック）の数 */
  issues: number;
  /** 手入力・転記の箇所 */
  manual: number;
  /** 紙の工程 */
  paper: number;
  /** メール連絡 */
  mail: number;
  /** 経営者の見立てと現場の実態のずれ */
  gaps: number;
}

/** AS-ISの版の見出し（中身なし）。AS-ISを保存するたびに1つ残る */
export interface VersionRef {
  id: number;
  business_id: number;
  /** 第何版か（業務ごとに、古い順に1,2,3…） */
  number: number;
  saved_at: string | null;
  saved_by: string;
  /** 作業時間の合計（1回あたり・分） */
  minutes: number;
  /** 削減工数（月あたり・時間）＝（第1版の時間 − この版の時間）× 月の件数。月の件数が分からなければ null */
  saved_hours: number | null;
}

/** 企業の全業務の削減工数（月あたり・時間。AS-ISの第1版とくらべて） */
export interface Effort {
  /** 全業務の合計（出せる業務が1つもなければ null） */
  total_hours: number | null;
  /** 全業務の、いまの作業時間の合計（月あたり・時間） */
  current_hours: number | null;
  businesses: {
    business_id: number;
    name: string;
    versions: number;
    first_minutes: number;
    latest_minutes: number;
    monthly_count: number | null;
    saved_hours: number | null;
    /** いまの作業時間（月あたり・時間）＝いちばん新しい版の作業時間 × 月の件数 */
    current_hours: number | null;
  }[];
  /** 月ごとの推移（その月の終わりの時点の値） */
  months: { month: string; hours: number }[];
}

/** ある業務の、AS-ISの版（保存した時点の中身） */
export interface AsisVersion extends VersionRef {
  data: Flow;
  metrics: Metrics;
  /** この版を選んでいる診断の記録 */
  diagnoses: { id: number; date: string; kind: DiagnosisKind }[];
}

/** 診断の記録（企業ごとの履歴の1件）。業務ごとに「そのときのAS-ISの版」を選んで残す */
export interface Diagnosis {
  id: number;
  company_id: number;
  /** 実施日（2026-11-10 の形） */
  date: string;
  kind: DiagnosisKind;
  participants: string;
  staff: string;
  note: string;
  gaps: Gap[];
  created_by: string;
  metrics: Metrics;
  /** 選んだAS-ISの版（業務ごと）。saved_hours は、その版の削減工数（月あたり・時間。第1版とくらべて） */
  versions: { business_id: number; business_name: string; version_id: number; number: number; saved_hours: number | null }[];
  /** 選んだ版の削減工数の合計（月あたり・時間）。出せる業務が1つもなければ null */
  saved_hours: number | null;
}
export type DiagnosisIn = Pick<Diagnosis, "date" | "kind" | "participants" | "staff" | "note" | "gaps"> & {
  /** 選んだAS-ISの版（1つの業務につき1つまで） */
  version_ids: number[];
};
