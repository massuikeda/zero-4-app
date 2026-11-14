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
TANAKA = {"X-User-Email": "tanaka@sample-shoji.example"}  # 受注〜出荷業務のみ


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
        # 割り当てられていない業務は 404、空の記録は 400
        other = _bid(c, "請求書発行業務")
        assert c.post(f"/api/businesses/{other}/hearing/format", json={"raw": "x"}, headers=TANAKA).status_code == 404
        assert c.post(f"/api/businesses/{bid}/hearing/format", json={"raw": "  "}, headers=TANAKA).status_code == 400


def test_hearing_raw_is_saved():
    with TestClient(app) as c:
        bid = _bid(c, "受注〜出荷業務")
        r = c.put(f"/api/businesses/{bid}/notes", json={"hearing_raw": "聞いたままのメモ"}, headers=TANAKA)
        assert r.status_code == 200 and r.json()["hearing_raw"] == "聞いたままのメモ"
        assert r.json()["hearing_notes"].startswith("取引先：")  # 送っていない項目はそのまま
