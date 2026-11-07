"""API の入出力の形

フロント（TypeScript）に合わせて JSON のキーは camelCase にする。
Python 側は snake_case で書き、alias_generator で自動変換している。
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---- 共通 ----------------------------------------------------------------

class Skill(CamelModel):
    id: int
    name: str
    category: str | None = None


class IssueOption(CamelModel):
    id: int
    category: str
    label: str


class Master(CamelModel):
    skills: list[Skill]
    issue_options: list[IssueOption]


class LoginIn(CamelModel):
    email: EmailStr
    password: str


class TokenOut(CamelModel):
    token: str


ProjectStatus = Literal["draft", "generated", "published", "closed", "contracted"]
ApplicationStatus = Literal["applied", "interview", "selected", "rejected", "withdrawn"]


# ---- 企業 ----------------------------------------------------------------

class CompanyRegisterIn(CamelModel):
    code: str
    company_name: str = Field(min_length=1)
    industry: str
    user_name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=8)


class CompanyUserOut(CamelModel):
    id: int
    name: str
    email: str


class CompanyOut(CamelModel):
    id: int
    name: str
    industry: str | None
    branch_name: str


class CompanyMe(CamelModel):
    user: CompanyUserOut
    company: CompanyOut


class Project(CamelModel):
    id: int
    status: ProjectStatus
    issue_option_ids: list[int]
    issue_free_text: str | None
    ai_summary: str | None
    ai_requirements: str | None
    public_title: str | None
    public_description: str | None
    skill_ids: list[int]
    hours_per_month: int
    duration_months: int
    monthly_fee: int | None
    published_at: str | None
    created_at: str
    applicant_count: int = 0
    new_applicant_count: int = 0


class ProjectIn(CamelModel):
    status: Literal["generated", "published"]
    issue_option_ids: list[int] = []
    issue_free_text: str = ""
    ai_summary: str = ""
    ai_requirements: str = ""
    public_title: str = Field(min_length=1)
    public_description: str = ""
    skill_ids: list[int] = []
    duration_months: int = Field(3, ge=1, le=12)
    monthly_fee: int = Field(50000, ge=0)


class AiDraftIn(CamelModel):
    issue_option_ids: list[int] = []
    free_text: str = ""


class AiDraft(CamelModel):
    summary: str
    requirements: str
    title: str
    description: str
    skill_ids: list[int]


class TalentCard(CamelModel):
    id: int
    display_name: str | None
    main_job: str | None
    bio: str | None
    skill_ids: list[int]


class Applicant(CamelModel):
    application_id: int
    status: ApplicationStatus
    message: str | None
    applied_at: str
    talent: TalentCard
    score: float
    keywords: list[str]


class RecommendedTalent(CamelModel):
    talent: TalentCard
    score: float
    keywords: list[str]


class CompanyProjectDetail(CamelModel):
    project: Project
    applicants: list[Applicant]
    recommended: list[RecommendedTalent]


class ApplicationStatusIn(CamelModel):
    status: Literal["interview", "selected", "rejected"]


# ---- 人材 ----------------------------------------------------------------

class TalentRegisterIn(CamelModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=8)


class TalentMe(CamelModel):
    id: int
    email: str
    name: str
    display_name: str | None
    bio: str | None
    main_job: str | None
    available_hours_month: int
    skill_ids: list[int]


class TalentProfileIn(CamelModel):
    display_name: str = Field(min_length=1)
    bio: str = ""
    main_job: str = ""
    available_hours_month: int = Field(10, ge=1, le=80)
    skill_ids: list[int] = []


class PublicProject(CamelModel):
    """人材に見せる案件（会社名は含めない）"""
    id: int
    status: ProjectStatus
    industry: str | None
    public_title: str | None
    public_description: str | None
    ai_requirements: str | None
    skill_ids: list[int]
    hours_per_month: int
    duration_months: int
    monthly_fee: int | None
    published_at: str | None
    score: float
    keywords: list[str]
    applied: bool


class MyApplicationRef(CamelModel):
    id: int
    status: ApplicationStatus


class TalentProjectDetail(PublicProject):
    my_application: MyApplicationRef | None


class ApplyIn(CamelModel):
    message: str = ""
    agreed: bool  # 本業と競合しない・守秘義務の確認


class MyApplication(CamelModel):
    id: int
    status: ApplicationStatus
    applied_at: str
    project_id: int
    public_title: str | None
    monthly_fee: int | None
