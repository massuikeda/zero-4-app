"""権限のテスト: pytest -q"""
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["AUTH_MODE"] = "dev"
os.environ["SEED_DEMO"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.api import app  # noqa: E402

ADMIN = {"X-User-Email": "admin@example.com"}
TANAKA = {"X-User-Email": "tanaka@sample-shoji.example"}   # サンプル商事・受注〜出荷のみ
SUZUKI = {"X-User-Email": "suzuki@sample-shoji.example"}   # サンプル商事・請求書発行のみ
SATO = {"X-User-Email": "sato@yamada-ss.example"}          # 山田製作所


def _ids(c):
    bs = c.get("/api/companies/1/businesses", headers=ADMIN).json()
    return {b["name"]: b["id"] for b in bs}


def test_member_sees_own_company_only():
    with TestClient(app) as c:
        ids = _ids(c)
        assert len(ids) == 3
        # 企業担当者は自社の業務すべてを見られる（割り当ては不要）
        mine = c.get("/api/companies/1/businesses", headers=TANAKA).json()
        assert sorted(b["name"] for b in mine) == sorted(ids)
        assert c.get(f"/api/businesses/{ids['請求書発行業務']}", headers=TANAKA).status_code == 200
        assert c.get(f"/api/businesses/{ids['請求書発行業務']}/flows", headers=TANAKA).status_code == 200
        assert [x["id"] for x in c.get("/api/companies", headers=TANAKA).json()] == [1]
        # 他社の企業・業務は見えない
        assert [x["id"] for x in c.get("/api/companies", headers=SATO).json()] == [2]
        assert c.get("/api/companies/1/businesses", headers=SATO).status_code == 404
        assert c.get(f"/api/businesses/{ids['請求書発行業務']}", headers=SATO).status_code == 404
        # 銀行担当者向けの操作はできない
        assert c.post("/api/companies", json={"name": "x"}, headers=TANAKA).status_code == 403
        assert c.get("/api/companies/1/users", headers=TANAKA).status_code == 403
        assert c.post("/api/companies/1/businesses", json={"name": "x"}, headers=TANAKA).status_code == 403
        assert c.post("/api/companies/1/resources", json={"kind": "部署", "name": "x"}, headers=TANAKA).status_code == 403
        assert c.delete(f"/api/businesses/{ids['請求書発行業務']}", headers=TANAKA).status_code == 403
        # 未登録ユーザー
        assert c.get("/api/me", headers={"X-User-Email": "nobody@x"}).status_code == 403


def test_member_can_edit_assigned_flow_and_conflict():
    with TestClient(app) as c:
        bid = _ids(c)["請求書発行業務"]
        TANAKA = SUZUKI  # noqa: N806  この業務の担当者
        f = c.get(f"/api/businesses/{bid}/flows", headers=TANAKA).json()
        assert f["asis"] and f["tobe"] is None
        r = c.post(f"/api/businesses/{bid}/flows/tobe/copy-from-asis", headers=TANAKA)
        assert r.status_code == 200, r.text
        tobe = r.json()
        tobe["data"]["steps"] = [s for s in tobe["data"]["steps"] if s["type"] != "待ち"]
        tobe["data"]["steps"][1]["change"] = "自動化"
        tobe["data"]["steps"][1]["minutes"] = 5
        ok = c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": tobe["data"], "version": tobe["version"]}, headers=TANAKA)
        assert ok.status_code == 200 and ok.json()["version"] == 2
        # 古いversionでの保存は拒否
        ng = c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": tobe["data"], "version": 1}, headers=ADMIN)
        assert ng.status_code == 409
        cmp = c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()["comparison"]
        assert cmp["tobe_steps"] == 5 and cmp["reduction_rate"] > 0
        x = c.get(f"/api/businesses/{bid}/flows/tobe/drawio", headers=TANAKA)
        assert x.status_code == 200 and x.text.startswith("<mxfile")
        assert c.put(f"/api/businesses/{bid}/flows/asis", json={"data": tobe["data"], "version": 1}, headers=SATO).status_code == 404


def test_assign_rules():
    with TestClient(app) as c:
        bid = _ids(c)["経費精算業務"]
        sato_id = [u for u in c.get("/api/dev/users").json() if u["email"].startswith("sato")][0]["id"]
        assert c.put(f"/api/businesses/{bid}/assignees", json={"user_ids": [sato_id]}, headers=ADMIN).status_code == 422


def test_counters_and_notes():
    with TestClient(app) as c:
        bid = _ids(c)["受注〜出荷業務"]
        cmp = c.get(f"/api/businesses/{bid}/flows", headers=TANAKA).json()["comparison"]
        # 画像の例：手入力・転記3回、メール連絡2回、紙2か所
        assert (cmp["asis_manual"], cmp["asis_mail"], cmp["asis_paper"]) == (3, 2, 2)
        assert (cmp["tobe_manual"], cmp["tobe_mail"], cmp["tobe_paper"]) == (0, 0, 0)
        r = c.put(f"/api/businesses/{bid}/notes", json={"field_view": "残業が続いている"}, headers=TANAKA).json()
        assert r["field_view"] == "残業が続いている" and r["exec_view"] == "受注から出荷まで、問題なく回っている"


def test_company_industry_and_employees():
    with TestClient(app) as c:
        cs = c.get("/api/companies", headers=ADMIN).json()
        assert {(x["industry"], x["employees"]) for x in cs} >= {("卸売業", 120), ("製造業", 60)}
        r = c.post("/api/companies", headers=ADMIN, json={"name": "テスト工業", "industry": "建設業", "employees": 35})
        assert r.status_code == 200
        assert (r.json()["industry"], r.json()["employees"]) == ("建設業", 35)
        # 従業員数は空でもよい
        r = c.post("/api/companies", headers=ADMIN, json={"name": "空欄商店", "industry": "", "employees": None})
        assert r.status_code == 200 and r.json()["employees"] is None
        # 数値でない・マイナスは受け付けない
        for bad in ("たくさん", -1, 1.5):
            assert c.post("/api/companies", headers=ADMIN, json={"name": "x", "employees": bad}).status_code == 422
        # 担当者は企業を追加できない
        assert c.post("/api/companies", headers=TANAKA, json={"name": "y"}).status_code == 403


def test_login_portal_must_match_role():
    with TestClient(app) as c:
        bank = {"X-Login-Portal": "bank"}
        company = {"X-Login-Portal": "company"}
        assert c.get("/api/me", headers={**ADMIN, **bank}).json()["role"] == "admin"
        assert c.get("/api/me", headers={**TANAKA, **company}).json()["role"] == "member"
        # 入口を取り違えたら断る
        r = c.get("/api/me", headers={**ADMIN, **company})
        assert r.status_code == 403 and "銀行担当者のログイン" in r.json()["detail"]
        r = c.get("/api/me", headers={**TANAKA, **bank})
        assert r.status_code == 403 and "企業の方のログイン" in r.json()["detail"]
        # 開発用ログイン画面の候補は役割で絞り込める
        assert {u["role"] for u in c.get("/api/dev/users?role=member").json()} == {"member"}
        assert {u["role"] for u in c.get("/api/dev/users?role=admin").json()} == {"admin"}


def test_email_is_exact_match():
    with TestClient(app) as c:
        # 「_」「%」はあいまい検索の記号として扱わない
        assert c.get("/api/me", headers={"X-User-Email": "tanak_@sample-shoji.example"}).status_code == 403
        assert c.get("/api/me", headers={"X-User-Email": "%@example.com"}).status_code == 403
        assert c.get("/api/me", headers={"X-User-Email": "ADMIN@example.com"}).status_code == 200


def test_bank_registers_company_user():
    with TestClient(app) as c:
        r = c.post("/api/users", headers=ADMIN,
                   json={"email": "new@yamada-ss.example", "name": "新人", "role": "member", "company_id": 2})
        assert r.status_code == 200
        new = {"X-User-Email": "new@yamada-ss.example"}
        assert [x["id"] for x in c.get("/api/companies", headers=new).json()] == [2]
        assert c.post("/api/users", headers=ADMIN, json={"email": "x@x", "name": "x", "role": "member"}).status_code == 422
        assert c.post("/api/users", headers=ADMIN,
                      json={"email": "New@yamada-ss.example", "name": "重複", "role": "member", "company_id": 2}).status_code == 409
        assert c.delete(f"/api/users/{r.json()['id']}", headers=ADMIN).status_code == 200


def test_saved_minutes_in_business_list():
    with TestClient(app) as c:
        bs = {b["name"]: b for b in c.get("/api/companies/1/businesses", headers=ADMIN).json()}
        b = bs["受注〜出荷業務"]  # デモデータでTO-BEまで作成済み
        cmp = c.get(f"/api/businesses/{b['id']}/flows", headers=ADMIN).json()["comparison"]
        # 一覧の削減時間は、比較タブと同じ値
        assert b["saved_minutes"] == cmp["asis_minutes"] - cmp["tobe_minutes"] > 0
        # TO-BEがまだない業務は空
        no_tobe = [x for x in c.get("/api/companies/1/businesses", headers=ADMIN).json() if x["status"] != "TO-BE作成済"]
        assert no_tobe and all(x["saved_minutes"] is None for x in no_tobe)
