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
    status: str = "未着手"
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
    comparison: Optional[Comparison]


# ---------- 入力 ----------
class CompanyIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
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


class AssignIn(BaseModel):
    user_ids: list[int]


class RenderIn(BaseModel):
    flow: Flow
    title: str = "業務フロー"
