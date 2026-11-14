from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import ai, render
from .auth import can_see_company, current_user, get_business_or_404, require_admin
from .config import settings
from .db import Business, Company, FlowDoc, Resource, SessionLocal, User, get_db, init_db, now
from .schemas import (
    AssignIn, BusinessIn, BusinessNotesIn, BusinessOut, CompanyIn, CompanyOut, Flow, FlowDocOut, FlowKind,
    FlowSaveIn, FlowsOut, HearingFormatIn, HearingFormatOut, Me, RenderIn, ResourceIn, ResourceOut, UserIn, UserOut,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if settings.auth_mode == "dev" and settings.seed_demo:
        from .seed import seed

        with SessionLocal() as db:
            seed(db)
    yield


app = FastAPI(title="業務フロー管理 API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


# ---------- 共通 ----------
def _status(b: Business) -> str:
    kinds = {f.kind for f in b.flows}
    return "TO-BE作成済" if "tobe" in kinds else "AS-IS作成済" if "asis" in kinds else "未着手"


def _business_out(b: Business, user: User) -> BusinessOut:
    out = BusinessOut.model_validate(b)
    out.status = _status(b)
    out.assignee_ids = [u.id for u in b.assignees] if user.role == "admin" else []
    return out


def _company_or_404(db: Session, user: User, cid: int) -> Company:
    c = db.get(Company, cid)
    if not c or not can_see_company(user, cid):
        raise HTTPException(404, "企業が見つかりません")
    return c


def _flow_doc_out(f: FlowDoc | None) -> FlowDocOut | None:
    if not f:
        return None
    return FlowDocOut(kind=f.kind, data=Flow.model_validate(f.data), version=f.version,
                      updated_at=f.updated_at, updated_by=f.updated_by)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    return {"auth_mode": settings.auth_mode, "ai_enabled": ai.enabled()}


@app.get("/api/dev/users", response_model=list[UserOut])
def dev_users(db: Session = Depends(get_db)):
    """開発モードのユーザー切り替え用。本番（entra）では使えない。"""
    if settings.auth_mode != "dev":
        raise HTTPException(404)
    return [_user_out(u) for u in db.scalars(select(User).order_by(User.role, User.company_id, User.id))]


@app.get("/api/me", response_model=Me)
def me(user: User = Depends(current_user)):
    return user


# ---------- 企業 ----------
@app.get("/api/companies", response_model=list[CompanyOut])
def list_companies(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Company).order_by(Company.id)
    if user.role != "admin":
        q = q.where(Company.id == user.company_id)
    out = []
    for c in db.scalars(q):
        o = CompanyOut.model_validate(c)
        o.business_count = (
            len(c.businesses) if user.role == "admin" else sum(1 for b in c.businesses if user in b.assignees)
        )
        out.append(o)
    return out


@app.get("/api/companies/{cid}", response_model=CompanyOut)
def get_company(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _company_or_404(db, user, cid)


@app.post("/api/companies", response_model=CompanyOut)
def create_company(body: CompanyIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    c = Company(**body.model_dump())
    db.add(c)
    db.commit()
    return c


@app.put("/api/companies/{cid}", response_model=CompanyOut)
def update_company(cid: int, body: CompanyIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    c = _company_or_404(db, user, cid)
    c.name, c.note = body.name, body.note
    db.commit()
    return c


@app.delete("/api/companies/{cid}")
def delete_company(cid: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.delete(_company_or_404(db, user, cid))
    db.commit()
    return {"deleted": cid}


# ---------- リソース ----------
@app.get("/api/companies/{cid}/resources", response_model=list[ResourceOut])
def list_resources(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _company_or_404(db, user, cid)
    return db.scalars(
        select(Resource).where(Resource.company_id == cid).order_by(Resource.kind, Resource.sort, Resource.id)
    ).all()


@app.post("/api/companies/{cid}/resources", response_model=ResourceOut)
def create_resource(cid: int, body: ResourceIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    _company_or_404(db, user, cid)
    r = Resource(company_id=cid, **body.model_dump())
    db.add(r)
    db.commit()
    return r


@app.put("/api/resources/{rid}", response_model=ResourceOut)
def update_resource(rid: int, body: ResourceIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(Resource, rid)
    if not r:
        raise HTTPException(404, "リソースが見つかりません")
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    db.commit()
    return r


@app.delete("/api/resources/{rid}")
def delete_resource(rid: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(Resource, rid)
    if not r:
        raise HTTPException(404, "リソースが見つかりません")
    db.delete(r)
    db.commit()
    return {"deleted": rid}


# ---------- 業務 ----------
@app.get("/api/companies/{cid}/businesses", response_model=list[BusinessOut])
def list_businesses(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _company_or_404(db, user, cid)
    q = select(Business).where(Business.company_id == cid).order_by(Business.id)
    if user.role != "admin":
        q = q.where(Business.assignees.any(User.id == user.id))  # 割り当てられた業務だけ
    return [_business_out(b, user) for b in db.scalars(q)]


@app.post("/api/companies/{cid}/businesses", response_model=BusinessOut)
def create_business(cid: int, body: BusinessIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    _company_or_404(db, user, cid)
    b = Business(company_id=cid, **body.model_dump())
    db.add(b)
    db.commit()
    return _business_out(b, user)


@app.get("/api/businesses/{bid}", response_model=BusinessOut)
def get_business(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _business_out(get_business_or_404(db, user, bid), user)


@app.put("/api/businesses/{bid}", response_model=BusinessOut)
def update_business(bid: int, body: BusinessIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    b = get_business_or_404(db, user, bid)
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    db.commit()
    return _business_out(b, user)


@app.put("/api/businesses/{bid}/notes", response_model=BusinessOut)
def update_notes(bid: int, body: BusinessNotesIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """ヒアリングメモ・経営者の認識・現場の実態は担当者も編集できる"""
    b = get_business_or_404(db, user, bid)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(b, k, v)
    b.updated_at = now()
    db.commit()
    return _business_out(b, user)


@app.post("/api/businesses/{bid}/hearing/format", response_model=HearingFormatOut)
def format_hearing(bid: int, body: HearingFormatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """ヒアリングボックスの記録を、Azure OpenAI で「AS-ISの形式」に整える（保存はしない。画面で確認してから保存）"""
    b = get_business_or_404(db, user, bid)
    rs = db.scalars(select(Resource).where(Resource.company_id == b.company_id).order_by(Resource.sort, Resource.id)).all()
    lanes = [r.name for r in rs if r.kind in ("部署", "担当者", "取引先")]
    tools = [r.name for r in rs if r.kind in ("システム", "帳票")]
    try:
        text = ai.format_hearing(body.raw, b.name, lanes, tools)
    except ai.AIError as e:
        raise HTTPException(e.status, str(e)) from e
    return HearingFormatOut(text=text)


@app.delete("/api/businesses/{bid}")
def delete_business(bid: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.delete(get_business_or_404(db, user, bid))
    db.commit()
    return {"deleted": bid}


@app.put("/api/businesses/{bid}/assignees", response_model=BusinessOut)
def set_assignees(bid: int, body: AssignIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    b = get_business_or_404(db, user, bid)
    users = db.scalars(select(User).where(User.id.in_(body.user_ids))).all()
    if any(u.company_id != b.company_id for u in users):
        raise HTTPException(422, "他社のユーザーは割り当てられません")
    b.assignees = list(users)
    db.commit()
    return _business_out(b, user)


# ---------- フロー（AS-IS / TO-BE）----------
def _flows(b: Business) -> dict[str, FlowDoc]:
    return {f.kind: f for f in b.flows}


@app.get("/api/businesses/{bid}/flows", response_model=FlowsOut)
def get_flows(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fl = _flows(get_business_or_404(db, user, bid))
    a, t = fl.get("asis"), fl.get("tobe")
    cmp = render.compare(Flow.model_validate(a.data), Flow.model_validate(t.data)) if a and t else None
    return FlowsOut(asis=_flow_doc_out(a), tobe=_flow_doc_out(t), comparison=cmp)


@app.put("/api/businesses/{bid}/flows/{kind}", response_model=FlowDocOut)
def save_flow(bid: int, kind: FlowKind, body: FlowSaveIn,
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    """管理者も、割り当てられた担当者も編集できる。versionが古ければ409（上書き防止）"""
    b = get_business_or_404(db, user, bid)
    ids = [s.id for s in body.data.steps]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "ステップIDが重複しています")
    f = _flows(b).get(kind)
    if f and f.version != body.version:
        raise HTTPException(409, f"{f.updated_by} さんが先に更新しています。画面を再読み込みしてください")
    if not f:
        f = FlowDoc(business_id=b.id, kind=kind, version=0)
        db.add(f)
    f.data = body.data.model_dump()
    f.version += 1
    f.updated_at = now()
    f.updated_by = user.name
    b.updated_at = now()
    db.commit()
    return _flow_doc_out(f)


@app.post("/api/businesses/{bid}/flows/tobe/copy-from-asis", response_model=FlowDocOut)
def copy_asis_to_tobe(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business_or_404(db, user, bid)
    fl = _flows(b)
    if "asis" not in fl:
        raise HTTPException(422, "先にAS-ISを作成してください")
    if "tobe" in fl:
        raise HTTPException(409, "TO-BEは既にあります")
    data = Flow.model_validate(fl["asis"].data)
    for s in data.steps:
        s.change = None
        s.note = ""
    f = FlowDoc(business_id=b.id, kind="tobe", data=data.model_dump(), version=1, updated_by=user.name)
    db.add(f)
    b.updated_at = now()
    db.commit()
    return _flow_doc_out(f)


@app.get("/api/businesses/{bid}/flows/{kind}/drawio")
def export_drawio(bid: int, kind: FlowKind, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business_or_404(db, user, bid)
    f = _flows(b).get(kind)
    if not f:
        raise HTTPException(404, "フローがありません")
    label = "AS-IS" if kind == "asis" else "TO-BE"
    xml = render.to_drawio(Flow.model_validate(f.data), f"{b.name} {label}")
    return Response(xml, media_type="application/xml")


@app.post("/api/render/drawio")
def render_drawio(body: RenderIn, _: User = Depends(current_user)):
    return Response(render.to_drawio(body.flow, body.title), media_type="application/xml")


# ---------- ユーザー（管理者のみ）----------
def _user_out(u: User) -> UserOut:
    o = UserOut.model_validate(u)
    o.business_ids = [b.id for b in u.businesses]
    return o


@app.get("/api/companies/{cid}/users", response_model=list[UserOut])
def list_users(cid: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    _company_or_404(db, user, cid)
    return [_user_out(u) for u in db.scalars(select(User).where(User.company_id == cid).order_by(User.id))]


@app.post("/api/users", response_model=UserOut)
def create_user(body: UserIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    if body.role == "member" and not body.company_id:
        raise HTTPException(422, "担当者には企業の指定が必要です")
    if db.scalar(select(User).where(User.email.ilike(body.email))):
        raise HTTPException(409, "このメールアドレスは登録済みです")
    u = User(**body.model_dump())
    db.add(u)
    db.commit()
    return _user_out(u)


@app.put("/api/users/{uid}", response_model=UserOut)
def update_user(uid: int, body: UserIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "ユーザーが見つかりません")
    if u.company_id != body.company_id:
        u.businesses = []  # 企業が変わったら割り当てを外す
    for k, v in body.model_dump().items():
        setattr(u, k, v)
    db.commit()
    return _user_out(u)


@app.delete("/api/users/{uid}")
def delete_user(uid: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "ユーザーが見つかりません")
    if u.id == admin.id:
        raise HTTPException(422, "自分自身は削除できません")
    db.delete(u)
    db.commit()
    return {"deleted": uid}
