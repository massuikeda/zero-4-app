"""業務フローの「決まったフォーマット」と API の入出力。"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ステップ種別（図形が固定で対応する）
StepType = Literal["作業", "判断", "システム処理", "帳票", "待ち"]
# TO-BE の変更区分（ECRS + 自動化 + 新規）
ChangeAction = Literal["排除", "統合", "入替", "簡素化", "自動化", "新規"]
ResourceKind = Literal["部署", "担当者", "取引先", "システム", "帳票"]
# 図は AS-IS（現状）と TO-BE（改善後）の2つ。TO-BE は1つだけ（RPA・システム連携まで含めた改善後の姿）
FlowKind = Literal["asis", "tobe"]


# ---------- フローのフォーマット ----------
class Step(BaseModel):
    id: str = Field(..., max_length=20)
    lane: str = ""            # 担当（リソースの部署・担当者・取引先）＝図の列
    row: Optional[int] = Field(None, ge=0)  # 図の行（上から0,1,2…）。未設定なら自動で配置
    type: StepType = "作業"
    name: str = ""
    tool: str = ""            # 使っている道具（Excel・Word・手書き・紙の伝票など）＝図の色付きの札
    minutes: int = Field(0, ge=0)
    pc: bool = False          # PC作業（図に画面アイコン）
    manual_input: bool = False  # 手入力・転記（集計対象）
    money: bool = False       # お金の流れ（図に¥）
    issue: Optional[str] = None   # ボトルネックの印（null でなければボトルネック。作業名が赤くなる）。旧データでは見出し
    issue_time: str = ""      # 業務の時間がかかっている理由
    issue_error: str = ""     # ミスの原因
    issue_detail: str = ""    # 旧データの説明（新しい入力では使わない）
    third_party: bool = False  # 第三者の気づき（今は画面で使っていない。以前のデータのために残している）
    change: Optional[ChangeAction] = None  # TO-BEの変更区分
    note: str = ""            # 補足（TO-BEでは変更内容）
    next: list[str] = Field(default_factory=list)
    next_media: list[str] = Field(default_factory=list)  # 受け渡し手段（FAX・メール・配達…）。next と同じ順
    condition_labels: list[str] = Field(default_factory=list)  # 判断の分岐ラベル。next と同じ順


class Flow(BaseModel):
    lanes: list[str] = Field(default_factory=list)
    steps: list[Step] = Field(default_factory=list)
    # TO-BEの案の説明（AS-ISでは使わない）
    summary: str = Field("", max_length=300)                 # この案の要約
    needs: list[str] = Field(default_factory=list, max_length=10)  # 導入・準備が必要なもの
    # なくした作業（排除）の理由。作業ID → 何を使って、どうなくすか（図から消える作業なので、ここに残す）
    removed_notes: dict[str, str] = Field(default_factory=dict)


class Comparison(BaseModel):
    asis_steps: int
    tobe_steps: int
    asis_minutes: int
    tobe_minutes: int
    asis_handoffs: int
    tobe_handoffs: int
    asis_issues: int
    tobe_issues: int
    reduction_rate: float
    # 決まった3つの集計（手入力・転記の回数／メール連絡の回数／紙を使う箇所）
    asis_manual: int = 0
    tobe_manual: int = 0
    asis_mail: int = 0
    tobe_mail: int = 0
    asis_paper: int = 0
    tobe_paper: int = 0


# ---------- 出力 ----------
class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Me(_Out):
    id: int
    email: str
    name: str
    role: str
    company_id: Optional[int]


class CompanyOut(_Out):
    id: int
    name: str
    industry: str = ""
    employees: Optional[int] = None
    hourly_wage: Optional[int] = None  # 時給（円）
    note: str
    business_count: int = 0


class ResourceOut(_Out):
    id: int
    company_id: int
    kind: str
    name: str
    note: str
    sort: int


class UserOut(_Out):
    id: int
    email: str
    name: str
    role: str
    company_id: Optional[int]
    business_ids: list[int] = []
    has_password: bool = False  # パスワードが設定済みか
    locked: bool = False  # 続けて間違えたためロック中か


class BusinessOut(_Out):
    id: int
    company_id: int
    name: str
    department: str
    frequency: str
    description: str
    hearing_raw: str = ""
    hearing_notes: str
    exec_view: str
    field_view: str
    updated_at: datetime
    monthly_count: Optional[int] = None  # 月の件数（空なら、画面が頻度の文字から換算する）
    status: str = "未着手"
    # 削減時間（1回あたり・分）＝ AS-ISの合計時間 − TO-BEの合計時間。TO-BEがまだなければ None
    saved_minutes: Optional[int] = None
    asis_versions: int = 0  # 残してあるAS-ISの版の数（保存した回数）
    assignee_ids: list[int] = []


class FlowDocOut(BaseModel):
    kind: FlowKind
    data: Flow
    version: int
    updated_at: Optional[datetime]
    updated_by: str


class FlowsOut(BaseModel):
    asis: Optional[FlowDocOut]
    tobe: Optional[FlowDocOut]
    comparison: Optional[Comparison]  # AS-ISとTO-BEの比較（両方あるときだけ）


# ---------- 入力 ----------
class CompanyIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    industry: str = Field("", max_length=100)  # 業種
    employees: Optional[int] = Field(None, ge=0, le=10_000_000)  # 従業員数（人）
    hourly_wage: Optional[int] = Field(None, ge=0, le=1_000_000)  # 時給（円）
    note: str = ""


class ResourceIn(BaseModel):
    kind: ResourceKind
    name: str = Field(..., min_length=1, max_length=200)
    note: str = ""
    sort: int = 0


class UserIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    name: str = Field(..., min_length=1, max_length=200)
    role: Literal["admin", "member"] = "member"
    company_id: Optional[int] = None
    # 初期パスワード（登録のときだけ。銀行担当者が決めて本人に伝える）。長さの確認は auth.check_password_rule
    password: Optional[str] = Field(None, max_length=200)


class LoginIn(BaseModel):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=200)
    portal: Literal["bank", "company"]


class PasswordChangeIn(BaseModel):
    current_password: str = Field(..., max_length=200)
    new_password: str = Field(..., max_length=200)


class PasswordResetIn(BaseModel):
    password: str = Field(..., max_length=200)


class BusinessIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    department: str = ""
    frequency: str = ""
    description: str = ""
    monthly_count: Optional[int] = Field(None, ge=0, le=100_000_000)  # 月の件数（空なら頻度から換算）


class BusinessNotesIn(BaseModel):
    """担当者も編集できる項目（ヒアリング結果）。送った項目だけ更新する"""

    hearing_raw: Optional[str] = None    # ヒアリングボックス（聞いたままの記録）
    hearing_notes: Optional[str] = None  # 決まった形式
    exec_view: Optional[str] = None   # 経営者の認識
    field_view: Optional[str] = None  # 現場の実態


class FlowSaveIn(BaseModel):
    data: Flow
    version: int = Field(0, description="読み込んだ時点のversion。新規は0")


class HearingFormatIn(BaseModel):
    raw: str = Field(..., max_length=20000)


class HearingFormatOut(BaseModel):
    text: str


# ---------- AIによるTO-BEの改善案 ----------
# AIが出すのは「AS-ISのどの作業を、どう変えるか」の一覧だけ。TO-BEの図は、これをAS-ISに当てはめて画面側で作る
TobeAction = Literal["排除", "統合", "入替", "簡素化", "自動化"]


class TobeChange(BaseModel):
    id: str                       # 変える作業（AS-ISの作業ID）
    action: TobeAction            # 変更区分
    name: Optional[str] = Field(None, max_length=60)   # 変更後の作業名（排除では使わない）
    minutes: Optional[int] = Field(None, ge=0, le=100000)  # 変更後の所要時間（分）
    tool: Optional[str] = Field(None, max_length=60)   # 変更後の道具
    media: Optional[str] = Field(None, max_length=20)  # 変更後の、次の作業への渡し方
    note: str = Field("", max_length=200)              # 何を使って、何を、どう変えるか
    issue_resolved: bool = False  # この変更で、その作業のボトルネックが解消するか


class TobePlanOut(BaseModel):
    summary: str = ""             # この案の要約
    needs: list[str] = []         # 導入・準備が必要なもの
    changes: list[TobeChange]


# ---------- AS-ISの版と、診断の記録（履歴） ----------
DiagnosisKind = Literal["annual", "proposal"]  # 年次DX診断 / 改善提案


class Gap(BaseModel):
    """経営者の見立てと現場の実態のずれ（1件）"""

    exec: str = Field("", max_length=300)   # 経営者の見立て
    field: str = Field("", max_length=300)  # 現場の実態


class DiagnosisIn(BaseModel):
    date: date
    kind: DiagnosisKind = "annual"
    participants: str = Field("", max_length=300)
    staff: str = Field("", max_length=200)
    note: str = Field("", max_length=5000)
    gaps: list[Gap] = Field(default_factory=list, max_length=30)
    # そのときのAS-ISの版（flow_versions.id）。1つの業務につき1つまで。
    # 省略（None）：新しく記録するときは各業務のいちばん新しい版、直すときは今のまま
    version_ids: Optional[list[int]] = Field(None, max_length=500)


class Metrics(BaseModel):
    """AS-ISから数えたもの（診断の記録では、選んだ版の合計）"""

    businesses: int = 0  # AS-ISのある業務の数
    steps: int = 0       # 作業の数
    minutes: int = 0     # 作業時間の合計（各業務1回あたり）
    issues: int = 0      # 詰まり（ボトルネック）の数
    manual: int = 0      # 手入力・転記の箇所
    paper: int = 0       # 紙の工程
    mail: int = 0        # メール連絡
    gaps: int = 0        # 経営者の見立てと現場の実態のずれ


class DiagnosisVersion(BaseModel):
    """診断の記録で選んだ、ある業務のAS-ISの版"""

    business_id: int
    business_name: str
    version_id: int
    number: int  # 第何版か
    saved_hours: Optional[float] = None  # その版の削減工数（月あたり・時間。第1版とくらべて）。出せなければ None


class DiagnosisOut(BaseModel):
    id: int
    company_id: int
    date: date
    kind: str
    participants: str
    staff: str
    note: str
    gaps: list[Gap]
    created_by: str
    metrics: Metrics
    versions: list[DiagnosisVersion] = []  # 選んだAS-ISの版（業務ごと）
    saved_hours: Optional[float] = None    # 選んだ版の削減工数の合計（月あたり・時間）。出せる業務が1つもなければ None


class DiagnosisRef(BaseModel):
    id: int
    date: date
    kind: str


class VersionRef(BaseModel):
    """AS-ISの版の見出し（中身なし）。診断を記録するときの選択肢に使う"""

    id: int
    business_id: int
    number: int
    saved_at: Optional[datetime]
    saved_by: str
    minutes: int = 0  # 作業時間の合計（1回あたり・分）
    # 削減工数（月あたり・時間）。第1版とくらべて、どれだけ減ったか
    saved_hours_input: Optional[float] = None  # 手で入力した値（なければ None）
    saved_hours_auto: Optional[float] = None   # 自動の値＝（第1版の時間 − この版の時間）× 月の件数。月の件数が分からなければ None
    saved_hours: Optional[float] = None        # 使う値（入力があれば入力、なければ自動）


class SavedHoursIn(BaseModel):
    value: Optional[float] = Field(None, ge=-1e9, le=1e9)  # None で、入力を消して自動の値に戻す


class EffortBusiness(BaseModel):
    business_id: int
    name: str
    versions: int                 # 版の数
    first_minutes: int            # 第1版の作業時間（1回あたり・分）
    latest_minutes: int           # いちばん新しい版の作業時間
    monthly_count: Optional[int]  # 月の件数（分からなければ None）
    saved_hours: Optional[float]  # いちばん新しい版の削減工数（月あたり・時間）
    current_hours: Optional[float] = None  # いまの作業時間（月あたり・時間）＝いちばん新しい版の作業時間 × 月の件数


class EffortMonth(BaseModel):
    month: str    # 2026-11
    hours: float  # その月の終わりの時点の、全業務の削減工数（月あたり・時間）


class EffortOut(BaseModel):
    """企業の全業務の削減工数（月あたり・時間。AS-ISの第1版とくらべて）"""

    total_hours: Optional[float]  # 全業務の合計（出せる業務が1つもなければ None）
    current_hours: Optional[float] = None  # 全業務の、いまの作業時間の合計（月あたり・時間）
    businesses: list[EffortBusiness]
    months: list[EffortMonth]     # 月ごとの推移（最初の版を保存した月から今月まで。長くても直近24か月）


class AsisVersionOut(VersionRef):
    """ある業務の、AS-ISの版（保存した時点の中身）"""

    data: Flow
    metrics: Metrics
    diagnoses: list[DiagnosisRef] = []  # この版を選んでいる診断の記録


class AssignIn(BaseModel):
    user_ids: list[int]


class RenderIn(BaseModel):
    flow: Flow
    title: str = "業務フロー"
