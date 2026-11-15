"""Azure OpenAI でヒアリングを整える API のテスト（本物のAzureには接続しない）: pytest -q"""
import os
import tempfile
from types import SimpleNamespace

os.environ["DATABASE_URL"] = os.environ.get("DATABASE_URL") or f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["AUTH_MODE"] = "dev"
os.environ["SEED_DEMO"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ai  # noqa: E402
from app.api import app  # noqa: E402
from app.config import settings  # noqa: E402

ADMIN = {"X-User-Email": "admin@example.com"}
TANAKA = {"X-User-Email": "tanaka@sample-shoji.example"}  # サンプル商事の企業担当者


class FakeClient:
    """chat.completions.create の呼び出しを記録して、決まった答えを返す"""

    def __init__(self, answer: str):
        self.answer = answer
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        msg = SimpleNamespace(content=self.answer)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason="stop")])


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "azure_openai_endpoint", "https://example.openai.azure.com/")
    monkeypatch.setattr(settings, "azure_openai_api_key", "test-key")
    monkeypatch.setattr(settings, "azure_openai_deployment", "my-deploy")
    fake = FakeClient("```\n営業部：FAXを見てエクセルに手入力（15分） →メール\n\n※ 手書きを見て入力／読み間違い\n```")
    monkeypatch.setattr(ai, "_client", lambda: fake)
    return fake


def _bid(c, name):
    return {b["name"]: b["id"] for b in c.get("/api/companies/1/businesses", headers=ADMIN).json()}[name]


def test_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "azure_openai_api_key", "")
    with TestClient(app) as c:
        assert c.get("/api/config").json()["ai_enabled"] is False
        r = c.post(f"/api/businesses/{_bid(c, '経費精算業務')}/hearing/format", json={"raw": "テスト"}, headers=ADMIN)
        assert r.status_code == 503 and "AZURE_OPENAI" in r.json()["detail"]


def test_format_and_permissions(configured):
    with TestClient(app) as c:
        assert c.get("/api/config").json()["ai_enabled"] is True
        bid = _bid(c, "受注〜出荷業務")
        r = c.post(f"/api/businesses/{bid}/hearing/format", json={"raw": "営業はFAXを見て入力している"}, headers=TANAKA)
        assert r.status_code == 200, r.text
        # コードブロックと空行は取り除かれる
        assert r.json()["text"] == "営業部：FAXを見てエクセルに手入力（15分） →メール\n※ 手書きを見て入力／読み間違い"
        call = configured.calls[-1]
        assert call["model"] == "my-deploy"  # Azure はデプロイ名
        last = call["messages"][-1]["content"]
        assert "営業部（受注）" in last and "<record>\n営業はFAXを見て入力している\n</record>" in last
        # 他社の業務は 404、空の記録は 400
        other = c.get("/api/companies/2/businesses", headers=ADMIN).json()[0]["id"]
        assert c.post(f"/api/businesses/{other}/hearing/format", json={"raw": "x"}, headers=TANAKA).status_code == 404
        assert c.post(f"/api/businesses/{bid}/hearing/format", json={"raw": "  "}, headers=TANAKA).status_code == 400


def test_hearing_raw_is_saved():
    with TestClient(app) as c:
        bid = _bid(c, "受注〜出荷業務")
        r = c.put(f"/api/businesses/{bid}/notes", json={"hearing_raw": "聞いたままのメモ"}, headers=TANAKA)
        assert r.status_code == 200 and r.json()["hearing_raw"] == "聞いたままのメモ"
        assert r.json()["hearing_notes"].startswith("取引先：")  # 送っていない項目はそのまま


def _configure(monkeypatch, answer: str) -> FakeClient:
    monkeypatch.setattr(settings, "azure_openai_endpoint", "https://example.openai.azure.com/")
    monkeypatch.setattr(settings, "azure_openai_api_key", "test-key")
    monkeypatch.setattr(settings, "azure_openai_deployment", "my-deploy")
    fake = FakeClient(answer)
    monkeypatch.setattr(ai, "_client", lambda: fake)
    return fake


def test_tobe_suggest(monkeypatch):
    with TestClient(app) as c:
        bid = _bid(c, "請求書発行業務")  # デモデータ：AS-ISのみ
        asis = c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()["asis"]["data"]
        s0, s1, s2 = (asis["steps"][i] for i in range(3))
        every = ", ".join('{"id": "%s", "action": "排除", "note": "x"}' % s["id"] for s in asis["steps"])
        answer = """```json
{"plans": {
  "ume": {"summary": "様式をそろえる", "needs": ["入力様式の統一ルール"], "cost_items": [], "changes": [
    {"id": "%(s0)s", "action": "簡素化", "name": "定型文で依頼する", "minutes": 99999, "tool": "共有Excel", "media": "チャット", "note": "電話をやめ、メールの定型文で依頼する"},
    {"id": "S999", "action": "簡素化", "note": "AS-ISにない作業"},
    {"id": "%(s0)s", "action": "排除", "note": "同じ作業への2つ目の変更"},
    {"id": "%(s2)s", "action": "魔法", "note": "決まっていない変更区分"}
  ]},
  "take": {"summary": "OCRで読み取る", "needs": ["OCRサービス", "", 5], "cost_items": ["OCR", "OCR", " 独自の読み取り装置 ", "", 7, {"x": 1}], "changes": [
    {"id": "%(s0)s", "action": "自動化", "name": "読み取り結果を確認する", "minutes": 1, "tool": "OCR", "media": "のろし", "note": "OCRで読み取る", "issue_resolved": true},
    {"id": "%(s1)s", "action": "排除", "name": "無視される名前", "note": "不要になる"}
  ]},
  "matsu": {"summary": "すべてなくす", "needs": [], "changes": [%(every)s]},
  "極上": {"summary": "知らない案", "changes": [{"id": "%(s0)s", "action": "排除", "note": "x"}]}
}}
```""" % {"s0": s0["id"], "s1": s1["id"], "s2": s2["id"], "every": every}
        fake = _configure(monkeypatch, answer)
        r = c.post(f"/api/businesses/{bid}/tobe/suggest", headers=TANAKA)
        assert r.status_code == 200, r.text
        plans = r.json()["plans"]
        # すべての作業をなくす案（松）と、知らない案は入れない
        assert list(plans) == ["ume", "take"]
        ume, take = plans["ume"], plans["take"]
        assert ume["summary"] == "様式をそろえる" and ume["needs"] == ["入力様式の統一ルール"]
        # AS-ISにない作業・同じ作業への2つ目・決まっていない変更区分は捨てる
        assert [(x["id"], x["action"]) for x in ume["changes"]] == [(s0["id"], "簡素化")]
        assert ume["changes"][0]["tool"] == "共有Excel" and ume["changes"][0]["media"] == "チャット"
        assert ume["changes"][0]["minutes"] <= s0["minutes"] or s0["minutes"] == 0  # 変更前より増やさない
        assert take["needs"] == ["OCRサービス", "5"]
        # お金のかかる導入物：重複・空・文字でないものは捨てる。単価表にない名前はそのまま残す（画面で要見積もり）
        assert ume["cost_items"] == [] and take["cost_items"] == ["OCR", "独自の読み取り装置"]
        assert [(x["id"], x["action"]) for x in take["changes"]] == [(s0["id"], "自動化"), (s1["id"], "排除")]
        assert take["changes"][0]["issue_resolved"] is True and take["changes"][0]["media"] is None  # 決まっていない渡し方は使わない
        assert take["changes"][1]["name"] is None  # 排除では作業名を使わない
        # AIには、3案の分け方・AS-ISの作業・企業の道具の候補が渡る
        msgs = fake.calls[0]["messages"]
        assert "梅" in msgs[0]["content"] and "RPA" in msgs[0]["content"]
        last = msgs[-1]["content"]
        assert s0["id"] in last and s0["name"] in last and "道具の候補" in last and "<flow>" in last
        assert "単価表の候補：RPA、OCR" in last  # 単価表の名前が、候補として渡る
        # 保存はしない
        assert c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()["plans"] == {}
        # 他社の業務は 404
        other = c.get("/api/companies/2/businesses", headers=ADMIN).json()[0]["id"]
        assert c.post(f"/api/businesses/{other}/tobe/suggest", headers=TANAKA).status_code == 404


def test_tobe_suggest_errors(monkeypatch):
    with TestClient(app) as c:
        bid = _bid(c, "請求書発行業務")
        # 設定がないとき
        monkeypatch.setattr(settings, "azure_openai_endpoint", "")
        assert c.post(f"/api/businesses/{bid}/tobe/suggest", headers=ADMIN).status_code == 503
        # 読み取れない返事・使える変更が1つもない返事・以前の形（1案だけ）の返事
        _configure(monkeypatch, "改善案は次のとおりです。まず入力を減らします。")
        assert c.post(f"/api/businesses/{bid}/tobe/suggest", headers=ADMIN).status_code == 502
        _configure(monkeypatch, '{"plans": {"ume": {"summary": "x", "changes": [{"id": "S999", "action": "排除"}]}}}')
        assert c.post(f"/api/businesses/{bid}/tobe/suggest", headers=ADMIN).status_code == 502
        _configure(monkeypatch, '{"summary": "x", "changes": [{"id": "S01", "action": "排除"}]}')
        assert c.post(f"/api/businesses/{bid}/tobe/suggest", headers=ADMIN).status_code == 502
        # AS-ISがまだない業務
        new = c.post("/api/companies/1/businesses", headers=ADMIN, json={"name": "AS-ISなし"}).json()["id"]
        assert c.post(f"/api/businesses/{new}/tobe/suggest", headers=ADMIN).status_code == 422
        c.delete(f"/api/businesses/{new}", headers=ADMIN)


def test_example_plans_are_valid():
    """AIに見せる見本（3案）が、決まった形に合っていて、削減時間が 梅＜竹＜松 になっていること"""
    import json

    from app.schemas import Flow, Step

    rows = [ln.split("｜") for ln in ai.TOBE_EXAMPLE_INPUT.split("<flow>\n")[1].split("\n</flow>")[0].splitlines()]
    flow = Flow(steps=[Step(id=r[0], lane=r[1][3:], name=r[2][3:], tool=r[3][3:], minutes=int(r[4][:-1])) for r in rows])
    plans = ai.parse_tobe(ai.TOBE_EXAMPLE_OUTPUT, flow)["plans"]
    raw = json.loads(ai.TOBE_EXAMPLE_OUTPUT)["plans"]
    assert list(plans) == ["ume", "take", "matsu"]
    saved = {}
    for key, p in plans.items():
        assert len(p["changes"]) == len(raw[key]["changes"])  # 見本の変更は1つも捨てられない
        assert p["summary"] and 1 <= len(p["needs"]) <= 3
        assert all(len(ch["note"]) <= 80 for ch in p["changes"])
        by_id = {st.id: st.minutes for st in flow.steps}
        saved[key] = sum(by_id[ch["id"]] - (0 if ch["action"] == "排除" else ch.get("minutes", by_id[ch["id"]])) for ch in p["changes"])
    assert 0 < saved["ume"] < saved["take"] < saved["matsu"]
    assert all(ch["action"] != "自動化" for ch in plans["ume"]["changes"])  # 梅ではツールを入れない
    # お金のかかる導入物：梅は空。竹・松は、見本の「単価表の候補」にある名前だけを使っている
    candidates = ai.TOBE_EXAMPLE_INPUT.split("単価表の候補：")[1].splitlines()[0].split("、")
    assert plans["ume"]["cost_items"] == []
    assert plans["take"]["cost_items"] and plans["matsu"]["cost_items"]
    assert all(x in candidates for key in ("take", "matsu") for x in plans[key]["cost_items"])
