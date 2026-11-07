import sqlite3

from fastapi import APIRouter, Depends

from app import schemas
from app.db import get_db

router = APIRouter(prefix="/api", tags=["共通"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/master", response_model=schemas.Master)
def master(db: sqlite3.Connection = Depends(get_db)):
    """スキル・課題のチェック項目（画面の選択肢）"""
    return schemas.Master(
        skills=[schemas.Skill(**dict(r)) for r in db.execute("SELECT id, name, category FROM skills ORDER BY id")],
        issue_options=[
            schemas.IssueOption(**dict(r))
            for r in db.execute("SELECT id, category, label FROM issue_options ORDER BY sort_order, id")
        ],
    )
