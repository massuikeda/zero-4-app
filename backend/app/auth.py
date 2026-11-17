"""ログインユーザーの特定と権限チェック。

- AUTH_MODE=dev      : ヘッダー X-User-Email のユーザーとして扱う（開発・デモ用。パスワードなし）
- AUTH_MODE=password : メールアドレスとパスワードでログインする。ログイン状態は HttpOnly Cookie
                       （画面のスクリプトからは読めない）に、署名付きで入れる。8時間で切れる
- AUTH_MODE=entra    : Entra ID のアクセストークンを検証し、メールアドレスでユーザーを特定

パスワード
- そのままでは保存しない。scrypt（元に戻せない計算）で変換した値だけを保存する
- 5回続けて間違えると15分ロックする（総当たり対策）
- パスワードを変えると、それまでのログイン状態（ほかの端末も含む）は使えなくなる

役割
- admin （銀行担当者）: すべての企業・業務を見られる。企業・業務・図の候補・企業ユーザーの登録
- member（企業担当者）: 自社の業務だけを見られる。ヒアリング・AS-IS・TO-BEの閲覧と編集

ログイン画面は「銀行担当者用」と「企業用」に分かれている。画面は X-Login-Portal（bank / company）を送り、
役割と合わない画面からのログインは断る（入口を取り違えないための確認。権限そのものは役割で判定する）。

権限の判定はすべてサーバー側で行う（画面で隠すだけにしない）。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from fastapi import Cookie, Depends, Header, HTTPException, Response, status
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


# ---------- パスワード ----------
PASSWORD_MIN = 8
PASSWORD_MAX = 128
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def hash_password(password: str) -> str:
    """保存用の値「scrypt$N$r$p$塩$結果」を作る（塩は毎回ランダム。同じパスワードでも値は毎回変わる）"""
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64(salt)}${_b64(h)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, expected = stored.split("$")
        if algo != "scrypt":
            return False
        h = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(h, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


# 登録されていないメールアドレスでも同じだけ計算して、応答の速さから「登録の有無」が分からないようにする。
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def check_password_rule(password: str) -> None:
    if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        raise HTTPException(422, f"パスワードは{PASSWORD_MIN}〜{PASSWORD_MAX}文字にしてください")
    if password.strip() != password:
        raise HTTPException(422, "パスワードの最初と最後に空白は使えません")


def utcnow() -> datetime:
    """DBに入れる時刻（タイムゾーンなしのUTC。SQLite と MySQL で同じ扱いにするため）"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def is_locked(user: User) -> bool:
    return bool(user.locked_until and user.locked_until > utcnow())


def set_password(user: User, password: str) -> None:
    check_password_rule(password)
    user.password_hash = hash_password(password)
    user.failed_logins = 0
    user.locked_until = None


# ---------- ログイン状態（Cookie）----------
SESSION_COOKIE = "mieru_session"
SESSION_HOURS = 8
# AUTH_SECRET が未設定のとき（ローカル）は、起動のたびに作る鍵を使う
_SECRET = settings.auth_secret or secrets.token_urlsafe(32)


def _password_version(user: User) -> str:
    """パスワードが変わったら変わる印。ログイン状態に入れておき、パスワード変更前のログイン状態を無効にする"""
    return hashlib.sha256(user.password_hash.encode()).hexdigest()[:16]


def set_session(response: Response, user: User) -> None:
    import jwt

    t = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": str(user.id), "pv": _password_version(user), "iat": t, "exp": t + timedelta(hours=SESSION_HOURS)},
        _SECRET,
        algorithm="HS256",
    )
    response.set_cookie(
        SESSION_COOKIE, token, max_age=SESSION_HOURS * 3600, path="/",
        httponly=True, secure=settings.cookie_secure, samesite="strict",
    )


def clear_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=settings.cookie_secure, samesite="strict")


def _user_from_session(db: Session, token: str | None) -> User:
    import jwt

    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインしてください")
    try:
        claims = jwt.decode(token, _SECRET, algorithms=["HS256"], options={"require": ["sub", "exp"]})
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインの有効期限が切れました。もう一度ログインしてください") from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインしてください") from e
    user = db.get(User, int(claims["sub"]))
    if not user or not user.password_hash or claims.get("pv") != _password_version(user):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ログインし直してください")
    return user


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
    mieru_session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    if settings.auth_mode == "password":
        user = _user_from_session(db, mieru_session)
        if x_login_portal in PORTAL_ROLE and user.role != PORTAL_ROLE[x_login_portal]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, PORTAL_ERROR[x_login_portal])
        return user
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
