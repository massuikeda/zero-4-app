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
        assert f["asis"] and f["tobe"] is None and f["comparison"] is None
        # TO-BEは1つだけ。AS-ISをコピーして作る
        r = c.post(f"/api/businesses/{bid}/flows/tobe/copy-from-asis", headers=TANAKA)
        assert r.status_code == 200, r.text
        tobe = r.json()
        assert tobe["kind"] == "tobe"
        assert c.post(f"/api/businesses/{bid}/flows/tobe/copy-from-asis", headers=TANAKA).status_code == 409  # 2つ目は作れない
        tobe["data"]["steps"] = [s for s in tobe["data"]["steps"] if s["type"] != "待ち"]
        tobe["data"]["steps"][1]["change"] = "自動化"
        tobe["data"]["steps"][1]["minutes"] = 5
        tobe["data"]["summary"] = "入力を自動化する"
        tobe["data"]["needs"] = ["OCRサービス"]
        tobe["data"]["removed_notes"] = {"S99": "RPAが自動で取り込むので不要"}
        ok = c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": tobe["data"], "version": tobe["version"]}, headers=TANAKA)
        assert ok.status_code == 200 and ok.json()["version"] == 2
        # 古いversionでの保存は拒否
        ng = c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": tobe["data"], "version": 1}, headers=ADMIN)
        assert ng.status_code == 409
        # 松竹梅の3案だったころの種類や、決まっていない種類は受け付けない
        for old in ("tobe_ume", "tobe_take", "tobe_matsu", "x"):
            assert c.put(f"/api/businesses/{bid}/flows/{old}", json={"data": tobe["data"], "version": 0}, headers=ADMIN).status_code == 422
        fl = c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()
        assert fl["tobe"]["data"]["summary"] == "入力を自動化する"
        assert fl["tobe"]["data"]["needs"] == ["OCRサービス"]
        assert fl["tobe"]["data"]["removed_notes"] == {"S99": "RPAが自動で取り込むので不要"}
        cmp = fl["comparison"]
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
        assert "adopted_plan" not in b and "saved_by_plan" not in b  # 松竹梅の3案だったころの項目は返さない
        # TO-BEがまだない業務は空
        no_tobe = [x for x in c.get("/api/companies/1/businesses", headers=ADMIN).json() if x["status"] != "TO-BE作成済"]
        assert no_tobe and all(x["saved_minutes"] is None for x in no_tobe)


def test_single_tobe_and_old_plans_are_ignored():
    """TO-BEは1つだけ。松竹梅の3案だったころの梅・竹の行がDBに残っていても、画面には出ない"""
    from app.db import Business, FlowDoc, SessionLocal

    with TestClient(app) as c:
        bid = c.post("/api/companies/1/businesses", headers=ADMIN, json={"name": "TO-BEのテスト"}).json()["id"]

        def step(sid, minutes, nxt):
            return {"id": sid, "lane": "経理部", "name": f"作業{sid}", "minutes": minutes, "next": nxt}

        asis = {"lanes": ["経理部"], "steps": [step("S01", 10, ["S02"]), step("S02", 20, ["S03"]), step("S03", 5, [])]}
        assert c.put(f"/api/businesses/{bid}/flows/asis", json={"data": asis, "version": 0}, headers=ADMIN).status_code == 200
        # 以前の梅・竹・「tobe」の行が残っている状態を作る
        with SessionLocal() as db:
            for kind in ("tobe_ume", "tobe_take", "tobe"):
                db.add(FlowDoc(business_id=bid, kind=kind, data={"lanes": ["経理部"], "steps": [step("S01", 1, [])]}))
            db.commit()
        b = c.get(f"/api/businesses/{bid}", headers=ADMIN).json()
        assert b["status"] == "AS-IS作成済" and b["saved_minutes"] is None
        assert c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()["tobe"] is None
        # TO-BEを作る（S02 をなくし、S01 を 10分 → 4分に）。企業担当者も保存できる
        tobe = {"lanes": ["経理部"], "steps": [{**step("S01", 4, ["S03"]), "change": "自動化"}, step("S03", 5, [])],
                "summary": "RPAで転記を自動化する", "needs": ["RPAツール"]}
        assert c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": tobe, "version": 0}, headers=TANAKA).status_code == 200
        b = c.get(f"/api/businesses/{bid}", headers=ADMIN).json()
        assert b["status"] == "TO-BE作成済" and b["saved_minutes"] == 26
        listed = {x["id"]: x for x in c.get("/api/companies/1/businesses", headers=ADMIN).json()}[bid]
        assert listed["saved_minutes"] == 26
        # DBでは、以前の「松」と同じ種類（tobe_matsu）の行に入る
        with SessionLocal() as db:
            kinds = sorted(f.kind for f in db.get(Business, bid).flows)
        assert kinds == ["asis", "tobe", "tobe_matsu", "tobe_take", "tobe_ume"]
        assert c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": tobe, "version": 0}, headers=SATO).status_code == 404
        c.delete(f"/api/businesses/{bid}", headers=ADMIN)


def test_wage_and_monthly_count():
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
        # 単価表はなくした。以前の図に残っている「お金のかかる導入物」は、保存し直すと消える
        assert c.get("/api/cost-items", headers=ADMIN).status_code == 404
        doc = c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()["tobe"]
        r = c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": {**doc["data"], "cost_items": ["RPA"]}, "version": doc["version"]}, headers=TANAKA)
        assert r.status_code == 200 and "cost_items" not in r.json()["data"]


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
        assert c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": plan, "version": 0}, headers=ADMIN).status_code == 200
        names = [r["name"] for r in c.get(f"/api/companies/{co}/resources", headers=ADMIN).json()]
        assert "RPA" in names and len(names) == len(set(names))
        # ほかの企業の図は混ざらない。ほかの企業の人には見えない
        other = {r["name"] for r in c.get("/api/companies/1/resources", headers=ADMIN).json()}
        assert "生産管理システム" not in other and "営業部（受注）" in other
        assert c.get(f"/api/companies/{co}/resources", headers=TANAKA).status_code == 404
        c.delete(f"/api/companies/{co}", headers=ADMIN)


def test_asis_versions_and_diagnosis_history():
    """AS-ISは保存するたびに版が残る。診断を記録するときに、業務ごとに「そのときの版」を選ぶ"""
    with TestClient(app) as c:
        co = c.post("/api/companies", headers=ADMIN, json={"name": "履歴テスト商会"}).json()["id"]
        bid = c.post(f"/api/companies/{co}/businesses", headers=ADMIN, json={"name": "受注"}).json()["id"]
        bid2 = c.post(f"/api/companies/{co}/businesses", headers=ADMIN, json={"name": "請求"}).json()["id"]
        member = {"X-User-Email": "rireki@example.com"}
        c.post("/api/users", headers=ADMIN, json={"email": member["X-User-Email"], "name": "履歴の人", "role": "member", "company_id": co})

        def step(sid, name, tool="", issue=None, nxt=(), media=()):
            return {"id": sid, "lane": "受注課", "name": name, "tool": tool, "minutes": 10, "issue": issue,
                    "next": list(nxt), "next_media": list(media)}

        def save(b, data, version, who=ADMIN):
            r = c.put(f"/api/businesses/{b}/flows/asis", json={"data": data, "version": version}, headers=who)
            assert r.status_code == 200, r.text
            return r.json()

        def versions(b, who=ADMIN):
            return c.get(f"/api/businesses/{b}/versions", headers=who).json()

        v1 = {"lanes": ["受注課"], "steps": [
            step("S01", "FAXを見て手入力", "紙の注文書", "ボトルネック", ["S02"], ["メール"]),
            step("S02", "在庫表に転記", "Excel", "ボトルネック", ["S03"]),
            step("S03", "出荷を指示", "紙の伝票"),
        ]}
        v2 = {"lanes": ["受注課"], "steps": [step("S01", "Web受注を確認", "受注システム", None, ["S03"]), step("S03", "出荷を指示", "受注システム")]}
        assert versions(bid) == []
        # 保存するたびに版が増える（企業担当者の保存も）。中身が直前と同じなら増えない。TO-BEの保存では増えない
        doc = save(bid, v1, 0)
        doc = save(bid, v1, doc["version"])
        assert [v["number"] for v in versions(bid)] == [1]
        doc = save(bid, v2, doc["version"], member)
        c.put(f"/api/businesses/{bid}/flows/tobe", json={"data": v2, "version": 0}, headers=ADMIN)
        vs = versions(bid, member)
        assert [(v["number"], v["saved_by"]) for v in vs] == [(1, "銀行担当者（あなた）"), (2, "履歴の人")]
        assert [s["name"] for s in vs[0]["data"]["steps"]] == ["FAXを見て手入力", "在庫表に転記", "出荷を指示"]  # 第1版は最初のまま
        assert (vs[0]["metrics"]["manual"], vs[1]["metrics"]["manual"]) == (2, 0) and vs[0]["saved_at"]
        assert c.get(f"/api/businesses/{bid}", headers=ADMIN).json()["asis_versions"] == 2
        assert versions(bid, TANAKA) == {"detail": "業務が見つかりません"}
        save(bid2, {"lanes": ["経理"], "steps": [step("S01", "請求書を印刷", "紙の請求書")]}, 0)
        id1, id2 = vs[0]["id"], vs[1]["id"]
        other_id = versions(bid2)[0]["id"]
        # 企業の全業務の版の見出し（診断を記録するときの選択肢）
        refs = c.get(f"/api/companies/{co}/versions", headers=member).json()
        assert [(r["business_id"], r["number"]) for r in refs] == [(bid, 1), (bid, 2), (bid2, 1)] and "data" not in refs[0]
        assert c.get(f"/api/companies/{co}/versions", headers=TANAKA).status_code == 404

        # 診断を記録できるのは銀行担当者だけ。日付は必須
        first = {"date": "2025-11-12", "kind": "annual", "participants": "経営者、受注課", "staff": "DX支援部門 田中",
                 "gaps": [{"exec": "出荷が遅いのは倉庫の人手不足", "field": "受注の転記待ちで出荷指示が午後にずれる"},
                          {"exec": " ", "field": ""}],
                 "version_ids": [id1]}
        assert c.post(f"/api/companies/{co}/diagnoses", json=first, headers=member).status_code == 403
        assert c.post(f"/api/companies/{co}/diagnoses", json={"kind": "annual"}, headers=ADMIN).status_code == 422
        assert c.post(f"/api/companies/{co}/diagnoses", json={**first, "kind": "x"}, headers=ADMIN).status_code == 422
        # 選べるのは、その企業の業務の版だけ。1つの業務につき1つ
        foreign = c.get(f"/api/businesses/{_ids(c)['請求書発行業務']}/versions", headers=ADMIN).json()
        assert c.post(f"/api/companies/{co}/diagnoses", json={**first, "version_ids": [id1, id2]}, headers=ADMIN).status_code == 422
        assert c.post(f"/api/companies/{co}/diagnoses", json={**first, "version_ids": [999999]}, headers=ADMIN).status_code == 422
        if foreign:
            assert c.post(f"/api/companies/{co}/diagnoses", json={**first, "version_ids": [foreign[0]["id"]]}, headers=ADMIN).status_code == 422
        # 過去の版（第1版）を選んで記録する。空のずれは捨てる。数え方は図の集計と同じ
        d1 = c.post(f"/api/companies/{co}/diagnoses", json=first, headers=ADMIN)
        assert d1.status_code == 200, d1.text
        d1 = d1.json()
        # 月の件数が分からない業務なので、削減工数は出ない
        assert d1["versions"] == [{"business_id": bid, "business_name": "受注", "version_id": id1, "number": 1, "saved_hours": None}]
        assert d1["saved_hours"] is None
        assert len(d1["gaps"]) == 1 and d1["created_by"]
        m = d1["metrics"]
        assert (m["businesses"], m["steps"], m["minutes"], m["issues"], m["manual"], m["paper"], m["mail"], m["gaps"]) == (1, 3, 30, 2, 2, 2, 1, 1)
        # 版を省略すると、各業務のいちばん新しい版。何も選ばない記録（[]）もできる
        d2 = c.post(f"/api/companies/{co}/diagnoses", json={"date": "2026-11-10"}, headers=ADMIN).json()
        assert [(v["business_id"], v["number"]) for v in d2["versions"]] == [(bid, 2), (bid2, 1)]
        assert (d2["metrics"]["businesses"], d2["metrics"]["issues"], d2["metrics"]["manual"], d2["metrics"]["paper"]) == (2, 0, 0, 1)
        d0 = c.post(f"/api/companies/{co}/diagnoses", json={"date": "2026-05-21", "kind": "proposal", "note": "Web受注を提案", "version_ids": []}, headers=ADMIN).json()
        assert d0["versions"] == [] and d0["metrics"]["businesses"] == 0

        # 一覧は新しい順。企業担当者も自社のものは見られる。他社の人には見えない
        listed = c.get(f"/api/companies/{co}/diagnoses", headers=member).json()
        assert [x["id"] for x in listed] == [d2["id"], d0["id"], d1["id"]]
        assert c.get(f"/api/companies/{co}/diagnoses", headers=TANAKA).status_code == 404
        # 版の側から、どの診断で選ばれているかが分かる
        assert [[d["id"] for d in v["diagnoses"]] for v in versions(bid)] == [[d1["id"]], [d2["id"]]]

        # 記録は直せる。版を省略すると選んだ版は今のまま、渡すと選び直す。直せる・消せるのは銀行担当者だけ
        edit = {"date": "2025-11-13", "kind": "annual", "participants": "経営者", "gaps": []}
        assert c.put(f"/api/diagnoses/{d1['id']}", json=edit, headers=member).status_code == 403
        assert c.put(f"/api/diagnoses/{d1['id']}", json=edit, headers=TANAKA).status_code == 403
        r = c.put(f"/api/diagnoses/{d1['id']}", json=edit, headers=ADMIN).json()
        assert r["date"] == "2025-11-13" and r["gaps"] == [] and [v["version_id"] for v in r["versions"]] == [id1]
        r = c.put(f"/api/diagnoses/{d1['id']}", json={**edit, "version_ids": [id2, other_id]}, headers=ADMIN).json()
        assert [v["version_id"] for v in r["versions"]] == [id2, other_id] and r["metrics"]["manual"] == 0
        assert c.put(f"/api/diagnoses/{d1['id']}", json={**edit, "version_ids": [id1, id2]}, headers=ADMIN).status_code == 422
        # 記録を消しても、版は残る
        assert c.delete(f"/api/diagnoses/{d2['id']}", headers=member).status_code == 403
        assert c.delete(f"/api/diagnoses/{d2['id']}", headers=ADMIN).status_code == 200
        assert [v["number"] for v in versions(bid)] == [1, 2]
        # 業務を消すと、その業務の版と、記録との結び付きが消える。企業を消すと、記録も消える
        assert c.delete(f"/api/businesses/{bid}", headers=ADMIN).status_code == 200
        left = {x["id"]: x for x in c.get(f"/api/companies/{co}/diagnoses", headers=ADMIN).json()}
        assert [v["business_id"] for v in left[d1["id"]]["versions"]] == [bid2]
        assert c.delete(f"/api/companies/{co}", headers=ADMIN).status_code == 200


def test_first_version_for_existing_asis():
    """版の仕組みができる前に保存されたAS-ISは、起動時に第1版として残る"""
    from app.db import FlowDoc, FlowVersion, SessionLocal, init_db

    with TestClient(app) as c:
        bid = c.post("/api/companies/1/businesses", headers=ADMIN, json={"name": "前からあるAS-IS"}).json()["id"]
        data = {"lanes": ["経理部"], "steps": [{"id": "S01", "lane": "経理部", "name": "入力", "next": []}]}
        with SessionLocal() as db:
            db.add(FlowDoc(business_id=bid, kind="asis", data=data, updated_by="前の人"))
            db.commit()
        assert c.get(f"/api/businesses/{bid}/versions", headers=ADMIN).json() == []
        init_db()
        init_db()  # 何度動いても増えない
        vs = c.get(f"/api/businesses/{bid}/versions", headers=ADMIN).json()
        assert [(v["number"], v["saved_by"]) for v in vs] == [(1, "前の人")]
        with SessionLocal() as db:
            assert db.query(FlowVersion).filter_by(business_id=bid).count() == 1
        c.delete(f"/api/businesses/{bid}", headers=ADMIN)


def test_saved_hours_from_first_version():
    """削減工数（月あたり・時間）：AS-ISの第1版とくらべた値。企業ぜんたいの合計と、月ごとの推移"""
    from datetime import datetime

    from app import effort
    from app.db import FlowVersion, SessionLocal

    # 頻度の読み取りは、画面（frontend/lib/cost.ts）と同じ
    f = effort.monthly_count_from_frequency
    assert (f("日30件"), f("週に20件"), f("月２００件"), f("年間1,200件"), f("随時"), f("30件/日"), f(None)) == (600, 80, 200, 100, None, None, None)

    with TestClient(app) as c:
        co = c.post("/api/companies", headers=ADMIN, json={"name": "工数テスト商事"}).json()["id"]
        bid = c.post(f"/api/companies/{co}/businesses", headers=ADMIN, json={"name": "受注", "frequency": "日30件"}).json()["id"]
        bid2 = c.post(f"/api/companies/{co}/businesses", headers=ADMIN, json={"name": "請求", "frequency": "随時"}).json()["id"]
        member = {"X-User-Email": "kousu@example.com"}
        c.post("/api/users", headers=ADMIN, json={"email": member["X-User-Email"], "name": "工数の人", "role": "member", "company_id": co})

        def flow(*minutes):
            return {"lanes": ["受注課"], "steps": [{"id": f"S{i:02d}", "lane": "受注課", "name": f"作業{i}", "minutes": m, "next": []}
                                                 for i, m in enumerate(minutes, 1)]}

        def save(b, data, version):
            return c.put(f"/api/businesses/{b}/flows/asis", json={"data": data, "version": version}, headers=ADMIN).json()

        empty = c.get(f"/api/companies/{co}/effort", headers=ADMIN).json()
        assert empty == {"total_hours": None, "current_hours": None, "businesses": [], "months": []}
        d = save(bid, flow(30, 30), 0)             # 第1版：60分
        d = save(bid, flow(30, 20), d["version"])  # 第2版：50分 → 10分 × 600件 ＝ 月100時間
        d = save(bid, flow(30), d["version"])      # 第3版：30分 → 30分 × 600件 ＝ 月300時間
        save(bid2, flow(15), 0)                    # 月の件数が分からない業務
        vs = c.get(f"/api/businesses/{bid}/versions", headers=member).json()
        assert [(v["minutes"], v["saved_hours"]) for v in vs] == [(60, 0.0), (50, 100.0), (30, 300.0)]
        assert c.get(f"/api/businesses/{bid2}/versions", headers=ADMIN).json()[0]["saved_hours"] is None
        assert "saved_hours_input" not in vs[0]  # 手で入力する仕組みはなくした
        assert c.put(f"/api/versions/{vs[2]['id']}/saved-hours", json={"value": 1}, headers=ADMIN).status_code == 404

        # 診断の記録には、選んだ版の削減工数が出る（第2版を選べば100時間、いちばん新しい版なら300時間）
        dg = c.post(f"/api/companies/{co}/diagnoses", json={"date": "2026-10-20", "version_ids": [vs[1]["id"]]}, headers=ADMIN).json()
        assert (dg["saved_hours"], dg["versions"][0]["saved_hours"]) == (100.0, 100.0)
        dg = c.post(f"/api/companies/{co}/diagnoses", json={"date": "2026-11-10"}, headers=ADMIN).json()
        assert dg["saved_hours"] == 300.0 and [v["saved_hours"] for v in dg["versions"]] == [300.0, None]
        # 企業ぜんたい：業務ごとに、いちばん新しい版の値。月の件数が分からない業務は合計に入らない
        e = c.get(f"/api/companies/{co}/effort", headers=member).json()
        assert e["total_hours"] == 300.0
        # いまの作業時間（月あたり）＝いちばん新しい版の30分 × 600件
        assert e["current_hours"] == 300.0
        assert {b["name"]: b["current_hours"] for b in e["businesses"]} == {"受注": 300.0, "請求": None}
        by = {b["name"]: b for b in e["businesses"]}
        assert (by["受注"]["versions"], by["受注"]["first_minutes"], by["受注"]["latest_minutes"], by["受注"]["monthly_count"], by["受注"]["saved_hours"]) == (3, 60, 30, 600, 300.0)
        assert (by["請求"]["monthly_count"], by["請求"]["saved_hours"]) == (None, None)
        assert len(e["months"]) == 1 and e["months"][0]["hours"] == 300.0
        assert c.get(f"/api/companies/{co}/effort", headers=TANAKA).status_code == 404

        # 月ごとの推移：その月の終わりの時点でいちばん新しかった版の値（第1版を9月、第2版を10月に保存したことにする）
        with SessionLocal() as db:
            db.get(FlowVersion, vs[0]["id"]).saved_at = datetime(2026, 9, 10)
            db.get(FlowVersion, vs[1]["id"]).saved_at = datetime(2026, 10, 5)
            db.commit()
        months = c.get(f"/api/companies/{co}/effort", headers=ADMIN).json()["months"]
        assert [(m["month"], m["hours"]) for m in months][:2] == [("2026-09", 0.0), ("2026-10", 100.0)]
        assert months[-1]["hours"] == 300.0 and len(months) >= 3
        # 月の件数を入れると、それで計算する
        c.put(f"/api/businesses/{bid}", json={"name": "受注", "department": "", "frequency": "日30件", "description": "", "monthly_count": 60}, headers=ADMIN)
        assert c.get(f"/api/businesses/{bid}/versions", headers=ADMIN).json()[2]["saved_hours"] == 30.0
        c.delete(f"/api/companies/{co}", headers=ADMIN)
