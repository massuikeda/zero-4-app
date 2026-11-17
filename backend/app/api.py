from __future__ import annotations

import re
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import ai, effort, render
from .auth import can_see_company, current_user, find_user, get_business_or_404, require_admin
from .auth import (  # noqa: I001
    _DUMMY_HASH, LOCK_MINUTES, MAX_FAILED_LOGINS, PORTAL_ERROR, PORTAL_ROLE, clear_session, is_locked, set_password,
    set_session, utcnow, verify_password,
)
from .config import settings
from .db import ASIS_KIND, TOBE_KIND, Diagnosis, DiagnosisFlow, FlowVersion  # noqa: I001
from .db import Business, Company, FlowDoc, Resource, SessionLocal, User, get_db, init_db, now
from .schemas import (
    AssignIn, BusinessIn, BusinessNotesIn, BusinessOut, CompanyIn, CompanyOut, Flow, FlowDocOut, FlowKind,
    FlowSaveIn, FlowsOut, HearingFormatIn, HearingFormatOut, Me, RenderIn, ResourceIn, ResourceOut, TobePlanOut,
    UserIn, UserOut,
)
from .schemas import (  # noqa: I001
    AsisVersionOut, DiagnosisIn, DiagnosisOut, DiagnosisRef, DiagnosisVersion, EffortBusiness, EffortMonth, EffortOut,
    Metrics, SavedHoursIn, VersionRef,
)
from .schemas import LoginIn, PasswordChangeIn, PasswordResetIn  # noqa: I001


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


# 画面・APIでの図の種類（asis / tobe）→ DBの flows.kind の値。
# TO-BE は、松竹梅の3案だったころの「松」の行をそのまま使う（DBの値は変えていない）
DB_KIND = {"asis": ASIS_KIND, "tobe": TOBE_KIND}
API_KIND = {v: k for k, v in DB_KIND.items()}


# ---------- 共通 ----------
def _flows(b: Business) -> dict[str, FlowDoc]:
    """業務の図（asis / tobe → FlowDoc）。使っていない種類の行（以前の梅・竹など）は入らない"""
    return {API_KIND[f.kind]: f for f in b.flows if f.kind in API_KIND}


def _status(b: Business) -> str:
    fl = _flows(b)
    if "tobe" in fl:
        return "TO-BE作成済"
    return "AS-IS作成済" if "asis" in fl else "未着手"


def _saved_minutes(b: Business) -> int | None:
    """削減時間（1回あたり・分）。比較タブの「削減時間」と同じ計算（作業時間の合計の差）"""
    fl = _flows(b)
    if "asis" not in fl or "tobe" not in fl:
        return None

    def total(f: FlowDoc) -> int:
        return sum(int(s.get("minutes") or 0) for s in (f.data or {}).get("steps", []))

    return total(fl["asis"]) - total(fl["tobe"])


def _business_out(b: Business, user: User, db: Session | None = None) -> BusinessOut:
    out = BusinessOut.model_validate(b)
    out.status = _status(b)
    out.saved_minutes = _saved_minutes(b)
    if db is not None:
        from sqlalchemy import func

        out.asis_versions = db.scalar(
            select(func.count()).select_from(FlowVersion).where(FlowVersion.business_id == b.id)
        ) or 0
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
    return FlowDocOut(kind=API_KIND[f.kind], data=Flow.model_validate(f.data), version=f.version,
                      updated_at=f.updated_at, updated_by=f.updated_by)


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    """動いているかの確認。使っているDBの種類（sqlite / mysql）と、登録されているユーザー数も返す
    （設定の取り違えで空のDBを見ていないかを、ここで確かめられる）"""
    from sqlalchemy import func

    return {"status": "ok", "db": db.get_bind().dialect.name, "users": db.scalar(select(func.count()).select_from(User))}


@app.get("/api/config")
def config():
    return {"auth_mode": settings.auth_mode, "ai_enabled": ai.enabled()}


@app.get("/api/dev/users", response_model=list[UserOut])
def dev_users(role: str | None = None, db: Session = Depends(get_db)):
    """開発モードのログイン画面で選ぶユーザーの一覧（role=admin / member で絞り込み）。本番（entra）では使えない。"""
    if settings.auth_mode != "dev":
        raise HTTPException(404)
    q = select(User).order_by(User.role, User.company_id, User.id)
    if role:
        q = q.where(User.role == role)
    return [_user_out(u) for u in db.scalars(q)]


@app.get("/api/me", response_model=Me)
def me(user: User = Depends(current_user)):
    return user


# ---------- ログイン（AUTH_MODE=password）----------
WRONG_LOGIN = "メールアドレスかパスワードが違います"


def _need_password_mode():
    if settings.auth_mode != "password":
        raise HTTPException(404)


def _locked_message(user: User) -> str:
    mins = max(1, int((user.locked_until - utcnow()).total_seconds() // 60) + 1)
    return f"パスワードを{MAX_FAILED_LOGINS}回続けて間違えたため、ロックしています。約{mins}分後にもう一度お試しください"


@app.post("/api/auth/login", response_model=Me)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    _need_password_mode()
    user = find_user(db, body.email)
    if user and is_locked(user):
        raise HTTPException(429, _locked_message(user))
    # 登録がない・パスワード未設定でも同じ計算をして、同じ言葉で断る（登録の有無を分からなくする）
    ok = verify_password(body.password, (user.password_hash if user else "") or _DUMMY_HASH)
    if not user or not user.password_hash or not ok:
        if user:
            user.failed_logins += 1
            if user.failed_logins >= MAX_FAILED_LOGINS:
                user.failed_logins = 0
                user.locked_until = utcnow() + timedelta(minutes=LOCK_MINUTES)
                db.commit()
                raise HTTPException(429, _locked_message(user))
            db.commit()
        raise HTTPException(401, WRONG_LOGIN)
    if user.role != PORTAL_ROLE[body.portal]:
        raise HTTPException(403, PORTAL_ERROR[body.portal])
    user.failed_logins = 0
    user.locked_until = None
    db.commit()
    set_session(response, user)
    return user


@app.post("/api/auth/logout")
def logout(response: Response):
    clear_session(response)
    return {"ok": True}


@app.put("/api/auth/password")
def change_password(
    body: PasswordChangeIn, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """自分のパスワードを変える（いまのパスワードの確認つき）。ほかの端末のログイン状態は使えなくなる"""
    _need_password_mode()
    if not verify_password(body.current_password, user.password_hash or _DUMMY_HASH):
        raise HTTPException(422, "いまのパスワードが違います")
    if body.new_password == body.current_password:
        raise HTTPException(422, "いまと違うパスワードにしてください")
    set_password(user, body.new_password)
    db.commit()
    set_session(response, user)  # この端末はログインしたままにする
    return {"ok": True}


# ---------- 企業 ----------
@app.get("/api/companies", response_model=list[CompanyOut])
def list_companies(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Company).order_by(Company.id)
    if user.role != "admin":
        q = q.where(Company.id == user.company_id)
    out = []
    for c in db.scalars(q):
        o = CompanyOut.model_validate(c)
        o.business_count = len(c.businesses)
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
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return c


@app.delete("/api/companies/{cid}")
def delete_company(cid: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.delete(_company_or_404(db, user, cid))
    db.commit()
    return {"deleted": cid}


# ---------- 図の候補（担当・道具）----------
# 候補は手で登録しない。その企業の図（AS-IS と TO-BE）に出てきた担当と道具を、そのまま候補にする。
# AIが作った図に出てきた名前が、次に図を作る・直すときの候補になる（名前のゆれを防ぐ）。
_OUTSIDE = re.compile(r"取引先|顧客|お客|得意先|仕入|業者|外注|委託先|メーカー|問屋")
# 紙として数える道具（画面の「紙」の集計に使われる）。伝票・帳票のほか、請求書・納品書などの「〇〇書」
_PAPER = re.compile(r"紙|伝票|帳票|印刷|書類|手書き|(注文|発注|請求|納品|領収|精算|申請|見積|明細|契約|報告|依頼|指示|検収)書")
_FLOW_KINDS = (ASIS_KIND, TOBE_KIND)


def _candidates(db: Session, company_id: int) -> list[ResourceOut]:
    """企業の図（AS-IS と TO-BE）に出てきた担当（部署・取引先）と道具（システム・帳票）の一覧。出てきた順。保存はしない"""
    flows = db.scalars(
        select(FlowDoc).join(Business).where(Business.company_id == company_id, FlowDoc.kind.in_(_FLOW_KINDS))
        .order_by(FlowDoc.business_id, FlowDoc.id)
    ).all()
    out: list[ResourceOut] = []
    seen: set[tuple[str, str]] = set()

    def add(group: str, kind: str, name: object) -> None:
        name = str(name or "").strip()
        if not name or (group, name) in seen:
            return
        seen.add((group, name))
        # id は画面の一覧用の通し番号（DBの行ではないので負の数にしておく）
        out.append(ResourceOut(id=-(len(out) + 1), company_id=company_id, kind=kind, name=name, note="", sort=len(out)))

    for f in flows:
        data = f.data or {}
        steps = data.get("steps") or []
        for lane in [*(data.get("lanes") or []), *(st.get("lane") for st in steps)]:
            add("lane", "取引先" if _OUTSIDE.search(str(lane or "")) else "部署", lane)
        for st in steps:
            tool = st.get("tool")
            add("tool", "帳票" if _PAPER.search(str(tool or "")) else "システム", tool)
    return out


def _lanes_and_tools(db: Session, company_id: int) -> tuple[list[str], list[str]]:
    cs = _candidates(db, company_id)
    return ([c.name for c in cs if c.kind in ("部署", "担当者", "取引先")], [c.name for c in cs if c.kind in ("システム", "帳票")])


@app.get("/api/companies/{cid}/resources", response_model=list[ResourceOut])
def list_resources(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """図の候補。その企業の図に出てきた担当と道具（手で登録したものではない）"""
    _company_or_404(db, user, cid)
    return _candidates(db, cid)


# 以下の登録・変更・削除は、以前「図の候補」を手で登録していたころのAPI。画面からは使っていない（候補にも出ない）
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
    return [_business_out(b, user, db) for b in db.scalars(q)]


@app.post("/api/companies/{cid}/businesses", response_model=BusinessOut)
def create_business(cid: int, body: BusinessIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    _company_or_404(db, user, cid)
    b = Business(company_id=cid, **body.model_dump())
    db.add(b)
    db.commit()
    return _business_out(b, user)


@app.get("/api/businesses/{bid}", response_model=BusinessOut)
def get_business(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _business_out(get_business_or_404(db, user, bid), user, db)


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
    lanes, tools = _lanes_and_tools(db, b.company_id)
    try:
        text = ai.format_hearing(body.raw, b.name, lanes, tools)
    except ai.AIError as e:
        raise HTTPException(e.status, str(e)) from e
    return HearingFormatOut(text=text)


@app.post("/api/businesses/{bid}/tobe/suggest", response_model=TobePlanOut)
def suggest_tobe(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """保存済みのAS-ISから、Azure OpenAI で TO-BE の改善案を作る（どの作業をどう変えるか）。
    保存はしない。画面がAS-ISに当てはめて図にし、利用者が確認してから保存する"""
    b = get_business_or_404(db, user, bid)
    asis = _flows(b).get("asis")
    if not asis:
        raise HTTPException(422, "先にAS-ISを作成して保存してください")
    _, tools = _lanes_and_tools(db, b.company_id)
    try:
        return ai.suggest_tobe(Flow.model_validate(asis.data), b.name, b.frequency, tools)
    except ai.AIError as e:
        raise HTTPException(e.status, str(e)) from e


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
def _add_version(db: Session, b: Business, data: dict, user: User) -> None:
    """AS-ISを保存するたびに、その中身を版として残す。直前の版と中身が同じなら、増やさない"""
    last = db.scalar(select(FlowVersion).where(FlowVersion.business_id == b.id).order_by(FlowVersion.number.desc()).limit(1))
    if last and last.data == data:
        return
    db.add(FlowVersion(business_id=b.id, number=last.number + 1 if last else 1, data=data, saved_by=user.name))


@app.get("/api/businesses/{bid}/flows", response_model=FlowsOut)
def get_flows(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business_or_404(db, user, bid)
    fl = _flows(b)
    a, t = fl.get("asis"), fl.get("tobe")
    comparison = render.compare(Flow.model_validate(a.data), Flow.model_validate(t.data)) if a and t else None
    return FlowsOut(asis=_flow_doc_out(a), tobe=_flow_doc_out(t), comparison=comparison)


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
        f = FlowDoc(business_id=b.id, kind=DB_KIND[kind], version=0)
        db.add(f)
    f.data = body.data.model_dump()
    f.version += 1
    f.updated_at = now()
    f.updated_by = user.name
    b.updated_at = now()
    if kind == "asis":
        _add_version(db, b, f.data, user)
    db.commit()
    return _flow_doc_out(f)


@app.post("/api/businesses/{bid}/flows/tobe/copy-from-asis", response_model=FlowDocOut)
def copy_asis_to_tobe(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """AS-ISをコピーして、TO-BEを作る"""
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
    f = FlowDoc(business_id=b.id, kind=TOBE_KIND, data=data.model_dump(), version=1, updated_by=user.name)
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
    o.has_password = bool(u.password_hash)
    o.locked = is_locked(u)
    return o


@app.get("/api/companies/{cid}/users", response_model=list[UserOut])
def list_users(cid: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    _company_or_404(db, user, cid)
    return [_user_out(u) for u in db.scalars(select(User).where(User.company_id == cid).order_by(User.id))]


@app.post("/api/users", response_model=UserOut)
def create_user(body: UserIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    if body.role == "member" and not body.company_id:
        raise HTTPException(422, "企業担当者には企業の指定が必要です")
    if body.company_id and not db.get(Company, body.company_id):
        raise HTTPException(422, "企業が見つかりません")
    if find_user(db, body.email):
        raise HTTPException(409, "このメールアドレスは登録済みです")
    u = User(**body.model_dump(exclude={"password"}))
    if body.password:
        set_password(u, body.password)
    elif settings.auth_mode == "password":
        raise HTTPException(422, "初期パスワードを入れてください")
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
    for k, v in body.model_dump(exclude={"password"}).items():
        setattr(u, k, v)
    db.commit()
    return _user_out(u)


@app.put("/api/users/{uid}/password", response_model=UserOut)
def reset_password(uid: int, body: PasswordResetIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """忘れたとき・ロックを解きたいときに、銀行担当者がパスワードを決め直す（ロックも解ける）"""
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "ユーザーが見つかりません")
    set_password(u, body.password)
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


# ---------- AS-ISの版と、診断の記録（履歴） ----------
# AS-ISは、保存するたびに版が残る（あとから書き換えない）。診断を記録するときに、業務ごとに「そのときの版」を選ぶ。
# 選んだ版から「詰まりの数」「手入力・転記の箇所」などを数えて、年ごとに並べて、良くなったかを見比べる。
def _metrics(flows: list[dict], gaps: int = 0) -> Metrics:
    """AS-IS（いくつかの業務ぶん）から数える。数え方は比較タブ・図の右側の集計と同じ（render.counters）"""
    m = Metrics(gaps=gaps)
    for data in flows:
        try:
            f = Flow.model_validate(data or {})
        except ValueError:
            continue  # 形の合わない古いデータは数えない
        if not f.steps:
            continue
        manual, mail, paper = render.counters(f)
        m.businesses += 1
        m.steps += len(f.steps)
        m.minutes += sum(s.minutes for s in f.steps)
        m.issues += sum(1 for s in f.steps if s.issue)
        m.manual += manual
        m.mail += mail
        m.paper += paper
    return m


def _first_minutes(db: Session, business_ids: list[int]) -> dict[int, int]:
    """業務ごとの、第1版（いちばん古い版）の作業時間"""
    out: dict[int, int] = {}
    q = select(FlowVersion).where(FlowVersion.business_id.in_(business_ids)).order_by(FlowVersion.business_id, FlowVersion.number)
    for v in db.scalars(q) if business_ids else []:
        out.setdefault(v.business_id, effort.total_minutes(v.data))
    return out


def _version_ref(v: FlowVersion, first_minutes: int, count: int | None) -> VersionRef:
    """版の見出し。削減工数は、第1版の作業時間（first_minutes）と月の件数（count）から出す"""
    minutes = effort.total_minutes(v.data)
    auto = effort.auto_saved_hours(first_minutes, minutes, count)
    return VersionRef(
        id=v.id, business_id=v.business_id, number=v.number, saved_at=v.saved_at, saved_by=v.saved_by, minutes=minutes,
        saved_hours_input=v.saved_hours, saved_hours_auto=auto,
        saved_hours=v.saved_hours if v.saved_hours is not None else auto,
    )


@app.get("/api/businesses/{bid}/versions", response_model=list[AsisVersionOut])
def list_asis_versions(bid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """この業務のAS-ISの版（古い順。第1版が最初のAS-IS）。中身つき"""
    b = get_business_or_404(db, user, bid)
    out = []
    first, count = _first_minutes(db, [b.id]).get(b.id, 0), effort.monthly_count(b)
    for v in db.scalars(select(FlowVersion).where(FlowVersion.business_id == b.id).order_by(FlowVersion.number)):
        try:
            data = Flow.model_validate(v.data or {})
        except ValueError:
            continue
        refs = sorted((x.diagnosis for x in v.links), key=lambda d: (d.date, d.id))
        out.append(AsisVersionOut(
            **_version_ref(v, first, count).model_dump(), data=data, metrics=_metrics([v.data]),
            diagnoses=[DiagnosisRef(id=d.id, date=d.date, kind=d.kind) for d in refs],
        ))
    return out


@app.get("/api/companies/{cid}/versions", response_model=list[VersionRef])
def list_company_versions(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """企業の全業務の、AS-ISの版の見出し（中身なし）。診断を記録するときの選択肢に使う"""
    c = _company_or_404(db, user, cid)
    q = (select(FlowVersion).join(Business, FlowVersion.business_id == Business.id)
         .where(Business.company_id == cid).order_by(FlowVersion.business_id, FlowVersion.number))
    first = _first_minutes(db, [b.id for b in c.businesses])
    count = {b.id: effort.monthly_count(b) for b in c.businesses}
    return [_version_ref(v, first.get(v.business_id, 0), count.get(v.business_id)) for v in db.scalars(q)]


@app.put("/api/versions/{vid}/saved-hours", response_model=VersionRef)
def set_saved_hours(vid: int, body: SavedHoursIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """版ごとの削減工数（月あたり・時間）を手で入力する（実績など）。value=null で入力を消して、自動の値に戻す。
    AS-ISを編集できる人（銀行担当者・その企業の担当者）が入力できる"""
    v = db.get(FlowVersion, vid)
    if not v:
        raise HTTPException(404, "AS-ISの版が見つかりません")
    b = get_business_or_404(db, user, v.business_id)
    v.saved_hours = body.value
    db.commit()
    return _version_ref(v, _first_minutes(db, [b.id]).get(b.id, 0), effort.monthly_count(b))


@app.get("/api/companies/{cid}/effort", response_model=EffortOut)
def company_effort(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """企業の全業務の削減工数（月あたり・時間）。業務ごとに、AS-ISの第1版といちばん新しい版をくらべる。
    月ごとの推移は、その月の終わりの時点でいちばん新しかった版で出す"""
    c = _company_or_404(db, user, cid)
    rows: list[EffortBusiness] = []
    by_month: dict[str, float] = {}
    this_month = effort.month_of(None)
    first_month = this_month
    for b in c.businesses:
        vs = sorted(b.versions, key=lambda v: v.number)
        if not vs:
            continue
        count = effort.monthly_count(b)
        refs = [_version_ref(v, effort.total_minutes(vs[0].data), count) for v in vs]
        rows.append(EffortBusiness(
            business_id=b.id, name=b.name, versions=len(vs), first_minutes=refs[0].minutes, latest_minutes=refs[-1].minutes,
            monthly_count=count, saved_hours=refs[-1].saved_hours,
            current_hours=None if count is None else round(refs[-1].minutes * count / 60, 1),
        ))
        # 月ごと：その月に保存した最後の版の値が、次に保存する月まで続く
        last_of_month: dict[str, float | None] = {}
        for v, r in zip(vs, refs):
            last_of_month[effort.month_of(v.saved_at)] = r.saved_hours
        first_month = min(first_month, min(last_of_month))
        cur: float | None = None
        for m in _months(min(last_of_month), this_month):
            if m in last_of_month:
                cur = last_of_month[m]
            if cur is not None:
                by_month[m] = by_month.get(m, 0.0) + cur
    known = [r.saved_hours for r in rows if r.saved_hours is not None]
    months = [EffortMonth(month=m, hours=round(by_month.get(m, 0.0), 1)) for m in _months(first_month, this_month)][-24:]
    current = [r.current_hours for r in rows if r.current_hours is not None]
    return EffortOut(total_hours=round(sum(known), 1) if known else None,
                     current_hours=round(sum(current), 1) if current else None,
                     businesses=rows, months=months if rows else [])


def _months(start: str, end: str) -> list[str]:
    """2026-09 から 2026-11 まで → ["2026-09", "2026-10", "2026-11"]"""
    y, m = (int(x) for x in start.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= end:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _diagnosis_out(d: Diagnosis) -> DiagnosisOut:
    gaps = [g for g in (d.gaps or []) if isinstance(g, dict)]
    links = sorted(d.flows, key=lambda x: x.business_id)
    versions = []
    for x in links:
        b = x.version.business
        first = min(b.versions, key=lambda v: v.number)  # 第1版
        ref = _version_ref(x.version, effort.total_minutes(first.data), effort.monthly_count(b))
        versions.append(DiagnosisVersion(business_id=x.business_id, business_name=b.name, version_id=x.version_id,
                                         number=x.version.number, saved_hours=ref.saved_hours))
    known = [v.saved_hours for v in versions if v.saved_hours is not None]
    return DiagnosisOut(
        id=d.id, company_id=d.company_id, date=d.date, kind=d.kind, participants=d.participants, staff=d.staff,
        note=d.note, gaps=gaps, created_by=d.created_by,
        metrics=_metrics([x.version.data for x in links], len(gaps)),
        versions=versions, saved_hours=round(sum(known), 1) if known else None,
    )


def _diagnosis_or_404(db: Session, user: User, did: int) -> Diagnosis:
    d = db.get(Diagnosis, did)
    if not d or not can_see_company(user, d.company_id):
        raise HTTPException(404, "診断の記録が見つかりません")
    return d


def _clean_gaps(body: DiagnosisIn) -> list[dict]:
    """両方とも空のずれは捨てる"""
    return [{"exec": g.exec.strip(), "field": g.field.strip()} for g in body.gaps if g.exec.strip() or g.field.strip()]


def _set_versions(db: Session, d: Diagnosis, version_ids: list[int]) -> None:
    """診断の記録に、選んだAS-ISの版を結び付ける（その企業の業務の版だけ。1つの業務につき1つ）"""
    ids = set(version_ids)
    vs = db.scalars(
        select(FlowVersion).join(Business, FlowVersion.business_id == Business.id)
        .where(FlowVersion.id.in_(ids), Business.company_id == d.company_id)
    ).all() if ids else []
    if len(vs) != len(ids):
        raise HTTPException(422, "選んだAS-ISの版が見つかりません")
    if len({v.business_id for v in vs}) != len(vs):
        raise HTTPException(422, "1つの業務につき、選べる版は1つです")
    d.flows = []
    db.flush()  # 先に今の結び付きを消す（同じ業務を選び直せるように）
    d.flows = [DiagnosisFlow(business_id=v.business_id, version=v) for v in vs]


def _latest_version_ids(db: Session, cid: int) -> list[int]:
    """各業務の、いちばん新しい版"""
    from sqlalchemy import func

    newest = (select(FlowVersion.business_id, func.max(FlowVersion.number).label("n"))
              .join(Business, FlowVersion.business_id == Business.id)
              .where(Business.company_id == cid).group_by(FlowVersion.business_id).subquery())
    return list(db.scalars(
        select(FlowVersion.id).join(newest, (FlowVersion.business_id == newest.c.business_id) & (FlowVersion.number == newest.c.n))
    ))


@app.get("/api/companies/{cid}/diagnoses", response_model=list[DiagnosisOut])
def list_diagnoses(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """診断の記録（新しい順）。企業担当者も自社のものを見られる"""
    _company_or_404(db, user, cid)
    q = select(Diagnosis).where(Diagnosis.company_id == cid).order_by(Diagnosis.date.desc(), Diagnosis.id.desc())
    return [_diagnosis_out(d) for d in db.scalars(q)]


@app.post("/api/companies/{cid}/diagnoses", response_model=DiagnosisOut)
def create_diagnosis(cid: int, body: DiagnosisIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """診断を記録する。version_ids で、業務ごとに「そのときのAS-ISの版」を選ぶ（省略すると、各業務のいちばん新しい版）"""
    _company_or_404(db, user, cid)
    d = Diagnosis(company_id=cid, **body.model_dump(exclude={"gaps", "version_ids"}), gaps=_clean_gaps(body), created_by=user.name)
    db.add(d)
    db.flush()
    _set_versions(db, d, _latest_version_ids(db, cid) if body.version_ids is None else body.version_ids)
    db.commit()
    return _diagnosis_out(d)


@app.put("/api/diagnoses/{did}", response_model=DiagnosisOut)
def update_diagnosis(did: int, body: DiagnosisIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """日付・種類・参加者・内容・ずれ・選んだ版を直す（version_ids を省略すると、選んだ版は今のまま）"""
    d = _diagnosis_or_404(db, user, did)
    for k, v in body.model_dump(exclude={"gaps", "version_ids"}).items():
        setattr(d, k, v)
    d.gaps = _clean_gaps(body)
    if body.version_ids is not None:
        _set_versions(db, d, body.version_ids)
    db.commit()
    return _diagnosis_out(d)


@app.delete("/api/diagnoses/{did}")
def delete_diagnosis(did: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """記録を消す。AS-ISの版そのものは消えない（版との結び付きだけが消える）"""
    db.delete(_diagnosis_or_404(db, user, did))
    db.commit()
    return {"deleted": did}
