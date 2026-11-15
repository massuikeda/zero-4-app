"""ログインユーザーの特定と権限チェック。

- AUTH_MODE=dev   : ヘッダー X-User-Email のユーザーとして扱う（開発・デモ用）
- AUTH_MODE=entra : Entra ID のアクセストークンを検証し、メールアドレスでユーザーを特定

役割
- admin （銀行担当者）: すべての企業・業務を見られる。企業・業務・図の候補・企業ユーザーの登録
- member（企業担当者）: 自社の業務だけを見られる。ヒアリング・AS-IS・TO-BEの閲覧と編集

ログイン画面は「銀行担当者用」と「企業用」に分かれている。画面は X-Login-Portal（bank / company）を送り、
役割と合わない画面からのログインは断る（入口を取り違えないための確認。権限そのものは役割で判定する）。

権限の判定はすべてサーバー側で行う（画面で隠すだけにしない）。
"""
from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import func, select
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


PORTAL_ROLE = {"bank": "admin", "company": "member"}
PORTAL_ERROR = {
    "bank": "このアカウントは企業の方のアカウントです。「企業の方のログイン」からログインしてください",
    "company": "このアカウントは銀行担当者のアカウントです。「銀行担当者のログイン」からログインしてください",
}


def find_user(db: Session, email: str) -> User | None:
    """メールアドレスで探す（大文字・小文字は区別しない。完全一致）"""
    return db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


def current_user(
    authorization: str | None = Header(default=None),
    x_user_email: str | None = Header(default=None),
    x_login_portal: str | None = Header(default=None),
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
    user = find_user(db, email)
    if not user:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{email} は登録されていません。銀行の担当者に連絡してください")
    if x_login_portal in PORTAL_ROLE and user.role != PORTAL_ROLE[x_login_portal]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, PORTAL_ERROR[x_login_portal])
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "銀行担当者のみ操作できます")
    return user


def can_see_company(user: User, company_id: int) -> bool:
    return user.role == "admin" or user.company_id == company_id


def can_access_business(user: User, b: Business) -> bool:
    """銀行担当者はすべて。企業担当者は自社の業務すべて。"""
    if user.role == "admin":
        return True
    return user.company_id is not None and user.company_id == b.company_id


def get_business_or_404(db: Session, user: User, business_id: int) -> Business:
    b = db.get(Business, business_id)
    # 見えない業務は「存在しない」と同じ扱いにする（他社の業務の有無を漏らさない）
    if not b or not can_access_business(user, b):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "業務が見つかりません")
    return b
