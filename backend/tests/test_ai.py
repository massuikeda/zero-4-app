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
        s0, s1 = asis["steps"][0], asis["steps"][1]
        answer = """```json
{"summary": "入力を自動化する", "changes": [
  {"id": "%s", "action": "自動化", "name": "データを取り込む", "minutes": 99999, "tool": "会計システム", "media": "システム連携", "note": "手入力をやめる", "issue_resolved": true},
  {"id": "%s", "action": "排除", "name": "無視される名前", "note": "不要になる"},
  {"id": "S999", "action": "自動化", "note": "AS-ISにない作業"},
  {"id": "%s", "action": "排除", "note": "同じ作業への2つ目の変更"},
  {"id": "%s", "action": "魔法", "note": "決まっていない変更区分"}
]}
```""" % (s0["id"], s1["id"], s0["id"], asis["steps"][2]["id"])
        fake = _configure(monkeypatch, answer)
        r = c.post(f"/api/businesses/{bid}/tobe/suggest", headers=TANAKA)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["summary"] == "入力を自動化する"
        # AS-ISにない作業・同じ作業への2つ目・決まっていない変更区分は捨てる
        assert [(x["id"], x["action"]) for x in out["changes"]] == [(s0["id"], "自動化"), (s1["id"], "排除")]
        first = out["changes"][0]
        assert first["tool"] == "会計システム" and first["media"] == "システム連携" and first["issue_resolved"] is True
        assert first["minutes"] <= max(s0["minutes"], 0) or s0["minutes"] == 0  # 変更前より増やさない
        assert out["changes"][1]["name"] is None  # 排除では作業名を使わない
        # AIにはAS-ISの作業と、企業の道具の候補が渡る
        last = fake.calls[0]["messages"][-1]["content"]
        assert s0["id"] in last and s0["name"] in last and "道具の候補" in last and "<flow>" in last
        # 保存はしない
        assert c.get(f"/api/businesses/{bid}/flows", headers=ADMIN).json()["tobe"] is None
        # 他社の業務は 404
        other = c.get("/api/companies/2/businesses", headers=ADMIN).json()[0]["id"]
        assert c.post(f"/api/businesses/{other}/tobe/suggest", headers=TANAKA).status_code == 404


def test_tobe_suggest_errors(monkeypatch):
    with TestClient(app) as c:
        bid = _bid(c, "請求書発行業務")
        # 設定がないとき
        monkeypatch.setattr(settings, "azure_openai_endpoint", "")
        assert c.post(f"/api/businesses/{bid}/tobe/suggest", headers=ADMIN).status_code == 503
        # 読み取れない返事・使える変更が1つもない返事
        _configure(monkeypatch, "改善案は次のとおりです。まず入力を減らします。")
        assert c.post(f"/api/businesses/{bid}/tobe/suggest", headers=ADMIN).status_code == 502
        _configure(monkeypatch, '{"summary": "x", "changes": [{"id": "S999", "action": "排除"}]}')
        assert c.post(f"/api/businesses/{bid}/tobe/suggest", headers=ADMIN).status_code == 502
        # AS-ISがまだない業務
        new = c.post("/api/companies/1/businesses", headers=ADMIN, json={"name": "AS-ISなし"}).json()["id"]
        assert c.post(f"/api/businesses/{new}/tobe/suggest", headers=ADMIN).status_code == 422
        c.delete(f"/api/businesses/{new}", headers=ADMIN)
