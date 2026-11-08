"""ログインユーザーの特定と権限チェック。

- AUTH_MODE=dev   : ヘッダー X-User-Email のユーザーとして扱う（開発・デモ用）
- AUTH_MODE=entra : Entra ID のアクセストークンを検証し、メールアドレスでユーザーを特定

権限の判定はすべてサーバー側で行う（画面で隠すだけにしない）。
"""
from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import Business, User, get_db


@lru_cache
def _jwks():
    import jwt

    return jwt.PyJWKClient(f"https://login.microsoftonline.com/{settings.tenant_id}/discovery/v2.0/keys")


def _email_from_token(token: str) -> str:
    import jwt

    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=[settings.api_client_id, f"api://{settings.api_client_id}"],
            issuer=f"https://login.microsoftonline.com/{settings.tenant_id}/v2.0",
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"トークンが無効です: {e}") from e
    if "access_as_user" not in claims.get("scp", "").split():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "スコープ access_as_user が必要です")
    email = claims.get("email") or claims.get("preferred_username") or claims.get("upn")
    if not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "トークンにメールアドレスがありません")
    return email


def current_user(
    authorization: str | None = Header(default=None),
    x_user_email: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if settings.auth_mode == "entra":
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインが必要です")
        email = _email_from_token(authorization.split(" ", 1)[1])
    else:
        if not x_user_email:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ユーザーを選択してください")
        email = x_user_email
    user = db.scalar(select(User).where(User.email.ilike(email)))
    if not user:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{email} は登録されていません。管理者に連絡してください")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "管理者のみ操作できます")
    return user


def can_see_company(user: User, company_id: int) -> bool:
    return user.role == "admin" or user.company_id == company_id


def can_access_business(user: User, b: Business) -> bool:
    """管理者はすべて。担当者は自社かつ割り当てられた業務だけ。"""
    if user.role == "admin":
        return True
    return user.company_id == b.company_id and any(a.id == user.id for a in b.assignees)


def get_business_or_404(db: Session, user: User, business_id: int) -> Business:
    b = db.get(Business, business_id)
    # 見えない業務は「存在しない」と同じ扱いにする（他社の業務の有無を漏らさない）
    if not b or not can_access_business(user, b):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "業務が見つかりません")
    return b
