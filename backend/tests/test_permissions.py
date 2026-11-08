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


def test_member_sees_only_assigned():
    with TestClient(app) as c:
        ids = _ids(c)
        assert len(ids) == 3
        mine = c.get("/api/companies/1/businesses", headers=TANAKA).json()
        assert [b["name"] for b in mine] == ["受注〜出荷業務"]
        assert c.get(f"/api/businesses/{ids['請求書発行業務']}", headers=TANAKA).status_code == 404
        assert c.get(f"/api/businesses/{ids['請求書発行業務']}/flows", headers=TANAKA).status_code == 404
        # 他社の企業・業務は見えない
        assert [x["id"] for x in c.get("/api/companies", headers=SATO).json()] == [2]
        assert c.get("/api/companies/1/businesses", headers=SATO).status_code == 404
        assert c.get(f"/api/businesses/{ids['請求書発行業務']}", headers=SATO).status_code == 404
        # 管理者向け操作はできない
        assert c.post("/api/companies", json={"name": "x"}, headers=TANAKA).status_code == 403
        assert c.get("/api/companies/1/users", headers=TANAKA).status_code == 403
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
