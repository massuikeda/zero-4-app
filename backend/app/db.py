"""SQLite への接続"""

import sqlite3
from collections.abc import Iterator

from app import config


def connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # FastAPI は依存関係と処理を別スレッドで動かすことがあるため check_same_thread=False
    conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # SQLite は接続ごとに ON にする必要がある
    return conn


def get_db() -> Iterator[sqlite3.Connection]:
    """API ごとに接続を開いて、終わったら閉じる"""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    """テーブルがなければ schema.sql から作る。必要ならお試し用データを入れる"""
    conn = connect()
    try:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        if not exists:
            conn.executescript(config.SCHEMA_PATH.read_text(encoding="utf-8"))
            if config.SEED_DEMO:
                from app.seed import seed_demo

                seed_demo(conn)
            from matching.tfidf import refresh_match_scores

            refresh_match_scores(conn)
    finally:
        conn.close()
