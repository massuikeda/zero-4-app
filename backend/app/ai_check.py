"""Azure OpenAI の接続を調べる（あなたのPCで実行する）: backend フォルダで  python -m app.ai_check

.env の値（エンドポイント・キー・デプロイ名）は画面に出しません。形式が合っているかと、Azure に短い依頼を
送った結果（成功／失敗とその理由）だけを表示します。
"""
from __future__ import annotations

from urllib.parse import urlparse

from . import ai
from .config import settings


def _endpoint_report() -> list[str]:
    raw = settings.azure_openai_endpoint.strip().strip("\"'")
    if not raw:
        return ["× AZURE_OPENAI_ENDPOINT が空です"]
    u = urlparse(raw if "://" in raw else "https://" + raw)
    host = u.netloc.lower()
    out = []
    if host.endswith(".openai.azure.com") or host.endswith(".cognitiveservices.azure.com"):
        out.append("○ AZURE_OPENAI_ENDPOINT：Azure OpenAI の形式です")
    elif host.endswith(".services.ai.azure.com"):
        out.append("△ AZURE_OPENAI_ENDPOINT：Foundry（services.ai.azure.com）の形式です。"
                   "動かないときは Azure ポータルの「キーとエンドポイント」にある openai.azure.com の方を使ってください")
    else:
        out.append("× AZURE_OPENAI_ENDPOINT：Azure OpenAI のエンドポイントの形ではありません（https://<名前>.openai.azure.com/ の形）")
    if u.scheme != "https":
        out.append("× AZURE_OPENAI_ENDPOINT：https:// で始めてください")
    if u.path.strip("/") or u.query:
        extra = "/api/projects/…（プロジェクトのURL）" if "/api/projects" in u.path else "後ろの部分（/openai/… や ?api-version=…）"
        out.append(f"△ AZURE_OPENAI_ENDPOINT：{extra} が付いています。アプリは自動で取り除いて使います")
    return out


def _deployment_report() -> list[str]:
    raw = settings.azure_openai_deployment
    name = ai.deployment_name()
    if not name:
        return ["× AZURE_OPENAI_DEPLOYMENT が空です"]
    out = [f"○ AZURE_OPENAI_DEPLOYMENT：設定あり（{len(name)}文字）"]
    if raw != raw.strip() or raw.strip() != name:
        out.append("△ AZURE_OPENAI_DEPLOYMENT：前後に空白や引用符があります（アプリは取り除いて使います）")
    if " " in name or "　" in name:
        out.append("× AZURE_OPENAI_DEPLOYMENT：途中に空白があります。デプロイ名に空白は使えません")
    return out


def _try(version: str) -> str:
    import openai

    label = "v1（新しい呼び出し方）" if ai.uses_v1(version) else f"api-version {version}（従来の呼び出し方）"
    try:
        res = ai._client(version).chat.completions.create(
            model=ai.deployment_name(),
            messages=[{"role": "user", "content": "「OK」とだけ返してください"}],
        )
        ok = bool(res.choices and (res.choices[0].message.content or "").strip())
        return f"○ {label}：成功しました" + ("" if ok else "（ただし返事が空でした）")
    except openai.AuthenticationError as e:
        return f"× {label}：キーが通りません（401）。AZURE_OPENAI_API_KEY を確認。Azure の説明：{e.message}"
    except openai.NotFoundError as e:
        return f"× {label}：見つかりません（404）。デプロイ名かエンドポイントが違います。Azure の説明：{e.message}"
    except openai.APIConnectionError:
        return f"× {label}：接続できません。エンドポイントのつづり・ネットワーク（社内プロキシなど）を確認"
    except openai.APIError as e:
        return f"× {label}：エラー（{getattr(e, 'status_code', '')}）。Azure の説明：{e.message}"


def main() -> None:
    print("=== Azure OpenAI の接続チェック（設定の値は表示しません） ===")
    lines = _endpoint_report()
    lines.append("○ AZURE_OPENAI_API_KEY：設定あり" if settings.azure_openai_api_key.strip() else "× AZURE_OPENAI_API_KEY が空です")
    lines += _deployment_report()
    current = settings.azure_openai_api_version
    lines.append(f"・AZURE_OPENAI_API_VERSION：{current}（{'新しい呼び出し方' if ai.uses_v1() else '従来の呼び出し方'}）")
    print("\n".join(lines))
    if not ai.enabled():
        print("\n設定が足りないため、Azure への送信は試していません。")
        return
    print("\nAzure に短い依頼を送って試します…")
    results = {v: _try(v) for v in (["v1", "2024-10-21"] if ai.uses_v1() else [current, "v1"])}
    print("\n".join(results.values()))
    ok = [v for v, r in results.items() if r.startswith("○")]
    print()
    if not ok:
        print("→ どちらの呼び出し方でも失敗しました。上の「Azure の説明」を見て、エンドポイントとデプロイ名を確認してください。")
    elif current in ok or (ai.uses_v1() and "v1" in ok):
        print("→ 今の設定で動きます。バックエンドを再起動して、画面からもう一度お試しください。")
    else:
        print(f"→ 今の設定では動きませんが、AZURE_OPENAI_API_VERSION={ok[0]} にすると動きます。.env を直してバックエンドを再起動してください。")


if __name__ == "__main__":
    main()
