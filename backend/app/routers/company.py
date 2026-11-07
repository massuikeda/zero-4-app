"""企業アプリ用 API（/api/company/...）"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app import schemas
from app.ai_draft import generate_draft
from app.db import get_db
from app.queries import PROJECT_SELECT, project_from_row, score_of, talent_card
from app.security import create_token, current_company_user, hash_password, verify_password
from matching.tfidf import refresh_match_scores

router = APIRouter(prefix="/api/company", tags=["企業"])


# ---- 登録・ログイン ---------------------------------------------------------

@router.post("/register", response_model=schemas.TokenOut, status_code=201)
def register(body: schemas.CompanyRegisterIn, db: sqlite3.Connection = Depends(get_db)):
    """企業コードを照合して、企業とログインユーザーを作る"""
    code = db.execute(
        "SELECT * FROM company_codes WHERE code = ? AND used_at IS NULL", (body.code.strip().upper(),)
    ).fetchone()
    if code is None:
        raise HTTPException(400, "企業コードが見つからないか、すでに使われています。")
    if db.execute("SELECT 1 FROM company_users WHERE email = ?", (body.email,)).fetchone():
        raise HTTPException(400, "このメールアドレスはすでに登録されています。")

    with db:
        cur = db.execute(
            "INSERT INTO companies (company_code_id, branch_id, bank_staff_id, name, industry) VALUES (?,?,?,?,?)",
            (code["id"], code["branch_id"], code["bank_staff_id"], body.company_name, body.industry),
        )
        company_id = cur.lastrowid
        db.execute("UPDATE company_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", (code["id"],))
        cur = db.execute(
            "INSERT INTO company_users (company_id, name, email, password_hash) VALUES (?,?,?,?)",
            (company_id, body.user_name, body.email, hash_password(body.password)),
        )
        # 紹介した銀行担当者へ「登録の通知」
        db.execute(
            "INSERT INTO notifications (recipient_type, recipient_id, type, title) VALUES ('bank_staff', ?, 'company_registered', ?)",
            (code["bank_staff_id"], f"{body.company_name} が登録しました"),
        )
    return schemas.TokenOut(token=create_token(cur.lastrowid, "company"))


@router.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, db: sqlite3.Connection = Depends(get_db)):
    u = db.execute("SELECT * FROM company_users WHERE email = ? AND is_active = 1", (body.email,)).fetchone()
    if u is None or not verify_password(body.password, u["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "メールアドレスかパスワードが正しくありません。")
    return schemas.TokenOut(token=create_token(u["id"], "company"))


@router.get("/me", response_model=schemas.CompanyMe)
def me(user=Depends(current_company_user), db: sqlite3.Connection = Depends(get_db)):
    c = db.execute(
        "SELECT c.id, c.name, c.industry, b.name AS branch_name FROM companies c JOIN branches b ON b.id = c.branch_id WHERE c.id = ?",
        (user["company_id"],),
    ).fetchone()
    return schemas.CompanyMe(
        user=schemas.CompanyUserOut(id=user["id"], name=user["name"], email=user["email"]),
        company=schemas.CompanyOut(**dict(c)),
    )


# ---- 案件 -------------------------------------------------------------------

def _own_project(db: sqlite3.Connection, project_id: int, company_id: int) -> sqlite3.Row:
    r = db.execute(f"{PROJECT_SELECT} WHERE p.id = ? AND p.company_id = ?", (project_id, company_id)).fetchone()
    if r is None:
        raise HTTPException(404, "案件が見つかりません。")
    return r


@router.get("/projects", response_model=list[schemas.Project])
def list_projects(user=Depends(current_company_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(f"{PROJECT_SELECT} WHERE p.company_id = ? ORDER BY p.created_at DESC", (user["company_id"],))
    return [project_from_row(r) for r in rows]


@router.post("/projects/ai-draft", response_model=schemas.AiDraft)
def ai_draft(body: schemas.AiDraftIn, user=Depends(current_company_user), db: sqlite3.Connection = Depends(get_db)):
    """課題のチェック項目と自由記述から、AI が要件案を作る"""
    return generate_draft(db, body.issue_option_ids, body.free_text)


@router.post("/projects", response_model=schemas.Project, status_code=201)
def create_project(body: schemas.ProjectIn, user=Depends(current_company_user), db: sqlite3.Connection = Depends(get_db)):
    with db:
        cur = db.execute(
            """INSERT INTO projects (company_id, created_by, status, issue_free_text, ai_summary, ai_requirements,
                   ai_generated_at, public_title, public_description, duration_months, monthly_fee, published_at)
               VALUES (?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),?,?,?,?,
                       CASE WHEN ? = 'published' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') END)""",
            (user["company_id"], user["id"], body.status, body.issue_free_text, body.ai_summary, body.ai_requirements,
             body.public_title, body.public_description, body.duration_months, body.monthly_fee, body.status),
        )
        pid = cur.lastrowid
        db.executemany("INSERT INTO project_skills VALUES (?,?)", [(pid, s) for s in dict.fromkeys(body.skill_ids)])
        db.executemany("INSERT INTO project_issues VALUES (?,?)", [(pid, i) for i in dict.fromkeys(body.issue_option_ids)])
    if body.status == "published":
        refresh_match_scores(db)  # 公開したらおすすめを計算し直す
    return project_from_row(_own_project(db, pid, user["company_id"]))


@router.get("/projects/{project_id}", response_model=schemas.CompanyProjectDetail)
def project_detail(project_id: int, user=Depends(current_company_user), db: sqlite3.Connection = Depends(get_db)):
    project = project_from_row(_own_project(db, project_id, user["company_id"]))

    applicants = []
    for a in db.execute(
        """SELECT a.id AS application_id, a.status, a.message, a.applied_at, t.*
           FROM applications a JOIN talents t ON t.id = a.talent_id
           WHERE a.project_id = ? AND a.status != 'withdrawn'""",
        (project_id,),
    ).fetchall():
        score, kw = score_of(db, project_id, a["id"])
        applicants.append(schemas.Applicant(
            application_id=a["application_id"], status=a["status"], message=a["message"], applied_at=a["applied_at"],
            talent=talent_card(db, a), score=score, keywords=kw,
        ))
    applicants.sort(key=lambda x: x.score, reverse=True)

    # おすすめ人材（TF-IDF のスコア順。応募済みの人は除く）
    recommended = [
        schemas.RecommendedTalent(talent=talent_card(db, r), score=r["score"], keywords=[k for k in (r["keywords"] or "").split(",") if k])
        for r in db.execute(
            """SELECT t.*, m.score, m.keywords FROM match_scores m JOIN talents t ON t.id = m.talent_id
               WHERE m.project_id = ? AND m.score >= 0.05 AND t.is_active = 1
                 AND t.id NOT IN (SELECT talent_id FROM applications WHERE project_id = ? AND status != 'withdrawn')
               ORDER BY m.score DESC LIMIT 10""",
            (project_id, project_id),
        ).fetchall()
    ]
    return schemas.CompanyProjectDetail(project=project, applicants=applicants, recommended=recommended)


@router.post("/projects/{project_id}/close", response_model=schemas.Project)
def close_project(project_id: int, user=Depends(current_company_user), db: sqlite3.Connection = Depends(get_db)):
    _own_project(db, project_id, user["company_id"])
    with db:
        db.execute("UPDATE projects SET status = 'closed', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", (project_id,))
    return project_from_row(_own_project(db, project_id, user["company_id"]))


# ---- 応募への対応 -------------------------------------------------------------

ALLOWED_NEXT = {"applied": {"interview", "rejected"}, "interview": {"selected", "rejected"}}


@router.patch("/applications/{application_id}", response_model=schemas.MyApplicationRef)
def update_application(
    application_id: int, body: schemas.ApplicationStatusIn,
    user=Depends(current_company_user), db: sqlite3.Connection = Depends(get_db),
):
    a = db.execute(
        """SELECT a.* FROM applications a JOIN projects p ON p.id = a.project_id
           WHERE a.id = ? AND p.company_id = ?""",
        (application_id, user["company_id"]),
    ).fetchone()
    if a is None:
        raise HTTPException(404, "応募が見つかりません。")
    if body.status not in ALLOWED_NEXT.get(a["status"], set()):
        raise HTTPException(400, "この状態からは変更できません。")
    with db:
        db.execute("UPDATE applications SET status = ? WHERE id = ?", (body.status, application_id))
        db.execute(
            "INSERT INTO notifications (recipient_type, recipient_id, type, title, link_path) VALUES ('talent', ?, ?, ?, ?)",
            (a["talent_id"], f"application_{body.status}",
             {"interview": "面談の申し込みが届きました", "selected": "選定されました", "rejected": "今回は見送りとなりました"}[body.status],
             f"/talent/projects/{a['project_id']}"),
        )
    return schemas.MyApplicationRef(id=application_id, status=body.status)
