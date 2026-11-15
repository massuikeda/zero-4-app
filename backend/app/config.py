import os

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes")


def _database_url() -> str:
    """つなぐDBを決める。
    1. DATABASE_URL があれば、それを使う
    2. DB_BACKEND=mysql なら、DB_HOST・DB_USER・DB_PASSWORD・DB_NAME（・DB_PORT）から組み立てる
       （ユーザー名とパスワードを別々の項目で入れられる。パスワードの記号もそのまま書ける）
    3. どちらもなければ SQLite（flow.db）
    ※ DB_HOST などがあっても、DB_BACKEND=mysql がなければ SQLite のまま
      （ローカルの .env に移行用の DB_HOST などを書いていても、ローカルのアプリは flow.db を使う）
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    if os.getenv("DB_BACKEND", "").strip().lower() != "mysql":
        return "sqlite:///./flow.db"
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME") if not os.getenv(k)]
    if missing:
        raise RuntimeError(f"DB_BACKEND=mysql ですが、{'・'.join(missing)} が設定されていません")
    from sqlalchemy import URL

    return URL.create(
        "mysql+pymysql",
        username=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"].strip(),
        port=int(os.getenv("DB_PORT") or 3306),
        database=os.environ["DB_NAME"].strip(),
        query={"charset": "utf8mb4"},
    ).render_as_string(hide_password=False)


class Settings:
    database_url = _database_url()
    # MySQL へ暗号化（TLS）してつなぐ。Azure では必須。手元の MySQL で試すときだけ DB_SSL=false
    db_ssl = _bool("DB_SSL", True)
    auth_mode = os.getenv("AUTH_MODE", "dev")  # dev / entra
    seed_demo = _bool("SEED_DEMO", True)
    tenant_id = os.getenv("ENTRA_TENANT_ID", "")
    api_client_id = os.getenv("ENTRA_API_CLIENT_ID", "")
    cors_origins = [o for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o]
    # Azure OpenAI（ヒアリングを形式に整える。未設定なら画面のボタンが使えないだけ）
    azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    azure_openai_api_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    azure_openai_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
    # v1（既定）… バージョン指定のいらない新しい呼び出し方。日付（例 2024-10-21）… 従来の呼び出し方
    azure_openai_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "").strip() or "v1"


settings = Settings()

# 開発用のログイン（X-User-Email を送るだけで誰にでもなれる）のまま Azure に出さないための安全装置。
# WEBSITE_SITE_NAME は Azure App Service が自動で入れる値（＝Azure の上で動いている印）。
# 検証用にどうしても dev で動かすときだけ、アプリ設定に ALLOW_DEV_AUTH=true を入れる。
if os.getenv("WEBSITE_SITE_NAME") and settings.auth_mode != "entra" and not _bool("ALLOW_DEV_AUTH"):
    raise RuntimeError(
        "AUTH_MODE=entra が設定されていません。App Service のアプリ設定に AUTH_MODE=entra・"
        "ENTRA_TENANT_ID・ENTRA_API_CLIENT_ID を入れてください"
    )
