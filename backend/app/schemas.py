"""業務フローの「決まったフォーマット」と API の入出力。"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ステップ種別（図形が固定で対応する）
StepType = Literal["作業", "判断", "システム処理", "帳票", "待ち"]
# TO-BE の変更区分（ECRS + 自動化 + 新規）
ChangeAction = Literal["排除", "統合", "入替", "簡素化", "自動化", "新規"]
ResourceKind = Literal["部署", "担当者", "取引先", "システム", "帳票"]
# TO-BE は松竹梅の3案（梅＝やり方の見直しだけ／竹＝手ごろなツールの導入／松＝RPA・システム連携で自動化）
Plan = Literal["ume", "take", "matsu"]
PLANS: tuple[str, ...] = ("ume", "take", "matsu")
FlowKind = Literal["asis", "tobe_ume", "tobe_take", "tobe_matsu"]


def plan_kind(plan: str) -> str:
    """案（ume/take/matsu）→ flows.kind の値（tobe_ume など）"""
    return f"tobe_{plan}"


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
    # お金のかかる導入物（単価表の名前。単価表にない名前は、画面で「要見積もり」になる）
    cost_items: list[str] = Field(default_factory=list, max_length=20)
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
    adopted_plan: str = ""  # 採用する案（ume / take / matsu。未選択は空）
    # 削減時間（1回あたり・分）＝ AS-ISの合計時間 − TO-BEの合計時間。案ごと（作成済みの案だけ入る）
    saved_by_plan: dict[str, int] = {}
    # 一覧に出す削減時間：採用する案のもの。未選択なら竹。その案がまだなければ None
    saved_plan: Optional[str] = None
    saved_minutes: Optional[int] = None
    assignee_ids: list[int] = []


class FlowDocOut(BaseModel):
    kind: FlowKind
    data: Flow
    version: int
    updated_at: Optional[datetime]
    updated_by: str


class FlowsOut(BaseModel):
    asis: Optional[FlowDocOut]
    plans: dict[str, FlowDocOut]          # 作成済みのTO-BEの案（ume / take / matsu）
    comparisons: dict[str, Comparison]    # 案ごとの、AS-ISとの比較


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
    cost_items: list[str] = []    # お金のかかる導入物（単価表の名前。ないものは要見積もり）
    changes: list[TobeChange]


class TobeSuggestOut(BaseModel):
    plans: dict[str, TobePlanOut]  # ume / take / matsu（AIが出せた案だけ入る）


class AdoptIn(BaseModel):
    plan: Optional[Plan] = None   # 採用する案。None で未選択に戻す


# ---------- 単価表 ----------
class CostItemOut(_Out):
    id: int
    name: str
    initial_cost: int
    monthly_cost: int
    note: str
    sort: int


class CostItemIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    initial_cost: int = Field(0, ge=0, le=1_000_000_000)   # 初期費用（円）
    monthly_cost: int = Field(0, ge=0, le=1_000_000_000)   # 月額（円）
    note: str = Field("", max_length=200)
    sort: int = 0


class AssignIn(BaseModel):
    user_ids: list[int]


class RenderIn(BaseModel):
    flow: Flow
    title: str = "業務フロー"
