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
        assert f["asis"] and f["plans"] == {} and f["comparisons"] == {}
        # TO-BEは松竹梅の3案。ここでは「梅」を作る
        assert c.post(f"/api/businesses/{bid}/flows/asis/copy-from-asis", headers=TANAKA).status_code == 422
        r = c.post(f"/api/businesses/{bid}/flows/tobe_ume/copy-from-asis", headers=TANAKA)
        assert r.status_code == 200, r.text
        tobe = r.json()
        tobe["data"]["steps"] = [s for s in tobe["data"]["steps"] if s["type"] != "待ち"]
        tobe["data"]["steps"][1]["change"] = "自動化"
        tobe["data"]["steps"][1]["minutes"] = 5
        tobe["data"]["summary"] = "入力を自動化する"
        tobe["data"]["needs"] = ["OCRサービス"]
        tobe["data"]["removed_notes"] = {"S99": "RPAが自動で取り込むので不要"}
        ok = c.put(f"/api/businesses/{bid}/flows/tobe_ume", json={"data": tobe["data"], "version": tobe["version"]}, headers=TANAKA)
        assert ok.status_code == 200 and ok.json()["version"] == 2
        # 古いversionでの保存は拒否
        ng = c.put(f"/api/businesses/{bid}/flows/tobe_ume", json={"data": tobe["data"], "version": 1}, headers=ADMIN)
        assert ng.status_code == 409
        # 以前の種類（1案だけだったころの「tobe」）や、決まっていない種類は受け付けない
        assert c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": tobe["data"], "version": 0}, headers=ADMIN).status_code == 422
        fl = c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()
        assert list(fl["plans"]) == ["ume"] and fl["plans"]["ume"]["data"]["summary"] == "入力を自動化する"
        assert fl["plans"]["ume"]["data"]["needs"] == ["OCRサービス"]
        assert fl["plans"]["ume"]["data"]["removed_notes"] == {"S99": "RPAが自動で取り込むので不要"}
        cmp = fl["comparisons"]["ume"]
        assert cmp["tobe_steps"] == 5 and cmp["reduction_rate"] > 0
        x = c.get(f"/api/businesses/{bid}/flows/tobe_ume/drawio", headers=TANAKA)
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
        cmp = c.get(f"/api/businesses/{bid}/flows", headers=TANAKA).json()["comparisons"]["take"]
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
        b = bs["受注〜出荷業務"]  # デモデータで「竹」の案まで作成済み
        cmp = c.get(f"/api/businesses/{b['id']}/flows", headers=ADMIN).json()["comparisons"]["take"]
        # 一覧の削減時間は、比較タブと同じ値。採用する案が未選択なら「竹」
        assert b["adopted_plan"] == "" and b["saved_plan"] == "take"
        assert b["saved_minutes"] == b["saved_by_plan"]["take"] == cmp["asis_minutes"] - cmp["tobe_minutes"] > 0
        # TO-BEがまだない業務は空
        no_tobe = [x for x in c.get("/api/companies/1/businesses", headers=ADMIN).json() if x["status"] != "TO-BE作成済"]
        assert no_tobe and all(x["saved_minutes"] is None for x in no_tobe)


def test_adopt_plan():
    with TestClient(app) as c:
        bid = c.post("/api/companies/1/businesses", headers=ADMIN, json={"name": "採用する案のテスト"}).json()["id"]

        def step(sid, minutes, nxt):
            return {"id": sid, "lane": "経理部", "name": f"作業{sid}", "minutes": minutes, "next": nxt}

        asis = {"lanes": ["経理部"], "steps": [step("S01", 10, ["S02"]), step("S02", 20, ["S03"]), step("S03", 5, [])]}
        assert c.put(f"/api/businesses/{bid}/flows/asis", json={"data": asis, "version": 0}, headers=ADMIN).status_code == 200
        b = c.get(f"/api/businesses/{bid}", headers=ADMIN).json()
        assert b["status"] == "AS-IS作成済" and b["saved_by_plan"] == {} and b["saved_minutes"] is None
        # まだ作っていない案・決まっていない案は採用できない
        assert c.put(f"/api/businesses/{bid}/adopted", json={"plan": "matsu"}, headers=ADMIN).status_code == 422
        assert c.put(f"/api/businesses/{bid}/adopted", json={"plan": "極上"}, headers=ADMIN).status_code == 422
        # 「松」だけ作る（S02 をなくし、S01 を 10分 → 4分に）
        matsu = {"lanes": ["経理部"], "steps": [{**step("S01", 4, ["S03"]), "change": "自動化"}, step("S03", 5, [])],
                 "summary": "RPAで転記を自動化する", "needs": ["RPAツール"]}
        assert c.put(f"/api/businesses/{bid}/flows/tobe_matsu", json={"data": matsu, "version": 0}, headers=ADMIN).status_code == 200
        b = c.get(f"/api/businesses/{bid}", headers=ADMIN).json()
        # 竹がなく、採用も未選択なので、一覧の削減時間はまだ出ない
        assert b["status"] == "TO-BE作成済" and b["saved_by_plan"] == {"matsu": 26} and b["saved_minutes"] is None
        # 企業担当者も採用する案を選べる。選ぶと一覧に出る
        r = c.put(f"/api/businesses/{bid}/adopted", json={"plan": "matsu"}, headers=TANAKA)
        assert r.status_code == 200
        assert (r.json()["adopted_plan"], r.json()["saved_plan"], r.json()["saved_minutes"]) == ("matsu", "matsu", 26)
        listed = {x["id"]: x for x in c.get("/api/companies/1/businesses", headers=ADMIN).json()}[bid]
        assert listed["saved_minutes"] == 26 and listed["saved_plan"] == "matsu"
        # 他社の人には 404。未選択に戻せる
        assert c.put(f"/api/businesses/{bid}/adopted", json={"plan": "matsu"}, headers=SATO).status_code == 404
        r = c.put(f"/api/businesses/{bid}/adopted", json={"plan": None}, headers=ADMIN).json()
        assert r["adopted_plan"] == "" and r["saved_minutes"] is None
        c.delete(f"/api/businesses/{bid}", headers=ADMIN)


def test_cost_items():
    with TestClient(app) as c:
        # 最初から目安の単価表が入っている。見られるのは銀行担当者だけ（企業担当者には見せない）
        assert c.get("/api/cost-items", headers=TANAKA).status_code == 403
        items = c.get("/api/cost-items", headers=ADMIN).json()
        rpa = next(x for x in items if x["name"] == "RPA")
        assert rpa["monthly_cost"] == 150000 and len(items) >= 5
        assert c.get("/api/cost-items").status_code == 401
        # 編集は銀行担当者だけ
        new = {"name": "AI-OCR", "initial_cost": 100000, "monthly_cost": 50000, "note": "手書きに強い"}
        assert c.post("/api/cost-items", json=new, headers=TANAKA).status_code == 403
        assert c.put(f"/api/cost-items/{rpa['id']}", json={**rpa, "monthly_cost": 1}, headers=TANAKA).status_code == 403
        assert c.delete(f"/api/cost-items/{rpa['id']}", headers=TANAKA).status_code == 403
        r = c.post("/api/cost-items", json=new, headers=ADMIN)
        assert r.status_code == 200 and r.json()["monthly_cost"] == 50000
        iid = r.json()["id"]
        # 同じ名前は登録できない。マイナス・数値でない金額・空の名前も受け付けない
        assert c.post("/api/cost-items", json=new, headers=ADMIN).status_code == 409
        assert c.put(f"/api/cost-items/{iid}", json={**new, "name": "RPA"}, headers=ADMIN).status_code == 409
        for bad in ({**new, "name": "x", "monthly_cost": -1}, {**new, "name": "x", "initial_cost": "たくさん"}, {**new, "name": "  "}, {**new, "name": ""}):
            assert c.post("/api/cost-items", json=bad, headers=ADMIN).status_code == 422
        r = c.put(f"/api/cost-items/{iid}", json={**new, "monthly_cost": 60000}, headers=ADMIN)  # 同じ名前のまま金額だけ変える
        assert r.status_code == 200 and r.json()["monthly_cost"] == 60000
        assert c.delete(f"/api/cost-items/{iid}", headers=ADMIN).status_code == 200
        assert c.delete(f"/api/cost-items/{iid}", headers=ADMIN).status_code == 404
        assert all(x["name"] != "AI-OCR" for x in c.get("/api/cost-items", headers=ADMIN).json())


def test_wage_monthly_count_and_plan_cost_items():
    with TestClient(app) as c:
        # 時給は企業ごと（銀行担当者が設定）
        co = c.get("/api/companies/1", headers=ADMIN).json()
        assert co["hourly_wage"] is None
        body = {"name": co["name"], "industry": co["industry"], "employees": co["employees"], "note": co["note"], "hourly_wage": 2500}
        assert c.put("/api/companies/1", json=body, headers=TANAKA).status_code == 403
        assert c.put("/api/companies/1", json={**body, "hourly_wage": -1}, headers=ADMIN).status_code == 422
        r = c.put("/api/companies/1", json=body, headers=ADMIN).json()
        assert r["hourly_wage"] == 2500 and r["industry"] == co["industry"] and r["employees"] == co["employees"]
        assert c.get("/api/companies/1", headers=TANAKA).json()["hourly_wage"] == 2500  # 企業担当者にも見える
        # 月の件数は業務ごと
        bid = _ids(c)["受注〜出荷業務"]
        b = c.get(f"/api/businesses/{bid}", headers=ADMIN).json()
        assert b["monthly_count"] is None
        info = {"name": b["name"], "department": b["department"], "frequency": b["frequency"], "description": b["description"]}
        assert c.put(f"/api/businesses/{bid}", json={**info, "monthly_count": -5}, headers=ADMIN).status_code == 422
        assert c.put(f"/api/businesses/{bid}", json={**info, "monthly_count": 600}, headers=ADMIN).json()["monthly_count"] == 600
        assert c.put(f"/api/businesses/{bid}", json=info, headers=ADMIN).json()["monthly_count"] is None  # 空に戻せる
        # 案に「お金のかかる導入物」を持たせられる（単価表にない名前も入る＝画面で要見積もり）
        doc = c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()["plans"]["take"]
        doc["data"]["cost_items"] = ["RPA", "独自開発の基幹システム"]
        r = c.put(f"/api/businesses/{bid}/flows/tobe_take", json={"data": doc["data"], "version": doc["version"]}, headers=TANAKA)
        assert r.status_code == 200 and r.json()["data"]["cost_items"] == ["RPA", "独自開発の基幹システム"]


def test_candidates_come_from_flows():
    """図の候補（担当・道具）は手で登録せず、その企業の図に出てきたものをそのまま使う"""
    with TestClient(app) as c:
        co = c.post("/api/companies", headers=ADMIN, json={"name": "候補テスト工業"}).json()["id"]
        assert c.get(f"/api/companies/{co}/resources", headers=ADMIN).json() == []  # 図がなければ候補もない
        bid = c.post(f"/api/companies/{co}/businesses", headers=ADMIN, json={"name": "発注"}).json()["id"]
        steps = [
            {"id": "S01", "lane": "購買部", "name": "発注書を作る", "tool": "生産管理システム", "next": ["S02"]},
            {"id": "S02", "lane": "仕入先", "name": "納品する", "tool": "紙の納品書", "next": ["S03"]},
            {"id": "S03", "lane": "購買部", "name": "検収する", "tool": "生産管理システム", "next": []},
        ]
        asis = {"lanes": ["購買部", "仕入先", "経理部"], "steps": steps}
        assert c.put(f"/api/businesses/{bid}/flows/asis", json={"data": asis, "version": 0}, headers=ADMIN).status_code == 200
        got = {(r["kind"], r["name"]) for r in c.get(f"/api/companies/{co}/resources", headers=ADMIN).json()}
        # 担当は部署か取引先に、道具はシステムか帳票に分ける。同じ名前は1つにまとめる。作業のない列（経理部）も候補に入る
        assert got == {("部署", "購買部"), ("取引先", "仕入先"), ("部署", "経理部"), ("システム", "生産管理システム"), ("帳票", "紙の納品書")}
        # TO-BEの案に出てきた道具（RPAなど）も候補になる
        plan = {"lanes": ["購買部"], "steps": [{"id": "S01", "lane": "購買部", "name": "自動で発注する", "tool": "RPA", "next": []}]}
        assert c.put(f"/api/businesses/{bid}/flows/tobe_matsu", json={"data": plan, "version": 0}, headers=ADMIN).status_code == 200
        names = [r["name"] for r in c.get(f"/api/companies/{co}/resources", headers=ADMIN).json()]
        assert "RPA" in names and len(names) == len(set(names))
        # ほかの企業の図は混ざらない。ほかの企業の人には見えない
        other = {r["name"] for r in c.get("/api/companies/1/resources", headers=ADMIN).json()}
        assert "生産管理システム" not in other and "営業部（受注）" in other
        assert c.get(f"/api/companies/{co}/resources", headers=TANAKA).status_code == 404
        c.delete(f"/api/companies/{co}", headers=ADMIN)
