"""人材アプリ用 API（/api/talent/...）

会社名は返さない（業種まで）。
"""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status

from app import schemas
from app.db import get_db
from app.queries import PUBLIC_PROJECT_SELECT, public_project_from_row, talent_skill_ids
from app.security import create_token, current_talent, hash_password, verify_password
from matching.tfidf import refresh_match_scores

router = APIRouter(prefix="/api/talent", tags=["人材"])


# ---- 登録・ログイン・プロフィール -----------------------------------------------

@router.post("/register", response_model=schemas.TokenOut, status_code=201)
def register(body: schemas.TalentRegisterIn, db: sqlite3.Connection = Depends(get_db)):
    if db.execute("SELECT 1 FROM talents WHERE email = ?", (body.email,)).fetchone():
        raise HTTPException(400, "このメールアドレスはすでに登録されています。")
    with db:
        cur = db.execute(
            "INSERT INTO talents (email, password_hash, name, display_name) VALUES (?,?,?,?)",
            (body.email, hash_password(body.password), body.name, body.name),
        )
    return schemas.TokenOut(token=create_token(cur.lastrowid, "talent"))


@router.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, db: sqlite3.Connection = Depends(get_db)):
    t = db.execute("SELECT * FROM talents WHERE email = ? AND is_active = 1", (body.email,)).fetchone()
    if t is None or not verify_password(body.password, t["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "メールアドレスかパスワードが正しくありません。")
    return schemas.TokenOut(token=create_token(t["id"], "talent"))


def _me(db: sqlite3.Connection, tid: int) -> schemas.TalentMe:
    t = db.execute("SELECT * FROM talents WHERE id = ?", (tid,)).fetchone()
    return schemas.TalentMe(
        id=t["id"], email=t["email"], name=t["name"], display_name=t["display_name"], bio=t["bio"],
        main_job=t["main_job"], available_hours_month=t["available_hours_month"], skill_ids=talent_skill_ids(db, tid),
    )


@router.get("/me", response_model=schemas.TalentMe)
def me(talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db)):
    return _me(db, talent["id"])


@router.put("/me", response_model=schemas.TalentMe)
def update_me(body: schemas.TalentProfileIn, talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db)):
    tid = talent["id"]
    with db:
        db.execute(
            "UPDATE talents SET display_name = ?, bio = ?, main_job = ?, available_hours_month = ? WHERE id = ?",
            (body.display_name, body.bio, body.main_job, body.available_hours_month, tid),
        )
        db.execute("DELETE FROM talent_skills WHERE talent_id = ?", (tid,))
        db.executemany("INSERT INTO talent_skills (talent_id, skill_id) VALUES (?,?)",
                       [(tid, s) for s in dict.fromkeys(body.skill_ids)])
    refresh_match_scores(db)  # プロフィールが変わったらおすすめを計算し直す
    return _me(db, tid)


# ---- 案件 -------------------------------------------------------------------

@router.get("/recommendations", response_model=list[schemas.PublicProject])
def recommendations(talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db)):
    """おすすめ案件（TF-IDF のスコア順）"""
    rows = db.execute(
        f"{PUBLIC_PROJECT_SELECT} WHERE p.status = 'published' AND COALESCE(m.score, 0) >= 0.05 ORDER BY m.score DESC LIMIT 20",
        {"tid": talent["id"]},
    )
    return [schemas.PublicProject(**public_project_from_row(r)) for r in rows]


@router.get("/projects", response_model=list[schemas.PublicProject])
def list_projects(
    q: str = "", skill_id: int | None = None, sort: Literal["new", "match", "fee"] = "new",
    talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db),
):
    where = ["p.status = 'published'"]
    params: dict = {"tid": talent["id"]}
    if q.strip():
        where.append("(p.public_title LIKE :q OR p.public_description LIKE :q OR p.ai_requirements LIKE :q)")
        params["q"] = f"%{q.strip()}%"
    if skill_id:
        where.append("EXISTS (SELECT 1 FROM project_skills ps WHERE ps.project_id = p.id AND ps.skill_id = :sid)")
        params["sid"] = skill_id
    order = {"new": "p.published_at DESC", "match": "score DESC", "fee": "p.monthly_fee DESC"}[sort]
    rows = db.execute(f"{PUBLIC_PROJECT_SELECT} WHERE {' AND '.join(where)} ORDER BY {order}", params)
    return [schemas.PublicProject(**public_project_from_row(r)) for r in rows]


@router.get("/projects/{project_id}", response_model=schemas.TalentProjectDetail)
def project_detail(project_id: int, talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db)):
    r = db.execute(
        f"{PUBLIC_PROJECT_SELECT} WHERE p.id = :pid AND p.status IN ('published','closed','contracted')",
        {"tid": talent["id"], "pid": project_id},
    ).fetchone()
    if r is None:
        raise HTTPException(404, "案件が見つかりません。")
    a = db.execute(
        "SELECT id, status FROM applications WHERE project_id = ? AND talent_id = ? AND status != 'withdrawn'",
        (project_id, talent["id"]),
    ).fetchone()
    # 応募していない人には、募集終了・契約済みの案件は見せない
    if r["status"] != "published" and a is None:
        raise HTTPException(404, "案件が見つかりません。")
    return schemas.TalentProjectDetail(
        **public_project_from_row(r),
        my_application=schemas.MyApplicationRef(id=a["id"], status=a["status"]) if a else None,
    )


# ---- 応募 -------------------------------------------------------------------

@router.post("/projects/{project_id}/apply", response_model=schemas.MyApplicationRef, status_code=201)
def apply(project_id: int, body: schemas.ApplyIn, talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db)):
    if not body.agreed:
        raise HTTPException(400, "本業との競合と守秘義務の確認が必要です。")
    p = db.execute("SELECT id, company_id, public_title FROM projects WHERE id = ? AND status = 'published'", (project_id,)).fetchone()
    if p is None:
        raise HTTPException(404, "募集中の案件が見つかりません。")
    with db:
        # 取り消した応募があれば、もう一度応募にする（UNIQUE(project_id, talent_id) のため）
        cur = db.execute(
            """INSERT INTO applications (project_id, talent_id, message) VALUES (?,?,?)
               ON CONFLICT(project_id, talent_id) DO UPDATE SET
                 status = 'applied', message = excluded.message, applied_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE applications.status = 'withdrawn'""",
            (project_id, talent["id"], body.message),
        )
        if cur.rowcount == 0:
            raise HTTPException(400, "すでに応募しています。")
        for u in db.execute("SELECT id FROM company_users WHERE company_id = ? AND is_active = 1", (p["company_id"],)).fetchall():
            db.execute(
                "INSERT INTO notifications (recipient_type, recipient_id, type, title, link_path) VALUES ('company_user', ?, 'applied', ?, ?)",
                (u["id"], f"「{p['public_title']}」に応募がありました", f"/company/projects/{project_id}"),
            )
    a = db.execute("SELECT id, status FROM applications WHERE project_id = ? AND talent_id = ?", (project_id, talent["id"])).fetchone()
    return schemas.MyApplicationRef(id=a["id"], status=a["status"])


@router.get("/applications", response_model=list[schemas.MyApplication])
def my_applications(talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT a.id, a.status, a.applied_at, p.id AS project_id, p.public_title, p.monthly_fee
           FROM applications a JOIN projects p ON p.id = a.project_id
           WHERE a.talent_id = ? ORDER BY a.applied_at DESC""",
        (talent["id"],),
    )
    return [schemas.MyApplication(**dict(r)) for r in rows]


@router.post("/applications/{application_id}/withdraw", response_model=schemas.MyApplicationRef)
def withdraw(application_id: int, talent=Depends(current_talent), db: sqlite3.Connection = Depends(get_db)):
    with db:
        cur = db.execute(
            "UPDATE applications SET status = 'withdrawn' WHERE id = ? AND talent_id = ? AND status = 'applied'",
            (application_id, talent["id"]),
        )
    if cur.rowcount == 0:
        raise HTTPException(400, "取り消せる応募がありません。")
    return schemas.MyApplicationRef(id=application_id, status="withdrawn")
