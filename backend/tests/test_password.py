"""パスワードでのログイン（AUTH_MODE=password）のテスト: pytest -q"""
import os
import tempfile

os.environ["DATABASE_URL"] = os.environ.get("DATABASE_URL") or f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["AUTH_MODE"] = "dev"
os.environ["SEED_DEMO"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth  # noqa: E402
from app.api import app  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal, User  # noqa: E402

ADMIN_PW = "bank-pass-123"


@pytest.fixture
def client(monkeypatch):
    with TestClient(app) as c:  # 最初は dev で起動してサンプルのデータを入れる
        monkeypatch.setattr(settings, "auth_mode", "password")
        with SessionLocal() as db:
            for u in db.query(User):
                u.password_hash, u.failed_logins, u.locked_until = "", 0, None
            admin = auth.find_user(db, "admin@example.com")
            auth.set_password(admin, ADMIN_PW)
            db.commit()
        yield c


def _login(c, email, pw, portal):
    return c.post("/api/auth/login", json={"email": email, "password": pw, "portal": portal})


def test_hash_is_not_plain_and_verifies():
    h = auth.hash_password("secret-123")
    assert "secret-123" not in h and h.startswith("scrypt$")
    assert auth.verify_password("secret-123", h)
    assert not auth.verify_password("secret-124", h)
    assert auth.hash_password("secret-123") != h  # 塩が毎回変わる
    assert not auth.verify_password("x", "")


def test_login_cookie_and_logout(client):
    c = client
    # ログイン前は何も見られない。dev のヘッダーも効かない
    assert c.get("/api/me").status_code == 401
    assert c.get("/api/me", headers={"X-User-Email": "admin@example.com"}).status_code == 401
    assert c.get("/api/dev/users").status_code == 404
    r = _login(c, "Admin@Example.com", ADMIN_PW, "bank")
    assert r.status_code == 200, r.text
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "max-age=28800" in cookie
    assert c.get("/api/me").json()["email"] == "admin@example.com"
    c.post("/api/auth/logout")
    assert c.get("/api/me").status_code == 401


def test_wrong_password_same_message_and_lock(client):
    c = client
    unknown = _login(c, "nobody@example.com", "whatever-1", "bank")
    wrong = _login(c, "admin@example.com", "wrong-pass-1", "bank")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()  # 登録の有無が分からない
    for _ in range(3):
        assert _login(c, "admin@example.com", "wrong-pass-1", "bank").status_code == 401
    r = _login(c, "admin@example.com", "wrong-pass-1", "bank")  # 5回目でロック
    assert r.status_code == 429 and "ロック" in r.json()["detail"]
    # ロック中は正しいパスワードでも入れない
    assert _login(c, "admin@example.com", ADMIN_PW, "bank").status_code == 429


def test_portal_must_match_role(client):
    assert _login(client, "admin@example.com", ADMIN_PW, "company").status_code == 403


def test_admin_sets_initial_password_and_member_changes_it(client):
    c = client
    assert _login(c, "admin@example.com", ADMIN_PW, "bank").status_code == 200
    # パスワードモードでは、初期パスワードなしの登録はできない。短すぎるのもだめ
    base = {"email": "new@sample.example", "name": "新人", "role": "member", "company_id": 1}
    assert c.post("/api/users", json=base).status_code == 422
    assert c.post("/api/users", json={**base, "password": "short"}).status_code == 422
    r = c.post("/api/users", json={**base, "password": "first-pass-1"})
    assert r.status_code == 200, r.text
    assert r.json()["has_password"] is True and "password" not in r.json()
    uid = r.json()["id"]
    c.post("/api/auth/logout")

    m = TestClient(app)  # 別の端末
    assert _login(m, "new@sample.example", "first-pass-1", "company").status_code == 200
    assert [x["id"] for x in m.get("/api/companies").json()] == [1]
    old_cookie = m.cookies.get(auth.SESSION_COOKIE)
    assert m.put("/api/auth/password", json={"current_password": "nope", "new_password": "second-pass-2"}).status_code == 422
    assert m.put("/api/auth/password", json={"current_password": "first-pass-1", "new_password": "second-pass-2"}).status_code == 200
    assert m.get("/api/me").status_code == 200  # 変えた端末はそのまま使える
    # 変更前のログイン状態は使えない
    other = TestClient(app, cookies={auth.SESSION_COOKIE: old_cookie})
    assert other.get("/api/me").status_code == 401
    assert _login(TestClient(app), "new@sample.example", "first-pass-1", "company").status_code == 401

    # 銀行担当者がパスワードを決め直す（企業の人はできない）
    assert m.put(f"/api/users/{uid}/password", json={"password": "reset-pass-3"}).status_code == 403
    assert _login(c, "admin@example.com", ADMIN_PW, "bank").status_code == 200
    assert c.put(f"/api/users/{uid}/password", json={"password": "reset-pass-3"}).status_code == 200
    assert _login(TestClient(app), "new@sample.example", "reset-pass-3", "company").status_code == 200


def test_tampered_cookie_rejected(client):
    c = TestClient(app, cookies={auth.SESSION_COOKIE: "abc.def.ghi"})
    assert c.get("/api/me").status_code == 401
