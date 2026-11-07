"""複数の API で使う読み出し処理"""

import sqlite3

from app import schemas


def _ids(csv: str | None) -> list[int]:
    return [int(x) for x in csv.split(",")] if csv else []


def _keywords(csv: str | None) -> list[str]:
    return [k for k in (csv or "").split(",") if k]


PROJECT_SELECT = """
SELECT p.*,
       (SELECT GROUP_CONCAT(skill_id) FROM project_skills WHERE project_id = p.id)        AS skill_csv,
       (SELECT GROUP_CONCAT(issue_option_id) FROM project_issues WHERE project_id = p.id) AS issue_csv,
       (SELECT COUNT(*) FROM applications a WHERE a.project_id = p.id AND a.status != 'withdrawn') AS applicant_count,
       (SELECT COUNT(*) FROM applications a WHERE a.project_id = p.id AND a.status = 'applied')    AS new_applicant_count
FROM projects p
"""


def project_from_row(r: sqlite3.Row) -> schemas.Project:
    return schemas.Project(
        id=r["id"], status=r["status"], issue_option_ids=_ids(r["issue_csv"]), issue_free_text=r["issue_free_text"],
        ai_summary=r["ai_summary"], ai_requirements=r["ai_requirements"], public_title=r["public_title"],
        public_description=r["public_description"], skill_ids=_ids(r["skill_csv"]),
        hours_per_month=r["hours_per_month"], duration_months=r["duration_months"], monthly_fee=r["monthly_fee"],
        published_at=r["published_at"], created_at=r["created_at"],
        applicant_count=r["applicant_count"], new_applicant_count=r["new_applicant_count"],
    )


def talent_skill_ids(db: sqlite3.Connection, talent_id: int) -> list[int]:
    return [r[0] for r in db.execute("SELECT skill_id FROM talent_skills WHERE talent_id = ? ORDER BY skill_id", (talent_id,))]


def talent_card(db: sqlite3.Connection, t: sqlite3.Row) -> schemas.TalentCard:
    return schemas.TalentCard(
        id=t["id"], display_name=t["display_name"] or t["name"], main_job=t["main_job"], bio=t["bio"],
        skill_ids=talent_skill_ids(db, t["id"]),
    )


def score_of(db: sqlite3.Connection, project_id: int, talent_id: int) -> tuple[float, list[str]]:
    r = db.execute(
        "SELECT score, keywords FROM match_scores WHERE project_id = ? AND talent_id = ?", (project_id, talent_id)
    ).fetchone()
    return (r["score"], _keywords(r["keywords"])) if r else (0.0, [])


PUBLIC_PROJECT_SELECT = """
SELECT p.id, p.status, c.industry, p.public_title, p.public_description, p.ai_requirements,
       p.hours_per_month, p.duration_months, p.monthly_fee, p.published_at,
       (SELECT GROUP_CONCAT(skill_id) FROM project_skills WHERE project_id = p.id) AS skill_csv,
       COALESCE(m.score, 0) AS score, m.keywords,
       EXISTS (SELECT 1 FROM applications a WHERE a.project_id = p.id AND a.talent_id = :tid
               AND a.status != 'withdrawn') AS applied
FROM projects p
JOIN companies c ON c.id = p.company_id
LEFT JOIN match_scores m ON m.project_id = p.id AND m.talent_id = :tid
"""


def public_project_from_row(r: sqlite3.Row) -> dict:
    """PublicProject の項目を dict で返す（TalentProjectDetail にも使い回す）"""
    return dict(
        id=r["id"], status=r["status"], industry=r["industry"], public_title=r["public_title"],
        public_description=r["public_description"], ai_requirements=r["ai_requirements"],
        skill_ids=_ids(r["skill_csv"]), hours_per_month=r["hours_per_month"], duration_months=r["duration_months"],
        monthly_fee=r["monthly_fee"], published_at=r["published_at"], score=r["score"],
        keywords=_keywords(r["keywords"]), applied=bool(r["applied"]),
    )
