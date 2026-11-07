"""パスワードとログイントークン

・パスワードは PBKDF2（Python 標準ライブラリ）でハッシュ化して保存
・ログインすると JWT を返す。フロントは Authorization: Bearer <token> で送る
・企業アプリと人材アプリでトークンの role を分け、相手側の API は使えないようにする
"""

import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import config
from app.db import get_db

Role = Literal["company", "talent"]
_ITER = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _ITER).hex()
    return f"pbkdf2_sha256${_ITER}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iters)).hex()
        return hmac.compare_digest(calc, digest)
    except ValueError:
        return False


def create_token(user_id: int, role: Role) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=config.JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256")


_bearer = HTTPBearer(auto_error=False)


def _user_id(creds: HTTPAuthorizationCredentials | None, role: Role) -> int:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインしてください", {"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, config.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise unauthorized
    if payload.get("role") != role:
        raise unauthorized
    return int(payload["sub"])


def current_company_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: sqlite3.Connection = Depends(get_db),
) -> sqlite3.Row:
    """企業 API 用：ログイン中の企業ユーザー（company_id を含む）"""
    uid = _user_id(creds, "company")
    row = db.execute("SELECT * FROM company_users WHERE id = ? AND is_active = 1", (uid,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインしてください")
    return row


def current_talent(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: sqlite3.Connection = Depends(get_db),
) -> sqlite3.Row:
    """人材 API 用：ログイン中の人材"""
    uid = _user_id(creds, "talent")
    row = db.execute("SELECT * FROM talents WHERE id = ? AND is_active = 1", (uid,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインしてください")
    return row
