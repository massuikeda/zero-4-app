import os

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes")


class Settings:
    database_url = os.getenv("DATABASE_URL", "sqlite:///./flow.db")
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
